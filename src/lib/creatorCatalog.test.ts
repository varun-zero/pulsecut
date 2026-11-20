import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_PRESETS } from '../presets';
import { getViralCaptionPreset, VIRAL_CAPTION_PRESETS, VIRAL_FONTS } from '../captionStyles';
import {
  addCaptionStyleToCatalog,
  BUILTIN_LOGOS,
  COPYRIGHT_FREE_MUSIC_CATALOG,
  createBlankTemplateDraft,
  deleteCaptionStyleFromCatalog,
  deleteTemplateFromCatalog,
  detectVideoNiche,
  EMPTY_CAPTION_CATALOG,
  EMPTY_TEMPLATE_CATALOG,
  filterMusicCatalog,
  getHashtagPack,
  resolveCaptionCatalog,
  resolveTemplateCatalog,
  TRENDING_HASHTAG_PACKS,
  upsertTemplateInCatalog,
  type EditableCaptionPreset,
} from './creatorCatalog';

describe('Creator Catalog — Templates, Fonts, Captions, Logos, Music & Hashtags', () => {
  it('supports creating, editing, deleting, and protecting the last template', () => {
    const builtinIds = new Set(TEMPLATE_PRESETS.map((t) => t.id));
    let state = EMPTY_TEMPLATE_CATALOG;

    // 1. Create a custom Full-Screen 9:16 template with explicit caption placement
    const custom = createBlankTemplateDraft({
      id: 'custom-fullscreen-yt',
      name: 'Full Screen YT',
      defaultAspect: '9:16',
      defaultFullScreen: true,
      defaultHeadlineY: 16,
      defaultSubtitleY: 80,
    });
    state = upsertTemplateInCatalog(state, custom, builtinIds);

    let resolved = resolveTemplateCatalog(TEMPLATE_PRESETS, state);
    assert.equal(resolved[0].id, 'custom-fullscreen-yt');
    assert.equal(resolved[0].defaultFullScreen, true);
    assert.equal(resolved[0].defaultSubtitleY, 80);
    assert.equal(resolved.length, TEMPLATE_PRESETS.length + 1);

    // 2. Edit a built-in template in-place
    const editedBuiltin = {
      ...TEMPLATE_PRESETS[0],
      name: 'Classic Edited',
      defaultAspect: '4:5' as const,
      defaultFullScreen: true,
      defaultSubtitleY: 75,
    };
    state = upsertTemplateInCatalog(state, editedBuiltin, builtinIds);
    resolved = resolveTemplateCatalog(TEMPLATE_PRESETS, state);
    const classic = resolved.find((t) => t.id === TEMPLATE_PRESETS[0].id);
    assert.equal(classic?.name, 'Classic Edited');
    assert.equal(classic?.defaultAspect, '4:5');
    assert.equal(classic?.defaultFullScreen, true);

    // 3. Delete custom template and a built-in template
    state = deleteTemplateFromCatalog(state, 'custom-fullscreen-yt', TEMPLATE_PRESETS);
    state = deleteTemplateFromCatalog(state, TEMPLATE_PRESETS[1].id, TEMPLATE_PRESETS);
    resolved = resolveTemplateCatalog(TEMPLATE_PRESETS, state);
    assert.equal(resolved.some((t) => t.id === 'custom-fullscreen-yt'), false);
    assert.equal(resolved.some((t) => t.id === TEMPLATE_PRESETS[1].id), false);

    // 4. Deleting down to 1 never empties the catalog
    for (const tpl of TEMPLATE_PRESETS) {
      state = deleteTemplateFromCatalog(state, tpl.id, TEMPLATE_PRESETS);
    }
    resolved = resolveTemplateCatalog(TEMPLATE_PRESETS, state);
    assert.equal(resolved.length, 1);
  });

  it('supports expanded fonts, expanded caption styles, and custom caption style CRUD', () => {
    assert.ok(VIRAL_FONTS.length >= 20, `Expected >=20 built-in fonts, got ${VIRAL_FONTS.length}`);
    assert.ok(
      VIRAL_CAPTION_PRESETS.length >= 12,
      `Expected >=12 built-in caption styles, got ${VIRAL_CAPTION_PRESETS.length}`
    );
    assert.ok(BUILTIN_LOGOS.length >= 4, 'Expected >=4 built-in vector logos');

    let state = EMPTY_CAPTION_CATALOG;
    const customCap: EditableCaptionPreset = {
      id: 'custom-cap-gold',
      name: 'Gold Punch',
      tagline: 'Custom gold viral style',
      isCustom: true,
      headlineFont: 'Russo One',
      subtitleFont: 'Russo One',
      subtitleWeight: 900,
      casing: 'upper',
      wordsPerScreen: '1',
      baseColor: '#FFFFFF',
      activeColor: '#F59E0B',
      emphasisColor: '#EF4444',
      strokeWidth: 6,
      strokeColor: '#000000',
      dropShadow: true,
      neonGlow: false,
      animation: 'pop-scale',
      surfaceTreatment: 'outline',
      sampleWords: ['GOLD', 'PUNCH'],
    };
    state = addCaptionStyleToCatalog(state, customCap);
    const resolved = resolveCaptionCatalog(VIRAL_CAPTION_PRESETS, state);
    assert.equal(resolved[0].id, 'custom-cap-gold');

    // Resolver finds custom caption style cleanly
    const lookedUp = getViralCaptionPreset('custom-cap-gold', resolved);
    assert.equal(lookedUp.name, 'Gold Punch');

    // Delete custom style and verify removal
    state = deleteCaptionStyleFromCatalog(state, 'custom-cap-gold', VIRAL_CAPTION_PRESETS);
    const afterDelete = resolveCaptionCatalog(VIRAL_CAPTION_PRESETS, state);
    assert.equal(afterDelete.some((c) => c.id === 'custom-cap-gold'), false);
  });

  it('filters copyright-free viral music by scenario/mood and viral-only flag', () => {
    assert.ok(COPYRIGHT_FREE_MUSIC_CATALOG.length >= 15);
    const moods = ['thrilled', 'phonk', 'sad', 'happy', 'suspense', 'motivational'] as const;
    for (const mood of moods) {
      const tracks = filterMusicCatalog(mood, false);
      assert.ok(tracks.length >= 2, `Expected >=2 tracks for mood "${mood}"`);
      assert.ok(tracks.every((t) => t.mood === mood));
      assert.ok(tracks.every((t) => t.downloadUrl.startsWith('https://')));
    }

    const viralOnly = filterMusicCatalog('all', true);
    const allTracks = filterMusicCatalog('all', false);
    assert.ok(viralOnly.length > 0 && viralOnly.length < allTracks.length);
    assert.ok(viralOnly.every((t) => t.trending));
  });

  it('auto-detects video type for trending hashtags and returns curated packs', () => {
    assert.equal(TRENDING_HASHTAG_PACKS.length, 9);
    assert.equal(detectVideoNiche('How to speak so people listen - TED Talk'), 'podcast-talk');
    assert.equal(detectVideoNiche('INSANE GTA 6 Clutch live on Kick', '', 'Kick'), 'gaming-stream');
    assert.equal(detectVideoNiche('Stoic discipline habits for 2026'), 'motivation');
    assert.equal(detectVideoNiche('New AI coding agent builds apps in 10 seconds'), 'tech-ai');
    assert.equal(detectVideoNiche('How I built a $1M startup with zero investors'), 'finance-business');
    assert.equal(detectVideoNiche('Random daily vlog clip'), 'youtube-general');

    const pack = getHashtagPack('podcast-talk');
    assert.ok(pack.topViral.includes('shorts'));
    assert.ok(pack.topViral.includes('podcast'));
    assert.ok(pack.nicheTags.length >= 4);
  });
});
