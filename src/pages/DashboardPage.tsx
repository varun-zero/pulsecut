import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Clock,
  Film,
  Link2,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import type { JobItem } from '../types';
import { FEATURED_PRESETS, getTemplatePreset } from '../presets';
import { detectVideoSource, validateIngestInput } from '../lib/studioLogic';
import {
  Button,
  SegmentedControl,
  StudioSwitch,
  TemplateMiniPreview,
} from '../components/ui/Primitives';
import { InstagramIcon, KickLogoIcon, YouTubeShortsIcon } from '../components/ui/PlatformIcons';

interface DashboardPageProps {
  jobs: JobItem[];
  onCreateJob: (payload: {
    url: string;
    sourceTitle: string;
    streamerHandle?: string;
    platform: JobItem['platform'];
    template: string;
    maxClips: number;
    burnCaptions: boolean;
    localFile?: File;
  }) => Promise<boolean> | void;
  onRefreshJobs: () => void;
  onOpenClips: () => void;
}

export function DashboardPage({
  jobs,
  onCreateJob,
  onRefreshJobs,
  onOpenClips,
}: DashboardPageProps) {
  const [importMode, setImportMode] = useState<'link' | 'file'>('link');
  const [url, setUrl] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ file: File; name: string; sizeMb: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedTemplate, setSelectedTemplate] = useState<string>('kick-stream');
  const [userOverrodeTemplate, setUserOverrodeTemplate] = useState<boolean>(false);
  const [maxClips, setMaxClips] = useState<number>(6);
  const [burnCaptions, setBurnCaptions] = useState<boolean>(true);
  const [defaultsExpanded, setDefaultsExpanded] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const detected = useMemo(() => detectVideoSource(url), [url]);

  // Smart Ingest Auto-Detect: pre-select Kick Viral / Insta Reels / YT Shorts from URL
  // while still letting the creator manually override at any time.
  useEffect(() => {
    if (detected.valid && detected.suggestedTemplateId && !userOverrodeTemplate) {
      setSelectedTemplate(detected.suggestedTemplateId);
    }
  }, [detected.valid, detected.suggestedTemplateId, userOverrodeTemplate]);

  const activeJobsCount = jobs.filter(
    (j) =>
      j.status === 'queued' ||
      j.status === 'downloading' ||
      j.status === 'clipping' ||
      j.status === 'rendering'
  ).length;

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setUserOverrodeTemplate(false);
        setFormError(null);
      }
    } catch {
      // Clipboard read may be blocked in sandboxed browsers
    }
  };

  const handleFileChosen = (file: File | undefined) => {
    if (!file) return;
    setSelectedFile({
      file,
      name: file.name,
      sizeMb: (file.size / (1024 * 1024)).toFixed(1),
    });
    if (!localPath) {
      setLocalPath(file.name);
    }
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateIngestInput(
      importMode,
      url,
      localPath,
      selectedFile?.name || ''
    );
    if (!validation.valid) {
      setFormError(validation.error || 'Provide a valid video source.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const accepted = await onCreateJob({
        url: validation.target,
        sourceTitle: validation.detected?.estimatedTitle || validation.target,
        streamerHandle: validation.detected?.streamerHandle,
        platform: validation.detected?.platform || (importMode === 'file' ? 'Local' : 'Direct'),
        template: selectedTemplate,
        maxClips: Math.max(1, Math.min(20, maxClips || 6)),
        burnCaptions,
        localFile: importMode === 'file' ? selectedFile?.file : undefined,
      });
      if (accepted !== false) {
        if (importMode === 'link') {
          setUrl('');
        } else {
          setLocalPath('');
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const activePresetObj = getTemplatePreset(selectedTemplate);

  return (
    <main className="max-w-[1380px] mx-auto px-6 py-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--pc-ink)] m-0">
            Ingest Workspace
          </h1>
          <p className="text-[13px] text-[var(--pc-sub)] m-0 mt-1">
            Import a YouTube, Kick, Twitch, or Instagram URL — or drop a local recording — to detect highlights and build vertical shorts.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-[var(--pc-sub)] font-mono-tabular">
          <span>{jobs.length} total jobs</span>
          <span aria-hidden="true">·</span>
          <span>
            {activeJobsCount > 0 ? `${activeJobsCount} processing` : 'Pipeline idle'}
          </span>
        </div>
      </div>

      {/* Balanced 2-column above-the-fold layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.28fr)_minmax(340px,0.82fr)] gap-6 items-start">
        {/* LEFT COLUMN: Primary Ingest Zone */}
        <section
          aria-labelledby="ingest-heading"
          className="rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-[var(--pc-border)] flex flex-wrap items-center justify-between gap-3">
            <h2 id="ingest-heading" className="text-[15px] font-semibold text-[var(--pc-ink)] m-0">
              Create Shorts
            </h2>
            <SegmentedControl<'link' | 'file'>
              ariaLabel="Import source mode"
              size="sm"
              value={importMode}
              onChange={(mode) => {
                setImportMode(mode);
                setFormError(null);
              }}
              options={[
                {
                  value: 'link',
                  label: 'URL Link',
                  icon: <Link2 className="w-3.5 h-3.5 stroke-[1.75]" />,
                },
                {
                  value: 'file',
                  label: 'Local Video File',
                  icon: <Upload className="w-3.5 h-3.5 stroke-[1.75]" />,
                },
              ]}
            />
          </div>

          <form onSubmit={handleSubmit} noValidate className="p-6 space-y-6">
            {/* Source Input */}
            {importMode === 'link' ? (
              <div className="space-y-3">
                <label htmlFor="ingest-url-input" className="block text-xs font-medium text-[var(--pc-sub)]">
                  Stream or Video URL
                </label>
                <div className="relative flex items-center">
                  <Link2 className="w-4 h-4 text-[var(--pc-muted)] absolute left-3.5 pointer-events-none stroke-[1.75]" />
                  <input
                    id="ingest-url-input"
                    type="url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setUserOverrodeTemplate(false);
                      if (formError) setFormError(null);
                    }}
                    placeholder="https://youtube.com/watch?v=... or https://kick.com/... or https://instagram.com/reel/..."
                    className={`w-full h-11 pl-10 pr-24 rounded-lg bg-[var(--pc-surface-2)] border text-[13.5px] text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none transition-colors ${
                      formError
                        ? 'border-[var(--pc-error)]'
                        : 'border-[var(--pc-border)] focus:border-[var(--pc-accent)]'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="absolute right-2 h-7 px-2.5 rounded-md bg-[var(--pc-surface)] border border-[var(--pc-border)] text-[11.5px] font-medium text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <ClipboardPaste className="w-3 h-3 stroke-[1.75]" />
                    <span>Paste</span>
                  </button>
                </div>

                {/* Live URL Detection & Metadata Preview */}
                {url.trim().length > 0 && detected.valid && detected.platform && (
                  <div
                    data-testid="url-preview-card"
                    className={`rounded-lg border px-3.5 py-2.5 flex items-center justify-between gap-3 ${
                      detected.platform === 'Kick'
                        ? 'bg-[#0B0E0F] border-[#53FC18]/50'
                        : detected.platform === 'Instagram'
                          ? 'bg-[#19101A] border-[#E1306C]/45'
                          : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-9 h-9 rounded-md border grid place-items-center shrink-0 ${
                          detected.platform === 'Kick'
                            ? 'bg-[#0B0E0F] border-[#53FC18]/60 text-[#53FC18]'
                            : detected.platform === 'Instagram'
                              ? 'bg-[#1E1020] border-[#E1306C]/50 text-[#E1306C]'
                              : detected.suggestedTemplateId === 'yt-short'
                                ? 'bg-[#170C0E] border-[#FF0033]/50 text-[#FF0033]'
                                : 'bg-[var(--pc-surface)] border-[var(--pc-border)] text-[var(--pc-accent)]'
                        }`}
                      >
                        {detected.platform === 'Kick' ? (
                          <KickLogoIcon className="w-4 h-4 text-[#53FC18]" />
                        ) : detected.platform === 'Instagram' ? (
                          <InstagramIcon className="w-4 h-4 text-[#E1306C]" />
                        ) : detected.suggestedTemplateId === 'yt-short' ? (
                          <YouTubeShortsIcon className="w-4 h-4 text-[#FF0033]" />
                        ) : (
                          <Film className="w-4 h-4 stroke-[1.75]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className={`text-xs font-medium truncate ${detected.platform === 'Kick' || detected.platform === 'Instagram' ? 'text-white' : 'text-[var(--pc-ink)]'}`}>
                          {detected.estimatedTitle}
                        </div>
                        <div className="text-[11px] text-[var(--pc-sub)] font-mono-tabular flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span
                            className="font-semibold"
                            style={{
                              color:
                                detected.platform === 'Kick'
                                  ? '#53FC18'
                                  : detected.platform === 'Instagram'
                                    ? '#E1306C'
                                    : detected.suggestedTemplateId === 'yt-short'
                                      ? '#FF0033'
                                      : 'var(--pc-accent)',
                            }}
                          >
                            {detected.platform}
                          </span>
                          {detected.streamerHandle && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--pc-ink)]">
                                Streamer: {detected.streamerHandle.toUpperCase()}
                              </span>
                            </>
                          )}
                          {detected.suggestedTemplateId && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[var(--pc-ink)]">
                                Auto: {getTemplatePreset(detected.suggestedTemplateId).name}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-mono-tabular text-[var(--pc-sub)] shrink-0">
                      <Clock className="w-3 h-3 stroke-[1.75]" />
                      <span>{detected.estimatedDuration}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    handleFileChosen(e.dataTransfer.files?.[0]);
                  }}
                  className={`rounded-lg border border-dashed px-5 py-7 text-center cursor-pointer transition-colors ${
                    dragActive
                      ? 'border-[var(--pc-accent)] bg-[var(--pc-accent-soft)]'
                      : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)] hover:border-[var(--pc-muted)]'
                  }`}
                >
                  <Upload className="w-5 h-5 mx-auto text-[var(--pc-sub)] mb-2 stroke-[1.75]" />
                  <div className="text-[13px] font-medium text-[var(--pc-ink)]">
                    Drop a video recording here or click to browse
                  </div>
                  <div className="text-xs text-[var(--pc-muted)] mt-1">
                    Supports MP4, MOV, MKV, and WebM — opens in Framing Studio first, then Shorts Studio
                  </div>
                  {selectedFile && (
                    <div className="mt-2.5 text-xs font-mono-tabular text-[var(--pc-accent)]">
                      {selectedFile.name} · {selectedFile.sizeMb} MB
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  data-testid="local-video-file-input"
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleFileChosen(e.target.files?.[0])}
                />
                <input
                  type="text"
                  aria-label="Absolute local file path"
                  value={localPath}
                  onChange={(e) => {
                    setLocalPath(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Or paste an absolute file path for the local Rust backend (e.g. /recordings/stream.mp4)"
                  className="w-full h-10 px-3.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none focus:border-[var(--pc-accent)]"
                />
              </div>
            )}

            {formError && (
              <div
                role="alert"
                className="flex items-center gap-2 text-xs text-[var(--pc-error)] bg-[var(--pc-error)]/10 border border-[var(--pc-error)]/30 rounded-lg px-3 py-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 stroke-[1.75]" />
                <span>{formError}</span>
              </div>
            )}

            {/* Visual Template Preset Grid (Single Shared Registry) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--pc-sub)]">
                  Default Template Preset
                </span>
                <span className="text-xs text-[var(--pc-muted)] font-mono-tabular">
                  {activePresetObj.fullName}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FEATURED_PRESETS.map((preset) => {
                  const active = selectedTemplate === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setSelectedTemplate(preset.id);
                        setUserOverrodeTemplate(true);
                      }}
                      className={`p-2.5 rounded-lg border text-left flex items-center gap-2.5 cursor-pointer transition-colors duration-150 ${
                        active
                          ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                          : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:border-[var(--pc-muted)] hover:text-[var(--pc-ink)]'
                      }`}
                    >
                      <TemplateMiniPreview preset={preset} active={active} />
                      <div className="min-w-0">
                        <div className="text-xs font-medium leading-tight truncate text-[var(--pc-ink)]">
                          {preset.name}
                        </div>
                        <div className="text-[10.5px] text-[var(--pc-muted)] truncate mt-0.5 capitalize">
                          {preset.defaultLayout} · {preset.defaultSafeZone === 'youtube-shorts' ? 'YT Safe' : preset.defaultSafeZone === 'instagram-reels' ? 'IG Safe' : preset.category}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Collapsible Generation Defaults */}
            <div className="border-t border-[var(--pc-border)] pt-4">
              <button
                type="button"
                aria-expanded={defaultsExpanded}
                onClick={() => setDefaultsExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
              >
                {defaultsExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                <SlidersHorizontal className="w-3.5 h-3.5 stroke-[1.75]" />
                <span>Generation Defaults</span>
                <span className="text-[var(--pc-muted)] font-mono-tabular ml-1">
                  · {maxClips} clips · {burnCaptions ? 'Captions on' : 'Captions off'}
                </span>
              </button>

              {defaultsExpanded && (
                <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3.5 border-t border-[var(--pc-border-subtle)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <label htmlFor="max-clips-input" className="block text-xs font-medium text-[var(--pc-ink)]">
                        Max Clips
                      </label>
                      <span className="text-[11px] text-[var(--pc-muted)]">Top peak highlights (1–20)</span>
                    </div>
                    <input
                      id="max-clips-input"
                      type="number"
                      min={1}
                      max={20}
                      value={maxClips}
                      onChange={(e) => setMaxClips(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                      className="w-18 h-8 px-2.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] text-center outline-none focus:border-[var(--pc-accent)]"
                    />
                  </div>
                  <div className="flex items-center">
                    <div className="w-full">
                      <StudioSwitch
                        id="burn-captions-switch"
                        label="Burn Captions"
                        description="Word-synced karaoke subtitles"
                        checked={burnCaptions}
                        onChange={setBurnCaptions}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Primary CTA Row */}
            <div className="pt-1 flex items-center justify-between gap-4">
              <span className="text-xs text-[var(--pc-muted)]">
                {importMode === 'file' && selectedFile
                  ? 'Opens Section 1 (Framing Studio) to crop & frame, then hand off to Shorts Studio.'
                  : 'Queues real peak detection & vertical reframing on the PulseCut backend.'}
              </span>
              <Button type="submit" variant="primary" disabled={submitting}>
                <span>
                  {submitting
                    ? 'Submitting...'
                    : importMode === 'file' && selectedFile
                      ? 'Open in Framing Studio'
                      : 'Generate Shorts'}
                </span>
                <ArrowRight className="w-3.5 h-3.5 stroke-[2]" />
              </Button>
            </div>
          </form>
        </section>

        {/* RIGHT COLUMN: Live Job Queue & Recent Projects */}
        <section
          aria-labelledby="jobs-heading"
          className="rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-[var(--pc-border)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 id="jobs-heading" className="text-[15px] font-semibold text-[var(--pc-ink)] m-0">
                Tasks &amp; Jobs
              </h2>
              <span className="font-mono-tabular text-xs text-[var(--pc-muted)]">
                · {jobs.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {activeJobsCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono-tabular text-[var(--pc-accent)]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Live</span>
                </span>
              )}
              <button
                type="button"
                onClick={onRefreshJobs}
                aria-label="Refresh job queue"
                title="Refresh job queue"
                className="h-7 w-7 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 stroke-[1.75]" />
              </button>
            </div>
          </div>

          <div className="divide-y divide-[var(--pc-border-subtle)] max-h-[540px] overflow-y-auto studio-scroll">
            {jobs.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Film className="w-6 h-6 mx-auto text-[var(--pc-muted)] mb-2.5 stroke-[1.5]" />
                <div className="text-[13px] font-medium text-[var(--pc-ink)]">No ingest jobs yet</div>
                <p className="text-xs text-[var(--pc-sub)] mt-1 m-0">
                  Paste a real YouTube/Kick/Twitch URL or drop a local video file on the left to start your first clip job.
                </p>
              </div>
            ) : (
              jobs.map((job) => {
                const isBusy =
                  job.status === 'queued' ||
                  job.status === 'downloading' ||
                  job.status === 'clipping' ||
                  job.status === 'rendering';
                const preset = getTemplatePreset(job.template);

                return (
                  <div key={job.id} className="p-4 hover:bg-[var(--pc-surface-2)]/40 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[var(--pc-ink)] truncate">
                          {job.sourceTitle}
                        </div>
                        <div className="text-[11px] text-[var(--pc-muted)] font-mono-tabular flex items-center gap-1.5 mt-0.5 truncate">
                          <span>{job.platform}</span>
                          <span aria-hidden="true">·</span>
                          <span>{preset.name}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{job.url}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-mono-tabular shrink-0">
                        {isBusy ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 text-[var(--pc-accent)] animate-spin" />
                            <span className="text-[var(--pc-accent)] capitalize">{job.status}</span>
                          </>
                        ) : job.status === 'done' ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-[var(--pc-ok)]" />
                            <span className="text-[var(--pc-ok)]">Done</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="w-3.5 h-3.5 text-[var(--pc-error)]" />
                            <span className="text-[var(--pc-error)]">Failed</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 h-1 w-full rounded-full bg-[var(--pc-surface-2)] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          job.status === 'error'
                            ? 'bg-[var(--pc-error)]'
                            : job.status === 'done'
                              ? 'bg-[var(--pc-ok)]'
                              : 'bg-[var(--pc-accent)]'
                        }`}
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="text-[var(--pc-sub)] truncate">{job.message}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono-tabular text-[var(--pc-muted)]">
                          {job.progress}%
                        </span>
                        {job.status === 'done' && (
                          <button
                            type="button"
                            onClick={onOpenClips}
                            className="text-xs font-medium text-[var(--pc-ink)] hover:text-[var(--pc-accent)] inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer transition-colors"
                          >
                            <span>Open Clips</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
