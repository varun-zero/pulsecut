import type {
  AspectRatioId,
  ColorFilterId,
  HeadlineLayoutStyleId,
  LayoutModeId,
  ResolvedSafeZonePlatformId,
  StreamerPlatformId,
  SubtitleBgStyleId,
  TransitionStyleId,
} from '../types';
import type { TemplateCategory, TemplatePreset } from '../presets';
import type { ViralCaptionPreset } from '../captionStyles';

/* -------------------------------------------------------------------------- */
/* 1. Custom Template CRUD & In-App Template Editor Schema                    */
/* -------------------------------------------------------------------------- */

export type TemplateSourceFormat =
  | 'pulsecut'
  | 'capcut'
  | 'alight-motion'
  | 'lottie-ae'
  | 'premiere-mogrt'
  | 'fcpxml'
  | 'ass-subtitles'
  | 'image-overlay'
  | 'generic-json';

export type TemplateOverlayBlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'lighten';

export interface EditableTemplatePreset extends TemplatePreset {
  isCustom?: boolean;
  /** Default canvas aspect ratio applied when this template is chosen */
  defaultAspect?: AspectRatioId;
  /** When true, applies Full Screen (100% whole source over backdrop) to Framing Blueprint */
  defaultFullScreen?: boolean;
  /** Default headline vertical position (8..48%) */
  defaultHeadlineY?: number;
  /** Default subtitle vertical position (18..90%) */
  defaultSubtitleY?: number;
  /** Default subtitle font size (14..44) */
  defaultSubtitleSize?: number;
  /** Default headline font size (14..40) */
  defaultHeadlineSize?: number;
  /** Imported source format badge (e.g. CapCut, Alight Motion, Lottie, MOGRT, Overlay) */
  sourceFormat?: TemplateSourceFormat;
  sourceFormatLabel?: string;
  /** Optional full-frame transparent PNG/WebP/SVG graphic overlay imported from any editor */
  overlayImageDataUrl?: string;
  /** Overlay opacity (0..100, default 100) */
  overlayOpacity?: number;
  /** Overlay CSS/compositing blend mode */
  overlayBlendMode?: TemplateOverlayBlendMode;
  /** Optional extracted color grade / transition / speed / subtitle color overrides */
  defaultColorFilter?: ColorFilterId;
  defaultTransitionStyle?: TransitionStyleId;
  defaultPlaybackSpeed?: number;
  defaultSubtitleActiveColor?: string;
  defaultSubtitleBaseColor?: string;
  defaultSubtitleStrokeWidth?: number;
  defaultVideoScale?: number;
  /** Human-readable import report lines */
  importSummary?: string[];
  importWarnings?: string[];
}

export interface TemplateCatalogState {
  customTemplates: EditableTemplatePreset[];
  editedBuiltins: Record<string, Partial<EditableTemplatePreset>>;
  deletedIds: string[];
}

export const EMPTY_TEMPLATE_CATALOG: TemplateCatalogState = {
  customTemplates: [],
  editedBuiltins: {},
  deletedIds: [],
};

export function resolveTemplateCatalog(
  builtins: readonly TemplatePreset[],
  state: TemplateCatalogState
): EditableTemplatePreset[] {
  const deleted = new Set(state.deletedIds);
  const mergedBuiltins: EditableTemplatePreset[] = builtins
    .filter((b) => !deleted.has(b.id))
    .map((b) => ({
      ...b,
      ...(state.editedBuiltins[b.id] || {}),
      id: b.id,
      isCustom: false,
    }));

  const customs = state.customTemplates
    .filter((c) => !deleted.has(c.id))
    .map((c) => ({ ...c, isCustom: true }));

  const combined = [...customs, ...mergedBuiltins];
  if (combined.length === 0 && builtins.length > 0) {
    return [{ ...builtins[0], isCustom: false }];
  }
  return combined;
}

export function upsertTemplateInCatalog(
  state: TemplateCatalogState,
  template: EditableTemplatePreset,
  builtinIds: ReadonlySet<string>
): TemplateCatalogState {
  if (builtinIds.has(template.id)) {
    return {
      ...state,
      deletedIds: state.deletedIds.filter((id) => id !== template.id),
      editedBuiltins: {
        ...state.editedBuiltins,
        [template.id]: { ...template, isCustom: false },
      },
    };
  }
  const exists = state.customTemplates.some((t) => t.id === template.id);
  const nextCustom: EditableTemplatePreset = { ...template, isCustom: true, featured: true };
  return {
    ...state,
    deletedIds: state.deletedIds.filter((id) => id !== template.id),
    customTemplates: exists
      ? state.customTemplates.map((t) => (t.id === template.id ? nextCustom : t))
      : [nextCustom, ...state.customTemplates],
  };
}

export function deleteTemplateFromCatalog(
  state: TemplateCatalogState,
  id: string,
  builtins: readonly TemplatePreset[]
): TemplateCatalogState {
  const current = resolveTemplateCatalog(builtins, state);
  if (current.length <= 1) {
    return state; // Always keep at least 1 active template
  }
  const isBuiltin = builtins.some((b) => b.id === id);
  if (isBuiltin) {
    return {
      ...state,
      deletedIds: Array.from(new Set([...state.deletedIds, id])),
    };
  }
  return {
    ...state,
    customTemplates: state.customTemplates.filter((t) => t.id !== id),
  };
}

export function createBlankTemplateDraft(seed?: Partial<EditableTemplatePreset>): EditableTemplatePreset {
  const id = seed?.id || `custom-tpl-${Date.now()}`;
  return {
    id,
    name: seed?.name || 'My Viral Template',
    fullName: seed?.fullName || seed?.name || 'My Viral Template',
    category: (seed?.category as Exclude<TemplateCategory, 'All'>) || 'Viral Hooks',
    description:
      seed?.description ||
      'Custom short-form template with saved aspect ratio, full-screen framing, and caption placement.',
    featured: true,
    isCustom: true,
    defaultAspect: seed?.defaultAspect || '9:16',
    defaultFullScreen: seed?.defaultFullScreen ?? false,
    defaultLayout: (seed?.defaultLayout as LayoutModeId) || 'solo',
    defaultCaptionStyle: seed?.defaultCaptionStyle || 'hormozi-classic',
    defaultSafeZone: (seed?.defaultSafeZone as ResolvedSafeZonePlatformId) || 'youtube-shorts',
    defaultHeadlineFont: seed?.defaultHeadlineFont || 'Montserrat',
    defaultSubtitleFont: seed?.defaultSubtitleFont || 'Montserrat',
    defaultHeadlineLayout: (seed?.defaultHeadlineLayout as HeadlineLayoutStyleId) || 'outline-only',
    defaultSubtitleBg: (seed?.defaultSubtitleBg as SubtitleBgStyleId) || 'none',
    defaultStreamerPlatform: (seed?.defaultStreamerPlatform as StreamerPlatformId) || 'none',
    defaultOuterFill: seed?.defaultOuterFill || '#09090B',
    defaultCornerRadius: seed?.defaultCornerRadius ?? 0,
    defaultHeadlineY: seed?.defaultHeadlineY ?? 18,
    defaultSubtitleY: seed?.defaultSubtitleY ?? 68,
    defaultHeadlineSize: seed?.defaultHeadlineSize ?? 22,
    defaultSubtitleSize: seed?.defaultSubtitleSize ?? 26,
    hasCard: seed?.hasCard ?? false,
    hasHeadline: seed?.hasHeadline ?? true,
    hasTicker: seed?.hasTicker ?? false,
    accentHex: seed?.accentHex || '#FFE600',
    wireframe: seed?.wireframe || 'plain',
    sourceFormat: seed?.sourceFormat,
    sourceFormatLabel: seed?.sourceFormatLabel,
    overlayImageDataUrl: seed?.overlayImageDataUrl,
    overlayOpacity: seed?.overlayOpacity ?? (seed?.overlayImageDataUrl ? 100 : undefined),
    overlayBlendMode: seed?.overlayBlendMode ?? (seed?.overlayImageDataUrl ? 'normal' : undefined),
    defaultColorFilter: seed?.defaultColorFilter,
    defaultTransitionStyle: seed?.defaultTransitionStyle,
    defaultPlaybackSpeed: seed?.defaultPlaybackSpeed,
    defaultSubtitleActiveColor: seed?.defaultSubtitleActiveColor,
    defaultSubtitleBaseColor: seed?.defaultSubtitleBaseColor,
    defaultSubtitleStrokeWidth: seed?.defaultSubtitleStrokeWidth,
    defaultVideoScale: seed?.defaultVideoScale,
    importSummary: seed?.importSummary,
    importWarnings: seed?.importWarnings,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Custom Caption Style CRUD                                               */
/* -------------------------------------------------------------------------- */

export interface EditableCaptionPreset extends Omit<ViralCaptionPreset, 'id'> {
  id: string;
  isCustom?: boolean;
}

export interface CaptionCatalogState {
  customStyles: EditableCaptionPreset[];
  deletedIds: string[];
}

export const EMPTY_CAPTION_CATALOG: CaptionCatalogState = {
  customStyles: [],
  deletedIds: [],
};

export function resolveCaptionCatalog(
  builtins: readonly ViralCaptionPreset[],
  state: CaptionCatalogState
): EditableCaptionPreset[] {
  const deleted = new Set(state.deletedIds);
  const base = builtins
    .filter((b) => !deleted.has(b.id))
    .map((b) => ({ ...b, isCustom: false }));
  const customs = state.customStyles
    .filter((c) => !deleted.has(c.id))
    .map((c) => ({ ...c, isCustom: true }));
  const combined = [...customs, ...base];
  return combined.length > 0 ? combined : [{ ...builtins[0], isCustom: false }];
}

export function addCaptionStyleToCatalog(
  state: CaptionCatalogState,
  style: EditableCaptionPreset
): CaptionCatalogState {
  const next: EditableCaptionPreset = { ...style, isCustom: true };
  const exists = state.customStyles.some((s) => s.id === style.id);
  return {
    ...state,
    deletedIds: state.deletedIds.filter((id) => id !== style.id),
    customStyles: exists
      ? state.customStyles.map((s) => (s.id === style.id ? next : s))
      : [next, ...state.customStyles],
  };
}

export function deleteCaptionStyleFromCatalog(
  state: CaptionCatalogState,
  id: string,
  builtins: readonly ViralCaptionPreset[]
): CaptionCatalogState {
  const current = resolveCaptionCatalog(builtins, state);
  if (current.length <= 1) return state;
  const isBuiltin = builtins.some((b) => b.id === id);
  if (isBuiltin) {
    return { ...state, deletedIds: Array.from(new Set([...state.deletedIds, id])) };
  }
  return {
    ...state,
    customStyles: state.customStyles.filter((s) => s.id !== id),
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Persistent Logos Library (Built-In SVG Marks + User Uploaded Logos)     */
/* -------------------------------------------------------------------------- */

export interface LogoAsset {
  id: string;
  name: string;
  dataUrl: string;
  isCustom: boolean;
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const BUILTIN_LOGOS: readonly LogoAsset[] = [
  {
    id: 'logo-yt-shorts',
    name: 'YT Shorts',
    isCustom: false,
    dataUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="28" fill="#FF0033"/><path d="M77 45c2-1 4 0 4 2v26c0 2-2 3-4 2L49 62c-2-1-2-3 0-4l28-13z" fill="#fff" transform="rotate(180 63 60)"/></svg>`
    ),
  },
  {
    id: 'logo-kick-k',
    name: 'Kick K',
    isCustom: false,
    dataUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#0B0E0F"/><path d="M30 24h22v28h12V38h12V24h22v26H86v14h-12v12h12v14h12v26H76v-14H64V88H52v28H30V24z" fill="#53FC18"/></svg>`
    ),
  },
  {
    id: 'logo-studio-frame',
    name: 'Studio Frame',
    isCustom: false,
    dataUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="24" fill="#111114"/><rect x="24" y="28" width="30" height="64" rx="6" fill="#F4F4F6"/><rect x="64" y="28" width="32" height="38" rx="6" fill="#3B82F6"/><rect x="64" y="74" width="32" height="18" rx="5" fill="#F4F4F6" fill-opacity="0.45"/></svg>`
    ),
  },
  {
    id: 'logo-rec-minimal',
    name: 'REC Minimal',
    isCustom: false,
    dataUrl: svgToDataUrl(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 64"><rect width="160" height="64" rx="12" fill="#09090B" stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2"/><circle cx="32" cy="32" r="8" fill="#EF4444"/><text x="54" y="41" font-family="system-ui, sans-serif" font-size="26" font-weight="700" letter-spacing="3" fill="#FFFFFF">REC</text></svg>`
    ),
  },
];

/* -------------------------------------------------------------------------- */
/* 4. Copyright-Free Viral Music Catalog (By Video Scenario / Mood)           */
/* -------------------------------------------------------------------------- */

export type MusicMoodId =
  | 'all'
  | 'thrilled'
  | 'phonk'
  | 'sad'
  | 'happy'
  | 'suspense'
  | 'motivational';

export interface CopyrightFreeTrack {
  id: string;
  title: string;
  artist: string;
  mood: Exclude<MusicMoodId, 'all'>;
  trending: boolean;
  bpm: number;
  source: string;
  license: 'No Attribution (YT Safe)' | 'CC BY (Credit in Description)';
  attributionText?: string;
  bestFor: string;
  downloadUrl: string;
  /** Recommended ducked/peak/riser mix preset when applied to A2 */
  mixPreset: {
    audioBaseVol: number;
    audioPeakVol: number;
    riserDurationSec: number;
  };
  /** Synth preview parameters so users can audition mood cadence inside the browser */
  previewTone: {
    notes: number[];
    tempoMs: number;
    wave: OscillatorType;
  };
}

export const MUSIC_MOOD_OPTIONS: readonly { id: MusicMoodId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'thrilled', label: 'Thrilled' },
  { id: 'phonk', label: 'Viral Phonk' },
  { id: 'sad', label: 'Sad' },
  { id: 'happy', label: 'Happy' },
  { id: 'suspense', label: 'Suspense' },
  { id: 'motivational', label: 'Motivation' },
];

export const COPYRIGHT_FREE_MUSIC_CATALOG: readonly CopyrightFreeTrack[] = [
  /* --- THRILLED / HYPE --- */
  {
    id: 'bgm-ncs-sky-high',
    title: 'Sky High',
    artist: 'Elektronomia',
    mood: 'thrilled',
    trending: true,
    bpm: 128,
    source: 'NCS (NoCopyrightSounds)',
    license: 'CC BY (Credit in Description)',
    attributionText: 'Music: Elektronomia - Sky High [NCS Release]',
    bestFor: 'Gaming clutches, wins, fast highlight montages',
    downloadUrl: 'https://ncs.io/SkyHigh',
    mixPreset: { audioBaseVol: 14, audioPeakVol: 82, riserDurationSec: 4 },
    previewTone: { notes: [330, 392, 494, 659], tempoMs: 170, wave: 'sawtooth' },
  },
  {
    id: 'bgm-ncs-on-and-on',
    title: 'On & On (feat. Daniel Levi)',
    artist: 'Cartoon, Jéja',
    mood: 'thrilled',
    trending: true,
    bpm: 174,
    source: 'NCS (NoCopyrightSounds)',
    license: 'CC BY (Credit in Description)',
    attributionText: 'Music: Cartoon, Jéja - On & On (feat. Daniel Levi) [NCS Release]',
    bestFor: 'High-energy Shorts, epic payoffs, sports clips',
    downloadUrl: 'https://ncs.io/OnAndOn',
    mixPreset: { audioBaseVol: 12, audioPeakVol: 85, riserDurationSec: 5 },
    previewTone: { notes: [392, 440, 523, 659], tempoMs: 150, wave: 'triangle' },
  },
  {
    id: 'bgm-ncs-royalty',
    title: 'Royalty',
    artist: 'Egzod & Maestro Chives',
    mood: 'thrilled',
    trending: true,
    bpm: 109,
    source: 'NCS (NoCopyrightSounds)',
    license: 'CC BY (Credit in Description)',
    attributionText: 'Music: Egzod & Maestro Chives - Royalty [NCS Release]',
    bestFor: 'Dramatic comeback clips, esports & alpha edits',
    downloadUrl: 'https://ncs.io/Royalty',
    mixPreset: { audioBaseVol: 16, audioPeakVol: 88, riserDurationSec: 5 },
    previewTone: { notes: [220, 261, 330, 440], tempoMs: 210, wave: 'sawtooth' },
  },

  /* --- VIRAL PHONK / EDIT --- */
  {
    id: 'bgm-ncs-mortals',
    title: 'Mortals (Viral Edit Cut)',
    artist: 'Warriyo (feat. Laura Brehm)',
    mood: 'phonk',
    trending: true,
    bpm: 140,
    source: 'NCS (NoCopyrightSounds)',
    license: 'CC BY (Credit in Description)',
    attributionText: 'Music: Warriyo - Mortals [NCS Release]',
    bestFor: 'Viral punchline reveals, sigma/gaming edits',
    downloadUrl: 'https://ncs.io/Mortals',
    mixPreset: { audioBaseVol: 14, audioPeakVol: 90, riserDurationSec: 3.5 },
    previewTone: { notes: [146, 174, 220, 174], tempoMs: 160, wave: 'sawtooth' },
  },
  {
    id: 'bgm-pixabay-drift-phonk',
    title: 'Midnight Drift Phonk',
    artist: 'Pixabay Royalty-Free Phonk',
    mood: 'phonk',
    trending: true,
    bpm: 132,
    source: 'Pixabay Music (YouTube Safe)',
    license: 'No Attribution (YT Safe)',
    bestFor: 'Car reels, gym PRs, streamer rage/clutch edits',
    downloadUrl: 'https://pixabay.com/music/search/phonk/',
    mixPreset: { audioBaseVol: 16, audioPeakVol: 90, riserDurationSec: 3 },
    previewTone: { notes: [110, 130, 146, 110], tempoMs: 145, wave: 'square' },
  },
  {
    id: 'bgm-ncs-heroes-tonight',
    title: 'Heroes Tonight',
    artist: 'Janji (feat. Johnning)',
    mood: 'phonk',
    trending: true,
    bpm: 128,
    source: 'NCS (NoCopyrightSounds)',
    license: 'CC BY (Credit in Description)',
    attributionText: 'Music: Janji - Heroes Tonight [NCS Release]',
    bestFor: 'Fast-cut viral Shorts & reaction compilations',
    downloadUrl: 'https://ncs.io/HeroesTonight',
    mixPreset: { audioBaseVol: 14, audioPeakVol: 84, riserDurationSec: 4 },
    previewTone: { notes: [261, 330, 392, 523], tempoMs: 165, wave: 'sawtooth' },
  },

  /* --- SAD / EMOTIONAL --- */
  {
    id: 'bgm-yt-liquid-time',
    title: 'Liquid Time',
    artist: 'Aakash Gandhi',
    mood: 'sad',
    trending: true,
    bpm: 72,
    source: 'YouTube Audio Library',
    license: 'No Attribution (YT Safe)',
    bestFor: 'Deep emotional stories, heartbreak, reflection clips',
    downloadUrl: 'https://studio.youtube.com/channel/UC/music',
    mixPreset: { audioBaseVol: 18, audioPeakVol: 68, riserDurationSec: 6 },
    previewTone: { notes: [220, 261, 246, 196], tempoMs: 360, wave: 'sine' },
  },
  {
    id: 'bgm-scott-snowfall',
    title: 'Snowfall (Ambient Piano)',
    artist: 'Scott Buckley',
    mood: 'sad',
    trending: true,
    bpm: 68,
    source: 'Scott Buckley (CC BY 4.0)',
    license: 'CC BY (Credit in Description)',
    attributionText: 'Music: "Snowfall" by Scott Buckley (www.scottbuckley.com.au)',
    bestFor: 'Viral melancholic voiceovers, late-night quotes',
    downloadUrl: 'https://www.scottbuckley.com.au/library/snowfall/',
    mixPreset: { audioBaseVol: 20, audioPeakVol: 70, riserDurationSec: 6 },
    previewTone: { notes: [293, 261, 220, 196], tempoMs: 400, wave: 'sine' },
  },
  {
    id: 'bgm-macleod-heartbreaking',
    title: 'Heartbreaking',
    artist: 'Kevin MacLeod',
    mood: 'sad',
    trending: false,
    bpm: 64,
    source: 'Incompetech (CC BY 4.0)',
    license: 'CC BY (Credit in Description)',
    attributionText: '"Heartbreaking" Kevin MacLeod (incompetech.com) CC BY 4.0',
    bestFor: 'Sad storytelling, emotional podcast moments',
    downloadUrl: 'https://incompetech.com/music/royalty-free/music.html',
    mixPreset: { audioBaseVol: 18, audioPeakVol: 65, riserDurationSec: 5 },
    previewTone: { notes: [246, 220, 196, 174], tempoMs: 380, wave: 'sine' },
  },

  /* --- HAPPY / UPBEAT / COMEDY --- */
  {
    id: 'bgm-macleod-monkeys',
    title: 'Monkeys Spinning Monkeys',
    artist: 'Kevin MacLeod',
    mood: 'happy',
    trending: true,
    bpm: 112,
    source: 'Incompetech (CC BY 4.0)',
    license: 'CC BY (Credit in Description)',
    attributionText: '"Monkeys Spinning Monkeys" Kevin MacLeod (incompetech.com) CC BY 4.0',
    bestFor: 'Funny fails, goofy streamer clips, pet & comedy Shorts',
    downloadUrl: 'https://incompetech.com/music/royalty-free/music.html',
    mixPreset: { audioBaseVol: 15, audioPeakVol: 72, riserDurationSec: 2.5 },
    previewTone: { notes: [392, 494, 587, 523], tempoMs: 180, wave: 'triangle' },
  },
  {
    id: 'bgm-macleod-fluffing',
    title: 'Fluffing a Duck / Scheming Weasel',
    artist: 'Kevin MacLeod',
    mood: 'happy',
    trending: true,
    bpm: 118,
    source: 'Incompetech (CC BY 4.0)',
    license: 'CC BY (Credit in Description)',
    attributionText: '"Scheming Weasel (faster)" Kevin MacLeod (incompetech.com) CC BY 4.0',
    bestFor: 'Trolling moments, pranks, comedic reactions',
    downloadUrl: 'https://incompetech.com/music/royalty-free/music.html',
    mixPreset: { audioBaseVol: 14, audioPeakVol: 75, riserDurationSec: 2 },
    previewTone: { notes: [330, 392, 440, 523], tempoMs: 170, wave: 'triangle' },
  },
  {
    id: 'bgm-yt-happy-ukulele',
    title: 'Sunshine Samba / Upbeat Vlog',
    artist: 'Chris Haugen (YT Audio Library)',
    mood: 'happy',
    trending: false,
    bpm: 120,
    source: 'YouTube Audio Library',
    license: 'No Attribution (YT Safe)',
    bestFor: 'Lifestyle vlogs, wholesome stories, travel Shorts',
    downloadUrl: 'https://studio.youtube.com/channel/UC/music',
    mixPreset: { audioBaseVol: 16, audioPeakVol: 74, riserDurationSec: 3.5 },
    previewTone: { notes: [349, 440, 523, 587], tempoMs: 195, wave: 'sine' },
  },

  /* --- SUSPENSE / STORYTELLING --- */
  {
    id: 'bgm-macleod-sneaky-snitch',
    title: 'Sneaky Snitch',
    artist: 'Kevin MacLeod',
    mood: 'suspense',
    trending: true,
    bpm: 102,
    source: 'Incompetech (CC BY 4.0)',
    license: 'CC BY (Credit in Description)',
    attributionText: '"Sneaky Snitch" Kevin MacLeod (incompetech.com) CC BY 4.0',
    bestFor: 'Drama commentary, exposed clips, stealth plays',
    downloadUrl: 'https://incompetech.com/music/royalty-free/music.html',
    mixPreset: { audioBaseVol: 15, audioPeakVol: 74, riserDurationSec: 3 },
    previewTone: { notes: [220, 233, 261, 233], tempoMs: 220, wave: 'triangle' },
  },
  {
    id: 'bgm-macleod-investigations',
    title: 'Investigations',
    artist: 'Kevin MacLeod',
    mood: 'suspense',
    trending: true,
    bpm: 96,
    source: 'Incompetech (CC BY 4.0)',
    license: 'CC BY (Credit in Description)',
    attributionText: '"Investigations" Kevin MacLeod (incompetech.com) CC BY 4.0',
    bestFor: 'Mystery facts, Reddit stories, plot twists',
    downloadUrl: 'https://incompetech.com/music/royalty-free/music.html',
    mixPreset: { audioBaseVol: 16, audioPeakVol: 76, riserDurationSec: 4 },
    previewTone: { notes: [196, 207, 233, 196], tempoMs: 250, wave: 'sine' },
  },
  {
    id: 'bgm-pixabay-dark-tension',
    title: 'Dark Cinematic Tension Pulse',
    artist: 'Pixabay Horror / Thriller',
    mood: 'suspense',
    trending: true,
    bpm: 90,
    source: 'Pixabay Music (YouTube Safe)',
    license: 'No Attribution (YT Safe)',
    bestFor: 'True crime, shocking facts, thriller hooks',
    downloadUrl: 'https://pixabay.com/music/search/suspense%20cinematic/',
    mixPreset: { audioBaseVol: 18, audioPeakVol: 82, riserDurationSec: 5 },
    previewTone: { notes: [110, 116, 110, 103], tempoMs: 300, wave: 'sawtooth' },
  },

  /* --- MOTIVATIONAL / PODCAST / TED --- */
  {
    id: 'bgm-scott-titan',
    title: 'Titan / Epic Cinematic Build',
    artist: 'Scott Buckley',
    mood: 'motivational',
    trending: true,
    bpm: 88,
    source: 'Scott Buckley (CC BY 4.0)',
    license: 'CC BY (Credit in Description)',
    attributionText: 'Music: "Titan" by Scott Buckley (www.scottbuckley.com.au)',
    bestFor: 'TED talks, podcast wisdom, mindset & discipline clips',
    downloadUrl: 'https://www.scottbuckley.com.au/library/titan/',
    mixPreset: { audioBaseVol: 15, audioPeakVol: 86, riserDurationSec: 6 },
    previewTone: { notes: [220, 293, 330, 440], tempoMs: 280, wave: 'triangle' },
  },
  {
    id: 'bgm-yt-arms-of-heaven',
    title: 'Arms of Heaven',
    artist: 'Aakash Gandhi',
    mood: 'motivational',
    trending: true,
    bpm: 78,
    source: 'YouTube Audio Library',
    license: 'No Attribution (YT Safe)',
    bestFor: 'Inspirational speeches, finance & founder podcasts',
    downloadUrl: 'https://studio.youtube.com/channel/UC/music',
    mixPreset: { audioBaseVol: 16, audioPeakVol: 80, riserDurationSec: 5.5 },
    previewTone: { notes: [261, 330, 392, 494], tempoMs: 320, wave: 'sine' },
  },
];

export function filterMusicCatalog(
  mood: MusicMoodId,
  viralOnly: boolean,
  query = ''
): CopyrightFreeTrack[] {
  const q = query.trim().toLowerCase();
  return COPYRIGHT_FREE_MUSIC_CATALOG.filter((track) => {
    if (mood !== 'all' && track.mood !== mood) return false;
    if (viralOnly && !track.trending) return false;
    if (!q) return true;
    return `${track.title} ${track.artist} ${track.bestFor} ${track.source}`
      .toLowerCase()
      .includes(q);
  });
}

let previewCtx: AudioContext | null = null;

/** Auditions a short 1.2s mood-matched Web Audio cadence so creators can feel the track vibe live */
export function auditionTrackMood(track: CopyrightFreeTrack): void {
  if (typeof window === 'undefined') return;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!previewCtx) previewCtx = new Ctor();
  if (previewCtx.state === 'suspended') {
    previewCtx.resume().catch(() => {});
  }
  const now = previewCtx.currentTime;
  const step = track.previewTone.tempoMs / 1000;
  track.previewTone.notes.forEach((freq, idx) => {
    if (!previewCtx) return;
    const osc = previewCtx.createOscillator();
    const gain = previewCtx.createGain();
    osc.type = track.previewTone.wave;
    osc.frequency.setValueAtTime(freq, now + idx * step);
    gain.gain.setValueAtTime(0.0001, now + idx * step);
    gain.gain.linearRampToValueAtTime(0.08, now + idx * step + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (idx + 1) * step);
    osc.connect(gain);
    gain.connect(previewCtx.destination);
    osc.start(now + idx * step);
    osc.stop(now + (idx + 1) * step + 0.02);
  });
}

/* -------------------------------------------------------------------------- */
/* 5. Trending Hashtags Engine (Grouped by Video Type)                        */
/* -------------------------------------------------------------------------- */

export type VideoNicheId =
  | 'youtube-general'
  | 'podcast-talk'
  | 'gaming-stream'
  | 'motivation'
  | 'comedy-reaction'
  | 'tech-ai'
  | 'finance-business'
  | 'storytime-facts'
  | 'fitness-sports';

export interface HashtagPack {
  id: VideoNicheId;
  label: string;
  description: string;
  /** High-velocity core tags (pick 3–5 for YouTube Shorts) */
  topViral: string[];
  /** Targeted niche discovery tags */
  nicheTags: string[];
}

export const TRENDING_HASHTAG_PACKS: readonly HashtagPack[] = [
  {
    id: 'youtube-general',
    label: 'YT Shorts Viral',
    description: 'High-reach YouTube Shorts discovery mix',
    topViral: ['shorts', 'youtubeshorts', 'viral', 'trending', 'fyp'],
    nicheTags: ['shortvideo', 'mustwatch', 'clip', 'explore', 'dailyshorts'],
  },
  {
    id: 'podcast-talk',
    label: 'Podcast & Talks',
    description: 'TED Talks, interviews, speaking & deep conversations',
    topViral: ['shorts', 'podcast', 'podcastclips', 'interview', 'communication'],
    nicheTags: ['publicspeaking', 'wisdom', 'lifeadvice', 'tedtalk', 'deepthoughts'],
  },
  {
    id: 'gaming-stream',
    label: 'Gaming & Streamer',
    description: 'Kick, Twitch & YouTube live stream highlights',
    topViral: ['shorts', 'gaming', 'streamer', 'twitchclips', 'kickclips'],
    nicheTags: ['livestream', 'clutch', 'gamingshorts', 'funnygaming', 'rage'],
  },
  {
    id: 'motivation',
    label: 'Motivation & Mindset',
    description: 'Discipline, self-improvement & success habits',
    topViral: ['shorts', 'motivation', 'mindset', 'selfimprovement', 'discipline'],
    nicheTags: ['success', 'growthmindset', 'habits', 'focus', 'dailyinspiration'],
  },
  {
    id: 'comedy-reaction',
    label: 'Comedy & Reactions',
    description: 'Funny clips, pranks, drama & streamer reactions',
    topViral: ['shorts', 'funny', 'comedy', 'reaction', 'relatable'],
    nicheTags: ['funnyclips', 'memes', 'laugh', 'waitforit', 'plottwist'],
  },
  {
    id: 'tech-ai',
    label: 'Tech & AI',
    description: 'Software, gadgets, coding & AI breakdowns',
    topViral: ['shorts', 'tech', 'ai', 'coding', 'futuretech'],
    nicheTags: ['aitools', 'technews', 'developer', 'gadgets', 'innovation'],
  },
  {
    id: 'finance-business',
    label: 'Finance & Business',
    description: 'Entrepreneurship, investing & money lessons',
    topViral: ['shorts', 'business', 'finance', 'entrepreneur', 'investing'],
    nicheTags: ['wealth', 'sidehustle', 'startup', 'moneytips', 'marketing'],
  },
  {
    id: 'storytime-facts',
    label: 'Storytime & Facts',
    description: 'Psychology facts, Reddit stories & mysteries',
    topViral: ['shorts', 'facts', 'storytime', 'didyouknow', 'psychology'],
    nicheTags: ['mindblown', 'interestingfacts', 'truefacts', 'history', 'mystery'],
  },
  {
    id: 'fitness-sports',
    label: 'Fitness & Sports',
    description: 'Gym PRs, highlights & athletic training',
    topViral: ['shorts', 'fitness', 'gym', 'workout', 'sports'],
    nicheTags: ['gymmotivation', 'athlete', 'training', 'highlights', 'physique'],
  },
];

export function detectVideoNiche(title: string, description = '', platform = ''): VideoNicheId {
  const hay = `${title} ${description} ${platform}`.toLowerCase();
  if (/\b(kick|twitch|gta|valorant|fortnite|minecraft|clutch|stream|streamer|gamer|gaming|fps)\b/.test(hay)) {
    return 'gaming-stream';
  }
  if (/\b(ted|speak|speaking|podcast|interview|host|guest|conversation|advice|lesson)\b/.test(hay)) {
    return 'podcast-talk';
  }
  if (/\b(discipline|mindset|motivation|motivational|habit|habits|success|grind|focus|stoic)\b/.test(hay)) {
    return 'motivation';
  }
  if (/\b(ai|gpt|code|coding|tech|iphone|app|software|robot|gpu)\b/.test(hay)) {
    return 'tech-ai';
  }
  if (/\b(money|stock|stocks|crypto|business|startup|million|invest|investing|wealth|rich)\b/.test(hay)) {
    return 'finance-business';
  }
  if (/\b(gym|workout|lift|football|nba|ufc|soccer|fitness|boxing)\b/.test(hay)) {
    return 'fitness-sports';
  }
  if (/\b(fact|facts|reddit|story|storytime|mystery|secret|history|psychology)\b/.test(hay)) {
    return 'storytime-facts';
  }
  if (/\b(funny|prank|react|reaction|laugh|meme|memes|fail|roast|comedy)\b/.test(hay)) {
    return 'comedy-reaction';
  }
  return 'youtube-general';
}

export function getHashtagPack(niche: VideoNicheId): HashtagPack {
  return TRENDING_HASHTAG_PACKS.find((p) => p.id === niche) ?? TRENDING_HASHTAG_PACKS[0];
}
