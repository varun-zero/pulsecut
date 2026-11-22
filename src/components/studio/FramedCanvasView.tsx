import React, { useEffect, useRef } from 'react';
import type { FramingBlueprint, PreviewResolutionId } from '../../types';
import { getCanvasAspectRatio, renderFramedCanvas2D } from '../../lib/framingEngine';

interface FramedCanvasViewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  blueprint: FramingBlueprint;
  previewRes?: PreviewResolutionId;
  v1Hidden?: boolean;
  className?: string;
  testId?: string;
  filter?: string;
}

export function FramedCanvasView({
  videoRef,
  blueprint,
  previewRes = 'auto',
  v1Hidden = false,
  className = '',
  testId,
  filter,
}: FramedCanvasViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bpRef = useRef(blueprint);
  bpRef.current = blueprint;
  const hiddenRef = useRef(v1Hidden);
  hiddenRef.current = v1Hidden;
  const resRef = useRef(previewRes);
  resRef.current = previewRes;

  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const slotElsRef = useRef<Record<number, HTMLVideoElement | HTMLImageElement | null>>({});
  const sizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });
  const redrawRef = useRef<() => void>(() => {});

  // Load backdrop image if provided
  useEffect(() => {
    const url = blueprint.backdrop.imgUrl;
    if (!url) {
      bgImageRef.current = null;
      redrawRef.current();
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      bgImageRef.current = img;
      redrawRef.current();
    };
    img.src = url;
  }, [blueprint.backdrop.imgUrl]);

  // Load per-slot custom video/image overrides
  useEffect(() => {
    const entries = Object.entries(blueprint.slotMedia || {});
    const createdVideos: HTMLVideoElement[] = [];
    const nextMap: Record<number, HTMLVideoElement | HTMLImageElement | null> = {};

    for (const [key, item] of entries) {
      const idx = Number(key);
      if (!item?.url) continue;
      if (item.isVideo) {
        const v = document.createElement('video');
        v.src = item.url;
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.crossOrigin = 'anonymous';
        v.onloadeddata = () => redrawRef.current();
        v.play().catch(() => {});
        createdVideos.push(v);
        nextMap[idx] = v;
      } else {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => redrawRef.current();
        img.src = item.url;
        nextMap[idx] = img;
      }
    }

    slotElsRef.current = nextMap;
    redrawRef.current();

    return () => {
      createdVideos.forEach((v) => {
        v.pause();
        v.src = '';
      });
    };
  }, [blueprint.slotMedia]);

  // Resize observer synced to previewRes (auto / half / full)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncSize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const baseDpr = Math.min(window.devicePixelRatio || 1, 2);
      const dpr =
        resRef.current === 'half'
          ? 0.6
          : resRef.current === 'full'
            ? baseDpr
            : Math.min(baseDpr, 1.25);
      canvas.width = Math.max(2, Math.round(rect.width * dpr));
      canvas.height = Math.max(2, Math.round(rect.height * dpr));
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      redrawRef.current();
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [previewRes, blueprint.aspect]);

  // Main 30fps draw loop (on-demand when paused, rAF-throttled when playing)
  useEffect(() => {
    let rafId = 0;
    let alive = true;
    let lastDraw = 0;
    const frameIntervalMs = 1000 / 30;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h, dpr } = sizeRef.current;
      if (w <= 0 || h <= 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderFramedCanvas2D(
        ctx,
        videoRef.current,
        w,
        h,
        bpRef.current,
        slotElsRef.current,
        bgImageRef.current,
        hiddenRef.current
      );
    };

    redrawRef.current = draw;
    draw();

    const tick = (now: number) => {
      if (!alive) return;
      const vid = videoRef.current;
      const anySlotPlaying = Object.values(slotElsRef.current).some(
        (el) => el && 'paused' in el && !el.paused
      );
      if ((vid && !vid.paused) || anySlotPlaying) {
        if (now - lastDraw >= frameIntervalMs - 2) {
          lastDraw = now;
          draw();
        }
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    const startLoop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      lastDraw = 0;
      rafId = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      draw();
    };

    const vid = videoRef.current;
    if (vid && !vid.paused) startLoop();

    if (vid) {
      const onTimeUpdate = () => {
        if (vid.paused) draw();
      };
      vid.addEventListener('play', startLoop);
      vid.addEventListener('pause', stopLoop);
      vid.addEventListener('seeked', draw);
      vid.addEventListener('seeking', draw);
      vid.addEventListener('loadedmetadata', draw);
      vid.addEventListener('loadeddata', draw);
      vid.addEventListener('canplay', draw);
      vid.addEventListener('timeupdate', onTimeUpdate);
      return () => {
        alive = false;
        if (rafId) cancelAnimationFrame(rafId);
        vid.removeEventListener('play', startLoop);
        vid.removeEventListener('pause', stopLoop);
        vid.removeEventListener('seeked', draw);
        vid.removeEventListener('seeking', draw);
        vid.removeEventListener('loadedmetadata', draw);
        vid.removeEventListener('loadeddata', draw);
        vid.removeEventListener('canplay', draw);
        vid.removeEventListener('timeupdate', onTimeUpdate);
      };
    }

    return () => {
      alive = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [videoRef, blueprint, v1Hidden, previewRes]);

  const ar = getCanvasAspectRatio(blueprint.aspect);

  return (
    <canvas
      ref={canvasRef}
      data-testid={testId}
      style={{ aspectRatio: String(ar), filter: filter || undefined }}
      className={`block w-full h-full ${className}`}
    />
  );
}
