import React, { useEffect, useState } from 'react';
import { Copy, Maximize2, Sliders, X } from 'lucide-react';
import type {
  AspectRatioId,
  CustomFontEntry,
  EditorSettings,
  FramingBlueprint,
  HeadlineLayoutStyleId,
  LayoutModeId,
  ResolvedSafeZonePlatformId,
  StreamerPlatformId,
  SubtitleBgStyleId,
} from '../../types';
import type { TemplateCategory } from '../../presets';
import { getViralCaptionPreset, VIRAL_FONTS } from '../../captionStyles';
import {
  createBlankTemplateDraft,
  type EditableCaptionPreset,
  type EditableTemplatePreset,
} from '../../lib/creatorCatalog';
import {
  Button,
  SegmentedControl,
  StudioSlider,
  StudioSwitch,
} from '../ui/Primitives';

interface TemplateEditorModalProps {
  open: boolean;
  initialTemplate: EditableTemplatePreset | null;
  captionPresets: readonly EditableCaptionPreset[];
  customFonts: readonly CustomFontEntry[];
  currentSettings: EditorSettings;
  currentBlueprint: FramingBlueprint;
  onSave: (template: EditableTemplatePreset) => void;
  onClose: () => void;
}

const ASPECT_OPTIONS: { value: AspectRatioId; label: string; ratio: string }[] = [
  { value: '9:16', label: '9:16', ratio: '9 / 16' },
  { value: '4:5', label: '4:5', ratio: '4 / 5' },
  { value: '1:1', label: '1:1', ratio: '1 / 1' },
  { value: '16:9', label: '16:9', ratio: '16 / 9' },
  { value: '4:3', label: '4:3', ratio: '4 / 3' },
];

const LAYOUT_OPTIONS: { value: LayoutModeId; label: string }[] = [
  { value: 'solo', label: 'Solo' },
  { value: 'split', label: 'Split' },
  { value: 'trio', label: 'Trio' },
  { value: 'pip', label: 'PiP' },
  { value: 'centered', label: 'Centered' },
  { value: 'widescreen', label: '16:9' },
];

const CATEGORY_OPTIONS: Exclude<TemplateCategory, 'All'>[] = [
  'Viral Hooks',
  'Platforms',
  'Streamer Clips',
  'Podcasts & X',
];

const ACCENT_SWATCHES = ['#FFE600', '#53FC18', '#FF0033', '#38BDF8', '#A855F7', '#F97316', '#FFFFFF'];

export function TemplateEditorModal({
  open,
  initialTemplate,
  captionPresets,
  customFonts,
  currentSettings,
  currentBlueprint,
  onSave,
  onClose,
}: TemplateEditorModalProps) {
  const [draft, setDraft] = useState<EditableTemplatePreset>(() =>
    initialTemplate ? { ...initialTemplate } : createBlankTemplateDraft()
  );

  useEffect(() => {
    if (!open) return;
    if (initialTemplate) {
      setDraft({
        ...initialTemplate,
        defaultAspect: initialTemplate.defaultAspect || '9:16',
        defaultFullScreen: initialTemplate.defaultFullScreen ?? false,
        defaultHeadlineY: initialTemplate.defaultHeadlineY ?? 18,
        defaultSubtitleY: initialTemplate.defaultSubtitleY ?? 68,
        defaultHeadlineSize: initialTemplate.defaultHeadlineSize ?? 22,
        defaultSubtitleSize: initialTemplate.defaultSubtitleSize ?? 26,
      });
    } else {
      const hasFullScreen = Object.values(currentBlueprint.fullFrameSlots || {}).some(Boolean);
      setDraft(
        createBlankTemplateDraft({
          name: 'Custom Short Template',
          fullName: 'Custom Short Template',
          defaultAspect: currentBlueprint.aspect,
          defaultLayout: currentBlueprint.layout,
          defaultFullScreen: hasFullScreen,
          defaultCaptionStyle: currentSettings.captionStyle,
          defaultHeadlineLayout: currentSettings.headlineLayout,
          defaultHeadlineFont: currentSettings.font,
          defaultSubtitleFont: currentSettings.subtitleFont,
          defaultSubtitleBg: currentSettings.subtitleBgStyle,
          defaultStreamerPlatform: currentSettings.streamerPlatform,
          defaultHeadlineY: currentSettings.headlineY,
          defaultSubtitleY: currentSettings.subtitleVerticalPos,
          defaultHeadlineSize: currentSettings.headlineSize,
          defaultSubtitleSize: currentSettings.subtitleSize,
          defaultOuterFill: currentSettings.outerFill,
        })
      );
    }
  }, [open, initialTemplate, currentBlueprint, currentSettings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isEditing = Boolean(initialTemplate);
  const allFontFamilies = [
    ...VIRAL_FONTS.map((f) => f.family),
    ...customFonts.map((f) => f.family),
  ];

  const aspectSpec =
    ASPECT_OPTIONS.find((a) => a.value === (draft.defaultAspect || '9:16')) || ASPECT_OPTIONS[0];
  const captionPreview = getViralCaptionPreset(draft.defaultCaptionStyle, captionPresets);

  const patch = (updates: Partial<EditableTemplatePreset>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
  };

  const handleLoadFromStudio = () => {
    const hasFullScreen = Object.values(currentBlueprint.fullFrameSlots || {}).some(Boolean);
    patch({
      defaultAspect: currentBlueprint.aspect,
      defaultLayout: currentBlueprint.layout,
      defaultFullScreen: hasFullScreen,
      defaultCaptionStyle: currentSettings.captionStyle,
      defaultHeadlineLayout: currentSettings.headlineLayout,
      defaultHeadlineFont: currentSettings.font,
      defaultSubtitleFont: currentSettings.subtitleFont,
      defaultSubtitleBg: currentSettings.subtitleBgStyle,
      defaultStreamerPlatform: currentSettings.streamerPlatform,
      defaultHeadlineY: currentSettings.headlineY,
      defaultSubtitleY: currentSettings.subtitleVerticalPos,
      defaultHeadlineSize: currentSettings.headlineSize,
      defaultSubtitleSize: currentSettings.subtitleSize,
      defaultOuterFill: currentSettings.outerFill,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = draft.name.trim() || 'Untitled Template';
    onSave({
      ...draft,
      name: cleanName,
      fullName: draft.fullName.trim() || cleanName,
      description:
        draft.description.trim() ||
        `${draft.defaultAspect || '9:16'} ${draft.defaultFullScreen ? 'Full Screen' : draft.defaultLayout} · Captions @ ${draft.defaultSubtitleY ?? 68}%`,
      wireframe:
        draft.defaultLayout === 'split'
          ? 'split'
          : draft.defaultLayout === 'pip'
            ? 'pip'
            : draft.defaultHeadlineLayout === 'solid-banner'
              ? 'story'
              : 'plain',
    });
  };

  const previewWidth =
    draft.defaultAspect === '16:9' || draft.defaultAspect === '4:3' ? 240 : 186;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-editor-title"
      data-testid="template-editor-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[88vh] rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[var(--pc-border)] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-4 h-4 text-[var(--pc-accent)] stroke-[1.75]" />
            <div>
              <h2 id="tpl-editor-title" className="text-sm font-semibold text-[var(--pc-ink)] m-0">
                {isEditing ? `Edit Template — ${initialTemplate?.name}` : 'Create Custom Template'}
              </h2>
              <p className="text-xs text-[var(--pc-sub)] m-0 mt-0.5">
                Configure aspect ratio, full-screen video mode, headline &amp; caption placement, and typography.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleLoadFromStudio}>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Studio State</span>
            </Button>
            <button
              type="button"
              aria-label="Close template editor"
              onClick={onClose}
              className="h-8 w-8 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] bg-transparent border-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2-Column Body: Live Visual Blueprint Preview (Left) + Controls (Right) */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[290px_minmax(0,1fr)] overflow-hidden">
          {/* Left: Live Frame Blueprint Preview */}
          <div className="bg-[var(--pc-canvas)] border-b md:border-b-0 md:border-r border-[var(--pc-border)] p-5 flex flex-col items-center justify-center gap-4">
            <div
              data-testid="template-editor-preview"
              style={{
                width: `${previewWidth}px`,
                aspectRatio: aspectSpec.ratio,
                backgroundColor: draft.defaultOuterFill || '#09090B',
              }}
              className="relative rounded-xl border border-[var(--pc-border)] shadow-xl overflow-hidden select-none"
            >
              {/* Video Layer Visualization */}
              {draft.defaultFullScreen ? (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-zinc-900 via-zinc-950 to-zinc-900">
                  <div className="w-full aspect-video bg-gradient-to-tr from-sky-900/70 via-zinc-800 to-indigo-900/70 border-y border-white/15 flex items-center justify-center">
                    <span className="text-[9px] font-mono-tabular uppercase tracking-wider text-white/80 flex items-center gap-1">
                      <Maximize2 className="w-2.5 h-2.5" />
                      100% Full Video
                    </span>
                  </div>
                </div>
              ) : draft.defaultLayout === 'split' ? (
                <div className="absolute inset-0 grid grid-rows-2 gap-0.5 bg-black">
                  <div className="bg-gradient-to-br from-emerald-950/80 to-zinc-900 flex items-center justify-center text-[9px] font-mono-tabular text-white/60">
                    Top Cam / Source
                  </div>
                  <div className="bg-gradient-to-br from-sky-950/80 to-zinc-900 flex items-center justify-center text-[9px] font-mono-tabular text-white/60">
                    Bottom Cam / Game
                  </div>
                </div>
              ) : draft.defaultLayout === 'trio' ? (
                <div className="absolute inset-0 grid grid-rows-2 gap-0.5 bg-black">
                  <div className="grid grid-cols-2 gap-0.5">
                    <div className="bg-zinc-800/80" />
                    <div className="bg-zinc-800/60" />
                  </div>
                  <div className="bg-zinc-900/90" />
                </div>
              ) : draft.defaultLayout === 'pip' ? (
                <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-900 to-black">
                  <div className="absolute bottom-3 right-3 w-[42%] aspect-[4/3] rounded-md border border-white/40 bg-emerald-950/80 flex items-center justify-center text-[8px] font-mono-tabular text-white/80">
                    Facecam
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-900 to-zinc-950" />
              )}

              {/* Live Headline Position Preview */}
              {draft.defaultHeadlineLayout !== 'none' && (
                <div
                  style={{
                    top: `${draft.defaultHeadlineY ?? 18}%`,
                    fontFamily: `"${draft.defaultHeadlineFont}", sans-serif`,
                  }}
                  className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[88%] text-center z-10 pointer-events-none"
                >
                  <span
                    className={
                      draft.defaultHeadlineLayout === 'white-stepped'
                        ? 'bg-white text-black font-bold text-[10px] px-2 py-0.5 rounded'
                        : draft.defaultHeadlineLayout === 'dark-stepped'
                          ? 'bg-black/90 text-white font-bold text-[10px] px-2 py-0.5 rounded'
                          : draft.defaultHeadlineLayout === 'solid-banner'
                            ? 'bg-red-600 text-white font-extrabold text-[10px] px-2 py-0.5 rounded uppercase'
                            : 'text-white font-black text-[11px] drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]'
                    }
                  >
                    Viral Hook Title
                  </span>
                </div>
              )}

              {/* Live Subtitle Position & Style Preview */}
              <div
                style={{
                  top: `${draft.defaultSubtitleY ?? 68}%`,
                  fontFamily: `"${draft.defaultSubtitleFont}", sans-serif`,
                }}
                className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] text-center z-10 pointer-events-none"
              >
                <span
                  className={`inline-flex items-center gap-1 font-black text-[11px] uppercase ${
                    draft.defaultSubtitleBg === 'white-stepped'
                      ? 'bg-white px-2 py-0.5 rounded'
                      : draft.defaultSubtitleBg === 'dark-pill'
                        ? 'bg-black/80 px-2 py-0.5 rounded-md'
                        : ''
                  }`}
                >
                  <span
                    style={{
                      color:
                        draft.defaultSubtitleBg === 'white-stepped'
                          ? '#09090B'
                          : captionPreview.baseColor,
                    }}
                  >
                    THIS
                  </span>
                  <span style={{ color: captionPreview.activeColor }}>GOES</span>
                  <span
                    style={{
                      color:
                        draft.defaultSubtitleBg === 'white-stepped'
                          ? '#09090B'
                          : captionPreview.baseColor,
                    }}
                  >
                    VIRAL
                  </span>
                </span>
              </div>

              {/* Streamer Platform Tag Preview */}
              {draft.defaultStreamerPlatform !== 'none' && (
                <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 text-[9px] font-bold text-white/90 bg-black/60 px-2 py-0.5 rounded font-mono-tabular uppercase">
                  {draft.defaultStreamerPlatform} · @creator
                </div>
              )}
            </div>

            <div className="text-center space-y-1">
              <div className="text-xs font-medium text-[var(--pc-ink)] font-mono-tabular">
                {draft.defaultAspect || '9:16'} ·{' '}
                {draft.defaultFullScreen ? 'Full Screen (100%)' : draft.defaultLayout}
              </div>
              <div className="text-[11px] text-[var(--pc-muted)] font-mono-tabular">
                Hook Y {draft.defaultHeadlineY ?? 18}% · Subs Y {draft.defaultSubtitleY ?? 68}%
              </div>
            </div>
          </div>

          {/* Right: Scrollable Template Configuration Form */}
          <div className="overflow-y-auto studio-scroll p-5 space-y-4">
            {/* Identity Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-[11px] font-medium text-[var(--pc-sub)]">Template Name</span>
                <input
                  type="text"
                  required
                  data-testid="tpl-name-input"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value, fullName: e.target.value })}
                  placeholder="e.g. Full Screen YT Shorts"
                  className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                />
              </label>

              <label className="space-y-1 block">
                <span className="text-[11px] font-medium text-[var(--pc-sub)]">Category</span>
                <select
                  value={draft.category}
                  onChange={(e) =>
                    patch({ category: e.target.value as Exclude<TemplateCategory, 'All'> })
                  }
                  className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-[11px] font-medium text-[var(--pc-sub)]">Description</span>
              <input
                type="text"
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Short note on when to use this template..."
                className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
              />
            </label>

            {/* Aspect Ratio & Full Screen Framing */}
            <div className="p-3.5 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)]/40 space-y-3">
              <div className="text-xs font-semibold text-[var(--pc-ink)]">
                Video Aspect Ratio &amp; Framing
              </div>
              <div className="space-y-1.5">
                <span className="text-[11px] text-[var(--pc-sub)] block">Canvas Aspect Ratio</span>
                <SegmentedControl<AspectRatioId>
                  ariaLabel="Template canvas aspect ratio"
                  size="sm"
                  fullWidth
                  value={draft.defaultAspect || '9:16'}
                  options={ASPECT_OPTIONS.map((a) => ({ value: a.value, label: a.label }))}
                  onChange={(defaultAspect) => patch({ defaultAspect })}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-[var(--pc-sub)] block">Video Layout</span>
                <SegmentedControl<LayoutModeId>
                  ariaLabel="Template layout mode"
                  size="sm"
                  fullWidth
                  value={draft.defaultLayout}
                  options={LAYOUT_OPTIONS}
                  onChange={(defaultLayout) => patch({ defaultLayout })}
                />
              </div>

              <StudioSwitch
                id="tpl-fullscreen-switch"
                checked={Boolean(draft.defaultFullScreen)}
                label="Full Screen Video (Show Whole 100% Frame)"
                description="Keeps the entire landscape/source frame uncropped over the backdrop so nothing gets cut off."
                onChange={(defaultFullScreen) =>
                  patch({
                    defaultFullScreen,
                    defaultLayout: defaultFullScreen ? 'solo' : draft.defaultLayout,
                  })
                }
              />
            </div>

            {/* Caption & Headline Placement */}
            <div className="p-3.5 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)]/40 space-y-3">
              <div className="text-xs font-semibold text-[var(--pc-ink)]">
                Caption &amp; Headline Placement
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StudioSlider
                  label="Headline Vertical Position (Y)"
                  value={draft.defaultHeadlineY ?? 18}
                  min={8}
                  max={48}
                  valueLabel={`${draft.defaultHeadlineY ?? 18}%`}
                  onChange={(defaultHeadlineY) => patch({ defaultHeadlineY })}
                />
                <StudioSlider
                  label="Captions Vertical Position (Y)"
                  value={draft.defaultSubtitleY ?? 68}
                  min={18}
                  max={90}
                  valueLabel={`${draft.defaultSubtitleY ?? 68}%`}
                  onChange={(defaultSubtitleY) => patch({ defaultSubtitleY })}
                />
                <StudioSlider
                  label="Headline Size"
                  value={draft.defaultHeadlineSize ?? 22}
                  min={14}
                  max={40}
                  valueLabel={`${draft.defaultHeadlineSize ?? 22}px`}
                  onChange={(defaultHeadlineSize) => patch({ defaultHeadlineSize })}
                />
                <StudioSlider
                  label="Caption Size"
                  value={draft.defaultSubtitleSize ?? 26}
                  min={14}
                  max={44}
                  valueLabel={`${draft.defaultSubtitleSize ?? 26}px`}
                  onChange={(defaultSubtitleSize) => patch({ defaultSubtitleSize })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-[11px] text-[var(--pc-sub)]">Caption Style</span>
                  <select
                    value={draft.defaultCaptionStyle}
                    onChange={(e) => {
                      const nextStyle = captionPresets.find((c) => c.id === e.target.value);
                      patch({
                        defaultCaptionStyle: e.target.value,
                        defaultSubtitleFont: nextStyle?.subtitleFont || draft.defaultSubtitleFont,
                      });
                    }}
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    {captionPresets.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[11px] text-[var(--pc-sub)]">Headline Box Style</span>
                  <select
                    value={draft.defaultHeadlineLayout}
                    onChange={(e) =>
                      patch({ defaultHeadlineLayout: e.target.value as HeadlineLayoutStyleId })
                    }
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    <option value="outline-only">White Bold Outline</option>
                    <option value="white-stepped">White Stepped Box</option>
                    <option value="dark-stepped">Dark Stepped Box</option>
                    <option value="solid-banner">Red Breaking Banner</option>
                    <option value="none">No Headline</option>
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[11px] text-[var(--pc-sub)]">Headline Font</span>
                  <select
                    value={draft.defaultHeadlineFont}
                    onChange={(e) => patch({ defaultHeadlineFont: e.target.value })}
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    {allFontFamilies.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[11px] text-[var(--pc-sub)]">Subtitle Font</span>
                  <select
                    value={draft.defaultSubtitleFont}
                    onChange={(e) => patch({ defaultSubtitleFont: e.target.value })}
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    {allFontFamilies.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <label className="space-y-1 block">
                  <span className="text-[11px] text-[var(--pc-sub)]">Subtitle Background</span>
                  <select
                    value={draft.defaultSubtitleBg}
                    onChange={(e) =>
                      patch({ defaultSubtitleBg: e.target.value as SubtitleBgStyleId })
                    }
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    <option value="none">None (Stroke)</option>
                    <option value="white-stepped">White Box</option>
                    <option value="dark-pill">Dark Backdrop</option>
                    <option value="active-box">Active Highlight</option>
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[11px] text-[var(--pc-sub)]">Safe Zone</span>
                  <select
                    value={draft.defaultSafeZone}
                    onChange={(e) =>
                      patch({ defaultSafeZone: e.target.value as ResolvedSafeZonePlatformId })
                    }
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    <option value="youtube-shorts">YouTube Shorts</option>
                    <option value="instagram-reels">Instagram Reels</option>
                    <option value="universal">Universal Safe</option>
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-[11px] text-[var(--pc-sub)]">Platform Badge</span>
                  <select
                    value={draft.defaultStreamerPlatform}
                    onChange={(e) =>
                      patch({ defaultStreamerPlatform: e.target.value as StreamerPlatformId })
                    }
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    <option value="none">Hidden</option>
                    <option value="youtube">YouTube Shorts</option>
                    <option value="kick">Kick</option>
                    <option value="instagram">Instagram</option>
                    <option value="auto">Auto Detect</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Accent Color & Backdrop */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <span className="text-[11px] text-[var(--pc-sub)] block">Template Accent Swatch</span>
                <div className="flex items-center gap-1.5">
                  {ACCENT_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`Select accent ${hex}`}
                      onClick={() => patch({ accentHex: hex })}
                      style={{ backgroundColor: hex }}
                      className={`w-5 h-5 rounded-full cursor-pointer border-2 ${
                        draft.accentHex === hex ? 'border-white scale-110' : 'border-transparent opacity-75'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-[var(--pc-sub)]">
                <span>Backdrop Fill</span>
                <input
                  type="color"
                  value={draft.defaultOuterFill || '#09090B'}
                  onChange={(e) => patch({ defaultOuterFill: e.target.value })}
                  className="h-7 w-9 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between shrink-0">
          <span className="text-xs text-[var(--pc-muted)]">
            Saved templates are immediately applied to your Shorts Studio &amp; Dashboard preset list.
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" data-testid="save-template-btn">
              {isEditing ? 'Save Changes' : 'Create & Apply Template'}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
