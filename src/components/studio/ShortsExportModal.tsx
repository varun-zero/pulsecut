import React, { useEffect } from 'react';
import { CheckCircle2, Copy, Download, FileCode2, Film, X } from 'lucide-react';
import type {
  BrandKit,
  ClipItem,
  CustomFontEntry,
  EditorSettings,
  ExportEncoderId,
  ExportResolutionId,
  FramingBlueprint,
  ShortsProductionConfig,
} from '../../types';
import { buildFullShortExportSpec } from '../../lib/shortsEngine';
import { Button, SegmentedControl } from '../ui/Primitives';

interface ShortsExportModalProps {
  open: boolean;
  clip: ClipItem | null;
  blueprint: FramingBlueprint;
  shorts: ShortsProductionConfig;
  settings: EditorSettings;
  brandKit: BrandKit;
  trimInSec: number;
  trimOutSec: number;
  customFonts: readonly CustomFontEntry[];
  onChangeResolution: (res: ExportResolutionId) => void;
  onChangeEncoder: (enc: ExportEncoderId) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export function ShortsExportModal({
  open,
  clip,
  blueprint,
  shorts,
  settings,
  brandKit,
  trimInSec,
  trimOutSec,
  customFonts,
  onChangeResolution,
  onChangeEncoder,
  onClose,
  onNotify,
}: ShortsExportModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !clip) return null;

  const spec = buildFullShortExportSpec(
    blueprint,
    shorts,
    settings,
    brandKit,
    clip.words,
    trimInSec,
    trimOutSec,
    customFonts
  );

  const handleCopyCommand = () => {
    navigator.clipboard?.writeText(spec.ffmpegCommand).catch(() => {});
    onNotify('Copied full FFmpeg export command');
  };

  const handleCopyFiltergraph = () => {
    navigator.clipboard?.writeText(spec.ffmpegFiltergraph).catch(() => {});
    onNotify('Copied FFmpeg filtergraph');
  };

  const handleDownloadAss = () => {
    const blob = new Blob([spec.assScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clip.id}-${blueprint.aspect.replace(':', 'x')}.ass`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(`Downloaded ${clip.id}-${blueprint.aspect.replace(':', 'x')}.ass`);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shorts-export-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--pc-border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-[var(--pc-ok)] shrink-0" />
            <div>
              <h2 id="shorts-export-title" className="text-sm font-semibold text-[var(--pc-ink)] m-0">
                Export Short · {blueprint.aspect} ({spec.dimensions.width}×{spec.dimensions.height})
              </h2>
              <p className="text-xs text-[var(--pc-sub)] m-0 mt-0.5 font-mono-tabular">
                {spec.stitchedDurationSec.toFixed(1)}s · {spec.segmentCount} segment
                {spec.segmentCount === 1 ? '' : 's'} · {blueprint.layout} framing
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
          {/* Resolution & Hardware Encoder Controls (from decompiled export pipeline) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--pc-sub)]">Output Resolution</div>
              <SegmentedControl<ExportResolutionId>
                ariaLabel="Export resolution"
                size="sm"
                fullWidth
                value={shorts.exportResolution}
                options={[
                  { value: '720p', label: '720p' },
                  { value: '1080p', label: '1080p' },
                  { value: '2k', label: '2K' },
                  { value: '4k', label: '4K' },
                ]}
                onChange={onChangeResolution}
              />
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--pc-sub)]">Hardware Encoder</div>
              <SegmentedControl<ExportEncoderId>
                ariaLabel="Export encoder"
                size="sm"
                fullWidth
                value={shorts.exportEncoder}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'nvenc', label: 'NVENC' },
                  { value: 'videotoolbox', label: 'Apple' },
                  { value: 'cpu', label: 'CPU' },
                ]}
                onChange={onChangeEncoder}
              />
            </div>
          </div>

          {/* Pipeline Summary */}
          <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] p-3 space-y-1 text-xs">
            <div className="text-[11px] font-medium text-[var(--pc-muted)] flex items-center gap-1.5 mb-1">
              <Film className="w-3.5 h-3.5 text-[var(--pc-accent)]" />
              <span>Framing Blueprint → Shorts Render Pipeline</span>
            </div>
            {spec.summaryLines.map((line) => (
              <div key={line} className="font-mono-tabular text-[11px] text-[var(--pc-ink)]">
                {line}
              </div>
            ))}
            <div className="font-mono-tabular text-[11px] text-[var(--pc-ink)]">
              Encoder:{' '}
              {shorts.exportEncoder === 'nvenc'
                ? 'NVENC (h264_nvenc)'
                : shorts.exportEncoder === 'videotoolbox'
                  ? 'Apple VideoToolbox (h264_videotoolbox)'
                  : shorts.exportEncoder === 'cpu'
                    ? 'CPU x264 (libx264 -crf 18)'
                    : 'Auto (libx264 / hardware fallback)'}
            </div>
          </div>

          {/* FFmpeg Filtergraph */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--pc-sub)]">
                FFmpeg Filtergraph (Framing + Stitching + Captions)
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyFiltergraph}
                  className="text-[11px] font-medium text-[var(--pc-accent)] hover:underline inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy Filtergraph</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="text-[11px] font-medium text-[var(--pc-accent)] hover:underline inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy Full CLI</span>
                </button>
              </div>
            </div>
            <pre className="m-0 p-3 rounded-lg bg-[var(--pc-bg)] border border-[var(--pc-border)] font-mono-tabular text-[11px] text-[var(--pc-sub)] overflow-x-auto whitespace-pre-wrap break-all">
              {spec.ffmpegFiltergraph}
            </pre>
          </div>

          {/* Generated ASS Subtitles */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-[var(--pc-sub)] inline-flex items-center gap-1.5">
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Generated ASS Subtitles</span>
            </span>
            <pre className="m-0 p-3 rounded-lg bg-[var(--pc-bg)] border border-[var(--pc-border)] font-mono-tabular text-[10.5px] text-[var(--pc-sub)] max-h-40 overflow-auto studio-scroll">
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
