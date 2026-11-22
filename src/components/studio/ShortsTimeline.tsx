import React, { useMemo, useState } from 'react';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type {
  ClipItem,
  ClipSegment,
  SfxCue,
  ShortsProductionConfig,
  TimelineMarker,
  TrackStates,
} from '../../types';
import { formatSmpteTimecode, formatTimecode } from '../../lib/studioLogic';
import {
  buildSubtitleTimelineBlocks,
  computeStitchedDuration,
  getActiveSegments,
} from '../../lib/shortsEngine';
import { StudioSlider } from '../ui/Primitives';

interface ShortsTimelineProps {
  clip: ClipItem | null;
  shorts: ShortsProductionConfig;
  playbackSpeed: number;
  playing: boolean;
  finalPreviewLocked: boolean;
  currentTimeSec: number;
  durationSec: number;
  trimInSec: number;
  trimOutSec: number;
  activeSegmentId: string | null;
  zoomPct: number;
  audioBaseVol: number;
  audioPeakVol: number;
  riserDurationSec: number;
  customAudioName: string;
  masterVolume: number;
  audioFadeInSec: number;
  audioFadeOutSec: number;
  trackStates: TrackStates;
  splits?: number[];
  markers?: TimelineMarker[];
  onToggleTrackState: (key: keyof TrackStates) => void;
  onTogglePlay: () => void;
  onToggleFinalPreview: () => void;
  onSeekDelta: (deltaSec: number) => void;
  onSeekTo: (timeSec: number) => void;
  onChangeTrimWindow: (inSec: number, outSec: number) => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onResetTrim: () => void;
  onSplitAtPlayhead: () => void;
  onDuplicateActiveSegment: () => void;
  onAddMarker: () => void;
  onDeleteMarker: (markerId: string) => void;
  onToggleMultiSegment: () => void;
  onAddSegment: () => void;
  onSelectSegment: (seg: ClipSegment) => void;
  onRemoveSegment: (segId: string) => void;
  onRemoveSfxCue: (cueId: string) => void;
  onChangeZoom: (pct: number) => void;
  onFitZoom: () => void;
}

/** Deterministic lightweight waveform bars so A1/A2 look like real NLE audio tracks without decoding overhead. */
function buildWaveformHeights(seedKey: string, barCount: number): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedKey.length; i += 1) {
    hash ^= seedKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < barCount; i += 1) {
    hash ^= (i + 1) * 2654435761;
    hash = Math.imul(hash, 16777619);
    const norm = ((hash >>> 0) % 1000) / 1000;
    const envelope = Math.sin((i / Math.max(1, barCount - 1)) * Math.PI);
    const height = Math.round(18 + (0.35 + 0.65 * envelope) * norm * 72);
    bars.push(Math.max(16, Math.min(92, height)));
  }
  return bars;
}

export function ShortsTimeline({
  clip,
  shorts,
  playbackSpeed,
  playing,
  finalPreviewLocked,
  currentTimeSec,
  durationSec,
  trimInSec,
  trimOutSec,
  activeSegmentId,
  zoomPct,
  audioBaseVol,
  audioPeakVol,
  riserDurationSec,
  customAudioName,
  masterVolume,
  audioFadeInSec,
  audioFadeOutSec,
  trackStates,
  splits = [],
  markers = [],
  onToggleTrackState,
  onTogglePlay,
  onToggleFinalPreview,
  onSeekDelta,
  onSeekTo,
  onChangeTrimWindow,
  onSetIn,
  onSetOut,
  onResetTrim,
  onSplitAtPlayhead,
  onDuplicateActiveSegment,
  onAddMarker,
  onDeleteMarker,
  onToggleMultiSegment,
  onAddSegment,
  onSelectSegment,
  onRemoveSegment,
  onRemoveSfxCue,
  onChangeZoom,
  onFitZoom,
}: ShortsTimelineProps) {
  const [trimLocked, setTrimLocked] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [skimSec, setSkimSec] = useState<number | null>(null);

  const subtitleBlocks = useMemo(
    () => buildSubtitleTimelineBlocks(clip?.words ?? [], durationSec),
    [clip?.words, durationSec]
  );

  const a1Wave = useMemo(
    () => buildWaveformHeights(clip?.id || 'a1-default', 72),
    [clip?.id]
  );
  const a2Wave = useMemo(
    () => buildWaveformHeights(customAudioName || 'a2-default', 72),
    [customAudioName]
  );

  const activeSegments = getActiveSegments(shorts, trimInSec, trimOutSec);
  const stitchedDur = computeStitchedDuration(activeSegments, playbackSpeed);
  const playheadPct =
    durationSec > 0 ? Math.max(0, Math.min(100, (currentTimeSec / durationSec) * 100)) : 0;
  const skimPct =
    skimSec !== null && durationSec > 0
      ? Math.max(0, Math.min(100, (skimSec / durationSec) * 100))
      : null;

  const snapTargets = useMemo(() => {
    const pts = new Set<number>([0, durationSec, trimInSec, trimOutSec]);
    splits.forEach((s) => pts.add(s));
    markers.forEach((m) => pts.add(m.timeSec));
    shorts.segments.forEach((seg) => {
      pts.add(seg.start);
      pts.add(seg.end);
    });
    return Array.from(pts);
  }, [durationSec, trimInSec, trimOutSec, splits, markers, shorts.segments]);

  const applySnap = (rawSec: number): number => {
    if (!snapEnabled || durationSec <= 0) return Number(rawSec.toFixed(2));
    const threshold = Math.max(0.12, (durationSec * 0.012) / (zoomPct / 100));
    let closest = rawSec;
    let bestDiff = threshold;
    for (const target of snapTargets) {
      const diff = Math.abs(target - rawSec);
      if (diff <= bestDiff) {
        bestDiff = diff;
        closest = target;
      }
    }
    return Number(closest.toFixed(2));
  };

  const clientXToTime = (clientX: number, rect: DOMRect, allowSnap = false): number => {
    if (rect.width <= 0 || durationSec <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = ratio * durationSec;
    return allowSnap ? applySnap(raw) : Number(raw.toFixed(2));
  };

  // Smooth NLE pointer-drag playhead scrubbing across ruler & tracks
  const startScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!clip || durationSec <= 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const laneEl = e.currentTarget;
    const scrubAt = (clientX: number) => {
      const rect = laneEl.getBoundingClientRect();
      onSeekTo(clientXToTime(clientX, rect, true));
    };
    scrubAt(e.clientX);

    const onMove = (ev: PointerEvent) => scrubAt(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleTrackHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!clip || durationSec <= 0) return;
    setSkimSec(clientXToTime(e.clientX, e.currentTarget.getBoundingClientRect(), false));
  };

  const startTrimDrag = (edge: 'in' | 'out', e: React.PointerEvent) => {
    if (trimLocked || !clip || durationSec <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const laneEl = (e.currentTarget as HTMLElement).closest('[data-timeline-lane="v1"]');
    if (!laneEl) return;

    const onMove = (ev: PointerEvent) => {
      const rect = laneEl.getBoundingClientRect();
      const t = clientXToTime(ev.clientX, rect, true);
      if (edge === 'in') {
        onChangeTrimWindow(Math.max(0, Math.min(trimOutSec - 0.5, t)), trimOutSec);
      } else {
        onChangeTrimWindow(trimInSec, Math.min(durationSec, Math.max(trimInSec + 0.5, t)));
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Dynamic timecode ruler ticks scaled to duration + zoom
  const rulerTicks = useMemo(() => {
    const dur = Math.max(1, durationSec);
    const effectiveDur = dur / (zoomPct / 100);
    const step =
      effectiveDur <= 8
        ? 1
        : effectiveDur <= 20
          ? 2
          : effectiveDur <= 50
            ? 5
            : effectiveDur <= 120
              ? 10
              : 15;
    const ticks: Array<{ sec: number; pct: number; major: boolean }> = [];
    for (let t = 0; t <= dur + 0.01; t += step) {
      const clamped = Math.min(dur, t);
      ticks.push({
        sec: clamped,
        pct: (clamped / dur) * 100,
        major: true,
      });
    }
    return ticks;
  }, [durationSec, zoomPct]);

  const trimLeftPct = durationSec > 0 ? (trimInSec / durationSec) * 100 : 0;
  const trimWidthPct =
    durationSec > 0 ? (Math.max(0.2, trimOutSec - trimInSec) / durationSec) * 100 : 100;
  const riserWidthPct =
    durationSec > 0 && riserDurationSec > 0
      ? Math.min(trimWidthPct, (riserDurationSec / durationSec) * 100)
      : 0;
  const fadeInPct =
    durationSec > 0 && audioFadeInSec > 0 ? Math.min(25, (audioFadeInSec / durationSec) * 100) : 0;
  const fadeOutPct =
    durationSec > 0 && audioFadeOutSec > 0 ? Math.min(25, (audioFadeOutSec / durationSec) * 100) : 0;

  return (
    <section
      aria-label="Shorts NLE timeline"
      className="shrink-0 border-t border-[var(--pc-border)] bg-[var(--pc-surface)] flex flex-col select-none"
    >
      {/* Row 1: NLE Editing Tools (Split, Marker, Snap, Segments) + Transport + Final Preview Lock */}
      <div className="px-3.5 py-2 border-b border-[var(--pc-border)] flex flex-wrap items-center justify-between gap-2">
        {/* Left: Core NLE Editing Tools */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={!clip}
            data-testid="split-at-playhead-btn"
            title="Razor split clip at playhead (S)"
            onClick={onSplitAtPlayhead}
            className="h-7 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-ink)] hover:border-[var(--pc-accent)] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>Split</span>
          </button>

          <button
            type="button"
            disabled={!clip}
            data-testid="add-marker-btn"
            title="Add timeline marker at playhead (M)"
            onClick={onAddMarker}
            className="h-7 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-ink)] hover:border-[var(--pc-accent)] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
          >
            <Bookmark className="w-3.5 h-3.5 text-sky-400" />
            <span>Marker</span>
          </button>

          <button
            type="button"
            aria-pressed={snapEnabled}
            data-testid="timeline-snap-toggle"
            title={snapEnabled ? 'Magnetic snapping ON' : 'Magnetic snapping OFF'}
            onClick={() => setSnapEnabled((v) => !v)}
            className={`h-7 px-2 rounded-md border text-xs font-medium inline-flex items-center gap-1 cursor-pointer transition-colors ${
              snapEnabled
                ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Snap</span>
          </button>

          <span aria-hidden="true" className="w-px h-4 bg-[var(--pc-border)] mx-0.5" />

          <button
            type="button"
            data-testid="multi-segment-toggle"
            aria-pressed={shorts.multiSegmentEnabled}
            onClick={onToggleMultiSegment}
            className={`h-7 px-2.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              shorts.multiSegmentEnabled
                ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
            }`}
          >
            <span>
              Segments{shorts.multiSegmentEnabled ? ` (${shorts.segments.length})` : ''}
            </span>
          </button>

          {shorts.multiSegmentEnabled && (
            <>
              <button
                type="button"
                data-testid="add-segment-btn"
                onClick={onAddSegment}
                title="Add new segment"
                className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add</span>
              </button>

              {activeSegmentId && (
                <>
                  <button
                    type="button"
                    data-testid="duplicate-segment-btn"
                    onClick={onDuplicateActiveSegment}
                    title="Duplicate selected segment"
                    className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
                    aria-label="Duplicate selected segment"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    data-testid="delete-segment-btn"
                    onClick={() => onRemoveSegment(activeSegmentId)}
                    title="Delete selected segment"
                    className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-error)] grid place-items-center cursor-pointer"
                    aria-label="Delete selected segment"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              <div className="hidden 2xl:flex items-center gap-1 overflow-x-auto max-w-[280px]">
                {shorts.segments.map((seg, idx) => {
                  const isActive = seg.id === activeSegmentId;
                  return (
                    <div
                      key={seg.id}
                      className={`h-6 pl-2 pr-1 rounded border text-[11px] font-mono-tabular inline-flex items-center gap-1 shrink-0 ${
                        isActive
                          ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                          : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectSegment(seg)}
                        className="bg-transparent border-0 p-0 text-inherit cursor-pointer"
                      >
                        #{idx + 1} ({(seg.end - seg.start).toFixed(1)}s)
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove segment ${idx + 1}`}
                        onClick={() => onRemoveSegment(seg.id)}
                        className="w-4 h-4 rounded grid place-items-center text-[var(--pc-muted)] hover:text-[var(--pc-error)] bg-transparent border-0 cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Center/Right: Frame Step + Transport + Speed + Final Preview Lock */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={!clip}
            onClick={() => onSeekDelta(-1)}
            aria-label="Back 1 second"
            title="Jump back 1s (J)"
            className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!clip}
            onClick={() => onSeekDelta(-1 / 30)}
            aria-label="Previous frame"
            title="Previous frame (Left Arrow)"
            className="h-7 w-6 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!clip}
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause short preview' : 'Play short preview'}
            title="Play / Pause (Space or K)"
            className="h-7 w-8 rounded-full bg-[var(--pc-cta-bg)] text-[var(--pc-cta-fg)] border-0 grid place-items-center cursor-pointer hover:opacity-90 disabled:opacity-40"
          >
            {playing ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            disabled={!clip}
            onClick={() => onSeekDelta(1 / 30)}
            aria-label="Next frame"
            title="Next frame (Right Arrow)"
            className="h-7 w-6 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!clip}
            onClick={() => onSeekDelta(1)}
            aria-label="Forward 1 second"
            title="Jump forward 1s (L)"
            className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <span className="font-mono-tabular text-[11px] text-[var(--pc-ink)] px-1 whitespace-nowrap">
            {formatTimecode(currentTimeSec)}{' '}
            <span className="text-[var(--pc-muted)]">/ {formatTimecode(durationSec)}</span>
          </span>

          {Math.abs(playbackSpeed - 1) > 0.01 && (
            <span className="font-mono-tabular text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--pc-accent-soft)] text-[var(--pc-accent)] font-semibold">
              {playbackSpeed.toFixed(2)}×
            </span>
          )}

          <button
            type="button"
            data-testid="final-preview-lock-btn"
            aria-pressed={finalPreviewLocked}
            onClick={onToggleFinalPreview}
            title="Final Preview Lock (Shift+L): auditions BGM riser, SFX cues, timed hooks & Outro"
            className={`h-7 px-2.5 rounded-md border text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              finalPreviewLocked
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400'
                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
            }`}
          >
            {finalPreviewLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            <span>{finalPreviewLocked ? 'Preview Locked' : 'Final Preview'}</span>
          </button>
        </div>
      </div>

      {/* Row 2: SMPTE Timecode, Hover SKIM, In/Out/Duration, Trim Lock & Zoom */}
      <div className="px-3.5 py-1.5 border-b border-[var(--pc-border-subtle)] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[var(--pc-ink)] font-semibold">
            {formatSmpteTimecode(currentTimeSec)}
          </span>
          <span className="text-[var(--pc-muted)]">
            SKIM{' '}
            <span className="text-[var(--pc-sub)]">
              {skimSec !== null ? formatSmpteTimecode(skimSec) : '--:--:--:--'}
            </span>
          </span>
          <span className="text-[var(--pc-sub)]">
            In <strong className="text-[var(--pc-ink)]">{formatSmpteTimecode(trimInSec)}</strong>
          </span>
          <span className="text-[var(--pc-sub)]">
            Out <strong className="text-[var(--pc-ink)]">{formatSmpteTimecode(trimOutSec)}</strong>
          </span>
          <span className="text-[var(--pc-accent)] font-medium">
            {stitchedDur.toFixed(1)}s
            {shorts.multiSegmentEnabled ? ` (${activeSegments.length} seg)` : ''}
            {shorts.outro.enabled ? ` +${shorts.outro.duration}s outro` : ''}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSetIn}
            title="Set In Point (I)"
            className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer"
          >
            [ In
          </button>
          <button
            type="button"
            onClick={onSetOut}
            title="Set Out Point (O)"
            className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer"
          >
            Out ]
          </button>
          <button
            type="button"
            onClick={() => setTrimLocked((v) => !v)}
            aria-label={trimLocked ? 'Unlock trim handles' : 'Lock trim handles'}
            title={trimLocked ? 'Unlock trim handles' : 'Lock trim handles'}
            className={`h-6 w-6 rounded border grid place-items-center cursor-pointer ${
              trimLocked
                ? 'border-[var(--pc-accent)] bg-[var(--pc-accent-soft)] text-[var(--pc-ink)]'
                : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)]'
            }`}
          >
            {trimLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          </button>
          <button
            type="button"
            onClick={onResetTrim}
            aria-label="Reset trim range"
            title="Reset trim range"
            className="h-6 w-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
          </button>

          <button
            type="button"
            aria-label="Zoom out timeline"
            onClick={() => onChangeZoom(Math.max(100, zoomPct - 40))}
            className="h-6 w-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            <Minus className="w-3 h-3" />
          </button>
          <div className="w-28 flex items-center">
            <StudioSlider
              compact
              value={zoomPct}
              min={100}
              max={400}
              step={10}
              unit="%"
              onChange={onChangeZoom}
            />
          </div>
          <button
            type="button"
            aria-label="Zoom in timeline"
            onClick={() => onChangeZoom(Math.min(400, zoomPct + 40))}
            className="h-6 w-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={onFitZoom}
            className="h-6 px-1.5 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Row 3: Interactive Timecode Ruler + 4 NLE Tracks (CC / V1 / A1 / A2) */}
      <div className="px-3.5 py-2 overflow-x-auto studio-scroll">
        <div style={{ minWidth: `${zoomPct}%` }} className="space-y-1">
          {/* Timecode Ruler + Clickable Markers */}
          <div className="flex items-center gap-2 h-5">
            <div className="w-14 shrink-0 text-[9.5px] font-mono-tabular text-[var(--pc-muted)] pl-1">
              TIME
            </div>
            <div
              data-testid="timeline-ruler"
              onPointerDown={startScrub}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full border-b border-[var(--pc-border)] cursor-ew-resize"
            >
              {rulerTicks.map((tick, idx) => (
                <div
                  key={`${tick.sec}-${idx}`}
                  style={{ left: `${tick.pct}%` }}
                  className="absolute top-0 bottom-0 pointer-events-none"
                >
                  <div className="h-2 w-px bg-[var(--pc-border)]" />
                  {tick.pct < 95 && (
                    <span className="absolute top-1.5 left-1 text-[9px] font-mono-tabular text-[var(--pc-muted)] whitespace-nowrap">
                      {Math.round(tick.sec)}s
                    </span>
                  )}
                </div>
              ))}

              {/* Interactive Ruler Markers (click to seek, right-click or title to inspect) */}
              {durationSec > 0 &&
                markers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    data-testid="shorts-timeline-marker"
                    title={`${m.label} (${formatTimecode(m.timeSec)}) · click to jump, Shift+click to delete`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.shiftKey) {
                        onDeleteMarker(m.id);
                      } else {
                        onSeekTo(m.timeSec);
                      }
                    }}
                    style={{
                      left: `${(m.timeSec / durationSec) * 100}%`,
                      backgroundColor: m.color || '#38BDF8',
                    }}
                    className="absolute bottom-0.5 w-2.5 h-2.5 rounded-xs rotate-45 -translate-x-1/2 border border-black/80 z-20 cursor-pointer hover:scale-125 transition-transform p-0"
                    aria-label={`Jump to marker ${m.label}`}
                  />
                ))}

              {/* Playhead Scrub Cap */}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute -bottom-0.5 -translate-x-1/2 w-2.5 h-3 bg-[var(--pc-accent)] rounded-t-xs pointer-events-none z-30 shadow"
              />
            </div>
          </div>

          {/* CC Subtitles Track */}
          <div className="flex items-center gap-2 h-6">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-500 font-semibold">
                CC
              </span>
              <button
                type="button"
                aria-label={trackStates.ccVisible ? 'Hide subtitles track' : 'Show subtitles track'}
                onClick={() => onToggleTrackState('ccVisible')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.ccVisible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 opacity-50" />
                )}
              </button>
            </div>
            <div
              onPointerDown={startScrub}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              {subtitleBlocks.length > 0 ? (
                subtitleBlocks.map((block) => (
                  <div
                    key={block.id}
                    data-testid="cc-timeline-block"
                    title={`${block.text} (${formatTimecode(block.startSec)} – ${formatTimecode(block.endSec)})`}
                    style={{ left: `${block.leftPct}%`, width: `${block.widthPct}%` }}
                    className={`absolute top-0.5 bottom-0.5 rounded-xs px-1.5 text-[9.5px] font-medium truncate flex items-center overflow-hidden whitespace-nowrap ${
                      trackStates.ccVisible
                        ? 'bg-violet-600/85 text-white border border-violet-400/50'
                        : 'bg-[var(--pc-surface-hover)] text-[var(--pc-muted)]'
                    }`}
                  >
                    {block.text}
                  </div>
                ))
              ) : (
                <span className="px-2 text-[10px] text-[var(--pc-muted)] leading-6">
                  No subtitles (Import .srt or add cues in Text tab)
                </span>
              )}
              {skimPct !== null && (
                <div
                  style={{ left: `${skimPct}%` }}
                  className="absolute top-0 bottom-0 w-px bg-white/35 pointer-events-none"
                />
              )}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none z-20"
              />
            </div>
          </div>

          {/* V1 Video + Multi-Segment + Trim Handles + Outro Block Track */}
          <div className="flex items-center gap-2 h-8">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500 font-semibold">
                V1
              </span>
              <button
                type="button"
                aria-label={trackStates.v1Visible ? 'Hide video track' : 'Show video track'}
                onClick={() => onToggleTrackState('v1Visible')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.v1Visible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 opacity-50" />
                )}
              </button>
            </div>
            <div
              data-timeline-lane="v1"
              onPointerDown={startScrub}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              {shorts.multiSegmentEnabled && shorts.segments.length > 0 ? (
                shorts.segments.map((seg, idx) => {
                  const left = durationSec > 0 ? (seg.start / durationSec) * 100 : 0;
                  const width =
                    durationSec > 0
                      ? Math.max(1.2, ((seg.end - seg.start) / durationSec) * 100)
                      : 100;
                  const isActive = seg.id === activeSegmentId;
                  return (
                    <div
                      key={seg.id}
                      data-testid={`v1-segment-${idx + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectSegment(seg);
                      }}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      className={`absolute top-0.5 bottom-0.5 rounded px-2 flex items-center text-[10px] font-mono-tabular font-medium truncate transition-colors ${
                        isActive
                          ? 'bg-sky-600/90 border border-sky-300 text-white z-10'
                          : 'bg-sky-700/75 border border-sky-500/50 text-sky-50 hover:bg-sky-600/85'
                      }`}
                    >
                      {isActive && (
                        <button
                          type="button"
                          aria-label="Drag active segment In handle"
                          onPointerDown={(e) => startTrimDrag('in', e)}
                          className="absolute left-0 top-0 bottom-0 w-2 bg-emerald-400/90 hover:bg-emerald-300 border-0 p-0 cursor-ew-resize"
                        />
                      )}
                      <span className="pl-1 truncate">
                        #{idx + 1} · {(seg.end - seg.start).toFixed(1)}s
                      </span>
                      {isActive && (
                        <button
                          type="button"
                          aria-label="Drag active segment Out handle"
                          onPointerDown={(e) => startTrimDrag('out', e)}
                          className="absolute right-0 top-0 bottom-0 w-2 bg-emerald-400/90 hover:bg-emerald-300 border-0 p-0 cursor-ew-resize"
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <div
                  style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
                  className={`absolute top-0.5 bottom-0.5 rounded border flex items-center px-2 text-[10px] font-mono-tabular font-medium truncate ${
                    trackStates.v1Visible
                      ? 'bg-sky-600/80 border-sky-400/60 text-white'
                      : 'bg-[var(--pc-surface-hover)] border-[var(--pc-border)] text-[var(--pc-muted)]'
                  }`}
                >
                  <button
                    type="button"
                    aria-label="Drag trim In handle"
                    onPointerDown={(e) => startTrimDrag('in', e)}
                    className="absolute left-0 top-0 bottom-0 w-2 bg-emerald-400/80 hover:bg-emerald-300 border-0 p-0 cursor-ew-resize"
                  />
                  <span className="pl-2 truncate">
                    V1 {clip ? clip.title : 'Source Clip'}
                  </span>
                  <button
                    type="button"
                    aria-label="Drag trim Out handle"
                    onPointerDown={(e) => startTrimDrag('out', e)}
                    className="absolute right-0 top-0 bottom-0 w-2 bg-emerald-400/80 hover:bg-emerald-300 border-0 p-0 cursor-ew-resize"
                  />
                </div>
              )}

              {/* Split cut lines */}
              {durationSec > 0 &&
                splits.map((sSec, sIdx) => (
                  <div
                    key={`split-${sIdx}`}
                    data-testid="shorts-timeline-split"
                    title={`Split cut at ${formatTimecode(sSec)}`}
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 pointer-events-none"
                    style={{ left: `${(sSec / durationSec) * 100}%` }}
                  />
                ))}

              {/* Orange OUTRO block indicator */}
              {shorts.outro.enabled && (
                <div
                  style={{ right: 0, width: '10%' }}
                  className="absolute top-0.5 bottom-0.5 rounded-r bg-orange-500/75 border-l border-orange-200/60 px-1.5 flex items-center text-[9.5px] font-mono-tabular font-semibold text-white truncate pointer-events-none"
                >
                  OUTRO ({shorts.outro.duration}s)
                </div>
              )}

              {skimPct !== null && (
                <div
                  style={{ left: `${skimPct}%` }}
                  className="absolute top-0 bottom-0 w-px bg-white/35 pointer-events-none"
                />
              )}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none z-20"
              />
            </div>
          </div>

          {/* A1 Master Audio + Waveform + Fade Ramps + SFX Cue Pins */}
          <div className="flex items-center gap-2 h-6">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-500 font-semibold">
                A1
              </span>
              <button
                type="button"
                aria-label={trackStates.a1Muted ? 'Unmute master audio' : 'Mute master audio'}
                onClick={() => onToggleTrackState('a1Muted')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.a1Muted ? (
                  <VolumeX className="w-3.5 h-3.5 text-[var(--pc-error)]" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <div
              onPointerDown={startScrub}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              <div
                className={`absolute inset-y-0.5 inset-x-0 rounded px-2 flex items-center justify-between text-[10px] font-mono-tabular font-medium overflow-hidden ${
                  trackStates.a1Muted
                    ? 'bg-[var(--pc-surface-hover)] text-[var(--pc-muted)] line-through'
                    : 'bg-teal-500/20 text-[var(--pc-ink)] border border-teal-500/35'
                }`}
              >
                {/* Waveform bars */}
                {!trackStates.a1Muted && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 flex items-end justify-between gap-px px-1 opacity-25 pointer-events-none"
                  >
                    {a1Wave.map((h, i) => (
                      <span
                        key={i}
                        style={{ height: `${h}%` }}
                        className="flex-1 bg-teal-500 rounded-t-[1px]"
                      />
                    ))}
                  </div>
                )}
                {fadeInPct > 0 && !trackStates.a1Muted && (
                  <div
                    style={{ width: `${fadeInPct}%` }}
                    className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-[var(--pc-surface-2)]/85 to-transparent pointer-events-none"
                  />
                )}
                {fadeOutPct > 0 && !trackStates.a1Muted && (
                  <div
                    style={{ width: `${fadeOutPct}%` }}
                    className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-[var(--pc-surface-2)]/85 to-transparent pointer-events-none"
                  />
                )}
                <span className="relative z-10 truncate">
                  A1 Master Audio ({masterVolume}%)
                  {shorts.sfxCues.length > 0 ? ` · ${shorts.sfxCues.length} SFX` : ''}
                </span>
              </div>
              {shorts.sfxCues.map((cue: SfxCue) => {
                const left = durationSec > 0 ? (cue.time / durationSec) * 100 : 0;
                return (
                  <button
                    key={cue.id}
                    type="button"
                    title={`${cue.name} @ ${formatTimecode(cue.time)} (click to remove)`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSfxCue(cue.id);
                    }}
                    style={{ left: `${left}%` }}
                    className="absolute top-0.5 bottom-0.5 px-1 rounded bg-amber-500/85 text-black text-[9px] font-bold border-0 cursor-pointer z-20 hover:bg-amber-400"
                  >
                    SFX
                  </button>
                );
              })}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none z-20"
              />
            </div>
          </div>

          {/* A2 Background Music + Waveform + Riser Surge Zone */}
          <div className="flex items-center gap-2 h-6">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-500 font-semibold">
                A2
              </span>
              <button
                type="button"
                aria-label={
                  trackStates.a2Muted ? 'Unmute background music' : 'Mute background music'
                }
                onClick={() => onToggleTrackState('a2Muted')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.a2Muted ? (
                  <VolumeX className="w-3.5 h-3.5 text-[var(--pc-error)]" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <div
              onPointerDown={startScrub}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              {customAudioName ? (
                <>
                  <div
                    style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
                    className={`absolute top-0.5 bottom-0.5 rounded px-2 flex items-center text-[10px] font-mono-tabular font-medium truncate overflow-hidden ${
                      trackStates.a2Muted
                        ? 'bg-[var(--pc-surface-hover)] text-[var(--pc-muted)] line-through'
                        : 'bg-rose-500/20 text-[var(--pc-ink)] border border-rose-500/35'
                    }`}
                  >
                    {!trackStates.a2Muted && (
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 flex items-end justify-between gap-px px-1 opacity-25 pointer-events-none"
                      >
                        {a2Wave.map((h, i) => (
                          <span
                            key={i}
                            style={{ height: `${h}%` }}
                            className="flex-1 bg-rose-500 rounded-t-[1px]"
                          />
                        ))}
                      </div>
                    )}
                    <span className="relative z-10 truncate">
                      ♪ {customAudioName} ({audioBaseVol}% → {audioPeakVol}%)
                    </span>
                  </div>
                  {riserWidthPct > 0 && !trackStates.a2Muted && (
                    <div
                      style={{
                        left: `${Math.max(trimLeftPct, trimLeftPct + trimWidthPct - riserWidthPct)}%`,
                        width: `${riserWidthPct}%`,
                      }}
                      className="absolute top-0.5 bottom-0.5 rounded-r bg-gradient-to-r from-rose-500/15 to-amber-400/55 border-r border-amber-300/70 pointer-events-none"
                    />
                  )}
                </>
              ) : (
                <span className="px-2 text-[10px] text-[var(--pc-muted)] leading-6">
                  No background music (Add in Audio tab)
                </span>
              )}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none z-20"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
