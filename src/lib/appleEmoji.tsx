import React, { useMemo } from 'react';

/**
 * Static mirror of the PNG filenames in `public/emoji/apple/` (without the
 * `.png` suffix). Generated from that directory — 163 entries — so no runtime
 * filesystem access is required. Vite serves each file at
 * `/emoji/apple/<name>.png`.
 */
const APPLE_EMOJI_NAMES: ReadonlySet<string> = new Set([
  '1f31f',
  '1f37e',
  '1f37f',
  '1f399',
  '1f399-fe0f',
  '1f3a4',
  '1f3a7',
  '1f3ac',
  '1f3ae',
  '1f3af',
  '1f3c6',
  '1f3ce-fe0f',
  '1f3e6',
  '1f3f7-fe0f',
  '1f440',
  '1f446',
  '1f447',
  '1f448',
  '1f449',
  '1f44a',
  '1f44b',
  '1f44d',
  '1f44e',
  '1f44f',
  '1f451',
  '1f47b',
  '1f480',
  '1f48e',
  '1f493',
  '1f494',
  '1f496',
  '1f497',
  '1f498',
  '1f499',
  '1f49a',
  '1f49b',
  '1f49c',
  '1f49e',
  '1f4a1',
  '1f4a2',
  '1f4a3',
  '1f4a4',
  '1f4a5',
  '1f4a9',
  '1f4aa',
  '1f4ab',
  '1f4ac',
  '1f4ad',
  '1f4af',
  '1f4b0',
  '1f4b3',
  '1f4b5',
  '1f4b8',
  '1f4bb',
  '1f4c8',
  '1f4c9',
  '1f4ca',
  '1f4cc',
  '1f4e2',
  '1f4e3',
  '1f4f1',
  '1f4f7',
  '1f511',
  '1f512',
  '1f513',
  '1f514',
  '1f517',
  '1f525',
  '1f534',
  '1f535',
  '1f579-fe0f',
  '1f5a4',
  '1f5a5-fe0f',
  '1f5ff',
  '1f5ff-fe0e',
  '1f600',
  '1f602',
  '1f607',
  '1f609',
  '1f60a',
  '1f60b',
  '1f60d',
  '1f60e',
  '1f60f',
  '1f618',
  '1f61c',
  '1f621',
  '1f624',
  '1f62d',
  '1f631',
  '1f633',
  '1f642',
  '1f643',
  '1f644',
  '1f64c',
  '1f64f',
  '1f680',
  '1f697',
  '1f6a8',
  '1f6d1',
  '1f7e1',
  '1f7e2',
  '1f90d',
  '1f911',
  '1f913',
  '1f916',
  '1f917',
  '1f918',
  '1f919',
  '1f91b',
  '1f91c',
  '1f91d',
  '1f91e',
  '1f91f',
  '1f921',
  '1f923',
  '1f925',
  '1f928',
  '1f929',
  '1f92a',
  '1f92b',
  '1f92c',
  '1f92f',
  '1f94a',
  '1f970',
  '1f971',
  '1f973',
  '1f975',
  '1f976',
  '1f979',
  '1f97a',
  '1f9d0',
  '1f9e0',
  '1f9e1',
  '1f9e2',
  '1f9e3',
  '1f9e9',
  '1f9f2',
  '1fa99',
  '1fae1',
  '1fae3',
  '1faf0',
  '1faf6',
  '203c-fe0f',
  '2049-fe0f',
  '231b',
  '23f3',
  '2615',
  '261d-fe0f',
  '26a0-fe0f',
  '26a1',
  '26d4',
  '2705',
  '270c-fe0f',
  '270d-fe0f',
  '2728',
  '274c',
  '2753',
  '2757',
  '2764-fe0f',
  '2b1b',
  '2b1c',
  '2b50',
]);

/** Lowercase hex codepoints of an emoji, joined by `-`. */
function codepointName(emoji: string): string {
  return Array.from(emoji)
    .map((character) => character.codePointAt(0)?.toString(16) ?? '')
    .filter(Boolean)
    .join('-');
}

/**
 * Resolve an emoji to the bundled Apple PNG asset, or `null` when the glyph is
 * not part of the bundled set (in which case the caller should render text).
 */
export function appleEmojiUrl(emoji: string): string | null {
  const full = codepointName(emoji);
  if (!full) return null;

  const withoutVariationSelector = full
    .split('-')
    .filter((codepoint) => codepoint !== 'fe0f')
    .join('-');

  const candidates =
    withoutVariationSelector === full
      ? [full]
      : [full, withoutVariationSelector];

  for (const name of candidates) {
    if (APPLE_EMOJI_NAMES.has(name)) {
      return `/emoji/apple/${name}.png`;
    }
  }
  return null;
}

// `Intl.Segmenter` is not in this project's ES2022 TS lib, so describe the
// small surface we use instead of reaching for `any`.
interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}
type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => GraphemeSegmenter;

function getSegmenterConstructor(): SegmenterConstructor | null {
  const ctor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  return typeof ctor === 'function' ? ctor : null;
}

function segmentGraphemes(text: string): string[] {
  const Segmenter = getSegmenterConstructor();
  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    const graphemes: string[] = [];
    for (const part of segmenter.segment(text)) {
      graphemes.push(part.segment);
    }
    return graphemes;
  }
  return Array.from(text);
}

interface AppleEmojiTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Text renderer that swaps every supported emoji glyph for its Apple PNG so
 * the editor preview never falls back to the platform (Segoe) emoji font.
 */
export function AppleEmojiText({ text, className, style }: AppleEmojiTextProps) {
  const graphemes = useMemo(() => segmentGraphemes(text), [text]);

  return (
    <span
      className={`whitespace-pre-wrap${className ? ` ${className}` : ''}`}
      style={style}
    >
      {graphemes.map((grapheme, index) => {
        const url = appleEmojiUrl(grapheme);
        if (url) {
          return (
            <img
              key={index}
              src={url}
              alt={grapheme}
              draggable={false}
              className="inline-block align-[-0.15em]"
              style={{
                width: '1.15em',
                height: '1.15em',
                objectFit: 'contain',
                verticalAlign: '-0.18em',
              }}
            />
          );
        }
        return <React.Fragment key={index}>{grapheme}</React.Fragment>;
      })}
    </span>
  );
}
