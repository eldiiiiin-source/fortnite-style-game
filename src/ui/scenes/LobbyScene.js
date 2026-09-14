/**
 * LobbyScene.js — BATTLE_ROYALE_SPEC §15, ITEM_SHOP_SPEC §8.1.
 *
 * The real lobby: equipped character preview, display name, currency, PLAY, LOCKER,
 * ITEM SHOP, SETTINGS and the selected mode.
 *
 * PLAY calls Application.startMatch, which starts an actual match (§15 — "No fake
 * button"). Every other control routes through the scene manager.
 */
import { Scene, SceneName } from '../../app/SceneManager.js';
import { el, mount, button, formatNumber, formatTime } from '../dom.js';
import { topBar } from '../components/Shell.js';
import { CosmeticPreview, cosmeticThumbnail } from '../components/CosmeticPreview.js';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../meta/CosmeticCatalog.js';
import { RARITIES } from '../../core/Config.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class LobbyScene extends Scene {
  constructor(app, ui) {
    super(SceneName.LOBBY, app);
    this.ui = ui;
    this.root = el('div.screen');
    // The lobby's centre column is the character's stage — it earns the space (§8.1).
    this.characterPreview = new CosmeticPreview({ size: 430 });
  }

  enter() {
    this.ui.setScreen(this.root);
    this.render();
    this.characterPreview.start();
  }

  exit() {
    this.characterPreview.stop();
  }

  render() {
    const state = this.app.lobbyState();
    const go = (scene) => this.ui.navigate(scene);

    this.characterPreview.show(state.equipped.outfit);

    mount(this.root,
      topBar({
        active: SceneName.LOBBY,
        currency: state.currency,
        onNavigate: go
      }),

      el('div.screen-body.lobby-body', {}, [
        this._profilePanel(state),
        this._centre(state),
        this._loadoutPanel(state, go)
      ])
    );
  }

  /** Left: identity and lifetime record (ITEM_SHOP_SPEC §10). */
  _profilePanel(state) {
    const s = state.lifetimeStats;
    const winRate = s.matchesPlayed > 0 ? Math.round((s.wins / s.matchesPlayed) * 100) : 0;

    return el('aside.lobby-left', {}, [
      el('section.panel', {}, [
        el('div.panel-head', { text: 'Profile' }),
        el('div.panel-body', {}, [
          el('div', {
            text: state.displayName,
            style: { fontSize: '21px', fontWeight: '900', marginBottom: '4px' }
          }),
          el('div', {
            text: 'Local Profile',
            style: { fontSize: '11px', color: 'var(--text-faint)', letterSpacing: '.1em', textTransform: 'uppercase' }
          })
        ])
      ]),

      el('section.panel', {}, [
        el('div.panel-head', { text: 'Career' }),
        el('div.panel-body', {}, [
          this._stat('Matches', formatNumber(s.matchesPlayed)),
          this._stat('Wins', formatNumber(s.wins)),
          this._stat('Win Rate', `${winRate}%`),
          this._stat('Eliminations', formatNumber(s.eliminations)),
          this._stat('Top 5', formatNumber(s.topFiveFinishes)),
          this._stat('Damage', formatNumber(s.totalDamage)),
          this._stat('Time Alive', formatTime(s.totalSurvivalTime))
        ])
      ])
    ]);
  }

  _stat(label, value) {
    return el('div.stat-row', {}, [el('span', { text: label }), el('span', { text: value })]);
  }

  /** Centre: character stage and the PLAY button. */
  _centre(state) {
    return el('main.lobby-centre', {}, [
      el('div.character-stage', {}, [this.characterPreview.element]),
      el('div.mode-chip', { text: state.mode }),
      // The play button is deliberately the largest target on the screen.
      this._playButton()
    ]);
  }

  _playButton() {
    return el('button.btn.btn-primary.btn-play', {
      text: 'Play',
      on: { click: () => this._play() }
    });
  }

  /** Right: equipped loadout — clicking a slot jumps to that locker category. */
  _loadoutPanel(state, go) {
    const rows = CATEGORY_ORDER.map((category) => {
      const cosmetic = state.equipped[category];
      if (!cosmetic) return null;
      const colour = hex(RARITIES[cosmetic.rarity].color);
      const thumb = cosmeticThumbnail(cosmetic, 40);

      return el('div.slot-row', {
        style: { '--rarity': colour },
        on: { click: () => go(SceneName.LOCKER, { category }) }
      }, [
        el('div.slot-thumb', {}, [thumb]),
        el('div.slot-meta', {}, [
          el('div.slot-cat', { text: CATEGORY_LABELS[category] }),
          el('div.slot-name', { text: cosmetic.name })
        ])
      ]);
    });

    return el('aside.lobby-right', {}, [
      el('section.panel', { style: { flex: '1', display: 'flex', flexDirection: 'column' } }, [
        el('div.panel-head', { text: 'Loadout' }),
        el('div.panel-body', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, rows)
      ]),
      button('Open Locker', () => go(SceneName.LOCKER), { icon: '▦' }),
      button('Item Shop', () => go(SceneName.SHOP), { icon: '◆' })
    ]);
  }

  _play() {
    const started = this.app.startMatch();
    if (!started) this.ui.toasts.bad('Could not start a match');
  }
}
