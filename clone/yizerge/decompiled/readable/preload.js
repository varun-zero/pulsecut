let e = require("electron");
var t = (t, ...n) => e.ipcRenderer.invoke(t, ...n),
  n = {
    ping: () => e.ipcRenderer.invoke(`ping`),
    isFullscreen: () => e.ipcRenderer.invoke(`window:isFullscreen`),
    toggleFullscreen: () => e.ipcRenderer.send(`window:toggleFullscreen`),
    onFullscreen: t => {
      let n = (e, n) => t(n);
      return e.ipcRenderer.on(`window:fullscreen`, n), () => {
        e.ipcRenderer.removeListener(`window:fullscreen`, n)
      }
    },
    onSaving: t => {
      let n = (e, n) => t(n);
      return e.ipcRenderer.on(`project:saving`, n), () => {
        e.ipcRenderer.removeListener(`project:saving`, n)
      }
    },
    onMenu: t => {
      let n = (e, n) => t(n);
      return e.ipcRenderer.on(`menu`, n), e.ipcRenderer.send(`menu:ready`), () => {
        e.ipcRenderer.removeListener(`menu`, n)
      }
    },
    overlay: (t, n) => e.ipcRenderer.send(`window:overlay`, t, n),
    quit: () => e.ipcRenderer.send(`app:quit`),
    mac: process.platform === `darwin`,
    user: () => e.ipcRenderer.invoke(`os:user`),
    version: () => e.ipcRenderer.invoke(`app:version`),
    openExternal: t => e.ipcRenderer.invoke(`app:openExternal`, t),
    betaStatus: () => e.ipcRenderer.invoke(`beta:status`),
    onBetaLockout: t => {
      let n = (e, n) => t(n);
      return e.ipcRenderer.on(`beta:lockout`, n), () => {
        e.ipcRenderer.removeListener(`beta:lockout`, n)
      }
    },
    engineVersion: () => e.ipcRenderer.invoke(`engine:call`, `version`),
    workspaces: {
      list: () => t(`workspaces:list`),
      create: e => t(`workspaces:create`, e),
      rename: (e, n) => t(`workspaces:rename`, e, n),
      remove: e => t(`workspaces:remove`, e)
    },
    projects: {
      list: e => t(`projects:list`, e),
      all: () => t(`projects:all`),
      create: (e, n, r, i) => t(`projects:create`, e, n, r, i),
      rename: (e, n, r) => t(`projects:rename`, e, n, r),
      duplicate: (e, n) => t(`projects:duplicate`, e, n),
      remove: (e, n) => t(`projects:remove`, e, n),
      reveal: (e, n) => t(`projects:reveal`, e, n),
      copyPath: (e, n) => t(`projects:copyPath`, e, n),
      save: (e, n) => t(`projects:save`, e, n),
      saveAs: (e, n) => t(`projects:saveAs`, e, n),
      open: () => t(`projects:open`),
      status: (e, n) => t(`projects:status`, e, n)
    },
    autosave: {
      check: () => t(`autosave:check`),
      discard: () => t(`autosave:discard`)
    },
    source: {
      get: (e, n) => t(`source:get`, e, n),
      pick: () => t(`source:pick`),
      attach: (e, n, r) => t(`source:attach`, e, n, r),
      fetch: (e, n, r) => t(`source:fetch`, e, n, r),
      remove: (e, n) => t(`source:remove`, e, n),
      onProgress: t => {
        let n = (e, n) => t(n);
        return e.ipcRenderer.on(`source:progress`, n), () => {
          e.ipcRenderer.removeListener(`source:progress`, n)
        }
      },
      pathOf: t => e.webUtils.getPathForFile(t)
    },
    clips: {
      get: (e, n) => t(`clips:get`, e, n),
      save: (e, n, r) => t(`clips:save`, e, n, r),
      inherit: (e, n) => t(`clips:inherit`, e, n)
    },
    tracks: {
      get: (e, n) => t(`tracks:get`, e, n),
      set: (e, n, r) => t(`tracks:set`, e, n, r)
    },
    mediaUrl: (e, t, n) => `clip://source/${encodeURIComponent(e)}/${encodeURIComponent(t)}?v=${n}`,
    exporter: {
      start: (e, n, r, i) => t(`export:start`, e, n, r, i),
      cancel: (e, n, r) => t(`export:cancel`, e, n, r),
      pickFolder: () => t(`export:folder`),
      reveal: e => t(`export:reveal`, e),
      open: e => t(`export:open`, e),
      revealLast: () => t(`export:last`),
      onProgress: t => {
        let n = (e, n) => t(n);
        return e.ipcRenderer.on(`export:progress`, n), () => {
          e.ipcRenderer.removeListener(`export:progress`, n)
        }
      }
    },
    fonts: {
      list: () => t(`fonts:list`),
      get: (e, n = []) => t(`fonts:get`, e, n),
      have: e => t(`fonts:have`, e)
    },
    subs: {
      get: (e, n) => t(`subs:get`, e, n),
      pick: (e, n) => t(`subs:pick`, e, n),
      remove: (e, n) => t(`subs:remove`, e, n),
      style: (e, n, r) => t(`subs:style`, e, n, r),
      cues: (e, n, r) => t(`subs:cues`, e, n, r)
    },
    music: {
      get: (e, n) => t(`music:get`, e, n),
      pick: (e, n) => t(`music:pick`, e, n),
      remove: (e, n) => t(`music:remove`, e, n),
      levels: (e, n, r) => t(`music:levels`, e, n, r),
      suggest: (e, n, r, i) => t(`music:suggest`, e, n, r, i)
    },
    backdrop: {
      get: (e, n) => t(`backdrop:get`, e, n),
      pick: (e, n, r) => t(`backdrop:pick`, e, n, r),
      remove: (e, n) => t(`backdrop:remove`, e, n)
    },
    slotMedia: {
      pick: (e, n, r) => t(`slotMedia:pick`, e, n, r),
      remove: (e, n, r, i) => t(`slotMedia:remove`, e, n, r, i)
    },
    slotMediaUrl: (e, t, n, r) => `clip://slotmedia/${encodeURIComponent(e)}/${encodeURIComponent(t)}?id=${encodeURIComponent(n)}&ext=${encodeURIComponent(r)}`,
    sfx: {
      list: (e, n) => t(`sfx:list`, e, n),
      import: (e, n) => t(`sfx:import`, e, n),
      remove: (e, n, r) => t(`sfx:remove`, e, n, r)
    },
    sfxUrl: (e, t, n, r) => `clip://sfx/${encodeURIComponent(e)}/${encodeURIComponent(t)}?id=${encodeURIComponent(n)}&ext=${encodeURIComponent(r)}`,
    watermark: {
      get: (e, n) => t(`watermark:get`, e, n),
      pick: (e, n) => t(`watermark:pick`, e, n),
      remove: (e, n) => t(`watermark:remove`, e, n),
      place: (e, n, r) => t(`watermark:place`, e, n, r),
      social: (e, n) => t(`watermark:social`, e, n),
      setSocial: (e, n, r) => t(`watermark:setSocial`, e, n, r),
      icon: (e, n) => t(`watermark:icon`, e, n),
      pickIcon: (e, n) => t(`watermark:pickIcon`, e, n),
      removeIcon: (e, n) => t(`watermark:removeIcon`, e, n)
    },
    outro: {
      get: (e, n) => t(`outro:get`, e, n),
      pick: (e, n) => t(`outro:pick`, e, n),
      remove: (e, n) => t(`outro:remove`, e, n),
      set: (e, n, r) => t(`outro:set`, e, n, r),
      setCard: (e, n, r) => t(`outro:setCard`, e, n, r),
      picture: (e, n) => t(`outro:picture`, e, n),
      pickPicture: (e, n) => t(`outro:pickPicture`, e, n),
      removePicture: (e, n) => t(`outro:removePicture`, e, n)
    },
    template: {
      get: (e, n) => t(`template:get`, e, n),
      set: (e, n, r) => t(`template:set`, e, n, r),
      avatar: (e, n) => t(`template:avatar`, e, n),
      pickAvatar: (e, n) => t(`template:pickAvatar`, e, n),
      removeAvatar: (e, n) => t(`template:removeAvatar`, e, n)
    },
    presets: {
      list: () => t(`presets:list`),
      save: (e, n, r) => t(`presets:save`, e, n, r),
      remove: e => t(`presets:remove`, e)
    },
    trash: {
      list: () => t(`trash:list`),
      restore: e => t(`trash:restore`, e),
      wipe: e => t(`trash:wipe`, e),
      empty: () => t(`trash:empty`)
    }
  };
e.contextBridge.exposeInMainWorld(`api`, n);