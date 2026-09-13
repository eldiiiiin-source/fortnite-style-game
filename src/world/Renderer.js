/**
 * Renderer.js — the three.js view layer. MASTER_SPEC §11.2, MAP_SPEC §8, §9.
 *
 * This is the ONLY module in src/ that owns three.js scene objects for the world. The
 * simulation never reads from here (CLAUDE.md: rendering stays out of simulation).
 */
import * as THREE from 'three';
import { WORLD, BUDGET, MATERIALS, BUILD, PIECE_TYPES, MATERIAL_ORDER } from '../core/Config.js';

const MAX_INSTANCES = BUDGET.maxBuildPieces;

export class Renderer {
  constructor(container, terrain) {
    this.terrain = terrain;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fb6d9);
    this.scene.fog = new THREE.FogExp2(0x8fb6d9, 0.0018); // MAP_SPEC §8

    this.camera = new THREE.PerspectiveCamera(80, 1, 0.1, WORLD.terrainDrawDistance);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this._setupLighting();
    this._setupTerrain();
    this._setupBuildInstances();
    this._setupGhost();

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  get domElement() {
    return this.renderer.domElement;
  }

  _setupLighting() {
    // MAP_SPEC §8 — Noon preset: sun elevation 68 degrees, 4 shadow cascades approximated
    // by one directional light with a wide ortho frustum.
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    const elevation = 68 * Math.PI / 180;
    sun.position.set(Math.cos(elevation) * 300, Math.sin(elevation) * 300, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 220; // MAP_SPEC §8 — shadow max distance
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 900 });
    this.scene.add(sun);
    this.sun = sun;

    this.scene.add(new THREE.HemisphereLight(0xbdd7f5, 0x4a5340, 0.7));
  }

  /**
   * Build visible terrain chunks around the origin. MAP_SPEC §9 — chunked, LOD'd.
   * Only chunks within propLoadRadius of the player are meshed.
   */
  _setupTerrain() {
    this.terrainGroup = new THREE.Group();
    this.scene.add(this.terrainGroup);
    this.chunkMeshes = new Map();

    this.terrainMaterial = new THREE.MeshLambertMaterial({ color: 0x6f8f52 });

    // Ocean plane at sea level.
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.worldExtent, WORLD.worldExtent),
      new THREE.MeshLambertMaterial({ color: 0x2e5f82, transparent: true, opacity: 0.85 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = WORLD.seaLevel;
    this.scene.add(ocean);
  }

  /** Mesh one terrain chunk at a given LOD. MAP_SPEC §9 */
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

  /** Stream chunks around a world position. MAP_SPEC §9 */
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

    // Unload beyond the unload radius (hysteresis, so chunks do not thrash at the edge).
    for (const [key, mesh] of this.chunkMeshes) {
      const [cx, cz] = key.split(',').map(Number);
      const dist = Math.hypot((cx - pcx) * size, (cz - pcz) * size);
      if (dist > WORLD.propUnloadRadius) {
        this.terrainGroup.remove(mesh);
        mesh.geometry.dispose();
        this.chunkMeshes.delete(key);
      }
    }
  }

  /**
   * One InstancedMesh per (pieceType, material). MASTER_SPEC §11.2.
   * Edit patterns are handled by swapping the instance's geometry group in a later pass;
   * v0.1 renders every piece in its full form and hides edited tiles with a decal.
   */
  _setupBuildInstances() {
    this.buildGroup = new THREE.Group();
    this.scene.add(this.buildGroup);
    this.instanced = new Map();

    const geometries = {
      wall: new THREE.BoxGeometry(BUILD.tileSize, BUILD.wallHeight, BUILD.thickness),
      floor: new THREE.BoxGeometry(BUILD.tileSize, BUILD.thickness, BUILD.tileSize),
      ramp: this._rampGeometry(),
      cone: this._coneGeometry()
    };

    for (const type of PIECE_TYPES) {
      for (const mat of MATERIAL_ORDER) {
        const material = new THREE.MeshLambertMaterial({ color: MATERIALS[mat].color });
        const perCombo = Math.floor(MAX_INSTANCES / (PIECE_TYPES.length * MATERIAL_ORDER.length));
        const mesh = new THREE.InstancedMesh(geometries[type], material, perCombo);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.buildGroup.add(mesh);
        this.instanced.set(`${type}:${mat}`, mesh);
      }
    }
  }

  /** Ramp: 3.84 m rise over 5.12 m run. references/building/01-piece-geometry.md */
  _rampGeometry() {
    const T = BUILD.tileSize, H = BUILD.wallHeight;
    const geo = new THREE.BufferGeometry();
    const v = new Float32Array([
      // Sloped top surface (two triangles)
      -T / 2, 0, T / 2, T / 2, 0, T / 2, T / 2, H, -T / 2,
      -T / 2, 0, T / 2, T / 2, H, -T / 2, -T / 2, H, -T / 2,
      // Back face
      -T / 2, 0, -T / 2, T / 2, 0, -T / 2, T / 2, H, -T / 2,
      -T / 2, 0, -T / 2, T / 2, H, -T / 2, -T / 2, H, -T / 2,
      // Left side
      -T / 2, 0, T / 2, -T / 2, H, -T / 2, -T / 2, 0, -T / 2,
      // Right side
      T / 2, 0, T / 2, T / 2, 0, -T / 2, T / 2, H, -T / 2
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    geo.computeVertexNormals();
    geo.translate(0, 0, 0);
    return geo;
  }

  /** Cone: pyramid with apex at the cell centre top. */
  _coneGeometry() {
    const T = BUILD.tileSize, H = BUILD.wallHeight;
    const geo = new THREE.ConeGeometry(T / Math.SQRT2, H, 4);
    geo.rotateY(Math.PI / 4);
    geo.translate(0, H / 2, 0);
    return geo;
  }

  /** Rebuild instance transforms from the build grid. Called when the grid changes. */
  syncBuildGrid(grid) {
    const counts = new Map();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();

    for (const mesh of this.instanced.values()) mesh.count = 0;

    for (const piece of grid) {
      if (piece.destroyed) continue;
      const key = `${piece.type}:${piece.material}`;
      const mesh = this.instanced.get(key);
      if (!mesh) continue;

      const idx = counts.get(key) ?? 0;
      if (idx >= mesh.instanceMatrix.count) continue; // over budget, skip

      const c = piece.worldCentre;
      let yaw = 0;
      switch (piece.direction) {
        case 'east': yaw = Math.PI / 2; break;
        case 'south': yaw = Math.PI; break;
        case 'west': yaw = -Math.PI / 2; break;
        default: yaw = 0;
      }

      if (piece.type === 'wall') {
        // Walls sit on the cell face, not at the cell centre.
        const half = BUILD.tileSize / 2;
        const off = { north: [0, -half], south: [0, half], east: [half, 0], west: [-half, 0] };
        const [dx, dz] = off[piece.direction] ?? [0, -half];
        p.set(c.x + dx, c.y, c.z + dz);
      } else if (piece.type === 'floor') {
        p.set(c.x, piece.cell.cy * BUILD.wallHeight, c.z);
      } else {
        p.set(c.x, piece.cell.cy * BUILD.wallHeight, c.z);
      }

      e.set(0, yaw, 0);
      q.setFromEuler(e);
      m.compose(p, q, one);
      mesh.setMatrixAt(idx, m);
      counts.set(key, idx + 1);
    }

    for (const [key, mesh] of this.instanced) {
      mesh.count = counts.get(key) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Translucent placement preview. MASTER_SPEC §6.3 rule 3. */
  _setupGhost() {
    const geo = new THREE.BoxGeometry(BUILD.tileSize, BUILD.wallHeight, BUILD.thickness);
    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: 0x4cd94c, transparent: true, opacity: 0.35, depthWrite: false
    });
    this.ghost = new THREE.Mesh(geo, this.ghostMaterial);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  /** @param {{position:object, yaw:number, valid:boolean} | null} target */
  updateGhost(target) {
    if (!target) {
      this.ghost.visible = false;
      return;
    }
    this.ghost.visible = true;
    this.ghost.position.set(target.position.x, target.position.y, target.position.z);
    this.ghost.rotation.y = target.yaw ?? 0;
    // §6.3 rule 3 — green placeable, red blocked.
    this.ghostMaterial.color.setHex(target.valid ? 0x4cd94c : 0xe84c4c);
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
    // Keep the sun's shadow frustum centred on the player.
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

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  get drawCalls() {
    return this.renderer.info.render.calls;
  }
}
