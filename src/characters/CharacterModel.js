import * as THREE from 'three';

// =====================================================================
//  CharacterModel — wraps a loaded glTF instance with a THREE.AnimationMixer
//  and a tiny state machine that crossfades between idle / walk / run / jump
//  clips. Clip names vary between models (Soldier: Idle/Walk/Run, Xbot:
//  idle/walk/run, RobotExpressive: Idle/Walking/Running…), so clips are matched
//  by case-insensitive regex with graceful degradation:
//    no run clip → uses walk; no walk → uses idle; no clips at all → static.
//
//  Driver (Player/NPC/Boss) calls setState(name) when its movement state
//  changes and update(dt) every frame.
// =====================================================================
export class CharacterModel {
  constructor(scene, clips) {
    this.root = scene;
    this.mixer = new THREE.AnimationMixer(scene);
    this.actions = {};
    this._cur = null;
    this._state = null;

    const list = clips || [];
    const pick = (re) => list.find((c) => re.test(c.name));
    const map = {
      idle: pick(/idle|stand/i),
      walk: pick(/walk/i),
      run: pick(/run/i),
      jump: pick(/jump|fall/i),
    };
    if (!map.idle && list.length) map.idle = list[0];
    for (const k in map) if (map[k]) this.actions[k] = this.mixer.clipAction(map[k]);
    this.hasClips = Object.keys(this.actions).length > 0;
    if (this.hasClips) this.setState('idle');
  }

  // Switch animation state with a short crossfade. Falls back down the chain
  // (run→walk→idle) when a clip is missing.
  setState(s) {
    this._state = s;
    let a = this.actions[s];
    if (!a) a = (s === 'run' && this.actions.walk) || this.actions.idle || null;
    if (!a || a === this._cur) return;
    const prev = this._cur;
    this._cur = a;
    a.reset();
    a.enabled = true;
    a.setEffectiveTimeScale(1);
    a.setEffectiveWeight(1);
    a.fadeIn(0.2);
    a.play();
    if (prev) prev.fadeOut(0.2);
  }

  update(dt, timeScale = 1) {
    this.mixer.timeScale = timeScale;
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
