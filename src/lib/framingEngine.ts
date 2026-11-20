import type {
  AspectRatioId,
  BackdropConfig,
  ExportResolutionId,
  FramingBlueprint,
  LayoutModeId,
  NormalizedCrop,
  PipConfig,
} from '../types';

export interface CanvasSpec {
  id: AspectRatioId;
  label: string;
  useCase: string;
  w: number;
  h: number;
}

export const CANVAS_SPECS: readonly CanvasSpec[] = [
  { id: '9:16', label: 'Vertical', useCase: 'Reels, Shorts, TikTok', w: 9, h: 16 },
  { id: '4:5', label: 'Portrait', useCase: 'Instagram Feed', w: 4, h: 5 },
  { id: '1:1', label: 'Square', useCase: 'Feed, LinkedIn', w: 1, h: 1 },
  { id: '16:9', label: 'Landscape', useCase: 'YouTube, Desktop', w: 16, h: 9 },
  { id: '4:3', label: 'Classic', useCase: 'Standard 4:3', w: 4, h: 3 },
];

export const DEFAULT_PIP_CONFIG: PipConfig = {
  shape: 'rounded',
  aspect: '16:9',
  corner: 'br',
  x: 52,
  y: 66,
  scale: 44,
  borderWidth: 3,
  borderColor: '#FFFFFF',
  shadow: true,
  flip: false,
  radius: 14,
};

export const DEFAULT_BACKDROP_CONFIG: BackdropConfig = {
  kind: 'blur',
  blur: 24,
  dim: 0.25,
  color: '#09090B',
  from: '#111827',
  to: '#030712',
  angle: 180,
  imgUrl: '',
  imgName: '',
  imgBlur: 8,
  imgDim: 0.2,
};

export interface OutputSlot {
  label: string;
  /** Normalized destination rectangle [x, y, w, h] on the output canvas */
  to: [number, number, number, number];
  contain?: boolean;
}

export function clampNum(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getCanvasSpec(aspect: AspectRatioId): CanvasSpec {
  return CANVAS_SPECS.find((s) => s.id === aspect) ?? CANVAS_SPECS[0];
}

export function getCanvasAspectRatio(aspect: AspectRatioId): number {
  const spec = getCanvasSpec(aspect);
  return spec.w / spec.h;
}

export function getExportPixelDimensions(
  aspect: AspectRatioId,
  resolution: ExportResolutionId = '1080p',
  sourceW = 1920,
  sourceH = 1080
): { width: number; height: number } {
  if (resolution === 'source') {
    const ar = getCanvasAspectRatio(aspect);
    const shortSide = Math.min(sourceW, sourceH);
    const w = ar >= 1 ? Math.round(shortSide * ar) : shortSide;
    const h = ar >= 1 ? shortSide : Math.round(shortSide / ar);
    return { width: w - (w % 2), height: h - (h % 2) };
  }
  const baseShort =
    resolution === '720p' ? 720 : resolution === '2k' ? 1440 : resolution === '4k' ? 2160 : 1080;
  const spec = getCanvasSpec(aspect);
  const ar = spec.w / spec.h;
  if (ar < 1) {
    const width = baseShort;
    const height = Math.round(baseShort / ar);
    return { width: width - (width % 2), height: height - (height % 2) };
  }
  if (ar === 1) {
    return { width: baseShort, height: baseShort };
  }
  const height = baseShort;
  const width = Math.round(baseShort * ar);
  return { width: width - (width % 2), height: height - (height % 2) };
}

/**
 * Exact split preset math (`xb` from decompiled engine):
 * Calculates the vertical split fraction so the Top or Bottom pane matches an exact 16:9 frame.
 */
export function computeSplitPresetRatio(
  preset: '50-50' | '16-9-top' | '16-9-bottom',
  aspect: AspectRatioId = '9:16'
): number {
  const ratio = getCanvasAspectRatio(aspect) / (16 / 9);
  if (preset === '16-9-top') return clampNum(ratio, 0.15, 0.85);
  if (preset === '16-9-bottom') return clampNum(1 - ratio, 0.15, 0.85);
  return 0.5;
}

export function clampCrop(crop: NormalizedCrop): NormalizedCrop {
  const w = clampNum(crop.w, 0.04, 1);
  const h = clampNum(crop.h, 0.04, 1);
  return {
    w,
    h,
    x: clampNum(crop.x, 0, 1 - w),
    y: clampNum(crop.y, 0, 1 - h),
  };
}

export interface SlotLayoutOptions {
  splitRatio?: number;
  pip?: Partial<PipConfig>;
  crops?: readonly NormalizedCrop[];
  sourceAr?: number;
  fullFrameSlots?: Record<number, boolean>;
  freeCrop?: boolean;
}

/** Resolves the effective width/height aspect ratio of the PiP facecam overlay */
export function resolvePipAspectRatio(
  pip: Partial<PipConfig> | undefined,
  facecamCrop?: NormalizedCrop,
  sourceAr = 16 / 9
): number {
  const merged = { ...DEFAULT_PIP_CONFIG, ...pip };
  if (merged.shape === 'circle') return 1;
  const aspectId = merged.aspect ?? '16:9';
  if (aspectId === '1:1') return 1;
  if (aspectId === '4:3') return 4 / 3;
  if (aspectId === 'free' && facecamCrop) {
    return clampNum((facecamCrop.w * sourceAr) / Math.max(0.01, facecamCrop.h), 0.45, 2.6);
  }
  return 16 / 9;
}

/**
 * Exact output slot geometry (`Sb` from decompiled engine):
 * Returns normalized destination rectangles for every active slot of the chosen layout.
 */
export function getOutputSlots(
  layout: LayoutModeId,
  aspect: AspectRatioId,
  opts?: SlotLayoutOptions
): OutputSlot[] {
  if (layout === 'split') {
    const r = clampNum(opts?.splitRatio ?? 0.5, 0.15, 0.85);
    return [
      { label: 'Top Speaker', to: [0, 0, 1, r] },
      { label: 'Bottom Speaker', to: [0, r, 1, 1 - r] },
    ];
  }
  if (layout === 'pip') {
    const pip: PipConfig = { ...DEFAULT_PIP_CONFIG, ...opts?.pip };
    const canvasAr = getCanvasAspectRatio(aspect);
    const w = clampNum((pip.scale ?? 44) / 100, 0.15, 0.85);
    const pipAr = resolvePipAspectRatio(pip, opts?.crops?.[1], opts?.sourceAr ?? 16 / 9);
    const h = clampNum((w * canvasAr) / pipAr, 0.08, 0.72);
    const marginX = 0.04;
    const marginY = 0.04;
    let x = (pip.x ?? 52) / 100;
    let y = (pip.y ?? 66) / 100;
    if (pip.corner === 'tl') {
      x = marginX;
      y = marginY;
    } else if (pip.corner === 'tr') {
      x = 1 - w - marginX;
      y = marginY;
    } else if (pip.corner === 'bl') {
      x = marginX;
      y = 1 - h - marginY - 0.06;
    } else if (pip.corner === 'br') {
      x = 1 - w - marginX;
      y = 1 - h - marginY - 0.06;
    }
    x = clampNum(x, 0, 1 - w);
    y = clampNum(y, 0, 1 - h);
    return [
      { label: 'Main Video', to: [0, 0, 1, 1] },
      { label: 'Facecam (PiP)', to: [x, y, w, h] },
    ];
  }
  if (layout === 'trio') {
    return [
      { label: 'Top', to: [0, 0, 1, 1 / 3] },
      { label: 'Middle', to: [0, 1 / 3, 1, 1 / 3] },
      { label: 'Bottom', to: [0, 2 / 3, 1, 1 / 3] },
    ];
  }
  if (layout === 'centered') {
    return [{ label: 'Full Frame', to: [0, 0, 1, 1], contain: true }];
  }
  return [{ label: 'Frame', to: [0, 0, 1, 1] }];
}

export function getCroppableSlots(
  layout: LayoutModeId,
  aspect: AspectRatioId,
  opts?: SlotLayoutOptions
): OutputSlot[] {
  return getOutputSlots(layout, aspect, opts).filter((s) => !s.contain);
}

/** Exact aspect ratio of an output slot (`wb` from decompiled engine) */
export function getSlotAspect(slot: OutputSlot, aspect: AspectRatioId): number {
  return (getCanvasAspectRatio(aspect) * slot.to[2]) / Math.max(0.01, slot.to[3]);
}

function normHFromW(normW: number, slotAr: number, sourceAr: number): number {
  return (normW * sourceAr) / slotAr;
}

/**
 * Exact aspect-locked crop box fitter (`Eb` from decompiled engine):
 * Preserves box center while locking normalized width/height to the exact slot aspect ratio.
 */
export function fitCropToAspect(
  crop: NormalizedCrop,
  slotAr: number,
  sourceAr: number
): NormalizedCrop {
  let h = crop.h;
  let w = (h * slotAr) / sourceAr;
  if (w > 1) {
    w = 1;
    h = normHFromW(1, slotAr, sourceAr);
  }
  if (h > 1) {
    h = 1;
    w = slotAr / sourceAr;
  }
  return clampCrop({
    w,
    h,
    x: crop.x + crop.w / 2 - w / 2,
    y: crop.y + crop.h / 2 - h / 2,
  });
}

/**
 * Exact default crops per layout (`Db` from decompiled engine).
 */
export function defaultCropsForLayout(
  layout: LayoutModeId,
  aspect: AspectRatioId,
  sourceAr = 16 / 9,
  opts?: SlotLayoutOptions
): NormalizedCrop[] {
  const slots = getCroppableSlots(layout, aspect, { ...opts, sourceAr });
  const count = Math.max(1, slots.length);

  return slots.map((slot, idx) => {
    if (opts?.fullFrameSlots?.[idx]) {
      return { x: 0, y: 0, w: 1, h: 1 };
    }
    const slotAr = getSlotAspect(slot, aspect);

    if (layout === 'pip') {
      if (idx === 0) {
        const w = slotAr / sourceAr <= 1 ? slotAr / sourceAr : 1;
        const h = normHFromW(w, slotAr, sourceAr);
        return clampCrop({ w, h, x: (1 - w) / 2, y: (1 - h) / 2 });
      }
      // Default rectangular webcam crop in top-left corner where stream facecams typically sit
      let w = 0.28;
      let h = normHFromW(w, slotAr, sourceAr);
      if (h > 1) {
        h = 1;
        w = slotAr / sourceAr;
      }
      if (w > 1) {
        w = 1;
        h = normHFromW(1, slotAr, sourceAr);
      }
      return clampCrop({
        w,
        h,
        x: 0.02,
        y: 0.03,
      });
    }

    let w = 1 / count;
    let h = normHFromW(w, slotAr, sourceAr);
    if (h > 1) {
      h = 1;
      w = slotAr / sourceAr;
    }
    if (w > 1) {
      w = 1;
      h = normHFromW(1, slotAr, sourceAr);
    }
    return clampCrop({
      w,
      h,
      x: count === 1 ? (1 - w) / 2 : clampNum(idx / count, 0, 1 - w),
      y: (1 - h) / 2,
    });
  });
}

/**
 * Reconciles existing crops (`Ob` from decompiled engine) when aspect, splitRatio, or PiP changes.
 */
export function reconcileCrops(
  layout: LayoutModeId,
  aspect: AspectRatioId,
  sourceAr: number,
  existing: readonly NormalizedCrop[] | undefined,
  opts?: SlotLayoutOptions
): NormalizedCrop[] {
  const slots = getCroppableSlots(layout, aspect, { ...opts, crops: existing, sourceAr });
  if (Array.isArray(existing) && existing.length === slots.length) {
    return existing.map((crop, i) => {
      if (opts?.fullFrameSlots?.[i]) {
        return { x: 0, y: 0, w: 1, h: 1 };
      }
      const isFreePipFacecam =
        layout === 'pip' &&
        i === 1 &&
        (opts?.pip?.shape ?? DEFAULT_PIP_CONFIG.shape) !== 'circle' &&
        (opts?.pip?.aspect ?? DEFAULT_PIP_CONFIG.aspect) === 'free';
      if (opts?.freeCrop || isFreePipFacecam) {
        return clampCrop(crop);
      }
      return fitCropToAspect(crop, getSlotAspect(slots[i], aspect), sourceAr);
    });
  }
  return defaultCropsForLayout(layout, aspect, sourceAr, opts);
}

/** Swaps Top ↔ Bottom or Main ↔ PiP crop regions while re-locking their aspect ratios */
export function swapLayoutCrops(
  blueprint: FramingBlueprint,
  sourceAr = 16 / 9
): NormalizedCrop[] {
  if (blueprint.crops.length < 2) return blueprint.crops;
  const swapped = [...blueprint.crops];
  const first = swapped[0];
  swapped[0] = swapped[1];
  swapped[1] = first;
  return reconcileCrops(blueprint.layout, blueprint.aspect, sourceAr, swapped, {
    splitRatio: blueprint.splitRatio,
    pip: blueprint.pip,
    fullFrameSlots: blueprint.fullFrameSlots,
    freeCrop: blueprint.freeCrop,
  });
}

export function createDefaultFramingBlueprint(
  layout: LayoutModeId = 'split',
  aspect: AspectRatioId = '9:16',
  sourceAr = 16 / 9
): FramingBlueprint {
  const splitRatio = 0.5;
  const pip = { ...DEFAULT_PIP_CONFIG };
  return {
    layout,
    aspect,
    crops: defaultCropsForLayout(layout, aspect, sourceAr, { splitRatio, pip }),
    fullFrameSlots: {},
    freeCrop: false,
    splitRatio,
    dividerWidth: 0,
    dividerColor: '#FFFFFF',
    pip,
    centeredScale: 1,
    centeredPanX: 0,
    centeredPanY: 0,
    centerShadow: 35,
    radius: 0,
    padding: 0,
    fillActive: true,
    fillKind: 'solid',
    fillColor: '#000000',
    fillTo: '#18181B',
    fillAngle: 180,
    backdrop: { ...DEFAULT_BACKDROP_CONFIG },
    speed: 1,
    slotMedia: {},
  };
}

/* ---------- Real-time HTML5 2D Canvas Compositor (exact decompiled vT/bT/yT/drawFrame math) ---------- */

const REF_WIDTH = 1080;

let blurScratchCanvas: HTMLCanvasElement | null = null;
function getBlurScratch(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  if (!blurScratchCanvas) blurScratchCanvas = document.createElement('canvas');
  blurScratchCanvas.width = w;
  blurScratchCanvas.height = h;
  const ctx = blurScratchCanvas.getContext('2d');
  if (!ctx) return null;
  return { canvas: blurScratchCanvas, ctx };
}

function drawGradientRect(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  from: string,
  to: string,
  angleDeg: number
) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const half = Math.hypot(rect.w, rect.h) / 2;
  const grad = ctx.createLinearGradient(
    cx - Math.cos(rad) * half,
    cy - Math.sin(rad) * half,
    cx + Math.cos(rad) * half,
    cy + Math.sin(rad) * half
  );
  grad.addColorStop(0, from);
  grad.addColorStop(1, to);
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function drawOuterFill(
  ctx: CanvasRenderingContext2D,
  bp: FramingBlueprint,
  rect: { x: number; y: number; w: number; h: number }
) {
  if (!bp.fillActive) return;
  if (bp.fillKind === 'gradient') {
    drawGradientRect(ctx, rect, bp.fillColor, bp.fillTo, bp.fillAngle);
  } else {
    ctx.fillStyle = bp.fillColor || '#000000';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  backdrop: BackdropConfig,
  rect: { x: number; y: number; w: number; h: number },
  bgImage: HTMLImageElement | null
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  if (backdrop.kind === 'image') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (bgImage && bgImage.naturalWidth > 0) {
      const scale =
        Math.max(rect.w / bgImage.naturalWidth, rect.h / bgImage.naturalHeight) *
        (backdrop.imgBlur > 0 ? 1.06 : 1);
      const dw = bgImage.naturalWidth * scale;
      const dh = bgImage.naturalHeight * scale;
      const dx = rect.x + (rect.w - dw) / 2;
      const dy = rect.y + (rect.h - dh) / 2;
      if (backdrop.imgBlur > 0) {
        const sw = backdrop.imgBlur > 15 ? 48 : 80;
        const sh = Math.max(1, Math.round(sw * (bgImage.naturalHeight / bgImage.naturalWidth)));
        const scratch = getBlurScratch(sw, sh);
        if (scratch) {
          scratch.ctx.drawImage(bgImage, 0, 0, sw, sh);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(scratch.canvas, dx, dy, dw, dh);
        } else {
          ctx.drawImage(bgImage, dx, dy, dw, dh);
        }
      } else {
        ctx.drawImage(bgImage, dx, dy, dw, dh);
      }
    }
    if (backdrop.imgDim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${backdrop.imgDim})`;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
    return;
  }

  if (backdrop.kind === 'blur' && video && video.videoWidth > 0) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(rect.w / vw, rect.h / vh) * 1.15;
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = rect.x + (rect.w - dw) / 2;
    const dy = rect.y + (rect.h - dh) / 2;
    if (backdrop.blur > 0) {
      const sw = backdrop.blur > 25 ? 36 : backdrop.blur > 15 ? 56 : 96;
      const sh = Math.max(1, Math.round((vh / vw) * sw));
      const scratch = getBlurScratch(sw, sh);
      if (scratch) {
        scratch.ctx.drawImage(video, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(scratch.canvas, dx, dy, dw, dh);
      } else {
        ctx.drawImage(video, dx, dy, dw, dh);
      }
    } else {
      ctx.drawImage(video, dx, dy, dw, dh);
    }
  } else if (backdrop.kind === 'color') {
    ctx.fillStyle = backdrop.color || '#09090B';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  } else {
    drawGradientRect(ctx, rect, backdrop.from, backdrop.to, backdrop.angle);
  }

  if (backdrop.dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${backdrop.dim})`;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
}

export function renderFramedCanvas2D(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  w: number,
  h: number,
  bp: FramingBlueprint,
  slotMediaEls?: Record<number, HTMLVideoElement | HTMLImageElement | null>,
  bgImage?: HTMLImageElement | null,
  v1Hidden = false
): void {
  const sourceAr =
    video && video.videoWidth > 0 && video.videoHeight > 0
      ? video.videoWidth / video.videoHeight
      : 16 / 9;
  const slots = getOutputSlots(bp.layout, bp.aspect, {
    splitRatio: bp.splitRatio,
    pip: bp.pip,
    crops: bp.crops,
    sourceAr,
  });

  ctx.fillStyle = '#09090B';
  ctx.fillRect(0, 0, w, h);

  if (v1Hidden) {
    drawBackdrop(ctx, null, { ...bp.backdrop, kind: 'color', color: '#09090B' }, { x: 0, y: 0, w, h }, null);
    return;
  }

  const hasVideo = Boolean(video && video.videoWidth > 0 && video.readyState >= 1);
  if (!hasVideo) {
    // Clean geometric slot guide when no video frame is loaded yet
    drawBackdrop(ctx, null, bp.backdrop.kind === 'blur' ? { ...bp.backdrop, kind: 'color' } : bp.backdrop, { x: 0, y: 0, w, h }, bgImage ?? null);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    slots.forEach((slot) => {
      const [sx, sy, sw, sh] = slot.to;
      ctx.strokeRect(sx * w + 4, sy * h + 4, sw * w - 8, sh * h - 8);
    });
    return;
  }

  const vid = video!;
  const vw = vid.videoWidth;
  const vh = vid.videoHeight;
  const scaleFactor = w / REF_WIDTH;
  const padPx = bp.padding * scaleFactor;
  const radPx = bp.radius * scaleFactor;
  const innerScale = Math.max(0, Math.min((w - padPx * 2) / w, (h - padPx * 2) / h));
  const innerRect = {
    x: (w - w * innerScale) / 2,
    y: (h - h * innerScale) / 2,
    w: w * innerScale,
    h: h * innerScale,
  };

  const fullCanvas = { x: 0, y: 0, w, h };
  const anySlotContain = slots.some(
    (s, idx) => Boolean(s.contain || bp.fullFrameSlots?.[idx] || (bp.freeCrop && !(bp.layout === 'pip' && idx === 1)))
  );
  const isClippedMulti = !anySlotContain && bp.layout !== 'pip';

  if (bp.fillActive && padPx > 0 && isClippedMulti) {
    drawOuterFill(ctx, bp, fullCanvas);
  } else if (bp.fillActive && padPx > 0) {
    drawOuterFill(ctx, bp, fullCanvas);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(innerRect.x, innerRect.y, innerRect.w, innerRect.h, Math.min(radPx, innerRect.w / 2, innerRect.h / 2));
    ctx.clip();
    drawBackdrop(ctx, vid, bp.backdrop, innerRect, bgImage ?? null);
    ctx.restore();
  } else if (!isClippedMulti || padPx > 0 || radPx > 0) {
    drawBackdrop(ctx, vid, bp.backdrop, fullCanvas, bgImage ?? null);
  }

  ctx.save();
  if (radPx > 0 && isClippedMulti) {
    ctx.beginPath();
    ctx.roundRect(
      innerRect.x,
      innerRect.y,
      innerRect.w,
      innerRect.h,
      Math.min(radPx, innerRect.w / 2, innerRect.h / 2)
    );
    ctx.clip();
  }

  let cropIdx = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const [sx, sy, sw, sh] = slot.to;
    const dest = {
      x: innerRect.x + sx * innerRect.w,
      y: innerRect.y + sy * innerRect.h,
      w: sw * innerRect.w,
      h: sh * innerRect.h,
    };

    if (slot.contain) {
      const cardScale = Math.max(0.1, Number(bp.centeredScale ?? 1));
      const fit = Math.min(dest.w / vw, dest.h / vh) * cardScale;
      const dw = vw * fit;
      const dh = vh * fit;
      const dx = dest.x + (dest.w - dw) / 2 + ((bp.centeredPanX ?? 0) / 100) * (w / 2);
      const dy = dest.y + (dest.h - dh) / 2 + ((bp.centeredPanY ?? 0) / 100) * (h / 2);
      const cardRect = { x: dx, y: dy, w: dw, h: dh };
      const shadowAmt = clampNum(bp.centerShadow ?? 0, 0, 100) / 100;
      const cardRad = Math.min(radPx, dw / 2, dh / 2);

      if (shadowAmt > 0) {
        ctx.save();
        ctx.shadowColor = `rgba(0,0,0,${0.63 * shadowAmt})`;
        ctx.shadowBlur = 32 * scaleFactor * shadowAmt;
        ctx.shadowOffsetY = 8 * scaleFactor * shadowAmt;
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.roundRect(cardRect.x, cardRect.y, cardRect.w, cardRect.h, cardRad);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      if (cardRad > 0) {
        ctx.beginPath();
        ctx.roundRect(cardRect.x, cardRect.y, cardRect.w, cardRect.h, cardRad);
        ctx.clip();
      }
      ctx.drawImage(vid, cardRect.x, cardRect.y, cardRect.w, cardRect.h);
      ctx.restore();
      continue;
    }

    const crop = bp.crops[cropIdx++];
    if (!crop) continue;

    // Optional per-slot custom media override
    const customEl = slotMediaEls?.[i] ?? null;
    const isCustomVideo = Boolean(
      customEl && 'videoWidth' in customEl && customEl.videoWidth > 0 && customEl.readyState >= 2
    );
    const isCustomImg = Boolean(
      customEl && 'naturalWidth' in customEl && customEl.naturalWidth > 0 && customEl.complete
    );
    const useCustom = isCustomVideo || isCustomImg;
    const srcEl = useCustom && customEl ? customEl : vid;
    const srcW =
      useCustom && customEl
        ? 'videoWidth' in customEl
          ? customEl.videoWidth
          : customEl.naturalWidth
        : vw;
    const srcH =
      useCustom && customEl
        ? 'videoHeight' in customEl
          ? customEl.videoHeight
          : customEl.naturalHeight
        : vh;

    let srcX = useCustom ? 0 : crop.x * srcW;
    let srcY = useCustom ? 0 : crop.y * srcH;
    let cropW = useCustom ? srcW : crop.w * srcW;
    let cropH = useCustom ? srcH : crop.h * srcH;

    const slotIsFullFrame = Boolean(bp.fullFrameSlots?.[i]);
    const slotUseContain =
      slotIsFullFrame ||
      Boolean(bp.freeCrop && !(bp.layout === 'pip' && i === 1) && Math.abs(cropW / Math.max(1, cropH) - dest.w / Math.max(1, dest.h)) > 0.04);

    if (slotUseContain && !(bp.layout === 'pip' && i === 1)) {
      const fit = Math.min(dest.w / Math.max(1, cropW), dest.h / Math.max(1, cropH));
      const drawW = cropW * fit;
      const drawH = cropH * fit;
      const drawX = dest.x + (dest.w - drawW) / 2;
      const drawY = dest.y + (dest.h - drawH) / 2;
      const cardRad = Math.min(radPx, drawW / 2, drawH / 2);

      ctx.save();
      if (cardRad > 0) {
        ctx.beginPath();
        ctx.roundRect(drawX, drawY, drawW, drawH, cardRad);
        ctx.clip();
      }
      try {
        ctx.drawImage(srcEl, srcX, srcY, cropW, cropH, drawX, drawY, drawW, drawH);
      } catch {
        // ignore transient frame decode error
      }
      ctx.restore();
      continue;
    }

    // Exact center-cover match to slot aspect
    const destAr = dest.w / Math.max(1, dest.h);
    if (cropW / Math.max(1, cropH) > destAr) {
      const targetW = cropH * destAr;
      srcX += (cropW - targetW) / 2;
      cropW = targetW;
    } else {
      const targetH = cropW / destAr;
      srcY += (cropH - targetH) / 2;
      cropH = targetH;
    }

    if (bp.layout === 'pip' && i === 1) {
      const pip = { ...DEFAULT_PIP_CONFIG, ...bp.pip };
      ctx.save();
      if (pip.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 12 * scaleFactor;
        ctx.shadowOffsetY = 4 * scaleFactor;
      }
      ctx.beginPath();
      if (pip.shape === 'circle') {
        const r = Math.min(dest.w, dest.h) / 2;
        ctx.arc(dest.x + dest.w / 2, dest.y + dest.h / 2, r, 0, Math.PI * 2);
      } else if (pip.shape === 'rect') {
        ctx.rect(dest.x, dest.y, dest.w, dest.h);
      } else {
        const r = Math.min(Math.min(dest.w, dest.h) / 2, (pip.radius ?? 14) * scaleFactor);
        ctx.roundRect(dest.x, dest.y, dest.w, dest.h, r);
      }
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();

      if (pip.flip) {
        ctx.translate(dest.x + dest.w / 2, dest.y + dest.h / 2);
        ctx.scale(-1, 1);
        ctx.translate(-(dest.x + dest.w / 2), -(dest.y + dest.h / 2));
      }
      try {
        ctx.drawImage(srcEl, srcX, srcY, cropW, cropH, dest.x, dest.y, dest.w, dest.h);
      } catch {
        // ignore transient frame decode error
      }
      ctx.restore();

      if (pip.borderWidth > 0) {
        ctx.save();
        ctx.beginPath();
        const bw = pip.borderWidth * scaleFactor;
        if (pip.shape === 'circle') {
          const r = Math.min(dest.w, dest.h) / 2;
          ctx.arc(dest.x + dest.w / 2, dest.y + dest.h / 2, Math.max(0, r - bw / 2), 0, Math.PI * 2);
        } else if (pip.shape === 'rect') {
          ctx.rect(dest.x + bw / 2, dest.y + bw / 2, Math.max(0, dest.w - bw), Math.max(0, dest.h - bw));
        } else {
          const r = Math.min(Math.min(dest.w, dest.h) / 2, (pip.radius ?? 14) * scaleFactor);
          ctx.roundRect(
            dest.x + bw / 2,
            dest.y + bw / 2,
            Math.max(0, dest.w - bw),
            Math.max(0, dest.h - bw),
            Math.max(0, r - bw / 2)
          );
        }
        ctx.lineWidth = bw;
        ctx.strokeStyle = pip.borderColor || '#FFFFFF';
        ctx.stroke();
        ctx.restore();
      }
    } else {
      try {
        ctx.drawImage(srcEl, srcX, srcY, cropW, cropH, dest.x, dest.y, dest.w, dest.h);
      } catch {
        // ignore transient frame decode error
      }
    }
  }

  // Divider line for Split & Trio layouts
  const divPx = Math.max(0, bp.dividerWidth ?? 0) * scaleFactor;
  if (divPx > 0 && (bp.layout === 'split' || bp.layout === 'trio')) {
    ctx.fillStyle = bp.dividerColor || '#FFFFFF';
    for (let i = 1; i < slots.length; i++) {
      const y = innerRect.y + slots[i].to[1] * innerRect.h;
      ctx.fillRect(innerRect.x, y - divPx / 2, innerRect.w, divPx);
    }
  }

  ctx.restore();
}

/**
 * Generates an exact FFmpeg video filtergraph from the Framing Blueprint.
 */
export function buildFramingFiltergraph(
  bp: FramingBlueprint,
  resolution: ExportResolutionId = '1080p',
  inputLabel = '[0:v]',
  outputLabel = '[vframed]'
): string {
  const { width: W, height: H } = getExportPixelDimensions(bp.aspect, resolution);
  const speed = clampNum(bp.speed || 1, 0.25, 4);
  const speedSuffix = Math.abs(speed - 1) > 0.01 ? `,setpts=PTS/${speed.toFixed(2)}` : '';
  const slots = getOutputSlots(bp.layout, bp.aspect, {
    splitRatio: bp.splitRatio,
    pip: bp.pip,
    crops: bp.crops,
  });

  const bgColor = bp.backdrop.color || '#09090B';
  const buildBackdropExpr = () =>
    bp.backdrop.kind === 'blur'
      ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=${Math.max(4, Math.round(bp.backdrop.blur / 2))}:2`
      : `scale=${W}:${H},drawbox=x=0:y=0:w=${W}:h=${H}:color=${bgColor}@1:t=fill`;

  const slotScaleExpr = (idx: number, crop: NormalizedCrop, tw: number, th: number) => {
    const cropPart = `crop=iw*${crop.w.toFixed(3)}:ih*${crop.h.toFixed(3)}:iw*${crop.x.toFixed(3)}:ih*${crop.y.toFixed(3)}`;
    if (bp.fullFrameSlots?.[idx] || bp.freeCrop) {
      return `${cropPart},scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=${bgColor}`;
    }
    return `${cropPart},scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`;
  };

  if (bp.layout === 'split' && bp.crops.length >= 2) {
    const topH = Math.round(H * clampNum(bp.splitRatio, 0.15, 0.85));
    const botH = H - topH;
    const c0 = bp.crops[0];
    const c1 = bp.crops[1];
    const divFilter =
      bp.dividerWidth > 0
        ? `,drawbox=x=0:y=${Math.max(0, topH - Math.round(bp.dividerWidth / 2))}:w=${W}:h=${bp.dividerWidth}:color=${bp.dividerColor}@1:t=fill`
        : '';
    return (
      `${inputLabel}split=2[s0][s1];` +
      `[s0]${slotScaleExpr(0, c0, W, topH)}[top];` +
      `[s1]${slotScaleExpr(1, c1, W, botH)}[bot];` +
      `[top][bot]vstack=inputs=2${divFilter}${speedSuffix}${outputLabel}`
    );
  }

  if (bp.layout === 'trio' && bp.crops.length >= 3) {
    const bandH = Math.floor(H / 3);
    const botH = H - bandH * 2;
    const [c0, c1, c2] = bp.crops;
    const divFilter =
      bp.dividerWidth > 0
        ? `,drawbox=x=0:y=${bandH}:w=${W}:h=${bp.dividerWidth}:color=${bp.dividerColor}@1:t=fill,drawbox=x=0:y=${bandH * 2}:w=${W}:h=${bp.dividerWidth}:color=${bp.dividerColor}@1:t=fill`
        : '';
    return (
      `${inputLabel}split=3[s0][s1][s2];` +
      `[s0]${slotScaleExpr(0, c0, W, bandH)}[t0];` +
      `[s1]${slotScaleExpr(1, c1, W, bandH)}[t1];` +
      `[s2]${slotScaleExpr(2, c2, W, botH)}[t2];` +
      `[t0][t1][t2]vstack=inputs=3${divFilter}${speedSuffix}${outputLabel}`
    );
  }

  if (bp.layout === 'pip' && bp.crops.length >= 2) {
    const cMain = bp.crops[0];
    const cPip = bp.crops[1];
    const pipSlot = slots[1];
    const px = Math.round(pipSlot.to[0] * W);
    const py = Math.round(pipSlot.to[1] * H);
    const rawPw = Math.max(64, Math.round(pipSlot.to[2] * W));
    const rawPh = Math.max(64, Math.round(pipSlot.to[3] * H));
    const pw = rawPw - (rawPw % 2);
    const ph = rawPh - (rawPh % 2);
    const flipFilter = bp.pip.flip ? ',hflip' : '';
    const mainIsContain = Boolean(bp.fullFrameSlots?.[0] || bp.freeCrop);

    if (mainIsContain) {
      return (
        `${inputLabel}split=3[bg_in][main_in][pip_in];` +
        `[bg_in]${buildBackdropExpr()}[bg];` +
        `[main_in]crop=iw*${cMain.w.toFixed(3)}:ih*${cMain.h.toFixed(3)}:iw*${cMain.x.toFixed(3)}:ih*${cMain.y.toFixed(3)},scale=${W}:${H}:force_original_aspect_ratio=decrease[main_fg];` +
        `[bg][main_fg]overlay=(W-w)/2:(H-h)/2[main_bg];` +
        `[pip_in]crop=iw*${cPip.w.toFixed(3)}:ih*${cPip.h.toFixed(3)}:iw*${cPip.x.toFixed(3)}:ih*${cPip.y.toFixed(3)},scale=${pw}:${ph}:force_original_aspect_ratio=increase,crop=${pw}:${ph}${flipFilter}[pip_fg];` +
        `[main_bg][pip_fg]overlay=x=${px}:y=${py}${speedSuffix}${outputLabel}`
      );
    }

    return (
      `${inputLabel}split=2[main_in][pip_in];` +
      `[main_in]crop=iw*${cMain.w.toFixed(3)}:ih*${cMain.h.toFixed(3)}:iw*${cMain.x.toFixed(3)}:ih*${cMain.y.toFixed(3)},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}[main_bg];` +
      `[pip_in]crop=iw*${cPip.w.toFixed(3)}:ih*${cPip.h.toFixed(3)}:iw*${cPip.x.toFixed(3)}:ih*${cPip.y.toFixed(3)},scale=${pw}:${ph}:force_original_aspect_ratio=increase,crop=${pw}:${ph}${flipFilter}[pip_fg];` +
      `[main_bg][pip_fg]overlay=x=${px}:y=${py}${speedSuffix}${outputLabel}`
    );
  }

  if (bp.layout === 'centered') {
    const fgW = Math.round(W * clampNum(bp.centeredScale, 0.3, 1.5));
    const ox = Math.round(((bp.centeredPanX ?? 0) / 100) * (W / 2));
    const oy = Math.round(((bp.centeredPanY ?? 0) / 100) * (H / 2));
    return (
      `${inputLabel}split=2[bg_in][fg_in];` +
      `[bg_in]${buildBackdropExpr()}[bg];` +
      `[fg_in]scale=${fgW}:-2[fg];` +
      `[bg][fg]overlay=(W-w)/2+${ox}:(H-h)/2+${oy}${speedSuffix}${outputLabel}`
    );
  }

  const c0 = bp.crops[0] ?? { x: 0, y: 0, w: 1, h: 1 };
  if (bp.fullFrameSlots?.[0] || bp.freeCrop) {
    return (
      `${inputLabel}split=2[bg_in][fg_in];` +
      `[bg_in]${buildBackdropExpr()}[bg];` +
      `[fg_in]crop=iw*${c0.w.toFixed(3)}:ih*${c0.h.toFixed(3)}:iw*${c0.x.toFixed(3)}:ih*${c0.y.toFixed(3)},scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2${speedSuffix}${outputLabel}`
    );
  }
  return (
    `${inputLabel}crop=iw*${c0.w.toFixed(3)}:ih*${c0.h.toFixed(3)}:iw*${c0.x.toFixed(3)}:ih*${c0.y.toFixed(3)},` +
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${speedSuffix}${outputLabel}`
  );
}

/** Human-readable 1-line summary of the active Framing Blueprint for Shorts Studio */
export function describeFramingBlueprint(bp: FramingBlueprint): string {
  const pipRatioLabel =
    bp.pip.shape === 'circle'
      ? 'Circle'
      : bp.pip.aspect === 'free'
        ? 'Free Rect'
        : bp.pip.aspect === '4:3'
          ? '4:3 Rect'
          : bp.pip.aspect === '1:1'
            ? '1:1'
            : '16:9 Rect';
  const fullFlag = Boolean(bp.fullFrameSlots?.[0]);
  const layoutLabels: Record<LayoutModeId, string> = {
    split: `Split ${Math.round(bp.splitRatio * 100)}/${Math.round((1 - bp.splitRatio) * 100)}`,
    solo: fullFlag ? 'Solo Full Frame' : 'Solo Crop',
    trio: 'Trio 3-Stack',
    pip: fullFlag ? `PiP ${pipRatioLabel} · Full Frame` : `PiP ${pipRatioLabel}`,
    centered: `Centered ${Math.round(bp.centeredScale * 100)}%`,
    widescreen: '16:9 Clip',
  };
  const speedPart = Math.abs(bp.speed - 1) > 0.01 ? ` · ${bp.speed.toFixed(2)}×` : '';
  return `${bp.aspect} · ${layoutLabels[bp.layout]}${speedPart}`;
}
