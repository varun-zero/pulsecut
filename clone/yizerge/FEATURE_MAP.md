# YIZERGE feature map — REA evidence ledger

Target: `C:\Users\varun\AppData\Local\Programs\YIZERGE\resources\app.asar`
SHA-256 `f1195a9d95e3e214e23d58ea67bf3e82b235fe1ff6387fc81574fce0f1414648`.
Package: `yizerge-desktop` v1.3.0 (recovered from `package.json`).
Main executable: `YIZERGE.exe` SHA-256 `5f601c62aaf67cde46485e2466ee326e8572b21802d9715af544aad5a4214386` (x86_64 PE, Electron).

## 1. REA operations actually run

| Operation | Evidence ID | Result |
|---|---|---|
| `open_binary` (asar) | session open | Bound active target to artifact-graph provider |
| `binary_session` | — | 19 evidence records; native providers (Ghidra/IDA/Kuna/Hopper) unavailable on this host |
| `analyze_javascript_application` | `ev_a90525d2…` (graph), `ev_561ee325…` (summary) | 137 graph facts: 32 IPC handlers, 44 IPC channels, 35 JS modules, 5 asar entries, 4 endpoints, 2 BrowserWindows, 1 preload, 1 context bridge, 1 renderer, 1 main |
| `extract_artifact` | `ev_31ac036f…` | 213 files extracted with complete container-entry coverage → `decompiled/` |
| `inspect_artifact` | `ev_d2942043…` | Inventory: 221 nodes / 222 occurrences / 221 edges, 215 files + 7 dirs, source_complete=true, 664 entries examined |
| `trace_application_feature` × 5 | `ev_da866620…`, `ev_f1d3a22d…`, `ev_ce53eed9…`, `ev_12797adf…`, + `menu:ready` | `engine:call`: 62 nodes / 73 edges / 4 paths, 0 native handoffs; progress channels: 3 nodes / 2 edges each |
| `analyze_web_bundle` | `ev_7dc27eaf…` | Observed 2 scripts on the running clone; renderer bundle sha256 `478eafdb…` (837,484 bytes) |
| `audit_release_exposure` | `ev_dd0fdaa4…` | 13 checks: 1 exposed (low), 1 not_observed, 3 not_applicable, 7 unknown, 3 not_assessed |
| `inspect_electron_fuses` | `ev_059647a0…` | No fuse sentinel in the PE (state unknown); cannot confirm Inspector switch |
| `capture_web_screenshot` | `ev_227a9939…` | REA-backed screenshot of the clone editor |
| `record_unknown` × 2 | `unk_536e4c06…`, `unk_ce0dc3fe…` | Native engine decompilation & runtime equivalence logged as high-severity unknowns |
| `export_evidence_bundle` | `features/rea-evidence-bundle.json.gz` | 29 records / 135.7 MB raw (23.9 MB gzipped), full deterministic ledger |
| `recover_javascript_sources` | — | Unavailable: requires Linux x64 Wakaru (`REA_WAKARU_COMMAND`); host is Windows |
| Native decompilation | — | Ghidra/IDA/Kuna not configured; Hopper unsupported on Windows |

Complete ledger is in `features/rea-evidence-bundle.json.gz` (REA Evidence IDs above).

## 2. IPC contract recovered from `out/preload/index.js`

17 literal channels: `menu:ready`, `engine:call`, `beta:lockout`, `app:quit`,
`project:saving`, `os:user`, `window:toggleFullscreen`, `app:version`,
`source:progress`, `window:overlay`, `app:openExternal`, `window:isFullscreen`,
`beta:status`, `ping`, `menu`, `export:progress`, `window:fullscreen`.

Full `window.api` surface (all implemented in `app/ipc-shim.js`):
- Top level: `ping`, `isFullscreen`, `toggleFullscreen`, `onFullscreen`, `onSaving`,
  `onMenu`, `overlay`, `quit`, `mac`, `user`, `version`, `engineVersion`,
  `openExternal`, `betaStatus`, `onBetaLockout`.
- Groups: `workspaces`, `projects`, `autosave`, `source`, `clips`, `tracks`,
  `exporter`, `fonts`, `subs`, `music`, `backdrop`, `slotMedia`, `sfx`,
  `watermark`, `outro`, `template`, `presets`, `trash`.
- URL builders (synchronous strings): `mediaUrl`, `slotMediaUrl`, `sfxUrl`.

## 3. UI / feature inventory (runtime sweep + recovered strings)

**Shell:** File / Edit / View / Help menus; Home; My Project; Export; Trash; Settings.

**Editor top bar:** Framing, Editor, Multi-Segment, 9:16 (Reels/Shorts/TikTok),
Final Preview (Shift+L), Res: Auto (playback quality), Fullscreen Player,
In/Out points, Undo/Redo, frame stepping, play, playback speed, timeline zoom (Alt+wheel), Fit.

**Timeline tracks:** CC (captions), V1 (Video Track 1), A1 (Master Audio), A2 (Background & Outro Music).

**Right panel tabs:** Framing, Templates, Text, Media.

**Framing panel:** Position & Scale (Scale, Pos X, Pos Y, import frame source),
Video Backdrop, Frame & Corners (radius, padding, outer-margin fill, shadow),
Playback Speed, Style Presets.

**Templates (4 actual whole-video styles):** X / Twitter (Light), X / Twitter (Dark),
Viral TikTok / Reel Hook, Breaking News Broadcast. Modal: "Choose a Video
Template · 4 Styles" with Active/Use Template cards. Per-template settings:
profile avatar, display name, handle, verified badge, hook/statement, card theme
(Light/Dark), font, text size, corner radius, subtitle placement.

**Text panel:** Headline Hook, Subtitles (.srt); text/color, font size, casing,
spacing, bold/italic, glow/shadow/border, background & banner, position & alignment, emoji picker.

**Media panel:** Master Video Audio (mute), Audio Track, auto-suggest levels
(Ducked Vol, Peak Vol, Peak Point, Riser Time), Sound Effects (SFX),
Logo & Watermark (social template/custom image, Pos X/Y, Scale, Opacity, drag-to-place),
Outro Media (Outro Template/Custom File, Template selector, Enabled, Template Preview, Play Preview).

**Multi-Segment mode:** "Multi-Segment (N)" with Add Segment and a SEGMENTS list
(#1 (start→end)). Final Preview locks BGM/SFX/hook audition ("Preview Locked").

**Export dialog:** Export settings, resolution, encoder (NVIDIA NVENC / Apple VideoToolbox),
progress/cancel/reveal, Export 9:16 Video, direct export (Ctrl+Shift+M).

**Preferences dialog:** Appearance Theme (Auto/Light/Dark), "Open file picker directly on
New Project", View & Search keyboard shortcuts, app details (YIZERGE 1.3.0, Local Desktop Cross-Platform).

**Trash dialog:** deleted projects/workspaces/videos, restore/delete-forever, empty state.

**Keyboard shortcuts (recovered in-app):**
- History: Undo Ctrl+Z, Redo Ctrl+Y / Ctrl+Shift+Z
- Playback: Play/Pause Space, Jump to time Ctrl+G, step frame ←/→ (Shift = 5), rate [ / ]
- Timeline: zoom Alt+wheel, zoom ±, Fit F / \ / Shift+Z, In I, Out O, clear Alt+X / Esc, lock/loop Shift+L
- Preview: 9:16 tab Ctrl+L, fullscreen Ctrl+` / F11
- Projects: New Ctrl+N, Export Ctrl+M, Quick export Ctrl+Shift+M
- Panels: Framing Ctrl+1, Text Ctrl+2, Media Ctrl+3, Templates Ctrl+4
- General: shortcuts help ?, close modal Esc

Endpoints observed: `https://yizerge.in`, Google Fonts metadata/CSS.

## 4. Clone implementation

- `app/` — the **original extracted renderer bundle** (`assets/index-B6ORocLA.js`,
  `assets/index-8nxODqIT.css`, original fonts/social icons/emoji, `favicon.png`)
  served by `server.mjs`, driven by `ipc-shim.js` (browser reconstruction of `window.api`).
  Three surgical browser-compat patches are applied to the copied bundle only:
  2× `parseInt((e||'#FFFFFF')…)` null guard and 4× `clip://` → `/clip/` rewrite;
  the pristine original remains in `decompiled/`.
- `app/media/demo.mp4` — the **actual source clip** referenced by the real app's
  `autosave.json` (`675a5ba9-…mp4`, 34.6s, 1080×1920, 9:16). `seed/autosave.json`
  is the authentic saved state recovered from `%APPDATA%\YIZERGE`; the shim seeds
  duration/resolution from it, so the editor shows Out 00:34:18 / 34.6s like the real app.
- `decompiled/` — every file REA extracted from the ASAR (213 files, 6.25 MB).
  `decompiled/readable/` contains human-readable (jsbeautifier) versions of the
  three core bundles — `main.js` (197 KB), `preload.js` (6.9 KB), `renderer.js`
  (1.25 MB) — produced as a decompilation aid; the originals are byte-preserved.
- `features/` — `ui_strings.txt` (1,044 strings), `ui_labels.txt` (863 labels),
  `feature_inventory.json` (46 controls, 14 swept sections), screenshots, and the REA evidence bundle.
- `run-clone.ps1` — launcher.

## 5. Verified in headless Chromium (REA CDP + direct CDP)

- Home → My Project → editor opens with real video preview and V1/A1/A2 tracks.
- Framing, Templates, Text, Media tabs mount; template chooser shows 4 styles.
- Multi-Segment, Final Preview (lock), File/Edit/View/Help, Settings, Trash, Export,
  and the full keyboard-shortcuts dialog all render.
- Final clean run: **zero JavaScript exceptions and zero failed network requests**.

Run:
```powershell
cd C:\Users\varun\pulsecut\clone\yizerge
.\run-clone.ps1
# http://127.0.0.1:8892/  → click "My Project"
```

## 6. Residual unknowns (do not treat as equivalence)

- Native binary decompilation unavailable: no original native source recovered.
- Wakaru JS source recovery unavailable: UI is driven by the original minified bundle, not reconstructed source.
- `clip://` custom protocol cannot work in a plain browser; backed with a transparent-PNG proxy. The native render engine (`engine:call`) and real export are not reproduced by the shim.
- Runtime behavioral equivalence with the proprietary native engine is unverified (logged as REA unknown `unk_ce0dc3fe…`).
- This reconstruction is for interoperability/educational analysis; copied assets are the original vendor's copyrighted material.
