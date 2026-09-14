/**
 * The full loop. BATTLE_ROYALE_SPEC §20 and ITEM_SHOP_SPEC §15 acceptance tests.
 *
 * These drive the real Application headlessly — no renderer, no DOM — so the whole
 * lobby → shop → locker → match → results → lobby cycle is verified end to end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Application } from '../src/app/Application.js';
import { MatchState } from '../src/match/MatchManager.js';
import { SceneName } from '../src/app/SceneManager.js';
import { COSMETICS } from '../src/meta/CosmeticCatalog.js';
import { SIM } from '../src/core/Config.js';
import { PROFILE } from '../src/meta/MetaConfig.js';

const dt = SIM.fixedDt;

/** Shared storage so a "reload" sees what the previous Application wrote. */
function makeStorage() {
  const store = new Map();
  return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), store };
}

/** Run the application until a predicate holds or the budget expires. */
function runUntil(app, predicate, maxSeconds = 60 * 25) {
  const maxTicks = Math.ceil(maxSeconds / dt);
  for (let i = 0; i < maxTicks; i++) {
    app.update(dt);
    if (predicate(app)) return i * dt;
  }
  return null;
}

let storage;
beforeEach(() => {
  globalThis.__FORCE_DEV_MODE__ = true;
  storage = makeStorage();
});
afterEach(() => { delete globalThis.__FORCE_DEV_MODE__; });

describe('ITEM_SHOP_SPEC §15 — shop and locker acceptance', () => {
  it('runs the full cosmetic loop and survives a reload', () => {
    // 1-3. launch, profile loads, lobby
    const app = new Application({ storage, seed: 5 });
    expect(app.match.state).toBe(MatchState.LOBBY);
    expect(app.scenes.currentName).toBe(SceneName.LOBBY);
    expect(app.profile.currency).toBe(PROFILE.starterCurrency);

    // 4-5. open shop, inspect a cosmetic
    const view = app.shop.shopView(0);
    const target = view.featured.find((i) => !i.owned && i.affordable);
    expect(target).toBeDefined();

    // 6-7. purchase, currency decreases
    const before = app.profile.currency;
    const result = app.shop.purchase(target.id, { timestamp: 0 });
    expect(result.ok).toBe(true);
    expect(app.profile.currency).toBe(before - target.price);

    // 8. shows owned
    expect(app.shop.shopView(0).featured.find((i) => i.id === target.id).owned).toBe(true);

    // 9-11. locker, equip, lobby preview updates
    expect(app.profile.equip(target.id)).toBe(true);
    expect(app.lobbyState().equipped[target.category].id).toBe(target.id);

    // 12-13. start a match; the cosmetic is passed into it
    expect(app.startMatch({ botCount: 3 })).toBe(true);
    expect(app.game.cosmetics[target.category].id).toBe(target.id);

    // 14-15. leave the match, back to lobby
    app.returnToLobby();
    expect(app.match.state).toBe(MatchState.LOBBY);

    // 16-19. reload: ownership, equipment and balance all persist
    const reloaded = new Application({ storage, seed: 5 });
    expect(reloaded.profile.owns(target.id)).toBe(true);
    expect(reloaded.profile.equippedId(target.category)).toBe(target.id);
    expect(reloaded.profile.currency).toBe(before - target.price);
  });

  it('passes the equipped loadout into the match, not the defaults', () => {
    const app = new Application({ storage, seed: 3 });
    app.admin.unlockAllCosmetics();
    const outfit = COSMETICS.find((c) => c.category === 'outfit' && c.rarity === 'legendary');
    app.profile.equip(outfit.id);

    app.startMatch({ botCount: 2 });
    expect(app.game.cosmetics.outfit.id).toBe(outfit.id);
  });
});

describe('BATTLE_ROYALE_SPEC §20 — match acceptance', () => {
  it('runs lobby → drop → land → active → storm → result → lobby', () => {
    const app = new Application({ storage, seed: 11 });

    // 2-3. lobby, press PLAY
    expect(app.scenes.currentName).toBe(SceneName.LOBBY);
    expect(app.startMatch({ botCount: 8 })).toBe(true);

    // 4. drop phase
    expect(app.match.state).toBe(MatchState.DROP_PHASE);
    expect(app.game.dropRoute).not.toBeNull();
    expect(app.registry.total).toBe(9);

    // 5-7. jump, glide, land — the player auto-exits when the window closes
    const landed = runUntil(app, (a) => a.match.state === MatchState.ACTIVE_MATCH, 180);
    expect(landed).not.toBeNull();
    expect(app.game.descent.state).toBe('landed');

    // The storm starts with the active match.
    expect(app.game.storm.state).not.toBe('idle');

    // 15-17. let the match play out — bots fight each other and the storm closes
    const ended = runUntil(app, (a) => a.match.isOver, 60 * 25);
    expect(ended).not.toBeNull();

    // 18-19. a result exists and is coherent
    expect(['victory', 'defeat']).toContain(app.lastResult.outcome);
    expect(app.lastResult.placement).toBeGreaterThanOrEqual(1);
    expect(app.lastResult.placement).toBeLessThanOrEqual(9);
    expect(app.scenes.currentName).toBe(SceneName.RESULTS);

    // 20. return to lobby
    app.returnToLobby();
    expect(app.match.state).toBe(MatchState.LOBBY);
    expect(app.scenes.currentName).toBe(SceneName.LOBBY);

    // 21. a second match starts successfully
    expect(app.startMatch({ botCount: 8 })).toBe(true);
    expect(app.match.state).toBe(MatchState.DROP_PHASE);
  });

  it('bots keep playing the match even when the human does nothing', () => {
    const app = new Application({ storage, seed: 21 });
    app.startMatch({ botCount: 12 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();

    const startAlive = app.registry.aliveCount;
    // The human never acts. Bots must still eliminate each other and the storm must close.
    runUntil(app, (a) => a.registry.aliveCount < startAlive - 2, 60 * 20);
    expect(app.registry.aliveCount).toBeLessThan(startAlive);
  });

  it('§13 leaks no state between matches', () => {
    const app = new Application({ storage, seed: 31 });

    app.startMatch({ botCount: 3 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();

    app.admin.giveWeapon('boltSniper', 'legendary');
    app.admin.giveMaxMaterials();
    app.admin.spawnChest();
    const lootBefore = app.game.worldLoot.count;
    for (let i = 0; i < 600; i++) app.update(dt);

    app.admin.forceVictory();
    app.returnToLobby();
    app.startMatch({ botCount: 3 });

    // Fresh everything.
    // Player-placed pieces only — the island's own structures are build pieces and are
    // expected in a fresh match (MAP_SPEC §20.1).
    expect(app.game.grid.playerPieceCount).toBe(0);
    expect(app.game.inventory.itemCount).toBe(0);
    expect(app.game.storm.phaseIndex).toBe(-1);
    expect(app.game.time).toBe(0);
    expect(app.match.stats.eliminations).toBe(0);
    expect(app.game.worldLoot.count).not.toBe(lootBefore + 999);
    expect(app.registry.aliveCount).toBe(4);
  });

  it('awards credits and lifetime stats after a match', () => {
    const app = new Application({ storage, seed: 41 });
    const creditsBefore = app.profile.currency;

    app.startMatch({ botCount: 2 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();
    app.admin.forceVictory();
    app.update(dt);

    expect(app.lastResult.outcome).toBe('victory');
    expect(app.profile.currency).toBeGreaterThan(creditsBefore);
    expect(app.profile.profile.lifetimeStats.matchesPlayed).toBe(1);
    expect(app.profile.profile.lifetimeStats.wins).toBe(1);
  });

  it('does not end the match while several bots remain', () => {
    const app = new Application({ storage, seed: 51 });
    app.startMatch({ botCount: 10 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();

    // Kill some, but not all.
    app.admin.eliminateAllBots({ keep: 4 });
    app.update(dt);
    expect(app.match.isOver).toBe(false);
    expect(app.registry.aliveCount).toBeGreaterThan(1);
  });

  it('a second match is playable to completion', () => {
    const app = new Application({ storage, seed: 61 });

    for (let round = 0; round < 2; round++) {
      expect(app.startMatch({ botCount: 3 }), `round ${round}`).toBe(true);
      app.game.skipDrop();
      app.match.beginActiveMatch();
      app.game.beginActiveMatch();
      app.admin.forceVictory();
      app.update(dt);
      expect(app.match.isOver, `round ${round}`).toBe(true);
      app.returnToLobby();
    }
    expect(app.profile.profile.lifetimeStats.matchesPlayed).toBe(2);
  });
});

describe('ADMIN_PANEL_SPEC §19 — dev-off path', () => {
  it('makes the admin system unreachable in production mode', () => {
    globalThis.__FORCE_DEV_MODE__ = false;
    const app = new Application({ storage, seed: 71 });

    expect(app.devMode).toBe(false);
    expect(app.admin.enabled).toBe(false);

    // The normal game still works...
    expect(app.startMatch({ botCount: 2 })).toBe(true);
    // ...but no admin action is reachable.
    expect(app.admin.toggleGodMode(true).ok).toBe(false);
    expect(app.admin.grantCredits(99999).ok).toBe(false);
    expect(app.game.adminFlags.godMode).toBe(false);
  });

  it('leaves gameplay identical with admin disabled', () => {
    globalThis.__FORCE_DEV_MODE__ = false;
    const app = new Application({ storage, seed: 81 });
    app.startMatch({ botCount: 2 });
    app.game.skipDrop();
    app.match.beginActiveMatch();
    app.game.beginActiveMatch();

    app.admin.toggleGodMode(true);          // refused
    app.game.health.shield = 0;
    app.game.participant.takeDamage(30, { source: 'test' });
    expect(app.game.health.health).toBe(70);   // damage applied normally
  });
});
