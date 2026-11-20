import React, { useRef, useState } from 'react';
import {
  FileText,
  Layers,
  Music2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Volume2,
  Wand2,
} from 'lucide-react';
import type {
  BrandKit,
  ClipItem,
  CustomFontEntry,
  EditorSettings,
  HeadlineLayoutStyleId,
  ShortsProductionConfig,
  ShortsTabId,
  SfxAsset,
  StreamerPlatformId,
  SubtitleBgStyleId,
  TextCasingId,
  TextSubtabId,
  TrackStates,
  WordCue,
} from '../../types';
import {
  FEATURED_PRESETS,
  getTemplatePreset,
  type TemplatePreset,
} from '../../presets';
import {
  VIRAL_CAPTION_PRESETS,
  VIRAL_FONTS,
  type ViralCaptionPreset,
} from '../../captionStyles';
import { formatTimecode, parseSrtToWordCues } from '../../lib/studioLogic';
import { autoSuggestMusicLevels, playSfxAsset } from '../../lib/shortsEngine';
import {
  Button,
  InspectorAccordion,
  SegmentedControl,
  StudioSlider,
  StudioSwitch,
} from '../ui/Primitives';

interface ShortsInspectorProps {
  activeTab: ShortsTabId;
  onChangeTab: (tab: ShortsTabId) => void;
  clip: ClipItem | null;
  settings: EditorSettings;
  shorts: ShortsProductionConfig;
  brandKit: BrandKit;
  trackStates: TrackStates;
  currentTimeSec: number;
  stitchedDurationSec: number;
  customFonts: readonly CustomFontEntry[];
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  onUpdateShorts: (patch: Partial<ShortsProductionConfig>) => void;
  onUpdateBrandKit: (next: BrandKit) => void;
  onToggleTrackState: (key: keyof TrackStates) => void;
  onSelectTemplatePreset: (preset: TemplatePreset) => void;
  onSelectCaptionPreset: (preset: ViralCaptionPreset) => void;
  onOpenTemplateLibrary: () => void;
  onImportSrtCues: (clipId: string, cues: WordCue[]) => void;
  onAutoAlignSubtitles: () => void;
  onAddSfxCueAtPlayhead: (asset: SfxAsset) => void;
  onRemoveSfxCue: (cueId: string) => void;
  onReplayOutro: () => void;
  onNotify: (msg: string) => void;
}

export function ShortsInspector({
  activeTab,
  onChangeTab,
  clip,
  settings,
  shorts,
  brandKit,
  trackStates,
  currentTimeSec,
  stitchedDurationSec,
  customFonts,
  onUpdateSettings,
  onUpdateShorts,
  onUpdateBrandKit,
  onToggleTrackState,
  onSelectTemplatePreset,
  onSelectCaptionPreset,
  onOpenTemplateLibrary,
  onImportSrtCues,
  onAutoAlignSubtitles,
  onAddSfxCueAtPlayhead,
  onRemoveSfxCue,
  onReplayOutro,
  onNotify,
}: ShortsInspectorProps) {
  const [textSubtab, setTextSubtab] = useState<TextSubtabId>('headline');
  const srtInputRef = useRef<HTMLInputElement>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);
  const sfxInputRef = useRef<HTMLInputElement>(null);
  const wmLogoInputRef = useRef<HTMLInputElement>(null);
  const outroFileInputRef = useRef<HTMLInputElement>(null);

  const activeTemplate = getTemplatePreset(settings.template);
  const allFontFamilies = [
    ...VIRAL_FONTS.map((f) => f.family),
    ...customFonts.map((f) => f.family),
  ];

  const handleSrtUpload = async (file: File) => {
    if (!clip) return;
    const text = await file.text();
    const cues = parseSrtToWordCues(text);
    if (cues.length === 0) {
      onNotify('No valid subtitle cues found in file');
      return;
    }
    onImportSrtCues(clip.id, cues);
  };

  const handleBgmUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const probe = new Audio(url);
    probe.onloadedmetadata = () => {
      onUpdateShorts({ musicDurationSec: Number.isFinite(probe.duration) ? probe.duration : 0 });
    };
    onUpdateSettings(
      {
        customAudioName: file.name,
        customAudioUrl: url,
        audioPeak: true,
      },
      true
    );
    onNotify(`Loaded BGM "${file.name}" onto A2 track`);
  };

  const handleAutoSuggestLevels = () => {
    const rec = autoSuggestMusicLevels(stitchedDurationSec);
    onUpdateSettings(
      {
        audioBaseVol: rec.audioBaseVol,
        audioPeakVol: rec.audioPeakVol,
        riserDurationSec: rec.riserDurationSec,
        audioPeak: true,
      },
      true
    );
    onUpdateShorts({ musicOffsetSec: rec.musicOffsetSec });
    onNotify(
      `Auto-suggested levels: Ducked ${rec.audioBaseVol}% → Peak ${rec.audioPeakVol}% (${rec.riserDurationSec}s riser)`
    );
  };

  const handleSfxUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const asset: SfxAsset = {
      id: `sfx-custom-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      url,
    };
    onUpdateShorts({ sfxLibrary: [asset, ...shorts.sfxLibrary] });
    onNotify(`Added SFX "${asset.name}" to project library`);
  };

  return (
    <aside
      aria-label="Shorts production inspector"
      className="w-[340px] shrink-0 border-l border-[var(--pc-border)] bg-[var(--pc-surface)] flex flex-col overflow-hidden"
    >
      {/* 3 Clean Shorts-Only Tabs (ZERO Framing Tab Duplication) */}
      <div
        role="tablist"
        aria-label="Shorts inspector tabs"
        className="shrink-0 grid grid-cols-3 border-b border-[var(--pc-border)] bg-[var(--pc-surface)]"
      >
        {(
          [
            { id: 'templates', label: 'Templates', icon: <Layers className="w-3.5 h-3.5" /> },
            { id: 'text', label: 'Text', icon: <Type className="w-3.5 h-3.5" /> },
            { id: 'media', label: 'Media', icon: <Music2 className="w-3.5 h-3.5" /> },
          ] as { id: ShortsTabId; label: string; icon: React.ReactNode }[]
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChangeTab(tab.id)}
              className={`h-11 inline-flex items-center justify-center gap-1.5 text-xs font-medium border-0 border-b-2 bg-transparent cursor-pointer transition-colors ${
                active
                  ? 'border-[var(--pc-ink)] text-[var(--pc-ink)]'
                  : 'border-transparent text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Inspector Content */}
      <div className="flex-1 overflow-y-auto studio-scroll px-4 py-3 space-y-3">
        {/* ================= TEMPLATES TAB ================= */}
        {activeTab === 'templates' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[var(--pc-ink)] m-0">
                  Short Format Template
                </h3>
                <p className="text-[11px] text-[var(--pc-muted)] m-0 mt-0.5">
                  Active: {activeTemplate.fullName}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={onOpenTemplateLibrary}>
                All Formats
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {FEATURED_PRESETS.map((preset) => {
                const active = settings.template === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectTemplatePreset(preset)}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                      active
                        ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                        : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                    }`}
                  >
                    <div className="text-xs font-semibold text-[var(--pc-ink)] truncate">
                      {preset.name}
                    </div>
                    <div className="text-[10.5px] text-[var(--pc-muted)] mt-0.5 truncate">
                      {preset.category}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Streamer / Platform Attribution */}
            <InspectorAccordion title="Platform Credit & Card" defaultOpen>
              <div className="space-y-2.5">
                <StudioSwitch
                  checked={settings.showStreamerBadge}
                  label="Show Streamer Attribution"
                  onChange={(showStreamerBadge) => onUpdateSettings({ showStreamerBadge }, true)}
                />
                {settings.showStreamerBadge && (
                  <>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-[var(--pc-sub)]">Streamer / Channel Name</span>
                      <input
                        type="text"
                        value={settings.streamerHandle}
                        placeholder="e.g. adinross"
                        onChange={(e) => onUpdateSettings({ streamerHandle: e.target.value }, false)}
                        className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                      />
                    </label>
                    <SegmentedControl<StreamerPlatformId>
                      ariaLabel="Platform logo badge"
                      size="sm"
                      fullWidth
                      value={settings.streamerPlatform}
                      options={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'kick', label: 'Kick' },
                        { value: 'instagram', label: 'IG' },
                        { value: 'youtube', label: 'YT' },
                      ]}
                      onChange={(streamerPlatform) => onUpdateSettings({ streamerPlatform }, true)}
                    />
                  </>
                )}

                {(settings.template === 'x_light' || settings.template === 'x_dark') && (
                  <div className="space-y-2 pt-2 border-t border-[var(--pc-border-subtle)]">
                    <SegmentedControl<'light' | 'dark'>
                      ariaLabel="Social card theme"
                      size="sm"
                      fullWidth
                      value={settings.cardTheme}
                      options={[
                        { value: 'light', label: 'Light Card' },
                        { value: 'dark', label: 'Dark Card' },
                      ]}
                      onChange={(cardTheme) => onUpdateSettings({ cardTheme }, true)}
                    />
                    <textarea
                      rows={2}
                      value={settings.pinnedStatement}
                      placeholder="Tweet / post statement text..."
                      onChange={(e) => onUpdateSettings({ pinnedStatement: e.target.value }, false)}
                      className="w-full p-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)] resize-none"
                    />
                  </div>
                )}
              </div>
            </InspectorAccordion>
          </div>
        )}

        {/* ================= TEXT TAB (HEADLINE HOOK + SUBTITLES .SRT) ================= */}
        {activeTab === 'text' && (
          <div className="space-y-3">
            <SegmentedControl<TextSubtabId>
              ariaLabel="Text section"
              size="sm"
              fullWidth
              value={textSubtab}
              options={[
                { value: 'headline', label: 'Headline Hook' },
                { value: 'subs', label: 'Subtitles (.srt)' },
              ]}
              onChange={setTextSubtab}
            />

            {textSubtab === 'headline' ? (
              <div className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-[11px] text-[var(--pc-sub)]">Hook Text</span>
                  <textarea
                    rows={3}
                    value={settings.headline}
                    placeholder="Write a scroll-stopping viral hook..."
                    onChange={(e) => onUpdateSettings({ headline: e.target.value }, false)}
                    className="w-full p-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)] resize-none"
                  />
                </label>

                <div>
                  <div className="text-[11px] text-[var(--pc-sub)] mb-1">Box Style</div>
                  <SegmentedControl<HeadlineLayoutStyleId>
                    ariaLabel="Headline box style"
                    size="sm"
                    fullWidth
                    value={settings.headlineLayout}
                    options={[
                      { value: 'white-stepped', label: 'White' },
                      { value: 'dark-stepped', label: 'Dark' },
                      { value: 'solid-banner', label: 'Banner' },
                      { value: 'outline-only', label: 'Outline' },
                      { value: 'none', label: 'Off' },
                    ]}
                    onChange={(headlineLayout) => onUpdateSettings({ headlineLayout }, true)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-[11px] text-[var(--pc-sub)]">
                    <span>Font</span>
                    <select
                      value={settings.font}
                      onChange={(e) => onUpdateSettings({ font: e.target.value }, true)}
                      className="w-full h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                    >
                      {allFontFamilies.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[11px] text-[var(--pc-sub)]">
                    <span>Casing</span>
                    <select
                      value={settings.headlineCasing}
                      onChange={(e) =>
                        onUpdateSettings({ headlineCasing: e.target.value as TextCasingId }, true)
                      }
                      className="w-full h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                    >
                      <option value="asis">As Typed</option>
                      <option value="upper">UPPERCASE</option>
                      <option value="title">Title Case</option>
                    </select>
                  </label>
                </div>

                <StudioSlider
                  label="Hook Size"
                  value={settings.headlineSize}
                  min={14}
                  max={44}
                  valueLabel={`${settings.headlineSize}px`}
                  onChange={(headlineSize) => onUpdateSettings({ headlineSize }, false)}
                />

                {/* Decompiled Headline Custom Timing & In/Out SFX */}
                <InspectorAccordion title="Hook Timing & Entry SFX" defaultOpen>
                  <div className="space-y-2.5">
                    <SegmentedControl<'always' | 'custom'>
                      ariaLabel="Headline timing mode"
                      size="sm"
                      fullWidth
                      value={shorts.headlineTiming.mode}
                      options={[
                        { value: 'always', label: 'Always Visible' },
                        { value: 'custom', label: 'Custom Window' },
                      ]}
                      onChange={(mode) =>
                        onUpdateShorts({
                          headlineTiming: { ...shorts.headlineTiming, mode },
                        })
                      }
                    />
                    {shorts.headlineTiming.mode === 'custom' && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] text-[var(--pc-sub)] space-y-1">
                            <span>Start (s)</span>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={shorts.headlineTiming.startSec}
                              onChange={(e) =>
                                onUpdateShorts({
                                  headlineTiming: {
                                    ...shorts.headlineTiming,
                                    startSec: Math.max(0, Number(e.target.value) || 0),
                                  },
                                })
                              }
                              className="w-full h-7 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-mono-tabular text-[var(--pc-ink)]"
                            />
                          </label>
                          <label className="text-[11px] text-[var(--pc-sub)] space-y-1">
                            <span>End (s)</span>
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={shorts.headlineTiming.endSec}
                              onChange={(e) =>
                                onUpdateShorts({
                                  headlineTiming: {
                                    ...shorts.headlineTiming,
                                    endSec: Math.max(0.5, Number(e.target.value) || 3.5),
                                  },
                                })
                              }
                              className="w-full h-7 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-mono-tabular text-[var(--pc-ink)]"
                            />
                          </label>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] text-[var(--pc-sub)] space-y-1">
                            <span>SFX In</span>
                            <select
                              value={shorts.headlineTiming.sfxIn}
                              onChange={(e) =>
                                onUpdateShorts({
                                  headlineTiming: {
                                    ...shorts.headlineTiming,
                                    sfxIn: e.target.value,
                                  },
                                })
                              }
                              className="w-full h-7 px-1.5 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                            >
                              <option value="">None</option>
                              {shorts.sfxLibrary.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[11px] text-[var(--pc-sub)] space-y-1">
                            <span>SFX Out</span>
                            <select
                              value={shorts.headlineTiming.sfxOut}
                              onChange={(e) =>
                                onUpdateShorts({
                                  headlineTiming: {
                                    ...shorts.headlineTiming,
                                    sfxOut: e.target.value,
                                  },
                                })
                              }
                              className="w-full h-7 px-1.5 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                            >
                              <option value="">None</option>
                              {shorts.sfxLibrary.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                </InspectorAccordion>
              </div>
            ) : (
              <div className="space-y-3">
                {/* .srt / .vtt Importer */}
                <input
                  ref={srtInputRef}
                  data-testid="srt-file-input"
                  type="file"
                  accept=".srt,.vtt,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleSrtUpload(f);
                    e.target.value = '';
                  }}
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => srtInputRef.current?.click()}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Import .srt / .vtt</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onAutoAlignSubtitles}>
                    Safe Align
                  </Button>
                </div>

                {/* Viral Caption Style Presets */}
                <div className="grid grid-cols-2 gap-1.5">
                  {VIRAL_CAPTION_PRESETS.map((cp) => {
                    const active = settings.captionStyle === cp.id;
                    return (
                      <button
                        key={cp.id}
                        type="button"
                        onClick={() => onSelectCaptionPreset(cp)}
                        className={`px-2 py-1.5 rounded-md border text-left cursor-pointer ${
                          active
                            ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                            : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                        }`}
                      >
                        <div className="text-[11px] font-semibold text-[var(--pc-ink)] truncate">
                          {cp.name}
                        </div>
                        <div className="text-[10px] text-[var(--pc-muted)] truncate">
                          {cp.subtitleFont}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <StudioSlider
                  label="Caption Size"
                  value={settings.subtitleSize}
                  min={14}
                  max={48}
                  valueLabel={`${settings.subtitleSize}px`}
                  onChange={(subtitleSize) => onUpdateSettings({ subtitleSize }, false)}
                />
                <StudioSlider
                  label="Vertical Position"
                  value={settings.subtitleVerticalPos}
                  min={15}
                  max={92}
                  valueLabel={`${settings.subtitleVerticalPos}%`}
                  onChange={(subtitleVerticalPos) => onUpdateSettings({ subtitleVerticalPos }, false)}
                />

                <div>
                  <div className="text-[11px] text-[var(--pc-sub)] mb-1">Subtitle Background</div>
                  <SegmentedControl<SubtitleBgStyleId>
                    ariaLabel="Subtitle background style"
                    size="sm"
                    fullWidth
                    value={settings.subtitleBgStyle}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'white-stepped', label: 'White' },
                      { value: 'dark-pill', label: 'Dark' },
                      { value: 'active-box', label: 'Highlight' },
                    ]}
                    onChange={(subtitleBgStyle) => onUpdateSettings({ subtitleBgStyle }, true)}
                  />
                </div>

                {clip && clip.words.length > 0 && (
                  <div className="text-[11px] font-mono-tabular text-[var(--pc-muted)]">
                    Loaded {clip.words.length} timed subtitle cues onto CC track.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================= MEDIA TAB (BGM RISER, SFX, DUAL WATERMARK, OUTRO) ================= */}
        {activeTab === 'media' && (
          <div className="divide-y divide-[var(--pc-border-subtle)]">
            {/* 1. Master Video Audio */}
            <InspectorAccordion title="Master Video Audio" defaultOpen>
              <StudioSwitch
                checked={!trackStates.a1Muted}
                label={trackStates.a1Muted ? 'Master Audio Muted' : 'Master Audio Active'}
                onChange={() => onToggleTrackState('a1Muted')}
              />
            </InspectorAccordion>

            {/* 2. Background Music + Auto-Suggest Levels + Riser Surge */}
            <InspectorAccordion
              title="Background Music (A2)"
              badge={settings.customAudioName ? 'Loaded' : undefined}
              defaultOpen
            >
              <input
                ref={bgmInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleBgmUpload(f);
                  e.target.value = '';
                }}
              />
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => bgmInputRef.current?.click()}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span className="truncate">
                      {settings.customAudioName || 'Import Audio Track'}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="auto-suggest-levels-btn"
                    onClick={handleAutoSuggestLevels}
                    title="Auto-Suggest optimal ducked, peak, and riser levels"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>Auto</span>
                  </Button>
                </div>

                <StudioSlider
                  label="Ducked Volume"
                  value={settings.audioBaseVol}
                  min={0}
                  max={100}
                  valueLabel={`${settings.audioBaseVol}%`}
                  onChange={(audioBaseVol) => onUpdateSettings({ audioBaseVol }, false)}
                />
                <StudioSlider
                  label="Peak Volume (End / Outro)"
                  value={settings.audioPeakVol}
                  min={0}
                  max={100}
                  valueLabel={`${settings.audioPeakVol}%`}
                  onChange={(audioPeakVol) => onUpdateSettings({ audioPeakVol }, false)}
                />
                <StudioSlider
                  label="Riser Surge Time"
                  value={settings.riserDurationSec}
                  min={0}
                  max={20}
                  step={0.5}
                  valueLabel={`${settings.riserDurationSec.toFixed(1)}s`}
                  onChange={(riserDurationSec) => onUpdateSettings({ riserDurationSec }, false)}
                />
                <StudioSlider
                  label="Track Start Offset"
                  value={shorts.musicOffsetSec}
                  min={0}
                  max={120}
                  step={1}
                  valueLabel={`${shorts.musicOffsetSec}s`}
                  onChange={(musicOffsetSec) => onUpdateShorts({ musicOffsetSec })}
                />
              </div>
            </InspectorAccordion>

            {/* 3. Sound Effects (SFX) Library + Timeline Cues */}
            <InspectorAccordion
              title="Sound Effects (SFX)"
              badge={shorts.sfxCues.length ? `${shorts.sfxCues.length} placed` : undefined}
              defaultOpen
            >
              <input
                ref={sfxInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleSfxUpload(f);
                  e.target.value = '';
                }}
              />
              <div className="space-y-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => sfxInputRef.current?.click()}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Import Custom SFX (.mp3 / .wav)</span>
                </Button>

                <div className="space-y-1">
                  {shorts.sfxLibrary.map((asset) => (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)]"
                    >
                      <button
                        type="button"
                        onClick={() => playSfxAsset(asset, 0.85)}
                        className="flex items-center gap-1.5 text-xs text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer truncate"
                        title={`Preview ${asset.name}`}
                      >
                        <Volume2 className="w-3 h-3 text-[var(--pc-accent)] shrink-0" />
                        <span className="truncate">{asset.name}</span>
                      </button>
                      <button
                        type="button"
                        data-testid={`place-sfx-${asset.id}`}
                        onClick={() => onAddSfxCueAtPlayhead(asset)}
                        className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[10.5px] font-medium text-[var(--pc-ink)] hover:border-[var(--pc-muted)] whitespace-nowrap cursor-pointer"
                      >
                        + @ {formatTimecode(currentTimeSec)}
                      </button>
                    </div>
                  ))}
                </div>

                {shorts.sfxCues.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <div className="text-[10.5px] font-medium text-[var(--pc-muted)]">
                      Placed on Timeline
                    </div>
                    {shorts.sfxCues.map((cue) => (
                      <div
                        key={cue.id}
                        className="flex items-center justify-between text-[11px] font-mono-tabular px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30"
                      >
                        <span className="truncate">
                          {cue.name} @ {formatTimecode(cue.time)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${cue.name}`}
                          onClick={() => onRemoveSfxCue(cue.id)}
                          className="text-[var(--pc-sub)] hover:text-[var(--pc-err)] bg-transparent border-0 p-0 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </InspectorAccordion>

            {/* 4. Dual Logo & Watermark */}
            <InspectorAccordion title="Logo & Dual Watermark">
              <input
                ref={wmLogoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    onUpdateShorts({
                      dualWatermark: {
                        ...shorts.dualWatermark,
                        useCustomLogo: true,
                        customLogoUrl: URL.createObjectURL(f),
                        customLogoName: f.name,
                      },
                    });
                    onNotify(`Loaded watermark image: ${f.name}`);
                  }
                  e.target.value = '';
                }}
              />
              <div className="space-y-2.5">
                <StudioSwitch
                  checked={brandKit.showWatermark}
                  label="Show Primary Watermark"
                  onChange={(showWatermark) => onUpdateBrandKit({ ...brandKit, showWatermark })}
                />
                {brandKit.showWatermark && (
                  <>
                    <SegmentedControl<'handle' | 'image'>
                      ariaLabel="Primary watermark mode"
                      size="sm"
                      fullWidth
                      value={shorts.dualWatermark.useCustomLogo ? 'image' : 'handle'}
                      options={[
                        { value: 'handle', label: 'Handle Text' },
                        { value: 'image', label: 'Custom Logo' },
                      ]}
                      onChange={(mode) =>
                        onUpdateShorts({
                          dualWatermark: {
                            ...shorts.dualWatermark,
                            useCustomLogo: mode === 'image',
                          },
                        })
                      }
                    />
                    {shorts.dualWatermark.useCustomLogo ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        onClick={() => wmLogoInputRef.current?.click()}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{shorts.dualWatermark.customLogoName || 'Upload PNG Logo'}</span>
                      </Button>
                    ) : (
                      <input
                        type="text"
                        placeholder="@yourchannel"
                        value={brandKit.handle}
                        onChange={(e) => onUpdateBrandKit({ ...brandKit, handle: e.target.value })}
                        className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                      />
                    )}
                    <StudioSlider
                      label="Opacity"
                      value={brandKit.watermarkOpacity}
                      min={15}
                      max={100}
                      valueLabel={`${brandKit.watermarkOpacity}%`}
                      onChange={(watermarkOpacity) =>
                        onUpdateBrandKit({ ...brandKit, watermarkOpacity })
                      }
                    />
                  </>
                )}

                <div className="pt-2 border-t border-[var(--pc-border-subtle)] space-y-2">
                  <StudioSwitch
                    checked={shorts.dualWatermark.secondaryEnabled}
                    label="Secondary Hashtag / Credit"
                    onChange={(secondaryEnabled) =>
                      onUpdateShorts({
                        dualWatermark: { ...shorts.dualWatermark, secondaryEnabled },
                      })
                    }
                  />
                  {shorts.dualWatermark.secondaryEnabled && (
                    <input
                      type="text"
                      value={shorts.dualWatermark.secondaryText}
                      placeholder="#YourHashtag"
                      onChange={(e) =>
                        onUpdateShorts({
                          dualWatermark: {
                            ...shorts.dualWatermark,
                            secondaryText: e.target.value,
                          },
                        })
                      }
                      className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                    />
                  )}
                </div>
              </div>
            </InspectorAccordion>

            {/* 5. Outro Media (Animated Card Template or Custom File) */}
            <InspectorAccordion
              title="Outro Media"
              badge={shorts.outro.enabled ? `${shorts.outro.duration}s` : 'Off'}
            >
              <input
                ref={outroFileInputRef}
                type="file"
                accept="video/*,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    onUpdateShorts({
                      outro: {
                        ...shorts.outro,
                        mode: 'custom',
                        enabled: true,
                        customUrl: URL.createObjectURL(f),
                        customName: f.name,
                        customIsVideo: f.type.startsWith('video/'),
                      },
                    });
                    onNotify(`Loaded custom outro: ${f.name}`);
                  }
                  e.target.value = '';
                }}
              />
              <div className="space-y-3">
                <StudioSwitch
                  checked={shorts.outro.enabled}
                  label="Enable Outro Card"
                  onChange={(enabled) =>
                    onUpdateShorts({ outro: { ...shorts.outro, enabled } })
                  }
                />

                {shorts.outro.enabled && (
                  <>
                    <SegmentedControl<'template' | 'custom'>
                      ariaLabel="Outro mode"
                      size="sm"
                      fullWidth
                      value={shorts.outro.mode}
                      options={[
                        { value: 'template', label: 'Outro Template' },
                        { value: 'custom', label: 'Custom File' },
                      ]}
                      onChange={(mode) =>
                        onUpdateShorts({ outro: { ...shorts.outro, mode } })
                      }
                    />

                    <StudioSlider
                      label="Outro Duration"
                      value={shorts.outro.duration}
                      min={1.5}
                      max={8}
                      step={0.5}
                      valueLabel={`${shorts.outro.duration.toFixed(1)}s`}
                      onChange={(duration) =>
                        onUpdateShorts({ outro: { ...shorts.outro, duration } })
                      }
                    />

                    {shorts.outro.mode === 'template' ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={shorts.outro.text}
                          placeholder="Outro CTA text..."
                          onChange={(e) =>
                            onUpdateShorts({ outro: { ...shorts.outro, text: e.target.value } })
                          }
                          className="w-full h-8 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={shorts.outro.btnText}
                            placeholder="Button text"
                            onChange={(e) =>
                              onUpdateShorts({
                                outro: { ...shorts.outro, btnText: e.target.value },
                              })
                            }
                            className="h-7 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                          />
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              aria-label="Outro background color"
                              value={shorts.outro.bgColor}
                              onChange={(e) =>
                                onUpdateShorts({
                                  outro: { ...shorts.outro, bgColor: e.target.value },
                                })
                              }
                              className="h-7 w-8 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                            />
                            <input
                              type="color"
                              aria-label="Outro button color"
                              value={shorts.outro.btnColor}
                              onChange={(e) =>
                                onUpdateShorts({
                                  outro: { ...shorts.outro, btnColor: e.target.value },
                                })
                              }
                              className="h-7 w-8 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full"
                        onClick={() => outroFileInputRef.current?.click()}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{shorts.outro.customName || 'Upload Outro MP4 / PNG'}</span>
                      </Button>
                    )}

                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      data-testid="replay-outro-btn"
                      onClick={onReplayOutro}
                    >
                      <Play className="w-3 h-3" />
                      <span>Play Outro Preview</span>
                    </Button>
                  </>
                )}
              </div>
            </InspectorAccordion>
          </div>
        )}
      </div>
    </aside>
  );
}
