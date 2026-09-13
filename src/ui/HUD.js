/**
 * HUD.js — DOM overlay. MASTER_SPEC §10, references/ui/01-hud-layout.md.
 *
 * Reads game state, writes DOM. Never mutates simulation state.
 */
import { VITALS, MATERIALS, MATERIAL_ORDER, RARITIES, PIECE_TYPES, BUILD } from '../core/Config.js';

const HUD_CSS = `
#hud .panel { background: rgba(8,10,14,0.62); border-radius: 6px; }
#hud .bars { position: absolute; left: 50%; bottom: 48px; transform: translateX(-50%); width: 360px; }
#hud .bar { height: 16px; margin-bottom: 6px; border-radius: 3px; overflow: hidden; position: relative; }
#hud .bar > i { display: block; height: 100%; transition: width 120ms linear; }
#hud .bar > span { position: absolute; right: 8px; top: 0; line-height: 16px; font-size: 12px;
  font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,0.9); }
#hud .shield > i { background: #3FD2E8; }
#hud .health > i { background: #FFFFFF; }
#hud .mats { position: absolute; right: 24px; bottom: 196px; display: flex; gap: 10px; }
#hud .mat { padding: 4px 10px; font-weight: 700; font-size: 13px; min-width: 52px; text-align: right; }
#hud .buildbar { position: absolute; right: 24px; bottom: 152px; display: flex; gap: 6px; }
#hud .slot { width: 56px; height: 44px; display: grid; place-items: center; font-size: 11px;
  opacity: 0.62; border: 2px solid transparent; text-transform: uppercase; letter-spacing: 0.04em; }
#hud .slot.active { opacity: 1; border-color: #fff; }
#hud .slot.poor { color: #E84C4C; }
#hud .invbar { position: absolute; right: 24px; bottom: 48px; display: flex; gap: 6px; }
#hud .islot { width: 56px; height: 56px; display: grid; place-items: center; font-size: 10px;
  border: 3px solid #2a2f38; text-align: center; padding: 2px; }
#hud .islot.active { outline: 2px solid #fff; }
#hud .crosshair { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  width: 40px; height: 40px; }
#hud .crosshair i { position: absolute; background: #fff; box-shadow: 0 0 2px #000; }
#hud .storm { position: absolute; left: 50%; top: 20px; transform: translateX(-50%);
  padding: 8px 16px; text-align: center; font-size: 13px; }
#hud .feed { position: absolute; left: 20px; top: 20px; width: 400px; font-size: 12px; }
#hud .feed div { padding: 3px 8px; margin-bottom: 3px; }
#hud .debug { position: absolute; left: 20px; bottom: 20px; font: 11px/1.5 ui-monospace, monospace;
  opacity: 0.7; padding: 6px 10px; }
`;

export class HUD {
  constructor(root = document.getElementById('hud')) {
    this.root = root;
    this.killFeed = [];
    if (!this.root) return;

    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    document.head.appendChild(style);

    this.root.innerHTML = `
      <div class="storm panel" data-storm></div>
      <div class="feed" data-feed></div>
      <div class="crosshair" data-crosshair>
        <i data-ch="t"></i><i data-ch="b"></i><i data-ch="l"></i><i data-ch="r"></i>
      </div>
      <div class="bars">
        <div class="bar shield panel"><i data-shield-fill></i><span data-shield-text></span></div>
        <div class="bar health panel"><i data-health-fill></i><span data-health-text></span></div>
      </div>
      <div class="mats" data-mats></div>
      <div class="buildbar" data-buildbar></div>
      <div class="invbar" data-invbar></div>
      <div class="debug panel" data-debug></div>
    `;

    this.el = {
      storm: this.root.querySelector('[data-storm]'),
      feed: this.root.querySelector('[data-feed]'),
      shieldFill: this.root.querySelector('[data-shield-fill]'),
      shieldText: this.root.querySelector('[data-shield-text]'),
      healthFill: this.root.querySelector('[data-health-fill]'),
      healthText: this.root.querySelector('[data-health-text]'),
      mats: this.root.querySelector('[data-mats]'),
      buildbar: this.root.querySelector('[data-buildbar]'),
      invbar: this.root.querySelector('[data-invbar]'),
      debug: this.root.querySelector('[data-debug]'),
      crosshair: this.root.querySelector('[data-crosshair]')
    };

    this._buildStaticBars();
  }

  _buildStaticBars() {
    this.el.mats.innerHTML = MATERIAL_ORDER
      .map((m) => `<div class="mat panel" data-mat="${m}"
        style="color:#${MATERIALS[m].color.toString(16).padStart(6, '0')}">0</div>`)
      .join('');

    this.el.buildbar.innerHTML = PIECE_TYPES
      .map((t) => `<div class="slot panel" data-piece="${t}">${t}</div>`)
      .join('');
  }

  /**
   * @param {object} s  { health, shield, materials, buildMode, selectedPiece,
   *                      selectedMaterial, inventory, storm, spreadDegrees, stats }
   */
  update(s) {
    if (!this.root) return;

    const hp = Math.round(s.health ?? 0);
    const sh = Math.round(s.shield ?? 0);
    this.el.healthFill.style.width = `${(hp / VITALS.maxHealth) * 100}%`;
    this.el.shieldFill.style.width = `${(sh / VITALS.maxShield) * 100}%`;
    this.el.healthText.textContent = hp;
    this.el.shieldText.textContent = sh;

    for (const m of MATERIAL_ORDER) {
      const el = this.el.mats.querySelector(`[data-mat="${m}"]`);
      if (el) el.textContent = Math.floor(s.materials?.[m] ?? 0);
    }

    for (const t of PIECE_TYPES) {
      const el = this.el.buildbar.querySelector(`[data-piece="${t}"]`);
      if (!el) continue;
      el.classList.toggle('active', s.buildMode && s.selectedPiece === t);
      // §10 — insufficient material is shown on the slot itself.
      el.classList.toggle('poor', (s.materials?.[s.selectedMaterial] ?? 0) < BUILD.cost);
    }

    this._renderInventory(s.inventory, s.selectedSlot);
    this._renderCrosshair(s.spreadDegrees ?? 0, s.buildMode);

    if (s.storm) {
      this.el.storm.textContent =
        `Phase ${s.storm.phase ?? '-'} · ${Math.max(0, Math.ceil(s.storm.timer ?? 0))}s · r=${Math.round(s.storm.radius ?? 0)}m`;
    }

    if (s.stats) {
      this.el.debug.textContent =
        `tick ${s.stats.tick}  sim ${s.stats.simMs.toFixed(2)}ms  frame ${s.stats.frameMs.toFixed(2)}ms  pieces ${s.pieceCount ?? 0}`;
    }
  }

  _renderInventory(inventory, selectedSlot) {
    if (!inventory) return;
    const html = inventory.slots.map((slot, i) => {
      const active = i === selectedSlot ? ' active' : '';
      if (!slot) return `<div class="islot panel${active}"></div>`;
      if (slot.kind === 'tool') return `<div class="islot panel${active}">TOOL</div>`;
      if (slot.kind === 'weapon') {
        const colour = `#${RARITIES[slot.rarity].color.toString(16).padStart(6, '0')}`;
        const w = slot.weapon;
        return `<div class="islot panel${active}" style="border-color:${colour}">
          ${w.name}<br>${w.ammoInMag}/${inventory.ammo[w.ammoType] ?? 0}</div>`;
      }
      return `<div class="islot panel${active}">${slot.id ?? ''}</div>`;
    }).join('');
    this.el.invbar.innerHTML = html;
  }

  /** §10 — crosshair gap opens with spread; build mode collapses it to a dot. */
  _renderCrosshair(spreadDegrees, buildMode) {
    const gap = buildMode ? 0 : Math.round(spreadDegrees * 14);
    const arm = 7;
    const set = (k, css) => {
      const el = this.el.crosshair.querySelector(`[data-ch="${k}"]`);
      if (el) Object.assign(el.style, css);
    };
    const c = 20;
    set('t', { left: `${c - 1}px`, top: `${c - gap - arm}px`, width: '2px', height: `${arm}px` });
    set('b', { left: `${c - 1}px`, top: `${c + gap}px`, width: '2px', height: `${arm}px` });
    set('l', { left: `${c - gap - arm}px`, top: `${c - 1}px`, width: `${arm}px`, height: '2px' });
    set('r', { left: `${c + gap}px`, top: `${c - 1}px`, width: `${arm}px`, height: '2px' });
  }

  pushKillFeed(text) {
    if (!this.root) return;
    this.killFeed.unshift({ text, at: performance.now() });
    this.killFeed = this.killFeed.slice(0, 5); // §10 — last 5 only
    this.el.feed.innerHTML = this.killFeed
      .map((k) => `<div class="panel">${k.text}</div>`).join('');
  }
}
