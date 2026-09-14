/**
 * ShopScene.js — ITEM_SHOP_SPEC §5.
 *
 * Renders the working ShopManager. Featured and daily sections, cards with name, rarity,
 * category, price, owned and equipped state, a live preview, and purchase feedback.
 *
 * Every purchase goes through ShopManager.purchase — the real path (§5.3). This scene
 * contains no purchase logic of its own, only the result handling.
 */
import { Scene, SceneName } from '../../app/SceneManager.js';
import { el, mount, button, formatNumber } from '../dom.js';
import { topBar, backFooter } from '../components/Shell.js';
import { CosmeticPreview, cosmeticThumbnail } from '../components/CosmeticPreview.js';
import { CATEGORY_LABELS } from '../../meta/CosmeticCatalog.js';
import { PurchaseResult } from '../../meta/ShopManager.js';
import { RARITIES } from '../../core/Config.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Human-readable purchase failures (§5.6). */
const FAILURE_TEXT = {
  [PurchaseResult.INSUFFICIENT_FUNDS]: 'Not enough Credits',
  [PurchaseResult.ALREADY_OWNED]: 'Already owned',
  [PurchaseResult.UNKNOWN_ITEM]: 'Item unavailable',
  [PurchaseResult.NOT_PURCHASABLE]: 'Item not purchasable',
  [PurchaseResult.NOT_IN_SHOP]: 'Not in the current rotation'
};

export class ShopScene extends Scene {
  constructor(app, ui) {
    super(SceneName.SHOP, app);
    this.ui = ui;
    this.root = el('div.screen');
    this.preview = new CosmeticPreview({ size: 250 });
    this.selected = null;
  }

  enter() {
    this.ui.setScreen(this.root);
    const view = this.app.shop.shopView();
    this.selected = view.featured[0] ?? view.daily[0] ?? null;
    this.render();
    this.preview.start();
  }

  exit() {
    this.preview.stop();
  }

  render() {
    const view = this.app.shop.shopView();
    if (this.selected) {
      // Re-read the selected item so owned/equipped state stays current after a purchase.
      const all = [...view.featured, ...view.daily];
      this.selected = all.find((i) => i.id === this.selected.id) ?? this.selected;
      this.preview.show(this.selected);
    }

    mount(this.root,
      topBar({
        active: SceneName.SHOP,
        currency: view.currency,
        onNavigate: (s) => this.ui.navigate(s)
      }),

      el('div.screen-body', {}, [
        el('div', {
          style: { flex: '1', overflowY: 'auto', padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: '26px' }
        }, [
          this._section('Featured', view.featured),
          this._section('Daily', view.daily),
          el('div', {
            text: `Rotation #${view.rotationId} · refreshes every ${this.app.shop.constructor.name ? 24 : 24} hours`,
            style: { fontSize: '11px', color: 'var(--text-faint)', letterSpacing: '.08em' }
          })
        ]),
        this._previewPanel()
      ]),

      backFooter(() => this.ui.navigate(SceneName.LOBBY))
    );
  }

  _section(title, items) {
    return el('section', {}, [
      el('h2', {
        text: title,
        style: {
          margin: '0 0 13px', fontSize: '13px', fontWeight: '900',
          letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--text-dim)'
        }
      }),
      items.length === 0
        ? el('div.empty', { text: 'Nothing here right now.' })
        : el('div.grid.grid-shop', {}, items.map((item) => this._card(item)))
    ]);
  }

  /** One shop card — §5 requires name, rarity, category, price, owned and equipped state. */
  _card(item) {
    const colour = hex(RARITIES[item.rarity].color);
    const isSelected = this.selected?.id === item.id;

    return el(`div.card${isSelected ? '.selected' : ''}`, {
      style: { '--rarity': colour, '--rarity-soft': `${colour}22` },
      on: { click: () => this._select(item) }
    }, [
      el('div.card-art', {}, [cosmeticThumbnail(item, 160)]),
      el('div.card-info', {}, [
        el('div.card-name', { text: item.name }),
        el('div.card-cat', { text: `${CATEGORY_LABELS[item.category]} · ` }, [
          el('span.rarity-label', { text: item.rarity, style: { '--rarity': colour } })
        ])
      ]),
      el('div.card-foot', {}, [
        item.owned
          ? el('span.tag.tag-owned', { text: item.equipped ? 'Equipped' : 'Owned' })
          : el('div.price', {}, [el('span.coin'), el('span', { text: formatNumber(item.price) })]),
        item.owned
          ? el('span', { text: '', style: { fontSize: '10px' } })
          : el('span', {
              text: item.affordable ? '' : 'Low funds',
              style: { fontSize: '9px', color: 'var(--bad)', fontWeight: '800' }
            })
      ])
    ]);
  }

  _select(item) {
    this.selected = item;
    this.render();
  }

  /** Right: live preview and the purchase action. */
  _previewPanel() {
    const item = this.selected;
    if (!item) {
      return el('aside.panel', { style: { width: '330px', borderRadius: '0' } }, [
        el('div.empty', { text: 'Select an item' })
      ]);
    }

    const colour = hex(RARITIES[item.rarity].color);
    const canBuy = !item.owned && item.affordable;

    let action;
    if (item.owned && item.equipped) {
      action = button('Equipped', () => {}, { disabled: true });
    } else if (item.owned) {
      action = button('Equip', () => this._equip(item), { variant: 'primary', icon: '✓' });
    } else {
      action = button(
        item.affordable ? `Purchase · ${formatNumber(item.price)}` : 'Not enough Credits',
        () => this._purchase(item),
        { variant: 'primary', disabled: !canBuy, icon: canBuy ? '◆' : '✕' }
      );
    }

    return el('aside.panel.preview', {
      style: { width: '330px', borderRadius: '0', borderTop: 'none', borderBottom: 'none' }
    }, [
      el('div.preview-stage', {}, [this.preview.element]),
      el('div.preview-meta', {}, [
        el('div.rarity-label', { text: item.rarity, style: { '--rarity': colour } }),
        el('div.preview-name', { text: item.name }),
        el('div.card-cat', { text: CATEGORY_LABELS[item.category] }),
        el('p.preview-desc', { text: item.description }),
        el('div.preview-actions', {}, [action])
      ])
    ]);
  }

  /** §5.3 — the real purchase path; this scene only reports the outcome. */
  _purchase(item) {
    const result = this.app.shop.purchase(item.id);
    if (result.ok) {
      this.ui.toasts.good(`Purchased ${item.name}`);
    } else {
      this.ui.toasts.bad(FAILURE_TEXT[result.reason] ?? 'Purchase failed');
    }
    this.render();
    this.ui.refreshChrome();
  }

  _equip(item) {
    if (this.app.profile.equip(item.id)) {
      this.ui.toasts.good(`Equipped ${item.name}`);
      this.render();
    } else {
      this.ui.toasts.bad('Could not equip');
    }
  }
}
