/**
 * LockerScene.js — ITEM_SHOP_SPEC §6.
 *
 * Category tabs, an owned-only grid, equipped slots, preview, and an equip action.
 *
 * Unowned cosmetics never appear here (§6), so the UI cannot even offer to equip
 * something the profile does not own — the ProfileManager guard is the second line.
 */
import { Scene, SceneName } from '../../app/SceneManager.js';
import { el, mount, button } from '../dom.js';
import { topBar, backFooter } from '../components/Shell.js';
import { CosmeticPreview, cosmeticThumbnail } from '../components/CosmeticPreview.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../meta/CosmeticCatalog.js';
import { RARITIES } from '../../core/Config.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class LockerScene extends Scene {
  constructor(app, ui) {
    super(SceneName.LOCKER, app);
    this.ui = ui;
    this.root = el('div.screen');
    this.preview = new CosmeticPreview({ size: 250 });
    this.category = CATEGORY_ORDER[0];
    this.selected = null;
  }

  enter(params = {}) {
    this.ui.setScreen(this.root);
    if (params.category && CATEGORY_ORDER.includes(params.category)) {
      this.category = params.category;
    }
    this._selectEquipped();
    this.render();
    this.preview.start();
  }

  exit() {
    this.preview.stop();
  }

  /** Default the selection to whatever is currently equipped in this category. */
  _selectEquipped() {
    const equippedId = this.app.profile.equippedId(this.category);
    const owned = this.app.profile.ownedInCategory(this.category);
    this.selected = owned.find((c) => c.id === equippedId) ?? owned[0] ?? null;
  }

  render() {
    const profile = this.app.profile;
    const owned = profile.ownedInCategory(this.category);
    if (this.selected) this.preview.show(this.selected);

    mount(this.root,
      topBar({
        active: SceneName.LOCKER,
        currency: profile.currency,
        onNavigate: (s) => this.ui.navigate(s)
      }),

      el('div.screen-body', {}, [
        el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minWidth: '0' } }, [
          this._tabs(),
          el('div', { style: { flex: '1', overflowY: 'auto', padding: '20px 24px' } }, [
            owned.length === 0
              ? el('div.empty', { text: `No ${CATEGORY_LABELS[this.category].toLowerCase()}s owned yet. Visit the Item Shop.` })
              : el('div.grid.grid-locker', {}, owned.map((c) => this._card(c, profile)))
          ])
        ]),
        this._previewPanel(profile)
      ]),

      backFooter(() => this.ui.navigate(SceneName.LOBBY))
    );
  }

  _tabs() {
    return el('div', {
      style: { display: 'flex', gap: '4px', padding: '10px 24px 0', borderBottom: '1px solid var(--line)' }
    }, CATEGORY_ORDER.map((category) =>
      el(`button.nav-item${category === this.category ? '.active' : ''}`, {
        text: CATEGORY_LABELS[category],
        on: {
          click: () => {
            this.category = category;
            this._selectEquipped();
            this.render();
          }
        }
      })
    ));
  }

  _card(cosmetic, profile) {
    const colour = hex(RARITIES[cosmetic.rarity].color);
    const equipped = profile.equippedId(cosmetic.category) === cosmetic.id;
    const selected = this.selected?.id === cosmetic.id;

    return el(`div.card${selected ? '.selected' : ''}`, {
      style: { '--rarity': colour, '--rarity-soft': `${colour}22` },
      on: { click: () => { this.selected = cosmetic; this.render(); } }
    }, [
      el('div.card-art', {}, [cosmeticThumbnail(cosmetic, 130)]),
      el('div.card-info', {}, [
        el('div.card-name', { text: cosmetic.name }),
        el('div.card-cat', {}, [
          el('span.rarity-label', { text: cosmetic.rarity, style: { '--rarity': colour } })
        ])
      ]),
      equipped
        ? el('div.card-foot', {}, [el('span.tag.tag-equipped', { text: 'Equipped' })])
        : null
    ]);
  }

  _previewPanel(profile) {
    const cosmetic = this.selected;
    if (!cosmetic) {
      return el('aside.panel', { style: { width: '330px', borderRadius: '0' } }, [
        el('div.empty', { text: 'Nothing to preview' })
      ]);
    }

    const colour = hex(RARITIES[cosmetic.rarity].color);
    const equipped = profile.equippedId(cosmetic.category) === cosmetic.id;

    return el('aside.panel.preview', {
      style: { width: '330px', borderRadius: '0', borderTop: 'none', borderBottom: 'none' }
    }, [
      el('div.preview-stage', {}, [this.preview.element]),
      el('div.preview-meta', {}, [
        el('div.rarity-label', { text: cosmetic.rarity, style: { '--rarity': colour } }),
        el('div.preview-name', { text: cosmetic.name }),
        el('div.card-cat', { text: CATEGORY_LABELS[cosmetic.category] }),
        el('p.preview-desc', { text: cosmetic.description }),
        el('div.preview-actions', {}, [
          equipped
            ? button('Equipped', () => {}, { disabled: true, icon: '✓' })
            : button('Equip', () => this._equip(cosmetic), { variant: 'primary', icon: '✓' })
        ])
      ])
    ]);
  }

  /** §6.2 — equipping persists and the lobby updates immediately. */
  _equip(cosmetic) {
    if (this.app.profile.equip(cosmetic.id)) {
      this.ui.toasts.good(`Equipped ${cosmetic.name}`);
      this.render();
    } else {
      this.ui.toasts.bad('You do not own that item');
    }
  }
}
