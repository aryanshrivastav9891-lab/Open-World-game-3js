import * as THREE from 'three';

// A thin convenience wrapper around THREE.LOD.
//
// THREE.LOD already does distance-based mesh swapping and frustum culling for
// us; this helper just makes it ergonomic to declare levels and to build a
// cheap camera-facing "billboard" far level from a colour.
//
// Usage:
//   const lod = new LODGroup()
//     .add(highMesh, 0)
//     .add(lowMesh, 40)
//     .billboard(0xffb7c5, 1.5, 90)   // far card
//     .cull(140);                     // nothing rendered past 140 units
//
// Internally `lod.object` is a THREE.LOD you add to the scene.
export class LODGroup {
  constructor() {
    this.object = new THREE.LOD();
    this._owned = []; // resources this group is responsible for disposing
    this._maxDistance = Infinity;
  }

  // Add a pre-built mesh as a level visible from `distance` outward.
  add(mesh, distance = 0, { own = false } = {}) {
    this.object.addLevel(mesh, distance);
    if (own) this._track(mesh);
    return this;
  }

  // Add a flat, camera-facing card as a cheap far-distance level.
  billboard(color, size, distance, { opacity = 1 } = {}) {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: opacity >= 1,
      fog: true,
    });
    const sprite = new THREE.Mesh(geo, mat);
    // Lift so the card roughly sits where a prop would.
    sprite.position.y = size * 0.5;
    // Cheap billboarding: face the camera on Y only via onBeforeRender.
    sprite.onBeforeRender = (renderer, scene, camera) => {
      sprite.getWorldPosition(_tmpA);
      camera.getWorldPosition(_tmpB);
      const dx = _tmpB.x - _tmpA.x;
      const dz = _tmpB.z - _tmpA.z;
      sprite.rotation.y = Math.atan2(dx, dz);
    };
    this.object.addLevel(sprite, distance);
    this._track(sprite);
    return this;
  }

  // Add an empty level at `distance` so the LOD renders nothing past it.
  cull(distance) {
    this._maxDistance = distance;
    this.object.addLevel(new THREE.Object3D(), distance);
    return this;
  }

  _track(mesh) {
    this._owned.push(mesh);
  }

  // Recompute which level is visible. THREE.LOD does this in onBeforeRender
  // automatically, but exposing it lets the ChunkManager force-update.
  update(camera) {
    this.object.update(camera);
  }

  // Dispose only resources this group created (billboards). Pre-built meshes
  // passed via add() with own:false are owned elsewhere (the shared library).
  dispose() {
    for (const mesh of this._owned) {
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
    this._owned.length = 0;
  }
}

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
