import type { ClipItem, JobItem } from '../types';
import { detectVideoSource } from './studioLogic';

export async function tryServerApi<T>(
  path: string,
  options?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(path, options);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function requestServerApi<T>(
  path: string,
  options?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetch(path, options);
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await res.json().catch(() => ({})) : {};
    if (!res.ok) {
      const msg =
        (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Server returned HTTP ${res.status}`) || 'Request failed';
      return { ok: false, error: msg, status: res.status };
    }
    if (!isJson) {
      return {
        ok: false,
        error: 'PulseCut backend API is not reachable on this origin.',
        status: res.status,
      };
    }
    return { ok: true, data: body as T };
  } catch {
    return {
      ok: false,
      error: 'PulseCut backend server is offline. Start it with `cargo run --bin pulsecut -- editor --addr 127.0.0.1:8756`.',
      status: 0,
    };
  }
}

export function normalizeServerClip(c: Partial<ClipItem> & Record<string, unknown>, idx: number): ClipItem {
  const id = typeof c.id === 'string' && c.id ? c.id : `clip-${idx}`;
  const rawPlatform = typeof c.platform === 'string' ? c.platform : '';
  const platform: ClipItem['platform'] =
    rawPlatform === 'Kick' || rawPlatform.toLowerCase() === 'kick'
      ? 'Kick'
      : rawPlatform === 'Twitch' || rawPlatform.toLowerCase() === 'twitch'
        ? 'Twitch'
        : rawPlatform === 'Instagram' || rawPlatform.toLowerCase() === 'instagram'
          ? 'Instagram'
          : rawPlatform === 'Local' || rawPlatform.toLowerCase() === 'local'
            ? 'Local'
            : 'YouTube';

  const sourceWin = c.source_window as { start_ms?: number; end_ms?: number } | undefined;
  const computedDuration =
    typeof c.duration_sec === 'number' && c.duration_sec > 0
      ? c.duration_sec
      : sourceWin && typeof sourceWin.end_ms === 'number' && typeof sourceWin.start_ms === 'number'
        ? Math.max(1, Math.round((sourceWin.end_ms - sourceWin.start_ms) / 1000))
        : 30;

  return {
    id,
    title: typeof c.title === 'string' && c.title ? c.title : 'Untitled Clip',
    template: typeof c.template === 'string' && c.template ? c.template : 'default',
    status: (c.status as ClipItem['status']) || 'Ready',
    confidence: typeof c.confidence === 'number' ? c.confidence : 0.85,
    channel: typeof c.channel === 'string' && c.channel ? c.channel : platform,
    streamerHandle:
      typeof c.streamerHandle === 'string' && c.streamerHandle
        ? c.streamerHandle
        : typeof c.channel === 'string' && c.channel
          ? c.channel
          : undefined,
    platform,
    duration_sec: computedDuration,
    description: typeof c.description === 'string' ? c.description : '',
    transcript_snippet: typeof c.transcript_snippet === 'string' ? c.transcript_snippet : '',
    hashtags: Array.isArray(c.hashtags) ? c.hashtags.filter((h): h is string => typeof h === 'string') : [],
    created_at_ms: typeof c.created_at_ms === 'number' ? c.created_at_ms : Date.now(),
    aspect: (c.aspect as ClipItem['aspect']) || '9:16',
    layout: (c.layout as ClipItem['layout']) || 'solo',
    caption_style: (c.caption_style as ClipItem['caption_style']) || 'hormozi-classic',
    canvas: (c.canvas as ClipItem['canvas']) || 'solid',
    font: typeof c.font === 'string' ? c.font : 'TikTok Sans',
    subtitleFont: typeof c.subtitleFont === 'string' ? c.subtitleFont : 'Montserrat',
    mediaUrl: typeof c.mediaUrl === 'string' && c.mediaUrl ? c.mediaUrl : `/api/clips/${id}/media`,
    // Full pre-crop source for the Framing Studio. For locally imported blobs
    // there is no separate raw source, so fall back to the media URL.
    rawMediaUrl: typeof c.rawMediaUrl === 'string' && c.rawMediaUrl
      ? c.rawMediaUrl
      : typeof c.mediaUrl === 'string' && c.mediaUrl.startsWith('blob:')
        ? c.mediaUrl
        : `/api/clips/${id}/raw-media`,
    words: Array.isArray(c.words) ? c.words : [],
  };
}

export function normalizeServerJob(j: Partial<JobItem> & Record<string, unknown>, idx: number): JobItem {
  const url = typeof j.url === 'string' ? j.url : '';
  const detected = url ? detectVideoSource(url) : null;
  const rawStatus = typeof j.status === 'string' ? j.status.toLowerCase() : 'queued';
  const status: JobItem['status'] =
    rawStatus === 'done' || rawStatus === 'completed'
      ? 'done'
      : rawStatus === 'error' || rawStatus === 'failed'
        ? 'error'
        : rawStatus === 'downloading'
          ? 'downloading'
          : rawStatus === 'clipping'
            ? 'clipping'
            : rawStatus === 'rendering'
              ? 'rendering'
              : 'queued';

  return {
    id: typeof j.id === 'string' && j.id ? j.id : `job-${idx}`,
    url,
    sourceTitle:
      typeof j.sourceTitle === 'string' && j.sourceTitle
        ? j.sourceTitle
        : detected?.estimatedTitle || url || 'Ingest Job',
    streamerHandle:
      typeof j.streamerHandle === 'string' ? j.streamerHandle : detected?.streamerHandle,
    platform:
      (j.platform as JobItem['platform']) || detected?.platform || 'YouTube',
    template: typeof j.template === 'string' && j.template ? j.template : detected?.suggestedTemplateId || 'yt-short',
    maxClips: typeof j.maxClips === 'number' ? j.maxClips : 6,
    burnCaptions: typeof j.burnCaptions === 'boolean' ? j.burnCaptions : true,
    status,
    progress: typeof j.progress === 'number' ? j.progress : status === 'done' ? 100 : 0,
    message: typeof j.message === 'string' && j.message ? j.message : 'Processing...',
    clip_ids: Array.isArray(j.clip_ids) ? j.clip_ids.filter((id): id is string => typeof id === 'string') : [],
    created_at_ms: typeof j.created_at_ms === 'number' ? j.created_at_ms : Date.now(),
  };
}

/**
 * Fetches live workspace clips & jobs from the PulseCut Rust server.
 * Never fabricates demo clips or stock images when the backend is offline or empty.
 */
export async function fetchWorkspaceData(): Promise<{
  clips: ClipItem[];
  jobs: JobItem[];
  connectedToBackend: boolean;
}> {
  const [clipsRes, jobsRes] = await Promise.all([
    tryServerApi<{ backend_offline?: boolean; clips?: Array<Partial<ClipItem> & Record<string, unknown>> }>('/api/clips'),
    tryServerApi<{ backend_offline?: boolean; jobs?: Array<Partial<JobItem> & Record<string, unknown>> }>('/api/jobs'),
  ]);

  if ((!clipsRes && !jobsRes) || clipsRes?.backend_offline || jobsRes?.backend_offline) {
    return {
      clips: [],
      jobs: [],
      connectedToBackend: false,
    };
  }

  return {
    clips: (clipsRes?.clips ?? []).map(normalizeServerClip),
    jobs: (jobsRes?.jobs ?? []).map(normalizeServerJob),
    connectedToBackend: true,
  };
}

export async function fetchLiveMonitors(): Promise<{
  monitors: import('../types').LiveStreamMonitor[];
  config: import('../types').LiveMonitorConfig | null;
  connectedToBackend: boolean;
}> {
  const res = await tryServerApi<import('../types').LiveMonitorsResponse>('/api/monitors');
  if (!res || res.backend_offline) {
    return {
      monitors: [],
      config: null,
      connectedToBackend: false,
    };
  }
  return {
    monitors: Array.isArray(res.monitors) ? res.monitors : [],
    config: res.config ?? null,
    connectedToBackend: true,
  };
}
