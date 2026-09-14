/** Movement, camera and the loop. MASTER_SPEC §3, §5, §6, §7, §24. */
import { describe, it, expect } from 'vitest';
import { PlayerController, PlayerState } from '../src/player/PlayerController.js';
import { PlayerCamera } from '../src/player/PlayerCamera.js';
import { Input } from '../src/core/Input.js';
import { Loop } from '../src/core/Loop.js';
import { TestEnvironment } from '../src/world/TestEnvironment.js';
import { MOVEMENT, SIM, CAMERA, MANTLE, MATERIAL_CAP, TILE, WALL_H } from '../src/core/Config.js';

const dt = SIM.fixedDt;
const flat = () => 0;
const makePlayer = (opts = {}) => new PlayerController({ terrainHeightAt: flat, ...opts });
const run = (p, ticks, axis = { x: 0, z: 0 }, opts = {}) => {
  for (let i = 0; i < ticks; i++) p.update(dt, axis, opts);
};

describe('§5.2 responsive acceleration', () => {
  it('reaches walk speed quickly — within 0.2 s', () => {
    const p = makePlayer();
    run(p, Math.ceil(0.2 / dt), { x: 0, z: 1 });
    expect(p.horizontalSpeed).toBeGreaterThan(MOVEMENT.walkSpeed * 0.9);
  });

  it('holds at walk speed without overshooting', () => {
    const p = makePlayer();
    run(p, 180, { x: 0, z: 1 });
    expect(p.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 0.05);
  });

  it('stops deliberately rather than sliding', () => {
    const p = makePlayer();
    run(p, 60, { x: 0, z: 1 });
    run(p, Math.ceil(0.35 / dt), { x: 0, z: 0 });
    expect(p.horizontalSpeed).toBeLessThan(0.15);
  });

  it('changes direction without carrying old momentum', () => {
    const p = makePlayer();
    run(p, 60, { x: 0, z: 1 });
    const forwardZ = p.velocity.z;
    run(p, 30, { x: 0, z: -1 });
    expect(Math.sign(p.velocity.z)).not.toBe(Math.sign(forwardZ));
  });

  it('is frame-rate independent', () => {
    const a = makePlayer();
    for (let i = 0; i < 240; i++) a.update(1 / 240, { x: 0, z: 1 });
    const b = makePlayer();
    for (let i = 0; i < 60; i++) b.update(1 / 60, { x: 0, z: 1 });
    const rel = Math.abs(a.position.z - b.position.z) / Math.abs(b.position.z);
    expect(rel).toBeLessThan(0.03);
  });
});

describe('§5 sprint and crouch', () => {
  it('sprints only with forward intent', () => {
    const fwd = makePlayer();
    run(fwd, 120, { x: 0, z: 1 }, { sprintHeld: true });
    expect(fwd.horizontalSpeed).toBeGreaterThan(MOVEMENT.walkSpeed + 0.5);

    const strafe = makePlayer();
    run(strafe, 120, { x: 1, z: 0 }, { sprintHeld: true });
    expect(strafe.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 0.05);
  });

  it('does not sprint while crouched', () => {
    const p = makePlayer();
    p.setCrouched(true);
    run(p, 120, { x: 0, z: 1 }, { sprintHeld: true });
    expect(p.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.crouchSpeed + 0.05);
  });

  it('transitions the capsule smoothly and updates the eye height', () => {
    const p = makePlayer();
    const standEye = p.eyePosition.y;
    p.setCrouched(true);
    run(p, Math.ceil(MOVEMENT.crouchTransition / dt) + 2);
    expect(p.height).toBeCloseTo(MOVEMENT.crouchHeight, 5);
    expect(p.eyePosition.y).toBeLessThan(standEye);

    p.setCrouched(false);
    run(p, Math.ceil(MOVEMENT.crouchTransition / dt) + 2);
    expect(p.height).toBeCloseTo(MOVEMENT.standHeight, 5);
  });
});

describe('§5.2 jumping is predictable', () => {
  it('reaches the analytic apex', () => {
    const p = makePlayer();
    p.requestJump();
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      p.update(dt, { x: 0, z: 0 });
      peak = Math.max(peak, p.position.y);
    }
    const expected = MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity);
    expect(peak).toBeCloseTo(expected, 2);
  });

  it('lands back on the ground', () => {
    const p = makePlayer();
    p.requestJump();
    run(p, 120);
    expect(p.grounded).toBe(true);
    expect(p.position.y).toBeCloseTo(0, 5);
  });

  it('gives coyote time', () => {
    const p = makePlayer();
    p.update(dt, { x: 0, z: 0 });
    expect(p.coyoteTimer).toBeCloseTo(MOVEMENT.coyoteTime, 5);
  });

  it('air control exists but is not flying', () => {
    const ground = makePlayer();
    run(ground, 10, { x: 1, z: 0 });
    const air = makePlayer();
    air.teleport(0, 20, 0);
    run(air, 10, { x: 1, z: 0 });
    expect(Math.abs(air.velocity.x)).toBeGreaterThan(0);
    expect(Math.abs(air.velocity.x)).toBeLessThan(Math.abs(ground.velocity.x));
  });

  it('clamps to terminal velocity', () => {
    const p = makePlayer();
    p.teleport(0, 5000, 0);
    run(p, 1200);
    expect(p.velocity.y).toBeGreaterThanOrEqual(-MOVEMENT.terminalVelocity);
  });
});

describe('§6 step-up and slope', () => {
  it('walks over a rise within the step height without jumping', () => {
    const p = new PlayerController({ terrainHeightAt: (x) => (x > 2 ? MOVEMENT.stepHeight * 0.9 : 0) });
    p.yaw = -Math.PI / 2;          // face +X
    run(p, 120, { x: 0, z: 1 });
    expect(p.position.x).toBeGreaterThan(2);
    expect(p.grounded).toBe(true);
  });

  it('is blocked by a rise taller than the step height', () => {
    const p = new PlayerController({ terrainHeightAt: (x) => (x > 2 ? WALL_H : 0) });
    p.yaw = -Math.PI / 2;
    run(p, 120, { x: 0, z: 1 });
    expect(p.position.x).toBeLessThan(2.6);       // stopped at the wall
    expect(p.position.y).toBeLessThan(MOVEMENT.stepHeight);
  });

  it('does not launch off slopes', () => {
    const terrain = new TestEnvironment();
    const p = new PlayerController({ terrainHeightAt: (x, z) => terrain.heightAt(x, z) });
    p.teleport(TILE * 20, terrain.heightAt(TILE * 20, TILE * 8), TILE * 8);
    p.yaw = Math.PI;
    for (let i = 0; i < 240; i++) {
      p.update(dt, { x: 0, z: 1 }, { sprintHeld: true });
      // Running up a smooth hill must never fling the player into the air.
      const ground = terrain.heightAt(p.position.x, p.position.z);
      expect(p.position.y - ground).toBeLessThan(MOVEMENT.stepHeight + 0.05);
    }
  });
});

describe('§5.5 mantling', () => {
  it('mantles a valid ledge', () => {
    const p = new PlayerController({
      terrainHeightAt: (x) => (x > 0.8 ? MOVEMENT.standHeight * 0.6 : 0)
    });
    p.yaw = -Math.PI / 2;
    let mantled = false;
    for (let i = 0; i < 60; i++) {
      p.update(dt, { x: 0, z: 1 });
      if (p.state === PlayerState.MANTLING) { mantled = true; break; }
    }
    expect(mantled).toBe(true);
  });

  it('never mantles during building', () => {
    const p = new PlayerController({
      terrainHeightAt: (x) => (x > 0.8 ? MOVEMENT.standHeight * 0.6 : 0)
    });
    p.yaw = -Math.PI / 2;
    for (let i = 0; i < 60; i++) {
      p.notifyBuildPlaced();
      p.update(dt, { x: 0, z: 1 }, { buildMode: true });
      expect(p.state).not.toBe(PlayerState.MANTLING);
    }
  });

  it('does not mantle a ledge that is too tall', () => {
    const p = new PlayerController({
      terrainHeightAt: (x) => (x > 0.8 ? MANTLE.maxHeight + 1 : 0)
    });
    p.yaw = -Math.PI / 2;
    for (let i = 0; i < 60; i++) {
      p.update(dt, { x: 0, z: 1 });
      expect(p.state).not.toBe(PlayerState.MANTLING);
    }
  });

  it('completes a mantle and returns to a normal state', () => {
    const p = makePlayer();
    p.beginMantle({ x: 0, y: 1.5, z: -1 });
    run(p, Math.ceil(MANTLE.duration / dt));
    expect(p.state).toBe(PlayerState.GROUNDED);
    expect(p.position.y).toBeCloseTo(1.5, 5);
  });
});

describe('§7 camera', () => {
  it('sits close, at the spec distance', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    for (let i = 0; i < 60; i++) cam.update(dt, p, {});
    const d = Math.hypot(
      cam.position.x - cam.pivot.x, cam.position.y - cam.pivot.y, cam.position.z - cam.pivot.z
    );
    expect(d).toBeCloseTo(CAMERA.distance, 1);
  });

  it('offsets to the right shoulder so the character reads left of centre', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    cam.update(dt, p, {});
    // Pivot is offset along the player's right vector.
    expect(cam.pivot.x - p.position.x).toBeCloseTo(CAMERA.shoulderOffsetX, 5);
  });

  it('does NOT pull back in build mode — edit precision (§7)', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    for (let i = 0; i < 60; i++) cam.update(dt, p, {});
    const normal = cam.distance;
    for (let i = 0; i < 60; i++) cam.update(dt, p, { buildMode: true });
    expect(cam.distance).toBeCloseTo(normal, 5);
  });

  it('lowers with the crouching capsule', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    cam.update(dt, p, {});
    const standing = cam.pivot.y;
    p.setCrouched(true);
    run(p, Math.ceil(MOVEMENT.crouchTransition / dt) + 2);
    cam.update(dt, p, {});
    expect(cam.pivot.y).toBeLessThan(standing);
  });

  it('pulls in immediately when blocked, and never clips through', () => {
    const p = makePlayer();
    const blocked = new PlayerCamera(() => 1.0);
    blocked.update(dt, p, {});
    const d = Math.hypot(
      blocked.position.x - blocked.pivot.x,
      blocked.position.y - blocked.pivot.y,
      blocked.position.z - blocked.pivot.z
    );
    expect(d).toBeCloseTo(1.0 - CAMERA.collisionPadding, 5);
    expect(blocked.obstructed).toBe(true);
  });

  it('restores distance smoothly, not instantly', () => {
    const p = makePlayer();
    let blocking = true;
    const cam = new PlayerCamera(() => (blocking ? 1.0 : null));
    cam.update(dt, p, {});
    const pulled = cam.distance;
    blocking = false;
    cam.update(dt, p, {});
    expect(cam.distance).toBeGreaterThan(pulled);
    expect(cam.distance).toBeLessThan(CAMERA.distance);   // not a snap
  });

  it('narrows FOV while aiming', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    for (let i = 0; i < 120; i++) cam.update(dt, p, { adsProgress: 1, adsFov: 55 });
    expect(cam.fov).toBeCloseTo(55, 0);
  });

  it('clamps pitch', () => {
    const p = makePlayer();
    p.look(0, -1e6);
    expect(p.pitch).toBeCloseTo(CAMERA.pitchMaxDeg * Math.PI / 180, 5);
    p.look(0, 2e6);
    expect(p.pitch).toBeCloseTo(CAMERA.pitchMinDeg * Math.PI / 180, 5);
  });

  it('reduces sensitivity while aiming', () => {
    expect(Input.sensitivityFor({ adsProgress: 1 }))
      .toBeCloseTo(CAMERA.lookSensitivity * CAMERA.adsSensitivityScale, 12);
    expect(Input.sensitivityFor({ adsProgress: 0 })).toBe(CAMERA.lookSensitivity);
    expect(Input.sensitivityFor({ adsProgress: 1, scoped: true }))
      .toBeCloseTo(CAMERA.lookSensitivity * CAMERA.scopeSensitivityScale, 12);
  });

  it('inverts Y when asked', () => {
    const a = makePlayer();
    const b = makePlayer();
    a.look(0, 100, CAMERA.lookSensitivity, false);
    b.look(0, 100, CAMERA.lookSensitivity, true);
    expect(Math.sign(a.pitch)).not.toBe(Math.sign(b.pitch));
  });
});

describe('§4 input never drops presses', () => {
  it('counts repeated presses inside one tick', () => {
    const input = new Input();
    for (let i = 0; i < 5; i++) input.simulatePress('KeyQ');
    expect(input.pressCount('wall')).toBe(5);
  });

  it('binds wheel up and wheel down independently', () => {
    const input = new Input();
    input.simulateWheel(1);                       // down
    expect(input.wasPressed('resetEdit')).toBe(true);
    input.endTick();
    input.simulateWheel(-1);                      // up
    expect(input.wasPressed('resetEdit')).toBe(false);
  });

  it('never leaves the wheel stuck held', () => {
    const input = new Input();
    input.simulateWheel(1);
    expect(input.isDown('resetEdit')).toBe(false);
  });

  it('detects bind conflicts rather than silently accepting them', () => {
    const input = new Input();
    const r = input.rebind('jump', 'KeyW');
    expect(r.ok).toBe(false);
    expect(r.conflicts).toContain('moveForward');
    expect(input.bindings.jump).toBe('Space');   // unchanged
  });

  it('forces a rebind when asked, clearing the loser', () => {
    const input = new Input();
    const r = input.rebind('jump', 'KeyW', { force: true });
    expect(r.ok).toBe(true);
    expect(input.bindings.jump).toBe('KeyW');
    expect(input.bindings.moveForward).toBeNull();
  });

  it('allows exempt overlaps like pickaxe and slot 1', () => {
    const input = new Input();
    expect(input.allConflicts()).toEqual([]);
  });

  it('normalises diagonal movement', () => {
    const input = new Input();
    input.simulatePress('KeyW');
    input.simulatePress('KeyD');
    const axis = input.moveAxis();
    expect(Math.hypot(axis.x, axis.z)).toBeCloseTo(1, 6);
  });
});

describe('§3 fixed-step loop', () => {
  it('always hands the simulation the fixed dt', () => {
    const seen = [];
    const loop = new Loop((d) => seen.push(d), () => {});
    loop.lastTime = 0;
    loop.step(100);
    expect(seen.every((d) => d === SIM.fixedDt)).toBe(true);
  });

  it('runs 60 ticks per second of wall time', () => {
    let ticks = 0;
    const loop = new Loop(() => ticks++, () => {});
    loop.lastTime = 0;
    for (let ms = 16; ms <= 1000; ms += 16) loop.step(ms);
    expect(ticks).toBeGreaterThanOrEqual(58);
    expect(ticks).toBeLessThanOrEqual(60);
  });

  it('clamps a huge delta instead of simulating it all', () => {
    let ticks = 0;
    const loop = new Loop(() => ticks++, () => {});
    loop.lastTime = 0;
    loop.step(60000);
    expect(ticks).toBeLessThanOrEqual(SIM.maxStepsPerFrame);
  });
});

describe('materials', () => {
  it('caps and reports actual gain', () => {
    const p = makePlayer();
    expect(p.addMaterial('brick', 300)).toBe(300);
    expect(p.addMaterial('brick', 300)).toBe(MATERIAL_CAP - 300);
    expect(p.addMaterial('brick', 50)).toBe(0);
  });

  it('ignores an unknown material', () => {
    expect(makePlayer().addMaterial('stone', 10)).toBe(0);
  });
});
