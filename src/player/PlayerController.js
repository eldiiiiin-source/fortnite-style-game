/**
 * PlayerController.js — movement. MASTER_SPEC §3.2, §3.4.
 *
 * Runs against a terrain height function, not a three.js scene, so it is testable in
 * Node. Build-piece collision is supplied as an optional resolver.
 */
import { MOVEMENT, WORLD, VITALS, CAMERA, MATERIALS } from '../core/Config.js';
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
   * @param {import('../core/EventBus.js').EventBus} [opts.bus]
   * @param {number} [opts.id]
   */
  constructor({ terrainHeightAt, bus = null, id = 0, waterDepthAt = null }) {
    this.id = id;
    this.bus = bus;
    this.terrainHeightAt = terrainHeightAt;
    this.waterDepthAt = waterDepthAt;

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

    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.mantleTimer = 0;
    this.mantleTarget = null;

    /** Highest y reached since leaving the ground, for fall damage (§3.1). */
    this.fallPeakY = 0;

    this.materials = { wood: 0, stone: 0, metal: 0 };
    this.lastPlacementTime = null;
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get eyePosition() {
    return {
      x: this.position.x,
      y: this.position.y + this.height * 0.9,
      z: this.position.z
    };
  }

  /** Forward unit vector on the XZ plane. Yaw 0 faces -Z (§2.2). */
  get forward() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  get right() {
    return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
  }

  /** Apply a look delta in raw mouse counts (§3.3). */
  look(dx, dy, sensitivity = CAMERA.lookSensitivity, scale = 1) {
    this.yaw -= dx * sensitivity * scale;
    this.pitch = clamp(
      this.pitch - dy * sensitivity * scale,
      CAMERA.pitchMinDeg * Math.PI / 180,
      CAMERA.pitchMaxDeg * Math.PI / 180
    );
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  /** Queue a jump. Honoured within the jump buffer window (§3.2). */
  requestJump() {
    this.jumpBufferTimer = MOVEMENT.jumpBufferTime;
  }

  setCrouched(crouched) {
    if (crouched === this.crouched) return;
    this.crouched = crouched;
    this.height = crouched ? MOVEMENT.crouchHeight : MOVEMENT.standHeight;
  }

  /** Target horizontal speed given the current stance (§3.2). */
  targetSpeed() {
    if (this.state === PlayerState.SWIMMING) return MOVEMENT.swimSpeed;
    if (this.crouched) return MOVEMENT.crouchSpeed;
    if (this.sprinting) return MOVEMENT.sprintSpeed;
    return MOVEMENT.walkSpeed;
  }

  /**
   * @param {number} dt  always SIM.fixedDt
   * @param {{x:number, z:number}} moveAxis  local-space intent from Input.moveAxis()
   * @param {object} opts
   */
  update(dt, moveAxis = { x: 0, z: 0 }, opts = {}) {
    if (this.state === PlayerState.DEAD) return;

    const { sprintHeld = false, canSprint = true, health = null } = opts;

    if (this.state === PlayerState.MANTLING) {
      this._updateMantle(dt);
      return;
    }

    // Sprint requires forward intent within +/-60 deg of the movement vector (§3.2).
    const wantsSprint = sprintHeld && canSprint && !this.crouched && moveAxis.z > 0.5;
    this.sprinting = wantsSprint;

    const groundY = this.terrainHeightAt(this.position.x, this.position.z);
    const depth = this.waterDepthAt?.(this.position.x, this.position.z) ?? 0;
    const swimming = depth > WORLD.swimDepth;

    // World-space desired direction.
    const f = this.forward;
    const r = this.right;
    const wishX = f.x * moveAxis.z + r.x * moveAxis.x;
    const wishZ = f.z * moveAxis.z + r.z * moveAxis.x;
    const wishLen = Math.hypot(wishX, wishZ);
    const dirX = wishLen > 0 ? wishX / wishLen : 0;
    const dirZ = wishLen > 0 ? wishZ / wishLen : 0;

    if (swimming) {
      this._updateSwim(dt, dirX, dirZ, wishLen, groundY, depth);
      return;
    }

    if (this.grounded) {
      this._accelerateGround(dt, dirX, dirZ, wishLen);
    } else {
      this._accelerateAir(dt, dirX, dirZ, wishLen);
    }

    // Jump — coyote time and jump buffer (§3.2). This runs BEFORE gravity so the impulse
    // is integrated over the same tick gravity acts on; applying gravity first would let
    // the jump escape one tick of it and overshoot the §3.2 apex.
    this.coyoteTimer = this.grounded ? MOVEMENT.coyoteTime : Math.max(0, this.coyoteTimer - dt);
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    if (this.jumpBufferTimer > 0 && this.coyoteTimer > 0) {
      this.velocity.y = MOVEMENT.jumpVelocity;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.fallPeakY = this.position.y;
    }

    // Gravity, integrated trapezoidally. Averaging the velocity across the tick makes the
    // discrete trajectory match the analytic one exactly under constant acceleration, so
    // the jump arc is the one the spec quotes at any tick rate.
    const vyBefore = this.velocity.y;
    this.velocity.y = Math.max(this.velocity.y - MOVEMENT.gravity * dt, -MOVEMENT.terminalVelocity);
    const vyAverage = (vyBefore + this.velocity.y) / 2;

    const previous = { x: this.position.x, y: this.position.y, z: this.position.z };

    this.position.x += this.velocity.x * dt;
    this.position.y += vyAverage * dt;
    this.position.z += this.velocity.z * dt;

    // Resolve against the terrain UNDER THE NEW POSITION, not the old one.
    const newGroundY = this.terrainHeightAt(this.position.x, this.position.z);
    this._resolveGround(newGroundY, health, previous, groundY);
    this._updateState(swimming);
  }

  _accelerateGround(dt, dirX, dirZ, wishLen) {
    const target = this.targetSpeed() * Math.min(1, wishLen);

    // Exponential friction, frame-rate independent.
    const drop = Math.exp(-MOVEMENT.groundFriction * dt);
    this.velocity.x *= drop;
    this.velocity.z *= drop;

    if (wishLen <= 0) return;

    const accel = MOVEMENT.groundAccel * dt;
    const currentInDir = this.velocity.x * dirX + this.velocity.z * dirZ;
    const add = Math.min(accel, Math.max(0, target - currentInDir));
    this.velocity.x += dirX * add;
    this.velocity.z += dirZ * add;
  }

  _accelerateAir(dt, dirX, dirZ, wishLen) {
    // Air drag first, then capped steering authority (§3.2).
    const drop = Math.exp(-MOVEMENT.airDrag * dt);
    this.velocity.x *= drop;
    this.velocity.z *= drop;

    if (wishLen <= 0) return;

    const target = this.targetSpeed() * Math.min(1, wishLen);
    const currentInDir = this.velocity.x * dirX + this.velocity.z * dirZ;
    const add = Math.min(
      MOVEMENT.airAccel * dt,
      MOVEMENT.airControlCap * dt,
      Math.max(0, target - currentInDir)
    );
    this.velocity.x += dirX * add;
    this.velocity.z += dirZ * add;
  }

  _updateSwim(dt, dirX, dirZ, wishLen, groundY, depth) {
    this.state = PlayerState.SWIMMING;
    const target = MOVEMENT.swimSpeed * Math.min(1, wishLen);
    this.velocity.x = dirX * target;
    this.velocity.z = dirZ * target;
    // Float at the surface.
    const surfaceY = WORLD.seaLevel - 0.6;
    this.velocity.y = (surfaceY - this.position.y) * 4;

    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    this.grounded = false;
    this.fallPeakY = this.position.y; // no fall damage out of water (§4.3)
    void groundY; void depth;
  }

  /**
   * @param {number} groundY      terrain height under the new position
   * @param {object} health       Health instance, for fall damage
   * @param {object} previous     position before integration, for blocked step-ups
   * @param {number} previousGroundY  terrain height under the previous position
   */
  _resolveGround(groundY, health, previous, previousGroundY) {
    const wasGrounded = this.grounded;
    const above = this.position.y - groundY;

    if (above > 0) {
      // Step DOWN: a player already walking takes a small drop without going airborne
      // (§3.2). A player who is falling must not take this path — it would skip the
      // landing below and with it the fall-damage assessment.
      if (wasGrounded && above <= MOVEMENT.stepHeight && this.velocity.y <= 0) {
        this.position.y = groundY;
        this.velocity.y = 0;
        this.grounded = true;
        this.fallPeakY = groundY;
        return;
      }

      this.grounded = false;
      this.fallPeakY = Math.max(this.fallPeakY, this.position.y);
      return;
    }

    // Step UP: a rise taller than the step height is a wall, not a stair. Walking into it
    // stops horizontal movement instead of teleporting the player to the top.
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

    // Landed.
    const wasAirborne = !wasGrounded;
    this.position.y = groundY;
    if (this.velocity.y < 0) this.velocity.y = 0;
    this.grounded = true;

    if (wasAirborne) {
      const fallDistance = Math.max(0, this.fallPeakY - this.position.y);
      this.bus?.emit(Events.PLAYER_LANDED, { playerId: this.id, fallDistance });
      if (health && fallDistance > VITALS.fallDamageFreeDistance) {
        health.takeFallDamage(fallDistance);
      }
    }
    this.fallPeakY = this.position.y;
  }

  _updateState(swimming) {
    if (swimming) this.state = PlayerState.SWIMMING;
    else if (!this.grounded) this.state = PlayerState.AIRBORNE;
    else if (this.crouched) this.state = PlayerState.CROUCHED;
    else if (this.sprinting && this.horizontalSpeed > MOVEMENT.walkSpeed) this.state = PlayerState.SPRINTING;
    else this.state = PlayerState.GROUNDED;
  }

  /** Start a mantle onto a ledge (§3.2). */
  beginMantle(targetPosition) {
    this.state = PlayerState.MANTLING;
    this.mantleTimer = 0;
    this.mantleStart = { ...this.position };
    this.mantleTarget = { ...targetPosition };
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  _updateMantle(dt) {
    this.mantleTimer += dt;
    const t = Math.min(1, this.mantleTimer / MOVEMENT.mantleDuration);
    this.position.x = this.mantleStart.x + (this.mantleTarget.x - this.mantleStart.x) * t;
    this.position.y = this.mantleStart.y + (this.mantleTarget.y - this.mantleStart.y) * t;
    this.position.z = this.mantleStart.z + (this.mantleTarget.z - this.mantleStart.z) * t;
    if (t >= 1) {
      this.state = PlayerState.GROUNDED;
      this.grounded = true;
      this.mantleTarget = null;
      this.fallPeakY = this.position.y;
    }
  }

  /** Add harvested material, respecting the cap (§4.1). */
  addMaterial(type, amount) {
    if (!(type in this.materials)) return 0;
    const before = this.materials[type];
    this.materials[type] = Math.min(MATERIALS.cap, before + amount);
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
}
