import { Power } from './Power.js';

// Lightning — fires a branching, flickering bolt (LightningFX, via
// ctx.lightning) from the player to the aim point, with a blinding flash,
// impact sparks (real threejs.org spark sprite), area stun and a hard knockback.
export class LightningPower extends Power {
  constructor() {
    super({ name: 'Lightning', color: 0x9fd8ff, icon: '⚡', cooldown: 0.35, manaCost: 16, range: 75 });
  }

  cast(ctx) {
    const o = ctx.origin, p = ctx.aim.point;
    if (ctx.lightning) ctx.lightning(o, p, 0x9fd8ff, 0.32); // branching lightning bolt
    ctx.lights.flash(p.x, p.y + 1, p.z, 0xbfe6ff, 20, 24, 0.2);
    ctx.lights.flash(o.x, o.y, o.z, 0x9fd8ff, 8, 12, 0.12);
    ctx.particles.burst(p, 22, { speed: 10, spread: 1, life: 0.5, color: 0xdff2ff, gravity: 2 });
    ctx.damageArea(p, 4, 38, 'lightning', null, 14); // area damage + knockback
    ctx.stunArea(p, 5, 1.6); // area stun
  }
}
