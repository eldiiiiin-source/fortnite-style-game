/**
 * ResultsScene.js — BATTLE_ROYALE_SPEC §11.2.
 *
 * Victory and defeat screens showing placement, eliminations, damage dealt and survival
 * time, with a return-to-lobby button.
 *
 * Original branding — deliberately not any shipped game's victory wording.
 */
import { Scene, SceneName } from '../../app/SceneManager.js';
import { el, mount, button, formatNumber, formatTime } from '../dom.js';
import { currencyPill } from '../components/Shell.js';

export class ResultsScene extends Scene {
  constructor(app, ui) {
    super(SceneName.RESULTS, app);
    this.ui = ui;
    this.root = el('div.screen');
    this.result = null;
  }

  enter(params = {}) {
    this.result = params.result ?? this.app.lastResult;
    this.ui.setScreen(this.root);
    this.render();
  }

  render() {
    const r = this.result;
    if (!r) {
      mount(this.root, el('div.results', {}, [
        el('div.result-sub', { text: 'No match result' }),
        button('Return to Lobby', () => this.app.returnToLobby(), { variant: 'primary' })
      ]));
      return;
    }

    const victory = r.outcome === 'victory';
    const accuracy = r.shotsFired > 0 ? Math.round((r.shotsHit / r.shotsFired) * 100) : 0;

    mount(this.root,
      el('header.topbar', {}, [
        el('div.brand', { html: 'CINDER <em>ISLE</em>' }),
        el('div.spacer'),
        currencyPill(this.app.profile.currency)
      ]),

      el('div.screen-body', {}, [
        el('div.results', {}, [
          el('div', {}, [
            el('div.result-sub', { text: victory ? 'Last one standing' : 'Match over' }),
            el('div', {
              class: `result-title ${victory ? 'result-victory' : 'result-defeat'}`,
              text: victory ? 'Isle Champion' : 'Eliminated'
            })
          ]),

          el('div', {
            style: { fontSize: '17px', fontWeight: '800', letterSpacing: '.1em' },
            text: `#${r.placement} of ${r.totalParticipants ?? '—'}`
          }),

          el('div.result-stats', {}, [
            this._stat(formatNumber(r.eliminations ?? 0), 'Eliminations'),
            this._stat(formatNumber(Math.round(r.damageDealt ?? 0)), 'Damage Dealt'),
            this._stat(formatTime(r.survivalTime ?? 0), 'Survived'),
            this._stat(`${accuracy}%`, 'Accuracy')
          ]),

          r.eliminatedBy != null
            ? el('div', {
                style: { fontSize: '12.5px', color: 'var(--text-dim)' },
                text: `Eliminated by ${this._killerName(r.eliminatedBy)}`
              })
            : null,

          r.creditsEarned > 0
            ? el('div.result-reward', { text: `+${formatNumber(r.creditsEarned)} Credits earned` })
            : null,

          el('div', { style: { display: 'flex', gap: '12px', marginTop: '10px' } }, [
            el('button.btn.btn-primary.btn-play', {
              text: 'Return to Lobby',
              on: { click: () => this.app.returnToLobby() }
            })
          ])
        ])
      ])
    );
  }

  _killerName(id) {
    const record = this.app.registry.get(id);
    return record?.name ?? `Player ${id}`;
  }

  _stat(value, label) {
    return el('div.result-stat.panel', {}, [
      el('b', { text: value }),
      el('span', { text: label })
    ]);
  }
}
