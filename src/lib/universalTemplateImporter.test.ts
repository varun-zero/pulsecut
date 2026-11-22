import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, zipSync } from 'fflate';
import {
  assColorToHex,
  exportTemplateToPortableJson,
  mapDimensionsToAspectRatio,
  normalizeColorHex,
  parseUniversalTemplateFiles,
  parseUniversalTemplateText,
  sanitizeSvgMarkup,
} from './universalTemplateImporter';
import { buildFullShortExportSpec, createDefaultShortsProduction } from './shortsEngine';
import { createDefaultFramingBlueprint } from './framingEngine';
import type { BrandKit, EditorSettings } from '../types';

const enc = (s: string) => new TextEncoder().encode(s);

// Minimal valid 1080x1920 PNG header (signature + IHDR chunk) for dimension detection tests
function createSyntheticPngHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(33);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13, false); // IHDR length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

test('parses real CapCut draft_content.json with nested text styles, split video tracks, LUT, transition, and speed', () => {
  const capcutDraft = {
    name: 'CapCut Viral Split Edit',
    canvas_config: { width: 1080, height: 1920, ratio: '9:16', background: '#111114' },
    materials: {
      videos: [{ id: 'v1', width: 1920, height: 1080 }, { id: 'v2', width: 1920, height: 1080 }],
      texts: [
        {
          id: 'txt-hook',
          content: JSON.stringify({
            text: 'WAIT FOR THE ENDING',
            styles: [
              {
                font: { path: '/fonts/Poppins-ExtraBold.ttf' },
                size: 11,
                fill: { content: { solid: { color: [1, 1, 1] } } },
                strokes: [{ width: 0.1 }],
              },
            ],
          }),
          background_alpha: 0.85,
          background_color: '#FFFFFF',
        },
        {
          id: 'txt-sub',
          content: JSON.stringify({
            text: 'THIS ACTUALLY HAPPENED',
            styles: [
              {
                font: { name: 'BebasNeue-Bold.otf' },
                size: 13,
                fill: { content: { solid: { color: [0.325, 0.988, 0.094] } } },
                strokes: [{ width: 0.12 }],
              },
            ],
          }),
        },
      ],
      video_effects: [{ name: 'Cinematic Teal Film' }],
      transitions: [{ name: 'Whip Zoom Pull In' }],
      speeds: [{ speed: 1.15 }],
    },
    tracks: [
      { type: 'video', segments: [{ material_id: 'v1', clip: { scale: { x: 1, y: 1 } } }] },
      { type: 'video', segments: [{ material_id: 'v2', clip: { scale: { x: 1, y: 1 } } }] },
      {
        type: 'text',
        segments: [
          { material_id: 'txt-hook', clip: { transform: { x: 0, y: 0.64 } } }, // ~18% from top
          { material_id: 'txt-sub', clip: { transform: { x: 0, y: -0.44 } } }, // ~72% from top
        ],
      },
    ],
  };

  const res = parseUniversalTemplateFiles([
    { name: 'draft_content.json', bytes: enc(JSON.stringify(capcutDraft)) },
  ]);

  assert.equal(res.detectedFormat, 'capcut');
  assert.equal(res.confidence, 'high');
  assert.equal(res.template.name, 'CapCut Viral Split Edit');
  assert.equal(res.template.defaultAspect, '9:16');
  assert.equal(res.template.defaultLayout, 'split');
  assert.equal(res.template.defaultHeadlineFont, 'Poppins');
  assert.equal(res.template.defaultSubtitleFont, 'BebasNeue');
  assert.equal(res.template.defaultHeadlineY, 18);
  assert.equal(res.template.defaultSubtitleY, 72);
  assert.equal(res.template.defaultHeadlineLayout, 'white-stepped');
  assert.equal(res.template.defaultColorFilter, 'cinematic');
  assert.equal(res.template.defaultTransitionStyle, 'zoom-in');
  assert.equal(res.template.defaultPlaybackSpeed, 1.15);
  assert.equal(res.template.defaultSubtitleActiveColor, '#53FC18');
  assert.ok(res.extractedCaptionStyle);
});

test('extracts CapCut .zip bundle with draft_content.json, transparent overlay PNG, and bundled .ttf font', () => {
  const capcutJson = JSON.stringify({
    canvas_config: { width: 1080, height: 1920, ratio: '9:16' },
    materials: {
      videos: [{ id: 'v1', width: 1920, height: 1080 }],
      texts: [],
    },
    tracks: [
      { type: 'video', segments: [{ material_id: 'v1', clip: { scale: { x: 1.0, y: 1.0 } } }] },
    ],
  });

  const archiveBytes = zipSync({
    'draft_content.json': enc(capcutJson),
    'assets/viral_frame_overlay.png': createSyntheticPngHeader(1080, 1920),
    'fonts/CustomImpact-Bold.ttf': new Uint8Array([0, 1, 0, 0, 10, 20, 30]),
  });

  const res = parseUniversalTemplateFiles([{ name: 'MyCapCutPack.zip', bytes: archiveBytes }]);

  assert.equal(res.detectedFormat, 'capcut');
  assert.equal(res.template.defaultFullScreen, true);
  assert.ok(res.template.overlayImageDataUrl?.startsWith('data:image/png;base64,'));
  assert.equal(res.extractedFonts.length, 1);
  assert.equal(res.extractedFonts[0].family, 'CustomImpact');
});

test('parses Alight Motion XML and .amproj ZIP packages accurately', () => {
  const alightXml = `<?xml version="1.0" encoding="utf-8"?>
<scene title="Alight Motion Glow Edit" width="1080" height="1920" fps="60" bgcolor="#FF0D0D12">
  <media id="1" />
  <text id="2" font="Anton-Regular.ttf" size="48" fillColor="#FFFFE600">
    <transform><location value="540,1440,0" /></transform>
    <stroke size="5" />
    <content>INSANE CLUTCH</content>
  </text>
  <effect id="com.alightcreative.effects.vignette" />
</scene>`;

  const resXml = parseUniversalTemplateText(alightXml, 'alight');
  assert.equal(resXml.detectedFormat, 'alight-motion');
  assert.equal(resXml.template.name, 'Alight Motion Glow Edit');
  assert.equal(resXml.template.defaultAspect, '9:16');
  assert.equal(resXml.template.defaultOuterFill, '#0D0D12');
  assert.equal(resXml.template.defaultSubtitleFont, 'Anton');
  assert.equal(resXml.template.defaultSubtitleActiveColor, '#FFE600');
  assert.equal(resXml.template.defaultSubtitleY, 75);
  assert.equal(resXml.template.defaultColorFilter, 'moody');

  // Now test .amproj ZIP wrapper
  const amprojBytes = zipSync({
    'project.xml': enc(alightXml),
    'overlays/hud_frame.svg': enc('<svg viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="none" stroke="#fff"/></svg>'),
  });
  const resAmproj = parseUniversalTemplateFiles([{ name: 'VelocityPack.amproj', bytes: amprojBytes }]);
  assert.equal(resAmproj.detectedFormat, 'alight-motion');
  assert.ok(resAmproj.template.overlayImageDataUrl?.startsWith('data:image/svg+xml;utf8,'));
});

test('parses After Effects / Lottie JSON template', () => {
  const lottie = {
    v: '5.12.2',
    nm: 'AE Minimal Reels',
    w: 1080,
    h: 1350,
    fr: 30,
    fonts: { list: [{ fFamily: 'Inter', fName: 'Inter-Bold' }] },
    layers: [
      { ty: 1, sc: '#121216' },
      {
        ty: 5,
        ks: { p: { k: [540, 945, 0] } },
        t: { d: { k: [{ s: { f: 'Inter-Bold', s: 64, fc: [0.22, 0.74, 0.97] } }] } },
      },
    ],
  };

  const res = parseUniversalTemplateFiles([{ name: 'ae_reels.json', bytes: enc(JSON.stringify(lottie)) }]);
  assert.equal(res.detectedFormat, 'lottie-ae');
  assert.equal(res.template.name, 'AE Minimal Reels');
  assert.equal(res.template.defaultAspect, '4:5');
  assert.equal(res.template.defaultOuterFill, '#121216');
  assert.equal(res.template.defaultSubtitleFont, 'Inter');
  assert.equal(res.template.defaultSubtitleY, 70);
});

test('parses FCPXML and gzipped Premiere .prproj XML templates', () => {
  const fcpxml = `<fcpxml version="1.10">
    <resources><format id="r1" width="1920" height="1080"/></resources>
    <project name="YouTube Widescreen Documentary">
      <title font="Montserrat-Bold" fontColor="1 0.9 0 1" />
    </project>
  </fcpxml>`;

  const resFcp = parseUniversalTemplateFiles([{ name: 'doc.fcpxml', bytes: enc(fcpxml) }]);
  assert.equal(resFcp.detectedFormat, 'fcpxml');
  assert.equal(resFcp.template.defaultAspect, '16:9');
  assert.equal(resFcp.template.defaultLayout, 'widescreen');
  assert.equal(resFcp.template.defaultHeadlineFont, 'Montserrat');

  const prprojBytes = gzipSync(enc(`<PremiereData><sequence name="Premiere Vertical"><width>1080</width><height>1920</height></sequence></PremiereData>`));
  const resPr = parseUniversalTemplateFiles([{ name: 'VerticalEdit.prproj', bytes: prprojBytes }]);
  assert.equal(resPr.detectedFormat, 'premiere-mogrt');
  assert.equal(resPr.template.defaultAspect, '9:16');
});

test('parses ASS/SSA caption templates including BGR hex color conversion and MarginV placement', () => {
  assert.equal(assColorToHex('&H0000E6FF'), '#FFE600');
  assert.equal(normalizeColorHex('#FF53FC18'), '#53FC18');
  assert.equal(mapDimensionsToAspectRatio(1080, 1920), '9:16');

  const ass = `[Script Info]
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ViralYellow,Rubik,72,&H0000E6FF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,40,40,420,1
`;

  const res = parseUniversalTemplateText(ass, 'HormoziASS');
  assert.equal(res.detectedFormat, 'ass-subtitles');
  assert.equal(res.template.defaultSubtitleFont, 'Rubik');
  assert.equal(res.template.defaultSubtitleActiveColor, '#FFE600');
  assert.equal(res.template.defaultSubtitleStrokeWidth, 6);
  assert.ok((res.template.defaultSubtitleY ?? 0) >= 65 && (res.template.defaultSubtitleY ?? 0) <= 80);
});

test('sanitizes untrusted SVG visual overlay frames and integrates overlay into FFmpeg export spec', () => {
  const dirtySvg = `<svg viewBox="0 0 1080 1920" onload="alert(1)"><script>evil()</script><rect x="20" y="20" width="1040" height="1880" stroke="#FFE600" fill="none"/></svg>`;
  const clean = sanitizeSvgMarkup(dirtySvg);
  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('onload='), false);
  assert.equal(clean.includes('stroke="#FFE600"'), true);

  const res = parseUniversalTemplateFiles([
    { name: 'Canva_Border_Frame.svg', bytes: enc(dirtySvg), mimeType: 'image/svg+xml' },
  ]);
  assert.equal(res.detectedFormat, 'image-overlay');
  assert.equal(res.template.defaultAspect, '9:16');
  assert.ok(res.template.overlayImageDataUrl?.startsWith('data:image/svg+xml;utf8,'));

  // Verify FFmpeg export spec composites templateOverlayUrl cleanly
  const bp = createDefaultFramingBlueprint('solo', '9:16');
  const shorts = createDefaultShortsProduction();
  const brand: BrandKit = {
    handle: '@creator',
    displayName: 'Creator',
    verified: false,
    defaultOutro: '',
    watermarkPosition: 'top-right',
    watermarkOpacity: 80,
    showWatermark: false,
  };
  const settings = {
    template: res.template.id,
    templateEnabled: true,
    aspect: '9:16',
    layout: 'solo',
    captionStyle: 'hormozi-classic',
    safeZonePlatform: 'youtube-shorts',
    font: 'Montserrat',
    subtitleFont: 'Montserrat',
    subtitleSize: 26,
    subtitleCasing: 'upper',
    subtitleWordsPerScreen: '2-3',
    subtitleBaseColor: '#FFFFFF',
    subtitleActiveColor: '#FFE600',
    subtitleEmphasisColor: '#FFE600',
    subtitleStrokeWidth: 4,
    subtitleStrokeColor: '#000000',
    subtitleDropShadow: true,
    subtitleNeonGlow: false,
    subtitleAnimation: 'pop-scale',
    subtitleVerticalPos: 70,
    subtitleX: 50,
    subtitleMaxWidth: 88,
    subtitleAlign: 'center',
    subtitleLineHeight: 1.15,
    subtitleBgStyle: 'none',
    templateOverlayUrl: res.template.overlayImageDataUrl,
    templateOverlayOpacity: 85,
    templateOverlayBlendMode: 'normal',
    colorFilter: 'none',
    brightness: 100,
    contrast: 100,
    saturation: 100,
    exposure: 0,
    temperature: 0,
    blur: 0,
    vignette: 0,
    videoScale: 100,
    videoPosX: 0,
    videoPosY: 0,
    videoRotation: 0,
    videoFlipH: false,
    videoFlipV: false,
    videoOpacity: 100,
    videoSharpen: 0,
    masterVolume: 100,
    audioFadeInSec: 0,
    audioFadeOutSec: 0,
    audioNormalize: false,
    targetLufs: -14,
    muteOriginalAudio: false,
    customAudioName: '',
    audioBaseVol: 15,
    audioPeakVol: 85,
    riserDurationSec: 5,
  } as unknown as EditorSettings;

  const spec = buildFullShortExportSpec(bp, shorts, settings, brand, [], 0, 15, []);
  assert.ok(spec.ffmpegCommand.includes('-i template_overlay.png'));
  assert.ok(spec.ffmpegFiltergraph.includes('overlay=0:0:shortest=1[voverlaid]'));
  assert.ok(spec.summaryLines.some((l) => l.includes('Template Overlay: Graphic frame (85%')));
});

test('round-trips PulseCut portable JSON and heuristically maps arbitrary third-party JSON', () => {
  const arbitrary = {
    templateName: 'VN Editor Reel Pack',
    canvasWidth: 1080,
    canvasHeight: 1080,
    fontFamily: 'Oswald',
    accentColor: '#38BDF8',
    backgroundColor: '#0A0A0C',
    layoutMode: 'full-screen',
    captionY: 78,
    filterName: 'Warm Sunset LUT',
  };

  const imported = parseUniversalTemplateText(JSON.stringify(arbitrary), 'vn_pack');
  assert.equal(imported.detectedFormat, 'generic-json');
  assert.equal(imported.template.name, 'VN Editor Reel Pack');
  assert.equal(imported.template.defaultAspect, '1:1');
  assert.equal(imported.template.defaultFullScreen, true);
  assert.equal(imported.template.defaultHeadlineFont, 'Oswald');
  assert.equal(imported.template.accentHex, '#38BDF8');
  assert.equal(imported.template.defaultSubtitleY, 78);
  assert.equal(imported.template.defaultColorFilter, 'warm');

  // Export to .pulsecut.json and re-import losslessly
  const exportedJson = exportTemplateToPortableJson(imported.template);
  const reimported = parseUniversalTemplateText(exportedJson, 'roundtrip');
  assert.equal(reimported.detectedFormat, 'pulsecut');
  assert.equal(reimported.template.name, 'VN Editor Reel Pack');
  assert.equal(reimported.template.defaultAspect, '1:1');
  assert.equal(reimported.template.defaultFullScreen, true);
  assert.equal(reimported.template.defaultSubtitleY, 78);
});
