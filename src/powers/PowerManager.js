import * as THREE from 'three';
import { ParticlePool } from './ParticlePool.js';
import { LightPool } from './LightPool.js';
import { PowerHUD } from './PowerHUD.js';
import { FirePower } from './FirePower.js';
import { WaterPower } from './WaterPower.js';
import { EarthPower } from './EarthPower.js';
import { LightningPower } from './LightningPower.js';
import { FryPower } from './FryPower.js';
import { AtomicPower } from './AtomicPower.js';
import { StupefyPower, WingardiumPower, ExpelliarmusPower, InvisibilityPower } from './Spells.js';
import { SummonPower } from './SummonPower.js';
import { buildElementTextures } from './ElementTextures.js';
import { LightningFX } from './LightningFX.js';
import { groundHeightAt } from '../world/WorldConfig.js';

// =====================================================================
//  PowerManager — owns the active power, shared FX pools, aiming, the mana
//  economy, cooldowns, input, and the HUD.
//
//  HOW TO ADD A NEW ELEMENT (≤10 lines):
//   1. Create src/powers/XxxPower.js extending Power. For an INSTANT power
//      implement cast(ctx); for a beam implement beamUpdate(dt,ctx,on)
//      (see FryPower.js — it's the template).
//   2. Import it here and add `new XxxPower()` to the `powers` array below.
//      Number keys, HUD slot, cooldown, mana, aiming and pooling are all
//      wired automatically from the Power's config. That's it.
// =====================================================================

const AIM_RANGE = 72;
// selection keys per power slot: 1-9, then 0 for the 10th, then V for the 11th
// (V, not C — C is the flight-descend key, which would double-fire in the air)
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyV'];
const _camPos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class PowerManager {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;

    this.particles = new ParticlePool(scene, 1600);
    this.lights = new LightPool(scene, 8);
    this.lightningFX = new LightningFX(scene); // branching lightning bolt FX pool
    this.raycaster = new THREE.Raycaster();
    this._beams = [];

    this.maxMana = 100;
    this.mana = this.maxMana;
    this.regen = 14; // per second

    // --- register elements (1-6) + spells (7-0, locked until unlocked) ---
    this.powers = [
      new FirePower(),
      new WaterPower(),
      new EarthPower(),
      new LightningPower(),
      new FryPower(),
      new AtomicPower(),
      new StupefyPower(),
      new WingardiumPower(),
      new ExpelliarmusPower(),
      new InvisibilityPower(),
      new SummonPower(),
    ];
    this.powers.forEach((p) => p.init(scene, this));
    this.active = 0;

    // distinct particle sprite per power "mode" (swapped on the shared pool when
    // the active power changes). elementTex = procedural sprites owned here;
    // _texOverride = real threejs.org example sprites loaded later (owned by the
    // TextureLibrary, so NOT disposed here).
    this.elementTex = buildElementTextures();
    this._texOverride = {};
    this._applyActiveTexture();

    // progression-driven multipliers (synced from Progression each frame)
    this.upgrades = { dmg: 1, cd: 1, aoe: 1 };
    this.progression = null;
    this.allySource = null; // NPCManager — provides summonAllies()/canSummon() for SummonPower
    this.arenaBuffActive = false; // set by ArenaManager — supercharges powers in an arena

    this.hud = new PowerHUD(this.powers);
    this.hud.setActive(0);

    // reusable aim result + ctx
    this._origin = new THREE.Vector3();
    this._aim = { point: new THREE.Vector3(), dir: new THREE.Vector3(), type: 'air', object: null };
    this._colliders = null;
    this._targets = []; // damageable systems (NPCs, enemies, boss)
    this._manualFire = 0; // continuous-power pulse timer (E key)
    this._manualEdge = false; // instant-power one-shot (E key)
  }

  // Replace the default PowerHUD with an external HUD (the unified ActionHUD).
  // Must implement setActive(i) / update(manaFrac) / dispose().
  setHUD(hud) {
    if (this.hud && this.hud.dispose && this.hud !== hud) this.hud.dispose();
    this.hud = hud;
    this.hud.setActive(this.active);
  }

  // Fire the active power once from a key tap (E). Continuous powers get a
  // short pulse; instant powers get a single cast. Game calls this so E can
  // stay contextual with building interaction.
  pulse() {
    if (this.powers[this.active].continuous) this._manualFire = 0.2;
    else this._manualEdge = true;
  }

  setActive(i) {
    if (i === this.active || i < 0 || i >= this.powers.length) return;
    if (this.powers[i].locked) { // a not-yet-unlocked spell
      this.game.hud?.toast?.(`${this.powers[i].name} is locked — unlock it in the Skill Tree (K)`, 1800);
      return;
    }
    this.powers[this.active].deactivate(this._ctx); // stop any held beam
    this.active = i;
    this.hud.setActive(i);
    this._applyActiveTexture();
    this.game.audio?.sfx?.('switch');
  }

  // Point the shared particle pool at the active power's sprite (a real
  // threejs.org sprite if one was loaded, else the procedural one).
  _applyActiveTexture() {
    const p = this.powers[this.active];
    const tex = this._texOverride[p.texKey] || (this.elementTex && (this.elementTex[p.texKey] || this.elementTex.default));
    if (tex) this.particles.setTexture(tex);
  }

  // Swap in a real example sprite for a power mode (graceful: ignored if null).
  setElementTexture(key, tex) {
    if (!tex) return;
    this._texOverride[key] = tex; // owned by TextureLibrary; not disposed here
    if (this.powers[this.active].texKey === key) this._applyActiveTexture();
  }

  // Read the progression's multipliers + spell unlocks (called by Game once).
  setProgression(prog) {
    this.progression = prog;
  }

  // The villager pool that SummonPower calls fighters from (NPCManager).
  setAllySource(src) {
    this.allySource = src;
  }

  // ArenaManager toggles this while the hero stands in a combat arena:
  // powers hit harder + wider, cool down faster, and mana regenerates quicker.
  setArenaBuff(on) {
    this.arenaBuffActive = !!on;
  }

  // Immediately recompute spell lock flags from progression (used right after a
  // save is loaded, before update() would otherwise refresh them next frame).
  syncLocks() {
    if (!this.progression) return;
    for (const p of this.powers) if (p.spellKey) p.locked = !this.progression.isUnlocked(p.spellKey);
  }

  spendMana(amount) {
    if (this.mana >= amount) {
      this.mana -= amount;
      return true;
    }
    return false;
  }

  // Fan a combat call out to every registered damageable system.
  _fan(method, ...args) {
    for (const t of this._targets) if (t && t[method]) t[method](...args);
  }

  // Stop any held effect (e.g. the Fry beam) — call when leaving the playing
  // state (pause / enter building) so beams don't freeze on screen or pin a
  // pooled light while the power system isn't being ticked.
  stopActive() {
    this.powers[this.active].deactivate(this._ctx);
  }

  update(dt, deps) {
    this.mana = Math.min(this.maxMana, this.mana + this.regen * (this.arenaBuffActive ? 2 : 1) * dt);
    this._colliders = deps.colliders;
    // damageable systems: NPCs + enemies + boss (any with the combat interface)
    this._targets = deps.targets || (deps.npcs ? [deps.npcs] : []);

    // sync upgrade multipliers + spell unlocks from progression (reset to base
    // every frame so transient buffs below never compound)
    this.upgrades.dmg = this.progression ? this.progression.dmgMul : 1;
    this.upgrades.cd = this.progression ? this.progression.cdMul : 1;
    this.upgrades.aoe = this.progression ? this.progression.aoeMul : 1;
    if (this.progression) {
      for (const p of this.powers) if (p.spellKey) p.locked = !this.progression.isUnlocked(p.spellKey);
    }
    // arena "power surge": stacks on top of the progression multipliers
    if (this.arenaBuffActive) {
      this.upgrades.dmg *= 2.0; // double damage
      this.upgrades.aoe *= 1.4; // wider blasts
      this.upgrades.cd *= 0.6; // 40% faster cooldowns
    }

    // switch powers with number keys 1..9, 0 (10th), then V (Summon Allies, 11th)
    const c = deps.controls;
    for (let i = 0; i < this.powers.length; i++) {
      if (SLOT_KEYS[i] && c.consume(SLOT_KEYS[i])) this.setActive(i);
    }

    this._computeAim(deps);
    const ctx = this._buildCtx(dt, deps);

    for (let i = 0; i < this.powers.length; i++) {
      this.powers[i].update(dt, ctx, i === this.active);
    }

    this.particles.update(dt);
    this.lights.update(dt);
    this.lightningFX.update(dt);
    this.hud.update(this.mana / this.maxMana);
  }

  // Aim from the camera through screen centre: analytic march vs terrain +
  // colliders for the point (cheap, skips instanced foliage), plus a genuine
  // THREE.Raycaster against NPC meshes to identify a hit creature.
  _computeAim(deps) {
    const cam = deps.camera;
    cam.getWorldPosition(_camPos);
    cam.getWorldDirection(_dir);

    let hitT = AIM_RANGE;
    let type = 'air';
    for (let t = 2; t <= AIM_RANGE; t += 1.0) {
      const x = _camPos.x + _dir.x * t;
      const y = _camPos.y + _dir.y * t;
      const z = _camPos.z + _dir.z * t;
      if (y <= groundHeightAt(x, z)) { hitT = t; type = 'ground'; break; }
      if (this._solid(x, y, z)) { hitT = t; type = 'structure'; break; }
    }

    this._aim.point.copy(_camPos).addScaledVector(_dir, hitT);
    this._aim.dir.copy(_dir);
    this._aim.object = null;
    this._aim.type = type;

    // Creature pick via THREE.Raycaster (real meshes, small set) — aggregated
    // across every damageable system (NPCs, enemies, boss).
    const targets = [];
    for (const t of this._targets) if (t && t.raycastTargets) for (const m of t.raycastTargets()) targets.push(m);
    if (targets.length) {
      this.raycaster.set(_camPos, _dir);
      this.raycaster.far = hitT;
      const hit = this.raycaster.intersectObjects(targets, false)[0];
      if (hit) {
        this._aim.point.copy(hit.point);
        this._aim.object = hit.object.userData.npc || hit.object.userData.enemy || null;
        this._aim.type = 'npc';
      }
    }
  }

  _solid(x, y, z) {
    const cols = this._colliders;
    if (!cols) return false;
    for (const col of cols) {
      if (col.top !== undefined && y > col.top) continue;
      if (col.type === 'box') {
        if (x > col.minX && x < col.maxX && z > col.minZ && z < col.maxZ) return true;
      } else if (col.type === 'circle') {
        const dx = x - col.x;
        const dz = z - col.z;
        if (dx * dx + dz * dz < col.r * col.r) return true;
      }
    }
    return false;
  }

  _buildCtx(dt, deps) {
    const p = deps.player.pos;
    this._origin.set(p.x, p.y + 1.55, p.z);

    const c = deps.controls;
    // Cast = hold Left Mouse (while pointer-locked) or a manual pulse from the
    // E key (see pulse(), driven by Game so E stays contextual with interact).
    const mouseEdge = c.consumeMouse();
    const engaged = !!c.locked;
    // when the sword is drawn, left-mouse is the swing — don't also cast powers
    // (E still casts via pulse(), so every element stays usable in melee mode)
    const melee = !!deps.meleeMode;
    if (this._manualFire > 0) this._manualFire -= dt;
    const firing = (!melee && engaged && c.mouseDown) || this._manualFire > 0;
    const castEdge = (!melee && engaged && mouseEdge) || this._manualEdge;
    this._manualEdge = false;

    // progression multipliers applied to every cast
    const dmgMul = this.upgrades.dmg, aoeMul = this.upgrades.aoe;
    const ctx = (this._ctx = {
      dt,
      scene: this.scene,
      origin: this._origin,
      aim: this._aim,
      player: deps.player, // spells (e.g. Invisibility) act on the player
      firing,
      castEdge,
      cdMul: this.upgrades.cd, // Power._tryCast shortens cooldown by this
      particles: this.particles,
      lights: this.lights,
      spendMana: (a) => this.spendMana(a),
      solidAt: (x, y, z) => this._solid(x, y, z),
      // fan combat calls out to every damageable system (NPCs + enemies + boss),
      // scaling damage + AoE by the player's upgrades
      pushNPCs: (point, radius, dir, force) => this._fan('push', point, radius * aoeMul, dir, force),
      damageArea: (point, radius, amount, type, kdir, kforce, tick) =>
        this._fan('damageArea', point, radius * aoeMul, amount * dmgMul, type, kdir, kforce, tick),
      applyBurn: (point, radius, dps, dur) => this._fan('applyBurn', point, radius * aoeMul, dps * dmgMul, dur),
      stunArea: (point, radius, dur) => this._fan('stunArea', point, radius * aoeMul, dur),
      // branching lightning bolt (LightningFX) between two points
      lightning: (from, to, color, life) => this.lightningFX.strike(from, to, color, life),
      // summon friendly fighters to the player's side (SummonPower)
      summonAllies: (n, dur) => (this.allySource ? this.allySource.summonAllies(p, n, dur) : 0),
      canSummon: () => !!(this.allySource && this.allySource.canSummon()),
      sound: (name) => this.game.audio?.sfx?.(name),
    });
    return ctx;
  }

  // --- beam helpers (used by the FryPower template) -------------------
  makeBeam(color) {
    const geo = new THREE.CylinderGeometry(0.14, 0.14, 1, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(geo, mat);
    beam.visible = false;
    beam.frustumCulled = false;
    this.scene.add(beam);
    this._beams.push(beam);
    return beam;
  }

  aimBeam(beam, ctx, on, color) {
    if (!on) { beam.visible = false; return; }
    const from = ctx.origin;
    const to = ctx.aim.point;
    const len = from.distanceTo(to);
    _dir.copy(to).sub(from).normalize();
    _mid.copy(from).addScaledVector(_dir, len / 2);
    beam.position.copy(_mid);
    _q.setFromUnitVectors(_up, _dir);
    beam.quaternion.copy(_q);
    beam.scale.set(1, len, 1);
    beam.visible = true;
    ctx.particles.emit(to.x, to.y, to.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.5, color, -2);
  }

  dispose() {
    this.powers.forEach((p) => p.dispose());
    for (const b of this._beams) {
      this.scene.remove(b);
      b.geometry.dispose();
      b.material.dispose();
    }
    this._beams.length = 0;
    for (const k in this.elementTex) this.elementTex[k].dispose();
    this.particles.dispose();
    this.lights.dispose();
    this.lightningFX.dispose();
    this.hud.dispose();
  }
}
