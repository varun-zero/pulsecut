/**
 * Typed registry for the 13 bundled ClipShip 9:16 overlay templates.
 * Source of truth: public/templates/clipship/templates.json (alpha-measured cutouts).
 */
import registryJson from '../data/clipshipTemplates.json';

export interface ClipshipCutout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClipshipTemplate {
  id: string;
  folder: string;
  preview: string;
  frame: string | null;
  layers: string[];
  cutouts: ClipshipCutout[];
  measuredCutout: number[] | null;
  headerZone: number[] | null;
  textZone: number[];
  replyZone: number[] | null;
  replyTextZone: number[] | null;
  style: string;
  textCase: 'lowercase';
}

interface ClipshipRegistry {
  version: number;
  canvas: { width: number; height: number };
  sourceRoot: string;
  branding: {
    excludedLayers: string[];
    customHeader: {
      pageName: string;
      pageHandle: string;
      avatarPath: string;
      showVerifiedBadge: boolean;
    };
  };
  templates: ClipshipTemplate[];
}

export const CLIPSHIP_REGISTRY = registryJson as ClipshipRegistry;
export const CLIPSHIP_TEMPLATES: readonly ClipshipTemplate[] = CLIPSHIP_REGISTRY.templates;

export const CLIPSHIP_TEMPLATES_BY_ID: Record<string, ClipshipTemplate> = Object.fromEntries(
  CLIPSHIP_TEMPLATES.map((t) => [t.id, t])
);

export const CLIPSHIP_FOLDER_BY_ID: Record<string, string> = Object.fromEntries(
  CLIPSHIP_TEMPLATES.map((t) => [t.id, t.folder])
);

/** Vite public URL for a template's preview image. */
export function clipshipPreviewUrl(t: ClipshipTemplate): string {
  return `/templates/clipship/${t.folder}/00_PREVIEW.jpg`;
}

/** Vite public URL for a template's transparent frame PNG (if it has one). */
export function clipshipFrameUrl(t: ClipshipTemplate): string | null {
  return t.frame ? `/templates/clipship/${t.folder}/1_frame.png` : null;
}

/** Custom page branding defaults — no Clip Ship watermarks are ever rendered. */
export interface ClipshipBranding {
  pageName: string;
  pageHandle: string;
  avatarPath: string;
  showVerifiedBadge: boolean;
}

export const DEFAULT_CLIPSHIP_BRANDING: ClipshipBranding = {
  pageName: 'beats cut',
  pageHandle: '@beatscutfm',
  avatarPath: '/templates/clipship/_Extras/beatscut_logo.jpg',
  showVerifiedBadge: true,
};

/** All on-screen text is forced lowercase per the campaign brief. */
export function toLowercaseLines(text: string): string {
  return text
    .toLowerCase()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** Approved hook captions from the campaign brief, keyed by clip number. */
export const APPROVED_HOOKS: Record<number, { template: string; lines: string[]; reply?: string[] }> = {
  1: {
    template: '03_Tweet_Plus_Reply',
    lines: ['chris stapleton and mumford on one stage is unfair to everyone else'],
    reply: ['the way their voices blend live 😭'],
  },
  2: {
    template: '08_News_Card',
    lines: ['mumford & sons at the cmas.', 'i repeat. mumford & sons at the cmas'],
  },
  3: { template: '09_Fullscreen_Text_Box', lines: ['this collab sounds even better live'] },
  4: { template: '01_Tweet_Card_Dark', lines: ['they did not have to go this hard on their cmas debut'] },
  5: { template: '02_Tweet_Card_Light', lines: ['the british invasion of nashville was not on my 2026 bingo card 😭'] },
  6: { template: '07_Comment_Reply', lines: ['banjos from london meet nashville and it just works'] },
  7: { template: '06_Stacked_Comparison', lines: ['nashville said come on in and they did not miss'] },
  8: { template: '05_White_Meme', lines: ["i'm officially naming the marcus mumford & chris stapleton duo, mapleton ☠️"] },
  9: { template: '04_Big_Meme_Caption', lines: ['the fellas from across the pond landed with a splash!'] },
  10: { template: '10_Reddit_Thread', lines: ['the way their voices blend live 😭'] },
  11: { template: '11_Condensed_Headline', lines: ['banjos from london meet nashville and it just works'] },
  12: { template: '12_Collage_Pill', lines: ['mumford & sons and chris stapleton live at the cmas'] },
  13: { template: '13_Reaction_Split_Pill', lines: ['this collab sounds even better live'] },
};
