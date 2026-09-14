/**
 * Renderer.js — the three.js view layer. MASTER_SPEC §23, MAP_SPEC §10, §16.
 *
 * The ONLY module owning three.js scene objects for the world. Simulation never reads
 * from here.
 *
 * Build pieces are drawn from PieceGeometry — the same module the collision world uses —
 * so an edited opening is visibly open AND passable, and the two cannot drift apart
 * (§9.2, §10.4). Wall and floor tiles are instanced unit cubes scaled per tile, which
 * means any edit pattern renders without a new mesh type.
 */
import * as THREE from 'three';
import {
  TILE, WALL_H, BUDGET, MATERIALS, MATERIAL_ORDER, WORLD, CAMERA, LIGHTING, RARITIES
} from '../core/Config.js';
import { solidBoxes, rampSections, coneQuadrants, cellOrigin } from '../building/PieceGeometry.js';
import { CharacterView } from './CharacterView.js';
import { MaterialCache, buildRigGroup } from './RigMeshBuilder.js';
import { buildWeaponRig } from '../cosmetics/WeaponRig.js';
import { DEFAULT_EQUIPPED } from '../meta/CosmeticCatalog.js';

/** Storm wall height — tall enough to read from the ground at any build height. */
const STORM_WALL_HEIGHT = WALL_H * 30;

/** MAP_SPEC §10 palette — bright, clean, stylised. */
/** Scaled to nothing: how an instanced slot is taken out of the world without a rebuild. */
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

const PALETTE = Object.freeze({
  sky: 0x9ad2f0,
  skyHorizon: 0xdceffb,
  grass: 0x6fb04a,
  water: 0x3fb9c9,
  sun: 0xfff4e0,
  ambientSky: 0xcfe6fb,
  ambientGround: 0x6a7a4a
});

/**
 * Ground colours by surface type (MAP_SPEC §20.5).
 *
 * Deliberately close in value and separated by HUE. Characters and build pieces have to
 * stay the highest-contrast things on screen (§20.8), so the ground reads as varied
 * without ever competing with them.
 */
const SURFACE_COLOURS = Object.freeze({
  grass: 0x6fb04a,
  field: 0x9cb457,
  dirt: 0x9a8460,
  sand: 0xd9cf9a,
  rock: 0x9a9a94,
  road: 0x7c7568
});

/** Vegetation colours — SKIN-adjacent but world-owned. */
const FLORA = Object.freeze({
  trunk: 0x6b4a2f,
  canopyA: 0x4f9440,
  canopyB: 0x3f8038,
  canopyC: 0x67a84a,
  rock: 0x8f8f89,
  rockDark: 0x75756f,
  bush: 0x559442
});

/**
 * Prop dressing colours (MAP_SPEC §21.6). One shared material per kind, one InstancedMesh
 * per kind — the whole dressing layer costs a dozen draw calls, not one per crate.
 */
const PROPS = Object.freeze({
  crate: 0x9a7746,
  barrel: 0x4f7a5c,
  pallet: 0x8a6b42,
  hayBale: 0xc9b45c,
  bench: 0x7d6242,
  sign: 0xbfc6cc,
  fuelPump: 0xcf5b45,
  toolRack: 0x6b6f78,
  fishingRack: 0x7f6a4c,
  antenna: 0xa7aeb6,
  sandbag: 0xa9976b,
  barrier: 0xd8863a,
  trough: 0x6f6a5c,
  forklift: 0xd2a32e
});

export class Renderer {
  constructor(container, terrain) {
    this.terrain = terrain;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.sky);
    // MAP_SPEC §10 — a clear pleasant afternoon, not heavy fog.
    this.scene.fog = new THREE.Fog(PALETTE.sky, WORLD.propLoadRadius * 0.6, WORLD.terrainDrawDistance);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fovDefault, 1, 0.1, WORLD.terrainDrawDistance
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this._setupLighting();
    this._setupTerrain();
    this._setupBuildMeshes();
    this._setupGhost();
    this._setupEditOverlay();
    this._setupStorm();
    this._setupAvatar();

    this.lastGridRevision = -1;
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  get domElement() {
    return this.renderer.domElement;
  }

  /** MAP_SPEC §10, §20.8, §21.9 — soft sunlight, readable shadows, readable interiors. */
  _setupLighting() {
    const sun = new THREE.DirectionalLight(PALETTE.sun, LIGHTING.sunIntensity);
    const elevation = LIGHTING.sunElevationDeg * Math.PI / 180;
    sun.position.set(Math.cos(elevation) * 200, Math.sin(elevation) * 200, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = TILE * 44;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 800 });
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.scene.add(
      new THREE.HemisphereLight(PALETTE.ambientSky, PALETTE.ambientGround, LIGHTING.hemisphereIntensity)
    );

    // §21.9 — the hemisphere term shades by normal, so a wall facing into a room takes the
    // dark ground colour and the roof shadows the rest. A flat ambient is what stops an
    // interior reading as a black void; it is deliberately far below the sun so open ground
    // still shows directional shading.
    this.scene.add(new THREE.AmbientLight(PALETTE.ambientSky, LIGHTING.interiorFill));

    this._setupSky();
  }

  /**
   * A sky dome with a vertical gradient (MAP_SPEC §20.8).
   *
   * A flat background colour gives the horizon nothing to sit against, which is most of
   * why the old world read as a field rather than as a place. The dome is drawn on the
   * inside with lighting off, so it costs one draw call and never picks up the sun.
   */
  _setupSky() {
    // Radius stays INSIDE the camera's far plane. Sized past it, the dome is clipped and
    // the cut edge reads as a hard arc across the sky — which is worse than no dome at all.
    // The performance governor can shorten `camera.far`, so `updateSkyScale` follows it.
    const radius = WORLD.terrainDrawDistance * 0.9;
    const geo = new THREE.SphereGeometry(radius, 24, 16);
    const top = new THREE.Color(PALETTE.sky);
    const horizon = new THREE.Color(PALETTE.skyHorizon);
    const colours = new Float32Array(geo.attributes.position.count * 3);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Normalised height up the dome, eased so the gradient sits low and wide.
      const t = Math.max(0, pos.getY(i) / radius);
      const c = horizon.clone().lerp(top, Math.pow(t, 0.55));
      colours[i * 3] = c.r;
      colours[i * 3 + 1] = c.g;
      colours[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
    }));
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.sky = sky;
    this.skyRadius = radius;
  }

  /** Keep the sky dome inside whatever far plane the performance governor has chosen. */
  _fitSkyToCamera() {
    if (!this.sky) return;
    const scale = Math.min(1, (this.camera.far * 0.9) / this.skyRadius);
    this.sky.scale.setScalar(scale);
  }

  _setupTerrain() {
    this.terrainGroup = new THREE.Group();
    this.scene.add(this.terrainGroup);
    this.chunkMeshes = new Map();
    // Vertex-coloured: one material for the whole island, coloured per vertex from the
    // terrain's own surface function, so grass, dirt, sand, rock and road all draw in the
    // same pass and the map cannot disagree with the world about where they are (§20.5).
    this.terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.regionExtent * 3, WORLD.regionExtent * 3),
      new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.86 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WORLD.seaLevel - 0.05;
    this.scene.add(water);

    this._setupVegetation();
  }

  /**
   * Trees, boulders and bushes as instanced meshes (MAP_SPEC §20.6).
   *
   * The old world placed harvestable trees and rocks as gameplay entities and drew nothing
   * for them — the single biggest reason it looked like an empty field. One InstancedMesh
   * per part keeps the whole nature layer at a handful of draw calls.
   */
  _setupVegetation() {
    this.floraGroup = new THREE.Group();
    this.scene.add(this.floraGroup);
    /** Vegetation entry -> the instanced-mesh slots drawing it (§14). */
    this.instanceRefs = new Map();

    const layout = this.terrain.layout?.();
    if (!layout) return;

    const dummy = new THREE.Object3D();
    const ground = (x, z) => this.terrain.heightAt(x, z);

    const addInstances = (geometry, colour, entries, place) => {
      if (entries.length === 0) return;
      const mesh = new THREE.InstancedMesh(
        geometry, new THREE.MeshLambertMaterial({ color: colour }), entries.length
      );
      entries.forEach((entry, i) => {
        place(dummy, entry);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // Remember where each entry's instances live. A tree is several instanced meshes
        // — trunk and canopy — and harvesting it has to take all of them (§14).
        const refs = this.instanceRefs.get(entry);
        if (refs) refs.push({ mesh, index: i });
        else this.instanceRefs.set(entry, [{ mesh, index: i }]);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.needsUpdate = true;
      this.floraGroup.add(mesh);
      return mesh;
    };

    const trees = layout.trees ?? [];
    const trunkH = WALL_H * 0.85;
    addInstances(
      new THREE.CylinderGeometry(TILE * 0.052, TILE * 0.075, trunkH, 7),
      FLORA.trunk, trees,
      (d, tree) => {
        d.position.set(tree.x, ground(tree.x, tree.z) + trunkH * 0.5 * tree.scale, tree.z);
        d.rotation.set(0, tree.x * 0.7, 0);
        d.scale.set(tree.scale, tree.scale, tree.scale);
      }
    );

    // Canopies split by variant so a wood is not one repeated silhouette.
    const canopyColours = [FLORA.canopyA, FLORA.canopyB, FLORA.canopyC];
    for (let variant = 0; variant < 3; variant++) {
      const group = trees.filter((tree) => tree.variant === variant);
      const canopyH = WALL_H * (1.25 + variant * 0.2);
      const radius = TILE * (0.33 + variant * 0.04);
      const geometry = variant === 1
        ? new THREE.SphereGeometry(radius, 8, 6)
        : new THREE.ConeGeometry(radius, canopyH, 8);
      addInstances(geometry, canopyColours[variant], group, (d, tree) => {
        const lift = variant === 1 ? trunkH * 0.95 + radius * 0.6 : trunkH * 0.9 + canopyH * 0.42;
        d.position.set(tree.x, ground(tree.x, tree.z) + lift * tree.scale, tree.z);
        d.rotation.set(0, tree.z * 0.6, 0);
        d.scale.set(tree.scale, tree.scale, tree.scale);
      });
    }

    const rocks = layout.rocks ?? [];
    for (let variant = 0; variant < 2; variant++) {
      const group = rocks.filter((rock) => rock.variant === variant);
      const radius = TILE * (0.24 + variant * 0.1);
      addInstances(
        new THREE.DodecahedronGeometry(radius, 0),
        variant === 0 ? FLORA.rock : FLORA.rockDark, group,
        (d, rock) => {
          d.position.set(rock.x, ground(rock.x, rock.z) + radius * 0.45 * rock.scale, rock.z);
          d.rotation.set(rock.x * 0.3, rock.z * 0.5, 0.2);
          d.scale.set(rock.scale, rock.scale * 0.8, rock.scale);
        }
      );
    }

    this._setupDressing(layout, addInstances, ground);

    const bushes = layout.bushes ?? [];
    addInstances(
      new THREE.SphereGeometry(TILE * 0.16, 7, 5), FLORA.bush, bushes,
      (d, bush) => {
        d.position.set(bush.x, ground(bush.x, bush.z) + TILE * 0.1 * bush.scale, bush.z);
        d.rotation.set(0, bush.x * 0.9, 0);
        d.scale.set(bush.scale, bush.scale * 0.72, bush.scale);
      }
    );

    this._setupHarvestables(layout, ground);
  }

  /**
   * MASTER_SPEC §14 — the metal harvestables.
   *
   * Wood and brick sources ARE vegetation and are already drawn as instances; metal has no
   * instance to borrow, so it is drawn here. There are a handful of them — one per POI — so
   * each gets its own small group rather than an instanced mesh.
   */
  _setupHarvestables(layout, ground) {
    this.harvestMeshes = new Map();
    this.depletedProps = new Set();

    for (const prop of layout.props ?? []) {
      if (prop.kind !== 'vehicle' && prop.kind !== 'container') continue;
      const group = new THREE.Group();
      const container = prop.kind === 'container';
      const w = TILE * (container ? 0.44 : 0.36);
      const h = WALL_H * (container ? 0.62 : 0.34);
      const d = TILE * (container ? 0.9 : 0.72);

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: container ? 0x5f7a86 : 0x8a5a4a })
      );
      body.position.y = h / 2;
      body.castShadow = true;
      group.add(body);

      if (container) {
        // A ribbed lid, so a shipping container is not a plain slab.
        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(w * 1.04, h * 0.14, d * 1.02),
          new THREE.MeshLambertMaterial({ color: 0x4a616b })
        );
        cap.position.y = h * 0.97;
        group.add(cap);
      } else {
        // A cabin, so a vehicle reads as a vehicle from across the yard.
        const cabin = new THREE.Mesh(
          new THREE.BoxGeometry(w * 0.92, h * 0.7, d * 0.36),
          new THREE.MeshLambertMaterial({ color: 0x6e7f8c })
        );
        cabin.position.set(0, h * 1.2, -d * 0.16);
        group.add(cabin);
      }

      group.position.set(prop.x, ground(prop.x, prop.z), prop.z);
      this.floraGroup.add(group);
      this.harvestMeshes.set(prop.id, group);
    }
  }

  /**
   * MASTER_SPEC §14 — take exhausted harvestables out of the world.
   *
   * Diffed against what has already gone, so a depleted prop costs one pass and then
   * nothing. An instanced source is zeroed in place rather than rebuilt: the vegetation
   * layer is a handful of draw calls and it stays that way.
   */
  syncHarvestedProps(props) {
    if (!props || !this.depletedProps) return;
    for (const prop of props) {
      if (!prop.depleted || this.depletedProps.has(prop.id)) continue;
      this.depletedProps.add(prop.id);

      const mesh = this.harvestMeshes.get(prop.id);
      if (mesh) mesh.visible = false;

      for (const ref of this.instanceRefs.get(prop.source) ?? []) {
        ref.mesh.setMatrixAt(ref.index, ZERO_MATRIX);
        ref.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  _buildChunk(cx, cz, resolution = 33) {
    const key = `${cx},${cz}`;
    if (this.chunkMeshes.has(key)) return;

    const size = WORLD.chunkSize;
    const geo = new THREE.PlaneGeometry(size, size, resolution - 1, resolution - 1);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const ox = cx * size;
    const oz = cz * size;
    const colours = new Float32Array(pos.count * 3);
    const colour = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox + size / 2;
      const z = pos.getZ(i) + oz + size / 2;
      pos.setY(i, this.terrain.heightAt(x, z));

      const surface = this.terrain.surfaceAt?.(x, z) ?? 'grass';
      colour.setHex(SURFACE_COLOURS[surface] ?? SURFACE_COLOURS.grass);
      // A gentle per-vertex value shift keeps a large field of one surface from reading as
      // flat paint, without introducing a second colour.
      const variation = 1 + Math.sin(x * 0.07) * 0.03 + Math.cos(z * 0.09) * 0.03;
      colours[i * 3] = colour.r * variation;
      colours[i * 3 + 1] = colour.g * variation;
      colours[i * 3 + 2] = colour.b * variation;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.terrainMaterial);
    mesh.position.set(ox + size / 2, 0, oz + size / 2);
    mesh.receiveShadow = true;
    this.terrainGroup.add(mesh);
    this.chunkMeshes.set(key, mesh);
  }

  /** Chunk streaming with hysteresis so chunks do not thrash at the boundary (§16). */
  updateStreaming(position) {
    const size = WORLD.chunkSize;
    const load = Math.ceil(WORLD.propLoadRadius / size);
    const pcx = Math.floor(position.x / size);
    const pcz = Math.floor(position.z / size);

    for (let dz = -load; dz <= load; dz++) {
      for (let dx = -load; dx <= load; dx++) {
        if (Math.hypot(dx, dz) * size > WORLD.propLoadRadius) continue;
        this._buildChunk(pcx + dx, pcz + dz);
      }
    }

    for (const [key, mesh] of this.chunkMeshes) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.hypot((cx - pcx) * size, (cz - pcz) * size) > WORLD.propUnloadRadius) {
        this.terrainGroup.remove(mesh);
        mesh.geometry.dispose();
        this.chunkMeshes.delete(key);
      }
    }
  }

  /**
   * Prop dressing (MAP_SPEC §21.6) — crates, barrels, pumps, signs and the rest.
   *
   * VISUAL ONLY, and deliberately so: anything a player must take cover behind is a build
   * piece in the blueprint. A prop that looks like cover but is not is worse than no prop,
   * so these are kept low and small enough that nobody reads them as protection.
   */
  _setupDressing(layout, addInstances, ground) {
    const dressing = layout.dressing ?? [];
    if (dressing.length === 0) return;

    const u = TILE;
    const SHAPES = {
      crate: () => new THREE.BoxGeometry(u * 0.17, u * 0.17, u * 0.17),
      barrel: () => new THREE.CylinderGeometry(u * 0.08, u * 0.08, u * 0.2, 9),
      pallet: () => new THREE.BoxGeometry(u * 0.24, u * 0.04, u * 0.24),
      hayBale: () => new THREE.CylinderGeometry(u * 0.13, u * 0.13, u * 0.22, 9),
      bench: () => new THREE.BoxGeometry(u * 0.3, u * 0.06, u * 0.1),
      sign: () => new THREE.BoxGeometry(u * 0.26, u * 0.34, u * 0.03),
      fuelPump: () => new THREE.BoxGeometry(u * 0.12, u * 0.34, u * 0.14),
      toolRack: () => new THREE.BoxGeometry(u * 0.26, u * 0.26, u * 0.05),
      fishingRack: () => new THREE.BoxGeometry(u * 0.06, u * 0.3, u * 0.26),
      antenna: () => new THREE.CylinderGeometry(u * 0.015, u * 0.025, u * 0.7, 6),
      sandbag: () => new THREE.BoxGeometry(u * 0.22, u * 0.08, u * 0.14),
      barrier: () => new THREE.BoxGeometry(u * 0.3, u * 0.12, u * 0.05),
      trough: () => new THREE.BoxGeometry(u * 0.34, u * 0.08, u * 0.12),
      forklift: () => new THREE.BoxGeometry(u * 0.2, u * 0.22, u * 0.32)
    };
    // Lift each kind by half its own height so it rests on the ground rather than in it.
    const LIFT = {
      crate: 0.085, barrel: 0.1, pallet: 0.02, hayBale: 0.11, bench: 0.03,
      sign: 0.17, fuelPump: 0.17, toolRack: 0.13, fishingRack: 0.15,
      antenna: 0.35, sandbag: 0.04, barrier: 0.06, trough: 0.04, forklift: 0.11
    };

    const byKind = new Map();
    for (const prop of dressing) {
      if (!SHAPES[prop.kind]) continue;
      if (!byKind.has(prop.kind)) byKind.set(prop.kind, []);
      byKind.get(prop.kind).push(prop);
    }

    for (const [kind, entries] of byKind) {
      addInstances(SHAPES[kind](), PROPS[kind] ?? 0x9a9a94, entries, (d, prop) => {
        d.position.set(prop.x, ground(prop.x, prop.z) + u * (LIFT[kind] ?? 0.1), prop.z);
        d.rotation.set(0, prop.yaw, 0);
        d.scale.setScalar(1);
      });
    }
  }

  /**
   * One InstancedMesh of UNIT CUBES per material. Each wall/floor edit tile becomes one
   * instance, scaled and positioned from PieceGeometry. Any edit pattern therefore
   * renders with no new mesh type and no per-pattern geometry.
   */
  _setupBuildMeshes() {
    this.buildGroup = new THREE.Group();
    this.scene.add(this.buildGroup);

    const unitCube = new THREE.BoxGeometry(1, 1, 1);
    this.tileMeshes = new Map();
    this.surfaceMeshes = new Map();

    const perMaterial = Math.floor(BUDGET.maxBuildPieces * 9 / MATERIAL_ORDER.length);

    for (const mat of MATERIAL_ORDER) {
      const material = new THREE.MeshLambertMaterial({ color: MATERIALS[mat].color });

      const instanced = new THREE.InstancedMesh(unitCube, material, perMaterial);
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instanced.count = 0;
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.frustumCulled = false;
      this.buildGroup.add(instanced);
      this.tileMeshes.set(mat, instanced);

      // Ramps and cones are sloped surfaces; they get a rebuilt merged mesh per material.
      const surface = new THREE.Mesh(new THREE.BufferGeometry(), material);
      surface.castShadow = true;
      surface.receiveShadow = true;
      surface.frustumCulled = false;
      this.buildGroup.add(surface);
      this.surfaceMeshes.set(mat, surface);
    }
  }

  /* ── world loot — MASTER_SPEC §16, §12.1.1 ───────────────────────────────── */

  /**
   * Draw the loot that physically exists in the world.
   *
   * A weapon pickup is drawn with THE WEAPON'S OWN MODEL — the same `buildWeaponRig` part
   * list the hand and the inventory icon use (§12.1.1) — so what is on the ground is
   * recognisably what ends up in your hands. Rarity is carried by a coloured pad beneath
   * the item rather than by recolouring it, because a weapon's colours are its identity and
   * a recoloured weapon would read as a different weapon.
   *
   * Entities are diffed by id: a pickup that has not changed is never rebuilt.
   */
  syncWorldLoot(worldLoot, dt = 0) {
    if (!worldLoot) return;
    if (!this.lootGroup) {
      this.lootGroup = new THREE.Group();
      this.scene.add(this.lootGroup);
      this.lootViews = new Map();
      this.lootMaterials = new MaterialCache();
      this.lootOwned = [];
    }

    const live = new Set();
    for (const entity of worldLoot.entities) {
      // An opened container has nothing left to offer and stops being drawn; its contents
      // are already separate pickups in the world (§16.1).
      if (entity.removed || (entity.kind !== 'pickup' && entity.opened)) continue;
      live.add(entity.id);

      let view = this.lootViews.get(entity.id);
      if (!view) {
        view = this._buildLootView(entity);
        if (!view) continue;
        this.lootViews.set(entity.id, view);
        this.lootGroup.add(view.object);
      }
      if (view.spin) {
        // §16 optional polish — the entity owns the phase, the view only reads it.
        view.object.rotation.y = entity.spin ?? 0;
        view.object.position.y = view.baseY
          + Math.sin((entity.spin ?? 0) * 2) * TILE * 0.012;
      }
    }

    for (const [id, view] of [...this.lootViews]) {
      if (live.has(id)) continue;
      view.object.removeFromParent();
      this.lootViews.delete(id);
    }
    void dt;
  }

  /** One loot entity's meshes. Returns null for anything with no shape to draw. */
  _buildLootView(entity) {
    const object = new THREE.Group();
    const lift = TILE * 0.05;

    if (entity.kind === 'pickup') {
      const item = entity.item;
      if (item?.kind === 'weapon' && item.weapon) {
        const rig = buildWeaponRig(item.weapon);
        const weapon = buildRigGroup(rig, this.lootMaterials, this.lootOwned);
        // Lying flat, muzzle out: a weapon standing on its butt reads as a prop, not loot.
        weapon.rotation.set(0, 0, Math.PI / 2);
        object.add(weapon);
      } else {
        // Ammo and consumables are small crates; the rarity pad below carries the tier.
        const size = TILE * 0.06;
        object.add(new THREE.Mesh(
          new THREE.BoxGeometry(size * 1.6, size, size * 1.6),
          new THREE.MeshLambertMaterial({ color: item?.kind === 'ammo' ? 0x9a8455 : 0x8fb98f })
        ));
      }
      object.add(this._rarityPad(entity.rarityColor ?? RARITIES.common.color));
      object.position.set(entity.position.x, entity.position.y + lift, entity.position.z);
      return { object, spin: true, baseY: object.position.y };
    }

    // Containers — a chest is tall with a lid, an ammo box is low and flat, so the two are
    // told apart from across a room (§16.1).
    const chest = entity.kind === 'chest';
    const w = TILE * (chest ? 0.17 : 0.13);
    const h = TILE * (chest ? 0.12 : 0.07);
    const d = TILE * (chest ? 0.11 : 0.10);
    object.add(new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: chest ? 0x8a6b3a : 0x53603f })
    ));
    const lidMesh = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.04, h * 0.3, d * 1.04),
      new THREE.MeshLambertMaterial({ color: chest ? 0xd9b45a : 0x6f7d54 })
    );
    lidMesh.position.y = h * 0.62;
    object.add(lidMesh);
    object.position.set(entity.position.x, entity.position.y + h / 2, entity.position.z);
    return { object, spin: false, baseY: object.position.y };
  }

  /** A thin rarity-coloured disc under a pickup — the tier, readable at a glance (§16). */
  _rarityPad(colour) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(TILE * 0.075, TILE * 0.075, TILE * 0.006, 12),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55 })
    );
    pad.position.y = -TILE * 0.045;
    return pad;
  }

  /**
   * Rebuild build-piece visuals from the grid. Driven by `grid.revision`, so this runs
   * only when something actually changed — never per frame.
   */
  syncBuildGrid(grid) {
    if (grid.revision === this.lastGridRevision) return;
    this.lastGridRevision = grid.revision;

    const counts = new Map(MATERIAL_ORDER.map((m) => [m, 0]));
    const surfaceVerts = new Map(MATERIAL_ORDER.map((m) => [m, []]));

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (const piece of grid) {
      if (piece.destroyed) continue;
      const mat = piece.material;

      // Wall and floor: one instanced cube per remaining edit tile.
      for (const box of solidBoxes(piece)) {
        const mesh = this.tileMeshes.get(mat);
        const index = counts.get(mat);
        if (!mesh || index >= mesh.instanceMatrix.count) continue;

        scale.set(
          Math.max(box.max[0] - box.min[0], 1e-4),
          Math.max(box.max[1] - box.min[1], 1e-4),
          Math.max(box.max[2] - box.min[2], 1e-4)
        );
        position.set(
          (box.min[0] + box.max[0]) / 2,
          (box.min[1] + box.max[1]) / 2,
          (box.min[2] + box.max[2]) / 2
        );
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        counts.set(mat, index + 1);
      }

      if (piece.type === 'ramp') this._appendRamp(piece, surfaceVerts.get(mat));
      else if (piece.type === 'cone') this._appendCone(piece, surfaceVerts.get(mat));
    }

    for (const [mat, mesh] of this.tileMeshes) {
      mesh.count = counts.get(mat);
      mesh.instanceMatrix.needsUpdate = true;
    }

    for (const [mat, mesh] of this.surfaceMeshes) {
      const verts = surfaceVerts.get(mat);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
  }

  /** Two triangles per surviving ramp section, at that section's sloped height. */
  _appendRamp(piece, out) {
    for (const section of rampSections(piece)) {
      const { min, max, yLow, yHigh } = section;
      const ascendZ = piece.direction === 'north' || piece.direction === 'south';
      const highAtMin = piece.direction === 'north' || piece.direction === 'west';

      // Corners of this section's footprint, with height from the ascent axis.
      const yAt = (x, z) => {
        const along = ascendZ ? z : x;
        const lo = ascendZ ? min[2] : min[0];
        const hi = ascendZ ? max[2] : max[0];
        const t = (along - lo) / Math.max(hi - lo, 1e-6);
        return highAtMin ? yHigh + (yLow - yHigh) * t : yLow + (yHigh - yLow) * t;
      };

      const a = [min[0], yAt(min[0], min[2]), min[2]];
      const b = [max[0], yAt(max[0], min[2]), min[2]];
      const c = [max[0], yAt(max[0], max[2]), max[2]];
      const d = [min[0], yAt(min[0], max[2]), max[2]];
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }

  /** One triangle per surviving cone quadrant, from its outer edge up to the apex. */
  _appendCone(piece, out) {
    const o = cellOrigin(piece.cell);
    const apex = [o.x + TILE / 2, o.y + WALL_H, o.z + TILE / 2];
    for (const quad of coneQuadrants(piece)) {
      const { min, max } = quad;
      const corners = [
        [min[0], o.y, min[2]],
        [max[0], o.y, min[2]],
        [max[0], o.y, max[2]],
        [min[0], o.y, max[2]]
      ];
      // Fan the quadrant footprint up to the apex.
      for (let i = 0; i < corners.length; i++) {
        const p = corners[i];
        const q = corners[(i + 1) % corners.length];
        out.push(...p, ...q, ...apex);
      }
    }
  }

  /**
   * Placement preview (§9.2). Built from the SAME geometry source as a placed piece, so
   * preview and final cannot disagree.
   */
  _setupGhost() {
    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: 0x4cd94c, transparent: true, opacity: 0.38, depthWrite: false
    });
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMaterial);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  /** @param {{piece:object, valid:boolean}|null} preview a provisional BuildPiece */
  updateGhost(preview) {
    if (!preview) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghostMaterial.color.setHex(preview.valid ? 0x4cd94c : 0xe84c4c);

    const verts = [];
    for (const box of solidBoxes(preview.piece)) this._appendBox(box, verts);
    if (preview.piece.type === 'ramp') this._appendRamp(preview.piece, verts);
    if (preview.piece.type === 'cone') this._appendCone(preview.piece, verts);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    this.ghost.geometry.dispose();
    this.ghost.geometry = geo;
  }

  _appendBox(box, out) {
    const [x0, y0, z0] = box.min;
    const [x1, y1, z1] = box.max;
    const v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    const faces = [
      [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6],
      [4, 0, 3], [4, 3, 7], [1, 5, 6], [1, 6, 2],
      [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0]
    ];
    for (const [a, b, c] of faces) out.push(...v[a], ...v[b], ...v[c]);
  }

  /**
   * Edit overlay drawn in WORLD space on the target piece (§18), so it stays aligned as
   * the player moves rather than floating as a screen overlay.
   */
  _setupEditOverlay() {
    this.editOverlay = new THREE.Group();
    this.editOverlay.visible = false;
    this.scene.add(this.editOverlay);

    this.editMaterialIdle = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.18, depthTest: false
    });
    this.editMaterialSelected = new THREE.MeshBasicMaterial({
      color: 0x4cd94c, transparent: true, opacity: 0.45, depthTest: false
    });
  }

  /** @param {{piece:object, selection:number[], tileBoxes:Array}|null} state */
  updateEditOverlay(state) {
    this.editOverlay.clear();
    if (!state) {
      this.editOverlay.visible = false;
      return;
    }
    this.editOverlay.visible = true;

    const selected = new Set(state.selection);
    state.tileBoxes.forEach((box, index) => {
      const w = Math.max(box.max[0] - box.min[0], 0.02);
      const h = Math.max(box.max[1] - box.min[1], 0.02);
      const d = Math.max(box.max[2] - box.min[2], 0.02);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        selected.has(index) ? this.editMaterialSelected : this.editMaterialIdle
      );
      mesh.position.set(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2
      );
      mesh.renderOrder = 999;
      this.editOverlay.add(mesh);
    });
  }

  /**
   * Storm visuals — BATTLE_ROYALE_SPEC §8.4.
   *
   * A visible wall, not colour grading: a tall cylinder rendered from the inside, plus a
   * ground ring marking the safe zone and a dashed ring for the next one. Simulation
   * values are read, never written.
   */
  _setupStorm() {
    this.stormGroup = new THREE.Group();
    this.scene.add(this.stormGroup);

    const wallGeo = new THREE.CylinderGeometry(1, 1, STORM_WALL_HEIGHT, 64, 1, true);
    this.stormWallMaterial = new THREE.MeshBasicMaterial({
      color: 0x9b4cdd, transparent: true, opacity: 0.22,
      side: THREE.BackSide, depthWrite: false
    });
    this.stormWall = new THREE.Mesh(wallGeo, this.stormWallMaterial);
    this.stormWall.visible = false;
    this.stormGroup.add(this.stormWall);

    // Safe-zone ring on the ground, so the boundary reads from above too.
    const ringGeo = new THREE.RingGeometry(0.98, 1.0, 96);
    ringGeo.rotateX(-Math.PI / 2);
    this.stormRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false
    }));
    this.stormRing.visible = false;
    this.stormGroup.add(this.stormRing);

    const nextGeo = new THREE.RingGeometry(0.985, 1.0, 96);
    nextGeo.rotateX(-Math.PI / 2);
    this.nextZoneRing = new THREE.Mesh(nextGeo, new THREE.MeshBasicMaterial({
      color: 0x45c8e8, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false
    }));
    this.nextZoneRing.visible = false;
    this.stormGroup.add(this.nextZoneRing);
  }

  /**
   * @param {object|null} storm  snapshot from Storm.snapshot()
   * @param {boolean} playerInside
   */
  updateStorm(storm, playerInside = true) {
    if (!storm || storm.state === 'idle' || storm.radius <= 0) {
      this.stormWall.visible = false;
      this.stormRing.visible = false;
      this.nextZoneRing.visible = false;
      this.scene.fog.color.setHex(PALETTE.sky);
      this.scene.background.setHex(PALETTE.sky);
      return;
    }

    const r = Math.max(0.5, storm.radius);
    this.stormWall.visible = true;
    this.stormWall.position.set(storm.centre.x, STORM_WALL_HEIGHT / 2 - WALL_H, storm.centre.z);
    this.stormWall.scale.set(r, 1, r);

    this.stormRing.visible = true;
    this.stormRing.position.set(storm.centre.x, 0.4, storm.centre.z);
    this.stormRing.scale.set(r, 1, r);

    const showNext = storm.nextRadius > 0 && storm.nextRadius < storm.radius;
    this.nextZoneRing.visible = showNext;
    if (showNext) {
      this.nextZoneRing.position.set(storm.nextCentre.x, 0.5, storm.nextCentre.z);
      this.nextZoneRing.scale.set(storm.nextRadius, 1, storm.nextRadius);
    }

    // §8.4 — being inside the storm must be unmistakable from the world itself, not only
    // from the HUD. The sky and fog shift, on top of the wall that is already visible.
    const target = playerInside ? PALETTE.sky : 0x5b2d80;
    this.scene.fog.color.setHex(target);
    this.scene.background.setHex(target);
    this.stormWallMaterial.opacity = playerInside ? 0.22 : 0.34;
  }

  /**
   * The player avatar — ITEM_SHOP_SPEC §8.2 requires the equipped outfit to actually
   * appear in a match, and a third-person camera needs something to look at.
   *
   * Built from the outfit's catalog palette, so equipping a different outfit visibly
   * changes the character. Dimensions derive from the movement capsule, never literals,
   * so the avatar always matches the collision shape it represents.
   */
  /** SKIN_SPEC §10 — the in-match character, built from the equipped skin's rig. */
  _setupAvatar() {
    this.character = new CharacterView();
    this.character.setSkin(DEFAULT_EQUIPPED.outfit);
    this.avatar = this.character.object3D;
    this.scene.add(this.avatar);
  }

  /**
   * Apply the equipped outfit. Takes the catalog cosmetic; its id is the skin id, and an
   * unknown or missing one falls back to a valid skin rather than leaving the player
   * invisible (SKIN_SPEC §7).
   */
  setAvatarCosmetics(outfit, pickaxe = null) {
    this.character.setSkin(outfit?.id ?? DEFAULT_EQUIPPED.outfit);
    this.character.setTool(pickaxe?.id ?? DEFAULT_EQUIPPED.pickaxe);
  }

  /**
   * @param {object} player  PlayerController
   * @param {boolean} visible  hidden during freefall, where the descent owns the view
   */
  updateAvatar(player, visible = true, equipped = null) {
    if (!this.character) return;
    this.character.visible = visible;
    if (!visible) return;
    // Crouching squashes the character exactly as it squashes the capsule.
    this.character.place(player.position, player.yaw, player.height);
    // MASTER_SPEC §15.4 — the hand is told what the inventory says, every frame. Swing
    // progress inside it comes from the pickaxe cooldown, so the animation rides the
    // gameplay swing rate rather than a clock of its own.
    if (equipped) this.character.setEquipped(equipped);
  }

  syncCamera(playerCamera) {
    if (this.sky) {
      // Centre the dome on the viewer: a fixed dome is one the player can walk out of.
      this.sky.position.set(playerCamera.position.x, 0, playerCamera.position.z);
      this._fitSkyToCamera();
    }
    this.camera.position.set(
      playerCamera.position.x, playerCamera.position.y, playerCamera.position.z
    );
    const d = playerCamera.lookDirection;
    this.camera.lookAt(
      playerCamera.position.x + d.x,
      playerCamera.position.y + d.y,
      playerCamera.position.z + d.z
    );
    if (Math.abs(this.camera.fov - playerCamera.fov) > 0.01) {
      this.camera.fov = playerCamera.fov;
      this.camera.updateProjectionMatrix();
    }
    this.sun.target.position.set(playerCamera.position.x, 0, playerCamera.position.z);
    this.sun.target.updateMatrixWorld();
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** §19 — render distance is a user setting, applied as a multiplier. */
  setRenderDistance(multiplier) {
    this.camera.far = WORLD.terrainDrawDistance * multiplier;
    this.camera.updateProjectionMatrix();
    if (this.scene.fog) {
      this.scene.fog.near = WORLD.propLoadRadius * 0.6 * multiplier;
      this.scene.fog.far = this.camera.far;
    }
  }

  setQuality(level) {
    // §23 — shadows and pixel ratio are the first things to shed under load.
    const shadowSize = { low: 0, medium: 1024, high: 2048 }[level] ?? 2048;
    this.renderer.shadowMap.enabled = shadowSize > 0;
    if (shadowSize > 0 && this.sun) this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, level === 'low' ? 1 : 2));
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls() {
    return this.renderer.info.render.calls;
  }
}
