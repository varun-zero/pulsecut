import React, { useMemo, useRef } from 'react';
import { Check, Crop, Lock, Play, SlidersHorizontal } from 'lucide-react';
import type {
  BrandKit,
  ClipItem,
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
import { computeOutroAnimationFrame } from '../../lib/shortsEngine';
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
  currentTimeSec: number;
  stitchedTimeSec: number;
  previewRes: PreviewResolutionId;
  finalPreviewLocked: boolean;
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

type DragTarget = 'headline' | 'subtitles' | 'streamer' | 'watermark1' | 'watermark2';

export function ShortsStage({
  clip,
  videoRef,
  blueprint,
  shorts,
  settings,
  brandKit,
  customFonts,
  currentTimeSec,
  stitchedTimeSec,
  previewRes,
  finalPreviewLocked,
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
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();

    const updateFromClient = (clientX: number, clientY: number, record: boolean) => {
      const xPct = Math.round(Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100)));
      const yPct = Math.round(Math.max(5, Math.min(95, ((clientY - rect.top) / rect.height) * 100)));
      if (target === 'headline') {
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
      ? settings.template === 'kick-stream' || settings.template === 'split-stream'
        ? 'kick'
        : settings.template === 'insta-short'
          ? 'instagram'
          : settings.template === 'yt-short'
            ? 'youtube'
            : 'none'
      : settings.streamerPlatform;

  const isXCard =
    settings.templateEnabled && (settings.template === 'x_light' || settings.template === 'x_dark');
  const isNewsBroadcast = settings.templateEnabled && settings.template === 'breaking-news';

  const outroAnim =
    outroElapsedSec !== null ? computeOutroAnimationFrame(outroElapsedSec, shorts.outro) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-between p-3 gap-2 overflow-hidden bg-[var(--pc-canvas)]">
      {/* Hidden source video element that powers the FramedCanvasView 2D compositor + master audio */}
      {clip.mediaUrl && (
        <video
          ref={videoRef}
          src={clip.mediaUrl}
          playsInline
          preload="metadata"
          muted={trackStates.a1Muted}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (Number.isFinite(v.duration) && v.duration > 0) {
              onVideoMetadata(v.duration);
            }
          }}
          onTimeUpdate={(e) => onVideoTimeUpdate(e.currentTarget.currentTime)}
          onEnded={onVideoEnded}
          className="hidden"
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
          style={{ aspectRatio: String(canvasAr) }}
          className="relative h-full max-h-full max-w-full rounded-xl overflow-hidden bg-black border border-[var(--pc-border)] shadow-2xl select-none"
        >
          {/* Layer 1: Exact Framed 2D Canvas from Section 1 Blueprint */}
          <FramedCanvasView
            videoRef={videoRef}
            blueprint={blueprint}
            previewRes={previewRes}
            v1Hidden={!trackStates.v1Visible}
            testId="shorts-compositor-canvas"
            className="w-full h-full"
          />

          {/* Layer 2: Whole-Video Template Chrome (X/Tweet Header Card or Breaking News Banner) */}
          {isXCard && (
            <div
              className={`absolute top-[6%] left-[6%] right-[6%] rounded-xl p-3 shadow-xl pointer-events-none ${
                settings.cardTheme === 'light'
                  ? 'bg-white text-[#0F1419]'
                  : 'bg-[#121417] text-white border border-white/15'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 grid place-items-center text-[11px] font-bold text-white shrink-0">
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
          {headlineVisible && !isXCard && !isNewsBroadcast && (
            <div
              data-testid="shorts-headline-overlay"
              onPointerDown={(e) => startDragOverlay('headline', e)}
              style={{
                left: `${settings.headlineX}%`,
                top: `${settings.headlineY}%`,
                maxWidth: `${settings.headlineMaxWidth}%`,
                transform: 'translate(-50%, -50%)',
                fontFamily: `"${headlineFont.family}", sans-serif`,
                fontSize: `${Math.max(11, Math.round(settings.headlineSize * 0.62))}px`,
                textAlign: settings.headlineAlign,
              }}
              className="absolute z-20 cursor-move px-1 transition-opacity duration-200"
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
          {trackStates.ccVisible && activeChunk && (
            <div
              data-testid="shorts-subtitle-overlay"
              onPointerDown={(e) => startDragOverlay('subtitles', e)}
              style={{
                left: `${settings.subtitleX}%`,
                top: `${settings.subtitleVerticalPos}%`,
                maxWidth: `${settings.subtitleMaxWidth}%`,
                transform: 'translate(-50%, -50%)',
                fontFamily: `"${subtitleFont.family}", sans-serif`,
                fontSize: `${Math.max(12, Math.round(settings.subtitleSize * 0.68))}px`,
                lineHeight: settings.subtitleLineHeight,
                textAlign: settings.subtitleAlign,
              }}
              className="absolute z-20 cursor-move px-1"
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
                  const isActive =
                    currentTimeSec * 1000 >= tok.start_ms && currentTimeSec * 1000 <= tok.end_ms;
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
          {settings.showStreamerBadge && settings.streamerHandle.trim() && resolvedPlatform !== 'none' && (
            <div
              onPointerDown={(e) => startDragOverlay('streamer', e)}
              style={{
                left: `${settings.streamerBadgeX}%`,
                top: `${settings.streamerBadgeY}%`,
                transform: `translate(-50%, -50%) scale(${settings.streamerBadgeScale / 100})`,
              }}
              className="absolute z-20 cursor-move inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {resolvedPlatform === 'kick' && <KickLogoIcon className="w-4 h-4 shrink-0" />}
              {resolvedPlatform === 'instagram' && <InstagramIcon className="w-4 h-4 shrink-0 text-[#E1306C]" />}
              {resolvedPlatform === 'youtube' && <YouTubeShortsIcon className="w-4 h-4 shrink-0" />}
              <span
                className="text-white font-extrabold text-[13px] tracking-tight drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)]"
              >
                {settings.streamerBadgeUppercase
                  ? settings.streamerHandle.toUpperCase()
                  : settings.streamerHandle}
              </span>
            </div>
          )}

          {/* Layer 6: Draggable Dual Watermarks (Primary Handle/Logo + Secondary Hashtag) */}
          {brandKit.showWatermark &&
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
                className="absolute z-20 cursor-move object-contain pointer-events-auto"
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
                className="absolute z-20 cursor-move font-extrabold text-white tracking-tight whitespace-nowrap drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)]"
              >
                {brandKit.handle}
              </div>
            ) : null)}

          {shorts.dualWatermark.secondaryEnabled && shorts.dualWatermark.secondaryText.trim() && (
            <div
              onPointerDown={(e) => startDragOverlay('watermark2', e)}
              style={{
                left: `${shorts.dualWatermark.secondaryX}%`,
                top: `${shorts.dualWatermark.secondaryY}%`,
                fontSize: `${Math.max(9, Math.round(shorts.dualWatermark.secondarySize * 0.78))}px`,
                opacity: shorts.dualWatermark.secondaryOpacity / 100,
                transform: 'translate(-50%, -50%)',
              }}
              className="absolute z-20 cursor-move font-bold text-white/95 whitespace-nowrap drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)]"
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
        </div>
      </div>

      {/* Subtle footer helper */}
      <div className="shrink-0 text-[11px] text-[var(--pc-muted)] flex items-center gap-2">
        <span>Drag headline, subtitles, or watermarks directly on canvas</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono-tabular">{templatePreset.name}</span>
      </div>
    </div>
  );
}
