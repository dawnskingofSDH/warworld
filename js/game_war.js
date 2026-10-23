/* WARWORLD — warfare, alliances, war declarations, sieges and combat. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const P = WW.Game.prototype;

  // =========================================================
  // Relations & treaties
  // =========================================================
  P.atWar = function (a, b) {
    if (!a || !b || a === b) return false;
    return this.wars.some((w) => !w.ended && ((w.a === a && w.b === b) || (w.a === b && w.b === a)));
  };
  P.getWar = function (a, b) {
    return this.wars.find((w) => !w.ended && ((w.a === a && w.b === b) || (w.a === b && w.b === a))) || null;
  };
  P.warsFor = function (fid) {
    return this.wars.filter((w) => !w.ended && (w.a === fid || w.b === fid));
  };
  P.areAllied = function (a, b) {
    return this.alliances.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  };
  P.alliesOf = function (fid) {
    const out = [];
    for (const a of this.alliances) {
      if (a.a === fid) out.push(a.b);
      else if (a.b === fid) out.push(a.a);
    }
    return out;
  };
  P.isVassalOf = function (vassal, overlord) {
    return this.vassals.some((v) => v.vassal === vassal && v.overlord === overlord);
  };
  P.overlordOf = function (fid) {
    const v = this.vassals.find((x) => x.vassal === fid);
    return v ? v.overlord : null;
  };
  P.vassalsOf = function (fid) {
    return this.vassals.filter((v) => v.overlord === fid).map((v) => v.vassal);
  };
  P.changeRelation = function (a, b, delta) {
    if (a === b) return;
    const fa = this.getFaction(a), fb = this.getFaction(b);
    if (!fa || !fb) return;
    const cur = fa.relations[b] == null ? 50 : fa.relations[b];
    const next = U.clamp(cur + delta, 0, 100);
    fa.relations[b] = next;
    fb.relations[a] = next;
  };
  P.relationBetween = function (a, b) {
    const f = this.getFaction(a);
    return f && f.relations[b] != null ? f.relations[b] : 50;
  };

  P.addPrompt = function (kind, fromId, payload, opts) {
    opts = opts || {};
    // Avoid duplicate pending offers of the same kind from the same realm.
    const existing = this.pendingPrompts.find((p) => p.kind === kind && p.from === fromId && !p.resolved);
    if (existing) return existing;
    const from = this.getFaction(fromId);
    const prompt = {
      id: this.nextId('p'), kind, from: fromId, fromName: from ? D.realmFullName(from) : '未知势力',
      payload: payload || {}, pause: opts.pause !== false, created: this.timeDays,
      title: opts.title || '', text: opts.text || ''
    };
    this.pendingPrompts.push(prompt);
    this.emit('prompt', prompt);
    return prompt;
  };

  P.removePrompt = function (id) {
    const idx = this.pendingPrompts.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const p = this.pendingPrompts[idx];
    this.pendingPrompts.splice(idx, 1);
    return p;
  };

  P.casusBelliAgainst = function (fid, targetId) {
    const f = this.getFaction(fid);
    if (!f) return [];
    return (f.casusBelli || []).filter((c) => c.target === targetId);
  };
  P.addCasusBelli = function (fid, targetId, reason, opts) {
    const f = this.getFaction(fid);
    if (!f) return null;
    if (!f.casusBelli) f.casusBelli = [];
    const existing = f.casusBelli.find((c) => c.target === targetId && c.reason === reason);
    if (existing) return existing;
    const cb = { id: this.nextId('cb'), target: targetId, reason, created: this.timeDays };
    f.casusBelli.push(cb);
    if (f.isPlayer) {
      const target = this.getFaction(targetId);
      this.notify(`你获得了一个战争理由：${D.CAUSE_LABEL[reason] || reason}（针对${target ? D.realmFullName(target) : '未知势力'}）。`, 'diplomacy', { important: true });
      this.sfx('rumor');
    }
    return cb;
  };
  P.removeCasusBelli = function (fid, cbId) {
    const f = this.getFaction(fid);
    if (!f || !f.casusBelli) return;
    f.casusBelli = f.casusBelli.filter((c) => c.id !== cbId);
  };

  // =========================================================
  // War declarations and alliances
  // =========================================================
  P.declareWar = function (aId, bId, cbId, opts) {
    opts = opts || {};
    const a = this.getFaction(aId), b = this.getFaction(bId);
    if (!a || !b || a.eliminated || b.eliminated) return { ok: false, error: '无效阵营' };
    if (aId === bId) return { ok: false, error: '不能对自己宣战' };
    if (this.atWar(aId, bId)) return { ok: false, error: '双方已处于战争状态' };
    if (this.areAllied(aId, bId) && !opts.force) return { ok: false, error: '盟友之间必须先解除同盟才能宣战' };
    const rebellionCb = (a.casusBelli || []).find((c) => c.target === bId && c.reason === 'independence');
    if (this.isVassalOf(aId, bId) && !rebellionCb) return { ok: false, error: '封臣不能向宗主宣战。先请求解除附庸，拒绝后可用「独立」理由起兵。' };
    if (!opts.ignoreTruce && a.truces && a.truces[bId] > this.timeDays) return { ok: false, error: `停战协定尚未到期（还有 ${Math.ceil(a.truces[bId] - this.timeDays)} 天）` };
    let reason = opts.reason || 'none';
    let cb = null;
    if (cbId) {
      cb = (a.casusBelli || []).find((c) => c.id === cbId && c.target === bId);
      if (!cb) return { ok: false, error: '无效的战争理由' };
      reason = cb.reason;
    } else if (!opts.called && !opts.reason) {
      reason = 'none';
    }
    if (this.isVassalOf(aId, bId) && reason !== 'independence') {
      return { ok: false, error: '封臣只能以「独立」为理由向宗主宣战' };
    }
    if (this.isVassalOf(aId, bId) && reason === 'independence') {
      this.vassals = this.vassals.filter((v) => !(v.vassal === aId && v.overlord === bId));
      this.notify(`${D.realmFullName(a)}宣布脱离${D.realmFullName(b)}，独立战争爆发。`, 'war', { important: true });
    }
    if (!cbId && !opts.called && reason === 'none') {
      // an unprovoked war harms the aggressor's standing everywhere
      for (const other of this.factions) {
        if (other.id === aId || other.id === bId || other.eliminated) continue;
        this.changeRelation(aId, other.id, -10);
      }
      this.changeRelation(aId, bId, -35);
    } else {
      this.changeRelation(aId, bId, -40);
      for (const other of this.factions) {
        if (other.id === aId || other.id === bId || other.eliminated) continue;
        this.changeRelation(aId, other.id, -2);
      }
    }
    if (cb) this.removeCasusBelli(aId, cb.id);
    const war = {
      id: this.nextId('w'), a: aId, b: bId, started: this.timeDays, reason,
      aggressor: aId, defender: bId, ended: false,
      exhaustion: { [aId]: 0, [bId]: 0 },
      losses: { [aId]: 0, [bId]: 0 },
      joinedBy: []
    };
    this.wars.push(war);
    if (this.areAllied(aId, bId) && opts.force) {
      this.alliances = this.alliances.filter((x) => !((x.a === aId && x.b === bId) || (x.a === bId && x.b === aId)));
    }
    // Cancel trade caravans between enemies.
    this.tradeDeals = this.tradeDeals.filter((d) => {
      if ((d.a === aId && d.b === bId) || (d.a === bId && d.b === aId)) {
        d.failed = true;
        for (const u of this.units) {
          if (!u.dead && u.tradeDealId === d.id) { u.task = null; u.order = { type: 'move', x: u.x, y: u.y }; u.tradeDealId = null; }
        }
        return false;
      }
      return true;
    });
    if (a.isPlayer || b.isPlayer) {
      const playerIsAggressor = a.isPlayer;
      this.notify(playerIsAggressor
        ? `你对${D.realmFullName(b)}发出了战争号令。${reason === 'none' ? '这是一场没有正当理由的战争，其他列强对此感到不安。' : '战争理由：' + D.CAUSE_LABEL[reason]}`
        : `${D.realmFullName(a)}向你的王国宣战！${reason === 'none' ? '他们没有给出任何正当理由。' : '战争理由：' + D.CAUSE_LABEL[reason]}`, 'war', { important: true });
      this.sfx('warhorn');
      this.emit('warDeclared', war);
    } else {
      this.notify(`${D.realmFullName(a)}向${D.realmFullName(b)}宣战（${D.CAUSE_LABEL[reason] || reason}）。`, 'world');
    }
    // Defender's allies may answer the call.
    this._askAlliesToJoin(war, bId, aId, 0);
    // The aggressor's vassals will be called by AI overlords later; for the player this is a manual diplomacy action.
    return { ok: true, war };
  };

  P._askAlliesToJoin = function (war, defenderId, aggressorId, depth) {
    if (depth > 2) return;
    for (const allyId of this.alliesOf(defenderId)) {
      const ally = this.getFaction(allyId);
      if (!ally || ally.eliminated) continue;
      if (allyId === aggressorId || this.atWar(allyId, aggressorId)) continue;
      if (this.areAllied(allyId, aggressorId)) continue;
      if (ally.isPlayer) {
        this.addPrompt('allyCall', defenderId, { enemyId: aggressorId, warId: war.id, defenderId }, {
          pause: true,
          title: '盟友求援',
          text: `${D.realmFullName(this.getFaction(defenderId))}正在遭受${D.realmFullName(this.getFaction(aggressorId))}的攻击，并请求你履行盟约。`
        });
      } else {
        const rel = this.relationBetween(allyId, defenderId);
        const chance = U.clamp(0.28 + rel / 160 + (ally.ai ? ally.ai.aggression * 0.08 : 0), 0.15, 0.92);
        if (this.rng.chance(chance)) {
          this._joinWarAgainst(allyId, aggressorId, 'alliance', defenderId);
        } else {
          this.changeRelation(allyId, defenderId, -8);
          if (this.getFaction(defenderId).isPlayer) this.notify(`${D.realmFullName(ally)}拒绝响应你的盟约。`, 'diplomacy');
        }
      }
    }
  };

  P._joinWarAgainst = function (joinerId, enemyId, reason, helpedId) {
    if (joinerId === enemyId || this.atWar(joinerId, enemyId)) return null;
    const joiner = this.getFaction(joinerId), enemy = this.getFaction(enemyId);
    if (!joiner || !enemy) return null;
    const war = {
      id: this.nextId('w'), a: joinerId, b: enemyId, started: this.timeDays,
      reason: reason || 'alliance', aggressor: enemyId, defender: joinerId,
      ended: false, exhaustion: { [joinerId]: 0, [enemyId]: 0 },
      losses: { [joinerId]: 0, [enemyId]: 0 }, joinedBy: [], helped: helpedId || null
    };
    this.wars.push(war);
    this.changeRelation(joinerId, enemyId, -35);
    if (helpedId) this.changeRelation(joinerId, helpedId, 6);
    if (joiner.isPlayer || enemy.isPlayer) {
      this.notify(`${D.realmFullName(joiner)}履行盟约，加入了对${D.realmFullName(enemy)}的战争。`, 'war', { important: true });
      this.sfx('warhorn');
    } else {
      this.notify(`${D.realmFullName(joiner)}加入了对${D.realmFullName(enemy)}的战争。`, 'world');
    }
    return war;
  };

  P.joinWar = function (joinerId, enemyId, reason, helpedId) {
    return this._joinWarAgainst(joinerId, enemyId, reason || 'alliance', helpedId);
  };

  P.breakAlliance = function (aId, bId, byId) {
    if (!this.areAllied(aId, bId)) return { ok: false, error: '双方并未结盟' };
    this.alliances = this.alliances.filter((x) => !((x.a === aId && x.b === bId) || (x.a === bId && x.b === aId)));
    this.changeRelation(aId, bId, -22);
    const fa = this.getFaction(aId), fb = this.getFaction(bId);
    if ((fa && fa.isPlayer) || (fb && fb.isPlayer)) {
      this.notify(`${D.realmFullName(fa)}与${D.realmFullName(fb)}的同盟关系破裂了。`, 'diplomacy', { important: true });
    }
    return { ok: true };
  };

  P.callVassalToWar = function (overlordId, vassalId, warId) {
    if (!this.isVassalOf(vassalId, overlordId)) return { ok: false, error: '对方不是你的封臣' };
    const war = this.wars.find((w) => w.id === warId && !w.ended);
    if (!war) return { ok: false, error: '战争不存在' };
    const enemyId = war.a === overlordId ? war.b : war.a;
    const vassal = this.getFaction(vassalId);
    const overlord = this.getFaction(overlordId);
    if (!vassal || !overlord) return { ok: false, error: '无效阵营' };
    if (this.atWar(vassalId, enemyId)) return { ok: false, error: '封臣已经在此战争中' };
    if (vassal.isPlayer) {
      this.addPrompt('vassalCall', overlordId, { enemyId, warId }, {
        pause: true, title: '宗主的征召',
        text: `${D.realmFullName(overlord)}要求你履行封臣义务，加入对${D.realmFullName(this.getFaction(enemyId))}的战争。拒绝将被视为背叛。`
      });
    } else {
      const rel = this.relationBetween(overlordId, vassalId);
      const chance = U.clamp(0.35 + rel / 150, 0.2, 0.92);
      if (this.rng.chance(chance)) {
        this._joinWarAgainst(vassalId, enemyId, 'vassal', overlordId);
        this.notify(`${D.realmFullName(vassal)}响应了${D.realmFullName(overlord)}的征召。`, 'world');
      } else {
        this.addCasusBelli(overlordId, vassalId, 'conquest');
        this.changeRelation(overlordId, vassalId, -25);
        if (overlord.isPlayer) this.notify(`${D.realmFullName(vassal)}拒绝参战。你获得了征服他们的战争理由。`, 'diplomacy', { important: true });
      }
    }
    return { ok: true };
  };

  P.proposePeace = function (warId, initiatorId) {
    const war = this.wars.find((w) => w.id === warId && !w.ended);
    if (!war) return { ok: false, error: '战争已经结束' };
    const initiator = this.getFaction(initiatorId);
    if (!initiator) return { ok: false, error: '无效阵营' };
    if (initiatorId !== war.a && initiatorId !== war.b) return { ok: false, error: '你不在此战争中' };
    const responderId = war.a === initiatorId ? war.b : war.a;
    const responder = this.getFaction(responderId);
    if (!responder) return { ok: false, error: '无效对手' };
    if (responder.isPlayer) {
      this.addPrompt('peaceOffer', initiatorId, { warId, initiatorId }, {
        pause: true, title: '和平提议',
        text: `${D.realmFullName(initiator)}提议结束双方的战争，恢复和平。`
      });
      return { ok: true, pending: true };
    }
    if (this._aiAcceptsPeace(war, responderId, initiatorId)) {
      this.endWar(war, initiatorId);
      if (initiator.isPlayer) this.notify(`${D.realmFullName(responder)}接受了和平提议。战争结束。`, 'diplomacy', { important: true });
      return { ok: true, accepted: true };
    }
    if (initiator.isPlayer) this.notify(`${D.realmFullName(responder)}拒绝了和平提议。他们仍想继续这场战争。`, 'diplomacy');
    return { ok: true, accepted: false };
  };

  P._aiAcceptsPeace = function (war, aiId, otherId) {
    const ai = this.getFaction(aiId);
    if (!ai) return false;
    const exhaustion = (war.exhaustion && war.exhaustion[aiId]) || 0;
    const powerAi = this._factionPower(aiId);
    const powerOther = this._factionPower(otherId);
    const losing = powerOther > powerAi * 1.35;
    const winning = powerAi > powerOther * 1.45;
    let chance = 0.12 + exhaustion / 130;
    if (losing) chance += 0.3;
    if (winning) chance -= 0.22;
    if (this.timeDays - war.started > 80) chance += 0.12;
    return this.rng.chance(U.clamp(chance, 0.03, 0.92));
  };

  P.endWar = function (war, byId) {
    if (!war || war.ended) return;
    war.ended = true;
    this.wars = this.wars.filter((w) => w.id !== war.id);
    const a = this.getFaction(war.a), b = this.getFaction(war.b);
    if (!a || !b) return;
    const now = this.timeDays;
    a.truces = a.truces || {}; b.truces = b.truces || {};
    a.truces[b.id] = now + 70; b.truces[a.id] = now + 70;
    this.changeRelation(a.id, b.id, 20);
    // Stop soldiers that were fighting each other.
    for (const u of this.units) {
      if (u.dead || !u.def.military) continue;
      const enemyFid = u.order && u.order.targetKind === 'building' ? (this.getBuilding(u.order.targetId) || {}).owner :
        u.order && u.order.targetId ? (this.getUnit(u.order.targetId) || {}).owner : null;
      if ((u.owner === a.id && enemyFid === b.id) || (u.owner === b.id && enemyFid === a.id)) {
        u.order = null; u.target = null; u.state = 'idle'; u.path = [];
      }
    }
    if (a.isPlayer || b.isPlayer) {
      this.notify(`停战协定已经签署。${D.realmFullName(a)}与${D.realmFullName(b)}恢复和平。`, 'diplomacy', { important: true });
      this.sfx('bell');
    } else {
      this.notify(`${D.realmFullName(a)}与${D.realmFullName(b)}结束了战争。`, 'world');
    }
    this.emit('warEnded', war);
  };

  P._factionPower = function (fid) {
    let power = 0;
    for (const u of this.units) {
      if (u.owner !== fid || u.dead) continue;
      if (u.def.military) power += 2.2 + (u.def.atk || 0) * 0.22 + (u.def.hp || 0) * 0.012;
      else if (u.isShip) power += 1.5;
      else power += 0.35;
    }
    for (const b of this.buildings) {
      if (b.owner !== fid || b.dead) continue;
      if (b.defId === 'tower') power += 2;
      if (b.defId === 'wall' || b.defId === 'gate') power += 0.25;
      if (b.defId === 'hall' && b.complete) power += 3 * b.level;
    }
    for (const s of this.ownedSettlements(fid)) power += 5 + s.stage * 2;
    return power;
  };

  P._warDayTick = function () {
    for (const war of this.wars.slice()) {
      if (war.ended) continue;
      const age = this.timeDays - war.started;
      for (const side of [war.a, war.b]) {
        if (!war.exhaustion[side]) war.exhaustion[side] = 0;
        war.exhaustion[side] = Math.min(140, war.exhaustion[side] + 0.055 + (age > 60 ? 0.035 : 0));
      }
      // AI may seek peace once the war has dragged on or it is losing.
      const a = this.getFaction(war.a), b = this.getFaction(war.b);
      if (!a || !b) continue;
      if (a.ai && !b.isPlayer && age > 20 && this.rng.chance(0.008 + war.exhaustion[war.a] / 9000)) {
        if (this._aiAcceptsPeace(war, war.a, war.b)) {
          this.endWar(war, war.a);
          continue;
        }
      }
      if (b.ai && !a.isPlayer && age > 20 && this.rng.chance(0.008 + war.exhaustion[war.b] / 9000)) {
        if (this._aiAcceptsPeace(war, war.b, war.a)) {
          this.endWar(war, war.b);
          continue;
        }
      }
      if (a.isPlayer && b.ai && age > 25 && this.rng.chance(0.007 + war.exhaustion[war.b] / 8000)) {
        this.addPrompt('peaceOffer', b.id, { warId: war.id, initiatorId: b.id }, {
          pause: true, title: '敌国的和平使节',
          text: `${D.realmFullName(b)}派出使节，希望结束与你的战争。`
        });
      }
      if (b.isPlayer && a.ai && age > 25 && this.rng.chance(0.007 + war.exhaustion[war.a] / 8000)) {
        this.addPrompt('peaceOffer', a.id, { warId: war.id, initiatorId: a.id }, {
          pause: true, title: '敌国的和平使节',
          text: `${D.realmFullName(a)}派出使节，希望结束与你的战争。`
        });
      }
    }
  };

  // =========================================================
  // Combat — target selection and attacks
  // =========================================================
  P._isEnemyUnit = function (a, b) {
    if (!a || !b || a === b) return false;
    return this.atWar(a, b);
  };

  P._techAttackMultiplier = function (faction, unit) {
    const mod = this._mod(faction);
    if (!unit.def.military) return 1;
    if (unit.def.ranged) return 1 + (mod.rangedAtk || 0);
    return 1 + (mod.meleeAtk || 0);
  };

  P._unitArmor = function (u) {
    const f = this.getFaction(u.owner);
    return (u.def.def || 0) + ((f && this._mod(f).armor) || 0) + (u.def.cls === 'ship' ? 0 : 0);
  };

  P._buildingArmor = function (b) {
    let armor = 1 + (b.level || 1) * 1.1;
    if (b.defId === 'wall' || b.defId === 'gate') armor += 2;
    if (b.defId === 'hall') armor += 2;
    return armor;
  };

  P._unitRange = function (u) {
    const f = this.getFaction(u.owner);
    let range = u.def.range || 0.8;
    if (u.def.ranged) range += (f && this._mod(f).range) || 0;
    return range;
  };

  P._unitAttack = function (u) {
    const f = this.getFaction(u.owner);
    return (u.def.atk || 0) * this._techAttackMultiplier(f, u);
  };

  P._autoTarget = function (u) {
    if (!u.def.military || u.state === 'aboard' || u.state === 'inside' || u.state === 'patient') return null;
    const range = this._unitRange(u);
    const aggro = Math.max(5.2, range + (u.def.ranged ? 2.2 : 1.2));
    let best = null, bestD = aggro * aggro;
    for (const other of this.units) {
      if (other.dead || other.owner === u.owner) continue;
      if (!this.atWar(u.owner, other.owner)) continue;
      if (other.state === 'aboard' || other.state === 'inside') continue;
      if (other.isShip && !u.def.ranged) continue;
      const d = U.dist2(u.x, u.y, other.x, other.y);
      if (d < bestD) { bestD = d; best = other; }
    }
    if (best) return { kind: 'unit', id: best.id };
    return null;
  };

  P._updateCombat = function (dt, days) {
    const factionPlayers = this.playerFactionId;
    for (const u of this.units) {
      if (u.dead || !u.def.military) continue;
      if (u.state === 'inside' || u.state === 'aboard' || u.state === 'patient') continue;
      u.think = (u.think || 0) - dt;
      // Continue an existing attack.
      if (u.state === 'attacking' && u.target) {
        this._processAttack(u, dt);
        continue;
      }
      // Idle soldiers pick nearby enemies. AI soldiers marching also engage nearby enemies.
      if (u.think <= 0) {
        u.think = 0.4 + this.rng.next() * 0.4;
        const canScan = u.state === 'idle' ||
          (u.owner !== factionPlayers && u.order && u.order.type === 'attack');
        if (canScan) {
          const t = this._autoTarget(u);
          if (t) {
            u.order = { type: 'attack', targetKind: t.kind, targetId: t.id };
            u.target = { kind: t.kind, id: t.id };
            u.state = 'attacking';
            this._processAttack(u, dt);
          }
        }
      }
    }
    this._updateTowers(dt);
  };

  P._processAttack = function (u, dt) {
    if (!u.target) { u.state = 'idle'; return; }
    const target = u.target.kind === 'building' ? this.getBuilding(u.target.id) : this.getUnit(u.target.id);
    if (!target || target.dead) {
      u.target = null;
      u.order = null;
      u.state = 'idle';
      u.path = [];
      return;
    }
    const targetOwner = target.owner;
    if (!this.atWar(u.owner, targetOwner) || targetOwner === u.owner || targetOwner == null) {
      u.target = null; u.order = null; u.state = 'idle';
      return;
    }
    if (u.target.kind === 'unit' && target.isShip && !u.def.ranged) {
      u.target = null; u.order = null; u.state = 'idle'; return;
    }
    const range = this._unitRange(u);
    let dist;
    if (u.target.kind === 'building') dist = this.distanceToBuilding(u.x, u.y, target);
    else dist = Math.max(0, U.dist(u.x, u.y, target.x, target.y) - (target.def.radius || 0.3));
    if (dist > range + 0.15) {
      u.combatRepath = (u.combatRepath || 0) - dt;
      if (u.combatRepath <= 0) {
        u.combatRepath = 0.7 + this.rng.next() * 0.5;
        let at;
        if (u.target.kind === 'building') at = this.approachTileForBuilding(target, u.x, u.y);
        else {
          const p = this._walkableNear(Math.floor(target.x), Math.floor(target.y), false, 5) || { x: Math.floor(target.x), y: Math.floor(target.y) };
          at = p;
        }
        if (at) {
          if (this._setUnitPath(u, at.x, at.y, { allowPartial: true })) {
            u.state = 'moving';
            u.order = { type: 'attack', targetKind: u.target.kind, targetId: target.id };
            return;
          }
        }
        // No way to reach — give up for now.
        if (u.owner === this.playerFactionId) this.notify('部队无法接近目标。也许需要先攻破大门，或先打开己方城门。', 'military');
        u.target = null; u.order = null; u.state = 'idle';
      }
      return;
    }
    if (u.path && u.path.length) { u.path = []; }
    u.state = 'attacking';
    u.attackCooldown = (u.attackCooldown || 0) - dt;
    if (u.attackCooldown > 0) return;
    u.attackCooldown = Math.max(0.45, (u.def.interval || 1.2) * (0.9 + this.rng.next() * 0.22));
    u.facing = Math.atan2(target.y - u.y, target.x - u.x);
    let dmg = this._unitAttack(u);
    if (u.target.kind === 'building') dmg *= u.def.ranged ? 0.8 : 1.25;
    else {
      const armor = this._unitArmor(target);
      dmg = Math.max((u.def.atk || 1) * 0.16, dmg * (0.9 + this.rng.next() * 0.2) - armor * 0.62);
      // forest cover blunts missiles
      if (u.def.ranged) {
        const txt = this.world.terrainDef(Math.floor(target.x), Math.floor(target.y));
        if (txt.key === 'forest') dmg *= 0.86;
      }
    }
    if (u.target.kind === 'building') dmg = Math.max(0.4, dmg * (0.92 + this.rng.next() * 0.16) - this._buildingArmor(target) * 0.3);
    if (u.def.ranged || (u.def.range || 0) > 2) {
      this._addProjectile(u, target, u.def.ranged ? 'arrow' : 'bolt');
    } else {
      this.addEffect('clash', target.x, target.y, 0.32, { color: '#e4d1a0' });
      this.emit('battleSfx', 'sword', u.x, u.y);
    }
    if (u.target.kind === 'building') {
      this._damageBuilding(target, dmg, u.owner, u.id);
    } else {
      this._damageUnit(target, dmg, u, u.def.ranged);
    }
    if (u.owner === this.playerFactionId && this.rng.chance(0.06)) {
      // no chatty combat log; only occasional audio cues
    }
  };

  P._addProjectile = function (u, target, type) {
    const tx = target.def && target.def.foot ? this.buildingCenter(target).x : target.x;
    const ty = target.def && target.def.foot ? this.buildingCenter(target).y : target.y;
    this.projectiles.push({ x1: u.x, y1: u.y, x2: tx, y2: ty, life: 0.28, maxLife: 0.28, type: type || 'arrow', color: '#e6d4a4' });
    this.emit('battleSfx', 'bow', u.x, u.y);
  };

  P._damageUnit = function (target, dmg, attacker, ranged) {
    if (!target || target.dead) return;
    target.hp -= dmg;
    target.lastDamaged = this.timeDays;
    target.lastAttackerFaction = attacker ? attacker.owner : null;
    target.lastAttacker = attacker ? attacker.id : null;
    this.addEffect('hit', target.x, target.y, 0.32, { color: '#e8c88c' });
    if (target.hp <= 0) {
      target.hp = 0;
      target.dead = true;
      this.addEffect('death', target.x, target.y, 0.8, { color: '#8d3b35' });
      this.emit('battleSfx', 'death', target.x, target.y);
      const war = attacker ? this.getWar(attacker.owner, target.owner) : null;
      if (war) {
        if (!target.isShip) war.losses[target.owner] = (war.losses[target.owner] || 0) + 1;
        war.exhaustion[target.owner] = Math.min(140, (war.exhaustion[target.owner] || 0) + (target.isShip ? 3 : 1.7));
        war.exhaustion[attacker.owner] = Math.min(140, (war.exhaustion[attacker.owner] || 0) + 0.4);
      }
    }
  };

  P.defenderOf = function (attacker, target) {
    return this.getWar(attacker, target);
  };

  P._damageBuilding = function (b, dmg, attackerFid, attackerUnitId) {
    if (!b || b.dead) return;
    b.hp -= dmg;
    b.lastAttacker = attackerFid;
    b.lastAttackerUnit = attackerUnitId || null;
    b.lastDamaged = this.timeDays;
    const c = this.buildingCenter(b);
    this.addEffect('debris', c.x, c.y, 0.6, { color: '#a89b7b' });
    const war = this.getWar(attackerFid, b.owner);
    if (war) {
      war.exhaustion[b.owner] = Math.min(140, (war.exhaustion[b.owner] || 0) + 0.012);
    }
    if (b.hp <= 0) {
      b.hp = 0;
      if (b.defId === 'hall') {
        this._captureSettlement(b, attackerFid);
      } else {
        this._destroyBuilding(b, attackerFid);
      }
    }
  };

  P._destroyBuilding = function (b, attackerFid) {
    if (!b || b.dead) return;
    const faction = this.getFaction(b.owner);
    const attacker = this.getFaction(attackerFid);
    b.dead = true;
    b.destroyedAt = this.timeDays;
    const c = this.buildingCenter(b);
    this.addEffect('ruin', c.x, c.y, 1.6, { color: '#635b4c' });
    if (faction && faction.isPlayer) {
      this.notify(`${D.buildingName(b.def, b.level)}被${attacker ? D.realmFullName(attacker) : '敌军'}摧毁了。`, 'danger', { important: true, settlementId: b.settlementId });
      this.sfx('collapse', c.x, c.y);
    } else if (attacker && attacker.isPlayer) {
      this.notify(`你的军队摧毁了${D.buildingName(b.def, b.level)}。`, 'war');
    }
    this._ejectOccupants(b, true);
    const war = this.getWar(attackerFid, b.owner);
    if (war) {
      war.exhaustion[b.owner] = Math.min(140, (war.exhaustion[b.owner] || 0) + 1.2);
    }
    this.path.rebuildAll(this);
    this.refreshNodeBoosts();
    this.emit('buildingDestroyed', b);
  };

  P._ejectOccupants = function (b, damage) {
    const remove = new Set([...(b.workers || []), ...(b.constructors || []), ...(b.repairers || []), ...(b.patients || [])]);
    for (const id of remove) {
      const u = this.getUnit(id);
      if (!u) continue;
      if (u.state === 'inside' || u.state === 'constructing' || u.state === 'repairing' || u.state === 'patient') {
        const at = this.approachTileForBuilding(b, u.x, u.y) || { x: b.x, y: b.y - 1 };
        u.x = at.x + 0.5; u.y = at.y + 0.5;
        u.state = 'idle';
        u.task = null; u.order = null; u.buildingId = null;
        if (damage) u.hp = Math.max(1, u.hp - u.maxHp * 0.15);
      }
    }
    b.workers = []; b.constructors = []; b.repairers = []; b.patients = [];
  };

  P._captureSettlement = function (hall, attackerFid) {
    const settlement = this.getSettlement(hall.settlementId);
    if (!settlement) { this._destroyBuilding(hall, attackerFid); return; }
    const attacker = this.getFaction(attackerFid);
    const oldOwner = this.getFaction(settlement.owner);
    if (!attacker || !oldOwner || attackerFid === settlement.owner || !this.atWar(attackerFid, settlement.owner)) {
      this._destroyBuilding(hall, attackerFid);
      return;
    }
    const oldName = settlement.name;
    const buildings = this.buildings.filter((b) => b.settlementId === settlement.id && !b.dead);
    // eject old owner's people from all buildings, but transfer the structures
    for (const b of buildings) {
      for (const id of [...(b.workers || []), ...(b.constructors || []), ...(b.repairers || []), ...(b.patients || [])]) {
        const u = this.getUnit(id);
        if (!u) continue;
        if (u.owner === oldOwner.id) {
          const at = this.approachTileForBuilding(b, u.x, u.y) || { x: b.x, y: b.y - 1 };
          u.x = at.x + 0.5; u.y = at.y + 0.5;
          u.state = 'idle';
          u.task = null; u.order = null; u.buildingId = null;
        }
      }
      b.workers = []; b.constructors = []; b.repairers = []; b.patients = [];
      b.owner = attacker.id;
    }
    // Civilians whose home is the captured settlement become the conqueror's
    // subjects. Garrisons and soldiers from elsewhere remain the old realm's.
    for (const u of this.units) {
      if (u.dead || u.owner !== oldOwner.id || u.homeSettlement !== settlement.id) continue;
      if (u.isShip || !u.def || u.def.cls !== 'civilian' || u.state === 'aboard') continue;
      u.owner = attacker.id;
      if (u.kind === 'merchant') {
        u.order = null;
        u.task = null;
        u.tradeDealId = null;
        u.tradeSide = null;
        u.tradeDestination = null;
      }
    }
    settlement.owner = attacker.id;
    settlement.lastOwner = oldOwner.id;
    settlement.occupiedUntil = this.timeDays + 35;
    settlement.stability = Math.min(settlement.stability, 24);
    settlement.shortage = false;
    hall.hp = Math.max(1, Math.round(hall.maxHp * 0.28));
    hall.lastAttacker = null;
    // one Royal Palace per realm
    if (hall.level === 4) {
      const otherCap = this.ownedSettlements(attacker.id).find((s) => s.id !== settlement.id && s.stage === 4);
      if (otherCap) {
        hall.level = 3;
        hall.maxHp = D.buildingHp(hall.def, 3);
        hall.hp = Math.min(hall.hp, Math.round(hall.maxHp * 0.5));
        settlement.stage = 3;
      }
    }
    settlement.stage = hall.level;
    this.updateRank(oldOwner);
    this.updateRank(attacker);
    this.path.rebuildAll(this);
    this.refreshNodeBoosts();
    this.addEffect('flag', settlement.x, settlement.y, 2.4, { color: attacker.colors.primary });
    this.notify(`${D.realmFullName(attacker)}攻陷了「${oldName}」。${D.realmFullName(oldOwner)}失去了这座城市。`, 'war', { important: true, settlementId: settlement.id });
    this.sfx('capture', settlement.x, settlement.y);
    this.emit('settlementCaptured', settlement, oldOwner, attacker);
    if (oldOwner.isPlayer) this.emit('crisis', 'lostSettlement', { settlement, attacker });
    if (!this.ownedSettlements(oldOwner.id).length) {
      this.notify(`${D.realmFullName(oldOwner)}失去了最后的定居点，但仍有军队在战场上。`, oldOwner.isPlayer ? 'danger' : 'world', { important: oldOwner.isPlayer });
    }
    this._checkEliminations();
  };

  // =========================================================
  // Towers & siege helpers
  // =========================================================
  P._updateTowers = function (dt) {
    for (const b of this.buildings) {
      if (b.dead || !b.complete || b.defId !== 'tower') continue;
      const owner = this.getFaction(b.owner);
      if (!owner) continue;
      const range = (b.def.towerRange && b.def.towerRange[b.level]) || 5;
      const dmgBase = (b.def.towerDamage && b.def.towerDamage[b.level]) || 8;
      b.towerCooldown = (b.towerCooldown || 0) - dt;
      if (b.towerCooldown > 0) continue;
      const c = this.buildingCenter(b);
      let best = null, bestD = range * range;
      for (const u of this.units) {
        if (u.dead || !this.atWar(b.owner, u.owner)) continue;
        if (u.state === 'aboard' || u.state === 'inside' || u.state === 'patient') continue;
        const d = U.dist2(c.x, c.y, u.x, u.y);
        if (d < bestD) { bestD = d; best = u; }
      }
      if (!best) continue;
      b.towerCooldown = (b.def.towerInterval || 1.7) * (0.92 + this.rng.next() * 0.18);
      const f = this.getFaction(b.owner);
      const dmg = dmgBase * (1 + ((f && this._mod(f).rangedAtk) || 0)) * (0.92 + this.rng.next() * 0.16);
      this.projectiles.push({ x1: c.x, y1: c.y, x2: best.x, y2: best.y, life: 0.3, maxLife: 0.3, type: 'tower', color: '#e4d19a' });
      this._damageUnit(best, Math.max(1, dmg - this._unitArmor(best) * 0.4), { owner: b.owner, id: null, def: { ranged: true } }, true);
      this.emit('battleSfx', 'bow', c.x, c.y);
    }
  };

  // AI helper used for ordering a soldier to attack something without player checks.
  P._aiOrderAttack = function (u, kind, id) {
    if (!u || u.dead || !u.def.military) return false;
    let target = kind === 'building' ? this.getBuilding(id) : this.getUnit(id);
    if (!target || target.dead) return false;
    if (!this.atWar(u.owner, target.owner)) return false;
    if (target.isShip && !u.def.ranged) return false;
    this.cancelUnitActivity(u, true);
    u.order = { type: 'attack', targetKind: kind, targetId: id };
    u.target = { kind, id };
    let at;
    if (kind === 'building') at = this.approachTileForBuilding(target, u.x, u.y);
    else at = this._walkableNear(Math.floor(target.x), Math.floor(target.y), false, 5);
    if (!at) return false;
    if (this._setUnitPath(u, at.x, at.y, { allowPartial: true })) return true;
    u.state = 'attacking';
    return true;
  };

  P._clearWarTargets = function (aId, bId) {
    for (const u of this.units) {
      if (u.dead || !u.def.military) continue;
      if (u.target) {
        const target = u.target.kind === 'building' ? this.getBuilding(u.target.id) : this.getUnit(u.target.id);
        const tOwner = target ? target.owner : null;
        if ((u.owner === aId && tOwner === bId) || (u.owner === bId && tOwner === aId)) {
          u.target = null;
          u.order = null;
          u.state = 'idle';
        }
      }
    }
  };
})();
