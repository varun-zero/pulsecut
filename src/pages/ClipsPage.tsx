import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Crop,
  Film,
  FilterX,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { BatchRestyleSettings, ClipItem, ClipStatusFilter, CustomFontEntry } from '../types';
import { getTemplatePreset } from '../presets';
import {
  filterClips,
  formatShortDuration,
  getClipsEmptyState,
} from '../lib/studioLogic';
import {
  Button,
  SegmentedControl,
  StudioCheckbox,
} from '../components/ui/Primitives';
import { BatchRestyleDrawer } from '../components/BatchRestyleDrawer';

interface ClipsPageProps {
  clips: ClipItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onClearSelection: () => void;
  onFrameClip: (id: string) => void;
  onEditClip: (id: string) => void;
  onApproveClips: (ids: string[]) => void;
  onRejectClips: (ids: string[]) => void;
  onDeleteClip: (id: string) => void;
  onCopyMetadata: (clip: ClipItem) => void;
  onBatchRestyle: (ids: string[], settings: BatchRestyleSettings) => Promise<void>;
  batchSettings: BatchRestyleSettings;
  customFonts: readonly CustomFontEntry[];
  onUploadCustomFont: (file: File) => void;
  onChangeBatchSettings: (next: BatchRestyleSettings) => void;
  onGoToDashboard: () => void;
}

export function ClipsPage({
  clips,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onFrameClip,
  onEditClip,
  onApproveClips,
  onRejectClips,
  onDeleteClip,
  onCopyMetadata,
  onBatchRestyle,
  batchSettings,
  customFonts,
  onUploadCustomFont,
  onChangeBatchSettings,
  onGoToDashboard,
}: ClipsPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ClipStatusFilter>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const filteredClips = useMemo(
    () => filterClips(clips, statusFilter, searchQuery),
    [clips, statusFilter, searchQuery]
  );

  const emptyState = getClipsEmptyState(clips.length, filteredClips.length);
  const readyCount = clips.filter((c) => c.status === 'Ready').length;
  const approvedCount = clips.filter((c) => c.status === 'Approved').length;

  const allVisibleSelected =
    filteredClips.length > 0 && filteredClips.every((c) => selectedIds.has(c.id));

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      onClearSelection();
    } else {
      onSelectAll(filteredClips.map((c) => c.id));
    }
  };

  const handleApplyBatch = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBatchBusy(true);
    try {
      await onBatchRestyle(ids, batchSettings);
      setDrawerOpen(false);
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <main className="max-w-[1380px] mx-auto px-6 py-7 pb-28">
      {/* Minimal Header & Triage Controls — Zero permanent finishing form clutter */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-[var(--pc-border)]">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--pc-ink)] m-0">
            Clips Library
          </h1>
          <div className="mt-1 text-xs text-[var(--pc-sub)] font-mono-tabular flex items-center gap-2 flex-wrap">
            <span>
              {clips.length} clip{clips.length === 1 ? '' : 's'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{readyCount} ready</span>
            <span aria-hidden="true">·</span>
            <span>{approvedCount} approved</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[var(--pc-muted)] absolute left-3 pointer-events-none stroke-[1.75]" />
            <input
              type="search"
              aria-label="Search clips"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, channel, tags..."
              className="h-9 w-56 sm:w-64 pl-8 pr-8 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none focus:border-[var(--pc-accent)]"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-[var(--pc-muted)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0.5 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Segmented Filter */}
          <SegmentedControl<ClipStatusFilter>
            ariaLabel="Filter clips by status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'Ready', label: 'Ready' },
              { value: 'Approved', label: 'Approved' },
              { value: 'Rejected', label: 'Rejected' },
            ]}
          />

          {/* Single Smart Select All / Clear Toggle (hidden when 0 clips) */}
          {clips.length > 0 && (
            <Button
              variant="secondary"
              size="md"
              onClick={handleToggleSelectAll}
              disabled={filteredClips.length === 0}
            >
              {allVisibleSelected ? 'Clear Selection' : 'Select All'}
            </Button>
          )}
        </div>
      </div>

      {/* Smart Empty States vs. Full-Viewport 9:16 Clip Grid */}
      {emptyState === 'empty-library' ? (
        <div
          data-testid="clips-empty-library"
          className="mt-10 rounded-xl border border-dashed border-[var(--pc-border)] bg-[var(--pc-surface)]/50 px-6 py-20 text-center max-w-xl mx-auto"
        >
          <div className="w-12 h-12 rounded-xl bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center mx-auto mb-4 text-[var(--pc-sub)]">
            <Film className="w-5 h-5 stroke-[1.75]" />
          </div>
          <h2 className="text-base font-semibold text-[var(--pc-ink)] m-0">
            No clips generated yet
          </h2>
          <p className="text-[13px] text-[var(--pc-sub)] mt-1.5 mb-5 max-w-sm mx-auto">
            Import a live stream URL or local recording from the Dashboard to automatically detect highlight moments.
          </p>
          <Button variant="primary" onClick={onGoToDashboard}>
            <Plus className="w-3.5 h-3.5 stroke-[2]" />
            <span>Import a Video on Dashboard</span>
          </Button>
        </div>
      ) : emptyState === 'no-filter-matches' ? (
        <div
          data-testid="clips-empty-filters"
          className="mt-10 rounded-xl border border-dashed border-[var(--pc-border)] bg-[var(--pc-surface)]/50 px-6 py-16 text-center max-w-lg mx-auto"
        >
          <FilterX className="w-6 h-6 mx-auto text-[var(--pc-muted)] mb-3 stroke-[1.75]" />
          <h2 className="text-[15px] font-semibold text-[var(--pc-ink)] m-0">
            No clips match your current filters
          </h2>
          <p className="text-xs text-[var(--pc-sub)] mt-1 mb-4">
            Try clearing your search query or switching back to all clip statuses.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
            }}
          >
            Reset Filters
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredClips.map((clip) => {
            const isSelected = selectedIds.has(clip.id);
            const preset = getTemplatePreset(clip.template);
            const scorePct = Math.round(clip.confidence * 100);

            return (
              <article
                key={clip.id}
                onClick={() => onToggleSelect(clip.id)}
                className={`group rounded-xl bg-[var(--pc-surface)] border overflow-hidden transition-colors duration-150 cursor-pointer flex flex-col ${
                  isSelected
                    ? 'border-[var(--pc-accent)] ring-1 ring-[var(--pc-accent)]'
                    : 'border-[var(--pc-border)] hover:border-[var(--pc-muted)]'
                }`}
              >
                {/* 9:16 Visual Stage Thumbnail */}
                <div className="relative aspect-[9/14] bg-[#0B0B0D] overflow-hidden border-b border-[var(--pc-border)]">
                  {clip.previewImage ? (
                    <img
                      src={clip.previewImage}
                      alt={clip.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  ) : clip.mediaUrl ? (
                    <video
                      src={clip.mediaUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-b from-[#17171B] to-[#0D0D10] grid place-items-center text-[var(--pc-muted)]">
                      <Film className="w-8 h-8 stroke-[1.5]" />
                    </div>
                  )}

                  {/* Measured Bottom Contrast Scrim */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/85 via-black/45 to-transparent pointer-events-none"
                  />

                  {/* Top-Left Custom Selection Checkbox */}
                  <div className="absolute top-3 left-3 z-10">
                    <StudioCheckbox
                      checked={isSelected}
                      onChange={() => onToggleSelect(clip.id)}
                      ariaLabel={`Select clip ${clip.title}`}
                    />
                  </div>

                  {/* Quick Open Overlay Trigger on Hover */}
                  <button
                    type="button"
                    aria-label={`Open ${clip.title} in Shorts Studio`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditClip(clip.id);
                    }}
                    className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25 transition-colors border-0 cursor-pointer"
                  >
                    <span className="h-10 w-10 rounded-full bg-white/90 text-black grid place-items-center opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100 transition-all duration-150 shadow-md">
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </span>
                  </button>

                  {/* Unboxed Tabular Bottom Stage Info */}
                  <div className="absolute inset-x-3 bottom-2.5 flex items-center justify-between text-[11px] font-mono-tabular text-white/90 pointer-events-none">
                    <span>{preset.name}</span>
                    <span>
                      {formatShortDuration(clip.duration_sec)} · {clip.aspect}
                    </span>
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-4 flex-1 flex flex-col">
                  {/* Quiet unboxed metadata kicker */}
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular mb-1.5">
                    <span
                      className={`font-medium ${
                        clip.status === 'Approved'
                          ? 'text-[var(--pc-ok)]'
                          : clip.status === 'Rejected'
                            ? 'text-[var(--pc-error)]'
                            : 'text-[var(--pc-sub)]'
                      }`}
                    >
                      {clip.status}
                    </span>
                    <span className="text-[var(--pc-muted)]">
                      {clip.channel} · Peak {scorePct}%
                    </span>
                  </div>

                  <h3 className="text-[13.5px] font-semibold text-[var(--pc-ink)] leading-snug line-clamp-2 m-0">
                    {clip.title}
                  </h3>

                  {clip.transcript_snippet.trim() ? (
                    <p className="text-xs text-[var(--pc-sub)] line-clamp-2 mt-1.5 mb-3.5 flex-1">
                      “{clip.transcript_snippet}”
                    </p>
                  ) : clip.description.trim() ? (
                    <p className="text-xs text-[var(--pc-sub)] line-clamp-2 mt-1.5 mb-3.5 flex-1">
                      {clip.description}
                    </p>
                  ) : (
                    <div className="flex-1 mb-3.5" />
                  )}

                  {/* Triage Action Strip */}
                  <div
                    className="pt-3 border-t border-[var(--pc-border-subtle)] flex items-center justify-between gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Frame ${clip.title}`}
                        onClick={() => onFrameClip(clip.id)}
                      >
                        <Crop className="w-3.5 h-3.5 stroke-[1.75]" />
                        <span>Frame</span>
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        aria-label={`Make short for ${clip.title}`}
                        onClick={() => onEditClip(clip.id)}
                      >
                        Short
                      </Button>
                      <button
                        type="button"
                        aria-label={`Approve ${clip.title}`}
                        title="Approve clip"
                        onClick={() => onApproveClips([clip.id])}
                        className="h-8 w-8 rounded-md text-[var(--pc-sub)] hover:text-[var(--pc-ok)] hover:bg-[var(--pc-ok)]/10 grid place-items-center bg-transparent border-0 cursor-pointer transition-colors"
                      >
                        <Check className="w-3.5 h-3.5 stroke-[2]" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Reject ${clip.title}`}
                        title="Reject clip"
                        onClick={() => onRejectClips([clip.id])}
                        className="h-8 w-8 rounded-md text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] grid place-items-center bg-transparent border-0 cursor-pointer transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Copy metadata for ${clip.title}`}
                        title="Copy title & hashtags"
                        onClick={() => onCopyMetadata(clip)}
                        className="h-8 w-8 rounded-md text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] grid place-items-center bg-transparent border-0 cursor-pointer transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${clip.title}`}
                        title="Delete clip"
                        onClick={() => onDeleteClip(clip.id)}
                        className="h-8 w-8 rounded-md text-[var(--pc-sub)] hover:text-[var(--pc-error)] hover:bg-[var(--pc-error)]/10 grid place-items-center bg-transparent border-0 cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Contextual Floating Batch Action Bar — ONLY visible when >= 1 clip is selected */}
      {selectedIds.size > 0 && (
        <div
          role="region"
          aria-label="Batch clip actions"
          data-testid="floating-batch-bar"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-3 py-2 rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl flex items-center gap-2"
        >
          <span className="font-mono-tabular text-xs font-medium text-[var(--pc-ink)] px-2">
            {selectedIds.size} selected
          </span>
          <span aria-hidden="true" className="w-px h-5 bg-[var(--pc-border)]" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onApproveClips([...selectedIds])}
          >
            <Check className="w-3.5 h-3.5 stroke-[2]" />
            <span>Approve</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRejectClips([...selectedIds])}
          >
            <X className="w-3.5 h-3.5" />
            <span>Reject</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setDrawerOpen(true)}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 stroke-[1.75]" />
            <span>Batch Restyle</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClearSelection}>
            Clear
          </Button>
        </div>
      )}

      {/* Contextual Slide-Over Batch Restyle Drawer */}
      <BatchRestyleDrawer
        open={drawerOpen}
        selectedCount={selectedIds.size}
        settings={batchSettings}
        customFonts={customFonts}
        onUploadCustomFont={onUploadCustomFont}
        onChange={onChangeBatchSettings}
        onApply={handleApplyBatch}
        onClose={() => setDrawerOpen(false)}
        busy={batchBusy}
      />
    </main>
  );
}
