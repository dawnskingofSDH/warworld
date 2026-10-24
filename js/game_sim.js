/* WARWORLD — simulation ticks: economy, construction, units, production, civic life. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const P = WW.Game.prototype;

  P.update = function (simSeconds) {
    if (!isFinite(simSeconds) || simSeconds <= 0) return;
    if (this.pendingPrompts.some((p) => p.pause)) { this.blockedByPrompt = true; return; }
    this.blockedByPrompt = false;
    let remaining = Math.min(simSeconds, 4);
    let guard = 0;
    while (remaining > 0.00001 && guard++ < 30) {
      const dt = Math.min(0.075, remaining);
      this._step(dt);
      remaining -= dt;
      if (this.pendingPrompts.some((p) => p.pause)) break;
    }
  };

  P._step = function (dt) {
    const days = dt / D.DAY_SECONDS;
    this.timeDays += days;
    this.dayAccumulator += days;
    this._capsCache = new Map();
    this._updateUnitMovement(dt, days);
    this._updateGathering(days);
    this._updateClearings(days);
    this._updateConstruction(days);
    this._updateProduction(days);
    this._updateRepair(days);
    this._updateTraining(days);
    this._updateResearch(days);
    this._updateHealing(days);
    this._updateCombat(dt, days);
    this._updateEffects(dt);
    while (this.dayAccumulator >= 1) {
      this.dayAccumulator -= 1;
      this._onDay();
    }
    // NPC construction and other AI work runs on its own schedule.
    if (this._aiUpdate) this._aiUpdate(days);
    this._cleanupDead();
    this._capsCache = null;
  };

  // =========================================================
  // Day tick
  // =========================================================
  P._onDay = function () {
    const now = this.timeDays;
    // relations drift and truce cleanup
    for (const f of this.factions) {
      if (f.eliminated) continue;
      for (const o of this.factions) {
        if (o.id === f.id || o.eliminated) continue;
        if (this.atWar(f.id, o.id)) continue;
        const cur = f.relations[o.id] == null ? 50 : f.relations[o.id];
        const target = this.areAllied(f.id, o.id) ? Math.max(cur, 68) : 50;
        const drift = target > cur ? 0.035 : 0.022;
        f.relations[o.id] = U.clamp(cur + Math.sign(target - cur) * Math.min(drift, Math.abs(target - cur)), 0, 100);
      }
      for (const k of Object.keys(f.truces || {})) {
        if (f.truces[k] <= now) delete f.truces[k];
      }
    }

    for (const s of this.settlements.slice()) {
      if (s.ruined) continue;
      const faction = this.getFaction(s.owner);
      if (!faction || faction.eliminated) continue;
      this._settlementDay(s, faction);
    }

    this._nodeDay();
    if (this._warDayTick) this._warDayTick();
    if (this._diplomacyDayTick) this._diplomacyDayTick();
    this._borderTensions();
    this._checkIndependence();
    this._checkEliminations();
    if (this._tutorialDay) this._tutorialDay();
    if (this._aiDayTick) this._aiDayTick();
    if (this.timeDays - (this.boostsLastRefresh || 0) > 3) this.refreshNodeBoosts();
    this._cleanupOrphanReferences();
  };

  // A deterministic per-building random stream. Each house has its own
  // counter, so houses never share the same roll or birth day.
  P._houseRandom = function (b) {
    b.growthRolls = (b.growthRolls || 0) + 1;
    return U.hashString(`${b.id}|${b.growthRolls}|${this.seed}|house`) / 4294967296;
  };

  P._settlementDay = function (s, faction) {
    const stage = U.clamp(s.stage || 1, 1, 4);
    const upkeep = D.SETTLEMENT_UPKEEP[stage] || {};
    let shortage = false;
    const missing = [];
    for (const [res, amount] of Object.entries(upkeep)) {
      const have = s.resources[res] || 0;
      if (have + 1e-6 >= amount) {
        s.resources[res] = have - amount;
      } else {
        // consume what little is left, but the settlement goes without.
        s.resources[res] = 0;
        shortage = true;
        missing.push(D.RES[res].name);
      }
    }
    s.shortage = shortage;
    s.lastMissing = missing;
    if (shortage) {
      s.stability = U.clamp(s.stability - (1.1 + stage * 0.26), 0, 100);
      if (faction.isPlayer && (!s._shortageNotifiedAt || this.timeDays - s._shortageNotifiedAt > 4)) {
        s._shortageNotifiedAt = this.timeDays;
        this.notify(`「${s.name}」缺少${missing.slice(0, 3).join('、')}，稳定度正在下降。`, 'warn', { settlementId: s.id });
      }
    }
    if (s.stability <= 0) {
      // A settlement that has already hit zero cannot quietly recover on the
      // same day; it must face the immediate independence check.
      s.stability = 0;
    } else {
      const target = this.stabilityTarget(s, faction);
      if (s.stability < target) s.stability = Math.min(target, s.stability + 0.42);
      else if (s.stability > target) s.stability = Math.max(target, s.stability - 0.72);
    }
    s.stability = U.clamp(s.stability, 0, 100);
    if (s.stability < D.INDEPENDENCE.threshold && faction.isPlayer && (!s._lowStabilityNotifiedAt || this.timeDays - s._lowStabilityNotifiedAt > 8)) {
      s._lowStabilityNotifiedAt = this.timeDays;
      this.notify(`「${s.name}」的稳定度仅有 ${Math.floor(s.stability)}（低于 ${D.INDEPENDENCE.threshold}），每天都有独立的可能。降至 0 会立即独立。请发放救助金或改善供给。`, 'danger', { important: true, settlementId: s.id });
    }

    // Houses rear new residents. Every house keeps its own growth clock and
    // rolls its own pace, so a row of houses built on the same day will not
    // all produce a resident on the same day.
    for (const b of this.buildings) {
      if (b.settlementId !== s.id || b.defId !== 'house' || !b.complete || b.dead) continue;
      const def = b.def, lvl = b.level;
      const baseDays = (def.growthDays && def.growthDays[lvl]) || 10;
      if (!(baseDays > 0)) continue;
      if (b.growthTarget == null) b.growthTarget = baseDays * (0.85 + this._houseRandom(b) * 0.55);
      if (this.livingPopulation(faction.id) >= this.factionPopCap(faction.id)) {
        // Freeze instead of filling to the threshold: otherwise every house
        // would give birth on the first day a new house raises the cap.
        continue;
      }
      if ((s.resources.food || 0) < 4) continue;
      b.growthProgress = (b.growthProgress || 0) + 0.9 + this._houseRandom(b) * 0.2;
      if (b.growthProgress >= b.growthTarget) {
        b.growthProgress = 0;
        b.growthTarget = baseDays * (0.85 + this._houseRandom(b) * 0.55);
        const at = this.approachTileForBuilding(b, b.x, b.y) || { x: b.x, y: b.y };
        this._spawnUnit('resident', faction.id, s.id, at.x + 0.5, at.y + 0.5);
        this.removeResource(s, 'food', 4);
        if (faction.isPlayer) this.notify(`「${s.name}」的一户人家迎来了新居民。人口增加。`, 'population', { settlementId: s.id });
      }
    }

    // Taverns: food, comfort and the occasional sellsword.
    for (const b of this.buildings) {
      if (b.settlementId !== s.id || b.defId !== 'tavern' || !b.complete || b.dead || !b.active) continue;
      const foodCost = (b.def.upkeepFood && b.def.upkeepFood[b.level]) || 0;
      if (foodCost && (s.resources.food || 0) < foodCost) {
        b._shortFood = true;
        if (faction.isPlayer && (!b._tavernNotified || this.timeDays - b._tavernNotified > 7)) {
          b._tavernNotified = this.timeDays;
          this.notify(`「${s.name}」的酒馆缺少食物，无法营业。`, 'warn', { settlementId: s.id });
        }
        continue;
      }
      b._shortFood = false;
      if (foodCost) s.resources.food -= foodCost;
      const chance = (b.def.mercChance && b.def.mercChance[b.level]) || 0;
      if (this.canAddPop(faction.id) && this.rng.chance(chance)) {
        const at = this.approachTileForBuilding(b, b.x, b.y) || { x: b.x, y: b.y };
        this._spawnUnit('mercenary', faction.id, s.id, at.x + 0.5, at.y + 0.5);
        if (faction.isPlayer) {
          this.notify(`一名雇佣兵被「${s.name}」的酒馆吸引，加入了你的军队。`, 'military', { important: true, settlementId: s.id });
          this.sfx('horn', b.x, b.y);
        }
      }
    }

    // A settlement at zero loyalty breaks away immediately; below the
    // threshold it only runs a daily risk of doing so.
    if (s.stability <= 0 && faction.isPlayer) {
      if (!s._independenceNotice || this.timeDays - s._independenceNotice > 5) {
        s._independenceNotice = this.timeDays;
        this.notify(`「${s.name}」的稳定度已经归零，贵族与市民正在抛弃你的统治。`, 'danger', { important: true, settlementId: s.id });
      }
    }
  };

  P.stabilityTarget = function (s, faction) {
    faction = faction || this.getFaction(s.owner);
    if (!faction) return 50;
    let target = 55;
    const mod = this._mod(faction);
    for (const b of this.buildings) {
      if (b.dead || !b.complete || b.settlementId !== s.id) continue;
      if (b.defId === 'church') target += (b.def.stability && b.def.stability[b.level]) || 0;
      if (b.defId === 'tavern' && b.active) target += (b.def.stability && b.def.stability[b.level]) || 0;
      if (b.defId === 'market') target += 2;
      if (b.defId === 'hall' && b.level === 4) target += 4;
    }
    target += mod.stability || 0;
    const wars = this.wars.filter((w) => !w.ended && (w.a === faction.id || w.b === faction.id)).length;
    target -= Math.min(14, wars * 5);
    if (s.shortage) target -= 28;
    if (s.occupiedUntil > this.timeDays) target -= 22;
    if ((s.resources.food || 0) > this.getResourceCap(s, 'food') * 0.55) target += 4;
    return U.clamp(target, 0, 100);
  };

  P._nodeDay = function () {
    for (const n of this.world.nodes) {
      if (!n.alive) continue;
      const meta = D.NODES[n.type];
      if (!meta || n.amount >= n.max) continue;
      n.amount = Math.min(n.max, n.amount + n.max * meta.regen * (n.regenMul || 1));
    }
  };

  P._borderTensions = function () {
    // Each neighbouring pair rolls independently; there is no shared daily
    // gate that would make every border flare up on the very same day.
    for (let i = 0; i < this.factions.length; i++) {
      for (let j = i + 1; j < this.factions.length; j++) {
        const a = this.factions[i], b = this.factions[j];
        if (a.eliminated || b.eliminated) continue;
        if (this.atWar(a.id, b.id) || this.areAllied(a.id, b.id)) continue;
        if (this.isVassalOf(a.id, b.id) || this.isVassalOf(b.id, a.id)) continue;
        const has = a.casusBelli.some((c) => c.target === b.id && c.reason === 'border');
        if (has) continue;
        let close = false;
        for (const sa of this.ownedSettlements(a.id)) {
          for (const sb of this.ownedSettlements(b.id)) {
            if (U.dist(sa.x, sa.y, sb.x, sb.y) < 27) { close = true; break; }
          }
          if (close) break;
        }
        if (!close) continue;
        if (this.rng.chance(0.035)) {
          const cb = { id: this.nextId('cb'), target: b.id, reason: 'border', created: this.timeDays };
          const cb2 = { id: this.nextId('cb'), target: a.id, reason: 'border', created: this.timeDays };
          a.casusBelli.push(cb); b.casusBelli.push(cb2);
          if (a.isPlayer || b.isPlayer) {
            const other = a.isPlayer ? b : a;
            this.notify(`边界上的牧羊人与税吏发生了流血冲突。你获得了对${D.realmFullName(other)}的战争理由：边界冲突。`, 'diplomacy', { important: true });
            this.sfx('rumor');
          }
        }
      }
    }
  };

  P._checkIndependence = function () {
    const threshold = D.INDEPENDENCE.threshold;
    for (const s of this.settlements.slice()) {
      if (s.ruined) continue;
      const faction = this.getFaction(s.owner);
      if (!faction || faction.eliminated) continue;
      // Zero loyalty means the break is no longer a matter of chance.
      if (s.stability <= 0) {
        this._triggerIndependence(s);
        continue;
      }
      if (s.stability >= threshold) continue;
      const severity = 1 - s.stability / threshold;
      let chance = D.INDEPENDENCE.baseChance + severity * severity * D.INDEPENDENCE.maxChance;
      if (s.shortage) chance += D.INDEPENDENCE.shortageBonus;
      if (!this.rng.chance(U.clamp(chance, 0, 0.25))) continue;
      this._triggerIndependence(s);
    }
  };

  P._triggerIndependence = function (s) {
    const oldFaction = this.getFaction(s.owner);
    if (!oldFaction) return;
    const usedNames = new Set(this.factions.map((f) => f.name));
    let name = '';
    for (let i = 0; i < 30; i++) {
      const cand = U.choice(D.factionNames, this.rng);
      if (!usedNames.has(cand)) { name = cand; break; }
    }
    if (!name) name = (D.settlementNames.find((x) => !usedNames.has(x)) || '新邦') + '';
    const palette = U.choice(D.crestPalettes, this.rng);
    const symbol = U.choice(D.crestSymbols, this.rng);
    const f = {
      id: this.nextId('f'), name, isPlayer: false,
      colors: { primary: palette.primary, secondary: palette.secondary, accent: palette.accent },
      crest: symbol, rank: s.stage || 1, relations: {}, techs: [],
      modifiers: {}, activeResearch: null, casusBelli: [], truces: {}, eliminated: false,
      ai: {
        nextThink: this.rng.float(1, 4), nextWar: this.rng.float(30, 55), nextDiplomacy: this.rng.float(5, 15),
        nextColony: this.rng.float(80, 140), aggression: 0.7, eco: 0.8,
        targetSettlement: null, armyTarget: null, armyOrderDay: 0
      }
    };
    for (const other of this.factions) {
      f.relations[other.id] = 35;
      other.relations[f.id] = 35;
    }
    this.factions.push(f);
    s.owner = f.id;
    s.stability = 24;
    s.occupiedUntil = this.timeDays + 20;
    const oldCap = this.factionPopCap(oldFaction.id);
    for (const b of this.buildings) {
      if (b.settlementId === s.id) b.owner = f.id;
    }
    for (const u of this.units) {
      if (u.homeSettlement === s.id && u.owner === oldFaction.id) {
        u.owner = f.id;
        if (u.state === 'inside' && u.buildingId) {
          const b = this.getBuilding(u.buildingId);
          if (b) { b.workers = b.workers.filter((id) => id !== u.id); u.state = 'idle'; u.buildingId = null; }
        }
      }
    }
    this.updateRank(oldFaction);
    this.updateRank(f);
    this.refreshNodeBoosts();
    this.notify(`「${s.name}」的居民在广场上竖起了新的旗帜。${name}宣布独立，脱离${D.realmFullName(oldFaction)}！`, 'danger', { important: true, settlementId: s.id });
    this.emit('independence', s, oldFaction, f);
    this.sfx('warhorn');
    if (oldFaction.isPlayer) this.emit('crisis', 'independence', { settlement: s, newFaction: f });
  };

  P._checkEliminations = function () {
    for (const f of this.factions) {
      if (f.eliminated) continue;
      const settlements = this.ownedSettlements(f.id);
      const units = this.factionUnits(f.id, true).filter((u) => !u.dead);
      const military = units.filter((u) => u.def && u.def.military);
      // Without a hall or an army there is no way back into the game.
      if (settlements.length === 0 && military.length === 0) {
        this._eliminateFaction(f);
      }
    }
    const aliveOthers = this.factions.filter((f) => !f.eliminated && f.id !== this.playerFactionId);
    if (aliveOthers.length === 0 && !this._victoryAnnounced && this.player && !this.player.eliminated) {
      this._victoryAnnounced = true;
      this.notify('最后的敌旗已经落下。你的王朝统治了整片已知世界——但战争世界的故事仍可继续。', 'victory', { important: true });
      this.emit('victory');
    }
  };

  P._eliminateFaction = function (f) {
    f.eliminated = true;
    this.eliminatedFactions.push(f.id);
    for (const other of this.factions) {
      other.relations[f.id] = 0;
    }
    this.wars = this.wars.filter((w) => {
      if (w.a === f.id || w.b === f.id) {
        const otherId = w.a === f.id ? w.b : w.a;
        const other = this.getFaction(otherId);
        if (other && other.isPlayer) this.notify(`与${D.realmFullName(f)}的战争随着其灭亡而结束。`, 'war');
        return false;
      }
      return true;
    });
    this.alliances = this.alliances.filter((a) => a.a !== f.id && a.b !== f.id);
    const vassalsOfF = this.vassals.filter((v) => v.overlord === f.id);
    for (const v of vassalsOfF) {
      const vf = this.getFaction(v.vassal);
      if (vf) this.notify(`${D.realmFullName(vf)}重获独立。`, 'diplomacy');
    }
    this.vassals = this.vassals.filter((v) => v.overlord !== f.id && v.vassal !== f.id);
    this.tradeDeals = this.tradeDeals.filter((d) => d.a !== f.id && d.b !== f.id);
    for (const b of this.buildings) {
      if (b.owner === f.id) b.owner = null;
    }
    for (const u of this.units) {
      if (u.owner === f.id) u.dead = true;
    }
    this.notify(`${D.realmFullName(f)}已经灭亡，其旗帜从历史上消失。`, f.isPlayer ? 'defeat' : 'world', { important: true });
    if (f.isPlayer) this.emit('defeat', f);
    else this.emit('factionEliminated', f);
  };

  // =========================================================
  // Production
  // =========================================================
  P._capsFor = function (s) {
    if (!this._capsCache) this._capsCache = new Map();
    if (!this._capsCache.has(s.id)) this._capsCache.set(s.id, this.getStorageCaps(s));
    return this._capsCache.get(s.id);
  };

  P._addWithCaps = function (s, resource, amount) {
    if (!s || !D.RES[resource] || amount <= 0) return 0;
    const caps = this._capsFor(s);
    const cap = caps[resource];
    const current = s.resources[resource] || 0;
    const add = Math.max(0, Math.min(amount, cap - current));
    s.resources[resource] = current + add;
    return add;
  };

  P._takeNodes = function (b, type, requested, settlement, outputRes) {
    if (requested <= 0) return 0;
    const caps = this._capsFor(settlement);
    const room = caps[outputRes] - (settlement.resources[outputRes] || 0);
    if (room <= 0) return 0;
    const cx = b.x + b.def.foot[0] / 2, cy = b.y + b.def.foot[1] / 2;
    const nodes = this.world.findNodesNear(cx, cy, 6, type).filter((n) => n.alive && n.amount > 0.001);
    if (!nodes.length) return 0;
    let available = 0;
    for (const n of nodes) available += n.amount;
    const actual = Math.min(requested, available, room);
    if (actual <= 0.00001) return 0;
    let left = actual;
    for (let i = 0; i < nodes.length && left > 0.00001; i++) {
      const n = nodes[i];
      const share = left / (nodes.length - i);
      const take = Math.min(n.amount, share, left);
      n.amount -= take;
      left -= take;
    }
    settlement.resources[outputRes] = (settlement.resources[outputRes] || 0) + actual;
    return actual;
  };

  P._updateProduction = function (days) {
    for (const b of this.buildings) {
      if (b.dead || !b.complete) continue;
      const settlement = this.getSettlement(b.settlementId);
      const faction = this.getFaction(b.owner);
      if (!settlement || !faction || faction.eliminated) continue;
      const level = b.level || 1;
      const def = b.def;
      const mod = this._mod(faction);
      const mul = (def.prodMul && def.prodMul[level]) || 1;
      // market toll comes without workers
      if (b.defId === 'market') {
        const toll = (def.toll && def.toll[level]) || 0;
        if (toll) this._addWithCaps(settlement, 'coin', toll * days);
        continue;
      }
      if (b.defId === 'house' || b.defId === 'hall' || b.defId === 'warehouse' || b.defId === 'church' ||
        b.defId === 'tavern' || b.defId === 'barracks' || b.defId === 'archery' || b.defId === 'stable' ||
        b.defId === 'tower' || b.defId === 'wall' || b.defId === 'gate' || b.defId === 'clinic' ||
        b.defId === 'hospital' || b.defId === 'dock' || b.defId === 'library' || b.defId === 'university' ||
        b.defId === 'royalUniversity' || b.defId === 'knightOrder' || b.defId === 'road' ||
        b.defId === 'bridge' || b.defId === 'tunnel') continue;
      b.workers = (b.workers || []).filter((id) => {
        const u = this.getUnit(id);
        return u && !u.dead && u.state === 'inside' && u.buildingId === b.id;
      });
      const workers = b.workers.length;
      if (!workers) continue;
      const wdays = workers * days * mul;
      if (b.defId === 'lumber') {
        const wood = wdays * 5.2 * (1 + (mod.wood || 0));
        this._takeNodes(b, 'tree', wood, settlement, 'wood');
      } else if (b.defId === 'gatherer') {
        const foodWanted = wdays * 4.5 * (1 + (mod.food || 0));
        const got = this._takeNodes(b, 'berry', foodWanted, settlement, 'food');
        const herb = wdays * 0.42 * (1 + (mod.food || 0)) * (foodWanted > 0 ? got / foodWanted : 0);
        this._addWithCaps(settlement, 'herb', herb);
      } else if (b.defId === 'hunter') {
        const food = wdays * 1.75 * (1 + (mod.food || 0));
        const leather = wdays * 0.55;
        this._addWithCaps(settlement, 'food', food);
        this._addWithCaps(settlement, 'leather', leather);
      } else if (b.defId === 'fishery') {
        this._addWithCaps(settlement, 'food', wdays * 2.65 * (1 + (mod.food || 0)));
      } else if (b.defId === 'quarry') {
        let stone = wdays * 1.55 * (1 + (mod.stone || 0));
        if (this.world.mountainNear(b.x + 1, b.y + 1, 4)) stone *= 1.5;
        const gained = this._addWithCaps(settlement, 'stone', stone);
        if (gained > 0) {
          // Chips from the rock face occasionally expose small ore seams.
          this._settlementChance(settlement, 'ironOre', gained * 0.024);
          this._settlementChance(settlement, 'silverOre', gained * 0.008);
          this._settlementChance(settlement, 'goldOre', gained * 0.0018);
        }
      } else if (b.defId === 'ironMine') {
        this._takeNodes(b, 'iron', wdays * 0.8 * (1 + (mod.ore || 0)), settlement, 'ironOre');
      } else if (b.defId === 'silverMine') {
        this._takeNodes(b, 'silver', wdays * 0.65 * (1 + (mod.ore || 0)), settlement, 'silverOre');
      } else if (b.defId === 'goldMine') {
        this._takeNodes(b, 'gold', wdays * 0.42 * (1 + (mod.ore || 0)), settlement, 'goldOre');
      } else if (b.defId === 'farm') {
        this._addWithCaps(settlement, 'food', wdays * 2.15 * (1 + (mod.food || 0)));
      } else if (b.defId === 'mill') {
        const hasFarm = this.buildings.some((x) => !x.dead && x.complete && x.defId === 'farm' && x.settlementId === settlement.id);
        if (hasFarm) this._addWithCaps(settlement, 'food', wdays * 1.65 * (1 + (mod.food || 0)));
      } else if (b.defId === 'smelter') {
        this._smelt(b, settlement, wdays, mod);
      } else if (b.defId === 'mint') {
        this._mint(b, settlement, wdays, mod);
      }
    }
  };

  P._smelt = function (b, settlement, wdays, mod) {
    const recipe = b.recipe || 'iron';
    const spec = {
      iron: { ore: 'ironOre', out: 'iron', orePer: 1.35, woodPer: 0.48, outPer: 0.68 },
      silver: { ore: 'silverOre', out: 'silver', orePer: 1.0, woodPer: 0.55, outPer: 0.48 },
      gold: { ore: 'goldOre', out: 'gold', orePer: 0.55, woodPer: 0.7, outPer: 0.22 }
    }[recipe];
    if (!spec) return;
    const caps = this._capsFor(settlement);
    const outRoom = caps[spec.out] - (settlement.resources[spec.out] || 0);
    if (outRoom <= 0) return;
    let out = wdays * spec.outPer * (1 + (mod.ore || 0) * 0.6);
    out = Math.min(out, outRoom);
    const oreNeed = out / spec.outPer * spec.orePer;
    const woodNeed = out / spec.outPer * spec.woodPer;
    const oreAvail = settlement.resources[spec.ore] || 0;
    const woodAvail = settlement.resources.wood || 0;
    if (oreAvail < oreNeed) out = oreAvail / spec.orePer * spec.outPer;
    if (woodAvail < woodNeed) out = Math.min(out, woodAvail / spec.woodPer * spec.outPer);
    if (out <= 0.00001) return;
    settlement.resources[spec.ore] -= out / spec.outPer * spec.orePer;
    settlement.resources.wood -= out / spec.outPer * spec.woodPer;
    settlement.resources[spec.out] = (settlement.resources[spec.out] || 0) + out;
  };

  P._mint = function (b, settlement, wdays, mod) {
    const caps = this._capsFor(settlement);
    const coinRoom = caps.coin - (settlement.resources.coin || 0);
    if (coinRoom <= 0) return;
    let out = Math.min(wdays * 1.0, coinRoom);
    const silverNeed = out * 0.3;
    const woodNeed = out * 0.6;
    if ((settlement.resources.silver || 0) < silverNeed) out = (settlement.resources.silver || 0) / 0.3;
    if ((settlement.resources.wood || 0) < woodNeed) out = Math.min(out, (settlement.resources.wood || 0) / 0.6);
    if (out <= 0.00001) return;
    settlement.resources.silver -= out * 0.3;
    settlement.resources.wood -= out * 0.6;
    settlement.resources.coin = (settlement.resources.coin || 0) + out;
  };

  // =========================================================
  // Construction / repair / training / research
  // =========================================================
  P._updateConstruction = function (days) {
    for (const b of this.buildings) {
      if (b.dead) continue;
      const needs = (!b.complete) || b.upgrade || b.converting;
      if (!needs) continue;
      const faction = this.getFaction(b.owner);
      if (!faction || faction.eliminated) continue;
      const mod = this._mod(faction);
      let power = 0;
      if (faction.isPlayer) {
        b.constructors = (b.constructors || []).filter((id) => {
          const u = this.getUnit(id);
          return u && !u.dead && u.state === 'constructing' && u.buildingId === b.id;
        });
        for (const id of b.constructors) {
          const u = this.getUnit(id);
          if (u.kind === 'builder') power += 2;
          else power += 1;
        }
      } else if (faction.ai) {
        power = 0.9 * (faction.ai.eco || 1) + 0.25;
      }
      if (power <= 0) continue;
      if (faction.isPlayer && this.timeDays - (this._lastBuildHammer || -99) > 0.18) {
        this._lastBuildHammer = this.timeDays;
        const center = this.buildingCenter(b);
        this.sfx('hammer', center.x, center.y);
      }
      const speed = 1 + (mod.build || 0);
      b.buildProgress = (b.buildProgress || 0) + power * speed * days;
      if (b.buildProgress >= (b.buildRequired || 1)) this._finishBuilding(b);
    }
  };

  P._ejectConstructors = function (b, notify) {
    for (const id of b.constructors || []) {
      const u = this.getUnit(id);
      if (!u) continue;
      u.state = 'idle';
      u.task = null;
      u.order = null;
      u.buildingId = null;
    }
    b.constructors = [];
  };

  P._finishBuilding = function (b) {
    if (b.dead) return;
    const faction = this.getFaction(b.owner);
    const settlement = this.getSettlement(b.settlementId);
    b.buildProgress = b.buildRequired || b.buildProgress;
    this._ejectConstructors(b);
    this.sfx('complete', b.x, b.y);
    this.emit('buildingComplete', b);
    if (b.converting) {
      b.converting = false;
      b.defId = 'gate';
      b.def = D.BUILD.gate;
      b.open = false;
      b.buildProgress = 0;
      b.buildRequired = 0;
      b.maxHp = D.buildingHp(b.def, b.level);
      b.hp = b.maxHp;
      this.path.rebuildAll(this);
      if (faction && faction.isPlayer) this.notify('围墙已经改建为大门。点击大门可以开启或关闭。', 'build', { settlementId: b.settlementId });
      return;
    }
    if (b.upgrade) {
      const target = b.upgrade.targetLevel;
      const oldName = D.buildingName(b.def, b.level);
      b.level = target;
      b.upgrade = null;
      b.complete = true;
      b.buildProgress = 0;
      b.buildRequired = 0;
      b.maxHp = D.buildingHp(b.def, b.level);
      b.hp = b.maxHp;
      if (b.defId === 'house') { b.growthTarget = null; b.growthProgress = 0; }
      if (b.defId === 'hall' && settlement) {
        settlement.stage = b.level;
        settlement.hallId = b.id;
        if (b.level === 4) {
          settlement.occupiedUntil = 0;
        }
        this.updateRank(faction);
        if (faction && faction.isPlayer) {
          this.notify(`${D.STAGE_HALL_NAMES[b.level]}落成，「${settlement.name}」现已成为${D.STAGE_NAMES[b.level]}。新的建筑与制度已经解锁。`, 'rank', { important: true, settlementId: settlement.id });
          if (settlement.stage === 4) {
            this.notify(`${D.realmFullName(faction)}的宫廷迁入王宫。一个帝国时代开始了。`, 'rank', { important: true });
          }
        }
        if (faction && faction.ai) settlement.stage = b.level;
      } else {
        if (faction && faction.isPlayer) this.notify(`${oldName}完成升级，现在是${D.buildingName(b.def, b.level)}。`, 'build', { settlementId: b.settlementId });
      }
      this.refreshNodeBoosts();
      if (faction && faction.ai && this._aiOnBuildingComplete) this._aiOnBuildingComplete(b);
      return;
    }
    // new construction
    b.complete = true;
    b.hp = b.maxHp;
    b.buildProgress = b.buildRequired;
    b.buildRequired = 0;
    b.growthProgress = 0;
    b.growthTarget = null;
    if (settlement && b.defId === 'hall') settlement.stage = b.level;
    if (faction && faction.isPlayer) {
      this.notify(`${D.buildingName(b.def, b.level)}已经落成。`, 'build', { settlementId: b.settlementId });
    }
    this.refreshNodeBoosts();
    if (faction && faction.ai && this._aiOnBuildingComplete) this._aiOnBuildingComplete(b);
  };

  P._updateRepair = function (days) {
    for (const b of this.buildings) {
      if (b.dead || !b.complete) continue;
      if (!b.repairers || !b.repairers.length) continue;
      b.repairers = b.repairers.filter((id) => {
        const u = this.getUnit(id);
        return u && !u.dead && u.state === 'repairing' && u.buildingId === b.id;
      });
      if (!b.repairers.length) continue;
      if (b.hp >= b.maxHp - 0.2) {
        for (const id of b.repairers) {
          const u = this.getUnit(id);
          if (u) { u.state = 'idle'; u.task = null; u.order = null; u.buildingId = null; }
        }
        b.repairers = [];
        continue;
      }
      const faction = this.getFaction(b.owner);
      const speed = 1 + ((faction && this._mod(faction).build) || 0);
      let rate = 0;
      for (const id of b.repairers) {
        const u = this.getUnit(id);
        rate += (u.kind === 'builder' ? 0.09 : 0.045);
      }
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * rate * speed * days);
    }
  };

  P._updateTraining = function (days) {
    for (const b of this.buildings) {
      if (b.dead || !b.complete || !b.trainingQueue || !b.trainingQueue.length) continue;
      const faction = this.getFaction(b.owner);
      const settlement = this.getSettlement(b.settlementId);
      if (!faction || !settlement) continue;
      const q = b.trainingQueue[0];
      const ud = D.UNITS[q.kind];
      if (!ud) { b.trainingQueue.shift(); continue; }
      if (!ud.isShip && !this.canAddPop(faction.id)) continue;
      q.progress += days * (1 + (faction.ai ? 0.15 * faction.ai.eco : 0));
      if (q.progress < q.days) continue;
      let spawn = null;
      if (ud.isShip) {
        const c = this.buildingCenter(b);
        let water = null;
        for (let r = 1; r <= 8 && !water; r++) {
          for (const p of this._ringTiles(Math.round(c.x), Math.round(c.y), r)) {
            if (this.path.isWalkable(p.x, p.y, true)) { water = p; break; }
          }
        }
        if (!water) continue;
        spawn = this._spawnUnit(q.kind, faction.id, settlement.id, water.x + 0.5, water.y + 0.5);
      } else {
        const at = this.approachTileForBuilding(b, b.x + b.def.foot[0] / 2, b.y + b.def.foot[1] / 2) || { x: b.x, y: b.y };
        spawn = this._spawnUnit(q.kind, faction.id, settlement.id, at.x + 0.5, at.y + 0.5);
        if (spawn) spawn.order = { type: 'idle' };
      }
      b.trainingQueue.shift();
      if (faction.isPlayer) {
        this.notify(`${ud.name}训练完成，已在${D.buildingName(b.def, b.level)}集结。`, 'military', { settlementId: settlement.id });
        this.sfx(ud.isShip ? 'ship' : 'muster', b.x, b.y);
      }
      if (faction.ai) this.emit('aiTrained', faction, spawn);
    }
  };

  P._updateResearch = function (days) {
    for (const f of this.factions) {
      if (f.eliminated || !f.activeResearch) continue;
      const tech = D.TECHS[f.activeResearch.techId];
      if (!tech) { f.activeResearch = null; continue; }
      let rate = 0;
      const contributors = [];
      for (const b of this.buildings) {
        if (b.dead || !b.complete || b.owner !== f.id) continue;
        if (!b.def.researchTier || b.def.researchTier !== tech.tier) continue;
        b.workers = (b.workers || []).filter((id) => {
          const u = this.getUnit(id);
          return u && !u.dead && u.state === 'inside' && u.buildingId === b.id;
        });
        const workers = b.workers.length;
        if (!workers) continue;
        const base = (b.def.researchBase && b.def.researchBase[b.level]) || 0;
        const per = (b.def.researchPerWorker && b.def.researchPerWorker[b.level]) || 0;
        rate += base + per * workers;
        contributors.push(b);
      }
      if (!rate) continue;
      f.activeResearch.progress = (f.activeResearch.progress || 0) + rate * days;
      if (f.activeResearch.progress >= tech.points) {
        f.activeResearch = null;
        if (!f.techs.includes(tech.id)) f.techs.push(tech.id);
        this.recomputeModifiers(f);
        if (f.isPlayer) {
          this.notify(`研究完成：「${tech.name}」（${tech.branchName} ${U.roman(tech.tier)}）。${tech.effectText}`, 'tech', { important: true });
          this.sfx('complete');
        } else {
          this.notify(`${D.realmFullName(f)}的学者完成了「${tech.name}」。`, 'world');
        }
        this.emit('researchComplete', f, tech);
      }
    }
  };

  // =========================================================
  // Healing
  // =========================================================
  P._updateHealing = function (days) {
    for (const b of this.buildings) {
      if (b.dead || !b.complete) continue;
      const settlement = this.getSettlement(b.settlementId);
      const faction = this.getFaction(b.owner);
      if (!settlement || !faction) continue;
      const mod = this._mod(faction);
      if (b.defId === 'clinic') {
        b.patients = (b.patients || []).filter((id) => {
          const u = this.getUnit(id);
          return u && !u.dead && u.state === 'patient' && u.buildingId === b.id;
        });
        for (const id of b.patients.slice()) {
          const u = this.getUnit(id);
          if (!u) continue;
          if (u.hp >= u.maxHp - 0.2) { this._dischargePatient(b, u); continue; }
          const herbCost = 0.45 * days;
          if ((settlement.resources.herb || 0) < herbCost) continue;
          settlement.resources.herb -= herbCost;
          u.hp = Math.min(u.maxHp, u.hp + u.maxHp * (b.def.healRate[b.level] || 0.2) * (1 + (mod.heal || 0)) * days);
          u.lastHeal = this.timeDays;
          if (u.hp >= u.maxHp - 0.05) this._dischargePatient(b, u);
        }
      } else if (b.defId === 'hospital') {
        const radius = (b.def.auraRadius && b.def.auraRadius[b.level]) || 0;
        const healRate = (b.def.auraHeal && b.def.auraHeal[b.level]) || 0;
        if (!radius || !healRate) continue;
        const c = this.buildingCenter(b);
        for (const u of this.units) {
          if (u.owner !== b.owner || u.dead || !u.def.military || u.state === 'aboard' || u.state === 'inside') continue;
          if (u.hp >= u.maxHp - 0.1) continue;
          if (U.dist(u.x, u.y, c.x, c.y) > radius) continue;
          const herb = 0.3 * days;
          if ((settlement.resources.herb || 0) < herb) continue;
          settlement.resources.herb -= herb;
          u.hp = Math.min(u.maxHp, u.hp + u.maxHp * healRate * (1 + (mod.heal || 0)) * days);
          u.lastHeal = this.timeDays;
        }
      }
    }
    // civilians recover slowly out of danger.
    for (const u of this.units) {
      if (u.dead || u.def.cls !== 'civilian' || u.state === 'aboard') continue;
      if (u.hp >= u.maxHp) continue;
      if (this.timeDays - (u.lastDamaged || -999) < 1.1) continue;
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.075 * days);
    }
  };

  P._dischargePatient = function (b, u) {
    const i = (b.patients || []).indexOf(u.id);
    if (i >= 0) b.patients.splice(i, 1);
    u.state = 'idle';
    u.buildingId = null;
    u.task = null;
    u.order = null;
    const at = this.approachTileForBuilding(b, u.x, u.y) || { x: b.x + b.def.foot[0], y: b.y };
    u.x = at.x + 0.5;
    u.y = at.y + 0.5;
    if (this.getFaction(u.owner) && this.getFaction(u.owner).isPlayer) this.notify(`${D.UNITS[u.kind].name}的伤势已经痊愈，离开诊所。`, 'military');
  };

  // =========================================================
  // Unit movement / arrival / gathering / civic work
  // =========================================================
  P._updateUnitMovement = function (dt, days) {
    for (const u of this.units) {
      if (u.dead) continue;
      if (u.isShip) {
        if (u.state !== 'moving' || !u.path || !u.path.length) continue;
        this._moveAlongPath(u, dt);
        continue;
      }
      if (['inside', 'aboard', 'patient', 'constructing', 'repairing'].includes(u.state)) continue;
      if (u.state === 'moving' && u.path && u.path.length) this._moveAlongPath(u, dt);
      else if (u.state === 'moving' && (!u.path || !u.path.length)) {
        u.state = 'idle';
        this._onUnitArrive(u);
      }
      if ((u.carry && Object.values(u.carry).some((v) => v > 0.01)) || (u.bonus && Object.values(u.bonus).some((v) => v > 0.01))) {
        u.hasCargo = true;
      } else u.hasCargo = false;
    }
  };

  P._moveAlongPath = function (u, dt) {
    const f = this.getFaction(u.owner);
    let speed = u.def.speed || 1.7;
    if (f && u.def.cavalry && !u.isShip) speed *= 1 + (this._mod(f).cavSpeed || 0);
    let remaining = speed * dt;
    let guard = 0;
    while (remaining > 0.00001 && guard++ < 30) {
      const p = u.path[0];
      if (!p) break;
      const dx = p.x - u.x, dy = p.y - u.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.045) {
        u.x = p.x; u.y = p.y;
        u.path.shift();
        if (!u.path.length) { u.state = 'idle'; this._onUnitArrive(u); return; }
        continue;
      }
      const tileMul = u.isShip ? 1 : this.path.pathSpeedMultiplier(Math.floor(u.x), Math.floor(u.y), false);
      const step = remaining * Math.max(0.5, tileMul);
      if (step >= d) {
        u.x = p.x; u.y = p.y;
        u.facing = Math.atan2(dy, dx);
        remaining -= d / Math.max(0.5, tileMul);
        u.path.shift();
        if (!u.path.length) { u.state = 'idle'; this._onUnitArrive(u); return; }
      } else {
        u.x += (dx / d) * step;
        u.y += (dy / d) * step;
        u.facing = Math.atan2(dy, dx);
        remaining = 0;
      }
    }
  };

  P._onUnitArrive = function (u) {
    u.path = [];
    const task = u.task;
    if (task) {
      if (task.type === 'construct') {
        const b = this.getBuilding(task.buildingId);
        if (b && !b.dead && (!b.complete || b.upgrade || b.converting)) {
          if (!b.constructors.includes(u.id)) b.constructors.push(u.id);
          u.state = 'constructing';
          u.buildingId = b.id;
          u.task = { type: 'construct', buildingId: b.id };
          u.order = { type: 'construct', buildingId: b.id };
          return;
        }
        u.task = null; u.order = null; u.state = 'idle'; return;
      }
      if (task.type === 'enterWork') {
        const b = this.getBuilding(task.buildingId);
        if (b && !b.dead && b.complete) {
          const slots = D.buildingSlots(b.def, b.level);
          if (b.workers.length < slots) {
            b.workers.push(u.id);
            u.state = 'inside';
            u.buildingId = b.id;
            u.task = null;
            u.order = { type: 'work', buildingId: b.id };
            this.refreshNodeBoosts();
            return;
          }
        }
        u.task = null; u.order = null; u.state = 'idle'; return;
      }
      if (task.type === 'repair') {
        const b = this.getBuilding(task.buildingId);
        if (b && !b.dead && b.complete && b.hp < b.maxHp) {
          if (!b.repairers.includes(u.id)) b.repairers.push(u.id);
          u.state = 'repairing';
          u.buildingId = b.id;
          u.task = { type: 'repair', buildingId: b.id };
          u.order = { type: 'repair', buildingId: b.id };
          return;
        }
        u.task = null; u.order = null; u.state = 'idle'; return;
      }
      if (task.type === 'gather') {
        if (task.phase === 'return') {
          const storage = this._nearestStorage(u.owner, u.x, u.y);
          if (storage) this._depositCarry(u, storage);
          const node = this.world.nodes.find((n) => n.id === task.nodeId);
          if (node && node.alive && node.amount > 0.1) {
            const at = this._approachNode(node, u.x, u.y);
            task.phase = 'to';
            if (this._setUnitPath(u, at.x, at.y, { allowPartial: true })) { u.order = { type: 'gather', nodeId: node.id }; return; }
          }
          u.task = null; u.order = null; u.state = 'idle'; return;
        }
        const node = this.world.nodes.find((n) => n.id === task.nodeId);
        if (!node || !node.alive) { u.task = null; u.order = null; u.state = 'idle'; return; }
        u.state = 'gathering';
        u.order = { type: 'gather', nodeId: node.id };
        return;
      }
      if (task.type === 'clear') {
        const node = this.world.nodes.find((n) => n.id === task.nodeId);
        if (!node || !node.alive) { u.task = null; u.order = null; u.state = 'idle'; return; }
        if (!node.clearing) node.clearing = { units: [], progress: 0 };
        if (!node.clearing.required) node.clearing.required = (D.NODES[node.type].clearDays || 4) * (0.6 + node.max / 300);
        if (!node.clearing.units.includes(u.id)) node.clearing.units.push(u.id);
        u.state = 'clearing';
        u.order = { type: 'clear', nodeId: node.id };
        u.task = { type: 'clear', nodeId: node.id };
        return;
      }
      if (task.type === 'clinic') {
        const b = this.getBuilding(task.buildingId);
        if (b && !b.dead && b.defId === 'clinic' && b.patients.length < Math.max(1, b.def.patientCap[b.level])) {
          b.patients.push(u.id);
          u.state = 'patient';
          u.buildingId = b.id;
          u.task = null;
          u.order = { type: 'patient', buildingId: b.id };
          return;
        }
        u.task = null; u.order = null; u.state = 'idle'; return;
      }
      if (task.type === 'board') {
        const ship = this.getUnit(task.shipId);
        if (ship && !ship.dead && ship.isShip && ship.owner === u.owner && ship.passengers.length < (ship.def.capacity || 6)) {
          const shore = this._shipShoreTile(ship);
          if (shore && U.dist(u.x, u.y, shore.x + 0.5, shore.y + 0.5) <= 1.6) {
            this._embark(u, ship);
            return;
          }
        }
        u.task = null; u.order = null; u.state = 'idle';
        return;
      }
      if (task.type === 'tradeDeliver') {
        if (this._deliverTradeMerchant) {
          const done = this._deliverTradeMerchant(u);
          if (done) return;
        }
        u.task = null; u.order = null; u.state = 'idle'; return;
      }
      if (task.type === 'merchantUnload') {
        const market = this.getBuilding(task.marketId);
        if (market && !market.dead && market.complete) {
          const r = this.unloadMerchantCargo(u.id);
          const f = this.getFaction(u.owner);
          if (r.ok) {
            if (f && f.isPlayer) {
              const s = this.getSettlement(market.settlementId);
              this.notify(`商人抵达「${s ? s.name : '集市'}」并卸下了货物。`, 'trade', { important: false });
            }
            u.task = null;
            u.order = null;
            u.state = 'idle';
            return;
          }
        }
        u.task = null; u.order = null; u.state = 'idle'; return;
      }
    }
    if (u.order && u.order.type === 'attack') {
      const target = u.order.targetKind === 'building' ? this.getBuilding(u.order.targetId) : this.getUnit(u.order.targetId);
      if (target && !target.dead) {
        u.target = { kind: u.order.targetKind, id: target.id };
        u.state = 'attacking';
      } else {
        u.order = null; u.target = null; u.state = 'idle';
      }
      return;
    }
    if (u.order && u.order.type === 'move') {
      u.state = 'idle'; u.order = null; return;
    }
    if (u.order && u.order.type === 'patrol') { u.state = 'idle'; return; }
    u.state = 'idle';
    if (u.order && ['work'].includes(u.order.type)) u.order = null;
  };

  P._depositCarry = function (u, storage) {
    const s = this.getSettlement(storage.settlementId);
    if (!s) return 0;
    let total = 0;
    for (const [k, v] of Object.entries(u.carry || {})) {
      if (v <= 0.001) continue;
      const add = this.addResource(s, k, v);
      total += add;
      delete u.carry[k];
    }
    for (const [k, v] of Object.entries(u.bonus || {})) {
      if (v <= 0.001) continue;
      this.addResource(s, k, v);
      delete u.bonus[k];
    }
    u.hasCargo = false;
    if (total > 0 && this.getFaction(u.owner) && this.getFaction(u.owner).isPlayer) this.sfx('deposit', u.x, u.y);
    return total;
  };

  P._updateGathering = function (days) {
    for (const u of this.units) {
      if (u.dead || u.state !== 'gathering' || !u.task || u.task.type !== 'gather') continue;
      const node = this.world.nodes.find((n) => n.id === u.task.nodeId);
      if (!node || !node.alive) {
        u.task = null; u.order = null; u.state = 'idle'; continue;
      }
      if (node.amount <= 0.05) {
        const faction = this.getFaction(u.owner);
        if (faction && faction.isPlayer && (!node._depletedNotifiedAt || this.timeDays - node._depletedNotifiedAt > 2)) {
          node._depletedNotifiedAt = this.timeDays;
          this.notify('这处资源点暂时枯竭了。它会随时间恢复，也可以让居民清除它。', 'warn');
        }
        u.task = null; u.order = null; u.state = 'idle'; continue;
      }
      const meta = D.NODES[node.type];
      const faction = this.getFaction(u.owner);
      const mod = this._mod(faction);
      const techKey = meta.resource === 'wood' ? 'wood' : 'food';
      const rate = meta.gather * (1 + (mod[techKey] || 0)) * (node.gatherBoost || 1) * days;
      const cap = u.def.carry || 20;
      const carried = Object.values(u.carry || {}).reduce((a, b) => a + b, 0);
      const room = Math.max(0, cap - carried);
      if (room <= 0.01) {
        this._sendGathererHome(u);
        continue;
      }
      const gain = Math.min(rate, room, node.amount);
      if (gain <= 0.00001) continue;
      node.amount -= gain;
      const res = meta.resource;
      u.carry = u.carry || {};
      u.carry[res] = (u.carry[res] || 0) + gain;
      u.hasCargo = true;
      if (faction && faction.isPlayer && this.timeDays - (this._lastGatherNoise || -99) > 0.12) {
        this._lastGatherNoise = this.timeDays;
        this.sfx(node.type === 'tree' ? 'chop' : 'rustle', node.x, node.y);
      }
      // chance byproducts, proportional to the amount gathered
      if (res === 'wood') {
        this._chanceBonus(u, 'herb', gain * 0.045);
        this._chanceBonus(u, 'food', gain * 0.028);
      } else if (res === 'food') {
        this._chanceBonus(u, 'herb', gain * 0.075 * (node.herbBoost || 1));
      }
      u.facing = 0;
      if (Object.values(u.carry).reduce((a, b) => a + b, 0) >= cap - 0.05) this._sendGathererHome(u);
    }
  };

  P._chanceBonus = function (u, res, expected) {
    if (expected <= 0) return;
    u.bonus = u.bonus || {};
    if (expected >= 1) {
      const n = Math.floor(expected);
      u.bonus[res] = (u.bonus[res] || 0) + n;
      expected -= n;
    }
    if (this.rng.chance(expected)) {
      u.bonus[res] = (u.bonus[res] || 0) + 1;
    }
  };

  P._settlementChance = function (s, res, expected) {
    if (expected <= 0) return 0;
    let n = 0;
    if (expected >= 1) { n += Math.floor(expected); expected -= Math.floor(expected); }
    if (this.rng.chance(expected)) n++;
    if (n) return this._addWithCaps(s, res, n);
    return 0;
  };

  P._sendGathererHome = function (u) {
    const storage = this._nearestStorage(u.owner, u.x, u.y);
    if (!storage) {
      u.state = 'idle';
      u.task = null; u.order = null;
      if (this.getFaction(u.owner) && this.getFaction(u.owner).isPlayer) this.notify('没有可用于存放物资的村庄大厅或仓库。', 'warn');
      return;
    }
    const at = this.approachTileForBuilding(storage, u.x, u.y);
    if (!at) { u.state = 'idle'; return; }
    const nodeId = u.task.nodeId;
    u.task.phase = 'return';
    u.order = { type: 'gather', nodeId };
    if (!this._setUnitPath(u, at.x, at.y, { allowPartial: true })) {
      // The worker is stranded; deposit if already near, else become idle.
      u.state = 'idle';
      u.task = null;
      u.order = null;
    }
  };

  P._updateClearings = function (days) {
    for (const node of this.world.nodes) {
      if (!node.alive || !node.clearing) continue;
      const clr = node.clearing;
      clr.required = clr.required || (D.NODES[node.type].clearDays || 4) * (0.6 + node.max / 300);
      clr.units = clr.units.filter((id) => {
        const u = this.getUnit(id);
        return u && !u.dead && u.state === 'clearing' && u.task && u.task.type === 'clear' && u.task.nodeId === node.id;
      });
      if (!clr.units.length) { node.clearing = null; continue; }
      clr.progress = (clr.progress || 0) + clr.units.length * days;
      if (clr.progress >= clr.required) {
        const player = clr.units.some((id) => { const u = this.getUnit(id); return u && this.getFaction(u.owner) && this.getFaction(u.owner).isPlayer; });
        for (const id of clr.units) {
          const u = this.getUnit(id);
          if (u) { u.state = 'idle'; u.task = null; u.order = null; }
        }
        this.world.removeNode(node);
        node.clearing = null;
        if (player) {
          this.notify(`${D.NODES[node.type].name}已经被彻底清除。这片土地现在可以用于建设。`, 'build');
          this.sfx('clear', node.x, node.y);
        }
      }
    }
  };

  P._cleanupOrphanReferences = function () {
    const usize = new Set(this.units.map((u) => u.id));
    const bsize = new Set(this.buildings.map((b) => b.id));
    for (const b of this.buildings) {
      if (b.dead) continue;
      b.workers = (b.workers || []).filter((id) => usize.has(id));
      b.constructors = (b.constructors || []).filter((id) => usize.has(id));
      b.repairers = (b.repairers || []).filter((id) => usize.has(id));
      b.patients = (b.patients || []).filter((id) => usize.has(id));
    }
    for (const u of this.units) {
      if (u.buildingId && !bsize.has(u.buildingId)) {
        u.buildingId = null;
        if (['inside', 'constructing', 'repairing', 'patient'].includes(u.state)) u.state = 'idle';
      }
    }
    for (const s of this.settlements) {
      if (!s.ruined && !s.hallId) {
        const hall = this.buildings.find((b) => b.settlementId === s.id && b.defId === 'hall' && !b.dead);
        if (hall) s.hallId = hall.id;
      }
    }
  };

  // =========================================================
  // Effects / cleanup
  // =========================================================
  P._updateEffects = function (dt) {
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);
    if (this.projectiles) {
      for (const p of this.projectiles) p.life -= dt;
      this.projectiles = this.projectiles.filter((p) => p.life > 0);
    }
  };

  P.addEffect = function (type, x, y, life, data) {
    this.effects.push(Object.assign({ type, x, y, life, maxLife: life }, data || {}));
    if (this.effects.length > 220) this.effects.splice(0, this.effects.length - 220);
  };

  P._cleanupDead = function () {
    let changed = false;
    for (const u of this.units) {
      if (!u.dead) continue;
      changed = true;
      this._handleUnitDeath(u);
    }
    if (changed) this.units = this.units.filter((u) => !u.dead);
    const deadBuildings = this.buildings.filter((b) => b.dead);
    if (deadBuildings.length) this.path.rebuildAll(this);
    this.buildings = this.buildings.filter((b) => !b.dead);
  };

  P._handleUnitDeath = function (u) {
    if (u.isShip) {
      for (const pid of u.passengers || []) {
        const p = this.getUnit(pid);
        if (p) { p.dead = true; p._killedByShip = true; }
      }
      if (this.getFaction(u.owner) && this.getFaction(u.owner).isPlayer) {
        this.notify(`${D.UNITS[u.kind] ? D.UNITS[u.kind].name : '船只'}被击沉，船上的乘客葬身水底。`, 'navyLoss');
      }
    }
    if (u.buildingId) {
      const b = this.getBuilding(u.buildingId);
      if (b) {
        b.workers = (b.workers || []).filter((id) => id !== u.id);
        b.constructors = (b.constructors || []).filter((id) => id !== u.id);
        b.repairers = (b.repairers || []).filter((id) => id !== u.id);
        b.patients = (b.patients || []).filter((id) => id !== u.id);
      }
    }
    if (u.kind === 'merchant' && u.cargo && Object.keys(u.cargo).length) {
      // cargo is lost with the merchant
      u.cargo = {};
    }
    if (u.task && u.task.type === 'clear') {
      const node = this.world.nodes.find((n) => n.id === u.task.nodeId);
      if (node && node.clearing) node.clearing.units = node.clearing.units.filter((id) => id !== u.id);
    }
  };
})();
