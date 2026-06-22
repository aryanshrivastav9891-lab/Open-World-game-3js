import * as THREE from 'three';

// =====================================================================
//  Dash / super-speed — a short burst of speed in a chosen direction
//  (double-tap a movement key). Costs stamina, then goes on cooldown; the
//  camera FOV widens and screen speed-lines kick in while it's active (driven
//  by Game from `active`). Sprint (hold Shift) is handled in Player and also
//  drains stamina — together they give the "super-speed" feel.
// =====================================================================
const DASH_TIME = 0.22; // seconds of burst
const DASH_SPEED = 27; // units/sec during the burst
const DASH_CD = 1.1; // cooldown after a dash
const DASH_COST = 24; // stamina per dash

export class Dash {
  constructor() {
    this.dir = new THREE.Vector3();
    this.active = false;
    this.t = 0;
    this.cd = 0;
    this.speed = DASH_SPEED;
    this.onDash = null; // () → VFX (speed-lines / sfx)
  }

  get ready() {
    return this.cd <= 0 && !this.active;
  }

  // Start a dash in a world-space (x,z) direction. Returns true if it fired.
  trigger(dirX, dirZ, stamina) {
    if (this.cd > 0 || this.active) return false;
    if (stamina && !stamina.spend(DASH_COST)) return false;
    const l = Math.hypot(dirX, dirZ) || 1;
    this.dir.set(dirX / l, 0, dirZ / l);
    this.t = DASH_TIME;
    this.cd = DASH_CD;
    this.active = true;
    if (this.onDash) this.onDash();
    return true;
  }

  update(dt) {
    if (this.cd > 0) this.cd -= dt;
    if (this.active) {
      this.t -= dt;
      if (this.t <= 0) this.active = false;
    }
  }
}
