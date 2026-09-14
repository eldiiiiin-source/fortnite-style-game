/**
 * MapView.js — BATTLE_ROYALE_SPEC §16.
 *
 * One canvas renderer serving both the minimap and the full map screen: identical data,
 * different zoom and framing. Sharing the draw code means the two can never disagree
 * about where the storm is.
 *
 * Terrain is sampled once into an offscreen image and reused — sampling per frame would
 * cost far more than the whole minimap is worth (§17 forbids per-frame spikes).
 */
import { TILE } from '../../core/Config.js';

const COLOURS = {
  water: '#1d3a52',
  low: '#4a6b43',
  mid: '#6f8f52',
  high: '#94a06a',
  peak: '#b9b48c',
  /* Surface colours — MAP_SPEC §20.5. Deliberately the same set the terrain mesh uses,
     so the map and the world cannot disagree about where the river or the roads are. */
  surfaceGrass: '#57893f',
  surfaceField: '#8ba449',
  surfaceDirt: '#8a7049',
  surfaceSand: '#c2b98a',
  surfaceRock: '#87877f',
  surfaceRoad: '#6a6459',
  safe: 'rgba(255,255,255,0.85)',
  next: 'rgba(69,200,232,0.95)',
  stormFill: 'rgba(150,60,220,0.20)',
  player: '#ffd54a',
  bot: 'rgba(255,110,110,0.9)',
  chest: 'rgba(240,180,41,0.9)'
};

export class MapView {
  /**
   * @param {object} opts
   * @param {object} opts.terrain
   * @param {number} opts.size        canvas pixel size
   * @param {number} opts.worldExtent metres covered when fully zoomed out
   */
  constructor({ terrain, size = 200, worldExtent = TILE * 160 }) {
    this.terrain = terrain;
    this.size = size;
    this.worldExtent = worldExtent;

    this.canvas = document.createElement('canvas');
    this.canvas.width = size * 2;
    this.canvas.height = size * 2;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx = this.canvas.getContext('2d');

    this.terrainImage = null;
    this._buildTerrainImage();
  }

  get element() {
    return this.canvas;
  }

  /** Sample the heightfield once into a small offscreen bitmap. */
  _buildTerrainImage(resolution = 128) {
    const off = document.createElement('canvas');
    off.width = resolution;
    off.height = resolution;
    const ctx = off.getContext('2d');
    const image = ctx.createImageData(resolution, resolution);

    const half = this.worldExtent / 2;
    const step = this.worldExtent / resolution;

    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        const x = -half + i * step;
        const z = -half + j * step;
        const colour = this._groundColour(x, z);
        const o = (j * resolution + i) * 4;
        image.data[o] = colour[0];
        image.data[o + 1] = colour[1];
        image.data[o + 2] = colour[2];
        image.data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.terrainImage = off;
  }

  /**
   * Ground colour for a map pixel.
   *
   * Prefers the terrain's own surface function where it has one, and shades it by height
   * so the relief still reads; falls back to pure height banding for a terrain that does
   * not report surfaces, which keeps the old validation region drawable.
   */
  _groundColour(x, z) {
    const h = this.terrain.heightAt(x, z);
    if (h < 0) return this._parse(COLOURS.water);

    const surface = this.terrain.surfaceAt?.(x, z);
    if (!surface) return this._heightColour(h);

    const key = `surface${surface.charAt(0).toUpperCase()}${surface.slice(1)}`;
    const base = this._parse(COLOURS[key] ?? COLOURS.surfaceGrass);
    // Height shading on top of the surface hue: without it a large flat POI reads as a
    // solid block and the relief disappears from the map.
    const shade = 0.82 + Math.min(1, h / 26) * 0.36;
    return base.map((c) => Math.max(0, Math.min(255, Math.round(c * shade))));
  }

  _parse(c) {
    return [
      parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)
    ];
  }

  _heightColour(h) {
    const parse = (c) => this._parse(c);
    if (h < 0) return parse(COLOURS.water);
    if (h < 4) return parse(COLOURS.low);
    if (h < 12) return parse(COLOURS.mid);
    if (h < 24) return parse(COLOURS.high);
    return parse(COLOURS.peak);
  }

  /**
   * Draw the map.
   *
   * @param {object} view
   * @param {{x:number,z:number}} view.centre  world point at canvas centre
   * @param {number} view.span                 metres across the canvas
   * @param {number} view.yaw                  player facing, radians
   * @param {object} view.storm                storm snapshot
   * @param {Array}  [view.markers]            {x,z,kind} entries
   * @param {boolean} [view.rotate]            rotate the map with the player (minimap)
   */
  draw({ centre, span, yaw = 0, storm = null, markers = [], rotate = false, player = null }) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const scale = w / span;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (rotate) ctx.rotate(yaw);
    ctx.translate(-centre.x * scale, -centre.z * scale);

    // Terrain
    if (this.terrainImage) {
      const half = this.worldExtent / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        this.terrainImage,
        -half * scale, -half * scale,
        this.worldExtent * scale, this.worldExtent * scale
      );
    }

    // Map bounds
    const bound = this.worldExtent / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-bound * scale, -bound * scale, this.worldExtent * scale, this.worldExtent * scale);

    if (storm) this._drawStorm(ctx, storm, scale, bound);

    // Markers
    for (const marker of markers) {
      ctx.fillStyle = marker.kind === 'chest' ? COLOURS.chest : COLOURS.bot;
      ctx.beginPath();
      ctx.arc(marker.x * scale, marker.z * scale, marker.kind === 'chest' ? 3 : 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Player marker, always at canvas centre and always pointing up when rotating.
    if (player !== false) this._drawPlayer(ctx, w / 2, h / 2, rotate ? 0 : -yaw);
  }

  _drawStorm(ctx, storm, scale, bound) {
    // Everything outside the safe circle is storm.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-bound * scale, -bound * scale, bound * 2 * scale, bound * 2 * scale);
    ctx.arc(storm.centre.x * scale, storm.centre.z * scale, Math.max(0, storm.radius * scale), 0, Math.PI * 2, true);
    ctx.fillStyle = COLOURS.stormFill;
    ctx.fill('evenodd');
    ctx.restore();

    // Current safe zone
    ctx.strokeStyle = COLOURS.safe;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(storm.centre.x * scale, storm.centre.z * scale, Math.max(0, storm.radius * scale), 0, Math.PI * 2);
    ctx.stroke();

    // Next zone — dashed, so the two are never confused.
    if (storm.nextRadius > 0 && storm.nextRadius < storm.radius) {
      ctx.strokeStyle = COLOURS.next;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.arc(storm.nextCentre.x * scale, storm.nextCentre.z * scale, storm.nextRadius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _drawPlayer(ctx, x, y, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = COLOURS.player;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 8);
    ctx.lineTo(0, 4.5);
    ctx.lineTo(-6.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
