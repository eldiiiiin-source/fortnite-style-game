/**
 * Browser smoke test — the end-to-end path the UI milestone requires.
 *
 * Drives the real built application in Chromium: lobby → shop → purchase → locker →
 * equip → settings → PLAY → match → results → lobby → reload persistence, then the
 * DEV_MODE on/off admin paths.
 *
 * Run with: node tests/browser/smoke.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const PORT = 5179;
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = !!condition;
  if (!ok) failures++;
  results.push(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

async function main() {
  const server = await createServer({
    server: { port: PORT, strictPort: true },
    logLevel: 'error'
  });
  await server.listen();

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    /* ── 1. load ─────────────────────────────────────────────────────── */
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game !== undefined, { timeout: 15000 });

    check('1. application boots', await page.evaluate(() => !!window.__game?.app));
    check('   boots into Application, not a sandbox Game',
      await page.evaluate(() => window.__game.app !== undefined && window.__game.game === undefined));

    /* ── 2. lobby ────────────────────────────────────────────────────── */
    await page.waitForSelector('.lobby-body', { timeout: 8000 });
    check('2. lobby renders', await page.locator('.lobby-body').isVisible());
    check('   PLAY button present', await page.locator('.btn-play').isVisible());
    check('   currency shown', (await page.locator('.currency').innerText()).includes('5,000'));
    check('   character preview drawn', await page.locator('.character-stage canvas').isVisible());
    check('   loadout slots listed', (await page.locator('.slot-row').count()) === 6);

    /* ── 3-4. shop and purchase ──────────────────────────────────────── */
    await page.locator('.nav-item', { hasText: 'Item Shop' }).click();
    await page.waitForSelector('.grid-shop', { timeout: 5000 });
    check('3. shop renders', (await page.locator('.card').count()) >= 10);
    check('   featured and daily sections', (await page.locator('.screen-body section').count()) >= 2);

    const before = await page.evaluate(() => window.__game.app.profile.currency);
    // Buy the first affordable, unowned card.
    const bought = await page.evaluate(() => {
      const app = window.__game.app;
      const view = app.shop.shopView();
      const target = [...view.featured, ...view.daily].find((i) => !i.owned && i.affordable);
      return target ? target.id : null;
    });
    if (bought) {
      await page.evaluate((id) => {
        const ui = window.__game.ui;
        const scene = ui.scenes.shop;
        scene.selected = { ...window.__game.app.shop.shopView().featured.find((i) => i.id === id) ?? {} };
        return null;
      }, bought);
      // Click through the real UI: select the card then press Purchase.
      const card = page.locator('.card').filter({ hasText: '' });
      void card;
      await page.evaluate((id) => {
        const cards = [...document.querySelectorAll('.card')];
        const app = window.__game.app;
        const view = app.shop.shopView();
        const items = [...view.featured, ...view.daily];
        const index = items.findIndex((i) => i.id === id);
        cards[index]?.click();
      }, bought);
      await page.waitForTimeout(120);
      await page.locator('.preview-actions .btn-primary').click();
      await page.waitForTimeout(200);
    }
    const after = await page.evaluate(() => window.__game.app.profile.currency);
    check('4. purchase succeeds and deducts credits', after < before, `${before} → ${after}`);
    check('   owned state shows', await page.evaluate((id) =>
      window.__game.app.profile.owns(id), bought));

    /* ── 5-6. locker and equip ───────────────────────────────────────── */
    await page.locator('.nav-item', { hasText: 'Locker' }).click();
    await page.waitForSelector('.grid-locker', { timeout: 5000 });
    check('5. locker renders owned items', (await page.locator('.card').count()) >= 1);

    await page.locator('.card').first().click();
    await page.waitForTimeout(100);
    const equipBtn = page.locator('.preview-actions .btn-primary');
    if (await equipBtn.count() > 0 && await equipBtn.isEnabled()) await equipBtn.click();
    await page.waitForTimeout(150);
    check('6. equip works', await page.evaluate(() => {
      const p = window.__game.app.profile;
      return p.equippedId('outfit') !== null;
    }));

    /* ── 7. settings ─────────────────────────────────────────────────── */
    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await page.waitForSelector('.settings-body', { timeout: 5000 });
    check('7. settings renders', await page.locator('.settings-panel').isVisible());
    check('   video group has controls', (await page.locator('.setting').count()) >= 5);

    await page.locator('.settings-nav .nav-item', { hasText: 'Keybinds' }).click();
    await page.waitForTimeout(120);
    check('   keybind list renders', (await page.locator('.bind-btn').count()) >= 20);
    // innerText reflects rendering, and the bind buttons are CSS-uppercased.
    check('   wheel-down bind shown for reset edit',
      (await page.locator('.settings-panel').innerText()).toUpperCase().includes('WHEEL DOWN'));

    /* ── 8-9. back to lobby, PLAY ────────────────────────────────────── */
    await page.locator('.nav-item', { hasText: 'Lobby' }).click();
    await page.waitForSelector('.lobby-body', { timeout: 5000 });
    check('8. returns to lobby', await page.locator('.lobby-body').isVisible());

    await page.locator('.btn-play').click();
    await page.waitForTimeout(700);
    const matchState = await page.evaluate(() => window.__game.app.match.state);
    check('9. PLAY starts a real match', ['DROP_PHASE', 'ACTIVE_MATCH'].includes(matchState), matchState);
    check('   participants registered',
      await page.evaluate(() => window.__game.app.registry.total) === 25);
    check('   3D canvas present', await page.locator('#world-layer canvas').count() > 0);
    check('   HUD renders', await page.locator('#hud-root .bars').isVisible());

    /* ── 10-11. drop and land ────────────────────────────────────────── */
    check('10. drop phase readout visible',
      (await page.locator('.dropbar').innerText()).length > 0);

    // Fast-forward the drop rather than waiting 35 real seconds.
    await page.evaluate(() => {
      const app = window.__game.app;
      app.game.skipDrop();
      app.match.beginActiveMatch();
      app.game.beginActiveMatch();
    });
    await page.waitForTimeout(400);
    check('11. reaches active match',
      await page.evaluate(() => window.__game.app.match.state) === 'ACTIVE_MATCH');
    check('   storm running',
      await page.evaluate(() => window.__game.app.game.storm.state) !== 'idle');
    check('   storm bar visible', await page.locator('.stormbar.show').count() > 0);
    check('   minimap drawn', await page.locator('.minimap canvas').count() > 0);

    /* ── full map ────────────────────────────────────────────────────── */
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(250);
    const mapOpen = await page.evaluate(() =>
      window.__game.ui.scenes.match.mapScreen.visible);
    check('   full map opens on M', mapOpen);
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(150);

    /* ── 12-13. loot and fight ───────────────────────────────────────── */
    const lootCount = await page.evaluate(() => window.__game.app.game.worldLoot.count);
    check('12. world loot exists', lootCount > 0, `${lootCount} entities`);
    check('13. bots are alive and playing',
      await page.evaluate(() => window.__game.app.game.bots.filter((b) => b.alive).length) > 0);

    /* ── 14-16. storm progress, result ───────────────────────────────── */
    await page.evaluate(() => {
      const app = window.__game.app;
      app.admin.forceVictory();
    });
    await page.waitForTimeout(500);
    check('15. match resolves', await page.evaluate(() => window.__game.app.match.isOver));
    await page.waitForSelector('.result-title', { timeout: 5000 });
    check('16. results screen appears', await page.locator('.result-title').isVisible());
    check('   shows placement and stats', (await page.locator('.result-stats').count()) > 0);

    /* ── 17. return to lobby ─────────────────────────────────────────── */
    await page.locator('.btn-play', { hasText: 'Return' }).click();
    await page.waitForSelector('.lobby-body', { timeout: 5000 });
    check('17. returns to lobby', await page.locator('.lobby-body').isVisible());
    check('   match state reset',
      await page.evaluate(() => window.__game.app.match.state) === 'LOBBY');

    /* ── 18. persistence across reload ───────────────────────────────── */
    const currencyBefore = await page.evaluate(() => window.__game.app.profile.currency);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game !== undefined, { timeout: 15000 });
    await page.waitForSelector('.lobby-body', { timeout: 8000 });
    const currencyAfter = await page.evaluate(() => window.__game.app.profile.currency);
    check('18. profile persists across reload', currencyAfter === currencyBefore,
      `${currencyBefore} → ${currencyAfter}`);
    check('   purchased cosmetic still owned',
      await page.evaluate((id) => window.__game.app.profile.owns(id), bought));

    /* ── 19-20. DEV_MODE on ──────────────────────────────────────────── */
    const devOn = await page.evaluate(() => window.__game.app.devMode);
    check('19. DEV_MODE is on in the dev server', devOn);
    if (devOn) {
      check('   DEV badge visible', await page.locator('.dev-badge').count() > 0);
      await page.keyboard.press('F8');
      await page.waitForTimeout(250);
      check('19. F8 opens the admin panel', await page.locator('#admin-panel.open').count() > 0);
      check('   all categories present', (await page.locator('#admin-panel .a-nav button').count()) === 11);

      const creditsBefore = await page.evaluate(() => window.__game.app.profile.currency);
      await page.evaluate(() => window.__game.app.admin.grantCredits(1234));
      const creditsAfter = await page.evaluate(() => window.__game.app.profile.currency);
      check('20. admin actions work', creditsAfter === creditsBefore + 1234);

      // Console uses the same AdminService.
      const consoleResult = await page.evaluate(() =>
        window.__game.ui.adminPanel.console.run('credits 4242'));
      check('   command console works', consoleResult?.ok === true);
      check('   console and GUI share one path',
        await page.evaluate(() => window.__game.app.profile.currency) === 4242);

      await page.keyboard.press('F8');
      await page.waitForTimeout(150);
      check('   F8 closes the panel', await page.locator('#admin-panel.open').count() === 0);
    }

    /* ── 21-22. DEV_MODE off ─────────────────────────────────────────── */
    const prodPage = await context.newPage();
    prodPage.on('pageerror', (e) => pageErrors.push(`prod: ${e.message}`));
    await prodPage.addInitScript(() => { window.__FORCE_DEV_MODE__ = false; });
    await prodPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await prodPage.waitForFunction(() => window.__game !== undefined, { timeout: 15000 });
    await prodPage.waitForSelector('.lobby-body', { timeout: 8000 });

    check('21. dev mode reported off', await prodPage.evaluate(() => window.__game.app.devMode) === false);
    await prodPage.keyboard.press('F8');
    await prodPage.waitForTimeout(250);
    check('21. F8 does nothing', await prodPage.locator('#admin-panel').count() === 0);
    check('22. no DEV badge', await prodPage.locator('.dev-badge').count() === 0);
    check('   admin actions refused', await prodPage.evaluate(() => {
      const r = window.__game.app.admin.grantCredits(99999);
      return r.ok === false && r.reason === 'devModeDisabled';
    }));
    check('   game still playable without admin',
      await prodPage.evaluate(() => window.__game.app.startMatch({ botCount: 4 })));

    /* ── runtime errors ──────────────────────────────────────────────── */
    const realErrors = consoleErrors.filter((e) =>
      !e.includes('WebGL') && !e.includes('SwiftShader') && !e.includes('GPU stall'));
    check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
    check('no console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

  } finally {
    await browser.close();
    await server.close();
  }

  console.log('\nBROWSER SMOKE TEST\n');
  console.log(results.join('\n'));
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} (${results.length} checks)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SMOKE TEST CRASHED:', err);
  process.exit(1);
});
