/* WARWORLD — rival realms: economy, expansion, strategy, armies and diplomacy. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const P = WW.Game.prototype;

  P._aiUpdate = function (days) {
    for (const f of this.factions) {
      if (f.eliminated || !f.ai) continue;
      f.ai.nextThink = (f.ai.nextThink || 0) - days;
      if (f.ai.nextThink <= 0) {
        f.ai.nextThink = this.rng.float(2.5, 6.2) / Math.max(0.7, f.ai.eco);
        this._aiThink(f);
      }
    }
  };

  P._aiDayTick = function () {
    for (const f of this.factions) {
      if (f.eliminated || !f.ai) continue;
      f.ai.nextWar = (f.ai.nextWar || 999) - 1;
      f.ai.nextDiplomacy = (f.ai.nextDiplomacy || 999) - 1;
      f.ai.nextColony = (f.ai.nextColony || 999) - 1;
      if (f.ai.nextWar <= 0) {
        const result = this._aiConsiderWar(f);
        f.ai.nextWar = result && result.retry ? this.rng.float(10, 22) : this.rng.float(52, 105);
      }
      if (f.ai.nextDiplomacy <= 0) {
        this._aiDiplomacy(f);
        f.ai.nextDiplomacy = this.rng.float(25, 55);
      }
      if (f.ai.nextColony <= 0) {
        this._aiTryColonize(f);
        f.ai.nextColony = this.rng.float(80, 145);
      }
    }
  };

  P._aiThink = function (f) {
    if (f.eliminated) return;
    this._aiAssignJobs(f);
    const settlements = this.ownedSettlements(f.id);
    for (const s of settlements) {
      if (s.ruined) continue;
      this._aiSettlementAction(f, s);
      this._aiTrainAtSettlement(f, s);
    }
    this._aiResearch(f);
    this._aiMilitaryOrders(f);
  };

  P._aiOnBuildingComplete = function (b) {
    const f = this.getFaction(b.owner);
    if (!f || !f.ai) return;
    this._aiAssignJobs(f);
    if (b.defId === 'hall') this._aiAssignJobs(f);
  };

  // =========================================================
  // Labour
  // =========================================================
  P._aiAssignJobs = function (f) {
    const research = f.activeResearch ? D.TECHS[f.activeResearch.techId] : null;
    const researchBuildings = this.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.def.researchTier);
    if (research) {
      for (const b of researchBuildings) {
        if (b.def.researchTier !== research.tier) continue;
        this.assignWorkersInstantAI(b, 1);
      }
    }
    const prod = this.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && D.buildingSlots(b.def, b.level) > 0)
      .filter((b) => b.defId !== 'library' && b.defId !== 'university' && b.defId !== 'royalUniversity');
    // first spread one worker to each active workplace, then fill the best slots
    prod.sort((a, b) => {
      const priority = { farm: 0, fishery: 0, gatherer: 1, hunter: 1, lumber: 1, quarry: 2, ironMine: 2, silverMine: 3, goldMine: 3, smelter: 4, mint: 4, mill: 5 };
      return (priority[a.defId] == null ? 6 : priority[a.defId]) - (priority[b.defId] == null ? 6 : priority[b.defId]);
    });
    for (const b of prod) {
      if (!b.workers.length) this.assignWorkersInstantAI(b, 1);
    }
    for (const b of prod) {
      this.assignWorkersInstantAI(b);
    }
    if (research) {
      for (const b of researchBuildings) {
        if (b.def.researchTier === research.tier) this.assignWorkersInstantAI(b);
      }
    }
    // Scholars cannot be left with empty desks: pull a worker out of a fully staffed
    // production building if necessary so AI research actually progresses.
    if (research) {
      for (const b of researchBuildings) {
        if (b.def.researchTier !== research.tier) continue;
        if (b.workers && b.workers.length) continue;
        this.assignWorkersInstantAI(b, 1);
        if (b.workers && b.workers.length) continue;
        const sources = this.buildings.filter((x) => x.owner === f.id && x.complete && !x.dead && x.workers && x.workers.length > 1 &&
          !x.def.researchTier && x.defId !== 'market')
          .sort((a, b2) => b2.workers.length - a.workers.length);
        if (!sources.length) continue;
        const src = sources[0];
        const uid = src.workers.pop();
        const u = this.getUnit(uid);
        if (!u) continue;
        u.buildingId = b.id;
        u.state = 'inside';
        u.task = null;
        u.order = { type: 'work', buildingId: b.id };
        b.workers.push(uid);
        this.refreshNodeBoosts();
      }
    }
  };

  // =========================================================
  // Construction & expansion
  // =========================================================
  P._aiHasBuildingUnderConstruction = function (f, settlement, defId) {
    return this.buildings.some((b) => b.owner === f.id && b.settlementId === settlement.id && b.defId === defId && (!b.complete || b.upgrade) && !b.dead);
  };

  P._aiCount = function (f, settlement, defId) {
    return this.buildings.filter((b) => b.owner === f.id && b.settlementId === settlement.id && b.defId === defId && !b.dead).length;
  };

  P._aiSettlementAction = function (f, s) {
    const stage = s.stage || 1;
    const hall = this.primaryHall(s);
    if (hall && !hall.upgrade && !hall.converting) {
      // Essential buildings first. The hall upgrade is tempting, but starvation is fatal.
      const foodProd = (this._aiCount(f, s, 'farm') + this._aiCount(f, s, 'fishery') + this._aiCount(f, s, 'gatherer') + this._aiCount(f, s, 'hunter'));
      const woodProd = this._aiCount(f, s, 'lumber');
      const hasFood = s.resources.food > 40 || foodProd > 0;
      const hasWood = s.resources.wood > 35 || woodProd > 0;
      const target = Math.min(4, hall.level + 1);
      if (hall.level < 4 && hasFood && hasWood && s.stability > 52 && this.canAfford(s, D.upgradeCost(hall.def, target) || {}) &&
        !this.buildings.some((b) => b.owner === f.id && b.defId === 'hall' && b.upgrade)) {
        const targetLevel = hall.level + 1;
        if (targetLevel === 4 && this.capitalOf(f.id)) {
          // do not start a second Royal Palace
        } else {
          const r = this.startUpgrade(hall.id);
          if (r.ok) return;
        }
      }
    }

    const popFree = this.factionPopCap(f.id) - this.livingPopulation(f.id);
    const popAtCap = popFree <= 1;
    const categories = [];
    const count = (id) => this._aiCount(f, s, id);
    const constructing = (id) => this._aiHasBuildingUnderConstruction(f, s, id);
    const want = (id, priority, needed) => { if (needed && !constructing(id)) categories.push({ id, priority }); };

    // Stone is the choke point of every settlement: make certain a quarry exists before
    // spending the opening stock on houses and warehouses.
    if (count('quarry') < 1) want('quarry', 0, true);
    if (count('lumber') < 1) want('lumber', 0, true);
    if ((s.resources.food || 0) < 55 && count('farm') + count('fishery') + count('gatherer') + count('hunter') < 1) {
      if (this.world.hasAdjacentWater(s.x, s.y, 8)) want('fishery', 0, true);
      want('farm', 0, true);
    }
    // growth and food. Houses are kept deliberately limited so the realm can afford
    // halls, libraries, walls and armies rather than chasing an ever-growing population.
    const houseTarget = 2 + stage * 2;
    if (popAtCap && count('quarry') > 0 && count('lumber') > 0 && count('house') < houseTarget) want('house', 1, true);
    const foodProducers = count('farm') + count('fishery') + count('gatherer') + count('hunter');
    if (foodProducers < 1 + Math.floor(stage / 2)) {
      if (this.world.hasAdjacentWater(s.x, s.y, 8)) want('fishery', 1, true);
      if (this.world.findNodesNear(s.x, s.y, 12, 'berry').length) want('gatherer', 1, true);
      if (this.world.findNodesNear(s.x, s.y, 12, 'tree').length) want('hunter', 1, true);
      want('farm', 2, true);
    }
    const woodProducers = count('lumber');
    if (woodProducers < 1 + Math.floor(stage / 2)) want('lumber', 2, true);
    if (this.ownedSettlements(f.id).length && count('warehouse') < 1) want('warehouse', 3, true);
    if (count('barracks') < 1) want('barracks', 4, true);
    if (stage >= 2) {
      if (count('market') < 1) want('market', 3, true);
      if (count('smelter') < 1) want('smelter', 4, true);
      if (count('library') < 1) want('library', 5, true);
      if (count('tavern') < 1 && s.stability < 75) want('tavern', 5, true);
      if (count('archery') < 1) want('archery', 5, true);
      if (count('ironMine') < 1 && this._aiFindNodeInSettlement(s, 'iron')) want('ironMine', 4, true);
    }
    if (stage >= 3) {
      if (count('university') < 1) want('university', 5, true);
      if (count('stable') < 1) want('stable', 6, true);
      if (count('mint') < 1 && this.world.findNodesNear(s.x, s.y, 16, 'silver').length) want('mint', 6, true);
      if (count('hospital') < 1) want('hospital', 6, true);
      if (count('silverMine') < 1 && this._aiFindNodeInSettlement(s, 'silver')) want('silverMine', 5, true);
      if (count('goldMine') < 1 && this._aiFindNodeInSettlement(s, 'gold')) want('goldMine', 6, true);
    }
    if (stage >= 4) {
      if (count('royalUniversity') < 1) want('royalUniversity', 7, true);
      if (count('knightOrder') < 1) want('knightOrder', 7, true);
    }
    if (s.stability < 45 && count('church') < 1) want('church', 0, true);
    if (this.warsFor(f.id).length && count('tower') < 2) want('tower', 2, true);
    // Granaries, housing and a few extra producers for a mature realm.
    if (popAtCap && count('house') < houseTarget) want('house', 8, true);
    if (foodProducers < 2 + stage) want('farm', 9, true);
    if (woodProducers < 2 + stage) want('lumber', 9, true);
    if (count('warehouse') < 2 && stage >= 3) want('warehouse', 9, true);
    categories.sort((a, b) => a.priority - b.priority);
    for (const c of categories) {
      if (this._aiTryBuild(f, s, c.id)) return;
    }

    // Save for essential civic and scholarly buildings before spending on
    // optional improvements. Otherwise a realm can improve every hovel while
    // never finding the stone for its first library.
    const civicMissing = (stage >= 2 && (count('market') < 1 || count('smelter') < 1 || count('library') < 1)) ||
      (stage >= 3 && count('university') < 1);
    // Upgrade one existing productive building if the realm is prosperous.
    if (!civicMissing && s.stability > 58 && (s.resources.food || 0) > 60) {
      const candidates = this.buildings.filter((b) => b.owner === f.id && b.settlementId === s.id && b.complete && !b.upgrade && !b.dead &&
        b.level < b.def.maxLevel && b.defId !== 'hall' && b.level < stage && b.defId !== 'road' && b.defId !== 'bridge' && b.defId !== 'tunnel');
      if (candidates.length) {
        candidates.sort((a, b) => (b.defId === 'lumber' || b.defId === 'farm' || b.defId === 'warehouse' ? 1 : 0) - (a.defId === 'lumber' || a.defId === 'farm' || a.defId === 'warehouse' ? 1 : 0));
        const b = candidates[0];
        const cost = D.upgradeCost(b.def, b.level + 1);
        if (cost && this.canAfford(s, cost)) {
          const r = this.startUpgrade(b.id);
          if (r.ok) return;
        }
      }
    }
  };

  P._aiTryBuild = function (f, s, defId) {
    const def = D.BUILD[defId];
    if (!def || def.buildMode === 'line' || def.id === 'hall') return false;
    if ((s.stage || 1) < (def.minLevel || 1)) return false;
    const level = WW.levelForPlacement(def, s);
    const cost = D.buildingCost(def, level);
    if (cost && !this.canAfford(s, cost)) return false;
    if (def.unique && this._aiCount(f, s, defId) > 0) return false;
    if (this._aiCount(f, s, defId) >= 6) return false;
    const site = this._aiFindBuildSite(f, s, def, level);
    if (!site) return false;
    const r = this.placeBuilding(defId, s.id, site.x, site.y);
    return !!r.ok;
  };

  P._aiFindNodeInSettlement = function (s, type) {
    const hall = this.primaryHall(s);
    const rad = hall && hall.complete ? (hall.def.radius[hall.level] || 12) : 12;
    return this.world.nodes.find((n) => n.alive && n.type === type && U.dist(n.x, n.y, s.x, s.y) <= rad + 1) || null;
  };

  P._aiFindBuildSite = function (f, s, def, level) {
    const center = this.settlementCenter(s);
    const hall = this.primaryHall(s);
    const radius = hall && hall.complete ? (hall.def.radius[hall.level] || 12) : 12;
    const w = def.foot[0], h = def.foot[1];
    const tryAt = (x, y) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 1 || y < 1 || x + w >= this.world.w - 1 || y + h >= this.world.h - 1) return null;
      if (!this._insideSettlement(s, x, y) || !this._insideSettlement(s, x + w - 1, y + h - 1)) return null;
      const chk = this.canPlaceBuilding(def.id, s.id, x, y);
      if (chk.ok) return { x, y };
      return null;
    };
    let candidates = [];
    if (def.requires && def.requires.type) {
      const nodes = this.world.nodes.filter((n) => n.alive && n.type === def.requires.type &&
        U.dist(n.x, n.y, s.x, s.y) < radius + 3).slice(0, 12);
      for (const n of nodes) {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            if (!dx && !dy) continue;
            candidates.push({ x: n.x + dx - Math.floor(w / 2), y: n.y + dy - Math.floor(h / 2) });
          }
        }
      }
    } else if (def.requires && def.requires.water) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const wx = Math.round(center.x + dx), wy = Math.round(center.y + dy);
          if (!this.world.isWater(wx, wy)) continue;
          for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
            candidates.push({ x: wx + ox, y: wy + oy });
          }
        }
      }
    } else {
      for (let i = 0; i < 120; i++) {
        const ang = this.rng.next() * Math.PI * 2;
        const r = 2 + Math.pow(this.rng.next(), 0.6) * Math.max(2, radius - 3);
        candidates.push({ x: center.x + Math.cos(ang) * r - w / 2, y: center.y + Math.sin(ang) * r - h / 2 });
      }
      // also try close to the hall
      for (let r = 3; r <= Math.min(radius + 2, 10); r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            candidates.push({ x: Math.round(center.x + dx - w / 2), y: Math.round(center.y + dy - h / 2) });
          }
        }
      }
    }
    U.shuffle(candidates, this.rng);
    let n = 0;
    for (const c of candidates) {
      if (n++ > 360) break;
      const p = tryAt(c.x, c.y);
      if (p) return p;
    }
    // Large buildings can be squeezed out by a crowded opening. Walk the whole
    // territory deterministically before giving up.
    if (!(def.requires && def.requires.water)) {
      for (let dy = -radius - 1; dy <= radius + 1; dy++) {
        for (let dx = -radius - 1; dx <= radius + 1; dx++) {
          const p = tryAt(center.x + dx - w / 2, center.y + dy - h / 2);
          if (p) return p;
        }
      }
    }
    // Last resort: clear brush and resource points from a buildable footprint,
    // as a resident expedition would. Never clear the very nodes this building
    // needs to operate (a lumber camp still needs trees nearby).
    if (!(def.requires && def.requires.water)) {
      const protectedType = def.requires && def.requires.type;
      const seen = new Set();
      for (let dy = -radius - 1; dy <= radius + 1; dy++) {
        for (let dx = -radius - 1; dx <= radius + 1; dx++) {
          const x = Math.round(center.x + dx - w / 2), y = Math.round(center.y + dy - h / 2);
          if (x < 1 || y < 1 || x + w >= this.world.w - 1 || y + h >= this.world.h - 1) continue;
          if (!this._insideSettlement(s, x, y) || !this._insideSettlement(s, x + w - 1, y + h - 1)) continue;
          if (this.buildings.some((b) => !b.dead && b.settlementId === s.id && !(b.x + b.def.foot[0] <= x || b.x >= x + w || b.y + b.def.foot[1] <= y || b.y >= y + h))) continue;
          const nodes = [];
          let blocked = false, hasProtected = false;
          for (let yy = y; yy < y + h; yy++) {
            for (let xx = x; xx < x + w; xx++) {
              const td = this.world.terrainDef(xx, yy);
              if (!td.pass || td.water || td.mountain) { blocked = true; break; }
              const node = this.world.nodeAt(xx, yy);
              if (node && node.alive) {
                if (node.type === protectedType) hasProtected = true;
                nodes.push(node);
              }
            }
            if (blocked) break;
          }
          if (blocked || hasProtected || !nodes.length) continue;
          const key = x + ',' + y;
          if (seen.has(key)) continue;
          seen.add(key);
          const removed = [];
          for (const node of nodes) {
            const index = this.world.nodes.indexOf(node);
            this.world.removeNode(node);
            removed.push({ node, index });
          }
          const chk = this.canPlaceBuilding(def.id, s.id, x, y);
          if (chk.ok) return { x, y, cleared: removed.length };
          for (let i = removed.length - 1; i >= 0; i--) {
            const r = removed[i];
            r.node.alive = true;
            this.world.nodeGrid[this.world.idx(r.node.x, r.node.y)] = r.index;
          }
        }
      }
    }
    return null;
  };

  P._aiTryColonize = function (f) {
    if (this.ownedSettlements(f.id).length >= 4) return;
    if (!this.canAddPop(f.id) || this.livingPopulation(f.id) + 3 > this.factionPopCap(f.id)) return;
    const sources = this.ownedSettlements(f.id).filter((s) => s.stage >= 2);
    if (!sources.length) return;
    const source = sources.sort((a, b) => b.stage - a.stage)[0];
    if (!this.canAfford(source, this.COLONY_COST)) return;
    for (let i = 0; i < 80; i++) {
      const ang = this.rng.next() * Math.PI * 2;
      const dist = this.rng.float(20, 44);
      const x = Math.round(source.x + Math.cos(ang) * dist);
      const y = Math.round(source.y + Math.sin(ang) * dist);
      if (!this.world.inBounds(x, y)) continue;
      const chk = this.canFoundSettlement(source.id, x, y, f.id);
      if (chk.ok) {
        const r = this.foundSettlement(source.id, x, y);
        if (r.ok) {
          this.notify(`${D.realmFullName(f)}的拓荒者建立了新定居点「${r.settlement.name}」。`, 'world');
          return;
        }
      }
    }
  };

  // =========================================================
  // Training & research
  // =========================================================
  P._aiTrainAtSettlement = function (f, s) {
    for (const b of this.buildings) {
      if (b.owner !== f.id || b.settlementId !== s.id || !b.complete || b.dead || !b.def.training) continue;
      if (b.defId === 'dock') continue;
      if (b.trainingQueue.length >= 1) continue;
      if (!this.canAddPop(f.id)) continue;
      const options = this.availableUnitsFor(b);
      if (!options.length) continue;
      // Prefer the strongest affordable unit, but never spend the last of the food.
      const sorted = options.slice().sort((a, b2) => (D.UNITS[b2].costLevel || 1) - (D.UNITS[a].costLevel || 1));
      for (const kind of sorted) {
        const cost = D.UNITS[kind].trainCost || {};
        if (!this.canAfford(s, cost)) continue;
        if ((s.resources.food || 0) < (cost.food || 0) + 8) continue;
        const r = this.trainUnit(b.id, kind);
        if (r.ok) break;
      }
    }
  };

  P._aiResearch = function (f) {
    if (f.activeResearch) return;
    const buildings = this.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.def.researchTier);
    if (!buildings.length) return;
    const availableTiers = new Set(buildings.map((b) => b.def.researchTier));
    const candidates = Object.values(D.TECHS).filter((t) => {
      if (f.techs.includes(t.id) || !availableTiers.has(t.tier)) return false;
      if (t.requires && !f.techs.includes(t.requires)) return false;
      return true;
    });
    if (!candidates.length) return;
    candidates.sort((a, b) => b.tier - a.tier || this.rng.next() - 0.5);
    for (const tech of candidates) {
      const b = buildings.find((x) => x.def.researchTier === tech.tier);
      if (!b) continue;
      const s = this.getSettlement(b.settlementId);
      if (!s || !this.canAfford(s, tech.cost)) continue;
      this.payCost(s, tech.cost);
      f.activeResearch = { techId: tech.id, progress: 0, sourceSettlementId: s.id, startedAt: this.timeDays, cost: tech.cost };
      this._aiAssignJobs(f);
      return;
    }
  };

  // =========================================================
  // Soldiers & war plans
  // =========================================================
  P._aiMilitaryOrders = function (f) {
    if (f.eliminated) return;
    const wars = this.warsFor(f.id);
    const soldiers = this.units.filter((u) => u.owner === f.id && !u.dead && u.def.military);
    if (!soldiers.length) return;
    // Defend the homeland first if enemies are close.
    const ownSettlements = this.ownedSettlements(f.id);
    let threat = null, threatD = Infinity;
    for (const u of this.units) {
      if (u.dead || !u.def.military || !this.atWar(u.owner, f.id)) continue;
      for (const s of ownSettlements) {
        const d = U.dist(u.x, u.y, s.x, s.y);
        if (d < 26 && d < threatD) { threatD = d; threat = u; }
      }
    }
    if (threat) {
      for (const u of soldiers) {
        if (u.state === 'attacking' || u.state === 'moving') continue;
        this._aiOrderAttack(u, 'unit', threat.id);
      }
      return;
    }
    if (!wars.length) return;
    const enemyIds = new Set();
    for (const w of wars) enemyIds.add(w.a === f.id ? w.b : w.a);
    const enemySettlements = this.settlements.filter((s) => !s.ruined && enemyIds.has(s.owner));
    if (!enemySettlements.length) return;
    const originS = ownSettlements[0] || this.settlements[0];
    const targets = enemySettlements.map((s) => ({ s, d: U.dist(s.x, s.y, originS.x, originS.y) })).sort((a, b) => a.d - b.d);
    for (const u of soldiers) {
      if (u.state === 'attacking' || u.state === 'moving' || u.state === 'inside') continue;
      let ordered = false;
      for (const t of targets.slice(0, 3)) {
        const targetBuilding = this._aiChooseAttackTarget(u, t.s);
        if (targetBuilding && this._aiOrderAttack(u, 'building', targetBuilding.id)) { ordered = true; break; }
      }
      if (!ordered) {
        // Try an enemy field unit as a fallback.
        let best = null, bestD = 25 * 25;
        for (const e of this.units) {
          if (e.dead || !this.atWar(e.owner, f.id)) continue;
          if (e.state === 'aboard') continue;
          if (e.isShip && !u.def.ranged) continue;
          const d = U.dist2(u.x, u.y, e.x, e.y);
          if (d < bestD) { bestD = d; best = e; }
        }
        if (best) this._aiOrderAttack(u, 'unit', best.id);
      }
    }
    // Call vassals into ongoing wars now and then.
    if (this.rng.chance(0.12)) {
      const vassals = this.vassalsOf(f.id);
      for (const vId of vassals) {
        const w = wars[0];
        if (w) this.callVassalToWar(f.id, vId, w.id);
      }
    }
  };

  P._aiChooseAttackTarget = function (u, settlement) {
    const hall = this.primaryHall(settlement);
    if (!hall || hall.dead) return null;
    const at = this.approachTileForBuilding(hall, u.x, u.y);
    if (at) {
      const path = this.path.findPath(Math.floor(u.x), Math.floor(u.y), at.x, at.y, { maxIter: 18000 });
      if (path) return hall;
    }
    // The walls are closed. Break the gate, or if there is no gate, a wall section.
    const gates = this.buildings.filter((b) => b.settlementId === settlement.id && b.owner === settlement.owner && b.complete && !b.dead && b.defId === 'gate');
    const closedGates = gates.filter((g) => !g.open);
    if (closedGates.length) {
      closedGates.sort((a, b) => U.dist2(u.x, u.y, a.x, a.y) - U.dist2(u.x, u.y, b.x, b.y));
      for (const g of closedGates) {
        const ga = this.approachTileForBuilding(g, u.x, u.y);
        if (ga && this.path.findPath(Math.floor(u.x), Math.floor(u.y), ga.x, ga.y, { maxIter: 12000 })) return g;
      }
    }
    const walls = this.buildings.filter((b) => b.settlementId === settlement.id && b.complete && !b.dead && b.defId === 'wall')
      .sort((a, b) => U.dist2(u.x, u.y, a.x, a.y) - U.dist2(u.x, u.y, b.x, b.y));
    for (const wall of walls.slice(0, 8)) {
      const wa = this.approachTileForBuilding(wall, u.x, u.y);
      if (wa && this.path.findPath(Math.floor(u.x), Math.floor(u.y), wa.x, wa.y, { maxIter: 9000 })) return wall;
    }
    // Last resort: any accessible enemy building.
    const others = this.buildings.filter((b) => b.settlementId === settlement.id && b.owner === settlement.owner && b.complete && !b.dead);
    for (const b of others) {
      const ba = this.approachTileForBuilding(b, u.x, u.y);
      if (ba && this.path.findPath(Math.floor(u.x), Math.floor(u.y), ba.x, ba.y, { maxIter: 10000 })) return b;
    }
    return null;
  };

  // =========================================================
  // War and diplomacy
  // =========================================================
  P._aiConsiderWar = function (f) {
    if (f.eliminated) return { retry: false };
    const existing = this.warsFor(f.id);
    if (existing.length) return { retry: false };
    const soldiers = this.factionUnits(f.id, true).filter((u) => u.def.military).length;
    if (soldiers < 2 + Math.min(3, f.rank)) return { retry: true };
    const ownSettlements = this.ownedSettlements(f.id);
    if (!ownSettlements.length) return { retry: false };
    const candidates = [];
    for (const other of this.factions) {
      if (other.id === f.id || other.eliminated) continue;
      if (this.areAllied(f.id, other.id) || this.atWar(f.id, other.id)) continue;
      if (this.isVassalOf(f.id, other.id) || this.isVassalOf(other.id, f.id)) continue;
      if (f.truces && f.truces[other.id] > this.timeDays) continue;
      if (other.isPlayer) {
        const diff = D.DIFFICULTIES[this.settings.difficulty] || D.DIFFICULTIES.normal;
        if (this.timeDays < (diff.graceDays || 110)) continue;
      }
      const d = Math.min(...ownSettlements.map((s) => Math.min(...this.ownedSettlements(other.id).map((o) => U.dist(s.x, s.y, o.x, o.y)))));
      if (!isFinite(d) || d > 90) continue;
      const powerRatio = this._factionPower(f.id) / Math.max(1, this._factionPower(other.id));
      let score = powerRatio * 1.5 + (1 - d / 120) + (this.relationBetween(f.id, other.id) < 40 ? 0.4 : 0);
      if (other.isPlayer) score += 0.1;
      score += this.rng.float(-0.25, 0.25);
      candidates.push({ other, score, powerRatio });
    }
    if (!candidates.length) return { retry: true };
    candidates.sort((a, b) => b.score - a.score);
    const target = candidates[0];
    let cb = (f.casusBelli || []).find((c) => c.target === target.other.id);
    const wantWar = target.powerRatio > 0.95 + (1 - (f.ai.aggression || 1)) * 0.45 && this.rng.chance(U.clamp(0.2 + (f.ai.aggression || 1) * 0.22, 0.1, 0.72));
    if (!wantWar) return { retry: true };
    let declared;
    if (cb) {
      declared = this.declareWar(f.id, target.other.id, cb.id);
    } else {
      if (this.rng.chance(U.clamp(0.25 * (f.ai.aggression || 1) + (target.powerRatio > 1.5 ? 0.15 : 0), 0.05, 0.6))) {
        declared = this.declareWar(f.id, target.other.id, null);
      }
    }
    if (declared && declared.ok) {
      for (const vId of this.vassalsOf(f.id)) {
        if (this.rng.chance(0.7)) this.callVassalToWar(f.id, vId, declared.war.id);
      }
      return { retry: false };
    }
    return { retry: true };
  };

  P._aiAcceptsAlliance = P._aiAcceptsAlliance; // defined in diplomacy

  P._aiDiplomacy = function (f) {
    if (f.eliminated) return;
    if (this.pendingPrompts.some((p) => p.pause)) return;
    const player = this.player;
    if (!player || player.eliminated) return;
    const rel = this.relationBetween(f.id, player.id);
    // Propose alliances to the player.
    if (!this.atWar(f.id, player.id) && !this.areAllied(f.id, player.id) && f.rank >= 2 &&
      rel >= 62 && this.rng.chance(0.16)) {
      this.addPrompt('allianceOffer', f.id, {}, {
        pause: true, title: '盟约的橄榄枝',
        text: `${D.realmFullName(f)}的使节带来了一份同盟条约。${rel >= 75 ? '他们真心敬重你的王国。' : '双方都需要一个可靠的伙伴。'}`
      });
      return;
    }
    // Demand vassalage if significantly stronger.
    if (!this.atWar(f.id, player.id) && !this.areAllied(f.id, player.id) && f.rank > player.rank &&
      this._factionPower(f.id) > this._factionPower(player.id) * 1.45 && this.overlordOf(player.id) == null &&
      this.relationBetween(f.id, player.id) < 80 && this.rng.chance(0.12)) {
      this.addPrompt('vassalDemand', f.id, {}, {
        pause: true, title: '宗主的通牒',
        text: `${D.realmFullName(f)}要求你承认其宗主权。拒绝将给对方征服你的借口。`
      });
      return;
    }
    // Trade proposal.
    if (!this.atWar(f.id, player.id) && this.hasMarket(f.id) && this.hasMarket(player.id) &&
      !this.tradeDeals.some((d) => !d.failed && !d.completedAt && ((d.a === f.id && d.b === player.id) || (d.a === player.id && d.b === f.id))) &&
      rel > 38 && this.rng.chance(0.24)) {
      this._aiProposeTradeToPlayer(f, player);
      return;
    }
    // Invite an allied player into a war.
    if (this.areAllied(f.id, player.id) && !this.atWar(f.id, player.id) && this.rng.chance(0.1)) {
      const war = this.warsFor(f.id).find((w) => {
        const enemy = w.a === f.id ? w.b : w.a;
        return !this.atWar(player.id, enemy);
      });
      if (war) {
        const enemyId = war.a === f.id ? war.b : war.a;
        this.addPrompt('inviteWar', f.id, { enemyId }, {
          pause: true, title: '盟友的战争邀请',
          text: `${D.realmFullName(f)}正在与${D.realmFullName(this.getFaction(enemyId))}交战，并邀请你加入这场战争。`
        });
        return;
      }
    }
    // AI-to-AI alliances give the world a little more life.
    for (const other of this.factions) {
      if (other.eliminated || other.isPlayer || other.id === f.id || !other.ai) continue;
      if (this.atWar(f.id, other.id) || this.areAllied(f.id, other.id)) continue;
      if (this.areAllied(f.id, player.id) && this.areAllied(other.id, player.id)) continue;
      if (this.relationBetween(f.id, other.id) > 66 && this.rng.chance(0.03)) {
        const alliance = this._formAlliance(f.id, other.id);
        if (alliance) return;
      }
    }
  };

  P._aiProposeTradeToPlayer = function (f, player) {
    const aiMarkets = this.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.defId === 'market');
    const playerMarkets = this.buildings.filter((b) => b.owner === player.id && b.complete && !b.dead && b.defId === 'market');
    if (!aiMarkets.length || !playerMarkets.length) return;
    const surplusRes = ['food', 'wood', 'stone', 'leather', 'herb', 'ironOre'];
    let offer = null;
    for (const res of surplusRes) {
      const market = aiMarkets.map((m) => ({ m, s: this.getSettlement(m.settlementId) }))
        .filter((x) => x.s && (x.s.resources[res] || 0) > 30)
        .sort((a, b) => (b.s.resources[res] || 0) - (a.s.resources[res] || 0))[0];
      if (market) { offer = { res, market: market.m, settlement: market.s }; break; }
    }
    if (!offer) return;
    const requests = ['wood', 'stone', 'food', 'iron', 'silver', 'herb'];
    let request = null;
    for (const res of requests) {
      if (res === offer.res) continue;
      const market = playerMarkets.map((m) => ({ m, s: this.getSettlement(m.settlementId) }))
        .filter((x) => x.s && (x.s.resources[res] || 0) > 24)
        .sort((a, b) => (b.s.resources[res] || 0) - (a.s.resources[res] || 0))[0];
      if (market) { request = { res, market: market.m, settlement: market.s }; break; }
    }
    if (!request) return;
    const aiCap = this.merchantCapacity(f.id, offer.market);
    const playerCap = this.merchantCapacity(player.id, request.market);
    const offerAmount = Math.min(aiCap, Math.floor((offer.settlement.resources[offer.res] || 0) * 0.35), 40);
    const requestAmount = Math.min(playerCap, Math.floor((request.settlement.resources[request.res] || 0) * 0.25), 30);
    if (offerAmount < 5 || requestAmount < 5) return;
    const routeAI = this._validateTradeRoute(offer.market, player.id, this.buildingCenter(offer.market).x, this.buildingCenter(offer.market).y);
    const routePlayer = this._validateTradeRoute(request.market, f.id, this.buildingCenter(request.market).x, this.buildingCenter(request.market).y);
    if (!routeAI.ok || !routePlayer.ok) return;
    const terms = {
      a: player.id, b: f.id,
      fromA: { res: request.res, amount: requestAmount, market: request.market.id },
      fromB: { res: offer.res, amount: offerAmount, market: offer.market.id },
      durationDays: this.rng.int(40, 70)
    };
    this.addPrompt('tradeOffer', f.id, { terms }, {
      pause: true, title: '来自远方的商队',
      text: `${D.realmFullName(f)}提议：以 ${offerAmount} 单位${D.RES[offer.res].name}，交换你的 ${requestAmount} 单位${D.RES[request.res].name}。双方将派商人按时送达。`
    });
  };

  // Pull in any task-specific helpers.
  P._updateAllRanks = P.updateAllRanks;
  P.livingResidents = function (fid) {
    return this.factionUnits(fid).filter((u) => u.def.cls === 'civilian').length;
  };
})();
