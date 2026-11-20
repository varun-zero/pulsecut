import React, { useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalSpaceAround,
  BookmarkPlus,
  Eye,
  FileText,
  Frame,
  Image as ImageIcon,
  LayoutTemplate,
  Lock,
  Music,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import type {
  BrandKit,
  CanvasModeId,
  CaptionAnimationId,
  CardThemeId,
  ClipItem,
  CustomFontEntry,
  EditorSettings,
  EditorTabId,
  FacecamPlacementId,
  FacecamSourceBox,
  FrameAspectId,
  HeadlineLayoutStyleId,
  KickBadgeMode,
  SavedStylePreset,
  SpeakerCropKey,
  StageViewModeId,
  StreamerPlatformId,
  SubtitleBgStyleId,
  TextAlignId,
  TextCasingId,
  TextSubtabId,
  VideoFitId,
  WordPacingId,
} from '../../types';
import {
  CANVAS_MODES,
  CORNER_RADIUS_PRESETS,
  DEFAULT_FACECAM_SOURCE_BOX,
  DEFAULT_SPEAKER_CROPS,
  FACECAM_PLACEMENT_OPTIONS,
  FEATURED_PRESETS,
  FRAME_ASPECT_OPTIONS,
  FRAME_PADDING_PRESETS,
  GRADIENT_PRESETS,
  HEADLINE_LAYOUT_OPTIONS,
  OUTER_FILL_SWATCHES,
  PLAYBACK_SPEEDS,
  STREAMER_PLATFORM_OPTIONS,
  SUBTITLE_BG_OPTIONS,
  WATERMARK_POSITIONS,
  getTemplatePreset,
  type TemplatePreset,
} from '../../presets';
import {
  CAPTION_ANIMATION_OPTIONS,
  EMPHASIS_QUICK_SWATCHES,
  WORD_PACING_OPTIONS,
  getSafeZoneSpec,
  type ViralCaptionPreset,
} from '../../captionStyles';
import { clampFacecamSourceBox } from '../../lib/studioLogic';
import {
  Button,
  InspectorAccordion,
  SegmentedControl,
  StudioSelect,
  StudioSlider,
  StudioSwitch,
  TemplateMiniPreview,
  ViralCaptionPresetCards,
  ViralFontSelect,
} from '../ui/Primitives';
import { FacecamSourcePicker } from './FacecamSourcePicker';

const STYLE_PRESETS_STORAGE_KEY = 'pulsecut-style-presets';

function loadSavedStylePresets(): SavedStylePreset[] {
  try {
    const raw = localStorage.getItem(STYLE_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface EditorInspectorProps {
  clip: ClipItem | null;
  currentTimeSec: number;
  stageMode: StageViewModeId;
  onToggleStageMode: () => void;
  activeTab: EditorTabId;
  onChangeTab: (tab: EditorTabId) => void;
  textSubtab: TextSubtabId;
  onChangeTextSubtab: (subtab: TextSubtabId) => void;
  settings: EditorSettings;
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  onSelectTemplatePreset: (preset: TemplatePreset) => void;
  onSelectCaptionPreset: (preset: ViralCaptionPreset) => void;
  brandKit: BrandKit;
  onUpdateBrandKit: (next: BrandKit) => void;
  customFonts: readonly CustomFontEntry[];
  onUploadCustomFont: (file: File) => void;
  onImportSrt: (file: File) => void;
  onUpdateCueWord: (index: number, nextText: string) => void;
  onSetWordEmphasis: (cueIndex: number, tokenIndex: number, color: string | null) => void;
  onAutoAlignSubtitles: () => void;
  onOpenTemplateLibrary: () => void;
  onOpenClipPicker: () => void;
  onNotify?: (msg: string) => void;
}

const INSPECTOR_TABS: readonly { id: EditorTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'framing', label: 'Framing', icon: <Frame className="w-3.5 h-3.5 stroke-[1.75]" /> },
  {
    id: 'templates',
    label: 'Templates',
    icon: <LayoutTemplate className="w-3.5 h-3.5 stroke-[1.75]" />,
  },
  { id: 'text', label: 'Text', icon: <Type className="w-3.5 h-3.5 stroke-[1.75]" /> },
  { id: 'media', label: 'Media', icon: <Music className="w-3.5 h-3.5 stroke-[1.75]" /> },
];

const ALIGN_OPTIONS: readonly { value: TextAlignId; label: string; icon: React.ReactNode }[] = [
  { value: 'left', label: 'Left', icon: <AlignLeft className="w-3.5 h-3.5" /> },
  { value: 'center', label: 'Center', icon: <AlignCenter className="w-3.5 h-3.5" /> },
  { value: 'right', label: 'Right', icon: <AlignRight className="w-3.5 h-3.5" /> },
];

export function EditorInspector({
  clip,
  currentTimeSec,
  stageMode,
  onToggleStageMode,
  activeTab,
  onChangeTab,
  textSubtab,
  onChangeTextSubtab,
  settings,
  onUpdateSettings,
  onSelectTemplatePreset,
  onSelectCaptionPreset,
  brandKit,
  onUpdateBrandKit,
  customFonts,
  onUploadCustomFont,
  onImportSrt,
  onUpdateCueWord,
  onSetWordEmphasis,
  onAutoAlignSubtitles,
  onOpenTemplateLibrary,
  onOpenClipPicker,
  onNotify,
}: EditorInspectorProps) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const [stylePresets, setStylePresets] = useState<SavedStylePreset[]>(() =>
    loadSavedStylePresets()
  );
  const [newPresetName, setNewPresetName] = useState('');
  const [selectedEmphasisToken, setSelectedEmphasisToken] = useState<{
    cueIndex: number;
    tokenIndex: number;
    word: string;
  } | null>(null);

  const persistStylePresets = (next: SavedStylePreset[]) => {
    setStylePresets(next);
    try {
      localStorage.setItem(STYLE_PRESETS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  };

  const handleSaveStylePreset = () => {
    const label = newPresetName.trim() || `${settings.layout.toUpperCase()} ${settings.cornerRadius}px`;
    const entry: SavedStylePreset = {
      id: `preset-${Date.now()}`,
      name: label,
      layout: settings.layout,
      aspect: settings.aspect,
      canvas: settings.canvas,
      cornerRadius: settings.cornerRadius,
      framePadding: settings.framePadding,
      outerFill: settings.outerFill,
      outerFillActive: settings.outerFillActive,
      outerGradient: settings.outerGradient,
      playbackSpeed: settings.playbackSpeed,
    };
    persistStylePresets([entry, ...stylePresets]);
    setNewPresetName('');
    onNotify?.(`Saved style preset "${label}"`);
  };

  const handleDeleteStylePreset = (id: string) => {
    persistStylePresets(stylePresets.filter((p) => p.id !== id));
    onNotify?.('Removed saved style preset');
  };

  const updateCoordinateField = (
    target: SpeakerCropKey | 'facecam',
    field: keyof FacecamSourceBox,
    rawVal: string
  ) => {
    const num = Number(rawVal);
    if (!Number.isFinite(num)) return;
    if (target === 'facecam') {
      const next = clampFacecamSourceBox({ ...settings.facecamSourceBox, [field]: num });
      onUpdateSettings({ facecamSourceBox: next }, true);
    } else {
      const current = settings.speakerCrops[target];
      const next = clampFacecamSourceBox({ ...current, [field]: num });
      onUpdateSettings(
        { speakerCrops: { ...settings.speakerCrops, [target]: next } },
        true
      );
    }
  };

  const activePreset = getTemplatePreset(settings.template);
  const activeSafeZone = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
  const isKickTemplate = settings.template === 'kick-stream' || settings.template === 'split-stream';

  return (
    <aside
      data-testid="editor-inspector"
      aria-label="Clip Inspector"
      className="w-[340px] shrink-0 border-l border-[var(--pc-border)] bg-[var(--pc-surface)] flex flex-col min-h-0"
    >
      {/* Single Source of Truth Inspector Tab Bar */}
      <div
        role="tablist"
        aria-label="Inspector sections"
        className="grid grid-cols-4 border-b border-[var(--pc-border)] px-2 pt-2 gap-1 shrink-0"
      >
        {INSPECTOR_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChangeTab(tab.id)}
              className={`h-9 rounded-t-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer bg-transparent ${
                active
                  ? 'border-[var(--pc-accent)] text-[var(--pc-ink)] bg-[var(--pc-surface-2)]/60'
                  : 'border-transparent text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Independently Scrollable Tab Body */}
      {!clip ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-10 h-10 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center text-[var(--pc-muted)] mb-3">
            <Lock className="w-4 h-4 stroke-[1.75]" />
          </div>
          <div className="text-xs font-medium text-[var(--pc-ink)]">Inspector inactive</div>
          <p className="text-xs text-[var(--pc-muted)] mt-1 mb-4 max-w-[220px] leading-relaxed">
            Load a clip to configure framing, viral templates, watermarks, captions, and audio.
          </p>
          <Button variant="secondary" size="sm" onClick={onOpenClipPicker}>
            Select a Clip
          </Button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto studio-scroll">
          {/* ===================== TAB 1: FRAMING (YIZERGE 1-to-1) ===================== */}
          {activeTab === 'framing' && (
            <>
              {/* 1. Frame & Corners + Outer Margin Fill + Canvas Backdrop */}
              <InspectorAccordion title="Frame & Corners" defaultOpen>
                <p className="text-[11px] text-[var(--pc-muted)] m-0 leading-relaxed">
                  Shapes the video card with rounded corners and outer margins.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <StudioSlider
                      label="Radius"
                      value={settings.cornerRadius}
                      min={0}
                      max={36}
                      unit="px"
                      onChange={(cornerRadius) => onUpdateSettings({ cornerRadius }, false)}
                    />
                    <StudioSelect<string>
                      ariaLabel="Corner radius preset"
                      value={
                        CORNER_RADIUS_PRESETS.some((p) => p.value === settings.cornerRadius)
                          ? String(settings.cornerRadius)
                          : String(CORNER_RADIUS_PRESETS[0].value)
                      }
                      options={CORNER_RADIUS_PRESETS.map((p) => ({
                        value: String(p.value),
                        label: p.label,
                      }))}
                      onChange={(v) => onUpdateSettings({ cornerRadius: Number(v) }, true)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <StudioSlider
                      label="Padding"
                      value={settings.framePadding}
                      min={0}
                      max={36}
                      unit="px"
                      onChange={(framePadding) => onUpdateSettings({ framePadding }, false)}
                    />
                    <StudioSelect<string>
                      ariaLabel="Frame padding preset"
                      value={
                        FRAME_PADDING_PRESETS.some((p) => p.value === settings.framePadding)
                          ? String(settings.framePadding)
                          : String(FRAME_PADDING_PRESETS[0].value)
                      }
                      options={FRAME_PADDING_PRESETS.map((p) => ({
                        value: String(p.value),
                        label: p.label,
                      }))}
                      onChange={(v) => onUpdateSettings({ framePadding: Number(v) }, true)}
                    />
                  </div>
                </div>

                {/* Outer Margin Fill Active Toggle */}
                <div className="pt-2 border-t border-[var(--pc-border-subtle)] flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--pc-sub)]">
                    Outer Margin Fill
                  </span>
                  <button
                    type="button"
                    aria-pressed={settings.outerFillActive}
                    onClick={() =>
                      onUpdateSettings({ outerFillActive: !settings.outerFillActive }, true)
                    }
                    className={`h-6 px-2.5 rounded-md border text-[11px] font-medium cursor-pointer transition-colors ${
                      settings.outerFillActive
                        ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                        : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-muted)]'
                    }`}
                  >
                    {settings.outerFillActive ? 'Active' : 'Off'}
                  </button>
                </div>

                {/* Canvas Backdrop Selector (Color | Blur | Gradient | Padding | Image) */}
                <div className="space-y-2">
                  <SegmentedControl<CanvasModeId>
                    ariaLabel="Canvas fill mode"
                    size="sm"
                    fullWidth
                    value={settings.canvas}
                    options={CANVAS_MODES.map((m) => ({ value: m.id, label: m.label }))}
                    onChange={(canvas) => onUpdateSettings({ canvas }, true)}
                  />

                  {settings.canvas === 'gradient' ? (
                    <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                      {GRADIENT_PRESETS.map((grad) => {
                        const active = settings.outerGradient === grad.css;
                        return (
                          <button
                            key={grad.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              onUpdateSettings(
                                { outerGradient: grad.css, outerFillActive: true },
                                true
                              )
                            }
                            className={`h-9 rounded-md border text-[10px] font-medium text-white shadow-inner cursor-pointer transition-transform ${
                              active
                                ? 'border-[var(--pc-accent)] ring-2 ring-[var(--pc-accent)]/35'
                                : 'border-[var(--pc-border)] hover:scale-[1.02]'
                            }`}
                            style={{ backgroundImage: grad.css }}
                          >
                            {grad.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : settings.canvas === 'image' ? (
                    <div className="space-y-2.5 pt-0.5">
                      <input
                        ref={bgImageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (settings.bgImageUrl?.startsWith('blob:')) {
                            URL.revokeObjectURL(settings.bgImageUrl);
                          }
                          onUpdateSettings(
                            { bgImageUrl: URL.createObjectURL(file), outerFillActive: true },
                            true
                          );
                          onNotify?.(`Loaded canvas backdrop image: ${file.name}`);
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1"
                          onClick={() => bgImageInputRef.current?.click()}
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          <span>{settings.bgImageUrl ? 'Replace Wallpaper' : 'Upload Image'}</span>
                        </Button>
                        {settings.bgImageUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (settings.bgImageUrl.startsWith('blob:')) {
                                URL.revokeObjectURL(settings.bgImageUrl);
                              }
                              onUpdateSettings({ bgImageUrl: '' }, true);
                            }}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                      <StudioSlider
                        label="Wallpaper Blur"
                        value={settings.bgImageBlur}
                        min={0}
                        max={32}
                        unit="px"
                        onChange={(bgImageBlur) => onUpdateSettings({ bgImageBlur }, false)}
                      />
                      <StudioSlider
                        label="Wallpaper Dim"
                        value={settings.bgImageDim}
                        min={0}
                        max={80}
                        unit="%"
                        onChange={(bgImageDim) => onUpdateSettings({ bgImageDim }, false)}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--pc-sub)]">Color</span>
                        <div className="flex items-center gap-1.5">
                          <label
                            title="Pick custom outer fill color"
                            className="w-6 h-6 rounded-full border border-[var(--pc-border)] overflow-hidden cursor-pointer shrink-0"
                            style={{ backgroundColor: settings.outerFill }}
                          >
                            <input
                              type="color"
                              aria-label="Outer fill color picker"
                              value={settings.outerFill}
                              onChange={(e) =>
                                onUpdateSettings(
                                  { outerFill: e.target.value, outerFillActive: true },
                                  false
                                )
                              }
                              className="opacity-0 w-full h-full cursor-pointer"
                            />
                          </label>
                          <input
                            type="text"
                            aria-label="Outer fill hex color"
                            value={settings.outerFill}
                            onChange={(e) =>
                              onUpdateSettings(
                                { outerFill: e.target.value, outerFillActive: true },
                                false
                              )
                            }
                            className="w-24 h-7 px-2 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)] font-mono-tabular text-[11px] text-[var(--pc-ink)] uppercase outline-none focus:border-[var(--pc-accent)]"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-8 gap-1.5">
                        {OUTER_FILL_SWATCHES.map((swatch) => {
                          const active =
                            settings.outerFill.toLowerCase() === swatch.hex.toLowerCase();
                          return (
                            <button
                              key={swatch.hex}
                              type="button"
                              title={swatch.label}
                              aria-label={`Set outer fill to ${swatch.label}`}
                              onClick={() =>
                                onUpdateSettings(
                                  { outerFill: swatch.hex, outerFillActive: true },
                                  true
                                )
                              }
                              className={`h-6 rounded-md border transition-transform cursor-pointer ${
                                active
                                  ? 'border-[var(--pc-accent)] ring-2 ring-[var(--pc-accent)]/35 scale-105'
                                  : 'border-[var(--pc-border)] hover:scale-105'
                              }`}
                              style={{ backgroundColor: swatch.hex }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </InspectorAccordion>

              {/* 2. Streamer Facecam & Reaction PiP Manual Crop + Output Position */}
              <InspectorAccordion
                title="Streamer Facecam & Reaction PiP"
                defaultOpen={
                  settings.facecamEnabled ||
                  settings.layout === 'pip' ||
                  settings.template === 'reaction-pip'
                }
              >
                <StudioSwitch
                  id="facecam-enabled-toggle"
                  label="Include Streamer Facecam"
                  description="Crop the streamer's face from the 16:9 source into your vertical short"
                  checked={settings.facecamEnabled}
                  onChange={(facecamEnabled) =>
                    onUpdateSettings(
                      {
                        facecamEnabled,
                        layout: facecamEnabled
                          ? settings.facecamPlacement.startsWith('split')
                            ? 'split'
                            : 'pip'
                          : 'solo',
                      },
                      true
                    )
                  }
                />

                {settings.facecamEnabled && (
                  <div className="space-y-3 pt-2 border-t border-[var(--pc-border-subtle)]">
                    <FacecamSourcePicker
                      clip={clip}
                      currentTimeSec={currentTimeSec}
                      box={settings.facecamSourceBox}
                      onChange={(facecamSourceBox, commit) =>
                        onUpdateSettings({ facecamSourceBox }, Boolean(commit))
                      }
                    />

                    <StudioSelect
                      ariaLabel="Facecam Position in Short"
                      label="Facecam Position in Short"
                      value={settings.facecamPlacement}
                      options={FACECAM_PLACEMENT_OPTIONS.map((o) => ({
                        value: o.value,
                        label: o.label,
                      }))}
                      onChange={(val) => {
                        const placement = val as FacecamPlacementId;
                        const isSplit = placement === 'split-top' || placement === 'split-bottom';
                        const presetY =
                          placement === 'top' ? 20 : placement === 'bottom' ? 78 : settings.facecamOutputY;
                        onUpdateSettings(
                          {
                            facecamPlacement: placement,
                            layout: isSplit ? 'split' : 'pip',
                            facecamOutputX: isSplit ? 50 : settings.facecamOutputX,
                            facecamOutputY: presetY,
                          },
                          true
                        );
                      }}
                    />

                    {settings.facecamPlacement === 'split-top' ||
                    settings.facecamPlacement === 'split-bottom' ? (
                      <StudioSlider
                        id="facecam-split-ratio"
                        label="Facecam Split Height"
                        value={settings.facecamSplitRatio}
                        min={25}
                        max={65}
                        unit="%"
                        onChange={(facecamSplitRatio) =>
                          onUpdateSettings({ facecamSplitRatio }, false)
                        }
                      />
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <span className="block text-xs text-[var(--pc-sub)]">
                            Facecam Box Aspect
                          </span>
                          <SegmentedControl<FrameAspectId>
                            ariaLabel="Facecam box aspect ratio"
                            size="sm"
                            fullWidth
                            value={settings.facecamOutputAspect}
                            options={FRAME_ASPECT_OPTIONS.map((a) => ({
                              value: a.value,
                              label: a.label,
                            }))}
                            onChange={(facecamOutputAspect) =>
                              onUpdateSettings({ facecamOutputAspect }, true)
                            }
                          />
                        </div>

                        <StudioSlider
                          id="facecam-width"
                          label="Facecam Width"
                          value={settings.facecamOutputWidth}
                          min={24}
                          max={92}
                          unit="%"
                          onChange={(facecamOutputWidth) =>
                            onUpdateSettings({ facecamOutputWidth }, false)
                          }
                        />
                        <StudioSlider
                          id="facecam-out-x"
                          label="Facecam Horizontal (X)"
                          value={settings.facecamOutputX}
                          min={12}
                          max={88}
                          unit="%"
                          onChange={(facecamOutputX) =>
                            onUpdateSettings({ facecamOutputX }, false)
                          }
                        />
                        <StudioSlider
                          id="facecam-out-y"
                          label="Facecam Vertical (Y)"
                          value={settings.facecamOutputY}
                          min={12}
                          max={88}
                          unit="%"
                          onChange={(facecamOutputY) =>
                            onUpdateSettings({ facecamOutputY }, false)
                          }
                        />
                        <StudioSlider
                          id="facecam-radius"
                          label="Facecam Corner Radius"
                          value={settings.facecamRounded}
                          min={0}
                          max={24}
                          unit="px"
                          onChange={(facecamRounded) =>
                            onUpdateSettings({ facecamRounded }, false)
                          }
                        />
                      </>
                    )}
                  </div>
                )}
              </InspectorAccordion>

              {/* 3. Main Video Aspect Inside Mobile Frame */}
              <InspectorAccordion
                title="Main Video Frame (Inside Mobile)"
                defaultOpen={
                  settings.mainVideoAspect !== '9:16' ||
                  settings.layout === 'pip' ||
                  settings.layout === 'centered'
                }
              >
                <div className="space-y-1.5">
                  <span className="block text-xs text-[var(--pc-sub)]">
                    Video Frame Ratio
                  </span>
                  <SegmentedControl<FrameAspectId>
                    ariaLabel="Main video aspect ratio inside mobile frame"
                    size="sm"
                    fullWidth
                    value={settings.mainVideoAspect}
                    options={FRAME_ASPECT_OPTIONS.map((a) => ({
                      value: a.value,
                      label: a.label,
                    }))}
                    onChange={(mainVideoAspect) =>
                      onUpdateSettings({ mainVideoAspect }, true)
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <span className="block text-xs text-[var(--pc-sub)]">Video Scale Fit</span>
                  <SegmentedControl<VideoFitId>
                    ariaLabel="Main video scale fit"
                    size="sm"
                    fullWidth
                    value={settings.mainVideoFit}
                    options={[
                      { value: 'cover', label: 'Fill / Crop' },
                      { value: 'contain', label: 'Fit / Full Frame' },
                    ]}
                    onChange={(mainVideoFit) => onUpdateSettings({ mainVideoFit }, true)}
                  />
                </div>

                {settings.mainVideoAspect !== '9:16' && (
                  <StudioSlider
                    id="main-video-offset-y"
                    label="Main Video Vertical Position"
                    value={settings.mainVideoOffsetY}
                    min={18}
                    max={82}
                    unit="%"
                    onChange={(mainVideoOffsetY) =>
                      onUpdateSettings({ mainVideoOffsetY }, false)
                    }
                  />
                )}
              </InspectorAccordion>

              {/* 4. YIZERGE Playback Speed Accordion */}
              <InspectorAccordion
                title="Playback Speed"
                badge={`${settings.playbackSpeed.toFixed(2)}x`}
                defaultOpen={false}
              >
                <div className="grid grid-cols-6 gap-1">
                  {PLAYBACK_SPEEDS.map((spd) => {
                    const active = Math.abs(settings.playbackSpeed - spd) < 0.01;
                    return (
                      <button
                        key={spd}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onUpdateSettings({ playbackSpeed: spd }, true)}
                        className={`h-7 rounded-md border font-mono-tabular text-[11px] cursor-pointer transition-colors ${
                          active
                            ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)] font-semibold'
                            : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                        }`}
                      >
                        {spd}x
                      </button>
                    );
                  })}
                </div>
                <StudioSlider
                  label="Fine Speed"
                  value={Math.round(settings.playbackSpeed * 100)}
                  min={50}
                  max={200}
                  step={5}
                  unit="%"
                  onChange={(pct) =>
                    onUpdateSettings({ playbackSpeed: Number((pct / 100).toFixed(2)) }, false)
                  }
                />
              </InspectorAccordion>

              {/* 5. YIZERGE Style Presets (Save / 1-Click Apply / Delete) */}
              <InspectorAccordion
                title="Style Presets"
                badge={stylePresets.length > 0 ? String(stylePresets.length) : undefined}
                defaultOpen={false}
              >
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    aria-label="New style preset name"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="Preset name (e.g. Clean Split)"
                    className="flex-1 h-8 px-2.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none focus:border-[var(--pc-accent)]"
                  />
                  <Button variant="secondary" size="sm" onClick={handleSaveStylePreset}>
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span>Save</span>
                  </Button>
                </div>

                {stylePresets.length === 0 ? (
                  <p className="text-[11px] text-[var(--pc-muted)] m-0">
                    Save your current radius, padding, canvas backdrop, layout, and speed as a reusable style preset.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {stylePresets.map((preset) => (
                      <div
                        key={preset.id}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)]"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onUpdateSettings(
                              {
                                layout: preset.layout,
                                aspect: preset.aspect,
                                canvas: preset.canvas,
                                cornerRadius: preset.cornerRadius,
                                framePadding: preset.framePadding,
                                outerFill: preset.outerFill,
                                outerFillActive: preset.outerFillActive,
                                outerGradient: preset.outerGradient,
                                playbackSpeed: preset.playbackSpeed,
                              },
                              true
                            );
                            onNotify?.(`Applied style preset "${preset.name}"`);
                          }}
                          className="flex-1 text-left bg-transparent border-0 p-0 cursor-pointer min-w-0"
                        >
                          <div className="text-xs font-medium text-[var(--pc-ink)] truncate">
                            {preset.name}
                          </div>
                          <div className="text-[10px] font-mono-tabular text-[var(--pc-muted)]">
                            {preset.layout} · {preset.cornerRadius}px · {preset.playbackSpeed.toFixed(2)}x
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteStylePreset(preset.id)}
                          aria-label={`Delete preset ${preset.name}`}
                          className="w-6 h-6 rounded grid place-items-center text-[var(--pc-muted)] hover:text-[var(--pc-error)] bg-transparent border-0 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </InspectorAccordion>

              {/* 6. YIZERGE Exact Numeric Crop Coordinates */}
              <InspectorAccordion title="Coordinates" defaultOpen={false}>
                {(() => {
                  const entries: {
                    id: SpeakerCropKey | 'facecam';
                    label: string;
                    dotColor: string;
                    box: FacecamSourceBox;
                  }[] =
                    settings.layout === 'trio'
                      ? [
                          {
                            id: 'primary',
                            label: 'Top-Left Speaker',
                            dotColor: '#10B981',
                            box: settings.speakerCrops.primary,
                          },
                          {
                            id: 'secondary',
                            label: 'Top-Right Speaker',
                            dotColor: '#38BDF8',
                            box: settings.speakerCrops.secondary,
                          },
                          {
                            id: 'tertiary',
                            label: 'Bottom Speaker',
                            dotColor: '#A3E635',
                            box: settings.speakerCrops.tertiary,
                          },
                        ]
                      : settings.layout === 'split' && !settings.facecamEnabled
                        ? [
                            {
                              id: 'primary',
                              label: 'Top Speaker',
                              dotColor: '#10B981',
                              box: settings.speakerCrops.primary,
                            },
                            {
                              id: 'secondary',
                              label: 'Bottom Speaker',
                              dotColor: '#A3E635',
                              box: settings.speakerCrops.secondary,
                            },
                          ]
                        : settings.facecamEnabled || settings.layout === 'pip'
                          ? [
                              {
                                id: 'facecam',
                                label: 'Streamer Facecam',
                                dotColor: '#53FC18',
                                box: settings.facecamSourceBox,
                              },
                            ]
                          : [
                              {
                                id: 'primary',
                                label: 'Main Speaker',
                                dotColor: '#10B981',
                                box: settings.speakerCrops.primary,
                              },
                            ];

                  return (
                    <div className="space-y-3">
                      {entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-2.5 space-y-2"
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--pc-ink)]">
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: entry.dotColor }}
                              />
                              <span>{entry.label}</span>
                            </span>
                            <span className="font-mono-tabular text-[10px] text-[var(--pc-muted)]">
                              {Math.round((entry.box.width / 100) * 1920)}×
                              {Math.round((entry.box.height / 100) * 1080)}px
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {(
                              [
                                { k: 'x' as const, l: 'X%' },
                                { k: 'y' as const, l: 'Y%' },
                                { k: 'width' as const, l: 'W%' },
                                { k: 'height' as const, l: 'H%' },
                              ]
                            ).map((field) => (
                              <label key={field.k} className="space-y-0.5">
                                <span className="block text-[9.5px] font-mono-tabular text-[var(--pc-muted)]">
                                  {field.l}
                                </span>
                                <input
                                  type="number"
                                  min={field.k === 'x' || field.k === 'y' ? 0 : 12}
                                  max={100}
                                  aria-label={`${entry.label} ${field.l}`}
                                  value={entry.box[field.k]}
                                  onChange={(e) =>
                                    updateCoordinateField(entry.id, field.k, e.target.value)
                                  }
                                  className="w-full h-7 px-1.5 rounded bg-[var(--pc-surface)] border border-[var(--pc-border)] font-mono-tabular text-[11px] text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          onUpdateSettings(
                            {
                              speakerCrops: {
                                primary: { ...DEFAULT_SPEAKER_CROPS.primary },
                                secondary: { ...DEFAULT_SPEAKER_CROPS.secondary },
                                tertiary: { ...DEFAULT_SPEAKER_CROPS.tertiary },
                              },
                              facecamSourceBox: { ...DEFAULT_FACECAM_SOURCE_BOX },
                            },
                            true
                          );
                          onNotify?.('Reset crop box coordinates to defaults');
                        }}
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset Crop Boxes</span>
                      </Button>
                    </div>
                  );
                })()}
              </InspectorAccordion>
            </>
          )}

          {/* ===================== TAB 2: TEMPLATES & WATERMARKS ===================== */}
          {activeTab === 'templates' && (
            <>
              <InspectorAccordion title="Viral Templates (2026)" defaultOpen>
                <StudioSwitch
                  label="Enable Template Overlay"
                  checked={settings.templateEnabled}
                  onChange={(templateEnabled) => onUpdateSettings({ templateEnabled }, true)}
                />

                <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-3 flex items-center gap-3">
                  <TemplateMiniPreview preset={activePreset} active />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[var(--pc-ink)] truncate">
                      {activePreset.fullName}
                    </div>
                    <div className="text-[11px] text-[var(--pc-muted)] line-clamp-2 mt-0.5 leading-snug">
                      {activePreset.description}
                    </div>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={onOpenTemplateLibrary}
                >
                  Browse All Viral Formats (12)
                </Button>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  {FEATURED_PRESETS.map((preset) => {
                    const active = settings.template === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onSelectTemplatePreset(preset)}
                        className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-colors cursor-pointer ${
                          active
                            ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)]'
                            : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] hover:border-[var(--pc-muted)]'
                        }`}
                      >
                        <TemplateMiniPreview preset={preset} active={active} />
                        <span className="text-[11.5px] font-medium text-[var(--pc-ink)] truncate">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </InspectorAccordion>

              {/* Streamer Attribution (`[Logo] USERNAME`) — Kick, Insta, YT Shorts */}
              <InspectorAccordion title="Streamer Credit ([Logo] Name)" defaultOpen>
                <StudioSwitch
                  label="Show Streamer Attribution"
                  description="Small platform logo + username (auto-detected or custom)"
                  checked={settings.showStreamerBadge}
                  onChange={(showStreamerBadge) => onUpdateSettings({ showStreamerBadge }, true)}
                />

                {settings.showStreamerBadge && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <label htmlFor="streamer-handle-input" className="text-[var(--pc-sub)]">
                          Streamer Username
                        </label>
                        {clip.streamerHandle && (
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateSettings({ streamerHandle: clip.streamerHandle || '' }, true)
                            }
                            className="text-[10.5px] text-[var(--pc-accent)] hover:underline bg-transparent border-0 p-0 cursor-pointer"
                          >
                            Use detected ({clip.streamerHandle})
                          </button>
                        )}
                      </div>
                      <input
                        id="streamer-handle-input"
                        type="text"
                        value={settings.streamerHandle}
                        onChange={(e) => onUpdateSettings({ streamerHandle: e.target.value }, false)}
                        placeholder="streamer_name"
                        className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                      />
                    </div>

                    <StudioSelect<StreamerPlatformId>
                      label="Platform Logo"
                      value={settings.streamerPlatform}
                      options={STREAMER_PLATFORM_OPTIONS}
                      onChange={(streamerPlatform) => onUpdateSettings({ streamerPlatform }, true)}
                    />

                    <StudioSwitch
                      label="Uppercase Username"
                      checked={settings.streamerBadgeUppercase}
                      onChange={(streamerBadgeUppercase) =>
                        onUpdateSettings({ streamerBadgeUppercase }, true)
                      }
                    />

                    <div className="space-y-2 pt-1">
                      <span className="block text-[11px] text-[var(--pc-muted)]">
                        Quick Position (or drag on canvas)
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { label: 'Bottom Ctr', x: 50, y: 84 },
                          { label: 'Bottom Left', x: 24, y: 84 },
                          { label: 'Top Left', x: 24, y: 12 },
                        ].map((pos) => (
                          <button
                            key={pos.label}
                            type="button"
                            onClick={() =>
                              onUpdateSettings(
                                { streamerBadgeX: pos.x, streamerBadgeY: pos.y },
                                true
                              )
                            }
                            className="h-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[10.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:border-[var(--pc-muted)] cursor-pointer transition-colors"
                          >
                            {pos.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <StudioSlider
                      label="Horizontal Position (X)"
                      value={settings.streamerBadgeX}
                      min={10}
                      max={90}
                      unit="%"
                      onChange={(streamerBadgeX) => onUpdateSettings({ streamerBadgeX }, false)}
                    />
                    <StudioSlider
                      label="Vertical Position (Y)"
                      value={settings.streamerBadgeY}
                      min={8}
                      max={94}
                      unit="%"
                      onChange={(streamerBadgeY) => onUpdateSettings({ streamerBadgeY }, false)}
                    />
                    <StudioSlider
                      label="Logo & Text Scale"
                      value={settings.streamerBadgeScale}
                      min={70}
                      max={160}
                      step={5}
                      unit="%"
                      onChange={(streamerBadgeScale) =>
                        onUpdateSettings({ streamerBadgeScale }, false)
                      }
                    />

                    {isKickTemplate && (
                      <div className="pt-2 border-t border-[var(--pc-border)] space-y-3">
                        <StudioSwitch
                          label="Kick Verified Check"
                          checked={settings.kickVerifiedBadge}
                          onChange={(kickVerifiedBadge) =>
                            onUpdateSettings({ kickVerifiedBadge }, true)
                          }
                        />
                        <div className="space-y-1.5">
                          <span className="block text-xs text-[var(--pc-sub)]">Status Tag</span>
                          <SegmentedControl<KickBadgeMode>
                            ariaLabel="Kick status badge"
                            size="sm"
                            fullWidth
                            value={settings.kickStatusPill}
                            options={[
                              { value: 'none', label: 'Clean' },
                              { value: 'CLIP', label: 'CLIP' },
                              { value: 'LIVE', label: 'LIVE' },
                            ]}
                            onChange={(kickStatusPill) =>
                              onUpdateSettings({ kickStatusPill }, true)
                            }
                          />
                        </div>
                        <StudioSwitch
                          label="Optional Neon Frame Border"
                          description="Subtle #53FC18 outer border"
                          checked={settings.kickNeonGlow}
                          onChange={(kickNeonGlow) => onUpdateSettings({ kickNeonGlow }, true)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </InspectorAccordion>

              {/* Editable Creator Page Watermark (`@DUMMNEWS` / `@signalcraft`) */}
              <InspectorAccordion title="Page Watermark (@Handle)" defaultOpen>
                <StudioSwitch
                  label="Show Creator Watermark"
                  description="Clipper / channel watermark (drag on canvas)"
                  checked={brandKit.showWatermark}
                  onChange={(showWatermark) => onUpdateBrandKit({ ...brandKit, showWatermark })}
                />

                {brandKit.showWatermark && (
                  <div className="space-y-3 pt-1">
                    <div className="space-y-1.5">
                      <label htmlFor="watermark-handle-input" className="block text-xs text-[var(--pc-sub)]">
                        Watermark Handle
                      </label>
                      <input
                        id="watermark-handle-input"
                        type="text"
                        value={brandKit.handle}
                        onChange={(e) => onUpdateBrandKit({ ...brandKit, handle: e.target.value })}
                        placeholder="@yourhandle"
                        className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      {WATERMARK_POSITIONS.slice(0, 3).map((pos) => (
                        <button
                          key={pos.value}
                          type="button"
                          onClick={() => {
                            onUpdateSettings({ watermarkX: pos.x, watermarkY: pos.y }, true);
                            onUpdateBrandKit({ ...brandKit, watermarkPosition: pos.value });
                          }}
                          className="h-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[10.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:border-[var(--pc-muted)] cursor-pointer transition-colors"
                        >
                          {pos.label.replace('Bottom-', 'Bot ').replace('Bottom ', 'Bot ')}
                        </button>
                      ))}
                    </div>

                    <StudioSlider
                      label="Watermark X Position"
                      value={settings.watermarkX}
                      min={10}
                      max={90}
                      unit="%"
                      onChange={(watermarkX) => onUpdateSettings({ watermarkX }, false)}
                    />
                    <StudioSlider
                      label="Watermark Y Position"
                      value={settings.watermarkY}
                      min={8}
                      max={94}
                      unit="%"
                      onChange={(watermarkY) => onUpdateSettings({ watermarkY }, false)}
                    />
                    <StudioSlider
                      label="Watermark Size"
                      value={settings.watermarkSize}
                      min={10}
                      max={28}
                      unit="px"
                      onChange={(watermarkSize) => onUpdateSettings({ watermarkSize }, false)}
                    />
                    <StudioSlider
                      label="Watermark Opacity"
                      value={brandKit.watermarkOpacity}
                      min={20}
                      max={100}
                      unit="%"
                      onChange={(watermarkOpacity) =>
                        onUpdateBrandKit({ ...brandKit, watermarkOpacity })
                      }
                    />
                    <StudioSwitch
                      label="Crisp Black Outline"
                      description="Readable over bright shirts & footage"
                      checked={settings.watermarkOutline}
                      onChange={(watermarkOutline) =>
                        onUpdateSettings({ watermarkOutline }, true)
                      }
                    />
                  </div>
                )}
              </InspectorAccordion>

              {activePreset.hasCard && (
                <InspectorAccordion title="X / Reddit Header Card" defaultOpen={false}>
                  <div className="space-y-1.5">
                    <span className="block text-xs text-[var(--pc-sub)]">Card Theme</span>
                    <SegmentedControl<CardThemeId>
                      ariaLabel="Social card theme"
                      size="sm"
                      fullWidth
                      value={settings.cardTheme}
                      options={[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                      ]}
                      onChange={(cardTheme) => onUpdateSettings({ cardTheme }, true)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="pinned-statement-input"
                      className="block text-xs text-[var(--pc-sub)]"
                    >
                      Post Body Text
                    </label>
                    <textarea
                      id="pinned-statement-input"
                      rows={2}
                      value={settings.pinnedStatement}
                      onChange={(e) => onUpdateSettings({ pinnedStatement: e.target.value }, false)}
                      placeholder="Write the X post or Reddit title..."
                      className="w-full p-2.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none focus:border-[var(--pc-accent)] resize-none"
                    />
                  </div>
                </InspectorAccordion>
              )}
            </>
          )}

          {/* ===================== TAB 3: TEXT & CAPTIONS ===================== */}
          {activeTab === 'text' && (
            <>
              <div className="p-3.5 border-b border-[var(--pc-border)]">
                <SegmentedControl<TextSubtabId>
                  ariaLabel="Text editing mode"
                  size="sm"
                  fullWidth
                  value={textSubtab}
                  options={[
                    { value: 'headline', label: 'Hook Caption' },
                    { value: 'subs', label: 'Subtitles & Cues' },
                  ]}
                  onChange={onChangeTextSubtab}
                />
              </div>

              {textSubtab === 'headline' ? (
                <>
                  <InspectorAccordion title="Top Hook Caption" defaultOpen>
                    <div className="space-y-1.5">
                      <label htmlFor="headline-input" className="block text-xs text-[var(--pc-sub)]">
                        Hook Text
                      </label>
                      <textarea
                        id="headline-input"
                        rows={3}
                        value={settings.headline}
                        onChange={(e) => onUpdateSettings({ headline: e.target.value }, false)}
                        placeholder="No way he pulled this off..."
                        className="w-full p-2.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none focus:border-[var(--pc-accent)] resize-none"
                      />
                    </div>

                    <StudioSelect<HeadlineLayoutStyleId>
                      label="Hook Layout Style"
                      value={settings.headlineLayout}
                      options={HEADLINE_LAYOUT_OPTIONS}
                      onChange={(headlineLayout) => onUpdateSettings({ headlineLayout }, true)}
                    />

                    <ViralFontSelect
                      label="Hook Font (Independent)"
                      value={settings.font}
                      customFonts={customFonts}
                      onChange={(font) => onUpdateSettings({ font }, true)}
                      onUploadCustomFont={onUploadCustomFont}
                    />

                    <StudioSlider
                      label="Hook Size"
                      value={settings.headlineSize}
                      min={16}
                      max={48}
                      unit="px"
                      onChange={(headlineSize) => onUpdateSettings({ headlineSize }, false)}
                    />

                    <div className="space-y-1.5">
                      <span className="block text-xs text-[var(--pc-sub)]">Casing</span>
                      <SegmentedControl<TextCasingId>
                        ariaLabel="Hook text casing"
                        size="sm"
                        fullWidth
                        value={settings.headlineCasing}
                        options={[
                          { value: 'asis', label: 'As-is' },
                          { value: 'upper', label: 'UPPER' },
                          { value: 'title', label: 'Title' },
                        ]}
                        onChange={(headlineCasing) => onUpdateSettings({ headlineCasing }, true)}
                      />
                    </div>
                  </InspectorAccordion>

                  <InspectorAccordion title="Hook Position & Alignment" defaultOpen>
                    <div className="space-y-1.5">
                      <span className="block text-xs text-[var(--pc-sub)]">Text Alignment</span>
                      <SegmentedControl<TextAlignId>
                        ariaLabel="Hook text alignment"
                        size="sm"
                        fullWidth
                        value={settings.headlineAlign}
                        options={ALIGN_OPTIONS}
                        onChange={(headlineAlign) => onUpdateSettings({ headlineAlign }, true)}
                      />
                    </div>

                    <StudioSlider
                      label="Position X"
                      value={settings.headlineX}
                      min={10}
                      max={90}
                      unit="%"
                      onChange={(headlineX) => onUpdateSettings({ headlineX }, false)}
                    />
                    <StudioSlider
                      label="Position Y"
                      value={settings.headlineY}
                      min={8}
                      max={85}
                      unit="%"
                      onChange={(headlineY) => onUpdateSettings({ headlineY }, false)}
                    />
                    <StudioSlider
                      label="Max Line Width"
                      value={settings.headlineMaxWidth}
                      min={50}
                      max={96}
                      unit="%"
                      onChange={(headlineMaxWidth) =>
                        onUpdateSettings({ headlineMaxWidth }, false)
                      }
                    />

                    {settings.headlineLayout === 'solid-banner' && (
                      <StudioSlider
                        label="Banner Opacity"
                        value={settings.bannerOpacity}
                        min={0}
                        max={100}
                        unit="%"
                        onChange={(bannerOpacity) => onUpdateSettings({ bannerOpacity }, false)}
                      />
                    )}
                  </InspectorAccordion>
                </>
              ) : (
                <>
                  {/* YIZERGE .srt / .vtt Subtitle Importer */}
                  <InspectorAccordion
                    title="Import Subtitles (.srt / .vtt)"
                    badge={`${clip.words.length} cues`}
                    defaultOpen
                  >
                    <input
                      ref={srtInputRef}
                      type="file"
                      accept=".srt,.vtt,text/plain"
                      data-testid="srt-file-input"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          onImportSrt(file);
                          e.target.value = '';
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={() => srtInputRef.current?.click()}
                    >
                      <FileText className="w-3.5 h-3.5 stroke-[1.75]" />
                      <span>Import .srt or .vtt Subtitles</span>
                    </Button>
                    <p className="text-[11px] text-[var(--pc-muted)] m-0 leading-relaxed">
                      Loads timestamped subtitle cues directly onto the CC timeline track and Live Preview.
                    </p>
                  </InspectorAccordion>

                  {/* 7 One-Click Viral Short-Form Caption Style Preset Cards */}
                  <InspectorAccordion title="Viral Caption Presets" defaultOpen>
                    <ViralCaptionPresetCards
                      activeId={settings.captionStyle}
                      onSelect={onSelectCaptionPreset}
                    />
                  </InspectorAccordion>

                  {/* Caption Layout, Size & Free Positioning */}
                  <InspectorAccordion title="Caption Layout, Size & Position" defaultOpen>
                    <StudioSelect<SubtitleBgStyleId>
                      label="Caption Background Layout"
                      value={settings.subtitleBgStyle}
                      options={SUBTITLE_BG_OPTIONS}
                      onChange={(subtitleBgStyle) => onUpdateSettings({ subtitleBgStyle }, true)}
                    />

                    <StudioSlider
                      label="Caption Size"
                      value={settings.subtitleSize}
                      min={16}
                      max={52}
                      unit="px"
                      onChange={(subtitleSize) => onUpdateSettings({ subtitleSize }, false)}
                    />

                    <div className="space-y-1.5">
                      <span className="block text-xs text-[var(--pc-sub)]">Text Alignment</span>
                      <SegmentedControl<TextAlignId>
                        ariaLabel="Subtitle text alignment"
                        size="sm"
                        fullWidth
                        value={settings.subtitleAlign}
                        options={ALIGN_OPTIONS}
                        onChange={(subtitleAlign) => onUpdateSettings({ subtitleAlign }, true)}
                      />
                    </div>

                    <StudioSlider
                      label="Horizontal Position (X)"
                      value={settings.subtitleX}
                      min={10}
                      max={90}
                      unit="%"
                      onChange={(subtitleX) => onUpdateSettings({ subtitleX }, false)}
                    />

                    <StudioSlider
                      label="Vertical Position (Y)"
                      value={settings.subtitleVerticalPos}
                      min={15}
                      max={90}
                      unit="%"
                      onChange={(subtitleVerticalPos) =>
                        onUpdateSettings({ subtitleVerticalPos }, false)
                      }
                    />

                    <StudioSlider
                      label="Max Caption Width"
                      value={settings.subtitleMaxWidth}
                      min={50}
                      max={96}
                      unit="%"
                      onChange={(subtitleMaxWidth) =>
                        onUpdateSettings({ subtitleMaxWidth }, false)
                      }
                    />

                    <StudioSlider
                      label="Line Spacing"
                      value={Math.round(settings.subtitleLineHeight * 100)}
                      min={95}
                      max={155}
                      step={5}
                      unit="%"
                      onChange={(pct) =>
                        onUpdateSettings({ subtitleLineHeight: Number((pct / 100).toFixed(2)) }, false)
                      }
                    />

                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      onClick={onAutoAlignSubtitles}
                    >
                      <AlignVerticalSpaceAround className="w-3.5 h-3.5 stroke-[1.75]" />
                      <span>Auto-Align ({activeSafeZone.shortLabel} Safe Zone)</span>
                    </Button>
                  </InspectorAccordion>

                  {/* Independent Subtitle Font + Word Pacing */}
                  <InspectorAccordion title="Typography & Word Pacing" defaultOpen>
                    <ViralFontSelect
                      label="Subtitle Font (Independent)"
                      value={settings.subtitleFont}
                      customFonts={customFonts}
                      onChange={(subtitleFont) => onUpdateSettings({ subtitleFont }, true)}
                      onUploadCustomFont={onUploadCustomFont}
                    />

                    <div className="space-y-1.5">
                      <span className="block text-xs text-[var(--pc-sub)]">Words per Screen</span>
                      <SegmentedControl<WordPacingId>
                        ariaLabel="Words per screen pacing"
                        size="sm"
                        fullWidth
                        value={settings.subtitleWordsPerScreen}
                        options={WORD_PACING_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
                        onChange={(subtitleWordsPerScreen) =>
                          onUpdateSettings({ subtitleWordsPerScreen }, true)
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-xs text-[var(--pc-sub)]">Caption Casing</span>
                      <SegmentedControl<TextCasingId>
                        ariaLabel="Subtitle text casing"
                        size="sm"
                        fullWidth
                        value={settings.subtitleCasing}
                        options={[
                          { value: 'asis', label: 'As-is' },
                          { value: 'upper', label: 'UPPER' },
                          { value: 'title', label: 'Title' },
                        ]}
                        onChange={(subtitleCasing) => onUpdateSettings({ subtitleCasing }, true)}
                      />
                    </div>
                  </InspectorAccordion>

                  {/* Color, Outline Stroke, Shadow/Glow & Motion */}
                  <InspectorAccordion title="Colors, Stroke & Motion" defaultOpen={false}>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { label: 'Base', key: 'subtitleBaseColor' as const },
                          { label: 'Active', key: 'subtitleActiveColor' as const },
                          { label: 'Emphasis', key: 'subtitleEmphasisColor' as const },
                        ]
                      ).map((item) => (
                        <label
                          key={item.key}
                          className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-2 flex flex-col gap-1.5 cursor-pointer"
                        >
                          <span className="text-[10.5px] text-[var(--pc-sub)]">{item.label}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={settings[item.key]}
                              onChange={(e) =>
                                onUpdateSettings({ [item.key]: e.target.value }, false)
                              }
                              className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer p-0"
                            />
                            <span className="font-mono-tabular text-[10px] text-[var(--pc-muted)] uppercase">
                              {settings[item.key]}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <StudioSlider
                          label="Outline Stroke"
                          value={settings.subtitleStrokeWidth}
                          min={0}
                          max={8}
                          unit="px"
                          onChange={(subtitleStrokeWidth) =>
                            onUpdateSettings({ subtitleStrokeWidth }, false)
                          }
                        />
                      </div>
                      <label
                        title="Outline Stroke Color"
                        className="h-7 px-2 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)] inline-flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <input
                          type="color"
                          value={settings.subtitleStrokeColor}
                          onChange={(e) =>
                            onUpdateSettings({ subtitleStrokeColor: e.target.value }, false)
                          }
                          className="w-4 h-4 rounded border-0 bg-transparent p-0 cursor-pointer"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <StudioSwitch
                        label="Drop Shadow"
                        checked={settings.subtitleDropShadow}
                        onChange={(subtitleDropShadow) =>
                          onUpdateSettings({ subtitleDropShadow }, true)
                        }
                      />
                      <StudioSwitch
                        label="Neon Glow"
                        checked={settings.subtitleNeonGlow}
                        onChange={(subtitleNeonGlow) =>
                          onUpdateSettings({ subtitleNeonGlow }, true)
                        }
                      />
                    </div>

                    <StudioSelect<CaptionAnimationId>
                      label="Animation Style"
                      value={settings.subtitleAnimation}
                      options={CAPTION_ANIMATION_OPTIONS}
                      onChange={(subtitleAnimation) =>
                        onUpdateSettings({ subtitleAnimation }, true)
                      }
                    />
                  </InspectorAccordion>

                  {/* Per-Word Emphasis & Inline Timed Cues */}
                  <InspectorAccordion title="Per-Word Emphasis & Cues" defaultOpen={false}>
                    <p className="text-[11px] text-[var(--pc-muted)] m-0 leading-relaxed">
                      Click any word chip to apply a custom emphasis color without changing timestamps.
                    </p>

                    {selectedEmphasisToken && (
                      <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-accent)]/50 p-2.5 space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--pc-ink)]">
                            <Sparkles className="w-3 h-3 text-[var(--pc-accent)]" />
                            <span>Word: “{selectedEmphasisToken.word}”</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              onSetWordEmphasis(
                                selectedEmphasisToken.cueIndex,
                                selectedEmphasisToken.tokenIndex,
                                null
                              );
                              setSelectedEmphasisToken(null);
                            }}
                            className="text-[10.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
                          >
                            Reset
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {EMPHASIS_QUICK_SWATCHES.map((swatch) => (
                            <button
                              key={swatch.hex}
                              type="button"
                              title={`Highlight "${selectedEmphasisToken.word}" in ${swatch.label}`}
                              onClick={() => {
                                onSetWordEmphasis(
                                  selectedEmphasisToken.cueIndex,
                                  selectedEmphasisToken.tokenIndex,
                                  swatch.hex
                                );
                              }}
                              className="w-6 h-6 rounded-md border border-white/20 cursor-pointer hover:scale-110 transition-transform"
                              style={{ backgroundColor: swatch.hex }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2.5 max-h-60 overflow-y-auto studio-scroll pr-1">
                      {clip.words.length === 0 ? (
                        <div className="text-xs text-[var(--pc-muted)]">
                          No transcript cues available for this clip.
                        </div>
                      ) : (
                        clip.words.map((cue, cueIndex) => {
                          const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
                          return (
                            <div
                              key={`${cue.start_ms}-${cueIndex}`}
                              className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-2 space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono-tabular text-[var(--pc-muted)]">
                                  {(cue.start_ms / 1000).toFixed(1)}s – {(cue.end_ms / 1000).toFixed(1)}s
                                </span>
                                <span className="text-[10px] font-mono-tabular text-[var(--pc-muted)]">
                                  {tokens.length} words
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {tokens.map((tok, tokenIndex) => {
                                  const customColor = cue.wordEmphasis?.[tokenIndex];
                                  const isSelected =
                                    selectedEmphasisToken?.cueIndex === cueIndex &&
                                    selectedEmphasisToken?.tokenIndex === tokenIndex;
                                  return (
                                    <button
                                      key={`${cueIndex}-${tokenIndex}`}
                                      type="button"
                                      onClick={() =>
                                        setSelectedEmphasisToken({
                                          cueIndex,
                                          tokenIndex,
                                          word: tok,
                                        })
                                      }
                                      className={`px-1.5 py-0.5 rounded text-[11px] font-medium border cursor-pointer transition-colors ${
                                        isSelected
                                          ? 'border-[var(--pc-accent)] bg-[var(--pc-accent-soft)]'
                                          : 'border-[var(--pc-border)] bg-[var(--pc-surface)] hover:border-[var(--pc-muted)]'
                                      }`}
                                      style={{ color: customColor || 'var(--pc-ink)' }}
                                    >
                                      {tok}
                                    </button>
                                  );
                                })}
                              </div>
                              <input
                                type="text"
                                aria-label={`Edit subtitle cue ${cueIndex + 1}`}
                                value={cue.text}
                                onChange={(e) => onUpdateCueWord(cueIndex, e.target.value)}
                                className="w-full h-7 px-2 rounded-md bg-[var(--pc-bg)] border border-[var(--pc-border-subtle)] text-[11.5px] text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  </InspectorAccordion>
                </>
              )}
            </>
          )}

          {/* ===================== TAB 4: MEDIA & SCORE ===================== */}
          {activeTab === 'media' && (
            <>
              <InspectorAccordion title="Score & Audio Peak Riser" defaultOpen>
                <div className="space-y-1.5">
                  <span className="block text-xs text-[var(--pc-sub)]">Background Audio Bed (A2)</span>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    data-testid="audio-file-input"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (settings.customAudioUrl?.startsWith('blob:')) {
                          URL.revokeObjectURL(settings.customAudioUrl);
                        }
                        onUpdateSettings(
                          {
                            customAudioName: file.name,
                            customAudioUrl: URL.createObjectURL(file),
                          },
                          true
                        );
                        onNotify?.(`Loaded audio track "${file.name}" onto A2`);
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => audioInputRef.current?.click()}
                    >
                      <Upload className="w-3.5 h-3.5 stroke-[1.75]" />
                      <span className="truncate">
                        {settings.customAudioName || 'Upload Audio Track'}
                      </span>
                    </Button>
                    {settings.customAudioName && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (settings.customAudioUrl?.startsWith('blob:')) {
                            URL.revokeObjectURL(settings.customAudioUrl);
                          }
                          onUpdateSettings({ customAudioName: '', customAudioUrl: '' }, true);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>

                <StudioSlider
                  label="Base Volume"
                  value={settings.audioBaseVol}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(audioBaseVol) => onUpdateSettings({ audioBaseVol }, false)}
                />

                <StudioSwitch
                  label="Audio Peak Riser"
                  description="Smoothly ramps score volume toward highlight climax"
                  checked={settings.audioPeak}
                  onChange={(audioPeak) => onUpdateSettings({ audioPeak }, true)}
                />

                {settings.audioPeak && (
                  <>
                    <StudioSlider
                      label="Peak Volume"
                      value={settings.audioPeakVol}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(audioPeakVol) => onUpdateSettings({ audioPeakVol }, false)}
                    />
                    <StudioSlider
                      label="Riser Duration"
                      value={settings.riserDurationSec}
                      min={1}
                      max={15}
                      unit="s"
                      onChange={(riserDurationSec) =>
                        onUpdateSettings({ riserDurationSec }, false)
                      }
                    />
                  </>
                )}
              </InspectorAccordion>

              <InspectorAccordion title="Outro Card" defaultOpen>
                <div className="space-y-1.5">
                  <label htmlFor="outro-text-input" className="block text-xs text-[var(--pc-sub)]">
                    Call-to-Action Line
                  </label>
                  <input
                    id="outro-text-input"
                    type="text"
                    value={settings.outroText}
                    onChange={(e) => onUpdateSettings({ outroText: e.target.value }, false)}
                    placeholder="Follow for full episodes"
                    className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                  />
                </div>

                <StudioSlider
                  label="Outro Hold Duration"
                  value={settings.outroDurationSec}
                  min={1}
                  max={6}
                  unit="s"
                  onChange={(outroDurationSec) => onUpdateSettings({ outroDurationSec }, false)}
                />
              </InspectorAccordion>
            </>
          )}
        </div>
      )}

      {/* YIZERGE Pinned Bottom Live Preview Toggle Bar (single Export CTA remains in 48px Studio Bar) */}
      {clip && (
        <div className="p-3 border-t border-[var(--pc-border)] bg-[var(--pc-surface)] shrink-0">
          <button
            type="button"
            data-testid="inspector-live-preview-btn"
            onClick={onToggleStageMode}
            className={`w-full h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-2 cursor-pointer transition-colors ${
              stageMode === 'editor'
                ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-ink)] hover:border-[var(--pc-muted)]'
            }`}
          >
            {stageMode === 'framing' ? (
              <>
                <Eye className="w-3.5 h-3.5 stroke-[1.75]" />
                <span>Live {settings.aspect} Preview (Ctrl+L)</span>
              </>
            ) : (
              <>
                <Frame className="w-3.5 h-3.5 stroke-[1.75]" />
                <span>Back to Framing Canvas (Ctrl+L)</span>
              </>
            )}
          </button>
        </div>
      )}
    </aside>
  );
}
