import type {
  AspectRatioId,
  CanvasModeId,
  FacecamPlacementId,
  FacecamSourceBox,
  FrameAspectId,
  HeadlineLayoutStyleId,
  LayoutModeId,
  ResolvedSafeZonePlatformId,
  SpeakerCropSet,
  StreamerPlatformId,
  SubtitleBgStyleId,
  ViralCaptionPresetId,
  WatermarkPositionId,
} from './types';

export type TemplateCategory =
  | 'All'
  | 'Platforms'
  | 'Streamer Clips'
  | 'Viral Hooks'
  | 'Podcasts & X'
  | 'ClipShip';

export interface TemplatePreset {
  id: string;
  /** Canonical short label used consistently across Dashboard, Clips Batch Drawer, and Editor */
  name: string;
  /** Full descriptive name for the Template Library modal */
  fullName: string;
  category: Exclude<TemplateCategory, 'All'>;
  description: string;
  featured: boolean;
  defaultLayout: LayoutModeId;
  defaultCaptionStyle: ViralCaptionPresetId;
  defaultSafeZone: ResolvedSafeZonePlatformId;
  defaultHeadlineFont: string;
  defaultSubtitleFont: string;
  defaultHeadlineLayout: HeadlineLayoutStyleId;
  defaultSubtitleBg: SubtitleBgStyleId;
  defaultStreamerPlatform: StreamerPlatformId;
  defaultOuterFill?: string;
  defaultCornerRadius?: number;
  hasCard: boolean;
  hasHeadline: boolean;
  hasTicker: boolean;
  accentHex: string;
  wireframe:
    | 'kick'
    | 'insta'
    | 'yt-short'
    | 'split'
    | 'pip'
    | 'story'
    | 'podcast'
    | 'social'
    | 'plain'
    | 'clipship';
}

/** The 13 bundled ClipShip overlay templates (1080x1920, alpha-measured cutouts). */
const CLIPSHIP_FOLDERS = [
  ['clipship-01', 'ClipShip Tweet Dark'],
  ['clipship-02', 'ClipShip Tweet Light'],
  ['clipship-03', 'ClipShip Tweet + Reply'],
  ['clipship-04', 'ClipShip Big Meme'],
  ['clipship-05', 'ClipShip White Meme'],
  ['clipship-06', 'ClipShip Stacked'],
  ['clipship-07', 'ClipShip Comment Reply'],
  ['clipship-08', 'ClipShip News Card'],
  ['clipship-09', 'ClipShip Fullscreen Text'],
  ['clipship-10', 'ClipShip Reddit Thread'],
  ['clipship-11', 'ClipShip Condensed Headline'],
  ['clipship-12', 'ClipShip Collage Pill'],
  ['clipship-13', 'ClipShip Reaction Split'],
] as const;

const CLIPSHIP_PRESET_ENTRIES: readonly TemplatePreset[] = CLIPSHIP_FOLDERS.map(
  ([id, name], i) => ({
    id,
    name,
    fullName: name,
    category: 'ClipShip',
    description:
      'ClipShip 1080x1920 overlay: full 16:9 stage frame preserved, blurred fill, custom page header (no Clip Ship watermark), lowercase hook text and synced lyric subtitles.',
    featured: false,
    defaultLayout: (i === 5 || i === 11 ? 'split' : 'solo') as LayoutModeId,
    defaultCaptionStyle: 'podcast-pill' as ViralCaptionPresetId,
    defaultSafeZone: 'universal' as ResolvedSafeZonePlatformId,
    defaultHeadlineFont: 'Anton',
    defaultSubtitleFont: 'Montserrat',
    defaultHeadlineLayout: 'white-stepped',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'youtube',
    defaultOuterFill: '#000000',
    defaultCornerRadius: 0,
    hasCard: i !== 6 && i !== 8,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#E8851A',
    wireframe: 'clipship',
  })
);

/**
 * Single Shared Viral Preset Registry — strictly curated around real, currently trending
 * YouTube Shorts, Instagram Reels, TikTok, and Kick clip formats (zero dated slop).
 */
export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  /* ---------- Default Generic Short (White Title + Yellow Subtitles) ---------- */
  {
    id: 'default',
    name: 'Classic Short',
    fullName: 'Classic Short (White Title · Yellow Subs)',
    category: 'Viral Hooks',
    description:
      'Universal viral short format: bold white top title with crisp black outline, yellow word-synced subtitles, and zero forced platform branding.',
    featured: true,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'hormozi-classic',
    defaultSafeZone: 'universal',
    defaultHeadlineFont: 'Montserrat',
    defaultSubtitleFont: 'Montserrat',
    defaultHeadlineLayout: 'outline-only',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'none',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#FFE600',
    wireframe: 'plain',
  },
  /* ---------- 3 First-Class Platform Viral Templates ---------- */
  {
    id: 'kick-stream',
    name: 'Kick Viral',
    fullName: 'Kick Viral Clip',
    category: 'Platforms',
    description:
      'Authentic viral Kick clip: full-bleed vertical, stepped white hook box on top, small green K logo + streamer name, and outlined @watermark.',
    featured: true,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'kick-neon',
    defaultSafeZone: 'universal',
    defaultHeadlineFont: 'TikTok Sans',
    defaultSubtitleFont: 'Montserrat',
    defaultHeadlineLayout: 'white-stepped',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'kick',
    defaultOuterFill: '#0B0E0F',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#53FC18',
    wireframe: 'kick',
  },
  {
    id: 'insta-short',
    name: 'Insta Reels',
    fullName: 'Instagram Reels Viral',
    category: 'Platforms',
    description:
      'Current Reels format: full-bleed 9:16 with native stepped white hook label, compact IG icon + username credit, and IG safe-zone pacing.',
    featured: true,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'podcast-pill',
    defaultSafeZone: 'instagram-reels',
    defaultHeadlineFont: 'TikTok Sans',
    defaultSubtitleFont: 'Poppins',
    defaultHeadlineLayout: 'white-stepped',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'instagram',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#E1306C',
    wireframe: 'insta',
  },
  {
    id: 'yt-short',
    name: 'YT Shorts',
    fullName: 'YouTube Shorts Viral',
    category: 'Platforms',
    description:
      'High-retention Shorts cut: stepped top hook below 288px safe line, Hormozi yellow-pop captions, and compact YT Shorts icon + channel credit.',
    featured: true,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'hormozi-classic',
    defaultSafeZone: 'youtube-shorts',
    defaultHeadlineFont: 'Montserrat',
    defaultSubtitleFont: 'Montserrat',
    defaultHeadlineLayout: 'white-stepped',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'youtube',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#FF0033',
    wireframe: 'yt-short',
  },
  /* ---------- Real Modern Viral Shorts / Reels / Streamer Formats ---------- */
  {
    id: 'split-stream',
    name: 'Split Cam',
    fullName: 'Split Facecam + Gameplay',
    category: 'Streamer Clips',
    description:
      'Classic 50/50 streamer vertical split (facecam top, gameplay/clip bottom) with bold center word-pop captions and streamer attribution.',
    featured: true,
    defaultLayout: 'split',
    defaultCaptionStyle: 'hormozi-classic',
    defaultSafeZone: 'universal',
    defaultHeadlineFont: 'Montserrat',
    defaultSubtitleFont: 'Montserrat',
    defaultHeadlineLayout: 'none',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'kick',
    defaultOuterFill: '#0B0E0F',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: false,
    hasTicker: false,
    accentHex: '#53FC18',
    wireframe: 'split',
  },
  {
    id: 'reaction-pip',
    name: 'Reaction PiP',
    fullName: 'Clipper Reaction PiP',
    category: 'Streamer Clips',
    description:
      'Full-bleed clip with clean corner reaction facecam overlay, bold comic/Hormozi captions, and creator credit.',
    featured: true,
    defaultLayout: 'pip',
    defaultCaptionStyle: 'beast-comic',
    defaultSafeZone: 'youtube-shorts',
    defaultHeadlineFont: 'Anton',
    defaultSubtitleFont: 'Bangers',
    defaultHeadlineLayout: 'outline-only',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'youtube',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#F97316',
    wireframe: 'pip',
  },
  {
    id: 'storytime-hook',
    name: 'Story Hook',
    fullName: 'Storytime & Drama Hook',
    category: 'Viral Hooks',
    description:
      'Viral commentary/drama layout: multi-line white rounded hook label on top paired with punchy 1-word center slams.',
    featured: true,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'one-word-punch',
    defaultSafeZone: 'universal',
    defaultHeadlineFont: 'TikTok Sans',
    defaultSubtitleFont: 'Anton',
    defaultHeadlineLayout: 'white-stepped',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'none',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#FFE600',
    wireframe: 'story',
  },
  {
    id: 'podcast_split',
    name: 'Podcast Cut',
    fullName: 'Podcast 2-Shot Viral Cut',
    category: 'Podcasts & X',
    description:
      'Modern podcast vertical format (JRE / Diary of a CEO style) with clean active-pill captions and subtle channel credit.',
    featured: true,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'podcast-pill',
    defaultSafeZone: 'youtube-shorts',
    defaultHeadlineFont: 'Montserrat',
    defaultSubtitleFont: 'TikTok Sans',
    defaultHeadlineLayout: 'none',
    defaultSubtitleBg: 'active-box',
    defaultStreamerPlatform: 'youtube',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: false,
    hasTicker: false,
    accentHex: '#3B82F6',
    wireframe: 'podcast',
  },
  {
    id: 'x_light',
    name: 'X / Tweet Card',
    fullName: 'X / Tweet Header Overlay',
    category: 'Podcasts & X',
    description:
      'Real light-mode X post header card pinned cleanly above vertical footage — dominant format for clips and hot takes.',
    featured: true,
    defaultLayout: 'centered',
    defaultCaptionStyle: 'podcast-pill',
    defaultSafeZone: 'instagram-reels',
    defaultHeadlineFont: 'Poppins',
    defaultSubtitleFont: 'TikTok Sans',
    defaultHeadlineLayout: 'none',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'none',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 12,
    hasCard: true,
    hasHeadline: false,
    hasTicker: false,
    accentHex: '#E4E4E7',
    wireframe: 'social',
  },
  /* ---------- Additional Real Viral Formats in Full Library Modal ---------- */
  {
    id: 'dark_stepped',
    name: 'Dark Hook',
    fullName: 'Dark Stepped Hook Pill',
    category: 'Viral Hooks',
    description:
      'Inverted TikTok/Reels native dark stepped label on top for bright daylight footage and street interviews.',
    featured: false,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'hormozi-classic',
    defaultSafeZone: 'instagram-reels',
    defaultHeadlineFont: 'TikTok Sans',
    defaultSubtitleFont: 'Montserrat',
    defaultHeadlineLayout: 'dark-stepped',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'instagram',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#18181B',
    wireframe: 'story',
  },
  {
    id: 'reddit_story',
    name: 'Reddit Hook',
    fullName: 'Reddit / Storytime Card',
    category: 'Podcasts & X',
    description:
      'Viral Reddit thread title header card paired with rapid 1-word bold center captions over gameplay or B-roll.',
    featured: false,
    defaultLayout: 'centered',
    defaultCaptionStyle: 'one-word-punch',
    defaultSafeZone: 'youtube-shorts',
    defaultHeadlineFont: 'Poppins',
    defaultSubtitleFont: 'Anton',
    defaultHeadlineLayout: 'none',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'none',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 12,
    hasCard: true,
    hasHeadline: false,
    hasTicker: false,
    accentHex: '#FF4500',
    wireframe: 'social',
  },
  {
    id: 'dual_react',
    name: 'Dual Split',
    fullName: 'Dual Creator Split React',
    category: 'Streamer Clips',
    description:
      'Two-frame stacked vertical reaction format with stepped top context hook and Kick/YouTube streamer credit.',
    featured: false,
    defaultLayout: 'split',
    defaultCaptionStyle: 'kick-neon',
    defaultSafeZone: 'universal',
    defaultHeadlineFont: 'TikTok Sans',
    defaultSubtitleFont: 'Archivo Black',
    defaultHeadlineLayout: 'white-stepped',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'kick',
    defaultOuterFill: '#0B0E0F',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: true,
    hasTicker: false,
    accentHex: '#53FC18',
    wireframe: 'split',
  },

  /* ---------- 13 ClipShip overlay templates ---------- */
  ...CLIPSHIP_PRESET_ENTRIES,
] as const;

/** ClipShip-only subset for the dedicated Framing Studio strip. */
export const CLIPSHIP_PRESETS: readonly TemplatePreset[] = TEMPLATE_PRESETS.filter(
  (t) => t.category === 'ClipShip'
);

export const FEATURED_PRESETS: readonly TemplatePreset[] = TEMPLATE_PRESETS.filter((t) => t.featured);

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  'All',
  'Platforms',
  'Streamer Clips',
  'Viral Hooks',
  'Podcasts & X',
];

/** Map any legacy template IDs cleanly to their modern viral equivalent */
const LEGACY_TEMPLATE_MAP: Record<string, string> = {
  tiktok_hook: 'storytime-hook',
  gaming_reaction: 'split-stream',
  editorial_quote: 'insta-short',
  street_bold: 'yt-short',
  news_ticker: 'yt-short',
  minimal_gradient: 'default',
};

export function getTemplatePreset(id: string): TemplatePreset {
  const mappedId = LEGACY_TEMPLATE_MAP[id] || id;
  return (
    TEMPLATE_PRESETS.find((t) => t.id === mappedId) ??
    TEMPLATE_PRESETS.find((t) => t.id === 'default') ??
    TEMPLATE_PRESETS[0]
  );
}

export const ASPECT_RATIOS: readonly { id: AspectRatioId; label: string; dimensions: string }[] = [
  { id: '9:16', label: '9:16', dimensions: '1080 × 1920' },
  { id: '4:5', label: '4:5', dimensions: '1080 × 1350' },
  { id: '1:1', label: '1:1', dimensions: '1080 × 1080' },
  { id: '16:9', label: '16:9', dimensions: '1920 × 1080' },
  { id: '4:3', label: '4:3', dimensions: '1440 × 1080' },
];

/** All 6 studio framing layouts */
export const LAYOUT_MODES: readonly {
  id: LayoutModeId;
  label: string;
  badge: string;
  description: string;
}[] = [
  {
    id: 'split',
    label: 'Split',
    badge: 'Dual 9:8 Split (2 Speakers)',
    description: '2 draggable speaker crops stacked top & bottom',
  },
  {
    id: 'solo',
    label: 'Solo',
    badge: 'Single 9:16 Speaker',
    description: '1 tracked speaker crop filling vertical canvas',
  },
  {
    id: 'trio',
    label: 'Trio',
    badge: '3-Speaker Podcast Trio',
    description: '3 speaker boxes (2 top + 1 bottom) on 9:16',
  },
  {
    id: 'pip',
    label: 'PiP',
    badge: 'Reaction PiP (Main + Cam)',
    description: 'Primary video with draggable facecam overlay',
  },
  {
    id: 'centered',
    label: 'Centered',
    badge: 'Framed 16:9 Card',
    description: '16:9 footage centered on styled outer backdrop',
  },
  {
    id: 'widescreen',
    label: '16:9 Clip',
    badge: 'Widescreen 16:9',
    description: 'Full horizontal 16:9 clip without vertical crop',
  },
];

export const CANVAS_MODES: readonly { id: CanvasModeId; label: string }[] = [
  { id: 'solid', label: 'Color' },
  { id: 'blur', label: 'Blur' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'padding', label: 'Padding' },
  { id: 'image', label: 'Image' },
];

export const CORNER_RADIUS_PRESETS: readonly { value: number; label: string }[] = [
  { value: 0, label: '0px Sharp' },
  { value: 8, label: '8px Subtle' },
  { value: 16, label: '16px Rounded' },
  { value: 24, label: '24px Soft Card' },
  { value: 32, label: '32px Deep' },
];

export const FRAME_PADDING_PRESETS: readonly { value: number; label: string }[] = [
  { value: 0, label: '0px Full' },
  { value: 8, label: '8px Tight' },
  { value: 16, label: '16px Inset' },
  { value: 24, label: '24px Framed' },
  { value: 36, label: '36px Poster' },
];

export const GRADIENT_PRESETS: readonly { id: string; label: string; css: string }[] = [
  { id: 'obsidian', label: 'Obsidian', css: 'linear-gradient(160deg, #18181B 0%, #09090B 100%)' },
  { id: 'midnight', label: 'Midnight', css: 'linear-gradient(160deg, #0F172A 0%, #020617 100%)' },
  { id: 'emerald', label: 'Studio Moss', css: 'linear-gradient(160deg, #052E16 0%, #09090B 100%)' },
  { id: 'crimson', label: 'Deep Ember', css: 'linear-gradient(160deg, #450A0A 0%, #09090B 100%)' },
  { id: 'paper', label: 'Studio Light', css: 'linear-gradient(160deg, #F4F4F5 0%, #E4E4E7 100%)' },
];

export const DEFAULT_SPEAKER_CROPS: SpeakerCropSet = {
  primary: { x: 4, y: 12, width: 44, height: 76 },
  secondary: { x: 52, y: 12, width: 44, height: 76 },
  tertiary: { x: 28, y: 50, width: 44, height: 46 },
};

export const WATERMARK_POSITIONS: readonly { value: WatermarkPositionId; label: string; x: number; y: number }[] = [
  { value: 'bottom-center', label: 'Bottom Center', x: 50, y: 76 },
  { value: 'bottom-right', label: 'Bottom-Right', x: 80, y: 88 },
  { value: 'bottom-left', label: 'Bottom-Left', x: 22, y: 88 },
  { value: 'top-right', label: 'Top-Right', x: 80, y: 12 },
  { value: 'top-left', label: 'Top-Left', x: 22, y: 12 },
];

export const HEADLINE_LAYOUT_OPTIONS: readonly { value: HeadlineLayoutStyleId; label: string }[] = [
  { value: 'white-stepped', label: 'Stepped White Pill (Viral)' },
  { value: 'dark-stepped', label: 'Stepped Dark Pill' },
  { value: 'solid-banner', label: 'Dark Translucent Banner' },
  { value: 'outline-only', label: 'Bold Outline (No Box)' },
  { value: 'none', label: 'Hidden' },
];

export const SUBTITLE_BG_OPTIONS: readonly { value: SubtitleBgStyleId; label: string }[] = [
  { value: 'none', label: 'Outline / Clean (Default)' },
  { value: 'white-stepped', label: 'Stepped White Pill' },
  { value: 'dark-pill', label: 'Dark Frosted Pill' },
  { value: 'active-box', label: 'Active Word Box' },
];

export const STREAMER_PLATFORM_OPTIONS: readonly { value: StreamerPlatformId; label: string }[] = [
  { value: 'auto', label: 'Auto (Match Template)' },
  { value: 'kick', label: 'Kick Logo' },
  { value: 'instagram', label: 'Instagram Logo' },
  { value: 'youtube', label: 'YT Shorts Logo' },
  { value: 'none', label: 'Text Only (No Logo)' },
];

export const DEFAULT_FACECAM_SOURCE_BOX: FacecamSourceBox = {
  x: 70,
  y: 66,
  width: 28,
  height: 30,
};

export const FACECAM_PLACEMENT_OPTIONS: readonly {
  value: FacecamPlacementId;
  label: string;
  shortLabel: string;
}[] = [
  { value: 'bottom', label: 'Bottom Overlay (PiP)', shortLabel: 'Bottom' },
  { value: 'top', label: 'Top Overlay (PiP)', shortLabel: 'Top' },
  { value: 'split-bottom', label: 'Split Screen (Cam Bottom)', shortLabel: 'Split Bot' },
  { value: 'split-top', label: 'Split Screen (Cam Top)', shortLabel: 'Split Top' },
  { value: 'pip-free', label: 'Free Drag PiP', shortLabel: 'Free PiP' },
];

export const FRAME_ASPECT_OPTIONS: readonly { value: FrameAspectId; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
];

export const FACECAM_CORNER_PRESETS: readonly { label: string; box: FacecamSourceBox }[] = [
  { label: 'Bottom-Right', box: { x: 70, y: 66, width: 28, height: 30 } },
  { label: 'Bottom-Left', box: { x: 2, y: 66, width: 28, height: 30 } },
  { label: 'Top-Right', box: { x: 70, y: 4, width: 28, height: 30 } },
  { label: 'Top-Left', box: { x: 2, y: 4, width: 28, height: 30 } },
  { label: 'Center', box: { x: 34, y: 24, width: 32, height: 48 } },
];

export const OUTER_FILL_SWATCHES: readonly { hex: string; label: string }[] = [
  { hex: '#000000', label: 'Pure Black' },
  { hex: '#09090B', label: 'Obsidian' },
  { hex: '#141417', label: 'Carbon' },
  { hex: '#0F172A', label: 'Deep Slate' },
  { hex: '#14261C', label: 'Studio Moss' },
  { hex: '#2A1215', label: 'Deep Ember' },
  { hex: '#E7E5E0', label: 'Warm Paper' },
  { hex: '#FAFAFA', label: 'Studio White' },
];

export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
