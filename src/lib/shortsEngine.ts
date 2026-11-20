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

/** Combined stitched duration accounting for playback speed (`te / V` in decompiled engine) */
export function computeStitchedDuration(
  segments: readonly ClipSegment[],
  speed = 1
): number {
  const safeSpeed = clampNum(speed || 1, 0.25, 4);
  const raw = sortSegments(segments).reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
  return Number((raw / safeSpeed).toFixed(3));
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

/** Auto-Suggest Levels matching YIZERGE's music level recommender */
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
  const stitchedDurationSec = computeStitchedDuration(activeSegments, blueprint.speed);

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

  // 2. Apply exact Framing Blueprint filtergraph from Section 1
  const framingFilter = buildFramingFiltergraph(
    blueprint,
    shorts.exportResolution,
    videoInLabel,
    '[vframed]'
  );
  filterSteps.push(framingFilter);

  // 3. Burn word-synced ASS subtitles + headline/watermark metadata
  const syncedSettings: EditorSettings = {
    ...settings,
    aspect: blueprint.aspect,
    layout: blueprint.layout,
    playbackSpeed: blueprint.speed,
  };
  const assScript = generateAssSubtitle(words, syncedSettings, activeSegments[0].start, customFonts);
  filterSteps.push(`[vframed]ass=captions.ass:fontsdir=./fonts[vfinal]`);

  // 4. Audio summary (BGM riser & SFX cues)
  const summaryLines: string[] = [
    `Framing: ${blueprint.aspect} (${dimensions.width}×${dimensions.height}) · ${blueprint.layout} · ${blueprint.speed.toFixed(2)}×`,
    `Segments: ${activeSegments.length} part${activeSegments.length === 1 ? '' : 's'} (${stitchedDurationSec.toFixed(1)}s stitched)`,
    `Captions: ${getViralCaptionPreset(settings.captionStyle).name} · Safe Zone: ${getSafeZoneSpec(settings.safeZonePlatform, settings.template).label}`,
  ];
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
  const ffmpegCommand = `ffmpeg -i input.mp4 -filter_complex "${filterSteps.join(';')}" -map "[vfinal]" -map 0:a? ${encoderFlag} -c:a aac -b:a 192k output_short.mp4`;

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
