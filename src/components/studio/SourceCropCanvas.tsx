import React, { useRef } from 'react';
import { Move } from 'lucide-react';
import type { FramingBlueprint, NormalizedCrop } from '../../types';
import {
  clampCrop,
  fitCropToAspect,
  getCroppableSlots,
  getSlotAspect,
} from '../../lib/framingEngine';

interface SourceCropCanvasProps {
  videoUrl?: string;
  previewImage?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sourceAspect: number;
  blueprint: FramingBlueprint;
  activeSlotIndex: number;
  onSelectSlot: (idx: number) => void;
  onChangeCrop: (idx: number, next: NormalizedCrop, recordHistory?: boolean) => void;
  onVideoMetadata: (width: number, height: number, duration: number) => void;
  onVideoTimeUpdate: (timeSec: number) => void;
  onVideoEnded: () => void;
}

const SLOT_COLORS = [
  { border: '#10B981', fill: 'rgba(16,185,129,0.12)', tagBg: '#10B981', tagText: '#052E16' },
  { border: '#3B82F6', fill: 'rgba(59,130,246,0.12)', tagBg: '#3B82F6', tagText: '#EFF6FF' },
  { border: '#F59E0B', fill: 'rgba(245,158,11,0.12)', tagBg: '#F59E0B', tagText: '#451A03' },
];

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

export function SourceCropCanvas({
  videoUrl,
  previewImage,
  videoRef,
  sourceAspect,
  blueprint,
  activeSlotIndex,
  onSelectSlot,
  onChangeCrop,
  onVideoMetadata,
  onVideoTimeUpdate,
  onVideoEnded,
}: SourceCropCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const slots = getCroppableSlots(blueprint.layout, blueprint.aspect, {
    splitRatio: blueprint.splitRatio,
    pip: blueprint.pip,
    crops: blueprint.crops,
    sourceAr: sourceAspect,
  });

  const isSlotFreeRect = (slotIdx: number) =>
    Boolean(
      blueprint.freeCrop ||
        (blueprint.layout === 'pip' &&
          slotIdx === 1 &&
          blueprint.pip.shape !== 'circle' &&
          (blueprint.pip.aspect ?? '16:9') === 'free')
    );

  const startMove = (slotIdx: number, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectSlot(slotIdx);
    const stageEl = stageRef.current;
    const orig = blueprint.crops[slotIdx];
    if (!stageEl || !orig) return;

    const rect = stageEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let latest = orig;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;
      latest = clampCrop({
        ...orig,
        x: orig.x + dx,
        y: orig.y + dy,
      });
      onChangeCrop(slotIdx, latest, false);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onChangeCrop(slotIdx, latest, true);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startResize = (slotIdx: number, handle: ResizeHandle, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectSlot(slotIdx);
    const stageEl = stageRef.current;
    const orig = blueprint.crops[slotIdx];
    const slot = slots[slotIdx];
    if (!stageEl || !orig || !slot) return;

    const freeRect = isSlotFreeRect(slotIdx);
    const slotAr = getSlotAspect(slot, blueprint.aspect);
    const rect = stageEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let latest = orig;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;

      const origRight = orig.x + orig.w;
      const origBottom = orig.y + orig.h;
      let candidateX = orig.x;
      let candidateY = orig.y;
      let candidateW = orig.w;
      let candidateH = orig.h;

      if (handle.includes('e')) {
        candidateW = Math.max(0.06, Math.min(1 - orig.x, orig.w + dx));
      }
      if (handle.includes('w')) {
        const nextX = Math.max(0, Math.min(origRight - 0.06, orig.x + dx));
        candidateX = nextX;
        candidateW = origRight - nextX;
      }
      if (handle.includes('s')) {
        candidateH = Math.max(0.06, Math.min(1 - orig.y, orig.h + dy));
      }
      if (handle.includes('n')) {
        const nextY = Math.max(0, Math.min(origBottom - 0.06, orig.y + dy));
        candidateY = nextY;
        candidateH = origBottom - nextY;
      }

      if (freeRect) {
        latest = clampCrop({
          x: candidateX,
          y: candidateY,
          w: candidateW,
          h: candidateH,
        });
      } else {
        // Strictly lock the resized box to the exact output slot aspect ratio (decompiled Eb math)
        latest = fitCropToAspect(
          { x: candidateX, y: candidateY, w: candidateW, h: candidateH },
          slotAr,
          sourceAspect
        );
      }
      onChangeCrop(slotIdx, latest, false);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onChangeCrop(slotIdx, latest, true);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center min-w-0 min-h-0">
      <div
        ref={stageRef}
        data-testid="source-crop-canvas"
        style={{ aspectRatio: String(sourceAspect || 16 / 9) }}
        className="relative w-full max-h-full rounded-lg overflow-hidden bg-black border border-[var(--pc-border)] select-none shadow-lg"
      >
        {/* Source Video Element (also feeds FramedCanvasView live at 30fps!) */}
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              onVideoMetadata(
                v.videoWidth || 1920,
                v.videoHeight || 1080,
                Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 30
              );
            }}
            onTimeUpdate={(e) => onVideoTimeUpdate(e.currentTarget.currentTime)}
            onEnded={onVideoEnded}
            className="w-full h-full object-contain pointer-events-none"
          />
        ) : previewImage ? (
          <img
            src={previewImage}
            alt="Source frame"
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-xs text-[var(--pc-muted)] gap-1">
            <span>16:9 Source Canvas</span>
            <span className="font-mono-tabular text-[11px]">Load a video clip to position framing boxes</span>
          </div>
        )}

        {/* Draggable & Resizable Crop Regions */}
        {blueprint.layout !== 'centered' ? (
          slots.map((slot, idx) => {
            const crop = blueprint.crops[idx];
            if (!crop) return null;
            const palette = SLOT_COLORS[idx % SLOT_COLORS.length];
            const isSelected = activeSlotIndex === idx;
            const customOverride = blueprint.slotMedia[idx];
            const isFull = Boolean(blueprint.fullFrameSlots?.[idx]);
            const freeRect = isSlotFreeRect(idx);
            const labelInside = crop.y < 0.08;
            const touchesTop = crop.y < 0.02;
            const touchesBottom = crop.y + crop.h > 0.98;
            const touchesLeft = crop.x < 0.02;
            const touchesRight = crop.x + crop.w > 0.98;

            return (
              <div
                key={`${slot.label}-${idx}`}
                data-testid={`crop-box-${idx}`}
                data-full-frame={isFull ? 'true' : 'false'}
                onPointerDown={(e) => startMove(idx, e)}
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                  borderColor: palette.border,
                  backgroundColor: isFull
                    ? 'rgba(16,185,129,0.05)'
                    : isSelected
                      ? palette.fill
                      : 'rgba(0,0,0,0.08)',
                }}
                className={`absolute border-2 cursor-move transition-shadow ${
                  isSelected ? 'z-20 shadow-[0_0_0_1px_rgba(255,255,255,0.4)]' : 'z-10 opacity-85 hover:opacity-100'
                }`}
              >
                {/* Slot Header Label (stays inside when near top edge so it never clips, and moves to bottom-left on full-frame main slot with PiP) */}
                <div
                  style={{ backgroundColor: palette.tagBg, color: palette.tagText }}
                  className={`absolute px-1.5 py-0.5 text-[10px] font-semibold tracking-tight whitespace-nowrap inline-flex items-center gap-1 pointer-events-none ${
                    isFull && idx === 0 && slots.length > 1
                      ? 'bottom-1.5 left-1.5 rounded'
                      : labelInside
                        ? 'top-1 left-1 rounded'
                        : '-top-5 left-0 rounded-t'
                  }`}
                >
                  <Move className="w-2.5 h-2.5" />
                  <span>{slot.label}</span>
                  {isFull && <span className="opacity-85">· Full 100%</span>}
                  {!isFull && freeRect && <span className="opacity-85">· Free Rect</span>}
                  {customOverride && <span className="opacity-80">· Custom</span>}
                </div>

                {/* Rule-of-thirds subtle crosshair */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <span className="w-3 h-px bg-white/75" />
                  <span className="absolute h-3 w-px bg-white/75" />
                </div>

                {/* 4 Corner Resize Handles (edge-aware so Full Screen handles remain grabbable) */}
                {(['nw', 'ne', 'sw', 'se'] as ResizeHandle[]).map((corner) => {
                  const topCls = corner.includes('n') ? (touchesTop ? 'top-0.5' : '-top-1.5') : touchesBottom ? 'bottom-0.5' : '-bottom-1.5';
                  const leftCls = corner.includes('w') ? (touchesLeft ? 'left-0.5' : '-left-1.5') : touchesRight ? 'right-0.5' : '-right-1.5';
                  const cursorCls =
                    corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize';
                  return (
                    <button
                      key={corner}
                      type="button"
                      aria-label={`Resize ${slot.label} ${corner} corner`}
                      onPointerDown={(e) => startResize(idx, corner, e)}
                      className={`absolute w-3 h-3 rounded-[2px] bg-white border border-black/80 p-0 ${topCls} ${leftCls} ${cursorCls}`}
                    />
                  );
                })}

                {/* 4 Edge Handles when Free Rectangular resizing is enabled */}
                {freeRect &&
                  (['n', 's', 'e', 'w'] as ResizeHandle[]).map((edge) => {
                    const edgeClass =
                      edge === 'n'
                        ? `${touchesTop ? 'top-0.5' : '-top-1'} left-1/2 -translate-x-1/2 w-5 h-2 cursor-ns-resize`
                        : edge === 's'
                          ? `${touchesBottom ? 'bottom-0.5' : '-bottom-1'} left-1/2 -translate-x-1/2 w-5 h-2 cursor-ns-resize`
                          : edge === 'w'
                            ? `${touchesLeft ? 'left-0.5' : '-left-1'} top-1/2 -translate-y-1/2 w-2 h-5 cursor-ew-resize`
                            : `${touchesRight ? 'right-0.5' : '-right-1'} top-1/2 -translate-y-1/2 w-2 h-5 cursor-ew-resize`;
                    return (
                      <button
                        key={edge}
                        type="button"
                        aria-label={`Resize ${slot.label} ${edge} edge`}
                        onPointerDown={(e) => startResize(idx, edge, e)}
                        className={`absolute rounded-[2px] bg-white border border-black/80 p-0 ${edgeClass}`}
                      />
                    );
                  })}
              </div>
            );
          })
        ) : (
          <div className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-md bg-black/75 border border-white/15 text-[11px] text-white/90 font-mono-tabular pointer-events-none">
            Centered Mode · Full source frame scaled ({Math.round(blueprint.centeredScale * 100)}%) onto backdrop
          </div>
        )}
      </div>
    </div>
  );
}
