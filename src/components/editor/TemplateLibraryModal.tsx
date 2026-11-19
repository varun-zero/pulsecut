import React, { useEffect, useMemo, useState } from 'react';
import { LayoutTemplate, Search, X } from 'lucide-react';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_PRESETS,
  type TemplateCategory,
  type TemplatePreset,
} from '../../presets';
import { Button, TemplateMiniPreview } from '../ui/Primitives';

interface TemplateLibraryModalProps {
  open: boolean;
  activeTemplateId: string;
  onSelect: (preset: TemplatePreset) => void;
  onClose: () => void;
}

export function TemplateLibraryModal({
  open,
  activeTemplateId,
  onSelect,
  onClose,
}: TemplateLibraryModalProps) {
  const [category, setCategory] = useState<TemplateCategory>('All');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATE_PRESETS.filter((preset) => {
      if (category !== 'All' && preset.category !== category) return false;
      if (!q) return true;
      return `${preset.name} ${preset.fullName} ${preset.description} ${preset.category}`
        .toLowerCase()
        .includes(q);
    });
  }, [category, query]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-library-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[84vh] rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--pc-border)] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <LayoutTemplate className="w-4 h-4 text-[var(--pc-accent)] stroke-[1.75]" />
            <div>
              <h2 id="tpl-library-title" className="text-sm font-semibold text-[var(--pc-ink)] m-0">
                Template Library
              </h2>
              <p className="text-xs text-[var(--pc-sub)] m-0 mt-0.5">
                {TEMPLATE_PRESETS.length} whole-video treatments with precalibrated framing, safe zones, and captions.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close template library"
            onClick={onClose}
            className="h-8 w-8 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] bg-transparent border-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Tabs & Search */}
        <div className="px-5 py-3 border-b border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {TEMPLATE_CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`h-7 px-3 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--pc-cta-bg)] text-[var(--pc-cta-fg)] border border-transparent'
                      : 'bg-transparent text-[var(--pc-sub)] border border-transparent hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface)]'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[var(--pc-muted)] absolute left-2.5 pointer-events-none" />
            <input
              type="search"
              aria-label="Search templates"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter templates..."
              className="h-8 w-52 pl-8 pr-3 rounded-md bg-[var(--pc-surface)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto studio-scroll p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filtered.map((preset) => {
            const active = preset.id === activeTemplateId;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSelect(preset);
                  onClose();
                }}
                className={`p-3.5 rounded-xl border text-left flex items-start gap-3.5 cursor-pointer transition-colors ${
                  active
                    ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)]'
                    : 'bg-[var(--pc-surface-2)]/60 border-[var(--pc-border)] hover:border-[var(--pc-muted)]'
                }`}
              >
                <TemplateMiniPreview preset={preset} active={active} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[var(--pc-ink)] truncate">
                      {preset.fullName}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono-tabular text-[var(--pc-muted)] mt-0.5">
                    {preset.category} · {preset.defaultLayout}
                  </div>
                  <p className="text-xs text-[var(--pc-sub)] mt-1.5 mb-0 line-clamp-2 leading-relaxed">
                    {preset.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between shrink-0">
          <span className="text-xs text-[var(--pc-muted)]">
            Selecting a template updates framing, caption style, and layout automatically.
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
