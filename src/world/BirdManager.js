import * as THREE from 'three';
import { CharacterModel } from '../characters/CharacterModel.js';

// =====================================================================
//  BirdManager — real, animated glTF birds (Flamingo / Parrot / Stork from the
//  official three.js example models) that flap across the sky and drift in/out
//  over the map. Each is loaded via ModelLibrary (graceful fallback: if none
//  load, no birds spawn and the world keeps its procedural flyers + the
//  image-billboard dragons). Models are height/size-normalized, their single
//  flap clip is driven by a THREE.AnimationMixer, and each bird is yawed to
//  face its flight direction. Pooled: one instance per slot, reused on respawn.
// =====================================================================

const NAMES = ['flamingo', 'parrot', 'stork'];
const COUNT = 12; // more real birds filling the sky

export class BirdManager {
  constructor(scene, models) {
    this.scene = scene;
    this.models = models;
    this.available = [];
    for (const n of NAMES) models.onReady(n, (d) => { if (d) this.available.push(n); });

    this.birds = [];
    for (let i = 0; i < COUNT; i++) {
      this.birds.push({ group: null, char: null, name: null, vel: new THREE.Vector3(), active: false, wait: Math.random() * 8, baseY: 50, bob: Math.random() * 10, life: 0, maxLife: 1 });
    }
  }

  _spawn(b, playerPos) {
    if (!this.available.length) { b.wait = 1.5 + Math.random() * 3; return; }
    // instantiate this slot's model once, then reuse across respawns
    if (!b.group) {
      const name = this.available[(Math.random() * this.available.length) | 0];
      const inst = this.models.instance(name);
      if (!inst) { b.wait = 2; return; }
      inst.scene.scale.multiplyScalar(inst.factor);
      inst.scene.rotation.y = inst.faceFix; // correct the model so its nose points +Z
      const g = new THREE.Group();
      g.add(inst.scene);
      g.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = false; });
      this.scene.add(g);
      b.group = g;
      b.char = new CharacterModel(inst.scene, inst.clips); // clip[0] = flap (plays as "idle")
      b.name = name;
      b.char.update(Math.random() * 2); // desync the wing-flap phase between birds
    }
    const ang = Math.random() * Math.PI * 2;
    const dist = 150 + Math.random() * 80;
    b.baseY = 35 + Math.random() * 45;
    b.group.position.set(playerPos.x + Math.cos(ang) * dist, b.baseY, playerPos.z + Math.sin(ang) * dist);
    const speed = 8 + Math.random() * 9;
    b.vel.set(-Math.cos(ang) * speed + (Math.random() - 0.5) * 4, 0, -Math.sin(ang) * speed + (Math.random() - 0.5) * 4);
    b.maxLife = (dist * 2) / speed;
    b.life = b.maxLife;
    b.bob = Math.random() * 10;
    b.group.visible = true;
    b.active = true;
  }

  update(dt, camera, playerPos) {
    for (const b of this.birds) {
      if (!b.active) {
        b.wait -= dt;
        if (b.wait <= 0) this._spawn(b, playerPos);
        continue;
      }
      b.life -= dt;
      b.bob += dt;
      b.group.position.addScaledVector(b.vel, dt);
      b.group.position.y = b.baseY + Math.sin(b.bob * 0.6) * 3;
      // face flight direction (yaw), with a gentle bank
      b.group.rotation.y = Math.atan2(b.vel.x, b.vel.z);
      b.group.rotation.z = Math.sin(b.bob * 0.6) * 0.12;
      b.char.update(dt);
      if (b.life <= 0) { b.active = false; b.group.visible = false; b.wait = 4 + Math.random() * 10; }
    }
  }

  dispose() {
    for (const b of this.birds) {
      if (b.char) b.char.dispose();
      if (b.group) this.scene.remove(b.group);
    }
    this.birds.length = 0;
    this.available.length = 0;
  }
}
