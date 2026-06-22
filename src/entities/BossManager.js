import * as THREE from 'three';
import { Assets } from '../world/Assets.js';
import { groundHeightAt } from '../world/WorldConfig.js';
import { regionByKey, ARENA_RADIUS } from '../world/Regions.js';
import { dampAngle, clamp, lerp } from '../utils/math.js';
import { CharacterModel } from '../characters/CharacterModel.js';

// =====================================================================
//  BossManager — one powerful, region-specific boss with multiple attack
//  phases, a screen-wide boss health bar, and UTILITY-AI ("game theory")
//  decision-making: every decision tick the boss scores its options
//  (slam / ranged volley / summon reinforcements / reposition-dodge / enrage)
//  by a risk-reward utility computed from distance, its own HP, the player's
//  HP and how many adds are alive, then commits to the highest-scoring move.
//
//  Behaviour escalates across 3 phases (100–66% / 66–33% / <33% enrage).
//  The boss takes typed damage from powers (same combat interface as the NPC
//  & enemy managers) and grants an XP reward + completes its mission on death.
// =====================================================================

const PHASE_2 = 0.66;
const PHASE_3 = 0.33;
const DECIDE_EVERY = 1.3;
const _v = new THREE.Vector3();

export class BossManager {
  constructor(scene) {
    this.scene = scene;
    this.combatHUD = null;
    this.particles = null;
    this.lights = null;
    this.enemies = null; // EnemyManager (for summons)
    this.onBossKilled = null; // (regionKey, xp) → MissionManager
    this.active = false;
    this.boss = null;
    this._cool = 0; // brief re-spawn lock after a despawn (don't pop back instantly)

    // optional real glTF boss model (graceful fallback to the procedural body)
    this.modelLib = null;
    this.modelName = 'md2warrior'; // MD2 boss (webgl_loader_md2) scaled up + tinted; falls back to procedural
    this.charModel = null;
    this.modelRoot = null;
    this._modelActive = false;
    this._charState = 'idle';
    this._modelMats = null; // cloned materials (for tint + hit flash + disposal)
    this._tintColor = null;

    this._build();
    this._buildBar();
    this._procMeshes = [];
    this.group.traverse((o) => { if (o.isMesh) this._procMeshes.push(o); });
  }

  setHooks({ combatHUD, particles, lights, enemies, onBossKilled } = {}) {
    this.combatHUD = combatHUD || this.combatHUD;
    this.particles = particles || this.particles;
    this.lights = lights || this.lights;
    this.enemies = enemies || this.enemies;
    this.onBossKilled = onBossKilled || this.onBossKilled;
  }

  _build() {
    // one shared menacing body, recoloured per region on spawn
    const g = {
      torso: new THREE.BoxGeometry(1.6, 2.0, 1.1).translate(0, 2.4, 0),
      hips: new THREE.BoxGeometry(1.7, 0.9, 1.2).translate(0, 1.2, 0),
      head: new THREE.IcosahedronGeometry(0.55, 1).translate(0, 3.7, 0),
      horn: new THREE.ConeGeometry(0.18, 0.9, 5),
      shoulder: new THREE.IcosahedronGeometry(0.55, 1),
      arm: new THREE.BoxGeometry(0.5, 1.7, 0.5).translate(0, -0.85, 0),
      fist: new THREE.IcosahedronGeometry(0.5, 1),
      leg: new THREE.BoxGeometry(0.6, 1.5, 0.6).translate(0, -0.75, 0),
      spike: new THREE.ConeGeometry(0.22, 1.0, 5),
      eye: new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(0, 3.7, -0.5),
    };
    this.geo = g;
    this.mat = {
      body: new THREE.MeshToonMaterial({ color: 0x8a2f24, gradientMap: Assets.gradientMap }),
      dark: new THREE.MeshToonMaterial({ color: 0x201a18, gradientMap: Assets.gradientMap }),
      eye: new THREE.MeshToonMaterial({ color: 0xffd24a, emissive: new THREE.Color(0xffae20), emissiveIntensity: 1.6, gradientMap: Assets.gradientMap }),
      flash: new THREE.MeshToonMaterial({ color: 0xffffff, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.2, gradientMap: Assets.gradientMap }),
    };

    const grp = new THREE.Group();
    const body = new THREE.Mesh(g.torso, this.mat.body); body.castShadow = true;
    grp.add(body, new THREE.Mesh(g.hips, this.mat.body), new THREE.Mesh(g.head, this.mat.body), new THREE.Mesh(g.eye, this.mat.eye));
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(g.horn, this.mat.dark); horn.position.set(sx * 0.32, 4.2, 0); horn.rotation.z = sx * 0.4; grp.add(horn);
      const sh = new THREE.Mesh(g.shoulder, this.mat.dark); sh.position.set(sx * 1.0, 3.1, 0); sh.scale.set(1.1, 0.9, 1.1); grp.add(sh);
    }
    // back spikes
    for (const dz of [-0.2, 0.3, 0.8]) { const sp = new THREE.Mesh(g.spike, this.mat.dark); sp.position.set(0, 3.0, 0.6 + dz); sp.rotation.x = 2.4; grp.add(sp); }
    const armL = new THREE.Group(); armL.position.set(-1.05, 3.2, 0); armL.add(new THREE.Mesh(g.arm, this.mat.body)); { const f = new THREE.Mesh(g.fist, this.mat.dark); f.position.y = -1.7; armL.add(f); }
    const armR = new THREE.Group(); armR.position.set(1.05, 3.2, 0); armR.add(new THREE.Mesh(g.arm, this.mat.body)); { const f = new THREE.Mesh(g.fist, this.mat.dark); f.position.y = -1.7; armR.add(f); }
    const legL = new THREE.Group(); legL.position.set(-0.45, 1.0, 0); legL.add(new THREE.Mesh(g.leg, this.mat.body));
    const legR = new THREE.Group(); legR.position.set(0.45, 1.0, 0); legR.add(new THREE.Mesh(g.leg, this.mat.body));
    grp.add(armL, armR, legL, legR);
    grp.visible = false;
    this.scene.add(grp);

    this.group = grp;
    this.hitMesh = body;
    this.parts = { armL, armR, legL, legR };

    // ranged-volley projectiles (pooled)
    this.projGeo = new THREE.IcosahedronGeometry(0.55, 1);
    this.projMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending });
    this.projectiles = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.projGeo, this.projMat); m.visible = false; m.frustumCulled = false;
      this.scene.add(m);
      this.projectiles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, active: false });
    }
  }

  _buildBar() {
    injectBossStyles();
    const el = document.createElement('div');
    el.className = 'ym-bossbar';
    el.innerHTML = `<div class="ym-bossname"></div><div class="ym-bosshpwrap"><div class="ym-bosshp"></div></div><div class="ym-bossphase"></div>`;
    document.body.appendChild(el);
    this.barEl = el;
    this.nameEl = el.querySelector('.ym-bossname');
    this.hpEl = el.querySelector('.ym-bosshp');
    this.phaseEl = el.querySelector('.ym-bossphase');
    el.style.display = 'none';
  }

  isActiveFor(regionKey) {
    return this.active && this.boss && this.boss.regionKey === regionKey;
  }

  // Adopt a real hide/armour bump on the boss materials (graceful).
  applyDetail(t) {
    const set = (m) => { m.bumpMap = t; m.bumpScale = 0.03; m.needsUpdate = true; };
    set(this.mat.body); set(this.mat.dark);
  }

  // Adopt a real, large, textured glTF model for the boss (graceful fallback to
  // the procedural body). Materials are cloned so the menacing tint is unique.
  setModelLibrary(lib) {
    this.modelLib = lib;
    lib.onReady(this.modelName, (data) => this._applyBossModel(data));
  }
  _applyBossModel(data) {
    if (!data || this._modelActive) return;
    const inst = this.modelLib.instance(this.modelName, true); // clone materials → safe to tint
    if (!inst) return;
    inst.scene.scale.multiplyScalar(inst.factor); // normalize to the base human height first
    inst.scene.position.y = inst.groundOffset; // seat feet at the model-root origin
    inst.scene.rotation.y = inst.faceFix;
    this.modelRoot = new THREE.Group();
    this.modelRoot.add(inst.scene);
    this.group.add(this.modelRoot);
    this.charModel = new CharacterModel(inst.scene, inst.clips);
    this._modelMats = [];
    this.modelRoot.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) if (m) this._modelMats.push(m);
      }
    });
    for (const me of this._procMeshes) me.visible = false;
    this._modelActive = true;
    if (this.active && this.boss) { // model arrived mid-fight → rescale + tint now
      const def = regionByKey(this.boss.regionKey).boss;
      this._applyScale(def);
      this._tintModel(def.color);
    }
  }
  _applyScale(def) {
    if (this._modelActive) {
      this.group.scale.setScalar(1); // the model is scaled directly, not the group
      // model is normalized to ~1.8 (human); scale it up to the boss size, feet stay grounded
      if (this.modelRoot) this.modelRoot.scale.setScalar((def.scale * 1.6) / 1.8);
    } else {
      this.group.scale.setScalar(def.scale / 2.6);
    }
  }
  _tintModel(color) {
    if (!this.modelRoot) return;
    this._tintColor = new THREE.Color(color).multiplyScalar(0.35);
    for (const m of this._modelMats || []) if (m.emissive) { m.emissive.copy(this._tintColor); m.emissiveIntensity = 1; m.needsUpdate = true; }
  }

  // Spawn the region's boss at its arena. Returns false if one is already up
  // (or still under the brief re-spawn lock after a despawn).
  spawn(regionKey) {
    if (this.active || this._cool > 0) return false;
    const region = regionByKey(regionKey);
    if (!region) return false;
    const def = region.boss;
    const ax = region.arena.x, az = region.arena.z;
    this.mat.body.color.set(def.color); // procedural fallback tint
    this._applyScale(def);
    if (this._modelActive) this._tintModel(def.color);
    this.group.position.set(ax, groundHeightAt(ax, az), az);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;

    this.boss = {
      regionKey, name: def.name, native: def.native, xp: def.xp,
      pos: new THREE.Vector3(ax, groundHeightAt(ax, az), az),
      facing: 0, hp: def.hp, maxHp: def.hp, phase: 1,
      hitFlash: 0, stun: 0, burn: 0, burnDps: 0,
      decideT: 0.6, action: 'idle', actionT: 0, telegraph: 0,
      summonCd: 6, rangedCd: 2, slamCd: 1.5, dodgeDir: 1,
      anim: 0,
    };
    this.active = true;
    this.barEl.style.display = 'block';
    this.nameEl.textContent = `${def.name}  ·  ${def.native}`;
    this._updateBarDom();
    return true;
  }

  // ------------- combat interface (driven by PowerManager) -------------
  raycastTargets() {
    return this.active ? [this.hitMesh] : [];
  }

  _inRange(point, radius) {
    if (!this.active) return false;
    const b = this.boss.pos;
    const dx = b.x - point.x, dz = b.z - point.z, dy = (b.y + 2.2) - point.y;
    return dx * dx + dz * dz + dy * dy * 0.5 <= radius * radius;
  }

  damageArea(point, radius, amount, type, knockDir, knockForce = 0, tick = false) {
    if (this._inRange(point, radius)) this.damage(amount, type, tick);
    // bosses are heavy: only a tiny positional nudge from knockback
  }
  applyBurn(point, radius, dps, duration) {
    if (this._inRange(point, radius)) { this.boss.burn = Math.max(this.boss.burn, duration); this.boss.burnDps = Math.max(this.boss.burnDps, dps); }
  }
  stunArea(point, radius, duration) {
    if (this._inRange(point, radius)) this.boss.stun = Math.max(this.boss.stun, duration * 0.35); // resistant
  }
  push() {}

  damage(amount, type, tick = false) {
    if (!this.active || amount <= 0) return;
    const b = this.boss;
    b.hp -= amount;
    b.hitFlash = Math.max(b.hitFlash, 0.1);
    if (!tick && this.combatHUD) this.combatHUD.spawn(_v.set(b.pos.x, b.pos.y + 4.2, b.pos.z), Math.round(amount), DMG_COLOR[type] || '#fff', true);
    this._updateBarDom();
    if (b.hp <= 0) this._defeat();
    else this._maybePhase();
  }

  _maybePhase() {
    const b = this.boss, f = b.hp / b.maxHp;
    const want = f <= PHASE_3 ? 3 : f <= PHASE_2 ? 2 : 1;
    if (want > b.phase) {
      b.phase = want;
      b.stun = 0;
      if (this.lights) this.lights.flash(b.pos.x, b.pos.y + 2.5, b.pos.z, 0xffae20, 30, 26, 0.5);
      if (this.particles) this.particles.burst({ x: b.pos.x, y: b.pos.y + 2.5, z: b.pos.z }, 40, { speed: 10, spread: 1, life: 0.9, color: 0xffd24a, gravity: 3 });
      this._updateBarDom();
    }
  }

  _defeat() {
    const b = this.boss;
    if (this.particles) {
      this.particles.burst({ x: b.pos.x, y: b.pos.y + 2.2, z: b.pos.z }, 80, { speed: 13, spread: 1, life: 1.3, color: 0xffd24a, gravity: 2 });
      this.particles.burst({ x: b.pos.x, y: b.pos.y + 2.2, z: b.pos.z }, 40, { speed: 7, spread: 1, life: 1.6, color: 0xff5a1e, gravity: 1 });
    }
    if (this.lights) this.lights.flash(b.pos.x, b.pos.y + 2.5, b.pos.z, 0xffd24a, 40, 40, 0.8);
    if (this.combatHUD) this.combatHUD.spawn(_v.set(b.pos.x, b.pos.y + 4.5, b.pos.z), 'DEFEATED', '#ffd24a', true);
    if (this.onBossKilled) this.onBossKilled(b.regionKey, b.xp);
    this.active = false;
    this.group.visible = false;
    this.barEl.style.display = 'none';
    this.boss = null;
    // stop any volley fired just before the killing blow (don't hit the player
    // after "DEFEATED")
    for (const p of this.projectiles) { p.active = false; p.mesh.visible = false; }
  }

  // ------------- per-frame -------------
  update(dt, player) {
    // animate projectiles regardless (so they finish flying as the boss dies)
    this._updateProjectiles(dt, player);
    if (this._cool > 0) this._cool -= dt;
    if (!this.active) return;
    const b = this.boss;

    if (b.burn > 0) { b.burn -= dt; this.damage(b.burnDps * dt, 'burn', true); if (!this.active) return; }
    if (b.stun > 0) b.stun -= dt;
    if (b.hitFlash > 0) b.hitFlash -= dt;
    if (b.summonCd > 0) b.summonCd -= dt;
    if (b.rangedCd > 0) b.rangedCd -= dt;
    if (b.slamCd > 0) b.slamCd -= dt;

    this.hitMesh.material = b.hitFlash > 0 ? this.mat.flash : this.mat.body; // procedural fallback
    // glTF boss: flash the model's (cloned) materials emissive white on a hit
    if (this._modelActive && this._modelMats) {
      const flash = b.hitFlash > 0;
      for (const m of this._modelMats) {
        if (!m.emissive) continue;
        if (flash) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 1.6; }
        else if (this._tintColor) { m.emissive.copy(this._tintColor); m.emissiveIntensity = 1; }
      }
    }

    const pp = player.pos;
    const dx = pp.x - b.pos.x, dz = pp.z - b.pos.z;
    const dist = Math.hypot(dx, dz);

    if (b.stun <= 0) {
      // pick a new high-level action periodically (utility AI)
      b.decideT -= dt;
      if (b.decideT <= 0 && b.action === 'idle') { this._decide(player, dist); b.decideT = DECIDE_EVERY; }
      this._act(dt, player, dist, dx, dz);
    }

    b.pos.y = groundHeightAt(b.pos.x, b.pos.z);
    this.group.position.copy(b.pos);
    this.group.rotation.y = b.facing;

    // idle/locomotion animation (procedural fallback)
    b.anim += dt * (b.action === 'charge' ? 5 : 2);
    const sw = Math.sin(b.anim) * (b.action === 'charge' ? 0.5 : 0.12);
    this.parts.legL.rotation.x = sw; this.parts.legR.rotation.x = -sw;

    // drive the glTF model's animation from the boss's action (if a model loaded)
    if (this.charModel) {
      const st = b.action === 'charge' ? 'run' : b.action === 'dodge' ? 'walk' : 'idle';
      if (st !== this._charState) { this.charModel.setState(st); this._charState = st; }
      this.charModel.update(dt);
    }
  }

  // Score each option by risk/reward and commit to the best.
  _decide(player, dist) {
    const b = this.boss;
    const hpf = b.hp / b.maxHp;
    const php = player.maxHp ? player.hp / player.maxHp : 1;
    const adds = this.enemies ? this.enemies.countAlive() : 0;
    const aggro = b.phase === 3 ? 1.4 : b.phase === 2 ? 1.15 : 1.0;

    const u = {};
    // slam: great up close; more tempting when the player is healthy (press advantage)
    u.slam = (dist < 7 ? 1.2 : 0.05) + 0.3 * php;
    u.slam *= b.slamCd <= 0 ? aggro : 0.1;
    // charge: close the gap
    u.charge = (dist > 7 ? 0.6 + 0.35 * clamp(dist / 40, 0, 1) : 0.1) * aggro;
    // ranged volley: punish from range
    u.ranged = (dist > 6 ? 0.7 + 0.25 * (1 - hpf) : 0.1) * (b.rangedCd <= 0 ? aggro : 0.05);
    // summon reinforcements: call help when hurt, the player's at range, few adds
    u.summon = (adds < 3 && dist > 10 ? 0.4 + 0.7 * (1 - hpf) : 0.0) * (b.summonCd <= 0 ? 1 : 0);
    // dodge / reposition: retreat when low HP (risk-averse) — the flee instinct
    u.dodge = (0.2 + 0.7 * (1 - hpf)) * (php > 0.4 ? 1 : 0.5);

    // softmax-ish: pick the best, with small random perturbation
    let best = 'charge', bestU = -1;
    for (const k of Object.keys(u)) {
      const val = u[k] + Math.random() * 0.18;
      if (val > bestU) { bestU = val; best = k; }
    }
    this._begin(best, player, dist);
  }

  _begin(action, player, dist) {
    const b = this.boss;
    b.action = action;
    b.actionT = 0;
    if (action === 'slam') { b.telegraph = 0.55; b.slamCd = 2.2; }
    else if (action === 'ranged') { b.telegraph = 0.4; b.rangedCd = 3.0 - b.phase * 0.4; b._volley = b.phase + 1; }
    else if (action === 'summon') {
      b.summonCd = 12;
      if (this.enemies) this.enemies.summon(b.pos.x, b.pos.z, b.phase + 1);
      if (this.particles) this.particles.burst({ x: b.pos.x, y: b.pos.y + 2, z: b.pos.z }, 30, { speed: 8, spread: 1, life: 0.8, color: 0x9a3bd8, gravity: 1 });
      b.action = 'idle';
    } else if (action === 'dodge') {
      b.dodgeDir = Math.random() < 0.5 ? -1 : 1;
      b.actionT = 0.9;
    }
  }

  _act(dt, player, dist, dx, dz) {
    const b = this.boss;
    const face = (tx, tz) => { if (Math.hypot(tx, tz) > 0.05) b.facing = dampAngle(b.facing, Math.atan2(-tx, -tz), 6, dt); };
    const moveSpeed = (b.phase === 3 ? 5.5 : 4.0);

    switch (b.action) {
      case 'charge': {
        face(dx, dz);
        if (dist > 5.5) {
          const inv = moveSpeed * dt / (dist || 1);
          b.pos.x += dx * inv; b.pos.z += dz * inv;
        } else { b.action = 'idle'; b.decideT = 0; } // already in range → re-decide now, don't idle 1.3s
        b.actionT += dt;
        if (b.actionT > 2.2) b.action = 'idle';
        break;
      }
      case 'slam': {
        face(dx, dz);
        b.telegraph -= dt;
        // raise arms during telegraph
        const t = clamp(1 - b.telegraph / 0.55, 0, 1);
        this.parts.armL.rotation.x = lerp(0, -2.4, t);
        this.parts.armR.rotation.x = lerp(0, -2.4, t);
        if (b.telegraph <= 0) {
          // strike: AoE shockwave at the boss's front
          this.parts.armL.rotation.x = 0.6; this.parts.armR.rotation.x = 0.6;
          const fx = b.pos.x - Math.sin(b.facing) * 3, fz = b.pos.z - Math.cos(b.facing) * 3;
          this._aoe(fx, fz, b.phase === 3 ? 7 : 5, 18 + b.phase * 6, player);
          b.action = 'idle';
        }
        break;
      }
      case 'ranged': {
        face(dx, dz);
        b.telegraph -= dt;
        if (b.telegraph <= 0) {
          this._fireProjectile(player);
          b._volley--;
          if (b._volley > 0) b.telegraph = 0.25;
          else b.action = 'idle';
        }
        break;
      }
      case 'dodge': {
        // strafe perpendicular to the player (reposition)
        const px = -dz, pz = dx; const pl = Math.hypot(px, pz) || 1;
        b.pos.x += (px / pl) * b.dodgeDir * 5 * dt;
        b.pos.z += (pz / pl) * b.dodgeDir * 5 * dt;
        face(dx, dz);
        b.actionT -= dt;
        if (b.actionT <= 0) b.action = 'idle';
        break;
      }
      default: {
        // idle: ease arms back, slowly face the player
        this.parts.armL.rotation.x = lerp(this.parts.armL.rotation.x, 0, 0.1);
        this.parts.armR.rotation.x = lerp(this.parts.armR.rotation.x, 0, 0.1);
        face(dx, dz);
      }
    }
  }

  _aoe(x, z, r, dmg, player) {
    if (this.lights) this.lights.flash(x, groundHeightAt(x, z) + 0.5, z, 0xffae20, 18, r * 2.5, 0.35);
    if (this.particles) {
      const y = groundHeightAt(x, z) + 0.2;
      this.particles.burst({ x, y, z }, 30, { speed: 9, spread: 1, life: 0.7, color: 0xffae20, gravity: 6 });
    }
    const pp = player.pos;
    if (Math.hypot(pp.x - x, pp.z - z) <= r + 0.8 && player.hurt) player.hurt(dmg, { x, z });
  }

  _fireProjectile(player) {
    const p = this.projectiles.find((q) => !q.active);
    if (!p) return;
    const b = this.boss;
    const from = _v.set(b.pos.x, b.pos.y + 3.0, b.pos.z);
    p.mesh.position.copy(from);
    const tx = player.pos.x - from.x, ty = (player.pos.y + 1) - from.y, tz = player.pos.z - from.z;
    const d = Math.hypot(tx, ty, tz) || 1;
    const spd = 26;
    p.vel.set((tx / d) * spd, (ty / d) * spd, (tz / d) * spd);
    p.life = 2.2; p.active = true; p.mesh.visible = true;
    p.dmg = 10 + this.boss.phase * 4;
  }

  _updateProjectiles(dt, player) {
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.life -= dt;
      if (this.particles) this.particles.emit(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0, 0, 0, 0.3, 0xff9a2a, -1);
      const pp = player.pos;
      const hit = Math.hypot(pp.x - p.mesh.position.x, pp.y + 1 - p.mesh.position.y, pp.z - p.mesh.position.z) < 1.6;
      const ground = p.mesh.position.y <= groundHeightAt(p.mesh.position.x, p.mesh.position.z) + 0.2;
      if (hit && player.hurt) player.hurt(p.dmg, p.mesh.position);
      if (hit || ground || p.life <= 0) {
        if (this.particles) this.particles.burst({ x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z }, 12, { speed: 6, spread: 1, life: 0.5, color: 0xff7a2a, gravity: 3 });
        p.active = false; p.mesh.visible = false;
      }
    }
  }

  _updateBarDom() {
    if (!this.boss) return;
    const f = clamp(this.boss.hp / this.boss.maxHp, 0, 1);
    this.hpEl.style.width = (f * 100).toFixed(1) + '%';
    this.phaseEl.textContent = '◆'.repeat(this.boss.phase) + '◇'.repeat(3 - this.boss.phase);
  }

  // Despawn without reward (e.g. entering a building / fast travel).
  despawn() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
    this.barEl.style.display = 'none';
    this.boss = null;
    this._cool = 2; // brief lock so it doesn't immediately re-spawn at full HP
    for (const p of this.projectiles) { p.active = false; p.mesh.visible = false; }
  }

  dispose() {
    this.despawn();
    if (this.charModel) this.charModel.dispose();
    for (const m of this._modelMats || []) m.dispose && m.dispose(); // cloned model materials
    this.scene.remove(this.group);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const k of Object.keys(this.geo)) this.geo[k].dispose();
    for (const k of Object.keys(this.mat)) this.mat[k].dispose();
    this.projGeo.dispose(); this.projMat.dispose();
    if (this.barEl && this.barEl.parentNode) this.barEl.parentNode.removeChild(this.barEl);
  }
}

const DMG_COLOR = { fire: '#ff8a3a', burn: '#ff7a2a', earth: '#e0c070', water: '#8fd0ff', lightning: '#cdeaff', fry: '#ff5a3a', hit: '#ffffff' };

let _bossStyles = false;
function injectBossStyles() {
  if (_bossStyles) return;
  _bossStyles = true;
  const css = `
  .ym-bossbar { position:fixed; top:18px; left:50%; transform:translateX(-50%); width:min(620px,70vw);
    z-index:14; text-align:center; pointer-events:none;
    font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  .ym-bossname { font-size:18px; font-weight:700; letter-spacing:2px; text-shadow:0 2px 8px #000c; margin-bottom:4px; }
  .ym-bosshpwrap { height:16px; background:#0008; border:1px solid #ffffff33; border-radius:9px; overflow:hidden; }
  .ym-bosshp { height:100%; width:100%; background:linear-gradient(90deg,#d8514a,#ff7a3a,#ffd24a);
    transition:width .18s ease; }
  .ym-bossphase { margin-top:4px; font-size:13px; color:#ffd24a; letter-spacing:4px; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
