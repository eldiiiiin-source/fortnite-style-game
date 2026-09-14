/**
 * Pickaxe.js — MASTER_SPEC §14.
 *
 * Equip, swing, structure hit, prop hit, damage, harvesting, impact feedback.
 * Occupies its own slot, separate from the five combat slots (§15).
 */
import { PICKAXE } from '../core/Config.js';
import { Events } from '../core/EventBus.js';

export class Pickaxe {
  constructor(bus = null) {
    this.bus = bus;
    this.cooldown = 0;
    /** Set when a swing is mid-flight, so the impact lands at the right moment. */
    this.pendingImpact = null;
  }

  get canSwing() {
    return this.cooldown <= 0;
  }

  /** Mid-swing, for presentation only. */
  get swinging() {
    return this.cooldown > 0;
  }

  /**
   * How far through the current swing, 0 at the strike and 1 once recovered.
   *
   * A READ of the existing cooldown, not a second clock: the view animates against this so
   * gameplay stays authoritative and the animation can never drift from the swing rate.
   * Damage lands the instant `swing()` is called, i.e. at progress 0 (§14).
   */
  get swingProgress() {
    if (this.cooldown <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.cooldown / PICKAXE.swingInterval));
  }

  /**
   * Swing. The swing cue fires immediately (§12.2 — no delayed feedback chain); the
   * impact resolves on the same tick against whatever the aim ray hits.
   *
   * @param {object} opts
   * @param {object} opts.aimRay        the shared camera ray (§8.1)
   * @param {object} opts.collision     CollisionWorld
   * @param {number} opts.ownerId
   * @param {(kind:string)=>number} [opts.harvestableAt]  optional prop query
   * @returns {{hit:boolean, target:string|null, damage:number, materialGained:object|null}}
   */
  swing({ aimRay, collision, ownerId = 0 }) {
    if (!this.canSwing) return { hit: false, target: null, damage: 0, materialGained: null };

    this.cooldown = PICKAXE.swingInterval;
    this.bus?.emit('pickaxe:swing', { ownerId });

    const hit = collision?.raycastPieces(aimRay, PICKAXE.range) ?? null;
    if (!hit) return { hit: false, target: null, damage: 0, materialGained: null };

    const piece = hit.piece;
    // §14 / §4.2 — own structures take no pickaxe damage.
    const damage = piece.ownerId === ownerId
      ? PICKAXE.damageToOwnStructures
      : PICKAXE.damageToStructures;

    this.bus?.emit('pickaxe:impact', { ownerId, pieceId: piece.id, damage });

    if (damage > 0) {
      const destroyed = piece.applyDamage(damage);
      this.bus?.emit(Events.PIECE_DAMAGED, { piece, amount: damage, source: 'pickaxe' });
      if (destroyed) this.bus?.emit(Events.PIECE_DESTROYED, { piece, cause: 'pickaxe' });
    }

    return { hit: true, target: 'structure', damage, materialGained: null };
  }

  /** Harvest a world prop, yielding its material (§14). */
  harvest(prop, player) {
    if (!this.canSwing || !prop) return 0;
    this.cooldown = PICKAXE.swingInterval;
    this.bus?.emit('pickaxe:swing', { ownerId: player?.id });
    this.bus?.emit('pickaxe:impact', { ownerId: player?.id, propKind: prop.kind });

    const perSwing = PICKAXE.harvestPerSwing[prop.material] ?? 0;
    const yielded = Math.min(perSwing, prop.remaining ?? perSwing);
    prop.remaining = Math.max(0, (prop.remaining ?? perSwing) - yielded);
    if (prop.remaining === 0) prop.depleted = true;

    return player ? player.addMaterial(prop.material, yielded) : yielded;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
  }
}
