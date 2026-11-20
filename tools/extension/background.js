/**
 * PulseCut Auto-Clipper — Manifest V3 Background Service Worker
 *
 * Responsibilities:
 * 1. Shared cached health checks (/api/extension/status) so 10 open stream tabs
 *    make 1 health ping total instead of 10.
 * 2. Multi-tab clip dispatch queue (max 2 in-flight + per-channel auto-clip dedupe)
 *    so simultaneous hype spikes across multiple streams never overload Chrome or PulseCut.
 * 3. Active watched streams registry (TAB_HEARTBEAT / GET_WATCHED_STREAMS) for the popup.
 * 4. Relay chat bursts observed inside YouTube /live_chat iframes to frame 0 of the same tab.
 */

const DEFAULT_SETTINGS = {
  serverUrl: 'http://127.0.0.1:8756',
  mode: 'manual', // 'manual' | 'auto' | 'alert' | 'off'
  threshold: 55,
  lookbackSecs: 30,
  cooldownSecs: 45,
};

const HEALTH_CACHE_TTL_MS = 8000;
const TAB_STALE_TTL_MS = 30000;
const MAX_CONCURRENT_DISPATCHES = 2;

// Cached server status shared across all tabs
let healthCache = {
  serverUrl: '',
  checkedAtMs: 0,
  result: null,
  inFlight: null,
};

// Active monitored stream tabs: tabId -> telemetry snapshot
const watchedTabs = new Map();

// Per-channel last auto-clip timestamp to prevent duplicate tabs of the same stream double-clipping
const channelLastAutoClipMs = new Map();

// Bounded FIFO dispatch queue for /api/extension/clip
let activeDispatches = 0;
const dispatchQueue = [];

// Self-contained SVG data URI so chrome.notifications never fails on a missing icon file.
const NOTIFICATION_ICON_DATA_URI =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
      '<rect width="128" height="128" rx="28" fill="#09090B"/>' +
      '<path d="M24 66h22l12-26 14 52 12-26h20" fill="none" stroke="#53FC18" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>'
  );

function normalizeServerUrl(url) {
  const cleaned = String(url || DEFAULT_SETTINGS.serverUrl).trim().replace(/\/+$/, '');
  if (!cleaned) return DEFAULT_SETTINGS.serverUrl;
  return /^https?:\/\//i.test(cleaned) ? cleaned : `http://${cleaned}`;
}

async function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      resolve({
        ...DEFAULT_SETTINGS,
        ...(items || {}),
        serverUrl: normalizeServerUrl(items?.serverUrl || DEFAULT_SETTINGS.serverUrl),
      });
    });
  });
}

// Non-destructive install/update: only fill missing keys so user config is preserved.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS), (existing) => {
    const patch = {};
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
      if (existing[key] === undefined) {
        patch[key] = val;
      }
    }
    if (Object.keys(patch).length > 0) {
      chrome.storage.sync.set(patch);
    }
  });
});

// Clean up closed tabs immediately from watchedTabs
chrome.tabs.onRemoved.addListener((tabId) => {
  watchedTabs.delete(tabId);
});

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: data.error || data.message || `HTTP ${res.status}`,
        data,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: isAbort ? 'Request timed out — is PulseCut running?' : String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function pingServerCached(rawUrl, forceRefresh = false) {
  const base = normalizeServerUrl(rawUrl);
  const now = Date.now();

  if (
    !forceRefresh &&
    healthCache.serverUrl === base &&
    healthCache.result &&
    now - healthCache.checkedAtMs < HEALTH_CACHE_TTL_MS
  ) {
    return healthCache.result;
  }

  if (healthCache.inFlight && healthCache.serverUrl === base) {
    return healthCache.inFlight;
  }

  healthCache.serverUrl = base;
  healthCache.inFlight = (async () => {
    const res = await fetchJsonWithTimeout(`${base}/api/extension/status`, { method: 'GET' }, 3500);
    const out = {
      ok: Boolean(res.ok && res.data && res.data.ok !== false),
      serverUrl: base,
      version: res.data?.version || null,
      clips: res.data?.clips ?? null,
      jobs: res.data?.jobs ?? null,
      activeJobs: res.data?.active_jobs ?? null,
      error: res.ok ? null : res.error,
    };
    healthCache.checkedAtMs = Date.now();
    healthCache.result = out;
    healthCache.inFlight = null;
    return out;
  })();

  return healthCache.inFlight;
}

function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: NOTIFICATION_ICON_DATA_URI,
      title,
      message,
      priority: 1,
    });
  } catch {
    // Ignore environments where desktop notifications are disabled
  }
}

function enqueueDispatch(taskFn) {
  return new Promise((resolve) => {
    const runNext = () => {
      if (activeDispatches >= MAX_CONCURRENT_DISPATCHES || dispatchQueue.length === 0) return;
      const next = dispatchQueue.shift();
      activeDispatches += 1;
      Promise.resolve()
        .then(next.fn)
        .then(next.resolve)
        .catch((err) => next.resolve({ ok: false, error: String(err?.message || err) }))
        .finally(() => {
          activeDispatches = Math.max(0, activeDispatches - 1);
          runNext();
        });
    };
    dispatchQueue.push({ fn: taskFn, resolve });
    runNext();
  });
}

function pruneWatchedTabs() {
  const now = Date.now();
  for (const [tabId, entry] of watchedTabs.entries()) {
    if (now - entry.lastSeenMs > TAB_STALE_TTL_MS) {
      watchedTabs.delete(tabId);
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  // 1. Shared cached health check proxy
  if (msg.type === 'PING_SERVER') {
    (async () => {
      const settings = await getStoredSettings();
      const base = normalizeServerUrl(msg.serverUrl || settings.serverUrl);
      const out = await pingServerCached(base, Boolean(msg.force));
      sendResponse(out);
    })();
    return true;
  }

  // 2. Clip trigger proxy with bounded concurrency & cross-tab channel deduplication
  if (msg.type === 'TRIGGER_CLIP') {
    (async () => {
      const settings = await getStoredSettings();
      const base = normalizeServerUrl(msg.serverUrl || settings.serverUrl);
      const isAuto = msg.source === 'auto';
      const channelKey = `${String(msg.platform || 'unknown').toLowerCase()}:${String(
        msg.channel || 'unknown'
      ).toLowerCase()}`;

      // Cross-tab deduplication: if the user opened the same stream in 2 tabs,
      // prevent both tabs from triggering an auto-clip for the same spike.
      if (isAuto) {
        const now = Date.now();
        const prev = channelLastAutoClipMs.get(channelKey) || 0;
        const cooldownMs = Math.max(15, Number(settings.cooldownSecs) || 45) * 1000;
        if (now - prev < cooldownMs) {
          sendResponse({
            ok: false,
            deduped: true,
            error: `Already clipped ${msg.channel} in another tab`,
          });
          return;
        }
        channelLastAutoClipMs.set(channelKey, now);
      }

      const payload = {
        url: msg.url,
        playback_url: msg.playback_url || undefined,
        is_live: Boolean(msg.is_live),
        current_time_sec:
          typeof msg.current_time_sec === 'number' && Number.isFinite(msg.current_time_sec)
            ? msg.current_time_sec
            : undefined,
        video_title: msg.video_title || undefined,
        channel: msg.channel || 'unknown',
        platform: msg.platform || 'unknown',
        template: msg.template || 'default',
        lookback_secs: Number(msg.lookback_secs ?? settings.lookbackSecs) || 30,
        hype_score: Number(msg.hype_score ?? 100),
        viewer_count:
          typeof msg.viewer_count === 'number' && Number.isFinite(msg.viewer_count)
            ? Math.round(msg.viewer_count)
            : undefined,
        reasons: Array.isArray(msg.reasons) ? msg.reasons : [],
      };

      const res = await enqueueDispatch(() =>
        fetchJsonWithTimeout(
          `${base}/api/extension/clip`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          12000
        )
      );

      if (res.ok) {
        // Invalidate health cache so clip/job counts update immediately
        healthCache.checkedAtMs = 0;
        if (msg.notify !== false) {
          showNotification(
            `PulseCut · Clipping ${payload.channel}`,
            `Capturing ${payload.lookback_secs}s (${payload.platform} · hype ${Math.round(
              payload.hype_score
            )}%)`
          );
        }
        sendResponse({
          ok: true,
          job_id: res.data?.job_id || null,
          message: res.data?.message || 'Clip job queued in PulseCut',
          data: res.data,
        });
      } else {
        if (isAuto) {
          // Release channel lock on network failure so retry is possible
          channelLastAutoClipMs.delete(channelKey);
        }
        sendResponse({
          ok: false,
          error: res.error || 'PulseCut server unreachable',
        });
      }
    })();
    return true;
  }

  // 3. Relay chat messages from YouTube /live_chat iframe to top-frame HUD in the same tab
  if (msg.type === 'CHAT_BURST' && sender?.tab?.id !== undefined) {
    chrome.tabs.sendMessage(
      sender.tab.id,
      {
        type: 'RELAYED_CHAT_BURST',
        messages: Array.isArray(msg.messages) ? msg.messages : [],
      },
      { frameId: 0 },
      () => {
        void chrome.runtime.lastError;
      }
    );
    sendResponse({ ok: true });
    return false;
  }

  // 4. Multi-tab heartbeat from stream content scripts
  if (msg.type === 'TAB_HEARTBEAT' && sender?.tab?.id !== undefined) {
    watchedTabs.set(sender.tab.id, {
      tabId: sender.tab.id,
      windowId: sender.tab.windowId,
      url: msg.url || sender.tab.url || '',
      platform: msg.platform || 'unknown',
      channel: msg.channel || 'unknown',
      isLive: Boolean(msg.isLive),
      viewerCount: typeof msg.viewerCount === 'number' ? msg.viewerCount : null,
      score: Number(msg.score || 0),
      ratePerSec: Number(msg.ratePerSec || 0),
      baselineRatePerSec: Number(msg.baselineRatePerSec || 0),
      calibrated: Boolean(msg.calibrated),
      calibrationPct: Number(msg.calibrationPct || 0),
      lastSeenMs: Date.now(),
    });
    pruneWatchedTabs();
    sendResponse({ ok: true, watchedCount: watchedTabs.size });
    return false;
  }

  // 5. Return all active monitored streams for popup multi-tab overview
  if (msg.type === 'GET_WATCHED_STREAMS') {
    pruneWatchedTabs();
    const list = Array.from(watchedTabs.values()).sort((a, b) => b.score - a.score);
    sendResponse({
      ok: true,
      streams: list,
      activeDispatches,
      queuedDispatches: dispatchQueue.length,
    });
    return false;
  }

  // 6. Focus a specific monitored tab from the popup
  if (msg.type === 'FOCUS_TAB' && typeof msg.tabId === 'number') {
    chrome.tabs.update(msg.tabId, { active: true }, (tab) => {
      if (tab && typeof tab.windowId === 'number') {
        chrome.windows.update(tab.windowId, { focused: true }, () => {
          void chrome.runtime.lastError;
        });
      }
      void chrome.runtime.lastError;
    });
    sendResponse({ ok: true });
    return false;
  }

  // 7. Direct notification helper
  if (msg.type === 'NOTIFY_CLIP') {
    showNotification(msg.title || 'PulseCut', msg.message || 'Clip triggered');
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
