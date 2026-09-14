/**
 * CharacterView.js — SKIN_SPEC §3.1, §10.
 *
 * The three.js view of a character. It owns no shape of its own: every mesh comes from
 * `cosmetics/CharacterRig.js`, the same part list the 2D preview paints. Swapping a skin
 * rebuilds the group from the new rig.
 *
 * This is the thin view layer CLAUDE.md requires — the rig is testable in Node, this file
 * is not tested and contains no logic beyond translating parts into meshes.
 */
import * as THREE from 'three';
import { buildCharacterRig, BodyRegion } from '../cosmetics/CharacterRig.js';
import { skinOrFallback } from '../cosmetics/SkinDefinitions.js';
import { buildToolRig, carryTransform, swingPose, SWING_REST } from '../cosmetics/ToolRig.js';
import { toolOrFallback } from '../cosmetics/ToolDefinitions.js';
import { buildWeaponRig, weaponPose } from '../cosmetics/WeaponRig.js';
import { HeldKind, sameHeld } from '../player/EquippedItem.js';
import { UNIT, applyPartTransform, MaterialCache } from './RigMeshBuilder.js';
import { CHARACTER } from '../core/Config.js';

export class CharacterView {
  constructor() {
    this.group = new THREE.Group();
    this.skin = null;
    this.rig = null;
    this.materials = new MaterialCache();
    this.parts = new Map();       // part id -> Mesh
    this.ownedGeometries = [];    // per-part geometries this view must dispose

    // The right arm and whatever it holds, pivoted at the SHOULDER so one rotation swings
    // arm and tool together — a tool animated apart from the arm holding it slides out of
    // the hand. Parented to the character, so it inherits the crouch squash and the yaw.
    this.armGroup = new THREE.Group();
    this.group.add(this.armGroup);

    // MASTER_SPEC §15.4 — THE hand attachment. There is exactly one, and equipping anything
    // replaces its contents wholesale, so two held items cannot coexist even for a frame.
    // Nothing outside this class ever adds a child to it.
    this.heldGroup = new THREE.Group();
    this.armGroup.add(this.heldGroup);

    /** The harvesting-tool COSMETIC — which pickaxe model to build when one is held. */
    this.tool = null;
    /** What is actually in the hand right now, as resolved by `EquippedItem.js`. */
    this.held = { kind: HeldKind.NONE, id: null, category: null };

    // Carry pose in rig space, and the tool's own carry rotation. The swing is applied as
    // an offset from these, so progress 0 and progress 1 land back on the approved pose.
    this.shoulder = { x: 0, y: 0, z: 0 };
    this.carry = null;
    this.swing = SWING_REST;
    this.adsProgress = 0;
  }

  get object3D() {
    return this.group;
  }

  /**
   * Rebuild for a skin. Accepts a skin, a skin id, or a catalog cosmetic (whose `id` is
   * the skin id), so callers do not have to know which they are holding.
   */
  setSkin(skinOrCosmetic) {
    const id = typeof skinOrCosmetic === 'string' ? skinOrCosmetic : skinOrCosmetic?.id;
    const skin = skinOrFallback(id);
    if (this.skin?.id === skin.id) return;

    const wasHeld = { ...this.held };
    this._clear();
    this.skin = skin;
    this.rig = buildCharacterRig(skin);

    // Seat the shoulder pivot BEFORE building, so every arm mesh is rebased onto it as it
    // is created. Doing it afterwards only works when the pivot moved, which silently skips
    // any skin whose shoulder happens to sit where the last one's did.
    this.shoulder = { x: this.rig.metrics.armX, y: this.rig.metrics.shoulderY, z: 0 };
    this.armGroup.position.set(this.shoulder.x, this.shoulder.y, this.shoulder.z);

    this._build(this.rig.parts, skin, this.group, '');

    // Materials are shared per view and were just disposed, so whatever is in the hand is
    // rebuilt against the new material set rather than left pointing at freed ones.
    this.held = { kind: HeldKind.NONE, id: null, category: null };
    this._buildHeld(wasHeld);
  }

  /**
   * Choose WHICH harvesting tool model is used when the pickaxe is held (SKIN_SPEC §11.6).
   * This is a cosmetic choice, not an equip: it does not put anything in the hand.
   * Accepts a tool, a tool id, or a catalog cosmetic.
   */
  setTool(toolOrCosmetic) {
    const id = typeof toolOrCosmetic === 'string' ? toolOrCosmetic : toolOrCosmetic?.id;
    const tool = toolOrFallback(id);
    if (this.tool?.id === tool.id) return;
    this.tool = tool;
    // Rebuild only if the pickaxe is what is currently in the hand.
    if (this.held.kind === HeldKind.PICKAXE) {
      this._buildHeld({ ...this.held, id: tool.id }, { force: true });
    }
  }

  /**
   * MASTER_SPEC §15.4 — THE equipped-item entry point.
   *
   * Takes the resolved view from `EquippedItem.equippedView` and makes the hand match it.
   * This view holds no equipped state of its own: it is told what the inventory says, every
   * frame, so a held item cannot go stale and two cannot coexist.
   *
   * @param {{kind:string, id:string|null, category:string|null,
   *          swingProgress:number, adsProgress:number}} view
   */
  setEquipped(view) {
    const next = view ?? { kind: HeldKind.NONE, id: null, category: null };
    // Both progresses are read BEFORE the pose is applied, and the pose is applied on every
    // call — not only when the held item changes. Applying it only on a change left the aim
    // pose frozen at whatever it was when the weapon was drawn, so raising the sights moved
    // nothing at all.
    this.adsProgress = next.adsProgress ?? 0;
    const progress = next.swingProgress ?? 1;
    this.swing = progress >= 1 || !Number.isFinite(progress) ? SWING_REST : swingPose(progress);
    this._buildHeld(next);
    this._applyHeld();
  }

  /**
   * Replace the hand's contents. Everything currently in the hand is removed FIRST and
   * unconditionally, which is the structural reason exactly one item can ever be visible.
   */
  _buildHeld(next, { force = false } = {}) {
    const target = next?.kind ? next : { kind: HeldKind.NONE, id: null, category: null };
    if (!force && sameHeld(this.held, target)) return;

    for (const mesh of [...this.heldGroup.children]) mesh.removeFromParent();
    // Drop the outgoing item's part entries too, or the map grows by a full rig on every
    // weapon switch and `_clear` ends up disposing meshes that left the scene long ago.
    for (const key of [...this.parts.keys()]) {
      if (key.startsWith('held:')) this.parts.delete(key);
    }
    this.held = { kind: target.kind, id: target.id ?? null, category: target.category ?? null };
    this.carry = null;

    if (target.kind === HeldKind.PICKAXE) {
      const tool = toolOrFallback(target.id ?? this.tool?.id);
      this.tool = tool;
      this.held.id = tool.id;
      this._build(buildToolRig(tool).parts, tool, this.heldGroup, 'held:');
      this._placeToolInHand();
    } else if (target.kind === HeldKind.WEAPON) {
      const rig = buildWeaponRig(target.category ?? target.id);
      this.held.category = rig.category;
      this._build(rig.parts, rig, this.heldGroup, 'held:');
    }
    this._applyHeld();
  }

  /**
   * Seat the tool group in the right hand, held at the side (SKIN_SPEC §11.6).
   *
   * Read off the rig's own metrics rather than hard-coded: a heavy frame's hand sits
   * further out than a lean one's, and the tool has to follow it.
   *
   * The pose itself is solved by `carryTransform` — pure geometry, tested in Node — so this
   * file stays a translator, per its own contract above.
   */
  _placeToolInHand() {
    const m = this.rig?.metrics;
    if (!m) return;
    this.carry = carryTransform(m, this.tool?.headScale ?? 1);
    this._applyHeld();
  }

  /**
   * Set how far through a swing the harvesting tool is (SKIN_SPEC §11.7).
   *
   * `progress` is `Pickaxe.swingProgress` — a read of the gameplay cooldown. Pass 1, or
   * nothing, for the idle carry pose. A weapon ignores it entirely (§12.1.2).
   */
  setSwingProgress(progress = 1) {
    this.swing = progress >= 1 || !Number.isFinite(progress) ? SWING_REST : swingPose(progress);
    this._applyHeld();
  }

  /**
   * Put the held item where its own pose says it goes.
   *
   * One method for both, because there is one hand. The pickaxe lays its swing over the
   * approved carry pose (at rest the offsets are all zero, so it lands on exactly the
   * transform `carryTransform` returns); a weapon takes the hip/ADS pose from `weaponPose`.
   * Neither can reach the other's pose, because the branch is on what is held.
   */
  _applyHeld() {
    const metrics = this.rig?.metrics;

    if (this.held.kind === HeldKind.PICKAXE && this.carry) {
      const { position, rotation } = this.carry;
      const s = this.swing;
      this.armGroup.rotation.set(s.arm.x, s.arm.y, s.arm.z);
      this.heldGroup.position.set(
        position.x - this.shoulder.x,
        position.y - this.shoulder.y,
        position.z - this.shoulder.z
      );
      this.heldGroup.rotation.set(rotation.x + s.toolPitch, rotation.y, rotation.z);
      return;
    }

    if (this.held.kind === HeldKind.WEAPON && metrics) {
      const pose = weaponPose(metrics, this.adsProgress);
      this.armGroup.rotation.set(pose.arm.x, pose.arm.y, pose.arm.z);
      this.heldGroup.position.set(pose.position.x, pose.position.y, pose.position.z);
      this.heldGroup.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
      return;
    }

    // Empty hand: the arm hangs at its rig pose. Nothing is attached to rotate.
    this.armGroup.rotation.set(0, 0, 0);
  }

  _build(parts, owner, parent, idPrefix) {
    for (const part of parts) {
      const geometry = part.bevel ? UNIT.bevelBox : (UNIT[part.shape] ?? UNIT.box);
      const mesh = new THREE.Mesh(geometry, this.materials.get(owner, part));
      applyPartTransform(mesh, part, this.ownedGeometries);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      // Everything on the right arm — the limb itself and any cosmetic pad or bracer on it
      // — rides the arm group, so a swing takes the whole sleeve with it. Parts are built in
      // RIG space, so rebase onto the pivot to leave them exactly where they were.
      //
      // The region is the part's TAG: `RigPrimitives.box(id, tag, role, …)` takes the
      // BodyRegion as its tag, and there is no `part.region` field at all. Testing for one
      // matched nothing, so every arm mesh stayed on the character and the shoulder pivot
      // animated the held item alone — the tool swung out of a hand that never moved.
      if (parent === this.group && part.tag === BodyRegion.ARM_R) {
        mesh.position.set(
          mesh.position.x - this.shoulder.x,
          mesh.position.y - this.shoulder.y,
          mesh.position.z - this.shoulder.z
        );
        this.armGroup.add(mesh);
      } else {
        parent.add(mesh);
      }
      this.parts.set(idPrefix + part.id, mesh);
    }
  }

  _clear() {
    for (const mesh of this.parts.values()) mesh.removeFromParent();
    this.parts.clear();
    // Only geometries this view built — the shared UNIT primitives outlive every view.
    for (const geo of this.ownedGeometries) geo.dispose();
    this.ownedGeometries.length = 0;
    this.materials.dispose();
  }

  /**
   * Place the character in the world.
   * @param {{x:number,y:number,z:number}} position  foot centre
   * @param {number} yaw  radians
   * @param {number} height  current capsule height — crouching squashes the character
   *                         exactly as it squashes the capsule
   */
  place(position, yaw, height = CHARACTER.height) {
    this.group.position.set(position.x, position.y, position.z);
    // + PI because the two conventions disagree: the rig faces +Z (SKIN_SPEC §3.2) while
    // a player at yaw 0 looks down -Z (PlayerCamera.lookDirection). Without the half turn
    // the character faces the camera in third person and moonwalks when running forward.
    this.group.rotation.y = yaw + Math.PI;
    this.group.scale.y = height / CHARACTER.height;
  }

  set visible(value) {
    this.group.visible = value;
  }

  get visible() {
    return this.group.visible;
  }

  dispose() {
    this._clear();
    this.group.removeFromParent();
  }
}
