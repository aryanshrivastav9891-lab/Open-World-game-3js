import * as THREE from 'three';
import { Power } from './Power.js';
import { groundHeightAt } from '../world/WorldConfig.js';

// =====================================================================
//  Atomic Blast — the ultimate. A huge, expensive AoE detonation at the aim
//  point: blinding flash, a rising mushroom-cloud column + cap, a ground
//  shockwave ring, and massive radial damage + burn + stun over a wide radius.
//  It costs FAR more mana than any other power (so it can only be used
//  occasionally) and has a long cooldown. Pure VFX from the shared pools — no
//  per-cast allocation. Uses the bespoke `atomic` particle sprite.
// =====================================================================
export class AtomicPower extends Power {
  constructor() {
    super({ name: 'Atomic', color: 0xffd24a, icon: '☢', cooldown: 6.0, manaCost: 70, range: 64, sound: 'atomic', texKey: 'atomic' });
  }

  cast(ctx) {
    const a = ctx.aim.point;
    const gy = groundHeightAt(a.x, a.z);
    const p = { x: a.x, y: gy + 0.4, z: a.z };

    // blinding flash + sustained glow
    ctx.lights.flash(p.x, p.y + 1, p.z, 0xfff0c0, 80, 46, 0.7);
    ctx.lights.flash(p.x, p.y + 6, p.z, 0xffb43a, 50, 40, 0.9);

    // ground-zero fireball
    ctx.particles.burst(p, 70, { speed: 20, spread: 1, life: 1.3, color: 0xffe07a, gravity: 2 });
    ctx.particles.burst(p, 50, { speed: 11, spread: 1, life: 1.8, color: 0xff5a1e, gravity: 1 });

    // rising mushroom stem
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      ctx.particles.emit(p.x + (Math.random() - 0.5) * 1.4, p.y + t * 11, p.z + (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 2, 7, (Math.random() - 0.5) * 2, 1.5, t > 0.6 ? 0xffcaa0 : 0xffb43a, -1);
    }
    // billowing cap at the top
    ctx.particles.burst({ x: p.x, y: p.y + 11, z: p.z }, 56, { speed: 9, spread: 1, life: 2.0, color: 0xffd9a8, gravity: 1.6 });

    // ground shockwave ring
    for (let k = 0; k < 44; k++) {
      const ang = (k / 44) * Math.PI * 2;
      ctx.particles.emit(p.x + Math.cos(ang), p.y, p.z + Math.sin(ang), Math.cos(ang) * 15, 1.5, Math.sin(ang) * 15, 0.9, 0xfff0c0, 1);
    }

    // crackling lightning arcs climbing the mushroom column (real LightningStrike)
    if (ctx.lightning) {
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        ctx.lightning(p, { x: p.x + Math.cos(ang) * 3.5, y: p.y + 13, z: p.z + Math.sin(ang) * 3.5 }, 0xfff0c0, 0.5);
      }
    }

    // devastating wide-area damage + lingering burn + stun
    ctx.damageArea(p, 12, 120, 'fire', null, 16);
    ctx.applyBurn(p, 12, 16, 3);
    ctx.stunArea(p, 12, 2);
  }
}
