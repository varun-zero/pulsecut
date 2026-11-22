import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BatchRestyleSettings,
  BrandKit,
  ClipItem,
  CustomFontEntry,
  EditorSettings,
  FramingBlueprint,
  JobItem,
  LiveMonitorConfig,
  LiveStreamMonitor,
  PageId,
  ShortsProductionConfig,
  WordCue,
} from './types';
import {
  DEFAULT_FACECAM_SOURCE_BOX,
  DEFAULT_SPEAKER_CROPS,
  GRADIENT_PRESETS,
  getTemplatePreset,
  TEMPLATE_PRESETS,
  WATERMARK_POSITIONS,
  type TemplatePreset,
} from './presets';
import {
  getSafeZoneSpec,
  getViralCaptionPreset,
  normalizeCaptionPresetId,
  registerCustomFontFile,
  registerGoogleFontByName,
  VIRAL_CAPTION_PRESETS,
} from './captionStyles';
import {
  addCaptionStyleToCatalog,
  BUILTIN_LOGOS,
  deleteCaptionStyleFromCatalog,
  deleteTemplateFromCatalog,
  EMPTY_CAPTION_CATALOG,
  EMPTY_TEMPLATE_CATALOG,
  resolveCaptionCatalog,
  resolveTemplateCatalog,
  upsertTemplateInCatalog,
  type CaptionCatalogState,
  type EditableCaptionPreset,
  type EditableTemplatePreset,
  type LogoAsset,
  type TemplateCatalogState,
} from './lib/creatorCatalog';
import {
  buildConfigurePayload,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryStack,
} from './lib/studioLogic';
import { createDefaultFramingBlueprint, reconcileCrops } from './lib/framingEngine';
import { createDefaultShortsProduction } from './lib/shortsEngine';
import {
  fetchLiveMonitors,
  fetchWorkspaceData,
  normalizeServerJob,
  requestServerApi,
  tryServerApi,
} from './lib/api';
import { AppHeader } from './components/AppHeader';
import { ShortcutsAboutModal } from './components/ShortcutsAboutModal';
import { BrandKitModal } from './components/BrandKitModal';
import { Toast } from './components/ui/Primitives';
import { DashboardPage } from './pages/DashboardPage';
import { LiveStreamsPage } from './pages/LiveStreamsPage';
import { ClipsPage } from './pages/ClipsPage';
import { FramingPage } from './pages/FramingPage';
import { ShortsPage } from './pages/ShortsPage';

const DEFAULT_BRAND_KIT: BrandKit = {
  handle: '',
  displayName: '',
  verified: false,
  defaultOutro: '',
  watermarkPosition: 'bottom-center',
  watermarkOpacity: 95,
  showWatermark: true,
};

function getWatermarkPresetCoords(positionId: BrandKit['watermarkPosition']): { x: number; y: number } {
  const found = WATERMARK_POSITIONS.find((w) => w.value === positionId);
  return found ? { x: found.x, y: found.y } : { x: 50, y: 77 };
}

function getFacecamPresetDefaults(preset: TemplatePreset): Pick<
  EditorSettings,
  | 'facecamEnabled'
  | 'facecamSourceBox'
  | 'facecamPlacement'
  | 'facecamOutputX'
  | 'facecamOutputY'
  | 'facecamOutputWidth'
  | 'facecamOutputAspect'
  | 'facecamSplitRatio'
  | 'facecamRounded'
  | 'mainVideoAspect'
  | 'mainVideoFit'
  | 'mainVideoOffsetY'
> {
  if (preset.id === 'reaction-pip' || preset.defaultLayout === 'pip') {
    return {
      facecamEnabled: true,
      facecamSourceBox: { ...DEFAULT_FACECAM_SOURCE_BOX },
      facecamPlacement: 'bottom',
      facecamOutputX: 50,
      facecamOutputY: 78,
      facecamOutputWidth: 54,
      facecamOutputAspect: '4:3',
      facecamSplitRatio: 40,
      facecamRounded: 12,
      mainVideoAspect: '4:3',
      mainVideoFit: 'cover',
      mainVideoOffsetY: 36,
    };
  }
  if (preset.id === 'split-stream' || preset.id === 'dual_react' || preset.defaultLayout === 'split') {
    return {
      facecamEnabled: true,
      facecamSourceBox: { ...DEFAULT_FACECAM_SOURCE_BOX },
      facecamPlacement: 'split-bottom',
      facecamOutputX: 50,
      facecamOutputY: 78,
      facecamOutputWidth: 50,
      facecamOutputAspect: '4:3',
      facecamSplitRatio: 45,
      facecamRounded: 0,
      mainVideoAspect: '9:16',
      mainVideoFit: 'cover',
      mainVideoOffsetY: 50,
    };
  }
  return {
    facecamEnabled: false,
    facecamSourceBox: { ...DEFAULT_FACECAM_SOURCE_BOX },
    facecamPlacement: 'bottom',
    facecamOutputX: 50,
    facecamOutputY: 78,
    facecamOutputWidth: 52,
    facecamOutputAspect: '4:3',
    facecamSplitRatio: 42,
    facecamRounded: 12,
    mainVideoAspect: preset.defaultLayout === 'centered' ? '16:9' : '9:16',
    mainVideoFit: 'cover',
    mainVideoOffsetY: 50,
  };
}

function createEditorSettingsForClip(clip: ClipItem | null, brandKit: BrandKit): EditorSettings {
  const preset = getTemplatePreset(clip?.template || 'default');
  const captionPreset = getViralCaptionPreset(clip?.caption_style || preset.defaultCaptionStyle);
  const safeSpec = getSafeZoneSpec('auto', preset.id);
  const wmCoords = getWatermarkPresetCoords(brandKit.watermarkPosition);
  const facecamDefaults = getFacecamPresetDefaults(preset);
  const detectedStreamer = (clip?.streamerHandle || clip?.channel || '')
    .replace(/^@/, '')
    .trim();

  return {
    template: preset.id,
    templateEnabled: true,
    aspect: clip?.aspect || '9:16',
    layout: clip?.layout || preset.defaultLayout,
    canvas: clip?.canvas || 'solid',
    cornerRadius: preset.defaultCornerRadius ?? (preset.hasCard ? 12 : 0),
    framePadding: preset.hasCard ? 12 : 0,
    outerFill: preset.defaultOuterFill || '#09090B',
    outerFillActive: true,
    outerGradient: GRADIENT_PRESETS[0].css,
    bgImageUrl: '',
    bgImageBlur: 12,
    bgImageDim: 35,
    playbackSpeed: 1.0,
    hiddenElements: [],
    channelCardX: 6,
    channelCardY: 6,
    channelCardWidth: 88,
    speakerCrops: {
      primary: { ...DEFAULT_SPEAKER_CROPS.primary },
      secondary: { ...DEFAULT_SPEAKER_CROPS.secondary },
      tertiary: { ...DEFAULT_SPEAKER_CROPS.tertiary },
    },
    cardTheme: preset.id === 'x_light' ? 'light' : 'dark',
    pinnedStatement: clip?.description || '',
    ...facecamDefaults,
    streamerHandle: detectedStreamer,
    streamerPlatform: preset.defaultStreamerPlatform,
    showStreamerBadge: preset.defaultStreamerPlatform !== 'none',
    streamerBadgeX: 50,
    streamerBadgeY: 85,
    streamerBadgeScale: 100,
    streamerBadgeUppercase: true,
    watermarkX: wmCoords.x,
    watermarkY: wmCoords.y,
    watermarkSize: 15,
    watermarkOutline: true,
    kickNeonGlow: false,
    kickVerifiedBadge: false,
    kickStatusPill: 'none',
    kickHandleFormat: 'name',
    instaShowIcon: true,
    instaShowCard: false,
    ytShowSubscribeCue: false,
    headline: clip?.title || '',
    font: clip?.font || preset.defaultHeadlineFont || 'TikTok Sans',
    headlineSize: 22,
    headlineCasing: 'asis',
    headlineLayout: preset.defaultHeadlineLayout,
    headlineX: 50,
    headlineY: 22,
    headlineMaxWidth: 86,
    headlineAlign: 'center',
    textShadow: 6,
    bannerOpacity: 88,
    captionStyle: captionPreset.id,
    subtitleFont: clip?.subtitleFont || captionPreset.subtitleFont || preset.defaultSubtitleFont,
    subtitleSize: 26,
    subtitleCasing: captionPreset.casing,
    subtitleWordsPerScreen: captionPreset.wordsPerScreen,
    subtitleBaseColor: captionPreset.baseColor,
    subtitleActiveColor: captionPreset.activeColor,
    subtitleEmphasisColor: captionPreset.emphasisColor,
    subtitleStrokeWidth: captionPreset.strokeWidth,
    subtitleStrokeColor: captionPreset.strokeColor,
    subtitleDropShadow: captionPreset.dropShadow,
    subtitleNeonGlow: captionPreset.neonGlow,
    subtitleAnimation: captionPreset.animation,
    subtitleVerticalPos: safeSpec.autoAlignSubtitlePct,
    subtitleX: 50,
    subtitleMaxWidth: 88,
    subtitleAlign: 'center',
    subtitleLineHeight: 1.15,
    subtitleBgStyle: preset.defaultSubtitleBg,
    safeZonePlatform: 'auto',
    audioPeak: clip?.audioPeak ?? false,
    audioBaseVol: 15,
    audioPeakVol: 85,
    riserDurationSec: 5,
    customAudioName: '',
    customAudioUrl: '',
    outroText: clip?.outroText ?? brandKit.defaultOutro,
    outroDurationSec: 3,

    /* Video Transform & Optics */
    videoScale: 100,
    videoPosX: 0,
    videoPosY: 0,
    videoRotation: 0,
    videoFlipH: false,
    videoFlipV: false,
    videoOpacity: 100,
    videoSharpen: 0,

    /* Color Grading & Visual FX */
    brightness: 100,
    contrast: 100,
    saturation: 100,
    exposure: 0,
    temperature: 0,
    blur: 0,
    vignette: 0,
    colorFilter: 'none',

    /* Advanced Audio Controls */
    masterVolume: 100,
    audioNormalize: true,
    targetLufs: -14,
    audioDucking: true,
    audioFadeInSec: 0,
    audioFadeOutSec: 0.5,
    muteOriginalAudio: false,

    /* Motion & Transitions */
    speedMultiplier: 1.0,
    transitionStyle: 'cut',
    transitionDurationSec: 0.3,

    /* Interactive Timeline Cuts & Markers */
    splits: [],
    markers: [],
  };
}

function mergeServerWithLocalClips(prev: ClipItem[], serverClips: ClipItem[]): ClipItem[] {
  const localOnly = prev.filter((c) => c.mediaUrl?.startsWith('blob:'));
  const serverIds = new Set(serverClips.map((c) => c.id));
  return [...localOnly.filter((c) => !serverIds.has(c.id)), ...serverClips];
}

function mergeServerWithLocalJobs(prev: JobItem[], serverJobs: JobItem[]): JobItem[] {
  const localOnly = prev.filter((j) => j.id.startsWith('local-job-'));
  const serverIds = new Set(serverJobs.map((j) => j.id));
  return [...localOnly.filter((j) => !serverIds.has(j.id)), ...serverJobs];
}

export function App() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('pulsecut-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore storage failures
    }
    return 'dark';
  });

  // Start completely clean with zero fabricated demo clips or jobs
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentClipId, setCurrentClipId] = useState<string | null>(null);

  const [templateCatalog, setTemplateCatalog] = useState<TemplateCatalogState>(() => {
    try {
      const raw = localStorage.getItem('pulsecut-custom-templates-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TemplateCatalogState>;
        return {
          customTemplates: Array.isArray(parsed.customTemplates) ? parsed.customTemplates : [],
          editedBuiltins: parsed.editedBuiltins && typeof parsed.editedBuiltins === 'object' ? parsed.editedBuiltins : {},
          deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
        };
      }
    } catch {
      // ignore storage errors
    }
    return EMPTY_TEMPLATE_CATALOG;
  });

  const [captionCatalog, setCaptionCatalog] = useState<CaptionCatalogState>(() => {
    try {
      const raw = localStorage.getItem('pulsecut-caption-styles-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<CaptionCatalogState>;
        return {
          customStyles: Array.isArray(parsed.customStyles) ? parsed.customStyles : [],
          deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds : [],
        };
      }
    } catch {
      // ignore storage errors
    }
    return EMPTY_CAPTION_CATALOG;
  });

  const [customLogos, setCustomLogos] = useState<LogoAsset[]>(() => {
    try {
      const raw = localStorage.getItem('pulsecut-logos-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as LogoAsset[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });

  const [customFonts, setCustomFonts] = useState<CustomFontEntry[]>(() => {
    try {
      const raw = localStorage.getItem('pulsecut-google-fonts-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as CustomFontEntry[];
        if (Array.isArray(parsed)) {
          parsed.forEach((entry) => {
            if (entry.fileName === 'Google Fonts') {
              registerGoogleFontByName(entry.family);
            }
          });
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });

  const builtinTemplateIds = useMemo(() => new Set(TEMPLATE_PRESETS.map((t) => t.id)), []);
  const templates = useMemo(
    () => resolveTemplateCatalog(TEMPLATE_PRESETS, templateCatalog),
    [templateCatalog]
  );
  const captionPresets = useMemo(
    () => resolveCaptionCatalog(VIRAL_CAPTION_PRESETS, captionCatalog),
    [captionCatalog]
  );
  const logos = useMemo<LogoAsset[]>(
    () => [...customLogos, ...BUILTIN_LOGOS],
    [customLogos]
  );
  const canRestoreTemplates =
    templateCatalog.deletedIds.length > 0 ||
    Object.keys(templateCatalog.editedBuiltins).length > 0;
  const canRestoreCaptions = captionCatalog.deletedIds.length > 0;

  useEffect(() => {
    try {
      localStorage.setItem('pulsecut-custom-templates-v1', JSON.stringify(templateCatalog));
    } catch {
      // ignore quota errors
    }
  }, [templateCatalog]);

  useEffect(() => {
    try {
      localStorage.setItem('pulsecut-caption-styles-v1', JSON.stringify(captionCatalog));
    } catch {
      // ignore quota errors
    }
  }, [captionCatalog]);

  useEffect(() => {
    try {
      localStorage.setItem('pulsecut-logos-v1', JSON.stringify(customLogos));
    } catch {
      // ignore quota errors
    }
  }, [customLogos]);

  useEffect(() => {
    try {
      const googleOnly = customFonts.filter((f) => f.fileName === 'Google Fonts');
      localStorage.setItem('pulsecut-google-fonts-v1', JSON.stringify(googleOnly));
    } catch {
      // ignore quota errors
    }
  }, [customFonts]);

  const [brandKit, setBrandKit] = useState<BrandKit>(DEFAULT_BRAND_KIT);
  const [history, setHistory] = useState<HistoryStack<EditorSettings>>(() =>
    createHistory(createEditorSettingsForClip(null, DEFAULT_BRAND_KIT))
  );
  const [framingHistory, setFramingHistory] = useState<HistoryStack<FramingBlueprint>>(() =>
    createHistory(createDefaultFramingBlueprint('split', '9:16'))
  );
  const [shortsConfig, setShortsConfig] = useState<ShortsProductionConfig>(() =>
    createDefaultShortsProduction()
  );

  const [batchSettings, setBatchSettings] = useState<BatchRestyleSettings>({
    template: 'default',
    font: 'Montserrat',
    subtitleFont: 'Montserrat',
    captionStyle: 'hormozi-classic',
    aspect: '9:16',
    layout: 'solo',
    canvas: 'solid',
    outroText: DEFAULT_BRAND_KIT.defaultOutro,
    handle: DEFAULT_BRAND_KIT.handle,
    audioPeak: false,
  });

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [brandKitOpen, setBrandKitOpen] = useState(false);
  const [liveMonitors, setLiveMonitors] = useState<LiveStreamMonitor[]>([]);
  const [monitorConfig, setMonitorConfig] = useState<LiveMonitorConfig | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const draftsByClipIdRef = useRef<Record<string, EditorSettings>>({});
  const blueprintsByClipIdRef = useRef<Record<string, FramingBlueprint>>({});
  const shortsByClipIdRef = useRef<Record<string, ShortsProductionConfig>>({});

  const notify = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 3000);
  }, []);

  // Sync dark class cleanly on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('pulsecut-theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Load live Rust backend workspace on mount (remains cleanly empty when offline/new)
  useEffect(() => {
    let active = true;
    fetchWorkspaceData().then((data) => {
      if (!active) return;
      setBackendConnected(data.connectedToBackend);
      if (!data.connectedToBackend) return;
      setClips((prev) => mergeServerWithLocalClips(prev, data.clips));
      setJobs((prev) => mergeServerWithLocalJobs(prev, data.jobs));
      if (data.clips[0]) {
        setCurrentClipId((prevId) => {
          if (prevId) return prevId;
          const first = data.clips[0];
          const preset = getTemplatePreset(first.template || 'kick-stream');
          setHistory(createHistory(createEditorSettingsForClip(first, DEFAULT_BRAND_KIT)));
          setFramingHistory(
            createHistory(createDefaultFramingBlueprint(first.layout || preset.defaultLayout, first.aspect || '9:16'))
          );
          setShortsConfig(createDefaultShortsProduction());
          return first.id;
        });
      }
    });
    fetchLiveMonitors().then((res) => {
      if (!active) return;
      if (res.connectedToBackend) {
        setBackendConnected(true);
        setLiveMonitors(res.monitors);
        setMonitorConfig(res.config);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshLiveMonitors = useCallback(async () => {
    const res = await fetchLiveMonitors();
    setBackendConnected(res.connectedToBackend);
    if (res.connectedToBackend) {
      setLiveMonitors(res.monitors);
      setMonitorConfig(res.config);
    }
  }, []);

  // Poll live multi-stream monitor telemetry every 1.5s while on the Live Streams page
  useEffect(() => {
    if (page !== 'live') return;
    let active = true;
    void refreshLiveMonitors();
    const timer = window.setInterval(() => {
      if (!active) return;
      void refreshLiveMonitors();
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [page, refreshLiveMonitors]);

  const handleStartMonitors = useCallback(
    async (payload: {
      urls: string[];
      template: string;
      lookback_secs: number;
      cooldown_secs: number;
      threshold: number;
      auto_clip: boolean;
    }): Promise<boolean> => {
      const res = await requestServerApi<{
        ok?: boolean;
        started?: LiveStreamMonitor[];
        errors?: Array<{ url: string; error: string }>;
        list?: { monitors?: LiveStreamMonitor[]; config?: LiveMonitorConfig };
      }>('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        notify(res.error);
        return false;
      }
      setBackendConnected(true);
      if (res.data.list?.monitors) {
        setLiveMonitors(res.data.list.monitors);
      } else {
        await refreshLiveMonitors();
      }
      if (res.data.list?.config) {
        setMonitorConfig(res.data.list.config);
      }
      const startedCount = res.data.started?.length || payload.urls.length;
      const errCount = res.data.errors?.length || 0;
      notify(
        errCount > 0
          ? `Monitoring ${startedCount} stream${startedCount === 1 ? '' : 's'} (${errCount} skipped)`
          : `Monitoring ${startedCount} live stream${startedCount === 1 ? '' : 's'}`
      );
      return true;
    },
    [notify, refreshLiveMonitors]
  );

  const handleSaveMonitorConfig = useCallback(
    async (payload: {
      kick_pusher_key?: string;
      kick_pusher_cluster?: string;
      kick_bridge_url?: string;
      youtube_api_key?: string;
    }): Promise<{ ok: boolean; bridgeSynced?: boolean; error?: string }> => {
      const res = await requestServerApi<{
        ok?: boolean;
        bridge_synced?: boolean;
        config?: LiveMonitorConfig;
      }>('/api/monitors/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        return { ok: false, error: res.error };
      }
      setBackendConnected(true);
      if (res.data.config) {
        setMonitorConfig(res.data.config);
      }
      notify(
        res.data.bridge_synced
          ? 'Kick Pusher key saved & synced to bridge'
          : 'Monitor configuration saved'
      );
      return { ok: true, bridgeSynced: Boolean(res.data.bridge_synced) };
    },
    [notify]
  );

  const handlePauseMonitor = useCallback(
    async (id: string, paused: boolean) => {
      const action = paused ? 'pause' : 'resume';
      const res = await requestServerApi(`/api/monitors/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        notify(res.error);
        return;
      }
      await refreshLiveMonitors();
      notify(paused ? 'Stream monitor paused' : 'Stream monitor resumed');
    },
    [notify, refreshLiveMonitors]
  );

  const handleToggleAutoClip = useCallback(
    async (id: string, enabled: boolean) => {
      const res = await requestServerApi(`/api/monitors/${id}/auto-clip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        notify(res.error);
        return;
      }
      await refreshLiveMonitors();
      notify(enabled ? 'Auto-clip enabled' : 'Auto-clip disabled (monitoring only)');
    },
    [notify, refreshLiveMonitors]
  );

  const handleManualClipMonitor = useCallback(
    async (id: string, lookbackSecs?: number) => {
      const res = await requestServerApi<{ job_id?: string }>(`/api/monitors/${id}/clip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lookbackSecs ? { lookback_secs: lookbackSecs } : {}),
      });
      if (!res.ok) {
        notify(res.error);
        return;
      }
      await refreshLiveMonitors();
      notify(`Queued ${lookbackSecs || 30}s lookback clip`);
    },
    [notify, refreshLiveMonitors]
  );

  const handleStopMonitor = useCallback(
    async (id: string) => {
      const res = await requestServerApi(`/api/monitors/${id}/stop`, { method: 'POST' });
      if (!res.ok) {
        notify(res.error);
        return;
      }
      setLiveMonitors((prev) => prev.filter((m) => m.id !== id));
      notify('Stopped stream monitor');
    },
    [notify]
  );

  // Automatic background polling while any backend ingest job is active
  const hasActiveServerJob = useMemo(
    () =>
      jobs.some(
        (j) =>
          !j.id.startsWith('local-job-') &&
          (j.status === 'queued' ||
            j.status === 'downloading' ||
            j.status === 'clipping' ||
            j.status === 'rendering')
      ),
    [jobs]
  );

  useEffect(() => {
    if (!hasActiveServerJob) return;
    let active = true;
    const intervalId = window.setInterval(async () => {
      const data = await fetchWorkspaceData();
      if (!active || !data.connectedToBackend) return;
      setClips((prev) => mergeServerWithLocalClips(prev, data.clips));
      setJobs((prev) => mergeServerWithLocalJobs(prev, data.jobs));
      if (data.clips[0]) {
        setCurrentClipId((prevId) => {
          if (prevId) return prevId;
          const first = data.clips[0];
          const preset = getTemplatePreset(first.template || 'default');
          setHistory(createHistory(createEditorSettingsForClip(first, brandKit)));
          setFramingHistory(
            createHistory(createDefaultFramingBlueprint(first.layout || preset.defaultLayout, first.aspect || '9:16'))
          );
          setShortsConfig(createDefaultShortsProduction());
          return first.id;
        });
      }
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [hasActiveServerJob, brandKit]);

  // Keep batchSettings, untouched Editor outro, and watermark preset X/Y synced whenever Brand Kit updates
  const handleUpdateBrandKit = useCallback(
    (next: BrandKit) => {
      const prevOutro = brandKit.defaultOutro;
      const prevWmPos = brandKit.watermarkPosition;
      setBrandKit(next);
      setBatchSettings((prev) => ({
        ...prev,
        handle: next.handle,
        outroText:
          !prev.outroText || prev.outroText === prevOutro ? next.defaultOutro : prev.outroText,
      }));
      if (next.defaultOutro !== prevOutro || next.watermarkPosition !== prevWmPos) {
        const wmCoords = getWatermarkPresetCoords(next.watermarkPosition);
        setHistory((prev) => {
          const patch: Partial<EditorSettings> = {};
          if (next.defaultOutro !== prevOutro && prev.present.outroText === prevOutro) {
            patch.outroText = next.defaultOutro;
          }
          if (next.watermarkPosition !== prevWmPos) {
            patch.watermarkX = wmCoords.x;
            patch.watermarkY = wmCoords.y;
          }
          return Object.keys(patch).length > 0
            ? { ...prev, present: { ...prev.present, ...patch } }
            : prev;
        });
      }
    },
    [brandKit.defaultOutro, brandKit.watermarkPosition]
  );

  const handleChangeBatchSettings = useCallback(
    (next: BatchRestyleSettings) => {
      setBatchSettings(next);
      if (next.handle !== brandKit.handle) {
        setBrandKit((prev) => ({ ...prev, handle: next.handle }));
      }
    },
    [brandKit.handle]
  );

  const currentClip = useMemo(
    () => clips.find((c) => c.id === currentClipId) ?? null,
    [clips, currentClipId]
  );

  const selectEditorClip = useCallback(
    (clipId: string | null) => {
      if (currentClipId) {
        draftsByClipIdRef.current[currentClipId] = history.present;
        blueprintsByClipIdRef.current[currentClipId] = framingHistory.present;
        shortsByClipIdRef.current[currentClipId] = shortsConfig;
      }
      setCurrentClipId(clipId);
      const found = clips.find((c) => c.id === clipId) ?? null;
      const preset = getTemplatePreset(found?.template || 'default');
      const restoredSettings =
        clipId && draftsByClipIdRef.current[clipId]
          ? draftsByClipIdRef.current[clipId]
          : createEditorSettingsForClip(found, brandKit);
      const restoredBlueprint =
        clipId && blueprintsByClipIdRef.current[clipId]
          ? blueprintsByClipIdRef.current[clipId]
          : createDefaultFramingBlueprint(found?.layout || preset.defaultLayout, found?.aspect || '9:16');
      const restoredShorts =
        clipId && shortsByClipIdRef.current[clipId]
          ? shortsByClipIdRef.current[clipId]
          : createDefaultShortsProduction();

      setHistory(createHistory(restoredSettings));
      setFramingHistory(createHistory(restoredBlueprint));
      setShortsConfig(restoredShorts);
    },
    [clips, brandKit, currentClipId, history.present, framingHistory.present, shortsConfig]
  );

  const handleUpdateEditorSettings = useCallback(
    (patch: Partial<EditorSettings>, recordHistory = false) => {
      setHistory((prev) => {
        const nextPresent = { ...prev.present, ...patch };
        return recordHistory
          ? pushHistory(prev, nextPresent)
          : { ...prev, present: nextPresent };
      });
    },
    []
  );

  const handleUpdateBlueprint = useCallback(
    (next: FramingBlueprint, recordHistory = false) => {
      setFramingHistory((prev) =>
        recordHistory ? pushHistory(prev, next) : { ...prev, present: next }
      );
      if (currentClipId) {
        blueprintsByClipIdRef.current[currentClipId] = next;
      }
      // Keep EditorSettings aspect/layout/speed synchronized with Section 1's Framing Blueprint
      setHistory((prev) => {
        if (
          prev.present.aspect === next.aspect &&
          prev.present.layout === next.layout &&
          prev.present.playbackSpeed === next.speed
        ) {
          return prev;
        }
        return {
          ...prev,
          present: {
            ...prev.present,
            aspect: next.aspect,
            layout: next.layout,
            playbackSpeed: next.speed,
          },
        };
      });
    },
    [currentClipId]
  );

  const handleUpdateShorts = useCallback(
    (patch: Partial<ShortsProductionConfig>) => {
      setShortsConfig((prev) => {
        const next = { ...prev, ...patch };
        if (currentClipId) {
          shortsByClipIdRef.current[currentClipId] = next;
        }
        return next;
      });
    },
    [currentClipId]
  );

  const handleSelectTemplatePreset = useCallback(
    (preset: EditableTemplatePreset) => {
      const captionPreset = getViralCaptionPreset(preset.defaultCaptionStyle, captionPresets);
      const safeSpec = getSafeZoneSpec(preset.defaultSafeZone || 'auto', preset.id);
      const nextAspect = preset.defaultAspect || framingHistory.present.aspect;
      const nextLayout = preset.defaultFullScreen ? 'solo' : preset.defaultLayout;

      if (
        preset.defaultAspect !== undefined ||
        preset.defaultFullScreen !== undefined ||
        preset.isCustom
      ) {
        setFramingHistory((prev) => {
          const isFull = Boolean(preset.defaultFullScreen);
          const nextBp: FramingBlueprint = {
            ...prev.present,
            aspect: nextAspect,
            layout: nextLayout,
            fullFrameSlots: isFull ? { 0: true } : {},
            crops: isFull
              ? [{ x: 0, y: 0, w: 1, h: 1 }]
              : reconcileCrops(nextLayout, nextAspect, 16 / 9, prev.present.crops, {
                  splitRatio: prev.present.splitRatio,
                  pip: prev.present.pip,
                }),
          };
          if (currentClipId) {
            blueprintsByClipIdRef.current[currentClipId] = nextBp;
          }
          return pushHistory(prev, nextBp);
        });
      }

      handleUpdateEditorSettings(
        {
          template: preset.id,
          templateEnabled: true,
          aspect: nextAspect,
          layout: nextLayout,
          outerFill: preset.defaultOuterFill,
          font: preset.defaultHeadlineFont,
          headlineLayout: preset.defaultHeadlineLayout,
          headlineX: 50,
          headlineY: preset.defaultHeadlineY ?? 22,
          headlineSize: preset.defaultHeadlineSize ?? history.present.headlineSize,
          headlineCasing: 'asis',
          streamerPlatform: preset.defaultStreamerPlatform,
          showStreamerBadge: preset.defaultStreamerPlatform !== 'none',
          kickNeonGlow: false,
          kickVerifiedBadge: false,
          kickStatusPill: 'none',
          captionStyle: captionPreset.id,
          subtitleFont: captionPreset.subtitleFont || preset.defaultSubtitleFont,
          subtitleSize: preset.defaultSubtitleSize ?? history.present.subtitleSize,
          subtitleCasing: captionPreset.casing,
          subtitleWordsPerScreen: captionPreset.wordsPerScreen,
          subtitleBaseColor: captionPreset.baseColor,
          subtitleActiveColor: captionPreset.activeColor,
          subtitleEmphasisColor: captionPreset.emphasisColor,
          subtitleStrokeWidth: captionPreset.strokeWidth,
          subtitleStrokeColor: captionPreset.strokeColor,
          subtitleDropShadow: captionPreset.dropShadow,
          subtitleNeonGlow: captionPreset.neonGlow,
          subtitleAnimation: captionPreset.animation,
          subtitleBgStyle: preset.defaultSubtitleBg,
          subtitleX: 50,
          subtitleVerticalPos: preset.defaultSubtitleY ?? safeSpec.autoAlignSubtitlePct,
          safeZonePlatform: preset.defaultSafeZone || 'auto',
          cardTheme: preset.id === 'x_light' ? 'light' : 'dark',
        },
        true
      );
      notify(
        `Template applied: ${preset.fullName}${preset.defaultFullScreen ? ' (Full Screen 100%)' : ''}`
      );
    },
    [
      captionPresets,
      currentClipId,
      framingHistory.present.aspect,
      handleUpdateEditorSettings,
      history.present.headlineSize,
      history.present.subtitleSize,
      notify,
    ]
  );

  const handleSaveTemplate = useCallback(
    (saved: EditableTemplatePreset) => {
      setTemplateCatalog((prev) => upsertTemplateInCatalog(prev, saved, builtinTemplateIds));
      handleSelectTemplatePreset(saved);
      notify(`Saved template "${saved.name}"`);
    },
    [builtinTemplateIds, handleSelectTemplatePreset, notify]
  );

  const handleDeleteTemplate = useCallback(
    (id: string) => {
      if (templates.length <= 1) {
        notify('At least one template must remain active');
        return;
      }
      const target = templates.find((t) => t.id === id);
      setTemplateCatalog((prev) => deleteTemplateFromCatalog(prev, id, TEMPLATE_PRESETS));
      if (history.present.template === id) {
        const fallback = templates.find((t) => t.id !== id);
        if (fallback) handleSelectTemplatePreset(fallback);
      }
      notify(`Deleted template "${target?.name || id}"`);
    },
    [handleSelectTemplatePreset, history.present.template, notify, templates]
  );

  const handleRestoreTemplates = useCallback(() => {
    setTemplateCatalog((prev) => ({
      ...prev,
      editedBuiltins: {},
      deletedIds: [],
    }));
    notify('Restored all built-in templates');
  }, [notify]);

  const handleSelectCaptionPreset = useCallback(
    (captionPreset: EditableCaptionPreset) => {
      handleUpdateEditorSettings(
        {
          captionStyle: captionPreset.id,
          subtitleFont: captionPreset.subtitleFont,
          subtitleCasing: captionPreset.casing,
          subtitleWordsPerScreen: captionPreset.wordsPerScreen,
          subtitleBaseColor: captionPreset.baseColor,
          subtitleActiveColor: captionPreset.activeColor,
          subtitleEmphasisColor: captionPreset.emphasisColor,
          subtitleStrokeWidth: captionPreset.strokeWidth,
          subtitleStrokeColor: captionPreset.strokeColor,
          subtitleDropShadow: captionPreset.dropShadow,
          subtitleNeonGlow: captionPreset.neonGlow,
          subtitleAnimation: captionPreset.animation,
        },
        true
      );
      notify(`Caption style applied: ${captionPreset.name}`);
    },
    [handleUpdateEditorSettings, notify]
  );

  const handleAddCaptionStyle = useCallback(
    (style: EditableCaptionPreset) => {
      setCaptionCatalog((prev) => addCaptionStyleToCatalog(prev, style));
      notify(`Saved caption style "${style.name}"`);
    },
    [notify]
  );

  const handleDeleteCaptionStyle = useCallback(
    (id: string) => {
      if (captionPresets.length <= 1) {
        notify('At least one caption style must remain');
        return;
      }
      const target = captionPresets.find((c) => c.id === id);
      setCaptionCatalog((prev) => deleteCaptionStyleFromCatalog(prev, id, VIRAL_CAPTION_PRESETS));
      notify(`Deleted caption style "${target?.name || id}"`);
    },
    [captionPresets, notify]
  );

  const handleRestoreCaptions = useCallback(() => {
    setCaptionCatalog((prev) => ({ ...prev, deletedIds: [] }));
    notify('Restored all built-in caption styles');
  }, [notify]);

  const handleUploadCustomFont = useCallback(
    async (file: File) => {
      try {
        const entry = await registerCustomFontFile(file);
        setCustomFonts((prev) => {
          const filtered = prev.filter((f) => f.family !== entry.family);
          return [...filtered, entry];
        });
        if (page === 'shorts') {
          handleUpdateEditorSettings({ subtitleFont: entry.family }, true);
        } else {
          setBatchSettings((prev) => ({ ...prev, subtitleFont: entry.family }));
        }
        notify(`Loaded custom font: ${entry.family}`);
      } catch {
        notify('Could not load font file — upload a valid .ttf or .otf file');
      }
    },
    [handleUpdateEditorSettings, notify, page]
  );

  const handleAddGoogleFont = useCallback(
    (familyName: string) => {
      const entry = registerGoogleFontByName(familyName);
      setCustomFonts((prev) => {
        const filtered = prev.filter(
          (f) => f.family.toLowerCase() !== entry.family.toLowerCase()
        );
        return [...filtered, entry];
      });
      handleUpdateEditorSettings({ font: entry.family, subtitleFont: entry.family }, true);
      notify(`Added Google Font "${entry.family}"`);
    },
    [handleUpdateEditorSettings, notify]
  );

  const handleDeleteCustomFont = useCallback(
    (id: string) => {
      setCustomFonts((prev) => prev.filter((f) => f.id !== id));
      notify('Removed custom font');
    },
    [notify]
  );

  const handleUploadLogo = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) return;
        const cleanName = file.name.replace(/\.[^.]+$/, '') || 'Custom Logo';
        const asset: LogoAsset = {
          id: `logo-custom-${Date.now()}`,
          name: cleanName,
          dataUrl,
          isCustom: true,
        };
        setCustomLogos((prev) => [asset, ...prev]);
        setBrandKit((prev) => ({ ...prev, showWatermark: true }));
        handleUpdateShorts({
          dualWatermark: {
            ...shortsConfig.dualWatermark,
            useCustomLogo: true,
            customLogoUrl: dataUrl,
            customLogoName: cleanName,
          },
        });
        notify(`Saved & applied logo "${cleanName}"`);
      };
      reader.readAsDataURL(file);
    },
    [handleUpdateShorts, notify, shortsConfig.dualWatermark]
  );

  const handleDeleteLogo = useCallback(
    (id: string) => {
      setCustomLogos((prev) => prev.filter((l) => l.id !== id));
      notify('Deleted custom logo');
    },
    [notify]
  );

  const handleUpdateClipHashtags = useCallback(
    (clipId: string, hashtags: string[]) => {
      const normalized = Array.from(
        new Set(hashtags.map((h) => h.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))
      );
      setClips((prev) =>
        prev.map((c) => (c.id === clipId ? { ...c, hashtags: normalized } : c))
      );
      if (!clipId.startsWith('local-clip-')) {
        tryServerApi(`/api/clips/${clipId}/metadata`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hashtags: normalized }),
        }).catch(() => {});
      }
    },
    []
  );

  // Dashboard: Real local browser file import OR real Rust backend /api/jobs submission
  const handleCreateJob = useCallback(
    async (payload: {
      url: string;
      sourceTitle: string;
      platform: JobItem['platform'];
      streamerHandle?: string;
      template: string;
      maxClips: number;
      burnCaptions: boolean;
      localFile?: File;
    }): Promise<boolean> => {
      // 1. Direct browser-local video file import (real HTML5 playable <video> via Object URL)
      if (payload.localFile) {
        const preset = getTemplatePreset(payload.template);
        const mediaUrl = URL.createObjectURL(payload.localFile);
        const clipId = `local-clip-${Date.now()}`;
        const jobId = `local-job-${Date.now()}`;
        const cleanTitle = payload.sourceTitle.replace(/\.[^.]+$/, '') || payload.localFile.name;

        const importedClip: ClipItem = {
          id: clipId,
          title: cleanTitle,
          template: preset.id,
          status: 'Ready',
          confidence: 1,
          channel: payload.streamerHandle || 'Local Video',
          streamerHandle: payload.streamerHandle || '',
          platform: 'Local',
          duration_sec: 30,
          description: `Imported local file (${(payload.localFile.size / (1024 * 1024)).toFixed(1)} MB)`,
          transcript_snippet: '',
          hashtags: [],
          created_at_ms: Date.now(),
          aspect: '9:16',
          layout: preset.defaultLayout,
          caption_style: preset.defaultCaptionStyle,
          canvas: 'solid',
          font: preset.defaultHeadlineFont,
          subtitleFont: preset.defaultSubtitleFont,
          mediaUrl,
          words: [],
        };

        const importedJob: JobItem = {
          id: jobId,
          url: payload.localFile.name,
          sourceTitle: cleanTitle,
          platform: 'Local',
          streamerHandle: payload.streamerHandle,
          template: preset.id,
          maxClips: 1,
          burnCaptions: payload.burnCaptions,
          status: 'done',
          progress: 100,
          message: 'Loaded local video into Framing Studio',
          clip_ids: [clipId],
          created_at_ms: Date.now(),
        };

        const initialBlueprint = createDefaultFramingBlueprint(preset.defaultLayout, '9:16');
        const initialShorts = createDefaultShortsProduction();
        blueprintsByClipIdRef.current[clipId] = initialBlueprint;
        shortsByClipIdRef.current[clipId] = initialShorts;

        setClips((prev) => [importedClip, ...prev]);
        setJobs((prev) => [importedJob, ...prev]);
        setCurrentClipId(clipId);
        setHistory(createHistory(createEditorSettingsForClip(importedClip, brandKit)));
        setFramingHistory(createHistory(initialBlueprint));
        setShortsConfig(initialShorts);
        setPage('framing');
        notify(`Loaded "${cleanTitle}" into Framing Studio`);
        return true;
      }

      // 2. Remote stream / YouTube / Kick / Twitch URL or server file path → real POST /api/jobs
      const serverRes = await requestServerApi<{ job?: Partial<JobItem> & Record<string, unknown> }>(
        '/api/jobs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: payload.url,
            max_clips: payload.maxClips,
            template: payload.template,
            streamer_handle: payload.streamerHandle,
            burn_captions: payload.burnCaptions,
          }),
        }
      );

      if (!serverRes.ok) {
        notify(serverRes.error);
        return false;
      }

      const normalizedJob = serverRes.data.job
        ? normalizeServerJob(
            {
              ...serverRes.data.job,
              sourceTitle: payload.sourceTitle,
              platform: payload.platform,
              streamerHandle: payload.streamerHandle,
              template: payload.template,
              maxClips: payload.maxClips,
              burnCaptions: payload.burnCaptions,
            },
            0
          )
        : normalizeServerJob(
            {
              id: `job-${Date.now()}`,
              url: payload.url,
              sourceTitle: payload.sourceTitle,
              platform: payload.platform,
              streamerHandle: payload.streamerHandle,
              template: payload.template,
              maxClips: payload.maxClips,
              burnCaptions: payload.burnCaptions,
              status: 'queued',
              progress: 5,
              message: 'Queued on PulseCut server',
            },
            0
          );

      setJobs((prev) => [normalizedJob, ...prev.filter((j) => j.id !== normalizedJob.id)]);
      notify('Ingest job queued on PulseCut backend');
      return true;
    },
    [brandKit, notify]
  );

  const handleRefreshJobs = useCallback(async () => {
    const data = await fetchWorkspaceData();
    if (!data.connectedToBackend) {
      notify('PulseCut backend offline — start Rust server on 127.0.0.1:8756');
      return;
    }
    setClips((prev) => mergeServerWithLocalClips(prev, data.clips));
    setJobs((prev) => mergeServerWithLocalJobs(prev, data.jobs));
    notify(`Synced ${data.jobs.length} job${data.jobs.length === 1 ? '' : 's'} & ${data.clips.length} clip${data.clips.length === 1 ? '' : 's'}`);
  }, [notify]);

  // Clips actions
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleApproveClips = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      await Promise.all(
        ids
          .filter((id) => !id.startsWith('local-clip-'))
          .map((id) => tryServerApi(`/api/clips/${id}/approve`, { method: 'POST' }))
      );
      setClips((prev) =>
        prev.map((c) => (ids.includes(c.id) ? { ...c, status: 'Approved' } : c))
      );
      notify(ids.length === 1 ? 'Clip approved' : `Approved ${ids.length} clips`);
    },
    [notify]
  );

  const handleRejectClips = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      await Promise.all(
        ids
          .filter((id) => !id.startsWith('local-clip-'))
          .map((id) => tryServerApi(`/api/clips/${id}/reject`, { method: 'POST' }))
      );
      setClips((prev) =>
        prev.map((c) => (ids.includes(c.id) ? { ...c, status: 'Rejected' } : c))
      );
      notify(ids.length === 1 ? 'Clip rejected' : `Rejected ${ids.length} clips`);
    },
    [notify]
  );

  const handleDeleteClip = useCallback(
    async (id: string) => {
      if (!id.startsWith('local-clip-')) {
        await tryServerApi(`/api/clips/${id}/delete`, { method: 'POST' });
      }
      setClips((prev) => {
        const target = prev.find((c) => c.id === id);
        if (target?.mediaUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(target.mediaUrl);
        }
        return prev.filter((c) => c.id !== id);
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (currentClipId === id) {
        setCurrentClipId(null);
      }
      notify('Clip removed from library');
    },
    [currentClipId, notify]
  );

  const handleCopyMetadata = useCallback(
    (clip: ClipItem) => {
      const tags = clip.hashtags.length
        ? `\n\n${clip.hashtags.map((h) => `#${h}`).join(' ')}`
        : '';
      const text = `${clip.title}${tags}`;
      navigator.clipboard?.writeText(text).catch(() => {});
      notify('Copied title & hashtags');
    },
    [notify]
  );

  const handleBatchRestyle = useCallback(
    async (ids: string[], settings: BatchRestyleSettings) => {
      const captionPreset = getViralCaptionPreset(settings.captionStyle);
      await Promise.all(
        ids
          .filter((id) => !id.startsWith('local-clip-'))
          .map((id) =>
            tryServerApi(`/api/clips/${id}/configure`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                template: settings.template,
                font: settings.font,
                subtitle_font: settings.subtitleFont,
                subtitle_style: captionPreset.id,
                aspect: settings.aspect,
                layout: settings.layout,
                canvas: settings.canvas,
                outro: settings.outroText,
                social: settings.handle ? { handle: settings.handle, style: 'verified' } : null,
                audio_peak: settings.audioPeak,
                audio_peak_ms: 5000,
              }),
            })
          )
      );

      setClips((prev) =>
        prev.map((c) =>
          ids.includes(c.id)
            ? {
                ...c,
                template: settings.template,
                aspect: settings.aspect,
                layout: settings.layout,
                caption_style: captionPreset.id,
                canvas: settings.canvas,
                font: settings.font,
                subtitleFont: settings.subtitleFont,
                outroText: settings.outroText,
                audioPeak: settings.audioPeak,
                status: 'Ready',
              }
            : c
        )
      );

      // Keep cached drafts, blueprints, and currently active clip synchronized with Batch Restyle
      ids.forEach((id) => {
        delete draftsByClipIdRef.current[id];
        delete blueprintsByClipIdRef.current[id];
      });
      if (currentClipId && ids.includes(currentClipId)) {
        const templatePreset = getTemplatePreset(settings.template);
        const safeSpec = getSafeZoneSpec('auto', templatePreset.id);
        const facecamDefaults = getFacecamPresetDefaults(templatePreset);
        setFramingHistory((prev) => {
          const nextBp: FramingBlueprint = {
            ...prev.present,
            aspect: settings.aspect,
            layout: settings.layout,
            crops: reconcileCrops(
              settings.layout,
              settings.aspect,
              16 / 9,
              prev.present.crops,
              { splitRatio: prev.present.splitRatio, pip: prev.present.pip }
            ),
          };
          return pushHistory(prev, nextBp);
        });
        setHistory((prev) =>
          pushHistory(prev, {
            ...prev.present,
            template: settings.template,
            templateEnabled: true,
            aspect: settings.aspect,
            layout: settings.layout,
            canvas: settings.canvas,
            font: settings.font,
            subtitleFont: settings.subtitleFont,
            headlineLayout: templatePreset.defaultHeadlineLayout,
            ...facecamDefaults,
            streamerPlatform: templatePreset.defaultStreamerPlatform,
            showStreamerBadge: templatePreset.defaultStreamerPlatform !== 'none',
            captionStyle: captionPreset.id,
            subtitleCasing: captionPreset.casing,
            subtitleWordsPerScreen: captionPreset.wordsPerScreen,
            subtitleBaseColor: captionPreset.baseColor,
            subtitleActiveColor: captionPreset.activeColor,
            subtitleEmphasisColor: captionPreset.emphasisColor,
            subtitleStrokeWidth: captionPreset.strokeWidth,
            subtitleStrokeColor: captionPreset.strokeColor,
            subtitleDropShadow: captionPreset.dropShadow,
            subtitleNeonGlow: captionPreset.neonGlow,
            subtitleAnimation: captionPreset.animation,
            subtitleBgStyle: templatePreset.defaultSubtitleBg,
            subtitleX: 50,
            subtitleVerticalPos: safeSpec.autoAlignSubtitlePct,
            safeZonePlatform: 'auto',
            outroText: settings.outroText,
            audioPeak: settings.audioPeak,
          })
        );
      }

      setSelectedIds(new Set());
      notify(
        `Applied ${getTemplatePreset(settings.template).name} to ${ids.length} clip${ids.length === 1 ? '' : 's'}`
      );
    },
    [currentClipId, notify]
  );

  const handleFrameClip = useCallback(
    (id: string) => {
      selectEditorClip(id);
      setPage('framing');
    },
    [selectEditorClip]
  );

  const handleEditClip = useCallback(
    (id: string) => {
      selectEditorClip(id);
      setPage('shorts');
    },
    [selectEditorClip]
  );

  const handleUpdateClipDuration = useCallback((clipId: string, durationSec: number) => {
    setClips((prev) =>
      prev.map((clip) =>
        clip.id === clipId && Math.abs(clip.duration_sec - durationSec) > 0.2
          ? { ...clip, duration_sec: durationSec }
          : clip
      )
    );
  }, []);

  const handleImportSrtCues = useCallback(
    (clipId: string, cues: WordCue[]) => {
      const snippet = cues
        .slice(0, 4)
        .map((c) => c.text)
        .join(' ');
      setClips((prev) =>
        prev.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                words: cues,
                transcript_snippet: snippet || clip.transcript_snippet,
              }
            : clip
        )
      );
      notify(`Imported ${cues.length} subtitle cue${cues.length === 1 ? '' : 's'} onto CC track`);
    },
    [notify]
  );

  const handleUpdateClipWords = useCallback((clipId: string, words: WordCue[]) => {
    const snippet = words
      .slice(0, 6)
      .map((w) => w.text)
      .join(' ');
    setClips((prev) =>
      prev.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              words,
              transcript_snippet: snippet || clip.transcript_snippet,
            }
          : clip
      )
    );
  }, []);

  const handleExportClip = useCallback(
    async (trimInSec: number, trimOutSec: number) => {
      if (!currentClip) return;
      const payload = buildConfigurePayload(history.present, brandKit, trimInSec, trimOutSec);

      draftsByClipIdRef.current[currentClip.id] = history.present;
      setClips((prev) =>
        prev.map((c) =>
          c.id === currentClip.id
            ? {
                ...c,
                template: history.present.template,
                aspect: history.present.aspect,
                layout: history.present.layout,
                caption_style: normalizeCaptionPresetId(history.present.captionStyle),
                canvas: history.present.canvas,
                font: history.present.font,
                subtitleFont: history.present.subtitleFont,
                outroText: history.present.outroText,
                audioPeak: history.present.audioPeak,
                streamerHandle: history.present.streamerHandle || c.streamerHandle,
                title: history.present.headline || c.title,
                status: 'Ready',
              }
            : c
        )
      );

      if (currentClip.id.startsWith('local-clip-')) {
        notify(
          `Saved ${history.present.aspect} edit (${getTemplatePreset(history.present.template).name}) — copy FFmpeg command or connect backend to render MP4`
        );
        return;
      }

      const res = await requestServerApi(`/api/clips/${currentClip.id}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        notify(`Saved locally, but server render failed: ${res.error}`);
        return;
      }

      notify(
        `Rendered ${history.present.aspect} video (${getTemplatePreset(history.present.template).name})`
      );
    },
    [currentClip, history.present, brandKit, notify]
  );

  const activeJobCount = jobs.filter(
    (j) =>
      j.status === 'queued' ||
      j.status === 'downloading' ||
      j.status === 'clipping' ||
      j.status === 'rendering'
  ).length;

  return (
    <div className="min-h-dvh bg-[var(--pc-bg)] text-[var(--pc-ink)]">
      {/* Global Header renders on Dashboard, Live Streams & Clips — Framing Studio & Shorts Studio each use a single unified 48px Studio Bar */}
      {(page === 'dashboard' || page === 'live' || page === 'clips') && (
        <AppHeader
          page={page}
          onNavigate={setPage}
          clipCount={clips.length}
          activeJobCount={activeJobCount}
          activeMonitorCount={liveMonitors.length}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenBrandKit={() => setBrandKitOpen(true)}
          brandKit={brandKit}
        />
      )}

      {page === 'dashboard' && (
        <DashboardPage
          jobs={jobs}
          templates={templates}
          onCreateJob={handleCreateJob}
          onRefreshJobs={handleRefreshJobs}
          onOpenClips={() => setPage('clips')}
          onOpenLiveStreams={() => setPage('live')}
          activeMonitorCount={liveMonitors.length}
        />
      )}

      {page === 'live' && (
        <LiveStreamsPage
          monitors={liveMonitors}
          monitorConfig={monitorConfig}
          connectedToBackend={backendConnected}
          templates={templates}
          onStartMonitors={handleStartMonitors}
          onSaveMonitorConfig={handleSaveMonitorConfig}
          onPauseMonitor={handlePauseMonitor}
          onToggleAutoClip={handleToggleAutoClip}
          onManualClipMonitor={handleManualClipMonitor}
          onStopMonitor={handleStopMonitor}
          onRefreshMonitors={refreshLiveMonitors}
          onOpenClips={() => setPage('clips')}
        />
      )}

      {page === 'clips' && (
        <ClipsPage
          clips={clips}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={(ids) => setSelectedIds(new Set(ids))}
          onClearSelection={() => setSelectedIds(new Set())}
          onFrameClip={handleFrameClip}
          onEditClip={handleEditClip}
          onApproveClips={handleApproveClips}
          onRejectClips={handleRejectClips}
          onDeleteClip={handleDeleteClip}
          onCopyMetadata={handleCopyMetadata}
          onBatchRestyle={handleBatchRestyle}
          batchSettings={batchSettings}
          customFonts={customFonts}
          onUploadCustomFont={handleUploadCustomFont}
          onChangeBatchSettings={handleChangeBatchSettings}
          onGoToDashboard={() => setPage('dashboard')}
        />
      )}

      {/* SECTION 1 — Framing Studio (Framing-only workspace: crops, layouts, split, PiP, backdrop, corners, speed) */}
      {page === 'framing' && (
        <FramingPage
          clips={clips}
          currentClip={currentClip}
          onSelectClip={selectEditorClip}
          onBackToClips={() => setPage('clips')}
          onGoToDashboard={() => setPage('dashboard')}
          onProceedToShorts={() => {
            if (currentClip) {
              blueprintsByClipIdRef.current[currentClip.id] = framingHistory.present;
            }
            setPage('shorts');
            notify(
              `Framing applied (${framingHistory.present.aspect} · ${framingHistory.present.layout}) — ready to make short`
            );
          }}
          blueprint={framingHistory.present}
          onUpdateBlueprint={handleUpdateBlueprint}
          canUndo={framingHistory.past.length > 0}
          canRedo={framingHistory.future.length > 0}
          onUndo={() => {
            setFramingHistory((h) => undoHistory(h));
            notify('Undid framing change');
          }}
          onRedo={() => {
            setFramingHistory((h) => redoHistory(h));
            notify('Redid framing change');
          }}
          onUpdateClipDuration={handleUpdateClipDuration}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onNotify={notify}
        />
      )}

      {/* SECTION 2 — Shorts Studio (Makes shorts according to Section 1's Framing Blueprint: templates, segments, captions, audio, SFX, outro, export) */}
      {page === 'shorts' && (
        <ShortsPage
          clips={clips}
          currentClip={currentClip}
          onSelectClip={selectEditorClip}
          onBackToFraming={() => setPage('framing')}
          onBackToClips={() => setPage('clips')}
          onGoToDashboard={() => setPage('dashboard')}
          blueprint={framingHistory.present}
          onUpdateBlueprint={handleUpdateBlueprint}
          shorts={shortsConfig}
          onUpdateShorts={handleUpdateShorts}
          settings={history.present}
          onUpdateSettings={handleUpdateEditorSettings}
          templates={templates}
          captionPresets={captionPresets}
          logos={logos}
          canRestoreTemplates={canRestoreTemplates}
          canRestoreCaptions={canRestoreCaptions}
          onSelectTemplatePreset={handleSelectTemplatePreset}
          onSaveTemplate={handleSaveTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onRestoreTemplates={handleRestoreTemplates}
          onSelectCaptionPreset={handleSelectCaptionPreset}
          onAddCaptionStyle={handleAddCaptionStyle}
          onDeleteCaptionStyle={handleDeleteCaptionStyle}
          onRestoreCaptions={handleRestoreCaptions}
          onUploadCustomFont={handleUploadCustomFont}
          onAddGoogleFont={handleAddGoogleFont}
          onDeleteCustomFont={handleDeleteCustomFont}
          onUploadLogo={handleUploadLogo}
          onDeleteLogo={handleDeleteLogo}
          onUpdateClipHashtags={handleUpdateClipHashtags}
          onUpdateClipWords={handleUpdateClipWords}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={() => {
            setHistory((h) => undoHistory(h));
            notify('Undid shorts edit');
          }}
          onRedo={() => {
            setHistory((h) => redoHistory(h));
            notify('Redid shorts edit');
          }}
          brandKit={brandKit}
          onUpdateBrandKit={handleUpdateBrandKit}
          customFonts={customFonts}
          onImportSrtCues={handleImportSrtCues}
          onUpdateClipDuration={handleUpdateClipDuration}
          onExportClip={handleExportClip}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onNotify={notify}
        />
      )}

      <ShortcutsAboutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <BrandKitModal
        open={brandKitOpen}
        brandKit={brandKit}
        onChange={handleUpdateBrandKit}
        onClose={() => setBrandKitOpen(false)}
      />
      <Toast message={toastMsg} />
    </div>
  );
}

export default App;
