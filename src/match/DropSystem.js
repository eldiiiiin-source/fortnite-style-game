/**
 * DropSystem.js — BATTLE_ROYALE_SPEC §5.
 *
 * Original transport, route, freefall and glider. No Battle Bus, no Fortnite assets.
 *
 * The route is a chord across the region, generated from the seeded `storm` stream so a
 * match replays identically (§18). §5.1 forbids routes that barely clip the map, which is
 * enforced by requiring the chord to pass within a bounded distance of the centre.
 */
import { WORLD } from '../core/Config.js';
import { DROP } from '../meta/MetaConfig.js';

export const DropState = Object.freeze({
  IDLE: 'idle',
  IN_TRANSPORT: 'inTransport',
  FREEFALL: 'freefall',
  GLIDING: 'gliding',
  LANDED: 'landed'
});

/**
 * Generate a transport route across the region.
 *
 * @param {import('../core/Random.js').RandomStream} rng
 * @param {number} [regionExtent]
 * @returns {{start:{x,z}, end:{x,z}, direction:{x,z}, length:number, altitude:number}}
 */
export function generateDropRoute(rng, regionExtent = WORLD.regionExtent) {
  const half = regionExtent / 2;
  const margin = regionExtent * DROP.routeMarginRatio;

  // A chord defined by its bearing and its perpendicular offset from the centre. Bounding
  // the offset is what guarantees the route genuinely crosses the region rather than
  // clipping a corner (§5.1).
  const bearing = rng.range(0, Math.PI * 2);
  const maxOffset = half * 0.55;
  const offset = rng.range(-maxOffset, maxOffset);

  const dir = { x: Math.cos(bearing), z: Math.sin(bearing) };
  const perp = { x: -dir.z, z: dir.x };
  const reach = half + margin;

  const centre = { x: perp.x * offset, z: perp.z * offset };
  const start = { x: centre.x - dir.x * reach, z: centre.z - dir.z * reach };
  const end = { x: centre.x + dir.x * reach, z: centre.z + dir.z * reach };

  return {
    start,
    end,
    direction: dir,
    length: Math.hypot(end.x - start.x, end.z - start.z),
    altitude: DROP.transportAltitude,
    offsetFromCentre: Math.abs(offset)
  };
}

/** Position along a route at normalised progress t. */
export function routePositionAt(route, t) {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    x: route.start.x + (route.end.x - route.start.x) * clamped,
    y: route.altitude,
    z: route.start.z + (route.end.z - route.start.z) * clamped
  };
}

/**
 * The transport itself. Travels the route over a finite duration and reports whether the
 * drop window is open.
 */
export class Transport {
  constructor(route, { duration = DROP.routeDuration } = {}) {
    this.route = route;
    this.duration = duration;
    this.elapsed = 0;
    this.finished = false;
  }

  get progress() {
    return this.duration > 0 ? Math.min(1, this.elapsed / this.duration) : 1;
  }

  get position() {
    return routePositionAt(this.route, this.progress);
  }

  /** §5.2 — participants may only exit during the valid window. */
  get windowOpen() {
    return !this.finished && this.progress < 1;
  }

  update(dt) {
    if (this.finished) return;
    this.elapsed += dt;
    if (this.progress >= 1) this.finished = true;
  }

  reset() {
    this.elapsed = 0;
    this.finished = false;
  }
}

/**
 * A participant's descent: freefall, then glider, then landing.
 *
 * Deliberately a separate module from PlayerController rather than a new mode inside it —
 * the core movement controller is stable and must not be destabilised (owner's
 * instruction). Descent writes a position; on landing, control returns to the controller.
 */
export class Descent {
  /**
   * @param {object} opts
   * @param {(x:number,z:number)=>number} opts.terrainHeightAt
   */
  constructor({ terrainHeightAt }) {
    this.terrainHeightAt = terrainHeightAt;
    this.state = DropState.IDLE;
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.gliderDeployed = false;
  }

  get isDescending() {
    return this.state === DropState.FREEFALL || this.state === DropState.GLIDING;
  }

  get altitudeAboveGround() {
    return this.position.y - this.terrainHeightAt(this.position.x, this.position.z);
  }

  /** Board the transport. */
  board(position) {
    this.state = DropState.IN_TRANSPORT;
    this.position = { ...position };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.gliderDeployed = false;
  }

  /** Leave the transport — §5.2. Only allowed while the window is open. */
  jump(fromPosition, windowOpen = true) {
    if (this.state !== DropState.IN_TRANSPORT || !windowOpen) return false;
    this.state = DropState.FREEFALL;
    this.position = { ...fromPosition };
    this.velocity = { x: 0, y: 0, z: 0 };
    return true;
  }

  /** §5.3 — manual deploy, only above the minimum altitude. */
  deployGlider() {
    if (this.state !== DropState.FREEFALL) return false;
    if (this.altitudeAboveGround < DROP.gliderMinDeployAltitude) return false;
    this.state = DropState.GLIDING;
    this.gliderDeployed = true;
    return true;
  }

  /**
   * @param {number} dt
   * @param {{x:number,z:number}} steer  local steering intent, -1..1
   * @param {number} yaw  facing, so steering is relative to the camera
   */
  update(dt, steer = { x: 0, z: 0 }, yaw = 0) {
    if (!this.isDescending) return;

    // §5.3 — auto-deploy below the safety floor, regardless of player input.
    if (this.state === DropState.FREEFALL &&
        this.altitudeAboveGround <= DROP.gliderAutoDeployAltitude) {
      this.state = DropState.GLIDING;
      this.gliderDeployed = true;
    }

    const gliding = this.state === DropState.GLIDING;
    const descent = gliding ? DROP.gliderDescent : DROP.freefallDescent;
    const maxSpeed = gliding ? DROP.gliderSpeed : DROP.freefallSpeed;
    const accel = gliding ? DROP.gliderSteerAccel : DROP.freefallSteerAccel;

    // Steering is relative to facing: forward is -Z at yaw 0.
    const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const wishX = f.x * steer.z + r.x * steer.x;
    const wishZ = f.z * steer.z + r.z * steer.x;
    const wishLen = Math.hypot(wishX, wishZ);

    if (wishLen > 0) {
      const dirX = wishX / wishLen;
      const dirZ = wishZ / wishLen;
      const current = this.velocity.x * dirX + this.velocity.z * dirZ;
      const add = Math.min(accel * dt, Math.max(0, maxSpeed - current));
      this.velocity.x += dirX * add;
      this.velocity.z += dirZ * add;
    } else {
      // Limited air control: horizontal speed bleeds off without input.
      const drag = Math.exp(-(gliding ? 1.2 : 0.5) * dt);
      this.velocity.x *= drag;
      this.velocity.z *= drag;
    }

    this.velocity.y = -descent;

    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // Landing — §5.3, the glider closes automatically.
    const ground = this.terrainHeightAt(this.position.x, this.position.z);
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.state = DropState.LANDED;
      this.gliderDeployed = false;
      this.velocity = { x: 0, y: 0, z: 0 };
    }
  }

  reset() {
    this.state = DropState.IDLE;
    this.position = { x: 0, y: 0, z: 0 };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.gliderDeployed = false;
  }
}

/**
 * Choose a landing spot for a bot — §5.4.
 *
 * Weighted by loot value, distance from the route, and how many bots already chose
 * nearby, so bots spread out and some spots become naturally contested.
 *
 * @param {import('../core/Random.js').RandomStream} rng
 * @param {Array<{x:number,z:number,lootWeight:number}>} candidates
 * @param {object} route
 * @param {Array<{x:number,z:number}>} taken  spots already chosen this match
 */
export function chooseLandingSpot(rng, candidates, route, taken = []) {
  if (candidates.length === 0) return null;

  const weights = candidates.map((spot) => {
    // Perpendicular distance from the route — closer is cheaper to reach.
    const toSpot = { x: spot.x - route.start.x, z: spot.z - route.start.z };
    const along = toSpot.x * route.direction.x + toSpot.z * route.direction.z;
    const perpX = toSpot.x - route.direction.x * along;
    const perpZ = toSpot.z - route.direction.z * along;
    const routeDistance = Math.hypot(perpX, perpZ);

    // Crowding — every bot already heading nearby reduces this spot's appeal.
    let crowding = 0;
    for (const t of taken) {
      const d = Math.hypot(t.x - spot.x, t.z - spot.z);
      if (d < WORLD.regionExtent * 0.08) crowding += 1;
    }

    const lootScore = (spot.lootWeight ?? 1) * DROP.botLandingLootWeight;
    const routeScore = DROP.botLandingRouteWeight * (1 / (1 + routeDistance / 100));
    const spreadPenalty = 1 / (1 + crowding * DROP.botLandingSpreadWeight * 4);

    return Math.max(0.0001, (lootScore + routeScore) * spreadPenalty);
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
