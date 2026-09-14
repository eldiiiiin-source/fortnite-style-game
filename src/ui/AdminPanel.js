/**
 * AdminPanel.js — ADMIN_PANEL_SPEC §3, §16.
 *
 * The developer UI. Every control calls AdminService — there is no admin logic here, and
 * the console below calls the same methods, so there is exactly one logic path (§16).
 *
 * The panel only constructs and only binds F8 when DEV_MODE is on (§1). With it off,
 * `install` returns without creating anything, so there is no DOM to find and no listener
 * to trigger.
 */
import { el, mount, formatNumber } from './dom.js';
import { ADMIN, BOT_DIFFICULTY, TEST_LOADOUTS, MATCH } from '../meta/MetaConfig.js';
import {
  WEAPONS, RARITY_ORDER, CONSUMABLES, MATERIAL_CAP, MATERIAL_ORDER, MATERIALS, DEV_ACTIONS
} from '../core/Config.js';
import { COSMETICS, CATEGORY_LABELS } from '../meta/CosmeticCatalog.js';
import { BotState } from '../world/Bot.js';

const ADMIN_CSS = `
#admin-panel { position:fixed; inset:52px 28px 28px; z-index:80; display:none;
  grid-template-columns:168px 1fr 300px; font-family:"Segoe UI",system-ui,sans-serif;
  color:#e8eef6; background:rgba(9,13,19,.97); border:1px solid rgba(255,255,255,.18);
  border-radius:5px; box-shadow:0 24px 80px rgba(0,0,0,.7); overflow:hidden; }
#admin-panel.open { display:grid; }
#admin-panel .a-nav { display:flex; flex-direction:column; padding:9px 0;
  background:rgba(0,0,0,.32); border-right:1px solid rgba(255,255,255,.1); overflow-y:auto; }
#admin-panel .a-nav button { padding:9px 15px; font:800 10.5px/1 inherit; letter-spacing:.11em;
  text-transform:uppercase; text-align:left; color:#7b8798; background:none; border:none;
  border-left:2px solid transparent; cursor:pointer; }
#admin-panel .a-nav button:hover { color:#cfd8e3; }
#admin-panel .a-nav button.active { color:#ff8b85; border-left-color:#ff8b85;
  background:rgba(255,90,90,.08); }
#admin-panel .a-main { padding:16px 20px; overflow-y:auto; }
#admin-panel .a-side { padding:14px; background:rgba(0,0,0,.28);
  border-left:1px solid rgba(255,255,255,.1); overflow-y:auto;
  font:11px/1.55 ui-monospace,monospace; color:#9fb0c4; }
#admin-panel h3 { margin:0 0 12px; font-size:12px; letter-spacing:.16em;
  text-transform:uppercase; color:#ff8b85; }
#admin-panel h4 { margin:16px 0 7px; font-size:10px; letter-spacing:.13em;
  text-transform:uppercase; color:#64748b; }
#admin-panel .a-row { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:9px; align-items:center; }
#admin-panel .a-btn { padding:6px 11px; font:700 11px/1 inherit; color:#e8eef6; cursor:pointer;
  background:#242f3e; border:1px solid rgba(255,255,255,.18); border-radius:3px; }
#admin-panel .a-btn:hover { background:#31405380; filter:brightness(1.3); }
#admin-panel .a-btn.danger { background:#5c2320; border-color:#ff8b85; }
#admin-panel .a-btn.on { background:#3d5a2a; border-color:#8fd96a; }
#admin-panel input, #admin-panel select { padding:5px 8px; font:11px inherit; color:#e8eef6;
  background:#1a2432; border:1px solid rgba(255,255,255,.18); border-radius:3px; }
#admin-panel input[type=number] { width:74px; }
#admin-panel .a-label { font-size:10.5px; color:#7b8798; min-width:62px; }
#admin-panel .a-log div { padding:2px 0; border-bottom:1px solid rgba(255,255,255,.05);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#admin-panel .a-stat { display:flex; justify-content:space-between; padding:2px 0; }
#admin-panel .a-stat b { color:#e8eef6; }

#admin-console { position:fixed; left:0; right:0; bottom:0; z-index:90; display:none;
  font-family:ui-monospace,monospace; background:rgba(6,9,14,.97);
  border-top:1px solid rgba(255,139,133,.4); }
#admin-console.open { display:block; }
#admin-console .c-out { max-height:190px; overflow-y:auto; padding:9px 14px;
  font-size:11.5px; line-height:1.6; color:#9fb0c4; }
#admin-console .c-out .cmd { color:#ffd54a; }
#admin-console .c-out .err { color:#ff8b85; }
#admin-console .c-out .ok { color:#8fd96a; }
#admin-console input { width:100%; padding:10px 14px; font:12.5px ui-monospace,monospace;
  color:#e8eef6; background:rgba(0,0,0,.4); border:none; border-top:1px solid rgba(255,255,255,.1);
  outline:none; }
`;

const CATEGORIES = [
  'player', 'inventory', 'building', 'bots', 'match',
  'storm', 'world', 'profile', 'shop', 'performance', 'debug'
];

export class AdminPanel {
  /**
   * @param {import('../app/Application.js').Application} app
   * @param {object} ui
   */
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.admin = app.admin;
    this.category = 'player';
    this.open = false;
    this.root = null;
    this.console = null;
  }

  /** §1 — with DEV_MODE off this creates nothing and binds nothing. */
  install(parent = document.body) {
    if (!this.admin.enabled) return false;

    const style = document.createElement('style');
    style.textContent = ADMIN_CSS;
    document.head.appendChild(style);

    this.root = el('div', { id: 'admin-panel' });
    parent.appendChild(this.root);

    this.console = new CommandConsole(this.app, this.ui);
    this.console.install(parent);

    // §1.4 — a persistent indicator so test footage is never mistaken for normal play.
    parent.appendChild(el('div.dev-badge', { text: 'DEV MODE' }));

    // §1.2 / MASTER_SPEC §4.5 — one keydown listener, and it carries NO key code of its
    // own. Every key is resolved through the game's binding table at the moment it arrives,
    // so these are rebindable in Settings, persisted, and conflict-checked exactly like
    // `jump` is. The panel used to match `ADMIN.toggleKey` and a hard-coded 'Backquote',
    // which put F8 and ` outside the binding system altogether.
    this._onKey = (e) => {
      const action = this.actionFor(e.code);
      if (!action) return;
      e.preventDefault();
      this.runAction(action);
    };
    window.addEventListener('keydown', this._onKey);
    return true;
  }

  /** Which developer action, if any, the pressed code is bound to right now. */
  actionFor(code) {
    const bindings = this.app.settings?.bindings ?? {};
    return DEV_ACTIONS.find((action) => bindings[action] === code) ?? null;
  }

  /**
   * Run one developer action. The key path and any future UI path both come through here,
   * so there is one behaviour per action rather than one per caller.
   */
  runAction(action) {
    switch (action) {
      case ADMIN.toggleAction: this.toggle(); return true;
      case ADMIN.consoleAction: this.console.toggle(); return true;
      case ADMIN.collisionDebugAction: this.admin.toggleDebugVisual('collision'); return true;
      case ADMIN.aiDebugAction: this.admin.toggleDebugVisual('botTarget'); return true;
      case ADMIN.performanceAction:
        this.category = 'performance';
        this.setOpen(true);
        return true;
      default: return false;
    }
  }

  toggle() { this.setOpen(!this.open); }

  setOpen(open) {
    if (!this.root) return;
    this.open = open;
    this.root.classList.toggle('open', open);
    if (open) this.render();
  }

  /* ── rendering ─────────────────────────────────────────────────────────── */

  render() {
    if (!this.root || !this.open) return;
    mount(this.root,
      el('nav.a-nav', {}, CATEGORIES.map((c) =>
        el(`button${c === this.category ? '.active' : ''}`, {
          text: c, on: { click: () => { this.category = c; this.render(); } }
        })
      )),
      el('div.a-main', {}, this._panel()),
      el('div.a-side', {}, this._side())
    );
  }

  /** Run an AdminService call and surface the outcome. */
  _run(fn, successMessage = null) {
    const result = fn();
    if (result?.ok === false) this.ui.toasts.bad(`Admin: ${result.reason}`);
    else if (successMessage) this.ui.toasts.good(successMessage);
    this.render();
    return result;
  }

  _btn(label, onClick, { danger = false, active = false } = {}) {
    return el(`button.a-btn${danger ? '.danger' : ''}${active ? '.on' : ''}`, {
      text: label, on: { click: onClick }
    });
  }

  _row(...children) {
    return el('div.a-row', {}, children.flat().filter(Boolean));
  }

  _panel() {
    const a = this.admin;
    const method = `_${this.category}Panel`;
    return this[method] ? this[method](a) : [el('div', { text: 'Nothing here' })];
  }

  _playerPanel(a) {
    const f = a.flags;
    return [
      el('h3', { text: 'Player' }),
      this._row(
        this._btn('Heal Full', () => this._run(() => a.healFull())),
        this._btn('Damage 25', () => this._run(() => a.damagePlayer(25))),
        this._btn('Eliminate', () => this._run(() => a.eliminatePlayer()), { danger: true })
      ),
      el('h4', { text: 'Toggles' }),
      this._row(
        this._btn('God Mode', () => this._run(() => a.toggleGodMode()), { active: f.godMode }),
        this._btn('Infinite Ammo', () => this._run(() => a.toggleInfiniteAmmo()), { active: f.infiniteAmmo }),
        this._btn('No Reload', () => this._run(() => a.toggleNoReload()), { active: f.noReload }),
        this._btn('Infinite Materials', () => this._run(() => a.toggleInfiniteMaterials()), { active: f.infiniteMaterials })
      ),
      el('h4', { text: 'Vitals' }),
      this._numberRow('Health', 100, (v) => this._run(() => a.setHealth(v))),
      this._numberRow('Shield', 100, (v) => this._run(() => a.setShield(v))),
      el('h4', { text: 'Teleport' }),
      this._row(
        this._btn('Map Centre', () => this._run(() => a.teleportToMapCentre())),
        this._btn('Storm Centre', () => this._run(() => a.teleportToStormCentre())),
        this._btn('Into Storm', () => this._run(() => a.teleportIntoStorm()))
      ),
      this._xzRow((x, z) => this._run(() => a.teleport(x, z)))
    ];
  }

  _inventoryPanel(a) {
    const weaponSelect = el('select', {}, Object.keys(WEAPONS).map((id) =>
      el('option', { value: id, text: WEAPONS[id].name })));
    const raritySelect = el('select', {}, RARITY_ORDER.map((r) =>
      el('option', { value: r, text: r })));

    return [
      el('h3', { text: 'Inventory' }),
      el('h4', { text: 'Give Weapon' }),
      this._row(weaponSelect, raritySelect,
        this._btn('Give', () => this._run(
          () => a.giveWeapon(weaponSelect.value, raritySelect.value), 'Weapon given'))),
      el('h4', { text: 'Loadouts' }),
      this._row(...Object.entries(TEST_LOADOUTS).map(([id, l]) =>
        this._btn(l.name, () => this._run(() => a.applyLoadout(id), l.name)))),
      el('h4', { text: 'Ammo & Consumables' }),
      this._row(
        this._btn('All Ammo', () => this._run(() => a.giveAmmo('all'))),
        ...Object.keys(CONSUMABLES).map((id) =>
          this._btn(CONSUMABLES[id].name, () => this._run(() => a.giveConsumable(id))))
      ),
      // §4.4 — per-material grants, each one click.
      el('h4', { text: 'Materials' }),
      this._row(
        ...MATERIAL_ORDER.map((m) => this._btn(
          `Give ${ADMIN.materialGrant} ${MATERIALS[m].name}`,
          () => this._run(() => a.giveMaterials(m, ADMIN.materialGrant),
            `+${ADMIN.materialGrant} ${MATERIALS[m].name}`)
        )),
        this._btn(`Give ${ADMIN.materialGrant} All`, () => this._run(
          () => a.giveMaterials('all', ADMIN.materialGrant), `+${ADMIN.materialGrant} all`))
      ),
      this._row(
        this._btn('Infinite Materials', () => this._run(() => a.toggleInfiniteMaterials()),
          { active: a.flags.infiniteMaterials }),
        this._btn(`Max (${MATERIAL_CAP})`, () => this._run(() => a.giveMaxMaterials())),
        this._btn('Clear Inventory', () => this._run(() => a.clearInventory()), { danger: true })
      )
    ];
  }

  _buildingPanel(a) {
    return [
      el('h3', { text: 'Building' }),
      this._row(
        this._btn('Clear All Builds', () => this._run(() => a.clearAllBuilds(), 'Builds cleared'), { danger: true }),
        this._btn('Repair All', () => this._run(() => a.repairAllBuilds()))
      ),
      el('h4', { text: 'Visualisation' }),
      this._visualToggles(['buildGrid', 'buildCollision', 'editCollision', 'buildCoordinates'])
    ];
  }

  _botsPanel(a) {
    const bots = a.listBots();
    const countInput = el('input', { type: 'number', value: '5', min: '1' });
    const stateSelect = el('select', {}, Object.values(BotState).map((s) =>
      el('option', { value: s, text: s })));
    const botSelect = el('select', {}, bots.map((b) =>
      el('option', { value: String(b.id), text: `#${b.id} ${b.state}` })));

    return [
      el('h3', { text: `Bots (${bots.length})` }),
      el('h4', { text: 'Spawn' }),
      this._row(...ADMIN.quickBotCounts.map((n) =>
        this._btn(`+${n}`, () => this._run(() => a.spawnBots(n), `+${n} bots`)))),
      this._row(countInput, this._btn('Spawn', () =>
        this._run(() => a.spawnBots(Number(countInput.value) || 1)))),
      el('h4', { text: 'Control' }),
      this._row(
        this._btn(a.flags.botsFrozen ? 'Resume' : 'Freeze', () => this._run(() => a.freezeBots()),
          { active: a.flags.botsFrozen }),
        this._btn('Teleport to Me', () => this._run(() => a.teleportBotsToPlayer())),
        this._btn('Eliminate All', () => this._run(() => a.eliminateAllBots()), { danger: true }),
        this._btn('Remove All', () => this._run(() => a.removeAllBots()), { danger: true })
      ),
      el('h4', { text: 'Difficulty' }),
      this._row(...Object.keys(BOT_DIFFICULTY).map((d) =>
        this._btn(d, () => this._run(() => a.setBotDifficulty(d), `Difficulty: ${d}`)))),
      el('h4', { text: 'Force State' }),
      this._row(botSelect, stateSelect, this._btn('Force', () =>
        this._run(() => a.forceBotState(Number(botSelect.value), stateSelect.value))))
    ];
  }

  _matchPanel(a) {
    const botsInput = el('input', { type: 'number', value: String(MATCH.botCount), min: '0' });
    return [
      el('h3', { text: 'Match' }),
      this._row(botsInput,
        this._btn('Start', () => this._run(() => a.startMatch(Number(botsInput.value)))),
        this._btn('Restart', () => this._run(() => a.restartMatch(Number(botsInput.value))))),
      this._row(
        this._btn('Skip Drop', () => this._run(() => a.skipDropPhase())),
        this._btn('Force Victory', () => this._run(() => a.forceVictory())),
        this._btn('Force Defeat', () => this._run(() => a.forceDefeat()), { danger: true }),
        this._btn('Return to Lobby', () => this._run(() => a.returnToLobby()))
      ),
      el('h4', { text: 'Leave One Bot' }),
      this._row(this._btn('Eliminate all but 1', () =>
        this._run(() => a.eliminateAllBots({ keep: 1 }))))
    ];
  }

  _stormPanel(a) {
    const multInput = el('input', { type: 'number', value: '1', step: '0.5', min: '0' });
    return [
      el('h3', { text: 'Storm' }),
      this._row(
        this._btn('Start', () => this._run(() => a.startStorm())),
        this._btn('Pause/Resume', () => this._run(() => a.pauseStorm())),
        this._btn('Next Phase', () => this._run(() => a.advanceStormPhase())),
        this._btn('Final Phase', () => this._run(() => a.jumpToFinalStormPhase()))
      ),
      el('h4', { text: 'Damage' }),
      this._row(
        this._btn('Disable', () => this._run(() => a.setStormDamageEnabled(false))),
        this._btn('Enable', () => this._run(() => a.setStormDamageEnabled(true))),
        multInput,
        this._btn('Set Multiplier', () =>
          this._run(() => a.setStormDamageMultiplier(Number(multInput.value) || 1)))
      ),
      el('h4', { text: 'Visualisation' }),
      this._visualToggles(['stormZones'])
    ];
  }

  _worldPanel(a) {
    return [
      el('h3', { text: 'World & Loot' }),
      this._row(
        this._btn('Spawn Chest', () => this._run(() => a.spawnChest(), 'Chest spawned')),
        this._btn('Spawn Ammo Box', () => this._run(() => a.spawnAmmoBox())),
        this._btn('Spawn Loot', () => this._run(() => a.spawnLoot())),
        this._btn('Clear Loot', () => this._run(() => a.clearWorldLoot()), { danger: true })
      ),
      el('h4', { text: 'Visualisation' }),
      this._visualToggles(['lootSpawns', 'chestSpawns', 'collision', 'playerCapsule'])
    ];
  }

  _profilePanel(a) {
    const amount = el('input', { type: 'number', value: '1000' });
    const cosmeticSelect = el('select', {}, COSMETICS.map((c) =>
      el('option', { value: c.id, text: `${CATEGORY_LABELS[c.category]} — ${c.name}` })));

    return [
      el('h3', { text: 'Profile' }),
      el('h4', { text: 'Credits' }),
      this._row(amount,
        this._btn('Grant', () => this._run(() => a.grantCredits(Number(amount.value)))),
        this._btn('Remove', () => this._run(() => a.removeCredits(Number(amount.value)))),
        this._btn('Set', () => this._run(() => a.setCredits(Number(amount.value))))),
      el('h4', { text: 'Cosmetics' }),
      this._row(cosmeticSelect,
        this._btn('Unlock', () => this._run(() => a.unlockCosmetic(cosmeticSelect.value))),
        this._btn('Equip', () => this._run(() => a.equipCosmetic(cosmeticSelect.value))),
        this._btn('Preview', () => {
          const r = a.previewCosmetic(cosmeticSelect.value);
          if (r.ok) this.ui.toasts.show(`Preview: ${r.preview.name} (owned: ${r.owned})`);
        })),
      this._row(
        this._btn('Unlock All', () => this._run(() => a.unlockAllCosmetics(), 'All unlocked')),
        this._btn('Reset Equipped', () => this._run(() => a.resetEquipped()))
      ),
      el('h4', { text: 'Danger' }),
      this._row(
        this._btn('Reset Profile', () => {
          // §17 — destructive actions require confirmation.
          if (window.confirm('Reset the local profile? This clears currency, cosmetics and stats.')) {
            this._run(() => a.resetProfile({ confirm: true }), 'Profile reset');
          }
        }, { danger: true }),
        this._btn('Export JSON', () => {
          const r = a.exportProfile();
          if (r.ok) { console.log(r.json); this.ui.toasts.good('Profile logged to console'); }
        })
      )
    ];
  }

  _shopPanel(a) {
    const rotation = a.shopRotation();
    const cosmeticSelect = el('select', {}, COSMETICS.map((c) =>
      el('option', { value: c.id, text: c.name })));

    return [
      el('h3', { text: 'Shop' }),
      el('div', { text: `Rotation #${rotation?.rotationId ?? '—'}`, style: { marginBottom: '9px' } }),
      this._row(
        this._btn('Force Reroll', () => this._run(() => a.forceShopRotation(), 'Shop rerolled')),
        this._btn('Preview Next', () => {
          const r = a.previewNextRotation();
          if (r.ok) this.ui.toasts.show(`Next rotation #${r.rotation.id}`);
        })
      ),
      el('h4', { text: 'Purchase Testing' }),
      this._row(cosmeticSelect,
        this._btn('Test Purchase', () => this._run(() => a.testPurchase(cosmeticSelect.value), 'Purchased')),
        this._btn('Simulate No Funds', () => {
          const r = a.simulateInsufficientFunds(cosmeticSelect.value);
          if (r.ok) this.ui.toasts.show(`Failed as expected: ${r.reason}`);
        })),
      el('h4', { text: 'Rewards' }),
      this._row(this._btn(a.flags.rewardsDisabled ? 'Enable Rewards' : 'Disable Rewards',
        () => this._run(() => a.disableRewards()), { active: a.flags.rewardsDisabled }))
    ];
  }

  _performancePanel(a) {
    const governor = this.ui.governor;
    const info = a.performanceInfo(governor) ?? {};
    return [
      el('h3', { text: 'Performance' }),
      el('div', {}, [
        this._stat('FPS', info.fps ? info.fps.toFixed(1) : '—'),
        this._stat('Average frame', info.averageMs ? `${info.averageMs.toFixed(2)} ms` : '—'),
        this._stat('p95 frame', info.p95Ms ? `${info.p95Ms.toFixed(2)} ms` : '—'),
        this._stat('Quality tier', info.tier ?? '—'),
        this._stat('Bots', String(info.botCount ?? 0)),
        this._stat('Nearby bots', String(info.nearbyBots ?? 0)),
        this._stat('Build pieces', String(info.buildCount ?? 0)),
        this._stat('World loot', String(info.worldLootCount ?? 0))
      ]),
      el('h4', { text: 'Protected systems (never reducible)' }),
      el('div', {
        style: { fontSize: '10.5px', color: '#8fd96a', lineHeight: '1.7' },
        text: 'input · building · editing · collision · hit feedback'
      })
    ];
  }

  _debugPanel(a) {
    const aim = a.aimDebugInfo();
    return [
      el('h3', { text: 'Debug Visualisation' }),
      this._visualToggles(Object.keys(a.debugVisuals)),
      el('h4', { text: 'Shared Aim Ray' }),
      aim
        ? el('div', { style: { fontSize: '10.5px', lineHeight: '1.7' } }, [
            this._stat('Shared ray', aim.sharedRay ? 'yes' : 'NO'),
            this._stat('Origin', `${aim.rayOrigin.x.toFixed(1)}, ${aim.rayOrigin.y.toFixed(1)}, ${aim.rayOrigin.z.toFixed(1)}`),
            this._stat('Direction', `${aim.crosshairDirection.x.toFixed(2)}, ${aim.crosshairDirection.y.toFixed(2)}, ${aim.crosshairDirection.z.toFixed(2)}`),
            this._stat('Structure hit', aim.structureHit ? `#${aim.structureHit.pieceId} @ ${aim.structureHit.distance.toFixed(1)}m` : 'none'),
            this._stat('Build target', aim.buildTargetCell ? `${aim.buildTargetCell.cx},${aim.buildTargetCell.cy},${aim.buildTargetCell.cz}` : 'none')
          ])
        : el('div', { text: 'Not in a match' })
    ];
  }

  /* ── shared bits ───────────────────────────────────────────────────────── */

  _visualToggles(names) {
    return this._row(...names.map((name) =>
      this._btn(name, () => this._run(() => this.admin.toggleDebugVisual(name)),
        { active: this.admin.debugVisuals[name] })));
  }

  _numberRow(label, initial, onApply) {
    const input = el('input', { type: 'number', value: String(initial) });
    return this._row(
      el('span.a-label', { text: label }), input,
      this._btn('Set', () => onApply(Number(input.value)))
    );
  }

  _xzRow(onApply) {
    const x = el('input', { type: 'number', value: '0' });
    const z = el('input', { type: 'number', value: '0' });
    return this._row(el('span.a-label', { text: 'X / Z' }), x, z,
      this._btn('Teleport', () => onApply(Number(x.value), Number(z.value))));
  }

  _stat(label, value) {
    return el('div.a-stat', {}, [el('span', { text: label }), el('b', { text: value })]);
  }

  /** Right column: live state and the event log (§15). */
  _side() {
    const a = this.admin;
    const match = a.matchState();
    const storm = a.stormState();

    return [
      el('h3', { text: 'Live State' }),
      this._stat('Scene', this.app.scenes.currentName ?? '—'),
      this._stat('Match', match?.state ?? '—'),
      this._stat('Alive', String(this.app.registry.aliveCount)),
      this._stat('Credits', formatNumber(this.app.profile.currency)),
      storm ? this._stat('Storm', `${storm.phaseName} r=${Math.round(storm.radius)}m`) : null,
      storm ? this._stat('Next zone', `${Math.round(storm.nextRadius)}m`) : null,
      el('h4', { text: 'Event Log' }),
      el('div.a-log', {}, a.eventLog.slice(-16).reverse().map((e) =>
        el('div', { text: `${e.type.replace(/^\w+:/, '')} ${JSON.stringify(e.payload).slice(0, 40)}` })
      ))
    ];
  }
}

/**
 * CommandConsole — ADMIN_PANEL_SPEC §16.
 *
 * Calls the SAME AdminService methods the GUI does. The command table below maps a name
 * to a service call and nothing else: there is no logic here to diverge from the panel.
 */
export class CommandConsole {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.admin = app.admin;
    this.open = false;
    this.history = [];
    this.historyIndex = -1;
    this.root = null;
  }

  install(parent = document.body) {
    if (!this.admin.enabled) return false;

    this.output = el('div.c-out');
    this.input = el('input', {
      placeholder: 'Type a command — "help" for a list',
      on: {
        keydown: (e) => {
          // The console's own bind closes it. Without this the key that opens the console
          // cannot close it: the focused input stops the event before the window listener
          // that owns the bind ever sees it, so the console can only be dismissed with
          // Escape — and while it holds focus it swallows every other key too.
          const closeCode = this.app.settings?.bindings?.[ADMIN.consoleAction];
          if (e.code === closeCode || e.code === 'Escape') {
            this.setOpen(false);
            e.preventDefault();
          } else if (e.code === 'Enter') { this._submit(); e.preventDefault(); }
          else if (e.code === 'ArrowUp') { this._recall(-1); e.preventDefault(); }
          else if (e.code === 'ArrowDown') { this._recall(1); e.preventDefault(); }
          e.stopPropagation();
        }
      }
    });

    this.root = el('div', { id: 'admin-console' }, [this.output, this.input]);
    parent.appendChild(this.root);
    this._print('Developer console. Commands call AdminService directly.', 'ok');
    return true;
  }

  toggle() { this.setOpen(!this.open); }

  setOpen(open) {
    if (!this.root) return;
    this.open = open;
    this.root.classList.toggle('open', open);
    if (open) this.input.focus();
    else this.input.blur();
  }

  _print(text, kind = '') {
    this.output.appendChild(el(`div${kind ? `.${kind}` : ''}`, { text }));
    this.output.scrollTop = this.output.scrollHeight;
  }

  _recall(direction) {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(0, Math.min(this.history.length - 1, this.historyIndex + direction));
    this.input.value = this.history[this.historyIndex] ?? '';
  }

  _submit() {
    const line = this.input.value.trim();
    if (!line) return;
    this.input.value = '';
    this.history.push(line);
    this.historyIndex = this.history.length;
    this._print(`> ${line}`, 'cmd');
    this.run(line);
  }

  /**
   * Execute a command line.
   * @returns {object} the AdminService result
   */
  run(line) {
    const [name, ...args] = line.trim().split(/\s+/);
    const a = this.admin;

    // Each entry is a thin adapter onto an AdminService method — never its own logic.
    const commands = {
      help: () => {
        this._print(`Commands: ${Object.keys(commands).sort().join(', ')}`);
        return { ok: true };
      },
      give: () => {
        const [what, ...rest] = args;
        if (what === 'weapon') return a.giveWeapon(rest[0], rest[1] ?? 'common');
        if (what === 'ammo') return a.giveAmmo(rest[0] ?? 'all');
        if (what === 'materials') {
          // `give materials wood 500` grants one; `give materials 500` sets all three.
          return MATERIAL_ORDER.includes(rest[0])
            ? a.giveMaterials(rest[0], Number(rest[1]) || ADMIN.materialGrant)
            : a.setMaterials(Number(rest[0]) || MATERIAL_CAP);
        }
        if (what === 'item') return a.giveConsumable(rest[0]);
        return { ok: false, reason: 'usage: give weapon|ammo|materials|item' };
      },
      spawn: () => (args[0] === 'bot'
        ? a.spawnBots(Number(args[1]) || 1)
        : args[0] === 'chest' ? a.spawnChest()
          : args[0] === 'loot' ? a.spawnLoot()
            : { ok: false, reason: 'usage: spawn bot|chest|loot' }),
      kill: () => (args[0] === 'bots' ? a.eliminateAllBots() : a.eliminatePlayer()),
      storm: () => ({
        next: () => a.advanceStormPhase(),
        final: () => a.jumpToFinalStormPhase(),
        start: () => a.startStorm(),
        pause: () => a.pauseStorm(),
        off: () => a.setStormDamageEnabled(false),
        on: () => a.setStormDamageEnabled(true)
      }[args[0]] ?? (() => ({ ok: false, reason: 'usage: storm next|final|start|pause|on|off' })))(),
      tp: () => (args[0] === 'centre' || args[0] === 'center'
        ? a.teleportToMapCentre()
        : args[0] === 'storm' ? a.teleportToStormCentre()
          : a.teleport(Number(args[0]) || 0, Number(args[1]) || 0)),
      god: () => a.toggleGodMode(),
      nocost: () => a.toggleInfiniteMaterials(),
      infiniteammo: () => a.toggleInfiniteAmmo(),
      noreload: () => a.toggleNoReload(),
      heal: () => a.healFull(),
      credits: () => a.setCredits(Number(args[0]) || 0),
      unlock: () => (args[0] === 'all' ? a.unlockAllCosmetics() : a.unlockCosmetic(args[0])),
      equip: () => a.equipCosmetic(args[0]),
      shop: () => (args[0] === 'reroll' ? a.forceShopRotation() : { ok: false, reason: 'usage: shop reroll' }),
      match: () => ({
        restart: () => a.restartMatch(),
        start: () => a.startMatch(Number(args[1]) || undefined),
        lobby: () => a.returnToLobby(),
        win: () => a.forceVictory(),
        lose: () => a.forceDefeat(),
        skip: () => a.skipDropPhase()
      }[args[0]] ?? (() => ({ ok: false, reason: 'usage: match restart|start|lobby|win|lose|skip' })))(),
      loadout: () => a.applyLoadout(args[0]),
      bots: () => (args[0] === 'freeze' ? a.freezeBots()
        : args[0] === 'difficulty' ? a.setBotDifficulty(args[1])
          : { ok: false, reason: 'usage: bots freeze|difficulty <name>' }),
      clear: () => (args[0] === 'builds' ? a.clearAllBuilds()
        : args[0] === 'loot' ? a.clearWorldLoot()
          : { ok: false, reason: 'usage: clear builds|loot' })
    };

    const command = commands[name];
    if (!command) {
      const result = { ok: false, reason: `unknown command: ${name}` };
      this._print(result.reason, 'err');
      return result;
    }

    const result = command() ?? { ok: true };
    if (result.ok === false) this._print(result.reason ?? 'failed', 'err');
    else this._print(JSON.stringify(result).slice(0, 160), 'ok');
    return result;
  }
}
