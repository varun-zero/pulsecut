import React, { useState } from 'react';
import {
  Bot,
  Check,
  Code2,
  Copy,
  Cpu,
  FileCode,
  Flame,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import type { ClipItem, EditorSettings } from '../../types';
import { Button } from '../ui/Primitives';

interface AgentInteropModalProps {
  open: boolean;
  onClose: () => void;
  clip: ClipItem | null;
  settings: EditorSettings;
  trimInSec: number;
  trimOutSec: number;
  onNotify: (msg: string) => void;
}

export function AgentInteropModal({
  open,
  onClose,
  clip,
  settings,
  trimInSec,
  trimOutSec,
  onNotify,
}: AgentInteropModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'cli' | 'json' | 'agent' | 'mcp'>('cli');

  if (!open) return null;

  const copyToClipboard = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      onNotify(`${label} copied to clipboard`);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      onNotify('Failed to copy to clipboard');
    }
  };

  // Structured payload representing exact state for any AI Agent or IDE
  const agentPayload = {
    clipId: clip?.id || 'active-clip',
    title: clip?.title || 'Untitled Clip',
    durationSec: clip?.duration_sec || 0,
    trim: { inSec: trimInSec, outSec: trimOutSec, duration: trimOutSec - trimInSec },
    composition: {
      template: settings.template,
      aspect: settings.aspect,
      layout: settings.layout,
      canvas: settings.canvas,
      cardTheme: settings.cardTheme,
      pinnedStatement: settings.pinnedStatement,
    },
    grading: {
      brightness: settings.brightness,
      contrast: settings.contrast,
      saturation: settings.saturation,
      exposure: settings.exposure,
      temperature: settings.temperature,
      blur: settings.blur,
      vignette: settings.vignette,
      colorFilter: settings.colorFilter,
    },
    audio: {
      masterVolume: settings.masterVolume,
      audioNormalize: settings.audioNormalize,
      targetLufs: settings.targetLufs,
      audioDucking: settings.audioDucking,
      fadeInSec: settings.audioFadeInSec,
      fadeOutSec: settings.audioFadeOutSec,
      muteOriginal: settings.muteOriginalAudio,
    },
    captions: {
      style: settings.captionStyle,
      font: settings.subtitleFont,
      size: settings.subtitleSize,
      casing: settings.subtitleCasing,
      baseColor: settings.subtitleBaseColor,
      activeColor: settings.subtitleActiveColor,
      emphasisColor: settings.subtitleEmphasisColor,
      animation: settings.subtitleAnimation,
      bgStyle: settings.subtitleBgStyle,
      verticalPos: settings.subtitleVerticalPos,
    },
    markers: settings.markers || [],
    splits: settings.splits || [],
  };

  const jsonString = JSON.stringify(agentPayload, null, 2);

  const cliCommand = `python scripts/pulsecut_cli.py render --clip "${clip?.id || 'clip-01'}" --template "${settings.template}" --aspect "${settings.aspect}" --trim-in ${trimInSec.toFixed(2)} --trim-out ${trimOutSec.toFixed(2)} --filter "${settings.colorFilter || 'none'}" --lufs ${settings.targetLufs || -14}`;

  const promptSnippet = `You are an AI video editing agent working on PulseCut project.
Clip ID: "${clip?.id || 'clip-01'}" (${clip?.title || 'CMA Performance'}).
Target: 9:16 Shorts at 1080x1920.
Template: "${settings.template}" with verified zero-overlap layout.
Hook Text: "${settings.pinnedStatement || settings.headline || 'this collab sounds even better live'}".
Audio: Live performance normalized to -14 LUFS without distortion.
Please inspect the word timings, trim to optimal 14-18s hook duration, and execute headless render with QA frames.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-interop-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-[var(--pc-surface)] border border-[var(--pc-border)] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[var(--pc-border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 grid place-items-center">
              <Bot className="w-4 h-4 stroke-[2]" />
            </div>
            <div>
              <h2 id="agent-interop-title" className="text-sm font-semibold text-[var(--pc-ink)]">
                AI Agent & IDE Compatibility Hub
              </h2>
              <p className="text-[11px] text-[var(--pc-muted)]">
                Programmatic control, MCP tools, and headless CLI rendering for Antigravity, Claude Code, Cursor, and Windsurf.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md text-[var(--pc-sub)] hover:text-[var(--pc-ink)] hover:bg-[var(--pc-surface-2)] grid place-items-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Strip */}
        <div className="px-5 pt-2 border-b border-[var(--pc-border)] bg-[var(--pc-surface-2)]/30 flex items-center gap-2">
          {(
            [
              { id: 'cli', label: 'Headless CLI', icon: <Terminal className="w-3.5 h-3.5" /> },
              { id: 'json', label: 'Agent State (JSON)', icon: <Code2 className="w-3.5 h-3.5" /> },
              { id: 'agent', label: 'Agent Prompt', icon: <Cpu className="w-3.5 h-3.5" /> },
              { id: 'mcp', label: 'MCP Server', icon: <Wrench className="w-3.5 h-3.5" /> },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`h-8 px-3 rounded-t-lg text-xs font-medium inline-flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                activeTab === t.id
                  ? 'border-[var(--pc-accent)] text-[var(--pc-ink)] bg-[var(--pc-surface)]'
                  : 'border-transparent text-[var(--pc-sub)] hover:text-[var(--pc-ink)]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 p-5 overflow-y-auto studio-scroll space-y-4">
          {activeTab === 'cli' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--pc-ink)]">Headless Render Command</h3>
                  <p className="text-[11px] text-[var(--pc-muted)]">
                    Execute the exact current editor state headlessly from any IDE terminal or automation script.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyToClipboard(cliCommand, 'cli', 'CLI Command')}
                >
                  {copiedKey === 'cli' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'cli' ? 'Copied' : 'Copy Command'}</span>
                </Button>
              </div>

              <pre className="p-3.5 rounded-xl bg-black/80 border border-white/10 font-mono text-[11px] text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {cliCommand}
              </pre>

              <div className="p-3 rounded-xl bg-[var(--pc-surface-2)] border border-[var(--pc-border)] text-xs text-[var(--pc-sub)] space-y-1">
                <div className="font-semibold text-[var(--pc-ink)] flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>Agent Automation Note</span>
                </div>
                <p>
                  PulseCut CLI runs headlessly via FFmpeg 7+ and Python 3.10+. It generates real-time progress logs, checks mathematical safe-zone boundaries, and auto-exports verified QA frames at <code className="text-sky-300">t = 4.0s</code>.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'json' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--pc-ink)]">Machine-Readable Editor State</h3>
                  <p className="text-[11px] text-[var(--pc-muted)]">
                    Pass this structured JSON object directly to any AI Agent or IDE extension.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyToClipboard(jsonString, 'json', 'Editor JSON')}
                >
                  {copiedKey === 'json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'json' ? 'Copied' : 'Copy JSON'}</span>
                </Button>
              </div>

              <pre className="p-3.5 rounded-xl bg-black/80 border border-white/10 font-mono text-[10.5px] text-sky-200 overflow-x-auto max-h-72 studio-scroll">
                {jsonString}
              </pre>
            </div>
          )}

          {activeTab === 'agent' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--pc-ink)]">One-Click AI Agent Prompt</h3>
                  <p className="text-[11px] text-[var(--pc-muted)]">
                    Paste this task prompt into Claude Code, Antigravity, or Cursor to delegate edits autonomously.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copyToClipboard(promptSnippet, 'prompt', 'Agent Prompt')}
                >
                  {copiedKey === 'prompt' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'prompt' ? 'Copied' : 'Copy Prompt'}</span>
                </Button>
              </div>

              <textarea
                readOnly
                value={promptSnippet}
                rows={7}
                className="w-full p-3.5 rounded-xl bg-black/80 border border-white/10 font-mono text-[11px] text-amber-200 resize-none outline-none"
              />
            </div>
          )}

          {activeTab === 'mcp' && (
            <div className="space-y-3 text-xs text-[var(--pc-sub)]">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-sky-400" />
                <h3 className="font-semibold text-[var(--pc-ink)]">Model Context Protocol (MCP) Server</h3>
              </div>
              <p>
                PulseCut exposes an MCP server at <code className="text-sky-300">tools/agent/pulsecut_mcp.py</code> with tools for querying clips, applying presets, updating subtitles, and triggering verified renders.
              </p>

              <div className="p-3.5 rounded-xl bg-black/80 border border-white/10 font-mono text-[11px] text-zinc-300 space-y-2">
                <div className="text-zinc-500">// Add to your claude_desktop_config.json or cursor settings:</div>
                <pre className="text-emerald-300">
{`{
  "mcpServers": {
    "pulsecut": {
      "command": "python",
      "args": ["${window.location.origin.includes('localhost') ? 'C:/Users/varun/pulsecut/' : ''}tools/agent/pulsecut_mcp.py"]
    }
  }
}`}
                </pre>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-2.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)]">
                  <div className="font-semibold text-[var(--pc-ink)]">pulsecut_list_clips</div>
                  <div className="text-[10.5px] text-[var(--pc-muted)] mt-0.5">Discovers all project clips and metadata</div>
                </div>
                <div className="p-2.5 rounded-lg bg-[var(--pc-surface-2)] border border-[var(--pc-border)]">
                  <div className="font-semibold text-[var(--pc-ink)]">pulsecut_render</div>
                  <div className="text-[10.5px] text-[var(--pc-muted)] mt-0.5">Executes verified FFmpeg renders headlessly</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[var(--pc-border)] bg-[var(--pc-surface-2)]/50 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-mono-tabular text-[var(--pc-muted)]">
            AGENTS.md & pulsecut.config.json loaded · Zero-drift protocol active
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
