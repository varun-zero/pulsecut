var e = Object.create,
  t = Object.defineProperty,
  n = Object.getOwnPropertyDescriptor,
  r = Object.getOwnPropertyNames,
  i = Object.getPrototypeOf,
  a = Object.prototype.hasOwnProperty,
  o = (e, i, o, s) => {
    if (i && typeof i == `object` || typeof i == `function`)
      for (var c = r(i), l = 0, u = c.length, d; l < u; l++) d = c[l], !a.call(e, d) && d !== o && t(e, d, {
        get: (e => i[e]).bind(null, d),
        enumerable: !(s = n(i, d)) || s.enumerable
      });
    return e
  },
  s = (n, r, s) => (s = n == null ? {} : e(i(n)), o(r || !n || !n.__esModule || !a.call(n, `default`) ? t(s, `default`, {
    value: n,
    enumerable: !0
  }) : s, n));
let c = require("electron"),
  l = require("node:path"),
  u = require("node:child_process"),
  d = require("node:os");
d = s(d);
let f = require("node:readline"),
  p = require("node:fs"),
  m = require("node:stream"),
  h = require("node:fs/promises");
var g = (0, l.join)(c.app.getPath(`userData`), `fonts`),
  _ = [`Geist`, `Instrument Serif`],
  v = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u,
  y = [{
    family: `Bebas Neue`,
    category: `Display`,
    weights: [400]
  }, {
    family: `Inter`,
    category: `Sans Serif`,
    weights: [400, 600, 700]
  }, {
    family: `Montserrat`,
    category: `Sans Serif`,
    weights: [400, 600, 700]
  }, {
    family: `Poppins`,
    category: `Sans Serif`,
    weights: [400, 600, 700]
  }],
  ee = (0, l.join)(g, `list.json`),
  te = (0, l.join)(g, `system-fonts.json`),
  b = [400, 600, 700],
  x = e => typeof e == `number` && Number.isInteger(e) && e >= 100 && e <= 900 ? e : null,
  ne = new TextDecoder(`utf-16be`),
  re = new TextDecoder(`windows-1252`);

function S(e, t, n) {
  let r = Buffer.alloc(12);
  C(e, r, 0, 12, t);
  let i = r.readUInt32BE(0);
  if (i !== 65536 && i !== 1330926671) return null;
  let a = r.readUInt16BE(4),
    o = Buffer.alloc(a * 16);
  C(e, o, 0, a * 16, t + 12);
  let s = 0,
    c = 0,
    l = 0,
    u = 0;
  for (let e = 0; e < a; e++) {
    let t = o.toString(`ascii`, e * 16, e * 16 + 4);
    t === `name` && (s = o.readUInt32BE(e * 16 + 8), c = o.readUInt32BE(e * 16 + 12)), t === `OS/2` && (l = o.readUInt32BE(e * 16 + 8), u = o.readUInt32BE(e * 16 + 12))
  }
  if (!s) return null;
  let d = Buffer.alloc(Math.min(c, 65536));
  C(e, d, 0, d.length, s);
  let f = d.readUInt16BE(2),
    p = d.readUInt16BE(4),
    m = ``,
    h = ``;
  for (let e = 0; e < f; e++) {
    let t = 6 + e * 12;
    if (t + 12 > d.length) break;
    let n = d.readUInt16BE(t),
      r = d.readUInt16BE(t + 6),
      i = d.readUInt16BE(t + 8),
      a = p + d.readUInt16BE(t + 10);
    if (a + i > d.length) continue;
    let o = d.subarray(a, a + i),
      s = ``;
    n === 3 || n === 0 ? s = ne.decode(o) : n === 1 && (s = re.decode(o)), s = s.replace(/\0/g, ``).trim(), r === 1 && !m && s && (m = s), r === 16 && s && (h = s)
  }
  let g = 400,
    _ = !1;
  if (l) {
    let t = Buffer.alloc(Math.min(u, 68));
    C(e, t, 0, t.length, l), t.length >= 6 && (g = t.readUInt16BE(4)), t.length >= 64 && (_ = !!(t.readUInt16BE(62) & 1))
  }
  let y = h || m;
  return !y || !v.test(y) ? null : (g < 100 && (g = 400), g > 900 && (g = 900), {
    family: y,
    weight: g,
    italic: _,
    sfntOffset: t
  })
}

function C(e, t, n, r, i) {
  let a = 0;
  for (; a < r;) {
    let o = (0, p.readSync)(e, t, n + a, r - a, i + a);
    if (o === 0) break;
    a += o
  }
}

function w(e) {
  let t;
  try {
    t = (0, p.openSync)(e, `r`);
    let n = Buffer.alloc(12);
    if (C(t, n, 0, 12, 0), n.toString(`ascii`, 0, 4) === `ttcf`) {
      let r = n.readUInt32BE(8),
        i = Buffer.alloc(r * 4);
      C(t, i, 0, r * 4, 12);
      let a = [];
      for (let n = 0; n < r; n++) {
        let r = i.readUInt32BE(n * 4),
          o = S(t, r, e);
        o && a.push(o)
      }
      return a
    }
    let r = S(t, 0, e);
    return r ? [r] : []
  } catch {
    return []
  } finally {
    t !== void 0 && (0, p.closeSync)(t)
  }
}

function T(e, t) {
  let n = (0, p.openSync)(e, `r`);
  try {
    let e = Buffer.alloc(12);
    C(n, e, 0, 12, t);
    let r = e.readUInt16BE(4),
      i = Buffer.alloc(r * 16);
    C(n, i, 0, r * 16, t + 12);
    let a = 12 + r * 16,
      o = 0,
      s = [];
    for (let e = 0; e < r; e++) {
      let t = i.toString(`ascii`, e * 16, e * 16 + 4),
        n = i.readUInt32BE(e * 16 + 4),
        r = i.readUInt32BE(e * 16 + 8),
        a = i.readUInt32BE(e * 16 + 12),
        c = a + 3 & -4;
      s.push({
        tag: t,
        checkSum: n,
        offset: r,
        length: a,
        paddedLength: c
      }), o += c
    }
    let c = Buffer.alloc(a + o);
    e.copy(c, 0, 0, 12);
    let l = a;
    for (let e = 0; e < r; e++) {
      let t = s[e];
      c.write(t.tag, 12 + e * 16, 4, `ascii`), c.writeUInt32BE(t.checkSum, 12 + e * 16 + 4), c.writeUInt32BE(l, 12 + e * 16 + 8), c.writeUInt32BE(t.length, 12 + e * 16 + 12), C(n, c, l, t.length, t.offset), l += t.paddedLength
    }
    return c
  } finally {
    (0, p.closeSync)(n)
  }
}

function ie() {
  let e = [];
  if (process.platform === `win32`) {
    let t = process.env.WINDIR || process.env.SYSTEMROOT || `C:\\Windows`;
    e.push((0, l.join)(t, `Fonts`)), process.env.LOCALAPPDATA && e.push((0, l.join)(process.env.LOCALAPPDATA, `Microsoft`, `Windows`, `Fonts`))
  } else process.platform === `darwin` ? (e.push(`/System/Library/Fonts`), e.push(`/System/Library/Fonts/Supplemental`), e.push(`/Library/Fonts`), e.push((0, l.join)(d.default.homedir(), `Library`, `Fonts`))) : e.push(`/usr/share/fonts`, `/usr/local/share/fonts`, (0, l.join)(d.default.homedir(), `.local`, `share`, `fonts`), (0, l.join)(d.default.homedir(), `.fonts`));
  return e
}
var ae = null;
async function oe() {
  let e = ie(),
    t = new Map,
    n = e => {
      if (!(0, p.existsSync)(e)) return;
      let t = [];
      try {
        t = (0, p.readdirSync)(e)
      } catch {
        return
      }
      for (let n of t) {
        let t = (0, l.join)(e, n),
          i = !1;
        try {
          i = (0, p.statSync)(t).isDirectory()
        } catch {
          continue
        }
        if (i) {
          try {
            let e = (0, p.readdirSync)(t);
            for (let n of e) {
              let e = (0, l.extname)(n).toLowerCase();
              (e === `.ttf` || e === `.otf` || e === `.ttc`) && r((0, l.join)(t, n))
            }
          } catch {}
          continue
        }
        let a = (0, l.extname)(n).toLowerCase();
        (a === `.ttf` || a === `.otf` || a === `.ttc`) && r(t)
      }
    },
    r = e => {
      let n = w(e);
      for (let r of n) {
        if (_.includes(r.family)) continue;
        t.has(r.family) || t.set(r.family, {
          family: r.family,
          category: `System`,
          weights: new Set,
          variants: []
        });
        let n = t.get(r.family);
        r.italic || n.weights.add(r.weight), n.variants.push({
          weight: r.weight,
          italic: r.italic,
          path: e,
          sfntOffset: r.sfntOffset
        })
      }
    };
  for (let t of e) n(t);
  let i = [];
  for (let e of t.values()) {
    let t = [...e.weights].sort((e, t) => e - t);
    i.push({
      family: e.family,
      category: `System`,
      weights: t.length ? t : [400],
      variants: e.variants
    })
  }
  i.sort((e, t) => e.family.localeCompare(t.family));
  try {
    await p.promises.writeFile(te, JSON.stringify(i))
  } catch {}
  return i
}

function E() {
  return ae ??= (async () => {
    let e = await p.promises.readFile(te, `utf8`).then(e => JSON.parse(e), () => null);
    return e && e.length ? (oe().then(e => {
      ae = Promise.resolve(e)
    }).catch(() => void 0), e) : oe()
  })().catch(e => {
    throw ae = null, e
  })
}
var se = null;
async function ce() {
  await p.promises.mkdir(g, {
    recursive: !0
  });
  let e = c.app.isPackaged ? (0, l.join)(process.resourcesPath, `engine`, `fonts`) : (0, l.join)(c.app.getAppPath(), `..`, `..`, `engine`, `fonts`);
  for (let t of await p.promises.readdir(e).catch(() => [])) await p.promises.copyFile((0, l.join)(e, t), (0, l.join)(g, t)).catch(() => void 0);
  E().catch(() => void 0), le().catch(() => void 0)
}
var le = () => se ??= (async () => {
    let e = await p.promises.readFile(ee, `utf8`).then(e => JSON.parse(e), () => null);
    if (e?.length) return e;
    let t = await (await fetch(`https://fonts.google.com/metadata/fonts`)).text(),
      n = JSON.parse(t.slice(t.indexOf(`{`))).familyMetadataList.filter(e => v.test(e.family) && !_.includes(e.family)).sort((e, t) => e.popularity - t.popularity).map(e => ({
        family: e.family,
        category: e.category,
        styles: Object.keys(e.fonts)
      }));
    return await p.promises.writeFile(ee, JSON.stringify(n)), n
  })().catch(e => {
    throw se = null, e
  }),
  ue = e => [...new Set(e.styles.filter(e => !e.endsWith(`i`)).map(e => parseInt(e)))].sort((e, t) => e - t),
  D = e => e.replace(/ /g, ``),
  O = (e, t, n) => (0, l.join)(g, `${D(e)}-${t}${n?`i`:``}.ttf`),
  k = (e, t) => e.reduce((e, n) => Math.abs(n - t) < Math.abs(e - t) ? n : e);
async function A(e) {
  let t = RegExp(`^${D(e)}-(\\d+)(i?)\\.ttf$`),
    n = (await p.promises.readdir(g).catch(() => [])).map(e => e.match(t)).filter(e => !!e);
  return Promise.all(n.map(async e => ({
    weight: +e[1],
    italic: !!e[2],
    data: new Uint8Array(await p.promises.readFile((0, l.join)(g, e[0])))
  })))
}
async function de(e, t = []) {
  if (_.includes(e)) return [];
  if (!v.test(e)) throw Error(`That font name doesn’t look right`);
  let n = [...b, ...t.map(x).filter(e => e !== null)],
    r = (await E().catch(() => [])).find(t => t.family.toLowerCase() === e.toLowerCase());
  if (r && r.variants.length) {
    let t = [];
    for (let e of [!1, !0]) {
      let i = r.variants.filter(t => t.italic === e),
        a = i.length ? i : r.variants,
        o = [...new Set(a.map(e => e.weight))];
      for (let r of new Set(n.map(e => k(o, e)))) {
        let n = a.reduce((e, t) => Math.abs(t.weight - r) < Math.abs(e.weight - r) ? t : e);
        t.push({
          w: r,
          italic: e,
          variant: n
        })
      }
    }
    return await Promise.all(t.map(async t => {
      let n = O(e, t.w, t.italic);
      if (!await p.promises.stat(n).catch(() => null)) {
        if (t.variant.sfntOffset === 0 && (t.variant.path.endsWith(`.ttf`) || t.variant.path.endsWith(`.otf`))) await p.promises.copyFile(t.variant.path, n);
        else {
          let e = T(t.variant.path, t.variant.sfntOffset);
          await p.promises.writeFile(n, e)
        }
      }
    })), Promise.all(t.map(async t => ({
      weight: t.w,
      italic: t.italic,
      data: new Uint8Array(await p.promises.readFile(O(e, t.w, t.italic)))
    })))
  }
  let i = await le().then(t => t.find(t => t.family === e), () => void 0);
  if (!i) {
    let t = await A(e);
    if (t.length) return t;
    throw Error(`Couldn’t load “${e}”`)
  }
  let a = [];
  for (let e of [!1, !0]) {
    let t = [...new Set(i.styles.filter(t => t.endsWith(`i`) === e).map(e => parseInt(e)))];
    if (t.length)
      for (let r of new Set(n.map(e => k(t, e)))) a.push({
        w: r,
        italic: e
      })
  }
  let o = (await Promise.all(a.map(async t => await p.promises.stat(O(e, t.w, t.italic)).catch(() => null) ? null : t))).filter(e => !!e);
  if (o.length) {
    let t = o.map(e => `${+!!e.italic},${e.w}`).sort().join(`;`),
      n = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(e)}:ital,wght@${t}`)).text(),
      r = new Map;
    for (let e of n.split(`@font-face`).slice(1)) {
      let t = e.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)?.[1],
        n = e.match(/font-weight:\s*(\d+)/)?.[1];
      t && n && r.set(`${+!!/font-style:\s*italic/.test(e)},${n}`, t)
    }
    for (let t of o) {
      let n = r.get(`${+!!t.italic},${t.w}`);
      if (!n) throw Error(`Couldn’t download “${e}”`);
      let i = await fetch(n);
      if (!i.ok) throw Error(`Couldn’t download “${e}”`);
      await p.promises.writeFile(O(e, t.w, t.italic), Buffer.from(await i.arrayBuffer()))
    }
  }
  return Promise.all(a.map(async t => ({
    weight: t.w,
    italic: t.italic,
    data: new Uint8Array(await p.promises.readFile(O(e, t.w, t.italic)))
  })))
}

function fe() {
  let e = {
    "fonts:list": async () => {
      let e = await E().catch(() => []),
        t = new Set(e.map(e => e.family.toLowerCase())),
        n = e.map(e => ({
          family: e.family,
          category: `System`,
          weights: e.weights
        })),
        r = await le().catch(() => null),
        i = (r ? r.map(e => ({
          family: e.family,
          category: e.category,
          weights: ue(e)
        })) : y).filter(e => !t.has(e.family.toLowerCase()));
      return [...n, ...i]
    },
    "fonts:have": async (e, t) => {
      let n = RegExp(`^${D(String(t))}-(\\d+)\\.ttf$`);
      return (await p.promises.readdir(g).catch(() => [])).map(e => e.match(n)?.[1]).filter(e => !!e).map(Number)
    },
    "fonts:get": (e, t, n) => de(String(t), Array.isArray(n) ? n : [])
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var j = null,
  M = 1,
  pe = new Map;

function me() {
  let e = process.platform === `win32`,
    t = e ? `win` : `mac`,
    n = e ? `engine.exe` : `engine`,
    r = (0, l.join)(process.resourcesPath, `bin`, t),
    i = (0, l.join)(c.app.getAppPath(), `..`, `..`, `resources`, `bin`, t),
    a = c.app.isPackaged ? (0, p.existsSync)(r) ? r : `` : (0, p.existsSync)(i) ? i : ``,
    o = (0, l.join)(process.resourcesPath, `bin`, t, n),
    s = (0, l.join)(process.resourcesPath, `engine`, n),
    d = (0, l.join)(i, n),
    m = null;
  c.app.isPackaged ? (0, p.existsSync)(o) ? m = o : (0, p.existsSync)(s) && (m = s) : (0, p.existsSync)(d) && (m = d);
  let h = e ? process.env.PATH : [`/opt/homebrew/bin`, `/usr/local/bin`, process.env.PATH].filter(Boolean).join(`:`),
    _ = a ? e ? `${a};${h}` : `${a}:${h}` : h,
    v = {
      ...process.env,
      PATH: _,
      YIZERGE_BIN_DIR: a,
      CLIPPIFY_FONTS: g,
      YIZERGE_FONTS: g
    };
  if (m) console.log(`[engine] Spawning standalone engine binary:`, m), j = (0, u.spawn)(m, [], {
    env: v,
    detached: !e
  });
  else {
    let t = c.app.isPackaged ? (0, l.join)(process.resourcesPath, `engine`, `server.py`) : (0, l.join)(c.app.getAppPath(), `..`, `..`, `engine`, `server.py`);
    console.log(`[engine] Spawning host Python script:`, t), j = (0, u.spawn)(e ? `python` : `python3`, [`-u`, t], {
      env: v,
      detached: !e
    })
  }(0, f.createInterface)({
    input: j.stdout
  }).on(`line`, e => {
    let t;
    try {
      t = JSON.parse(e)
    } catch {
      return console.error(`[engine] not JSON:`, e)
    }
    if (`event` in t) return pe.get(t.job)?.onEvent?.(t);
    let n = pe.get(t.id);
    n && (pe.delete(t.id), t.error ? n.reject(Error(t.error)) : n.resolve(t.result))
  }), j.stderr.on(`data`, e => console.error(`[engine]`, e.toString().trim())), j.on(`error`, e => console.error(`[engine] error:`, e)), j.on(`exit`, e => console.log(`[engine] exited`, e))
}

function N(e, t = {}, n) {
  if ((!j || j.exitCode !== null || j.killed) && me(), !j) return Promise.reject(Error(`engine not started`));
  let r = M++;
  return new Promise((i, a) => {
    pe.set(r, {
      resolve: i,
      reject: a,
      onEvent: n
    }), j.stdin.write(JSON.stringify({
      id: r,
      method: e,
      params: t
    }) + `
`)
  })
}

function he() {
  if (j?.pid) {
    if (process.platform === `win32`)(0, u.spawn)(`taskkill`, [`/F`, `/T`, `/PID`, String(j.pid)]);
    else try {
      process.kill(-j.pid, `SIGKILL`)
    } catch {
      j.kill()
    }
  }
  j = null
}
var P = null,
  ge = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YIZERGE</title>
  <style>
    @font-face {
      font-family: 'Google Sans Variable';
      font-style: normal;
      font-display: swap;
      font-weight: 400 700;
      src: url('data:font/woff2;base64,d09GMgABAAAAACOoABUAAAAATIgAACM1AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGYNuGoEqG6RIHIIiP0hWQVKBWgZgP1NUQVSBFCcaAIFqLzwRCAqsWKNeC4FcADCjHgE2AiQDgzQEIAWGTAeHLgwHG8JFJezYRLgdQCLq/mUbRT2UnMQoSidnlez/vyaoIWM82j2wzbIcO4qG8ngqsGcR7sa19wyMvW2qwmfGMIhjx76Jz+kgHv0++hPfV9f7wpJW4iWbx4dLrTjjLq84dPytrnD64/KQzbGulI30zlC21WLE5UooJXA42lFEiR2AGGSyb3iVvl2V+F+Z9ZX3jpOOkGS2heeJLvs/t6oa6fTA4awSz0JwPwD8wkBWk20u3547HFoCGsB4hHFIxlf4hofn9/ff2ufeP+OHNGCiMpgkNiNTefq4NHfynSHatCbJpmLUokSIFBFfNMAqsBCIkmSRFiJWUU1NlRNLey8u6aTOVJ6Yto5dy1O3TXZh2Hv7D+PfXmIH2EHQy7LfUSz6+bZ9f4zEBuVSEhev0oKYE52rH7tMZ2a9/VXLmo5XKfRPa/omZHSE/sKFwQG33b3jAApj6kdznzOBazsvW0JyZA92N/ARhTq2iS0KSayAyM+/mQbGcZwkJ8lJW/t8kpwE/0lbe/BP3rIQ3MQGXOv+DIAEJBCYOndPOIUxr+mjlxZJWYdzj38QbAo0Yraml7excFNqzhJ/wAdt/l5VXd9jOYHulb4c7346M2yiUlddJs1Zc/sXAJH4ABh+kuIJIlWoTrpCtHmG3Cpl9zGlTq1N6XCnXKlUu6eUPuUyOVuyZvMwbWl1WIf4fWulnX51kMyFSBhWJAyRIhmjoma7evvvUIhQ9db2HIEKuOiwsFHkIoEdoFQRLkJGyPj+3p+5iRR902aVKeUEqPja165hTReMaX8s2kyNTERE3CMc2XCI+P79/qcgwIW8wUgs7Y0THj47/yxufM29ROx90w+LfZ9+5xmcH1wsZs2//IQ0zr9fLAYs+DleaFzs4gvKxZ1ni4olsbQa0SWxW6KfN6Zj8/7m3rd5ensqcbp9Bx2Zi3ckD14HdmQisyaasYHHBlL6SCMrg4ZCU3WV/8/GjVC+XvXvc7EBfao2zkUYbq3673H/htwBG2v5VprMGris8iW1kclm9K79rCdDgMqJjSpudS25dfEBl+Jis2uVcmjoKf5Je3HdtWHFBqya+H8DU9yjrv0aQ8xQNvHfLzq4m1V+gxo4euv/V0tyiEYbXwLltATItuVxIqHFiewuShyof+5SMkSxUqJclmioEdFEJVGthqhTR+S0JdprT3TWmeiqK9Fdd6K33kRffYn++hODDSaGm0QIyBLg84Dg589i3V4kmQ1ACHroAQGeeTYpHNtvuNSIvExrxLIfF1Of7BygzwCNiOozwyFn9U960QigkPJPG5Fns0cwOI1btr+2UL8Lw6dS4fVzL4nCQIAwCrjs+qHYLQdwuSnihAIupYwBnVRQNAAgrwChdDOAoilhPcfhykQUtdv2ilHK2oRbtVoCrcF0qYu0YYrYFbk7K4aP0AysljyiMUloJVhYaDmtzTCyajQbNYmsV+oxXGuLso4Z2E+jcoI+iNycf9NQOQAXU+pvyDiIqy/vkA9y8g3wcG45KIY3ZRIRsMSXwuCO8prv0SeFZ32MGRQtGjIYWP6lKgsPXhVH6NCrogewAU89afN9QFsJQa4lQrEdrpskaGh1gY2thPxIXVbSRyAdUBevebcjoOoGDIrhHxVueP7xuCkhMI3VTRVYa46YY4gkIPIzEkLtCFPOqVY1qkCLCUPMWwl/FTv4gr9g3ZDfc0L1WxV5gzhZT1QRrSOUGrnKVLfsH0ISePGi9xDL71V+BSaxrPPXwaXxzuhSeRFRVA1iCTD4KrsqWetWJX3G/fpWUY98Qa9SpIK5oKJM20IZBY/tQ7I6rVGUcz1JhmP0Jh0D5unyUKHLWv30TWcnInqOJ42w2nmd61C9y1YOoXjh1r1lTFa+13RpiZxN/+qGOo3SL9L3pnk0f/Iuri0i6XFZhX0CQ/1pjzrsnm0izGyRnDOq38557j8bgD0tyFmdR73wwJpvN05+g8R0nmmKGAy1V+Tsd0b8c9Ytm6xV7e6FVwOc0oTeE+rZhtdbDJMmNa1cV/lsmEtQQ5JmiVZTyurjKmXflrP6nN5rdcconjVYEFLiYrQPhq7G3F56+BmeZYychB06DwywomuQgtKvHuBis8dFQmB5nN1wfUDqkWIBUx6irFqLAcPknqN37CJ28kcoQ2OCVNHSgOBJQUY7KX/AEO5//CJWeT5YimFzSXq41qjPvDhkfwqzA6WCBXDAZuLNB5w+dam6VZfK62XN+jCPWs/yKlzDRYaAwG4RZeHmcT3iEa/I9R/gJeTycmvtx1dsKfWgqVYy2uqqXHf9VRlosubmmqcXsPcByDY55JJFhjQVBCrOC/cBBxCpm2NSeBK3gjISYkciotz0iCFhDvF5XSDAJyxltBKKlqT5SokMjxDFFJGgCMUwVEMy1KKJsYWKsCMtFeSVWkSM5mQTKjalkJ1TB474EpJyri0qDitSuQtpIZYKvXyBBgyAsCIQkiVKCShTzgo5tdShHk9vKllxKGCEcX2J4hssKLm9RnbI8ae6T/QXKKuwHy7S59payanafNEcYcuoVqOVtroQnTK2iXmEd+xOX0rfhEQBBRRQQEES3MgZCbMkuKkzFIQKQkGoINS+UNAkoID2UUABBRSsCm540h3HigG5lJ+9Ydk9Vt2W7aziT9PdqoY7WFpiWi+EJeYIaBV+WwWHZ66Zu9ymsd2Z+qZ85rPRWu+9EnPYInbGXh+eTPqxKIo6kVALhbta/Y1+c1nYj2POaGN97V3jTj9ChKiWlgZ3fSIOakk6SrWj3tY6B4J7IpGWYKvThfq8rggeaG6yRVDBZQqXDXXgzSQ1IQxbrRRl/cu2xeoJKwGDKdATRNUCAaql50cTDIsEUcMN0jJMx237Qdjt9YcbN23Z6mz3Vrvs/pUQAnbefPh8k1rKCSyoEzUBGNw9iixiTMhh8+/3G/afPOnocaHiPX89Aauvad8wIo8BSEO9DDQUJ4TLgCQbtKE2r7h+mArrV7sbBciEUbUmJahnYPpOlKMN0UMbNcr4NE1FGgABQlFRCoAQSHv1cD+infxV2/eXE4mSk0SCOFZvz7IBOW42jxgVE6RmVt7oAcq2qQ50mybdUOPdyas0ZNhCf6SeLvdEdOi1ep5epNf5iE/4Ct/g2/2C/zmSH2xojVrxuGM+6at8o+/wi2uX3fXMj+fM8bDwP3hu3IP/3vJbDv07yMmRX7cImLgwCcgCltawz7tolqhFLJHKFX6lqj4SJSgyGAqE1TmAQpQikjQ3DVu3gGQqjyOtxFfXSFtW34KKpfnT5HABYimAD8FSWDfAeQFyEWQJ/Fqdk1BUy2lhqRRJJmjGxnRlh1Xq3VaztrPoC+MlWho7Bu6N2fL2s2CnQLi3rLWgWiCtSuMd4tQaT6cNs8bDySiKG9cF4UWjaTuiGCMaoyYUi5l0Lm45jaMyn01HPUPTTDxqSWvcqu64TzbaqpbKvdRlbTdtWj+WNb4fNz8xE22oJ9sM+MqrKL/vLtpSMDKSswwdWFB1wez9S56j9PHTof5IzMj2BzKdfhPxdqp7DAo8FRpMkwEvjh4KdTAjjyK2Ia6VnBREO6alDeM61smMcvqFYTz9p5C9C6LgJhPO0yUuaeJkT7tFvbRwh8Br7CXsdIcVbfoToS6x1JpIUJMQLpyOpQvbUMDdgBW1FP2JvC7jrOybHh9cikTE7YeDJqhWJ2mIA3+OJ37p8eYi8lRRBRn1LQwrmlK1GEKYpyjGyfqDCTSFihIEVVBVG8yyR6VEx6intLY5tW8nu6D2wTLA4E9jeTDnCRTw+/FoZ5ITM7xcebZOI2KXQlq3fF0GAGdK3zN0CRcQbvtbL2qZarVvuYOff0n7pIJHq69qmL4tF5MSh6+lNAnzA9lFasJMb2gm4tYQsAFf50PTFqb7CJP8dpRGV79t5HbLM9w0AEJmISs2+9gxeGX5U+ZM8rTY3G9pFOiSw3bVzPcx8uPPXQTXPh46tI8vNzlwQbiD1UqLPzpY1tPKoc+N8snpQ6N+nLGYTolvdKYqgrolwxFJYCRC+69ic1tIihaKRZGNL/flg0RLqH0fTz6mqrc7vaZrtdjlh3gn23Ixxm/6LT/e7mNf2f9zWwUokvR5Qbqope8z9NOPhw4FqvdHFMJklUVezHNIu9GscH6Wn+TgIl1VcmLVVdMcXGW0TYcOTc9DVySGrnUJg3LvV18SDS48cQ945ejpg2E7Lnl9Jfm+vfwMDNgYUSTx8Zj6eGKdxUZuZBcW9YR1UKkdKAOg7R7za2bQVPd/S2jNp8EXk/Nr983jD+YLTbI0HB0LbDS06LTm6cbdviJl0s8Ij9tLot02vnaV2FcWTrYYsS8Y3TSvQdGNEybpui57VlyzFNPpFWOKGyavsfbDUJRNJg1tuMIfBF2vqEYL0RfR4YNnT2ZpAzvIBozqXetEND0vZCKQ//PCD8+JE2X4CuMEATrewpz2jVJtSKdSodcgqyNsNBqiMYXux07ya7b/GZN5TT7jMv8Ru/9DecUvl3MBnj1IevgesttEkI4GleV0tZwnpzlvtQDfSs//qRcabOZng6/y9kO/xlykQL/sVXGbybgOylt7mcrWDwZh/w7sZeArdW1x9SoMUxppWheu2mEEtsjjWxEK+5bzOAxd7OHhECi2DfDsn7vQKmOzxWxsoRfiOfmSf3M8izX+Jv/gfPDDIWqofB75CxKUvItfK5xYfr3jKX9F4UOZlB0pPfXwuGd88L8+qs/1rv2mALomaP/9EgpwI0uresmvj7arSMBloANu2zwEUSoKmqDO6aPGLCZEspDJJFQaxWKSUzwl8OUn/598YCj30FDks/8zPLuJ1M0no08a0nV0Qc5UIAINwAREWmWst85vmQ84pn9tap3yTX8g1j+dCk3EldDq1VRobVXZndP/I+LEHOcC+TxymPxm64U4ZyKWEYDrfsF/xPB+TTac+5v3E38VCdg0LM00EMsFgaDyRiIpcA5pYZlQWCGksKOssJaeo29pHtBHDtsgzNYJg7oX5GenssEswLJUtvhFE7J6c108scXjW9U0ivorJp+ZUgX8CRVKxf5KATX5rDTYhGoH/RZhfyi6UEWSSkGFW/y2tEa0o/QZWTT0SRSWJ1wuY6bHgmFChQrN2xvgB0Or1wfn2LzMhQwU9WutyrXQio/5Rf8DCYYszIHrZrQZcHhu2mnjO4p5v4QGk8kZZ6rHzzge2L5togJmv4BuaVaLESEiloSMRklIdCEfZpCEv8jA9P4CouuZZUH0gapwib1aNOmbMLTmj7V1YpOxZabGKXKXcIchHfj0yjSlgy2ugVGbl0S1skc3WVqf1SzwVAkQ2/e1oqBfDL58P/zpx4YDe3MP7Y189nGYyXB3m619uEudScJ1edd3+M6hnGs7eHq8mBDhRdroy42IvFwhYTAIUS9HJFAFFS4iLAf/fe3Hqpkjhtmaxl9B5/YvYiGDaEJHTF9jtsmX+Sp04oGVRTNcVZoWtMU7zK7O2uB6QfOxvx+LVgD9FZR5d9r0U4+teE5SJMOV5cMzYEe48eobohk94nvz80Yjtq6y4NXHo8fjz/+fmqHx2YF5hPRByqhK3dycjlZSU70uo5Y/UuPhVQI2w9uLWo8tXWo92ot4fb1IrBblmJTkRaqyEjuzOxhm9kisb6qq7kitRx4OHr8CUvv982PRHSh4NboH6rXPodq549lT7pwMvPgF+GbauZ/6oDg5Qo0wl2TGM9IQCIZmx7IF/y4dr1oRONY7hV/itX5E//rTZHzPOTAbmN4PU1rFd3nlcpdqBsGZFkzXDlfO7TPZpphs3XIOunHxUq14+AdQi+8DR9Tjbj1mob9DMmW93uNucjIgr/16bc3/nYKdyovoEc+Alig6xuf3wAWcNJrW+Vgov3Si7foWwg4Qi0bnswN8tMtmD3ooO+cWa7xqR6Dt2TejP6C+fXoZXYkC3fsvApb53U6PuUloQVitKsI6t9Pu5NpLin8JaccPjk6XIFJRSGcQhRGJhI+IJGGrVkQhEmBLyUu7hcjpN5v7SBO73VHXzNaYwuzN3yCVYo9UJUCFMspsFPhRvsxqz/FZtIl54WoZvn4HPOhDbAPzHAEx6iLyoGuzC5xcn3mw14EhIlQoDRoM0kA0RCIsYUAJ4oMCsNEca/kiiZ8ycks5U4ZOBob/Pvg2eh0F0xnWNqUmEyyiihsQVKdD0YZiqiiozbQpQfVInX3BJqSnZyMCL6hz2xYSBc2L2xYE3SZ5OCX24wmxMmwy46OSEJHETLEi/HRanIqD79Pf7o6dcX69md6/ci/e8m5o9H5D+xcrwfBXBdR0NR9t4HnQKI+LqqdTBT5T91IzTS+1mLv/M3jIL+WfGb2IWjkL15VkBJG9jXphU0Gr3GuMaliLxeIL1AWxeHGl1hT1ygtaRU3eprOCSElGh6tmRdSaSmuRv3hMr7UImEeoEXZ/bqqkIg2V//zDnyqgpf+dvODPINCayw42gIF8poNZ6mAyHaVMB5i/PAv+6GH48zqV/y+/37DyjNzFykLOtfXX3TMPNP1z7PV1/f9+2NQVTW0pqKYz+VTmZiZ9+6GZpIFrtSPgwpWKvU3tt55bWXvZruhb9p8vWRP71jY7VrXWXJhquMAzKxlcAudCIOnfq5n1WuZWJvXXr1V4XCGVeTX9DvrgFQ3W4VXi9TJQbyEfwvRAgGOB465Rhi+0H23G7DTOuNNyRsAGNIdrCXC6UABoHmhJcBY6fWe4LsTv2SzKm/NWrbVbcU4OtAOdK3iTH2CXsKsYts7NdQJZ25JM0sI2C883w9WlTUw7IErrzq6w6MGQ+bdyHIvzNkAfbFEwi11h/pQBi3vr0S+O9frwkMb7DIXtHfXO3DHR3fWMFY6pkBPLZhpacHZ9codLyvcvACJQZ72Xbny9zHDX8MHyEt9DTULVTK61Ca5WXYsH6zpuP3cuD3vq4/AcHXbLpiH/gB6O0H3XoG9PFF7Rud4MkE5zZXii+p7O9Y7rvrmAtPNHsQvrmPQODOSX/J8meVRzFaZT/hRW/8p3PvzjuFLPnE5cpz9Y5GMmu1CGpgkXMtwB1R59M61bnvS3f27tYg/3Jk2rPPNwMq/+P1tb/cj99HCJRxEChIDfLQXwJyjURE5bs62x2xFXudcH/hGWlElz6S6zpVsWyFZdqmt0s+7SM/qtgOLlU66KqKyqVDnVVfVRPuVXcZVR/ep43VQvFteWjuhiXaGb6Q66l/Zov07qw/7clsmaUWbZunS9vPKrZaWsnladtWY7vt26fbQP2K3sYXbK3rZfvz/fPqfAiTnFTiOn1mnpdHR6Oh6HdOqdTmeus7Zv6/v60X6mf28ebbQL7briJtwGbi831EMIV7g7FBTacZo2vH0Z5JUGm8WHCu+Hq7yI+IEo1h3BuOwFQnmcf/7z5zN4NFF5JPXrCJA1ooh7oTi9gkFZCyctcIBog0KawUsMwzL8iVRVlKIbW7mitzodUnanZNkbwJBZkD7DzElIzgSsojKIxPyBFKJwsJBUCG6BkI4LXFvKIIHJ0MHQVJoLf6eNU0BfAJrA2u5OK9wUboxx9sm1QA3QVJoRQk+eARLoDvNMsXupqq9f279tQudYpwNYIr4K6vThxQshjb9+bIl1qDLn3sxi7KY/D9wgsOL0OgzT6Va2gE0muo2gIjD0CSZ4tdqUQuVCWZVhTKVE1+nQpe8aBQgRhEny8n8Zhl0ciwI6FthAVKyta0jWa/nJ4ysbUd4HO9Bk1op50izlARNE6n/SSBr6Gzeg4wlFgEWlc/BPwOthpAEAG0fW6LvlzuZllYk06sLIknbBFhE8dsYqEgFXwLo3EO1xFUn5Pmxey79p+xM4LgPO1K7ho01j7KCUOJGGX2wHXQX6NZ3Ej/0NJ21sgq0C0wHGmX4mFaKdldGSVB1FF465nKWPmDrd0+nvWpUiCFGYJMeZvhkImEADDKg8DfAZjLbg5HU1bJWIT7B3WijG4hytyqtE+3fwN7RGTa2TbR2sd7tvDYex8/coDJ/a2XR1TLxbCSKUsIIyXfPR/vnQHLtjUpVyWFYJNNwmCj/EoNTy2nV3vxJYCGSAguhhsA79/rsO1iEIJO4G7M6rrYkg8kpkKKSdE6esSSmCb0L/PoNRX/tWmAg34yWoTTS3ol/6DOy5h2qtBgzJiqDjTLj0HTuFBcUpxmkGvQMk7SMh+xW2qlRT5PUayQ6xPoWZLX1/vX5m/nbQkoFm4glqw8C/n3o30AJ9dxvP2B1AnHzV9vaWbZsD1SKulId138nAUiWByaOUXlKwFSTNhSFskWGvjIaW/CiaQHR0EOmMHUCtlwhEwWw594Bl59+B7N/Eubdgz7SJ+XTow0sQpQycJ3CFlcoTGx/6MnPMaQnydx0G01ml2G3K5O0TR7xoFsuaaroIPxOKzPqyM9WbGDNMNOB5DkSN2a4Z9NegIwiMDH5LV2SulKmLLvq+6mBwsmJtxvVlh5QSYzXOmarQNVn2vlGb4Y1rjtQ3wI/y4GMZYEnn5d/DPNL1bYWx1fouwMV9Wf4KJu8YoSdPgpq0OIv0qKtNmR6jYawGQeHkvn0vpzOwT2ZIrseK54cnD8JTvYW3Y8CHtY2HO40ZCULkz8VQCscgRZZZiv5jnDpyLLMkRLD+GhGvOEGARbTkXHSpyD0FecXtNWyz5ydU7IeL/AEsTLgIU2aA80wChZ122PgZv4ggs65c5WX17I5PiE0Ee1GyQ9+zPA+l/8PEVbikW7XI/5jWWZdw9zBtGQQZeklliMgKl91FMLSSXTwJTe63I0TBwYNKOcc/AWPe5D/1SmjeYJZW67AZK/INwfuTvaim73YyQFzwKQ4hnmQ41h+gynMk8XAPxUl6e5GuscHLZGGqSliQbRXjhVAqwIrYbj1R4rAm5MybvYqU8Qaa+5RS5K9imvKKNtZKM268ehhUFiaqTu9XnqZxauH1F2XVVJHaBJlZDobfJ70XoMkkbNHTaYacSBCye1SAqih4qYl9a8SFh1nylu1VfwdvxrHBvnE7vrI4z8o247OM5yipI9c429yjfo82exB34ZXCbof8XEvI1rymv8oMaNJ71Wre4sJjXCrwdfr7/6ppwrLzfZyQyzoJY02VauXJAtCzW4d4yPICi5AGYME7uE5qeQQQiTToH5G5MGUnAo2JQrHW4ElxNJa4y6fzlkVMspWcn0gtx1r25o3o/EIQrnjEmZsDSET1utSiGk8XlLNgHzY0VF5/GAng60WKskGaYd8cw039jNjYnEfAMcWudrd83xCgy9PHpLFbWzE7XD9OgHJO1frdLthmM368CPp2Rd5s/AkmRwVWo8TO011vdzQaqlJHDMObgd8bDbdA+bJygpfx3/8HguEAgf981KKdPhc6/OknfDyq7R+LyZCl0uQ/hp2noii6ZZpamaq85anD6Z3tbLeCK9GNbLNszCsVKnFHrWPSOI7K9zB2S4uV/f6PNRq2hr6nZdB+LUSbF47tDpKuLYncPUDYwK1BZRf589k0h5aqRCc1PvlP71r+dlkoycaZL8mHK7Dk0BZ1Mc6HwqYJBRNEONmkqODt6TY42l5pNonOFpOnB+KmsZfu1sYnwO5haVgltq0wSXPMG/MmBiySz9FTU9uGTUtb7QQJWxZInweOsX1Dd1s2NMuLrMgvxAxvctIF+ueeCRurDcSyagyIMhDz7UvVnZpTB8U13iwhGNiHFWpycwHMzjhY44qDpzJZCGqBEjsLM3FN8JZAISvWopdTKe+xR4RSDK3amF0FQaoJoa4IiC5tQjWmS+Nv+QATKWsck7UtVFQKuKc4KZjE7WpSHd2ybR1VQOS0x9+LBEbfYvcwcAVoebHRvJlPFyy0lsE+rFIrkgnT7AxZDe4IFNuZuo3+3wbsbleXNd0w1OqYr7sr8yLV0Eb5xYt1vSlk6tBpX9NTfAxIa0zqvwDbaV0CculByq3BJBt3+eWVcbTmpo+43yK4p66JxJEiREKVFLhHdcSyuUQCtZZrbqTGAo4MW0dKxURZwiJlBG2D4nqWQEVYaFRqm/RqAOITrzZkroabcl3+Jk+2V7KwSWAeAiUgCGIMQYgT+9qmUE2kXhfovMClww6bUiWJ1p7pwkaBoriRcpNhmGKhFDuaPEUNS/K9K75rT0Vp41G2DJwzoQuvRlMLBEveEixlE2QolBqoC/7weJSe6DKubCAjottiWC0ZZAfbYlEcIP96wWWZK7caNDeqllqlK7vqKgxGJSmhkipM3/8Q7YOuPOEVyYq6KzcBqShfUa2yC+jKZZCpTAEeYYFc6IIBktDFABLxmMdLaxdl/E2bdpezsMnT3BpHJmPJFcN8rh7X7DUwLo9s+QQagXG/TKbCaoentr/jdddV12BHBra1mWUY198KBiGUJzrJ6UNrOK21gtp6LrRlS+yfMp73wHaOyzHkke1Z1aWlLV1kWcSj67RKFz+vD/7RL45i8q4GiMpMweJ0jeOp7Mhmpy10AOsmHOtEGsi5cyB2T1tkZKd92F083jxZj1Hqa0dBHPlKxXw82qfidbSQUwsSsX4HVmOajc7Hi/ZvCpLBwKLH7Y2+ewLYLez0WrfQlVkOEc/YayhUGsFTa/P1oDlJJYRKo9B1w9Hu3Y8nXEwu71u5mKtjtYuAM650xiGLYnzfSINtDa1Rulu6Yfr37nJOMUxWwN4pCNk9+MjcPp1h/Fta6+8B3jl4FwLg2/L2F8/kiXolYFMABA/UohW6IpwPJYflxNJLk4Ph6SARySbkjAW4LfhLtGgFPCUKNbnUrf9pKum0GD8NxEudqEmjaBL/xUSfJyXhVBBDGqYOU40lcv1+rgPJJojdmoy01ouuko+klBo/IrQVRVT7m/sP2qb/k8POnI/cXKNaFGGvp36G8QqiSVhsNZR9aE0T6RbaEaSONIm/Uh0vU5Ka0y0NpzZq6RT/XMP/6GttovEx/EfRJN1HcRoTTcWJrXyNfZtjPXuJvd9j0mOtRQeaulP15LvqpiCIXGT072Wfkr9DabrFUS7ws3Z+1qpLfg+Zkn6IVmlPMxgPuuBFxsBYKN9f/EAXf6MIWKojrT1DMNkwPBMli0tZAFwdx3qfaBjLfEo4Zvi0PlHmM1r42Wdp436fLeeIL6ydcYVRvHKxPPHwDYJCX4chdzdfGFc7X5wiWV8CW1FhCqN8unymfJGvGE/YFztCro/SywMD+2PpVLvU3RvroNHYHLy7Xy+a61mB1H0ebevK6ztQ+HekBjLhhVKJZL+kw9m7+/QS1sVZujM+NHT2+5IGrG/uKe7qTbg9dtGVs+hALCXT+s+K/PSRDXDPWG+I7vVaCu3MZMkUYqlUbmhQ0YqOuELZLmvCjrDaCKutgLUivKwbx+dNZwhxeWX1vGt2kprn9pKYYsl9Z1WsoEF6lRDqiV5hM0Vrd0rBA2kQiRVNjHvUUoPTGWgTt3dlJAmsUHLW1acL93lo4+WKq8y3Bv9DLQVUvBFUcgVCqUyu0BiMJv8nMFGeJCuqphumZTuup6yCxqiqYSEcnkAkqZMpVBpM10A0tRhMFpvD5WnzBTpCXb24SHsDQyMbbLTJZltsBcaGHQdOXLipw4MXH4hisnEITNqHgMRPgCAUIcLUE6nAx156kB49kKSkbWSKzg3HXflvLaRCb5k0V777kMnE9tx2a51y9K6sL5Xu6oSiPprnbPGgu9Eujyct8P3vjfgopNfS1hHLRe+52NRW70fjz+Bi35lL+Dy/68oP+ETmpZnBw8Bo6miMPMJVmV0VYikvIgXrPN9K/6Gxq2+CN2mXMgayRh37STbVYMu7ZDwZlHHVBJ04gHjQa3ek6PfoHmZAUJUX2GZ35ceW2NHmSGj5z3aTGE1vOOYh7ex3pJyznGkZYyc2e27nPXeOH90VEs/rlRr0lNz6cMmx3z2A3dgO3bH8rlDrxqaiKkyNuNeUXfJ+hQNxhhksaOw1XQ1ZS+MJElPWtcW4GNEBtJuWQ691aLpWDTw29vItHWk6FRtoTmhrAUvd38Zq1pp4rn1uGVaCS8Wl2heF08Dyf7hFzSCuzvfQe+JIr2EoMWrWS9osQN+Wf2IfBQA=') format('woff2-variations');
      unicode-range: U+0370-03FF;
    }
    @font-face {
      font-family: 'Google Sans Variable';
      font-style: normal;
      font-display: swap;
      font-weight: 400 700;
      src: url('data:font/woff2;base64,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') format('woff2-variations');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      font-family: "Google Sans Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      width: 320px;
      padding: 38px 28px 24px;
      background: #141414;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.04);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .icon-wrap {
      width: 76px;
      height: 76px;
      margin-bottom: 20px;
      border-radius: 19px;
      box-shadow: 0 10px 28px -4px rgba(37, 99, 235, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-wrap img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 19px;
    }
    .brand-title {
      font-size: 23px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: #ffffff;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    .brand-title .accent {
      color: #3d7af7;
    }
    .subtitle {
      font-size: 13px;
      font-weight: 400;
      color: #9a9a96;
      margin-bottom: 28px;
      letter-spacing: -0.1px;
    }
    .progress-track {
      width: 180px;
      height: 3px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      overflow: hidden;
      position: relative;
      margin-bottom: 12px;
    }
    .progress-bar {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      width: 40%;
      background: linear-gradient(90deg, #2563eb, #3d7af7);
      border-radius: 999px;
      animation: sweep 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    .status {
      font-size: 11.5px;
      font-weight: 400;
      color: #9a9a96;
      letter-spacing: 0.1px;
    }
    .version {
      margin-top: 22px;
      font-size: 10.5px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.22);
      letter-spacing: 0.5px;
    }
    @keyframes sweep {
      0% { left: -40%; width: 30%; }
      50% { left: 35%; width: 45%; }
      100% { left: 100%; width: 30%; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">
      <img src="data:image/png;base64,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" alt="YIZERGE">
    </div>
    <div class="brand-title">YIZ<span class="accent">&#931;</span>RG<span class="accent">&#926;</span></div>
    <div class="subtitle">High-retention clip editor</div>
    <div class="progress-track">
      <div class="progress-bar"></div>
    </div>
    <div class="status">Starting engine &amp; initializing...</div>
    <div class="version">v1.3.0</div>
  </div>
</body>
</html>`;

function _e() {
  return P && !P.isDestroyed() || (P = new c.BrowserWindow({
    width: 380,
    height: 420,
    frame: !1,
    transparent: !0,
    alwaysOnTop: !0,
    resizable: !1,
    maximizable: !1,
    minimizable: !1,
    skipTaskbar: !0,
    center: !0,
    show: !1,
    webPreferences: {
      nodeIntegration: !1,
      contextIsolation: !0
    }
  }), P.loadURL(`data:text/html;charset=utf-8,` + encodeURIComponent(ge)), P.once(`ready-to-show`, () => {
    P && !P.isDestroyed() && P.show()
  })), P
}

function ve() {
  P && !P.isDestroyed() && P.destroy(), P = null
}
var ye = 17949258e5,
  F = `November 17, 2026 at 8:00 PM IST`;

function be() {
  let e = [];
  try {
    e.push((0, l.join)(c.app.getPath(`userData`), `.beta_lock`))
  } catch {}
  try {
    e.push((0, l.join)(c.app.getPath(`home`), `.yizerge_sys`))
  } catch {}
  return e
}

function I(e, t) {
  let n = be(),
    r = JSON.stringify({
      isExpired: !0,
      highestTimeSeen: t,
      lastRun: Date.now(),
      reason: e
    });
  for (let e of n) try {
    (0, p.writeFileSync)(e, r, `utf-8`)
  } catch {}
}

function xe(e, t) {
  let n = be(),
    r = JSON.stringify({
      isExpired: !1,
      highestTimeSeen: Math.max(t, e),
      lastRun: e
    });
  for (let e of n) try {
    (0, p.writeFileSync)(e, r, `utf-8`)
  } catch {}
}

function Se() {
  if (!c.app.isPackaged && process.env.NODE_ENV === `development`) return {
    isExpired: !1,
    expiryDate: F
  };
  let e = Date.now(),
    t = be(),
    n = !1,
    r = 0,
    i = 0,
    a;
  for (let e of t)
    if ((0, p.existsSync)(e)) try {
      let t = JSON.parse((0, p.readFileSync)(e, `utf-8`));
      t.isExpired && (n = !0, t.reason && (a = t.reason)), typeof t.highestTimeSeen == `number` && t.highestTimeSeen > r && (r = t.highestTimeSeen), typeof t.lastRun == `number` && t.lastRun > i && (i = t.lastRun)
    } catch {}
  return n || r && r >= 17949258e5 ? (I(a || `Scheduled testing period concluded.`, Math.max(r, e)), {
    isExpired: !0,
    expiryDate: F,
    reason: a || `Scheduled testing period concluded.`
  }) : i && e < i - 3e5 ? (I(`System clock rollback detected.`, Math.max(r, e)), {
    isExpired: !0,
    expiryDate: F,
    reason: `System clock rollback detected.`
  }) : e < 1794681e6 ? (I(`System clock set to before build release date.`, Math.max(r, ye)), {
    isExpired: !0,
    expiryDate: F,
    reason: `Invalid system clock detected.`
  }) : e >= 17949258e5 ? (I(`Scheduled testing period concluded.`, e), {
    isExpired: !0,
    expiryDate: F,
    reason: `Scheduled testing period concluded.`
  }) : (xe(e, r), {
    isExpired: !1,
    expiryDate: F
  })
}
async function Ce(e) {
  if (c.app.isPackaged || process.env.NODE_ENV !== `development`) try {
    let t = new AbortController,
      n = setTimeout(() => t.abort(), 3500),
      r = await fetch(`https://yizerge.in`, {
        method: `HEAD`,
        signal: t.signal
      });
    clearTimeout(n);
    let i = r.headers.get(`date`);
    if (i) {
      let t = new Date(i).getTime();
      t >= 17949258e5 && (I(`Scheduled testing period concluded.`, t), e?.({
        isExpired: !0,
        expiryDate: F,
        reason: `Scheduled testing period concluded.`
      }))
    }
  } catch {}
}
var we = [`subtitles`, `headline`, `music`, `watermark`, `outro`, `framing`],
  L = `project.json`,
  Te = () => (0, l.join)(c.app.getPath(`userData`), `work`),
  R = `projects`;

function z(e) {
  if (typeof e != `string`) throw Error(`Name must be text`);
  let t = e.replace(/[/\\:*?"<>|]/g, ``).replace(/^\.+/, ``).trim().slice(0, 64);
  if (!t) throw Error(`Name can’t be empty`);
  return t
}

function B(...e) {
  let t = Te(),
    n = (0, l.resolve)(t, ...e);
  if (n !== t && !n.startsWith(t + l.sep)) throw Error(`Path outside YIZERGE`);
  return n
}
var V = e => p.promises.access(e).then(() => !0, () => !1),
  Ee = async (e, t, n) => await V(n) && e?.toLowerCase() !== t.toLowerCase();
async function H(e) {
  return (await p.promises.readdir(e, {
    withFileTypes: !0
  }).catch(() => [])).filter(e => e.isDirectory() && !e.name.startsWith(`.`)).map(e => e.name)
}
async function U(e) {
  let t = await p.promises.readFile((0, l.join)(e, L), `utf8`);
  try {
    return JSON.parse(t)
  } catch (e) {
    let n = De(t);
    if (n > 0) return JSON.parse(t.slice(0, n));
    throw e
  }
}

function De(e) {
  let t = 0,
    n = !1;
  for (let r = 0; r < e.length; r++) {
    let i = e[r];
    if (n) i === `\\` ? r++ : i === `"` && (n = !1);
    else if (i === `"`) n = !0;
    else if (i === `{`) t++;
    else if (i === `}` && --t === 0) return r + 1
  }
  return -1
}
var Oe = new Map,
  ke = 0,
  Ae = () => c.BrowserWindow.getAllWindows().forEach(e => e.webContents.send(`project:saving`, ke > 0));

function je(e, t) {
  ke++ === 0 && Ae();
  let n = (Oe.get(e) ?? Promise.resolve()).then(t, t);
  n.finally(() => {
    --ke === 0 && Ae()
  }).catch(() => {});
  let r = n.catch(() => {});
  return Oe.set(e, r), r.then(() => {
    Oe.get(e) === r && Oe.delete(e)
  }), n
}
var Me = 0;
async function Ne(e, t) {
  let n = (0, l.join)(e, `${L}.${process.pid}.${++Me}.tmp`);
  await p.promises.writeFile(n, JSON.stringify(t, null, 2)), await p.promises.rename(n, (0, l.join)(e, L)).catch(async e => {
    throw await p.promises.rm(n, {
      force: !0
    }), e
  }), await wt(e)
}
var Pe = (e, t) => je(e, () => Ne(e, t)),
  W = (e, t) => je(e, async () => {
    let n = await t(await U(e));
    return await Ne(e, n), n
  });
async function Fe(e, t) {
  for (let n = 1;; n++) {
    let r = n === 1 ? `${t} copy` : `${t} copy ${n}`;
    if (!await V((0, l.join)(e, r))) return r
  }
}
async function Ie() {
  return await p.promises.mkdir(B(R), {
    recursive: !0
  }), [{
    name: R,
    projects: (await H(B(R))).length
  }]
}
async function Le(e) {
  let t = z(e),
    n = B(t);
  if (await V(n)) throw Error(`“${t}” already exists`);
  return await p.promises.mkdir(n, {
    recursive: !0
  }), t
}
async function Re(e, t) {
  let n = z(e),
    r = z(t),
    i = B(r);
  if (await Ee(n, r, i)) throw Error(`“${r}” already exists`);
  return await p.promises.rename(B(n), i), r
}
async function ze(e) {
  if ((await H(Te())).length <= 1) throw Error(`Keep at least one workspace`);
  let t = z(e);
  return await Xe(`workspace`, t, t, B(t)), null
}
async function Be(e) {
  let t = z(e),
    n = await H(B(t)),
    r = [];
  for (let e of n) {
    let n = await U(B(t, e)).catch(() => null);
    if (!n) continue;
    let i = B(t, e),
      a = await p.promises.readFile((0, l.join)(i, `thumb.jpg`)).catch(() => null),
      o = await Y(i);
    r.push({
      name: e,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      clips: n.clips.length,
      source: n.source?.name ?? null,
      thumb: a ? `data:image/jpeg;base64,${a.toString(`base64`)}` : null,
      duration: n.source?.duration ?? null,
      missing: !!n.source && !await V(n.source.path),
      path: o.file ?? `Not saved yet`,
      workspace: t,
      file: o.file,
      dirty: await ct(i)
    })
  }
  return r.sort((e, t) => t.updatedAt.localeCompare(e.updatedAt))
}
async function Ve() {
  let e = await dt(),
    t = [];
  for (let n of e)(await lt(n.path) || await V(n.path) && await vt(n.path, !1).catch(() => null)) && t.push(n);
  t.length !== e.length && await ft(t);
  let n = await Be(R),
    r = new Set(t.map(e => J(e.path)));
  return n.filter(e => !e.file || r.has(J(e.file)))
}
async function He(e, t, n, r) {
  let i = z(e),
    a = i === `projects` ? await ut(z(t)) : z(t),
    o = B(i, a);
  if (await V(o)) throw Error(`“${a}” already exists`);
  await p.promises.mkdir(o, {
    recursive: !0
  });
  let s = new Date().toISOString(),
    c = {
      version: 1,
      createdAt: s,
      updatedAt: s,
      source: null,
      clips: []
    },
    l = Array.isArray(r) ? r.filter(e => we.includes(e)) : [],
    u = n && typeof n == `object` ? n : null;
  return u && l.length && await Ue(B(z(u.workspace), z(u.name)), o, c, l), await Pe(o, c), a
}
async function Ue(e, t, n, r) {
  let i = await U(e),
    a = n => p.promises.copyFile((0, l.join)(e, n), (0, l.join)(t, n)).then(() => !0, () => !1),
    o = {},
    s = i.clips.at(-1);
  if (r.includes(`subtitles`) && (o.subStyle = i.subtitles?.style ?? i.inherit?.subStyle), r.includes(`headline`)) {
    o.headStyle = s?.headline?.style ?? i.inherit?.headStyle;
    let e = i.template;
    e && (n.template = e.avatar && !await a(`template-avatar${e.avatar.ext}`) ? {
      ...e,
      avatar: null
    } : e)
  }
  if (r.includes(`framing`) && (o.layout = s?.layout ?? i.inherit?.layout, o.canvas = s?.canvas ?? i.inherit?.canvas, o.style = s?.style ?? i.inherit?.style), r.includes(`music`) && i.music && await a(`music${i.music.ext}`) && (n.music = i.music), r.includes(`watermark`) && (i.watermark && await a(`watermark${i.watermark.ext}`) && (n.watermark = i.watermark), i.socialIcon && await a(`social-icon${i.socialIcon.ext}`) && (n.socialIcon = i.socialIcon), i.social && (n.social = i.social)), r.includes(`outro`) && i.outro) {
    let e = i.outro,
      t = {
        ...e
      };
    e.ext && !await a(`outro${e.ext}`) && delete t.ext, e.picture && !await a(`outro-picture${e.picture.ext}`) && (t.picture = null), n.outro = t
  }
  Object.keys(o).length && (n.inherit = o)
}
async function We(e, t, n) {
  let r = z(e),
    i = z(t),
    a = z(n),
    o = B(r, a);
  if (await Ee(i, a, o)) throw Error(`“${a}” already exists`);
  await p.promises.rename(B(r, i), o);
  let {
    file: s,
    at: c
  } = await Y(o);
  if (s && await V(s)) {
    let e = (0, l.join)((0, l.dirname)(s), `${a}${K}`);
    if (J(e) !== J(s) && await V(e)) throw Error(`“${(0,l.basename)(e)}” already exists next to it`);
    await p.promises.rename(s, e), await st(o, {
      file: e,
      at: c
    }), await ft((await dt()).map(t => J(t.path) === J(s) ? {
      ...t,
      path: e,
      name: a
    } : t))
  }
  return a
}
async function Ge(e, t) {
  let n = z(e),
    r = z(t),
    i = await Fe(B(n), r),
    a = B(n, i);
  await p.promises.cp(B(n, r), a, {
    recursive: !0
  }), await p.promises.rm((0, l.join)(a, rt), {
    force: !0
  });
  let o = await U(a),
    s = new Date().toISOString();
  return await Pe(a, {
    ...o,
    createdAt: s,
    updatedAt: s
  }), i
}
async function Ke(e, t) {
  let n = z(e),
    r = z(t),
    i = B(n, r),
    {
      file: a
    } = await Y(i);
  return a && await ft((await dt()).filter(e => J(e.path) !== J(a))), await Xe(`project`, n, r, i, a && await V(a) ? a : void 0), null
}
async function qe(e, t) {
  let n = B(z(e), z(t)),
    {
      file: r
    } = await Y(n);
  return c.shell.showItemInFolder(r && await V(r) ? r : (0, l.join)(n, L)), null
}
async function Je(e, t) {
  let n = B(z(e), z(t)),
    r = (await Y(n)).file ?? n;
  return c.clipboard.writeText(r), r
}
var G = `.trash`;

function Ye(e) {
  if (typeof e != `string` || !/^\d+-(project|workspace|video)$/.test(e)) throw Error(`Not a trash item`);
  return e
}
async function Xe(e, t, n, r, i) {
  let a = B(G, `${Date.now()}-${e}`);
  await p.promises.mkdir(a, {
    recursive: !0
  }), await p.promises.rename(r, (0, l.join)(a, `item`)), i && await ot(i, (0, l.join)(a, `item${K}`));
  let o = {
    kind: e,
    workspace: t,
    name: n,
    deletedAt: new Date().toISOString(),
    ...i ? {
      file: i
    } : {}
  };
  await p.promises.writeFile((0, l.join)(a, `trash.json`), JSON.stringify(o, null, 2))
}
async function Ze() {
  let e = [];
  for (let t of await H(B(G))) {
    let n = await p.promises.readFile(B(G, t, `trash.json`), `utf8`).then(JSON.parse, () => null);
    if (!n) continue;
    let r = n.kind === `workspace` ? await H(B(G, t, `item`)) : [],
      i = await p.promises.readFile(B(G, t, `item`, ...r[0] ? [r[0]] : [], `thumb.jpg`)).catch(() => null),
      {
        source: a,
        file: o,
        ...s
      } = n;
    e.push({
      id: t,
      ...s,
      projects: r.length,
      thumb: i ? `data:image/jpeg;base64,${i.toString(`base64`)}` : null
    })
  }
  return e.sort((e, t) => t.deletedAt.localeCompare(e.deletedAt))
}
async function Qe(e) {
  let t = Ye(e),
    n = JSON.parse(await p.promises.readFile(B(G, t, `trash.json`), `utf8`));
  if (n.kind === `video`) return et(t, n);
  let r = n.kind === `workspace` ? B(z(n.name)) : B(z(n.workspace), z(n.name));
  if (await V(r)) throw Error(`“${n.name}” already exists there. Rename that one first.`);
  if (n.kind === `project` && await p.promises.mkdir(B(z(n.workspace)), {
      recursive: !0
    }), n.file && await V(n.file)) throw Error(`“${(0,l.basename)(n.file)}” is back in its folder already. Move that one first.`);
  await p.promises.rename(B(G, t, `item`), r), n.file && (await p.promises.mkdir((0, l.dirname)(n.file), {
    recursive: !0
  }), await ot(B(G, t, `item${K}`), n.file).catch(() => {}), await pt(n.file, r)), await p.promises.rm(B(G, t), {
    recursive: !0,
    force: !0
  });
  let {
    source: i,
    file: a,
    ...o
  } = n;
  return {
    id: t,
    ...o,
    projects: 0,
    thumb: null
  }
}
async function $e(e, t) {
  let n = B(e, t),
    r = await U(n);
  if (!r.source) return;
  let i = `${Date.now()}-video`,
    a = B(G, i, `item`);
  await p.promises.mkdir(a, {
    recursive: !0
  });
  let o = r.source.origin === `youtube` && r.source.path.startsWith(n + l.sep);
  o && await p.promises.rename(r.source.path, (0, l.join)(a, (0, l.basename)(r.source.path))).catch(() => {}), await p.promises.rename((0, l.join)(n, `thumb.jpg`), (0, l.join)(a, `thumb.jpg`)).catch(() => {});
  let s = o ? {
      ...r.source,
      path: (0, l.basename)(r.source.path)
    } : r.source,
    c = {
      kind: `video`,
      workspace: e,
      name: r.source.name,
      project: t,
      source: s,
      deletedAt: new Date().toISOString()
    };
  await p.promises.writeFile(B(G, i, `trash.json`), JSON.stringify(c, null, 2)), await Pe(n, {
    ...r,
    source: null,
    updatedAt: new Date().toISOString()
  })
}
async function et(e, t) {
  let n = B(z(t.workspace), z(t.project)),
    r = await U(n).catch(() => null);
  if (!r) throw Error(`The project “${t.project}” is gone. Restore it first.`);
  if (r.source) throw Error(`“${t.project}” already has a video. Remove that one first.`);
  let i = t.source,
    a = i.origin === `youtube` && !(0, l.isAbsolute)(i.path);
  if (a) await p.promises.rename(B(G, e, `item`, i.path), (0, l.join)(n, i.path));
  else if (!await V(i.path)) throw Error(`That file isn’t on this Mac any more`);
  await p.promises.rename(B(G, e, `item`, `thumb.jpg`), (0, l.join)(n, `thumb.jpg`)).catch(() => {}), await Pe(n, {
    ...r,
    source: a ? {
      ...i,
      path: (0, l.join)(n, i.path)
    } : i,
    updatedAt: new Date().toISOString()
  }), await p.promises.rm(B(G, e), {
    recursive: !0,
    force: !0
  });
  let {
    source: o,
    ...s
  } = t;
  return {
    id: e,
    ...s,
    projects: 0,
    thumb: null
  }
}
async function tt(e) {
  return await p.promises.rm(B(G, Ye(e)), {
    recursive: !0,
    force: !0
  }), null
}
async function nt() {
  return await p.promises.rm(B(G), {
    recursive: !0,
    force: !0
  }), null
}
var K = `.yizerge`,
  rt = `saved.json`,
  it = () => (0, l.join)(c.app.getPath(`userData`), `recent_projects.json`),
  q = () => (0, l.join)(c.app.getPath(`userData`), `autosave.json`),
  J = e => (0, l.resolve)(e).toLowerCase(),
  at = () => c.BrowserWindow.getFocusedWindow() ?? c.BrowserWindow.getAllWindows()[0],
  ot = (e, t) => p.promises.rename(e, t).catch(async n => {
    if (n.code !== `EXDEV`) throw n;
    await p.promises.copyFile(e, t), await p.promises.rm(e, {
      force: !0
    })
  }),
  Y = e => p.promises.readFile((0, l.join)(e, rt), `utf8`).then(e => JSON.parse(e), () => ({
    file: null,
    at: 0
  })),
  st = (e, t) => p.promises.writeFile((0, l.join)(e, rt), JSON.stringify(t, null, 2));
async function ct(e) {
  let {
    file: t,
    at: n
  } = await Y(e);
  return !t || ((await p.promises.stat((0, l.join)(e, L)).catch(() => null))?.mtimeMs ?? 0) > n + 50
}
async function lt(e) {
  for (let t of await H(B(R))) {
    let n = (await Y(B(R, t))).file;
    if (n && J(n) === J(e)) return t
  }
  return null
}
async function ut(e) {
  let t = z(e);
  for (let e = 1;; e++) {
    let n = e === 1 ? t : `${t} ${e}`;
    if (!await V(B(`projects`, n))) return n
  }
}
var dt = () => p.promises.readFile(it(), `utf8`).then(e => {
    let t = JSON.parse(e);
    return Array.isArray(t) ? t : []
  }, () => []),
  ft = e => p.promises.writeFile(it(), JSON.stringify(e.slice(0, 15), null, 2));
async function pt(e, t) {
  let n = await U(t).catch(() => null),
    r = await p.promises.readFile((0, l.join)(t, `thumb.jpg`)).catch(() => null),
    i = n?.source?.path ?? null;
  await ft([{
    path: e,
    name: (0, l.basename)(e, K),
    video_path: i,
    video_name: n?.source?.name ?? (i ? (0, l.basename)(i) : ``),
    duration: n?.source?.duration ?? 0,
    layout: n?.clips.at(-1)?.layout ?? `split`,
    thumbnail: r ? `data:image/jpeg;base64,${r.toString(`base64`)}` : null,
    video_exists: !!i && await V(i)
  }, ...(await dt()).filter(t => J(t.path) !== J(e))])
}
var mt = new Set([L, rt, `subtitles.srt`, `thumb.jpg`]),
  ht = (e, t) => je(e, async () => {
    let n = await U(e),
      r = await p.promises.readFile((0, l.join)(e, `subtitles.srt`), `utf8`).catch(() => null),
      i = await p.promises.readFile((0, l.join)(e, `thumb.jpg`)).catch(() => null),
      a = {};
    for (let t of await p.promises.readdir(e, {
        withFileTypes: !0
      })) t.isFile() && !mt.has(t.name) && !t.name.endsWith(`.tmp`) && (a[t.name] = (0, l.join)(e, t.name));
    let o = {
      app: `YIZERGE`,
      version: 1,
      name: (0, l.basename)(t, K),
      savedAt: new Date().toISOString(),
      project: n,
      subtitles: r,
      thumbnail: i ? `data:image/jpeg;base64,${i.toString(`base64`)}` : null,
      assets: a
    };
    await p.promises.mkdir((0, l.dirname)(t), {
      recursive: !0
    });
    let s = `${t}.${process.pid}.tmp`;
    await p.promises.writeFile(s, JSON.stringify(o, null, 2)), await p.promises.rename(s, t).catch(async e => {
      throw await p.promises.rm(s, {
        force: !0
      }), e
    }), await st(e, {
      file: t,
      at: Date.now()
    }), await pt(t, e), await Tt(e)
  });
async function gt(e, t, n) {
  await p.promises.mkdir(e, {
    recursive: !0
  });
  for (let [t, r] of Object.entries(n.assets ?? {})) {
    let n = (0, l.join)(e, (0, l.basename)(t));
    J(r) !== J(n) && await V(r) && await p.promises.copyFile(r, n).catch(() => {})
  }
  n.subtitles != null && await p.promises.writeFile((0, l.join)(e, `subtitles.srt`), n.subtitles), n.thumbnail?.startsWith(`data:image/jpeg;base64,`) && await p.promises.writeFile((0, l.join)(e, `thumb.jpg`), Buffer.from(n.thumbnail.split(`,`)[1], `base64`)), await p.promises.writeFile((0, l.join)(e, L), JSON.stringify(n.project, null, 2)), await st(e, {
    file: t,
    at: Date.now()
  })
}
async function _t(e) {
  let t = JSON.parse(await p.promises.readFile(e, `utf8`));
  if (!t || typeof t != `object` || !t.project || !Array.isArray(t.project.clips)) throw Error(`That isn’t a YIZERGE project file`);
  return t
}
async function vt(e, t = !0) {
  e = (0, l.resolve)(e);
  let n = await lt(e),
    r = await _t(e);
  if (n) {
    let t = B(R, n),
      {
        at: i
      } = await Y(t);
    (await p.promises.stat(e)).mtimeMs > i + 1e3 && !await ct(t) && await gt(t, e, r)
  } else n = await ut((0, l.basename)(e, K)), await gt(B(R, n), e, r);
  return t && await pt(e, B(R, n)), n
}
var yt = async (e, t) => {
  let n = await c.dialog.showSaveDialog(at(), {
    title: `Save Project`,
    defaultPath: (0, l.join)(t ? (0, l.dirname)(t) : (0, l.join)(c.app.getPath(`documents`), `YIZERGE`), `${e}${K}`),
    filters: [{
      name: `YIZERGE Project`,
      extensions: [`yizerge`]
    }],
    properties: [`createDirectory`, `showOverwriteConfirmation`]
  });
  return n.canceled || !n.filePath ? null : n.filePath.toLowerCase().endsWith(K) ? n.filePath : n.filePath + K
};
async function bt(e, t) {
  let n = z(t),
    r = B(z(e), n),
    {
      file: i
    } = await Y(r);
  return i ? (await ht(r, i), {
    name: n,
    file: i
  }) : xt(e, t)
}
async function xt(e, t) {
  let n = z(e),
    r = z(t),
    i = B(n, r),
    a = (await Y(i)).file,
    o = await yt(a ? (0, l.basename)(a, K) : r, a);
  if (!o) return null;
  if (!a || J(a) === J(o)) return await ht(i, o), {
    name: r,
    file: o
  };
  let s = await lt(o);
  s && s !== r && await Xe(`project`, R, s, B(R, s));
  let c = await ut((0, l.basename)(o, K));
  return await je(i, () => p.promises.cp(i, B(R, c), {
    recursive: !0
  })), await ht(B(R, c), o), await V(a) && await gt(i, a, await _t(a)), {
    name: c,
    file: o
  }
}
async function St() {
  let e = await c.dialog.showOpenDialog(at(), {
    title: `Open Project`,
    properties: [`openFile`],
    filters: [{
      name: `YIZERGE Project`,
      extensions: [`yizerge`]
    }]
  });
  return e.canceled || !e.filePaths[0] ? null : vt(e.filePaths[0])
}
async function Ct(e, t) {
  let n = B(z(e), z(t));
  return {
    dirty: await ct(n),
    file: (await Y(n)).file
  }
}
async function wt(e) {
  if ((0, l.dirname)(e) !== B(`projects`)) return;
  let t = {
    workspace: R,
    name: (0, l.basename)(e),
    file: (await Y(e)).file,
    at: new Date().toISOString()
  };
  await p.promises.writeFile(q(), JSON.stringify(t, null, 2)).catch(() => {})
}
async function Tt(e) {
  let t = await p.promises.readFile(q(), `utf8`).then(e => JSON.parse(e), () => null);
  t && t.name === (0, l.basename)(e) && await p.promises.rm(q(), {
    force: !0
  })
}
async function Et() {
  let e = await p.promises.readFile(q(), `utf8`).then(e => JSON.parse(e), () => null);
  if (!e) return null;
  let t = B(R, z(e.name));
  return await V((0, l.join)(t, L)) && await ct(t) ? e : (await p.promises.rm(q(), {
    force: !0
  }), null)
}
async function Dt() {
  let e = await p.promises.readFile(q(), `utf8`).then(e => JSON.parse(e), () => null);
  return await p.promises.rm(q(), {
    force: !0
  }), e?.file && await V(e.file) && await gt(B(R, z(e.name)), e.file, await _t(e.file)), null
}

function X(e, t) {
  c.ipcMain.handle(e, async (e, ...n) => {
    try {
      return {
        ok: !0,
        data: await t(...n)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}

function Ot() {
  X(`workspaces:list`, Ie), X(`workspaces:create`, Le), X(`workspaces:rename`, Re), X(`workspaces:remove`, ze), X(`projects:list`, Be), X(`projects:all`, Ve), X(`projects:create`, He), X(`projects:rename`, We), X(`projects:duplicate`, Ge), X(`projects:remove`, Ke), X(`projects:reveal`, qe), X(`projects:copyPath`, Je), X(`projects:save`, bt), X(`projects:saveAs`, xt), X(`projects:open`, St), X(`projects:status`, Ct), X(`autosave:check`, Et), X(`autosave:discard`, Dt), X(`trash:list`, Ze), X(`trash:restore`, Qe), X(`trash:wipe`, tt), X(`trash:empty`, nt)
}
var kt = `thumb.jpg`,
  At = new Set;
async function jt(e) {
  let t = await p.promises.readFile((0, l.join)(e, kt)).catch(() => null);
  return t ? `data:image/jpeg;base64,${t.toString(`base64`)}` : null
}
async function Mt(e, t) {
  let n = B(z(e), z(t)),
    r = await U(n);
  return r.source ? {
    ...r.source,
    thumb: await jt(n)
  } : null
}
async function Nt(e, t, n, r, i) {
  let a = await N(`probe`, {
    path: t,
    thumb: (0, l.join)(e, kt)
  });
  await U(e);
  let {
    thumb: o,
    ...s
  } = a, c = {
    path: t,
    name: n,
    origin: r,
    ...i ? {
      url: i
    } : {},
    ...s
  };
  return await W(e, e => ({
    ...e,
    source: c,
    updatedAt: new Date().toISOString()
  })), {
    ...c,
    thumb: await jt(e)
  }
}
async function Pt(e) {
  let t = c.BrowserWindow.fromWebContents(e.sender),
    n = await c.dialog.showOpenDialog(t, {
      title: `Choose a video`,
      properties: [`openFile`],
      filters: [{
        name: `Videos`,
        extensions: [`mp4`, `mov`, `mkv`, `webm`, `m4v`, `avi`]
      }]
    });
  return n.canceled ? null : n.filePaths[0]
}
async function Ft(e, t, n, r) {
  if (typeof r != `string` || !(0, l.isAbsolute)(r) || !await V(r)) throw Error(`Can’t find that file`);
  let i = z(t),
    a = z(n);
  return await $e(i, a), Nt(B(i, a), r, (0, l.basename)(r), `file`)
}
async function It(e, t, n, r) {
  if (typeof r != `string` || !/^https?:\/\/\S+$/.test(r.trim())) throw Error(`Paste a full link, starting with https://`);
  let i = z(t),
    a = z(n),
    o = `${i}/${a}`;
  if (At.has(o)) throw Error(`A download is already running for this project`);
  At.add(o);
  try {
    let t = B(i, a);
    await $e(i, a);
    let n = t => !e.sender.isDestroyed() && e.sender.send(`source:progress`, {
        ws: i,
        name: a,
        ...t
      }),
      o = await N(`fetch`, {
        url: r.trim(),
        dir: t
      }, e => n({
        pct: e.pct,
        title: e.title
      }));
    return n({
      pct: 100,
      title: o.title,
      stage: `reading`
    }), await Nt(t, o.path, o.title, `youtube`, r.trim())
  } finally {
    At.delete(o)
  }
}
async function Lt(e, t, n) {
  return await $e(z(t), z(n)), null
}

function Rt(e, t) {
  c.ipcMain.handle(e, async (e, ...n) => {
    try {
      return {
        ok: !0,
        data: await t(e, ...n)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}

function zt() {
  Rt(`source:get`, (e, t, n) => Mt(t, n)), Rt(`source:pick`, Pt), Rt(`source:attach`, Ft), Rt(`source:fetch`, It), Rt(`source:remove`, Lt)
}
var Bt = {
    ".mp3": `audio/mpeg`,
    ".m4a": `audio/mp4`,
    ".aac": `audio/aac`,
    ".wav": `audio/wav`,
    ".ogg": `audio/ogg`,
    ".flac": `audio/flac`
  },
  Vt = {
    volume: .15,
    peak: .85,
    offset: 0,
    riser: 5
  },
  Ht = {
    volume: [0, 1],
    peak: [.1, 1],
    offset: [0, 180],
    riser: [0, 20]
  },
  Ut = e => {
    let t = e && typeof e == `object` ? e : {};
    return Object.fromEntries(Object.entries(Ht).map(([e, [n, r]]) => {
      let i = t[e];
      return [e, typeof i == `number` && i >= n && i <= r ? i : Vt[e]]
    }))
  };
async function Wt(e) {
  let t = (await U(e)).music;
  if (!t || !Bt[t.ext]) return null;
  let n = (0, l.join)(e, `music${t.ext}`);
  return await V(n) ? {
    name: t.name,
    duration: t.duration,
    path: n,
    ...Ut(t)
  } : null
}
async function Gt(e, t, n) {
  let r = await Wt(B(z(t), z(n)));
  return r && {
    name: r.name,
    duration: r.duration,
    volume: r.volume,
    peak: r.peak,
    offset: r.offset,
    riser: r.riser
  }
}
async function Kt(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Select Audio`,
      properties: [`openFile`],
      filters: [{
        name: `Audio`,
        extensions: Object.keys(Bt).map(e => e.slice(1))
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  let s = (0, l.extname)(o).toLowerCase();
  if (!Bt[s]) throw Error(`That isn’t an audio file we can play`);
  let {
    duration: u
  } = await N(`loudness`, {
    path: o
  });
  if (!(u > 0)) throw Error(`That audio file is empty`);
  let d = await U(r);
  d.music && await p.promises.rm((0, l.join)(r, `music${d.music.ext}`), {
    force: !0
  }), await p.promises.copyFile(o, (0, l.join)(r, `music${s}`));
  let f = Ut(d.music),
    m = (0, l.basename)(o);
  return await W(r, e => ({
    ...e,
    music: {
      name: m,
      ext: s,
      duration: u,
      ...f
    },
    updatedAt: new Date().toISOString()
  })), {
    name: m,
    duration: u,
    ...f
  }
}
async function qt(e, t, n) {
  let r = B(z(t), z(n)),
    i = await U(r);
  return i.music && await p.promises.rm((0, l.join)(r, `music${i.music.ext}`), {
    force: !0
  }), await W(r, e => ({
    ...e,
    music: null,
    updatedAt: new Date().toISOString()
  })), null
}
async function Jt(e, t, n, r) {
  let i = B(z(t), z(n));
  if (!(await U(i)).music) throw Error(`Add music first`);
  let a = Ut(r);
  return await W(i, e => ({
    ...e,
    music: e.music && {
      ...e.music,
      ...a
    },
    updatedAt: new Date().toISOString()
  })), a
}
async function Yt(e, t, n, r, i) {
  let a = B(z(t), z(n)),
    o = await U(a),
    s = await Wt(a);
  if (!o.source?.hasAudio) throw Error(`This video has no sound to measure`);
  let c = e => typeof e == `number` && Number.isFinite(e) && e >= 0,
    l = await N(`loudness`, {
      path: o.source.path,
      start: c(r) ? r : 0,
      end: c(i) ? i : null
    });
  if (l.mean === null) throw Error(`Couldn’t hear any speech in this clip`);
  let u = s ? (await N(`loudness`, {
      path: s.path
    })).mean ?? -16 : -16,
    d = Math.round(Math.max(.02, Math.min(.35, 10 ** ((l.mean - u - 15) / 20))) * 100) / 100,
    [f, p] = l.mean < -26 ? [.7, `quiet`] : l.mean < -18 ? [.85, `moderate`] : [.9, `loud / punchy`];
  return {
    volume: d,
    peak: f,
    message: `Detected ${p} speech (${l.mean.toFixed(1)} dB). Suggested Ducked: ${Math.round(d*100)}%, Peak: ${Math.round(f*100)}%`
  }
}

function Xt() {
  let e = {
    "music:get": Gt,
    "music:pick": Kt,
    "music:remove": qt,
    "music:levels": Jt,
    "music:suggest": Yt
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var Zt = {
    ".png": `image/png`,
    ".jpg": `image/jpeg`,
    ".jpeg": `image/jpeg`
  },
  Qt = {
    x: 8,
    y: 7,
    scale: 24,
    opacity: .95
  },
  $t = {
    x: [0, 100],
    y: [0, 100],
    scale: [5, 100],
    opacity: [.1, 1]
  },
  en = e => {
    let t = e && typeof e == `object` ? e : {};
    return Object.fromEntries(Object.entries($t).map(([e, [n, r]]) => {
      let i = t[e];
      return [e, typeof i == `number` && i >= n && i <= r ? i : Qt[e]]
    }))
  };
async function tn(e) {
  let t = (await U(e)).watermark;
  if (!t || !Zt[t.ext]) return null;
  let n = (0, l.join)(e, `watermark${t.ext}`);
  return await V(n) ? {
    name: t.name,
    path: n,
    ...en(t)
  } : null
}
async function nn(e, t, n) {
  let r = await tn(B(z(t), z(n)));
  return r && {
    name: r.name,
    x: r.x,
    y: r.y,
    scale: r.scale,
    opacity: r.opacity
  }
}
async function rn(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Select Watermark`,
      properties: [`openFile`],
      filters: [{
        name: `Images`,
        extensions: [`png`, `jpg`, `jpeg`]
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  let s = (0, l.extname)(o).toLowerCase();
  if (!Zt[s]) throw Error(`Pick a PNG or JPG image`);
  let u = await U(r);
  u.watermark && await p.promises.rm((0, l.join)(r, `watermark${u.watermark.ext}`), {
    force: !0
  }), await p.promises.copyFile(o, (0, l.join)(r, `watermark${s}`));
  let d = en(u.watermark),
    f = (0, l.basename)(o);
  return await W(r, e => ({
    ...e,
    watermark: {
      name: f,
      ext: s,
      ...d
    },
    updatedAt: new Date().toISOString()
  })), {
    name: f,
    ...d
  }
}
async function an(e, t, n) {
  let r = B(z(t), z(n)),
    i = await U(r);
  return i.watermark && await p.promises.rm((0, l.join)(r, `watermark${i.watermark.ext}`), {
    force: !0
  }), await W(r, e => ({
    ...e,
    watermark: null,
    updatedAt: new Date().toISOString()
  })), null
}
async function on(e, t, n, r) {
  let i = B(z(t), z(n));
  if (!(await U(i)).watermark) throw Error(`Add a watermark first`);
  let a = en(r);
  return await W(i, e => ({
    ...e,
    watermark: e.watermark && {
      ...e.watermark,
      ...a
    },
    updatedAt: new Date().toISOString()
  })), a
}
var sn = [`youtube`, `instagram`, `tiktok`, `twitter`, `facebook`, `linkedin`, `spotify`, `threads`, `twitch`, `discord`, `snapchat`, `kick`, `whatsapp`, `telegram`, `pinterest`, `reddit`, `applepodcasts`, `github`, `custom`, `none`],
  cn = {
    mode: `template`,
    preset: `none`,
    layout: `column`,
    top: ``,
    groups: [{
      id: `default-group`,
      accounts: [{
        id: `default-account`,
        icon: `youtube`
      }],
      handle: `/yourchannel`
    }],
    font: `Inter`,
    color: `#ffffff`,
    ...Qt,
    tag: `#YourHashtag`,
    tagFont: `Inter`,
    tagColor: `#ffffff`,
    tagPlacement: {
      ...Qt,
      y: 13
    }
  },
  ln = {
    mode: [`template`, `image`],
    preset: [`none`, `promo`, `hashtag`, `dual`],
    layout: [`column`, `row`]
  },
  un = new Set([`top`, `font`, `tag`, `tagFont`]),
  dn = new Set([`color`, `tagColor`]),
  fn = {
    ...$t
  },
  pn = e => {
    let t = e && typeof e == `object` ? e : {},
      n = new Set,
      r = new Set,
      i = (e, t, n) => {
        let r = typeof e == `string` && e.length > 0 && e.length <= 80 ? e : t,
          i = r,
          a = 1;
        for (; n.has(i);) i = `${r}-${a++}`;
        return n.add(i), i
      },
      a = (e, t) => {
        if (!e || typeof e != `object`) return null;
        let n = e,
          a = typeof n.icon == `string` && sn.includes(n.icon) ? n.icon : `youtube`;
        return {
          id: i(n.id, `account-${t+1}`, r),
          icon: a
        }
      },
      o;
    if (Array.isArray(t.groups)) o = t.groups.flatMap((e, t) => {
      if (!e || typeof e != `object`) return [];
      let r = e,
        o = typeof r.handle == `string` && r.handle.length <= 120 ? r.handle : ``,
        s = Array.isArray(r.accounts) ? r.accounts.flatMap((e, t) => {
          let n = a(e, t);
          return n ? [n] : []
        }) : [];
      return s.length ? [{
        id: i(r.id, `group-${t+1}`, n),
        accounts: s,
        handle: o
      }] : []
    });
    else {
      let e = typeof t.icon == `string` || typeof t.handle == `string` ? [{
          id: `legacy-account`,
          icon: t.icon,
          handle: t.handle
        }] : cn.groups.flatMap(e => e.accounts.map(t => ({
          ...t,
          handle: e.handle
        }))),
        r = (Array.isArray(t.accounts) ? t.accounts : e).flatMap((e, t) => {
          let n = a(e, t),
            r = e && typeof e == `object` ? e.handle : void 0,
            i = typeof r == `string` && r.length <= 120 ? r : ``;
          return n ? [{
            ...n,
            handle: i
          }] : []
        });
      if (t.layout === `row` && r.length) {
        let e = typeof t.sharedHandle == `string` && t.sharedHandle.length <= 120 ? t.sharedHandle : r.find(e => e.handle.trim())?.handle ?? cn.groups[0]?.handle ?? `/yourchannel`;
        o = [{
          id: `legacy-row-group`,
          accounts: r.map(({
            handle: e,
            ...t
          }) => t),
          handle: e
        }]
      } else {
        let e = new Map;
        for (let [t, n] of r.entries()) {
          let r = n.handle.trim() ? `handle:${n.handle}` : `empty:${t}`,
            i = e.get(r) ?? {
              handle: n.handle,
              accounts: []
            };
          i.accounts.push({
            id: n.id,
            icon: n.icon
          }), e.set(r, i)
        }
        o = [...e.values()].map((e, t) => ({
          id: i(void 0, `legacy-group-${t+1}`, n),
          ...e
        }))
      }
    }
    let s = t.top === `Full episode out on` ? `` : t.top,
      c = en(t),
      l = en(t.tagPlacement ?? {
        x: c.x,
        y: Math.min(95, c.y + Math.max(5, Math.round(c.scale * .27))),
        scale: c.scale,
        opacity: c.opacity
      });
    return Object.fromEntries(Object.keys(cn).map(e => {
      let n = e === `groups` ? o : e === `top` ? s : e === `tagPlacement` ? l : t[e],
        r = fn[e];
      return [e, (ln[e] ? ln[e].includes(n) : un.has(e) ? typeof n == `string` && n.length <= 120 : dn.has(e) ? typeof n == `string` && /^#[0-9a-f]{6}$/i.test(n) : e === `groups` || e === `tagPlacement` || r && typeof n == `number` && n >= r[0] && n <= r[1]) ? n : cn[e]]
    }))
  },
  mn = e => pn(e.social ?? (e.watermark ? {
    mode: `image`
  } : void 0));
async function hn(e, t, n) {
  return mn(await U(B(z(t), z(n))))
}
async function gn(e, t, n, r) {
  let i = B(z(t), z(n)),
    a = pn(r);
  return await W(i, e => ({
    ...e,
    social: a,
    updatedAt: new Date().toISOString()
  })), a
}
var _n = {
  ...Zt,
  ".webp": `image/webp`,
  ".svg": `image/svg+xml`,
  ".bmp": `image/bmp`
};
async function vn(e) {
  let t = (await U(e)).socialIcon;
  if (!t || !_n[t.ext]) return null;
  let n = (0, l.join)(e, `social-icon${t.ext}`);
  return await V(n) ? {
    name: t.name,
    data: `data:${_n[t.ext]};base64,${(await p.promises.readFile(n)).toString(`base64`)}`
  } : null
}
async function yn(e, t, n) {
  return vn(B(z(t), z(n)))
}
async function bn(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Select Custom Icon`,
      properties: [`openFile`],
      filters: [{
        name: `Images`,
        extensions: [`png`, `jpg`, `jpeg`, `webp`, `svg`, `bmp`]
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  let s = (0, l.extname)(o).toLowerCase();
  if (!_n[s]) throw Error(`Pick a PNG, JPG, WEBP, SVG or BMP image`);
  let u = await U(r);
  return u.socialIcon && await p.promises.rm((0, l.join)(r, `social-icon${u.socialIcon.ext}`), {
    force: !0
  }), await p.promises.copyFile(o, (0, l.join)(r, `social-icon${s}`)), await W(r, e => ({
    ...e,
    socialIcon: {
      name: (0, l.basename)(o),
      ext: s
    },
    updatedAt: new Date().toISOString()
  })), vn(r)
}
async function xn(e, t, n) {
  let r = B(z(t), z(n)),
    i = await U(r);
  return i.socialIcon && await p.promises.rm((0, l.join)(r, `social-icon${i.socialIcon.ext}`), {
    force: !0
  }), await W(r, e => ({
    ...e,
    socialIcon: null,
    updatedAt: new Date().toISOString()
  })), null
}

function Sn() {
  let e = {
    "watermark:icon": yn,
    "watermark:pickIcon": bn,
    "watermark:removeIcon": xn,
    "watermark:get": nn,
    "watermark:pick": rn,
    "watermark:remove": an,
    "watermark:place": on,
    "watermark:social": hn,
    "watermark:setSocial": gn
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var Cn = {
  ".png": `image/png`,
  ".jpg": `image/jpeg`,
  ".jpeg": `image/jpeg`,
  ".webp": `image/webp`
};
async function wn(e) {
  let t = (await U(e)).backdrop;
  if (!t || !Cn[t.ext]) return null;
  let n = (0, l.join)(e, `backdrop${t.ext}`);
  return await V(n) ? {
    name: t.name,
    path: n
  } : null
}
async function Tn(e, t, n) {
  let r = await wn(B(z(t), z(n)));
  return r && {
    name: r.name
  }
}
async function En(e, t, n, r) {
  let i = B(z(t), z(n)),
    a = typeof r == `string` && r ? r : null;
  if (!a) {
    let t = c.BrowserWindow.fromWebContents(e.sender),
      n = await c.dialog.showOpenDialog(t, {
        title: `Import Background Image`,
        properties: [`openFile`],
        filters: [{
          name: `Images`,
          extensions: [`png`, `jpg`, `jpeg`, `webp`]
        }]
      });
    a = n.canceled ? null : n.filePaths[0] ?? null
  }
  if (!a) return null;
  let o = (0, l.extname)(a).toLowerCase();
  if (!Cn[o]) throw Error(`Pick a PNG, JPG or WEBP image`);
  if (!(await p.promises.stat(a)).isFile()) throw Error(`That isn’t a file`);
  let s = (await U(i)).backdrop;
  s && await p.promises.rm((0, l.join)(i, `backdrop${s.ext}`), {
    force: !0
  }), await p.promises.copyFile(a, (0, l.join)(i, `backdrop${o}`));
  let u = (0, l.basename)(a);
  return await W(i, e => ({
    ...e,
    backdrop: {
      name: u,
      ext: o
    },
    updatedAt: new Date().toISOString()
  })), {
    name: u
  }
}
async function Dn(e, t, n) {
  let r = B(z(t), z(n)),
    i = (await U(r)).backdrop;
  return i && await p.promises.rm((0, l.join)(r, `backdrop${i.ext}`), {
    force: !0
  }), await W(r, e => ({
    ...e,
    backdrop: null,
    updatedAt: new Date().toISOString()
  })), null
}

function On() {
  let e = {
    "backdrop:get": Tn,
    "backdrop:pick": En,
    "backdrop:remove": Dn
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var kn = [`vertical`, `split`, `pip`, `trio`, `centered`, `landscape`],
  An = [`9:16`, `1:1`, `4:5`, `16:9`, `4:3`],
  jn = {
    casing: [`as_is`, `uppercase`, `titlecase`, `lowercase`, `camelcase`],
    bold: [!0, !1],
    italic: [!0, !1],
    strokeOn: [!0, !1],
    shadowOn: [!0, !1],
    glowOn: [!0, !1],
    strokePos: [`outside`, `center`, `inside`],
    bg: [!0, !1],
    box: [`full`, `fitted`, `attached`, `per_line`, `none`],
    align: [`left`, `center`, `right`],
    timingMode: [`always`, `custom`],
    timingFade: [!0, !1],
    syncSub: [!0, !1]
  },
  Mn = {
    size: [8, 120],
    spacing: [-3, 8],
    strokeOpacity: [0, 100],
    strokeWidth: [0, 40],
    shadowOpacity: [0, 100],
    shadowX: [-40, 40],
    shadowY: [-40, 40],
    shadowBlur: [0, 50],
    shadowSpread: [0, 30],
    glowOpacity: [0, 100],
    glowIntensity: [0, 60],
    glowSpread: [0, 25],
    bgOpacity: [0, 100],
    radius: [0, 60],
    padY: [2, 40],
    padX: [4, 60],
    y: [5, 95],
    timingStart: [0, 86400],
    timingEnd: [0, 86400]
  },
  Nn = e => {
    let t = e && typeof e == `object` ? e : {},
      n = {};
    for (let [e, r] of Object.entries(jn)) r.includes(t[e]) && (n[e] = t[e]);
    for (let [e, [r, i]] of Object.entries(Mn)) Q(t[e], r, i) && (n[e] = t[e]);
    typeof t.font == `string` && v.test(t.font) && (n.font = t.font), typeof t.weight == `number` && Number.isInteger(t.weight) && t.weight >= 100 && t.weight <= 900 && t.weight % 100 == 0 && (n.weight = t.weight), typeof t.sfxIn == `string` && (n.sfxIn = t.sfxIn), typeof t.sfxOut == `string` && (n.sfxOut = t.sfxOut);
    for (let e of [`color`, `strokeColor`, `shadowColor`, `glowColor`, `bgColor`]) Z(t[e]) && (n[e] = t[e]);
    let r = Fn(t.words);
    Object.keys(r).length && (n.words = r);
    let i = Pn(t.sub);
    return i && (n.sub = i), n
  },
  Pn = e => {
    if (!e || typeof e != `object`) return;
    let t = e,
      n = {};
    typeof t.docked == `boolean` && (n.docked = t.docked), typeof t.inherit == `boolean` && (n.inherit = t.inherit), Q(t.y, 5, 95) && (n.y = t.y), Q(t.size, 6, 120) && (n.size = t.size), Q(t.spacing, -3, 8) && (n.spacing = t.spacing), typeof t.bold == `boolean` && (n.bold = t.bold), typeof t.italic == `boolean` && (n.italic = t.italic), Q(t.timingStart, 0, 86400) && (n.timingStart = t.timingStart), Q(t.timingEnd, 0, 86400) && (n.timingEnd = t.timingEnd), typeof t.bg == `boolean` && (n.bg = t.bg), [`full`, `fitted`, `attached`, `per_line`, `none`].includes(t.box) && (n.box = t.box), [`as_is`, `uppercase`, `titlecase`, `lowercase`].includes(t.casing) && (n.casing = t.casing), typeof t.font == `string` && v.test(t.font) && (n.font = t.font), typeof t.weight == `number` && Number.isInteger(t.weight) && t.weight >= 100 && t.weight <= 900 && t.weight % 100 == 0 && (n.weight = t.weight);
    for (let e of [`color`, `bgColor`]) Z(t[e]) && (n[e] = t[e]);
    for (let e of [`bgOpacity`, `radius`, `padY`, `padX`]) Q(t[e], 0, 100) && (n[e] = t[e]);
    let r = Fn(t.words);
    return Object.keys(r).length && (n.words = r), Object.keys(n).length ? n : void 0
  },
  Fn = e => {
    let t = {};
    if (!e || typeof e != `object`) return t;
    for (let [n, r] of Object.entries(e).slice(0, 240)) {
      if (!/^\d{1,3}$/.test(n) || !r || typeof r != `object`) continue;
      let e = r,
        i = {};
      for (let t of [`bold`, `italic`, `underline`, `strike`]) typeof e[t] == `boolean` && (i[t] = e[t]);
      for (let t of [`color`, `highlight`]) Z(e[t]) && (i[t] = e[t]);
      typeof e.font == `string` && v.test(e.font) && (i.font = e.font), [`uppercase`, `lowercase`, `titlecase`, `as_is`].includes(e.casing) && (i.casing = e.casing), Q(e.size, 6, 140) && (i.size = e.size), Object.keys(i).length && (t[n] = i)
    }
    return t
  },
  Z = e => typeof e == `string` && /^#[0-9a-f]{6}$/i.test(e),
  Q = (e, t, n) => Number.isFinite(e) && e >= t && e <= n,
  In = e => {
    let t = e,
      n = t?.backdrop;
    return !!t && !!n && [`blur`, `color`, `gradient`, `image`].includes(n.kind) && Q(n.blur, 0, 100) && Q(n.dim, 0, 1) && (n.imgBlur === void 0 || Q(n.imgBlur, 0, 25)) && (n.imgDim === void 0 || Q(n.imgDim, 0, .7)) && Z(n.color) && Z(n.from) && Z(n.to) && Q(n.angle, 0, 360) && Q(t.radius, 0, 300) && Q(t.padding, 0, 300) && (t.fill === null || Z(t.fill)) && Q(t.speed, .25, 4) && (t.centerShadow === void 0 || Q(t.centerShadow, 0, 100)) && (t.dividerWidth === void 0 || Q(t.dividerWidth, 0, 30)) && (t.dividerColor === void 0 || Z(t.dividerColor)) && (t.fillKind === void 0 || [`solid`, `gradient`].includes(t.fillKind)) && (t.fillTo === void 0 || Z(t.fillTo)) && (t.fillAngle === void 0 || Q(t.fillAngle, 0, 360))
  },
  Ln = e => Number.isFinite(e) && e >= 0 && e <= 1.0001,
  Rn = e => {
    let t = e;
    return !!t && Ln(t.x) && Ln(t.y) && Ln(t.w) && Ln(t.h)
  },
  zn = e => {
    if (!e || typeof e != `object`) return !1;
    let t = e;
    return (t.shape === void 0 || [`circle`, `rounded`, `rect`].includes(t.shape)) && (t.corner === void 0 || [`tl`, `tr`, `bl`, `br`, `custom`].includes(t.corner)) && (t.x === void 0 || Q(t.x, 0, 100)) && (t.y === void 0 || Q(t.y, 0, 100)) && (t.scale === void 0 || Q(t.scale, 10, 80)) && (t.borderWidth === void 0 || Q(t.borderWidth, 0, 30)) && (t.borderColor === void 0 || Z(t.borderColor)) && (t.shadow === void 0 || typeof t.shadow == `boolean`) && (t.flip === void 0 || typeof t.flip == `boolean`) && (t.radius === void 0 || Q(t.radius, 0, 100))
  },
  Bn = e => {
    if (!e || typeof e != `object`) return !1;
    let t = e;
    return typeof t.id == `string` && typeof t.name == `string` && typeof t.ext == `string` && typeof t.isVideo == `boolean` && Number.isFinite(t.duration) && Number.isFinite(t.in) && Number.isFinite(t.out)
  },
  Vn = e => !e || typeof e != `object` ? !1 : Object.values(e).every(Bn),
  Hn = e => {
    if (!e || typeof e != `object`) return !1;
    let t = e;
    return typeof t.id == `string` && Number.isFinite(t.start) && Number.isFinite(t.end) && t.start >= 0 && t.end > t.start
  },
  Un = e => {
    if (!e || typeof e != `object`) return !1;
    let t = e;
    return typeof t.id == `string` && typeof t.sfxId == `string` && typeof t.name == `string` && Number.isFinite(t.time) && t.time >= 0
  },
  Wn = e => {
    let t = e;
    return !!t && typeof t.id == `string` && t.id.length <= 40 && typeof t.title == `string` && t.title.length <= 120 && Number.isFinite(t.start) && Number.isFinite(t.end) && t.start >= 0 && t.end > t.start && (t.segments === void 0 || Array.isArray(t.segments) && t.segments.every(Hn)) && (t.sfx === void 0 || Array.isArray(t.sfx) && t.sfx.every(Un)) && (t.layout === void 0 || kn.includes(t.layout)) && (t.canvas === void 0 || An.includes(t.canvas)) && (t.crops === void 0 || Array.isArray(t.crops) && t.crops.length <= 3 && t.crops.every(Rn)) && (t.style === void 0 || In(t.style)) && (t.headline === void 0 || !!t.headline && typeof t.headline.text == `string` && t.headline.text.length <= 240 && (t.headline.subtext === void 0 || typeof t.headline.subtext == `string` && t.headline.subtext.length <= 240)) && (t.splitRatio === void 0 || Q(t.splitRatio, .1, .9)) && (t.pip === void 0 || zn(t.pip)) && (t.slotMedia === void 0 || Vn(t.slotMedia))
  };
async function Gn(e, t, n) {
  return ((await U(B(z(t), z(n)))).clips ?? []).filter(Wn)
}
async function Kn(e, t, n, r) {
  if (!Array.isArray(r) || r.length > 500 || !r.every(Wn)) throw Error(`Those clips don’t look right`);
  let i = B(z(t), z(n));
  await U(i);
  let a = r.map(({
    id: e,
    start: t,
    end: n,
    title: r,
    layout: i,
    canvas: a,
    crops: o,
    style: s,
    headline: c,
    splitRatio: l,
    pip: u,
    slotMedia: d,
    segments: f,
    sfx: p
  }) => ({
    id: e,
    start: t,
    end: n,
    title: r,
    layout: i,
    canvas: a,
    crops: o,
    style: s,
    headline: c && {
      text: c.text,
      subtext: typeof c.subtext == `string` ? c.subtext.slice(0, 240) : void 0,
      style: Nn(c.style)
    },
    splitRatio: l,
    pip: u,
    slotMedia: d,
    segments: Array.isArray(f) && f.length > 0 ? f.filter(Hn) : void 0,
    sfx: Array.isArray(p) && p.length > 0 ? p.filter(Un) : void 0
  })).sort((e, t) => e.start - t.start);
  return await W(i, e => ({
    ...e,
    clips: a,
    updatedAt: new Date().toISOString()
  })), null
}
async function qn(e, t, n) {
  let r = (await U(B(z(t), z(n)))).inherit;
  if (!r) return {};
  let i = {
      layout: r.layout,
      canvas: r.canvas,
      style: r.style,
      headline: r.headStyle ? {
        text: ``,
        style: Nn(r.headStyle)
      } : void 0
    },
    a = e => Wn({
      id: `x`,
      start: 0,
      end: 1,
      title: `x`,
      ...e
    });
  return Object.fromEntries(Object.entries(i).filter(([e, t]) => t !== void 0 && a({
    [e]: t
  })))
}

function Jn() {
  for (let [e, t] of [
      [`clips:get`, Gn],
      [`clips:save`, Kn],
      [`clips:inherit`, qn]
    ]) c.ipcMain.handle(e, async (e, ...n) => {
    try {
      return {
        ok: !0,
        data: await t(e, ...n)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var Yn = new Set([`.mp4`, `.mov`]),
  Xn = new Set([`.png`, `.jpg`, `.jpeg`, `.webp`]),
  Zn = {
    enabled: !1,
    size: 260,
    radius: 0,
    bg: `#FFFFFF`,
    text: `Follow for more`,
    font: `Inter`,
    color: `#0F1419`,
    fontSize: 28,
    bold: !0,
    italic: !1,
    duration: 3.5,
    anim: 1.2,
    words: {}
  },
  Qn = {
    size: [120, 500],
    radius: [0, 120],
    fontSize: [10, 140],
    duration: [1.5, 10],
    anim: [.3, 5]
  },
  $n = e => {
    let t = e && typeof e == `object` ? e : {};
    return Object.fromEntries(Object.keys(Zn).map(e => {
      let n = t[e],
        r = Zn[e],
        i = Qn[e];
      return e === `words` ? [e, Fn(n)] : [e, (typeof r == `boolean` ? typeof n == `boolean` : i ? typeof n == `number` && n >= i[0] && n <= i[1] : e === `bg` || e === `color` ? typeof n == `string` && /^#[0-9a-f]{6}$/i.test(n) : typeof n == `string` && n.length <= (e === `text` ? 240 : 120)) ? n : r]
    }))
  },
  er = {
    mode: `template`,
    name: null,
    isImage: !1,
    length: 0,
    duration: 3.5,
    card: Zn
  },
  tr = e => typeof e == `number` && e >= 1 && e <= 10,
  nr = (e, t) => ({
    mode: e?.mode === `custom` ? `custom` : `template`,
    name: t ? e.name ?? null : null,
    isImage: t && Xn.has(e.ext ?? ``),
    length: t && Number(e.length) || 0,
    duration: tr(e?.duration) ? e.duration : er.duration,
    card: $n(e?.card)
  });
async function rr(e) {
  let t = (await U(e).catch(() => ({}))).outro,
    n = t?.ext;
  if (!n) {
    for (let t of [`.mp4`, `.mov`, `.png`, `.jpg`, `.jpeg`, `.webp`])
      if (await V((0, l.join)(e, `outro${t}`))) {
        n = t;
        break
      }
  }
  if (!n) return null;
  let r = (0, l.join)(e, `outro${n}`);
  if (!await V(r)) return null;
  let i = Xn.has(n),
    a = nr(t, !0);
  return {
    path: r,
    isImage: i,
    duration: i ? a.duration : a.length || 3,
    hasAudio: !i && (t?.hasAudio ?? !0)
  }
}
async function ir(e) {
  let t = (await U(e).catch(() => ({}))).outro,
    n = $n(t?.card);
  return n.enabled ? n : null
}
async function ar(e, t) {
  return !!t?.ext && await V((0, l.join)(e, `outro${t.ext}`))
}
async function or(e, t, n) {
  let r = B(z(t), z(n)),
    i = (await U(r)).outro;
  return nr(i, await ar(r, i))
}
async function sr(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Select Outro`,
      properties: [`openFile`],
      filters: [{
        name: `Outro Media`,
        extensions: [`mp4`, `mov`, `png`, `jpg`, `jpeg`, `webp`]
      }, {
        name: `Video Files`,
        extensions: [`mp4`, `mov`]
      }, {
        name: `Images`,
        extensions: [`png`, `jpg`, `jpeg`]
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  let s = (0, l.extname)(o).toLowerCase();
  if (!Yn.has(s) && !Xn.has(s)) throw Error(`Pick an MP4, MOV, PNG, JPG or WEBP file`);
  let u = 0,
    d = !1;
  if (Yn.has(s)) {
    let e = await N(`probe`, {
      path: o
    });
    if (!(e.duration > 0)) throw Error(`That video is empty`);
    u = e.duration, d = !!e.hasAudio
  }
  let f = (await U(r)).outro;
  f?.ext && await p.promises.rm((0, l.join)(r, `outro${f.ext}`), {
    force: !0
  }), await p.promises.copyFile(o, (0, l.join)(r, `outro${s}`));
  let m = {
    ...f,
    mode: `custom`,
    name: (0, l.basename)(o),
    ext: s,
    length: u,
    hasAudio: d,
    duration: tr(f?.duration) ? f.duration : er.duration
  };
  return await W(r, e => ({
    ...e,
    outro: m,
    updatedAt: new Date().toISOString()
  })), nr(m, !0)
}
async function cr(e, t, n) {
  let r = B(z(t), z(n)),
    i = (await U(r)).outro;
  i?.ext && await p.promises.rm((0, l.join)(r, `outro${i.ext}`), {
    force: !0
  });
  let a = {
    card: i?.card,
    picture: i?.picture,
    mode: i?.mode === `custom` ? `custom` : `template`,
    duration: tr(i?.duration) ? i.duration : er.duration
  };
  return await W(r, e => ({
    ...e,
    outro: a,
    updatedAt: new Date().toISOString()
  })), nr(a, !1)
}
async function lr(e, t, n, r) {
  let i = B(z(t), z(n));
  await U(i);
  let a = $n(r);
  return await W(i, e => ({
    ...e,
    outro: {
      ...e.outro ?? {},
      card: a
    },
    updatedAt: new Date().toISOString()
  })), a
}
var ur = {
  ".png": `image/png`,
  ".jpg": `image/jpeg`,
  ".jpeg": `image/jpeg`,
  ".webp": `image/webp`,
  ".svg": `image/svg+xml`,
  ".bmp": `image/bmp`
};
async function dr(e) {
  let t = (await U(e)).outro?.picture;
  if (!t || !ur[t.ext]) return null;
  let n = (0, l.join)(e, `outro-picture${t.ext}`);
  return await V(n) ? {
    name: t.name,
    data: `data:${ur[t.ext]};base64,${(await p.promises.readFile(n)).toString(`base64`)}`
  } : null
}
async function fr(e, t, n) {
  return dr(B(z(t), z(n)))
}
async function pr(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Upload Picture`,
      properties: [`openFile`],
      filters: [{
        name: `Images`,
        extensions: [`png`, `jpg`, `jpeg`, `webp`, `svg`, `bmp`]
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  let s = (0, l.extname)(o).toLowerCase();
  if (!ur[s]) throw Error(`Pick a PNG, JPG, WEBP, SVG or BMP picture`);
  let u = (await U(r)).outro ?? {};
  return u.picture && await p.promises.rm((0, l.join)(r, `outro-picture${u.picture.ext}`), {
    force: !0
  }), await p.promises.copyFile(o, (0, l.join)(r, `outro-picture${s}`)), await W(r, e => ({
    ...e,
    outro: {
      ...e.outro ?? {},
      picture: {
        name: (0, l.basename)(o),
        ext: s
      }
    },
    updatedAt: new Date().toISOString()
  })), dr(r)
}
async function mr(e, t, n) {
  let r = B(z(t), z(n)),
    i = (await U(r)).outro ?? {};
  return i.picture && await p.promises.rm((0, l.join)(r, `outro-picture${i.picture.ext}`), {
    force: !0
  }), await W(r, e => ({
    ...e,
    outro: {
      ...e.outro ?? {},
      picture: null
    },
    updatedAt: new Date().toISOString()
  })), null
}
async function hr(e, t, n, r) {
  let i = B(z(t), z(n)),
    a = r && typeof r == `object` ? r : {},
    o = {};
  return await W(i, e => {
    let t = e.outro ?? {};
    return o = {
      ...t,
      mode: a.mode === `custom` ? `custom` : `template`,
      duration: tr(a.duration) ? a.duration : t.duration ?? er.duration
    }, {
      ...e,
      outro: o,
      updatedAt: new Date().toISOString()
    }
  }), nr(o, await ar(i, o))
}

function gr() {
  let e = {
    "outro:get": or,
    "outro:pick": sr,
    "outro:remove": cr,
    "outro:set": hr,
    "outro:setCard": lr,
    "outro:picture": fr,
    "outro:pickPicture": pr,
    "outro:removePicture": mr
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var _r = {
    ".mp4": `video/mp4`,
    ".m4v": `video/mp4`,
    ".mov": `video/quicktime`,
    ".webm": `video/webm`,
    ".mkv": `video/x-matroska`
  },
  vr = {
    ".png": `image/png`,
    ".jpg": `image/jpeg`,
    ".jpeg": `image/jpeg`,
    ".webp": `image/webp`
  };
async function yr(e, t, n) {
  if (!t) return null;
  let r = (0, l.basename)(t),
    i = n ? (0, l.extname)(`x${n}`).toLowerCase() : ``,
    a = (0, l.join)(e, `slots`);
  if (i) {
    let e = (0, l.join)(a, `${r}${i}`);
    if (await V(e)) return e
  }
  if (await V(a)) {
    let e = (await p.promises.readdir(a)).find(e => e.startsWith(`${r}.`) || e === r);
    if (e) return (0, l.join)(a, e)
  }
  return null
}
async function br(e, t, n, r) {
  let i = B(z(t), z(n)),
    a = typeof r == `string` && r ? r : null;
  if (!a) {
    let t = c.BrowserWindow.fromWebContents(e.sender),
      n = await c.dialog.showOpenDialog(t, {
        title: `Import Slot Media`,
        properties: [`openFile`],
        filters: [{
          name: `Media Files`,
          extensions: [`mp4`, `mov`, `webm`, `mkv`, `png`, `jpg`, `jpeg`, `webp`]
        }, {
          name: `Video Files`,
          extensions: [`mp4`, `mov`, `webm`, `mkv`]
        }, {
          name: `Images`,
          extensions: [`png`, `jpg`, `jpeg`, `webp`]
        }]
      });
    a = n.canceled ? null : n.filePaths[0] ?? null
  }
  if (!a) return null;
  let o = (0, l.extname)(a).toLowerCase(),
    s = o in _r,
    u = o in vr;
  if (!s && !u) throw Error(`Unsupported format. Please select an MP4, MOV, WEBM, MKV video or PNG, JPG, WEBP image.`);
  if (!(await p.promises.stat(a)).isFile()) throw Error(`Selected path is not a file.`);
  let d = (0, l.join)(i, `slots`);
  await p.promises.mkdir(d, {
    recursive: !0
  });
  let f = crypto.randomUUID().slice(0, 8),
    m = (0, l.join)(d, `${f}${o}`);
  await p.promises.copyFile(a, m);
  let h = 0,
    g = 1920,
    _ = 1080;
  try {
    let e = await N(`probe`, {
      path: a
    });
    e.duration && (h = e.duration), e.width && e.height && (g = e.width, _ = e.height)
  } catch {}
  return {
    id: f,
    name: (0, l.basename)(a),
    ext: o,
    path: m,
    isVideo: s,
    duration: h,
    in: 0,
    out: h || 0,
    width: g,
    height: _
  }
}
async function xr(e, t, n, r, i) {
  let a = B(z(t), z(n));
  if (typeof r == `string` && r) {
    let e = await yr(a, r, typeof i == `string` ? i : null);
    e && await V(e) && await p.promises.rm(e, {
      force: !0
    })
  }
  return null
}

function Sr() {
  let e = {
    "slotMedia:pick": br,
    "slotMedia:remove": xr
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var Cr = {
  ".mp3": `audio/mpeg`,
  ".wav": `audio/wav`,
  ".m4a": `audio/mp4`,
  ".aac": `audio/aac`,
  ".ogg": `audio/ogg`,
  ".flac": `audio/flac`
};
async function wr(e) {
  let t = (0, l.join)(e, `sfx`);
  return await V(t) || await p.promises.mkdir(t, {
    recursive: !0
  }), t
}
async function Tr(e) {
  let t = await U(e).catch(() => null),
    n = [],
    r = t?.sfxItems ?? [],
    i = await wr(e);
  for (let e of r) {
    let t = (0, l.join)(i, `${e.id}${e.ext}`);
    await V(t) && n.push({
      ...e,
      path: t
    })
  }
  return n
}
async function Er(e, t, n) {
  let r = (0, l.join)(e, `sfx`, `${t}${n}`);
  return await V(r) ? r : null
}
async function Dr(e, t, n) {
  return Tr(B(z(t), z(n)))
}
async function Or(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Import Sound Effect (SFX)`,
      properties: [`openFile`],
      filters: [{
        name: `Audio Files (*.mp3, *.wav, *.m4a, *.aac)`,
        extensions: Object.keys(Cr).map(e => e.slice(1))
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  let s = (0, l.extname)(o).toLowerCase();
  if (!Cr[s]) throw Error(`Unsupported audio format. Use MP3, WAV, M4A, or AAC.`);
  let u = .5;
  try {
    let e = await N(`loudness`, {
      path: o
    });
    e?.duration && e.duration > 0 && (u = e.duration)
  } catch {
    u = 1
  }
  let d = `sfx_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    f = await wr(r),
    m = (0, l.join)(f, `${d}${s}`);
  await p.promises.copyFile(o, m);
  let h = {
    id: d,
    name: (0, l.basename)(o),
    ext: s,
    duration: u
  };
  return await W(r, e => {
    let t = e.sfxItems ?? [];
    return {
      ...e,
      sfxItems: [...t.filter(e => e.id !== d), h],
      updatedAt: new Date().toISOString()
    }
  }), {
    ...h,
    path: m
  }
}
async function kr(e, t, n, r) {
  if (typeof r != `string`) return !1;
  let i = B(z(t), z(n)),
    a = await U(i).catch(() => null);
  if (!a) return !1;
  let o = (a.sfxItems ?? []).find(e => e.id === r);
  if (o) {
    let e = (0, l.join)(i, `sfx`, `${o.id}${o.ext}`);
    await p.promises.rm(e, {
      force: !0
    }).catch(() => void 0)
  }
  return await W(i, e => ({
    ...e,
    sfxItems: (e.sfxItems ?? []).filter(e => e.id !== r),
    updatedAt: new Date().toISOString()
  })), !0
}

function Ar() {
  for (let [e, t] of [
      [`sfx:list`, Dr],
      [`sfx:import`, Or],
      [`sfx:remove`, kr]
    ]) c.ipcMain.handle(e, async (e, ...n) => {
    try {
      return {
        ok: !0,
        data: await t(e, ...n)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var jr = `clip`,
  Mr = {
    ".mp4": `video/mp4`,
    ".m4v": `video/mp4`,
    ".mov": `video/quicktime`,
    ".webm": `video/webm`,
    ".mkv": `video/x-matroska`
  };

function Nr() {
  c.protocol.registerSchemesAsPrivileged([{
    scheme: jr,
    privileges: {
      standard: !0,
      secure: !0,
      stream: !0,
      supportFetchAPI: !0,
      corsEnabled: !0,
      bypassCSP: !0
    }
  }])
}
async function Pr(e, t) {
  return (await U(B(z(e), z(t))).catch(() => null))?.source?.path ?? null
}
async function Fr(e) {
  let t = new URL(e.url),
    [n = ``, r = ``] = t.pathname.slice(1).split(`/`).map(decodeURIComponent),
    i = t.host,
    a = () => B(z(n), z(r)),
    o = i === `music` ? (await Wt(a()).catch(() => null))?.path : i === `watermark` ? (await tn(a()).catch(() => null))?.path : i === `backdrop` ? (await wn(a()).catch(() => null))?.path : i === `outro` ? (await rr(a()).catch(() => null))?.path : i === `slotmedia` ? await yr(a(), t.searchParams.get(`id`), t.searchParams.get(`ext`)).catch(() => null) : i === `sfx` ? await Er(a(), t.searchParams.get(`id`) ?? ``, t.searchParams.get(`ext`) ?? ``).catch(() => null) : await Pr(n, r).catch(() => null);
  if (!o || !await V(o)) return new Response(`Not found`, {
    status: 404
  });
  let {
    size: s
  } = await p.promises.stat(o), c = (0, l.extname)(o).toLowerCase(), u = {
    "Access-Control-Allow-Origin": `*`,
    "Accept-Ranges": `bytes`,
    "Content-Type": i === `slotmedia` ? {
      ..._r,
      ...vr
    } [c] ?? `video/mp4` : i === `sfx` ? Cr[c] ?? `audio/mpeg` : i === `outro` ? {
      ...Mr,
      ...Cn,
      ...Zt
    } [c] ?? `application/octet-stream` : (i === `music` ? Bt : i === `watermark` ? Zt : i === `backdrop` ? Cn : Mr)[c] ?? `video/mp4`
  }, d = (t, n) => {
    let r = typeof t == `number` && typeof n == `number` ? (0, p.createReadStream)(o, {
      start: t,
      end: n
    }) : (0, p.createReadStream)(o);
    return e.signal && (e.signal.aborted ? r.destroy() : e.signal.addEventListener(`abort`, () => r.destroy(), {
      once: !0
    })), m.Readable.toWeb(r)
  }, f = e.headers.get(`range`);
  if (!f) return new Response(d(), {
    status: 200,
    headers: {
      ...u,
      "Content-Length": String(s)
    }
  });
  let h = /bytes=(\d*)-(\d*)/.exec(f);
  if (!h) return new Response(d(), {
    status: 200,
    headers: {
      ...u,
      "Content-Length": String(s)
    }
  });
  let g = 0,
    _ = s - 1;
  if (h[1]) g = Number(h[1]), _ = h[2] ? Math.min(Number(h[2]), s - 1) : s - 1;
  else if (h[2]) {
    let e = Number(h[2]);
    g = Math.max(0, s - e), _ = s - 1
  }
  return g > _ || g >= s ? new Response(null, {
    status: 416,
    headers: {
      "Content-Range": `bytes */${s}`
    }
  }) : new Response(d(g, _), {
    status: 206,
    headers: {
      ...u,
      "Content-Range": `bytes ${g}-${_}/${s}`,
      "Content-Length": String(_ - g + 1)
    }
  })
}

function Ir() {
  c.protocol.handle(jr, Fr)
}
var Lr = `subtitles.srt`,
  Rr = 5242880,
  zr = /(\d{1,2}:)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[,.](\d{1,3})/,
  Br = (e, t, n, r) => (e ? parseInt(e) * 3600 : 0) + parseInt(t) * 60 + parseInt(n) + parseInt(r.padEnd(3, `0`)) / 1e3;

function Vr(e) {
  let t = [];
  for (let n of e.replace(/^﻿/, ``).split(/\r?\n\s*\r?\n/)) {
    let e = n.split(/\r?\n/).map(e => e.trim()).filter(Boolean),
      r = e.findIndex(e => zr.test(e));
    if (r < 0) continue;
    let i = e[r].match(zr),
      a = Br(i[1], i[2], i[3], i[4]),
      o = Br(i[5], i[6], i[7], i[8]),
      s = e.slice(r + 1).join(`
`).replace(/<[^>]*>/g, ``).replace(/\{[^}]*\}/g, ``).trim();
    s && o > a && t.push({
      start: a,
      end: o,
      text: s
    })
  }
  return t.sort((e, t) => e.start - t.start)
}
var Hr = [`as_is`, `uppercase`, `titlecase`, `lowercase`, `camelcase`],
  Ur = [`pop_in`, `pop_in_full`, `one_by_one`, `build_up`, `highlight`, `full`],
  Wr = (e, t, n) => typeof e == `number` && e >= t && e <= n ? e : void 0,
  Gr = /^#[0-9a-f]{6}$/i,
  Kr = {
    size: [10, 36],
    spacing: [-3, 8],
    strokeOpacity: [0, 100],
    strokeWidth: [0, 40],
    shadowOpacity: [0, 100],
    shadowX: [-40, 40],
    shadowY: [-40, 40],
    shadowBlur: [0, 50],
    shadowSpread: [0, 30],
    glowOpacity: [0, 100],
    glowIntensity: [0, 60],
    glowSpread: [0, 25],
    bgOpacity: [0, 100],
    y: [5, 100]
  };

function qr(e) {
  let t = e && typeof e == `object` ? e : {},
    n = (e, t) => t.includes(e) ? e : void 0,
    r = e => typeof e == `boolean` ? e : void 0,
    i = e => typeof e == `string` && Gr.test(e) ? e : void 0,
    a = {
      ...Object.fromEntries(Object.entries(Kr).map(([e, [n, r]]) => [e, Wr(t[e], n, r)])),
      bg: r(t.bg),
      bgColor: i(t.bgColor),
      strokeOn: r(t.strokeOn),
      shadowOn: r(t.shadowOn),
      glowOn: r(t.glowOn),
      strokeColor: i(t.strokeColor),
      shadowColor: i(t.shadowColor),
      glowColor: i(t.glowColor),
      strokePos: n(t.strokePos, [`outside`, `center`, `inside`]),
      font: typeof t.font == `string` && v.test(t.font) ? t.font : void 0,
      casing: n(t.casing, Hr),
      animation: n(t.animation, Ur),
      color: i(t.color),
      bold: r(t.bold),
      italic: r(t.italic),
      weight: typeof t.weight == `number` && Number.isInteger(t.weight) && t.weight >= 100 && t.weight <= 900 && t.weight % 100 == 0 ? t.weight : void 0
    };
  return Object.fromEntries(Object.entries(a).filter(([, e]) => e !== void 0))
}
async function Jr(e) {
  let t = await U(e);
  if (!t.subtitles) return null;
  let n = await p.promises.readFile((0, l.join)(e, Lr), `utf8`).then(Vr, () => null),
    r = t.subtitles.words && typeof t.subtitles.words == `object` ? t.subtitles.words : {};
  return n && {
    cues: n.map((e, t) => {
      let n = Fn(r[t]);
      return Object.keys(n).length ? {
        ...e,
        words: n
      } : e
    }),
    style: qr(t.subtitles.style)
  }
}
async function Yr(e, t, n) {
  let r = B(z(t), z(n)),
    i = await U(r),
    a = await Jr(r);
  return i.subtitles && a ? {
    name: i.subtitles.name,
    ...a
  } : null
}
async function Xr(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Select Subtitle`,
      properties: [`openFile`],
      filters: [{
        name: `Subtitles`,
        extensions: [`srt`]
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  if ((await p.promises.stat(o)).size > Rr) throw Error(`That subtitle file is too big`);
  let s = await p.promises.readFile(o, `utf8`),
    u = Vr(s);
  if (!u.length) throw Error(`No subtitles found in that file`);
  await p.promises.writeFile((0, l.join)(r, Lr), s);
  let d = await U(r),
    f = (0, l.basename)(o),
    m = qr(d.subtitles?.style ?? d.inherit?.subStyle);
  return await W(r, e => ({
    ...e,
    subtitles: {
      name: f,
      style: m
    },
    updatedAt: new Date().toISOString()
  })), {
    name: f,
    cues: u,
    style: m
  }
}
async function Zr(e, t, n) {
  let r = B(z(t), z(n));
  return await U(r), await p.promises.rm((0, l.join)(r, Lr), {
    force: !0
  }), await W(r, e => ({
    ...e,
    subtitles: null,
    updatedAt: new Date().toISOString()
  })), null
}
var Qr = e => {
    let t = Math.round(e * 1e3),
      n = (e, t = 2) => String(e).padStart(t, `0`);
    return `${n(Math.floor(t/36e5))}:${n(Math.floor(t/6e4)%60)}:${n(Math.floor(t/1e3)%60)},${n(t%1e3,3)}`
  },
  $r = e => e.map((e, t) => `${t+1}\n${Qr(e.start)} --> ${Qr(e.end)}\n${e.text}\n`).join(`
`);

function ei(e) {
  if (!Array.isArray(e) || e.length > 2e4) throw Error(`Those subtitle lines don’t look right`);
  let t = e.map(e => {
    let t = e && typeof e == `object` ? e : {},
      n = Wr(t.start, 0, 86400),
      r = Wr(t.end, 0, 86400),
      i = typeof t.text == `string` ? t.text.replace(/\r/g, ``).trim().slice(0, 1e3) : ``;
    if (n === void 0 || r === void 0 || r <= n || !i) throw Error(`Each line needs text and an end after its start`);
    let a = Fn(t.words);
    return Object.keys(a).length ? {
      start: n,
      end: r,
      text: i,
      words: a
    } : {
      start: n,
      end: r,
      text: i
    }
  });
  if (!t.length) throw Error(`Keep at least one line, or remove the file`);
  return t.sort((e, t) => e.start - t.start)
}
async function ti(e, t, n, r) {
  let i = B(z(t), z(n));
  if (!(await U(i)).subtitles) throw Error(`Add a subtitle file first`);
  let a = ei(r);
  await p.promises.writeFile((0, l.join)(i, Lr), $r(a));
  let o = Object.fromEntries(a.flatMap((e, t) => e.words ? [
    [t, e.words]
  ] : []));
  return await W(i, e => ({
    ...e,
    subtitles: e.subtitles && {
      ...e.subtitles,
      words: o
    },
    updatedAt: new Date().toISOString()
  })), a
}
async function ni(e, t, n, r) {
  let i = B(z(t), z(n));
  if (!(await U(i)).subtitles) throw Error(`Add a subtitle file first`);
  let a = qr(r);
  return await W(i, e => ({
    ...e,
    subtitles: e.subtitles && {
      ...e.subtitles,
      style: a
    },
    updatedAt: new Date().toISOString()
  })), a
}

function ri() {
  let e = {
    "subs:get": Yr,
    "subs:pick": Xr,
    "subs:remove": Zr,
    "subs:style": ni,
    "subs:cues": ti
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var ii = [`twitter`, `viral_tiktok_hook`, `breaking_news`],
  ai = {
    enabled: !1,
    preset: `twitter`,
    theme: `light`,
    name: `Alex Rivera`,
    handle: `@alexrivera`,
    secondary: ``,
    verified: !0,
    hook: {
      light: `What is the single most valuable lesson you learned this year?`,
      dark: `The difference between top 1% creators and everyone else is consistency.`
    }.light,
    font: `Inter`,
    size: 28,
    radius: 20
  },
  oi = e => e.preset === `viral_tiktok_hook` ? {
    bg: `#09090B`,
    box: {
      x: 36,
      y: 670,
      w: 1008,
      h: 568
    }
  } : e.preset === `breaking_news` ? {
    bg: `#0B0F19`,
    box: {
      x: 36,
      y: 660,
      w: 1008,
      h: 568
    }
  } : {
    bg: e.theme === `dark` ? `#000000` : `#FFFFFF`,
    box: {
      x: 36,
      y: 690,
      w: 1008,
      h: 568
    }
  },
  si = {
    name: 60,
    handle: 40,
    secondary: 80,
    hook: 280,
    font: 120
  },
  ci = e => {
    let t = e && typeof e == `object` ? e : {};
    return Object.fromEntries(Object.keys(ai).map(e => {
      let n = t[e],
        r = ai[e];
      return [e, (typeof r == `boolean` ? typeof n == `boolean` : e === `theme` ? n === `light` || n === `dark` : e === `preset` ? ii.includes(n) : e === `size` ? typeof n == `number` && n >= 18 && n <= 44 : e === `radius` ? typeof n == `number` && n >= 0 && n <= 40 : typeof n == `string` && n.length <= si[e]) ? n : r]
    }))
  },
  li = async e => (await U(e)).template ?? {};
async function ui(e) {
  let t = ci(await li(e));
  return t.enabled ? t : null
}
async function di(e, t, n) {
  return ci(await li(B(z(t), z(n))))
}
async function fi(e, t, n, r) {
  let i = B(z(t), z(n));
  await U(i);
  let a = ci(r);
  return await W(i, e => ({
    ...e,
    template: {
      ...e.template ?? {},
      ...a
    },
    updatedAt: new Date().toISOString()
  })), a
}
var pi = {
  ".png": `image/png`,
  ".jpg": `image/jpeg`,
  ".jpeg": `image/jpeg`,
  ".webp": `image/webp`,
  ".gif": `image/gif`,
  ".bmp": `image/bmp`
};
async function mi(e) {
  let t = (await li(e)).avatar;
  if (!t || !pi[t.ext]) return null;
  let n = (0, l.join)(e, `template-avatar${t.ext}`);
  return await V(n) ? {
    name: t.name,
    data: `data:${pi[t.ext]};base64,${(await p.promises.readFile(n)).toString(`base64`)}`
  } : null
}
async function hi(e, t, n) {
  return mi(B(z(t), z(n)))
}
async function gi(e, t, n) {
  let r = B(z(t), z(n)),
    i = c.BrowserWindow.fromWebContents(e.sender),
    a = await c.dialog.showOpenDialog(i, {
      title: `Upload Avatar`,
      properties: [`openFile`],
      filters: [{
        name: `Images`,
        extensions: [`png`, `jpg`, `jpeg`, `webp`, `gif`, `bmp`]
      }]
    }),
    o = a.canceled ? null : a.filePaths[0];
  if (!o) return null;
  let s = (0, l.extname)(o).toLowerCase();
  if (!pi[s]) throw Error(`Pick a PNG, JPG, WEBP, GIF or BMP picture`);
  let u = (await U(r)).template ?? {};
  return u.avatar && await p.promises.rm((0, l.join)(r, `template-avatar${u.avatar.ext}`), {
    force: !0
  }), await p.promises.copyFile(o, (0, l.join)(r, `template-avatar${s}`)), await W(r, e => ({
    ...e,
    template: {
      ...e.template ?? {},
      avatar: {
        name: (0, l.basename)(o),
        ext: s
      }
    },
    updatedAt: new Date().toISOString()
  })), mi(r)
}
async function _i(e, t, n) {
  let r = B(z(t), z(n)),
    i = (await U(r)).template ?? {};
  return i.avatar && await p.promises.rm((0, l.join)(r, `template-avatar${i.avatar.ext}`), {
    force: !0
  }), await W(r, e => ({
    ...e,
    template: {
      ...e.template ?? {},
      avatar: null
    },
    updatedAt: new Date().toISOString()
  })), null
}

function vi() {
  let e = {
    "template:get": di,
    "template:set": fi,
    "template:avatar": hi,
    "template:pickAvatar": gi,
    "template:removeAvatar": _i
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var yi = [`720p`, `1080p`, `2k`, `4k`, `source`],
  bi = [`auto`, `nvenc`, `amf`, `qsv`, `videotoolbox`, `cpu`],
  xi = new Set,
  Si = (e, t, n) => `${e}/${t}/${n}`,
  Ci = e => {
    if (!e || typeof e != `object`) return !1;
    let t = e;
    return typeof t.id == `string` && Number.isFinite(t.start) && Number.isFinite(t.end) && t.start >= 0 && t.end > t.start
  },
  wi = e => {
    if (!e || typeof e != `object`) return !1;
    let t = e;
    return typeof t.id == `string` && typeof t.sfxId == `string` && typeof t.name == `string` && Number.isFinite(t.time) && t.time >= 0 && (t.volume === void 0 || Number.isFinite(t.volume))
  };
async function Ti(e, t, n, r, i) {
  let a = z(t),
    o = z(n);
  if (!yi.includes(i?.resolution) || !bi.includes(i?.encoder)) throw Error(`Those export settings don’t look right`);
  let s = typeof i?.folder == `string` && i.folder.trim() ? i.folder.trim() : null;
  if (s && !await V(s)) try {
    await p.promises.mkdir(s, {
      recursive: !0
    })
  } catch {
    s = null
  }
  if (typeof i.name != `string` || i.name.length > 120) throw Error(`That file name is too long`);
  let c = e => {
      if (typeof e != `string` || !e.trim()) return null;
      let t = e.includes(`,`) ? e.split(`,`)[1].trim() : e.trim();
      return t.length <= 4e7 && (t.startsWith(`iVBORw0KGgo`) || /^[A-Za-z0-9+/=\s]+$/.test(t)) ? t : null
    },
    u = c(i.headline),
    d = c(i.subheadline),
    f = c(i.badges ?? null),
    m = B(a, o),
    h = await U(m),
    g = h.clips?.find(e => e.id === r);
  if (!h.source || !g) throw Error(`That clip is gone`);
  let _ = i.segments === void 0 ? g.segments ?? [] : i.segments ?? [];
  if (!Array.isArray(_) || !_.every(Ci)) throw Error(`Those segment settings don’t look right`);
  let v = [..._].sort((e, t) => e.start - t.start);
  g.segments = v.length ? v : void 0;
  let y = i.sfx === void 0 ? g.sfx ?? [] : i.sfx;
  if (!Array.isArray(y) || !y.every(wi)) throw Error(`Those sound-effect placements don’t look right`);
  if (!s && h.source.path) {
    let e = (0, l.join)((0, l.dirname)(h.source.path), `YIZERGE Clips`);
    try {
      await p.promises.mkdir(e, {
        recursive: !0
      }), s = e
    } catch {
      s = null
    }
  }
  i.range && Number.isFinite(i.range.start) && Number.isFinite(i.range.end) && i.range.end > i.range.start && (g.start = i.range.start, g.end = i.range.end);
  let ee = g.crops ?? (Array.isArray(i.crops) && i.crops.length <= 3 && i.crops.every(Rn) ? i.crops : []),
    te = Si(a, o, g.id),
    b = await Jr(m);
  if (b) {
    let e = new Map;
    if (b.style?.font) {
      let t = b.style.weight ?? 400;
      e.set(b.style.font, [t, b.style.bold ? t >= 700 ? 900 : 700 : t])
    }
    if (Array.isArray(b.cues)) {
      for (let t of b.cues)
        if (Array.isArray(t.words))
          for (let n of t.words) n.font && !e.has(n.font) && e.set(n.font, [400, 700])
    }
    for (let [t, n] of e) await de(t, n).catch(() => void 0)
  }
  let x = await Wt(m),
    ne = x && {
      path: x.path,
      duration: x.duration,
      volume: x.volume,
      peak: x.peak,
      offset: x.offset,
      riser: x.riser
    },
    re = mn(h).mode === `template`,
    S = re ? null : await tn(m),
    C = S && {
      path: S.path,
      x: S.x,
      y: S.y,
      scale: S.scale,
      opacity: S.opacity
    },
    w = i.card,
    T = w && await ir(m),
    ie = w ? c(w.picture) : null,
    ae = w ? c(w.text) : null,
    oe = T && w && ie ? {
      kind: `template`,
      duration: T.duration,
      anim: T.anim,
      bg: T.bg,
      picture: ie,
      picCy: w.picCy,
      text: ae,
      textTop: w.textTop
    } : await rr(m),
    E = await ui(m),
    se = E && i.frame ? c(i.frame) : null,
    ce = E && se ? {
      ...oi(E),
      card: se
    } : null,
    le = (await wn(m))?.path ?? null,
    ue = {};
  if (g.slotMedia && typeof g.slotMedia == `object`) {
    for (let [e, t] of Object.entries(g.slotMedia))
      if (t && typeof t == `object` && `id` in t) {
        let n = t,
          r = await yr(m, n.id, n.ext);
        r && (ue[e] = {
          ...t,
          path: r
        })
      }
  }
  let D = await Tr(m),
    O = [],
    k = g.style?.speed ?? 1,
    A = v.length > 1 ? v : null,
    fe = e => {
      if (!A) return Math.max(0, e - g.start) / k;
      let t = 0;
      for (let n of A) {
        if (e >= n.start && e <= n.end) return (t + (e - n.start)) / k;
        if (e < n.start) return t / k;
        t += n.end - n.start
      }
      return t / k
    },
    j = e => A ? A.some(t => e >= t.start && e <= t.end) : e >= g.start && e <= g.end;
  for (let e of y)
    if (j(e.time)) {
      let t = D.find(t => t.id === e.sfxId);
      if (!t) throw Error(`Sound effect "${e.name}" is missing from this project’s library`);
      O.push({
        path: t.path,
        time: fe(e.time),
        volume: e.volume ?? 1
      })
    } let M = g.headline?.style;
  if (M && M.timingMode === `custom`) {
    if (M.sfxIn) {
      let e = D.find(e => e.id === M.sfxIn);
      e && O.push({
        path: e.path,
        time: M.timingStart ?? 0,
        volume: 1
      })
    }
    if (M.sfxOut) {
      let e = D.find(e => e.id === M.sfxOut);
      e && O.push({
        path: e.path,
        time: M.timingEnd ?? 3.5,
        volume: 1
      })
    }
  }
  let pe = M ? {
      mode: M.timingMode ?? `always`,
      start: M.timingStart ?? 0,
      end: M.timingEnd ?? 3.5,
      fade: M.timingFade !== !1
    } : null,
    me = M?.sub,
    he = M ? {
      mode: M.timingMode ?? `always`,
      start: M.syncSub === !1 ? me?.timingStart ?? 0 : M.timingStart ?? 0,
      end: M.syncSub === !1 ? me?.timingEnd ?? 3.5 : M.timingEnd ?? 3.5,
      fade: M.timingFade !== !1
    } : null,
    P = A,
    ge = t => e.sender.isDestroyed() || e.sender.send(`export:progress`, {
      key: te,
      ...t
    }),
    _e = await N(`export`, {
      key: te,
      source: h.source,
      clip: {
        ...g,
        crops: ee,
        slotMedia: ue
      },
      style: g.style ?? null,
      canvas: ce ? `9:16` : g.canvas ?? `9:16`,
      frame: ce,
      resolution: i.resolution,
      encoder: i.encoder,
      folder: s,
      name: i.name.trim(),
      subs: b?.cues ?? null,
      subStyle: b?.style ?? null,
      headline: ce ? null : u,
      subheadline: ce ? null : d,
      badges: re ? f : null,
      music: ne,
      watermark: C,
      outro: oe,
      backdropImage: le,
      headTiming: pe,
      subTiming: he,
      segments: P,
      sfx: O,
      muteVideoAudio: i.muteVideoAudio
    }, e => ge({
      pct: Number(e.pct) || 0,
      status: String(e.status ?? ``)
    }));
  return xi.add(_e.path), await p.promises.writeFile(Ei, JSON.stringify({
    path: _e.path
  })).catch(() => void 0), _e
}
var Ei = (0, l.join)(c.app.getPath(`userData`), `last-export.json`);
async function Di() {
  let e = await p.promises.readFile(Ei, `utf8`).then(e => JSON.parse(e).path).catch(() => null);
  if (typeof e == `string` && await V(e)) return c.shell.showItemInFolder(e), null;
  if (typeof e == `string` && await V((0, l.dirname)(e))) return await c.shell.openPath((0, l.dirname)(e)), null;
  throw Error(`No exported video found yet. Export a video first to open its location.`)
}
async function Oi(e, t, n, r) {
  return await N(`cancel`, {
    key: Si(z(t), z(n), String(r))
  }), null
}
async function ki(e) {
  let t = c.BrowserWindow.fromWebContents(e.sender),
    n = await c.dialog.showOpenDialog(t, {
      title: `Export Destination`,
      properties: [`openDirectory`, `createDirectory`]
    });
  return n.canceled ? null : n.filePaths[0] ?? null
}
async function Ai(e, t) {
  if (typeof t != `string` || !xi.has(t)) throw Error(`That file wasn’t exported here`);
  return c.shell.showItemInFolder(t), null
}
async function ji(e, t) {
  if (typeof t != `string` || !xi.has(t)) throw Error(`That file wasn’t exported here`);
  let n = await c.shell.openPath(t);
  if (n) throw Error(n);
  return null
}

function Mi() {
  let e = {
    "export:start": Ti,
    "export:cancel": Oi,
    "export:folder": ki,
    "export:reveal": Ai,
    "export:open": ji,
    "export:last": Di
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var Ni = (0, l.join)(c.app.getPath(`userData`), `presets.json`),
  Pi = e => !!e && typeof e == `object` && !Array.isArray(e) && JSON.stringify(e).length < 2e4;
async function Fi() {
  try {
    let e = JSON.parse(await (0, h.readFile)(Ni, `utf8`));
    return Array.isArray(e) ? e.filter(e => e && typeof e.id == `string` && typeof e.name == `string` && Pi(e.head) && Pi(e.sub)) : []
  } catch {
    return []
  }
}
async function Ii(e) {
  return await (0, h.writeFile)(`${Ni}.tmp`, JSON.stringify(e, null, 2)), await (0, h.rename)(`${Ni}.tmp`, Ni), e
}
async function Li(e, t, n) {
  let r = typeof e == `string` ? e.trim().slice(0, 32) : ``;
  if (!r) throw Error(`Please enter a preset name.`);
  if (!Pi(t) || !Pi(n)) throw Error(`That style doesn’t look right`);
  let i = {
    id: `preset_${Date.now()}`,
    name: r,
    head: t,
    sub: n
  };
  return await Ii([...await Fi(), i]), i
}
var Ri = async e => Ii((await Fi()).filter(t => t.id !== e));

function zi() {
  let e = {
    "presets:list": () => Fi(),
    "presets:save": (e, t, n, r) => Li(t, n, r),
    "presets:remove": (e, t) => Ri(t)
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
var Bi = [`cc`, `v1`, `a1`, `a2`],
  Vi = e => {
    let t = e && typeof e == `object` ? e : {};
    return Object.fromEntries(Bi.map(e => [e, t[e] === !0]))
  };
async function Hi(e, t, n) {
  return Vi((await U(B(z(t), z(n)))).tracks)
}
async function Ui(e, t, n, r) {
  let i = B(z(t), z(n)),
    a = Vi(r);
  return await W(i, e => ({
    ...e,
    tracks: a
  })), a
}

function Wi() {
  let e = {
    "tracks:get": Hi,
    "tracks:set": Ui
  };
  for (let [t, n] of Object.entries(e)) c.ipcMain.handle(t, async (e, ...t) => {
    try {
      return {
        ok: !0,
        data: await n(e, ...t)
      }
    } catch (e) {
      return {
        ok: !1,
        error: e.message
      }
    }
  })
}
c.app.commandLine.appendSwitch(`ignore-gpu-blocklist`), c.app.commandLine.appendSwitch(`enable-gpu-rasterization`), c.app.commandLine.appendSwitch(`enable-zero-copy`), c.app.commandLine.appendSwitch(`autoplay-policy`, `no-user-gesture-required`), c.app.requestSingleInstanceLock() || c.app.quit(), c.app.on(`second-instance`, (e, t) => Ji(t.slice(1))), c.app.on(`open-file`, (e, t) => {
  e.preventDefault(), Ji([t])
}), c.app.on(`open-url`, e => {
  e.preventDefault(), Ji([])
}), c.app.isPackaged && c.app.setAsDefaultProtocolClient(`yizerge`);
var Gi = [],
  Ki = !1,
  $ = null;

function qi() {
  $ && !$.isDestroyed() && ($.isVisible() || ($.maximize(), $.show(), $.focus(), setTimeout(ve, 250)))
}
c.ipcMain.on(`menu:ready`, () => {
  Ki = !0, qi(), Yi()
});

function Ji(e) {
  Gi.push(...e.filter(e => e.toLowerCase().endsWith(`.yizerge`))), Yi()
}
async function Yi() {
  let e = $ ?? c.BrowserWindow.getAllWindows().find(e => e.isVisible());
  if (e && Ki)
    for (e.isMinimized() && e.restore(), e.focus(); Gi.length;) {
      let t = Gi.shift();
      try {
        e.webContents.send(`menu`, `open:${await vt(t)}`)
      } catch (e) {
        c.dialog.showErrorBox(`Couldn’t open project`, e.message)
      }
    }
}
Ji(process.argv.slice(1));

function Xi() {
  if ($ && !$.isDestroyed()) {
    qi();
    return
  }
  let e = process.platform === `win32` ? (0, l.join)(__dirname, `../../build/icon.ico`) : (0, l.join)(__dirname, `../../build/icon.png`);
  process.platform === `darwin` && !c.app.isPackaged && c.app.dock?.setIcon(e), $ = new c.BrowserWindow({
    width: 1200,
    height: 800,
    show: !1,
    icon: e,
    backgroundColor: c.nativeTheme.shouldUseDarkColors ? `#141414` : `#ffffff`,
    titleBarStyle: process.platform === `darwin` ? `hiddenInset` : `hidden`,
    ...process.platform === `darwin` ? {} : {
      titleBarOverlay: {
        color: c.nativeTheme.shouldUseDarkColors ? `#141414` : `#ffffff`,
        symbolColor: c.nativeTheme.shouldUseDarkColors ? `#ffffff` : `#000000`,
        height: 48
      }
    },
    webPreferences: {
      preload: (0, l.join)(__dirname, `../preload/index.js`),
      contextIsolation: !0,
      sandbox: !0
    }
  });
  let t = e => () => $?.webContents.send(`window:fullscreen`, e);
  $.on(`enter-full-screen`, t(!0)), $.on(`leave-full-screen`, t(!1)), $.once(`ready-to-show`, () => {
    qi(), Ce(e => {
      $?.webContents.send(`beta:lockout`, e)
    })
  }), setTimeout(qi, 7500), process.env.ELECTRON_RENDERER_URL ? $.loadURL(process.env.ELECTRON_RENDERER_URL) : $.loadFile((0, l.join)(__dirname, `../renderer/index.html`))
}
c.ipcMain.handle(`ping`, () => `pong from main`), c.ipcMain.handle(`app:version`, () => c.app.getVersion()), c.ipcMain.handle(`beta:status`, () => Se()), c.ipcMain.handle(`app:openExternal`, async (e, t) => {
  typeof t == `string` && /^https?:\/\//.test(t) && await c.shell.openExternal(t)
}), c.ipcMain.on(`app:quit`, () => c.app.quit()), c.ipcMain.on(`window:overlay`, (e, t, n) => {
  let r = e => typeof e == `string` && /^#[0-9a-f]{6}$/i.test(e);
  process.platform !== `darwin` && r(t) && r(n) && c.BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({
    color: t,
    symbolColor: n
  })
}), c.ipcMain.handle(`window:isFullscreen`, e => c.BrowserWindow.fromWebContents(e.sender)?.isFullScreen() ?? !1), c.ipcMain.on(`window:toggleFullscreen`, e => {
  let t = c.BrowserWindow.fromWebContents(e.sender);
  t && t.setFullScreen(!t.isFullScreen())
}), c.ipcMain.handle(`os:user`, () => {
  let e = (0, d.userInfo)().username,
    t = e;
  try {
    process.platform === `darwin` && (t = (0, u.execFileSync)(`id`, [`-F`], {
      encoding: `utf8`
    }).trim() || e)
  } catch {}
  return {
    name: t,
    login: e
  }
}), c.ipcMain.handle(`engine:call`, (e, t, n) => N(t, n)), Ot(), zt(), Jn(), Mi(), ri(), Xt(), Sn(), On(), gr(), zi(), vi(), Wi(), Sr(), Ar(), fe(), Nr(), c.app.whenReady().then(async () => {
  _e(), ce().catch(e => console.error(`[fonts]`, e));
  let e = e => () => c.BrowserWindow.getAllWindows()[0]?.webContents.send(`menu`, e),
    t = (t, n, r) => ({
      label: t,
      click: e(n),
      ...r ? {
        accelerator: r,
        registerAccelerator: !1
      } : {}
    }),
    n = {
      type: `separator`
    };
  process.platform === `darwin` ? c.Menu.setApplicationMenu(c.Menu.buildFromTemplate([{
    label: c.app.name,
    submenu: [{
      role: `about`
    }, n, {
      label: `Settings…`,
      accelerator: `Cmd+,`,
      click: e(`settings`)
    }, n, {
      role: `services`
    }, n, {
      role: `hide`
    }, {
      role: `hideOthers`
    }, {
      role: `unhide`
    }, n, {
      role: `quit`
    }]
  }, {
    label: `File`,
    submenu: [t(`New Project`, `project`, `Cmd+N`), t(`Import Settings from Last Project…`, `import-settings`), t(`Open Project…`, `open-project`, `Cmd+O`), n, t(`Save`, `save`, `Cmd+S`), t(`Save As…`, `save-as`, `Cmd+Shift+S`), n, t(`Import Video…`, `import`), t(`Import Subtitle…`, `import-subtitle`), t(`Import Music…`, `import-music`), t(`Import Outro…`, `import-outro`), n, t(`Export Video…`, `export`, `Cmd+M`), t(`Quick Export`, `quick-export`, `Cmd+Shift+M`), t(`Open Export Location`, `open-export`), n, {
      label: `Trash`,
      click: e(`trash`)
    }, n, {
      role: `close`
    }]
  }, {
    label: `Edit`,
    submenu: [{
      role: `undo`
    }, {
      role: `redo`
    }, n, {
      role: `cut`
    }, {
      role: `copy`
    }, {
      role: `paste`
    }, {
      role: `selectAll`
    }, n, t(`Set In Point`, `set-in`, `I`), t(`Set Out Point`, `set-out`, `O`), t(`Clear Trim`, `clear-trim`), n, t(`Reset All Project Settings`, `reset-all`), t(`Reset Crop Boxes`, `reset-crops`), t(`Reset Zoom`, `reset-zoom`)]
  }, {
    label: `View`,
    submenu: [t(`Home`, `home`), t(`Editor`, `editor`), n, t(`Open Export Location`, `open-export`), n, t(`Toggle Inspector`, `inspector`), t(`Live 9:16 Preview`, `preview`, `Cmd+L`), t(`Fullscreen Player`, `fullscreen`, "Cmd+`"), n, t(`Toggle Dark / Light`, `theme`), n, {
      role: `reload`
    }, {
      role: `toggleDevTools`
    }, {
      role: `togglefullscreen`
    }]
  }, {
    label: `Window`,
    submenu: [{
      label: `Minimize`,
      click: (e, t) => t?.minimize()
    }, {
      role: `zoom`
    }, n, {
      role: `front`
    }]
  }, {
    role: `help`,
    submenu: [t(`Keyboard Shortcuts`, `shortcuts`, `?`)]
  }])) : c.Menu.setApplicationMenu(null), me(), Ir(), Xi(), c.app.on(`activate`, () => (!$ || $.isDestroyed()) && Xi())
}), c.app.on(`window-all-closed`, () => {
  he(), process.platform !== `darwin` && c.app.quit()
}), c.app.on(`before-quit`, he);