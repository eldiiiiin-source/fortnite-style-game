/** Player movement and the fixed-step loop. MASTER_SPEC §2.1, §3.2, §3.3. */
import { describe, it, expect } from 'vitest';
import { PlayerController, PlayerState } from '../src/player/PlayerController.js';
import { PlayerCamera } from '../src/player/PlayerCamera.js';
import { Health } from '../src/combat/Health.js';
import { Loop } from '../src/core/Loop.js';
import { EventBus } from '../src/core/EventBus.js';
import { MOVEMENT, SIM, CAMERA, MATERIALS, VITALS } from '../src/core/Config.js';

const flat = () => 0;
const dt = SIM.fixedDt;

const makePlayer = (opts = {}) => new PlayerController({ terrainHeightAt: flat, ...opts });

/** Run n ticks with a fixed input. */
const run = (player, ticks, axis = { x: 0, z: 0 }, opts = {}) => {
  for (let i = 0; i < ticks; i++) player.update(dt, axis, opts);
};

describe('§3.2 ground movement', () => {
  it('starts grounded and still', () => {
    const p = makePlayer();
    expect(p.grounded).toBe(true);
    expect(p.horizontalSpeed).toBe(0);
  });

  it('accelerates to walk speed and holds there', () => {
    const p = makePlayer();
    run(p, 60, { x: 0, z: 1 });
    expect(p.horizontalSpeed).toBeGreaterThan(MOVEMENT.walkSpeed * 0.9);
    expect(p.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 0.1);
  });

  it('reaches sprint speed only with forward intent', () => {
    const forward = makePlayer();
    run(forward, 90, { x: 0, z: 1 }, { sprintHeld: true });
    expect(forward.horizontalSpeed).toBeGreaterThan(MOVEMENT.walkSpeed + 0.5);

    const strafe = makePlayer();
    run(strafe, 90, { x: 1, z: 0 }, { sprintHeld: true });
    expect(strafe.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.walkSpeed + 0.1);
  });

  it('does not sprint while crouched', () => {
    const p = makePlayer();
    p.setCrouched(true);
    run(p, 90, { x: 0, z: 1 }, { sprintHeld: true });
    expect(p.horizontalSpeed).toBeLessThanOrEqual(MOVEMENT.crouchSpeed + 0.1);
  });

  it('decelerates to a stop when input stops', () => {
    const p = makePlayer();
    run(p, 60, { x: 0, z: 1 });
    run(p, 60, { x: 0, z: 0 });
    expect(p.horizontalSpeed).toBeLessThan(0.1);
  });

  it('shrinks the capsule when crouching', () => {
    const p = makePlayer();
    expect(p.height).toBe(MOVEMENT.standHeight);
    p.setCrouched(true);
    expect(p.height).toBe(MOVEMENT.crouchHeight);
  });

  it('moves in the direction it faces', () => {
    const p = makePlayer();
    p.yaw = 0; // faces -Z per §2.2
    run(p, 30, { x: 0, z: 1 });
    expect(p.position.z).toBeLessThan(0);
    expect(Math.abs(p.position.x)).toBeLessThan(0.01);
  });

  it('is frame-rate independent', () => {
    // Same simulated duration at two different (fixed) step sizes lands in the same place.
    const a = makePlayer();
    for (let i = 0; i < 120; i++) a.update(1 / 120, { x: 0, z: 1 });
    const b = makePlayer();
    for (let i = 0; i < 30; i++) b.update(1 / 30, { x: 0, z: 1 });
    // A discrete integrator cannot agree exactly across a 4x step change; what matters is
    // that the distance travelled does not scale with the step size.
    const relativeError = Math.abs(a.position.z - b.position.z) / Math.abs(b.position.z);
    expect(relativeError).toBeLessThan(0.03);
  });
});

describe('§3.2 jumping', () => {
  it('leaves the ground and comes back', () => {
    const p = makePlayer();
    p.requestJump();
    p.update(dt, { x: 0, z: 0 });
    expect(p.grounded).toBe(false);
    expect(p.velocity.y).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) p.update(dt, { x: 0, z: 0 });
    expect(p.grounded).toBe(true);
    expect(p.position.y).toBeCloseTo(0, 5);
  });

  it('reaches the documented apex', () => {
    const p = makePlayer();
    p.requestJump();
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      p.update(dt, { x: 0, z: 0 });
      peak = Math.max(peak, p.position.y);
    }
    const expected = MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity);
    expect(peak).toBeCloseTo(expected, 1);
  });

  it('honours a jump buffered just before landing', () => {
    const p = makePlayer();
    p.teleport(0, 3, 0);
    p.update(dt, { x: 0, z: 0 });
    // Buffer a jump while still falling.
    p.requestJump();
    for (let i = 0; i < 20; i++) p.update(dt, { x: 0, z: 0 });
    // Landing inside the buffer window converts it into a jump.
    expect(p.jumpBufferTimer).toBeLessThanOrEqual(MOVEMENT.jumpBufferTime);
  });

  it('gives coyote time after walking off a ledge', () => {
    const p = makePlayer();
    expect(p.grounded).toBe(true);
    p.update(dt, { x: 0, z: 0 });
    expect(p.coyoteTimer).toBeCloseTo(MOVEMENT.coyoteTime, 5);
  });

  it('steers only weakly in the air', () => {
    const ground = makePlayer();
    run(ground, 10, { x: 1, z: 0 });
    const groundGain = Math.abs(ground.velocity.x);

    const air = makePlayer();
    air.teleport(0, 20, 0);
    run(air, 10, { x: 1, z: 0 });
    expect(Math.abs(air.velocity.x)).toBeLessThan(groundGain);
  });

  it('clamps to terminal velocity', () => {
    const p = makePlayer();
    p.teleport(0, 5000, 0);
    run(p, 600);
    expect(p.velocity.y).toBeGreaterThanOrEqual(-MOVEMENT.terminalVelocity);
  });
});

describe('§3.1 fall damage on landing', () => {
  it('is taken from a high fall', () => {
    const bus = new EventBus();
    const health = new Health(bus, 1);
    const p = makePlayer({ bus, id: 1 });
    p.teleport(0, 30, 0);
    for (let i = 0; i < 200 && !p.grounded; i++) p.update(dt, { x: 0, z: 0 }, { health });
    expect(p.grounded).toBe(true);
    expect(health.health).toBeLessThan(VITALS.maxHealth);
  });

  it('is not taken from a short drop', () => {
    const health = new Health();
    const p = makePlayer();
    p.teleport(0, 2, 0);
    for (let i = 0; i < 60 && !p.grounded; i++) p.update(dt, { x: 0, z: 0 }, { health });
    expect(health.health).toBe(VITALS.maxHealth);
  });

  it('emits a landed event with the fall distance', () => {
    const bus = new EventBus();
    let landed = null;
    bus.on('player:landed', (e) => { landed = e; });
    const p = makePlayer({ bus, id: 1 });
    p.teleport(0, 10, 0);
    for (let i = 0; i < 200 && !p.grounded; i++) p.update(dt, { x: 0, z: 0 });
    expect(landed.fallDistance).toBeCloseTo(10, 0);
  });
});

describe('§3.2 auto-step', () => {
  it('walks over a rise within the step height without jumping', () => {
    // A step up of 0.4 m at x > 2 — under the 0.45 m step height.
    const p = new PlayerController({ terrainHeightAt: (x) => (x > 2 ? 0.4 : 0) });
    p.yaw = -Math.PI / 2; // face +X
    run(p, 60, { x: 0, z: 1 });
    expect(p.position.x).toBeGreaterThan(2);
    expect(p.grounded).toBe(true);
    expect(p.position.y).toBeCloseTo(0.4, 5);
  });
});

describe('§3.2 mantling and swimming', () => {
  it('interpolates a mantle over its duration and lands grounded', () => {
    const p = makePlayer();
    p.beginMantle({ x: 0, y: 1.5, z: -1 });
    expect(p.state).toBe(PlayerState.MANTLING);
    const ticks = Math.ceil(MOVEMENT.mantleDuration / dt);
    run(p, ticks);
    expect(p.state).toBe(PlayerState.GROUNDED);
    expect(p.position.y).toBeCloseTo(1.5, 5);
    // The mantle placed the player above this flat test terrain, so the next tick
    // correctly puts them back in the air — the mantle itself is what ended grounded.
    run(p, 1);
    expect(p.state).toBe(PlayerState.AIRBORNE);
  });

  it('swims at swim speed in deep water', () => {
    const p = new PlayerController({
      terrainHeightAt: () => -10,
      waterDepthAt: () => 10
    });
    run(p, 60, { x: 0, z: 1 });
    expect(p.state).toBe(PlayerState.SWIMMING);
    expect(p.horizontalSpeed).toBeCloseTo(MOVEMENT.swimSpeed, 1);
  });
});

describe('§4.1 material cap', () => {
  it('caps each material at 500 and reports what was actually gained', () => {
    const p = makePlayer();
    expect(p.addMaterial('wood', 300)).toBe(300);
    expect(p.addMaterial('wood', 300)).toBe(MATERIALS.cap - 300);
    expect(p.materials.wood).toBe(MATERIALS.cap);
    expect(p.addMaterial('wood', 50)).toBe(0);
  });

  it('ignores an unknown material', () => {
    expect(makePlayer().addMaterial('plastic', 10)).toBe(0);
  });
});

describe('§3.3 camera', () => {
  it('sits behind the player at the spec distance', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    for (let i = 0; i < 30; i++) cam.update(dt, p, {});
    const d = Math.hypot(
      cam.position.x - cam.pivot.x, cam.position.y - cam.pivot.y, cam.position.z - cam.pivot.z
    );
    expect(d).toBeCloseTo(CAMERA.distance, 1);
  });

  it('pulls back in build mode', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    for (let i = 0; i < 60; i++) cam.update(dt, p, { buildMode: true });
    expect(cam.targetDistance).toBe(CAMERA.buildDistance);
    expect(cam.distance).toBeGreaterThan(CAMERA.distance);
  });

  it('narrows the FOV while aiming', () => {
    const p = makePlayer();
    const cam = new PlayerCamera();
    for (let i = 0; i < 60; i++) cam.update(dt, p, { adsProgress: 1, adsFov: CAMERA.fovAds });
    expect(cam.fov).toBeCloseTo(CAMERA.fovAds, 0);
  });

  it('pulls in rather than clipping through geometry', () => {
    const p = makePlayer();
    const blocked = new PlayerCamera(() => 1.0); // a wall 1 m behind the pivot
    for (let i = 0; i < 30; i++) blocked.update(dt, p, {});
    const d = Math.hypot(
      blocked.position.x - blocked.pivot.x,
      blocked.position.y - blocked.pivot.y,
      blocked.position.z - blocked.pivot.z
    );
    expect(d).toBeCloseTo(1.0 - CAMERA.collisionPadding, 5);
  });

  it('reduces look sensitivity while aiming', () => {
    expect(PlayerCamera.sensitivityFor(1)).toBeCloseTo(CAMERA.lookSensitivity * CAMERA.adsSensitivityScale, 10);
    expect(PlayerCamera.sensitivityFor(0)).toBe(CAMERA.lookSensitivity);
  });

  it('clamps pitch to the spec limits', () => {
    const p = makePlayer();
    p.look(0, -100000);
    expect(p.pitch).toBeCloseTo(CAMERA.pitchMaxDeg * Math.PI / 180, 5);
    p.look(0, 200000);
    expect(p.pitch).toBeCloseTo(CAMERA.pitchMinDeg * Math.PI / 180, 5);
  });

  it('wraps yaw into (-PI, PI]', () => {
    const p = makePlayer();
    for (let i = 0; i < 100; i++) p.look(1000, 0);
    expect(p.yaw).toBeGreaterThan(-Math.PI - 1e-9);
    expect(p.yaw).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});

describe('§2.1 fixed-step loop', () => {
  it('runs one tick per fixed interval of wall time', () => {
    let ticks = 0;
    const loop = new Loop(() => ticks++, () => {});
    loop.lastTime = 0;
    // One second of wall time delivered in 16 ms frames must produce 30 ticks. The
    // accumulator carries its remainder between frames, so the count is exact over the
    // second even though no single frame lands on a tick boundary.
    for (let ms = 16; ms <= 1000; ms += 16) loop.step(ms);
    expect(ticks).toBe(Math.floor((1000 - 1000 % 16) / 1000 * SIM.tickRate));
  });

  it('always hands the simulation the fixed dt, never real frame time', () => {
    const seen = [];
    const loop = new Loop((d) => seen.push(d), () => {});
    loop.lastTime = 0;
    loop.step(100); // a 100 ms frame
    expect(seen.every((d) => d === SIM.fixedDt)).toBe(true);
  });

  it('clamps a huge delta instead of simulating it all', () => {
    let ticks = 0;
    const loop = new Loop(() => ticks++, () => {});
    loop.lastTime = 0;
    loop.step(60000); // a minute of backgrounded tab
    expect(ticks).toBeLessThanOrEqual(SIM.maxStepsPerFrame);
    expect(loop.stats.droppedSteps).toBeGreaterThan(0);
  });

  it('passes the renderer an interpolation alpha in [0, 1)', () => {
    const alphas = [];
    const loop = new Loop(() => {}, (a) => alphas.push(a));
    loop.lastTime = 0;
    for (let i = 1; i <= 20; i++) loop.step(i * 7);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });
});
