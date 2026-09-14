/**
 * Weapon.js — a weapon instance and the five-slot inventory. MASTER_SPEC §12, §15.
 */
import { WEAPONS, RARITIES, INVENTORY } from '../core/Config.js';
import { Events } from '../core/EventBus.js';
import {
  computeSpread, decayBloom, singleHitDamage, computeStructureDamage,
  recoilKick, recoilRecover
} from './DamageModel.js';

export class Weapon {
  constructor(weaponId, rarity = 'common') {
    const def = WEAPONS[weaponId];
    if (!def) throw new Error(`Unknown weapon: ${weaponId}`);
    if (!RARITIES[rarity]) throw new Error(`Unknown rarity: ${rarity}`);

    this.def = def;
    this.id = weaponId;
    this.rarity = rarity;

    this.ammoInMag = def.magazine;
    this.reloading = false;
    this.reloadRemaining = 0;
    this.cooldown = 0;
    this.equipRemaining = 0;       // §12 — per-weapon equip time
    this.shotsInBurst = 0;
    this.timeSinceLastShot = Infinity;
    this.adsProgress = 0;
    this.recoil = { pitch: 0, yaw: 0 };
  }

  get name() { return this.def.name; }
  get category() { return this.def.category; }
  get ammoType() { return this.def.ammo; }
  get reserveCap() { return this.def.reserveAmmo; }
  get magazine() { return this.def.magazine; }
  get fireInterval() { return 1 / this.def.fireRate; }
  get isEmpty() { return this.ammoInMag <= 0; }
  get isEquipping() { return this.equipRemaining > 0; }

  /** §12.2 — fire is immediate; only equip, cooldown and ammo gate it. */
  get canFire() {
    return !this.reloading && this.cooldown <= 0 && this.equipRemaining <= 0 && this.ammoInMag > 0;
  }

  /** Called when this weapon becomes the active slot (§12). */
  beginEquip() {
    this.equipRemaining = this.def.equipTime;
    this.cancelReload();
  }

  spread(shooterState = {}) {
    return computeSpread({
      weaponId: this.id,
      ads: this.adsProgress >= 1,
      shotsInBurst: this.shotsInBurst,
      ...shooterState
    });
  }

  damageAt(distance, region = 'torso') {
    return singleHitDamage({ weaponId: this.id, rarity: this.rarity, region, distance });
  }

  get structureDamage() {
    return computeStructureDamage({ weaponId: this.id, rarity: this.rarity });
  }

  /**
   * Fire one shot. Consumes a round, starts the cooldown, applies recoil.
   * @returns {boolean} whether a shot was fired
   */
  fire(bus = null, rng = null) {
    if (!this.canFire) return false;
    this.ammoInMag -= 1;
    this.cooldown = this.fireInterval;
    this.shotsInBurst += 1;
    this.timeSinceLastShot = 0;

    const kick = recoilKick(this.id, rng);
    this.recoil.pitch += kick.pitch;
    this.recoil.yaw += kick.yaw;

    bus?.emit(Events.WEAPON_FIRED, {
      weaponId: this.id, rarity: this.rarity, ammoLeft: this.ammoInMag
    });
    return true;
  }

  beginReload(reserveAmmo) {
    if (this.reloading || this.equipRemaining > 0) return false;
    if (this.ammoInMag >= this.def.magazine || reserveAmmo <= 0) return false;
    this.reloading = true;
    this.reloadRemaining = this.def.reloadTime;
    return true;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadRemaining = 0;
  }

  /**
   * @returns {number} rounds consumed from the reserve this tick
   */
  update(dt, { reserveAmmo = 0, ads = false } = {}) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.equipRemaining = Math.max(0, this.equipRemaining - dt);
    this.timeSinceLastShot += dt;
    this.shotsInBurst = decayBloom(this.shotsInBurst, this.timeSinceLastShot, this.id, dt);
    this.recoil = recoilRecover(this.recoil, this.id, dt);

    const step = dt / this.def.adsTime;
    this.adsProgress = ads
      ? Math.min(1, this.adsProgress + step)
      : Math.max(0, this.adsProgress - step);

    if (!this.reloading) return 0;
    this.reloadRemaining -= dt;
    if (this.reloadRemaining > 0) return 0;

    this.reloading = false;
    this.reloadRemaining = 0;
    const loaded = Math.min(this.def.magazine - this.ammoInMag, reserveAmmo);
    this.ammoInMag += loaded;
    return loaded;
  }
}

/**
 * Inventory — FIVE combat slots plus a separate pickaxe (§15).
 *
 * The pickaxe is not a slot: it is bound to its own action and always available, so the
 * five slots are all usable for weapons and consumables.
 *
 * Every operation is total — an item leaving a slot is placed elsewhere or returned to the
 * caller to drop into the world. Nothing is ever discarded (§15).
 */
export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY.combatSlots).fill(null);
    this.selected = 0;
    /** true when the pickaxe is out rather than a combat slot. */
    this.pickaxeEquipped = true;
    this.switchCooldown = 0;
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 };
  }

  get size() {
    return this.slots.length;
  }

  get active() {
    return this.pickaxeEquipped ? null : this.slots[this.selected];
  }

  get activeWeapon() {
    const slot = this.active;
    return slot?.kind === 'weapon' ? slot.weapon : null;
  }

  /** Equip the pickaxe (§14) — its own action, not a slot. */
  equipPickaxe() {
    if (this.pickaxeEquipped) return false;
    this.activeWeapon?.cancelReload();
    this.pickaxeEquipped = true;
    this.switchCooldown = INVENTORY.switchTime;
    return true;
  }

  /** Select a combat slot by index. */
  select(index) {
    if (index < 0 || index >= this.slots.length) return false;
    if (this.switchCooldown > 0) return false;
    if (!this.pickaxeEquipped && index === this.selected) return false;

    this.activeWeapon?.cancelReload();   // §15 — switching cancels a reload
    this.selected = index;
    this.pickaxeEquipped = false;
    this.switchCooldown = INVENTORY.switchTime;
    this.activeWeapon?.beginEquip();
    return true;
  }

  /** Mouse wheel cycling (§15). */
  cycle(direction) {
    const next = (this.selected + (direction > 0 ? 1 : -1) + this.slots.length) % this.slots.length;
    const wasCooling = this.switchCooldown;
    this.switchCooldown = 0;
    const ok = this.select(next);
    if (!ok) this.switchCooldown = wasCooling;
    return ok;
  }

  /**
   * Add an item. Prefers an empty slot; otherwise replaces the selected slot and RETURNS
   * what was displaced so the caller drops it into the world (§15, §16).
   * @returns {{slot:number, replaced:object|null}}
   */
  add(item) {
    const empty = this.slots.indexOf(null);
    if (empty >= 0) {
      this.slots[empty] = item;
      return { slot: empty, replaced: null };
    }
    const target = this.selected;
    const replaced = this.slots[target];
    this.slots[target] = item;
    return { slot: target, replaced };
  }

  /** Remove and return a slot's contents. */
  drop(index) {
    if (index < 0 || index >= this.slots.length) return null;
    const item = this.slots[index];
    this.slots[index] = null;
    return item;
  }

  /** Swap two slots — reordering never loses an item (§15). */
  reorder(from, to) {
    if (from < 0 || from >= this.slots.length) return false;
    if (to < 0 || to >= this.slots.length) return false;
    [this.slots[from], this.slots[to]] = [this.slots[to], this.slots[from]];
    return true;
  }

  addAmmo(type, amount) {
    if (!(type in this.ammo)) return 0;
    const cap = INVENTORY.stackSizes[type];
    const before = this.ammo[type];
    this.ammo[type] = Math.min(cap, before + amount);
    return this.ammo[type] - before;
  }

  /** Total item count, for the "never randomly delete items" invariant. */
  get itemCount() {
    return this.slots.filter((s) => s !== null).length;
  }

  update(dt, { ads = false } = {}) {
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    const weapon = this.activeWeapon;
    if (!weapon) return;
    const consumed = weapon.update(dt, { reserveAmmo: this.ammo[weapon.ammoType] ?? 0, ads });
    if (consumed > 0) this.ammo[weapon.ammoType] -= consumed;
  }
}
