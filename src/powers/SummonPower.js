import { Power } from './Power.js';

// =====================================================================
//  Summon Allies — call 2-3 friendly NPC fighters to your side. They spawn
//  around you in a flash of green, then charge nearby enemies and blast them
//  with elemental bolts (fire / lightning / water / earth) before fading back
//  into ordinary villagers after ~18s. Reuses the pooled villagers in
//  NPCManager (no new allocation) via ctx.summonAllies / ctx.canSummon.
//
//  Selected with the V key (slot 11); cast it (left-click / E) to summon.
//  (V, not C — C is the flight-descend key.)
// =====================================================================
export class SummonPower extends Power {
  constructor() {
    super({ name: 'Allies', color: 0x8fe39a, icon: '👥', cooldown: 16, manaCost: 45, range: 0, sound: 'switch', texKey: 'arcane' });
  }

  // don't waste mana/cooldown if there's no villager to call
  canCast(ctx) {
    return !!(ctx.canSummon && ctx.canSummon());
  }

  cast(ctx) {
    const n = ctx.summonAllies ? ctx.summonAllies(3, 18) : 0;
    if (n <= 0) return;
    const o = ctx.origin;
    ctx.lights.flash(o.x, o.y, o.z, 0x8fe39a, 18, 20, 0.35); // rally flash
    ctx.particles.burst({ x: o.x, y: o.y - 0.6, z: o.z }, 32, { speed: 6, spread: 1, life: 0.8, color: 0x8fe39a, gravity: 1 });
  }
}
