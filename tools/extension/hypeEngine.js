/**
 * PulseCut Extension — Viewer-Aware Adaptive Hype Engine & Stream Context
 * Loaded in Chrome MV3 content scripts (attaches to globalThis.PulseCutHypeEngine)
 * and importable in Node.js for automated unit testing.
 */
(function initPulseCutHypeEngine(root) {
  'use strict';

  const DEFAULT_CONFIG = Object.freeze({
    serverUrl: 'http://127.0.0.1:8756',
    mode: 'manual', // 'manual' | 'auto' | 'alert' | 'off'
    threshold: 55,
    lookbackSecs: 30,
    cooldownSecs: 45,
    manualDebounceSecs: 2,
    alertCooldownSecs: 20,
    warmupSecs: 12,
    sustainedTicksRequired: 2,
  });

  const HYPE_REGEX =
    /\b(W+|L+|CLIP\s*IT|CLIP|OMG|NO\s*WAY|BRO+|WTF|CRAZY|INSANE|WHAT+|YO+|SHEESH|GOAT|COOKED|NAH+|AINT\s*NO\s*WAY|WHOA|WAIT\s*WHAT|HOLD\s*ON|LETS\s*GO|LFG|POG|POGGERS|KEKW|LMAO+|LMFAO+|DEAD|CRYING|BANNED|COOKING|CLUTCH|WILD|CAP|RIP|OMG+|AYO+|BRUH|NOOOO+|YOOO+|W\s+STREAM|FIRE)\b/i;

  const EMOTE_REGEX = /[🔥💀😭😂🤯😱⚡💯🎉🙌👑🤣👀😳🥵💥👏🗣️]|:(fire|skull|joy|sob|exploding_head|100|pog|kekw|clap|eyes|crown|scream):/giu;

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
   * Parses live viewer counts from Kick, YouTube Live, or Twitch UI strings:
   *   "12,450 watching now" -> 12450
   *   "18.4K" -> 18400
   *   "1.2M watching" -> 1200000
   *   "845 viewers" -> 845
   * Returns null if not parseable.
   */
  function parseViewerCount(raw) {
    if (typeof raw === 'number') {
      return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
    }
    const text = String(raw || '').trim();
    if (!text) return null;

    // Match compact or comma-formatted numbers like 12,450 | 18.4K | 1.2M | 845
    const match = text.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([KMB])?\b/i);
    if (!match) return null;

    const base = parseFloat(match[1].replace(/,/g, ''));
    if (!Number.isFinite(base) || base < 0) return null;

    const suffix = (match[2] || '').toUpperCase();
    const mult = suffix === 'M' ? 1_000_000 : suffix === 'K' ? 1_000 : suffix === 'B' ? 1_000_000_000 : 1;
    return Math.round(base * mult);
  }

  function formatViewerCount(count) {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return '';
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 10_000) return `${Math.round(count / 1_000)}K`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(Math.round(count));
  }

  /**
   * Estimates an expected "normal" chat velocity (messages/sec) for a stream
   * based on its live concurrent viewer count. Uses a sub-linear square-root
   * scaling law matching real Twitch/Kick/YouTube Live chat behavior:
   *   - unknown / 0 viewers -> 0.50 msg/s
   *   - 50 viewers          -> ~0.52 msg/s
   *   - 250 viewers         -> ~0.94 msg/s
   *   - 1,000 viewers       -> ~1.70 msg/s
   *   - 5,000 viewers       -> ~3.57 msg/s
   *   - 15,000 viewers      -> ~6.06 msg/s
   *   - 40,000 viewers      -> ~9.78 msg/s
   *   - 100,000 viewers     -> ~15.36 msg/s
   */
  function estimateViewerBaselineRate(viewerCount) {
    if (typeof viewerCount !== 'number' || !Number.isFinite(viewerCount) || viewerCount <= 0) {
      return 0.5;
    }
    const rate = 0.18 + 0.048 * Math.sqrt(viewerCount);
    return Number(Math.min(35, Math.max(0.25, rate)).toFixed(2));
  }

  /**
   * Creates a fresh per-tab adaptive baseline tracker.
   */
  function createBaselineState(nowMs = Date.now(), viewerCount = null) {
    const parsedViewers = parseViewerCount(viewerCount);
    const prior = estimateViewerBaselineRate(parsedViewers);
    return {
      startedAtMs: nowMs,
      lastSampleMs: 0,
      viewerCount: parsedViewers,
      samples: [], // rolling 1-sec rate samples (max 90, spike-clamped)
      mean: prior,
      stdDev: Math.max(0.35, Number((prior * 0.32).toFixed(2))),
      priorRate: prior,
      observedRate: prior,
      calibrationPct: 0,
      calibrated: false,
      consecutiveHotTicks: 0,
    };
  }

  /**
   * Updates the rolling adaptive baseline with a new 1-second chat rate sample
   * and the latest observed viewer count.
   *
   * Key properties:
   * - Combines viewer-count prior with observed channel median/trimmed mean so
   *   a 40K-viewer stream starts with an appropriate baseline on tick 1 AND
   *   adapts to that specific stream's chat culture within ~15-20s.
   * - Spike-resistant: active hype bursts are clamped before entering the rolling
   *   history so a viral moment doesn't poison the normal baseline.
   * - Dynamically re-centers if viewer count shifts significantly.
   */
  function updateAdaptiveBaseline(state, sampleRatePerSec, viewerCount, nowMs = Date.now()) {
    const next = state ? { ...state, samples: state.samples.slice() } : createBaselineState(nowMs, viewerCount);
    const parsedViewers = parseViewerCount(viewerCount);
    if (parsedViewers !== null && parsedViewers > 0) {
      // Smooth viewer count slightly so brief DOM glitches don't jump the baseline
      next.viewerCount =
        next.viewerCount && next.viewerCount > 0
          ? Math.round(next.viewerCount * 0.7 + parsedViewers * 0.3)
          : parsedViewers;
    }

    const priorRate = estimateViewerBaselineRate(next.viewerCount);
    next.priorRate = priorRate;

    const rate = Number.isFinite(sampleRatePerSec) && sampleRatePerSec >= 0 ? sampleRatePerSec : 0;

    // Spike-resistant ingestion: once we have >= 10 samples, clamp extreme surges
    // so a 20-second hype burst doesn't drag normal baseline up too high.
    let ingestRate = rate;
    if (next.samples.length >= 10 && next.mean > 0) {
      const spikeCap = Math.max(next.mean * 1.6, priorRate * 1.6, 1.2);
      if (rate > next.mean * 2.1 && rate > priorRate * 1.5) {
        ingestRate = Math.min(rate, spikeCap);
      }
    }

    next.samples.push(ingestRate);
    if (next.samples.length > 90) {
      next.samples.splice(0, next.samples.length - 90);
    }
    next.lastSampleMs = nowMs;

    // Compute robust trimmed mean + MAD-derived stdDev over rolling history
    const sorted = next.samples.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const trim = n >= 10 ? Math.floor(n * 0.1) : 0;
    const trimmed = sorted.slice(trim, n - trim);
    const observedMean =
      trimmed.length > 0
        ? trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length
        : priorRate;

    const median =
      n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const absDevs = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    const mad =
      n % 2 === 1 ? absDevs[(n - 1) / 2] : (absDevs[n / 2 - 1] + absDevs[n / 2]) / 2;

    // Blend viewer-count prior with observed channel activity.
    // Even after full warmup, retain a small viewer-prior anchor (15%) if viewers are known
    // so a 10-second quiet lull on a 30K stream never drops the baseline to 0.3 msg/s.
    const warmupSamples = DEFAULT_CONFIG.warmupSecs;
    const obsWeight = next.viewerCount
      ? Math.min(0.85, n / (warmupSamples * 1.6))
      : Math.min(0.92, n / warmupSamples);

    const blendedMean = priorRate * (1 - obsWeight) + observedMean * obsWeight;
    const viewerFloor = next.viewerCount ? priorRate * 0.42 : 0.35;
    const effectiveMean = Math.max(blendedMean, viewerFloor, 0.3);

    // 1.4826 * MAD estimates stdDev for normal distributions, with a sane floor
    const robustStd = mad * 1.4826;
    const stdFloor = Math.max(0.32, effectiveMean * 0.28);
    const effectiveStd = Math.max(robustStd, stdFloor);

    next.observedRate = Number(observedMean.toFixed(2));
    next.mean = Number(effectiveMean.toFixed(2));
    next.stdDev = Number(effectiveStd.toFixed(2));
    next.calibrationPct = Math.min(100, Math.round((n / warmupSamples) * 100));
    next.calibrated = n >= warmupSamples;

    return next;
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
      if (first === 'live' || first === 'live_chat') return true;
      return Boolean(domHints.hasLiveBadge || domHints.hasLiveChatFrame || domHints.hasWatchingNow);
    }
    return false;
  }

  /**
   * Detects platform, streamer/creator handle, live status, viewer count, and default
   * PulseCut short template (`default` — white title + yellow subtitles) from the page
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
        viewerCount: null,
        supported: false,
      };
    }

    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    const first = (parts[0] || '').toLowerCase();
    const isLive = detectLiveStatus(urlString, domHints);
    const viewerCount = parseViewerCount(domHints.viewerCount);

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
        viewerCount,
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
        viewerCount,
        supported: Boolean(candidate || first === 'videos' || domHints.channelName),
      };
    }

    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const isChatIframe = first === 'live_chat' || first === 'live_chat_replay';
      const isShort = first === 'shorts';
      const isLivePath = first === 'live';
      let urlHandle = '';
      if (parts[0] && parts[0].startsWith('@')) {
        urlHandle = cleanHandle(parts[0]);
      }
      const domHandle = cleanHandle(domHints.channelHandle || domHints.channelName);
      const videoId =
        parsed.searchParams.get('v') ||
        (isShort || isLivePath ? parts[1] || '' : '') ||
        '';
      const channel = domHandle || urlHandle || (videoId ? `yt_${videoId}` : 'youtube_creator');
      return {
        platform: 'youtube',
        channel,
        videoId,
        template: 'default',
        platformTemplate: 'yt-short',
        isLive,
        isChatIframe,
        viewerCount,
        supported: isChatIframe || first === 'watch' || isLivePath || isShort || Boolean(urlHandle),
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
        viewerCount: null,
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
      viewerCount: null,
      supported: false,
    };
  }

  /**
   * Computes a normalized 0..100 hype score from recent chat messages, adaptive
   * rolling baseline, live viewer count, and author diversity (anti-spam).
   *
   * Backward-compatible with legacy calls that only pass
   * `{ messages, nowMs, windowMs, baselineRatePerSec }`.
   */
  function analyzeChatWindow({
    messages,
    nowMs,
    windowMs = 6000,
    baselineRatePerSec,
    baselineStdDev,
    viewerCount = null,
    sustainedHotTicks = 0,
    calibrated = true,
  }) {
    const cutoff = nowMs - windowMs;
    const recent = (Array.isArray(messages) ? messages : []).filter(
      (m) => m && m.ts >= cutoff && m.ts <= nowMs
    );
    const windowSec = Math.max(1, windowMs / 1000);
    const rawRate = recent.length / windowSec;

    const parsedViewers = parseViewerCount(viewerCount);
    const viewerPrior = estimateViewerBaselineRate(parsedViewers);
    const hasExplicitBaseline =
      typeof baselineRatePerSec === 'number' && Number.isFinite(baselineRatePerSec) && baselineRatePerSec > 0;
    const effectiveBaseline = hasExplicitBaseline
      ? parsedViewers
        ? Math.max(baselineRatePerSec, viewerPrior * 0.42)
        : Math.max(baselineRatePerSec, 0.45)
      : viewerPrior;

    const effectiveStdDev =
      typeof baselineStdDev === 'number' && Number.isFinite(baselineStdDev) && baselineStdDev > 0
        ? Math.max(baselineStdDev, 0.3)
        : Math.max(0.35, effectiveBaseline * 0.3);

    if (recent.length === 0) {
      return {
        score: 0,
        ratePerSec: 0,
        effectiveRatePerSec: 0,
        baselineRatePerSec: Number(effectiveBaseline.toFixed(2)),
        burstRatio: 0,
        zScore: 0,
        hypeRatio: 0,
        capsRatio: 0,
        uniqueAuthors: 0,
        uniqueRatio: 1,
        spamDampened: false,
        sustainedHotTicks,
        calibrated: Boolean(calibrated),
        reasons: [],
      };
    }

    // Per-author anti-spam cap: each author contributes at most 2 messages in the 6s window.
    let hasAuthorInfo = false;
    const authorCounts = new Map();
    const countedMessages = [];

    for (const msg of recent) {
      const author = String(msg.author || '').trim().toLowerCase();
      if (author) {
        hasAuthorInfo = true;
        const prev = authorCounts.get(author) || 0;
        authorCounts.set(author, prev + 1);
        if (prev < 2) {
          countedMessages.push(msg);
        }
      } else {
        countedMessages.push(msg);
      }
    }

    const uniqueAuthors = hasAuthorInfo ? authorCounts.size : recent.length;
    const uniqueRatio = recent.length > 0 ? uniqueAuthors / recent.length : 1;
    const effectiveCount = countedMessages.length;
    const currentRate = effectiveCount / windowSec;
    const burstRatio = currentRate / effectiveBaseline;
    const zScore = (currentRate - effectiveBaseline) / effectiveStdDev;

    let hypeCount = 0;
    let capsCount = 0;
    let emoteCount = 0;

    for (const msg of countedMessages) {
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

    const denom = Math.max(1, effectiveCount);
    const hypeRatio = hypeCount / denom;
    const capsRatio = capsCount / denom;
    const emoteRatio = emoteCount / denom;

    let score = 0;
    const reasons = [];

    // Minimum volume scales with audience size so stray messages on big streams stay calm
    const minVolumeForSpike =
      parsedViewers && parsedViewers >= 10_000
        ? 8
        : parsedViewers && parsedViewers >= 2_000
        ? 6
        : 4;

    // 1. Velocity Surge above adaptive baseline (0..46 pts)
    // Normal steady chat (~0.8x - 1.45x baseline) scores 0 here!
    if (effectiveCount >= minVolumeForSpike && burstRatio >= 1.65) {
      const velScore = Math.min(46, Math.round((burstRatio - 1.15) * 18));
      score += velScore;
      reasons.push(`velocity ${burstRatio.toFixed(1)}x`);
    }

    // 2. Statistical Z-score anomaly (0..18 pts) — scales automatically with viewer count!
    if (effectiveCount >= minVolumeForSpike && zScore >= 1.8) {
      const zPts = Math.min(18, Math.round((zScore - 1.2) * 5.2));
      score += zPts;
      reasons.push(`+${zScore.toFixed(1)}σ`);
    }

    // 3. Hype keyword density ("CLIP IT", "W", "NO WAY", "INSANE", etc.) (0..26 pts)
    // Require elevated velocity OR strong hype concentration so calm chat saying "lol" doesn't fire
    const minHypeCount = parsedViewers && parsedViewers >= 5_000 ? 4 : 2;
    if (hypeCount >= minHypeCount && hypeRatio >= 0.25) {
      const velocityGate = burstRatio >= 1.45 ? 1.0 : hypeRatio >= 0.55 ? 0.65 : 0.45;
      score += Math.min(26, Math.round(hypeRatio * 36 * velocityGate));
      reasons.push(`hype ${Math.round(hypeRatio * 100)}%`);
    }

    // 4. All-caps & reaction emote/emoji energy (0..12 + 0..10 pts)
    if (capsRatio >= 0.3 && effectiveCount >= minVolumeForSpike) {
      const capGate = burstRatio >= 1.4 ? 1.0 : 0.5;
      score += Math.min(12, Math.round(capsRatio * 20 * capGate));
      reasons.push('ALL CAPS');
    }
    if (emoteRatio >= 0.25 && effectiveCount >= 3) {
      const emoteGate = burstRatio >= 1.4 ? 1.0 : 0.55;
      score += Math.min(10, Math.round(emoteRatio * 18 * emoteGate));
      reasons.push('emotes');
    }

    // Guard 1: Minimum volume floor so 1-2 random messages never trigger
    if (effectiveCount < 3) {
      score = Math.min(score, 25);
    }

    // Guard 2: Anti-spam unique chatter diversity check (only when author data exists)
    let spamDampened = false;
    if (hasAuthorInfo && recent.length >= 3) {
      if (uniqueAuthors < 3 || (recent.length >= 6 && uniqueRatio < 0.35)) {
        score = Math.min(score, 32);
        spamDampened = true;
      }
    }

    // Guard 3: On known large streams (>= 1000 viewers), require actual velocity lift (>= 1.45x)
    // to cross 55% so steady normal-pace chat with a few "W"s never false-triggers.
    if (parsedViewers && parsedViewers >= 1000 && burstRatio < 1.45) {
      score = Math.min(score, 42);
    }

    return {
      score: Math.min(100, Math.max(0, Math.round(score))),
      ratePerSec: Number(rawRate.toFixed(2)),
      effectiveRatePerSec: Number(currentRate.toFixed(2)),
      baselineRatePerSec: Number(effectiveBaseline.toFixed(2)),
      burstRatio: Number(burstRatio.toFixed(2)),
      zScore: Number(zScore.toFixed(2)),
      hypeRatio: Number(hypeRatio.toFixed(2)),
      capsRatio: Number(capsRatio.toFixed(2)),
      uniqueAuthors,
      uniqueRatio: Number(uniqueRatio.toFixed(2)),
      spamDampened,
      sustainedHotTicks,
      calibrated: Boolean(calibrated),
      reasons,
    };
  }

  /**
   * Decides whether a clip trigger is allowed, keeping manual clicks responsive
   * (short 2s debounce) while protecting auto-clipping with full cooldownSecs,
   * warm-up calibration, and sustained-burst confirmation.
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
    calibrated = true,
    sustainedHotTicks = DEFAULT_CONFIG.sustainedTicksRequired,
    sustainedTicksRequired = DEFAULT_CONFIG.sustainedTicksRequired,
  }) {
    if (source === 'manual') {
      const elapsed = (nowMs - lastManualTriggerMs) / 1000;
      if (elapsed < manualDebounceSecs) {
        return { allowed: false, retryAfterSecs: Math.ceil(manualDebounceSecs - elapsed), reason: 'debounce' };
      }
      return { allowed: true, retryAfterSecs: 0, reason: 'ok' };
    }

    if (!calibrated) {
      return { allowed: false, retryAfterSecs: 0, reason: 'calibrating' };
    }

    if (sustainedHotTicks < sustainedTicksRequired) {
      return { allowed: false, retryAfterSecs: 0, reason: 'confirming' };
    }

    if (source === 'alert') {
      const elapsed = (nowMs - lastAlertMs) / 1000;
      if (elapsed < alertCooldownSecs) {
        return { allowed: false, retryAfterSecs: Math.ceil(alertCooldownSecs - elapsed), reason: 'cooldown' };
      }
      return { allowed: true, retryAfterSecs: 0, reason: 'ok' };
    }

    const elapsed = (nowMs - lastAutoTriggerMs) / 1000;
    if (elapsed < cooldownSecs) {
      return { allowed: false, retryAfterSecs: Math.ceil(cooldownSecs - elapsed), reason: 'cooldown' };
    }
    return { allowed: true, retryAfterSecs: 0, reason: 'ok' };
  }

  const api = {
    DEFAULT_CONFIG,
    normalizeServerUrl,
    cleanHandle,
    parseViewerCount,
    formatViewerCount,
    estimateViewerBaselineRate,
    createBaselineState,
    updateAdaptiveBaseline,
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
