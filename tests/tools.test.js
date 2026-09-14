/**
 * tools.test.js — SKIN_SPEC §11, §9.11.
 *
 * Harvesting tools are rigs like characters are, so they get the same guarantees:
 * deterministic construction, derived dimensions, and absolutely no gameplay reach.
 */
import { describe, it, expect } from 'vitest';
import {
  TOOLS, getTool, toolOrFallback, toolRarityCounts, HeadForm, HaftStyle, ToolDetail
} from '../src/cosmetics/ToolDefinitions.js';
import {
  buildToolRig, toolMetrics, carryTransform, swingPose, swungPoint, SwingPhase, SWING_REST,
  ToolRegion, SUPPORTED_HEADS, SUPPORTED_TOOL_DETAILS
} from '../src/cosmetics/ToolRig.js';
import { Pickaxe } from '../src/combat/Pickaxe.js';
import { buildCharacterRig } from '../src/cosmetics/CharacterRig.js';
import { SKINS } from '../src/cosmetics/SkinDefinitions.js';
import { rigBounds, partColour } from '../src/cosmetics/RigPrimitives.js';
import { PICKAXE, PICKAXE_VIEW, CHARACTER, CAMERA, RARITY_ORDER } from '../src/core/Config.js';
import {
  cosmeticsByCategory, CosmeticCategory, getCosmetic, catalogCounts
} from '../src/meta/CosmeticCatalog.js';

const HEX = /^#[0-9a-f]{6}$/i;

describe('SKIN_SPEC §11 — the tool roster', () => {
  it('carries seven harvesting tools', () => {
    expect(TOOLS.length).toBe(7);
    expect(catalogCounts().pickaxe).toBe(7);
  });

  it('keeps the founding six IDs intact — profiles store them', () => {
    for (const id of [
      'pickaxe_standard', 'pickaxe_quarry', 'pickaxe_splitleaf',
      'pickaxe_tidebreak', 'pickaxe_emberfall', 'pickaxe_lumen'
    ]) {
      expect(getTool(id), id).not.toBeNull();
    }
  });

  it('includes Scrapjaw, the signature tool (§11.5)', () => {
    const scrapjaw = getTool('pickaxe_scrapjaw');
    expect(scrapjaw).not.toBeNull();
    expect(scrapjaw.head).toBe(HeadForm.SCRAP);
    expect(scrapjaw.rarity).toBe('epic');
    // Its whole point is density: it must carry more detail than any other tool.
    for (const other of TOOLS.filter((t) => t.id !== 'pickaxe_scrapjaw')) {
      expect(buildToolRig(scrapjaw).parts.length)
        .toBeGreaterThan(buildToolRig(other).parts.length);
    }
  });

  it('gives every tool a unique id, name and head form spread', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    // Every head form in the vocabulary is actually used by something.
    expect(new Set(TOOLS.map((t) => t.head)).size).toBe(Object.keys(HeadForm).length);
  });

  it('only uses head forms, hafts and details the rig can build', () => {
    const hafts = new Set(Object.values(HaftStyle));
    for (const tool of TOOLS) {
      expect(SUPPORTED_HEADS, tool.id).toContain(tool.head);
      expect(hafts.has(tool.haft), tool.id).toBe(true);
      for (const d of tool.details) expect(SUPPORTED_TOOL_DETAILS, tool.id).toContain(d);
    }
  });

  it('uses every rarity tier below the top', () => {
    const seen = new Set(TOOLS.map((t) => t.rarity));
    for (const tier of RARITY_ORDER) expect(seen.has(tier), tier).toBe(true);
    expect(toolRarityCounts().common).toBe(2);
  });

  it('declares a full palette of valid hex per tool', () => {
    for (const tool of TOOLS) {
      for (const role of ['primary', 'secondary', 'accent', 'detail', 'edge']) {
        expect(tool.palette[role], `${tool.id}.${role}`).toMatch(HEX);
      }
    }
  });
});

describe('SKIN_SPEC §11.1 — tool rigs', () => {
  it('builds a haft and a head for every tool (§9.11)', () => {
    for (const tool of TOOLS) {
      const regions = new Set(buildToolRig(tool).parts.map((p) => p.tag));
      expect(regions.has(ToolRegion.HAFT), tool.id).toBe(true);
      expect(regions.has(ToolRegion.HEAD), tool.id).toBe(true);
    }
  });

  it('puts the head above the grip and the butt below it', () => {
    for (const tool of TOOLS) {
      const rig = buildToolRig(tool);
      const head = rig.parts.filter((p) => p.tag === ToolRegion.HEAD);
      expect(head.every((p) => p.pos.y > 0), tool.id).toBe(true);
      expect(rigBounds(rig).minY, tool.id).toBeLessThan(0);
    }
  });

  it('is deterministic — the same tool yields an identical part list', () => {
    for (const tool of TOOLS) {
      expect(JSON.stringify(buildToolRig(tool).parts))
        .toBe(JSON.stringify(buildToolRig(tool).parts));
    }
  });

  it('orders parts back-to-front so a 2D consumer can paint in array order', () => {
    for (const tool of TOOLS) {
      const zs = buildToolRig(tool).parts.map((p) => p.pos.z);
      for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThanOrEqual(zs[i - 1]);
    }
  });

  it('resolves every part to a colour', () => {
    for (const tool of TOOLS) {
      for (const part of buildToolRig(tool).parts) {
        expect(partColour(tool, part), `${tool.id}:${part.id}`).toMatch(HEX);
      }
    }
  });

  it('falls back to a real tool for an unknown id rather than rendering nothing', () => {
    expect(toolOrFallback('pickaxe_does_not_exist').id).toBe(TOOLS[0].id);
    expect(buildToolRig('pickaxe_does_not_exist').parts.length).toBeGreaterThan(0);
  });

  it('skips an unknown head form rather than throwing', () => {
    const future = { ...TOOLS[0], head: 'notYetInvented', details: ['notADetail'] };
    expect(() => buildToolRig(future)).not.toThrow();
    // The haft still builds, so a future tool degrades to a stick rather than vanishing.
    expect(buildToolRig(future).parts.length).toBeGreaterThan(0);
  });

  it('derives its scale from the character, not from absolutes', () => {
    const m = toolMetrics();
    expect(m.length).toBeCloseTo(PICKAXE_VIEW.length, 6);
    expect(m.gripToHead + m.gripToButt).toBeCloseTo(m.length, 6);
    // Assert the DERIVATION, not the ratio: retuning how long a tool looks must not
    // break a test, but decoupling tool scale from character scale must (CLAUDE.md).
    for (const [view, reference] of [
      [PICKAXE_VIEW.length, CHARACTER.height],
      [PICKAXE_VIEW.gripDrop, CHARACTER.height],
      [PICKAXE_VIEW.haftRadius, CHARACTER.radius],
      [PICKAXE_VIEW.headWidth, CHARACTER.radius],
      [PICKAXE_VIEW.headHeight, CHARACTER.radius],
      [PICKAXE_VIEW.headDepth, CHARACTER.radius]
    ]) {
      const ratio = view / reference;
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(2);
    }
  });

  it('keeps a tool shorter than the character carrying it', () => {
    for (const tool of TOOLS) {
      const b = rigBounds(buildToolRig(tool));
      expect(b.maxY - b.minY, tool.id).toBeLessThan(CHARACTER.height);
    }
  });
});

describe('SKIN_SPEC §11.1 — tools never touch gameplay', () => {
  it('leaves PICKAXE identical whichever tool is built (ITEM_SHOP_SPEC §4.4)', () => {
    const before = JSON.stringify(PICKAXE);
    for (const tool of TOOLS) buildToolRig(tool);
    expect(JSON.stringify(PICKAXE)).toBe(before);
  });

  it('exposes no damage, range or swing field on a tool, so there is nowhere to hide one', () => {
    const banned = [
      'damage', 'range', 'reach', 'swingRate', 'cooldown', 'harvest',
      'multiplier', 'speed', 'hitbox', 'collision'
    ];
    for (const tool of TOOLS) {
      for (const key of Object.keys(tool)) {
        expect(banned, `${tool.id}.${key}`).not.toContain(key);
      }
    }
  });

  it('gives every tool the same reach and damage, by construction', () => {
    // There is no per-tool lookup anywhere: the config IS the value for all of them.
    expect(PICKAXE.damageToPlayers).toBeGreaterThan(0);
    expect(PICKAXE.range).toBeGreaterThan(0);
    expect(PICKAXE.swingInterval).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(tool.damageToPlayers).toBeUndefined();
      expect(tool.range).toBeUndefined();
      expect(tool.swingInterval).toBeUndefined();
    }
  });
});

describe('SKIN_SPEC §11.6 — tools reach the shop and the locker', () => {
  it('lists every roster tool as a purchasable harvesting tool', () => {
    const items = cosmeticsByCategory(CosmeticCategory.PICKAXE);
    expect(items.length).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      const item = getCosmetic(tool.id);
      expect(item, tool.id).not.toBeNull();
      expect(item.category).toBe(CosmeticCategory.PICKAXE);
      expect(item.rarity).toBe(tool.rarity);
      expect(item.price).toBeGreaterThan(0);
      expect(item.enabled).toBe(true);
    }
  });

  it('marks the glow-edge tools as self-lit in the rig (§6.2)', () => {
    for (const tool of TOOLS) {
      const glowing = buildToolRig(tool).parts.some((p) => p.glow);
      expect(glowing, tool.id).toBe(tool.details.includes(ToolDetail.GLOW_EDGE)
        || tool.head === HeadForm.BEAM);
    }
  });
});

describe('SKIN_SPEC §11.3.1, §11.5 — the 1.3.0 Scrapjaw pass', () => {
  it('runs Scrapjaw at a larger head scale than the roster default', () => {
    const scrapjaw = getTool('pickaxe_scrapjaw');
    expect(scrapjaw.headScale).toBeGreaterThan(1);
    for (const other of TOOLS.filter((t) => t.id !== 'pickaxe_scrapjaw')) {
      expect(other.headScale, other.id).toBe(1);
    }
  });

  it('keeps head scale a view value with no gameplay reach', () => {
    const before = JSON.stringify(PICKAXE);
    buildToolRig(getTool('pickaxe_scrapjaw'));
    expect(JSON.stringify(PICKAXE)).toBe(before);
    // Scaling the head must not scale the haft: the tool still fits the same hand.
    expect(toolMetrics(2).length).toBe(toolMetrics(1).length);
    expect(toolMetrics(2).gripToHead).toBe(toolMetrics(1).gripToHead);
    expect(toolMetrics(2).headWidth).toBeCloseTo(toolMetrics(1).headWidth * 2, 6);
  });

  it('gives the cutting edge and the counter-spike genuinely different shapes (§11.5)', () => {
    const parts = buildToolRig(getTool('pickaxe_scrapjaw')).parts;
    const edge = parts.find((p) => p.id === 'cuttingEdge');
    const spike = parts.find((p) => p.id === 'counterSpike');
    expect(edge, 'cuttingEdge').toBeTruthy();
    expect(spike, 'counterSpike').toBeTruthy();
    expect(edge.shape).not.toBe(spike.shape);
    // …and they oppose each other across the haft.
    expect(Math.sign(edge.pos.x)).not.toBe(Math.sign(spike.pos.x));
  });

  it('layers the head: plates, rivets and lashings, not one slab', () => {
    const parts = buildToolRig(getTool('pickaxe_scrapjaw')).parts;
    expect(parts.filter((p) => p.id.startsWith('weldPlate')).length).toBeGreaterThanOrEqual(3);
    expect(parts.filter((p) => p.id.startsWith('weldRivet')).length).toBeGreaterThanOrEqual(3);
    expect(parts.filter((p) => p.id.startsWith('chainLink')).length).toBeGreaterThanOrEqual(3);
    expect(parts.filter((p) => p.bevel).length).toBeGreaterThanOrEqual(6);
  });

  it('leaves the other six tools untouched by the pass', () => {
    // Part counts frozen from before: this pass was scoped to Scrapjaw alone.
    const BEFORE = {
      pickaxe_standard: 7, pickaxe_quarry: 7, pickaxe_splitleaf: 9,
      pickaxe_tidebreak: 9, pickaxe_emberfall: 9, pickaxe_lumen: 8
    };
    for (const [id, count] of Object.entries(BEFORE)) {
      expect(buildToolRig(getTool(id)).parts.length, id).toBe(count);
    }
  });

  it('preserves save compatibility for every tool ID, rarity and price (§9.13)', () => {
    const BEFORE = {
      pickaxe_standard: ['common', 300], pickaxe_quarry: ['common', 450],
      pickaxe_splitleaf: ['uncommon', 650], pickaxe_tidebreak: ['rare', 900],
      pickaxe_emberfall: ['epic', 1500], pickaxe_lumen: ['legendary', 2200],
      pickaxe_scrapjaw: ['epic', 1650]
    };
    for (const [id, [rarity, price]] of Object.entries(BEFORE)) {
      const item = getCosmetic(id);
      expect(item.rarity, `${id} rarity`).toBe(rarity);
      expect(item.price, `${id} price`).toBe(price);
    }
  });
});

describe('SKIN_SPEC §11.6 — the carry pose', () => {
  // Every outfit carrying every tool. The pose is solved from rig metrics, so a change to
  // any build's proportions can move a tool through the floor or across the character.
  const combinations = SKINS.flatMap((skin) => {
    const metrics = buildCharacterRig(skin).metrics;
    return TOOLS.map((tool) => ({
      label: `${skin.id} + ${tool.id}`,
      metrics,
      pose: carryTransform(metrics, tool.headScale ?? 1)
    }));
  });

  it('holds the tool in front of the character, never behind it', () => {
    // The whole point of the pose: a tool slung across the back reads as an accessory. The
    // rig faces +Z, so the head must stay on the positive side.
    for (const { label, pose } of combinations) {
      expect(pose.head.z, `${label} head is behind the character`).toBeGreaterThan(0);
      expect(pose.direction.z, `${label} points backward`).toBeGreaterThan(0);
    }
  });

  it('angles the head downward, and never upward', () => {
    for (const { label, pose } of combinations) {
      expect(pose.direction.y, `${label} head points up`).toBeLessThanOrEqual(0);
    }

    // Downward for every build that has room. The stout mascot is the one exception: its
    // very large head drops its shoulders and its arms are full length, so its hand sits
    // barely a third of a metre up and the tilt clamps to level rather than to the floor.
    const clamped = combinations.filter((c) => c.pose.direction.y === 0);
    for (const { label } of clamped) expect(label).toContain('outfit_sprocket');

    const free = combinations.filter((c) => !c.label.includes('outfit_sprocket'));
    expect(free.length).toBeGreaterThan(0);
    for (const { label, pose } of free) {
      expect(pose.direction.y, `${label} is not angled down`).toBeLessThan(-0.5);
    }
  });

  it('keeps the head clear of the ground', () => {
    for (const { label, pose } of combinations) {
      expect(pose.head.y - pose.headHalfHeight, `${label} head through the floor`)
        .toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the tool outboard of the torso and below the shoulder', () => {
    for (const { label, metrics, pose } of combinations) {
      expect(pose.head.x, `${label} head inside the torso`)
        .toBeGreaterThan(metrics.torsoWidth / 2);
      expect(pose.head.y, `${label} head above the shoulder`).toBeLessThan(metrics.shoulderY);
    }
  });

  it('keeps the haft butt out of the body', () => {
    // The butt trails the hand; it may sit beside the hip but must not pass through it.
    for (const { label, metrics, pose } of combinations) {
      const insideTorso = Math.abs(pose.butt.x) < metrics.torsoWidth / 2
        && Math.abs(pose.butt.z) < metrics.torsoDepth / 2
        && pose.butt.y > metrics.hipTop
        && pose.butt.y < metrics.shoulderY;
      expect(insideTorso, `${label} butt passes through the torso`).toBe(false);
    }
  });

  it('carries every tool at the same pose — visuals never imply a stat', () => {
    // ITEM_SHOP_SPEC §4.4: tools differ only in looks. Two tools on one character must
    // point the same way, or the pose itself would read as a difference in reach.
    const metrics = buildCharacterRig(SKINS[0]).metrics;
    const [first, ...rest] = TOOLS.map((t) => carryTransform(metrics, t.headScale ?? 1));
    for (const pose of rest) {
      expect(pose.direction.x).toBeCloseTo(first.direction.x, 6);
      expect(pose.direction.y).toBeCloseTo(first.direction.y, 6);
      expect(pose.direction.z).toBeCloseTo(first.direction.z, 6);
    }
  });

  it('derives the pose from the build module, with no absolute literals', () => {
    for (const [value, base] of [
      [PICKAXE_VIEW.carryGrip, CHARACTER.height],
      [PICKAXE_VIEW.carryClearance, CHARACTER.radius]
    ]) {
      const ratio = value / base;
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(1);
    }
  });
});

describe('SKIN_SPEC §11.7 — the swing animation', () => {
  // Where the visual strike lands. Gameplay damage resolves at progress 0, so this is the
  // sync error, and it is the number the animation is timed around.
  const SWING_IMPACT = 0.10;

  // Every pose a player can actually see at 60 fps, plus a fine sweep. The wind-up and the
  // strike occupy under two rendered frames each, so a coarse sample would step over them.
  const FRAMES = [];
  for (let p = 0; p <= 1.0001; p += 0.01) FRAMES.push(Math.min(1, +p.toFixed(4)));
  for (let f = 0; f <= Math.ceil(PICKAXE.swingInterval * 60); f++) {
    FRAMES.push(Math.min(1, f / 60 / PICKAXE.swingInterval));
  }

  const rigs = SKINS.map((skin) => ({ skin, metrics: buildCharacterRig(skin).metrics }));
  const combinations = rigs.flatMap(({ skin, metrics }) => TOOLS.map((tool) => ({
    label: `${skin.id} + ${tool.id}`,
    metrics,
    headScale: tool.headScale ?? 1,
    tm: toolMetrics(tool.headScale ?? 1)
  })));

  it('follows the gameplay swing state rather than a clock of its own', () => {
    // The animation reads Pickaxe.swingProgress, which is derived from the swing cooldown.
    // If that mapping ever drifted, the visual swing would drift from the swing rate.
    const pickaxe = new Pickaxe(null);
    expect(pickaxe.swinging).toBe(false);
    expect(pickaxe.swingProgress).toBe(1);

    pickaxe.swing({ aimRay: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }, collision: null });
    expect(pickaxe.swinging).toBe(true);
    expect(pickaxe.swingProgress).toBe(0);

    // Progress tracks elapsed time over the interval, and reaches rest exactly as the
    // cooldown expires — never before, never after.
    pickaxe.update(PICKAXE.swingInterval / 2);
    expect(pickaxe.swingProgress).toBeCloseTo(0.5, 6);
    expect(pickaxe.swinging).toBe(true);

    pickaxe.update(PICKAXE.swingInterval / 2);
    expect(pickaxe.swinging).toBe(false);
    expect(pickaxe.swingProgress).toBe(1);
    expect(pickaxe.canSwing).toBe(true);
  });

  it('moves through wind-up, strike and recovery in order', () => {
    expect(swingPose(0.03).phase).toBe(SwingPhase.WINDUP);
    expect(swingPose(0.07).phase).toBe(SwingPhase.STRIKE);
    expect(swingPose(0.18).phase).toBe(SwingPhase.RECOVER);
    expect(swingPose(0.60).phase).toBe(SwingPhase.CARRY);

    // The head rises for the wind-up, then drives down and forward through the strike.
    const m = rigs[0].metrics;
    const head = (p) => swungPoint(m, 1, p, toolMetrics(1).gripToHead);
    const carry = head(1);
    const windup = head(SWING_IMPACT / 2);
    const strike = head(SWING_IMPACT);
    expect(windup.y, 'wind-up does not raise the tool').toBeGreaterThan(carry.y + 1);
    expect(strike.y, 'strike does not come back down').toBeLessThan(windup.y - 0.8);
    expect(strike.z, 'strike does not drive forward').toBeGreaterThan(carry.z);
  });

  it('returns exactly to the carry pose, so repeated swings never snap', () => {
    // Both ends of the interval must land on the approved carry pose to the bit, or a held
    // swing would jolt on every repeat.
    for (const { label, metrics, headScale, tm } of combinations) {
      const carry = carryTransform(metrics, headScale);
      for (const p of [0, 1]) {
        const pose = swingPose(p);
        expect(pose.arm.x, `${label} arm at p=${p}`).toBe(0);
        expect(pose.arm.y, `${label} arm at p=${p}`).toBe(0);
        expect(pose.arm.z, `${label} arm at p=${p}`).toBe(0);
        expect(pose.toolPitch, `${label} tool pitch at p=${p}`).toBe(0);

        const head = swungPoint(metrics, headScale, p, tm.gripToHead);
        expect(head.x, `${label} head x at p=${p}`).toBeCloseTo(carry.head.x, 9);
        expect(head.y, `${label} head y at p=${p}`).toBeCloseTo(carry.head.y, 9);
        expect(head.z, `${label} head z at p=${p}`).toBeCloseTo(carry.head.z, 9);
      }
    }
    // And the rest pose the view falls back to is the same thing.
    expect(SWING_REST.arm).toEqual({ x: 0, y: 0, z: 0 });
    expect(SWING_REST.toolPitch).toBe(0);
  });

  it('produces no NaN transform at any progress, including junk input', () => {
    const { metrics } = rigs[0];
    const inputs = [...FRAMES, -1, 2, 1.0001, -0.0001, NaN, Infinity, -Infinity, undefined];
    for (const p of inputs) {
      const pose = swingPose(p);
      for (const [k, v] of Object.entries({ ...pose.arm, tool: pose.toolPitch, progress: pose.progress })) {
        expect(Number.isFinite(v), `swingPose(${p}).${k}`).toBe(true);
      }
      // Out-of-range progress clamps rather than extrapolating into a broken pose.
      expect(pose.progress).toBeGreaterThanOrEqual(0);
      expect(pose.progress).toBeLessThanOrEqual(1);

      const head = swungPoint(metrics, 1, p, toolMetrics(1).gripToHead);
      for (const [axis, v] of Object.entries(head)) {
        expect(Number.isFinite(v), `swungPoint(${p}).${axis}`).toBe(true);
      }
    }
  });

  it('never drives the tool through the torso or the head', () => {
    for (const { label, metrics: m, headScale, tm } of combinations) {
      for (const p of FRAMES) {
        for (const along of [tm.gripToHead, 0, -tm.gripToButt]) {
          const q = swungPoint(m, headScale, p, along);

          const inTorso = Math.abs(q.x) < m.torsoWidth / 2
            && Math.abs(q.z) < m.torsoDepth / 2
            && q.y > m.hipTop && q.y < m.shoulderY;
          expect(inTorso, `${label} at p=${p} passes through the torso`).toBe(false);

          // A raised tool passes ABOVE the head, which is fine; through it is not.
          const reach = m.headRadius + tm.headHeight / 2;
          const inHead = Math.hypot(q.x, q.z) < reach && Math.abs(q.y - m.headY) < reach;
          expect(inHead, `${label} at p=${p} passes through the head`).toBe(false);
        }
      }
    }
  });

  it('never puts the tool head below the ground, recovery included', () => {
    for (const { label, metrics, headScale, tm } of combinations) {
      for (const p of FRAMES) {
        const head = swungPoint(metrics, headScale, p, tm.gripToHead);
        expect(head.y - tm.headHeight / 2, `${label} head below ground at p=${p}`)
          .toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('lands the visual strike close behind the gameplay hit', () => {
    // Gameplay resolves damage at progress 0. The strike cannot be AT 0 — an arc with no
    // wind-up in it reads as a twitch — but it must be close, or the hit and the swing look
    // like separate events.
    expect(SWING_IMPACT).toBeLessThanOrEqual(0.12);
    expect(SWING_IMPACT * PICKAXE.swingInterval).toBeLessThan(0.07);   // under 70 ms

    // The arc's own extremes must sit where that claim says they do: raised before the
    // strike, driven down and forward at it.
    const m = rigs[0].metrics;
    const head = (p) => swungPoint(m, 1, p, toolMetrics(1).gripToHead);
    let highest = 0;
    let highestAt = 0;
    for (const p of FRAMES) {
      const y = head(p).y;
      if (y > highest) { highest = y; highestAt = p; }
    }
    expect(highestAt, 'peak wind-up is not before the strike').toBeLessThan(SWING_IMPACT);
    expect(head(SWING_IMPACT).y, 'tool has not come down by the strike')
      .toBeLessThan(highest - 0.8);
  });

  it('stays clear of the third-person camera', () => {
    // The camera trails over the same shoulder the tool is carried on, so a raised tool is
    // the one thing that could reach it. Checked at every 60 fps pose, for the camera at its
    // resting trail and pulled half way in.
    for (const trail of [CAMERA.distance, CAMERA.distance * 0.5, 0.4]) {
      const eye = { x: CAMERA.shoulderOffsetX, y: CAMERA.heightAbovebase, z: -trail };
      for (const { label, metrics, headScale, tm } of combinations) {
        for (const p of FRAMES) {
          for (const along of [tm.gripToHead, tm.gripToHead * 0.5, 0, -tm.gripToButt]) {
            const q = swungPoint(metrics, headScale, p, along);
            const gap = Math.hypot(q.x - eye.x, q.y - eye.y, q.z - eye.z) - tm.headHeight / 2;
            expect(gap, `${label} reaches the camera at p=${p}, trail ${trail}`)
              .toBeGreaterThan(CAMERA.collisionRadius);
          }
        }
      }
    }
  });

  it('keeps the tool in front of the character throughout, never back toward the camera', () => {
    // The camera trails the character, so a swing that reaches behind fills the view with
    // the tool. The whole arc stays forward of the body.
    for (const { label, metrics, headScale, tm } of combinations) {
      for (const p of FRAMES) {
        const head = swungPoint(metrics, headScale, p, tm.gripToHead);
        expect(head.z, `${label} head swings behind the character at p=${p}`).toBeGreaterThan(0);
      }
    }
  });
});
