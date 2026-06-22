import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MD2Loader } from 'three/examples/jsm/loaders/MD2Loader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

// =====================================================================
//  Asset loaders for real models — compressed glTF (DRACO + KTX2), FBX, and
//  MD2 (Quake-2 morph models). Each `tryLoadXxx(url)` resolves to the loaded
//  asset or `null` on a missing/failed/unsupported fetch, so every caller keeps
//  a procedural fallback and the game still runs fully offline.
//
//  Mirrors the three.js examples: GLTFLoader (webgl_loader_gltf*), FBXLoader
//  (webgl_loader_fbx), MD2Loader (webgl_loader_md2[_control]). ModelLibrary
//  picks the loader per model `kind`.
// =====================================================================

let _gltf = null;
let _fbx = null;
let _md2 = null;
let _obj = null;

// Decoders are pulled from a CDN matching three's version, only fetched
// the first time a compressed asset is actually decoded.
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';
const KTX2_PATH = 'https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/libs/basis/';

export function getGLTFLoader(renderer) {
  if (_gltf) return _gltf;
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);

  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(KTX2_PATH);
  if (renderer) ktx2.detectSupport(renderer);

  _gltf = new GLTFLoader();
  _gltf.setDRACOLoader(draco);
  _gltf.setKTX2Loader(ktx2);
  return _gltf;
}

export function tryLoadGLB(url, renderer) {
  return new Promise((resolve) => {
    try {
      getGLTFLoader(renderer).load(
        url.toString ? url.toString() : url,
        (gltf) => resolve(gltf),
        undefined,
        () => resolve(null) // missing or failed → procedural fallback
      );
    } catch (e) {
      resolve(null);
    }
  });
}

// --- FBX (skeletal) — webgl_loader_fbx -------------------------------
export function getFBXLoader() {
  if (!_fbx) _fbx = new FBXLoader();
  return _fbx;
}
// Resolves to the loaded FBX Object3D (with .animations) or null.
export function tryLoadFBX(url) {
  return new Promise((resolve) => {
    try {
      getFBXLoader().load(url.toString ? url.toString() : url, (obj) => resolve(obj), undefined, () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// --- MD2 (morph) — webgl_loader_md2 / _control -----------------------
export function getMD2Loader() {
  if (!_md2) _md2 = new MD2Loader();
  return _md2;
}
// Resolves to the MD2 BufferGeometry (with morph attributes + .animations) or
// null. The caller builds a Mesh + applies the skin texture.
export function tryLoadMD2(url) {
  return new Promise((resolve) => {
    try {
      getMD2Loader().load(url.toString ? url.toString() : url, (geo) => resolve(geo), undefined, () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// --- OBJ (static meshes) — webgl_loader_obj -------------------------
export function getOBJLoader() {
  if (!_obj) _obj = new OBJLoader();
  return _obj;
}
// Resolves to the loaded OBJ Object3D (no animations) or null. OBJ has no
// embedded materials, so meshes come back with a default material (good for a
// stone-grey statue look); pass your own material afterward if desired.
export function tryLoadOBJ(url) {
  return new Promise((resolve) => {
    try {
      getOBJLoader().load(url.toString ? url.toString() : url, (obj) => resolve(obj), undefined, () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// Load a plain texture (e.g. an MD2 skin), SRGB, or null on failure.
export function tryLoadTexture(url) {
  return new Promise((resolve) => {
    try {
      new THREE.TextureLoader().load(
        url.toString ? url.toString() : url,
        (t) => { t.colorSpace = THREE.SRGBColorSpace; resolve(t); },
        undefined,
        () => resolve(null)
      );
    } catch (e) {
      resolve(null);
    }
  });
}
