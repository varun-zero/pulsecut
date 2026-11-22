import { gunzipSync, unzipSync } from 'fflate';
import type {
  AspectRatioId,
  ColorFilterId,
  HeadlineLayoutStyleId,
  LayoutModeId,
  SubtitleBgStyleId,
  TextCasingId,
  TransitionStyleId,
} from '../types';
import {
  createBlankTemplateDraft,
  type EditableCaptionPreset,
  type EditableTemplatePreset,
  type TemplateOverlayBlendMode,
  type TemplateSourceFormat,
} from './creatorCatalog';
import { clampNum } from './framingEngine';

/* -------------------------------------------------------------------------- */
/* Universal Template Importer                                                */
/* Supports:                                                                  */
/*  - CapCut (draft_content.json, draft_info.json, template.json, .ccut, .zip)*/
/*  - Alight Motion (.xml, .amproj ZIP packages)                              */
/*  - After Effects / Lottie / Canva / Figma (.json)                          */
/*  - Premiere Pro / DaVinci Resolve / Final Cut (.fcpxml, .xml, .mogrt, .prproj) */
/*  - ASS / SSA styled caption templates (.ass, .ssa)                         */
/*  - Visual frame / overlay graphics (.png, .webp, .jpg, sanitized .svg)     */
/*  - PulseCut portable templates (.pulsecut.json)                            */
/*  - Generic third-party JSON templates (heuristic property extraction)      */
/* -------------------------------------------------------------------------- */

export interface ImportFileInput {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
}

export interface ExtractedFontBundle {
  fileName: string;
  family: string;
  bytes: Uint8Array;
}

export interface UniversalTemplateImportResult {
  template: EditableTemplatePreset;
  detectedFormat: TemplateSourceFormat;
  formatLabel: string;
  confidence: 'high' | 'medium' | 'fallback';
  extractedCaptionStyle?: EditableCaptionPreset;
  extractedFonts: ExtractedFontBundle[];
  summary: string[];
  warnings: string[];
}

export const SUPPORTED_TEMPLATE_EXTENSIONS = [
  '.json',
  '.pulsecut.json',
  '.xml',
  '.amproj',
  '.zip',
  '.ccut',
  '.mogrt',
  '.fcpxml',
  '.prproj',
  '.ass',
  '.ssa',
  '.png',
  '.webp',
  '.svg',
  '.jpg',
  '.jpeg',
] as const;

export const TEMPLATE_FILE_ACCEPT_ATTR =
  '.json,.xml,.amproj,.zip,.ccut,.mogrt,.fcpxml,.prproj,.ass,.ssa,.png,.webp,.svg,.jpg,.jpeg,application/json,text/xml,application/xml,application/zip,image/png,image/webp,image/svg+xml,image/jpeg';

const MAX_DECOMPRESSED_BYTES = 40 * 1024 * 1024; // 40 MB safety cap against zip bombs
const MAX_OVERLAY_IMAGE_BYTES = 8 * 1024 * 1024;

/* ---------- Low-level Encoding, Color & Sanitization Utilities ---------- */

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Strips executable elements and event handlers from SVG before embedding as a data URL. */
export function sanitizeSvgMarkup(rawSvg: string): string {
  let clean = rawSvg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
  if (!/xmlns\s*=/i.test(clean)) {
    clean = clean.replace(/<svg(\s|>)/i, '<svg xmlns="http://www.w3.org/2000/svg"$1');
  }
  return clean.trim();
}

export function mapDimensionsToAspectRatio(width: number, height: number): AspectRatioId {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '9:16';
  }
  const ratio = width / height;
  const candidates: Array<{ id: AspectRatioId; r: number }> = [
    { id: '9:16', r: 9 / 16 },
    { id: '4:5', r: 4 / 5 },
    { id: '1:1', r: 1 },
    { id: '4:3', r: 4 / 3 },
    { id: '16:9', r: 16 / 9 },
  ];
  let best = candidates[0];
  let bestDiff = Math.abs(ratio - best.r);
  for (const c of candidates) {
    const diff = Math.abs(ratio - c.r);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best.id;
}

export function parseAspectString(raw: string | undefined | null): AspectRatioId | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (clean === '9:16' || clean === '9/16' || clean === 'vertical' || clean === 'shorts' || clean === 'reels' || clean === 'tiktok') {
    return '9:16';
  }
  if (clean === '4:5' || clean === '4/5' || clean === 'portrait') return '4:5';
  if (clean === '1:1' || clean === '1/1' || clean === 'square') return '1:1';
  if (clean === '4:3' || clean === '4/3') return '4:3';
  if (clean === '16:9' || clean === '16/9' || clean === 'landscape' || clean === 'widescreen' || clean === 'youtube') {
    return '16:9';
  }
  const match = clean.match(/^(\d+(?:\.\d+)?)[:/x×](\d+(?:\.\d+)?)$/);
  if (match) {
    return mapDimensionsToAspectRatio(Number(match[1]), Number(match[2]));
  }
  return null;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0').toUpperCase();
}

export function rgbArrayToHex(arr: unknown): string | null {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  const [rRaw, gRaw, bRaw] = arr;
  if (typeof rRaw !== 'number' || typeof gRaw !== 'number' || typeof bRaw !== 'number') return null;
  // CapCut / Lottie use 0..1 floats; some JSON exports use 0..255 ints.
  const isNormalized = rRaw <= 1 && gRaw <= 1 && bRaw <= 1;
  const r = isNormalized ? rRaw * 255 : rRaw;
  const g = isNormalized ? gRaw * 255 : gRaw;
  const b = isNormalized ? bRaw * 255 : bRaw;
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

/** Normalizes #RGB, #RRGGBB, #AARRGGBB (Alight Motion), 0xRRGGBB, or rgb(r,g,b) into #RRGGBB. */
export function normalizeColorHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  }
  // Alight Motion uses #AARRGGBB (8-digit hex with alpha first)
  if (/^#[0-9a-fA-F]{8}$/.test(s)) {
    return `#${s.slice(3, 9)}`.toUpperCase();
  }
  if (/^0x[0-9a-fA-F]{6}$/i.test(s)) {
    return `#${s.slice(2)}`.toUpperCase();
  }
  const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return `#${toHexByte(Number(rgbMatch[1]))}${toHexByte(Number(rgbMatch[2]))}${toHexByte(Number(rgbMatch[3]))}`;
  }
  return null;
}

/** Converts ASS/SSA BGR color (`&H0000E6FF` or `&H00E6FF`) into standard `#RRGGBB`. */
export function assColorToHex(raw: string): string | null {
  const clean = raw.trim().replace(/^&H/i, '').replace(/&$/, '');
  if (!/^[0-9a-fA-F]{6,8}$/.test(clean)) return null;
  const bgr = clean.length === 8 ? clean.slice(2) : clean;
  const b = bgr.slice(0, 2);
  const g = bgr.slice(2, 4);
  const r = bgr.slice(4, 6);
  return `#${r}${g}${b}`.toUpperCase();
}

function cleanTemplateNameFromFilename(fileName: string): string {
  const base = fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(pulsecut\.json|json|xml|amproj|zip|ccut|mogrt|fcpxml|prproj|ass|ssa|png|webp|svg|jpe?g)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base || /^draft (content|info)$/i.test(base) || /^template$/i.test(base)) {
    return 'Imported Template';
  }
  return base.slice(0, 48);
}

function cleanFontFamilyName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(ttf|otf|woff2?|ttc)$/i, '')
    .replace(/[-_](Bold|Black|ExtraBold|Heavy|Regular|Medium|SemiBold|Italic|Condensed|Variable)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned && cleaned.length >= 2 ? cleaned : null;
}

function inferColorFilterFromKeywords(keywords: string[]): ColorFilterId | undefined {
  const hay = keywords.join(' ').toLowerCase();
  if (!hay) return undefined;
  if (/\b(b&w|bw|black\s*&\s*white|mono|monochrome|grayscale|noir)\b/.test(hay)) return 'bw';
  if (/\b(vintage|retro|vhs|sepia|90s|80s|analog|polaroid)\b/.test(hay)) return 'vintage';
  if (/\b(warm|golden|sunset|amber|peach)\b/.test(hay)) return 'warm';
  if (/\b(cool|cold|ice|blue|cyber|arctic)\b/.test(hay)) return 'cool';
  if (/\b(moody|dark|shadow|gothic|dramatic|night|vignette)\b/.test(hay)) return 'moody';
  if (/\b(vivid|punch|hdr|pop|contrast|sharpen)\b/.test(hay)) return 'contrast';
  if (/\b(cinematic|teal|orange|film|kodak|movie|blockbuster|lut)\b/.test(hay)) return 'cinematic';
  return undefined;
}

function inferTransitionFromKeywords(keywords: string[]): TransitionStyleId | undefined {
  const hay = keywords.join(' ').toLowerCase();
  if (!hay) return undefined;
  if (/\b(zoom|pull\s*in|punch|scale\s*in|whip\s*zoom)\b/.test(hay)) return 'zoom-in';
  if (/\b(slide|whip|pan|push|swipe|left|right)\b/.test(hay)) return 'slide-left';
  if (/\b(black|dip|flash\s*black|fade\s*out|fade\s*to\s*black)\b/.test(hay)) return 'dip-black';
  if (/\b(dissolve|crossfade|mix|fade|blur\s*dissolve|smooth)\b/.test(hay)) return 'crossfade';
  return undefined;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A, IHDR width at 16..19, height at 20..23
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

function readSvgDimensions(svgText: string): { width: number; height: number } | null {
  const vb = svgText.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (vb) {
    const w = Number(vb[1]);
    const h = Number(vb[2]);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  const wMatch = svgText.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const hMatch = svgText.match(/\bheight\s*=\s*["']([\d.]+)/i);
  if (wMatch && hMatch) {
    const w = Number(wMatch[1]);
    const h = Number(hMatch[1]);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  return null;
}

function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isImageFilename(name: string): boolean {
  return /\.(png|webp|svg|jpe?g)$/i.test(name);
}

function isFontFilename(name: string): boolean {
  return /\.(ttf|otf|woff2?)$/i.test(name);
}

function encodeImageToDataUrl(name: string, bytes: Uint8Array, mimeHint?: string): {
  dataUrl: string;
  dimensions: { width: number; height: number } | null;
} {
  const lower = name.toLowerCase();
  if (lower.endsWith('.svg') || mimeHint === 'image/svg+xml') {
    const sanitized = sanitizeSvgMarkup(decodeUtf8(bytes));
    return {
      dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(sanitized)}`,
      dimensions: readSvgDimensions(sanitized),
    };
  }
  const mime =
    mimeHint && mimeHint.startsWith('image/')
      ? mimeHint
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/png';
  return {
    dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}`,
    dimensions: lower.endsWith('.png') ? readPngDimensions(bytes) : null,
  };
}

function pickBestOverlayFromImages(
  images: ImportFileInput[]
): { file: ImportFileInput; dataUrl: string; dimensions: { width: number; height: number } | null } | null {
  if (images.length === 0) return null;
  // Prioritize transparent overlay formats (.png, .svg, .webp) & names mentioning overlay/frame/border/template, skipping thumbnails/icons
  const ranked = [...images]
    .filter((f) => f.bytes.byteLength > 0 && f.bytes.byteLength <= MAX_OVERLAY_IMAGE_BYTES)
    .sort((a, b) => {
      const score = (f: ImportFileInput) => {
        const n = f.name.toLowerCase();
        let s = 0;
        if (/(overlay|frame|border|template|hud|card|chrome|mask|layout)/.test(n)) s += 50;
        if (/(thumb|thumbnail|preview|cover|icon|avatar)/.test(n)) s -= 40;
        if (n.endsWith('.png') || n.endsWith('.svg')) s += 20;
        if (n.endsWith('.webp')) s += 12;
        return s;
      };
      return score(b) - score(a);
    });
  if (ranked.length === 0) return null;
  const chosen = ranked[0];
  const encoded = encodeImageToDataUrl(chosen.name, chosen.bytes, chosen.mimeType);
  return { file: chosen, ...encoded };
}

function buildExtractedCaptionStyle(
  templateName: string,
  opts: {
    font: string;
    activeColor: string;
    baseColor: string;
    strokeWidth: number;
    casing: TextCasingId;
  }
): EditableCaptionPreset {
  return {
    id: `imported-cap-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: `${templateName.slice(0, 22)} Style`,
    tagline: 'Extracted from imported template',
    headlineFont: opts.font,
    subtitleFont: opts.font,
    subtitleWeight: 800,
    casing: opts.casing,
    wordsPerScreen: '2-3',
    baseColor: opts.baseColor,
    activeColor: opts.activeColor,
    emphasisColor: opts.activeColor,
    strokeWidth: clampNum(Math.round(opts.strokeWidth), 0, 10),
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'pop-scale',
    surfaceTreatment: 'outline',
    sampleWords: ['GOES', 'VIRAL'],
    isCustom: true,
  };
}

/* ---------- 1. CapCut Parser (draft_content.json / draft_info.json / template.json) ---------- */

function isCapCutJson(obj: Record<string, unknown>): boolean {
  if ('canvas_config' in obj && ('tracks' in obj || 'materials' in obj)) return true;
  if ('materials' in obj && typeof obj.materials === 'object' && obj.materials !== null) {
    const m = obj.materials as Record<string, unknown>;
    if (Array.isArray(m.texts) || Array.isArray(m.videos) || Array.isArray(m.video_effects)) {
      return true;
    }
  }
  if (typeof obj.platform === 'object' && obj.platform !== null && 'app_id' in (obj.platform as Record<string, unknown>)) {
    return true;
  }
  return false;
}

function parseCapCutJson(
  obj: Record<string, unknown>,
  fileName: string,
  extraFonts: ExtractedFontBundle[],
  overlayImage: { dataUrl: string; name: string } | null
): UniversalTemplateImportResult {
  const summary: string[] = [];
  const warnings: string[] = [];

  const canvas = (obj.canvas_config || {}) as Record<string, unknown>;
  const width = Number(canvas.width || 1080);
  const height = Number(canvas.height || 1920);
  const aspect =
    parseAspectString(typeof canvas.ratio === 'string' ? canvas.ratio : null) ||
    mapDimensionsToAspectRatio(width, height);
  summary.push(`Canvas: ${width}×${height} → ${aspect}`);

  const materials = (obj.materials || {}) as Record<string, unknown>;
  const tracks = Array.isArray(obj.tracks) ? (obj.tracks as Array<Record<string, unknown>>) : [];

  // 1) Analyze video tracks for Split / PiP / Full-Screen layout
  const videoTracks = tracks.filter((t) => String(t.type || '').toLowerCase() === 'video');
  const videoSegments = videoTracks.flatMap((t) =>
    Array.isArray(t.segments) ? (t.segments as Array<Record<string, unknown>>) : []
  );

  let layout: LayoutModeId = aspect === '16:9' ? 'widescreen' : 'solo';
  let fullScreen = false;
  let videoScale = 100;

  if (videoTracks.length >= 2) {
    // Check if the second video track is scaled down (PiP) vs split-screen
    const secondSeg = (videoTracks[1].segments as Array<Record<string, unknown>> | undefined)?.[0];
    const clipObj = (secondSeg?.clip || {}) as Record<string, unknown>;
    const scaleObj = (clipObj.scale || {}) as Record<string, unknown>;
    const sx = Number(scaleObj.x ?? 1);
    const sy = Number(scaleObj.y ?? 1);
    if (sx < 0.65 && sy < 0.65) {
      layout = 'pip';
      summary.push('Layout: Reaction PiP (2 video tracks with scaled overlay cam)');
    } else {
      layout = 'split';
      summary.push('Layout: Split Screen (multi-track video composition)');
    }
  } else if (videoSegments.length > 0) {
    const firstClip = (videoSegments[0].clip || {}) as Record<string, unknown>;
    const scaleObj = (firstClip.scale || {}) as Record<string, unknown>;
    const sx = Number(scaleObj.x ?? 1);
    if (Number.isFinite(sx) && sx > 0.25 && sx < 2.5) {
      videoScale = Math.round(clampNum(sx * 100, 50, 220));
    }
    // Check if a 16:9 material sits inside a vertical 9:16 canvas at ~1.0x (uncropped full-screen)
    const videosMat = Array.isArray(materials.videos) ? (materials.videos as Array<Record<string, unknown>>) : [];
    const firstVideoMat = videosMat[0];
    const matW = Number(firstVideoMat?.width || 0);
    const matH = Number(firstVideoMat?.height || 0);
    if (aspect === '9:16' && matW > matH && sx <= 1.05) {
      fullScreen = true;
      summary.push('Framing: Full-screen 100% uncropped horizontal source on 9:16 canvas');
    } else {
      summary.push(`Layout: Solo (${aspect})`);
    }
  }

  // 2) Extract text styles, colors, fonts & Y-positions
  const textMaterials = Array.isArray(materials.texts) ? (materials.texts as Array<Record<string, unknown>>) : [];
  const textSegments = tracks
    .filter((t) => String(t.type || '').toLowerCase() === 'text')
    .flatMap((t) => (Array.isArray(t.segments) ? (t.segments as Array<Record<string, unknown>>) : []));

  // Map material_id -> CapCut normalized transform.y (-1 bottom .. +1 top)
  const textYByMaterialId = new Map<string, number>();
  for (const seg of textSegments) {
    const mid = String(seg.material_id || '');
    const clip = (seg.clip || {}) as Record<string, unknown>;
    const transform = (clip.transform || {}) as Record<string, unknown>;
    if (mid && typeof transform.y === 'number') {
      // CapCut coordinate: y = +1 is top (0%), y = 0 is center (50%), y = -1 is bottom (100%)
      const pctY = Math.round(clampNum((1 - transform.y) * 50, 8, 90));
      textYByMaterialId.set(mid, pctY);
    }
  }

  let headlineFont = 'Montserrat';
  let subtitleFont = 'Montserrat';
  let headlineY = 18;
  let subtitleY = 68;
  let headlineSize = 22;
  let subtitleSize = 26;
  let activeColor = '#FFE600';
  let baseColor = '#FFFFFF';
  let strokeWidth = 4;
  let subtitleBg: SubtitleBgStyleId = 'none';
  let headlineLayout: HeadlineLayoutStyleId = 'outline-only';
  let casing: TextCasingId = 'upper';
  const extractedFontsSet = new Set<string>();
  const extractedColors: string[] = [];

  textMaterials.forEach((tm, idx) => {
    const id = String(tm.id || '');
    const pctY = textYByMaterialId.get(id);
    const isTopHook = pctY !== undefined ? pctY < 42 : idx === 0 && textMaterials.length > 1;

    // CapCut stores rich text either directly on the object or JSON-encoded inside `tm.content`
    let parsedContent: Record<string, unknown> | null = null;
    if (typeof tm.content === 'string' && tm.content.trim().startsWith('{')) {
      try {
        parsedContent = JSON.parse(tm.content) as Record<string, unknown>;
      } catch {
        parsedContent = null;
      }
    }

    const styles = Array.isArray(parsedContent?.styles)
      ? (parsedContent?.styles as Array<Record<string, unknown>>)
      : [];
    const primaryStyle = styles[0] || {};
    const fontObj = (primaryStyle.font || {}) as Record<string, unknown>;
    const rawFont =
      (typeof fontObj.path === 'string' && fontObj.path) ||
      (typeof fontObj.name === 'string' && fontObj.name) ||
      (typeof tm.font_title === 'string' && tm.font_title) ||
      (typeof tm.font_path === 'string' && tm.font_path) ||
      '';
    const fontName = cleanFontFamilyName(rawFont);
    if (fontName) {
      extractedFontsSet.add(fontName);
      if (isTopHook) headlineFont = fontName;
      else subtitleFont = fontName;
    }

    const rawSize = Number(primaryStyle.size ?? tm.font_size ?? 0);
    if (rawSize > 0) {
      // CapCut font sizes typically range 4..20 (scaled to canvas) or 20..90px
      const mappedPx = rawSize <= 24 ? Math.round(clampNum(rawSize * 2.4, 16, 42)) : Math.round(clampNum(rawSize * 0.55, 16, 42));
      if (isTopHook) headlineSize = mappedPx;
      else subtitleSize = mappedPx;
    }

    const fillObj = (primaryStyle.fill || {}) as Record<string, unknown>;
    const fillContent = (fillObj.content || {}) as Record<string, unknown>;
    const solidObj = (fillContent.solid || {}) as Record<string, unknown>;
    const colorHex =
      rgbArrayToHex(solidObj.color) ||
      normalizeColorHex(tm.text_color) ||
      normalizeColorHex(primaryStyle.color);
    if (colorHex) {
      extractedColors.push(colorHex);
      if (colorHex !== '#FFFFFF' && colorHex !== '#000000') {
        activeColor = colorHex;
      } else if (!isTopHook) {
        baseColor = colorHex;
      }
    }

    const strokes = Array.isArray(primaryStyle.strokes)
      ? (primaryStyle.strokes as Array<Record<string, unknown>>)
      : [];
    if (strokes.length > 0) {
      const sw = Number(strokes[0].width ?? 0.08);
      strokeWidth = Math.round(clampNum(sw <= 1 ? sw * 45 : sw, 1, 8));
    }

    if (tm.background_alpha && Number(tm.background_alpha) > 0.2) {
      const bgHex = normalizeColorHex(tm.background_color);
      if (isTopHook) {
        headlineLayout = bgHex === '#FFFFFF' ? 'white-stepped' : 'dark-stepped';
      } else {
        subtitleBg = bgHex === '#FFFFFF' ? 'white-stepped' : 'dark-pill';
      }
    }

    const rawText = typeof parsedContent?.text === 'string' ? parsedContent.text : typeof tm.text === 'string' ? tm.text : '';
    if (rawText.length >= 4) {
      if (rawText === rawText.toUpperCase() && /[A-Z]/.test(rawText)) casing = 'upper';
      else casing = 'asis';
    }

    if (pctY !== undefined) {
      if (isTopHook) headlineY = clampNum(pctY, 8, 48);
      else subtitleY = clampNum(pctY, 18, 90);
    }
  });

  if (textMaterials.length > 0) {
    summary.push(
      `Typography: ${textMaterials.length} text layer${textMaterials.length === 1 ? '' : 's'} (Hook Y ${headlineY}%, Captions Y ${subtitleY}%)`
    );
  }
  if (extractedFontsSet.size > 0) {
    summary.push(`Fonts: ${Array.from(extractedFontsSet).join(', ')}`);
  }

  // 3) Extract color filters, transitions & speed
  const effectNames: string[] = [];
  for (const key of ['video_effects', 'effects', 'filters', 'adjustments']) {
    const arr = materials[key];
    if (Array.isArray(arr)) {
      for (const item of arr as Array<Record<string, unknown>>) {
        if (typeof item.name === 'string') effectNames.push(item.name);
        if (typeof item.effect_id === 'string') effectNames.push(item.effect_id);
      }
    }
  }
  const colorFilter = inferColorFilterFromKeywords(effectNames);
  if (colorFilter) summary.push(`Color Grade: Mapped to "${colorFilter}" LUT`);

  const transNames: string[] = [];
  if (Array.isArray(materials.transitions)) {
    for (const t of materials.transitions as Array<Record<string, unknown>>) {
      if (typeof t.name === 'string') transNames.push(t.name);
    }
  }
  const transitionStyle = inferTransitionFromKeywords(transNames);
  if (transitionStyle) summary.push(`Transition: Mapped to "${transitionStyle}"`);

  let playbackSpeed: number | undefined;
  if (Array.isArray(materials.speeds) && materials.speeds.length > 0) {
    const spd = Number((materials.speeds[0] as Record<string, unknown>).speed ?? 1);
    if (Number.isFinite(spd) && spd >= 0.25 && spd <= 3 && Math.abs(spd - 1) > 0.04) {
      playbackSpeed = Number(spd.toFixed(2));
      summary.push(`Speed Curve: ${playbackSpeed}×`);
    }
  }

  // Backdrop color from canvas_config or background material
  let outerFill = '#09090B';
  if (typeof canvas.background === 'string') {
    outerFill = normalizeColorHex(canvas.background) || outerFill;
  }

  const rawName =
    (typeof obj.name === 'string' && obj.name.trim()) ||
    (typeof obj.draft_name === 'string' && obj.draft_name.trim()) ||
    cleanTemplateNameFromFilename(fileName);

  if (overlayImage) {
    summary.push(`Overlay Graphic: Attached "${overlayImage.name}"`);
  }
  if (extraFonts.length > 0) {
    summary.push(`Bundled Fonts: ${extraFonts.map((f) => f.family).join(', ')}`);
    if (!extractedFontsSet.size) {
      headlineFont = extraFonts[0].family;
      subtitleFont = extraFonts[0].family;
    }
  }

  if (effectNames.length > 0 && !colorFilter) {
    warnings.push(
      `CapCut shader effects (${effectNames.slice(0, 3).join(', ')}) are proprietary; framing, timing & text styles were imported cleanly.`
    );
  }

  const extractedCaptionStyle =
    textMaterials.length > 0
      ? buildExtractedCaptionStyle(rawName, {
          font: subtitleFont,
          activeColor,
          baseColor,
          strokeWidth,
          casing,
        })
      : undefined;

  const template = createBlankTemplateDraft({
    name: rawName,
    fullName: rawName,
    category: layout === 'split' || layout === 'pip' ? 'Streamer Clips' : 'Viral Hooks',
    description: `Imported from CapCut (${aspect}, ${fullScreen ? 'Full Screen' : layout}${overlayImage ? ' + overlay' : ''}).`,
    defaultAspect: aspect,
    defaultLayout: layout,
    defaultFullScreen: fullScreen,
    defaultHeadlineFont: headlineFont,
    defaultSubtitleFont: subtitleFont,
    defaultHeadlineLayout: headlineLayout,
    defaultSubtitleBg: subtitleBg,
    defaultHeadlineY: headlineY,
    defaultSubtitleY: subtitleY,
    defaultHeadlineSize: headlineSize,
    defaultSubtitleSize: subtitleSize,
    defaultOuterFill: outerFill,
    accentHex: activeColor,
    sourceFormat: 'capcut',
    sourceFormatLabel: 'CapCut',
    overlayImageDataUrl: overlayImage?.dataUrl,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
    defaultColorFilter: colorFilter,
    defaultTransitionStyle: transitionStyle,
    defaultPlaybackSpeed: playbackSpeed,
    defaultSubtitleActiveColor: activeColor,
    defaultSubtitleBaseColor: baseColor,
    defaultSubtitleStrokeWidth: strokeWidth,
    defaultVideoScale: videoScale !== 100 ? videoScale : undefined,
    defaultCaptionStyle: extractedCaptionStyle ? extractedCaptionStyle.id : 'hormozi-classic',
    importSummary: summary,
    importWarnings: warnings,
  });

  return {
    template,
    detectedFormat: 'capcut',
    formatLabel: 'CapCut Project',
    confidence: 'high',
    extractedCaptionStyle,
    extractedFonts: extraFonts,
    summary,
    warnings,
  };
}

/* ---------- 2. Alight Motion XML / .amproj Parser ---------- */

function getXmlAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function isAlightMotionXml(xml: string): boolean {
  return /<scene\b[^>]*\b(width|height|fps|bgcolor)/i.test(xml) || /com\.alightcreative\./i.test(xml);
}

function parseAlightMotionXml(
  xml: string,
  fileName: string,
  extraFonts: ExtractedFontBundle[],
  overlayImage: { dataUrl: string; name: string } | null
): UniversalTemplateImportResult {
  const summary: string[] = [];
  const warnings: string[] = [];

  const sceneTagMatch = xml.match(/<scene\b[^>]*>/i);
  const sceneTag = sceneTagMatch ? sceneTagMatch[0] : '';
  const width = Number(getXmlAttr(sceneTag, 'width') || 1080);
  const height = Number(getXmlAttr(sceneTag, 'height') || 1920);
  const aspect = mapDimensionsToAspectRatio(width, height);
  const titleAttr = getXmlAttr(sceneTag, 'title') || cleanTemplateNameFromFilename(fileName);
  const bgHex = normalizeColorHex(getXmlAttr(sceneTag, 'bgcolor')) || '#09090B';

  summary.push(`Alight Scene: ${width}×${height} → ${aspect}`);
  if (bgHex !== '#09090B') summary.push(`Backdrop Color: ${bgHex}`);

  // Parse <text ...> ... </text> blocks
  const textBlocks = xml.match(/<text\b[\s\S]*?<\/text>/gi) || [];
  let headlineFont = 'Montserrat';
  let subtitleFont = 'Montserrat';
  let headlineY = 18;
  let subtitleY = 68;
  let headlineSize = 22;
  let subtitleSize = 26;
  let activeColor = '#FFE600';
  let baseColor = '#FFFFFF';
  let strokeWidth = 4;
  let casing: TextCasingId = 'upper';
  const fontsFound = new Set<string>();

  textBlocks.forEach((block, idx) => {
    const openTag = block.match(/<text\b[^>]*>/i)?.[0] || '';
    const fontRaw = getXmlAttr(openTag, 'font');
    const fontClean = cleanFontFamilyName(fontRaw);
    const sizeRaw = Number(getXmlAttr(openTag, 'size') || 0);
    const fillRaw = getXmlAttr(openTag, 'fillColor') || getXmlAttr(openTag, 'color');
    const fillHex = normalizeColorHex(fillRaw);

    // Location inside <transform><location value="x,y,z"/></transform>
    const locMatch = block.match(/<location\b[^>]*value\s*=\s*["']([^"']+)["']/i);
    let pctY: number | undefined;
    if (locMatch) {
      const coords = locMatch[1].split(',').map((n) => Number(n.trim()));
      if (coords.length >= 2 && Number.isFinite(coords[1])) {
        // Alight Motion origin is top-left (0..height) in some versions or center (-h/2..h/2)
        const yVal = coords[1];
        const normalizedY = yVal < 0 ? (yVal + height / 2) / height : yVal / height;
        pctY = Math.round(clampNum(normalizedY * 100, 8, 90));
      }
    }

    const isTopHook = pctY !== undefined ? pctY < 42 : idx === 0 && textBlocks.length > 1;
    if (fontClean) {
      fontsFound.add(fontClean);
      if (isTopHook) headlineFont = fontClean;
      else subtitleFont = fontClean;
    }
    if (sizeRaw > 0) {
      const px = Math.round(clampNum(sizeRaw <= 40 ? sizeRaw * 1.15 : sizeRaw * 0.52, 16, 42));
      if (isTopHook) headlineSize = px;
      else subtitleSize = px;
    }
    if (fillHex) {
      if (fillHex !== '#FFFFFF' && fillHex !== '#000000') {
        activeColor = fillHex;
      } else if (!isTopHook) {
        baseColor = fillHex;
      }
    }
    if (/<stroke\b/i.test(block)) {
      const sw = Number(getXmlAttr(block.match(/<stroke\b[^>]*>/i)?.[0] || '', 'size') || 4);
      strokeWidth = Math.round(clampNum(sw, 1, 8));
    }
    const contentMatch = block.match(/<content>([\s\S]*?)<\/content>/i);
    if (contentMatch && contentMatch[1].trim().length >= 4) {
      const txt = contentMatch[1].trim();
      if (txt === txt.toUpperCase() && /[A-Z]/.test(txt)) casing = 'upper';
      else casing = 'asis';
    }
    if (pctY !== undefined) {
      if (isTopHook) headlineY = clampNum(pctY, 8, 48);
      else subtitleY = clampNum(pctY, 18, 90);
    }
  });

  if (textBlocks.length > 0) {
    summary.push(`Text Layers: ${textBlocks.length} parsed (Hook Y ${headlineY}%, Captions Y ${subtitleY}%)`);
  }
  if (fontsFound.size > 0) {
    summary.push(`Fonts: ${Array.from(fontsFound).join(', ')}`);
  }

  // Video / Media layer count for Split vs Solo
  const mediaTags = xml.match(/<(video|media)\b[^>]*>/gi) || [];
  let layout: LayoutModeId = aspect === '16:9' ? 'widescreen' : 'solo';
  if (mediaTags.length >= 2) {
    layout = 'split';
    summary.push(`Layout: Split Screen (${mediaTags.length} media layers detected)`);
  }

  // Alight Motion effects (<effect id="com.alightcreative.effects.*">)
  const effectMatches = Array.from(xml.matchAll(/<effect\b[^>]*id\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1]);
  const colorFilter = inferColorFilterFromKeywords(effectMatches);
  const transitionStyle = inferTransitionFromKeywords(effectMatches);
  if (colorFilter) summary.push(`Color Grade: Mapped from Alight effects → "${colorFilter}"`);
  if (transitionStyle) summary.push(`Transition: Mapped from Alight motion → "${transitionStyle}"`);

  if (extraFonts.length > 0) {
    summary.push(`Bundled Fonts: ${extraFonts.map((f) => f.family).join(', ')}`);
    if (!fontsFound.size) {
      headlineFont = extraFonts[0].family;
      subtitleFont = extraFonts[0].family;
    }
  }
  if (overlayImage) {
    summary.push(`Overlay Graphic: Attached "${overlayImage.name}"`);
  }

  if (effectMatches.length > 0 && !colorFilter && !transitionStyle) {
    warnings.push(
      `Alight Motion keyframe shaders (${effectMatches.slice(0, 3).map((e) => e.split('.').pop()).join(', ')}) were simplified to PulseCut native controls.`
    );
  }

  const extractedCaptionStyle =
    textBlocks.length > 0
      ? buildExtractedCaptionStyle(titleAttr, {
          font: subtitleFont,
          activeColor,
          baseColor,
          strokeWidth,
          casing,
        })
      : undefined;

  const template = createBlankTemplateDraft({
    name: titleAttr,
    fullName: titleAttr,
    category: layout === 'split' ? 'Streamer Clips' : 'Viral Hooks',
    description: `Imported from Alight Motion (${aspect}, ${layout}${overlayImage ? ' + overlay' : ''}).`,
    defaultAspect: aspect,
    defaultLayout: layout,
    defaultFullScreen: false,
    defaultHeadlineFont: headlineFont,
    defaultSubtitleFont: subtitleFont,
    defaultHeadlineY: headlineY,
    defaultSubtitleY: subtitleY,
    defaultHeadlineSize: headlineSize,
    defaultSubtitleSize: subtitleSize,
    defaultOuterFill: bgHex,
    accentHex: activeColor,
    sourceFormat: 'alight-motion',
    sourceFormatLabel: 'Alight Motion',
    overlayImageDataUrl: overlayImage?.dataUrl,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
    defaultColorFilter: colorFilter,
    defaultTransitionStyle: transitionStyle,
    defaultSubtitleActiveColor: activeColor,
    defaultSubtitleBaseColor: baseColor,
    defaultSubtitleStrokeWidth: strokeWidth,
    defaultCaptionStyle: extractedCaptionStyle ? extractedCaptionStyle.id : 'hormozi-classic',
    importSummary: summary,
    importWarnings: warnings,
  });

  return {
    template,
    detectedFormat: 'alight-motion',
    formatLabel: 'Alight Motion XML',
    confidence: 'high',
    extractedCaptionStyle,
    extractedFonts: extraFonts,
    summary,
    warnings,
  };
}

/* ---------- 3. After Effects / Lottie / Canva JSON Parser ---------- */

function isLottieJson(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.w === 'number' &&
    typeof obj.h === 'number' &&
    Array.isArray(obj.layers) &&
    ('v' in obj || 'fr' in obj || 'ip' in obj)
  );
}

function parseLottieJson(
  obj: Record<string, unknown>,
  fileName: string,
  extraFonts: ExtractedFontBundle[],
  overlayImage: { dataUrl: string; name: string } | null
): UniversalTemplateImportResult {
  const summary: string[] = [];
  const warnings: string[] = [];

  const width = Number(obj.w || 1080);
  const height = Number(obj.h || 1920);
  const aspect = mapDimensionsToAspectRatio(width, height);
  summary.push(`Composition: ${width}×${height} → ${aspect}`);

  const layers = (obj.layers as Array<Record<string, unknown>>) || [];
  let outerFill = '#09090B';
  let headlineFont = 'Montserrat';
  let subtitleFont = 'Montserrat';
  let headlineY = 18;
  let subtitleY = 68;
  let activeColor = '#FFE600';
  let baseColor = '#FFFFFF';
  let textCount = 0;

  // Check fonts list in Lottie
  const fontsList = ((obj.fonts as Record<string, unknown> | undefined)?.list || []) as Array<
    Record<string, unknown>
  >;
  if (fontsList.length > 0) {
    const firstFont = cleanFontFamilyName(String(fontsList[0].fFamily || fontsList[0].fName || ''));
    if (firstFont) {
      headlineFont = firstFont;
      subtitleFont = firstFont;
      summary.push(`Fonts: ${fontsList.map((f) => f.fFamily || f.fName).filter(Boolean).slice(0, 3).join(', ')}`);
    }
  }

  for (const layer of layers) {
    const ty = Number(layer.ty);
    // Solid background layer
    if (ty === 1 && typeof layer.sc === 'string') {
      const hex = normalizeColorHex(layer.sc);
      if (hex) outerFill = hex;
    }
    // Text layer (ty === 5)
    if (ty === 5) {
      textCount++;
      const tObj = (layer.t || {}) as Record<string, unknown>;
      const dObj = (tObj.d || {}) as Record<string, unknown>;
      const kArr = Array.isArray(dObj.k) ? (dObj.k as Array<Record<string, unknown>>) : [];
      const sObj = (kArr[0]?.s || {}) as Record<string, unknown>;

      const ksObj = (layer.ks || {}) as Record<string, unknown>;
      const pObj = (ksObj.p || {}) as Record<string, unknown>;
      const pVal = Array.isArray(pObj.k) ? pObj.k : null;
      const yCoord = pVal && typeof pVal[1] === 'number' ? pVal[1] : null;
      const pctY = yCoord !== null ? Math.round(clampNum((yCoord / height) * 100, 8, 90)) : undefined;
      const isTopHook = pctY !== undefined ? pctY < 45 : textCount === 1;

      const fName = cleanFontFamilyName(typeof sObj.f === 'string' ? sObj.f : null);
      if (fName) {
        if (isTopHook) headlineFont = fName;
        else subtitleFont = fName;
      }
      const fcHex = rgbArrayToHex(sObj.fc);
      if (fcHex) {
        if (fcHex !== '#FFFFFF' && fcHex !== '#000000') activeColor = fcHex;
        else if (!isTopHook) baseColor = fcHex;
      }
      if (pctY !== undefined) {
        if (isTopHook) headlineY = clampNum(pctY, 8, 48);
        else subtitleY = clampNum(pctY, 18, 90);
      }
    }
  }

  if (textCount > 0) {
    summary.push(`Text Layers: ${textCount} extracted (Hook Y ${headlineY}%, Captions Y ${subtitleY}%)`);
  }
  if (overlayImage) summary.push(`Overlay Graphic: Attached "${overlayImage.name}"`);

  const name =
    (typeof obj.nm === 'string' && obj.nm.trim()) || cleanTemplateNameFromFilename(fileName);

  const extractedCaptionStyle =
    textCount > 0
      ? buildExtractedCaptionStyle(name, {
          font: subtitleFont,
          activeColor,
          baseColor,
          strokeWidth: 4,
          casing: 'upper',
        })
      : undefined;

  const template = createBlankTemplateDraft({
    name,
    fullName: name,
    category: 'Viral Hooks',
    description: `Imported from After Effects / Lottie (${width}×${height} ${aspect}).`,
    defaultAspect: aspect,
    defaultLayout: aspect === '16:9' ? 'widescreen' : 'solo',
    defaultHeadlineFont: headlineFont,
    defaultSubtitleFont: subtitleFont,
    defaultHeadlineY: headlineY,
    defaultSubtitleY: subtitleY,
    defaultOuterFill: outerFill,
    accentHex: activeColor,
    sourceFormat: 'lottie-ae',
    sourceFormatLabel: 'AE / Lottie',
    overlayImageDataUrl: overlayImage?.dataUrl,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
    defaultSubtitleActiveColor: activeColor,
    defaultSubtitleBaseColor: baseColor,
    defaultCaptionStyle: extractedCaptionStyle ? extractedCaptionStyle.id : 'hormozi-classic',
    importSummary: summary,
    importWarnings: warnings,
  });

  return {
    template,
    detectedFormat: 'lottie-ae',
    formatLabel: 'After Effects / Lottie JSON',
    confidence: 'high',
    extractedCaptionStyle,
    extractedFonts: extraFonts,
    summary,
    warnings,
  };
}

/* ---------- 4. Premiere Pro / DaVinci Resolve / Final Cut XML & MOGRT ---------- */

function isNleXml(xml: string): boolean {
  return /<(fcpxml|xmeml|PremiereData|project)\b/i.test(xml);
}

function parseNleXml(
  xml: string,
  fileName: string,
  sourceFormat: 'fcpxml' | 'premiere-mogrt',
  extraFonts: ExtractedFontBundle[],
  overlayImage: { dataUrl: string; name: string } | null
): UniversalTemplateImportResult {
  const summary: string[] = [];
  const warnings: string[] = [];

  // Dimensions from <format width="1080" height="1920"> or <width>1080</width><height>1920</height>
  let width = 1080;
  let height = 1920;
  const formatTag = xml.match(/<format\b[^>]*>/i)?.[0];
  if (formatTag) {
    const w = Number(getXmlAttr(formatTag, 'width'));
    const h = Number(getXmlAttr(formatTag, 'height'));
    if (w > 0 && h > 0) {
      width = w;
      height = h;
    }
  } else {
    const wEl = xml.match(/<width>(\d+)<\/width>/i);
    const hEl = xml.match(/<height>(\d+)<\/height>/i);
    if (wEl && hEl) {
      width = Number(wEl[1]);
      height = Number(hEl[1]);
    }
  }
  const aspect = mapDimensionsToAspectRatio(width, height);
  summary.push(`Timeline Frame: ${width}×${height} → ${aspect}`);

  const fontMatch = xml.match(/\bfont\s*=\s*["']([^"']+)["']/i) || xml.match(/<fontName>([^<]+)<\/fontName>/i);
  const font = cleanFontFamilyName(fontMatch?.[1]) || extraFonts[0]?.family || 'Montserrat';
  if (fontMatch) summary.push(`Font: ${font}`);

  const colorMatch = xml.match(/\bfontColor\s*=\s*["']([^"']+)["']/i);
  let activeColor = '#FFE600';
  if (colorMatch) {
    const nums = colorMatch[1].trim().split(/\s+/).map(Number);
    const hex = rgbArrayToHex(nums);
    if (hex && hex !== '#FFFFFF' && hex !== '#000000') activeColor = hex;
  }

  const videoTrackMatches = xml.match(/<track\b/gi) || [];
  const layout: LayoutModeId =
    aspect === '16:9' ? 'widescreen' : videoTrackMatches.length >= 2 ? 'split' : 'solo';
  if (layout === 'split') summary.push('Layout: Multi-track split composition');
  if (overlayImage) summary.push(`Overlay Graphic: Attached "${overlayImage.name}"`);

  const titleMatch =
    xml.match(/<project\b[^>]*name\s*=\s*["']([^"']+)["']/i)?.[1] ||
    xml.match(/<sequence\b[^>]*name\s*=\s*["']([^"']+)["']/i)?.[1] ||
    cleanTemplateNameFromFilename(fileName);

  const template = createBlankTemplateDraft({
    name: titleMatch,
    fullName: titleMatch,
    category: layout === 'split' ? 'Streamer Clips' : 'Viral Hooks',
    description: `Imported from ${sourceFormat === 'premiere-mogrt' ? 'Premiere / MOGRT' : 'FCPXML / DaVinci Resolve'} (${width}×${height}).`,
    defaultAspect: aspect,
    defaultLayout: layout,
    defaultHeadlineFont: font,
    defaultSubtitleFont: font,
    accentHex: activeColor,
    defaultSubtitleActiveColor: activeColor,
    sourceFormat,
    sourceFormatLabel: sourceFormat === 'premiere-mogrt' ? 'Premiere / MOGRT' : 'NLE XML',
    overlayImageDataUrl: overlayImage?.dataUrl,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
    importSummary: summary,
    importWarnings: warnings,
  });

  return {
    template,
    detectedFormat: sourceFormat,
    formatLabel: sourceFormat === 'premiere-mogrt' ? 'Premiere Pro / MOGRT' : 'FCPXML / DaVinci XML',
    confidence: 'high',
    extractedFonts: extraFonts,
    summary,
    warnings,
  };
}

/* ---------- 5. ASS / SSA Styled Subtitle Template Parser ---------- */

function isAssScript(text: string): boolean {
  return /\[Script Info\]/i.test(text) && /\[V4\+?\s*Styles\]/i.test(text);
}

function parseAssTemplate(
  text: string,
  fileName: string,
  extraFonts: ExtractedFontBundle[],
  overlayImage: { dataUrl: string; name: string } | null
): UniversalTemplateImportResult {
  const summary: string[] = [];
  const warnings: string[] = [];

  const resX = Number(text.match(/PlayResX:\s*(\d+)/i)?.[1] || 1080);
  const resY = Number(text.match(/PlayResY:\s*(\d+)/i)?.[1] || 1920);
  const aspect = mapDimensionsToAspectRatio(resX, resY);
  summary.push(`PlayRes: ${resX}×${resY} → ${aspect}`);

  const styleLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^Style:/i.test(l));

  let subtitleFont = 'Montserrat';
  let subtitleSize = 26;
  let baseColor = '#FFFFFF';
  let activeColor = '#FFE600';
  let strokeWidth = 4;
  let subtitleY = 72;

  if (styleLines.length > 0) {
    // ASS V4+ Style format:
    // Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,
    // Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle,
    // Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    const parts = styleLines[0].replace(/^Style:\s*/i, '').split(',').map((s) => s.trim());
    if (parts[1]) subtitleFont = cleanFontFamilyName(parts[1]) || parts[1];
    if (parts[2] && Number(parts[2]) > 0) {
      subtitleSize = Math.round(clampNum(Number(parts[2]) * 0.42, 16, 42));
    }
    const primaryHex = parts[3] ? assColorToHex(parts[3]) : null;
    const secondaryHex = parts[4] ? assColorToHex(parts[4]) : null;
    if (primaryHex && primaryHex !== '#FFFFFF' && primaryHex !== '#000000') {
      activeColor = primaryHex;
      if (secondaryHex) baseColor = secondaryHex;
    } else {
      if (primaryHex) baseColor = primaryHex;
      if (secondaryHex && secondaryHex !== '#FFFFFF' && secondaryHex !== '#000000') {
        activeColor = secondaryHex;
      }
    }
    if (parts[16] && Number.isFinite(Number(parts[16]))) {
      strokeWidth = Math.round(clampNum(Number(parts[16]), 0, 8));
    }
    const alignment = Number(parts[18] || 2);
    const marginV = Number(parts[21] || 0);
    if (alignment >= 7) {
      subtitleY = Math.round(clampNum((marginV / resY) * 100 + 12, 18, 45));
    } else if (alignment >= 4) {
      subtitleY = 52;
    } else {
      subtitleY = Math.round(clampNum(100 - (marginV / resY) * 100 - 6, 30, 88));
    }
    summary.push(`ASS Style "${parts[0] || 'Default'}": ${subtitleFont}, size ${subtitleSize}px, Y ${subtitleY}%`);
    summary.push(`Colors: Base ${baseColor} · Active ${activeColor} · Stroke ${strokeWidth}px`);
  }

  const name = cleanTemplateNameFromFilename(fileName);
  const extractedCaptionStyle = buildExtractedCaptionStyle(name, {
    font: subtitleFont,
    activeColor,
    baseColor,
    strokeWidth,
    casing: 'upper',
  });

  const template = createBlankTemplateDraft({
    name,
    fullName: name,
    category: 'Viral Hooks',
    description: `Imported ASS/SSA subtitle style (${subtitleFont}, ${aspect}).`,
    defaultAspect: aspect,
    defaultLayout: aspect === '16:9' ? 'widescreen' : 'solo',
    defaultHeadlineFont: subtitleFont,
    defaultSubtitleFont: subtitleFont,
    defaultSubtitleSize: subtitleSize,
    defaultSubtitleY: subtitleY,
    accentHex: activeColor,
    defaultSubtitleActiveColor: activeColor,
    defaultSubtitleBaseColor: baseColor,
    defaultSubtitleStrokeWidth: strokeWidth,
    defaultCaptionStyle: extractedCaptionStyle.id,
    sourceFormat: 'ass-subtitles',
    sourceFormatLabel: 'ASS Subtitles',
    overlayImageDataUrl: overlayImage?.dataUrl,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
    importSummary: summary,
    importWarnings: warnings,
  });

  return {
    template,
    detectedFormat: 'ass-subtitles',
    formatLabel: 'ASS / SSA Caption Template',
    confidence: 'high',
    extractedCaptionStyle,
    extractedFonts: extraFonts,
    summary,
    warnings,
  };
}

/* ---------- 6. PulseCut Portable JSON & Generic Universal JSON Fallback ---------- */

function isPulseCutPortableJson(obj: Record<string, unknown>): boolean {
  return (
    obj.format === 'pulsecut-template' ||
    ('defaultLayout' in obj && 'defaultCaptionStyle' in obj && 'defaultHeadlineFont' in obj)
  );
}

function parsePulseCutPortableJson(
  obj: Record<string, unknown>,
  fileName: string,
  extraFonts: ExtractedFontBundle[],
  overlayImage: { dataUrl: string; name: string } | null
): UniversalTemplateImportResult {
  const payload =
    obj.template && typeof obj.template === 'object'
      ? (obj.template as Partial<EditableTemplatePreset>)
      : (obj as Partial<EditableTemplatePreset>);

  const rawName = (payload.name || cleanTemplateNameFromFilename(fileName)).trim();
  const draft = createBlankTemplateDraft({
    ...payload,
    id: `imported-pc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: rawName,
    fullName: payload.fullName || rawName,
    isCustom: true,
    sourceFormat: payload.sourceFormat || 'pulsecut',
    sourceFormatLabel: payload.sourceFormatLabel || 'PulseCut JSON',
    overlayImageDataUrl: overlayImage?.dataUrl || payload.overlayImageDataUrl,
    overlayOpacity: payload.overlayOpacity ?? 100,
    overlayBlendMode: payload.overlayBlendMode || 'normal',
  });

  const summary = [
    `Aspect & Layout: ${draft.defaultAspect || '9:16'} · ${draft.defaultFullScreen ? 'Full Screen' : draft.defaultLayout}`,
    `Typography: ${draft.defaultHeadlineFont} / ${draft.defaultSubtitleFont} (Subs Y ${draft.defaultSubtitleY ?? 68}%)`,
  ];
  if (draft.overlayImageDataUrl) summary.push('Overlay Graphic: Embedded frame overlay restored');

  return {
    template: draft,
    detectedFormat: 'pulsecut',
    formatLabel: 'PulseCut Template',
    confidence: 'high',
    extractedFonts: extraFonts,
    summary,
    warnings: [],
  };
}

/** Deeply scans any arbitrary third-party JSON (Canva, VN, InShot, Filmora, Mojo, custom packs). */
function parseGenericUniversalJson(
  obj: Record<string, unknown>,
  fileName: string,
  extraFonts: ExtractedFontBundle[],
  overlayImage: { dataUrl: string; name: string } | null
): UniversalTemplateImportResult {
  const summary: string[] = [];
  const warnings: string[] = [];

  let width = 0;
  let height = 0;
  let aspect: AspectRatioId | null = null;
  let font: string | null = null;
  let accentHex: string | null = null;
  let outerFill: string | null = null;
  let subtitleY: number | null = null;
  let headlineY: number | null = null;
  let fullScreen = false;
  let layout: LayoutModeId | null = null;
  let playbackSpeed: number | undefined;
  let name: string | null = null;
  const keywordBag: string[] = [];

  const visit = (node: unknown, depth: number) => {
    if (depth > 8 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 40); i++) visit(node[i], depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      const kl = k.toLowerCase();
      if (typeof v === 'string') {
        if (!name && (kl === 'name' || kl === 'title' || kl === 'templatename') && v.trim().length > 1) {
          name = v.trim().slice(0, 48);
        }
        if (!aspect && /(aspect|ratio)/.test(kl)) {
          aspect = parseAspectString(v);
        }
        if (!font && /(font|fontfamily|typeface)/.test(kl)) {
          const f = cleanFontFamilyName(v);
          if (f) font = f;
        }
        if (/(bg|background|backdrop|canvascolor|fill)/.test(kl) && !outerFill) {
          const hex = normalizeColorHex(v);
          if (hex) outerFill = hex;
        } else if (/(color|accent|highlight|primary)/.test(kl) && !accentHex) {
          const hex = normalizeColorHex(v);
          if (hex && hex !== '#000000' && hex !== '#FFFFFF') accentHex = hex;
        }
        if (/(layout|mode|template)/.test(kl) && !layout) {
          const vl = v.toLowerCase();
          if (vl.includes('split')) layout = 'split';
          else if (vl.includes('pip') || vl.includes('facecam')) layout = 'pip';
          else if (vl.includes('trio')) layout = 'trio';
          else if (vl.includes('full')) fullScreen = true;
        }
        if (/(filter|lut|effect|transition|grade)/.test(kl)) {
          keywordBag.push(v);
        }
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        if (!width && (kl === 'width' || kl === 'canvaswidth' || kl === 'w') && v >= 100) width = v;
        if (!height && (kl === 'height' || kl === 'canvasheight' || kl === 'h') && v >= 100) height = v;
        if (!subtitleY && /(subtitley|captiony|captionpos)/.test(kl) && v >= 10 && v <= 95) {
          subtitleY = Math.round(v);
        }
        if (!headlineY && /(headliney|titley|hooky)/.test(kl) && v >= 5 && v <= 55) {
          headlineY = Math.round(v);
        }
        if (!playbackSpeed && /(speed|rate|playbackspeed)/.test(kl) && v >= 0.25 && v <= 3 && Math.abs(v - 1) > 0.04) {
          playbackSpeed = Number(v.toFixed(2));
        }
      } else if (typeof v === 'boolean') {
        if (/(fullscreen|fullframe|uncropped)/.test(kl) && v) fullScreen = true;
      } else if (typeof v === 'object' && v !== null) {
        visit(v, depth + 1);
      }
    }
  };

  visit(obj, 0);

  const resolvedAspect =
    aspect || (width > 0 && height > 0 ? mapDimensionsToAspectRatio(width, height) : '9:16');
  const detectedLayout = layout as LayoutModeId | null;
  const resolvedLayout: LayoutModeId =
    detectedLayout || (resolvedAspect === '16:9' ? 'widescreen' : 'solo');
  const colorFilter = inferColorFilterFromKeywords(keywordBag);
  const transitionStyle = inferTransitionFromKeywords(keywordBag);

  summary.push(`Aspect & Layout: ${resolvedAspect} · ${fullScreen ? 'Full Screen' : resolvedLayout}`);
  if (font) summary.push(`Detected Font: ${font}`);
  if (accentHex) summary.push(`Accent / Highlight: ${accentHex}`);
  if (colorFilter) summary.push(`Color Grade: ${colorFilter}`);
  if (transitionStyle) summary.push(`Transition: ${transitionStyle}`);
  if (overlayImage) summary.push(`Overlay Graphic: Attached "${overlayImage.name}"`);

  warnings.push(
    'Imported via Universal JSON mapper — review framing, overlay, and caption positions in the preview or fine-tune in Template Editor.'
  );

  const finalName = name || cleanTemplateNameFromFilename(fileName);
  const template = createBlankTemplateDraft({
    name: finalName,
    fullName: finalName,
    category: resolvedLayout === 'split' || resolvedLayout === 'pip' ? 'Streamer Clips' : 'Viral Hooks',
    description: `Universal JSON import (${resolvedAspect}, ${resolvedLayout}).`,
    defaultAspect: resolvedAspect,
    defaultLayout: resolvedLayout,
    defaultFullScreen: fullScreen,
    defaultHeadlineFont: font || extraFonts[0]?.family || 'Montserrat',
    defaultSubtitleFont: font || extraFonts[0]?.family || 'Montserrat',
    defaultHeadlineY: headlineY ?? 18,
    defaultSubtitleY: subtitleY ?? 68,
    defaultOuterFill: outerFill || '#09090B',
    accentHex: accentHex || '#FFE600',
    defaultSubtitleActiveColor: accentHex || undefined,
    defaultColorFilter: colorFilter,
    defaultTransitionStyle: transitionStyle,
    defaultPlaybackSpeed: playbackSpeed,
    sourceFormat: 'generic-json',
    sourceFormatLabel: 'Universal JSON',
    overlayImageDataUrl: overlayImage?.dataUrl,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
    importSummary: summary,
    importWarnings: warnings,
  });

  return {
    template,
    detectedFormat: 'generic-json',
    formatLabel: 'Universal JSON Template',
    confidence: 'fallback',
    extractedFonts: extraFonts,
    summary,
    warnings,
  };
}

/* ---------- 7. Visual Frame / Graphic Overlay Template (.png / .webp / .svg) ---------- */

function buildImageOverlayTemplate(
  overlay: { file: ImportFileInput; dataUrl: string; dimensions: { width: number; height: number } | null },
  extraFonts: ExtractedFontBundle[]
): UniversalTemplateImportResult {
  const aspect = overlay.dimensions
    ? mapDimensionsToAspectRatio(overlay.dimensions.width, overlay.dimensions.height)
    : '9:16';
  const name = cleanTemplateNameFromFilename(overlay.file.name);
  const summary: string[] = [
    overlay.dimensions
      ? `Overlay Graphic: ${overlay.dimensions.width}×${overlay.dimensions.height} → ${aspect}`
      : `Overlay Graphic: ${overlay.file.name} (${aspect})`,
    'Pinned full-frame over your video with adjustable opacity & blend mode',
  ];
  if (extraFonts.length > 0) {
    summary.push(`Bundled Fonts: ${extraFonts.map((f) => f.family).join(', ')}`);
  }

  const template = createBlankTemplateDraft({
    name,
    fullName: name,
    category: 'Viral Hooks',
    description: `Visual frame overlay template imported from ${overlay.file.name}.`,
    defaultAspect: aspect,
    defaultLayout: aspect === '16:9' ? 'widescreen' : 'solo',
    defaultFullScreen: false,
    defaultHeadlineFont: extraFonts[0]?.family || 'Montserrat',
    defaultSubtitleFont: extraFonts[0]?.family || 'Montserrat',
    defaultHeadlineLayout: 'none',
    sourceFormat: 'image-overlay',
    sourceFormatLabel: 'Overlay Frame',
    overlayImageDataUrl: overlay.dataUrl,
    overlayOpacity: 100,
    overlayBlendMode: 'normal',
    importSummary: summary,
    importWarnings: [],
  });

  return {
    template,
    detectedFormat: 'image-overlay',
    formatLabel: 'Visual Frame Overlay',
    confidence: 'high',
    extractedFonts: extraFonts,
    summary,
    warnings: [],
  };
}

/* ---------- Archive Expansion (.zip / .amproj / .mogrt / .ccut / .prproj) ---------- */

function expandArchiveFiles(files: ImportFileInput[]): {
  expanded: ImportFileInput[];
  archiveHint: 'amproj' | 'mogrt' | 'ccut' | 'prproj' | 'zip' | null;
  archiveName: string | null;
} {
  const expanded: ImportFileInput[] = [];
  let archiveHint: 'amproj' | 'mogrt' | 'ccut' | 'prproj' | 'zip' | null = null;
  let archiveName: string | null = null;

  for (const file of files) {
    const lower = file.name.toLowerCase();

    if (lower.endsWith('.prproj') && isGzipBytes(file.bytes)) {
      archiveHint = 'prproj';
      archiveName = file.name;
      const inflated = gunzipSync(file.bytes);
      expanded.push({ name: file.name.replace(/\.prproj$/i, '.xml'), bytes: inflated });
      continue;
    }

    if (
      isZipBytes(file.bytes) ||
      lower.endsWith('.zip') ||
      lower.endsWith('.amproj') ||
      lower.endsWith('.mogrt') ||
      lower.endsWith('.ccut')
    ) {
      if (lower.endsWith('.amproj')) archiveHint = 'amproj';
      else if (lower.endsWith('.mogrt')) archiveHint = 'mogrt';
      else if (lower.endsWith('.ccut')) archiveHint = 'ccut';
      else if (!archiveHint) archiveHint = 'zip';
      archiveName = archiveName || file.name;

      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(file.bytes);
      } catch {
        throw new Error(`Could not extract archive "${file.name}" — file may be encrypted or corrupted.`);
      }

      let totalBytes = 0;
      for (const [entryPath, entryBytes] of Object.entries(entries)) {
        if (!entryBytes || entryBytes.byteLength === 0) continue;
        if (entryPath.includes('__MACOSX/') || entryPath.endsWith('/')) continue;
        totalBytes += entryBytes.byteLength;
        if (totalBytes > MAX_DECOMPRESSED_BYTES) {
          throw new Error('Template archive exceeds the 40 MB safety limit.');
        }
        expanded.push({ name: entryPath, bytes: entryBytes });
      }
      continue;
    }

    expanded.push(file);
  }

  return { expanded, archiveHint, archiveName };
}

/* ---------- Public Entry Points ---------- */

/**
 * Parses one or more uploaded template files (CapCut JSON/ZIP, Alight Motion XML/AMPROJ,
 * Lottie/AE JSON, Premiere/DaVinci FCPXML/MOGRT/PRPROJ, ASS/SSA, PNG/WebP/SVG frame overlays,
 * or PulseCut JSON) into a live EditableTemplatePreset.
 */
export function parseUniversalTemplateFiles(files: ImportFileInput[]): UniversalTemplateImportResult {
  if (!files.length) {
    throw new Error('Select at least one template file to import.');
  }

  const { expanded, archiveHint, archiveName } = expandArchiveFiles(files);
  const displayNameSource = archiveName || files[0].name;

  // Separate extracted fonts, overlay images, and structured template definitions
  const extractedFonts: ExtractedFontBundle[] = [];
  const imageFiles: ImportFileInput[] = [];
  const jsonFiles: ImportFileInput[] = [];
  const xmlFiles: ImportFileInput[] = [];
  const assFiles: ImportFileInput[] = [];

  for (const item of expanded) {
    const lower = item.name.toLowerCase();
    if (isFontFilename(lower)) {
      const family = cleanFontFamilyName(item.name);
      if (family) {
        extractedFonts.push({
          fileName: item.name.split(/[\\/]/).pop() || item.name,
          family,
          bytes: item.bytes,
        });
      }
    } else if (isImageFilename(lower) || item.mimeType?.startsWith('image/')) {
      imageFiles.push(item);
    } else if (lower.endsWith('.json') || item.mimeType === 'application/json') {
      jsonFiles.push(item);
    } else if (lower.endsWith('.xml') || lower.endsWith('.fcpxml') || item.mimeType?.includes('xml')) {
      xmlFiles.push(item);
    } else if (lower.endsWith('.ass') || lower.endsWith('.ssa')) {
      assFiles.push(item);
    } else {
      // Sniff raw content for extensionless files
      const snippet = decodeUtf8(item.bytes.subarray(0, 512)).trim();
      if (snippet.startsWith('{')) jsonFiles.push(item);
      else if (snippet.startsWith('<svg')) imageFiles.push({ ...item, mimeType: 'image/svg+xml' });
      else if (snippet.startsWith('<')) xmlFiles.push(item);
      else if (/\[Script Info\]/i.test(snippet)) assFiles.push(item);
    }
  }

  const bestOverlay = pickBestOverlayFromImages(imageFiles);
  const overlayRef = bestOverlay
    ? { dataUrl: bestOverlay.dataUrl, name: bestOverlay.file.name.split(/[\\/]/).pop() || bestOverlay.file.name }
    : null;

  // Priority 1: JSON-based templates (CapCut draft_content.json, PulseCut JSON, Lottie, MOGRT definition.json, Generic JSON)
  if (jsonFiles.length > 0) {
    // Prefer draft_content.json / template.json / definition.json
    const sortedJson = [...jsonFiles].sort((a, b) => {
      const rank = (n: string) => {
        const l = n.toLowerCase();
        if (l.includes('draft_content') || l.includes('draft_info')) return 100;
        if (l.includes('pulsecut')) return 95;
        if (l.includes('definition.json')) return 90;
        if (l.includes('template')) return 80;
        return 50;
      };
      return rank(b.name) - rank(a.name);
    });

    for (const jf of sortedJson) {
      const text = decodeUtf8(jf.bytes).trim();
      try {
        const parsed = JSON.parse(text) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const obj = parsed as Record<string, unknown>;
        const targetName = archiveName || jf.name;

        if (isPulseCutPortableJson(obj)) {
          return parsePulseCutPortableJson(obj, targetName, extractedFonts, overlayRef);
        }
        if (isCapCutJson(obj) || archiveHint === 'ccut') {
          return parseCapCutJson(obj, targetName, extractedFonts, overlayRef);
        }
        if (isLottieJson(obj)) {
          return parseLottieJson(obj, targetName, extractedFonts, overlayRef);
        }
        if (archiveHint === 'mogrt') {
          const mogrtRes = parseGenericUniversalJson(obj, targetName, extractedFonts, overlayRef);
          mogrtRes.detectedFormat = 'premiere-mogrt';
          mogrtRes.formatLabel = 'Premiere Pro MOGRT';
          mogrtRes.confidence = 'medium';
          mogrtRes.template.sourceFormat = 'premiere-mogrt';
          mogrtRes.template.sourceFormatLabel = 'MOGRT';
          return mogrtRes;
        }
        return parseGenericUniversalJson(obj, targetName, extractedFonts, overlayRef);
      } catch {
        // Try next JSON file if present
      }
    }
  }

  // Priority 2: XML-based templates (Alight Motion .xml/.amproj, FCPXML, Premiere/DaVinci XML)
  if (xmlFiles.length > 0) {
    const primaryXml = xmlFiles[0];
    const xmlText = decodeUtf8(primaryXml.bytes);
    const targetName = archiveName || primaryXml.name;

    if (isAlightMotionXml(xmlText) || archiveHint === 'amproj') {
      return parseAlightMotionXml(xmlText, targetName, extractedFonts, overlayRef);
    }
    if (isNleXml(xmlText) || archiveHint === 'prproj' || archiveHint === 'mogrt') {
      const fmt = archiveHint === 'prproj' || archiveHint === 'mogrt' ? 'premiere-mogrt' : 'fcpxml';
      return parseNleXml(xmlText, targetName, fmt, extractedFonts, overlayRef);
    }
    // Generic XML fallback via NLE XML parser
    const genericXml = parseNleXml(xmlText, targetName, 'fcpxml', extractedFonts, overlayRef);
    genericXml.confidence = 'fallback';
    genericXml.warnings.push('Unrecognized XML dialect — extracted dimensions, fonts, and overlays using universal XML mapping.');
    return genericXml;
  }

  // Priority 3: ASS / SSA Styled Subtitle Templates
  if (assFiles.length > 0) {
    const assText = decodeUtf8(assFiles[0].bytes);
    return parseAssTemplate(assText, displayNameSource, extractedFonts, overlayRef);
  }

  // Priority 4: Pure visual frame / overlay graphic (.png, .webp, .svg, .jpg)
  if (bestOverlay) {
    return buildImageOverlayTemplate(bestOverlay, extractedFonts);
  }

  throw new Error(
    `Could not recognize a template inside "${displayNameSource}". Supported formats: CapCut (.json/.zip/.ccut), Alight Motion (.xml/.amproj), After Effects/Lottie (.json), Premiere/DaVinci (.mogrt/.fcpxml/.prproj), ASS/SSA captions, or PNG/WebP/SVG frame overlays.`
  );
}

/** Parses pasted raw text (CapCut JSON, Alight Motion XML, Lottie JSON, ASS script, SVG, or PulseCut JSON). */
export function parseUniversalTemplateText(rawText: string, nameHint = 'Pasted Template'): UniversalTemplateImportResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('Paste CapCut JSON, Alight Motion XML, Lottie JSON, ASS style, SVG, or PulseCut JSON first.');
  }
  const bytes = new TextEncoder().encode(trimmed);
  let virtualName = `${nameHint}.json`;
  if (trimmed.startsWith('<svg')) virtualName = `${nameHint}.svg`;
  else if (trimmed.startsWith('<')) virtualName = `${nameHint}.xml`;
  else if (isAssScript(trimmed)) virtualName = `${nameHint}.ass`;
  return parseUniversalTemplateFiles([{ name: virtualName, bytes }]);
}

/** Exports any PulseCut template as a portable `.pulsecut.json` file that can be shared & re-imported. */
export function exportTemplateToPortableJson(template: EditableTemplatePreset): string {
  const payload = {
    format: 'pulsecut-template',
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      ...template,
      isCustom: true,
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function getOverlayBlendModeLabel(mode: TemplateOverlayBlendMode | undefined): string {
  switch (mode) {
    case 'screen':
      return 'Screen (Lighten Black)';
    case 'multiply':
      return 'Multiply';
    case 'overlay':
      return 'Overlay';
    case 'lighten':
      return 'Lighten';
    default:
      return 'Normal';
  }
}
