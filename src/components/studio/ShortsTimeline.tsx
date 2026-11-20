import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  SkipBack,
  SkipForward,
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
  TrackStates,
} from '../../types';
import { formatSmpteTimecode, formatTimecode } from '../../lib/studioLogic';
import { computeStitchedDuration, getActiveSegments } from '../../lib/shortsEngine';
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
  trackStates: TrackStates;
  onToggleTrackState: (key: keyof TrackStates) => void;
  onTogglePlay: () => void;
  onToggleFinalPreview: () => void;
  onSeekDelta: (deltaSec: number) => void;
  onSeekTo: (timeSec: number) => void;
  onChangeTrimWindow: (inSec: number, outSec: number) => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onResetTrim: () => void;
  onToggleMultiSegment: () => void;
  onAddSegment: () => void;
  onSelectSegment: (seg: ClipSegment) => void;
  onRemoveSegment: (segId: string) => void;
  onRemoveSfxCue: (cueId: string) => void;
  onChangeZoom: (pct: number) => void;
  onFitZoom: () => void;
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
  trackStates,
  onToggleTrackState,
  onTogglePlay,
  onToggleFinalPreview,
  onSeekDelta,
  onSeekTo,
  onChangeTrimWindow,
  onSetIn,
  onSetOut,
  onResetTrim,
  onToggleMultiSegment,
  onAddSegment,
  onSelectSegment,
  onRemoveSegment,
  onRemoveSfxCue,
  onChangeZoom,
  onFitZoom,
}: ShortsTimelineProps) {
  const [trimLocked, setTrimLocked] = useState(false);
  const [skimSec, setSkimSec] = useState<number | null>(null);

  const activeSegments = getActiveSegments(shorts, trimInSec, trimOutSec);
  const stitchedDur = computeStitchedDuration(activeSegments, playbackSpeed);
  const playheadPct =
    durationSec > 0 ? Math.max(0, Math.min(100, (currentTimeSec / durationSec) * 100)) : 0;
  const skimPct =
    skimSec !== null && durationSec > 0
      ? Math.max(0, Math.min(100, (skimSec / durationSec) * 100))
      : null;

  const clientXToTime = (clientX: number, rect: DOMRect): number => {
    if (rect.width <= 0 || durationSec <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Number((ratio * durationSec).toFixed(2));
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!clip || durationSec <= 0) return;
    onSeekTo(clientXToTime(e.clientX, e.currentTarget.getBoundingClientRect()));
  };

  const handleTrackHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!clip || durationSec <= 0) return;
    setSkimSec(clientXToTime(e.clientX, e.currentTarget.getBoundingClientRect()));
  };

  const startTrimDrag = (edge: 'in' | 'out', e: React.PointerEvent) => {
    if (trimLocked || !clip || durationSec <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const laneEl = (e.currentTarget as HTMLElement).parentElement?.parentElement;
    if (!laneEl) return;

    const onMove = (ev: PointerEvent) => {
      const rect = laneEl.getBoundingClientRect();
      const t = clientXToTime(ev.clientX, rect);
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

  const trimLeftPct = durationSec > 0 ? (trimInSec / durationSec) * 100 : 0;
  const trimWidthPct = durationSec > 0 ? (Math.max(0.2, trimOutSec - trimInSec) / durationSec) * 100 : 100;
  const riserWidthPct =
    durationSec > 0 && riserDurationSec > 0
      ? Math.min(trimWidthPct, (riserDurationSec / durationSec) * 100)
      : 0;

  return (
    <section
      aria-label="Shorts NLE timeline"
      className="shrink-0 border-t border-[var(--pc-border)] bg-[var(--pc-surface)] flex flex-col select-none"
    >
      {/* Row 1: Multi-Segment Stitching Bar + Transport + Final Preview Lock */}
      <div className="px-3.5 py-2 border-b border-[var(--pc-border)] flex flex-wrap items-center justify-between gap-2">
        {/* Left: Multi-Segment Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
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
            <Scissors className="w-3.5 h-3.5" />
            <span>
              Multi-Segment{shorts.multiSegmentEnabled ? ` (${shorts.segments.length})` : ''}
            </span>
          </button>

          {shorts.multiSegmentEnabled && (
            <>
              <button
                type="button"
                data-testid="add-segment-btn"
                onClick={onAddSegment}
                className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Segment</span>
              </button>

              <div className="flex items-center gap-1 overflow-x-auto max-w-[360px]">
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
                        #{idx + 1} ({formatTimecode(seg.start)}→{formatTimecode(seg.end)})
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove segment ${idx + 1}`}
                        onClick={() => onRemoveSegment(seg.id)}
                        className="w-4 h-4 rounded grid place-items-center text-[var(--pc-muted)] hover:text-[var(--pc-err)] bg-transparent border-0 cursor-pointer"
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

        {/* Center/Right: Frame Step + Transport + Final Preview Lock */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={!clip}
            onClick={() => onSeekDelta(-1)}
            aria-label="Back 1 second"
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
            title="Play / Pause (Space)"
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
            className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          <span className="font-mono-tabular text-[11px] text-[var(--pc-ink)] px-1 whitespace-nowrap">
            {formatTimecode(currentTimeSec)}{' '}
            <span className="text-[var(--pc-muted)]">/ {formatTimecode(durationSec)}</span>
          </span>

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
            className="h-6 w-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <div className="w-24 flex items-center gap-1.5 pl-1">
            <StudioSlider
              value={zoomPct}
              min={100}
              max={400}
              step={10}
              onChange={onChangeZoom}
            />
          </div>
          <button
            type="button"
            onClick={onFitZoom}
            className="h-6 px-1.5 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Row 3: 4 Pro NLE Tracks (CC / V1 / A1 + SFX / A2 + Riser) */}
      <div className="px-3.5 py-2 overflow-x-auto studio-scroll">
        <div style={{ minWidth: `${zoomPct}%` }} className="space-y-1">
          {/* CC Subtitles Track */}
          <div className="flex items-center gap-2 h-6">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-semibold">
                CC
              </span>
              <button
                type="button"
                aria-label={trackStates.ccVisible ? 'Hide subtitles track' : 'Show subtitles track'}
                onClick={() => onToggleTrackState('ccVisible')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.ccVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-50" />}
              </button>
            </div>
            <div
              onClick={handleTrackClick}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              {clip && clip.words.length > 0 ? (
                clip.words.slice(0, 60).map((w, idx) => {
                  const left = durationSec > 0 ? (w.start_ms / 1000 / durationSec) * 100 : 0;
                  const width =
                    durationSec > 0
                      ? Math.max(1.2, ((w.end_ms - w.start_ms) / 1000 / durationSec) * 100)
                      : 5;
                  return (
                    <div
                      key={`${w.start_ms}-${idx}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      className={`absolute top-0.5 bottom-0.5 rounded-xs px-1 text-[9px] truncate flex items-center ${
                        trackStates.ccVisible
                          ? 'bg-violet-500/35 text-violet-100 border border-violet-400/30'
                          : 'bg-zinc-600/20 text-zinc-400'
                      }`}
                    >
                      {w.text}
                    </div>
                  );
                })
              ) : (
                <span className="px-2 text-[10px] text-[var(--pc-muted)] leading-6">
                  No subtitles (Import .srt in Text tab)
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
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none"
              />
            </div>
          </div>

          {/* V1 Video + Multi-Segment + Outro Block Track */}
          <div className="flex items-center gap-2 h-7">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                V1
              </span>
              <button
                type="button"
                aria-label={trackStates.v1Visible ? 'Hide video track' : 'Show video track'}
                onClick={() => onToggleTrackState('v1Visible')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.v1Visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 opacity-50" />}
              </button>
            </div>
            <div
              onClick={handleTrackClick}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              {shorts.multiSegmentEnabled && shorts.segments.length > 0 ? (
                shorts.segments.map((seg, idx) => {
                  const left = durationSec > 0 ? (seg.start / durationSec) * 100 : 0;
                  const width =
                    durationSec > 0 ? Math.max(1, ((seg.end - seg.start) / durationSec) * 100) : 100;
                  const isActive = seg.id === activeSegmentId;
                  return (
                    <div
                      key={seg.id}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      className={`absolute top-0.5 bottom-0.5 rounded px-1.5 flex items-center text-[10px] font-mono-tabular truncate ${
                        isActive
                          ? 'bg-sky-500/45 border border-sky-300 text-white'
                          : 'bg-sky-600/25 border border-sky-500/40 text-sky-100'
                      }`}
                    >
                      #{idx + 1} · {(seg.end - seg.start).toFixed(1)}s
                    </div>
                  );
                })
              ) : (
                <div
                  style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
                  className={`absolute top-0.5 bottom-0.5 rounded border flex items-center px-2 text-[10px] font-mono-tabular truncate ${
                    trackStates.v1Visible
                      ? 'bg-indigo-500/30 border-indigo-400/50 text-indigo-100'
                      : 'bg-zinc-600/20 border-zinc-500/30 text-zinc-400'
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

              {/* Orange OUTRO block indicator when Outro is enabled */}
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
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none"
              />
            </div>
          </div>

          {/* A1 Master Audio + SFX Cue Pins */}
          <div className="flex items-center gap-2 h-6">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-teal-500/20 text-teal-300 font-semibold">
                A1
              </span>
              <button
                type="button"
                aria-label={trackStates.a1Muted ? 'Unmute master audio' : 'Mute master audio'}
                onClick={() => onToggleTrackState('a1Muted')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.a1Muted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div
              onClick={handleTrackClick}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              <div
                className={`absolute inset-y-0.5 inset-x-0 rounded px-2 flex items-center text-[10px] font-mono-tabular ${
                  trackStates.a1Muted
                    ? 'bg-zinc-600/20 text-zinc-400 line-through'
                    : 'bg-teal-500/20 text-teal-200'
                }`}
              >
                A1 Master Video Audio {shorts.sfxCues.length > 0 ? `· ${shorts.sfxCues.length} SFX` : ''}
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
                    className="absolute top-0.5 bottom-0.5 px-1 rounded bg-amber-500/85 text-black text-[9px] font-bold border-0 cursor-pointer z-10 hover:bg-amber-400"
                  >
                    SFX
                  </button>
                );
              })}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none"
              />
            </div>
          </div>

          {/* A2 Background Music + Riser Surge Zone */}
          <div className="flex items-center gap-2 h-6">
            <div className="w-14 shrink-0 flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-semibold">
                A2
              </span>
              <button
                type="button"
                aria-label={trackStates.a2Muted ? 'Unmute background music' : 'Mute background music'}
                onClick={() => onToggleTrackState('a2Muted')}
                className="text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {trackStates.a2Muted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div
              onClick={handleTrackClick}
              onMouseMove={handleTrackHover}
              onMouseLeave={() => setSkimSec(null)}
              className="relative flex-1 h-full rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] overflow-hidden cursor-pointer"
            >
              {customAudioName ? (
                <>
                  <div
                    style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
                    className={`absolute top-0.5 bottom-0.5 rounded px-2 flex items-center text-[10px] font-mono-tabular truncate ${
                      trackStates.a2Muted
                        ? 'bg-zinc-600/20 text-zinc-400 line-through'
                        : 'bg-rose-500/25 text-rose-100'
                    }`}
                  >
                    ♪ {customAudioName} ({audioBaseVol}% → {audioPeakVol}%)
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
                  No background music (Add in Media tab)
                </span>
              )}
              <div
                style={{ left: `${playheadPct}%` }}
                className="absolute top-0 bottom-0 w-[2px] bg-[var(--pc-accent)] pointer-events-none"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
