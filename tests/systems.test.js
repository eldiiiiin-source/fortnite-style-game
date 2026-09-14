/** Settings, audio, world loot, pickaxe and bots. MASTER_SPEC §14, §16, §17, §19, §21. */
import { describe, it, expect, beforeEach } from 'vitest';
import { Settings, DEFAULT_SETTINGS } from '../src/core/Settings.js';
import { AudioSystem, CUES, FOOTSTEP_SURFACES } from '../src/audio/AudioSystem.js';
import { WorldLoot, LootPickup, Container, resetLootIds } from '../src/loot/WorldLoot.js';
import { Pickaxe } from '../src/combat/Pickaxe.js';
import { resetBotIds } from '../src/world/Bot.js';
import { Inventory, Weapon } from '../src/combat/Weapon.js';
import { BuildGrid } from '../src/building/BuildGrid.js';
import { BuildPiece, resetPieceIds } from '../src/building/BuildPiece.js';
import { CollisionWorld } from '../src/building/CollisionWorld.js';
import { EventBus, Events } from '../src/core/EventBus.js';
import { RandomStream } from '../src/core/Random.js';
import { PICKAXE, SIM, TILE, INVENTORY } from '../src/core/Config.js';

const dt = SIM.fixedDt;
beforeEach(() => { resetLootIds(); resetBotIds(); resetPieceIds(); });

/* ── §19 settings ────────────────────────────────────────────────────────── */

describe('§19 settings', () => {
  it('exposes every required group', () => {
    for (const g of ['video', 'input', 'gameplay', 'audio', 'hud']) {
      expect(DEFAULT_SETTINGS[g], g).toBeDefined();
    }
  });

  it('covers the required video settings', () => {
    for (const k of ['fullscreen', 'quality', 'shadows', 'effects', 'renderDistance', 'fpsLimit', 'fov']) {
      expect(DEFAULT_SETTINGS.video[k], k).toBeDefined();
    }
  });

  it('covers the required input settings', () => {
    for (const k of ['mouseSensitivity', 'adsSensitivity', 'scopeSensitivity', 'invertY']) {
      expect(DEFAULT_SETTINGS.input[k], k).toBeDefined();
    }
  });

  it('exposes confirm-edit-on-release as a real setting', () => {
    const s = new Settings();
    expect(s.confirmEditOnRelease).toBe(true);
    expect(s.set('gameplay.confirmEditOnRelease', false)).toBe(true);
    expect(s.confirmEditOnRelease).toBe(false);
  });

  it('rejects an unknown path rather than inventing a setting', () => {
    const s = new Settings();
    expect(s.set('video.raytracing', true)).toBe(false);
    expect(s.get('video.raytracing')).toBeUndefined();
  });

  it('clamps out-of-range values', () => {
    const s = new Settings();
    s.set('video.fov', 9999);
    expect(s.get('video.fov')).toBe(120);
    s.set('audio.master', -5);
    expect(s.get('audio.master')).toBe(0);
  });

  it('rejects a wrong-typed value', () => {
    const s = new Settings();
    expect(s.set('video.shadows', 'yes')).toBe(false);
    expect(s.set('video.quality', 'ultra')).toBe(false);
  });

  it('notifies listeners on change', () => {
    const s = new Settings();
    const seen = [];
    s.onChange((path, value) => seen.push([path, value]));
    s.set('hud.scale', 1.2);
    expect(seen).toEqual([['hud.scale', 1.2]]);
  });

  it('reports bind conflicts instead of accepting them', () => {
    const s = new Settings();
    const r = s.rebind('jump', 'KeyW');
    expect(r.ok).toBe(false);
    expect(r.conflicts).toContain('moveForward');
    expect(s.bindings.jump).toBe('Space');
  });

  it('forces a rebind when asked, clearing the loser', () => {
    const s = new Settings();
    expect(s.rebind('jump', 'KeyW', { force: true }).ok).toBe(true);
    expect(s.bindings.moveForward).toBeNull();
  });

  it('round-trips through storage', () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v)
    };
    const a = new Settings();
    a.set('input.mouseSensitivity', 2.5);
    a.rebind('wall', 'KeyZ');
    expect(a.save(storage)).toBe(true);

    const b = new Settings();
    b.load(storage);
    expect(b.get('input.mouseSensitivity')).toBe(2.5);
    expect(b.bindings.wall).toBe('KeyZ');
  });

  it('starts with defaults when storage is broken', () => {
    const broken = { getItem: () => '{{{not json', setItem: () => { throw new Error('full'); } };
    const s = new Settings();
    expect(s.load(broken)).toBe(false);
    expect(s.save(broken)).toBe(false);
    expect(s.get('video.quality')).toBe('high');
  });

  it('ignores unknown keys in stored data', () => {
    const storage = {
      getItem: () => JSON.stringify({ values: { video: { quality: 'low', bogus: 1 } } }),
      setItem: () => {}
    };
    const s = new Settings();
    s.load(storage);
    expect(s.get('video.quality')).toBe('low');
    expect(s.values.video.bogus).toBeUndefined();
  });

  it('resets to defaults', () => {
    const s = new Settings();
    s.set('video.quality', 'low');
    s.rebind('wall', 'KeyZ');
    s.resetAll();
    expect(s.get('video.quality')).toBe('high');
    expect(s.bindings.wall).toBe('KeyQ');
  });
});

/* ── §21 audio ───────────────────────────────────────────────────────────── */

describe('§21 audio', () => {
  it('defines every required cue category', () => {
    const required = [
      'weaponFire', 'reload', 'emptyWeapon', 'hitmarker', 'headshot', 'elimination',
      'pickaxeSwing', 'pickaxeImpact', 'footstep', 'jump', 'landing',
      'buildPlace', 'buildEdit', 'editReset', 'chestOpen', 'ammoBox', 'pickup',
      'uiNavigate', 'victory'
    ];
    for (const cue of required) expect(CUES[cue], cue).toBeDefined();
  });

  it('keeps every cue short and not excessively loud', () => {
    for (const [name, cue] of Object.entries(CUES)) {
      expect(cue.duration, name).toBeLessThanOrEqual(0.6);
      expect(cue.gain, name).toBeLessThanOrEqual(0.75);
    }
  });

  it('provides surface-based footsteps', () => {
    for (const s of ['grass', 'wood', 'metal', 'stone', 'water']) {
      expect(FOOTSTEP_SURFACES[s], s).toBeDefined();
    }
  });

  it('is inert without an AudioContext but still logs', () => {
    const audio = new AudioSystem();
    expect(audio.enabled).toBe(false);
    expect(audio.play('weaponFire')).toBe(false);
    expect(audio.playedCues).toEqual(['weaponFire']);
  });

  it('ignores an unknown cue', () => {
    const audio = new AudioSystem();
    expect(audio.play('explosionOfDoom')).toBe(false);
  });

  it('responds to gameplay events without gameplay knowing it exists', () => {
    const bus = new EventBus();
    const audio = new AudioSystem();
    audio.attach(bus);

    bus.emit(Events.WEAPON_FIRED, { weaponId: 'assaultRifle' });
    bus.emit(Events.PIECE_PLACED, {});
    bus.emit(Events.PIECE_EDITED, { reset: true });
    bus.emit('weapon:hit', { headshot: true });

    expect(audio.playedCues).toEqual(['weaponFire', 'buildPlace', 'editReset', 'headshot']);
  });

  it('uses a heavier cue for heavy weapons', () => {
    const bus = new EventBus();
    const audio = new AudioSystem();
    audio.attach(bus);
    bus.emit(Events.WEAPON_FIRED, { weaponId: 'boltSniper' });
    expect(audio.playedCues).toEqual(['weaponFireHeavy']);
  });

  it('bounds its log', () => {
    const audio = new AudioSystem();
    for (let i = 0; i < 500; i++) audio.play('hitmarker');
    expect(audio.log.length).toBeLessThanOrEqual(audio.maxLog);
  });
});

/* ── §16 world loot ──────────────────────────────────────────────────────── */

describe('§16 loot exists physically in the world', () => {
  let bus, rng, loot;
  beforeEach(() => {
    bus = new EventBus();
    rng = new RandomStream(42);
    loot = new WorldLoot(bus, rng);
  });

  it('gives every pickup a world position and a rarity', () => {
    const p = loot.spawnPickup({ x: 1, y: 2, z: 3 }, {
      kind: 'weapon', rarity: 'epic', weapon: new Weapon('smg', 'epic')
    });
    expect(p).toBeInstanceOf(LootPickup);
    expect(p.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(p.rarity).toBe('epic');
    expect(p.rarityColor).toBeTypeOf('number');
    expect(p.label).toBe('SMG');
  });

  it('spawns chest contents INTO THE WORLD, not into the inventory', () => {
    const chest = loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest');
    const inv = new Inventory();
    const before = inv.itemCount;

    const spawned = loot.openContainer(chest);
    expect(spawned.length).toBeGreaterThan(0);
    expect(inv.itemCount).toBe(before);          // inventory untouched
    expect(loot.pickups.length).toBe(spawned.length);
    for (const p of spawned) expect(p).toBeInstanceOf(LootPickup);
  });

  it('scatters contents rather than stacking them at one point', () => {
    const chest = loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest');
    const spawned = loot.openContainer(chest);
    const positions = new Set(spawned.map((p) => `${p.position.x.toFixed(3)},${p.position.z.toFixed(3)}`));
    expect(positions.size).toBe(spawned.length);
  });

  it('guarantees a weapon in the first chest only', () => {
    const first = loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest');
    const spawned = loot.openContainer(first);
    expect(spawned.some((p) => p.item.kind === 'weapon')).toBe(true);
    expect(loot.firstChestOpened).toBe(true);
  });

  it('refuses to open a chest twice', () => {
    const chest = loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest');
    expect(loot.openContainer(chest).length).toBeGreaterThan(0);
    expect(loot.openContainer(chest)).toEqual([]);
  });

  it('emits an event when a container opens', () => {
    const seen = [];
    bus.on('chest:opened', () => seen.push('chest'));
    bus.on('ammoBox:opened', () => seen.push('ammo'));
    loot.openContainer(loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest'));
    loot.openContainer(loot.addContainer({ x: 5, y: 0, z: 0 }, 'ammoBox'));
    expect(seen).toEqual(['chest', 'ammo']);
  });

  it('finds the nearest interactable within range', () => {
    loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest');
    const near = loot.addContainer({ x: 1, y: 0, z: 0 }, 'ammoBox');
    const found = loot.nearestInteractable({ x: 1.2, y: 0, z: 0 }, TILE);
    expect(found.entity.id).toBe(near.id);
  });

  it('reports nothing when out of range', () => {
    loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest');
    expect(loot.nearestInteractable({ x: 500, y: 0, z: 0 }, TILE)).toBeNull();
  });

  it('skips opened containers when prompting', () => {
    const chest = loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest');
    loot.openContainer(chest);
    const found = loot.nearestInteractable({ x: 0, y: 0, z: 0 }, TILE);
    // The chest itself is done; only the pickups it spawned remain interactable.
    expect(found.entity.kind).toBe('pickup');
  });

  it('collects a pickup into the inventory', () => {
    const inv = new Inventory();
    const p = loot.spawnPickup({ x: 0, y: 0, z: 0 }, {
      kind: 'weapon', rarity: 'rare', weapon: new Weapon('pistol', 'rare')
    });
    expect(loot.collect(p, inv)).toBe(true);
    expect(p.removed).toBe(true);
    expect(inv.itemCount).toBe(1);
  });

  it('drops a displaced item back into the world instead of deleting it', () => {
    const inv = new Inventory();
    for (let i = 0; i < INVENTORY.combatSlots; i++) {
      inv.slots[i] = { kind: 'weapon', rarity: 'common', weapon: new Weapon('pistol') };
    }
    const p = loot.spawnPickup({ x: 0, y: 0, z: 0 }, {
      kind: 'weapon', rarity: 'legendary', weapon: new Weapon('boltSniper', 'legendary')
    });
    loot.collect(p, inv);

    expect(inv.itemCount).toBe(INVENTORY.combatSlots);
    // The displaced weapon is now lying in the world.
    expect(loot.pickups.length).toBe(1);
  });

  it('adds ammo straight to the reserve', () => {
    const inv = new Inventory();
    const p = loot.spawnPickup({ x: 0, y: 0, z: 0 }, { kind: 'ammo', type: 'medium', count: 30 });
    loot.collect(p, inv);
    expect(inv.ammo.medium).toBe(30);
  });

  it('drops a whole inventory on elimination', () => {
    const inv = new Inventory();
    inv.slots[0] = { kind: 'weapon', rarity: 'common', weapon: new Weapon('smg') };
    inv.addAmmo('light', 60);
    const dropped = loot.dropInventory({ x: 0, y: 0, z: 0 }, inv, { wood: 100, brick: 0, metal: 0 });
    expect(dropped.length).toBeGreaterThanOrEqual(2);
    expect(inv.itemCount).toBe(0);
  });

  it('animates pickups without touching simulation state', () => {
    const p = loot.spawnPickup({ x: 0, y: 0, z: 0 }, { kind: 'ammo', type: 'light', count: 1 });
    const before = p.position.x;
    loot.update(dt);
    expect(p.spin).toBeGreaterThan(0);
    expect(p.position.x).toBe(before);
  });

  it('builds containers of both kinds', () => {
    expect(loot.addContainer({ x: 0, y: 0, z: 0 }, 'chest')).toBeInstanceOf(Container);
    expect(loot.addContainer({ x: 1, y: 0, z: 0 }, 'ammoBox').label).toContain('Ammo');
  });
});

/* ── §14 pickaxe ─────────────────────────────────────────────────────────── */

describe('§14 pickaxe', () => {
  let grid, collision, bus, pickaxe;
  beforeEach(() => {
    grid = new BuildGrid();
    collision = new CollisionWorld(grid);
    bus = new EventBus();
    pickaxe = new Pickaxe(bus);
  });

  // Stand within PICKAXE.range of the wall's north face (z = BUILD.thickness).
  const ray = { origin: { x: TILE / 2, y: 1, z: PICKAXE.range * 0.6 }, direction: { x: 0, y: 0, z: -1 } };

  it('damages an enemy structure', () => {
    const wall = grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north', ownerId: 2
    }));
    const hp = wall.hp;
    const r = pickaxe.swing({ aimRay: ray, collision, ownerId: 1 });
    expect(r.hit).toBe(true);
    expect(r.damage).toBe(PICKAXE.damageToStructures);
    expect(wall.hp).toBeLessThan(hp);
  });

  it('never damages the swinger\'s own structure', () => {
    const wall = grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north', ownerId: 1
    }));
    const hp = wall.hp;
    const r = pickaxe.swing({ aimRay: ray, collision, ownerId: 1 });
    expect(r.damage).toBe(0);
    expect(wall.hp).toBe(hp);
  });

  it('respects the swing interval', () => {
    grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north', ownerId: 2
    }));
    expect(pickaxe.swing({ aimRay: ray, collision, ownerId: 1 }).hit).toBe(true);
    expect(pickaxe.canSwing).toBe(false);
    expect(pickaxe.swing({ aimRay: ray, collision, ownerId: 1 }).hit).toBe(false);
    pickaxe.update(PICKAXE.swingInterval);
    expect(pickaxe.canSwing).toBe(true);
  });

  it('emits swing and impact feedback', () => {
    grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north', ownerId: 2
    }));
    const seen = [];
    bus.on('pickaxe:swing', () => seen.push('swing'));
    bus.on('pickaxe:impact', () => seen.push('impact'));
    pickaxe.swing({ aimRay: ray, collision, ownerId: 1 });
    expect(seen).toEqual(['swing', 'impact']);
  });

  it('swings at nothing without erroring', () => {
    const r = pickaxe.swing({ aimRay: ray, collision, ownerId: 1 });
    expect(r.hit).toBe(false);
  });

  it('harvests a prop and depletes it', () => {
    const player = { id: 1, materials: { wood: 0, brick: 0, metal: 0 }, addMaterial(t, a) {
      this.materials[t] += a; return a;
    } };
    const prop = { kind: 'tree', material: 'wood', remaining: 20, depleted: false };

    const gained = pickaxe.harvest(prop, player);
    expect(gained).toBe(PICKAXE.harvestPerSwing.wood);
    expect(prop.remaining).toBe(20 - PICKAXE.harvestPerSwing.wood);

    pickaxe.update(PICKAXE.swingInterval);
    pickaxe.harvest(prop, player);
    expect(prop.depleted).toBe(true);
    expect(prop.remaining).toBe(0);
  });
});

/* ── §17 bots ────────────────────────────────────────────────────────────
 *
 * Bot coverage lives in tests/battleroyale.test.js, against BATTLE_ROYALE_SPEC §9.
 * The bots were rewritten from a sandbox target into a battle royale participant with
 * the spec's ten-state machine, looting, healing, storm rotation and bot-vs-bot combat,
 * so the earlier sandbox-era tests here were testing an API the spec superseded.
 */
