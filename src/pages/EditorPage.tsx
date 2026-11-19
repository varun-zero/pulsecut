import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Film,
  HelpCircle,
  Moon,
  Plus,
  Redo2,
  Scan,
  Sun,
  Undo2,
  X,
} from 'lucide-react';
import type {
  AspectRatioId,
  BrandKit,
  ClipItem,
  CustomFontEntry,
  EditorSettings,
  EditorTabId,
  SafeZonePlatformId,
  TextSubtabId,
} from '../types';
import { ASPECT_RATIOS, type TemplatePreset } from '../presets';
import {
  getSafeZoneSpec,
  resolveSafeZonePlatform,
  type ViralCaptionPreset,
} from '../captionStyles';
import { clampTrimWindow, formatShortDuration } from '../lib/studioLogic';
import { Button, SegmentedControl } from '../components/ui/Primitives';
import { VideoStage } from '../components/editor/VideoStage';
import { EditorTimeline } from '../components/editor/EditorTimeline';
import { EditorInspector } from '../components/editor/EditorInspector';
import { TemplateLibraryModal } from '../components/editor/TemplateLibraryModal';
import { ExportParityModal } from '../components/editor/ExportParityModal';

interface EditorPageProps {
  clips: ClipItem[];
  currentClip: ClipItem | null;
  onSelectClip: (clipId: string | null) => void;
  onBackToClips: () => void;
  onGoToDashboard: () => void;
  settings: EditorSettings;
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  onSelectTemplatePreset: (preset: TemplatePreset) => void;
  onSelectCaptionPreset: (preset: ViralCaptionPreset) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  brandKit: BrandKit;
  onUpdateBrandKit: (next: BrandKit) => void;
  customFonts: readonly CustomFontEntry[];
  onUploadCustomFont: (file: File) => void;
  onUpdateCueWord: (clipId: string, index: number, text: string) => void;
  onSetWordEmphasis: (
    clipId: string,
    cueIndex: number,
    tokenIndex: number,
    color: string | null
  ) => void;
  onUpdateClipDuration?: (clipId: string, durationSec: number) => void;
  onExportClip: (trimInSec: number, trimOutSec: number) => Promise<void>;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenShortcuts: () => void;
  onNotify: (msg: string) => void;
}

export function EditorPage({
  clips,
  currentClip,
  onSelectClip,
  onBackToClips,
  onGoToDashboard,
  settings,
  onUpdateSettings,
  onSelectTemplatePreset,
  onSelectCaptionPreset,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  brandKit,
  onUpdateBrandKit,
  customFonts,
  onUploadCustomFont,
  onUpdateCueWord,
  onSetWordEmphasis,
  onUpdateClipDuration,
  onExportClip,
  theme,
  onToggleTheme,
  onOpenShortcuts,
  onNotify,
}: EditorPageProps) {
  const [activeTab, setActiveTab] = useState<EditorTabId>('framing');
  const [textSubtab, setTextSubtab] = useState<TextSubtabId>('headline');
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [zoomPct, setZoomPct] = useState(100);
  const [trimInSec, setTrimInSec] = useState(0);
  const [trimOutSec, setTrimOutSec] = useState(currentClip?.duration_sec ?? 0);
  const [exporting, setExporting] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [safeZoneMenuOpen, setSafeZoneMenuOpen] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const safeZoneMenuRef = useRef<HTMLDivElement>(null);

  const durationSec = currentClip?.duration_sec ?? 0;
  const activeSafeZone = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
  const matchedSafeZone = getSafeZoneSpec(
    resolveSafeZonePlatform('auto', settings.template),
    settings.template
  );

  // Reset playback and trim bounds whenever active clip changes
  useEffect(() => {
    setPlaying(false);
    setCurrentTimeSec(0);
    setTrimInSec(0);
    setTrimOutSec(currentClip?.duration_sec ?? 0);
  }, [currentClip?.id, currentClip?.duration_sec]);

  // Smooth simulated playback timer so stage captions & playhead run live
  useEffect(() => {
    if (!playing || !currentClip || durationSec <= 0) return;
    const interval = window.setInterval(() => {
      setCurrentTimeSec((prev) => {
        const next = prev + 0.1 * playbackSpeed;
        const limit = trimOutSec > trimInSec ? trimOutSec : durationSec;
        if (next >= limit) {
          return trimInSec;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [playing, currentClip, durationSec, playbackSpeed, trimInSec, trimOutSec]);

  // Close dropdown menus on outside click
  useEffect(() => {
    if (!projectMenuOpen && !safeZoneMenuOpen) return;
    const onOutside = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
      if (safeZoneMenuRef.current && !safeZoneMenuRef.current.contains(e.target as Node)) {
        setSafeZoneMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [projectMenuOpen, safeZoneMenuOpen]);

  const handleToggleFullscreen = () => {
    if (!currentClip) {
      onNotify('Select a clip first to preview fullscreen');
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      stageRef.current?.requestFullscreen?.().catch(() => {
        onNotify('Fullscreen preview requested');
      });
    }
  };

  const handleSetIn = () => {
    if (!currentClip) return;
    const next = clampTrimWindow(currentTimeSec, trimOutSec, durationSec);
    setTrimInSec(next.inSec);
    setTrimOutSec(next.outSec);
    onNotify(`Trim In set to ${next.inSec.toFixed(1)}s`);
  };

  const handleSetOut = () => {
    if (!currentClip) return;
    const next = clampTrimWindow(trimInSec, currentTimeSec, durationSec);
    setTrimInSec(next.inSec);
    setTrimOutSec(next.outSec);
    onNotify(`Trim Out set to ${next.outSec.toFixed(1)}s`);
  };

  const handleResetTrim = () => {
    setTrimInSec(0);
    setTrimOutSec(durationSec);
    onNotify('Trim range reset to full clip');
  };

  const handleAutoAlignSubtitles = () => {
    const spec = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
    onUpdateSettings({ subtitleX: 50, subtitleVerticalPos: spec.autoAlignSubtitlePct }, true);
    setShowSafeZones(true);
    onNotify(`Subtitles aligned inside ${spec.label} safe zone (${spec.autoAlignSubtitlePct}%)`);
  };

  const handleExport = async () => {
    if (!currentClip) {
      onNotify('Choose a clip before exporting');
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

  // Editor Keyboard Shortcuts (single stable listener via ref)
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandlerRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Space' && currentClip) {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (e.code === 'ArrowLeft' && currentClip) {
      e.preventDefault();
      setCurrentTimeSec((t) => Math.max(0, t - 5));
    } else if (e.code === 'ArrowRight' && currentClip) {
      e.preventDefault();
      setCurrentTimeSec((t) => Math.min(durationSec, t + 5));
    } else if (e.key === '[' && currentClip) {
      e.preventDefault();
      handleSetIn();
    } else if (e.key === ']' && currentClip) {
      e.preventDefault();
      handleSetOut();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      onUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      onRedo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      handleToggleFullscreen();
    }
  };

  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  return (
    <div
      data-testid="editor-shell"
      className="h-dvh w-full overflow-hidden flex flex-col bg-[var(--pc-bg)] text-[var(--pc-ink)]"
    >
      {/* SINGLE UNIFIED 48px STUDIO BAR — Replaces triple stacked headers completely */}
      <header
        data-testid="editor-studio-bar"
        className="h-12 shrink-0 px-3.5 border-b border-[var(--pc-border)] bg-[var(--pc-surface)] flex items-center justify-between gap-3"
      >
        {/* Left: Back to Clips + Clip/Project Switcher */}
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBackToClips}>
            <ArrowLeft className="w-3.5 h-3.5 stroke-[2]" />
            <span>Clips</span>
          </Button>

          <span aria-hidden="true" className="w-px h-4 bg-[var(--pc-border)] shrink-0" />

          {/* Inline Clip / Project Switcher Dropdown */}
          <div ref={projectMenuRef} className="relative min-w-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              onClick={() => setProjectMenuOpen((v) => !v)}
              className="h-8 max-w-[240px] sm:max-w-[300px] px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Film className="w-3.5 h-3.5 text-[var(--pc-sub)] shrink-0 stroke-[1.75]" />
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
                      onGoToDashboard();
                    }}
                    className="text-[11px] font-medium text-[var(--pc-accent)] hover:underline inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Import new</span>
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto studio-scroll divide-y divide-[var(--pc-border-subtle)]">
                  {clips.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--pc-muted)]">
                      No clips in workspace yet.
                    </div>
                  ) : (
                    clips.map((c) => {
                      const active = currentClip?.id === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onSelectClip(c.id);
                            setProjectMenuOpen(false);
                          }}
                          className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 cursor-pointer border-0 transition-colors ${
                            active
                              ? 'bg-[var(--pc-accent-soft)] text-[var(--pc-ink)]'
                              : 'bg-transparent text-[var(--pc-sub)] hover:bg-[var(--pc-surface-2)] hover:text-[var(--pc-ink)]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-[var(--pc-ink)] truncate">
                              {c.title}
                            </div>
                            <div className="text-[10.5px] font-mono-tabular text-[var(--pc-muted)] mt-0.5">
                              {c.channel} · {formatShortDuration(c.duration_sec)} · {c.status}
                            </div>
                          </div>
                          {active && (
                            <span className="text-[10px] font-mono-tabular text-[var(--pc-accent)] shrink-0">
                              Active
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
                {currentClip && (
                  <div className="p-2 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectClip(null);
                        setProjectMenuOpen(false);
                      }}
                      className="w-full h-7 rounded-md text-[11px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] inline-flex items-center justify-center gap-1 bg-transparent border-0 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                      <span>Unload current clip</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: Undo/Redo + Single Unified Aspect Ratio Selector + Safe Zones */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label="Undo edit"
              title="Undo (Ctrl+Z)"
              className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <Undo2 className="w-3.5 h-3.5 stroke-[1.75]" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label="Redo edit"
              title="Redo (Ctrl+Y)"
              className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <Redo2 className="w-3.5 h-3.5 stroke-[1.75]" />
            </button>
          </div>

          <SegmentedControl<AspectRatioId>
            ariaLabel="Canvas aspect ratio"
            size="sm"
            value={settings.aspect}
            options={ASPECT_RATIOS.map((r) => ({ value: r.id, label: r.label }))}
            onChange={(aspect) => {
              onUpdateSettings({ aspect }, true);
              onNotify(`Canvas aspect ratio set to ${aspect}`);
            }}
          />

          {/* Auto-Matched Safe Zones Toggle + Platform Override Dropdown */}
          <div ref={safeZoneMenuRef} className="relative inline-flex items-center">
            <button
              type="button"
              data-testid="safe-zones-toggle"
              aria-pressed={showSafeZones}
              onClick={() => setShowSafeZones((v) => !v)}
              className={`h-8 pl-2.5 pr-2 rounded-l-lg border text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors ${
                showSafeZones
                  ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                  : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
              }`}
            >
              <Scan className="w-3.5 h-3.5 stroke-[1.75]" />
              <span className="hidden md:inline">Safe Zones</span>
              {showSafeZones && (
                <span className="hidden lg:inline font-mono-tabular text-[10px] text-[var(--pc-accent)]">
                  · {activeSafeZone.shortLabel}
                </span>
              )}
            </button>
            <button
              type="button"
              data-testid="safe-zone-platform-menu-btn"
              aria-haspopup="menu"
              aria-expanded={safeZoneMenuOpen}
              aria-label="Select Safe Zone platform"
              title={`Safe Zone Platform (${activeSafeZone.label})`}
              onClick={() => setSafeZoneMenuOpen((v) => !v)}
              className={`h-8 px-1.5 rounded-r-lg border border-l-0 inline-flex items-center justify-center cursor-pointer transition-colors ${
                showSafeZones
                  ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                  : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
              }`}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {safeZoneMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl z-50 overflow-hidden"
              >
                <div className="px-3 py-2 border-b border-[var(--pc-border)]">
                  <div className="text-[11px] font-medium text-[var(--pc-ink)]">
                    Platform Safe Zone Overlay
                  </div>
                  <div className="text-[10px] text-[var(--pc-muted)] mt-0.5">
                    Auto-matches active template or override manually
                  </div>
                </div>
                <div className="py-1">
                  {(
                    [
                      {
                        id: 'auto' as SafeZonePlatformId,
                        label: `Auto (${matchedSafeZone.shortLabel})`,
                        hint: 'Matches active template',
                      },
                      {
                        id: 'youtube-shorts' as SafeZonePlatformId,
                        label: 'YouTube Shorts',
                        hint: 'Top 288px · Bot 672px · Right 192px',
                      },
                      {
                        id: 'instagram-reels' as SafeZonePlatformId,
                        label: 'Instagram Reels',
                        hint: 'Top 269px (14%) · Bot 672px (35%)',
                      },
                      {
                        id: 'universal' as SafeZonePlatformId,
                        label: 'Universal Cross-Post',
                        hint: 'TikTok + Reels + Shorts + Kick',
                      },
                    ]
                  ).map((opt) => {
                    const selected = settings.safeZonePlatform === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onUpdateSettings({ safeZonePlatform: opt.id }, false);
                          setShowSafeZones(true);
                          setSafeZoneMenuOpen(false);
                          onNotify(`Safe Zone overlay: ${opt.label}`);
                        }}
                        className={`w-full px-3 py-2 text-left border-0 cursor-pointer transition-colors ${
                          selected
                            ? 'bg-[var(--pc-accent-soft)] text-[var(--pc-ink)]'
                            : 'bg-transparent text-[var(--pc-sub)] hover:bg-[var(--pc-surface-2)] hover:text-[var(--pc-ink)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs font-medium">
                          <span>{opt.label}</span>
                          {selected && (
                            <span className="text-[10px] font-mono-tabular text-[var(--pc-accent)]">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono-tabular text-[var(--pc-muted)] mt-0.5">
                          {opt.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Shortcuts, Theme & Dynamically Synced Export CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title="Toggle theme"
            className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 stroke-[1.75]" />
            ) : (
              <Moon className="w-3.5 h-3.5 stroke-[1.75]" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenShortcuts}
            aria-label="Keyboard shortcuts and version info"
            title="Shortcuts & about"
            className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>

          <Button
            variant="primary"
            size="sm"
            disabled={!currentClip || exporting}
            onClick={handleExport}
          >
            <Download className="w-3.5 h-3.5 stroke-[2]" />
            <span>
              {exporting ? 'Exporting...' : `Export ${settings.aspect} Video`}
            </span>
          </Button>
        </div>
      </header>

      {/* LOCKED 3-PANE 100dvh NLE WORKSPACE */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left/Center Column: Video Stage (Top) + Compact Timeline (Bottom) */}
        <div className="flex-1 min-w-0 min-h-0 p-3 flex flex-col gap-3 overflow-hidden">
          <VideoStage
            clip={currentClip}
            settings={settings}
            brandKit={brandKit}
            customFonts={customFonts}
            playing={playing}
            playbackSpeed={playbackSpeed}
            currentTimeSec={currentTimeSec}
            showSafeZones={showSafeZones}
            stageRef={stageRef}
            onUpdateSettings={onUpdateSettings}
            onDurationLoaded={(dur) => {
              if (currentClip && dur > 0 && Math.abs(dur - currentClip.duration_sec) >= 1) {
                onUpdateClipDuration?.(currentClip.id, dur);
              }
            }}
            onToggleFullscreen={handleToggleFullscreen}
            onOpenClipPicker={() => setProjectMenuOpen(true)}
            onGoToDashboard={onGoToDashboard}
          />

          <EditorTimeline
            clip={currentClip}
            playing={playing}
            currentTimeSec={currentTimeSec}
            durationSec={durationSec}
            trimInSec={trimInSec}
            trimOutSec={trimOutSec}
            playbackSpeed={playbackSpeed}
            zoomPct={zoomPct}
            audioPeak={settings.audioPeak}
            customAudioName={settings.customAudioName}
            onTogglePlay={() => setPlaying((p) => !p)}
            onSeekDelta={(delta) =>
              setCurrentTimeSec((t) => Math.max(0, Math.min(durationSec, t + delta)))
            }
            onSeekTo={(sec) => setCurrentTimeSec(sec)}
            onChangeSpeed={(spd) => {
              setPlaybackSpeed(spd);
              onNotify(`Preview speed: ${spd}x`);
            }}
            onSetIn={handleSetIn}
            onSetOut={handleSetOut}
            onResetTrim={handleResetTrim}
            onChangeZoom={setZoomPct}
            onFitZoom={() => setZoomPct(100)}
          />
        </div>

        {/* Fixed 340px Independently Scrollable Right Inspector */}
        <EditorInspector
          clip={currentClip}
          currentTimeSec={currentTimeSec}
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          textSubtab={textSubtab}
          onChangeTextSubtab={setTextSubtab}
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onSelectTemplatePreset={onSelectTemplatePreset}
          onSelectCaptionPreset={onSelectCaptionPreset}
          brandKit={brandKit}
          onUpdateBrandKit={onUpdateBrandKit}
          customFonts={customFonts}
          onUploadCustomFont={onUploadCustomFont}
          onUpdateCueWord={(idx, text) => {
            if (currentClip) onUpdateCueWord(currentClip.id, idx, text);
          }}
          onSetWordEmphasis={(cueIndex, tokenIndex, color) => {
            if (currentClip) onSetWordEmphasis(currentClip.id, cueIndex, tokenIndex, color);
          }}
          onAutoAlignSubtitles={handleAutoAlignSubtitles}
          onOpenTemplateLibrary={() => setTemplateLibraryOpen(true)}
          onOpenClipPicker={() => setProjectMenuOpen(true)}
        />
      </div>

      {/* Template Library Modal (12 viral short-form presets) */}
      <TemplateLibraryModal
        open={templateLibraryOpen}
        activeTemplateId={settings.template}
        onSelect={onSelectTemplatePreset}
        onClose={() => setTemplateLibraryOpen(false)}
      />

      {/* 1:1 Preview-to-Export Render Parity Modal */}
      <ExportParityModal
        open={exportModalOpen}
        clip={currentClip}
        settings={settings}
        brandKit={brandKit}
        trimInSec={trimInSec}
        trimOutSec={trimOutSec}
        customFonts={customFonts}
        onClose={() => setExportModalOpen(false)}
        onNotify={onNotify}
      />
    </div>
  );
}
