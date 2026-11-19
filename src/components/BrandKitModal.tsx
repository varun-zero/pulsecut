import React, { useEffect } from 'react';
import { UserCheck, X } from 'lucide-react';
import type { BrandKit, WatermarkPositionId } from '../types';
import { WATERMARK_POSITIONS } from '../presets';
import { Button, StudioSelect, StudioSlider, StudioSwitch } from './ui/Primitives';

export function BrandKitModal({
  open,
  brandKit,
  onChange,
  onClose,
}: {
  open: boolean;
  brandKit: BrandKit;
  onChange: (next: BrandKit) => void;
  onClose: () => void;
}) {
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
      aria-labelledby="brand-kit-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--pc-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-[var(--pc-sub)] stroke-[1.75]" />
            <h2 id="brand-kit-title" className="text-sm font-semibold text-[var(--pc-ink)] m-0">
              Workspace Brand Kit
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close brand kit"
            className="h-7 w-7 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] cursor-pointer bg-transparent border-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-[var(--pc-sub)] m-0">
            Synced automatically across Social Card headers, watermarks, and Clips batch finishing.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="bk-display" className="block text-xs text-[var(--pc-sub)]">
                Display Name
              </label>
              <input
                id="bk-display"
                type="text"
                value={brandKit.displayName}
                onChange={(e) => onChange({ ...brandKit, displayName: e.target.value })}
                placeholder="PulseCut Creator"
                className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bk-handle" className="block text-xs text-[var(--pc-sub)]">
                Creator Handle
              </label>
              <input
                id="bk-handle"
                type="text"
                value={brandKit.handle}
                onChange={(e) => onChange({ ...brandKit, handle: e.target.value })}
                placeholder="@pulsecut"
                className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bk-outro" className="block text-xs text-[var(--pc-sub)]">
              Default Outro CTA
            </label>
            <input
              id="bk-outro"
              type="text"
              value={brandKit.defaultOutro}
              onChange={(e) => onChange({ ...brandKit, defaultOutro: e.target.value })}
              placeholder="Follow for full episodes"
              className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
            />
          </div>

          <StudioSwitch
            id="bk-verified"
            label="Verified badge on social cards"
            checked={brandKit.verified}
            onChange={(verified) => onChange({ ...brandKit, verified })}
          />

          <StudioSwitch
            id="bk-wm"
            label="Show handle watermark on exports"
            checked={brandKit.showWatermark}
            onChange={(showWatermark) => onChange({ ...brandKit, showWatermark })}
          />

          {brandKit.showWatermark && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <StudioSelect<WatermarkPositionId>
                label="Watermark Position"
                value={brandKit.watermarkPosition}
                options={WATERMARK_POSITIONS}
                onChange={(watermarkPosition) => onChange({ ...brandKit, watermarkPosition })}
              />
              <StudioSlider
                id="bk-wm-op"
                label="Opacity"
                value={brandKit.watermarkOpacity}
                min={20}
                max={100}
                unit="%"
                onChange={(watermarkOpacity) => onChange({ ...brandKit, watermarkOpacity })}
              />
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex justify-end">
          <Button variant="primary" size="sm" onClick={onClose}>
            Save Brand Kit
          </Button>
        </div>
      </div>
    </div>
  );
}
