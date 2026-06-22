import * as THREE from 'three';
import { Power } from './Power.js';
import { groundHeightAt } from '../world/WorldConfig.js';

const SPEED = 26;
const IMPACT_DMG = 26;
const BURN_DPS = 11;
const ZONE_LIFE = 4.0;
const ZONE_R = 3.6;
const _dir = new THREE.Vector3();

// Fire — launches an emissive fireball that arcs to the aim point, then on
// impact deals burst damage AND ignites the spot: a persistent flame +
// orange particles + PointLight that burns for a few seconds, applying
// burning damage-over-time to any NPC in range, then disposes. Pooled.
export class FirePower extends Power {
  constructor() {
    super({ name: 'Fire', color: 0xff5a1e, icon: '🔥', cooldown: 0.5, manaCost: 16, range: 70 });
  }

  onInit() {
    this.geo = new THREE.IcosahedronGeometry(0.35, 1);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, blending: THREE.AdditiveBlending, transparent: true });
    this.balls = [];
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.visible = false; mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.balls.push({ mesh, vel: new THREE.Vector3(), life: 0, light: null, active: false });
    }
    // persistent ignite zones
    this.flameGeo = new THREE.ConeGeometry(0.9, 2.0, 7);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff6a1e, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85, depthWrite: false });
    this.zones = [];
    for (let i = 0; i < 5; i++) {
      const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
      flame.visible = false; flame.frustumCulled = false;
      this.scene.add(flame);
      this.zones.push({ flame, pos: new THREE.Vector3(), life: 0, light: null, active: false });
    }
  }

  canCast() {
    return this.balls.some((b) => !b.active);
  }

  cast(ctx) {
    const b = this.balls.find((x) => !x.active);
    if (!b) return;
    _dir.copy(ctx.aim.point).sub(ctx.origin);
    if (_dir.lengthSq() < 1) _dir.copy(ctx.aim.dir);
    _dir.normalize();
    b.mesh.position.copy(ctx.origin);
    b.mesh.visible = true;
    b.vel.copy(_dir).multiplyScalar(SPEED);
    b.life = 2.2;
    b.active = true;
    b.light = ctx.lights.acquire(0xff6a2a, 6, 14);
  }

  animate(dt, ctx) {
    // fireballs
    for (const b of this.balls) {
      if (!b.active) continue;
      b.vel.y -= 6 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;
      ctx.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 0.4, Math.random() < 0.5 ? 0xff9a2a : 0xff3a10, -2);
      if (b.light) { b.light.position.copy(p); b.light.intensity = 5 + Math.random() * 2; }
      b.life -= dt;
      const hitGround = p.y <= groundHeightAt(p.x, p.z) + 0.2;
      const reached = p.distanceToSquared(ctx.aim.point) < 2.2;
      if (b.life <= 0 || hitGround || reached || ctx.solidAt(p.x, p.y, p.z)) {
        this._impact(ctx, p);
        b.active = false; b.mesh.visible = false;
        if (b.light) { ctx.lights.release(b.light); b.light = null; }
      }
    }
    // ignite zones (persistent flame + DoT)
    for (const z of this.zones) {
      if (!z.active) continue;
      z.life -= dt;
      const t = z.life / ZONE_LIFE;
      ctx.particles.emit(z.pos.x + (Math.random() - 0.5) * 1.5, z.pos.y + Math.random() * 1.5, z.pos.z + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5), 2 + Math.random() * 2, (Math.random() - 0.5), 0.6, Math.random() < 0.6 ? 0xff6a1e : 0xffc23a, -2.5);
      z.flame.scale.setScalar((0.7 + Math.random() * 0.4) * Math.max(0.2, t));
      if (z.light) z.light.intensity = (4 + Math.random() * 3) * Math.max(0.1, t);
      ctx.applyBurn(z.pos, ZONE_R, BURN_DPS, 1.2); // keep NPCs in range alight
      if (z.life <= 0) {
        z.active = false; z.flame.visible = false;
        if (z.light) { ctx.lights.release(z.light); z.light = null; }
      }
    }
  }

  _impact(ctx, p) {
    ctx.particles.burst(p, 28, { speed: 9, spread: 1, life: 0.7, color: 0xff5a1e, gravity: 5 });
    ctx.particles.burst(p, 14, { speed: 5, spread: 1, life: 1.0, color: 0xffd24a, gravity: 1 });
    ctx.lights.flash(p.x, p.y, p.z, 0xff6a2a, 14, 18, 0.35);
    ctx.damageArea(p, 4.5, IMPACT_DMG, 'fire', null, 8); // burst damage + knockback
    this._ignite(ctx, p);
  }

  _ignite(ctx, p) {
    const z = this.zones.find((x) => !x.active);
    if (!z) return;
    const gy = groundHeightAt(p.x, p.z);
    z.pos.set(p.x, gy, p.z);
    z.flame.position.set(p.x, gy + 1.0, p.z);
    z.flame.visible = true;
    z.life = ZONE_LIFE;
    z.active = true;
    z.light = ctx.lights.acquire(0xff5a1e, 6, 12);
    if (z.light) z.light.position.set(p.x, gy + 1.2, p.z);
  }

  onDispose() {
    for (const b of this.balls) { this.scene.remove(b.mesh); if (b.light) this.mgr.lights.release(b.light); }
    for (const z of this.zones) { this.scene.remove(z.flame); if (z.light) this.mgr.lights.release(z.light); }
    this.geo.dispose(); this.mat.dispose();
    this.flameGeo.dispose(); this.flameMat.dispose();
    this.balls.length = 0; this.zones.length = 0;
  }
}
