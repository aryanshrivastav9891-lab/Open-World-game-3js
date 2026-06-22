import * as THREE from 'three';
import { Assets } from '../world/Assets.js';

// =====================================================================
//  Sword — a modeled, textured blade the avatar can sheath/unsheath, swing in
//  a light→light→heavy COMBO with real hit detection (arc in front of the
//  player), a glowing swing TRAIL, and a BLOCK / PARRY tied to stamina.
//
//  • Draw/sheath: reparents the blade between the right hand and the back.
//  • Swing (left-click while drawn): each hit calls `hitSink(point, dir, radius,
//    amount, knock, type)` at the active frame → Game fans it over every combat
//    system (NPCs/enemies/boss) via damageArea. A 3-hit chain alternates arcs
//    and the third hit is a heavy finisher.
//  • Block (hold right-click): cuts incoming damage; a hit inside the first
//    PARRY_WINDOW after raising guard is a clean PARRY (negated). Both cost
//    stamina, so the shield/stamina economy gates defence too.
//  • Trail VFX: additive particles emitted at the blade tip during the swing.
// =====================================================================
const SWING_TIME = 0.36;
const COMBO_WINDOW = 0.55; // chain the next swing within this
const SWING_COST = 12; // stamina per swing
const HIT_T = 0.36; // fraction of the swing where damage lands
const REACH = 2.2; // arc radius in front of the player
const PARRY_WINDOW = 0.22; // seconds after raising guard
const BASE_DMG = 26;

const _fwd = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _tip = new THREE.Vector3();

export class Sword {
  constructor(parentMesh, armR) {
    this.parent = parentMesh;
    this.armR = armR;
    this.drawn = false;
    this.blocking = false;
    this._t = 0; // sword clock (always advancing) — drives the parry window
    this._blockStart = -999; // _t at which guard was last raised

    this.swinging = false;
    this._swingT = 0;
    this._combo = 0;
    this._comboT = 0;
    this._didHit = false;

    this.hitSink = null; // (point, dir, radius, amount, knock, type)
    this.particles = null;
    this.onSwing = null; // () → sfx
    this.onHitFx = null; // (point) → sfx

    this._build();
    this._sheathePose();
  }

  _build() {
    this.metal = new THREE.MeshToonMaterial({ color: 0xcfd6df, gradientMap: Assets.gradientMap });
    this.hot = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: new THREE.Color(0x8fd6ff), emissiveIntensity: 0, gradientMap: Assets.gradientMap });
    this.grip = new THREE.MeshToonMaterial({ color: 0x3a2a1c, gradientMap: Assets.gradientMap });
    this.gold = new THREE.MeshToonMaterial({ color: 0xcaa23a, gradientMap: Assets.gradientMap });

    const g = new THREE.Group();
    // blade (length along +Y), edge-on thin, with a hot core for the flare
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.025).translate(0, 0.72, 0), this.metal);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.05, 0.03).translate(0, 0.72, 0), this.hot);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4).translate(0, 1.38, 0), this.metal);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.1).translate(0, 0.14, 0), this.gold);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.26, 6).translate(0, -0.02, 0), this.grip);
    const pommel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0).translate(0, -0.17, 0), this.gold);
    g.add(blade, core, tip, guard, grip, pommel);
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });

    this.group = g;
    this._tipMarker = new THREE.Object3D();
    this._tipMarker.position.set(0, 1.4, 0);
    g.add(this._tipMarker);
  }

  applyDetail(t) {
    for (const m of [this.metal, this.grip, this.gold]) { m.bumpMap = t; m.bumpScale = 0.02; m.needsUpdate = true; }
  }
  setParticles(p) { this.particles = p; }

  // ---- draw / sheath ------------------------------------------------
  toggle() {
    this.drawn ? this.sheath() : this.draw();
  }
  draw() {
    if (this.drawn) return;
    this.drawn = true;
    this.armR.add(this.group);
    this.group.position.set(0, -0.55, 0.06);
    this.group.rotation.set(-0.35, 0, 0);
    if (this.onSwing) this.onSwing('unsheath');
  }
  sheath() {
    this.drawn = false;
    this.blocking = false;
    this.swinging = false;
    this._sheathePose();
    if (this.onSwing) this.onSwing('unsheath');
  }
  _sheathePose() {
    // strap it across the back (child of the torso/mesh, not the arm)
    this.parent.add(this.group);
    this.group.position.set(-0.22, 1.15, 0.2);
    this.group.rotation.set(0.2, 0, 0.7);
    this.armR.rotation.set(0, 0, 0);
  }

  // ---- swing / combo ------------------------------------------------
  swing(stamina) {
    if (!this.drawn) return false;
    if (this.swinging && this._swingT < SWING_TIME * 0.5) return false; // mid-swing, ignore spam
    if (stamina && !stamina.spend(SWING_COST)) return false;
    this._combo = this._comboT > 0 ? (this._combo + 1) % 3 : 0;
    this._comboT = 0;
    this.swinging = true;
    this._swingT = 0;
    this._didHit = false;
    if (this.onSwing) this.onSwing(this._combo === 2 ? 'swordheavy' : 'sword');
    return true;
  }

  // ---- block / parry ------------------------------------------------
  // Set the guard. Called by Game each frame; on the rising edge it stamps the
  // parry window against the sword clock, so the timing is independent of the
  // per-frame update order (blockResult below reads the same clock).
  setBlocking(v) {
    if (v && !this.blocking) this._blockStart = this._t; // rising edge → open parry window
    this.blocking = v;
  }

  // Returns { amount, parried } for Player.hurt. A hit within PARRY_WINDOW of
  // raising guard is fully negated; otherwise blocking cuts damage if there's
  // stamina to pay for it.
  blockResult(amount, stamina) {
    if (!this.blocking) return { amount, parried: false };
    if (this._t - this._blockStart <= PARRY_WINDOW) return { amount: 0, parried: true };
    if (stamina && stamina.spend(8)) return { amount: amount * 0.3, parried: false };
    return { amount: amount * 0.7, parried: false }; // weak block when out of stamina
  }

  // ---- per-frame ----------------------------------------------------
  update(dt, player) {
    this._t += dt; // sword clock advances every frame (drives the parry window)
    if (this._comboT > 0) this._comboT -= dt;

    if (!this.drawn) return;

    if (this.swinging) {
      this._swingT += dt;
      const t = this._swingT / SWING_TIME;
      this._poseSwing(t);
      // hot blade flare during the swing
      this.hot.emissiveIntensity = Math.sin(Math.min(1, t) * Math.PI) * 1.6;
      // damage at the active frame
      if (!this._didHit && t >= HIT_T) {
        this._didHit = true;
        this._strike(player);
      }
      // trail
      if (t > 0.12 && t < 0.7 && this.particles) {
        this.group.updateWorldMatrix(true, false);
        this._tipMarker.getWorldPosition(_tip);
        for (let k = 0; k < 2; k++)
          this.particles.emit(_tip.x, _tip.y, _tip.z, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0.28, k ? 0xaee7ff : 0xffffff, 0);
      }
      if (this._swingT >= SWING_TIME) {
        this.swinging = false;
        this._comboT = COMBO_WINDOW; // open the chain window
        this.hot.emissiveIntensity = 0;
      }
    } else if (this.blocking) {
      this._poseBlock(dt);
    } else {
      this._poseReady(dt);
    }
  }

  _strike(player) {
    _fwd.set(-Math.sin(player.facing), 0, -Math.cos(player.facing));
    _pt.set(player.pos.x + _fwd.x * 1.6, player.pos.y + 1.1, player.pos.z + _fwd.z * 1.6);
    const heavy = this._combo === 2;
    const dmg = heavy ? BASE_DMG * 1.8 : BASE_DMG;
    const knock = heavy ? 11 : 6;
    if (this.hitSink) this.hitSink(_pt, _fwd, REACH, dmg, knock, 'slash');
    if (this.particles) this.particles.burst({ x: _pt.x, y: _pt.y, z: _pt.z }, heavy ? 14 : 8, { speed: 6, spread: 1, life: 0.4, color: 0xaee7ff, gravity: 2 });
    if (this.onHitFx) this.onHitFx(_pt);
    // open the chain window now (the swing is interruptible after its half-point),
    // so buffering the next click mid-swing advances the combo to the heavy finisher
    this._comboT = COMBO_WINDOW;
  }

  _poseSwing(t) {
    const e = t < 1 ? 1 - (1 - t) * (1 - t) : 1; // ease-out
    const arm = this.armR;
    if (this._combo === 0) { // overhead chop
      arm.rotation.x = lerp(-2.4, 0.9, e);
      arm.rotation.z = lerp(0.2, -0.1, e);
    } else if (this._combo === 1) { // horizontal slash
      arm.rotation.x = lerp(-1.0, -0.2, e);
      arm.rotation.z = lerp(-1.3, 1.1, e);
    } else { // heavy thrust
      arm.rotation.x = lerp(-1.6, -1.2, Math.sin(e * Math.PI));
      arm.rotation.z = 0;
    }
  }
  _poseReady(dt) {
    this.armR.rotation.x = lerp(this.armR.rotation.x, -0.5, 1 - Math.exp(-12 * dt));
    this.armR.rotation.z = lerp(this.armR.rotation.z, -0.25, 1 - Math.exp(-12 * dt));
  }
  _poseBlock(dt) {
    this.armR.rotation.x = lerp(this.armR.rotation.x, -1.4, 1 - Math.exp(-16 * dt));
    this.armR.rotation.z = lerp(this.armR.rotation.z, 0.5, 1 - Math.exp(-16 * dt));
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    this.metal.dispose(); this.hot.dispose(); this.grip.dispose(); this.gold.dispose();
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
