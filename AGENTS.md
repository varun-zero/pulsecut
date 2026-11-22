# AGENTS.md — PulseCut Architecture & Agent Automation Guide

This document is the authoritative project reference for AI coding agents (Antigravity, Cursor, Windsurf, Claude Code, Codex, Copilot) and human engineers working on **PulseCut**.

---

## 1. Project Overview & Architecture
PulseCut is a local-first, high-retention video clipping & framing studio tailored for 9:16 Shorts, Instagram Reels, TikTok, and Kick streams. It pairs a high-performance React 19 + Tailwind v4 + TypeScript web studio with a verified FFmpeg 7+ headless render engine and optional Rust/Cargo backend.

### Tech Stack
- **Frontend Studio:** Vite 8+, React 19, TypeScript 7+, Tailwind CSS v4, Lucide React.
- **Render Engine:** FFmpeg 7.1 (`C:\Users\varun\AppData\Local\Programs\YIZERGE\ffmpeg.exe`), Python 3.10+ PIL overlay generator, EBU R128 (`loudnorm`) audio normalization.
- **Agent Interop:** Headless CLI (`scripts/pulsecut_cli.py`), Model Context Protocol server (`tools/agent/pulsecut_mcp.py`), JSON-RPC, standard JSON export schema.
- **Backend Crates:** Rust workspace under `crates/` (`crates/render`, `crates/editor`, `crates/app`).

---

## 2. Essential Commands

### Install & Development
```powershell
npm install              # Install Node.js frontend dependencies
npm run dev              # Launch Vite dev server on http://localhost:3000
npm run build            # Production Vite bundle build
npm run lint             # Run TypeScript compiler check (tsc --noEmit)
npm test                 # Run Node test runner on studioLogic.test.ts
```

### Agent Headless CLI (`scripts/pulsecut_cli.py`)
```powershell
# Health & Environment Check (structured JSON)
python scripts/pulsecut_cli.py health --json

# List available footage and clips
python scripts/pulsecut_cli.py list-clips --json

# List all 13 zero-overlap ClipShip templates and viral presets
python scripts/pulsecut_cli.py list-templates --json

# Render a single clip headlessly with live progress and QA frame
python scripts/pulsecut_cli.py render --clip "01_stapleton-vocal-drop_T03" --template "03_Tweet_Plus_Reply" --qa

# Run the verified 13-clip batch generator
python scripts/export_clipship.py
```

### MCP (Model Context Protocol) Server
Run the stdio MCP server for agent clients (Claude Desktop, Cursor, Antigravity):
```powershell
python tools/agent/pulsecut_mcp.py
```

---

## 3. Directory Layout & Conventions
- `src/components/editor/`: NLE Studio components (`VideoStage.tsx`, `EditorTimeline.tsx`, `EditorInspector.tsx`, `AgentInteropModal.tsx`).
- `src/lib/`: Core studio logic (`studioLogic.ts`, `clipshipTemplates.ts`, `studioLogic.test.ts`).
- `src/presets.ts`: Single shared registry of viral presets and ClipShip templates.
- `src/captionStyles.ts`: Safe zones, ASS subtitle generator, viral typography.
- `public/templates/clipship/`: 13 zero-overlap overlay template folders with transparent PNG frames.
- `scripts/`: Production rendering and CLI tools (`pulsecut_cli.py`, `export_clipship.py`).
- `tools/agent/`: Agent protocol tools, MCP server, extension hooks.
- `exports/`: Destination for rendered MP4 clips, contact sheets, and QA frames.

---

## 4. Zero-Drift & Compliance Invariants

1. **Duration Rule:** Every exported clip must be `>= 8.0s` (target 12–24s for optimal loop completion).
2. **Audio Preservation:** Keep 100% original live audio (`-c:a aac -b:a 192k`, EBU R128 normalization to `-14 LUFS`). Never add unauthorized background music.
3. **Full-Frame 16:9 Preservation:** Never squish 16:9 horizontal video into narrow strips. Scale to full canvas width (`1080×608`).
4. **Text Casing:** All hook captions, headline pills, and burned live lyrics must be formatted in **lowercase** per campaign brief.
5. **Branding & Watermarks:** Never render default ClipShip watermarks. Default to custom channel branding (`beats cut`, `@beatscutfm`, custom circular logo).
6. **Zero Graphic Overlaps:** Avatars, header rows, hook text, video frames, split seams, and subtitle tracks must strictly adhere to measured bounding box math.
