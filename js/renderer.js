/* WARWORLD — painterly canvas renderer and procedural miniature art. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;

  const TILE = 32;
  const CHUNK = 16;
  const CACHE_MAX = 72;

  function hash(x, y, salt) {
    let h = Math.imul((x | 0) + 0x9e37, 374761393) ^ Math.imul((y | 0) + 0x85eb, 668265263) ^ Math.imul((salt || 0) + 1, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }

  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  const LEVEL_PALETTE = [
    null,
    { wall: '#8b6a49', wallDark: '#5d442d', roof: '#a38151', roofDark: '#6c5032', trim: '#d0b477', stone: '#8a8171' },
    { wall: '#8c7c63', wallDark: '#5d5140', roof: '#73513b', roofDark: '#4d3528', trim: '#cdb67e', stone: '#948b78' },
    { wall: '#969084', wallDark: '#5e5a51', roof: '#4c5357', roofDark: '#343a3d', trim: '#ddc98e', stone: '#8e877a' },
    { wall: '#89847b', wallDark: '#504d47', roof: '#393e43', roofDark: '#262a2e', trim: '#efd488', stone: '#767167' }
  ];

  class Renderer {
    constructor(canvas, game) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.game = game;
      this.vw = 1;
      this.vh = 1;
      this.dpr = 1;
      this.camera = { x: game ? game.world.w / 2 : 0, y: game ? game.world.h / 2 : 0, zoom: 1.22 };
      this.chunks = new Map();
      this.anim = 0;
      this.selection = { unitIds: [], buildingId: null, nodeId: null, settlementId: null };
      this.hover = null;
      this.placement = null;
      this.selectionRect = null;
      this.minimapCanvas = null;
      this.minimapBase = null;
      this.minimapLast = 0;
      this.showTerritories = true;
      this.cameraDirty = true;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    setGame(game) {
      this.game = game;
      this.chunks.clear();
      this.minimapBase = null;
      this.selection = { unitIds: [], buildingId: null, nodeId: null, settlementId: null };
      this.placement = null;
      this.hover = null;
      this.mountainPeaks = game ? this._buildMountainPeaks(game.world) : [];
      if (game) {
        const cap = game.ownedSettlements(game.playerFactionId)[0];
        this.camera.zoom = 1.22;
        if (cap) this.camera.x = cap.x + 0.5; else this.camera.x = game.world.w / 2;
        if (cap) this.camera.y = cap.y + 0.5; else this.camera.y = game.world.h / 2;
        this.clampCamera();
      }
    }

    resize() {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.floor(this.vw * this.dpr);
      this.canvas.height = Math.floor(this.vh * this.dpr);
      this.canvas.style.width = this.vw + 'px';
      this.canvas.style.height = this.vh + 'px';
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.clampCamera();
    }

    setMinimapCanvas(canvas) {
      this.minimapCanvas = canvas;
      this.minimapBase = null;
    }

    // =========================================================
    // Camera
    // =========================================================
    clampCamera() {
      if (!this.game) return;
      const w = this.game.world.w, h = this.game.world.h;
      const halfW = this.vw / (2 * TILE * this.camera.zoom);
      const halfH = this.vh / (2 * TILE * this.camera.zoom);
      if (w < halfW * 2) this.camera.x = w / 2;
      else this.camera.x = U.clamp(this.camera.x, halfW, w - halfW);
      if (h < halfH * 2) this.camera.y = h / 2;
      else this.camera.y = U.clamp(this.camera.y, halfH, h - halfH);
    }
    focus(x, y) {
      this.camera.x = x; this.camera.y = y;
      this.clampCamera();
    }
    focusPlayer() {
      if (!this.game || !this.game.player) return;
      const s = this.game.ownedSettlements(this.game.playerFactionId)[0];
      if (s) this.focus(s.x + 0.5, s.y + 0.5);
    }
    panByPixels(dx, dy) {
      this.camera.x -= dx / (TILE * this.camera.zoom);
      this.camera.y -= dy / (TILE * this.camera.zoom);
      this.clampCamera();
    }
    zoomAt(sx, sy, factor) {
      const before = this.screenToWorld(sx, sy);
      this.camera.zoom = U.clamp(this.camera.zoom * factor, 0.5, 2.1);
      const after = this.screenToWorld(sx, sy);
      this.camera.x += before.x - after.x;
      this.camera.y += before.y - after.y;
      this.clampCamera();
    }
    worldToScreen(wx, wy) {
      const z = TILE * this.camera.zoom;
      return {
        x: (wx - this.camera.x) * z + this.vw / 2,
        y: (wy - this.camera.y) * z + this.vh / 2
      };
    }
    screenToWorld(sx, sy) {
      const z = TILE * this.camera.zoom;
      return { x: (sx - this.vw / 2) / z + this.camera.x, y: (sy - this.vh / 2) / z + this.camera.y };
    }
    screenToTile(sx, sy) {
      const w = this.screenToWorld(sx, sy);
      return { x: Math.floor(w.x), y: Math.floor(w.y) };
    }
    visibleTiles(pad) {
      pad = pad || 2;
      const z = TILE * this.camera.zoom;
      const left = Math.floor(this.camera.x - this.vw / (2 * z)) - pad;
      const top = Math.floor(this.camera.y - this.vh / (2 * z)) - pad;
      const right = Math.ceil(this.camera.x + this.vw / (2 * z)) + pad;
      const bottom = Math.ceil(this.camera.y + this.vh / (2 * z)) + pad;
      return {
        x0: Math.max(0, left), y0: Math.max(0, top),
        x1: Math.min(this.game.world.w - 1, right), y1: Math.min(this.game.world.h - 1, bottom),
        rawLeft: left, rawTop: top, rawRight: right, rawBottom: bottom
      };
    }

    entityAt(sx, sy) {
      if (!this.game) return null;
      const w = this.screenToWorld(sx, sy);
      // units first, highest sort first
      let best = null, bestD = Infinity;
      for (const u of this.game.units) {
        if (u.dead || u.state === 'inside' || u.state === 'aboard' || u.state === 'patient') continue;
        const r = (u.isShip ? 0.8 : 0.45);
        const d = U.dist2(w.x, w.y, u.x, u.y);
        if (d < r * r && d < bestD) { bestD = d; best = { kind: u.isShip ? 'ship' : 'unit', id: u.id }; }
      }
      if (best) return best;
      for (const b of this.game.buildings) {
        if (b.dead) continue;
        if (w.x >= b.x && w.y >= b.y && w.x < b.x + b.def.foot[0] && w.y < b.y + b.def.foot[1]) {
          return { kind: 'building', id: b.id };
        }
      }
      const tx = Math.floor(w.x), ty = Math.floor(w.y);
      const n = this.game.world.nodeAt(tx, ty);
      if (n && n.alive) return { kind: 'node', id: n.id, x: tx, y: ty };
      return { kind: 'tile', x: tx, y: ty };
    }

    // =========================================================
    // Terrain chunks
    // =========================================================
    _chunkCanvas(cx, cy) {
      const key = cx + ',' + cy;
      let cv = this.chunks.get(key);
      if (cv) {
        this.chunks.delete(key);
        this.chunks.set(key, cv);
        return cv;
      }
      cv = document.createElement('canvas');
      cv.width = CHUNK * TILE;
      cv.height = CHUNK * TILE;
      const c = cv.getContext('2d');
      this.drawTerrainChunk(c, cx, cy);
      this.chunks.set(key, cv);
      if (this.chunks.size > CACHE_MAX) {
        const first = this.chunks.keys().next().value;
        this.chunks.delete(first);
      }
      return cv;
    }

    drawTerrainChunk(ctx, cx, cy) {
      const game = this.game, world = game.world;
      const baseX = cx * CHUNK, baseY = cy * CHUNK;
      ctx.clearRect(0, 0, CHUNK * TILE, CHUNK * TILE);
      ctx.save();
      ctx.translate(-baseX * TILE, -baseY * TILE);
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = baseX + lx, y = baseY + ly;
          if (x >= world.w || y >= world.h) continue;
          this._drawTerrainTile(ctx, world, x, y);
        }
      }
      this._drawChunkPatches(ctx, world, cx, cy);
      this._drawEcotones(ctx, world, cx, cy);
      // cliffs, sandy shores and shallow water
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = baseX + lx, y = baseY + ly;
          if (x >= world.w || y >= world.h) continue;
          this._drawTileTransitions(ctx, world, x, y);
        }
      }
      ctx.restore();
    }

    _drawEcotones(ctx, world, cx, cy) {
      const baseX = cx * CHUNK, baseY = cy * CHUNK;
      const cover = { 3: '#87975b', 4: '#405735', 5: '#8e8558', 6: '#716e65' };
      ctx.save();
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = baseX + lx, y = baseY + ly;
          if (x >= world.w || y >= world.h) continue;
          const t = world.terrain[y * world.w + x];
          if (D.TERRAIN[t].water) continue;
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const nx = x + dx, ny = y + dy;
            if (!world.inBounds(nx, ny)) continue;
            const nt = world.terrain[ny * world.w + nx];
            if (D.TERRAIN[nt].water || nt === t) continue;
            const px = x * TILE, py = y * TILE;
            const colorA = cover[t] || '#7a8950';
            const colorB = cover[nt] || '#7a8950';
            const forest = t === 4 || nt === 4;
            const mountainEdge = t === 6 || nt === 6;
            const width = mountainEdge ? 22 : forest ? 17 : 12;
            if (dx === 1) {
              const gx = px + TILE;
              const grad = ctx.createLinearGradient(gx - width, 0, gx + width, 0);
              grad.addColorStop(0, U.rgba(colorA, 0));
              grad.addColorStop(0.45, U.rgba(mountainEdge ? '#4d4b44' : t === 4 || nt === 4 ? '#3a5030' : colorA, mountainEdge ? 0.38 : 0.34));
              grad.addColorStop(0.58, U.rgba(mountainEdge ? '#4d4b44' : t === 4 || nt === 4 ? '#3a5030' : '#aa9c72', mountainEdge ? 0.3 : 0.26));
              grad.addColorStop(1, U.rgba(colorB, 0));
              ctx.fillStyle = grad;
              ctx.fillRect(gx - width, py - 1, width * 2, TILE + 2);
              // sporadic scrub softens the straight tile boundary
              for (let i = 0; i < 4; i++) {
                const hy = py + (i + 0.25) * TILE / 4 + (hash(x, y, 910 + i) - .5) * 7;
                const off = (hash(x, y, 920 + i) - .5) * (forest ? 22 : 15);
                ctx.globalAlpha = .16 + hash(x, y, 930 + i) * .19;
                ctx.fillStyle = forest ? (hash(x, y, 935 + i) > .45 ? '#2b4228' : '#6f8650') : colorA;
                const rr = 3.5 + hash(x, y, 940 + i) * 5;
                ctx.beginPath(); ctx.ellipse(gx + off, hy, rr, rr * .62, 0, 0, Math.PI * 2); ctx.fill();
              }
              if (forest) {
                for (let i = 0; i < 2; i++) {
                  const hy = py + 6 + hash(x, y, 955 + i) * (TILE - 12);
                  const off = (hash(x, y, 956 + i) - .35) * 16;
                  ctx.globalAlpha = .27;
                  ctx.fillStyle = '#314a2c';
                  ctx.beginPath(); ctx.arc(gx + off, hy, 4.5 + hash(x, y, 957 + i) * 2.5, 0, Math.PI * 2); ctx.fill();
                  ctx.fillStyle = '#59744a'; ctx.globalAlpha = .3;
                  ctx.beginPath(); ctx.arc(gx + off - 2, hy - 2, 2.4, 0, Math.PI * 2); ctx.fill();
                }
              }
            } else {
              const gy = py + TILE;
              const grad = ctx.createLinearGradient(0, gy - width, 0, gy + width);
              grad.addColorStop(0, U.rgba(colorA, 0));
              grad.addColorStop(0.45, U.rgba(mountainEdge ? '#4d4b44' : t === 4 || nt === 4 ? '#3a5030' : colorA, mountainEdge ? 0.38 : 0.34));
              grad.addColorStop(0.58, U.rgba(mountainEdge ? '#4d4b44' : t === 4 || nt === 4 ? '#3a5030' : '#aa9c72', mountainEdge ? 0.3 : 0.26));
              grad.addColorStop(1, U.rgba(colorB, 0));
              ctx.fillStyle = grad;
              ctx.fillRect(px - 1, gy - width, TILE + 2, width * 2);
              for (let i = 0; i < 4; i++) {
                const hx = px + (i + 0.25) * TILE / 4 + (hash(x, y, 970 + i) - .5) * 7;
                const off = (hash(x, y, 980 + i) - .5) * (forest ? 22 : 15);
                ctx.globalAlpha = .16 + hash(x, y, 990 + i) * .19;
                ctx.fillStyle = forest ? (hash(x, y, 992 + i) > .45 ? '#2b4228' : '#6f8650') : colorA;
                const rr = 3.5 + hash(x, y, 995 + i) * 5;
                ctx.beginPath(); ctx.ellipse(hx, gy + off, rr * .62, rr, 0, 0, Math.PI * 2); ctx.fill();
              }
              if (forest) {
                for (let i = 0; i < 2; i++) {
                  const hx = px + 6 + hash(x, y, 951 + i) * (TILE - 12);
                  const off = (hash(x, y, 952 + i) - .35) * 16;
                  ctx.globalAlpha = .27;
                  ctx.fillStyle = '#314a2c';
                  ctx.beginPath(); ctx.arc(hx, gy + off, 4.5 + hash(x, y, 953 + i) * 2.5, 0, Math.PI * 2); ctx.fill();
                  ctx.fillStyle = '#59744a'; ctx.globalAlpha = .3;
                  ctx.beginPath(); ctx.arc(hx - 2, gy + off - 2, 2.4, 0, Math.PI * 2); ctx.fill();
                }
              }
            }
          }
        }
      }
      // a low, soft canopy haze over forest regions to hide the grid
      const rng = new U.RNG('canopy:' + world.seed + ':' + cx + ':' + cy);
      for (let i = 0; i < 24; i++) {
        const wx = baseX + rng.next() * CHUNK;
        const wy = baseY + rng.next() * CHUNK;
        if (!world.inBounds(Math.floor(wx), Math.floor(wy))) continue;
        if (world.terrain[Math.floor(wy) * world.w + Math.floor(wx)] !== 4) continue;
        ctx.globalAlpha = 0.06 + rng.next() * 0.06;
        ctx.fillStyle = rng.next() > .35 ? '#22371f' : '#78935a';
        ctx.beginPath();
        ctx.ellipse(wx * TILE, wy * TILE, (0.35 + rng.next() * 0.7) * TILE, (0.24 + rng.next() * 0.4) * TILE, rng.next() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    _drawChunkPatches(ctx, world, cx, cy) {
      const baseX = cx * CHUNK, baseY = cy * CHUNK;
      const rng = new U.RNG('patch:' + world.seed + ':' + cx + ':' + cy);
      ctx.save();
      // broad, soft weathering across the tile grid
      for (let i = 0; i < 22; i++) {
        const wx = baseX + rng.next() * CHUNK;
        const wy = baseY + rng.next() * CHUNK;
        if (!world.inBounds(Math.floor(wx), Math.floor(wy))) continue;
        const t = world.terrain[Math.floor(wy) * world.w + Math.floor(wx)];
        if (D.TERRAIN[t].water) continue;
        let col = '#66763f';
        if (t === 4) col = '#2f4428';
        if (t === 5) col = '#9b9163';
        if (t === 6) col = '#5f5b52';
        ctx.globalAlpha = 0.035 + rng.next() * 0.055;
        ctx.fillStyle = rng.next() > .46 ? col : '#d9c98f';
        ctx.beginPath();
        ctx.ellipse(wx * TILE, wy * TILE, (0.7 + rng.next() * 1.8) * TILE, (0.3 + rng.next() * 0.7) * TILE, rng.next() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      // long lazy ripples on open water break up the square water tiles
      for (let i = 0; i < 10; i++) {
        const wx = baseX + rng.next() * CHUNK;
        const wy = baseY + rng.next() * CHUNK;
        const tx = Math.floor(wx), ty = Math.floor(wy);
        if (!world.inBounds(tx, ty) || !world.isWater(tx, ty)) continue;
        ctx.globalAlpha = 0.035 + rng.next() * 0.045;
        ctx.strokeStyle = '#b8d9d2';
        ctx.lineWidth = 0.65 + rng.next() * 0.9;
        ctx.beginPath();
        const sx = wx * TILE, sy = wy * TILE;
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(sx + 30, sy - 5, sx + 55, sy + 5, sx + 80 + rng.next() * 50, sy - 1);
        ctx.stroke();
      }
      // dappled light and leaf litter in old woods
      for (let i = 0; i < 8; i++) {
        const wx = baseX + rng.next() * CHUNK;
        const wy = baseY + rng.next() * CHUNK;
        const tx = Math.floor(wx), ty = Math.floor(wy);
        if (!world.inBounds(tx, ty) || world.terrain[ty * world.w + tx] !== 4) continue;
        ctx.globalAlpha = 0.06 + rng.next() * 0.06;
        ctx.fillStyle = rng.next() > .5 ? '#bfa861' : '#1d2d1c';
        ctx.beginPath();
        ctx.ellipse(wx * TILE, wy * TILE, (0.15 + rng.next() * 0.3) * TILE, (0.07 + rng.next() * 0.12) * TILE, rng.next() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    _drawTerrainTile(ctx, world, x, y) {
      const px = x * TILE, py = y * TILE;
      const t = world.terrain[y * world.w + x];
      const def = D.TERRAIN[t];
      const seed = hash(x, y, 11);
      const seed2 = hash(x, y, 27);
      const e = world.elev[y * world.w + x] || 0;
      const m = world.moist[y * world.w + x] || 0;
      let base = def.color;
      if (t === 3) base = U.mixColor('#6e8049', '#849456', seed2 * 0.12 + m * 0.23);
      if (t === 4) base = U.mixColor('#455c37', '#546b40', seed2 * 0.12 + m * 0.22);
      if (t === 5) base = U.mixColor('#837b4f', '#968c5c', seed2 * 0.14 + e * 0.2);
      if (t === 6) base = U.mixColor('#67645d', '#7d7971', seed2 * 0.13 + e * 0.2);
      if (t === 0) base = U.mixColor('#274955', '#2c505c', seed2 * 0.1 + m * 0.12);
      if (t === 1) base = U.mixColor('#2f5864', '#35606b', seed2 * 0.1);
      if (t === 2) base = U.mixColor('#356873', '#3a707a', seed2 * 0.1);
      ctx.fillStyle = U.shade(base, (seed - 0.5) * 2.8);
      ctx.fillRect(px, py, TILE + 0.6, TILE + 0.6);
      const water = def.water;
      if (water) {
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = t === 0 ? '#8eb5b8' : '#9fc6c4';
        ctx.lineWidth = 0.9;
        for (let i = 0; i < 2; i++) {
          const wx = px + 3 + hash(x, y, 40 + i) * (TILE - 12);
          const wy = py + 5 + hash(x, y, 50 + i) * (TILE - 8);
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.quadraticCurveTo(wx + 4, wy - 2, wx + 8 + seed * 3, wy);
          ctx.stroke();
        }
        // deeper water dapple
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = t === 0 ? '#0e2630' : '#173b44';
        const r = 7 + seed2 * 9;
        ctx.beginPath();
        ctx.ellipse(px + hash(x, y, 71) * TILE, py + hash(x, y, 72) * TILE, r, r * 0.38, hash(x, y, 73) * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      // dry land texture and decor
      if (t === 3) {
        ctx.globalAlpha = 0.25;
        for (let i = 0; i < 3; i++) {
          const gx = px + hash(x, y, 90 + i) * TILE;
          const gy = py + hash(x, y, 95 + i) * TILE;
          ctx.fillStyle = i % 2 ? '#a5b267' : '#61773e';
          ctx.beginPath();
          ctx.ellipse(gx, gy, 4 + hash(x, y, 99 + i) * 8, 2 + hash(x, y, 101 + i) * 4, hash(x, y, 103 + i) * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#5b713a';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const gx = px + 2 + hash(x, y, 110 + i) * (TILE - 4);
          const gy = py + 3 + hash(x, y, 120 + i) * (TILE - 5);
          ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + 1.4, gy - 4 - hash(x, y, 130 + i) * 3); ctx.stroke();
        }
        if (seed > 0.965) {
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = seed2 > 0.5 ? '#e8dda1' : '#d8a19d';
          for (let i = 0; i < 3; i++) {
            ctx.beginPath(); ctx.arc(px + 6 + hash(x, y, 140 + i) * 20, py + 7 + hash(x, y, 150 + i) * 18, 1.15, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (t === 4) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#263b24';
        for (let i = 0; i < 4; i++) {
          const gx = px + hash(x, y, 160 + i) * TILE;
          const gy = py + hash(x, y, 170 + i) * TILE;
          ctx.beginPath(); ctx.ellipse(gx, gy, 7 + hash(x, y, 180 + i) * 7, 3 + hash(x, y, 190 + i) * 4, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#7c8c51';
        for (let i = 0; i < 3; i++) {
          const gx = px + 3 + hash(x, y, 200 + i) * 24;
          const gy = py + 4 + hash(x, y, 210 + i) * 22;
          ctx.beginPath(); ctx.arc(gx, gy, 4, 0, Math.PI); ctx.stroke();
        }
        if (seed > 0.9) {
          ctx.globalAlpha = 0.6; ctx.fillStyle = '#b7c28a';
          ctx.beginPath(); ctx.arc(px + hash(x, y, 221) * 26, py + hash(x, y, 222) * 26, 1.2, 0, Math.PI * 2); ctx.fill();
        }
      } else if (t === 5) {
        ctx.globalAlpha = 0.24;
        ctx.strokeStyle = '#625b3a';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          const y0 = py + 8 + i * 12 + seed * 3;
          ctx.moveTo(px + 1, y0);
          ctx.bezierCurveTo(px + 8, y0 - 5, px + 20, y0 + 4, px + TILE, y0 - 2);
          ctx.stroke();
        }
        ctx.fillStyle = '#b0a56a'; ctx.globalAlpha = 0.35;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(px + 4 + hash(x, y, 230 + i) * 22, py + 5 + hash(x, y, 240 + i) * 22, 2.5 + seed * 2, 1.4, seed * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (seed > 0.85) {
          ctx.globalAlpha = 0.6; ctx.fillStyle = '#5f6648';
          ctx.beginPath(); ctx.arc(px + 8 + seed2 * 15, py + 9 + seed * 13, 3, 0, Math.PI * 2); ctx.fill();
        }
      } else if (t === 6) {
        // High mountains are an impassable rocky mass: scattered slabs, scree
        // and only occasional dark peaks, so the range does not repeat one cone
        // in every tile.
        const r0 = hash(x, y, 601), r1 = hash(x, y, 602), r2 = hash(x, y, 603), r3 = hash(x, y, 604);
        ctx.globalAlpha = 0.18 + r0 * 0.1;
        ctx.fillStyle = r1 > .5 ? '#5f5c54' : '#7a766b';
        ctx.beginPath();
        ctx.moveTo(px - 3, py + TILE * (0.72 + r2 * 0.14));
        ctx.lineTo(px + TILE * (0.24 + r3 * .16), py + TILE * (0.46 + r1 * .1));
        ctx.lineTo(px + TILE * (0.68 + r0 * .12), py + TILE * (0.55 + r2 * .16));
        ctx.lineTo(px + TILE + 3, py + TILE * (0.82 + r3 * .1));
        ctx.lineTo(px + TILE + 3, py + TILE + 2);
        ctx.lineTo(px - 3, py + TILE + 2);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = '#4c4942'; ctx.lineWidth = 0.8;
        for (let i = 0; i < 2; i++) {
          const yy = py + TILE * (0.35 + i * 0.3 + r3 * 0.1);
          ctx.beginPath();
          ctx.moveTo(px + 2 + r0 * 6, yy);
          ctx.bezierCurveTo(px + TILE * .3, yy - 4 - r1 * 4, px + TILE * .62, yy + 5, px + TILE - 2 - r2 * 5, yy - 1);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.27;
        ctx.fillStyle = '#4c4942';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.ellipse(px + 3 + hash(x, y, 620 + i) * (TILE - 6), py + TILE * (0.75 + hash(x, y, 630 + i) * 0.2), 1.2 + r1 * 2.4, 0.9 + r0, hash(x, y, 640 + i) * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = '#807b6e';
        ctx.beginPath(); ctx.ellipse(px + TILE * (.35 + r1 * .3), py + TILE * (.28 + r2 * .18), 7 + r0 * 8, 3 + r3 * 4, 0, 0, Math.PI * 2); ctx.fill();
      }
      // tiny natural scatter
      if (seed > 0.7 && t !== 6) {
        ctx.globalAlpha = 0.25; ctx.fillStyle = '#4d4d3f';
        ctx.beginPath(); ctx.ellipse(px + hash(x, y, 250) * 26, py + hash(x, y, 251) * 26, 2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _edgeDepth(x, y, salt) {
      return 2.4 + hash(x, y, salt) * 3.2;
    }
    _coastProfile(px, py, side, depths) {
      // builds a wavy line along the inner side of an edge, as an array of points
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const f = i / 5;
        let wx, wy;
        if (side === 'n') { wx = px + TILE * f; wy = py + depths[i]; }
        else if (side === 's') { wx = px + TILE * f; wy = py + TILE - depths[i]; }
        else if (side === 'w') { wx = px + depths[i]; wy = py + TILE * f; }
        else { wx = px + TILE - depths[i]; wy = py + TILE * f; }
        pts.push({ x: wx, y: wy });
      }
      return pts;
    }
    _sandColor(seed) {
      return seed > .55 ? '#b5a47b' : seed > .3 ? '#c0ae83' : '#a99b78';
    }

    _drawTileTransitions(ctx, world, x, y) {
      const px = x * TILE, py = y * TILE;
      const i = y * world.w + x;
      const t = world.terrain[i];
      const def = D.TERRAIN[t];
      const seed = hash(x, y, 333);
      const dirs = [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']];
      const waterSides = [];
      for (const [dx, dy, side] of dirs) {
        if (!world.inBounds(x + dx, y + dy)) continue;
        const wet = world.isWater(x + dx, y + dy);
        if (!def.water && wet) waterSides.push(side);
        if (def.water && !wet) waterSides.push(side);
      }
      ctx.save();
      if (!def.water) {
        for (const side of waterSides) {
          const depths = [];
          for (let k = 0; k <= 5; k++) depths.push(4.2 + hash(x, y, 420 + k + (side.charCodeAt(0) * 3)) * 3.4 + Math.sin(k * 1.7 + seed * 4) * 1.2);
          const pts = this._coastProfile(px, py, side, depths);
          ctx.beginPath();
          if (side === 'n') { ctx.moveTo(px - 0.8, py - 0.8); ctx.lineTo(px + TILE + 0.8, py - 0.8); }
          if (side === 's') { ctx.moveTo(px - 0.8, py + TILE + 0.8); ctx.lineTo(px + TILE + 0.8, py + TILE + 0.8); }
          if (side === 'w') { ctx.moveTo(px - 0.8, py - 0.8); ctx.lineTo(px - 0.8, py + TILE + 0.8); }
          if (side === 'e') { ctx.moveTo(px + TILE + 0.8, py - 0.8); ctx.lineTo(px + TILE + 0.8, py + TILE + 0.8); }
          for (let k = pts.length - 1; k >= 0; k--) ctx.lineTo(pts[k].x, pts[k].y);
          ctx.closePath();
          const grad = side === 'n' ? ctx.createLinearGradient(0, py, 0, py + 9) :
            side === 's' ? ctx.createLinearGradient(0, py + TILE, 0, py + TILE - 9) :
              side === 'w' ? ctx.createLinearGradient(px, 0, px + 9, 0) : ctx.createLinearGradient(px + TILE, 0, px + TILE - 9, 0);
          grad.addColorStop(0, 'rgba(192,176,133,0.95)');
          grad.addColorStop(0.55, 'rgba(174,161,122,0.72)');
          grad.addColorStop(1, 'rgba(135,137,95,0)');
          ctx.fillStyle = grad;
          ctx.fill();
          // wet shingle line
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = '#8d8f68';
          ctx.lineWidth = 1;
          ctx.beginPath();
          pts.forEach((p, k) => k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          ctx.stroke();
          ctx.globalAlpha = 1;
          // occasional reeds at the waterline
          if (seed > 0.48) {
            const mid = pts[2];
            ctx.strokeStyle = 'rgba(79,100,55,0.8)'; ctx.lineWidth = 1;
            for (let r = 0; r < 3; r++) {
              const rx = mid.x + (r - 1) * 3, ry = mid.y - 2;
              ctx.beginPath(); ctx.moveTo(rx, ry); ctx.quadraticCurveTo(rx + (r - 1) * 1.7, ry - 4, rx + (r - 1) * 2.5, ry - 7 - (r % 2)); ctx.stroke();
            }
          }
        }
      } else {
        for (const side of waterSides) {
          const depthArr = [];
          for (let k = 0; k <= 5; k++) depthArr.push(2.2 + hash(x, y, 450 + k + side.charCodeAt(0)) * 2.4);
          const sand = this._coastProfile(px, py, side, depthArr);
          ctx.beginPath();
          if (side === 'n') { ctx.moveTo(px - 0.8, py - 0.8); ctx.lineTo(px + TILE + 0.8, py - 0.8); }
          if (side === 's') { ctx.moveTo(px - 0.8, py + TILE + 0.8); ctx.lineTo(px + TILE + 0.8, py + TILE + 0.8); }
          if (side === 'w') { ctx.moveTo(px - 0.8, py - 0.8); ctx.lineTo(px - 0.8, py + TILE + 0.8); }
          if (side === 'e') { ctx.moveTo(px + TILE + 0.8, py - 0.8); ctx.lineTo(px + TILE + 0.8, py + TILE + 0.8); }
          for (let k = sand.length - 1; k >= 0; k--) ctx.lineTo(sand[k].x, sand[k].y);
          ctx.closePath();
          ctx.fillStyle = this._sandColor(seed);
          ctx.fill();
          // shallow water band, using a polyline from the sand edge outward
          const depthArr2 = [];
          for (let k = 0; k <= 6; k++) depthArr2.push(7.5 + hash(x, y, 470 + k + side.charCodeAt(1)) * 5.2 + Math.sin(k * 1.4 + seed * 5) * 1.4);
          const shallow = this._coastProfile(px, py, side, depthArr2);
          ctx.beginPath();
          sand.forEach((p, k) => k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          for (let k = shallow.length - 1; k >= 0; k--) ctx.lineTo(shallow[k].x, shallow[k].y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(126,177,170,0.25)';
          ctx.fill();
          // foam
          ctx.globalAlpha = 0.34;
          ctx.strokeStyle = '#d9e8df';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          shallow.forEach((p, k) => {
            const off = Math.sin(k * 2.1 + seed * 6) * 0.8;
            if (k === 0) ctx.moveTo(p.x, p.y + off); else ctx.lineTo(p.x, p.y + off);
          });
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // rounded inside corners of narrow inlets
        const corners = [
          { cx: px, cy: py, ax: x - 1, ay: y, bx: x, by: y - 1, sx: -1, sy: -1 },
          { cx: px + TILE, cy: py, ax: x + 1, ay: y, bx: x, by: y - 1, sx: 1, sy: -1 },
          { cx: px, cy: py + TILE, ax: x - 1, ay: y, bx: x, by: y + 1, sx: -1, sy: 1 },
          { cx: px + TILE, cy: py + TILE, ax: x + 1, ay: y, bx: x, by: y + 1, sx: 1, sy: 1 }
        ];
        for (const c of corners) {
          if (!world.isLand(c.ax, c.ay) || !world.isLand(c.bx, c.by)) continue;
          ctx.beginPath();
          ctx.moveTo(c.cx + c.sx * 7, c.cy);
          ctx.quadraticCurveTo(c.cx + c.sx * 2, c.cy + c.sy * 2, c.cx, c.cy + c.sy * 7);
          ctx.lineTo(c.cx + c.sx * 7, c.cy);
          ctx.closePath();
          ctx.fillStyle = 'rgba(188,174,130,0.95)';
          ctx.fill();
        }
      }
      // cliff shade at high terrain
      if (!def.water && [5, 6].includes(t)) {
        for (const [dx, dy] of [[0, 1], [1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (!world.inBounds(nx, ny)) continue;
          const nt = world.terrain[ny * world.w + nx];
          if ((t === 6 && nt !== 6) || (t === 5 && (nt === 3 || nt === 4))) {
            const high = t === 6 ? 7 : 4;
            const grad = dy === 1 ? ctx.createLinearGradient(0, py + TILE - high, 0, py + TILE)
              : ctx.createLinearGradient(px + TILE - high, 0, px + TILE, 0);
            grad.addColorStop(0, 'rgba(28,27,22,0)');
            grad.addColorStop(0.55, 'rgba(28,27,22,0.22)');
            grad.addColorStop(1, 'rgba(28,27,22,0.48)');
            ctx.fillStyle = grad;
            if (dy === 1) ctx.fillRect(px, py + TILE - high, TILE, high);
            else ctx.fillRect(px + TILE - high, py, high, TILE);
            if (t === 6) {
              ctx.strokeStyle = 'rgba(208,200,177,0.2)'; ctx.lineWidth = 1;
              if (dy === 1) { ctx.beginPath(); ctx.moveTo(px, py + TILE - high + 1); ctx.lineTo(px + TILE, py + TILE - high + 1); ctx.stroke(); }
              else { ctx.beginPath(); ctx.moveTo(px + TILE - high + 1, py); ctx.lineTo(px + TILE - high + 1, py + TILE); ctx.stroke(); }
            }
          }
        }
      }
      ctx.restore();
    }

    // =========================================================
    // Main render
    // =========================================================
    render(now) {
      if (!this.game) return;
      const ctx = this.ctx;
      const t = dateSeason(this.game.timeDays);
      this.anim = now / 1000;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.vw, this.vh);
      // deep sea beyond map
      const bg = ctx.createLinearGradient(0, 0, 0, this.vh);
      bg.addColorStop(0, '#17282c'); bg.addColorStop(1, '#1d2e2f');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, this.vw, this.vh);
      this.drawTerrain();
      this.drawMountainPeaks();
      this.drawFlatInfrastructure();
      this.drawTerritories();
      this._drawEntitiesAndUnits();
      this.drawWaterAnimation();
      this.drawProjectiles();
      this.drawEffects();
      this.drawPlacementOverlay();
      this.drawHoverAndSelection();
      this.drawWeather(t);
      this.drawVignette(t);
      if (this.minimapCanvas) this.drawMinimap(now);
    }

    _buildMountainPeaks(world) {
      const candidates = [];
      for (let y = 1; y < world.h - 1; y++) {
        for (let x = 1; x < world.w - 1; x++) {
          const i = y * world.w + x;
          if (world.terrain[i] !== 6) continue;
          const e = world.elev ? world.elev[i] : 0.6;
          candidates.push({ x, y, score: e + hash(x, y, 711) * 0.12 });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const chosen = [];
      for (const c of candidates) {
        if (chosen.length >= 420) break;
        let crowded = false;
        for (let i = chosen.length - 1; i >= 0; i--) {
          const p = chosen[i];
          if (Math.abs(p.x - c.x) <= 4 && Math.abs(p.y - c.y) <= 4) { crowded = true; break; }
        }
        if (crowded) continue;
        chosen.push(c);
      }
      return chosen;
    }

    drawMountainPeaks() {
      if (!this.mountainPeaks || !this.mountainPeaks.length) return;
      const ctx = this.ctx;
      const z = TILE * this.camera.zoom;
      const off = this.worldToScreen(0, 0);
      const vis = this.visibleTiles(7);
      const peaks = [];
      for (const p of this.mountainPeaks) {
        if (p.x < vis.x0 - 4 || p.x > vis.x1 + 4 || p.y < vis.y0 - 4 || p.y > vis.y1 + 4) continue;
        peaks.push(p);
      }
      peaks.sort((a, b) => a.y - b.y);
      ctx.save();
      for (const p of peaks) {
        const sx = off.x + p.x * z, sy = off.y + p.y * z;
        const h1 = hash(p.x, p.y, 721), h2 = hash(p.x, p.y, 722), h3 = hash(p.x, p.y, 723);
        const baseX = sx + z * (0.38 + h1 * 0.24);
        const baseY = sy + z * (0.92 + h2 * 0.12);
        const w = z * (1.1 + h2 * 0.95);
        const h = z * (1.35 + h1 * 1.25);
        // soft base shadow
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#3e3d37';
        ctx.beginPath(); ctx.ellipse(baseX, baseY - z * 0.03, w * 0.8, z * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        // bulk of the massif
        ctx.globalAlpha = 0.66;
        ctx.fillStyle = '#4c4a43';
        ctx.beginPath();
        ctx.moveTo(baseX - w, baseY);
        ctx.lineTo(baseX - w * 0.64, baseY - h * 0.36);
        ctx.lineTo(baseX - w * 0.23, baseY - h * 0.58);
        ctx.lineTo(baseX - w * 0.04, baseY - h * 0.88);
        ctx.lineTo(baseX + w * 0.12, baseY - h);
        ctx.lineTo(baseX + w * 0.48, baseY - h * 0.47);
        ctx.lineTo(baseX + w, baseY - h * 0.1);
        ctx.lineTo(baseX + w * 0.86, baseY);
        ctx.closePath();
        ctx.fill();
        // left face catching the light
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#a7a091';
        ctx.beginPath();
        ctx.moveTo(baseX + w * 0.12, baseY - h);
        ctx.lineTo(baseX - w * 0.64, baseY - h * 0.36);
        ctx.lineTo(baseX - w * 0.12, baseY - h * 0.29);
        ctx.lineTo(baseX + w * 0.24, baseY - h * 0.62);
        ctx.closePath();
        ctx.fill();
        // dark right face
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = '#2e2d29';
        ctx.beginPath();
        ctx.moveTo(baseX + w * 0.12, baseY - h);
        ctx.lineTo(baseX + w * 0.48, baseY - h * 0.47);
        ctx.lineTo(baseX + w, baseY - h * 0.1);
        ctx.lineTo(baseX + w * 0.25, baseY - h * 0.25);
        ctx.closePath();
        ctx.fill();
        // snow only on the tallest peaks
        if (h > z * 1.8) {
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#d8d2c1';
          ctx.beginPath();
          ctx.moveTo(baseX + w * 0.12, baseY - h);
          ctx.lineTo(baseX - w * 0.23, baseY - h * 0.72);
          ctx.lineTo(baseX + w * 0.03, baseY - h * 0.68);
          ctx.lineTo(baseX + w * 0.22, baseY - h * 0.8);
          ctx.closePath();
          ctx.fill();
        }
        // a shoulder ridge
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = '#8e887a'; ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(baseX - w * 0.23, baseY - h * 0.58);
        ctx.lineTo(baseX - w * 0.34, baseY - h * 0.2);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawTerrain() {
      const game = this.game;
      const z = TILE * this.camera.zoom;
      const vis = this.visibleTiles(1);
      const c0 = Math.max(0, Math.floor(vis.rawLeft / CHUNK));
      const c1 = Math.min(Math.ceil(game.world.w / CHUNK) - 1, Math.floor(vis.rawRight / CHUNK));
      const r0 = Math.max(0, Math.floor(vis.rawTop / CHUNK));
      const r1 = Math.min(Math.ceil(game.world.h / CHUNK) - 1, Math.floor(vis.rawBottom / CHUNK));
      const off = this.worldToScreen(0, 0);
      for (let cy = r0; cy <= r1; cy++) {
        for (let cx = c0; cx <= c1; cx++) {
          const cv = this._chunkCanvas(cx, cy);
          const sx = off.x + cx * CHUNK * z;
          const sy = off.y + cy * CHUNK * z;
          this.ctx.drawImage(cv, sx, sy, CHUNK * z + 0.6, CHUNK * z + 0.6);
        }
      }
    }

    drawWaterAnimation() {
      const world = this.game.world;
      const vis = this.visibleTiles(1);
      const ctx = this.ctx;
      const z = TILE * this.camera.zoom;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const time = this.anim;
      for (let y = vis.y0; y <= vis.y1; y += 1) {
        for (let x = vis.x0; x <= vis.x1; x += 1) {
          const t = world.terrain[y * world.w + x];
          if (!D.TERRAIN[t].water) continue;
          const h = hash(x, y, 313);
          if (h < 0.55) continue;
          const p = this.worldToScreen(x + 0.5, y + 0.5);
          const phase = Math.sin(time * 0.9 + h * 12 + x * 0.3 + y * 0.17);
          ctx.globalAlpha = 0.055 + Math.max(0, phase) * 0.1;
          ctx.strokeStyle = t === 0 ? '#9fd2d2' : '#b9dcd3';
          ctx.lineWidth = 1.2;
          const w = z * 0.35;
          ctx.beginPath();
          ctx.moveTo(p.x - w, p.y + phase * 2);
          ctx.quadraticCurveTo(p.x, p.y - 2 + phase * 2, p.x + w, p.y + phase * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    drawFlatInfrastructure() {
      const game = this.game;
      const ctx = this.ctx;
      for (const b of game.buildings) {
        if (b.dead) continue;
        if (b.defId === 'road') this.drawRoadTile(b);
      }
      for (const b of game.buildings) {
        if (b.dead) continue;
        if (b.defId === 'bridge') this.drawBridge(b);
        if (b.defId === 'tunnel') this.drawTunnel(b);
      }
    }

    drawTerritories() {
      if (!this.showTerritories) return;
      const game = this.game;
      if (!game) return;
      const ctx = this.ctx;
      const z = TILE * this.camera.zoom;
      for (const s of game.settlements) {
        if (s.ruined) continue;
        const hall = game.primaryHall(s);
        const radius = hall && hall.complete && hall.def.radius ? hall.def.radius[hall.level] : 9;
        const c = game.settlementCenter(s);
        const p = this.worldToScreen(c.x, c.y);
        if (p.x + radius * z < -100 || p.x - radius * z > this.vw + 100 || p.y + radius * z < -100 || p.y - radius * z > this.vh + 100) continue;
        const f = game.getFaction(s.owner);
        if (!f) continue;
        const isPlayer = f.id === game.playerFactionId;
        const sel = this.selection.settlementId === s.id;
        ctx.save();
        ctx.globalAlpha = sel ? 0.075 : 0.042;
        const grad = ctx.createRadialGradient(p.x, p.y, z, p.x, p.y, radius * z);
        grad.addColorStop(0, U.rgba(f.colors.primary, 0.18));
        grad.addColorStop(0.8, U.rgba(f.colors.primary, 0.05));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius * z, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = isPlayer ? 0.7 : 0.42;
        ctx.strokeStyle = isPlayer ? U.rgba(f.colors.secondary, 0.9) : U.rgba(f.colors.secondary, 0.6);
        ctx.lineWidth = sel ? 2 : 1.15;
        ctx.setLineDash([Math.max(5, z * 0.35), Math.max(6, z * 0.45)]);
        ctx.beginPath(); ctx.arc(p.x, p.y, radius * z, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < 12; i++) {
          const ang = (i / 12) * Math.PI * 2 + 0.2;
          const rx = p.x + Math.cos(ang) * radius * z;
          const ry = p.y + Math.sin(ang) * radius * z;
          ctx.fillStyle = f.colors.secondary;
          ctx.beginPath(); ctx.arc(rx, ry, 1.2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    _drawEntitiesAndUnits() {
      const game = this.game;
      const z = TILE * this.camera.zoom;
      const ctx = this.ctx;
      const vis = this.visibleTiles(2);
      const drawables = [];
      for (const n of game.world.nodes) {
        if (!n.alive) continue;
        if (n.x < vis.x0 - 1 || n.y < vis.y0 - 1 || n.x > vis.x1 + 1 || n.y > vis.y1 + 1) continue;
        const p = this.worldToScreen(n.x + 0.5, n.y + 0.5);
        drawables.push({ type: 'node', obj: n, y: p.y + z * 0.5, x: p.x });
      }
      for (const b of game.buildings) {
        if (b.dead || b.defId === 'road' || b.defId === 'bridge') continue;
        if (b.x + b.def.foot[0] < vis.x0 - 2 || b.y + b.def.foot[1] < vis.y0 - 2 || b.x > vis.x1 + 2 || b.y > vis.y1 + 2) continue;
        const p = this.worldToScreen(b.x, b.y);
        drawables.push({ type: 'building', obj: b, y: p.y + b.def.foot[1] * z, x: p.x });
      }
      for (const u of game.units) {
        if (u.dead || u.state === 'inside' || u.state === 'aboard' || u.state === 'patient') continue;
        if (u.x < vis.x0 - 2 || u.y < vis.y0 - 2 || u.x > vis.x1 + 2 || u.y > vis.y1 + 2) continue;
        const p = this.worldToScreen(u.x, u.y);
        drawables.push({ type: 'unit', obj: u, y: p.y, x: p.x });
      }
      drawables.sort((a, b) => a.y - b.y);
      for (const d of drawables) {
        if (d.type === 'node') this.drawNode(d.obj);
        else if (d.type === 'building') this.drawBuilding(d.obj);
        else this.drawUnit(d.obj);
      }
    }

    // =========================================================
    // Infrastructure
    // =========================================================
    _adjacentBuilding(x, y, typeList) {
      for (const b of this.game.buildings) {
        if (b.dead) continue;
        if (!typeList.includes(b.defId)) continue;
        if (b.x === x && b.y === y) return b;
      }
      return null;
    }
    drawRoadTile(b) {
      const z = TILE * this.camera.zoom;
      const p = this.worldToScreen(b.x, b.y);
      if (p.x < -z || p.y < -z || p.x > this.vw + z || p.y > this.vh + z) return;
      const ctx = this.ctx;
      ctx.save();
      const roads = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
        const n = this._adjacentBuilding(b.x + dx, b.y + dy, ['road', 'bridge', 'gate', 'hall', 'market', 'barracks']);
        return !!n;
      });
      ctx.fillStyle = 'rgba(139,116,77,0.65)';
      if (!roads.length) {
        ctx.beginPath(); ctx.ellipse(p.x + z / 2, p.y + z / 2, z * 0.38, z * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        for (const [dx, dy] of roads) {
          ctx.beginPath();
          ctx.moveTo(p.x + z / 2, p.y + z / 2);
          ctx.lineTo(p.x + z / 2 + dx * z, p.y + z / 2 + dy * z);
          ctx.lineWidth = z * 0.38;
          ctx.strokeStyle = 'rgba(140,116,77,0.62)';
          ctx.lineCap = 'butt';
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#b49b73';
      for (let i = 0; i < 3; i++) {
        const rx = p.x + hash(b.x, b.y, 400 + i) * z;
        const ry = p.y + hash(b.x, b.y, 410 + i) * z;
        ctx.fillRect(rx, ry, 1.2, 1.2);
      }
      ctx.restore();
    }
    drawBridge(b) {
      const ctx = this.ctx;
      const z = TILE * this.camera.zoom;
      const p = this.worldToScreen(b.x, b.y);
      if (p.x < -z || p.y < -z || p.x > this.vw + z || p.y > this.vh + z) return;
      const horiz = !!(this._adjacentBuilding(b.x - 1, b.y, ['bridge', 'road']) || this._adjacentBuilding(b.x + 1, b.y, ['bridge', 'road']) ||
        (this.game.world.isLand(b.x - 1, b.y) && this.game.world.isLand(b.x + 1, b.y)));
      ctx.save();
      if (horiz) {
        ctx.fillStyle = '#5c402c'; ctx.fillRect(p.x - 2, p.y + z * 0.18, z + 4, z * 0.64);
        ctx.fillStyle = '#8c6742'; ctx.fillRect(p.x - 1, p.y + z * 0.22, z + 2, z * 0.54);
        ctx.strokeStyle = '#4b3324'; ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(p.x + i * z / 5, p.y + z * 0.22); ctx.lineTo(p.x + i * z / 5, p.y + z * 0.76); ctx.stroke(); }
        ctx.strokeStyle = '#b29564'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p.x, p.y + z * 0.16); ctx.lineTo(p.x + z, p.y + z * 0.16); ctx.moveTo(p.x, p.y + z * 0.84); ctx.lineTo(p.x + z, p.y + z * 0.84); ctx.stroke();
      } else {
        ctx.fillStyle = '#5c402c'; ctx.fillRect(p.x + z * 0.18, p.y - 2, z * 0.64, z + 4);
        ctx.fillStyle = '#8c6742'; ctx.fillRect(p.x + z * 0.22, p.y - 1, z * 0.54, z + 2);
        ctx.strokeStyle = '#4b3324'; ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(p.x + z * 0.22, p.y + i * z / 5); ctx.lineTo(p.x + z * 0.76, p.y + i * z / 5); ctx.stroke(); }
        ctx.strokeStyle = '#b29564'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(p.x + z * 0.16, p.y); ctx.lineTo(p.x + z * 0.16, p.y + z); ctx.moveTo(p.x + z * 0.84, p.y); ctx.lineTo(p.x + z * 0.84, p.y + z); ctx.stroke();
      }
      ctx.restore();
    }
    drawTunnel(b) {
      const z = TILE * this.camera.zoom;
      const p = this.worldToScreen(b.x, b.y);
      if (p.x < -z || p.y < -z || p.x > this.vw + z || p.y > this.vh + z) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = '#4c4740';
      rrect(ctx, p.x + z * 0.12, p.y + z * 0.18, z * 0.76, z * 0.8, z * 0.2); ctx.fill();
      ctx.fillStyle = '#171513';
      ctx.beginPath(); ctx.arc(p.x + z * 0.5, p.y + z * 0.58, z * 0.23, Math.PI, 0); ctx.lineTo(p.x + z * 0.73, p.y + z * 0.9); ctx.lineTo(p.x + z * 0.27, p.y + z * 0.9); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#9b917f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x + z * 0.5, p.y + z * 0.58, z * 0.27, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = 'rgba(216,193,140,0.3)';
      ctx.beginPath(); ctx.arc(p.x + z * 0.44, p.y + z * 0.74, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // =========================================================
    // Resource nodes
    // =========================================================
    drawNode(n) {
      const z = TILE * this.camera.zoom;
      const p = this.worldToScreen(n.x + 0.5, n.y + 0.5);
      if (p.x < -z || p.y < -z || p.x > this.vw + z || p.y > this.vh + z) return;
      const ctx = this.ctx;
      const sel = this.selection.nodeId === n.id;
      const hov = this.hover && this.hover.kind === 'node' && this.hover.id === n.id;
      const season = dateSeason(this.game.timeDays);
      const ratio = U.clamp(n.amount / Math.max(1, n.max), 0, 1);
      const sq = z / 32;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sq, sq);
      if (sel || hov) {
        ctx.strokeStyle = sel ? '#f0d58a' : 'rgba(238,217,165,0.7)';
        ctx.lineWidth = sel ? 2 : 1.3;
        ctx.setLineDash(sel ? [] : [4, 3]);
        rrect(ctx, -13, -11, 26, 23, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.type === 'tree') this._drawTreeCluster(ctx, n, ratio, season);
      else if (n.type === 'berry') this._drawBerryNode(ctx, n, ratio, season);
      else this._drawOreNode(ctx, n, ratio);
      if (n.clearing) {
        const prog = n.clearing.required ? U.clamp(n.clearing.progress / n.clearing.required, 0, 1) : 0;
        ctx.fillStyle = 'rgba(20,17,12,0.75)'; rrect(ctx, -14, 12, 28, 4, 2); ctx.fill();
        ctx.fillStyle = '#c89b58'; rrect(ctx, -14, 12, 28 * prog, 4, 2); ctx.fill();
      }
      if (sel) {
        ctx.fillStyle = 'rgba(22,18,12,0.84)';
        rrect(ctx, -27, -25, 54, 10, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(213,186,117,0.65)'; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.fillStyle = '#e8d8a9'; ctx.font = '6px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(D.NODES[n.type].name + ' ' + Math.floor(n.amount) + '/' + n.max, 0, -20);
      }
      ctx.restore();
    }

    _drawTreeCluster(ctx, n, ratio, season) {
      const v = n.variant || 0;
      const trees = ratio > 0.55 ? 4 : ratio > 0.25 ? 3 : 2;
      ctx.save();
      for (let i = 0; i < trees; i++) {
        const h1 = hash(v, i, 501), h2 = hash(v, i, 502), h3 = hash(v, i, 503);
        const tx = (i - (trees - 1) / 2) * 6.5 + (h1 - 0.5) * 4;
        const ty = 3 + (h2 - 0.5) * 6 - (i === 1 ? 3 : 0);
        const s = 0.72 + h3 * 0.4;
        ctx.fillStyle = 'rgba(20,22,13,0.28)';
        ctx.beginPath(); ctx.ellipse(tx + 4, ty + 7, 7 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5a412c';
        ctx.fillRect(tx - 1, ty + 2, 2, 7 * s);
        let col1 = '#42633b', col2 = '#5b7c46';
        if (season === 'autumn') { col1 = '#8e6330'; col2 = '#b0843b'; }
        if (season === 'winter') { col1 = '#55625a'; col2 = '#78847b'; }
        const conifer = (v + i) % 3 === 0;
        if (conifer) {
          ctx.fillStyle = season === 'winter' ? '#5c7066' : '#36523a';
          ctx.beginPath();
          ctx.moveTo(tx, ty - 10 * s); ctx.lineTo(tx - 6 * s, ty + 2 * s); ctx.lineTo(tx + 6 * s, ty + 2 * s); ctx.closePath(); ctx.fill();
          ctx.fillStyle = season === 'winter' ? '#c6d3cc' : '#4b6947';
          ctx.beginPath(); ctx.moveTo(tx, ty - 9 * s); ctx.lineTo(tx - 3.5 * s, ty - 2 * s); ctx.lineTo(tx + 3 * s, ty - 2 * s); ctx.closePath(); ctx.fill();
          if (season === 'winter') { ctx.fillStyle = 'rgba(230,238,234,0.7)'; ctx.beginPath(); ctx.moveTo(tx, ty - 10 * s); ctx.lineTo(tx - 2, ty - 6 * s); ctx.lineTo(tx + 2, ty - 6 * s); ctx.fill(); }
        } else {
          ctx.fillStyle = col1;
          ctx.beginPath(); ctx.arc(tx - 3 * s, ty - 1 * s, 5 * s, 0, Math.PI * 2); ctx.arc(tx + 3 * s, ty - 1 * s, 5 * s, 0, Math.PI * 2); ctx.arc(tx, ty - 5 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = col2;
          ctx.beginPath(); ctx.arc(tx - 2 * s, ty - 5 * s, 3.2 * s, 0, Math.PI * 2); ctx.arc(tx + 3 * s, ty - 4 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
          if (season === 'winter') { ctx.fillStyle = 'rgba(230,238,234,0.55)'; ctx.beginPath(); ctx.arc(tx - 2 * s, ty - 7 * s, 2.8 * s, 0, Math.PI * 2); ctx.fill(); }
        }
        if (ratio < 0.25) {
          ctx.fillStyle = '#7f6a4b'; ctx.fillRect(tx - 2, ty + 5, 4, 2.2);
        }
      }
      // fallen log / mushrooms for flavor
      ctx.fillStyle = '#6c5137'; ctx.fillRect(-10, 9, 8, 2);
      if (hash(n.variant, 6, 7) > 0.6) {
        ctx.fillStyle = '#b75a45';
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(7 + i * 2.4, 9 + (i % 2), 1, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.restore();
    }
    _drawBerryNode(ctx, n, ratio, season) {
      const v = n.variant || 0;
      const bushes = ratio > 0.5 ? 3 : 2;
      for (let i = 0; i < bushes; i++) {
        const bx = (i - (bushes - 1) / 2) * 7 + (hash(v, i, 610) - 0.5) * 3;
        const by = 3 + hash(v, i, 611) * 4;
        const s = 0.8 + hash(v, i, 612) * 0.3;
        ctx.fillStyle = 'rgba(20,22,13,0.25)';
        ctx.beginPath(); ctx.ellipse(bx + 3, by + 6, 6 * s, 2.3 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = season === 'winter' ? '#4f604b' : '#496c39';
        ctx.beginPath(); ctx.arc(bx - 2.5 * s, by, 4.2 * s, 0, Math.PI * 2); ctx.arc(bx + 2.5 * s, by, 4.6 * s, 0, Math.PI * 2); ctx.arc(bx, by - 3 * s, 4.5 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = season === 'winter' ? '#6b7c65' : '#64894a';
        ctx.beginPath(); ctx.arc(bx - 1.5 * s, by - 2.5 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill();
        if (ratio > 0.2) {
          ctx.fillStyle = '#a63e46';
          const count = Math.ceil(ratio * 6);
          for (let j = 0; j < count; j++) {
            ctx.beginPath(); ctx.arc(bx - 3 + hash(v, i * 8 + j, 620) * 6, by - 3 + hash(v, i * 8 + j, 621) * 5, 1.15, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.fillStyle = '#7a6648'; ctx.beginPath(); ctx.ellipse(0, 8, 9, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    _drawOreNode(ctx, n, ratio) {
      const v = n.variant || 0;
      const meta = D.NODES[n.type];
      const oreColor = n.type === 'gold' ? '#ddb64c' : n.type === 'silver' ? '#c6d0d2' : '#7f898c';
      ctx.save();
      ctx.fillStyle = 'rgba(20,22,20,0.3)';
      ctx.beginPath(); ctx.ellipse(2, 8, 11, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 6 + (hash(v, i, 700) - 0.5) * 3;
        const y = 2 + hash(v, i, 701) * 4;
        const s = (0.75 + hash(v, i, 702) * 0.55) * (0.7 + ratio * 0.3);
        ctx.fillStyle = i % 2 ? '#8b8880' : '#74736c';
        ctx.beginPath();
        ctx.moveTo(x - 5 * s, y + 5 * s);
        ctx.lineTo(x - 3 * s, y - 4 * s);
        ctx.lineTo(x + 2 * s, y - 6 * s);
        ctx.lineTo(x + 6 * s, y + 1 * s);
        ctx.lineTo(x + 3 * s, y + 6 * s);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = oreColor;
        ctx.globalAlpha = 0.5 + ratio * 0.5;
        ctx.beginPath();
        ctx.moveTo(x - 1.5 * s, y - 2 * s);
        ctx.lineTo(x + 1 * s, y - 3.5 * s);
        ctx.lineTo(x + 2.5 * s, y - 1 * s);
        ctx.lineTo(x + 0.5 * s, y + 1 * s);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#5c5c51';
      ctx.beginPath(); ctx.arc(8, 7, 2.2, 0, Math.PI * 2); ctx.fill();
      if (ratio > 0.1) {
        ctx.fillStyle = oreColor; ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.arc(3, 4, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // =========================================================
    // Buildings
    // =========================================================
    drawBuilding(b) {
      const z = TILE * this.camera.zoom;
      const p = this.worldToScreen(b.x, b.y);
      const w = b.def.foot[0] * z, h = b.def.foot[1] * z;
      if (p.x + w < -20 || p.y + h < -20 || p.x > this.vw + 20 || p.y > this.vh + 20) return;
      const ctx = this.ctx;
      const sel = this.selection.buildingId === b.id;
      const hov = this.hover && this.hover.kind === 'building' && this.hover.id === b.id;
      const faction = this.game.getFaction(b.owner);
      const palette = LEVEL_PALETTE[U.clamp(b.level, 1, 4)] || LEVEL_PALETTE[1];
      ctx.save();
      ctx.translate(p.x, p.y);
      // worn ground anchoring the structure into the landscape
      if (b.defId !== 'bridge' && b.defId !== 'road' && b.defId !== 'tunnel') {
        ctx.fillStyle = 'rgba(140,120,82,0.10)';
        ctx.beginPath(); ctx.ellipse(w / 2, h * 0.58, w * 0.54, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(54,48,34,0.10)';
        ctx.beginPath(); ctx.ellipse(w / 2 + 4, h * 0.66, w * 0.4, h * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      }
      // shadow
      ctx.fillStyle = 'rgba(13,15,11,0.3)';
      const sh = 5 + z * 0.08;
      ctx.beginPath(); ctx.ellipse(w / 2 + sh, h * 0.82 + sh, w * 0.46, h * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      if (!b.complete) {
        this._drawConstruction(ctx, b, w, h, z, palette, faction);
      } else {
        this._drawBuildingBody(ctx, b, w, h, z, palette, faction);
        if (b.upgrade) this._drawScaffolding(ctx, w, h, z, true);
        if (b.converting) this._drawScaffolding(ctx, w, h, z, true);
      }
      if (sel || hov) {
        ctx.strokeStyle = sel ? 'rgba(240,214,143,0.95)' : 'rgba(234,214,166,0.55)';
        ctx.lineWidth = sel ? 2.2 : 1.2;
        ctx.setLineDash(sel ? [] : [4, 3]);
        rrect(ctx, -1, -1, w + 2, h + 2, 4); ctx.stroke();
        ctx.setLineDash([]);
        if (sel) {
          ctx.strokeStyle = 'rgba(240,214,143,0.4)'; ctx.lineWidth = 1;
          rrect(ctx, -5, -5, w + 10, h + 10, 7); ctx.stroke();
        }
      }
      // HP / progress bar
      const showHp = sel || hov || b.hp < b.maxHp * 0.995;
      const progress = b.upgrade || !b.complete || b.converting
        ? U.clamp((b.buildProgress || 0) / Math.max(0.001, b.buildRequired || 1), 0, 1) : null;
      if (showHp && b.maxHp > 0) {
        const barW = Math.max(24, w * 0.55), hh = Math.max(3, z * 0.075);
        const bx = w / 2 - barW / 2, by = -hh - 5;
        this._bar(ctx, bx, by, barW, hh, b.hp / b.maxHp, 'rgba(20,16,11,0.8)', b.hp / b.maxHp > 0.55 ? '#799456' : b.hp / b.maxHp > 0.28 ? '#b8974c' : '#a24b3e');
      }
      if (progress != null) {
        const barW = Math.max(32, w * 0.68), hh = Math.max(4, z * 0.085);
        const bx = w / 2 - barW / 2, by = h + 5;
        this._bar(ctx, bx, by, barW, hh, progress, 'rgba(20,15,10,0.8)', '#d2b56f');
        if (this.game.camera && this.game.camera.zoom > 0.7 || this.camera.zoom > 0.7) {
          ctx.fillStyle = 'rgba(244,231,196,0.9)';
          ctx.font = `${Math.max(7, 9 * this.camera.zoom)}px Georgia, "SimSun", serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(Math.floor(progress * 100) + '%', w / 2, by + hh + 2);
        }
      }
      if (b.defId === 'hall' && b.complete) this._drawSettlementLabel(b, w, z, faction);
      // damaged smoke
      if (b.hp < b.maxHp * 0.45 && b.complete) {
        ctx.globalAlpha = 0.25 + Math.sin(this.anim * 2 + b.id.length) * 0.06;
        ctx.fillStyle = '#332e2a';
        for (let i = 0; i < 3; i++) {
          const ph = (this.anim * 0.25 + i * 0.3 + b.x * 0.05) % 1;
          ctx.beginPath(); ctx.arc(w * 0.66, h * 0.35 - ph * h * 0.4, (4 + ph * 8) * this.camera.zoom, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    _bar(ctx, x, y, w, h, ratio, bg, fg) {
      ctx.fillStyle = bg; rrect(ctx, x, y, w, h, h / 2); ctx.fill();
      ctx.fillStyle = fg; rrect(ctx, x + 0.5, y + 0.5, Math.max(0, (w - 1) * U.clamp(ratio, 0, 1)), h - 1, (h - 1) / 2); ctx.fill();
    }

    _drawSettlementLabel(b, w, z, faction) {
      const s = this.game.getSettlement(b.settlementId);
      if (!s || this.camera.zoom < 0.62) return;
      const ctx = this.ctx;
      const text = s.name;
      ctx.font = `600 ${Math.max(9, 11 * this.camera.zoom)}px "KaiTi", "STKaiti", Georgia, serif`;
      const tw = ctx.measureText(text).width;
      const bw = tw + 18, bh = Math.max(14, 17 * this.camera.zoom);
      const bx = w / 2 - bw / 2, by = -bh - 17;
      ctx.fillStyle = 'rgba(18,15,10,0.74)';
      rrect(ctx, bx, by, bw, bh, 2); ctx.fill();
      ctx.strokeStyle = U.rgba(faction ? faction.colors.secondary : '#cbb575', 0.7); ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = faction && faction.isPlayer ? '#f0d995' : '#e0d2af';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, by + bh / 2 + 0.5);
      if (faction) {
        this._banner(ctx, w / 2 - bw / 2 - 8, by - 5, 7, 12, faction);
      }
    }

    _drawConstruction(ctx, b, w, h, z, pal, faction) {
      ctx.save();
      // foundation and dirt
      ctx.fillStyle = '#635b4a'; rrect(ctx, w * 0.08, h * 0.3, w * 0.84, h * 0.58, 3); ctx.fill();
      ctx.fillStyle = '#877d68';
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.3 + hash(b.x, b.y, i + 20) * 0.3;
        ctx.fillRect(w * (0.12 + i * 0.18), h * 0.35, w * 0.11, h * 0.42);
      }
      ctx.globalAlpha = 1;
      // wood frame
      ctx.strokeStyle = '#9b7a4e'; ctx.lineWidth = Math.max(1.2, z * 0.055);
      ctx.beginPath();
      ctx.moveTo(w * 0.15, h * 0.78); ctx.lineTo(w * 0.15, h * 0.24);
      ctx.moveTo(w * 0.82, h * 0.78); ctx.lineTo(w * 0.82, h * 0.24);
      ctx.moveTo(w * 0.1, h * 0.32); ctx.lineTo(w * 0.86, h * 0.32);
      ctx.moveTo(w * 0.18, h * 0.7); ctx.lineTo(w * 0.78, h * 0.24);
      ctx.stroke();
      ctx.fillStyle = '#c3a775';
      ctx.fillRect(w * 0.12, h * 0.3, w * 0.12, h * 0.07);
      ctx.fillRect(w * 0.72, h * 0.6, w * 0.14, h * 0.06);
      // crates
      ctx.fillStyle = '#715537'; ctx.fillRect(w * 0.74, h * 0.76, w * 0.11, h * 0.1);
      ctx.strokeStyle = '#a78458'; ctx.lineWidth = 0.8; ctx.strokeRect(w * 0.74, h * 0.76, w * 0.11, h * 0.1);
      ctx.restore();
    }

    _drawScaffolding(ctx, w, h, z, partial) {
      ctx.save();
      ctx.strokeStyle = 'rgba(190,158,105,0.9)'; ctx.lineWidth = Math.max(1, z * 0.045);
      ctx.beginPath();
      ctx.moveTo(w * 0.2, h * 0.94); ctx.lineTo(w * 0.2, h * 0.05);
      ctx.moveTo(w * 0.82, h * 0.94); ctx.lineTo(w * 0.82, h * 0.05);
      ctx.moveTo(w * 0.12, h * 0.22); ctx.lineTo(w * 0.9, h * 0.22);
      ctx.moveTo(w * 0.12, h * 0.5); ctx.lineTo(w * 0.9, h * 0.5);
      ctx.moveTo(w * 0.2, h * 0.5); ctx.lineTo(w * 0.82, h * 0.22);
      ctx.stroke();
      ctx.restore();
    }

    _drawBuildingBody(ctx, b, w, h, z, pal, faction) {
      const type = b.defId;
      const t = z;
      const accent = faction ? faction.colors.primary : '#7a2e2e';
      const accent2 = faction ? faction.colors.secondary : '#d8bb71';
      const lvl = b.level;
      switch (type) {
        case 'hall': this._artHall(ctx, b, w, h, t, pal, faction, lvl); break;
        case 'house': this._artHouse(ctx, b, w, h, t, pal, faction, lvl); break;
        case 'lumber': this._artLumber(ctx, b, w, h, t, pal, faction); break;
        case 'hunter': this._artHunter(ctx, b, w, h, t, pal, faction); break;
        case 'fishery': this._artFishery(ctx, b, w, h, t, pal, faction); break;
        case 'gatherer': this._artGatherer(ctx, b, w, h, t, pal, faction); break;
        case 'quarry': this._artQuarry(ctx, b, w, h, t, pal); break;
        case 'ironMine': this._artMine(ctx, b, w, h, t, pal, '#77868b', faction); break;
        case 'goldMine': this._artMine(ctx, b, w, h, t, pal, '#d3aa47', faction); break;
        case 'silverMine': this._artMine(ctx, b, w, h, t, pal, '#b9c9cb', faction); break;
        case 'farm': this._artFarm(ctx, b, w, h, t, faction); break;
        case 'mill': this._artMill(ctx, b, w, h, t, pal, faction); break;
        case 'smelter': this._artSmelter(ctx, b, w, h, t, pal); break;
        case 'mint': this._artMint(ctx, b, w, h, t, pal, faction); break;
        case 'warehouse': this._artWarehouse(ctx, b, w, h, t, pal, faction); break;
        case 'church': this._artChurch(ctx, b, w, h, t, pal, faction); break;
        case 'market': this._artMarket(ctx, b, w, h, t, pal, faction); break;
        case 'tavern': this._artTavern(ctx, b, w, h, t, pal, faction); break;
        case 'clinic': this._artClinic(ctx, b, w, h, t, pal); break;
        case 'hospital': this._artHospital(ctx, b, w, h, t, pal, faction); break;
        case 'dock': this._artDock(ctx, b, w, h, t, pal, faction); break;
        case 'barracks': this._artBarracks(ctx, b, w, h, t, pal, faction); break;
        case 'archery': this._artArchery(ctx, b, w, h, t, pal, faction); break;
        case 'stable': this._artStable(ctx, b, w, h, t, pal, faction); break;
        case 'tower': this._artTower(ctx, b, w, h, t, pal, faction); break;
        case 'wall': this._artWall(ctx, b, w, h, t, pal, faction); break;
        case 'gate': this._artGate(ctx, b, w, h, t, pal, faction); break;
        case 'knightOrder': this._artKnightOrder(ctx, b, w, h, t, pal, faction); break;
        case 'library': this._artLibrary(ctx, b, w, h, t, pal, faction); break;
        case 'university': this._artUniversity(ctx, b, w, h, t, pal, faction); break;
        case 'royalUniversity': this._artRoyalUniversity(ctx, b, w, h, t, pal, faction); break;
        default: this._artGeneric(ctx, b, w, h, t, pal, faction);
      }
    }

    _banner(ctx, x, y, w, h, faction) {
      if (!faction) return;
      ctx.save();
      ctx.strokeStyle = '#5d4a2c'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x + w / 2, y - h * 0.3); ctx.lineTo(x + w / 2, y); ctx.stroke();
      ctx.fillStyle = faction.colors.primary;
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h * 0.72);
      ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h * 0.72); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = faction.colors.secondary; ctx.lineWidth = 0.7; ctx.stroke();
      this.drawCrestIcon(ctx, x + w / 2, y + h * 0.4, w * 0.62, faction, '#f0e4c5');
      ctx.restore();
    }

    drawCrestIcon(ctx, cx, cy, size, faction, color) {
      if (!faction) return;
      ctx.save();
      ctx.translate(cx, cy);
      const s = size / 20;
      ctx.strokeStyle = color || faction.colors.accent; ctx.fillStyle = color || faction.colors.accent;
      ctx.lineWidth = Math.max(0.8, 1.4 * s);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      switch (faction.crest) {
        case 'cross':
          ctx.fillRect(-1.2 * s, -6 * s, 2.4 * s, 12 * s); ctx.fillRect(-5 * s, -2 * s, 10 * s, 2.4 * s); break;
        case 'eagle':
          ctx.beginPath(); ctx.moveTo(0, -7 * s); ctx.lineTo(-2 * s, -3 * s); ctx.lineTo(-8 * s, -5 * s); ctx.lineTo(-4 * s, 0); ctx.lineTo(-6 * s, 5 * s); ctx.lineTo(-1 * s, 3 * s); ctx.lineTo(0, 7 * s); ctx.lineTo(1 * s, 3 * s); ctx.lineTo(6 * s, 5 * s); ctx.lineTo(4 * s, 0); ctx.lineTo(8 * s, -5 * s); ctx.lineTo(2 * s, -3 * s); ctx.closePath(); ctx.fill(); break;
        case 'lion':
          ctx.beginPath(); ctx.arc(0, 0, 4 * s, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-3 * s, 2 * s); ctx.lineTo(-7 * s, 6 * s); ctx.lineTo(-2 * s, 5 * s); ctx.lineTo(0, 8 * s); ctx.lineTo(2 * s, 4 * s); ctx.lineTo(6 * s, 5 * s); ctx.fill(); break;
        case 'stag':
          ctx.beginPath(); ctx.moveTo(0, -2 * s); ctx.lineTo(0, 6 * s); ctx.moveTo(0, -2 * s); ctx.lineTo(-4 * s, -7 * s); ctx.lineTo(-6 * s, -4 * s); ctx.lineTo(-3 * s, -3 * s); ctx.moveTo(0, -2 * s); ctx.lineTo(4 * s, -7 * s); ctx.lineTo(6 * s, -4 * s); ctx.lineTo(3 * s, -3 * s); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 1 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill(); break;
        case 'tower':
          ctx.fillRect(-4 * s, -2 * s, 8 * s, 8 * s);
          for (let i = -4; i <= 2; i += 3) ctx.fillRect(i * s, -5 * s, 2 * s, 3 * s);
          ctx.fillStyle = '#2b2118'; ctx.fillRect(-1.2 * s, 3 * s, 2.4 * s, 3 * s); break;
        case 'fleur':
          ctx.beginPath(); ctx.moveTo(0, -7 * s); ctx.quadraticCurveTo(5 * s, -3 * s, 0, 0); ctx.quadraticCurveTo(-5 * s, -3 * s, 0, -7 * s); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-6 * s, 0); ctx.quadraticCurveTo(-2 * s, 2 * s, 0, 6 * s); ctx.quadraticCurveTo(2 * s, 2 * s, 6 * s, 0); ctx.quadraticCurveTo(2 * s, 4 * s, 0, 7 * s); ctx.quadraticCurveTo(-2 * s, 4 * s, -6 * s, 0); ctx.fill();
          ctx.fillRect(-0.9 * s, -3 * s, 1.8 * s, 9 * s); break;
        case 'raven':
          ctx.beginPath(); ctx.moveTo(0, -6 * s); ctx.quadraticCurveTo(4 * s, -2 * s, 3 * s, 2 * s); ctx.lineTo(7 * s, 5 * s); ctx.lineTo(2 * s, 5 * s); ctx.lineTo(0, 8 * s); ctx.lineTo(-2 * s, 5 * s); ctx.lineTo(-7 * s, 5 * s); ctx.lineTo(-3 * s, 2 * s); ctx.quadraticCurveTo(-4 * s, -2 * s, 0, -6 * s); ctx.fill(); break;
        case 'sun':
          ctx.beginPath(); ctx.arc(0, 0, 3.4 * s, 0, Math.PI * 2); ctx.fill();
          for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 4.8 * s, Math.sin(a) * 4.8 * s); ctx.lineTo(Math.cos(a) * 7.5 * s, Math.sin(a) * 7.5 * s); ctx.stroke(); } break;
        case 'sword':
          ctx.beginPath(); ctx.moveTo(0, -8 * s); ctx.lineTo(2 * s, -4 * s); ctx.lineTo(2 * s, 4 * s); ctx.lineTo(-2 * s, 4 * s); ctx.lineTo(-2 * s, -4 * s); ctx.closePath(); ctx.fill();
          ctx.fillRect(-4 * s, 3 * s, 8 * s, 1.6 * s); ctx.fillRect(-1 * s, 4.5 * s, 2 * s, 3.5 * s); break;
        case 'oak':
          ctx.beginPath(); ctx.arc(0, -1 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(-3 * s, 2 * s, 3 * s, 0, Math.PI * 2); ctx.arc(3 * s, 2 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(-1 * s, 3 * s, 2 * s, 5 * s); break;
        default:
          ctx.beginPath(); ctx.arc(0, 0, 5 * s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // ==== specific building art ====
    _roof(ctx, x, y, w, h, light, dark, ridge) {
      // two-sloped roof with a ridge across the middle
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.52); ctx.lineTo(x + w, y + h * 0.52); ctx.lineTo(x + w - w * 0.06, y + h); ctx.lineTo(x + w * 0.06, y + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.08, y + h * 0.52); ctx.lineTo(x + w * 0.5, y); ctx.lineTo(x + w * 0.92, y + h * 0.52); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ridge || 'rgba(30,24,17,0.35)'; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const yy = y + h * 0.52 + (h * 0.48 * i) / 4;
        ctx.beginPath(); ctx.moveTo(x + 3, yy); ctx.lineTo(x + w - 3, yy); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,244,210,0.09)';
      ctx.beginPath(); ctx.moveTo(x + w * 0.1, y + h * 0.5); ctx.lineTo(x + w * 0.5, y + 1); ctx.lineTo(x + w * 0.5, y + h * 0.5); ctx.closePath(); ctx.fill();
    }
    _timber(ctx, x, y, w, h, col) {
      ctx.strokeStyle = col || 'rgba(72,48,30,0.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y + h); ctx.lineTo(x + w * 0.22, y);
      ctx.moveTo(x + w * 0.5, y + h); ctx.lineTo(x + w * 0.42, y);
      ctx.moveTo(x + w, y + h * 0.2); ctx.lineTo(x, y + h * 0.2);
      ctx.stroke();
    }
    _windows(ctx, x, y, w, h, n, col) {
      ctx.fillStyle = col || '#e5c980';
      for (let i = 0; i < n; i++) {
        const wx = x + (w / (n + 1)) * (i + 1);
        ctx.beginPath(); ctx.arc(wx, y + h / 2, Math.min(2, w / 12), 0, Math.PI * 2); ctx.fill();
      }
    }
    _smoke(ctx, x, y, scale) {
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const ph = (this.anim * 0.22 + i * 0.26) % 1;
        ctx.globalAlpha = (1 - ph) * 0.24;
        ctx.fillStyle = '#d0c7b4';
        ctx.beginPath();
        ctx.arc(x + Math.sin(this.anim + i) * 3 * scale, y - ph * 20 * scale, (2.2 + ph * 4.5) * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    _artGeneric(ctx, b, w, h, z, pal, faction) {
      const pad = z * 0.1;
      ctx.fillStyle = pal.wall; ctx.fillRect(pad, h * 0.38, w - pad * 2, h * 0.52);
      this._timber(ctx, pad, h * 0.38, w - pad * 2, h * 0.52);
      this._roof(ctx, pad * 0.4, h * 0.18, w - pad * 0.8, h * 0.46, pal.roof, pal.roofDark);
      ctx.fillStyle = '#392d22'; ctx.fillRect(w * 0.42, h * 0.66, w * 0.16, h * 0.24);
      this._banner(ctx, w * 0.86, h * 0.1, z * 0.18, z * 0.3, faction);
    }
    _artHall(ctx, b, w, h, z, pal, faction, lvl) {
      const acc = faction ? faction.colors : { primary: '#7a2e2e', secondary: '#d9c27c' };
      if (lvl === 1) {
        // packed-earth courtyard
        ctx.fillStyle = 'rgba(125,104,70,0.28)';
        rrect(ctx, w * 0.08, h * 0.15, w * 0.84, h * 0.77, w * 0.08); ctx.fill();
        ctx.fillStyle = 'rgba(192,173,130,0.2)';
        for (let i = 0; i < 16; i++) {
          const rx = w * (0.13 + hash(b.x, b.y, 820 + i) * 0.74);
          const ry = h * (0.2 + hash(b.x, b.y, 840 + i) * 0.66);
          ctx.beginPath(); ctx.ellipse(rx, ry, z * 0.03, z * 0.014, hash(b.x, b.y, i) * 3, 0, Math.PI * 2); ctx.fill();
        }
        // palisade ring, leaving a south gate
        ctx.strokeStyle = '#5a4029'; ctx.lineWidth = Math.max(1, z * 0.05);
        for (let i = 0; i < 12; i++) {
          const f = i / 11;
          const topX = w * (0.1 + f * 0.8);
          const leftY = h * (0.2 + f * 0.65);
          if (i < 3 || i > 8) { ctx.beginPath(); ctx.moveTo(topX, h * 0.18); ctx.lineTo(topX, h * 0.27); ctx.stroke(); }
          if (i < 3 || i > 8) { ctx.beginPath(); ctx.moveTo(w * 0.09, leftY); ctx.lineTo(w * 0.17, leftY); ctx.stroke(); }
          ctx.beginPath(); ctx.moveTo(w * 0.91, leftY); ctx.lineTo(w * 0.84, leftY); ctx.stroke();
        }
        ctx.strokeStyle = '#896b43'; ctx.lineWidth = Math.max(1, z * 0.03);
        ctx.beginPath(); ctx.moveTo(w * 0.09, h * 0.2); ctx.lineTo(w * 0.09, h * 0.82); ctx.moveTo(w * 0.91, h * 0.2); ctx.lineTo(w * 0.91, h * 0.82); ctx.stroke();
        // main timber hall
        ctx.fillStyle = '#7a5c3e';
        ctx.fillRect(w * 0.23, h * 0.23, w * 0.54, h * 0.44);
        this._timber(ctx, w * 0.23, h * 0.23, w * 0.54, h * 0.44, 'rgba(48,32,20,0.8)');
        this._roof(ctx, w * 0.17, h * 0.08, w * 0.66, h * 0.31, '#a68959', '#6e5639');
        // ridge crest / carvings
        ctx.strokeStyle = '#d0b87a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(w * 0.23, h * 0.14); ctx.quadraticCurveTo(w * 0.5, h * 0.06, w * 0.77, h * 0.14); ctx.stroke();
        ctx.fillStyle = '#3f2c1e'; ctx.fillRect(w * 0.46, h * 0.55, w * 0.1, h * 0.22);
        ctx.fillStyle = '#d6ba80'; ctx.beginPath(); ctx.arc(w * 0.51, h * 0.67, z * 0.025, 0, Math.PI * 2); ctx.fill();
        // side lean-to and well
        ctx.fillStyle = '#6e5339'; ctx.fillRect(w * 0.75, h * 0.55, w * 0.13, h * 0.18);
        this._roof(ctx, w * 0.73, h * 0.49, w * 0.17, h * 0.1, '#76603f', '#493927');
        ctx.fillStyle = '#6d6a5f'; ctx.beginPath(); ctx.arc(w * 0.2, h * 0.76, z * 0.075, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1b2526'; ctx.beginPath(); ctx.arc(w * 0.2, h * 0.76, z * 0.045, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#a98b58'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w * 0.2, h * 0.76, z * 0.075, 0, Math.PI * 2); ctx.stroke();
        // campfire
        const flame = 1 + Math.sin(this.anim * 8 + b.x) * 0.15;
        ctx.fillStyle = 'rgba(216,136,54,0.16)'; ctx.beginPath(); ctx.arc(w * 0.76, h * 0.78, z * 0.16 * flame, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d68035'; ctx.beginPath(); ctx.moveTo(w * 0.76, h * 0.75); ctx.quadraticCurveTo(w * 0.72, h * 0.8, w * 0.76, h * 0.83); ctx.quadraticCurveTo(w * 0.8, h * 0.8, w * 0.76, h * 0.75); ctx.fill();
        ctx.strokeStyle = '#5b402a'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(w * 0.72, h * 0.84); ctx.lineTo(w * 0.8, h * 0.81); ctx.moveTo(w * 0.72, h * 0.81); ctx.lineTo(w * 0.8, h * 0.84); ctx.stroke();
        // banners flanking the hall
        this._banner(ctx, w * 0.12, h * 0.13, z * 0.24, z * 0.46, faction);
        this._banner(ctx, w * 0.82, h * 0.13, z * 0.24, z * 0.46, faction);
        this._smoke(ctx, w * 0.69, h * 0.22, z / 40);
      } else {
        // stone curtain and keep
        ctx.fillStyle = pal.stone; ctx.fillRect(w * 0.04, h * 0.34, w * 0.92, h * 0.56);
        ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.22, h * 0.2, w * 0.56, h * 0.58);
        // corner towers
        for (const cx of [0.12, 0.88]) {
          ctx.fillStyle = pal.wallDark;
          ctx.beginPath(); ctx.arc(w * cx, h * 0.64, w * 0.09, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = pal.wall;
          ctx.beginPath(); ctx.arc(w * cx, h * 0.6, w * 0.08, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = pal.roofDark;
          ctx.beginPath(); ctx.moveTo(w * cx - w * 0.11, h * 0.55); ctx.lineTo(w * cx, h * 0.36); ctx.lineTo(w * cx + w * 0.11, h * 0.55); ctx.closePath(); ctx.fill();
          this._banner(ctx, w * cx - z * 0.1, h * 0.18, z * 0.2, z * 0.35, faction);
        }
        // keep roof
        this._roof(ctx, w * 0.18, h * 0.06, w * 0.64, h * 0.3, pal.roof, pal.roofDark);
        ctx.fillStyle = '#4e3927'; ctx.fillRect(w * 0.45, h * 0.6, w * 0.1, h * 0.3);
        this._windows(ctx, w * 0.25, h * 0.48, w * 0.2, h * 0.12, 2);
        this._windows(ctx, w * 0.58, h * 0.48, w * 0.2, h * 0.12, 2);
        if (lvl >= 3) {
          ctx.fillStyle = U.rgba(pal.trim, 0.9);
          for (let i = 0; i < 5; i++) ctx.fillRect(w * (0.24 + i * 0.08), h * 0.32, w * 0.04, z * 0.035);
          if (lvl === 4) {
            // gold domes
            ctx.fillStyle = '#d9b962';
            for (const cx of [0.28, 0.72]) {
              ctx.beginPath(); ctx.arc(w * cx, h * 0.26, w * 0.075, Math.PI, 0); ctx.fill();
              ctx.fillRect(w * cx - w * 0.075, h * 0.26, w * 0.15, h * 0.08);
            }
            this._banner(ctx, w * 0.46, h * 0.02, z * 0.25, z * 0.46, faction);
          }
        }
        // central banner
        if (lvl < 4) this._banner(ctx, w * 0.45, h * 0.01, z * 0.22, z * 0.4, faction);
        if (lvl >= 2) {
          ctx.fillStyle = '#c8b47f';
          ctx.beginPath(); ctx.arc(w * 0.5, h * 0.17, z * 0.04, 0, Math.PI * 2); ctx.fill();
        }
      }
      // courtyard stones
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#d6c49a';
      for (let i = 0; i < 10; i++) {
        const rx = hash(b.x, b.y, 800 + i) * w, ry = hash(b.x, b.y, 810 + i) * h;
        ctx.fillRect(rx, ry, z * 0.07, z * 0.025);
      }
      ctx.globalAlpha = 1;
    }
    _artHouse(ctx, b, w, h, z, pal, faction, lvl) {
      const pad = z * 0.12;
      ctx.fillStyle = pal.wall; ctx.fillRect(pad, h * 0.36, w - pad * 2, h * 0.52);
      this._timber(ctx, pad, h * 0.36, w - pad * 2, h * 0.52);
      this._roof(ctx, pad * 0.5, h * 0.13, w - pad, h * 0.44, pal.roof, pal.roofDark);
      ctx.fillStyle = '#3f3022'; ctx.fillRect(w * 0.42, h * 0.64, w * 0.16, h * 0.26);
      ctx.fillStyle = '#a99d7e'; ctx.fillRect(w * 0.7, h * 0.2, w * 0.09, h * 0.2);
      this._smoke(ctx, w * 0.74, h * 0.2, z / 32);
      ctx.fillStyle = '#d6bd85'; ctx.beginPath(); ctx.arc(w * 0.2, h * 0.54, z * 0.06, 0, Math.PI * 2); ctx.fill();
      if (lvl >= 3) {
        ctx.fillStyle = pal.trim; ctx.fillRect(w * 0.35, h * 0.4, w * 0.3, z * 0.04);
        this._windows(ctx, w * 0.3, h * 0.48, w * 0.4, h * 0.1, 2);
      }
      // little garden
      ctx.globalAlpha = 0.34; ctx.fillStyle = '#557442';
      ctx.beginPath(); ctx.ellipse(w * 0.83, h * 0.84, w * 0.14, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    _artLumber(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.08, h * 0.35, w * 0.6, h * 0.48);
      this._timber(ctx, w * 0.08, h * 0.35, w * 0.6, h * 0.48);
      this._roof(ctx, w * 0.04, h * 0.18, w * 0.68, h * 0.32, pal.roof, pal.roofDark);
      // logs
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? '#7a5938' : '#8d6942';
        ctx.beginPath(); ctx.ellipse(w * 0.76, h * (0.58 + i * 0.1), z * 0.15, z * 0.055, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#4f3925'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(w * 0.76, h * (0.58 + i * 0.1), z * 0.055, 0, Math.PI * 2); ctx.stroke();
      }
      // axe block
      ctx.fillStyle = '#5c432d'; ctx.fillRect(w * 0.72, h * 0.78, z * 0.1, z * 0.06);
      ctx.strokeStyle = '#bfb08d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * 0.77, h * 0.78); ctx.lineTo(w * 0.84, h * 0.68); ctx.stroke();
      this._banner(ctx, w * 0.88, h * 0.2, z * 0.14, z * 0.3, faction);
    }
    _artHunter(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.1, h * 0.36, w * 0.64, h * 0.5);
      this._timber(ctx, w * 0.1, h * 0.36, w * 0.64, h * 0.5);
      this._roof(ctx, w * 0.05, h * 0.2, w * 0.74, h * 0.34, '#6f5639', '#4b3725');
      // antlers over the door
      ctx.strokeStyle = '#c2ad82'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.46, h * 0.57); ctx.lineTo(w * 0.4, h * 0.47); ctx.lineTo(w * 0.34, h * 0.5);
      ctx.moveTo(w * 0.46, h * 0.57); ctx.lineTo(w * 0.52, h * 0.47); ctx.lineTo(w * 0.58, h * 0.5);
      ctx.stroke();
      // drying rack
      ctx.strokeStyle = '#6b5135'; ctx.beginPath(); ctx.moveTo(w * 0.78, h * 0.55); ctx.lineTo(w * 0.78, h * 0.88); ctx.moveTo(w * 0.68, h * 0.64); ctx.lineTo(w * 0.9, h * 0.64); ctx.stroke();
      ctx.fillStyle = '#8e6847'; ctx.fillRect(w * 0.69, h * 0.65, z * 0.08, h * 0.12);
      this._smoke(ctx, w * 0.18, h * 0.36, z / 36);
    }
    _artFishery(ctx, b, w, h, z, pal, faction) {
      // hut on stilts with a little pier
      ctx.fillStyle = '#6c5238'; ctx.fillRect(w * 0.08, h * 0.2, w * 0.55, h * 0.5);
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.12, h * 0.38, w * 0.47, h * 0.4);
      this._roof(ctx, w * 0.06, h * 0.2, w * 0.58, h * 0.3, '#786242', '#504028');
      ctx.fillStyle = '#7b5e3e'; ctx.fillRect(w * 0.62, h * 0.52, w * 0.34, h * 0.1);
      // nets
      ctx.strokeStyle = 'rgba(214,198,156,0.55)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(w * 0.78, h * 0.68, z * 0.1, 0.2, Math.PI - 0.2); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(w * 0.7 + i * 4, h * 0.65); ctx.lineTo(w * 0.7 + i * 4, h * 0.78); ctx.stroke(); }
      ctx.fillStyle = '#b9a77e'; ctx.beginPath(); ctx.arc(w * 0.25, h * 0.6, z * 0.045, 0, Math.PI * 2); ctx.fill();
      this._banner(ctx, w * 0.86, h * 0.15, z * 0.13, z * 0.28, faction);
    }
    _artGatherer(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.12, h * 0.36, w * 0.58, h * 0.48);
      this._timber(ctx, w * 0.12, h * 0.36, w * 0.58, h * 0.48);
      this._roof(ctx, w * 0.07, h * 0.2, w * 0.66, h * 0.32, '#8b6e46', '#5d482e');
      // baskets
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#a37b45'; ctx.beginPath(); ctx.ellipse(w * (0.72 + (i % 2) * 0.12), h * (0.7 + Math.floor(i / 2) * 0.12), z * 0.07, z * 0.04, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a84743';
        for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(w * (0.7 + (i % 2) * 0.12) + (j - 1) * 2, h * (0.69 + Math.floor(i / 2) * 0.12), 1, 0, Math.PI * 2); ctx.fill(); }
      }
      this._banner(ctx, w * 0.86, h * 0.18, z * 0.14, z * 0.28, faction);
    }
    _artQuarry(ctx, b, w, h, z, pal) {
      ctx.fillStyle = '#736c5b';
      ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.6, w * 0.43, h * 0.33, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4e4a3f';
      ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.63, w * 0.29, h * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#97917e'; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(w * (0.35 + i * 0.08), h * (0.62 + (i % 2) * 0.06), w * (0.2 - i * 0.02), 0.1, Math.PI - 0.2); ctx.stroke();
      }
      // stone blocks
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#9a9283' : '#a9a190';
        rrect(ctx, w * (0.68 + (i % 2) * 0.12), h * (0.5 + Math.floor(i / 2) * 0.14), z * 0.12, z * 0.1, 1); ctx.fill();
      }
      // crane
      ctx.strokeStyle = '#6e5436'; ctx.lineWidth = Math.max(1, z * 0.04);
      ctx.beginPath(); ctx.moveTo(w * 0.16, h * 0.72); ctx.lineTo(w * 0.16, h * 0.22); ctx.lineTo(w * 0.42, h * 0.35); ctx.moveTo(w * 0.16, h * 0.22); ctx.lineTo(w * 0.3, h * 0.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.4, h * 0.34); ctx.lineTo(w * 0.4, h * 0.54); ctx.stroke();
    }
    _artMine(ctx, b, w, h, z, pal, oreColor, faction) {
      ctx.fillStyle = '#6e685b';
      ctx.beginPath(); ctx.moveTo(w * 0.04, h * 0.85); ctx.lineTo(w * 0.18, h * 0.26); ctx.lineTo(w * 0.48, h * 0.12); ctx.lineTo(w * 0.78, h * 0.3); ctx.lineTo(w * 0.96, h * 0.85); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#514d44';
      ctx.beginPath(); ctx.moveTo(w * 0.22, h * 0.85); ctx.lineTo(w * 0.28, h * 0.48); ctx.lineTo(w * 0.58, h * 0.32); ctx.lineTo(w * 0.8, h * 0.52); ctx.lineTo(w * 0.88, h * 0.85); ctx.closePath(); ctx.fill();
      // timber entrance
      ctx.fillStyle = '#5b4129';
      ctx.fillRect(w * 0.35, h * 0.43, w * 0.3, h * 0.4);
      ctx.fillStyle = '#171512';
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.6, w * 0.095, Math.PI, 0); ctx.lineTo(w * 0.595, h * 0.83); ctx.lineTo(w * 0.405, h * 0.83); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#a08053'; ctx.lineWidth = 1.2; ctx.strokeRect(w * 0.33, h * 0.43, w * 0.34, h * 0.03);
      // ore pile
      ctx.fillStyle = oreColor; ctx.globalAlpha = 0.8;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.arc(w * (0.72 + hash(b.x, b.y, i) * 0.17), h * (0.7 + hash(b.x, b.y, i + 4) * 0.12), z * 0.035, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // rails
      ctx.strokeStyle = '#7d6a4a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w * 0.43, h * 0.86); ctx.lineTo(w * 0.4, h * 0.98); ctx.moveTo(w * 0.57, h * 0.86); ctx.lineTo(w * 0.6, h * 0.98); ctx.stroke();
      ctx.fillStyle = '#7a5940'; ctx.fillRect(w * 0.68, h * 0.84, z * 0.12, z * 0.07);
      this._banner(ctx, w * 0.89, h * 0.27, z * 0.13, z * 0.26, faction);
    }
    _artFarm(ctx, b, w, h, z, faction) {
      // furrowed field
      ctx.fillStyle = '#9c874e'; ctx.fillRect(w * 0.04, h * 0.12, w * 0.92, h * 0.8);
      ctx.strokeStyle = '#715f35'; ctx.lineWidth = Math.max(1, z * 0.03);
      for (let i = 0; i < 8; i++) {
        const yy = h * (0.2 + i * 0.09);
        ctx.beginPath(); ctx.moveTo(w * 0.08, yy); ctx.bezierCurveTo(w * 0.3, yy - 3, w * 0.6, yy + 3, w * 0.92, yy); ctx.stroke();
        ctx.strokeStyle = i % 2 ? '#c6ae63' : '#806b3c';
      }
      // wheat
      ctx.strokeStyle = '#dbc474'; ctx.lineWidth = 0.8;
      for (let i = 0; i < 22; i++) {
        const xx = w * (0.1 + hash(b.x, b.y, 900 + i) * 0.8);
        const yy = h * (0.18 + hash(b.x, b.y, 950 + i) * 0.65);
        ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + 0.5, yy - 4); ctx.stroke();
      }
      // fence
      ctx.strokeStyle = '#6b5134'; ctx.lineWidth = 1;
      for (let i = 0; i <= 6; i++) { const xx = w * (0.02 + i * 0.16); ctx.beginPath(); ctx.moveTo(xx, h * 0.94); ctx.lineTo(xx, h * 0.84); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(w * 0.02, h * 0.88); ctx.lineTo(w * 0.98, h * 0.88); ctx.stroke();
      // scarecrow
      ctx.strokeStyle = '#59452d'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(w * 0.8, h * 0.5); ctx.lineTo(w * 0.8, h * 0.8); ctx.moveTo(w * 0.72, h * 0.58); ctx.lineTo(w * 0.88, h * 0.58); ctx.stroke();
      ctx.fillStyle = '#7f5d3d'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.48, z * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#d6cba6'; ctx.beginPath(); ctx.moveTo(w * 0.75, h * 0.46); ctx.lineTo(w * 0.85, h * 0.45); ctx.stroke();
    }
    _artMill(ctx, b, w, h, z, pal, faction) {
      // small mill house
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.24, h * 0.38, w * 0.55, h * 0.46);
      this._timber(ctx, w * 0.24, h * 0.38, w * 0.55, h * 0.46);
      this._roof(ctx, w * 0.19, h * 0.22, w * 0.65, h * 0.3, pal.roof, pal.roofDark);
      // rotating sails
      const cx = w * 0.5, cy = h * 0.45;
      const r = w * 0.36;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(this.anim * 0.35);
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 2);
        ctx.fillStyle = '#c0a36d'; ctx.fillRect(2, -2, r, 4);
        ctx.strokeStyle = '#6a5237'; ctx.lineWidth = 1;
        ctx.strokeRect(8, -10 * this.camera.zoom, r * 0.72, 12 * this.camera.zoom);
        ctx.strokeStyle = 'rgba(84,62,40,0.6)';
        for (let j = 1; j < 4; j++) { ctx.beginPath(); ctx.moveTo(8 + j * r * 0.18, -10 * this.camera.zoom); ctx.lineTo(8 + j * r * 0.18, 2 * this.camera.zoom); ctx.stroke(); }
        ctx.restore();
      }
      ctx.fillStyle = '#4e3b29'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      this._banner(ctx, w * 0.88, h * 0.17, z * 0.13, z * 0.26, faction);
    }
    _artSmelter(ctx, b, w, h, z, pal) {
      ctx.fillStyle = pal.stone; ctx.fillRect(w * 0.1, h * 0.38, w * 0.72, h * 0.48);
      ctx.fillStyle = pal.wallDark; ctx.fillRect(w * 0.12, h * 0.4, w * 0.68, h * 0.1);
      this._roof(ctx, w * 0.08, h * 0.3, w * 0.76, h * 0.18, pal.roof, pal.roofDark);
      // chimney
      ctx.fillStyle = '#7b7366'; ctx.fillRect(w * 0.67, h * 0.08, w * 0.16, h * 0.34);
      ctx.fillStyle = '#565149'; ctx.fillRect(w * 0.65, h * 0.06, w * 0.2, h * 0.05);
      this._smoke(ctx, w * 0.75, h * 0.08, z / 30);
      // furnace glow
      ctx.fillStyle = '#e88a35'; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(w * 0.35, h * 0.72, z * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#ffc05c';
      ctx.beginPath(); ctx.arc(w * 0.35, h * 0.72, z * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // anvil
      ctx.fillStyle = '#4f4b44'; ctx.fillRect(w * 0.56, h * 0.72, z * 0.16, z * 0.06);
      ctx.fillRect(w * 0.6, h * 0.78, z * 0.08, z * 0.05);
      ctx.strokeStyle = '#c3ae83'; ctx.beginPath(); ctx.moveTo(w * 0.9, h * 0.2); ctx.lineTo(w * 0.9, h * 0.5); ctx.stroke();
    }
    _artMint(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.12, h * 0.34, w * 0.68, h * 0.52);
      this._timber(ctx, w * 0.12, h * 0.34, w * 0.68, h * 0.52);
      this._roof(ctx, w * 0.08, h * 0.18, w * 0.76, h * 0.32, pal.roof, pal.roofDark);
      // coin sign
      ctx.fillStyle = '#d7b85f'; ctx.beginPath(); ctx.arc(w * 0.46, h * 0.62, z * 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7b5d28'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w * 0.46, h * 0.62, z * 0.11, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#7b5d28'; ctx.font = `bold ${Math.max(6, z * 0.12)}px Georgia`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', w * 0.46, h * 0.62 + 1);
      ctx.fillStyle = '#8c8272'; ctx.fillRect(w * 0.73, h * 0.12, w * 0.1, h * 0.3);
      this._smoke(ctx, w * 0.78, h * 0.12, z / 34);
    }
    _artWarehouse(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.06, h * 0.34, w * 0.88, h * 0.55);
      this._timber(ctx, w * 0.06, h * 0.34, w * 0.88, h * 0.55);
      this._roof(ctx, w * 0.02, h * 0.14, w * 0.96, h * 0.34, pal.roof, pal.roofDark);
      // big doors
      ctx.fillStyle = '#4a3826'; ctx.fillRect(w * 0.36, h * 0.58, w * 0.28, h * 0.3);
      ctx.strokeStyle = '#8a6b44'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.58); ctx.lineTo(w * 0.5, h * 0.88); ctx.stroke();
      // crates and barrels
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#7a5b3a'; ctx.fillRect(w * (0.08 + i * 0.08), h * (0.75 + (i % 2) * 0.06), z * 0.11, z * 0.1);
        ctx.strokeStyle = '#4e3825'; ctx.lineWidth = 0.7; ctx.strokeRect(w * (0.08 + i * 0.08), h * (0.75 + (i % 2) * 0.06), z * 0.11, z * 0.1);
      }
      ctx.fillStyle = '#875f36'; ctx.beginPath(); ctx.ellipse(w * 0.82, h * 0.8, z * 0.07, z * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      this._banner(ctx, w * 0.9, h * 0.17, z * 0.14, z * 0.28, faction);
    }
    _artChurch(ctx, b, w, h, z, pal, faction) {
      // nave
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.18, h * 0.46, w * 0.64, h * 0.42);
      ctx.fillStyle = pal.roofDark; ctx.fillRect(w * 0.16, h * 0.35, w * 0.68, h * 0.8);
      this._timber(ctx, w * 0.18, h * 0.46, w * 0.64, h * 0.42);
      this._roof(ctx, w * 0.12, h * 0.38, w * 0.76, h * 0.2, pal.roof, pal.roofDark);
      // tower
      ctx.fillStyle = pal.wallDark; ctx.fillRect(w * 0.42, h * 0.12, w * 0.16, h * 0.48);
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.44, h * 0.14, w * 0.12, h * 0.44);
      ctx.fillStyle = pal.roofDark;
      ctx.beginPath(); ctx.moveTo(w * 0.4, h * 0.15); ctx.lineTo(w * 0.5, h * -0.02); ctx.lineTo(w * 0.6, h * 0.15); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#e4ce92'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.08); ctx.lineTo(w * 0.5, h * 0.16); ctx.moveTo(w * 0.46, h * 0.11); ctx.lineTo(w * 0.54, h * 0.11); ctx.stroke();
      // arch windows
      ctx.fillStyle = '#d7bd80';
      for (let i = 0; i < 3; i++) {
        const wx = w * (0.27 + i * 0.2);
        ctx.beginPath(); ctx.arc(wx, h * 0.58, z * 0.045, Math.PI, 0); ctx.lineTo(wx + z * 0.045, h * 0.7); ctx.lineTo(wx - z * 0.045, h * 0.7); ctx.fill();
      }
      ctx.fillStyle = '#4a3424'; ctx.fillRect(w * 0.44, h * 0.72, w * 0.12, h * 0.18);
      if (b.level >= 3) {
        ctx.fillStyle = 'rgba(213,180,96,0.5)';
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.12, w * 0.02, 0, Math.PI * 2); ctx.fill();
      }
    }
    _artMarket(ctx, b, w, h, z, pal, faction) {
      const cloth = faction ? faction.colors.primary : '#8b3b32';
      const cloth2 = faction ? faction.colors.secondary : '#d8bd79';
      ctx.fillStyle = '#87765b'; ctx.fillRect(w * 0.04, h * 0.3, w * 0.92, h * 0.56);
      for (let i = 0; i < 3; i++) {
        const x = w * (0.06 + i * 0.29);
        const y = h * (0.38 + (i % 2) * 0.1);
        const sw = w * 0.25, sh = h * 0.33;
        ctx.fillStyle = '#6e5538'; ctx.fillRect(x + sw * 0.15, y + sh * 0.3, sw * 0.7, sh * 0.65);
        ctx.fillStyle = i % 2 ? cloth : cloth2;
        ctx.beginPath(); ctx.moveTo(x, y + sh * 0.28); ctx.lineTo(x + sw * 0.5, y); ctx.lineTo(x + sw, y + sh * 0.28); ctx.lineTo(x + sw * 0.92, y + sh * 0.38); ctx.lineTo(x + sw * 0.08, y + sh * 0.38); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 0.7;
        for (let j = 1; j < 4; j++) { ctx.beginPath(); ctx.moveTo(x + sw * j / 4, y + 2); ctx.lineTo(x + sw * j / 4, y + sh * 0.35); ctx.stroke(); }
        // goods
        ctx.fillStyle = '#915a3d'; ctx.beginPath(); ctx.ellipse(x + sw * 0.25, y + sh * 0.8, z * 0.045, z * 0.03, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b99954'; ctx.fillRect(x + sw * 0.55, y + sh * 0.75, z * 0.06, z * 0.04);
      }
      // central pole and flag
      this._banner(ctx, w * 0.48, h * 0.06, z * 0.2, z * 0.38, faction);
    }
    _artTavern(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.12, h * 0.34, w * 0.7, h * 0.54);
      this._timber(ctx, w * 0.12, h * 0.34, w * 0.7, h * 0.54);
      this._roof(ctx, w * 0.08, h * 0.18, w * 0.78, h * 0.32, '#8a6543', '#5a3f2a');
      ctx.fillStyle = '#9d8462'; ctx.fillRect(w * 0.7, h * 0.15, w * 0.08, h * 0.28);
      this._smoke(ctx, w * 0.74, h * 0.16, z / 32);
      // sign
      ctx.strokeStyle = '#5d4a2b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * 0.83, h * 0.48); ctx.lineTo(w * 0.9, h * 0.48); ctx.stroke();
      ctx.fillStyle = '#4d3522'; ctx.fillRect(w * 0.8, h * 0.49, w * 0.13, h * 0.14);
      ctx.strokeStyle = '#d7bd7b'; ctx.strokeRect(w * 0.8, h * 0.49, w * 0.13, h * 0.14);
      ctx.fillStyle = '#d7bd7b'; ctx.beginPath(); ctx.arc(w * 0.865, h * 0.555, z * 0.035, 0, Math.PI * 2); ctx.fill();
      // barrel outside
      ctx.fillStyle = '#76522f'; ctx.beginPath(); ctx.ellipse(w * 0.08, h * 0.79, z * 0.075, z * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4a311f'; ctx.stroke();
      this._windows(ctx, w * 0.24, h * 0.5, w * 0.34, h * 0.1, 2);
    }
    _artClinic(ctx, b, w, h, z, pal) {
      ctx.fillStyle = '#c1b89f'; ctx.fillRect(w * 0.1, h * 0.35, w * 0.8, h * 0.52);
      this._timber(ctx, w * 0.1, h * 0.35, w * 0.8, h * 0.52, 'rgba(100,70,45,0.5)');
      this._roof(ctx, w * 0.06, h * 0.2, w * 0.88, h * 0.3, '#846d50', '#5a4631');
      ctx.fillStyle = '#9a3d38'; ctx.fillRect(w * 0.47, h * 0.5, w * 0.06, h * 0.14); ctx.fillRect(w * 0.41, h * 0.55, w * 0.18, h * 0.045);
      // herb garden
      ctx.fillStyle = '#577442'; ctx.beginPath(); ctx.ellipse(w * 0.82, h * 0.8, w * 0.13, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#91a96b';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(w * (0.75 + hash(b.x, b.y, i) * 0.14), h * (0.75 + hash(b.x, b.y, i + 5) * 0.1), z * 0.02, 0, Math.PI * 2); ctx.fill(); }
    }
    _artHospital(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.06, h * 0.36, w * 0.88, h * 0.5);
      ctx.fillStyle = pal.stone; ctx.fillRect(w * 0.18, h * 0.25, w * 0.64, h * 0.2);
      this._roof(ctx, w * 0.04, h * 0.22, w * 0.92, h * 0.25, pal.roof, pal.roofDark);
      ctx.fillStyle = pal.wallDark; ctx.fillRect(w * 0.43, h * 0.13, w * 0.14, h * 0.3);
      ctx.fillStyle = pal.roofDark; ctx.beginPath(); ctx.moveTo(w * 0.4, h * 0.15); ctx.lineTo(w * 0.5, h * 0.02); ctx.lineTo(w * 0.6, h * 0.15); ctx.fill();
      ctx.fillStyle = '#d5d0bd'; ctx.fillRect(w * 0.47, h * 0.49, w * 0.06, h * 0.14); ctx.fillRect(w * 0.41, h * 0.54, w * 0.18, h * 0.04);
      ctx.strokeStyle = pal.trim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.44); ctx.lineTo(w * 0.1, h * 0.8); ctx.moveTo(w * 0.9, h * 0.44); ctx.lineTo(w * 0.9, h * 0.8); ctx.stroke();
      for (let i = 0; i < 4; i++) this._windows(ctx, w * (0.2 + i * 0.17), h * 0.48, w * 0.08, h * 0.08, 1, '#d9c28b');
      this._banner(ctx, w * 0.88, h * 0.18, z * 0.15, z * 0.3, faction);
    }
    _artDock(ctx, b, w, h, z, pal, faction) {
      const waterSide = this._waterDirection(b);
      const horiz = waterSide === 'left' || waterSide === 'right';
      // pier planks
      ctx.save();
      const deckH = z * 0.32;
      ctx.fillStyle = '#8e6c44';
      if (horiz) ctx.fillRect(0, h * 0.5 - deckH / 2, w, deckH);
      else ctx.fillRect(w * 0.5 - deckH / 2, 0, deckH, h);
      ctx.strokeStyle = '#5a4128'; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        if (horiz) { const xx = (w / 8) * i; ctx.beginPath(); ctx.moveTo(xx, h * 0.5 - deckH / 2); ctx.lineTo(xx, h * 0.5 + deckH / 2); ctx.stroke(); }
        else { const yy = (h / 8) * i; ctx.beginPath(); ctx.moveTo(w * 0.5 - deckH / 2, yy); ctx.lineTo(w * 0.5 + deckH / 2, yy); ctx.stroke(); }
      }
      // hut at land side
      const hx = waterSide === 'right' ? w * 0.08 : w * 0.66;
      const hy = h * 0.12;
      ctx.fillStyle = pal.wall; ctx.fillRect(hx, hy + h * 0.15, w * 0.26, h * 0.3);
      this._roof(ctx, hx - z * 0.03, hy, w * 0.32, h * 0.22, pal.roof, pal.roofDark);
      // crane
      ctx.strokeStyle = '#6f5432'; ctx.lineWidth = Math.max(1, z * 0.05);
      ctx.beginPath(); ctx.moveTo(w * 0.72, h * 0.8); ctx.lineTo(w * 0.72, h * 0.18); ctx.lineTo(w * 0.52, h * 0.3); ctx.stroke();
      ctx.strokeStyle = '#c5b17c'; ctx.beginPath(); ctx.moveTo(w * 0.56, h * 0.29); ctx.lineTo(w * 0.56, h * 0.48); ctx.stroke();
      // cargo
      ctx.fillStyle = '#755638'; ctx.fillRect(w * 0.2, h * 0.76, z * 0.12, z * 0.1);
      ctx.fillStyle = '#b2925e'; ctx.fillRect(w * 0.34, h * 0.78, z * 0.08, z * 0.08);
      this._banner(ctx, w * 0.12, h * 0.06, z * 0.14, z * 0.26, faction);
      ctx.restore();
    }
    _waterDirection(b) {
      const cx = Math.round(b.x + b.def.foot[0] / 2), cy = Math.round(b.y + b.def.foot[1] / 2);
      const dirs = [['right', 1, 0], ['left', -1, 0], ['down', 0, 1], ['up', 0, -1]];
      for (const [name, dx, dy] of dirs) {
        for (let r = 1; r <= 3; r++) {
          if (this.game.world.isWater(cx + dx * r, cy + dy * r)) return name;
        }
      }
      return 'right';
    }
    _artBarracks(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wallDark; ctx.fillRect(w * 0.06, h * 0.38, w * 0.88, h * 0.48);
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.14, h * 0.32, w * 0.7, h * 0.38);
      this._timber(ctx, w * 0.14, h * 0.32, w * 0.7, h * 0.38);
      this._roof(ctx, w * 0.08, h * 0.12, w * 0.82, h * 0.33, pal.roof, pal.roofDark);
      // palisade sides
      ctx.strokeStyle = '#5e4530'; ctx.lineWidth = Math.max(1, z * 0.04);
      for (let i = 0; i < 9; i++) {
        const px = w * (0.05 + i * 0.11);
        ctx.beginPath(); ctx.moveTo(px, h * 0.95); ctx.lineTo(px, h * 0.8); ctx.stroke();
      }
      ctx.fillStyle = '#4a3424'; ctx.fillRect(w * 0.43, h * 0.56, w * 0.14, h * 0.26);
      // shields
      for (let i = 0; i < 3; i++) {
        const sx = w * (0.24 + i * 0.2), sy = h * 0.56;
        ctx.fillStyle = faction ? faction.colors.primary : '#7a2e2e';
        ctx.beginPath(); ctx.arc(sx, sy, z * 0.055, 0, Math.PI); ctx.lineTo(sx, sy + z * 0.08); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = faction ? faction.colors.secondary : '#d8bb71'; ctx.lineWidth = 0.8; ctx.stroke();
      }
      // weapon rack
      ctx.strokeStyle = '#a78d63'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(w * 0.82 + i * 3, h * 0.62); ctx.lineTo(w * 0.86 + i * 3, h * 0.84); ctx.stroke(); }
      this._banner(ctx, w * 0.9, h * 0.13, z * 0.17, z * 0.3, faction);
    }
    _artArchery(ctx, b, w, h, z, pal, faction) {
      // practice field
      ctx.fillStyle = '#7f7f4e'; ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.65, w * 0.47, h * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      // shed
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.08, h * 0.18, w * 0.3, h * 0.25);
      this._roof(ctx, w * 0.05, h * 0.1, w * 0.36, h * 0.16, pal.roof, pal.roofDark);
      // targets
      for (let i = 0; i < 3; i++) {
        const tx = w * (0.5 + i * 0.17), ty = h * (0.48 + (i % 2) * 0.1);
        ctx.fillStyle = '#d3c294'; ctx.beginPath(); ctx.arc(tx, ty, z * 0.11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a94b42'; ctx.beginPath(); ctx.arc(tx, ty, z * 0.075, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e0d4b2'; ctx.beginPath(); ctx.arc(tx, ty, z * 0.038, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7d5c39'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx + z * 0.03, ty - z * 0.02); ctx.lineTo(tx + z * 0.12, ty - z * 0.06); ctx.stroke();
      }
      // hay bales
      ctx.fillStyle = '#b39b59'; for (let i = 0; i < 2; i++) { ctx.beginPath(); ctx.ellipse(w * (0.22 + i * 0.12), h * 0.8, z * 0.1, z * 0.06, 0, 0, Math.PI * 2); ctx.fill(); }
      this._banner(ctx, w * 0.86, h * 0.28, z * 0.15, z * 0.28, faction);
    }
    _artStable(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.06, h * 0.18, w * 0.52, h * 0.36);
      this._timber(ctx, w * 0.06, h * 0.18, w * 0.52, h * 0.36);
      this._roof(ctx, w * 0.03, h * 0.08, w * 0.58, h * 0.2, pal.roof, pal.roofDark);
      // horse paddock
      ctx.fillStyle = 'rgba(107,106,65,0.55)'; ctx.fillRect(w * 0.56, h * 0.45, w * 0.42, h * 0.4);
      ctx.strokeStyle = '#6d5438'; ctx.lineWidth = 1.2;
      for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(w * 0.56 + i * w * 0.105, h * 0.85); ctx.lineTo(w * 0.56 + i * w * 0.105, h * 0.5); ctx.stroke(); }
      for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(w * 0.56, h * 0.85 - i * h * 0.12); ctx.lineTo(w * 0.98, h * 0.85 - i * h * 0.12); ctx.stroke(); }
      // horse silhouettes
      for (let i = 0; i < 2; i++) {
        const hx = w * (0.68 + i * 0.16), hy = h * (0.66 + i * 0.06);
        ctx.fillStyle = i ? '#6b4c33' : '#84613e';
        ctx.beginPath(); ctx.ellipse(hx, hy, z * 0.1, z * 0.055, -0.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(hx + z * 0.09, hy - z * 0.05, z * 0.04, z * 0.06, 0.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(hx - z * 0.06, hy + z * 0.03, z * 0.02, z * 0.08); ctx.fillRect(hx + z * 0.04, hy + z * 0.03, z * 0.02, z * 0.08);
        ctx.beginPath(); ctx.moveTo(hx + z * 0.11, hy - z * 0.06); ctx.lineTo(hx + z * 0.15, hy - z * 0.12); ctx.strokeStyle = '#4a3322'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.fillStyle = '#4a3424'; ctx.fillRect(w * 0.18, h * 0.4, w * 0.1, h * 0.16);
    }
    _artTower(ctx, b, w, h, z, pal, faction) {
      const cx = w / 2, cy = h * 0.55;
      // base
      ctx.fillStyle = pal.wallDark; ctx.beginPath(); ctx.arc(cx, cy, w * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = b.level === 1 ? '#8b6a49' : pal.stone;
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = b.level === 1 ? '#6d5137' : pal.wall;
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.28, 0, Math.PI * 2); ctx.fill();
      // battlements / wooden top
      if (b.level === 1) {
        ctx.fillStyle = '#5f452c';
        for (let i = 0; i < 8; i++) {
          const ang = i / 8 * Math.PI * 2;
          ctx.fillRect(cx + Math.cos(ang) * w * 0.28 - 2, cy + Math.sin(ang) * w * 0.28 - 3, 4, 6);
        }
        this._roof(ctx, cx - w * 0.24, cy - h * 0.32, w * 0.48, h * 0.24, '#75593d', '#4f3b28');
      } else {
        ctx.fillStyle = pal.wallDark;
        for (let i = 0; i < 10; i++) {
          const ang = i / 10 * Math.PI * 2;
          ctx.fillRect(cx + Math.cos(ang) * w * 0.31 - 2.5, cy + Math.sin(ang) * w * 0.31 - 3, 5, 6);
        }
        ctx.fillStyle = pal.roofDark;
        ctx.beginPath(); ctx.arc(cx, cy, w * 0.21, 0, Math.PI * 2); ctx.fill();
        if (b.level >= 3) {
          ctx.strokeStyle = U.rgba(pal.trim, 0.7); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(cx, cy, w * 0.25, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = pal.trim;
          for (let i = 0; i < 6; i++) {
            const ang = i / 6 * Math.PI * 2;
            ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * w * 0.21, cy + Math.sin(ang) * w * 0.21, 1.2, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      // arrow slit
      ctx.fillStyle = '#1b1712';
      ctx.fillRect(cx - 1, cy - h * 0.12, 2, h * 0.2);
      this._banner(ctx, cx + w * 0.28, cy - h * 0.42, z * 0.15, z * 0.3, faction);
      // stones
      ctx.globalAlpha = 0.2; ctx.strokeStyle = '#d4c5a0';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, w * (0.12 + i * 0.05), i, i + 1.4); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    _artWall(ctx, b, w, h, z, pal, faction) {
      const n = this._adjacentBuilding(b.x, b.y - 1, ['wall', 'gate']);
      const s = this._adjacentBuilding(b.x, b.y + 1, ['wall', 'gate']);
      const e = this._adjacentBuilding(b.x + 1, b.y, ['wall', 'gate']);
      const wst = this._adjacentBuilding(b.x - 1, b.y, ['wall', 'gate']);
      const lvl = b.level;
      if (lvl === 1) {
        ctx.fillStyle = '#60442c';
        ctx.fillRect(w * 0.4, 0, w * 0.2, h);
        ctx.fillRect(0, h * 0.4, w, h * 0.2);
        ctx.strokeStyle = '#96714a'; ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          if (n || s) { ctx.beginPath(); ctx.moveTo(w * (0.3 + i * 0.13), 2); ctx.lineTo(w * (0.3 + i * 0.13), h * 0.38); ctx.stroke(); }
          if (e || wst) { ctx.beginPath(); ctx.moveTo(2, h * (0.3 + i * 0.13)); ctx.lineTo(w * 0.38, h * (0.3 + i * 0.13)); ctx.stroke(); }
        }
        ctx.strokeStyle = '#b18a57'; ctx.beginPath(); ctx.moveTo(w * 0.2, h * 0.5); ctx.lineTo(w * 0.8, h * 0.5); ctx.moveTo(w * 0.5, h * 0.2); ctx.lineTo(w * 0.5, h * 0.8); ctx.stroke();
      } else {
        const thick = 0.34 + (lvl >= 3 ? 0.12 : 0);
        const stone = lvl >= 4 ? '#6d6a64' : '#8e8878';
        ctx.fillStyle = '#555047';
        if (n || s) ctx.fillRect(w * (0.5 - thick / 2), 0, w * thick, h);
        if (e || wst) ctx.fillRect(0, h * (0.5 - thick / 2), w, h * thick);
        if (!n && !s && !e && !wst) { ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6); }
        ctx.fillStyle = stone;
        if (n || s) ctx.fillRect(w * (0.5 - thick / 2) + 1, 0, w * thick - 2, h);
        if (e || wst) ctx.fillRect(0, h * (0.5 - thick / 2) + 1, w, h * thick - 2);
        if (!n && !s && !e && !wst) { ctx.fillRect(w * 0.2 + 1, h * 0.2 + 1, w * 0.6 - 2, h * 0.6 - 2); }
        // battlements
        ctx.fillStyle = lvl >= 4 ? '#514d47' : '#6f695c';
        const bt = 0.1;
        if (n || s) { for (let i = 0; i < 3; i++) { ctx.fillRect(w * (0.5 - thick / 2 - 0.02), h * (i / 3), w * (thick + 0.04), h * bt); } }
        if (e || wst) { for (let i = 0; i < 3; i++) { ctx.fillRect(w * (i / 3), h * (0.5 - thick / 2 - 0.02), w * bt, h * (thick + 0.04)); } }
        ctx.strokeStyle = 'rgba(221,207,170,0.25)'; ctx.lineWidth = 0.6;
        for (let i = 0; i < 5; i++) {
          if (n || s) { ctx.beginPath(); ctx.moveTo(w * (0.5 - thick / 2), h * i / 5); ctx.lineTo(w * (0.5 + thick / 2), h * i / 5); ctx.stroke(); }
          if (e || wst) { ctx.beginPath(); ctx.moveTo(w * i / 5, h * (0.5 - thick / 2)); ctx.lineTo(w * i / 5, h * (0.5 + thick / 2)); ctx.stroke(); }
        }
        if (lvl >= 4) {
          ctx.strokeStyle = 'rgba(235,207,127,0.55)'; ctx.lineWidth = 1;
          if (n || s) { ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke(); }
          if (e || wst) { ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5); ctx.stroke(); }
        }
      }
    }
    _artGate(ctx, b, w, h, z, pal, faction) {
      const lvl = b.level;
      const horizontal = !!(this._adjacentBuilding(b.x - 1, b.y, ['wall', 'gate']) || this._adjacentBuilding(b.x + 1, b.y, ['wall', 'gate']));
      const stone = lvl >= 2;
      ctx.save();
      if (horizontal) {
        ctx.fillStyle = stone ? '#8b8578' : '#6f5134';
        ctx.fillRect(w * 0.1, h * 0.22, w * 0.8, h * 0.56);
        ctx.fillStyle = stone ? '#5f5a51' : '#4c3624';
        ctx.fillRect(w * 0.2, h * 0.3, w * 0.6, h * 0.4);
        if (!b.open) {
          ctx.fillStyle = stone ? '#6c6558' : '#7c5736';
          ctx.fillRect(w * 0.3, h * 0.34, w * 0.4, h * 0.32);
          ctx.strokeStyle = '#3d3023'; ctx.lineWidth = 1;
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(w * (0.33 + i * 0.09), h * 0.34); ctx.lineTo(w * (0.33 + i * 0.09), h * 0.66); ctx.stroke(); }
        } else {
          ctx.fillStyle = 'rgba(18,16,13,0.8)';
          ctx.fillRect(w * 0.3, h * 0.34, w * 0.4, h * 0.32);
        }
        ctx.fillStyle = stone ? '#a29a89' : '#80633f';
        ctx.fillRect(w * 0.08, h * 0.18, w * 0.14, h * 0.64);
        ctx.fillRect(w * 0.78, h * 0.18, w * 0.14, h * 0.64);
        if (lvl >= 3) {
          ctx.fillStyle = 'rgba(229,202,122,0.7)';
          for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(w * 0.3, h * (0.35 + i * 0.1), 1.4, 0, Math.PI * 2); ctx.fill(); }
        }
      } else {
        ctx.fillStyle = stone ? '#8b8578' : '#6f5134';
        ctx.fillRect(w * 0.22, h * 0.1, w * 0.56, h * 0.8);
        ctx.fillStyle = stone ? '#5f5a51' : '#4c3624';
        ctx.fillRect(w * 0.3, h * 0.2, w * 0.4, h * 0.6);
        if (!b.open) {
          ctx.fillStyle = stone ? '#6c6558' : '#7c5736';
          ctx.fillRect(w * 0.34, h * 0.3, w * 0.32, h * 0.4);
          ctx.strokeStyle = '#3d3023';
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(w * 0.34, h * (0.34 + i * 0.09)); ctx.lineTo(w * 0.66, h * (0.34 + i * 0.09)); ctx.stroke(); }
        } else {
          ctx.fillStyle = 'rgba(18,16,13,0.8)';
          ctx.fillRect(w * 0.34, h * 0.3, w * 0.32, h * 0.4);
        }
        ctx.fillStyle = stone ? '#a29a89' : '#80633f';
        ctx.fillRect(w * 0.18, h * 0.08, w * 0.64, h * 0.14);
        ctx.fillRect(w * 0.18, h * 0.78, w * 0.64, h * 0.14);
      }
      ctx.restore();
      this._banner(ctx, w * 0.42, -h * 0.15, z * 0.16, z * 0.33, faction);
    }
    _artKnightOrder(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.stone; ctx.fillRect(w * 0.06, h * 0.3, w * 0.88, h * 0.57);
      this._roof(ctx, w * 0.02, h * 0.16, w * 0.96, h * 0.25, pal.roof, pal.roofDark);
      ctx.fillStyle = pal.wallDark; ctx.fillRect(w * 0.38, h * 0.08, w * 0.24, h * 0.32);
      this._roof(ctx, w * 0.34, h * 0.02, w * 0.32, h * 0.16, pal.roof, pal.roofDark);
      // gate
      ctx.fillStyle = '#3f3021'; ctx.fillRect(w * 0.4, h * 0.62, w * 0.2, h * 0.26);
      // shields
      const acc = faction ? faction.colors : { primary: '#7a2e2e', secondary: '#d8bb71' };
      for (const sx of [0.25, 0.75]) {
        ctx.fillStyle = acc.primary;
        ctx.beginPath(); ctx.moveTo(w * sx - z * 0.09, h * 0.62); ctx.lineTo(w * sx + z * 0.09, h * 0.62); ctx.lineTo(w * sx + z * 0.09, h * 0.74); ctx.lineTo(w * sx, h * 0.83); ctx.lineTo(w * sx - z * 0.09, h * 0.74); ctx.closePath(); ctx.fill();
        this.drawCrestIcon(ctx, w * sx, h * 0.71, z * 0.12, faction, acc.secondary);
      }
      // statues
      ctx.fillStyle = '#8c8678';
      for (const sx of [0.12, 0.88]) { ctx.fillRect(w * sx - z * 0.04, h * 0.58, z * 0.08, h * 0.26); ctx.beginPath(); ctx.arc(w * sx, h * 0.56, z * 0.05, 0, Math.PI * 2); ctx.fill(); }
      this._banner(ctx, w * 0.46, h * 0.14, z * 0.24, z * 0.4, faction);
    }
    _artLibrary(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.08, h * 0.34, w * 0.84, h * 0.52);
      this._roof(ctx, w * 0.03, h * 0.16, w * 0.94, h * 0.28, pal.roof, pal.roofDark);
      ctx.fillStyle = pal.wallDark; ctx.fillRect(w * 0.36, h * 0.08, w * 0.28, h * 0.3);
      ctx.fillStyle = pal.roofDark; ctx.beginPath(); ctx.moveTo(w * 0.32, h * 0.1); ctx.lineTo(w * 0.5, h * -0.04); ctx.lineTo(w * 0.68, h * 0.1); ctx.fill();
      // arched windows
      for (let i = 0; i < 4; i++) {
        const wx = w * (0.17 + i * 0.21);
        ctx.fillStyle = '#d4bf87';
        ctx.beginPath(); ctx.arc(wx, h * 0.5, z * 0.04, Math.PI, 0); ctx.lineTo(wx + z * 0.04, h * 0.68); ctx.lineTo(wx - z * 0.04, h * 0.68); ctx.fill();
        ctx.fillStyle = '#5f5642';
        for (let j = 0; j < 4; j++) { ctx.fillRect(wx - z * 0.028 + (j % 2) * z * 0.032, h * 0.54 + Math.floor(j / 2) * z * 0.04, z * 0.018, z * 0.035); }
      }
      ctx.fillStyle = '#4a3826'; ctx.fillRect(w * 0.45, h * 0.7, w * 0.1, h * 0.16);
      // owl
      ctx.fillStyle = pal.trim; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.2, z * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#403a2c'; ctx.beginPath(); ctx.arc(w * 0.49, h * 0.195, 1.2, 0, Math.PI * 2); ctx.arc(w * 0.51, h * 0.195, 1.2, 0, Math.PI * 2); ctx.fill();
      this._banner(ctx, w * 0.9, h * 0.15, z * 0.14, z * 0.27, faction);
    }
    _artUniversity(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = pal.stone; ctx.fillRect(w * 0.04, h * 0.38, w * 0.92, h * 0.49);
      this._roof(ctx, w * 0.02, h * 0.24, w * 0.96, h * 0.2, pal.roof, pal.roofDark);
      ctx.fillStyle = pal.wall; ctx.fillRect(w * 0.12, h * 0.32, w * 0.76, h * 0.26);
      // central tower/dome
      ctx.fillStyle = pal.wallDark; ctx.fillRect(w * 0.4, h * 0.1, w * 0.2, h * 0.36);
      ctx.fillStyle = '#55605e';
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.12, w * 0.14, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = pal.trim; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.12, w * 0.14, Math.PI, 0); ctx.stroke();
      ctx.strokeStyle = pal.trim; ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.12); ctx.lineTo(w * 0.5, h * 0.0); ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const wx = w * (0.14 + i * 0.18);
        ctx.fillStyle = '#deca95'; ctx.fillRect(wx, h * 0.48, z * 0.05, h * 0.13);
      }
      this._windows(ctx, w * 0.2, h * 0.38, w * 0.6, h * 0.1, 3, '#cfb67f');
      this._banner(ctx, w * 0.89, h * 0.2, z * 0.15, z * 0.28, faction);
    }
    _artRoyalUniversity(ctx, b, w, h, z, pal, faction) {
      ctx.fillStyle = '#898378'; ctx.fillRect(w * 0.02, h * 0.38, w * 0.96, h * 0.5);
      this._roof(ctx, w * 0.01, h * 0.28, w * 0.98, h * 0.16, '#3d4146', '#25282b');
      ctx.fillStyle = '#827c71'; ctx.fillRect(w * 0.06, h * 0.3, w * 0.88, h * 0.26);
      // grand golden dome
      ctx.fillStyle = '#c4a24e';
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.2, w * 0.2, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#e2c56c'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.2, w * 0.17, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#8b6b28'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.2, w * 0.13, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#efd88c'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.05, z * 0.06, 0, Math.PI * 2); ctx.fill();
      // side towers
      for (const cx of [0.16, 0.84]) {
        ctx.fillStyle = pal.wallDark; ctx.fillRect(w * cx - w * 0.06, h * 0.28, w * 0.12, h * 0.45);
        ctx.fillStyle = pal.roofDark; ctx.beginPath(); ctx.moveTo(w * cx - w * 0.09, h * 0.3); ctx.lineTo(w * cx, h * 0.08); ctx.lineTo(w * cx + w * 0.09, h * 0.3); ctx.fill();
        this._banner(ctx, w * cx - z * 0.07, h * 0.1, z * 0.14, z * 0.3, faction);
      }
      for (let i = 0; i < 5; i++) {
        const wx = w * (0.3 + i * 0.1);
        ctx.fillStyle = '#d9c17f';
        ctx.beginPath(); ctx.arc(wx, h * 0.51, z * 0.032, Math.PI, 0); ctx.lineTo(wx + z * 0.032, h * 0.64); ctx.lineTo(wx - z * 0.032, h * 0.64); ctx.fill();
      }
      // gold trim
      ctx.strokeStyle = 'rgba(232,206,132,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(w * 0.06, h * 0.78); ctx.lineTo(w * 0.94, h * 0.78); ctx.stroke();
      this._banner(ctx, w * 0.47, h * 0.12, z * 0.2, z * 0.35, faction);
    }

    // =========================================================
    // Units & ships
    // =========================================================
    drawUnit(u) {
      const z = TILE * this.camera.zoom;
      const p = this.worldToScreen(u.x, u.y);
      if (p.x < -z || p.y < -z || p.x > this.vw + z || p.y > this.vh + z) return;
      const ctx = this.ctx;
      const faction = this.game.getFaction(u.owner);
      const color = faction ? faction.colors.primary : '#6e5c43';
      const accent = faction ? faction.colors.secondary : '#d2bb7d';
      const isSelected = this.selection.unitIds.includes(u.id);
      const isHover = this.hover && this.hover.kind === 'unit' && this.hover.id === u.id;
      const t = z;
      const s = Math.max(0.7, this.camera.zoom) * (u.isShip ? 1.3 : 1);
      const bob = (u.state === 'moving') ? Math.sin(this.anim * 11 + (u.id.charCodeAt(1) || 0)) * 1.0 * this.camera.zoom : 0;
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      // shadow / wake
      if (u.isShip) {
        ctx.fillStyle = 'rgba(194,222,215,0.18)';
        ctx.beginPath(); ctx.ellipse(0, t * 0.35, t * 0.55, t * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(15,15,11,0.3)';
        ctx.beginPath(); ctx.ellipse(2, t * 0.25, t * 0.2, t * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      }
      if (isSelected || isHover) {
        ctx.strokeStyle = isSelected ? '#f2d88d' : 'rgba(239,219,166,0.6)';
        ctx.fillStyle = isSelected ? 'rgba(238,207,113,0.12)' : 'rgba(238,207,113,0.05)';
        ctx.lineWidth = isSelected ? 1.8 : 1;
        ctx.beginPath(); ctx.ellipse(0, t * 0.12, t * 0.3, t * 0.18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (isSelected) {
          ctx.strokeStyle = 'rgba(242,216,141,0.4)'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(0, t * 0.05, t * 0.34, 0, Math.PI * 2); ctx.stroke();
        }
      }
      if (u.isShip) this._drawShipArt(ctx, u, t, s, color, accent);
      else if (u.def.military) this._drawSoldierArt(ctx, u, t, s, color, accent);
      else this._drawCivilianArt(ctx, u, t, s, color, accent);
      // cargo marker
      if (!u.isShip && u.hasCargo) {
        const cc = u.carry && Object.keys(u.carry).length ? Object.keys(u.carry)[0] : (u.cargo && Object.keys(u.cargo).length ? Object.keys(u.cargo)[0] : 'food');
        if (cc && D.RES[cc]) {
          ctx.fillStyle = U.rgba(D.RES[cc].color, 0.95);
          ctx.beginPath(); ctx.arc(t * 0.26, -t * 0.52, t * 0.075, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#2c2318'; ctx.lineWidth = 0.6; ctx.stroke();
        }
      }
      // health / state bars
      const showHp = isSelected || isHover || u.hp < u.maxHp - 0.1;
      if (showHp && !u.isShip) {
        const bw = Math.max(15, t * 0.44), bh = Math.max(2.2, t * 0.055);
        this._bar(ctx, -bw / 2, -t * 0.66, bw, bh, u.hp / u.maxHp, 'rgba(17,14,10,0.82)', u.hp / u.maxHp > 0.55 ? '#83a05e' : u.hp / u.maxHp > 0.3 ? '#c0a050' : '#a44a3e');
      }
      if (u.def.military && isSelected) {
        ctx.fillStyle = '#e5d5a8';
        ctx.font = `${Math.max(6, 7.5 * this.camera.zoom)}px "KaiTi", Georgia, serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(u.def.name, 0, -t * 0.72);
      }
      if (u.state === 'constructing') this._animHammer(ctx, t * 0.28, -t * 0.15, this.anim * 7 + (u.id.charCodeAt(2) || 0));
      if (u.state === 'gathering') this._animTool(ctx, t, 'sickle');
      if (u.state === 'clearing') this._animHammer(ctx, t * 0.3, -t * 0.15, this.anim * 6);
      if (u.state === 'repairing') this._animHammer(ctx, t * 0.3, -t * 0.15, this.anim * 7);
      ctx.restore();
    }

    _drawCivilianArt(ctx, u, t, s, color, accent) {
      const bob = u.state === 'moving' ? Math.sin(this.anim * 12 + 1) * 0.7 : 0;
      ctx.save();
      ctx.translate(0, bob);
      const builder = u.kind === 'builder';
      const merchant = u.kind === 'merchant';
      // legs
      ctx.strokeStyle = '#4a3a29'; ctx.lineWidth = Math.max(1, t * 0.055);
      ctx.beginPath(); ctx.moveTo(-t * 0.07, 0); ctx.lineTo(-t * 0.09, t * 0.16); ctx.moveTo(t * 0.07, 0); ctx.lineTo(t * 0.1, t * 0.16); ctx.stroke();
      // tunic
      ctx.fillStyle = builder ? '#8b633d' : merchant ? '#6c5a6f' : '#71533c';
      ctx.beginPath(); ctx.moveTo(-t * 0.13, -t * 0.27); ctx.lineTo(t * 0.13, -t * 0.27); ctx.lineTo(t * 0.17, t * 0.03); ctx.lineTo(-t * 0.17, t * 0.03); ctx.closePath(); ctx.fill();
      if (merchant) {
        ctx.fillStyle = accent;
        ctx.fillRect(-t * 0.14, -t * 0.2, t * 0.28, t * 0.035);
      }
      // head + hood
      ctx.fillStyle = '#d8b390'; ctx.beginPath(); ctx.arc(0, -t * 0.36, t * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = builder ? '#a5794c' : merchant ? '#6f5577' : color;
      ctx.beginPath(); ctx.arc(0, -t * 0.39, t * 0.125, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      // arms
      ctx.strokeStyle = '#d8b390'; ctx.lineWidth = Math.max(1, t * 0.045);
      ctx.beginPath(); ctx.moveTo(-t * 0.12, -t * 0.19); ctx.lineTo(-t * 0.2, t * 0.01); ctx.moveTo(t * 0.12, -t * 0.19); ctx.lineTo(t * 0.2, t * 0.01); ctx.stroke();
      if (builder) {
        ctx.strokeStyle = '#4b3826'; ctx.lineWidth = Math.max(1, t * 0.045);
        ctx.beginPath(); ctx.moveTo(t * 0.2, 0); ctx.lineTo(t * 0.32, -t * 0.18); ctx.stroke();
        ctx.fillStyle = '#a9a08d'; ctx.fillRect(t * 0.26, -t * 0.28, t * 0.12, t * 0.08);
      }
      if (merchant) {
        // small pack mule / cart
        ctx.fillStyle = '#7e6243';
        ctx.beginPath(); ctx.ellipse(-t * 0.38, t * 0.02, t * 0.16, t * 0.1, 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-t * 0.5, -t * 0.09, t * 0.06, t * 0.08, 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#58412a'; ctx.fillRect(-t * 0.48, t * 0.06, t * 0.03, t * 0.12); ctx.fillRect(-t * 0.32, t * 0.06, t * 0.03, t * 0.12);
        ctx.fillStyle = '#a58d65'; ctx.fillRect(-t * 0.44, -t * 0.08, t * 0.12, t * 0.1);
      }
      // faction shoulder
      ctx.fillStyle = accent; ctx.globalAlpha = 0.7;
      ctx.fillRect(-t * 0.12, -t * 0.23, t * 0.06, t * 0.03);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    _drawSoldierArt(ctx, u, t, s, color, accent) {
      const cavalry = u.def.cavalry;
      const ranged = u.def.ranged;
      const bob = u.state === 'moving' ? Math.sin(this.anim * 14) * 0.7 : 0;
      ctx.save();
      ctx.translate(0, bob);
      if (cavalry) {
        const horseColor = u.kind === 'paladin' ? '#d9d1bc' : u.kind === 'heavyCavalry' ? '#3d3834' : '#785a3f';
        ctx.fillStyle = horseColor;
        ctx.beginPath(); ctx.ellipse(-t * 0.02, t * 0.04, t * 0.3, t * 0.14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-t * 0.28, -t * 0.03, t * 0.11, t * 0.09, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = horseColor; ctx.lineWidth = Math.max(1, t * 0.045);
        const legPhase = u.state === 'moving' ? Math.sin(this.anim * 13) * t * 0.06 : 0;
        ctx.beginPath(); ctx.moveTo(t * 0.15, t * 0.1); ctx.lineTo(t * 0.19 + legPhase, t * 0.26); ctx.moveTo(-t * 0.12, t * 0.1); ctx.lineTo(-t * 0.16 - legPhase, t * 0.26); ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(-t * 0.08, -t * 0.26); ctx.lineTo(t * 0.16, -t * 0.26); ctx.lineTo(t * 0.2, t * 0.02); ctx.lineTo(-t * 0.12, t * 0.02); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#d8b390'; ctx.beginPath(); ctx.arc(t * 0.07, -t * 0.36, t * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = u.kind === 'paladin' ? '#e2c56e' : '#7d858a';
        ctx.beginPath(); ctx.arc(t * 0.07, -t * 0.4, t * 0.11, Math.PI, 0); ctx.fill();
        // lance
        ctx.strokeStyle = u.kind === 'heavyCavalry' || u.kind === 'paladin' ? '#d9c79c' : '#a3895d'; ctx.lineWidth = Math.max(1, t * 0.04);
        ctx.beginPath(); ctx.moveTo(t * 0.25, -t * 0.48); ctx.lineTo(t * 0.42, t * 0.12); ctx.stroke();
        if (u.kind === 'paladin') {
          ctx.strokeStyle = 'rgba(241,214,131,0.32)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, t * 0.34, 0, Math.PI * 2); ctx.stroke();
        }
        // shield
        ctx.fillStyle = color; ctx.strokeStyle = accent; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-t * 0.22, -t * 0.2); ctx.lineTo(-t * 0.02, -t * 0.18); ctx.lineTo(-t * 0.04, t * 0.02); ctx.lineTo(-t * 0.14, t * 0.1); ctx.lineTo(-t * 0.25, t * 0.0); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        // infantry legs
        ctx.strokeStyle = '#3e3427'; ctx.lineWidth = Math.max(1, t * 0.055);
        const step = u.state === 'moving' ? Math.sin(this.anim * 13) * t * 0.05 : 0;
        ctx.beginPath(); ctx.moveTo(-t * 0.05, t * 0.03); ctx.lineTo(-t * 0.08 - step, t * 0.2); ctx.moveTo(t * 0.05, t * 0.03); ctx.lineTo(t * 0.08 + step, t * 0.2); ctx.stroke();
        // body armor
        ctx.fillStyle = u.def.cls === 'soldier' ? U.mixColor(color, '#4b4b48', 0.36) : color;
        ctx.beginPath(); ctx.moveTo(-t * 0.13, -t * 0.24); ctx.lineTo(t * 0.13, -t * 0.24); ctx.lineTo(t * 0.16, t * 0.04); ctx.lineTo(-t * 0.16, t * 0.04); ctx.closePath(); ctx.fill();
        // pauldron
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(-t * 0.14, -t * 0.2, t * 0.06, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(t * 0.14, -t * 0.2, t * 0.06, 0, Math.PI * 2); ctx.fill();
        // head/helm
        ctx.fillStyle = '#d8b390'; ctx.beginPath(); ctx.arc(0, -t * 0.34, t * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = ranged ? '#58654b' : '#8a8c88';
        ctx.beginPath(); ctx.arc(0, -t * 0.37, t * 0.11, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#4a4a45'; ctx.fillRect(-t * 0.025, -t * 0.4, t * 0.05, t * 0.08);
        if (ranged) {
          // bow
          ctx.strokeStyle = '#9b7b4e'; ctx.lineWidth = Math.max(1, t * 0.035);
          ctx.beginPath(); ctx.arc(t * 0.23, -t * 0.12, t * 0.22, -Math.PI * 0.55, Math.PI * 0.55); ctx.stroke();
          ctx.strokeStyle = 'rgba(230,220,190,0.7)'; ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(t * 0.23 + Math.cos(-Math.PI * 0.55) * t * 0.22, -t * 0.12 + Math.sin(-Math.PI * 0.55) * t * 0.22); ctx.lineTo(t * 0.23 + Math.cos(Math.PI * 0.55) * t * 0.22, -t * 0.12 + Math.sin(Math.PI * 0.55) * t * 0.22); ctx.stroke();
          ctx.strokeStyle = '#d2b47c'; ctx.beginPath(); ctx.moveTo(t * 0.24, -t * 0.22); ctx.lineTo(t * 0.24, t * 0.02); ctx.stroke();
        } else {
          // shield
          ctx.fillStyle = color; ctx.strokeStyle = accent; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(-t * 0.18, -t * 0.1, t * 0.13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(-t * 0.18, -t * 0.1, t * 0.04, 0, Math.PI * 2); ctx.fill();
          // spear/sword
          ctx.strokeStyle = '#b49b6e'; ctx.lineWidth = Math.max(1, t * 0.035);
          ctx.beginPath(); ctx.moveTo(t * 0.16, -t * 0.3); ctx.lineTo(t * 0.2, t * 0.24); ctx.stroke();
          ctx.fillStyle = '#c7c3b6'; ctx.beginPath(); ctx.moveTo(t * 0.2, -t * 0.38); ctx.lineTo(t * 0.23, -t * 0.25); ctx.lineTo(t * 0.17, -t * 0.25); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
    }

    _drawShipArt(ctx, u, t, s, color, accent) {
      const angle = u.facing || 0;
      ctx.save();
      ctx.rotate(angle + Math.PI / 2);
      const L = t * 0.7, W = t * 0.28;
      // hull
      ctx.fillStyle = '#62452c';
      ctx.beginPath();
      ctx.moveTo(0, -L * 0.6); ctx.quadraticCurveTo(W, -L * 0.2, W * 0.8, L * 0.45); ctx.lineTo(-W * 0.8, L * 0.45); ctx.quadraticCurveTo(-W, -L * 0.2, 0, -L * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a6541';
      ctx.beginPath(); ctx.moveTo(0, -L * 0.52); ctx.quadraticCurveTo(W * 0.7, -L * 0.1, W * 0.55, L * 0.34); ctx.lineTo(-W * 0.55, L * 0.34); ctx.quadraticCurveTo(-W * 0.7, -L * 0.1, 0, -L * 0.52); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#b19262'; ctx.lineWidth = 0.8;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-W * 0.5, -L * 0.2 + i * L * 0.14); ctx.lineTo(W * 0.5, -L * 0.2 + i * L * 0.14); ctx.stroke(); }
      // mast and sail
      ctx.strokeStyle = '#5d432a'; ctx.lineWidth = Math.max(1, t * 0.035);
      ctx.beginPath(); ctx.moveTo(0, -L * 0.2); ctx.lineTo(0, L * 0.2); ctx.stroke();
      ctx.fillStyle = u.kind === 'ship_carrack' ? color : U.mixColor(color, '#efe2c3', 0.15);
      ctx.beginPath(); ctx.moveTo(0, -L * 0.1); ctx.quadraticCurveTo(L * 0.28, 0, 0, L * 0.18); ctx.quadraticCurveTo(L * 0.2, L * 0.03, 0, -L * 0.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.moveTo(0, -L * 0.02); ctx.lineTo(L * 0.16, L * 0.05); ctx.lineTo(0, L * 0.11); ctx.closePath(); ctx.fill();
      // passengers indicator
      if (u.passengers && u.passengers.length) {
        ctx.fillStyle = 'rgba(22,17,11,0.75)';
        ctx.beginPath(); ctx.arc(0, L * 0.26, t * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f0dca5'; ctx.font = `bold ${Math.max(6, t * 0.1)}px Georgia`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(u.passengers.length, 0, L * 0.27);
      }
      ctx.restore();
      // health bar
      if (this.selection.unitIds.includes(u.id) || u.hp < u.maxHp) {
        const bw = Math.max(18, t * 0.5);
        this._bar(ctx, -bw / 2, -t * 0.5, bw, 3, u.hp / u.maxHp, 'rgba(17,14,10,0.8)', '#799456');
      }
    }

    _animHammer(ctx, x, y, phase) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(phase) * 0.5 - 0.4);
      ctx.strokeStyle = '#5d432b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -7); ctx.stroke();
      ctx.fillStyle = '#b7b1a0'; ctx.fillRect(-3, -9, 6, 3);
      ctx.restore();
    }
    _animTool(ctx, t, tool) {
      ctx.save();
      ctx.rotate(Math.sin(this.anim * 5) * 0.3 - 0.2);
      ctx.strokeStyle = '#7b5b3b'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(t * 0.19, 0); ctx.lineTo(t * 0.19, -t * 0.18); ctx.stroke();
      ctx.strokeStyle = '#b8b3a1'; ctx.beginPath(); ctx.arc(t * 0.19, -t * 0.2, 3, 0, Math.PI); ctx.stroke();
      ctx.restore();
    }

    // =========================================================
    // Projectiles / effects / overlays / clock
    // =========================================================
    drawProjectiles() {
      if (!this.projectiles && !this.game.projectiles) return;
      const list = this.game.projectiles || [];
      const ctx = this.ctx;
      const z = TILE * this.camera.zoom;
      for (const p of list) {
        const a = this.worldToScreen(p.x1, p.y1);
        const b = this.worldToScreen(p.x2, p.y2);
        const t = 1 - U.clamp(p.life / (p.maxLife || 0.3), 0, 1);
        const x = U.lerp(a.x, b.x, t), y = U.lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * Math.min(36, z * 0.9);
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = p.type === 'tower' ? '#eadb94' : '#dfcfa4';
        ctx.lineWidth = p.type === 'tower' ? 1.7 : 1.1;
        const backX = U.lerp(a.x, b.x, Math.max(0, t - 0.09)), backY = U.lerp(a.y, b.y, Math.max(0, t - 0.09)) - Math.sin(Math.max(0, t - 0.09) * Math.PI) * Math.min(36, z * 0.9);
        ctx.beginPath(); ctx.moveTo(backX, backY); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = '#f4e7b8';
        ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    drawEffects() {
      const ctx = this.ctx;
      for (const e of this.game.effects || []) {
        const p = this.worldToScreen(e.x, e.y);
        const t = U.clamp(e.life / (e.maxLife || 1), 0, 1);
        ctx.save();
        ctx.globalAlpha = t;
        if (e.type === 'hit' || e.type === 'clash') {
          ctx.fillStyle = e.color || '#e8c88c';
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + (1 - t) * 2;
            ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * (1 - t) * 10, p.y + Math.sin(a) * (1 - t) * 7, 1.5, 0, Math.PI * 2); ctx.fill();
          }
        } else if (e.type === 'death') {
          ctx.fillStyle = 'rgba(116,68,56,0.55)';
          ctx.beginPath(); ctx.ellipse(p.x, p.y + 5, 9 * (1 - t) + 3, 4 * (1 - t) + 1, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#3d2b24';
          ctx.beginPath(); ctx.ellipse(p.x, p.y + (1 - t) * 6, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
        } else if (e.type === 'debris' || e.type === 'ruin') {
          ctx.fillStyle = e.type === 'ruin' ? 'rgba(65,58,47,0.55)' : 'rgba(154,140,110,0.6)';
          for (let i = 0; i < 6; i++) {
            const a = hash(i, 7, 0) * Math.PI * 2;
            const r = (1 - t) * (e.type === 'ruin' ? 24 : 15);
            ctx.fillRect(p.x + Math.cos(a) * r - 1, p.y + Math.sin(a) * r * 0.6 - 2, 2, 2);
          }
        } else if (e.type === 'flag') {
          const f = this.game.getFaction(this.game.getSettlement(this.selection.settlementId)?.owner);
          ctx.strokeStyle = '#dfca92'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 22 * (1 - t) - 4); ctx.stroke();
          if (e.color) {
            ctx.fillStyle = e.color;
            ctx.beginPath(); ctx.moveTo(p.x, p.y - 24); ctx.lineTo(p.x + 16, p.y - 20); ctx.lineTo(p.x, p.y - 14); ctx.closePath(); ctx.fill();
          }
        } else if (e.type === 'spark') {
          ctx.fillStyle = e.color || '#f2d783';
          for (let i = 0; i < 5; i++) {
            const a = hash(i, 3, 0) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * (1 - t) * 16, p.y + Math.sin(a) * (1 - t) * 10, 1, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    drawPlacementOverlay() {
      const pl = this.placement;
      if (!pl) return;
      const ctx = this.ctx;
      const z = TILE * this.camera.zoom;
      ctx.save();
      if (pl.mode === 'found') {
        const p = this.worldToScreen(pl.x - 1, pl.y - 1);
        ctx.fillStyle = pl.valid ? 'rgba(123,167,94,0.3)' : 'rgba(169,72,58,0.3)';
        ctx.fillRect(p.x, p.y, 3 * z, 3 * z);
        ctx.strokeStyle = pl.valid ? '#d6c687' : '#ba6c5a'; ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, 3 * z, 3 * z);
        this._drawGhostBuilding('hall', p.x, p.y, 3, 2, z, pl.valid);
        ctx.fillStyle = 'rgba(19,16,12,0.78)';
        ctx.fillRect(p.x - 2, p.y - 20, 124, 16);
        ctx.fillStyle = pl.valid ? '#e7d9a6' : '#e3a08e';
        ctx.font = '10px "SimSun", Georgia, serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillText(pl.valid ? '建立新定居点' : pl.error || '此处不可建立', p.x + 2, p.y - 12);
      } else if (pl.tiles && pl.tiles.length) {
        for (const t of pl.tiles) {
          const p = this.worldToScreen(t.x, t.y);
          ctx.fillStyle = t.valid ? 'rgba(118,159,91,0.28)' : 'rgba(174,81,62,0.28)';
          ctx.fillRect(p.x, p.y, z, z);
          ctx.strokeStyle = t.valid ? 'rgba(218,201,141,0.85)' : 'rgba(213,120,94,0.9)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(p.x + 1, p.y + 1, z - 2, z - 2);
        }
        const first = pl.tiles[0];
        if (first) {
          const p = this.worldToScreen(first.x, first.y);
          ctx.fillStyle = 'rgba(20,16,11,0.8)'; ctx.fillRect(p.x, p.y - 19, 94, 16);
          ctx.fillStyle = '#efe0b2'; ctx.font = '10px "SimSun", Georgia, serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(`${pl.defName || ''} · ${pl.tiles.length} 格`, p.x + 3, p.y - 11);
        }
      } else {
        const x = pl.x, y = pl.y;
        const def = D.BUILD[pl.defId];
        const foot = def ? def.foot : [1, 1];
        const p = this.worldToScreen(x, y);
        ctx.fillStyle = pl.valid ? 'rgba(123,167,94,0.26)' : 'rgba(174,78,62,0.26)';
        ctx.fillRect(p.x, p.y, foot[0] * z, foot[1] * z);
        ctx.strokeStyle = pl.valid ? '#d8c88d' : '#d07a63'; ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x, p.y, foot[0] * z, foot[1] * z);
        if (pl.valid) {
          ctx.globalAlpha = 0.55;
          this._drawGhostBuilding(pl.defId, p.x, p.y, foot[0], foot[1], z, true);
          ctx.globalAlpha = 1;
        }
        if (this.game.world.nodeAt(x, y) && pl.showRequirement) {
          ctx.strokeStyle = '#d4bd7d'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x + z / 2, p.y + z / 2, z * 3, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }

    _drawGhostBuilding(defId, sx, sy, fw, fh, z, valid) {
      const b = { defId, def: D.BUILD[defId], level: 1, x: 0, y: 0, owner: this.game.playerFactionId, complete: true, hp: 1, maxHp: 1, buildProgress: 0, buildRequired: 0 };
      const faction = this.game.player;
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.globalAlpha = 0.5;
      const pal = LEVEL_PALETTE[1];
      this._drawBuildingBody(ctx, b, fw * z, fh * z, z, pal, faction);
      ctx.restore();
    }

    drawHoverAndSelection() {
      if (this.hover && this.hover.kind === 'tile') {
        const p = this.worldToScreen(this.hover.x, this.hover.y);
        const z = TILE * this.camera.zoom;
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(231,210,158,0.45)'; this.ctx.lineWidth = 1;
        this.ctx.strokeRect(p.x + 0.5, p.y + 0.5, z - 1, z - 1);
        this.ctx.restore();
      }
      if (this.selectionRect) {
        const r = this.selectionRect;
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(222,199,139,0.08)';
        this.ctx.strokeStyle = 'rgba(235,216,168,0.8)'; this.ctx.lineWidth = 1;
        this.ctx.setLineDash([4, 3]);
        this.ctx.fillRect(r.x, r.y, r.w, r.h); this.ctx.strokeRect(r.x, r.y, r.w, r.h);
        this.ctx.restore();
      }
    }

    drawWeather(season) {
      const ctx = this.ctx;
      const count = season === 'winter' ? 55 : season === 'autumn' ? 34 : 18;
      const time = this.anim;
      ctx.save();
      for (let i = 0; i < count; i++) {
        const seed = hash(i, 17, 3);
        const xBase = (seed * this.vw + time * (season === 'winter' ? 8 : 14) * (0.4 + seed)) % (this.vw + 60) - 30;
        const yBase = (hash(i, 18, 8) * this.vh + time * (season === 'winter' ? 26 : 11)) % (this.vh + 40) - 20;
        const x = xBase + Math.sin(time * 0.6 + i) * (season === 'winter' ? 18 : 26);
        if (season === 'winter') {
          ctx.fillStyle = 'rgba(234,241,235,' + (0.18 + seed * 0.4) + ')';
          ctx.beginPath(); ctx.arc(x, yBase, 0.8 + seed * 1.6, 0, Math.PI * 2); ctx.fill();
        } else if (season === 'autumn') {
          ctx.fillStyle = `rgba(${148 + Math.floor(seed * 52)},${89 + Math.floor(seed * 25)},47,${0.18 + seed * 0.25})`;
          ctx.save(); ctx.translate(x, yBase); ctx.rotate(time + i); ctx.fillRect(-2, -1, 4, 2); ctx.restore();
        } else {
          ctx.fillStyle = season === 'spring' ? 'rgba(238,218,174,0.22)' : 'rgba(255,243,193,0.1)';
          ctx.beginPath(); ctx.arc(x, yBase, 0.7 + seed, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }

    drawVignette(season) {
      const ctx = this.ctx;
      const cx = this.vw / 2, cy = this.vh / 2;
      const grad = ctx.createRadialGradient(cx, cy, Math.min(this.vw, this.vh) * 0.28, cx, cy, Math.max(this.vw, this.vh) * 0.74);
      grad.addColorStop(0, 'rgba(12,14,10,0)');
      grad.addColorStop(0.75, 'rgba(14,14,10,0.09)');
      grad.addColorStop(1, 'rgba(9,10,8,0.48)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, this.vw, this.vh);
      // seasonal wash
      const tint = season === 'winter' ? 'rgba(170,205,218,0.045)' : season === 'autumn' ? 'rgba(189,127,55,0.045)' : season === 'spring' ? 'rgba(231,218,159,0.025)' : 'rgba(250,224,150,0.025)';
      ctx.fillStyle = tint; ctx.fillRect(0, 0, this.vw, this.vh);
      // subtle top/bottom framing
      const top = ctx.createLinearGradient(0, 0, 0, 120);
      top.addColorStop(0, 'rgba(14,14,10,0.35)'); top.addColorStop(1, 'rgba(14,14,10,0)');
      ctx.fillStyle = top; ctx.fillRect(0, 0, this.vw, 120);
    }

    // =========================================================
    // Minimap
    // =========================================================
    drawMinimap(now) {
      const canvas = this.minimapCanvas;
      if (!canvas || !this.game) return;
      if (now - this.minimapLast < 100) return;
      this.minimapLast = now;
      const game = this.game, world = game.world;
      if (!this.minimapBase) {
        const base = document.createElement('canvas');
        base.width = world.w; base.height = world.h;
        const bc = base.getContext('2d');
        const img = bc.createImageData(world.w, world.h);
        for (let y = 0; y < world.h; y++) {
          for (let x = 0; x < world.w; x++) {
            const t = world.terrain[y * world.w + x];
            const c = U.hexToRgb(D.TERRAIN[t].color);
            const shade = (world.elev[y * world.w + x] - 0.5) * 24;
            const idx = (y * world.w + x) * 4;
            img.data[idx] = U.clamp(c.r + shade, 0, 255);
            img.data[idx + 1] = U.clamp(c.g + shade, 0, 255);
            img.data[idx + 2] = U.clamp(c.b + shade, 0, 255);
            img.data[idx + 3] = 255;
          }
        }
        bc.putImageData(img, 0, 0);
        this.minimapBase = base;
        canvas.width = world.w; canvas.height = world.h;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(this.minimapBase, 0, 0);
      // territory stamps
      for (const s of game.settlements) {
        if (s.ruined) continue;
        const f = game.getFaction(s.owner);
        if (!f) continue;
        const hall = game.primaryHall(s);
        const radius = hall && hall.complete ? (hall.def.radius[hall.level] || 9) : 9;
        ctx.fillStyle = U.rgba(f.colors.primary, 0.12);
        ctx.beginPath(); ctx.arc(s.x, s.y, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = f.colors.primary;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
        ctx.strokeStyle = f.colors.secondary; ctx.lineWidth = 0.8;
        ctx.strokeRect(s.x - 2.5, s.y - 2.5, 5, 5);
      }
      // units as tiny marks
      for (const u of game.units) {
        if (u.dead || u.isShip) continue;
        if (u.def.military) {
          ctx.fillStyle = U.rgba(u.owner === game.playerFactionId ? '#f1dc9f' : '#c88a70', 0.75);
          ctx.fillRect(Math.floor(u.x), Math.floor(u.y), 1.4, 1.4);
        }
      }
      const z = TILE * this.camera.zoom;
      const halfW = this.vw / (2 * z), halfH = this.vh / (2 * z);
      ctx.strokeStyle = 'rgba(243,226,174,0.9)'; ctx.lineWidth = 1;
      ctx.strokeRect(this.camera.x - halfW, this.camera.y - halfH, halfW * 2, halfH * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(this.camera.x - halfW, this.camera.y - halfH, halfW * 2, halfH * 2);
    }

    minimapToWorld(clientX, clientY) {
      if (!this.minimapCanvas) return null;
      const r = this.minimapCanvas.getBoundingClientRect();
      const x = (clientX - r.left) / r.width * this.game.world.w;
      const y = (clientY - r.top) / r.height * this.game.world.h;
      return { x, y };
    }

    // =========================================================
    // UI icon art
    // =========================================================
    drawBuildingIcon(canvas, defId, level, faction) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const def = D.BUILD[defId];
      if (!def) return;
      const pal = LEVEL_PALETTE[U.clamp(level || 1, 1, 4)] || LEVEL_PALETTE[1];
      const accent = faction ? faction.colors.primary : '#7a2e2e';
      const accent2 = faction ? faction.colors.secondary : '#cbb679';
      const s = W / 148;
      const cy = H * 0.84;
      ctx.save();
      // faint antique plate and halo
      const halo = ctx.createRadialGradient(W / 2, H * 0.43, 2, W / 2, H * 0.43, W * 0.52);
      halo.addColorStop(0, 'rgba(238,220,173,0.17)');
      halo.addColorStop(1, 'rgba(238,220,173,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);
      ctx.translate(W / 2, cy);
      ctx.scale(s, s);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.fillStyle = 'rgba(18,15,10,0.24)';
      ctx.beginPath(); ctx.ellipse(0, 4, 48, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(155,136,96,0.14)';
      ctx.beginPath(); ctx.ellipse(0, 1, 44, 7, 0, 0, Math.PI * 2); ctx.fill();
      const stone = level >= 3 ? '#9c9588' : '#8c7d64';
      const darkStone = level >= 3 ? '#615d54' : '#62543f';
      const outline = 'rgba(47,37,25,0.78)';
      ctx.strokeStyle = outline; ctx.lineWidth = 1.2;
      const wall = (x, y, w, h, color) => { ctx.fillStyle = color || pal.wall; ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h); };
      const gable = (x, y, w, h, light, dark, trim) => {
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - 4, y + h - 3); ctx.lineTo(x + 4, y + h - 3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = light;
        ctx.beginPath(); ctx.moveTo(x - 2, y + h); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w + 2, y + h); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = trim || 'rgba(60,43,28,0.35)'; ctx.lineWidth = 0.8;
        for (let i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 4, y + h - i * h / 3); ctx.lineTo(x + w - 4, y + h - i * h / 3); ctx.stroke(); }
        ctx.strokeStyle = outline; ctx.lineWidth = 1.2;
      };
      const door = (x, y, w, h) => { ctx.fillStyle = '#3b2c1d'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(194,166,111,0.35)'; ctx.lineWidth = .6; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.strokeStyle = outline; ctx.lineWidth = 1.2; };
      const flag = (x, y, h, color) => {
        ctx.strokeStyle = '#4d3b26'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
        ctx.fillStyle = color || accent;
        ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * .48, y - h + 4); ctx.lineTo(x, y - h + 8); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = outline; ctx.lineWidth = .6; ctx.stroke();
      };
      const cross = (x, y, sz, col) => {
        ctx.fillStyle = col || '#8e3e35'; ctx.fillRect(x - sz * .2, y - sz, sz * .4, sz * 2); ctx.fillRect(x - sz, y - sz * .3, sz * 2, sz * .4);
      };
      switch (defId) {
        case 'hall': {
          // curtain wall and keep
          wall(-44, -21, 88, 19, level >= 2 ? stone : '#786044');
          ctx.fillStyle = level >= 2 ? pal.wallDark : '#6b4f35';
          for (let i = -4; i <= 4; i++) ctx.fillRect(i * 10 - 4, -27, 8, 7);
          for (const tx of [-42, 42]) {
            wall(tx - 8, -52, 16, 49, level >= 2 ? stone : '#745a3d');
            ctx.fillStyle = pal.roofDark;
            ctx.beginPath(); ctx.moveTo(tx - 11, -52); ctx.lineTo(tx, -67); ctx.lineTo(tx + 11, -52); ctx.closePath(); ctx.fill(); ctx.stroke();
            flag(tx, -67, 17, accent);
          }
          wall(-26, -60, 52, 58, level >= 3 ? stone : pal.wall);
          ctx.fillStyle = pal.roofDark;
          for (let i = 0; i < 4; i++) ctx.fillRect(-29 + i * 15, -67, 10, 8);
          gable(-26, -92, 52, 25, pal.roof, pal.roofDark, pal.trim);
          door(-7, -18, 14, 19);
          ctx.fillStyle = '#d9c485';
          for (const wx of [-17, 12]) { ctx.fillRect(wx, -48, 6, 11); ctx.fillStyle = 'rgba(236,205,128,0.65)'; }
          ctx.fillStyle = accent2; ctx.fillRect(-27, -42, 54, 2.2);
          flag(0, -94, 22, accent2);
          if (level >= 4) {
            ctx.fillStyle = '#d9b45f';
            ctx.beginPath(); ctx.arc(0, -94, 5, Math.PI, 0); ctx.fill();
          }
          break;
        }
        case 'house': {
          wall(-24, -30, 48, 29, '#9a8260');
          gable(-28, -60, 56, 30, pal.roof, pal.roofDark);
          door(-5, -17, 10, 16);
          ctx.fillStyle = '#75614c'; ctx.fillRect(14, -58, 7, 17);
          ctx.fillStyle = '#b2aa95'; ctx.fillRect(13, -61, 9, 4);
          ctx.fillStyle = '#d7bf84'; ctx.fillRect(-19, -26, 6, 6);
          flag(-20, -31, 16, accent);
          break;
        }
        case 'lumber': {
          wall(-28, -31, 40, 29, '#8d6f4d');
          gable(-31, -56, 46, 25, '#8d6f4d', '#5f4a32');
          door(-12, -17, 10, 15);
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = i % 2 ? '#8d6942' : '#a27a4a';
            ctx.beginPath(); ctx.ellipse(25, -7 - i * 6, 13, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = '#5e462e'; ctx.beginPath(); ctx.arc(25, -7 - i * 6, 3, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = outline;
          }
          ctx.strokeStyle = '#d3c19c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-33, -2); ctx.lineTo(-12, -28); ctx.stroke();
          ctx.fillStyle = '#8f918c'; ctx.beginPath(); ctx.moveTo(-15, -35); ctx.lineTo(-6, -28); ctx.lineTo(-13, -22); ctx.closePath(); ctx.fill();
          break;
        }
        case 'hunter': {
          wall(-25, -32, 45, 30, '#876947');
          gable(-28, -57, 51, 25, '#6e5539', '#493725');
          door(-8, -18, 10, 16);
          // antlers
          ctx.strokeStyle = '#d1b98d'; ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(-30, -38); ctx.lineTo(-38, -51); ctx.lineTo(-44, -46);
          ctx.moveTo(-30, -38); ctx.lineTo(-51, -57); ctx.lineTo(-54, -48);
          ctx.moveTo(27, -41); ctx.lineTo(38, -57); ctx.lineTo(44, -51);
          ctx.stroke();
          ctx.fillStyle = '#7f6040'; ctx.fillRect(22, -23, 4, 17);
          ctx.fillStyle = '#b99d72'; ctx.beginPath(); ctx.ellipse(24, -24, 7, 4, .2, 0, Math.PI * 2); ctx.fill();
          flag(-34, -60, 14, accent2);
          break;
        }
        case 'fishery': {
          // water and small boat
          ctx.fillStyle = '#6a9ba0'; ctx.globalAlpha = .5;
          for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(4, 1 - i * 5, 47 - i * 8, 4, 0, 0, Math.PI * 2); ctx.fill(); }
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#d6e6dd'; ctx.lineWidth = 1;
          for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-42 + i * 9, -2); ctx.quadraticCurveTo(-20, -9, 13, -2); ctx.stroke(); }
          wall(-31, -41, 28, 24, '#967a53');
          gable(-35, -63, 36, 22, '#7d6140', '#5a4630');
          ctx.fillStyle = '#5c432b'; ctx.fillRect(12, -16, 38, 4); ctx.fillStyle = '#8b6742'; ctx.fillRect(12, -14, 38, 2);
          ctx.strokeStyle = '#55412c'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(30, -14); ctx.lineTo(30, -38); ctx.lineTo(44, -30); ctx.lineTo(30, -24); ctx.closePath(); ctx.fillStyle = accent2; ctx.fill(); ctx.stroke();
          break;
        }
        case 'gatherer': {
          wall(-28, -32, 42, 30, '#91734f');
          gable(-32, -58, 49, 26, '#8b6e46', '#5d482e');
          door(-9, -17, 10, 15);
          // baskets with berries
          for (let i = 0; i < 2; i++) {
            const bx = 23 + i * 13;
            ctx.fillStyle = '#a57b44'; ctx.beginPath(); ctx.ellipse(bx, -7, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#6c4f2d'; ctx.lineWidth = .8; ctx.stroke();
            ctx.fillStyle = '#a33d45';
            for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(bx - 3 + j * 3, -10, 1.4, 0, Math.PI * 2); ctx.fill(); }
          }
          flag(-31, -62, 15, accent);
          break;
        }
        case 'quarry': {
          ctx.fillStyle = '#8b8474'; ctx.beginPath(); ctx.ellipse(0, -2, 45, 12, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#5e594e'; ctx.beginPath(); ctx.ellipse(0, -1, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#b2a995'; ctx.lineWidth = 1;
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, -2, 12 + i * 7, Math.PI * 1.05, Math.PI * 1.9); ctx.stroke(); }
          for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#a39a88' : '#b3aa96'; ctx.fillRect(26 + (i % 2) * 10, -19 - Math.floor(i / 2) * 8, 9, 7); ctx.strokeRect(26 + (i % 2) * 10, -19 - Math.floor(i / 2) * 8, 9, 7); }
          ctx.strokeStyle = '#6e5436'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-34, -3); ctx.lineTo(-34, -44); ctx.lineTo(-9, -33); ctx.moveTo(-34, -44); ctx.lineTo(-43, -48); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-10, -33); ctx.lineTo(-10, -16); ctx.stroke();
          break;
        }
        case 'ironMine': case 'goldMine': case 'silverMine': {
          const ore = defId === 'goldMine' ? '#dfb64d' : defId === 'silverMine' ? '#cfdbdc' : '#899392';
          ctx.fillStyle = '#7b7569';
          ctx.beginPath(); ctx.moveTo(-47, 0); ctx.lineTo(-31, -36); ctx.lineTo(-10, -57); ctx.lineTo(13, -44); ctx.lineTo(36, -25); ctx.lineTo(48, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#5b564d'; ctx.beginPath(); ctx.moveTo(-21, 0); ctx.lineTo(-21, -20); ctx.quadraticCurveTo(-21, -31, -10, -35); ctx.quadraticCurveTo(1, -31, 1, -20); ctx.lineTo(1, 0); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#2b2822'; ctx.beginPath(); ctx.arc(-10, -19, 10, Math.PI, 0); ctx.lineTo(0, 0); ctx.lineTo(-20, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#9b7e51'; ctx.lineWidth = 2; ctx.strokeRect(-23, -27, 26, 4);
          ctx.fillStyle = ore;
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(24 + i * 5, -9 - (i % 2) * 5, 2.4, 0, Math.PI * 2); ctx.fill(); }
          flag(31, -31, 16, accent);
          break;
        }
        case 'farm': {
          ctx.fillStyle = '#a38d51'; ctx.fillRect(-48, -7, 96, 13);
          ctx.strokeStyle = '#695a35'; ctx.lineWidth = 1;
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-44, -5 + i * 3); ctx.bezierCurveTo(-20, -8 + i * 3, 15, -2 + i * 3, 44, -5 + i * 3); ctx.stroke(); }
          for (let i = 0; i < 9; i++) { ctx.strokeStyle = '#e2c876'; ctx.beginPath(); ctx.moveTo(-39 + i * 10, -8); ctx.lineTo(-39 + i * 10 + 1, -17); ctx.stroke(); }
          ctx.strokeStyle = '#6d5134'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(30, -17); ctx.lineTo(30, 1); ctx.moveTo(22, -11); ctx.lineTo(38, -11); ctx.stroke();
          ctx.fillStyle = '#8a6840'; ctx.beginPath(); ctx.arc(30, -20, 4, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#d6c69d'; ctx.beginPath(); ctx.moveTo(26, -22); ctx.lineTo(34, -22); ctx.stroke();
          flag(-38, -11, 14, accent2);
          break;
        }
        case 'mill': {
          ctx.fillStyle = '#a18e6b'; ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-12, -45); ctx.lineTo(12, -45); ctx.lineTo(16, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          gable(-18, -66, 36, 22, pal.roof, pal.roofDark);
          door(-4, -18, 8, 18);
          ctx.save(); ctx.translate(0, -47); ctx.rotate(-0.35);
          for (let i = 0; i < 4; i++) {
            ctx.save(); ctx.rotate(i * Math.PI / 2);
            ctx.strokeStyle = '#684c31'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -35); ctx.stroke();
            ctx.fillStyle = '#cfb784'; ctx.fillRect(-6, -34, 12, 17); ctx.strokeStyle = '#725a39'; ctx.lineWidth = .8; ctx.strokeRect(-6, -34, 12, 17);
            ctx.restore();
          }
          ctx.fillStyle = '#56412b'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          break;
        }
        case 'smelter': {
          wall(-30, -23, 53, 22, '#8a8274');
          ctx.fillStyle = '#625c52'; ctx.fillRect(-34, -30, 61, 8);
          ctx.fillStyle = '#787168'; ctx.fillRect(13, -54, 14, 32); ctx.strokeRect(13, -54, 14, 32);
          ctx.fillStyle = '#dcc9a3'; ctx.fillRect(14, -56, 12, 3);
          for (let i = 0; i < 3; i++) { ctx.fillStyle = 'rgba(205,197,179,' + (.16 + i * .06) + ')'; ctx.beginPath(); ctx.arc(20 + i * 2, -63 - i * 6, 3 + i, 0, Math.PI * 2); ctx.fill(); }
          ctx.fillStyle = '#ef9c3f'; ctx.beginPath(); ctx.arc(-8, -9, 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffcd70'; ctx.beginPath(); ctx.arc(-8, -9, 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#4d4a43'; ctx.fillRect(26, -8, 15, 5); ctx.fillRect(30, -3, 8, 3);
          break;
        }
        case 'mint': {
          wall(-33, -28, 66, 27, '#9a907b');
          gable(-35, -50, 70, 23, '#6b5b49', '#473c2f');
          door(-5, -18, 10, 17);
          ctx.fillStyle = '#dbbd64'; ctx.beginPath(); ctx.arc(23, -18, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#72572a'; ctx.font = 'bold 12px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('S', 23, -17);
          ctx.fillStyle = '#8a8172'; ctx.fillRect(14, -48, 9, 24); ctx.strokeRect(14, -48, 9, 24);
          flag(-27, -52, 15, accent);
          break;
        }
        case 'warehouse': {
          wall(-42, -27, 84, 26, '#8b6e4b');
          gable(-46, -54, 92, 28, '#704f35', '#4b3524');
          ctx.fillStyle = '#463323'; ctx.fillRect(-12, -21, 24, 20);
          ctx.strokeStyle = '#947246'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(0, -1); ctx.stroke();
          for (let i = 0; i < 3; i++) {
            ctx.fillStyle = '#6f5235'; ctx.fillRect(-42 + i * 9, -10 + (i % 2) * 4, 8, 7); ctx.strokeRect(-42 + i * 9, -10 + (i % 2) * 4, 8, 7);
            ctx.fillStyle = '#a47b48'; ctx.beginPath(); ctx.ellipse(36, -5 - i * 5, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
          }
          flag(38, -55, 14, accent2);
          break;
        }
        case 'church': {
          wall(-31, -27, 50, 26, '#a49b89');
          gable(-34, -46, 56, 21, '#5b5650', '#3c3935');
          wall(-8, -66, 16, 44, '#918a7b');
          ctx.fillStyle = pal.roofDark; ctx.beginPath(); ctx.moveTo(-13, -66); ctx.lineTo(0, -87); ctx.lineTo(13, -66); ctx.closePath(); ctx.fill(); ctx.stroke();
          cross(0, -82, 5, '#e4d4a8');
          for (let i = 0; i < 3; i++) { ctx.fillStyle = '#d9be84'; ctx.beginPath(); ctx.arc(-22 + i * 15, -17, 3.2, Math.PI, 0); ctx.lineTo(-18.5 + i * 15, -8); ctx.lineTo(-25.5 + i * 15, -8); ctx.fill(); }
          door(-4, -17, 8, 16);
          break;
        }
        case 'market': {
          const awning = (x, y, w, h, color) => {
            ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w / 2, y - h); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 4, y + 4); ctx.lineTo(x + 4, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = 'rgba(55,35,20,0.4)'; ctx.lineWidth = .8;
            for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + w * i / 4, y - h + h * Math.abs(i / 4 - .5) * 2); ctx.lineTo(x + w * i / 4, y + 3); ctx.stroke(); }
            ctx.strokeStyle = outline; ctx.lineWidth = 1.2;
            ctx.fillStyle = '#6f5337'; ctx.fillRect(x + w * .15, y + 4, w * .7, 15);
            ctx.strokeRect(x + w * .15, y + 4, w * .7, 15);
            ctx.fillStyle = '#9b7447'; ctx.fillRect(x + w * .45, y + 8, w * .2, 6);
          };
          awning(-42, -13, 40, 17, accent);
          awning(4, -13, 40, 17, accent2);
          ctx.fillStyle = '#7b674a'; ctx.fillRect(-1, -3, 4, 13);
          ctx.fillStyle = '#c6b284'; ctx.beginPath(); ctx.arc(-20, 3, 3, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'tavern': {
          wall(-30, -32, 53, 31, '#957b59');
          gable(-34, -58, 61, 26, '#7a5637', '#543a27');
          door(-8, -18, 10, 17);
          ctx.strokeStyle = '#5b4428'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(24, -28); ctx.lineTo(42, -28); ctx.stroke();
          ctx.fillStyle = '#533b28'; ctx.fillRect(29, -27, 13, 11); ctx.strokeStyle = '#d0b77d'; ctx.lineWidth = 1; ctx.strokeRect(29, -27, 13, 11);
          ctx.fillStyle = '#d0b77d'; ctx.beginPath(); ctx.arc(35.5, -22, 4, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#785332'; ctx.beginPath(); ctx.ellipse(-36, -2, 7, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#c9ac74'; ctx.fillRect(20, -26, 3, 3);
          break;
        }
        case 'clinic': {
          wall(-29, -29, 58, 28, '#c4bbaa');
          gable(-32, -51, 64, 23, '#7c6a53', '#554634');
          door(-5, -16, 10, 15);
          cross(24, -17, 7, '#9d4038');
          ctx.fillStyle = '#5d7948'; ctx.beginPath(); ctx.ellipse(37, -2, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
          for (let i = 0; i < 4; i++) { ctx.fillStyle = '#8ca66e'; ctx.beginPath(); ctx.arc(31 + i * 4, -5, 1.6, 0, Math.PI * 2); ctx.fill(); }
          break;
        }
        case 'hospital': {
          wall(-40, -29, 80, 28, '#bdb5a3');
          gable(-43, -49, 86, 21, '#625d55', '#403d38');
          wall(-9, -64, 18, 37, '#a59d8c');
          ctx.fillStyle = '#4b4841'; ctx.beginPath(); ctx.moveTo(-12, -64); ctx.lineTo(0, -81); ctx.lineTo(12, -64); ctx.closePath(); ctx.fill();
          door(-6, -17, 12, 16);
          cross(26, -17, 9, '#9a3d36');
          for (let i = 0; i < 4; i++) { ctx.fillStyle = '#d3c190'; ctx.fillRect(-34 + i * 15, -23, 4, 10); }
          break;
        }
        case 'dock': {
          ctx.fillStyle = '#5b848c'; ctx.globalAlpha = .55;
          for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, 2 - i * 6, 45 - i * 6, 5, 0, 0, Math.PI * 2); ctx.fill(); }
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#8c6842'; ctx.fillRect(-35, -3, 70, 5); ctx.strokeRect(-35, -3, 70, 5);
          for (let i = 0; i < 6; i++) { ctx.strokeStyle = '#5d432a'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(-32 + i * 12, -3); ctx.lineTo(-32 + i * 12, 2); ctx.stroke(); }
          ctx.fillStyle = '#5c432b'; ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(14, -7); ctx.lineTo(21, 1); ctx.lineTo(-12, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#523b27'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(5, -7); ctx.lineTo(5, -35); ctx.stroke();
          ctx.fillStyle = accent2; ctx.beginPath(); ctx.moveTo(6, -34); ctx.lineTo(23, -25); ctx.lineTo(6, -16); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#5e452d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(33, 0); ctx.lineTo(33, -39); ctx.lineTo(15, -29); ctx.stroke();
          break;
        }
        case 'barracks': {
          wall(-39, -25, 78, 24, '#8d806a');
          gable(-42, -48, 84, 24, '#514a3f', '#37322a');
          door(-7, -17, 14, 16);
          for (let i = 0; i < 4; i++) { ctx.fillStyle = '#5d4b35'; ctx.fillRect(-39 + i * 20, -3, 3, 13); }
          ctx.fillStyle = accent;
          for (let i = 0; i < 3; i++) { const x = -26 + i * 19; ctx.beginPath(); ctx.arc(x, -25, 5, 0, Math.PI); ctx.lineTo(x, -19); ctx.closePath(); ctx.fill(); ctx.strokeStyle = accent2; ctx.lineWidth = .7; ctx.stroke(); }
          flag(0, -50, 18, accent);
          break;
        }
        case 'archery': {
          ctx.fillStyle = '#8a8255'; ctx.beginPath(); ctx.ellipse(0, -2, 46, 9, 0, 0, Math.PI * 2); ctx.fill();
          wall(-41, -34, 30, 25, '#8f7550'); gable(-44, -52, 36, 18, '#6e5439', '#4b3926');
          for (let i = 0; i < 2; i++) {
            const x = 15 + i * 20;
            ctx.fillStyle = '#d8c7a0'; ctx.beginPath(); ctx.arc(x, -22, 10, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#a94b42'; ctx.beginPath(); ctx.arc(x, -22, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#e5d9ba'; ctx.beginPath(); ctx.arc(x, -22, 2.4, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#5c432b'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 2, -24); ctx.lineTo(x + 12, -29); ctx.stroke();
          }
          ctx.strokeStyle = '#7b5c39'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(-15, -9, 12, -1, 1.8); ctx.stroke();
          break;
        }
        case 'stable': {
          wall(-42, -31, 56, 30, '#8d7653');
          gable(-45, -55, 63, 24, '#6e5237', '#4a3827');
          flag(-35, -58, 14, accent);
          ctx.fillStyle = '#748352'; ctx.fillRect(8, -9, 38, 10);
          ctx.strokeStyle = '#715334'; ctx.lineWidth = 1.2;
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(9 + i * 11, -9); ctx.lineTo(9 + i * 11, -22); ctx.stroke(); }
          ctx.beginPath(); ctx.moveTo(9, -16); ctx.lineTo(46, -16); ctx.stroke();
          // horse silhouette
          ctx.fillStyle = '#76563a'; ctx.beginPath(); ctx.ellipse(29, -15, 9, 4, -.15, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(37, -20, 3.5, 5, .4, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(24, -13, 2, 5); ctx.fillRect(32, -13, 2, 5);
          break;
        }
        case 'wall': {
          ctx.fillStyle = level >= 2 ? stone : '#715337';
          ctx.fillRect(-46, -23, 92, 22); ctx.strokeRect(-46, -23, 92, 22);
          for (let i = 0; i < 6; i++) { ctx.fillRect(-46 + i * 16, -30, 10, 8); ctx.strokeRect(-46 + i * 16, -30, 10, 8); }
          ctx.fillStyle = level >= 2 ? '#6f6b61' : '#5d452e';
          for (let i = 0; i < 5; i++) ctx.fillRect(-42 + i * 18, -16, 10, 3);
          if (level >= 3) { ctx.strokeStyle = 'rgba(228,201,127,0.55)'; ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-38 + i * 19, -11, 2, 0, Math.PI * 2); ctx.stroke(); } }
          break;
        }
        case 'gate': {
          ctx.fillStyle = level >= 2 ? stone : '#715337';
          ctx.fillRect(-40, -42, 20, 40); ctx.strokeRect(-40, -42, 20, 40);
          ctx.fillRect(20, -42, 20, 40); ctx.strokeRect(20, -42, 20, 40);
          for (const x of [-42, 18]) { for (let i = 0; i < 2; i++) { ctx.fillRect(x + i * 10, -49, 7, 8); ctx.strokeRect(x + i * 10, -49, 7, 8); } }
          ctx.fillStyle = '#382a1c'; ctx.beginPath(); ctx.arc(0, -1, 20, Math.PI, 0); ctx.lineTo(20, -1); ctx.lineTo(-20, -1); ctx.fill();
          ctx.strokeStyle = 'rgba(215,190,132,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, -1, 20, Math.PI, 0); ctx.stroke();
          flag(0, -50, 18, accent);
          break;
        }
        case 'tower': {
          const wood = level === 1;
          ctx.fillStyle = wood ? '#765737' : stone;
          ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-13, -51); ctx.lineTo(13, -51); ctx.lineTo(18, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = wood ? '#8e6d48' : '#b1a994';
          ctx.fillRect(-16, -51, 32, 8); ctx.strokeRect(-16, -51, 32, 8);
          for (let i = 0; i < 5; i++) { ctx.fillRect(-18 + i * 8, -58, 5, 8); ctx.strokeRect(-18 + i * 8, -58, 5, 8); }
          ctx.fillStyle = '#27231b'; ctx.fillRect(-2, -40, 4, 12); ctx.fillRect(-2, -19, 4, 8);
          flag(10, -58, 20, accent);
          ctx.strokeStyle = 'rgba(60,55,45,0.4)'; ctx.lineWidth = .8;
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-13 + i * 7, -10 - i * 8); ctx.lineTo(13 - i * 4, -10 - i * 8); ctx.stroke(); }
          break;
        }
        case 'knightOrder': {
          wall(-38, -28, 76, 27, '#8b8377');
          gable(-41, -50, 82, 23, '#4f4b45', '#35322d');
          ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(0, -45); ctx.lineTo(25, -36); ctx.lineTo(22, -10); ctx.lineTo(0, 1); ctx.lineTo(-22, -10); ctx.lineTo(-25, -36); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = accent2; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -39); ctx.lineTo(0, -8); ctx.moveTo(-12, -27); ctx.lineTo(12, -27); ctx.stroke();
          flag(0, -51, 20, accent2);
          break;
        }
        case 'library': {
          wall(-33, -43, 66, 42, stone);
          gable(-36, -60, 72, 19, '#4d4a44', '#33312c');
          for (let i = 0; i < 4; i++) { ctx.fillStyle = '#7b6a48'; ctx.fillRect(-26 + i * 15, -34, 9, 26); ctx.strokeRect(-26 + i * 15, -34, 9, 26); ctx.strokeStyle = 'rgba(222,205,163,0.5)'; ctx.beginPath(); ctx.moveTo(-26 + i * 15, -27); ctx.lineTo(-17 + i * 15, -27); ctx.stroke(); ctx.strokeStyle = outline; }
          door(-6, -16, 12, 15);
          ctx.fillStyle = '#c9b77d'; ctx.beginPath(); ctx.arc(0, -66, 4, 0, Math.PI * 2); ctx.fill();
          flag(23, -61, 16, accent);
          break;
        }
        case 'university': {
          wall(-42, -34, 84, 33, stone);
          ctx.fillStyle = pal.roofDark;
          for (let i = 0; i < 3; i++) { ctx.fillRect(-37 + i * 28, -40, 20, 6); }
          wall(-11, -64, 22, 31, '#8c8578');
          ctx.fillStyle = '#56625e'; ctx.beginPath(); ctx.arc(0, -64, 19, Math.PI, 0); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#cbb775'; ctx.beginPath(); ctx.arc(0, -82, 3, 0, Math.PI * 2); ctx.fill();
          for (let i = 0; i < 4; i++) { ctx.fillStyle = '#c6b27c'; ctx.fillRect(-32 + i * 18, -24, 5, 12); }
          door(-6, -17, 12, 16);
          flag(-36, -41, 14, accent);
          break;
        }
        case 'royalUniversity': {
          wall(-42, -32, 84, 31, '#8c8477');
          wall(-11, -65, 22, 34, '#918a7d');
          ctx.fillStyle = '#d3b765'; ctx.beginPath(); ctx.arc(0, -65, 23, Math.PI, 0); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ecd58b'; ctx.beginPath(); ctx.arc(0, -65, 17, Math.PI, 0); ctx.fill();
          ctx.fillStyle = '#f0dda4'; ctx.beginPath(); ctx.arc(0, -88, 4, 0, Math.PI * 2); ctx.fill();
          for (let i = 0; i < 4; i++) { ctx.fillStyle = '#d7bd76'; ctx.fillRect(-34 + i * 19, -23, 6, 13); }
          door(-6, -17, 12, 16);
          flag(-30, -49, 17, accent); flag(30, -49, 17, accent2);
          break;
        }
        case 'bridge': {
          ctx.fillStyle = '#5e868c'; ctx.globalAlpha = .55; ctx.fillRect(-46, -6, 92, 10); ctx.globalAlpha = 1;
          ctx.strokeStyle = '#d5e2d8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-40, -1); ctx.quadraticCurveTo(0, -7, 40, -1); ctx.stroke();
          ctx.strokeStyle = '#7b5a37'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-46, -12); ctx.quadraticCurveTo(0, -33, 46, -12); ctx.stroke();
          ctx.strokeStyle = '#c0a16f'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-40, -22); ctx.quadraticCurveTo(0, -40, 40, -22); ctx.stroke();
          ctx.strokeStyle = '#7b5a37'; ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { const x = -36 + i * 18; const y = -18 - Math.sin(i / 4 * Math.PI) * 10; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 6); ctx.stroke(); }
          break;
        }
        case 'road': {
          ctx.fillStyle = '#a58c66'; ctx.beginPath(); ctx.moveTo(-15, -2); ctx.bezierCurveTo(-20, -25, 12, -30, 10, -53); ctx.lineTo(23, -53); ctx.bezierCurveTo(26, -28, -7, -24, -3, -2); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#7a6447'; ctx.lineWidth = 1; for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(-8 + i * 3, -9 - i * 6, 1.2, 0, Math.PI * 2); ctx.stroke(); }
          flag(30, -38, 16, accent);
          break;
        }
        case 'tunnel': {
          ctx.fillStyle = '#7d776d'; ctx.beginPath(); ctx.moveTo(-48, 0); ctx.lineTo(-32, -35); ctx.lineTo(-11, -57); ctx.lineTo(17, -49); ctx.lineTo(41, -22); ctx.lineTo(48, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#28241f'; ctx.beginPath(); ctx.arc(0, -17, 20, Math.PI, 0); ctx.lineTo(20, 0); ctx.lineTo(-20, 0); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#a49b89'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(0, -17, 24, Math.PI, 0); ctx.stroke();
          ctx.fillStyle = '#d2c7ad'; ctx.beginPath(); ctx.arc(-9, -8, 1.6, 0, Math.PI * 2); ctx.fill();
          break;
        }
        default: {
          wall(-27, -29, 54, 28, pal.wall);
          gable(-31, -54, 62, 27, pal.roof, pal.roofDark);
          door(-6, -17, 12, 16);
          flag(-24, -56, 16, accent);
        }
      }
      // faction stripe and level pips
      ctx.strokeStyle = 'rgba(228,207,154,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-40, -4); ctx.lineTo(40, -4); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(W / 2, H * 0.91);
      ctx.fillStyle = pal.trim;
      const pip = Math.max(1.4, 1.8 * s);
      for (let i = 0; i < level; i++) { ctx.beginPath(); ctx.arc((i - (level - 1) / 2) * 7 * s, 0, pip, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    drawUnitIcon(canvas, unitLike, faction) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const def = unitLike.def || D.UNITS[unitLike.kind] || D.UNITS.resident;
      const color = faction ? faction.colors.primary : '#5e4b34';
      const accent = faction ? faction.colors.secondary : '#ccb675';
      const scale = Math.min(W / 78, H / 62);
      ctx.save();
      ctx.translate(W / 2, H * 0.72);
      ctx.scale(scale * (def.isShip ? 1.15 : 1.45), scale * (def.isShip ? 1.15 : 1.45));
      const t = 30;
      const fake = Object.assign({}, unitLike, { def, state: 'idle', isShip: !!def.isShip, kind: unitLike.kind || 'resident', facing: -Math.PI / 2, hp: 1, maxHp: 1 });
      if (def.isShip) this._drawShipArt(ctx, fake, t, 1, color, accent);
      else if (def.military) this._drawSoldierArt(ctx, fake, t, 1, color, accent);
      else this._drawCivilianArt(ctx, fake, t, 1, color, accent);
      ctx.restore();
    }

    drawCrestToCanvas(canvas, faction) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      this.drawCrest(ctx, W / 2, H / 2, Math.min(W, H) * 0.88, faction);
    }

    drawCrest(ctx, cx, cy, size, faction) {
      if (!faction) return;
      const w = size * 0.78, h = size;
      const x = cx - w / 2, y = cy - h / 2;
      ctx.save();
      // shield
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(x, y + h * 0.03);
        ctx.quadraticCurveTo(cx, y - h * 0.05, x + w, y + h * 0.03);
        ctx.lineTo(x + w, y + h * 0.56);
        ctx.quadraticCurveTo(x + w, y + h * 0.78, cx, y + h);
        ctx.quadraticCurveTo(x, y + h * 0.78, x, y + h * 0.56);
        ctx.closePath();
      };
      path();
      ctx.fillStyle = faction.colors.primary;
      ctx.fill();
      // bend
      ctx.save(); path(); ctx.clip();
      ctx.fillStyle = faction.colors.secondary;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(x - 2, y + h * 0.25); ctx.lineTo(x + w * 0.55, y - 2); ctx.lineTo(x + w * 0.85, y - 2); ctx.lineTo(x + w * 0.28, y + h * 0.8); ctx.lineTo(x - 2, y + h * 0.8); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
      path();
      ctx.strokeStyle = faction.colors.accent; ctx.lineWidth = Math.max(1.2, size * 0.035); ctx.stroke();
      path(); ctx.strokeStyle = 'rgba(33,24,15,0.65)'; ctx.lineWidth = Math.max(0.8, size * 0.015); ctx.stroke();
      // symbol
      const symColor = faction.colors.accent;
      this.drawCrestIcon(ctx, cx, cy + h * 0.02, size * 0.38, faction, symColor);
      ctx.restore();
    }
  }

  function dateSeason(days) {
    return ['春', '夏', '秋', '冬'][Math.floor((days % 360) / 90)] || '春';
  }

  WW.Renderer = Renderer;
})();
