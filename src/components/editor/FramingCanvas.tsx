import React, { useEffect, useRef } from 'react';
import { Eye, Film, Maximize2, Plus } from 'lucide-react';
import type { ClipItem, FramingBlueprint, LayoutModeId, NormalizedCrop } from '../../types';
import { Button } from '../ui/Primitives';

interface FramingCanvasProps {
  clip: ClipItem | null;
  blueprint: FramingBlueprint;
  onUpdateBlueprint: (next: FramingBlueprint, recordHistory?: boolean) => void;
  playing: boolean;
  currentTimeSec: number;
  /** Shared playback element — the same ref used by the Shorts stage & timeline engine. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onDurationLoaded?: (durationSec: number) => void;
  onOpenClipPicker?: () => void;
  onGoToDashboard?: () => void;
  /* Optional extras — harmless when omitted. */
  playbackSpeed?: number;
  muted?: boolean;
  stageRef?: React.RefObject<HTMLDivElement | null>;
  onVideoTimeUpdate?: (timeSec: number) => void;
  onVideoEnded?: () => void;
  onSwitchToLivePreview?: () => void;
  onToggleFullscreen?: () => void;
}

type BoxHandleKind = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface InteractiveBoxDescriptor {
  id: string;
  index: number;
  label: string;
  crop: NormalizedCrop;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
  fillBg: string;
}

const MIN_CROP_SIZE = 0.12;

const SLOT_IDS: Partial<Record<LayoutModeId, string[]>> = {
  split: ['primary', 'secondary'],
  trio: ['primary', 'secondary', 'tertiary'],
  pip: ['primary', 'facecam'],
  solo: ['primary'],
  centered: ['primary'],
  widescreen: ['primary'],
};

const SLOT_LABELS: Partial<Record<LayoutModeId, string[]>> = {
  split: ['Top Speaker', 'Bottom Speaker'],
  trio: ['Top Speaker', 'Bottom Speaker', 'Speaker 3'],
  pip: ['Main Speaker', 'Facecam'],
  solo: ['Main Speaker'],
  centered: ['Main Speaker'],
  widescreen: ['Main Speaker'],
};

const SLOT_PALETTES = [
  { borderColor: '#10B981', badgeBg: '#10B981', badgeText: '#041E14', fillBg: 'rgba(16, 185, 129, 0.14)' },
  { borderColor: '#A3E635', badgeBg: '#A3E635', badgeText: '#142004', fillBg: 'rgba(163, 230, 53, 0.14)' },
  { borderColor: '#38BDF8', badgeBg: '#38BDF8', badgeText: '#082032', fillBg: 'rgba(56, 189, 248, 0.14)' },
  { borderColor: '#53FC18', badgeBg: '#53FC18', badgeText: '#071A03', fillBg: 'rgba(83, 252, 24, 0.15)' },
];

/** Clamp a normalized 0..1 crop box, preserving a usable minimum size. */
function normalizeCrop(raw: NormalizedCrop): NormalizedCrop {
  const w = Math.min(1, Math.max(MIN_CROP_SIZE, raw.w));
  const h = Math.min(1, Math.max(MIN_CROP_SIZE, raw.h));
  return {
    w,
    h,
    x: Math.min(1 - w, Math.max(0, raw.x)),
    y: Math.min(1 - h, Math.max(0, raw.y)),
  };
}

/**
 * Interactive source-frame editor.
 * Shows the widescreen 16:9 source with color-coded, draggable and
 * 4-corner-resizable crop boxes mapped 1:1 to `FramingBlueprint.crops`,
 * so edits flow straight into Live Preview and FFmpeg export.
 */
export function FramingCanvas({
  clip,
  blueprint,
  onUpdateBlueprint,
  playing,
  currentTimeSec,
  videoRef,
  onDurationLoaded,
  onOpenClipPicker,
  onGoToDashboard,
  playbackSpeed,
  muted,
  stageRef,
  onVideoTimeUpdate,
  onVideoEnded,
  onSwitchToLivePreview,
  onToggleFullscreen,
}: FramingCanvasProps) {
  const sourceFrameRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<{
    index: number;
    kind: BoxHandleKind;
    startClientX: number;
    startClientY: number;
    startBox: NormalizedCrop;
    sourceBlueprint: FramingBlueprint;
    latestBox: NormalizedCrop;
  } | null>(null);

  // Shared video element: sync play/pause from props (also covers mounting this
  // component while playback is already running in the Shorts studio).
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !clip?.mediaUrl) return;
    if (playing) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [playing, clip?.mediaUrl, videoRef]);

  // Optional explicit overrides — by default the Shorts page owns speed & volume.
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (playbackSpeed !== undefined) vid.playbackRate = playbackSpeed;
    if (muted !== undefined) vid.muted = muted;
  }, [playbackSpeed, muted, videoRef, clip?.mediaUrl]);

  // Seek the shared element when the app playhead moves or on stage mount.
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !clip?.mediaUrl) return;
    if (Math.abs(vid.currentTime - currentTimeSec) > 0.35) {
      try {
        vid.currentTime = currentTimeSec;
      } catch {
        // ignore pre-metadata seek errors
      }
    }
  }, [currentTimeSec, clip?.mediaUrl, videoRef]);

  const boxes: InteractiveBoxDescriptor[] = blueprint.crops.map((rawCrop, index) => {
    const ids = SLOT_IDS[blueprint.layout] ?? [];
    const labels = SLOT_LABELS[blueprint.layout] ?? [];
    const palette = SLOT_PALETTES[index % SLOT_PALETTES.length];
    return {
      id: ids[index] ?? `slot-${index}`,
      index,
      label: labels[index] ?? (index === 1 && blueprint.layout === 'pip' ? 'Facecam' : `Speaker ${index + 1}`),
      crop: normalizeCrop(rawCrop),
      ...palette,
    };
  });

  const commitBoxUpdate = (
    index: number,
    nextBox: NormalizedCrop,
    sourceBlueprint: FramingBlueprint,
    recordHistory: boolean
  ) => {
    const nextCrops = sourceBlueprint.crops.map((c, i) => (i === index ? nextBox : c));
    onUpdateBlueprint({ ...sourceBlueprint, crops: nextCrops }, recordHistory);
  };

  const startBoxDrag = (
    index: number,
    kind: BoxHandleKind,
    currentBox: NormalizedCrop,
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      index,
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: currentBox,
      sourceBlueprint: blueprint,
      latestBox: currentBox,
    };

    const onMove = (ev: PointerEvent) => {
      const state = dragRef.current;
      const el = sourceFrameRef.current;
      if (!state || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dx = (ev.clientX - state.startClientX) / rect.width;
      const dy = (ev.clientY - state.startClientY) / rect.height;
      const b = state.startBox;
      const rightEdge = b.x + b.w;
      const bottomEdge = b.y + b.h;

      let next: NormalizedCrop;
      if (state.kind === 'move') {
        next = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
      } else if (state.kind === 'se') {
        next = {
          x: b.x,
          y: b.y,
          w: Math.min(1 - b.x, Math.max(MIN_CROP_SIZE, b.w + dx)),
          h: Math.min(1 - b.y, Math.max(MIN_CROP_SIZE, b.h + dy)),
        };
      } else if (state.kind === 'sw') {
        const nextX = Math.max(0, Math.min(rightEdge - MIN_CROP_SIZE, b.x + dx));
        next = {
          x: nextX,
          y: b.y,
          w: rightEdge - nextX,
          h: Math.min(1 - b.y, Math.max(MIN_CROP_SIZE, b.h + dy)),
        };
      } else if (state.kind === 'ne') {
        const nextY = Math.max(0, Math.min(bottomEdge - MIN_CROP_SIZE, b.y + dy));
        next = {
          x: b.x,
          y: nextY,
          w: Math.min(1 - b.x, Math.max(MIN_CROP_SIZE, b.w + dx)),
          h: bottomEdge - nextY,
        };
      } else {
        const nextX = Math.max(0, Math.min(rightEdge - MIN_CROP_SIZE, b.x + dx));
        const nextY = Math.max(0, Math.min(bottomEdge - MIN_CROP_SIZE, b.y + dy));
        next = {
          x: nextX,
          y: nextY,
          w: rightEdge - nextX,
          h: bottomEdge - nextY,
        };
      }

      state.latestBox = normalizeCrop(next);
      commitBoxUpdate(state.index, state.latestBox, state.sourceBlueprint, false);
    };

    const onUp = () => {
      if (dragRef.current) {
        const { index: finalIndex, latestBox, sourceBlueprint } = dragRef.current;
        dragRef.current = null;
        commitBoxUpdate(finalIndex, latestBox, sourceBlueprint, true);
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={stageRef}
      data-testid="framing-stage"
      className="relative flex-1 min-h-0 rounded-xl bg-[#08090B] border border-[var(--pc-border)] flex items-center justify-center p-5 overflow-hidden select-none"
    >
      {!clip ? (
        <div className="max-w-sm text-center px-6 py-8">
          <div className="w-11 h-11 rounded-xl bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center mx-auto mb-3.5 text-[var(--pc-sub)]">
            <Film className="w-5 h-5 stroke-[1.75]" />
          </div>
          <h3 className="text-sm font-semibold text-white m-0">No clip loaded</h3>
          <p className="text-xs text-zinc-400 mt-1.5 mb-5 leading-relaxed">
            Pick an existing clip from your workspace or import a video to frame speakers directly on the 16:9 source.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="primary" size="sm" onClick={onOpenClipPicker}>
              Choose from Clips
            </Button>
            <Button variant="secondary" size="sm" onClick={onGoToDashboard}>
              <Plus className="w-3.5 h-3.5" />
              <span>Import Source</span>
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Centered 16:9 source canvas */}
          <div
            ref={sourceFrameRef}
            data-testid="framing-source-canvas"
            className="relative aspect-video max-h-full max-w-full w-auto h-full rounded-lg overflow-hidden bg-black border border-white/10 shadow-2xl"
          >
            {clip.mediaUrl ? (
              <video
                ref={videoRef}
                src={clip.mediaUrl}
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0 && onDurationLoaded) {
                    onDurationLoaded(Math.round(d));
                  }
                  if (e.currentTarget.currentTime === 0 && currentTimeSec <= 0.05) {
                    try {
                      e.currentTarget.currentTime = 0.05;
                    } catch {
                      // ignore
                    }
                  }
                }}
                onTimeUpdate={(e) => onVideoTimeUpdate?.(e.currentTarget.currentTime)}
                onEnded={() => onVideoEnded?.()}
                className="w-full h-full object-contain pointer-events-none"
              />
            ) : clip.previewImage ? (
              <img
                src={clip.previewImage}
                alt={clip.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain pointer-events-none"
              />
            ) : (
              <div className="w-full h-full bg-[#09090B] flex items-center justify-center text-xs font-mono-tabular text-zinc-500">
                16:9 Source Video
              </div>
            )}

            {/* Subtle dimming layer to make crop boxes pop */}
            {boxes.length > 0 && (
              <div className="absolute inset-0 bg-black/25 pointer-events-none" />
            )}

            {/* Draggable & 4-corner-resizable framing boxes from blueprint.crops */}
            {boxes.map((item) => (
              <div
                key={`${item.id}-${item.index}`}
                data-testid={`framing-box-${item.id}`}
                data-slot-index={item.index}
                onPointerDown={(e) => startBoxDrag(item.index, 'move', item.crop, e)}
                style={{
                  left: `${item.crop.x * 100}%`,
                  top: `${item.crop.y * 100}%`,
                  width: `${item.crop.w * 100}%`,
                  height: `${item.crop.h * 100}%`,
                  borderColor: item.borderColor,
                  backgroundColor: item.fillBg,
                }}
                className="absolute border-2 cursor-grab active:cursor-grabbing touch-none shadow-[0_0_0_1px_rgba(0,0,0,0.85)]"
              >
                {/* Colored label tag */}
                <div
                  style={{ backgroundColor: item.badgeBg, color: item.badgeText }}
                  className="absolute -top-6 left-0 px-2 py-0.5 rounded-t-md text-[10.5px] font-semibold tracking-tight whitespace-nowrap shadow-md pointer-events-none inline-flex items-center gap-1"
                >
                  <span aria-hidden="true">•</span>
                  <span>{item.label}</span>
                </div>

                {/* Center crosshair reticle */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <div className="relative w-4 h-4 opacity-70">
                    <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-white" />
                    <span className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-white" />
                  </div>
                </div>

                {/* Live coordinate footer */}
                <div className="absolute bottom-1 right-1.5 px-1 py-0.5 rounded bg-black/75 text-[9px] font-mono-tabular text-white/85 pointer-events-none">
                  {(item.crop.w * 100).toFixed(0)}%×{(item.crop.h * 100).toFixed(0)}%
                </div>

                {/* 4 corner resize handles */}
                <div
                  data-testid={`framing-resize-${item.id}-nw`}
                  onPointerDown={(e) => startBoxDrag(item.index, 'nw', item.crop, e)}
                  className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nwse-resize shadow"
                />
                <div
                  data-testid={`framing-resize-${item.id}-ne`}
                  onPointerDown={(e) => startBoxDrag(item.index, 'ne', item.crop, e)}
                  className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nesw-resize shadow"
                />
                <div
                  data-testid={`framing-resize-${item.id}-sw`}
                  onPointerDown={(e) => startBoxDrag(item.index, 'sw', item.crop, e)}
                  className="absolute -bottom-1.5 -left-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nesw-resize shadow"
                />
                <div
                  data-testid={`framing-resize-${item.id}-se`}
                  onPointerDown={(e) => startBoxDrag(item.index, 'se', item.crop, e)}
                  className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nwse-resize shadow"
                />
              </div>
            ))}

            {boxes.length === 0 && (
              <div className="absolute inset-0 border-2 border-dashed border-white/25 pointer-events-none flex items-end justify-center pb-3">
                <span className="px-2.5 py-1 rounded bg-black/75 text-[11px] font-mono-tabular text-white/85">
                  Full 16:9 Source Frame ({blueprint.layout === 'centered' ? 'Centered Card' : 'Widescreen 16:9'})
                </span>
              </div>
            )}
          </div>

          {/* Bottom-left helper hint */}
          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md bg-black/70 border border-white/10 text-[10.5px] text-zinc-300 flex items-center gap-2 pointer-events-none">
            <span>Drag boxes to move · corners to resize</span>
            <span className="text-zinc-500">·</span>
            <span className="font-mono-tabular text-zinc-400">{blueprint.aspect} Output</span>
          </div>

          {/* Optional quick stage controls */}
          {(onSwitchToLivePreview || onToggleFullscreen) && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
              {onSwitchToLivePreview && (
                <button
                  type="button"
                  onClick={onSwitchToLivePreview}
                  className="h-8 px-2.5 rounded-lg bg-black/70 border border-white/15 text-xs font-medium text-white hover:bg-black/90 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Live {blueprint.aspect}</span>
                </button>
              )}
              {onToggleFullscreen && (
                <button
                  type="button"
                  onClick={onToggleFullscreen}
                  aria-label="Toggle stage fullscreen"
                  title="Fullscreen stage"
                  className="h-8 w-8 rounded-lg bg-black/70 border border-white/15 text-white/80 hover:text-white hover:bg-black/90 grid place-items-center cursor-pointer transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5 stroke-[1.75]" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
