/**
 * SupportSystem.js — live structural integrity. MASTER_SPEC §6.5.
 *
 * `StructureGraph.computeSupported` answers "what is standing?" by flooding the whole world
 * from the ground up. That is the right answer and the wrong shape to run every frame: the
 * island alone is over nine hundred pieces before a player builds anything.
 *
 * This runs the same rules over a DIRTY REGION instead. Support can only change where the
 * grid changed, so a piece being placed, edited or destroyed seeds a local re-evaluation and
 * everything else keeps the status it already had. With nothing dirty the per-frame cost is
 * a timer tick over the handful of pieces currently falling — usually zero.
 *
 * The locality is not an approximation. Every lookup in `supportersOf` is inside the piece's
 * own cell, the cell below, or an orthogonal neighbour, so the set of pieces that can name a
 * given piece as a supporter is bounded to a 5-cell footprint across two layers. Inverting
 * that exactly is what makes the region-based answer identical to the global one.
 */
import { BUILD } from '../core/Config.js';
import { neighbourCell } from './BuildGrid.js';
import { computeSupported, supportersOf, touchesTerrain } from './StructureGraph.js';

/** Cells that may hold a piece listing a piece at `cell` as one of its supporters. */
function dependentCells(cell) {
  const out = [cell, { ...cell, cy: cell.cy + 1 }];
  for (const dir of ['north', 'east', 'south', 'west']) {
    const n = neighbourCell(cell, dir);
    out.push(n, { ...n, cy: cell.cy + 1 });
  }
  return out;
}

/**
 * The pieces that rest on `piece` — the inverse of `supportersOf`, computed locally.
 *
 * For a piece still in the grid this is exact: ask each neighbour what holds it up and keep
 * the ones that name this piece.
 *
 * For a piece that has just been REMOVED the relation no longer reports it — that is the
 * whole point of removing it — so nothing would name it and the region would come back
 * empty. There, every piece in the footprint is a candidate instead. That is a superset,
 * which is safe: the region is only a bound on what to re-derive, and support inside it is
 * recomputed from scratch either way.
 */
export function dependentsOf(piece, grid) {
  const out = [];
  const gone = !grid.has(piece);
  for (const cell of dependentCells(piece.cell)) {
    for (const other of grid.piecesInCell(cell.cx, cell.cy, cell.cz)) {
      if (other === piece || other.destroyed) continue;
      if (gone || supportersOf(other, grid).includes(piece)) out.push(other);
    }
  }
  return out;
}

export class SupportSystem {
  /**
   * @param {object} opts
   * @param {import('./BuildGrid.js').BuildGrid} opts.grid
   * @param {(cx:number, cz:number) => number} [opts.terrainHeightAt]
   * @param {(piece:object) => void} [opts.onCollapse]  called as each piece falls
   */
  constructor({ grid, terrainHeightAt = null, onCollapse = null }) {
    this.grid = grid;
    this.terrainHeightAt = terrainHeightAt;
    this.onCollapse = onCollapse;

    /** Pieces whose support must be re-evaluated on the next update. */
    this.pending = new Set();
    /** Pieces currently standing on nothing, counting down their grace period. */
    this.falling = new Set();

    /** Instrumentation, so the cost of this is measurable rather than assumed. */
    this.stats = { updates: 0, totalMs: 0, worstMs: 0, worstRegion: 0, lastRegion: 0 };
  }

  /**
   * Establish the baseline. One global pass, at match start only — every later answer is
   * incremental from here.
   */
  seed() {
    const supported = computeSupported(this.grid, this.terrainHeightAt);
    for (const piece of this.grid) {
      piece.supported = supported.has(piece.id);
      piece.unsupportedFor = null;
      if (!piece.destroyed && !piece.supported) this.falling.add(piece);
    }
    this.pending.clear();
    return this.falling.size;
  }

  /**
   * Note that a piece changed. Placement and destruction both land here; an edit does too,
   * though a pattern alone never moves the support graph (see `markEdited`).
   */
  markDirty(piece) {
    if (piece) this.pending.add(piece);
  }

  /**
   * An edit changed a piece's pattern.
   *
   * Patterns do NOT participate in support: `supportersOf` asks what a piece IS and where,
   * never which tiles survive, so a wall cut down to a half wall still carries what rests on
   * it. Deleting a piece by edit is a removal and comes through `markDirty` instead. This
   * exists so the call site can say what happened without the system guessing.
   */
  markEdited(piece) {
    void piece;
  }

  /** Re-evaluate everything the pending changes could have affected, then tick the fallers. */
  update(dt) {
    const hadWork = this.pending.size > 0 || this.falling.size > 0;
    const t0 = hadWork ? now() : 0;

    const region = this.pending.size > 0 ? this._resolvePending() : 0;
    const collapsed = this._tickFalling(dt);

    // Timed only on frames that did something. Averaging in the idle frames — which is most
    // of them — would report a number that flatters the system and hides the spikes.
    if (hadWork) {
      const ms = now() - t0;
      this.stats.updates++;
      this.stats.totalMs += ms;
      this.stats.worstMs = Math.max(this.stats.worstMs, ms);
      this.stats.worstRegion = Math.max(this.stats.worstRegion, region);
      this.stats.lastRegion = region;
    }
    return collapsed;
  }

  /**
   * Recompute support across the region the pending changes could reach.
   *
   * The region is everything transitively resting on a changed piece — the only pieces whose
   * answer can differ. Inside it, support is re-derived from scratch: a piece is supported if
   * it reaches terrain, or rests on something outside the region that is already standing, or
   * rests on something inside the region already proven to stand.
   *
   * @returns {number} how many pieces were examined
   */
  _resolvePending() {
    // The region walk and the support flood ask for the same dependents, and answering costs
    // a `supportersOf` call per neighbour. Memoised for the life of one resolve; the grid
    // does not change underneath it.
    const cache = new Map();
    const dependents = (piece) => {
      let found = cache.get(piece);
      if (!found) { found = dependentsOf(piece, this.grid); cache.set(piece, found); }
      return found;
    };

    const region = new Set();
    const stack = [];
    for (const piece of this.pending) {
      // The changed piece itself may now be supported (placed) or gone (destroyed); either
      // way its dependents are what can change, and a live piece is part of its own region.
      if (!piece.destroyed && this.grid.has(piece) && !region.has(piece)) {
        region.add(piece);
        stack.push(piece);
      }
      for (const dep of dependents(piece)) {
        if (!region.has(dep)) { region.add(dep); stack.push(dep); }
      }
    }
    this.pending.clear();

    while (stack.length > 0) {
      for (const dep of dependents(stack.pop())) {
        if (!region.has(dep)) { region.add(dep); stack.push(dep); }
      }
    }

    // Flood support through the region from whatever still reaches the ground.
    const standing = new Set();
    const queue = [];
    for (const piece of region) {
      const grounded = touchesTerrain(piece, this.terrainHeightAt)
        || supportersOf(piece, this.grid).some((s) => !region.has(s) && s.supported);
      if (grounded) { standing.add(piece); queue.push(piece); }
    }
    while (queue.length > 0) {
      for (const dep of dependents(queue.pop())) {
        if (region.has(dep) && !standing.has(dep)) { standing.add(dep); queue.push(dep); }
      }
    }

    for (const piece of region) {
      const supported = standing.has(piece);
      piece.supported = supported;
      if (supported) {
        piece.unsupportedFor = null;
        this.falling.delete(piece);
      } else {
        this.falling.add(piece);
      }
    }
    return region.size;
  }

  /** Age the grace period on unsupported pieces and drop the ones that run out. */
  _tickFalling(dt) {
    if (this.falling.size === 0) return [];
    const collapsed = [];
    for (const piece of [...this.falling]) {
      if (piece.destroyed) { this.falling.delete(piece); continue; }
      piece.unsupportedFor = (piece.unsupportedFor ?? 0) + dt;
      if (piece.unsupportedFor >= BUILD.supportGraceTime) collapsed.push(piece);
    }
    for (const piece of collapsed) {
      this.falling.delete(piece);
      piece.destroyed = true;
      this.grid.remove(piece);
      // Whatever was resting on it is now in question — the cascade continues from here.
      this.markDirty(piece);
      this.onCollapse?.(piece);
    }
    return collapsed;
  }

  /** Average milliseconds per update that actually had work to do. */
  get averageMs() {
    return this.stats.updates > 0 ? this.stats.totalMs / this.stats.updates : 0;
  }
}


const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
