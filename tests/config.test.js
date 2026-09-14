/**
 * Config against MASTER_SPEC. Owner-specified values are asserted absolutely; derived
 * values are asserted as DERIVATIONS, so retuning the build module does not break them.
 */
import { describe, it, expect } from 'vitest';
import {
  TILE, WALL_H, RATIO, SIM, VITALS, MOVEMENT, MATERIALS, MATERIAL_ORDER, MATERIAL_CAP,
  EDIT_GRIDS, EDIT_TILE, BUILD, INVENTORY, WEAPONS, RARITY_ORDER, CONSUMABLES,
  DEFAULT_BINDINGS, WEAPON_CATEGORIES, BUDGET
} from '../src/core/Config.js';

describe('§3 simulation — owner-approved 60 Hz', () => {
  it('ticks at 60 Hz', () => {
    expect(SIM.tickRate).toBe(60);
    expect(SIM.fixedDt).toBeCloseTo(1 / 60, 12);
  });
});

describe('§9.1 build module — owner-approved', () => {
  it('is 5.12 m by 3.84 m', () => {
    expect(TILE).toBe(5.12);
    expect(WALL_H).toBe(3.84);
  });

  it('exposes the module so everything else can derive from it', () => {
    expect(BUILD.tileSize).toBe(TILE);
    expect(BUILD.wallHeight).toBe(WALL_H);
  });
});

describe('§9.1.1 derived dimensions', () => {
  it('derives the player capsule from the build module', () => {
    expect(MOVEMENT.capsuleRadius).toBeCloseTo(TILE * RATIO.capsuleRadius, 12);
    expect(MOVEMENT.standHeight).toBeCloseTo(WALL_H * RATIO.standHeight, 12);
    expect(MOVEMENT.crouchHeight).toBeCloseTo(WALL_H * RATIO.crouchHeight, 12);
    expect(MOVEMENT.stepHeight).toBeCloseTo(WALL_H * RATIO.stepHeight, 12);
  });

  it('derives edit tiles from the build module', () => {
    expect(EDIT_TILE.wall.width).toBeCloseTo(TILE / 3, 12);
    expect(EDIT_TILE.wall.height).toBeCloseTo(WALL_H / 3, 12);
    expect(EDIT_TILE.floor.width).toBeCloseTo(TILE / 2, 12);
    expect(EDIT_TILE.ramp.rise).toBeCloseTo(WALL_H / 3, 12);
  });

  it('keeps a crouched player under one wall edit row and a standing player over it', () => {
    // This relationship is what makes a bottom-row opening a crouch-only gap.
    expect(MOVEMENT.crouchHeight).toBeLessThan(EDIT_TILE.wall.height);
    expect(MOVEMENT.standHeight).toBeGreaterThan(EDIT_TILE.wall.height);
  });

  it('fits a standing player through a two-row door with comfortable margin', () => {
    const doorHeight = EDIT_TILE.wall.height * 2;
    expect(doorHeight).toBeGreaterThan(MOVEMENT.standHeight);
    expect(doorHeight - MOVEMENT.standHeight).toBeGreaterThan(MOVEMENT.capsuleRadius);
  });

  it('fits a capsule across one wall edit tile with margin', () => {
    expect(EDIT_TILE.wall.width).toBeGreaterThan(MOVEMENT.capsuleRadius * 2);
  });

  it('keeps the ramp slope walkable', () => {
    const slope = Math.atan2(WALL_H, TILE) * 180 / Math.PI;
    expect(slope).toBeCloseTo(36.87, 2);
    expect(slope).toBeLessThan(MOVEMENT.maxWalkableSlopeDeg);
  });

  it('derives build ranges from the module rather than hardcoding metres', () => {
    expect(BUILD.placementRange).toBeCloseTo(TILE * 2.34375, 10);
    expect(BUILD.editRange).toBeCloseTo(TILE * 1.5625, 10);
  });
});

describe('§10.2 edit grids are per piece type', () => {
  it('gives wall 3x3, floor 2x2, cone 2x2, ramp 3 rows x 2 cols', () => {
    expect(EDIT_GRIDS.wall).toEqual({ cols: 3, rows: 3, tiles: 9 });
    expect(EDIT_GRIDS.floor).toEqual({ cols: 2, rows: 2, tiles: 4 });
    expect(EDIT_GRIDS.cone).toEqual({ cols: 2, rows: 2, tiles: 4 });
    expect(EDIT_GRIDS.ramp).toEqual({ cols: 2, rows: 3, tiles: 6 });
  });

  it('keeps tile counts consistent with rows x cols', () => {
    for (const g of Object.values(EDIT_GRIDS)) {
      expect(g.tiles).toBe(g.rows * g.cols);
    }
  });
});

describe('§13 vitals', () => {
  it('is 100 health and 100 shield', () => {
    expect(VITALS.maxHealth).toBe(100);
    expect(VITALS.maxShield).toBe(100);
  });
});

describe('§9.4 materials are wood, brick, metal', () => {
  it('names brick, not stone', () => {
    expect(MATERIAL_ORDER).toEqual(['wood', 'brick', 'metal']);
    expect(MATERIALS.brick).toBeDefined();
    expect(MATERIALS.stone).toBeUndefined();
  });

  it('gives each material a different health', () => {
    const hps = MATERIAL_ORDER.map((m) => MATERIALS[m].fullHp);
    expect(new Set(hps).size).toBe(3);
    for (let i = 1; i < hps.length; i++) expect(hps[i]).toBeGreaterThan(hps[i - 1]);
  });

  it('gives each material a different construction progression', () => {
    const times = MATERIAL_ORDER.map((m) => MATERIALS[m].buildTime);
    expect(new Set(times).size).toBe(3);
  });

  it('caps materials', () => {
    expect(MATERIAL_CAP).toBe(500);
  });
});

describe('§15 inventory is five combat slots', () => {
  it('has exactly five', () => {
    expect(INVENTORY.combatSlots).toBe(5);
  });
});

describe('§12 weapons', () => {
  it('covers every required category', () => {
    const present = new Set(Object.values(WEAPONS).map((w) => w.category));
    for (const c of WEAPON_CATEGORIES) expect(present.has(c)).toBe(true);
  });

  it('declares every field the spec requires on every weapon', () => {
    const required = [
      'damage', 'fireRate', 'magazine', 'reserveAmmo', 'reloadTime',
      'equipTime', 'headshotMultiplier', 'ammo', 'mode',
      'recoilVertical', 'recoilHorizontal', 'recoilRecovery'
    ];
    for (const [id, w] of Object.entries(WEAPONS)) {
      for (const field of required) {
        expect(w[field], `${id}.${field}`).toBeDefined();
      }
    }
  });

  it('gives shotguns pellets', () => {
    for (const w of Object.values(WEAPONS)) {
      if (w.category === 'shotgun') expect(w.pellets).toBeGreaterThan(1);
    }
  });

  it('orders rarity from common to legendary', () => {
    expect(RARITY_ORDER).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
  });
});

describe('§16.4 consumables', () => {
  it('provides small shield, large shield and a health item', () => {
    expect(CONSUMABLES.smallShield).toBeDefined();
    expect(CONSUMABLES.largeShield).toBeDefined();
    expect(CONSUMABLES.medkit).toBeDefined();
  });

  it('caps small shields below large shields', () => {
    expect(CONSUMABLES.smallShield.shieldCap).toBeLessThan(CONSUMABLES.largeShield.shieldCap);
  });
});

describe('§4 input bindings', () => {
  it('binds every action the spec lists', () => {
    const required = [
      'moveForward', 'moveBackward', 'moveLeft', 'moveRight', 'jump', 'crouch', 'sprint',
      'interact', 'fire', 'aim', 'reload', 'pickaxe',
      'weaponSlot1', 'weaponSlot2', 'weaponSlot3', 'weaponSlot4', 'weaponSlot5',
      'wall', 'floor', 'ramp', 'cone', 'edit', 'confirmEdit', 'resetEdit',
      'inventory', 'map', 'settings'
    ];
    for (const action of required) {
      expect(DEFAULT_BINDINGS[action], action).toBeDefined();
    }
  });

  it('defaults reset edit to mouse wheel down', () => {
    expect(DEFAULT_BINDINGS.resetEdit).toBe('WheelDown');
  });
});

describe('§23 performance budget', () => {
  it('targets 60 FPS', () => {
    expect(BUDGET.targetFps).toBe(60);
  });
});
