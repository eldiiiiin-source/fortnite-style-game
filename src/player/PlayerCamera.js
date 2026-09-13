/**
 * PlayerCamera.js — third-person orbit camera. MASTER_SPEC §3.3.
 *
 * Holds no three.js types: it computes a desired transform that the renderer copies onto
 * the actual camera. Collision uses an injected sphere-cast so it stays testable.
 */
import { CAMERA } from '../core/Config.js';
import { damp } from '../core/MathUtils.js';

export class PlayerCamera {
  /**
   * @param {(origin:object, dir:object, maxDist:number, radius:number)=>number|null} sphereCast
   *        Returns the hit distance along dir, or null for no hit.
   */
  constructor(sphereCast = null) {
    this.sphereCast = sphereCast;

    this.distance = CAMERA.distance;
    this.targetDistance = CAMERA.distance;
    this.fov = CAMERA.fovHip;
    this.targetFov = CAMERA.fovHip;

    this.position = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;
  }

  /**
   * @param {number} dt
   * @param {object} player   PlayerController
   * @param {object} opts     { buildMode, adsProgress, adsFov }
   */
  update(dt, player, { buildMode = false, adsProgress = 0, adsFov = CAMERA.fovAds } = {}) {
    this.yaw = player.yaw;
    this.pitch = player.pitch;

    this.targetDistance = buildMode ? CAMERA.buildDistance : CAMERA.distance;
    // ADS pulls the camera in and narrows the FOV proportionally to the ADS progress.
    this.targetFov = CAMERA.fovHip + (adsFov - CAMERA.fovHip) * adsProgress;

    // Critically-damped approach; lambda chosen so the move completes in ~transitionTime.
    const lambda = 4 / CAMERA.transitionTime;
    this.distance = damp(this.distance, this.targetDistance, lambda, dt);
    this.fov = damp(this.fov, this.targetFov, lambda, dt);

    // Pivot: the player's head plus the shoulder offset, in the player's yaw frame.
    const right = player.right;
    const pivot = {
      x: player.position.x + right.x * CAMERA.shoulderOffsetX,
      y: player.position.y + CAMERA.shoulderOffsetY,
      z: player.position.z + right.z * CAMERA.shoulderOffsetX
    };

    // Look direction from yaw/pitch (§2.2: yaw 0 faces -Z).
    const cp = Math.cos(this.pitch);
    const dir = {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp
    };
    // Camera sits behind the pivot along -dir.
    const back = { x: -dir.x, y: -dir.y, z: -dir.z };

    let dist = this.distance * (1 - adsProgress * 0.45);

    // §3.3 — pull in rather than clipping through geometry.
    if (this.sphereCast) {
      const hit = this.sphereCast(pivot, back, dist, CAMERA.collisionRadius);
      if (hit !== null && hit < dist) {
        dist = Math.max(0, hit - CAMERA.collisionPadding);
      }
    }

    this.position = {
      x: pivot.x + back.x * dist,
      y: pivot.y + back.y * dist,
      z: pivot.z + back.z * dist
    };
    this.lookDirection = dir;
    this.pivot = pivot;
  }

  /** Effective look sensitivity, reduced while aiming (§3.3). */
  static sensitivityFor(adsProgress, userSensitivity = 1) {
    const scale = 1 + (CAMERA.adsSensitivityScale - 1) * adsProgress;
    return CAMERA.lookSensitivity * userSensitivity * scale;
  }
}
