import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileCode2,
  FolderUp,
  Image as ImageIcon,
  Maximize2,
  Sliders,
  Upload,
  X,
} from 'lucide-react';
import {
  parseUniversalTemplateFiles,
  parseUniversalTemplateText,
  TEMPLATE_FILE_ACCEPT_ATTR,
  type ImportFileInput,
  type UniversalTemplateImportResult,
} from '../../lib/universalTemplateImporter';
import { Button, SegmentedControl, StudioSwitch } from '../ui/Primitives';

interface UniversalTemplateImportModalProps {
  open: boolean;
  onImport: (
    result: UniversalTemplateImportResult,
    options: {
      openInEditor: boolean;
      includeOverlay: boolean;
      registerBundledFonts: boolean;
      saveCaptionStyle: boolean;
    }
  ) => void;
  onClose: () => void;
}

type InputMode = 'file' | 'paste';

const ASPECT_RATIO_CSS: Record<string, string> = {
  '9:16': '9 / 16',
  '4:5': '4 / 5',
  '1:1': '1 / 1',
  '16:9': '16 / 9',
  '4:3': '4 / 3',
};

const SUPPORTED_PLATFORMS = [
  { name: 'CapCut', ext: 'draft_content.json · .ccut · .zip' },
  { name: 'Alight Motion', ext: '.xml · .amproj' },
  { name: 'After Effects / Lottie', ext: '.json · .mogrt' },
  { name: 'Premiere / DaVinci / FCP', ext: '.fcpxml · .xml · .prproj' },
  { name: 'Canva / Figma / Photoshop', ext: '.png · .webp · .svg overlay' },
  { name: 'Subtitles / PulseCut', ext: '.ass · .ssa · .pulsecut.json' },
];

export function UniversalTemplateImportModal({
  open,
  onImport,
  onClose,
}: UniversalTemplateImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<InputMode>('file');
  const [dragging, setDragging] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [parsed, setParsed] = useState<UniversalTemplateImportResult | null>(null);
  const [customName, setCustomName] = useState('');
  const [includeOverlay, setIncludeOverlay] = useState(true);
  const [registerBundledFonts, setRegisterBundledFonts] = useState(true);
  const [saveCaptionStyle, setSaveCaptionStyle] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setMode('file');
      setParsed(null);
      setErrorMsg(null);
      setDragging(false);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const applyParsedResult = (res: UniversalTemplateImportResult) => {
    setParsed(res);
    setCustomName(res.template.name);
    setIncludeOverlay(Boolean(res.template.overlayImageDataUrl));
    setRegisterBundledFonts(res.extractedFonts.length > 0);
    setSaveCaptionStyle(Boolean(res.extractedCaptionStyle));
    setErrorMsg(null);
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (!arr.length) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const inputs: ImportFileInput[] = await Promise.all(
        arr.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          mimeType: file.type || undefined,
        }))
      );
      const result = parseUniversalTemplateFiles(inputs);
      applyParsedResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to parse template file.');
      setParsed(null);
    } finally {
      setBusy(false);
    }
  };

  const handleParsePaste = () => {
    setErrorMsg(null);
    try {
      const result = parseUniversalTemplateText(pasteText, 'Imported Template');
      applyParsedResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not parse pasted template text.');
      setParsed(null);
    }
  };

  const handleConfirm = (openInEditor: boolean) => {
    if (!parsed) return;
    const finalName = customName.trim() || parsed.template.name || 'Imported Template';
    const nextResult: UniversalTemplateImportResult = {
      ...parsed,
      template: {
        ...parsed.template,
        name: finalName,
        fullName: finalName,
        overlayImageDataUrl: includeOverlay ? parsed.template.overlayImageDataUrl : undefined,
      },
    };
    onImport(nextResult, {
      openInEditor,
      includeOverlay,
      registerBundledFonts,
      saveCaptionStyle,
    });
    setParsed(null);
    setPasteText('');
    setCustomName('');
    onClose();
  };

  const handleReset = () => {
    setParsed(null);
    setErrorMsg(null);
  };

  const tpl = parsed?.template;
  const previewAspectCss = ASPECT_RATIO_CSS[tpl?.defaultAspect || '9:16'] || '9 / 16';
  const previewWidth = tpl?.defaultAspect === '16:9' || tpl?.defaultAspect === '4:3' ? 236 : 176;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="universal-tpl-import-title"
      data-testid="universal-template-import-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[88vh] rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[var(--pc-border)] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderUp className="w-4 h-4 text-[var(--pc-accent)] stroke-[1.75] shrink-0" />
            <div className="min-w-0">
              <h2
                id="universal-tpl-import-title"
                className="text-sm font-semibold text-[var(--pc-ink)] m-0"
              >
                Import Universal Template
              </h2>
              <p className="text-xs text-[var(--pc-sub)] m-0 mt-0.5 truncate">
                Import templates from CapCut, Alight Motion, After Effects, Premiere, DaVinci, Canva, or Figma.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close universal template importer"
            onClick={onClose}
            className="h-8 w-8 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] bg-transparent border-0 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto studio-scroll p-5 space-y-4">
          {!parsed ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <SegmentedControl<InputMode>
                  ariaLabel="Template import method"
                  size="sm"
                  value={mode}
                  options={[
                    { value: 'file', label: 'Drop / Browse File(s)' },
                    { value: 'paste', label: 'Paste JSON / XML / ASS' },
                  ]}
                  onChange={(next) => {
                    setMode(next);
                    setErrorMsg(null);
                  }}
                />
                <span className="text-[11px] text-[var(--pc-muted)] hidden sm:inline">
                  Multi-file drop supported (e.g. JSON + PNG overlay + TTF font)
                </span>
              </div>

              {mode === 'file' ? (
                <div
                  data-testid="universal-import-dropzone"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    if (e.dataTransfer.files?.length) {
                      void handleFiles(e.dataTransfer.files);
                    }
                  }}
                  className={`rounded-xl border-2 border-dashed p-7 text-center transition-colors ${
                    dragging
                      ? 'border-[var(--pc-accent)] bg-[var(--pc-accent-soft)]'
                      : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 hover:border-[var(--pc-muted)]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={TEMPLATE_FILE_ACCEPT_ATTR}
                    data-testid="universal-import-file-input"
                    aria-label="Upload template file"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        void handleFiles(e.target.files);
                      }
                      e.target.value = '';
                    }}
                  />
                  <div className="mx-auto w-11 h-11 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] grid place-items-center mb-3">
                    <Upload className="w-5 h-5 text-[var(--pc-accent)]" />
                  </div>
                  <div className="text-sm font-semibold text-[var(--pc-ink)]">
                    {busy ? 'Inspecting template package...' : 'Drop any template file or bundle here'}
                  </div>
                  <p className="text-xs text-[var(--pc-sub)] mt-1 mb-4 max-w-md mx-auto">
                    Auto-detects canvas aspect ratio, split/PiP/full-screen layout, text styles, colors, LUTs, fonts, and transparent graphic frame overlays.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FolderUp className="w-3.5 h-3.5" />
                    <span>Choose Template File(s)</span>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--pc-sub)] flex items-center gap-1.5">
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      <span>Paste CapCut JSON, Alight Motion XML, Lottie JSON, ASS style, SVG, or PulseCut JSON</span>
                    </span>
                    <textarea
                      data-testid="universal-import-paste-input"
                      rows={8}
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder='{"canvas_config":{"width":1080,"height":1920,"ratio":"9:16"}, ...}  or  <scene width="1080" height="1920">...</scene>'
                      className="w-full p-3 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-canvas)] text-xs font-mono text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)] resize-y"
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      data-testid="universal-import-parse-btn"
                      disabled={!pasteText.trim()}
                      onClick={handleParsePaste}
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      <span>Parse Template</span>
                    </Button>
                  </div>
                </div>
              )}

              {errorMsg && (
                <div
                  role="alert"
                  className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-300 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Supported Editors Grid */}
              <div className="pt-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--pc-muted)] mb-2">
                  Supported External Formats
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {SUPPORTED_PLATFORMS.map((item) => (
                    <div
                      key={item.name}
                      className="px-3 py-2 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)]/40"
                    >
                      <div className="text-xs font-semibold text-[var(--pc-ink)]">{item.name}</div>
                      <div className="text-[10.5px] font-mono-tabular text-[var(--pc-muted)] mt-0.5 truncate">
                        {item.ext}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* Parsed Preview & Confirmation View */
            <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-5 items-start">
              {/* Left: Live Visual Preview */}
              <div className="rounded-xl bg-[var(--pc-canvas)] border border-[var(--pc-border)] p-4 flex flex-col items-center gap-3">
                <div
                  data-testid="universal-import-preview-frame"
                  style={{
                    width: `${previewWidth}px`,
                    aspectRatio: previewAspectCss,
                    backgroundColor: tpl?.defaultOuterFill || '#09090B',
                  }}
                  className="relative rounded-lg border border-[var(--pc-border)] shadow-lg overflow-hidden select-none"
                >
                  {/* Simulated Video Layer */}
                  {tpl?.defaultFullScreen ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
                      <div className="w-full aspect-video bg-gradient-to-tr from-sky-900/70 via-zinc-800 to-indigo-900/70 border-y border-white/15 flex items-center justify-center">
                        <span className="text-[8.5px] font-mono-tabular uppercase text-white/80 flex items-center gap-1">
                          <Maximize2 className="w-2.5 h-2.5" />
                          100% Full
                        </span>
                      </div>
                    </div>
                  ) : tpl?.defaultLayout === 'split' ? (
                    <div className="absolute inset-0 grid grid-rows-2 gap-0.5 bg-black">
                      <div className="bg-zinc-800/80 flex items-center justify-center text-[8.5px] font-mono-tabular text-white/60">
                        Top Source
                      </div>
                      <div className="bg-zinc-900/90 flex items-center justify-center text-[8.5px] font-mono-tabular text-white/60">
                        Bottom Source
                      </div>
                    </div>
                  ) : tpl?.defaultLayout === 'pip' ? (
                    <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-900 to-black">
                      <div className="absolute bottom-2.5 right-2.5 w-[42%] aspect-[4/3] rounded border border-white/40 bg-emerald-950/80 flex items-center justify-center text-[8px] font-mono-tabular text-white/80">
                        PiP Cam
                      </div>
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 via-zinc-900 to-zinc-950" />
                  )}

                  {/* Imported Graphic Overlay Preview */}
                  {includeOverlay && tpl?.overlayImageDataUrl && (
                    <img
                      src={tpl.overlayImageDataUrl}
                      alt="Imported overlay preview"
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
                    />
                  )}

                  {/* Headline Preview */}
                  {tpl && tpl.defaultHeadlineLayout !== 'none' && (
                    <div
                      style={{
                        top: `${tpl.defaultHeadlineY ?? 18}%`,
                        fontFamily: `"${tpl.defaultHeadlineFont}", sans-serif`,
                      }}
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[88%] text-center z-20 pointer-events-none"
                    >
                      <span className="text-white font-black text-[10px] drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
                        Hook Title
                      </span>
                    </div>
                  )}

                  {/* Captions Preview */}
                  {tpl && (
                    <div
                      style={{
                        top: `${tpl.defaultSubtitleY ?? 68}%`,
                        fontFamily: `"${tpl.defaultSubtitleFont}", sans-serif`,
                      }}
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] text-center z-20 pointer-events-none"
                    >
                      <span className="inline-flex items-center gap-1 font-black text-[10.5px] uppercase drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
                        <span style={{ color: tpl.defaultSubtitleBaseColor || '#FFFFFF' }}>
                          LIVE
                        </span>
                        <span style={{ color: tpl.defaultSubtitleActiveColor || tpl.accentHex || '#FFE600' }}>
                          CAPTIONS
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                <div className="text-center space-y-0.5">
                  <div
                    data-testid="universal-import-detected-format"
                    className="text-[11px] font-semibold text-[var(--pc-ink)]"
                  >
                    {parsed.formatLabel}
                  </div>
                  <div className="text-[10.5px] font-mono-tabular text-[var(--pc-muted)]">
                    {tpl?.defaultAspect || '9:16'} ·{' '}
                    {tpl?.defaultFullScreen ? 'Full Screen' : tpl?.defaultLayout}
                  </div>
                </div>
              </div>

              {/* Right: Extracted Spec & Options */}
              <div className="space-y-3.5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Template Parsed Successfully</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-xs text-[var(--pc-sub)] hover:text-[var(--pc-ink)] underline bg-transparent border-0 cursor-pointer"
                  >
                    Import another file
                  </button>
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-[var(--pc-sub)]">
                    Template Name in PulseCut
                  </span>
                  <input
                    type="text"
                    data-testid="universal-import-name-input"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                  />
                </label>

                {/* Extracted Properties */}
                <div className="p-3 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 space-y-1.5">
                  <div className="text-[11px] font-semibold text-[var(--pc-ink)]">
                    Extracted Properties
                  </div>
                  <ul className="m-0 pl-4 list-disc space-y-1 text-xs text-[var(--pc-sub)]">
                    {parsed.summary.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>

                {/* Options */}
                <div className="space-y-2">
                  {tpl?.overlayImageDataUrl && (
                    <StudioSwitch
                      checked={includeOverlay}
                      label="Include imported graphic frame overlay"
                      description="Renders the transparent PNG/WebP/SVG frame live on canvas and in FFmpeg export."
                      onChange={setIncludeOverlay}
                    />
                  )}
                  {parsed.extractedFonts.length > 0 && (
                    <StudioSwitch
                      checked={registerBundledFonts}
                      label={`Auto-load ${parsed.extractedFonts.length} bundled font${parsed.extractedFonts.length === 1 ? '' : 's'}`}
                      description={parsed.extractedFonts.map((f) => f.family).join(', ')}
                      onChange={setRegisterBundledFonts}
                    />
                  )}
                  {parsed.extractedCaptionStyle && (
                    <StudioSwitch
                      checked={saveCaptionStyle}
                      label="Save extracted caption typography to Caption Styles"
                      description={`${parsed.extractedCaptionStyle.subtitleFont} · Active ${parsed.extractedCaptionStyle.activeColor}`}
                      onChange={setSaveCaptionStyle}
                    />
                  )}
                </div>

                {/* Compatibility Notes */}
                {parsed.warnings.length > 0 && (
                  <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-200 space-y-1">
                    {parsed.warnings.map((w, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {tpl?.overlayImageDataUrl && (
                  <div className="text-[11px] text-[var(--pc-muted)] flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>You can adjust overlay opacity, blend mode, or swap it anytime in Template Editor.</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-[var(--pc-muted)] truncate">
            {parsed
              ? 'Templates are saved locally and immediately available in Shorts Studio & Dashboard.'
              : 'All parsing runs 100% locally in your browser — no external upload required.'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {parsed && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="universal-import-finetune-btn"
                  onClick={() => handleConfirm(true)}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Import &amp; Fine-Tune</span>
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="universal-import-apply-btn"
                  onClick={() => handleConfirm(false)}
                >
                  <span>Import &amp; Apply</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
