/* WARWORLD — major interface pages: internal affairs, diplomacy, technology, military, codex, settings. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const P = WW.UI.prototype;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = U.esc;
  const fmt = U.fmt;
  const icon = (name) => `<svg aria-hidden="true"><use href="#ico-${name}"></use></svg>`;
  const resIcon = (res, size) => D.resIcon(res, size || 15);
  const stateLabels = {
    idle: '待命', moving: '行进中', gathering: '采集中', clearing: '清除中', constructing: '施工中',
    repairing: '维修中', attacking: '战斗中', inside: '建筑内工作', patient: '疗伤中', aboard: '船上'
  };

  P.drawModalCrests = function () {
    if (!this.game) return;
    $$('[data-crest-faction]', this.refs.modal).forEach((cv) => {
      const f = this.game.getFaction(cv.dataset.crestFaction);
      if (f) this.renderer.drawCrestToCanvas(cv, f);
    });
    $$('[data-modal-building-icon]', this.refs.modal).forEach((cv) => {
      const g = this.game;
      const b = g.getBuilding(cv.dataset.modalBuildingIcon);
      if (b) this.renderer.drawBuildingIcon(cv, b.defId, b.level, g.getFaction(b.owner));
      else {
        const [defId, lvl] = (cv.dataset.modalBuildingIcon || '').split(':');
        if (D.BUILD[defId]) this.renderer.drawBuildingIcon(cv, defId, parseInt(lvl) || 1, g.player);
      }
    });
    $$('[data-modal-unit-portrait]', this.refs.modal).forEach((cv) => {
      const u = this.game.getUnit(cv.dataset.modalUnitPortrait);
      if (u) this.renderer.drawUnitIcon(cv, u, this.game.getFaction(u.owner));
    });
  };

  P.openTutorial = function () {
    if (!this.game) return;
    const state = this.game.tutorialState();
    const body = `<div class="section">
      <div class="section-title">王室谕令</div>
      <p class="panel-subtitle">这些目标会引导你建立稳固的根基。它们不是强制任务，但完成全部谕令意味着你已经掌握了这个世界的法则。时间在翻阅书页时暂停。</p>
      <div class="summary-grid" style="margin-bottom:14px">
        <div class="summary-cell"><div class="sc-label">已完成</div><div class="sc-value">${state.completed}<small style="font-size:11px;color:rgba(87,69,43,.45)"> / ${state.total}</small></div><div class="sc-note">王室的认可</div></div>
        <div class="summary-cell"><div class="sc-label">当前阶段</div><div class="sc-value" style="font-size:16px">${D.STAGE_NAMES[this.game.player.rank] || '流亡'}</div><div class="sc-note">${D.RANK_NAMES[this.game.player.rank] || '无地'}</div></div>
        <div class="summary-cell"><div class="sc-label">人口</div><div class="sc-value">${this.game.livingPopulation(this.game.playerFactionId)}<small style="font-size:11px;color:rgba(87,69,43,.45)"> / ${this.game.factionPopCap(this.game.playerFactionId)}</small></div><div class="sc-note">臣民与士兵</div></div>
        <div class="summary-cell"><div class="sc-label">定居点</div><div class="sc-value">${this.game.ownedSettlements(this.game.playerFactionId).length}</div><div class="sc-note">你的领地</div></div>
      </div>
      ${state.list.map((o, i) => `<div class="list-item ${o.done ? 'active' : ''}" style="cursor:default;margin-bottom:4px">
        <div class="li-icon" style="color:${o.done ? '#557247' : 'rgba(86,67,40,.4)'}">${o.done ? icon('check') : U.cnNum(i + 1)}</div>
        <div class="li-main"><div class="li-name" style="${o.done ? 'color:#536a48;' : ''}">${esc(o.title)}</div><div class="li-sub">${esc(o.hint)}</div></div>
        <span class="li-badge">${o.done ? '完成' : '待办'}</span>
      </div>`).join('')}
      <div class="effect-line">初期提示：五名居民非常宝贵。你可以让居民直接采集浆果与木材，也可以建造资源建筑并派驻居民。所有资源都只属于当前定居点；顶部栏最大的名字就是当前定居点。</div>
    </div>`;
    this.openModal({ kind: 'tutorial', eyebrow: 'THE ROYAL COMMISSION · 王命', title: '王室谕令', subtitle: '在漫长的年代中建立属于你的王朝。', body, footer: `<div class="note">可以随时按 H 打开王国法典查阅完整规则。</div><button class="action-btn primary" data-close-modal>继续统治</button>`, narrow: true });
    this.setNavActive(null);
  };

  // =========================================================
  // Internal affairs
  // =========================================================
  P.openInternal = function (settlementId) {
    if (!this.game) return;
    const g = this.game;
    const player = g.player;
    const settlements = g.ownedSettlements(player.id);
    if (!settlements.length) {
      this.openModal({
        kind: 'internal', eyebrow: 'THE CROWN · 王冠', title: '内政', subtitle: '没有定居点的王冠只是一件装饰。',
        body: `<div class="empty-state">你目前没有定居点。<br>如果你的军队仍然存在，可以尝试攻占一座敌方大厅，重新建立统治。<br><br>若失去所有领土和军队，王朝将走向终点。</div>`,
        narrow: true
      });
      return;
    }
    const active = settlements.find((s) => s.id === (settlementId || this.activeSettlementId)) || settlements[0];
    this.activeSettlementId = active.id;
    const caps = g.getStorageCaps(active);
    const pop = g.livingPopulation(player.id);
    const popCap = g.factionPopCap(player.id);
    const localPop = g.getSettlementLocalPopulation(active);
    const buildings = g.settlementBuildings(active.id);
    const upkeep = g.getSettlementUpkeepInfo(active);
    const stability = active.stability;
    const target = g.stabilityTarget(active, player);
    const warCount = g.warsFor(player.id).length;
    const aidCost = 18 + active.stage * 7;
    const cooldown = Math.max(0, Math.ceil(active.aidCooldown - g.timeDays));
    const freePop = Math.max(0, popCap - pop);
    const colonyAffordable = g.canAfford(active, g.COLONY_COST);
    const colonyPopOk = freePop >= 3;
    const houseCount = g.houseCountIn(active.id);
    const houseLimit = g.houseLimitFor(active);
    const counts = {};
    for (const b of buildings) counts[b.defId] = (counts[b.defId] || 0) + 1;
    let listHtml = settlements.map((s) => {
      const st = s.stability;
      const cls = st < 25 ? 'red' : st < 50 ? 'gold' : 'green';
      return `<button class="list-item ${s.id === active.id ? 'active' : ''}" data-act="internal-select" data-id="${s.id}">
        <canvas class="settlement-row-crest" width="60" height="68" data-crest-faction="${s.owner}"></canvas>
        <div class="li-main"><div class="li-name">${esc(s.name)}</div><div class="li-sub">${D.STAGE_NAMES[s.stage]} · ${g.getSettlementLocalPopulation(s)} 名居民</div></div>
        <span class="tag ${cls}">${Math.floor(st)}</span>
      </button>`;
    }).join('');
    if (!listHtml) listHtml = `<div class="empty-note">没有定居点。</div>`;
    const resources = D.RES_KEYS.map((k) => {
      const v = active.resources[k] || 0;
      const cap = caps[k] || 1;
      const pct = U.clamp(v / cap, 0, 1);
      return `<div class="resource-cell ${pct > .9 ? 'near-full' : ''}"><div class="rc-top"><span class="rc-label">${resIcon(k, 12)}${D.RES[k].name}</span><span class="rc-value">${fmt(v)}<span style="opacity:.4;font-size:10px">/${fmt(cap)}</span></span></div><div class="rc-bar"><i style="width:${pct * 100}%"></i></div></div>`;
    }).join('');
    const upkeepItems = Object.keys(upkeep).length ? Object.entries(upkeep).map(([k, v]) => {
      const enough = (active.resources[k] || 0) >= v;
      return `<div class="upkeep-item">${resIcon(k, 12)}<span>${D.RES[k].name}</span><span class="up-val ${enough ? '' : 'bad'}">${enough ? '−' + v : '不足'} / 日</span></div>`;
    }).join('') : '<div class="empty-note">这个阶段没有固定资源消耗。</div>';
    const stabilityFactors = [
      ['基础稳定', '+55'],
      ...buildings.filter((b) => b.complete && (b.defId === 'church' || (b.defId === 'tavern' && b.active) || b.defId === 'market')).map((b) => [D.buildingName(b.def, b.level), '+' + (b.defId === 'church' ? b.def.stability[b.level] : b.defId === 'tavern' ? b.def.stability[b.level] : 2)]),
      ...(g._mod(player).stability ? [['行政科技', '+' + g._mod(player).stability]] : []),
      ...(warCount ? [['战争疲劳（' + warCount + ' 场）', '−' + Math.min(14, warCount * 5)]] : []),
      ...(active.shortage ? [['物资短缺', '−28']] : []),
      ...(active.occupiedUntil > g.timeDays ? [['被占领', '−22']] : [])
    ];
    const buildingIndex = buildings.filter((b) => b.defId !== 'road' && b.defId !== 'bridge' && b.defId !== 'tunnel').slice(0, 30).map((b) => `<button class="building-index-row" data-act="internal-open-building" data-id="${b.id}"><canvas class="mini-canvas" width="72" height="56" data-modal-building-icon="${b.id}"></canvas><span class="bi-name">${esc(D.buildingName(b.def, b.level))}</span><span class="bi-level">${b.complete ? 'Lv.' + U.roman(b.level) : Math.floor((b.buildProgress || 0) / Math.max(1, b.buildRequired || 1) * 100) + '%'}</span></button>`).join('');
    const activeWars = g.warsFor(player.id);
    const body = `<div class="internal-layout">
      <aside class="side-list settlement-list">
        <h4>你的定居点 · ${settlements.length}</h4>
        ${listHtml}
        <div class="gold-divider"></div>
        <button class="action-btn primary" style="width:100%" data-act="internal-build">${icon('build')}打开建造面板</button>
        <div style="height:5px"></div>
        <button class="action-btn" style="width:100%" data-act="internal-colonize">${icon('flag')}建立新的定居点</button>
        <div class="cooldown-note">需 ${Object.entries(g.COLONY_COST).map(([k, v]) => v + ' ' + D.RES[k].name).join('、')}，以及 3 个空余人口。当前空余人口 ${freePop}${!colonyAffordable ? ' · 资源不足' : !colonyPopOk ? ' · 人口容量不足' : ''}</div>
      </aside>
      <section>
        <div class="settlement-main-head">
          <div><h3>${esc(active.name)}</h3><div class="sub">${D.STAGE_NAMES[active.stage]} · 建于主历 ${U.timeToDate(active.founded || 0).year} 年 · ${localPop} 名居民居于此地</div></div>
          <div class="governance-actions"><span class="stage-badge">${D.STAGE_NAMES[active.stage]}</span><button class="mini-btn" data-act="internal-rename">改名</button><button class="mini-btn" data-act="internal-focus">定位</button></div>
        </div>
        <div class="stage-path">${[1, 2, 3, 4].map((lvl) => `<div class="stage-step ${active.stage === lvl ? 'current' : active.stage > lvl ? 'done' : ''}"><strong>${D.STAGE_NAMES[lvl]}</strong><small>${['', '村庄大厅', '镇长大厅', '市政厅', '王宫'][lvl]}</small></div>`).join('')}</div>
        <div class="summary-grid">
          <div class="summary-cell"><div class="sc-label">人口（全阵营）</div><div class="sc-value">${pop}<small style="font-size:11px;opacity:.45"> / ${popCap}</small></div><div class="sc-note">居民与士兵均占用人口</div></div>
          <div class="summary-cell"><div class="sc-label">本城建筑</div><div class="sc-value">${buildings.length}</div><div class="sc-note">${Object.keys(counts).length} 种建筑</div></div>
          <div class="summary-cell"><div class="sc-label">稳定度</div><div class="sc-value" style="color:${stability < D.INDEPENDENCE.threshold ? '#8d463b' : stability < 50 ? '#806835' : '#4e6540'}">${Math.floor(stability)}</div><div class="sc-note">目标 ${Math.round(target)}</div></div>
          <div class="summary-cell"><div class="sc-label">当前战争</div><div class="sc-value">${activeWars.length}</div><div class="sc-note">${warCount ? '战争使稳定度承压' : '和平年代'}</div></div>
        </div>
        <div class="overview-columns" style="margin-top:16px">
          <div>
            <div class="section-title">资源储量 <span class="muted" style="font-size:11px">仅限本城</span></div>
            <div class="resource-grid">${resources}</div>
            <div class="section-title" style="margin-top:18px">稳定度</div>
            <div class="stability-panel">
              <div class="stability-orb" style="--stability:${Math.floor(stability)}%"><span>${Math.floor(stability)}</span></div>
              <div class="stability-copy">
                <strong>${stability < 20 ? '风雨飘摇' : stability < 40 ? '暗流涌动' : stability < 65 ? '尚算安宁' : '民心归附'}</strong>
                <p>稳定度低于 ${D.INDEPENDENCE.threshold} 时每天都有独立风险；一旦降至 0，定居点会立即独立成为新的 AI 阵营。战争、物资短缺与长期占领都会削弱稳定。</p>
                <div class="stability-meter-large"><i style="width:${U.clamp(stability, 0, 100)}%"></i></div>
              </div>
            </div>
            <div class="action-row"><button class="action-btn primary" data-act="internal-aid" ${cooldown > 0 ? 'disabled' : ''}>发放救助金（${aidCost} 银币）</button></div>
            <div class="cooldown-note">${cooldown > 0 ? '下一次救助还需 ' + cooldown + ' 天' : '提升 16 点稳定度 · 每 20 天可进行一次'}</div>
            ${active.shortage ? `<div class="warning-note">本城缺少 ${esc((active.lastMissing || []).join('、'))}。稳定度正在下降。</div>` : ''}
          </div>
          <div>
            <div class="section-title">每日消耗</div>
            <div class="upkeep-list">${upkeepItems}</div>
            <div class="section-title" style="margin-top:18px">人口与劳力</div>
            <div class="population-line"><span>全阵营人口</span><div class="population-bar"><i style="width:${U.clamp(pop / Math.max(1, popCap), 0, 1) * 100}%"></i></div><span>${pop} / ${popCap}</span></div>
            <p class="nearby-note">民宅会提高人口上限，并随时间自动产生新居民。每名居民与士兵都占用 1 人口。本城民宅 ${houseCount}/${houseLimit}；升级定居点阶段可提高民宅上限。</p>
            <div class="worker-summary" style="margin-top:8px">
              <span><b>${g.units.filter((u) => !u.dead && u.owner === player.id && u.kind === 'resident' && u.state === 'idle').length}</b>空闲居民</span>
              <span><b>${g.units.filter((u) => !u.dead && u.owner === player.id && u.kind === 'builder').length}</b>建筑工</span>
              <span><b>${g.units.filter((u) => !u.dead && u.owner === player.id && u.def.military).length}</b>士兵</span>
              <span><b>${houseCount}/${houseLimit}</b>民宅</span>
            </div>
            <div class="section-title" style="margin-top:18px">稳定度构成</div>
            ${stabilityFactors.map(([k, v]) => `<div class="stat-line"><span class="k">${esc(k)}</span><span class="v ${String(v).startsWith('−') ? 'bad' : 'good'}">${esc(v)}</span></div>`).join('')}
          </div>
        </div>
        <div class="section-title" style="margin-top:18px">建筑一览</div>
        ${buildingIndex || '<div class="empty-state">还没有建筑。打开建造面板，从一座民宅或农田开始。</div>'}
        <div class="effect-line">提示：每座资源建筑都需要居民进入才能生产。建筑面板中的“补满工人”会自动召集本城空闲居民。</div>
      </section>
    </div>`;
    this.openModal({
      kind: 'internal', eyebrow: 'THE CROWN · 王冠', title: '内政', subtitle: '治理你的领地、臣民与王室财政。翻阅书卷时，时间暂停。',
      body, wide: true, headActions: `<button class="action-btn" data-act="help-open">${icon('help')}法典</button>`,
      onMount: (root) => this.drawModalCrests()
    });
    this.drawModalCrests();
    this.setNavActive('internal');
  };

  // =========================================================
  // Diplomacy
  // =========================================================
  P.openDiplomacy = function (factionId) {
    if (!this.game) return;
    const g = this.game;
    const player = g.player;
    const others = g.factions.filter((f) => f.id !== player.id);
    if (!others.length) {
      this.openModal({ kind: 'diplomacy', narrow: true, title: '外交', body: '<div class="empty-state">世上没有其他国家与你交谈。</div>' });
      return;
    }
    let selected = others.find((f) => f.id === (factionId || this.diploSelectedId)) || others.find((f) => !f.eliminated) || others[0];
    this.diploSelectedId = selected.id;
    const rel = g.getRelationText(selected.id);
    const atWar = g.atWar(player.id, selected.id);
    const allied = g.areAllied(player.id, selected.id);
    const overlord = g.overlordOf(selected.id);
    const playerOverlord = g.overlordOf(player.id);
    const isVassalOfPlayer = overlord === player.id;
    const isPlayerOverlord = playerOverlord === selected.id;
    const vassals = g.vassalsOf(selected.id);
    const allies = g.alliesOf(selected.id).map((id) => g.getFaction(id)).filter(Boolean);
    const truce = selected.truces && selected.truces[player.id] > g.timeDays ? Math.ceil(selected.truces[player.id] - g.timeDays) : 0;
    const markets = g.playerMarketSettlements();
    const hasBothMarkets = markets.length > 0 && g.hasMarket(selected.id);
    const cbs = g.casusBelliAgainst(player.id, selected.id);
    const war = g.getWar(player.id, selected.id);
    const activeDeals = g.activeTradeDealsFor(player.id);
    const relationDeals = g.tradeDeals.filter((d) =>
      (d.a === player.id && d.b === selected.id) || (d.b === player.id && d.a === selected.id)
    ).slice().sort((a, b) => (b.started || 0) - (a.started || 0)).slice(0, 8);
    const powerSelf = g._factionPower(player.id);
    const powerOther = g._factionPower(selected.id);
    const relationHTML = `<span class="relation-pill" style="color:${rel.color}">${rel.label}</span>`;
    let list = others.map((f) => {
      const r = g.getRelationText(f.id);
      const warNow = g.atWar(player.id, f.id);
      const ally = g.areAllied(player.id, f.id);
      const vassal = g.overlordOf(f.id) === player.id;
      let status = warNow ? '交战' : ally ? '同盟' : vassal ? '封臣' : f.eliminated ? '已灭亡' : r.label;
      return `<button class="list-item faction-list-item ${f.id === selected.id ? 'active' : ''}" data-act="diplo-select" data-id="${f.id}" ${f.eliminated ? 'disabled style="opacity:.45"' : ''}>
        <canvas class="faction-crest" width="64" height="74" data-crest-faction="${f.id}"></canvas>
        <div class="li-main"><div class="li-name">${esc(D.realmFullName(f))}</div><div class="li-sub">${status} · ${Math.floor(r.value)} 好感</div></div>
        <span class="li-badge" style="color:${warNow ? '#93463b' : ally ? '#4e6b46' : r.color}">${D.RANK_NAMES[f.rank] || '无地'}</span>
      </button>`;
    }).join('');
    const statusBadges = [
      atWar ? '<span class="tag red">交战中</span>' : '<span class="tag green">和平</span>',
      allied ? '<span class="tag gold">同盟</span>' : '',
      isVassalOfPlayer ? '<span class="tag gold">你的封臣</span>' : '',
      isPlayerOverlord ? '<span class="tag red">你的宗主</span>' : '',
      truce ? `<span class="tag">停战 ${truce} 天</span>` : '',
      selected.eliminated ? '<span class="tag red">已灭亡</span>' : ''
    ].join('');
    let actionButtons = '';
    if (!selected.eliminated) {
      actionButtons += `<button class="action-btn" data-act="diplo-gift">${icon('coin')}赠送银币</button>`;
      if (!atWar) {
        if (!allied && !isVassalOfPlayer && !isPlayerOverlord) actionButtons += `<button class="action-btn" data-act="diplo-alliance">${icon('diplomacy')}提议结盟</button>`;
        if (allied) actionButtons += `<button class="action-btn" data-act="diplo-break-alliance">解除同盟</button>`;
        if (player.rank > selected.rank && !isVassalOfPlayer && !overlord && !playerOverlord) actionButtons += `<button class="action-btn" data-act="diplo-demand-vassal">${icon('crown')}要求附庸</button>`;
        if (isPlayerOverlord && player.rank >= selected.rank) actionButtons += `<button class="action-btn" data-act="diplo-release">申请解除附庸</button>`;
        const canDeclareOnOverlord = !isPlayerOverlord || cbs.some((cb) => cb.reason === 'independence');
        if (canDeclareOnOverlord) actionButtons += `<button class="action-btn danger" data-act="diplo-war">${icon('military')}宣战</button>`;
      } else {
        actionButtons += `<button class="action-btn primary" data-act="diplo-peace">${icon('diplomacy')}提出和平</button>`;
      }
      if (hasBothMarkets && !atWar) actionButtons += `<button class="action-btn" data-act="diplo-trade">${icon('coin')}商队贸易</button>`;
    }
    const cbsHtml = cbs.length ? cbs.map((cb) => `<span class="tag red" title="宣战时可使用">${D.CAUSE_LABEL[cb.reason] || cb.reason} · 对${esc(D.realmFullName(selected))}</span>`).join('') : '<span class="muted" style="font-size:11.5px">没有针对对方的战争理由。无端宣战会损害你的声誉。</span>';
    const warsHtml = war ? `<div class="war-panel">
      <div class="war-head"><span class="war-title">${icon('military')} 与${esc(D.realmFullName(selected))}的战争</span><span class="tag red">${D.CAUSE_LABEL[war.reason] || war.reason}</span></div>
      <div class="war-meta">开始于 ${U.dateLabel(war.started, true)} · 已持续 ${Math.floor(g.timeDays - war.started)} 天 · 双方损失 ${war.losses[player.id] || 0} / ${war.losses[selected.id] || 0} 人</div>
      <div class="war-exhaust"><span>我方厌战</span><div class="meter"><i style="width:${U.clamp((war.exhaustion[player.id] || 0) / 140, 0, 1) * 100}%"></i></div><span>${Math.floor(war.exhaustion[player.id] || 0)}</span></div>
      <div class="war-exhaust"><span>敌方厌战</span><div class="meter"><i style="width:${U.clamp((war.exhaustion[selected.id] || 0) / 140, 0, 1) * 100}%"></i></div><span>${Math.floor(war.exhaustion[selected.id] || 0)}</span></div>
      <div class="action-row"><button class="action-btn" data-act="diplo-peace">${icon('diplomacy')}提出停战</button>${g.alliesOf(player.id).length ? `<button class="action-btn" data-act="diplo-invite-ally">邀请盟友参战</button>` : ''}${g.vassalsOf(player.id).length ? `<button class="action-btn" data-act="diplo-call-vassal">征召封臣</button>` : ''}</div>
    </div>` : '';
    const dealStatusHtml = (d) => {
      const otherIsA = d.a === player.id;
      const outgoing = otherIsA ? d.goodsA : d.goodsB;
      const incoming = otherIsA ? d.goodsB : d.goodsA;
      const remaining = Math.max(0, Math.ceil(d.deadline - g.timeDays));
      const status = d.failed ? '已失效' : d.completedAt ? '已完成' : `运输中 · 剩余 ${remaining} 天`;
      const delivered = d.delivered || {};
      const dd = U.timeToDate(d.deadline);
      return `<div class="trade-row"><div class="tr-main">${fmt(outgoing.amount)} ${D.RES[outgoing.res].name} ⇄ ${fmt(incoming.amount)} ${D.RES[incoming.res].name}<div class="tr-state">${status} · 截止第${dd.year}年${dd.season}季第${dd.day}日<br>我方${delivered[otherIsA ? 'a' : 'b'] ? '已送达' : '运输中'} · 对方${delivered[otherIsA ? 'b' : 'a'] ? '已送达' : '运输中'} · 期限 ${d.durationDays || Math.max(1, Math.round(d.deadline - d.started))} 天</div></div></div>`;
    };
    const dealsHtml = relationDeals.length
      ? `<div class="trade-list">${relationDeals.map((d) => dealStatusHtml(d)).join('')}</div>`
      : '<div class="empty-note">还没有与该阵营签订贸易协定。</div>';
    const tradeSummaryHtml = activeDeals.length ? `<div class="trade-list">${activeDeals.slice(0, 5).map((d) => {
      const otherId = d.a === player.id ? d.b : d.a;
      const outgoing = d.a === player.id ? d.goodsA : d.goodsB;
      const incoming = d.a === player.id ? d.goodsB : d.goodsA;
      const remaining = Math.max(0, Math.ceil(d.deadline - g.timeDays));
      return `<div class="trade-row"><div class="tr-main">${esc(g.factionLabel(otherId))}<br>${fmt(outgoing.amount)} ${D.RES[outgoing.res].name} ⇄ ${fmt(incoming.amount)} ${D.RES[incoming.res].name}<div class="tr-state">剩余 ${remaining} 天</div></div></div>`;
    }).join('')}</div>${activeDeals.length > 5 ? `<div class="empty-note">另有 ${activeDeals.length - 5} 项贸易协定，可在对应阵营页面查看。</div>` : ''}` : '';
    const statusInfo = [];
    if (selected.rank > 0) statusInfo.push(`<div class="stat-line"><span class="k">阵营等级</span><span class="v">${D.RANK_NAMES[selected.rank]}</span></div>`);
    if (overlord) { const o = g.getFaction(overlord); statusInfo.push(`<div class="stat-line"><span class="k">宗主</span><span class="v">${o ? esc(D.realmFullName(o)) : '—'}</span></div>`); }
    if (vassals.length) statusInfo.push(`<div class="stat-line"><span class="k">封臣</span><span class="v">${vassals.map((id) => { const f = g.getFaction(id); return f ? esc(f.name) : ''; }).filter(Boolean).join('、') || '—'}</span></div>`);
    if (allies.length) statusInfo.push(`<div class="stat-line"><span class="k">盟友</span><span class="v">${allies.map((f) => esc(f.name)).join('、') || '—'}</span></div>`);
    if (truce) statusInfo.push(`<div class="stat-line"><span class="k">停战协定</span><span class="v">${truce} 天</span></div>`);
    const body = `<div class="diplomacy-layout">
      <aside class="side-list">
        <h4>列强 · ${others.filter((f) => !f.eliminated).length} 尚存</h4>
        ${list}
        <div class="gold-divider"></div>
        <div class="mini-title">你的外交地位</div>
        <div class="stat-line"><span class="k">阵营头衔</span><span class="v">${D.realmFullName(player)}</span></div>
        <div class="stat-line"><span class="k">盟友</span><span class="v">${g.alliesOf(player.id).length}</span></div>
        <div class="stat-line"><span class="k">封臣</span><span class="v">${g.vassalsOf(player.id).length}</span></div>
        <div class="stat-line"><span class="k">宗主</span><span class="v">${g.overlordOf(player.id) ? esc(g.factionLabel(g.overlordOf(player.id))) : '无'}</span></div>
        <div class="stat-line"><span class="k">战争</span><span class="v">${g.warsFor(player.id).length}</span></div>
        <div class="stat-line"><span class="k">贸易协定</span><span class="v">${activeDeals.length} 项进行中</span></div>
        ${activeDeals.length ? `<div class="mini-title" style="margin-top:8px">进行中的商队</div>${tradeSummaryHtml}` : ''}
      </aside>
      <section>
        <div class="diplo-detail-head">
          <div class="diplo-crest-large"><canvas width="168" height="192" data-crest-faction="${selected.id}"></canvas></div>
          <div class="diplo-title" style="flex:1">
            <h3>${esc(D.realmFullName(selected))}</h3>
            <div class="diplo-sub">${selected.eliminated ? '这个国家已经不复存在。' : `由${D.RANK_NAMES[selected.rank] || '无地者'}统治 · 定居点 ${g.ownedSettlements(selected.id).length} · 军力评估 ${Math.round(powerOther)}`}</div>
            <div class="diplo-badges">${statusBadges}</div>
          </div>
          <div class="relation-value" style="color:${rel.color}">${Math.round(rel.value)}<div style="font-size:10.5px;color:rgba(86,69,43,.5);letter-spacing:.05em">好感</div></div>
        </div>
        <div class="relation-block">
          <div style="flex:1"><div class="rel-label"><span>关系</span><span>${rel.label}</span></div><div class="relation-track"><i style="width:${rel.value}%;background:${rel.color}"></i></div></div>
          <div style="font-size:10.5px;color:rgba(84,67,41,.5);width:120px;line-height:1.55">好感越高，越容易接受同盟、附庸与有利的贸易条件。</div>
        </div>
        ${selected.eliminated ? '<div class="warning-note">这个阵营已经灭亡，无法再进行外交。</div>' : `<div class="diplo-actions">${actionButtons}</div>`}
        <div class="split-section" style="margin-top:18px">
          <div>
            <div class="section-title">战争理由</div>
            <div class="chip-list">${cbsHtml}</div>
            <div class="section-title" style="margin-top:16px">权力对比</div>
            <div class="stat-line"><span class="k">你的实力</span><span class="v">${Math.round(powerSelf)}</span></div>
            <div class="stat-line"><span class="k">对方实力</span><span class="v">${Math.round(powerOther)}</span></div>
            <div class="stat-line"><span class="k">评估</span><span class="v ${powerSelf > powerOther ? 'good' : 'bad'}">${powerSelf > powerOther * 1.3 ? '你占据明显优势' : powerOther > powerSelf * 1.3 ? '对方更为强大' : '势均力敌'}</span></div>
            <div class="section-title" style="margin-top:16px">外交状态</div>
            ${statusInfo.join('') || '<div class="empty-note">尚无正式条约。</div>'}
          </div>
          <div>
            <div class="section-title">贸易协定 <span class="muted" style="font-size:9.5px;letter-spacing:.05em">已签订</span></div>
            ${dealsHtml}
            ${hasBothMarkets ? `<div class="trade-panel" style="margin-top:8px"><div class="trade-head"><strong>商队贸易</strong><span class="tag ${atWar ? 'red' : 'green'}">${atWar ? '交战禁运' : '商路畅通'}</span></div><div class="trade-detail">双方都拥有集市，可派遣商人交换资源。拟定协定时可设置 ${D.TRADE_TERM.min}–${D.TRADE_TERM.max} 天的交付期限，商队必须在期限内送达。</div><div class="action-row"><button class="action-btn primary" data-act="diplo-trade" ${atWar ? 'disabled' : ''}>拟定贸易协定</button></div></div>` : `<div class="empty-note" style="margin-top:8px">双方都建造集市后，才能进行贸易。</div>`}
            <div class="section-title" style="margin-top:16px">战争与停战</div>
            ${warsHtml || '<div class="empty-note">双方目前没有战争。</div>'}
          </div>
        </div>
        <div class="ability-note">${atWar ? '战争期间无法结盟、附庸或通商。提出和平后，若对方接受，双方将获得 70 天停战期。' : '你可以赠送银币提高关系。结盟需要足够好感；附庸需要更高阵营等级；一旦拒绝附庸要求，对方会获得战争理由。'}</div>
      </section>
    </div>`;
    this.openModal({
      kind: 'diplomacy', eyebrow: 'THE CHANCELLERY · 议政厅', title: '外交', subtitle: '用婚约、银币与刀剑决定列强的命运。翻阅书卷时，时间暂停。',
      body, wide: true, headActions: `<button class="action-btn" data-act="help-open">${icon('help')}外交法典</button>`,
      onMount: () => this.drawModalCrests()
    });
    this.drawModalCrests();
    this.setNavActive('diplomacy');
  };

  P.openGiftDialog = function (fid) {
    const g = this.game;
    const target = g.getFaction(fid);
    const sources = g.ownedSettlements(g.playerFactionId).sort((a, b) => (b.resources.coin || 0) - (a.resources.coin || 0));
    if (!sources.length) { this.showSubToast('你没有可以支付银币的定居点。'); return; }
    const source = sources[0];
    const max = Math.max(0, Math.floor(source.resources.coin || 0));
    const body = `<h3>赠礼 · ${esc(D.realmFullName(target))}</h3>
      <p class="sub-copy">银币是通用的敬意。赠送银币会提高双方好感，但不会直接换来同盟或和平。</p>
      <div class="subdialog-info">支付地点：${esc(source.name)} · 可用银币 ${fmt(max)}</div>
      <div class="form-field"><label>赠礼金额</label><input id="gift-amount" type="number" min="1" max="${max}" value="${Math.min(25, max)}"></div>
      <div class="subdialog-error" id="gift-error"></div>
      <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn primary" data-sub-confirm>送出银币</button></div>`;
    this.showSubdialog(body);
    this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
    this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
      const amount = parseInt($('#gift-amount').value, 10);
      if (!(amount > 0)) { $('#gift-error').textContent = '请输入大于 0 的金额。'; return; }
      const r = g.giftToFaction(fid, amount);
      if (!r.ok) { $('#gift-error').textContent = r.error; return; }
      this.closeSubdialog();
      this.showSubToast(`赠礼已送出。好感提升。`);
      this.openDiplomacy(fid);
    });
  };

  P.openTradeDialog = function (fid) {
    const g = this.game;
    const target = g.getFaction(fid);
    const markets = g.playerMarketSettlements();
    if (!markets.length) { this.showSubToast('你需要先建造一座集市。'); return; }
    if (!g.hasMarket(fid)) { this.showSubToast('对方没有集市，无法通商。'); return; }
    const targetMarkets = g.buildings.filter((b) => b.owner === fid && b.complete && !b.dead && b.defId === 'market');
    const amounts = [10, 20, 30, 50, 80];
    const options = (list) => list.map((x) => `<option value="${x.id}">${esc(x.name)} · ${D.STAGE_NAMES[x.stage]}</option>`).join('');
    const body = `<h3>商队贸易 · ${esc(D.realmFullName(target))}</h3>
      <p class="sub-copy">选择双方交换的资源、数量与交付期限。双方都会派出一支商队，在约定期限内把货物送达对方集市。好感、集市等级、资源价值与期限长短都会影响对方是否接受。</p>
      <div class="form-grid">
        <div class="form-field"><label>我方出发集市</label><select id="trade-source">${options(markets)}</select></div>
        <div class="form-field"><label>协议期限（天）</label><input id="trade-days" type="number" min="${D.TRADE_TERM.min}" max="${D.TRADE_TERM.max}" step="5" value="${D.TRADE_TERM.default}"></div>
        <div class="form-field"><label>我方提供</label><select id="trade-offer-res">${D.RES_KEYS.map((k) => `<option value="${k}">${D.RES[k].name}</option>`).join('')}</select></div>
        <div class="form-field"><label>提供数量</label><input id="trade-offer-amt" type="number" min="1" value="20"></div>
        <div class="form-field"><label>我方希望获得</label><select id="trade-request-res">${D.RES_KEYS.map((k) => `<option value="${k}" ${k === 'wood' ? 'selected' : ''}>${D.RES[k].name}</option>`).join('')}</select></div>
        <div class="form-field"><label>所需数量</label><input id="trade-request-amt" type="number" min="1" value="20"></div>
      </div>
      <div class="subdialog-info" id="trade-info"></div>
      <div class="subdialog-error" id="trade-error"></div>
      <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn primary" data-sub-confirm>派遣商队提议</button></div>`;
    this.showSubdialog(body);
    const sourceSel = $('#trade-source');
    const offerRes = $('#trade-offer-res');
    const offerAmt = $('#trade-offer-amt');
    const requestRes = $('#trade-request-res');
    const requestAmt = $('#trade-request-amt');
    const updateInfo = () => {
      const s = g.getSettlement(sourceSel.value);
      const market = g.marketIn(s.id);
      const cap = market ? g.merchantCapacity(g.playerFactionId, market) : 0;
      const coins = s ? s.resources : {};
      $('#trade-info').innerHTML = `当前集市商人载货上限 <b>${cap}</b>。出发地库存：${D.RES[offerRes.value].name} <b>${fmt(coins[offerRes.value] || 0)}</b>。对方拥有 ${targetMarkets.length} 座集市。商队需要陆地通路。期限可设为 ${D.TRADE_TERM.min}–${D.TRADE_TERM.max} 天；期限越短，对方越不愿意接受。`;
      offerAmt.max = cap;
      requestAmt.max = 120;
    };
    sourceSel.addEventListener('change', updateInfo);
    offerRes.addEventListener('change', updateInfo);
    requestRes.addEventListener('change', updateInfo);
    updateInfo();
    this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
    this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
      const source = sourceSel.value;
      const offer = { res: offerRes.value, amount: parseInt(offerAmt.value, 10) || 0 };
      const request = { res: requestRes.value, amount: parseInt(requestAmt.value, 10) || 0 };
      const daysInput = $('#trade-days');
      const durationDays = Math.round(parseInt(daysInput && daysInput.value, 10) || D.TRADE_TERM.default);
      const market = g.marketIn(source);
      const cap = market ? g.merchantCapacity(g.playerFactionId, market) : 0;
      if (!offer.amount || !request.amount) { $('#trade-error').textContent = '数量必须大于 0。'; return; }
      if (offer.amount > cap) { $('#trade-error').textContent = `商队载货上限为 ${cap}。`; return; }
      if (!(durationDays >= D.TRADE_TERM.min && durationDays <= D.TRADE_TERM.max)) {
        $('#trade-error').textContent = `协议期限必须在 ${D.TRADE_TERM.min}–${D.TRADE_TERM.max} 天之间。`;
        return;
      }
      const r = g.proposeTradeToAI(fid, offer, request, source, durationDays);
      if (!r.ok) { $('#trade-error').textContent = r.error; return; }
      this.closeSubdialog();
      if (r.accepted) this.showSubToast(`对方接受了贸易协定。商队已经出发，须在 ${durationDays} 天内送达。`);
      else this.showSubToast('对方拒绝了贸易条件。');
      this.openDiplomacy(fid);
    });
  };

  P.openWarDeclarationDialog = function (fid) {
    const g = this.game;
    const target = g.getFaction(fid);
    const cbs = g.casusBelliAgainst(g.playerFactionId, fid);
    const options = cbs.map((cb) => `<label class="radio-option"><input type="radio" name="war-cause" value="${cb.id}" checked><span>${D.CAUSE_LABEL[cb.reason] || cb.reason}<small>使用此战争理由可减少其他列强的反感。</small></span></label>`).join('') +
      `<label class="radio-option"><input type="radio" name="war-cause" value="" ${cbs.length ? '' : 'checked'}><span>无端战争<small>没有正当理由，会大幅降低其他阵营对你的好感。</small></span></label>`;
    const body = `<h3>向${esc(D.realmFullName(target))}宣战</h3>
      <p class="sub-copy">战争将使双方单位互为敌人，并持续到双方同意和平为止。盟约会带来参战选择，封臣可能被征召。请确保你的补给线、城防和军队已经准备就绪。</p>
      <div class="radio-list">${options}</div>
      <div class="subdialog-info">你的军力：${Math.round(g._factionPower(g.playerFactionId))} · 对方军力：${Math.round(g._factionPower(fid))}。${g.getRelationText(fid).label}关系会影响第三方观感，但不会阻止宣战。</div>
      <div class="subdialog-error" id="war-error"></div>
      <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn danger" data-sub-confirm>发出战争号令</button></div>`;
    this.showSubdialog(body);
    this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
    this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
      const selected = this.refs.subBackdrop.querySelector('input[name="war-cause"]:checked');
      const cbId = selected ? selected.value : '';
      const r = g.declareWar(g.playerFactionId, fid, cbId || null);
      if (!r.ok) { $('#war-error').textContent = r.error; return; }
      this.closeSubdialog();
      this.showSubToast(`战争开始了。向${D.realmFullName(target)}进军！`);
      this.openDiplomacy(fid);
    });
  };

  P.openPeaceDialog = function (fid) {
    const g = this.game;
    const target = g.getFaction(fid);
    const wars = g.wars.filter((w) => !w.ended && ((w.a === g.playerFactionId && w.b === fid) || (w.b === g.playerFactionId && w.a === fid)));
    if (!wars.length) { this.showSubToast('双方没有正在进行的战争。'); return; }
    if (wars.length === 1) { this.proposePeaceForWar(wars[0].id, fid); return; }
    const body = `<h3>提出停战 · ${esc(D.realmFullName(target))}</h3>
      <p class="sub-copy">选择要与对方结束的战争。停战需要双方同意；对方会更愿意接受对其不利的战争。</p>
      <div class="radio-list">${wars.map((w, i) => `<label class="radio-option"><input type="radio" name="peace-war" value="${w.id}" ${i === 0 ? 'checked' : ''}><span>${D.CAUSE_LABEL[w.reason] || w.reason}<small>已持续 ${Math.floor(g.timeDays - w.started)} 天 · 对方厌战 ${Math.floor(w.exhaustion[fid] || 0)}</small></span></label>`).join('')}</div>
      <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn primary" data-sub-confirm>派出使节</button></div>`;
    this.showSubdialog(body);
    this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
    this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
      const sel = this.refs.subBackdrop.querySelector('input[name="peace-war"]:checked');
      const warId = sel ? sel.value : wars[0].id;
      this.closeSubdialog();
      this.proposePeaceForWar(warId, fid);
    });
  };

  P.proposePeaceForWar = function (warId, fid) {
    const r = this.game.proposePeace(warId, this.game.playerFactionId);
    if (!r.ok) this.showSubToast(r.error || '无法提出和平。');
    else if (r.accepted) this.showSubToast('对方接受了和平提议。停战协定已签署。');
    else if (!r.pending) this.showSubToast('对方拒绝停战。战争继续。');
    this.openDiplomacy(fid);
  };

  P.openInviteAllyDialog = function () {
    const g = this.game;
    const allies = g.alliesOf(g.playerFactionId).map((id) => g.getFaction(id)).filter((f) => f && !f.eliminated);
    const wars = g.warsFor(g.playerFactionId);
    if (!allies.length) { this.showSubToast('你没有盟友。'); return; }
    if (!wars.length) { this.showSubToast('当前没有正在进行的战争。'); return; }
    const body = `<h3>邀请盟友参战</h3><p class="sub-copy">盟友是否参战取决于好感、实力与他们对敌国的态度。拒绝不会自动解除同盟，但可能损害关系。</p>
      <div class="form-grid"><div class="form-field"><label>盟友</label><select id="invite-ally">${allies.map((f) => `<option value="${f.id}">${esc(D.realmFullName(f))}</option>`).join('')}</select></div>
      <div class="form-field"><label>战争</label><select id="invite-war">${wars.map((w) => { const e = g.getFaction(w.a === g.playerFactionId ? w.b : w.a); return `<option value="${w.id}">对抗 ${e ? esc(D.realmFullName(e)) : '未知'} · ${D.CAUSE_LABEL[w.reason] || w.reason}</option>`; }).join('')}</select></div></div>
      <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn primary" data-sub-confirm>发出邀请</button></div>`;
    this.showSubdialog(body);
    this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
    this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
      const allyId = $('#invite-ally').value;
      const warId = $('#invite-war').value;
      const r = g.inviteAllyToWar(warId, allyId);
      this.closeSubdialog();
      if (!r.ok) this.showSubToast(r.error);
      else if (r.accepted) this.showSubToast('盟友接受了邀请，加入了战争。');
      else this.showSubToast('盟友拒绝参战。');
      this.openMilitary();
    });
  };

  P.openCallVassalDialog = function () {
    const g = this.game;
    const vassals = g.vassalsOf(g.playerFactionId).map((id) => g.getFaction(id)).filter((f) => f && !f.eliminated);
    const wars = g.warsFor(g.playerFactionId);
    if (!vassals.length) { this.showSubToast('你没有封臣。'); return; }
    if (!wars.length) { this.showSubToast('当前没有正在进行的战争。'); return; }
    const body = `<h3>征召封臣</h3><p class="sub-copy">宗主可以要求封臣加入战争。若封臣拒绝，你将获得征服他们的战争理由。</p>
      <div class="form-grid"><div class="form-field"><label>封臣</label><select id="call-vassal">${vassals.map((f) => `<option value="${f.id}">${esc(D.realmFullName(f))}</option>`).join('')}</select></div>
      <div class="form-field"><label>战争</label><select id="call-war">${wars.map((w) => { const e = g.getFaction(w.a === g.playerFactionId ? w.b : w.a); return `<option value="${w.id}">对抗 ${e ? esc(D.realmFullName(e)) : '未知'}</option>`; }).join('')}</select></div></div>
      <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn primary" data-sub-confirm>发出征召</button></div>`;
    this.showSubdialog(body);
    this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
    this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
      const vassalId = $('#call-vassal').value;
      const warId = $('#call-war').value;
      const r = g.callVassalForPlayer(warId, vassalId);
      this.closeSubdialog();
      if (!r.ok) this.showSubToast(r.error);
      else this.showSubToast('征召已发出。等待封臣的回应。');
      this.openMilitary();
    });
  };

  // =========================================================
  // Technology
  // =========================================================
  P.openTech = function (techId) {
    if (!this.game) return;
    const g = this.game;
    const f = g.player;
    const availableTiers = new Set(g.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.def.researchTier).map((b) => b.def.researchTier));
    let selected = D.TECHS[techId || this.techSelectedId];
    if (!selected) selected = f.activeResearch ? D.TECHS[f.activeResearch.techId] : null;
    if (!selected) selected = Object.values(D.TECHS).find((t) => !f.techs.includes(t.id) && t.tier === 1) || D.TECHS.logging1;
    this.techSelectedId = selected.id;
    const active = f.activeResearch;
    const activeTech = active ? D.TECHS[active.techId] : null;
    const researchRate = g.getResearchRate(f);
    const statusBar = active && activeTech ? `<div class="tech-status-bar">
      <div class="tech-status-icon">${icon('tech')}</div>
      <div class="tech-status-main"><div class="ts-title">正在研究：${esc(activeTech.name)} <span class="muted">· ${activeTech.branchName} ${U.roman(activeTech.tier)}</span></div>
        <div class="ts-sub">${researchRate.rate ? `每日 +${U.round(researchRate.rate, 2)} 研究点 · ${researchRate.contributors.map((c) => D.buildingName(c.building.def, c.building.level) + '(' + c.workers + '人)').join('、')}` : '没有学者在工作，研究暂停。请向对应的研究建筑派驻居民。'}</div>
        <div class="research-track"><i style="width:${U.clamp(active.progress / activeTech.points, 0, 1) * 100}%"></i></div>
      </div>
      <div class="tech-status-actions"><button class="action-btn" data-act="tech-cancel">中止研究</button></div>
    </div>` : `<div class="tech-status-bar"><div class="tech-status-icon">${icon('tech')}</div><div class="tech-status-main"><div class="ts-title">尚未开始研究</div><div class="ts-sub">图书馆解锁一级科技；大学解锁二级；皇家大学解锁三级。研究需要消耗资源，并派居民进入研究建筑。</div></div></div>`;
    const rowFor = (branch) => {
      const nodes = [1, 2, 3].map((tier) => {
        const tech = D.TECHS[branch.id + tier];
        const done = f.techs.includes(tech.id);
        const isActive = active && active.techId === tech.id;
        const prereq = tech.requires && !f.techs.includes(tech.requires);
        const facility = availableTiers.has(tech.tier);
        const locked = !done && (prereq || !facility);
        return `<button class="tech-node ${done ? 'done' : ''} ${locked ? 'locked' : ''} ${isActive ? 'active-research' : ''} ${selected.id === tech.id ? 'selected' : ''}" data-act="tech-select" data-tech="${tech.id}">
          <div class="tn-tier"><span>${U.roman(tech.tier)}级科技</span><span>${done ? '完成' : tech.points + ' 点'}</span></div>
          <div class="tn-name">${esc(tech.name)}</div>
          <div class="tn-effect">${esc(tech.effectText)}</div>
          <div class="tn-state">${done ? '已研究完成' : isActive ? '研究中' : !facility ? `需要${['', '图书馆', '大学', '皇家大学'][tech.tier]}` : prereq ? `需先研究${D.TECHS[tech.requires].name}` : '可研究'}</div>
          ${done ? `<span class="node-check">${icon('check')}</span>` : ''}
        </button>`;
      }).join('');
      return `<div class="tech-branch-label">${branch.name}<small>${branch.effectName}</small></div>${nodes}`;
    };
    const tree = `<div class="tech-tree"><div class="tech-columns">
      <div class="tech-col-head"></div>
      <div class="tech-col-head"><strong>图书馆</strong>一级科技</div>
      <div class="tech-col-head"><strong>大学</strong>二级科技</div>
      <div class="tech-col-head"><strong>皇家大学</strong>三级科技</div>
      ${D.TECH_BRANCHES.map(rowFor).join('')}
    </div></div>`;
    const done = f.techs.includes(selected.id);
    const isActive = active && active.techId === selected.id;
    const prereqOk = !selected.requires || f.techs.includes(selected.requires);
    const facility = availableTiers.has(selected.tier);
    let can = !done && !active && prereqOk && facility;
    let reason = '';
    if (done) reason = '这项科技已经完成。';
    else if (active) reason = `正在研究「${activeTech.name}」，同一时间只能进行一项研究。`;
    else if (!facility) reason = `需要一座完工的${['', '图书馆', '大学', '皇家大学'][selected.tier]}。`;
    else if (!prereqOk) reason = `需先完成「${D.TECHS[selected.requires].name}」。`;
    else {
      const chk = g.canStartResearchNow(selected.id);
      if (!chk.ok) { can = false; reason = chk.error; }
    }
    const buildingNames = { 1: '图书馆', 2: '大学', 3: '皇家大学' };
    const detail = `<div class="tech-detail">
      <h3>${esc(selected.name)}</h3><div class="td-tier">${selected.branchName} · ${U.roman(selected.tier)}级科技 · ${selected.points} 研究点</div>
      <p class="td-desc">${esc(selected.desc)}</p>
      <div class="td-effect">${esc(selected.effectText)}</div>
      <div class="td-req">
        研究建筑：<span class="${facility ? '' : 'missing'}">${buildingNames[selected.tier]}${facility ? '（已拥有）' : '（未建造）'}</span><br>
        ${selected.requires ? `前置科技：<span class="${prereqOk ? '' : 'missing'}">${esc(D.TECHS[selected.requires].name)}${prereqOk ? '（已完成）' : '（未完成）'}</span><br>` : ''}
        研究费用：${Object.entries(selected.cost).map(([k, v]) => `${D.RES[k].name} ${v}`).join(' · ')}
      </div>
      ${done ? `<div class="effect-line" style="color:#506b42">已研究完成。其加成立即生效。</div>` : isActive ? `<div class="effect-line">研究进度 ${Math.floor(active.progress / selected.points * 100)}% · 每日进度 +${U.round(researchRate.rate, 2)}</div><div class="action-row"><button class="action-btn" data-act="tech-cancel">中止研究</button></div>` : `<div class="action-row"><button class="action-btn primary" data-act="tech-start" data-tech="${selected.id}" ${can ? '' : 'disabled'}>开始研究</button></div><div class="cooldown-note">${esc(reason)}</div>`}
      <div class="tech-tiers-note">一级科技由图书馆研究；二级需要大学且前置一级；三级需要皇家大学且前置二级。研究建筑最多升到当前定居点阶段，进入的居民越多，研究越快。</div>
    </div>`;
    const body = `${statusBar}<div class="tech-tree-wrap">${tree}${detail}</div>`;
    this.openModal({
      kind: 'tech', eyebrow: 'THE SCRIPTORIUM · 缮写室', title: '科技', subtitle: '知识是王国最慢、也最持久的军队。翻阅书卷时，时间暂停。',
      body, wide: true, headActions: `<button class="action-btn" data-act="help-open">${icon('help')}科技法典</button>`
    });
    this.setNavActive('tech');
  };

  // =========================================================
  // Military overview
  // =========================================================
  P.openMilitary = function () {
    if (!this.game) return;
    const g = this.game;
    const f = g.player;
    const soldiers = g.units.filter((u) => !u.dead && u.owner === (f ? f.id : '') && u.def.military);
    const groups = {};
    for (const u of soldiers) (groups[u.kind] = groups[u.kind] || []).push(u);
    const wars = g.warsFor(f.id);
    const allies = g.alliesOf(f.id).map((id) => g.getFaction(id)).filter(Boolean);
    const vassals = g.vassalsOf(f.id).map((id) => g.getFaction(id)).filter(Boolean);
    const militaryBuildings = g.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && (b.def.training || b.defId === 'tower'));
    const queues = g.buildings.filter((b) => b.owner === f.id && b.complete && !b.dead && b.trainingQueue && b.trainingQueue.length);
    const trainingTotal = queues.reduce((n, b) => n + b.trainingQueue.length, 0);
    const armyGroups = Object.entries(groups).map(([kind, list]) => `<div class="army-group">
      <div class="army-group-head"><strong>${esc(D.UNITS[kind].name)} · ${list.length}</strong><button class="mini-btn" data-act="mil-select-kind" data-kind="${kind}">选择全部</button></div>
      ${list.slice(0, 10).map((u) => `<div class="army-unit-row"><span>${esc(D.UNITS[kind].name)}</span><span class="unit-state">${stateLabels[u.state] || u.state}</span><div class="unit-hp-mini"><i style="width:${U.clamp(u.hp / u.maxHp, 0, 1) * 100}%"></i></div><span>${Math.ceil(u.hp)}/${u.maxHp}</span><button class="mini-btn" data-act="mil-focus-unit" data-unit="${u.id}">定位</button></div>`).join('')}
      ${list.length > 10 ? `<div class="empty-note">另有 ${list.length - 10} 名同类士兵未列出。</div>` : ''}
    </div>`).join('') || `<div class="empty-state">你还没有军队。先建造兵营并训练士兵。兵营在村庄阶段即可建造。</div>`;
    const warsHtml = wars.map((w) => {
      const otherId = w.a === f.id ? w.b : w.a;
      const other = g.getFaction(otherId);
      return `<div class="war-panel">
        <div class="war-head"><span class="war-title">对抗 ${other ? esc(D.realmFullName(other)) : '未知'}</span><span class="tag red">${D.CAUSE_LABEL[w.reason] || w.reason}</span></div>
        <div class="war-meta">已持续 ${Math.floor(g.timeDays - w.started)} 天 · 我方厌战 ${Math.floor(w.exhaustion[f.id] || 0)} · 敌方厌战 ${Math.floor(w.exhaustion[otherId] || 0)}</div>
        <div class="action-row"><button class="action-btn primary" data-act="mil-peace" data-war="${w.id}" data-fid="${otherId}">提出停战</button><button class="action-btn" data-act="mil-invite-ally" ${allies.length ? '' : 'disabled'}>邀请盟友</button><button class="action-btn" data-act="mil-call-vassal" ${vassals.length ? '' : 'disabled'}>征召封臣</button></div>
      </div>`;
    }).join('') || '<div class="empty-note">当前没有战争。</div>';
    const queueHtml = queues.map((b) => `<div class="training-overview"><div class="to-head"><span>${D.buildingName(b.def, b.level)}</span><span>${b.trainingQueue.map((q) => D.UNITS[q.kind].name).join('、')}</span></div>${b.trainingQueue.map((q) => `<div class="meter" style="margin-top:4px"><i style="width:${U.clamp((q.progress || 0) / Math.max(.1, q.days), 0, 1) * 100}%"></i></div>`).join('')}<div class="to-sub">训练会自动进行，无需工人</div></div>`).join('') || '<div class="empty-note">没有正在训练的部队。</div>';
    const body = `<div class="military-summary">
      <div class="summary-cell"><div class="sc-label">军队人数</div><div class="sc-value">${soldiers.length}</div><div class="sc-note">占用人口 ${soldiers.length} 人</div></div>
      <div class="summary-cell"><div class="sc-label">军力评估</div><div class="sc-value">${Math.round(g._factionPower(f.id))}</div><div class="sc-note">部队、城防与领地</div></div>
      <div class="summary-cell"><div class="sc-label">进行中的战争</div><div class="sc-value">${wars.length}</div><div class="sc-note">${wars.length ? '有敌人正在等你' : '暂无战事'}</div></div>
      <div class="summary-cell"><div class="sc-label">训练队列</div><div class="sc-value">${trainingTotal}</div><div class="sc-note">${militaryBuildings.length} 座军事建筑</div></div>
    </div>
    <div class="military-panel-grid">
      <div><div class="section-title">你的军队</div><div class="button-row" style="margin-bottom:8px"><button class="action-btn primary" data-act="mil-select-all">${icon('military')}选择全部军队</button><button class="action-btn" data-act="help-open">战斗规则</button></div>${armyGroups}<div class="section-title" style="margin-top:16px">训练与驻防</div>${queueHtml}</div>
      <div><div class="section-title">战争</div><div class="wars-overview">${warsHtml}</div>
        <div class="section-title" style="margin-top:16px">外交关系</div>
        <div class="stat-line"><span class="k">盟友</span><span class="v">${allies.map((x) => esc(D.realmFullName(x))).join('、') || '无'}</span></div>
        <div class="stat-line"><span class="k">封臣</span><span class="v">${vassals.map((x) => esc(D.realmFullName(x))).join('、') || '无'}</span></div>
        <div class="stat-line"><span class="k">城防建筑</span><span class="v">${g.buildings.filter((b) => b.owner === f.id && (b.defId === 'tower' || b.defId === 'wall' || b.defId === 'gate')).length}</span></div>
        <div class="effect-line">士兵会自动攻击攻击范围内的敌人。弓手与箭塔可攻击船只。敌人必须攻破城墙或大门才能进入定居点。建筑受损后可以派居民维修。</div>
      </div>
    </div>`;
    this.openModal({
      kind: 'military', eyebrow: 'THE WAR ROOM · 军议厅', title: '军事', subtitle: '军队、战争与防线。翻阅书卷时，时间暂停。',
      body, wide: true, headActions: `<button class="action-btn" data-act="help-open">${icon('help')}战争法典</button>`
    });
    this.setNavActive('military');
  };

  // =========================================================
  // Chronicle
  // =========================================================
  P.openChronicle = function (filter) {
    if (!this.game) return;
    const g = this.game;
    this.unread = 0;
    this.chronicleFilter = filter || this.chronicleFilter || 'all';
    const filterMap = {
      all: () => true, war: (n) => ['war', 'military', 'danger', 'naval', 'navyLoss'].includes(n.type),
      politics: (n) => ['diplomacy', 'trade'].includes(n.type),
      realm: (n) => ['build', 'civic', 'population', 'tech', 'rank', 'settlement', 'tutorial', 'victory', 'defeat'].includes(n.type)
    };
    const items = g.notifications.slice().reverse().filter(filterMap[this.chronicleFilter] || filterMap.all);
    const body = `<div class="chronicle-toolbar">${[['all', '全部'], ['war', '战争'], ['politics', '外交与贸易'], ['realm', '王国']].map(([v, label]) => `<button class="filter-btn ${v === this.chronicleFilter ? 'active' : ''}" data-act="chronicle-filter" data-filter="${v}">${label}</button>`).join('')}<span class="muted" style="font-size:11px;margin-left:auto">${g.notifications.length} 条记录</span></div>
      <div class="chronicle-list">${items.length ? items.map((n) => `<div class="chronicle-entry ${n.type || 'info'}"><div class="chronicle-date">${U.timeToDate(n.time).year}年 · ${U.timeToDate(n.time).season} · 第${U.timeToDate(n.time).day}日</div><div class="chronicle-text"><span class="chronicle-badge"></span>${esc(n.text)}</div></div>`).join('') : '<div class="empty-state">编年史还没有写下任何文字。</div>'}</div>`;
    this.openModal({ kind: 'chronicle', eyebrow: 'THE CHRONICLE · 编年史', title: '编年史', subtitle: '记住发生过的事，才能知道自己将去往何处。', body, wide: true });
    this.setNavActive('chronicle');
    this.updateHUD(true);
  };

  // =========================================================
  // Help / codex
  // =========================================================
  P.openHelp = function (tab) {
    this.codexTab = tab || this.codexTab || 'basics';
    const tabs = [
      ['basics', '从五名居民开始'], ['map', '地形与资源'], ['buildings', '建筑与定居点'],
      ['internal', '内政与人口'], ['war', '单位与战争'], ['diplomacy', '外交与贸易'],
      ['tech', '科技与学识'], ['controls', '操作与存档']
    ];
    const content = this.getCodexContent(this.codexTab);
    const body = `<div class="codex-layout"><aside class="codex-tabs">${tabs.map(([id, name]) => `<button class="codex-tab ${id === this.codexTab ? 'active' : ''}" data-act="help-tab" data-tab="${id}">${name}</button>`).join('')}</aside><div class="codex-content">${content}</div></div>`;
    this.openModal({ kind: 'help', eyebrow: 'CODEX REGNI · 王国法典', title: '王国法典', subtitle: '战争世界的全部法则。翻阅书卷时，时间暂停（若游戏已经开始）。', body, wide: true, footer: `<div class="note">所有规则均以当前游戏版本为准。</div><button class="action-btn" data-close-modal>合上法典</button>` });
    this.setNavActive('help');
  };

  P.getCodexContent = function (tab) {
    if (tab === 'basics') return `<h3>从五名居民开始</h3><p class="codex-lead">这是一个长期游玩的策略世界。你不必急着开战；粮食、木材和下一座民宅，往往比一支军队更重要。</p>
      <p>游戏开始时你有 <strong>五名居民</strong> 和一座村庄大厅。你的阵营会随着最高阶段定居点而获得头衔：村庄为伯国，小镇为公国，城市为王国，首都/王宫为帝国。</p>
      <h4>最初该做什么</h4><ul>
        <li>选中居民，右键点击树林或浆果丛开始采集。木材与食物是一切的起点。</li>
        <li>打开建造面板，在领地内修建 <strong>民宅</strong>、<strong>农田</strong>、<strong>伐木场</strong> 或 <strong>采摘屋</strong>。</li>
        <li>建筑放下后会自动派一名空闲居民前往施工。没有工匠时，施工会暂停。</li>
        <li>资源建筑完工后需要居民进入才会生产：点击建筑，选择“派遣居民”或“补满工人”。</li>
        <li>升级村庄大厅可以解锁新的建筑与内政功能。升级同样需要工匠施工。</li>
      </ul>
      <h4>资源是本地的</h4><p>每个定居点拥有独立的仓库与资源。在 A 城采集的木材不能直接用于 B 城建造。要跨城调配，可雇佣商人运输，或通过集市与外国交换。</p>
      <h4>时间与速度</h4><p>正常速度下 1 个游戏日为 7 秒，一年为 360 日。可以暂停、半速或双倍速。翻阅大型书页时游戏自动暂停。游戏会在浏览器中自动保存。</p>
      <h4>胜负</h4><p>没有固定的终局。你可以永远经营下去。当所有敌对阵营都灭亡时，会迎来“万王之王”的时刻。若你失去所有定居点与军队，王朝就结束了——但存档可以让你回到过去。</p>`;
    if (tab === 'map') {
      const rows = D.TERRAIN.map((t) => `<tr><td><strong>${t.name}</strong></td><td>${esc(t.effect)}</td></tr>`).join('');
      return `<h3>山河与资源</h3><p class="codex-lead">地图每次都会由种子随机生成。世界很大，你只需关心眼睛能看到的地方，以及商队将要经过的地方。</p>
        <h4>地形效果</h4><table class="shortcut-table">${rows}</table>
        <h4>资源点</h4><div class="codex-grid">
          <div class="codex-card"><strong>树林 · 木材</strong><span>采集木材时有概率额外获得浆果食物与草药。需要先清除资源点才能建房。</span></div>
          <div class="codex-card"><strong>浆果丛 · 食物</strong><span>采集时有概率获得草药。附近有采摘屋时食物再生更快。</span></div>
          <div class="codex-card"><strong>铁矿脉 · 铁矿</strong><span>无法直接采集。小镇阶段解锁铁矿场，紧邻矿脉建造。</span></div>
          <div class="codex-card"><strong>金矿脉 · 金矿</strong><span>城市阶段解锁金矿场。金矿需要冶炼厂加工成金。</span></div>
          <div class="codex-card"><strong>银矿脉 · 银矿</strong><span>城市阶段解锁银矿场。银可冶炼，也可送往铸币厂制成银币。</span></div>
          <div class="codex-card"><strong>石材</strong><span>没有天然资源点。只能在领地内建采石场，且靠近高山时产量 +50%。</span></div>
          <div class="codex-card"><strong>皮革</strong><span>没有天然资源点。猎人小屋必须靠近树林，产出食物与皮革。</span></div>
          <div class="codex-card"><strong>草药</strong><span>采集浆果与木材时有概率获得，采摘屋也会稳定产出。诊所与医院消耗草药治疗。</span></div>
        </div>
        <p class="nearby-note">铁矿脉、银矿脉与金矿脉相当稀少，通常需要探索更远的地方，或在集市贸易中获取。石灰岩采石场偶尔也会挖出微量矿石。</p>
        <h4>再生与枯竭</h4><p>资源点被采集后不会消失，但储量会下降；每天按比例恢复，上限固定（生成时随机）。伐木场与采摘屋会显著加快附近资源点的再生。资源点可以被居民永久清除，以腾出土地。</p>
        <h4>跨越地形</h4><p>河流无法直接涉水，需桥梁或船只；湖泊与海洋只能乘船。高山需要隧道。桥梁、隧道、道路都由工程队即时铺设，但可被敌军摧毁。道路使移动速度 +35%。</p>`;
    }
    if (tab === 'buildings') return `<h3>建筑与定居点</h3><p class="codex-lead">所有建筑（除村庄大厅与特殊工程外）都必须建在当前定居点的领地内。建筑需要居民或建筑工施工，完成后才会生效。</p>
      <h4>定居点阶段</h4><p>村庄 → 小镇 → 城市 → 首都。阶段由大厅等级决定：村庄大厅、镇长大厅、市政厅、王宫。每级大厅都需要资源与漫长的施工。每个阵营只能拥有一座王宫。</p>
      <h4>建筑分类</h4><div class="codex-grid">
        <div class="codex-card"><strong>政府</strong><span>村庄大厅决定领地和阶段；民宅提供人口上限，并随时间自动产生居民。每个定居点民宅数量有限：村庄 ${D.HOUSE_LIMIT[1]}、小镇 ${D.HOUSE_LIMIT[2]}、城市 ${D.HOUSE_LIMIT[3]}、首都 ${D.HOUSE_LIMIT[4]} 座，升级大厅可提高上限。</span></div>
        <div class="codex-card"><strong>资源</strong><span>伐木场、猎人小屋、渔场、采摘屋、采石场、矿场、农田、磨坊、冶炼厂、铸币厂。多数需要工人。</span></div>
        <div class="codex-card"><strong>功能</strong><span>仓库提高本城仓储上限；教堂与酒馆提升稳定度；集市商人；诊所与医院治疗；码头造船。</span></div>
        <div class="codex-card"><strong>战争</strong><span>兵营、靶场、马厩训练士兵；箭塔自动射击；围墙可拖拽建造；点击围墙可改建为大门。</span></div>
        <div class="codex-card"><strong>科技</strong><span>图书馆、大学、皇家大学，分别研究一至三级科技。每个定居点各限一座。</span></div>
        <div class="codex-card"><strong>特殊</strong><span>桥梁只在河流上；隧道只在山上；道路可在任意陆地铺设。它们不消耗定居点领地。</span></div>
      </div>
      <h4>选择建造阶段</h4><p>建造面板的「建造等级」可以选择当前定居点已解锁的任意阶段，不必总是建造最高级。低阶段建筑造价与工期更低，但工人位、产出与耐久也较低，之后仍可逐级升级。升级沿用原有地基与结构，资源消耗约为新建同级建筑的 ${Math.round(D.UPGRADE_COST_RATIO * 100)}%。</p>
      <h4>升级而不是替换</h4><p>定居点阶段提高后，现有建筑可以升级到同阶段的新形态，也可以直接在当前阶段建造新建筑。升级同样需要工匠，且完成前旧建筑继续运作。</p>
      <h4>耐久与维修</h4><p>建筑拥有耐久，被攻击会下降。选中受损建筑，派遣居民或建筑工维修。建筑工维修更快。建筑被摧毁后，其内部工人会受伤并被赶出。</p>
      <h4>拆除建筑</h4><p>在己方建筑详情页可以拆除建筑或未完工的工地。拆除后建筑永久消失，投入的资源不会返还；内部人员会被安置到附近，不会受伤。定居点大厅是城市核心，不能拆除。</p>
      <h4>城门与围墙</h4><p>木质栅栏、石质窄墙、石质厚墙、雕文石墙随阶段变化。任何围墙段都可以转化为同阶段大门。大门可以开启或关闭：开启时单位自由通过；关闭时等同围墙。攻方必须先摧毁大门或城墙。</p>`;
    if (tab === 'internal') return `<h3>内政、人口与稳定</h3><p class="codex-lead">你的政权并不自动稳固。粮食短缺、战争和占领都会让城市滑向独立。</p>
      <h4>人口</h4><p>人口是阵营层面的总量，居民、建筑工、商人和士兵都占用 1 人口。村庄大厅与每座民宅提供上限；每个定居点的民宅数量受阶段限制（村庄 ${D.HOUSE_LIMIT[1]}、小镇 ${D.HOUSE_LIMIT[2]}、城市 ${D.HOUSE_LIMIT[3]}、首都 ${D.HOUSE_LIMIT[4]} 座），升级大厅可提高上限。民宅在人口未满且城市有食物时，会间隔一段时间产生一名新居民；每座民宅独立计时，因此不会整排民宅在同一天同时添丁。没有空闲人口就无法训练士兵、雇佣商人或建立新定居点。</p>
      <h4> upkeep（每日消耗）</h4><p>村庄每日消耗食物；小镇还会消耗木材；城市消耗食物、木材与石材；首都还会消耗银币。若某座定居点无法支付其消耗，稳定度将快速下降。</p>
      <h4>稳定度</h4><p>每座定居点有独立稳定度。教堂、酒馆营业、集市和科技能提高稳定度目标；战争、物资短缺和占领降低目标。稳定度低于 ${D.INDEPENDENCE.threshold} 时，每天都有概率宣布独立，越低越危险；一旦降至 0，城市会立即独立，成为新的 AI 阵营，并带走所在地的全部建筑与人口。</p>
      <h4>救助金</h4><p>在内政界面支付银币，可立即提高 16 点稳定度，每座城市每 20 天只能进行一次。救助金只解一时之急，长期仍要解决粮食与安全。</p>
      <h4>劳动力</h4><p>资源建筑必须有居民进入才能生产；越高级的建筑拥有更多工位。普通居民可以转为建筑工，建筑工施工速度翻倍，但永远不能再采集或进入资源建筑。请谨慎转职。</p>`;
    if (tab === 'war') return `<h3>单位与战争</h3><p class="codex-lead">没有战争的世界只是一张地图。士兵不会自然回血；他们需要诊所、医院和草药。</p>
      <h4>单位类别</h4><div class="codex-grid">
        <div class="codex-card"><strong>居民</strong><span>有生命但无攻击力。采集、建造、进入建筑工作，受伤后会慢慢自愈。</span></div>
        <div class="codex-card"><strong>建筑工</strong><span>施工速度 ×2，无法采集或进入资源建筑，且不可转回居民。</span></div>
        <div class="codex-card"><strong>士兵</strong><span>近战、远程与骑兵三大类。会自动攻击范围内的敌人，可手动攻击中立目标。无法自然恢复生命。</span></div>
        <div class="codex-card"><strong>船只</strong><span>在码头建造，可运载单位穿过水域。船有耐久，会被弓箭手与箭塔击沉。</span></div>
        <div class="codex-card"><strong>遣散</strong><span>任何己方单位都可以遣散：永久离开并立即释放所占人口。船上仍有乘客时，需先让乘客登陆。</span></div>
      </div>
      <h4>战斗与战争</h4><p>只有处于战争关系的阵营单位互为敌人。无端攻击中立单位或建筑会立即宣战，并使其他所有阵营对你的好感下降。你可以使用战争理由（边界冲突、征服、独立）来减少声誉损失。</p>
      <h4>城墙攻防</h4><p>城墙阻挡寻路。进攻方需要先摧毁大门或一段城墙。箭塔在射程内自动攻击。守军可以开启大门出击，也可关闭城门固守。医院会治疗附近友军，诊所需要伤员进入。</p>
      <h4>攻占定居点</h4><p>将敌方大厅耐久降至零即可攻占该定居点。城市中的所有建筑会归属攻方，但稳定度低下，人口也会离散。被俘城市的工人会被赶出建筑。若攻方已拥有王宫，多出的王宫会降级。</p>
      <h4>厌战与和平</h4><p>战争持续越久、损失越大，双方厌战越高。外交界面可以提出和平；AI 会在有利或疲惫时接受。和平后获得 70 天停战期。</p>
      <h4>维修与治疗</h4><p>受损建筑需要居民维修。伤兵可以进入诊所（消耗草药），或在医院范围内自动恢复。医院的恢复速度比同阶段诊所慢，但作用范围更广。</p>`;
    if (tab === 'diplomacy') return `<h3>外交、同盟与贸易</h3><p class="codex-lead">没有永远的敌人，只有永远的利益。好感度决定列强愿意为你做多少事。</p>
      <h4>好感</h4><p>好感范围为 0–100。友好与亲密关系更容易接受结盟与有利贸易。无端战争、拒绝盟友求援、背弃盟约都会降低好感。和平与赠礼会改善关系。</p>
      <h4>结盟</h4><p>双方关系足够好时可缔结同盟。盟友被攻击时，另一方会收到是否参战的请求；拒绝不会自动解盟，但会严重损害关系。盟友也可以被邀请加入你正在进行的战争。</p>
      <h4>附庸</h4><p>阵营等级更高的一方可要求较低方成为附庸。拒绝会给予征服战争理由。宗主可以征召封臣参战；拒绝征召同样会给予征服理由。封臣的等级达到或超过宗主时，可以申请解除附庸；若宗主拒绝，封臣获得独立战争理由。</p>
      <h4>战争理由</h4><p>边界冲突由相邻定居点长期紧张随机产生；征服来自拒绝附庸要求或拒绝宗主征召；独立来自拒绝解除附庸。特定战争理由会减少其他列强的反感。</p>
      <h4>贸易与商人</h4><p>双方需要至少各有一座集市。通过外交界面确定双方货物、数量与交付期限（${D.TRADE_TERM.min}–${D.TRADE_TERM.max} 天）；对方是否接受取决于价值、好感、商路与期限长短。接受后，双方派出商人，必须在期限内把货物送到对方集市；已签订的协定可以在该阵营的外交页面查看。商人可被敌军杀死，货物也会丢失。</p>
      <p>也可以手动雇佣商人：靠近己方集市装货，然后移动到任意集市卸货。向外国集市卸货会提高双方好感。</p>`;
    if (tab === 'tech') return `<h3>科技与学识</h3><p class="codex-lead">学者不会在战场上为你赢得一场战役，却会改变之后每一场战役。</p>
      <h4>研究建筑</h4><p>图书馆（小镇）研究一级科技；大学（城市）研究二级科技，需要前置一级；皇家大学（首都）研究三级科技，需要前置二级。每个定居点各限一座。</p>
      <h4>研究速度</h4><p>研究需要先支付资源，然后由进入对应研究建筑的居民提供研究点。基础速度很慢；更多学者、更高等级的建筑会加快进度。同时只能进行一项研究。</p>
      <h4>科技树分支</h4><div class="codex-grid">
        <div class="codex-card"><strong>生产</strong><span>伐木术、农耕术、石工术、冶金学提高资源采集与加工效率。</span></div>
        <div class="codex-card"><strong>军事</strong><span>军纪、弓术、骑术强化对应兵种。部分加成对之后训练的单位更明显。</span></div>
        <div class="codex-card"><strong>治理</strong><span>内政学提升稳定度与仓储，医学提升治疗效率，贸易学增加商队载货与外交好感。</span></div>
      </div>
      <h4>研究中断</h4><p>如果没有学者在对应建筑内工作，研究暂停但不会丢失进度。你可以中止研究，但只会返还 40% 的已支付资源。</p>`;
    if (tab === 'controls') return `<h3>操作与存档</h3><p class="codex-lead">世界很大，慢慢来。</p>
      <h4>地图操作</h4><table class="shortcut-table">
        <tr><td>鼠标左键</td><td>选择单位或建筑；拖拽框选自己的单位</td></tr>
        <tr><td>鼠标右键</td><td>移动、采集、建造、进入建筑、攻击或卸货</td></tr>
        <tr><td>中键拖动 / 方向盘</td><td>平移视野</td></tr>
        <tr><td>滚轮</td><td>缩放地图</td></tr>
        <tr><td>小地图</td><td>点击或拖动快速移动视野</td></tr>
      </table>
      <h4>快捷键</h4><table class="shortcut-table">
        <tr><td><kbd>空格</kbd></td><td>暂停 / 继续</td></tr>
        <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>半速 / 正常 / 双倍</td></tr>
        <tr><td><kbd>B</kbd> <kbd>I</kbd> <kbd>D</kbd> <kbd>T</kbd> <kbd>M</kbd></td><td>建造 / 内政 / 外交 / 科技 / 军事</td></tr>
        <tr><td><kbd>H</kbd> <kbd>C</kbd> <kbd>F</kbd></td><td>法典 / 编年史 / 回到首都</td></tr>
        <tr><td><kbd>G</kbd></td><td>选择全部空闲居民与建筑工</td></tr>
        <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>立即保存</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>关闭面板 / 取消放置 / 打开暂停菜单</td></tr>
      </table>
      <h4>自动保存</h4><p>游戏会定期自动保存到浏览器本地存储。手动保存也可在设置中进行。清除浏览器站点数据会删除存档，请留意。</p>
      <h4>视频与音频</h4><p>所有音乐和音效都由浏览器实时合成，不依赖任何外部文件，因此可以完全离线游玩。</p>`;
    return '';
  };

  // =========================================================
  // Settings / pause
  // =========================================================
  P.openSettings = function () {
    const app = this.app;
    const a = app.audio;
    const hasGame = !!this.game;
    const settings = app.settings || {};
    const body = `<div class="settings-section">
      <div class="section-title">音律</div>
      <div class="settings-row"><label>背景音乐</label><div class="settings-control"><input type="range" id="set-music" min="0" max="100" value="${Math.round((a?.musicVolume ?? .42) * 100)}"><span class="settings-value" id="set-music-val">${Math.round((a?.musicVolume ?? .42) * 100)}%</span><div class="toggle-switch ${a?.musicOn ? 'on' : ''}" id="toggle-music" title="开启/关闭音乐"></div></div></div>
      <div class="settings-row"><label>音效</label><div class="settings-control"><input type="range" id="set-sfx" min="0" max="100" value="${Math.round((a?.sfxVolume ?? .62) * 100)}"><span class="settings-value" id="set-sfx-val">${Math.round((a?.sfxVolume ?? .62) * 100)}%</span><div class="toggle-switch ${a?.sfxOn ? 'on' : ''}" id="toggle-sfx" title="开启/关闭音效"></div></div></div>
      <p class="save-note">音乐与音效均由程序实时合成，可完全离线使用。</p>
    </div>
    <div class="settings-section">
      <div class="section-title">画面与辅助</div>
      <div class="settings-row"><label>显示领地边界</label><div class="settings-control"><div class="toggle-switch ${this.renderer.showTerritories ? 'on' : ''}" id="toggle-territories"></div></div></div>
      ${hasGame ? `<div class="settings-row"><label>王室谕令与新手指引</label><div class="settings-control"><div class="toggle-switch ${this.game.settings.tutorial ? 'on' : ''}" id="toggle-tutorial"></div></div></div>` : ''}
      <p class="save-note">领地边界帮助辨认各阵营的建造范围。关闭后地图会更干净。</p>
    </div>
    ${hasGame ? `<div class="settings-section">
      <div class="section-title">世界与存档</div>
      <div class="stat-line"><span class="k">世界种子</span><span class="v">${esc(String(this.game.seed))}</span></div>
      <div class="stat-line"><span class="k">地图尺度</span><span class="v">${D.MAP_SIZES[this.game.settings.mapSize]?.name || '辽阔'} · ${this.game.world.w} × ${this.game.world.h}</span></div>
      <div class="stat-line"><span class="k">AI 难度</span><span class="v">${D.DIFFICULTIES[this.game.settings.difficulty]?.label || '普通'}</span></div>
      <div class="stat-line"><span class="k">游戏时间</span><span class="v">${U.dateLabel(this.game.timeDays)}</span></div>
      <div class="save-actions" style="margin-top:10px"><button class="action-btn primary" id="save-now">立即保存</button><button class="action-btn" id="load-now" ${app.hasSave() ? '' : 'disabled'}>读取最近存档</button></div>
      <p class="save-note" id="save-status">${app.saveStatus || '自动保存已开启。'}</p>
    </div>
    <div class="settings-section danger-zone">
      <div class="section-title">王庭</div>
      <div class="save-actions"><button class="action-btn" data-act="help-open">打开王国法典</button><button class="action-btn danger" data-act="return-menu">保存并返回主菜单</button></div>
    </div>` : `<div class="settings-section"><p class="save-note">开始新游戏后可以在这里保存或继续游戏。</p></div>`}`;
    this.openModal({ kind: 'settings', eyebrow: 'THE PRIVY COUNCIL · 枢密院', title: '设置', subtitle: hasGame ? '调整体验，或管理你的编年史。' : '调整音律与画面。', body, narrow: true, footer: `<button class="action-btn" data-close-modal>关闭</button>`, onMount: (root) => this.bindSettings(root) });
    this.setNavActive('settings');
  };

  P.bindSettings = function (root) {
    const a = this.app.audio;
    const music = $('#set-music', root);
    const sfx = $('#set-sfx', root);
    const musicVal = $('#set-music-val', root);
    const sfxVal = $('#set-sfx-val', root);
    if (music) music.addEventListener('input', () => {
      this.app.setMusicVolume(parseInt(music.value, 10) / 100);
      if (musicVal) musicVal.textContent = music.value + '%';
    });
    if (sfx) sfx.addEventListener('input', () => {
      this.app.setSfxVolume(parseInt(sfx.value, 10) / 100);
      if (sfxVal) sfxVal.textContent = sfx.value + '%';
    });
    const tm = $('#toggle-music', root);
    if (tm) tm.addEventListener('click', () => {
      this.app.setMusicOn(!this.app.audio.musicOn);
      tm.classList.toggle('on', this.app.audio.musicOn);
    });
    const ts = $('#toggle-sfx', root);
    if (ts) ts.addEventListener('click', () => {
      this.app.setSfxOn(!this.app.audio.sfxOn);
      ts.classList.toggle('on', this.app.audio.sfxOn);
    });
    const tt = $('#toggle-territories', root);
    if (tt) tt.addEventListener('click', () => {
      this.renderer.showTerritories = !this.renderer.showTerritories;
      tt.classList.toggle('on', this.renderer.showTerritories);
      this.app.saveUserSettings();
    });
    const tut = $('#toggle-tutorial', root);
    if (tut) tut.addEventListener('click', () => {
      if (!this.game) return;
      this.game.settings.tutorial = !this.game.settings.tutorial;
      tut.classList.toggle('on', this.game.settings.tutorial);
      this.refreshAdviser();
      this.app.saveUserSettings();
    });
    const save = $('#save-now', root);
    if (save) save.addEventListener('click', () => {
      const ok = this.app.saveGame(true);
      const st = $('#save-status', root);
      if (st) st.textContent = ok ? `已保存 · ${new Date().toLocaleString('zh-CN')}` : '保存失败：浏览器存储空间可能已满。';
    });
    const load = $('#load-now', root);
    if (load) load.addEventListener('click', () => {
      this.closeModal();
      this.app.loadSavedGame(true);
    });
  };

  P.openPauseMenu = function () {
    if (!this.game) return;
    const g = this.game;
    const body = `<div style="text-align:center;padding:8px 0 16px">
        <div class="eyebrow" style="justify-content:center;color:rgba(96,75,43,.6)">THE REALM AWAITS</div>
        <h3 style="font-family:var(--font-title);font-weight:400;font-size:30px;letter-spacing:.12em;margin:10px 0 4px;color:#392d1e">${esc(D.realmFullName(g.player))}</h3>
        <p style="font-size:12px;color:rgba(81,65,42,.62);margin:0">${U.dateLabel(g.timeDays)} · ${g.ownedSettlements(g.playerFactionId).length} 座定居点 · 人口 ${g.livingPopulation(g.playerFactionId)}</p>
      </div>
      <div class="button-row" style="justify-content:center;flex-wrap:wrap">
        <button class="action-btn primary" data-act="resume" style="min-width:140px">继续统治</button>
        <button class="action-btn" data-act="save" style="min-width:110px">保存游戏</button>
        <button class="action-btn" data-act="help-open" style="min-width:110px">王国法典</button>
        <button class="action-btn" data-act="settings-open" style="min-width:110px">设置</button>
        <button class="action-btn" data-act="return-menu" style="min-width:140px">返回主菜单</button>
      </div>
      <div class="effect-line" style="text-align:center;margin-top:16px">翻阅书页时时间暂停。按 <kbd>Esc</kbd> 继续游戏。</div>`;
    this.openModal({ kind: 'pause', eyebrow: 'THE ROYAL COUNCIL · 王廷', title: '暂停', body, narrow: true });
  };

  // =========================================================
  // Army selection / merchant cargo
  // =========================================================
  P.openArmySelection = function () {
    this.openMilitary();
  };

  P.openMerchantLoad = function (u) {
    const g = this.game;
    const market = g.getNearbyMarketForMerchant(u);
    if (!market) { this.showSubToast('商人必须靠近集市。'); return; }
    if (market.owner !== g.playerFactionId) { this.showSubToast('只能在己方集市装货。'); return; }
    const s = g.getSettlement(market.settlementId);
    const total = g.getMerchantCargoTotal(u);
    const cap = u.cargoCapacity || 20;
    const space = Math.max(0, cap - total);
    if (!space) { this.showSubToast('商队已经满载。'); return; }
    const body = `<h3>装载货物</h3>
      <p class="sub-copy">从「${esc(s.name)}」的仓库提取资源放入商队。商队只能在集市装载与卸载，资源不能凭空跨城使用。</p>
      <div class="subdialog-info">商队载重 ${Math.floor(total)} / ${cap} · 还可装载 ${Math.floor(space)}</div>
      <div class="form-grid"><div class="form-field"><label>资源</label><select id="cargo-res">${D.RES_KEYS.map((k) => `<option value="${k}">${D.RES[k].name} · 库存 ${fmt(s.resources[k] || 0)}</option>`).join('')}</select></div>
      <div class="form-field"><label>数量</label><input id="cargo-amt" type="number" min="1" max="${space}" value="${Math.min(20, Math.floor(space))}"></div></div>
      <div class="subdialog-error" id="cargo-error"></div>
      <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn primary" data-sub-confirm>装载</button></div>`;
    this.showSubdialog(body);
    const resSel = $('#cargo-res');
    const amt = $('#cargo-amt');
    resSel.addEventListener('change', () => {
      const max = Math.min(space, Math.floor(s.resources[resSel.value] || 0));
      amt.max = max;
      amt.value = Math.min(parseInt(amt.value, 10) || max, max);
    });
    resSel.dispatchEvent(new Event('change'));
    this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
    this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
      const amount = parseInt(amt.value, 10) || 0;
      const r = g.loadMerchantCargo(u.id, resSel.value, amount);
      if (!r.ok) { $('#cargo-error').textContent = r.error; return; }
      this.closeSubdialog();
      this.showSubToast(`已装载 ${r.amount} ${D.RES[resSel.value].name}。`);
      this.openUnitDrawer(u);
    });
  };

  // =========================================================
  // Modal action dispatcher
  // =========================================================
  P.onModalAction = function (e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const g = this.game;
    // Universal actions
    if (act === 'resume') { this.closeModal(); return; }
    if (act === 'save') {
      const ok = this.app.saveGame(true);
      this.showSubToast(ok ? '游戏已保存。' : '保存失败。');
      return;
    }
    if (act === 'settings-open') { this.closeModal(); this.openSettings(); this.setNavActive('settings'); return; }
    if (act === 'help-open') { this.closeModal(); this.openHelp(); return; }
    if (act === 'return-menu') {
      this.showSubdialog(`<h3>返回主菜单</h3><p class="sub-copy">你的编年史会自动保存。返回主菜单后可以继续或开始新的世界。</p><div class="subdialog-actions"><button class="action-btn" data-sub-cancel>留下继续统治</button><button class="action-btn primary" data-sub-confirm>保存并返回</button></div>`);
      this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
      this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
        this.closeSubdialog();
        this.closeModal();
        this.app.returnToMenu();
      });
      return;
    }
    if (act === 'help-tab') { this.openHelp(btn.dataset.tab); return; }
    if (act === 'chronicle-filter') { this.chronicleFilter = btn.dataset.filter; this.openChronicle(btn.dataset.filter); return; }

    if (!g) return;
    // Internal
    if (act === 'internal-select') { this.openInternal(btn.dataset.id); return; }
    if (act === 'internal-build') { this.closeModal(); this.openBuild(); return; }
    if (act === 'internal-focus') {
      const s = g.getSettlement(this.activeSettlementId);
      if (s) { this.closeModal(); this.renderer.focus(s.x, s.y); }
      return;
    }
    if (act === 'internal-open-building') {
      const b = g.getBuilding(btn.dataset.id);
      this.closeModal();
      if (b) {
        this.selection = { unitIds: [], buildingId: b.id, nodeId: null, settlementId: b.settlementId };
        this.applySelectionToRenderer();
        this.renderer.focus(g.buildingCenter(b).x, g.buildingCenter(b).y);
        this.openBuildingDrawer(b);
      }
      return;
    }
    if (act === 'internal-aid') {
      const r = g.grantAid(this.activeSettlementId);
      if (!r.ok) this.showSubToast(r.error);
      else this.showSubToast('救助金已经发放，稳定度提高。');
      this.openInternal(this.activeSettlementId);
      return;
    }
    if (act === 'internal-colonize') {
      const s = g.getSettlement(this.activeSettlementId);
      if (!s) return;
      if (!g.canAfford(s, g.COLONY_COST)) {
        this.showSubToast(`资源不足：建立新定居点需要 ${Object.entries(g.COLONY_COST).map(([k, v]) => v + ' ' + D.RES[k].name).join('、')}。`);
        return;
      }
      if (g.livingPopulation(g.playerFactionId) + 3 > g.factionPopCap(g.playerFactionId)) {
        this.showSubToast('需要至少 3 个空余人口容量。请先修建民宅提高人口上限。');
        return;
      }
      this.closeModal();
      this.startPlacement({ settlementId: s.id, mode: 'found' });
      this.showSubToast('在地图上选择新定居点的位置，左键确认，右键/ESC 取消。');
      return;
    }
    if (act === 'internal-rename') {
      const s = g.getSettlement(this.activeSettlementId);
      if (!s) return;
      this.showSubdialog(`<h3>为定居点改名</h3><p class="sub-copy">名称会出现在领地、编年史与外交文书上。</p><div class="form-field"><label>新名称</label><input id="rename-val" maxlength="14" value="${esc(s.name)}"></div><div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn primary" data-sub-confirm>确认改名</button></div>`);
      this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
      this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
        const v = $('#rename-val').value;
        const r = g.renameSettlement(s.id, v);
        if (!r.ok) return;
        this.closeSubdialog();
        this.openInternal(s.id);
      });
      return;
    }

    // Diplomacy
    if (act === 'diplo-select') { this.openDiplomacy(btn.dataset.id); return; }
    if (act === 'diplo-gift') { const fid = this.diploSelectedId; this.openGiftDialog(fid); return; }
    if (act === 'diplo-trade') { const fid = this.diploSelectedId; this.openTradeDialog(fid); return; }
    if (act === 'diplo-war') { const fid = this.diploSelectedId; this.openWarDeclarationDialog(fid); return; }
    if (act === 'diplo-peace') { const fid = this.diploSelectedId; this.openPeaceDialog(fid); return; }
    if (act === 'diplo-alliance') {
      const fid = this.diploSelectedId;
      const r = g.proposeAlliance(fid);
      if (!r.ok) this.showSubToast(r.error);
      else if (r.accepted) this.showSubToast('对方接受了同盟提议。新的盟约已经缔结。');
      else this.showSubToast('对方婉拒了结盟提议。');
      this.openDiplomacy(fid);
      return;
    }
    if (act === 'diplo-demand-vassal') {
      const fid = this.diploSelectedId;
      const r = g.demandVassalage(fid);
      if (!r.ok) this.showSubToast(r.error);
      else if (r.accepted) this.showSubToast('对方接受了附庸要求，成为你的封臣。');
      else this.showSubToast('对方拒绝了附庸要求，你获得了征服战争理由。');
      this.openDiplomacy(fid);
      return;
    }
    if (act === 'diplo-break-alliance') {
      const fid = this.diploSelectedId;
      this.showSubdialog(`<h3>解除同盟</h3><p class="sub-copy">背弃盟约会严重损害双方好感，并可能让其他国家认为你不可信。</p><div class="subdialog-actions"><button class="action-btn" data-sub-cancel>保留同盟</button><button class="action-btn danger" data-sub-confirm>解除同盟</button></div>`);
      this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
      this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
        this.closeSubdialog();
        g.breakAlliance(g.playerFactionId, fid);
        this.showSubToast('同盟已经解除。');
        this.openDiplomacy(fid);
      });
      return;
    }
    if (act === 'diplo-release') {
      const r = g.requestReleaseFromOverlord();
      if (!r.ok) this.showSubToast(r.error);
      else if (r.accepted) this.showSubToast('宗主同意解除附庸关系。你重获自由。');
      else this.showSubToast('宗主拒绝了解除附庸的请求。你获得了独立战争理由。');
      this.openDiplomacy(this.diploSelectedId);
      return;
    }
    if (act === 'diplo-invite-ally') { this.openInviteAllyDialog(); return; }
    if (act === 'diplo-call-vassal') { this.openCallVassalDialog(); return; }

    // Technology
    if (act === 'tech-select') { this.openTech(btn.dataset.tech); return; }
    if (act === 'tech-start') {
      const techId = btn.dataset.tech;
      if (g.player.activeResearch) { this.showSubToast('同一时间只能进行一项研究。'); return; }
      const chk = g.canResearch(techId);
      if (!chk.ok) { this.showSubToast(chk.error); return; }
      const buildings = g.buildings.filter((b) => b.owner === g.playerFactionId && b.complete && !b.dead && b.def.researchTier === D.TECHS[techId].tier);
      let started = false, lastError = '';
      for (const b of buildings) {
        const s = g.getSettlement(b.settlementId);
        if (!s || !g.canAfford(s, D.TECHS[techId].cost)) { lastError = '研究所需资源不足'; continue; }
        const r = g.startResearch(techId, s.id);
        if (r.ok) { started = true; break; }
        lastError = r.error;
      }
      if (!started) this.showSubToast(lastError || '无法开始研究。');
      else this.showSubToast('研究已经开始。进入研究建筑的居民将推动进度。');
      this.openTech(techId);
      return;
    }
    if (act === 'tech-cancel') {
      const r = g.cancelResearch();
      if (!r.ok) this.showSubToast('当前没有进行中的研究。');
      else this.showSubToast('研究已中止，部分资源被浪费。');
      this.openTech();
      return;
    }

    // Military
    if (act === 'mil-select-all') {
      const ids = g.units.filter((u) => !u.dead && u.owner === g.playerFactionId && u.def.military && u.state !== 'aboard').map((u) => u.id);
      if (!ids.length) { this.showSubToast('你没有可以调动的士兵。'); return; }
      this.closeModal();
      this.selectUnits(ids, false);
      this.showSubToast(`已选择 ${ids.length} 名士兵。`);
      return;
    }
    if (act === 'mil-select-kind') {
      const kind = btn.dataset.kind;
      const ids = g.units.filter((u) => !u.dead && u.owner === g.playerFactionId && u.kind === kind && u.state !== 'aboard').map((u) => u.id);
      if (ids.length) { this.closeModal(); this.selectUnits(ids, false); }
      return;
    }
    if (act === 'mil-focus-unit') {
      const u = g.getUnit(btn.dataset.unit);
      if (u) { this.closeModal(); this.renderer.focus(u.x, u.y); this.selectUnits([u.id], false); }
      return;
    }
    if (act === 'mil-peace') { this.openPeaceDialog(btn.dataset.fid); return; }
    if (act === 'mil-invite-ally') { this.openInviteAllyDialog(); return; }
    if (act === 'mil-call-vassal') { this.openCallVassalDialog(); return; }
  };
})();
