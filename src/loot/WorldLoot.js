/**
 * WorldLoot.js — physical loot in the world. MASTER_SPEC §16.
 *
 * "World loot must exist physically in the world. Items should have world position, be
 * interactable, display rarity, enter inventory, and be droppable."
 *
 * Chest contents are SPAWNED INTO THE WORLD, never injected straight into the inventory
 * (§16.1). That is the rule this module exists to enforce.
 */
import { TILE, RARITIES } from '../core/Config.js';
import { Events } from '../core/EventBus.js';
import { rollChest, rollAmmoBox, rollFloorLoot } from './LootTables.js';

let nextEntityId = 1;
export function resetLootIds() { nextEntityId = 1; }

/** Base for anything that exists in the world and can be interacted with. */
class WorldEntity {
  constructor(position) {
    this.id = nextEntityId++;
    this.position = { ...position };
    this.removed = false;
  }

  distanceTo(p) {
    return Math.hypot(p.x - this.position.x, p.y - this.position.y, p.z - this.position.z);
  }
}

/** A pickup lying in the world — a weapon, consumable or ammo stack. */
export class LootPickup extends WorldEntity {
  constructor(position, item) {
    super(position);
    this.item = item;
    this.kind = 'pickup';
    // §16 optional polish — a hover/spin phase the renderer can read.
    this.spin = 0;
  }

  get rarity() {
    return this.item.rarity ?? 'common';
  }

  get rarityColor() {
    return RARITIES[this.rarity]?.color ?? RARITIES.common.color;
  }

  get label() {
    if (this.item.kind === 'weapon') return this.item.weapon.name;
    if (this.item.kind === 'ammo') return `${this.item.type} ammo`;
    return this.item.id ?? 'Item';
  }

  update(dt) {
    this.spin = (this.spin + dt * 1.6) % (Math.PI * 2);
  }
}

/** A container that must be opened before its contents exist in the world. */
export class Container extends WorldEntity {
  /** @param {'chest'|'ammoBox'} kind */
  constructor(position, kind = 'chest') {
    super(position);
    this.kind = kind;
    this.opened = false;
    this.openProgress = 0;
  }

  get label() {
    return this.kind === 'chest' ? 'Open Chest' : 'Open Ammo Box';
  }
}

/**
 * Owns every loot entity in the world and the interaction query the player uses.
 */
export class WorldLoot {
  constructor(bus = null, rng = null) {
    this.bus = bus;
    this.rng = rng;
    this.entities = [];
    /** Set once a player opens their first chest, for the §16.1 weapon guarantee. */
    this.firstChestOpened = false;
  }

  get count() {
    return this.entities.filter((e) => !e.removed).length;
  }

  get pickups() {
    return this.entities.filter((e) => !e.removed && e.kind === 'pickup');
  }

  get containers() {
    return this.entities.filter((e) => !e.removed && e.kind !== 'pickup');
  }

  add(entity) {
    this.entities.push(entity);
    return entity;
  }

  addContainer(position, kind = 'chest') {
    return this.add(new Container(position, kind));
  }

  /** Drop an item into the world — used by chests, eliminations and manual drops. */
  spawnPickup(position, item) {
    return this.add(new LootPickup(position, item));
  }

  /**
   * Scatter items around a point so a chest's contents are visibly separate objects
   * rather than a stack in one spot.
   */
  _scatter(origin, items) {
    const spread = TILE * 0.25;
    return items.map((item, i) => {
      const angle = (i / Math.max(items.length, 1)) * Math.PI * 2;
      return this.spawnPickup({
        x: origin.x + Math.cos(angle) * spread,
        y: origin.y,
        z: origin.z + Math.sin(angle) * spread
      }, item);
    });
  }

  /**
   * Open a container. Contents are spawned as world pickups (§16.1).
   * @returns {LootPickup[]} the pickups created
   */
  openContainer(container, { tier = 'poi' } = {}) {
    if (!container || container.opened || container.removed) return [];
    container.opened = true;

    const items = container.kind === 'chest'
      ? rollChest(this.rng, { tier, guaranteeWeapon: !this.firstChestOpened })
      : rollAmmoBox(this.rng);

    if (container.kind === 'chest') this.firstChestOpened = true;

    const spawned = this._scatter(container.position, items);
    this.bus?.emit(container.kind === 'chest' ? 'chest:opened' : 'ammoBox:opened', {
      container, items: spawned.length
    });
    return spawned;
  }

  /** Scatter floor loot at a point (§16, MAP_SPEC §14). */
  spawnFloorLoot(position, { tier = 'countryside' } = {}) {
    return this._scatter(position, rollFloorLoot(this.rng, { tier }));
  }

  /** Everything a player drops on elimination (§13.2). */
  dropInventory(position, inventory, materials = null) {
    const dropped = [];
    for (let i = 0; i < inventory.slots.length; i++) {
      const item = inventory.drop(i);
      if (item) dropped.push(item);
    }
    for (const [type, count] of Object.entries(inventory.ammo)) {
      if (count > 0) dropped.push({ kind: 'ammo', type, count });
    }
    if (materials) {
      for (const [type, count] of Object.entries(materials)) {
        if (count > 0) dropped.push({ kind: 'material', type, count });
      }
    }
    return this._scatter(position, dropped);
  }

  /**
   * The nearest interactable within range — what the interaction prompt shows (§18).
   * @returns {{entity:WorldEntity, distance:number}|null}
   */
  nearestInteractable(position, range) {
    let best = null;
    for (const e of this.entities) {
      if (e.removed) continue;
      if (e.kind !== 'pickup' && e.opened) continue;
      const d = e.distanceTo(position);
      if (d > range) continue;
      if (best === null || d < best.distance) best = { entity: e, distance: d };
    }
    return best;
  }

  /**
   * Pick up an item into an inventory. A displaced item is dropped back into the world,
   * never destroyed (§15).
   * @returns {boolean} whether anything was taken
   */
  collect(pickup, inventory) {
    if (!pickup || pickup.removed) return false;

    if (pickup.item.kind === 'ammo') {
      inventory.addAmmo(pickup.item.type, pickup.item.count);
      pickup.removed = true;
      this.bus?.emit(Events.LOOT_PICKED_UP, { item: pickup.item });
      return true;
    }
    if (pickup.item.kind === 'material') {
      pickup.removed = true;
      this.bus?.emit(Events.LOOT_PICKED_UP, { item: pickup.item });
      return true;
    }

    const { replaced } = inventory.add(pickup.item);
    pickup.removed = true;
    if (replaced) this.spawnPickup(pickup.position, replaced);
    this.bus?.emit(Events.LOOT_PICKED_UP, { item: pickup.item });
    return true;
  }

  update(dt) {
    for (const e of this.entities) {
      if (!e.removed && e.kind === 'pickup') e.update(dt);
    }
    // Compact occasionally so removed entities do not accumulate forever.
    if (this.entities.length > 512) {
      this.entities = this.entities.filter((e) => !e.removed);
    }
  }

  clear() {
    this.entities.length = 0;
  }
}
