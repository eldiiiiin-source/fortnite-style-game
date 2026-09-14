/**
 * SkinTraits.js — SKIN_SPEC §5, §6.
 *
 * The trait row under an outfit preview: its theme, its build archetype and the silhouette
 * features it wears. This is what tells a player why two skins of the same rarity look
 * nothing alike, and it reads straight off the roster rather than being written per skin.
 *
 * Returns null for anything that is not an outfit, so callers can drop it into a preview
 * panel unconditionally.
 */
import { el } from '../dom.js';
import { getSkin } from '../../cosmetics/SkinDefinitions.js';

/** camelCase feature name -> 'Spaced Words'. */
function label(name) {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

const BUILD_LABELS = Object.freeze({
  lean: 'Lean frame',
  athletic: 'Athletic frame',
  heavy: 'Heavy frame',
  stout: 'Stout frame'
});

/**
 * @param {object} cosmetic a catalog item
 * @returns {HTMLElement|null}
 */
export function skinTraits(cosmetic) {
  const skin = cosmetic ? getSkin(cosmetic.id) : null;
  if (!skin) return null;

  return el('div.skin-traits', {}, [
    el('div.trait-line', {}, [
      el('span.trait-key', { text: skin.theme }),
      el('span.trait-dot', { text: '·' }),
      el('span.trait-val', { text: BUILD_LABELS[skin.build] ?? skin.build })
    ]),
    el('div.trait-chips', {}, skin.features.map((f) =>
      el('span.trait-chip', { text: label(f) })
    )),
    el('div.trait-swatches', {}, ['primary', 'secondary', 'accent', 'hair', 'visor'].map((role) =>
      el('span.trait-swatch', {
        title: role,
        style: { background: skin.palette[role] }
      })
    ))
  ]);
}
