/**
 * EquippedItem.js — MASTER_SPEC §15.4.
 *
 * THE authority on what is visible in the character's hand.
 *
 * The rule the spec states is a rule about state, not about rendering: exactly one held
 * item is visible, and the inventory decides which. So it is resolved HERE, as a pure
 * function of inventory state, and the view is handed the answer. The view holds no
 * equipped state of its own and makes no decision of its own, which is what makes a stale
 * or doubled held item impossible rather than merely unlikely.
 *
 * Pure: no three.js, no DOM. Tested in Node.
 */

/** The three things that can be in a hand (§15.4). There is no fourth. */
export const HeldKind = Object.freeze({
  NONE: 'none',
  PICKAXE: 'pickaxe',
  WEAPON: 'weapon'
});

const EMPTY = Object.freeze({ kind: HeldKind.NONE, id: null, category: null });

/**
 * Resolve what the hand holds.
 *
 * @param {object} inventory      the player's Inventory
 * @param {object} [opts]
 * @param {string} [opts.pickaxeId]  the equipped harvesting-tool cosmetic
 * @returns {{kind:string, id:string|null, category:string|null}}
 */
export function heldItem(inventory, { pickaxeId = null } = {}) {
  if (!inventory) return EMPTY;
  if (inventory.pickaxeEquipped) {
    return { kind: HeldKind.PICKAXE, id: pickaxeId, category: null };
  }

  const slot = inventory.active;
  // An empty slot, or a slot holding a consumable or an ammo stack, shows nothing. It does
  // NOT fall back to the pickaxe: the pickaxe is not equipped, so it is not in the hand.
  if (!slot || slot.kind !== 'weapon' || !slot.weapon) return EMPTY;

  return {
    kind: HeldKind.WEAPON,
    id: slot.weapon.id ?? null,
    category: slot.weapon.category ?? null
  };
}

/**
 * The full per-frame description the view needs: what is held, and the two normalised
 * progresses that animate it.
 *
 * `swingProgress` only means anything for the pickaxe and `adsProgress` only for a weapon,
 * so each is forced to its rest value when it does not apply. A weapon can therefore never
 * inherit a swing, and a pickaxe can never inherit an aim pose.
 *
 * @param {object} inventory
 * @param {object} [opts]
 * @param {string} [opts.pickaxeId]
 * @param {number} [opts.swingProgress]  Pickaxe.swingProgress — 1 when at rest
 * @returns {{kind:string, id:string|null, category:string|null,
 *            swingProgress:number, adsProgress:number}}
 */
export function equippedView(inventory, { pickaxeId = null, swingProgress = 1 } = {}) {
  const held = heldItem(inventory, { pickaxeId });
  return {
    ...held,
    swingProgress: held.kind === HeldKind.PICKAXE ? swingProgress : 1,
    adsProgress: held.kind === HeldKind.WEAPON
      ? (inventory?.activeWeapon?.adsProgress ?? 0)
      : 0
  };
}

/** Do two resolved views describe the same held object? Used to skip pointless rebuilds. */
export function sameHeld(a, b) {
  return Boolean(a) && Boolean(b) && a.kind === b.kind && a.id === b.id;
}
