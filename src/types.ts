export type PageId = 'dashboard' | 'clips' | 'editor';

export type EditorTabId = 'framing' | 'templates' | 'text' | 'media';
export type TextSubtabId = 'headline' | 'subs';
export type StageViewModeId = 'framing' | 'editor';

export type AspectRatioId = '9:16' | '4:5' | '1:1' | '16:9';
export type LayoutModeId = 'split' | 'solo' | 'trio' | 'pip' | 'centered' | 'widescreen';
export type CanvasModeId = 'solid' | 'blur' | 'gradient' | 'padding' | 'image';
export type FacecamPlacementId = 'bottom' | 'top' | 'split-top' | 'split-bottom' | 'pip-free';
export type FrameAspectId = '9:16' | '4:3' | '16:9' | '1:1';
export type VideoFitId = 'cover' | 'contain';
export type SpeakerCropKey = 'primary' | 'secondary' | 'tertiary';

export interface FacecamSourceBox {
  /** Left edge in % of the source 16:9 video width (0..88) */
  x: number;
  /** Top edge in % of the source 16:9 video height (0..88) */
  y: number;
  /** Width in % of the source 16:9 video width (12..100) */
  width: number;
  /** Height in % of the source 16:9 video height (12..100) */
  height: number;
}

export interface SpeakerCropSet {
  /** Top Speaker (Split), Top-Left (Trio), or Main Speaker (Solo) */
  primary: FacecamSourceBox;
  /** Bottom Speaker (Split) or Top-Right (Trio) */
  secondary: FacecamSourceBox;
  /** Bottom Speaker (Trio) */
  tertiary: FacecamSourceBox;
}

export interface SavedStylePreset {
  id: string;
  name: string;
  layout: LayoutModeId;
  aspect: AspectRatioId;
  canvas: CanvasModeId;
  cornerRadius: number;
  framePadding: number;
  outerFill: string;
  outerFillActive: boolean;
  outerGradient: string;
  playbackSpeed: number;
}

export interface TrackStates {
  ccVisible: boolean;
  v1Visible: boolean;
  a1Muted: boolean;
  a2Muted: boolean;
}

export type ViralCaptionPresetId =
  | 'hormozi-classic'
  | 'beast-comic'
  | 'kick-neon'
  | 'one-word-punch'
  | 'podcast-pill'
  | 'editorial-aesthetic'
  | 'breaking-news';

/** Supports both new viral preset IDs and legacy backend identifiers seamlessly */
export type CaptionStyleId = ViralCaptionPresetId | 'karaoke' | 'bold' | 'box' | 'accent';

export type WordPacingId = '1' | '2-3' | '4-5';
export type CaptionAnimationId =
  | 'none'
  | 'pop-scale'
  | 'karaoke-fill'
  | 'slide-up'
  | 'box-highlight';

export type HeadlineLayoutStyleId =
  | 'white-stepped'
  | 'dark-stepped'
  | 'solid-banner'
  | 'outline-only'
  | 'none';

export type SubtitleBgStyleId = 'none' | 'white-stepped' | 'dark-pill' | 'active-box';
export type TextAlignId = 'left' | 'center' | 'right';
export type StreamerPlatformId = 'auto' | 'kick' | 'instagram' | 'youtube' | 'none';

export type SafeZonePlatformId = 'auto' | 'youtube-shorts' | 'instagram-reels' | 'universal';
export type ResolvedSafeZonePlatformId = Exclude<SafeZonePlatformId, 'auto'>;

export type FontCategoryId = 'Viral' | 'Comic' | 'Hook' | 'Social' | 'Editorial' | 'Custom';

export type TextCasingId = 'asis' | 'upper' | 'title';
export type CardThemeId = 'light' | 'dark';
export type WatermarkPositionId = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center' | 'custom';
export type KickBadgeMode = 'none' | 'CLIP' | 'LIVE';
export type KickHandleFormat = 'name' | 'url' | 'at';

export type ClipStatus = 'Ready' | 'Approved' | 'Rejected';
export type ClipStatusFilter = 'all' | ClipStatus;

export type JobStatus = 'queued' | 'downloading' | 'clipping' | 'rendering' | 'done' | 'error';

export type SourcePlatform = 'YouTube' | 'Twitch' | 'Kick' | 'Instagram' | 'Local' | 'Direct';

export interface WordCue {
  start_ms: number;
  end_ms: number;
  text: string;
  /** Optional per-word emphasis overrides indexed by token index inside `text` */
  wordEmphasis?: Record<number, string>;
}

export interface CustomFontEntry {
  id: string;
  family: string;
  fileName: string;
  category: 'Custom';
}

export interface ClipItem {
  id: string;
  title: string;
  template: string;
  status: ClipStatus;
  confidence: number;
  channel: string;
  /** Detected or manually overridden streamer username for `[Logo] USERNAME` attribution */
  streamerHandle?: string;
  platform: SourcePlatform;
  duration_sec: number;
  description: string;
  transcript_snippet: string;
  hashtags: string[];
  created_at_ms: number;
  aspect: AspectRatioId;
  layout: LayoutModeId;
  caption_style: CaptionStyleId;
  canvas?: CanvasModeId;
  font?: string;
  subtitleFont?: string;
  outroText?: string;
  audioPeak?: boolean;
  previewImage?: string;
  mediaUrl?: string;
  words: WordCue[];
}

export interface JobItem {
  id: string;
  url: string;
  sourceTitle: string;
  streamerHandle?: string;
  platform: SourcePlatform;
  template: string;
  maxClips: number;
  burnCaptions: boolean;
  status: JobStatus;
  progress: number;
  message: string;
  clip_ids: string[];
  created_at_ms: number;
}

export interface BrandKit {
  handle: string;
  displayName: string;
  verified: boolean;
  defaultOutro: string;
  watermarkPosition: WatermarkPositionId;
  watermarkOpacity: number;
  showWatermark: boolean;
}

export interface EditorSettings {
  template: string;
  templateEnabled: boolean;
  aspect: AspectRatioId;
  layout: LayoutModeId;
  canvas: CanvasModeId;
  cornerRadius: number;
  framePadding: number;
  outerFill: string;
  outerFillActive: boolean;
  outerGradient: string;
  bgImageUrl: string;
  bgImageBlur: number;
  bgImageDim: number;
  cardTheme: CardThemeId;
  pinnedStatement: string;
  playbackSpeed: number;

  /* Multi-Speaker Framing Crop Regions (Solo / Split / Trio interactive canvas boxes) */
  speakerCrops: SpeakerCropSet;

  /* Reaction PiP / Streamer Facecam Crop & Output Placement */
  facecamEnabled: boolean;
  facecamSourceBox: FacecamSourceBox;
  facecamPlacement: FacecamPlacementId;
  facecamOutputX: number;
  facecamOutputY: number;
  facecamOutputWidth: number;
  facecamOutputAspect: FrameAspectId;
  facecamSplitRatio: number;
  facecamRounded: number;

  /* Main Video Framing inside the Mobile Canvas (e.g. 9:16 full-bleed, 4:3, 16:9, 1:1) */
  mainVideoAspect: FrameAspectId;
  mainVideoFit: VideoFitId;
  mainVideoOffsetY: number;

  /* Platform Streamer Attribution (`[Logo] USERNAME`) — Kick, Insta, YT Shorts */
  streamerHandle: string;
  streamerPlatform: StreamerPlatformId;
  showStreamerBadge: boolean;
  streamerBadgeX: number;
  streamerBadgeY: number;
  streamerBadgeScale: number;
  streamerBadgeUppercase: boolean;

  /* Creator Page Watermark (`@HANDLE`) free positioning & style */
  watermarkX: number;
  watermarkY: number;
  watermarkSize: number;
  watermarkOutline: boolean;

  /* Optional Platform Accent Toggles */
  kickNeonGlow: boolean;
  kickVerifiedBadge: boolean;
  kickStatusPill: KickBadgeMode;
  kickHandleFormat: KickHandleFormat;
  instaShowIcon: boolean;
  instaShowCard: boolean;
  ytShowSubscribeCue: boolean;

  /* Headline / Top Hook Caption (independent from subtitles, full layout + position) */
  headline: string;
  headlineLayout: HeadlineLayoutStyleId;
  font: string;
  headlineSize: number;
  headlineCasing: TextCasingId;
  headlineX: number;
  headlineY: number;
  headlineMaxWidth: number;
  headlineAlign: TextAlignId;
  textShadow: number;
  bannerOpacity: number;

  /* Viral Subtitle & Caption Engine (size, layout, position, alignment, emphasis) */
  captionStyle: ViralCaptionPresetId;
  subtitleFont: string;
  subtitleSize: number;
  subtitleCasing: TextCasingId;
  subtitleWordsPerScreen: WordPacingId;
  subtitleBaseColor: string;
  subtitleActiveColor: string;
  subtitleEmphasisColor: string;
  subtitleStrokeWidth: number;
  subtitleStrokeColor: string;
  subtitleDropShadow: boolean;
  subtitleNeonGlow: boolean;
  subtitleAnimation: CaptionAnimationId;
  subtitleX: number;
  subtitleVerticalPos: number;
  subtitleMaxWidth: number;
  subtitleAlign: TextAlignId;
  subtitleLineHeight: number;
  subtitleBgStyle: SubtitleBgStyleId;

  /* Safe Zone Override */
  safeZonePlatform: SafeZonePlatformId;

  /* Media, Score & Finishing */
  audioPeak: boolean;
  audioBaseVol: number;
  audioPeakVol: number;
  riserDurationSec: number;
  customAudioName: string;
  customAudioUrl: string;
  outroText: string;
  outroDurationSec: number;
}

export interface BatchRestyleSettings {
  template: string;
  font: string;
  subtitleFont: string;
  captionStyle: ViralCaptionPresetId;
  aspect: AspectRatioId;
  layout: LayoutModeId;
  canvas: CanvasModeId;
  outroText: string;
  handle: string;
  audioPeak: boolean;
}

export interface DetectedSource {
  valid: boolean;
  platform: SourcePlatform | null;
  cleanLabel: string;
  estimatedTitle: string;
  estimatedDuration: string;
  /** Auto-detected streamer or creator username from URL */
  streamerHandle?: string;
  /** Optional platform-matched template suggestion (e.g. 'kick-stream' for kick.com) */
  suggestedTemplateId?: string;
  error?: string;
}
