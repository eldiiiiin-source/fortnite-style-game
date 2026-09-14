/**
 * Shell.js — shared chrome for every menu screen: top bar, nav, currency, toasts.
 *
 * Keeps navigation and the currency readout identical across lobby, shop, locker and
 * settings, so a purchase updates the balance everywhere without each screen
 * re-implementing it.
 */
import { el, button, formatNumber } from '../dom.js';
import { SceneName } from '../../app/SceneManager.js';

/** Currency pill — ITEM_SHOP_SPEC §5. */
export function currencyPill(amount) {
  return el('div.currency', {}, [
    el('span.coin'),
    el('span', { text: formatNumber(amount) })
  ]);
}

/**
 * Top bar with brand, navigation and balance.
 * @param {object} opts
 * @param {string} opts.active   current scene name
 * @param {number} opts.currency
 * @param {(scene:string)=>void} opts.onNavigate
 */
export function topBar({ active, currency, onNavigate, extra = null }) {
  const tabs = [
    [SceneName.LOBBY, 'Lobby'],
    [SceneName.SHOP, 'Item Shop'],
    [SceneName.LOCKER, 'Locker'],
    [SceneName.SETTINGS, 'Settings']
  ];

  return el('header.topbar', {}, [
    el('div.brand', { html: 'CINDER <em>ISLE</em>' }),
    el('nav.nav', {}, tabs.map(([scene, label]) =>
      el(`button.nav-item${scene === active ? '.active' : ''}`, {
        text: label,
        on: { click: () => onNavigate(scene) }
      })
    )),
    el('div.spacer'),
    extra,
    currencyPill(currency)
  ]);
}

/** Transient feedback — purchase success/failure, equip confirmation (§5.6). */
export class Toasts {
  constructor(root) {
    this.container = el('div.toasts');
    root.appendChild(this.container);
  }

  show(message, kind = 'info', duration = 2600) {
    const node = el(`div.toast.toast-${kind}`, { text: message });
    this.container.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity .25s ease';
      setTimeout(() => node.remove(), 260);
    }, duration);
    return node;
  }

  good(message) { return this.show(message, 'good'); }
  bad(message) { return this.show(message, 'bad'); }
  clear() { this.container.replaceChildren(); }
}

/** Back-to-lobby footer button, used by shop, locker and settings. */
export function backFooter(onBack, extra = null) {
  return el('footer.screen-footer', {}, [
    button('Back to Lobby', onBack, { variant: 'ghost', icon: '‹' }),
    el('div.spacer', { style: { flex: '1' } }),
    extra
  ]);
}
