/**
 * Guards Config.js against the specs. If a number here fails, either the spec changed and
 * Config did not, or Config changed without the spec. Either way, fix it — do not edit
 * the expected value to match the code (CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';
import {
  SIM, VITALS, MOVEMENT, MATERIALS, BUILD, EDIT, WEAPONS, RARITIES,
  STORM_PHASES, WORLD, HARVEST
} from '../src/core/Config.js';

describe('MASTER_SPEC §2.1 simulation', () => {
  it('runs at 30 Hz fixed', () => {
    expect(SIM.tickRate).toBe(30);
    expect(SIM.fixedDt).toBeCloseTo(1 / 30, 10);
    expect(SIM.maxStepsPerFrame).toBe(5);
  });
});

describe('MASTER_SPEC §3.1 vitals', () => {
  it('is 100 health and 100 max shield, starting with no shield', () => {
    expect(VITALS.maxHealth).toBe(100);
    expect(VITALS.maxShield).toBe(100);
    expect(VITALS.startShield).toBe(0);
  });
});

describe('MASTER_SPEC §3.2 movement', () => {
  it('matches the spec speeds', () => {
    expect(MOVEMENT.walkSpeed).toBe(4.6);
    expect(MOVEMENT.sprintSpeed).toBe(7.6);
    expect(MOVEMENT.crouchSpeed).toBe(2.4);
  });

  it('produces the documented jump arc', () => {
    // apex = v^2 / 2g, airtime = 2v / g  — spec quotes 1.24 m and 0.67 s.
    const apex = MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity);
    const airtime = (2 * MOVEMENT.jumpVelocity) / MOVEMENT.gravity;
    expect(apex).toBeCloseTo(1.24, 2);
    expect(airtime).toBeCloseTo(0.67, 2);
  });

  it('has a walkable slope limit of 48 degrees', () => {
    expect(MOVEMENT.maxWalkableSlopeDeg).toBe(48);
  });
});

describe('MASTER_SPEC §4.1 materials', () => {
  it('caps at 500 per material', () => {
    expect(MATERIALS.cap).toBe(500);
  });

  it('has the documented HP and build times', () => {
    expect(MATERIALS.wood.fullHp).toBe(150);
    expect(MATERIALS.stone.fullHp).toBe(300);
    expect(MATERIALS.metal.fullHp).toBe(500);
    expect(MATERIALS.wood.buildTime).toBe(3.5);
    expect(MATERIALS.stone.buildTime).toBe(11);
    expect(MATERIALS.metal.buildTime).toBe(20);
  });

  it('starts every material at 90 HP', () => {
    for (const m of ['wood', 'stone', 'metal']) {
      expect(MATERIALS[m].initialHp).toBe(90);
    }
  });
});

describe('MASTER_SPEC §4.2 harvesting', () => {
  it('never damages the harvester\'s own structures', () => {
    expect(HARVEST.damageToOwnStructures).toBe(0);
    expect(HARVEST.damageToEnemyStructures).toBe(100);
  });
});

describe('MASTER_SPEC §6.1 build grid', () => {
  it('uses a 5.12 m tile and a 3.84 m wall', () => {
    expect(BUILD.tileSize).toBe(5.12);
    expect(BUILD.wallHeight).toBe(3.84);
  });

  it('gives a ramp a 36.87 degree slope', () => {
    // references/building/01-piece-geometry.md
    const deg = Math.atan2(BUILD.wallHeight, BUILD.tileSize) * 180 / Math.PI;
    expect(deg).toBeCloseTo(36.87, 2);
    expect(deg).toBeLessThan(MOVEMENT.maxWalkableSlopeDeg); // must be runnable
  });

  it('costs 10 material and reaches 12 m', () => {
    expect(BUILD.cost).toBe(10);
    expect(BUILD.placementRange).toBe(12);
  });

  it('lets a full stack buy 50 pieces', () => {
    expect(MATERIALS.cap / BUILD.cost).toBe(50);
  });
});

describe('MASTER_SPEC §7.2 editing', () => {
  it('reaches 8 m and gates on two 0.10 s steps inside the 0.25 s budget', () => {
    expect(EDIT.range).toBe(8);
    expect(EDIT.enterTime).toBe(0.1);
    expect(EDIT.confirmTime).toBe(0.1);
    expect(EDIT.enterTime + EDIT.confirmTime).toBeLessThanOrEqual(EDIT.maxFlowTime);
  });
});

describe('MASTER_SPEC §5.2 rarity', () => {
  it('scales damage from 1.00 to 1.22 across five tiers', () => {
    expect(RARITIES.common.damageMultiplier).toBe(1.0);
    expect(RARITIES.legendary.damageMultiplier).toBe(1.22);
    const tiers = Object.values(RARITIES).map((r) => r.damageMultiplier);
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeGreaterThan(tiers[i - 1]);
  });
});

describe('MASTER_SPEC §5.3 weapons', () => {
  it('matches the spec table', () => {
    expect(WEAPONS.assaultRifle.damage).toBe(30);
    expect(WEAPONS.assaultRifle.fireRate).toBe(5.5);
    expect(WEAPONS.smg.damage).toBe(17);
    expect(WEAPONS.boltSniper.damage).toBe(105);
    expect(WEAPONS.pumpShotgun.damage * WEAPONS.pumpShotgun.pellets).toBe(90);
    expect(WEAPONS.tacticalShotgun.damage * WEAPONS.tacticalShotgun.pellets).toBe(60);
  });

  it('gives the rocket launcher the highest structure damage', () => {
    const byStructure = Object.values(WEAPONS).sort((a, b) => b.structureDamage - a.structureDamage);
    expect(byStructure[0].id).toBe('rocketLauncher');
  });
});

describe('MASTER_SPEC §9 storm', () => {
  it('has 8 phases that shrink monotonically to zero', () => {
    expect(STORM_PHASES).toHaveLength(8);
    for (let i = 1; i < STORM_PHASES.length; i++) {
      expect(STORM_PHASES[i].radiusFraction).toBeLessThan(STORM_PHASES[i - 1].radiusFraction);
    }
    expect(STORM_PHASES.at(-1).radiusFraction).toBe(0);
  });

  it('never lowers its damage between phases', () => {
    for (let i = 1; i < STORM_PHASES.length; i++) {
      expect(STORM_PHASES[i].dps).toBeGreaterThanOrEqual(STORM_PHASES[i - 1].dps);
    }
  });
});

describe('MAP_SPEC §2 dimensions', () => {
  it('is a 2048 m playable square on a 5.12 m grid, 400 tiles across', () => {
    expect(WORLD.playableExtent).toBe(2048);
    expect(WORLD.playableExtent / BUILD.tileSize).toBe(400);
  });

  it('puts the build ceiling above the highest terrain', () => {
    expect(BUILD.ceilingY).toBe(260);
    expect(BUILD.ceilingY).toBeGreaterThan(WORLD.maxHeight);
  });

  it('starts the safe zone large enough to cover the island', () => {
    expect(WORLD.initialSafeRadius * 2).toBeGreaterThan(WORLD.playableExtent * 0.9);
  });
});
