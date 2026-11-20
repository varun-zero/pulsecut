/**
 * PulseCut Extension — Pure Hype Detection & Stream Context Engine
 * Loaded in Chrome MV3 content scripts (attaches to globalThis.PulseCutHypeEngine)
 * and importable in Node.js for automated unit testing.
 */
(function initPulseCutHypeEngine(root) {
  'use strict';

  const DEFAULT_CONFIG = Object.freeze({
    serverUrl: 'http://127.0.0.1:8756',
    mode: 'auto', // 'auto' | 'alert' | 'off'
    threshold: 55,
    lookbackSecs: 30,
    cooldownSecs: 45,
    manualDebounceSecs: 2,
    alertCooldownSecs: 20,
  });

  const HYPE_REGEX =
    /\b(W+|L+|CLIP\s*IT|CLIP|OMG|NO\s*WAY|BRO+|WTF|CRAZY|INSANE|WHAT+|YO+|SHEESH|GOAT|COOKED|NAH+|AINT\s*NO\s*WAY|WHOA|WAIT\s*WHAT|HOLD\s*ON|LETS\s*GO|LFG|POG|KEKW|LMAO+|LMFAO+|DEAD|CRYING|BANNED|COOKING)\b/i;

  const EMOTE_REGEX = /[🔥💀😭😂🤯😱⚡💯🎉🙌👑🤣👀]/gu;

  const RESERVED_SEGMENTS = new Set([
    'watch',
    'live',
    'live_chat',
    'live_chat_replay',
    'shorts',
    'reel',
    'reels',
    'p',
    'tv',
    'explore',
    'stories',
    'direct',
    'directory',
    'categories',
    'browse',
    'following',
    'downloads',
    'settings',
    'search',
    'video',
    'videos',
    'clip',
    'clips',
    'channel',
    'c',
    'user',
    'feed',
    'results',
    'playlist',
    'home',
  ]);

  function normalizeServerUrl(raw) {
    const trimmed = String(raw || DEFAULT_CONFIG.serverUrl).trim().replace(/\/+$/, '');
    if (!trimmed) return DEFAULT_CONFIG.serverUrl;
    if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
    return trimmed;
  }

  function cleanHandle(raw) {
    return String(raw || '')
      .trim()
      .replace(/^@+/, '')
      .replace(/[^a-zA-Z0-9._-]/g, '');
  }

  /**
   * Returns the Kick live channel slug (e.g. "funnyhoodvidz") when on a Kick
   * channel page, or "" for Kick VODs/clips/browse pages.
   */
  function extractKickSlug(urlString) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return '';
    }
    const host = parsed.hostname.toLowerCase();
    if (!host.includes('kick.com')) return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0].toLowerCase();
    if (RESERVED_SEGMENTS.has(first)) return '';
    if (parts[1] && (parts[1].toLowerCase() === 'videos' || parts[1].toLowerCase() === 'clips')) {
      return '';
    }
    return cleanHandle(parts[0]);
  }

  /**
   * Determines whether the current tab is a live stream vs. an on-demand VOD.
   */
  function detectLiveStatus(urlString, domHints = {}) {
    if (typeof domHints.isLive === 'boolean') return domHints.isLive;
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    const first = (parts[0] || '').toLowerCase();

    if (host.includes('kick.com')) {
      return Boolean(extractKickSlug(urlString));
    }
    if (host.includes('twitch.tv')) {
      if (host.startsWith('clips.')) return false;
      if (!parts.length || RESERVED_SEGMENTS.has(first)) return false;
      if (parts[1] && (parts[1].toLowerCase() === 'videos' || parts[1].toLowerCase() === 'clip')) {
        return false;
      }
      return true;
    }
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      if (first === 'live') return true;
      return Boolean(domHints.hasLiveBadge);
    }
    return false;
  }

  /**
   * Detects platform, streamer/creator handle, live status, and default PulseCut
   * short template (`default` — white title + yellow subtitles) from the page
   * URL + optional DOM hints.
   */
  function detectStreamContext(urlString, domHints = {}) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      return {
        platform: 'unknown',
        channel: 'unknown',
        template: 'default',
        platformTemplate: 'default',
        isLive: false,
        isChatIframe: false,
        supported: false,
      };
    }

    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    const first = (parts[0] || '').toLowerCase();
    const isLive = detectLiveStatus(urlString, domHints);

    if (host.includes('kick.com')) {
      const candidate = parts[0] && !RESERVED_SEGMENTS.has(first) ? cleanHandle(parts[0]) : '';
      const channel = candidate || cleanHandle(domHints.channelName) || 'kick_streamer';
      return {
        platform: 'kick',
        channel,
        template: 'default',
        platformTemplate: 'kick-stream',
        isLive,
        isChatIframe: parsed.pathname.includes('/chatroom'),
        supported: Boolean(candidate || first === 'video' || first === 'clips' || domHints.channelName),
      };
    }

    if (host.includes('twitch.tv')) {
      const candidate = parts[0] && !RESERVED_SEGMENTS.has(first) ? cleanHandle(parts[0]) : '';
      const channel = candidate || cleanHandle(domHints.channelName) || 'twitch_streamer';
      return {
        platform: 'twitch',
        channel,
        template: 'default',
        platformTemplate: 'split-stream',
        isLive,
        isChatIframe: parsed.pathname.startsWith('/popout/') && parsed.pathname.includes('/chat'),
        supported: Boolean(candidate || first === 'videos' || domHints.channelName),
      };
    }

    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const isChatIframe =
        first === 'live_chat' || first === 'live_chat_replay';
      const isShort = first === 'shorts';
      let urlHandle = '';
      if (parts[0] && parts[0].startsWith('@')) {
        urlHandle = cleanHandle(parts[0]);
      }
      const domHandle = cleanHandle(domHints.channelHandle || domHints.channelName);
      const videoId = parsed.searchParams.get('v') || (isShort ? parts[1] : '') || '';
      const channel = domHandle || urlHandle || (videoId ? `yt_${videoId}` : 'youtube_creator');
      return {
        platform: 'youtube',
        channel,
        template: 'default',
        platformTemplate: 'yt-short',
        isLive,
        isChatIframe,
        supported: isChatIframe || first === 'watch' || first === 'live' || isShort || Boolean(urlHandle),
      };
    }

    if (host.includes('instagram.com')) {
      let urlHandle = '';
      if (parts[0] && !RESERVED_SEGMENTS.has(first)) {
        urlHandle = cleanHandle(parts[0]);
      }
      const domHandle = cleanHandle(domHints.channelHandle || domHints.channelName);
      const channel = urlHandle || domHandle || 'insta_creator';
      return {
        platform: 'instagram',
        channel,
        template: 'default',
        platformTemplate: 'insta-short',
        isLive: false,
        isChatIframe: false,
        supported:
          first === 'reel' ||
          first === 'reels' ||
          first === 'p' ||
          Boolean(urlHandle),
      };
    }

    return {
      platform: 'unknown',
      channel: 'unknown',
      template: 'default',
      platformTemplate: 'default',
      isLive: false,
      isChatIframe: false,
      supported: false,
    };
  }

  /**
   * Computes a normalized 0..100 hype score from recent chat messages and rolling baseline velocity.
   */
  function analyzeChatWindow({
    messages,
    nowMs,
    windowMs = 6000,
    baselineRatePerSec = 0.5,
  }) {
    const cutoff = nowMs - windowMs;
    const recent = messages.filter((m) => m.ts >= cutoff && m.ts <= nowMs);
    const windowSec = Math.max(1, windowMs / 1000);
    const currentRate = recent.length / windowSec;

    if (recent.length === 0) {
      return {
        score: 0,
        ratePerSec: 0,
        burstRatio: 0,
        hypeRatio: 0,
        capsRatio: 0,
        reasons: [],
      };
    }

    const effectiveBaseline = Math.max(baselineRatePerSec, 0.45);
    const burstRatio = currentRate / effectiveBaseline;

    let hypeCount = 0;
    let capsCount = 0;
    let emoteCount = 0;

    for (const msg of recent) {
      const text = String(msg.text || '').trim();
      if (!text) continue;
      if (HYPE_REGEX.test(text)) hypeCount += 1;
      const emotes = text.match(EMOTE_REGEX);
      if (emotes && emotes.length > 0) emoteCount += 1;
      const letters = text.replace(/[^a-zA-Z]/g, '');
      if (letters.length >= 4 && letters === letters.toUpperCase()) {
        capsCount += 1;
      }
    }

    const hypeRatio = hypeCount / recent.length;
    const capsRatio = capsCount / recent.length;
    const emoteRatio = emoteCount / recent.length;

    let score = 0;
    const reasons = [];

    // 1. Velocity spike above rolling baseline
    if (recent.length >= 4 && burstRatio >= 1.8) {
      const velScore = Math.min(48, Math.round((burstRatio - 1) * 14));
      score += velScore;
      reasons.push(`velocity ${burstRatio.toFixed(1)}x`);
    }

    // 2. Absolute chat density bonus (active large streams)
    if (currentRate >= 2.5) {
      const densityScore = Math.min(20, Math.round(currentRate * 3.2));
      score += densityScore;
      reasons.push(`${currentRate.toFixed(1)} msg/s`);
    }

    // 3. Hype keyword density ("CLIP IT", "W", "NO WAY", etc.)
    if (hypeCount >= 2 && hypeRatio >= 0.25) {
      score += Math.min(24, Math.round(hypeRatio * 34));
      reasons.push(`hype ${Math.round(hypeRatio * 100)}%`);
    }

    // 4. All-caps & reaction emote energy
    if (capsRatio >= 0.3 && recent.length >= 4) {
      score += Math.min(12, Math.round(capsRatio * 20));
      reasons.push('ALL CAPS');
    }
    if (emoteRatio >= 0.25 && recent.length >= 3) {
      score += Math.min(10, Math.round(emoteRatio * 18));
      reasons.push('emotes');
    }

    // Require minimum volume so 1 random message never triggers an auto-clip
    if (recent.length < 3) {
      score = Math.min(score, 25);
    }

    return {
      score: Math.min(100, Math.max(0, Math.round(score))),
      ratePerSec: Number(currentRate.toFixed(2)),
      burstRatio: Number(burstRatio.toFixed(2)),
      hypeRatio: Number(hypeRatio.toFixed(2)),
      capsRatio: Number(capsRatio.toFixed(2)),
      reasons,
    };
  }

  /**
   * Decides whether a clip trigger is allowed, keeping manual clicks responsive
   * (short 2s debounce) while protecting auto-clipping with full cooldownSecs.
   */
  function evaluateTriggerGate({
    source, // 'manual' | 'auto' | 'alert'
    nowMs,
    lastManualTriggerMs = 0,
    lastAutoTriggerMs = 0,
    lastAlertMs = 0,
    cooldownSecs = DEFAULT_CONFIG.cooldownSecs,
    manualDebounceSecs = DEFAULT_CONFIG.manualDebounceSecs,
    alertCooldownSecs = DEFAULT_CONFIG.alertCooldownSecs,
  }) {
    if (source === 'manual') {
      const elapsed = (nowMs - lastManualTriggerMs) / 1000;
      if (elapsed < manualDebounceSecs) {
        return { allowed: false, retryAfterSecs: Math.ceil(manualDebounceSecs - elapsed) };
      }
      return { allowed: true, retryAfterSecs: 0 };
    }

    if (source === 'alert') {
      const elapsed = (nowMs - lastAlertMs) / 1000;
      if (elapsed < alertCooldownSecs) {
        return { allowed: false, retryAfterSecs: Math.ceil(alertCooldownSecs - elapsed) };
      }
      return { allowed: true, retryAfterSecs: 0 };
    }

    const elapsed = (nowMs - lastAutoTriggerMs) / 1000;
    if (elapsed < cooldownSecs) {
      return { allowed: false, retryAfterSecs: Math.ceil(cooldownSecs - elapsed) };
    }
    return { allowed: true, retryAfterSecs: 0 };
  }

  const api = {
    DEFAULT_CONFIG,
    normalizeServerUrl,
    cleanHandle,
    extractKickSlug,
    detectLiveStatus,
    detectStreamContext,
    analyzeChatWindow,
    evaluateTriggerGate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.PulseCutHypeEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
