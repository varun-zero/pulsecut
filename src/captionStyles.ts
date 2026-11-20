import type {
  BrandKit,
  CaptionAnimationId,
  CaptionStyleId,
  CustomFontEntry,
  EditorSettings,
  FontCategoryId,
  ResolvedSafeZonePlatformId,
  SafeZonePlatformId,
  TextCasingId,
  ViralCaptionPresetId,
  WordCue,
  WordPacingId,
} from './types';

/* -------------------------------------------------------------------------- */
/* 1. Curated Viral Creator Font Library                                       */
/* -------------------------------------------------------------------------- */

export interface ViralFontDefinition {
  id: string;
  family: string;
  cssFamily: string;
  /** Filename for backend FFmpeg / libass `.ttf` parity */
  ttfFile: string;
  category: Exclude<FontCategoryId, 'Custom'>;
  defaultWeight: number;
  italic?: boolean;
  sampleNote: string;
}

export const VIRAL_FONTS: readonly ViralFontDefinition[] = [
  {
    id: 'tiktok-sans',
    family: 'TikTok Sans',
    cssFamily: '"TikTok Sans", "Plus Jakarta Sans", sans-serif',
    ttfFile: 'TikTokSans-Bold.ttf',
    category: 'Social',
    defaultWeight: 700,
    sampleNote: 'Native viral social UI',
  },
  {
    id: 'montserrat',
    family: 'Montserrat',
    cssFamily: '"Montserrat", sans-serif',
    ttfFile: 'Montserrat-Black.ttf',
    category: 'Viral',
    defaultWeight: 900,
    sampleNote: 'Hormozi & authority hooks',
  },
  {
    id: 'anton',
    family: 'Anton',
    cssFamily: '"Anton", sans-serif',
    ttfFile: 'Anton-Regular.ttf',
    category: 'Hook',
    defaultWeight: 400,
    sampleNote: 'Tall condensed 1-word punch',
  },
  {
    id: 'bangers',
    family: 'Bangers',
    cssFamily: '"Bangers", cursive',
    ttfFile: 'Bangers-Regular.ttf',
    category: 'Comic',
    defaultWeight: 400,
    sampleNote: 'Comic challenge & reaction',
  },
  {
    id: 'luckiest-guy',
    family: 'Luckiest Guy',
    cssFamily: '"Luckiest Guy", cursive',
    ttfFile: 'LuckiestGuy-Regular.ttf',
    category: 'Comic',
    defaultWeight: 400,
    sampleNote: 'Playful bold display',
  },
  {
    id: 'bebas-neue',
    family: 'Bebas Neue',
    cssFamily: '"Bebas Neue", sans-serif',
    ttfFile: 'BebasNeue-Regular.ttf',
    category: 'Hook',
    defaultWeight: 400,
    sampleNote: 'Clean bold title banners',
  },
  {
    id: 'archivo-black',
    family: 'Archivo Black',
    cssFamily: '"Archivo Black", sans-serif',
    ttfFile: 'ArchivoBlack-Regular.ttf',
    category: 'Viral',
    defaultWeight: 400,
    sampleNote: 'Heavy Kick / gaming hype',
  },
  {
    id: 'rubik',
    family: 'Rubik',
    cssFamily: '"Rubik", sans-serif',
    ttfFile: 'Rubik-ExtraBold.ttf',
    category: 'Viral',
    defaultWeight: 800,
    sampleNote: 'Rounded punchy captions',
  },
  {
    id: 'poppins',
    family: 'Poppins',
    cssFamily: '"Poppins", sans-serif',
    ttfFile: 'Poppins-Bold.ttf',
    category: 'Social',
    defaultWeight: 700,
    sampleNote: 'Clean Reels & podcast pills',
  },
  {
    id: 'oswald',
    family: 'Oswald',
    cssFamily: '"Oswald", sans-serif',
    ttfFile: 'Oswald-BoldItalic.ttf',
    category: 'Hook',
    defaultWeight: 700,
    italic: true,
    sampleNote: 'Breaking news commentary',
  },
  {
    id: 'instrument-serif',
    family: 'Instrument Serif',
    cssFamily: '"Instrument Serif", Georgia, serif',
    ttfFile: 'InstrumentSerif-Italic.ttf',
    category: 'Editorial',
    defaultWeight: 400,
    italic: true,
    sampleNote: 'Luxury & editorial hooks',
  },
  {
    id: 'permanent-marker',
    family: 'Permanent Marker',
    cssFamily: '"Permanent Marker", cursive',
    ttfFile: 'PermanentMarker-Regular.ttf',
    category: 'Comic',
    defaultWeight: 400,
    sampleNote: 'Handwritten storytelling',
  },
  {
    id: 'kanit',
    family: 'Kanit',
    cssFamily: '"Kanit", sans-serif',
    ttfFile: 'Kanit-Bold.ttf',
    category: 'Social',
    defaultWeight: 700,
    sampleNote: 'Modern social captions',
  },
  {
    id: 'lilita-one',
    family: 'Lilita One',
    cssFamily: '"Lilita One", cursive',
    ttfFile: 'LilitaOne-Regular.ttf',
    category: 'Comic',
    defaultWeight: 400,
    sampleNote: 'Thick bubbly Shorts captions',
  },
  {
    id: 'titan-one',
    family: 'Titan One',
    cssFamily: '"Titan One", cursive',
    ttfFile: 'TitanOne-Regular.ttf',
    category: 'Comic',
    defaultWeight: 400,
    sampleNote: 'Ultra-bold reaction text',
  },
  {
    id: 'russo-one',
    family: 'Russo One',
    cssFamily: '"Russo One", sans-serif',
    ttfFile: 'RussoOne-Regular.ttf',
    category: 'Viral',
    defaultWeight: 400,
    sampleNote: 'Gaming & esports highlights',
  },
  {
    id: 'barlow-condensed',
    family: 'Barlow Condensed',
    cssFamily: '"Barlow Condensed", sans-serif',
    ttfFile: 'BarlowCondensed-ExtraBold.ttf',
    category: 'Hook',
    defaultWeight: 800,
    sampleNote: 'Tall documentary hooks',
  },
  {
    id: 'syne',
    family: 'Syne',
    cssFamily: '"Syne", sans-serif',
    ttfFile: 'Syne-ExtraBold.ttf',
    category: 'Editorial',
    defaultWeight: 800,
    sampleNote: 'Wide creative studio title',
  },
  {
    id: 'bricolage-grotesque',
    family: 'Bricolage Grotesque',
    cssFamily: '"Bricolage Grotesque", sans-serif',
    ttfFile: 'BricolageGrotesque-ExtraBold.ttf',
    category: 'Social',
    defaultWeight: 800,
    sampleNote: 'Trendy 2026 creator sans',
  },
  {
    id: 'chakra-petch',
    family: 'Chakra Petch',
    cssFamily: '"Chakra Petch", sans-serif',
    ttfFile: 'ChakraPetch-Bold.ttf',
    category: 'Viral',
    defaultWeight: 700,
    sampleNote: 'Tech, AI & sci-fi clips',
  },
  {
    id: 'righteous',
    family: 'Righteous',
    cssFamily: '"Righteous", cursive',
    ttfFile: 'Righteous-Regular.ttf',
    category: 'Hook',
    defaultWeight: 400,
    sampleNote: 'Retro bold podcast title',
  },
  {
    id: 'playfair-display',
    family: 'Playfair Display',
    cssFamily: '"Playfair Display", Georgia, serif',
    ttfFile: 'PlayfairDisplay-BoldItalic.ttf',
    category: 'Editorial',
    defaultWeight: 700,
    italic: true,
    sampleNote: 'Luxury & quote reels',
  },
  {
    id: 'space-mono',
    family: 'Space Mono',
    cssFamily: '"Space Mono", monospace',
    ttfFile: 'SpaceMono-Bold.ttf',
    category: 'Editorial',
    defaultWeight: 700,
    sampleNote: 'Code, finance & facts',
  },
] as const;

export function getViralFont(family: string, customFonts: readonly CustomFontEntry[] = []): {
  family: string;
  cssFamily: string;
  ttfFile: string;
  category: FontCategoryId;
  defaultWeight: number;
  italic: boolean;
} {
  const custom = customFonts.find((c) => c.family === family);
  if (custom) {
    return {
      family: custom.family,
      cssFamily: `"${custom.family}", sans-serif`,
      ttfFile: custom.fileName,
      category: 'Custom',
      defaultWeight: 800,
      italic: false,
    };
  }
  const found = VIRAL_FONTS.find((f) => f.family.toLowerCase() === family.toLowerCase());
  if (found) {
    return {
      family: found.family,
      cssFamily: found.cssFamily,
      ttfFile: found.ttfFile,
      category: found.category,
      defaultWeight: found.defaultWeight,
      italic: Boolean(found.italic),
    };
  }
  return {
    family: family || 'Montserrat',
    cssFamily: `"${family || 'Montserrat'}", sans-serif`,
    ttfFile: 'Montserrat-Black.ttf',
    category: 'Viral',
    defaultWeight: 800,
    italic: false,
  };
}

/**
 * Registers a user-uploaded local `.ttf` or `.otf` font file via the browser FontFace API
 * so creators can load The Bold Font, Komika Axis, Burbank, or custom brand fonts live.
 */
export async function registerCustomFontFile(file: File): Promise<CustomFontEntry> {
  const cleanName = file.name
    .replace(/\.(ttf|otf|woff2?)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Custom Brand Font';

  if (typeof window !== 'undefined' && 'FontFace' in window) {
    const buffer = await file.arrayBuffer();
    const face = new FontFace(cleanName, buffer);
    const loaded = await face.load();
    document.fonts.add(loaded);
  }

  return {
    id: `custom-${Date.now()}-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    family: cleanName,
    fileName: file.name,
    category: 'Custom',
  };
}

/**
 * Dynamically injects a Google Font stylesheet by family name so creators can add
 * any Google Font on demand inside the app.
 */
export function registerGoogleFontByName(familyName: string): CustomFontEntry {
  const clean = familyName.trim();
  if (typeof document !== 'undefined' && clean) {
    const encoded = encodeURIComponent(clean).replace(/%20/g, '+');
    const id = `pc-gfont-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@600;700;800;900&display=swap`;
      document.head.appendChild(link);
    }
  }
  return {
    id: `gfont-${Date.now()}-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    family: clean,
    fileName: `${clean.replace(/\s+/g, '')}-Bold.ttf`,
    category: 'Custom',
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Seven One-Click Viral Short-Form Caption Style Presets                   */
/* -------------------------------------------------------------------------- */

export interface ViralCaptionPreset {
  id: ViralCaptionPresetId;
  name: string;
  tagline: string;
  headlineFont: string;
  subtitleFont: string;
  subtitleWeight: number;
  subtitleItalic?: boolean;
  casing: TextCasingId;
  wordsPerScreen: WordPacingId;
  baseColor: string;
  activeColor: string;
  emphasisColor: string;
  strokeWidth: number;
  strokeColor: string;
  dropShadow: boolean;
  neonGlow: boolean;
  animation: CaptionAnimationId;
  /** Visual styling variant for pill/ticker/text treatments */
  surfaceTreatment: 'outline' | 'pill' | 'clean' | 'ticker';
  sampleWords: [string, string];
}

export const VIRAL_CAPTION_PRESETS: readonly ViralCaptionPreset[] = [
  {
    id: 'hormozi-classic',
    name: 'Hormozi Classic',
    tagline: 'Montserrat Black · Bold Yellow Subs',
    headlineFont: 'Montserrat',
    subtitleFont: 'Montserrat',
    subtitleWeight: 900,
    casing: 'upper',
    wordsPerScreen: '2-3',
    baseColor: '#FFE600',
    activeColor: '#FFF380',
    emphasisColor: '#FFFFFF',
    strokeWidth: 5,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'pop-scale',
    surfaceTreatment: 'outline',
    sampleWords: ['STOP', 'SCROLLING'],
  },
  {
    id: 'beast-comic',
    name: 'Beast Comic',
    tagline: 'Bangers · 6px Heavy Outline',
    headlineFont: 'Bangers',
    subtitleFont: 'Bangers',
    subtitleWeight: 400,
    casing: 'upper',
    wordsPerScreen: '2-3',
    baseColor: '#FFFFFF',
    activeColor: '#FFE600',
    emphasisColor: '#EF4444',
    strokeWidth: 6,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'pop-scale',
    surfaceTreatment: 'outline',
    sampleWords: ['INSANE', 'CLUTCH!'],
  },
  {
    id: 'kick-neon',
    name: 'Kick Neon',
    tagline: 'Archivo Black · #53FC18 Glow',
    headlineFont: 'Archivo Black',
    subtitleFont: 'Archivo Black',
    subtitleWeight: 400,
    casing: 'upper',
    wordsPerScreen: '2-3',
    baseColor: '#FFFFFF',
    activeColor: '#53FC18',
    emphasisColor: '#53FC18',
    strokeWidth: 4,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: true,
    animation: 'karaoke-fill',
    surfaceTreatment: 'outline',
    sampleWords: ['KICK', 'LIVE'],
  },
  {
    id: 'one-word-punch',
    name: 'One-Word Punch',
    tagline: 'Anton · Rapid 1-Word Cadence',
    headlineFont: 'Anton',
    subtitleFont: 'Anton',
    subtitleWeight: 400,
    casing: 'upper',
    wordsPerScreen: '1',
    baseColor: '#FFFFFF',
    activeColor: '#FFE600',
    emphasisColor: '#EF4444',
    strokeWidth: 5,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'pop-scale',
    surfaceTreatment: 'outline',
    sampleWords: ['WAIT', 'WHAT?!'],
  },
  {
    id: 'podcast-pill',
    name: 'Podcast Pill',
    tagline: 'TikTok Sans · Active Pill Box',
    headlineFont: 'Poppins',
    subtitleFont: 'TikTok Sans',
    subtitleWeight: 700,
    casing: 'asis',
    wordsPerScreen: '4-5',
    baseColor: '#FFFFFF',
    activeColor: '#2563EB',
    emphasisColor: '#FFE600',
    strokeWidth: 0,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'box-highlight',
    surfaceTreatment: 'pill',
    sampleWords: ['exact', 'routing'],
  },
  {
    id: 'editorial-aesthetic',
    name: 'Editorial Aesthetic',
    tagline: 'Instrument Serif + Poppins',
    headlineFont: 'Instrument Serif',
    subtitleFont: 'Poppins',
    subtitleWeight: 600,
    casing: 'asis',
    wordsPerScreen: '4-5',
    baseColor: '#FAFAFA',
    activeColor: '#FDE68A',
    emphasisColor: '#FFFFFF',
    strokeWidth: 0,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'slide-up',
    surfaceTreatment: 'clean',
    sampleWords: ['quiet', 'craft'],
  },
  {
    id: 'breaking-news',
    name: 'Breaking News',
    tagline: 'Oswald Italic · Ticker Accent',
    headlineFont: 'Oswald',
    subtitleFont: 'Oswald',
    subtitleWeight: 700,
    subtitleItalic: true,
    casing: 'upper',
    wordsPerScreen: '4-5',
    baseColor: '#FFFFFF',
    activeColor: '#FFE600',
    emphasisColor: '#EF4444',
    strokeWidth: 2,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'karaoke-fill',
    surfaceTreatment: 'ticker',
    sampleWords: ['BREAKING', 'NOW'],
  },
  {
    id: 'cyan-glow-pop',
    name: 'Cyan Tech Pop',
    tagline: 'Chakra Petch · Electric Cyan',
    headlineFont: 'Chakra Petch',
    subtitleFont: 'Chakra Petch',
    subtitleWeight: 700,
    casing: 'upper',
    wordsPerScreen: '2-3',
    baseColor: '#FFFFFF',
    activeColor: '#38BDF8',
    emphasisColor: '#22D3EE',
    strokeWidth: 4,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: true,
    animation: 'pop-scale',
    surfaceTreatment: 'outline',
    sampleWords: ['NEXT', 'LEVEL'],
  },
  {
    id: 'yellow-box-slam',
    name: 'Yellow Box Slam',
    tagline: 'Lilita One · High-Contrast Gold',
    headlineFont: 'Lilita One',
    subtitleFont: 'Lilita One',
    subtitleWeight: 400,
    casing: 'upper',
    wordsPerScreen: '2-3',
    baseColor: '#FFFFFF',
    activeColor: '#FACC15',
    emphasisColor: '#4ADE80',
    strokeWidth: 5,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'box-highlight',
    surfaceTreatment: 'pill',
    sampleWords: ['WATCH', 'THIS'],
  },
  {
    id: 'crimson-rage',
    name: 'Crimson Rage',
    tagline: 'Russo One · Red Alert Impact',
    headlineFont: 'Russo One',
    subtitleFont: 'Russo One',
    subtitleWeight: 400,
    casing: 'upper',
    wordsPerScreen: '1',
    baseColor: '#FFFFFF',
    activeColor: '#EF4444',
    emphasisColor: '#FFE600',
    strokeWidth: 5,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: true,
    animation: 'pop-scale',
    surfaceTreatment: 'outline',
    sampleWords: ['NO', 'WAY!'],
  },
  {
    id: 'minimal-clean',
    name: 'Minimal Clean',
    tagline: 'Bricolage · Clean White Shadow',
    headlineFont: 'Bricolage Grotesque',
    subtitleFont: 'Bricolage Grotesque',
    subtitleWeight: 800,
    casing: 'asis',
    wordsPerScreen: '4-5',
    baseColor: '#FFFFFF',
    activeColor: '#FDE047',
    emphasisColor: '#FFFFFF',
    strokeWidth: 2,
    strokeColor: '#09090B',
    dropShadow: true,
    neonGlow: false,
    animation: 'slide-up',
    surfaceTreatment: 'clean',
    sampleWords: ['simple', 'clean'],
  },
  {
    id: 'subway-punch',
    name: 'Subway Punch',
    tagline: 'Titan One · Storytime Bold',
    headlineFont: 'Titan One',
    subtitleFont: 'Titan One',
    subtitleWeight: 400,
    casing: 'upper',
    wordsPerScreen: '1',
    baseColor: '#FFFFFF',
    activeColor: '#A3E635',
    emphasisColor: '#F97316',
    strokeWidth: 6,
    strokeColor: '#000000',
    dropShadow: true,
    neonGlow: false,
    animation: 'pop-scale',
    surfaceTreatment: 'outline',
    sampleWords: ['STORY', 'TIME'],
  },
] as const;

export function normalizeCaptionPresetId(id: CaptionStyleId | string | undefined): ViralCaptionPresetId {
  if (id && id.startsWith('custom-cap-')) return id;
  switch (id) {
    case 'hormozi-classic':
    case 'beast-comic':
    case 'kick-neon':
    case 'one-word-punch':
    case 'podcast-pill':
    case 'editorial-aesthetic':
    case 'breaking-news':
    case 'cyan-glow-pop':
    case 'yellow-box-slam':
    case 'crimson-rage':
    case 'minimal-clean':
    case 'subway-punch':
      return id;
    case 'bold':
    case 'karaoke_yellow':
    case 'karaoke_bold':
    case 'default':
      return 'hormozi-classic';
    case 'box':
      return 'editorial-aesthetic';
    case 'accent':
      return 'one-word-punch';
    case 'karaoke':
    default:
      return 'podcast-pill';
  }
}

export function getViralCaptionPreset(
  id: CaptionStyleId | string | undefined,
  extraPresets: readonly ViralCaptionPreset[] = []
): ViralCaptionPreset {
  if (id) {
    const customMatch = extraPresets.find((p) => p.id === id);
    if (customMatch) return customMatch;
  }
  const normalized = normalizeCaptionPresetId(id);
  return (
    extraPresets.find((p) => p.id === normalized) ??
    VIRAL_CAPTION_PRESETS.find((p) => p.id === normalized) ??
    VIRAL_CAPTION_PRESETS[0]
  );
}

export const WORD_PACING_OPTIONS: readonly { id: WordPacingId; label: string; maxWords: number }[] = [
  { id: '1', label: '1 Word', maxWords: 1 },
  { id: '2-3', label: '2–3 Words', maxWords: 3 },
  { id: '4-5', label: '4–5 Words', maxWords: 5 },
];

export const CAPTION_ANIMATION_OPTIONS: readonly { value: CaptionAnimationId; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'pop-scale', label: 'Pop Scale' },
  { value: 'karaoke-fill', label: 'Karaoke Fill' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'box-highlight', label: 'Box Highlight' },
];

export const EMPHASIS_QUICK_SWATCHES: readonly { hex: string; label: string }[] = [
  { hex: '#FFE600', label: 'Viral Yellow' },
  { hex: '#22C55E', label: 'Signal Green' },
  { hex: '#EF4444', label: 'Alert Red' },
  { hex: '#53FC18', label: 'Kick Green' },
  { hex: '#38BDF8', label: 'Ice Blue' },
];

/* -------------------------------------------------------------------------- */
/* 3. 2026 Platform Safe Zone Specs (1080×1920 Reference Geometry)            */
/* -------------------------------------------------------------------------- */

export interface SafeZoneSpec {
  id: ResolvedSafeZonePlatformId;
  label: string;
  shortLabel: string;
  accentHex: string;
  refWidth: 1080;
  refHeight: 1920;
  topPx: number;
  bottomPx: number;
  leftPx: number;
  rightPx: number;
  /** Optional lower-right extended UI column (e.g., Instagram Reels 880–1080 from y=970, Universal 300px below y=840) */
  lowerRightPx?: number;
  lowerRightStartY?: number;
  hasBottomProgressRail?: boolean;
  safeBoxSummary: string;
  /** Optimal vertical % (0-100 from top) so captions stay strictly above bottom UI chrome */
  autoAlignSubtitlePct: number;
  /** Optimal top % (0-100 from top) for top headline hook banners strictly below top UI */
  hookTopPct: number;
}

export const SAFE_ZONE_SPECS: Record<ResolvedSafeZonePlatformId, SafeZoneSpec> = {
  'youtube-shorts': {
    id: 'youtube-shorts',
    label: 'YouTube Shorts',
    shortLabel: 'YT Shorts',
    accentHex: '#FF0033',
    refWidth: 1080,
    refHeight: 1920,
    topPx: 288,
    bottomPx: 672,
    leftPx: 48,
    rightPx: 192,
    hasBottomProgressRail: true,
    safeBoxSummary: '840×960px safe · Top 288 / Bot 672 / L 48 / R 192',
    autoAlignSubtitlePct: 50,
    hookTopPct: 16.5,
  },
  'instagram-reels': {
    id: 'instagram-reels',
    label: 'Instagram Reels',
    shortLabel: 'IG Reels',
    accentHex: '#E1306C',
    refWidth: 1080,
    refHeight: 1920,
    topPx: 269,
    bottomPx: 672,
    leftPx: 65,
    rightPx: 65,
    lowerRightPx: 200,
    lowerRightStartY: 970,
    safeBoxSummary: 'Top 14% (269) / Bot 35% (672) / Action col 880–1080',
    autoAlignSubtitlePct: 58,
    hookTopPct: 15.5,
  },
  universal: {
    id: 'universal',
    label: 'Universal Cross-Post',
    shortLabel: 'Universal',
    accentHex: '#53FC18',
    refWidth: 1080,
    refHeight: 1920,
    topPx: 288,
    bottomPx: 672,
    leftPx: 120,
    rightPx: 192,
    lowerRightPx: 300,
    lowerRightStartY: 840,
    safeBoxSummary: 'Top 288 / Bot 672 / L 120 / R 192–300',
    autoAlignSubtitlePct: 57,
    hookTopPct: 16.5,
  },
};

export function resolveSafeZonePlatform(
  override: SafeZonePlatformId,
  templateId: string
): ResolvedSafeZonePlatformId {
  if (override !== 'auto') return override;
  if (templateId === 'yt-short' || templateId === 'youtube_shorts' || templateId === 'shorts_progress') {
    return 'youtube-shorts';
  }
  if (templateId === 'insta-short') {
    return 'instagram-reels';
  }
  return 'universal';
}

export function getSafeZoneSpec(
  override: SafeZonePlatformId,
  templateId: string
): SafeZoneSpec {
  return SAFE_ZONE_SPECS[resolveSafeZonePlatform(override, templateId)];
}

/* -------------------------------------------------------------------------- */
/* 4. Dynamic Word-Level Re-Chunking & Emphasis Engine                         */
/* -------------------------------------------------------------------------- */

export interface TimedWordToken {
  cueIndex: number;
  tokenIndex: number;
  text: string;
  start_ms: number;
  end_ms: number;
  emphasisColor?: string;
}

export interface WordBeatChunk {
  index: number;
  start_ms: number;
  end_ms: number;
  tokens: TimedWordToken[];
}

/**
 * Expands transcript cues into word-level tokens with exact interpolated timestamps
 * while preserving per-word emphasis colors assigned in the Inspector.
 */
export function expandCuesToTimedWords(cues: readonly WordCue[]): TimedWordToken[] {
  const result: TimedWordToken[] = [];
  cues.forEach((cue, cueIndex) => {
    const parts = cue.text.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    const totalDur = Math.max(120, cue.end_ms - cue.start_ms);
    const step = totalDur / parts.length;
    parts.forEach((word, tokenIndex) => {
      const start = Math.round(cue.start_ms + tokenIndex * step);
      const end = Math.round(
        tokenIndex === parts.length - 1 ? cue.end_ms : cue.start_ms + (tokenIndex + 1) * step
      );
      result.push({
        cueIndex,
        tokenIndex,
        text: word,
        start_ms: start,
        end_ms: Math.max(start + 60, end),
        emphasisColor: cue.wordEmphasis?.[tokenIndex],
      });
    });
  });
  return result;
}

/**
 * Dynamically re-chunks timed word tokens by viral pacing (`1 Word`, `2-3 Words`, `4-5 Words`)
 * without breaking original timestamps or per-word emphasis colors.
 */
export function chunkWordCues(
  cues: readonly WordCue[],
  pacing: WordPacingId
): WordBeatChunk[] {
  const tokens = expandCuesToTimedWords(cues);
  if (tokens.length === 0) return [];

  const targetSize = pacing === '1' ? 1 : pacing === '2-3' ? 3 : 5;
  const chunks: WordBeatChunk[] = [];

  for (let i = 0; i < tokens.length; i += targetSize) {
    const slice = tokens.slice(i, i + targetSize);
    chunks.push({
      index: chunks.length,
      start_ms: slice[0].start_ms,
      end_ms: slice[slice.length - 1].end_ms,
      tokens: slice,
    });
  }
  return chunks;
}

export function getActiveWordBeat(
  cues: readonly WordCue[],
  pacing: WordPacingId,
  currentTimeSec: number
): { chunk: WordBeatChunk; activeTokenIndex: number } | null {
  const chunks = chunkWordCues(cues, pacing);
  if (chunks.length === 0) return null;
  const ms = currentTimeSec * 1000;
  const chunk = chunks.find((c) => ms >= c.start_ms && ms <= c.end_ms) ?? chunks[0];
  let activeIdx = chunk.tokens.findIndex((t) => ms >= t.start_ms && ms <= t.end_ms);
  if (activeIdx < 0) activeIdx = 0;
  return { chunk, activeTokenIndex: activeIdx };
}

/* -------------------------------------------------------------------------- */
/* 5. 1:1 Preview-to-Export Parity (ASS v4.00+ & FFmpeg Filtergraph Spec)     */
/* -------------------------------------------------------------------------- */

function formatAssTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const cs = Math.floor(clamped / 10);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs / 6_000) % 60);
  const s = Math.floor((cs / 100) % 60);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Converts `#RRGGBB` into libass `&H00BBGGRR` hex color format */
export function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return `&H${alphaHex}FFFFFF`;
  const r = clean.slice(0, 2).toUpperCase();
  const g = clean.slice(2, 4).toUpperCase();
  const b = clean.slice(4, 6).toUpperCase();
  return `&H${alphaHex}${b}${g}${r}`;
}

function sanitizeAssText(text: string): string {
  return text.replace(/[{}]/g, '').replace(/,/g, ' ').replace(/\r?\n/g, ' ');
}

export function applyWordCasing(word: string, casing: TextCasingId): string {
  if (casing === 'upper') return word.toUpperCase();
  if (casing === 'title') return word.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return word;
}

export function generateAssSubtitle(
  cues: readonly WordCue[],
  settings: EditorSettings,
  trimInSec: number,
  customFonts: readonly CustomFontEntry[] = []
): string {
  const fontMeta = getViralFont(settings.subtitleFont, customFonts);
  const safeSpec = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
  const playResX =
    settings.aspect === '16:9' ? 1920 : settings.aspect === '4:3' ? 1440 : 1080;
  const playResY =
    settings.aspect === '9:16' ? 1920 : settings.aspect === '4:5' ? 1350 : 1080;
  const posX = Math.round((playResX * settings.subtitleX) / 100);
  const posY = Math.round((playResY * settings.subtitleVerticalPos) / 100);
  const marginV = Math.max(40, Math.round(playResY * (1 - settings.subtitleVerticalPos / 100)));
  const marginL = settings.aspect === '9:16' ? safeSpec.leftPx : 64;
  const marginR = settings.aspect === '9:16' ? safeSpec.rightPx : 64;
  const isWhitePill = settings.subtitleBgStyle === 'white-stepped';
  const primary = hexToAssColor(isWhitePill ? '#09090B' : settings.subtitleActiveColor);
  const secondary = hexToAssColor(isWhitePill ? '#09090B' : settings.subtitleBaseColor);
  const outline = hexToAssColor(
    isWhitePill ? '#FFFFFF' : settings.subtitleBgStyle === 'dark-pill' ? '#09090B' : settings.subtitleStrokeColor
  );
  const back = isWhitePill
    ? '&H00FFFFFF'
    : settings.subtitleBgStyle === 'dark-pill'
      ? '&H4009090B'
      : settings.subtitleDropShadow
        ? '&H80000000'
        : '&HFF000000';
  const bold = fontMeta.defaultWeight >= 700 ? -1 : 0;
  const italic = fontMeta.italic ? -1 : 0;
  const borderStyle =
    settings.subtitleBgStyle === 'white-stepped' ||
    settings.subtitleBgStyle === 'dark-pill' ||
    settings.subtitleAnimation === 'box-highlight'
      ? 3
      : 1;
  const alignment =
    settings.subtitleAlign === 'left' ? 4 : settings.subtitleAlign === 'right' ? 6 : 5;
  const shadowDepth = settings.subtitleNeonGlow ? 4 : settings.subtitleDropShadow ? 3 : 0;

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `; PulseCut 1:1 Parity · Template=${settings.template} · SafeZone=${safeSpec.id} · FontFile=${fontMeta.ttfFile}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Viral,${fontMeta.family},${Math.round(settings.subtitleSize * 2.4)},${primary},${secondary},${outline},${back},${bold},${italic},0,0,100,100,0,0,${borderStyle},${settings.subtitleStrokeWidth},${shadowDepth},${alignment},${marginL},${marginR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const trimOffsetMs = Math.round(trimInSec * 1000);
  const chunks = chunkWordCues(cues, settings.subtitleWordsPerScreen);
  const posTag = `{\\an${alignment}\\pos(${posX},${posY})}`;

  chunks.forEach((chunk) => {
    const startMs = Math.max(0, chunk.start_ms - trimOffsetMs);
    const endMs = Math.max(startMs + 250, chunk.end_ms - trimOffsetMs);
    const body = chunk.tokens
      .map((tok) => {
        const durCs = Math.max(4, Math.round((tok.end_ms - tok.start_ms) / 10));
        const wordText = sanitizeAssText(applyWordCasing(tok.text, settings.subtitleCasing));
        const colorTag = tok.emphasisColor ? `\\1c${hexToAssColor(tok.emphasisColor)}&` : '';
        const animTag =
          settings.subtitleAnimation === 'pop-scale'
            ? '\\fscx108\\fscy108\\t(0,140,\\fscx100\\fscy100)'
            : '';
        return `{\\k${durCs}${colorTag}${animTag}}${wordText}`;
      })
      .join(' ');
    lines.push(
      `Dialogue: 0,${formatAssTimestamp(startMs)},${formatAssTimestamp(endMs)},Viral,,0,0,0,,${posTag}${body}`
    );
  });

  return lines.join('\n');
}

export interface RenderParitySpec {
  dimensions: { width: number; height: number };
  safeZone: SafeZoneSpec;
  headlineFontFile: string;
  subtitleFontFile: string;
  overlayAssets: string[];
  ffmpegFiltergraph: string;
  assScript: string;
}

export function buildRenderParitySpec(
  cues: readonly WordCue[],
  settings: EditorSettings,
  brandKit: BrandKit,
  trimInSec: number,
  customFonts: readonly CustomFontEntry[] = []
): RenderParitySpec {
  const safeZone = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
  const headlineMeta = getViralFont(settings.font, customFonts);
  const subtitleMeta = getViralFont(settings.subtitleFont, customFonts);
  const width =
    settings.aspect === '16:9' ? 1920 : settings.aspect === '4:3' ? 1440 : 1080;
  const height =
    settings.aspect === '9:16' ? 1920 : settings.aspect === '4:5' ? 1350 : 1080;

  const overlayAssets: string[] = [];
  const resolvedPlatform =
    settings.streamerPlatform === 'auto'
      ? settings.template === 'kick-stream' || settings.template === 'split-stream'
        ? 'kick'
        : settings.template === 'insta-short'
          ? 'instagram'
          : settings.template === 'yt-short'
            ? 'youtube'
            : 'none'
      : settings.streamerPlatform;

  if (settings.showStreamerBadge && settings.streamerHandle.trim()) {
    const label = settings.streamerBadgeUppercase
      ? settings.streamerHandle.trim().toUpperCase()
      : settings.streamerHandle.trim();
    const logoAsset =
      resolvedPlatform === 'kick'
        ? 'kick_logo_53fc18.svg'
        : resolvedPlatform === 'instagram'
          ? 'insta_icon.svg'
          : resolvedPlatform === 'youtube'
            ? 'yt_shorts_icon.svg'
            : 'text_credit';
    overlayAssets.push(
      `${logoAsset} "${label}" @ (${Math.round(settings.streamerBadgeX)}%, ${Math.round(settings.streamerBadgeY)}%)`
    );
  }
  if (brandKit.showWatermark && brandKit.handle.trim()) {
    const wmHandle = brandKit.handle.trim().startsWith('@')
      ? brandKit.handle.trim()
      : `@${brandKit.handle.trim()}`;
    overlayAssets.push(
      `watermark "${wmHandle}" @ (${Math.round(settings.watermarkX)}%, ${Math.round(settings.watermarkY)}%)`
    );
  }
  if (settings.headline.trim() && settings.headlineLayout !== 'none') {
    overlayAssets.push(
      `hook_${settings.headlineLayout} @ (${Math.round(settings.headlineX)}%, ${Math.round(settings.headlineY)}%)`
    );
  }

  if (settings.facecamEnabled) {
    const fc = settings.facecamSourceBox;
    overlayAssets.push(
      `facecam_crop (${fc.x}%,${fc.y}% ${fc.width}%x${fc.height}%) -> ${settings.facecamPlacement} (${settings.facecamOutputAspect})`
    );
  }
  if (settings.mainVideoAspect !== '9:16') {
    overlayAssets.push(
      `main_video_frame ${settings.mainVideoAspect} (${settings.mainVideoFit}) @ y=${settings.mainVideoOffsetY}%`
    );
  }

  const assScript = generateAssSubtitle(cues, settings, trimInSec, customFonts);
  const speedFilter =
    settings.playbackSpeed && Math.abs(settings.playbackSpeed - 1) > 0.01
      ? `,setpts=${(1 / settings.playbackSpeed).toFixed(3)}*PTS`
      : '';
  let ffmpegFiltergraph: string;

  const cropBoxExpr = (box: { x: number; y: number; width: number; height: number }) =>
    `crop=iw*${(box.width / 100).toFixed(2)}:ih*${(box.height / 100).toFixed(2)}:iw*${(box.x / 100).toFixed(2)}:ih*${(box.y / 100).toFixed(2)}`;

  if (settings.layout === 'trio') {
    const halfW = Math.round(width / 2);
    const topH = Math.round(height / 2);
    const botH = height - topH;
    const c1 = cropBoxExpr(settings.speakerCrops.primary);
    const c2 = cropBoxExpr(settings.speakerCrops.secondary);
    const c3 = cropBoxExpr(settings.speakerCrops.tertiary);
    overlayAssets.push(`trio_speakers (3x cropped regions -> 2-over-1 grid)`);
    ffmpegFiltergraph = [
      `[0:v]split=3[s1][s2][s3]`,
      `[s1]${c1},scale=${halfW}:${topH}:force_original_aspect_ratio=increase,crop=${halfW}:${topH}[tl]`,
      `[s2]${c2},scale=${width - halfW}:${topH}:force_original_aspect_ratio=increase,crop=${width - halfW}:${topH}[tr]`,
      `[tl][tr]hstack=inputs=2[top]`,
      `[s3]${c3},scale=${width}:${botH}:force_original_aspect_ratio=increase,crop=${width}:${botH}[bot]`,
      `[top][bot]vstack=inputs=2${speedFilter},ass=captions.ass:fontsdir=./fonts`,
    ].join(';');
  } else if (settings.facecamEnabled) {
    const fc = settings.facecamSourceBox;
    const cropExpr = cropBoxExpr(fc);
    if (settings.facecamPlacement === 'split-top' || settings.facecamPlacement === 'split-bottom') {
      const camH = Math.round((height * settings.facecamSplitRatio) / 100);
      const mainH = height - camH;
      const stackOrder = settings.facecamPlacement === 'split-top' ? '[cam][main]' : '[main][cam]';
      ffmpegFiltergraph = [
        `[0:v]split=2[src_main][src_cam]`,
        `[src_main]scale=${width}:${mainH}:force_original_aspect_ratio=increase,crop=${width}:${mainH}[main]`,
        `[src_cam]${cropExpr},scale=${width}:${camH}:force_original_aspect_ratio=increase,crop=${width}:${camH}[cam]`,
        `${stackOrder}vstack=inputs=2${speedFilter},ass=captions.ass:fontsdir=./fonts`,
      ].join(';');
    } else {
      const camW = Math.round((width * settings.facecamOutputWidth) / 100);
      const aspectRatio =
        settings.facecamOutputAspect === '4:3'
          ? 4 / 3
          : settings.facecamOutputAspect === '1:1'
            ? 1
            : settings.facecamOutputAspect === '9:16'
              ? 9 / 16
              : 16 / 9;
      const camH = Math.round(camW / aspectRatio);
      const ovX = Math.max(0, Math.round((width * settings.facecamOutputX) / 100 - camW / 2));
      const ovY = Math.max(0, Math.round((height * settings.facecamOutputY) / 100 - camH / 2));
      ffmpegFiltergraph = [
        `[0:v]split=2[src_main][src_cam]`,
        `[src_main]scale=${width}:${height}:force_original_aspect_ratio=${settings.mainVideoFit === 'contain' ? 'decrease' : 'increase'},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${settings.outerFill}[bg]`,
        `[src_cam]${cropExpr},scale=${camW}:${camH}:force_original_aspect_ratio=increase,crop=${camW}:${camH}[cam]`,
        `[bg][cam]overlay=${ovX}:${ovY}${speedFilter},ass=captions.ass:fontsdir=./fonts`,
      ].join(';');
    }
  } else if (settings.layout === 'split') {
    const topH = Math.round(height / 2);
    const botH = height - topH;
    const c1 = cropBoxExpr(settings.speakerCrops.primary);
    const c2 = cropBoxExpr(settings.speakerCrops.secondary);
    overlayAssets.push(`dual_split_speakers (Top + Bottom 9:8 crops)`);
    ffmpegFiltergraph = [
      `[0:v]split=2[s1][s2]`,
      `[s1]${c1},scale=${width}:${topH}:force_original_aspect_ratio=increase,crop=${width}:${topH}[top]`,
      `[s2]${c2},scale=${width}:${botH}:force_original_aspect_ratio=increase,crop=${width}:${botH}[bot]`,
      `[top][bot]vstack=inputs=2${speedFilter},ass=captions.ass:fontsdir=./fonts`,
    ].join(';');
  } else {
    const soloCrop =
      settings.layout === 'solo' ? `${cropBoxExpr(settings.speakerCrops.primary)},` : '';
    ffmpegFiltergraph = [
      `${soloCrop}scale=${width}:${height}:force_original_aspect_ratio=${settings.layout === 'centered' || settings.mainVideoFit === 'contain' ? 'decrease' : 'increase'}`,
      settings.canvas === 'blur'
        ? `gblur=sigma=24`
        : `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${settings.outerFillActive ? settings.outerFill : '#000000'}`,
      ...(speedFilter ? [speedFilter.slice(1)] : []),
      `ass=captions.ass:fontsdir=./fonts`,
    ].join(',');
  }

  return {
    dimensions: { width, height },
    safeZone,
    headlineFontFile: headlineMeta.ttfFile,
    subtitleFontFile: subtitleMeta.ttfFile,
    overlayAssets,
    ffmpegFiltergraph,
    assScript,
  };
}
