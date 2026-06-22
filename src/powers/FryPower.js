import * as THREE from 'three';
import { Power } from './Power.js';

const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// =====================================================================
//  Fry / Heat — a CONTINUOUS focused beam (hold cast). Drains mana per
//  second while held, scorching whatever it touches with smoke + embers.
//
//  >>> This class is the TEMPLATE for new continuous powers (Wind, Ice…).
//  To add a beam-style element in <10 lines, copy this pattern:
//      export class IcePower extends Power {
//        constructor(){ super({name:'Ice',color:0x9fe8ff,icon:'❄️',
//          continuous:true, cooldown:0, manaCost:22}); }
//        onInit(){ this._beam = this.mgr.makeBeam(0x9fe8ff); }
//        beamUpdate(dt,ctx,on){ this.mgr.aimBeam(this._beam, ctx, on, 0x9fe8ff); }
//        deactivate(){ this._beam.visible = false; }
//      }
//  ...then register it in PowerManager's `powers` array. (Instant powers are
//  even simpler — just implement cast(ctx); see FirePower/LightningPower.)
// =====================================================================
export class FryPower extends Power {
  constructor() {
    super({ name: 'Fry', color: 0xff3b1e, icon: '☀️', continuous: true, cooldown: 0, manaCost: 26, range: 55 });
  }

  onInit() {
    this.geo = new THREE.CylinderGeometry(0.14, 0.14, 1, 8, 1, true);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(this.geo, this.mat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.scene.add(this.beam);
    this._light = null;
    this._t = 0;
    this._held = 0; // seconds the beam has been continuously on (scales damage)
  }

  beamUpdate(dt, ctx, on) {
    if (!on) {
      this._held = Math.max(0, this._held - dt * 2);
      this.deactivate(ctx);
      return;
    }
    this._t += dt;
    this._held = Math.min(this._held + dt, 3.5);
    const from = ctx.origin;
    const to = ctx.aim.point;
    const len = from.distanceTo(to);
    _dir.copy(to).sub(from).normalize();
    _mid.copy(from).addScaledVector(_dir, len / 2);
    this.beam.position.copy(_mid);
    _q.setFromUnitVectors(_up, _dir);
    this.beam.quaternion.copy(_q);
    const flick = 0.85 + Math.sin(this._t * 40) * 0.15;
    this.beam.scale.set(flick, len, flick);
    this.beam.visible = true;

    // scorch the impact point: embers + rising smoke
    ctx.particles.emit(to.x, to.y, to.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.5, Math.random() < 0.6 ? 0xff7a2a : 0xffd24a, -2);
    if (Math.random() < 0.6)
      ctx.particles.emit(to.x, to.y + 0.3, to.z, (Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5, 1.2, 0x3a3a3a, -1);

    if (!this._light) this._light = ctx.lights.acquire(0xff5a2a, 5, 12);
    if (this._light) {
      this._light.position.copy(to);
      this._light.intensity = 4 + Math.random() * 2;
    }
    // scorch over time: damage scales with how long the beam is held (DoT,
    // accumulated into one floating number by the NPC). Plus light burn.
    const dps = 18 + this._held * 18; // 18 → ~81 dps after 3.5s
    ctx.damageArea(to, 1.9, dps * dt, 'fry', null, 0, true);
    ctx.applyBurn(to, 1.6, 6, 0.5);
  }

  deactivate(ctx) {
    this.beam.visible = false;
    if (this._light) {
      // works whether or not a ctx is available (e.g. on pause/dispose)
      (ctx ? ctx.lights : this.mgr.lights).release(this._light);
      this._light = null;
    }
  }

  onDispose() {
    if (this._light) { this.mgr.lights.release(this._light); this._light = null; }
    this.scene.remove(this.beam);
    this.geo.dispose();
    this.mat.dispose();
  }
}
