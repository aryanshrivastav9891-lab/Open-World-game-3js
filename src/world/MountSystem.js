import * as THREE from 'three';
import { CharacterModel } from '../characters/CharacterModel.js';

// =====================================================================
//  MountSystem — rideable mounts: a HORSE for fast ground travel and a flying
//  ROC (giant bird) for the air. Toggle with G (horse) / H (roc). While mounted
//  the mount's real glTF model is parented under the player (animated by its
//  gallop/flap clip), the player moves much faster, and the air mount also puts
//  the player into flight. Dismounting restores normal speed (and lands a flyer).
//  Graceful: if the model can't load, you still get the speed boost (no mesh).
// =====================================================================
const MOUNTS = {
  horse: { model: 'horse', speedMul: 2.4, fly: false, faceFix: Math.PI, y: -1.0, scale: 1.0, sfx: 'dash' },
  roc: { model: 'stork', speedMul: 2.6, fly: true, faceFix: Math.PI, y: -0.8, scale: 2.4, sfx: 'dash' }, // stork is authored facing +Z → faceFix π to face player-forward (−Z), same as the horse
};

export class MountSystem {
  constructor(player, modelLib) {
    this.player = player;
    this.lib = modelLib;
    this.kind = null;
    this.root = null;
    this.char = null;
    this._mats = [];
    this.onMount = null; // (kind|null) → Game (toast / sfx)
  }

  get active() {
    return !!this.kind;
  }

  toggle(kind) {
    if (this.kind === kind) { this.dismount(); return; }
    if (this.kind) this.dismount();
    this._mount(kind);
  }

  _mount(kind) {
    const cfg = MOUNTS[kind];
    if (!cfg) return;
    this.kind = kind;
    this.player.mounted = true;
    this.player.mountSpeedMul = cfg.speedMul;
    if (cfg.fly && !this.player.flying) this.player.toggleFlight(); // take to the air
    // attach the model when ready (might already be cached)
    this.lib.onReady(cfg.model, (data) => {
      if (this.kind !== kind || !data) return; // dismounted before load, or no model → speed only
      this._attach(cfg);
    });
    if (this.onMount) this.onMount(kind);
  }

  _attach(cfg) {
    const inst = this.lib.instance(cfg.model);
    if (!inst) return;
    inst.scene.scale.multiplyScalar(inst.factor * cfg.scale);
    inst.scene.position.y = inst.groundOffset;
    inst.scene.rotation.y = cfg.faceFix; // mount faces the player's forward (−Z)
    this.root = new THREE.Group();
    this.root.position.y = cfg.y; // drop the mount so the rider sits on its back
    this.root.add(inst.scene);
    this.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = true; });
    this.player.mesh.add(this.root);
    this.char = new CharacterModel(inst.scene, inst.clips);
  }

  dismount() {
    if (!this.kind) return;
    const cfg = MOUNTS[this.kind];
    if (cfg && cfg.fly && this.player.flying) this.player.toggleFlight(); // land
    if (this.char) { this.char.dispose(); this.char = null; }
    if (this.root) { this.player.mesh.remove(this.root); this.root = null; }
    this.player.mounted = false;
    this.player.mountSpeedMul = 1;
    this.kind = null;
    if (this.onMount) this.onMount(null);
  }

  update(dt) {
    // a flying mount whose flight ended by ANY path (manual land, F toggle,
    // auto-land) must dismount — otherwise the player is stuck mounted+grounded
    // at mount speed with the roc still attached.
    if (this.kind && MOUNTS[this.kind].fly && !this.player.flying) { this.dismount(); return; }
    if (this.char) {
      const moving = this.player.flying || Math.hypot(this.player.vel.x, this.player.vel.z) > 0.5;
      this.char.update(dt, moving ? 1.5 : 0.5); // gallop/flap faster while moving
    }
  }
}
