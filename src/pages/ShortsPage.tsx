import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Bot,
  ChevronDown,
  Crop,
  Download,
  Film,
  HelpCircle,
  Moon,
  Plus,
  Redo2,
  Scan,
  Scissors,
  Sun,
  Undo2,
} from 'lucide-react';
import type {
  BrandKit,
  ClipItem,
  ClipSegment,
  CustomFontEntry,
  EditorSettings,
  FramingBlueprint,
  PreviewResolutionId,
  SfxAsset,
  ShortsProductionConfig,
  ShortsTabId,
  TrackStates,
  WordCue,
} from '../types';
import { getSafeZoneSpec } from '../captionStyles';
import {
  type EditableCaptionPreset,
  type EditableTemplatePreset,
  type LogoAsset,
} from '../lib/creatorCatalog';
import { clampTrimWindow, formatShortDuration, formatTimecode } from '../lib/studioLogic';
import {
  computeMusicOffset,
  computeMusicRiserVolume,
  computeStitchedDuration,
  findTriggeredSfxCues,
  getActiveSegments,
  mapSourceTimeToStitched,
  playSfxAsset,
  resolveStitchedPlaybackStep,
  sortSegments,
} from '../lib/shortsEngine';
import { Button } from '../components/ui/Primitives';
import { TemplateLibraryModal } from '../components/editor/TemplateLibraryModal';
import { TemplateEditorModal } from '../components/editor/TemplateEditorModal';
import { AgentInteropModal } from '../components/editor/AgentInteropModal';
import { FramingCanvas } from '../components/editor/FramingCanvas';
import { ShortsStage } from '../components/studio/ShortsStage';
import { ShortsTimeline } from '../components/studio/ShortsTimeline';
import { ShortsInspector } from '../components/studio/ShortsInspector';
import { ShortsExportModal } from '../components/studio/ShortsExportModal';

interface ShortsPageProps {
  clips: ClipItem[];
  currentClip: ClipItem | null;
  onSelectClip: (id: string | null) => void;
  onBackToFraming: () => void;
  onBackToClips: () => void;
  onGoToDashboard: () => void;
  blueprint: FramingBlueprint;
  onUpdateBlueprint: (next: FramingBlueprint, recordHistory?: boolean) => void;
  shorts: ShortsProductionConfig;
  onUpdateShorts: (patch: Partial<ShortsProductionConfig>) => void;
  settings: EditorSettings;
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  templates: readonly EditableTemplatePreset[];
  captionPresets: readonly EditableCaptionPreset[];
  logos: readonly LogoAsset[];
  canRestoreTemplates: boolean;
  canRestoreCaptions: boolean;
  onSelectTemplatePreset: (preset: EditableTemplatePreset) => void;
  onSaveTemplate: (preset: EditableTemplatePreset) => void;
  onDeleteTemplate: (id: string) => void;
  onRestoreTemplates: () => void;
  onSelectCaptionPreset: (preset: EditableCaptionPreset) => void;
  onAddCaptionStyle: (preset: EditableCaptionPreset) => void;
  onDeleteCaptionStyle: (id: string) => void;
  onRestoreCaptions: () => void;
  onUploadCustomFont: (file: File) => void;
  onAddGoogleFont: (familyName: string) => void;
  onDeleteCustomFont: (id: string) => void;
  onUploadLogo: (file: File) => void;
  onDeleteLogo: (id: string) => void;
  onUpdateClipHashtags: (clipId: string, hashtags: string[]) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  brandKit: BrandKit;
  onUpdateBrandKit: (next: BrandKit) => void;
  customFonts: readonly CustomFontEntry[];
  onImportSrtCues: (clipId: string, cues: WordCue[]) => void;
  onUpdateClipDuration: (clipId: string, durationSec: number) => void;
  onExportClip: (trimInSec: number, trimOutSec: number) => Promise<void>;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenShortcuts: () => void;
  onNotify: (msg: string) => void;
}

export function ShortsPage({
  clips,
  currentClip,
  onSelectClip,
  onBackToFraming,
  onBackToClips,
  onGoToDashboard,
  blueprint,
  onUpdateBlueprint,
  shorts,
  onUpdateShorts,
  settings,
  onUpdateSettings,
  templates,
  captionPresets,
  logos,
  canRestoreTemplates,
  canRestoreCaptions,
  onSelectTemplatePreset,
  onSaveTemplate,
  onDeleteTemplate,
  onRestoreTemplates,
  onSelectCaptionPreset,
  onAddCaptionStyle,
  onDeleteCaptionStyle,
  onRestoreCaptions,
  onUploadCustomFont,
  onAddGoogleFont,
  onDeleteCustomFont,
  onUploadLogo,
  onDeleteLogo,
  onUpdateClipHashtags,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  brandKit,
  onUpdateBrandKit,
  customFonts,
  onImportSrtCues,
  onUpdateClipDuration,
  onExportClip,
  theme,
  onToggleTheme,
  onOpenShortcuts,
  onNotify,
}: ShortsPageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const prevTimeRef = useRef(0);

  const [activeTab, setActiveTab] = useState<ShortsTabId>('templates');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EditableTemplatePreset | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);

  const [previewRes, setPreviewRes] = useState<PreviewResolutionId>('auto');
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [finalPreviewLocked, setFinalPreviewLocked] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [durationSec, setDurationSec] = useState(currentClip?.duration_sec || 30);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [trimInSec, setTrimInSec] = useState(0);
  const [trimOutSec, setTrimOutSec] = useState(currentClip?.duration_sec || 30);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [outroElapsedSec, setOutroElapsedSec] = useState<number | null>(null);
  const [trackStates, setTrackStates] = useState<TrackStates>({
    ccVisible: true,
    v1Visible: true,
    a1Muted: false,
    a2Muted: false,
  });

  const activeSegments = getActiveSegments(shorts, trimInSec, trimOutSec);
  const stitchedDurationSec = computeStitchedDuration(activeSegments, blueprint.speed);
  const stitchedTimeSec = mapSourceTimeToStitched(currentTimeSec, activeSegments, blueprint.speed);

  // Reset timeline on clip switch
  useEffect(() => {
    const dur = currentClip?.duration_sec || 30;
    setDurationSec(dur);
    setTrimInSec(0);
    setTrimOutSec(dur);
    setCurrentTimeSec(0);
    setPlaying(false);
    setOutroElapsedSec(null);
    prevTimeRef.current = 0;
  }, [currentClip?.id]);

  // Sync video playback speed (Framing blueprint × speed ramp) and master volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate =
        (settings.speedMultiplier ?? 1) * Math.max(0.25, Math.min(4, blueprint.speed || 1));
      videoRef.current.volume = Math.max(0, Math.min(1, (settings.masterVolume ?? 100) / 100));
    }
  }, [blueprint.speed, settings.speedMultiplier, settings.masterVolume, currentClip?.id]);

  // Sync play/pause with <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing && outroElapsedSec === null) {
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [playing, outroElapsedSec]);

  // Animated Outro playback runner
  useEffect(() => {
    if (outroElapsedSec === null) return;
    const totalOutro = Math.max(1, shorts.outro.duration || 3.5);
    const startTs = performance.now() - outroElapsedSec * 1000;
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = (now - startTs) / 1000;
      if (elapsed >= totalOutro) {
        setOutroElapsedSec(null);
        if (finalPreviewLocked && playing) {
          const firstStart = activeSegments[0]?.start ?? trimInSec;
          seekTo(firstStart);
        } else {
          setPlaying(false);
        }
        return;
      }
      setOutroElapsedSec(elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [outroElapsedSec !== null, shorts.outro.duration, finalPreviewLocked, playing]);

  // Real Background Music (A2) synced with decompiled HS riser surge math during Final Preview Lock
  useEffect(() => {
    const audio = bgmAudioRef.current;
    if (!audio || !settings.customAudioUrl) return;
    audio.muted = trackStates.a2Muted;

    const shouldPlayBgm = finalPreviewLocked && (playing || outroElapsedSec !== null);
    if (!shouldPlayBgm) {
      audio.pause();
      return;
    }

    const effectiveTime =
      outroElapsedSec !== null ? stitchedDurationSec + outroElapsedSec : stitchedTimeSec;
    const offset = computeMusicOffset(
      shorts.musicOffsetSec,
      shorts.musicDurationSec || audio.duration || 0,
      stitchedDurationSec
    );
    const desiredAudioPos = (effectiveTime + offset) % (audio.duration || Infinity);
    if (Number.isFinite(desiredAudioPos) && Math.abs(audio.currentTime - desiredAudioPos) > 0.6) {
      audio.currentTime = desiredAudioPos;
    }

    audio.volume = computeMusicRiserVolume(
      stitchedTimeSec,
      stitchedDurationSec,
      settings.audioBaseVol,
      settings.audioPeakVol,
      settings.riserDurationSec,
      outroElapsedSec !== null
    );
    if (audio.paused) audio.play().catch(() => {});
  }, [
    finalPreviewLocked,
    playing,
    outroElapsedSec,
    stitchedTimeSec,
    stitchedDurationSec,
    settings.customAudioUrl,
    settings.audioBaseVol,
    settings.audioPeakVol,
    settings.riserDurationSec,
    shorts.musicOffsetSec,
    shorts.musicDurationSec,
    trackStates.a2Muted,
  ]);

  // Close clip menu on outside click
  useEffect(() => {
    if (!projectMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [projectMenuOpen]);

  const seekTo = (sec: number) => {
    const clamped = Math.max(0, Math.min(Math.max(0.1, durationSec), sec));
    setCurrentTimeSec(clamped);
    prevTimeRef.current = clamped;
    if (videoRef.current) videoRef.current.currentTime = clamped;
  };

  const handleToggleFinalPreview = () => {
    const next = !finalPreviewLocked;
    setFinalPreviewLocked(next);
    setOutroElapsedSec(null);
    if (next) {
      const firstStart = activeSegments[0]?.start ?? trimInSec;
      const inRange = activeSegments.some(
        (s) => currentTimeSec >= s.start && currentTimeSec < s.end
      );
      if (!inRange) seekTo(firstStart);
      onNotify('Preview Locked — BGM riser, SFX cues & timed hooks active');
    } else {
      onNotify('Preview Unlocked — edit mode active');
    }
  };

  const handleVideoTimeUpdate = (t: number) => {
    const prev = prevTimeRef.current;
    prevTimeRef.current = t;
    setCurrentTimeSec(t);

    // Fire SFX cues & Headline In/Out SFX during Final Preview playback
    if (finalPreviewLocked && playing) {
      const triggered = findTriggeredSfxCues(prev, t, shorts.sfxCues);
      triggered.forEach((cue) => {
        const asset = shorts.sfxLibrary.find((a) => a.id === cue.sfxId);
        if (asset) playSfxAsset(asset, cue.volume);
      });

      if (shorts.headlineTiming.mode === 'custom') {
        const prevStitched = mapSourceTimeToStitched(prev, activeSegments, blueprint.speed);
        const currStitched = mapSourceTimeToStitched(t, activeSegments, blueprint.speed);
        if (
          shorts.headlineTiming.sfxIn &&
          prevStitched < shorts.headlineTiming.startSec &&
          currStitched >= shorts.headlineTiming.startSec
        ) {
          const asset = shorts.sfxLibrary.find((a) => a.id === shorts.headlineTiming.sfxIn);
          if (asset) playSfxAsset(asset, 0.9);
        }
        if (
          shorts.headlineTiming.sfxOut &&
          prevStitched < shorts.headlineTiming.endSec &&
          currStitched >= shorts.headlineTiming.endSec
        ) {
          const asset = shorts.sfxLibrary.find((a) => a.id === shorts.headlineTiming.sfxOut);
          if (asset) playSfxAsset(asset, 0.9);
        }
      }
    }

    // Multi-segment stitched stepping & end-of-clip Outro trigger
    if (playing && (shorts.multiSegmentEnabled || finalPreviewLocked)) {
      const step = resolveStitchedPlaybackStep(t, activeSegments);
      if (step.action === 'jump') {
        seekTo(step.targetTime);
      } else if (step.action === 'end') {
        if (finalPreviewLocked && shorts.outro.enabled) {
          videoRef.current?.pause();
          setOutroElapsedSec(0);
        } else if (finalPreviewLocked) {
          seekTo(activeSegments[0]?.start ?? trimInSec);
        } else {
          setPlaying(false);
        }
      }
    }
  };

  /** Shared by ShortsStage and the Frame tab's interactive source-frame editor. */
  const handleVideoMetadata = (dur: number) => {
    if (!currentClip) return;
    setDurationSec(dur);
    setTrimOutSec((prev) => (prev <= 0 || Math.abs(prev - 30) < 0.5 ? dur : Math.min(prev, dur)));
    onUpdateClipDuration(currentClip.id, dur);
  };

  const handleChangeTrimWindow = (inSec: number, outSec: number) => {
    const clamped = clampTrimWindow(inSec, outSec, durationSec);
    setTrimInSec(clamped.inSec);
    setTrimOutSec(clamped.outSec);
    if (shorts.multiSegmentEnabled && activeSegmentId) {
      const updated = sortSegments(
        shorts.segments.map((s) =>
          s.id === activeSegmentId ? { ...s, start: clamped.inSec, end: clamped.outSec } : s
        )
      );
      onUpdateShorts({ segments: updated });
    }
  };

  const handleToggleMultiSegment = () => {
    if (shorts.multiSegmentEnabled) {
      const first = shorts.segments[0];
      setActiveSegmentId(null);
      if (first) {
        setTrimInSec(first.start);
        setTrimOutSec(first.end);
      }
      onUpdateShorts({ multiSegmentEnabled: false, segments: [] });
      onNotify('Switched to single-clip trim mode');
    } else {
      const initial: ClipSegment = {
        id: `seg-${Date.now()}-1`,
        start: trimInSec,
        end: Math.max(trimInSec + 1, Math.min(durationSec, trimInSec + Math.min(8, trimOutSec - trimInSec))),
      };
      setActiveSegmentId(initial.id);
      setTrimInSec(initial.start);
      setTrimOutSec(initial.end);
      onUpdateShorts({ multiSegmentEnabled: true, segments: [initial] });
      onNotify('Multi-Segment mode enabled — add more sections to stitch');
    }
  };

  const handleAddSegment = () => {
    const existing = sortSegments(shorts.segments);
    // If single segment currently covers nearly the entire clip, split cleanly into 2 non-overlapping halves
    if (
      existing.length === 1 &&
      existing[0].start <= 0.25 &&
      existing[0].end >= durationSec - 0.5 &&
      durationSec >= 2
    ) {
      const mid = Number((durationSec / 2).toFixed(2));
      const firstHalf: ClipSegment = { ...existing[0], end: mid };
      const secondHalf: ClipSegment = {
        id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        start: mid,
        end: Number(durationSec.toFixed(2)),
      };
      const nextList = [firstHalf, secondHalf];
      setActiveSegmentId(secondHalf.id);
      setTrimInSec(secondHalf.start);
      setTrimOutSec(secondHalf.end);
      seekTo(secondHalf.start);
      onUpdateShorts({ multiSegmentEnabled: true, segments: nextList });
      onNotify(`Split into 2 segments (${mid.toFixed(1)}s + ${(durationSec - mid).toFixed(1)}s)`);
      return;
    }

    const lastEnd = existing.length ? existing[existing.length - 1].end : 0;
    const start = Math.min(
      Math.max(0, durationSec - 1.5),
      lastEnd + 0.5 < durationSec - 1 ? lastEnd + 0.5 : Math.max(0, currentTimeSec)
    );
    const end = Math.min(durationSec, start + Math.max(1.5, Math.min(5, durationSec - start)));
    const nextSeg: ClipSegment = {
      id: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      start: Number(start.toFixed(2)),
      end: Number(Math.max(start + 0.5, end).toFixed(2)),
    };
    const nextList = sortSegments([...existing, nextSeg]);
    setActiveSegmentId(nextSeg.id);
    setTrimInSec(nextSeg.start);
    setTrimOutSec(nextSeg.end);
    seekTo(nextSeg.start);
    onUpdateShorts({ multiSegmentEnabled: true, segments: nextList });
    onNotify(`Added Segment #${nextList.length} (${(nextSeg.end - nextSeg.start).toFixed(1)}s)`);
  };

  const handleRemoveSegment = (segId: string) => {
    const remaining = shorts.segments.filter((s) => s.id !== segId);
    if (remaining.length === 0) {
      handleToggleMultiSegment();
      return;
    }
    setActiveSegmentId(remaining[0].id);
    setTrimInSec(remaining[0].start);
    setTrimOutSec(remaining[0].end);
    onUpdateShorts({ segments: remaining });
    onNotify('Removed segment');
  };

  const handleAddSfxCueAtPlayhead = (asset: SfxAsset) => {
    const cue = {
      id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      sfxId: asset.id,
      name: asset.name,
      time: Number(currentTimeSec.toFixed(2)),
      volume: 0.9,
    };
    playSfxAsset(asset, 0.85);
    onUpdateShorts({
      sfxCues: [...shorts.sfxCues, cue].sort((a, b) => a.time - b.time),
    });
    onNotify(`Placed "${asset.name}" SFX at ${currentTimeSec.toFixed(1)}s`);
  };

  const handleRemoveSfxCue = (cueId: string) => {
    onUpdateShorts({ sfxCues: shorts.sfxCues.filter((c) => c.id !== cueId) });
    onNotify('Removed SFX cue');
  };

  const handleAutoAlignSubtitles = () => {
    const spec = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
    onUpdateSettings({ subtitleX: 50, subtitleVerticalPos: spec.autoAlignSubtitlePct }, true);
    setShowSafeZones(true);
    onNotify(`Aligned captions inside ${spec.label} safe zone (${spec.autoAlignSubtitlePct}%)`);
  };

  const handleSplitAtPlayhead = () => {
    if (!currentClip || durationSec <= 0) return;
    const nextSplits = [...(settings.splits || []), currentTimeSec].sort((a, b) => a - b);
    onUpdateSettings({ splits: nextSplits }, true);
    onNotify(`Split cut placed at ${formatTimecode(currentTimeSec)}`);
  };

  const handleAddMarker = (label?: string) => {
    if (!currentClip || durationSec <= 0) return;
    const newMarker = {
      id: `m-${Date.now()}`,
      timeSec: currentTimeSec,
      label: label || `Marker ${formatTimecode(currentTimeSec)}`,
    };
    const nextMarkers = [...(settings.markers || []), newMarker].sort(
      (a, b) => a.timeSec - b.timeSec
    );
    onUpdateSettings({ markers: nextMarkers }, true);
    onNotify(`Marker added at ${formatTimecode(currentTimeSec)}`);
  };

  const handleExport = async () => {
    if (!currentClip) {
      onNotify('Load a clip before exporting');
      return;
    }
    setExporting(true);
    try {
      await onExportClip(trimInSec, trimOutSec);
      setExportModalOpen(true);
    } finally {
      setExporting(false);
    }
  };

  // Keyboard shortcuts (Space, Frame step, I/O trim, Shift+L Final Preview Lock, Ctrl+Z/Y)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space' && currentClip) {
      e.preventDefault();
      setOutroElapsedSec(null);
      setPlaying((p) => !p);
    } else if (e.code === 'ArrowLeft' && currentClip) {
      e.preventDefault();
      seekTo(currentTimeSec - (e.shiftKey ? 5 / 30 : 1 / 30));
    } else if (e.code === 'ArrowRight' && currentClip) {
      e.preventDefault();
      seekTo(currentTimeSec + (e.shiftKey ? 5 / 30 : 1 / 30));
    } else if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey && currentClip) {
      e.preventDefault();
      handleChangeTrimWindow(currentTimeSec, trimOutSec);
      onNotify(`In point set to ${currentTimeSec.toFixed(1)}s`);
    } else if (e.key.toLowerCase() === 'o' && !e.ctrlKey && !e.metaKey && currentClip) {
      e.preventDefault();
      handleChangeTrimWindow(trimInSec, currentTimeSec);
      onNotify(`Out point set to ${currentTimeSec.toFixed(1)}s`);
    } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && currentClip) {
      e.preventDefault();
      handleSplitAtPlayhead();
    } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && currentClip) {
      e.preventDefault();
      handleAddMarker();
    } else if (e.shiftKey && e.key.toLowerCase() === 'l' && currentClip) {
      e.preventDefault();
      handleToggleFinalPreview();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      onRedo();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const cyclePreviewRes = () => {
    const order: PreviewResolutionId[] = ['auto', 'half', 'full'];
    const next = order[(order.indexOf(previewRes) + 1) % order.length];
    setPreviewRes(next);
    onNotify(`Preview resolution: ${next === 'half' ? '1/2 Draft' : next === 'full' ? 'Full Crisp' : 'Auto'}`);
  };

  return (
    <div
      data-testid="shorts-studio-shell"
      className="h-dvh w-full overflow-hidden flex flex-col bg-[var(--pc-bg)] text-[var(--pc-ink)]"
    >
      {/* Hidden Background Music Audio Engine (A2) */}
      {settings.customAudioUrl && (
        <audio ref={bgmAudioRef} src={settings.customAudioUrl} loop preload="auto" className="hidden" />
      )}

      {/* Unified 48px Studio Bar — Shorts Studio (Section 2 of 2) */}
      <header
        data-testid="shorts-studio-bar"
        className="h-12 shrink-0 px-3.5 border-b border-[var(--pc-border)] bg-[var(--pc-surface)] flex items-center justify-between gap-3"
      >
        {/* Left: Back to Framing Studio + Clip Switcher + Step Label */}
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBackToFraming}>
            <ArrowLeft className="w-3.5 h-3.5 stroke-[2]" />
            <span>Framing</span>
          </Button>

          <span aria-hidden="true" className="w-px h-4 bg-[var(--pc-border)] shrink-0" />

          <div ref={projectMenuRef} className="relative min-w-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              onClick={() => setProjectMenuOpen((v) => !v)}
              className="h-8 max-w-[180px] xl:max-w-[230px] px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-2 cursor-pointer"
            >
              <Film className="w-3.5 h-3.5 text-[var(--pc-sub)] shrink-0" />
              <span className="truncate">
                {currentClip ? currentClip.title : 'No Clip Selected'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[var(--pc-sub)] shrink-0" />
            </button>

            {projectMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1.5 w-80 rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl z-50 overflow-hidden"
              >
                <div className="px-3 py-2 border-b border-[var(--pc-border)] flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[var(--pc-sub)]">
                    Switch Workspace Clip
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onBackToClips();
                    }}
                    className="text-[11px] font-medium text-[var(--pc-accent)] hover:underline bg-transparent border-0 p-0 cursor-pointer"
                  >
                    All Clips
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto studio-scroll divide-y divide-[var(--pc-border-subtle)]">
                  {clips.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelectClip(c.id);
                        setProjectMenuOpen(false);
                      }}
                      className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 cursor-pointer border-0 ${
                        currentClip?.id === c.id
                          ? 'bg-[var(--pc-accent-soft)] text-[var(--pc-ink)]'
                          : 'bg-transparent text-[var(--pc-sub)] hover:bg-[var(--pc-surface-2)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-[var(--pc-ink)] truncate">
                          {c.title}
                        </div>
                        <div className="text-[10.5px] font-mono-tabular text-[var(--pc-muted)]">
                          {c.channel} · {formatShortDuration(c.duration_sec)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <span className="hidden lg:inline-flex items-center text-xs font-medium text-[var(--pc-ink)] pl-1 whitespace-nowrap">
            Step 2 · Shorts Studio
          </span>
        </div>

        {/* Center: Undo/Redo + Preview Resolution + Safe Zones */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label="Undo edit"
              className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-35"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label="Redo edit"
              className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-35"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={cyclePreviewRes}
            className="h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-mono-tabular text-[var(--pc-sub)] hover:text-[var(--pc-ink)] cursor-pointer whitespace-nowrap"
          >
            Res: {previewRes === 'half' ? '1/2' : previewRes === 'full' ? 'Full' : 'Auto'}
          </button>

          <button
            type="button"
            aria-pressed={showSafeZones}
            onClick={() => setShowSafeZones((v) => !v)}
            className={`h-8 px-2.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              showSafeZones
                ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
            }`}
          >
            <Scan className="w-3.5 h-3.5" />
            <span>Safe Zones</span>
          </button>
        </div>

        {/* Right: Split / Marker / Agent utilities + Export Short CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            disabled={!currentClip}
            data-testid="split-at-playhead-btn"
            title="Split clip at playhead (S)"
            onClick={handleSplitAtPlayhead}
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>Split</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!currentClip}
            data-testid="add-marker-btn"
            title="Add timeline marker at playhead (M)"
            onClick={() => handleAddMarker()}
          >
            <Bookmark className="w-3.5 h-3.5 text-sky-400" />
            <span>Marker</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="agent-interop-btn"
            title="AI Agent, IDE & CLI Interop"
            onClick={() => setAgentModalOpen(true)}
          >
            <Bot className="w-3.5 h-3.5 text-sky-400" />
            <span>AI Agent / CLI</span>
          </Button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onOpenShortcuts}
            aria-label="Keyboard shortcuts"
            className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
          <Button
            variant="primary"
            size="sm"
            disabled={!currentClip || exporting}
            data-testid="export-short-btn"
            onClick={handleExport}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export {blueprint.aspect} Short</span>
          </Button>
        </div>
      </header>

      {/* Main 2-Column Shorts Workspace (Stage + NLE Timeline on Left, 3-Tab Shorts Inspector on Right) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!currentClip ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--pc-canvas)]">
              <Crop className="w-8 h-8 text-[var(--pc-muted)] mb-3 stroke-[1.5]" />
              <h2 className="text-base font-semibold text-[var(--pc-ink)] m-0">
                No framed clip loaded
              </h2>
              <p className="text-xs text-[var(--pc-sub)] mt-1.5 max-w-sm">
                Import a recording on the Dashboard or frame an existing clip in Framing Studio to build shorts here.
              </p>
              <div className="flex items-center gap-2 mt-4">
                <Button variant="secondary" size="sm" onClick={onBackToFraming}>
                  Open Framing Studio
                </Button>
                <Button variant="primary" size="sm" onClick={onGoToDashboard}>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Import Video</span>
                </Button>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'frame' ? (
                <FramingCanvas
                  clip={currentClip}
                  blueprint={blueprint}
                  onUpdateBlueprint={onUpdateBlueprint}
                  playing={playing}
                  currentTimeSec={currentTimeSec}
                  videoRef={videoRef}
                  onDurationLoaded={handleVideoMetadata}
                  onVideoTimeUpdate={handleVideoTimeUpdate}
                  onVideoEnded={() => {
                    if (finalPreviewLocked && shorts.outro.enabled) {
                      setOutroElapsedSec(0);
                    } else {
                      setPlaying(false);
                    }
                  }}
                />
              ) : (
                <ShortsStage
                  clip={currentClip}
                  videoRef={videoRef}
                  blueprint={blueprint}
                  shorts={shorts}
                  settings={settings}
                  brandKit={brandKit}
                  customFonts={customFonts}
                  activeTemplateName={
                    templates.find((t) => t.id === settings.template)?.name
                  }
                  currentTimeSec={currentTimeSec}
                  stitchedTimeSec={stitchedTimeSec}
                  previewRes={previewRes}
                  finalPreviewLocked={finalPreviewLocked}
                  outroElapsedSec={outroElapsedSec}
                  showSafeZones={showSafeZones}
                  trackStates={trackStates}
                  onEditFraming={onBackToFraming}
                  onUpdateSettings={onUpdateSettings}
                  onUpdateDualWatermark={(patch) =>
                    onUpdateShorts({ dualWatermark: { ...shorts.dualWatermark, ...patch } })
                  }
                  onVideoMetadata={handleVideoMetadata}
                  onVideoTimeUpdate={handleVideoTimeUpdate}
                  onVideoEnded={() => {
                    if (finalPreviewLocked && shorts.outro.enabled) {
                      setOutroElapsedSec(0);
                    } else {
                      setPlaying(false);
                    }
                  }}
                />
              )}

              <ShortsTimeline
                clip={currentClip}
                shorts={shorts}
                playbackSpeed={blueprint.speed}
                playing={playing}
                finalPreviewLocked={finalPreviewLocked}
                currentTimeSec={currentTimeSec}
                durationSec={durationSec}
                trimInSec={trimInSec}
                trimOutSec={trimOutSec}
                activeSegmentId={activeSegmentId}
                zoomPct={zoomPct}
                audioBaseVol={settings.audioBaseVol}
                audioPeakVol={settings.audioPeakVol}
                riserDurationSec={settings.riserDurationSec}
                customAudioName={settings.customAudioName}
                trackStates={trackStates}
                splits={settings.splits}
                markers={settings.markers}
                onToggleTrackState={(k) =>
                  setTrackStates((prev) => ({ ...prev, [k]: !prev[k] }))
                }
                onTogglePlay={() => {
                  setOutroElapsedSec(null);
                  setPlaying((p) => !p);
                }}
                onToggleFinalPreview={handleToggleFinalPreview}
                onSeekDelta={(delta) => seekTo(currentTimeSec + delta)}
                onSeekTo={seekTo}
                onChangeTrimWindow={handleChangeTrimWindow}
                onSetIn={() => {
                  handleChangeTrimWindow(currentTimeSec, trimOutSec);
                  onNotify(`In point set to ${currentTimeSec.toFixed(1)}s`);
                }}
                onSetOut={() => {
                  handleChangeTrimWindow(trimInSec, currentTimeSec);
                  onNotify(`Out point set to ${currentTimeSec.toFixed(1)}s`);
                }}
                onResetTrim={() => {
                  setTrimInSec(0);
                  setTrimOutSec(durationSec);
                  onNotify('Trim window reset');
                }}
                onToggleMultiSegment={handleToggleMultiSegment}
                onAddSegment={handleAddSegment}
                onSelectSegment={(seg) => {
                  setActiveSegmentId(seg.id);
                  setTrimInSec(seg.start);
                  setTrimOutSec(seg.end);
                  seekTo(seg.start);
                }}
                onRemoveSegment={handleRemoveSegment}
                onRemoveSfxCue={handleRemoveSfxCue}
                onChangeZoom={setZoomPct}
                onFitZoom={() => setZoomPct(100)}
              />
            </>
          )}
        </div>

        {/* Right Shorts-Only Inspector (Templates | Text | Media) */}
        <ShortsInspector
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          clip={currentClip}
          settings={settings}
          shorts={shorts}
          brandKit={brandKit}
          trackStates={trackStates}
          currentTimeSec={currentTimeSec}
          stitchedDurationSec={stitchedDurationSec}
          templates={templates}
          captionPresets={captionPresets}
          customFonts={customFonts}
          logos={logos}
          canRestoreTemplates={canRestoreTemplates}
          canRestoreCaptions={canRestoreCaptions}
          onUpdateSettings={onUpdateSettings}
          onUpdateShorts={onUpdateShorts}
          onUpdateBrandKit={onUpdateBrandKit}
          onToggleTrackState={(k) => setTrackStates((prev) => ({ ...prev, [k]: !prev[k] }))}
          onSelectTemplatePreset={onSelectTemplatePreset}
          onOpenTemplateEditor={(tpl) => {
            setEditingTemplate(tpl);
            setTemplateEditorOpen(true);
          }}
          onDeleteTemplate={onDeleteTemplate}
          onRestoreTemplates={onRestoreTemplates}
          onSelectCaptionPreset={onSelectCaptionPreset}
          onAddCaptionStyle={onAddCaptionStyle}
          onDeleteCaptionStyle={onDeleteCaptionStyle}
          onRestoreCaptions={onRestoreCaptions}
          onUploadCustomFont={onUploadCustomFont}
          onAddGoogleFont={onAddGoogleFont}
          onDeleteCustomFont={onDeleteCustomFont}
          onUploadLogo={onUploadLogo}
          onDeleteLogo={onDeleteLogo}
          onUpdateClipHashtags={onUpdateClipHashtags}
          onOpenTemplateLibrary={() => setTemplateLibraryOpen(true)}
          onImportSrtCues={onImportSrtCues}
          onAutoAlignSubtitles={handleAutoAlignSubtitles}
          onAddSfxCueAtPlayhead={handleAddSfxCueAtPlayhead}
          onRemoveSfxCue={handleRemoveSfxCue}
          onReplayOutro={() => {
            setPlaying(false);
            setOutroElapsedSec(0);
          }}
          onNotify={onNotify}
        />
      </div>

      {/* Modals */}
      <TemplateLibraryModal
        open={templateLibraryOpen}
        templates={templates}
        activeTemplateId={settings.template}
        canRestoreDefaults={canRestoreTemplates}
        onSelect={(preset) => {
          onSelectTemplatePreset(preset);
          setTemplateLibraryOpen(false);
        }}
        onCreateNew={() => {
          setEditingTemplate(null);
          setTemplateEditorOpen(true);
        }}
        onEdit={(preset) => {
          setEditingTemplate(preset);
          setTemplateEditorOpen(true);
        }}
        onDelete={onDeleteTemplate}
        onRestoreDefaults={onRestoreTemplates}
        onClose={() => setTemplateLibraryOpen(false)}
      />

      <TemplateEditorModal
        open={templateEditorOpen}
        initialTemplate={editingTemplate}
        captionPresets={captionPresets}
        customFonts={customFonts}
        currentSettings={settings}
        currentBlueprint={blueprint}
        onSave={(saved) => {
          onSaveTemplate(saved);
          setTemplateEditorOpen(false);
          setEditingTemplate(null);
        }}
        onClose={() => {
          setTemplateEditorOpen(false);
          setEditingTemplate(null);
        }}
      />

      <ShortsExportModal
        open={exportModalOpen}
        clip={currentClip}
        blueprint={blueprint}
        shorts={shorts}
        settings={settings}
        brandKit={brandKit}
        trimInSec={trimInSec}
        trimOutSec={trimOutSec}
        customFonts={customFonts}
        onChangeResolution={(exportResolution) => onUpdateShorts({ exportResolution })}
        onChangeEncoder={(exportEncoder) => onUpdateShorts({ exportEncoder })}
        onClose={() => setExportModalOpen(false)}
        onNotify={onNotify}
      />

      {/* AI Agent & IDE Compatibility Hub Modal */}
      <AgentInteropModal
        open={agentModalOpen}
        clip={currentClip}
        settings={settings}
        trimInSec={trimInSec}
        trimOutSec={trimOutSec}
        onClose={() => setAgentModalOpen(false)}
        onNotify={onNotify}
      />
    </div>
  );
}
