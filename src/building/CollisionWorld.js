/**
 * CollisionWorld.js — collision against build pieces. MASTER_SPEC §6, §9.5, §11.
 *
 * Every collider is derived on demand from PieceGeometry, which reads the piece's CURRENT
 * edit pattern. There is no stored collider to go stale, so:
 *
 *   - an edited opening is passable the instant the edit is confirmed (§10.4)
 *   - a flipped stair cannot retain its old collision, because the old shape is not
 *     stored anywhere (§10.8)
 *   - a destroyed piece leaves no collision, because it is gone from the grid (§9.5)
 *
 * That is the architectural answer to "never leave stale collision" — not a cleanup step
 * that can be forgotten, but a representation in which stale colliders cannot exist.
 *
 * A per-tick cache keyed by the grid's revision keeps this cheap: the cache is discarded
 * whenever the grid changes, never held across an edit.
 */
import { TILE, WALL_H, MOVEMENT, BUILD } from '../core/Config.js';
import { solidBoxes, surfaceHeightAt, pieceBounds } from './PieceGeometry.js';
import { rayAabb } from '../player/AimRay.js';

/** Does an axis-aligned box overlap a capsule approximated by its bounding box? */
function boxOverlapsCapsule(box, position, radius, height) {
  return !(
    box.max[0] <= position.x - radius || box.min[0] >= position.x + radius ||
    box.max[1] <= position.y || box.min[1] >= position.y + height ||
    box.max[2] <= position.z - radius || box.min[2] >= position.z + radius
  );
}

export class CollisionWorld {
  /** @param {import('./BuildGrid.js').BuildGrid} grid */
  constructor(grid) {
    this.grid = grid;
    this._cacheRevision = -1;
    this._boxCache = new Map();   // cellKey -> box[]
  }

  /** Discard cached colliders. Called automatically when the grid's revision changes. */
  invalidate() {
    this._boxCache.clear();
    this._cacheRevision = this.grid.revision;
  }

  _ensureFresh() {
    if (this._cacheRevision !== this.grid.revision) this.invalidate();
  }

  /** Pieces whose cells fall within a world-space AABB. */
  _piecesNear(min, max) {
    this._ensureFresh();
    const out = [];
    const cx0 = Math.floor(min[0] / TILE) - 1;
    const cx1 = Math.floor(max[0] / TILE) + 1;
    const cy0 = Math.floor(min[1] / WALL_H) - 1;
    const cy1 = Math.floor(max[1] / WALL_H) + 1;
    const cz0 = Math.floor(min[2] / TILE) - 1;
    const cz1 = Math.floor(max[2] / TILE) + 1;

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const pieces = this.grid.piecesInCell(cx, cy, cz);
          for (const p of pieces) if (!p.destroyed) out.push(p);
        }
      }
    }
    return out;
  }

  /** Solid boxes near a region, derived fresh from each piece's current edit pattern. */
  _boxesNear(min, max) {
    const boxes = [];
    for (const piece of this._piecesNear(min, max)) {
      for (const box of solidBoxes(piece)) boxes.push({ box, piece });
    }
    return boxes;
  }

  /**
   * Highest walkable build surface under a point, or null.
   * Only surfaces at or below `maxY` (plus step tolerance) count as ground.
   */
  supportHeightAt(x, z, maxY = Infinity) {
    this._ensureFresh();
    let best = null;
    const min = [x - 0.01, -Infinity, z - 0.01];
    const max = [x + 0.01, Infinity, z + 0.01];

    const cx = Math.floor(x / TILE);
    const cz = Math.floor(z / TILE);
    void min; void max;

    for (const piece of this.grid.piecesByColumn(cx, cz)) {
      if (piece.destroyed) continue;
      const h = surfaceHeightAt(piece, x, z);
      if (h === null) continue;
      if (h > maxY + MOVEMENT.stepHeight) continue;
      if (best === null || h > best) best = h;
    }
    return best;
  }

  /** Is this capsule position free of build geometry? */
  isFree(position, radius, height) {
    const min = [position.x - radius, position.y, position.z - radius];
    const max = [position.x + radius, position.y + height, position.z + radius];
    for (const { box } of this._boxesNear(min, max)) {
      if (boxOverlapsCapsule(box, position, radius, height)) return false;
    }
    return true;
  }

  /**
   * Move a capsule from `from` to `to`, resolving against build geometry.
   *
   * The motion is SWEPT: it is subdivided so no single sub-step moves further than half a
   * piece thickness. Build pieces are thin (BUILD.thickness = TILE * 0.039), so testing
   * only the destination lets a running player tunnel clean through a wall — the capsule
   * simply lands on the far side with no overlap to detect. Sub-stepping is what makes a
   * wall solid at sprint speed.
   *
   * Within each sub-step, resolution is axis-separated so the player slides along walls,
   * with a step-up attempt per blocked axis so floors and low geometry are walked onto
   * without jumping (§6).
   *
   * @returns {{position:object, blockedX:boolean, blockedZ:boolean, landed:boolean, ceiling:boolean}}
   */
  resolveCapsule({ from, to, radius, height, stepHeight = MOVEMENT.stepHeight }) {
    this._ensureFresh();

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);

    // Never step further than half the thinnest collider.
    const maxStep = BUILD.thickness * 0.5;
    const steps = Math.max(1, Math.ceil(distance / maxStep));

    const pos = { x: from.x, y: from.y, z: from.z };
    const result = { blockedX: false, blockedZ: false, landed: false, ceiling: false };

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sub = {
        x: from.x + dx * t,
        y: from.y + dy * t,
        z: from.z + dz * t
      };
      this._resolveSubStep(pos, sub, radius, height, stepHeight, result);
      // Once an axis is blocked it stays blocked for the rest of the sweep. Without this
      // a later sub-step would target a point already PAST the obstacle, find nothing to
      // overlap there, and teleport the player through what just stopped them.
      if (result.blockedX && result.blockedZ) break;
    }

    return { position: pos, ...result };
  }

  /** One swept increment. Mutates `pos` and `result` in place. */
  _resolveSubStep(pos, target, radius, height, stepHeight, result) {
    const startY = pos.y;

    // Vertical first, so standing on a floor resolves before horizontal motion.
    pos.y = target.y;
    if (!this.isFree(pos, radius, height)) {
      const movingDown = target.y <= startY;
      pos.y = startY;
      if (movingDown) {
        const support = this.supportHeightAt(pos.x, pos.z, startY + stepHeight);
        if (support !== null) {
          pos.y = support;
          result.landed = true;
        }
      } else {
        result.ceiling = true;
      }
    } else if (target.y < startY) {
      const support = this.supportHeightAt(pos.x, pos.z, startY);
      if (support !== null && target.y <= support && startY >= support - stepHeight) {
        pos.y = support;
        result.landed = true;
      }
    }

    // Horizontal, one axis at a time, so a blocked axis still allows sliding on the other.
    for (const axis of ['x', 'z']) {
      // Already blocked earlier in this sweep: do not attempt it again from a point past
      // the obstacle.
      if (axis === 'x' && result.blockedX) continue;
      if (axis === 'z' && result.blockedZ) continue;

      const previous = pos[axis];
      pos[axis] = target[axis];
      if (this.isFree(pos, radius, height)) continue;

      // Try stepping up onto whatever blocks (§6 — traversal without jumping).
      const support = this.supportHeightAt(pos.x, pos.z, pos.y + stepHeight);
      if (support !== null && support - pos.y > 0 && support - pos.y <= stepHeight) {
        const raised = { x: pos.x, y: support, z: pos.z };
        if (this.isFree(raised, radius, height)) {
          pos.y = support;
          result.landed = true;
          continue;
        }
      }

      pos[axis] = previous;
      if (axis === 'x') result.blockedX = true;
      else result.blockedZ = true;
    }

    // Walking onto a build SURFACE (ramp, floor). Ramps contribute no solid boxes - they
    // are height fields - so without this a player would walk straight through a ramp
    // instead of up it. Only a rise within the step height is taken, and never while
    // moving upward, so this cannot yank a jumping player down onto geometry.
    if (target.y <= startY) {
      const support = this.supportHeightAt(pos.x, pos.z, pos.y + stepHeight);
      if (support !== null && support > pos.y && support - pos.y <= stepHeight) {
        pos.y = support;
        result.landed = true;
      }
    }
  }

  /**
   * Camera sphere-cast (§7.1). Returns the distance to the first blocking surface, or
   * null. Marched rather than swept: cheap and adequate at camera distances.
   */
  sphereCast(origin, direction, maxDistance, radius) {
    this._ensureFresh();
    const steps = Math.max(4, Math.ceil(maxDistance / (radius * 0.75)));
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDistance;
      const p = {
        x: origin.x + direction.x * t,
        y: origin.y + direction.y * t,
        z: origin.z + direction.z * t
      };
      const min = [p.x - radius, p.y - radius, p.z - radius];
      const max = [p.x + radius, p.y + radius, p.z + radius];
      for (const { box } of this._boxesNear(min, max)) {
        if (
          box.max[0] > min[0] && box.min[0] < max[0] &&
          box.max[1] > min[1] && box.min[1] < max[1] &&
          box.max[2] > min[2] && box.min[2] < max[2]
        ) {
          return t;
        }
      }
    }
    return null;
  }

  /**
   * Raycast against pieces for shooting and edit targeting (§8.1, §10.1).
   * Tests the piece's whole bounds — a shot at a wall hits the wall even where it has
   * been edited open, which is what a player expects when aiming at a structure.
   *
   * @returns {{piece:object, distance:number}|null} nearest hit
   */
  raycastPieces(ray, maxDistance = Infinity) {
    this._ensureFresh();
    let best = null;

    for (const piece of this.grid) {
      if (piece.destroyed) continue;
      const t = rayAabb(ray, pieceBounds(piece), maxDistance);
      if (t === null) continue;
      if (best === null || t < best.distance) best = { piece, distance: t };
    }
    return best;
  }

  /**
   * Raycast against SOLID geometry only — an edited opening lets the ray through.
   * Used for line-of-sight and for pellets passing through a doorway.
   */
  raycastSolid(ray, maxDistance = Infinity) {
    this._ensureFresh();
    let best = null;

    for (const piece of this.grid) {
      if (piece.destroyed) continue;
      if (rayAabb(ray, pieceBounds(piece), maxDistance) === null) continue;

      for (const box of solidBoxes(piece)) {
        const t = rayAabb(ray, box, maxDistance);
        if (t === null) continue;
        if (best === null || t < best.distance) best = { piece, distance: t, box };
      }
      // Ramps and cones are surfaces; approximate them by their bounds for line-of-sight.
      if (piece.type === 'ramp' || piece.type === 'cone') {
        const t = rayAabb(ray, pieceBounds(piece), maxDistance);
        if (t !== null && (best === null || t < best.distance)) best = { piece, distance: t };
      }
    }
    return best;
  }
}
