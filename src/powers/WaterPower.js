import * as THREE from 'three';
import { Power } from './Power.js';

const _dir = new THREE.Vector3();
const _p = new THREE.Vector3();

// Water — a forward jet of spray that pushes NPCs in a cone and leaves an
// expanding splash ring (pooled) wherever it lands.
export class WaterPower extends Power {
  constructor() {
    super({ name: 'Water', color: 0x3fa9f5, icon: '💧', cooldown: 0.7, manaCost: 15, range: 50 });
  }

  onInit() {
    this.ringGeo = new THREE.RingGeometry(0.3, 0.6, 24);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, scale: 1, active: false });
    }
    // wet/splash decals left on the ground
    this.decalGeo = new THREE.CircleGeometry(2.0, 18).rotateX(-Math.PI / 2);
    this.decals = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x2a3a4a, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(this.decalGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.decals.push({ mesh, mat, life: 0, active: false });
    }
  }

  cast(ctx) {
    _dir.copy(ctx.aim.dir);
    // jet of droplets from the player toward the aim
    for (let k = 0; k < 22; k++) {
      const t = (k / 22) * Math.min(this.range, ctx.origin.distanceTo(ctx.aim.point));
      _p.copy(ctx.origin).addScaledVector(_dir, t);
      ctx.particles.emit(
        _p.x, _p.y, _p.z,
        _dir.x * 6 + (Math.random() - 0.5) * 3,
        _dir.y * 6 + (Math.random() - 0.5) * 3 + 1,
        _dir.z * 6 + (Math.random() - 0.5) * 3,
        0.6, Math.random() < 0.5 ? 0x8fd0ff : 0x3fa9f5, 9
      );
    }
    // splash ring at the impact
    const r = this.rings.find((x) => !x.active);
    if (r) {
      r.mesh.position.copy(ctx.aim.point);
      r.mesh.position.y += 0.05;
      r.scale = 1;
      r.mat.opacity = 0.8;
      r.mesh.scale.setScalar(1);
      r.mesh.visible = true;
      r.active = true;
    }
    ctx.particles.burst(ctx.aim.point, 16, { speed: 4, spread: 1, life: 0.6, color: 0x8fd0ff, gravity: 9 });
    ctx.lights.flash(ctx.aim.point.x, ctx.aim.point.y + 1, ctx.aim.point.z, 0x6ab8ff, 6, 12, 0.2);
    // shove NPCs in the jet's forward cone (water = strong knockback, no damage)
    ctx.pushNPCs(ctx.aim.point, 5, _dir, 13);
    // leave a wet splash decal
    const d = this.decals.find((x) => !x.active);
    if (d) {
      d.mesh.position.set(ctx.aim.point.x, ctx.aim.point.y + 0.04, ctx.aim.point.z);
      d.mat.opacity = 0.55;
      d.life = 3.0;
      d.active = true;
      d.mesh.visible = true;
    }
  }

  animate(dt) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.scale += dt * 9;
      r.mesh.scale.setScalar(r.scale);
      r.mat.opacity -= dt * 1.3;
      if (r.mat.opacity <= 0) { r.active = false; r.mesh.visible = false; r.mat.opacity = 0; }
    }
    for (const d of this.decals) {
      if (!d.active) continue;
      d.life -= dt;
      d.mat.opacity = Math.max(0, (d.life / 3.0) * 0.55);
      if (d.life <= 0) { d.active = false; d.mesh.visible = false; }
    }
  }

  onDispose() {
    for (const r of this.rings) { this.scene.remove(r.mesh); r.mat.dispose(); }
    for (const d of this.decals) { this.scene.remove(d.mesh); d.mat.dispose(); }
    this.ringGeo.dispose();
    this.decalGeo.dispose();
    this.rings.length = 0;
    this.decals.length = 0;
  }
}
