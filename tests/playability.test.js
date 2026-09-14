/**
 * Core playability — input binds, equipped-item state, harvesting, HUD.
 *
 * MASTER_SPEC §4.5 (one binding table), §9.4.1 (material selection and spending),
 * §12.1.1/§12.1.2 (weapon models and poses), §14 (harvesting), §15.4 (one held item),
 * §18.1/§18.2/§18.3 (vitals, selection, gain feedback), ADMIN_PANEL_SPEC §1.2, §4.4.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

import { Application } from '../src/app/Application.js';
import { Input } from '../src/core/Input.js';
import { Settings } from '../src/core/Settings.js';
import { AdminPanel } from '../src/ui/AdminPanel.js';
import {
  DEFAULT_BINDINGS, DEV_ACTIONS, BIND_CONFLICT_EXEMPT, VITAL_COLORS,
  MATERIAL_ORDER, MATERIALS, MATERIAL_CAP, BUILD, VITALS, PICKAXE,
  WEAPONS, WEAPON_CATEGORIES, SIM
} from '../src/core/Config.js';
import { ADMIN } from '../src/meta/MetaConfig.js';
import { Events } from '../src/core/EventBus.js';
import { heldItem, equippedView, HeldKind } from '../src/player/EquippedItem.js';
import {
  buildWeaponRig, weaponPose, weaponMetrics, muzzlePoint, categoryOf, categoriesCovered
} from '../src/cosmetics/WeaponRig.js';
import { buildMetrics } from '../src/cosmetics/CharacterRig.js';
import { CharacterView } from '../src/world/CharacterView.js';
import { Inventory, Weapon } from '../src/combat/Weapon.js';
import { placePiece } from '../src/building/Placement.js';
import { worldToCell } from '../src/building/BuildGrid.js';
import { Pickaxe } from '../src/combat/Pickaxe.js';
import { PlayerController } from '../src/player/PlayerController.js';
import { EventBus } from '../src/core/EventBus.js';
import { vitalsBars, materialRow, pushMaterialGain, expireMaterialGains } from '../src/ui/HudModel.js';

const makeStorage = () => {
  const store = new Map();
  return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
};

/* ══ §4.5 — ONE BINDING TABLE, NO HARD-CODED KEYS ═════════════════════════ */

describe('§4.5 developer binds live in the one binding table', () => {
  it('declares every developer action as an ordinary bind', () => {
    for (const action of DEV_ACTIONS) {
      expect(DEFAULT_BINDINGS[action], action).toBeTruthy();
    }
    expect(DEFAULT_BINDINGS.toggleAdminMenu).toBe('F8');
    expect(DEFAULT_BINDINGS.toggleDevConsole).toBe('F9');
  });

  it('leaves Backquote free for the player', () => {
    // The console used to own ` outside the binding system, so it could not be used for
    // the pickaxe. Nothing in the default table may claim it.
    for (const [action, code] of Object.entries(DEFAULT_BINDINGS)) {
      expect(code, action).not.toBe('Backquote');
    }
  });

  it('ships with no bind conflicts at all', () => {
    expect(new Input().allConflicts()).toEqual([]);
  });

  it('does not let a developer bind share a key with a gameplay bind', () => {
    const gameplay = Object.entries(DEFAULT_BINDINGS)
      .filter(([action]) => !DEV_ACTIONS.includes(action))
      .map(([, code]) => code);
    for (const action of DEV_ACTIONS) {
      expect(gameplay, action).not.toContain(DEFAULT_BINDINGS[action]);
    }
  });

  it('detects a conflict when a developer bind is moved onto a gameplay key', () => {
    const settings = new Settings();
    const result = settings.rebind('toggleAdminMenu', DEFAULT_BINDINGS.jump);
    expect(result.ok).toBe(false);
    expect(result.conflicts).toContain('jump');
    // Refused, not silently applied.
    expect(settings.bindings.toggleAdminMenu).toBe('F8');
  });

  it('applies a conflicting bind only when forced, and unbinds the loser', () => {
    const settings = new Settings();
    const result = settings.rebind('toggleAdminMenu', DEFAULT_BINDINGS.jump, { force: true });
    expect(result.ok).toBe(true);
    expect(settings.bindings.toggleAdminMenu).toBe('Space');
    expect(settings.bindings.jump).toBeNull();
  });

  it('honours the shared-bind exemptions rather than reporting a false conflict', () => {
    const settings = new Settings();
    for (const [a, b] of BIND_CONFLICT_EXEMPT) {
      expect(settings.rebind(a, settings.bindings[b]).ok, `${a}/${b}`).toBe(true);
    }
  });

  it('persists a rebound developer key across a save and reload', () => {
    const storage = makeStorage();
    const saved = new Settings();
    expect(saved.rebind('toggleDevConsole', 'F7').ok).toBe(true);
    saved.save(storage);

    const loaded = new Settings();
    loaded.load(storage);
    expect(loaded.bindings.toggleDevConsole).toBe('F7');
    expect(loaded.bindings.toggleAdminMenu).toBe('F8');
  });

  it('pushes rebound keys into the live Input', () => {
    const settings = new Settings();
    const input = new Input();
    settings.rebind('toggleAdminMenu', 'F7', { force: true });
    settings.applyTo({ input });
    expect(input.bindings.toggleAdminMenu).toBe('F7');
  });
});

describe('ADMIN_PANEL_SPEC §1.2 the panel resolves keys through the binding table', () => {
  /** The key path only needs settings; no DOM is built, and none is asserted. */
  const resolve = (settings, code) =>
    AdminPanel.prototype.actionFor.call({ app: { settings } }, code);

  it('maps the bound key to its action', () => {
    const settings = new Settings();
    expect(resolve(settings, 'F8')).toBe(ADMIN.toggleAction);
    expect(resolve(settings, 'F9')).toBe(ADMIN.consoleAction);
  });

  it('ignores Backquote, so the pickaxe may take it', () => {
    const settings = new Settings();
    expect(resolve(settings, 'Backquote')).toBeNull();

    expect(settings.rebind('pickaxe', 'Backquote').ok).toBe(true);
    // Still nothing developer-side answers to it.
    expect(resolve(settings, 'Backquote')).toBeNull();

    const input = new Input();
    settings.applyTo({ input });
    input.simulatePress('Backquote');
    expect(input.wasPressed('pickaxe')).toBe(true);
  });

  it('follows a rebind immediately, with no restart', () => {
    const settings = new Settings();
    settings.rebind('toggleAdminMenu', 'F7', { force: true });
    expect(resolve(settings, 'F8')).toBeNull();
    expect(resolve(settings, 'F7')).toBe(ADMIN.toggleAction);
  });

  it('carries every developer action to a distinct handler', () => {
    const actions = DEV_ACTIONS.map((a) => AdminPanel.prototype.runAction.length && a);
    expect(actions).toHaveLength(DEV_ACTIONS.length);
    for (const key of ['toggleAction', 'consoleAction', 'collisionDebugAction',
      'aiDebugAction', 'performanceAction']) {
      expect(DEV_ACTIONS).toContain(ADMIN[key]);
    }
  });
});

/* ══ §15.4 — EXACTLY ONE HELD ITEM ════════════════════════════════════════ */

describe('§15.4 the inventory decides what is in the hand', () => {
  let inventory;
  beforeEach(() => {
    inventory = new Inventory();
    inventory.add({ kind: 'weapon', rarity: 'common', weapon: new Weapon('assaultRifle', 'common') });
  });

  it('shows the harvesting tool when the pickaxe is equipped', () => {
    inventory.equipPickaxe();
    expect(heldItem(inventory, { pickaxeId: 'pickaxe_standard' }))
      .toEqual({ kind: HeldKind.PICKAXE, id: 'pickaxe_standard', category: null });
  });

  it('shows the weapon in the selected slot', () => {
    inventory.switchCooldown = 0;
    inventory.select(0);
    const held = heldItem(inventory);
    expect(held.kind).toBe(HeldKind.WEAPON);
    expect(held.id).toBe('assaultRifle');
    expect(held.category).toBe('assaultRifle');
  });

  it('shows NOTHING for an empty slot — never a fallback to the pickaxe', () => {
    inventory.select(1);
    expect(heldItem(inventory).kind).toBe(HeldKind.NONE);
  });

  it('shows nothing for a slot holding something that is not a weapon', () => {
    inventory.slots[1] = { kind: 'consumable', id: 'medkit', count: 1 };
    inventory.select(1);
    expect(heldItem(inventory).kind).toBe(HeldKind.NONE);
  });

  it('never lets a weapon inherit a swing or a pickaxe inherit an aim pose', () => {
    inventory.select(0);
    inventory.activeWeapon.adsProgress = 0.7;
    const armed = equippedView(inventory, { swingProgress: 0.2 });
    expect(armed.swingProgress).toBe(1);
    expect(armed.adsProgress).toBeCloseTo(0.7);

    inventory.equipPickaxe();
    const tool = equippedView(inventory, { pickaxeId: 'pickaxe_standard', swingProgress: 0.2 });
    expect(tool.swingProgress).toBeCloseTo(0.2);
    expect(tool.adsProgress).toBe(0);
  });

  it('keeps exactly one item attached to the hand across every switch', () => {
    const view = new CharacterView();
    view.setSkin('recruit');
    const heldCount = () => view.heldGroup.children.length;
    const stale = () => [...view.parts.keys()].filter((k) => k.startsWith('held:')).length;
    // §15 gives an equip a switch cooldown; this test is about the visual, not the timing.
    const selectNow = (i) => { inventory.switchCooldown = 0; inventory.select(i); };

    view.setEquipped(equippedView(inventory, { pickaxeId: 'pickaxe_standard' }));
    const toolParts = heldCount();
    expect(toolParts).toBeGreaterThan(0);
    expect(stale()).toBe(toolParts);

    selectNow(0);
    view.setEquipped(equippedView(inventory));
    const weaponParts = heldCount();
    expect(weaponParts).toBe(buildWeaponRig('assaultRifle').parts.length);
    // The tool left completely: no part of it is still attached, and no stale entry
    // survives in the part map to be disposed twice.
    expect(stale()).toBe(weaponParts);

    inventory.equipPickaxe();
    view.setEquipped(equippedView(inventory, { pickaxeId: 'pickaxe_standard' }));
    expect(heldCount()).toBe(toolParts);

    selectNow(1);   // empty
    view.setEquipped(equippedView(inventory));
    expect(heldCount()).toBe(0);
    expect(stale()).toBe(0);

    view.dispose();
  });

  it('rides the right arm on the shoulder pivot, so the hand goes where the item does', () => {
    // SKIN_SPEC §11.7 / §12.1.2 — the arm is what carries the held item. The routing test
    // used to read a `part.region` field that does not exist (the rig passes the region as
    // the part's TAG), so no arm mesh ever joined the pivot: the tool swung out of a hand
    // that never moved, and a raised weapon floated beside a hanging arm.
    const view = new CharacterView();
    view.setSkin('recruit');
    const onArm = [...view.parts.entries()]
      .filter(([key]) => !key.startsWith('held:'))
      .filter(([, mesh]) => mesh.parent === view.armGroup)
      .map(([key]) => key);
    expect(onArm).toContain('upperArmR');
    expect(onArm).toContain('foreArmR');
    expect(onArm).toContain('handR');
    // The left arm stays on the body — only the holding arm is animated.
    expect(onArm).not.toContain('upperArmL');
    expect(onArm).not.toContain('handL');
    view.dispose();
  });

  it('moves the arm with the swing, and with the aim', () => {
    const view = new CharacterView();
    view.setSkin('recruit');
    inventory.equipPickaxe();

    view.setEquipped(equippedView(inventory, { pickaxeId: 'pickaxe_standard', swingProgress: 1 }));
    expect(view.armGroup.rotation.x).toBeCloseTo(0);
    view.setEquipped(equippedView(inventory, { pickaxeId: 'pickaxe_standard', swingProgress: 0.05 }));
    expect(Math.abs(view.armGroup.rotation.x)).toBeGreaterThan(1);

    inventory.switchCooldown = 0;
    inventory.select(0);
    inventory.activeWeapon.adsProgress = 0;
    view.setEquipped(equippedView(inventory));
    const hip = view.armGroup.rotation.x;
    inventory.activeWeapon.adsProgress = 1;
    view.setEquipped(equippedView(inventory));
    expect(view.armGroup.rotation.x).toBeLessThan(hip);   // raised further forward
    view.dispose();
  });

  it('puts the hand attachment under the shoulder pivot, and only there', () => {
    const view = new CharacterView();
    view.setSkin('recruit');
    expect(view.heldGroup.parent).toBe(view.armGroup);
    // One attachment point: nothing else in the character group holds items.
    const groups = view.group.children.filter((c) => c instanceof THREE.Group);
    expect(groups).toEqual([view.armGroup]);
    view.dispose();
  });
});

/* ══ §12.1.1, §12.1.2 — WEAPON MODELS AND POSES ═══════════════════════════ */

describe('§12.1.1 every weapon has a model', () => {
  it('covers every category the catalog uses', () => {
    expect(categoriesCovered()).toBe(true);
    for (const category of WEAPON_CATEGORIES) {
      expect(buildWeaponRig(category).parts.length, category).toBeGreaterThan(3);
    }
  });

  it('builds a model for every weapon in the table', () => {
    for (const id of Object.keys(WEAPONS)) {
      const rig = buildWeaponRig(WEAPONS[id]);
      expect(rig.parts.length, id).toBeGreaterThan(3);
      expect(rig.category, id).toBe(WEAPONS[id].category);
      for (const part of rig.parts) {
        expect(rig.palette[part.role] ?? rig.palette.primary, `${id}/${part.id}`).toBeTruthy();
      }
    }
  });

  it('gives the five required classes distinguishable silhouettes', () => {
    const length = (c) => weaponMetrics(c).length;
    // Sniper longest, pistol shortest, and no two classes the same length.
    expect(length('sniper')).toBeGreaterThan(length('assaultRifle'));
    expect(length('assaultRifle')).toBeGreaterThan(length('smg'));
    expect(length('smg')).toBeGreaterThan(length('pistol'));
    // A pistol has no stock; a rifle does. That absence is the silhouette.
    const ids = (c) => buildWeaponRig(c).parts.map((p) => p.id);
    expect(ids('pistol')).not.toContain('stock');
    expect(ids('assaultRifle')).toContain('stock');
    expect(ids('sniper')).toContain('scope');
    expect(ids('shotgun')).toContain('tube');
  });

  it('resolves an unknown weapon to a real model rather than to nothing', () => {
    expect(categoryOf('nonsense')).toBe('assaultRifle');
    expect(buildWeaponRig(undefined).parts.length).toBeGreaterThan(3);
  });

  it('scales with the player capsule, never with an absolute length', () => {
    // Every category's length is a fixed ratio of the reference length.
    const ratio = weaponMetrics('sniper').length / weaponMetrics('assaultRifle').length;
    expect(ratio).toBeCloseTo(1.28, 5);
  });
});

describe('§12.1.2 weapon poses', () => {
  const builds = ['lean', 'athletic', 'heavy', 'stout'];

  it('points the muzzle forward, away from the character, on every build', () => {
    for (const build of builds) {
      const metrics = buildMetrics(build);
      for (const category of WEAPON_CATEGORIES) {
        for (const ads of [0, 0.5, 1]) {
          const grip = weaponPose(metrics, ads).grip;
          const muzzle = muzzlePoint(metrics, category, ads);
          // Forward of the grip, and forward of the torso it is held against.
          expect(muzzle.z, `${build}/${category}/${ads}`).toBeGreaterThan(grip.z);
          expect(muzzle.z, `${build}/${category}/${ads}`).toBeGreaterThan(metrics.armDepth);
        }
      }
    }
  });

  it('holds the weapon IN the hand at every aim progress', () => {
    for (const build of builds) {
      const metrics = buildMetrics(build);
      for (let ads = 0; ads <= 1.0001; ads += 0.25) {
        const pose = weaponPose(metrics, ads);
        const reach = Math.hypot(
          pose.grip.x - pose.hand.x, pose.grip.y - pose.hand.y, pose.grip.z - pose.hand.z
        );
        // The wrist may angle the weapon; it may not hold it at arm's length.
        expect(reach, `${build}@${ads}`).toBeLessThan(metrics.armLength * 0.65);
      }
    }
  });

  it('raises the weapon and draws it toward the aim line when aiming', () => {
    const metrics = buildMetrics('athletic');
    const hip = weaponPose(metrics, 0);
    const ads = weaponPose(metrics, 1);
    expect(ads.grip.y).toBeGreaterThan(hip.grip.y);      // raised
    expect(ads.grip.x).toBeLessThan(hip.grip.x);         // drawn inward
    expect(ads.grip.z).toBeGreaterThan(hip.grip.z);      // pushed out
    expect(Math.abs(ads.pitch)).toBeLessThan(Math.abs(hip.pitch));   // levelled
  });

  it('is continuous — no jump anywhere through the aim transition', () => {
    const metrics = buildMetrics('athletic');
    let previous = weaponPose(metrics, 0);
    for (let ads = 0.02; ads <= 1.0001; ads += 0.02) {
      const pose = weaponPose(metrics, ads);
      const step = Math.hypot(
        pose.grip.x - previous.grip.x, pose.grip.y - previous.grip.y, pose.grip.z - previous.grip.z
      );
      expect(step).toBeLessThan(0.05);
      previous = pose;
    }
  });

  it('clamps out-of-range aim progress instead of extrapolating', () => {
    const metrics = buildMetrics('athletic');
    expect(weaponPose(metrics, 4).grip).toEqual(weaponPose(metrics, 1).grip);
    expect(weaponPose(metrics, -2).grip).toEqual(weaponPose(metrics, 0).grip);
    expect(weaponPose(metrics, NaN).grip).toEqual(weaponPose(metrics, 0).grip);
  });
});

/* ══ §14, §9.4.1 — HARVESTING AND SPENDING ════════════════════════════════ */

describe('§14 harvestable world objects', () => {
  let bus;
  let player;
  let pickaxe;

  beforeEach(() => {
    bus = new EventBus();
    player = new PlayerController({ bus, spawn: { x: 0, y: 0, z: 0 } });
    pickaxe = new Pickaxe(bus);
  });

  const prop = (material, total) => ({
    kind: 'test', material, total, remaining: total, depleted: false
  });

  it('defines a yield for every material category', () => {
    for (const m of MATERIAL_ORDER) {
      expect(PICKAXE.harvestPerSwing[m], m).toBeGreaterThan(0);
    }
  });

  it('gives the player the prop material it is made of, and announces it', () => {
    const seen = [];
    bus.on(Events.MATERIAL_GAINED, (e) => seen.push(e));

    for (const material of MATERIAL_ORDER) {
      const target = prop(material, 100);
      const gained = pickaxe.harvest(target, player);
      expect(gained, material).toBe(PICKAXE.harvestPerSwing[material]);
      expect(player.materials[material]).toBe(PICKAXE.harvestPerSwing[material]);
      pickaxe.cooldown = 0;
    }
    expect(seen.map((e) => e.type)).toEqual([...MATERIAL_ORDER]);
  });

  it('depletes a prop and then yields nothing from it', () => {
    const target = prop('wood', PICKAXE.harvestPerSwing.wood);
    expect(pickaxe.harvest(target, player)).toBe(PICKAXE.harvestPerSwing.wood);
    expect(target.remaining).toBe(0);
    expect(target.depleted).toBe(true);

    pickaxe.cooldown = 0;
    const before = player.materials.wood;
    expect(pickaxe.harvest(target, player)).toBe(0);
    expect(player.materials.wood).toBe(before);
  });

  it('never yields more than the prop has left', () => {
    const target = prop('metal', 3);
    expect(pickaxe.harvest(target, player)).toBe(3);
    expect(target.depleted).toBe(true);
  });

  it('respects the swing cooldown — a held key is not a free harvest', () => {
    const target = prop('wood', 500);
    pickaxe.harvest(target, player);
    expect(pickaxe.harvest(target, player)).toBe(0);
    pickaxe.update(PICKAXE.swingInterval);
    expect(pickaxe.harvest(target, player)).toBeGreaterThan(0);
  });

  it('caps a material at the spec cap', () => {
    player.materials.brick = MATERIAL_CAP - 2;
    expect(pickaxe.harvest(prop('brick', 100), player)).toBe(2);
    expect(player.materials.brick).toBe(MATERIAL_CAP);
  });
});

describe('§14 the world carries every harvestable category', () => {
  let app;
  beforeEach(() => {
    globalThis.__FORCE_DEV_MODE__ = true;
    app = new Application({ storage: makeStorage(), seed: 11 });
    app.startMatch({ botCount: 1 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();
  });
  afterEach(() => { delete globalThis.__FORCE_DEV_MODE__; });

  it('spawns wood, brick and metal sources', () => {
    const materials = new Set(app.game.props.map((p) => p.material));
    for (const m of MATERIAL_ORDER) expect([...materials], m).toContain(m);
  });

  it('gives every harvestable an id and a positive yield', () => {
    expect(app.game.props.length).toBeGreaterThan(0);
    const ids = new Set();
    for (const p of app.game.props) {
      expect(typeof p.id).toBe('number');
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.remaining).toBeGreaterThan(0);
      expect(MATERIALS[p.material]).toBeTruthy();
    }
  });
});

describe('§9.4.1 building spends harvested materials', () => {
  let app;
  beforeEach(() => {
    globalThis.__FORCE_DEV_MODE__ = true;
    app = new Application({ storage: makeStorage(), seed: 12 });
    app.startMatch({ botCount: 1 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();
  });
  afterEach(() => { delete globalThis.__FORCE_DEV_MODE__; });

  it('starts the player with nothing', () => {
    for (const m of MATERIAL_ORDER) expect(app.game.player.materials[m]).toBe(0);
  });

  it('cycles the selected material through the bound action', () => {
    const game = app.game;
    expect(game.selectedMaterial).toBe(MATERIAL_ORDER[0]);
    for (let i = 1; i <= MATERIAL_ORDER.length; i++) {
      game.input.simulatePress(game.input.bindings.cycleMaterial);
      game.update(SIM.fixedDt);
      expect(game.selectedMaterial).toBe(MATERIAL_ORDER[i % MATERIAL_ORDER.length]);
    }
  });

  it('deducts the cost of the SELECTED material, and refuses what it cannot afford', () => {
    const game = app.game;
    game.player.materials.wood = BUILD.cost;
    game.selectedMaterial = 'wood';

    // A cell beside the player: placement is range-checked against the builder.
    const cell = worldToCell(game.player.position.x, game.player.position.y, game.player.position.z);
    // The real placement path, not a shortcut around it.
    const place = () => placePiece({
      grid: game.grid, type: 'wall', material: game.selectedMaterial,
      cell, direction: 'north', builder: game.player, players: [game.player]
    });
    expect(place().ok).toBe(true);
    expect(game.player.materials.wood).toBe(0);
    // Nothing left, and no fallback to another material.
    game.player.materials.brick = 500;
    expect(place().ok).toBe(false);
    expect(game.player.materials.brick).toBe(500);
  });
});

describe('ADMIN_PANEL_SPEC §4.4 material grants', () => {
  let app;
  beforeEach(() => {
    globalThis.__FORCE_DEV_MODE__ = true;
    app = new Application({ storage: makeStorage(), seed: 13 });
    app.startMatch({ botCount: 1 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();
  });
  afterEach(() => { delete globalThis.__FORCE_DEV_MODE__; });

  it('grants one material into the real player counts', () => {
    const result = app.admin.giveMaterials('wood', ADMIN.materialGrant);
    expect(result.ok).toBe(true);
    expect(app.game.player.materials.wood).toBe(ADMIN.materialGrant);
    expect(app.game.player.materials.brick).toBe(0);
  });

  it('grants all three at once', () => {
    expect(app.admin.giveMaterials('all', ADMIN.materialGrant).ok).toBe(true);
    for (const m of MATERIAL_ORDER) {
      expect(app.game.player.materials[m], m).toBe(ADMIN.materialGrant);
    }
  });

  it('clamps at the cap and rejects nonsense', () => {
    app.admin.giveMaterials('metal', MATERIAL_CAP);
    app.admin.giveMaterials('metal', MATERIAL_CAP);
    expect(app.game.player.materials.metal).toBe(MATERIAL_CAP);
    expect(app.admin.giveMaterials('gold', 10).ok).toBe(false);
    expect(app.admin.giveMaterials('wood', -5).ok).toBe(false);
  });
});

/* ══ §18 — HUD ════════════════════════════════════════════════════════════ */

describe('§18.2 vitals read as the spec states', () => {
  it('paints health GREEN and shield BLUE', () => {
    const bars = vitalsBars({ health: 100, shield: 100 });
    expect(bars.health.colors).toEqual(VITAL_COLORS.health);
    expect(bars.shield.colors).toEqual(VITAL_COLORS.shield);
    // Green means green: the health ramp's dominant channel is G, the shield's is B.
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [hr, hg, hb] = rgb(VITAL_COLORS.health.top);
    expect(hg).toBeGreaterThan(hr);
    expect(hg).toBeGreaterThan(hb);
    const [sr, sg, sb] = rgb(VITAL_COLORS.shield.top);
    expect(sb).toBeGreaterThan(sr);
    expect(sb).toBeGreaterThan(sg);
  });

  it('matches the fill to the value, against the spec maxima', () => {
    const bars = vitalsBars({ health: 50, shield: 25 });
    expect(bars.health.value).toBe(50);
    expect(bars.health.fraction).toBeCloseTo(50 / VITALS.maxHealth);
    expect(bars.shield.value).toBe(25);
    expect(bars.shield.fraction).toBeCloseTo(25 / VITALS.maxShield);
  });

  it('shows a depleted shield as an empty bar, never as a missing one', () => {
    const bars = vitalsBars({ health: 100, shield: 0 });
    expect(bars.shield.fraction).toBe(0);
    expect(bars.shield.value).toBe(0);
    expect(bars.shield.colors).toEqual(VITAL_COLORS.shield);
  });

  it('never reports a fill outside the bar', () => {
    expect(vitalsBars({ health: -40, shield: 9999 }).health.fraction).toBe(0);
    expect(vitalsBars({ health: -40, shield: 9999 }).shield.fraction).toBe(1);
    expect(vitalsBars({}).health.value).toBe(0);
    expect(vitalsBars({ health: NaN }).health.value).toBe(0);
  });

  it('keeps the number and the bar in agreement after rounding', () => {
    const bars = vitalsBars({ health: 49.6, shield: 0.4 });
    expect(bars.health.value).toBe(50);
    expect(bars.health.fraction).toBeCloseTo(0.5);
    expect(bars.shield.value).toBe(0);
    expect(bars.shield.fraction).toBe(0);
  });
});

describe('§18.2, §9.4.1 the material readout', () => {
  it('marks the selected material and nothing else', () => {
    const row = materialRow({ materials: { wood: 10, brick: 20, metal: 30 }, selectedMaterial: 'brick' });
    expect(row.map((m) => m.id)).toEqual([...MATERIAL_ORDER]);
    expect(row.filter((m) => m.selected).map((m) => m.id)).toEqual(['brick']);
    expect(row.map((m) => m.count)).toEqual([10, 20, 30]);
  });

  it('flags affordability against the same cost the build system charges', () => {
    const row = materialRow({ materials: { wood: BUILD.cost, brick: BUILD.cost - 1 } });
    expect(row.find((m) => m.id === 'wood').affordable).toBe(true);
    expect(row.find((m) => m.id === 'brick').affordable).toBe(false);
  });

  it('carries each material colour', () => {
    for (const m of materialRow({})) {
      expect(m.color).toBe(`#${MATERIALS[m.id].color.toString(16).padStart(6, '0')}`);
    }
  });
});

describe('§18.3 material gain feedback', () => {
  it('reports what was gained, with that material name and colour', () => {
    const [gain] = pushMaterialGain([], { type: 'wood', amount: 12, now: 0 });
    expect(gain.amount).toBe(12);
    expect(gain.label).toBe(MATERIALS.wood.name);
    expect(gain.expires).toBeGreaterThan(0);
  });

  it('stacks repeated gains of the same material instead of replacing them', () => {
    let gains = pushMaterialGain([], { type: 'wood', amount: 12, now: 0 });
    gains = pushMaterialGain(gains, { type: 'wood', amount: 12, now: 0.3 });
    expect(gains).toHaveLength(1);
    expect(gains[0].amount).toBe(24);
  });

  it('keeps different materials apart', () => {
    let gains = pushMaterialGain([], { type: 'wood', amount: 12, now: 0 });
    gains = pushMaterialGain(gains, { type: 'metal', amount: 12, now: 0 });
    expect(gains.map((g) => g.type)).toEqual(['wood', 'metal']);
  });

  it('expires, and ignores nonsense', () => {
    const gains = pushMaterialGain([], { type: 'wood', amount: 12, now: 0, life: 1 });
    expect(expireMaterialGains(gains, 0.9)).toHaveLength(1);
    expect(expireMaterialGains(gains, 1.1)).toHaveLength(0);
    expect(pushMaterialGain([], { type: 'gold', amount: 5, now: 0 })).toHaveLength(0);
    expect(pushMaterialGain([], { type: 'wood', amount: 0, now: 0 })).toHaveLength(0);
  });
});
