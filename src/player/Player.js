import * as THREE from 'three';
import { Assets } from '../world/Assets.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from '../utils/math.js';
import { groundHeightAt, HALF_GRID, CHUNK_SIZE } from '../world/WorldConfig.js';
import { Stamina } from '../abilities/Stamina.js';
import { Shield } from '../abilities/Shield.js';
import { Dash } from '../abilities/Dash.js';
import { Sword } from '../combat/Sword.js';
import { CharacterModel } from '../characters/CharacterModel.js';

const WALK_SPEED = 3.4;
const RUN_SPEED = 7.0;
const SPRINT_DRAIN = 16; // stamina/sec while sprinting (Shift)
const GRAVITY = 22;
const JUMP_V = 8.0;
const RADIUS = 0.45;
const WORLD_BOUND = HALF_GRID * CHUNK_SIZE - 4;

// Flight (Superman-style)
const FLY_SPEED = 16;
const FLY_BOOST = 2.6;
const FLY_VERT = 9;
const FLY_ACCEL = 3.5; // damping lambda toward target velocity (smooth accel)

function mat(color, emissive = 0) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: Assets.gradientMap,
    emissive: new THREE.Color(emissive),
  });
}

// Third-person controllable character: capsule physics + a procedural,
// animated low-poly humanoid. Two movement modes — grounded (idle ↔ walk ↔
// run ↔ jump, gravity + ground-snapping) and flight (free 6-DOF, no gravity,
// banking into turns, boost).
export class Player {
  constructor() {
    this.pos = new THREE.Vector3(0, 0, 5);
    this.vel = new THREE.Vector3(); // horizontal velocity (x,z) on the ground
    this.velY = 0;
    this.facing = Math.PI;
    this.grounded = true;
    this.radius = RADIUS;
    this.animState = 'idle';

    this.flying = false;
    this.flightVel = new THREE.Vector3();
    this._roll = 0;
    this._tilt = 0;
    this.flightSpeed01 = 0; // 0..1 how fast we're going (for camera)

    // --- health / combat ---
    this.maxHp = 100;
    this.hp = 100;
    this.alive = true;
    this._invuln = 0; // brief i-frames after a hit
    this._noHitT = 99; // seconds since last hit (drives out-of-combat regen)
    this._invisT = 0; // Invisibility-Cloak spell timer (enemies can't see you)
    this.onHurt = null; // (amount) → HUD red flash
    this.onDeath = null; // () → Game respawn sequence
    this.onParry = null; // () → parry VFX/sfx

    this.groundFn = groundHeightAt; // overridden when indoors
    this.bounded = true;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._wish = new THREE.Vector3();

    this.anim = { phase: 0, leg: 0, arm: 0, bob: 0 };
    this._procMeshes = []; // procedural body meshes (hidden when a glTF model loads)
    this._buildMesh();

    // --- abilities & weapon (own their own meshes/state) ---
    this.stamina = new Stamina();
    this.shield = new Shield(this.mesh);
    this.dash = new Dash();
    this.sword = new Sword(this.mesh, this.armR);
    this.combatMode = false; // sword drawn → left-click swings (Game routes input)

    // --- mounts (MountSystem toggles these) ---
    this.mounted = false;
    this.mountSpeedMul = 1;

    // --- real glTF avatar (optional; graceful fallback to the procedural body) ---
    this.modelLib = null;
    this.avatarModes = ['soldier', 'xbot', 'robot']; // cycle with T (see ModelLibrary)
    this.avatarIndex = 0;
    this.charModel = null; // CharacterModel (animation) when a model is active
    this.modelRoot = null; // Group holding the glTF instance (child of mesh)
    this._charState = 'idle';
  }

  _buildMesh() {
    this.mesh = new THREE.Group();
    this.mesh.rotation.order = 'YXZ'; // yaw, then pitch, then roll (for banking)
    const m = {
      kimono: mat(0x33485f),
      trim: mat(0xb23b3b),
      skin: mat(0xe7c39c),
      hair: mat(0x241c17),
      hat: mat(0xcaa86a),
      foot: mat(0x2a2a2a),
    };
    this._materials = m;

    const add = (geo, material, parent = this.mesh) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      parent.add(mesh);
      this._procMeshes.push(mesh); // tracked so a glTF model can hide the body
      return mesh;
    };

    add(new THREE.BoxGeometry(0.55, 0.72, 0.32).translate(0, 1.06, 0), m.kimono);
    add(new THREE.BoxGeometry(0.57, 0.16, 0.34).translate(0, 0.78, 0), m.trim);
    add(new THREE.IcosahedronGeometry(0.22, 1).translate(0, 1.58, 0), m.skin);
    add(new THREE.SphereGeometry(0.235, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6).translate(0, 1.6, 0), m.hair);
    add(new THREE.ConeGeometry(0.42, 0.26, 10).translate(0, 1.78, 0), m.hat);

    this.armL = new THREE.Group();
    this.armL.position.set(-0.36, 1.34, 0);
    add(new THREE.BoxGeometry(0.14, 0.6, 0.14).translate(0, -0.3, 0), m.kimono, this.armL);
    this.mesh.add(this.armL);
    this.armR = new THREE.Group();
    this.armR.position.set(0.36, 1.34, 0);
    add(new THREE.BoxGeometry(0.14, 0.6, 0.14).translate(0, -0.3, 0), m.kimono, this.armR);
    this.mesh.add(this.armR);

    this.legL = new THREE.Group();
    this.legL.position.set(-0.15, 0.72, 0);
    add(new THREE.BoxGeometry(0.18, 0.72, 0.18).translate(0, -0.36, 0), m.kimono, this.legL);
    add(new THREE.BoxGeometry(0.2, 0.12, 0.28).translate(0, -0.72, 0.04), m.foot, this.legL);
    this.mesh.add(this.legL);
    this.legR = new THREE.Group();
    this.legR.position.set(0.15, 0.72, 0);
    add(new THREE.BoxGeometry(0.18, 0.72, 0.18).translate(0, -0.36, 0), m.kimono, this.legR);
    add(new THREE.BoxGeometry(0.2, 0.12, 0.28).translate(0, -0.72, 0.04), m.foot, this.legR);
    this.mesh.add(this.legR);

    this.mesh.position.copy(this.pos);
  }

  // Adopt a real fabric/skin bump texture on every body material (graceful).
  applyDetail(t) {
    for (const k in this._materials) {
      const m = this._materials[k];
      m.bumpMap = t;
      m.bumpScale = 0.02;
      m.needsUpdate = true;
    }
    if (this.sword) this.sword.applyDetail(t);
  }

  setPosition(x, y, z) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.flightVel.set(0, 0, 0);
    this.velY = 0;
    this.mesh.position.copy(this.pos);
  }

  setFacing(yaw) {
    this.facing = yaw;
    this.mesh.rotation.set(0, yaw, 0);
  }

  toggleFlight() {
    if (!this.flying) {
      this.flying = true;
      // carry momentum into flight + a little initial lift
      this.flightVel.set(this.vel.x, Math.max(this.velY, 2.5), this.vel.z);
      this.grounded = false;
      if (this.sword.drawn) { this.sword.sheath(); this.combatMode = false; } // no sword in flight
    } else {
      this._land();
    }
  }

  // --- weapon / dash input (called by Game) --------------------------
  toggleSword() {
    if (this.flying) return;
    this.sword.toggle();
    this.combatMode = this.sword.drawn;
  }
  swordSwing() {
    if (!this.combatMode) return false;
    return this.sword.swing(this.stamina);
  }
  tryDash(f, r, camera) {
    camera.getForward(this._fwd);
    camera.getRight(this._right);
    let dx = this._fwd.x * f + this._right.x * r;
    let dz = this._fwd.z * f + this._right.z * r;
    if (Math.abs(dx) < 1e-3 && Math.abs(dz) < 1e-3) { dx = this._fwd.x; dz = this._fwd.z; }
    return this.dash.trigger(dx, dz, this.stamina);
  }

  // --- real glTF avatar (selectable skins) ---------------------------
  setModelLibrary(lib) {
    this.modelLib = lib;
    this.setAvatar(this.avatarModes[this.avatarIndex]);
  }
  // Cycle to the next avatar skin; returns its label (for a HUD toast).
  cycleAvatar() {
    if (!this.modelLib) return null;
    this.avatarIndex = (this.avatarIndex + 1) % this.avatarModes.length;
    const name = this.avatarModes[this.avatarIndex];
    this.setAvatar(name);
    return name;
  }
  setAvatar(name) {
    if (!this.modelLib) return;
    this.modelLib.onReady(name, (data) => {
      // ignore a stale callback if the player has since cycled away
      if (this.avatarModes[this.avatarIndex] !== name) return;
      this._applyModel(data);
    });
  }
  _applyModel(data) {
    this._charState = null; // force the next update to (re)issue the anim state on the new model
    // tear down any previous model
    if (this.charModel) { this.charModel.dispose(); this.charModel = null; }
    if (this.modelRoot) { this.mesh.remove(this.modelRoot); this.modelRoot = null; }
    if (!data) { this._setProcVisible(true); return; } // load failed → procedural
    const inst = this.modelLib.instance(this.avatarModes[this.avatarIndex]);
    if (!inst) { this._setProcVisible(true); return; }
    inst.scene.scale.multiplyScalar(inst.factor); // normalize height (keeps native root scale)
    inst.scene.position.y = inst.groundOffset; // re-seat feet on the ground
    inst.scene.rotation.y = inst.faceFix; // face the player's forward (-Z)
    this.modelRoot = new THREE.Group();
    this.modelRoot.add(inst.scene);
    this.mesh.add(this.modelRoot);
    this.charModel = new CharacterModel(inst.scene, inst.clips);
    this._setProcVisible(false); // hide the procedural body (sword arm stays usable)
  }
  _setProcVisible(v) {
    for (const m of this._procMeshes) m.visible = v;
  }

  _land() {
    if (!this.flying) return;
    this.flying = false;
    // hand momentum back to the ground simulation for a smooth touchdown
    this.vel.set(this.flightVel.x, 0, this.flightVel.z);
    this.velY = Math.min(0, this.flightVel.y);
  }

  // --- combat ---------------------------------------------------------
  // Take damage from an enemy/boss. Applies brief i-frames + knockback away
  // from the source, and triggers death once HP hits zero.
  hurt(amount, src) {
    if (!this.alive || this._invuln > 0 || amount <= 0) return;
    // 1) sword block / parry
    if (this.sword && this.sword.blocking) {
      const r = this.sword.blockResult(amount, this.stamina);
      if (r.parried) { this._invuln = 0.4; if (this.onParry) this.onParry(); return; }
      amount = r.amount;
      if (amount <= 0) return;
    }
    // 2) energy shield soaks the rest (leftover passes through if it breaks)
    if (this.shield) {
      amount = this.shield.absorb(amount);
      if (amount <= 0) { this._invuln = 0.2; return; } // fully shielded — no HP loss
    }
    // 3) HP + knockback
    this.hp -= amount;
    this._invuln = 0.45;
    this._noHitT = 0;
    if (src) {
      const dx = this.pos.x - src.x, dz = this.pos.z - src.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const kf = 4 + amount * 0.18;
      if (this.flying) { this.flightVel.x += (dx / d) * kf; this.flightVel.z += (dz / d) * kf; }
      else { this.vel.x += (dx / d) * kf; this.vel.z += (dz / d) * kf; if (this.grounded) this.velY = 3.2; }
    }
    if (this.onHurt) this.onHurt(amount);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      if (this.onDeath) this.onDeath();
    }
  }

  heal(amount) {
    this.hp = clamp(this.hp + amount, 0, this.maxHp);
  }

  // Invisibility Cloak spell — enemies can't see/aggro you for `d` seconds.
  setInvisible(d) {
    this._invisT = Math.max(this._invisT, d);
  }
  get invisible() {
    return this._invisT > 0;
  }

  reviveFull() {
    this.hp = this.maxHp;
    this.alive = true;
    this._invuln = 1.5;
    this._noHitT = 99;
    this.flying = false;
    this.flightVel.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.velY = 0;
    this._invisT = 0;
    this.stamina.reset();
    this.shield.reset();
  }

  update(dt, controls, camera, colliders) {
    // i-frames + slow out-of-combat regen + invisibility timer
    if (this._invuln > 0) this._invuln -= dt;
    if (this._invisT > 0) this._invisT -= dt;
    this._noHitT += dt;
    if (this.alive && this._noHitT > 6 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 7 * dt);

    // NOTE: flight is toggled by Game (playing state only) — not here — so it
    // can't be triggered inside interiors / while paused.
    if (this.flying) this._updateFlight(dt, controls, camera, colliders);
    else this._updateGround(dt, controls, camera, colliders);

    // abilities + weapon (sword poses the right arm AFTER _animate, so it wins
    // while drawn; otherwise it early-returns and the walk animation stands)
    this.dash.update(dt);
    this.shield.update(dt, this.stamina);
    this.sword.update(dt, this);
    this.stamina.update(dt);

    // drive the glTF avatar's animation from movement state (if a model loaded)
    if (this.charModel) {
      const horiz = Math.hypot(this.vel.x, this.vel.z);
      let state = 'idle';
      if (this.flying) state = 'run';
      else if (!this.grounded) state = 'jump';
      else if (horiz > 5) state = 'run';
      else if (horiz > 0.4) state = 'walk';
      if (state !== this._charState) { this.charModel.setState(state); this._charState = state; }
      this.charModel.update(dt);
    }
  }

  // ---------------- grounded movement ----------------
  _updateGround(dt, controls, camera, colliders) {
    camera.getForward(this._fwd);
    camera.getRight(this._right);
    const f = clamp(controls.forward, -1, 1);
    const r = clamp(controls.right, -1, 1);
    this._wish.set(0, 0, 0).addScaledVector(this._fwd, f).addScaledVector(this._right, r);
    const wishLen = this._wish.length();
    if (wishLen > 1) this._wish.multiplyScalar(1 / wishLen);

    const moving = wishLen > 0.01;
    // sprint (super-speed) is gated by stamina; drains while held, else you walk
    const wantRun = controls.run && moving && this.stamina.value > 1;
    if (wantRun && !this.mounted) this.stamina.drain(SPRINT_DRAIN, dt);
    // a mount overrides on-foot speed with its own (faster) gait, no stamina cost
    const speed = this.mounted ? RUN_SPEED * this.mountSpeedMul : wantRun ? RUN_SPEED : WALK_SPEED;
    if (this.dash.active) {
      // dash overrides horizontal velocity for a short burst
      this.vel.x = this.dash.dir.x * this.dash.speed;
      this.vel.z = this.dash.dir.z * this.dash.speed;
    } else {
      this.vel.x = damp(this.vel.x, this._wish.x * speed, 12, dt);
      this.vel.z = damp(this.vel.z, this._wish.z * speed, 12, dt);
    }

    if (controls.consume('Space') && this.grounded) {
      this.velY = JUMP_V;
      this.grounded = false;
    }
    this.velY -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.velY * dt;

    if (colliders && colliders.length) this._resolve(colliders);
    if (this.bounded) {
      this.pos.x = clamp(this.pos.x, -WORLD_BOUND, WORLD_BOUND);
      this.pos.z = clamp(this.pos.z, -WORLD_BOUND, WORLD_BOUND);
    }

    const gy = this.groundFn(this.pos.x, this.pos.z);
    if (this.pos.y <= gy + 0.001) {
      this.pos.y = gy;
      this.velY = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (moving && horizSpeed > 0.3) {
      this.facing = dampAngle(this.facing, Math.atan2(-this.vel.x, -this.vel.z), 12, dt);
    }
    this.flightSpeed01 = 0;

    this._animate(dt, horizSpeed, speed);

    this.mesh.position.x = this.pos.x;
    this.mesh.position.z = this.pos.z;
    // ease any flight banking back to level
    this._roll = lerp(this._roll, 0, 1 - Math.exp(-10 * dt));
    this._tilt = lerp(this._tilt, 0, 1 - Math.exp(-10 * dt));
    this.mesh.rotation.set(this._tilt, this.facing, this._roll);
    this.mesh.position.y = this.pos.y + (this.grounded ? this.anim.bob : 0);
  }

  // ---------------- flight ----------------
  _updateFlight(dt, controls, camera, colliders) {
    camera.getLookDir(this._look); // full 3D aim incl. pitch
    camera.getRight(this._right);
    const f = clamp(controls.forward, -1, 1);
    const r = clamp(controls.right, -1, 1);
    const ascend = (controls.keys['Space'] ? 1 : 0) - (controls.keys['KeyC'] || controls.keys['ControlLeft'] ? 1 : 0);
    const boost = controls.run ? FLY_BOOST : 1;

    this._wish
      .set(0, 0, 0)
      .addScaledVector(this._look, f)
      .addScaledVector(this._right, r);
    this._wish.y += ascend * (FLY_VERT / FLY_SPEED);
    if (this._wish.lengthSq() > 1) this._wish.normalize();

    const target = this._wish.multiplyScalar(FLY_SPEED * boost * (this.mounted ? this.mountSpeedMul : 1));
    const k = 1 - Math.exp(-FLY_ACCEL * dt);
    this.flightVel.x += (target.x - this.flightVel.x) * k;
    this.flightVel.y += (target.y - this.flightVel.y) * k;
    this.flightVel.z += (target.z - this.flightVel.z) * k;

    this.pos.addScaledVector(this.flightVel, dt);

    if (colliders && colliders.length) this._resolve(colliders); // c.top check lets us clear rooftops
    if (this.bounded) {
      this.pos.x = clamp(this.pos.x, -WORLD_BOUND, WORLD_BOUND);
      this.pos.z = clamp(this.pos.z, -WORLD_BOUND, WORLD_BOUND);
    }

    // never sink through the ground; auto-land when settling low & slow
    const gy = this.groundFn(this.pos.x, this.pos.z);
    if (this.pos.y < gy + 0.5) {
      this.pos.y = Math.max(this.pos.y, gy);
      // auto-land only when genuinely settling (slow & low) so you can still
      // skim along the ground at speed
      const hs = Math.hypot(this.flightVel.x, this.flightVel.z);
      if (this.flightVel.y < 0.2 && hs < 2.5 && this.pos.y <= gy + 0.35) {
        this._land();
        this.pos.y = gy;
      }
    }

    // heading + banking
    const horizSpeed = Math.hypot(this.flightVel.x, this.flightVel.z);
    let targetRoll = 0;
    if (horizSpeed > 0.6) {
      const targetYaw = Math.atan2(-this.flightVel.x, -this.flightVel.z);
      const turn = wrapAngle(targetYaw - this.facing);
      this.facing = dampAngle(this.facing, targetYaw, 6, dt);
      targetRoll = clamp(-turn * 2.2, -0.7, 0.7); // bank into the turn
    }
    const speedFrac = clamp(horizSpeed / (FLY_SPEED * FLY_BOOST), 0, 1);
    this.flightSpeed01 = clamp(Math.hypot(horizSpeed, this.flightVel.y) / (FLY_SPEED * FLY_BOOST), 0, 1);
    const targetTilt = clamp(-this.flightVel.y * 0.06 + speedFrac * 0.5, -0.7, 0.7); // nose with climb/dive

    this._roll = lerp(this._roll, targetRoll, 1 - Math.exp(-8 * dt));
    this._tilt = lerp(this._tilt, targetTilt, 1 - Math.exp(-6 * dt));

    this._flightPose(dt);

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this._tilt, this.facing, this._roll);
  }

  _flightPose(dt) {
    // Superman: arms forward, legs together-back
    this.armL.rotation.x = lerp(this.armL.rotation.x, -2.7, 0.2);
    this.armR.rotation.x = lerp(this.armR.rotation.x, -2.7, 0.2);
    this.armL.rotation.z = lerp(this.armL.rotation.z || 0, 0.15, 0.2);
    this.armR.rotation.z = lerp(this.armR.rotation.z || 0, -0.15, 0.2);
    this.legL.rotation.x = lerp(this.legL.rotation.x, 0.15, 0.2);
    this.legR.rotation.x = lerp(this.legR.rotation.x, -0.05, 0.2);
  }

  _animate(dt, horizSpeed, maxSpeed) {
    let state;
    if (!this.grounded) state = 'jump';
    else if (horizSpeed > 5) state = 'run';
    else if (horizSpeed > 0.3) state = 'walk';
    else state = 'idle';
    this.animState = state;

    const a = this.anim;
    this.armL.rotation.z = lerp(this.armL.rotation.z || 0, 0, 0.2);
    this.armR.rotation.z = lerp(this.armR.rotation.z || 0, 0, 0.2);
    if (state === 'jump') {
      a.leg = lerp(a.leg, 0.5, 0.18);
      a.arm = lerp(a.arm, -1.4, 0.18);
      a.bob = lerp(a.bob, 0, 0.2);
      this.legL.rotation.x = a.leg;
      this.legR.rotation.x = a.leg * 0.6;
      this.armL.rotation.x = a.arm;
      this.armR.rotation.x = a.arm;
    } else if (state === 'idle') {
      a.phase += dt * 2.0;
      const breathe = Math.sin(a.phase) * 0.04;
      a.leg = lerp(a.leg, 0, 0.15);
      a.arm = lerp(a.arm, 0.05, 0.15);
      this.legL.rotation.x = a.leg;
      this.legR.rotation.x = a.leg;
      this.armL.rotation.x = a.arm + breathe;
      this.armR.rotation.x = a.arm - breathe;
      a.bob = breathe;
    } else {
      const cadence = state === 'run' ? 11 : 7;
      const amp = state === 'run' ? 0.95 : 0.6;
      a.phase += dt * cadence;
      const s = Math.sin(a.phase) * amp;
      this.legL.rotation.x = s;
      this.legR.rotation.x = -s;
      this.armL.rotation.x = -s * 0.8;
      this.armR.rotation.x = s * 0.8;
      a.bob = Math.abs(Math.cos(a.phase)) * 0.06;
    }
  }

  _resolve(colliders) {
    const r = this.radius;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of colliders) {
        if (c.top !== undefined && this.pos.y > c.top) continue;
        if (c.type === 'box') {
          const nx = clamp(this.pos.x, c.minX, c.maxX);
          const nz = clamp(this.pos.z, c.minZ, c.maxZ);
          let dx = this.pos.x - nx;
          let dz = this.pos.z - nz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const push = r - d;
              this.pos.x += (dx / d) * push;
              this.pos.z += (dz / d) * push;
            } else {
              const dl = this.pos.x - c.minX;
              const dr = c.maxX - this.pos.x;
              const db = this.pos.z - c.minZ;
              const df = c.maxZ - this.pos.z;
              const mmin = Math.min(dl, dr, db, df);
              if (mmin === dl) this.pos.x = c.minX - r;
              else if (mmin === dr) this.pos.x = c.maxX + r;
              else if (mmin === db) this.pos.z = c.minZ - r;
              else this.pos.z = c.maxZ + r;
            }
          }
        } else if (c.type === 'circle') {
          const dx = this.pos.x - c.x;
          const dz = this.pos.z - c.z;
          const rr = r + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 0.0001;
            const push = rr - d;
            this.pos.x += (dx / d) * push;
            this.pos.z += (dz / d) * push;
          }
        }
      }
    }
  }

  getPosition() {
    return this.pos;
  }
}
