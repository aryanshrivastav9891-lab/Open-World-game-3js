import * as THREE from 'three';

// =====================================================================
//  TextureLibrary — loads real, high-resolution textures from the internet
//  (CORS-enabled jsDelivr mirror of the three.js example assets) and hands
//  them to materials when they arrive. Everything is GRACEFUL: if a URL
//  fails, the material simply keeps its procedural look (vertex colours /
//  canvas sprite), so the game never breaks offline.
//
//  Asset sources (all served with Access-Control-Allow-Origin:* by jsDelivr):
//    grass        terrain/grasslight-big.jpg   → terrain ground diffuse (tiled)
//    detail       disturb.jpg                  → bump on terrain + buildings +
//                                                characters (player/NPC/enemy fabric)
//    roughness    roughness_map.jpg            → water roughness (river + ponds)
//    waterNormal  waternormals.jpg             → river/pond ripples (normal map)
//    brick        brick_diffuse.jpg            → available for region buildings
//    wood         hardwood2_diffuse.jpg        → available for props
//    spark        sprites/spark1.png           → fire/lightning particle sprite
//  Dragon images are loaded separately in world/DragonManager.js.
//  See README "Textures & assets" for the full URL list + placement.
// =====================================================================

const BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/';

const SPECS = {
  grass: { url: BASE + 'terrain/grasslight-big.jpg', srgb: true, repeat: [1, 1], wrap: true },
  detail: { url: BASE + 'disturb.jpg', srgb: false, repeat: [3, 3], wrap: true },
  roughness: { url: BASE + 'roughness_map.jpg', srgb: false, repeat: [2, 2], wrap: true },
  waterNormal: { url: BASE + 'waternormals.jpg', srgb: false, repeat: [3, 3], wrap: true },
  brick: { url: BASE + 'brick_diffuse.jpg', srgb: true, repeat: [2, 2], wrap: true },
  wood: { url: BASE + 'hardwood2_diffuse.jpg', srgb: true, repeat: [2, 2], wrap: true },
  spark: { url: BASE + 'sprites/spark1.png', srgb: true },
  circle: { url: BASE + 'sprites/circle.png', srgb: true }, // soft round droplet (water power)
};

export class TextureLibrary {
  constructor() {
    this.tex = {};
    this._cbs = {};
    this._disposed = false;
    this.loader = new THREE.TextureLoader();
    this.loader.setCrossOrigin('anonymous');
    this.anisotropy = 8;
  }

  load() {
    for (const name of Object.keys(SPECS)) this._load(name, SPECS[name]);
    return this;
  }

  _load(name, spec) {
    this.loader.load(
      spec.url,
      (t) => {
        if (this._disposed) { t.dispose(); return; }
        t.colorSpace = spec.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        if (spec.wrap) {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          if (spec.repeat) t.repeat.set(spec.repeat[0], spec.repeat[1]);
        }
        t.anisotropy = this.anisotropy;
        t.needsUpdate = true;
        this.tex[name] = t;
        (this._cbs[name] || []).forEach((cb) => cb(t));
      },
      undefined,
      () => {
        // graceful fallback — leave undefined, callers keep procedural look
        console.info(`[Textures] "${name}" unavailable; using procedural fallback.`);
      }
    );
  }

  // Fire cb now if already loaded, else when it arrives.
  onReady(name, cb) {
    if (this.tex[name]) cb(this.tex[name]);
    else (this._cbs[name] || (this._cbs[name] = [])).push(cb);
  }

  get(name) {
    return this.tex[name];
  }

  dispose() {
    this._disposed = true;
    for (const k of Object.keys(this.tex)) this.tex[k].dispose();
    this.tex = {};
    this._cbs = {};
  }
}
