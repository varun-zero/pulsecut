import type { LiveMonitorPlatform, LiveMonitorStatus, MonitorRatePoint } from '../types';

export interface ParsedStreamTarget {
  platform: LiveMonitorPlatform;
  channel: string;
  normalizedUrl: string;
  key: string;
}

export interface InvalidStreamLine {
  raw: string;
  reason: string;
}

export interface ParseStreamUrlsResult {
  valid: ParsedStreamTarget[];
  invalid: InvalidStreamLine[];
  duplicatesRemoved: number;
}

const RESERVED_HANDLES = new Set([
  'browse',
  'categories',
  'directory',
  'following',
  'live',
  'watch',
  'shorts',
  'videos',
  'clip',
  'clips',
  'search',
  'settings',
  'downloads',
]);

function extractYouTubeVideoId(url: string): string {
  const vMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{6,20})/);
  if (vMatch) return vMatch[1];
  const pathMatch = url.match(/(?:\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{6,20})/i);
  if (pathMatch) return pathMatch[1];
  return '';
}

export function parseSingleStreamUrl(raw: string): ParsedStreamTarget | { error: string } {
  const trimmed = raw.trim().replace(/^[,;\s]+|[,;\s]+$/g, '');
  if (!trimmed) {
    return { error: 'Empty stream link' };
  }

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const lower = withScheme.toLowerCase();

  const kickIdx = lower.indexOf('kick.com/');
  if (kickIdx !== -1) {
    const rest = withScheme.slice(kickIdx + 'kick.com/'.length);
    const slug = (rest.split(/[/?#]/)[0] || '').replace(/^@/, '').toLowerCase();
    if (!slug || RESERVED_HANDLES.has(slug)) {
      return { error: `Invalid Kick channel handle in "${trimmed}"` };
    }
    return {
      platform: 'kick',
      channel: slug,
      normalizedUrl: `https://kick.com/${slug}`,
      key: `kick:${slug}`,
    };
  }

  const twitchIdx = lower.indexOf('twitch.tv/');
  if (twitchIdx !== -1) {
    const rest = withScheme.slice(twitchIdx + 'twitch.tv/'.length);
    const slug = (rest.split(/[/?#]/)[0] || '').replace(/^@/, '').toLowerCase();
    if (!slug || RESERVED_HANDLES.has(slug)) {
      return { error: `Invalid Twitch channel handle in "${trimmed}"` };
    }
    return {
      platform: 'twitch',
      channel: slug,
      normalizedUrl: `https://www.twitch.tv/${slug}`,
      key: `twitch:${slug}`,
    };
  }

  if (lower.includes('youtube.com/') || lower.includes('youtu.be/')) {
    const videoId = extractYouTubeVideoId(withScheme);
    if (!videoId) {
      return {
        error: `Use a YouTube Live broadcast URL (youtube.com/live/<id> or watch?v=<id>) for "${trimmed}"`,
      };
    }
    return {
      platform: 'youtube',
      channel: videoId,
      normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
      key: `youtube:${videoId.toLowerCase()}`,
    };
  }

  return {
    error: `Unsupported live platform "${trimmed}" — paste Kick, YouTube Live, or Twitch links`,
  };
}

/**
 * Parses one or multiple stream URLs (newline, comma, or whitespace separated),
 * deduplicates identical channels, and surfaces any invalid entries cleanly.
 */
export function parseStreamUrlsInput(rawText: string): ParseStreamUrlsResult {
  const tokens = rawText
    .split(/[\r\n,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const valid: ParsedStreamTarget[] = [];
  const invalid: InvalidStreamLine[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;

  for (const token of tokens) {
    const parsed = parseSingleStreamUrl(token);
    if ('error' in parsed) {
      invalid.push({ raw: token, reason: parsed.error });
      continue;
    }
    if (seen.has(parsed.key)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(parsed.key);
    valid.push(parsed);
  }

  return { valid, invalid, duplicatesRemoved };
}

export interface SpikeGraphMarker {
  x: number;
  y: number;
  rate: number;
  hypeScore: number;
  tsMs: number;
}

export interface SpikeGraphGeometry {
  hasData: boolean;
  yMax: number;
  peakRate: number;
  ratePoints: string;
  areaPath: string;
  baselinePoints: string;
  markers: SpikeGraphMarker[];
  yTicks: { value: number; y: number; label: string }[];
}

export function buildSpikeGraphGeometry(
  history: readonly MonitorRatePoint[],
  width: number,
  height: number,
  padding = { top: 10, right: 10, bottom: 18, left: 32 }
): SpikeGraphGeometry {
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);

  if (!history || history.length < 2) {
    return {
      hasData: false,
      yMax: 4,
      peakRate: 0,
      ratePoints: '',
      areaPath: '',
      baselinePoints: '',
      markers: [],
      yTicks: [
        { value: 0, y: height - padding.bottom, label: '0' },
        { value: 2, y: padding.top + innerH / 2, label: '2' },
        { value: 4, y: padding.top, label: '4' },
      ],
    };
  }

  let peakRate = 0;
  let maxVal = 2;
  for (const pt of history) {
    const r = Math.max(0, Number(pt.rate) || 0);
    const b = Math.max(0, Number(pt.baseline) || 0);
    if (r > peakRate) peakRate = r;
    if (r > maxVal) maxVal = r;
    if (b > maxVal) maxVal = b;
  }
  const rawMax = Math.max(2, maxVal * 1.2);
  const yMax = rawMax >= 10 ? Math.ceil(rawMax / 2) * 2 : Math.ceil(rawMax * 2) / 2;

  const sx = (idx: number) =>
    padding.left + (idx / Math.max(1, history.length - 1)) * innerW;
  const sy = (val: number) =>
    padding.top + innerH - (Math.max(0, Math.min(yMax, val)) / yMax) * innerH;

  const rateCoords: [number, number][] = [];
  const baseCoords: [number, number][] = [];
  const markers: SpikeGraphMarker[] = [];

  for (let i = 0; i < history.length; i += 1) {
    const pt = history[i];
    const x = sx(i);
    const ry = sy(Number(pt.rate) || 0);
    const by = sy(Number(pt.baseline) || 0);
    rateCoords.push([x, ry]);
    baseCoords.push([x, by]);
    if (pt.triggered) {
      markers.push({
        x: Number(x.toFixed(1)),
        y: Number(ry.toFixed(1)),
        rate: Number(pt.rate) || 0,
        hypeScore: Number(pt.hype_score) || 0,
        tsMs: pt.ts_ms,
      });
    }
  }

  const ratePoints = rateCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const baselinePoints = baseCoords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const bottomY = padding.top + innerH;
  const firstX = rateCoords[0][0].toFixed(1);
  const lastX = rateCoords[rateCoords.length - 1][0].toFixed(1);
  const lineSegments = rateCoords.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `M ${firstX} ${bottomY.toFixed(1)} ${lineSegments} L ${lastX} ${bottomY.toFixed(1)} Z`;

  const mid = Number((yMax / 2).toFixed(1));
  const yTicks = [
    { value: 0, y: bottomY, label: '0' },
    { value: mid, y: sy(mid), label: mid >= 10 ? String(Math.round(mid)) : String(mid) },
    { value: yMax, y: sy(yMax), label: yMax >= 10 ? String(Math.round(yMax)) : String(yMax) },
  ];

  return {
    hasData: true,
    yMax,
    peakRate: Number(peakRate.toFixed(2)),
    ratePoints,
    areaPath,
    baselinePoints,
    markers,
    yTicks,
  };
}

export function formatCompactCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function formatMonitorStatusLabel(
  status: LiveMonitorStatus,
  calibrationPct?: number
): string {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'calibrating':
      return `Calibrating ${Math.min(100, Math.max(0, Math.round(calibrationPct || 0)))}%`;
    case 'watching':
      return 'Watching Live';
    case 'spike':
      return 'Hype Spike';
    case 'paused':
      return 'Paused';
    case 'error':
      return 'Connection Issue';
    default:
      return 'Watching';
  }
}

export function getPlatformMeta(platform: LiveMonitorPlatform): {
  label: string;
  accent: string;
} {
  switch (platform) {
    case 'kick':
      return { label: 'Kick', accent: '#53FC18' };
    case 'youtube':
      return { label: 'YouTube Live', accent: '#FF2D55' };
    case 'twitch':
      return { label: 'Twitch', accent: '#A970FF' };
  }
}
