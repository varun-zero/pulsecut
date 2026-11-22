import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Crop,
  ExternalLink,
  FileText,
  Flame,
  Hash,
  ImagePlus,
  Layers,
  Music2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Type,
  Upload,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import type {
  BrandKit,
  CaptionAnimationId,
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
  WordPacingId,
} from '../../types';
import { VIRAL_FONTS } from '../../captionStyles';
import { formatTimecode, parseSrtToWordCues } from '../../lib/studioLogic';
import { autoSuggestMusicLevels, playSfxAsset } from '../../lib/shortsEngine';
import {
  auditionTrackMood,
  detectVideoNiche,
  filterMusicCatalog,
  getHashtagPack,
  MUSIC_MOOD_OPTIONS,
  TRENDING_HASHTAG_PACKS,
  type CopyrightFreeTrack,
  type EditableCaptionPreset,
  type EditableTemplatePreset,
  type LogoAsset,
  type MusicMoodId,
  type VideoNicheId,
} from '../../lib/creatorCatalog';
import {
  Button,
  InspectorAccordion,
  SegmentedControl,
  StudioSlider,
  StudioSwitch,
} from '../ui/Primitives';
import { InstagramIcon, KickLogoIcon, YouTubeShortsIcon } from '../ui/PlatformIcons';

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
  templates: readonly EditableTemplatePreset[];
  captionPresets: readonly EditableCaptionPreset[];
  customFonts: readonly CustomFontEntry[];
  logos: readonly LogoAsset[];
  canRestoreTemplates: boolean;
  canRestoreCaptions: boolean;
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  onUpdateShorts: (patch: Partial<ShortsProductionConfig>) => void;
  onUpdateBrandKit: (next: BrandKit) => void;
  onToggleTrackState: (key: keyof TrackStates) => void;
  onSelectTemplatePreset: (preset: EditableTemplatePreset) => void;
  onOpenTemplateEditor: (preset: EditableTemplatePreset | null) => void;
  onDeleteTemplate: (id: string) => void;
  onRestoreTemplates: () => void;
  onSelectCaptionPreset: (preset: EditableCaptionPreset) => void;
  onAddCaptionStyle: (preset: EditableCaptionPreset) => void;
  onDeleteCaptionStyle: (id: string) => void;
  onRestoreCaptions: () => void;
  onUploadCustomFont: (file: File) => void;
  onAddGoogleFont: (familyName: string) => void;
  onDeleteCustomFont: (id: string) => void;
  onUploadLogo: (file: File) => void;
  onDeleteLogo: (id: string) => void;
  onUpdateClipHashtags: (clipId: string, hashtags: string[]) => void;
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
  templates,
  captionPresets,
  customFonts,
  logos,
  canRestoreTemplates,
  canRestoreCaptions,
  onUpdateSettings,
  onUpdateShorts,
  onUpdateBrandKit,
  onToggleTrackState,
  onSelectTemplatePreset,
  onOpenTemplateEditor,
  onDeleteTemplate,
  onRestoreTemplates,
  onSelectCaptionPreset,
  onAddCaptionStyle,
  onDeleteCaptionStyle,
  onRestoreCaptions,
  onUploadCustomFont,
  onAddGoogleFont,
  onDeleteCustomFont,
  onUploadLogo,
  onDeleteLogo,
  onUpdateClipHashtags,
  onOpenTemplateLibrary,
  onImportSrtCues,
  onAutoAlignSubtitles,
  onAddSfxCueAtPlayhead,
  onRemoveSfxCue,
  onReplayOutro,
  onNotify,
}: ShortsInspectorProps) {
  const [textSubtab, setTextSubtab] = useState<TextSubtabId>('headline');
  const [googleFontDraft, setGoogleFontDraft] = useState('');
  const [creatingCaption, setCreatingCaption] = useState(false);
  const [newCapName, setNewCapName] = useState('');
  const [newCapFont, setNewCapFont] = useState(settings.subtitleFont || 'Montserrat');
  const [newCapBase, setNewCapBase] = useState(settings.subtitleBaseColor || '#FFFFFF');
  const [newCapActive, setNewCapActive] = useState(settings.subtitleActiveColor || '#FFE600');
  const [newCapStroke, setNewCapStroke] = useState(settings.subtitleStrokeWidth || 5);
  const [newCapPacing, setNewCapPacing] = useState<WordPacingId>(settings.subtitleWordsPerScreen || '2-3');
  const [newCapAnim, setNewCapAnim] = useState<CaptionAnimationId>(settings.subtitleAnimation || 'pop-scale');

  const [musicMood, setMusicMood] = useState<MusicMoodId>('all');
  const [viralOnlyMusic, setViralOnlyMusic] = useState(true);

  const detectedNiche = useMemo(
    () => detectVideoNiche(clip?.title || settings.headline || '', clip?.description || '', clip?.platform || ''),
    [clip?.id, clip?.title, clip?.description, clip?.platform, settings.headline]
  );
  const [selectedNiche, setSelectedNiche] = useState<VideoNicheId>(detectedNiche);

  useEffect(() => {
    setSelectedNiche(detectedNiche);
  }, [detectedNiche]);

  const srtInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);
  const sfxInputRef = useRef<HTMLInputElement>(null);
  const wmLogoInputRef = useRef<HTMLInputElement>(null);
  const outroFileInputRef = useRef<HTMLInputElement>(null);

  const activeTemplate =
    templates.find((t) => t.id === settings.template) || templates[0];
  const visibleTemplates = useMemo(() => {
    const customAndFeatured = templates.filter((t) => t.isCustom || t.featured);
    return customAndFeatured.length > 0 ? customAndFeatured : templates;
  }, [templates]);

  const allFontFamilies = [
    ...VIRAL_FONTS.map((f) => f.family),
    ...customFonts.map((f) => f.family),
  ];

  const filteredMusic = useMemo(
    () => filterMusicCatalog(musicMood, viralOnlyMusic),
    [musicMood, viralOnlyMusic]
  );

  const hashtagPack = useMemo(() => getHashtagPack(selectedNiche), [selectedNiche]);
  const activeClipTags = useMemo(
    () => new Set((clip?.hashtags || []).map((h) => h.replace(/^#/, '').toLowerCase())),
    [clip?.hashtags]
  );

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

  const handleApplyCatalogTrack = (track: CopyrightFreeTrack) => {
    auditionTrackMood(track);
    onUpdateSettings(
      {
        customAudioName: `${track.title} — ${track.artist}`,
        audioBaseVol: track.mixPreset.audioBaseVol,
        audioPeakVol: track.mixPreset.audioPeakVol,
        riserDurationSec: track.mixPreset.riserDurationSec,
        audioPeak: true,
      },
      true
    );
    onNotify(
      `Applied "${track.title}" mix (${track.mixPreset.audioBaseVol}% → ${track.mixPreset.audioPeakVol}% riser)`
    );
  };

  const handleCopyAttribution = (track: CopyrightFreeTrack) => {
    const credit =
      track.attributionText || `Music: ${track.title} by ${track.artist} (${track.source})`;
    navigator.clipboard?.writeText(credit).catch(() => {});
    onNotify(`Copied credit for "${track.title}"`);
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

  const handleToggleHashtag = (rawTag: string) => {
    const clean = rawTag.replace(/^#/, '').toLowerCase();
    if (!clip) {
      navigator.clipboard?.writeText(`#${clean}`).catch(() => {});
      onNotify(`Copied #${clean}`);
      return;
    }
    const existing = clip.hashtags.map((h) => h.replace(/^#/, '').toLowerCase());
    const next = existing.includes(clean)
      ? existing.filter((t) => t !== clean)
      : [...existing, clean];
    onUpdateClipHashtags(clip.id, next);
  };

  const handleApplyTopHashtags = () => {
    const topFive = hashtagPack.topViral.slice(0, 5);
    if (clip) {
      onUpdateClipHashtags(clip.id, topFive);
    }
    onNotify(`Applied ${topFive.length} ${hashtagPack.label} hashtags`);
  };

  const handlePutTagsOnVideo = () => {
    const chosen =
      clip && clip.hashtags.length > 0
        ? clip.hashtags.slice(0, 3)
        : hashtagPack.topViral.slice(0, 3);
    const formatted = chosen.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    onUpdateShorts({
      dualWatermark: {
        ...shorts.dualWatermark,
        secondaryEnabled: true,
        secondaryText: formatted,
      },
    });
    onNotify(`Placed "${formatted}" onto video overlay`);
  };

  const handleCopyHashtags = () => {
    const list =
      clip && clip.hashtags.length > 0
        ? clip.hashtags
        : [...hashtagPack.topViral, ...hashtagPack.nicheTags.slice(0, 3)];
    const formatted = list.map((h) => `#${h.replace(/^#/, '')}`).join(' ');
    navigator.clipboard?.writeText(formatted).catch(() => {});
    onNotify(`Copied ${list.length} hashtags to clipboard`);
  };

  const handleCreateCaptionStyle = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newCapName.trim();
    if (!cleanName) {
      onNotify('Enter a name for the caption style');
      return;
    }
    const created: EditableCaptionPreset = {
      id: `custom-cap-${Date.now()}`,
      name: cleanName,
      tagline: `Custom ${newCapFont} · ${newCapPacing}w`,
      isCustom: true,
      headlineFont: newCapFont,
      subtitleFont: newCapFont,
      subtitleWeight: 900,
      casing: 'upper',
      wordsPerScreen: newCapPacing,
      baseColor: newCapBase,
      activeColor: newCapActive,
      emphasisColor: newCapActive,
      strokeWidth: newCapStroke,
      strokeColor: '#000000',
      dropShadow: true,
      neonGlow: false,
      animation: newCapAnim,
      surfaceTreatment: 'outline',
      sampleWords: ['VIRAL', 'STYLE'],
    };
    onAddCaptionStyle(created);
    onSelectCaptionPreset(created);
    setNewCapName('');
    setCreatingCaption(false);
  };

  const handleAddGoogleFontSubmit = () => {
    const trimmed = googleFontDraft.trim();
    if (!trimmed) return;
    onAddGoogleFont(trimmed);
    setGoogleFontDraft('');
  };

  return (
    <aside
      aria-label="Shorts production inspector"
      className="w-[340px] shrink-0 border-l border-[var(--pc-border)] bg-[var(--pc-surface)] flex flex-col overflow-hidden"
    >
      {/* Shorts-Only Tabs (ZERO Framing Tab Duplication) */}
      <div
        role="tablist"
        aria-label="Shorts inspector tabs"
        className="shrink-0 grid grid-cols-6 border-b border-[var(--pc-border)] bg-[var(--pc-surface)]"
      >
        {(
          [
            { id: 'frame', label: 'Frame', icon: <Crop className="w-3.5 h-3.5" /> },
            { id: 'templates', label: 'Templates', icon: <Layers className="w-3.5 h-3.5" /> },
            { id: 'text', label: 'Text', icon: <Type className="w-3.5 h-3.5" /> },
            { id: 'media', label: 'Media', icon: <Music2 className="w-3.5 h-3.5" /> },
            { id: 'adjust', label: 'Adjust', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
            { id: 'audio', label: 'Audio', icon: <Volume2 className="w-3.5 h-3.5" /> },
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
              className={`h-11 inline-flex items-center justify-center gap-1 text-[10px] font-medium border-0 border-b-2 bg-transparent cursor-pointer transition-colors ${
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
        {/* ================= FRAME TAB (main stage hosts the interactive editor) ================= */}
        {activeTab === 'frame' && (
          <div className="space-y-3" data-testid="frame-tab-helper">
            <div className="rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)] p-3 flex items-start gap-2.5">
              <span className="w-8 h-8 shrink-0 rounded-lg bg-[var(--pc-accent-soft)] border border-[var(--pc-accent)] text-[var(--pc-accent)] grid place-items-center">
                <Crop className="w-4 h-4 stroke-[1.75]" />
              </span>
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-[var(--pc-ink)] m-0">
                  Interactive Source-Frame Editor
                </h3>
                <p className="text-[11px] text-[var(--pc-muted)] m-0 mt-1 leading-snug">
                  The main stage now shows the framing workflow. Edit the source crop boxes
                  right there — no second canvas lives in this panel.
                </p>
              </div>
            </div>

            <InspectorAccordion title="Framing Controls" defaultOpen>
              <ul className="m-0 p-0 list-none space-y-2">
                <li className="flex items-start gap-2 text-[11px] text-[var(--pc-sub)] leading-snug">
                  <span className="mt-0.5 w-4 h-4 shrink-0 rounded border border-[var(--pc-border)] grid place-items-center text-[9px] font-mono-tabular text-[var(--pc-accent)]">1</span>
                  <span>Drag a colored box to move its crop region on the 16:9 source.</span>
                </li>
                <li className="flex items-start gap-2 text-[11px] text-[var(--pc-sub)] leading-snug">
                  <span className="mt-0.5 w-4 h-4 shrink-0 rounded border border-[var(--pc-border)] grid place-items-center text-[9px] font-mono-tabular text-[var(--pc-accent)]">2</span>
                  <span>Drag any of the four corner handles to resize a box.</span>
                </li>
                <li className="flex items-start gap-2 text-[11px] text-[var(--pc-sub)] leading-snug">
                  <span className="mt-0.5 w-4 h-4 shrink-0 rounded border border-[var(--pc-border)] grid place-items-center text-[9px] font-mono-tabular text-[var(--pc-accent)]">3</span>
                  <span>Changes apply directly to the framing blueprint used by this short (and its export).</span>
                </li>
              </ul>
            </InspectorAccordion>
          </div>
        )}

        {/* ================= TEMPLATES TAB ================= */}
        {activeTab === 'templates' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-[var(--pc-ink)] m-0">
                  Short Format Templates
                </h3>
                <p className="text-[11px] text-[var(--pc-muted)] m-0 mt-0.5 truncate">
                  Active: {activeTemplate?.fullName || 'Classic Short'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="new-template-btn"
                  onClick={() => onOpenTemplateEditor(null)}
                >
                  <Plus className="w-3 h-3" />
                  <span>New</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={onOpenTemplateLibrary}>
                  All ({templates.length})
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {visibleTemplates.map((preset) => {
                const active = settings.template === preset.id;
                return (
                  <div
                    key={preset.id}
                    data-testid={`template-card-${preset.id}`}
                    className={`rounded-lg border transition-colors flex flex-col justify-between ${
                      active
                        ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                        : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:border-[var(--pc-muted)]'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelectTemplatePreset(preset)}
                      className="p-2 pb-1.5 text-left cursor-pointer bg-transparent border-0 w-full"
                    >
                      <div className="text-xs font-semibold text-[var(--pc-ink)] flex items-center gap-1.5 min-w-0">
                        {preset.defaultStreamerPlatform === 'kick' && (
                          <KickLogoIcon className="w-3 h-3 shrink-0" />
                        )}
                        {preset.defaultStreamerPlatform === 'instagram' && (
                          <InstagramIcon className="w-3 h-3 shrink-0" />
                        )}
                        {preset.defaultStreamerPlatform === 'youtube' && (
                          <YouTubeShortsIcon className="w-3 h-3 shrink-0" />
                        )}
                        <span className="truncate">{preset.name}</span>
                      </div>
                      <div className="text-[10px] font-mono-tabular text-[var(--pc-muted)] mt-0.5 truncate">
                        {preset.defaultAspect || '9:16'} ·{' '}
                        {preset.defaultFullScreen ? 'Full' : preset.defaultLayout}
                      </div>
                    </button>
                    <div className="px-2 pb-1.5 flex items-center justify-between gap-1">
                      <span className="text-[9.5px] text-[var(--pc-muted)] truncate">
                        {preset.isCustom ? 'Custom' : preset.category}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          aria-label={`Edit ${preset.name}`}
                          title={`Edit ${preset.name}`}
                          onClick={() => onOpenTemplateEditor(preset)}
                          className="h-5 w-5 rounded grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface)] bg-transparent border-0 cursor-pointer"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        {templates.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Delete ${preset.name}`}
                            title={`Delete ${preset.name}`}
                            onClick={() => onDeleteTemplate(preset.id)}
                            className="h-5 w-5 rounded grid place-items-center text-[var(--pc-sub)] hover:text-[var(--pc-error)] hover:bg-[var(--pc-surface)] bg-transparent border-0 cursor-pointer"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {canRestoreTemplates && (
              <button
                type="button"
                onClick={onRestoreTemplates}
                className="w-full h-7 rounded-md border border-dashed border-[var(--pc-border)] bg-transparent text-[11px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Restore Deleted / Built-in Templates</span>
              </button>
            )}

            {/* Streamer / Platform Attribution */}
            <InspectorAccordion title="Platform Credit & Card" defaultOpen={false}>
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

            {/* Trending Hashtags by Video Type */}
            <InspectorAccordion
              title="Trending Hashtags"
              badge={clip?.hashtags.length ? `${clip.hashtags.length} active` : hashtagPack.label}
              defaultOpen
            >
              <div className="space-y-2.5" data-testid="trending-hashtags-panel">
                <label className="block space-y-1">
                  <span className="text-[11px] text-[var(--pc-sub)]">Video Type / Niche</span>
                  <select
                    aria-label="Video type for trending hashtags"
                    data-testid="hashtag-niche-select"
                    value={selectedNiche}
                    onChange={(e) => setSelectedNiche(e.target.value as VideoNicheId)}
                    className="w-full h-8 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    {TRENDING_HASHTAG_PACKS.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.label}
                      </option>
                    ))}
                  </select>
                </label>

                <p className="text-[11px] text-[var(--pc-muted)] m-0 leading-snug">
                  {hashtagPack.description} — click tags to add/remove from this clip.
                </p>

                <div className="space-y-1.5">
                  <div className="text-[10.5px] font-medium text-[var(--pc-sub)] flex items-center gap-1">
                    <Flame className="w-3 h-3 text-amber-400" />
                    <span>High-Velocity Viral Tags</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hashtagPack.topViral.map((tag) => {
                      const active = activeClipTags.has(tag.toLowerCase());
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleToggleHashtag(tag)}
                          className={`h-6 px-2 rounded text-[11px] font-mono-tabular border cursor-pointer transition-colors inline-flex items-center gap-1 ${
                            active
                              ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                              : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                          }`}
                        >
                          <span>#{tag}</span>
                          {active && <Check className="w-2.5 h-2.5 text-[var(--pc-accent)]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[10.5px] font-medium text-[var(--pc-sub)] flex items-center gap-1">
                    <Hash className="w-3 h-3 text-[var(--pc-muted)]" />
                    <span>Niche Discovery Tags</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hashtagPack.nicheTags.map((tag) => {
                      const active = activeClipTags.has(tag.toLowerCase());
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={active}
                          onClick={() => handleToggleHashtag(tag)}
                          className={`h-6 px-2 rounded text-[11px] font-mono-tabular border cursor-pointer transition-colors inline-flex items-center gap-1 ${
                            active
                              ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                              : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                          }`}
                        >
                          <span>#{tag}</span>
                          {active && <Check className="w-2.5 h-2.5 text-[var(--pc-accent)]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="apply-top-hashtags-btn"
                    onClick={handleApplyTopHashtags}
                  >
                    Apply Top 5
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handlePutTagsOnVideo}>
                    On Video
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleCopyHashtags}>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </Button>
                </div>
              </div>
            </InspectorAccordion>
          </div>
        )}

        {/* ================= TEXT TAB (HEADLINE HOOK + SUBTITLES .SRT + FONT MANAGER) ================= */}
        {activeTab === 'text' && (
          <div className="space-y-3">
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadCustomFont(f);
                e.target.value = '';
              }}
            />

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
                    <span>Font ({allFontFamilies.length})</span>
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

                <StudioSlider
                  label="Hook Vertical Position"
                  value={settings.headlineY}
                  min={8}
                  max={48}
                  valueLabel={`${settings.headlineY}%`}
                  onChange={(headlineY) => onUpdateSettings({ headlineY }, false)}
                />

                {/* Decompiled Headline Custom Timing & In/Out SFX */}
                <InspectorAccordion title="Hook Timing & Entry SFX" defaultOpen={false}>
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

                {/* Caption Styles Header + Add Custom Style */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] font-semibold text-[var(--pc-ink)]">
                    Caption Styles ({captionPresets.length})
                  </span>
                  <div className="flex items-center gap-1.5">
                    {canRestoreCaptions && (
                      <button
                        type="button"
                        onClick={onRestoreCaptions}
                        title="Restore built-in caption styles"
                        className="h-6 px-1.5 rounded border border-[var(--pc-border)] bg-transparent text-[10.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>Reset</span>
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="toggle-new-caption-style-btn"
                      onClick={() => {
                        setNewCapFont(settings.subtitleFont || 'Montserrat');
                        setNewCapBase(settings.subtitleBaseColor || '#FFFFFF');
                        setNewCapActive(settings.subtitleActiveColor || '#FFE600');
                        setCreatingCaption((v) => !v);
                      }}
                      className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[10.5px] font-medium text-[var(--pc-ink)] hover:border-[var(--pc-accent)] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>New Style</span>
                    </button>
                  </div>
                </div>

                {creatingCaption && (
                  <form
                    onSubmit={handleCreateCaptionStyle}
                    data-testid="new-caption-style-form"
                    className="p-2.5 rounded-lg border border-[var(--pc-accent)]/50 bg-[var(--pc-surface-2)] space-y-2"
                  >
                    <input
                      type="text"
                      required
                      data-testid="new-caption-style-name"
                      value={newCapName}
                      onChange={(e) => setNewCapName(e.target.value)}
                      placeholder="Style name (e.g. Gold Outline)"
                      className="w-full h-7 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-xs text-[var(--pc-ink)]"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={newCapFont}
                        onChange={(e) => setNewCapFont(e.target.value)}
                        className="h-7 px-1.5 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[11px] text-[var(--pc-ink)]"
                      >
                        {allFontFamilies.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newCapPacing}
                        onChange={(e) => setNewCapPacing(e.target.value as WordPacingId)}
                        className="h-7 px-1.5 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[11px] text-[var(--pc-ink)]"
                      >
                        <option value="1">1 Word Punch</option>
                        <option value="2-3">2–3 Words</option>
                        <option value="4-5">4–5 Words</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 items-center">
                      <label className="flex items-center gap-1 text-[10.5px] text-[var(--pc-sub)]">
                        <span>Base</span>
                        <input
                          type="color"
                          value={newCapBase}
                          onChange={(e) => setNewCapBase(e.target.value)}
                          className="h-6 w-7 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                        />
                      </label>
                      <label className="flex items-center gap-1 text-[10.5px] text-[var(--pc-sub)]">
                        <span>Active</span>
                        <input
                          type="color"
                          value={newCapActive}
                          onChange={(e) => setNewCapActive(e.target.value)}
                          className="h-6 w-7 rounded border border-[var(--pc-border)] bg-transparent cursor-pointer"
                        />
                      </label>
                      <select
                        value={newCapAnim}
                        onChange={(e) => setNewCapAnim(e.target.value as CaptionAnimationId)}
                        className="h-6 px-1 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[10.5px] text-[var(--pc-ink)]"
                      >
                        <option value="pop-scale">Pop</option>
                        <option value="karaoke-fill">Karaoke</option>
                        <option value="box-highlight">Box</option>
                        <option value="slide-up">Slide</option>
                        <option value="none">Static</option>
                      </select>
                    </div>
                    <StudioSlider
                      label="Outline Stroke"
                      value={newCapStroke}
                      min={0}
                      max={8}
                      valueLabel={`${newCapStroke}px`}
                      onChange={setNewCapStroke}
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setCreatingCaption(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" variant="primary" size="sm" data-testid="save-caption-style-btn">
                        Save Style
                      </Button>
                    </div>
                  </form>
                )}

                {/* Viral Caption Style Presets Grid (with Delete) */}
                <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto studio-scroll pr-0.5">
                  {captionPresets.map((cp) => {
                    const active = settings.captionStyle === cp.id;
                    return (
                      <div
                        key={cp.id}
                        className={`rounded-md border flex items-stretch justify-between ${
                          active
                            ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)] text-[var(--pc-ink)]'
                            : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:border-[var(--pc-muted)]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectCaptionPreset(cp)}
                          className="px-2 py-1.5 text-left cursor-pointer bg-transparent border-0 min-w-0 flex-1"
                        >
                          <div className="text-[11px] font-semibold text-[var(--pc-ink)] truncate">
                            {cp.name}
                          </div>
                          <div className="text-[9.5px] text-[var(--pc-muted)] truncate flex items-center gap-1 mt-0.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0 border border-white/20"
                              style={{ backgroundColor: cp.activeColor }}
                            />
                            <span className="truncate">{cp.subtitleFont}</span>
                          </div>
                        </button>
                        {captionPresets.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Delete caption style ${cp.name}`}
                            onClick={() => onDeleteCaptionStyle(cp.id)}
                            className="px-1.5 text-[var(--pc-muted)] hover:text-[var(--pc-error)] bg-transparent border-0 cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <label className="block space-y-1 text-[11px] text-[var(--pc-sub)]">
                  <span>Subtitle Font ({allFontFamilies.length})</span>
                  <select
                    value={settings.subtitleFont}
                    onChange={(e) => onUpdateSettings({ subtitleFont: e.target.value }, true)}
                    className="w-full h-7 px-2 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  >
                    {allFontFamilies.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>

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

            {/* Custom Fonts Manager (Upload TTF/OTF + Add Google Font Live) */}
            <InspectorAccordion
              title="Fonts Library"
              badge={`${allFontFamilies.length} fonts`}
              defaultOpen={false}
            >
              <div className="space-y-2.5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => fontInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Font (.ttf / .otf / .woff2)</span>
                </Button>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    data-testid="google-font-input"
                    value={googleFontDraft}
                    onChange={(e) => setGoogleFontDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddGoogleFontSubmit();
                      }
                    }}
                    placeholder="Add Google Font (e.g. Orbitron)"
                    className="flex-1 h-7 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs text-[var(--pc-ink)]"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="add-google-font-btn"
                    onClick={handleAddGoogleFontSubmit}
                  >
                    Add
                  </Button>
                </div>

                {customFonts.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="text-[10.5px] text-[var(--pc-muted)]">Added Custom Fonts</div>
                    {customFonts.map((cf) => (
                      <div
                        key={cf.id}
                        className="flex items-center justify-between px-2 py-1 rounded bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs"
                      >
                        <span className="truncate text-[var(--pc-ink)]">{cf.family}</span>
                        <button
                          type="button"
                          aria-label={`Remove font ${cf.family}`}
                          onClick={() => onDeleteCustomFont(cf.id)}
                          className="text-[var(--pc-sub)] hover:text-[var(--pc-error)] bg-transparent border-0 p-0 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </InspectorAccordion>
          </div>
        )}

        {/* ================= MEDIA TAB (BGM + COPYRIGHT-FREE MUSIC + SFX + LOGOS LIBRARY + OUTRO) ================= */}
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

            {/* 2. Background Music + Copyright-Free Viral Music Catalog */}
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

                {/* Curated Copyright-Free Viral Music Browser */}
                <div
                  data-testid="copyright-free-music-browser"
                  className="pt-2 border-t border-[var(--pc-border-subtle)] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--pc-ink)]">
                      Copyright-Free Viral Music
                    </span>
                    <button
                      type="button"
                      aria-pressed={viralOnlyMusic}
                      data-testid="music-viral-only-toggle"
                      onClick={() => setViralOnlyMusic((v) => !v)}
                      className={`h-6 px-2 rounded border text-[10.5px] font-medium inline-flex items-center gap-1 cursor-pointer ${
                        viralOnlyMusic
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                          : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)]'
                      }`}
                    >
                      <Flame className="w-3 h-3" />
                      <span>Viral Only</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {MUSIC_MOOD_OPTIONS.map((m) => {
                      const active = musicMood === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          data-testid={`music-mood-${m.id}`}
                          onClick={() => setMusicMood(m.id)}
                          className={`h-6 px-2 rounded text-[10.5px] font-medium border cursor-pointer transition-colors ${
                            active
                              ? 'bg-[var(--pc-cta-bg)] text-[var(--pc-cta-fg)] border-transparent'
                              : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                          }`}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-1.5 max-h-56 overflow-y-auto studio-scroll pr-0.5">
                    {filteredMusic.map((track) => (
                      <div
                        key={track.id}
                        className="p-2 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)] space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11.5px] font-semibold text-[var(--pc-ink)] truncate">
                              {track.title}
                            </div>
                            <div className="text-[10px] font-mono-tabular text-[var(--pc-muted)] truncate">
                              {track.artist} · {track.bpm} BPM ·{' '}
                              {track.license === 'No Attribution (YT Safe)' ? 'YT Safe' : 'CC BY'}
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={`Preview ${track.title}`}
                            title="Audition mood tempo"
                            onClick={() => auditionTrackMood(track)}
                            className="h-6 w-6 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[var(--pc-accent)] grid place-items-center cursor-pointer shrink-0"
                          >
                            <Play className="w-3 h-3 fill-current" />
                          </button>
                        </div>
                        <div className="text-[10px] text-[var(--pc-sub)] leading-snug">
                          {track.bestFor}
                        </div>
                        <div className="flex items-center justify-between gap-1.5 pt-0.5">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleApplyCatalogTrack(track)}
                              className="h-6 px-2 rounded border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[10.5px] font-medium text-[var(--pc-ink)] hover:border-[var(--pc-accent)] cursor-pointer"
                            >
                              Apply Mix
                            </button>
                            {track.attributionText && (
                              <button
                                type="button"
                                onClick={() => handleCopyAttribution(track)}
                                title="Copy required CC BY credit for YouTube description"
                                className="h-6 px-1.5 rounded border border-[var(--pc-border)] bg-transparent text-[10px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Copy className="w-2.5 h-2.5" />
                                <span>Credit</span>
                              </button>
                            )}
                          </div>
                          <a
                            href={track.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-medium text-[var(--pc-accent)] hover:underline inline-flex items-center gap-0.5"
                          >
                            <span>Get Track</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
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
              defaultOpen={false}
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
                          className="text-[var(--pc-sub)] hover:text-[var(--pc-error)] bg-transparent border-0 p-0 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </InspectorAccordion>

            {/* 4. Logos Library & Dual Watermark */}
            <InspectorAccordion title="Logos & Dual Watermark" badge={`${logos.length} logos`} defaultOpen>
              <input
                ref={wmLogoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadLogo(f);
                  e.target.value = '';
                }}
              />
              <div className="space-y-2.5" data-testid="logos-library-panel">
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
                        { value: 'image', label: 'Logo Asset' },
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
                      <div className="space-y-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          onClick={() => wmLogoInputRef.current?.click()}
                        >
                          <ImagePlus className="w-3.5 h-3.5" />
                          <span>Upload Logo (PNG / SVG)</span>
                        </Button>

                        <div className="grid grid-cols-2 gap-1.5">
                          {logos.map((logo) => {
                            const active = shorts.dualWatermark.customLogoUrl === logo.dataUrl;
                            return (
                              <div
                                key={logo.id}
                                className={`rounded-md border p-1.5 flex flex-col gap-1.5 ${
                                  active
                                    ? 'bg-[var(--pc-accent-soft)] border-[var(--pc-accent)]'
                                    : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)]'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    onUpdateBrandKit({ ...brandKit, showWatermark: true });
                                    onUpdateShorts({
                                      dualWatermark: {
                                        ...shorts.dualWatermark,
                                        useCustomLogo: true,
                                        customLogoUrl: logo.dataUrl,
                                        customLogoName: logo.name,
                                      },
                                    });
                                    onNotify(`Applied logo: ${logo.name}`);
                                  }}
                                  className="flex items-center gap-2 text-left bg-transparent border-0 p-0 cursor-pointer w-full"
                                >
                                  <img
                                    src={logo.dataUrl}
                                    alt={logo.name}
                                    className="w-7 h-7 rounded object-contain bg-black/40 p-0.5 shrink-0"
                                  />
                                  <span className="text-[10.5px] font-medium text-[var(--pc-ink)] truncate">
                                    {logo.name}
                                  </span>
                                </button>
                                <div className="flex items-center justify-between gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onUpdateShorts({
                                        outro: {
                                          ...shorts.outro,
                                          enabled: true,
                                          mode: 'template',
                                          logoDataUrl: logo.dataUrl,
                                        },
                                      });
                                      onNotify(`Set "${logo.name}" as Outro Card logo`);
                                    }}
                                    className="text-[9.5px] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] bg-transparent border-0 p-0 cursor-pointer"
                                  >
                                    Use in Outro
                                  </button>
                                  {logo.isCustom && (
                                    <button
                                      type="button"
                                      aria-label={`Delete logo ${logo.name}`}
                                      onClick={() => onDeleteLogo(logo.id)}
                                      className="text-[var(--pc-sub)] hover:text-[var(--pc-error)] bg-transparent border-0 p-0 cursor-pointer"
                                    >
                                      <Trash2 className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <StudioSlider
                          label="Logo Size"
                          value={shorts.dualWatermark.customLogoScale}
                          min={8}
                          max={50}
                          valueLabel={`${shorts.dualWatermark.customLogoScale}%`}
                          onChange={(customLogoScale) =>
                            onUpdateShorts({
                              dualWatermark: { ...shorts.dualWatermark, customLogoScale },
                            })
                          }
                        />
                      </div>
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

        {/* ================= ADJUST TAB (COLOR GRADING, FX, MOTION & TRANSITIONS) ================= */}
        {activeTab === 'adjust' && (
          <div className="space-y-3">
            <InspectorAccordion title="Color Grading Filters" defaultOpen>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { id: 'none', label: 'Natural' },
                  { id: 'cinematic', label: 'Cinematic' },
                  { id: 'warm', label: 'Warm Gold' },
                  { id: 'moody', label: 'Moody Dark' },
                  { id: 'vintage', label: 'Vintage 90s' },
                  { id: 'bw', label: 'B&W Film' },
                  { id: 'cyberpunk', label: 'Cyberpunk' },
                ] as const).map((f) => {
                  const active = (settings.colorFilter || 'none') === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={active}
                      data-testid={`color-filter-${f.id}`}
                      onClick={() => onUpdateSettings({ colorFilter: f.id }, true)}
                      className={`h-8 px-1.5 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                        active
                          ? 'border-[var(--pc-accent)] bg-[var(--pc-accent-soft)] text-[var(--pc-ink)] font-semibold'
                          : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </InspectorAccordion>

            <InspectorAccordion title="Color Adjustments" defaultOpen>
              <div className="space-y-3.5">
                <StudioSlider
                  label="Brightness"
                  value={settings.brightness ?? 100}
                  min={50}
                  max={150}
                  unit="%"
                  onChange={(brightness) => onUpdateSettings({ brightness }, false)}
                />
                <StudioSlider
                  label="Contrast"
                  value={settings.contrast ?? 100}
                  min={50}
                  max={150}
                  unit="%"
                  onChange={(contrast) => onUpdateSettings({ contrast }, false)}
                />
                <StudioSlider
                  label="Saturation"
                  value={settings.saturation ?? 100}
                  min={0}
                  max={200}
                  unit="%"
                  onChange={(saturation) => onUpdateSettings({ saturation }, false)}
                />
                <StudioSlider
                  label="Exposure"
                  value={settings.exposure ?? 0}
                  min={-50}
                  max={50}
                  onChange={(exposure) => onUpdateSettings({ exposure }, false)}
                />
                <StudioSlider
                  label="Temperature (Warm / Cool)"
                  value={settings.temperature ?? 0}
                  min={-50}
                  max={50}
                  onChange={(temperature) => onUpdateSettings({ temperature }, false)}
                />
              </div>
            </InspectorAccordion>

            <InspectorAccordion title="Effects & Optics" defaultOpen>
              <div className="space-y-3.5">
                <StudioSlider
                  label="Vignette"
                  value={settings.vignette ?? 0}
                  min={0}
                  max={100}
                  unit="%"
                  onChange={(vignette) => onUpdateSettings({ vignette }, false)}
                />
                <StudioSlider
                  label="Background Soften / Blur"
                  value={settings.blur ?? 0}
                  min={0}
                  max={20}
                  unit="px"
                  onChange={(blur) => onUpdateSettings({ blur }, false)}
                />
              </div>
            </InspectorAccordion>

            <InspectorAccordion title="Motion & Speed Ramping" defaultOpen>
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <span className="block text-[11px] text-[var(--pc-sub)]">
                    Clip Speed Multiplier
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => {
                      const active = (settings.speedMultiplier ?? 1) === spd;
                      return (
                        <button
                          key={spd}
                          type="button"
                          aria-pressed={active}
                          data-testid={`speed-${spd}`}
                          onClick={() => onUpdateSettings({ speedMultiplier: spd }, true)}
                          className={`h-7 px-2 rounded-md font-mono-tabular text-xs border transition-colors cursor-pointer ${
                            active
                              ? 'border-[var(--pc-accent)] bg-[var(--pc-accent-soft)] text-[var(--pc-accent)] font-bold'
                              : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                          }`}
                        >
                          {spd}x
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-[var(--pc-border-subtle)]">
                  <span className="block text-[11px] text-[var(--pc-sub)]">
                    Cut Transition Style
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { id: 'cut', label: 'Hard Cut' },
                      { id: 'crossfade', label: 'Crossfade' },
                      { id: 'zoom-in', label: 'Zoom Punch' },
                      { id: 'dip-black', label: 'Dip to Black' },
                      { id: 'glitch', label: 'Glitch Flash' },
                    ] as const).map((t) => {
                      const active = (settings.transitionStyle || 'cut') === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          aria-pressed={active}
                          data-testid={`transition-${t.id}`}
                          onClick={() => onUpdateSettings({ transitionStyle: t.id }, true)}
                          className={`h-7 px-1.5 rounded-md text-[11px] border transition-colors cursor-pointer ${
                            active
                              ? 'border-[var(--pc-accent)] bg-[var(--pc-accent-soft)] text-[var(--pc-ink)] font-semibold'
                              : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <StudioSlider
                  label="Transition Duration"
                  value={settings.transitionDurationSec ?? 0.3}
                  min={0}
                  max={2}
                  step={0.1}
                  unit="s"
                  onChange={(transitionDurationSec) =>
                    onUpdateSettings({ transitionDurationSec }, false)
                  }
                />
              </div>
            </InspectorAccordion>
          </div>
        )}

        {/* ================= AUDIO TAB (ADVANCED MASTER AUDIO) ================= */}
        {activeTab === 'audio' && (
          <div className="space-y-3">
            <InspectorAccordion title="Master Audio Controls" defaultOpen>
              <div className="space-y-3.5">
                <StudioSlider
                  label="Master Volume"
                  value={settings.masterVolume ?? 100}
                  min={0}
                  max={200}
                  unit="%"
                  onChange={(masterVolume) => onUpdateSettings({ masterVolume }, false)}
                />
                <StudioSwitch
                  label="EBU R128 Loudness Normalization"
                  description="Normalizes broadcast audio level to prevent distortion and clipping"
                  checked={settings.audioNormalize ?? true}
                  onChange={(audioNormalize) => onUpdateSettings({ audioNormalize }, true)}
                />
                {settings.audioNormalize && (
                  <StudioSlider
                    label="Target Integrated LUFS"
                    value={settings.targetLufs ?? -14}
                    min={-24}
                    max={-9}
                    step={0.5}
                    unit=" LUFS"
                    onChange={(targetLufs) => onUpdateSettings({ targetLufs }, false)}
                  />
                )}
                <StudioSwitch
                  label="Smart Audio Ducking"
                  description="Dips background music bed when dialogue or lyrics are detected"
                  checked={settings.audioDucking ?? true}
                  onChange={(audioDucking) => onUpdateSettings({ audioDucking }, true)}
                />
                <StudioSwitch
                  label="Mute Native Source Audio"
                  description="Silences camera audio to replace entirely with music bed"
                  checked={settings.muteOriginalAudio ?? false}
                  onChange={(muteOriginalAudio) => onUpdateSettings({ muteOriginalAudio }, true)}
                />
              </div>
            </InspectorAccordion>

            <InspectorAccordion title="Fades & Sound FX" defaultOpen>
              <div className="space-y-3.5">
                <StudioSlider
                  label="Audio Fade In"
                  value={settings.audioFadeInSec ?? 0}
                  min={0}
                  max={3}
                  step={0.1}
                  unit="s"
                  onChange={(audioFadeInSec) => onUpdateSettings({ audioFadeInSec }, false)}
                />
                <StudioSlider
                  label="Audio Fade Out"
                  value={settings.audioFadeOutSec ?? 0.5}
                  min={0}
                  max={3}
                  step={0.1}
                  unit="s"
                  onChange={(audioFadeOutSec) => onUpdateSettings({ audioFadeOutSec }, false)}
                />
              </div>
            </InspectorAccordion>
          </div>
        )}
      </div>
    </aside>
  );
}
