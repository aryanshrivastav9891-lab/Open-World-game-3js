import * as THREE from 'three';
import { groundHeightAt, surfaceAt, Surface, blockedByStructure } from './WorldConfig.js';

// =====================================================================
//  NatureManager — scatters REAL three.js example nature models across the
//  world to make it beautiful: low-poly trees (models/obj/tree.obj) in groves
//  plus flower patches (models/gltf/Flower/Flower.glb). Each is loaded once via
//  ModelLibrary and placed as independent instances that SHARE the cached
//  geometry + materials (cheap). Placement avoids water + buildings, varies
//  scale/rotation for a natural look, and seats each model on the ground.
//  Graceful: if an asset can't load, nothing is planted and the procedural
//  streamed foliage (Chunk/Assets) is untouched. Static — no per-frame update.
//
//  HOW TO ADD A GROVE: add an { x, z } to GROVES below.
// =====================================================================
const TAU = Math.PI * 2;
const GROVES = [
  { x: 40, z: -34 }, { x: -52, z: -22 }, { x: 72, z: 58 }, { x: -74, z: 70 },
  { x: 24, z: 92 }, { x: -34, z: -92 }, { x: 112, z: -58 }, { x: -112, z: -48 },
];

export class NatureManager {
  constructor(scene, models) {
    this.scene = scene;
    this.models = models;
    this.items = [];
    this._mtnGeos = [];
    this._mtnMat = null;
    models.onReady('tree', (d) => { if (d) this._plant('tree', 8, 16, 0.7, 0.7); });
    models.onReady('flower', (d) => { if (d) this._plant('flower', 10, 12, 0.8, 0.8); });
    this._buildMountains(); // procedural modeled peaks on the horizon (always available)
  }

  // Big modeled mountains ringing the world: displaced cones with brown rock
  // shading into white snow caps. Distant scenery (no colliders, no shadow cost).
  _buildMountains() {
    const PEAKS = [
      { x: 235, z: 60, h: 84, r: 60 }, { x: -248, z: -30, h: 96, r: 70 },
      { x: 60, z: 268, h: 88, r: 64 }, { x: -70, z: -272, h: 92, r: 66 },
      { x: 285, z: -190, h: 104, r: 78 }, { x: -200, z: 210, h: 90, r: 62 },
    ];
    this._mtnMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
    const v = new THREE.Vector3();
    for (const p of PEAKS) {
      const geo = new THREE.ConeGeometry(p.r, p.h, 11, 6);
      const pos = geo.attributes.position;
      const col = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const n = (Math.sin(v.x * 0.25) + Math.cos(v.z * 0.25) + Math.sin((v.x + v.z) * 0.13)) * 0.07; // rugged ridges
        v.x *= 1 + n; v.z *= 1 + n;
        pos.setXYZ(i, v.x, v.y, v.z);
        const hy = (v.y + p.h / 2) / p.h; // 0 base → 1 apex
        if (hy > 0.62) col.push(0.92, 0.94, 0.98); // snow cap
        else { const k = 0.26 + hy * 0.22; col.push(0.30 + k, 0.26 + k * 0.85, 0.22 + k * 0.7); } // rock
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this._mtnMat);
      m.position.set(p.x, groundHeightAt(p.x, p.z) + p.h / 2 - 2, p.z);
      m.frustumCulled = true;
      this.scene.add(m);
      this.items.push(m);
      this._mtnGeos.push(geo);
    }
  }

  _spot(cx, cz, spread) {
    for (let t = 0; t < 8; t++) {
      const a = Math.random() * TAU, r = Math.random() * spread;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (surfaceAt(x, z) !== Surface.WATER && !blockedByStructure(x, z, 2)) return { x, z };
    }
    return null;
  }

  // Plant `perGrove` instances of `name` in each grove. `varBase`+`varRange` give
  // each a random scale (varBase .. varBase+varRange) × the model's fit factor.
  _plant(name, perGrove, spread, varBase, varRange) {
    for (const g of GROVES) {
      const n = perGrove + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        const s = this._spot(g.x, g.z, spread);
        if (!s) continue;
        const inst = this.models.instance(name);
        if (!inst) return; // model gone → stop (graceful)
        const variation = varBase + Math.random() * varRange;
        inst.scene.scale.multiplyScalar(inst.factor * variation);
        inst.scene.position.set(s.x, groundHeightAt(s.x, s.z) + inst.groundOffset * variation, s.z);
        inst.scene.rotation.y = Math.random() * TAU;
        inst.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = true; }); // static decor → allow culling
        this.scene.add(inst.scene);
        this.items.push(inst.scene);
      }
    }
  }

  dispose() {
    // tree/flower instances share cached geometry/materials (owned by
    // ModelLibrary) → just detach; the mountains own their geometry + material.
    for (const o of this.items) this.scene.remove(o);
    for (const g of this._mtnGeos) g.dispose();
    if (this._mtnMat) this._mtnMat.dispose();
    this._mtnGeos.length = 0;
    this.items.length = 0;
  }
}
