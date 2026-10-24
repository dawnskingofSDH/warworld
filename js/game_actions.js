/* WARWORLD — player / AI action layer: building, work, units, ships, markets, research. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const Game = WW.Game;
  const P = Game.prototype;

  // =========================================================
  // Building placement
  // =========================================================
  P.canPlaceBuilding = function (defId, settlementId, x, y, opts) {
    opts = opts || {};
    const def = D.BUILD[defId];
    const settlement = this.getSettlement(settlementId);
    if (!def) return { ok: false, error: '未知建筑' };
    if (!settlement || settlement.ruined) return { ok: false, error: '无效的定居点' };
    if (def.id === 'hall') return { ok: false, error: '新的村庄大厅只能通过建立定居点产生' };
    if (def.buildMode === 'line' || def.buildOutside) return { ok: false, error: '此类工程需使用拖拽建造' };
    if ((settlement.stage || 1) < (def.minLevel || 1)) return { ok: false, error: `需要定居点达到${D.STAGE_NAMES[def.minLevel]}阶段` };
    if (opts.factionId && settlement.owner !== opts.factionId) return { ok: false, error: '这不是你的定居点' };
    const level = WW.levelForPlacement(def, settlement, opts.level);
    const result = this.requirementCheck(def, x, y, settlement, opts.ignoreCost, level);
    if (!result.ok) return result;
    const cost = result.cost;
    return { ok: true, cost, level, def };
  };

  P.canPlaceLineTile = function (defId, settlementId, x, y, opts) {
    opts = opts || {};
    const def = D.BUILD[defId];
    const settlement = this.getSettlement(settlementId);
    if (!def || def.buildMode !== 'line') return { ok: false, error: '这不是拖拽工程' };
    if (!settlement || settlement.ruined) return { ok: false, error: '无效的定居点' };
    if (opts.factionId && settlement.owner !== opts.factionId) return { ok: false, error: '这不是你的定居点' };
    if (!this.world.inBounds(x, y)) return { ok: false, error: '超出世界边界' };
    const existing = this._buildingsAt(x, y);
    if (existing) {
      if (existing.defId === 'road') return { ok: true, cost: D.buildingCost(def, 1), level: 1, replaceRoad: existing.id };
      return { ok: false, error: '此处已有建筑' };
    }
    const td = this.world.terrainDef(x, y);
    const node = this.world.nodeAt(x, y);
    if (defId === 'road') {
      if (!td.pass && !td.mountain) return { ok: false, error: '道路必须建在陆地上' };
      if (td.mountain) return { ok: false, error: '高山无法铺设道路' };
      if (node && node.alive) return { ok: false, error: '需先清除资源点' };
    } else if (defId === 'bridge') {
      if (td.key !== 'river') return { ok: false, error: '桥梁只能建在河流上' };
    } else if (defId === 'tunnel') {
      if (!td.mountain) return { ok: false, error: '隧道只能开凿于高山' };
    } else if (defId === 'wall') {
      if (td.water || td.mountain) return { ok: false, error: '围墙只能建在陆地上' };
      if (node && node.alive) return { ok: false, error: '需先清除资源点' };
      if (!this._insideSettlement(settlement, x, y)) return { ok: false, error: '围墙必须在定居点领地内' };
    } else {
      return { ok: false, error: '未知工程' };
    }
    const level = defId === 'wall' ? WW.levelForPlacement(def, settlement, opts.level) : 1;
    if ((settlement.stage || 1) < (def.minLevel || 1)) return { ok: false, error: '定居点阶段不足' };
    const cost = D.buildingCost(def, level);
    if (!opts.ignoreCost && !this.canAfford(settlement, cost)) return { ok: false, error: '资源不足', cost, level };
    return { ok: true, cost, level, def, replaceRoad: null };
  };

  P._displaceUnitsInFootprint = function (x, y, w, h) {
    for (const u of this.units) {
      if (u.dead || u.isShip || u.state === 'inside' || u.state === 'aboard' || u.state === 'patient') continue;
      const tx = Math.floor(u.x), ty = Math.floor(u.y);
      if (tx < x || ty < y || tx >= x + w || ty >= y + h) continue;
      let spot = null;
      for (let r = 1; r <= 12 && !spot; r++) {
        for (const p of this._ringTiles(x + Math.floor(w / 2), y + Math.floor(h / 2), r + Math.max(w, h))) {
          if (p.x >= x && p.y >= y && p.x < x + w && p.y < y + h) continue;
          if (!this.path.isWalkable(p.x, p.y, false)) continue;
          if (this.units.some((v) => !v.dead && !v.isShip && v !== u && Math.floor(v.x) === p.x && Math.floor(v.y) === p.y)) continue;
          spot = p;
          break;
        }
      }
      if (!spot) return false;
      const priorTask = u.task ? Object.assign({}, u.task) : null;
      this.cancelUnitActivity(u, false);
      u.x = spot.x + 0.5;
      u.y = spot.y + 0.5;
      u.state = 'idle';
      u.task = null;
      u.order = null;
      u.target = null;
      u.path = [];
      // If the displaced unit was on its way somewhere, send it on its way again.
      if (priorTask) {
        try {
          if (priorTask.type === 'construct') this.assignConstructorIds([u.id], priorTask.buildingId, true);
          else if (priorTask.type === 'enterWork') this.assignWorkerIds([u.id], priorTask.buildingId);
          else if (priorTask.type === 'repair') this.assignRepairers([u.id], priorTask.buildingId);
          else if (priorTask.type === 'clinic') this.orderEnterClinic([u.id], priorTask.buildingId);
          else if (priorTask.type === 'gather') this.orderGather([u.id], priorTask.nodeId);
          else if (priorTask.type === 'clear') this.orderClearNode([u.id], priorTask.nodeId);
        } catch (e) { /* the old job may no longer exist; remain idle */ }
      }
    }
    return true;
  };

  P.placeBuilding = function (defId, settlementId, x, y, opts) {
    opts = opts || {};
    const settlement = this.getSettlement(settlementId);
    const faction = settlement && this.getFaction(settlement.owner);
    if (!faction) return { ok: false, error: '无效阵营' };
    const preview = this.canPlaceBuilding(defId, settlementId, x, y, {
      factionId: opts.requireOwner ? faction.id : undefined,
      level: opts.level
    });
    if (!preview.ok) return preview;
    if (opts.forbidPlayer && faction.isPlayer) return { ok: false, error: '不适用于玩家' };
    if (!this._displaceUnitsInFootprint(x, y, preview.def.foot[0], preview.def.foot[1])) return { ok: false, error: '此处有单位，无法清出空间' };
    if (!this.payCost(settlement, preview.cost)) return { ok: false, error: '资源不足' };
    this._clearRoadsIn(x, y, preview.def.foot[0], preview.def.foot[1]);
    const b = this._createBuilding(defId, faction.id, settlement, x, y, preview.level, false);
    b.buildProgress = 0;
    b.buildRequired = D.buildingDays(preview.def, preview.level);
    this.path.rebuildAll(this);
    if (faction.isPlayer) {
      this.notify(`${preview.def.name}的地基已经放下，需有居民或建筑工前来施工。`, 'build', { settlementId });
      this._autoConstructor(b);
      this.sfx('build_place', x, y);
    }
    return { ok: true, building: b, cost: preview.cost };
  };

  P._clearRoadsIn = function (x, y, w, h) {
    let changed = false;
    for (const b of this.buildings) {
      if (b.dead || b.defId !== 'road') continue;
      if (b.x >= x && b.x < x + w && b.y >= y && b.y < y + h) {
        b.dead = true;
        changed = true;
      }
    }
    if (changed) this.path.rebuildAll(this);
  };

  P.commitLine = function (defId, settlementId, tiles, opts) {
    opts = opts || {};
    const def = D.BUILD[defId];
    const settlement = this.getSettlement(settlementId);
    if (!def || !settlement) return { ok: false, error: '无效工程' };
    if (!tiles || !tiles.length) return { ok: false, error: '拖拽以规划工程' };
    if (tiles.length > 60) return { ok: false, error: '一次最多规划 60 格工程' };
    let built = 0, spent = {}, firstError = null;
    // Move anyone standing on the planned works before taking payment.
    for (const t of tiles) {
      if (!this._displaceUnitsInFootprint(t.x, t.y, 1, 1)) { firstError = '工程路线上有单位无法让开'; break; }
    }
    if (firstError) return { ok: false, built: 0, error: firstError };
    for (const t of tiles) {
      const chk = this.canPlaceLineTile(defId, settlementId, t.x, t.y, { level: opts.level });
      if (!chk.ok) { firstError = chk.error; break; }
      if (!this.payCost(settlement, chk.cost)) { firstError = '资源不足'; break; }
      for (const [k, v] of Object.entries(chk.cost)) spent[k] = (spent[k] || 0) + v;
      if (chk.replaceRoad) { const old = this.getBuilding(chk.replaceRoad); if (old) old.dead = true; }
      const b = this._createBuilding(defId, settlement.owner, settlement, t.x, t.y, chk.level, true);
      b.hp = b.maxHp;
      built++;
    }
    if (built) {
      this.path.rebuildAll(this);
      this.refreshNodeBoosts();
      this.sfx(defId === 'road' ? 'road' : defId === 'bridge' ? 'bridge' : 'build_place', tiles[0].x, tiles[0].y);
      if (defId === 'wall') {
        this.notify(`围墙已由工程队筑起 ${built} 段。点击任意围墙可开启升级或改建大门。`, 'build', { settlementId });
      } else if (defId === 'bridge') {
        this.notify(`一座 ${built} 格长的桥梁横跨水面。`, 'build', { settlementId });
      } else if (defId === 'tunnel') {
        this.notify(`高山的隧道已经开凿（${built} 格）。`, 'build', { settlementId });
      } else if (defId === 'road') {
        this.notify(`铺设了 ${built} 格道路，部队与商队将移动得更快。`, 'build', { settlementId });
      }
    }
    return { ok: built > 0, built, error: firstError, spent };
  };

  // =========================================================
  // Construction / upgrades / repair
  // =========================================================
  P._isIdleWorker = function (u) {
    return u && !u.dead && !u.isShip && (u.def.cls === 'civilian') && u.kind !== 'merchant' &&
      !u.insideBuilding && !u.shipId && u.state !== 'inside' && u.state !== 'aboard';
  };

  P._findIdleWorker = function (factionId, settlementId, opts) {
    opts = opts || {};
    const pool = this.units.filter((u) => {
      if (u.owner !== factionId || u.dead || u.isShip) return false;
      if (u.kind !== 'resident' && u.kind !== 'builder') return false;
      if (u.state === 'inside' || u.state === 'aboard' || u.shipId) return false;
      if (u.task) return false;
      if (opts.buildersFirst && u.kind === 'builder') return true;
      return u.state === 'idle';
    });
    pool.sort((a, b) => {
      const ak = a.kind === 'builder' ? -1000 : 0;
      const bk = b.kind === 'builder' ? -1000 : 0;
      const as = a.homeSettlement === settlementId ? 0 : 1;
      const bs = b.homeSettlement === settlementId ? 0 : 1;
      return (ak + as) - (bk + bs);
    });
    return pool[0] || null;
  };

  P._autoConstructor = function (b) {
    if (!b || b.dead) return;
    const faction = this.getFaction(b.owner);
    if (!faction || !faction.isPlayer) return;
    const unit = this._findIdleWorker(b.owner, b.settlementId, { buildersFirst: true });
    if (unit) {
      this.assignConstructorIds([unit.id], b.id, true);
    } else {
      this.notify('没有空闲的居民或建筑工。选中单位后右键工地，或在内政面板调度工人。', 'warn', { settlementId: b.settlementId });
    }
  };

  P.assignConstructorIds = function (unitIds, buildingId, silent) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead) return { ok: false, error: '工地不存在' };
    if (b.complete && !b.upgrade && !b.converting) return { ok: false, error: '该建筑已经完工' };
    let accepted = 0;
    const errors = [];
    for (const uid of unitIds || []) {
      const u = this.getUnit(uid);
      if (!u || u.owner !== b.owner || u.dead || u.isShip) { errors.push('单位无效'); continue; }
      if (u.def.cls !== 'civilian' || u.kind === 'merchant') { errors.push('商人不能参与施工'); continue; }
      if (u.state === 'aboard') { errors.push('单位正在船上'); continue; }
      if (b.constructors.length + accepted >= 6) { errors.push('工地最多容纳 6 名工匠'); break; }
      this.cancelUnitActivity(u, true);
      u.task = { type: 'construct', buildingId: b.id, phase: 'to' };
      u.order = { type: 'construct', buildingId: b.id };
      const at = this.approachTileForBuilding(b, u.x, u.y);
      if (!at) { u.task = null; u.order = null; errors.push('工地周围无法通行'); continue; }
      if (this._setUnitPath(u, at.x, at.y)) accepted++;
      else { u.task = null; u.order = null; errors.push('没有可通行的道路'); }
    }
    if (!silent && errors.length && !accepted) this.notify(errors[0], 'warn', { settlementId: b.settlementId });
    return { ok: accepted > 0, accepted, error: errors[0] || null };
  };

  P.assignRepairers = function (unitIds, buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead || !b.complete) return { ok: false, error: '建筑无效' };
    if (b.hp >= b.maxHp - 0.5) return { ok: false, error: '建筑没有损坏' };
    let accepted = 0;
    for (const uid of unitIds || []) {
      const u = this.getUnit(uid);
      if (!u || u.dead || u.owner !== b.owner || u.isShip) continue;
      if (u.def.cls !== 'civilian' || u.kind === 'merchant') continue;
      this.cancelUnitActivity(u, true);
      u.task = { type: 'repair', buildingId: b.id, phase: 'to' };
      u.order = { type: 'repair', buildingId: b.id };
      const at = this.approachTileForBuilding(b, u.x, u.y);
      if (at && this._setUnitPath(u, at.x, at.y)) accepted++;
      else { u.task = null; u.order = null; }
    }
    if (!accepted) return { ok: false, error: '没有可派遣的居民或建筑工' };
    return { ok: true, accepted };
  };

  P.startUpgrade = function (buildingId, opts) {
    opts = opts || {};
    const b = this.getBuilding(buildingId);
    if (!b || b.dead) return { ok: false, error: '建筑不存在' };
    if (!b.complete) return { ok: false, error: '建筑尚未完工' };
    if (b.upgrade) return { ok: false, error: '升级已在施工中' };
    const def = b.def;
    const settlement = this.getSettlement(b.settlementId);
    if (!settlement) return { ok: false, error: '建筑没有所属定居点' };
    if (b.defId === 'road' || b.defId === 'bridge' || b.defId === 'tunnel') return { ok: false, error: '此类工程无法升级' };
    const target = b.level + 1;
    if (target > def.maxLevel) return { ok: false, error: '已达到最高等级' };
    if (def.id !== 'hall' && (settlement.stage || 1) < target) return { ok: false, error: `需定居点达到${D.STAGE_NAMES[target]}阶段后才能升级` };
    if (def.id === 'hall' && target === 4) {
      const capital = this.capitalOf(b.owner);
      const claiming = this.buildings.some((x) => x !== b && x.owner === b.owner && x.defId === 'hall' && x.upgrade && x.upgrade.targetLevel === 4);
      if ((capital && capital.id !== b.settlementId) || claiming) return { ok: false, error: '每个阵营只能拥有一座王宫' };
    }
    const cost = D.upgradeCost(def, target);
    if (!cost) return { ok: false, error: '该建筑无法升级' };
    if (!this.canAfford(settlement, cost)) return { ok: false, error: '资源不足' };
    if (!this.payCost(settlement, cost)) return { ok: false, error: '资源不足' };
    b.upgrade = { targetLevel: target, cost, startedAt: this.timeDays };
    b.buildProgress = 0;
    b.buildRequired = D.buildingDays(def, target);
    b.constructors = [];
    this.path.rebuildAll(this);
    const faction = this.getFaction(b.owner);
    if (faction && faction.isPlayer) {
      this.notify(`${D.buildingName(def, b.level)}开始升级为${D.buildingName(def, target)}。需要有居民持续施工。`, 'build', { settlementId: settlement.id });
      this._autoConstructor(b);
      this.sfx('build_upgrade', b.x, b.y);
    }
    return { ok: true, target, cost };
  };

  P.cancelUpgrade = function (buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || !b.upgrade) return { ok: false, error: '没有正在进行的升级' };
    const settlement = this.getSettlement(b.settlementId);
    const refund = b.upgrade.cost || {};
    if (settlement) this.refundCost(settlement, refund, 0.5);
    for (const id of b.constructors || []) {
      const u = this.getUnit(id);
      if (u) { u.state = 'idle'; u.task = null; u.order = null; u.buildingId = null; }
    }
    b.constructors = [];
    b.upgrade = null;
    b.buildProgress = 0;
    return { ok: true };
  };

  P.assignWorkerIds = function (unitIds, buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead) return { ok: false, error: '建筑不存在' };
    if (!b.complete) return { ok: false, error: '建筑尚未完工' };
    if (b.defId === 'wall' || b.defId === 'gate' || b.defId === 'bridge' || b.defId === 'tunnel' || b.defId === 'road') return { ok: false, error: '该建筑无需工人' };
    const slots = D.buildingSlots(b.def, b.level);
    if (!slots) return { ok: false, error: '该建筑无需工人' };
    let accepted = 0;
    const errors = [];
    for (const uid of unitIds || []) {
      if (b.workers.length >= slots) { errors.push('工人名额已满'); break; }
      const u = this.getUnit(uid);
      if (!u || u.dead || u.owner !== b.owner) { errors.push('单位无效'); continue; }
      if (u.kind !== 'resident') { errors.push('只有普通居民能进入资源建筑工作（商人、建筑工与士兵不能）'); continue; }
      if (u.shipId) { errors.push('单位正在船上'); continue; }
      if (u.state === 'aboard') { errors.push('单位正在船上'); continue; }
      if (u.state === 'inside') { errors.push('该居民已受雇于其他建筑'); continue; }
      this.cancelUnitActivity(u, true);
      u.task = { type: 'enterWork', buildingId: b.id, phase: 'to' };
      u.order = { type: 'work', buildingId: b.id };
      const at = this.approachTileForBuilding(b, u.x, u.y);
      if (!at) { u.task = null; u.order = null; errors.push('无法抵达入口'); continue; }
      if (this._setUnitPath(u, at.x, at.y)) accepted++;
      else { u.task = null; u.order = null; errors.push('没有可通行的道路'); }
    }
    if (!accepted && errors.length) return { ok: false, error: errors[0] };
    return { ok: accepted > 0, accepted, error: errors[0] || null };
  };

  P.unassignWorker = function (buildingId, unitId) {
    const b = this.getBuilding(buildingId);
    if (!b) return { ok: false };
    const idx = b.workers.indexOf(unitId);
    if (idx < 0) return { ok: false, error: '该工人不在此处' };
    b.workers.splice(idx, 1);
    const u = this.getUnit(unitId);
    if (u) {
      u.state = 'idle';
      u.buildingId = null;
      u.task = null;
      u.order = null;
      const at = this.approachTileForBuilding(b, b.x + b.def.foot[0] / 2, b.y + b.def.foot[1] / 2) || { x: b.x, y: b.y - 1 };
      u.x = at.x + 0.5; u.y = at.y + 0.5;
    }
    return { ok: true };
  };

  P.fillBuildingWorkers = function (buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || !b.complete) return { ok: false };
    const slots = D.buildingSlots(b.def, b.level);
    let sent = 0;
    while (b.workers.length + sent < slots) {
      const u = this._findIdleWorker(b.owner, b.settlementId, {});
      if (!u) break;
      const res = this.assignWorkerIds([u.id], b.id);
      if (!res.ok) break;
      sent += res.accepted || 0;
    }
    return { ok: sent > 0, accepted: sent };
  };

  P.assignWorkersInstantAI = function (b, limit) {
    const slots = D.buildingSlots(b.def, b.level);
    if (!slots) return 0;
    let n = 0;
    while (b.workers.length < slots && n < (limit || slots)) {
      const u = this.units.find((x) => x.owner === b.owner && x.kind === 'resident' && !x.dead && x.state === 'idle' && !x.task && x.homeSettlement === b.settlementId);
      if (!u) break;
      u.state = 'inside';
      u.buildingId = b.id;
      u.task = null;
      b.workers.push(u.id);
      n++;
    }
    return n;
  };

  P.repairAtOnce = function (buildingId, unitIds) {
    return this.assignRepairers(unitIds, buildingId);
  };

  // Player-initiated demolition. Unlike combat destruction this never damages
  // the occupants and never involves war exhaustion; the player simply gives
  // up the structure (and any resources already invested in it).
  P.demolishBuilding = function (buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead) return { ok: false, error: '建筑不存在' };
    if (b.owner !== this.playerFactionId) return { ok: false, error: '只能拆除自己的建筑' };
    if (b.defId === 'hall') return { ok: false, error: '定居点大厅不能拆除。失去大厅会让定居点失去核心。' };
    const settlement = this.getSettlement(b.settlementId);
    if (!settlement || settlement.ruined) return { ok: false, error: '建筑没有有效的定居点' };
    const center = this.buildingCenter(b);
    const w = b.def.foot[0], h = b.def.foot[1];
    this._ejectOccupants(b, false);
    b.dead = true;
    b.demolishedAt = this.timeDays;
    if (!this._displaceUnitsInFootprint(b.x, b.y, w, h)) {
      b.dead = false;
      return { ok: false, error: '建筑周围没有空间安置单位，无法拆除' };
    }
    this.addEffect('ruin', center.x, center.y, 1.2, { color: '#635b4c' });
    this.path.rebuildAll(this);
    this.refreshNodeBoosts();
    this.notify(`你下令拆除了「${D.buildingName(b.def, b.level)}」。建筑已永久消失，投入的资源不会返还。`, 'build', { settlementId: settlement.id });
    this.sfx('collapse', center.x, center.y);
    this.emit('buildingDemolished', b);
    this._cleanupDead();
    this._cleanupOrphanReferences();
    return { ok: true, building: b };
  };

  // =========================================================
  // Walls & gates
  // =========================================================
  P.convertWallToGate = function (buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead || b.defId !== 'wall') return { ok: false, error: '只有围墙可以改建为大门' };
    if (!b.complete) return { ok: false, error: '围墙尚未建成' };
    if (b.upgrade || b.converting) return { ok: false, error: '工程正在进行中' };
    b.converting = true;
    b.buildProgress = 0;
    b.buildRequired = 0.8;
    b.convertTarget = 'gate';
    b.constructors = [];
    this._autoConstructor(b);
    if (this.getFaction(b.owner).isPlayer) this.notify('围墙正在被改建为大门，不消耗资源，但需要工匠施工。', 'build', { settlementId: b.settlementId });
    return { ok: true };
  };

  P.toggleGate = function (buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead || b.defId !== 'gate' || !b.complete) return { ok: false, error: '这不是一座完整的大门' };
    b.open = !b.open;
    this.path.rebuildAll(this);
    this.sfx('gate', b.x, b.y);
    if (this.getFaction(b.owner).isPlayer) this.notify(b.open ? `${D.buildingName(b.def, b.level)}已开启。` : `${D.buildingName(b.def, b.level)}已关闭。`, 'info');
    return { ok: true, open: b.open };
  };

  // =========================================================
  // Training / military
  // =========================================================
  P.availableUnitsFor = function (b) {
    if (!b || !b.def.training) return [];
    if (b.defId === 'dock') {
      const ship = D.shipForDockLevel(b.level);
      return b.level >= 2 ? [ship.id] : [];
    }
    return (D.TRAIN[b.defId] || []).filter((k) => (D.UNITS[k].costLevel || 1) <= b.level);
  };

  P.trainUnit = function (buildingId, unitKind) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead || !b.complete) return { ok: false, error: '建筑尚未完工' };
    if (!b.def.training) return { ok: false, error: '这里不能训练士兵' };
    if (!this.availableUnitsFor(b).includes(unitKind)) return { ok: false, error: '当前等级无法训练该兵种' };
    if (b.trainingQueue.length >= 3) return { ok: false, error: '训练队列已满（最多 3）' };
    const ud = D.UNITS[unitKind];
    const settlement = this.getSettlement(b.settlementId);
    if (!settlement) return { ok: false, error: '建筑没有所属定居点' };
    if (!ud.isShip && !this.canAddPop(b.owner)) return { ok: false, error: '人口上限已满，需要修建民宅' };
    const cost = ud.trainCost || {};
    if (!this.canAfford(settlement, cost)) return { ok: false, error: '资源不足' };
    if (!this.payCost(settlement, cost)) return { ok: false, error: '资源不足' };
    b.trainingQueue.push({ kind: unitKind, progress: 0, days: ud.trainDays || 3, cost });
    const faction = this.getFaction(b.owner);
    if (faction && faction.isPlayer) {
      this.notify(`${ud.name}已开始训练（${U.round(ud.trainDays, 1)} 天）。`, 'military', { settlementId: settlement.id });
      this.sfx('train', b.x, b.y);
    }
    return { ok: true };
  };

  P.cancelTraining = function (buildingId, index) {
    const b = this.getBuilding(buildingId);
    if (!b || !b.trainingQueue[index]) return { ok: false };
    const ent = b.trainingQueue.splice(index, 1)[0];
    const settlement = this.getSettlement(b.settlementId);
    if (settlement) this.refundCost(settlement, ent.cost, 0.5);
    return { ok: true };
  };

  // =========================================================
  // Markets, merchants, trade cargo
  // =========================================================
  P.hireMerchant = function (marketId) {
    const b = this.getBuilding(marketId);
    if (!b || b.dead || !b.complete || b.defId !== 'market') return { ok: false, error: '需要一座完工的集市' };
    const settlement = this.getSettlement(b.settlementId);
    const faction = this.getFaction(b.owner);
    if (!settlement || !faction) return { ok: false, error: '集市无效' };
    if (!this.canAddPop(b.owner)) return { ok: false, error: '人口上限已满' };
    const cost = { food: 18, coin: 12 };
    if (!this.canAfford(settlement, cost)) return { ok: false, error: '需要 18 食物与 12 银币' };
    this.payCost(settlement, cost);
    const at = this.approachTileForBuilding(b, b.x + b.def.foot[0] / 2, b.y + b.def.foot[1] / 2) || { x: b.x + 1, y: b.y + 2 };
    const u = this._spawnUnit('merchant', b.owner, settlement.id, at.x + 0.5, at.y + 0.5);
    const tradeMod = 1 + (this._mod(faction).merchantCap || 0);
    u.cargoCapacity = Math.round((b.def.merchantCap[b.level] || 20) * tradeMod);
    u.marketLevelAtHire = b.level;
    if (faction.isPlayer) {
      this.notify(`一名商人加入了你的麾下。商人载货上限为 ${u.cargoCapacity}。`, 'trade', { settlementId: settlement.id });
      this.sfx('coin', b.x, b.y);
    }
    return { ok: true, unit: u };
  };

  P._marketNear = function (x, y, includeForeign, ownerId, range) {
    let best = null, bestD = range || 5;
    for (const b of this.buildings) {
      if (b.dead || !b.complete || b.defId !== 'market') continue;
      if (ownerId && b.owner !== ownerId && !includeForeign) continue;
      const d = Math.hypot(this.buildingCenter(b).x - x, this.buildingCenter(b).y - y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  };

  P.loadMerchantCargo = function (merchantId, res, amount) {
    const u = this.getUnit(merchantId);
    if (!u || u.kind !== 'merchant' || u.dead) return { ok: false, error: '商人无效' };
    if (u.shipId) return { ok: false, error: '商人在船上' };
    const market = this._marketNear(u.x, u.y, false, u.owner, 5.5);
    if (!market) return { ok: false, error: '商人必须站在己方集市附近才能装货' };
    if (!D.RES[res]) return { ok: false, error: '未知资源' };
    amount = Math.floor(amount);
    if (amount <= 0) return { ok: false, error: '数量必须大于 0' };
    const cargo = Object.values(u.cargo || {}).reduce((a, b) => a + b, 0);
    const space = Math.max(0, (u.cargoCapacity || 20) - cargo);
    amount = Math.min(amount, space);
    if (amount <= 0) return { ok: false, error: '商队已经满载' };
    const settlement = this.getSettlement(market.settlementId);
    const available = Math.floor(settlement.resources[res] || 0);
    if (available <= 0) return { ok: false, error: '集市所在定居点没有该资源' };
    const actual = Math.min(amount, available);
    this.removeResource(settlement, res, actual);
    u.cargo = u.cargo || {};
    u.cargo[res] = (u.cargo[res] || 0) + actual;
    this.sfx('coin', u.x, u.y);
    return { ok: true, amount: actual, cargoCapacity: u.cargoCapacity };
  };

  P.orderMerchantsUnload = function (merchantIds, marketId) {
    const market = this.getBuilding(marketId);
    if (!market || market.dead || !market.complete || market.defId !== 'market') return { ok: false, error: '目标不是一座完工的集市' };
    if (!market.owner) return { ok: false, error: '目标集市已无主' };
    if (this.atWar(this.playerFactionId, market.owner)) return { ok: false, error: '不能与交战国通商' };
    let accepted = 0;
    for (const id of merchantIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead || u.kind !== 'merchant' || u.owner !== this.playerFactionId) continue;
      const at = this.approachTileForBuilding(market, u.x, u.y);
      if (!at) continue;
      this.cancelUnitActivity(u, true);
      u.task = { type: 'merchantUnload', marketId: market.id };
      u.order = { type: 'merchantUnload', marketId: market.id };
      if (this._setUnitPath(u, at.x, at.y, { allowPartial: true })) accepted++;
      else { u.task = null; u.order = null; }
    }
    return { ok: accepted > 0, accepted, error: accepted ? null : '无法抵达集市' };
  };

  P.unloadMerchantCargo = function (merchantId, opts) {
    opts = opts || {};
    const u = this.getUnit(merchantId);
    if (!u || u.kind !== 'merchant' || u.dead) return { ok: false, error: '商人无效' };
    if (u.shipId) return { ok: false, error: '商人在船上' };
    const market = this._marketNear(u.x, u.y, true, null, 5.5);
    if (!market) return { ok: false, error: '附近没有集市' };
    const owner = this.getFaction(market.owner);
    if (this.atWar(u.owner, market.owner)) return { ok: false, error: '不能与交战国进行贸易' };
    const settlement = this.getSettlement(market.settlementId);
    const cargo = u.cargo || {};
    const keys = Object.keys(cargo).filter((k) => cargo[k] > 0.001);
    if (!keys.length) return { ok: false, error: '商人没有携带货物' };
    let transferred = 0, value = 0;
    for (const k of keys) {
      const add = this.addResource(settlement, k, cargo[k]);
      cargo[k] -= add;
      transferred += add;
      value += add * (D.RES[k].value || 1);
      if (cargo[k] <= 0.001) delete cargo[k];
    }
    u.cargo = cargo;
    if (market.owner !== u.owner) {
      const f = this.getFaction(u.owner);
      const other = this.getFaction(market.owner);
      this.changeRelation(u.owner, market.owner, Math.min(8, 1 + value / 40));
      if (f && f.isPlayer) this.notify(`商队向${D.realmFullName(other)}的集市卸下了价值约 ${Math.round(value)} 的货物，双方好感提升。`, 'trade');
    }
    if (transferred > 0) this.sfx('coin', u.x, u.y);
    return { ok: transferred > 0, amount: transferred, market, error: transferred > 0 ? null : '目标仓库已满' };
  };

  // =========================================================
  // Colonisation
  // =========================================================
  P.COLONY_COST = { food: 100, wood: 120, stone: 55 };

  P.canFoundSettlement = function (originSettlementId, x, y, factionId) {
    const origin = this.getSettlement(originSettlementId);
    if (!origin || origin.ruined) return { ok: false, error: '无效的定居点' };
    if (factionId && origin.owner !== factionId) return { ok: false, error: '不是你的定居点' };
    const faction = this.getFaction(origin.owner);
    if (!faction) return { ok: false, error: '无效阵营' };
    if (!this.canAfford(origin, this.COLONY_COST)) return { ok: false, error: '资源不足：需 100 食物、120 木材、55 石材', cost: this.COLONY_COST };
    if (this.livingPopulation(faction.id) + 3 > this.factionPopCap(faction.id)) return { ok: false, error: '需要至少 3 个空余人口容量' };
    const distToOrigin = U.dist(origin.x, origin.y, x, y);
    if (distToOrigin > 48) return { ok: false, error: '距离原定居点太远（最多 48 格）' };
    for (const s of this.settlements) {
      if (s.ruined) continue;
      const d = U.dist(s.x, s.y, x, y);
      if (d < 16) return { ok: false, error: '与其他定居点距离太近（至少 16 格）' };
      const hall = this.primaryHall(s);
      const radius = hall && hall.complete ? (hall.def.radius[hall.level] || 12) : 12;
      if (d < radius + 3) return { ok: false, error: '此地属于其他定居点的领地' };
    }
    for (let yy = y - 1; yy <= y + 1; yy++) {
      for (let xx = x - 1; xx <= x + 1; xx++) {
        if (!this.world.inBounds(xx, yy)) return { ok: false, error: '超出世界边界' };
        const td = this.world.terrainDef(xx, yy);
        if (!td.pass) return { ok: false, error: '大厅必须建在干燥平地上' };
        if (this.world.nodeAt(xx, yy)) return { ok: false, error: '需选择没有资源点的空地' };
        if (this._buildingsAt(xx, yy)) return { ok: false, error: '此处已有建筑' };
      }
    }
    return { ok: true, cost: this.COLONY_COST };
  };

  P.foundSettlement = function (originSettlementId, x, y, opts) {
    opts = opts || {};
    const chk = this.canFoundSettlement(originSettlementId, x, y, opts.factionId);
    if (!chk.ok) return chk;
    const origin = this.getSettlement(originSettlementId);
    const faction = this.getFaction(origin.owner);
    if (!this.payCost(origin, this.COLONY_COST)) return { ok: false, error: '资源不足' };
    const used = new Set(this.settlements.map((s) => s.name));
    let name;
    for (let i = 0; i < 20; i++) {
      name = U.choice(D.settlementNames, this.rng);
      if (!used.has(name)) break;
    }
    if (!name || used.has(name)) name = origin.name + '新领';
    const settlement = {
      id: this.nextId('s'), name, owner: faction.id, x, y, stage: 1,
      resources: Object.assign({}, D.COLONY_RESOURCES), stability: 62, shortage: false,
      aidCooldown: 0, founded: this.timeDays, hallId: null, ruined: false,
      occupiedUntil: 0, lastOwner: origin.owner, legend: '由' + origin.name + '的拓荒者建立'
    };
    this.settlements.push(settlement);
    const hall = this._createBuilding('hall', faction.id, settlement, x - 1, y - 1, 1, true);
    settlement.hallId = hall.id;
    this._spawnStartResidents(faction, settlement, 3);
    this.path.rebuildAll(this);
    this.updateRank(faction, true);
    if (faction.isPlayer) {
      this.notify(`拓荒者建立了新的定居点「${name}」。3 名居民已抵达，木石与口粮已入仓。`, 'settlement', { important: true, settlementId: settlement.id });
      this.sfx('discover', x, y);
    }
    return { ok: true, settlement };
  };

  P.renameSettlement = function (settlementId, name) {
    const s = this.getSettlement(settlementId);
    if (!s) return { ok: false };
    name = String(name || '').trim().slice(0, 14);
    if (!name) return { ok: false, error: '名称不能为空' };
    s.name = name;
    return { ok: true };
  };

  // =========================================================
  // Stability & aid
  // =========================================================
  P.grantAid = function (settlementId) {
    const s = this.getSettlement(settlementId);
    if (!s || s.ruined) return { ok: false, error: '无效定居点' };
    const faction = this.getFaction(s.owner);
    if (!faction || !faction.isPlayer) return { ok: false, error: '只能救助自己的定居点' };
    if (s.aidCooldown > this.timeDays) return { ok: false, error: `仍需等待 ${Math.ceil(s.aidCooldown - this.timeDays)} 天` };
    const cost = 18 + s.stage * 7;
    if (!this.canAfford(s, { coin: cost })) return { ok: false, error: `需要 ${cost} 银币` };
    this.removeResource(s, 'coin', cost);
    s.stability = U.clamp(s.stability + 16, 0, 100);
    s.aidCooldown = this.timeDays + 20;
    this.notify(`向「${s.name}」发放了救助金，稳定度提高。`, 'civic', { settlementId: s.id });
    this.sfx('coin', s.x, s.y);
    return { ok: true, cost };
  };

  // =========================================================
  // Unit order plumbing
  // =========================================================
  P.cancelUnitActivity = function (u, keepPath) {
    if (!u) return;
    const b = u.buildingId ? this.getBuilding(u.buildingId) : null;
    if (b) {
      if (u.state === 'inside') {
        const i = b.workers.indexOf(u.id); if (i >= 0) b.workers.splice(i, 1);
      }
      if (u.state === 'constructing') {
        const i = b.constructors.indexOf(u.id); if (i >= 0) b.constructors.splice(i, 1);
      }
      if (u.state === 'repairing') {
        const i = (b.repairers || []).indexOf(u.id); if (i >= 0) b.repairers.splice(i, 1);
      }
      if (u.state === 'patient' || (b.patients || []).includes(u.id)) {
        const i = (b.patients || []).indexOf(u.id); if (i >= 0) b.patients.splice(i, 1);
      }
    }
    if (u.shipId) return; // don't pull passengers out implicitly
    if (u.task && u.task.type === 'clear' && u.task.nodeId) {
      const node = this.world.nodes.find((n) => n.id === u.task.nodeId);
      if (node && node.clearing) {
        const i = node.clearing.units.indexOf(u.id);
        if (i >= 0) node.clearing.units.splice(i, 1);
        if (!node.clearing.units.length) node.clearing = null;
      }
    }
    u.state = 'idle';
    u.buildingId = null;
    u.task = null;
    u.order = null;
    u.target = null;
    u.aiTarget = null;
    u.moveGoal = null;
    if (!keepPath) {
      u.path = [];
      u.pathIndex = 0;
    }
  };

  P._setUnitPath = function (u, tx, ty, opts) {
    opts = opts || {};
    const sx = Math.floor(u.x), sy = Math.floor(u.y);
    const ship = u.isShip;
    let path = null;
    if (sx === tx && sy === ty) path = [];
    else path = this.path.findPath(sx, sy, tx, ty, { ship, allowPartial: opts.allowPartial, maxIter: opts.maxIter || 26000 });
    if (!path) return false;
    u.path = path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    u.pathIndex = 0;
    u.state = 'moving';
    u.moveGoal = { x: tx, y: ty };
    return true;
  };

  P._formationTarget = function (x, y, index, walkable, ship) {
    if (index === 0) return { x, y };
    const offsets = [];
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offsets.push({ x: dx, y: dy });
    }
    for (let i = (index - 1) * 1; i < offsets.length; i++) {
      const p = { x: Math.round(x) + offsets[i].x, y: Math.round(y) + offsets[i].y };
      if (this.path.isWalkable(p.x, p.y, !!ship)) return p;
    }
    return { x: Math.round(x), y: Math.round(y) };
  };

  P.orderMove = function (unitIds, x, y) {
    let accepted = 0;
    const ids = (unitIds || []).filter((id) => {
      const u = this.getUnit(id);
      return u && !u.dead && u.owner === this.playerFactionId;
    });
    let idx = 0;
    for (const id of unitIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead || u.state === 'aboard') continue;
      if (u.owner !== this.playerFactionId && !u.isShip) continue;
      this.cancelUnitActivity(u, true);
      const target = this._formationTarget(x, y, idx++, this.path.isWalkable(x, y, u.isShip), u.isShip);
      if (!target) continue;
      u.order = { type: 'move', x: target.x, y: target.y };
      if (this._setUnitPath(u, target.x, target.y, { allowPartial: true })) accepted++;
      else { u.state = 'idle'; u.order = null; }
    }
    return { ok: accepted > 0, accepted, total: (unitIds || []).length };
  };

  P.orderGather = function (unitIds, nodeId) {
    const node = this.world.nodes.find((n) => n.id === nodeId);
    if (!node || !node.alive) return { ok: false, error: '资源点已不存在' };
    if (!['tree', 'berry'].includes(node.type)) return { ok: false, error: '铁矿、金矿与银矿必须通过矿场开采。石材需通过采石场获取。' };
    if (node.amount < 0.5) return { ok: false, error: '此处资源已经枯竭，需等待恢复' };
    let accepted = 0, firstError = null;
    for (const id of unitIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead) continue;
      if (u.kind !== 'resident') { firstError = '只有普通居民可以采集资源（建筑工无法采集）'; continue; }
      if (u.shipId || u.state === 'aboard') { firstError = '单位在船上'; continue; }
      this.cancelUnitActivity(u, true);
      const at = this._approachNode(node, u.x, u.y);
      u.task = { type: 'gather', nodeId: node.id, phase: 'to', originNodeId: node.id };
      u.order = { type: 'gather', nodeId: node.id };
      if (this._setUnitPath(u, at.x, at.y, { allowPartial: true })) accepted++;
      else { u.task = null; u.order = null; firstError = '没有可通行的道路'; }
    }
    return { ok: accepted > 0, accepted, error: firstError };
  };

  P.orderClearNode = function (unitIds, nodeId) {
    const node = this.world.nodes.find((n) => n.id === nodeId);
    if (!node || !node.alive) return { ok: false, error: '资源点不存在' };
    const workers = [];
    for (const id of unitIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead || u.kind !== 'resident') continue;
      if (u.shipId) continue;
      workers.push(u);
    }
    if (!workers.length) return { ok: false, error: '需要普通居民执行清除工作' };
    let accepted = 0;
    if (!node.clearing) node.clearing = { units: [], progress: 0 };
    for (const u of workers) {
      this.cancelUnitActivity(u, true);
      const at = this._approachNode(node, u.x, u.y);
      u.task = { type: 'clear', nodeId: node.id, phase: 'to' };
      u.order = { type: 'clear', nodeId: node.id };
      if (this._setUnitPath(u, at.x, at.y, { allowPartial: true })) {
        node.clearing.units.push(u.id);
        accepted++;
      } else { u.task = null; u.order = null; }
    }
    if (!accepted) return { ok: false, error: '清除者无法抵达' };
    this.notify(node.clearing.units.length > 1 ? '多名居民开始清除资源点。此过程不可逆。' : '居民开始清除资源点。此过程不可逆，耗时较长。', 'warn');
    return { ok: true, accepted };
  };

  P.orderAttack = function (unitIds, kind, targetId, opts) {
    opts = opts || {};
    let target = kind === 'building' ? this.getBuilding(targetId) : kind === 'ship' ? this.getUnit(targetId) : this.getUnit(targetId);
    if (!target || target.dead) return { ok: false, error: '目标已不存在' };
    const targetOwner = kind === 'building' ? target.owner : target.owner;
    let atWarNow = this.atWar(this.playerFactionId, targetOwner);
    const ids = [];
    for (const id of unitIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead || !u.def.military) continue;
      if (u.state === 'aboard') continue;
      ids.push(u);
    }
    if (!ids.length) return { ok: false, error: '所选单位中没有可作战的士兵' };
    if (targetOwner === this.playerFactionId) return { ok: false, error: '不能攻击己方目标' };
    if (!atWarNow) {
      if (!opts.declareWar) return { ok: false, error: 'needsWar', targetOwner };
      const f = this.player;
      const targetF = this.getFaction(targetOwner);
      if (!targetF) return { ok: false, error: '目标没有可宣战的阵营' };
      const declared = this.declareWar(f.id, targetOwner, null, { attacked: true });
      if (!declared.ok) return { ok: false, error: declared.error || '无法宣战' };
      this.notify(`你的军队向${D.realmFullName(targetF)}发动了无端攻击。战争已经开始。`, 'war', { important: true });
    }
    let accepted = 0;
    for (const u of ids) {
      this.cancelUnitActivity(u, true);
      u.order = { type: 'attack', targetKind: kind, targetId: kind === 'building' ? target.id : target.id };
      u.target = { kind, id: target.id };
      let tx, ty;
      if (kind === 'building') {
        const at = this.approachTileForBuilding(target, u.x, u.y);
        if (!at) continue;
        tx = at.x; ty = at.y;
      } else {
        tx = Math.floor(target.x); ty = Math.floor(target.y);
      }
      if (this._setUnitPath(u, tx, ty, { allowPartial: true })) accepted++;
      else { u.order = null; u.target = null; u.state = 'idle'; }
    }
    return { ok: accepted > 0, accepted, error: accepted ? null : '无法接近目标' };
  };

  P.orderEnterClinic = function (unitIds, buildingId) {
    const b = this.getBuilding(buildingId);
    if (!b || b.dead || !b.complete || b.defId !== 'clinic') return { ok: false, error: '需要一座完工的诊所' };
    let accepted = 0, error = null;
    for (const id of unitIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead || !u.def.military) { error = '只有士兵可以进入诊所'; continue; }
      if (u.owner !== b.owner) continue;
      if (b.patients.length >= Math.max(1, b.def.patientCap[b.level] || 1)) { error = '诊所床位已满'; break; }
      if (u.hp >= u.maxHp - 0.1) { error = '该士兵没有受伤'; continue; }
      this.cancelUnitActivity(u, true);
      const at = this.approachTileForBuilding(b, u.x, u.y);
      if (!at) continue;
      u.task = { type: 'clinic', buildingId: b.id, phase: 'to' };
      u.order = { type: 'clinic', buildingId: b.id };
      if (this._setUnitPath(u, at.x, at.y, { allowPartial: true })) accepted++;
      else { u.task = null; u.order = null; }
    }
    return { ok: accepted > 0, accepted, error: error || (accepted ? null : '无法抵达诊所') };
  };

  P.stopUnits = function (unitIds) {
    let n = 0;
    for (const id of unitIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead || u.owner !== this.playerFactionId) continue;
      if (u.state === 'aboard') continue;
      this.cancelUnitActivity(u, false);
      u.path = [];
      u.pathIndex = 0;
      n++;
    }
    return { ok: n > 0, count: n };
  };

  // =========================================================
  // Dismissal (free population)
  // =========================================================
  P.disbandUnits = function (unitIds) {
    const ids = Array.isArray(unitIds) ? unitIds : [unitIds];
    const owned = [];
    let blockedShip = false;
    for (const id of ids) {
      const u = this.getUnit(id);
      if (!u || u.dead || u.owner !== this.playerFactionId) continue;
      if (u.isShip && (u.passengers || []).length) { blockedShip = true; continue; }
      owned.push(u);
    }
    if (!owned.length) {
      return { ok: false, error: blockedShip ? '船上仍有乘客，请先让乘客登陆再遣散船只。' : '没有可以遣散的单位。' };
    }
    let count = 0;
    for (const u of owned) {
      if (u.shipId) {
        const ship = this.getUnit(u.shipId);
        if (ship && ship.passengers) ship.passengers = ship.passengers.filter((id) => id !== u.id);
        u.shipId = null;
      }
      this.cancelUnitActivity(u, false);
      u.dead = true;
      u.hp = 0;
      u._disbanded = true;
      count++;
    }
    this._cleanupDead();
    this.notify(`${count} 个单位已经离开你的麾下，空出了 ${count} 点人口。`, 'civic');
    return { ok: true, count, blockedShip };
  };

  // =========================================================
  // Conversion / healing / ships
  // =========================================================
  P.convertToBuilders = function (unitIds) {
    let n = 0;
    for (const id of unitIds || []) {
      const u = this.getUnit(id);
      if (!u || u.dead || u.kind !== 'resident') continue;
      this.cancelUnitActivity(u, true);
      u.path = [];
      u.pathIndex = 0;
      // carried goods return to nearest friendly storage
      if (u.carry && Object.keys(u.carry).length) {
        const storage = this._nearestStorage(u.owner, u.x, u.y);
        if (storage) {
          const s = this.getSettlement(storage.settlementId);
          for (const [k, v] of Object.entries(u.carry)) this.addResource(s, k, v);
        }
        u.carry = {};
        u.bonus = {};
      }
      u.kind = 'builder';
      u.def = D.UNITS.builder;
      u.maxHp = D.UNITS.builder.hp;
      u.hp = Math.min(u.hp, u.maxHp);
      u.cargoCapacity = 0;
      n++;
    }
    if (n) {
      this.notify(`${n} 名居民转职为建筑工。建筑工的施工速度是普通居民的两倍，但无法再采集资源。`, 'civic');
      this.sfx('train');
    }
    return { ok: n > 0, count: n };
  };

  P.boardShip = function (unitIds, shipId) {
    const ship = this.getUnit(shipId);
    if (!ship || !ship.isShip || ship.dead) return { ok: false, error: '目标不是船只' };
    if (ship.owner !== this.playerFactionId) return { ok: false, error: '不能登上他人船只' };
    if (ship.hp <= 0) return { ok: false, error: '船只已经损毁' };
    const cap = ship.def.capacity || 6;
    if (ship.passengers.length >= cap) return { ok: false, error: '船只已满' };
    // Ships must be touching a shore to embark/disembark.
    const shore = this._shipShoreTile(ship);
    if (!shore) return { ok: false, error: '船只必须停靠在岸边才能登船' };
    let accepted = 0, slots = cap - ship.passengers.length;
    for (const id of unitIds || []) {
      if (slots <= 0) break;
      const u = this.getUnit(id);
      if (!u || u.dead || u.isShip || u.owner !== this.playerFactionId) continue;
      if (u.state === 'aboard' || u.shipId) continue;
      if (u.kind === 'merchant' || u.def.cls === 'civilian' || u.def.military) {
        this.cancelUnitActivity(u, true);
        const close = U.dist(u.x, u.y, shore.x + 0.5, shore.y + 0.5) <= 1.1;
        if (close) {
          this._embark(u, ship);
          slots--; accepted++;
        } else {
          u.task = { type: 'board', shipId: ship.id, shore, phase: 'to' };
          u.order = { type: 'board', shipId: ship.id };
          if (this._setUnitPath(u, shore.x, shore.y, { allowPartial: true })) { slots--; accepted++; }
          else { u.task = null; u.order = null; }
        }
      }
    }
    return { ok: accepted > 0, accepted, error: accepted ? null : '没有单位可以登船' };
  };

  P._embark = function (u, ship) {
    this.cancelUnitActivity(u, true);
    u.state = 'aboard';
    u.shipId = ship.id;
    u.path = [];
    ship.passengers.push(u.id);
    u.task = null;
    u.order = null;
    this.sfx('ship', ship.x, ship.y);
  };

  P._shipShoreTile = function (ship) {
    const sx = Math.round(ship.x), sy = Math.round(ship.y);
    for (let r = 1; r <= 2; r++) {
      const ring = this._ringTiles(sx, sy, r);
      for (const p of ring) {
        if (this.path.isWalkable(p.x, p.y, false)) return p;
      }
    }
    return null;
  };

  P.unboardShip = function (shipId) {
    const ship = this.getUnit(shipId);
    if (!ship || !ship.isShip) return { ok: false, error: '不是船只' };
    if (!ship.passengers.length) return { ok: false, error: '船上没有乘客' };
    const spots = [];
    const sx = Math.round(ship.x), sy = Math.round(ship.y);
    for (let r = 1; r <= 3 && spots.length < ship.passengers.length; r++) {
      for (const p of this._ringTiles(sx, sy, r)) {
        if (this.path.isWalkable(p.x, p.y, false) && !spots.some((s) => s.x === p.x && s.y === p.y)) spots.push(p);
      }
    }
    if (!spots.length) return { ok: false, error: '附近没有可以登陆的岸边' };
    let n = 0;
    for (const uid of ship.passengers.slice()) {
      const spot = spots[n % spots.length];
      const u = this.getUnit(uid);
      if (!u) continue;
      u.state = 'idle';
      u.shipId = null;
      u.x = spot.x + 0.5;
      u.y = spot.y + 0.5;
      u.path = [];
      u.task = null;
      u.order = null;
      const i = ship.passengers.indexOf(uid);
      if (i >= 0) ship.passengers.splice(i, 1);
      n++;
    }
    this.sfx('ship', ship.x, ship.y);
    return { ok: true, count: n };
  };

  P.upgradeShipAtDock = function (shipId) {
    const ship = this.getUnit(shipId);
    if (!ship || !ship.isShip) return { ok: false, error: '不是船只' };
    const dock = this.buildings.find((b) => b.owner === ship.owner && b.complete && !b.dead && b.defId === 'dock' &&
      U.dist(ship.x, ship.y, this.buildingCenter(b).x, this.buildingCenter(b).y) <= 4.5);
    if (!dock) return { ok: false, error: '船只必须停靠在己方码头附近' };
    const nextTier = { ship_boat: 'ship_cog', ship_cog: 'ship_carrack' }[ship.kind];
    if (!nextTier) return { ok: false, error: '这已经是最高级的船只' };
    if (dock.level < D.UNITS[nextTier].costLevel) return { ok: false, error: '码头等级不足' };
    const settlement = this.getSettlement(dock.settlementId);
    const cost = D.UNITS[nextTier].trainCost || {};
    if (!this.canAfford(settlement, cost)) return { ok: false, error: '资源不足' };
    this.payCost(settlement, cost);
    const ratio = ship.hp / ship.maxHp;
    ship.kind = nextTier;
    ship.def = D.UNITS[nextTier];
    ship.maxHp = ship.def.hp;
    ship.hp = Math.round(ship.maxHp * Math.max(0.35, ratio));
    this.notify(`${ship.def.name}在码头完成了改造。`, 'naval', { settlementId: settlement.id });
    this.sfx('ship', ship.x, ship.y);
    return { ok: true };
  };

  // =========================================================
  // Research
  // =========================================================
  P.canResearch = function (techId, factionId) {
    const f = this.getFaction(factionId || this.playerFactionId);
    const tech = D.TECHS[techId];
    if (!f || !tech) return { ok: false, error: '无效科技' };
    if (f.techs.includes(techId)) return { ok: false, error: '已经研究完成' };
    if (f.activeResearch) return { ok: false, error: '已有正在进行的研究' };
    if (tech.requires && !f.techs.includes(tech.requires)) return { ok: false, error: '需先完成前置科技' };
    const buildings = this.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.def.researchTier === tech.tier);
    if (!buildings.length) return { ok: false, error: `需要一座${['', '图书馆', '大学', '皇家大学'][tech.tier]}` };
    return { ok: true, building: buildings[0], buildings };
  };

  P.startResearch = function (techId, sourceSettlementId) {
    const chk = this.canResearch(techId);
    if (!chk.ok) return chk;
    const f = this.player;
    const tech = D.TECHS[techId];
    let source = null;
    if (sourceSettlementId) {
      source = this.settlements.find((s) => s.id === sourceSettlementId && s.owner === f.id &&
        this.buildings.some((b) => b.settlementId === s.id && b.complete && b.def.researchTier === tech.tier && !b.dead));
    }
    if (!source) {
      const b = chk.building;
      source = this.getSettlement(b.settlementId);
    }
    if (!source) return { ok: false, error: '没有可支付研究费用的定居点' };
    if (!this.canAfford(source, tech.cost)) return { ok: false, error: '研究所需资源不足' };
    this.payCost(source, tech.cost);
    f.activeResearch = { techId, progress: 0, sourceSettlementId: source.id, startedAt: this.timeDays, cost: tech.cost };
    this.notify(`学者们开始研究「${tech.name}」。研究速度取决于进入${['', '图书馆', '大学', '皇家大学'][tech.tier]}的居民数量。`, 'tech', { important: true });
    this.sfx('research', source.x, source.y);
    return { ok: true };
  };

  P.cancelResearch = function () {
    const f = this.player;
    if (!f || !f.activeResearch) return { ok: false };
    const s = this.getSettlement(f.activeResearch.sourceSettlementId);
    if (s && f.activeResearch.cost) this.refundCost(s, f.activeResearch.cost, 0.4);
    f.activeResearch = null;
    this.notify('研究已中止，部分资源被浪费。', 'warn');
    return { ok: true };
  };

  // helper shared with simulation
  P._nearestStorage = function (factionId, x, y) {
    let best = null, bestD = Infinity;
    for (const b of this.buildings) {
      if (b.dead || !b.complete || b.owner !== factionId) continue;
      if (b.defId !== 'hall' && b.defId !== 'warehouse') continue;
      const c = this.buildingCenter(b);
      const d = U.dist2(c.x, c.y, x, y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  };

})();
