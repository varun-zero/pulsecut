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

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

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
  });

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

  const startResize = (slotIdx: number, corner: ResizeCorner, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectSlot(slotIdx);
    const stageEl = stageRef.current;
    const orig = blueprint.crops[slotIdx];
    const slot = slots[slotIdx];
    if (!stageEl || !orig || !slot) return;

    const slotAr = getSlotAspect(slot, blueprint.aspect);
    const rect = stageEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let latest = orig;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      const dy = (ev.clientY - startY) / rect.height;

      let candidateW = orig.w;
      let candidateH = orig.h;
      let candidateX = orig.x;
      let candidateY = orig.y;

      if (corner === 'se') {
        candidateW = Math.max(0.08, orig.w + dx);
        candidateH = Math.max(0.08, orig.h + dy);
      } else if (corner === 'sw') {
        candidateW = Math.max(0.08, orig.w - dx);
        candidateH = Math.max(0.08, orig.h + dy);
        candidateX = orig.x + (orig.w - candidateW);
      } else if (corner === 'ne') {
        candidateW = Math.max(0.08, orig.w + dx);
        candidateH = Math.max(0.08, orig.h - dy);
        candidateY = orig.y + (orig.h - candidateH);
      } else {
        candidateW = Math.max(0.08, orig.w - dx);
        candidateH = Math.max(0.08, orig.h - dy);
        candidateX = orig.x + (orig.w - candidateW);
        candidateY = orig.y + (orig.h - candidateH);
      }

      // Strictly lock the resized box to the exact output slot aspect ratio (decompiled Eb math)
      latest = fitCropToAspect(
        { x: candidateX, y: candidateY, w: candidateW, h: candidateH },
        slotAr,
        sourceAspect
      );
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

        {/* Aspect-Locked Draggable & Resizable Crop Regions */}
        {blueprint.layout !== 'centered' ? (
          slots.map((slot, idx) => {
            const crop = blueprint.crops[idx];
            if (!crop) return null;
            const palette = SLOT_COLORS[idx % SLOT_COLORS.length];
            const isSelected = activeSlotIndex === idx;
            const customOverride = blueprint.slotMedia[idx];

            return (
              <div
                key={`${slot.label}-${idx}`}
                data-testid={`crop-box-${idx}`}
                onPointerDown={(e) => startMove(idx, e)}
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                  borderColor: palette.border,
                  backgroundColor: isSelected ? palette.fill : 'rgba(0,0,0,0.08)',
                }}
                className={`absolute border-2 cursor-move transition-shadow ${
                  isSelected ? 'z-20 shadow-[0_0_0_1px_rgba(255,255,255,0.4)]' : 'z-10 opacity-85 hover:opacity-100'
                }`}
              >
                {/* Slot Header Label */}
                <div
                  style={{ backgroundColor: palette.tagBg, color: palette.tagText }}
                  className="absolute -top-5 left-0 px-1.5 py-0.5 rounded-t text-[10px] font-semibold tracking-tight whitespace-nowrap inline-flex items-center gap-1 pointer-events-none"
                >
                  <Move className="w-2.5 h-2.5" />
                  <span>{slot.label}</span>
                  {customOverride && <span className="opacity-80">· Custom</span>}
                </div>

                {/* Rule-of-thirds subtle crosshair */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <span className="w-3 h-px bg-white/75" />
                  <span className="absolute h-3 w-px bg-white/75" />
                </div>

                {/* 4 Aspect-Locked Corner Resize Handles */}
                {(['nw', 'ne', 'sw', 'se'] as ResizeCorner[]).map((corner) => {
                  const posClass =
                    corner === 'nw'
                      ? '-top-1.5 -left-1.5 cursor-nwse-resize'
                      : corner === 'ne'
                        ? '-top-1.5 -right-1.5 cursor-nesw-resize'
                        : corner === 'sw'
                          ? '-bottom-1.5 -left-1.5 cursor-nesw-resize'
                          : '-bottom-1.5 -right-1.5 cursor-nwse-resize';
                  return (
                    <button
                      key={corner}
                      type="button"
                      aria-label={`Resize ${slot.label} ${corner} corner`}
                      onPointerDown={(e) => startResize(idx, corner, e)}
                      className={`absolute w-3 h-3 rounded-[2px] bg-white border border-black/80 p-0 ${posClass}`}
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
