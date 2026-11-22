import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignHorizontalJustifyCenter,
  Check,
  Crop,
  Lock,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type {
  BrandKit,
  ClipItem,
  ClipSegment,
  CustomFontEntry,
  EditorSettings,
  FramingBlueprint,
  PreviewResolutionId,
  ShortsProductionConfig,
  TrackStates,
} from '../../types';
import {
  describeFramingBlueprint,
  getCanvasAspectRatio,
} from '../../lib/framingEngine';
import {
  buildVideoGradingCssFilter,
  buildVideoTransformCss,
  computeOutroAnimationFrame,
  computeTransitionPreviewEffect,
} from '../../lib/shortsEngine';
import {
  applyWordCasing,
  getActiveWordBeat,
  getSafeZoneSpec,
  getViralFont,
} from '../../captionStyles';
import { getTemplatePreset } from '../../presets';
import {
  InstagramIcon,
  KickLogoIcon,
  YouTubeShortsIcon,
} from '../ui/PlatformIcons';
import { FramedCanvasView } from './FramedCanvasView';

interface ShortsStageProps {
  clip: ClipItem;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  blueprint: FramingBlueprint;
  shorts: ShortsProductionConfig;
  settings: EditorSettings;
  brandKit: BrandKit;
  customFonts: readonly CustomFontEntry[];
  activeSegments: readonly ClipSegment[];
  activeTemplateName?: string;
  currentTimeSec: number;
  stitchedTimeSec: number;
  previewRes: PreviewResolutionId;
  finalPreviewLocked: boolean;
  compareOriginal: boolean;
  outroElapsedSec: number | null;
  showSafeZones: boolean;
  trackStates: TrackStates;
  onEditFraming: () => void;
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  onUpdateDualWatermark: (patch: Partial<ShortsProductionConfig['dualWatermark']>) => void;
  onVideoMetadata: (durationSec: number) => void;
  onVideoTimeUpdate: (timeSec: number) => void;
  onVideoEnded: () => void;
}

type OverlayElementId =
  | 'channel-card'
  | 'headline'
  | 'subtitles'
  | 'streamer'
  | 'watermark1'
  | 'watermark2';
type DragTarget = OverlayElementId;

const OVERLAY_LABELS: Record<OverlayElementId, string> = {
  'channel-card': 'Social Card',
  headline: 'Headline',
  subtitles: 'Subtitles',
  streamer: 'Attribution',
  watermark1: 'Watermark',
  watermark2: 'Tag Overlay',
};

export function ShortsStage({
  clip,
  videoRef,
  blueprint,
  shorts,
  settings,
  brandKit,
  customFonts,
  activeSegments,
  activeTemplateName,
  currentTimeSec,
  stitchedTimeSec,
  previewRes,
  finalPreviewLocked,
  compareOriginal,
  outroElapsedSec,
  showSafeZones,
  trackStates,
  onEditFraming,
  onUpdateSettings,
  onUpdateDualWatermark,
  onVideoMetadata,
  onVideoTimeUpdate,
  onVideoEnded,
}: ShortsStageProps) {
  const frameRef = useRef<HTMLDivElement>(null);

  // Overlay element selection — every draggable preview element gets an id so it can
  // be highlighted, centered, reset, or hidden via Delete/Backspace or the floating bar.
  const [selectedElement, setSelectedElement] = useState<OverlayElementId | null>(null);
  const [comparePct, setComparePct] = useState(50);
  const hiddenElements = settings.hiddenElements || [];
  const isElementHidden = (id: OverlayElementId) => hiddenElements.includes(id);
  const selectionOutline = (id: OverlayElementId) =>
    selectedElement === id ? 'outline outline-2 outline-sky-400' : '';

  const deleteSelectedElement = useCallback(() => {
    if (!selectedElement) return;
    const nextHidden = settings.hiddenElements || [];
    if (!nextHidden.includes(selectedElement)) {
      onUpdateSettings({ hiddenElements: [...nextHidden, selectedElement] }, true);
    }
    setSelectedElement(null);
  }, [onUpdateSettings, selectedElement, settings.hiddenElements]);

  const centerSelectedElement = useCallback(() => {
    if (!selectedElement) return;
    if (selectedElement === 'channel-card') {
      const w = settings.channelCardWidth ?? 88;
      onUpdateSettings({ channelCardX: Math.round((100 - w) / 2) }, true);
    } else if (selectedElement === 'headline') {
      onUpdateSettings({ headlineX: 50 }, true);
    } else if (selectedElement === 'subtitles') {
      onUpdateSettings({ subtitleX: 50 }, true);
    } else if (selectedElement === 'streamer') {
      onUpdateSettings({ streamerBadgeX: 50 }, true);
    } else if (selectedElement === 'watermark1') {
      onUpdateSettings({ watermarkX: 50 }, true);
    } else if (selectedElement === 'watermark2') {
      onUpdateDualWatermark({ secondaryX: 50 });
    }
  }, [onUpdateDualWatermark, onUpdateSettings, selectedElement, settings.channelCardWidth]);

  const resetSelectedElementPos = useCallback(() => {
    if (!selectedElement) return;
    if (selectedElement === 'channel-card') {
      onUpdateSettings({ channelCardX: 6, channelCardY: 6 }, true);
    } else if (selectedElement === 'headline') {
      onUpdateSettings({ headlineX: 50, headlineY: 22 }, true);
    } else if (selectedElement === 'subtitles') {
      const spec = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
      onUpdateSettings({ subtitleX: 50, subtitleVerticalPos: spec.autoAlignSubtitlePct }, true);
    } else if (selectedElement === 'streamer') {
      onUpdateSettings({ streamerBadgeX: 50, streamerBadgeY: 85 }, true);
    } else if (selectedElement === 'watermark1') {
      onUpdateSettings({ watermarkX: 50, watermarkY: 77 }, true);
    } else if (selectedElement === 'watermark2') {
      onUpdateDualWatermark({ secondaryX: 50, secondaryY: 90 });
    }
  }, [
    onUpdateDualWatermark,
    onUpdateSettings,
    selectedElement,
    settings.safeZonePlatform,
    settings.template,
  ]);

  const startDragCompare = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const updatePct = (clientX: number) => {
      if (rect.width <= 0) return;
      const pct = Math.max(8, Math.min(92, Math.round(((clientX - rect.left) / rect.width) * 100)));
      setComparePct(pct);
    };
    const onMove = (ev: PointerEvent) => updatePct(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (!selectedElement) return;
      const focused = document.activeElement as HTMLElement | null;
      if (
        focused &&
        (focused.tagName === 'INPUT' ||
          focused.tagName === 'TEXTAREA' ||
          focused.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      deleteSelectedElement();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedElement, selectedElement]);

  const canvasAr = getCanvasAspectRatio(blueprint.aspect);
  const templatePreset = getTemplatePreset(settings.template);
  const safeSpec = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
  const headlineFont = getViralFont(settings.font, customFonts);
  const subtitleFont = getViralFont(settings.subtitleFont, customFonts);

  // Active word cue chunk at currentTimeSec
  const activeBeat = useMemo(
    () =>
      getActiveWordBeat(
        clip.words,
        settings.subtitleWordsPerScreen,
        currentTimeSec
      ),
    [clip.words, currentTimeSec, settings.subtitleWordsPerScreen]
  );
  const activeChunk = activeBeat?.chunk ?? null;

  // Determine headline visibility under Final Preview Lock custom timing
  const headlineVisible = useMemo(() => {
    if (!settings.headline.trim() || settings.headlineLayout === 'none') return false;
    if (!finalPreviewLocked || shorts.headlineTiming.mode === 'always') return true;
    return (
      stitchedTimeSec >= shorts.headlineTiming.startSec &&
      stitchedTimeSec <= shorts.headlineTiming.endSec
    );
  }, [
    settings.headline,
    settings.headlineLayout,
    finalPreviewLocked,
    shorts.headlineTiming,
    stitchedTimeSec,
  ]);

  const startDragOverlay = (target: DragTarget, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedElement(target);
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    // Preserve the exact grab point so a card drag does not jump to the cursor.
    const grabOffsetX =
      target === 'channel-card'
        ? rect.left + ((settings.channelCardX ?? 6) / 100) * rect.width - e.clientX
        : 0;
    const grabOffsetY =
      target === 'channel-card'
        ? rect.top + ((settings.channelCardY ?? 6) / 100) * rect.height - e.clientY
        : 0;

    const updateFromClient = (clientX: number, clientY: number, record: boolean) => {
      const rawX = ((clientX + grabOffsetX - rect.left) / rect.width) * 100;
      const rawY = ((clientY + grabOffsetY - rect.top) / rect.height) * 100;
      const xPct =
        target === 'channel-card'
          ? Math.round(Math.max(0, Math.min(100, rawX)))
          : Math.round(Math.max(5, Math.min(95, rawX)));
      const yPct =
        target === 'channel-card'
          ? Math.round(Math.max(0, Math.min(100, rawY)))
          : Math.round(Math.max(5, Math.min(95, rawY)));
      if (target === 'channel-card') {
        onUpdateSettings({ channelCardX: xPct, channelCardY: yPct }, record);
      } else if (target === 'headline') {
        onUpdateSettings({ headlineX: xPct, headlineY: yPct }, record);
      } else if (target === 'subtitles') {
        onUpdateSettings({ subtitleX: xPct, subtitleVerticalPos: yPct }, record);
      } else if (target === 'streamer') {
        onUpdateSettings({ streamerBadgeX: xPct, streamerBadgeY: yPct }, record);
      } else if (target === 'watermark1') {
        onUpdateSettings({ watermarkX: xPct, watermarkY: yPct }, record);
      } else if (target === 'watermark2') {
        onUpdateDualWatermark({ secondaryX: xPct, secondaryY: yPct });
      }
    };

    const onMove = (ev: PointerEvent) => updateFromClient(ev.clientX, ev.clientY, false);
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      updateFromClient(ev.clientX, ev.clientY, true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Resolved platform attribution icon
  const resolvedPlatform =
    settings.streamerPlatform === 'auto'
      ? settings.template === 'kick-stream' ||
        settings.template === 'split-stream' ||
        settings.template === 'dual_react'
        ? 'kick'
        : settings.template === 'insta-short'
          ? 'instagram'
          : settings.template === 'yt-short'
            ? 'youtube'
            : clip.platform === 'Kick'
              ? 'kick'
              : clip.platform === 'Instagram'
                ? 'instagram'
                : clip.platform === 'YouTube'
                  ? 'youtube'
                  : 'none'
      : settings.streamerPlatform;

  const isXCard =
    settings.templateEnabled &&
    (settings.template === 'x_light' || settings.template === 'x_dark');
  const isNewsBroadcast =
    settings.templateEnabled &&
    (settings.template === 'breaking_news' || settings.template === 'breaking-news');

  const outroAnim =
    outroElapsedSec !== null ? computeOutroAnimationFrame(outroElapsedSec, shorts.outro) : null;

  const videoFilterCss = useMemo(() => buildVideoGradingCssFilter(settings), [settings]);
  const baseTransformCss = useMemo(() => buildVideoTransformCss(settings), [settings]);
  const transitionEffect = useMemo(
    () =>
      computeTransitionPreviewEffect(
        currentTimeSec,
        activeSegments,
        settings.transitionStyle || 'cut',
        settings.transitionDurationSec ?? 0.3
      ),
    [currentTimeSec, activeSegments, settings.transitionStyle, settings.transitionDurationSec]
  );

  const combinedCanvasStyle = useMemo<React.CSSProperties>(() => {
    const parts: string[] = [];
    if (baseTransformCss.transform && baseTransformCss.transform !== 'none') {
      parts.push(baseTransformCss.transform);
    }
    if (transitionEffect.scale !== 1) {
      parts.push(`scale(${transitionEffect.scale.toFixed(3)})`);
    }
    if (transitionEffect.translateX !== 0) {
      parts.push(`translateX(${transitionEffect.translateX.toFixed(2)}%)`);
    }
    const opacity = Math.max(0, Math.min(1, baseTransformCss.opacity * transitionEffect.opacity));
    return {
      transform: parts.length > 0 ? parts.join(' ') : undefined,
      transformOrigin: 'center center',
      opacity,
    };
  }, [baseTransformCss, transitionEffect]);

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-between p-3 gap-2 overflow-hidden bg-[var(--pc-canvas)]">
      {/* Offscreen source video element that powers the FramedCanvasView 2D compositor + master audio */}
      {(clip.rawMediaUrl || clip.mediaUrl) && (
        <video
          ref={videoRef}
          src={clip.rawMediaUrl || clip.mediaUrl}
          playsInline
          preload="auto"
          muted={trackStates.a1Muted || settings.muteOriginalAudio}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) {
              onVideoMetadata(v.duration);
            }
          }}
          onTimeUpdate={(e) => onVideoTimeUpdate(e.currentTarget.currentTime)}
          onEnded={onVideoEnded}
          className="fixed -left-[9999px] top-0 w-px h-px opacity-0 pointer-events-none"
        />
      )}

      {/* Read-Only Active Framing Blueprint Strip (links directly back to Section 1) */}
      <div
        data-testid="active-framing-blueprint-bar"
        className="w-full max-w-[680px] shrink-0 px-3 py-1.5 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] flex items-center justify-between gap-3 text-xs"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Crop className="w-3.5 h-3.5 text-[var(--pc-accent)] shrink-0" />
          <span className="text-[var(--pc-sub)] whitespace-nowrap">Framing Blueprint:</span>
          <span className="font-mono-tabular font-medium text-[var(--pc-ink)] truncate">
            {describeFramingBlueprint(blueprint)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {finalPreviewLocked && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono-tabular text-[var(--pc-ok)]">
              <Lock className="w-3 h-3" />
              <span>Final Preview</span>
            </span>
          )}
          <button
            type="button"
            data-testid="edit-framing-jump-btn"
            onClick={onEditFraming}
            className="h-6 px-2.5 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[11px] font-medium text-[var(--pc-ink)] hover:border-[var(--pc-muted)] inline-flex items-center gap-1 cursor-pointer transition-colors"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Edit Framing</span>
          </button>
        </div>
      </div>

      {/* Main Live Shorts Preview Frame (driven 1:1 by FramingBlueprint 2D Canvas) */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
        <div
          ref={frameRef}
          data-testid="shorts-preview-frame"
          onPointerDown={() => setSelectedElement(null)}
          style={{ aspectRatio: String(canvasAr) }}
          className="relative h-full max-h-full max-w-full rounded-xl overflow-hidden bg-black border border-[var(--pc-border)] shadow-2xl select-none"
        >
          {/* Layer 1: Exact Framed 2D Canvas from Section 1 Blueprint + Grading & Transforms */}
          <FramedCanvasView
            videoRef={videoRef}
            blueprint={blueprint}
            previewRes={previewRes}
            v1Hidden={!trackStates.v1Visible}
            mediaSrc={clip.rawMediaUrl || clip.mediaUrl}
            filter={videoFilterCss}
            transformStyle={combinedCanvasStyle}
            testId="shorts-compositor-canvas"
            className="w-full h-full"
          />

          {/* Before / After Split Wipe Comparison Layer */}
          {compareOriginal && (
            <>
              <div
                data-testid="shorts-compare-original-layer"
                className="absolute inset-0 z-10 pointer-events-none overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - comparePct}% 0 0)` }}
              >
                <FramedCanvasView
                  videoRef={videoRef}
                  blueprint={blueprint}
                  previewRes={previewRes}
                  v1Hidden={!trackStates.v1Visible}
                  mediaSrc={clip.rawMediaUrl || clip.mediaUrl}
                  className="w-full h-full"
                />
              </div>
              <div
                data-testid="shorts-compare-divider"
                onPointerDown={startDragCompare}
                style={{ left: `${comparePct}%` }}
                className="absolute top-0 bottom-0 z-40 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.8)] cursor-ew-resize -translate-x-1/2"
              >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-7 w-4 rounded-full bg-white text-black border border-black/30 shadow-md grid place-items-center text-[9px] font-bold">
                  ⇄
                </div>
              </div>
              <div className="absolute top-2 left-2 z-40 px-1.5 py-0.5 rounded bg-black/75 text-white text-[9.5px] font-mono-tabular pointer-events-none">
                Original
              </div>
              <div className="absolute top-2 right-2 z-40 px-1.5 py-0.5 rounded bg-black/75 text-white text-[9.5px] font-mono-tabular pointer-events-none">
                Graded
              </div>
            </>
          )}

          {/* Dip-to-Black live transition preview */}
          {transitionEffect.dipBlackOpacity > 0 && (
            <div
              className="absolute inset-0 z-15 bg-black pointer-events-none"
              style={{ opacity: transitionEffect.dipBlackOpacity }}
            />
          )}

          {/* Vignette overlay (Color & FX) — above the canvas, below text/UI overlay layers */}
          {settings.vignette > 0 && (
            <div
              data-testid="shorts-vignette-overlay"
              className="absolute inset-0 z-10 pointer-events-none"
              style={{
                background: `radial-gradient(circle at center, transparent 40%, rgba(0, 0, 0, ${settings.vignette / 100}) 100%)`,
              }}
            />
          )}

          {/* Layer 2: Whole-Video Template Chrome (X-Tweet Header Card / Breaking News Banner) */}
          {isXCard && !isElementHidden('channel-card') && (
            <div
              data-testid="channel-card-preview"
              onPointerDown={(e) => startDragOverlay('channel-card', e)}
              style={{
                left: `${settings.channelCardX ?? 6}%`,
                top: `${settings.channelCardY ?? 6}%`,
                width: `${settings.channelCardWidth ?? 88}%`,
              }}
              className={`absolute z-20 rounded-xl p-3 shadow-xl cursor-move pointer-events-auto ${
                settings.cardTheme === 'light'
                  ? 'bg-white text-[#0F1419]'
                  : 'bg-[#121417] text-white border border-white/15'
              } ${selectionOutline('channel-card')}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-7 h-7 rounded-full bg-zinc-700 grid place-items-center text-[11px] font-bold text-white shrink-0">
                  {(brandKit.displayName || settings.streamerHandle || 'P').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="text-[12px] font-bold flex items-center gap-1 truncate">
                    <span>{brandKit.displayName || settings.streamerHandle || 'Creator'}</span>
                    {brandKit.verified && (
                      <span className="w-3.5 h-3.5 rounded-full bg-[#1D9BF0] text-white inline-grid place-items-center">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] opacity-65 truncate">
                    {brandKit.handle || `@${(settings.streamerHandle || 'creator').replace(/^@/, '')}`}
                  </div>
                </div>
              </div>
              <p className="m-0 text-[12px] font-medium leading-snug">
                {settings.pinnedStatement || settings.headline || clip.title}
              </p>
            </div>
          )}

          {isNewsBroadcast && (
            <div className="absolute bottom-[10%] left-0 right-0 px-3 pointer-events-none">
              <div className="bg-[#DC2626] text-white text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 inline-block">
                Breaking News
              </div>
              <div className="bg-white text-black text-[12px] font-bold px-2.5 py-1.5 leading-tight shadow-md">
                {settings.headline || clip.title}
              </div>
            </div>
          )}

          {/* Layer 3: Draggable Headline Hook (honors Custom Timing in Final Preview!) */}
          {headlineVisible && !isElementHidden('headline') && !isXCard && !isNewsBroadcast && (
            <div
              data-testid="shorts-headline-overlay"
              onPointerDown={(e) => startDragOverlay('headline', e)}
              style={{
                left: `${settings.headlineX}%`,
                top: `${settings.headlineY}%`,
                width: `${settings.headlineMaxWidth}%`,
                maxWidth: '94%',
                transform: 'translate(-50%, -50%)',
                fontFamily: `"${headlineFont.family}", sans-serif`,
                fontSize: `${Math.max(11, Math.round(settings.headlineSize * 0.62))}px`,
                textAlign: settings.headlineAlign,
              }}
              className={`absolute z-20 cursor-move px-1 transition-opacity duration-200 ${selectionOutline('headline')}`}
            >
              <span
                style={
                  settings.headlineLayout === 'outline-only'
                    ? {
                        color: '#FFFFFF',
                        WebkitTextStroke: '1.4px #000000',
                        paintOrder: 'stroke fill',
                        textShadow: '0 3px 8px rgba(0,0,0,0.95)',
                      }
                    : undefined
                }
                className={
                  settings.headlineLayout === 'white-stepped'
                    ? 'bg-white text-[#09090B] font-bold px-2.5 py-1 rounded-md box-decoration-clone leading-[1.35] shadow-md'
                    : settings.headlineLayout === 'dark-stepped'
                      ? 'bg-black/90 text-white font-bold px-2.5 py-1 rounded-md box-decoration-clone leading-[1.35] shadow-md'
                      : settings.headlineLayout === 'solid-banner'
                        ? 'bg-[#EF4444] text-white font-extrabold px-2.5 py-1 rounded uppercase leading-tight shadow-md'
                        : 'text-white font-black leading-tight tracking-tight'
                }
              >
                {applyWordCasing(settings.headline, settings.headlineCasing)}
              </span>
            </div>
          )}

          {/* Layer 4: Draggable Word-Synced Viral Subtitles (CC track) */}
          {trackStates.ccVisible && activeChunk && !isElementHidden('subtitles') && (
            <div
              data-testid="shorts-subtitle-overlay"
              onPointerDown={(e) => startDragOverlay('subtitles', e)}
              style={{
                left: `${settings.subtitleX}%`,
                top: `${settings.subtitleVerticalPos}%`,
                width: `${settings.subtitleMaxWidth}%`,
                maxWidth: '94%',
                transform: 'translate(-50%, -50%)',
                fontFamily: `"${subtitleFont.family}", sans-serif`,
                fontSize: `${Math.max(12, Math.round(settings.subtitleSize * 0.68))}px`,
                lineHeight: settings.subtitleLineHeight,
                textAlign: settings.subtitleAlign,
              }}
              className={`absolute z-20 cursor-move px-1 flex justify-center ${selectionOutline('subtitles')}`}
            >
              <div
                className={`inline-flex flex-wrap justify-center gap-x-1.5 gap-y-0.5 ${
                  settings.subtitleBgStyle === 'white-stepped'
                    ? 'bg-white px-2.5 py-1 rounded-md shadow-md'
                    : settings.subtitleBgStyle === 'dark-pill'
                      ? 'bg-black/80 px-2.5 py-1 rounded-lg'
                      : ''
                }`}
              >
                {activeChunk.tokens.map((tok, idx) => {
                  const currentMs = currentTimeSec * 1000;
                  const beforeChunkStart =
                    activeChunk.tokens.length > 0 && currentMs < activeChunk.tokens[0].start_ms;
                  const isActive =
                    (currentMs >= tok.start_ms && currentMs <= tok.end_ms) ||
                    (beforeChunkStart && idx === 0);
                  const color =
                    tok.emphasisColor ||
                    (settings.subtitleBgStyle === 'white-stepped'
                      ? '#09090B'
                      : isActive
                        ? settings.subtitleActiveColor
                        : settings.subtitleBaseColor);
                  return (
                    <span
                      key={`${tok.text}-${idx}`}
                      style={{
                        color,
                        fontWeight: 900,
                        WebkitTextStroke:
                          settings.subtitleBgStyle === 'white-stepped'
                            ? undefined
                            : `${Math.min(1.4, Math.max(0.6, settings.subtitleStrokeWidth * 0.24))}px ${settings.subtitleStrokeColor}`,
                        paintOrder: 'stroke fill',
                        textShadow: settings.subtitleDropShadow
                          ? '0 2px 6px rgba(0,0,0,0.9)'
                          : undefined,
                        transform:
                          isActive && settings.subtitleAnimation === 'pop-scale'
                            ? 'scale(1.08)'
                            : undefined,
                      }}
                      className="inline-block transition-transform duration-100"
                    >
                      {applyWordCasing(tok.text, settings.subtitleCasing)}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Layer 5: Draggable Streamer Platform Attribution (`[Logo] USERNAME`) */}
          {(() => {
            const badgeHandle = (
              settings.streamerHandle ||
              clip.streamerHandle ||
              clip.channel ||
              ''
            ).trim();
            if (
              isElementHidden('streamer') ||
              !settings.showStreamerBadge ||
              !badgeHandle ||
              resolvedPlatform === 'none'
            ) {
              return null;
            }
            return (
              <div
                data-testid="streamer-platform-badge"
                data-platform={resolvedPlatform}
                onPointerDown={(e) => startDragOverlay('streamer', e)}
                style={{
                  left: `${settings.streamerBadgeX}%`,
                  top: `${settings.streamerBadgeY}%`,
                  transform: `translate(-50%, -50%) scale(${settings.streamerBadgeScale / 100})`,
                }}
                className={`absolute z-20 cursor-move inline-flex items-center gap-1.5 whitespace-nowrap ${selectionOutline('streamer')}`}
              >
                {resolvedPlatform === 'kick' && (
                  <KickLogoIcon
                    color="#53FC18"
                    className="w-4 h-4 shrink-0 text-[#53FC18] drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)]"
                  />
                )}
                {resolvedPlatform === 'instagram' && (
                  <InstagramIcon
                    color="#E1306C"
                    className="w-4 h-4 shrink-0 text-[#E1306C] drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)]"
                  />
                )}
                {resolvedPlatform === 'youtube' && (
                  <YouTubeShortsIcon
                    color="#FF0033"
                    className="w-4 h-4 shrink-0 text-[#FF0033] drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)]"
                  />
                )}
                <span className="text-white font-extrabold text-[13px] tracking-tight drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)]">
                  {settings.streamerBadgeUppercase ? badgeHandle.toUpperCase() : badgeHandle}
                </span>
              </div>
            );
          })()}

          {/* Layer 6: Draggable Dual Watermarks (Primary Handle/Logo + Secondary Hashtag) */}
          {!isElementHidden('watermark1') && brandKit.showWatermark &&
            (shorts.dualWatermark.useCustomLogo && shorts.dualWatermark.customLogoUrl ? (
              <img
                src={shorts.dualWatermark.customLogoUrl}
                alt="Custom watermark logo"
                onPointerDown={(e) => startDragOverlay('watermark1', e)}
                style={{
                  left: `${settings.watermarkX}%`,
                  top: `${settings.watermarkY}%`,
                  width: `${shorts.dualWatermark.customLogoScale}%`,
                  opacity: brandKit.watermarkOpacity / 100,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`absolute z-20 cursor-move object-contain pointer-events-auto ${selectionOutline('watermark1')}`}
              />
            ) : brandKit.handle.trim() ? (
              <div
                onPointerDown={(e) => startDragOverlay('watermark1', e)}
                style={{
                  left: `${settings.watermarkX}%`,
                  top: `${settings.watermarkY}%`,
                  fontSize: `${Math.max(10, Math.round(settings.watermarkSize * 0.78))}px`,
                  opacity: brandKit.watermarkOpacity / 100,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`absolute z-20 cursor-move font-extrabold text-white tracking-tight whitespace-nowrap drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)] ${selectionOutline('watermark1')}`}
              >
                {brandKit.handle}
              </div>
            ) : null)}

          {!isElementHidden('watermark2') &&
            shorts.dualWatermark.secondaryEnabled &&
            shorts.dualWatermark.secondaryText.trim() && (
            <div
              onPointerDown={(e) => startDragOverlay('watermark2', e)}
              style={{
                left: `${shorts.dualWatermark.secondaryX}%`,
                top: `${shorts.dualWatermark.secondaryY}%`,
                fontSize: `${Math.max(9, Math.round(shorts.dualWatermark.secondarySize * 0.78))}px`,
                opacity: shorts.dualWatermark.secondaryOpacity / 100,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute z-20 cursor-move font-bold text-white/95 whitespace-nowrap drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)] ${selectionOutline('watermark2')}`}
            >
              {shorts.dualWatermark.secondaryText}
            </div>
          )}

          {/* Layer 7: Live Animated Outro Overlay (during Final Preview end or Replay Outro) */}
          {outroElapsedSec !== null && shorts.outro.enabled && (
            <div
              data-testid="shorts-outro-overlay"
              style={{ backgroundColor: shorts.outro.bgColor }}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center"
            >
              {shorts.outro.mode === 'custom' && shorts.outro.customUrl ? (
                shorts.outro.customIsVideo ? (
                  <video
                    src={shorts.outro.customUrl}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={shorts.outro.customUrl}
                    alt="Custom outro"
                    className="w-full h-full object-cover"
                  />
                )
              ) : (
                outroAnim && (
                  <div className="flex flex-col items-center gap-3">
                    {shorts.outro.logoDataUrl ? (
                      <img
                        src={shorts.outro.logoDataUrl}
                        alt="Outro channel logo"
                        style={{
                          transform: `scale(${outroAnim.picScale})`,
                          opacity: outroAnim.picOpacity,
                        }}
                        className="w-20 h-20 rounded-2xl object-cover shadow-lg"
                      />
                    ) : (
                      <div
                        style={{
                          transform: `scale(${outroAnim.picScale})`,
                          opacity: outroAnim.picOpacity,
                        }}
                        className="w-16 h-16 rounded-2xl bg-black/10 grid place-items-center"
                      >
                        <Play className="w-7 h-7 fill-current text-black/80" />
                      </div>
                    )}
                    <div
                      style={{
                        color: shorts.outro.textColor,
                        opacity: outroAnim.textOpacity,
                        transform: `translateY(${outroAnim.textRisePx}px)`,
                      }}
                      className="text-base font-bold leading-snug max-w-[85%]"
                    >
                      {shorts.outro.text}
                    </div>
                    <div
                      style={{
                        backgroundColor: shorts.outro.btnColor,
                        opacity: outroAnim.textOpacity,
                        transform: `translateY(${outroAnim.textRisePx}px)`,
                      }}
                      className="px-4 py-1.5 rounded-full text-xs font-semibold text-white shadow-md"
                    >
                      {shorts.outro.btnText}
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* Layer 8: 2026 Platform Safe Zone Overlay */}
          {showSafeZones && blueprint.aspect === '9:16' && (
            <div className="absolute inset-0 z-40 pointer-events-none">
              <div
                style={{ height: `${(safeSpec.topPx / 1920) * 100}%` }}
                className="absolute top-0 left-0 right-0 bg-red-500/20 border-b border-dashed border-red-400/80"
              />
              <div
                style={{ height: `${(safeSpec.bottomPx / 1920) * 100}%` }}
                className="absolute bottom-0 left-0 right-0 bg-red-500/20 border-t border-dashed border-red-400/80"
              />
              <div
                style={{ width: `${(safeSpec.rightPx / 1080) * 100}%` }}
                className="absolute top-0 bottom-0 right-0 bg-amber-500/15 border-l border-dashed border-amber-400/70"
              />
              <div className="absolute top-1.5 left-2 text-[9.5px] font-mono-tabular text-white bg-black/75 px-1.5 py-0.5 rounded">
                Safe Zone: {safeSpec.label}
              </div>
            </div>
          )}

          {/* Floating NLE overlay alignment & visibility toolbar */}
          {selectedElement && (
            <div
              data-testid="selected-overlay-toolbar"
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute top-2 right-2 z-50 h-7 px-1.5 rounded-md border border-white/20 bg-black/85 text-white flex items-center gap-1 shadow-lg"
            >
              <span className="text-[10px] font-medium px-1 text-white/85">
                {OVERLAY_LABELS[selectedElement]}
              </span>
              <button
                type="button"
                aria-label="Center selected element horizontally"
                title="Center horizontally"
                onClick={(e) => {
                  e.stopPropagation();
                  centerSelectedElement();
                }}
                className="h-5 w-5 grid place-items-center rounded hover:bg-white/15 text-white bg-transparent border-0 cursor-pointer"
              >
                <AlignHorizontalJustifyCenter className="w-3 h-3" />
              </button>
              <button
                type="button"
                aria-label="Reset selected element position"
                title="Reset position"
                onClick={(e) => {
                  e.stopPropagation();
                  resetSelectedElementPos();
                }}
                className="h-5 w-5 grid place-items-center rounded hover:bg-white/15 text-white bg-transparent border-0 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
              <button
                type="button"
                aria-label="Hide selected element"
                data-testid="delete-selected-element-btn"
                title="Hide overlay (Delete)"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSelectedElement();
                }}
                className="h-5 w-5 grid place-items-center rounded hover:bg-red-600 text-white bg-transparent border-0 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Subtle footer helper */}
      <div className="shrink-0 text-[11px] text-[var(--pc-muted)] flex items-center gap-2">
        <span>Drag headline, subtitles, cards, or watermarks · select to center, reset, or hide</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono-tabular">{activeTemplateName || templatePreset.name}</span>
      </div>
    </div>
  );
}
