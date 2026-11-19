import type {
  AspectRatioId,
  CanvasModeId,
  FacecamPlacementId,
  FacecamSourceBox,
  FrameAspectId,
  HeadlineLayoutStyleId,
  LayoutModeId,
  ResolvedSafeZonePlatformId,
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
  | 'Podcasts & X';

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
    | 'plain';
}

/**
 * Single Shared Viral Preset Registry — strictly curated around real, currently trending
 * YouTube Shorts, Instagram Reels, TikTok, and Kick clip formats (zero dated slop).
 */
export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
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
    accentHex: '#22C55E',
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
  {
    id: 'default',
    name: 'Raw Captions',
    fullName: 'Raw 9:16 (Captions Only)',
    category: 'Viral Hooks',
    description:
      'Clean full-bleed vertical cut with crisp word-synced viral captions and zero extra overlays.',
    featured: true,
    defaultLayout: 'solo',
    defaultCaptionStyle: 'hormozi-classic',
    defaultSafeZone: 'universal',
    defaultHeadlineFont: 'Montserrat',
    defaultSubtitleFont: 'Montserrat',
    defaultHeadlineLayout: 'none',
    defaultSubtitleBg: 'none',
    defaultStreamerPlatform: 'none',
    defaultOuterFill: '#09090B',
    defaultCornerRadius: 0,
    hasCard: false,
    hasHeadline: false,
    hasTicker: false,
    accentHex: '#A1A1AA',
    wireframe: 'plain',
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
] as const;

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
  { id: '1:1', label: '1:1', dimensions: '1080 × 1080' },
  { id: '16:9', label: '16:9', dimensions: '1920 × 1080' },
];

/** Composition layouts only — aspect ratios belong exclusively in ASPECT_RATIOS */
export const LAYOUT_MODES: readonly { id: LayoutModeId; label: string; description: string }[] = [
  { id: 'solo', label: 'Solo', description: 'Full-bleed tracked vertical speaker frame' },
  { id: 'pip', label: 'PiP', description: 'Primary clip with corner facecam PiP' },
  { id: 'split', label: 'Split', description: '50/50 stacked facecam + gameplay split' },
  { id: 'centered', label: 'Centered', description: 'Framed 16:9 clip on clean backdrop' },
];

export const CANVAS_MODES: readonly { id: CanvasModeId; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'blur', label: 'Blur' },
  { id: 'padding', label: 'Padding' },
];

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
  { hex: '#0B0E0F', label: 'Kick Charcoal' },
  { hex: '#09090B', label: 'Obsidian' },
  { hex: '#141417', label: 'Carbon' },
  { hex: '#1E2128', label: 'Deep Slate' },
  { hex: '#E7E5E0', label: 'Warm Paper' },
  { hex: '#FAFAFA', label: 'Studio White' },
];

export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
