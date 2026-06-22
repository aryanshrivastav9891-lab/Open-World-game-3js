import * as THREE from 'three';
import { CharacterModel } from '../characters/CharacterModel.js';
import { groundHeightAt } from './WorldConfig.js';

// =====================================================================
//  DecorManager — places one-off, real three.js example assets as world
//  LANDMARKS (e.g. the animated "Littlest Tokyo" town from
//  webgl_animation_keyframes, and a stone OBJ statue from webgl_loader_obj).
//  Each is loaded via ModelLibrary (size-normalized + feet-seated), set on the
//  ground at a fixed spot, and — if it has an animation clip — driven by an
//  AnimationMixer. Purely decorative (non-colliding). Graceful: if an asset
//  can't be fetched, nothing is placed and the procedural world is unchanged.
//
//  HOW TO ADD/SWAP A LANDMARK (a few lines):
//    1. Add a MODEL_SPECS entry in ModelLibrary.js (kind gltf/obj/fbx/md2).
//    2. Add a { model, x, z, rotY, y, anim } row to PLACEMENTS below.
// =====================================================================
const PLACEMENTS = [
  { model: 'littlestTokyo', x: -112, z: 112, rotY: 0.3, y: 1.0, anim: true }, // animated town diorama
  { model: 'statue', x: 12, z: -42, rotY: Math.PI, y: 0, anim: false }, // stone statue by the shrine path
  // a little hamlet of real modeled houses (forest_house.glb) on the west meadow
  { model: 'house', x: -96, z: 34, rotY: 0.4, y: 0, anim: false },
  { model: 'house', x: -86, z: 44, rotY: -1.1, y: 0, anim: false },
  { model: 'house', x: -104, z: 48, rotY: 2.3, y: 0, anim: false },
  { model: 'house', x: -90, z: 58, rotY: 1.0, y: 0, anim: false },
];

export class DecorManager {
  constructor(scene, modelLib) {
    this.scene = scene;
    this.lib = modelLib;
    this.items = [];
    for (const p of PLACEMENTS) modelLib.onReady(p.model, (d) => this._place(p, d));
  }

  _place(p, data) {
    if (!data) return; // asset unavailable → leave the procedural world as-is
    const inst = this.lib.instance(p.model);
    if (!inst) return;
    inst.scene.scale.multiplyScalar(inst.factor); // normalize to the spec's target size
    inst.scene.position.y = inst.groundOffset; // seat on the ground (no float/sink)
    inst.scene.rotation.y = inst.faceFix;
    const g = new THREE.Group();
    g.add(inst.scene);
    g.position.set(p.x, groundHeightAt(p.x, p.z) + (p.y || 0), p.z);
    g.rotation.y = p.rotY || 0;
    this.scene.add(g);
    const char = p.anim && inst.clips.length ? new CharacterModel(inst.scene, inst.clips) : null;
    this.items.push({ group: g, char });
  }

  update(dt) {
    for (const it of this.items) if (it.char) it.char.update(dt);
  }

  dispose() {
    for (const it of this.items) {
      if (it.char) it.char.dispose();
      this.scene.remove(it.group);
    }
    this.items.length = 0;
  }
}
