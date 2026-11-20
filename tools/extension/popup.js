/**
 * PulseCut Auto-Clipper — Popup Controller
 */
(function initPulseCutPopup() {
  'use strict';

  const engine = globalThis.PulseCutHypeEngine;
  const DEFAULTS = engine ? engine.DEFAULT_CONFIG : {
    serverUrl: 'http://127.0.0.1:8756',
    mode: 'auto',
    threshold: 55,
    lookbackSecs: 30,
    cooldownSecs: 45,
  };

  const els = {
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    tabPlatform: document.getElementById('tabPlatform'),
    tabChannel: document.getElementById('tabChannel'),
    clipNowBtn: document.getElementById('clipNowBtn'),
    actionHint: document.getElementById('actionHint'),
    mode: document.getElementById('mode'),
    threshold: document.getElementById('threshold'),
    thresholdVal: document.getElementById('thresholdVal'),
    lookbackSecs: document.getElementById('lookbackSecs'),
    lookbackVal: document.getElementById('lookbackVal'),
    cooldownSecs: document.getElementById('cooldownSecs'),
    cooldownVal: document.getElementById('cooldownVal'),
    serverUrl: document.getElementById('serverUrl'),
    openEditorLink: document.getElementById('openEditorLink'),
    saveStatus: document.getElementById('saveStatus'),
  };

  let activeTab = null;
  let activeContext = null;
  let saveTimer = null;

  function normalizeUrl(raw) {
    return engine ? engine.normalizeServerUrl(raw) : String(raw || DEFAULTS.serverUrl).replace(/\/+$/, '');
  }

  function setHint(text, kind = '') {
    els.actionHint.textContent = text;
    els.actionHint.className = `hint ${kind}`.trim();
  }

  function syncLabels() {
    els.thresholdVal.textContent = `${els.threshold.value}%`;
    els.lookbackVal.textContent = `${els.lookbackSecs.value}s`;
    els.cooldownVal.textContent = `${els.cooldownSecs.value}s`;
    els.openEditorLink.href = normalizeUrl(els.serverUrl.value);
  }

  function pingServer(serverUrl) {
    els.statusText.textContent = 'Checking…';
    chrome.runtime.sendMessage(
      { type: 'PING_SERVER', serverUrl: normalizeUrl(serverUrl) },
      (res) => {
        const ok = Boolean(res && res.ok);
        els.statusDot.className = `dot ${ok ? 'ok' : ''}`.trim();
        els.statusText.textContent = ok
          ? `Online${res.clips !== null ? ` · ${res.clips} clips` : ''}`
          : 'Offline';
      }
    );
  }

  function inspectActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      activeTab = tabs && tabs[0] ? tabs[0] : null;
      if (!activeTab || !activeTab.url) {
        els.tabPlatform.textContent = '—';
        els.tabChannel.textContent = 'No active stream tab';
        els.clipNowBtn.disabled = true;
        return;
      }

      const fallbackCtx = engine
        ? engine.detectStreamContext(activeTab.url)
        : { platform: 'unknown', channel: 'unknown', template: 'default', supported: false };

      const applyContext = (ctx) => {
        activeContext = ctx;
        if (ctx.supported) {
          els.tabPlatform.textContent = `${ctx.platform.toUpperCase()} · ${ctx.template}`;
          els.tabChannel.textContent = ctx.channel;
          els.clipNowBtn.disabled = false;
        } else {
          els.tabPlatform.textContent = 'UNSUPPORTED';
          els.tabChannel.textContent = 'Open Kick, Twitch, YouTube, or Instagram';
          els.clipNowBtn.disabled = true;
        }
      };

      // Ask the content script first so YouTube / Instagram DOM-extracted handles are accurate
      chrome.tabs.sendMessage(
        activeTab.id,
        { type: 'GET_PAGE_CONTEXT' },
        { frameId: 0 },
        (res) => {
          if (chrome.runtime.lastError || !res || !res.context) {
            applyContext(fallbackCtx);
            return;
          }
          applyContext(res.context);
        }
      );
    });
  }

  function saveSettings() {
    syncLabels();
    const payload = {
      mode: els.mode.value,
      threshold: Number(els.threshold.value),
      lookbackSecs: Number(els.lookbackSecs.value),
      cooldownSecs: Number(els.cooldownSecs.value),
      serverUrl: normalizeUrl(els.serverUrl.value),
    };

    chrome.storage.sync.set(payload, () => {
      els.saveStatus.textContent = 'Saved';
      els.saveStatus.className = 'hint ok';
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        els.saveStatus.textContent = '';
      }, 1500);
    });
  }

  els.clipNowBtn.addEventListener('click', () => {
    if (!activeTab || !activeContext || !activeContext.supported) return;
    els.clipNowBtn.disabled = true;
    els.clipNowBtn.textContent = 'Sending clip…';
    setHint('Extracting stream & contacting PulseCut…');

    const finish = (res) => {
      els.clipNowBtn.disabled = false;
      els.clipNowBtn.textContent = 'Clip Active Tab Now';
      if (res && res.ok) {
        setHint(`Queued ${activeContext.channel} (${els.lookbackSecs.value}s)`, 'ok');
        pingServer(els.serverUrl.value);
      } else {
        setHint((res && res.error) || 'Could not reach PulseCut server', 'err');
      }
    };

    const sendDirectFallback = () => {
      chrome.runtime.sendMessage(
        {
          type: 'TRIGGER_CLIP',
          serverUrl: normalizeUrl(els.serverUrl.value),
          url: activeTab.url,
          is_live: Boolean(activeContext.isLive),
          channel: activeContext.channel,
          platform: activeContext.platform,
          template: activeContext.template || 'default',
          lookback_secs: Number(els.lookbackSecs.value) || 30,
          hype_score: 100,
          reasons: ['popup'],
        },
        finish
      );
    };

    // Prefer content.js so Kick's same-origin live playback_url (.m3u8) and
    // YouTube/Twitch VOD currentTime are captured from the active page.
    chrome.tabs.sendMessage(
      activeTab.id,
      { type: 'POPUP_TRIGGER_CLIP' },
      { frameId: 0 },
      (res) => {
        if (chrome.runtime.lastError || !res) {
          sendDirectFallback();
          return;
        }
        finish(res);
      }
    );
  });

  [els.mode, els.threshold, els.lookbackSecs, els.cooldownSecs].forEach((input) => {
    input.addEventListener('input', saveSettings);
    input.addEventListener('change', saveSettings);
  });

  els.serverUrl.addEventListener('change', () => {
    saveSettings();
    pingServer(els.serverUrl.value);
  });

  // Load initial settings
  chrome.storage.sync.get(DEFAULTS, (items) => {
    const cfg = { ...DEFAULTS, ...(items || {}) };
    els.mode.value = cfg.mode;
    els.threshold.value = String(cfg.threshold);
    els.lookbackSecs.value = String(cfg.lookbackSecs);
    els.cooldownSecs.value = String(cfg.cooldownSecs);
    els.serverUrl.value = normalizeUrl(cfg.serverUrl);
    syncLabels();
    pingServer(cfg.serverUrl);
    inspectActiveTab();
  });
})();
