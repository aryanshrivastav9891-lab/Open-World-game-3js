import * as THREE from 'three';
import { Power } from './Power.js';

// =====================================================================
//  Spells — Harry-Potter-style wand spells. They are ordinary Power subclasses,
//  so they auto-wire into the PowerManager (number-key slot, HUD, cooldown,
//  mana, aiming, upgrade multipliers). They start LOCKED (`this.locked = true`)
//  and are unlocked in the Skill Tree (progression). Each reuses the shared
//  combat ctx (damageArea / stunArea / pushNPCs / particles / lights), so its
//  effects scale with the player's damage/AoE/cooldown upgrades automatically.
//
//  HOW TO ADD A NEW SPELL (a few lines):
//    1. class FooPower extends Power { constructor(){ super({name,color,icon,
//       cooldown,manaCost,range}); this.spellKey='foo'; this.locked=true; }
//       cast(ctx){ /* use ctx.aim.point + ctx.damageArea/stunArea/pushNPCs */ } }
//    2. add `new FooPower()` to the powers array in PowerManager, and add 'foo'
//       to Progression.spells so it appears in the skill tree.
// =====================================================================

const _dir = new THREE.Vector3();

// Stupefy — a fast stun bolt: flash + small damage + a solid stun at the aim point.
export class StupefyPower extends Power {
  constructor() {
    super({ name: 'Stupefy', color: 0xff2e63, icon: '✦', cooldown: 1.0, manaCost: 18, range: 64, sound: 'lightning', texKey: 'arcane' });
    this.spellKey = 'stupefy';
    this.locked = true;
  }
  cast(ctx) {
    const p = ctx.aim.point, o = ctx.origin;
    if (ctx.lightning) ctx.lightning(o, p, 0xff6aa0, 0.26); // real bolt, tinted pink
    ctx.particles.burst(p, 22, { speed: 8, spread: 1, life: 0.5, color: 0xff5a8a, gravity: 1 });
    ctx.lights.flash(p.x, p.y, p.z, 0xff2e63, 14, 16, 0.3);
    ctx.damageArea(p, 3, 22, 'lightning', null, 4);
    ctx.stunArea(p, 3.5, 2.4);
  }
}

// Wingardium Leviosa — telekinesis: lift + hurl nearby enemies away from the point.
export class WingardiumPower extends Power {
  constructor() {
    super({ name: 'Wingardium', color: 0x8a5cff, icon: '⤴', cooldown: 1.6, manaCost: 24, range: 58, sound: 'water', texKey: 'arcane' });
    this.spellKey = 'wingardium';
    this.locked = true;
  }
  cast(ctx) {
    const p = ctx.aim.point;
    ctx.particles.burst(p, 28, { speed: 6, spread: 1, life: 0.9, color: 0xb79bff, gravity: -3 }); // upward swirl
    ctx.lights.flash(p.x, p.y, p.z, 0x8a5cff, 10, 14, 0.3);
    ctx.pushNPCs(p, 5.5, null, 28); // big radial throw
    ctx.damageArea(p, 5.5, 8, 'earth', null, 0); // light impact
  }
}

// Expelliarmus — disarm: a forward blast that knocks back + briefly disables foes.
export class ExpelliarmusPower extends Power {
  constructor() {
    super({ name: 'Expelliarmus', color: 0xff9a2a, icon: '➤', cooldown: 1.3, manaCost: 20, range: 52, sound: 'fire', texKey: 'arcane' });
    this.spellKey = 'expelliarmus';
    this.locked = true;
  }
  cast(ctx) {
    const p = ctx.aim.point;
    _dir.copy(ctx.aim.dir);
    ctx.particles.burst(p, 22, { speed: 9, spread: 0.6, life: 0.5, color: 0xffd24a, gravity: 0, dir: _dir });
    ctx.lights.flash(p.x, p.y, p.z, 0xff9a2a, 12, 14, 0.28);
    ctx.pushNPCs(p, 4.8, _dir, 22);
    ctx.stunArea(p, 4.8, 1.8); // "disarmed" → can't act briefly
    ctx.damageArea(p, 4.8, 12, 'lightning', _dir, 0);
  }
}

// Invisibility Cloak — vanish from enemy aggro for a few seconds (a player buff).
export class InvisibilityPower extends Power {
  constructor() {
    super({ name: 'Cloak', color: 0xbfe6ff, icon: '❂', cooldown: 9, manaCost: 30, range: 0, sound: 'switch', texKey: 'arcane' });
    this.spellKey = 'invisibility';
    this.locked = true;
    this.duration = 6;
  }
  canCast(ctx) {
    return !!(ctx.player && ctx.player.setInvisible);
  }
  cast(ctx) {
    ctx.player.setInvisible(this.duration);
    const o = ctx.origin;
    ctx.particles.burst({ x: o.x, y: o.y, z: o.z }, 26, { speed: 4, spread: 1, life: 0.9, color: 0xbfe6ff, gravity: 0 });
  }
}
