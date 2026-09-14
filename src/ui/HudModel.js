/**
 * HudModel.js — MASTER_SPEC §18.1, §18.2, §18.3.
 *
 * What the HUD SAYS, separated from how it is drawn.
 *
 * `HUD.js` is a DOM writer and CLAUDE.md forbids testing DOM output, but the things §18.2
 * actually specifies — health is green, shield is blue, a bar's fill matches its value, a
 * depleted shield still shows — are statements about values, not about markup. They live
 * here, as pure functions, and are asserted against the spec in Node.
 *
 * Pure: no DOM, no three.js, no simulation state of its own.
 */
import { VITALS, VITAL_COLORS, MATERIALS, MATERIAL_ORDER, BUILD } from '../core/Config.js';

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** A hex integer colour as CSS. Material colours are stored as integers; vitals as strings. */
export const cssHex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * §18.2 — the health and shield readouts.
 *
 * Values are rounded the way they are shown, and the fill is computed from the ROUNDED
 * value so the number and the bar can never disagree by a frame's worth of rounding.
 *
 * @param {{health:number, shield:number}} state
 */
export function vitalsBars({ health = 0, shield = 0 } = {}) {
  const hp = Math.max(0, Math.round(Number.isFinite(health) ? health : 0));
  const sh = Math.max(0, Math.round(Number.isFinite(shield) ? shield : 0));
  return {
    health: {
      id: 'health',
      value: hp,
      max: VITALS.maxHealth,
      fraction: clamp01(hp / VITALS.maxHealth),
      colors: VITAL_COLORS.health
    },
    shield: {
      id: 'shield',
      value: sh,
      max: VITALS.maxShield,
      fraction: clamp01(sh / VITALS.maxShield),
      // A depleted shield shows an empty bar, never a hidden one (§18.2): the bar is always
      // present and only its fill goes to zero.
      colors: VITAL_COLORS.shield
    }
  };
}

/**
 * §18.2, §9.4.1 — the material counts, with the selected one marked.
 *
 * `affordable` is what actually gates a placement, so the HUD marks the same condition the
 * build system checks rather than a second opinion about it.
 *
 * @param {{materials:object, selectedMaterial:string}} state
 */
export function materialRow({ materials = {}, selectedMaterial = MATERIAL_ORDER[0] } = {}) {
  return MATERIAL_ORDER.map((id) => {
    const count = Math.max(0, Math.floor(materials[id] ?? 0));
    return {
      id,
      name: MATERIALS[id].name,
      count,
      color: cssHex(MATERIALS[id].color),
      selected: id === selectedMaterial,
      affordable: count >= BUILD.cost
    };
  });
}

/**
 * §18.3 — one material-gain readout.
 *
 * Gains of the same material STACK rather than replacing one another, so a run of swings
 * reads as one growing total instead of a flicker. `now` is passed in rather than read from
 * a clock, so this is testable and the HUD keeps the only timer.
 *
 * @param {object[]} existing  current readouts, newest last
 * @param {{type:string, amount:number, now:number, life:number}} gain
 * @returns {object[]} the new readout list
 */
export function pushMaterialGain(existing, { type, amount, now = 0, life = 1.6 }) {
  if (!MATERIALS[type] || !(amount > 0)) return existing;
  const out = existing.filter((g) => g.expires > now);
  const open = out.find((g) => g.type === type);
  if (open) {
    open.amount += amount;
    open.expires = now + life;
    return out;
  }
  out.push({
    type,
    amount,
    label: MATERIALS[type].name,
    color: cssHex(MATERIALS[type].color),
    expires: now + life
  });
  return out;
}

/** Drop readouts whose time is up. */
export function expireMaterialGains(gains, now) {
  return gains.filter((g) => g.expires > now);
}
