/* WARWORLD — read-only helpers and small player actions used by the interface. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const P = WW.Game.prototype;

  P.canPlacePreview = function (defId, settlementId, x, y, opts) {
    opts = opts || {};
    const f = this.player;
    const settlement = this.getSettlement(settlementId);
    if (!f || !settlement || settlement.owner !== f.id) return { ok: false, error: '这不是你的定居点' };
    const def = D.BUILD[defId];
    if (!def) return { ok: false, error: '未知建筑' };
    if (def.buildMode === 'line') {
      return this.canPlaceLineTile(defId, settlementId, x, y, { factionId: f.id, level: opts.level });
    }
    return this.canPlaceBuilding(defId, settlementId, x, y, { factionId: f.id, level: opts.level });
  };

  P.getUpgradeInfo = function (b) {
    if (!b || b.dead) return { ok: false, error: '建筑不存在' };
    if (!b.complete) return { ok: false, error: '尚未完工' };
    if (b.upgrade) return { ok: false, error: '升级正在施工', target: b.upgrade.targetLevel };
    if (b.defId === 'road' || b.defId === 'bridge' || b.defId === 'tunnel') return { ok: false, error: '无法升级' };
    const settlement = this.getSettlement(b.settlementId);
    if (!settlement) return { ok: false, error: '没有所属定居点' };
    const target = b.level + 1;
    if (target > b.def.maxLevel) return { ok: false, error: '已达最高等级' };
    if (b.def.id !== 'hall' && (settlement.stage || 1) < target) return { ok: false, error: `需要${D.STAGE_NAMES[target]}阶段` };
    if (b.def.id === 'hall' && target === 4) {
      const cap = this.capitalOf(b.owner);
      if (cap && cap.id !== settlement.id) return { ok: false, error: '每个阵营只能拥有一座王宫' };
    }
    const cost = D.upgradeCost(b.def, target);
    if (!cost) return { ok: false, error: '无法升级' };
    if (!this.canAfford(settlement, cost)) return { ok: false, error: '资源不足', cost };
    return { ok: true, target, cost, name: D.buildingName(b.def, target), days: D.buildingDays(b.def, target), hp: D.buildingHp(b.def, target) };
  };

  P.getBuildingProductionInfo = function (b) {
    if (!b || b.dead) return [];
    const f = this.getFaction(b.owner);
    const mod = this._mod(f);
    const level = b.level || 1;
    const slots = D.buildingSlots(b.def, level);
    const workers = (b.workers || []).length;
    const mul = (b.def.prodMul && b.def.prodMul[level]) || 1;
    const out = [];
    if (b.defId === 'lumber') out.push({ res: 'wood', rate: workers * 5.2 * mul * (1 + (mod.wood || 0)), label: '木材', note: `森林再生 ×${b.def.regenBoost[level] || 2}` });
    if (b.defId === 'hunter') {
      out.push({ res: 'food', rate: workers * 1.75 * mul * (1 + (mod.food || 0)), label: '食物' });
      out.push({ res: 'leather', rate: workers * 0.55 * mul, label: '皮革' });
    }
    if (b.defId === 'fishery') out.push({ res: 'food', rate: workers * 2.65 * mul * (1 + (mod.food || 0)), label: '食物' });
    if (b.defId === 'gatherer') {
      out.push({ res: 'food', rate: workers * 4.5 * mul * (1 + (mod.food || 0)), label: '食物' });
      out.push({ res: 'herb', rate: workers * 0.42 * mul * (1 + (mod.food || 0)), label: '草药' });
    }
    if (b.defId === 'quarry') {
      let rate = workers * 1.55 * mul * (1 + (mod.stone || 0));
      if (this.world.mountainNear(b.x + 1, b.y + 1, 4)) rate *= 1.5;
      out.push({ res: 'stone', rate, label: '石材', note: this.world.mountainNear(b.x + 1, b.y + 1, 4) ? '高山加成 +50%' : '' });
    }
    if (b.defId === 'ironMine') out.push({ res: 'ironOre', rate: workers * 0.8 * mul * (1 + (mod.ore || 0)), label: '铁矿' });
    if (b.defId === 'silverMine') out.push({ res: 'silverOre', rate: workers * 0.65 * mul * (1 + (mod.ore || 0)), label: '银矿' });
    if (b.defId === 'goldMine') out.push({ res: 'goldOre', rate: workers * 0.42 * mul * (1 + (mod.ore || 0)), label: '金矿' });
    if (b.defId === 'farm') out.push({ res: 'food', rate: workers * 2.15 * mul * (1 + (mod.food || 0)), label: '食物' });
    if (b.defId === 'mill') out.push({ res: 'food', rate: workers * 1.65 * mul * (1 + (mod.food || 0)), label: '食物', note: '需要本定居点有农田' });
    if (b.defId === 'smelter') {
      const recipe = b.recipe || 'iron';
      const spec = {
        iron: { in: '铁矿', out: '铁', inRate: 1.35, wood: 0.48, outRate: 0.68, res: 'iron' },
        silver: { in: '银矿', out: '银', inRate: 1.0, wood: 0.55, outRate: 0.48, res: 'silver' },
        gold: { in: '金矿', out: '金', inRate: 0.55, wood: 0.7, outRate: 0.22, res: 'gold' }
      }[recipe];
      out.push({ res: spec.res, rate: workers * spec.outRate * mul * (1 + (mod.ore || 0) * 0.6), label: spec.out, note: `每名工人每日消耗 ${spec.inRate}${spec.in}与 ${spec.wood} 木材` });
    }
    if (b.defId === 'mint') out.push({ res: 'coin', rate: workers * 1.0 * mul, label: '银币', note: '每名工人每日消耗 0.3 银与 0.6 木材' });
    if (b.defId === 'market') out.push({ res: 'coin', rate: (b.def.toll && b.def.toll[level]) || 0, label: '银币', note: '集市过路税，不需要工人' });
    return out;
  };

  P.getSettlementUpkeepInfo = function (s) {
    return D.SETTLEMENT_UPKEEP[s.stage || 1] || {};
  };

  P.getSettlementLocalPopulation = function (s) {
    return this.units.filter((u) => !u.dead && !u.isShip && u.homeSettlement === s.id).length;
  };

  P.getBuildingWorkerNames = function (b) {
    return (b.workers || []).map((id) => this.getUnit(id)).filter(Boolean);
  };

  P.getPlayerIdleWorkers = function () {
    return this.units.filter((u) => u.owner === this.playerFactionId && !u.dead && !u.isShip &&
      (u.kind === 'resident' || u.kind === 'builder') && !u.task && u.state === 'idle');
  };

  P.getPlayerResidents = function () {
    return this.units.filter((u) => u.owner === this.playerFactionId && !u.dead && !u.isShip && u.def.cls === 'civilian');
  };

  P.setRecipe = function (buildingId, recipe) {
    const b = this.getBuilding(buildingId);
    if (!b || b.defId !== 'smelter') return { ok: false };
    if (!['iron', 'gold', 'silver'].includes(recipe)) return { ok: false };
    b.recipe = recipe;
    return { ok: true };
  };

  P.setTavernActive = function (buildingId, active) {
    const b = this.getBuilding(buildingId);
    if (!b || b.defId !== 'tavern') return { ok: false };
    if (b.owner !== this.playerFactionId) return { ok: false };
    b.active = !!active;
    return { ok: true, active: b.active };
  };

  P.dischargePatient = function (buildingId, unitId) {
    const b = this.getBuilding(buildingId);
    const u = this.getUnit(unitId);
    if (!b || !u) return { ok: false };
    this._dischargePatient(b, u);
    return { ok: true };
  };

  P.getResearchContributors = function (f) {
    if (!f || !f.activeResearch) return [];
    const tech = D.TECHS[f.activeResearch.techId];
    if (!tech) return [];
    return this.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.def.researchTier === tech.tier && (b.workers || []).length === 0)
      .map((b) => ({ b, rate: 0, workers: 0 }));
  };

  P.getResearchRate = function (f) {
    if (!f || !f.activeResearch) return { rate: 0, contributors: [] };
    const tech = D.TECHS[f.activeResearch.techId];
    if (!tech) return { rate: 0, contributors: [] };
    let rate = 0;
    const contributors = [];
    for (const b of this.buildings) {
      if (b.dead || !b.complete || b.owner !== f.id || b.def.researchTier !== tech.tier) continue;
      const workers = (b.workers || []).length;
      if (!workers) continue;
      const base = (b.def.researchBase && b.def.researchBase[b.level]) || 0;
      const per = (b.def.researchPerWorker && b.def.researchPerWorker[b.level]) || 0;
      const r = base + per * workers;
      rate += r;
      contributors.push({ building: b, rate: r, workers });
    }
    return { rate, contributors, tech, progress: f.activeResearch.progress || 0, points: tech.points };
  };

  P.getAvailableTechs = function (fid) {
    const f = this.getFaction(fid || this.playerFactionId);
    if (!f) return [];
    const availableTiers = new Set(this.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.def.researchTier).map((b) => b.def.researchTier));
    return Object.values(D.TECHS).filter((t) => {
      if (f.techs.includes(t.id)) return false;
      if (t.requires && !f.techs.includes(t.requires)) return false;
      return availableTiers.has(t.tier);
    });
  };

  P.canStartResearchNow = function (techId) {
    const chk = this.canResearch(techId);
    if (!chk.ok) return chk;
    const f = this.player;
    const tech = D.TECHS[techId];
    const b = chk.building;
    const s = this.getSettlement(b.settlementId);
    if (!this.canAfford(s, tech.cost)) return { ok: false, error: '研究费用不足' };
    return { ok: true, settlement: s };
  };

  P.getFactionDiplomacySummary = function (fid) {
    const f = this.getFaction(fid);
    if (!f) return null;
    const overlord = this.overlordOf(fid);
    const vassals = this.vassalsOf(fid);
    const allies = this.alliesOf(fid).map((id) => this.getFaction(id)).filter(Boolean);
    const wars = this.warsFor(fid).map((w) => ({ war: w, enemy: this.getFaction(w.a === fid ? w.b : w.a) })).filter((x) => x.enemy);
    const cbs = (f.casusBelli || []).map((c) => ({ cb: c, target: this.getFaction(c.target) })).filter((x) => x.target);
    return { overlord, vassals, allies, wars, cbs };
  };

  P.getPlayerWars = function () {
    return this.warsFor(this.playerFactionId);
  };

  P.getWarAgainst = function (fid) {
    return this.getWar(this.playerFactionId, fid);
  };

  P.getRelationText = function (fid) {
    const rel = this.relationBetween(this.playerFactionId, fid);
    return { value: rel, label: D.relationLabel(rel, this.atWar(this.playerFactionId, fid)), color: D.relationColor(rel, this.atWar(this.playerFactionId, fid)) };
  };

  P.getTradeableResources = function (settlementId) {
    const s = this.getSettlement(settlementId);
    if (!s) return [];
    const out = [];
    for (const k of D.RES_KEYS) {
      if ((s.resources[k] || 0) >= 1) out.push({ res: k, amount: Math.floor(s.resources[k]) });
    }
    return out;
  };

  P.getMerchantCargoTotal = function (u) {
    return Object.values((u && u.cargo) || {}).reduce((a, b) => a + b, 0);
  };

  P.getNearbyMarketForMerchant = function (u) {
    if (!u) return null;
    return this._marketNear(u.x, u.y, true, null, 5.5);
  };

  P.canPlayerAttackTarget = function (kind, id) {
    const target = kind === 'building' ? this.getBuilding(id) : this.getUnit(id);
    if (!target) return { ok: false, error: '目标不存在' };
    if (target.owner === this.playerFactionId) return { ok: false, error: '不能攻击己方目标' };
    if (this.atWar(this.playerFactionId, target.owner)) return { ok: true, war: true };
    return { ok: true, war: false, faction: this.getFaction(target.owner) };
  };

  P.getNodeInfo = function (n) {
    if (!n) return null;
    return {
      name: D.NODES[n.type].name,
      res: D.NODES[n.type].resource,
      amount: Math.floor(n.amount),
      max: n.max,
      regen: n.max * D.NODES[n.type].regen * (n.regenMul || 1),
      boost: n.gatherBoost || 1,
      clearDays: (D.NODES[n.type].clearDays || 4) * (0.6 + n.max / 300),
      clearing: n.clearing || null
    };
  };

  P.getShipDock = function (ship) {
    if (!ship || !ship.isShip) return null;
    return this.buildings.find((b) => b.owner === ship.owner && b.complete && !b.dead && b.defId === 'dock' &&
      U.dist(ship.x, ship.y, this.buildingCenter(b).x, this.buildingCenter(b).y) <= 4.5) || null;
  };

  P.getFactionModifierText = function (fid) {
    const f = this.getFaction(fid);
    if (!f) return [];
    const labels = {
      wood: '木材采集', food: '食物采集', stone: '石材采集', ore: '矿产采集', build: '建造速度',
      armor: '护甲', hp: '生命', meleeAtk: '近战攻击', rangedAtk: '远程攻击', range: '射程',
      cavSpeed: '骑兵速度', cavHp: '骑兵生命', stability: '稳定度', storage: '储存上限',
      heal: '治疗效率', merchantCap: '商队载重', relation: '外交好感'
    };
    return Object.entries(this._mod(f)).map(([k, v]) => {
      const label = labels[k] || k;
      const isPct = ['wood', 'food', 'stone', 'ore', 'build', 'meleeAtk', 'hp', 'rangedAtk', 'cavSpeed', 'cavHp', 'storage', 'heal', 'merchantCap'].includes(k);
      return `${label} ${v > 0 && isPct ? '+' : ''}${isPct ? Math.round(v * 100) : Math.round(v * 10) / 10}${isPct ? '%' : ''}`;
    });
  };

  P.getUnitTooltip = function (u) {
    if (!u) return '';
    const bits = [u.def.name, `生命 ${Math.ceil(u.hp)}/${u.maxHp}`];
    if (u.def.military) bits.push(`攻击 ${u.def.atk}`, `护甲 ${this._unitArmor(u).toFixed(1)}`);
    if (u.def.military) bits.push(`射程 ${this._unitRange(u).toFixed(1)}`);
    if (u.kind === 'merchant') bits.push(`载货 ${Math.floor(this.getMerchantCargoTotal(u))}/${u.cargoCapacity}`);
    return bits.join(' · ');
  };

  // =========================================================
  // Tutorial objectives
  // =========================================================
  P.tutorialObjectives = function () {
    const g = this;
    return [
      {
        id: 'gather',
        title: '让臣民开始劳作',
        hint: '选中一名居民，右键点击树林或浆果丛。',
        check: () => g.units.some((u) => u.owner === g.playerFactionId && (u.state === 'gathering' || (u.task && u.task.type === 'gather')))
      },
      {
        id: 'house',
        title: '修建第一座民宅',
        hint: '从建造菜单的政府建筑中放置民宅，再派遣居民施工。',
        check: () => g.buildings.some((b) => b.owner === g.playerFactionId && b.defId === 'house' && b.complete && !b.dead)
      },
      {
        id: 'lumber',
        title: '建立伐木场并派驻工人',
        hint: '伐木场须靠近树林。完工后选中建筑，派遣居民进入。',
        check: () => g.buildings.some((b) => b.owner === g.playerFactionId && b.defId === 'lumber' && b.complete && (b.workers || []).length > 0)
      },
      {
        id: 'town',
        title: '将村庄升级为小镇',
        hint: '选中村庄大厅，点击升级到镇长大厅，并安排工匠施工。',
        check: () => g.factions.some((f) => f.id === g.playerFactionId && f.rank >= 2)
      },
      {
        id: 'market',
        title: '建立集市并雇佣商人',
        hint: '小镇阶段解锁集市。集市完工后可花费食物与银币雇佣商人。',
        check: () => g.units.some((u) => u.owner === g.playerFactionId && u.kind === 'merchant' && !u.dead)
      },
      {
        id: 'research',
        title: '研究一项科技',
        hint: '在小镇修建图书馆，派驻居民，然后在科技页选择研究。',
        check: () => g.player && g.player.techs.length > 0
      },
      {
        id: 'soldier',
        title: '训练第一支部队',
        hint: '修建兵营并训练民兵。兵营在村庄阶段即可建造。',
        check: () => g.units.some((u) => u.owner === g.playerFactionId && u.def.military)
      },
      {
        id: 'kingdom',
        title: '成为王国',
        hint: '把一座城市的大厅升级为市政厅，或建立更多定居点。',
        check: () => g.factions.some((f) => f.id === g.playerFactionId && f.rank >= 3)
      },
      {
        id: 'capital',
        title: '加冕为帝国',
        hint: '将市政厅升级为王宫。每个阵营只能拥有一座王宫。',
        check: () => g.factions.some((f) => f.id === g.playerFactionId && f.rank >= 4)
      }
    ];
  };

  P.tutorialState = function () {
    const list = this.tutorialObjectives().map((o) => ({ id: o.id, title: o.title, hint: o.hint, done: !!o.check() }));
    const completed = list.filter((o) => o.done).length;
    return { list, completed, total: list.length };
  };

  P._tutorialDay = function () {
    if (!this.settings.tutorial || !this.player) return;
    if (!this.tutorial) this.tutorial = { step: 0, completed: {} };
    for (const o of this.tutorialObjectives()) {
      if (o.check() && !this.tutorial.completed[o.id]) {
        this.tutorial.completed[o.id] = true;
        this.tutorial.step = Object.keys(this.tutorial.completed).length;
        this.notify(`谕令完成：${o.title}。`, 'tutorial', { important: false });
        this.emit('tutorialStep', o);
      }
    }
  };

  WW.tutorialObjectives = () => P.tutorialObjectives;
})();
