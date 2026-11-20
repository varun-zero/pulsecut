/**
 * PulseCut Auto-Clipper — Content Script
 *
 * Works cleanly across:
 * - Kick (live channels, virtualized chatroom, same-origin HLS playback_url capture)
 * - Twitch (live channels, VODs & chat)
 * - YouTube Live & VODs (top-frame HUD + /live_chat iframe observer + exact playback timestamp)
 * - YouTube Shorts & Instagram Reels (one-click capture + auto-detected creator handle)
 *
 * All localhost server requests are proxied through background.js so HTTPS pages
 * never hit Mixed Content or CORS blocks.
 */

(function startPulseCutContentScript() {
  'use strict';

  const engine = globalThis.PulseCutHypeEngine;
  if (!engine) return;

  const IS_TOP_FRAME = window === window.top;
  const CHAT_WINDOW_MS = 6000;
  const BASELINE_WINDOW_MS = 60000;
  const TICK_INTERVAL_MS = 500;

  let config = { ...engine.DEFAULT_CONFIG };
  let context = readPageContext();
  let messageTimestamps = []; // [{ ts, text }]
  let baselineCount = []; // [ts]
  let lastAutoTriggerMs = 0;
  let lastManualTriggerMs = 0;
  let lastAlertMs = 0;
  let serverConnected = false;
  let hudEl = null;
  let currentUrl = window.location.href;
  let chatObserver = null;
  let observedContainer = null;

  // Deduplication for subtree MutationObserver + virtualized Kick/Twitch chat scanner
  const seenNodes = new WeakSet();
  const seenMessageKeys = new Map(); // key -> timestamp

  // Cached Kick/HLS playback URL resolved inside the authenticated browser tab
  let cachedPlaybackUrl = '';
  let cachedPlaybackSlug = '';

  // Iframe batch buffer for relaying YouTube live_chat messages to top frame
  let iframeRelayBuffer = [];
  let iframeRelayTimer = null;

  function readDomHints() {
    const hints = { channelName: '', channelHandle: '', hasLiveBadge: false };
    const host = window.location.hostname.toLowerCase();

    if (host.includes('youtube.com')) {
      const handleLink =
        document.querySelector('ytd-video-owner-renderer a[href^="/@"]') ||
        document.querySelector('ytd-channel-name a[href^="/@"]') ||
        document.querySelector('ytd-reel-player-header-renderer a[href^="/@"]') ||
        document.querySelector('#channel-name a[href^="/@"]');
      if (handleLink) {
        const href = handleLink.getAttribute('href') || '';
        const match = href.match(/\/@([^/?#]+)/);
        if (match) hints.channelHandle = match[1];
      }
      const channelText =
        document.querySelector('ytd-video-owner-renderer ytd-channel-name #text') ||
        document.querySelector('ytd-reel-player-header-renderer #channel-name');
      if (channelText && channelText.textContent) {
        hints.channelName = channelText.textContent.trim();
      }
      const liveBadge = document.querySelector('.ytp-live-badge');
      if (liveBadge) {
        const style = window.getComputedStyle(liveBadge);
        const text = (liveBadge.textContent || '').trim().toUpperCase();
        hints.hasLiveBadge =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          liveBadge.getAttribute('disabled') !== null &&
          text.includes('LIVE');
      }
    } else if (host.includes('instagram.com')) {
      const headerLink =
        document.querySelector('article header a[href^="/"]') ||
        document.querySelector('main a[role="link"][href^="/"]');
      if (headerLink) {
        const seg = (headerLink.getAttribute('href') || '').split('/').filter(Boolean)[0];
        if (seg) hints.channelHandle = seg;
      }
    } else if (host.includes('kick.com')) {
      const heading = document.querySelector('[data-testid="channel-username"], #channel-username, h1');
      if (heading && heading.textContent) {
        hints.channelName = heading.textContent.trim();
      }
    }

    return hints;
  }

  function readPageContext() {
    return engine.detectStreamContext(window.location.href, readDomHints());
  }

  function readVideoTitle() {
    const raw = String(document.title || '')
      .replace(/\s*[-|·]\s*(YouTube|Kick|Twitch|Instagram)\s*$/i, '')
      .replace(/^\(\d+\)\s*/, '')
      .trim();
    return raw.slice(0, 120);
  }

  function readActiveVideoCurrentTime() {
    const videos = Array.from(document.querySelectorAll('video'));
    const active =
      videos.find((v) => !v.paused && v.readyState >= 2 && Number.isFinite(v.currentTime)) ||
      videos.find((v) => v.readyState >= 2 && Number.isFinite(v.currentTime) && v.currentTime > 0);
    if (!active) return null;
    return Number(active.currentTime.toFixed(2));
  }

  /**
   * Resolves a direct HLS `.m3u8` URL inside the authenticated browser tab.
   * For Kick live channels, this runs same-origin AFTER Cloudflare clearance so
   * PulseCut's backend FFmpeg can capture the live stream cleanly without 403s.
   */
  async function resolveLivePlaybackUrl() {
    // 1. Check Performance Resource Timing API for any active HLS manifest loaded by the player.
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const name = entries[i]?.name || '';
        if (name.includes('.m3u8') && !name.includes('preview')) {
          cachedPlaybackUrl = name;
          break;
        }
      }
    } catch {
      // Ignore if performance API is restricted
    }

    // 2. For Kick live channels, fetch same-origin channel API to get the exact master playback_url.
    const slug = engine.extractKickSlug ? engine.extractKickSlug(window.location.href) : '';
    if (slug) {
      if (cachedPlaybackSlug === slug && cachedPlaybackUrl.includes('.m3u8')) {
        return cachedPlaybackUrl;
      }
      try {
        const resp = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (resp.ok) {
          const data = await resp.json();
          const url = data?.playback_url || data?.livestream?.playback_url || '';
          if (typeof url === 'string' && url.startsWith('http')) {
            cachedPlaybackUrl = url;
            cachedPlaybackSlug = slug;
            return url;
          }
        }
      } catch {
        // Fall back to resource-timing URL if present
      }
    }

    return cachedPlaybackUrl || '';
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'No response' });
        });
      } catch (err) {
        resolve({ ok: false, error: String(err?.message || err) });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Chat DOM Observation (2025/2026 Kick, Twitch, YouTube Live selectors)
  // -------------------------------------------------------------------------

  function findChatContainer() {
    if (context.platform === 'kick') {
      return (
        document.querySelector('#chatroom-messages') ||
        document.querySelector('[data-testid="chat-messages"]') ||
        document.querySelector('[id*="chatroom-messages"]') ||
        document.querySelector('[class*="chatroom-messages"]') ||
        document.querySelector('[class*="chat-messages"]') ||
        document.querySelector('#channel-chatroom') ||
        document.querySelector('[id*="chatroom"]')
      );
    }
    if (context.platform === 'twitch') {
      return (
        document.querySelector('.chat-scrollable-area__message-container') ||
        document.querySelector('[role="log"][aria-label*="Chat"]') ||
        document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]')
      );
    }
    if (context.platform === 'youtube') {
      return (
        document.querySelector('yt-live-chat-item-list-renderer #items') ||
        document.querySelector('#items.yt-live-chat-item-list-renderer') ||
        document.querySelector('#chat-messages #items')
      );
    }
    return null;
  }

  function extractMessageText(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';

    if (context.platform === 'kick') {
      const msgEl =
        node.querySelector('[data-testid="chat-message-content"]') ||
        node.querySelector('.chat-entry-content') ||
        node.querySelector('span[class*="font-normal"]');
      const raw = (msgEl ? msgEl.textContent : node.textContent || '').trim();
      // Strip leading "username: " prefix if falling back to whole-row textContent
      const colonIdx = raw.indexOf(':');
      if (!msgEl && colonIdx > 0 && colonIdx < 32) {
        return raw.slice(colonIdx + 1).trim();
      }
      return raw;
    }

    if (context.platform === 'twitch') {
      const body = node.querySelector('[data-a-target="chat-line-message-body"]') || node;
      return (body.textContent || '').trim();
    }

    if (context.platform === 'youtube') {
      const msgEl = node.querySelector('#message') || node;
      return (msgEl.textContent || '').trim();
    }

    return (node.textContent || '').trim();
  }

  function getMessageNodeSelector() {
    if (context.platform === 'kick') {
      return '[data-index], [data-chat-entry], [data-testid="chat-entry"], .chat-entry';
    }
    if (context.platform === 'twitch') {
      return '.chat-line__message, [data-a-target="chat-line-message"]';
    }
    if (context.platform === 'youtube') {
      return 'yt-live-chat-text-message-renderer, yt-live-chat-paid-MESSAGE-renderer, yt-live-chat-paid-message-renderer';
    }
    return '';
  }

  function isChatMessageNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (context.platform === 'kick') {
      return (
        node.hasAttribute('data-index') ||
        node.hasAttribute('data-chat-entry') ||
        node.matches?.('[data-testid="chat-entry"], .chat-entry') ||
        Boolean(node.querySelector?.('[data-chat-entry], .chat-entry-content, [data-testid="chat-message-content"]'))
      );
    }
    if (context.platform === 'twitch') {
      return (
        node.matches?.('.chat-line__message, [data-a-target="chat-line-message"]') ||
        Boolean(node.querySelector?.('[data-a-target="chat-line-message"]'))
      );
    }
    if (context.platform === 'youtube') {
      return (
        node.tagName === 'YT-LIVE-CHAT-TEXT-MESSAGE-RENDERER' ||
        node.tagName === 'YT-LIVE-CHAT-PAID-MESSAGE-RENDERER' ||
        Boolean(node.querySelector?.('#message'))
      );
    }
    return false;
  }

  function buildMessageKey(node, text) {
    const idx = node.getAttribute?.('data-index') || node.getAttribute?.('data-chat-entry') || node.id || '';
    return idx ? `${idx}|${text.slice(0, 64)}` : text.slice(0, 80);
  }

  function collectNewChatMessage(node, now, batch) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (seenNodes.has(node)) return;
    const text = extractMessageText(node);
    if (!text) return;

    const key = buildMessageKey(node, text);
    const prevTs = seenMessageKeys.get(key);
    if (prevTs && now - prevTs < 15000) {
      seenNodes.add(node);
      return;
    }

    seenNodes.add(node);
    seenMessageKeys.set(key, now);
    batch.push({ ts: now, text: text.slice(0, 240) });
  }

  function pruneSeenKeys(now) {
    if (seenMessageKeys.size < 250) return;
    for (const [k, ts] of seenMessageKeys.entries()) {
      if (now - ts > 30000) seenMessageKeys.delete(k);
    }
  }

  function recordMessages(items) {
    if (!items.length) return;
    if (!IS_TOP_FRAME) {
      iframeRelayBuffer.push(...items);
      if (!iframeRelayTimer) {
        iframeRelayTimer = window.setTimeout(() => {
          const batch = iframeRelayBuffer.splice(0, iframeRelayBuffer.length);
          iframeRelayTimer = null;
          if (batch.length > 0) {
            void sendRuntimeMessage({ type: 'CHAT_BURST', messages: batch });
          }
        }, 250);
      }
      return;
    }

    for (const item of items) {
      messageTimestamps.push(item);
      baselineCount.push(item.ts);
    }
  }

  /**
   * Periodic fallback scanner for virtualized chat lists (especially Kick's
   * react-virtuoso `[data-index]` rows that recycle DOM elements in place).
   */
  function scanVisibleChatEntries(seedOnly = false) {
    if (!observedContainer || !observedContainer.isConnected) return;
    const selector = getMessageNodeSelector();
    if (!selector) return;

    const now = Date.now();
    const batch = [];
    const nodes = observedContainer.querySelectorAll(selector);
    const startIdx = Math.max(0, nodes.length - 40);

    for (let i = startIdx; i < nodes.length; i += 1) {
      const el = nodes[i];
      const text = extractMessageText(el);
      if (!text) continue;
      const key = buildMessageKey(el, text);
      if (seenMessageKeys.has(key)) continue;
      seenMessageKeys.set(key, now);
      seenNodes.add(el);
      if (!seedOnly) {
        batch.push({ ts: now, text: text.slice(0, 240) });
      }
    }

    pruneSeenKeys(now);
    if (!seedOnly && batch.length > 0) {
      recordMessages(batch);
    }
  }

  function attachChatObserver() {
    const container = findChatContainer();
    if (!container) return;
    if (container === observedContainer && observedContainer.isConnected) return;

    if (chatObserver) {
      chatObserver.disconnect();
    }

    observedContainer = container;
    // Seed currently visible historic messages so initial mount doesn't trigger a fake spike
    scanVisibleChatEntries(true);

    const selector = getMessageNodeSelector();
    chatObserver = new MutationObserver((mutations) => {
      const now = Date.now();
      const batch = [];
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isChatMessageNode(node)) {
            collectNewChatMessage(node, now, batch);
          } else if (selector && node.querySelectorAll) {
            const nested = node.querySelectorAll(selector);
            for (const child of nested) {
              collectNewChatMessage(child, now, batch);
            }
          }
        }
      }
      pruneSeenKeys(now);
      if (batch.length > 0) {
        recordMessages(batch);
      }
    });

    // CRITICAL: subtree: true is required on Kick & Twitch because virtualized
    // chat lists insert rows inside nested wrapper divs under #chatroom-messages.
    chatObserver.observe(container, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------------------
  // Top-Frame HUD, Server Health & Clip Triggering
  // -------------------------------------------------------------------------

  async function pingServer() {
    const res = await sendRuntimeMessage({
      type: 'PING_SERVER',
      serverUrl: config.serverUrl,
    });
    serverConnected = Boolean(res.ok);
    updateHudHeader();
    return serverConnected;
  }

  async function triggerClip(source, score, reasons) {
    const now = Date.now();
    const gate = engine.evaluateTriggerGate({
      source,
      nowMs: now,
      lastManualTriggerMs,
      lastAutoTriggerMs,
      lastAlertMs,
      cooldownSecs: config.cooldownSecs,
      manualDebounceSecs: config.manualDebounceSecs,
    });

    if (!gate.allowed) {
      if (source === 'manual') {
        showToast(`Please wait ${gate.retryAfterSecs}s before clipping again`, 'info');
      }
      return { ok: false, throttled: true };
    }

    if (source === 'manual') {
      lastManualTriggerMs = now;
    } else {
      lastAutoTriggerMs = now;
    }

    context = readPageContext();
    setClipButtonBusy(true);

    const playbackUrl = context.isLive ? await resolveLivePlaybackUrl() : '';
    const currentTimeSec = context.isLive ? null : readActiveVideoCurrentTime();
    const videoTitle = readVideoTitle();

    const res = await sendRuntimeMessage({
      type: 'TRIGGER_CLIP',
      serverUrl: config.serverUrl,
      url: window.location.href,
      playback_url: playbackUrl || undefined,
      is_live: Boolean(context.isLive),
      current_time_sec: currentTimeSec ?? undefined,
      video_title: videoTitle || undefined,
      channel: context.channel,
      platform: context.platform,
      template: context.template || 'default',
      lookback_secs: config.lookbackSecs,
      hype_score: score,
      reasons: reasons || [],
    });

    setClipButtonBusy(false);

    if (res.ok) {
      serverConnected = true;
      updateHudHeader();
      showToast(
        `Clipped ${context.channel} (${config.lookbackSecs}s${context.isLive ? ' · LIVE' : ''})`,
        'success'
      );
      return { ok: true, data: res.data };
    }

    serverConnected = false;
    updateHudHeader();
    showToast(res.error || 'PulseCut server offline — start PulseCut first', 'error');
    return { ok: false, error: res.error };
  }

  function showHypeAlertModal(score, reasons) {
    const now = Date.now();
    const gate = engine.evaluateTriggerGate({
      source: 'alert',
      nowMs: now,
      lastAlertMs,
      alertCooldownSecs: config.alertCooldownSecs,
    });
    if (!gate.allowed) return;
    if (document.getElementById('pulsecut-alert-modal')) return;

    lastAlertMs = now;
    const modal = document.createElement('div');
    modal.id = 'pulsecut-alert-modal';
    modal.className = 'pulsecut-alert-toast';
    modal.innerHTML = `
      <div class="pulsecut-alert-header">
        <span class="pulsecut-alert-badge">HYPE SPIKE · ${score}%</span>
        <button type="button" class="pulsecut-alert-close" aria-label="Dismiss">&times;</button>
      </div>
      <div class="pulsecut-alert-title">${escapeHtml(context.channel)} is popping off</div>
      <div class="pulsecut-alert-sub">${escapeHtml((reasons || []).join(' · ') || 'Chat burst detected')}</div>
      <div class="pulsecut-alert-actions">
        <button type="button" class="pulsecut-btn-clip">Clip Last ${config.lookbackSecs}s</button>
        <button type="button" class="pulsecut-btn-dismiss">Dismiss</button>
      </div>
    `;

    const closeModal = () => modal.remove();
    modal.querySelector('.pulsecut-alert-close')?.addEventListener('click', closeModal);
    modal.querySelector('.pulsecut-btn-dismiss')?.addEventListener('click', closeModal);
    modal.querySelector('.pulsecut-btn-clip')?.addEventListener('click', () => {
      closeModal();
      void triggerClip('manual', score, reasons);
    });

    document.body.appendChild(modal);
    window.setTimeout(() => {
      if (modal.isConnected) modal.remove();
    }, 10000);
  }

  function showToast(message, kind = 'info') {
    if (!IS_TOP_FRAME) return;
    const existing = document.getElementById('pulsecut-status-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pulsecut-status-toast';
    toast.className = `pulsecut-toast pulsecut-toast-${kind}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, 3600);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createHud() {
    if (!IS_TOP_FRAME || hudEl || !context.supported) return;

    hudEl = document.createElement('div');
    hudEl.id = 'pulsecut-hud';
    hudEl.innerHTML = `
      <div class="pc-hud-row">
        <span class="pc-hud-dot" id="pc-hud-dot"></span>
        <span class="pc-hud-brand">PulseCut</span>
        <span class="pc-hud-channel" id="pc-hud-channel"></span>
        <button type="button" class="pc-hud-min" id="pc-hud-min" title="Collapse HUD">–</button>
      </div>
      <div class="pc-hud-body" id="pc-hud-body">
        <div class="pc-hud-meter-wrap">
          <div class="pc-hud-meter-label">
            <span>Chat Hype</span>
            <span id="pc-hud-score">0%</span>
          </div>
          <div class="pc-hud-bar-bg">
            <div class="pc-hud-bar-fill" id="pc-hud-bar"></div>
          </div>
          <div class="pc-hud-meta" id="pc-hud-meta">Monitoring stream…</div>
        </div>
        <button type="button" class="pc-hud-clip-btn" id="pc-hud-clip-btn">
          Clip Last ${config.lookbackSecs}s
        </button>
      </div>
    `;

    hudEl.querySelector('#pc-hud-clip-btn')?.addEventListener('click', () => {
      void triggerClip('manual', 100, ['manual']);
    });

    hudEl.querySelector('#pc-hud-min')?.addEventListener('click', () => {
      const body = hudEl.querySelector('#pc-hud-body');
      const minBtn = hudEl.querySelector('#pc-hud-min');
      if (!body || !minBtn) return;
      const collapsed = body.classList.toggle('pc-collapsed');
      minBtn.textContent = collapsed ? '+' : '–';
    });

    document.body.appendChild(hudEl);
    updateHudHeader();
  }

  function removeHud() {
    if (hudEl) {
      hudEl.remove();
      hudEl = null;
    }
  }

  function setClipButtonBusy(busy) {
    if (!hudEl) return;
    const btn = hudEl.querySelector('#pc-hud-clip-btn');
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? 'Sending clip…' : `Clip Last ${config.lookbackSecs}s`;
  }

  function updateHudHeader() {
    if (!hudEl) return;
    const dot = hudEl.querySelector('#pc-hud-dot');
    const channelEl = hudEl.querySelector('#pc-hud-channel');
    const btn = hudEl.querySelector('#pc-hud-clip-btn');
    if (dot) {
      dot.className = `pc-hud-dot ${serverConnected ? 'pc-online' : 'pc-offline'}`;
      dot.title = serverConnected
        ? `Connected to ${config.serverUrl}`
        : `PulseCut server offline (${config.serverUrl})`;
    }
    if (channelEl) {
      channelEl.textContent = context.channel;
      channelEl.title = `${context.platform}${context.isLive ? ' LIVE' : ''} · template: ${context.template}`;
    }
    if (btn && !btn.disabled) {
      btn.textContent = `Clip Last ${config.lookbackSecs}s`;
    }
  }

  let scanTickCounter = 0;

  function evaluateHypeTick() {
    if (!IS_TOP_FRAME) return;

    // Detect SPA route changes (Kick, Twitch, YouTube, Instagram)
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      messageTimestamps = [];
      baselineCount = [];
      observedContainer = null;
      cachedPlaybackUrl = '';
      cachedPlaybackSlug = '';
      seenMessageKeys.clear();
      context = readPageContext();
      if (context.supported && config.mode !== 'off') {
        createHud();
        updateHudHeader();
      } else {
        removeHud();
      }
    }

    // Re-read YouTube / Instagram DOM channel name once hydrated
    const refreshed = readPageContext();
    if (
      refreshed.channel !== context.channel ||
      refreshed.template !== context.template ||
      refreshed.isLive !== context.isLive
    ) {
      context = refreshed;
      updateHudHeader();
    }

    if (config.mode === 'off') {
      removeHud();
      return;
    }

    attachChatObserver();
    scanTickCounter += 1;
    // Poll virtualized chat rows every 1 second so recycled Kick/Twitch nodes never miss messages
    if (scanTickCounter % 2 === 0) {
      scanVisibleChatEntries(false);
    }

    const now = Date.now();
    messageTimestamps = messageTimestamps.filter((m) => now - m.ts <= CHAT_WINDOW_MS);
    baselineCount = baselineCount.filter((ts) => now - ts <= BASELINE_WINDOW_MS);

    const baselineRatePerSec = baselineCount.length / (BASELINE_WINDOW_MS / 1000);
    const analysis = engine.analyzeChatWindow({
      messages: messageTimestamps,
      nowMs: now,
      windowMs: CHAT_WINDOW_MS,
      baselineRatePerSec,
    });

    if (hudEl) {
      const scoreEl = hudEl.querySelector('#pc-hud-score');
      const barEl = hudEl.querySelector('#pc-hud-bar');
      const metaEl = hudEl.querySelector('#pc-hud-meta');
      if (scoreEl) scoreEl.textContent = `${analysis.score}%`;
      if (barEl) {
        barEl.style.width = `${analysis.score}%`;
        barEl.className = `pc-hud-bar-fill ${
          analysis.score >= config.threshold
            ? 'pc-hot'
            : analysis.score >= Math.round(config.threshold * 0.6)
            ? 'pc-warm'
            : ''
        }`;
      }
      if (metaEl) {
        const modeTag = config.mode === 'auto' ? 'Auto' : 'Alert';
        metaEl.textContent =
          analysis.reasons.length > 0
            ? `${modeTag} · ${analysis.reasons.slice(0, 2).join(' · ')}`
            : `${modeTag} · ${analysis.ratePerSec} msg/s · ${context.isLive ? 'LIVE' : 'VOD'}`;
      }
    }

    if (analysis.score >= config.threshold) {
      if (config.mode === 'auto') {
        void triggerClip('auto', analysis.score, analysis.reasons);
      } else if (config.mode === 'alert') {
        showHypeAlertModal(analysis.score, analysis.reasons);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Runtime Messages & Live Storage Sync
  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;

    if (msg.type === 'RELAYED_CHAT_BURST' && IS_TOP_FRAME) {
      recordMessages(Array.isArray(msg.messages) ? msg.messages : []);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'POPUP_TRIGGER_CLIP' && IS_TOP_FRAME) {
      triggerClip('manual', 100, ['popup']).then(sendResponse);
      return true;
    }

    if (msg.type === 'GET_PAGE_CONTEXT' && IS_TOP_FRAME) {
      context = readPageContext();
      sendResponse({
        ok: true,
        context,
        serverConnected,
      });
      return false;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    let urlChanged = false;
    for (const [key, change] of Object.entries(changes)) {
      if (key === 'serverUrl') {
        config.serverUrl = engine.normalizeServerUrl(change.newValue);
        urlChanged = true;
      } else if (key in config) {
        config[key] = change.newValue;
      }
    }
    if (config.mode === 'off') {
      removeHud();
    } else if (IS_TOP_FRAME && context.supported) {
      createHud();
      updateHudHeader();
    }
    if (urlChanged && IS_TOP_FRAME) {
      void pingServer();
    }
  });

  // Keyboard shortcut: Alt+Shift+C to manually clip active stream
  if (IS_TOP_FRAME) {
    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyC') {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        void triggerClip('manual', 100, ['hotkey']);
      }
    });
  }

  // Bootstrap
  chrome.storage.sync.get(engine.DEFAULT_CONFIG, (items) => {
    config = {
      ...engine.DEFAULT_CONFIG,
      ...(items || {}),
      serverUrl: engine.normalizeServerUrl(items?.serverUrl),
    };

    if (IS_TOP_FRAME) {
      if (config.mode !== 'off' && context.supported) {
        createHud();
      }
      void pingServer();
      window.setInterval(evaluateHypeTick, TICK_INTERVAL_MS);
      window.setInterval(() => void pingServer(), 15000);
    } else {
      // Subframe (e.g. YouTube /live_chat iframe): never render HUD, only observe chat
      attachChatObserver();
      window.setInterval(() => {
        attachChatObserver();
        scanVisibleChatEntries(false);
      }, 1200);
    }
  });
})();
