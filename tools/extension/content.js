// PulseCut Live Chat Hype Monitor - Content Script
(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__PULSECUT_INJECTED__) return;
  window.__PULSECUT_INJECTED__ = true;

  const DEFAULT_CONFIG = {
    serverUrl: 'http://127.0.0.1:8756',
    lookbackSecs: 30,
    sensitivityThreshold: 70, // Hype score out of 100 to trigger
    autoClipMode: 'ask',       // 'ask' | 'auto' | 'manual'
    cooldownSecs: 45
  };

  let cfg = { ...DEFAULT_CONFIG };
  try {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(DEFAULT_CONFIG, (items) => {
        cfg = { ...DEFAULT_CONFIG, ...items };
      });
    }
  } catch (_) {}

  // State
  let platform = 'unknown';
  let channel = '';
  let messageTimestamps = []; // Timestamps of recent messages (ms)
  let keywordHits = 0;
  let emoteHits = 0;
  let lastTriggerTime = 0;
  let isServerOnline = false;
  let hudEl = null;

  const HYPE_KEYWORDS = [
    'pog', 'poggers', 'kekw', 'lmao', 'lol', 'omg', 'wtf', 'w', 'goat',
    'insane', 'clip it', 'clipped', 'sheesh', 'holy', 'no way', 'fire', 'gg'
  ];

  // 1. Detect platform and channel
  function detectPlatform() {
    const host = window.location.hostname;
    const path = window.location.pathname;

    if (host.includes('twitch.tv')) {
      platform = 'twitch';
      const parts = path.split('/').filter(Boolean);
      channel = parts[0] || 'twitch_stream';
    } else if (host.includes('youtube.com')) {
      platform = 'youtube';
      const params = new URLSearchParams(window.location.search);
      channel = params.get('v') || path.split('/').filter(Boolean).pop() || 'youtube_live';
    } else if (host.includes('kick.com')) {
      platform = 'kick';
      const parts = path.split('/').filter(Boolean);
      channel = parts[0] || 'kick_stream';
    }
  }

  detectPlatform();

  // 2. Ping PulseCut local server health
  async function checkServerHealth() {
    try {
      const res = await fetch(`${cfg.serverUrl}/api/extension/status`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-cache'
      });
      if (res.ok) {
        const data = await res.json();
        isServerOnline = data.ok === true;
      } else {
        isServerOnline = false;
      }
    } catch (_) {
      isServerOnline = false;
    }
    updateHudStatus();
  }

  // Periodic health check
  setInterval(checkServerHealth, 5000);
  checkServerHealth();

  // 3. Measure Chat Hype Engine
  function recordChatMessage(text, emoteCount = 0) {
    const now = Date.now();
    messageTimestamps.push(now);
    emoteHits += emoteCount;

    const lower = (text || '').toLowerCase();
    for (const kw of HYPE_KEYWORDS) {
      if (lower.includes(kw)) {
        keywordHits++;
      }
    }

    // Prune messages older than 60 seconds
    const cutoff = now - 60000;
    while (messageTimestamps.length > 0 && messageTimestamps[0] < cutoff) {
      messageTimestamps.shift();
    }
  }

  function calculateHype() {
    const now = Date.now();
    const cutoff5s = now - 5000;
    const cutoff30s = now - 30000;

    // Messages in last 5 seconds and last 30 seconds
    let count5s = 0;
    let count30s = 0;
    for (let i = messageTimestamps.length - 1; i >= 0; i--) {
      const ts = messageTimestamps[i];
      if (ts >= cutoff5s) count5s++;
      if (ts >= cutoff30s) count30s++;
    }

    const velocity = count5s / 5.0; // msgs per second
    const baseline = Math.max(1.0, count30s / 30.0); // msgs per second baseline
    const ratio = velocity / baseline;

    // Hype score calculation (0 - 100)
    // Combines spike multiplier ratio, raw velocity, and keyword excitement
    let score = 0;
    if (velocity >= 1.5) {
      score = Math.min(100, Math.round(
        (ratio * 25) +
        (Math.min(velocity, 25) * 2.2) +
        (Math.min(keywordHits, 10) * 3)
      ));
    }

    // Decay keyword / emote hits slowly
    keywordHits = Math.max(0, keywordHits * 0.92);
    emoteHits = Math.max(0, emoteHits * 0.90);

    return {
      score: Math.min(100, Math.max(0, score)),
      velocity: velocity.toFixed(1),
      count5s,
      ratio: ratio.toFixed(1)
    };
  }

  // 4. Trigger PulseCut Clipping Job
  async function triggerClip(reasons = ['Chat reaction spike']) {
    const now = Date.now();
    if (now - lastTriggerTime < cfg.cooldownSecs * 1000) {
      return { success: false, reason: 'In cooldown' };
    }
    lastTriggerTime = now;

    const clipBtn = document.getElementById('pulsecut-btn-clip');
    if (clipBtn) {
      clipBtn.classList.add('clipping');
      clipBtn.innerText = '⏳ Clipping...';
    }

    try {
      const payload = {
        url: window.location.href,
        channel: channel || 'streamer',
        platform: platform,
        lookback_secs: Number(cfg.lookbackSecs) || 30,
        hype_score: calculateHype().score / 100.0,
        reasons: reasons
      };

      const res = await fetch(`${cfg.serverUrl}/api/extension/clip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        showNotificationToast('✅ Clip Triggered!', `PulseCut is capturing the last ${cfg.lookbackSecs}s.`, true);
        return { success: true, data };
      } else {
        const err = await res.text();
        showNotificationToast('❌ Clip Failed', `Server error: ${err.slice(0, 100)}`, false);
        return { success: false, reason: err };
      }
    } catch (err) {
      showNotificationToast('⚠️ PulseCut Offline', `Could not reach ${cfg.serverUrl}. Is PulseCut running?`, false);
      return { success: false, reason: err.message };
    } finally {
      if (clipBtn) {
        clipBtn.classList.remove('clipping');
        clipBtn.innerText = `🔥 Clip Last ${cfg.lookbackSecs}s`;
      }
    }
  }

  // 5. Toast alerts
  function showHypeAlertModal(hype) {
    const existing = document.getElementById('pulsecut-alert-modal');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pulsecut-alert-modal';
    toast.className = 'pulsecut-alert-toast';
    toast.innerHTML = `
      <div class="pulsecut-alert-title">
        🔥 <span>Chat Going Crazy! (${hype.score}% Hype)</span>
      </div>
      <div class="pulsecut-alert-desc">
        Chat velocity spiked to <strong>${hype.velocity} msg/s</strong> (${hype.ratio}x baseline)! Clip the last ${cfg.lookbackSecs} seconds?
      </div>
      <div class="pulsecut-alert-actions">
        <button class="pulsecut-btn-clip-now" id="pulsecut-toast-clip">🔥 Clip Now (${cfg.lookbackSecs}s)</button>
        <button class="pulsecut-btn-dismiss" id="pulsecut-toast-dismiss">Dismiss</button>
      </div>
    `;

    document.body.appendChild(toast);

    toast.querySelector('#pulsecut-toast-clip').onclick = () => {
      triggerClip([`Chat spiked to ${hype.velocity} msg/s (${hype.score}% hype)`]);
      toast.remove();
    };

    toast.querySelector('#pulsecut-toast-dismiss').onclick = () => {
      toast.remove();
    };

    // Auto dismiss after 12s
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 12000);
  }

  function showNotificationToast(title, desc, isSuccess) {
    const existing = document.getElementById('pulsecut-toast-status');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'pulsecut-toast-status';
    toast.className = 'pulsecut-alert-toast';
    toast.style.borderColor = isSuccess ? '#10b981' : '#ef4444';
    toast.innerHTML = `
      <div class="pulsecut-alert-title" style="color: ${isSuccess ? '#34d399' : '#f87171'}">
        ${title}
      </div>
      <div class="pulsecut-alert-desc">
        ${desc}
      </div>
      ${isSuccess ? `<a href="${cfg.serverUrl}" target="_blank" style="font-size: 11px; color: #818cf8; text-decoration: underline; font-weight: 600;">Open PulseCut Editor &rarr;</a>` : ''}
    `;

    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 6000);
  }

  // 6. UI HUD Widget
  function injectHud() {
    if (document.getElementById('pulsecut-hud')) return;

    hudEl = document.createElement('div');
    hudEl.id = 'pulsecut-hud';
    hudEl.innerHTML = `
      <div class="pulsecut-header">
        <div class="pulsecut-brand">
          <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <span>PulseCut</span>
          <span id="pulsecut-status-dot" class="pulsecut-status-dot ${isServerOnline ? '' : 'offline'}" title="${isServerOnline ? 'Connected to local PulseCut' : 'PulseCut Offline'}"></span>
        </div>
        <div class="pulsecut-controls-top">
          <button class="pulsecut-icon-btn" id="pulsecut-btn-min" title="Minimize">−</button>
        </div>
      </div>
      <div class="pulsecut-body">
        <div class="pulsecut-gauge-row">
          <span>Hype Meter</span>
          <span class="pulsecut-gauge-val" id="pulsecut-gauge-text">0%</span>
        </div>
        <div class="pulsecut-bar-track">
          <div class="pulsecut-bar-fill" id="pulsecut-bar"></div>
        </div>
        <div class="pulsecut-stats-grid">
          <div class="pulsecut-stat-item">
            <span class="pulsecut-stat-label">Velocity</span>
            <span class="pulsecut-stat-value" id="pulsecut-stat-vel">0.0/s</span>
          </div>
          <div class="pulsecut-stat-item">
            <span class="pulsecut-stat-label">Lookback</span>
            <span class="pulsecut-stat-value">${cfg.lookbackSecs}s</span>
          </div>
        </div>
        <button class="pulsecut-action-btn" id="pulsecut-btn-clip">
          🔥 Clip Last ${cfg.lookbackSecs}s
        </button>
      </div>
    `;

    document.body.appendChild(hudEl);

    // Minimize toggle
    const minBtn = hudEl.querySelector('#pulsecut-btn-min');
    minBtn.onclick = (e) => {
      e.stopPropagation();
      hudEl.classList.toggle('pulsecut-minimized');
      minBtn.innerText = hudEl.classList.contains('pulsecut-minimized') ? '+' : '−';
    };

    hudEl.onclick = () => {
      if (hudEl.classList.contains('pulsecut-minimized')) {
        hudEl.classList.remove('pulsecut-minimized');
        minBtn.innerText = '−';
      }
    };

    // Manual Clip Button
    hudEl.querySelector('#pulsecut-btn-clip').onclick = (e) => {
      e.stopPropagation();
      triggerClip(['Manual button clip']);
    };
  }

  function updateHudStatus() {
    const dot = document.getElementById('pulsecut-status-dot');
    if (dot) {
      if (isServerOnline) {
        dot.classList.remove('offline');
        dot.title = 'Connected to PulseCut (127.0.0.1:8756)';
      } else {
        dot.classList.add('offline');
        dot.title = 'PulseCut server is offline (start pulsecut editor)';
      }
    }
  }

  // 7. Update HUD & Evaluate Triggers Every 500ms
  setInterval(() => {
    const hype = calculateHype();

    const gaugeText = document.getElementById('pulsecut-gauge-text');
    const bar = document.getElementById('pulsecut-bar');
    const velText = document.getElementById('pulsecut-stat-vel');

    if (gaugeText) gaugeText.innerText = `${hype.score}%`;
    if (velText) velText.innerText = `${hype.velocity}/s`;
    if (bar) {
      bar.style.width = `${hype.score}%`;
      if (hype.score >= 70) {
        bar.classList.add('fire');
      } else {
        bar.classList.remove('fire');
      }
    }

    // Trigger check
    const now = Date.now();
    if (hype.score >= cfg.sensitivityThreshold && (now - lastTriggerTime > cfg.cooldownSecs * 1000)) {
      if (cfg.autoClipMode === 'auto') {
        triggerClip([`Auto-triggered: hype reached ${hype.score}% (${hype.velocity} msg/s)`]);
      } else if (cfg.autoClipMode === 'ask') {
        showHypeAlertModal(hype);
      }
    }
  }, 500);

  // 8. Chat DOM Observers for Twitch, YouTube Live, and Kick
  function setupChatObserver() {
    let observed = false;

    // Twitch
    const twitchContainer = document.querySelector('.chat-scrollable-area__message-container') ||
                            document.querySelector('[data-a-target="chat-scroller"]');
    if (twitchContainer && !twitchContainer.__pc_observed) {
      twitchContainer.__pc_observed = true;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const textEl = node.querySelector('[data-a-target="chat-message-text"]') || node;
              const emotes = node.querySelectorAll('img.chat-image').length;
              recordChatMessage(textEl.textContent || '', emotes);
            }
          }
        }
      });
      observer.observe(twitchContainer, { childList: true, subtree: true });
      observed = true;
    }

    // YouTube Live
    const ytItems = document.querySelector('yt-live-chat-item-list-renderer #items') ||
                    document.querySelector('#item-list #items');
    if (ytItems && !ytItems.__pc_observed) {
      ytItems.__pc_observed = true;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const msgEl = node.querySelector('#message');
              const emotes = node.querySelectorAll('img.emoji').length;
              recordChatMessage(msgEl ? msgEl.textContent : node.textContent, emotes);
            }
          }
        }
      });
      observer.observe(ytItems, { childList: true, subtree: true });
      observed = true;
    }

    // Kick
    const kickContainer = document.querySelector('#chatroom-messages') ||
                          document.querySelector('.chat-messages');
    if (kickContainer && !kickContainer.__pc_observed) {
      kickContainer.__pc_observed = true;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const textEl = node.querySelector('.chat-entry') || node;
              const emotes = node.querySelectorAll('img').length;
              recordChatMessage(textEl.textContent || '', emotes);
            }
          }
        }
      });
      observer.observe(kickContainer, { childList: true, subtree: true });
      observed = true;
    }

    return observed;
  }

  // Poll for chat elements (since SPA frameworks load them asynchronously)
  function init() {
    detectPlatform();
    injectHud();

    const checkInterval = setInterval(() => {
      setupChatObserver();
    }, 2000);

    // Initial check
    setupChatObserver();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
