import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { ClipItem } from '../../types';
import { PLAYBACK_SPEEDS } from '../../presets';
import { formatTimecode } from '../../lib/studioLogic';
import { StudioSlider } from '../ui/Primitives';

interface EditorTimelineProps {
  clip: ClipItem | null;
  playing: boolean;
  currentTimeSec: number;
  durationSec: number;
  trimInSec: number;
  trimOutSec: number;
  playbackSpeed: number;
  zoomPct: number;
  audioPeak: boolean;
  customAudioName: string;
  onTogglePlay: () => void;
  onSeekDelta: (deltaSec: number) => void;
  onSeekTo: (timeSec: number) => void;
  onChangeSpeed: (speed: number) => void;
  onSetIn: () => void;
  onSetOut: () => void;
  onResetTrim: () => void;
  onChangeZoom: (pct: number) => void;
  onFitZoom: () => void;
}

export function EditorTimeline({
  clip,
  playing,
  currentTimeSec,
  durationSec,
  trimInSec,
  trimOutSec,
  playbackSpeed,
  zoomPct,
  audioPeak,
  customAudioName,
  onTogglePlay,
  onSeekDelta,
  onSeekTo,
  onChangeSpeed,
  onSetIn,
  onSetOut,
  onResetTrim,
  onChangeZoom,
  onFitZoom,
}: EditorTimelineProps) {
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!speedOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) {
        setSpeedOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [speedOpen]);

  const clipTrimDuration = Math.max(0, trimOutSec - trimInSec);
  const playheadPct = durationSec > 0 ? Math.max(0, Math.min(100, (currentTimeSec / durationSec) * 100)) : 0;
  const trimLeftPct = durationSec > 0 ? (trimInSec / durationSec) * 100 : 0;
  const trimWidthPct = durationSec > 0 ? (clipTrimDuration / durationSec) * 100 : 100;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!clip || durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeekTo(ratio * durationSec);
  };

  return (
    <div
      data-testid="editor-timeline"
      className="shrink-0 rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] px-3.5 py-2.5 flex flex-col gap-2.5"
    >
      {/* Unified Transport & Trim Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left: Playback Transport + Preview Speed Popover (Single Source of Truth) */}
        <div className="flex items-center gap-1.5">
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
            className="h-7 w-8 rounded-md bg-[var(--pc-cta-bg)] text-[var(--pc-cta-fg)] border-0 grid place-items-center cursor-pointer hover:opacity-90 disabled:opacity-40"
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

          <span className="font-mono-tabular text-[11.5px] text-[var(--pc-ink)] px-2">
            {formatTimecode(currentTimeSec)}{' '}
            <span className="text-[var(--pc-muted)]">/ {formatTimecode(durationSec)}</span>
          </span>

          {/* Preview Speed Popover */}
          <div ref={speedRef} className="relative">
            <button
              type="button"
              disabled={!clip}
              aria-haspopup="menu"
              aria-expanded={speedOpen}
              aria-label="Preview playback speed"
              onClick={() => setSpeedOpen((v) => !v)}
              className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[11px] font-mono-tabular text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
            >
              <span>{playbackSpeed.toFixed(playbackSpeed % 1 === 0 ? 1 : 2)}x</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {speedOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 mb-1 py-1 w-24 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-xl z-40"
              >
                {PLAYBACK_SPEEDS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    role="menuitemradio"
                    aria-checked={playbackSpeed === spd}
                    onClick={() => {
                      onChangeSpeed(spd);
                      setSpeedOpen(false);
                    }}
                    className={`w-full px-3 py-1 text-left text-xs font-mono-tabular cursor-pointer bg-transparent border-0 ${
                      playbackSpeed === spd
                        ? 'text-[var(--pc-accent)] font-semibold bg-[var(--pc-accent-soft)]'
                        : 'text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)]'
                    }`}
                  >
                    {spd.toFixed(spd % 1 === 0 ? 1 : 2)}x
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Center: In / Out Trim Readouts & Actions */}
        <div className="flex items-center gap-1.5 text-[11px] font-mono-tabular">
          <span className="text-[var(--pc-muted)]">In</span>
          <span className="px-1.5 py-0.5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[var(--pc-ink)]">
            {formatTimecode(trimInSec)}
          </span>
          <span className="text-[var(--pc-muted)] ml-1">Out</span>
          <span className="px-1.5 py-0.5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[var(--pc-ink)]">
            {formatTimecode(trimOutSec)}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-[var(--pc-accent-soft)] border border-[var(--pc-accent)]/30 text-[var(--pc-accent)]">
            {clipTrimDuration.toFixed(1)}s
          </span>

          <button
            type="button"
            disabled={!clip}
            onClick={onSetIn}
            title="Set In point ([)"
            className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[11px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer disabled:opacity-40 ml-1"
          >
            [ In
          </button>
          <button
            type="button"
            disabled={!clip}
            onClick={onSetOut}
            title="Set Out point (])"
            className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[11px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer disabled:opacity-40"
          >
            Out ]
          </button>
          <button
            type="button"
            disabled={!clip}
            onClick={onResetTrim}
            aria-label="Reset trim"
            title="Reset trim to full duration"
            className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-40"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        {/* Right: Zoom Control */}
        <div className="hidden xl:flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-[var(--pc-muted)]">Zoom</span>
          <div className="w-36 shrink-0">
            <StudioSlider
              compact
              min={50}
              max={200}
              value={zoomPct}
              unit="%"
              onChange={onChangeZoom}
            />
          </div>
          <button
            type="button"
            onClick={onFitZoom}
            className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[11px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer shrink-0"
          >
            Fit
          </button>
        </div>
      </div>

      {/* Always-Visible Multi-Track Lanes (CC, V1, A1, A2) */}
      <div className="border-t border-[var(--pc-border-subtle)] pt-2 overflow-x-auto studio-scroll">
        <div
          className="space-y-1.5 relative min-w-full"
          style={{ width: `${zoomPct}%` }}
        >
          {/* Playhead Scrubber Line */}
          {clip && (
            <div
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-[32px] right-0 pointer-events-none z-20"
            >
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-[var(--pc-accent)]"
                style={{ left: `${playheadPct}%` }}
              >
                <span className="absolute -top-1 -left-[3px] w-2 h-2 rounded-full bg-[var(--pc-accent)]" />
              </div>
            </div>
          )}

          {/* CC Track */}
          <div className="flex items-center gap-2 h-6">
            <span className="w-6 h-6 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center font-mono-tabular text-[10px] text-[var(--pc-sub)] shrink-0">
              CC
            </span>
            <div
              onClick={handleTrackClick}
              className="relative flex-1 h-6 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] overflow-hidden cursor-pointer flex items-center px-2"
            >
              {clip && clip.words.length > 0 ? (
                <div className="flex items-center gap-1 w-full overflow-hidden">
                  {clip.words.map((cue, i) => (
                    <span
                      key={i}
                      className="h-4 px-1.5 rounded-xs bg-[var(--pc-surface)] border border-[var(--pc-border)] text-[10px] text-[var(--pc-sub)] truncate max-w-[140px] leading-4"
                    >
                      {cue.text}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[10.5px] text-[var(--pc-muted)]">Captions track</span>
              )}
            </div>
          </div>

          {/* V1 Track */}
          <div className="flex items-center gap-2 h-6">
            <span className="w-6 h-6 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center font-mono-tabular text-[10px] text-[var(--pc-ink)] shrink-0">
              V1
            </span>
            <div
              onClick={handleTrackClick}
              className="relative flex-1 h-6 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] overflow-hidden cursor-pointer flex items-center px-2"
            >
              {clip && (
                <div
                  className="absolute top-0 bottom-0 bg-[var(--pc-accent-soft)] border-x-2 border-[var(--pc-accent)] pointer-events-none"
                  style={{ left: `${trimLeftPct}%`, width: `${trimWidthPct}%` }}
                />
              )}
              <span className="relative z-10 text-[10.5px] text-[var(--pc-ink)] truncate">
                {clip ? clip.title : 'Source video track'}
              </span>
            </div>
          </div>

          {/* A1 Master Audio */}
          <div className="flex items-center gap-2 h-5">
            <span className="w-6 h-5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center font-mono-tabular text-[10px] text-[var(--pc-sub)] shrink-0">
              A1
            </span>
            <div
              onClick={handleTrackClick}
              className="relative flex-1 h-5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] overflow-hidden cursor-pointer flex items-center px-2"
            >
              <span className="text-[10px] text-[var(--pc-sub)]">
                {clip ? 'Master vocal audio · Normalized -14 LUFS' : 'Master audio'}
              </span>
            </div>
          </div>

          {/* A2 Music / Peak Riser */}
          <div className="flex items-center gap-2 h-5">
            <span className="w-6 h-5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center font-mono-tabular text-[10px] text-[var(--pc-muted)] shrink-0">
              A2
            </span>
            <div className="flex-1 h-5 rounded bg-[var(--pc-surface-2)]/60 border border-[var(--pc-border)] flex items-center px-2">
              <span className="text-[10px] text-[var(--pc-muted)] truncate">
                {customAudioName
                  ? `Track: ${customAudioName}`
                  : audioPeak
                    ? 'Audio peak riser active (final seconds)'
                    : 'Background audio / riser inactive'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
