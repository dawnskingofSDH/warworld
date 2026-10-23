/* WARWORLD — shared utilities. All code runs offline. */
(function () {
  'use strict';
  const WW = (window.WW = window.WW || {});

  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (t) => t * t * (3 - 2 * t);
  U.invLerp = (a, b, v) => (v - a) / (b - a || 1);
  U.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  U.dist2 = (x1, y1, x2, y2) => {
    const dx = x2 - x1, dy = y2 - y1;
    return dx * dx + dy * dy;
  };
  U.tileDist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  U.choice = (arr, rng) => arr[Math.floor((rng ? rng.next() : Math.random()) * arr.length)];
  U.shuffle = (arr, rng) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor((rng ? rng.next() : Math.random()) * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  U.pickWeighted = (items, weights, rng) => {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    let r = (rng ? rng.next() : Math.random()) * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };
  U.round = (n, d = 0) => {
    const p = Math.pow(10, d);
    return Math.round(n * p) / p;
  };
  U.fmt = (n, d = 0) => {
    if (!isFinite(n)) return '—';
    const v = d === 0 ? Math.floor(n) : U.round(n, d);
    return v.toLocaleString('zh-CN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  };
  U.fmtSigned = (n, d = 0) => (n > 0 ? '+' : '') + U.fmt(n, d);
  U.pct = (n, d = 0) => U.round(n * 100, d) + '%';
  U.roman = (n) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] || String(n);
  U.cnNum = (n) => ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n] || String(n);
  U.hashString = (str) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // Small deterministic PRNG. State is serializable.
  U.RNG = class RNG {
    constructor(seed) {
      this.state = (typeof seed === 'string' ? U.hashString(seed) : (seed >>> 0)) || 0x9e3779b9;
      if (this.state === 0) this.state = 0x9e3779b9;
    }
    next() {
      let t = (this.state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
    float(a, b) { return a + this.next() * (b - a); }
    pick(a) { return a[Math.floor(this.next() * a.length)]; }
    chance(p) { return this.next() < p; }
  };

  // Hash based smooth value noise with fbm support.
  function hash2(ix, iy, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  U.Noise = class Noise {
    constructor(seed) { this.seed = seed | 0; }
    value(x, y) {
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const tx = U.smooth(x - x0), ty = U.smooth(y - y0);
      const a = hash2(x0, y0, this.seed), b = hash2(x0 + 1, y0, this.seed);
      const c = hash2(x0, y0 + 1, this.seed), d = hash2(x0 + 1, y0 + 1, this.seed);
      return U.lerp(U.lerp(a, b, tx), U.lerp(c, d, tx), ty);
    }
    fbm(x, y, oct = 4, lac = 2.02, gain = 0.5) {
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += this.value(x * freq, y * freq) * amp;
        norm += amp;
        amp *= gain;
        freq *= lac;
      }
      return sum / norm;
    }
    ridged(x, y, oct = 4) {
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        const v = 1 - Math.abs(this.value(x * freq, y * freq) * 2 - 1);
        sum += v * v * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum / norm;
    }
  };

  U.hexToRgb = (hex) => {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  U.rgba = (hex, a) => {
    const c = U.hexToRgb(hex);
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  };
  U.mixColor = (a, b, t) => {
    const ca = U.hexToRgb(a), cb = U.hexToRgb(b);
    return '#' + [0, 1, 2].map((i) => Math.round(U.lerp([ca.r, ca.g, ca.b][i], [cb.r, cb.g, cb.b][i], t)).toString(16).padStart(2, '0')).join('');
  };
  U.shade = (hex, amt) => {
    const c = U.hexToRgb(hex);
    const f = (v) => U.clamp(Math.round(v + amt), 0, 255).toString(16).padStart(2, '0');
    return '#' + f(c.r) + f(c.g) + f(c.b);
  };
  U.darken = (hex, f = 0.25) => U.mixColor(hex, '#000000', f);

  U.timeToDate = (days) => {
    const day = Math.floor(days % 360);
    const year = Math.floor(days / 360) + 1;
    const seasonIdx = Math.floor(day / 90) % 4;
    const seasons = ['春', '夏', '秋', '冬'];
    return { year, day: (day % 90) + 1, season: seasons[seasonIdx], seasonIdx, dayOfYear: day + 1 };
  };
  U.dateLabel = (days, short) => {
    const d = U.timeToDate(days);
    return short ? `第${d.year}年·${d.season}` : `主历 ${d.year} 年 · ${d.season}季 · 第 ${d.day} 日`;
  };
  U.seasonName = (i) => ['春', '夏', '秋', '冬'][i % 4];

  U.uid = (() => {
    let n = 1;
    return (prefix = 'id') => prefix + '_' + (n++).toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  })();

  // Generic tiny event emitter.
  U.Emitter = class Emitter {
    constructor() { this._events = Object.create(null); }
    on(name, fn) { (this._events[name] || (this._events[name] = [])).push(fn); return this; }
    emit(name, ...args) { (this._events[name] || []).forEach((fn) => { try { fn(...args); } catch (e) { console.error(e); } }); }
  };

  // Line of sight-ish Bresenham for projectiles / line placement.
  U.lineTiles = (x0, y0, x1, y1) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const pts = [];
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 400; guard++) {
      pts.push({ x: x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return pts;
  };

  U.storage = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    remove(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  WW.U = U;
})();
