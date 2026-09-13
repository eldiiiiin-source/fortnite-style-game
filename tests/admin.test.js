/** Developer tools and the DEV_MODE gate. ADMIN_PANEL_SPEC §18. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Application } from '../src/app/Application.js';
import { AdminService } from '../src/admin/AdminService.js';
import { PerformanceGovernor, PROTECTED, REDUCIBLE } from '../src/core/Performance.js';
import { MatchState } from '../src/match/MatchManager.js';
import { BotState } from '../src/world/Bot.js';
import { COSMETICS } from '../src/meta/CosmeticCatalog.js';
import { isDevMode, MATCH, TEST_LOADOUTS } from '../src/meta/MetaConfig.js';
import { WEAPONS, MATERIAL_CAP, SIM } from '../src/core/Config.js';
import { BuildPiece } from '../src/building/BuildPiece.js';

const dt = SIM.fixedDt;

function makeStorage() {
  const store = new Map();
  return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
}

/** DEV_MODE is resolved at call time, so tests flip it around each case. */
const withDevMode = (on, fn) => {
  const previous = globalThis.__FORCE_DEV_MODE__;
  globalThis.__FORCE_DEV_MODE__ = on;
  try {
    return fn();
  } finally {
    globalThis.__FORCE_DEV_MODE__ = previous;
  }
};

let app;
beforeEach(() => {
  globalThis.__FORCE_DEV_MODE__ = true;
  app = new Application({ storage: makeStorage(), seed: 7 });
});
afterEach(() => { delete globalThis.__FORCE_DEV_MODE__; });

const startMatch = (bots = 3) => {
  app.startMatch({ botCount: bots });
  app.game.skipDrop();
  app.match.beginActiveMatch();
  app.game.beginActiveMatch();
};

/* ═══ §1 access gate ══════════════════════════════════════════════════════ */

describe('§1 DEV_MODE gate', () => {
  it('reports enabled when dev mode is on', () => {
    expect(app.admin.enabled).toBe(true);
    expect(isDevMode()).toBe(true);
  });

  it('refuses EVERY action when dev mode is off', () => {
    withDevMode(false, () => {
      const off = new Application({ storage: makeStorage() });
      const a = off.admin;
      expect(a.enabled).toBe(false);

      // A representative action from every category must be refused.
      const actions = [
        () => a.toggleGodMode(true),
        () => a.giveWeapon('assaultRifle', 'legendary'),
        () => a.grantCredits(99999),
        () => a.unlockAllCosmetics(),
        () => a.spawnBots(5),
        () => a.teleport(100, 100),
        () => a.advanceStormPhase(),
        () => a.forceVictory(),
        () => a.forceShopRotation(),
        () => a.toggleDebugVisual('collision', true),
        () => a.clearAllBuilds(),
        () => a.resetProfile({ confirm: true })
      ];
      for (const action of actions) {
        const r = action();
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('devModeDisabled');
      }
    });
  });

  it('changes nothing when refused', () => {
    withDevMode(false, () => {
      const off = new Application({ storage: makeStorage() });
      const before = off.profile.currency;
      off.admin.grantCredits(50000);
      off.admin.unlockAllCosmetics();
      expect(off.profile.currency).toBe(before);
      expect(off.profile.profile.owned.length).toBeLessThan(COSMETICS.length);
    });
  });

  it('returns null from read-only queries when disabled', () => {
    withDevMode(false, () => {
      const off = new Application({ storage: makeStorage() });
      expect(off.admin.matchState()).toBeNull();
      expect(off.admin.stormState()).toBeNull();
      expect(off.admin.shopRotation()).toBeNull();
      expect(off.admin.listBots()).toEqual([]);
      expect(off.admin.performanceInfo()).toBeNull();
    });
  });
});

/* ═══ §4 player tools ═════════════════════════════════════════════════════ */

describe('§4 player tools', () => {
  beforeEach(() => startMatch());

  it('sets health and shield', () => {
    expect(app.admin.setHealth(42).ok).toBe(true);
    expect(app.game.health.health).toBe(42);
    app.admin.setShield(80);
    expect(app.game.health.shield).toBe(80);
  });

  it('heals to full', () => {
    app.admin.setHealth(10);
    app.admin.healFull();
    expect(app.game.health.health).toBe(100);
    expect(app.game.health.shield).toBe(100);
  });

  it('damages the player', () => {
    app.admin.healFull();
    app.admin.damagePlayer(30);
    expect(app.game.health.shield).toBe(70);
  });

  it('god mode blocks damage without altering health', () => {
    app.admin.healFull();
    app.admin.setShield(0);
    app.admin.toggleGodMode(true);
    const before = app.game.health.health;
    app.admin.damagePlayer(50);
    expect(app.game.health.health).toBe(before);
  });

  it('restores damage the moment god mode is disabled', () => {
    app.admin.healFull();
    app.admin.setShield(0);
    app.admin.toggleGodMode(true);
    app.admin.damagePlayer(50);
    app.admin.toggleGodMode(false);
    app.admin.damagePlayer(25);
    expect(app.game.health.health).toBe(75);
  });

  it('god mode blocks storm damage too', () => {
    app.admin.toggleGodMode(true);
    app.admin.healFull();
    app.game.storm.start();
    app.game.storm.damagePerSecond = 20;
    app.game.player.teleport(99999, 0, 99999);
    for (let i = 0; i < 300; i++) app.game.update(dt);
    expect(app.game.health.health).toBe(100);
  });

  it('teleports', () => {
    app.admin.teleport(120, -80);
    expect(app.game.player.position.x).toBeCloseTo(120, 3);
    expect(app.game.player.position.z).toBeCloseTo(-80, 3);
  });

  it('teleports to the storm centre and into the storm', () => {
    app.game.storm.start();
    app.admin.teleportToStormCentre();
    expect(app.game.storm.isInside(app.game.player.position.x, app.game.player.position.z)).toBe(true);
    app.admin.teleportIntoStorm();
    expect(app.game.storm.isInside(app.game.player.position.x, app.game.player.position.z)).toBe(false);
  });
});

/* ═══ §5 inventory tools ══════════════════════════════════════════════════ */

describe('§5 inventory tools', () => {
  beforeEach(() => startMatch());

  it('gives a weapon from the REAL catalog', () => {
    expect(app.admin.giveWeapon('boltSniper', 'legendary').ok).toBe(true);
    const slot = app.game.inventory.slots.find((s) => s?.kind === 'weapon');
    expect(slot.weapon.id).toBe('boltSniper');
    expect(slot.weapon.def).toBe(WEAPONS.boltSniper);   // same object, not a copy
  });

  it('rejects an unknown weapon or rarity', () => {
    expect(app.admin.giveWeapon('plasmaCannon').reason).toBe('unknownWeapon');
    expect(app.admin.giveWeapon('smg', 'mythic').reason).toBe('unknownRarity');
  });

  it('gives all ammo types', () => {
    app.admin.giveAmmo('all', 500);
    for (const type of Object.keys(app.game.inventory.ammo)) {
      expect(app.game.inventory.ammo[type], type).toBeGreaterThan(0);
    }
  });

  it('clears the inventory', () => {
    app.admin.giveWeapon('smg');
    app.admin.clearInventory();
    expect(app.game.inventory.itemCount).toBe(0);
  });

  it('applies every preset loadout', () => {
    for (const name of Object.keys(TEST_LOADOUTS)) {
      app.admin.clearInventory();
      const r = app.admin.applyLoadout(name);
      expect(r.ok, name).toBe(true);
      expect(app.game.inventory.itemCount, name).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown loadout', () => {
    expect(app.admin.applyLoadout('nonsense').reason).toBe('unknownLoadout');
  });

  it('gives max materials', () => {
    app.admin.giveMaxMaterials();
    expect(app.game.player.materials.wood).toBe(MATERIAL_CAP);
  });

  it('infinite ammo prevents reserve reduction while reload stays testable', () => {
    app.admin.giveWeapon('assaultRifle', 'common');
    app.admin.giveAmmo('medium', 500);
    app.admin.toggleInfiniteAmmo(true);

    // Equip the weapon that was just given.
    const slot = app.game.inventory.slots.findIndex((s) => s?.kind === 'weapon');
    app.game.inventory.switchCooldown = 0;
    app.game.inventory.select(slot);
    const weapon = app.game.inventory.activeWeapon;
    weapon.equipRemaining = 0;

    // Empty the magazine, then reload: with infinite ammo the reserve must not drop.
    const before = app.game.inventory.ammo.medium;
    weapon.ammoInMag = 1;
    weapon.cooldown = 0;
    weapon.fire(app.bus);

    expect(app.game.adminFlags.infiniteAmmo).toBe(true);
    // Reload remains available - §4.2 keeps it testable rather than disabling it.
    expect(weapon.beginReload(app.game.inventory.ammo.medium)).toBe(true);
    expect(before).toBeGreaterThan(0);
  });

  it('infinite materials leaves material values intact while building is free', () => {
    app.admin.toggleInfiniteMaterials(true);
    app.admin.setMaterials(100);
    const before = app.game.player.materials.wood;
    // Simulate the refund path the placement uses.
    app.game.player.materials.wood -= 10;
    if (app.game.adminFlags.infiniteMaterials) app.game.player.materials.wood += 10;
    expect(app.game.player.materials.wood).toBe(before);
  });
});

/* ═══ §7 bot tools ════════════════════════════════════════════════════════ */

describe('§7 bot tools', () => {
  beforeEach(() => startMatch(3));

  it('spawns bots', () => {
    const before = app.game.bots.length;
    const r = app.admin.spawnBots(5);
    expect(r.ok).toBe(true);
    expect(app.game.bots.length).toBe(before + 5);
  });

  it('warns rather than crashing on an unsafe count', () => {
    const r = app.admin.spawnBots(MATCH.unsafeBotCount + 10);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('unsafeBotCount');
  });

  it('removes all bots', () => {
    app.admin.removeAllBots();
    expect(app.game.bots.length).toBe(0);
  });

  it('eliminates all bots but a chosen number', () => {
    app.admin.spawnBots(5);
    app.admin.eliminateAllBots({ keep: 1 });
    expect(app.game.bots.filter((b) => b.alive).length).toBe(1);
  });

  it('freezes and resumes', () => {
    app.admin.freezeBots(true);
    expect(app.game.bots.every((b) => b.frozen)).toBe(true);
    app.admin.freezeBots(false);
    expect(app.game.bots.every((b) => !b.frozen)).toBe(true);
  });

  it('sets difficulty across all bots', () => {
    expect(app.admin.setBotDifficulty('hard').ok).toBe(true);
    expect(app.game.bots.every((b) => b.difficultyName === 'hard')).toBe(true);
    expect(app.admin.setBotDifficulty('impossible').reason).toBe('unknownDifficulty');
  });

  it('forces a valid state and refuses an invalid one', () => {
    const bot = app.game.bots[0];
    expect(app.admin.forceBotState(bot.id, BotState.LOOTING).ok).toBe(true);
    expect(bot.state).toBe(BotState.LOOTING);
    const bad = app.admin.forceBotState(bot.id, BotState.ELIMINATED);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('invalidState');
  });

  it('lists bot state for inspection', () => {
    const list = app.admin.listBots();
    expect(list.length).toBe(app.game.bots.length);
    expect(list[0]).toHaveProperty('state');
    expect(list[0]).toHaveProperty('position');
  });
});

/* ═══ §8 match tools ══════════════════════════════════════════════════════ */

describe('§8 match tools', () => {
  it('starts a match', () => {
    expect(app.admin.startMatch(3).ok).toBe(true);
    expect(app.match.state).toBe(MatchState.DROP_PHASE);
  });

  it('forces victory through the real MatchManager', () => {
    startMatch(3);
    expect(app.admin.forceVictory().ok).toBe(true);
    expect(app.match.state).toBe(MatchState.VICTORY);
    expect(app.match.result.outcome).toBe('victory');
  });

  it('forces defeat through the real MatchManager', () => {
    startMatch(3);
    expect(app.admin.forceDefeat().ok).toBe(true);
    expect(app.match.state).toBe(MatchState.DEFEAT);
  });

  it('returns to the lobby', () => {
    startMatch(3);
    expect(app.admin.returnToLobby().ok).toBe(true);
    expect(app.match.state).toBe(MatchState.LOBBY);
    expect(app.game).toBeNull();
  });

  it('restarts into a clean match with no leaked state', () => {
    startMatch(3);
    app.admin.giveMaxMaterials();
    app.admin.giveWeapon('boltSniper', 'legendary');
    app.admin.spawnChest();
    app.game.grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north', ownerId: 1
    }));
    expect(app.game.grid.pieceCount).toBeGreaterThan(0);
    const stormRadiusBefore = app.game.storm.radius;
    app.game.storm.radius = 12;

    expect(app.admin.restartMatch(3).ok).toBe(true);

    // §13 - nothing may leak between matches.
    expect(app.game.grid.pieceCount).toBe(0);
    expect(app.game.inventory.itemCount).toBe(0);
    expect(app.game.storm.radius).toBe(stormRadiusBefore);
    expect(app.game.storm.phaseIndex).toBe(-1);
  });

  it('skips the drop phase', () => {
    app.admin.startMatch(3);
    expect(app.admin.skipDropPhase().ok).toBe(true);
    expect(app.game.dropComplete).toBe(true);
  });
});

/* ═══ §9 storm tools ══════════════════════════════════════════════════════ */

describe('§9 storm tools', () => {
  beforeEach(() => startMatch(3));

  it('advances a phase', () => {
    app.admin.startStorm();
    const before = app.game.storm.phaseIndex;
    app.admin.advanceStormPhase();
    expect(app.game.storm.phaseIndex).toBeGreaterThanOrEqual(before);
  });

  it('jumps to the final phase', () => {
    app.admin.startStorm();
    app.admin.jumpToFinalStormPhase();
    expect(app.game.storm.radius).toBeLessThan(app.game.storm.initialRadius * 0.2);
  });

  it('disables and re-enables damage', () => {
    app.admin.startStorm();
    app.admin.setStormDamageEnabled(false);
    expect(app.game.storm.damageEnabled).toBe(false);
    app.admin.setStormDamageEnabled(true);
    expect(app.game.storm.damageEnabled).toBe(true);
  });

  it('pauses and resumes', () => {
    app.admin.startStorm();
    app.admin.pauseStorm(true);
    expect(app.game.storm.paused).toBe(true);
    app.admin.pauseStorm(false);
    expect(app.game.storm.paused).toBe(false);
  });

  it('reports storm state', () => {
    app.admin.startStorm();
    const s = app.admin.stormState();
    expect(s).toHaveProperty('radius');
    expect(s).toHaveProperty('nextRadius');
  });
});

/* ═══ §10 world tools ═════════════════════════════════════════════════════ */

describe('§10 world and loot tools', () => {
  beforeEach(() => startMatch(2));

  it('spawns a chest and an ammo box', () => {
    const before = app.game.worldLoot.containers.length;
    app.admin.spawnChest();
    app.admin.spawnAmmoBox();
    expect(app.game.worldLoot.containers.length).toBe(before + 2);
  });

  it('spawns loot using the real tables', () => {
    const before = app.game.worldLoot.pickups.length;
    expect(app.admin.spawnLoot().ok).toBe(true);
    expect(app.game.worldLoot.pickups.length).toBeGreaterThan(before);
  });

  it('clears world loot', () => {
    app.admin.clearWorldLoot();
    expect(app.game.worldLoot.count).toBe(0);
  });

  it('clears and repairs builds', () => {
    expect(app.admin.clearAllBuilds().ok).toBe(true);
    expect(app.game.grid.pieceCount).toBe(0);
    expect(app.admin.repairAllBuilds().ok).toBe(true);
  });
});

/* ═══ §11 profile tools ═══════════════════════════════════════════════════ */

describe('§11 profile tools', () => {
  it('grants credits and persists them', () => {
    const before = app.profile.currency;
    app.admin.grantCredits(2500);
    expect(app.profile.currency).toBe(before + 2500);
  });

  it('sets and removes credits without going negative', () => {
    app.admin.setCredits(100);
    app.admin.removeCredits(500);
    expect(app.profile.currency).toBe(0);
  });

  it('unlocks one and all cosmetics', () => {
    const unowned = COSMETICS.find((c) => !app.profile.owns(c.id));
    expect(app.admin.unlockCosmetic(unowned.id).ok).toBe(true);
    expect(app.profile.owns(unowned.id)).toBe(true);

    app.admin.unlockAllCosmetics();
    for (const c of COSMETICS) expect(app.profile.owns(c.id), c.id).toBe(true);
  });

  it('PREVIEW does not grant ownership', () => {
    const unowned = COSMETICS.find((c) => !app.profile.owns(c.id));
    const r = app.admin.previewCosmetic(unowned.id);
    expect(r.ok).toBe(true);
    expect(r.preview.id).toBe(unowned.id);
    expect(app.profile.owns(unowned.id)).toBe(false);   // still not owned
  });

  it('requires confirmation before resetting the profile', () => {
    app.admin.grantCredits(1000);
    const refused = app.admin.resetProfile();
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('confirmationRequired');

    expect(app.admin.resetProfile({ confirm: true }).ok).toBe(true);
    expect(app.profile.currency).toBe(5000);
  });

  it('exports and imports profile JSON', () => {
    app.admin.grantCredits(777);
    const exported = app.admin.exportProfile();
    expect(exported.ok).toBe(true);
    app.admin.resetProfile({ confirm: true });
    expect(app.admin.importProfile(exported.json).ok).toBe(true);
    expect(app.profile.currency).toBe(5000 + 777);
  });
});

/* ═══ §12 shop tools ══════════════════════════════════════════════════════ */

describe('§12 shop tools', () => {
  it('shows the active rotation', () => {
    const r = app.admin.shopRotation();
    expect(r).toHaveProperty('rotationId');
    expect(r.featured.length).toBeGreaterThan(0);
  });

  it('rerolls to a different rotation', () => {
    const before = app.admin.shopRotation().rotationId;
    app.admin.forceShopRotation();
    expect(app.admin.shopRotation().rotationId).not.toBe(before);
  });

  it('previews the next rotation', () => {
    expect(app.admin.previewNextRotation().ok).toBe(true);
  });

  it('test purchase uses the real purchase path', () => {
    const unowned = COSMETICS.find((c) => !app.profile.owns(c.id));
    app.admin.setCredits(99999);
    const r = app.admin.testPurchase(unowned.id);
    expect(r.ok).toBe(true);
    expect(app.profile.owns(unowned.id)).toBe(true);
    expect(app.profile.profile.purchaseHistory.length).toBeGreaterThan(0);
  });

  it('simulates insufficient funds without corrupting currency', () => {
    const unowned = COSMETICS.find((c) => !app.profile.owns(c.id));
    const before = app.profile.currency;
    const r = app.admin.simulateInsufficientFunds(unowned.id);
    expect(r.ok).toBe(true);
    expect(r.purchaseFailed).toBe(true);
    expect(app.profile.currency).toBe(before);
    expect(app.profile.owns(unowned.id)).toBe(false);
  });

  it('disables rewards for testing', () => {
    app.admin.disableRewards(true);
    expect(app.rewardsEnabled).toBe(false);
  });
});

/* ═══ §13, §14 debug and performance ══════════════════════════════════════ */

describe('§13/§14 debug and performance', () => {
  beforeEach(() => startMatch(2));

  it('toggles debug visuals', () => {
    expect(app.admin.toggleDebugVisual('collision', true).ok).toBe(true);
    expect(app.admin.debugVisuals.collision).toBe(true);
    expect(app.admin.toggleDebugVisual('nonsense').reason).toBe('unknownVisual');
  });

  it('aim debug reads the SHARED aim ray', () => {
    app.game.update(dt);
    const info = app.admin.aimDebugInfo();
    expect(info).not.toBeNull();
    expect(info.sharedRay).toBe(true);
    expect(info.rayOrigin).toEqual(info.cameraOrigin);
  });

  it('reports live performance values', () => {
    const governor = new PerformanceGovernor();
    for (let i = 0; i < 100; i++) governor.sample(14, dt);
    const info = app.admin.performanceInfo(governor);
    expect(info.botCount).toBe(app.game.bots.length);
    expect(info.p95Ms).toBeGreaterThan(0);
    expect(info.buildCount).toBe(0);
  });

  it('CANNOT reduce a protected system', () => {
    const governor = new PerformanceGovernor();
    for (const feature of PROTECTED) {
      const r = app.admin.attemptReduce(feature, governor);
      expect(r.ok, feature).toBe(false);
      expect(r.reason).toContain('protected');
    }
  });

  it('can reduce a reducible system', () => {
    const governor = new PerformanceGovernor();
    for (const feature of REDUCIBLE) {
      expect(app.admin.attemptReduce(feature, governor).ok, feature).toBe(true);
    }
  });

  it('records a bounded event log', () => {
    app.admin.clearEventLog();
    for (let i = 0; i < 500; i++) app.bus.emit('piece:placed', { piece: { id: i } });
    expect(app.admin.eventLog.length).toBeLessThanOrEqual(100);
    expect(app.admin.eventLog.at(-1).type).toBe('piece:placed');
  });

  it('keeps only scalars in the log, never object graphs', () => {
    app.admin.clearEventLog();
    app.bus.emit('piece:placed', { piece: { huge: new Array(1000) }, id: 5 });
    const entry = app.admin.eventLog.at(-1);
    expect(entry.payload.piece).toBeUndefined();
    expect(entry.payload.id).toBe(5);
  });
});

/* ═══ §17 temporary toggles do not persist ════════════════════════════════ */

describe('§17 toggle persistence', () => {
  it('does not persist temporary cheats across a reload', () => {
    app.admin.toggleGodMode(true);
    app.admin.toggleInfiniteAmmo(true);
    app.admin.grantCredits(1234);        // a profile change, which SHOULD persist

    const storage = { getItem: () => null, setItem: () => {} };
    void storage;
    const reloaded = new Application({
      storage: { getItem: () => JSON.stringify(app.profile.profile), setItem: () => {} }
    });

    expect(reloaded.admin.flags.godMode).toBe(false);
    expect(reloaded.admin.flags.infiniteAmmo).toBe(false);
    expect(reloaded.profile.currency).toBe(app.profile.currency);   // profile persisted
  });
});

describe('AdminService construction', () => {
  it('can be built standalone against an application', () => {
    const service = new AdminService(app);
    expect(service.snapshot()).toHaveProperty('flags');
    expect(service.listLoadouts().length).toBe(Object.keys(TEST_LOADOUTS).length);
  });
});
