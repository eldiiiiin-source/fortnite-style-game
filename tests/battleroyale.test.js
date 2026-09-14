/** Match state, storm, drop and bots. BATTLE_ROYALE_SPEC §19. */
import { describe, it, expect, beforeEach } from 'vitest';
import { MatchManager, MatchState } from '../src/match/MatchManager.js';
import { ParticipantRegistry, ParticipantKind } from '../src/match/ParticipantRegistry.js';
import { Storm, StormState } from '../src/match/Storm.js';
import {
  generateDropRoute, routePositionAt, Transport, Descent, DropState, chooseLandingSpot
} from '../src/match/DropSystem.js';
import { Bot, BotState, resetBotIds } from '../src/world/Bot.js';
import { WorldLoot, resetLootIds } from '../src/loot/WorldLoot.js';
import { TestEnvironment } from '../src/world/TestEnvironment.js';
import { EventBus } from '../src/core/EventBus.js';
import { RandomStream } from '../src/core/Random.js';
import { STORM_PHASES, initialSafeRadius, STORM_REFERENCE, MATCH, BOT } from '../src/meta/MetaConfig.js';
import { SIM, WORLD, TILE } from '../src/core/Config.js';

const dt = SIM.fixedDt;
beforeEach(() => { resetBotIds(); resetLootIds(); });

const makeMatch = () => {
  const bus = new EventBus();
  const registry = new ParticipantRegistry(bus);
  const match = new MatchManager({ bus, registry });
  return { bus, registry, match };
};

const fillRoster = (registry, bots = 24) => {
  registry.register({ id: 1, kind: ParticipantKind.HUMAN });
  for (let i = 0; i < bots; i++) registry.register({ id: 100 + i, kind: ParticipantKind.BOT });
};

/* ═══ §2 match state machine ══════════════════════════════════════════════ */

describe('§2 match state machine', () => {
  it('starts in the lobby', () => {
    expect(makeMatch().match.state).toBe(MatchState.LOBBY);
  });

  it('walks lobby → drop → active', () => {
    const { match } = makeMatch();
    expect(match.beginQueue()).toBe(true);
    expect(match.beginPreMatch()).toBe(true);
    expect(match.beginDrop()).toBe(true);
    expect(match.beginActiveMatch()).toBe(true);
    expect(match.state).toBe(MatchState.ACTIVE_MATCH);
  });

  it('refuses an illegal transition rather than applying it', () => {
    const { match } = makeMatch();
    expect(match.transition(MatchState.VICTORY)).toBe(false);
    expect(match.state).toBe(MatchState.LOBBY);
  });

  it('emits a state-changed event on every transition', () => {
    const { bus, match } = makeMatch();
    const seen = [];
    bus.on('match:stateChanged', (e) => seen.push(e.to));
    match.beginQueue();
    match.beginPreMatch();
    expect(seen).toEqual([MatchState.QUEUEING, MatchState.PRE_MATCH]);
  });

  it('returns to the lobby', () => {
    const { match } = makeMatch();
    match.beginQueue(); match.beginPreMatch(); match.beginDrop(); match.beginActiveMatch();
    expect(match.returnToLobby()).toBe(true);
    expect(match.state).toBe(MatchState.LOBBY);
  });

  it('allows a debug force only through the explicit override', () => {
    const { match } = makeMatch();
    expect(match.transition(MatchState.ENDGAME)).toBe(false);
    expect(match.debugForceState(MatchState.ENDGAME)).toBe(true);
    expect(match.state).toBe(MatchState.ENDGAME);
  });
});

/* ═══ §10, §11 registry and win condition ═════════════════════════════════ */

describe('§10 participant registry', () => {
  it('holds human and bots in one registry', () => {
    const { registry } = makeMatch();
    fillRoster(registry);
    expect(registry.total).toBe(MATCH.botCount + 1);
    expect(registry.aliveCount).toBe(25);
    expect(registry.human.kind).toBe(ParticipantKind.HUMAN);
  });

  it('decreases the alive count on elimination', () => {
    const { registry } = makeMatch();
    fillRoster(registry);
    registry.eliminate(100, { by: 1 });
    expect(registry.aliveCount).toBe(24);
  });

  it('assigns placement from the back', () => {
    const { registry } = makeMatch();
    fillRoster(registry, 4);           // 5 participants
    const first = registry.eliminate(100, { by: 1 });
    expect(first.placement).toBe(5);
    const second = registry.eliminate(101, { by: 1 });
    expect(second.placement).toBe(4);
  });

  it('credits the killer', () => {
    const { registry } = makeMatch();
    fillRoster(registry, 3);
    registry.eliminate(100, { by: 1 });
    registry.eliminate(101, { by: 1 });
    expect(registry.get(1).stats.eliminations).toBe(2);
  });

  it('retains eliminated participants for post-match stats', () => {
    const { registry } = makeMatch();
    fillRoster(registry, 2);
    registry.eliminate(100, { by: 1 });
    expect(registry.get(100)).not.toBeNull();
    expect(registry.get(100).alive).toBe(false);
  });

  it('reports match over only at one survivor', () => {
    const { registry } = makeMatch();
    fillRoster(registry, 2);           // 3 participants
    registry.eliminate(100, { by: 1 });
    expect(registry.isMatchOver).toBe(false);
    registry.eliminate(101, { by: 1 });
    expect(registry.isMatchOver).toBe(true);
    expect(registry.winner.id).toBe(1);
  });
});

describe('§11 win condition', () => {
  const activeMatch = (bots = 24) => {
    const ctx = makeMatch();
    fillRoster(ctx.registry, bots);
    ctx.match.beginQueue(); ctx.match.beginPreMatch();
    ctx.match.beginDrop(); ctx.match.beginActiveMatch();
    return ctx;
  };

  it('does NOT end while multiple bots remain', () => {
    const { match, registry } = activeMatch(24);
    for (let i = 0; i < 20; i++) registry.eliminate(100 + i, { by: 1 });
    expect(match.evaluateWinCondition()).toBeNull();
    expect(match.isOver).toBe(false);
    expect(registry.aliveCount).toBe(5);
  });

  it('gives VICTORY to the last human standing', () => {
    const { match, registry } = activeMatch(24);
    for (let i = 0; i < 24; i++) registry.eliminate(100 + i, { by: 1 });
    expect(match.evaluateWinCondition()).toBe(MatchState.VICTORY);
    expect(match.result.outcome).toBe('victory');
    expect(match.result.placement).toBe(1);
  });

  it('gives DEFEAT when the human dies while bots remain', () => {
    const { match, registry } = activeMatch(24);
    registry.eliminate(1, { by: 100 });
    expect(match.evaluateWinCondition()).toBe(MatchState.DEFEAT);
    expect(match.result.outcome).toBe('defeat');
    expect(match.result.placement).toBe(25);
  });

  it('records eliminations and damage in the result', () => {
    const { match, registry } = activeMatch(3);
    registry.addStat(1, 'damageDealt', 250);
    for (let i = 0; i < 3; i++) registry.eliminate(100 + i, { by: 1 });
    match.evaluateWinCondition();
    expect(match.result.eliminations).toBe(3);
    expect(match.result.damageDealt).toBe(250);
  });

  it('enters ENDGAME below the threshold without ending', () => {
    const { match, registry } = activeMatch(24);
    for (let i = 0; i < 21; i++) registry.eliminate(100 + i, { by: 1 });
    match.evaluateWinCondition();
    expect(match.state).toBe(MatchState.ENDGAME);
    expect(match.isOver).toBe(false);
  });

  it('forces victory through the real manager', () => {
    const { match } = activeMatch(5);
    expect(match.forceVictory()).toBe(true);
    expect(match.state).toBe(MatchState.VICTORY);
  });

  it('forces defeat through the real manager', () => {
    const { match } = activeMatch(5);
    expect(match.forceDefeat()).toBe(true);
    expect(match.state).toBe(MatchState.DEFEAT);
  });
});

/* ═══ §8 storm ════════════════════════════════════════════════════════════ */

describe('§8 storm', () => {
  const makeStorm = (seed = 5, regionExtent = WORLD.regionExtent) =>
    new Storm({ rng: new RandomStream(seed), bus: new EventBus(), regionExtent });

  it('uses the spec phase table', () => {
    expect(STORM_PHASES).toHaveLength(9);
    expect(STORM_PHASES[0].wait).toBe(90);
    expect(STORM_PHASES[0].damage).toBe(0);
    expect(STORM_PHASES[8].damage).toBe(15);
  });

  it('starts at 460 m for the reference 1024 m region', () => {
    expect(initialSafeRadius(STORM_REFERENCE.regionExtent)).toBe(460);
  });

  it('scales the radius from map size', () => {
    expect(initialSafeRadius(512)).toBe(230);
    expect(initialSafeRadius(2048)).toBe(920);
  });

  it('reproduces every spec radius at the reference region', () => {
    const storm = makeStorm(1, 1024);
    const expected = [460, 330, 230, 150, 95, 55, 30, 12, 0];
    for (let i = 0; i < expected.length; i++) {
      expect(storm.radiusForPhase(i)).toBeCloseTo(expected[i], 6);
    }
  });

  it('begins in the grace period with zero damage', () => {
    const storm = makeStorm();
    storm.start();
    expect(storm.state).toBe(StormState.WAITING);
    expect(storm.currentPhase.phase).toBe(0);
    expect(storm.damagePerSecond).toBe(0);
  });

  it('keeps every next zone inside the current one', () => {
    const storm = makeStorm(11);
    storm.start();
    for (let i = 0; i < 60 * 60 * 25 && !storm.isFinished; i++) {
      const offset = Math.hypot(
        storm.nextCentre.x - storm.centre.x, storm.nextCentre.z - storm.centre.z
      );
      // The next circle must fit entirely within the current one.
      expect(offset + storm.nextRadius).toBeLessThanOrEqual(storm.radius + 1e-6);
      storm.update(dt);
    }
  });

  it('never grows the radius', () => {
    const storm = makeStorm(3);
    storm.start();
    let last = storm.radius;
    for (let i = 0; i < 60 * 60 * 25 && !storm.isFinished; i++) {
      storm.update(dt);
      expect(storm.radius).toBeLessThanOrEqual(last + 1e-6);
      last = storm.radius;
    }
  });

  it('closes to exactly zero', () => {
    const storm = makeStorm(7);
    storm.start();
    let guard = 0;
    while (!storm.isFinished && guard < 60 * 60 * 30) { storm.update(dt); guard++; }
    expect(storm.isFinished).toBe(true);
    expect(storm.radius).toBeCloseTo(0, 6);
  });

  it('damages on a one-second cadence, not per frame', () => {
    const storm = makeStorm();
    storm.start();
    storm.damagePerSecond = 5;
    const far = 10000;
    let ticks = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const d = storm.damageFor(1, far, far, dt);
      if (d > 0) { ticks++; total += d; }
    }
    expect(ticks).toBe(1);
    expect(total).toBe(5);
  });

  it('does no damage inside the circle', () => {
    const storm = makeStorm();
    storm.start();
    storm.damagePerSecond = 10;
    for (let i = 0; i < 120; i++) {
      expect(storm.damageFor(1, 0, 0, dt)).toBe(0);
    }
  });

  it('tracks the cadence per participant', () => {
    const storm = makeStorm();
    storm.start();
    storm.damagePerSecond = 3;
    for (let i = 0; i < 59; i++) storm.damageFor(1, 9999, 9999, dt);
    expect(storm.damageFor(2, 9999, 9999, dt)).toBe(0);
  });

  it('fires phase and shrink events', () => {
    const bus = new EventBus();
    const storm = new Storm({ rng: new RandomStream(4), bus });
    const seen = [];
    bus.on('storm:started', () => seen.push('started'));
    bus.on('storm:phaseChanged', () => seen.push('phase'));
    bus.on('storm:shrinkStarted', () => seen.push('shrinkStart'));
    bus.on('storm:shrinkEnded', () => seen.push('shrinkEnd'));

    storm.start();
    for (let i = 0; i < 60 * 400; i++) storm.update(dt);
    expect(seen[0]).toBe('started');
    expect(seen).toContain('shrinkStart');
    expect(seen).toContain('shrinkEnd');
  });

  it('reports enter and leave storm', () => {
    const bus = new EventBus();
    const storm = new Storm({ rng: new RandomStream(2), bus });
    storm.start();
    const seen = [];
    bus.on('storm:playerEntered', () => seen.push('in'));
    bus.on('storm:playerLeft', () => seen.push('out'));
    storm.damageFor(1, 99999, 99999, dt);
    storm.damageFor(1, 0, 0, dt);
    expect(seen).toEqual(['in', 'out']);
  });

  it('can be paused, resumed and advanced by admin', () => {
    const storm = makeStorm();
    storm.start();
    storm.pause();
    const r = storm.radius;
    for (let i = 0; i < 600; i++) storm.update(dt);
    expect(storm.radius).toBe(r);
    storm.resume();
    expect(storm.advancePhase()).toBe(true);
  });

  it('honours a damage multiplier and the disable toggle', () => {
    const storm = makeStorm();
    storm.start();
    storm.damagePerSecond = 4;
    storm.setDamageMultiplier(3);
    for (let i = 0; i < 59; i++) storm.damageFor(1, 9999, 9999, dt);
    expect(storm.damageFor(1, 9999, 9999, dt)).toBe(12);

    storm.setDamageEnabled(false);
    for (let i = 0; i < 120; i++) {
      expect(storm.damageFor(1, 9999, 9999, dt)).toBe(0);
    }
  });

  it('resets completely', () => {
    const storm = makeStorm();
    storm.start();
    for (let i = 0; i < 6000; i++) storm.update(dt);
    storm.reset();
    expect(storm.state).toBe(StormState.IDLE);
    expect(storm.radius).toBe(storm.initialRadius);
    expect(storm.phaseIndex).toBe(-1);
  });
});

/* ═══ §5 drop ═════════════════════════════════════════════════════════════ */

describe('§5 drop', () => {
  it('generates a route that genuinely crosses the region', () => {
    const rng = new RandomStream(21);
    for (let i = 0; i < 50; i++) {
      const route = generateDropRoute(rng, 1024);
      // §5.1 — must not barely touch the map.
      expect(route.offsetFromCentre).toBeLessThan(1024 / 2 * 0.56);
      expect(route.length).toBeGreaterThan(1024);
    }
  });

  it('starts and ends outside the region', () => {
    const route = generateDropRoute(new RandomStream(3), 1024);
    const half = 512;
    expect(Math.hypot(route.start.x, route.start.z)).toBeGreaterThan(half);
    expect(Math.hypot(route.end.x, route.end.z)).toBeGreaterThan(half);
  });

  it('randomises direction between matches', () => {
    const rng = new RandomStream(99);
    const a = generateDropRoute(rng, 1024);
    const b = generateDropRoute(rng, 1024);
    expect(a.direction).not.toEqual(b.direction);
  });

  it('is deterministic for a seed', () => {
    const a = generateDropRoute(new RandomStream(5), 1024);
    const b = generateDropRoute(new RandomStream(5), 1024);
    expect(a).toEqual(b);
  });

  it('moves the transport along the route and closes the window', () => {
    const route = generateDropRoute(new RandomStream(1), 1024);
    const transport = new Transport(route, { duration: 10 });
    expect(transport.windowOpen).toBe(true);
    const start = transport.position;
    for (let i = 0; i < 60 * 5; i++) transport.update(dt);
    expect(transport.position.x).not.toBeCloseTo(start.x, 3);
    for (let i = 0; i < 60 * 6; i++) transport.update(dt);
    expect(transport.windowOpen).toBe(false);
  });

  it('positions along the route by progress', () => {
    const route = generateDropRoute(new RandomStream(1), 1024);
    expect(routePositionAt(route, 0)).toEqual({ x: route.start.x, y: route.altitude, z: route.start.z });
    expect(routePositionAt(route, 1).x).toBeCloseTo(route.end.x, 6);
  });

  it('lets the player jump only while the window is open', () => {
    const d = new Descent({ terrainHeightAt: () => 0 });
    d.board({ x: 0, y: 200, z: 0 });
    expect(d.jump({ x: 0, y: 200, z: 0 }, false)).toBe(false);
    expect(d.jump({ x: 0, y: 200, z: 0 }, true)).toBe(true);
    expect(d.state).toBe(DropState.FREEFALL);
  });

  it('refuses a manual glider deploy below the minimum altitude', () => {
    const d = new Descent({ terrainHeightAt: () => 0 });
    d.board({ x: 0, y: 200, z: 0 });
    d.jump({ x: 0, y: 5, z: 0 }, true);
    expect(d.deployGlider()).toBe(false);
  });

  it('auto-deploys the glider below the safe altitude', () => {
    const d = new Descent({ terrainHeightAt: () => 0 });
    d.board({ x: 0, y: 200, z: 0 });
    d.jump({ x: 0, y: 200, z: 0 }, true);
    let ticks = 0;
    while (d.state === DropState.FREEFALL && ticks < 60 * 60) { d.update(dt); ticks++; }
    expect(d.state).toBe(DropState.GLIDING);
    expect(d.gliderDeployed).toBe(true);
  });

  it('lands and closes the glider automatically', () => {
    const d = new Descent({ terrainHeightAt: () => 0 });
    d.board({ x: 0, y: 200, z: 0 });
    d.jump({ x: 0, y: 200, z: 0 }, true);
    let ticks = 0;
    while (d.isDescending && ticks < 60 * 120) { d.update(dt, { x: 0, z: 1 }, 0); ticks++; }
    expect(d.state).toBe(DropState.LANDED);
    expect(d.gliderDeployed).toBe(false);
    expect(d.position.y).toBeCloseTo(0, 6);
  });

  it('descends more slowly under the glider', () => {
    const free = new Descent({ terrainHeightAt: () => 0 });
    free.board({ x: 0, y: 500, z: 0 });
    free.jump({ x: 0, y: 500, z: 0 }, true);
    free.update(dt);
    const freeRate = Math.abs(free.velocity.y);

    const glide = new Descent({ terrainHeightAt: () => 0 });
    glide.board({ x: 0, y: 500, z: 0 });
    glide.jump({ x: 0, y: 500, z: 0 }, true);
    glide.deployGlider();
    glide.update(dt);
    expect(Math.abs(glide.velocity.y)).toBeLessThan(freeRate);
  });

  it('spreads bot landing spots rather than stacking them', () => {
    const rng = new RandomStream(8);
    const route = generateDropRoute(rng, 1024);
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      x: -400 + i * 70, z: (i % 3) * 120 - 120, lootWeight: 1 + (i % 4)
    }));
    const taken = [];
    for (let i = 0; i < 24; i++) {
      const spot = chooseLandingSpot(rng, candidates, route, taken);
      taken.push(spot);
    }
    const distinct = new Set(taken.map((s) => `${s.x},${s.z}`));
    expect(distinct.size).toBeGreaterThan(4);
  });
});

/* ═══ §9 bots ═════════════════════════════════════════════════════════════ */

describe('§9 bots', () => {
  const makeBot = (opts = {}) => new Bot({
    terrain: new TestEnvironment(),
    bus: new EventBus(),
    spawn: { x: 0, z: 0 },
    rng: new RandomStream(3),
    ...opts
  });

  it('exposes the spec state list', () => {
    for (const s of ['DROPPING', 'LANDING', 'LOOTING', 'ROTATING', 'PATROLLING',
      'COMBAT', 'HEALING', 'FLEEING_STORM', 'SEARCHING', 'ELIMINATED']) {
      expect(BotState[s], s).toBeDefined();
    }
  });

  it('uses the real player controller', () => {
    const bot = makeBot();
    expect(bot.controller.radius).toBeGreaterThan(0);
    expect(bot.controller.constructor.name).toBe('PlayerController');
  });

  it('uses the real inventory and weapons', () => {
    const bot = makeBot();
    expect(bot.giveWeapon('assaultRifle', 'rare')).toBe(true);
    expect(bot.activeWeapon.constructor.name).toBe('Weapon');
    expect(bot.activeWeapon.id).toBe('assaultRifle');
  });

  it('patrols when nothing is in sight', () => {
    const bot = makeBot();
    for (let i = 0; i < 120; i++) bot.update(dt, { enemies: [] });
    expect(bot.state).toBe(BotState.PATROLLING);
  });

  it('enters combat when it can see an enemy', () => {
    const bot = makeBot();
    bot.giveWeapon('assaultRifle');
    const enemy = { id: 2, position: { x: TILE * 5, y: 0, z: 0 }, alive: true, takeDamage: () => ({}) };
    bot.update(dt, { enemies: [enemy] });
    expect(bot.state).toBe(BotState.COMBAT);
  });

  it('fights other bots, not only the player', () => {
    const a = makeBot();
    const b = makeBot({ spawn: { x: TILE * 4, z: 0 } });
    a.giveWeapon('assaultRifle', 'legendary');
    a.setDifficulty('debugPerfect');
    const before = b.health.health;
    for (let i = 0; i < 240; i++) a.update(dt, { enemies: [b] });
    expect(b.health.health).toBeLessThan(before);
  });

  it('does not have perfect aim on normal difficulty', () => {
    const bot = makeBot();
    bot.giveWeapon('assaultRifle');
    bot.setDifficulty('normal');
    const target = {
      id: 2, position: { x: TILE * 12, y: 0, z: 0 }, alive: true,
      hits: 0, takeDamage() { this.hits++; return {}; }
    };
    for (let i = 0; i < 600; i++) bot.update(dt, { enemies: [target] });
    expect(bot.stats.shotsFired).toBeGreaterThan(0);
    expect(target.hits).toBeLessThan(bot.stats.shotsFired);
  });

  it('picks up loot', () => {
    const bus = new EventBus();
    const loot = new WorldLoot(bus, new RandomStream(1));
    const bot = makeBot({ bus });
    loot.spawnFloorLoot({ x: TILE * 0.5, y: 0, z: 0 }, { tier: 'poi' });
    const before = loot.pickups.length;
    for (let i = 0; i < 60 * 30; i++) bot.update(dt, { enemies: [], worldLoot: loot });
    expect(loot.pickups.length).toBeLessThan(before);
  });

  it('equips a weapon once it has one', () => {
    const bot = makeBot();
    bot.giveWeapon('smg');
    expect(bot.inventory.pickaxeEquipped).toBe(false);
    expect(bot.activeWeapon).not.toBeNull();
  });

  it('selects a weapon by range band', () => {
    const bot = makeBot();
    bot.giveWeapon('boltSniper');
    bot.giveWeapon('pumpShotgun');
    bot.weaponSwitchTimer = 0;
    bot._selectWeapon(TILE * 2);          // close
    expect(bot.activeWeapon.def.category).toBe('shotgun');
    bot.weaponSwitchTimer = 0;
    bot._selectWeapon(TILE * 40);         // long
    expect(bot.activeWeapon.def.category).toBe('sniper');
  });

  it('does not switch weapons every tick', () => {
    const bot = makeBot();
    bot.giveWeapon('boltSniper');         // slot 0
    bot.giveWeapon('pumpShotgun');        // slot 1, now selected
    // Start holding the sniper so the close-range call is a REAL switch that arms the
    // cooldown — a no-op selection correctly arms nothing.
    bot.inventory.switchCooldown = 0;
    bot.inventory.select(0);
    bot.weaponSwitchTimer = 0;

    bot._selectWeapon(TILE * 2);          // close: switches to the shotgun
    const afterSwitch = bot.inventory.selected;
    expect(bot.weaponSwitchTimer).toBeGreaterThan(0);

    bot._selectWeapon(TILE * 40);         // immediately after: refused by the cooldown
    expect(bot.inventory.selected).toBe(afterSwitch);
  });

  it('heals when hurt and not under attack', () => {
    const bot = makeBot();
    bot.giveConsumable('medkit');
    bot.health.health = 30;
    bot.lastDamagedAt = 99;
    for (let i = 0; i < 10; i++) bot.update(dt, { enemies: [] });
    expect(bot.state).toBe(BotState.HEALING);
  });

  it('cancels healing when threatened', () => {
    const bot = makeBot();
    bot.giveConsumable('medkit');
    bot.health.health = 30;
    bot.lastDamagedAt = 99;
    bot.update(dt, { enemies: [] });
    expect(bot.state).toBe(BotState.HEALING);

    bot.lastDamagedAt = 0;              // just took a hit
    bot.update(dt, { enemies: [] });
    expect(bot.health.consuming).toBeNull();
  });

  it('rotates toward the next safe zone when the storm closes in', () => {
    const bot = makeBot();
    const storm = new Storm({ rng: new RandomStream(1) });
    storm.start();
    storm.timer = 1;                     // shrink is imminent
    bot.controller.teleport(300, 0, 300);
    bot.update(dt, { enemies: [], storm });
    expect([BotState.ROTATING, BotState.FLEEING_STORM]).toContain(bot.state);
  });

  it('flees when caught outside the circle', () => {
    const bot = makeBot();
    const storm = new Storm({ rng: new RandomStream(1) });
    storm.start();
    bot.controller.teleport(5000, 0, 5000);
    bot.update(dt, { enemies: [], storm });
    expect(bot.state).toBe(BotState.FLEEING_STORM);
  });

  it('actually moves toward safety when fleeing', () => {
    const terrain = new TestEnvironment();
    const bot = makeBot({ terrain });
    const storm = new Storm({ rng: new RandomStream(1) });
    storm.start();
    bot.controller.teleport(600, terrain.heightAt(600, 0), 0);
    const before = Math.hypot(bot.position.x - storm.centre.x, bot.position.z - storm.centre.z);
    for (let i = 0; i < 60 * 20; i++) bot.update(dt, { enemies: [], storm });
    const after = Math.hypot(bot.position.x - storm.centre.x, bot.position.z - storm.centre.z);
    expect(after).toBeLessThan(before);
  });

  it('takes storm damage through the same path as the player', () => {
    const bot = makeBot();
    const storm = new Storm({ rng: new RandomStream(1) });
    storm.start();
    storm.damagePerSecond = 10;
    bot.controller.teleport(99999, 0, 99999);
    const before = bot.health.health;
    for (let i = 0; i < 120; i++) bot.update(dt, { enemies: [], storm });
    expect(bot.health.health).toBeLessThan(before);
  });

  it('dies and drops loot exactly once', () => {
    const bus = new EventBus();
    const loot = new WorldLoot(bus, new RandomStream(1));
    const bot = makeBot({ bus });
    bot.giveWeapon('smg');
    bot.takeDamage(999);
    expect(bot.alive).toBe(false);
    expect(bot.state).toBe(BotState.ELIMINATED);
    expect(bot.dropLoot(loot).length).toBeGreaterThan(0);
    expect(bot.dropLoot(loot)).toEqual([]);
  });

  it('can be frozen and resumed', () => {
    const bot = makeBot();
    bot.freeze();
    const at = { ...bot.position };
    for (let i = 0; i < 120; i++) bot.update(dt, { enemies: [] });
    expect(bot.position).toEqual(at);
    bot.resume();
    for (let i = 0; i < 120; i++) bot.update(dt, { enemies: [] });
    expect(bot.position).not.toEqual(at);
  });

  it('refuses an invalid forced state', () => {
    const bot = makeBot();
    expect(bot.forceState(BotState.LOOTING)).toBe(true);
    expect(bot.forceState(BotState.ELIMINATED)).toBe(false);
    expect(bot.forceState('NONSENSE')).toBe(false);
  });

  it('exposes difficulty presets', () => {
    const bot = makeBot();
    bot.setDifficulty('hard');
    expect(bot.difficultyName).toBe('hard');
    bot.setDifficulty('nonsense');
    expect(bot.difficultyName).toBe(BOT.defaultDifficulty);
  });

  it('still moves at low LOD — distant bots are not frozen', () => {
    const bot = makeBot();
    const before = { ...bot.position };
    for (let i = 0; i < 60 * 20; i++) bot.update(dt, { enemies: [], lodRate: 10 });
    const moved = Math.hypot(bot.position.x - before.x, bot.position.z - before.z);
    expect(moved).toBeGreaterThan(0.5);
  });
});
