import React, { useRef, useState } from 'react';
import {
  Columns2,
  Eye,
  EyeOff,
  Frame,
  Grid3x3,
  Lock,
  Monitor,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Unlock,
  User,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ClipItem, LayoutModeId, TrackStates } from '../../types';
import { LAYOUT_MODES } from '../../presets';
import { formatSmpteTimecode, formatTimecode } from '../../lib/studioLogic';
import { StudioSlider } from '../ui/Primitives';

interface EditorTimelineProps {
  clip: ClipItem | null;
  layout: LayoutModeId;
  onChangeLayout: (layout: LayoutModeId) => void;
  playing: boolean;
  currentTimeSec: number;
  durationSec: number;
  trimInSec: number;
  trimOutSec: number;
  onChangeTrimWindow: (inSec: number, outSec: number) => void;
  zoomPct: number;
  audioPeak: boolean;
  audioBaseVol: number;
  audioPeakVol: number;
  customAudioName: string;
  trackStates: TrackStates;
  onToggleTrackState: (key: keyof TrackStates) => void;
  onTogglePlay: () => void;
  onSeekDelta: (deltaSec: number) => void;
  onSeekTo: (timeSec: number) => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onResetTrim: () => void;
  onChangeZoom: (pct: number) => void;
  onFitZoom: () => void;
}

const LAYOUT_ICONS: Record<LayoutModeId, React.ReactNode> = {
  split: <Columns2 className="w-3.5 h-3.5 stroke-[1.75]" />,
  solo: <User className="w-3.5 h-3.5 stroke-[1.75]" />,
  trio: <Grid3x3 className="w-3.5 h-3.5 stroke-[1.75]" />,
  pip: <PictureInPicture2 className="w-3.5 h-3.5 stroke-[1.75]" />,
  centered: <Frame className="w-3.5 h-3.5 stroke-[1.75]" />,
  widescreen: <Monitor className="w-3.5 h-3.5 stroke-[1.75]" />,
};

export function EditorTimeline({
  clip,
  layout,
  onChangeLayout,
  playing,
  currentTimeSec,
  durationSec,
  trimInSec,
  trimOutSec,
  onChangeTrimWindow,
  zoomPct,
  audioPeak,
  audioBaseVol,
  audioPeakVol,
  customAudioName,
  trackStates,
  onToggleTrackState,
  onTogglePlay,
  onSeekDelta,
  onSeekTo,
  onSetIn,
  onSetOut,
  onResetTrim,
  onChangeZoom,
  onFitZoom,
}: EditorTimelineProps) {
  const [trimLocked, setTrimLocked] = useState(false);
  const [skimSec, setSkimSec] = useState<number | null>(null);
  const tracksAreaRef = useRef<HTMLDivElement>(null);

  const activeLayoutMeta = LAYOUT_MODES.find((m) => m.id === layout) ?? LAYOUT_MODES[0];
  const clipTrimDuration = Math.max(0, trimOutSec - trimInSec);
  const playheadPct =
    durationSec > 0 ? Math.max(0, Math.min(100, (currentTimeSec / durationSec) * 100)) : 0;
  const skimPct =
    skimSec !== null && durationSec > 0
      ? Math.max(0, Math.min(100, (skimSec / durationSec) * 100))
      : null;
  const trimLeftPct = durationSec > 0 ? (trimInSec / durationSec) * 100 : 0;
  const trimWidthPct = durationSec > 0 ? (clipTrimDuration / durationSec) * 100 : 100;

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
        const clampedIn = Math.max(0, Math.min(trimOutSec - 0.5, t));
        onChangeTrimWindow(clampedIn, trimOutSec);
      } else {
        const clampedOut = Math.min(durationSec, Math.max(trimInSec + 0.5, t));
        onChangeTrimWindow(trimInSec, clampedOut);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Generate 5 evenly spaced ruler tick timestamps
  const rulerTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    pct: r * 100,
    label: formatTimecode(durationSec * r).slice(0, 5),
  }));

  return (
    <div className="shrink-0 flex flex-col gap-2">
      {/* YIZERGE Integrated LAYOUT + Playback Transport Strip */}
      <div
        data-testid="layout-transport-bar"
        className="rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2"
      >
        {/* Left: Single-Source-of-Truth 6-Mode Layout Bar */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-[var(--pc-muted)] pr-1">
            Layout
          </span>
          <div
            role="radiogroup"
            aria-label="Framing layout mode"
            className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)]"
          >
            {LAYOUT_MODES.map((m) => {
              const active = layout === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChangeLayout(m.id)}
                  className={`h-7 px-2.5 rounded-md text-[11.5px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border-0 transition-colors ${
                    active
                      ? 'bg-[var(--pc-surface)] text-[var(--pc-ink)] shadow-sm'
                      : 'bg-transparent text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                  }`}
                >
                  {LAYOUT_ICONS[m.id]}
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>

          <span className="hidden 2xl:inline-block text-[11px] font-mono-tabular text-[var(--pc-sub)] pl-1.5">
            {activeLayoutMeta.badge}
          </span>
        </div>

        {/* Right: Transport Controls (<< Play >> 00:12.4 / 00:34.6) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={!clip}
            onClick={() => onSeekDelta(-5)}
            aria-label="Seek back 5 seconds"
            title="Seek -5s (Left Arrow)"
            className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <SkipBack className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>

          <button
            type="button"
            disabled={!clip}
            onClick={onTogglePlay}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
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
            onClick={() => onSeekDelta(5)}
            aria-label="Seek forward 5 seconds"
            title="Seek +5s (Right Arrow)"
            className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <SkipForward className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>

          <span className="font-mono-tabular text-[11px] text-[var(--pc-ink)] pl-1.5 whitespace-nowrap">
            {formatTimecode(currentTimeSec)}{' '}
            <span className="text-[var(--pc-muted)]">/ {formatTimecode(durationSec)}</span>
          </span>
        </div>
      </div>

      {/* YIZERGE Pro 4-Track NLE Timeline */}
      <div
        data-testid="editor-timeline"
        className="rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] px-3 py-2 flex flex-col gap-2"
      >
        {/* Top Timecode, Skim, Trim In/Out, Lock & Zoom Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-[var(--pc-muted)]">
              Timeline
            </span>
            <span className="px-1.5 py-0.5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[var(--pc-ink)]">
              {formatSmpteTimecode(currentTimeSec)}
            </span>

            {/* Live Hover Skim Counter */}
            <span
              data-testid="timeline-skim-readout"
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                skimSec !== null
                  ? 'bg-[#A3E635]/15 border-[#A3E635]/50 text-[#A3E635]'
                  : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-muted)]'
              }`}
            >
              SKIM {formatSmpteTimecode(skimSec ?? currentTimeSec)}
            </span>

            <span className="text-[var(--pc-muted)] ml-1">In</span>
            <span className="text-[var(--pc-ink)]">{formatSmpteTimecode(trimInSec)}</span>
            <span className="text-[var(--pc-muted)]">Out</span>
            <span className="text-[var(--pc-ink)]">{formatSmpteTimecode(trimOutSec)}</span>
            <span className="px-1.5 py-0.5 rounded bg-[var(--pc-accent-soft)] border border-[var(--pc-accent)]/40 text-[var(--pc-accent)]">
              {clipTrimDuration.toFixed(1)}s
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!clip || trimLocked}
              onClick={onSetIn}
              title="Set In point (I or [)"
              className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[10.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer disabled:opacity-40"
            >
              [ In
            </button>
            <button
              type="button"
              disabled={!clip || trimLocked}
              onClick={onSetOut}
              title="Set Out point (O or ])"
              className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[10.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer disabled:opacity-40"
            >
              Out ]
            </button>
            <button
              type="button"
              disabled={!clip || trimLocked}
              onClick={onResetTrim}
              aria-label="Reset trim"
              title="Reset trim to full duration"
              className="h-6 w-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setTrimLocked((v) => !v)}
              aria-pressed={trimLocked}
              aria-label={trimLocked ? 'Unlock trim handles' : 'Lock trim handles'}
              title={trimLocked ? 'Trim handles locked' : 'Lock trim handles'}
              className={`h-6 w-6 rounded border grid place-items-center cursor-pointer transition-colors ${
                trimLocked
                  ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-accent)]'
                  : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
              }`}
            >
              {trimLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            </button>

            <div className="hidden xl:flex items-center gap-1.5 pl-1.5 border-l border-[var(--pc-border)]">
              <span className="text-[10px] text-[var(--pc-muted)]">Zoom</span>
              <div className="w-28 shrink-0">
                <StudioSlider
                  compact
                  min={50}
                  max={250}
                  value={zoomPct}
                  unit="%"
                  onChange={onChangeZoom}
                />
              </div>
              <button
                type="button"
                onClick={onFitZoom}
                className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[10.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer shrink-0"
              >
                Fit
              </button>
            </div>
          </div>
        </div>

        {/* Multi-Track Lanes (CC, V1, A1, A2) with Time Ruler, Hover Skim, Track Controls & Draggable Trim Brackets */}
        <div
          ref={tracksAreaRef}
          onMouseLeave={() => setSkimSec(null)}
          className="border-t border-[var(--pc-border-subtle)] pt-1.5 overflow-x-auto studio-scroll"
        >
          <div className="space-y-1 relative min-w-full" style={{ width: `${zoomPct}%` }}>
            {/* Time Ruler Header */}
            <div className="flex items-center gap-1.5 h-3.5 pl-[56px] relative text-[9.5px] font-mono-tabular text-[var(--pc-muted)] select-none">
              <div className="relative flex-1 h-full">
                {rulerTicks.map((tk) => (
                  <span
                    key={tk.pct}
                    style={{
                      left: `${tk.pct}%`,
                      transform:
                        tk.pct === 0
                          ? 'none'
                          : tk.pct === 100
                            ? 'translateX(-100%)'
                            : 'translateX(-50%)',
                    }}
                    className="absolute top-0"
                  >
                    {tk.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Playhead + Skim Vertical Lines Overlay */}
            {clip && (
              <div
                aria-hidden="true"
                className="absolute top-0 bottom-0 left-[56px] right-0 pointer-events-none z-20"
              >
                {skimPct !== null && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-[#A3E635]/75"
                    style={{ left: `${skimPct}%` }}
                  />
                )}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-[var(--pc-accent)]"
                  style={{ left: `${playheadPct}%` }}
                >
                  <span className="absolute -top-0.5 -left-[3px] w-2 h-2 rounded-full bg-[var(--pc-accent)]" />
                </div>
              </div>
            )}

            {/* CC Captions Track */}
            <div className="flex items-center gap-1.5 h-5">
              <div className="w-[50px] shrink-0 flex items-center gap-1">
                <span className="w-6 h-5 rounded bg-violet-500/20 border border-violet-500/40 text-violet-300 grid place-items-center font-mono-tabular text-[9.5px] font-semibold">
                  CC
                </span>
                <button
                  type="button"
                  onClick={() => onToggleTrackState('ccVisible')}
                  aria-label={trackStates.ccVisible ? 'Hide captions track' : 'Show captions track'}
                  title={trackStates.ccVisible ? 'Captions visible' : 'Captions hidden'}
                  className="w-5 h-5 rounded grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 cursor-pointer"
                >
                  {trackStates.ccVisible ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3 opacity-50" />
                  )}
                </button>
              </div>
              <div
                onClick={handleTrackClick}
                onMouseMove={handleTrackHover}
                className={`relative flex-1 h-5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] overflow-hidden cursor-pointer flex items-center px-2 ${
                  trackStates.ccVisible ? '' : 'opacity-45'
                }`}
              >
                {clip && clip.words.length > 0 ? (
                  <div className="flex items-center gap-1 w-full overflow-hidden">
                    {clip.words.map((cue, i) => (
                      <span
                        key={i}
                        className="h-3.5 px-1.5 rounded-xs bg-violet-500/20 border border-violet-500/35 text-[9.5px] text-[var(--pc-ink)] truncate max-w-[140px] leading-[14px]"
                      >
                        {cue.text}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-[10px] text-[var(--pc-muted)]">
                    No subtitles (Import .srt in Text tab)
                  </span>
                )}
              </div>
            </div>

            {/* V1 Video Track with Directly Draggable In/Out Trim Brackets */}
            <div className="flex items-center gap-1.5 h-6">
              <div className="w-[50px] shrink-0 flex items-center gap-1">
                <span className="w-6 h-5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 grid place-items-center font-mono-tabular text-[9.5px] font-semibold">
                  V1
                </span>
                <button
                  type="button"
                  onClick={() => onToggleTrackState('v1Visible')}
                  aria-label={trackStates.v1Visible ? 'Hide video track' : 'Show video track'}
                  title={trackStates.v1Visible ? 'Video visible' : 'Video hidden'}
                  className="w-5 h-5 rounded grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 cursor-pointer"
                >
                  {trackStates.v1Visible ? (
                    <Eye className="w-3 h-3" />
                  ) : (
                    <EyeOff className="w-3 h-3 opacity-50" />
                  )}
                </button>
              </div>
              <div
                onClick={handleTrackClick}
                onMouseMove={handleTrackHover}
                className={`relative flex-1 h-6 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] overflow-hidden cursor-pointer flex items-center px-2 ${
                  trackStates.v1Visible ? '' : 'opacity-45'
                }`}
              >
                {clip && (
                  <div
                    className="absolute top-0 bottom-0 bg-indigo-500/20 border-y border-[#A3E635]/70"
                    style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
                  >
                    {/* Left Trim In Handle */}
                    <div
                      data-testid="timeline-trim-in-handle"
                      onPointerDown={(e) => startTrimDrag('in', e)}
                      title={trimLocked ? 'Trim locked' : 'Drag to adjust In point'}
                      className={`absolute left-0 top-0 bottom-0 w-2 bg-[#A3E635] ${
                        trimLocked ? 'cursor-not-allowed opacity-50' : 'cursor-ew-resize'
                      }`}
                    />
                    {/* Right Trim Out Handle */}
                    <div
                      data-testid="timeline-trim-out-handle"
                      onPointerDown={(e) => startTrimDrag('out', e)}
                      title={trimLocked ? 'Trim locked' : 'Drag to adjust Out point'}
                      className={`absolute right-0 top-0 bottom-0 w-2 bg-[#A3E635] ${
                        trimLocked ? 'cursor-not-allowed opacity-50' : 'cursor-ew-resize'
                      }`}
                    />
                  </div>
                )}
                <span className="relative z-10 text-[10.5px] font-medium text-[var(--pc-ink)] truncate pl-1.5 pointer-events-none">
                  {clip ? `V1  ${clip.title}  [V]` : 'Source video track'}
                </span>
              </div>
            </div>

            {/* A1 Source Audio Track */}
            <div className="flex items-center gap-1.5 h-5">
              <div className="w-[50px] shrink-0 flex items-center gap-1">
                <span className="w-6 h-5 rounded bg-teal-500/20 border border-teal-500/40 text-teal-300 grid place-items-center font-mono-tabular text-[9.5px] font-semibold">
                  A1
                </span>
                <button
                  type="button"
                  onClick={() => onToggleTrackState('a1Muted')}
                  aria-label={trackStates.a1Muted ? 'Unmute source audio' : 'Mute source audio'}
                  title={trackStates.a1Muted ? 'Source audio muted' : 'Source audio active'}
                  className="w-5 h-5 rounded grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 cursor-pointer"
                >
                  {trackStates.a1Muted ? (
                    <VolumeX className="w-3 h-3 text-[var(--pc-error)]" />
                  ) : (
                    <Volume2 className="w-3 h-3" />
                  )}
                </button>
              </div>
              <div
                onClick={handleTrackClick}
                onMouseMove={handleTrackHover}
                className={`relative flex-1 h-5 rounded border border-emerald-500/30 bg-emerald-600/20 overflow-hidden cursor-pointer flex items-center px-2 ${
                  trackStates.a1Muted ? 'opacity-35' : ''
                }`}
              >
                <span className="text-[10px] text-emerald-100/90 truncate">
                  {clip ? 'A1  Source Audio (Master)  fx' : 'Source audio'}
                </span>
              </div>
            </div>

            {/* A2 Score / Background Music Track */}
            <div className="flex items-center gap-1.5 h-5">
              <div className="w-[50px] shrink-0 flex items-center gap-1">
                <span className="w-6 h-5 rounded bg-pink-500/20 border border-pink-500/40 text-pink-300 grid place-items-center font-mono-tabular text-[9.5px] font-semibold">
                  A2
                </span>
                <button
                  type="button"
                  onClick={() => onToggleTrackState('a2Muted')}
                  aria-label={trackStates.a2Muted ? 'Unmute music track' : 'Mute music track'}
                  title={trackStates.a2Muted ? 'Music muted' : 'Music active'}
                  className="w-5 h-5 rounded grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 cursor-pointer"
                >
                  {trackStates.a2Muted ? (
                    <VolumeX className="w-3 h-3 text-[var(--pc-error)]" />
                  ) : (
                    <Volume2 className="w-3 h-3" />
                  )}
                </button>
              </div>
              <div
                onClick={handleTrackClick}
                onMouseMove={handleTrackHover}
                className={`relative flex-1 h-5 rounded border border-[var(--pc-border)] overflow-hidden cursor-pointer flex items-center px-2 ${
                  customAudioName || audioPeak ? 'bg-pink-500/15 border-pink-500/30' : 'bg-[var(--pc-surface-2)]/60'
                } ${trackStates.a2Muted ? 'opacity-35' : ''}`}
              >
                <span className="text-[10px] text-[var(--pc-muted)] truncate">
                  {customAudioName
                    ? `A2  ${customAudioName} · ${audioBaseVol}%${audioPeak ? ` → Peak ${audioPeakVol}%` : ''}`
                    : audioPeak
                      ? `Audio peak riser active (${audioBaseVol}% → ${audioPeakVol}%)`
                      : 'No music (Media tab)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
