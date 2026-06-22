import * as THREE from 'three';

// =====================================================================
//  LightningFX — a pool of realistic branching lightning bolts.
//
//  three.js's old `LightningStrike` example geometry was removed before r160, so
//  this is a self-contained generator that produces the same look: a jagged main
//  channel built by recursive midpoint-displacement plus random forks, rebuilt
//  each frame so the bolt flickers, then fades out. Drawn as additive
//  LineSegments. No assets / no network — always works.
//
//  Reusable by any power: `strike(from, to, color, life)`.
// =====================================================================
const MAX_SEGS = 240; // vertex capacity per bolt (segments * 2)
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

// a unit vector perpendicular to `dir`, rotated by a random angle about it
function randPerp(dir, out) {
  _d.copy(dir).normalize();
  const up = Math.abs(_d.y) < 0.9 ? UP : RIGHT;
  _p.copy(up).cross(_d).normalize();
  _q.copy(_d).cross(_p).normalize();
  const a = Math.random() * Math.PI * 2;
  return out.copy(_p).multiplyScalar(Math.cos(a)).addScaledVector(_q, Math.sin(a));
}

export class LightningFX {
  constructor(scene, count = 6) {
    this.scene = scene;
    this.bolts = [];
    for (let i = 0; i < count; i++) {
      const positions = new Float32Array(MAX_SEGS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      const mat = new THREE.LineBasicMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.LineSegments(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.bolts.push({ geo, mat, line, positions, from: new THREE.Vector3(), to: new THREE.Vector3(), life: 0, maxLife: 1, regen: 0, active: false });
    }
  }

  // Fire a bolt from `from` to `to` (Vector3-like). Silent if the pool is busy.
  strike(from, to, color = 0xcfe9ff, life = 0.3) {
    const b = this.bolts.find((x) => !x.active);
    if (!b) return;
    b.from.copy(from);
    b.to.copy(to);
    b.mat.color.setHex(color);
    b.mat.opacity = 1;
    b.life = life;
    b.maxLife = life;
    b.regen = 0;
    b.active = true;
    b.line.visible = true;
    this._regen(b);
  }

  // (re)build the jagged geometry for a bolt
  _regen(b) {
    const pos = b.positions;
    let n = 0; // vertex count written
    const push = (a, c) => {
      if (n + 2 > MAX_SEGS) return;
      pos[n * 3] = a.x; pos[n * 3 + 1] = a.y; pos[n * 3 + 2] = a.z; n++;
      pos[n * 3] = c.x; pos[n * 3 + 1] = c.y; pos[n * 3 + 2] = c.z; n++;
    };
    // recursive midpoint displacement on the main channel
    let pts = [b.from.clone(), b.to.clone()];
    let amp = b.from.distanceTo(b.to) * 0.16;
    for (let gen = 0; gen < 5; gen++) {
      const next = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], c = pts[i + 1];
        const mid = a.clone().lerp(c, 0.5);
        _d.copy(c).sub(a);
        mid.addScaledVector(randPerp(_d, _p), (Math.random() - 0.5) * 2 * amp);
        next.push(a, mid);
        // occasional fork branching off the midpoint
        if (gen >= 2 && Math.random() < 0.16) {
          const f = mid.clone().addScaledVector(_d, 0.25).addScaledVector(randPerp(_d, _q), (Math.random() - 0.3) * amp * 4);
          push(mid, f);
        }
      }
      next.push(pts[pts.length - 1]);
      pts = next;
      amp *= 0.5;
    }
    for (let i = 0; i < pts.length - 1; i++) push(pts[i], pts[i + 1]);
    b.geo.setDrawRange(0, n);
    b.geo.attributes.position.needsUpdate = true;
    // no computeBoundingSphere: the line is frustumCulled=false, so the sphere
    // is unused — skip the full-buffer scan on every flicker.
  }

  update(dt) {
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.life -= dt;
      b.regen -= dt;
      if (b.regen <= 0) { this._regen(b); b.regen = 0.04; } // flicker ~25 Hz
      b.mat.opacity = Math.max(0, b.life / b.maxLife);
      if (b.life <= 0) { b.active = false; b.line.visible = false; }
    }
  }

  dispose() {
    for (const b of this.bolts) {
      this.scene.remove(b.line);
      b.geo.dispose();
      b.mat.dispose();
    }
    this.bolts.length = 0;
  }
}
