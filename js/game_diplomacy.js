/* WARWORLD — diplomacy: alliances, vassalage, peace, trade caravans and decisions. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const P = WW.Game.prototype;

  // =========================================================
  // Helpers
  // =========================================================
  P.hasMarket = function (fid) {
    return this.buildings.some((b) => !b.dead && b.complete && b.owner === fid && b.defId === 'market');
  };
  P.playerMarketSettlements = function () {
    return this.settlements.filter((s) => s.owner === this.playerFactionId && !s.ruined &&
      this.buildings.some((b) => b.settlementId === s.id && b.complete && !b.dead && b.defId === 'market'));
  };
  P.marketIn = function (settlementId) {
    return this.buildings.find((b) => b.settlementId === settlementId && b.complete && !b.dead && b.defId === 'market') || null;
  };
  P.merchantCapacity = function (factionId, market) {
    if (!market) return 20;
    const f = this.getFaction(factionId);
    const tech = f ? (this._mod(f).merchantCap || 0) : 0;
    return Math.round(((market.def.merchantCap && market.def.merchantCap[market.level]) || 20) * (1 + tech));
  };
  P.allianceThreshold = function () { return 58; };
  P.factionLabel = function (id) {
    const f = this.getFaction(id);
    return f ? D.realmFullName(f) : '未知势力';
  };

  // =========================================================
  // Gifts, alliances, vassalage
  // =========================================================
  P.giftToFaction = function (targetId, amount, sourceSettlementId) {
    const f = this.player;
    const target = this.getFaction(targetId);
    if (!target || target.eliminated) return { ok: false, error: '该势力不存在' };
    if (this.atWar(f.id, targetId)) return { ok: false, error: '交战中无法赠送礼物' };
    amount = Math.floor(amount);
    if (!(amount > 0)) return { ok: false, error: '赠礼金额必须大于 0' };
    let source = this.getSettlement(sourceSettlementId);
    if (!source || source.owner !== f.id) {
      source = this.ownedSettlements(f.id).sort((a, b) => (b.resources.coin || 0) - (a.resources.coin || 0))[0];
    }
    if (!source || (source.resources.coin || 0) < amount) return { ok: false, error: '银币不足' };
    this.removeResource(source, 'coin', amount);
    const gain = Math.min(16, 1.5 + amount * 0.12 + (this._mod(f).relation || 0));
    this.changeRelation(f.id, targetId, gain);
    this.notify(`你向${D.realmFullName(target)}赠送了 ${amount} 银币。双方好感 +${Math.round(gain)}。`, 'diplomacy');
    this.sfx('coin');
    return { ok: true, relation: this.relationBetween(f.id, targetId) };
  };

  P.proposeAlliance = function (targetId) {
    const f = this.player;
    const target = this.getFaction(targetId);
    if (!target || target.eliminated) return { ok: false, error: '该势力不存在' };
    if (this.atWar(f.id, targetId)) return { ok: false, error: '战争期间无法结盟，请先议和' };
    if (this.areAllied(f.id, targetId)) return { ok: false, error: '双方已经是盟友' };
    if (this.isVassalOf(f.id, targetId) || this.isVassalOf(targetId, f.id)) return { ok: false, error: '宗主与封臣之间不能缔结平等同盟' };
    const rel = this.relationBetween(f.id, targetId);
    if (rel < this.allianceThreshold() - 8) return { ok: false, error: `好感度不足（需至少 ${this.allianceThreshold() - 8}）` };
    const accept = this._aiAcceptsAlliance(targetId, f.id);
    if (accept) {
      this._formAlliance(f.id, targetId);
      return { ok: true, accepted: true };
    }
    this.changeRelation(f.id, targetId, -2);
    this.notify(`${D.realmFullName(target)}婉拒了结盟提议。或许需要更多诚意。`, 'diplomacy');
    return { ok: true, accepted: false };
  };

  P._aiAcceptsAlliance = function (aiId, otherId) {
    const ai = this.getFaction(aiId);
    if (!ai) return false;
    const rel = this.relationBetween(aiId, otherId);
    let chance = (rel - this.allianceThreshold()) / 45 + 0.45;
    if (ai.ai) chance += (ai.ai.aggression - 1) * 0.08;
    return rel >= this.allianceThreshold() && this.rng.chance(U.clamp(chance, 0.05, 0.92));
  };

  P._formAlliance = function (aId, bId) {
    if (this.areAllied(aId, bId)) return null;
    this.alliances.push({ a: aId, b: bId, since: this.timeDays });
    this.changeRelation(aId, bId, 10);
    const a = this.getFaction(aId), b = this.getFaction(bId);
    if ((a && a.isPlayer) || (b && b.isPlayer)) {
      this.notify(`${D.realmFullName(a)}与${D.realmFullName(b)}缔结了同盟。盟友遭到攻击时可以选择参战。`, 'diplomacy', { important: true });
      this.sfx('bell');
    } else {
      this.notify(`${D.realmFullName(a)}与${D.realmFullName(b)}缔结了同盟。`, 'world');
    }
    return true;
  };

  P.demandVassalage = function (targetId) {
    const f = this.player;
    const target = this.getFaction(targetId);
    if (!target || target.eliminated) return { ok: false, error: '该势力不存在' };
    if (target.id === f.id) return { ok: false, error: '不能附庸自己' };
    if (this.atWar(f.id, target.id)) return { ok: false, error: '战争期间无法要求附庸，请先议和' };
    if (f.rank <= target.rank) return { ok: false, error: '你的阵营等级必须高于对方' };
    if (this.overlordOf(target.id) === f.id) return { ok: false, error: '对方已经是你的封臣' };
    if (this.overlordOf(target.id)) return { ok: false, error: '对方已有宗主' };
    if (this.overlordOf(f.id)) return { ok: false, error: '封臣不能要求他人附庸' };
    const accept = this._aiAcceptsVassalage(target.id, f.id);
    if (accept) {
      this._makeVassal(target.id, f.id);
      return { ok: true, accepted: true };
    }
    this.addCasusBelli(f.id, target.id, 'conquest');
    this.changeRelation(f.id, target.id, -18);
    const vassal = this.getFaction(target.id);
    this.notify(`${D.realmFullName(vassal)}拒绝了你的附庸要求。你获得了征服他们的战争理由。`, 'diplomacy', { important: true });
    return { ok: true, accepted: false, casusBelli: true };
  };

  P._aiAcceptsVassalage = function (targetId, overlordId) {
    const target = this.getFaction(targetId);
    const overlord = this.getFaction(overlordId);
    if (!target || !overlord) return false;
    const powerRatio = this._factionPower(overlordId) / Math.max(1, this._factionPower(targetId));
    const rel = this.relationBetween(targetId, overlordId);
    let chance = 0.04 + Math.max(0, powerRatio - 1.15) * 0.2 + Math.max(0, rel - 50) / 160;
    if (target.ai) chance -= (target.ai.aggression - 1) * 0.12;
    if (overlord.rank - target.rank >= 2) chance += 0.12;
    return this.rng.chance(U.clamp(chance, 0.02, 0.82));
  };

  P._makeVassal = function (vassalId, overlordId) {
    const existing = this.overlordOf(vassalId);
    if (existing) this.vassals = this.vassals.filter((v) => v.vassal !== vassalId);
    this.vassals.push({ vassal: vassalId, overlord: overlordId, since: this.timeDays });
    this.changeRelation(vassalId, overlordId, 12);
    const overlord = this.getFaction(overlordId), vassal = this.getFaction(vassalId);
    if ((overlord && overlord.isPlayer) || (vassal && vassal.isPlayer)) {
      this.notify(`${D.realmFullName(vassal)}已成为${D.realmFullName(overlord)}的封臣。宗主可以征召封臣参战，但需承担保护义务。`, 'diplomacy', { important: true });
      this.sfx('bell');
    } else {
      this.notify(`${D.realmFullName(vassal)}承认${D.realmFullName(overlord)}为宗主。`, 'world');
    }
  };

  P.requestReleaseFromOverlord = function () {
    const f = this.player;
    const overlordId = this.overlordOf(f.id);
    if (!overlordId) return { ok: false, error: '你不是任何势力的封臣' };
    const overlord = this.getFaction(overlordId);
    if (!overlord) return { ok: false, error: '宗主不存在' };
    if (f.rank < overlord.rank) return { ok: false, error: '只有你的阵营等级达到或超过宗主时，才能申请解除附庸' };
    let accept = this.rng.chance(U.clamp(0.2 + (this.relationBetween(f.id, overlordId) - 40) / 120 + (f.rank - overlord.rank) * 0.14, 0.08, 0.85));
    if (accept) {
      this.vassals = this.vassals.filter((v) => !(v.vassal === f.id && v.overlord === overlordId));
      this.changeRelation(f.id, overlordId, 8);
      this.notify(`你与${D.realmFullName(overlord)}解除了附庸关系。自由重新属于你。`, 'diplomacy', { important: true });
      return { ok: true, accepted: true };
    }
    this.addCasusBelli(f.id, overlordId, 'independence');
    this.changeRelation(f.id, overlordId, -16);
    this.notify(`${D.realmFullName(overlord)}拒绝了解除附庸的请求。你获得了独立战争的理由。`, 'diplomacy', { important: true });
    return { ok: true, accepted: false, casusBelli: true };
  };

  P.inviteAllyToWar = function (warId, allyId) {
    const player = this.player;
    const war = this.wars.find((w) => w.id === warId && !w.ended);
    if (!war) return { ok: false, error: '战争不存在' };
    if (war.a !== player.id && war.b !== player.id) return { ok: false, error: '你不在这场战争中' };
    if (!this.areAllied(player.id, allyId)) return { ok: false, error: '对方不是你的盟友' };
    const enemyId = war.a === player.id ? war.b : war.a;
    if (this.atWar(allyId, enemyId)) return { ok: false, error: '盟友已经与敌方交战' };
    const ally = this.getFaction(allyId);
    if (!ally) return { ok: false, error: '盟友不存在' };
    const rel = this.relationBetween(player.id, allyId);
    const chance = U.clamp(0.25 + rel / 140 + (ally.ai ? ally.ai.aggression * 0.08 : 0), 0.1, 0.9);
    if (this.rng.chance(chance)) {
      this._joinWarAgainst(allyId, enemyId, 'alliance', player.id);
      return { ok: true, accepted: true };
    }
    this.notify(`${D.realmFullName(ally)}拒绝了参战邀请，他们不愿卷入这场战争。`, 'diplomacy');
    this.changeRelation(player.id, allyId, -4);
    return { ok: true, accepted: false };
  };

  P.callVassalForPlayer = function (warId, vassalId) {
    if (!this.isVassalOf(vassalId, this.playerFactionId)) return { ok: false, error: '这不是你的封臣' };
    return this.callVassalToWar(this.playerFactionId, vassalId, warId);
  };

  // =========================================================
  // Trade offers
  // =========================================================
  P._validateTradeRoute = function (fromMarket, toFactionId, x, y) {
    const targets = this.buildings.filter((b) => b.owner === toFactionId && b.complete && !b.dead && b.defId === 'market');
    if (!targets.length) return { ok: false, error: `${this.factionLabel(toFactionId)}没有集市` };
    const sourceCenter = this.buildingCenter(fromMarket);
    const candidates = targets.map((t) => ({ b: t, d: U.dist(sourceCenter.x, sourceCenter.y, this.buildingCenter(t).x, this.buildingCenter(t).y) }))
      .sort((a, b) => a.d - b.d);
    for (const cand of candidates) {
      const at = this.approachTileForBuilding(cand.b, x, y);
      if (!at) continue;
      const sp = this._walkableNear(Math.floor(x), Math.floor(y), false, 6);
      if (!sp) continue;
      const path = this.path.findPath(sp.x, sp.y, at.x, at.y, { maxIter: 42000 });
      if (path) return { ok: true, target: cand.b, approach: at, distance: cand.d };
    }
    return { ok: false, error: '商路被阻断，无法抵达对方集市' };
  };

  P._merchantSpawnPoint = function (market) {
    return this.approachTileForBuilding(market, market.x + 1, market.y + 1) || { x: market.x, y: market.y + 2 };
  };

  P.proposeTradeToAI = function (targetId, offer, request, sourceSettlementId, durationDays) {
    const player = this.player;
    const target = this.getFaction(targetId);
    if (!target || target.eliminated) return { ok: false, error: '该势力不存在' };
    durationDays = Math.round(Number(durationDays) || D.TRADE_TERM.default);
    durationDays = U.clamp(durationDays, D.TRADE_TERM.min, D.TRADE_TERM.max);
    if (this.atWar(player.id, targetId)) return { ok: false, error: '交战国之间不能通商' };
    if (!this.hasMarket(player.id)) return { ok: false, error: '你需要先建造一座集市' };
    if (!this.hasMarket(targetId)) return { ok: false, error: '对方没有集市，无法通商' };
    if (!offer || !request || !D.RES[offer.res] || !D.RES[request.res]) return { ok: false, error: '请选择交易资源' };
    offer.amount = Math.floor(Number(offer.amount) || 0);
    request.amount = Math.floor(Number(request.amount) || 0);
    if (offer.amount <= 0 || request.amount <= 0) return { ok: false, error: '交易数量必须大于 0' };
    const sourceMarket = this.marketIn(sourceSettlementId) || this.buildings.find((b) => b.owner === player.id && b.complete && b.defId === 'market');
    if (!sourceMarket) return { ok: false, error: '未找到你的集市' };
    const source = this.getSettlement(sourceMarket.settlementId);
    if (!source) return { ok: false, error: '集市无效' };
    const cap = this.merchantCapacity(player.id, sourceMarket);
    if (offer.amount > cap) return { ok: false, error: `商人载货上限为 ${cap}` };
    if ((source.resources[offer.res] || 0) < offer.amount) return { ok: false, error: '你的集市库存不足' };
    const pCenter = this.buildingCenter(sourceMarket);
    const routeOut = this._validateTradeRoute(sourceMarket, targetId, pCenter.x, pCenter.y);
    if (!routeOut.ok) return routeOut;
    // The AI must be able to send the requested goods from one of its markets.
    const aiMarkets = this.buildings.filter((b) => b.owner === targetId && b.complete && !b.dead && b.defId === 'market')
      .map((b) => ({ b, s: this.getSettlement(b.settlementId) })).filter((x) => x.s);
    let aiSource = null;
    for (const am of aiMarkets) {
      if ((am.s.resources[request.res] || 0) < request.amount) continue;
      if (request.amount > this.merchantCapacity(targetId, am.b)) continue;
      const at = this.approachTileForBuilding(am.b, 0, 0);
      if (!at) continue;
      const route = this._validateTradeRoute(am.b, player.id, this.buildingCenter(am.b).x, this.buildingCenter(am.b).y);
      if (!route.ok) continue;
      aiSource = am.b;
      break;
    }
    if (!aiSource) return { ok: false, error: '对方无法或不愿派出商队' };
    const offerValue = offer.amount * D.RES[offer.res].value;
    const requestValue = request.amount * D.RES[request.res].value;
    const rel = this.relationBetween(player.id, targetId);
    let acceptChance = 0.12 + rel / 150 + ((offerValue - requestValue) / Math.max(30, requestValue)) * 0.45;
    if (offerValue > requestValue * 1.25) acceptChance += 0.22;
    if (offerValue < requestValue * 0.7) acceptChance -= 0.35;
    if (rel < 24) acceptChance -= 0.25;
    // A very tight delivery window makes the deal less attractive.
    acceptChance += (durationDays - D.TRADE_TERM.default) * 0.0022;
    const accepted = this.rng.chance(U.clamp(acceptChance, 0.03, 0.94));
    if (!accepted) {
      this.notify(`${D.realmFullName(target)}拒绝了你提出的贸易条件。`, 'trade');
      this.changeRelation(player.id, targetId, -1);
      return { ok: true, accepted: false };
    }
    const deal = this._finalizeTradeDeal({
      a: player.id, b: targetId,
      fromA: { res: offer.res, amount: offer.amount, market: sourceMarket },
      fromB: { res: request.res, amount: request.amount, market: aiSource },
      durationDays
    });
    if (!deal.ok) return deal;
    this.notify(`与${D.realmFullName(target)}的商队出发了。双方需在 ${durationDays} 天内由商人把货物送到集市。`, 'trade', { important: true });
    this.changeRelation(player.id, targetId, 3);
    this.sfx('coin');
    return { ok: true, accepted: true, deal: deal.deal };
  };

  P._finalizeTradeDeal = function (terms) {
    const fa = this.getFaction(terms.a), fb = this.getFaction(terms.b);
    if (!fa || !fb) return { ok: false, error: '无效阵营' };
    if (terms.fromA && typeof terms.fromA.market === 'string') terms.fromA.market = this.getBuilding(terms.fromA.market);
    if (terms.fromB && typeof terms.fromB.market === 'string') terms.fromB.market = this.getBuilding(terms.fromB.market);
    if (!terms.fromA || !terms.fromB || !terms.fromA.market || !terms.fromB.market) return { ok: false, error: '集市已经消失' };
    const aSrc = this.getSettlement(terms.fromA.market.settlementId);
    const bSrc = this.getSettlement(terms.fromB.market.settlementId);
    if (!aSrc || !bSrc) return { ok: false, error: '集市无效' };
    if ((aSrc.resources[terms.fromA.res] || 0) < terms.fromA.amount) return { ok: false, error: '发起方货物不足' };
    if ((bSrc.resources[terms.fromB.res] || 0) < terms.fromB.amount) return { ok: false, error: '接收方货物不足' };
    const routeA = this._validateTradeRoute(terms.fromA.market, terms.b, this.buildingCenter(terms.fromA.market).x, this.buildingCenter(terms.fromA.market).y);
    const routeB = this._validateTradeRoute(terms.fromB.market, terms.a, this.buildingCenter(terms.fromB.market).x, this.buildingCenter(terms.fromB.market).y);
    if (!routeA.ok) return routeA;
    if (!routeB.ok) return routeB;
    if (!this.canAddPop(fa.id)) return { ok: false, error: '人口上限已满，无法派出商人' };
    if (!this.canAddPop(fb.id)) return { ok: false, error: '对方的人口已满，无法派出商队' };
    const durationDays = U.clamp(
      Math.round(Number(terms.durationDays) || D.TRADE_TERM.default),
      D.TRADE_TERM.min, D.TRADE_TERM.max
    );
    // Deduct goods and create caravans.
    this.removeResource(aSrc, terms.fromA.res, terms.fromA.amount);
    this.removeResource(bSrc, terms.fromB.res, terms.fromB.amount);
    const deal = {
      id: this.nextId('deal'), a: terms.a, b: terms.b,
      goodsA: { res: terms.fromA.res, amount: terms.fromA.amount },
      goodsB: { res: terms.fromB.res, amount: terms.fromB.amount },
      started: this.timeDays, durationDays,
      deadline: this.timeDays + durationDays,
      delivered: { a: false, b: false }, failed: false,
      merchants: {}, completedAt: null
    };
    const spawn = (faction, goods, sourceMarket, destMarket, side) => {
      const at = this._merchantSpawnPoint(sourceMarket);
      const u = this._spawnUnit('merchant', faction.id, sourceMarket.settlementId, at.x + 0.5, at.y + 0.5);
      if (!u) return null;
      u.cargoCapacity = this.merchantCapacity(faction.id, sourceMarket);
      u.cargo = { [goods.res]: goods.amount };
      u.tradeDealId = deal.id;
      u.tradeSide = side;
      u.tradeDestination = destMarket.id;
      u.task = { type: 'tradeDeliver', dealId: deal.id, side, marketId: destMarket.id };
      u.order = { type: 'trade', dealId: deal.id };
      const approach = this.approachTileForBuilding(destMarket, at.x, at.y);
      if (!approach || !this._setUnitPath(u, approach.x, approach.y)) {
        u.dead = true;
        this.notify('商队无法找到前往集市的道路，交易取消。', 'warn');
        return null;
      }
      deal.merchants[side] = u.id;
      return u;
    };
    const ma = spawn(fa, deal.goodsA, terms.fromA.market, routeA.target, 'a');
    const mb = spawn(fb, deal.goodsB, terms.fromB.market, routeB.target, 'b');
    if (!ma || !mb) {
      // refund goods that were deducted and remove any half-created caravan
      this.addResource(aSrc, terms.fromA.res, terms.fromA.amount);
      this.addResource(bSrc, terms.fromB.res, terms.fromB.amount);
      if (ma) { ma.dead = true; }
      if (mb) { mb.dead = true; }
      return { ok: false, error: '商队未能出发' };
    }
    this.tradeDeals.push(deal);
    return { ok: true, deal };
  };

  P._deliverTradeMerchant = function (u) {
    if (!u.tradeDealId) return false;
    const deal = this.tradeDeals.find((d) => d.id === u.tradeDealId);
    if (!deal || deal.failed) {
      u.tradeDealId = null; u.task = null; u.order = null; u.state = 'idle';
      return true;
    }
    let market = this.getBuilding(u.tradeDestination);
    if (!market || market.dead || !market.complete) {
      const fallback = this.buildings.find((b) => b.complete && !b.dead && b.defId === 'market' && b.owner === (u.tradeSide === 'a' ? deal.b : deal.a));
      market = fallback || null;
    }
    if (!market) return false;
    const center = this.buildingCenter(market);
    if (U.dist(u.x, u.y, center.x, center.y) > 6) return false;
    const receiverId = market.owner;
    const settlement = this.getSettlement(market.settlementId);
    if (!settlement) return false;
    const cargo = u.cargo || {};
    let delivered = 0;
    for (const [res, amount] of Object.entries(cargo)) {
      delivered += this.addResource(settlement, res, amount);
    }
    const side = u.tradeSide;
    u.cargo = {};
    u.tradeDealId = null;
    u.task = null;
    u.order = null;
    u.state = 'idle';
    u.tradeDestination = null;
    if (side) deal.delivered[side] = true;
    u.tradeSide = null;
    const receiver = this.getFaction(receiverId);
    if (receiver && receiver.isPlayer) {
      this.notify(`商队抵达「${settlement.name}」的集市，货物已经卸下。`, 'trade', { important: true });
    }
    this.changeRelation(deal.a, deal.b, 3);
    if (deal.delivered.a && deal.delivered.b) {
      deal.completedAt = this.timeDays;
      this.changeRelation(deal.a, deal.b, 7);
      this.notify(`与${this.factionLabel(deal.a === this.playerFactionId ? deal.b : deal.a)}的贸易协定已经完成。双方的商人完成了交付。`, 'trade', { important: true });
    }
    if (u.owner !== this.playerFactionId) {
      u.dead = true; // AI merchants slip back home off-screen
    }
    this.sfx('coin', u.x, u.y);
    this.emit('tradeDelivered', deal, u);
    return true;
  };

  P._diplomacyDayTick = function () {
    for (const d of this.tradeDeals) {
      if (d.failed || d.completedAt) continue;
      for (const side of ['a', 'b']) {
        const mid = d.merchants[side];
        const merchant = mid ? this.getUnit(mid) : null;
        if (!merchant || merchant.dead) {
          if (!d.delivered[side]) d.failed = true;
        }
      }
      if (this.timeDays > d.deadline && (!d.delivered.a || !d.delivered.b)) {
        d.failed = true;
      }
      if (d.failed) {
        if (!d._failedNotified) {
          d._failedNotified = true;
          this.changeRelation(d.a, d.b, -7);
          if (d.a === this.playerFactionId || d.b === this.playerFactionId) {
            const other = d.a === this.playerFactionId ? d.b : d.a;
            this.notify(`与${this.factionLabel(other)}的贸易协议失效。商队未能按时完成交付，双方关系恶化。`, 'trade', { important: true });
          }
        }
        for (const side of ['a', 'b']) {
          const m = this.getUnit(d.merchants[side]);
          if (m) { m.tradeDealId = null; m.tradeSide = null; m.task = null; m.order = null; m.state = 'idle'; }
        }
      }
    }
  };

  P.activeTradeDealsFor = function (fid) {
    return this.tradeDeals.filter((d) => !d.failed && !d.completedAt && (d.a === fid || d.b === fid));
  };

  P.tradeDealsFor = function (fid, includeFinished) {
    return this.tradeDeals.filter((d) => (d.a === fid || d.b === fid) &&
      (includeFinished || (!d.failed && !d.completedAt)));
  };

  P.tradeDeadlineText = function (deal) {
    if (!deal) return '';
    const remaining = Math.max(0, Math.ceil(deal.deadline - this.timeDays));
    return `${U.dateLabel(deal.deadline, true)}（剩余 ${remaining} 天）`;
  };

  // =========================================================
  // Incoming decision prompts
  // =========================================================
  P.resolvePrompt = function (promptId, accepted) {
    const p = this.pendingPrompts.find((x) => x.id === promptId);
    if (!p) return { ok: false, error: '提议已经失效' };
    this.removePrompt(promptId);
    const player = this.player;
    const from = this.getFaction(p.from);
    if (!from) return { ok: false };
    const payload = p.payload || {};
    switch (p.kind) {
      case 'allyCall': {
        if (accepted) {
          this._joinWarAgainst(player.id, payload.enemyId, 'alliance', payload.defenderId || p.from);
          this.notify(`你履行了盟约，加入了对${this.factionLabel(payload.enemyId)}的战争。`, 'war', { important: true });
        } else {
          this.changeRelation(player.id, p.from, -12);
          this.changeRelation(player.id, payload.enemyId, 3);
          this.notify(`你拒绝了盟友的求援。${this.factionLabel(p.from)}对你的信任下降了。`, 'diplomacy');
        }
        break;
      }
      case 'vassalCall': {
        if (accepted) {
          this._joinWarAgainst(player.id, payload.enemyId, 'vassal', p.from);
          this.notify(`你响应宗主的征召，加入了战争。`, 'war', { important: true });
        } else {
          this.addCasusBelli(p.from, player.id, 'conquest');
          this.changeRelation(player.id, p.from, -25);
          this.notify(`${this.factionLabel(p.from)}获得了征服你的战争理由。`, 'danger', { important: true });
        }
        break;
      }
      case 'allianceOffer': {
        if (accepted) this._formAlliance(player.id, p.from);
        else {
          this.changeRelation(player.id, p.from, -4);
          this.notify(`你拒绝了${this.factionLabel(p.from)}的结盟提议。`, 'diplomacy');
        }
        break;
      }
      case 'vassalDemand': {
        if (accepted) {
          this._makeVassal(player.id, p.from);
          this.notify(`你向${this.factionLabel(p.from)}俯首称臣，成为其封臣。`, 'diplomacy', { important: true });
        } else {
          this.addCasusBelli(p.from, player.id, 'conquest');
          this.changeRelation(player.id, p.from, -22);
          this.notify(`你拒绝了${this.factionLabel(p.from)}的附庸要求。对方获得了征服你的战争理由。`, 'danger', { important: true });
        }
        break;
      }
      case 'peaceOffer': {
        if (accepted) {
          const war = this.wars.find((w) => w.id === payload.warId);
          if (war) this.endWar(war, p.from);
          else this.notify('这场战争已经结束了。', 'diplomacy');
        } else {
          this.changeRelation(player.id, p.from, -3);
          this.notify(`你拒绝了${this.factionLabel(p.from)}的和平提议。`, 'diplomacy');
        }
        break;
      }
      case 'tradeOffer': {
        if (accepted) {
          const terms = payload.terms;
          if (!terms) { this.notify('贸易提议的内容已经失效。', 'trade'); break; }
          const deal = this._finalizeTradeDeal(terms);
          if (deal.ok) {
            this.notify(`你与${this.factionLabel(p.from)}达成了贸易协议，期限 ${deal.deal.durationDays} 天。`, 'trade', { important: true });
            this.changeRelation(player.id, p.from, 3);
          } else {
            this.notify(deal.error || '贸易未能成行。', 'warn');
          }
        } else {
          this.changeRelation(player.id, p.from, -2);
          this.notify(`你拒绝了${this.factionLabel(p.from)}的贸易提议。`, 'trade');
        }
        break;
      }
      case 'inviteWar': {
        if (accepted) {
          this._joinWarAgainst(player.id, payload.enemyId, 'alliance', p.from);
          this.notify(`你接受了${this.factionLabel(p.from)}的邀请，加入了对${this.factionLabel(payload.enemyId)}的战争。`, 'war', { important: true });
        } else {
          this.changeRelation(player.id, p.from, -3);
        }
        break;
      }
      default:
        break;
    }
    this.emit('promptResolved', p, accepted);
    return { ok: true };
  };

  P.pendingPromptCount = function () { return this.pendingPrompts.length; };
})();
