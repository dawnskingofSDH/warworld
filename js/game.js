/* WARWORLD — game simulation: realm, economy, construction, units, war, diplomacy, AI. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;

  const APPROACH_DIRS = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) APPROACH_DIRS.push({ dx, dy });

  class Game {
    constructor(settings, saved, onProgress) {
      this.settings = Object.assign({
        playerName: '', mapSize: 'vast', aiCount: 4, difficulty: 'normal', seed: null, tutorial: true
      }, settings || {});
      this.seed = (saved && saved.seed) || String(this.settings.seed == null ? Date.now() : this.settings.seed);
      this.world = WW.MapGen.generate(this.settings, onProgress);
      if (saved && saved.nodeOverrides) WW.MapGen.applyOverrides(this.world, saved.nodeOverrides);
      this.path = new WW.Pathfinder(this.world);
      this.timeDays = 0;
      this.dayAccumulator = 0;
      this.rng = new U.RNG(this.seed + ':game');
      this._emitter = new U.Emitter();
      this.counters = {};
      this.factions = [];
      this.settlements = [];
      this.buildings = [];
      this.units = [];
      this.wars = [];
      this.alliances = [];
      this.vassals = [];
      this.tradeDeals = [];
      this.pendingPrompts = [];
      this.notifications = [];
      this.projectiles = [];
      this.effects = [];
      this.playerFactionId = null;
      this.eliminatedFactions = [];
      this.nodeBoostTimer = 0;
      this.aiThinkTimer = 0;
      this.siegeEffects = new Map();
      this.timeScale = 1;
      this.chronicleUnread = 0;
      this.tutorial = { step: 0, completed: {} };
      if (saved) {
        this._restore(saved);
      } else {
        this._initNew(onProgress);
      }
      this.path.rebuildAll(this);
      this.recomputeModifiersAll();
      this.updateAllRanks();
      this.refreshNodeBoosts();
    }

    // ----- events / basics -----
    on(name, fn) { this._emitter.on(name, fn); return this; }
    emit(name, ...args) { this._emitter.emit(name, ...args); }
    nextId(prefix) {
      this.counters[prefix] = (this.counters[prefix] || 0) + 1;
      return prefix + this.counters[prefix];
    }
    get player() { return this.getFaction(this.playerFactionId); }
    getFaction(id) { return this.factions.find((f) => f.id === id) || null; }
    getSettlement(id) { return this.settlements.find((s) => s.id === id) || null; }
    getBuilding(id) { return this.buildings.find((b) => b.id === id) || null; }
    getUnit(id) { return this.units.find((u) => u.id === id) || null; }
    isPlayerFaction(id) { return id === this.playerFactionId; }
    isAliveFaction(f) { return f && !f.eliminated; }
    ownedSettlements(fid) { return this.settlements.filter((s) => s.owner === fid && !s.ruined); }
    ownedBuildings(fid) { return this.buildings.filter((b) => b.owner === fid); }
    settlementBuildings(sid) { return this.buildings.filter((b) => b.settlementId === sid && !b.dead); }
    factionUnits(fid, includeShips) {
      return this.units.filter((u) => u.owner === fid && (includeShips || !u.isShip));
    }
    livingPopulation(fid) { return this.units.filter((u) => u.owner === fid && !u.isShip).length; }
    hallOf(settlement) { return this.getBuilding(settlement.hallId); }
    primaryHall(settlement) {
      const hall = this.hallOf(settlement);
      if (hall) return hall;
      return this.settlementBuildings(settlement.id).find((b) => b.defId === 'hall') || null;
    }
    capitalOf(fid) {
      const s = this.ownedSettlements(fid).find((x) => x.stage === 4);
      return s || null;
    }
    unitCount(fid) { return this.factionUnits(fid, true).length; }
    factionPopCap(fid) {
      let cap = 0;
      for (const b of this.buildings) {
        if (b.owner !== fid || !b.complete || b.dead) continue;
        if (b.defId === 'hall') cap += (b.def.popBonus ? b.def.popBonus[b.level] : 0) || 0;
        if (b.defId === 'house') cap += (b.def.popByLevel ? b.def.popByLevel[b.level] : 0) || 0;
      }
      return cap;
    }
    canGrowPopulation(fid) { return this.livingPopulation(fid) < this.factionPopCap(fid); }

    notify(text, type, opts) {
      opts = opts || {};
      const notice = {
        id: this.nextId('n'), time: this.timeDays, text,
        type: type || 'info', important: !!opts.important, settlementId: opts.settlementId || null
      };
      this.notifications.push(notice);
      if (this.notifications.length > 260) this.notifications.splice(0, this.notifications.length - 260);
      this.chronicleUnread++;
      this.emit('notice', notice);
      return notice;
    }
    sfx(name, x, y) { this.emit('sfx', name, x, y); }

    // ----- initialisation -----
    _initNew(onProgress) {
      const rng = this.rng;
      const count = this.world.starts.length;
      const names = U.shuffle(D.factionNames.filter((n) => n !== this.settings.playerName), rng);
      const palettes = U.shuffle(D.crestPalettes, rng);
      const symbols = U.shuffle(D.crestSymbols, rng);
      const usedNames = new Set();
      for (let i = 0; i < count; i++) {
        const isPlayer = i === 0;
        let name;
        if (isPlayer) {
          name = String(this.settings.playerName || '').trim().slice(0, 16);
          if (!name) name = names[i] || '无名之地';
        } else {
          name = names[i] || '无名之地';
        }
        if (usedNames.has(name)) name = name + U.choice(['堡', '地', '邦'], rng);
        usedNames.add(name);
        const palette = palettes[i % palettes.length];
        const faction = {
          id: this.nextId('f'),
          name,
          isPlayer,
          colors: { primary: palette.primary, secondary: palette.secondary, accent: palette.accent },
          crest: symbols[i % symbols.length],
          rank: 1,
          relations: {},
          techs: [],
          modifiers: {},
          activeResearch: null,
          casusBelli: [],
          truces: {},
          ai: isPlayer ? null : {
            nextThink: rng.float(2, 7), nextWar: rng.float(22, 43), nextDiplomacy: rng.float(8, 18),
            nextColony: rng.float(70, 120), aggression: D.DIFFICULTIES[this.settings.difficulty].aiAggro * rng.float(0.82, 1.2),
            eco: D.DIFFICULTIES[this.settings.difficulty].aiEco * rng.float(0.9, 1.08),
            targetSettlement: null, armyTarget: null, armyOrderDay: 0
          },
          eliminated: false,
          joinedWarSupport: 0
        };
        this.factions.push(faction);
      }
      this.playerFactionId = this.factions[0].id;
      for (const f of this.factions) {
        for (const o of this.factions) {
          if (o.id === f.id) continue;
          f.relations[o.id] = Math.round(rng.float(46, 58));
        }
      }
      const namePool = U.shuffle(D.settlementNames, rng);
      let sn = 0;
      for (let i = 0; i < this.factions.length; i++) {
        const f = this.factions[i];
        const st = this.world.starts[i];
        let name = namePool[sn++] || ('新村' + sn);
        const existing = new Set(this.settlements.map((s) => s.name));
        while (existing.has(name)) name = namePool[sn++] || ('新村' + sn);
        const settlement = {
          id: this.nextId('s'), name, owner: f.id, x: st.x, y: st.y,
          stage: 1, resources: Object.assign({}, D.INITIAL_RESOURCES),
          stability: 72, shortage: false, aidCooldown: 0, founded: 0,
          hallId: null, ruined: false, occupiedUntil: 0, lastOwner: null,
          legend: ''
        };
        // difficulty tints AI opening supplies only very slightly
        if (!f.isPlayer) {
          const mult = D.DIFFICULTIES[this.settings.difficulty].aiStart;
          for (const k of D.RES_KEYS) settlement.resources[k] = Math.round(settlement.resources[k] * mult);
        }
        this.settlements.push(settlement);
        const hall = this._createBuilding('hall', f.id, settlement, st.x - 1, st.y - 1, 1, true);
        settlement.hallId = hall.id;
        settlement.founded = 0;
        this._spawnStartResidents(f, settlement, 5);
      }
      this.notify('编年史翻开新的一页。你的旗帜第一次在荒野上升起。', 'important', { important: true });
      this.notify('从五名居民开始，建立属于你的王朝。按 H 查看完整的王国法典。', 'tutorial');
      this.updateAllRanks(true);
      if (onProgress) onProgress(1);
    }

    _spawnStartResidents(faction, settlement, n) {
      const hall = this.primaryHall(settlement);
      for (let i = 0; i < n; i++) {
        const p = hall ? this._freeTileNear(hall.x + 1, hall.y + 1, 1.2 + i * 0.1) : { x: settlement.x, y: settlement.y };
        this._spawnUnit('resident', faction.id, settlement.id, p.x + 0.5, p.y + 0.5);
      }
    }

    _createBuilding(defId, owner, settlement, x, y, level, complete, opts) {
      const def = D.BUILD[defId];
      opts = opts || {};
      const b = {
        id: this.nextId('b'), defId, def, owner, settlementId: settlement ? settlement.id : null,
        x, y, level: level || 1, complete: !!complete,
        hp: 0, maxHp: D.buildingHp(def, level || 1),
        workers: [], constructors: [], repairers: [], patients: [], trainingQueue: [],
        buildProgress: 0, buildRequired: D.buildingDays(def, level || 1),
        upgrade: null, recipe: 'iron', open: true, growthProgress: 0,
        lastAttacker: null, lastAttackerUnit: null, dead: false, builtAt: this.timeDays,
        capturedAt: 0, active: opts.active !== false, aiProgressPaused: false
      };
      if (!complete) {
        b.hp = Math.round(b.maxHp * 0.25);
        if (opts.progress) b.buildProgress = Math.min(b.buildRequired, opts.progress);
      } else {
        b.hp = b.maxHp;
      }
      this.buildings.push(b);
      return b;
    }

    _spawnUnit(kind, ownerId, settlementId, x, y, extra) {
      const def = D.UNITS[kind];
      if (!def) return null;
      const u = Object.assign({
        id: this.nextId('u'), kind, def, owner: ownerId, homeSettlement: settlementId || null,
        x, y, hp: def.hp, maxHp: def.hp,
        state: 'idle', path: [], pathIndex: 0, facing: 0,
        carry: {}, bonus: {}, cargo: {},
        task: null, order: null, target: null, attackCooldown: 0,
        thought: 0, lastDamaged: -999, lastHeal: 0, shipId: null,
        workers: [], buildingId: null, alive: true, isShip: !!def.isShip,
        passengers: [], cargoCapacity: def.carry || 0, createdAt: this.timeDays,
        dead: false, moveGoal: null, aiTarget: null
      }, extra || {});
      if (u.isShip) { u.passengers = []; u.cargo = {}; }
      // tech-enhanced starting health
      if (!u.isShip) {
        const f = this.getFaction(ownerId);
        const mod = this._mod(f);
        if (f && def.military) {
          const hpMul = 1 + (mod.hp || 0) + (def.cavalry ? (mod.cavHp || 0) : 0);
          u.maxHp = Math.round(def.hp * hpMul);
          u.hp = u.maxHp;
        }
        if (def.cls === 'civilian') { u.cargoCapacity = Math.round((def.carry || 0) * (1 + (mod.merchantCap || 0))); }
      }
      this.units.push(u);
      return u;
    }

    // ----- resource helpers -----
    getStorageCaps(settlement) {
      const warehouses = this.buildings.filter((b) => b.settlementId === settlement.id && b.defId === 'warehouse' && b.complete && !b.dead);
      const caps = D.storageCaps(settlement, warehouses);
      const f = this.getFaction(settlement.owner);
      const mod = this._mod(f);
      if (mod.storage) for (const k of D.RES_KEYS) caps[k] = Math.round(caps[k] * (1 + mod.storage));
      return caps;
    }
    getResourceCap(settlement, res) {
      return this.getStorageCaps(settlement)[res] || 0;
    }
    addResource(settlement, res, amount) {
      if (!settlement || amount <= 0 || !D.RES[res]) return 0;
      const cap = this.getStorageCaps(settlement)[res];
      const current = settlement.resources[res] || 0;
      const add = Math.max(0, Math.min(amount, cap - current));
      settlement.resources[res] = current + add;
      return add;
    }
    removeResource(settlement, res, amount) {
      if (!settlement) return 0;
      const current = settlement.resources[res] || 0;
      const use = Math.max(0, Math.min(amount, current));
      settlement.resources[res] = current - use;
      return use;
    }
    canAfford(settlement, cost) {
      if (!settlement) return false;
      for (const [k, v] of Object.entries(cost || {})) {
        if ((settlement.resources[k] || 0) + 1e-6 < v) return false;
      }
      return true;
    }
    payCost(settlement, cost) {
      if (!this.canAfford(settlement, cost)) return false;
      for (const [k, v] of Object.entries(cost || {})) settlement.resources[k] -= v;
      return true;
    }
    refundCost(settlement, cost, ratio) {
      for (const [k, v] of Object.entries(cost || {})) this.addResource(settlement, k, v * (ratio == null ? 1 : ratio));
    }
    canAddPop(fid) { return this.livingPopulation(fid) < this.factionPopCap(fid); }

    // ----- faction tech / ranks -----
    _mod(faction) { return (faction && faction.modifiers) || {}; }
    recomputeModifiersAll() { for (const f of this.factions) this.recomputeModifiers(f); }
    recomputeModifiers(faction) {
      if (!faction) return;
      const mod = {};
      for (const id of faction.techs || []) {
        const tech = D.TECHS[id];
        if (!tech) continue;
        for (const [k, v] of Object.entries(tech.effects)) {
          if (k === 'stability' || k === 'armor') mod[k] = (mod[k] || 0) + v;
          else mod[k] = (mod[k] || 0) + v;
        }
      }
      faction.modifiers = mod;
    }
    updateAllRanks(silent) {
      for (const f of this.factions) this.updateRank(f, silent);
    }
    updateRank(faction, silent) {
      if (!faction) return;
      const old = faction.rank;
      let rank = 0;
      for (const s of this.ownedSettlements(faction.id)) {
        rank = Math.max(rank, s.stage || 1);
      }
      faction.rank = rank;
      if (!silent && old !== rank && rank > 0) {
        const player = faction.id === this.playerFactionId;
        this.notify(`${D.realmFullName(faction)}的国势发生了变化：现在称为${D.RANK_NAMES[rank]}。`, player ? 'rank' : 'world', { important: player });
        this.emit('rankup', faction, old, rank);
      }
    }
    refreshSettlementStage(settlement) {
      const hall = this.primaryHall(settlement);
      if (!hall || hall.dead) { settlement.stage = 0; return; }
      settlement.stage = hall.complete ? hall.level : Math.max(1, settlement.stage);
      for (const b of this.buildings) if (b.upgrade) this._refreshConstruction(b);
      this.updateRank(this.getFaction(settlement.owner));
    }

    // ----- geometry / approach -----
    buildingCenter(b) {
      return { x: b.x + b.def.foot[0] / 2, y: b.y + b.def.foot[1] / 2 };
    }
    settlementCenter(s) {
      const h = this.primaryHall(s);
      return h ? this.buildingCenter(h) : { x: s.x + 0.5, y: s.y + 0.5 };
    }
    distanceToBuilding(x, y, b) {
      const x1 = b.x, y1 = b.y, x2 = b.x + b.def.foot[0], y2 = b.y + b.def.foot[1];
      const cx = U.clamp(x, x1, x2), cy = U.clamp(y, y1, y2);
      return Math.hypot(x - cx, y - cy);
    }
    approachTileForBuilding(b, fromX, fromY, maxExtra) {
      const out = [];
      const fx = b.def.foot[0], fy = b.def.foot[1];
      for (let x = b.x - 1; x <= b.x + fx; x++) {
        for (let y = b.y - 1; y <= b.y + fy; y++) {
          const onBorder = x < b.x || y < b.y || x >= b.x + fx || y >= b.y + fy;
          if (!onBorder) continue;
          if (!this.path.isWalkable(x, y, false)) continue;
          out.push({ x, y, d: U.dist2(fromX, fromY, x, y) });
        }
      }
      if (!out.length) {
        for (let r = 2; r <= 5; r++) {
          for (const p of this._ringTiles(Math.round(b.x + fx / 2), Math.round(b.y + fy / 2), r)) {
            if (this.path.isWalkable(p.x, p.y, false)) out.push({ x: p.x, y: p.y, d: U.dist2(fromX, fromY, p.x, p.y) });
          }
          if (out.length) break;
        }
      }
      out.sort((a, b2) => a.d - b2.d);
      return out[0] || null;
    }
    _ringTiles(cx, cy, r) {
      const out = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (this.world.inBounds(x, y)) out.push({ x, y });
        }
      }
      return out;
    }
    _freeTileNear(cx, cy, minR) {
      const start = Math.max(1, Math.ceil(minR || 0));
      for (let r = start; r < 20; r++) {
        const ring = this._ringTiles(cx, cy, r);
        for (const p of ring) {
          if (this.path.isWalkable(p.x, p.y, false)) {
            const occupied = this.units.some((u) => !u.isShip && !u.dead && Math.floor(u.x) === p.x && Math.floor(u.y) === p.y);
            if (!occupied) return p;
          }
        }
      }
      return { x: cx, y: cy };
    }
    _walkableNear(x, y, ship, maxR) {
      return this.path.findNearestWalkable(x, y, x, y, !!ship, maxR || 10);
    }
    _approachNode(node, fromX, fromY) {
      const candidates = [];
      for (const d of APPROACH_DIRS) {
        const x = node.x + d.dx, y = node.y + d.dy;
        if (this.path.isWalkable(x, y, false)) candidates.push({ x, y, d: U.dist2(fromX, fromY, x, y) });
      }
      candidates.sort((a, b) => a.d - b.d);
      return candidates[0] || { x: node.x, y: node.y };
    }
    isNodeMineable(kind) {
      return kind === 'tree' || kind === 'berry' || kind === 'iron' || kind === 'gold' || kind === 'silver';
    }

    // ----- occupancy / placement -----
    _buildingsAt(tx, ty, ignoreId) {
      return this.buildings.find((b) => {
        if (b.dead || b.id === ignoreId) return false;
        return tx >= b.x && ty >= b.y && tx < b.x + b.def.foot[0] && ty < b.y + b.def.foot[1];
      });
    }
    _insideSettlement(settlement, x, y) {
      const c = this.settlementCenter(settlement);
      const hall = this.primaryHall(settlement);
      const rad = hall && hall.complete && hall.def.radius ? hall.def.radius[hall.level] : 9;
      const half = 0; // footprint is checked separately
      return U.dist(c.x, c.y, x + half, y + half) <= rad;
    }
    requirementCheck(def, x, y, settlement, ignoreCost, levelOverride) {
      if (!settlement) return { ok: false, error: '尚未选择定居点' };
      const topLevel = levelOverride || levelForPlacement(def, settlement);
      const w = def.foot[0], h = def.foot[1];
      if (x < 0 || y < 0 || x + w > this.world.w || y + h > this.world.h) return { ok: false, error: '超出世界边界' };
      if (!def.buildOutside) {
        for (let yy = y; yy < y + h; yy++) {
          for (let xx = x; xx < x + w; xx++) {
            if (!this._insideSettlement(settlement, xx, yy)) return { ok: false, error: '必须建造在定居点领地内' };
          }
        }
      }
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const t = this.world.terrainDef(xx, yy);
          if (!t.pass) return { ok: false, error: t.water ? '无法在水面上建造' : '无法在高山上建造' };
          const nd = this.world.nodeAt(xx, yy);
          if (nd && nd.alive) return { ok: false, error: '需先清除此处的资源点' };
          if (this._buildingsAt(xx, yy)) return { ok: false, error: '此处已有建筑' };
        }
      }
      if (def.unique) {
        const existing = this.buildings.filter((b) => b.settlementId === settlement.id && b.defId === def.id && !b.dead);
        if (existing.length) return { ok: false, error: '每个定居点只能建造一座' + def.name };
      }
      if (def.requires) {
        const req = def.requires;
        let found = false;
        if (req.water) {
          found = this.world.hasAdjacentWater(x, y, Math.max(w, h) + (req.range || 1));
        } else if (req.type) {
          found = this.world.findNodesNear(x + w / 2, y + h / 2, (req.range || 3) + Math.max(w, h) / 2, req.type).some((n) => n.alive && n.amount > 0);
        }
        if (!found) return { ok: false, error: '必须靠近' + (req.label || req.type) };
      }
      if (def.requiresFarm) {
        const farm = this.buildings.some((b) => b.settlementId === settlement.id && b.defId === 'farm' && b.complete && !b.dead);
        if (!farm) return { ok: false, error: '本定居点必须先有农田' };
      }
      const cost = D.buildingCost(def, topLevel);
      if (!ignoreCost && cost && !this.canAfford(settlement, cost)) return { ok: false, error: '资源不足', cost };
      return { ok: true, cost, level: topLevel };
    }

    levelForSettlementBuilding(def, settlement) {
      let lvl = Math.min(settlement.stage || 1, def.maxLevel);
      lvl = Math.max(def.minLevel || 1, lvl);
      return lvl;
    }

    // ----- node boosts -----
    refreshNodeBoosts() {
      for (const n of this.world.nodes) {
        if (!n.alive) continue;
        n.gatherBoost = 1;
        n.regenMul = 1;
        n.herbBoost = 1;
        n.boostSource = null;
      }
      for (const b of this.buildings) {
        if (b.dead || !b.complete) continue;
        let type = null;
        if (b.defId === 'lumber') type = 'tree';
        else if (b.defId === 'gatherer') type = 'berry';
        else continue;
        if (!b.workers || !b.workers.length) continue;
        const def = b.def;
        const level = b.level;
        const boost = (def.regenBoost && def.regenBoost[level]) || 1.5;
        const cx = b.x + b.def.foot[0] / 2, cy = b.y + b.def.foot[1] / 2;
        for (const n of this.world.nodes) {
          if (!n.alive || n.type !== type) continue;
          if (U.dist(n.x + 0.5, n.y + 0.5, cx, cy) > 6.5) continue;
          if (boost > (n.gatherBoost || 1)) {
            n.gatherBoost = boost;
            n.regenMul = boost;
            n.boostSource = b.id;
          }
          if (type === 'berry') {
            const herbBoost = [1, 1.5, 1.75, 2.0, 2.25][level] || 1.5;
            n.herbBoost = Math.max(n.herbBoost || 1, herbBoost);
          }
        }
      }
      this.boostsLastRefresh = this.timeDays;
    }

    // ----- save / load -----
    toSave() {
      const plain = (o) => JSON.parse(JSON.stringify(o));
      const buildings = this.buildings.filter((b) => !b.dead).map((b) => {
        const copy = Object.assign({}, b);
        delete copy.def;
        return copy;
      });
      return {
        version: D.VERSION,
        savedAt: Date.now(),
        seed: this.seed,
        settings: this.settings,
        timeDays: this.timeDays,
        counters: this.counters,
        rngState: this.rng.state,
        playerFactionId: this.playerFactionId,
        factions: plain(this.factions),
        settlements: plain(this.settlements),
        buildings,
        units: this.units.filter((u) => !u.dead).map((u) => {
          const copy = Object.assign({}, u);
          delete copy.def;
          copy.path = [];
          copy.task = null;
          copy.order = u.order && u.order.type === 'move' ? null : u.order;
          if (copy.state === 'moving') copy.state = 'idle';
          return copy;
        }),
        wars: plain(this.wars),
        alliances: plain(this.alliances),
        vassals: plain(this.vassals),
        tradeDeals: plain(this.tradeDeals),
        pendingPrompts: plain(this.pendingPrompts),
        notifications: plain(this.notifications.slice(-160)),
        eliminatedFactions: this.eliminatedFactions.slice(),
        nodeOverrides: this.world.toJSONOverrides(),
        tutorial: plain(this.tutorial),
        chronicleUnread: this.chronicleUnread
      };
    }

    _restore(saved) {
      this.timeDays = saved.timeDays || 0;
      this.counters = saved.counters || {};
      this.rng.state = saved.rngState || this.rng.state;
      this.playerFactionId = saved.playerFactionId;
      this.factions = (saved.factions || []).map((f) => Object.assign({ modifiers: {} }, f));
      this.settlements = (saved.settlements || []).map((s) => Object.assign({}, s));
      this.buildings = (saved.buildings || []).map((b) => {
        Object.assign(b, { def: D.BUILD[b.defId], upgrade: b.upgrade || null, workers: b.workers || [], constructors: b.constructors || [], repairers: b.repairers || [], patients: b.patients || [], trainingQueue: b.trainingQueue || [], dead: false });
        return b;
      });
      this.units = (saved.units || []).map((u) => {
        const copy = Object.assign(u, { def: D.UNITS[u.kind] });
        copy.path = [];
        copy.dead = false;
        copy.alive = true;
        if (!copy.passengers) copy.passengers = [];
        if (!copy.carry) copy.carry = {};
        if (!copy.cargo) copy.cargo = {};
        if (!copy.bonus) copy.bonus = {};
        if (copy.state === 'moving' || copy.state === 'gathering') copy.state = 'idle';
        if (copy.state === 'inside' || copy.state === 'aboard') {
          // ensure references still exist
          if (copy.buildingId && !this.buildings.some((b) => b.id === copy.buildingId)) { copy.state = 'idle'; copy.buildingId = null; }
          if (copy.shipId && !this.units.some((u2) => u2.id === copy.shipId)) { copy.state = 'idle'; copy.shipId = null; }
        }
        return copy;
      });
      this.wars = (saved.wars || []).map((w) => Object.assign({}, w));
      this.alliances = saved.alliances || [];
      this.vassals = saved.vassals || [];
      this.tradeDeals = saved.tradeDeals || [];
      this.pendingPrompts = (saved.pendingPrompts || []).map((p) => Object.assign({}, p));
      this.notifications = (saved.notifications || []).map((n) => {
        if (!n.id) n.id = 'n' + (n.time || 0) + Math.random().toString(36).slice(2);
        return n;
      });
      this.eliminatedFactions = saved.eliminatedFactions || [];
      this.tutorial = saved.tutorial || { step: 0, completed: {} };
      this.chronicleUnread = saved.chronicleUnread || 0;
      this.siegeEffects = new Map();
      this.projectiles = [];
      this.effects = [];
      this.emit('load');
    }

    // convenience used by getStorageCaps; filled later with tech data
  }

  function levelForPlacement(def, settlement) {
    if (!settlement) return 1;
    let lvl = Math.min(settlement.stage || 1, def.maxLevel);
    lvl = Math.max(def.minLevel || 1, lvl);
    return lvl;
  }

  WW.Game = Game;
  WW.levelForPlacement = levelForPlacement;
})();
