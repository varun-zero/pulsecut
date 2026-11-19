/**
 * PulseCut Auto-Clipper — Manifest V3 Background Service Worker
 *
 * Responsibilities:
 * 1. Proxy all localhost HTTP requests (/api/extension/status, /api/extension/clip)
 *    so HTTPS pages (Kick, Twitch, YouTube, Instagram) never fail due to Mixed Content or CORS.
 * 2. Relay chat bursts observed inside YouTube live_chat iframes to the parent watch tab's HUD.
 * 3. Manage non-destructive default settings and safe browser notifications.
 */

const DEFAULT_SETTINGS = {
  serverUrl: 'http://127.0.0.1:8756',
  mode: 'auto', // 'auto' | 'alert' | 'off'
  threshold: 55,
  lookbackSecs: 30,
  cooldownSecs: 45,
};

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  // 1. Health check proxy
  if (msg.type === 'PING_SERVER') {
    (async () => {
      const settings = await getStoredSettings();
      const base = normalizeServerUrl(msg.serverUrl || settings.serverUrl);
      const res = await fetchJsonWithTimeout(`${base}/api/extension/status`, { method: 'GET' }, 3500);
      sendResponse({
        ok: Boolean(res.ok && res.data && res.data.ok !== false),
        serverUrl: base,
        version: res.data?.version || null,
        clips: res.data?.clips ?? null,
        jobs: res.data?.jobs ?? null,
        error: res.ok ? null : res.error,
      });
    })();
    return true;
  }

  // 2. Clip trigger proxy (avoids Mixed Content / CORS on https:// pages)
  if (msg.type === 'TRIGGER_CLIP') {
    (async () => {
      const settings = await getStoredSettings();
      const base = normalizeServerUrl(msg.serverUrl || settings.serverUrl);
      const payload = {
        url: msg.url,
        channel: msg.channel || 'unknown',
        platform: msg.platform || 'unknown',
        template: msg.template || 'default',
        lookback_secs: Number(msg.lookback_secs ?? settings.lookbackSecs) || 30,
        hype_score: Number(msg.hype_score ?? 100),
        reasons: Array.isArray(msg.reasons) ? msg.reasons : [],
      };

      const res = await fetchJsonWithTimeout(
        `${base}/api/extension/clip`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        10000
      );

      if (res.ok) {
        if (msg.notify !== false) {
          showNotification(
            `PulseCut · Clipping ${payload.channel}`,
            `Capturing last ${payload.lookback_secs}s (${payload.platform} · hype ${Math.round(
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
        sendResponse({
          ok: false,
          error: res.error || 'PulseCut server unreachable',
        });
      }
    })();
    return true;
  }

  // 3. Relay chat messages from YouTube live_chat iframe to top-frame HUD in the same tab
  if (msg.type === 'CHAT_BURST' && sender?.tab?.id !== undefined) {
    chrome.tabs.sendMessage(
      sender.tab.id,
      {
        type: 'RELAYED_CHAT_BURST',
        messages: Array.isArray(msg.messages) ? msg.messages : [],
      },
      { frameId: 0 },
      () => {
        // Ignore lastError if top frame hasn't mounted yet
        void chrome.runtime.lastError;
      }
    );
    sendResponse({ ok: true });
    return false;
  }

  // 4. Direct notification helper
  if (msg.type === 'NOTIFY_CLIP') {
    showNotification(msg.title || 'PulseCut', msg.message || 'Clip triggered');
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
