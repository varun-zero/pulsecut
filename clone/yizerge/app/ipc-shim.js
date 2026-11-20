/* Browser shim for YIZERGE's Electron preload API (window.api).
   Reconstructed from out/preload/index.js recovered by REA from app.asar.
   State is local to the browser; no native engine is available here. */
(() => {
  const KEY = 'yizerge_clone_state_v16';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };
  const listeners = {};

  const RAW = new Set(['beta:status','window:isFullscreen','os:user','version','engine:call','ping']);
  const wrap = (ch, v) => RAW.has(ch) || (v && typeof v === 'object' && 'ok' in v) ? v : { ok: true, data: v };
  // Authentic seed values recovered from the real app's autosave.json
  // (%APPDATA%\YIZERGE\autosave.json), copied to seed/autosave.json in this clone.
  const REAL = { name: 'My Project', duration: 34.617917, width: 1080, height: 1920 };
  const project = { id: 'prj-demo', name: REAL.name, workspace: 'default', created: Date.now(), updated: Date.now() };
  const defaults = {
    'workspaces:list': [{ id: 'default', name: 'My Workspace' }],
    'projects:all': [project], 'projects:list': [project],
    'source:pick': 'media/demo.mp4',
    'source:get': { id: 'src-demo', name: 'demo.mp4', path: 'media/demo.mp4', duration: REAL.duration, width: REAL.width, height: REAL.height },
    'clips:get': [{ id: 'clip-1', name: 'Clip 1', start: 0, end: REAL.duration }],
    'tracks:get': { video: [], audio: [] },
    'subs:get': { cues: [], style: {} },
    'music:get': { name: null, duration: 0, volume: 0.15, peak: 0.85, offset: 0, riser: 5, levels: { volume: 0.15, vol: 0.15, peak: 0.85, offset: 0, riser: 5, segments: [] } },
    'music:levels': { vol: 0.15, peak: 0.85, offset: 0, riser: 5, segments: [] },
    'backdrop:get': { mode: 'color', color: '#09090B' },
    'watermark:get': { mode: 'off', text: null, preset: 'none',
      x: 92, y: 88, scale: 18, opacity: 0.8,
      position: { x: 92, y: 88 },
      tagPlacement: { x: 50, y: 90, opacity: 0.85 },
      social: { mode: 'template', preset: 'none' },
      icon: null },
    'outro:get': { mode: 'template', name: null, enabled: false,
      card: { enabled: false, size: 260, radius: 0, bg: '#FFFFFF', text: 'Follow for more',
        font: 'Inter', color: '#0F1419', fontSize: 28, bold: true, italic: false,
        duration: 3.5, anim: 1.2, words: {} }, picture: null },
    'template:get': { id: 'twitter_light', name: 'X / Twitter (Light)', theme: 'light', enabled: true, preset: 'twitter', hook: 'WAIT FOR IT', handle: '@alexrivera', displayName: 'Alex Rivera', verified: true, font: 'Poppins', size: 34, radius: 24 },
    'presets:list': [], 'trash:list': [],
    'fonts:list': [
      { family: 'Geist', name: 'Geist' },
      { family: 'Instrument Serif', name: 'Instrument Serif' },
      { family: 'Inter', name: 'Inter' }
    ],
    'sfx:list': [], 'version': '1.3.0', 'engine:call': '1.3.0',
    'beta:status': { active: false, locked: false },
    'os:user': 'Local', 'autosave:check': { ok: true, data: null }
  };

  function emit(channel, payload) {
    (listeners[channel] || []).forEach(fn => { try { fn({}, payload); } catch (_) {} });
  }
  window.__yzEmit = emit;

  async function bridge(channel, ...args) {
    if (channel === 'autosave:check') delete state[channel];
    if (channel in state && state[channel] !== null) return wrap(channel, state[channel]);
    if (channel in defaults) {
      const d = defaults[channel];
      return wrap(channel, typeof d === 'function' ? d(...args) : d);
    }
    // Media getters used directly as image src must yield null, not an object
    if (/:(picture|icon|avatar)$/.test(channel)) return { ok: true, data: null };
    if (/:(get|levels|style|cues|status)$/.test(channel)) {
      return wrap(channel, { mode: 'template', enabled: false, name: null, isImage: false,
        length: 0, duration: 3.5, data: {}, cues: [], style: {}, position: { x: 50, y: 50 },
        volume: 0.15, peak: 0.85, offset: 0, riser: 5 });
    }
    if (/^(source|projects|clips|tracks|subs|music|backdrop|watermark|outro|template|presets|sfx|autosave|trash|workspaces|export|slotMedia):/.test(channel)) {
      const last = args[args.length - 1];
      if (last !== undefined && typeof last === 'object' && !Array.isArray(last)) {
        state[channel] = last; save();
      }
      return { ok: true, data: last ?? null };
    }
    if (/Url$/.test(channel) || channel === 'mediaUrl') return '';
    if (/^on[A-Z]/.test(channel)) return () => () => {};
    return { ok: true };
  }

  const topLevel = {
    ping: () => bridge('ping'),
    isFullscreen: async () => !!document.fullscreenElement,
    toggleFullscreen: () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(),
    onFullscreen: fn => reg('window:fullscreen', fn),
    onSaving: fn => reg('project:saving', fn),
    onMenu: fn => reg('menu', fn),
    onBetaLockout: fn => reg('beta:lockout', fn),
    overlay: () => bridge('window:overlay'),
    quit: () => bridge('app:quit'),
    mac: /Mac/i.test(navigator.platform),
    user: () => bridge('os:user'),
    version: () => bridge('version'),
    engineVersion: () => bridge('engine:call', 'version'),
    openExternal: url => { window.open(url, '_blank', 'noopener'); return { ok: true }; },
    betaStatus: () => bridge('beta:status'),
    pathOf: () => ''
  };

  const channelFor = (g, m) => `${g}:${m}`;
  function reg(channel, fn) {
    (listeners[channel] = listeners[channel] || []).push(fn);
    return () => { listeners[channel] = (listeners[channel] || []).filter(x => x !== fn); };
  }

  const groups = ['workspaces','projects','autosave','source','clips','tracks','exporter','fonts','subs','music','backdrop','slotMedia','sfx','watermark','outro','template','presets','trash'];
  const groupMap = {
    workspaces: ['list','create','rename','remove'],
    projects: ['list','all','create','rename','duplicate','remove','reveal','copyPath','save','saveAs','open','status'],
    autosave: ['check','discard'],
    source: ['get','pick','attach','fetch','remove','onProgress','pathOf'],
    clips: ['get','save','inherit'],
    tracks: ['get','set'],
    exporter: ['start','cancel','pickFolder','reveal','open','revealLast','onProgress'],
    fonts: ['list','get','have'],
    subs: ['get','pick','remove','style','cues'],
    music: ['get','pick','remove','levels','suggest'],
    backdrop: ['get','pick','remove'],
    slotMedia: ['pick','remove'],
    sfx: ['list','import','remove'],
    watermark: ['get','pick','remove','place','social','setSocial','icon','pickIcon','removeIcon'],
    outro: ['get','pick','remove','set','setCard','picture','pickPicture','removePicture'],
    template: ['get','set','avatar','pickAvatar','removeAvatar'],
    presets: ['list','save','remove'],
    trash: ['list','restore','wipe','empty']
  };

  const api = { ...topLevel };
  for (const g of groups) {
    api[g] = {};
    for (const m of groupMap[g]) {
      api[g][m] = (...args) => {
        if (m === 'onProgress') return reg(`${g === 'exporter' ? 'export' : g}:progress`, args[0]);
        if (m === 'pathOf') return '';
        if (channelFor(g, m) in defaults) return bridge(channelFor(g, m), ...args);
        if (m.startsWith('pick') || m === 'open') { if (g === 'projects' && m === 'open') return bridge('projects:open'); return null; }
        return bridge(`${g}:${m}`, ...args);
      };
    }
  }
  // Preload defines these as synchronous clip:// string builders (not async invoke).
  // clip:// was rewritten to /clip/ in the bundle; serve identical proxy paths here.
  api.mediaUrl = () => 'media/demo.mp4';
  api.slotMediaUrl = (proj, clip, name) => `/clip/slot/${encodeURIComponent(proj||'')}/${encodeURIComponent(clip||'')}?v=${encodeURIComponent(name||'0')}`;
  api.sfxUrl = (proj, name) => `/clip/sfx/${encodeURIComponent(proj||'')}/${encodeURIComponent(name||'0')}`;

  window.api = api;
  window.process = window.process || { platform: 'win32', env: {} };

  // The original bundle preloads a few images with new Image(); src = <getter result>.
  // In Electron those getters return clip:// strings; a few unseeded states yield an
  // object here. Sanitise object-valued image src to a transparent pixel so no
  // spurious network/404 noise remains. Native media is proxied by server.mjs.
  const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true, enumerable: desc.enumerable,
        get() { return desc.get.call(this); },
        set(v) {
          let out = v;
          if (v && typeof v === 'object') out = (v.data && typeof v.data === 'string') ? v.data : TRANSPARENT;
          else if (v == null || String(v).includes('[object Object]')) out = TRANSPARENT;
          return desc.set.call(this, out);
        }
      });
    }
  } catch (_) {}
})();
