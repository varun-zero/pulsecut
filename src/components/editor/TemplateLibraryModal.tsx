import React, { useEffect, useMemo, useState } from 'react';
import { FolderUp, LayoutTemplate, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { TEMPLATE_CATEGORIES, TEMPLATE_PRESETS, type TemplateCategory } from '../../presets';
import type { EditableTemplatePreset } from '../../lib/creatorCatalog';
import { Button, TemplateMiniPreview } from '../ui/Primitives';

interface TemplateLibraryModalProps {
  open: boolean;
  templates?: readonly EditableTemplatePreset[];
  activeTemplateId: string;
  canRestoreDefaults?: boolean;
  onSelect: (preset: EditableTemplatePreset) => void;
  onCreateNew?: () => void;
  onOpenImport?: () => void;
  onEdit?: (preset: EditableTemplatePreset) => void;
  onDelete?: (id: string) => void;
  onRestoreDefaults?: () => void;
  onClose: () => void;
}

export function TemplateLibraryModal({
  open,
  templates = TEMPLATE_PRESETS,
  activeTemplateId,
  canRestoreDefaults = false,
  onSelect,
  onCreateNew,
  onOpenImport,
  onEdit,
  onDelete,
  onRestoreDefaults,
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
    return templates.filter((preset) => {
      if (category !== 'All' && preset.category !== category) return false;
      if (!q) return true;
      return `${preset.name} ${preset.fullName} ${preset.description} ${preset.category}`
        .toLowerCase()
        .includes(q);
    });
  }, [templates, category, query]);

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
                {templates.length} active templates — click to apply, edit aspect/caption placement, or delete.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canRestoreDefaults && onRestoreDefaults && (
              <Button variant="ghost" size="sm" onClick={onRestoreDefaults}>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore Built-ins</span>
              </Button>
            )}
            {onOpenImport && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="library-import-template-btn"
                onClick={() => {
                  onClose();
                  onOpenImport();
                }}
              >
                <FolderUp className="w-3.5 h-3.5" />
                <span>Import</span>
              </Button>
            )}
            {onCreateNew && (
              <Button
                variant="primary"
                size="sm"
                data-testid="library-new-template-btn"
                onClick={() => {
                  onClose();
                  onCreateNew();
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Template</span>
              </Button>
            )}
            <button
              type="button"
              aria-label="Close template library"
              onClick={onClose}
              className="h-8 w-8 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] bg-transparent border-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
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

        {/* Grid (sibling action buttons — zero nested <button> tags) */}
        <div className="flex-1 overflow-y-auto studio-scroll p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filtered.map((preset) => {
            const active = preset.id === activeTemplateId;
            return (
              <div
                key={preset.id}
                className={`rounded-xl border flex flex-col justify-between transition-colors ${
                  active
                    ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)]'
                    : 'bg-[var(--pc-surface-2)]/60 border-[var(--pc-border)] hover:border-[var(--pc-muted)]'
                }`}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onSelect(preset);
                    onClose();
                  }}
                  className="p-3.5 pb-2 text-left flex items-start gap-3.5 cursor-pointer bg-transparent border-0 w-full"
                >
                  <TemplateMiniPreview preset={preset} active={active} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[var(--pc-ink)] truncate">
                      {preset.fullName}
                    </div>
                    <div className="text-[11px] font-mono-tabular text-[var(--pc-muted)] mt-0.5 truncate">
                      {preset.defaultAspect || '9:16'} ·{' '}
                      {preset.defaultFullScreen ? 'Full Screen' : preset.defaultLayout}
                      {preset.isCustom ? ' · Custom' : ''}
                    </div>
                    <p className="text-xs text-[var(--pc-sub)] mt-1.5 mb-0 line-clamp-2 leading-relaxed">
                      {preset.description}
                    </p>
                  </div>
                </button>

                <div className="px-3.5 py-2 border-t border-[var(--pc-border-subtle)] flex items-center justify-between gap-2">
                  <span className="text-[10.5px] text-[var(--pc-muted)] truncate">
                    {preset.sourceFormatLabel ? `${preset.sourceFormatLabel} · ` : ''}
                    {preset.category}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {onEdit && (
                      <button
                        type="button"
                        aria-label={`Edit ${preset.name}`}
                        onClick={() => {
                          onClose();
                          onEdit(preset);
                        }}
                        className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[11px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                    )}
                    {onDelete && templates.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Delete ${preset.name}`}
                        onClick={() => onDelete(preset.id)}
                        className="h-6 w-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[var(--pc-sub)] hover:text-[var(--pc-error)] grid place-items-center cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between shrink-0">
          <span className="text-xs text-[var(--pc-muted)]">
            Selecting a template updates framing, aspect ratio, caption style, and layout automatically.
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
