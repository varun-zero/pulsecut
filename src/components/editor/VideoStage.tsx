import React, { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Film, Maximize2, Move, Plus, UserSquare2 } from 'lucide-react';
import type { BrandKit, ClipItem, CustomFontEntry, EditorSettings, FrameAspectId, StreamerPlatformId } from '../../types';
import { getTemplatePreset } from '../../presets';
import {
  getActiveWordBeat,
  getSafeZoneSpec,
  getViralCaptionPreset,
  getViralFont,
} from '../../captionStyles';
import { applyTextCasing, computeCropTransform, normalizeHandle } from '../../lib/studioLogic';
import { Button } from '../ui/Primitives';
import { InstagramIcon, KickLogoIcon, YouTubeShortsIcon } from '../ui/PlatformIcons';

interface VideoStageProps {
  clip: ClipItem | null;
  settings: EditorSettings;
  brandKit: BrandKit;
  customFonts: readonly CustomFontEntry[];
  playing: boolean;
  playbackSpeed: number;
  currentTimeSec: number;
  showSafeZones: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onUpdateSettings: (patch: Partial<EditorSettings>, recordHistory?: boolean) => void;
  onDurationLoaded?: (durationSec: number) => void;
  onToggleFullscreen: () => void;
  onOpenClipPicker: () => void;
  onGoToDashboard: () => void;
}

type DragTarget = 'headline' | 'subtitle' | 'watermark' | 'streamer' | 'facecam';

function aspectIdToCss(aspect: FrameAspectId): string {
  switch (aspect) {
    case '4:3':
      return '4 / 3';
    case '16:9':
      return '16 / 9';
    case '1:1':
      return '1 / 1';
    default:
      return '9 / 16';
  }
}

function resolveStreamerPlatform(
  choice: StreamerPlatformId,
  templateId: string,
  clipPlatform?: ClipItem['platform']
): 'kick' | 'instagram' | 'youtube' | 'none' {
  if (choice !== 'auto') return choice;
  if (templateId === 'kick-stream' || templateId === 'split-stream' || templateId === 'dual_react') {
    return 'kick';
  }
  if (templateId === 'insta-short' || templateId === 'dark_stepped') {
    return 'instagram';
  }
  if (templateId === 'yt-short' || templateId === 'reaction-pip' || templateId === 'podcast_split') {
    return 'youtube';
  }
  if (clipPlatform === 'Kick') return 'kick';
  if (clipPlatform === 'Instagram') return 'instagram';
  if (clipPlatform === 'YouTube') return 'youtube';
  return 'none';
}

export function VideoStage({
  clip,
  settings,
  brandKit,
  customFonts,
  playing,
  playbackSpeed,
  currentTimeSec,
  showSafeZones,
  stageRef,
  onUpdateSettings,
  onDurationLoaded,
  onToggleFullscreen,
  onOpenClipPicker,
  onGoToDashboard,
}: VideoStageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const camVideoRef = useRef<HTMLVideoElement>(null);
  const [dragging, setDragging] = useState<{
    target: DragTarget;
    x: number;
    y: number;
    snappedCenter: boolean;
  } | null>(null);

  // Synchronize real <video> playback (main + cropped facecam) with timeline transport
  useEffect(() => {
    const videos = [mainVideoRef.current, camVideoRef.current].filter(
      (v): v is HTMLVideoElement => Boolean(v)
    );
    videos.forEach((vid, idx) => {
      vid.playbackRate = playbackSpeed;
      vid.muted = idx > 0; // Keep secondary facecam copy muted to prevent audio doubling
      if (playing) {
        vid.play().catch(() => {});
      } else {
        vid.pause();
      }
    });
  }, [playing, playbackSpeed, clip?.mediaUrl, settings.facecamEnabled, settings.facecamPlacement]);

  useEffect(() => {
    const videos = [mainVideoRef.current, camVideoRef.current].filter(
      (v): v is HTMLVideoElement => Boolean(v)
    );
    videos.forEach((vid) => {
      if (Math.abs(vid.currentTime - currentTimeSec) > 0.35) {
        try {
          vid.currentTime = currentTimeSec;
        } catch {
          // Ignore seek errors before metadata finishes loading
        }
      }
    });
  }, [currentTimeSec, clip?.mediaUrl]);

  const preset = getTemplatePreset(settings.template);
  const captionPreset = getViralCaptionPreset(settings.captionStyle);
  const safeSpec = getSafeZoneSpec(settings.safeZonePlatform, settings.template);
  const headlineFontMeta = getViralFont(settings.font, customFonts);
  const subtitleFontMeta = getViralFont(settings.subtitleFont, customFonts);

  const activeBeat = clip
    ? getActiveWordBeat(clip.words, settings.subtitleWordsPerScreen, currentTimeSec)
    : null;

  const formattedHeadline = applyTextCasing(settings.headline, settings.headlineCasing);
  const handleDisplay = normalizeHandle(brandKit.handle);
  const resolvedPlatform = resolveStreamerPlatform(
    settings.streamerPlatform,
    settings.template,
    clip?.platform
  );

  const streamerLabelRaw = (settings.streamerHandle || clip?.streamerHandle || clip?.channel || '').replace(
    /^@/,
    ''
  );
  const streamerLabel = settings.streamerBadgeUppercase
    ? streamerLabelRaw.toUpperCase()
    : streamerLabelRaw;

  const isKickTemplate = settings.templateEnabled && settings.template === 'kick-stream';
  const isYtShortTemplate = settings.templateEnabled && settings.template === 'yt-short';

  // Aspect container sizing inside the bounded stage
  const frameAspectClass =
    settings.aspect === '9:16'
      ? 'aspect-[9/16] h-full max-h-full w-auto max-w-full'
      : settings.aspect === '1:1'
        ? 'aspect-square h-full max-h-full w-auto max-w-full'
        : 'aspect-video w-full max-w-[820px] max-h-full h-auto';

  const showSocialCard = settings.templateEnabled && preset.hasCard;
  const showHeadlineOverlay =
    settings.templateEnabled &&
    settings.headlineLayout !== 'none' &&
    !showSocialCard &&
    formattedHeadline.trim().length > 0;

  const showStreamerCredit =
    settings.templateEnabled &&
    settings.showStreamerBadge &&
    streamerLabel.trim().length > 0;

  // Direct drag-to-position handler on the video frame
  const startDrag = (target: DragTarget, e: React.PointerEvent<HTMLDivElement>) => {
    const frame = frameRef.current;
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();

    const updateFromEvent = (clientX: number, clientY: number, commit: boolean) => {
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      let pctX = Math.max(8, Math.min(92, ((clientX - rect.left) / rect.width) * 100));
      const pctY = Math.max(8, Math.min(94, ((clientY - rect.top) / rect.height) * 100));
      const snappedCenter = Math.abs(pctX - 50) <= 2.2;
      if (snappedCenter) pctX = 50;

      const rx = Math.round(pctX);
      const ry = Math.round(pctY);

      setDragging(commit ? null : { target, x: rx, y: ry, snappedCenter });

      if (target === 'headline') {
        onUpdateSettings({ headlineX: rx, headlineY: ry }, commit);
      } else if (target === 'subtitle') {
        onUpdateSettings({ subtitleX: rx, subtitleVerticalPos: ry }, commit);
      } else if (target === 'watermark') {
        onUpdateSettings({ watermarkX: rx, watermarkY: ry }, commit);
      } else if (target === 'streamer') {
        onUpdateSettings({ streamerBadgeX: rx, streamerBadgeY: ry }, commit);
      } else if (target === 'facecam') {
        onUpdateSettings(
          { facecamPlacement: 'pip-free', facecamOutputX: rx, facecamOutputY: ry },
          commit
        );
      }
    };

    const onMove = (ev: PointerEvent) => updateFromEvent(ev.clientX, ev.clientY, false);
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      updateFromEvent(ev.clientX, ev.clientY, true);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Safe Zone percentages on 1080×1920 reference frame
  const topSafePct = (safeSpec.topPx / safeSpec.refHeight) * 100;
  const bottomSafePct = (safeSpec.bottomPx / safeSpec.refHeight) * 100;
  const leftSafePct = (safeSpec.leftPx / safeSpec.refWidth) * 100;
  const rightSafePct = (safeSpec.rightPx / safeSpec.refWidth) * 100;
  const lowerRightPct = safeSpec.lowerRightPx
    ? (safeSpec.lowerRightPx / safeSpec.refWidth) * 100
    : 0;
  const lowerRightTopPct = safeSpec.lowerRightStartY
    ? (safeSpec.lowerRightStartY / safeSpec.refHeight) * 100
    : 50;

  const animationClass =
    settings.subtitleAnimation === 'pop-scale'
      ? 'pc-caption-pop'
      : settings.subtitleAnimation === 'slide-up'
        ? 'pc-caption-slide'
        : '';

  const subtitleFontPx = Math.max(12, Math.min(34, Math.round(settings.subtitleSize * 0.56)));
  const headlineFontPx = Math.max(11, Math.min(26, Math.round(settings.headlineSize * 0.52)));
  const strokePx = Math.max(0, Math.min(4, Number((settings.subtitleStrokeWidth * 0.45).toFixed(1))));

  const buildSubtitleShadow = () => {
    const parts: string[] = [];
    if (settings.subtitleDropShadow && settings.subtitleBgStyle !== 'white-stepped') {
      parts.push('0 3px 10px rgba(0, 0, 0, 0.92)');
    }
    if (settings.subtitleNeonGlow && settings.subtitleBgStyle !== 'white-stepped') {
      parts.push(`0 0 14px ${settings.subtitleActiveColor}99`);
    }
    return parts.join(', ') || 'none';
  };

  const alignToFlex = (align: EditorSettings['subtitleAlign']) =>
    align === 'left' ? 'justify-start text-left' : align === 'right' ? 'justify-end text-right' : 'justify-center text-center';

  return (
    <div
      ref={stageRef}
      data-testid="video-stage"
      className="relative flex-1 min-h-0 rounded-xl bg-[#050507] border border-[var(--pc-border)] flex items-center justify-center p-4 overflow-hidden select-none"
    >
      {!clip ? (
        <div className="max-w-sm text-center px-6 py-8">
          <div className="w-11 h-11 rounded-xl bg-[var(--pc-surface-2)] border border-[var(--pc-border)] grid place-items-center mx-auto mb-3.5 text-[var(--pc-sub)]">
            <Film className="w-5 h-5 stroke-[1.75]" />
          </div>
          <h3 className="text-sm font-semibold text-white m-0">No clip loaded</h3>
          <p className="text-xs text-zinc-400 mt-1.5 mb-5 leading-relaxed">
            Pick an existing clip from your workspace or import a live stream to start editing.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="primary" size="sm" onClick={onOpenClipPicker}>
              Choose from Clips
            </Button>
            <Button variant="secondary" size="sm" onClick={onGoToDashboard}>
              <Plus className="w-3.5 h-3.5" />
              <span>Import Source</span>
            </Button>
          </div>
        </div>
      ) : (
        <div
          ref={frameRef}
          data-testid="video-canvas-frame"
          data-aspect={settings.aspect}
          data-template={settings.template}
          className={`relative ${frameAspectClass} rounded-lg overflow-hidden shadow-2xl border border-white/10 flex flex-col items-center justify-center`}
          style={{
            backgroundColor: settings.outerFill,
            padding: `${settings.canvas === 'padding' ? Math.max(12, settings.framePadding) : settings.framePadding}px`,
          }}
        >
          {/* Blurred backdrop layer when Canvas mode = Blur */}
          {settings.canvas === 'blur' && clip.previewImage && (
            <img
              src={clip.previewImage}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover scale-125 blur-2xl opacity-55 pointer-events-none"
            />
          )}

          {/* Optional Social Post / X / Reddit Header Card (X Card & Reddit Story templates) */}
          {showSocialCard && (
            <div
              className={`relative z-20 w-full mb-2.5 rounded-xl px-3 py-2.5 shadow-lg ${
                settings.cardTheme === 'light'
                  ? 'bg-white text-zinc-950 border border-zinc-200'
                  : 'bg-zinc-900/95 text-zinc-50 border border-white/15'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-zinc-800 text-white text-[10px] font-semibold grid place-items-center shrink-0">
                  {(brandKit.displayName || 'P').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-semibold truncate">
                      {brandKit.displayName || 'PulseCut Creator'}
                    </span>
                    {brandKit.verified && (
                      <BadgeCheck className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                    )}
                  </div>
                  <div className="text-[10px] opacity-65 font-mono-tabular truncate">
                    {handleDisplay}
                  </div>
                </div>
              </div>
              {(settings.pinnedStatement.trim() || formattedHeadline.trim()) && (
                <p
                  className="text-[12px] mt-1.5 mb-0 leading-snug line-clamp-2 opacity-95"
                  style={{
                    fontFamily: headlineFontMeta.cssFamily,
                    fontStyle: headlineFontMeta.italic ? 'italic' : 'normal',
                  }}
                >
                  {settings.pinnedStatement.trim() || formattedHeadline}
                </p>
              )}
            </div>
          )}

          {/* Inner Video Composition Frame */}
          <div
            className={`relative z-10 w-full overflow-hidden bg-black ${
              settings.layout === 'centered' && !settings.facecamEnabled
                ? 'aspect-video my-auto'
                : 'flex-1 min-h-0'
            }`}
            style={{
              borderRadius: `${settings.cornerRadius}px`,
              border:
                isKickTemplate && settings.kickNeonGlow
                  ? '1.5px solid #53FC18'
                  : undefined,
              boxShadow:
                isKickTemplate && settings.kickNeonGlow
                  ? '0 0 18px rgba(83, 252, 24, 0.28)'
                  : undefined,
            }}
          >
            {(() => {
              const cropStyle = computeCropTransform(settings.facecamSourceBox);
              const isSplitFacecam =
                settings.facecamEnabled &&
                (settings.facecamPlacement === 'split-top' ||
                  settings.facecamPlacement === 'split-bottom');
              const isOverlayFacecam = settings.facecamEnabled && !isSplitFacecam;
              const mainFitClass =
                settings.mainVideoFit === 'contain' ? 'object-contain' : 'object-cover';

              const renderMainMedia = () =>
                clip.mediaUrl ? (
                  <video
                    ref={mainVideoRef}
                    src={clip.mediaUrl}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(e) => {
                      const d = e.currentTarget.duration;
                      if (Number.isFinite(d) && d > 0 && onDurationLoaded) {
                        onDurationLoaded(Math.round(d));
                      }
                      if (e.currentTarget.currentTime === 0) {
                        try {
                          e.currentTarget.currentTime = 0.05;
                        } catch {
                          // ignore
                        }
                      }
                    }}
                    className={`w-full h-full ${mainFitClass}`}
                  />
                ) : clip.previewImage ? (
                  <img
                    src={clip.previewImage}
                    alt={clip.title}
                    referrerPolicy="no-referrer"
                    className={`w-full h-full ${mainFitClass}`}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 text-[10px] font-mono-tabular gap-1">
                    <Film className="w-5 h-5 opacity-60" />
                    <span>Main Video ({settings.mainVideoAspect})</span>
                  </div>
                );

              const renderCroppedFacecamMedia = () => (
                <div className="relative w-full h-full overflow-hidden bg-zinc-900">
                  {clip.mediaUrl ? (
                    <video
                      ref={camVideoRef}
                      src={clip.mediaUrl}
                      muted
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(e) => {
                        if (e.currentTarget.currentTime === 0) {
                          try {
                            e.currentTarget.currentTime = 0.05;
                          } catch {
                            // ignore
                          }
                        }
                      }}
                      style={{
                        position: 'absolute',
                        width: `${cropStyle.widthPct}%`,
                        height: `${cropStyle.heightPct}%`,
                        left: `${cropStyle.leftPct}%`,
                        top: `${cropStyle.topPct}%`,
                        maxWidth: 'none',
                      }}
                      className="object-fill pointer-events-none"
                    />
                  ) : clip.previewImage ? (
                    <img
                      src={clip.previewImage}
                      alt="Streamer Facecam"
                      referrerPolicy="no-referrer"
                      style={{
                        position: 'absolute',
                        width: `${cropStyle.widthPct}%`,
                        height: `${cropStyle.heightPct}%`,
                        left: `${cropStyle.leftPct}%`,
                        top: `${cropStyle.topPct}%`,
                        maxWidth: 'none',
                      }}
                      className="object-fill pointer-events-none"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-[#53FC18]/85 text-[9.5px] font-mono-tabular gap-1">
                      <UserSquare2 className="w-4 h-4" />
                      <span>
                        Cam {settings.facecamSourceBox.x}%,{settings.facecamSourceBox.y}%
                      </span>
                    </div>
                  )}
                </div>
              );

              if (isSplitFacecam) {
                const camPct = Math.max(25, Math.min(65, settings.facecamSplitRatio));
                const mainPct = 100 - camPct;
                const camOnTop = settings.facecamPlacement === 'split-top';
                return (
                  <div
                    data-testid="facecam-split-container"
                    className="w-full h-full flex flex-col bg-black"
                  >
                    <div
                      data-testid={camOnTop ? 'facecam-output-region' : 'main-video-region'}
                      style={{ height: `${camOnTop ? camPct : mainPct}%` }}
                      className="relative w-full overflow-hidden border-b border-white/10"
                    >
                      {camOnTop ? renderCroppedFacecamMedia() : renderMainMedia()}
                    </div>
                    <div
                      data-testid={camOnTop ? 'main-video-region' : 'facecam-output-region'}
                      style={{ height: `${camOnTop ? mainPct : camPct}%` }}
                      className="relative w-full overflow-hidden"
                    >
                      {camOnTop ? renderMainMedia() : renderCroppedFacecamMedia()}
                    </div>
                  </div>
                );
              }

              // Single or Reaction PiP overlay layout with configurable Main Video Aspect inside mobile frame
              const isFullBleedMain = settings.mainVideoAspect === '9:16';
              const camPosX =
                settings.facecamPlacement === 'bottom' || settings.facecamPlacement === 'top'
                  ? settings.facecamOutputX
                  : settings.facecamOutputX;
              const camPosY =
                settings.facecamPlacement === 'bottom'
                  ? Math.max(66, settings.facecamOutputY)
                  : settings.facecamPlacement === 'top'
                    ? Math.min(34, settings.facecamOutputY)
                    : settings.facecamOutputY;

              return (
                <div className="relative w-full h-full overflow-hidden" style={{ backgroundColor: settings.outerFill }}>
                  {isFullBleedMain ? (
                    <div data-testid="main-video-region" className="w-full h-full">
                      {renderMainMedia()}
                    </div>
                  ) : (
                    <div
                      data-testid="main-video-region"
                      data-main-aspect={settings.mainVideoAspect}
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: `${settings.mainVideoOffsetY}%`,
                        width: '100%',
                        aspectRatio: aspectIdToCss(settings.mainVideoAspect),
                        transform: 'translate(-50%, -50%)',
                      }}
                      className="overflow-hidden bg-black shadow-lg"
                    >
                      {renderMainMedia()}
                    </div>
                  )}

                  {isOverlayFacecam && (
                    <div
                      data-testid="facecam-output-region"
                      onPointerDown={(e) => startDrag('facecam', e)}
                      title="Drag to reposition streamer facecam on short"
                      style={{
                        left: `${camPosX}%`,
                        top: `${camPosY}%`,
                        width: `${settings.facecamOutputWidth}%`,
                        aspectRatio: aspectIdToCss(settings.facecamOutputAspect),
                        borderRadius: `${settings.facecamRounded}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      className="group absolute z-15 overflow-hidden border border-white/35 shadow-2xl bg-zinc-900 cursor-grab active:cursor-grabbing touch-none hover:ring-2 hover:ring-[#53FC18]/80"
                    >
                      {renderCroppedFacecamMedia()}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Center snap guide line while dragging any element */}
            {dragging?.snappedCenter && (
              <div
                aria-hidden="true"
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px border-l border-dashed border-sky-400/80 z-40 pointer-events-none"
              />
            )}

            {/* Live drag coordinates readout */}
            {dragging && (
              <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-40 px-2 py-0.5 rounded bg-black/85 border border-white/15 font-mono-tabular text-[10px] text-white pointer-events-none">
                X {dragging.x}% · Y {dragging.y}%
              </div>
            )}

            {/* 1. DRAGGABLE HEADLINE / VIRAL STEPPED WHITE HOOK CAPTION */}
            {showHeadlineOverlay && (
              <div
                data-testid="headline-hook-overlay"
                onPointerDown={(e) => startDrag('headline', e)}
                title="Drag to reposition hook caption"
                className="group absolute z-20 cursor-grab active:cursor-grabbing touch-none"
                style={{
                  left: `${settings.headlineX}%`,
                  top: `${settings.headlineY}%`,
                  width: `${settings.headlineMaxWidth}%`,
                  transform: 'translate(-50%, -50%)',
                  textAlign: settings.headlineAlign,
                }}
              >
                <div className="relative rounded-md group-hover:ring-1 group-hover:ring-sky-400/80 transition-shadow px-0.5">
                  {settings.headlineLayout === 'white-stepped' ||
                  settings.headlineLayout === 'dark-stepped' ? (
                    <span
                      style={{
                        display: 'inline',
                        backgroundColor:
                          settings.headlineLayout === 'white-stepped' ? '#FFFFFF' : '#09090B',
                        color:
                          settings.headlineLayout === 'white-stepped' ? '#09090B' : '#FFFFFF',
                        fontFamily: headlineFontMeta.cssFamily,
                        fontWeight: 700,
                        fontStyle: headlineFontMeta.italic ? 'italic' : 'normal',
                        fontSize: `${headlineFontPx}px`,
                        lineHeight: 1.34,
                        padding: '3.5px 9px',
                        borderRadius: '7px',
                        boxDecorationBreak: 'clone',
                        WebkitBoxDecorationBreak: 'clone',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.28)',
                      }}
                    >
                      {formattedHeadline}
                    </span>
                  ) : settings.headlineLayout === 'solid-banner' ? (
                    <div
                      className="px-3 py-1.5 rounded-md"
                      style={{
                        backgroundColor: `rgba(12, 12, 14, ${settings.bannerOpacity / 100})`,
                        fontFamily: headlineFontMeta.cssFamily,
                        fontWeight: headlineFontMeta.defaultWeight,
                        fontStyle: headlineFontMeta.italic ? 'italic' : 'normal',
                        fontSize: `${headlineFontPx}px`,
                        textShadow: `0 ${Math.round(settings.textShadow / 2)}px ${settings.textShadow}px rgba(0,0,0,0.9)`,
                        borderLeft: isYtShortTemplate ? '3px solid #FF0033' : undefined,
                      }}
                    >
                      <span className="text-white leading-tight block">{formattedHeadline}</span>
                    </div>
                  ) : (
                    <span
                      className="block leading-tight text-white"
                      style={{
                        fontFamily: headlineFontMeta.cssFamily,
                        fontWeight: Math.max(700, headlineFontMeta.defaultWeight),
                        fontStyle: headlineFontMeta.italic ? 'italic' : 'normal',
                        fontSize: `${headlineFontPx}px`,
                        WebkitTextStroke: '1.5px #000000',
                        paintOrder: 'stroke fill',
                        textShadow: '0 3px 10px rgba(0,0,0,0.92)',
                      }}
                    >
                      {formattedHeadline}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 2. DRAGGABLE LIVE WORD-LEVEL VIRAL CAPTIONS / SUBTITLES */}
            {activeBeat && (
              <div
                key={`beat-${activeBeat.chunk.index}-${settings.subtitleWordsPerScreen}`}
                data-testid="viral-caption-overlay"
                onPointerDown={(e) => startDrag('subtitle', e)}
                title="Drag to reposition captions"
                className={`group absolute z-20 flex cursor-grab active:cursor-grabbing touch-none ${alignToFlex(settings.subtitleAlign)} ${animationClass}`}
                style={{
                  left: `${settings.subtitleX}%`,
                  top: `${settings.subtitleVerticalPos}%`,
                  width: `${settings.subtitleMaxWidth}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {settings.subtitleBgStyle === 'white-stepped' ? (
                  <div
                    className="group-hover:ring-1 group-hover:ring-sky-400/80 rounded-md"
                    style={{ textAlign: settings.subtitleAlign }}
                  >
                    <span
                      style={{
                        display: 'inline',
                        backgroundColor: '#FFFFFF',
                        color: '#09090B',
                        fontFamily: subtitleFontMeta.cssFamily,
                        fontWeight: Math.max(700, subtitleFontMeta.defaultWeight),
                        fontStyle: subtitleFontMeta.italic ? 'italic' : 'normal',
                        fontSize: `${subtitleFontPx}px`,
                        lineHeight: Math.max(1.38, settings.subtitleLineHeight + 0.25),
                        padding: '2px 9px',
                        borderRadius: '6px',
                        boxDecorationBreak: 'clone',
                        WebkitBoxDecorationBreak: 'clone',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.28)',
                      }}
                    >
                      {activeBeat.chunk.tokens
                        .map((tok) => applyTextCasing(tok.text, settings.subtitleCasing))
                        .join(' ')}
                    </span>
                  </div>
                ) : (
                  <div
                    className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 max-w-full group-hover:ring-1 group-hover:ring-sky-400/80 rounded-md ${
                      settings.subtitleAlign === 'left'
                        ? 'justify-start'
                        : settings.subtitleAlign === 'right'
                          ? 'justify-end'
                          : 'justify-center'
                    } ${
                      settings.subtitleBgStyle === 'dark-pill'
                        ? 'px-3 py-1 rounded-lg bg-black/78 border border-white/10 backdrop-blur-xs'
                        : captionPreset.surfaceTreatment === 'ticker'
                          ? 'px-3 py-1 rounded-md bg-black/80 border-b-2 border-[#EF4444]'
                          : ''
                    }`}
                    style={{
                      fontFamily: subtitleFontMeta.cssFamily,
                      fontWeight: subtitleFontMeta.defaultWeight,
                      fontStyle: subtitleFontMeta.italic ? 'italic' : 'normal',
                      fontSize: `${subtitleFontPx}px`,
                      lineHeight: settings.subtitleLineHeight,
                    }}
                  >
                    {activeBeat.chunk.tokens.map((tok, i) => {
                      const isActive = i === activeBeat.activeTokenIndex;
                      const formattedWord = applyTextCasing(tok.text, settings.subtitleCasing);
                      const isBoxStyle =
                        settings.subtitleBgStyle === 'active-box' ||
                        settings.subtitleAnimation === 'box-highlight' ||
                        captionPreset.surfaceTreatment === 'pill';

                      const wordColor =
                        tok.emphasisColor ||
                        (isActive ? settings.subtitleActiveColor : settings.subtitleBaseColor);

                      if (isBoxStyle && isActive) {
                        return (
                          <span
                            key={`${tok.cueIndex}-${tok.tokenIndex}`}
                            className="px-2 py-0.5 rounded-md transition-transform duration-100"
                            style={{
                              backgroundColor: tok.emphasisColor || settings.subtitleActiveColor,
                              color:
                                (tok.emphasisColor || settings.subtitleActiveColor).toUpperCase() ===
                                '#2563EB'
                                  ? '#FFFFFF'
                                  : '#09090B',
                              transform:
                                settings.subtitleAnimation === 'pop-scale'
                                  ? 'scale(1.06)'
                                  : undefined,
                            }}
                          >
                            {formattedWord}
                          </span>
                        );
                      }

                      return (
                        <span
                          key={`${tok.cueIndex}-${tok.tokenIndex}`}
                          className="inline-block transition-transform duration-100"
                          style={{
                            color: wordColor,
                            WebkitTextStroke:
                              strokePx > 0
                                ? `${strokePx}px ${settings.subtitleStrokeColor}`
                                : undefined,
                            paintOrder: 'stroke fill',
                            textShadow: buildSubtitleShadow(),
                            transform:
                              isActive && settings.subtitleAnimation === 'pop-scale'
                                ? 'scale(1.1)'
                                : undefined,
                          }}
                        >
                          {formattedWord}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 3. DRAGGABLE CREATOR PAGE WATERMARK (`@DUMMNEWS` / `@signalcraft`) */}
            {brandKit.showWatermark && handleDisplay && (
              <div
                data-testid="creator-watermark-overlay"
                onPointerDown={(e) => startDrag('watermark', e)}
                title="Drag to reposition creator watermark"
                className="group absolute z-20 cursor-grab active:cursor-grabbing touch-none whitespace-nowrap px-1.5 py-0.5 rounded hover:ring-1 hover:ring-sky-400/80"
                style={{
                  left: `${settings.watermarkX}%`,
                  top: `${settings.watermarkY}%`,
                  transform: 'translate(-50%, -50%)',
                  opacity: brandKit.watermarkOpacity / 100,
                }}
              >
                <span
                  className="font-extrabold tracking-tight text-white"
                  style={{
                    fontFamily: '"Montserrat", "Plus Jakarta Sans", sans-serif',
                    fontSize: `${Math.max(10, Math.round(settings.watermarkSize * 0.85))}px`,
                    WebkitTextStroke: settings.watermarkOutline ? '2.5px #000000' : undefined,
                    paintOrder: 'stroke fill',
                    textShadow: '0 2px 6px rgba(0,0,0,0.85)',
                  }}
                >
                  {handleDisplay.toUpperCase()}
                </span>
              </div>
            )}

            {/* 4. DRAGGABLE PLATFORM STREAMER ATTRIBUTION (`[K] ADINROSS`, `[IG] USER`, `[YT] CHANNEL`) */}
            {showStreamerCredit && (
              <div
                data-testid="streamer-credit-overlay"
                onPointerDown={(e) => startDrag('streamer', e)}
                title="Drag to reposition streamer attribution"
                className="group absolute z-20 inline-flex items-center gap-1.5 cursor-grab active:cursor-grabbing touch-none whitespace-nowrap px-1.5 py-0.5 rounded hover:ring-1 hover:ring-sky-400/80"
                style={{
                  left: `${settings.streamerBadgeX}%`,
                  top: `${settings.streamerBadgeY}%`,
                  transform: `translate(-50%, -50%) scale(${settings.streamerBadgeScale / 100})`,
                }}
              >
                {resolvedPlatform === 'kick' && (
                  <KickLogoIcon className="w-4 h-4 text-[#53FC18] shrink-0 drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.9)]" />
                )}
                {resolvedPlatform === 'instagram' && (
                  <InstagramIcon className="w-4 h-4 text-[#E1306C] shrink-0 drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.9)]" />
                )}
                {resolvedPlatform === 'youtube' && (
                  <YouTubeShortsIcon className="w-4 h-4 text-[#FF0033] shrink-0 drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.9)]" />
                )}
                <span
                  className="font-extrabold tracking-tight text-white/95"
                  style={{
                    fontFamily: '"Montserrat", "Plus Jakarta Sans", sans-serif',
                    fontSize: '14px',
                    WebkitTextStroke: '1.5px rgba(0,0,0,0.85)',
                    paintOrder: 'stroke fill',
                    textShadow: '0 2px 6px rgba(0,0,0,0.92)',
                  }}
                >
                  {streamerLabel}
                </span>
                {resolvedPlatform === 'kick' && settings.kickVerifiedBadge && (
                  <BadgeCheck className="w-3.5 h-3.5 text-[#53FC18] shrink-0 drop-shadow" />
                )}
                {resolvedPlatform === 'kick' && settings.kickStatusPill !== 'none' && (
                  <span
                    className={`px-1 py-[1px] rounded text-[8px] font-bold tracking-wider uppercase shrink-0 ${
                      settings.kickStatusPill === 'LIVE'
                        ? 'bg-[#53FC18] text-black'
                        : 'bg-black/75 text-[#53FC18] border border-[#53FC18]/50'
                    }`}
                  >
                    {settings.kickStatusPill}
                  </span>
                )}
              </div>
            )}

            {/* 2026 PLATFORM SAFE ZONE OVERLAY (Auto-Matched to Active Template or Manual Override) */}
            {showSafeZones && (
              <div
                data-testid="safe-zone-overlay"
                data-platform={safeSpec.id}
                className="absolute inset-0 z-30 pointer-events-none"
              >
                {/* Top obstructed UI zone */}
                <div
                  className="absolute inset-x-0 top-0 border-b border-dashed flex items-center justify-center"
                  style={{
                    height: `${topSafePct}%`,
                    backgroundColor: 'rgba(239, 68, 68, 0.16)',
                    borderColor: 'rgba(248, 113, 113, 0.65)',
                  }}
                >
                  <span className="font-mono-tabular text-[9px] text-red-100/95 bg-black/65 px-1.5 py-0.5 rounded">
                    {safeSpec.shortLabel} Top {safeSpec.topPx}px
                  </span>
                </div>

                {/* Bottom obstructed UI zone */}
                <div
                  className="absolute inset-x-0 bottom-0 border-t border-dashed flex items-start justify-center pt-1.5"
                  style={{
                    height: `${bottomSafePct}%`,
                    backgroundColor: 'rgba(239, 68, 68, 0.16)',
                    borderColor: 'rgba(248, 113, 113, 0.65)',
                  }}
                >
                  <span className="font-mono-tabular text-[9px] text-red-100/95 bg-black/65 px-1.5 py-0.5 rounded">
                    {safeSpec.shortLabel} Bottom {safeSpec.bottomPx}px
                  </span>
                </div>

                {/* Left UI margin */}
                <div
                  className="absolute left-0 border-r border-dashed"
                  style={{
                    top: `${topSafePct}%`,
                    bottom: `${bottomSafePct}%`,
                    width: `${leftSafePct}%`,
                    backgroundColor: 'rgba(239, 68, 68, 0.10)',
                    borderColor: 'rgba(248, 113, 113, 0.45)',
                  }}
                />

                {/* Right Engagement Column */}
                <div
                  className="absolute right-0 border-l border-dashed"
                  style={{
                    top: `${topSafePct}%`,
                    bottom: `${bottomSafePct}%`,
                    width: `${rightSafePct}%`,
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    borderColor: 'rgba(248, 113, 113, 0.5)',
                  }}
                />

                {/* Lower-Right Extended Action Stack */}
                {lowerRightPct > 0 && (
                  <div
                    className="absolute right-0 border-l border-t border-dashed flex items-center justify-center"
                    style={{
                      top: `${lowerRightTopPct}%`,
                      bottom: `${bottomSafePct}%`,
                      width: `${lowerRightPct}%`,
                      backgroundColor: 'rgba(245, 158, 11, 0.16)',
                      borderColor: 'rgba(251, 191, 36, 0.65)',
                    }}
                  >
                    <span className="font-mono-tabular text-[8px] text-amber-100 -rotate-90 whitespace-nowrap">
                      Actions
                    </span>
                  </div>
                )}

                {/* YouTube Shorts bottom 8px red progress rail */}
                {safeSpec.hasBottomProgressRail && (
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[3px] bg-[#FF0033]/85"
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subtle stage footer hint & fullscreen button */}
      {clip && (
        <>
          <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/55 border border-white/10 text-[10.5px] text-zinc-400 pointer-events-none">
            <Move className="w-3 h-3" />
            <span>Drag captions, watermark &amp; streamer credit directly</span>
          </div>
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label="Toggle fullscreen preview"
            title="Fullscreen preview (Ctrl+L)"
            className="absolute bottom-3 right-3 h-8 w-8 rounded-md bg-black/65 border border-white/15 text-zinc-300 hover:text-white hover:bg-black/85 grid place-items-center cursor-pointer transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>
        </>
      )}
    </div>
  );
}
