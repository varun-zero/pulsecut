import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFramingFiltergraph,
  computeSplitPresetRatio,
  createDefaultFramingBlueprint,
  defaultCropsForLayout,
  describeFramingBlueprint,
  fitCropToAspect,
  getExportPixelDimensions,
  getOutputSlots,
  getSlotAspect,
  reconcileCrops,
  swapLayoutCrops,
} from './framingEngine';
import {
  autoSuggestMusicLevels,
  buildFullShortExportSpec,
  buildSubtitleTimelineBlocks,
  computeMusicOffset,
  computeMusicRiserVolume,
  computeOutroAnimationFrame,
  computeStitchedDuration,
  createDefaultShortsProduction,
  findTriggeredSfxCues,
  mapSourceTimeToStitched,
  resolveStitchedPlaybackStep,
} from './shortsEngine';
import type { BrandKit, EditorSettings } from '../types';

test('FramingEngine: exact 16:9 Top / Bottom split ratios & 5 aspect pixel dimensions', () => {
  const top169 = computeSplitPresetRatio('16-9-top', '9:16');
  const bot169 = computeSplitPresetRatio('16-9-bottom', '9:16');
  assert.ok(Math.abs(top169 - 0.3164) < 0.002, `Expected ~0.3164, got ${top169}`);
  assert.ok(Math.abs(bot169 - (1 - 0.3164)) < 0.002, `Expected ~0.6836, got ${bot169}`);
  assert.equal(computeSplitPresetRatio('50-50', '9:16'), 0.5);

  assert.deepEqual(getExportPixelDimensions('9:16', '1080p'), { width: 1080, height: 1920 });
  assert.deepEqual(getExportPixelDimensions('4:5', '1080p'), { width: 1080, height: 1350 });
  assert.deepEqual(getExportPixelDimensions('1:1', '1080p'), { width: 1080, height: 1080 });
  assert.deepEqual(getExportPixelDimensions('16:9', '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(getExportPixelDimensions('4:3', '1080p'), { width: 1440, height: 1080 });
  assert.deepEqual(getExportPixelDimensions('9:16', '4k'), { width: 2160, height: 3840 });
});

test('FramingEngine: aspect-locked crop fitting, PiP corner/shape math, and swapCrops', () => {
  const sourceAr = 16 / 9;
  const splitSlots = getOutputSlots('split', '9:16', { splitRatio: 0.5 });
  assert.equal(splitSlots.length, 2);
  const slotAr = getSlotAspect(splitSlots[0], '9:16');
  const fitted = fitCropToAspect({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, slotAr, sourceAr);
  const actualPixelAr = (fitted.w * 1920) / (fitted.h * 1080);
  assert.ok(Math.abs(actualPixelAr - slotAr) < 0.02, `Crop must preserve slot AR (${slotAr}), got ${actualPixelAr}`);

  // PiP rect vs circle aspect ratios
  const pipCircle = getOutputSlots('pip', '9:16', { pip: { shape: 'circle', corner: 'tr', scale: 36 } });
  const pipRect = getOutputSlots('pip', '9:16', { pip: { shape: 'rect', corner: 'tl', scale: 36 } });
  assert.equal(pipCircle.length, 2);
  assert.ok(pipCircle[1].to[0] > 0.5, 'TR corner should place PiP on right half');
  assert.ok(pipRect[1].to[0] < 0.1, 'TL corner should place PiP near left edge');
  assert.ok(pipCircle[1].to[3] > pipRect[1].to[3], '1:1 circle PiP should be taller than 16:9 rect PiP');

  // Reconcile & swap crops
  const bp = createDefaultFramingBlueprint('split', '9:16', sourceAr);
  assert.equal(bp.crops.length, 2);
  const origLeftX = bp.crops[0].x;
  const origRightX = bp.crops[1].x;
  const swapped = swapLayoutCrops(bp, sourceAr);
  assert.ok(Math.abs(swapped[0].x - origRightX) < 0.01);
  assert.ok(Math.abs(swapped[1].x - origLeftX) < 0.01);

  const trioCrops = defaultCropsForLayout('trio', '4:5', sourceAr);
  assert.equal(trioCrops.length, 3);
  const reconciled = reconcileCrops('split', '4:5', sourceAr, trioCrops, { splitRatio: 0.4 });
  assert.equal(reconciled.length, 2);
});

test('FramingEngine: FFmpeg filtergraph generation covers split+divider, trio, pip+hflip, centered, and speed', () => {
  const splitBp = createDefaultFramingBlueprint('split', '9:16');
  splitBp.splitRatio = 0.4;
  splitBp.dividerWidth = 4;
  splitBp.speed = 1.25;
  const splitFg = buildFramingFiltergraph(splitBp, '1080p');
  assert.ok(splitFg.includes('vstack=inputs=2'));
  assert.ok(splitFg.includes('drawbox='));
  assert.ok(splitFg.includes('setpts=PTS/1.25'));
  assert.ok(describeFramingBlueprint(splitBp).includes('Split 40/60'));

  const pipBp = createDefaultFramingBlueprint('pip', '9:16');
  pipBp.pip.flip = true;
  const pipFg = buildFramingFiltergraph(pipBp, '1080p');
  assert.ok(pipFg.includes('hflip'));
  assert.ok(pipFg.includes('overlay='));

  const trioBp = createDefaultFramingBlueprint('trio', '4:5');
  const trioFg = buildFramingFiltergraph(trioBp, '1080p');
  assert.ok(trioFg.includes('split=3'));
  assert.ok(trioFg.includes('vstack=inputs=3'));
});

test('FramingEngine: default PiP facecam is rectangular (16:9), supports Free Rect & 4:3, and Full Screen (100%) uses contain + backdrop', () => {
  const pipBp = createDefaultFramingBlueprint('pip', '9:16', 16 / 9);
  const pipSlots = getOutputSlots('pip', '9:16', { pip: pipBp.pip, crops: pipBp.crops, sourceAr: 16 / 9 });
  const pipSlotAr = getSlotAspect(pipSlots[1], '9:16');
  assert.ok(Math.abs(pipSlotAr - 16 / 9) < 0.02, `Default PiP facecam must be a 16:9 rectangle, got AR=${pipSlotAr}`);
  assert.equal(pipBp.pip.shape, 'rounded', 'Default PiP should keep rounded corners on the rectangle');

  // 4:3 rectangular facecam
  const pip43 = getOutputSlots('pip', '9:16', { pip: { shape: 'rounded', aspect: '4:3', scale: 44 } });
  assert.ok(Math.abs(getSlotAspect(pip43[1], '9:16') - 4 / 3) < 0.02);

  // Free rectangular facecam derives output aspect directly from dragged source crop
  const customWideFacecam = { x: 0.02, y: 0.03, w: 0.36, h: 0.24 }; // pixel AR = (0.36 * 16/9) / 0.24 = 2.66 -> clamped to 2.6
  const pipFree = getOutputSlots('pip', '9:16', {
    pip: { shape: 'rounded', aspect: 'free', scale: 50 },
    crops: [{ x: 0, y: 0, w: 1, h: 1 }, customWideFacecam],
    sourceAr: 16 / 9,
  });
  assert.ok(getSlotAspect(pipFree[1], '9:16') > 2.2, 'Free Rect PiP should match wide rectangular crop');

  // Reconcile preserves fullFrameSlots (100% whole video) and free facecam crop
  const fullReconciled = reconcileCrops('pip', '9:16', 16 / 9, [{ x: 0, y: 0, w: 1, h: 1 }, customWideFacecam], {
    pip: { shape: 'rounded', aspect: 'free', scale: 50 },
    fullFrameSlots: { 0: true },
  });
  assert.deepEqual(fullReconciled[0], { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(fullReconciled[1], customWideFacecam);

  // Solo Full Screen (100%) emits force_original_aspect_ratio=decrease + backdrop overlay
  const soloFull = createDefaultFramingBlueprint('solo', '9:16');
  soloFull.crops = [{ x: 0, y: 0, w: 1, h: 1 }];
  soloFull.fullFrameSlots = { 0: true };
  const soloFullFg = buildFramingFiltergraph(soloFull, '1080p');
  assert.ok(soloFullFg.includes('force_original_aspect_ratio=decrease'), 'Solo Full Frame must preserve full widescreen video');
  assert.ok(soloFullFg.includes('boxblur='), 'Solo Full Frame should render over blurred backdrop by default');
  assert.ok(describeFramingBlueprint(soloFull).includes('Solo Full Frame'));

  // PiP with Full Screen Main Video + Rectangular Facecam
  pipBp.crops[0] = { x: 0, y: 0, w: 1, h: 1 };
  pipBp.fullFrameSlots = { 0: true };
  const pipFullFg = buildFramingFiltergraph(pipBp, '1080p');
  assert.ok(pipFullFg.includes('split=3[bg_in][main_in][pip_in]'));
  assert.ok(pipFullFg.includes('force_original_aspect_ratio=decrease[main_fg]'));
  assert.ok(describeFramingBlueprint(pipBp).includes('PiP 16:9 Rect · Full Frame'));
});

test('ShortsEngine: multi-segment stitching, playback stepping, and stitched time mapping', () => {
  const segs = [
    { id: 'b', start: 20, end: 28 },
    { id: 'a', start: 4, end: 10 },
  ];
  // Sorted total raw = (10-4) + (28-20) = 14s; at 1.4x speed = 10s
  assert.equal(computeStitchedDuration(segs, 1.4), 10);
  // Source time 7s is 3s into first segment -> 3 / 1 = 3s
  assert.equal(mapSourceTimeToStitched(7, segs, 1), 3);
  // Source time 24s is 6s (seg a) + 4s (into seg b) = 10s
  assert.equal(mapSourceTimeToStitched(24, segs, 1), 10);

  // Gap between 10 and 20 should jump straight to 20
  assert.deepEqual(resolveStitchedPlaybackStep(12, segs), {
    action: 'jump',
    targetTime: 20,
    segmentIndex: 1,
  });
  assert.equal(resolveStitchedPlaybackStep(6, segs).action, 'play');
  assert.equal(resolveStitchedPlaybackStep(28.1, segs).action, 'end');
});

test('ShortsEngine: exact decompiled music riser curve, offset wrap, SFX trigger, and outro animation', () => {
  // Music offset wrap
  assert.equal(computeMusicOffset(0, 60, 15), 0);
  assert.equal(computeMusicOffset(25, 60, 15), 10);
  assert.equal(computeMusicOffset(5, 60, 15), 50);

  // Music riser volume curve: 20s clip, 5s riser (starts at 15s), ducked 15% -> peak 85%
  assert.ok(Math.abs(computeMusicRiserVolume(5, 20, 15, 85, 5, false) - 0.15) < 0.001);
  assert.ok(Math.abs(computeMusicRiserVolume(17.5, 20, 15, 85, 5, false) - 0.5) < 0.001);
  assert.ok(Math.abs(computeMusicRiserVolume(20, 20, 15, 85, 5, false) - 0.85) < 0.001);
  assert.ok(Math.abs(computeMusicRiserVolume(1, 20, 15, 85, 5, true) - 0.85) < 0.001);

  const suggested = autoSuggestMusicLevels(25);
  assert.equal(suggested.audioBaseVol, 15);
  assert.equal(suggested.audioPeakVol, 85);
  assert.ok(suggested.riserDurationSec >= 2 && suggested.riserDurationSec <= 6);

  // SFX trigger window
  const triggered = findTriggeredSfxCues(4.8, 5.1, [
    { id: '1', sfxId: 'sfx-whoosh', name: 'Whoosh', time: 5.0, volume: 0.9 },
    { id: '2', sfxId: 'sfx-pop', name: 'Pop', time: 7.0, volume: 0.8 },
  ]);
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].id, '1');

  // Outro ease-out frame math
  const startFrame = computeOutroAnimationFrame(0, { animDuration: 1.2 });
  const endFrame = computeOutroAnimationFrame(1.2, { animDuration: 1.2 });
  assert.equal(startFrame.picScale, 0.4);
  assert.equal(endFrame.picScale, 1);
  assert.equal(endFrame.textOpacity, 1);
  assert.equal(endFrame.textRisePx, 0);
});

test('ShortsEngine: full stitched export spec fuses Section 1 Framing Blueprint with Section 2 Shorts config', () => {
  const bp = createDefaultFramingBlueprint('split', '4:5');
  bp.splitRatio = 0.45;
  const shorts = createDefaultShortsProduction();
  shorts.multiSegmentEnabled = true;
  shorts.segments = [
    { id: 's1', start: 2, end: 8 },
    { id: 's2', start: 14, end: 22 },
  ];
  shorts.exportEncoder = 'nvenc';
  shorts.outro.enabled = true;

  const settings = {
    template: 'kick-stream',
    aspect: '4:5',
    layout: 'split',
    captionStyle: 'kick-neon',
    subtitleFont: 'Montserrat',
    subtitleSize: 26,
    subtitleCasing: 'upper',
    subtitleBaseColor: '#FFFFFF',
    subtitleActiveColor: '#53FC18',
    subtitleEmphasisColor: '#FFE600',
    subtitleStrokeWidth: 4,
    subtitleStrokeColor: '#000000',
    subtitleDropShadow: true,
    subtitleNeonGlow: false,
    subtitleAnimation: 'pop-scale',
    subtitleVerticalPos: 74,
    subtitleX: 50,
    subtitleAlign: 'center',
    subtitleBgStyle: 'none',
    safeZonePlatform: 'auto',
    playbackSpeed: 1,
    audioBaseVol: 15,
    audioPeakVol: 85,
    riserDurationSec: 5,
    customAudioName: 'hype.mp3',
  } as unknown as EditorSettings;

  const brandKit: BrandKit = {
    handle: '@pulse',
    displayName: 'Pulse',
    verified: true,
    defaultOutro: 'Follow',
    watermarkPosition: 'bottom-center',
    watermarkOpacity: 95,
    showWatermark: true,
  };

  const spec = buildFullShortExportSpec(
    bp,
    shorts,
    settings,
    brandKit,
    [{ start_ms: 2500, end_ms: 4000, text: 'INSANE PLAY' }],
    0,
    30
  );
  assert.deepEqual(spec.dimensions, { width: 1080, height: 1350 });
  assert.equal(spec.segmentCount, 2);
  assert.equal(spec.stitchedDurationSec, 14);
  assert.ok(spec.ffmpegFiltergraph.includes('concat=n=2:v=1:a=0[vstitched]'));
  assert.ok(spec.ffmpegFiltergraph.includes('vstack=inputs=2'));
  assert.ok(spec.ffmpegCommand.includes('h264_nvenc'));
  assert.ok(spec.assScript.includes('PlayResY: 1350'));
});

test('ShortsEngine: buildSubtitleTimelineBlocks covers >60 words across full clip with zero overlaps', () => {
  const words = Array.from({ length: 120 }, (_, i) => ({
    text: i % 8 === 7 ? `word${i}.` : `word${i}`,
    start_ms: i * 350,
    end_ms: i * 350 + 280,
  }));
  const blocks = buildSubtitleTimelineBlocks(words, 45);
  assert.ok(blocks.length >= 25 && blocks.length <= 45, `Expected ~30 phrase blocks, got ${blocks.length}`);
  assert.ok(blocks[blocks.length - 1].startSec > 38, 'Must cover past word 60 through end of clip');

  for (let i = 0; i < blocks.length - 1; i += 1) {
    const rightEdge = blocks[i].leftPct + blocks[i].widthPct;
    assert.ok(
      rightEdge <= blocks[i + 1].leftPct + 0.001,
      `Block ${i} (${rightEdge}%) overlaps block ${i + 1} (${blocks[i + 1].leftPct}%)`
    );
  }
});
