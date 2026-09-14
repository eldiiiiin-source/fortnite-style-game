/**
 * MapScreen.js — BATTLE_ROYALE_SPEC §16.
 *
 * The full map overlay: player marker, storm circle, next circle, POIs and map bounds.
 * Toggled with the `map` bind during a match.
 */
import { el, mount, formatTime } from '../dom.js';
import { MapView } from './MapView.js';
import { TILE } from '../../core/Config.js';

export class MapScreen {
  constructor(terrain, { worldExtent = TILE * 160 } = {}) {
    this.worldExtent = worldExtent;
    this.view = new MapView({ terrain, size: 560, worldExtent });
    this.visible = false;

    this.root = el('div', {
      style: {
        position: 'fixed', inset: '0', display: 'none', zIndex: '40',
        background: 'rgba(6,9,14,.88)', backdropFilter: 'blur(3px)',
        alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '14px',
        // The overlay lives in the HUD root, a sibling of `.ui-root`, so it inherits
        // nothing from the theme's text rule. Both are set here or the map renders
        // black-on-black.
        font: '400 14px \"Segoe UI\", system-ui, -apple-system, sans-serif',
        color: 'var(--text)'
      }
    });
    this.legend = el('div', {
      style: { display: 'flex', gap: '22px', fontSize: '11.5px', color: 'var(--text-dim)' }
    });
    this.info = el('div', {
      style: {
        fontSize: '13px', fontWeight: '800', letterSpacing: '.1em',
        textTransform: 'uppercase', color: 'var(--text)'
      }
    });
  }

  get element() {
    return this.root;
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'flex' : 'none';
    return this.visible;
  }

  hide() {
    this.visible = false;
    this.root.style.display = 'none';
  }

  _swatch(colour, label, dashed = false) {
    return el('span', { style: { display: 'flex', alignItems: 'center', gap: '7px' } }, [
      el('span', {
        style: {
          width: '15px', height: '0', borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${colour}`
        }
      }),
      el('span', { text: label })
    ]);
  }

  /** @param {object} state { player, storm, markers } */
  render(state) {
    if (!this.visible) return;

    this.view.draw({
      centre: { x: 0, z: 0 },
      span: this.worldExtent,
      yaw: state.yaw ?? 0,
      storm: state.storm,
      markers: state.markers ?? [],
      rotate: false,
      player: false
    });

    // Player marker in world space rather than pinned to the centre.
    const ctx = this.view.ctx;
    const scale = this.view.canvas.width / this.worldExtent;
    ctx.save();
    ctx.translate(this.view.canvas.width / 2, this.view.canvas.height / 2);
    this.view._drawPlayer(ctx, state.player.x * scale, state.player.z * scale, -(state.yaw ?? 0));
    ctx.restore();

    const storm = state.storm;
    this.info.textContent = storm
      ? `${storm.phaseName} · ${formatTime(storm.timer)} · ${Math.round(storm.radius)} m`
      : 'Map';

    mount(this.root,
      el('div', {
        style: { fontSize: '19px', fontWeight: '900', letterSpacing: '.2em', textTransform: 'uppercase' },
        text: 'Island Map'
      }),
      el('div.panel', { style: { padding: '10px', lineHeight: '0' } }, [this.view.element]),
      this.info,
      mount(this.legend,
        this._swatch('rgba(255,255,255,.85)', 'Safe zone'),
        this._swatch('rgba(69,200,232,.95)', 'Next zone', true),
        this._swatch('#ffd54a', 'You'),
        this._swatch('rgba(240,180,41,.9)', 'Chest')
      ),
      el('div', { style: { fontSize: '11px', color: 'var(--text-faint)' }, text: 'Press M to close' })
    );
  }
}
