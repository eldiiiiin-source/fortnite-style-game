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
import {
  buildCharacterRig, partColour, PartShape
} from '../cosmetics/CharacterRig.js';
import { skinOrFallback } from '../cosmetics/SkinDefinitions.js';
import { buildToolRig } from '../cosmetics/ToolRig.js';
import { toolOrFallback } from '../cosmetics/ToolDefinitions.js';
import { CHARACTER, PICKAXE_VIEW } from '../core/Config.js';

/** Shared geometries: every part is a unit primitive scaled to its size. */
const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  cone: new THREE.ConeGeometry(0.5, 1, 12),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 12)
};

/**
 * A wedge: a box with its front face narrowed, which reads as a visor or a brim rather
 * than another cube. Built once and scaled, like the other primitives.
 */
function unitWedge() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // Taper the +Z face inward on X and Y.
    if (pos.getZ(i) > 0) {
      pos.setX(i, pos.getX(i) * 0.72);
      pos.setY(i, pos.getY(i) * 0.6);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
UNIT.wedge = unitWedge();

export class CharacterView {
  constructor() {
    this.group = new THREE.Group();
    this.skin = null;
    this.rig = null;
    this.materials = new Map();   // colour+glow key -> MeshLambertMaterial
    this.parts = new Map();       // part id -> Mesh
    this.ownedGeometries = [];    // per-part geometries this view must dispose

    // The held harvesting tool, parented to the character so it inherits the crouch
    // squash and the yaw without a second transform to keep in sync.
    this.toolGroup = new THREE.Group();
    this.group.add(this.toolGroup);
    this.tool = null;
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

    const heldTool = this.tool;
    this._clear();
    this.skin = skin;
    this.rig = buildCharacterRig(skin);
    this._build(this.rig.parts, skin, this.group, '');

    // Materials are shared per view and were just disposed, so the held tool is rebuilt
    // against the new material set rather than left pointing at freed ones.
    if (heldTool) {
      this.tool = null;
      this.setTool(heldTool);
    }
    this._placeToolInHand();
  }

  /**
   * Equip a harvesting tool, held in the right hand (SKIN_SPEC §11.6).
   * Accepts a tool, a tool id, or a catalog cosmetic.
   */
  setTool(toolOrCosmetic) {
    const id = typeof toolOrCosmetic === 'string' ? toolOrCosmetic : toolOrCosmetic?.id;
    const tool = toolOrFallback(id);
    if (this.tool?.id === tool.id) return;

    for (const mesh of [...this.toolGroup.children]) mesh.removeFromParent();
    this.tool = tool;
    this._build(buildToolRig(tool).parts, tool, this.toolGroup, 'tool:');
    this._placeToolInHand();
  }

  /**
   * Seat the tool group at the right hand.
   *
   * Read off the rig's own hand part rather than hard-coded: a heavy frame's hand sits
   * further out than a lean one's, and the tool has to follow it.
   */
  _placeToolInHand() {
    const m = this.rig?.metrics;
    if (!m) return;
    this.toolGroup.position.set(
      m.armX + PICKAXE_VIEW.gripOut,
      m.shoulderY - m.armLength - PICKAXE_VIEW.gripDrop,
      m.armDepth * 0.3
    );
    this.toolGroup.rotation.set(PICKAXE_VIEW.carryPitch, 0, PICKAXE_VIEW.carryRoll);
  }

  _build(parts, owner, parent, idPrefix) {
    for (const part of parts) {
      const mesh = new THREE.Mesh(UNIT[part.shape] ?? UNIT.box, this._material(owner, part));
      applyPartTransform(mesh, part, this.ownedGeometries);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      parent.add(mesh);
      this.parts.set(idPrefix + part.id, mesh);
    }
  }

  _material(owner, part) {
    const colour = partColour(owner, part);
    // A lens and a glowing bone share a colour but not a material, so the key carries
    // both. Without this the first one built would decide how the other looked.
    const key = `${colour}|${part.glow ? 'glow' : part.role === 'visor' ? 'lens' : 'flat'}`;
    let mat = this.materials.get(key);
    if (!mat) {
      // `visor` reads as a lens rather than paint; `glow` is self-lit geometry. Both are
      // material choices, never rarity effects — no gameplay tell (SKIN_SPEC §8).
      const lift = part.glow ? 0.85 : part.role === 'visor' ? 0.28 : 0;
      mat = new THREE.MeshLambertMaterial({
        color: colour,
        emissive: lift > 0 ? new THREE.Color(colour).multiplyScalar(lift) : 0x000000
      });
      this.materials.set(key, mat);
    }
    return mat;
  }

  _clear() {
    for (const mesh of this.parts.values()) mesh.removeFromParent();
    this.parts.clear();
    // Only geometries this view built — the shared UNIT primitives outlive every view.
    for (const geo of this.ownedGeometries) geo.dispose();
    this.ownedGeometries.length = 0;
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
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

/**
 * Scale and position one unit primitive to match a rig part. Any geometry built here is
 * pushed to `owned` so the view can dispose it — the shared UNIT primitives never are.
 */
function applyPartTransform(mesh, part, owned) {
  switch (part.shape) {
    case PartShape.SPHERE:
      mesh.scale.setScalar(part.radius * 2);
      break;
    case PartShape.CONE:
      mesh.scale.set(part.radius * 2, part.height, part.radius * 2);
      break;
    case PartShape.CYLINDER: {
      const top = part.radiusTop ?? part.radius;
      if (top === part.radius) {
        // Untapered: the shared unit cylinder scales to fit.
        mesh.scale.set(part.radius * 2, part.height, part.radius * 2);
      } else {
        // Tapered: needs its own geometry, built at true radii so only height scales.
        mesh.geometry = new THREE.CylinderGeometry(top, part.radius, 1, 12);
        owned.push(mesh.geometry);
        mesh.scale.set(1, part.height, 1);
      }
      break;
    }
    default:
      mesh.scale.set(part.size.x, part.size.y, part.size.z);
  }
  mesh.position.set(part.pos.x, part.pos.y, part.pos.z);
  if (part.rot) mesh.rotation.set(part.rot.x, part.rot.y, part.rot.z);
}
