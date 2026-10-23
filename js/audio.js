/* WARWORLD — procedural music and sound effects, synthesized offline with WebAudio. */
(function () {
  'use strict';
  const WW = window.WW;
  const U = WW.U;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.musicOn = true;
      this.sfxOn = true;
      this.musicVolume = 0.42;
      this.sfxVolume = 0.62;
      this.master = null;
      this.musicBus = null;
      this.sfxBus = null;
      this.reverb = null;
      this.noiseBuffer = null;
      this.scheduler = null;
      this.nextStepTime = 0;
      this.step = 0;
      this.playing = false;
      this.combat = false;
      this.lastSfx = {};
      this._lastSfxAny = 0;
      this.tempo = 63;
      this.padVoices = 0;
    }

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx();
      } catch (e) { return; }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 18;
      limiter.ratio.value = 5;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.22;
      this.master.connect(limiter);
      limiter.connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.sfxBus.gain.value = this.sfxVolume;
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      // hand-built cathedral-like impulse
      this.reverb = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 2.9);
      const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.35) * (0.55 + Math.random() * 0.45);
        }
      }
      this.reverb.buffer = impulse;
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.32;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.master);
      // reusable noise buffer
      const nlen = Math.floor(ctx.sampleRate * 2);
      this.noiseBuffer = ctx.createBuffer(1, nlen, ctx.sampleRate);
      const nd = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
      this.ready = true;
      this.setVolumes(this.musicVolume, this.sfxVolume);
      if (this.musicOn) this.startMusic();
    }

    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
    setVolumes(music, sfx) {
      this.musicVolume = U.clamp(music, 0, 1);
      this.sfxVolume = U.clamp(sfx, 0, 1);
      if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicVolume * 0.7 : 0, this.ctx.currentTime, 0.1);
      if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(this.sfxOn ? this.sfxVolume : 0, this.ctx.currentTime, 0.05);
    }
    setMusicOn(on) {
      this.musicOn = !!on;
      if (!on) this.stopMusic();
      else if (this.ready) this.startMusic();
      this.setVolumes(this.musicVolume, this.sfxVolume);
    }
    setSfxOn(on) {
      this.sfxOn = !!on;
      this.setVolumes(this.musicVolume, this.sfxVolume);
    }
    setCombat(on) {
      if (this.combat === !!on) return;
      this.combat = !!on;
      this.tempo = this.combat ? 72 : 63;
    }
    startMusic() {
      if (!this.ready || this.playing) return;
      this.playing = true;
      this.step = 0;
      this.nextStepTime = this.ctx.currentTime + 0.12;
      this.scheduler = setInterval(() => this._schedule(), 180);
      this._schedule();
    }
    stopMusic() {
      this.playing = false;
      if (this.scheduler) { clearInterval(this.scheduler); this.scheduler = null; }
    }

    _schedule() {
      if (!this.ready || !this.playing) return;
      const ctx = this.ctx;
      while (this.nextStepTime < ctx.currentTime + 0.65) {
        this._playStep(this.step, this.nextStepTime);
        this.step++;
        const bpm = this.combat ? 72 : 63;
        this.nextStepTime += 60 / bpm / 2; // 8th notes
      }
    }

    _playStep(step, time) {
      const prog = [
        { root: 146.83, notes: [293.66, 349.23, 440.0, 523.25], bass: 73.42 }, // D minor
        { root: 130.81, notes: [261.63, 329.63, 392.0, 523.25], bass: 65.41 }, // C major
        { root: 116.54, notes: [233.08, 293.66, 349.23, 466.16], bass: 58.27 }, // Bb major
        { root: 110.0, notes: [220.0, 261.63, 329.63, 440.0], bass: 55.0 } // A minor
      ];
      const chord = prog[Math.floor(step / 8) % prog.length];
      const local = step % 8;
      // perpetual low drone, retriggered each chord
      if (local === 0) {
        this._drone(chord.bass, time, 4.4, 0.055);
        this._pad(chord.notes.slice(0, 3).map((f) => f / 2), time, 4.0);
      }
      // gently wandering lute
      const patterns = [0, 2, 1, 3, 2, 1, 3, 0, 0, 1, 2, 3, 1, 2, 0, 3];
      if (step % 2 === 0 || (this.combat && Math.random() < 0.35)) {
        const idx = patterns[local % patterns.length];
        const freq = chord.notes[idx];
        const octave = (step % 16 < 8) ? 1 : 2;
        this._pluck(freq * octave, time, 0.055 + Math.random() * 0.025, 1.2, 0.6);
        if (Math.random() < 0.22) this._pluck(freq * octave * 1.5, time + 0.18, 0.025, 0.8, 0.12);
      }
      // occasional flute melody
      if ((step % 8 === 0 || step % 8 === 3) && Math.random() < (this.combat ? 0.38 : 0.55)) {
        const freq = chord.notes[(local + Math.floor(Math.random() * 2)) % 4] * 2;
        this._flute(freq, time + 0.06, 1.3, 0.032);
      }
      // quiet frame drum
      if (local === 0 || local === 4 || (this.combat && (local === 2 || local === 6))) {
        this._drum(time, local === 0 ? 0.12 : 0.075, 0.42);
      }
      if (local === 6 && Math.random() < 0.22) this._drum(time + 0.07, 0.035, 0.16);
      if (Math.random() < 0.007 && !this.combat) this._chime(chord.notes[3] * 2, time, 0.018);
    }

    _out(node, wet, pan) {
      const ctx = this.ctx;
      let out = node;
      if (pan != null && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        out.connect(p);
        out = p;
      }
      const dry = ctx.createGain();
      dry.gain.value = 1 - (wet || 0);
      out.connect(dry);
      dry.connect(this.musicBus);
      if (wet && this.reverb) {
        const send = ctx.createGain();
        send.gain.value = wet;
        out.connect(send);
        send.connect(this.reverb);
      }
      return out;
    }

    _pluck(freq, time, vol, decay, wet) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = Math.min(5000, freq * 5);
      filter.Q.value = 0.7;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2.005;
      const g2 = ctx.createGain();
      g2.gain.value = 0.28;
      osc.connect(filter); osc2.connect(g2); g2.connect(filter);
      filter.connect(gain);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(vol, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
      osc.frequency.setValueAtTime(freq * 1.006, time);
      osc.frequency.exponentialRampToValueAtTime(freq, time + 0.07);
      const pan = (Math.random() - 0.5) * 0.5;
      this._out(gain, wet == null ? 0.3 : wet, pan);
      osc.start(time); osc2.start(time);
      osc.stop(time + decay + 0.03); osc2.stop(time + decay + 0.03);
    }
    _flute(freq, time, len, vol) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.6 + Math.random();
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = freq * 0.008;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(vol, time + 0.12);
      gain.gain.setValueAtTime(vol, time + len * 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + len);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 1800;
      osc.connect(filter); filter.connect(gain);
      this._out(gain, 0.55, (Math.random() - 0.5) * 0.3);
      osc.start(time); lfo.start(time);
      osc.stop(time + len + 0.04); lfo.stop(time + len + 0.04);
    }
    _drone(freq, time, len, vol) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle'; osc2.frequency.value = freq * 1.005;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 330; filter.Q.value = 1.4;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(vol, time + 0.7);
      gain.gain.setValueAtTime(vol, time + len - 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + len);
      filter.connect(gain);
      osc.connect(filter); osc2.connect(filter);
      this._out(gain, 0.22, 0);
      osc.start(time); osc2.start(time);
      osc.stop(time + len + 0.05); osc2.stop(time + len + 0.05);
    }
    _pad(freqs, time, len) {
      if (!this.ready) return;
      const ctx = this.ctx;
      for (const freq of freqs) {
        const osc = ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = freq;
        const osc2 = ctx.createOscillator();
        osc2.type = 'triangle'; osc2.frequency.value = freq * 1.002;
        const gain = ctx.createGain();
        const vol = 0.011;
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(vol, time + 1.1);
        gain.gain.setValueAtTime(vol, time + len * 0.55);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + len);
        osc.connect(gain); osc2.connect(gain);
        this._out(gain, 0.7, (Math.random() - 0.5) * 0.4);
        osc.start(time); osc2.start(time);
        osc.stop(time + len + 0.03); osc2.stop(time + len + 0.03);
      }
    }
    _drum(time, vol, low) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(92 * (low || 0.4), time);
      osc.frequency.exponentialRampToValueAtTime(46, time + 0.18);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
      osc.connect(gain);
      this._out(gain, 0.15, 0);
      osc.start(time); osc.stop(time + 0.26);
    }
    _chime(freq, time, vol) {
      const ctx = this.ctx;
      for (const [mult, v] of [[1, 1], [2.01, 0.5], [2.99, 0.25]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = freq * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(vol * v, time + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 2.2);
        osc.connect(g); this._out(g, 0.6, 0);
        osc.start(time); osc.stop(time + 2.3);
      }
    }

    // -------------------- SFX --------------------
    sfx(name, opts) {
      if (!this.ready || !this.sfxOn) return;
      opts = opts || {};
      const now = this.ctx.currentTime;
      const last = this.lastSfx[name] || 0;
      const throttles = { sword: 0.09, bow: 0.09, death: 0.14, hammer: 0.12, arrow: 0.1, click: 0.03, deposit: 0.15, coin: 0.08, gate: 0.2 };
      if (throttles[name] && now - last < throttles[name]) return;
      // hard-limit total combat sounds
      if (['sword', 'bow', 'death', 'hit'].includes(name)) {
        if (now - this._lastSfxAny < 0.055) return;
        this._lastSfxAny = now;
      }
      this.lastSfx[name] = now;
      const vol = opts.volume == null ? 1 : U.clamp(opts.volume, 0, 1);
      if (vol <= 0.01) return;
      switch (name) {
        case 'click': this._click(vol); break;
        case 'hover': this._softTick(vol, 0.35); break;
        case 'error': this._error(vol); break;
        case 'build_place': this._thud(vol, 120, 0.28); break;
        case 'build_upgrade': this._pluckSfx(392, 0.6, vol * 0.5, 0.4); break;
        case 'hammer': this._hammer(vol); break;
        case 'chop': this._chop(vol); break;
        case 'rustle': this._rustle(vol); break;
        case 'complete': this._flourish(vol); break;
        case 'rank': this._flourish(vol * 1.1); this._bellSfx(146.8, vol * 0.4); break;
        case 'coin': this._coin(vol); break;
        case 'deposit': this._coin(vol * 0.55); break;
        case 'train': this._horn(vol * 0.6, 0.5); break;
        case 'muster': this._horn(vol * 0.5, 0.35); break;
        case 'horn': this._horn(vol * 0.7, 0.55); break;
        case 'warhorn': this._warhorn(vol); break;
        case 'bell': this._bellSfx(196, vol); break;
        case 'sword': this._sword(vol); break;
        case 'bow': this._bow(vol); break;
        case 'death': this._death(vol); break;
        case 'collapse': this._rumble(vol); break;
        case 'capture': this._bellSfx(146.8, vol); this._warhorn(vol * 0.55); break;
        case 'gate': this._gate(vol); break;
        case 'ship': this._ship(vol); break;
        case 'research': this._research(vol); break;
        case 'rumor': this._rumor(vol); break;
        case 'clear': this._thud(vol, 80, 0.5); break;
        case 'discover': this._flourish(vol * 0.6, 0.85); break;
        case 'warning': this._error(vol * 0.5); break;
        default: this._softTick(vol, 0.4);
      }
    }

    _connectSfx(node, wet) {
      node.connect(this.sfxBus);
      if (wet && this.reverb) {
        const g = this.ctx.createGain();
        g.gain.value = wet;
        node.connect(g); g.connect(this.reverb);
      }
    }
    _noise(time, len) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.start(time);
      src.stop(time + len + 0.05);
      return src;
    }
    _click(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.035);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 1.1;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.08 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      src.connect(f); f.connect(g); this._connectSfx(g, 0);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(480, t + 0.05);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.055 * vol, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(og); this._connectSfx(og, 0.08); o.start(t); o.stop(t + 0.07);
    }
    _softTick(vol, p) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 330;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.035 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g); this._connectSfx(g, 0.1); o.start(t); o.stop(t + 0.1);
    }
    _error(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      for (const freq of [196, 185]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.06 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); this._connectSfx(g, 0.12); o.start(t); o.stop(t + 0.23);
      }
    }
    _thud(vol, freq, len) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + len);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.2 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); this._connectSfx(g, 0.16); o.start(t); o.stop(t + len + 0.02);
      const src = this._noise(t, len * 0.5), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.05 * vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + len * 0.5);
      src.connect(f); f.connect(ng); this._connectSfx(ng, 0.1);
    }
    _hammer(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.09);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1450; f.Q.value = 4;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.11 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.18);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.12);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.12 * vol, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(og); this._connectSfx(og, 0.08); o.start(t); o.stop(t + 0.15);
    }
    _chop(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.08);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(760, t); f.frequency.exponentialRampToValueAtTime(340, t + 0.08); f.Q.value = 2.5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.10 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.2);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(185, t); o.frequency.exponentialRampToValueAtTime(92, t + 0.1);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.08 * vol, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(og); this._connectSfx(og, 0.08); o.start(t); o.stop(t + 0.13);
    }
    _rustle(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.12);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2600; f.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.05 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.22);
    }
    _pluckSfx(freq, len, vol, wet) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); this._connectSfx(g, wet == null ? 0.32 : wet); o.start(t); o.stop(t + len + 0.03);
    }
    _flourish(vol, seq) {
      const notes = seq ? [293.66, 349.23, 440, 587.33] : [293.66, 349.23, 440, 523.25, 659.25];
      notes.forEach((f, i) => {
        const ctx = this.ctx, t = ctx.currentTime + i * 0.11;
        const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.07 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
        o.connect(g); this._connectSfx(g, 0.55); o.start(t); o.stop(t + 1);
      });
    }
    _coin(vol) {
      for (const [freq, delay] of [[1318.5, 0], [1760, 0.065]]) {
        const ctx = this.ctx, t = ctx.currentTime + delay;
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.01;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.055 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        o.connect(g); o2.connect(g2); g2.connect(g); this._connectSfx(g, 0.4);
        o.start(t); o2.start(t); o.stop(t + 0.38); o2.stop(t + 0.38);
      }
    }
    _horn(vol, len) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(146.8, t); o.frequency.linearRampToValueAtTime(196, t + 0.15);
      const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 293.7;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 640; f.Q.value = 1.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09 * vol, t + 0.08);
      g.gain.setValueAtTime(0.09 * vol, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(f); o2.connect(f); f.connect(g); this._connectSfx(g, 0.3);
      o.start(t); o2.start(t); o.stop(t + len + 0.03); o2.stop(t + len + 0.03);
    }
    _warhorn(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      for (const [freq, dl] of [[110, 0], [146.83, 0.32], [110, 0.64]]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(freq, t + dl);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + dl); g.gain.linearRampToValueAtTime(0.1 * vol, t + dl + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dl + 0.5);
        o.connect(f); f.connect(g); this._connectSfx(g, 0.45);
        o.start(t + dl); o.stop(t + dl + 0.55);
      }
    }
    _bellSfx(freq, vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      for (const [mult, v] of [[1, 1], [2.01, 0.55], [2.71, 0.32], [4.08, 0.16]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq * mult;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * vol * v, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
        o.connect(g); this._connectSfx(g, 0.5); o.start(t); o.stop(t + 2.6);
      }
    }
    _sword(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.13);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(1600, t + 0.12); f.Q.value = 1.3;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.1 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.18);
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(2100, t); o.frequency.exponentialRampToValueAtTime(1350, t + 0.1);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.045 * vol, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(og); this._connectSfx(og, 0.3); o.start(t); o.stop(t + 0.15);
    }
    _bow(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.16);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(1100, t); f.frequency.linearRampToValueAtTime(420, t + 0.14); f.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.06 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.2);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(280, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.09);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.045 * vol, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(og); this._connectSfx(og, 0.12); o.start(t); o.stop(t + 0.11);
    }
    _death(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(58, t + 0.45);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.07 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      o.connect(f); f.connect(g); this._connectSfx(g, 0.35); o.start(t); o.stop(t + 0.5);
    }
    _rumble(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 1.1);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 190;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.16 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.35);
    }
    _gate(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(84, t); o.frequency.linearRampToValueAtTime(55, t + 0.4);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 310;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.07 * vol, t); g.gain.linearRampToValueAtTime(0.03, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(f); f.connect(g); this._connectSfx(g, 0.3); o.start(t); o.stop(t + 0.58);
      const src = this._noise(t, 0.4), nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 2;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.03 * vol, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      src.connect(nf); nf.connect(ng); this._connectSfx(ng, 0.2);
    }
    _ship(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.7);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(420, t); f.frequency.linearRampToValueAtTime(280, t + 0.65); f.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.075 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.3);
    }
    _research(vol) {
      this._pluckSfx(523.25, 0.8, 0.04 * vol, 0.5);
      setTimeout(() => this._pluckSfx(783.99, 1.1, 0.035 * vol, 0.5), 130);
    }
    _rumor(vol) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = this._noise(t, 0.35);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 6;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.028 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      src.connect(f); f.connect(g); this._connectSfx(g, 0.4);
    }
  }

  WW.AudioEngine = AudioEngine;
})();
