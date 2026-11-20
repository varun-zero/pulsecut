import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  Columns2,
  Film,
  FlipHorizontal2,
  Frame,
  Grid3x3,
  HelpCircle,
  Image as ImageIcon,
  Lock,
  Maximize2,
  Monitor,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Sun,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  User,
  X,
} from 'lucide-react';
import type {
  AspectRatioId,
  BackdropKindId,
  ClipItem,
  FramingBlueprint,
  LayoutModeId,
  NormalizedCrop,
  PipAspectId,
  PipCornerId,
  PipShapeId,
} from '../types';
import {
  ASPECT_RATIOS,
  GRADIENT_PRESETS,
  LAYOUT_MODES,
  OUTER_FILL_SWATCHES,
} from '../presets';
import {
  clampCrop,
  clampNum,
  computeSplitPresetRatio,
  defaultCropsForLayout,
  describeFramingBlueprint,
  fitCropToAspect,
  getCanvasAspectRatio,
  getCroppableSlots,
  getSlotAspect,
  reconcileCrops,
  swapLayoutCrops,
} from '../lib/framingEngine';
import { formatShortDuration, formatTimecode } from '../lib/studioLogic';
import {
  Button,
  InspectorAccordion,
  SegmentedControl,
  StudioSlider,
  StudioSwitch,
} from '../components/ui/Primitives';
import { SourceCropCanvas } from '../components/studio/SourceCropCanvas';
import { FramedCanvasView } from '../components/studio/FramedCanvasView';

const FRAMING_PRESETS_KEY = 'pulsecut-framing-blueprints-v1';

interface SavedFramingPreset {
  id: string;
  name: string;
  blueprint: Omit<FramingBlueprint, 'slotMedia'>;
}

function loadFramingPresets(): SavedFramingPreset[] {
  try {
    const raw = localStorage.getItem(FRAMING_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const LAYOUT_ICONS: Record<LayoutModeId, React.ReactNode> = {
  split: <Columns2 className="w-3.5 h-3.5 stroke-[1.75]" />,
  solo: <User className="w-3.5 h-3.5 stroke-[1.75]" />,
  trio: <Grid3x3 className="w-3.5 h-3.5 stroke-[1.75]" />,
  pip: <PictureInPicture2 className="w-3.5 h-3.5 stroke-[1.75]" />,
  centered: <Frame className="w-3.5 h-3.5 stroke-[1.75]" />,
  widescreen: <Monitor className="w-3.5 h-3.5 stroke-[1.75]" />,
};

interface FramingPageProps {
  clips: ClipItem[];
  currentClip: ClipItem | null;
  onSelectClip: (id: string | null) => void;
  onBackToClips: () => void;
  onGoToDashboard: () => void;
  onProceedToShorts: () => void;
  blueprint: FramingBlueprint;
  onUpdateBlueprint: (next: FramingBlueprint, recordHistory?: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateClipDuration: (clipId: string, durationSec: number) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenShortcuts: () => void;
  onNotify: (msg: string) => void;
}

export function FramingPage({
  clips,
  currentClip,
  onSelectClip,
  onBackToClips,
  onGoToDashboard,
  onProceedToShorts,
  blueprint,
  onUpdateBlueprint,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onUpdateClipDuration,
  theme,
  onToggleTheme,
  onOpenShortcuts,
  onNotify,
}: FramingPageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const slotFileInputRef = useRef<HTMLInputElement>(null);

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [sourceDims, setSourceDims] = useState({ width: 1920, height: 1080 });
  const [durationSec, setDurationSec] = useState(currentClip?.duration_sec || 30);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [pendingSlotUploadIdx, setPendingSlotUploadIdx] = useState<number>(0);

  const [presetName, setPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState<SavedFramingPreset[]>(() => loadFramingPresets());

  const sourceAr = sourceDims.width / Math.max(1, sourceDims.height);
  const croppableSlots = getCroppableSlots(blueprint.layout, blueprint.aspect, {
    splitRatio: blueprint.splitRatio,
    pip: blueprint.pip,
    crops: blueprint.crops,
    sourceAr,
  });

  // Reset active slot when layout changes
  useEffect(() => {
    setActiveSlotIndex(blueprint.layout === 'pip' ? 1 : 0);
  }, [blueprint.layout]);

  // Reset playback state on clip switch
  useEffect(() => {
    setPlaying(false);
    setCurrentTimeSec(0);
    setDurationSec(currentClip?.duration_sec || 30);
  }, [currentClip?.id]);

  // Sync video element play/pause & speed
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = clampNum(blueprint.speed || 1, 0.25, 4);
  }, [blueprint.speed, currentClip?.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [playing]);

  // Close clip switcher on outside click
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

  // Keyboard shortcuts (Space, Frame Step, Undo/Redo)
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space' && currentClip) {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (e.code === 'ArrowLeft' && currentClip) {
      e.preventDefault();
      seekTo(currentTimeSec - (e.shiftKey ? 5 / 30 : 1 / 30));
    } else if (e.code === 'ArrowRight' && currentClip) {
      e.preventDefault();
      seekTo(currentTimeSec + (e.shiftKey ? 5 / 30 : 1 / 30));
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

  const seekTo = (sec: number) => {
    const clamped = clampNum(sec, 0, Math.max(0.1, durationSec));
    setCurrentTimeSec(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  };

  const patchBlueprint = (partial: Partial<FramingBlueprint>, recordHistory = false) => {
    const next: FramingBlueprint = { ...blueprint, ...partial };
    onUpdateBlueprint(next, recordHistory);
  };

  const handleChangeLayout = (layout: LayoutModeId) => {
    const nextAspect: AspectRatioId = layout === 'widescreen' ? '16:9' : blueprint.aspect;
    const nextCrops = defaultCropsForLayout(layout, nextAspect, sourceAr, {
      splitRatio: blueprint.splitRatio,
      pip: blueprint.pip,
    });
    patchBlueprint({ layout, aspect: nextAspect, crops: nextCrops, fullFrameSlots: {} }, true);
    onNotify(`Framing layout set to ${LAYOUT_MODES.find((m) => m.id === layout)?.label ?? layout}`);
  };

  const handleChangeAspect = (aspect: AspectRatioId) => {
    const nextCrops = reconcileCrops(blueprint.layout, aspect, sourceAr, blueprint.crops, {
      splitRatio: blueprint.splitRatio,
      pip: blueprint.pip,
      fullFrameSlots: blueprint.fullFrameSlots,
      freeCrop: blueprint.freeCrop,
    });
    patchBlueprint({ aspect, crops: nextCrops }, true);
    onNotify(`Output aspect ratio set to ${aspect}`);
  };

  const handleChangeSplitRatio = (splitRatio: number, recordHistory = false) => {
    const clamped = clampNum(splitRatio, 0.15, 0.85);
    const nextCrops = reconcileCrops(blueprint.layout, blueprint.aspect, sourceAr, blueprint.crops, {
      splitRatio: clamped,
      pip: blueprint.pip,
      fullFrameSlots: blueprint.fullFrameSlots,
      freeCrop: blueprint.freeCrop,
    });
    patchBlueprint({ splitRatio: clamped, crops: nextCrops }, recordHistory);
  };

  const handleUpdatePip = (patch: Partial<FramingBlueprint['pip']>, recordHistory = false) => {
    const nextPip = { ...blueprint.pip, ...patch };
    const nextCrops = reconcileCrops(blueprint.layout, blueprint.aspect, sourceAr, blueprint.crops, {
      splitRatio: blueprint.splitRatio,
      pip: nextPip,
      fullFrameSlots: blueprint.fullFrameSlots,
      freeCrop: blueprint.freeCrop,
    });
    patchBlueprint({ pip: nextPip, crops: nextCrops }, recordHistory);
  };

  const handleChangeCrop = (idx: number, nextCrop: NormalizedCrop, recordHistory = false) => {
    const nextCrops = blueprint.crops.map((c, i) => (i === idx ? nextCrop : c));
    const wasFull = Boolean(blueprint.fullFrameSlots?.[idx]);
    const stillFull = nextCrop.w >= 0.985 && nextCrop.h >= 0.985;
    if (wasFull && !stillFull) {
      const nextFull = { ...(blueprint.fullFrameSlots ?? {}), [idx]: false };
      patchBlueprint({ crops: nextCrops, fullFrameSlots: nextFull }, recordHistory);
    } else {
      patchBlueprint({ crops: nextCrops }, recordHistory);
    }
  };

  const handleToggleFullFrameSlot = (slotIdx: number) => {
    const currentlyFull = Boolean(blueprint.fullFrameSlots?.[slotIdx]);
    const nextFull = { ...(blueprint.fullFrameSlots ?? {}), [slotIdx]: !currentlyFull };
    const defaults = defaultCropsForLayout(blueprint.layout, blueprint.aspect, sourceAr, {
      splitRatio: blueprint.splitRatio,
      pip: blueprint.pip,
    });
    const nextCrops = blueprint.crops.map((c, i) => {
      if (i !== slotIdx) return c;
      return !currentlyFull ? { x: 0, y: 0, w: 1, h: 1 } : (defaults[i] ?? c);
    });
    patchBlueprint({ crops: nextCrops, fullFrameSlots: nextFull }, true);
    onNotify(!currentlyFull ? 'Selected whole full-screen video (100%)' : 'Switched slot back to cropped region');
  };

  const handleToggleFreeCrop = () => {
    const nextFree = !blueprint.freeCrop;
    if (nextFree) {
      const nextPip =
        blueprint.layout === 'pip' && blueprint.pip.shape !== 'circle'
          ? { ...blueprint.pip, aspect: 'free' as PipAspectId }
          : blueprint.pip;
      patchBlueprint({ freeCrop: true, pip: nextPip }, true);
      onNotify('Free rectangular crop unlocked — drag any corner or edge');
    } else {
      const nextPip =
        blueprint.layout === 'pip' && blueprint.pip.aspect === 'free'
          ? { ...blueprint.pip, aspect: '16:9' as PipAspectId }
          : blueprint.pip;
      const nextCrops = reconcileCrops(blueprint.layout, blueprint.aspect, sourceAr, blueprint.crops, {
        splitRatio: blueprint.splitRatio,
        pip: nextPip,
        fullFrameSlots: blueprint.fullFrameSlots,
        freeCrop: false,
      });
      patchBlueprint({ freeCrop: false, pip: nextPip, crops: nextCrops }, true);
      onNotify('Locked crop regions to output slot aspect ratios');
    }
  };

  const handleSwapCrops = () => {
    const swapped = swapLayoutCrops(blueprint, sourceAr);
    patchBlueprint({ crops: swapped }, true);
    onNotify('Swapped slot crop regions');
  };

  const handleResetCrops = () => {
    const reset = defaultCropsForLayout(blueprint.layout, blueprint.aspect, sourceAr, {
      splitRatio: blueprint.splitRatio,
      pip: blueprint.pip,
    });
    patchBlueprint(
      {
        crops: reset,
        fullFrameSlots: {},
        freeCrop: false,
        splitRatio: 0.5,
        centeredScale: 1,
        centeredPanX: 0,
        centeredPanY: 0,
      },
      true
    );
    onNotify('Reset framing coordinates to defaults');
  };

  const handleSlotFileUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    const nextSlotMedia = {
      ...blueprint.slotMedia,
      [pendingSlotUploadIdx]: {
        id: `slot-${Date.now()}`,
        name: file.name,
        url,
        isVideo,
      },
    };
    patchBlueprint({ slotMedia: nextSlotMedia }, true);
    onNotify(`Loaded custom media "${file.name}" into slot ${pendingSlotUploadIdx + 1}`);
  };

  const handleRemoveSlotMedia = (idx: number) => {
    const prev = blueprint.slotMedia[idx];
    if (prev?.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
    const nextSlotMedia = { ...blueprint.slotMedia };
    delete nextSlotMedia[idx];
    patchBlueprint({ slotMedia: nextSlotMedia }, true);
    onNotify('Restored original source clip for slot');
  };

  const handleBackdropImageUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    patchBlueprint(
      {
        backdrop: {
          ...blueprint.backdrop,
          kind: 'image',
          imgUrl: url,
          imgName: file.name,
        },
      },
      true
    );
    onNotify(`Backdrop image loaded: ${file.name}`);
  };

  const handleSavePreset = () => {
    const label = presetName.trim() || `${blueprint.aspect} ${blueprint.layout}`;
    const { slotMedia: _discard, ...serializable } = blueprint;
    const entry: SavedFramingPreset = {
      id: `fp-${Date.now()}`,
      name: label,
      blueprint: serializable,
    };
    const next = [entry, ...savedPresets].slice(0, 12);
    setSavedPresets(next);
    setPresetName('');
    try {
      localStorage.setItem(FRAMING_PRESETS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
    onNotify(`Saved framing preset "${label}"`);
  };

  const handleApplyPreset = (preset: SavedFramingPreset) => {
    onUpdateBlueprint({ ...preset.blueprint, slotMedia: blueprint.slotMedia }, true);
    onNotify(`Applied framing preset "${preset.name}"`);
  };

  const handleDeletePreset = (id: string) => {
    const next = savedPresets.filter((p) => p.id !== id);
    setSavedPresets(next);
    try {
      localStorage.setItem(FRAMING_PRESETS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const activeCrop = blueprint.crops[activeSlotIndex] ?? blueprint.crops[0];
  const activeSlotMeta = croppableSlots[activeSlotIndex] ?? croppableSlots[0];

  return (
    <div
      data-testid="framing-studio-shell"
      className="h-dvh w-full overflow-hidden flex flex-col bg-[var(--pc-bg)] text-[var(--pc-ink)]"
    >
      {/* Unified 48px Studio Bar — Framing Studio (Section 1 of 2) */}
      <header
        data-testid="framing-studio-bar"
        className="h-12 shrink-0 px-3.5 border-b border-[var(--pc-border)] bg-[var(--pc-surface)] flex items-center justify-between gap-3"
      >
        {/* Left: Navigation back to Clips + Clip Switcher + Section Label */}
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" onClick={onBackToClips}>
            <ArrowLeft className="w-3.5 h-3.5 stroke-[2]" />
            <span>Clips</span>
          </Button>

          <span aria-hidden="true" className="w-px h-4 bg-[var(--pc-border)] shrink-0" />

          <div ref={projectMenuRef} className="relative min-w-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={projectMenuOpen}
              onClick={() => setProjectMenuOpen((v) => !v)}
              className="h-8 max-w-[190px] xl:max-w-[240px] px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-2 cursor-pointer transition-colors"
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
                    Switch Source Clip
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
                      No clips imported yet.
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
                              {c.channel} · {formatShortDuration(c.duration_sec)}
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
              </div>
            )}
          </div>

          <span className="hidden lg:inline-flex items-center gap-1.5 text-xs text-[var(--pc-sub)] pl-1 whitespace-nowrap">
            <span className="font-medium text-[var(--pc-ink)]">Step 1 · Framing Studio</span>
          </span>
        </div>

        {/* Center: Undo/Redo + 5-Ratio Output Aspect Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canUndo}
              onClick={onUndo}
              aria-label="Undo framing change"
              title="Undo (Ctrl+Z)"
              className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <Undo2 className="w-3.5 h-3.5 stroke-[1.75]" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={onRedo}
              aria-label="Redo framing change"
              title="Redo (Ctrl+Y)"
              className="h-8 w-8 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <Redo2 className="w-3.5 h-3.5 stroke-[1.75]" />
            </button>
          </div>

          <SegmentedControl<AspectRatioId>
            ariaLabel="Output aspect ratio"
            size="sm"
            value={blueprint.aspect}
            options={ASPECT_RATIOS.map((r) => ({ value: r.id, label: r.label }))}
            onChange={handleChangeAspect}
          />
        </div>

        {/* Right: Utilities + Primary Handoff CTA to Section 2 (Shorts Studio) */}
        <div className="flex items-center gap-2 shrink-0">
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
            data-testid="framing-to-shorts-btn"
            onClick={onProceedToShorts}
          >
            <span>Apply &amp; Make Shorts</span>
            <ArrowRight className="w-3.5 h-3.5 stroke-[2]" />
          </Button>
        </div>
      </header>

      {/* Main 2-Pane Framing Workspace (Dual Canvas Stage + Framing-Only Inspector) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left/Center: Dual Framing Stage (Source Crop Canvas + Live Output Canvas) + Layout & Scrub Bar */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--pc-canvas)]">
          {!currentClip ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <Film className="w-8 h-8 text-[var(--pc-muted)] mb-3 stroke-[1.5]" />
              <h2 className="text-base font-semibold text-[var(--pc-ink)] m-0">
                Load a video to frame
              </h2>
              <p className="text-xs text-[var(--pc-sub)] mt-1.5 max-w-sm">
                Import a local recording or stream clip on the Dashboard to define aspect-locked crop regions, splits, and backdrops before making shorts.
              </p>
              <Button variant="primary" size="sm" onClick={onGoToDashboard} className="mt-4">
                <Plus className="w-3.5 h-3.5" />
                <span>Go to Dashboard</span>
              </Button>
            </div>
          ) : (
            <>
              {/* Dual Interactive Workspace: 16:9 Source Cropper (Left) + Real-Time Output Result (Right) */}
              <div className="flex-1 min-h-0 p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(240px,0.75fr)] gap-4 items-center overflow-hidden">
                {/* Pane A: 16:9 Source Canvas with Draggable Aspect-Locked Crop Boxes */}
                <div className="h-full min-h-0 flex flex-col">
                  <div className="flex items-center justify-between gap-2 pb-2 shrink-0 flex-wrap">
                    <span className="text-xs font-medium text-[var(--pc-sub)]">
                      Source Frame · {blueprint.freeCrop ? 'Free rectangular crop & edge resize' : 'Drag & resize crop regions'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {blueprint.layout !== 'centered' && (() => {
                        const targetFullIdx =
                          blueprint.layout === 'split' || blueprint.layout === 'trio'
                            ? activeSlotIndex
                            : 0;
                        const isTargetFull = Boolean(blueprint.fullFrameSlots?.[targetFullIdx]);
                        return (
                          <>
                            <button
                              type="button"
                              data-testid="toggle-full-screen-btn"
                              aria-pressed={isTargetFull}
                              onClick={() => handleToggleFullFrameSlot(targetFullIdx)}
                              title="Select whole full-screen source video (100%) over backdrop"
                              className={`h-6 px-2 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                isTargetFull
                                  ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                                  : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                              }`}
                            >
                              <Maximize2 className="w-3 h-3" />
                              <span>Full Screen (100%)</span>
                            </button>
                            <button
                              type="button"
                              data-testid="toggle-free-crop-btn"
                              aria-pressed={Boolean(blueprint.freeCrop)}
                              onClick={handleToggleFreeCrop}
                              title="Unlock independent width & height rectangular resizing"
                              className={`h-6 px-2 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer transition-colors ${
                                blueprint.freeCrop
                                  ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                                  : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                              }`}
                            >
                              {blueprint.freeCrop ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                              <span>Free Rect</span>
                            </button>
                          </>
                        );
                      })()}
                      <span className="text-[11px] font-mono-tabular text-[var(--pc-muted)] pl-1">
                        {sourceDims.width}×{sourceDims.height}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 flex items-center justify-center">
                    <SourceCropCanvas
                      videoUrl={currentClip.rawMediaUrl || currentClip.mediaUrl}
                      previewImage={currentClip.previewImage}
                      videoRef={videoRef}
                      sourceAspect={sourceAr}
                      blueprint={blueprint}
                      activeSlotIndex={activeSlotIndex}
                      onSelectSlot={setActiveSlotIndex}
                      onChangeCrop={handleChangeCrop}
                      onVideoMetadata={(w, h, dur) => {
                        setSourceDims({ width: w, height: h });
                        setDurationSec(dur);
                        onUpdateClipDuration(currentClip.id, dur);
                      }}
                      onVideoTimeUpdate={(t) => setCurrentTimeSec(t)}
                      onVideoEnded={() => setPlaying(false)}
                    />
                  </div>
                </div>

                {/* Pane B: Live Real-Time Framed Output Preview (exact 2D Canvas Compositor) */}
                <div className="h-full min-h-0 flex flex-col items-center">
                  <div className="w-full flex items-center justify-between pb-2 shrink-0">
                    <span className="text-xs font-medium text-[var(--pc-sub)]">
                      Live Framed Output
                    </span>
                    <span className="text-[11px] font-mono-tabular text-[var(--pc-muted)]">
                      {describeFramingBlueprint(blueprint)}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 w-full flex items-center justify-center p-2 overflow-hidden">
                    <div
                      style={{ aspectRatio: String(getCanvasAspectRatio(blueprint.aspect)) }}
                      className="h-full max-h-[560px] max-w-full rounded-xl overflow-hidden bg-black border border-[var(--pc-border)] shadow-2xl"
                    >
                      <FramedCanvasView
                        videoRef={videoRef}
                        blueprint={blueprint}
                        previewRes="auto"
                        testId="framing-live-output-canvas"
                        className="w-full h-full"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Framing Layout & Transport Bar */}
              <div className="shrink-0 border-t border-[var(--pc-border)] bg-[var(--pc-surface)] px-4 py-2.5 flex flex-col gap-2">
                {/* Row 1: 6 Framing Layouts + Swap + Transport */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono-tabular uppercase tracking-wider text-[var(--pc-muted)]">
                      Layout
                    </span>
                    <div
                      role="radiogroup"
                      aria-label="Framing layout mode"
                      className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)]"
                    >
                      {LAYOUT_MODES.map((m) => {
                        const active = blueprint.layout === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => handleChangeLayout(m.id)}
                            className={`h-7 px-2.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer border-0 transition-colors ${
                              active
                                ? 'bg-[var(--pc-surface)] text-[var(--pc-ink)] shadow-sm'
                                : 'bg-transparent text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                            }`}
                          >
                            {LAYOUT_ICONS[m.id]}
                            <span>{m.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {(blueprint.layout === 'split' ||
                      blueprint.layout === 'trio' ||
                      blueprint.layout === 'pip') && (
                      <Button variant="secondary" size="sm" onClick={handleSwapCrops}>
                        <ArrowUpDown className="w-3.5 h-3.5" />
                        <span>Swap Slots</span>
                      </Button>
                    )}
                  </div>

                  {/* Compact Transport Controls */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => seekTo(currentTimeSec - 1)}
                      aria-label="Back 1 second"
                      className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] grid place-items-center cursor-pointer"
                    >
                      <SkipBack className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaying((p) => !p)}
                      aria-label={playing ? 'Pause source preview' : 'Play source preview'}
                      className="h-7 w-8 rounded-full bg-[var(--pc-cta-bg)] text-[var(--pc-cta-fg)] border-0 grid place-items-center cursor-pointer hover:opacity-90"
                    >
                      {playing ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => seekTo(currentTimeSec + 1)}
                      aria-label="Forward 1 second"
                      className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-ink)] hover:bg-[var(--pc-surface-hover)] grid place-items-center cursor-pointer"
                    >
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono-tabular text-[11px] text-[var(--pc-ink)] pl-1.5 whitespace-nowrap">
                      {formatTimecode(currentTimeSec)}{' '}
                      <span className="text-[var(--pc-muted)]">/ {formatTimecode(durationSec)}</span>
                    </span>
                  </div>
                </div>

                {/* Row 2: Clean Seek Scrubber */}
                <input
                  type="range"
                  aria-label="Scrub source video frame"
                  min={0}
                  max={Math.max(0.1, durationSec)}
                  step={0.05}
                  value={currentTimeSec}
                  onChange={(e) => seekTo(Number(e.target.value))}
                  className="w-full h-1.5 accent-[var(--pc-accent)] cursor-pointer"
                />
              </div>
            </>
          )}
        </div>

        {/* Right Framing-Only Inspector (340px — zero templates/captions/music clutter) */}
        <aside
          aria-label="Framing inspector"
          className="w-[340px] shrink-0 border-l border-[var(--pc-border)] bg-[var(--pc-surface)] flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[var(--pc-border)] flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold text-[var(--pc-ink)] m-0">Framing Inspector</h2>
              <p className="text-[11px] text-[var(--pc-muted)] m-0 mt-0.5">
                Geometry, crops, slots, backdrop &amp; corners
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetCrops}
              title="Reset framing to defaults"
              className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[11px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto studio-scroll px-4 py-2 divide-y divide-[var(--pc-border-subtle)]">
            {/* 1. Layout-Specific Geometry (Split Ratio / PiP Camera / Centered Card) */}
            {(blueprint.layout === 'split' ||
              blueprint.layout === 'trio' ||
              blueprint.layout === 'pip' ||
              blueprint.layout === 'centered') && (
              <InspectorAccordion
                title={
                  blueprint.layout === 'pip'
                    ? 'PiP Camera Geometry'
                    : blueprint.layout === 'centered'
                      ? 'Position & Scale'
                      : 'Split & Divider'
                }
                defaultOpen
              >
                {blueprint.layout === 'split' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: '50-50', label: '50 / 50' },
                          { id: '16-9-top', label: '16:9 Top' },
                          { id: '16-9-bottom', label: '16:9 Bottom' },
                        ] as const
                      ).map((preset) => {
                        const targetRatio = computeSplitPresetRatio(preset.id, blueprint.aspect);
                        const active = Math.abs(blueprint.splitRatio - targetRatio) < 0.015;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleChangeSplitRatio(targetRatio, true)}
                            className={`h-7 rounded-md border text-[11px] font-medium cursor-pointer transition-colors ${
                              active
                                ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>

                    <StudioSlider
                      label="Top / Bottom Split"
                      value={Math.round(blueprint.splitRatio * 100)}
                      min={15}
                      max={85}
                      step={1}
                      valueLabel={`${Math.round(blueprint.splitRatio * 100)}% / ${Math.round((1 - blueprint.splitRatio) * 100)}%`}
                      onChange={(v) => handleChangeSplitRatio(v / 100, false)}
                    />
                  </div>
                )}

                {(blueprint.layout === 'split' || blueprint.layout === 'trio') && (
                  <div className="space-y-2.5 pt-2">
                    <StudioSlider
                      label="Divider Line Width"
                      value={blueprint.dividerWidth}
                      min={0}
                      max={20}
                      step={1}
                      valueLabel={`${blueprint.dividerWidth}px`}
                      onChange={(v) => patchBlueprint({ dividerWidth: v }, false)}
                    />
                    {blueprint.dividerWidth > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--pc-sub)]">Divider Color</span>
                        <input
                          type="color"
                          aria-label="Divider line color"
                          value={blueprint.dividerColor}
                          onChange={(e) => patchBlueprint({ dividerColor: e.target.value }, true)}
                          className="h-7 w-10 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                )}

                {blueprint.layout === 'pip' && (
                  <div className="space-y-3">
                    <StudioSwitch
                      checked={Boolean(blueprint.fullFrameSlots?.[0])}
                      label="Full Screen Main Video (100%)"
                      onChange={() => handleToggleFullFrameSlot(0)}
                    />

                    <div>
                      <div className="text-[11px] text-[var(--pc-sub)] mb-1.5">Facecam Style</div>
                      <SegmentedControl<PipShapeId>
                        ariaLabel="PiP shape"
                        size="sm"
                        fullWidth
                        value={blueprint.pip.shape}
                        options={[
                          { value: 'rounded', label: 'Rounded' },
                          { value: 'rect', label: 'Sharp' },
                          { value: 'circle', label: 'Circle' },
                        ]}
                        onChange={(shape) => handleUpdatePip({ shape }, true)}
                      />
                    </div>

                    {blueprint.pip.shape !== 'circle' && (
                      <div>
                        <div className="text-[11px] text-[var(--pc-sub)] mb-1.5">Facecam Ratio</div>
                        <SegmentedControl<PipAspectId>
                          ariaLabel="Facecam aspect ratio"
                          size="sm"
                          fullWidth
                          value={blueprint.pip.aspect ?? '16:9'}
                          options={[
                            { value: '16:9', label: '16:9' },
                            { value: '4:3', label: '4:3' },
                            { value: 'free', label: 'Free Rect' },
                            { value: '1:1', label: '1:1' },
                          ]}
                          onChange={(aspect) => handleUpdatePip({ aspect }, true)}
                        />
                      </div>
                    )}

                    <div>
                      <div className="text-[11px] text-[var(--pc-sub)] mb-1.5">Corner Placement</div>
                      <div className="grid grid-cols-5 gap-1">
                        {(
                          [
                            { id: 'tl', label: 'TL' },
                            { id: 'tr', label: 'TR' },
                            { id: 'bl', label: 'BL' },
                            { id: 'br', label: 'BR' },
                            { id: 'custom', label: 'Free' },
                          ] as { id: PipCornerId; label: string }[]
                        ).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleUpdatePip({ corner: c.id }, true)}
                            className={`h-7 rounded-md border text-[11px] font-medium cursor-pointer ${
                              blueprint.pip.corner === c.id
                                ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {blueprint.pip.corner === 'custom' && (
                      <div className="grid grid-cols-2 gap-2">
                        <StudioSlider
                          label="PiP X"
                          value={blueprint.pip.x}
                          min={0}
                          max={85}
                          valueLabel={`${blueprint.pip.x}%`}
                          onChange={(x) => handleUpdatePip({ x }, false)}
                        />
                        <StudioSlider
                          label="PiP Y"
                          value={blueprint.pip.y}
                          min={0}
                          max={85}
                          valueLabel={`${blueprint.pip.y}%`}
                          onChange={(y) => handleUpdatePip({ y }, false)}
                        />
                      </div>
                    )}

                    <StudioSlider
                      label="Facecam Width"
                      value={blueprint.pip.scale}
                      min={15}
                      max={80}
                      valueLabel={`${blueprint.pip.scale}%`}
                      onChange={(scale) => handleUpdatePip({ scale }, false)}
                    />

                    {blueprint.pip.shape === 'rounded' && (
                      <StudioSlider
                        label="Corner Radius"
                        value={blueprint.pip.radius}
                        min={0}
                        max={60}
                        valueLabel={`${blueprint.pip.radius}px`}
                        onChange={(radius) => handleUpdatePip({ radius }, false)}
                      />
                    )}

                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <StudioSlider
                          label="Border"
                          value={blueprint.pip.borderWidth}
                          min={0}
                          max={16}
                          valueLabel={`${blueprint.pip.borderWidth}px`}
                          onChange={(borderWidth) => handleUpdatePip({ borderWidth }, false)}
                        />
                      </div>
                      <input
                        type="color"
                        aria-label="PiP border color"
                        value={blueprint.pip.borderColor}
                        onChange={(e) => handleUpdatePip({ borderColor: e.target.value }, true)}
                        className="h-7 w-9 mt-3 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <StudioSwitch
                        checked={blueprint.pip.shadow}
                        label="Drop Shadow"
                        onChange={(shadow) => handleUpdatePip({ shadow }, true)}
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdatePip({ flip: !blueprint.pip.flip }, true)}
                        className={`h-7 px-2.5 rounded-md border text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                          blueprint.pip.flip
                            ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                            : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)]'
                        }`}
                      >
                        <FlipHorizontal2 className="w-3 h-3" />
                        <span>Flip H</span>
                      </button>
                    </div>
                  </div>
                )}

                {blueprint.layout === 'centered' && (
                  <div className="space-y-3">
                    <StudioSlider
                      label="Scale"
                      value={Math.round(blueprint.centeredScale * 100)}
                      min={40}
                      max={180}
                      valueLabel={`${Math.round(blueprint.centeredScale * 100)}%`}
                      onChange={(v) => patchBlueprint({ centeredScale: v / 100 }, false)}
                    />
                    <StudioSlider
                      label="Pos X"
                      value={blueprint.centeredPanX}
                      min={-50}
                      max={50}
                      valueLabel={`${blueprint.centeredPanX}%`}
                      onChange={(centeredPanX) => patchBlueprint({ centeredPanX }, false)}
                    />
                    <StudioSlider
                      label="Pos Y"
                      value={blueprint.centeredPanY}
                      min={-50}
                      max={50}
                      valueLabel={`${blueprint.centeredPanY}%`}
                      onChange={(centeredPanY) => patchBlueprint({ centeredPanY }, false)}
                    />
                    <StudioSlider
                      label="Card Shadow"
                      value={blueprint.centerShadow}
                      min={0}
                      max={100}
                      valueLabel={`${blueprint.centerShadow}%`}
                      onChange={(centerShadow) => patchBlueprint({ centerShadow }, false)}
                    />
                  </div>
                )}
              </InspectorAccordion>
            )}

            {/* 2. Per-Slot Custom Media Overrides (decompiled slotMedia) */}
            {croppableSlots.length > 0 && (
              <InspectorAccordion title="Slot Sources" badge={Object.keys(blueprint.slotMedia).length ? `${Object.keys(blueprint.slotMedia).length} custom` : undefined}>
                <input
                  ref={slotFileInputRef}
                  type="file"
                  accept="video/*,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleSlotFileUpload(file);
                    e.target.value = '';
                  }}
                />
                <p className="text-[11px] text-[var(--pc-muted)] m-0 mb-2">
                  Replace any slot with a separate video or image (e.g., B-roll, gameplay, or external facecam).
                </p>
                <div className="space-y-2">
                  {croppableSlots.map((slot, idx) => {
                    const override = blueprint.slotMedia[idx];
                    return (
                      <div
                        key={slot.label}
                        className="p-2 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[var(--pc-ink)] truncate">
                            {slot.label}
                          </div>
                          <div className="text-[10.5px] font-mono-tabular text-[var(--pc-muted)] truncate">
                            {override ? override.name : 'Using primary source crop'}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setPendingSlotUploadIdx(idx);
                              slotFileInputRef.current?.click();
                            }}
                            className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[11px] text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Upload className="w-3 h-3" />
                            <span>{override ? 'Replace' : 'Import'}</span>
                          </button>
                          {override && (
                            <button
                              type="button"
                              aria-label={`Clear custom media for ${slot.label}`}
                              onClick={() => handleRemoveSlotMedia(idx)}
                              className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[var(--pc-sub)] hover:text-[var(--pc-err)] grid place-items-center cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </InspectorAccordion>
            )}

            {/* 3. Video Backdrop (Blur / Color / Gradient / Image) */}
            <InspectorAccordion title="Video Backdrop" badge={blueprint.backdrop.kind} defaultOpen>
              <div className="space-y-3">
                <SegmentedControl<BackdropKindId>
                  ariaLabel="Backdrop mode"
                  size="sm"
                  fullWidth
                  value={blueprint.backdrop.kind}
                  options={[
                    { value: 'blur', label: 'Blur' },
                    { value: 'color', label: 'Color' },
                    { value: 'gradient', label: 'Gradient' },
                    { value: 'image', label: 'Image' },
                  ]}
                  onChange={(kind) =>
                    patchBlueprint({ backdrop: { ...blueprint.backdrop, kind } }, true)
                  }
                />

                {blueprint.backdrop.kind === 'blur' && (
                  <>
                    <StudioSlider
                      label="Blur Amount"
                      value={blueprint.backdrop.blur}
                      min={0}
                      max={60}
                      valueLabel={`${blueprint.backdrop.blur}px`}
                      onChange={(blur) =>
                        patchBlueprint({ backdrop: { ...blueprint.backdrop, blur } }, false)
                      }
                    />
                    <StudioSlider
                      label="Dim Backdrop"
                      value={Math.round(blueprint.backdrop.dim * 100)}
                      min={0}
                      max={85}
                      valueLabel={`${Math.round(blueprint.backdrop.dim * 100)}%`}
                      onChange={(v) =>
                        patchBlueprint({ backdrop: { ...blueprint.backdrop, dim: v / 100 } }, false)
                      }
                    />
                  </>
                )}

                {blueprint.backdrop.kind === 'color' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--pc-sub)]">Backdrop Color</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="color"
                          aria-label="Backdrop color picker"
                          value={blueprint.backdrop.color}
                          onChange={(e) =>
                            patchBlueprint(
                              { backdrop: { ...blueprint.backdrop, color: e.target.value } },
                              true
                            )
                          }
                          className="h-7 w-8 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                        />
                        <span className="font-mono-tabular text-[11px] text-[var(--pc-sub)]">
                          {blueprint.backdrop.color.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-8 gap-1.5">
                      {OUTER_FILL_SWATCHES.map(({ hex, label }) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Backdrop color ${label}`}
                          onClick={() =>
                            patchBlueprint({ backdrop: { ...blueprint.backdrop, color: hex } }, true)
                          }
                          style={{ backgroundColor: hex }}
                          className={`h-5 rounded border cursor-pointer ${
                            blueprint.backdrop.color.toLowerCase() === hex.toLowerCase()
                              ? 'border-[var(--pc-accent)] ring-1 ring-[var(--pc-accent)]'
                              : 'border-[var(--pc-border)]'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {blueprint.backdrop.kind === 'gradient' && (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center justify-between p-1.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[11px] text-[var(--pc-sub)]">
                        <span>Start</span>
                        <input
                          type="color"
                          value={blueprint.backdrop.from}
                          onChange={(e) =>
                            patchBlueprint(
                              { backdrop: { ...blueprint.backdrop, from: e.target.value } },
                              true
                            )
                          }
                          className="h-5 w-7 border-0 bg-transparent cursor-pointer"
                        />
                      </label>
                      <label className="flex items-center justify-between p-1.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[11px] text-[var(--pc-sub)]">
                        <span>End</span>
                        <input
                          type="color"
                          value={blueprint.backdrop.to}
                          onChange={(e) =>
                            patchBlueprint(
                              { backdrop: { ...blueprint.backdrop, to: e.target.value } },
                              true
                            )
                          }
                          className="h-5 w-7 border-0 bg-transparent cursor-pointer"
                        />
                      </label>
                    </div>
                    <StudioSlider
                      label="Gradient Angle"
                      value={blueprint.backdrop.angle}
                      min={0}
                      max={360}
                      valueLabel={`${blueprint.backdrop.angle}°`}
                      onChange={(angle) =>
                        patchBlueprint({ backdrop: { ...blueprint.backdrop, angle } }, false)
                      }
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      {GRADIENT_PRESETS.slice(0, 6).map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => {
                            const matches = g.css.match(/#[0-9a-fA-F]{6}/g) || ['#111827', '#030712'];
                            patchBlueprint(
                              {
                                backdrop: {
                                  ...blueprint.backdrop,
                                  kind: 'gradient',
                                  from: matches[0],
                                  to: matches[matches.length - 1],
                                },
                              },
                              true
                            );
                          }}
                          style={{ background: g.css }}
                          className="h-6 rounded-md border border-white/15 text-[10px] font-medium text-white shadow-sm cursor-pointer"
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {blueprint.backdrop.kind === 'image' && (
                  <div className="space-y-2.5">
                    <input
                      ref={bgFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleBackdropImageUpload(f);
                        e.target.value = '';
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => bgFileInputRef.current?.click()}
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>{blueprint.backdrop.imgName || 'Upload Backdrop Image'}</span>
                    </Button>
                    <StudioSlider
                      label="Image Blur"
                      value={blueprint.backdrop.imgBlur}
                      min={0}
                      max={25}
                      valueLabel={`${blueprint.backdrop.imgBlur}px`}
                      onChange={(imgBlur) =>
                        patchBlueprint({ backdrop: { ...blueprint.backdrop, imgBlur } }, false)
                      }
                    />
                    <StudioSlider
                      label="Image Dim"
                      value={Math.round(blueprint.backdrop.imgDim * 100)}
                      min={0}
                      max={70}
                      valueLabel={`${Math.round(blueprint.backdrop.imgDim * 100)}%`}
                      onChange={(v) =>
                        patchBlueprint({ backdrop: { ...blueprint.backdrop, imgDim: v / 100 } }, false)
                      }
                    />
                  </div>
                )}
              </div>
            </InspectorAccordion>

            {/* 4. Frame & Corners + Outer Margin Fill */}
            <InspectorAccordion title="Frame & Corners" badge={`${blueprint.radius}px / ${blueprint.padding}px`}>
              <div className="space-y-3">
                <StudioSlider
                  label="Corner Radius"
                  value={blueprint.radius}
                  min={0}
                  max={80}
                  valueLabel={`${blueprint.radius}px`}
                  onChange={(radius) => patchBlueprint({ radius }, false)}
                />
                <StudioSlider
                  label="Outer Margin Padding"
                  value={blueprint.padding}
                  min={0}
                  max={80}
                  valueLabel={`${blueprint.padding}px`}
                  onChange={(padding) => patchBlueprint({ padding }, false)}
                />
                <div className="pt-1 border-t border-[var(--pc-border-subtle)] space-y-2.5">
                  <StudioSwitch
                    checked={blueprint.fillActive}
                    label="Outer Margin Fill"
                    onChange={(fillActive) => patchBlueprint({ fillActive }, true)}
                  />
                  {blueprint.fillActive && (
                    <>
                      <SegmentedControl<'solid' | 'gradient'>
                        ariaLabel="Outer margin fill type"
                        size="sm"
                        fullWidth
                        value={blueprint.fillKind}
                        options={[
                          { value: 'solid', label: 'Solid' },
                          { value: 'gradient', label: 'Gradient' },
                        ]}
                        onChange={(fillKind) => patchBlueprint({ fillKind }, true)}
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          aria-label="Outer fill primary color"
                          value={blueprint.fillColor}
                          onChange={(e) => patchBlueprint({ fillColor: e.target.value }, true)}
                          className="h-7 w-9 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                        />
                        {blueprint.fillKind === 'gradient' && (
                          <input
                            type="color"
                            aria-label="Outer fill secondary color"
                            value={blueprint.fillTo}
                            onChange={(e) => patchBlueprint({ fillTo: e.target.value }, true)}
                            className="h-7 w-9 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                          />
                        )}
                        <span className="font-mono-tabular text-[11px] text-[var(--pc-sub)]">
                          {blueprint.fillColor.toUpperCase()}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </InspectorAccordion>

            {/* 5. Playback Speed */}
            <InspectorAccordion title="Playback Speed" badge={`${blueprint.speed.toFixed(2)}×`}>
              <div className="space-y-3">
                <div className="grid grid-cols-6 gap-1">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => patchBlueprint({ speed: rate }, true)}
                      className={`h-7 rounded-md border text-[11px] font-mono-tabular cursor-pointer ${
                        Math.abs(blueprint.speed - rate) < 0.01
                          ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                          : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                      }`}
                    >
                      {rate}×
                    </button>
                  ))}
                </div>
                <StudioSlider
                  label="Custom Rate"
                  value={Math.round(blueprint.speed * 100)}
                  min={25}
                  max={250}
                  step={5}
                  valueLabel={`${blueprint.speed.toFixed(2)}×`}
                  onChange={(v) => patchBlueprint({ speed: v / 100 }, false)}
                />
              </div>
            </InspectorAccordion>

            {/* 6. Exact Crop Coordinates */}
            {croppableSlots.length > 0 && activeCrop && activeSlotMeta && (
              <InspectorAccordion title="Coordinates" badge={activeSlotMeta.label}>
                <div className="space-y-2.5">
                  {croppableSlots.length > 1 && (
                    <div className="flex items-center gap-1">
                      {croppableSlots.map((slot, idx) => (
                        <button
                          key={slot.label}
                          type="button"
                          onClick={() => setActiveSlotIndex(idx)}
                          className={`flex-1 h-7 rounded-md border text-[11px] font-medium cursor-pointer ${
                            activeSlotIndex === idx
                              ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                              : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)]'
                          }`}
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { key: 'x', label: 'X %', val: activeCrop.x * 100 },
                        { key: 'y', label: 'Y %', val: activeCrop.y * 100 },
                        { key: 'w', label: 'W %', val: activeCrop.w * 100 },
                        { key: 'h', label: 'H %', val: activeCrop.h * 100 },
                      ] as const
                    ).map((field) => {
                      const activeIsFree = Boolean(
                        blueprint.freeCrop ||
                          (blueprint.layout === 'pip' &&
                            activeSlotIndex === 1 &&
                            blueprint.pip.shape !== 'circle' &&
                            (blueprint.pip.aspect ?? '16:9') === 'free')
                      );
                      return (
                        <label
                          key={field.key}
                          className="flex flex-col gap-1 text-[11px] text-[var(--pc-sub)]"
                        >
                          <span>{field.label}</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(field.val)}
                            onChange={(e) => {
                              const num = clampNum(Number(e.target.value) || 0, 0, 100) / 100;
                              const raw = { ...activeCrop, [field.key]: num };
                              const slotAr = getSlotAspect(activeSlotMeta, blueprint.aspect);
                              const nextCrop =
                                field.key === 'w' || field.key === 'h'
                                  ? activeIsFree
                                    ? clampCrop(raw)
                                    : fitCropToAspect(raw, slotAr, sourceAr)
                                  : {
                                      ...activeCrop,
                                      [field.key]: clampNum(
                                        num,
                                        0,
                                        1 - (field.key === 'x' ? activeCrop.w : activeCrop.h)
                                      ),
                                    };
                              handleChangeCrop(activeSlotIndex, nextCrop, true);
                            }}
                            className="h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-mono-tabular text-[var(--pc-ink)]"
                          />
                        </label>
                      );
                    })}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => handleToggleFullFrameSlot(activeSlotIndex)}
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>
                      {blueprint.fullFrameSlots?.[activeSlotIndex]
                        ? 'Restore Cropped Region'
                        : `Use Whole Full Screen (100%) for ${activeSlotMeta.label}`}
                    </span>
                  </Button>

                  <div className="text-[11px] font-mono-tabular text-[var(--pc-muted)]">
                    Pixel region: {Math.round(activeCrop.w * sourceDims.width)}×
                    {Math.round(activeCrop.h * sourceDims.height)} at (
                    {Math.round(activeCrop.x * sourceDims.width)},{' '}
                    {Math.round(activeCrop.y * sourceDims.height)})
                  </div>
                </div>
              </InspectorAccordion>
            )}

            {/* 7. Reusable Framing Presets */}
            <InspectorAccordion title="Framing Presets" badge={savedPresets.length ? String(savedPresets.length) : undefined}>
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Preset name (e.g. Kick Split)"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    className="flex-1 h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)]"
                  />
                  <Button variant="secondary" size="sm" onClick={handleSavePreset}>
                    <Save className="w-3 h-3" />
                    <span>Save</span>
                  </Button>
                </div>

                {savedPresets.length === 0 ? (
                  <p className="text-[11px] text-[var(--pc-muted)] m-0">
                    Save framing blueprints to reuse across clips.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {savedPresets.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)]"
                      >
                        <button
                          type="button"
                          onClick={() => handleApplyPreset(p)}
                          className="flex-1 text-left bg-transparent border-0 p-0 cursor-pointer min-w-0"
                        >
                          <div className="text-xs font-medium text-[var(--pc-ink)] truncate">
                            {p.name}
                          </div>
                          <div className="text-[10px] font-mono-tabular text-[var(--pc-muted)]">
                            {p.blueprint.aspect} · {p.blueprint.layout}
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete preset ${p.name}`}
                          onClick={() => handleDeletePreset(p.id)}
                          className="h-6 w-6 rounded grid place-items-center text-[var(--pc-muted)] hover:text-[var(--pc-err)] bg-transparent border-0 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </InspectorAccordion>
          </div>

          {/* Pinned Footer CTA: Lock Framing Blueprint → Build Shorts */}
          <div className="p-3 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/60">
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={onProceedToShorts}
            >
              <span>Make Short With This Framing</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
