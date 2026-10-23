/* WARWORLD — HUD, selection, construction placement and interactive panels. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = U.esc;
  const fmt = U.fmt;
  const icon = (name, cls) => `<svg class="${cls || ''}" aria-hidden="true"><use href="#ico-${name}"></use></svg>`;
  const resIcon = (res, size) => D.resIcon(res, size || 15);
  const stateLabels = {
    idle: '待命', moving: '行进中', gathering: '采集中', clearing: '清除中', constructing: '施工中',
    repairing: '维修中', attacking: '战斗中', inside: '建筑内工作', patient: '疗伤中', aboard: '船上'
  };

  class UI {
    constructor(app) {
      this.app = app;
      this.game = null;
      this.renderer = app.renderer;
      this.selection = { unitIds: [], buildingId: null, nodeId: null, settlementId: null };
      this.inspectedUnitId = null;
      this.activeSettlementId = null;
      this.buildCategory = 'gov';
      this.placement = null;
      this.modalOpen = false;
      this.modalContext = null;
      this.subdialogOpen = false;
      this.currentPrompt = null;
      this.promptBusy = false;
      this.hoverKey = null;
      this.pointer = { x: 0, y: 0 };
      this.drag = null;
      this.cameraDrag = null;
      this.lineDrag = null;
      this.lastHud = 0;
      this.lastDrawer = 0;
      this.lastSelection = 0;
      this.unread = 0;
      this._nid = 1;
      this.refs = {
        shell: $('#game-shell'),
        hud: $('#hud'),
        crest: $('#crest-canvas'),
        realmName: $('#realm-name'),
        realmSub: $('.realm-sub'),
        date: $('#date-label'),
        day: $('#day-label'),
        resourceBar: $('#resource-bar'),
        unread: $('#unread-badge'),
        nav: $('#main-nav'),
        adviser: $('#adviser-widget'),
        adviserCount: $('#adviser-count'),
        adviserProgress: $('#adviser-progress i'),
        adviceTitle: $('.advice-title'),
        adviceText: $('.advice-text'),
        minimap: $('#minimap'),
        minimapCoord: $('#minimap-coord'),
        toast: $('#toast-layer'),
        selectionBar: $('#selection-bar'),
        selectionCards: $('#selection-cards'),
        selectionActions: $('#selection-actions'),
        drawer: $('#context-drawer'),
        buildPanel: $('#build-panel'),
        promptLayer: $('#prompt-layer'),
        tutorialToast: $('#tutorial-toast-layer'),
        modalBackdrop: $('#modal-backdrop'),
        modal: $('#modal'),
        subBackdrop: $('#subdialog-backdrop'),
        tooltip: $('#tooltip'),
        paused: $('#paused-indicator'),
        waiting: $('#waiting-prompt'),
        placementHint: $('#placement-hint'),
        placementText: $('#placement-text'),
        zoomHint: $('#zoom-hint'),
        chronicleBtn: $('#chronicle-btn'),
        gameover: $('#gameover-screen')
      };
      this.bindStatic();
      const self = this;
      document.addEventListener('keydown', (e) => this.onGlobalKeydown(e));
    }

    setGame(game) {
      this.game = game;
      this.selection = { unitIds: [], buildingId: null, nodeId: null, settlementId: null };
      this.inspectedUnitId = null;
      document.body.classList.remove('unit-selection-active');
      this.activeSettlementId = game ? (game.ownedSettlements(game.playerFactionId).sort((a, b) => b.stage - a.stage)[0] || {}).id : null;
      this.placement = null;
      this.closeModal();
      this.closeSubdialog();
      this.closeBuild();
      this.closeDrawer();
      this.clearPrompt();
      this.refs.tooltip.classList.add('hidden');
      this.refs.gameover.classList.add('hidden');
      this.unread = 0;
      if (game) {
        this.buildResourceBar();
        this.drawCrest();
        this.refreshAdviser();
        game.on?.('notice', (n) => this.onNotice(n));
        game.on?.('prompt', (p) => this.enqueuePrompt(p));
        game.on?.('tutorialStep', (o) => this.onTutorialStep(o));
        game.on?.('defeat', (f) => this.showDefeat(f));
        game.on?.('victory', () => this.showVictory());
        game.on?.('crisis', (kind, data) => this.onCrisis(kind, data));
        this.updateHUD(true);
        this.updateSelectionUI();
        if (game.pendingPrompts.length) this.showNextPrompt();
      }
    }

    // =========================================================
    // Static events
    // =========================================================
    bindStatic() {
      this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      this.app.canvas.addEventListener('pointerdown', (e) => this.onCanvasPointerDown(e));
      this.app.canvas.addEventListener('pointermove', (e) => this.onCanvasPointerMove(e));
      this.app.canvas.addEventListener('pointerup', (e) => this.onCanvasPointerUp(e));
      this.app.canvas.addEventListener('pointercancel', (e) => this.onCanvasPointerUp(e));
      this.app.canvas.addEventListener('pointerleave', () => { if (!this.placement) this.hideTooltip(); });
      this.app.canvas.addEventListener('wheel', (e) => this.onCanvasWheel(e), { passive: false });
      this.app.canvas.addEventListener('dblclick', (e) => this.onCanvasDoubleClick(e));

      this.refs.nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-panel]');
        if (!btn) return;
        this.handleNav(btn.dataset.panel);
      });
      $$('.speed-btn').forEach((btn) => btn.addEventListener('click', () => this.app.setSpeed(parseFloat(btn.dataset.speed))));
      this.refs.chronicleBtn.addEventListener('click', () => this.openChronicle());
      $('#menu-btn').addEventListener('click', () => this.openPauseMenu());
      this.refs.adviser.addEventListener('click', (e) => {
        if (e.target.closest('#adviser-collapse')) { this.refs.adviser.classList.toggle('collapsed'); e.stopPropagation(); return; }
        this.openTutorial();
      });
      this.refs.minimap.addEventListener('pointerdown', (e) => this.onMinimapPointer(e));
      this.refs.minimap.addEventListener('pointermove', (e) => { if (e.buttons) this.onMinimapPointer(e); });
      this.refs.buildPanel.addEventListener('click', (e) => this.onBuildPanelClick(e));
      this.refs.buildPanel.addEventListener('change', (e) => this.onBuildPanelChange(e));
      this.refs.buildPanel.addEventListener('pointerover', (e) => this.onBuildHover(e));
      this.refs.buildPanel.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !this.refs.buildPanel.contains(e.relatedTarget)) this.hideTooltip(); });
      this.refs.drawer.addEventListener('click', (e) => this.onDrawerClick(e));
      this.refs.selectionBar.addEventListener('click', (e) => this.onSelectionClick(e));
      this.refs.selectionCards.addEventListener('click', (e) => {
        const card = e.target.closest('[data-unit-id]');
        if (!card) return;
        const id = card.dataset.unitId;
        if (e.shiftKey || e.ctrlKey) {
          const idx = this.selection.unitIds.indexOf(id);
          if (idx >= 0) this.selection.unitIds.splice(idx, 1); else this.selection.unitIds.push(id);
          this.applySelectionToRenderer();
          this.updateSelectionUI();
        } else {
          this.selectUnits([id], false);
        }
      });
      this.refs.resourceBar.addEventListener('pointerover', (e) => this.onResourceHover(e));
      this.refs.resourceBar.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !this.refs.resourceBar.contains(e.relatedTarget)) this.hideTooltip(); });
      this.refs.modalBackdrop.addEventListener('click', (e) => { if (e.target === this.refs.modalBackdrop) this.closeModal(); });
      this.refs.modal.addEventListener('click', (e) => this.onModalClick(e));
      this.refs.subBackdrop.addEventListener('click', (e) => { if (e.target === this.refs.subBackdrop) this.closeSubdialog(); });
      this.refs.promptLayer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-prompt-choice]');
        if (!btn) return;
        this.resolveCurrentPrompt(btn.dataset.promptChoice === 'accept');
      });
      this.refs.gameover.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-go-action]');
        if (!btn) return;
        const action = btn.dataset.goAction;
        if (action === 'continue') this.refs.gameover.classList.add('hidden');
        else if (action === 'load') this.app.loadSavedGame(true);
        else if (action === 'menu') this.app.returnToMenu();
        else if (action === 'new') this.app.startNewFromGameOver();
      });
      setTimeout(() => this.refs.zoomHint.classList.add('fade'), 12000);
    }

    onGlobalKeydown(e) {
      if (e.key === 'Escape') {
        if (this.currentPrompt) return;
        if (this.subdialogOpen) { this.closeSubdialog(); return; }
        if (this.modalOpen) { this.closeModal(); return; }
        if (this.placement) { this.cancelPlacement(); return; }
        if (!this.refs.buildPanel.classList.contains('hidden')) { this.closeBuild(); return; }
        if (!this.refs.drawer.classList.contains('hidden')) { this.closeDrawer(); return; }
        if (this.inspectedUnitId || this.selection.unitIds.length || this.selection.buildingId || this.selection.nodeId) {
          this.clearSelection();
          return;
        }
        if (this.game) this.openPauseMenu();
      }
    }

    handleNav(panel) {
      if (!this.game) return;
      if (panel === 'build') { this.toggleBuild(); return; }
      if (this.placement) this.cancelPlacement();
      if (panel === 'internal') this.openInternal(this.activeSettlementId);
      else if (panel === 'diplomacy') this.openDiplomacy();
      else if (panel === 'tech') this.openTech();
      else if (panel === 'military') this.openMilitary();
      else if (panel === 'chronicle') this.openChronicle();
      else if (panel === 'help') this.openHelp();
      else if (panel === 'settings') this.openSettings();
      this.setNavActive(panel === 'build' ? 'build' : panel);
    }

    setNavActive(panel) {
      $$('.nav-btn', this.refs.nav).forEach((b) => b.classList.toggle('active', b.dataset.panel === panel));
    }

    // =========================================================
    // HUD
    // =========================================================
    buildResourceBar() {
      const groups = [
        { cls: 'basic', label: '民生', keys: ['food', 'wood', 'stone'] },
        { cls: 'ores', label: '矿脉', keys: ['ironOre', 'goldOre', 'silverOre'] },
        { cls: 'rares', label: '奇珍', keys: ['herb', 'leather'] },
        { cls: 'refined', label: '财富', keys: ['iron', 'gold', 'silver', 'coin'] }
      ];
      let html = '';
      groups.forEach((g, gi) => {
        html += `<div class="res-group ${g.cls}">
          <div class="res-group-name">${g.label}</div>
          <div class="res-chips">` + g.keys.map((k) => `
          <div class="resource-chip" data-res="${k}">
            ${resIcon(k, 17)}
            <span class="res-text"><span class="res-value" data-res-val="${k}">—</span><span class="res-name">${D.RES[k].name}</span></span>
          </div>`).join('') + `</div></div>`;
      });
      this.refs.resourceBar.innerHTML = html;
    }

    updateHUD(force) {
      if (!this.game) return;
      const now = performance.now();
      if (!force && now - this.lastHud < 180) return;
      this.lastHud = now;
      const g = this.game;
      const p = g.player;
      if (!p) return;
      const active = g.getSettlement(this.activeSettlementId) || g.ownedSettlements(p.id)[0];
      if (active) this.activeSettlementId = active.id;
      this.refs.realmName.textContent = D.realmFullName(p);
      const pop = g.livingPopulation(p.id);
      const cap = g.factionPopCap(p.id);
      this.refs.realmSub.innerHTML = `<span>${D.RANK_NAMES[p.rank] || '流亡'}</span><span class="sep">·</span><span>人口 ${pop}/${cap}</span>` +
        (active ? `<span class="sep">·</span><span class="active-realm">本城：${esc(active.name)}</span>` : '');
      this.refs.date.textContent = U.dateLabel(g.timeDays, true);
      this.refs.day.textContent = '第 ' + U.timeToDate(g.timeDays).day + ' 日';
      if (active) {
        const caps = g.getStorageCaps(active);
        $$('[data-res-val]', this.refs.resourceBar).forEach((el) => {
          const k = el.dataset.resVal;
          const v = active.resources[k] || 0;
          const capV = caps[k] || 1;
          el.textContent = fmt(v);
          el.title = `${D.RES[k].name} ${fmt(v, 1)} / ${fmt(capV)}`;
          el.classList.toggle('full', v >= capV - 0.01);
          el.classList.toggle('low', v < capV * 0.1);
        });
      }
      $$('.speed-btn').forEach((b) => b.classList.toggle('active', Math.abs(parseFloat(b.dataset.speed) - this.app.speed) < 0.01));
      this.refs.paused.classList.toggle('hidden', this.app.speed !== 0);
      this.refs.waiting.classList.toggle('hidden', !g.pendingPrompts.some((pr) => pr.pause));
      this.refs.unread.textContent = this.unread;
      this.refs.unread.classList.toggle('hidden', this.unread <= 0);
      if (active) this.refs.minimapCoord.textContent = `${Math.round(active.x)}, ${Math.round(active.y)}`;
      this.refreshAdviser();
      this.updateSelectionBarValues();
    }

    drawCrest() {
      if (!this.game || !this.game.player) return;
      this.renderer.drawCrestToCanvas(this.refs.crest, this.game.player);
    }

    refreshAdviser() {
      if (!this.game) { this.refs.adviser.classList.add('hidden'); return; }
      if (!this.game.settings.tutorial) { this.refs.adviser.classList.add('hidden'); return; }
      this.refs.adviser.classList.remove('hidden');
      const state = this.game.tutorialState();
      this.refs.adviserCount.textContent = `${state.completed}/${state.total}`;
      this.refs.adviserProgress.style.width = `${(state.completed / Math.max(1, state.total)) * 100}%`;
      const next = state.list.find((s) => !s.done);
      if (next) {
        const el = this.refs.adviser.querySelector('.advice-title');
        const tx = this.refs.adviser.querySelector('.advice-text');
        if (el) el.textContent = next.title;
        if (tx) tx.textContent = next.hint;
      } else {
        const el = this.refs.adviser.querySelector('.advice-title');
        const tx = this.refs.adviser.querySelector('.advice-text');
        if (el) el.textContent = '王室的谕令已经全部完成';
        if (tx) tx.textContent = '继续书写你的编年史吧。世界仍在等待。';
      }
    }

    onTutorialStep(step) {
      if (!step) return;
      this.refreshAdviser();
      this.toastTutorial(`谕令完成：${step.title}`, step.hint);
      this.app.audio?.sfx('complete', { volume: .55 });
    }

    toastTutorial(title, text) {
      const div = document.createElement('div');
      div.className = 'tutorial-toast';
      div.innerHTML = `<div class="eyebrow">ROYAL COMMISSION · 王室谕令</div><h4 style="margin:8px 0 5px;font-family:var(--font-title);font-weight:400;font-size:20px;letter-spacing:.08em;">${esc(title)}</h4><p style="margin:0;font-size:12px;line-height:1.7;color:rgba(75,60,38,.7)">${esc(text || '')}</p>`;
      this.refs.tutorialToast.appendChild(div);
      setTimeout(() => { div.style.transition = 'opacity .6s'; div.style.opacity = '0'; setTimeout(() => div.remove(), 650); }, 5200);
    }

    onNotice(n) {
      if (!n) return;
      if (n.type === 'world' && !n.important) return;
      if (n.important || !['world'].includes(n.type)) this.showToast(n);
      this.unread++;
    }

    showToast(n) {
      if (!this.refs.toast) return;
      const div = document.createElement('div');
      div.className = 'toast ' + (n.type || 'info');
      div.textContent = n.text;
      this.refs.toast.appendChild(div);
      while (this.refs.toast.children.length > 4) this.refs.toast.firstElementChild.remove();
      const life = n.important ? 8000 : 5200;
      setTimeout(() => {
        div.classList.add('leaving');
        setTimeout(() => div.remove(), 450);
      }, life);
    }

    showSubToast(text) {
      this.showToast({ text, type: 'info' });
    }

    onCrisis(kind, data) {
      if (kind === 'independence') {
        this.showToast({ text: `「${data.settlement.name}」宣布独立，成为新的 AI 阵营。`, type: 'danger', important: true });
      } else if (kind === 'lostSettlement') {
        this.showToast({ text: `「${data.settlement.name}」被${D.realmFullName(data.attacker)}攻陷。`, type: 'danger', important: true });
      }
    }

    // =========================================================
    // Tooltips
    // =========================================================
    showTooltip(html, x, y) {
      const tt = this.refs.tooltip;
      tt.innerHTML = html;
      tt.classList.remove('hidden');
      const rect = tt.getBoundingClientRect();
      let px = x + 16, py = y + 14;
      if (px + rect.width > window.innerWidth - 10) px = x - rect.width - 16;
      if (py + rect.height > window.innerHeight - 10) py = y - rect.height - 14;
      tt.style.left = Math.max(8, px) + 'px';
      tt.style.top = Math.max(8, py) + 'px';
    }
    hideTooltip() { this.refs.tooltip.classList.add('hidden'); }

    onResourceHover(e) {
      const chip = e.target.closest('.resource-chip');
      if (!chip || !this.game) return;
      const k = chip.dataset.res;
      const s = this.game.getSettlement(this.activeSettlementId);
      if (!s) return;
      const cap = this.game.getStorageCaps(s)[k];
      const value = s.resources[k] || 0;
      const meta = D.RES[k];
      let extra = '';
      if (k === 'coin') extra = '用于外交、救助金与雇佣商人。';
      if (['ironOre', 'goldOre', 'silverOre'].includes(k)) extra = '需在冶炼厂加工后才能使用。';
      if (['iron', 'gold', 'silver'].includes(k)) extra = '由冶炼厂加工矿脉获得。';
      this.showTooltip(`<div class="tt-title">${meta.name}</div><div class="tt-row"><span>储量</span><b>${fmt(value, 1)} / ${fmt(cap)}</b></div><div class="tt-desc">仅可在「${esc(s.name)}」内使用。${extra}</div>`, e.clientX, e.clientY);
    }

    onBuildHover(e) {
      const card = e.target.closest('.build-card');
      if (!card || !this.game) return;
      const def = D.BUILD[card.dataset.build];
      const s = this.game.getSettlement(this.activeSettlementId);
      if (!def || !s) return;
      const level = WW.levelForPlacement(def, s);
      const cost = D.buildingCost(def, level);
      const costText = cost ? Object.entries(cost).filter(([, v]) => v).map(([k, v]) => `${D.RES[k].name} ${v}`).join(' · ') : '——';
      this.showTooltip(`<div class="tt-title">${D.buildingName(def, level)}</div>
        <div class="tt-row"><span>阶段</span><b>${D.STAGE_NAMES[def.minLevel] || '村庄'}起</b></div>
        <div class="tt-row"><span>工期</span><b>${D.buildingDays(def, level)} 人·日</b></div>
        <div class="tt-row"><span>造价</span><b>${costText}</b></div>
        <div class="tt-desc">${esc(def.desc)}</div>
        ${def.effect ? `<div class="tt-desc tt-gold">${esc(def.effect)}</div>` : ''}`, e.clientX, e.clientY);
    }

    onHoverEntity(info, e) {
      if (!this.game) return;
      let html = '';
      if (info.kind === 'unit' || info.kind === 'ship') {
        const u = this.game.getUnit(info.id);
        if (!u) return;
        const f = this.game.getFaction(u.owner);
        const status = stateLabels[u.state] || u.state;
        html = `<div class="tt-title">${u.def.name}</div><div class="tt-row"><span>${f ? D.realmFullName(f) : '无主'}</span><span>${status}</span></div>
          <div class="tt-row"><span>生命</span><b>${Math.ceil(u.hp)} / ${u.maxHp}</b></div>`;
        if (u.def.military) html += `<div class="tt-row"><span>攻击 / 护甲</span><b>${u.def.atk} / ${u.def.def}</b></div>`;
        if (u.kind === 'merchant') html += `<div class="tt-row"><span>货物</span><b>${Math.floor(this.game.getMerchantCargoTotal(u))} / ${u.cargoCapacity}</b></div>`;
        html += `<div class="tt-desc">${esc(u.def.desc || '')}</div>`;
      } else if (info.kind === 'building') {
        const b = this.game.getBuilding(info.id);
        if (!b) return;
        const f = this.game.getFaction(b.owner);
        const status = !b.complete ? (b.converting ? '改建中' : '建造中') : b.upgrade ? '升级中' : '已完工';
        html = `<div class="tt-title">${D.buildingName(b.def, b.level)}</div><div class="tt-row"><span>${f ? D.realmFullName(f) : '无主'}</span><span>${status}</span></div>
          <div class="tt-row"><span>耐久</span><b>${Math.ceil(b.hp)} / ${b.maxHp}</b></div><div class="tt-desc">${esc(b.def.desc)}</div>`;
        if (b.defId === 'gate') html += `<div class="tt-desc ${b.open ? 'tt-green' : 'tt-red'}">大门${b.open ? '开启，单位可通过' : '关闭，阻挡通行'}</div>`;
      } else if (info.kind === 'node') {
        const n = this.game.world.nodes.find((x) => x.id === info.id);
        if (!n) return;
        const meta = D.NODES[n.type];
        html = `<div class="tt-title">${meta.name}</div><div class="tt-row"><span>资源</span><b>${fmt(n.amount)} / ${n.max} ${D.RES[meta.resource].name}</b></div>
          <div class="tt-row"><span>每日再生</span><b>${U.round(n.max * meta.regen * (n.regenMul || 1), 1)}</b></div>
          ${n.gatherBoost > 1 ? `<div class="tt-row"><span>采集加速</span><b class="tt-green">×${n.gatherBoost.toFixed(2)}</b></div>` : ''}
          <div class="tt-desc">${esc(meta.desc)}</div>`;
      } else if (info.kind === 'tile') {
        const td = this.game.world.terrainDef(info.x, info.y);
        if (!td) return;
        html = `<div class="tt-title">${td.name}</div><div class="tt-desc">${esc(td.effect)}</div>`;
      }
      if (html) this.showTooltip(html, e.clientX, e.clientY);
    }

    // =========================================================
    // Canvas interaction
    // =========================================================
    _evPos(e) {
      const r = this.app.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, clientX: e.clientX, clientY: e.clientY };
    }

    onCanvasPointerDown(e) {
      if (!this.game) return;
      const pos = this._evPos(e);
      this.pointer = pos;
      if (e.button === 1 || (e.button === 0 && (e.altKey))) {
        this.cameraDrag = { x: pos.x, y: pos.y };
        this.app.canvas.setPointerCapture?.(e.pointerId);
        this.app.canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button === 2) {
        if (this.placement) { this.cancelPlacement(); return; }
        const info = this.renderer.entityAt(pos.x, pos.y);
        this.issueCommand(info);
        return;
      }
      if (e.button !== 0) return;
      if (this.placement) {
        if (this.placement.mode === 'line') {
          const t = this.renderer.screenToTile(pos.x, pos.y);
          this.lineDrag = { start: t, end: t };
          this.updateLinePreview(t);
        }
        return;
      }
      this.drag = { sx: pos.x, sy: pos.y, x: pos.x, y: pos.y, add: e.shiftKey, moved: false };
      this.app.canvas.setPointerCapture?.(e.pointerId);
    }

    onCanvasPointerMove(e) {
      if (!this.game) return;
      const pos = this._evPos(e);
      this.pointer = pos;
      if (this.cameraDrag) {
        const dx = pos.x - this.cameraDrag.x, dy = pos.y - this.cameraDrag.y;
        this.renderer.panByPixels(dx, dy);
        this.cameraDrag = { x: pos.x, y: pos.y };
        this.app.canvas.style.cursor = 'grabbing';
        return;
      }
      if (this.placement) {
        if (this.placement.mode === 'line' && this.lineDrag) {
          const t = this.renderer.screenToTile(pos.x, pos.y);
          this.lineDrag.end = t;
          this.updateLinePreview(t);
        } else {
          this.updatePlacementPreview(pos);
        }
        return;
      }
      if (this.drag) {
        this.drag.x = pos.x; this.drag.y = pos.y;
        if (Math.abs(pos.x - this.drag.sx) + Math.abs(pos.y - this.drag.sy) > 5) this.drag.moved = true;
        if (this.drag.moved) {
          this.renderer.selectionRect = {
            x: Math.min(this.drag.sx, pos.x), y: Math.min(this.drag.sy, pos.y),
            w: Math.abs(pos.x - this.drag.sx), h: Math.abs(pos.y - this.drag.sy)
          };
          this.refs.tooltip.classList.add('hidden');
        }
        return;
      }
      const info = this.renderer.entityAt(pos.x, pos.y);
      this.renderer.hover = info;
      const key = info ? `${info.kind}:${info.id || info.x + ',' + info.y}` : '';
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        if (info) this.onHoverEntity(info, { clientX: e.clientX, clientY: e.clientY });
        else this.hideTooltip();
      } else if (info) {
        const tt = this.refs.tooltip;
        // reposition the current tooltip without rebuilding it
        if (!tt.classList.contains('hidden')) {
          // no-op; position is fine while user moves within same object
        }
      }
      this.app.canvas.style.cursor = info && info.kind !== 'tile' ? 'pointer' : 'default';
    }

    onCanvasPointerUp(e) {
      if (!this.game) return;
      const pos = this._evPos(e);
      if (this.cameraDrag) {
        this.cameraDrag = null;
        this.app.canvas.style.cursor = this.placement ? 'crosshair' : 'default';
        return;
      }
      if (this.placement) {
        if (this.placement.mode === 'line') {
          if (this.lineDrag) {
            this.commitLine();
            this.lineDrag = null;
          }
        } else if (e.button === 0) {
          this.commitPlacement();
        }
        return;
      }
      if (this.drag) {
        const d = this.drag;
        this.drag = null;
        this.renderer.selectionRect = null;
        if (d.moved) {
          this.selectInRect({ x: Math.min(d.sx, pos.x), y: Math.min(d.sy, pos.y), w: Math.abs(pos.x - d.sx), h: Math.abs(pos.y - d.sy) }, d.add);
          return;
        }
        const info = this.renderer.entityAt(pos.x, pos.y);
        this.handleClick(info, { shift: e.shiftKey, ctrl: e.ctrlKey });
      }
    }

    onCanvasDoubleClick(e) {
      if (!this.game || this.placement) return;
      const pos = this._evPos(e);
      const info = this.renderer.entityAt(pos.x, pos.y);
      if (!info || (info.kind !== 'unit' && info.kind !== 'ship')) return;
      const clicked = this.game.getUnit(info.id);
      if (!clicked || clicked.owner !== this.game.playerFactionId) return;
      const ids = this.game.units.filter((u) => !u.dead && u.owner === clicked.owner && u.kind === clicked.kind && u.state !== 'inside' && u.state !== 'aboard').map((u) => u.id);
      this.selectUnits(ids, e.shiftKey);
    }

    onCanvasWheel(e) {
      if (!this.game) return;
      e.preventDefault();
      const pos = this._evPos(e);
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      this.renderer.zoomAt(pos.x, pos.y, factor);
    }

    onMinimapPointer(e) {
      if (!this.game) return;
      const w = this.renderer.minimapToWorld(e.clientX, e.clientY);
      if (!w) return;
      this.renderer.focus(w.x, w.y);
      this.refs.minimapCoord.textContent = `${Math.round(w.x)}, ${Math.round(w.y)}`;
      this.refs.tooltip.classList.add('hidden');
    }

    // =========================================================
    // Selection
    // =========================================================
    applySelectionToRenderer() {
      this.renderer.selection = {
        unitIds: this.selection.unitIds.slice(),
        buildingId: this.selection.buildingId,
        nodeId: this.selection.nodeId,
        settlementId: this.selection.settlementId
      };
    }

    handleClick(info, mods) {
      if (!info) { this.clearSelection(); return; }
      if (info.kind === 'unit' || info.kind === 'ship') {
        const u = this.game.getUnit(info.id);
        if (!u) return;
        if (u.owner !== this.game.playerFactionId) {
          this.selection.unitIds = [];
          this.selection.buildingId = null;
          this.selection.nodeId = null;
          this.selection.settlementId = u.homeSettlement;
          this.inspectedUnitId = u.id;
          this.applySelectionToRenderer();
          this.openUnitDrawer(u);
          this.updateSelectionUI();
          return;
        }
        this.inspectedUnitId = null;
        this.selection.buildingId = null;
        this.selection.nodeId = null;
        this.selection.settlementId = u.homeSettlement;
        if (mods.shift || mods.ctrl) {
          const idx = this.selection.unitIds.indexOf(u.id);
          if (idx >= 0) this.selection.unitIds.splice(idx, 1); else this.selection.unitIds.push(u.id);
          this.applySelectionToRenderer();
          this.updateSelectionUI();
          if (this.selection.unitIds.length === 1) this.openUnitDrawer(this.game.getUnit(this.selection.unitIds[0]));
          else this.closeDrawer();
        } else {
          this.selectUnits([u.id], false);
        }
      } else if (info.kind === 'building') {
        const b = this.game.getBuilding(info.id);
        if (!b) return;
        this.selection.unitIds = [];
        this.inspectedUnitId = null;
        this.selection.nodeId = null;
        this.selection.buildingId = b.id;
        this.selection.settlementId = b.settlementId;
        if (b.owner === this.game.playerFactionId && b.settlementId) this.activeSettlementId = b.settlementId;
        this.applySelectionToRenderer();
        this.updateSelectionUI();
        this.openBuildingDrawer(b);
        if (this.refs.buildPanel.classList.contains('hidden') === false) this.refreshBuildPanel();
      } else if (info.kind === 'node') {
        this.selection.unitIds = [];
        this.inspectedUnitId = null;
        this.selection.buildingId = null;
        this.selection.nodeId = info.id;
        this.applySelectionToRenderer();
        this.updateSelectionUI();
        this.openNodeDrawer(this.game.world.nodes.find((n) => n.id === info.id));
      } else {
        this.clearSelection();
      }
    }

    selectInRect(rect, add) {
      const selected = add ? new Set(this.selection.unitIds) : new Set();
      for (const u of this.game.units) {
        if (u.dead || u.owner !== this.game.playerFactionId) continue;
        if (u.state === 'inside' || u.state === 'aboard' || u.state === 'patient') continue;
        const p = this.renderer.worldToScreen(u.x, u.y);
        if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) selected.add(u.id);
      }
      if (!selected.size) { if (!add) this.clearSelection(); return; }
      this.selectUnits(Array.from(selected), false);
    }

    selectUnits(ids, additive) {
      const valid = (ids || []).filter((id) => {
        const u = this.game.getUnit(id);
        return u && !u.dead && u.owner === this.game.playerFactionId;
      });
      this.inspectedUnitId = null;
      this.selection.buildingId = null;
      this.selection.nodeId = null;
      if (additive) {
        const set = new Set(this.selection.unitIds);
        valid.forEach((id) => set.has(id) ? set.delete(id) : set.add(id));
        this.selection.unitIds = Array.from(set);
      } else this.selection.unitIds = valid;
      if (this.selection.unitIds.length && this.selection.unitIds.length <= 1) {
        const u = this.game.getUnit(this.selection.unitIds[0]);
        this.selection.settlementId = u ? u.homeSettlement : this.selection.settlementId;
      }
      this.applySelectionToRenderer();
      this.updateSelectionUI();
      if (this.selection.unitIds.length === 1) this.openUnitDrawer(this.game.getUnit(this.selection.unitIds[0]));
      else this.closeDrawer();
    }

    clearSelection() {
      this.selection = { unitIds: [], buildingId: null, nodeId: null, settlementId: null };
      this.inspectedUnitId = null;
      this.applySelectionToRenderer();
      this.updateSelectionUI();
      this.closeDrawer();
    }

    updateSelectionUI() {
      const g = this.game;
      if (!g) return;
      const ids = this.selection.unitIds;
      if ((!ids || !ids.length) && !this.inspectedUnitId) {
        this.refs.selectionBar.classList.add('hidden');
        this.refs.selectionCards.innerHTML = '';
        this.refs.selectionActions.innerHTML = '';
        document.body.classList.remove('unit-selection-active');
        return;
      }
      if (this.inspectedUnitId) {
        this.refs.selectionBar.classList.add('hidden');
        document.body.classList.remove('unit-selection-active');
        return;
      }
      const units = ids.map((id) => g.getUnit(id)).filter((u) => u && !u.dead);
      if (!units.length) {
        this.refs.selectionBar.classList.add('hidden');
        document.body.classList.remove('unit-selection-active');
        return;
      }
      this.refs.selectionBar.classList.remove('hidden');
      this.refs.zoomHint.classList.add('fade');
      document.body.classList.add('unit-selection-active');
      const shown = units.slice(0, 7);
      let html = shown.map((u) => {
        const f = g.getFaction(u.owner);
        const pct = U.clamp(u.hp / u.maxHp, 0, 1) * 100;
        return `<div class="unit-card ${units.length === 1 ? 'active' : ''}" data-unit-id="${u.id}">
          <div class="portrait"><canvas width="88" height="62" data-unit-portrait="${u.id}"></canvas></div>
          <div class="u-name">${esc(u.def.name)}</div>
          <div class="u-kind">${stateLabels[u.state] || u.state}</div>
          <div class="u-hp"><i style="width:${pct}%"></i></div>
        </div>`;
      }).join('');
      if (units.length > shown.length) html += `<div class="unit-card"><div class="u-kind" style="margin-top:6px">还有 ${units.length - shown.length} 个单位</div></div>`;
      this.refs.selectionCards.innerHTML = html;
      $$('[data-unit-portrait]', this.refs.selectionCards).forEach((cv) => {
        const u = g.getUnit(cv.dataset.unitPortrait);
        if (u) this.renderer.drawUnitIcon(cv, u, g.getFaction(u.owner));
      });
      const hasResident = units.some((u) => u.kind === 'resident');
      const hasMerchant = units.some((u) => u.kind === 'merchant');
      const ships = units.filter((u) => u.isShip);
      let actions = `
        <button class="cmd-btn" data-cmd="stop">${icon('pause')}<span>停止</span></button>
        <button class="cmd-btn" data-cmd="focus">${icon('focus')}<span>定位</span></button>`;
      if (hasResident) actions += `<button class="cmd-btn" data-cmd="builder">${icon('hammer')}<span>转为建筑工</span></button>`;
      if (hasMerchant) actions += `<button class="cmd-btn" data-cmd="merchant">${icon('coin')}<span>商人货物</span></button>`;
      if (ships.length) actions += `<button class="cmd-btn" data-cmd="unload">${icon('people')}<span>登陆</span></button>`;
      actions += `<button class="cmd-btn" data-cmd="more">${icon('scroll')}<span>详情</span></button>`;
      this.refs.selectionActions.innerHTML = actions + `<div class="selection-note">右键点击地面移动，点击目标下达命令。<br>中键拖动视野 · 滚轮缩放</div>`;
    }

    updateSelectionBarValues() {
      if (!this.game || !this.selection.unitIds.length) return;
      const now = performance.now();
      if (now - this.lastSelection < 250) return;
      this.lastSelection = now;
      for (const id of this.selection.unitIds) {
        const u = this.game.getUnit(id);
        const card = this.refs.selectionCards.querySelector(`[data-unit-id="${id}"]`);
        if (!u || !card) continue;
        const bar = card.querySelector('.u-hp i');
        if (bar) bar.style.width = U.clamp(u.hp / u.maxHp, 0, 1) * 100 + '%';
        const kind = card.querySelector('.u-kind');
        if (kind) kind.textContent = stateLabels[u.state] || u.state;
      }
    }

    onSelectionClick(e) {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      const units = this.selection.unitIds.map((id) => this.game.getUnit(id)).filter(Boolean);
      if (!units.length) return;
      if (cmd === 'stop') {
        const r = this.game.stopUnits(units.map((u) => u.id));
        if (r.ok) this.showSubToast('部队已停止当前行动。');
      } else if (cmd === 'focus') {
        const u = units[0];
        this.renderer.focus(u.x, u.y);
      } else if (cmd === 'builder') {
        this.confirmConvertBuilders(units.filter((u) => u.kind === 'resident'));
      } else if (cmd === 'merchant') {
        const m = units.find((u) => u.kind === 'merchant');
        if (m) this.openUnitDrawer(m, 'cargo');
      } else if (cmd === 'unload') {
        const ship = units.find((u) => u.isShip);
        if (ship) this.tryUnloadShip(ship);
      } else if (cmd === 'more') {
        if (units.length === 1) this.openUnitDrawer(units[0], 'detail');
        else this.openArmySelection();
      }
    }

    // =========================================================
    // Drawer
    // =========================================================
    closeDrawer() {
      this.refs.drawer.classList.add('hidden');
      this.refs.drawer.innerHTML = '';
    }
    openDrawer(html) {
      const oldScroll = this.refs.drawer.scrollTop;
      this.refs.drawer.innerHTML = html;
      this.refs.drawer.classList.remove('hidden');
      this.refs.drawer.scrollTop = oldScroll;
      this.hideTooltip();
      this.lastDrawer = performance.now();
      const b = this.selection.buildingId ? this.game.getBuilding(this.selection.buildingId) : null;
      if (b) {
        $$('[data-building-icon]', this.refs.drawer).forEach((cv) => this.renderer.drawBuildingIcon(cv, b.defId, b.level, this.game.getFaction(b.owner)));
      }
      const u = this.inspectedUnitId ? this.game.getUnit(this.inspectedUnitId) : (this.selection.unitIds.length === 1 ? this.game.getUnit(this.selection.unitIds[0]) : null);
      if (u) {
        $$('[data-unit-portrait]', this.refs.drawer).forEach((cv) => this.renderer.drawUnitIcon(cv, u, this.game.getFaction(u.owner)));
      }
    }

    openBuildingDrawer(b, onlyTab) {
      if (!b) return;
      const g = this.game;
      const s = g.getSettlement(b.settlementId);
      if (b.owner === g.playerFactionId && s) this.activeSettlementId = s.id;
      const f = g.getFaction(b.owner);
      const isOwner = b.owner === g.playerFactionId;
      const name = D.buildingName(b.def, b.level);
      const slots = D.buildingSlots(b.def, b.level);
      const workers = (b.workers || []).map((id) => g.getUnit(id)).filter(Boolean);
      const status = !b.complete ? (b.converting ? '改建中' : '建造中') : b.upgrade ? '升级中' : '已完工';
      let body = `<div class="drawer-body">`;
      body += `<div class="stat-line"><span class="k">状态</span><span class="v ${b.hp < b.maxHp * .4 ? 'bad' : ''}">${status}</span></div>`;
      body += `<div class="stat-line"><span class="k">所属</span><span class="v">${f ? esc(D.realmFullName(f)) : '无主'} · ${s ? esc(s.name) : '野外工程'}</span></div>`;
      if (b.maxHp > 0) {
        body += `<div class="meter-row"><div class="meter-label"><span>耐久</span><span>${Math.ceil(b.hp)} / ${b.maxHp}</span></div><div class="meter hp"><i style="width:${U.clamp(b.hp / b.maxHp, 0, 1) * 100}%"></i></div></div>`;
      }
      if (!b.complete || b.upgrade || b.converting) {
        const pct = U.clamp((b.buildProgress || 0) / Math.max(0.001, b.buildRequired || 1), 0, 1);
        body += `<div class="meter-row"><div class="meter-label"><span>${b.converting ? '改建进度' : b.upgrade ? '升级进度' : '建造进度'}</span><span>${Math.floor(pct * 100)}% · ${(b.constructors || []).length} 名工匠</span></div><div class="meter"><i style="width:${pct * 100}%"></i></div></div>`;
        if (isOwner) body += `<div class="action-row"><button class="action-btn" data-act="add-constructor">${icon('hammer')}派遣空闲工匠</button></div>`;
      }
      body += `<p class="description" style="margin-top:10px">${esc(b.def.desc)}</p>`;
      if (b.def.effect) body += `<div class="effect-line">${esc(b.def.effect)}</div>`;
      if (b.complete && !b.dead) {
        const prod = g.getBuildingProductionInfo(b);
        if (prod.length) {
          body += `<div class="drawer-section"><h4>当前产出 · 根据派驻工人</h4>`;
          for (const p of prod) {
            body += `<div class="stat-line"><span class="k">${esc(p.label)}</span><span class="v ${p.rate > 0 ? 'good' : ''}">${p.rate > 0 ? '+' + U.round(p.rate, 2) + ' / 日' : '未生产'}</span></div>`;
            if (p.note) body += `<div class="cooldown-note">${esc(p.note)}</div>`;
          }
          if ((b.defId === 'lumber' || b.defId === 'gatherer') && slots > 0) body += `<div class="cooldown-note">派入更多工人可提高产量与附近资源再生速度。</div>`;
          body += `</div>`;
        }
      }
      if (isOwner && b.complete && !b.upgrade && b.defId !== 'road' && b.defId !== 'bridge' && b.defId !== 'tunnel') {
        const up = g.getUpgradeInfo(b);
        body += `<div class="drawer-section"><h4>升级</h4>`;
        if (up.ok) {
          body += `<div class="stat-line"><span class="k">目标</span><span class="v">${esc(up.name)}</span></div>
            <div class="stat-line"><span class="k">工期</span><span class="v">${up.days} 人·日</span></div>
            <div class="cost-chips">${this.costHtml(up.cost, s)}</div>
            <div class="action-row"><button class="action-btn primary" data-act="upgrade-building">升级并派遣工匠</button></div>`;
        } else {
          body += `<div class="stat-line"><span class="k">条件</span><span class="v ${up.error === '资源不足' ? 'bad' : ''}">${esc(up.error)}</span></div>`;
          if (up.cost) body += `<div class="cost-chips">${this.costHtml(up.cost, s)}</div>`;
        }
        body += `</div>`;
      }
      if (b.defId === 'wall' && isOwner && b.complete && !b.upgrade) {
        body += `<div class="drawer-section"><h4>防御工程</h4><p class="description">围墙可以改建为同阶段的大门。改建不需要资源，但需要工匠施工；大门可以开启或关闭。</p><div class="action-row"><button class="action-btn" data-act="convert-gate">${icon('build')}改建为大门</button></div></div>`;
      }
      if (b.defId === 'gate' && isOwner && b.complete) {
        body += `<div class="drawer-section"><h4>大门控制</h4><div class="stat-line"><span class="k">当前状态</span><span class="v ${b.open ? 'good' : 'bad'}">${b.open ? '开启 · 单位可通过' : '关闭 · 阻挡通行'}</span></div><div class="action-row"><button class="action-btn primary" data-act="toggle-gate">${b.open ? '关闭大门' : '开启大门'}</button></div></div>`;
      }
      if (b.complete && slots > 0) {
        body += `<div class="drawer-section"><h4>劳工 · ${workers.length}/${slots}</h4>`;
        if (workers.length) {
          body += `<div class="worker-list">` + workers.map((u) => `<span class="worker-chip">${esc(u.def.name)} <span style="opacity:.5">${u.kind === 'resident' ? '居民' : u.kind === 'builder' ? '建筑工' : ''}</span>${isOwner ? `<button data-act="remove-worker" data-unit="${u.id}" title="让工人离开">×</button>` : ''}</span>`).join('') + `</div>`;
        } else body += `<div class="empty-note">尚无工人进入，建筑不会产出资源。</div>`;
        if (isOwner) {
          body += `<div class="action-row"><button class="action-btn" data-act="add-worker">派遣居民</button><button class="action-btn" data-act="fill-workers">补满工人</button></div>`;
        }
        body += `</div>`;
        if (b.defId === 'smelter') {
          const recipe = b.recipe || 'iron';
          body += `<div class="drawer-section"><h4>冶炼配方</h4><div class="recipe-options">
            <button class="recipe-btn ${recipe === 'iron' ? 'active' : ''}" data-act="set-recipe" data-recipe="iron">铁矿 → 铁</button>
            <button class="recipe-btn ${recipe === 'silver' ? 'active' : ''}" data-act="set-recipe" data-recipe="silver">银矿 → 银</button>
            <button class="recipe-btn ${recipe === 'gold' ? 'active' : ''}" data-act="set-recipe" data-recipe="gold">金矿 → 金</button></div></div>`;
        }
      }
      if (b.complete && b.defId === 'market' && isOwner) {
        const cap = g.merchantCapacity(b.owner, b);
        body += `<div class="drawer-section"><h4>集市贸易</h4><div class="stat-line"><span class="k">商人载货上限</span><span class="v">${cap}</span></div><div class="stat-line"><span class="k">过路税</span><span class="v">${D.RES.coin.name} ${U.round(b.def.toll[b.level], 2)} / 日</span></div>
          <p class="description">雇佣商人后可手动装载本地资源，或与外国集市交换。贸易协定由外交界面发起。</p>
          <div class="action-row"><button class="action-btn" data-act="hire-merchant">雇佣商人 <small>18 食物 · 12 银币</small></button></div></div>`;
      }
      if (b.complete && b.defId === 'tavern' && isOwner) {
        body += `<div class="drawer-section"><h4>酒馆营业</h4><div class="stat-line"><span class="k">稳定度加成</span><span class="v good">+${b.def.stability[b.level]}</span></div><div class="stat-line"><span class="k">每日消耗</span><span class="v">${b.def.upkeepFood[b.level]} 食物</span></div><div class="action-row"><button class="action-btn" data-act="toggle-tavern">${b.active ? '打烊' : '开始营业'}</button></div></div>`;
      }
      if (b.complete && b.def.training && isOwner) {
        const units = g.availableUnitsFor(b);
        body += `<div class="drawer-section"><h4>训练</h4>`;
        if (!units.length) body += `<div class="empty-note">更高级的兵种会随着定居点阶段解锁。</div>`;
        else {
          body += `<div class="training-list">` + units.map((kind) => {
            const ud = D.UNITS[kind];
            return `<div class="training-item"><span class="tr-name">${ud.name}</span><span class="tr-cost">${Object.entries(ud.trainCost).map(([k, v]) => `${D.RES[k].short}${v}`).join(' · ')} · ${ud.trainDays}日</span><button class="mini-btn" data-act="train" data-kind="${kind}">训练</button></div>`;
          }).join('') + `</div>`;
        }
        if (b.trainingQueue.length) {
          body += `<div class="queue-list">` + b.trainingQueue.map((q, i) => {
            const ud = D.UNITS[q.kind];
            return `<div class="queue-item"><div class="queue-top"><span>${ud.name}</span><span>${Math.floor((q.progress || 0) / Math.max(.1, q.days) * 100)}%</span></div><div class="meter"><i style="width:${U.clamp((q.progress || 0) / Math.max(.1, q.days), 0, 1) * 100}%"></i></div></div>`;
          }).join('') + `</div>`;
        }
        body += `</div>`;
      }
      if (b.complete && b.def.researchTier && isOwner) {
        const tierName = ['', '图书馆', '大学', '皇家大学'][b.def.researchTier];
        body += `<div class="drawer-section"><h4>学术研究</h4><p class="description">派驻居民到此建筑后，他们将协助研究 ${U.cnNum(b.def.researchTier)} 级科技。基础研究速度缓慢，更多学者会加快进度。</p><div class="action-row"><button class="action-btn" data-act="open-tech">前往科技页面</button></div></div>`;
      }
      if (b.complete && b.defId === 'clinic' && isOwner) {
        const patients = (b.patients || []).map((id) => g.getUnit(id)).filter(Boolean);
        body += `<div class="drawer-section"><h4>诊所病床 · ${patients.length}/${b.def.patientCap[b.level]}</h4>`;
        if (patients.length) body += patients.map((u) => `<div class="stat-line"><span class="k">${u.def.name}</span><span class="v">${Math.ceil(u.hp)} / ${u.maxHp}</span></div>`).join('');
        else body += `<div class="empty-note">受伤的士兵可以进入诊所接受治疗。</div>`;
        body += `</div>`;
      }
      if (b.complete && isOwner && b.hp < b.maxHp - 0.5) {
        body += `<div class="drawer-section"><h4>维修</h4><div class="action-row"><button class="action-btn" data-act="repair-building">派遣工匠维修</button></div></div>`;
      }
      if (b.defId === 'hall') {
        body += `<div class="drawer-section"><h4>定居点</h4><div class="stat-line"><span class="k">阶段</span><span class="v">${D.STAGE_NAMES[b.level]}</span></div><div class="stat-line"><span class="k">领地半径</span><span class="v">${b.def.radius[b.level]} 格</span></div><div class="stat-line"><span class="k">基础上限</span><span class="v">+${b.def.popBonus[b.level]} 人口</span></div></div>`;
      }
      if (b.owner !== g.playerFactionId) body += `<div class="warning-note">这是${f ? D.realmFullName(f) : '其他势力'}的建筑。你可以查看信息，但不能管理它。</div>`;
      body += `<div class="action-row"><button class="action-btn" data-act="focus-building">定位到地图</button>${isOwner ? `<button class="action-btn" data-act="close-drawer">关闭</button>` : `<button class="action-btn" data-act="close-drawer">关闭</button>`}</div>`;
      body += `</div>`;
      const html = `<div class="drawer-head">
        <div class="drawer-icon"><canvas width="100" height="88" data-building-icon></canvas></div>
        <div class="drawer-title-wrap"><h3>${esc(name)}</h3><div class="drawer-sub"><span>${D.STAGE_NAMES[b.level] || '工程'}</span><span class="sep">·</span><span>${f ? esc(D.realmFullName(f)) : '无主'}</span>${b.def.unique ? `<span class="tag gold">唯一</span>` : ''}</div></div>
        <button class="close-btn" data-act="close-drawer" title="关闭">${icon('close')}</button>
      </div>${body}`;
      this.openDrawer(html);
    }

    openNodeDrawer(node) {
      if (!node) return;
      const g = this.game;
      const info = g.getNodeInfo(node);
      const meta = D.NODES[node.type];
      const selectedResidents = this.selection.unitIds.map((id) => g.getUnit(id)).filter((u) => u && u.kind === 'resident');
      const selectedAny = this.selection.unitIds.length > 0;
      const isGatherable = node.type === 'tree' || node.type === 'berry';
      let body = `<div class="drawer-body">
        <div class="stat-line"><span class="k">资源种类</span><span class="v">${D.RES[meta.resource].name}</span></div>
        <div class="stat-line"><span class="k">剩余储量</span><span class="v">${fmt(info.amount)} / ${info.max}</span></div>
        <div class="meter-row"><div class="meter-label"><span>储量</span><span>${Math.round(U.clamp(node.amount / node.max, 0, 1) * 100)}%</span></div><div class="meter"><i style="width:${U.clamp(node.amount / node.max, 0, 1) * 100}%"></i></div></div>
        <div class="stat-line"><span class="k">每日再生</span><span class="v">${U.round(info.regen, 1)}</span></div>
        <div class="stat-line"><span class="k">附近采集加速</span><span class="v ${info.boost > 1 ? 'good' : ''}">${info.boost > 1 ? '×' + info.boost.toFixed(2) : '无'}</span></div>
        <p class="description" style="margin-top:10px">${esc(meta.desc)}</p>`;
      if (!isGatherable) body += `<div class="effect-line">该矿脉无法被直接采集。你可以在附近建造相应的矿场，并派遣居民进入矿场开采。</div>`;
      if (node.clearing) {
        const pct = node.clearing.required ? U.clamp(node.clearing.progress / node.clearing.required, 0, 1) : 0;
        body += `<div class="drawer-section"><h4>清除作业</h4><div class="meter"><i style="width:${pct * 100}%"></i></div><div class="cooldown-note">${Math.floor(pct * 100)}% · ${node.clearing.units.length} 名居民</div></div>`;
      }
      body += `<div class="drawer-section"><h4>操作</h4>`;
      if (isGatherable) {
        body += `<p class="description">选中居民后右键点击此处可开始持续采集。采集所得会送回最近的村庄大厅或仓库。</p>`;
        body += `<div class="action-row"><button class="action-btn primary" data-act="node-gather" ${selectedResidents.length ? '' : 'disabled'}>派选中居民采集</button></div>`;
        if (!selectedResidents.length) body += `<div class="nearby-note">当前没有选中居民。选择居民后右键点击资源点也能开始采集。</div>`;
      } else {
        body += `<div class="nearby-note">铁矿、金矿、银矿需要在附近建造矿场。石材由采石场无限开采。</div>`;
      }
      body += `<div class="action-row"><button class="action-btn danger" data-act="clear-node" ${selectedAny ? '' : 'disabled'}>清除资源点（不可逆）</button></div>`;
      if (!selectedAny) body += `<div class="nearby-note">需要选中至少一名居民才能清除。资源点清除后无法恢复。</div>`;
      body += `</div>
        <div class="action-row"><button class="action-btn" data-act="focus-node">定位到地图</button><button class="action-btn" data-act="close-drawer">关闭</button></div>
      </div>`;
      const html = `<div class="drawer-head"><div class="drawer-icon" style="font-size:26px;color:#6f7d4d">${resIcon(meta.resource, 34)}</div><div class="drawer-title-wrap"><h3>${esc(meta.name)}</h3><div class="drawer-sub"><span>自然资源点</span><span class="sep">·</span><span>${esc(D.RES[meta.resource].name)}</span></div></div><button class="close-btn" data-act="close-drawer">${icon('close')}</button></div>${body}`;
      this.openDrawer(html);
    }

    openUnitDrawer(u, tab) {
      if (!u) return;
      const g = this.game;
      const f = g.getFaction(u.owner);
      const isOwn = u.owner === g.playerFactionId;
      const status = stateLabels[u.state] || u.state;
      let task = '';
      if (u.task) {
        if (u.task.type === 'gather') task = '采集资源';
        else if (u.task.type === 'clear') task = '清除资源点';
        else if (u.task.type === 'construct') task = '建造建筑';
        else if (u.task.type === 'repair') task = '维修建筑';
        else if (u.task.type === 'enterWork') task = '前往工作地点';
        else if (u.task.type === 'clinic') task = '前往诊所';
        else if (u.task.type === 'board') task = '前往船只';
        else if (u.task.type === 'tradeDeliver') task = '执行贸易运输';
      }
      let body = `<div class="drawer-body">
        <div class="stat-line"><span class="k">阵营</span><span class="v">${f ? esc(D.realmFullName(f)) : '无主'}</span></div>
        <div class="stat-line"><span class="k">状态</span><span class="v">${status}${task ? ' · ' + task : ''}</span></div>
        <div class="meter-row"><div class="meter-label"><span>生命</span><span>${Math.ceil(u.hp)} / ${u.maxHp}</span></div><div class="meter hp"><i style="width:${U.clamp(u.hp / u.maxHp, 0, 1) * 100}%"></i></div></div>`;
      if (u.def.military) {
        body += `<div class="unit-stats">
          <div class="unit-stat"><span>攻击</span><b>${u.def.atk}</b></div>
          <div class="unit-stat"><span>护甲</span><b>${g._unitArmor(u).toFixed(1)}</b></div>
          <div class="unit-stat"><span>射程</span><b>${g._unitRange(u).toFixed(1)}</b></div>
          <div class="unit-stat"><span>速度</span><b>${u.def.speed.toFixed(1)}</b></div>
        </div>`;
      }
      if (u.kind === 'merchant') {
        const total = g.getMerchantCargoTotal(u);
        const market = g.getNearbyMarketForMerchant(u);
        body += `<div class="drawer-section"><h4>商人货舱 · ${Math.floor(total)} / ${u.cargoCapacity}</h4>`;
        const cargoKeys = Object.keys(u.cargo || {}).filter((k) => u.cargo[k] > .01);
        if (cargoKeys.length) body += cargoKeys.map((k) => `<div class="stat-line"><span class="k">${D.RES[k].name}</span><span class="v">${fmt(u.cargo[k], 1)}</span></div>`).join('');
        else body += `<div class="empty-note">货舱空空如也。</div>`;
        body += market ? `<div class="stat-line"><span class="k">当前集市</span><span class="v">${esc(g.getSettlement(market.settlementId).name)}</span></div>` : `<div class="nearby-note">商人必须靠近己方集市才能装货，靠近任意集市才能卸货。</div>`;
        if (isOwn && market && market.owner === u.owner) body += `<div class="action-row"><button class="action-btn primary" data-act="merchant-load">装载本地货物</button><button class="action-btn" data-act="merchant-unload">卸货至集市</button></div>`;
        else if (isOwn && market) body += `<div class="action-row"><button class="action-btn" data-act="merchant-unload">卸货至该集市</button></div>`;
        body += `</div>`;
      }
      if (u.isShip) {
        body += `<div class="drawer-section"><h4>船只</h4><div class="stat-line"><span class="k">载客</span><span class="v">${u.passengers.length} / ${u.def.capacity}</span></div><div class="stat-line"><span class="k">速度</span><span class="v">${u.def.speed.toFixed(1)}</span></div>`;
        if (u.passengers.length) {
          const names = u.passengers.map((id) => g.getUnit(id)).filter(Boolean).map((p) => p.def.name).join('、');
          body += `<p class="description">乘客：${esc(names)}</p><div class="action-row"><button class="action-btn primary" data-act="ship-unload">全部在岸边登陆</button></div>`;
        } else body += `<div class="empty-note">船上没有乘客。选中陆地单位后右键点击靠岸的船只即可登船。</div>`;
        const dock = g.getShipDock(u);
        if (dock) {
          const next = { ship_boat: 'ship_cog', ship_cog: 'ship_carrack' }[u.kind];
          const n = next ? D.UNITS[next] : null;
          body += `<div class="gold-divider"></div><div class="stat-line"><span class="k">停靠码头</span><span class="v">${D.buildingName(dock.def, dock.level)}</span></div>`;
          if (n) body += `<div class="action-row"><button class="action-btn" data-act="ship-upgrade">改造为${n.name}</button></div>`;
          else body += `<div class="empty-note">这已是最高级的船只。</div>`;
        }
        body += `</div>`;
      }
      if (u.kind === 'resident' || u.kind === 'builder') {
        const carry = u.carry ? Object.entries(u.carry).filter(([, v]) => v > .01) : [];
        body += `<div class="drawer-section"><h4>随身物品</h4>`;
        body += carry.length ? carry.map(([k, v]) => `<div class="stat-line"><span class="k">${D.RES[k].name}</span><span class="v">${fmt(v, 1)}</span></div>`).join('') : `<div class="empty-note">没有携带物资。</div>`;
        body += `</div>`;
      }
      if (isOwn) {
        body += `<div class="drawer-section"><h4>命令</h4><div class="action-row">
          <button class="action-btn" data-act="unit-focus">定位</button>
          <button class="action-btn" data-act="unit-stop">停止</button>`;
        if (u.kind === 'resident') body += `<button class="action-btn" data-act="unit-builder">转为建筑工</button>`;
        if (u.def.military) body += `<button class="action-btn" data-act="unit-clinic">进入最近诊所</button>`;
        body += `</div><div class="nearby-note" style="margin-top:6px">右键地上移动，右键目标下达采集、建造、进入或攻击命令。</div></div>`;
      }
      body += `<div class="action-row"><button class="action-btn" data-act="close-drawer">关闭</button></div></div>`;
      const html = `<div class="drawer-head"><div class="drawer-icon" style="border:0;background:transparent"><canvas width="92" height="70" data-unit-portrait></canvas></div>
        <div class="drawer-title-wrap"><h3>${esc(u.def.name)}</h3><div class="drawer-sub"><span>${f ? esc(D.realmFullName(f)) : '无主'}</span><span class="sep">·</span><span>${status}</span></div></div>
        <button class="close-btn" data-act="close-drawer">${icon('close')}</button></div>${body}`;
      this.openDrawer(html);
    }

    // =========================================================
    // Drawer actions / build panel etc.
    // =========================================================
    onDrawerClick(e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const g = this.game;
      const b = this.selection.buildingId ? g.getBuilding(this.selection.buildingId) : null;
      const u = this.inspectedUnitId ? g.getUnit(this.inspectedUnitId) : (this.selection.unitIds.length === 1 ? g.getUnit(this.selection.unitIds[0]) : null);
      if (act === 'close-drawer') { this.closeDrawer(); return; }
      if (act === 'focus-building' && b) { this.renderer.focus(this.game.buildingCenter(b).x, this.game.buildingCenter(b).y); return; }
      if (act === 'focus-node' && this.selection.nodeId) {
        const n = g.world.nodes.find((x) => x.id === this.selection.nodeId);
        if (n) this.renderer.focus(n.x + .5, n.y + .5);
        return;
      }
      if (act === 'upgrade-building' && b) {
        const r = g.startUpgrade(b.id);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast('升级工程已经开始。请确保有工匠持续施工。');
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'add-constructor' && b) {
        const idle = this.pickIdleFor(b, 'builder');
        if (!idle) { this.showSubToast('没有空闲的居民或建筑工可以派遣。'); return; }
        const r = g.assignConstructorIds([idle.id], b.id);
        if (!r.ok) this.showSubToast(r.error || '无法派遣工匠。');
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'repair-building' && b) {
        const idle = this.pickIdleFor(b, 'builder');
        if (!idle) { this.showSubToast('没有空闲的居民或建筑工可以维修。'); return; }
        const r = g.assignRepairers([idle.id], b.id);
        if (!r.ok) this.showSubToast(r.error || '无法派遣工匠。');
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'add-worker' && b) {
        const idle = this.pickIdleFor(b, 'worker');
        if (!idle) { this.showSubToast('本定居点没有空闲的普通居民。新居民会由民宅产生。'); return; }
        const r = g.assignWorkerIds([idle.id], b.id);
        if (!r.ok) this.showSubToast(r.error || '无法派遣工人。');
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'fill-workers' && b) {
        let n = 0;
        for (let i = 0; i < D.buildingSlots(b.def, b.level); i++) {
          const idle = this.pickIdleFor(b, 'worker');
          if (!idle) break;
          const r = g.assignWorkerIds([idle.id], b.id);
          if (!r.ok) break;
          n++;
        }
        if (!n) this.showSubToast('没有可派遣的居民。');
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'remove-worker' && b) {
        g.unassignWorker(b.id, btn.dataset.unit);
        g.refreshNodeBoosts?.();
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'convert-gate' && b) {
        const r = g.convertWallToGate(b.id);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast('开始改建大门。工匠会很快完成。');
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'toggle-gate' && b) {
        const r = g.toggleGate(b.id);
        if (!r.ok) this.showSubToast(r.error);
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'set-recipe' && b) {
        g.setRecipe(b.id, btn.dataset.recipe);
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'toggle-tavern' && b) {
        g.setTavernActive(b.id, !b.active);
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'train' && b) {
        const r = g.trainUnit(b.id, btn.dataset.kind);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast(`${D.UNITS[btn.dataset.kind].name}已加入训练队列。`);
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'hire-merchant' && b) {
        const r = g.hireMerchant(b.id);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast('商人已在集市附近出现。');
        this.openBuildingDrawer(b);
        return;
      }
      if (act === 'open-tech') {
        this.closeDrawer();
        this.closeBuild();
        this.openTech();
        this.setNavActive('tech');
        return;
      }
      if (act === 'node-gather') {
        const nodeId = this.selection.nodeId;
        const residentIds = this.selection.unitIds.filter((id) => { const x = g.getUnit(id); return x && x.kind === 'resident'; });
        if (!residentIds.length) return;
        const r = g.orderGather(residentIds, nodeId);
        if (!r.ok) this.showSubToast(r.error || '无法采集。');
        else this.showSubToast('居民开始采集。');
        return;
      }
      if (act === 'clear-node') {
        const node = g.world.nodes.find((n) => n.id === this.selection.nodeId);
        if (!node) return;
        const residentIds = this.selection.unitIds.filter((id) => { const x = g.getUnit(id); return x && x.kind === 'resident'; });
        if (!residentIds.length) { this.showSubToast('需要选中普通居民来清除资源点。'); return; }
        this.confirmClearNode(node, residentIds);
        return;
      }
      if (act === 'focus-node') {
        const n = g.world.nodes.find((x) => x.id === this.selection.nodeId);
        if (n) this.renderer.focus(n.x + .5, n.y + .5);
        return;
      }
      if (!u) return;
      if (act === 'unit-focus') { this.renderer.focus(u.x, u.y); return; }
      if (act === 'unit-stop') { const r = g.stopUnits([u.id]); if (r.ok) this.showSubToast('单位已停止。'); return; }
      if (act === 'unit-builder') { this.confirmConvertBuilders([u]); return; }
      if (act === 'unit-clinic') {
        let best = null, bestD = Infinity;
        for (const bb of g.buildings) {
          if (bb.dead || !bb.complete || bb.defId !== 'clinic' || bb.owner !== g.playerFactionId) continue;
          const c = g.buildingCenter(bb);
          const d = U.dist2(u.x, u.y, c.x, c.y);
          if (d < bestD) { bestD = d; best = bb; }
        }
        if (!best) this.showSubToast('你还没有建造诊所。');
        else {
          const r = g.orderEnterClinic([u.id], best.id);
          if (!r.ok) this.showSubToast(r.error || '无法进入诊所。');
        }
        return;
      }
      if (act === 'merchant-load' && u) {
        this.openMerchantLoad(u);
        return;
      }
      if (act === 'merchant-unload' && u) {
        const r = g.unloadMerchantCargo(u.id);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast('货物已卸下。');
        this.openUnitDrawer(u);
        return;
      }
      if (act === 'ship-unload' && u) {
        const r = g.unboardShip(u.id);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast('乘客已在岸边登陆。');
        this.openUnitDrawer(u);
        return;
      }
      if (act === 'ship-upgrade' && u) {
        const r = g.upgradeShipAtDock(u.id);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast('船只已完成改造。');
        this.openUnitDrawer(u);
        return;
      }
    }

    pickIdleFor(b, mode) {
      const g = this.game;
      const candidates = g.units.filter((u) => !u.dead && !u.isShip && u.owner === b.owner && !u.task &&
        (u.state === 'idle') && (mode === 'builder' ? (u.kind === 'resident' || u.kind === 'builder') : u.kind === 'resident') &&
        u.homeSettlement === b.settlementId);
      if (!candidates.length) {
        return g.units.filter((u) => !u.dead && !u.isShip && u.owner === b.owner && !u.task && u.state === 'idle' &&
          (mode === 'builder' ? (u.kind === 'resident' || u.kind === 'builder') : u.kind === 'resident'))[0] || null;
      }
      candidates.sort((a, b2) => U.dist2(a.x, a.y, b.x, b.y) - U.dist2(b2.x, b2.y, b.x, b.y));
      return candidates[0];
    }

    // =========================================================
    // Build panel
    // =========================================================
    toggleBuild() {
      if (!this.refs.buildPanel.classList.contains('hidden')) { this.closeBuild(); return; }
      this.openBuild();
    }
    closeBuild() {
      this.refs.buildPanel.classList.add('hidden');
      if (!this.placement) this.setNavActive(null);
    }
    openBuild() {
      if (!this.game) return;
      if (this.placement) this.cancelPlacement();
      this.closeDrawer();
      this.hideTooltip();
      this.refs.buildPanel.classList.remove('hidden');
      this.setNavActive('build');
      this.renderBuildPanel();
    }
    refreshBuildPanel() {
      if (!this.refs.buildPanel.classList.contains('hidden')) this.renderBuildPanel();
    }
    renderBuildPanel() {
      if (!this.game) return;
      const g = this.game;
      const p = g.player;
      const settlements = g.ownedSettlements(p.id);
      if (!settlements.length) {
        this.refs.buildPanel.innerHTML = `<div class="panel-head"><div><div class="eyebrow">CONSTRUCTION</div><h3>建造</h3></div><button class="close-btn" data-build-close>${icon('close')}</button></div><div class="build-scroll"><div class="empty-state">你失去了所有定居点。只有重新夺回一座大厅，或重新开始，才能再次建造。</div></div>`;
        return;
      }
      if (!settlements.some((s) => s.id === this.activeSettlementId)) this.activeSettlementId = settlements.sort((a, b) => b.stage - a.stage)[0].id;
      const s = g.getSettlement(this.activeSettlementId);
      const cats = D.BUILD_CATS;
      const activeCat = this.buildCategory || 'gov';
      const defs = Object.values(D.BUILD).filter((def) => def.cat === activeCat && def.id !== 'hall' && def.id !== 'gate');
      defs.sort((a, b) => (a.minLevel || 1) - (b.minLevel || 1) || (a.cat === 'special' ? 0 : a.id > b.id ? 1 : -1));
      let cards = '';
      for (const def of defs) {
        const locked = (s.stage || 1) < (def.minLevel || 1);
        const level = def.buildMode === 'line' && def.id !== 'wall' ? 1 : WW.levelForPlacement(def, s);
        const cost = D.buildingCost(def, level);
        const count = D.BUILD[def.id].unique ? g.settlementBuildings(s.id).filter((x) => x.defId === def.id).length : 0;
        const uniqueFull = def.unique && count > 0;
        const affordable = cost ? g.canAfford(s, cost) : true;
        const costHtml = this.costHtml(cost, s);
        const note = def.buildMode === 'line' ? '拖动建造' : uniqueFull ? '每个定居点限一座' : def.requires ? '需靠近' + (def.requires.label || def.requires.type) : '';
        cards += `<button class="build-card ${locked || uniqueFull ? 'locked' : ''} ${affordable ? '' : 'unaffordable'}" data-build="${def.id}" ${locked || uniqueFull ? 'disabled' : ''}>
           <div class="card-icon"><canvas width="148" height="112" data-build-icon="${def.id}"></canvas></div>
           <h4>${def.name}</h4>
           <div class="card-level">${def.maxLevel === 1 ? '固定阶段' : D.STAGE_NAMES[level]}${def.buildMode === 'line' ? ' · 拖拽' : ''}</div>
           <div class="cost-line">${costHtml}</div>
           <div class="card-days">工期 ${def.buildMode === 'line' ? '即时工程' : D.buildingDays(def, level) + ' 人·日'}${note ? ' · ' + note : ''}</div>
           ${locked ? `<div class="lock-note">${icon('lock')} ${D.STAGE_NAMES[def.minLevel]}阶段解锁</div>` : ''}
           ${uniqueFull ? `<div class="uniq-mark">已建造</div>` : ''}
         </button>`;
      }
      let crownCard = '';
      if (activeCat === 'gov') {
        const hall = g.primaryHall(s);
        if (hall) {
          const up = g.getUpgradeInfo(hall);
          const workers = hall.constructors ? hall.constructors.length : 0;
          const targetName = up.ok ? up.name : (D.STAGE_HALL_NAMES[Math.min(4, hall.level + 1)] || '大厅');
          crownCard = `<div class="build-crown-card">
            <div class="crown-art"><canvas width="180" height="132" data-build-icon="hall"></canvas></div>
            <div class="crown-copy">
              <div class="eyebrow" style="font-size:8px;color:rgba(88,68,38,.5);letter-spacing:.16em">SEAT OF POWER</div>
              <h4>${D.buildingName(hall.def, hall.level)}</h4>
              <p>${s.name}的核心。升级大厅可提升定居点阶段，并解锁新的建筑与制度。</p>
              ${up.ok ? `<div class="crown-cost">${this.costHtml(up.cost, s)}</div><div class="crown-actions"><button class="mini-btn" data-build-hall-select>查看大厅</button><button class="mini-btn primary-ish" data-build-hall-upgrade>升级 · ${up.days} 人·日</button></div>` : `<div class="crown-note">${esc(up.error)}${up.cost ? ' · ' + this.costHtml(up.cost, s) : ''}</div><div class="crown-actions"><button class="mini-btn" data-build-hall-select>查看大厅</button></div>`}
            </div>
          </div>`;
        }
      }
      let colony = '';
      if (activeCat === 'gov') {
        const freePop = g.factionPopCap(p.id) - g.livingPopulation(p.id);
        colony = `<button class="colony-card" data-build-colony>
          <div class="colony-icon">${icon('flag')}</div>
          <div><strong>建立新的定居点</strong><span>在 48 格内选择空地，花费 90 食物、110 木材、50 石材、20 银币，并需要 3 个空余人口容量。新定居点将独立运转。当前空余人口：${Math.max(0, freePop)}。</span></div>
        </button>`;
      }
      const idle = g.getPlayerIdleWorkers().length;
      const waitingSites = g.buildings.filter((b) => b.owner === p.id && (!b.complete || b.upgrade || b.converting) && (!b.constructors || !b.constructors.length)).length;
      this.refs.buildPanel.innerHTML = `
        <div class="panel-head">
          <div><div class="eyebrow">CONSTRUCTION · 营造</div><h3>建造</h3>
            <div class="settlement-selector-wrap"><label>施工定居点</label><select class="settlement-selector" id="build-settlement-select">${settlements.map((x) => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)} · ${D.STAGE_NAMES[x.stage]}</option>`).join('')}</select></div>
          </div>
          <button class="close-btn" data-build-close>${icon('close')}</button>
        </div>
        <div class="build-tabs">${cats.map((cat) => `<button class="build-tab ${cat.id === activeCat ? 'active' : ''}" data-build-tab="${cat.id}">${icon(cat.icon)}${cat.name.replace('建筑', '')}</button>`).join('')}</div>
        <div class="build-scroll">
          ${crownCard}
          <div class="build-work-summary"><span>${icon('people')} 空闲劳力 <b>${idle}</b></span><span>${icon('hammer')} 等待施工 <b>${waitingSites}</b></span><span>木 ${fmt(s.resources.wood)} · 石 ${fmt(s.resources.stone)}</span></div>
          <div class="build-grid">${cards || '<div class="empty-state">本阶段暂无可建造项目。</div>'}</div>
          ${colony}
          <div class="build-help">定居点内的建筑必须建在金色领地线以内。资源只属于当前定居点；其他定居点的资源不会自动调拨过来。建筑放下后会自动指派一名空闲居民；若无人施工，请选中居民右键点击工地。</div>
        </div>`;
      $$('[data-build-icon]', this.refs.buildPanel).forEach((cv) => {
        const def = D.BUILD[cv.dataset.buildIcon];
        if (!def) return;
        const lvl = cv.dataset.buildIcon === 'hall' && g.primaryHall(s) ? g.primaryHall(s).level : WW.levelForPlacement(def, s);
        this.renderer.drawBuildingIcon(cv, def.id, lvl, p);
      });
    }

    onBuildPanelClick(e) {
      if (e.target.closest('[data-build-close]')) { this.closeBuild(); return; }
      if (e.target.closest('[data-build-hall-select]')) {
        const s = this.game.getSettlement(this.activeSettlementId);
        const hall = s ? this.game.primaryHall(s) : null;
        if (hall) {
          this.closeBuild();
          this.selection = { unitIds: [], buildingId: hall.id, nodeId: null, settlementId: hall.settlementId };
          this.applySelectionToRenderer();
          this.openBuildingDrawer(hall);
          this.updateSelectionUI();
        }
        return;
      }
      if (e.target.closest('[data-build-hall-upgrade]')) {
        const s = this.game.getSettlement(this.activeSettlementId);
        const hall = s ? this.game.primaryHall(s) : null;
        if (!hall) return;
        const r = this.game.startUpgrade(hall.id);
        if (!r.ok) this.showSubToast(r.error);
        else this.showSubToast('大厅升级已经开始。需要有工匠持续施工。');
        this.renderBuildPanel();
        return;
      }
      const tab = e.target.closest('[data-build-tab]');
      if (tab) { this.buildCategory = tab.dataset.buildTab; this.renderBuildPanel(); return; }
      const card = e.target.closest('[data-build]');
      if (card) {
        const defId = card.dataset.build;
        const def = D.BUILD[defId];
        const s = this.game.getSettlement(this.activeSettlementId);
        if (!def || !s) return;
        const check = this.game.canPlacePreview(defId, s.id, s.x, s.y);
        if (defId === 'wall' || defId === 'bridge' || defId === 'tunnel' || defId === 'road') {
          this.startPlacement({ defId, settlementId: s.id, mode: 'line' });
        } else {
          if (!this.game.canAfford(s, D.buildingCost(def, WW.levelForPlacement(def, s)))) this.showSubToast('资源不足。');
          this.startPlacement({ defId, settlementId: s.id, mode: 'building' });
        }
        return;
      }
      const colony = e.target.closest('[data-build-colony]');
      if (colony) {
        const s = this.game.getSettlement(this.activeSettlementId);
        if (s) this.startPlacement({ settlementId: s.id, mode: 'found' });
      }
    }

    onBuildPanelChange(e) {
      if (e.target.id === 'build-settlement-select') {
        this.activeSettlementId = e.target.value;
        this.renderBuildPanel();
        const s = this.game.getSettlement(this.activeSettlementId);
        if (s) this.renderer.focus(s.x, s.y);
      }
    }

    // =========================================================
    // Placement
    // =========================================================
    startPlacement(opts) {
      if (!this.game) return;
      this.placement = Object.assign({}, opts);
      this.refs.buildPanel.classList.add('hidden');
      this.setNavActive('build');
      this.refs.placementHint.classList.remove('hidden');
      this.refs.zoomHint.classList.add('fade');
      this.refs.drawer.classList.add('hidden');
      this.app.canvas.style.cursor = 'crosshair';
      const def = opts.defId ? D.BUILD[opts.defId] : null;
      this.refs.placementText.textContent = opts.mode === 'found' ? '选择新定居点的大厅位置' : opts.mode === 'line' ? `拖拽规划${def ? def.name : '工程'}` : `放置${def ? def.name : '建筑'}`;
      if (opts.mode !== 'line') this.updatePlacementPreview(this.pointer);
      else this.renderer.placement = null;
      this.app.audio?.sfx('click');
    }

    cancelPlacement() {
      if (!this.placement) return;
      this.placement = null;
      this.lineDrag = null;
      this.renderer.placement = null;
      this.refs.placementHint.classList.add('hidden');
      this.app.canvas.style.cursor = 'default';
      this.setNavActive(null);
      this.hideTooltip();
    }

    updatePlacementPreview(pos) {
      if (!this.placement || !this.game) return;
      const g = this.game;
      const s = g.getSettlement(this.placement.settlementId);
      if (!s) { this.cancelPlacement(); return; }
      const w = this.renderer.screenToWorld(pos.x, pos.y);
      if (this.placement.mode === 'found') {
        const cx = Math.round(w.x), cy = Math.round(w.y);
        const chk = g.canFoundSettlement(s.id, cx, cy);
        this.placement.x = cx; this.placement.y = cy; this.placement.valid = chk.ok; this.placement.error = chk.error;
        this.renderer.placement = { mode: 'found', x: cx, y: cy, valid: chk.ok, error: chk.error };
        this.refs.placementText.textContent = chk.ok ? `在此建立新定居点 · ${D.STAGE_NAMES[1]}` : `无法建立：${chk.error}`;
      } else if (this.placement.mode === 'building') {
        const def = D.BUILD[this.placement.defId];
        if (!def) return;
        const x = Math.round(w.x - def.foot[0] / 2), y = Math.round(w.y - def.foot[1] / 2);
        const chk = g.canPlacePreview(def.id, s.id, x, y);
        const level = WW.levelForPlacement(def, s);
        this.placement.x = x; this.placement.y = y; this.placement.valid = chk.ok; this.placement.error = chk.error;
        this.renderer.placement = { mode: 'building', defId: def.id, x, y, valid: chk.ok };
        let extra = '';
        if (chk.ok && def.id === 'quarry') {
          const nearMountain = g.world.mountainNear(x + Math.floor(def.foot[0] / 2), y + Math.floor(def.foot[1] / 2), 4);
          extra = nearMountain ? ' · 靠近高山，产量 +50%' : ' · 靠近高山可提高 50% 产量';
        }
        this.refs.placementText.textContent = chk.ok ? `${def.name} · ${D.STAGE_NAMES[level]}${extra} · 左键放置` : `无法建造：${chk.error}`;
      }
    }

    updateLinePreview(end) {
      if (!this.placement || !this.lineDrag) return;
      const g = this.game;
      const s = g.getSettlement(this.placement.settlementId);
      if (!s) return;
      const def = D.BUILD[this.placement.defId];
      const start = this.lineDrag.start;
      const line = U.lineTiles(start.x, start.y, end.x, end.y).slice(0, 60);
      const tiles = line.map((p) => {
        const chk = g.canPlaceLineTile(def.id, s.id, p.x, p.y);
        return { x: p.x, y: p.y, valid: chk.ok, cost: chk.cost };
      });
      const allValid = tiles.length > 0 && tiles.every((t) => t.valid);
      this.renderer.placement = { mode: 'line', defName: def.name, tiles };
      let issue = '';
      if (!allValid) issue = tiles.find((t) => !t.valid) ? '（部分位置不可用）' : '';
      this.refs.placementText.textContent = `${def.name} · ${tiles.length} 格 ${issue} · 松开鼠标建造`;
      this.placement.tiles = tiles;
    }

    commitLine() {
      if (!this.placement || !this.lineDrag) return;
      const tiles = this.placement.tiles || [];
      if (!tiles.length) return;
      const r = this.game.commitLine(this.placement.defId, this.placement.settlementId, tiles.map((t) => ({ x: t.x, y: t.y })));
      if (!r.ok) {
        this.showSubToast(r.error || '无法建造此工程。');
      } else if (r.error) {
        this.showSubToast(`已建造 ${r.built} 格，之后：${r.error}`);
      }
      if (r.ok || r.built > 0) {
        const defId = this.placement.defId;
        this.cancelPlacement();
        this.refreshBuildPanel();
      }
    }

    commitPlacement() {
      if (!this.placement) return;
      const g = this.game;
      if (this.placement.mode === 'found') {
        if (!this.placement.valid) { this.showSubToast(this.placement.error || '此处无法建立定居点。'); return; }
        const r = g.foundSettlement(this.placement.settlementId, this.placement.x, this.placement.y);
        if (!r.ok) { this.showSubToast(r.error || '无法建立定居点。'); return; }
        this.activeSettlementId = r.settlement.id;
        this.renderer.focus(r.settlement.x, r.settlement.y);
        this.cancelPlacement();
        this.refreshBuildPanel();
        return;
      }
      if (this.placement.mode === 'building') {
        if (!this.placement.valid) { this.showSubToast(this.placement.error || '此处无法建造。'); return; }
        const r = g.placeBuilding(this.placement.defId, this.placement.settlementId, this.placement.x, this.placement.y);
        if (!r.ok) { this.showSubToast(r.error || '无法建造。'); return; }
        this.cancelPlacement();
        if (r.building) {
          this.selection = { unitIds: [], buildingId: r.building.id, nodeId: null, settlementId: r.building.settlementId };
          this.applySelectionToRenderer();
          this.openBuildingDrawer(r.building);
          this.updateSelectionUI();
        }
        this.refreshBuildPanel();
      }
    }

    // =========================================================
    // Commands
    // =========================================================
    issueCommand(info) {
      const g = this.game;
      if (!g || this.placement) return;
      const unitIds = this.selection.unitIds.slice();
      if (!unitIds.length) {
        if (info && info.kind === 'building') {
          const b = g.getBuilding(info.id);
          if (b) this.handleClick(info, {});
        }
        return;
      }
      const units = unitIds.map((id) => g.getUnit(id)).filter((u) => u && !u.dead && u.state !== 'aboard');
      if (!units.length) return;
      const landUnits = units.filter((u) => !u.isShip);
      const ships = units.filter((u) => u.isShip);
      if (ships.length && !landUnits.length) {
        if (info && info.kind === 'tile' && g.world.isWater(info.x, info.y)) {
          g.orderMove(ships.map((u) => u.id), info.x, info.y);
        } else if (info && info.kind === 'ship') {
          const ship = g.getUnit(info.id);
          if (ship && ship.owner === g.playerFactionId) {
            const r = g.unboardShip(ship.id);
            if (!r.ok) this.showSubToast(r.error);
          }
        } else this.showSubToast('船只只能在水域中航行，需靠岸后才能让单位登陆。');
        return;
      }
      // Merchant unload / trade at a market
      const merchants = units.filter((u) => u.kind === 'merchant');
      if (info && info.kind === 'building' && merchants.length) {
        const market = g.getBuilding(info.id);
        if (market && market.defId === 'market' && market.complete) {
          const near = merchants.filter((u) => U.dist(u.x, u.y, g.buildingCenter(market).x, g.buildingCenter(market).y) <= 5.5);
          if (near.length) {
            for (const m of near) g.unloadMerchantCargo(m.id);
            this.showSubToast(`商人在「${g.getSettlement(market.settlementId).name}」卸下了货物。`);
            this.updateSelectionUI();
            return;
          }
          const nonMerchants = units.filter((u) => u.kind !== 'merchant' && !u.isShip);
          if (!nonMerchants.length) {
            const r = g.orderMerchantsUnload(merchants.map((u) => u.id), market.id);
            if (r.ok) this.showSubToast('商人正携货前往集市，抵达后会自动卸货。');
            else this.showSubToast(r.error || '无法前往集市。');
            return;
          }
        }
      }
      if (info && info.kind === 'unit') {
        const target = g.getUnit(info.id);
        if (!target) return;
        if (target.owner === g.playerFactionId) {
          if (target.isShip) {
            const land = units.filter((u) => !u.isShip);
            if (land.length) {
              const r = g.boardShip(land.map((u) => u.id), target.id);
              if (!r.ok) this.showSubToast(r.error);
              else this.showSubToast('单位正在登船。');
              return;
            }
          }
          if (target.kind === 'merchant') {
            const approach = g._walkableNear(Math.floor(target.x), Math.floor(target.y), false, 4);
            if (approach) g.orderMove(unitIds, approach.x, approach.y);
            return;
          }
          // Move near friendly unit
          g.orderMove(unitIds, Math.floor(target.x), Math.floor(target.y));
          return;
        }
        if (!g.atWar(g.playerFactionId, target.owner)) {
          this.confirmWarCommand(info, unitIds);
          return;
        }
        const r = g.orderAttack(unitIds, target.isShip ? 'ship' : 'unit', target.id);
        if (!r.ok) this.showSubToast(r.error || '无法发起攻击。');
        else this.showSubToast('部队开始攻击目标。');
        return;
      }
      if (info && info.kind === 'building') {
        const b = g.getBuilding(info.id);
        if (!b) return;
        if (b.owner === g.playerFactionId) {
          if (b.defId === 'clinic' && units.some((u) => u.def.military)) {
            const r = g.orderEnterClinic(units.filter((u) => u.def.military).map((u) => u.id), b.id);
            if (!r.ok) this.showSubToast(r.error);
            else this.showSubToast('伤员正前往诊所。');
            return;
          }
          if (!b.complete || b.upgrade || b.converting) {
            const r = g.assignConstructorIds(unitIds, b.id);
            if (!r.ok) this.showSubToast(r.error || '工地无法接收更多工匠。');
            else this.showSubToast('工匠已前往工地。');
            return;
          }
          if (b.hp < b.maxHp - 0.5 && landUnits.length) {
            const r = g.assignRepairers(landUnits.map((u) => u.id), b.id);
            if (r.ok) { this.showSubToast('工匠开始维修建筑。'); return; }
          }
          const slots = D.buildingSlots(b.def, b.level);
          if (slots > 0) {
            const r = g.assignWorkerIds(landUnits.map((u) => u.id), b.id);
            if (r.ok) { this.showSubToast('居民进入建筑工作。'); return; }
            if (r.error) { this.showSubToast(r.error); return; }
          }
          if (b.defId === 'market' && merchants.length) {
            const near = merchants.filter((u) => U.dist(u.x, u.y, g.buildingCenter(b).x, g.buildingCenter(b).y) <= 5.5);
            if (near.length) { for (const m of near) g.unloadMerchantCargo(m.id); this.showSubToast('货物已卸下。'); return; }
          }
          const at = g.approachTileForBuilding(b, landUnits[0] ? landUnits[0].x : b.x, landUnits[0] ? landUnits[0].y : b.y);
          if (at) g.orderMove(landUnits.map((u) => u.id), at.x, at.y);
          return;
        }
        if (!b.complete) { if (b.owner && !g.atWar(g.playerFactionId, b.owner)) this.confirmWarCommand(info, unitIds); else { const r = g.orderAttack(unitIds, 'building', b.id); if (!r.ok) this.showSubToast(r.error || '无法攻击。'); } return; }
        if (!g.atWar(g.playerFactionId, b.owner)) { this.confirmWarCommand(info, unitIds); return; }
        const r = g.orderAttack(unitIds, 'building', b.id);
        if (!r.ok) this.showSubToast(r.error || '无法攻击该建筑。');
        else this.showSubToast('部队开始攻击目标建筑。');
        return;
      }
      if (info && info.kind === 'node') {
        const node = g.world.nodes.find((n) => n.id === info.id);
        if (!node) return;
        if (node.type === 'tree' || node.type === 'berry') {
          const residents = landUnits.filter((u) => u.kind === 'resident');
          if (!residents.length) { this.openNodeDrawer(node); this.showSubToast('需要普通居民才能采集。'); return; }
          const r = g.orderGather(residents.map((u) => u.id), node.id);
          if (!r.ok) this.showSubToast(r.error || '无法采集。');
          else this.showSubToast('居民开始采集资源。');
          return;
        }
        this.openNodeDrawer(node);
        this.showSubToast('矿脉无法直接采集，需要建造相应的矿场。');
        return;
      }
      // ground move
      if (info && info.kind === 'tile') {
        if (landUnits.length) {
          const r = g.orderMove(landUnits.map((u) => u.id), info.x, info.y);
          if (!r.ok) this.showSubToast('无法抵达该位置。');
          if (merchants.length && info) {}
        }
        if (ships.length) g.orderMove(ships.map((u) => u.id), info.x, info.y);
      }
    }

    confirmWarCommand(info, unitIds) {
      const g = this.game;
      const target = info.kind === 'building' ? g.getBuilding(info.id) : g.getUnit(info.id);
      if (!target) return;
      const faction = g.getFaction(target.owner);
      if (!faction) return;
      const kindText = info.kind === 'building' ? D.buildingName(target.def, target.level) : target.def.name;
      this.showSubdialog(`
        <h3>对${esc(D.realmFullName(faction))}宣战</h3>
        <p class="sub-copy">你的军队将攻击${info.kind === 'building' ? '建筑' : '单位'}「${esc(kindText)}」。这是一次无端攻击，会立即引发战争，并使其他所有阵营对你的好感下降。</p>
        <div class="subdialog-info">战争开始后，双方单位将互为敌人。你可以通过外交界面提出和平，或一直战斗到对方屈服。</div>
        <div class="subdialog-actions"><button class="action-btn decline" data-sub-cancel>取消</button><button class="action-btn accept" data-sub-confirm>宣战并攻击</button></div>`);
      this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
      this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
        this.closeSubdialog();
        const r = g.orderAttack(unitIds, info.kind === 'building' ? 'building' : 'unit', info.id, { declareWar: true });
        if (!r.ok) this.showSubToast(r.error || '无法发起攻击。');
        else this.showSubToast('战争已经爆发。');
        this.updateHUD(true);
      });
    }

    confirmConvertBuilders(residents) {
      if (!residents || !residents.length) return;
      this.showSubdialog(`<h3>转为建筑工</h3>
        <p class="sub-copy">建筑工的建造速度为普通居民的两倍，但无法采集资源、进入资源建筑，且无法转回居民。这一决定不可逆。</p>
        <div class="subdialog-info">将 ${residents.length} 名居民转为建筑工？</div>
        <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn accept" data-sub-confirm>确认转职</button></div>`);
      this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
      this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
        this.closeSubdialog();
        const r = this.game.convertToBuilders(residents.map((u) => u.id));
        if (r.ok) this.showSubToast(`${r.count} 名居民成为了建筑工。`);
        this.updateSelectionUI();
        if (this.selection.buildingId) this.refreshDrawer();
      });
    }

    confirmClearNode(node, residentIds) {
      this.showSubdialog(`<h3>清除资源点</h3>
        <p class="sub-copy">居民会花时间彻底清除这片${D.NODES[node.type].name}。清除是不可逆的，资源点将永久消失，但土地会变得可以建造。</p>
        <div class="subdialog-actions"><button class="action-btn" data-sub-cancel>取消</button><button class="action-btn danger" data-sub-confirm>开始清除</button></div>`);
      this.refs.subBackdrop.querySelector('[data-sub-cancel]').addEventListener('click', () => this.closeSubdialog());
      this.refs.subBackdrop.querySelector('[data-sub-confirm]').addEventListener('click', () => {
        this.closeSubdialog();
        const r = this.game.orderClearNode(residentIds, node.id);
        if (!r.ok) this.showSubToast(r.error || '无法清除。');
      });
    }

    tryUnloadShip(ship) {
      const r = this.game.unboardShip(ship.id);
      if (!r.ok) this.showSubToast(r.error);
      else this.showSubToast('乘客已在岸边登陆。');
      this.openUnitDrawer(ship);
    }

    // =========================================================
    // Generic helpers
    // =========================================================
    costHtml(cost, settlement) {
      if (!cost || !Object.keys(cost).length) return '<span class="cost-item">无需资源</span>';
      return Object.entries(cost).filter(([, v]) => v).map(([k, v]) => {
        const missing = settlement && (settlement.resources[k] || 0) < v;
        return `<span class="cost-item ${missing ? 'missing' : ''}">${resIcon(k, 11)}${fmt(v)} ${D.RES[k].name}</span>`;
      }).join('');
    }
    tag(text, cls) { return `<span class="tag ${cls || ''}">${esc(text)}</span>`; }
    stageBadge(stage) { return `<span class="stage-badge">${D.STAGE_NAMES[stage] || '荒野'}</span>`; }

    closeTop() {
      if (this.subdialogOpen) { this.closeSubdialog(); return true; }
      if (this.modalOpen) { this.closeModal(); return true; }
      if (this.placement) { this.cancelPlacement(); return true; }
      return false;
    }

    // =========================================================
    // Modal shell
    // =========================================================
    openModal(opts) {
      if (this.placement) this.cancelPlacement();
      this.refs.buildPanel.classList.add('hidden');
      this.refs.drawer.classList.add('hidden');
      this.hideTooltip();
      this.modalOpen = true;
      this.modalContext = opts;
      this.refs.modal.className = 'modal' + (opts.wide ? ' wide' : opts.narrow ? ' narrow' : '');
      this.refs.modal.innerHTML = `
        <div class="modal-header">
          <div><div class="eyebrow">${esc(opts.eyebrow || 'THE ROYAL COURT · 王廷')}</div><h2>${esc(opts.title || '')}</h2>${opts.subtitle ? `<p>${opts.subtitle}</p>` : ''}</div>
          <div class="head-actions">${opts.headActions || ''}<button class="close-btn" data-close-modal title="关闭">${icon('close')}</button></div>
        </div>
        <div class="modal-body">${opts.body || ''}</div>
        ${opts.footer ? `<div class="modal-footer">${opts.footer}</div>` : ''}`;
      this.refs.modalBackdrop.classList.remove('hidden');
      this.modalOnMount = opts.onMount || null;
      if (this.modalOnMount) this.modalOnMount(this.refs.modal);
      this.bindModalDecor();
    }

    updateModalBody(body, titleObj) {
      if (!this.modalOpen) return;
      const mb = $('.modal-body', this.refs.modal);
      if (mb) mb.innerHTML = body;
      if (titleObj) {
        const h = $('.modal-header h2', this.refs.modal);
        if (h) h.textContent = titleObj.title || h.textContent;
        const s = $('.modal-header p', this.refs.modal);
        if (s && titleObj.subtitle != null) s.innerHTML = titleObj.subtitle;
      }
      if (this.modalOnMount) this.modalOnMount(this.refs.modal);
      this.bindModalDecor();
    }

    bindModalDecor() {
      $$('[data-building-icon]', this.refs.modal).forEach((cv) => {
        const id = cv.dataset.buildingIcon;
        const b = id ? this.game?.getBuilding(id) : null;
        if (b) this.renderer.drawBuildingIcon(cv, b.defId, b.level, this.game.getFaction(b.owner));
      });
      $$('[data-unit-portrait]', this.refs.modal).forEach((cv) => {
        const id = cv.dataset.unitPortrait;
        const u = id ? this.game?.getUnit(id) : null;
        if (u) this.renderer.drawUnitIcon(cv, u, this.game.getFaction(u.owner));
      });
    }

    closeModal() {
      if (!this.modalOpen) return;
      this.modalOpen = false;
      this.modalContext = null;
      this.modalOnMount = null;
      this.refs.modal.classList.add('hidden');
      this.refs.modalBackdrop.classList.add('hidden');
      this.refs.modal.innerHTML = '';
      this.setNavActive(this.refs.buildPanel.classList.contains('hidden') ? null : 'build');
    }

    onModalClick(e) {
      if (e.target.closest('[data-close-modal]')) { this.closeModal(); return; }
      if (this.onModalAction) this.onModalAction(e);
    }

    showSubdialog(html) {
      this.refs.subBackdrop.classList.remove('hidden');
      this.refs.subBackdrop.innerHTML = `<div class="subdialog">${html}</div>`;
      this.subdialogOpen = true;
      const close = () => this.closeSubdialog();
      const buttons = $$('[data-sub-cancel]', this.refs.subBackdrop);
      buttons.forEach((b) => b.addEventListener('click', close));
      return this.refs.subBackdrop.firstElementChild;
    }
    closeSubdialog() {
      this.subdialogOpen = false;
      this.refs.subBackdrop.classList.add('hidden');
      this.refs.subBackdrop.innerHTML = '';
    }

    // =========================================================
    // Prompts
    // =========================================================
    enqueuePrompt(p) {
      if (!this.currentPrompt) this.showNextPrompt();
      else this.app.audio?.sfx('bell', { volume: .25 });
    }

    showNextPrompt() {
      if (!this.game || !this.game.pendingPrompts.length) { this.clearPrompt(); return; }
      const prompt = this.game.pendingPrompts[0];
      this.currentPrompt = prompt;
      const kindLabel = {
        allyCall: 'ALLIANCE CALL · 盟约求援', vassalCall: 'VASSAL SUMMONS · 宗主征召',
        allianceOffer: 'DIPLOMATIC OFFER · 结盟提议', vassalDemand: 'ULTIMATUM · 附庸通牒',
        peaceOffer: 'PEACE ENVOY · 和平使节', tradeOffer: 'TRADE PROPOSAL · 贸易提议',
        inviteWar: 'WAR INVITATION · 参战邀请'
      }[prompt.kind] || 'ROYAL MESSAGE · 王廷来函';
      let extra = '';
      if (prompt.kind === 'tradeOffer' && prompt.payload && prompt.payload.terms) {
        const t = prompt.payload.terms;
        const offer = t.fromB, request = t.fromA;
        if (offer && request) {
          extra = `<div class="gold-divider"></div><div class="stat-line"><span class="k">对方给予</span><span class="v">${fmt(offer.amount)} ${D.RES[offer.res].name}</span></div><div class="stat-line"><span class="k">你需提供</span><span class="v">${fmt(request.amount)} ${D.RES[request.res].name}</span></div><div class="nearby-note">双方将派商人把货物送到对方集市。若商队被劫杀，贸易将失败。</div>`;
        }
      }
      if (prompt.kind === 'allyCall' && prompt.payload) {
        extra = `<div class="gold-divider"></div><div class="stat-line"><span class="k">盟友</span><span class="v">${esc(this.game.factionLabel(prompt.payload.defenderId || prompt.from))}</span></div><div class="stat-line"><span class="k">敌人</span><span class="v">${esc(this.game.factionLabel(prompt.payload.enemyId))}</span></div><div class="nearby-note">拒绝会严重损害你与盟友的关系，但没有正式惩罚。</div>`;
      }
      if (prompt.kind === 'vassalCall' && prompt.payload) {
        extra = `<div class="gold-divider"></div><div class="nearby-note">拒绝宗主征召会被视为背叛，宗主将获得征服你的战争理由。</div>`;
      }
      if (prompt.kind === 'vassalDemand') {
        extra = `<div class="gold-divider"></div><div class="nearby-note">接受附庸意味着你将成为对方的封臣。拒绝会给予对方征服你的战争理由。</div>`;
      }
      this.refs.promptLayer.classList.remove('hidden');
      this.refs.promptLayer.innerHTML = `<div class="missive">
        ${this.game.pendingPrompts.length > 1 ? `<div class="prompt-pile">还有 ${this.game.pendingPrompts.length - 1} 封来函</div>` : ''}
        <div class="missive-eyebrow">${kindLabel}</div>
        <h2>${esc(prompt.title || '王廷来函')}</h2>
        <div class="missive-from">来自 ${esc(prompt.fromName || '未知势力')} · ${U.dateLabel(this.game.timeDays, true)}</div>
        <div class="missive-ornament">✦ ❦ ✦</div>
        <p>${esc(prompt.text || '')}</p>
        ${extra}
        <div class="missive-actions">
          <button class="action-btn decline" data-prompt-choice="decline">${prompt.kind === 'vassalDemand' ? '拒绝并承担后果' : '拒绝'}</button>
          <button class="action-btn accept" data-prompt-choice="accept">${prompt.kind === 'allyCall' || prompt.kind === 'vassalCall' ? '履行义务，参战' : prompt.kind === 'peaceOffer' ? '接受和平' : prompt.kind === 'tradeOffer' ? '接受贸易' : '接受'}</button>
        </div>
        <div class="wax-stamp">W</div>
      </div>`;
      this.app.audio?.sfx('bell', { volume: .35 });
      this.updateHUD(true);
    }

    resolveCurrentPrompt(accepted) {
      if (!this.currentPrompt) return;
      const prompt = this.currentPrompt;
      const result = this.game.resolvePrompt(prompt.id, accepted);
      if (!result.ok) this.showSubToast(result.error || '提议已失效。');
      this.currentPrompt = null;
      this.refs.promptLayer.classList.add('hidden');
      this.refs.promptLayer.innerHTML = '';
      if (this.game.pendingPrompts.length) setTimeout(() => {
        if (!this.currentPrompt) this.showNextPrompt();
      }, 180);
      else this.clearPrompt();
      this.updateHUD(true);
    }

    clearPrompt() {
      this.currentPrompt = null;
      this.refs.promptLayer.classList.add('hidden');
      this.refs.promptLayer.innerHTML = '';
    }

    // =========================================================
    // Periodic updates
    // =========================================================
    tick(now) {
      if (!this.game) return;
      this.updateHUD();
      if (!this.refs.drawer.classList.contains('hidden') && now - this.lastDrawer > 2200 && this.refs.drawer.matches(':hover') === false && this.subdialogOpen === false) {
        this.lastDrawer = now;
        const active = document.activeElement;
        if (!active || !this.refs.drawer.contains(active)) this.refreshDrawer();
      }
    }

    refreshDrawer() {
      if (!this.game || this.refs.drawer.classList.contains('hidden')) return;
      if (this.selection.buildingId) {
        const b = this.game.getBuilding(this.selection.buildingId);
        if (b) this.openBuildingDrawer(b);
        else this.closeDrawer();
      } else if (this.selection.nodeId) {
        const n = this.game.world.nodes.find((x) => x.id === this.selection.nodeId);
        if (n) this.openNodeDrawer(n);
        else this.closeDrawer();
      } else {
        const u = this.inspectedUnitId ? this.game.getUnit(this.inspectedUnitId) : (this.selection.unitIds.length === 1 ? this.game.getUnit(this.selection.unitIds[0]) : null);
        if (u) {
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
          this.openUnitDrawer(u);
        } else this.closeDrawer();
      }
    }

    // =========================================================
    // Game over / victory
    // =========================================================
    showDefeat(faction) {
      this.clearPrompt();
      this.closeModal();
      this.closeSubdialog();
      const s = this.game;
      const day = U.dateLabel(s.timeDays);
      const el = this.refs.gameover;
      el.innerHTML = `<div class="gameover-inner">
        <div class="go-eyebrow">THE CHRONICLE CLOSES · 编年史终章</div>
        <h2>王朝落幕</h2>
        <p>${D.realmFullName(faction)}的旗帜已经倒下。${day}，最后的领地与军队都归于尘土。<br>你的故事将被后人记在羊皮纸上，作为一段关于野心与失落的警示。</p>
        <button class="royal-btn primary" data-go-action="new">开始新的王朝</button>
        <button class="royal-btn" data-go-action="load">读取最近存档</button>
        <button class="royal-btn ghost" data-go-action="menu">返回主菜单</button>
      </div>`;
      el.classList.remove('hidden');
    }
    showVictory() {
      const el = this.refs.gameover;
      el.innerHTML = `<div class="gameover-inner">
        <div class="go-eyebrow">THE KNOWN WORLD BOWS · 天下归一</div>
        <h2>万王之王</h2>
        <p>所有敌旗都已落下。你的名字被刻进每一座教堂的钟与每一本编年史的开篇。<br>战争世界仍在运转，而你的王朝已经成为了传说本身。</p>
        <button class="royal-btn primary" data-go-action="continue">继续统治世界</button>
        <button class="royal-btn" data-go-action="menu">返回主菜单</button>
      </div>`;
      el.classList.remove('hidden');
      this.app.audio?.sfx('rank', { volume: .8 });
    }
  }

  WW.UI = UI;
})();
