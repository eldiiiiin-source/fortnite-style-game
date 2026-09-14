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
  TILE, WALL_H, BUDGET, MATERIALS, MATERIAL_ORDER, WORLD, CAMERA
} from '../core/Config.js';
import { solidBoxes, rampSections, coneQuadrants, cellOrigin } from '../building/PieceGeometry.js';
import { CharacterView } from './CharacterView.js';
import { DEFAULT_EQUIPPED } from '../meta/CosmeticCatalog.js';

/** Storm wall height — tall enough to read from the ground at any build height. */
const STORM_WALL_HEIGHT = WALL_H * 30;

/** MAP_SPEC §10 palette — bright, clean, stylised. */
const PALETTE = Object.freeze({
  sky: 0x8fc4e8,
  grass: 0x6faa4a,
  rock: 0x9a9a94,
  water: 0x3fb9c9,
  sun: 0xfff6e6,
  ambientSky: 0xbdd7f5,
  ambientGround: 0x5a6b45
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

  /** MAP_SPEC §10 — soft sunlight, readable shadows, clear silhouettes. */
  _setupLighting() {
    const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
    const elevation = 55 * Math.PI / 180;
    sun.position.set(Math.cos(elevation) * 200, Math.sin(elevation) * 200, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = TILE * 44;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 800 });
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.scene.add(new THREE.HemisphereLight(PALETTE.ambientSky, PALETTE.ambientGround, 0.75));
  }

  _setupTerrain() {
    this.terrainGroup = new THREE.Group();
    this.scene.add(this.terrainGroup);
    this.chunkMeshes = new Map();
    this.terrainMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.grass });

    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.regionExtent * 3, WORLD.regionExtent * 3),
      new THREE.MeshLambertMaterial({ color: PALETTE.water, transparent: true, opacity: 0.82 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WORLD.seaLevel - 0.05;
    this.scene.add(water);
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
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + ox + size / 2;
      const z = pos.getZ(i) + oz + size / 2;
      pos.setY(i, this.terrain.heightAt(x, z));
    }
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
  setAvatarCosmetics(outfit) {
    this.character.setSkin(outfit?.id ?? DEFAULT_EQUIPPED.outfit);
  }

  /**
   * @param {object} player  PlayerController
   * @param {boolean} visible  hidden during freefall, where the descent owns the view
   */
  updateAvatar(player, visible = true) {
    if (!this.character) return;
    this.character.visible = visible;
    if (!visible) return;
    // Crouching squashes the character exactly as it squashes the capsule.
    this.character.place(player.position, player.yaw, player.height);
  }

  syncCamera(playerCamera) {
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
