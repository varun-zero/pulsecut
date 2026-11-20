import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  KeyRound,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Users,
  Zap,
} from 'lucide-react';
import type { LiveMonitorConfig, LiveStreamMonitor } from '../types';
import type { EditableTemplatePreset } from '../lib/creatorCatalog';
import { FEATURED_PRESETS } from '../presets';
import {
  formatCompactCount,
  formatMonitorStatusLabel,
  getPlatformMeta,
  parseStreamUrlsInput,
} from '../lib/liveMonitor';
import { LiveSpikeGraph } from '../components/LiveSpikeGraph';
import { Button, StudioSwitch } from '../components/ui/Primitives';
import { KickLogoIcon, YouTubeShortsIcon } from '../components/ui/PlatformIcons';

interface LiveStreamsPageProps {
  monitors: LiveStreamMonitor[];
  monitorConfig: LiveMonitorConfig | null;
  connectedToBackend: boolean;
  templates?: readonly EditableTemplatePreset[];
  onStartMonitors: (payload: {
    urls: string[];
    template: string;
    lookback_secs: number;
    cooldown_secs: number;
    threshold: number;
    auto_clip: boolean;
  }) => Promise<boolean>;
  onSaveMonitorConfig: (payload: {
    kick_pusher_key?: string;
    kick_pusher_cluster?: string;
    kick_bridge_url?: string;
    youtube_api_key?: string;
  }) => Promise<{ ok: boolean; bridgeSynced?: boolean; error?: string }>;
  onPauseMonitor: (id: string, paused: boolean) => Promise<void>;
  onToggleAutoClip: (id: string, enabled: boolean) => Promise<void>;
  onManualClipMonitor: (id: string, lookbackSecs?: number) => Promise<void>;
  onStopMonitor: (id: string) => Promise<void>;
  onRefreshMonitors: () => Promise<void>;
  onOpenClips: () => void;
}

export function LiveStreamsPage({
  monitors,
  monitorConfig,
  connectedToBackend,
  templates,
  onStartMonitors,
  onSaveMonitorConfig,
  onPauseMonitor,
  onToggleAutoClip,
  onManualClipMonitor,
  onStopMonitor,
  onRefreshMonitors,
  onOpenClips,
}: LiveStreamsPageProps) {
  const [urlsText, setUrlsText] = useState('');
  const [lookbackSecs, setLookbackSecs] = useState(30);
  const [threshold, setThreshold] = useState(55);
  const [cooldownSecs, setCooldownSecs] = useState(45);
  const [selectedTemplate, setSelectedTemplate] = useState('default');
  const [autoClip, setAutoClip] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Collapsible Kick Pusher Key & Bridge Config panel
  const [configOpen, setConfigOpen] = useState(false);
  const [kickPusherKey, setKickPusherKey] = useState('');
  const [kickCluster, setKickCluster] = useState(monitorConfig?.kick_pusher_cluster || 'us2');
  const [kickBridgeUrl, setKickBridgeUrl] = useState(
    monitorConfig?.kick_bridge_url || 'http://127.0.0.1:8765'
  );
  const [youtubeApiKey, setYoutubeApiKey] = useState('');
  const configSyncedRef = useRef(false);

  useEffect(() => {
    if (!monitorConfig || configSyncedRef.current) return;
    if (monitorConfig.kick_pusher_cluster) setKickCluster(monitorConfig.kick_pusher_cluster);
    if (monitorConfig.kick_bridge_url) setKickBridgeUrl(monitorConfig.kick_bridge_url);
    configSyncedRef.current = true;
  }, [monitorConfig]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [busyMonitorId, setBusyMonitorId] = useState<string | null>(null);

  const parsedInput = useMemo(() => parseStreamUrlsInput(urlsText), [urlsText]);

  const templateOptions = useMemo(() => {
    if (templates && templates.length > 0) return templates;
    return FEATURED_PRESETS;
  }, [templates]);

  const totalClipsFired = useMemo(
    () => monitors.reduce((acc, m) => acc + (m.clips_triggered || 0), 0),
    [monitors]
  );

  const hasKickError = useMemo(
    () =>
      monitors.some(
        (m) =>
          m.platform === 'kick' &&
          m.status === 'error' &&
          /pusher|bridge|key/i.test(m.status_detail || '')
      ),
    [monitors]
  );

  const handlePasteUrls = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setUrlsText((prev) => (prev.trim() ? `${prev.trim()}\n${text.trim()}` : text.trim()));
        setFormError(null);
      }
    } catch {
      // Clipboard may be blocked in sandboxed browser contexts
    }
  };

  const handleSubmitStreams = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedInput.valid.length === 0) {
      setFormError(
        parsedInput.invalid[0]?.reason ||
          'Paste one or more Kick, YouTube Live, or Twitch stream URLs (one per line).'
      );
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const ok = await onStartMonitors({
        urls: parsedInput.valid.map((v) => v.normalizedUrl),
        template: selectedTemplate,
        lookback_secs: lookbackSecs,
        cooldown_secs: cooldownSecs,
        threshold,
        auto_clip: autoClip,
      });
      if (ok) {
        setUrlsText('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setConfigMessage(null);
    try {
      const res = await onSaveMonitorConfig({
        kick_pusher_key: kickPusherKey.trim() || undefined,
        kick_pusher_cluster: kickCluster.trim() || 'us2',
        kick_bridge_url: kickBridgeUrl.trim() || 'http://127.0.0.1:8765',
        youtube_api_key: youtubeApiKey.trim() || undefined,
      });
      if (res.ok) {
        setKickPusherKey('');
        setYoutubeApiKey('');
        setConfigMessage({
          kind: 'ok',
          text: res.bridgeSynced
            ? 'Saved and hot-synced to running Kick chat bridge.'
            : 'Saved on PulseCut server (start Kick bridge to apply live).',
        });
      } else {
        setConfigMessage({
          kind: 'err',
          text: res.error || 'Could not update monitor configuration.',
        });
      }
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <main className="max-w-[1380px] mx-auto px-6 py-7 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[740px]">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--pc-ink)] m-0">
            Live Streams Monitor
          </h1>
          <p className="text-[13px] text-[var(--pc-sub)] m-0 mt-1">
            Connect directly to multiple Kick, YouTube Live, and Twitch chat feeds headlessly — learn true channel baselines, inspect live spike graphs, and auto-clip hype surges without open browser tabs.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono-tabular shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
              connectedToBackend
                ? 'border-[var(--pc-ok)]/35 bg-[var(--pc-ok)]/10 text-[var(--pc-ok)]'
                : 'border-[var(--pc-border)] bg-[var(--pc-surface)] text-[var(--pc-muted)]'
            }`}
          >
            <Radio className="w-3.5 h-3.5 stroke-[1.75]" />
            <span>{connectedToBackend ? 'Engine Connected' : 'Backend Offline'}</span>
          </span>
          <span className="text-[var(--pc-sub)]">
            {monitors.length} stream{monitors.length === 1 ? '' : 's'} · {totalClipsFired} clips
          </span>
          <button
            type="button"
            onClick={() => void onRefreshMonitors()}
            aria-label="Refresh live stream monitors"
            title="Refresh live stream monitors"
            className="h-8 w-8 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)] grid place-items-center cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 stroke-[1.75]" />
          </button>
        </div>
      </div>

      {/* Offline Actionable Banner (only when Rust backend is not reachable) */}
      {!connectedToBackend && (
        <div
          role="status"
          className="rounded-xl border border-[var(--pc-border)] bg-[var(--pc-surface)] px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0">
            <AlertCircle className="w-4 h-4 text-[var(--pc-accent)] shrink-0 mt-0.5 stroke-[1.75]" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[var(--pc-ink)]">
                Local PulseCut engine is offline
              </div>
              <p className="text-xs text-[var(--pc-sub)] m-0 mt-1">
                Start the Rust backend (<code className="font-mono-tabular text-[var(--pc-ink)]">cargo run --bin pulsecut -- editor --addr 127.0.0.1:8756</code>) and for Kick streams start the multi-channel bridge (<code className="font-mono-tabular text-[var(--pc-ink)]">python tools/kick-chat-bridge/bridge.py --port 8765</code>). YouTube Live &amp; Twitch connect directly with zero API keys.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <Button type="button" variant="secondary" onClick={() => void onRefreshMonitors()}>
              <RefreshCw className="w-3.5 h-3.5 stroke-[1.75]" />
              <span>Retry Connection</span>
            </Button>
          </div>
        </div>
      )}

      {/* Add Multiple Streams + Direct Settings Panel */}
      <section
        aria-labelledby="add-streams-heading"
        className="rounded-xl bg-[var(--pc-surface)] border border-[var(--pc-border)] overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-[var(--pc-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-[var(--pc-accent)] stroke-[2]" />
            <h2 id="add-streams-heading" className="text-[15px] font-semibold text-[var(--pc-ink)] m-0">
              Watch Multiple Live Streams
            </h2>
          </div>

          <button
            type="button"
            aria-expanded={configOpen}
            onClick={() => setConfigOpen((v) => !v)}
            className={`h-8 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
              hasKickError
                ? 'border-[var(--pc-error)]/50 bg-[var(--pc-error)]/10 text-[var(--pc-error)]'
                : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 stroke-[1.75]" />
            <span>
              Kick Pusher Key &amp; Bridge
              {monitorConfig?.kick_pusher_key_set ? ' (Configured)' : ''}
            </span>
            {configOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Collapsible Kick Pusher Key & Direct Connection Drawer */}
        {configOpen && (
          <form
            onSubmit={handleSaveConfig}
            className="px-6 py-4 border-b border-[var(--pc-border)] bg-[var(--pc-surface-2)]/55 space-y-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-xs text-[var(--pc-sub)] m-0 max-w-[820px]">
                Kick rotates its Pusher WebSocket key periodically. If Kick auto-discovery fails, open any Kick channel once in DevTools Network (<code className="font-mono-tabular text-[var(--pc-ink)]">wss://ws-us2.pusher.com/app/&lt;key&gt;</code>) and paste the key below — or set <code className="font-mono-tabular text-[var(--pc-ink)]">KICK_PUSHER_KEY</code> in your environment. YouTube Live works without any API key.
              </p>
              {monitorConfig?.kick_pusher_key_set && (
                <span className="text-[11px] font-mono-tabular text-[var(--pc-ok)]">
                  Active key: {monitorConfig.kick_pusher_key_preview}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="kick-pusher-key-input"
                  className="block text-[11px] font-medium text-[var(--pc-sub)] mb-1"
                >
                  Kick Pusher Key (KICK_PUSHER_KEY)
                </label>
                <input
                  id="kick-pusher-key-input"
                  type="text"
                  value={kickPusherKey}
                  onChange={(e) => setKickPusherKey(e.target.value)}
                  placeholder={
                    monitorConfig?.kick_pusher_key_set
                      ? 'Leave blank to keep current key'
                      : 'e.g. 32cbd69e4b950bf97679'
                  }
                  className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none focus:border-[var(--pc-accent)]"
                />
              </div>

              <div>
                <label
                  htmlFor="kick-cluster-select"
                  className="block text-[11px] font-medium text-[var(--pc-sub)] mb-1"
                >
                  Pusher Cluster
                </label>
                <select
                  id="kick-cluster-select"
                  value={kickCluster}
                  onChange={(e) => setKickCluster(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                >
                  <option value="us2">us2 (ws-us2.pusher.com)</option>
                  <option value="us3">us3 (ws-us3.pusher.com)</option>
                  <option value="eu">eu (ws-eu.pusher.com)</option>
                  <option value="ap1">ap1 (ws-ap1.pusher.com)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="kick-bridge-url-input"
                  className="block text-[11px] font-medium text-[var(--pc-sub)] mb-1"
                >
                  Local Kick Bridge URL
                </label>
                <input
                  id="kick-bridge-url-input"
                  type="url"
                  value={kickBridgeUrl}
                  onChange={(e) => setKickBridgeUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8765"
                  className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
                />
              </div>

              <div>
                <label
                  htmlFor="yt-api-key-input"
                  className="block text-[11px] font-medium text-[var(--pc-sub)] mb-1"
                >
                  YouTube API Key (Optional fallback)
                </label>
                <input
                  id="yt-api-key-input"
                  type="password"
                  value={youtubeApiKey}
                  onChange={(e) => setYoutubeApiKey(e.target.value)}
                  placeholder="Not required (uses Innertube)"
                  className="w-full h-9 px-3 rounded-lg bg-[var(--pc-surface)] border border-[var(--pc-border)] text-xs font-mono-tabular text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none focus:border-[var(--pc-accent)]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-xs">
                {configMessage && (
                  <span
                    className={
                      configMessage.kind === 'ok' ? 'text-[var(--pc-ok)]' : 'text-[var(--pc-error)]'
                    }
                  >
                    {configMessage.text}
                  </span>
                )}
              </div>
              <Button type="submit" variant="secondary" disabled={savingConfig}>
                <span>{savingConfig ? 'Syncing…' : 'Save & Sync Bridge'}</span>
              </Button>
            </div>
          </form>
        )}

        <form onSubmit={handleSubmitStreams} noValidate className="p-6 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="multi-stream-urls-input"
                className="text-xs font-medium text-[var(--pc-sub)]"
              >
                Direct Stream Links (paste 1 or multiple URLs — one per line)
              </label>
              <button
                type="button"
                onClick={handlePasteUrls}
                className="h-7 px-2.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-[11.5px] font-medium text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <ClipboardPaste className="w-3 h-3 stroke-[1.75]" />
                <span>Paste Links</span>
              </button>
            </div>

            <textarea
              id="multi-stream-urls-input"
              rows={3}
              value={urlsText}
              onChange={(e) => {
                setUrlsText(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder={
                'https://kick.com/eray\nhttps://www.youtube.com/live/YNp4gpjgNH4\nhttps://twitch.tv/shroud'
              }
              className={`w-full p-3.5 rounded-lg bg-[var(--pc-surface-2)] border text-[13px] font-mono-tabular text-[var(--pc-ink)] placeholder:text-[var(--pc-muted)] outline-none resize-y transition-colors ${
                formError
                  ? 'border-[var(--pc-error)]'
                  : 'border-[var(--pc-border)] focus:border-[var(--pc-accent)]'
              }`}
            />

            {/* Instant Multi-URL Parsed Detection Chips */}
            {(parsedInput.valid.length > 0 || parsedInput.invalid.length > 0) && (
              <div
                data-testid="parsed-streams-preview"
                className="flex flex-wrap items-center gap-2 pt-1"
              >
                {parsedInput.valid.map((item) => {
                  const meta = getPlatformMeta(item.platform);
                  return (
                    <span
                      key={item.key}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[11.5px] font-mono-tabular text-[var(--pc-ink)]"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: meta.accent }}
                      />
                      <span style={{ color: meta.accent }} className="font-semibold">
                        {meta.label}
                      </span>
                      <span>{item.channel}</span>
                    </span>
                  );
                })}
                {parsedInput.duplicatesRemoved > 0 && (
                  <span className="text-[11px] font-mono-tabular text-[var(--pc-muted)]">
                    · {parsedInput.duplicatesRemoved} duplicate skipped
                  </span>
                )}
                {parsedInput.invalid.length > 0 && (
                  <span className="text-[11px] text-[var(--pc-error)]">
                    · {parsedInput.invalid.length} unrecognized link
                    {parsedInput.invalid.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            )}
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-center gap-2 text-xs text-[var(--pc-error)] bg-[var(--pc-error)]/10 border border-[var(--pc-error)]/30 rounded-lg px-3 py-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 stroke-[1.75]" />
              <span>{formError}</span>
            </div>
          )}

          {/* Detection & Clipping Settings Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-3 border-t border-[var(--pc-border-subtle)] items-center">
            <div>
              <div className="flex items-center justify-between text-[11.5px] mb-1">
                <label htmlFor="monitor-lookback" className="text-[var(--pc-sub)] font-medium">
                  Lookback
                </label>
                <span className="font-mono-tabular text-[var(--pc-ink)]">{lookbackSecs}s</span>
              </div>
              <input
                id="monitor-lookback"
                type="range"
                min={15}
                max={90}
                step={5}
                value={lookbackSecs}
                onChange={(e) => setLookbackSecs(Number(e.target.value))}
                className="w-full accent-[var(--pc-accent)] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11.5px] mb-1">
                <label htmlFor="monitor-threshold" className="text-[var(--pc-sub)] font-medium">
                  Hype Threshold
                </label>
                <span className="font-mono-tabular text-[var(--pc-ink)]">{threshold}%</span>
              </div>
              <input
                id="monitor-threshold"
                type="range"
                min={30}
                max={85}
                step={5}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full accent-[var(--pc-accent)] cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11.5px] mb-1">
                <label htmlFor="monitor-cooldown" className="text-[var(--pc-sub)] font-medium">
                  Cooldown
                </label>
                <span className="font-mono-tabular text-[var(--pc-ink)]">{cooldownSecs}s</span>
              </div>
              <input
                id="monitor-cooldown"
                type="range"
                min={15}
                max={120}
                step={5}
                value={cooldownSecs}
                onChange={(e) => setCooldownSecs(Number(e.target.value))}
                className="w-full accent-[var(--pc-accent)] cursor-pointer"
              />
            </div>

            <div>
              <label
                htmlFor="monitor-template"
                className="block text-[11.5px] font-medium text-[var(--pc-sub)] mb-1"
              >
                Short Template
              </label>
              <select
                id="monitor-template"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full h-8 px-2.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-ink)] outline-none focus:border-[var(--pc-accent)]"
              >
                {templateOptions.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-1">
              <StudioSwitch
                id="monitor-autoclip-switch"
                label="Auto-Clip Spikes"
                description="Trigger lookback automatically"
                checked={autoClip}
                onChange={setAutoClip}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <span className="text-xs text-[var(--pc-muted)]">
              Tip: Use Direct-Link here for automated multi-stream monitoring &amp; real spike graphs; keep the browser extension in Manual Clip mode (<code className="font-mono-tabular text-[var(--pc-sub)]">Alt+Shift+C</code>) when watching in Chrome.
            </span>
            <Button type="submit" variant="primary" disabled={submitting}>
              <Activity className="w-3.5 h-3.5 stroke-[2]" />
              <span>
                {submitting
                  ? 'Starting…'
                  : parsedInput.valid.length > 1
                    ? `Start Monitoring (${parsedInput.valid.length} Streams)`
                    : 'Start Monitoring'}
              </span>
            </Button>
          </div>
        </form>
      </section>

      {/* Active Multi-Stream Live Cards Grid */}
      <section aria-labelledby="active-monitors-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-[var(--pc-sub)] stroke-[1.75]" />
            <h2
              id="active-monitors-heading"
              className="text-[15px] font-semibold text-[var(--pc-ink)] m-0"
            >
              Active Stream Monitors
            </h2>
            <span className="text-xs font-mono-tabular text-[var(--pc-muted)]">
              · {monitors.length} running
            </span>
          </div>
          {totalClipsFired > 0 && (
            <button
              type="button"
              onClick={onOpenClips}
              className="text-xs font-medium text-[var(--pc-ink)] hover:text-[var(--pc-accent)] inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer"
            >
              <span>Review {totalClipsFired} Triggered Clips</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {monitors.length === 0 ? (
          <div
            data-testid="empty-monitors-state"
            className="rounded-xl border border-dashed border-[var(--pc-border)] bg-[var(--pc-surface)] px-6 py-12 text-center"
          >
            <Activity className="w-6 h-6 mx-auto text-[var(--pc-muted)] mb-2.5 stroke-[1.5]" />
            <div className="text-[13.5px] font-medium text-[var(--pc-ink)]">
              No live streams monitored yet
            </div>
            <p className="text-xs text-[var(--pc-sub)] max-w-[540px] mx-auto mt-1.5 m-0">
              Paste one or multiple Kick, YouTube Live, or Twitch URLs above. Each stream gets its own adaptive viewer-aware baseline, live 120-second spike graph, and independent auto-clip cooldown.
            </p>
          </div>
        ) : (
          <div
            data-testid="active-monitors-grid"
            className="grid grid-cols-1 xl:grid-cols-2 gap-5"
          >
            {monitors.map((mon) => {
              const plat = getPlatformMeta(mon.platform);
              const isSpiking = mon.status === 'spike';
              const isError = mon.status === 'error';
              const isBusy = busyMonitorId === mon.id;
              const statusLabel = formatMonitorStatusLabel(mon.status, mon.calibration_pct);

              return (
                <article
                  key={mon.id}
                  data-testid={`monitor-card-${mon.channel}`}
                  className={`rounded-xl border bg-[var(--pc-surface)] overflow-hidden transition-colors flex flex-col ${
                    isSpiking
                      ? 'border-[#53FC18]/65'
                      : isError
                        ? 'border-[var(--pc-error)]/45'
                        : 'border-[var(--pc-border)]'
                  }`}
                >
                  {/* Card Header */}
                  <div className="px-4 py-3.5 border-b border-[var(--pc-border-subtle)] flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-8 h-8 rounded-lg border grid place-items-center shrink-0 bg-[var(--pc-surface-2)]"
                        style={{ borderColor: `${plat.accent}55`, color: plat.accent }}
                      >
                        {mon.platform === 'kick' ? (
                          <KickLogoIcon className="w-4 h-4" />
                        ) : mon.platform === 'youtube' ? (
                          <YouTubeShortsIcon className="w-4 h-4" />
                        ) : (
                          <Radio className="w-4 h-4 stroke-[1.75]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--pc-ink)] truncate">
                            {mon.channel}
                          </span>
                          <span
                            className="text-[10.5px] font-mono-tabular font-semibold uppercase"
                            style={{ color: plat.accent }}
                          >
                            {plat.label}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono-tabular text-[var(--pc-muted)] truncate">
                          {mon.url}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono-tabular font-medium border ${
                          isSpiking
                            ? 'bg-[#53FC18]/15 border-[#53FC18]/50 text-[#53FC18]'
                            : isError
                              ? 'bg-[var(--pc-error)]/10 border-[var(--pc-error)]/40 text-[var(--pc-error)]'
                              : mon.paused
                                ? 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-muted)]'
                                : 'bg-[var(--pc-surface-2)] border-[var(--pc-border)] text-[var(--pc-ink)]'
                        }`}
                      >
                        {isSpiking ? (
                          <Zap className="w-3 h-3" />
                        ) : isError ? (
                          <AlertCircle className="w-3 h-3" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3 text-[var(--pc-ok)]" />
                        )}
                        <span>{statusLabel}</span>
                      </span>
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-4 space-y-3.5 flex-1 flex flex-col">
                    {/* Telemetry Strip */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                      <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] px-2 py-2">
                        <div className="text-[10px] text-[var(--pc-muted)] uppercase">Viewers</div>
                        <div className="text-xs font-mono-tabular font-semibold text-[var(--pc-ink)] mt-0.5 inline-flex items-center gap-1">
                          <Users className="w-3 h-3 text-[var(--pc-muted)]" />
                          <span>{formatCompactCount(mon.viewer_count)}</span>
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] px-2 py-2">
                        <div className="text-[10px] text-[var(--pc-muted)] uppercase">Live Rate</div>
                        <div className="text-xs font-mono-tabular font-semibold text-[var(--pc-ink)] mt-0.5">
                          {mon.current_rate.toFixed(1)}/s
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] px-2 py-2">
                        <div className="text-[10px] text-[var(--pc-muted)] uppercase">Baseline</div>
                        <div className="text-xs font-mono-tabular font-semibold text-[var(--pc-sub)] mt-0.5">
                          {mon.baseline_rate.toFixed(1)}/s
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] px-2 py-2">
                        <div className="text-[10px] text-[var(--pc-muted)] uppercase">Z-Score</div>
                        <div className="text-xs font-mono-tabular font-semibold text-[var(--pc-ink)] mt-0.5">
                          {mon.z_score.toFixed(1)}σ
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] px-2 py-2">
                        <div className="text-[10px] text-[var(--pc-muted)] uppercase">Hype</div>
                        <div
                          className={`text-xs font-mono-tabular font-semibold mt-0.5 ${
                            mon.hype_score >= mon.threshold
                              ? 'text-[#53FC18]'
                              : 'text-[var(--pc-ink)]'
                          }`}
                        >
                          {mon.hype_score}%
                        </div>
                      </div>
                      <div className="rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)] px-2 py-2">
                        <div className="text-[10px] text-[var(--pc-muted)] uppercase">Clips</div>
                        <div className="text-xs font-mono-tabular font-semibold text-[var(--pc-ink)] mt-0.5">
                          {mon.clips_triggered}
                        </div>
                      </div>
                    </div>

                    {/* Real Live Spike Graph */}
                    <LiveSpikeGraph
                      history={mon.history}
                      accentColor={plat.accent}
                      spiking={isSpiking}
                      channelLabel={`${plat.label} ${mon.channel}`}
                    />

                    {/* Status Detail / Actionable Error */}
                    {mon.status_detail && (
                      <div
                        className={`text-[11.5px] rounded-lg px-3 py-2 border ${
                          isError
                            ? 'bg-[var(--pc-error)]/10 border-[var(--pc-error)]/30 text-[var(--pc-error)]'
                            : 'bg-[var(--pc-surface-2)]/50 border-[var(--pc-border-subtle)] text-[var(--pc-sub)]'
                        }`}
                      >
                        {mon.status_detail}
                      </div>
                    )}

                    {/* Recent Spikes Log */}
                    {mon.spikes.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--pc-muted)]">
                          Recent Triggers
                        </div>
                        <div className="space-y-1">
                          {mon.spikes.slice(0, 3).map((sp, i) => (
                            <div
                              key={`${sp.job_id}-${i}`}
                              className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular px-2.5 py-1.5 rounded-md bg-[var(--pc-surface-2)] border border-[var(--pc-border-subtle)]"
                            >
                              <span className="truncate text-[var(--pc-sub)]">
                                <span className="text-[var(--pc-ink)] font-semibold">
                                  {sp.manual ? 'Manual' : `Spike ${sp.hype_score}%`}
                                </span>
                                {' · '}
                                {sp.reasons.join(' · ')}
                              </span>
                              <button
                                type="button"
                                onClick={onOpenClips}
                                className="text-[var(--pc-accent)] hover:underline bg-transparent border-0 p-0 cursor-pointer shrink-0"
                              >
                                View
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="mt-auto pt-3 border-t border-[var(--pc-border-subtle)] flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={`Clip last ${mon.lookback_secs} seconds of ${mon.channel}`}
                          onClick={async () => {
                            setBusyMonitorId(mon.id);
                            try {
                              await onManualClipMonitor(mon.id, mon.lookback_secs);
                            } finally {
                              setBusyMonitorId(null);
                            }
                          }}
                          className="h-8 px-3 rounded-lg bg-[var(--pc-ink)] text-[var(--pc-bg)] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          <Scissors className="w-3.5 h-3.5 stroke-[2]" />
                          <span>Clip Last {mon.lookback_secs}s</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={
                            mon.auto_clip
                              ? `Disable auto-clip for ${mon.channel}`
                              : `Enable auto-clip for ${mon.channel}`
                          }
                          onClick={async () => {
                            setBusyMonitorId(mon.id);
                            try {
                              await onToggleAutoClip(mon.id, !mon.auto_clip);
                            } finally {
                              setBusyMonitorId(null);
                            }
                          }}
                          className={`h-8 px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                            mon.auto_clip
                              ? 'border-[var(--pc-ok)]/40 bg-[var(--pc-ok)]/10 text-[var(--pc-ok)]'
                              : 'border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)]'
                          }`}
                        >
                          <Zap className="w-3.5 h-3.5 stroke-[1.75]" />
                          <span>{mon.auto_clip ? 'Auto-Clip On' : 'Auto-Clip Off'}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={
                            mon.paused
                              ? `Resume monitoring ${mon.channel}`
                              : `Pause monitoring ${mon.channel}`
                          }
                          onClick={async () => {
                            setBusyMonitorId(mon.id);
                            try {
                              await onPauseMonitor(mon.id, !mon.paused);
                            } finally {
                              setBusyMonitorId(null);
                            }
                          }}
                          className="h-8 px-2.5 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-xs font-medium text-[var(--pc-sub)] hover:text-[var(--pc-ink)] inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {mon.paused ? (
                            <>
                              <Play className="w-3.5 h-3.5 stroke-[1.75]" />
                              <span>Resume</span>
                            </>
                          ) : (
                            <>
                              <Pause className="w-3.5 h-3.5 stroke-[1.75]" />
                              <span>Pause</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          aria-label={`Stop monitoring ${mon.channel}`}
                          onClick={async () => {
                            setBusyMonitorId(mon.id);
                            try {
                              await onStopMonitor(mon.id);
                            } finally {
                              setBusyMonitorId(null);
                            }
                          }}
                          className="h-8 w-8 rounded-lg border border-[var(--pc-border)] bg-[var(--pc-surface-2)] text-[var(--pc-sub)] hover:text-[var(--pc-error)] hover:border-[var(--pc-error)]/40 grid place-items-center cursor-pointer transition-colors"
                          title={`Stop monitoring ${mon.channel}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 stroke-[1.75]" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
