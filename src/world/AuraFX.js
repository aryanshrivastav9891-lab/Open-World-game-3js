import * as THREE from 'three';

// =====================================================================
//  AuraFX — a golden "Super Saiyan" power-up aura around the hero, shown while
//  the arena power-surge buff is active. Built from: an upward golden flame cone,
//  a pulsing core glow sprite, a flaring ground ring, a warm point light, and a
//  fountain of rising golden sparks (emitted into the shared particle pool).
//  One pooled instance, reused; everything disposed. Self-contained (procedural
//  texture) — no assets.
// =====================================================================
const TAU = Math.PI * 2;

function goldTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.4, 'rgba(255,210,90,0.8)');
  g.addColorStop(1, 'rgba(255,160,30,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class AuraFX {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this._t = 0;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // upward golden flame
    this.flameGeo = new THREE.ConeGeometry(1.15, 3.6, 16, 1, true);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffd86a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    this.flame.position.y = 1.5;
    this.flame.frustumCulled = false;
    this.group.add(this.flame);

    // core body glow (billboard)
    this.tex = goldTexture();
    this.glowMat = new THREE.SpriteMaterial({ map: this.tex, color: 0xffe79a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.set(3.0, 3.4, 1);
    this.glow.position.y = 1.2;
    this.group.add(this.glow);

    // flaring ground ring
    this.ringGeo = new THREE.RingGeometry(0.6, 1.7, 40).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffcf4a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    this.ring.position.y = 0.06;
    this.ring.frustumCulled = false;
    this.group.add(this.ring);

    this.light = new THREE.PointLight(0xffd24a, 0, 14, 2);
    this.light.position.y = 1.4;
    this.group.add(this.light);
  }

  setActive(on) {
    this.active = on;
    this.group.visible = on;
    this.light.intensity = on ? 2.2 : 0;
  }

  update(dt, playerPos, particles) {
    if (!this.active) return;
    this._t += dt;
    this.group.position.set(playerPos.x, playerPos.y, playerPos.z);
    const pulse = 1 + Math.sin(this._t * 9) * 0.08;
    this.flame.scale.set(pulse, 1 + Math.sin(this._t * 7) * 0.12, pulse);
    this.flame.rotation.y += dt * 2.4;
    this.flameMat.opacity = 0.3 + Math.abs(Math.sin(this._t * 11)) * 0.25;
    this.glow.scale.set(3.0 * pulse, 3.4 * pulse, 1);
    this.glowMat.opacity = 0.55 + Math.sin(this._t * 8) * 0.2;
    const rp = Math.sin(this._t * 5) * 0.5 + 0.5; // 0..1
    this.ring.scale.setScalar(1 + rp * 0.5);
    this.ringMat.opacity = 0.7 - rp * 0.45;
    this.light.intensity = 2.0 + Math.sin(this._t * 9) * 0.8;

    // rising golden sparks (anti-gravity → they stream upward)
    if (particles) {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU, r = 0.4 + Math.random() * 0.9;
        particles.emit(playerPos.x + Math.cos(a) * r, playerPos.y + 0.2 + Math.random() * 0.5, playerPos.z + Math.sin(a) * r, (Math.random() - 0.5) * 0.5, 4 + Math.random() * 3, (Math.random() - 0.5) * 0.5, 0.6, 0xffd24a, -2);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.flameGeo.dispose(); this.flameMat.dispose();
    this.ringGeo.dispose(); this.ringMat.dispose();
    this.glowMat.dispose(); this.tex.dispose();
  }
}
