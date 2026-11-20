import React, { useEffect, useRef } from 'react';
import { Eye, Film, Maximize2, Plus } from 'lucide-react';
import type {
  ClipItem,
  EditorSettings,
  FacecamSourceBox,
  SpeakerCropKey,
} from '../../types';
import { clampFacecamSourceBox } from '../../lib/studioLogic';
import { Button } from '../ui/Primitives';

interface FramingCanvasProps {
  clip: ClipItem | null;
  settings: EditorSettings;
  playing: boolean;
  playbackSpeed: number;
  currentTimeSec: number;
  muted: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  onDurationLoaded?: (durationSec: number) => void;
  onSwitchToLivePreview: () => void;
  onToggleFullscreen: () => void;
  onOpenClipPicker: () => void;
  onGoToDashboard: () => void;
}

type BoxHandleKind = 'move' | 'nw' | 'ne' | 'sw' | 'se';
type BoxTargetId = SpeakerCropKey | 'facecam';

interface InteractiveBoxDescriptor {
  id: BoxTargetId;
  label: string;
  box: FacecamSourceBox;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
  fillBg: string;
}

/**
 * YIZERGE 1-to-1 Interactive Source Framing Canvas.
 * Displays the widescreen 16:9 source video with color-coded, draggable &
 * 4-corner-resizable crop boxes (`Top Speaker`, `Bottom Speaker`, `Speaker 3`,
 * `Main Speaker`, or `Streamer Facecam`) mapped 1:1 to Live Preview & FFmpeg export.
 */
export function FramingCanvas({
  clip,
  settings,
  playing,
  playbackSpeed,
  currentTimeSec,
  muted,
  stageRef,
  onUpdateSettings,
  onDurationLoaded,
  onSwitchToLivePreview,
  onToggleFullscreen,
  onOpenClipPicker,
  onGoToDashboard,
}: FramingCanvasProps) {
  const sourceFrameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const dragRef = useRef<{
    target: BoxTargetId;
    kind: BoxHandleKind;
    startClientX: number;
    startClientY: number;
    startBox: FacecamSourceBox;
    latestBox: FacecamSourceBox;
  } | null>(null);

  // Sync HTML5 video play/pause, speed, mute & playhead
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !clip?.mediaUrl) return;
    vid.playbackRate = playbackSpeed;
    vid.muted = muted;
    if (playing) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [playing, playbackSpeed, muted, clip?.mediaUrl]);

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
  }, [currentTimeSec, clip?.mediaUrl]);

  const boxes: InteractiveBoxDescriptor[] = (() => {
    if (settings.layout === 'trio') {
      return [
        {
          id: 'primary',
          label: 'Top-Left Speaker',
          box: clampFacecamSourceBox(settings.speakerCrops.primary),
          borderColor: '#10B981',
          badgeBg: '#10B981',
          badgeText: '#041E14',
          fillBg: 'rgba(16, 185, 129, 0.14)',
        },
        {
          id: 'secondary',
          label: 'Top-Right Speaker',
          box: clampFacecamSourceBox(settings.speakerCrops.secondary),
          borderColor: '#38BDF8',
          badgeBg: '#38BDF8',
          badgeText: '#082032',
          fillBg: 'rgba(56, 189, 248, 0.14)',
        },
        {
          id: 'tertiary',
          label: 'Bottom Speaker',
          box: clampFacecamSourceBox(settings.speakerCrops.tertiary),
          borderColor: '#A3E635',
          badgeBg: '#A3E635',
          badgeText: '#142004',
          fillBg: 'rgba(163, 230, 53, 0.14)',
        },
      ];
    }

    if (settings.layout === 'split') {
      if (settings.facecamEnabled) {
        return [
          {
            id: 'facecam',
            label: 'Streamer Facecam',
            box: clampFacecamSourceBox(settings.facecamSourceBox),
            borderColor: '#53FC18',
            badgeBg: '#53FC18',
            badgeText: '#071A03',
            fillBg: 'rgba(83, 252, 24, 0.15)',
          },
        ];
      }
      return [
        {
          id: 'primary',
          label: 'Top Speaker',
          box: clampFacecamSourceBox(settings.speakerCrops.primary),
          borderColor: '#10B981',
          badgeBg: '#10B981',
          badgeText: '#041E14',
          fillBg: 'rgba(16, 185, 129, 0.14)',
        },
        {
          id: 'secondary',
          label: 'Bottom Speaker',
          box: clampFacecamSourceBox(settings.speakerCrops.secondary),
          borderColor: '#A3E635',
          badgeBg: '#A3E635',
          badgeText: '#142004',
          fillBg: 'rgba(163, 230, 53, 0.14)',
        },
      ];
    }

    if (settings.layout === 'pip') {
      return [
        {
          id: 'facecam',
          label: 'Streamer Facecam',
          box: clampFacecamSourceBox(settings.facecamSourceBox),
          borderColor: '#53FC18',
          badgeBg: '#53FC18',
          badgeText: '#071A03',
          fillBg: 'rgba(83, 252, 24, 0.15)',
        },
      ];
    }

    if (settings.layout === 'solo') {
      return [
        {
          id: 'primary',
          label: 'Main Speaker',
          box: clampFacecamSourceBox(settings.speakerCrops.primary),
          borderColor: '#10B981',
          badgeBg: '#10B981',
          badgeText: '#041E14',
          fillBg: 'rgba(16, 185, 129, 0.14)',
        },
      ];
    }

    return [];
  })();

  const commitBoxUpdate = (target: BoxTargetId, nextBox: FacecamSourceBox, recordHistory: boolean) => {
    if (target === 'facecam') {
      onUpdateSettings({ facecamSourceBox: nextBox }, recordHistory);
    } else {
      onUpdateSettings(
        {
          speakerCrops: {
            ...settings.speakerCrops,
            [target]: nextBox,
          },
        },
        recordHistory
      );
    }
  };

  const startBoxDrag = (
    target: BoxTargetId,
    kind: BoxHandleKind,
    currentBox: FacecamSourceBox,
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      target,
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: currentBox,
      latestBox: currentBox,
    };

    const onMove = (ev: PointerEvent) => {
      const state = dragRef.current;
      const el = sourceFrameRef.current;
      if (!state || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dxPct = ((ev.clientX - state.startClientX) / rect.width) * 100;
      const dyPct = ((ev.clientY - state.startClientY) / rect.height) * 100;
      const b = state.startBox;
      const rightEdge = b.x + b.width;
      const bottomEdge = b.y + b.height;

      let next: FacecamSourceBox;
      if (state.kind === 'move') {
        next = clampFacecamSourceBox({
          x: b.x + dxPct,
          y: b.y + dyPct,
          width: b.width,
          height: b.height,
        });
      } else if (state.kind === 'se') {
        next = clampFacecamSourceBox({
          x: b.x,
          y: b.y,
          width: Math.min(100 - b.x, Math.max(12, b.width + dxPct)),
          height: Math.min(100 - b.y, Math.max(12, b.height + dyPct)),
        });
      } else if (state.kind === 'sw') {
        const nextX = Math.max(0, Math.min(rightEdge - 12, b.x + dxPct));
        next = clampFacecamSourceBox({
          x: nextX,
          y: b.y,
          width: rightEdge - nextX,
          height: Math.min(100 - b.y, Math.max(12, b.height + dyPct)),
        });
      } else if (state.kind === 'ne') {
        const nextY = Math.max(0, Math.min(bottomEdge - 12, b.y + dyPct));
        next = clampFacecamSourceBox({
          x: b.x,
          y: nextY,
          width: Math.min(100 - b.x, Math.max(12, b.width + dxPct)),
          height: bottomEdge - nextY,
        });
      } else {
        const nextX = Math.max(0, Math.min(rightEdge - 12, b.x + dxPct));
        const nextY = Math.max(0, Math.min(bottomEdge - 12, b.y + dyPct));
        next = clampFacecamSourceBox({
          x: nextX,
          y: nextY,
          width: rightEdge - nextX,
          height: bottomEdge - nextY,
        });
      }

      state.latestBox = next;
      commitBoxUpdate(state.target, next, false);
    };

    const onUp = () => {
      if (dragRef.current) {
        const { target: finalTarget, latestBox } = dragRef.current;
        dragRef.current = null;
        commitBoxUpdate(finalTarget, latestBox, true);
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
          {/* Centered 16:9 Source Canvas matching YIZERGE Framing Mode */}
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
                  if (e.currentTarget.currentTime === 0) {
                    try {
                      e.currentTarget.currentTime = 0.05;
                    } catch {
                      // ignore
                    }
                  }
                }}
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

            {/* Subtle dimming layer to make speaker crop frames pop */}
            {boxes.length > 0 && (
              <div className="absolute inset-0 bg-black/25 pointer-events-none" />
            )}

            {/* Draggable & 4-Corner Resizable Speaker / Facecam Crop Regions */}
            {boxes.map((item) => (
              <div
                key={item.id}
                data-testid={`framing-box-${item.id}`}
                onPointerDown={(e) => startBoxDrag(item.id, 'move', item.box, e)}
                style={{
                  left: `${item.box.x}%`,
                  top: `${item.box.y}%`,
                  width: `${item.box.width}%`,
                  height: `${item.box.height}%`,
                  borderColor: item.borderColor,
                  backgroundColor: item.fillBg,
                }}
                className="absolute border-2 cursor-grab active:cursor-grabbing touch-none shadow-[0_0_0_1px_rgba(0,0,0,0.85)]"
              >
                {/* Top Colored Label Tag (`• Top Speaker`, `• Bottom Speaker`, etc.) */}
                <div
                  style={{
                    backgroundColor: item.badgeBg,
                    color: item.badgeText,
                  }}
                  className="absolute -top-6 left-0 px-2 py-0.5 rounded-t-md text-[10.5px] font-semibold tracking-tight whitespace-nowrap shadow-md pointer-events-none inline-flex items-center gap-1"
                >
                  <span aria-hidden="true">•</span>
                  <span>{item.label}</span>
                </div>

                {/* Center `+` Crosshair Reticle */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                >
                  <div className="relative w-4 h-4 opacity-70">
                    <span className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-white" />
                    <span className="absolute top-1/2 left-0 right-0 h-px -translate-y-1/2 bg-white" />
                  </div>
                </div>

                {/* Live coordinate footer inside box */}
                <div className="absolute bottom-1 right-1.5 px-1 py-0.5 rounded bg-black/75 text-[9px] font-mono-tabular text-white/85 pointer-events-none">
                  {item.box.width}%×{item.box.height}%
                </div>

                {/* 4 White Corner Resize Handles (NW, NE, SW, SE) */}
                <div
                  data-testid={`framing-resize-${item.id}-nw`}
                  onPointerDown={(e) => startBoxDrag(item.id, 'nw', item.box, e)}
                  className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nwse-resize shadow"
                />
                <div
                  data-testid={`framing-resize-${item.id}-ne`}
                  onPointerDown={(e) => startBoxDrag(item.id, 'ne', item.box, e)}
                  className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nesw-resize shadow"
                />
                <div
                  data-testid={`framing-resize-${item.id}-sw`}
                  onPointerDown={(e) => startBoxDrag(item.id, 'sw', item.box, e)}
                  className="absolute -bottom-1.5 -left-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nesw-resize shadow"
                />
                <div
                  data-testid={`framing-resize-${item.id}-se`}
                  onPointerDown={(e) => startBoxDrag(item.id, 'se', item.box, e)}
                  className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-[2px] bg-white border border-black cursor-nwse-resize shadow"
                />
              </div>
            ))}

            {boxes.length === 0 && (
              <div className="absolute inset-0 border-2 border-dashed border-white/25 pointer-events-none flex items-end justify-center pb-3">
                <span className="px-2.5 py-1 rounded bg-black/75 text-[11px] font-mono-tabular text-white/85">
                  Full 16:9 Source Frame ({settings.layout === 'centered' ? 'Centered Card' : 'Widescreen 16:9'})
                </span>
              </div>
            )}
          </div>

          {/* Bottom-Left Helper Hint */}
          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md bg-black/70 border border-white/10 text-[10.5px] text-zinc-300 flex items-center gap-2 pointer-events-none">
            <span>Drag crop boxes &amp; corners to frame speakers</span>
            <span className="text-zinc-500">·</span>
            <span className="font-mono-tabular text-zinc-400">Ctrl+L for Live {settings.aspect} Preview</span>
          </div>

          {/* Bottom-Right Quick Live Preview & Fullscreen Controls */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={onSwitchToLivePreview}
              className="h-8 px-2.5 rounded-lg bg-black/70 border border-white/15 text-xs font-medium text-white hover:bg-black/90 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Live {settings.aspect}</span>
            </button>
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label="Toggle stage fullscreen"
              title="Fullscreen stage"
              className="h-8 w-8 rounded-lg bg-black/70 border border-white/15 text-white/80 hover:text-white hover:bg-black/90 grid place-items-center cursor-pointer transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5 stroke-[1.75]" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
