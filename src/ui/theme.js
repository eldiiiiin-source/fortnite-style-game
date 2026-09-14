/**
 * theme.js — the UI design system.
 *
 * Original styling: a cool slate base with a warm gold accent, angled panel corners and
 * a soft glow on interactive states. Inspired by stylised battle royale menus in general
 * shape and hierarchy; it copies no existing game's layout, colours or iconography.
 *
 * One stylesheet for the whole UI, injected once. Rarity colours come from the gameplay
 * config so the shop, locker and HUD can never disagree about what "epic" looks like.
 */
import { RARITIES, RARITY_ORDER } from '../core/Config.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

const rarityVars = RARITY_ORDER
  .map((r) => `  --rarity-${r}: ${hex(RARITIES[r].color)};`)
  .join('\n');

export const THEME_CSS = `
:root {
${rarityVars}
  --bg-0: #0b0f16;
  --bg-1: #121924;
  --bg-2: #1a2432;
  --bg-3: #243040;
  --line: rgba(255,255,255,0.10);
  --line-strong: rgba(255,255,255,0.22);
  --text: #e8eef6;
  --text-dim: #93a2b5;
  --text-faint: #64748b;
  --accent: #f0b429;
  --accent-dim: #a87d1a;
  --good: #3ddc84;
  --bad: #ff5a5a;
  --info: #45c8e8;
  --shadow: 0 10px 40px rgba(0,0,0,.55);
  --r: 4px;
}

* { box-sizing: border-box; }

.ui-root {
  position: fixed; inset: 0; overflow: hidden;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}
.ui-root.hidden { display: none; }

/* ── screen shell ─────────────────────────────────────────────────────── */

.screen { position:absolute; inset:0; display:flex; flex-direction:column;
  background:
    radial-gradient(1200px 700px at 78% 18%, rgba(240,180,41,.10), transparent 60%),
    radial-gradient(900px 600px at 12% 82%, rgba(69,200,232,.08), transparent 60%),
    linear-gradient(160deg, var(--bg-0), var(--bg-1) 55%, var(--bg-2));
  animation: screen-in .22s ease both;
}
@keyframes screen-in { from { opacity:0; transform:translateY(8px);} to {opacity:1;transform:none;} }

.topbar { display:flex; align-items:center; gap:18px; padding:16px 26px;
  border-bottom:1px solid var(--line); background:rgba(8,12,18,.45); }
.brand { font-weight:900; font-size:19px; letter-spacing:.16em; text-transform:uppercase; }
.brand em { color:var(--accent); font-style:normal; }
.topbar .spacer { flex:1; }

.screen-body { flex:1; display:flex; min-height:0; }
.screen-footer { display:flex; gap:12px; align-items:center; padding:16px 26px;
  border-top:1px solid var(--line); background:rgba(8,12,18,.45); }

/* ── panels ───────────────────────────────────────────────────────────── */

.panel { background:linear-gradient(180deg, rgba(36,48,64,.62), rgba(18,25,36,.72));
  border:1px solid var(--line); border-radius:var(--r); box-shadow:var(--shadow); }
.panel-head { padding:13px 18px; border-bottom:1px solid var(--line);
  font-weight:800; font-size:12px; letter-spacing:.16em; text-transform:uppercase;
  color:var(--text-dim); }
.panel-body { padding:18px; }

/* ── buttons ──────────────────────────────────────────────────────────── */

.btn { position:relative; display:inline-flex; align-items:center; justify-content:center;
  gap:9px; padding:12px 22px; font-family:inherit; font-weight:800; font-size:13px;
  letter-spacing:.1em; text-transform:uppercase; color:var(--text); cursor:pointer;
  background:linear-gradient(180deg, var(--bg-3), var(--bg-2));
  border:1px solid var(--line-strong); border-radius:var(--r);
  transition: transform .09s ease, filter .12s ease, box-shadow .12s ease; }
.btn:hover:not(:disabled) { filter:brightness(1.22); transform:translateY(-1px);
  box-shadow:0 6px 18px rgba(0,0,0,.45); }
.btn:active:not(:disabled) { transform:translateY(0) scale(.985); }
.btn:disabled { opacity:.42; cursor:not-allowed; }
.btn-icon { font-size:15px; }

.btn-primary { color:#1a1204;
  background:linear-gradient(180deg, #ffd15c, var(--accent));
  border-color:#ffe08a; box-shadow:0 0 24px rgba(240,180,41,.28); }
.btn-primary:hover:not(:disabled) { box-shadow:0 0 34px rgba(240,180,41,.45); }

.btn-play { padding:20px 64px; font-size:19px; letter-spacing:.18em; }
.btn-danger { color:#fff; background:linear-gradient(180deg,#e8564f,#b62f28); border-color:#ff8b85; }
.btn-ghost { background:transparent; border-color:var(--line); color:var(--text-dim); }
.btn-ghost:hover:not(:disabled) { color:var(--text); border-color:var(--line-strong); }
.btn-sm { padding:7px 13px; font-size:11px; }

/* ── nav rail ─────────────────────────────────────────────────────────── */

.nav { display:flex; gap:8px; }
.nav-item { padding:11px 19px; font-weight:800; font-size:12px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--text-faint); cursor:pointer; background:none;
  border:none; border-bottom:2px solid transparent; font-family:inherit;
  transition:color .12s ease, border-color .12s ease; }
.nav-item:hover { color:var(--text-dim); }
.nav-item.active { color:var(--accent); border-bottom-color:var(--accent); }

/* ── currency ─────────────────────────────────────────────────────────── */

.currency { display:flex; align-items:center; gap:9px; padding:9px 15px;
  background:rgba(240,180,41,.09); border:1px solid rgba(240,180,41,.28);
  border-radius:var(--r); font-weight:900; font-size:15px; color:var(--accent); }
.currency .coin { width:16px; height:16px; border-radius:50%;
  background:radial-gradient(circle at 34% 30%, #ffe9a8, var(--accent));
  box-shadow:0 0 9px rgba(240,180,41,.55); }

/* ── cosmetic cards ───────────────────────────────────────────────────── */

.grid { display:grid; gap:13px; }
.grid-shop { grid-template-columns:repeat(auto-fill, minmax(178px, 1fr)); }
.grid-locker { grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); }

.card { position:relative; display:flex; flex-direction:column; overflow:hidden;
  cursor:pointer; background:var(--bg-2); border:1px solid var(--line);
  border-top:3px solid var(--rarity); border-radius:var(--r);
  transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
.card:hover { transform:translateY(-3px); box-shadow:0 10px 26px rgba(0,0,0,.5); }
.card.selected { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent), 0 10px 26px rgba(0,0,0,.5); }
.card-art { position:relative; aspect-ratio:1; display:grid; place-items:center;
  background:linear-gradient(160deg, var(--rarity-soft, rgba(255,255,255,.06)), transparent 70%); }
.card-art canvas { width:100%; height:100%; display:block; }
.card-info { padding:10px 11px; border-top:1px solid var(--line); }
.card-name { font-weight:800; font-size:12.5px; line-height:1.25; }
.card-cat { font-size:9.5px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--text-faint); margin-top:3px; }
.card-foot { display:flex; align-items:center; justify-content:space-between;
  padding:8px 11px; border-top:1px solid var(--line); }
.price { display:flex; align-items:center; gap:6px; font-weight:900; font-size:13px; color:var(--accent); }
.price .coin { width:11px; height:11px; border-radius:50%;
  background:radial-gradient(circle at 34% 30%, #ffe9a8, var(--accent)); }
.tag { padding:3px 8px; border-radius:2px; font-size:9px; font-weight:900;
  letter-spacing:.1em; text-transform:uppercase; }
.tag-owned { background:rgba(61,220,132,.16); color:var(--good); }
.tag-equipped { background:rgba(240,180,41,.16); color:var(--accent); }
.rarity-label { font-size:9px; font-weight:900; letter-spacing:.12em;
  text-transform:uppercase; color:var(--rarity); }

/* ── preview ──────────────────────────────────────────────────────────── */

.preview { display:flex; flex-direction:column; height:100%; }
.preview-stage { flex:1; position:relative; display:grid; place-items:center; min-height:200px;
  background:radial-gradient(600px 400px at 50% 38%, rgba(255,255,255,.055), transparent 70%); }
/* object-fit matters here: a canvas given only max-height is scaled non-uniformly,
   which squashed the character once the trait rows made the meta panel taller. */
.preview-stage canvas { max-width:100%; max-height:100%; object-fit:contain; }
.preview-meta { padding:16px 18px; border-top:1px solid var(--line); }
.preview-name { font-size:21px; font-weight:900; margin-bottom:5px; }
.preview-desc { font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-top:9px; }

/* ── skin traits — SKIN_SPEC §5, §6 ───────────────────────────────────── */
.skin-traits { margin-top:13px; padding-top:12px; border-top:1px solid var(--line); }
.trait-line { font-size:11px; font-weight:800; letter-spacing:.06em;
  text-transform:uppercase; color:var(--text-dim); display:flex; gap:7px; align-items:center; }
.trait-dot { color:var(--rarity, var(--text-faint)); }
.trait-chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:9px; }
.trait-chip { font-size:10px; font-weight:700; letter-spacing:.03em; padding:3px 7px;
  border-radius:999px; background:var(--bg-3); color:var(--text-dim);
  border:1px solid var(--line); }
.trait-swatches { display:flex; gap:5px; margin-top:11px; }
.trait-swatch { width:20px; height:20px; border-radius:3px;
  border:1px solid rgba(255,255,255,.18); box-shadow:0 1px 3px rgba(0,0,0,.45); }
.preview-actions { display:flex; gap:9px; margin-top:15px; }

/* ── lobby ────────────────────────────────────────────────────────────── */

.lobby-body { display:grid; grid-template-columns:270px 1fr 300px; gap:0; flex:1; min-height:0; }
.lobby-left, .lobby-right { padding:22px; display:flex; flex-direction:column; gap:15px;
  border-right:1px solid var(--line); overflow-y:auto; }
.lobby-right { border-right:none; border-left:1px solid var(--line); }
.lobby-centre { position:relative; display:flex; flex-direction:column;
  align-items:center; justify-content:flex-end; padding:30px; }
.character-stage { flex:1; width:100%; display:grid; place-items:center; }
.mode-chip { padding:7px 15px; margin-bottom:18px; border:1px solid var(--line-strong);
  border-radius:99px; font-size:11px; font-weight:800; letter-spacing:.14em;
  text-transform:uppercase; color:var(--text-dim); background:rgba(0,0,0,.28); }

.stat-row { display:flex; justify-content:space-between; padding:8px 0;
  border-bottom:1px solid var(--line); font-size:12.5px; }
.stat-row:last-child { border-bottom:none; }
.stat-row span:first-child { color:var(--text-dim); }
.stat-row span:last-child { font-weight:800; }

.slot-row { display:flex; align-items:center; gap:11px; padding:9px;
  background:var(--bg-2); border:1px solid var(--line); border-left:3px solid var(--rarity);
  border-radius:var(--r); cursor:pointer; transition:filter .12s ease; }
.slot-row:hover { filter:brightness(1.18); }
.slot-thumb { width:40px; height:40px; flex:none; border-radius:2px; overflow:hidden; }
.slot-meta { min-width:0; }
.slot-cat { font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--text-faint); }
.slot-name { font-size:12.5px; font-weight:800; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }

/* ── settings ─────────────────────────────────────────────────────────── */

.settings-body { display:grid; grid-template-columns:190px 1fr; flex:1; min-height:0; }
.settings-nav { display:flex; flex-direction:column; padding:16px 0;
  border-right:1px solid var(--line); }
.settings-nav .nav-item { text-align:left; border-bottom:none; border-left:2px solid transparent; }
.settings-nav .nav-item.active { border-left-color:var(--accent); background:rgba(240,180,41,.06); }
.settings-panel { padding:26px 32px; overflow-y:auto; }
.setting { display:flex; align-items:center; justify-content:space-between; gap:22px;
  padding:13px 0; border-bottom:1px solid var(--line); }
.setting-label { font-size:13.5px; font-weight:700; }
.setting-hint { font-size:11px; color:var(--text-faint); margin-top:2px; }
.setting-control { display:flex; align-items:center; gap:11px; min-width:230px;
  justify-content:flex-end; }
.setting-control input[type=range] { width:150px; accent-color:var(--accent); }
.setting-control select, .setting-control input[type=text] {
  padding:7px 11px; font-family:inherit; font-size:12.5px; color:var(--text);
  background:var(--bg-3); border:1px solid var(--line-strong); border-radius:var(--r); }
.setting-value { min-width:46px; text-align:right; font-weight:800; font-size:12.5px;
  color:var(--accent); }

.toggle { position:relative; width:46px; height:25px; border-radius:99px; cursor:pointer;
  background:var(--bg-3); border:1px solid var(--line-strong); transition:background .15s ease; }
.toggle.on { background:var(--accent-dim); border-color:var(--accent); }
.toggle::after { content:''; position:absolute; top:2px; left:2px; width:19px; height:19px;
  border-radius:50%; background:var(--text); transition:transform .15s ease; }
.toggle.on::after { transform:translateX(21px); background:#fff; }

.bind-btn { min-width:130px; font-family:ui-monospace, monospace; font-size:11.5px; }
.bind-btn.listening { border-color:var(--accent); color:var(--accent); animation:pulse 1s infinite; }
@keyframes pulse { 50% { opacity:.55; } }
.bind-conflict { margin-top:9px; padding:9px 13px; font-size:11.5px; color:var(--bad);
  background:rgba(255,90,90,.1); border:1px solid rgba(255,90,90,.3); border-radius:var(--r); }

/* ── results ──────────────────────────────────────────────────────────── */

.results { display:flex; flex-direction:column; align-items:center; justify-content:center;
  flex:1; gap:26px; text-align:center; }
.result-title { font-size:62px; font-weight:900; letter-spacing:.06em; text-transform:uppercase;
  line-height:1; animation:result-in .45s cubic-bezier(.2,.9,.25,1) both; }
.result-victory { color:var(--accent); text-shadow:0 0 46px rgba(240,180,41,.55); }
.result-defeat { color:var(--text-dim); }
.result-sub { font-size:14px; letter-spacing:.2em; text-transform:uppercase; color:var(--text-faint); }
@keyframes result-in { from { opacity:0; transform:scale(.92) translateY(14px);} to {opacity:1;transform:none;} }
.result-stats { display:grid; grid-template-columns:repeat(4, minmax(120px,1fr)); gap:13px; }
.result-stat { padding:19px 15px; text-align:center; }
.result-stat b { display:block; font-size:31px; font-weight:900; color:var(--text); }
.result-stat span { font-size:10.5px; letter-spacing:.13em; text-transform:uppercase;
  color:var(--text-faint); }
.result-reward { font-size:14px; color:var(--accent); font-weight:800; }

/* ── toast ────────────────────────────────────────────────────────────── */

.toasts { position:fixed; top:80px; left:50%; transform:translateX(-50%);
  display:flex; flex-direction:column; gap:8px; z-index:60; pointer-events:none; }
.toast { padding:11px 20px; font-size:13px; font-weight:700;
  background:rgba(12,17,25,.94); border:1px solid var(--line-strong); border-radius:var(--r);
  box-shadow:var(--shadow); animation:toast-in .2s ease both; }
.toast-good { border-color:rgba(61,220,132,.5); color:var(--good); }
.toast-bad { border-color:rgba(255,90,90,.5); color:var(--bad); }
@keyframes toast-in { from { opacity:0; transform:translateY(-10px);} to {opacity:1;transform:none;} }

/* ── empty state ──────────────────────────────────────────────────────── */

.empty { padding:44px; text-align:center; color:var(--text-faint); font-size:13px; }

/* ── dev badge ────────────────────────────────────────────────────────── */

.dev-badge { position:fixed; top:9px; left:50%; transform:translateX(-50%); z-index:70;
  padding:3px 11px; font-size:10px; font-weight:900; letter-spacing:.18em;
  background:rgba(255,90,90,.16); border:1px solid rgba(255,90,90,.45);
  border-radius:2px; color:var(--bad); pointer-events:none; }

@media (max-width: 1100px) {
  .lobby-body { grid-template-columns:1fr; grid-template-rows:auto 1fr auto; }
  .lobby-left, .lobby-right { border:none; border-bottom:1px solid var(--line); }
  .result-stats { grid-template-columns:repeat(2,1fr); }
}
`;

let injected = false;

/** Inject the stylesheet once. */
export function installTheme(doc = document) {
  if (injected) return;
  const style = doc.createElement('style');
  style.id = 'game-theme';
  style.textContent = THEME_CSS;
  doc.head.appendChild(style);
  injected = true;
}
