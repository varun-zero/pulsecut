import React, { useEffect } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type {
  AspectRatioId,
  BatchRestyleSettings,
  CanvasModeId,
  CustomFontEntry,
  LayoutModeId,
} from '../types';
import {
  ASPECT_RATIOS,
  CANVAS_MODES,
  FEATURED_PRESETS,
  LAYOUT_MODES,
} from '../presets';
import {
  Button,
  SegmentedControl,
  StudioSwitch,
  TemplateMiniPreview,
  ViralCaptionPresetCards,
  ViralFontSelect,
} from './ui/Primitives';

interface BatchRestyleDrawerProps {
  open: boolean;
  selectedCount: number;
  settings: BatchRestyleSettings;
  customFonts: readonly CustomFontEntry[];
  onUploadCustomFont: (file: File) => void;
  onChange: (next: BatchRestyleSettings) => void;
  onApply: () => void;
  onClose: () => void;
  busy: boolean;
}

export function BatchRestyleDrawer({
  open,
  selectedCount,
  settings,
  customFonts,
  onUploadCustomFont,
  onChange,
  onApply,
  onClose,
  busy,
}: BatchRestyleDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-drawer-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[440px] h-full bg-[var(--pc-surface)] border-l border-[var(--pc-border)] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-14 px-5 border-b border-[var(--pc-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[var(--pc-sub)] stroke-[1.75]" />
            <h2 id="batch-drawer-title" className="text-sm font-semibold text-[var(--pc-ink)] m-0">
              Batch Restyle
            </h2>
            <span className="font-mono-tabular text-xs text-[var(--pc-muted)]">
              · {selectedCount} selected
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close batch restyle drawer"
            className="h-7 w-7 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] cursor-pointer bg-transparent border-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto studio-scroll p-5 space-y-5">
          {/* Shared Platform & Creative Presets */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-[var(--pc-sub)]">Template Preset</span>
            <div className="grid grid-cols-3 gap-2">
              {FEATURED_PRESETS.map((preset) => {
                const active = settings.template === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onChange({
                        ...settings,
                        template: preset.id,
                        layout: preset.defaultLayout,
                        captionStyle: preset.defaultCaptionStyle,
                        font: preset.defaultHeadlineFont,
                        subtitleFont: preset.defaultSubtitleFont,
                      })
                    }
                    className={`p-2 rounded-lg border text-left flex items-center gap-2 cursor-pointer transition-colors ${
                      active
                        ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                        : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                    }`}
                  >
                    <TemplateMiniPreview preset={preset} active={active} />
                    <span className="text-[11px] font-medium leading-tight truncate">
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-[var(--pc-sub)]">Aspect Ratio</span>
            <SegmentedControl<AspectRatioId>
              ariaLabel="Batch aspect ratio"
              fullWidth
              value={settings.aspect}
              options={ASPECT_RATIOS.map((r) => ({ value: r.id, label: r.label }))}
              onChange={(aspect) => onChange({ ...settings, aspect })}
            />
          </div>

          {/* Composition Layout */}
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-[var(--pc-sub)]">
              Composition Layout
            </span>
            <SegmentedControl<LayoutModeId>
              ariaLabel="Batch layout mode"
              fullWidth
              value={settings.layout}
              options={LAYOUT_MODES.map((l) => ({ value: l.id, label: l.label }))}
              onChange={(layout) => onChange({ ...settings, layout })}
            />
          </div>

          {/* Canvas Fill */}
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-[var(--pc-sub)]">Canvas Fill</span>
            <SegmentedControl<CanvasModeId>
              ariaLabel="Batch canvas fill"
              fullWidth
              value={settings.canvas}
              options={CANVAS_MODES.map((c) => ({ value: c.id, label: c.label }))}
              onChange={(canvas) => onChange({ ...settings, canvas })}
            />
          </div>

          {/* Viral Caption Preset Cards & Typography */}
          <div className="space-y-3 pt-2 border-t border-[var(--pc-border)]">
            <span className="block text-xs font-medium text-[var(--pc-sub)]">
              Viral Caption Style Preset
            </span>
            <ViralCaptionPresetCards
              activeId={settings.captionStyle}
              onSelect={(preset) =>
                onChange({
                  ...settings,
                  captionStyle: preset.id,
                  font: preset.headlineFont,
                  subtitleFont: preset.subtitleFont,
                })
              }
            />

            <div className="grid grid-cols-1 gap-3 pt-1">
              <ViralFontSelect
                label="Headline Hook Font"
                value={settings.font}
                customFonts={customFonts}
                onChange={(font) => onChange({ ...settings, font })}
                onUploadCustomFont={onUploadCustomFont}
              />
              <ViralFontSelect
                label="Subtitle & Caption Font"
                value={settings.subtitleFont}
                customFonts={customFonts}
                onChange={(subtitleFont) => onChange({ ...settings, subtitleFont })}
                onUploadCustomFont={onUploadCustomFont}
              />
            </div>
          </div>

          {/* Finishing & Synced Brand Handle */}
          <div className="space-y-3 pt-2 border-t border-[var(--pc-border)]">
            <div className="space-y-1.5">
              <label htmlFor="batch-handle" className="block text-xs font-medium text-[var(--pc-sub)]">
                Brand Handle (synced with Brand Kit)
              </label>
              <input
                id="batch-handle"
                type="text"
                value={settings.handle}
                onChange={(e) => onChange({ ...settings, handle: e.target.value })}
                placeholder="@pulsecut"
                className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="batch-outro" className="block text-xs font-medium text-[var(--pc-sub)]">
                Outro CTA Text
              </label>
              <input
                id="batch-outro"
                type="text"
                value={settings.outroText}
                onChange={(e) => onChange({ ...settings, outroText: e.target.value })}
                placeholder="Follow for full episodes"
                className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
              />
            </div>

            <StudioSwitch
              id="batch-audio-riser"
              label="Audio peak riser"
              description="Subtle tension swell across final 5 seconds"
              checked={settings.audioPeak}
              onChange={(audioPeak) => onChange({ ...settings, audioPeak })}
            />
          </div>
        </div>

        <div className="p-4 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between gap-3 shrink-0">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onApply} disabled={busy || selectedCount === 0}>
            {busy ? 'Re-rendering...' : `Re-render ${selectedCount} Selected`}
          </Button>
        </div>
      </div>
    </div>
  );
}
