/**
 * dom.js — tiny DOM helpers for the UI layer.
 *
 * Deliberately not a framework: the UI is small, and a hand-rolled helper keeps the
 * dependency list at three and makes every render path explicit.
 */

/**
 * Create an element.
 * @param {string} tag  tag name, optionally with .classes — 'div.card.large'
 * @param {object} [props]  attributes; `text`, `html`, `on` and `style` are special
 * @param {Array} [children]
 */
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    } else if (key === 'class') node.className = `${node.className} ${value}`.trim();
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Replace an element's children. */
export function mount(parent, ...children) {
  parent.replaceChildren(...children.flat().filter(Boolean));
  return parent;
}

export const clear = (node) => node.replaceChildren();

/** A labelled game-style button. */
export function button(label, onClick, { variant = 'default', disabled = false, icon = null } = {}) {
  return el(`button.btn.btn-${variant}`, {
    disabled: disabled || undefined,
    on: { click: onClick }
  }, [icon ? el('span.btn-icon', { text: icon }) : null, el('span', { text: label })]);
}

/** Format seconds as m:ss. */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Thousands separator, for currency and damage numbers. */
export const formatNumber = (n) => Math.round(n).toLocaleString('en-US');
