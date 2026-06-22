import * as THREE from 'three';

// =====================================================================
//  Shield — an activatable energy dome around the avatar that ABSORBS incoming
//  damage. It has its own energy meter that drains slowly while held and faster
//  as it soaks hits; when it empties it BREAKS (flash + a recharge delay before
//  it refills). Activating/holding it also costs stamina, so it can't be left
//  up forever. The visible bubble fades in/out and pulses when it takes a hit.
// =====================================================================
const HOLD_DRAIN = 7; // energy/sec while simply held
const STAMINA_DRAIN = 14; // stamina/sec while held
const RECHARGE_RATE = 20; // energy/sec when down
const RECHARGE_DELAY = 2.4; // seconds after a break before it refills
const ACTIVATE_MIN_STAMINA = 10;

export class Shield {
  constructor(parentMesh) {
    this.max = 100;
    this.energy = 100;
    this.active = false;
    this.broken = false;
    this.rechargeT = 0;
    this.onBreak = null; // () → HUD shield-break flash + sfx
    this._pulse = 0;
    this._t = 0;

    this.geo = new THREE.IcosahedronGeometry(1.35, 3);
    this.tex = makeEnergyTexture(); // crisp hex energy-field pattern (procedural)
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x5fd0ff,
      map: this.tex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.position.y = 1.0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    parentMesh.add(this.mesh);
  }

  get frac() {
    return this.energy / this.max;
  }

  // Full reset of logic AND visuals — used on respawn so the dome never lingers
  // on the freshly revived avatar (update() doesn't run during the 'dead' state).
  reset() {
    this.energy = this.max;
    this.active = false;
    this.broken = false;
    this.rechargeT = 0;
    this._pulse = 0;
    this.mat.opacity = 0;
    this.mesh.visible = false;
    this.mesh.scale.setScalar(1);
  }

  setTexture(t) {
    this.mat.map = t;
    this.mat.needsUpdate = true;
  }

  // Toggle on/off. Refuses to come up while broken (recharging) or with no
  // stamina to start it.
  toggle(stamina) {
    if (this.active) {
      this.active = false;
      return;
    }
    if (this.broken) return;
    if (stamina && stamina.value < ACTIVATE_MIN_STAMINA) return;
    this.active = true;
  }

  // Absorb incoming damage. Returns the leftover that should hit the player's
  // HP (0 if fully soaked). Breaks if the hit drains the last of the energy.
  absorb(amount) {
    if (!this.active) return amount;
    this._pulse = Math.min(1.6, this._pulse + 0.9);
    if (amount <= this.energy) {
      this.energy -= amount;
      return 0;
    }
    const leftover = amount - this.energy;
    this.energy = 0;
    this._break();
    return leftover;
  }

  _break() {
    this.active = false;
    this.broken = true;
    this.rechargeT = RECHARGE_DELAY;
    this._pulse = 1.6;
    if (this.onBreak) this.onBreak();
  }

  update(dt, stamina) {
    this._t += dt;
    if (this.active) {
      this.energy = Math.max(0, this.energy - HOLD_DRAIN * dt);
      if (stamina) {
        stamina.drain(STAMINA_DRAIN, dt);
        if (stamina.value <= 0) this.active = false; // out of stamina → drop it
      }
      if (this.energy <= 0) this._break();
    } else if (this.broken) {
      this.rechargeT -= dt;
      if (this.rechargeT <= 0) this.broken = false;
    } else if (this.energy < this.max) {
      this.energy = Math.min(this.max, this.energy + RECHARGE_RATE * dt);
    }

    // visuals: fade toward target opacity, add a hit pulse, gentle breathing
    this._pulse = Math.max(0, this._pulse - dt * 2.6);
    const target = this.active ? 0.3 : 0;
    this.mat.opacity = lerp(this.mat.opacity, target, 1 - Math.exp(-10 * dt)) + this._pulse * 0.35;
    this.mat.color.setHex(this.broken ? 0xff6a4a : 0x5fd0ff);
    this.mesh.visible = this.mat.opacity > 0.015;
    const s = 1 + Math.sin(this._t * 5) * 0.02 + this._pulse * 0.12;
    this.mesh.scale.setScalar(s);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// A small tiled hex-grid "energy field" texture so the dome reads as a force
// field rather than a flat sphere. Procedural → always available, crisp.
function makeEnergyTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(20,40,60,1)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(150,225,255,0.9)';
  ctx.lineWidth = 2;
  const r = 18;
  for (let row = -1; row < 5; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * r * 1.5;
      const y = row * r * 1.732 + (col % 2 ? r * 0.866 : 0);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}
