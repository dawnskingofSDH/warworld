/* WARWORLD — grid pathfinding and walkability. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;

  class MinHeap {
    constructor() { this.items = []; this.keys = []; }
    get size() { return this.items.length; }
    push(item, key) {
      let i = this.items.length;
      this.items.push(item); this.keys.push(key);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.keys[p] <= this.keys[i]) break;
        [this.items[p], this.items[i]] = [this.items[i], this.items[p]];
        [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
        i = p;
      }
    }
    pop() {
      const top = this.items[0];
      const lastI = this.items.length - 1;
      if (lastI === 0) { this.items.pop(); this.keys.pop(); return top; }
      this.items[0] = this.items[lastI];
      this.keys[0] = this.keys[lastI];
      this.items.pop(); this.keys.pop();
      let i = 0;
      const n = this.items.length;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < n && this.keys[l] < this.keys[s]) s = l;
        if (r < n && this.keys[r] < this.keys[s]) s = r;
        if (s === i) break;
        [this.items[s], this.items[i]] = [this.items[i], this.items[s]];
        [this.keys[s], this.keys[i]] = [this.keys[i], this.keys[s]];
        i = s;
      }
      return top;
    }
  }

  class Pathfinder {
    constructor(world) {
      this.world = world;
      this.w = world.w;
      this.h = world.h;
      this.size = this.w * this.h;
      this.blocked = new Uint8Array(this.size);
      this.shipBlocked = new Uint8Array(this.size);
      this.g = new Float32Array(this.size);
      this.came = new Int32Array(this.size);
      this.stamp = new Uint32Array(this.size);
      this.closed = new Uint32Array(this.size);
      this.run = 0;
      this.road = new Uint8Array(this.size);
      this.bridge = new Uint8Array(this.size);
      this.tunnel = new Uint8Array(this.size);
      this.version = 0;
      this.rebuildAll(null);
    }
    idx(x, y) { return y * this.w + x; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

    rebuildAll(game) {
      this.blocked.fill(0);
      this.shipBlocked.fill(0);
      this.road.fill(0);
      this.bridge.fill(0);
      this.tunnel.fill(0);
      if (game) {
        for (const b of game.buildings) {
          if (b.dead) continue;
          if (b.defId === 'road') {
            for (let y = b.y; y < b.y + b.def.foot[1]; y++)
              for (let x = b.x; x < b.x + b.def.foot[0]; x++)
                if (this.inBounds(x, y)) this.road[this.idx(x, y)] = 1;
            continue;
          }
          if (b.defId === 'bridge' && b.complete) {
            this.bridge[this.idx(b.x, b.y)] = 1;
            continue;
          }
          if (b.defId === 'tunnel' && b.complete) {
            this.tunnel[this.idx(b.x, b.y)] = 1;
            continue;
          }
          if (b.defId === 'gate') {
            if (!b.open) {
              this.blocked[this.idx(b.x, b.y)] = 1;
              this.shipBlocked[this.idx(b.x, b.y)] = 1;
            }
            continue;
          }
          for (let y = b.y; y < b.y + b.def.foot[1]; y++) {
            for (let x = b.x; x < b.x + b.def.foot[0]; x++) {
              if (this.inBounds(x, y)) {
                this.blocked[this.idx(x, y)] = 1;
                this.shipBlocked[this.idx(x, y)] = 1;
              }
            }
          }
        }
      }
      this.version++;
    }

    isWalkable(x, y, ship) {
      if (!this.inBounds(x, y)) return false;
      const i = this.idx(x, y);
      const t = this.world.terrain[i];
      if (ship) {
        if (!D.WATER_IDS.includes(t)) return false;
        if (this.shipBlocked[i]) return false;
        if (this.bridge[i]) return false;
        return true;
      }
      if (this.blocked[i]) return false;
      if (this.bridge[i] || this.tunnel[i]) return true;
      const td = D.TERRAIN[t];
      return !!td.pass;
    }

    tileCost(x, y, ship) {
      if (!this.inBounds(x, y)) return Infinity;
      const i = this.idx(x, y);
      if (ship) return 1;
      if (this.bridge[i] || this.tunnel[i]) return 1;
      if (this.road[i]) return 0.7;
      const t = D.TERRAIN[this.world.terrain[i]];
      if (!t.pass) return Infinity;
      return 1 / Math.max(0.2, t.speed);
    }

    findPath(sx, sy, tx, ty, opts) {
      opts = opts || {};
      const ship = !!opts.ship;
      sx = Math.round(sx); sy = Math.round(sy); tx = Math.round(tx); ty = Math.round(ty);
      if (!this.inBounds(sx, sy) || !this.inBounds(tx, ty)) return null;
      if (sx === tx && sy === ty) return [{ x: tx, y: ty }];
      if (!this.isWalkable(tx, ty, ship)) {
        if (!opts.allowBlockedGoal) return null;
      }
      const world = this.world;
      const run = ++this.run;
      const start = sy * this.w + sx;
      const goal = ty * this.w + tx;
      const open = new MinHeap();
      this.g[start] = 0;
      this.came[start] = -1;
      this.stamp[start] = run;
      open.push(start, 0);
      const maxIter = opts.maxIter || 38000;
      let iter = 0;
      let nearest = start, nearestH = Infinity;
      while (open.size && iter++ < maxIter) {
        const cur = open.pop();
        if (this.closed[cur] === run) continue;
        this.closed[cur] = run;
        if (cur === goal) {
          const path = [];
          let n = cur;
          let guard = 0;
          while (n !== start && guard++ < 5000) {
            path.push({ x: n % this.w, y: (n / this.w) | 0 });
            n = this.came[n];
            if (n < 0) break;
          }
          path.reverse();
          return path;
        }
        const cx = cur % this.w, cy = (cur / this.w) | 0;
        const dxg = tx - cx, dyg = ty - cy;
        const hcur = Math.max(Math.abs(dxg), Math.abs(dyg)) + 0.414 * Math.min(Math.abs(dxg), Math.abs(dyg));
        if (hcur < nearestH) { nearestH = hcur; nearest = cur; }
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (!this.isWalkable(nx, ny, ship)) continue;
            if (dx && dy) {
              // Do not squeeze diagonally through terrain corners.
              if (!this.isWalkable(cx + dx, cy, ship) || !this.isWalkable(cx, cy + dy, ship)) continue;
              if (this.blocked[this.idx(cx + dx, cy)] && this.blocked[this.idx(cx, cy + dy)]) continue;
            }
            const ni = ny * this.w + nx;
            if (this.closed[ni] === run) continue;
            const c = this.tileCost(nx, ny, ship) * (dx && dy ? 1.414 : 1);
            const ng = this.g[cur] + c;
            if (this.stamp[ni] !== run || ng < this.g[ni]) {
              this.stamp[ni] = run;
              this.g[ni] = ng;
              this.came[ni] = cur;
              const h = Math.max(Math.abs(tx - nx), Math.abs(ty - ny)) + 0.414 * Math.min(Math.abs(tx - nx), Math.abs(ty - ny));
              open.push(ni, ng + h * 0.85);
            }
          }
        }
      }
      if (opts.allowPartial && nearest !== start) {
        const path = [];
        let n = nearest;
        let guard = 0;
        while (n !== start && guard++ < 5000) {
          path.push({ x: n % this.w, y: (n / this.w) | 0 });
          n = this.came[n];
          if (n < 0) break;
        }
        path.reverse();
        return path;
      }
      return null;
    }

    findNearestWalkable(tx, ty, fromX, fromY, ship, maxR) {
      tx = Math.round(tx); ty = Math.round(ty);
      maxR = maxR || 12;
      if (this.isWalkable(tx, ty, ship)) return { x: tx, y: ty };
      let best = null, bestD = Infinity;
      for (let r = 1; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = tx + dx, y = ty + dy;
            if (!this.isWalkable(x, y, ship)) continue;
            const d = fromX != null ? U.dist2(fromX, fromY, x, y) : U.dist2(tx, ty, x, y);
            if (d < bestD) { bestD = d; best = { x, y }; }
          }
        }
        if (best) return best;
      }
      return null;
    }

    findNearestWater(tx, ty, maxR) {
      maxR = maxR || 10;
      if (this.isWalkable(tx, ty, true)) return { x: tx, y: ty };
      for (let r = 1; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = tx + dx, y = ty + dy;
            if (this.isWalkable(x, y, true)) return { x, y };
          }
        }
      }
      return null;
    }

    hasWaterAdjacent(x, y, w, h) {
      for (let dy = -1; dy <= h; dy++) {
        for (let dx = -1; dx <= w; dx++) {
          const border = dx === -1 || dy === -1 || dx === w || dy === h;
          if (!border) continue;
          const nx = x + dx, ny = y + dy;
          if (this.world.isWater(nx, ny)) return true;
        }
      }
      return false;
    }

    // Returns whether a direct straight line is blocked. Used for cosmetic shots.
    lineOfSight(x0, y0, x1, y1) {
      const pts = U.lineTiles(x0, y0, x1, y1);
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        if (!this.inBounds(p.x, p.y)) return false;
        const t = this.world.terrain[this.idx(p.x, p.y)];
        if (D.TERRAIN[t].mountain) return false;
      }
      return true;
    }

    pathSpeedMultiplier(x, y, ship) {
      if (!this.inBounds(x, y)) return 1;
      const i = this.idx(x, y);
      if (ship) return 1;
      if (this.road[i]) return 1.35;
      const t = this.world.terrain[i];
      const td = D.TERRAIN[t];
      return td && td.speed ? td.speed : 1;
    }
  }

  WW.Pathfinder = Pathfinder;
})();
