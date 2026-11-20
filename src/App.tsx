import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BatchRestyleSettings,
  BrandKit,
  ClipItem,
  CustomFontEntry,
  EditorSettings,
  JobItem,
  PageId,
  WordCue,
} from './types';
import {
  DEFAULT_FACECAM_SOURCE_BOX,
  DEFAULT_SPEAKER_CROPS,
  GRADIENT_PRESETS,
  getTemplatePreset,
  WATERMARK_POSITIONS,
  type TemplatePreset,
} from './presets';
import {
  getSafeZoneSpec,
  getViralCaptionPreset,
  normalizeCaptionPresetId,
  registerCustomFontFile,
  type ViralCaptionPreset,
} from './captionStyles';
import {
  buildConfigurePayload,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type HistoryStack,
} from './lib/studioLogic';
import {
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
import { ClipsPage } from './pages/ClipsPage';
import { EditorPage } from './pages/EditorPage';

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
  const preset = getTemplatePreset(clip?.template || 'kick-stream');
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
  const [customFonts, setCustomFonts] = useState<CustomFontEntry[]>([]);

  const [brandKit, setBrandKit] = useState<BrandKit>(DEFAULT_BRAND_KIT);
  const [history, setHistory] = useState<HistoryStack<EditorSettings>>(() =>
    createHistory(createEditorSettingsForClip(null, DEFAULT_BRAND_KIT))
  );

  const [batchSettings, setBatchSettings] = useState<BatchRestyleSettings>({
    template: 'kick-stream',
    font: 'TikTok Sans',
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
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const draftsByClipIdRef = useRef<Record<string, EditorSettings>>({});

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
      if (!active || !data.connectedToBackend) return;
      setClips((prev) => mergeServerWithLocalClips(prev, data.clips));
      setJobs((prev) => mergeServerWithLocalJobs(prev, data.jobs));
      if (data.clips[0]) {
        setCurrentClipId((prevId) => {
          if (prevId) return prevId;
          setHistory(createHistory(createEditorSettingsForClip(data.clips[0], DEFAULT_BRAND_KIT)));
          return data.clips[0].id;
        });
      }
    });
    return () => {
      active = false;
    };
  }, []);

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
          setHistory(createHistory(createEditorSettingsForClip(data.clips[0], brandKit)));
          return data.clips[0].id;
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
      }
      setCurrentClipId(clipId);
      const found = clips.find((c) => c.id === clipId) ?? null;
      const restored =
        clipId && draftsByClipIdRef.current[clipId]
          ? draftsByClipIdRef.current[clipId]
          : createEditorSettingsForClip(found, brandKit);
      setHistory(createHistory(restored));
    },
    [clips, brandKit, currentClipId, history.present]
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

  const handleSelectTemplatePreset = useCallback(
    (preset: TemplatePreset) => {
      const captionPreset = getViralCaptionPreset(preset.defaultCaptionStyle);
      const safeSpec = getSafeZoneSpec('auto', preset.id);
      const facecamDefaults = getFacecamPresetDefaults(preset);
      handleUpdateEditorSettings(
        {
          template: preset.id,
          templateEnabled: true,
          layout: preset.defaultLayout,
          outerFill: preset.defaultOuterFill,
          font: preset.defaultHeadlineFont,
          headlineLayout: preset.defaultHeadlineLayout,
          headlineX: 50,
          headlineY: 22,
          headlineCasing: 'asis',
          ...facecamDefaults,
          streamerPlatform: preset.defaultStreamerPlatform,
          showStreamerBadge: preset.defaultStreamerPlatform !== 'none',
          kickNeonGlow: false,
          kickVerifiedBadge: false,
          kickStatusPill: 'none',
          captionStyle: captionPreset.id,
          subtitleFont: captionPreset.subtitleFont || preset.defaultSubtitleFont,
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
          subtitleVerticalPos: safeSpec.autoAlignSubtitlePct,
          safeZonePlatform: 'auto',
          cardTheme: preset.id === 'x_light' ? 'light' : 'dark',
          cornerRadius: preset.defaultCornerRadius ?? (preset.hasCard ? 12 : 0),
          framePadding: preset.hasCard ? 12 : 0,
        },
        true
      );
      notify(`Template switched to ${preset.fullName} (${captionPreset.name})`);
    },
    [handleUpdateEditorSettings, notify]
  );

  const handleSelectCaptionPreset = useCallback(
    (captionPreset: ViralCaptionPreset) => {
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

  const handleUploadCustomFont = useCallback(
    async (file: File) => {
      try {
        const entry = await registerCustomFontFile(file);
        setCustomFonts((prev) => {
          const filtered = prev.filter((f) => f.family !== entry.family);
          return [...filtered, entry];
        });
        if (page === 'editor') {
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
          message: 'Loaded local video directly into Studio Editor',
          clip_ids: [clipId],
          created_at_ms: Date.now(),
        };

        setClips((prev) => [importedClip, ...prev]);
        setJobs((prev) => [importedJob, ...prev]);
        setCurrentClipId(clipId);
        setHistory(createHistory(createEditorSettingsForClip(importedClip, brandKit)));
        setPage('editor');
        notify(`Loaded "${cleanTitle}" into Studio Editor`);
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

      // Keep cached drafts and currently active Editor clip synchronized with Batch Restyle
      ids.forEach((id) => {
        delete draftsByClipIdRef.current[id];
      });
      if (currentClipId && ids.includes(currentClipId)) {
        const templatePreset = getTemplatePreset(settings.template);
        const safeSpec = getSafeZoneSpec('auto', templatePreset.id);
        const facecamDefaults = getFacecamPresetDefaults(templatePreset);
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

  const handleEditClip = useCallback(
    (id: string) => {
      selectEditorClip(id);
      setPage('editor');
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

  const handleUpdateCueWord = useCallback((clipId: string, index: number, text: string) => {
    setClips((prev) =>
      prev.map((clip) => {
        if (clip.id !== clipId) return clip;
        const words = clip.words.map((w, i) => (i === index ? { ...w, text } : w));
        return { ...clip, words };
      })
    );
  }, []);

  const handleSetWordEmphasis = useCallback(
    (clipId: string, cueIndex: number, tokenIndex: number, color: string | null) => {
      setClips((prev) =>
        prev.map((clip) => {
          if (clip.id !== clipId) return clip;
          const words = clip.words.map((w, i) => {
            if (i !== cueIndex) return w;
            const nextEmphasis: Record<number, string> = { ...(w.wordEmphasis || {}) };
            if (color === null) {
              delete nextEmphasis[tokenIndex];
            } else {
              nextEmphasis[tokenIndex] = color;
            }
            return { ...w, wordEmphasis: nextEmphasis };
          });
          return { ...clip, words };
        })
      );
    },
    []
  );

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
      {/* Global Header renders ONLY on Dashboard & Clips — Editor uses its single unified 48px Studio Bar */}
      {page !== 'editor' && (
        <AppHeader
          page={page}
          onNavigate={setPage}
          clipCount={clips.length}
          activeJobCount={activeJobCount}
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
          onCreateJob={handleCreateJob}
          onRefreshJobs={handleRefreshJobs}
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

      {page === 'editor' && (
        <EditorPage
          clips={clips}
          currentClip={currentClip}
          onSelectClip={selectEditorClip}
          onBackToClips={() => setPage('clips')}
          onGoToDashboard={() => setPage('dashboard')}
          settings={history.present}
          onUpdateSettings={handleUpdateEditorSettings}
          onSelectTemplatePreset={handleSelectTemplatePreset}
          onSelectCaptionPreset={handleSelectCaptionPreset}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={() => {
            setHistory((h) => undoHistory(h));
            notify('Undid last change');
          }}
          onRedo={() => {
            setHistory((h) => redoHistory(h));
            notify('Redid change');
          }}
          brandKit={brandKit}
          onUpdateBrandKit={handleUpdateBrandKit}
          customFonts={customFonts}
          onUploadCustomFont={handleUploadCustomFont}
          onImportSrtCues={handleImportSrtCues}
          onUpdateCueWord={handleUpdateCueWord}
          onSetWordEmphasis={handleSetWordEmphasis}
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
