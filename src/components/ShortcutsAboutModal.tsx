import React, { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Button } from './ui/Primitives';

const SHORTCUTS = [
  { action: 'Play / Pause preview', keys: 'Space / K' },
  { action: 'Shuttle reverse / forward', keys: 'J / L' },
  { action: 'Step backward / forward 1 frame', keys: '← / →' },
  { action: 'Step backward / forward 5 frames', keys: 'Shift + ← / →' },
  { action: 'Split clip at playhead (Razor)', keys: 'S' },
  { action: 'Add marker at playhead', keys: 'M' },
  { action: 'Set trim In / Out point', keys: 'I / O' },
  { action: 'Toggle Final Preview Lock', keys: 'Shift + L' },
  { action: 'Hide selected canvas overlay', keys: 'Delete' },
  { action: 'Undo / Redo edit', keys: 'Ctrl + Z / Ctrl + Y' },
];

export function ShortcutsAboutModal({
  open,
  onClose,
}: {
  open: boolean;
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
      aria-labelledby="shortcuts-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--pc-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-[var(--pc-sub)] stroke-[1.75]" />
            <h2 id="shortcuts-modal-title" className="text-sm font-semibold text-[var(--pc-ink)] m-0">
              Shortcuts &amp; About
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts dialog"
            className="h-7 w-7 rounded-md grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] cursor-pointer bg-transparent border-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 divide-y divide-[var(--pc-border-subtle)]">
          {SHORTCUTS.map((row) => (
            <div key={row.action} className="py-2.5 flex items-center justify-between gap-4">
              <span className="text-xs text-[var(--pc-sub)]">{row.action}</span>
              <kbd className="font-mono-tabular text-[11px] px-2 py-0.5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[var(--pc-ink)]">
                {row.keys}
              </kbd>
            </div>
          ))}
        </div>

        <div className="px-5 py-3.5 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between gap-3">
          <div className="text-[11px] text-[var(--pc-muted)] font-mono-tabular">
            PulseCut v0.1.0 · Local-first Stream Studio
          </div>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
