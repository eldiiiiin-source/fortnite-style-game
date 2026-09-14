/**
 * HUD.js — DOM overlay. MASTER_SPEC §18.
 *
 * "The HUD must look like game UI, not generic website UI."
 *
 * Reads game state, writes DOM. Never mutates simulation state. Updates are driven by
 * state changes each frame, never polled on a delay (§18.1).
 */
import { RARITIES, PIECE_TYPES } from '../core/Config.js';
import {
  vitalsBars, materialRow, pushMaterialGain, expireMaterialGains, cssHex as hex
} from './HudModel.js';
import { weaponIconUrl } from './components/WeaponIcon.js';

const HUD_CSS = `
.hud { --hud-bg: rgba(10,13,18,0.66); --hud-edge: rgba(255,255,255,0.14);
  font-family: "Segoe UI", system-ui, sans-serif; user-select: none; }
.hud .panel { background: var(--hud-bg); border: 1px solid var(--hud-edge);
  border-radius: 4px; backdrop-filter: blur(3px); }

/* §18.2 — bottom of the screen, horizontal, shield stacked directly above health. */
.hud .bars { position:absolute; left:50%; bottom:52px; transform:translateX(-50%); width:420px; }
.hud .bar { height:18px; margin-bottom:5px; border-radius:3px; overflow:hidden; position:relative;
  background: var(--hud-bg); border:1px solid var(--hud-edge); }
/* §18.1 — no transition: a bar reflects its value on the frame the value changes. */
.hud .bar > i { display:block; height:100%; width:0; }
.hud .bar > span { position:absolute; right:9px; top:0; line-height:18px; font-size:12px;
  font-weight:800; letter-spacing:.04em; text-shadow:0 1px 3px #000; color:#fff; }

.hud .mats { position:absolute; right:22px; bottom:214px; display:flex; gap:8px;
  align-items:flex-end; }
.hud .mat { padding:5px 11px; font-weight:800; font-size:13px; min-width:46px; text-align:right;
  border-radius:3px; background:var(--hud-bg); border:1px solid var(--hud-edge);
  border-bottom-width:2px; opacity:.62; }
/* §9.4.1 — which material a placement will spend has to be visible at all times. */
.hud .mat.selected { opacity:1; background:rgba(22,28,38,.92); }
.hud .mat.poor { color:#ff6b6b; }

/* §18.3 — harvest feedback, at the materials panel, in the material's own colour. */
.hud .gains { position:absolute; right:22px; bottom:250px; display:flex;
  flex-direction:column; align-items:flex-end; gap:3px; pointer-events:none; }
.hud .gain { padding:3px 9px; font-weight:900; font-size:13px; letter-spacing:.02em;
  border-radius:3px; background:rgba(10,13,18,.72); text-shadow:0 1px 3px #000;
  animation:gainrise .22s ease-out; }
@keyframes gainrise { from { opacity:0; transform:translateY(7px); } }

.hud .buildbar { position:absolute; right:22px; bottom:166px; display:flex; gap:5px; }
.hud .slot { width:60px; height:42px; display:grid; place-items:center; font-size:10px;
  font-weight:700; letter-spacing:.09em; text-transform:uppercase; opacity:.55;
  border:2px solid transparent; color:#e8eef4; }
.hud .slot.active { opacity:1; border-color:#fff; transform:translateY(-2px); }
.hud .slot.poor { color:#ff6b6b; }

.hud .invbar { position:absolute; right:22px; bottom:52px; display:flex; gap:5px; }
.hud .islot { width:62px; height:62px; display:flex; flex-direction:column; justify-content:space-between;
  padding:4px; font-size:9px; border:2px solid #2b3340; color:#e8eef4; text-align:left; }
.hud .islot.active { border-color:#fff; transform:translateY(-3px); }
.hud .islot .nm { font-weight:700; line-height:1.15; }
.hud .islot .am { font-weight:800; font-size:11px; text-align:right; }
.hud .islot .ico { flex:1; margin:1px 0; background-repeat:no-repeat; background-position:center;
  background-size:contain; }
.hud .islot .key { position:absolute; opacity:.5; font-size:8px; }

.hud .crosshair { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:44px; height:44px; }
.hud .crosshair i { position:absolute; background:#fff; box-shadow:0 0 2px #000; }
.hud .hitmarker { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:26px; height:26px; opacity:0; }
.hud .hitmarker i { position:absolute; width:9px; height:2px; background:#fff; box-shadow:0 0 2px #000; }
.hud .hitmarker.show { opacity:1; }
.hud .hitmarker.head i { background:#ffd54a; }
.hud .hitmarker.elim i { background:#ff5a5a; }

.hud .topright { position:absolute; right:22px; top:18px; width:190px; }
.hud .compass { height:26px; position:relative; overflow:hidden; margin-bottom:6px; }
.hud .compass .ticks { position:absolute; top:0; height:100%; display:flex; align-items:center;
  font-size:11px; font-weight:800; color:#dfe7ef; }
.hud .compass .tick { width:52px; text-align:center; }
.hud .compass .needle { position:absolute; left:50%; top:0; width:2px; height:100%;
  background:#ffd54a; transform:translateX(-50%); }
.hud .counts { display:flex; gap:6px; }
.hud .count { flex:1; padding:5px 8px; font-size:11px; font-weight:700; color:#dfe7ef; }
.hud .count b { display:block; font-size:16px; color:#fff; }

.hud .feed { position:absolute; left:20px; top:18px; width:330px; font-size:11px; }
.hud .feed div { padding:4px 9px; margin-bottom:3px; color:#e8eef4; }

.hud .prompt { position:absolute; left:50%; top:58%; transform:translateX(-50%);
  padding:7px 16px; font-size:13px; font-weight:700; color:#fff; display:none; }
.hud .prompt.show { display:block; }
.hud .prompt b { color:#ffd54a; }

.hud .editstate { position:absolute; left:50%; top:63%; transform:translateX(-50%);
  padding:5px 14px; font-size:11px; font-weight:800; letter-spacing:.12em;
  text-transform:uppercase; color:#4cd94c; display:none; }
.hud .editstate.show { display:block; }

.hud .minimap { margin-top:8px; padding:4px; line-height:0; }
.hud .minimap canvas { display:block; border-radius:2px; }

.hud .stormbar { position:absolute; left:50%; top:84px; transform:translateX(-50%);
  display:none; align-items:center; gap:12px; padding:8px 18px; font-size:12px; }
.hud .stormbar.show { display:flex; }
.hud .stormbar .phase { font-weight:900; letter-spacing:.12em; text-transform:uppercase;
  color:#c9a6ff; }
.hud .stormbar .timer { font-weight:900; font-size:15px; font-variant-numeric:tabular-nums; }
.hud .stormbar .dmg { color:#ff8b8b; font-weight:800; font-size:11px; }
.hud .stormbar.shrinking .phase { color:#ff9de0; }

.hud .dropbar { position:absolute; left:50%; top:84px; transform:translateX(-50%);
  display:none; padding:9px 20px; font-size:12.5px; font-weight:800; letter-spacing:.1em;
  text-transform:uppercase; }
.hud .dropbar.show { display:block; }
.hud .dropbar b { color:var(--hud-accent, #ffd54a); }

.hud .stormwarn { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  display:none; padding:14px 32px; font-size:17px; font-weight:900; letter-spacing:.16em;
  text-transform:uppercase; color:#ffd0f5; background:rgba(90,20,120,.35);
  border:1px solid rgba(220,140,255,.5); border-radius:4px; pointer-events:none;
  animation:warnpulse 1.1s ease-in-out infinite; }
.hud .stormwarn.show { display:block; }
@keyframes warnpulse { 50% { opacity:.55; } }

.hud .debug { position:absolute; left:20px; bottom:18px;
  font:11px/1.5 ui-monospace,monospace; opacity:.65; padding:6px 10px; color:#cfd8e3; }
`;

export class HUD {
  constructor(root = document.getElementById('hud')) {
    this.root = root;
    // The stylesheet is scoped to .hud, so the HUD styles correctly in any container.
    this.root?.classList.add('hud');
    this.killFeed = [];
    this._hitmarkerTimer = 0;
    /** §18.3 — live material-gain readouts, and the clock they expire against. */
    this.materialGains = [];
    this._gainClock = 0;
    if (!this.root) return;

    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    document.head.appendChild(style);

    this.root.innerHTML = `
      <div class="feed" data-feed></div>

      <div class="topright">
        <div class="compass panel">
          <div class="ticks" data-ticks></div>
          <div class="needle"></div>
        </div>
        <div class="counts">
          <div class="count panel">ALIVE<b data-alive>0</b></div>
          <div class="count panel">ELIMS<b data-elims>0</b></div>
        </div>
        <div class="minimap panel" data-minimap></div>
      </div>

      <div class="stormbar panel" data-stormbar></div>
      <div class="dropbar panel" data-dropbar></div>
      <div class="stormwarn" data-stormwarn></div>

      <div class="crosshair" data-crosshair>
        <i data-ch="t"></i><i data-ch="b"></i><i data-ch="l"></i><i data-ch="r"></i>
      </div>
      <div class="hitmarker" data-hitmarker>
        <i style="transform:rotate(45deg) translate(-6px,-6px)"></i>
        <i style="transform:rotate(-45deg) translate(-6px,6px)"></i>
        <i style="transform:rotate(45deg) translate(6px,6px)"></i>
        <i style="transform:rotate(-45deg) translate(6px,-6px)"></i>
      </div>

      <div class="prompt panel" data-prompt></div>
      <div class="editstate panel" data-editstate>Editing</div>

      <div class="bars">
        <div class="bar shield"><i data-shield-fill></i><span data-shield-text>0</span></div>
        <div class="bar health"><i data-health-fill></i><span data-health-text>100</span></div>
      </div>

      <div class="gains" data-gains></div>
      <div class="mats" data-mats></div>
      <div class="buildbar" data-buildbar></div>
      <div class="invbar" data-invbar></div>
      <div class="debug panel" data-debug></div>
    `;

    const q = (sel) => this.root.querySelector(sel);
    this.el = {
      feed: q('[data-feed]'), ticks: q('[data-ticks]'),
      alive: q('[data-alive]'), elims: q('[data-elims]'),
      shieldFill: q('[data-shield-fill]'), shieldText: q('[data-shield-text]'),
      healthFill: q('[data-health-fill]'), healthText: q('[data-health-text]'),
      mats: q('[data-mats]'), gains: q('[data-gains]'),
      buildbar: q('[data-buildbar]'), invbar: q('[data-invbar]'),
      crosshair: q('[data-crosshair]'), hitmarker: q('[data-hitmarker]'),
      prompt: q('[data-prompt]'), editstate: q('[data-editstate]'), debug: q('[data-debug]'),
      minimap: q('[data-minimap]'), stormbar: q('[data-stormbar]'),
      dropbar: q('[data-dropbar]'), stormwarn: q('[data-stormwarn]')
    };

    this._buildStatic();
  }

  _buildStatic() {
    this.el.mats.innerHTML = materialRow({}).map((m) =>
      `<div class="mat" data-mat="${m.id}" style="color:${m.color}">0</div>`
    ).join('');

    this.el.buildbar.innerHTML = PIECE_TYPES.map((t) =>
      `<div class="slot panel" data-piece="${t}">${t}</div>`
    ).join('');

    // Compass ticks every 45 degrees, repeated so it can scroll seamlessly.
    const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    this.el.ticks.innerHTML = [...points, ...points, ...points]
      .map((p) => `<div class="tick">${p}</div>`).join('');
  }

  /** @param {object} s the snapshot from Game.hudState() */
  update(s, dt = 0) {
    if (!this.root) return;

    // §18.2 — green health, blue shield, each showing its value as well as its fill. The
    // numbers come from HudModel so the bar and the readout are one decision, not two.
    const bars = vitalsBars(s);
    this._setBar(this.el.healthFill, this.el.healthText, bars.health);
    this._setBar(this.el.shieldFill, this.el.shieldText, bars.shield);

    // §9.4.1 — counts, plus which material a placement will actually spend.
    const mats = materialRow(s);
    let poor = false;
    for (const m of mats) {
      const el = this.el.mats.querySelector(`[data-mat="${m.id}"]`);
      if (!el) continue;
      el.textContent = m.count;
      el.classList.toggle('selected', m.selected);
      el.classList.toggle('poor', m.selected && !m.affordable);
      if (m.selected) poor = !m.affordable;
    }

    for (const t of PIECE_TYPES) {
      const el = this.el.buildbar.querySelector(`[data-piece="${t}"]`);
      if (!el) continue;
      el.classList.toggle('active', !!s.buildMode && s.selectedPiece === t);
      el.classList.toggle('poor', poor);
    }

    this._renderMaterialGains(dt);

    this._renderInventory(s);
    this._renderCrosshair(s);
    this._renderCompass(s.yaw ?? 0);

    this.el.alive.textContent = s.playersAlive ?? 1;
    this.el.elims.textContent = s.eliminations ?? 0;

    // §18 — interaction prompts.
    if (s.interactPrompt) {
      this.el.prompt.innerHTML = `<b>[E]</b> ${s.interactPrompt}`;
      this.el.prompt.classList.add('show');
    } else {
      this.el.prompt.classList.remove('show');
    }

    // §18 — edit state indicator.
    this.el.editstate.classList.toggle('show', !!s.editing);
    if (s.editing) {
      this.el.editstate.textContent = s.editSelection?.length
        ? `Editing · ${s.editSelection.length}/${s.editTiles}`
        : 'Editing';
    }

    if (this._hitmarkerTimer > 0) {
      this._hitmarkerTimer -= dt;
      if (this._hitmarkerTimer <= 0) this.el.hitmarker.className = 'hitmarker';
    }

    this._renderStorm(s);

    if (s.stats) {
      this.el.debug.textContent =
        `${(1000 / Math.max(s.stats.frameMs, 0.01)).toFixed(0)} fps · ` +
        `sim ${s.stats.simMs.toFixed(2)}ms · pieces ${s.pieceCount ?? 0}`;
    }
  }

  /** §18.1, §18.2 — one bar, painted from its model. No tween: the fill IS the value. */
  _setBar(fill, text, bar) {
    fill.style.width = `${bar.fraction * 100}%`;
    fill.style.background = `linear-gradient(180deg,${bar.colors.top},${bar.colors.bottom})`;
    text.textContent = bar.value;
  }

  /**
   * §18.3 — harvest feedback.
   *
   * Driven by the material-gained event through `showMaterialGain`; this only ages what is
   * already there. The HUD owns the one clock, and `HudModel` owns what a gain says.
   */
  _renderMaterialGains(dt) {
    if (this.materialGains.length === 0) return;
    this._gainClock += dt;
    const before = this.materialGains.length;
    this.materialGains = expireMaterialGains(this.materialGains, this._gainClock);
    if (this.materialGains.length !== before) this._paintGains();
  }

  _paintGains() {
    this.el.gains.innerHTML = this.materialGains.map((g) =>
      `<div class="gain" style="color:${g.color}">+${g.amount} ${g.label}</div>`
    ).join('');
  }

  /**
   * §18.3 — a material was gained. Called from the MATERIAL_GAINED event, never polled.
   * Repeated swings on the same material stack into one growing readout.
   */
  showMaterialGain(type, amount) {
    if (!this.root) return;
    this.materialGains = pushMaterialGain(this.materialGains, {
      type, amount, now: this._gainClock
    });
    this._paintGains();
  }

  /** BATTLE_ROYALE_SPEC §8.4 — storm timer, phase, damage rate and warning. */
  _renderStorm(s) {
    const storm = s.storm;

    // Drop phase gets its own readout instead of the storm bar.
    this.el.dropbar.classList.toggle('show', !!s.dropPhase);
    if (s.dropPhase) {
      const state = s.descentState;
      const text = state === 'inTransport'
        ? 'Press <b>SPACE</b> to jump'
        : state === 'freefall'
          ? 'Freefall — <b>SPACE</b> to deploy glider'
          : state === 'gliding' ? 'Gliding' : 'Landing';
      this.el.dropbar.innerHTML = text;
    }

    const active = !!storm && storm.state !== 'idle' && !s.dropPhase;
    this.el.stormbar.classList.toggle('show', active);
    this.el.stormbar.classList.toggle('shrinking', active && storm.shrinking);
    if (active) {
      const mins = Math.floor(storm.timer / 60);
      const secs = Math.floor(storm.timer % 60);
      this.el.stormbar.innerHTML =
        `<span class="phase">${storm.shrinking ? 'Storm Closing' : storm.phaseName}</span>` +
        `<span class="timer">${mins}:${String(secs).padStart(2, '0')}</span>` +
        (storm.damagePerSecond > 0 ? `<span class="dmg">${storm.damagePerSecond} HP/s</span>` : '');
    }

    // Inside the storm is unmistakable.
    this.el.stormwarn.classList.toggle('show', !!s.inStorm);
    if (s.inStorm) this.el.stormwarn.textContent = 'Move to the safe zone';
  }

  /** Attach the minimap canvas once. */
  attachMinimap(element) {
    if (!this.root || !this.el.minimap) return;
    this.el.minimap.replaceChildren(element);
  }

  setMinimapVisible(visible) {
    if (this.el?.minimap) this.el.minimap.style.display = visible ? 'block' : 'none';
  }

  _renderInventory(s) {
    const inv = s.inventory;
    if (!inv) return;

    const pickaxe = `<div class="islot panel${s.pickaxeEquipped ? ' active' : ''}">
      <div class="nm">Pickaxe</div><div class="am">—</div></div>`;

    const slots = inv.slots.map((slot, i) => {
      const active = (!s.pickaxeEquipped && i === s.selectedSlot) ? ' active' : '';
      if (!slot) return `<div class="islot panel${active}"></div>`;
      if (slot.kind === 'weapon') {
        const colour = hex(RARITIES[slot.rarity].color);
        const w = slot.weapon;
        // §12.1.1 — the slot shows the weapon's own model, the same one the hand and the
        // world pickup are built from.
        const icon = weaponIconUrl(w);
        return `<div class="islot panel${active}" style="border-color:${colour}">
          <div class="nm">${w.name}</div>
          <div class="ico"${icon ? ` style="background-image:url(${icon})"` : ''}></div>
          <div class="am">${w.ammoInMag}<span style="opacity:.6">/${inv.ammo[w.ammoType] ?? 0}</span></div>
        </div>`;
      }
      return `<div class="islot panel${active}"><div class="nm">${slot.id ?? ''}</div>
        <div class="am">${slot.count ?? ''}</div></div>`;
    }).join('');

    this.el.invbar.innerHTML = pickaxe + slots;
  }

  /** Crosshair opens with spread; build mode collapses it to a dot (§18). */
  _renderCrosshair(s) {
    const gap = s.buildMode ? 0 : Math.round((s.spreadDegrees ?? 0) * 13);
    const arm = 8;
    const c = 22;
    const set = (k, css) => {
      const el = this.el.crosshair.querySelector(`[data-ch="${k}"]`);
      if (el) Object.assign(el.style, css);
    };
    set('t', { left: `${c - 1}px`, top: `${c - gap - arm}px`, width: '2px', height: `${arm}px` });
    set('b', { left: `${c - 1}px`, top: `${c + gap}px`, width: '2px', height: `${arm}px` });
    set('l', { left: `${c - gap - arm}px`, top: `${c - 1}px`, width: `${arm}px`, height: '2px' });
    set('r', { left: `${c + gap}px`, top: `${c - 1}px`, width: `${arm}px`, height: '2px' });
  }

  /** §18 compass — yaw 0 faces north (-Z), increasing clockwise. */
  _renderCompass(yaw) {
    const deg = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
    const tickWidth = 52;
    const offset = -(deg / 45) * tickWidth - tickWidth * 8 + 95;
    this.el.ticks.style.transform = `translateX(${offset}px)`;
  }

  /** §13.1 — immediate hit feedback, visually distinct for headshots and eliminations. */
  showHitmarker({ headshot = false, elimination = false } = {}) {
    if (!this.root) return;
    this.el.hitmarker.className =
      `hitmarker show${headshot ? ' head' : ''}${elimination ? ' elim' : ''}`;
    this._hitmarkerTimer = 0.14;
  }

  pushKillFeed(text) {
    if (!this.root) return;
    this.killFeed.unshift(text);
    this.killFeed = this.killFeed.slice(0, 5);
    this.el.feed.innerHTML = this.killFeed.map((k) => `<div class="panel">${k}</div>`).join('');
  }
}
