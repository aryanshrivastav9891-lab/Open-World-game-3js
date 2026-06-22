import * as THREE from 'three';
import { clamp, damp } from '../utils/math.js';
import { groundHeightAt } from '../world/WorldConfig.js';

// Smooth third-person orbit camera with wall/terrain collision so it never
// clips through buildings or sinks into hills.
export class ThirdPersonCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI; // start looking down the street (toward -Z is player fwd)
    this.pitch = 0.32;
    this.distance = 6.2;
    this.distanceTarget = 6.2; // lerps toward this (pulls back at flight speed)
    this.minDistance = 1.4;
    this.height = 1.7; // look-at target height above player feet

    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._current = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._initialized = false;
  }

  update(dt, controls, playerPos, colliders) {
    // Apply mouse/stick look.
    this.yaw += controls.yawDelta;
    this.pitch = clamp(this.pitch + controls.pitchDelta, -0.55, 0.95);
    controls.yawDelta = 0;
    controls.pitchDelta = 0;

    // Ease the follow distance (Game raises distanceTarget at flight speed).
    this.distance = damp(this.distance, this.distanceTarget, 5, dt);

    this._target.set(playerPos.x, playerPos.y + this.height, playerPos.z);

    // Orbit direction (from target outward to camera).
    const cp = Math.cos(this.pitch);
    this._dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // Collision: shorten distance if something is between target & camera.
    let dist = this.distance;
    dist = this._collide(this._target, this._dir, dist, colliders);

    this._desired.copy(this._dir).multiplyScalar(dist).add(this._target);

    if (!this._initialized) {
      this._current.copy(this._desired);
      this._initialized = true;
    } else {
      // Spring/lerp follow (frame-rate independent).
      this._current.x = damp(this._current.x, this._desired.x, 14, dt);
      this._current.y = damp(this._current.y, this._desired.y, 14, dt);
      this._current.z = damp(this._current.z, this._desired.z, 14, dt);
    }

    this.camera.position.copy(this._current);
    this.camera.lookAt(this._target);
  }

  // March from target toward the camera; clamp at the first obstruction.
  _collide(target, dir, maxDist, colliders) {
    let best = maxDist;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * maxDist;
      const px = target.x + dir.x * t;
      const py = target.y + dir.y * t;
      const pz = target.z + dir.z * t;
      // terrain / bridge
      if (py < groundHeightAt(px, pz) + 0.35) {
        best = Math.max(this.minDistance, t - maxDist / steps);
        break;
      }
      // structures (treated as vertical obstacles)
      if (colliders && this._blocked(px, py, pz, colliders)) {
        best = Math.max(this.minDistance, t - maxDist / steps);
        break;
      }
    }
    return best;
  }

  _blocked(x, y, z, colliders) {
    const pad = 0.3;
    for (const c of colliders) {
      if (c.top !== undefined && y > c.top + 0.5) continue; // above the building
      if (c.type === 'box') {
        if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
      } else if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz < (c.r + pad) * (c.r + pad)) return true;
      }
    }
    return false;
  }

  // Horizontal forward/right derived from yaw, for player movement.
  getForward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }
  getRight(out) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
  // Full 3D look direction (includes pitch) — used to steer flight & aim powers.
  getLookDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }

  setYaw(y) {
    this.yaw = y;
    this._initialized = false;
  }
}
