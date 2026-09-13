/**
 * Weapon.js — a weapon instance: ammo, fire timing, reload, bloom. MASTER_SPEC §5.3-§5.5.
 */
import { WEAPONS, RARITIES, INVENTORY } from '../core/Config.js';
import { Events } from '../core/EventBus.js';
import { computeSpread, decayBloom, computeDamage, computeStructureDamage } from './DamageModel.js';

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
    this.cooldown = 0;          // seconds until the next shot is allowed
    this.shotsInBurst = 0;      // bloom accumulator (§5.5)
    this.timeSinceLastShot = Infinity;
    this.adsProgress = 0;       // 0 = hip, 1 = fully aimed
  }

  get name() { return this.def.name; }
  get ammoType() { return this.def.ammo; }
  get magazine() { return this.def.magazine; }
  get fireInterval() { return 1 / this.def.fireRate; }
  get isEmpty() { return this.ammoInMag <= 0; }
  get canFire() { return !this.reloading && this.cooldown <= 0 && this.ammoInMag > 0; }

  /** Current spread in degrees given the shooter's movement state. */
  spread(shooterState = {}) {
    return computeSpread({
      weaponId: this.id,
      ads: this.adsProgress >= 1,
      shotsInBurst: this.shotsInBurst,
      ...shooterState
    });
  }

  damageAt(distance, region = 'torso', pelletsHit = null) {
    return computeDamage({
      weaponId: this.id, rarity: this.rarity, region, distance, pelletsHit
    });
  }

  get structureDamage() {
    return computeStructureDamage({ weaponId: this.id, rarity: this.rarity });
  }

  /**
   * Attempt to fire. Consumes one round and starts the cooldown.
   * @returns {boolean} whether a shot was fired
   */
  fire(bus = null) {
    if (!this.canFire) return false;
    this.ammoInMag -= 1;
    this.cooldown = this.fireInterval;
    this.shotsInBurst += 1;
    this.timeSinceLastShot = 0;
    bus?.emit(Events.WEAPON_FIRED, { weaponId: this.id, rarity: this.rarity, ammoLeft: this.ammoInMag });
    return true;
  }

  /** Begin a reload from a reserve pool. Returns false if it would do nothing. */
  beginReload(reserveAmmo) {
    if (this.reloading || this.ammoInMag >= this.def.magazine || reserveAmmo <= 0) return false;
    this.reloading = true;
    this.reloadRemaining = this.def.reloadTime;
    return true;
  }

  /** §5.7 — switching slots cancels a reload. */
  cancelReload() {
    this.reloading = false;
    this.reloadRemaining = 0;
  }

  /**
   * @param {number} dt
   * @param {object} ctx { reserveAmmo, ads }
   * @returns {number} rounds consumed from the reserve this tick
   */
  update(dt, { reserveAmmo = 0, ads = false } = {}) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.timeSinceLastShot += dt;
    this.shotsInBurst = decayBloom(this.shotsInBurst, this.timeSinceLastShot, this.id, dt);

    const adsTime = this.def.adsTime;
    const target = ads ? 1 : 0;
    const step = dt / adsTime;
    this.adsProgress = target > this.adsProgress
      ? Math.min(1, this.adsProgress + step)
      : Math.max(0, this.adsProgress - step);

    if (!this.reloading) return 0;

    this.reloadRemaining -= dt;
    if (this.reloadRemaining > 0) return 0;

    this.reloading = false;
    this.reloadRemaining = 0;
    const needed = this.def.magazine - this.ammoInMag;
    const loaded = Math.min(needed, reserveAmmo);
    this.ammoInMag += loaded;
    return loaded;
  }
}

/**
 * Inventory — 6 slots, slot 0 is the harvesting tool and cannot be replaced. §5.7
 */
export class Inventory {
  constructor() {
    this.slots = new Array(INVENTORY.slots).fill(null);
    this.slots[INVENTORY.toolSlot] = { kind: 'tool', id: 'harvestingTool' };
    this.selected = INVENTORY.toolSlot;
    this.switchCooldown = 0;
    this.ammo = { light: 0, medium: 0, heavy: 0, shells: 0, rockets: 0 };
  }

  get active() {
    return this.slots[this.selected];
  }

  get activeWeapon() {
    const s = this.active;
    return s?.kind === 'weapon' ? s.weapon : null;
  }

  /** @returns {boolean} whether the slot changed */
  select(index) {
    if (index < 0 || index >= this.slots.length) return false;
    if (index === this.selected || this.switchCooldown > 0) return false;
    this.activeWeapon?.cancelReload(); // §5.7
    this.selected = index;
    this.switchCooldown = INVENTORY.switchTime;
    return true;
  }

  /** Put an item in the first free non-tool slot, or in the selected slot if full. */
  add(item) {
    for (let i = 0; i < this.slots.length; i++) {
      if (i === INVENTORY.toolSlot) continue;
      if (this.slots[i] === null) {
        this.slots[i] = item;
        return { slot: i, replaced: null };
      }
    }
    const target = this.selected === INVENTORY.toolSlot ? 1 : this.selected;
    const replaced = this.slots[target];
    this.slots[target] = item;
    return { slot: target, replaced };
  }

  /** Drop a slot's contents. The tool slot cannot be dropped (§5.7). */
  drop(index) {
    if (index === INVENTORY.toolSlot) return null;
    const item = this.slots[index];
    this.slots[index] = null;
    return item;
  }

  addAmmo(type, amount) {
    if (!(type in this.ammo)) return 0;
    const cap = INVENTORY.stackSizes[type];
    const before = this.ammo[type];
    this.ammo[type] = Math.min(cap, before + amount);
    return this.ammo[type] - before;
  }

  update(dt) {
    this.switchCooldown = Math.max(0, this.switchCooldown - dt);
    const weapon = this.activeWeapon;
    if (!weapon) return;
    const consumed = weapon.update(dt, { reserveAmmo: this.ammo[weapon.ammoType] ?? 0 });
    if (consumed > 0) this.ammo[weapon.ammoType] -= consumed;
  }
}
