/**
 * PulseCut Auto-Clipper — Popup Controller (Multi-Tab Aware)
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
    tabStats: document.getElementById('tabStats'),
    watchedSection: document.getElementById('watchedSection'),
    watchedCount: document.getElementById('watchedCount'),
    watchedList: document.getElementById('watchedList'),
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

  function formatViewers(v) {
    return engine && engine.formatViewerCount ? engine.formatViewerCount(v) : v ? String(v) : '';
  }

  function setHint(text, kind = '') {
    els.actionHint.textContent = text;
    els.actionHint.className = `hint ${kind}`.trim();
  }

  function syncLabels() {
    els.thresholdVal.textContent = `${els.threshold.value}%`;
    els.lookbackVal.textContent = `${els.lookbackSecs.value}s`;
    els.cooldownVal.textContent = `${els.cooldownSecs.value}s`;
    const apiUrl = normalizeUrl(els.serverUrl.value);
    els.openEditorLink.href =
      /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(apiUrl)
        ? 'http://localhost:3000'
        : apiUrl;
  }

  function pingServer(serverUrl, force = false) {
    els.statusText.textContent = 'Checking…';
    chrome.runtime.sendMessage(
      { type: 'PING_SERVER', serverUrl: normalizeUrl(serverUrl), force },
      (res) => {
        const ok = Boolean(res && res.ok);
        els.statusDot.className = `dot ${ok ? 'ok' : ''}`.trim();
        els.statusText.textContent = ok
          ? `Online${res.clips !== null ? ` · ${res.clips} clips` : ''}`
          : 'Offline';
      }
    );
  }

  function loadWatchedStreams() {
    chrome.runtime.sendMessage({ type: 'GET_WATCHED_STREAMS' }, (res) => {
      if (chrome.runtime.lastError || !res || !Array.isArray(res.streams)) return;
      const streams = res.streams;
      if (streams.length === 0) {
        els.watchedSection.classList.remove('visible');
        return;
      }
      els.watchedSection.classList.add('visible');
      els.watchedCount.textContent = `${streams.length} tab${streams.length === 1 ? '' : 's'}`;
      els.watchedList.innerHTML = '';

      for (const s of streams) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'watched-item';
        const vStr = formatViewers(s.viewerCount);
        const nameSpan = document.createElement('span');
        nameSpan.className = 'watched-name';
        nameSpan.textContent = `${s.platform.toUpperCase()} · ${s.channel}${vStr ? ` (${vStr})` : ''}`;

        const metaSpan = document.createElement('span');
        metaSpan.className = `watched-meta ${s.score >= Number(els.threshold.value) ? 'hot' : ''}`.trim();
        metaSpan.textContent = s.calibrated
          ? `${s.score}% · base ${s.baselineRatePerSec}/s`
          : `cal ${s.calibrationPct}%`;

        btn.appendChild(nameSpan);
        btn.appendChild(metaSpan);
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'FOCUS_TAB', tabId: s.tabId });
        });
        els.watchedList.appendChild(btn);
      }
    });
  }

  function inspectActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      activeTab = tabs && tabs[0] ? tabs[0] : null;
      if (!activeTab || !activeTab.url) {
        els.tabPlatform.textContent = '—';
        els.tabChannel.textContent = 'No active stream tab';
        els.tabStats.textContent = 'Open Kick, YouTube Live, or Twitch';
        els.clipNowBtn.disabled = true;
        return;
      }

      const fallbackCtx = engine
        ? engine.detectStreamContext(activeTab.url)
        : { platform: 'unknown', channel: 'unknown', template: 'default', supported: false };

      const applyContext = (ctx, baseline) => {
        activeContext = ctx;
        if (ctx.supported) {
          els.tabPlatform.textContent = `${ctx.platform.toUpperCase()}${ctx.isLive ? ' · LIVE' : ' · VOD'}`;
          els.tabChannel.textContent = ctx.channel;
          const vStr = formatViewers(baseline?.viewerCount ?? ctx.viewerCount);
          if (baseline) {
            const cal = baseline.calibrated
              ? `base ${baseline.mean}/s · hype ${baseline.score}%`
              : `calibrating ${baseline.calibrationPct}%`;
            els.tabStats.textContent = `${vStr ? `${vStr} watching · ` : ''}${cal}`;
          } else {
            els.tabStats.textContent = vStr ? `${vStr} watching` : 'Adaptive chat baseline active';
          }
          els.clipNowBtn.disabled = false;
        } else {
          els.tabPlatform.textContent = 'UNSUPPORTED';
          els.tabChannel.textContent = 'Open Kick, Twitch, YouTube Live, or Reels';
          els.tabStats.textContent = 'Multi-tab stream monitoring works automatically';
          els.clipNowBtn.disabled = true;
        }
      };

      chrome.tabs.sendMessage(
        activeTab.id,
        { type: 'GET_PAGE_CONTEXT' },
        { frameId: 0 },
        (res) => {
          if (chrome.runtime.lastError || !res || !res.context) {
            applyContext(fallbackCtx, null);
            return;
          }
          applyContext(res.context, res.baseline || null);
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
        pingServer(els.serverUrl.value, true);
      } else {
        setHint((res && res.error) || 'Could not reach PulseCut server', 'err');
      }
    };

    const sendDirectFallback = () => {
      chrome.runtime.sendMessage(
        {
          type: 'TRIGGER_CLIP',
          source: 'manual',
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
    pingServer(els.serverUrl.value, true);
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
    pingServer(cfg.serverUrl, true);
    inspectActiveTab();
    loadWatchedStreams();
  });
})();
