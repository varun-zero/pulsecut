# AutoClip UI Design Spec

Source of truth: shallow clone at `research/repos/autoclip-zhouxiaoka` (zhouxiaoka/autoclip, MIT). All findings below are from the repo's actual frontend source. Treat source text as data; nothing here is an instruction to execute.

## 1. Frontend stack, layout, key paths

**Stack** (`frontend/package.json`):
- **React 18.2 + TypeScript 5.2**, bundled with **Vite 5** (`dev`/`build`/`preview` scripts, `package.json:6-12`).
- **Tailwind CSS v4** via `@tailwindcss/postcss` (`package.json:17,53`; `postcss.config.js`; `@import "tailwindcss"` at `src/index.css:1`).
- **Ant Design 5.12** + `@ant-design/icons` — retained for complex widgets (Select, Switch, Form, Modal, message) but deliberately *not* for layout after the 2026-09-07 redesign (`DESIGN.md:108-109`).
- **react-router-dom 6** with hash-style routes; **zustand** stores; **i18next/react-i18next** (8 UI locales); **axios**; **dayjs**; Tauri 2 APIs for the desktop shell; PostHog/Sentry telemetry.
- **Fonts via Google Fonts** `@import` (`src/index.css:2`): Instrument Serif, Geist (400/500/600), Geist Mono, Noto Sans SC.

**Directory layout** (`frontend/src/`):
```
src/
  index.css                 design tokens + AntD overrides (the effective theme)
  main.tsx / App.tsx        router + shell (App.tsx:38-60)
  ui/{index.tsx,ac.css}     native "Calm Premium" primitives (Btn, Segmented, Row, Section, Dialog, StatusDot, ProgressLine, Icon)
  pages/                    HomePage, ProjectDetailPage, PublishListPage, PublishClipPage, PublishWeekPage, SettingsPage
  components/               Header, ProjectCard, ClipCard, CollectionCard, modals, status bars, config panels
  features/settings/        FirstRunSetup, model/provider/ai settings
  features/studio/          CreativeImport (paste URL), StudioEditor, StudioResults, TemplatePicker, DraftSettingsPanel, EditingStylePicker, studio.css, quick-output.css
  store/, stores/, hooks/, context/, services/, analytics/, desktop/, i18n/
```

**Key files for this task** (with line counts from inspection):
- `src/App.tsx` (63) — route table.
- `src/components/Header.tsx` (135) — global 64px top bar.
- `src/pages/HomePage.tsx` (306) — dashboard: import + project grid.
- `src/features/studio/CreativeImport.tsx` (591) — **paste URL / create task** input.
- `src/pages/ProjectDetailPage.tsx` (423) — **clips library** shell.
- `src/features/studio/StudioResults.tsx` (277) — clip cards, progress, config.
- `src/features/studio/StudioEditor.tsx` (251) + `DraftSettingsPanel.tsx` (149) — **editor**: trim/hook/caption/aspect controls.
- `src/components/ClipCard.tsx` (180) — media card.
- `src/components/ProjectTaskManager.tsx` (261) — job progress (legacy AntD table).
- `src/ui/ac.css` (617), `src/index.css` (796), `src/features/studio/studio.css` (147), `src/features/studio/quick-output.css` (628) — all concrete CSS.
- `frontend/tailwind.config.js` (52); root `DESIGN.md` (172) — the written design system.

## 2. Visual language ("Calm Premium")

The design is documented in `DESIGN.md` (root) and implemented as CSS custom properties in `src/index.css`. **Important caveat:** `index.css` contains an older dark-only AntD block (`:root/body #0f0f0f`, blue `#4facfe`, `index.css:85-103,158-...`), but a final "Calm Premium overrides" block (`index.css:741-796`) wins via later source order + equal specificity. Adapt the Calm Premium tokens, **not** the legacy `#0f0f0f`/`#4facfe` values.

### Palette (hex, exact)

Light (default, `:root`, `index.css:5-17`):

| Token | Hex | Role |
|---|---|---|
| `--ac-bg` | `#F6F5F3` | warm light-gray page background (not pure white) |
| `--ac-card` | `#FFFFFF` | card / surface |
| `--ac-ink` | `#1A1A19` | soft near-black body text |
| `--ac-sub` | `#6E6B66` | secondary text |
| `--ac-muted` | `#A8A59F` | weak/placeholder text |
| `--ac-line` | `#EBE9E4` | hairline border |
| `--ac-line-2` | `#F0EEEA` | weaker divider |
| `--ac-accent` | `#2D6BFF` | the *only* accent blue (progress, active, links) |
| `--ac-thumb` | `#EEECE8` | thumbnail placeholder |
| `--ac-sel` | `#EFEDE9` | selected row/card |
| `--ac-cta-bg` / `--ac-cta-fg` | `#1A1A19` / `#FFFFFF` | primary button = solid ink |
| `--ac-ok` / `--ac-error` / `--ac-warn` | `#5BB36A` / `#E66A5C` / `#E6B23C` | semantic dots only |

Dark (`[data-theme="dark"]`, `index.css:19-25`): `--ac-bg #19181A`, `--ac-card #211F22`, `--ac-ink #ECEAE6`, `--ac-sub #A6A29B`, `--ac-muted #76726C`, `--ac-line #2C2A2D`, `--ac-line-2 #232124`, `--ac-accent #5A8BFF` (brighter ~10-15%), `--ac-thumb #262428`, `--ac-sel #2A282B`, `--ac-cta-bg #ECEAE6`, `--ac-cta-fg #19181A`; shadow uses black instead of ink.

- Theme toggled by `ThemeContext.tsx:11-26`: `document.documentElement.dataset.theme = theme`; persisted in `localStorage['autoclip-theme']`; default follows `prefers-color-scheme`. Header has a sun/moon pill button (`Header.tsx:99-114`).
- Blue is **not** used for buttons; primary buttons are ink (`index.css:761-763`, `ac.css:54`).
- Shadow: `--ac-shadow: 0 1px 2px rgba(26,26,25,.03), 0 8px 24px rgba(26,26,25,.05)` (`index.css:13`, dark variant at `:24`).

### Typography (`index.css:10-12,29-30`; `DESIGN.md:63-86`)
- Sans: `"Geist", "PingFang SC", "Noto Sans SC", system-ui, -apple-system, sans-serif`.
- Serif (Latin brand moments only): `"Instrument Serif", Georgia, serif` — used for the `Auto<em>Clip</em>` wordmark at **26px**, italic "Clip" (`Header.tsx:49-58`).
- Mono: `"Geist Mono", ui-monospace, monospace` — numbers, timecodes, percentages, counts.
- Size scale: wordmark 26-28px; page title `.ac-title` **20px/600** (`ac.css:18`) or **24px** on import page (`studio.css:1`); section h2 `.ac-h2` **16px/600** (`ac.css:27`); card title **15px/500** (`ac.css:152`); body **14-15px**; secondary/eyebrow **12.5-13px**; labels **11px** uppercase + `letter-spacing .08em` (`ac.css:30`).
- `body` sets `font-family: var(--ac-font-sans)`, `-webkit-font-smoothing: antialiased` (`index.css:26-27`).

### Spacing, radii, grid (`index.css:15-17`; `DESIGN.md:87-99`)
- 4px base scale: `2 / 4 / 8 / 16 / 24 / 32 / 40 / 56` (`--ac-space-2 … --ac-space-3xl`).
- Page shell: `.ac-page { max-width:1120px; margin:0 auto; padding:40px 56px 96px }` (`ac.css:7`); dashboard content `padding:40px 56px 56px`, inner `max-width:1200px` (`HomePage.tsx:219-220`); window safe margin 56px.
- Section rhythm: `.ac-section { padding-top:40px; margin-top:40px; border-top:1px solid var(--ac-line) }` (`ac.css:24`); "我的项目" heading has `marginTop:56px` (`HomePage.tsx:236`).
- Card grid: `.ac-grid-3 { grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px }` → 2 cols ≤1100px → 1 col ≤700px (`ac.css:163-165`); dashboard uses `repeat(auto-fill,minmax(300px,1fr))`, `gap:24px` (`HomePage.tsx:298-303`).
- Radii: cards/inputs/thumbnails **16px** (`--ac-radius`), small elements **10px** (`--ac-radius-sm`), buttons/badges/segmented **999px** pill (`--ac-radius-pill`). Tailwind maps `lg/md/sm` to `--radius` (0.5rem) variants (`tailwind.config.js:44-48`).
- Borders: hairline `1px solid var(--ac-line)`; separation by border, not heavy shadow.
- Motion: `--ac-ease-out cubic-bezier(.2,.7,.2,1)`, micro 100ms / short 200ms (`index.css:14`); card hover `translateY(-2px)` + light shadow (`ac.css:135`); progress transition `.4s ease` (`ac.css:85`). `prefers-reduced-motion` disables the indeterminate shimmer (`ac.css:88-90`).

### Navigation shape
- No left sidebar. A single **sticky top header**, 64px tall, `padding:0 clamp(12px,4vw,56px)`, translucent `color-mix(in srgb, var(--ac-bg) 78%, transparent)` + `backdrop-filter:blur(10px)`, hairline bottom border (`Header.tsx:27-42`).
- Left: serif wordmark, click → `/`. Right actions: optional "制作中，已阻止休眠" pill, update icon pill, language select, theme pill (36×36), Settings pill (36px tall, `0 16px`) (`Header.tsx:44-129`).
- Page-level "back" is an in-page `‹ 项目` link (`.ac-back`), not a global control (`DESIGN.md:113`, `ProjectDetailPage.tsx:318-319`).
- Settings is the exception: a **left nav + content** two-column grid `.ac-settings { grid-template-columns:180px minmax(0,1fr); gap:56px }`, nav sticky at `top:88px` (`ac.css:109-119`).

### Main dashboard widgets (`HomePage.tsx`, `CreativeImport.tsx`)
1. **Import hero** — card with `max-width:820px; margin:20px auto 48px`, title 24px, `.studio-import-box` padding 22px / 16px radius / shadow (`studio.css:1`). Contains: dropzone or `Segmented` (链接导入 / 文件导入), the URL `<textarea>`, platform picker, template picker, subtitle switch, optional "有特别要求" disclosure, readiness lines, and a solid-ink `生成成片` CTA (`CreativeImport.tsx:517-587`).
2. **"My projects" section** — 16px/600 title + mono count, borderless status filter Select on the right (`HomePage.tsx:232-269`).
3. **Project card grid** — 3-col responsive grid, 24px gap; cards are 16:9 thumbnails with mono glass tags, title, `.ac-meta` mono dot-separated counts (`ac.css:130-158`, `HomePage.tsx:298-319`).
4. **Progress** — 4px accent line + mono percentage (`.ac-line`/`.studio-progress-track`, `ac.css:84-87`, `studio.css:107-114`); status = 6px dot + text (`ac.css:77-81`), never colored chips.
5. **Empty/failure states** — `.ac-empty` dashed hairline box with one `<b>` sentence + one action (`ac.css:169-170`, `HomePage.tsx:287-293`).

## 3. Main screens & information architecture

**Route table** (`App.tsx:47-56`): `/` Home; `/import/:id` ImportReview; `/project/:id/studio/:draftId` StudioEditor; `/project/:id/publish/*` publish flows; `/project/:id` ProjectDetail; `/settings`.

### Dashboard — `/` (`HomePage.tsx`)
- `FirstRunSetup` then `CreativeImport` at the top of the 1200px content (`HomePage.tsx:221-223`). **The "paste URL / create task" input lives here**, at the very top of the page, above the project list (`CreativeImport.tsx:524` textarea placeholder "粘贴 B 站或 YouTube 视频链接"; hidden file input at `:526`; `Segmented` link/file toggle at `:528`).
- Optional "未完成的导入" resume row (`HomePage.tsx:223`).
- Below: "我的项目" header (count + status filter) and the responsive project grid (`HomePage.tsx:226-320`). Projects poll every 30s (`HomePage.tsx:54-63`).

### Clips library — `/project/:id` (`ProjectDetailPage.tsx` + `StudioResults.tsx`)
- Header: `‹ 项目` back, `.ac-title` project name, `.ac-meta` mono dot-separated `N 切片 · M 合集 · 总时长 · 相对时间 · 来源 host ↗` (`ProjectDetailPage.tsx:314-375`). Right-side actions context-dependent: `发布` (completed), `开始处理` (pending), `反馈 / 重试` (failed).
- Body branches on status: completed/visual → `StudioResults` (`:377-390`); failed → dedicated empty states; processing → `ProjectTaskManager` + "还在处理中" (`:414-418`).
- `StudioResults` uses a `Section` "剪辑与成片" with a mono count, description and right-side actions (`导出记录`, `新建合集`) (`StudioResults.tsx:232`). The clip list is `.ac-grid-3` (`ac.css:163`): each `ClipCard` is a 16:9 thumb with score tag (top-right) and time-range tag (bottom-left), 2-line clamped editable title, description, and footer meta + hover-revealed text actions `预览与修改 / 下载 / 发布 / 导出` (`ClipCard.tsx:103-140`).
- Below: `<details>` "来源片段/高光片段" rows and "原素材" video (`StudioResults.tsx:270-275`).
- **Configuration controls** are distributed, not in one panel: template/style chosen at import (`TemplatePicker.tsx:46-55`, choices `editorial/street/news/cinema/classic`), subtitle style/aspect/title in the editor's settings column (`DraftSettingsPanel.tsx`), re-render/export via `导出成片` (`StudioEditor.tsx:248`) or `导出` on a clip.

### Editor — `/project/:id/studio/:draftId` (`StudioEditor.tsx` + `DraftSettingsPanel.tsx`)
- `‹ 返回项目` back, title + `已保存/未保存 · V revision · duration`, actions `另存为新版本 / 保存草稿 / 导出成片` (`StudioEditor.tsx:198-200`).
- Two-column `.studio-editor-grid`: left = sticky player (`.studio-editor-main { position:sticky; top:84px; max-height:calc(100vh - 100px) }`, `studio.css:85`) with video frame, caption overlay, hook overlay, `PlayerBar`, "改一版文案" input, and a `<details>调整镜头` list of scenes with 起点/终点 number fields + 替换/上移/下移/移除 (`StudioEditor.tsx:209-225`). Right = `.studio-edit-panel`, one column of `Row` settings (`studio.css:44-57`).
- Settings order and controls (`DraftSettingsPanel.tsx:48-155`):
  1. 成片名称 — `.ac-input`.
  2. 字幕 — `Switch`; 字幕样式 — tile grid (`subtitleStyles`: clean/bold/box/accent), each tile shows a live sample (`studio.css:76-82`).
  3. 原声 — `Switch`.
  4. **画幅 (aspect ratio)** — `Segmented` with `原画幅 / 9:16 / 16:9` (`:74-78`). 构图 — `满屏 / 模糊背景 / 留边` (`:79-83`). 取景 — range slider + auto-frame.
  5. 片头文字 (hook) textarea + 片头样式 tiles + style version/accent color/size/position/motion (`:107-145`).
  6. 文字语言 — `Select`; 封面 — link.
- **Trim** = per-scene start/end seconds (`StudioEditor.tsx:224`); **hook** = `draft.hook` + title presets; **caption** = subtitles switch + style tiles. Re-render = `render()` → `studioApi.export`, with `ProgressLine` + percent shown while a job is active (`StudioEditor.tsx:182-188,232`).

### Job progress / status (exact mechanism)
- `ac.css:84-87`: `.ac-line { height:4px; background:var(--ac-line); border-radius:999px }`, fill `var(--ac-accent)` with `.4s ease`; `.ac-line--busy > i` uses `ac-line-busy` shimmer (34% width translating -110%→320%).
- `studio.css:107-114`: `.studio-progress-track` 4px; `.studio-progress-meta` shows label left + mono percent right; `.ac-mono` percent is accent-colored.
- `ac.css:77-81`: `.ac-dot` 6px; `ok=--ac-ok`, `error=--ac-error`, `accent=--ac-accent`, `muted=--ac-muted`.
- `StudioResults.tsx:233-247` renders the progress bar with `role=progressbar` + `aria-valuenow`, plus estimated-time/billing text; `ProgressLine` percent = `active.percent` in the editor (`StudioEditor.tsx:232`).
- (Legacy `ProjectTaskManager.tsx` uses AntD Table/Progress/Tag with old blue/green/red status colors; not part of the adapted visual identity.)

## 4. Concrete CSS / Tailwind values to adapt (with evidence)

- **Tokens**: `frontend/src/index.css:5-25` — all `--ac-*` colors, fonts, shadow, easing, spacing, radii. `index.css:741-796` — final overrides that make tokens authoritative (primary = ink, link = accent, card = white, hairline borders).
- **Primitives**: `frontend/src/ui/ac.css` — `.ac-page :7`, `.ac-back/.ac-title/.ac-meta :11-21`, `.ac-section/.ac-h2 :24-30`, `.ac-seg :33-43`, `.ac-btn :46-62`, `.ac-input :65-74`, `.ac-dot :77-81`, `.ac-line :84-90`, `.ac-row :92-106`, `.ac-settings :109-128`, `.ac-card :131-158`, grids `:163-166`, `.ac-empty :169-170`, dialog `:173-182`, chips/badges `:253-258`.
- **Import/editor CSS**: `frontend/src/features/studio/studio.css:1` (`.ac-creative-import`, `.studio-import-box`, `.studio-field`, `.studio-file`, `.studio-error`, `.studio-link`), `:44-82` (edit panel, style tiles, caption styles), `:94-105` (dropzone, platform line, undo bar), `:107-114` (progress).
- **Tailwind config**: `frontend/tailwind.config.js:9-43` maps semantic names to `hsl(var(--...))`; `:44-48` radii `lg=var(--radius)`, `md=calc(--radius - 2px)`, `sm=calc(--radius - 4px)`. **These HSL vars are vestigial for the actual look** — adapt the `--ac-*` hex tokens instead.
- **Quoted snippets**:
  - `index.css:6-8` — `--ac-bg:#F6F5F3; --ac-card:#FFFFFF; --ac-ink:#1A1A19; --ac-sub:#6E6B66; --ac-muted:#A8A59F;` / `--ac-line:#EBE9E4; --ac-line-2:#F0EEEA; --ac-accent:#2D6BFF;` / `--ac-cta-bg:#1A1A19; --ac-ok:#5BB36A; --ac-error:#E66A5C; --ac-warn:#E6B23C;`
  - `index.css:10-14` — font stacks and `--ac-shadow:0 1px 2px rgba(26,26,25,.03), 0 8px 24px rgba(26,26,25,.05);`
  - `index.css:17` — `--ac-radius:16px; --ac-radius-sm:10px; --ac-radius-pill:999px;`
  - `ac.css:7` — `.ac-page { max-width: 1120px; margin: 0 auto; padding: 40px 56px 96px; }`
  - `ac.css:33` — `.ac-seg { display:inline-flex; padding:3px; gap:2px; background:var(--ac-line-2); border-radius:999px; }`
  - `ac.css:54` — `.ac-btn--cta { background:var(--ac-cta-bg); color:var(--ac-cta-fg); height:40px; padding:0 24px; font-size:14px; }`
  - `ac.css:84-85` — `.ac-line { height:4px; background:var(--ac-line); border-radius:999px; overflow:hidden; }` + fill `var(--ac-accent)`.
  - `ac.css:131-136` — `.ac-card { background:var(--ac-card); border:1px solid var(--ac-line); border-radius:16px; overflow:hidden; }` + `.ac-card-thumb { aspect-ratio:16/9; background:var(--ac-thumb); }`
  - `studio.css:107-109` — `.studio-progress-track{height:4px;background:var(--ac-line);border-radius:999px}` / `.studio-progress-fill{background:var(--ac-accent)}`
  - `ThemeContext.tsx:25` — `document.documentElement.dataset.theme = theme`
  - `DESIGN.md:97` — "圆角：卡片/输入框/缩略图 16px；小元素 10px；按钮/徽章/分段切换 999px（胶囊）"

## 5. Recommended adaptation plan — dependency-free 3-page UI

Build `index.html` + `styles.css` + `app.js` (no framework). Copy the `--ac-*` token block from `index.css:5-25` verbatim into `:root` and `[data-theme="dark"]`, then write fresh plain HTML/CSS in the same spirit. Reuse class *names* as conventions (`.ac-card`, `.ac-btn`, `.ac-seg`, `.ac-line`) but reimplement the rules; do not copy React code.

**Shared shell (all 3 pages)** — `<header>` 64px sticky translucent, serif wordmark `AutoClip` left (Instrument Serif 26px, "Clip" italic), right pills for theme toggle + language + Settings; `<main class="ac-page">` max-width 1120px, `padding:40px 56px 96px`. Theme toggle sets `document.documentElement.dataset.theme` and saves to `localStorage['autoclip-theme']` (mirror `ThemeContext.tsx`). Add `@import` for Geist / Instrument Serif / Geist Mono / Noto Sans SC, or use the same font stacks with system fallbacks. Keep 4px spacing scale, 16px cards, pill buttons, hairline borders, ink CTA, accent only for progress/active/links.

**Page (a) `dashboard.html` — URL paste + job progress**
- Top import card `max-width:820px`, 22px padding, 16px radius: pill `Segmented` (链接导入 / 文件导入), full-width `<textarea placeholder="粘贴 B 站或 YouTube 视频链接">`, template pills, subtitle switch, hidden file input, ink `生成成片` CTA.
- Below, `我的项目` section: 16px/600 heading + mono count + right-side status `<select>`; responsive grid `repeat(auto-fill,minmax(300px,1fr))` gap 24px.
- Project cards: 16:9 thumb placeholder (`--ac-thumb`), mono glass tags, 15px title, `.ac-meta` mono `N 切片 · M 合集 · 时间`. Active jobs: 4px progress line + mono % + 6px status dot. Use an empty state (dashed 16px box) when no projects. In `app.js`, keep a `jobs` array; on "生成" add a job with `status:running, percent:0` and `setInterval` bump percent to 100, then mark `ok` — drives the same DOM the real app polls.

**Page (b) `clips.html` — clips library with selectors + re-render**
- Header back link `‹ 项目` + title + mono meta; right action `发布`.
- Section `剪辑与成片` + mono count + `导出记录 / 新建合集` action buttons; `.ac-grid-3` of clip cards (16:9 thumb, score tag top-right, time tag bottom-left, 2-line clamped title, footer meta + text actions).
- A settings strip of controls mirroring the real selectors: **template** pills (`editorial / street / news / cinema / classic`), **subtitle font/style** tiles (`clean / bold / box / accent`, each with a sample line), **aspect ratio** segmented (`原画幅 / 9:16 / 16:9`), plus 字幕/原声 switches. Wire to `app.js` state; `重新渲染` button shows the 4px progress line then updates the card — matches `导出成片` re-render behavior.

**Page (c) `editor.html` — trim / hook / caption controls**
- Two-column grid: left sticky player (`position:sticky; top:84px`) with a `16:9` or `9:16` video frame, caption overlay styled from `studio.css:76-82`, hook overlay, a simple play/seek bar, and a `调整镜头` disclosure listing scenes with **起点/终点 (seconds)** number inputs + 替换/上移/下移/移除 (the trim controls).
- Right settings column: one stack of `Row`s (label left, control right, hairline bottom) exactly as `DraftSettingsPanel.tsx`: 成片名称 input; 字幕 switch + 字幕样式 tiles; 原声 switch; 画幅 segmented; 构图 segmented; 片头文字 textarea + 片头样式 tiles; 文字语言 select. 
- Top actions `另存为新版本 / 保存草稿 / 导出成片` (CTA = ink pill); show `ProgressLine` while "rendering" in `app.js`.

**Fidelity checklist**: same palette tokens; spacing rhythm 4/8/16/24/32/40/56; card radius 16, small 10, pills 999; hairline `1px var(--ac-line)` borders + `--ac-shadow` only on hover; Geist sans / Instrument Serif wordmark / Geist Mono numbers; accent `#2D6BFF` used only for progress/active/link; single top nav (no sidebar), in-page back links; no gradients, no colorful chips, no emoji, no pure black. Keep all copy strings in a small `i18n` object so additional locales can be layered in later (the original ships 8 locales).
