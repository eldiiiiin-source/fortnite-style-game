/**
 * Health.js — a player's health/shield pool and consumables. MASTER_SPEC §3.1, §5.8.
 */
import { VITALS, CONSUMABLES } from '../core/Config.js';
import { Events } from '../core/EventBus.js';
import { applyDamageToVitals } from './DamageModel.js';
import { clamp } from '../core/MathUtils.js';

export class Health {
  constructor(bus = null, ownerId = 0) {
    this.bus = bus;
    this.ownerId = ownerId;
    this.health = VITALS.startHealth;
    this.shield = VITALS.startShield;
    this.alive = true;

    /** In-progress consumable, or null. */
    this.consuming = null; // { id, remaining }
  }

  get isFull() {
    return this.health >= VITALS.maxHealth && this.shield >= VITALS.maxShield;
  }

  /** @returns {{healthLost:number, shieldAbsorbed:number, died:boolean}} */
  takeDamage(amount, meta = {}) {
    if (!this.alive || amount <= 0) {
      return { healthLost: 0, shieldAbsorbed: 0, died: false };
    }

    const result = applyDamageToVitals(this.health, this.shield, amount);
    this.health = result.health;
    this.shield = result.shield;

    // §5.8 — taking damage cancels a consumable; the item is not consumed.
    if (this.consuming) this.cancelConsumable();

    this.bus?.emit(Events.PLAYER_DAMAGED, {
      ownerId: this.ownerId, amount,
      healthLost: result.healthLost, shieldAbsorbed: result.shieldAbsorbed,
      ...meta
    });

    if (result.died) {
      this.alive = false;
      this.bus?.emit(Events.PLAYER_DIED, { ownerId: this.ownerId, ...meta });
    }
    return result;
  }

  /** Damage that bypasses shield entirely (storm, environment). */
  takeDirectHealthDamage(amount, cause = 'environment') {
    return this._directHealth(amount, cause);
  }

  _directHealth(amount, cause) {
    if (!this.alive || amount <= 0) return 0;
    this.health = Math.max(0, this.health - amount);
    this.bus?.emit(Events.PLAYER_DAMAGED, {
      ownerId: this.ownerId, amount, healthLost: amount, shieldAbsorbed: 0, cause
    });
    if (this.health <= 0) {
      this.alive = false;
      this.bus?.emit(Events.PLAYER_DIED, { ownerId: this.ownerId, cause });
    }
    return amount;
  }

  /** Start consuming an item. Returns false if it would have no effect (§5.8). */
  beginConsumable(id) {
    const def = CONSUMABLES[id];
    if (!def || this.consuming) return false;
    if (def.health != null && this.health >= def.healthCap) return false;
    if (def.shield != null && this.shield >= def.shieldCap) return false;
    this.consuming = { id, remaining: def.useTime };
    return true;
  }

  cancelConsumable() {
    this.consuming = null;
  }

  /** Advance an in-progress consumable. */
  update(dt) {
    if (!this.consuming) return;
    this.consuming.remaining -= dt;
    if (this.consuming.remaining > 0) return;

    const def = CONSUMABLES[this.consuming.id];
    this.consuming = null;

    if (def.health != null) {
      // medkit sets health to its cap; bandage adds but never past its cap.
      const target = def.id === 'medkit' ? def.healthCap : this.health + def.health;
      this.health = clamp(Math.min(target, def.healthCap), 0, VITALS.maxHealth);
    }
    if (def.shield != null) {
      this.shield = clamp(Math.min(this.shield + def.shield, def.shieldCap), 0, VITALS.maxShield);
    }
    this.bus?.emit(Events.PLAYER_HEALED, {
      ownerId: this.ownerId, item: def.id, health: this.health, shield: this.shield
    });
  }

  reset() {
    this.health = VITALS.startHealth;
    this.shield = VITALS.startShield;
    this.alive = true;
    this.consuming = null;
  }
}
