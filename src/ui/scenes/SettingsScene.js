/**
 * SettingsScene.js — MASTER_SPEC §19, §20.
 *
 * Drives the existing Settings system. Every control writes through Settings.set, which
 * validates and clamps, so the UI cannot push an out-of-range value into a system.
 *
 * Keybinding captures keyboard, mouse buttons AND mouse wheel (§20), and reports
 * conflicts rather than silently accepting them.
 */
import { Scene, SceneName } from '../../app/SceneManager.js';
import { el, mount, button } from '../dom.js';
import { topBar, backFooter } from '../components/Shell.js';
import { WHEEL_UP, WHEEL_DOWN } from '../../core/Input.js';

const GROUPS = [
  ['video', 'Video'],
  ['input', 'Input'],
  ['gameplay', 'Gameplay'],
  ['audio', 'Audio'],
  ['hud', 'HUD'],
  ['binds', 'Keybinds']
];

/** Human labels for the bindable actions (§4.1). */
const BIND_GROUPS = [
  ['Movement', ['moveForward', 'moveBackward', 'moveLeft', 'moveRight', 'jump', 'crouch', 'sprint']],
  ['Combat', ['fire', 'aim', 'reload', 'pickaxe', 'interact']],
  ['Weapons', ['weaponSlot1', 'weaponSlot2', 'weaponSlot3', 'weaponSlot4', 'weaponSlot5']],
  ['Building', ['wall', 'floor', 'ramp', 'cone']],
  ['Editing', ['edit', 'confirmEdit', 'resetEdit']],
  ['Interface', ['inventory', 'map', 'settings']]
];

const BIND_LABELS = {
  moveForward: 'Move Forward', moveBackward: 'Move Backward',
  moveLeft: 'Move Left', moveRight: 'Move Right',
  jump: 'Jump', crouch: 'Crouch', sprint: 'Sprint',
  fire: 'Fire', aim: 'Aim', reload: 'Reload', pickaxe: 'Pickaxe', interact: 'Interact',
  weaponSlot1: 'Slot 1', weaponSlot2: 'Slot 2', weaponSlot3: 'Slot 3',
  weaponSlot4: 'Slot 4', weaponSlot5: 'Slot 5',
  wall: 'Wall', floor: 'Floor', ramp: 'Ramp', cone: 'Cone',
  edit: 'Edit', confirmEdit: 'Confirm Edit', resetEdit: 'Reset Edit',
  inventory: 'Inventory', map: 'Map', settings: 'Settings'
};

/** Pretty-print a bind code. */
function bindLabel(code) {
  if (!code) return 'Unbound';
  if (code === WHEEL_UP) return 'Wheel Up';
  if (code === WHEEL_DOWN) return 'Wheel Down';
  if (code.startsWith('Mouse')) {
    const n = Number(code.slice(5));
    return ['Left Click', 'Middle Click', 'Right Click'][n] ?? `Mouse ${n}`;
  }
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export class SettingsScene extends Scene {
  constructor(app, ui) {
    super(SceneName.SETTINGS, app);
    this.ui = ui;
    this.root = el('div.screen');
    this.group = 'video';
    this.listeningFor = null;
    this.conflict = null;
    this._captureHandlers = null;
  }

  enter() {
    this.ui.setScreen(this.root);
    this.render();
  }

  exit() {
    this._stopCapture();
    this.app.settings.save();
  }

  render() {
    mount(this.root,
      topBar({
        active: SceneName.SETTINGS,
        currency: this.app.profile.currency,
        onNavigate: (s) => this.ui.navigate(s)
      }),
      el('div.screen-body.settings-body', {}, [
        el('nav.settings-nav', {}, GROUPS.map(([id, label]) =>
          el(`button.nav-item${id === this.group ? '.active' : ''}`, {
            text: label,
            on: { click: () => { this.group = id; this._stopCapture(); this.render(); } }
          })
        )),
        el('div.settings-panel', {}, this._panel())
      ]),
      backFooter(
        () => this.ui.navigate(SceneName.LOBBY),
        button('Reset to Defaults', () => this._resetAll(), { variant: 'ghost' })
      )
    );
  }

  _panel() {
    if (this.group === 'binds') return this._bindsPanel();
    const s = this.app.settings;

    const rows = {
      video: [
        this._select('Graphics Quality', 'video.quality', ['low', 'medium', 'high']),
        this._toggle('Shadows', 'video.shadows'),
        this._toggle('Effects', 'video.effects'),
        this._toggle('Fullscreen', 'video.fullscreen', () => this._toggleFullscreen()),
        this._slider('Field of View', 'video.fov', 60, 120, 1, (v) => `${Math.round(v)}°`),
        this._slider('Render Distance', 'video.renderDistance', 0.25, 2, 0.05, (v) => `${v.toFixed(2)}×`),
        this._slider('FPS Limit', 'video.fpsLimit', 0, 240, 10, (v) => (v === 0 ? 'Off' : String(v)))
      ],
      input: [
        this._slider('Mouse Sensitivity', 'input.mouseSensitivity', 0.05, 5, 0.05, (v) => v.toFixed(2)),
        this._slider('ADS Sensitivity', 'input.adsSensitivity', 0.05, 2, 0.05, (v) => v.toFixed(2)),
        this._slider('Scope Sensitivity', 'input.scopeSensitivity', 0.05, 2, 0.05, (v) => v.toFixed(2)),
        this._toggle('Invert Vertical Look', 'input.invertY')
      ],
      gameplay: [
        this._select('Sprint', 'gameplay.sprintMode', ['hold', 'toggle', 'auto']),
        this._toggle('Confirm Edit on Release', 'gameplay.confirmEditOnRelease',
          null, 'Release the edit button to apply the change'),
        this._toggle('Build Immediately', 'gameplay.buildImmediately',
          null, 'Selecting a piece enters build mode at once')
      ],
      audio: [
        this._slider('Master Volume', 'audio.master', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
        this._slider('Music', 'audio.music', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
        this._slider('Sound Effects', 'audio.sfx', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
        this._slider('Environment', 'audio.environment', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`)
      ],
      hud: [
        this._slider('HUD Scale', 'hud.scale', 0.6, 1.6, 0.05, (v) => `${Math.round(v * 100)}%`),
        this._toggle('Crosshair', 'hud.crosshair'),
        this._toggle('Minimap', 'hud.minimap'),
        this._toggle('Damage Numbers', 'hud.damageNumbers')
      ]
    }[this.group] ?? [];

    void s;
    return rows;
  }

  /* ── controls ──────────────────────────────────────────────────────────── */

  _row(label, control, hint = null) {
    return el('div.setting', {}, [
      el('div', {}, [
        el('div.setting-label', { text: label }),
        hint ? el('div.setting-hint', { text: hint }) : null
      ]),
      el('div.setting-control', {}, [control].flat())
    ]);
  }

  _slider(label, path, min, max, step, format) {
    const value = this.app.settings.get(path);
    const readout = el('span.setting-value', { text: format(value) });
    const input = el('input', {
      type: 'range', min, max, step, value,
      on: {
        input: (e) => {
          const v = Number(e.target.value);
          // Settings.set clamps and validates; read back so the UI shows the truth.
          this.app.settings.set(path, v);
          readout.textContent = format(this.app.settings.get(path));
          this.ui.applySettings();
        }
      }
    });
    return this._row(label, [input, readout]);
  }

  _toggle(label, path, onChange = null, hint = null) {
    const value = this.app.settings.get(path);
    const node = el(`div.toggle${value ? '.on' : ''}`, {
      on: {
        click: () => {
          const next = !this.app.settings.get(path);
          this.app.settings.set(path, next);
          node.classList.toggle('on', this.app.settings.get(path));
          this.ui.applySettings();
          onChange?.();
        }
      }
    });
    return this._row(label, node, hint);
  }

  _select(label, path, options) {
    const value = this.app.settings.get(path);
    const select = el('select', {
      on: {
        change: (e) => {
          this.app.settings.set(path, e.target.value);
          this.ui.applySettings();
        }
      }
    }, options.map((o) => el('option', {
      value: o, text: o[0].toUpperCase() + o.slice(1), selected: o === value || undefined
    })));
    return this._row(label, select);
  }

  _toggleFullscreen() {
    const on = this.app.settings.get('video.fullscreen');
    try {
      if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      else if (!on && document.exitFullscreen && document.fullscreenElement) document.exitFullscreen();
    } catch {
      // Fullscreen can be refused (permissions, iframe). The setting still records intent.
    }
  }

  /* ── keybinds — §20 ────────────────────────────────────────────────────── */

  _bindsPanel() {
    const nodes = [];
    if (this.conflict) {
      nodes.push(el('div.bind-conflict', {
        text: `"${bindLabel(this.conflict.code)}" is already used by: ${this.conflict.actions.map((a) => BIND_LABELS[a] ?? a).join(', ')}. Press again to reassign.`
      }));
    }

    for (const [title, actions] of BIND_GROUPS) {
      nodes.push(el('h3', {
        text: title,
        style: {
          margin: '22px 0 6px', fontSize: '11px', fontWeight: '900',
          letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--text-faint)'
        }
      }));
      for (const action of actions) {
        const code = this.app.settings.bindings[action];
        const listening = this.listeningFor === action;
        nodes.push(this._row(
          BIND_LABELS[action] ?? action,
          el(`button.btn.btn-sm.bind-btn${listening ? '.listening' : ''}`, {
            text: listening ? 'Press any input…' : bindLabel(code),
            on: { click: () => this._startCapture(action) }
          })
        ));
      }
    }

    nodes.push(el('div', { style: { marginTop: '22px' } }, [
      button('Reset Keybinds', () => {
        this.app.settings.resetBindings();
        this.ui.applySettings();
        this.conflict = null;
        this.render();
      }, { variant: 'ghost' })
    ]));

    return nodes;
  }

  /**
   * Capture the next input of any kind. §20 requires keyboard, mouse buttons and mouse
   * wheel all to be valid binds, so all three are listened for.
   */
  _startCapture(action) {
    this._stopCapture();
    this.listeningFor = action;
    this.conflict = null;
    this.render();

    const finish = (code) => {
      this._stopCapture();
      this._applyBind(action, code);
    };

    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { this._stopCapture(); this.render(); return; }
      finish(e.code);
    };
    const onMouse = (e) => { e.preventDefault(); finish(`Mouse${e.button}`); };
    const onWheel = (e) => { e.preventDefault(); finish(e.deltaY < 0 ? WHEEL_UP : WHEEL_DOWN); };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    this._captureHandlers = { onKey, onMouse, onWheel };
  }

  _stopCapture() {
    if (!this._captureHandlers) { this.listeningFor = null; return; }
    const { onKey, onMouse, onWheel } = this._captureHandlers;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('wheel', onWheel, { capture: true });
    this._captureHandlers = null;
    this.listeningFor = null;
  }

  /** First attempt reports a conflict; a second attempt with the same code forces it. */
  _applyBind(action, code) {
    const pending = this.conflict;
    const force = pending && pending.action === action && pending.code === code;

    const result = this.app.settings.rebind(action, code, { force });
    if (result.ok) {
      this.conflict = null;
      this.ui.applySettings();
      this.ui.toasts.good(`${BIND_LABELS[action] ?? action} bound to ${bindLabel(code)}`);
    } else {
      this.conflict = { action, code, actions: result.conflicts };
      this.ui.toasts.bad('Bind already in use');
    }
    this.render();
  }

  _resetAll() {
    this.app.settings.resetAll();
    this.app.settings.save();
    this.ui.applySettings();
    this.ui.toasts.good('Settings reset');
    this.render();
  }
}

export { bindLabel };
