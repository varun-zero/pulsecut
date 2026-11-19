import React from 'react';
import { HelpCircle, Moon, Sun, UserCheck } from 'lucide-react';
import type { BrandKit, PageId } from '../types';
import { BrandWordmark } from './ui/Primitives';

interface AppHeaderProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  clipCount: number;
  activeJobCount: number;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenShortcuts: () => void;
  onOpenBrandKit: () => void;
  brandKit: BrandKit;
}

export function AppHeader({
  page,
  onNavigate,
  clipCount,
  activeJobCount,
  theme,
  onToggleTheme,
  onOpenShortcuts,
  onOpenBrandKit,
  brandKit,
}: AppHeaderProps) {
  const navItems: { id: PageId; label: string; meta?: string }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      meta: activeJobCount > 0 ? String(activeJobCount) : undefined,
    },
    {
      id: 'clips',
      label: 'Clips',
      meta: clipCount > 0 ? String(clipCount) : undefined,
    },
    {
      id: 'editor',
      label: 'Editor',
    },
  ];

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-[var(--pc-border)] bg-[var(--pc-bg)]/90 backdrop-blur-md">
      <div className="max-w-[1380px] h-full mx-auto px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Single unified Brand Wordmark */}
        <BrandWordmark onClick={() => onNavigate('dashboard')} />

        {/* Zone 2: Clean single-line text navigation links */}
        <nav aria-label="Primary navigation" className="flex items-center gap-6">
          {navItems.map((item) => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(item.id)}
                className={`relative h-14 inline-flex items-center gap-1.5 text-[13.5px] font-medium whitespace-nowrap shrink-0 bg-transparent border-0 cursor-pointer transition-colors duration-150 ${
                  active
                    ? 'text-[var(--pc-ink)]'
                    : 'text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                }`}
              >
                <span>{item.label}</span>
                {item.meta && (
                  <span className="font-mono-tabular text-[11px] text-[var(--pc-muted)]">
                    {item.meta}
                  </span>
                )}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--pc-ink)]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Compact workspace utilities + Brand Kit */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenBrandKit}
            className="h-8 px-3 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface)] text-xs font-medium text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            title="Workspace Brand Kit"
          >
            <UserCheck className="w-3.5 h-3.5 stroke-[1.75]" />
            <span className="hidden sm:inline font-mono-tabular">
              {brandKit.handle || 'Brand Kit'}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="h-8 w-8 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:border-[var(--pc-muted)] grid place-items-center cursor-pointer transition-colors shrink-0"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 stroke-[1.75]" />
            ) : (
              <Moon className="w-4 h-4 stroke-[1.75]" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenShortcuts}
            aria-label="Keyboard shortcuts and version info"
            title="Keyboard shortcuts & about"
            className="h-8 w-8 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:border-[var(--pc-muted)] grid place-items-center cursor-pointer transition-colors shrink-0"
          >
            <HelpCircle className="w-4 h-4 stroke-[1.75]" />
          </button>
        </div>
      </div>
    </header>
  );
}
