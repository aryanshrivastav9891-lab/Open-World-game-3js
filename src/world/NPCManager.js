import * as THREE from 'three';
import { Assets } from './Assets.js';
import { groundHeightAt, surfaceAt, Surface, blockedByStructure } from './WorldConfig.js';
import { dampAngle, clamp, lerp } from '../utils/math.js';
import { CharacterModel } from '../characters/CharacterModel.js';

// =====================================================================
//  NPCManager — pooled living villagers, both WALKING and FLYING, wired into
//  a shared health/damage system.
//
//  Health/damage API (used by PowerManager via ctx):
//    damageArea(point, r, amount, type, knockDir, knockForce)
//    applyBurn(point, r, dps, duration)   — damage-over-time status
//    stunArea(point, r, duration)
//    push(point, r, dir, force)           — pure knockback (no damage)
//  Each NPC has HP, takes typed damage, shows a floating number + a 3D health
//  bar, flinches (hit flash), gets knocked back, and dies (ragdoll → despawn →
//  respawn). Set effect sinks with setEffects({ combatHUD, particles }).
// =====================================================================

const COUNT_WALK = 14;
const COUNT_FLY = 6;
const TOWN_R = 72;
const AIR_R = 95;
const WALK = 1.5;
const FLY = 5.5;
const NPC_R = 0.42;
const WALK_HP = 60;
const FLY_HP = 40;
const TAU = Math.PI * 2;

const DMG_COLOR = { fire: '#ff8a3a', burn: '#ff7a2a', earth: '#e0c070', water: '#8fd0ff', lightning: '#cdeaff', fry: '#ff5a3a', hit: '#ffffff' };
const ALLY_COLORS = { fire: 0xff7a2a, lightning: 0xcdeaff, water: 0x8fd0ff, earth: 0xe0c070 };
const ALLY_ELEMS = ['fire', 'lightning', 'water', 'earth'];
const BIRD_MODELS = ['flamingo', 'parrot', 'stork']; // real glTF birds for the flying villagers

function toon(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: Assets.gradientMap });
}

export class NPCManager {
  constructor(scene) {
    this.scene = scene;
    this.combatHUD = null;
    this.particles = null;
    this.modelLib = null;
    this.walkerModels = ['soldier', 'xbot', 'robot']; // varied real models for villagers
    this._buildShared();

    this.npcs = [];
    this._hitMeshes = [];
    for (let i = 0; i < COUNT_WALK; i++) this.npcs.push(this._makeWalker(i));
    for (let i = 0; i < COUNT_FLY; i++) this.npcs.push(this._makeFlyer(i));
  }

  setEffects({ combatHUD, particles }) {
    this.combatHUD = combatHUD || this.combatHUD;
    this.particles = particles || this.particles;
  }

  // Turn the first `n` villagers into friendly GUARDIANS that fire bolts at
  // nearby enemies (they target/damage via the EnemyManager combat interface).
  setAllies(n, enemyMgr) {
    this._enemyMgr = enemyMgr;
    const walkers = this.npcs.filter((e) => e.mode === 'walk');
    for (let i = 0; i < n && i < walkers.length; i++) { walkers[i].ally = true; walkers[i].permanentAlly = true; }
  }

  // SummonPower hook: is there at least one villager we can call to your side?
  canSummon() {
    return this.npcs.some((n) => n.mode === 'walk' && n.alive && !n.summoned);
  }

  // Call up to `count` friendly fighters to the player's side for `duration`
  // seconds. They spawn around the player, get a random element, are healed to
  // full, and engage nearby enemies (see _allyMove/_allyFire). Returns how many
  // were actually summoned. Reuses the pooled villagers — no new allocation.
  summonAllies(playerPos, count = 3, duration = 18) {
    if (!playerPos || !this._enemyMgr) return 0;
    const pool = this.npcs.filter((n) => n.mode === 'walk' && n.alive && !n.summoned);
    pool.sort((a, b) => (a.permanentAlly ? 1 : 0) - (b.permanentAlly ? 1 : 0)); // prefer fresh villagers
    let made = 0;
    for (let i = 0; i < pool.length && made < count; i++) {
      const npc = pool[i];
      const ang = (made / count) * TAU - Math.PI / 2;
      let px = playerPos.x + Math.cos(ang) * 2.6, pz = playerPos.z + Math.sin(ang) * 2.6;
      if (blockedByStructure(px, pz, 1)) { px = playerPos.x; pz = playerPos.z; }
      npc.pos.set(px, groundHeightAt(px, pz), pz);
      npc.knock.set(0, 0, 0);
      npc.ally = true; npc.summoned = true; npc.summonT = duration;
      npc.allyElement = ALLY_ELEMS[made % ALLY_ELEMS.length];
      npc.hp = npc.maxHp; npc.stun = 0; npc.burn = 0; npc.burnDps = 0;
      npc.barTimer = 0; npc.idle = 0; npc.allyCd = 0.3 + made * 0.2; // stagger first shots
      if (this.particles) this.particles.burst({ x: px, y: npc.pos.y + 1, z: pz }, 26, { speed: 7, spread: 1, life: 0.7, color: ALLY_COLORS[npc.allyElement], gravity: 1 });
      made++;
    }
    return made;
  }

  _nearestEnemy(pos, r) {
    if (!this._enemyMgr) return null;
    let best = null, bd = r * r;
    for (const e of this._enemyMgr.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }
  // An ally casts an elemental bolt at the nearest enemy (fire/lightning/water/
  // earth, per npc.allyElement). Fire also lights a short burn.
  _allyFire(dt, npc) {
    npc.allyCd -= dt;
    if (npc.allyCd > 0) return;
    const e = this._nearestEnemy(npc.pos, 30);
    if (!e) return;
    npc.allyCd = 1.1;
    const el = npc.allyElement || 'lightning';
    const col = ALLY_COLORS[el] || 0x8fd0ff;
    const dx = e.pos.x - npc.pos.x, dz = e.pos.z - npc.pos.z;
    npc.facing = Math.atan2(-dx, -dz);
    const tp = { x: e.pos.x, y: e.pos.y + 1, z: e.pos.z };
    if (this.particles) {
      const ox = npc.pos.x, oy = npc.pos.y + 1.4, oz = npc.pos.z;
      for (let t = 0.1; t < 1; t += 0.1) this.particles.emit(ox + (tp.x - ox) * t, oy + (tp.y - oy) * t, oz + (tp.z - oz) * t, 0, 0, 0, 0.3, col, 0);
      this.particles.burst(tp, 10, { speed: 6, spread: 1, life: 0.35, color: col, gravity: 0 });
    }
    this._enemyMgr.damageArea(tp, 2.6, 20, el, null, 5);
    if (el === 'fire' && this._enemyMgr.applyBurn) this._enemyMgr.applyBurn(tp, 2.6, 6, 2);
  }

  // Combat movement for an ally: close in on the nearest enemy (then hold at
  // firing range), otherwise follow the player. Returns the move speed (for the
  // walk/run animation). Does not pick random wander targets.
  _allyMove(dt, npc, playerPos) {
    const e = this._nearestEnemy(npc.pos, 46);
    let tx = null, tz = null, fast = false;
    if (e) {
      const ex = e.pos.x - npc.pos.x, ez = e.pos.z - npc.pos.z, ed = Math.hypot(ex, ez) || 1;
      if (ed > 17) { tx = e.pos.x; tz = e.pos.z; fast = true; } // charge in
      else { npc.facing = dampAngle(npc.facing, Math.atan2(-ex, -ez), 8, dt); return 0; } // hold + fire
    } else if (playerPos) {
      const px = playerPos.x - npc.pos.x, pz = playerPos.z - npc.pos.z, pd = Math.hypot(px, pz) || 1;
      if (pd > 6) { tx = playerPos.x; tz = playerPos.z; fast = pd > 16; } // regroup on the player
      else return 0;
    } else return 0;
    const mx = tx - npc.pos.x, mz = tz - npc.pos.z, md = Math.hypot(mx, mz) || 1;
    const spd = fast ? WALK * 2.8 : WALK * 1.7;
    npc.pos.x += (mx / md) * spd * dt; npc.pos.z += (mz / md) * spd * dt;
    npc.facing = dampAngle(npc.facing, Math.atan2(-mx, -mz), 8, dt);
    return spd;
  }

  // Adopt a real fabric/skin bump on the villager materials (graceful).
  applyDetail(t) {
    const set = (m) => { m.bumpMap = t; m.bumpScale = 0.02; m.needsUpdate = true; };
    this.mats.kimono.forEach(set);
    this.mats.bird.forEach(set);
    set(this.mats.skin); set(this.mats.hat); set(this.mats.dark);
  }

  // Adopt real, varied glTF character models for the WALKING villagers (flyers
  // stay procedural birds). Graceful: keeps the procedural body if a model fails.
  setModelLibrary(lib) {
    this.modelLib = lib;
    for (const npc of this.npcs) {
      if (!npc.modelName) continue;
      if (npc.mode === 'walk') lib.onReady(npc.modelName, (data) => this._applyNpcModel(npc, data));
      else lib.onReady(npc.modelName, (data) => this._applyFlyerModel(npc, data)); // real birds
    }
  }

  // Swap a flying villager's procedural bird for a real glTF bird (Flamingo /
  // Parrot / Stork), animated by its flap clip. Graceful: keeps the procedural
  // bird if the model fails.
  _applyFlyerModel(npc, data) {
    if (!data || npc.char) return;
    const inst = this.modelLib.instance(npc.modelName, true); // clone mats → per-bird hit flash
    if (!inst) return;
    inst.scene.scale.multiplyScalar(inst.factor); // size-normalize (no ground seat — it flies)
    inst.scene.rotation.y = inst.faceFix;
    npc.modelRoot = new THREE.Group();
    npc.modelRoot.add(inst.scene);
    npc.group.add(npc.modelRoot);
    npc.char = new CharacterModel(inst.scene, inst.clips);
    npc.char.setState('idle'); // clip[0] = wing flap
    npc._modelMats = [];
    npc.modelRoot.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m) npc._modelMats.push(m); } });
    npc._charState = 'idle';
    for (const me of npc._procMeshes) me.visible = false; // hide procedural bird
  }
  _applyNpcModel(npc, data) {
    if (!data || npc.char) return; // failed, or already applied
    const inst = this.modelLib.instance(npc.modelName, true); // clone materials → per-NPC hit flash
    if (!inst) return;
    inst.scene.scale.multiplyScalar(inst.factor); // normalize height (keeps native root scale)
    inst.scene.position.y = inst.groundOffset; // re-seat feet on the ground
    inst.scene.rotation.y = inst.faceFix; // face the walker's forward (-Z)
    npc.modelRoot = new THREE.Group();
    npc.modelRoot.add(inst.scene);
    npc.group.add(npc.modelRoot);
    npc.char = new CharacterModel(inst.scene, inst.clips);
    npc._modelMats = [];
    npc.modelRoot.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m) npc._modelMats.push(m);
      }
    });
    npc._charState = 'idle';
    for (const me of npc._procMeshes) me.visible = false; // hide procedural body
  }

  _buildShared() {
    this.geo = {
      torso: new THREE.BoxGeometry(0.46, 0.64, 0.28).translate(0, 1.04, 0),
      head: new THREE.IcosahedronGeometry(0.19, 1).translate(0, 1.52, 0),
      hat: new THREE.ConeGeometry(0.38, 0.22, 8).translate(0, 1.72, 0),
      leg: new THREE.BoxGeometry(0.16, 0.62, 0.16).translate(0, -0.31, 0),
      arm: new THREE.BoxGeometry(0.12, 0.5, 0.12).translate(0, -0.25, 0),
      foot: new THREE.BoxGeometry(0.18, 0.1, 0.24).translate(0, -0.64, 0.03),
      // flyer parts
      body: new THREE.IcosahedronGeometry(0.5, 1),
      fhead: new THREE.IcosahedronGeometry(0.22, 1),
      wing: new THREE.BoxGeometry(1.25, 0.06, 0.55),
      tail: new THREE.ConeGeometry(0.18, 0.7, 6).rotateX(Math.PI / 2),
    };
    this.mats = {
      kimono: [0x33485f, 0x7c3b32, 0x4f7b56, 0x6b4a2e, 0x5a5560, 0x2f4a6b].map(toon),
      bird: [0x2a2a30, 0x5a4636, 0x6b6b72, 0x3a2f4a].map(toon),
      skin: toon(0xe7c39c),
      hat: toon(0xcaa86a),
      dark: toon(0x2a221c),
      flash: new THREE.MeshToonMaterial({ color: 0xffffff, emissive: new THREE.Color(0xff3020), emissiveIntensity: 1.4, gradientMap: Assets.gradientMap }),
    };
    // shared health-bar materials
    this.barMat = {
      bg: new THREE.SpriteMaterial({ color: 0x10131a, transparent: true, depthWrite: false, depthTest: false }),
      hi: new THREE.SpriteMaterial({ color: 0x5fcf6a, transparent: true, depthWrite: false, depthTest: false }),
      lo: new THREE.SpriteMaterial({ color: 0xd8514a, transparent: true, depthWrite: false, depthTest: false }),
    };
  }

  _makeBar(headY) {
    const bg = new THREE.Sprite(this.barMat.bg);
    bg.center.set(0, 0.5);
    bg.scale.set(1.3, 0.16, 1);
    const fill = new THREE.Sprite(this.barMat.hi);
    fill.center.set(0, 0.5);
    fill.scale.set(1.3, 0.12, 1);
    bg.visible = fill.visible = false;
    bg.renderOrder = fill.renderOrder = 6;
    this.scene.add(bg, fill);
    return { bg, fill, headY };
  }

  _baseNPC(group, hitMesh, mode, maxHp, headY) {
    const npc = {
      mode, group, hitMesh,
      pos: new THREE.Vector3(),
      target: new THREE.Vector3(),
      facing: Math.random() * TAU,
      phase: Math.random() * 10,
      idle: Math.random() * 2,
      knock: new THREE.Vector3(),
      hp: maxHp, maxHp,
      alive: true, dying: false, deadTimer: 0,
      hitFlash: 0, stun: 0, burn: 0, burnDps: 0,
      barTimer: 0, accum: 0, accumT: 0, vy: 0,
      bar: this._makeBar(headY),
    };
    npc.baseMat = hitMesh.material;
    hitMesh.userData.npc = npc;
    this._hitMeshes.push(hitMesh);
    return npc;
  }

  _makeWalker(i) {
    const g = this.geo, m = this.mats;
    const group = new THREE.Group();
    const kimono = m.kimono[i % m.kimono.length];
    const proc = []; // procedural meshes (hidden if a glTF model loads)
    const mk = (geo, mat) => { const me = new THREE.Mesh(geo, mat); proc.push(me); return me; };
    const torso = mk(g.torso, kimono);
    torso.castShadow = true;
    group.add(torso, mk(g.head, m.skin), mk(g.hat, m.hat));

    const legL = new THREE.Group(); legL.position.set(-0.13, 0.72, 0);
    legL.add(mk(g.leg, kimono), mk(g.foot, m.dark));
    const legR = new THREE.Group(); legR.position.set(0.13, 0.72, 0);
    legR.add(mk(g.leg, kimono), mk(g.foot, m.dark));
    const armL = new THREE.Group(); armL.position.set(-0.31, 1.28, 0);
    armL.add(mk(g.arm, kimono));
    const armR = new THREE.Group(); armR.position.set(0.31, 1.28, 0);
    armR.add(mk(g.arm, kimono));
    group.add(legL, legR, armL, armR);
    this.scene.add(group);

    const npc = this._baseNPC(group, torso, 'walk', WALK_HP, 2.3);
    npc.legL = legL; npc.legR = legR; npc.armL = armL; npc.armR = armR;
    npc._procMeshes = proc;
    npc.modelName = this.walkerModels[i % this.walkerModels.length];
    npc.char = null; npc.modelRoot = null; npc._charState = 'idle';
    npc.ally = false; npc.permanentAlly = false; npc.allyCd = 0; // guardians fight enemies (setAllies)
    npc.summoned = false; npc.summonT = 0; npc.allyElement = null; // temporary summoned fighters (SummonPower)
    const s = this._randomWalkable() || { x: 6, z: 6 };
    npc.pos.set(s.x, groundHeightAt(s.x, s.z), s.z);
    this._pickTarget(npc);
    return npc;
  }

  _makeFlyer(i) {
    const g = this.geo, m = this.mats;
    const group = new THREE.Group();
    const col = m.bird[i % m.bird.length];
    const body = new THREE.Mesh(g.body, col);
    body.scale.set(0.9, 0.6, 1.4);
    body.castShadow = true;
    const head = new THREE.Mesh(g.fhead, col); head.position.set(0, 0.12, -0.7);
    const tail = new THREE.Mesh(g.tail, col); tail.position.set(0, 0.05, 0.7);
    const wingL = new THREE.Group(); wingL.position.set(-0.35, 0.1, 0);
    const wl = new THREE.Mesh(g.wing, col); wl.position.x = -0.6; wingL.add(wl);
    const wingR = new THREE.Group(); wingR.position.set(0.35, 0.1, 0);
    const wr = new THREE.Mesh(g.wing, col); wr.position.x = 0.6; wingR.add(wr);
    group.add(body, head, tail, wingL, wingR);
    this.scene.add(group);

    const npc = this._baseNPC(group, body, 'fly', FLY_HP, 1.1);
    npc.wingL = wingL; npc.wingR = wingR;
    npc._procMeshes = [body, head, tail, wl, wr]; // hidden when a real bird model loads
    npc.modelName = BIRD_MODELS[i % BIRD_MODELS.length];
    npc.char = null; npc.modelRoot = null; npc._charState = 'idle';
    npc.flyState = 'cruise'; npc.stateT = 2 + Math.random() * 3;
    const a = Math.random() * TAU, r = 20 + Math.random() * AIR_R;
    npc.pos.set(Math.cos(a) * r, 10 + Math.random() * 22, Math.sin(a) * r);
    this._pickAirTarget(npc);
    return npc;
  }

  _randomWalkable() {
    for (let t = 0; t < 8; t++) {
      const a = Math.random() * TAU, r = 8 + Math.random() * (TOWN_R - 8);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (surfaceAt(x, z) !== Surface.WATER && !blockedByStructure(x, z, 2)) return { x, z };
    }
    return null;
  }

  _pickTarget(npc) {
    const p = this._randomWalkable();
    if (p) npc.target.set(p.x, 0, p.z);
    else npc.target.copy(npc.pos);
  }

  _pickAirTarget(npc) {
    const a = Math.random() * TAU, r = 15 + Math.random() * AIR_R;
    const alt = npc.flyState === 'swoop' ? 3 + Math.random() * 4 : 12 + Math.random() * 24;
    npc.target.set(Math.cos(a) * r, alt, Math.sin(a) * r);
  }

  raycastTargets() {
    return this._hitMeshes;
  }

  // ---------------- combat API ----------------
  _forEachInRange(point, radius, fn) {
    const r2 = radius * radius;
    for (const npc of this.npcs) {
      if (!npc.alive || npc.ally) continue; // allies are friendly — your AoE never hits them
      const dx = npc.pos.x - point.x, dz = npc.pos.z - point.z, dy = npc.pos.y - point.y;
      const d2 = dx * dx + dz * dz + dy * dy * 0.5;
      if (d2 <= r2) fn(npc, Math.sqrt(d2));
    }
  }

  push(point, radius, dir, force) {
    this._forEachInRange(point, radius, (npc, d) => {
      const falloff = 1 - d / radius;
      if (dir) { npc.knock.x += dir.x * force * falloff; npc.knock.z += dir.z * force * falloff; }
      else {
        const ddx = npc.pos.x - point.x, ddz = npc.pos.z - point.z, dd = Math.hypot(ddx, ddz) || 0.001;
        npc.knock.x += (ddx / dd) * force * falloff;
        npc.knock.z += (ddz / dd) * force * falloff;
      }
    });
  }

  damageArea(point, radius, amount, type, knockDir, knockForce = 0, tick = false) {
    this._forEachInRange(point, radius, (npc, d) => {
      const falloff = 1 - 0.6 * (d / radius);
      this.damage(npc, amount * falloff, type, tick);
      if (knockForce) {
        if (knockDir) { npc.knock.x += knockDir.x * knockForce; npc.knock.z += knockDir.z * knockForce; }
        else {
          const ddx = npc.pos.x - point.x, ddz = npc.pos.z - point.z, dd = Math.hypot(ddx, ddz) || 0.001;
          npc.knock.x += (ddx / dd) * knockForce;
          npc.knock.z += (ddz / dd) * knockForce;
        }
      }
    });
  }

  applyBurn(point, radius, dps, duration) {
    this._forEachInRange(point, radius, (npc) => {
      npc.burn = Math.max(npc.burn, duration);
      npc.burnDps = Math.max(npc.burnDps, dps);
    });
  }

  stunArea(point, radius, duration) {
    this._forEachInRange(point, radius, (npc) => { npc.stun = Math.max(npc.stun, duration); });
  }

  // tickDamage: continuous DoT (accumulated into one floating number)
  damage(npc, amount, type, tick = false) {
    if (!npc.alive || amount <= 0) return;
    npc.hp -= amount;
    npc.hitFlash = Math.max(npc.hitFlash, 0.12);
    npc.barTimer = 2.8;
    if (tick) {
      npc.accum += amount;
    } else if (this.combatHUD) {
      this.combatHUD.spawn(this._headPos(npc, _hp), Math.round(amount), DMG_COLOR[type] || '#fff');
    }
    if (npc.hp <= 0) this._kill(npc, type);
  }

  _kill(npc, type) {
    npc.alive = false;
    npc.dying = true;
    npc.deadTimer = 1.7;
    npc.hp = 0;
    npc.burn = 0;
    npc.barTimer = 0;
    npc.hitFlash = 0;
    npc.hitMesh.material = npc.baseMat; // never ragdoll with the shared flash material
    npc.bar.bg.visible = npc.bar.fill.visible = false;
    if (this.combatHUD) this.combatHUD.spawn(this._headPos(npc, _hp), 'DOWN', '#ff5a3a', true);
    // remove from raycast targets so dead bodies aren't aimed at
    const idx = this._hitMeshes.indexOf(npc.hitMesh);
    if (idx >= 0) this._hitMeshes.splice(idx, 1);
  }

  _respawn(npc) {
    npc.alive = true; npc.dying = false; npc.deadTimer = 0;
    npc.hp = npc.maxHp; npc.knock.set(0, 0, 0); npc.vy = 0; npc.burn = 0; npc.burnDps = 0;
    // a summoned fighter that died ends its summon; permanent guardians stay allies
    npc.summoned = false; npc.summonT = 0; npc.allyElement = null;
    npc.ally = npc.permanentAlly === true;
    npc.group.rotation.set(0, 0, 0);
    npc.hitMesh.material = npc.baseMat;
    this._hitMeshes.push(npc.hitMesh);
    if (npc.mode === 'walk') {
      const s = this._randomWalkable() || { x: 6, z: 6 };
      npc.pos.set(s.x, groundHeightAt(s.x, s.z), s.z);
      this._pickTarget(npc);
    } else {
      const a = Math.random() * TAU, r = 30 + Math.random() * AIR_R;
      npc.pos.set(Math.cos(a) * r, 14 + Math.random() * 20, Math.sin(a) * r);
      this._pickAirTarget(npc);
    }
  }

  _headPos(npc, out) {
    return out.set(npc.pos.x, npc.pos.y + npc.bar.headY, npc.pos.z);
  }

  // ---------------- per-frame ----------------
  update(dt, playerPos, colliders) {
    for (const npc of this.npcs) {
      if (npc.dying) { this._updateDying(dt, npc); this._updateBar(npc, dt); continue; }
      // status: burn DoT
      if (npc.burn > 0) {
        npc.burn -= dt;
        this.damage(npc, npc.burnDps * dt, 'burn', true);
        if (this.particles && Math.random() < 0.5)
          this.particles.emit(npc.pos.x + (Math.random() - 0.5) * 0.5, npc.pos.y + 1 + Math.random(), npc.pos.z + (Math.random() - 0.5) * 0.5, 0, 1.5, 0, 0.5, Math.random() < 0.5 ? 0xff7a2a : 0xffb43a, -1);
        if (npc.burn <= 0) npc.burnDps = 0;
        if (!npc.alive) { this._updateBar(npc, dt); continue; }
      }
      // flush accumulated DoT into a single number
      npc.accumT -= dt;
      if (npc.accumT <= 0 && Math.round(npc.accum) >= 1) {
        if (this.combatHUD) this.combatHUD.spawn(this._headPos(npc, _hp), Math.round(npc.accum), DMG_COLOR.burn);
        npc.accum = 0; npc.accumT = 0.4;
      }
      if (npc.stun > 0) npc.stun -= dt;

      if (npc.mode === 'walk') this._updateWalk(dt, npc, colliders, playerPos);
      else this._updateFly(dt, npc);

      // hit flash material swap
      npc.hitMesh.material = npc.hitFlash > 0 ? this.mats.flash : npc.baseMat;
      if (npc.hitFlash > 0) npc.hitFlash -= dt;

      this._updateBar(npc, dt);
    }
  }

  _updateWalk(dt, npc, colliders, playerPos) {
    // temporary summoned fighters expire back into ordinary villagers
    if (npc.summoned) {
      npc.summonT -= dt;
      if (npc.summonT <= 0) { npc.summoned = false; npc.ally = npc.permanentAlly === true; npc.allyElement = null; this._pickTarget(npc); }
    }
    const knockSpeed = Math.hypot(npc.knock.x, npc.knock.z);
    let moveSpeed = 0;
    if (knockSpeed > 0.1) {
      npc.pos.x += npc.knock.x * dt; npc.pos.z += npc.knock.z * dt;
      const decay = Math.exp(-6 * dt);
      npc.knock.x *= decay; npc.knock.z *= decay;
      moveSpeed = knockSpeed;
    } else if (npc.stun > 0) {
      // stunned — stand still, jitter
    } else if (npc.ally) {
      moveSpeed = this._allyMove(dt, npc, playerPos); // engage enemies / regroup on you
    } else if (npc.idle > 0) {
      npc.idle -= dt;
    } else {
      const dx = npc.target.x - npc.pos.x, dz = npc.target.z - npc.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.0) { npc.idle = 0.8 + Math.random() * 2.5; this._pickTarget(npc); }
      else {
        const inv = 1 / dist;
        npc.pos.x += dx * inv * WALK * dt; npc.pos.z += dz * inv * WALK * dt;
        npc.facing = dampAngle(npc.facing, Math.atan2(-dx, -dz), 8, dt);
        moveSpeed = WALK;
      }
    }
    if (colliders) this._resolve(npc, colliders);
    npc.pos.y = groundHeightAt(npc.pos.x, npc.pos.z);

    npc.phase += dt * (moveSpeed > 0.2 ? 7 : 2);
    const swing = moveSpeed > 0.2 ? Math.sin(npc.phase) * 0.6 : Math.sin(npc.phase) * 0.04;
    npc.legL.rotation.x = swing; npc.legR.rotation.x = -swing;
    npc.armL.rotation.x = -swing * 0.8; npc.armR.rotation.x = swing * 0.8;
    npc.group.position.copy(npc.pos);
    npc.group.rotation.set(0, npc.facing, 0);

    // drive the glTF model's animation (if one loaded for this villager)
    if (npc.char) {
      const st = moveSpeed > 4 ? 'run' : moveSpeed > 0.2 ? 'walk' : 'idle';
      if (st !== npc._charState) { npc.char.setState(st); npc._charState = st; }
      npc.char.update(dt);
      // hit flash on the model (the procedural torso it swaps is hidden)
      const flash = npc.hitFlash > 0;
      for (const m of npc._modelMats) {
        if (!m.emissive) continue;
        if (flash) { m.emissive.setRGB(0.9, 0.9, 0.9); m.emissiveIntensity = 1; }
        else m.emissive.setRGB(0, 0, 0);
      }
    }

    if (npc.ally) this._allyFire(dt, npc); // guardians plink nearby enemies
  }

  _updateFly(dt, npc) {
    npc.stateT -= dt;
    if (npc.stateT <= 0) {
      const roll = Math.random();
      npc.flyState = roll < 0.4 ? 'circle' : roll < 0.7 ? 'swoop' : 'cruise';
      npc.stateT = 3 + Math.random() * 4;
      if (npc.flyState === 'circle') {
        // capture an orbit centre + radius around the current spot
        npc.circleCx = npc.pos.x; npc.circleCz = npc.pos.z; npc.circleY = npc.pos.y;
        npc.circleR = 16 + Math.random() * 14;
      } else {
        this._pickAirTarget(npc);
      }
    }
    if (npc.flyState === 'circle') {
      // genuine orbit: drive both x AND z from the angle around the centre
      const ang = npc.phase * 0.5;
      npc.target.set(npc.circleCx + Math.cos(ang) * npc.circleR, npc.circleY, npc.circleCz + Math.sin(ang) * npc.circleR);
    }
    const dx = npc.target.x - npc.pos.x, dy = npc.target.y - npc.pos.y, dz = npc.target.z - npc.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    const knockSpeed = Math.hypot(npc.knock.x, npc.knock.z);
    if (knockSpeed > 0.1) {
      npc.pos.x += npc.knock.x * dt; npc.pos.z += npc.knock.z * dt;
      const decay = Math.exp(-5 * dt); npc.knock.x *= decay; npc.knock.z *= decay;
    }
    if (dist < 3 && npc.flyState !== 'circle') this._pickAirTarget(npc);
    else if (npc.stun <= 0) {
      const inv = 1 / dist;
      npc.pos.x += dx * inv * FLY * dt;
      npc.pos.y += dy * inv * FLY * dt;
      npc.pos.z += dz * inv * FLY * dt;
      npc.facing = dampAngle(npc.facing, Math.atan2(-dx, -dz), 4, dt);
    }
    npc.pos.y = Math.max(npc.pos.y, groundHeightAt(npc.pos.x, npc.pos.z) + 4);

    npc.phase += dt * 8;
    const flap = Math.sin(npc.phase) * 0.7;
    npc.wingL.rotation.z = flap; npc.wingR.rotation.z = -flap;
    const bank = clamp(-(dx) * 0.02, -0.5, 0.5);
    npc.group.position.copy(npc.pos);
    // a real bird model uses BirdManager's yaw convention (facing + π); the
    // procedural bird keeps its own facing
    npc.group.rotation.set(0, npc.char ? npc.facing + Math.PI : npc.facing, bank);
    if (npc.char) {
      npc.char.update(dt); // drive the wing-flap clip
      const fl = npc.hitFlash > 0;
      for (const m of npc._modelMats) { if (!m.emissive) continue; if (fl) { m.emissive.setRGB(0.9, 0.9, 0.9); m.emissiveIntensity = 1; } else m.emissive.setRGB(0, 0, 0); }
    }
  }

  _updateDying(dt, npc) {
    npc.deadTimer -= dt;
    if (npc.mode === 'fly') {
      npc.vy -= 24 * dt;
      npc.pos.y += npc.vy * dt;
      const gy = groundHeightAt(npc.pos.x, npc.pos.z);
      if (npc.pos.y <= gy) npc.pos.y = gy;
    }
    // tip over + sink
    npc.group.rotation.z = lerp(npc.group.rotation.z, 1.5, 1 - Math.exp(-8 * dt));
    if (npc.deadTimer < 0.8) npc.pos.y -= dt * 1.2; // sink into the ground
    npc.group.position.copy(npc.pos);
    if (npc.deadTimer <= 0) this._respawn(npc);
  }

  _updateBar(npc, dt) {
    const bar = npc.bar;
    const show = npc.alive && npc.barTimer > 0 && npc.hp < npc.maxHp;
    bar.bg.visible = bar.fill.visible = show;
    if (!show) { if (npc.barTimer > 0) npc.barTimer -= dt; return; }
    npc.barTimer -= dt;
    const frac = clamp(npc.hp / npc.maxHp, 0, 1);
    const hx = npc.pos.x - 0.65, hy = npc.pos.y + bar.headY, hz = npc.pos.z;
    bar.bg.position.set(hx, hy, hz);
    bar.fill.position.set(hx, hy, hz);
    bar.fill.scale.set(1.3 * frac, 0.12, 1);
    bar.fill.material = frac < 0.35 ? this.barMat.lo : this.barMat.hi;
  }

  _resolve(npc, colliders) {
    for (const c of colliders) {
      if (c.type === 'box') {
        const nx = clamp(npc.pos.x, c.minX, c.maxX);
        const nz = clamp(npc.pos.z, c.minZ, c.maxZ);
        const dx = npc.pos.x - nx, dz = npc.pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 < NPC_R * NPC_R) {
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2), push = NPC_R - d;
            npc.pos.x += (dx / d) * push; npc.pos.z += (dz / d) * push;
          } else {
            const dl = npc.pos.x - c.minX, dr = c.maxX - npc.pos.x, db = npc.pos.z - c.minZ, df = c.maxZ - npc.pos.z;
            const mn = Math.min(dl, dr, db, df);
            if (mn === dl) npc.pos.x = c.minX - NPC_R;
            else if (mn === dr) npc.pos.x = c.maxX + NPC_R;
            else if (mn === db) npc.pos.z = c.minZ - NPC_R;
            else npc.pos.z = c.maxZ + NPC_R;
          }
        }
      } else if (c.type === 'circle') {
        const dx = npc.pos.x - c.x, dz = npc.pos.z - c.z, rr = NPC_R + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.001, push = rr - d;
          npc.pos.x += (dx / d) * push; npc.pos.z += (dz / d) * push;
        }
      }
    }
  }

  dispose() {
    for (const npc of this.npcs) {
      if (npc.char) npc.char.dispose();
      for (const m of npc._modelMats || []) m.dispose && m.dispose(); // cloned model materials
      this.scene.remove(npc.group, npc.bar.bg, npc.bar.fill);
    }
    for (const k of Object.keys(this.geo)) this.geo[k].dispose();
    this.mats.kimono.forEach((m) => m.dispose());
    this.mats.bird.forEach((m) => m.dispose());
    this.mats.skin.dispose(); this.mats.hat.dispose(); this.mats.dark.dispose(); this.mats.flash.dispose();
    this.barMat.bg.dispose(); this.barMat.hi.dispose(); this.barMat.lo.dispose();
    this.npcs.length = 0;
    this._hitMeshes.length = 0;
  }
}

const _hp = new THREE.Vector3();
