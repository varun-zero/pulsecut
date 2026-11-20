/**
 * PulseCut Auto-Clipper — Lightweight Multi-Tab Content Script
 *
 * Works cleanly across:
 * - Kick (live channels, viewer count via DOM + v2 API, virtualized chatroom, same-origin HLS .m3u8)
 * - YouTube Live & VODs (live badge/chatframe detection, viewer count, /live_chat iframe + custom emoji alt text)
 * - Twitch (live channels, viewer count, VODs & chat)
 * - YouTube Shorts & Instagram Reels (one-click capture + auto-detected creator handle)
 *
 * Multi-tab stability:
 * - 1s adaptive tick cadence with bounded buffers (<= 250 messages, <= 300 dedupe keys)
 * - Skips redundant DOM querySelectorAll fallback whenever MutationObserver is actively firing
 * - Pauses HUD DOM repaints on hidden background tabs while continuing silent auto-clip monitoring
 * - Shares a single cached server health ping via background.js across all open tabs
 */

(function startPulseCutContentScript() {
  'use strict';

  const engine = globalThis.PulseCutHypeEngine;
  if (!engine) return;

  const IS_TOP_FRAME = window === window.top;
  const CHAT_WINDOW_MS = 6000;
  const TICK_INTERVAL_MS = 1000;
  const HEARTBEAT_INTERVAL_MS = 5000;
  const HEALTH_PING_INTERVAL_MS = 20000;
  const MAX_MESSAGE_BUFFER = 250;
  const MAX_SEEN_KEYS = 300;

  let config = { ...engine.DEFAULT_CONFIG };
  let context = readPageContext();
  let baselineState = engine.createBaselineState(Date.now(), context.viewerCount);
  let messageTimestamps = []; // [{ ts, text, author }]
  let lastAutoTriggerMs = 0;
  let lastManualTriggerMs = 0;
  let lastAlertMs = 0;
  let serverConnected = false;
  let hudEl = null;
  let currentUrl = window.location.href;
  let chatObserver = null;
  let observedContainer = null;
  let lastMutationMs = 0;
  let lastHeartbeatMs = 0;
  let lastAnalysis = null;
  let lastViewerCount = context.viewerCount || null;
  let lastKickMetaFetchMs = 0;

  // Deduplication for subtree MutationObserver + virtualized Kick/Twitch chat scanner
  const seenNodes = new WeakSet();
  const seenMessageKeys = new Map(); // key -> timestamp

  // Cached Kick/HLS playback URL & viewer count resolved inside authenticated browser tab
  let cachedPlaybackUrl = '';
  let cachedPlaybackSlug = '';

  // Iframe batch buffer for relaying YouTube /live_chat messages to top frame
  let iframeRelayBuffer = [];
  let iframeRelayTimer = null;

  // Active timers tracked for clean pagehide teardown
  const timers = [];

  // -------------------------------------------------------------------------
  // Viewer Count & Platform DOM Inspection (Kick, YouTube Live, Twitch, IG)
  // -------------------------------------------------------------------------

  function readViewerCountFromDom() {
    const host = window.location.hostname.toLowerCase();

    if (host.includes('youtube.com')) {
      // YouTube Live renders "<N> watching now" inside ytd-video-view-count-renderer / #info-strings
      const candidates = [
        document.querySelector('ytd-video-view-count-renderer .view-count'),
        document.querySelector('ytd-video-view-count-renderer'),
        document.querySelector('#info-strings'),
        document.querySelector('#view-count'),
        document.querySelector('ytd-watch-info-text #tooltip'),
      ];
      for (const el of candidates) {
        if (!el || !el.textContent) continue;
        const txt = el.textContent.trim();
        if (/watching/i.test(txt)) {
          const parsed = engine.parseViewerCount(txt);
          if (parsed !== null) return parsed;
        }
      }
      // Fallback: check live-view-count span on /live/ layout
      const spans = document.querySelectorAll('ytd-watch-metadata yt-formatted-string, #count yt-formatted-string');
      for (let i = 0; i < Math.min(spans.length, 12); i += 1) {
        const txt = (spans[i].textContent || '').trim();
        if (/watching/i.test(txt)) {
          const parsed = engine.parseViewerCount(txt);
          if (parsed !== null) return parsed;
        }
      }
      return null;
    }

    if (host.includes('kick.com')) {
      const selectors = [
        '[data-testid="viewer-count"]',
        '[data-testid="live-viewer-count"]',
        '[aria-label*="viewer" i]',
        '[aria-label*="watching" i]',
        'span[class*="viewer"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const txt = el.getAttribute('aria-label') || el.textContent || '';
        const parsed = engine.parseViewerCount(txt);
        if (parsed !== null) return parsed;
      }
      return lastViewerCount;
    }

    if (host.includes('twitch.tv')) {
      const el =
        document.querySelector('[data-a-target="animated-channel-viewers-count"]') ||
        document.querySelector('p[data-a-target="animated-channel-viewers-count"]') ||
        document.querySelector('[aria-label*="viewers" i]');
      if (el) {
        const parsed = engine.parseViewerCount(el.textContent || el.getAttribute('aria-label') || '');
        if (parsed !== null) return parsed;
      }
      return null;
    }

    return null;
  }

  function readDomHints() {
    const hints = {
      channelName: '',
      channelHandle: '',
      hasLiveBadge: false,
      hasLiveChatFrame: false,
      hasWatchingNow: false,
      viewerCount: null,
    };
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

      // Reliable YouTube Live detection: check live badge, live chat iframe, or "watching now" text
      const liveBadge = document.querySelector('.ytp-live-badge');
      if (liveBadge) {
        const style = window.getComputedStyle(liveBadge);
        const text = (liveBadge.textContent || '').trim().toUpperCase();
        hints.hasLiveBadge =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          liveBadge.offsetWidth > 0 &&
          text.includes('LIVE');
      }

      const chatFrame = document.querySelector('iframe#chatframe, ytd-live-chat-frame iframe');
      if (chatFrame) {
        const src = String(chatFrame.getAttribute('src') || '');
        hints.hasLiveChatFrame =
          src.includes('/live_chat') && !src.includes('/live_chat_replay');
      }

      const viewers = readViewerCountFromDom();
      if (viewers !== null) {
        hints.viewerCount = viewers;
        hints.hasWatchingNow = true;
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
      hints.viewerCount = readViewerCountFromDom();
    } else if (host.includes('twitch.tv')) {
      const heading = document.querySelector('h1.tw-title, [data-a-target="stream-title"]');
      if (heading && heading.textContent) {
        hints.channelName = heading.textContent.trim();
      }
      hints.viewerCount = readViewerCountFromDom();
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
   * Fetches Kick same-origin channel metadata (playback_url + exact live viewer_count)
   * at most once every 30s so baseline calibration knows exact Kick audience size.
   */
  async function refreshKickChannelMetadata(force = false) {
    const slug = engine.extractKickSlug ? engine.extractKickSlug(window.location.href) : '';
    if (!slug) return '';

    const now = Date.now();
    if (!force && cachedPlaybackSlug === slug && now - lastKickMetaFetchMs < 30000) {
      return cachedPlaybackUrl;
    }
    lastKickMetaFetchMs = now;

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
        }
        const vc = engine.parseViewerCount(data?.livestream?.viewer_count);
        if (vc !== null) {
          lastViewerCount = vc;
        }
      }
    } catch {
      // Ignore network hiccups; DOM fallback remains active
    }
    return cachedPlaybackUrl || '';
  }

  /**
   * Resolves a direct HLS `.m3u8` URL inside the authenticated browser tab.
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
      const fetched = await refreshKickChannelMetadata(true);
      if (fetched) return fetched;
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
  // Chat DOM Observation (Kick, Twitch, YouTube Live + Custom Emoji Alt Text)
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

  function extractNodeTextWithEmotes(el) {
    if (!el) return '';
    let text = (el.textContent || '').trim();
    // YouTube Live, Kick, and Twitch render custom emotes/emojis as <img> with alt attributes
    const imgs = el.querySelectorAll ? el.querySelectorAll('img[alt]') : [];
    if (imgs.length > 0) {
      const alts = [];
      for (let i = 0; i < Math.min(imgs.length, 8); i += 1) {
        const alt = (imgs[i].getAttribute('alt') || '').trim();
        if (alt) alts.push(alt);
      }
      if (alts.length > 0) {
        text = text ? `${text} ${alts.join(' ')}` : alts.join(' ');
      }
    }
    return text.trim();
  }

  function extractMessageAuthor(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';

    if (context.platform === 'kick') {
      const authorEl =
        node.querySelector('[data-testid="chat-entry-username"]') ||
        node.querySelector('.chat-entry-username') ||
        node.querySelector('button[title]') ||
        node.querySelector('span[style*="color"]');
      if (authorEl) {
        return (authorEl.getAttribute('title') || authorEl.textContent || '').trim().slice(0, 48);
      }
      const raw = (node.textContent || '').trim();
      const colonIdx = raw.indexOf(':');
      if (colonIdx > 0 && colonIdx < 28) {
        return raw.slice(0, colonIdx).trim();
      }
      return '';
    }

    if (context.platform === 'twitch') {
      const authorEl =
        node.querySelector('[data-a-target="chat-message-username"]') ||
        node.querySelector('.chat-author__display-name');
      return (authorEl?.textContent || '').trim().slice(0, 48);
    }

    if (context.platform === 'youtube') {
      const authorEl = node.querySelector('#author-name');
      return (authorEl?.textContent || '').trim().slice(0, 48);
    }

    return '';
  }

  function extractMessageText(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';

    if (context.platform === 'kick') {
      const msgEl =
        node.querySelector('[data-testid="chat-message-content"]') ||
        node.querySelector('.chat-entry-content') ||
        node.querySelector('span[class*="font-normal"]');
      const raw = msgEl ? extractNodeTextWithEmotes(msgEl) : extractNodeTextWithEmotes(node);
      const colonIdx = raw.indexOf(':');
      if (!msgEl && colonIdx > 0 && colonIdx < 32) {
        return raw.slice(colonIdx + 1).trim();
      }
      return raw;
    }

    if (context.platform === 'twitch') {
      const body = node.querySelector('[data-a-target="chat-line-message-body"]') || node;
      return extractNodeTextWithEmotes(body);
    }

    if (context.platform === 'youtube') {
      const msgEl = node.querySelector('#message') || node;
      return extractNodeTextWithEmotes(msgEl);
    }

    return extractNodeTextWithEmotes(node);
  }

  function getMessageNodeSelector() {
    if (context.platform === 'kick') {
      return '[data-index], [data-chat-entry], [data-testid="chat-entry"], .chat-entry';
    }
    if (context.platform === 'twitch') {
      return '.chat-line__message, [data-a-target="chat-line-message"]';
    }
    if (context.platform === 'youtube') {
      return 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer';
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

  function buildMessageKey(node, author, text) {
    const idx = node.getAttribute?.('data-index') || node.getAttribute?.('data-chat-entry') || node.id || '';
    if (idx) return `${idx}|${text.slice(0, 48)}`;
    return `${author.slice(0, 20)}|${text.slice(0, 64)}`;
  }

  function collectNewChatMessage(node, now, batch) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (seenNodes.has(node)) return;
    const text = extractMessageText(node);
    if (!text) return;
    const author = extractMessageAuthor(node);

    const key = buildMessageKey(node, author, text);
    const prevTs = seenMessageKeys.get(key);
    if (prevTs && now - prevTs < 15000) {
      seenNodes.add(node);
      return;
    }

    seenNodes.add(node);
    seenMessageKeys.set(key, now);
    batch.push({ ts: now, text: text.slice(0, 200), author });
  }

  function pruneSeenKeys(now) {
    if (seenMessageKeys.size <= MAX_SEEN_KEYS) return;
    for (const [k, ts] of seenMessageKeys.entries()) {
      if (now - ts > 20000 || seenMessageKeys.size > MAX_SEEN_KEYS) {
        seenMessageKeys.delete(k);
      }
      if (seenMessageKeys.size <= Math.floor(MAX_SEEN_KEYS * 0.7)) break;
    }
  }

  function recordMessages(items) {
    if (!items.length) return;
    if (!IS_TOP_FRAME) {
      iframeRelayBuffer.push(...items);
      if (iframeRelayBuffer.length > 80) {
        iframeRelayBuffer.splice(0, iframeRelayBuffer.length - 80);
      }
      if (!iframeRelayTimer) {
        iframeRelayTimer = window.setTimeout(() => {
          const batch = iframeRelayBuffer.splice(0, iframeRelayBuffer.length);
          iframeRelayTimer = null;
          if (batch.length > 0) {
            void sendRuntimeMessage({ type: 'CHAT_BURST', messages: batch });
          }
        }, 300);
      }
      return;
    }

    for (const item of items) {
      messageTimestamps.push(item);
    }
    if (messageTimestamps.length > MAX_MESSAGE_BUFFER) {
      messageTimestamps.splice(0, messageTimestamps.length - MAX_MESSAGE_BUFFER);
    }
  }

  /**
   * Periodic fallback scanner for virtualized chat lists (e.g. Kick's
   * react-virtuoso `[data-index]` rows that recycle DOM elements in place).
   */
  function scanVisibleChatEntries(seedOnly = false) {
    if (!observedContainer || !observedContainer.isConnected) return;
    const selector = getMessageNodeSelector();
    if (!selector) return;

    const now = Date.now();
    const batch = [];
    const nodes = observedContainer.querySelectorAll(selector);
    const startIdx = Math.max(0, nodes.length - 30);

    for (let i = startIdx; i < nodes.length; i += 1) {
      const el = nodes[i];
      const text = extractMessageText(el);
      if (!text) continue;
      const author = extractMessageAuthor(el);
      const key = buildMessageKey(el, author, text);
      if (seenMessageKeys.has(key)) continue;
      seenMessageKeys.set(key, now);
      seenNodes.add(el);
      if (!seedOnly) {
        batch.push({ ts: now, text: text.slice(0, 200), author });
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
        lastMutationMs = now;
        recordMessages(batch);
      }
    });

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
      calibrated: source === 'manual' ? true : baselineState.calibrated,
      sustainedHotTicks: source === 'manual' ? 99 : baselineState.consecutiveHotTicks,
      sustainedTicksRequired: config.sustainedTicksRequired || 2,
    });

    if (!gate.allowed) {
      if (source === 'manual' && gate.retryAfterSecs > 0) {
        showToast(`Please wait ${gate.retryAfterSecs}s before clipping again`, 'info');
      }
      return { ok: false, throttled: true, reason: gate.reason };
    }

    if (source === 'manual') {
      lastManualTriggerMs = now;
    } else {
      lastAutoTriggerMs = now;
      baselineState.consecutiveHotTicks = 0;
    }

    context = readPageContext();
    setClipButtonBusy(true);

    const playbackUrl = context.isLive ? await resolveLivePlaybackUrl() : '';
    const currentTimeSec = context.isLive ? null : readActiveVideoCurrentTime();
    const videoTitle = readVideoTitle();

    const res = await sendRuntimeMessage({
      type: 'TRIGGER_CLIP',
      source,
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
      viewer_count: baselineState.viewerCount || context.viewerCount || undefined,
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

    if (res.deduped) {
      return { ok: false, deduped: true };
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
      calibrated: baselineState.calibrated,
      sustainedHotTicks: baselineState.consecutiveHotTicks,
      sustainedTicksRequired: config.sustainedTicksRequired || 2,
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
    if (!IS_TOP_FRAME || document.hidden) return;
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
            <span id="pc-hud-status-label">Calibrating…</span>
            <span id="pc-hud-score">0%</span>
          </div>
          <div class="pc-hud-bar-bg">
            <div class="pc-hud-bar-fill" id="pc-hud-bar"></div>
          </div>
          <div class="pc-hud-meta" id="pc-hud-meta">Learning chat baseline…</div>
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
    if (!hudEl || document.hidden) return;
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
      const vLabel = engine.formatViewerCount(baselineState.viewerCount || context.viewerCount);
      channelEl.textContent = vLabel ? `${context.channel} · ${vLabel}` : context.channel;
      channelEl.title = `${context.platform}${context.isLive ? ' LIVE' : ''}${vLabel ? ` · ${vLabel} watching` : ''}`;
    }
    if (btn && !btn.disabled) {
      btn.textContent = `Clip Last ${config.lookbackSecs}s`;
    }
  }

  function resetStreamStateForNavigation() {
    currentUrl = window.location.href;
    messageTimestamps = [];
    observedContainer = null;
    cachedPlaybackUrl = '';
    cachedPlaybackSlug = '';
    lastViewerCount = null;
    lastKickMetaFetchMs = 0;
    lastMutationMs = 0;
    seenMessageKeys.clear();
    context = readPageContext();
    baselineState = engine.createBaselineState(Date.now(), context.viewerCount);
    if (context.supported && config.mode !== 'off') {
      createHud();
      updateHudHeader();
    } else {
      removeHud();
    }
  }

  function evaluateHypeTick() {
    if (!IS_TOP_FRAME) return;
    const now = Date.now();

    // Detect SPA route changes (Kick, Twitch, YouTube, Instagram)
    if (window.location.href !== currentUrl) {
      resetStreamStateForNavigation();
    }

    // Re-read YouTube / Kick / Twitch DOM hints (channel handle, live status, viewer count)
    const refreshed = readPageContext();
    if (refreshed.viewerCount !== null) {
      lastViewerCount = refreshed.viewerCount;
    } else if (lastViewerCount !== null) {
      refreshed.viewerCount = lastViewerCount;
    }

    // Refresh Kick exact viewer_count & playback_url via same-origin API every 30s
    if (refreshed.platform === 'kick' && refreshed.isLive && now - lastKickMetaFetchMs >= 30000) {
      void refreshKickChannelMetadata(false);
    }

    if (
      refreshed.channel !== context.channel ||
      refreshed.template !== context.template ||
      refreshed.isLive !== context.isLive ||
      refreshed.viewerCount !== context.viewerCount
    ) {
      context = refreshed;
      if (context.supported && config.mode !== 'off' && !hudEl) {
        createHud();
      }
      updateHudHeader();
    }

    if (config.mode === 'off') {
      removeHud();
      return;
    }

    // In Manual Clip mode, skip DOM chat observation completely so the tab stays ultra-lightweight.
    if (config.mode === 'manual') {
      if (chatObserver) {
        chatObserver.disconnect();
        chatObserver = null;
        observedContainer = null;
      }
      if (hudEl && !document.hidden) {
        const scoreEl = hudEl.querySelector('#pc-hud-score');
        const statusLabel = hudEl.querySelector('#pc-hud-status-label');
        const barEl = hudEl.querySelector('#pc-hud-bar');
        const metaEl = hudEl.querySelector('#pc-hud-meta');
        if (scoreEl) scoreEl.textContent = `${config.lookbackSecs || 30}s`;
        if (statusLabel) statusLabel.textContent = 'Manual Clip';
        if (barEl) {
          barEl.style.width = '100%';
          barEl.className = 'pc-hud-bar-fill';
        }
        if (metaEl) {
          metaEl.textContent = `Manual ready · Alt+Shift+C · Use Live Streams for auto`;
        }
      }
      return;
    }

    attachChatObserver();

    // Lightweight fallback scan ONLY when MutationObserver hasn't fired recently
    // (saves CPU when 5-10 stream tabs are open simultaneously)
    if (observedContainer && now - lastMutationMs > 1800) {
      scanVisibleChatEntries(false);
    }

    // Prune rolling 6-second message window
    messageTimestamps = messageTimestamps.filter((m) => now - m.ts <= CHAT_WINDOW_MS);

    // Count messages arriving in the last 1 second for the adaptive baseline tracker
    let lastSecCount = 0;
    const oneSecCutoff = now - 1000;
    for (let i = messageTimestamps.length - 1; i >= 0; i -= 1) {
      if (messageTimestamps[i].ts >= oneSecCutoff) lastSecCount += 1;
      else break;
    }

    baselineState = engine.updateAdaptiveBaseline(
      baselineState,
      lastSecCount,
      context.viewerCount || lastViewerCount,
      now
    );

    const analysis = engine.analyzeChatWindow({
      messages: messageTimestamps,
      nowMs: now,
      windowMs: CHAT_WINDOW_MS,
      baselineRatePerSec: baselineState.mean,
      baselineStdDev: baselineState.stdDev,
      viewerCount: baselineState.viewerCount,
      sustainedHotTicks: baselineState.consecutiveHotTicks,
      calibrated: baselineState.calibrated,
    });

    // Track sustained hot ticks (require 2 consecutive seconds above threshold to auto-clip)
    if (analysis.score >= config.threshold) {
      baselineState.consecutiveHotTicks += 1;
    } else {
      baselineState.consecutiveHotTicks = 0;
    }
    analysis.sustainedHotTicks = baselineState.consecutiveHotTicks;
    lastAnalysis = analysis;

    // Skip HUD DOM repaints on hidden background tabs to stay ultra-lightweight
    if (hudEl && !document.hidden) {
      const scoreEl = hudEl.querySelector('#pc-hud-score');
      const statusLabel = hudEl.querySelector('#pc-hud-status-label');
      const barEl = hudEl.querySelector('#pc-hud-bar');
      const metaEl = hudEl.querySelector('#pc-hud-meta');

      if (scoreEl) scoreEl.textContent = `${analysis.score}%`;
      if (statusLabel) {
        if (!baselineState.calibrated) {
          statusLabel.textContent = `Calibrating ${baselineState.calibrationPct}%`;
        } else if (analysis.spamDampened) {
          statusLabel.textContent = 'Spam Filtered';
        } else if (analysis.score >= config.threshold) {
          statusLabel.textContent = 'HYPE SPIKE';
        } else {
          statusLabel.textContent = 'Chat Hype';
        }
      }
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
        const baseStr = `base ${analysis.baselineRatePerSec}/s`;
        if (analysis.reasons.length > 0 && analysis.score >= 35) {
          metaEl.textContent = `${modeTag} · ${analysis.reasons.slice(0, 2).join(' · ')} (${baseStr})`;
        } else {
          metaEl.textContent = `${modeTag} · ${analysis.ratePerSec}/s vs ${baseStr} · ${
            context.isLive ? 'LIVE' : 'VOD'
          }`;
        }
      }
    }

    // Periodic lightweight multi-tab heartbeat to background coordinator
    if (context.supported && now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatMs = now;
      void sendRuntimeMessage({
        type: 'TAB_HEARTBEAT',
        url: window.location.href,
        platform: context.platform,
        channel: context.channel,
        isLive: context.isLive,
        viewerCount: baselineState.viewerCount,
        score: analysis.score,
        ratePerSec: analysis.ratePerSec,
        baselineRatePerSec: analysis.baselineRatePerSec,
        calibrated: baselineState.calibrated,
        calibrationPct: baselineState.calibrationPct,
      });
    }

    // Trigger only when calibrated + sustained above threshold!
    if (
      analysis.score >= config.threshold &&
      baselineState.calibrated &&
      baselineState.consecutiveHotTicks >= (config.sustainedTicksRequired || 2)
    ) {
      if (config.mode === 'auto') {
        void triggerClip('auto', analysis.score, analysis.reasons);
      } else if (config.mode === 'alert') {
        showHypeAlertModal(analysis.score, analysis.reasons);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Runtime Messages, Storage Sync & Clean Teardown
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
      if (lastViewerCount !== null && context.viewerCount === null) {
        context.viewerCount = lastViewerCount;
      }
      sendResponse({
        ok: true,
        context,
        baseline: {
          viewerCount: baselineState.viewerCount,
          mean: baselineState.mean,
          calibrated: baselineState.calibrated,
          calibrationPct: baselineState.calibrationPct,
          score: lastAnalysis ? lastAnalysis.score : 0,
        },
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

  function cleanup() {
    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
    for (const id of timers) {
      window.clearInterval(id);
    }
    timers.length = 0;
    if (iframeRelayTimer) {
      window.clearTimeout(iframeRelayTimer);
      iframeRelayTimer = null;
    }
  }

  window.addEventListener('pagehide', cleanup);

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
      if (context.platform === 'kick' && context.isLive) {
        void refreshKickChannelMetadata(true);
      }
      void pingServer();
      timers.push(window.setInterval(evaluateHypeTick, TICK_INTERVAL_MS));
      timers.push(window.setInterval(() => void pingServer(), HEALTH_PING_INTERVAL_MS));
    } else if (context.isChatIframe) {
      // Subframe (e.g. YouTube /live_chat iframe): never render HUD, only observe chat cleanly
      attachChatObserver();
      timers.push(
        window.setInterval(() => {
          attachChatObserver();
          if (observedContainer && Date.now() - lastMutationMs > 2500) {
            scanVisibleChatEntries(false);
          }
        }, 2000)
      );
    }
  });
})();
