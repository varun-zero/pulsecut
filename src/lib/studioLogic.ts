import type {
  BrandKit,
  ClipItem,
  ClipStatusFilter,
  DetectedSource,
  EditorSettings,
  FacecamSourceBox,
  TextCasingId,
  WordCue,
} from '../types';

/**
 * Validates and classifies an ingest URL or local file path, auto-extracting the
 * streamer/creator handle (`kick.com/adinross` -> `adinross`, `instagram.com/user` -> `user`,
 * `youtube.com/@user` -> `user`) and suggesting the matching viral template.
 */
export function detectVideoSource(raw: string): DetectedSource {
  const value = raw.trim();
  if (!value) {
    return {
      valid: false,
      platform: null,
      cleanLabel: '',
      estimatedTitle: '',
      estimatedDuration: '',
      error: 'Paste a Kick, YouTube, Instagram, or Twitch link or select a local video file.',
    };
  }

  // Local path check
  const isLocalPath =
    /^file:\/\//i.test(value) ||
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith('/') ||
    /\.(mp4|mov|mkv|webm|m4v)$/i.test(value);

  if (isLocalPath) {
    const filename = value.split(/[\\/]/).pop() || 'local-recording.mp4';
    const baseName = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    return {
      valid: true,
      platform: 'Local',
      cleanLabel: filename,
      estimatedTitle: baseName || 'Local Studio Recording',
      estimatedDuration: '14:20',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    return {
      valid: false,
      platform: null,
      cleanLabel: '',
      estimatedTitle: '',
      estimatedDuration: '',
      error: 'Enter a valid http(s) URL (Kick, YouTube, Instagram, Twitch) or a local video path.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.split('/').filter(Boolean);

  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    const isShort = pathParts.includes('shorts');
    const handlePart = pathParts.find((p) => p.startsWith('@'));
    const streamerHandle = handlePart ? handlePart.replace(/^@/, '') : undefined;
    const videoId =
      parsed.searchParams.get('v') ||
      (isShort ? pathParts[1] : pathParts[0]) ||
      'session';
    return {
      valid: true,
      platform: 'YouTube',
      cleanLabel: streamerHandle
        ? `youtube.com/@${streamerHandle}`
        : `youtube.com/${isShort ? 'shorts/' : 'watch?v='}${videoId.slice(0, 14)}`,
      estimatedTitle: streamerHandle
        ? `${streamerHandle} · YouTube Clip`
        : isShort
          ? `YouTube Short · ${videoId.slice(0, 11)}`
          : `YouTube VOD · ${videoId.slice(0, 11)}`,
      estimatedDuration: isShort ? '00:58' : '42:18',
      streamerHandle,
      suggestedTemplateId: isShort ? 'yt-short' : undefined,
    };
  }

  if (host.includes('instagram.com')) {
    const reserved = new Set(['reel', 'reels', 'p', 'tv', 'stories', 'explore']);
    const first = pathParts[0] || '';
    const streamerHandle = first && !reserved.has(first.toLowerCase()) ? first.replace(/^@/, '') : undefined;
    return {
      valid: true,
      platform: 'Instagram',
      cleanLabel: streamerHandle ? `instagram.com/${streamerHandle}` : 'instagram.com/reel',
      estimatedTitle: streamerHandle ? `Instagram Reel · @${streamerHandle}` : 'Instagram Reel Clip',
      estimatedDuration: '00:45',
      streamerHandle,
      suggestedTemplateId: 'insta-short',
    };
  }

  if (host.includes('twitch.tv')) {
    const reserved = new Set(['videos', 'directory', 'clip']);
    const first = pathParts[0] || '';
    const streamerHandle = first && !reserved.has(first.toLowerCase()) ? first : 'creator';
    return {
      valid: true,
      platform: 'Twitch',
      cleanLabel: `twitch.tv/${streamerHandle}`,
      estimatedTitle: `Twitch Broadcast · ${streamerHandle}`,
      estimatedDuration: '1:18:05',
      streamerHandle,
    };
  }

  if (host.includes('kick.com')) {
    const reserved = new Set(['video', 'clips', 'categories', 'browse']);
    const first = pathParts[0] || 'channel';
    const streamerHandle = !reserved.has(first.toLowerCase()) ? first.replace(/^@/, '') : 'kickstreamer';
    return {
      valid: true,
      platform: 'Kick',
      cleanLabel: `kick.com/${streamerHandle}`,
      estimatedTitle: `Kick Live · ${streamerHandle}`,
      estimatedDuration: '58:40',
      streamerHandle,
      suggestedTemplateId: 'kick-stream',
    };
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return {
      valid: true,
      platform: 'Direct',
      cleanLabel: `${host}${parsed.pathname.slice(0, 22)}`,
      estimatedTitle: `Media Stream · ${host}`,
      estimatedDuration: '24:10',
    };
  }

  return {
    valid: false,
    platform: null,
    cleanLabel: '',
    estimatedTitle: '',
    estimatedDuration: '',
    error: 'Unsupported link protocol. Use http(s) or a local video file.',
  };
}

export function validateIngestInput(
  mode: 'link' | 'file',
  urlInput: string,
  localFilePath: string,
  selectedFileName: string
): { valid: boolean; target: string; detected: DetectedSource | null; error: string | null } {
  if (mode === 'file') {
    const chosen = localFilePath.trim() || selectedFileName.trim();
    if (!chosen) {
      return {
        valid: false,
        target: '',
        detected: null,
        error: 'Drop a video file or enter a local file path before generating shorts.',
      };
    }
    const detected = detectVideoSource(chosen);
    return { valid: true, target: chosen, detected, error: null };
  }

  const trimmed = urlInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      target: '',
      detected: null,
      error: 'Paste a Kick, YouTube, Instagram, or Twitch link to start.',
    };
  }

  const detected = detectVideoSource(trimmed);
  if (!detected.valid) {
    return {
      valid: false,
      target: trimmed,
      detected,
      error: detected.error || 'Please provide a valid video URL.',
    };
  }
  return { valid: true, target: trimmed, detected, error: null };
}

export function filterClips(
  clips: readonly ClipItem[],
  statusFilter: ClipStatusFilter,
  searchQuery: string
): ClipItem[] {
  const query = searchQuery.trim().toLowerCase();
  return clips.filter((clip) => {
    if (statusFilter !== 'all' && clip.status.toLowerCase() !== statusFilter.toLowerCase()) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      clip.title,
      clip.channel,
      clip.streamerHandle || '',
      clip.template,
      clip.transcript_snippet,
      ...clip.hashtags,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

export type ClipsEmptyKind = 'has-clips' | 'empty-library' | 'no-filter-matches';

export function getClipsEmptyState(totalClips: number, filteredCount: number): ClipsEmptyKind {
  if (totalClips === 0) return 'empty-library';
  if (filteredCount === 0) return 'no-filter-matches';
  return 'has-clips';
}

export function clampTrimWindow(
  inSec: number,
  outSec: number,
  durationSec: number
): { inSec: number; outSec: number; clipDurationSec: number } {
  const safeDuration = Math.max(0, Number.isFinite(durationSec) ? durationSec : 0);
  if (safeDuration === 0) {
    return { inSec: 0, outSec: 0, clipDurationSec: 0 };
  }
  const clampedIn = Math.max(0, Math.min(safeDuration, Number.isFinite(inSec) ? inSec : 0));
  const rawOut = Number.isFinite(outSec) && outSec > 0 ? outSec : safeDuration;
  const clampedOut = Math.max(clampedIn, Math.min(safeDuration, rawOut));
  return {
    inSec: Number(clampedIn.toFixed(2)),
    outSec: Number(clampedOut.toFixed(2)),
    clipDurationSec: Number(Math.max(0, clampedOut - clampedIn).toFixed(2)),
  };
}

export function formatTimecode(secs: number): string {
  const safe = Number.isFinite(secs) && secs > 0 ? secs : 0;
  const mins = Math.floor(safe / 60);
  const wholeSecs = Math.floor(safe % 60);
  const centis = Math.floor((safe % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(wholeSecs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export function formatShortDuration(secs: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(secs) ? secs : 0));
  const mins = Math.floor(safe / 60);
  const rem = safe % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export function applyTextCasing(text: string, casing: TextCasingId): string {
  if (casing === 'upper') return text.toUpperCase();
  if (casing === 'title') {
    return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return text;
}

export interface HistoryStack<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(initial: T): HistoryStack<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(stack: HistoryStack<T>, next: T, maxSize = 40): HistoryStack<T> {
  const nextPast = [...stack.past, stack.present].slice(-maxSize);
  return {
    past: nextPast,
    present: next,
    future: [],
  };
}

export function undoHistory<T>(stack: HistoryStack<T>): HistoryStack<T> {
  if (stack.past.length === 0) return stack;
  const previous = stack.past[stack.past.length - 1];
  return {
    past: stack.past.slice(0, -1),
    present: previous,
    future: [stack.present, ...stack.future],
  };
}

export function redoHistory<T>(stack: HistoryStack<T>): HistoryStack<T> {
  if (stack.future.length === 0) return stack;
  const next = stack.future[0];
  return {
    past: [...stack.past, stack.present],
    present: next,
    future: stack.future.slice(1),
  };
}

export function getActiveCue(words: readonly WordCue[], currentTimeSec: number): WordCue | null {
  if (!words.length) return null;
  const ms = currentTimeSec * 1000;
  return words.find((w) => ms >= w.start_ms && ms <= w.end_ms) ?? words[0];
}

export function normalizeHandle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/**
 * Clamps a 16:9 source facecam crop rectangle so it stays strictly inside 0..100%
 * with a usable minimum 12% width/height.
 */
export function clampFacecamSourceBox(box: FacecamSourceBox): FacecamSourceBox {
  const width = Math.max(12, Math.min(100, Math.round(box.width)));
  const height = Math.max(12, Math.min(100, Math.round(box.height)));
  const x = Math.max(0, Math.min(100 - width, Math.round(box.x)));
  const y = Math.max(0, Math.min(100 - height, Math.round(box.y)));
  return { x, y, width, height };
}

/**
 * Computes exact CSS positioning percentages for rendering ONLY the cropped region
 * (`box`) of a 16:9 source video/image inside an output facecam viewport container.
 */
export function computeCropTransform(box: FacecamSourceBox): {
  widthPct: number;
  heightPct: number;
  leftPct: number;
  topPct: number;
} {
  const safe = clampFacecamSourceBox(box);
  const widthPct = (100 / safe.width) * 100;
  const heightPct = (100 / safe.height) * 100;
  const leftPct = -(safe.x / safe.width) * 100;
  const topPct = -(safe.y / safe.height) * 100;
  return {
    widthPct: Number(widthPct.toFixed(2)),
    heightPct: Number(heightPct.toFixed(2)),
    leftPct: Number(leftPct.toFixed(2)),
    topPct: Number(topPct.toFixed(2)),
  };
}

export function buildConfigurePayload(
  settings: EditorSettings,
  brandKit: BrandKit,
  trimInSec: number,
  trimOutSec: number
) {
  const normalizedHandle = normalizeHandle(brandKit.handle);
  return {
    template: settings.templateEnabled ? settings.template : 'default',
    font: settings.font,
    headline_layout: settings.headlineLayout,
    headline_pos: {
      x: settings.headlineX,
      y: settings.headlineY,
      max_width: settings.headlineMaxWidth,
      align: settings.headlineAlign,
    },
    subtitle_font: settings.subtitleFont,
    subtitle_style: settings.captionStyle,
    subtitle_bg_style: settings.subtitleBgStyle,
    subtitle_size: settings.subtitleSize,
    subtitle_casing: settings.subtitleCasing,
    subtitle_words_per_screen: settings.subtitleWordsPerScreen,
    subtitle_base_color: settings.subtitleBaseColor,
    subtitle_active_color: settings.subtitleActiveColor,
    subtitle_emphasis_color: settings.subtitleEmphasisColor,
    subtitle_stroke_width: settings.subtitleStrokeWidth,
    subtitle_stroke_color: settings.subtitleStrokeColor,
    subtitle_drop_shadow: settings.subtitleDropShadow,
    subtitle_neon_glow: settings.subtitleNeonGlow,
    subtitle_animation: settings.subtitleAnimation,
    subtitle_pos: {
      x: settings.subtitleX,
      y: settings.subtitleVerticalPos,
      max_width: settings.subtitleMaxWidth,
      align: settings.subtitleAlign,
      line_height: settings.subtitleLineHeight,
    },
    subtitle_vertical_pos: settings.subtitleVerticalPos,
    safe_zone_platform: settings.safeZonePlatform,
    aspect: settings.aspect,
    layout: settings.layout,
    canvas: settings.canvas,
    corner_radius: settings.cornerRadius,
    outer_fill: settings.outerFill,
    facecam_crop: clampFacecamSourceBox(settings.facecamSourceBox),
    facecam_layout: {
      enabled: settings.facecamEnabled,
      placement: settings.facecamPlacement,
      output_x: settings.facecamOutputX,
      output_y: settings.facecamOutputY,
      output_width: settings.facecamOutputWidth,
      output_aspect: settings.facecamOutputAspect,
      split_ratio: settings.facecamSplitRatio,
      rounded: settings.facecamRounded,
    },
    main_video_frame: {
      aspect: settings.mainVideoAspect,
      fit: settings.mainVideoFit,
      offset_y: settings.mainVideoOffsetY,
    },
    in_ms: Math.round(trimInSec * 1000),
    out_ms: Math.round(trimOutSec * 1000),
    hook: applyTextCasing(settings.headline, settings.headlineCasing),
    outro: settings.outroText,
    outro_ms: settings.outroDurationSec * 1000,
    streamer_attribution: {
      enabled: settings.showStreamerBadge,
      handle: settings.streamerHandle,
      platform: settings.streamerPlatform,
      x: settings.streamerBadgeX,
      y: settings.streamerBadgeY,
      scale: settings.streamerBadgeScale,
      uppercase: settings.streamerBadgeUppercase,
    },
    watermark_config: {
      enabled: brandKit.showWatermark,
      text: normalizedHandle,
      x: settings.watermarkX,
      y: settings.watermarkY,
      size: settings.watermarkSize,
      opacity: brandKit.watermarkOpacity,
      outline: settings.watermarkOutline,
    },
    platform_overlays: {
      kick_neon_glow: settings.kickNeonGlow,
      kick_verified_badge: settings.kickVerifiedBadge,
      kick_status_pill: settings.kickStatusPill,
      kick_handle_format: settings.kickHandleFormat,
      insta_show_icon: settings.instaShowIcon,
      insta_show_card: settings.instaShowCard,
      yt_show_subscribe_cue: settings.ytShowSubscribeCue,
    },
    social: normalizedHandle
      ? {
          handle: normalizedHandle,
          style: brandKit.verified ? 'verified' : 'plain',
        }
      : null,
    watermark: brandKit.showWatermark ? normalizedHandle : '',
    audio_peak: settings.audioPeak,
    audio_peak_ms: settings.riserDurationSec * 1000,
  };
}
