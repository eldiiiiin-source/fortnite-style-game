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
import { getTool } from '../../cosmetics/ToolDefinitions.js';

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

const HEAD_LABELS = Object.freeze({
  wedge: 'Wedge head', chisel: 'Chisel head', leaf: 'Leaf blade', hook: 'Hooked head',
  // `scrap` deliberately does NOT read "Welded scrap": that is Scrapjaw's theme, and the
  // trait line prints theme then head form, so the two collided. This names the form.
  split: 'Split tine', beam: 'Beam edge', scrap: 'Asymmetric cutter'
});

const HAFT_LABELS = Object.freeze({
  straight: 'Straight haft', wrapped: 'Wrapped haft', pipe: 'Pipe haft'
});

/**
 * @param {object} cosmetic a catalog item — an outfit, a harvesting tool, or anything
 *                          else, in which case this renders nothing.
 * @returns {HTMLElement|null}
 */
export function skinTraits(cosmetic) {
  if (!cosmetic) return null;
  const skin = getSkin(cosmetic.id);
  if (skin) return outfitTraits(skin);
  const tool = getTool(cosmetic.id);
  if (tool) return toolTraits(tool);
  return null;
}

/** Theme, head form, haft and details — SKIN_SPEC §11. */
function toolTraits(tool) {
  return el('div.skin-traits', {}, [
    el('div.trait-line', {}, [
      el('span.trait-key', { text: tool.theme }),
      el('span.trait-dot', { text: '·' }),
      el('span.trait-val', { text: HEAD_LABELS[tool.head] ?? tool.head })
    ]),
    el('div.trait-chips', {}, [
      el('span.trait-chip', { text: HAFT_LABELS[tool.haft] ?? tool.haft }),
      ...tool.details.map((d) => el('span.trait-chip', { text: label(d) }))
    ]),
    el('div.trait-swatches', {}, ['primary', 'secondary', 'accent', 'edge', 'detail'].map((role) =>
      el('span.trait-swatch', { title: role, style: { background: tool.palette[role] } })
    ))
  ]);
}

function outfitTraits(skin) {
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
