import * as THREE from 'three';
import { Assets } from './Assets.js';
import { LODGroup } from '../utils/LODGroup.js';
import {
  CHUNK_SIZE,
  WATER_LEVEL,
  Surface,
  surfaceHex,
  surfaceAt,
  heightAt,
  riverCenterX,
  structuresInChunk,
  buildingsForChunk,
  scatterForChunk,
  doorPointOf,
} from './WorldConfig.js';

// Big hero structures get a per-object LOD (full mesh near, billboard far).
const HERO_LOD = {
  pagoda: { color: 0x6b6f76, size: 18, far: 60, cull: 150 },
  shrine: { color: 0x7c3b32, size: 12, far: 70, cull: 150 },
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _color = new THREE.Color();
const _tmpColor = new THREE.Color();

// A single streamed tile of the world. Holds its own terrain mesh, water,
// buildings, and instanced scatter, plus the colliders & interaction
// triggers that fall inside it. Knows how to fully dispose itself.
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.minX = cx * CHUNK_SIZE;
    this.minZ = cz * CHUNK_SIZE;
    this.group = new THREE.Group();
    this.group.name = `chunk_${cx}_${cz}`;

    this.colliders = [];
    this.triggers = [];

    this._uniqueGeoms = []; // per-chunk geometry we must dispose (terrain, water)
    this._instanced = []; // { type, lodType, mesh }
    this._unique = []; // unique nodes (signs, koi water) to disposeNode
    this._lodGroups = []; // LODGroup helpers to dispose

    this.lod = -1; // unset
    this.built = false;
    this._scatter = null;
  }

  // Build everything synchronously. ChunkManager calls this from a
  // time-budgeted queue so several chunks finish across a few frames.
  build(lod) {
    this.lod = lod;
    this._buildTerrain();
    this._buildWater();
    // compute region buildings once, reuse for both placement + scatter masking
    this._buildings = buildingsForChunk(this.cx, this.cz);
    this._buildStructures();
    this._scatter = scatterForChunk(this.cx, this.cz, this._buildings);
    this._buildScatter();
    this._addTreeColliders(); // trunks block the player (built once; survives LOD swaps)
    this.built = true;
  }

  // Circle collider per scattered TREE trunk so the player/NPCs can't walk
  // through them. Tagged `slim` so enemy A* ignores them (they just get pushed
  // out by collision) — keeps pathfinding cheap. `top` lets you fly over.
  _addTreeColliders() {
    const sc = this._scatter;
    if (!sc || !sc.trees) return;
    for (const t of sc.trees) {
      for (const it of t.list) {
        this.colliders.push({ type: 'circle', x: it.x, z: it.z, r: 0.42 * (it.scale || 1), top: 4, slim: true });
      }
    }
  }

  // -----------------------------------------------------------------
  _buildTerrain() {
    const seg = 12;
    const n = seg + 1;
    const TILE = 8; // ground texture repeats every 8 world units
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const lx = (i / seg) * CHUNK_SIZE;
        const lz = (j / seg) * CHUNK_SIZE;
        const wx = this.minX + lx;
        const wz = this.minZ + lz;
        const k = (j * n + i) * 3;
        positions[k] = lx;
        positions[k + 1] = heightAt(wx, wz);
        positions[k + 2] = lz;
        this._surfaceColor(wx, wz, _color);
        colors[k] = _color.r;
        colors[k + 1] = _color.g;
        colors[k + 2] = _color.b;
        const u = (j * n + i) * 2;
        uvs[u] = wx / TILE; // world-scaled UVs → seamless tiling across chunks
        uvs[u + 1] = wz / TILE;
      }
    }
    const indices = [];
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, Assets.mat.terrain);
    mesh.position.set(this.minX, 0, this.minZ);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    this._uniqueGeoms.push(geo);
  }

  _surfaceColor(wx, wz, out) {
    const surf = surfaceAt(wx, wz);
    out.set(surfaceHex(wx, wz, surf)); // region-aware grass/path palette
    if (surf === Surface.GRASS) {
      // subtle per-vertex variation so the ground isn't flat
      const v = (Math.sin(wx * 1.7) * Math.cos(wz * 1.3)) * 0.06;
      out.offsetHSL(0.0, 0.0, v);
    }
    return out;
  }

  _buildWater() {
    // River water plane (only for chunks the river passes through).
    const cxCenter = this.minX + CHUNK_SIZE / 2;
    const rc0 = riverCenterX(this.minZ);
    const rc1 = riverCenterX(this.minZ + CHUNK_SIZE);
    const near = Math.min(Math.abs(rc0 - cxCenter), Math.abs(rc1 - cxCenter));
    if (near < CHUNK_SIZE) {
      const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
      geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, Assets.mat.water);
      water.position.set(cxCenter, WATER_LEVEL, this.minZ + CHUNK_SIZE / 2);
      water.receiveShadow = false;
      water.renderOrder = 1;
      this.group.add(water);
      this._uniqueGeoms.push(geo);
    }
  }

  _buildStructures() {
    for (const s of structuresInChunk(this.cx, this.cz)) {
      const obj = Assets.buildStructure(s);
      // The bridge spans the river channel at street level; everything else
      // sits on the terrain. (groundHeightAt mirrors this for the player.)
      const baseY = s.type === 'bridge' ? 0 : heightAt(s.x, s.z) - 0.05;
      obj.position.set(s.x, baseY, s.z);
      obj.rotation.y = s.rot || 0;

      // hero LOD wrapping
      const hero = HERO_LOD[s.type];
      if (hero) {
        const lod = new LODGroup();
        lod.add(obj, 0);
        lod.billboard(hero.color, hero.size, hero.far);
        lod.cull(hero.cull);
        lod.object.position.copy(obj.position);
        obj.position.set(0, 0, 0); // obj is now relative to the LOD node
        this.group.add(lod.object);
        this._lodGroups.push(lod);
      } else {
        this.group.add(obj);
      }

      // anything flagged unique inside the structure must be tracked
      obj.traverse((c) => {
        if (c.userData && c.userData.disposable) this._unique.push(c);
      });

      this._addColliders(s);
      this._addTriggers(s);
    }

    // Region buildings — procedural per-country architecture filling the world.
    // Shared cached geometry + the shared `world` material → cheap to stream;
    // they only add a box collider (not enterable, no triggers).
    for (const s of this._buildings) {
      const obj = Assets.buildRegionStructure(s);
      obj.position.set(s.x, heightAt(s.x, s.z) - 0.05, s.z);
      obj.rotation.y = s.rot || 0;
      this.group.add(obj);
      this._addColliders(s);
    }
  }

  _addColliders(s) {
    const yTop = (s.h || 3) + heightAt(s.x, s.z);
    if (s.collide === 'box') {
      this.colliders.push({
        type: 'box',
        minX: s.x - s.hw,
        maxX: s.x + s.hw,
        minZ: s.z - s.hd,
        maxZ: s.z + s.hd,
        top: yTop,
      });
    } else if (s.collide === 'circle') {
      this.colliders.push({ type: 'circle', x: s.x, z: s.z, r: Math.max(s.hw, s.hd), top: yTop });
    } else if (s.collide === 'gate') {
      // two pillars
      const off = s.hw * 0.9;
      const cos = Math.cos(s.rot || 0);
      const sin = Math.sin(s.rot || 0);
      for (const sx of [-off, off]) {
        this.colliders.push({
          type: 'circle',
          x: s.x + sx * cos,
          z: s.z - sx * sin,
          r: 0.7,
          top: yTop,
        });
      }
    }
    if (s.type === 'bridge') {
      // thin rail colliders along both deck edges so you can't walk off the side
      for (const sz of [-1, 1]) {
        const cz = s.z + sz * 2.65;
        this.colliders.push({
          type: 'box',
          minX: s.x - s.hw,
          maxX: s.x + s.hw,
          minZ: cz - 0.15,
          maxZ: cz + 0.15,
          top: 4,
        });
      }
    }
  }

  _addTriggers(s) {
    if (s.enter && s.interior) {
      const d = doorPointOf(s);
      this.triggers.push({
        kind: 'door',
        x: d.x,
        z: d.z,
        r: 3.0,
        yaw: d.yaw,
        interior: s.interior,
        id: s.id,
        label: 'Press E to enter',
      });
    }
    if (s.type === 'sign') {
      this.triggers.push({
        kind: 'sign',
        x: s.x,
        z: s.z,
        r: 2.6,
        text: s.text || '',
        id: s.id,
        label: 'Press E to read',
      });
    }
  }

  // -----------------------------------------------------------------
  _buildScatter() {
    const sc = this._scatter;
    const treeLod = this.lod === 0 ? 0 : 1;
    // region trees (sakura/pine, palm/banyan, bamboo, oak/cactus, …)
    for (const t of sc.trees) this._addInstanced(t.type, treeLod, t.list);
    if (this.lod === 0) {
      this._addInstanced('grass', 0, sc.grass);
      this._addInstanced('rice', 0, sc.rice);
    }
  }

  _addInstanced(type, lod, list) {
    if (!list || !list.length) return;
    const geo = Assets.propGeometry(type, lod);
    const mesh = new THREE.InstancedMesh(geo, Assets.mat.foliage, list.length); // wind sway
    // Instances live in world space; per-chunk culling is handled by the
    // load radius, so we skip (incorrect) single-sphere frustum culling.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      _q.setFromAxisAngle(_up, it.rot);
      _s.set(it.scale, it.scale, it.scale);
      _v.set(it.x, it.y, it.z);
      _m.compose(_v, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this._instanced.push({ type, lod, mesh });
  }

  // -----------------------------------------------------------------
  // LOD transitions: when a chunk moves between detail bands we rebuild
  // only the scatter (cheap) rather than the whole chunk.
  setLOD(lod) {
    if (!this.built || lod === this.lod) return;
    const prev = this.lod;
    this.lod = lod;
    // remove existing instanced scatter
    for (const inst of this._instanced) {
      this.group.remove(inst.mesh);
      inst.mesh.dispose();
    }
    this._instanced.length = 0;
    this._buildScatter();
  }

  // -----------------------------------------------------------------
  dispose() {
    // instanced meshes: free instance buffers (geometry/material are shared)
    for (const inst of this._instanced) inst.mesh.dispose();
    this._instanced.length = 0;
    // unique per-chunk geometries (terrain, water planes)
    for (const g of this._uniqueGeoms) g.dispose();
    this._uniqueGeoms.length = 0;
    // unique nodes: 'geo' → dispose only geometry (material is shared, e.g. koi
    // water); true → dispose geometry + material + textures (signs).
    for (const n of this._unique) {
      n.geometry?.dispose();
      if (n.userData.disposable === 'geo') continue;
      const m = n.material;
      if (m) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
    this._unique.length = 0;
    // LOD billboard cards
    for (const l of this._lodGroups) l.dispose();
    this._lodGroups.length = 0;

    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
    this.colliders.length = 0;
    this.triggers.length = 0;
    this.built = false;
  }
}
