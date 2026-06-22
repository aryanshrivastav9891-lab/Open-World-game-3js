import * as THREE from 'three';
import { Assets } from '../world/Assets.js';
import { groundHeightAt, surfaceAt, Surface, blockedByStructure } from '../world/WorldConfig.js';
import { regionAt, REGIONS } from '../world/Regions.js';
import { astar, lineOfSight, seek, separate, flock } from '../ai/AI.js';
import { CharacterModel } from '../characters/CharacterModel.js';
import { dampAngle, clamp, lerp } from '../utils/math.js';

// =====================================================================
//  EnemyManager — pooled HOSTILE enemies (ground + flying) driven by real
//  game AI:
//    • Finite state machine  idle/patrol → chase → attack → flee
//    • Ground enemies path with A* on a coarse nav grid (around buildings),
//      shortcutting to a direct seek when they have line-of-sight.
//    • Flying enemies use boids flocking + seek/​swoop.
//    • Aggro radius + line-of-sight gating; getting hit also alerts them.
//    • Full HP/damage (typed damage, hit flash, knockback, floating numbers,
//      3D health bar, death→ragdoll→respawn) — the SAME combat interface the
//      PowerManager already drives (damageArea/applyBurn/stunArea/push).
//    • They damage the PLAYER on contact (melee / swoop).
//  Enemies stay resident near the player and belong to whatever COUNTRY they
//  are standing in (Regions.enemy stats), so the streamed world is always
//  populated with region-appropriate foes.
// =====================================================================

const COUNT_GROUND = 12; // a bigger pool so combat arenas feel packed
const COUNT_FLY = 4;
const AGGRO_R = 36;
const DEAGGRO_R = 60;
const ATTACK_R_GROUND = 2.6;
const ATTACK_R_FLY = 3.2;
const ATTACK_CD = 1.2;
const RELOCATE_R = 150; // too far from the player → respawn near them
const SPAWN_MIN = 42;
const SPAWN_MAX = 84;
const ENEMY_R = 0.5;
const TAU = Math.PI * 2;

const DMG_COLOR = { fire: '#ff8a3a', burn: '#ff7a2a', earth: '#e0c070', water: '#8fd0ff', lightning: '#cdeaff', fry: '#ff5a3a', hit: '#ffffff' };
const ELEMENT_COLOR = { fire: 0xff5a1e, water: 0x3fa9f5, lightning: 0xcdeaff, earth: 0x9c7a4d };

// Monster archetypes — stat/scale/behaviour multipliers on top of the region's
// base enemy stats. `model` picks a real glTF (graceful fallback to procedural).
const MONSTER_TYPES = {
  // model mapping per the requested three.js examples: small enemy → FBX
  // (webgl_loader_fbx), medium enemy → MD2 (webgl_loader_md2_control), brute →
  // glTF Robot. All fall back to the procedural monster if the asset fails.
  grunt: { hpMul: 0.9, dmgMul: 0.9, speedMul: 1.2, scale: 0.92, ranged: false, attackR: 2.6, model: 'fbxsmall', label: 'Grunt' },
  caster: { hpMul: 0.8, dmgMul: 1.1, speedMul: 0.9, scale: 1.0, ranged: true, attackR: 22, model: 'md2warrior', label: 'Caster' },
  brute: { hpMul: 2.4, dmgMul: 1.9, speedMul: 0.66, scale: 1.5, ranged: false, attackR: 3.0, model: 'robot', label: 'Brute' },
  flyer: { hpMul: 0.7, dmgMul: 0.9, speedMul: 1.2, scale: 1.0, ranged: false, attackR: ATTACK_R_FLY, model: 'enemybird', label: 'Flyer' },
};
// The 12 ground enemies cycle this 8-slot pattern (→ 7 grunt / 3 caster / 2
// brute); type is fixed per slot so its model stays stable, while difficulty
// scales by region on each spawn.
const GROUND_TYPE_BY_INDEX = ['grunt', 'grunt', 'caster', 'grunt', 'caster', 'brute', 'grunt', 'brute'];

function toon(color, emissive = 0, ei = 0) {
  return new THREE.MeshToonMaterial({ color, emissive: new THREE.Color(emissive), emissiveIntensity: ei, gradientMap: Assets.gradientMap });
}

export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.combatHUD = null;
    this.particles = null;
    this.onKill = null; // (regionKey, xp) → MissionManager
    this._colliders = null;
    this.modelLib = null;
    this._buildShared();

    this.enemies = [];
    this._hitMeshes = [];
    for (let i = 0; i < COUNT_GROUND; i++) this.enemies.push(this._makeGround(i));
    for (let i = 0; i < COUNT_FLY; i++) this.enemies.push(this._makeFly(i));
    this._buildProjectiles();
  }

  // Pooled elemental bolts thrown by CASTER monsters (and reused every shot).
  _buildProjectiles() {
    this.projGeo = new THREE.IcosahedronGeometry(0.35, 1);
    this.projectiles = [];
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(this.projGeo, mat);
      mesh.visible = false; mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.projectiles.push({ mesh, mat, vel: new THREE.Vector3(), life: 0, active: false, dmg: 0, color: 0xff5a1e });
    }
  }

  setHooks({ combatHUD, particles, onKill } = {}) {
    this.combatHUD = combatHUD || this.combatHUD;
    this.particles = particles || this.particles;
    this.onKill = onKill || this.onKill;
  }

  // Adopt a real fabric/armour bump on the enemy materials (graceful).
  applyDetail(t) {
    const set = (m) => { m.bumpMap = t; m.bumpScale = 0.02; m.needsUpdate = true; };
    set(this.mats.dark); set(this.mats.metal);
    for (const k in this.enemyMats) set(this.enemyMats[k]);
  }

  // Adopt real glTF monster models per archetype (grunt→X-Bot, caster→Soldier,
  // brute→Robot; flyers stay procedural). Graceful fallback to procedural.
  setModelLibrary(lib) {
    this.modelLib = lib;
    for (const e of this.enemies) {
      if (!e.modelName) continue;
      lib.onReady(e.modelName, (d) => this._applyEnemyModel(e, d));
    }
  }
  _applyEnemyModel(e, data) {
    if (!data || e.char) return;
    const inst = this.modelLib.instance(e.modelName, true); // clone mats → per-enemy hit flash
    if (!inst) return;
    inst.scene.scale.multiplyScalar(inst.factor);
    inst.scene.position.y = inst.groundOffset;
    inst.scene.rotation.y = inst.faceFix;
    e.modelRoot = new THREE.Group();
    e.modelRoot.add(inst.scene);
    e.group.add(e.modelRoot);
    e.char = new CharacterModel(inst.scene, inst.clips);
    e._modelMats = [];
    e.modelRoot.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const mm of ms) if (mm) e._modelMats.push(mm); } });
    e._charState = 'idle';
    if (e.alive) for (const me of e._procMeshes) me.visible = false; // hide procedural body
  }

  _buildShared() {
    this.geo = {
      torso: new THREE.BoxGeometry(0.56, 0.74, 0.34).translate(0, 1.08, 0),
      head: new THREE.IcosahedronGeometry(0.2, 1).translate(0, 1.58, 0),
      helm: new THREE.ConeGeometry(0.26, 0.4, 6).translate(0, 1.78, 0),
      arm: new THREE.BoxGeometry(0.14, 0.54, 0.14).translate(0, -0.27, 0),
      leg: new THREE.BoxGeometry(0.17, 0.66, 0.17).translate(0, -0.33, 0),
      foot: new THREE.BoxGeometry(0.2, 0.12, 0.28).translate(0, -0.68, 0.04),
      blade: new THREE.BoxGeometry(0.08, 1.1, 0.16).translate(0, -0.5, 0),
      eye: new THREE.BoxGeometry(0.24, 0.06, 0.05).translate(0, 1.58, -0.18),
      // flyer
      fbody: new THREE.IcosahedronGeometry(0.5, 1),
      fwing: new THREE.BoxGeometry(1.4, 0.06, 0.6),
      fhorn: new THREE.ConeGeometry(0.16, 0.7, 5).rotateX(-Math.PI / 2),
      ftail: new THREE.ConeGeometry(0.16, 0.8, 6).rotateX(Math.PI / 2),
    };
    this.mats = {
      dark: toon(0x23262b),
      metal: toon(0x4a4e57),
      eye: toon(0xff3020, 0xff3020, 1.6),
      flash: toon(0xffffff, 0xff3020, 1.6),
    };
    // one body material per region accent (no per-respawn allocation → no leak)
    this.enemyMats = {};
    for (const r of REGIONS) this.enemyMats[r.key] = toon(r.enemy.color);

    this.barMat = {
      bg: new THREE.SpriteMaterial({ color: 0x10131a, transparent: true, depthWrite: false, depthTest: false }),
      hi: new THREE.SpriteMaterial({ color: 0xff7a3a, transparent: true, depthWrite: false, depthTest: false }),
      lo: new THREE.SpriteMaterial({ color: 0xd8514a, transparent: true, depthWrite: false, depthTest: false }),
    };
  }

  _makeBar(headY) {
    const bg = new THREE.Sprite(this.barMat.bg);
    bg.center.set(0, 0.5);
    bg.scale.set(1.4, 0.16, 1);
    const fill = new THREE.Sprite(this.barMat.hi);
    fill.center.set(0, 0.5);
    fill.scale.set(1.4, 0.12, 1);
    bg.visible = fill.visible = false;
    bg.renderOrder = fill.renderOrder = 6;
    this.scene.add(bg, fill);
    return { bg, fill, headY };
  }

  _base(group, hitMesh, mode, headY) {
    const e = {
      mode, group, hitMesh,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      target: new THREE.Vector3(),
      facing: Math.random() * TAU,
      phase: Math.random() * 10,
      knock: new THREE.Vector3(),
      regionKey: 'japan',
      hp: 100, maxHp: 100, dmg: 10, xp: 40,
      alive: true, dying: false, deadTimer: 0,
      hitFlash: 0, stun: 0, burn: 0, burnDps: 0,
      barTimer: 0, accum: 0, accumT: 0,
      state: 'patrol', stateT: 0, alert: 0, atkCd: 0,
      path: null, pathIdx: 0, repathT: 0,
      bar: this._makeBar(headY),
    };
    e.baseMat = hitMesh.material;
    hitMesh.userData.enemy = e;
    return e;
  }

  _makeGround(i) {
    const g = this.geo, m = this.mats;
    const group = new THREE.Group();
    const proc = []; // procedural meshes (hidden when a glTF monster model loads)
    const mk = (geo, mat) => { const me = new THREE.Mesh(geo, mat); proc.push(me); return me; };
    const torso = mk(g.torso, m.dark);
    torso.castShadow = true;
    group.add(torso, mk(g.head, m.metal), mk(g.helm, m.metal), mk(g.eye, m.eye));
    const legL = new THREE.Group(); legL.position.set(-0.14, 0.74, 0); legL.add(mk(g.leg, m.dark), mk(g.foot, m.metal));
    const legR = new THREE.Group(); legR.position.set(0.14, 0.74, 0); legR.add(mk(g.leg, m.dark), mk(g.foot, m.metal));
    const armL = new THREE.Group(); armL.position.set(-0.33, 1.34, 0); armL.add(mk(g.arm, m.dark));
    const armR = new THREE.Group(); armR.position.set(0.33, 1.34, 0); armR.add(mk(g.arm, m.dark), mk(g.blade, m.metal));
    group.add(legL, legR, armL, armR);
    group.visible = false;
    this.scene.add(group);
    const e = this._base(group, torso, 'ground', 2.4);
    e.legL = legL; e.legR = legR; e.armL = armL; e.armR = armR;
    const tkey = GROUND_TYPE_BY_INDEX[i % GROUND_TYPE_BY_INDEX.length];
    this._initType(e, tkey, proc);
    return e;
  }

  _makeFly(i) {
    const g = this.geo, m = this.mats;
    const group = new THREE.Group();
    const proc = [];
    const mk = (geo, mat) => { const me = new THREE.Mesh(geo, mat); proc.push(me); return me; };
    const body = mk(g.fbody, m.dark); body.scale.set(0.9, 0.6, 1.5); body.castShadow = true;
    const horn = mk(g.fhorn, m.eye); horn.position.set(0, 0.1, -0.7);
    const tail = mk(g.ftail, m.dark); tail.position.set(0, 0.05, 0.75);
    const wingL = new THREE.Group(); wingL.position.set(-0.35, 0.1, 0); { const w = mk(g.fwing, m.metal); w.position.x = -0.7; wingL.add(w); }
    const wingR = new THREE.Group(); wingR.position.set(0.35, 0.1, 0); { const w = mk(g.fwing, m.metal); w.position.x = 0.7; wingR.add(w); }
    group.add(body, horn, tail, wingL, wingR);
    group.visible = false;
    this.scene.add(group);
    const e = this._base(group, body, 'fly', 1.2);
    e.wingL = wingL; e.wingR = wingR;
    this._initType(e, 'flyer', proc);
    return e;
  }

  // Fixed-per-slot monster archetype + model/animation bookkeeping.
  _initType(e, tkey, proc) {
    e.type = tkey;
    e.typeDef = MONSTER_TYPES[tkey];
    e.modelName = e.typeDef.model;
    e.ranged = e.typeDef.ranged;
    e.attackR = e.typeDef.attackR;
    e.speedMul = e.typeDef.speedMul;
    e.radius = ENEMY_R * e.typeDef.scale;
    e.element = 'fire';
    e._procMeshes = proc;
    e.char = null; e.modelRoot = null; e._modelMats = null; e._charState = 'idle';
    e._casting = false; e.castT = 0;
  }

  // ---------------- spawning / relocation ----------------
  _spawnNear(e, px, pz) {
    let x = px, z = pz;
    for (let t = 0; t < 12; t++) {
      const a = Math.random() * TAU;
      const r = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      x = px + Math.cos(a) * r;
      z = pz + Math.sin(a) * r;
      if (surfaceAt(x, z) !== Surface.WATER && !blockedByStructure(x, z, 2)) break;
    }
    const region = regionAt(x, z);
    const def = region.enemy;
    const td = e.typeDef;
    const tier = 1 + region.index * 0.18; // difficulty scales per region
    e.regionKey = region.key;
    e.maxHp = Math.round(def.hp * td.hpMul * tier); e.hp = e.maxHp;
    e.dmg = def.dmg * td.dmgMul * tier;
    e.xp = Math.round(def.xp * (0.6 + td.hpMul) * tier);
    e.element = ['fire', 'lightning', 'water', 'earth'][region.index % 4];
    e.group.scale.setScalar(td.scale); // brutes are big, grunts smaller
    e.hitMesh.material = this.enemyMats[region.key]; // procedural fallback colour
    e.baseMat = this.enemyMats[region.key];
    e.alive = true; e.dying = false; e.deadTimer = 0;
    e.hitFlash = 0; e.stun = 0; e.burn = 0; e.burnDps = 0; e.knock.set(0, 0, 0);
    e.state = 'patrol'; e.stateT = 1 + Math.random() * 2; e.alert = 0; e.atkCd = 0;
    e._casting = false; e.castT = 0;
    e.path = null; e.pathIdx = 0; e.repathT = 0;
    e.group.rotation.set(0, e.facing, 0);
    e.group.visible = true;
    if (e.char) for (const me of e._procMeshes) me.visible = false; // model active → keep body hidden
    if (e.mode === 'ground') {
      e.pos.set(x, groundHeightAt(x, z), z);
    } else {
      e.pos.set(x, groundHeightAt(x, z) + 12 + Math.random() * 10, z);
    }
    e.vel.set(0, 0, 0);
    this._pickPatrol(e);
    if (!this._hitMeshes.includes(e.hitMesh)) this._hitMeshes.push(e.hitMesh);
  }

  _pickPatrol(e) {
    for (let t = 0; t < 10; t++) {
      const a = Math.random() * TAU, r = 6 + Math.random() * 26;
      const x = e.pos.x + Math.cos(a) * r, z = e.pos.z + Math.sin(a) * r;
      if (surfaceAt(x, z) !== Surface.WATER && !blockedByStructure(x, z, 2)) {
        e.target.set(x, e.mode === 'fly' ? groundHeightAt(x, z) + 10 + Math.random() * 12 : 0, z);
        return;
      }
    }
    e.target.copy(e.pos);
  }

  // ---------------- combat target interface (PowerManager) ----------------
  raycastTargets() {
    return this._hitMeshes;
  }

  _forEachInRange(point, radius, fn) {
    const r2 = radius * radius;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - point.x, dz = e.pos.z - point.z, dy = e.pos.y - point.y;
      const d2 = dx * dx + dz * dz + dy * dy * 0.5;
      if (d2 <= r2) fn(e, Math.sqrt(d2));
    }
  }

  push(point, radius, dir, force) {
    this._forEachInRange(point, radius, (e, d) => {
      const f = 1 - d / radius;
      if (dir) { e.knock.x += dir.x * force * f; e.knock.z += dir.z * force * f; }
      else {
        const ddx = e.pos.x - point.x, ddz = e.pos.z - point.z, dd = Math.hypot(ddx, ddz) || 1e-3;
        e.knock.x += (ddx / dd) * force * f; e.knock.z += (ddz / dd) * force * f;
      }
    });
  }

  damageArea(point, radius, amount, type, knockDir, knockForce = 0, tick = false) {
    this._forEachInRange(point, radius, (e, d) => {
      const falloff = 1 - 0.6 * (d / radius);
      this.damage(e, amount * falloff, type, tick);
      if (knockForce) {
        if (knockDir) { e.knock.x += knockDir.x * knockForce; e.knock.z += knockDir.z * knockForce; }
        else {
          const ddx = e.pos.x - point.x, ddz = e.pos.z - point.z, dd = Math.hypot(ddx, ddz) || 1e-3;
          e.knock.x += (ddx / dd) * knockForce; e.knock.z += (ddz / dd) * knockForce;
        }
      }
    });
  }

  applyBurn(point, radius, dps, duration) {
    this._forEachInRange(point, radius, (e) => { e.burn = Math.max(e.burn, duration); e.burnDps = Math.max(e.burnDps, dps); });
  }

  stunArea(point, radius, duration) {
    this._forEachInRange(point, radius, (e) => { e.stun = Math.max(e.stun, duration); });
  }

  damage(e, amount, type, tick = false) {
    if (!e.alive || amount <= 0) return;
    e.hp -= amount;
    e.hitFlash = Math.max(e.hitFlash, 0.12);
    e.barTimer = 3.0;
    e.alert = 5; // being hit aggroes the enemy even without line of sight
    if (tick) e.accum += amount;
    else if (this.combatHUD) this.combatHUD.spawn(this._headPos(e, _v), Math.round(amount), DMG_COLOR[type] || '#fff');
    if (e.hp <= 0) this._kill(e, type);
  }

  _kill(e, type) {
    e.alive = false; e.dying = true; e.deadTimer = 1.7; e.hp = 0; e.burn = 0;
    e.barTimer = 0; e.hitFlash = 0;
    e.hitMesh.material = e.baseMat;
    e.bar.bg.visible = e.bar.fill.visible = false;
    if (this.combatHUD) this.combatHUD.spawn(this._headPos(e, _v), 'KILL', '#ffd24a', true);
    const idx = this._hitMeshes.indexOf(e.hitMesh);
    if (idx >= 0) this._hitMeshes.splice(idx, 1);
    if (this.onKill) this.onKill(e.regionKey, e.xp);
  }

  _headPos(e, out) {
    return out.set(e.pos.x, e.pos.y + e.bar.headY, e.pos.z);
  }

  // ---------------- passability for AI ----------------
  _blocked(x, z) {
    const cols = this._colliders;
    if (!cols) return false;
    for (const c of cols) {
      if (c.slim) continue; // trees: don't path around them (cheap A*); _resolve handles push-out
      if (c.type === 'box') {
        if (x > c.minX - ENEMY_R && x < c.maxX + ENEMY_R && z > c.minZ - ENEMY_R && z < c.maxZ + ENEMY_R) return true;
      } else if (c.type === 'circle') {
        const dx = x - c.x, dz = z - c.z, rr = c.r + ENEMY_R;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
    return false;
  }

  // ---------------- per-frame ----------------
  update(dt, player, colliders) {
    this._colliders = colliders;
    const pp = player.pos;
    for (const e of this.enemies) {
      if (e.dying) { this._updateDying(dt, e); this._updateBar(e, dt); continue; }
      // dead & waiting for respawnDead() — never simulate an invisible corpse
      if (!e.alive) { this._updateBar(e, dt); continue; }

      // status effects
      if (e.burn > 0) {
        e.burn -= dt;
        this.damage(e, e.burnDps * dt, 'burn', true);
        if (this.particles && Math.random() < 0.5)
          this.particles.emit(e.pos.x + (Math.random() - 0.5) * 0.5, e.pos.y + 1 + Math.random(), e.pos.z + (Math.random() - 0.5) * 0.5, 0, 1.5, 0, 0.5, Math.random() < 0.5 ? 0xff7a2a : 0xffb43a, -1);
        if (e.burn <= 0) e.burnDps = 0;
        if (!e.alive) { this._updateBar(e, dt); continue; }
      }
      e.accumT -= dt;
      if (e.accumT <= 0 && Math.round(e.accum) >= 1) {
        if (this.combatHUD) this.combatHUD.spawn(this._headPos(e, _v), Math.round(e.accum), DMG_COLOR.burn);
        e.accum = 0; e.accumT = 0.4;
      }
      if (e.stun > 0) e.stun -= dt;
      if (e.alert > 0) e.alert -= dt;
      if (e.atkCd > 0) e.atkCd -= dt;

      // relocate if the player wandered far away
      const flat2 = (e.pos.x - pp.x) ** 2 + (e.pos.z - pp.z) ** 2;
      if (flat2 > RELOCATE_R * RELOCATE_R) { this._spawnNear(e, pp.x, pp.z); continue; }

      this._think(dt, e, player);
      if (e.mode === 'ground') this._moveGround(dt, e, player);
      else this._moveFly(dt, e, player);
      // cancel an interrupted caster wind-up so it restarts a full telegraph next time
      if (e.ranged && e._casting && e.state !== 'attack') { e._casting = false; e.castT = 0; }

      // hit-flash material swap (procedural; model flash handled in _moveGround)
      e.hitMesh.material = e.hitFlash > 0 ? this.mats.flash : e.baseMat;
      if (e.hitFlash > 0) e.hitFlash -= dt;

      this._updateBar(e, dt);
    }
    this._updateProjectiles(dt, player); // caster bolts fly on their own
  }

  // FSM transitions (idle/patrol → chase → attack → flee)
  _think(dt, e, player) {
    const pp = player.pos;
    const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, dy = pp.y - e.pos.y;
    const dist = Math.hypot(dx, dz);
    const dist3 = Math.hypot(dx, dy, dz);
    const playerAlive = player.alive !== false;

    // flee when badly hurt
    if (playerAlive && e.hp / e.maxHp < 0.22) { e.state = 'flee'; return; }
    if (!playerAlive) { e.state = 'patrol'; return; }
    if (player.invisible) { e.state = 'patrol'; e.alert = 0; return; } // Invisibility Cloak



    const canSee = e.alert > 0 || (dist < AGGRO_R && lineOfSight(e.pos.x, e.pos.z, pp.x, pp.z, (x, z) => this._blocked(x, z), 3));
    const atkR = e.attackR || (e.mode === 'ground' ? ATTACK_R_GROUND : ATTACK_R_FLY);

    if (e.state === 'flee') {
      if (e.hp / e.maxHp > 0.45 || dist > DEAGGRO_R) e.state = 'patrol';
      return;
    }
    if (canSee) {
      e.state = dist3 < atkR ? 'attack' : 'chase';
    } else if (dist > DEAGGRO_R) {
      e.state = 'patrol';
    } else if (e.state === 'chase' || e.state === 'attack') {
      e.state = 'chase'; // lost sight but still nearby → keep pursuing last seen
    } else {
      e.state = 'patrol';
    }
  }

  _tryHitPlayer(e, player) {
    if (!e.alive || e.atkCd > 0 || player.alive === false) return;
    const dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z, dy = player.pos.y - e.pos.y;
    const atkR = e.mode === 'ground' ? ATTACK_R_GROUND : ATTACK_R_FLY;
    if (Math.hypot(dx, dz, dy) <= atkR + 0.6 + (e.radius || 0)) {
      e.atkCd = ATTACK_CD;
      if (player.hurt) player.hurt(e.dmg, e.pos);
      if (this.particles) this.particles.burst({ x: player.pos.x, y: player.pos.y + 1, z: player.pos.z }, 8, { speed: 4, spread: 1, life: 0.4, color: 0xff5a3a, gravity: 2 });
    }
  }

  _moveGround(dt, e, player) {
    const pp = player.pos;
    let speed = 0;
    let knockSpeed = Math.hypot(e.knock.x, e.knock.z);
    if (knockSpeed > 16) { const s = 16 / knockSpeed; e.knock.x *= s; e.knock.z *= s; knockSpeed = 16; } // cap → no tunnelling
    if (knockSpeed > 0.1) {
      e.pos.x += e.knock.x * dt; e.pos.z += e.knock.z * dt;
      const decay = Math.exp(-6 * dt); e.knock.x *= decay; e.knock.z *= decay;
      speed = knockSpeed;
    } else if (e.stun > 0) {
      // stunned — rooted
    } else if (e.state === 'attack') {
      this._faceTo(e, pp.x - e.pos.x, pp.z - e.pos.z, dt, 12);
      if (e.ranged) this._rangedCast(dt, e, player); // casters hurl elemental bolts (with a tell)
      else this._tryHitPlayer(e, player);
    } else if (e.state === 'chase') {
      const hasLOS = lineOfSight(e.pos.x, e.pos.z, pp.x, pp.z, (x, z) => this._blocked(x, z), 3);
      let tx = pp.x, tz = pp.z;
      if (!hasLOS) {
        e.repathT -= dt;
        if (e.repathT <= 0 || !e.path) {
          e.path = astar(e.pos.x, e.pos.z, pp.x, pp.z, (x, z) => this._blocked(x, z), { cell: 3, pad: 26, maxNodes: 500 });
          e.pathIdx = 0; e.repathT = 0.5 + Math.random() * 0.3;
        }
        const wp = e.path && e.path[e.pathIdx];
        if (wp) {
          if (Math.hypot(wp.x - e.pos.x, wp.z - e.pos.z) < 1.6 && e.pathIdx < e.path.length - 1) e.pathIdx++;
          tx = wp.x; tz = wp.z;
        }
      }
      speed = this._steerGround(e, tx, tz, 3.6 * e.speedMul, dt);
    } else if (e.state === 'flee') {
      let ax = e.pos.x - pp.x, az = e.pos.z - pp.z;
      const al = Math.hypot(ax, az);
      if (al < 0.1) { ax = -Math.sin(e.facing); az = -Math.cos(e.facing); } else { ax /= al; az /= al; }
      speed = this._steerGround(e, e.pos.x + ax * 20, e.pos.z + az * 20, 4.2 * e.speedMul, dt); // flee in a guaranteed direction
    } else {
      // patrol
      if (Math.hypot(e.target.x - e.pos.x, e.target.z - e.pos.z) < 1.2) {
        e.stateT -= dt;
        if (e.stateT <= 0) { this._pickPatrol(e); e.stateT = 2 + Math.random() * 3; }
      } else speed = this._steerGround(e, e.target.x, e.target.z, 1.6 * e.speedMul, dt);
    }

    if (this._colliders) this._resolve(e);
    e.pos.y = groundHeightAt(e.pos.x, e.pos.z);

    e.phase += dt * (speed > 0.3 ? 8 : 2);
    const swing = speed > 0.3 ? Math.sin(e.phase) * 0.7 : 0;
    e.legL.rotation.x = swing; e.legR.rotation.x = -swing;
    e.armL.rotation.x = -swing * 0.6;
    e.armR.rotation.x = e.state === 'attack' ? -1.4 + Math.sin(e.phase * 3) * 0.4 : swing * 0.6;
    e.group.position.copy(e.pos);
    e.group.rotation.set(0, e.facing, 0);

    // drive the glTF monster model (if one loaded) + hit flash on its materials
    if (e.char) {
      const st = e.state === 'attack' && !e.ranged ? 'run' : speed > 3 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
      if (st !== e._charState) { e.char.setState(st); e._charState = st; }
      e.char.update(dt);
      const flash = e.hitFlash > 0;
      for (const mm of e._modelMats) { if (!mm.emissive) continue; if (flash) { mm.emissive.setRGB(0.9, 0.2, 0.2); mm.emissiveIntensity = 1; } else mm.emissive.setRGB(0, 0, 0); }
    }
  }

  // CASTER attack: a brief wind-up TELL (gathering particles) the player can read
  // and dodge, then an elemental bolt fired toward the player.
  _rangedCast(dt, e, player) {
    if (e.atkCd > 0 && !e._casting) return;
    if (!e._casting) { e._casting = true; e.castT = 0.6; }
    e.castT -= dt;
    if (this.particles && Math.random() < 0.7)
      this.particles.emit(e.pos.x + (Math.random() - 0.5) * 0.6, e.pos.y + 1.4, e.pos.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5), 1, (Math.random() - 0.5), 0.4, ELEMENT_COLOR[e.element] || 0xff5a1e, 0);
    if (e.castT <= 0) { e._casting = false; e.atkCd = 2.2; this._fireBolt(e, player); }
  }

  _fireBolt(e, player) {
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return;
    const fromY = e.pos.y + 1.4;
    p.mesh.position.set(e.pos.x, fromY, e.pos.z);
    const tx = player.pos.x - e.pos.x, ty = player.pos.y + 1 - fromY, tz = player.pos.z - e.pos.z;
    const d = Math.hypot(tx, ty, tz) || 1;
    const spd = 20;
    p.vel.set((tx / d) * spd, (ty / d) * spd, (tz / d) * spd);
    p.life = 2.2; p.active = true; p.mesh.visible = true;
    p.dmg = e.dmg; p.color = ELEMENT_COLOR[e.element] || 0xff5a1e;
    p.mat.color.setHex(p.color);
    if (this.particles) this.particles.burst({ x: e.pos.x, y: fromY, z: e.pos.z }, 8, { speed: 5, spread: 1, life: 0.3, color: p.color, gravity: 0 });
  }

  _updateProjectiles(dt, player) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.life -= dt;
      if (this.particles) this.particles.emit(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0, 0, 0, 0.25, p.color, 0);
      const pp = player.pos;
      const hit = Math.hypot(pp.x - p.mesh.position.x, pp.y + 1 - p.mesh.position.y, pp.z - p.mesh.position.z) < 1.4;
      const ground = p.mesh.position.y <= groundHeightAt(p.mesh.position.x, p.mesh.position.z) + 0.2;
      if (hit && player.hurt) player.hurt(p.dmg, p.mesh.position);
      if (hit || ground || p.life <= 0) {
        if (this.particles) this.particles.burst({ x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z }, 10, { speed: 5, spread: 1, life: 0.4, color: p.color, gravity: 2 });
        p.active = false; p.mesh.visible = false;
      }
    }
  }

  _steerGround(e, tx, tz, maxSpeed, dt) {
    seek(e.pos.x, e.pos.z, tx, tz, maxSpeed, _steer);
    separate(e, this.enemies, 2.2, _sep);
    let vx = _steer.x + _sep.x * 3.0;
    let vz = _steer.z + _sep.z * 3.0;
    const sp = Math.hypot(vx, vz) || 1e-3;
    vx = (vx / sp) * maxSpeed; vz = (vz / sp) * maxSpeed;
    e.pos.x += vx * dt; e.pos.z += vz * dt;
    this._faceTo(e, vx, vz, dt, 10);
    return maxSpeed;
  }

  _moveFly(dt, e, player) {
    const pp = player.pos;
    let knockSpeed = Math.hypot(e.knock.x, e.knock.z);
    if (knockSpeed > 16) { const s = 16 / knockSpeed; e.knock.x *= s; e.knock.z *= s; }
    if (knockSpeed > 0.1) {
      e.pos.x += e.knock.x * dt; e.pos.z += e.knock.z * dt;
      const decay = Math.exp(-5 * dt); e.knock.x *= decay; e.knock.z *= decay;
    }
    // desired velocity = boids + goal seek
    flock(e, this.enemies, { sep: 9, align: 0.5, coh: 0.4, sepR: 6, alignR: 16, cohR: 20 }, _acc);
    let gx, gy, gz;
    if (e.state === 'attack') {
      this._tryHitPlayer(e, player);
      gx = pp.x; gy = pp.y + 0.5; gz = pp.z;
    } else if (e.state === 'chase') {
      gx = pp.x; gy = pp.y + 2.0; gz = pp.z; // swoop toward, slightly above
    } else if (e.state === 'flee') {
      let ax = e.pos.x - pp.x, az = e.pos.z - pp.z;
      const al = Math.hypot(ax, az);
      if (al < 0.1) { ax = -Math.sin(e.facing); az = -Math.cos(e.facing); } else { ax /= al; az /= al; }
      gx = e.pos.x + ax * 20; gy = e.pos.y + 6; gz = e.pos.z + az * 20;
    } else {
      if (e.pos.distanceToSquared(e.target) < 9) { this._pickPatrol(e); }
      gx = e.target.x; gy = e.target.y; gz = e.target.z;
    }
    const maxSpeed = e.state === 'chase' || e.state === 'attack' ? 9 : e.state === 'flee' ? 11 : 6;
    const dgx = gx - e.pos.x, dgy = gy - e.pos.y, dgz = gz - e.pos.z;
    const dg = Math.hypot(dgx, dgy, dgz) || 1e-3;
    const desX = (dgx / dg) * maxSpeed + _acc.x;
    const desY = (dgy / dg) * maxSpeed + _acc.y;
    const desZ = (dgz / dg) * maxSpeed + _acc.z;
    const k = 1 - Math.exp(-4 * dt);
    e.vel.x += (desX - e.vel.x) * k;
    e.vel.y += (desY - e.vel.y) * k;
    e.vel.z += (desZ - e.vel.z) * k;
    e.pos.addScaledVector(e.vel, dt);
    e.pos.y = Math.max(e.pos.y, groundHeightAt(e.pos.x, e.pos.z) + 3);

    this._faceTo(e, e.vel.x, e.vel.z, dt, 5);
    e.phase += dt * 10;
    const flap = Math.sin(e.phase) * 0.8;
    e.wingL.rotation.z = flap; e.wingR.rotation.z = -flap;
    const bank = clamp(-e.vel.x * 0.02, -0.5, 0.5);
    e.group.position.copy(e.pos);
    if (e.char) {
      // real bird model (front +Z): yaw to velocity (facing + π), flap clip + hit flash
      e.group.rotation.set(0, e.facing + Math.PI, bank);
      e.char.update(dt);
      const fl = e.hitFlash > 0;
      for (const mm of e._modelMats) { if (!mm.emissive) continue; if (fl) { mm.emissive.setRGB(0.9, 0.2, 0.2); mm.emissiveIntensity = 1; } else mm.emissive.setRGB(0, 0, 0); }
    } else {
      e.group.rotation.set(0, e.facing, bank);
    }
  }

  _faceTo(e, dx, dz, dt, rate) {
    if (Math.hypot(dx, dz) > 0.05) e.facing = dampAngle(e.facing, Math.atan2(-dx, -dz), rate, dt);
  }

  _updateDying(dt, e) {
    e.deadTimer -= dt;
    if (e.mode === 'fly') {
      e.vel.y -= 24 * dt;
      e.pos.y += e.vel.y * dt;
      const gy = groundHeightAt(e.pos.x, e.pos.z);
      if (e.pos.y <= gy) e.pos.y = gy;
    }
    e.group.rotation.z = lerp(e.group.rotation.z, 1.5, 1 - Math.exp(-8 * dt));
    if (e.deadTimer < 0.8) e.pos.y -= dt * 1.4;
    e.group.position.copy(e.pos);
    if (e.deadTimer <= 0) { e.group.visible = false; e.alive = false; e.dying = false; e._needRespawn = true; }
  }

  _updateBar(e, dt) {
    const bar = e.bar;
    const show = e.alive && e.barTimer > 0 && e.hp < e.maxHp;
    bar.bg.visible = bar.fill.visible = show;
    if (!show) { if (e.barTimer > 0) e.barTimer -= dt; return; }
    e.barTimer -= dt;
    const frac = clamp(e.hp / e.maxHp, 0, 1);
    const hx = e.pos.x - 0.7, hy = e.pos.y + bar.headY, hz = e.pos.z;
    bar.bg.position.set(hx, hy, hz);
    bar.fill.position.set(hx, hy, hz);
    bar.fill.scale.set(1.4 * frac, 0.12, 1);
    bar.fill.material = frac < 0.35 ? this.barMat.lo : this.barMat.hi;
  }

  _resolve(e) {
    const R = e.radius || ENEMY_R; // bigger monsters (brutes) push out further
    for (const c of this._colliders) {
      if (c.type === 'box') {
        const nx = clamp(e.pos.x, c.minX, c.maxX);
        const nz = clamp(e.pos.z, c.minZ, c.maxZ);
        const dx = e.pos.x - nx, dz = e.pos.z - nz, d2 = dx * dx + dz * dz;
        if (d2 < R * R) {
          if (d2 > 1e-6) { const d = Math.sqrt(d2), push = R - d; e.pos.x += (dx / d) * push; e.pos.z += (dz / d) * push; }
          else {
            const dl = e.pos.x - c.minX, dr = c.maxX - e.pos.x, db = e.pos.z - c.minZ, df = c.maxZ - e.pos.z;
            const mn = Math.min(dl, dr, db, df);
            if (mn === dl) e.pos.x = c.minX - R; else if (mn === dr) e.pos.x = c.maxX + R;
            else if (mn === db) e.pos.z = c.minZ - R; else e.pos.z = c.maxZ + R;
          }
        }
      } else if (c.type === 'circle') {
        const dx = e.pos.x - c.x, dz = e.pos.z - c.z, rr = R + c.r, d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-3, push = rr - d; e.pos.x += (dx / d) * push; e.pos.z += (dz / d) * push; }
      }
    }
  }

  // Ensure dead enemies come back near the player (called by Game each frame).
  respawnDead(px, pz) {
    for (const e of this.enemies) if (e._needRespawn) { e._needRespawn = false; this._spawnNear(e, px, pz); }
  }

  // Place the whole pool around a point (initial spawn / after fast travel).
  resetAround(px, pz) {
    for (const e of this.enemies) this._spawnNear(e, px, pz);
  }

  countAlive() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  // Boss reinforcements: yank up to `count` ground enemies (preferring dead /
  // far-away ones) to (x,z), already alerted so they immediately engage.
  summon(x, z, count) {
    const pool = this.enemies
      .filter((e) => e.mode === 'ground')
      .sort((a, b) => (a.alive === b.alive ? 0 : a.alive ? 1 : -1));
    let n = 0;
    for (const e of pool) {
      if (n >= count) break;
      this._spawnNear(e, x, z);
      e.pos.x = x + (Math.random() - 0.5) * 8;
      e.pos.z = z + (Math.random() - 0.5) * 8;
      e.alert = 8;
      e.state = 'chase';
      n++;
    }
    return n;
  }

  // ARENA: pack up to `count` monsters INSIDE the arena ring (radius r around
  // cx,cz), already alerted + chasing. Tops up — enemies already inside the ring
  // are left alone; dead/far ones are pulled in. Used by ArenaManager.
  fillArena(cx, cz, r, count) {
    const r2 = r * r;
    const isInside = (e) => e.alive && (e.pos.x - cx) ** 2 + (e.pos.z - cz) ** 2 < r2;
    let need = count;
    for (const e of this.enemies) if (isInside(e)) need--;
    if (need <= 0) return 0;
    const pool = this.enemies
      .filter((e) => !isInside(e))
      .sort((a, b) => (a.alive === b.alive ? 0 : a.alive ? 1 : -1)); // dead first, then far-away
    let n = 0;
    for (const e of pool) {
      if (n >= need) break;
      this._spawnNear(e, cx, cz); // sets region stats, model, visible
      let x = cx, z = cz;
      for (let t = 0; t < 6; t++) { // a spot inside the ring, preferring dry land
        const a = Math.random() * TAU, rr = r * (0.25 + Math.random() * 0.7);
        x = cx + Math.cos(a) * rr; z = cz + Math.sin(a) * rr;
        if (surfaceAt(x, z) !== Surface.WATER) break;
      }
      if (e.mode === 'ground') e.pos.set(x, groundHeightAt(x, z), z);
      else e.pos.set(x, groundHeightAt(x, z) + 8 + Math.random() * 8, z);
      e.alert = 10; e.state = 'chase'; // engage immediately
      n++;
    }
    return n;
  }

  dispose() {
    for (const e of this.enemies) {
      if (e.char) e.char.dispose();
      for (const mm of e._modelMats || []) mm.dispose && mm.dispose();
      this.scene.remove(e.group, e.bar.bg, e.bar.fill);
    }
    for (const p of this.projectiles || []) { this.scene.remove(p.mesh); p.mat.dispose(); }
    if (this.projGeo) this.projGeo.dispose();
    for (const k of Object.keys(this.geo)) this.geo[k].dispose();
    for (const k of Object.keys(this.mats)) this.mats[k].dispose();
    for (const k of Object.keys(this.enemyMats)) this.enemyMats[k].dispose();
    this.barMat.bg.dispose(); this.barMat.hi.dispose(); this.barMat.lo.dispose();
    this.enemies.length = 0;
    this._hitMeshes.length = 0;
  }
}

const _v = new THREE.Vector3();
const _steer = { x: 0, z: 0 };
const _sep = { x: 0, z: 0 };
const _acc = { x: 0, y: 0, z: 0 };
