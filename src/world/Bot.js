/**
 * Bot.js — lightweight test targets. MASTER_SPEC §17.
 *
 * "Complex AI is not a priority yet. Use simple performant logic."
 *
 * A bot reuses the real PlayerController, so it obeys the same movement, collision and
 * step-up rules the player does — which is what makes it a useful test target rather than
 * a floating hitbox. Its brain is a small state machine, deliberately cheap.
 */
import { MOVEMENT, TILE, VITALS } from '../core/Config.js';
import { PlayerController } from '../player/PlayerController.js';
import { Health } from '../combat/Health.js';
import { Events } from '../core/EventBus.js';

export const BotState = Object.freeze({
  IDLE: 'idle',
  PATROL: 'patrol',
  CHASE: 'chase',
  ATTACK: 'attack',
  DEAD: 'dead'
});

export const BOT_CONFIG = Object.freeze({
  sightRange: TILE * 12,
  attackRange: TILE * 6,
  fireInterval: 0.9,
  damagePerShot: 12,
  patrolRadius: TILE * 6,
  patrolPause: 1.6,
  jumpChance: 0.015,          // per tick while chasing, keeps them from being static
  repathInterval: 0.5
});

let nextBotId = 1000;
export function resetBotIds() { nextBotId = 1000; }

export class Bot {
  constructor({ terrain, collision = null, bus = null, spawn = { x: 0, y: 0, z: 0 }, rng = null }) {
    this.id = nextBotId++;
    this.bus = bus;
    this.rng = rng;
    this.terrain = terrain;

    this.controller = new PlayerController({
      terrainHeightAt: (x, z) => terrain.heightAt(x, z),
      waterDepthAt: (x, z) => terrain.waterDepthAt?.(x, z) ?? 0,
      collision,
      bus,
      id: this.id
    });
    this.controller.teleport(spawn.x, terrain.heightAt(spawn.x, spawn.z), spawn.z);

    this.health = new Health(bus, this.id);
    this.state = BotState.PATROL;
    this.home = { x: spawn.x, z: spawn.z };
    this.target = null;
    this.fireTimer = 0;
    this.pauseTimer = 0;
    this.repathTimer = 0;
    this.destination = { ...this.home };
    this.droppedLoot = false;
  }

  get position() {
    return this.controller.position;
  }

  get alive() {
    return this.health.alive;
  }

  /** A random point within the patrol radius of home. */
  _pickDestination() {
    const angle = this.rng ? this.rng.range(0, Math.PI * 2) : Math.random() * Math.PI * 2;
    const dist = (this.rng ? this.rng.next() : Math.random()) * BOT_CONFIG.patrolRadius;
    this.destination = {
      x: this.home.x + Math.cos(angle) * dist,
      z: this.home.z + Math.sin(angle) * dist
    };
  }

  /** Face a world point and return the local move axis that walks toward it. */
  _steerTo(point) {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.4) return { axis: { x: 0, z: 0 }, distance };

    // Yaw 0 faces -Z, increasing clockwise.
    this.controller.yaw = Math.atan2(-dx, -dz);
    return { axis: { x: 0, z: 1 }, distance };
  }

  takeDamage(amount, meta = {}) {
    if (!this.alive) return { healthLost: 0, died: false };
    const before = this.health.alive;
    const r = this.health.takeDamage(amount, { ...meta, targetId: this.id });
    if (before && !this.health.alive) {
      this.state = BotState.DEAD;
      this.bus?.emit(Events.PLAYER_DIED, { ownerId: this.id, ...meta });
    }
    return r;
  }

  /**
   * @param {number} dt
   * @param {object} ctx { player } the target to hunt
   */
  update(dt, { player = null } = {}) {
    if (!this.alive) {
      this.state = BotState.DEAD;
      return;
    }

    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.repathTimer = Math.max(0, this.repathTimer - dt);
    this.health.update(dt);

    const seen = player && this._canSee(player);
    if (seen) {
      const d = this._distanceTo(player.position);
      this.state = d <= BOT_CONFIG.attackRange ? BotState.ATTACK : BotState.CHASE;
      this.target = player;
    } else if (this.state === BotState.CHASE || this.state === BotState.ATTACK) {
      this.state = BotState.PATROL;
      this.target = null;
    }

    let axis = { x: 0, z: 0 };

    switch (this.state) {
      case BotState.ATTACK: {
        const steer = this._steerTo(this.target.position);
        // Hold position at attack range rather than walking into the player.
        axis = steer.distance > BOT_CONFIG.attackRange * 0.6 ? steer.axis : { x: 0, z: 0 };
        this._tryFire();
        break;
      }
      case BotState.CHASE: {
        axis = this._steerTo(this.target.position).axis;
        const roll = this.rng ? this.rng.next() : Math.random();
        if (roll < BOT_CONFIG.jumpChance) this.controller.requestJump();
        break;
      }
      case BotState.PATROL: {
        if (this.pauseTimer > 0) {
          this.pauseTimer -= dt;
          break;
        }
        const steer = this._steerTo(this.destination);
        if (steer.distance < 1.0) {
          this.pauseTimer = BOT_CONFIG.patrolPause;
          this._pickDestination();
        } else {
          axis = steer.axis;
        }
        break;
      }
      default:
        break;
    }

    this.controller.update(dt, axis, { sprintHeld: this.state === BotState.CHASE });
  }

  _distanceTo(p) {
    return Math.hypot(p.x - this.position.x, p.z - this.position.z);
  }

  _canSee(player) {
    if (!player || player.health?.alive === false) return false;
    return this._distanceTo(player.position) <= BOT_CONFIG.sightRange;
  }

  _tryFire() {
    if (this.fireTimer > 0 || !this.target) return;
    this.fireTimer = BOT_CONFIG.fireInterval;
    this.bus?.emit('bot:fired', {
      botId: this.id,
      damage: BOT_CONFIG.damagePerShot,
      targetId: this.target.id ?? null
    });
  }

  /** §17 — bots drop loot when they die. */
  dropLoot(worldLoot) {
    if (this.droppedLoot || this.alive || !worldLoot) return [];
    this.droppedLoot = true;
    return worldLoot.spawnFloorLoot(this.position, { tier: 'landmark' });
  }

  respawn(spawn = null) {
    const p = spawn ?? this.home;
    this.health.reset();
    this.controller.reset();
    this.controller.teleport(p.x, this.terrain.heightAt(p.x, p.z), p.z);
    this.state = BotState.PATROL;
    this.droppedLoot = false;
    this.target = null;
  }
}

export { MOVEMENT, VITALS };
