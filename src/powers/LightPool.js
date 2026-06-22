import * as THREE from 'three';

// A small pool of PointLights shared by all powers. Powers either:
//   • acquire()/release() a light they position themselves (e.g. a fireball
//     carrying its glow), or
//   • flash() a self-fading one-shot light (e.g. a lightning strike).
// Lights are created once and reused — never allocated per effect — and all
// are disposed (removed from the scene) on teardown.
export class LightPool {
  constructor(scene, n = 8) {
    this.scene = scene;
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 24, 1.8);
      l.visible = false;
      l.castShadow = false;
      scene.add(l);
      this.lights.push({ light: l, busy: false, auto: false, ttl: 0, maxTtl: 0, base: 0 });
    }
  }

  _free() {
    return this.lights.find((e) => !e.busy);
  }

  // Manual: caller drives position/intensity and must release().
  acquire(color, intensity, distance) {
    const e = this._free();
    if (!e) return null;
    e.busy = true;
    e.auto = false;
    e.light.visible = true;
    e.light.color.set(color);
    e.light.intensity = intensity;
    e.light.distance = distance;
    return e.light;
  }

  release(light) {
    const e = this.lights.find((x) => x.light === light);
    if (e) {
      e.busy = false;
      e.auto = false;
      e.light.visible = false;
      e.light.intensity = 0;
    }
  }

  // One-shot fading flash.
  flash(x, y, z, color, intensity, distance, ttl) {
    const e = this._free();
    if (!e) return;
    e.busy = true;
    e.auto = true;
    e.ttl = ttl;
    e.maxTtl = ttl;
    e.base = intensity;
    e.light.visible = true;
    e.light.color.set(color);
    e.light.intensity = intensity;
    e.light.distance = distance;
    e.light.position.set(x, y, z);
  }

  update(dt) {
    for (const e of this.lights) {
      if (e.auto && e.busy) {
        e.ttl -= dt;
        if (e.ttl <= 0) {
          e.busy = false;
          e.auto = false;
          e.light.visible = false;
          e.light.intensity = 0;
        } else {
          e.light.intensity = e.base * (e.ttl / e.maxTtl);
        }
      }
    }
  }

  dispose() {
    for (const e of this.lights) this.scene.remove(e.light);
    this.lights.length = 0;
  }
}
