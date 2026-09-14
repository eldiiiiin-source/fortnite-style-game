/**
 * RigMeshBuilder.js — SKIN_SPEC §3.3.
 *
 * The one place a rig part list becomes three.js meshes.
 *
 * Characters, harvesting tools and weapons all emit the same part vocabulary, and all
 * three are drawn in more than one place — in the hand, on the ground, in a shop card. If
 * each consumer turned parts into meshes its own way, the same item could end up looking
 * different depending on where it was seen. So the translation lives here, once.
 *
 * No logic beyond that translation: shapes come from `RigPrimitives`, colours from the
 * owner's palette, and nothing here decides what anything looks like.
 */
import * as THREE from 'three';
import { partColour, PartShape } from '../cosmetics/CharacterRig.js';

/** Shared geometries: every part is a unit primitive scaled to its size. */
export const UNIT = {
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

/**
 * A chamfered unit box — SKIN_SPEC §6.5. Corners cut on all three axes so a stack of
 * plates reads as machined parts rather than as a pile of rectangles.
 */
function unitBevelBox() {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  const pos = g.attributes.position;
  const cut = 0.34;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Pull the eight corner vertices in along every axis; edge and face vertices stay.
    const corner = Math.abs(x) > 0.49 && Math.abs(y) > 0.49 && Math.abs(z) > 0.49;
    if (corner) {
      pos.setX(i, x * (1 - cut));
      pos.setY(i, y * (1 - cut));
      pos.setZ(i, z * (1 - cut));
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
UNIT.bevelBox = unitBevelBox();

/**
 * Materials, shared across every rig a single owner draws.
 *
 * A lens and a glowing bone share a colour but not a material, so the key carries both.
 * Without this the first one built would decide how the other looked.
 */
export class MaterialCache {
  constructor() {
    this.materials = new Map();
  }

  get(owner, part) {
    const colour = partColour(owner, part);
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

  dispose() {
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
  }
}

/**
 * Build a whole rig as one group — used wherever a rig is drawn as a single object rather
 * than threaded through a skeleton (a weapon lying in the world, a shop preview).
 *
 * @param {{parts:object[], palette:object}} rig
 * @param {MaterialCache} cache
 * @param {object[]} owned  geometries the caller must dispose
 * @returns {THREE.Group}
 */
export function buildRigGroup(rig, cache, owned = []) {
  const group = new THREE.Group();
  for (const part of rig.parts) {
    const geometry = part.bevel ? UNIT.bevelBox : (UNIT[part.shape] ?? UNIT.box);
    const mesh = new THREE.Mesh(geometry, cache.get(rig, part));
    applyPartTransform(mesh, part, owned);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
}

/**
 * Scale and position one unit primitive to match a rig part. Any geometry built here is
 * pushed to `owned` so the view can dispose it — the shared UNIT primitives never are.
 */
export function applyPartTransform(mesh, part, owned) {
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
