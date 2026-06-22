import * as THREE from 'three';
import { Power } from './Power.js';
import { groundHeightAt } from '../world/WorldConfig.js';

// Earth — raises a craggy rock pillar out of the ground at the aim point with
// a burst of dust, holds, then sinks back. Pillars are pooled and shove
// nearby NPCs when they erupt.
export class EarthPower extends Power {
  constructor() {
    super({ name: 'Earth', color: 0x9c7a4d, icon: '🪨', cooldown: 1.0, manaCost: 22, range: 40 });
  }

  onInit() {
    // unit-height, vertex-coloured craggy rock (scaled per pillar)
    this.geo = new THREE.CylinderGeometry(0.9, 1.25, 1, 6, 1);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x6f6c64, roughness: 1, flatShading: true });
    this.pillars = [];
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.visible = false;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.pillars.push({ mesh, state: 'idle', t: 0, h: 3, gy: 0 });
    }
  }

  canCast() {
    return this.pillars.some((p) => p.state === 'idle');
  }

  cast(ctx) {
    const pl = this.pillars.find((x) => x.state === 'idle');
    if (!pl) return;
    const point = ctx.aim.point;
    const gy = groundHeightAt(point.x, point.z);
    pl.h = 2.4 + Math.random() * 1.8;
    pl.gy = gy;
    pl.state = 'rising';
    pl.t = 0;
    pl.mesh.scale.set(0.7 + Math.random() * 0.6, pl.h, 0.7 + Math.random() * 0.6);
    pl.mesh.rotation.y = Math.random() * Math.PI;
    pl.mesh.position.set(point.x, gy - pl.h / 2 - pl.h - 1, point.z); // buried
    pl.mesh.visible = true;
    // eruption dust + heavy impact (earth is the big hitter: knockback + damage)
    ctx.particles.burst({ x: point.x, y: gy + 0.2, z: point.z }, 24, { speed: 5, spread: 1, life: 0.9, color: 0x9c7a4d, gravity: 8 });
    ctx.damageArea(point, 3.8, 55, 'earth', null, 12);
  }

  animate(dt, ctx) {
    for (const pl of this.pillars) {
      if (pl.state === 'idle') continue;
      pl.t += dt;
      const risenY = pl.gy - 0.3 + pl.h / 2;
      const buriedY = pl.gy - pl.h / 2 - pl.h - 1;
      if (pl.state === 'rising') {
        const k = Math.min(1, pl.t / 0.25);
        pl.mesh.position.y = buriedY + (risenY - buriedY) * easeOut(k);
        if (Math.random() < 0.5)
          ctx.particles.emit(pl.mesh.position.x + (Math.random() - 0.5) * 2, pl.gy + 0.1, pl.mesh.position.z + (Math.random() - 0.5) * 2, 0, 1, 0, 0.6, 0x8a6a44, 6);
        if (k >= 1) { pl.state = 'holding'; pl.t = 0; }
      } else if (pl.state === 'holding') {
        if (pl.t > 4) { pl.state = 'sinking'; pl.t = 0; }
      } else if (pl.state === 'sinking') {
        const k = Math.min(1, pl.t / 0.8);
        pl.mesh.position.y = risenY + (buriedY - risenY) * k;
        if (k >= 1) { pl.state = 'idle'; pl.mesh.visible = false; }
      }
    }
  }

  onDispose() {
    for (const pl of this.pillars) this.scene.remove(pl.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this.pillars.length = 0;
  }
}

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}
