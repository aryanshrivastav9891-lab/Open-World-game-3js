import * as THREE from 'three';

// One shared, fixed-size GPU particle pool used by every power. A single
// BufferGeometry + Points + additive material — no per-effect allocation, so
// casting spells never churns the GC. Particles fade by darkening toward black
// (invisible under additive blending) and recycle via a ring cursor.
//
// Dispose() frees the single geometry/material/texture for the whole system.
export class ParticlePool {
  constructor(scene, max = 1600) {
    this.max = max;
    this.scene = scene;

    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);

    this.tex = makeParticleTexture();
    this.mat = new THREE.PointsMaterial({
      size: 0.7,
      map: this.tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // per-particle simulation data
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.base = new Float32Array(max * 3);

    this._cursor = 0;
    this._count = 0; // high-water mark for draw range
    this._c = new THREE.Color();
  }

  // Swap in a real sprite texture (e.g. a loaded spark) — keeps the canvas
  // fallback owned for disposal; the passed texture is owned by its library.
  setTexture(tex) {
    this.mat.map = tex;
    this.mat.needsUpdate = true;
  }

  // Emit a single particle. color is a hex number.
  emit(x, y, z, vx, vy, vz, life, color, gravity = 0) {
    const i = this._cursor;
    this._cursor = (this._cursor + 1) % this.max;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.grav[i] = gravity;
    this.life[i] = life;
    this.maxLife[i] = life;
    this._c.set(color);
    this.base[i3] = this._c.r;
    this.base[i3 + 1] = this._c.g;
    this.base[i3 + 2] = this._c.b;
    if (i >= this._count) this._count = i + 1;
  }

  // Burst of n particles from a point with random velocity in a cone/sphere.
  burst(p, n, opts = {}) {
    const speed = opts.speed ?? 4;
    const spread = opts.spread ?? 1; // 0 = focused along dir, 1 = full sphere
    const life = opts.life ?? 0.8;
    const color = opts.color ?? 0xffffff;
    const gravity = opts.gravity ?? 0;
    const dir = opts.dir; // optional THREE.Vector3 main direction
    for (let k = 0; k < n; k++) {
      let vx = (Math.random() * 2 - 1);
      let vy = (Math.random() * 2 - 1);
      let vz = (Math.random() * 2 - 1);
      const len = Math.hypot(vx, vy, vz) || 1;
      vx /= len; vy /= len; vz /= len;
      if (dir) {
        vx = THREE.MathUtils.lerp(dir.x, vx, spread);
        vy = THREE.MathUtils.lerp(dir.y, vy, spread);
        vz = THREE.MathUtils.lerp(dir.z, vz, spread);
      }
      const s = speed * (0.5 + Math.random() * 0.5);
      this.emit(
        p.x, p.y, p.z,
        vx * s, vy * s, vz * s,
        life * (0.6 + Math.random() * 0.4),
        color,
        gravity
      );
    }
  }

  update(dt) {
    const count = this._count;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) {
          this.colors[i3] = this.colors[i3 + 1] = this.colors[i3 + 2] = 0;
          continue;
        }
        this.vel[i3 + 1] -= this.grav[i] * dt;
        this.positions[i3] += this.vel[i3] * dt;
        this.positions[i3 + 1] += this.vel[i3 + 1] * dt;
        this.positions[i3 + 2] += this.vel[i3 + 2] * dt;
        const t = this.life[i] / this.maxLife[i];
        this.colors[i3] = this.base[i3] * t;
        this.colors[i3 + 1] = this.base[i3 + 1] * t;
        this.colors[i3 + 2] = this.base[i3 + 2] * t;
      } else {
        this.colors[i3] = this.colors[i3 + 1] = this.colors[i3 + 2] = 0;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, count);
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

function makeParticleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
