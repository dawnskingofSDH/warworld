/* WARWORLD — deterministic procedural world generation. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const TER = D.TERRAIN;

  class World {
    constructor(w, h, seed) {
      this.w = w;
      this.h = h;
      this.seed = seed;
      this.terrain = new Uint8Array(w * h);
      this.elev = new Float32Array(w * h);
      this.moist = new Float32Array(w * h);
      this.ridge = new Float32Array(w * h);
      this.nodeGrid = new Int32Array(w * h).fill(-1);
      this.nodes = [];
      this.starts = [];
      this.component = new Int32Array(w * h).fill(-1);
      this.landComponents = [];
      this._nextNode = 1;
    }
    idx(x, y) { return y * this.w + x; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    getTerrain(x, y) {
      if (!this.inBounds(x, y)) return 0;
      return this.terrain[y * this.w + x];
    }
    terrainDef(x, y) { return TER[this.getTerrain(x, y)] || TER[0]; }
    isWater(x, y) { return !!this.terrainDef(x, y).water; }
    isLand(x, y) { return !this.terrainDef(x, y).water; }
    isPassableTerrain(x, y) { return !!this.terrainDef(x, y).pass; }
    isMountain(x, y) { return !!this.terrainDef(x, y).mountain; }
    nodeAt(x, y) {
      if (!this.inBounds(x, y)) return null;
      const i = this.nodeGrid[y * this.w + x];
      return i >= 0 ? this.nodes[i] : null;
    }
    addNode(type, x, y, amountFactor) {
      if (!this.inBounds(x, y)) return null;
      const i = this.idx(x, y);
      if (this.nodeGrid[i] >= 0) return null;
      const meta = D.NODES[type];
      if (!meta) return null;
      const rng = this._nodeRng || (this._nodeRng = new U.RNG('node-meta:' + this.seed));
      const max = Math.round(rng.float(meta.min, meta.max));
      const amount = amountFactor == null ? Math.round(max * rng.float(0.62, 0.96)) : Math.round(max * amountFactor);
      const node = {
        id: 'n' + (this._nextNode++), type, x, y,
        amount: U.clamp(amount, 1, max), max, alive: true,
        variant: rng.int(0, 999),
        regenMul: 1
      };
      this.nodes.push(node);
      this.nodeGrid[i] = this.nodes.length - 1;
      return node;
    }
    removeNode(node) {
      if (!node || !node.alive) return;
      node.alive = false;
      const i = this.idx(node.x, node.y);
      if (this.nodeGrid[i] >= 0 && this.nodes[this.nodeGrid[i]] === node) this.nodeGrid[i] = -1;
    }
    nodeAreaCount(x, y, r, type) {
      let n = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(this.h - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(this.w - 1, x + r); xx++) {
          const nd = this.nodeAt(xx, yy);
          if (nd && nd.alive && (!type || nd.type === type)) n++;
        }
      }
      return n;
    }
    findNodesNear(x, y, range, type) {
      const out = [];
      const r = Math.ceil(range);
      for (let yy = Math.max(0, y - r); yy <= Math.min(this.h - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(this.w - 1, x + r); xx++) {
          const nd = this.nodeAt(xx, yy);
          if (nd && nd.alive && nd.type === type && U.dist(xx, yy, x, y) <= range) out.push(nd);
        }
      }
      return out;
    }
    hasAdjacentWater(x, y, r) {
      const rr = r == null ? 2 : r;
      for (let yy = Math.max(0, y - rr); yy <= Math.min(this.h - 1, y + rr); yy++) {
        for (let xx = Math.max(0, x - rr); xx <= Math.min(this.w - 1, x + rr); xx++) {
          if (this.isWater(xx, yy)) return true;
        }
      }
      return false;
    }
    mountainNear(x, y, r) {
      const rr = r == null ? 3 : r;
      for (let yy = Math.max(0, y - rr); yy <= Math.min(this.h - 1, y + rr); yy++) {
        for (let xx = Math.max(0, x - rr); xx <= Math.min(this.w - 1, x + rr); xx++) {
          if (this.isMountain(xx, yy)) return true;
        }
      }
      return false;
    }
    forEachNeighbor(x, y, fn) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (this.inBounds(nx, ny)) fn(nx, ny, dx, dy);
        }
      }
    }
    toJSONOverrides() {
      const out = {};
      for (const n of this.nodes) {
        if (!n.alive || n.amount < n.max * 0.999 || n.regenMul !== 1) {
          out[n.id] = { a: U.round(n.amount, 2), alive: n.alive ? 1 : 0, r: U.round(n.regenMul, 3) };
        }
      }
      return out;
    }
  }

  function classify(e, m, r, sea) {
    if (e < sea) return 0;
    if (e > 0.715 || (r > 0.73 && e > 0.64)) return 6;
    if (e > 0.59) return 5;
    if (m > 0.53) return 4;
    return 3;
  }

  const MapGen = {};

  MapGen.generate = function (settings, onProgress) {
    const size = D.MAP_SIZES[settings.mapSize] || D.MAP_SIZES.vast;
    const w = size.w, h = size.h;
    const seed = String(settings.seed == null ? Date.now() : settings.seed);
    const world = new World(w, h, seed);
    const seedNum = U.hashString(seed);
    const noiseE = new U.Noise(seedNum ^ 0x1a2b3c);
    const noiseE2 = new U.Noise(seedNum ^ 0x5d6e7f);
    const noiseM = new U.Noise(seedNum ^ 0x9f10ab);
    const noiseR = new U.Noise(seedNum ^ 0x33aa77);
    const noiseWarp = new U.Noise(seedNum ^ 0x71cf22);
    const noiseClear = new U.Noise(seedNum ^ 0x6f2e11);
    const rng = new U.RNG(seedNum ^ 0xdeadbeef);
    world.rng = rng;
    const sea = 0.372;

    // Terrain: domain-warped elevation plus ridged mountain belts.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = x / w - 0.5, ny = y / h - 0.5;
        const edge = Math.max(Math.abs(nx) * 1.16, Math.abs(ny) * 1.24);
        const wx = noiseWarp.fbm(x * 0.012 + 11.3, y * 0.012 - 7.1, 3) - 0.5;
        const wy = noiseWarp.fbm(x * 0.012 - 3.8, y * 0.012 + 5.6, 3) - 0.5;
        let e = noiseE.fbm((x + wx * 25) * 0.018, (y + wy * 25) * 0.018, 5, 2.03, 0.5);
        e += (noiseE2.fbm(x * 0.045 + 4.2, y * 0.045 - 2.9, 3) - 0.5) * 0.055;
        e -= Math.pow(edge, 3.1) * 0.36;
        e += 0.045;
        const ridge = noiseR.ridged(x * 0.016 + 8.4, y * 0.016 - 5.2, 4);
        e += Math.max(0, ridge - 0.54) * 0.16;
        const m = noiseM.fbm(x * 0.021 - 9.4, y * 0.021 + 3.1, 4);
        const i = y * w + x;
        world.elev[i] = U.clamp(e, 0, 1);
        world.moist[i] = m;
        world.ridge[i] = ridge;
        world.terrain[i] = classify(e, m, ridge, sea);
      }
    }
    if (onProgress) onProgress(0.22);

    // Inland lakes in low basins.
    const lakeTarget = 3 + Math.floor((w * h) / 30000) + rng.int(0, 2);
    let attempts = 0;
    let lakes = 0;
    while (lakes < lakeTarget && attempts < lakeTarget * 80) {
      attempts++;
      const x = rng.int(Math.floor(w * 0.14), Math.floor(w * 0.86));
      const y = rng.int(Math.floor(h * 0.14), Math.floor(h * 0.86));
      if (!world.isLand(x, y) || world.terrainDef(x, y).mountain) continue;
      if (world.elev[world.idx(x, y)] > sea + 0.11) continue;
      const radX = rng.int(2, 5), radY = rng.int(2, 5);
      let carved = 0;
      for (let yy = -radY; yy <= radY; yy++) {
        for (let xx = -radX; xx <= radX; xx++) {
          const tx = x + xx, ty = y + yy;
          if (!world.inBounds(tx, ty)) continue;
          const d = (xx * xx) / (radX * radX) + (yy * yy) / (radY * radY);
          if (d > 1 + (rng.next() - 0.5) * 0.35) continue;
          const ti = ty * w + tx;
          if (world.terrain[ti] === 6) continue;
          world.terrain[ti] = 1;
          carved++;
        }
      }
      if (carved > 4) lakes++;
    }
    if (onProgress) onProgress(0.3);

    // Rivers run downhill from high ground to sea or a lake.
    const riverSources = [];
    for (let y = 7; y < h - 7; y += 3) {
      for (let x = 7; x < w - 7; x += 3) {
        const idx = y * w + x;
        if (world.terrain[idx] === 6 || world.elev[idx] > 0.60) {
          if (rng.next() < 0.06) riverSources.push({ x, y, e: world.elev[idx] });
        }
      }
    }
    riverSources.sort((a, b) => b.e - a.e);
    const riverCount = U.clamp(4 + Math.floor((w * h) / 22000), 4, 10);
    let rivers = 0;
    for (const src of riverSources) {
      if (rivers >= riverCount) break;
      let cx = src.x, cy = src.y;
      const path = [];
      const visited = new Set();
      let reached = false;
      for (let step = 0; step < 260; step++) {
        if (!world.inBounds(cx, cy)) break;
        const key = cy * w + cx;
        if (visited.has(key)) break;
        visited.add(key);
        const t = world.terrain[key];
        if (t === 0 || t === 1) { reached = true; break; }
        if (step > 1) path.push({ x: cx, y: cy });
        let best = null, bestScore = Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (!world.inBounds(nx, ny)) continue;
            const ni = ny * w + nx;
            const nt = world.terrain[ni];
            let score = world.elev[ni];
            if (nt === 0 || nt === 1) score = -0.5;
            if (nt === 6) score += 0.22;
            if (nt === 2) score -= 0.12;
            score += (rng.next() - 0.5) * 0.035;
            if (score < bestScore) { bestScore = score; best = { x: nx, y: ny }; }
          }
        }
        if (!best) break;
        cx = best.x; cy = best.y;
      }
      if (reached && path.length > 8) {
        // Bridge diagonal steps with an orthogonal corner tile, so a river is a
        // real, four-connected waterway rather than a chain of isolated ponds.
        const connected = [];
        let prev = null;
        for (const p of path) {
          if (prev && p.x !== prev.x && p.y !== prev.y) {
            const a = { x: p.x, y: prev.y }, b = { x: prev.x, y: p.y };
            const score = (c) => {
              if (!world.inBounds(c.x, c.y)) return 9;
              const t = world.terrain[world.idx(c.x, c.y)];
              if (t === 6) return 8;
              return world.elev[world.idx(c.x, c.y)] + (t === 2 ? -0.2 : 0);
            };
            connected.push(score(a) < score(b) ? a : b);
          }
          connected.push(p);
          prev = p;
        }
        for (const p of connected) {
          const t = world.terrain[world.idx(p.x, p.y)];
          if (t !== 0 && t !== 1) world.terrain[world.idx(p.x, p.y)] = 2;
        }
        rivers++;
      }
    }
    if (onProgress) onProgress(0.4);

    // Find connected land regions; start positions must share the largest one.
    const comp = world.component;
    const comps = [];
    const q = new Int32Array(w * h);
    let cid = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (comp[i] !== -1) continue;
        const def = TER[world.terrain[i]];
        if (!def.pass) continue;
        comp[i] = cid;
        let head = 0, tail = 0;
        q[tail++] = i;
        let count = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        while (head < tail) {
          const cur = q[head++]; count++;
          const cxx = cur % w, cyy = (cur / w) | 0;
          if (cxx < minX) minX = cxx; if (cxx > maxX) maxX = cxx;
          if (cyy < minY) minY = cyy; if (cyy > maxY) maxY = cyy;
          if (cxx > 0) { const ni = cur - 1; if (comp[ni] === -1 && TER[world.terrain[ni]].pass) { comp[ni] = cid; q[tail++] = ni; } }
          if (cxx < w - 1) { const ni = cur + 1; if (comp[ni] === -1 && TER[world.terrain[ni]].pass) { comp[ni] = cid; q[tail++] = ni; } }
          if (cyy > 0) { const ni = cur - w; if (comp[ni] === -1 && TER[world.terrain[ni]].pass) { comp[ni] = cid; q[tail++] = ni; } }
          if (cyy < h - 1) { const ni = cur + w; if (comp[ni] === -1 && TER[world.terrain[ni]].pass) { comp[ni] = cid; q[tail++] = ni; } }
        }
        comps.push({ id: cid, count, minX, maxX, minY, maxY });
        cid++;
      }
    }
    comps.sort((a, b) => b.count - a.count);
    world.landComponents = comps;
    const mainComp = comps.length ? comps[0].id : -1;
    if (onProgress) onProgress(0.48);

    // Score settlement sites in the largest region.
    const wanted = U.clamp((settings.aiCount || 4) + 1, 2, 8);
    const margin = 14;
    const candidates = [];
    for (let y = margin; y < h - margin; y += 2) {
      for (let x = margin; x < w - margin; x += 2) {
        const i = y * w + x;
        if (comp[i] !== mainComp) continue;
        const t = world.terrain[i];
        if (t === 6 || t === 2) continue;
        // Hall footprint and a little breathing room must be dry land.
        let bad = false;
        for (let dy = -2; dy <= 2 && !bad; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (!world.inBounds(nx, ny)) { bad = true; break; }
            const td = TER[world.terrain[ny * w + nx]];
            if (!td.pass || td.mountain) { bad = true; break; }
          }
        }
        if (bad) continue;
        let forest = 0, hills = 0, flat = 0, water = 0, mountain = 0;
        for (let dy = -8; dy <= 8; dy++) {
          for (let dx = -8; dx <= 8; dx++) {
            const nx = x + dx, ny = y + dy;
            if (!world.inBounds(nx, ny)) continue;
            const tt = world.terrain[ny * w + nx];
            if (tt === 4) forest++;
            else if (tt === 5) hills++;
            else if (tt === 3) flat++;
            if (tt === 0 || tt === 1) water++;
            if (tt === 6) mountain++;
          }
        }
        if (forest < 6) continue;
        let score = 0;
        score += Math.min(forest, 52) * 0.7;
        score += Math.min(flat, 50) * 0.45;
        score += Math.min(water, 26) * 0.42;
        score += Math.min(hills, 20) * 0.18;
        score += Math.min(mountain, 10) * 0.24;
        score -= Math.abs(x - w * 0.5) * 0.012 + Math.abs(y - h * 0.5) * 0.016;
        score += rng.float(-3, 3);
        candidates.push({ x, y, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = [];
    const minDists = [30, 27, 24, 21, 18, 15, 12];
    for (const minD of minDists) {
      for (const c of candidates) {
        if (chosen.length >= wanted) break;
        if (chosen.every((s) => U.dist(s.x, s.y, c.x, c.y) >= minD)) chosen.push(c);
      }
      if (chosen.length >= wanted) break;
    }
    while (chosen.length < wanted && candidates.length) {
      chosen.push(candidates[chosen.length % candidates.length]);
    }
    world.starts = chosen.slice(0, wanted).map((c, i) => ({ x: c.x, y: c.y, score: c.score, index: i }));

    // Clear a small, irregular village green around each starting hall rather than
    // a perfect square, so the first settlement sits naturally in the landscape.
    for (const s of world.starts) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = s.x + dx, ny = s.y + dy;
          if (!world.inBounds(nx, ny)) continue;
          const wobble = 0.65 + noiseClear.value(nx * 0.55, ny * 0.55) * 1.25;
          if (Math.hypot(dx, dy) > 3.35 + wobble * 0.28) continue;
          const i = ny * w + nx;
          if (world.terrain[i] === 0 || world.terrain[i] === 1 || world.terrain[i] === 2) continue;
          if (world.terrain[i] === 6) world.terrain[i] = 5;
          if (world.terrain[i] === 4) world.terrain[i] = 3;
        }
      }
    }
    if (onProgress) onProgress(0.6);

    // Natural resource points.
    const rngNodes = new U.RNG(seedNum ^ 0x1b2c3d4e);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = world.terrain[y * w + x];
        if (t === 4) {
          if (rngNodes.chance(0.38)) world.addNode('tree', x, y, rngNodes.float(0.6, 1));
        } else if (t === 3) {
          if (rngNodes.chance(0.026) && world.hasAdjacentWater(x, y, 1) === false) {
            // shrubby berry patches occasionally dot open meadow
            if (rngNodes.chance(0.45)) world.addNode('berry', x, y, rngNodes.float(0.6, 1));
          } else if (rngNodes.chance(0.012) && world.findNodesNear(x, y, 3, 'tree').length > 2) {
            world.addNode('tree', x, y, rngNodes.float(0.5, 0.9));
          }
        } else if (t === 5) {
          const roll = rngNodes.next();
          if (roll < 0.028) world.addNode('iron', x, y, rngNodes.float(0.65, 1));
          else if (roll < 0.04) world.addNode('silver', x, y, rngNodes.float(0.6, 1));
          else if (roll < 0.045) world.addNode('gold', x, y, rngNodes.float(0.5, 0.95));
          else if (roll < 0.068) world.addNode('berry', x, y, rngNodes.float(0.5, 0.9));
        }
        if (rngNodes.chance(0.0009) && t === 4) world.addNode('berry', x, y, 0.8);
      }
    }
    if (onProgress) onProgress(0.72);

    // Guarantee a viable and roughly fair opening region for every realm.
    for (const s of world.starts) {
      // clear the hall's footprint and a small plaza
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = s.x + dx, ny = s.y + dy;
          if (!world.inBounds(nx, ny)) continue;
          const nd = world.nodeAt(nx, ny);
          if (nd) world.removeNode(nd);
        }
      }
      const ringPoint = (minR, maxR, type) => {
        for (let tries = 0; tries < 40; tries++) {
          const ang = rngNodes.next() * Math.PI * 2;
          const r = rngNodes.float(minR, maxR);
          const x = Math.round(s.x + Math.cos(ang) * r);
          const y = Math.round(s.y + Math.sin(ang) * r);
          if (!world.inBounds(x, y)) continue;
          const td = world.terrainDef(x, y);
          if (!td.pass || td.mountain) continue;
          if (world.nodeAt(x, y)) continue;
          if (type === 'iron' && !world.isMountain(x, y) && world.mountainNear(x, y, 3) === false && tries < 30) continue;
          return world.addNode(type, x, y, 0.9);
        }
        return null;
      };
      for (let i = 0; i < 7; i++) ringPoint(3.4, 7.5, 'tree');
      for (let i = 0; i < 3; i++) ringPoint(3, 6.5, 'berry');
      ringPoint(6.5, 10, 'iron');
      if (rngNodes.chance(0.5)) ringPoint(8, 12, 'silver');
      if (rngNodes.chance(0.25)) ringPoint(9, 13, 'gold');
    }
    if (onProgress) onProgress(0.84);

    // A few extra berry patches near forests to make gathering natural.
    for (let i = 0; i < Math.floor((w * h) / 1800); i++) {
      const x = rngNodes.int(2, w - 3), y = rngNodes.int(2, h - 3);
      const t = world.terrain[y * w + x];
      if (t === 3 || t === 4) {
        if (!world.nodeAt(x, y) && world.findNodesNear(x, y, 3, 'tree').length > 1) {
          world.addNode('berry', x, y, rngNodes.float(0.5, 0.9));
        }
      }
    }

    // Record a tiny palette for each start's eventual banner (game assigns colors).
    if (onProgress) onProgress(1);
    return world;
  };

  MapGen.applyOverrides = function (world, overrides) {
    if (!overrides) return;
    const byId = new Map(world.nodes.map((n) => [n.id, n]));
    for (const [id, o] of Object.entries(overrides)) {
      const n = byId.get(id);
      if (!n) continue;
      if (!o.alive) {
        world.removeNode(n);
      } else {
        n.amount = U.clamp(Number(o.a) || 0, 0, n.max);
        n.regenMul = Number(o.r) || 1;
        n.alive = true;
        world.nodeGrid[world.idx(n.x, n.y)] = world.nodes.indexOf(n);
      }
    }
  };

  WW.World = World;
  WW.MapGen = MapGen;
})();
