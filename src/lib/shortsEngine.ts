import type {
  BrandKit,
  BuiltinSfxKind,
  ClipSegment,
  CustomFontEntry,
  EditorSettings,
  FramingBlueprint,
  OutroTemplateConfig,
  SfxAsset,
  SfxCue,
  ShortsProductionConfig,
  WordCue,
} from '../types';
import {
  buildFramingFiltergraph,
  clampNum,
  getExportPixelDimensions,
} from './framingEngine';
import { generateAssSubtitle, getSafeZoneSpec, getViralCaptionPreset } from '../captionStyles';

export const BUILTIN_SFX_LIBRARY: readonly SfxAsset[] = [
  { id: 'sfx-whoosh', name: 'Transition Whoosh', builtin: 'whoosh' },
  { id: 'sfx-pop', name: 'Caption Pop', builtin: 'pop' },
  { id: 'sfx-boom', name: 'Vine / Bass Boom', builtin: 'boom' },
  { id: 'sfx-ding', name: 'Highlight Ding', builtin: 'ding' },
  { id: 'sfx-swoosh', name: 'Fast Whip Swoosh', builtin: 'swoosh' },
];

export function createDefaultShortsProduction(): ShortsProductionConfig {
  return {
    multiSegmentEnabled: false,
    segments: [],
    musicOffsetSec: 0,
    musicDurationSec: 0,
    sfxLibrary: [...BUILTIN_SFX_LIBRARY],
    sfxCues: [],
    outro: {
      mode: 'template',
      enabled: false,
      duration: 3.5,
      animDuration: 1.2,
      bgColor: '#FFFFFF',
      text: 'Follow for more clips',
      textColor: '#0F1419',
      platform: 'youtube',
      btnText: 'Subscribe',
      btnColor: '#0F0F0F',
      logoDataUrl: '',
      customUrl: '',
      customName: '',
      customIsVideo: false,
    },
    dualWatermark: {
      secondaryEnabled: false,
      secondaryText: '#clips',
      secondaryX: 88,
      secondaryY: 9,
      secondarySize: 13,
      secondaryOpacity: 90,
      customLogoUrl: '',
      customLogoName: '',
      customLogoScale: 24,
      useCustomLogo: false,
    },
    headlineTiming: {
      mode: 'always',
      startSec: 0,
      endSec: 3.5,
      fade: true,
      sfxIn: '',
      sfxOut: '',
    },
    exportResolution: '1080p',
    exportEncoder: 'auto',
  };
}

/* ---------- Multi-Segment Stitching Math (from decompiled renderer.js & main.js) ---------- */

export function sortSegments(segments: readonly ClipSegment[]): ClipSegment[] {
  return [...segments]
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

export function getActiveSegments(
  config: Pick<ShortsProductionConfig, 'multiSegmentEnabled' | 'segments'>,
  trimInSec: number,
  trimOutSec: number
): ClipSegment[] {
  if (config.multiSegmentEnabled && config.segments.length > 0) {
    return sortSegments(config.segments);
  }
  const safeStart = Math.max(0, trimInSec);
  const safeEnd = Math.max(safeStart + 0.1, trimOutSec);
  return [{ id: 'single', start: safeStart, end: safeEnd }];
}

/** Combined stitched duration accounting for unified playback speed */
export function computeEffectivePlaybackSpeed(
  blueprintSpeed = 1,
  settingsSpeedMultiplier = 1
): number {
  const b = Number.isFinite(blueprintSpeed) && blueprintSpeed > 0 ? blueprintSpeed : 1;
  const m =
    Number.isFinite(settingsSpeedMultiplier) && settingsSpeedMultiplier > 0
      ? settingsSpeedMultiplier
      : 1;
  return Number(clampNum(b * m, 0.25, 4).toFixed(3));
}

export function computeStitchedDuration(
  segments: readonly ClipSegment[],
  speed = 1
): number {
  const safeSpeed = clampNum(speed || 1, 0.25, 4);
  const raw = sortSegments(segments).reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
  return Number((raw / safeSpeed).toFixed(3));
}

/**
 * Real non-destructive razor split: partitions the segment enclosing `splitTimeSec`
 * into two independent segments while enforcing a minimum usable segment duration.
 */
export function splitSegmentsAtTime(
  segments: readonly ClipSegment[],
  splitTimeSec: number,
  minSegSec = 0.4
): { segments: ClipSegment[]; didSplit: boolean; newSegmentId: string | null } {
  const sorted = sortSegments(segments);
  const t = Number(splitTimeSec.toFixed(2));
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    if (t >= seg.start + minSegSec && t <= seg.end - minSegSec) {
      const left: ClipSegment = { ...seg, end: t };
      const rightId = `seg-${Math.round(t * 1000)}-${i + 1}`;
      const right: ClipSegment = { id: rightId, start: t, end: seg.end };
      const next = [...sorted.slice(0, i), left, right, ...sorted.slice(i + 1)];
      return { segments: next, didSplit: true, newSegmentId: rightId };
    }
  }
  return { segments: sorted, didSplit: false, newSegmentId: null };
}

export function deleteSegmentById(
  segments: readonly ClipSegment[],
  segId: string
): ClipSegment[] {
  return sortSegments(segments.filter((s) => s.id !== segId));
}

export function duplicateSegmentById(
  segments: readonly ClipSegment[],
  segId: string,
  maxDurSec: number
): { segments: ClipSegment[]; created: ClipSegment | null } {
  const sorted = sortSegments(segments);
  const target = sorted.find((s) => s.id === segId);
  if (!target) return { segments: sorted, created: null };
  const dur = Math.max(0.5, target.end - target.start);
  const nextStart = Math.min(Math.max(0, maxDurSec - 0.5), target.end + 0.1);
  const nextEnd = Math.min(maxDurSec, nextStart + dur);
  if (nextEnd - nextStart < 0.3) return { segments: sorted, created: null };
  const created: ClipSegment = {
    id: `seg-dup-${Date.now()}-${Math.round(nextStart * 100)}`,
    start: Number(nextStart.toFixed(2)),
    end: Number(nextEnd.toFixed(2)),
  };
  return { segments: sortSegments([...sorted, created]), created };
}

/* ---------- Color Grading, Transforms, Transitions, Audio Envelope & Subtitle Cue CRUD ---------- */

export function buildVideoGradingCssFilter(
  settings: Pick<
    EditorSettings,
    'brightness' | 'contrast' | 'saturation' | 'exposure' | 'temperature' | 'blur' | 'colorFilter'
  >
): string {
  const filters: string[] = [];
  const b = settings.brightness ?? 100;
  const c = settings.contrast ?? 100;
  const s = settings.saturation ?? 100;
  const exp = settings.exposure ?? 0;
  const temp = settings.temperature ?? 0;
  const blur = settings.blur ?? 0;

  const netBrightness = Math.max(10, b + exp);
  if (netBrightness !== 100) filters.push(`brightness(${netBrightness}%)`);
  if (c !== 100) filters.push(`contrast(${c}%)`);
  if (s !== 100) filters.push(`saturate(${s}%)`);
  if (blur > 0) filters.push(`blur(${blur}px)`);

  if (temp > 0) {
    filters.push(`sepia(${(temp * 0.55).toFixed(1)}%)`);
  } else if (temp < 0) {
    filters.push(`hue-rotate(${(temp * 0.5).toFixed(1)}deg) saturate(${Math.max(70, 100 + temp * 0.25).toFixed(0)}%)`);
  }

  switch (settings.colorFilter) {
    case 'cinematic':
      filters.push('contrast(114%) saturate(108%) sepia(8%)');
      break;
    case 'warm':
      filters.push('sepia(22%) saturate(114%) brightness(102%)');
      break;
    case 'cool':
      filters.push('hue-rotate(-14deg) saturate(94%) contrast(106%)');
      break;
    case 'moody':
      filters.push('brightness(91%) contrast(124%) saturate(84%)');
      break;
    case 'vintage':
      filters.push('sepia(32%) contrast(94%) brightness(104%)');
      break;
    case 'contrast':
      filters.push('contrast(128%) saturate(112%)');
      break;
    case 'bw':
      filters.push('grayscale(100%) contrast(118%)');
      break;
    default:
      break;
  }

  return filters.length > 0 ? filters.join(' ') : 'none';
}

export function buildVideoTransformCss(
  settings: Pick<
    EditorSettings,
    'videoScale' | 'videoPosX' | 'videoPosY' | 'videoRotation' | 'videoFlipH' | 'videoFlipV' | 'videoOpacity'
  >
): { transform: string; opacity: number } {
  const scale = clampNum((settings.videoScale ?? 100) / 100, 0.5, 2.5);
  const posX = clampNum(settings.videoPosX ?? 0, -50, 50);
  const posY = clampNum(settings.videoPosY ?? 0, -50, 50);
  const rot = clampNum(settings.videoRotation ?? 0, -180, 180);
  const sx = (settings.videoFlipH ? -1 : 1) * scale;
  const sy = (settings.videoFlipV ? -1 : 1) * scale;
  const opacity = clampNum((settings.videoOpacity ?? 100) / 100, 0, 1);

  const parts: string[] = [];
  if (posX !== 0 || posY !== 0) parts.push(`translate(${posX}%, ${posY}%)`);
  if (rot !== 0) parts.push(`rotate(${rot}deg)`);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`);

  return {
    transform: parts.length > 0 ? parts.join(' ') : 'none',
    opacity: Number(opacity.toFixed(3)),
  };
}

export interface TransitionPreviewEffect {
  opacity: number;
  scale: number;
  translateX: number;
  dipBlackOpacity: number;
}

/**
 * Computes live preview transition effect near segment boundaries or split points.
 */
export function computeTransitionPreviewEffect(
  currentTimeSec: number,
  segments: readonly ClipSegment[],
  style: EditorSettings['transitionStyle'],
  durationSec = 0.3
): TransitionPreviewEffect {
  const neutral: TransitionPreviewEffect = {
    opacity: 1,
    scale: 1,
    translateX: 0,
    dipBlackOpacity: 0,
  };
  if (style === 'cut' || durationSec <= 0.02 || segments.length <= 1) return neutral;

  const sorted = sortSegments(segments);
  const halfDur = Math.max(0.05, durationSec / 2);

  for (let i = 1; i < sorted.length; i++) {
    const seg = sorted[i];
    const distInto = currentTimeSec - seg.start;
    if (distInto >= 0 && distInto < halfDur) {
      const p = clampNum(distInto / halfDur, 0, 1); // 0 at cut -> 1 settled
      if (style === 'crossfade') return { ...neutral, opacity: Number((0.35 + 0.65 * p).toFixed(3)) };
      if (style === 'dip-black') return { ...neutral, dipBlackOpacity: Number((1 - p).toFixed(3)) };
      if (style === 'zoom-in') return { ...neutral, scale: Number((1.14 - 0.14 * p).toFixed(3)) };
      if (style === 'slide-left') return { ...neutral, translateX: Number(((1 - p) * 18).toFixed(2)) };
    }
    const prev = sorted[i - 1];
    const distBefore = prev.end - currentTimeSec;
    if (distBefore >= 0 && distBefore < halfDur) {
      const p = clampNum(distBefore / halfDur, 0, 1); // 1 far -> 0 at cut
      if (style === 'crossfade') return { ...neutral, opacity: Number((0.35 + 0.65 * p).toFixed(3)) };
      if (style === 'dip-black') return { ...neutral, dipBlackOpacity: Number((1 - p).toFixed(3)) };
      if (style === 'zoom-in') return { ...neutral, scale: Number((1 + (1 - p) * 0.1).toFixed(3)) };
      if (style === 'slide-left') return { ...neutral, translateX: Number((-(1 - p) * 18).toFixed(2)) };
    }
  }
  return neutral;
}

/**
 * Computes real-time master audio gain (0..2.0) incorporating Fade In, Fade Out, and Master Volume %.
 */
export function computeAudioEnvelopeGain(
  stitchedTimeSec: number,
  stitchedDurationSec: number,
  masterVolumePct = 100,
  fadeInSec = 0,
  fadeOutSec = 0
): number {
  const baseGain = clampNum(masterVolumePct / 100, 0, 2);
  let env = 1;
  if (fadeInSec > 0.02 && stitchedTimeSec < fadeInSec) {
    env *= clampNum(stitchedTimeSec / fadeInSec, 0, 1);
  }
  if (fadeOutSec > 0.02 && stitchedDurationSec > 0) {
    const remaining = stitchedDurationSec - stitchedTimeSec;
    if (remaining < fadeOutSec) {
      env *= clampNum(remaining / fadeOutSec, 0, 1);
    }
  }
  return Number((baseGain * env).toFixed(3));
}

export function updateWordCueText(cues: readonly WordCue[], index: number, text: string): WordCue[] {
  return cues.map((c, i) => (i === index ? { ...c, text } : c));
}

export function updateWordCueTiming(
  cues: readonly WordCue[],
  index: number,
  startMs: number,
  endMs: number
): WordCue[] {
  const safeStart = Math.max(0, Math.round(startMs));
  const safeEnd = Math.max(safeStart + 120, Math.round(endMs));
  return cues
    .map((c, i) => (i === index ? { ...c, start_ms: safeStart, end_ms: safeEnd } : c))
    .sort((a, b) => a.start_ms - b.start_ms);
}

export function addWordCue(cues: readonly WordCue[], atSec: number, text = 'New caption'): WordCue[] {
  const startMs = Math.max(0, Math.round(atSec * 1000));
  const next: WordCue = {
    start_ms: startMs,
    end_ms: startMs + 1600,
    text: text.trim() || 'New caption',
  };
  return [...cues, next].sort((a, b) => a.start_ms - b.start_ms);
}

export function deleteWordCue(cues: readonly WordCue[], index: number): WordCue[] {
  return cues.filter((_, i) => i !== index);
}

/**
 * Maps a source timeline timestamp (seconds) into output stitched time (seconds),
 * matching `fe` in decompiled `main.js` line 3391.
 */
export function mapSourceTimeToStitched(
  sourceTimeSec: number,
  segments: readonly ClipSegment[],
  speed = 1
): number {
  const safeSpeed = clampNum(speed || 1, 0.25, 4);
  const sorted = sortSegments(segments);
  let elapsed = 0;
  for (const seg of sorted) {
    if (sourceTimeSec >= seg.start && sourceTimeSec <= seg.end) {
      return (elapsed + (sourceTimeSec - seg.start)) / safeSpeed;
    }
    if (sourceTimeSec < seg.start) {
      return elapsed / safeSpeed;
    }
    elapsed += seg.end - seg.start;
  }
  return elapsed / safeSpeed;
}

/**
 * Determines whether playback at `sourceTimeSec` is inside a segment, needs to jump to the next segment,
 * or has reached the end of the final segment (triggering outro/loop).
 */
export function resolveStitchedPlaybackStep(
  sourceTimeSec: number,
  segments: readonly ClipSegment[]
): { action: 'play' | 'jump' | 'end'; targetTime: number; segmentIndex: number } {
  const sorted = sortSegments(segments);
  if (sorted.length === 0) return { action: 'end', targetTime: sourceTimeSec, segmentIndex: -1 };

  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    if (sourceTimeSec >= seg.start - 0.02 && sourceTimeSec < seg.end - 0.02) {
      return { action: 'play', targetTime: sourceTimeSec, segmentIndex: i };
    }
    if (sourceTimeSec < seg.start - 0.02) {
      return { action: 'jump', targetTime: seg.start, segmentIndex: i };
    }
  }
  return {
    action: 'end',
    targetTime: sorted[sorted.length - 1].end,
    segmentIndex: sorted.length - 1,
  };
}

/* ---------- Background Music Offset & Riser Surge Engine (exact VS & HS math) ---------- */

/** Exact `VS(music, totalDur)` offset wrap from decompiled renderer.js line 26554 */
export function computeMusicOffset(
  offsetSec: number,
  musicDurationSec: number,
  totalClipDurSec: number
): number {
  if (offsetSec <= 0) return 0;
  if (offsetSec >= totalClipDurSec || musicDurationSec <= 0) {
    return Math.max(0, offsetSec - totalClipDurSec);
  }
  return (((offsetSec - totalClipDurSec) % musicDurationSec) + musicDurationSec) % musicDurationSec;
}

/**
 * Exact `HS` riser surge volume curve (0..1) from decompiled renderer.js lines 26607-26618.
 */
export function computeMusicRiserVolume(
  stitchedTimeSec: number,
  totalClipDurSec: number,
  duckedVolPct: number,
  peakVolPct: number,
  riserDurationSec: number,
  inOutro = false
): number {
  const base = clampNum(duckedVolPct / 100, 0, 1);
  const peak = clampNum(peakVolPct / 100, 0, 1);
  if (inOutro) return peak;

  const riser = Math.max(0, riserDurationSec || 0);
  if (riser > 0.05 && totalClipDurSec > 0.1) {
    const riserStart = Math.max(0, totalClipDurSec - riser);
    const span = Math.max(0.1, totalClipDurSec - riserStart);
    if (stitchedTimeSec < riserStart) return base;
    const progress = clampNum((stitchedTimeSec - riserStart) / span, 0, 1);
    return clampNum(base + (peak - base) * progress, 0, 1);
  }
  return base;
}

/** Auto-suggested music levels for the current clip */
export function autoSuggestMusicLevels(clipDurationSec: number): {
  audioBaseVol: number;
  audioPeakVol: number;
  riserDurationSec: number;
  musicOffsetSec: number;
} {
  const dur = Math.max(2, clipDurationSec || 15);
  const riser = Number(clampNum(dur * 0.22, 2, 6).toFixed(1));
  return {
    audioBaseVol: 15,
    audioPeakVol: 85,
    riserDurationSec: riser,
    musicOffsetSec: dur > 20 ? 12 : 0,
  };
}

/* ---------- Sound Effects (SFX) Trigger & Built-In Web Audio Synthesizer ---------- */

export function findTriggeredSfxCues(
  prevTimeSec: number,
  currTimeSec: number,
  cues: readonly SfxCue[]
): SfxCue[] {
  if (currTimeSec <= prevTimeSec || currTimeSec - prevTimeSec > 0.75) return [];
  return cues.filter((c) => prevTimeSec < c.time && currTimeSec >= c.time);
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) sharedAudioCtx = new Ctor();
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playSfxAsset(asset: SfxAsset, volume = 0.85): void {
  const safeVol = clampNum(volume, 0, 1);
  if (asset.url) {
    const audio = new Audio(asset.url);
    audio.volume = safeVol;
    audio.play().catch(() => {});
    return;
  }
  if (!asset.builtin) return;
  playBuiltinSfx(asset.builtin, safeVol);
}

export function playBuiltinSfx(kind: BuiltinSfxKind, volume = 0.85): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);

  if (kind === 'pop') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.09);
    gain.gain.setValueAtTime(volume * 0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.11);
    return;
  }

  if (kind === 'boom') {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.42);
    gain.gain.setValueAtTime(volume * 0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.46);
    return;
  }

  if (kind === 'ding') {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, now);
    osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.08);
    gain.gain.setValueAtTime(volume * 0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.46);
    return;
  }

  // 'whoosh' / 'swoosh': filtered noise sweep
  const dur = kind === 'swoosh' ? 0.24 : 0.38;
  const bufferSize = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = kind === 'swoosh' ? 2.5 : 1.4;
  filter.frequency.setValueAtTime(kind === 'swoosh' ? 400 : 220, now);
  filter.frequency.exponentialRampToValueAtTime(kind === 'swoosh' ? 2400 : 1400, now + dur * 0.55);
  filter.frequency.exponentialRampToValueAtTime(320, now + dur);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(volume * 0.45, now + dur * 0.45);
  gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  noise.connect(filter);
  filter.connect(gain);
  noise.start(now);
  noise.stop(now + dur + 0.02);
}

/* ---------- Outro Card Animation Math (exact decompiled line 26540) ---------- */

export interface OutroAnimationFrame {
  picScale: number;
  picOpacity: number;
  textOpacity: number;
  textRisePx: number;
}

export function computeOutroAnimationFrame(
  elapsedSec: number,
  outro: Pick<OutroTemplateConfig, 'animDuration'>,
  canvasWidth = 1080,
  canvasHeight = 1920
): OutroAnimationFrame {
  const anim = Math.max(0.25, outro.animDuration || 1.2);
  const easeOutCubic = (u: number) => 1 - Math.pow(1 - clampNum(u, 0, 1), 3);
  const p = clampNum(elapsedSec / anim, 0, 1);
  const picOpacity = clampNum(elapsedSec / (anim * 0.55), 0, 1);
  const textPhase = clampNum((elapsedSec - anim * 0.25) / (anim * 0.65), 0, 1);
  const textOpacity = easeOutCubic(textPhase);
  const scaleRef = Math.min(canvasWidth / 1080, canvasHeight / (canvasWidth > canvasHeight ? 1080 : 1920));
  return {
    picScale: Number((0.4 + 0.6 * easeOutCubic(p)).toFixed(4)),
    picOpacity: Number(picOpacity.toFixed(4)),
    textOpacity: Number(textOpacity.toFixed(4)),
    textRisePx: Math.round((1 - textOpacity) * Math.round(14 * scaleRef)),
  };
}

/* ---------- Full Short Export Spec (Framing Blueprint + Multi-Segment + Audio + ASS) ---------- */

export interface FullShortExportSpec {
  dimensions: { width: number; height: number };
  encoderFlag: string;
  stitchedDurationSec: number;
  segmentCount: number;
  ffmpegFiltergraph: string;
  ffmpegCommand: string;
  assScript: string;
  summaryLines: string[];
}

export function buildFullShortExportSpec(
  blueprint: FramingBlueprint,
  shorts: ShortsProductionConfig,
  settings: EditorSettings,
  brandKit: BrandKit,
  words: readonly WordCue[],
  trimInSec: number,
  trimOutSec: number,
  customFonts: readonly CustomFontEntry[] = []
): FullShortExportSpec {
  const dimensions = getExportPixelDimensions(blueprint.aspect, shorts.exportResolution);
  const activeSegments = getActiveSegments(shorts, trimInSec, trimOutSec);
  const effectiveSpeed = computeEffectivePlaybackSpeed(blueprint.speed, settings.speedMultiplier ?? 1);
  const stitchedDurationSec = computeStitchedDuration(activeSegments, effectiveSpeed);

  const encoderMap: Record<ShortsProductionConfig['exportEncoder'], string> = {
    auto: '-c:v libx264 -preset fast -crf 18',
    nvenc: '-c:v h264_nvenc -preset p5 -cq 19',
    videotoolbox: '-c:v h264_videotoolbox -q:v 65',
    qsv: '-c:v h264_qsv -global_quality 20',
    cpu: '-c:v libx264 -preset medium -crf 18',
  };
  const encoderFlag = encoderMap[shorts.exportEncoder] ?? encoderMap.auto;

  const filterSteps: string[] = [];
  let videoInLabel = '[0:v]';

  // 1. Multi-segment trim + concat (or single trim)
  if (activeSegments.length > 1) {
    const segLabels: string[] = [];
    activeSegments.forEach((seg, idx) => {
      filterSteps.push(
        `[0:v]trim=start=${seg.start.toFixed(2)}:end=${seg.end.toFixed(2)},setpts=PTS-STARTPTS[sv${idx}]`
      );
      segLabels.push(`[sv${idx}]`);
    });
    filterSteps.push(`${segLabels.join('')}concat=n=${activeSegments.length}:v=1:a=0[vstitched]`);
    videoInLabel = '[vstitched]';
  } else {
    const seg = activeSegments[0];
    filterSteps.push(
      `[0:v]trim=start=${seg.start.toFixed(2)}:end=${seg.end.toFixed(2)},setpts=PTS-STARTPTS[vtrimmed]`
    );
    videoInLabel = '[vtrimmed]';
  }

  // 2. Apply exact Framing Blueprint filtergraph (using unified effectiveSpeed)
  const effectiveBp: FramingBlueprint = { ...blueprint, speed: effectiveSpeed };
  const framingFilter = buildFramingFiltergraph(
    effectiveBp,
    shorts.exportResolution,
    videoInLabel,
    '[vframed]'
  );
  filterSteps.push(framingFilter);

  // 3. Apply Video Transforms + Color Grading + Vignette + Blur
  const postFilters: string[] = [];
  if (settings.videoFlipH) postFilters.push('hflip');
  if (settings.videoFlipV) postFilters.push('vflip');
  const rot = settings.videoRotation ?? 0;
  if (Math.abs(rot) > 0.1) {
    postFilters.push(`rotate=${((rot * Math.PI) / 180).toFixed(4)}:fillcolor=black`);
  }
  const vScale = (settings.videoScale ?? 100) / 100;
  if (Math.abs(vScale - 1) > 0.01) {
    const sw = Math.max(2, Math.round((dimensions.width * vScale) / 2) * 2);
    const sh = Math.max(2, Math.round((dimensions.height * vScale) / 2) * 2);
    postFilters.push(`scale=${sw}:${sh},crop=${dimensions.width}:${dimensions.height}`);
  }
  const eqParts: string[] = [];
  const netBrightness = ((settings.brightness ?? 100) + (settings.exposure ?? 0) - 100) / 100;
  if (Math.abs(netBrightness) > 0.01) eqParts.push(`brightness=${clampNum(netBrightness, -0.8, 0.8).toFixed(2)}`);
  const contrastVal = (settings.contrast ?? 100) / 100;
  if (Math.abs(contrastVal - 1) > 0.01) eqParts.push(`contrast=${clampNum(contrastVal, 0.2, 2.5).toFixed(2)}`);
  const satVal = (settings.saturation ?? 100) / 100;
  if (Math.abs(satVal - 1) > 0.01) eqParts.push(`saturation=${clampNum(satVal, 0, 3).toFixed(2)}`);
  if (eqParts.length > 0) postFilters.push(`eq=${eqParts.join(':')}`);
  if (settings.colorFilter === 'bw') postFilters.push('hue=s=0');
  if (settings.colorFilter === 'cinematic') postFilters.push('eq=contrast=1.12:saturation=1.08');
  if (settings.colorFilter === 'moody') postFilters.push('eq=brightness=-0.06:contrast=1.22:saturation=0.85');
  if ((settings.videoSharpen ?? 0) > 0) {
    const amt = clampNum((settings.videoSharpen ?? 0) / 50, 0.1, 2).toFixed(2);
    postFilters.push(`unsharp=5:5:${amt}:5:5:0.0`);
  }
  if ((settings.blur ?? 0) > 0) postFilters.push(`gblur=sigma=${settings.blur}`);
  if ((settings.vignette ?? 0) > 0) {
    const angle = clampNum((settings.vignette / 100) * (Math.PI / 3), 0.1, Math.PI / 2).toFixed(3);
    postFilters.push(`vignette=angle=${angle}`);
  }

  let preSubLabel = '[vframed]';
  if (postFilters.length > 0) {
    filterSteps.push(`[vframed]${postFilters.join(',')}[vgraded]`);
    preSubLabel = '[vgraded]';
  }

  // 3b. Composite imported full-frame template graphic overlay (PNG/WebP/SVG) when active
  const hasTemplateOverlay = Boolean(settings.templateOverlayUrl);
  if (hasTemplateOverlay) {
    const ovOpacity = clampNum((settings.templateOverlayOpacity ?? 100) / 100, 0, 1).toFixed(2);
    filterSteps.push(
      `[1:v]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba,colorchannelmixer=aa=${ovOpacity}[tov]`
    );
    filterSteps.push(`${preSubLabel}[tov]overlay=0:0:shortest=1[voverlaid]`);
    preSubLabel = '[voverlaid]';
  }

  // 4. Burn word-synced ASS subtitles + headline/watermark metadata
  const syncedSettings: EditorSettings = {
    ...settings,
    aspect: blueprint.aspect,
    layout: blueprint.layout,
    playbackSpeed: effectiveSpeed,
  };
  const assScript = generateAssSubtitle(words, syncedSettings, activeSegments[0].start, customFonts);
  filterSteps.push(`${preSubLabel}ass=captions.ass:fontsdir=./fonts[vfinal]`);

  // 5. Audio filter chain (volume, fades, EBU R128 loudness normalization)
  const audioFilters: string[] = [];
  if (Math.abs((settings.masterVolume ?? 100) - 100) > 1) {
    audioFilters.push(`volume=${((settings.masterVolume ?? 100) / 100).toFixed(2)}`);
  }
  if ((settings.audioFadeInSec ?? 0) > 0.02) {
    audioFilters.push(`afade=t=in:st=0:d=${settings.audioFadeInSec.toFixed(2)}`);
  }
  if ((settings.audioFadeOutSec ?? 0) > 0.02 && stitchedDurationSec > settings.audioFadeOutSec) {
    const fadeStart = Math.max(0, stitchedDurationSec - settings.audioFadeOutSec);
    audioFilters.push(`afade=t=out:st=${fadeStart.toFixed(2)}:d=${settings.audioFadeOutSec.toFixed(2)}`);
  }
  if (settings.audioNormalize) {
    audioFilters.push(`loudnorm=I=${settings.targetLufs ?? -14}:TP=-1.5:LRA=11`);
  }
  const audioArgs = settings.muteOriginalAudio
    ? '-an'
    : audioFilters.length > 0
      ? `-map 0:a? -af "${audioFilters.join(',')}" -c:a aac -b:a 192k`
      : '-map 0:a? -c:a aac -b:a 192k';

  const summaryLines: string[] = [
    `Framing: ${blueprint.aspect} (${dimensions.width}×${dimensions.height}) · ${blueprint.layout} · ${effectiveSpeed.toFixed(2)}×`,
    `Segments: ${activeSegments.length} part${activeSegments.length === 1 ? '' : 's'} (${stitchedDurationSec.toFixed(1)}s stitched)`,
    `Captions: ${getViralCaptionPreset(settings.captionStyle).name} · Safe Zone: ${getSafeZoneSpec(settings.safeZonePlatform, settings.template).label}`,
  ];
  if (hasTemplateOverlay) {
    summaryLines.push(
      `Template Overlay: Graphic frame (${settings.templateOverlayOpacity ?? 100}% · ${settings.templateOverlayBlendMode || 'normal'})`
    );
  }
  if (postFilters.length > 0) {
    summaryLines.push(
      `Grade & Transform: ${settings.colorFilter !== 'none' ? settings.colorFilter : 'Custom'} (${postFilters.length} filter${postFilters.length === 1 ? '' : 's'})`
    );
  }
  if (settings.audioNormalize && !settings.muteOriginalAudio) {
    summaryLines.push(`Audio Mastering: ${settings.masterVolume ?? 100}% vol · EBU R128 ${settings.targetLufs ?? -14} LUFS`);
  }
  if (settings.customAudioName) {
    summaryLines.push(
      `BGM: ${settings.customAudioName} (Ducked ${settings.audioBaseVol}% → Peak ${settings.audioPeakVol}% over ${settings.riserDurationSec}s riser)`
    );
  }
  if (shorts.sfxCues.length > 0) {
    summaryLines.push(`SFX Cues: ${shorts.sfxCues.length} placed on timeline`);
  }
  if (shorts.outro.enabled) {
    summaryLines.push(
      `Outro: ${shorts.outro.mode === 'template' ? `Template Card "${shorts.outro.text}" (${shorts.outro.duration}s)` : shorts.outro.customName || 'Custom Outro'}`
    );
  }
  if (brandKit.showWatermark && (brandKit.handle || shorts.dualWatermark.secondaryEnabled)) {
    summaryLines.push(
      `Watermarks: ${brandKit.handle || 'Custom Logo'}${shorts.dualWatermark.secondaryEnabled ? ` + ${shorts.dualWatermark.secondaryText}` : ''}`
    );
  }

  const ffmpegFiltergraph = filterSteps.join(';\n');
  const overlayInputArg = hasTemplateOverlay ? ' -i template_overlay.png' : '';
  const ffmpegCommand = `ffmpeg -i input.mp4${overlayInputArg} -filter_complex "${filterSteps.join(';')}" -map "[vfinal]" ${audioArgs} ${encoderFlag} output_short.mp4`;

  return {
    dimensions,
    encoderFlag,
    stitchedDurationSec,
    segmentCount: activeSegments.length,
    ffmpegFiltergraph,
    ffmpegCommand,
    assScript,
    summaryLines,
  };
}

export interface SubtitleTimelineBlock {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  leftPct: number;
  widthPct: number;
}

/**
 * Group word-level cues into clean, non-overlapping phrase blocks across 100%
 * of the clip duration for the NLE CC track (prevents individual 0.25s words
 * from colliding into unreadable overlapping pills or truncating past word 60).
 */
export function buildSubtitleTimelineBlocks(
  words: readonly WordCue[],
  durationSec: number
): SubtitleTimelineBlock[] {
  if (!words.length || durationSec <= 0) return [];

  const rawGroups: Array<{ text: string; startSec: number; endSec: number }> = [];
  let buf: WordCue[] = [];

  const flush = () => {
    if (!buf.length) return;
    const startSec = Math.max(0, buf[0].start_ms / 1000);
    const endSec = Math.min(durationSec, Math.max(startSec + 0.12, buf[buf.length - 1].end_ms / 1000));
    rawGroups.push({
      text: buf.map((w) => w.text.trim()).filter(Boolean).join(' '),
      startSec,
      endSec,
    });
    buf = [];
  };

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (!w.text.trim()) continue;
    const prev = buf[buf.length - 1];
    const gapMs = prev ? w.start_ms - prev.end_ms : 0;
    const spanMs = buf.length > 0 ? w.end_ms - buf[0].start_ms : 0;

    if (buf.length > 0 && (gapMs >= 380 || spanMs >= 2400 || buf.length >= 4)) {
      flush();
    }
    buf.push(w);

    const trimmed = w.text.trim();
    if (trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?')) {
      flush();
    }
  }
  flush();

  const gapPct = 0.2;
  return rawGroups.map((g, idx) => {
    const leftPct = clampNum((g.startSec / durationSec) * 100, 0, 99.4);
    const nextStartPct =
      idx + 1 < rawGroups.length
        ? clampNum((rawGroups[idx + 1].startSec / durationSec) * 100, leftPct, 100)
        : 100;
    const maxAvail = Math.max(0.25, nextStartPct - leftPct - (idx + 1 < rawGroups.length ? gapPct : 0));
    const naturalWidth = Math.max(0.4, ((g.endSec - g.startSec) / durationSec) * 100);
    const widthPct = Math.min(naturalWidth, maxAvail, 100 - leftPct);

    return {
      id: `cc-${idx}-${Math.round(g.startSec * 1000)}`,
      text: g.text,
      startSec: g.startSec,
      endSec: g.endSec,
      leftPct: Number(leftPct.toFixed(3)),
      widthPct: Number(Math.max(0.2, widthPct).toFixed(3)),
    };
  });
}

