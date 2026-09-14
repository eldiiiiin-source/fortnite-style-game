/**
 * PlayerController.js — MASTER_SPEC §5, §6.
 *
 * Runs against injected terrain/collision functions, never a three.js scene, so the whole
 * movement model is testable in Node.
 *
 * Feel targets (§5.2): reaches intended speed quickly, stopping and direction changes are
 * deliberate, air control exists but is not flying, jump arc is predictable.
 *
 * Explicitly avoided (§5): floaty movement, excessive inertia, uncontrolled sliding,
 * sluggish acceleration, sticky movement, accidental slope launches.
 */
import { MOVEMENT, MANTLE, VITALS, CAMERA, MATERIAL_CAP, WORLD } from '../core/Config.js';
import { clamp } from '../core/MathUtils.js';
import { Events } from '../core/EventBus.js';

export const PlayerState = Object.freeze({
  GROUNDED: 'grounded',
  AIRBORNE: 'airborne',
  SPRINTING: 'sprinting',
  CROUCHED: 'crouched',
  MANTLING: 'mantling',
  SWIMMING: 'swimming',
  DEAD: 'dead'
});

export class PlayerController {
  /**
   * @param {object} opts
   * @param {(x:number,z:number)=>number} opts.terrainHeightAt
   * @param {(x:number,z:number)=>number} [opts.waterDepthAt]
   * @param {object} [opts.collision]  world collision provider (§6, §11)
   */
  constructor({ terrainHeightAt, waterDepthAt = null, collision = null, bus = null, id = 0 }) {
    this.id = id;
    this.bus = bus;
    this.terrainHeightAt = terrainHeightAt;
    this.waterDepthAt = waterDepthAt;
    this.collision = collision;

    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;

    this.grounded = true;
    this.crouched = false;
    this.sprinting = false;
    this.state = PlayerState.GROUNDED;

    this.radius = MOVEMENT.capsuleRadius;
    this.height = MOVEMENT.standHeight;
    this.targetHeight = MOVEMENT.standHeight;

    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.fallPeakY = 0;

    this.mantleTimer = 0;
    this.mantleStart = null;
    this.mantleTarget = null;
    /** §5.5 — time since the last build placement; blocks accidental mantles. */
    this.timeSinceBuild = Infinity;

    this.materials = { wood: 0, brick: 0, metal: 0 };
  }

  /* ── derived state ─────────────────────────────────────────────────────── */

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Eye height scales with the capsule, so crouching lowers the view (§5.4). */
  get eyePosition() {
    const ratio = this.height / MOVEMENT.standHeight;
    return {
      x: this.position.x,
      y: this.position.y + MOVEMENT.eyeOffset * ratio,
      z: this.position.z
    };
  }

  /** Yaw 0 faces -Z. */
  get forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  get right() {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Full 3D look direction, including pitch. */
  get lookDirection() {
    const cp = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp
    };
  }

  /* ── input ─────────────────────────────────────────────────────────────── */

  look(dx, dy, sensitivity = CAMERA.lookSensitivity, invertY = false) {
    this.yaw -= dx * sensitivity;
    const dyApplied = invertY ? -dy : dy;
    this.pitch = clamp(
      this.pitch - dyApplied * sensitivity,
      CAMERA.pitchMinDeg * Math.PI / 180,
      CAMERA.pitchMaxDeg * Math.PI / 180
    );
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  requestJump() {
    this.jumpBufferTimer = MOVEMENT.jumpBufferTime;
  }

  setCrouched(crouched) {
    this.targetHeight = crouched ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;
    this.crouched = crouched;
  }

  /** Called whenever the player places a build — suppresses mantling (§5.5). */
  notifyBuildPlaced() {
    this.timeSinceBuild = 0;
  }

  targetSpeed() {
    if (this.state === PlayerState.SWIMMING) return MOVEMENT.swimSpeed;
    if (this.crouched) return MOVEMENT.crouchSpeed;
    if (this.sprinting) return MOVEMENT.sprintSpeed;
    return MOVEMENT.walkSpeed;
  }

  /* ── simulation ────────────────────────────────────────────────────────── */

  /**
   * @param {number} dt always SIM.fixedDt
   * @param {{x:number,z:number}} moveAxis
   * @param {object} opts { sprintHeld, buildMode, editMode, health }
   */
  update(dt, moveAxis = { x: 0, z: 0 }, opts = {}) {
    if (this.state === PlayerState.DEAD) return;

    const { sprintHeld = false, buildMode = false, editMode = false, health = null } = opts;

    this.timeSinceBuild += dt;
    this._updateCapsuleHeight(dt);

    if (this.state === PlayerState.MANTLING) {
      this._updateMantle(dt);
      return;
    }

    // §5.1 — sprinting while building is explicitly required, so build mode never
    // suppresses sprint. Only crouching and lack of forward intent do.
    this.sprinting = sprintHeld && !this.crouched && moveAxis.z > 0.5;

    const depth = this.waterDepthAt?.(this.position.x, this.position.z) ?? 0;
    const swimming = depth > WORLD.swimDepth;

    const f = this.forward;
    const r = this.right;
    const wishX = f.x * moveAxis.z + r.x * moveAxis.x;
    const wishZ = f.z * moveAxis.z + r.z * moveAxis.x;
    const wishLen = Math.hypot(wishX, wishZ);
    const dirX = wishLen > 0 ? wishX / wishLen : 0;
    const dirZ = wishLen > 0 ? wishZ / wishLen : 0;

    if (swimming) {
      this._updateSwim(dt, dirX, dirZ, wishLen);
      return;
    }

    if (this.grounded) this._accelerateGround(dt, dirX, dirZ, wishLen);
    else this._accelerateAir(dt, dirX, dirZ, wishLen);

    // Jump BEFORE gravity: applying gravity first lets the impulse escape a tick of it
    // and overshoots the §5.2 "predictable and consistent" arc.
    this.coyoteTimer = this.grounded ? MOVEMENT.coyoteTime : Math.max(0, this.coyoteTimer - dt);
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.velocity.y = MOVEMENT.jumpVelocity;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.fallPeakY = this.position.y;
    }

    // Trapezoidal vertical integration — matches the analytic arc at any tick rate.
    const vyBefore = this.velocity.y;
    this.velocity.y = Math.max(this.velocity.y - MOVEMENT.gravity * dt, -MOVEMENT.terminalVelocity);
    const vyAverage = (vyBefore + this.velocity.y) / 2;

    const previous = { ...this.position };
    const previousGroundY = this.terrainHeightAt(this.position.x, this.position.z);

    this.position.x += this.velocity.x * dt;
    this.position.y += vyAverage * dt;
    this.position.z += this.velocity.z * dt;

    this._resolveWorldCollision(previous);
    this._resolveGround(previous, previousGroundY, health);

    // A mantle started this tick owns the state; _updateState must not clobber it.
    if (!buildMode && !editMode && this._tryMantle(moveAxis)) return;

    this._updateState(swimming);
  }

  /** §5.4 — capsule and camera height move together, smoothly. */
  _updateCapsuleHeight(dt) {
    if (this.height === this.targetHeight) return;
    const rate = (MOVEMENT.standHeight - MOVEMENT.crouchHeight) / MOVEMENT.crouchTransition;
    const step = rate * dt;
    this.height = this.height < this.targetHeight
      ? Math.min(this.targetHeight, this.height + step)
      : Math.max(this.targetHeight, this.height - step);
  }

  _accelerateGround(dt, dirX, dirZ, wishLen) {
    const target = this.targetSpeed() * Math.min(1, wishLen);

    // Exponential friction — frame-rate independent, and stops the player deliberately
    // rather than sliding (§5).
    const drop = Math.exp(-MOVEMENT.groundFriction * dt);
    this.velocity.x *= drop;
    this.velocity.z *= drop;

    if (wishLen <= 0) return;

    const currentInDir = this.velocity.x * dirX + this.velocity.z * dirZ;
    const add = Math.min(MOVEMENT.groundAccel * dt, Math.max(0, target - currentInDir));
    this.velocity.x += dirX * add;
    this.velocity.z += dirZ * add;
  }

  _accelerateAir(dt, dirX, dirZ, wishLen) {
    const drop = Math.exp(-MOVEMENT.airDrag * dt);
    this.velocity.x *= drop;
    this.velocity.z *= drop;

    if (wishLen <= 0) return;

    const target = this.targetSpeed() * Math.min(1, wishLen);
    const currentInDir = this.velocity.x * dirX + this.velocity.z * dirZ;
    // Capped steering authority — air control that is not flying (§5.2).
    const add = Math.min(
      MOVEMENT.airAccel * dt,
      MOVEMENT.airControlCap * dt,
      Math.max(0, target - currentInDir)
    );
    this.velocity.x += dirX * add;
    this.velocity.z += dirZ * add;
  }

  _updateSwim(dt, dirX, dirZ, wishLen) {
    this.state = PlayerState.SWIMMING;
    const target = MOVEMENT.swimSpeed * Math.min(1, wishLen);
    this.velocity.x = dirX * target;
    this.velocity.z = dirZ * target;
    this.velocity.y = (WORLD.seaLevel - 0.6 - this.position.y) * 4;

    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    this.grounded = false;
    this.fallPeakY = this.position.y;
  }

  /**
   * Resolve against world colliders (build pieces, props). §6, §11.
   * The collision provider owns edited geometry, so an edited opening is passable here
   * with no special-casing in the movement code.
   */
  _resolveWorldCollision(previous) {
    if (!this.collision) return;

    const resolved = this.collision.resolveCapsule({
      from: previous,
      to: this.position,
      radius: this.radius,
      height: this.height,
      stepHeight: MOVEMENT.stepHeight
    });
    if (!resolved) return;

    this.position.x = resolved.position.x;
    this.position.y = resolved.position.y;
    this.position.z = resolved.position.z;

    if (resolved.blockedX) this.velocity.x = 0;
    if (resolved.blockedZ) this.velocity.z = 0;
    if (resolved.landed) {
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }
    if (resolved.ceiling && this.velocity.y > 0) this.velocity.y = 0;
  }

  _resolveGround(previous, previousGroundY, health) {
    const groundY = this.terrainHeightAt(this.position.x, this.position.z);
    const wasGrounded = this.grounded;
    const above = this.position.y - groundY;

    if (above > 0) {
      // Step DOWN — a walking player takes a small drop without going airborne. A
      // falling player must not take this path or fall damage would be skipped.
      if (wasGrounded && above <= MOVEMENT.stepHeight && this.velocity.y <= 0) {
        this.position.y = groundY;
        this.velocity.y = 0;
        this.grounded = true;
        this.fallPeakY = groundY;
        return;
      }
      if (!this.grounded || above > MOVEMENT.stepHeight) {
        this.grounded = false;
        this.fallPeakY = Math.max(this.fallPeakY, this.position.y);
      }
      return;
    }

    // Step UP — a rise past the step height is a wall, not a stair (§6). Blocking
    // horizontally is what stops "accidental slope launches" (§5).
    const rise = groundY - previousGroundY;
    if (wasGrounded && rise > MOVEMENT.stepHeight) {
      this.position.x = previous.x;
      this.position.z = previous.z;
      this.position.y = previousGroundY;
      this.velocity.x = 0;
      this.velocity.z = 0;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
      this.fallPeakY = this.position.y;
      return;
    }

    const wasAirborne = !wasGrounded;
    this.position.y = groundY;
    if (this.velocity.y < 0) this.velocity.y = 0;
    this.grounded = true;

    if (wasAirborne) {
      const fallDistance = Math.max(0, this.fallPeakY - this.position.y);
      this.bus?.emit(Events.PLAYER_LANDED, { playerId: this.id, fallDistance });
      void health;
    }
    this.fallPeakY = this.position.y;
  }

  /* ── mantling — §5.5 ───────────────────────────────────────────────────── */

  /**
   * A mantle fires only on a valid ledge, in range, within the height limits, and never
   * while building. Returns true if a mantle started.
   */
  _tryMantle(moveAxis) {
    if (this.grounded === false && this.velocity.y > 0) return false;   // still rising
    if (moveAxis.z <= 0.5) return false;                                // must be moving in
    if (this.timeSinceBuild < MANTLE.suppressAfterBuildTime) return false;

    const f = this.forward;
    const probeX = this.position.x + f.x * MANTLE.forwardReach;
    const probeZ = this.position.z + f.z * MANTLE.forwardReach;
    const ledgeY = this.terrainHeightAt(probeX, probeZ);
    const rise = ledgeY - this.position.y;

    if (rise < MANTLE.minHeight || rise > MANTLE.maxHeight) return false;

    // The ledge must have room to stand on, not just an edge to catch.
    const beyondY = this.terrainHeightAt(
      this.position.x + f.x * (MANTLE.forwardReach + MANTLE.clearance),
      this.position.z + f.z * (MANTLE.forwardReach + MANTLE.clearance)
    );
    if (Math.abs(beyondY - ledgeY) > MOVEMENT.stepHeight) return false;

    this.beginMantle({ x: probeX, y: ledgeY, z: probeZ });
    return true;
  }

  beginMantle(target) {
    this.state = PlayerState.MANTLING;
    this.mantleTimer = 0;
    this.mantleStart = { ...this.position };
    this.mantleTarget = { ...target };
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  _updateMantle(dt) {
    this.mantleTimer += dt;
    const t = Math.min(1, this.mantleTimer / MANTLE.duration);
    const s = this.mantleStart;
    const e = this.mantleTarget;
    this.position.x = s.x + (e.x - s.x) * t;
    this.position.y = s.y + (e.y - s.y) * t;
    this.position.z = s.z + (e.z - s.z) * t;

    if (t >= 1) {
      this.state = PlayerState.GROUNDED;
      this.grounded = true;
      this.mantleTarget = null;
      this.fallPeakY = this.position.y;
    }
  }

  _updateState(swimming) {
    if (swimming) this.state = PlayerState.SWIMMING;
    else if (!this.grounded) this.state = PlayerState.AIRBORNE;
    else if (this.crouched) this.state = PlayerState.CROUCHED;
    else if (this.sprinting && this.horizontalSpeed > MOVEMENT.walkSpeed) this.state = PlayerState.SPRINTING;
    else this.state = PlayerState.GROUNDED;
  }

  /* ── materials ─────────────────────────────────────────────────────────── */

  addMaterial(type, amount) {
    if (!(type in this.materials)) return 0;
    const before = this.materials[type];
    this.materials[type] = Math.min(MATERIAL_CAP, before + amount);
    const gained = this.materials[type] - before;
    if (gained > 0) this.bus?.emit(Events.MATERIAL_GAINED, { playerId: this.id, type, amount: gained });
    return gained;
  }

  teleport(x, y, z) {
    this.position = { x, y, z };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.fallPeakY = y;
    this.grounded = false;
  }

  reset() {
    this.velocity = { x: 0, y: 0, z: 0 };
    this.state = PlayerState.GROUNDED;
    this.height = MOVEMENT.standHeight;
    this.targetHeight = MOVEMENT.standHeight;
    this.crouched = false;
    this.sprinting = false;
  }
}

export { VITALS };
