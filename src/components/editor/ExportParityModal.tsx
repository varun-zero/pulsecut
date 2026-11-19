import React, { useEffect } from 'react';
import { CheckCircle2, Copy, Download, FileCode2, Film, X } from 'lucide-react';
import type { BrandKit, ClipItem, CustomFontEntry, EditorSettings } from '../../types';
import { buildRenderParitySpec, getViralCaptionPreset } from '../../captionStyles';
import { getTemplatePreset } from '../../presets';
import { Button } from '../ui/Primitives';

interface ExportParityModalProps {
  open: boolean;
  clip: ClipItem | null;
  settings: EditorSettings;
  brandKit: BrandKit;
  trimInSec: number;
  trimOutSec: number;
  customFonts: readonly CustomFontEntry[];
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export function ExportParityModal({
  open,
  clip,
  settings,
  brandKit,
  trimInSec,
  trimOutSec,
  customFonts,
  onClose,
  onNotify,
}: ExportParityModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !clip) return null;

  const spec = buildRenderParitySpec(clip.words, settings, brandKit, trimInSec, customFonts);
  const templatePreset = getTemplatePreset(settings.template);
  const captionPreset = getViralCaptionPreset(settings.captionStyle);

  const handleDownloadAss = () => {
    const blob = new Blob([spec.assScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clip.id}-${settings.template}.ass`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`Downloaded ${clip.id}-${settings.template}.ass`);
  };

  const handleCopyFiltergraph = () => {
    navigator.clipboard?.writeText(spec.ffmpegFiltergraph).catch(() => {});
    onNotify('Copied FFmpeg filtergraph');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-parity-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl overflow-hidden flex flex-col max-h-[86vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--pc-border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-[var(--pc-ok)] shrink-0" />
            <div>
              <h2 id="export-parity-title" className="text-sm font-semibold text-[var(--pc-ink)] m-0">
                1:1 Preview-to-Export Parity Ready
              </h2>
              <p className="text-xs text-[var(--pc-sub)] m-0 mt-0.5 font-mono-tabular">
                {spec.dimensions.width}×{spec.dimensions.height} · {templatePreset.fullName} · {captionPreset.name}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close export modal"
            onClick={onClose}
            className="h-8 w-8 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] bg-transparent border-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto studio-scroll p-5 space-y-4">
          {/* Parity Verification Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-3">
              <div className="text-[11px] text-[var(--pc-muted)]">Bundled Font Parity</div>
              <div className="font-mono-tabular text-[var(--pc-ink)] mt-1 truncate">
                Hook: {spec.headlineFontFile}
              </div>
              <div className="font-mono-tabular text-[var(--pc-sub)] mt-0.5 truncate">
                Subs: {spec.subtitleFontFile}
              </div>
            </div>

            <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-3">
              <div className="text-[11px] text-[var(--pc-muted)]">Safe Zone Geometry</div>
              <div className="font-medium text-[var(--pc-ink)] mt-1">{spec.safeZone.label}</div>
              <div className="font-mono-tabular text-[11px] text-[var(--pc-sub)] mt-0.5 truncate">
                {spec.safeZone.safeBoxSummary}
              </div>
            </div>
          </div>

          {/* Active Platform Overlays */}
          <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-3 text-xs">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] text-[var(--pc-muted)]">Trim &amp; Compositor Layers</span>
              <span className="font-mono-tabular text-[11px] text-[var(--pc-sub)]">
                {trimInSec.toFixed(1)}s → {trimOutSec.toFixed(1)}s · Stroke {settings.subtitleStrokeWidth}px · Y {settings.subtitleVerticalPos}%
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-tabular text-[11px] text-[var(--pc-ink)]">
              <span className="inline-flex items-center gap-1">
                <Film className="w-3 h-3 text-[var(--pc-accent)]" />
                {settings.layout} / {settings.canvas}
              </span>
              {spec.overlayAssets.map((asset) => (
                <span key={asset} className="text-[var(--pc-sub)]">
                  · {asset}
                </span>
              ))}
            </div>
          </div>

          {/* FFmpeg Filtergraph */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--pc-sub)]">FFmpeg Filtergraph</span>
              <button
                type="button"
                onClick={handleCopyFiltergraph}
                className="text-[11px] font-medium text-[var(--pc-accent)] hover:underline inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer"
              >
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </button>
            </div>
            <pre className="m-0 p-3 rounded-lg bg-[var(--pc-bg)] border border-[var(--pc-border)] font-mono-tabular text-[11px] text-[var(--pc-sub)] overflow-x-auto whitespace-pre-wrap break-all">
              {spec.ffmpegFiltergraph}
            </pre>
          </div>

          {/* Generated libass ASS Script Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--pc-sub)] inline-flex items-center gap-1.5">
                <FileCode2 className="w-3.5 h-3.5" />
                <span>Generated ASS Subtitle Script (Word-Level \k + Emphasis)</span>
              </span>
            </div>
            <pre className="m-0 p-3 rounded-lg bg-[var(--pc-bg)] border border-[var(--pc-border)] font-mono-tabular text-[10.5px] text-[var(--pc-sub)] max-h-44 overflow-auto studio-scroll">
              {spec.assScript}
            </pre>
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between gap-3">
          <Button variant="secondary" size="sm" onClick={handleDownloadAss}>
            <Download className="w-3.5 h-3.5" />
            <span>Download .ass Subtitles</span>
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
