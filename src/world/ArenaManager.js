import * as THREE from 'three';
import { groundHeightAt, surfaceAt, Surface } from './WorldConfig.js';
import { AuraFX } from './AuraFX.js';

// =====================================================================
//  ArenaManager — a few fixed COMBAT ARENAS scattered across the world. Each is
//  a stone disc ringed by glowing golden pillars. When the hero steps inside:
//    • the arena fills with a HORDE of monsters (EnemyManager.fillArena),
//    • the hero's powers are SUPERCHARGED (PowerManager.setArenaBuff), and
//    • a golden "Super Saiyan" aura ignites around the avatar (AuraFX).
//  Stepping out ends the surge. The arena keeps topping up its horde while you
//  fight inside it. Arena centres are snapped to the nearest dry land.
//
//  HOW TO ADD AN ARENA: add an { x, z } to ZONES below.
// =====================================================================
const TAU = Math.PI * 2;
const R = 13; // arena radius (also the buff/horde zone)

// candidate centres (snapped to land at construction)
const ZONES = [
  { x: 150, z: 12 },
  { x: -150, z: 130 },
  { x: 44, z: 188 },
];

function landAt(x, z) {
  if (surfaceAt(x, z) !== Surface.WATER) return { x, z };
  for (let t = 1; t <= 24; t++) {
    const a = t * 2.399963, r = 6 + t * 4; // golden-angle spiral outward
    const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
    if (surfaceAt(nx, nz) !== Surface.WATER) return { x: nx, z: nz };
  }
  return { x, z };
}

export class ArenaManager {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this._t = 0;
    this._activeIdx = -1;
    this._refillT = 0;
    this.zones = ZONES.map((z) => landAt(z.x, z.z)); // resolved arena centres
    this._buildShared();
    this.groups = this.zones.map((z) => this._buildArena(z));
    this.aura = new AuraFX(scene);
  }

  _buildShared() {
    this.discGeo = new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2);
    this.ringGeo = new THREE.RingGeometry(R - 1.0, R, 64).rotateX(-Math.PI / 2);
    this.pillarGeo = new THREE.CylinderGeometry(0.4, 0.55, 3.4, 8);
    this.orbGeo = new THREE.IcosahedronGeometry(0.5, 1);
    this.discMat = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.95, metalness: 0 });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.pillarMat = new THREE.MeshStandardMaterial({ color: 0x6b6357, roughness: 0.85, metalness: 0.1 });
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  }

  _buildArena(z) {
    const g = new THREE.Group();
    const gy = groundHeightAt(z.x, z.z);
    const disc = new THREE.Mesh(this.discGeo, this.discMat);
    disc.position.set(z.x, gy + 0.03, z.z); disc.receiveShadow = true; g.add(disc);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.position.set(z.x, gy + 0.06, z.z); g.add(ring);
    const N = 8;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * TAU;
      const px = z.x + Math.cos(ang) * (R - 0.4), pz = z.z + Math.sin(ang) * (R - 0.4);
      const py = groundHeightAt(px, pz);
      const pil = new THREE.Mesh(this.pillarGeo, this.pillarMat); pil.position.set(px, py + 1.7, pz); pil.castShadow = true; g.add(pil);
      const orb = new THREE.Mesh(this.orbGeo, this.orbMat); orb.position.set(px, py + 3.7, pz); g.add(orb);
    }
    this.scene.add(g);
    return g;
  }

  update(dt) {
    this._t += dt;
    // pulse the gold rings + orbs so arenas read as "active" from afar
    this.ringMat.opacity = 0.65 + Math.sin(this._t * 3) * 0.25;
    this.orbMat.opacity = 0.7 + Math.sin(this._t * 4 + 1) * 0.3;

    const player = this.game.player, powers = this.game.powers, enemies = this.game.enemies;
    if (!player || !powers || !enemies) return;
    const p = player.pos;
    let inIdx = -1;
    for (let i = 0; i < this.zones.length; i++) {
      const z = this.zones[i];
      if ((p.x - z.x) ** 2 + (p.z - z.z) ** 2 < R * R) { inIdx = i; break; }
    }
    const nowIn = inIdx >= 0;

    if (nowIn && this._activeIdx !== inIdx) {
      const z = this.zones[inIdx];
      enemies.fillArena(z.x, z.z, R, enemies.enemies.length); // swarm the arena
      powers.setArenaBuff(true);
      this.aura.setActive(true);
      this.game.hud?.toast?.('⚔ ARENA — POWER SURGE! Your powers are supercharged', 2600);
      this.game.audio?.sfx?.('unsheath');
      this._activeIdx = inIdx;
      this._refillT = 2.5;
    } else if (!nowIn && this._activeIdx >= 0) {
      powers.setArenaBuff(false);
      this.aura.setActive(false);
      this.game.hud?.toast?.('Left the arena — power surge ended', 1600);
      this._activeIdx = -1;
    }

    if (nowIn) {
      this._refillT -= dt;
      if (this._refillT <= 0) {
        const z = this.zones[inIdx];
        enemies.fillArena(z.x, z.z, R, enemies.enemies.length); // keep it packed
        this._refillT = 2.5;
      }
    }

    this.aura.update(dt, p, powers.particles);
  }

  dispose() {
    this.aura.dispose();
    for (const g of this.groups) this.scene.remove(g);
    this.discGeo.dispose(); this.ringGeo.dispose(); this.pillarGeo.dispose(); this.orbGeo.dispose();
    this.discMat.dispose(); this.ringMat.dispose(); this.pillarMat.dispose(); this.orbMat.dispose();
    this.groups.length = 0;
  }
}
