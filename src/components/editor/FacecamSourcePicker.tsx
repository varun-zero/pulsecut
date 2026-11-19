import React, { useEffect, useRef } from 'react';
import { Move, UserSquare2 } from 'lucide-react';
import type { ClipItem, FacecamSourceBox } from '../../types';
import { FACECAM_CORNER_PRESETS } from '../../presets';
import { clampFacecamSourceBox } from '../../lib/studioLogic';

interface FacecamSourcePickerProps {
  clip: ClipItem | null;
  currentTimeSec: number;
  box: FacecamSourceBox;
  onChange: (next: FacecamSourceBox, commit?: boolean) => void;
}

type DragKind = 'move' | 'se' | 'nw';

/**
 * Interactive 16:9 source-frame crop picker allowing the editor to manually
 * position and resize the streamer facecam placeholder box directly over the
 * streamer's face. Coordinates map 1:1 to both the 9:16 preview and FFmpeg crop.
 */
export function FacecamSourcePicker({
  clip,
  currentTimeSec,
  box,
  onChange,
}: FacecamSourcePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<{
    kind: DragKind;
    startClientX: number;
    startClientY: number;
    startBox: FacecamSourceBox;
    latestBox: FacecamSourceBox;
  } | null>(null);

  const safeBox = clampFacecamSourceBox(box);

  // Keep preview frame aligned with playhead when a real video is loaded
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !clip?.mediaUrl) return;
    if (Math.abs(vid.currentTime - currentTimeSec) > 0.35) {
      try {
        vid.currentTime = currentTimeSec;
      } catch {
        // Ignore seek errors before metadata is ready
      }
    }
  }, [currentTimeSec, clip?.mediaUrl]);

  const startDrag = (kind: DragKind, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startBox: safeBox,
      latestBox: safeBox,
    };

    const onMove = (ev: PointerEvent) => {
      const state = dragRef.current;
      const el = containerRef.current;
      if (!state || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const dxPct = ((ev.clientX - state.startClientX) / rect.width) * 100;
      const dyPct = ((ev.clientY - state.startClientY) / rect.height) * 100;
      const b = state.startBox;

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
      } else {
        const rightEdge = b.x + b.width;
        const bottomEdge = b.y + b.height;
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
      onChange(next, false);
    };

    const onUp = () => {
      if (dragRef.current) {
        const finalBox = dragRef.current.latestBox;
        dragRef.current = null;
        onChange(finalBox, true);
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--pc-sub)] font-medium">
          Place Box on Streamer&apos;s Face (16:9 Source)
        </span>
        <span className="font-mono-tabular text-[10px] text-[var(--pc-muted)]">
          {safeBox.x}%,{safeBox.y}% · {safeBox.width}×{safeBox.height}%
        </span>
      </div>

      {/* 16:9 Interactive Source Viewport */}
      <div
        ref={containerRef}
        data-testid="facecam-source-picker"
        className="relative w-full aspect-video rounded-lg overflow-hidden border border-[var(--pc-border)] bg-[#09090B] select-none"
      >
        {clip?.mediaUrl ? (
          <video
            ref={videoRef}
            src={clip.mediaUrl}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              if (e.currentTarget.currentTime === 0) {
                try {
                  e.currentTarget.currentTime = 0.05;
                } catch {
                  // ignore
                }
              }
            }}
            className="w-full h-full object-cover opacity-85 pointer-events-none"
          />
        ) : clip?.previewImage ? (
          <img
            src={clip.previewImage}
            alt=""
            className="w-full h-full object-cover opacity-75 pointer-events-none"
          />
        ) : (
          <div className="w-full h-full relative bg-[radial-gradient(#27272A_1px,transparent_1px)] [background-size:14px_14px]">
            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-25">
              <div className="border-r border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-r border-b border-white/20" />
              <div className="border-b border-white/20" />
              <div className="border-r border-white/20" />
              <div className="border-r border-white/20" />
              <div />
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[10px] font-mono-tabular text-white/40 uppercase tracking-wider">
                16:9 Source Frame
              </span>
            </div>
          </div>
        )}

        {/* Dimmed outside mask */}
        <div className="absolute inset-0 bg-black/35 pointer-events-none" />

        {/* Draggable & Resizable Streamer Facecam Placeholder Box */}
        <div
          data-testid="facecam-source-box"
          onPointerDown={(e) => startDrag('move', e)}
          style={{
            left: `${safeBox.x}%`,
            top: `${safeBox.y}%`,
            width: `${safeBox.width}%`,
            height: `${safeBox.height}%`,
          }}
          className="absolute border-2 border-[#53FC18] bg-[#53FC18]/15 rounded-sm cursor-grab active:cursor-grabbing touch-none shadow-[0_0_0_1px_rgba(0,0,0,0.75)] flex flex-col items-center justify-center"
        >
          <div className="px-1.5 py-0.5 rounded bg-black/80 text-[#53FC18] text-[9px] font-mono-tabular font-semibold inline-flex items-center gap-1 pointer-events-none">
            <UserSquare2 className="w-2.5 h-2.5" />
            <span>CAM</span>
          </div>

          {/* Top-left resize handle */}
          <div
            data-testid="facecam-resize-nw"
            onPointerDown={(e) => startDrag('nw', e)}
            title="Resize facecam region"
            className="absolute -top-1.5 -left-1.5 w-3 h-3 rounded-xs bg-[#53FC18] border border-black cursor-nwse-resize"
          />

          {/* Bottom-right resize handle */}
          <div
            data-testid="facecam-resize-se"
            onPointerDown={(e) => startDrag('se', e)}
            title="Resize facecam region"
            className="absolute -bottom-1.5 -right-1.5 w-3 h-3 rounded-xs bg-[#53FC18] border border-black cursor-nwse-resize"
          />
        </div>

        <div className="absolute left-1.5 bottom-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[9.5px] text-white/80 inline-flex items-center gap-1 pointer-events-none">
          <Move className="w-2.5 h-2.5 text-[#53FC18]" />
          <span>Drag box or corners</span>
        </div>
      </div>

      {/* Quick Corner Presets */}
      <div className="grid grid-cols-5 gap-1">
        {FACECAM_CORNER_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(preset.box, true)}
            className="h-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[9.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:border-[var(--pc-muted)] cursor-pointer transition-colors truncate px-1"
          >
            {preset.label.replace('Bottom-', 'B-').replace('Top-', 'T-')}
          </button>
        ))}
      </div>
    </div>
  );
}
