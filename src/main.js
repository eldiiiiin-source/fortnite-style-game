/**
 * main.js — browser entry point.
 *
 * Boots the real Application and SceneManager flow:
 *   LAUNCH → LOBBY → SHOP / LOCKER / SETTINGS → PLAY → MATCH → RESULTS → LOBBY
 *
 * It no longer constructs a sandbox Game. Game is created per match by Application.
 */
import { Loop } from './core/Loop.js';
import { Input } from './core/Input.js';
import { Settings } from './core/Settings.js';
import { Application } from './app/Application.js';
import { GameUI } from './ui/GameUI.js';
import { SceneName } from './app/SceneManager.js';
import { AudioSystem } from './audio/AudioSystem.js';

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');

// Settings load first: the UI, input and renderer all read from them.
const settings = new Settings();
settings.load();

const input = new Input(settings.bindings);

const app = new Application({
  settings,
  seed: seedParam !== null ? Number(seedParam) : null
});

const ui = new GameUI(app, { input });

// Audio needs a user gesture before it may start; the first click provides one.
const audio = new AudioSystem({ settings });
audio.attach(app.bus);
const startAudio = () => {
  audio.init();
  window.removeEventListener('pointerdown', startAudio);
};
window.addEventListener('pointerdown', startAudio);
settings.onChange(() => audio.applySettings());

// Enter the lobby. Application constructed its scenes already; GameUI replaced them with
// the rendering versions, so re-entering makes the real lobby render.
app.scenes.current = null;
app.scenes.goTo(SceneName.LOBBY);

const loop = new Loop(
  (dt) => app.update(dt),
  (alpha) => ui.render(alpha, loop.stats.frameMs, 1 / 60)
);
ui.loop = loop;
loop.start();

// Debug handle. No game code reads this.
window.__game = { app, ui, loop, input, settings, audio };

// Tell the boot splash the module graph is live.
window.dispatchEvent(new Event('game-ready'));
