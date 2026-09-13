/**
 * AudioSystem.js — MASTER_SPEC §21.
 *
 * Original / generated audio only. Sounds are SYNTHESISED with the WebAudio API rather
 * than shipped as files: it keeps the repository free of third-party audio, needs no
 * asset pipeline, and gives every cue a deterministic definition that can be tuned as
 * data.
 *
 * The system is event-driven — it subscribes to the game's EventBus, so no gameplay code
 * knows audio exists. It is also fully inert without an AudioContext, so the simulation
 * runs headless in tests.
 */
import { Events } from '../core/EventBus.js';

/**
 * Cue definitions. Each is a short synthesised envelope, not a sample.
 * type: 'tone' (oscillator) or 'noise' (filtered white noise).
 */
export const CUES = Object.freeze({
  weaponFire:     { type: 'noise', duration: 0.11, gain: 0.55, filter: 1800, sweep: -900 },
  weaponFireHeavy:{ type: 'noise', duration: 0.20, gain: 0.70, filter: 900, sweep: -500 },
  reload:         { type: 'tone', duration: 0.09, gain: 0.28, freq: 420, sweep: 180, wave: 'square' },
  emptyWeapon:    { type: 'tone', duration: 0.05, gain: 0.22, freq: 180, sweep: -40, wave: 'square' },
  hitmarker:      { type: 'tone', duration: 0.05, gain: 0.30, freq: 1200, sweep: 200, wave: 'sine' },
  headshot:       { type: 'tone', duration: 0.09, gain: 0.36, freq: 1750, sweep: 350, wave: 'sine' },
  elimination:    { type: 'tone', duration: 0.26, gain: 0.40, freq: 660, sweep: 330, wave: 'triangle' },
  pickaxeSwing:   { type: 'noise', duration: 0.10, gain: 0.24, filter: 2600, sweep: -1400 },
  pickaxeImpact:  { type: 'noise', duration: 0.09, gain: 0.40, filter: 1100, sweep: -600 },
  footstep:       { type: 'noise', duration: 0.05, gain: 0.13, filter: 900, sweep: -300 },
  jump:           { type: 'tone', duration: 0.07, gain: 0.18, freq: 300, sweep: 140, wave: 'sine' },
  landing:        { type: 'noise', duration: 0.09, gain: 0.26, filter: 620, sweep: -260 },
  buildPlace:     { type: 'tone', duration: 0.08, gain: 0.30, freq: 520, sweep: 260, wave: 'triangle' },
  buildEdit:      { type: 'tone', duration: 0.05, gain: 0.22, freq: 760, sweep: 160, wave: 'sine' },
  editReset:      { type: 'tone', duration: 0.07, gain: 0.24, freq: 400, sweep: -160, wave: 'sine' },
  chestOpen:      { type: 'tone', duration: 0.34, gain: 0.34, freq: 480, sweep: 420, wave: 'triangle' },
  ammoBox:        { type: 'tone', duration: 0.17, gain: 0.28, freq: 380, sweep: 220, wave: 'triangle' },
  pickup:         { type: 'tone', duration: 0.08, gain: 0.26, freq: 880, sweep: 300, wave: 'sine' },
  uiNavigate:     { type: 'tone', duration: 0.04, gain: 0.16, freq: 620, sweep: 90, wave: 'sine' },
  victory:        { type: 'tone', duration: 0.55, gain: 0.42, freq: 520, sweep: 520, wave: 'triangle' }
});

/** §21 — surface-based footstep variation. Lower priority than core movement. */
export const FOOTSTEP_SURFACES = Object.freeze({
  grass: { filter: 900, gain: 0.13 },
  wood: { filter: 1500, gain: 0.17 },
  metal: { filter: 2600, gain: 0.20 },
  stone: { filter: 1100, gain: 0.16 },
  water: { filter: 700, gain: 0.15 }
});

/** Bus names map to the mixer groups in the settings (§19). */
const BUS_FOR_CUE = Object.freeze({
  footstep: 'environment', landing: 'environment', jump: 'environment',
  uiNavigate: 'ui', victory: 'music'
});

export class AudioSystem {
  /**
   * @param {object} [opts]
   * @param {AudioContext} [opts.context]  injected for tests; omitted in the browser
   * @param {import('../core/Settings.js').Settings} [opts.settings]
   */
  constructor({ context = null, settings = null } = {}) {
    this.settings = settings;
    this.context = context;
    this.enabled = false;
    this.buses = {};
    /** Cues played since construction — the test seam, and a debugging aid. */
    this.log = [];
    this.maxLog = 64;
    this._lastFootstep = 0;
  }

  /**
   * Create the AudioContext. Browsers require this to follow a user gesture, so it is
   * deliberately separate from the constructor.
   */
  init(ContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext) {
    if (this.enabled) return true;
    if (!this.context) {
      if (!ContextClass) return false;
      this.context = new ContextClass();
    }
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);

    for (const name of ['sfx', 'music', 'environment', 'ui']) {
      const gain = ctx.createGain();
      gain.connect(this.master);
      this.buses[name] = gain;
    }

    this.enabled = true;
    this.applySettings();
    return true;
  }

  /** §19 — master, music, SFX and environment volumes. */
  applySettings() {
    if (!this.enabled || !this.settings) return;
    const a = this.settings.values.audio;
    this.master.gain.value = a.master;
    this.buses.sfx.gain.value = a.sfx;
    this.buses.music.gain.value = a.music;
    this.buses.environment.gain.value = a.environment;
    this.buses.ui.gain.value = a.sfx;
  }

  /**
   * Play a cue. Always logs, so audio behaviour is testable without an AudioContext.
   * @param {string} name key of CUES
   * @param {object} [overrides] per-call parameter overrides
   */
  play(name, overrides = {}) {
    const cue = { ...CUES[name], ...overrides };
    if (!CUES[name]) return false;

    this.log.push({ name, at: this.context?.currentTime ?? 0 });
    if (this.log.length > this.maxLog) this.log.shift();

    if (!this.enabled) return false;

    const ctx = this.context;
    const now = ctx.currentTime;
    const bus = this.buses[BUS_FOR_CUE[name] ?? 'sfx'];

    const envelope = ctx.createGain();
    // §21 — crisp, not excessively loud: fast attack, short exponential decay.
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(cue.gain, 0.0002), now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + cue.duration);
    envelope.connect(bus);

    let source;
    if (cue.type === 'noise') {
      source = ctx.createBufferSource();
      source.buffer = this._noiseBuffer(cue.duration);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cue.filter, now);
      filter.frequency.linearRampToValueAtTime(
        Math.max(120, cue.filter + (cue.sweep ?? 0)), now + cue.duration
      );
      source.connect(filter);
      filter.connect(envelope);
    } else {
      source = ctx.createOscillator();
      source.type = cue.wave ?? 'sine';
      source.frequency.setValueAtTime(cue.freq, now);
      source.frequency.linearRampToValueAtTime(
        Math.max(40, cue.freq + (cue.sweep ?? 0)), now + cue.duration
      );
      source.connect(envelope);
    }

    source.start(now);
    source.stop(now + cue.duration);
    return true;
  }

  _noiseBuffer(duration) {
    const ctx = this.context;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Footsteps are paced by distance travelled, not by a timer (§21). */
  footstep(surface = 'grass') {
    const params = FOOTSTEP_SURFACES[surface] ?? FOOTSTEP_SURFACES.grass;
    return this.play('footstep', params);
  }

  /**
   * Subscribe to the game's events. This is the only wiring between gameplay and audio —
   * no gameplay system references the audio system.
   */
  attach(bus) {
    const on = (event, fn) => bus.on(event, fn);

    on(Events.WEAPON_FIRED, (e) => {
      const heavy = e.weaponId === 'boltSniper' || e.weaponId === 'rocketLauncher'
        || e.weaponId === 'pumpShotgun';
      this.play(heavy ? 'weaponFireHeavy' : 'weaponFire');
    });
    on(Events.WEAPON_RELOADED, () => this.play('reload'));
    on(Events.PIECE_PLACED, () => this.play('buildPlace'));
    on(Events.PIECE_EDITED, (e) => this.play(e.reset ? 'editReset' : 'buildEdit'));
    on(Events.PLAYER_LANDED, (e) => { if (e.fallDistance > 0.6) this.play('landing'); });
    on(Events.PLAYER_DIED, () => this.play('elimination'));
    on(Events.LOOT_PICKED_UP, () => this.play('pickup'));
    on('weapon:hit', (e) => this.play(e.headshot ? 'headshot' : 'hitmarker'));
    on('weapon:empty', () => this.play('emptyWeapon'));
    on('pickaxe:swing', () => this.play('pickaxeSwing'));
    on('pickaxe:impact', () => this.play('pickaxeImpact'));
    on('chest:opened', () => this.play('chestOpen'));
    on('ammoBox:opened', () => this.play('ammoBox'));
  }

  /** Cue names played, for assertions. */
  get playedCues() {
    return this.log.map((l) => l.name);
  }

  clearLog() {
    this.log.length = 0;
  }
}
