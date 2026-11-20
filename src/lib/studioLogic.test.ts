import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  FEATURED_PRESETS,
  LAYOUT_MODES,
  OUTER_FILL_SWATCHES,
  TEMPLATE_PRESETS,
  getTemplatePreset,
} from '../presets';
import {
  SAFE_ZONE_SPECS,
  VIRAL_CAPTION_PRESETS,
  VIRAL_FONTS,
  buildRenderParitySpec,
  chunkWordCues,
  generateAssSubtitle,
  getSafeZoneSpec,
  hexToAssColor,
  normalizeCaptionPresetId,
  resolveSafeZonePlatform,
} from '../captionStyles';
import {
  applyTextCasing,
  buildConfigurePayload,
  clampFacecamSourceBox,
  clampTrimWindow,
  computeCropTransform,
  computeScoreVolume,
  createHistory,
  detectVideoSource,
  filterClips,
  formatSmpteTimecode,
  formatTimecode,
  getClipsEmptyState,
  normalizeHandle,
  parseSrtToWordCues,
  pushHistory,
  redoHistory,
  undoHistory,
  validateIngestInput,
} from './studioLogic';
import type { BrandKit, ClipItem, EditorSettings, WordCue } from '../types';

const require = createRequire(import.meta.url);
const hypeEngine = require('../../tools/extension/hypeEngine.js');

const SAMPLE_CLIPS: ClipItem[] = [
  {
    id: 'c1',
    title: 'Zero-latency audio routing breakthrough',
    template: 'podcast_split',
    status: 'Ready',
    confidence: 0.92,
    channel: 'SignalCraft',
    streamerHandle: 'SIGNALCRAFT',
    platform: 'YouTube',
    duration_sec: 34,
    description: 'Studio engineering breakdown',
    transcript_snippet: 'We shaved forty milliseconds off the capture pipeline.',
    hashtags: ['audio', 'podcast'],
    created_at_ms: 1000,
    aspect: '9:16',
    layout: 'split',
    caption_style: 'podcast-pill',
    words: [],
  },
  {
    id: 'c2',
    title: 'No way Adin assistant ALREADY got hired for $30k a month',
    template: 'kick-stream',
    status: 'Approved',
    confidence: 0.96,
    channel: 'ADINROSS',
    streamerHandle: 'ADINROSS',
    platform: 'Kick',
    duration_sec: 28,
    description: 'Live chat spike',
    transcript_snippet: 'No way we actually pulled that off in the final second!',
    hashtags: ['kick', 'viral', 'shorts'],
    created_at_ms: 2000,
    aspect: '9:16',
    layout: 'solo',
    caption_style: 'hormozi-classic',
    words: [],
  },
];

const SAMPLE_SETTINGS: EditorSettings = {
  template: 'kick-stream',
  templateEnabled: true,
  aspect: '9:16',
  layout: 'solo',
  canvas: 'solid',
  cornerRadius: 0,
  framePadding: 0,
  outerFill: '#09090B',
  outerFillActive: true,
  outerGradient: 'linear-gradient(135deg, #09090B 0%, #1E1B4B 100%)',
  bgImageUrl: '',
  bgImageBlur: 12,
  bgImageDim: 35,
  playbackSpeed: 1.0,
  speakerCrops: {
    primary: { x: 4, y: 12, width: 44, height: 76 },
    secondary: { x: 52, y: 12, width: 44, height: 76 },
    tertiary: { x: 25, y: 12, width: 50, height: 76 },
  },
  cardTheme: 'dark',
  pinnedStatement: 'Pinned insight',
  facecamEnabled: false,
  facecamSourceBox: { x: 68, y: 60, width: 28, height: 35 },
  facecamPlacement: 'bottom',
  facecamOutputX: 50,
  facecamOutputY: 78,
  facecamOutputWidth: 52,
  facecamOutputAspect: '4:3',
  facecamSplitRatio: 40,
  facecamRounded: 12,
  mainVideoAspect: '9:16',
  mainVideoFit: 'cover',
  mainVideoOffsetY: 50,
  streamerHandle: 'ADINROSS',
  streamerPlatform: 'kick',
  showStreamerBadge: true,
  streamerBadgeX: 50,
  streamerBadgeY: 85,
  streamerBadgeScale: 100,
  streamerBadgeUppercase: true,
  watermarkX: 50,
  watermarkY: 77,
  watermarkSize: 15,
  watermarkOutline: true,
  kickNeonGlow: false,
  kickVerifiedBadge: false,
  kickStatusPill: 'none',
  kickHandleFormat: 'name',
  instaShowIcon: true,
  instaShowCard: false,
  ytShowSubscribeCue: false,
  headline: 'watch the timing here',
  font: 'TikTok Sans',
  headlineSize: 22,
  headlineCasing: 'upper',
  headlineLayout: 'white-stepped',
  headlineX: 50,
  headlineY: 22,
  headlineMaxWidth: 86,
  headlineAlign: 'center',
  textShadow: 4,
  bannerOpacity: 88,
  captionStyle: 'kick-neon',
  subtitleFont: 'Archivo Black',
  subtitleSize: 28,
  subtitleCasing: 'upper',
  subtitleWordsPerScreen: '2-3',
  subtitleBaseColor: '#FFFFFF',
  subtitleActiveColor: '#53FC18',
  subtitleEmphasisColor: '#53FC18',
  subtitleStrokeWidth: 5,
  subtitleStrokeColor: '#000000',
  subtitleDropShadow: true,
  subtitleNeonGlow: true,
  subtitleAnimation: 'pop-scale',
  subtitleVerticalPos: 60,
  subtitleX: 50,
  subtitleMaxWidth: 88,
  subtitleAlign: 'center',
  subtitleLineHeight: 1.15,
  subtitleBgStyle: 'white-stepped',
  safeZonePlatform: 'auto',
  audioPeak: true,
  audioBaseVol: 15,
  audioPeakVol: 85,
  riserDurationSec: 4,
  customAudioName: '',
  customAudioUrl: '',
  outroText: 'Follow for part 2',
  outroDurationSec: 3,
};

const SAMPLE_BRAND_KIT: BrandKit = {
  handle: 'DUMMNEWS',
  displayName: 'DummNews',
  verified: true,
  defaultOutro: 'Follow for more',
  watermarkPosition: 'bottom-center',
  watermarkOpacity: 95,
  showWatermark: true,
};

test('shared viral preset registry exposes 9 featured / 12 total modern formats with zero legacy slop', () => {
  assert.equal(FEATURED_PRESETS.length, 9);
  assert.equal(TEMPLATE_PRESETS.length, 12);

  const featuredIds = FEATURED_PRESETS.map((t) => t.id);
  assert.deepEqual(featuredIds.slice(0, 4), ['default', 'kick-stream', 'insta-short', 'yt-short']);

  const classic = getTemplatePreset('default');
  assert.equal(classic.name, 'Classic Short');
  assert.equal(classic.defaultHeadlineLayout, 'outline-only');
  assert.equal(classic.defaultCaptionStyle, 'hormozi-classic');
  assert.equal(classic.defaultStreamerPlatform, 'none');
  assert.equal(classic.hasHeadline, true);
  assert.equal(classic.accentHex, '#FFE600');

  const kick = getTemplatePreset('kick-stream');
  assert.equal(kick.name, 'Kick Viral');
  assert.equal(kick.defaultLayout, 'solo');
  assert.equal(kick.defaultHeadlineLayout, 'white-stepped');
  assert.equal(kick.defaultStreamerPlatform, 'kick');

  const insta = getTemplatePreset('insta-short');
  assert.equal(insta.name, 'Insta Reels');
  assert.equal(insta.defaultLayout, 'solo');
  assert.equal(insta.defaultHeadlineLayout, 'white-stepped');
  assert.equal(insta.defaultStreamerPlatform, 'instagram');
  assert.equal(insta.defaultSafeZone, 'instagram-reels');

  const ytShort = getTemplatePreset('yt-short');
  assert.equal(ytShort.name, 'YT Shorts');
  assert.equal(ytShort.defaultLayout, 'solo');
  assert.equal(ytShort.defaultHeadlineLayout, 'white-stepped');
  assert.equal(ytShort.defaultStreamerPlatform, 'youtube');
  assert.equal(ytShort.defaultSafeZone, 'youtube-shorts');

  // Legacy dated templates gracefully map to modern equivalents and are not in TEMPLATE_PRESETS
  const allIds = new Set(TEMPLATE_PRESETS.map((t) => t.id));
  assert.equal(allIds.has('street_bold'), false);
  assert.equal(allIds.has('news_banner'), false);
  assert.equal(allIds.has('cyber_glow'), false);
  assert.equal(getTemplatePreset('minimal_gradient').id, 'default');
  assert.equal(getTemplatePreset('unknown_id').id, 'default');

  const layoutIds = LAYOUT_MODES.map((l) => l.id);
  assert.deepEqual(layoutIds, ['split', 'solo', 'trio', 'pip', 'centered', 'widescreen']);
  assert.equal(
    OUTER_FILL_SWATCHES.some((s) => s.hex.toUpperCase() === '#E0FE10'),
    false
  );
});

test('URL platform & streamer handle auto-detection works for Kick, Instagram Reels, YT Shorts, and Twitch', () => {
  const kick = detectVideoSource('https://kick.com/adinross');
  assert.equal(kick.valid, true);
  assert.equal(kick.platform, 'Kick');
  assert.equal(kick.streamerHandle, 'adinross');
  assert.equal(kick.suggestedTemplateId, 'kick-stream');

  const ig = detectVideoSource('https://www.instagram.com/studio.daily/reel/C8xYz991/');
  assert.equal(ig.valid, true);
  assert.equal(ig.platform, 'Instagram');
  assert.equal(ig.streamerHandle, 'studio.daily');
  assert.equal(ig.suggestedTemplateId, 'insta-short');

  const ytHandle = detectVideoSource('https://www.youtube.com/@signalcraft/shorts');
  assert.equal(ytHandle.valid, true);
  assert.equal(ytHandle.platform, 'YouTube');
  assert.equal(ytHandle.streamerHandle, 'signalcraft');
  assert.equal(ytHandle.suggestedTemplateId, 'yt-short');

  const twitch = detectVideoSource('https://twitch.tv/shroud');
  assert.equal(twitch.valid, true);
  assert.equal(twitch.platform, 'Twitch');
  assert.equal(twitch.streamerHandle, 'shroud');

  const invalid = validateIngestInput('link', '', '', '');
  assert.equal(invalid.valid, false);
  assert.ok(invalid.error);

  const validLocal = validateIngestInput('file', '', '/videos/match.mp4', '');
  assert.equal(validLocal.valid, true);
  assert.equal(validLocal.detected?.platform, 'Local');
});

test('2026 platform Safe Zone specs auto-match active template and expose exact 1080x1920 pixel margins', () => {
  assert.equal(resolveSafeZonePlatform('auto', 'yt-short'), 'youtube-shorts');
  assert.equal(resolveSafeZonePlatform('auto', 'insta-short'), 'instagram-reels');
  assert.equal(resolveSafeZonePlatform('auto', 'kick-stream'), 'universal');
  assert.equal(resolveSafeZonePlatform('instagram-reels', 'kick-stream'), 'instagram-reels');

  const ytSpec = getSafeZoneSpec('auto', 'yt-short');
  assert.equal(ytSpec.topPx, 288);
  assert.equal(ytSpec.bottomPx, 672);
  assert.equal(ytSpec.leftPx, 48);
  assert.equal(ytSpec.rightPx, 192);

  const igSpec = SAFE_ZONE_SPECS['instagram-reels'];
  assert.equal(igSpec.topPx, 269);
  assert.equal(igSpec.bottomPx, 672);

  const univSpec = SAFE_ZONE_SPECS.universal;
  assert.equal(univSpec.topPx, 288);
  assert.equal(univSpec.bottomPx, 672);
});

test('viral typography, positioned ASS subtitles (white-stepped BorderStyle=3), and watermark/streamer parity', () => {
  assert.equal(VIRAL_FONTS.length, 13);
  assert.equal(VIRAL_CAPTION_PRESETS.length, 7);
  assert.equal(VIRAL_CAPTION_PRESETS[0].baseColor, '#FFE600');
  assert.equal(normalizeCaptionPresetId('bold'), 'hormozi-classic');
  assert.equal(normalizeCaptionPresetId('karaoke_yellow'), 'hormozi-classic');
  assert.equal(normalizeCaptionPresetId('karaoke'), 'podcast-pill');
  assert.equal(hexToAssColor('#53FC18'), '&H0018FC53');

  const cues: WordCue[] = [
    {
      start_ms: 0,
      end_ms: 3000,
      text: 'NO WAY CHAT WE WON THAT',
      wordEmphasis: { 2: '#FFE600', 4: '#53FC18' },
    },
  ];

  const oneWordChunks = chunkWordCues(cues, '1');
  assert.equal(oneWordChunks.length, 6);
  assert.equal(oneWordChunks[2].tokens[0].emphasisColor, '#FFE600');

  const ass = generateAssSubtitle(
    cues,
    { ...SAMPLE_SETTINGS, subtitleX: 42, subtitleVerticalPos: 64, subtitleAlign: 'left' },
    0,
    []
  );
  assert.ok(ass.includes('PlayResX: 1080'));
  assert.ok(ass.includes('PlayResY: 1920'));
  assert.ok(ass.includes('Archivo Black'));
  assert.ok(ass.includes('\\an4\\pos(454,1229)')); // left-aligned at 42% x 1080, 64% x 1920
  assert.ok(ass.includes(',3,')); // BorderStyle=3 for white-stepped pill
  assert.ok(ass.includes('\\1c&H0000E6FF&')); // #FFE600 in ASS BGR

  const parity = buildRenderParitySpec(cues, SAMPLE_SETTINGS, SAMPLE_BRAND_KIT, 0, []);
  assert.equal(parity.dimensions.width, 1080);
  assert.equal(parity.dimensions.height, 1920);
  assert.equal(parity.subtitleFontFile, 'ArchivoBlack-Regular.ttf');
  assert.ok(parity.overlayAssets.some((a) => a.includes('kick_logo_53fc18.svg') && a.includes('ADINROSS')));
  assert.ok(parity.overlayAssets.some((a) => a.includes('watermark') && a.includes('@DUMMNEWS')));
  assert.ok(parity.overlayAssets.some((a) => a.includes('hook_white-stepped')));
  assert.ok(parity.ffmpegFiltergraph.includes('ass=captions.ass:fontsdir=./fonts'));
});

test('clip filtering and empty state discrimination separate empty library from filter mismatch', () => {
  assert.equal(getClipsEmptyState(0, 0), 'empty-library');
  assert.equal(getClipsEmptyState(2, 0), 'no-filter-matches');
  assert.equal(getClipsEmptyState(2, 1), 'has-clips');

  const approved = filterClips(SAMPLE_CLIPS, 'Approved', '');
  assert.equal(approved.length, 1);
  assert.equal(approved[0].id, 'c2');

  const searched = filterClips(SAMPLE_CLIPS, 'all', 'pipeline');
  assert.equal(searched.length, 1);
  assert.equal(searched[0].id, 'c1');
});

test('trim clamping, timecode formatting, and undo/redo history work deterministically', () => {
  const clamped = clampTrimWindow(10, 5, 30);
  assert.equal(clamped.clipDurationSec, 0);

  const validTrim = clampTrimWindow(4.5, 22.5, 34);
  assert.equal(validTrim.clipDurationSec, 18);
  assert.equal(formatTimecode(65.25), '01:05.25');

  let history = createHistory({ aspect: '9:16' });
  history = pushHistory(history, { aspect: '1:1' });
  history = pushHistory(history, { aspect: '16:9' });
  history = undoHistory(history);
  assert.equal(history.present.aspect, '1:1');
  history = redoHistory(history);
  assert.equal(history.present.aspect, '16:9');
});

test('export payload includes editable watermark, streamer attribution, and caption layout coordinates', () => {
  assert.equal(applyTextCasing('hello world', 'title'), 'Hello World');
  assert.equal(normalizeHandle('DUMMNEWS'), '@DUMMNEWS');

  const payload = buildConfigurePayload(
    { ...SAMPLE_SETTINGS, aspect: '1:1', watermarkX: 35, watermarkY: 72, streamerBadgeX: 60, streamerBadgeY: 88 },
    SAMPLE_BRAND_KIT,
    2.5,
    24.5
  );
  assert.equal(payload.aspect, '1:1');
  assert.equal(payload.hook, 'WATCH THE TIMING HERE');
  assert.equal(payload.headline_layout, 'white-stepped');
  assert.equal(payload.subtitle_bg_style, 'white-stepped');
  assert.equal(payload.streamer_attribution.handle, 'ADINROSS');
  assert.equal(payload.streamer_attribution.platform, 'kick');
  assert.equal(payload.streamer_attribution.x, 60);
  assert.equal(payload.streamer_attribution.y, 88);
  assert.equal(payload.watermark_config.x, 35);
  assert.equal(payload.watermark_config.y, 72);
  assert.equal(payload.in_ms, 2500);
  assert.equal(payload.out_ms, 24500);
});

test('browser extension hypeEngine detects Kick/YouTube/Instagram channels, live status, defaults to Classic Short, and scores spikes', () => {
  const kickCtx = hypeEngine.detectStreamContext('https://kick.com/funnyhoodvidz');
  assert.equal(kickCtx.platform, 'kick');
  assert.equal(kickCtx.channel, 'funnyhoodvidz');
  assert.equal(kickCtx.template, 'default');
  assert.equal(kickCtx.platformTemplate, 'kick-stream');
  assert.equal(kickCtx.isLive, true);
  assert.equal(kickCtx.supported, true);
  assert.equal(hypeEngine.extractKickSlug('https://kick.com/funnyhoodvidz'), 'funnyhoodvidz');
  assert.equal(hypeEngine.extractKickSlug('https://kick.com/video/12345'), '');
  assert.equal(hypeEngine.detectLiveStatus('https://kick.com/video/12345'), false);

  const ytWatchCtx = hypeEngine.detectStreamContext('https://www.youtube.com/watch?v=abc123', {
    channelHandle: '@MrBeast',
  });
  assert.equal(ytWatchCtx.platform, 'youtube');
  assert.equal(ytWatchCtx.channel, 'MrBeast');
  assert.equal(ytWatchCtx.template, 'default');
  assert.equal(ytWatchCtx.platformTemplate, 'yt-short');
  assert.equal(ytWatchCtx.isLive, false);
  assert.equal(ytWatchCtx.isChatIframe, false);

  const ytLiveCtx = hypeEngine.detectStreamContext('https://www.youtube.com/live/YNp4gpjgNH4');
  assert.equal(ytLiveCtx.isLive, true);
  assert.equal(ytLiveCtx.template, 'default');

  const ytChatIframe = hypeEngine.detectStreamContext('https://www.youtube.com/live_chat?v=abc123');
  assert.equal(ytChatIframe.isChatIframe, true);
  assert.equal(ytChatIframe.supported, true);

  const igCtx = hypeEngine.detectStreamContext('https://www.instagram.com/reel/C8xYz991/', {
    channelHandle: 'dummnews',
  });
  assert.equal(igCtx.platform, 'instagram');
  assert.equal(igCtx.channel, 'dummnews');
  assert.equal(igCtx.template, 'default');
  assert.equal(igCtx.platformTemplate, 'insta-short');
  assert.equal(igCtx.isLive, false);
  assert.equal(igCtx.supported, true);

  const now = 100000;
  // Single stray message should never exceed auto-clip threshold
  const calm = hypeEngine.analyzeChatWindow({
    messages: [{ ts: now - 500, text: 'CLIP IT OMG' }],
    nowMs: now,
    baselineRatePerSec: 0.5,
  });
  assert.ok(calm.score <= 25);

  // Genuine burst of 18 hype messages in 6s above 0.5 msg/s baseline must spike above 55
  const hypeBurst = Array.from({ length: 18 }, (_, i) => ({
    ts: now - i * 250,
    text: i % 2 === 0 ? 'NO WAY CLIP IT 😭🔥' : 'WWWWW INSANE BRO',
  }));
  const spike = hypeEngine.analyzeChatWindow({
    messages: hypeBurst,
    nowMs: now,
    baselineRatePerSec: 0.5,
  });
  assert.ok(spike.score >= 70, `Expected spike score >= 70, got ${spike.score}`);
  assert.ok(spike.reasons.length >= 2);

  // Auto cooldown (45s) must NOT block a manual click (only 2s debounce)
  const autoBlocked = hypeEngine.evaluateTriggerGate({
    source: 'auto',
    nowMs: now,
    lastAutoTriggerMs: now - 10000,
    cooldownSecs: 45,
  });
  assert.equal(autoBlocked.allowed, false);

  const manualAllowed = hypeEngine.evaluateTriggerGate({
    source: 'manual',
    nowMs: now,
    lastAutoTriggerMs: now - 1000,
    lastManualTriggerMs: now - 5000,
    cooldownSecs: 45,
    manualDebounceSecs: 2,
  });
  assert.equal(manualAllowed.allowed, true);
});

test('Reaction PiP facecam source box clamping, crop transform math, and FFmpeg vstack/overlay parity', () => {
  const clamped = clampFacecamSourceBox({ x: 92, y: -5, width: 30, height: 4 });
  assert.equal(clamped.width, 30);
  assert.equal(clamped.height, 12); // enforced minimum 12% height
  assert.equal(clamped.x, 70); // x + width <= 100
  assert.equal(clamped.y, 0);  // y >= 0

  const cropCss = computeCropTransform({ x: 50, y: 50, width: 25, height: 50 });
  assert.equal(cropCss.widthPct, 400);
  assert.equal(cropCss.heightPct, 200);
  assert.equal(cropCss.leftPct, -200);
  assert.equal(cropCss.topPct, -100);

  const pipSettings: EditorSettings = {
    ...SAMPLE_SETTINGS,
    template: 'reaction-pip',
    layout: 'pip',
    facecamEnabled: true,
    facecamSourceBox: { x: 65, y: 55, width: 30, height: 40 },
    facecamPlacement: 'bottom',
    facecamOutputX: 50,
    facecamOutputY: 78,
    facecamOutputWidth: 54,
    facecamOutputAspect: '4:3',
    mainVideoAspect: '4:3',
    mainVideoFit: 'contain',
    mainVideoOffsetY: 36,
  };

  const payload = buildConfigurePayload(pipSettings, SAMPLE_BRAND_KIT, 1, 20);
  assert.deepEqual(payload.facecam_crop, { x: 65, y: 55, width: 30, height: 40 });
  assert.equal(payload.facecam_layout.enabled, true);
  assert.equal(payload.facecam_layout.placement, 'bottom');
  assert.equal(payload.main_video_frame.aspect, '4:3');
  assert.equal(payload.main_video_frame.fit, 'contain');

  const pipParity = buildRenderParitySpec([], pipSettings, SAMPLE_BRAND_KIT, 0, []);
  assert.ok(pipParity.ffmpegFiltergraph.includes('crop=iw*0.30:ih*0.40:iw*0.65:ih*0.55'));
  assert.ok(pipParity.ffmpegFiltergraph.includes('overlay='));
  assert.ok(pipParity.overlayAssets.some((a) => a.includes('facecam_crop')));
  assert.ok(pipParity.overlayAssets.some((a) => a.includes('main_video_frame')));

  const splitParity = buildRenderParitySpec(
    [],
    { ...pipSettings, layout: 'split', facecamPlacement: 'split-top', facecamSplitRatio: 42 },
    SAMPLE_BRAND_KIT,
    0,
    []
  );
  assert.ok(splitParity.ffmpegFiltergraph.includes('[cam][main]vstack=inputs=2'));
});

test('YIZERGE Studio features: SMPTE timecode, SRT/VTT importer, Score riser volume, 4:5 export, Trio & speed FFmpeg parity', () => {
  // 1. SMPTE HH:MM:SS:FF formatting at 30fps
  assert.equal(formatSmpteTimecode(0), '00:00:00:00');
  assert.equal(formatSmpteTimecode(34.5, 30), '00:00:34:15');
  assert.equal(formatSmpteTimecode(3661.2, 30), '01:01:01:06');

  // 2. SRT & WebVTT subtitle parser
  const sampleSrt = `1
00:00:00,500 --> 00:00:02,250
<i>No way</i> chat we pulled that off

2
00:00:02,300 --> 00:00:05,000
CLIP IT RIGHT NOW`;
  const parsedSrt = parseSrtToWordCues(sampleSrt);
  assert.equal(parsedSrt.length, 2);
  assert.equal(parsedSrt[0].start_ms, 500);
  assert.equal(parsedSrt[0].end_ms, 2250);
  assert.equal(parsedSrt[0].text, 'No way chat we pulled that off');
  assert.equal(parsedSrt[1].start_ms, 2300);
  assert.equal(parsedSrt[1].text, 'CLIP IT RIGHT NOW');

  const sampleVtt = `WEBVTT

00:01.000 --> 00:03.500
Podcast trio test cue`;
  const parsedVtt = parseSrtToWordCues(sampleVtt);
  assert.equal(parsedVtt.length, 1);
  assert.equal(parsedVtt[0].start_ms, 1000);
  assert.equal(parsedVtt[0].end_ms, 3500);

  // 3. Score base -> peak riser volume math
  assert.equal(computeScoreVolume(5, 30, true, 15, 85, 5), 0.15);
  assert.equal(computeScoreVolume(27.5, 30, true, 15, 85, 5), 0.5);
  assert.equal(computeScoreVolume(30, 30, true, 15, 85, 5), 0.85);
  assert.equal(computeScoreVolume(29, 30, false, 20, 90, 5), 0.2);

  // 4. 4:5 portrait export (1080x1350), Trio 3-speaker filtergraph & playback speed setpts
  const trioParity = buildRenderParitySpec(
    parsedSrt,
    {
      ...SAMPLE_SETTINGS,
      aspect: '4:5',
      layout: 'trio',
      facecamEnabled: false,
      playbackSpeed: 1.5,
    },
    SAMPLE_BRAND_KIT,
    0,
    []
  );
  assert.equal(trioParity.dimensions.width, 1080);
  assert.equal(trioParity.dimensions.height, 1350);
  assert.ok(trioParity.assScript.includes('PlayResY: 1350'));
  assert.ok(trioParity.ffmpegFiltergraph.includes('split=3'));
  assert.ok(trioParity.ffmpegFiltergraph.includes('hstack=inputs=2'));
  assert.ok(trioParity.ffmpegFiltergraph.includes('vstack=inputs=2'));
  assert.ok(trioParity.ffmpegFiltergraph.includes('setpts=0.667*PTS'));
});


