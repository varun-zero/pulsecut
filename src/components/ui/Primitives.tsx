import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Upload } from 'lucide-react';
import type { TemplatePreset } from '../../presets';
import {
  VIRAL_CAPTION_PRESETS,
  VIRAL_FONTS,
  getViralFont,
  type ViralCaptionPreset,
} from '../../captionStyles';
import type { CustomFontEntry, ViralCaptionPresetId } from '../../types';

/* -------------------------------------------------------------------------- */
/* Unified Locked Brand Wordmark                                               */
/* -------------------------------------------------------------------------- */

export function BrandWordmark({
  onClick,
  compact = false,
}: {
  onClick?: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-brand inline-flex items-baseline tracking-tight text-[var(--pc-ink)] whitespace-nowrap shrink-0 cursor-pointer bg-transparent border-0 p-0 transition-opacity duration-150 hover:opacity-85 ${
        compact ? 'text-[19px]' : 'text-[22px]'
      }`}
      aria-label="PulseCut Home"
    >
      <span className="font-semibold">Pulse</span>
      <em className="italic font-normal text-[var(--pc-sub)]">Cut</em>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap shrink-0 rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 text-[13px]',
  };
  const variants = {
    primary:
      'bg-[var(--pc-cta-bg)] text-[var(--pc-cta-fg)] border border-transparent hover:opacity-90',
    secondary:
      'bg-[var(--pc-surface-2)] text-[var(--pc-ink)] border border-[var(--pc-border)] hover:bg-[var(--pc-surface-hover)]',
    ghost:
      'bg-transparent text-[var(--pc-sub)] border border-transparent hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)]',
    danger:
      'bg-transparent text-[var(--pc-error)] border border-[var(--pc-border)] hover:bg-[var(--pc-error)]/10 hover:border-[var(--pc-error)]/40',
  };

  return (
    <button
      type={type}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented Control (2–4 options)                                             */
/* -------------------------------------------------------------------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  fullWidth = false,
  size = 'md',
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-center p-0.5 rounded-lg bg-[var(--pc-bg)] border border-[var(--pc-border)] ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer ${
              fullWidth ? 'flex-1' : 'shrink-0'
            } ${size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-xs'} ${
              active
                ? 'bg-[var(--pc-surface)] dark:bg-[var(--pc-surface-hover)] text-[var(--pc-ink)] shadow-xs border border-[var(--pc-border)]'
                : 'text-[var(--pc-sub)] border border-transparent hover:text-[var(--pc-ink)]'
            }`}
          >
            {opt.icon}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom Studio Slider (replaces raw browser blue range inputs)               */
/* -------------------------------------------------------------------------- */

export function StudioSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  valueLabel,
  onChange,
  id,
  compact = false,
}: {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  valueLabel?: string;
  onChange: (next: number) => void;
  id?: string;
  compact?: boolean;
}) {
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  const displayVal = valueLabel ?? `${value}${unit}`;

  return (
    <div className={compact ? 'flex items-center gap-2.5' : 'space-y-1.5'}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-xs text-[var(--pc-sub)]">
            {label}
          </label>
          <span className="font-mono-tabular text-[11px] text-[var(--pc-ink)] bg-[var(--pc-surface-2)] border border-[var(--pc-border)] rounded px-1.5 py-0.5">
            {displayVal}
          </span>
        </div>
      )}
      <div className="relative flex items-center h-5 flex-1 min-w-[72px]">
        <div className="w-full h-1 rounded-full bg-[var(--pc-surface-hover)] overflow-hidden pointer-events-none">
          <div
            className="h-full bg-[var(--pc-accent)] rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[var(--pc-ink)] border-2 border-[var(--pc-surface)] shadow-xs pointer-events-none"
          style={{ left: `${pct}%` }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label || 'Slider'}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0"
        />
      </div>
      {!label && (
        <span className="font-mono-tabular text-[11px] text-[var(--pc-sub)] min-w-[38px] text-right">
          {displayVal}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom Switch (accessible role="switch")                                    */
/* -------------------------------------------------------------------------- */

export function StudioSwitch({
  checked,
  onChange,
  label,
  description,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  id?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label
          htmlFor={id}
          onClick={id ? undefined : () => onChange(!checked)}
          className="text-xs font-medium text-[var(--pc-ink)] cursor-pointer select-none block"
        >
          {label}
        </label>
        {description && (
          <p className="text-[11px] text-[var(--pc-muted)] m-0 mt-0.5">{description}</p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer ${
          checked
            ? 'bg-[var(--pc-accent)] border-transparent'
            : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)]'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150 ${
            checked
              ? 'translate-x-[18px] bg-white'
              : 'translate-x-[3px] bg-[var(--pc-sub)]'
          }`}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom Checkbox                                                             */
/* -------------------------------------------------------------------------- */

export function StudioCheckbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`h-5 w-5 rounded-md border flex items-center justify-center transition-colors duration-150 cursor-pointer ${
        checked
          ? 'bg-[var(--pc-accent)] border-[var(--pc-accent)] text-white'
          : 'bg-[var(--pc-surface)]/90 border-[var(--pc-border)] text-transparent hover:border-[var(--pc-sub)]'
      }`}
    >
      <Check className="w-3.5 h-3.5 stroke-[2.25]" />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Custom Select Dropdown (replaces native browser <select>)                   */
/* -------------------------------------------------------------------------- */

export function StudioSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label?: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      {label && <span className="block text-xs text-[var(--pc-sub)]">{label}</span>}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || label || 'Select option'}
        onClick={() => setOpen((v) => !v)}
        className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] flex items-center justify-between gap-2 hover:border-[var(--pc-muted)] transition-colors duration-150 cursor-pointer"
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--pc-sub)] shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-1 py-1 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-lg z-50 max-h-56 overflow-y-auto studio-scroll"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                  active
                    ? 'bg-[var(--pc-accent-soft)] text-[var(--pc-ink)] font-medium'
                    : 'text-[var(--pc-sub)] hover:bg-[var(--pc-surface-2)] hover:text-[var(--pc-ink)]'
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {active && <Check className="w-3.5 h-3.5 text-[var(--pc-accent)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Collapsible Inspector Accordion (ChevronDown / ChevronRight)                */
/* -------------------------------------------------------------------------- */

export function InspectorAccordion({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--pc-border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full py-3 px-4 flex items-center justify-between gap-2 text-left bg-transparent border-0 cursor-pointer hover:bg-[var(--pc-surface-2)]/60 transition-colors"
      >
        <span className="text-[13px] font-semibold text-[var(--pc-ink)] truncate">{title}</span>
        <span className="inline-flex items-center gap-2 shrink-0">
          {badge && (
            <span className="font-mono-tabular text-[11px] px-1.5 py-0.5 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[var(--pc-sub)]">
              {badge}
            </span>
          )}
          {open ? (
            <ChevronDown className="w-4 h-4 text-[var(--pc-sub)] shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-[var(--pc-sub)] shrink-0" />
          )}
        </span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3.5">{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Visual Miniature Template Wireframe                                         */
/* -------------------------------------------------------------------------- */

export function TemplateMiniPreview({
  preset,
  active = false,
}: {
  preset: TemplatePreset;
  active?: boolean;
}) {
  if (preset.wireframe === 'kick') {
    return (
      <div
        className="w-8 h-12 rounded-[5px] border p-1 flex flex-col justify-between shrink-0 overflow-hidden bg-[#121417]"
        style={{
          borderColor: active ? '#53FC18' : 'rgba(83, 252, 24, 0.5)',
          boxShadow: active ? '0 0 8px rgba(83, 252, 24, 0.24)' : 'none',
        }}
        aria-hidden="true"
      >
        {/* Stepped white native viral hook lines */}
        <div className="space-y-[2px] mt-0.5 flex flex-col items-center">
          <div className="h-[3.5px] w-full rounded-[1.5px] bg-white" />
          <div className="h-[3.5px] w-4/5 rounded-[1.5px] bg-white" />
        </div>
        <div className="flex-1" />
        {/* Bottom small K logo + streamer name */}
        <div className="flex items-center justify-center gap-0.5 pb-0.5">
          <span className="text-[7px] font-black leading-none text-[#53FC18]">K</span>
          <span className="h-[3px] w-3.5 rounded-xs bg-white/90" />
        </div>
      </div>
    );
  }

  if (preset.wireframe === 'insta') {
    return (
      <div
        className="w-8 h-12 rounded-[5px] border p-1 flex flex-col justify-between shrink-0 overflow-hidden bg-gradient-to-b from-[#1E1524] via-[#131318] to-[#1D1220]"
        style={{
          borderColor: active ? '#E1306C' : 'rgba(225, 48, 108, 0.45)',
        }}
        aria-hidden="true"
      >
        <div className="space-y-[2px] mt-0.5 flex flex-col items-center">
          <div className="h-[3.5px] w-full rounded-[1.5px] bg-white" />
          <div className="h-[3.5px] w-3/4 rounded-[1.5px] bg-white" />
        </div>
        <div className="flex-1" />
        <div className="flex items-center justify-center gap-0.5 pb-0.5">
          <span className="w-2 h-2 rounded-[2px] border border-[#E1306C] shrink-0" />
          <span className="h-[3px] w-3.5 rounded-xs bg-white/85" />
        </div>
      </div>
    );
  }

  if (preset.wireframe === 'yt-short') {
    return (
      <div
        className="w-8 h-12 rounded-[5px] border p-1 flex flex-col justify-between shrink-0 overflow-hidden bg-[#141012]"
        style={{
          borderColor: active ? '#FF0033' : 'rgba(255, 0, 51, 0.48)',
        }}
        aria-hidden="true"
      >
        <div className="space-y-[2px] mt-0.5 flex flex-col items-center">
          <div className="h-[3.5px] w-full rounded-[1.5px] bg-white" />
          <div className="h-[3.5px] w-4/5 rounded-[1.5px] bg-white" />
        </div>
        <div className="h-1.5 w-4/5 mx-auto rounded-xs bg-[#FFE600]" />
        <div className="flex items-center justify-center gap-0.5 pb-0.5">
          <span className="w-2 h-2 rounded-[2px] bg-[#FF0033] shrink-0" />
          <span className="h-[3px] w-3.5 rounded-xs bg-white/85" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-8 h-12 rounded-[5px] border p-1 flex flex-col justify-between shrink-0 overflow-hidden transition-colors ${
        active
          ? 'bg-[var(--pc-bg)] border-[var(--pc-accent)]'
          : 'bg-[var(--pc-bg)] border-[var(--pc-border)]'
      }`}
      aria-hidden="true"
    >
      {/* Top headline or social header bar */}
      {preset.wireframe === 'social' ? (
        <div className="flex items-center gap-0.5 bg-white/90 rounded-[2px] p-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
          <span className="h-1 flex-1 rounded-xs bg-zinc-500" />
        </div>
      ) : preset.wireframe === 'story' ? (
        <div className="space-y-[2px] flex flex-col items-center">
          <div className="h-[3.5px] w-full rounded-[1.5px] bg-white" />
          <div className="h-[3.5px] w-3/4 rounded-[1.5px] bg-white" />
        </div>
      ) : preset.hasHeadline ? (
        <div
          className="h-1.5 w-full rounded-xs opacity-90"
          style={{ backgroundColor: preset.accentHex }}
        />
      ) : (
        <div className="h-1" />
      )}

      {/* Middle video layout geometry */}
      {preset.wireframe === 'split' ? (
        <div className="flex-1 my-0.5 flex flex-col gap-0.5">
          <div className="flex-1 rounded-[2px] bg-[var(--pc-surface-hover)]" />
          <div className="flex-1 rounded-[2px] bg-[var(--pc-surface-hover)]" />
        </div>
      ) : preset.wireframe === 'pip' ? (
        <div className="flex-1 my-0.5 rounded-[2px] bg-[var(--pc-surface-hover)] relative">
          <span
            className="absolute bottom-0.5 right-0.5 w-2.5 h-2 rounded-[1px] border border-[var(--pc-bg)]"
            style={{ backgroundColor: preset.accentHex }}
          />
        </div>
      ) : preset.wireframe === 'podcast' ? (
        <div className="flex-1 my-0.5 rounded-[2px] bg-[var(--pc-surface-hover)] flex items-end justify-center pb-1">
          <span className="h-1.5 w-4 rounded-xs bg-blue-500" />
        </div>
      ) : (
        <div className="flex-1 my-0.5 rounded-[2px] bg-[var(--pc-surface-hover)]" />
      )}

      {/* Bottom caption line */}
      <div className="h-1 w-4/5 mx-auto rounded-xs bg-[var(--pc-ink)]/75" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Viral Font Selector (Live Typeface Preview + Custom .ttf/.otf Upload)       */
/* -------------------------------------------------------------------------- */

export function ViralFontSelect({
  label,
  value,
  customFonts,
  onChange,
  onUploadCustomFont,
  ariaLabel,
}: {
  label?: string;
  value: string;
  customFonts: readonly CustomFontEntry[];
  onChange: (fontFamily: string) => void;
  onUploadCustomFont: (file: File) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const currentMeta = getViralFont(value, customFonts);

  const handleToggleOpen = () => {
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setOpenUpward(window.innerHeight - rect.bottom < 300);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      {label && <span className="block text-xs text-[var(--pc-sub)]">{label}</span>}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || label || 'Select viral font'}
        onClick={handleToggleOpen}
        className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[var(--pc-ink)] flex items-center justify-between gap-2 hover:border-[var(--pc-muted)] transition-colors duration-150 cursor-pointer"
      >
        <span
          className="truncate text-[13px]"
          style={{
            fontFamily: currentMeta.cssFamily,
            fontWeight: currentMeta.defaultWeight,
            fontStyle: currentMeta.italic ? 'italic' : 'normal',
          }}
        >
          {currentMeta.family}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono-tabular text-[var(--pc-muted)]">
            {currentMeta.category}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-[var(--pc-sub)] transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf,.woff2"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onUploadCustomFont(file);
            setOpen(false);
          }
          e.target.value = '';
        }}
      />

      {open && (
        <div
          role="listbox"
          aria-label={`${label || 'Font'} choices`}
          className={`absolute left-0 right-0 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl z-50 overflow-hidden ${
            openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1'
          }`}
        >
          <div className="max-h-60 overflow-y-auto studio-scroll py-1">
            {customFonts.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] font-mono-tabular text-[var(--pc-muted)]">
                  Uploaded Custom Fonts
                </div>
                {customFonts.map((cf) => {
                  const active = cf.family === value;
                  return (
                    <button
                      key={cf.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(cf.family);
                        setOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                        active
                          ? 'bg-[var(--pc-accent-soft)] text-[var(--pc-ink)]'
                          : 'text-[var(--pc-sub)] hover:bg-[var(--pc-surface-2)] hover:text-[var(--pc-ink)]'
                      }`}
                    >
                      <span
                        className="text-[13px] truncate"
                        style={{ fontFamily: `"${cf.family}", sans-serif`, fontWeight: 800 }}
                      >
                        {cf.family}
                      </span>
                      <span className="text-[10px] font-mono-tabular text-[var(--pc-accent)] shrink-0">
                        Custom
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {VIRAL_FONTS.map((font) => {
              const active = font.family.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={font.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(font.family);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--pc-accent-soft)] text-[var(--pc-ink)]'
                      : 'text-[var(--pc-sub)] hover:bg-[var(--pc-surface-2)] hover:text-[var(--pc-ink)]'
                  }`}
                >
                  <span
                    className="text-[13.5px] truncate leading-tight"
                    style={{
                      fontFamily: font.cssFamily,
                      fontWeight: font.defaultWeight,
                      fontStyle: font.italic ? 'italic' : 'normal',
                    }}
                  >
                    {font.family}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-mono-tabular text-[var(--pc-muted)]">
                      {font.category}
                    </span>
                    {active && <Check className="w-3.5 h-3.5 text-[var(--pc-accent)]" />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-1.5 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/70">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full h-8 px-2.5 rounded-md bg-[var(--pc-surface)] border border-dashed border-[var(--pc-border)] hover:border-[var(--pc-accent)] text-[11.5px] font-medium text-[var(--pc-ink)] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-[var(--pc-accent)]" />
              <span>+ Upload Custom Font (.ttf / .otf)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One-Click Viral Caption Preset Visual Cards                                 */
/* -------------------------------------------------------------------------- */

export function ViralCaptionPresetCards({
  activeId,
  onSelect,
  columns = 2,
}: {
  activeId: ViralCaptionPresetId;
  onSelect: (preset: ViralCaptionPreset) => void;
  columns?: 2 | 3;
}) {
  return (
    <div
      className={`grid gap-2 ${columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}
      role="radiogroup"
      aria-label="Viral caption style presets"
    >
      {VIRAL_CAPTION_PRESETS.map((preset) => {
        const active = preset.id === activeId;
        const fontMeta = getViralFont(preset.subtitleFont);
        const strokePx = Math.min(2, Math.max(0, Math.round(preset.strokeWidth / 2)));

        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(preset)}
            className={`p-2 rounded-lg border text-left transition-colors cursor-pointer flex flex-col gap-1.5 ${
              active
                ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)]'
                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] hover:border-[var(--pc-muted)]'
            }`}
          >
            {/* Miniature live typography swatch */}
            <div className="h-9 w-full rounded bg-[#0A0A0D] border border-white/10 flex items-center justify-center px-1.5 overflow-hidden">
              <div
                className={`flex items-center gap-1 leading-none tracking-tight ${
                  preset.surfaceTreatment === 'ticker'
                    ? 'bg-zinc-900/95 border-b-2 border-[#FFE600] px-1.5 py-0.5'
                    : ''
                }`}
                style={{
                  fontFamily: fontMeta.cssFamily,
                  fontWeight: preset.subtitleWeight,
                  fontStyle: preset.subtitleItalic ? 'italic' : 'normal',
                  fontSize: preset.id === 'one-word-punch' ? '13px' : '11.5px',
                }}
              >
                <span
                  style={{
                    color: preset.baseColor,
                    WebkitTextStroke:
                      strokePx > 0 ? `${strokePx}px ${preset.strokeColor}` : undefined,
                    paintOrder: 'stroke fill',
                  }}
                >
                  {preset.sampleWords[0]}
                </span>
                <span
                  className={preset.surfaceTreatment === 'pill' ? 'px-1 py-0.5 rounded' : ''}
                  style={{
                    color: preset.surfaceTreatment === 'pill' ? '#FFFFFF' : preset.activeColor,
                    backgroundColor:
                      preset.surfaceTreatment === 'pill' ? preset.activeColor : 'transparent',
                    WebkitTextStroke:
                      strokePx > 0 && preset.surfaceTreatment !== 'pill'
                        ? `${strokePx}px ${preset.strokeColor}`
                        : undefined,
                    paintOrder: 'stroke fill',
                    textShadow: preset.neonGlow ? `0 0 8px ${preset.activeColor}` : undefined,
                  }}
                >
                  {preset.sampleWords[1]}
                </span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold text-[var(--pc-ink)] truncate">
                {preset.name}
              </div>
              <div className="text-[10px] text-[var(--pc-muted)] truncate mt-0.5">
                {preset.tagline}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toast Feedback                                                              */
/* -------------------------------------------------------------------------- */

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-[90] px-4 py-2 rounded-lg bg-[var(--pc-cta-bg)] text-[var(--pc-cta-fg)] text-xs font-medium shadow-xl border border-[var(--pc-border)] pointer-events-none"
    >
      {message}
    </div>
  );
}
