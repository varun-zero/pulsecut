# YIZERGE 1:1 reconstruction workspace

REA-driven reconstruction of the installed YIZERGE v1.3.0 desktop app.

## Contents

- `decompiled/` — all 213 files REA extracted from `app.asar` (original main,
  preload, and renderer bundles, CSS, fonts, social icons, emoji).
- `app/` — the **original rendered bundle running in a browser** with a
  reconstructed `window.api` shim. This is the closest possible 1:1 feature clone:
  it executes the actual YIZERGE UI code, not a hand-written imitation.
  - `server.mjs` — self-contained static server + `clip://` media proxy.
  - `ipc-shim.js` — browser reconstruction of the Electron preload API, seeded
    with authentic state recovered from the real app.
  - `media/demo.mp4` — the exact source clip referenced by the real autosave.
- `seed/autosave.json` — authentic saved project state from `%APPDATA%\YIZERGE`.
- `features/` — recovered UI strings/labels, complete runtime feature inventory,
  machine-readable IPC map (`ipc_map.json`), verification screenshots, and the
  full REA evidence bundle (`rea-evidence-bundle.json.gz`, 29 records).
- `FEATURE_MAP.md` — REA evidence ledger, IPC contract, full feature inventory.

## Run

```powershell
cd C:\Users\varun\pulsecut\clone\yizerge
.\run-clone.ps1
# http://127.0.0.1:8892/  → click "My Project" to open the editor
```

Or manually:
```powershell
cd app
node server.mjs
```

## Verification

Headless Chromium (REA CDP + direct CDP) confirmed: Home → editor with real video
preview and CC/V1/A1/A2 tracks; Framing, Templates, Text, Media tabs; template
chooser (4 styles); Multi-Segment; Final Preview (lock); File/Edit/View/Help menus;
Settings, Trash, Export, and full keyboard-shortcuts dialogs. Final clean run:
**zero JavaScript exceptions, zero failed network requests.**

## Caveats — read this

This is **not** recovered original source and **not** a native rebuild. The original
minified renderer bundle is executed as-is; the native engine (`engine:call`) and
`clip://` protocol are simulated. Native decompilation was unavailable on this host
(no Ghidra/IDA/Kuna, Hopper unsupported on Windows); Wakaru JS source recovery
requires Linux. Runtime equivalence of the proprietary render/export engine is
unverified. See `FEATURE_MAP.md` §6 and REA unknowns `unk_536e4c06…`, `unk_ce0dc3fe…`.

Copied assets remain the original vendor's copyrighted material — for
interoperability/educational analysis only.
