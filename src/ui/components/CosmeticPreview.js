/**
 * CosmeticPreview.js — ITEM_SHOP_SPEC §7, ADMIN_PANEL_SPEC §12.1.
 *
 * Canvas previews for every cosmetic category. Real art does not exist yet, so each
 * cosmetic is drawn procedurally from its catalog palette — the spec explicitly allows
 * placeholder visuals provided the system is wired correctly (§9.2).
 *
 * Every cosmetic gets a DISTINCT, STABLE silhouette derived from its id, so the preview,
 * the shop card and the lobby all show recognisably the same thing, and swapping in real
 * assets later means replacing the draw function, not the wiring.
 *
 * Previewing never touches ownership (§12.1) — this module only reads.
 */
import { CosmeticCategory } from '../../meta/CosmeticCatalog.js';
import { hashString } from '../../core/Random.js';
import { RARITIES, RARITY_ORDER } from '../../core/Config.js';
import { buildCharacterRig } from '../../cosmetics/CharacterRig.js';
import { getSkin } from '../../cosmetics/SkinDefinitions.js';
import { paintCharacter } from './CharacterPainter.js';

/** Deterministic 0..1 from a cosmetic id and a salt. */
function seeded(id, salt) {
  return (hashString(`${id}:${salt}`) % 1000) / 1000;
}

/** `#rrggbb` plus an alpha, as an rgba() string. */
function withAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** A rotating preview canvas for one cosmetic. */
export class CosmeticPreview {
  /**
   * @param {object} [opts]
   * @param {number} [opts.size]
   * @param {boolean} [opts.animated] whether it slowly rotates (§7)
   */
  constructor({ size = 240, animated = true } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size * 2;          // drawn at 2x for crispness
    this.canvas.height = size * 2;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx = this.canvas.getContext('2d');
    this.size = size;
    this.animated = animated;
    /**
     * Card thumbnails get the rarity wash and pedestal but not the rays, shimmer or
     * motes: at 130px those read as noise over the item rather than as presentation.
     */
    this.compact = size < 160;
    this.cosmetic = null;
    this.angle = 0;
    this._raf = null;
  }

  get element() {
    return this.canvas;
  }

  show(cosmetic) {
    this.cosmetic = cosmetic;
    this.angle = 0;
    this.draw();
    if (this.animated) this.start();
  }

  start() {
    if (this._raf !== null || !this.animated) return;
    const tick = () => {
      this.angle += 0.012;
      this.draw();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  destroy() {
    this.stop();
    this.canvas.remove();
  }

  draw() {
    const { ctx, canvas, cosmetic } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!cosmetic) return;

    const [dark, light] = cosmetic.preview?.palette ?? ['#6b7280', '#cbd5e1'];

    // Rarity presentation is the backdrop, never the item itself (SKIN_SPEC §8).
    this._drawRarityBackdrop(ctx, w, h, cosmetic.rarity);

    // Outfits are characters: painted from the shared rig, which is the same part list the
    // in-match renderer builds meshes from (SKIN_SPEC §3.1).
    const skin = cosmetic.category === CosmeticCategory.OUTFIT ? getSkin(cosmetic.id) : null;
    if (skin) {
      paintCharacter(ctx, this._rigFor(skin), {
        width: w, height: h, yaw: Math.sin(this.angle) * 0.55
      });
      return;
    }

    // Ground shadow, so the shape reads as an object rather than a sticker.
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.84, w * 0.22, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(w / 2, h / 2);
    // A gentle yaw sway rather than a full spin: readable at every angle.
    const sway = Math.sin(this.angle) * 0.35;
    ctx.transform(Math.cos(sway), 0, 0, 1, 0, 0);

    const s = w * 0.5;
    switch (cosmetic.category) {
      case CosmeticCategory.OUTFIT: this._drawOutfit(ctx, s, dark, light, cosmetic.id); break;
      case CosmeticCategory.PICKAXE: this._drawPickaxe(ctx, s, dark, light, cosmetic.id); break;
      case CosmeticCategory.GLIDER: this._drawGlider(ctx, s, dark, light, cosmetic.id); break;
      case CosmeticCategory.BACK_ACCESSORY: this._drawBack(ctx, s, dark, light, cosmetic.id); break;
      case CosmeticCategory.WRAP: this._drawWrap(ctx, s, dark, light, cosmetic.id); break;
      case CosmeticCategory.EMOTE: this._drawEmote(ctx, s, dark, light, cosmetic.id); break;
      default: this._drawOutfit(ctx, s, dark, light, cosmetic.id);
    }
    ctx.restore();
  }

  /** Rigs are deterministic and reused across frames — build each one once. */
  _rigFor(skin) {
    if (this._rig?.skin?.id !== skin.id) this._rig = buildCharacterRig(skin);
    return this._rig;
  }

  /**
   * Rarity backdrop — SKIN_SPEC §8. Tiers add layers rather than swapping treatments, so
   * the ladder reads as a ladder. The item itself is never tinted: rarity must not change
   * what a cosmetic looks like, only how it is presented.
   */
  _drawRarityBackdrop(ctx, w, h, rarity) {
    const tier = Math.max(0, RARITY_ORDER.indexOf(rarity));
    const colour = RARITIES[rarity]?.color ?? RARITIES.common.color;
    const hex = `#${colour.toString(16).padStart(6, '0')}`;
    const cx = w / 2;
    const cy = h * 0.52;

    ctx.save();
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.62);
    wash.addColorStop(0, withAlpha(hex, tier === 0 ? 0.10 : 0.14 + tier * 0.06));
    wash.addColorStop(0.62, withAlpha(hex, tier === 0 ? 0.03 : 0.05));
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    // Rare and up: a horizon band behind the figure's feet.
    if (tier >= 2 && !this.compact) {
      const band = ctx.createLinearGradient(0, h * 0.62, 0, h * 0.92);
      band.addColorStop(0, 'rgba(0,0,0,0)');
      band.addColorStop(0.55, withAlpha(hex, 0.16));
      band.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, h * 0.62, w, h * 0.3);
    }

    // Epic and up: rays from behind the figure.
    if (tier >= 3 && !this.compact) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = hex;
      const rays = 12;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 + this.angle * 0.12;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a - 0.05) * w * 0.7, Math.sin(a - 0.05) * w * 0.7);
        ctx.lineTo(Math.cos(a + 0.05) * w * 0.7, Math.sin(a + 0.05) * w * 0.7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Pedestal: a plain disc, ringed once at rare and twice at legendary.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = withAlpha(hex, 0.5);
    ctx.lineWidth = Math.max(1, w * 0.004);
    const rings = tier >= 4 ? 2 : tier >= 2 ? 1 : 0;
    ctx.fillStyle = withAlpha(hex, 0.12);
    ctx.beginPath();
    ctx.ellipse(cx, h * 0.9, w * 0.26, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < rings; i++) {
      ctx.beginPath();
      ctx.ellipse(cx, h * 0.9, w * (0.3 + i * 0.05), h * (0.04 + i * 0.007), 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Epic and up: a slow shimmer sweep across the backdrop.
    if (tier >= 3 && !this.compact) {
      const sweep = ((this.angle * 0.18) % 2) - 0.5;
      const shimmer = ctx.createLinearGradient(w * sweep, 0, w * (sweep + 0.45), h);
      shimmer.addColorStop(0, 'rgba(255,255,255,0)');
      shimmer.addColorStop(0.5, 'rgba(255,255,255,0.055)');
      shimmer.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = shimmer;
      ctx.fillRect(0, 0, w, h);
    }

    // A dark pool where the figure stands. Without it a skin whose palette matches its
    // rarity hue — a purple epic, a gold legendary — loses its edges against its own
    // backdrop, which is the one thing the backdrop must never do.
    const pool = ctx.createRadialGradient(cx, h * 0.55, 0, cx, h * 0.55, w * 0.46);
    pool.addColorStop(0, 'rgba(10,13,19,0.72)');
    pool.addColorStop(0.7, 'rgba(10,13,19,0.34)');
    pool.addColorStop(1, 'rgba(10,13,19,0)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, w, h);

    // Legendary: drifting motes, the only tier that gets them.
    if (tier >= 4 && !this.compact) {
      ctx.fillStyle = withAlpha(hex, 0.55);
      for (let i = 0; i < 9; i++) {
        const t = this.angle * 0.5 + i;
        const mx = cx + Math.sin(t * 0.7 + i) * w * 0.34;
        const my = h * 0.88 - ((t * 0.05 + i * 0.11) % 1) * h * 0.74;
        const r = w * (0.004 + (i % 3) * 0.002);
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** A stylised figure. Proportions vary per id so outfits are distinguishable. */
  _drawOutfit(ctx, s, dark, light, id) {
    const bulk = 0.8 + seeded(id, 'bulk') * 0.45;
    const headR = s * 0.15;

    const grad = ctx.createLinearGradient(0, -s * 0.6, 0, s * 0.7);
    grad.addColorStop(0, light);
    grad.addColorStop(1, dark);

    // Legs
    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.20 * bulk, s * 0.10, s * 0.15 * bulk, s * 0.55);
    ctx.fillRect(s * 0.05 * bulk, s * 0.10, s * 0.15 * bulk, s * 0.55);

    // Torso
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-s * 0.30 * bulk, -s * 0.30);
    ctx.lineTo(s * 0.30 * bulk, -s * 0.30);
    ctx.lineTo(s * 0.24 * bulk, s * 0.14);
    ctx.lineTo(-s * 0.24 * bulk, s * 0.14);
    ctx.closePath();
    ctx.fill();

    // Arms
    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.42 * bulk, -s * 0.26, s * 0.12 * bulk, s * 0.42);
    ctx.fillRect(s * 0.30 * bulk, -s * 0.26, s * 0.12 * bulk, s * 0.42);

    // Head
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(0, -s * 0.46, headR, 0, Math.PI * 2);
    ctx.fill();

    // A per-outfit chest marking, so two same-palette outfits still differ.
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.55;
    const mark = Math.floor(seeded(id, 'mark') * 3);
    if (mark === 0) ctx.fillRect(-s * 0.06, -s * 0.22, s * 0.12, s * 0.3);
    else if (mark === 1) {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.24); ctx.lineTo(s * 0.13, s * 0.02); ctx.lineTo(-s * 0.13, s * 0.02);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(0, -s * 0.08, s * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawPickaxe(ctx, s, dark, light, id) {
    const headStyle = Math.floor(seeded(id, 'head') * 3);
    ctx.save();
    ctx.rotate(-0.42);

    // Haft
    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.045, -s * 0.16, s * 0.09, s * 0.86);
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(-s * 0.045, -s * 0.16, s * 0.03, s * 0.86);
    ctx.globalAlpha = 1;

    // Head
    ctx.fillStyle = light;
    ctx.beginPath();
    if (headStyle === 0) {
      ctx.moveTo(-s * 0.42, -s * 0.30); ctx.quadraticCurveTo(0, -s * 0.46, s * 0.42, -s * 0.30);
      ctx.lineTo(s * 0.30, -s * 0.12); ctx.quadraticCurveTo(0, -s * 0.26, -s * 0.30, -s * 0.12);
    } else if (headStyle === 1) {
      ctx.moveTo(-s * 0.40, -s * 0.34); ctx.lineTo(s * 0.10, -s * 0.40);
      ctx.lineTo(s * 0.06, -s * 0.12); ctx.lineTo(-s * 0.30, -s * 0.10);
    } else {
      ctx.moveTo(-s * 0.34, -s * 0.38); ctx.lineTo(s * 0.34, -s * 0.38);
      ctx.lineTo(s * 0.12, -s * 0.10); ctx.lineTo(-s * 0.12, -s * 0.10);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawGlider(ctx, s, dark, light, id) {
    const panels = 3 + Math.floor(seeded(id, 'panels') * 3);
    const span = s * 0.86;

    const grad = ctx.createLinearGradient(-span, 0, span, 0);
    grad.addColorStop(0, dark);
    grad.addColorStop(0.5, light);
    grad.addColorStop(1, dark);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-span, -s * 0.12);
    ctx.quadraticCurveTo(0, -s * 0.52, span, -s * 0.12);
    ctx.quadraticCurveTo(0, s * 0.10, -span, -s * 0.12);
    ctx.closePath();
    ctx.fill();

    // Panel seams
    ctx.strokeStyle = 'rgba(0,0,0,.32)';
    ctx.lineWidth = s * 0.012;
    for (let i = 1; i < panels; i++) {
      const x = -span + (span * 2 * i) / panels;
      ctx.beginPath();
      ctx.moveTo(x, -s * 0.36 + Math.abs(x) * 0.22);
      ctx.lineTo(x, -s * 0.06);
      ctx.stroke();
    }

    // Rigging down to a harness
    ctx.strokeStyle = dark;
    ctx.lineWidth = s * 0.02;
    for (const x of [-span * 0.62, 0, span * 0.62]) {
      ctx.beginPath();
      ctx.moveTo(x, -s * 0.08);
      ctx.lineTo(0, s * 0.42);
      ctx.stroke();
    }
    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.1, s * 0.42, s * 0.2, s * 0.1);
  }

  _drawBack(ctx, s, dark, light, id) {
    const style = Math.floor(seeded(id, 'back') * 3);
    ctx.fillStyle = dark;

    if (style === 0) {            // pack
      ctx.beginPath();
      ctx.roundRect(-s * 0.3, -s * 0.36, s * 0.6, s * 0.72, s * 0.07);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.fillRect(-s * 0.3, -s * 0.06, s * 0.6, s * 0.1);
      ctx.fillRect(-s * 0.14, -s * 0.36, s * 0.28, s * 0.16);
    } else if (style === 1) {     // canister
      ctx.beginPath();
      ctx.roundRect(-s * 0.2, -s * 0.42, s * 0.4, s * 0.84, s * 0.2);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.arc(0, -s * 0.18, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
    } else {                      // crest / wing
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.46);
      ctx.quadraticCurveTo(s * 0.44, -s * 0.06, 0, s * 0.44);
      ctx.quadraticCurveTo(-s * 0.44, -s * 0.06, 0, -s * 0.46);
      ctx.fill();
      ctx.fillStyle = light;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.34);
      ctx.quadraticCurveTo(s * 0.26, -s * 0.04, 0, s * 0.3);
      ctx.quadraticCurveTo(-s * 0.26, -s * 0.04, 0, -s * 0.34);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** §4.4 — a wrap previews ON a sample weapon. */
  _drawWrap(ctx, s, dark, light, id) {
    const pattern = Math.floor(seeded(id, 'pattern') * 3);

    // Sample weapon silhouette.
    ctx.fillStyle = '#20262f';
    ctx.fillRect(-s * 0.62, -s * 0.08, s * 1.18, s * 0.2);
    ctx.fillRect(-s * 0.3, s * 0.12, s * 0.14, s * 0.3);
    ctx.fillRect(-s * 0.62, -s * 0.2, s * 0.26, s * 0.14);

    // The wrap itself, clipped to the weapon body.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-s * 0.62, -s * 0.08, s * 1.18, s * 0.2);
    ctx.clip();

    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.62, -s * 0.08, s * 1.18, s * 0.2);
    ctx.fillStyle = light;
    if (pattern === 0) {
      for (let i = 0; i < 9; i++) ctx.fillRect(-s * 0.62 + i * s * 0.14, -s * 0.08, s * 0.06, s * 0.2);
    } else if (pattern === 1) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.62, s * 0.12);
      ctx.lineTo(s * 0.56, -s * 0.08);
      ctx.lineTo(s * 0.56, s * 0.12);
      ctx.closePath();
      ctx.fill();
    } else {
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(-s * 0.5 + i * s * 0.2, s * 0.02, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** An emote previews as a pose (§7 — animation where available). */
  _drawEmote(ctx, s, dark, light, id) {
    const pose = Math.floor(seeded(id, 'pose') * 4);
    const t = Math.sin(this.angle * 3) * 0.5 + 0.5;

    ctx.fillStyle = dark;
    ctx.fillRect(-s * 0.16, s * 0.06, s * 0.12, s * 0.5);
    ctx.fillRect(s * 0.04, s * 0.06, s * 0.12, s * 0.5);

    ctx.fillStyle = light;
    ctx.fillRect(-s * 0.22, -s * 0.28, s * 0.44, s * 0.38);
    ctx.beginPath();
    ctx.arc(0, -s * 0.42, s * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // Arms move with the pose, so emotes read as motion rather than a static figure.
    ctx.strokeStyle = light;
    ctx.lineWidth = s * 0.1;
    ctx.lineCap = 'round';
    const armY = -s * 0.2;
    ctx.beginPath();
    if (pose === 0) {                                  // wave
      ctx.moveTo(-s * 0.22, armY); ctx.lineTo(-s * 0.4, armY + s * 0.16);
      ctx.moveTo(s * 0.22, armY); ctx.lineTo(s * 0.42, armY - s * 0.2 - t * s * 0.08);
    } else if (pose === 1) {                           // both up
      ctx.moveTo(-s * 0.22, armY); ctx.lineTo(-s * 0.4, armY - s * 0.22 - t * s * 0.06);
      ctx.moveTo(s * 0.22, armY); ctx.lineTo(s * 0.4, armY - s * 0.22 - t * s * 0.06);
    } else if (pose === 2) {                           // flex
      ctx.moveTo(-s * 0.22, armY); ctx.lineTo(-s * 0.38, armY + s * 0.06);
      ctx.lineTo(-s * 0.3, armY - s * 0.18);
      ctx.moveTo(s * 0.22, armY); ctx.lineTo(s * 0.38, armY + s * 0.06);
      ctx.lineTo(s * 0.3, armY - s * 0.18);
    } else {                                           // point up
      ctx.moveTo(-s * 0.22, armY); ctx.lineTo(-s * 0.36, armY + s * 0.2);
      ctx.moveTo(s * 0.22, armY); ctx.lineTo(s * 0.3, armY - s * 0.3 - t * s * 0.05);
    }
    ctx.stroke();
  }
}

/**
 * A small static thumbnail, for cards and equipped-slot rows. Cheaper than a live
 * preview: drawn once, never animated.
 */
export function cosmeticThumbnail(cosmetic, size = 96) {
  const preview = new CosmeticPreview({ size, animated: false });
  preview.show(cosmetic);
  return preview.element;
}
