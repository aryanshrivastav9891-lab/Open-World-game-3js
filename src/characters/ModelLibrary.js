import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { tryLoadGLB, tryLoadFBX, tryLoadMD2, tryLoadOBJ, tryLoadTexture } from '../assets/Loaders.js';

// =====================================================================
//  ModelLibrary — loads real, animated, textured glTF characters from the
//  official three.js example assets (served by the CORS-enabled jsDelivr
//  mirror) and hands out independent INSTANCES (SkeletonUtils.clone, so each
//  one has its own skeleton + can run its own AnimationMixer).
//
//  Everything is GRACEFUL: tryLoadGLB() resolves to null on a missing/blocked
//  asset, so callers keep their procedural fallback mesh and the game runs
//  fully offline. Each model is height-normalised so it lines up with the
//  procedural avatar regardless of its native scale.
//
//  ---------------------------------------------------------------------
//  HOW TO ADD A NEW AVATAR MODE / CHARACTER MODEL (a few lines):
//    1. Add an entry to MODEL_SPECS below:
//         myhero: { url: '<CORS .glb url>', height: 1.85, faceFix: Math.PI, label: 'My Hero' }
//       (faceFix rotates the model so its front faces the player's forward = -Z;
//        most three.js sample models need Math.PI.)
//    2. Add its key to Player.avatarModes (cycle with T), or pass it to
//       NPCManager.setModels([...]) / BossManager's boss model. Animations,
//       cloning, height-fit and fallback are automatic.
//  ---------------------------------------------------------------------
// =====================================================================

const EXAMPLES = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/';
const BASE = EXAMPLES + 'models/gltf/';

// `target`+`fit` height-normalize each model; `faceFix` rotates the model so its
// front faces the player's forward (−Z). NOTE: these differ per model — Soldier
// is authored facing −Z (faceFix 0), the Mixamo-style X-Bot + RobotExpressive
// face +Z (faceFix π). Flip a model's faceFix by π if it ever looks backward.
export const MODEL_SPECS = {
  soldier: { url: BASE + 'Soldier.glb', target: 1.8, fit: 'height', faceFix: 0, label: 'Soldier' },
  xbot: { url: BASE + 'Xbot.glb', target: 1.8, fit: 'height', faceFix: Math.PI, label: 'X-Bot' },
  robot: { url: BASE + 'RobotExpressive/RobotExpressive.glb', target: 1.8, fit: 'height', faceFix: Math.PI, label: 'Robot' },
  // flying creatures — normalized by their largest dimension (wingspan/length);
  // BirdManager + NPC flyers yaw them so +Z points along the flight direction.
  // These bird models are authored facing +Z, so faceFix = 0 (nose already
  // points forward). (−π/2 put the head 90° right; π put it 180° backward.)
  flamingo: { url: BASE + 'Flamingo.glb', target: 7, fit: 'max', faceFix: 0, label: 'Flamingo', fly: true },
  parrot: { url: BASE + 'Parrot.glb', target: 4.5, fit: 'max', faceFix: 0, label: 'Parrot', fly: true },
  stork: { url: BASE + 'Stork.glb', target: 5.5, fit: 'max', faceFix: 0, label: 'Stork', fly: true },
  // rideable ground mount (morph-animated gallop — like webgl_instancing_morph)
  horse: { url: BASE + 'Horse.glb', target: 2.6, fit: 'max', faceFix: Math.PI, label: 'Horse' },
  // --- non-glTF example assets (loaded via the FBX / MD2 loaders) ---
  // small enemy ← webgl_loader_fbx (Mixamo-rigged FBX character)
  fbxsmall: { url: EXAMPLES + 'models/fbx/Samba%20Dancing.fbx', kind: 'fbx', target: 1.7, fit: 'height', faceFix: Math.PI, label: 'FBX Fiend' },
  // medium enemy + boss ← webgl_loader_md2 / _control (Quake-2 morph model + skin)
  md2warrior: { url: EXAMPLES + 'models/md2/ratamahatta/ratamahatta.md2', skin: EXAMPLES + 'models/md2/ratamahatta/ratamahatta.png', kind: 'md2', target: 1.9, fit: 'max', faceFix: Math.PI, label: 'MD2 Warrior' },
  // --- one-off LANDMARK / decor assets (placed by DecorManager) ---
  // animated town diorama ← webgl_animation_keyframes ("homes / buildings")
  littlestTokyo: { url: BASE + 'LittlestTokyo.glb', kind: 'gltf', target: 26, fit: 'max', faceFix: 0, label: 'Littlest Tokyo' },
  // static OBJ figure ← webgl_loader_obj → a stone statue prop
  statue: { url: EXAMPLES + 'models/obj/male02/male02.obj', kind: 'obj', target: 2.4, fit: 'height', faceFix: Math.PI, color: 0x9a958c, label: 'Statue' },
  // --- real nature + creatures (NatureManager / DragonManager) ---
  // real low-poly tree ← models/obj/tree.obj (no MTL → two-toned: brown trunk
  // in the lower part, green canopy above)
  tree: { url: EXAMPLES + 'models/obj/tree.obj', kind: 'obj', target: 8, fit: 'max', faceFix: 0, twoTone: { trunk: 0x6b4a2e, leaves: 0x3f7a39 }, label: 'Tree' },
  // real flower ← models/gltf/Flower/Flower.glb
  flower: { url: BASE + 'Flower/Flower.glb', kind: 'gltf', target: 1.1, fit: 'max', faceFix: 0, label: 'Flower' },
  // real dragon ← models/gltf/DragonAttenuation.glb. Its glass/transmission
  // material needs an env map we don't supply, so forceColor makes it an opaque,
  // always-visible obsidian-red dragon.
  dragon: { url: BASE + 'DragonAttenuation.glb', kind: 'gltf', target: 16, fit: 'max', faceFix: Math.PI, forceColor: 0x7a2f24, dropMeshes: /backdrop|cloth|plane|ground/i, label: 'Dragon' },
  // hostile flying enemy ← Parrot.glb, forced to a dark menacing colour so it
  // reads as a corrupted bird (distinct from the friendly flamingo/parrot/stork)
  enemybird: { url: BASE + 'Parrot.glb', kind: 'gltf', target: 5, fit: 'max', faceFix: 0, forceColor: 0x55142e, fly: true, label: 'Corrupt Bird' },
  // real modeled house ← models/gltf/AVIFTest/forest_house.glb (placed by DecorManager)
  house: { url: BASE + 'AVIFTest/forest_house.glb', kind: 'gltf', target: 11, fit: 'max', faceFix: 0, label: 'House' },
};

export class ModelLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.cache = {};
    this._cbs = {};
    this._loading = new Set();
    this._failed = new Set(); // models that failed once → don't re-fetch / re-fire
  }

  isReady(name) {
    return !!this.cache[name];
  }

  load(name) {
    if (this.cache[name] || this._loading.has(name) || this._failed.has(name)) return;
    const spec = MODEL_SPECS[name];
    if (!spec) return;
    this._loading.add(name);
    const kind = spec.kind || 'gltf';

    // fire callbacks exactly once; a later onReady can re-attempt cleanly
    const done = (scene, clips) => {
      this._loading.delete(name);
      const cbs = this._cbs[name];
      delete this._cbs[name];
      if (!scene) {
        this._failed.add(name); // memoize failure → no re-download spam
        console.info(`[Models] "${name}" (${kind}) unavailable; using the procedural fallback.`);
        (cbs || []).forEach((cb) => cb(null));
        return;
      }
      this._finish(name, scene, clips || [], spec);
      (cbs || []).forEach((cb) => cb(this.cache[name]));
    };

    if (kind === 'fbx') {
      tryLoadFBX(spec.url).then((obj) => done(obj, obj ? obj.animations : null));
    } else if (kind === 'obj') {
      tryLoadOBJ(spec.url).then((obj) => {
        if (obj) this._materializeOBJ(obj, spec);
        done(obj, []); // OBJ has no animations
      });
    } else if (kind === 'md2') {
      // MD2 yields a morph BufferGeometry (+ .animations) + a separate skin texture
      tryLoadMD2(spec.url).then(async (geo) => {
        if (!geo) return done(null);
        const skin = spec.skin ? await tryLoadTexture(spec.skin) : null;
        const mat = new THREE.MeshStandardMaterial({ map: skin || null, color: skin ? 0xffffff : 0xb06a4a, roughness: 0.9, metalness: 0 });
        const mesh = new THREE.Mesh(geo, mat); // the mesh IS the morph owner (mixer roots here)
        done(mesh, geo.animations);
      });
    } else {
      tryLoadGLB(spec.url, this.renderer).then((gltf) => done(gltf ? gltf.scene : null, gltf ? gltf.animations : null));
    }
  }

  // OBJ has no embedded materials. `twoTone` paints a brown trunk (lower part)
  // + green canopy (used for the tree); otherwise a single solid colour.
  _materializeOBJ(obj, spec) {
    if (spec.twoTone) {
      obj.updateMatrixWorld(true);
      const full = new THREE.Box3().setFromObject(obj);
      const minY = full.min.y, h = (full.max.y - minY) || 1;
      const trunk = new THREE.MeshStandardMaterial({ color: spec.twoTone.trunk, roughness: 1, metalness: 0, flatShading: true });
      const leaves = new THREE.MeshStandardMaterial({ color: spec.twoTone.leaves, roughness: 1, metalness: 0, flatShading: true });
      obj.traverse((o) => {
        if (!o.isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        o.material = (b.min.y + b.max.y) / 2 - minY < h * 0.4 ? trunk : leaves; // low → trunk, high → leaves
      });
    } else {
      const m = new THREE.MeshStandardMaterial({ color: spec.color || 0x9a958c, roughness: 1, metalness: 0, flatShading: true });
      obj.traverse((o) => { if (o.isMesh) o.material = m; });
    }
  }

  // Shared finish: shadows + SRGB maps, then size-normalize (a MULTIPLIER on the
  // model's own scale → consistent height at any native scale) and feet-seat.
  // Works for glTF scenes, FBX groups, and the single MD2 morph mesh alike.
  _finish(name, scene, clips, spec) {
    // drop unwanted meshes BEFORE colouring/measuring (e.g. the DragonAttenuation
    // "Cloth Backdrop" quad, which would otherwise be painted by forceColor and
    // dominate the fit:'max' bounding box).
    if (spec.dropMeshes) {
      const drop = [];
      scene.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && spec.dropMeshes.test(o.name || '')) drop.push(o); });
      for (const o of drop) {
        if (o.parent) o.parent.remove(o);
        if (o.geometry) o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m && m.dispose && m.dispose());
      }
    }
    scene.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.receiveShadow = false;
        o.frustumCulled = false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      }
    });
    // forceColor → replace (and free) transmissive/odd materials with one opaque
    // material so the model is always visible without an environment map.
    if (spec.forceColor !== undefined) {
      const fm = new THREE.MeshStandardMaterial({ color: spec.forceColor, roughness: 0.5, metalness: 0.1 });
      scene.traverse((o) => {
        if (!(o.isMesh || o.isSkinnedMesh)) return;
        const old = o.material;
        o.material = fm;
        (Array.isArray(old) ? old : [old]).forEach((m) => m && m.dispose && m.dispose());
      });
    }
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const measure = spec.fit === 'max' ? Math.max(size.x, size.y, size.z) : size.y;
    const factor = spec.target / (measure || 1);
    const groundOffset = -box.min.y * factor;
    this.cache[name] = { scene, clips, factor, groundOffset, faceFix: spec.faceFix || 0, spec };
  }

  onReady(name, cb) {
    if (this.cache[name]) { cb(this.cache[name]); return; }
    if (this._failed.has(name)) { cb(null); return; } // already known to be unavailable
    (this._cbs[name] || (this._cbs[name] = [])).push(cb);
    this.load(name);
  }

  // A fresh, independent instance. cloneMats=true also clones materials so the
  // caller can tint/modify them without affecting other instances (used by the
  // boss). Returns { scene, clips, scale, faceFix } or null if not loaded.
  instance(name, cloneMats = false) {
    const m = this.cache[name];
    if (!m) return null;
    const scene = cloneSkeleton(m.scene);
    if (cloneMats) {
      scene.traverse((o) => {
        if ((o.isMesh || o.isSkinnedMesh) && o.material) {
          o.material = Array.isArray(o.material) ? o.material.map((x) => x && x.clone()) : o.material.clone();
        }
      });
    }
    return { scene, clips: m.clips, factor: m.factor, groundOffset: m.groundOffset, faceFix: m.faceFix };
  }
}
