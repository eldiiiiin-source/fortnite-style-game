/** Frame budget and adaptive quality. MASTER_SPEC §23. */
import { describe, it, expect } from 'vitest';
import {
  PerformanceGovernor, REDUCIBLE, PROTECTED, QUALITY_TIERS
} from '../src/core/Performance.js';
import { Game } from '../src/Game.js';
import { BuildGrid } from '../src/building/BuildGrid.js';
import { BuildPiece } from '../src/building/BuildPiece.js';
import { CollisionWorld } from '../src/building/CollisionWorld.js';
import { BUDGET, SIM, BUILD, TILE, MOVEMENT } from '../src/core/Config.js';

const dt = SIM.fixedDt;

describe('§23 what may and may not be reduced', () => {
  it('never lists a protected system as reducible', () => {
    for (const p of PROTECTED) expect(REDUCIBLE).not.toContain(p);
  });

  it('protects exactly the systems the spec names', () => {
    expect(PROTECTED).toEqual([
      'inputPolling', 'buildResponsiveness', 'editResponsiveness',
      'collisionCorrectness', 'hitFeedback'
    ]);
  });

  it('refuses to reduce a protected system', () => {
    for (const p of PROTECTED) expect(PerformanceGovernor.canReduce(p)).toBe(false);
    for (const r of REDUCIBLE) expect(PerformanceGovernor.canReduce(r)).toBe(true);
  });
});

describe('§23 governor', () => {
  const fill = (g, ms) => { for (let i = 0; i < g.sampleSize; i++) g.sample(ms, dt); };

  it('targets 60 FPS', () => {
    expect(new PerformanceGovernor().targetFps).toBe(BUDGET.targetFps);
  });

  it('does nothing while still sampling', () => {
    const g = new PerformanceGovernor();
    g.sample(100, dt);
    expect(g.evaluate().reason).toBe('sampling');
  });

  it('degrades when over budget', () => {
    const g = new PerformanceGovernor();
    fill(g, 40);
    const r = g.evaluate();
    expect(r.changed).toBe(true);
    expect(r.tier).toBe('medium');
  });

  it('degrades no further than the lowest tier', () => {
    const g = new PerformanceGovernor();
    for (let step = 0; step < 5; step++) {
      fill(g, 60);
      g.cooldown = 0;
      g.evaluate();
    }
    expect(g.tier).toBe(QUALITY_TIERS[0]);
  });

  it('restores only with real headroom', () => {
    const g = new PerformanceGovernor();
    g.tier = 'low';
    fill(g, 15);              // just under budget, not enough headroom
    expect(g.evaluate().changed).toBe(false);
    g.samples.length = 0;
    fill(g, 8);               // comfortable
    g.cooldown = 0;
    expect(g.evaluate().changed).toBe(true);
  });

  it('will not oscillate — a change starts a cooldown', () => {
    const g = new PerformanceGovernor();
    fill(g, 40);
    expect(g.evaluate().changed).toBe(true);
    fill(g, 40);
    expect(g.evaluate().reason).toBe('cooldown');
  });

  it('reports average and p95 separately so stutter is visible', () => {
    const g = new PerformanceGovernor({ sampleSize: 100 });
    for (let i = 0; i < 95; i++) g.sample(10, dt);
    for (let i = 0; i < 5; i++) g.sample(90, dt);
    expect(g.averageMs).toBeLessThan(20);
    expect(g.p95Ms).toBeGreaterThan(50);
  });

  it('drops shadows and draw distance first at low quality', () => {
    const g = new PerformanceGovernor();
    const low = g.settingsForTier('low');
    expect(low.shadowQuality).toBe(0);
    expect(low.drawDistance).toBeLessThan(1);
    expect(low.postProcessing).toBe(false);
  });
});

describe('§23 simulation stays inside its budget', () => {
  it('simulates a populated region well under the frame budget', () => {
    const game = new Game({ seed: 5 });
    // Warm up, then measure.
    for (let i = 0; i < 60; i++) game.update(dt);

    const start = performance.now();
    const ticks = 600;                       // 10 seconds of simulation
    for (let i = 0; i < ticks; i++) game.update(dt);
    const perTick = (performance.now() - start) / ticks;

    expect(perTick).toBeLessThan(BUDGET.simulationMs);
  });

  it('keeps collision queries cheap with a large structure', () => {
    const grid = new BuildGrid();
    const collision = new CollisionWorld(grid);
    // A 20x20 floor plate plus walls — far more than a normal build fight.
    for (let cx = 0; cx < 20; cx++) {
      for (let cz = 0; cz < 20; cz++) {
        grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx, cy: 1, cz } }));
      }
    }
    expect(grid.pieceCount).toBe(400);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      collision.resolveCapsule({
        from: { x: TILE * 5, y: BUILD.wallHeight + 0.5, z: TILE * 5 },
        to: { x: TILE * 5 + 0.1, y: BUILD.wallHeight + 0.5, z: TILE * 5 },
        radius: MOVEMENT.capsuleRadius,
        height: MOVEMENT.standHeight
      });
    }
    const perQuery = (performance.now() - start) / 1000;
    expect(perQuery).toBeLessThan(1.0);
  });

  it('caches collision by grid revision and invalidates on change', () => {
    const grid = new BuildGrid();
    const collision = new CollisionWorld(grid);
    const piece = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 } }));

    collision.supportHeightAt(TILE / 2, TILE / 2);
    const rev = collision._cacheRevision;

    piece.editPattern = { key: '0', name: 'Quarter', removed: [0] };
    grid.touch();
    collision.supportHeightAt(TILE / 2, TILE / 2);
    expect(collision._cacheRevision).toBeGreaterThan(rev);
  });
});
