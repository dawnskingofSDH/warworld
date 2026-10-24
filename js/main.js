/* WARWORLD — application bootstrap, loop, menus, persistence and input. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;
  const D = WW.D;
  const esc = U.esc;
  const SETTINGS_KEY = 'warworld.userSettings.v1';
  const SAVE_KEY = 'warworld.autosave.v1';
  const SETUP_KEY = 'warworld.lastSetup.v1';

  const App = {
    game: null,
    renderer: null,
    audio: null,
    ui: null,
    speed: 1,
    previousSpeed: 1,
    lastFrame: 0,
    lastAutosave: 0,
    saveStatus: '',
    gameDefeated: false,
    cameraKeys: new Set(),
    setupState: { mapSize: 'vast', aiCount: 4, difficulty: 'normal', tutorial: true },
    setupCrestFaction: null,
    started: false,

    init() {
      this.canvas = document.getElementById('world');
      this.loadUserSettings();
      this.audio = new WW.AudioEngine();
      this.applyAudioSettings();
      this.renderer = new WW.Renderer(this.canvas, null);
      this.ui = new WW.UI(this);
      this.renderer.setMinimapCanvas(document.getElementById('minimap'));
      this.bindMenu();
      this.bindSetup();
      this.bindKeyboard();
      this.bindLifecycle();
      this.bindGlobalClicks();
      this.audio.setCombat(false);
      this.updateContinueButton();
      this.restoreSetupState();
      this.lastFrame = performance.now();
      requestAnimationFrame((t) => this.loop(t));
      this.saveStatus = '自动保存已开启。';
      // The title screen can be explored without starting audio; the first gesture starts the music.
      const gesture = () => { this.ensureAudio(); };
      document.addEventListener('pointerdown', gesture, { once: true });
      document.addEventListener('keydown', gesture, { once: true });
    },

    // =========================================================
    // Settings & audio
    // =========================================================
    loadUserSettings() {
      const s = U.storage.get(SETTINGS_KEY, null) || {};
      this.settings = Object.assign({
        musicOn: true, sfxOn: true, musicVolume: 0.42, sfxVolume: 0.62,
        showTerritories: true, tutorial: true
      }, s);
    },
    applyAudioSettings() {
      if (!this.audio) return;
      this.audio.musicVolume = this.settings.musicVolume;
      this.audio.sfxVolume = this.settings.sfxVolume;
      this.audio.musicOn = this.settings.musicOn;
      this.audio.sfxOn = this.settings.sfxOn;
      this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
      if (this.renderer) this.renderer.showTerritories = this.settings.showTerritories !== false;
    },
    saveUserSettings() {
      this.settings.musicVolume = this.audio?.musicVolume ?? this.settings.musicVolume;
      this.settings.sfxVolume = this.audio?.sfxVolume ?? this.settings.sfxVolume;
      this.settings.musicOn = this.audio?.musicOn ?? this.settings.musicOn;
      this.settings.sfxOn = this.audio?.sfxOn ?? this.settings.sfxOn;
      this.settings.showTerritories = this.renderer ? this.renderer.showTerritories : this.settings.showTerritories;
      U.storage.set(SETTINGS_KEY, this.settings);
    },
    ensureAudio() {
      if (!this.audio) return;
      if (!this.audio.ready) {
        this.audio.init();
        this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
        this.audio.setMusicOn(this.settings.musicOn);
        this.audio.setSfxOn(this.settings.sfxOn);
        if (this.settings.musicOn) this.audio.startMusic();
      } else this.audio.resume();
    },
    setMusicVolume(v) {
      this.ensureAudio();
      this.settings.musicVolume = U.clamp(v, 0, 1);
      this.audio.setVolumes(this.settings.musicVolume, this.audio.sfxVolume);
      this.saveUserSettings();
    },
    setSfxVolume(v) {
      this.ensureAudio();
      this.settings.sfxVolume = U.clamp(v, 0, 1);
      this.audio.setVolumes(this.audio.musicVolume, this.settings.sfxVolume);
      this.saveUserSettings();
    },
    setMusicOn(on) {
      this.ensureAudio();
      this.settings.musicOn = !!on;
      this.audio.setMusicOn(this.settings.musicOn);
      this.saveUserSettings();
    },
    setSfxOn(on) {
      this.ensureAudio();
      this.settings.sfxOn = !!on;
      this.audio.setSfxOn(this.settings.sfxOn);
      this.saveUserSettings();
    },
    playSfx(name, x, y, vol) {
      if (!this.audio || !this.audio.ready || !this.settings.sfxOn) return;
      let volume = vol == null ? .8 : vol;
      if (x != null && y != null && this.renderer) {
        const d = U.dist(x, y, this.renderer.camera.x, this.renderer.camera.y);
        volume *= U.clamp(1 - d / 42, 0.02, 1);
      }
      this.audio.sfx(name, { volume });
    },

    // =========================================================
    // Menu & setup
    // =========================================================
    bindMenu() {
      const newBtn = document.getElementById('btn-new-game');
      const contBtn = document.getElementById('btn-continue-game');
      const helpBtn = document.getElementById('btn-menu-help');
      const setBtn = document.getElementById('btn-menu-settings');
      const loadBtn = document.getElementById('btn-menu-load');
      newBtn.addEventListener('click', () => this.showSetup());
      contBtn.addEventListener('click', () => this.loadSavedGame(true));
      loadBtn.addEventListener('click', () => this.loadSavedGame(true));
      helpBtn.addEventListener('click', () => { this.ensureAudio(); this.ui.openHelp(); });
      setBtn.addEventListener('click', () => { this.ensureAudio(); this.ui.openSettings(); });
    },
    updateContinueButton() {
      const cont = document.getElementById('btn-continue-game');
      const load = document.getElementById('btn-menu-load');
      const save = this.readSave();
      if (save && save.game && save.game.factions) {
        cont.classList.remove('hidden');
        load.classList.remove('hidden');
        try {
          const p = (save.game.factions || []).find((f) => f.isPlayer);
          const date = U.dateLabel(save.game.timeDays || 0, true);
          cont.innerHTML = `<span class="btn-glyph">❧</span><span>继续统治 · ${p ? U.esc(D.realmFullName(p)) : ''} · ${date}</span>`;
        } catch (e) {}
      } else {
        cont.classList.add('hidden');
        load.classList.add('hidden');
      }
    },
    showSetup() {
      this.ensureAudio();
      document.getElementById('menu-screen').classList.add('hidden');
      document.getElementById('setup-screen').classList.remove('hidden');
      this.drawSetupCrest();
    },
    hideSetup() {
      document.getElementById('setup-screen').classList.add('hidden');
      document.getElementById('menu-screen').classList.remove('hidden');
      this.updateContinueButton();
    },
    restoreSetupState() {
      const saved = U.storage.get(SETUP_KEY, null);
      if (saved) {
        this.setupState.mapSize = saved.mapSize || 'vast';
        this.setupState.aiCount = saved.aiCount || 4;
        this.setupState.difficulty = saved.difficulty || 'normal';
        this.setupState.tutorial = saved.tutorial !== false;
      }
      const ai = document.getElementById('ai-count');
      const aiVal = document.getElementById('ai-count-value');
      if (ai) ai.value = this.setupState.aiCount;
      if (aiVal) aiVal.textContent = this.setupState.aiCount;
      const tut = document.getElementById('tutorial-toggle');
      if (tut) tut.checked = this.setupState.tutorial;
      this.selectChoice('map-size-options', this.setupState.mapSize);
      this.selectChoice('difficulty-options', this.setupState.difficulty);
    },
    selectChoice(id, value) {
      const box = document.getElementById(id);
      if (!box) return;
      Array.from(box.children).forEach((c) => c.classList.toggle('active', c.dataset.value === value));
    },
    bindSetup() {
      const setup = document.getElementById('setup-screen');
      setup.addEventListener('click', (e) => {
        const close = e.target.closest('#setup-close') || e.target.closest('#setup-back');
        if (close) { this.hideSetup(); return; }
        const map = e.target.closest('[data-value]');
        if (map && map.closest('#map-size-options')) {
          this.selectChoice('map-size-options', map.dataset.value);
          this.setupState.mapSize = map.dataset.value;
          return;
        }
        const diff = e.target.closest('[data-value]');
        if (diff && diff.closest('#difficulty-options')) {
          this.selectChoice('difficulty-options', diff.dataset.value);
          this.setupState.difficulty = diff.dataset.value;
          return;
        }
        if (e.target.closest('#random-name')) {
          const names = D.factionNames;
          document.getElementById('player-name').value = names[Math.floor(Math.random() * names.length)];
          return;
        }
        if (e.target.closest('#reroll-crest')) {
          this.setupCrestFaction = this.makePreviewFaction(document.getElementById('player-name').value.trim());
          this.drawSetupCrest();
          return;
        }
        if (e.target.closest('#setup-start')) {
          this.startNewGame();
        }
      });
      const ai = document.getElementById('ai-count');
      if (ai) ai.addEventListener('input', () => {
        this.setupState.aiCount = parseInt(ai.value, 10);
        document.getElementById('ai-count-value').textContent = ai.value;
      });
      const tut = document.getElementById('tutorial-toggle');
      if (tut) tut.addEventListener('change', () => { this.setupState.tutorial = tut.checked; });
      const input = document.getElementById('player-name');
      if (input) input.addEventListener('input', () => {
        if (this.setupCrestFaction) this.setupCrestFaction.name = input.value.trim() || '无名王朝';
      });
    },
    makePreviewFaction(name) {
      const palettes = D.crestPalettes;
      const symbols = D.crestSymbols;
      const pal = palettes[Math.floor(Math.random() * palettes.length)];
      return {
        name: name || '无名王朝',
        colors: { primary: pal.primary, secondary: pal.secondary, accent: pal.accent },
        crest: symbols[Math.floor(Math.random() * symbols.length)]
      };
    },
    drawSetupCrest() {
      if (!this.setupCrestFaction) this.setupCrestFaction = this.makePreviewFaction(document.getElementById('player-name').value.trim());
      const cv = document.getElementById('setup-crest');
      if (cv && this.renderer) this.renderer.drawCrestToCanvas(cv, this.setupCrestFaction);
    },
    startNewGame() {
      this.ensureAudio();
      const playerNameInput = document.getElementById('player-name');
      const seedInput = document.getElementById('map-seed');
      let playerName = (playerNameInput.value || '').trim().slice(0, 16);
      if (!playerName) {
        playerName = D.factionNames[Math.floor(Math.random() * D.factionNames.length)];
        playerNameInput.value = playerName;
      }
      let seed = (seedInput.value || '').trim();
      if (!seed) seed = 'ww-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 999999).toString(36);
      const settings = {
        playerName,
        mapSize: this.setupState.mapSize,
        aiCount: this.setupState.aiCount,
        difficulty: this.setupState.difficulty,
        seed,
        tutorial: this.setupState.tutorial
      };
      U.storage.set(SETUP_KEY, this.setupState);
      this.launchGame(settings, null, { newGame: true });
    },
    showLoading(title, text) {
      document.getElementById('menu-screen').classList.add('hidden');
      document.getElementById('setup-screen').classList.add('hidden');
      document.getElementById('loading-screen').classList.remove('hidden');
      document.querySelector('#loading-screen h3').textContent = title || '正在绘制世界';
      document.getElementById('loading-text').textContent = text || '山河成形，列国就位……';
      document.getElementById('loading-progress').style.width = '4%';
      if (this.ui) this.ui.closeModal();
    },
    hideLoading() {
      document.getElementById('loading-screen').classList.add('hidden');
    },
    launchGame(settings, saved, opts) {
      opts = opts || {};
      this.showLoading(opts.loadingTitle || '正在绘制世界', opts.loadingText || '山河成形，列国就位……');
      const progress = (p) => {
        const el = document.getElementById('loading-progress');
        if (el) el.style.width = Math.max(4, Math.round(p * 100)) + '%';
        const txt = document.getElementById('loading-text');
        if (txt) {
          if (p < .3) txt.textContent = '抬升山脉，刻下河床……';
          else if (p < .6) txt.textContent = '种下森林，藏好矿脉……';
          else if (p < .85) txt.textContent = '划分领土，点燃村庄的炉火……';
          else txt.textContent = '为你的王朝翻开第一页……';
        }
      };
      setTimeout(() => {
        try {
          let game;
          if (saved) {
            game = new WW.Game(saved.settings || settings, saved, progress);
          } else {
            game = new WW.Game(settings, null, progress);
          }
          this.finalizeGame(game, saved, opts);
        } catch (err) {
          console.error(err);
          this.showLoadingError(err);
        }
      }, 60);
    },
    showLoadingError(err) {
      const load = document.getElementById('loading-screen');
      if (!load) return;
      const panel = load.querySelector('.loading-panel');
      if (panel) panel.innerHTML = `<div class="loading-emblem">!</div><h3>世界未能生成</h3><p>${U.esc(err.message || '未知错误')}</p><button class="action-btn" id="loading-back" style="margin-top:14px">返回主菜单</button><small>请刷新页面后重试。</small>`;
      const btn = document.getElementById('loading-back');
      if (btn) btn.addEventListener('click', () => {
        load.classList.add('hidden');
        document.getElementById('menu-screen').classList.remove('hidden');
        this.updateContinueButton();
      });
    },
    finalizeGame(game, saved, opts) {
      opts = opts || {};
      this.game = game;
      this.gameDefeated = false;
      this.audio.init();
      this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
      this.audio.setSfxOn(this.settings.sfxOn);
      this.audio.setMusicOn(this.settings.musicOn);
      this.audio.startMusic();
      this.renderer.setGame(game);
      this.renderer.setMinimapCanvas(document.getElementById('minimap'));
      this.renderer.showTerritories = this.settings.showTerritories !== false;
      this.ui.setGame(game);
      this.bindGameEvents(game);
      if (opts.camera) this.renderer.focus(opts.camera.x, opts.camera.y);
      else this.renderer.focusPlayer();
      this.speed = opts.speed != null ? opts.speed : 1;
      if (this.speed === 0) this.previousSpeed = 1;
      if (saved && saved.meta && saved.meta.activeSettlementId) {
        this.ui.activeSettlementId = saved.meta.activeSettlementId;
      }
      // show game shell
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('menu-screen').classList.add('hidden');
      document.getElementById('setup-screen').classList.add('hidden');
      document.getElementById('game-shell').classList.remove('hidden');
      document.getElementById('gameover-screen').classList.add('hidden');
      this.gameDefeated = false;
      this.lastFrame = performance.now();
      this.lastAutosave = performance.now();
      this.ui.updateHUD(true);
      if (opts.newGame) {
        this.openWelcome();
      } else {
        this.ui.showSubToast(saved && saved.meta && saved.meta.savedAt ? '编年史已重新翻开。' : '存档已载入。');
      }
      this.saveUserSettings();
      this.updateContinueButton();
      this.started = true;
    },
    bindGameEvents(game) {
      game.on('sfx', (name, x, y) => {
        if (name === 'click') return;
        this.playSfx(name, x, y, .85);
      });
      game.on('battleSfx', (name, x, y) => this.playSfx(name, x, y, .55));
      game.on('rankup', (f, oldRank, newRank) => {
        if (f.id === game.playerFactionId) this.playSfx('rank', null, null, .9);
      });
      game.on('prompt', () => {
        this.ensureAudio();
        this.playSfx('bell', null, null, .4);
        this.ui.updateHUD(true);
      });
      game.on('independence', () => { this.ui.updateHUD(true); });
      game.on('defeat', () => { this.gameDefeated = true; });
      game.on('victory', () => { this.playSfx('rank', null, null, .8); });
      game.on('warDeclared', (war) => {
        if (war.a === game.playerFactionId || war.b === game.playerFactionId) this.ui.updateHUD(true);
      });
    },
    openWelcome() {
      const g = this.game;
      const f = g.player;
      const s = g.ownedSettlements(f.id)[0];
      const body = `<div style="text-align:center;padding-bottom:5px">
          <div class="eyebrow" style="justify-content:center;color:rgba(98,76,43,.6)">THE FIRST PAGE · 第一页</div>
          <h3 style="font-family:var(--font-title);font-weight:400;font-size:32px;letter-spacing:.12em;margin:12px 0 6px;color:#372b1c">${esc(D.realmFullName(f))}</h3>
          <p style="font-size:12.5px;color:rgba(78,62,39,.7);margin:0 0 16px">${U.dateLabel(g.timeDays)}，你的旗帜在「${esc(s ? s.name : '荒野')}」升起。</p>
        </div>
        <div class="effect-line" style="border-left-color:#987f4c;line-height:1.8">你有 <strong>五名居民</strong>、一座村庄大厅，以及一段漫长的岁月。时间是这个世界最真实的资源。</div>
        <div class="split-section" style="margin-top:14px">
          <div><div class="mini-title">第一步</div><ul style="font-size:12px;line-height:1.9;margin:0;padding-left:17px;color:rgba(68,53,33,.82)">
            <li>选中居民，右键树林或浆果丛开始采集。</li>
            <li>从左侧「建造」放置民宅、农田与伐木场。</li>
            <li>资源建筑完工后，派居民进入才会生产。</li>
            <li>随时可以暂停，或在「内政」查看全貌。</li>
          </ul></div>
          <div><div class="mini-title">记住</div><ul style="font-size:12px;line-height:1.9;margin:0;padding-left:17px;color:rgba(68,53,33,.82)">
            <li>资源属于各个定居点，不通用。</li>
            <li>建筑需要工匠施工；建筑工速度更快。</li>
            <li>每座民宅都会帮助你增加人口。</li>
            <li>王室谕令会指引你走下去。</li>
          </ul></div>
        </div>
        <div class="gold-divider"></div>
        <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div style="font-size:11.5px;color:rgba(83,66,41,.6);line-height:1.7">按 <kbd>H</kbd> 随时打开王国法典。<br>按 <kbd>空格</kbd> 暂停，拖动中键移动视野。</div>
          <button class="action-btn primary" data-close-modal style="min-width:150px;padding:10px 14px">翻开编年史</button>
        </div>`;
      this.ui.openModal({ kind: 'welcome', eyebrow: '战争世界 · WARWORLD', title: '你的时代开始了', subtitle: '从五名居民开始，建立属于你的王朝。', body, narrow: true });
      this.ui.setNavActive(null);
    },

    // =========================================================
    // Save / load
    // =========================================================
    readSave() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || !obj.game) return null;
        if (obj.version && obj.version !== D.VERSION) return null;
        return obj;
      } catch (e) { return null; }
    },
    hasSave() { return !!this.readSave(); },
    saveGame(manual) {
      if (!this.game || this.gameDefeated) {
        if (manual) this.ui?.showSubToast('当前状态无法保存。');
        return false;
      }
      try {
        const raw = this.game.toSave();
        const save = {
          version: D.VERSION,
          savedAt: Date.now(),
          game: raw,
          meta: {
            camera: { x: this.renderer.camera.x, y: this.renderer.camera.y, zoom: this.renderer.camera.zoom },
            activeSettlementId: this.ui.activeSettlementId,
            speed: this.speed,
            savedAt: Date.now()
          }
        };
        const serialized = JSON.stringify(save);
        localStorage.setItem(SAVE_KEY, serialized);
        this.lastAutosave = performance.now();
        this.saveStatus = `已保存 · ${new Date().toLocaleTimeString('zh-CN')} · ${(serialized.length / 1024).toFixed(0)} KB`;
        this.updateContinueButton();
        if (manual) {
          this.ui.showSubToast('游戏已保存。');
          this.playSfx('coin', null, null, .4);
        }
        return true;
      } catch (err) {
        console.error(err);
        this.saveStatus = '保存失败：浏览器存储空间可能已满。';
        if (manual) this.ui.showSubToast('保存失败：浏览器存储空间可能已满或不可用。');
        return false;
      }
    },
    loadSavedGame(manual) {
      const save = this.readSave();
      if (!save || !save.game) { if (manual) this.ui.showSubToast('没有找到可读取的存档。'); return; }
      this.ensureAudio();
      const settings = save.game.settings || {};
      const meta = save.meta || {};
      this.launchGame(settings, save.game, {
        loadingTitle: '正在翻开旧日的编年史',
        loadingText: '重新铺开羊皮纸，召回旧日的旗帜……',
        savedMeta: meta
      });
      // The saved camera and active settlement are applied after finalizeGame.
      this._pendingLoadMeta = meta;
    },
    applyPendingLoad() {
      if (!this.game || !this._pendingLoadMeta) return;
      const meta = this._pendingLoadMeta;
      this._pendingLoadMeta = null;
      if (meta.camera) {
        if (meta.camera.zoom) this.renderer.camera.zoom = U.clamp(meta.camera.zoom, 0.5, 2.1);
        this.renderer.focus(meta.camera.x, meta.camera.y);
      }
      if (meta.activeSettlementId && this.game.getSettlement(meta.activeSettlementId)) this.ui.activeSettlementId = meta.activeSettlementId;
      if (meta.speed != null) this.setSpeed(meta.speed);
    },
    returnToMenu() {
      if (this.game) this.saveGame(false);
      if (this.ui) {
        this.ui.closeModal();
        this.ui.closeSubdialog();
        this.ui.closeDrawer();
        this.ui.closeBuild();
        this.ui.clearPrompt();
        this.ui.refs.gameover.classList.add('hidden');
        this.ui.setGame(null);
      }
      this.game = null;
      this.gameDefeated = false;
      this.renderer.setGame(null);
      this.renderer.ctx.clearRect(0, 0, this.renderer.vw, this.renderer.vh);
      document.getElementById('game-shell').classList.add('hidden');
      document.getElementById('gameover-screen').classList.add('hidden');
      document.getElementById('menu-screen').classList.remove('hidden');
      document.getElementById('setup-screen').classList.add('hidden');
      this.updateContinueButton();
      this.audio.setCombat(false);
    },
    startNewFromGameOver() {
      if (this.ui) {
        this.ui.refs.gameover.classList.add('hidden');
        this.ui.closeModal();
        this.ui.clearPrompt();
      }
      document.getElementById('game-shell').classList.add('hidden');
      document.getElementById('gameover-screen').classList.add('hidden');
      document.getElementById('menu-screen').classList.add('hidden');
      document.getElementById('setup-screen').classList.remove('hidden');
      this.game = null;
      this.gameDefeated = false;
      this.drawSetupCrest();
    },

    // =========================================================
    // Keyboard / camera
    // =========================================================
    bindKeyboard() {
      window.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
        if (typing) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          this.cameraKeys.add(e.key);
          if (this.game) e.preventDefault();
          return;
        }
        if (!this.game) {
          if (e.key === 'Escape') {
            if (this.ui.subdialogOpen) this.ui.closeSubdialog();
            else if (this.ui.modalOpen) this.ui.closeModal();
          }
          return;
        }
        if (this.ui.currentPrompt) return;
        if (e.key === 'Escape') {
          // UI.onGlobalKeydown handles Escape and modal stacks; this is a safety net.
          return;
        }
        if (this.ui.modalOpen || this.ui.subdialogOpen) return;
        if (e.code === 'Space') {
          e.preventDefault();
          this.togglePause();
          return;
        }
        if (e.key === '1') { this.setSpeed(0.5); return; }
        if (e.key === '2') { this.setSpeed(1); return; }
        if (e.key === '3') { this.setSpeed(2); return; }
        if (e.key === 'b' || e.key === 'B') { this.ui.toggleBuild(); return; }
        if (e.key === 'i' || e.key === 'I') { this.ui.openInternal(this.ui.activeSettlementId); this.ui.setNavActive('internal'); return; }
        if (e.key === 'd' || e.key === 'D') { this.ui.openDiplomacy(); this.ui.setNavActive('diplomacy'); return; }
        if (e.key === 't' || e.key === 'T') { this.ui.openTech(); this.ui.setNavActive('tech'); return; }
        if (e.key === 'm' || e.key === 'M') { this.ui.openMilitary(); this.ui.setNavActive('military'); return; }
        if (e.key === 'h' || e.key === 'H') { this.ui.openHelp(); return; }
        if (e.key === 'c' || e.key === 'C') { this.ui.openChronicle(); return; }
        if (e.key === 'g' || e.key === 'G') {
          const idle = this.game.getPlayerIdleWorkers();
          if (!idle.length) { this.ui.showSubToast('没有空闲的居民或建筑工。'); return; }
          this.ui.selectUnits(idle.map((u) => u.id), false);
          const first = idle[0];
          this.renderer.focus(first.x, first.y);
          return;
        }
        if (e.key === 'f' || e.key === 'F') {
          const s = this.game.ownedSettlements(this.game.playerFactionId)[0];
          if (s) { this.renderer.focus(s.x, s.y); this.ui.activeSettlementId = s.id; }
          return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          this.saveGame(true);
          this.saveUserSettings();
        }
      });
      window.addEventListener('keyup', (e) => {
        this.cameraKeys.delete(e.key);
      });
      window.addEventListener('blur', () => this.cameraKeys.clear());
    },
    bindGlobalClicks() {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled) return;
        if (!btn.closest('#game-shell') && !btn.closest('#main-menu') && !btn.closest('#setup-screen')) return;
        if (this.audio && this.audio.ready) this.playSfx('click', null, null, .22);
      }, true);
    },
    bindLifecycle() {
      window.addEventListener('beforeunload', () => {
        if (this.game && !this.gameDefeated) this.saveGame(false);
        this.saveUserSettings();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.game && !this.gameDefeated) this.saveGame(false);
        if (!document.hidden) this.ensureAudio();
      });
    },

    // =========================================================
    // Speed / loop
    // =========================================================
    setSpeed(speed) {
      if (![0, 0.5, 1, 2].includes(speed)) return;
      if (speed !== 0) this.previousSpeed = speed;
      this.speed = speed;
      if (this.ui) this.ui.updateHUD(true);
    },
    togglePause() {
      if (!this.game) return;
      if (this.speed === 0) this.setSpeed(this.previousSpeed || 1);
      else { this.previousSpeed = this.speed; this.setSpeed(0); }
    },
    loop(now) {
      requestAnimationFrame((t) => this.loop(t));
      const dt = Math.min(0.2, Math.max(0, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      if (!this.game) {
        this.lastAutosave = now;
        return;
      }
      // camera keyboard
      const camSpeed = 640 * dt / this.renderer.camera.zoom;
      let dx = 0, dy = 0;
      if (this.cameraKeys.has('ArrowLeft')) dx -= camSpeed;
      if (this.cameraKeys.has('ArrowRight')) dx += camSpeed;
      if (this.cameraKeys.has('ArrowUp')) dy -= camSpeed;
      if (this.cameraKeys.has('ArrowDown')) dy += camSpeed;
      if (dx || dy) this.renderer.panByPixels(-dx, -dy);
      const modalPaused = this.ui.modalOpen || this.ui.subdialogOpen || !!this.ui.currentPrompt;
      if (!modalPaused && this.speed > 0 && !this.gameDefeated &&
        !this.game.pendingPrompts.some((p) => p.pause)) {
        this.game.update(dt * this.speed);
      }
      this.renderer.render(now);
      this.ui.tick(now);
      // Combat atmosphere
      if (now - (this._lastCombatCheck || 0) > 500) {
        this._lastCombatCheck = now;
        const cam = this.renderer.camera;
        const inCombat = this.game.units.some((u) => !u.dead && u.def.military && u.state === 'attacking' &&
          Math.hypot(u.x - cam.x, u.y - cam.y) < 30);
        this.audio.setCombat(inCombat);
      }
      // apply a loaded camera after finalize
      if (this._pendingLoadMeta && this.game) this.applyPendingLoad();
      if (!modalPaused && !this.gameDefeated && this.speed > 0 && now - this.lastAutosave > 120000) {
        this.saveGame(false);
        this.lastAutosave = now;
      }
    }
  };

  WW.App = App;

  function boot() {
    try {
      if (!window.WW || !WW.Game) throw new Error('游戏脚本未完整加载。请确认使用浏览器打开，并保持 js 与 css 文件夹完整。');
      App.init();
      const fallback = document.getElementById('boot-fallback');
      if (fallback) fallback.classList.add('hidden');
    } catch (err) {
      console.error(err);
      const fallback = document.getElementById('boot-fallback');
      if (fallback) {
        fallback.classList.remove('hidden');
        const p = fallback.querySelector('p');
        if (p) p.textContent = err.message || String(err);
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
