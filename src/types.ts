export type PageId = 'dashboard' | 'live' | 'clips' | 'framing' | 'shorts';

export type EditorTabId = 'framing' | 'templates' | 'text' | 'media';
export type ShortsTabId = 'templates' | 'text' | 'media';
export type TextSubtabId = 'headline' | 'subs';
export type StageViewModeId = 'framing' | 'editor';

export type AspectRatioId = '9:16' | '4:5' | '1:1' | '16:9' | '4:3';
export type LayoutModeId = 'split' | 'solo' | 'trio' | 'pip' | 'centered' | 'widescreen';
export type CanvasModeId = 'solid' | 'blur' | 'gradient' | 'padding' | 'image';
export type FacecamPlacementId = 'bottom' | 'top' | 'split-top' | 'split-bottom' | 'pip-free';
export type FrameAspectId = '9:16' | '4:3' | '16:9' | '1:1';
export type VideoFitId = 'cover' | 'contain';
export type SpeakerCropKey = 'primary' | 'secondary' | 'tertiary';
export type PreviewResolutionId = 'auto' | 'half' | 'full';
export type ExportResolutionId = '720p' | '1080p' | '2k' | '4k' | 'source';
export type ExportEncoderId = 'auto' | 'nvenc' | 'videotoolbox' | 'qsv' | 'cpu';

/** Normalized 0..1 source crop box (matching decompiled engine schema) */
export interface NormalizedCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PipShapeId = 'circle' | 'rounded' | 'rect';
export type PipAspectId = '16:9' | '4:3' | 'free' | '1:1';
export type PipCornerId = 'tl' | 'tr' | 'bl' | 'br' | 'custom';

export interface PipConfig {
  shape: PipShapeId;
  /** Rectangular facecam aspect ratio (default '16:9' for non-circle shapes) */
  aspect?: PipAspectId;
  corner: PipCornerId;
  x: number; // 0..100
  y: number; // 0..100
  scale: number; // 15..80
  borderWidth: number; // 0..30
  borderColor: string;
  shadow: boolean;
  flip: boolean;
  radius: number; // 0..100
}

export type BackdropKindId = 'blur' | 'color' | 'gradient' | 'image';

export interface BackdropConfig {
  kind: BackdropKindId;
  blur: number; // 0..100
  dim: number; // 0..1
  color: string;
  from: string;
  to: string;
  angle: number; // 0..360
  imgUrl: string;
  imgName: string;
  imgBlur: number; // 0..25
  imgDim: number; // 0..0.7
}

export interface SlotMediaOverride {
  id: string;
  name: string;
  url: string;
  isVideo: boolean;
}

/**
 * Complete Framing Blueprint authored in Section 1 (Framing Studio)
 * and consumed read-only by Section 2 (Shorts Studio).
 */
export interface FramingBlueprint {
  layout: LayoutModeId;
  aspect: AspectRatioId;
  /** Normalized 0..1 crop boxes per active layout slot */
  crops: NormalizedCrop[];
  /** Slots rendered as whole full-screen source (contain fit over backdrop) instead of cropped */
  fullFrameSlots?: Record<number, boolean>;
  /** When true, crop boxes can be resized freely to any rectangular aspect ratio */
  freeCrop?: boolean;
  /** Split vertical divider ratio (0.15..0.85, default 0.50) */
  splitRatio: number;
  /** Divider line between Split/Trio panes */
  dividerWidth: number; // 0..30
  dividerColor: string;
  /** PiP overlay framing config */
  pip: PipConfig;
  /** Centered card controls */
  centeredScale: number; // 0.3..2.0
  centeredPanX: number; // -100..100
  centeredPanY: number; // -100..100
  centerShadow: number; // 0..100
  /** Frame & Corners */
  radius: number; // 0..200
  padding: number; // 0..200
  fillActive: boolean;
  fillKind: 'solid' | 'gradient';
  fillColor: string;
  fillTo: string;
  fillAngle: number; // 0..360
  /** Video Backdrop */
  backdrop: BackdropConfig;
  /** Playback Speed (0.25..4.0) */
  speed: number;
  /** Optional per-slot media overrides indexed by slot index (0, 1, 2) */
  slotMedia: Record<number, SlotMediaOverride>;
}

export interface ClipSegment {
  id: string;
  start: number;
  end: number;
}

export type BuiltinSfxKind = 'whoosh' | 'pop' | 'boom' | 'ding' | 'swoosh';

export interface SfxAsset {
  id: string;
  name: string;
  builtin?: BuiltinSfxKind;
  url?: string;
}

export interface SfxCue {
  id: string;
  sfxId: string;
  name: string;
  /** Source timeline timestamp in seconds */
  time: number;
  volume: number; // 0..1
}

export interface OutroTemplateConfig {
  mode: 'template' | 'custom';
  enabled: boolean;
  duration: number; // 1.5..8s
  animDuration: number; // 0.4..3s
  bgColor: string;
  text: string;
  textColor: string;
  platform: 'youtube' | 'instagram' | 'kick' | 'tiktok';
  btnText: string;
  btnColor: string;
  logoDataUrl: string;
  customUrl: string;
  customName: string;
  customIsVideo: boolean;
}

export interface DualWatermarkConfig {
  secondaryEnabled: boolean;
  secondaryText: string;
  secondaryX: number;
  secondaryY: number;
  secondarySize: number;
  secondaryOpacity: number;
  customLogoUrl: string;
  customLogoName: string;
  customLogoScale: number;
  useCustomLogo: boolean;
}

export interface HeadlineTimingConfig {
  mode: 'always' | 'custom';
  startSec: number;
  endSec: number;
  fade: boolean;
  sfxIn: string;
  sfxOut: string;
}

export interface ShortsProductionConfig {
  multiSegmentEnabled: boolean;
  segments: ClipSegment[];
  musicOffsetSec: number;
  musicDurationSec: number;
  sfxLibrary: SfxAsset[];
  sfxCues: SfxCue[];
  outro: OutroTemplateConfig;
  dualWatermark: DualWatermarkConfig;
  headlineTiming: HeadlineTimingConfig;
  exportResolution: ExportResolutionId;
  exportEncoder: ExportEncoderId;
}

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
  blueprint?: FramingBlueprint;
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
  | 'breaking-news'
  | 'cyan-glow-pop'
  | 'yellow-box-slam'
  | 'crimson-rage'
  | 'minimal-clean'
  | 'subway-punch'
  | (string & {});

/** Supports both built-in/custom viral preset IDs and legacy backend identifiers seamlessly */
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
  /** Full-resolution pre-crop source used by the Framing Studio (e.g. 1920x1080). */
  rawMediaUrl?: string;
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

export type LiveMonitorPlatform = 'kick' | 'youtube' | 'twitch';

export type LiveMonitorStatus =
  | 'connecting'
  | 'calibrating'
  | 'watching'
  | 'spike'
  | 'paused'
  | 'error';

export interface MonitorRatePoint {
  ts_ms: number;
  rate: number;
  baseline: number;
  z_score: number;
  hype_score: number;
  unique_authors: number;
  triggered: boolean;
}

export interface MonitorSpikeRecord {
  ts_ms: number;
  hype_score: number;
  z_score: number;
  rate: number;
  baseline: number;
  reasons: string[];
  job_id: string;
  manual: boolean;
}

export interface LiveStreamMonitor {
  id: string;
  url: string;
  platform: LiveMonitorPlatform;
  channel: string;
  status: LiveMonitorStatus;
  status_detail: string;
  viewer_count: number | null;
  playback_url: string | null;
  template: string;
  lookback_secs: number;
  cooldown_secs: number;
  threshold: number;
  auto_clip: boolean;
  paused: boolean;
  calibrated: boolean;
  calibration_pct: number;
  current_rate: number;
  baseline_rate: number;
  z_score: number;
  hype_score: number;
  unique_authors: number;
  total_messages: number;
  clips_triggered: number;
  last_clip_job_id: string | null;
  last_message_ms: number;
  created_at_ms: number;
  history: MonitorRatePoint[];
  spikes: MonitorSpikeRecord[];
}

export interface LiveMonitorConfig {
  kick_bridge_url: string;
  kick_pusher_key_set: boolean;
  kick_pusher_key_preview: string;
  kick_pusher_cluster: string;
  youtube_api_key_set: boolean;
}

export interface LiveMonitorsResponse {
  ok?: boolean;
  backend_offline?: boolean;
  count: number;
  config?: LiveMonitorConfig;
  monitors: LiveStreamMonitor[];
}
