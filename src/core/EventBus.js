/**
 * EventBus.js — the only channel systems use to talk to each other (CLAUDE.md).
 *
 * Synchronous dispatch. Handlers that throw are isolated so one bad listener cannot
 * take down a simulation tick.
 */
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`EventBus handler for "${type}" threw:`, err);
      }
    }
  }

  clear() {
    this.listeners.clear();
  }
}

/** Event names, centralised so a typo is a missing import rather than a silent no-op. */
export const Events = Object.freeze({
  PIECE_PLACED: 'piece:placed',
  PIECE_DAMAGED: 'piece:damaged',
  PIECE_DESTROYED: 'piece:destroyed',
  PIECE_EDITED: 'piece:edited',
  PLAYER_DAMAGED: 'player:damaged',
  PLAYER_HEALED: 'player:healed',
  PLAYER_DIED: 'player:died',
  PLAYER_LANDED: 'player:landed',
  WEAPON_FIRED: 'weapon:fired',
  WEAPON_RELOADED: 'weapon:reloaded',
  MATERIAL_GAINED: 'material:gained',
  MATERIAL_SPENT: 'material:spent',
  LOOT_PICKED_UP: 'loot:pickedUp',
  STORM_PHASE_CHANGED: 'storm:phaseChanged',
  STORM_STARTED: 'storm:started',
  STORM_SHRINK_STARTED: 'storm:shrinkStarted',
  STORM_SHRINK_ENDED: 'storm:shrinkEnded',
  PLAYER_ENTERED_STORM: 'storm:playerEntered',
  PLAYER_LEFT_STORM: 'storm:playerLeft',
  MATCH_STATE_CHANGED: 'match:stateChanged',
  PARTICIPANT_ELIMINATED: 'match:participantEliminated',
  MATCH_ENDED: 'match:ended',
  PURCHASE_COMPLETED: 'shop:purchaseCompleted',
  COSMETIC_EQUIPPED: 'profile:cosmeticEquipped',
  BUILD_MODE_CHANGED: 'build:modeChanged',
  /** MASTER_SPEC §9.4.1 — the material a placement will spend has changed. */
  BUILD_MATERIAL_CHANGED: 'build:materialChanged',
  EDIT_STARTED: 'edit:started',
  EDIT_CONFIRMED: 'edit:confirmed',
  EDIT_CANCELLED: 'edit:cancelled'
});
