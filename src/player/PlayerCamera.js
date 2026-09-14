/**
 * PlayerCamera.js — close over-the-right-shoulder third person. MASTER_SPEC §7.
 *
 * Holds no three.js types: it computes a transform the renderer copies onto the real
 * camera, which keeps aiming testable in Node.
 *
 * §7 requirements this encodes directly:
 *  - close, not too high, not too far away
 *  - character sits slightly left of screen centre (camera offset right)
 *  - precise enough for fast edits, so build mode does NOT pull the camera back
 *  - collision pulls in immediately, restores smoothly
 */
import { CAMERA, MOVEMENT } from '../core/Config.js';

export class PlayerCamera {
  /**
   * @param {(origin, dir, maxDist, radius) => number|null} [sphereCast]
   *        Returns hit distance along dir, or null. Injected so camera collision is
   *        testable without a renderer.
   */
  constructor(sphereCast = null) {
    this.sphereCast = sphereCast;

    this.distance = CAMERA.distance;
    this.targetDistance = CAMERA.distance;
    this.fov = CAMERA.fovDefault;
    this.targetFov = CAMERA.fovDefault;

    this.position = { x: 0, y: 0, z: 0 };
    this.pivot = { x: 0, y: 0, z: 0 };
    this.lookDirection = { x: 0, y: 0, z: -1 };
    this.yaw = 0;
    this.pitch = 0;
    this.obstructed = false;
  }

  /**
   * @param {number} dt
   * @param {import('./PlayerController.js').PlayerController} player
   * @param {object} opts { adsProgress, adsFov, baseFov }
   */
  update(dt, player, { adsProgress = 0, adsFov = null, baseFov = CAMERA.fovDefault } = {}) {
    this.yaw = player.yaw;
    this.pitch = player.pitch;

    // §7 — build mode does NOT change camera distance. The baseline pulled back here,
    // which directly contradicts "precise enough for fast edits".
    this.targetDistance = CAMERA.distance;

    const aimFov = adsFov ?? CAMERA.fovDefault * 0.7;
    this.targetFov = baseFov + (aimFov - baseFov) * adsProgress;
    const lambda = 4 / CAMERA.transitionTime;
    this.fov += (this.targetFov - this.fov) * Math.min(1, lambda * dt);

    // §5.4 / §7 — camera height follows the capsule, so crouching lowers the view.
    const heightRatio = player.height / MOVEMENT.standHeight;
    const right = player.right;
    this.pivot = {
      x: player.position.x + right.x * CAMERA.shoulderOffsetX,
      y: player.position.y + CAMERA.heightAbovebase * heightRatio,
      z: player.position.z + right.z * CAMERA.shoulderOffsetX
    };

    const cp = Math.cos(this.pitch);
    this.lookDirection = {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp
    };
    const back = {
      x: -this.lookDirection.x,
      y: -this.lookDirection.y,
      z: -this.lookDirection.z
    };

    // ADS brings the camera in over the shoulder.
    const desired = CAMERA.distance * (1 - adsProgress * 0.45);

    // §7.1 — asymmetric by design. Pulling in is immediate because clipping through
    // geometry is never acceptable; restoring is smoothed so the view does not snap.
    let allowed = desired;
    this.obstructed = false;
    if (this.sphereCast) {
      const hit = this.sphereCast(this.pivot, back, desired, CAMERA.collisionRadius);
      if (hit !== null && hit < desired) {
        allowed = Math.max(0, hit - CAMERA.collisionPadding);
        this.obstructed = true;
      }
    }

    if (allowed < this.distance) {
      this.distance = allowed;                                   // immediate
    } else {
      const step = CAMERA.restoreSpeed * dt;                     // smoothed
      this.distance = Math.min(allowed, this.distance + step);
    }

    this.position = {
      x: this.pivot.x + back.x * this.distance,
      y: this.pivot.y + back.y * this.distance,
      z: this.pivot.z + back.z * this.distance
    };
  }

  /** Snap to the player with no interpolation — used on spawn and teleport. */
  snapTo(player) {
    this.distance = CAMERA.distance;
    this.fov = CAMERA.fovDefault;
    this.update(1, player, {});
  }
}
