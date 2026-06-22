import * as THREE from 'three';

// Flying dragons that drift across the sky as image-textured billboard
// sprites (THREE.Sprite — always camera-facing), NOT primitive geometry.
//
// It first tries to load real transparent dragon PNGs from the internet via
// THREE.TextureLoader (the same loader-with-graceful-fallback pattern as
// src/assets/Loaders.js). Until/unless those load, a hand-drawn canvas dragon
// texture is used, so dragons always appear even fully offline. Replace
// DEFAULT_URLS (or pass {urls:[...]}) with your own CORS-enabled images.
const DEFAULT_URLS = [
  'https://upload.wikimedia.org/wikipedia/commons/5/5b/Chinese_dragon_silhouette.png',
  'https://upload.wikimedia.org/wikipedia/commons/8/8b/Dragon_silhouette.png',
];

const COUNT = 4;
const _v = new THREE.Vector3();

export class DragonManager {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this._disposed = false;
    this.models = null;
    this._modelReady = false; // becomes true once the real glTF dragon loads
    this.textures = [makeFallbackDragonTexture()]; // always ≥1 usable texture
    this._ownTextures = [...this.textures];

    this.dragons = [];
    for (let i = 0; i < COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.textures[0],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        fog: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(26, 14, 1);
      sprite.visible = false;
      sprite.renderOrder = 2;
      scene.add(sprite);
      this.dragons.push({ sprite, mat, model: null, useModel: false, flying: false, vel: new THREE.Vector3(), life: 0, maxLife: 1, wait: Math.random() * 6, baseY: 70, bob: Math.random() * 10 });
    }

    this._loadRealTextures(opts.urls || DEFAULT_URLS);
  }

  // Adopt the real 3D dragon model (DragonAttenuation.glb). Graceful: until/unless
  // it loads, dragons keep flying as the image billboards.
  setModelLibrary(lib) {
    this.models = lib;
    lib.onReady('dragon', (d) => { this._modelReady = !!d; });
  }

  _loadRealTextures(urls) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    for (const url of urls) {
      loader.load(
        url,
        (tex) => {
          if (this._disposed) { tex.dispose(); return; } // late load after teardown
          tex.colorSpace = THREE.SRGBColorSpace;
          this.textures.push(tex);
          this._ownTextures.push(tex);
        },
        undefined,
        () => {
          /* graceful fallback: keep using the canvas dragon */
        }
      );
    }
  }

  _spawn(d, playerPos) {
    // lazily build this slot's real 3D dragon once the model is available
    if (this._modelReady && !d.model && this.models) {
      const inst = this.models.instance('dragon');
      if (inst) {
        inst.scene.scale.multiplyScalar(inst.factor);
        inst.scene.rotation.y = inst.faceFix; // orient so its nose leads (tunable in MODEL_SPECS)
        const g = new THREE.Group();
        g.add(inst.scene);
        g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
        this.scene.add(g);
        d.model = g; d.useModel = true;
        d.sprite.visible = false; d.mat.opacity = 0; // this slot now flies as the model
      }
    }
    const obj = d.useModel ? d.model : d.sprite;

    if (!d.useModel) {
      const tex = this.textures[(Math.random() * this.textures.length) | 0];
      d.mat.map = tex;
      d.mat.needsUpdate = true;
      const img = tex.image;
      const aspect = img && img.width ? img.width / img.height : 2;
      const h = 12 + Math.random() * 8;
      d.sprite.scale.set(h * aspect, h, 1);
    }

    // start far out on one side, cross over the player region
    const ang = Math.random() * Math.PI * 2;
    const dist = 150 + Math.random() * 60;
    d.baseY = 55 + Math.random() * 55;
    obj.position.set(playerPos.x + Math.cos(ang) * dist, d.baseY, playerPos.z + Math.sin(ang) * dist);
    const speed = 7 + Math.random() * 7;
    d.vel.set(-Math.cos(ang) * speed + (Math.random() - 0.5) * 3, 0, -Math.sin(ang) * speed + (Math.random() - 0.5) * 3);
    d.maxLife = (dist * 2) / speed;
    d.life = d.maxLife;
    d.bob = Math.random() * 10;
    obj.visible = true;
    d.flying = true;
    if (!d.useModel) d.mat.opacity = 0;
  }

  update(dt, camera, playerPos) {
    for (const d of this.dragons) {
      if (!d.flying) {
        d.wait -= dt;
        if (d.wait <= 0) this._spawn(d, playerPos);
        continue;
      }
      d.life -= dt;
      d.bob += dt;
      const obj = d.useModel ? d.model : d.sprite;
      obj.position.addScaledVector(d.vel, dt);
      obj.position.y = d.baseY + Math.sin(d.bob * 0.6) * 3;

      if (d.useModel) {
        obj.rotation.y = Math.atan2(d.vel.x, d.vel.z); // yaw to flight direction
        obj.rotation.z = Math.sin(d.bob * 0.6) * 0.12; // gentle bank
      } else {
        d.mat.rotation = Math.sin(d.bob * 0.6) * 0.12;
        const t = 1 - d.life / d.maxLife; // 0→1 across the flight
        const fade = Math.min(t / 0.18, (1 - t) / 0.22, 1);
        d.mat.opacity = THREE.MathUtils.clamp(fade, 0, 1) * 0.95;
      }

      if (d.life <= 0) {
        obj.visible = false;
        if (!d.useModel) d.mat.opacity = 0;
        d.flying = false;
        d.wait = 3 + Math.random() * 9;
      }
    }
  }

  dispose() {
    this._disposed = true;
    for (const d of this.dragons) {
      this.scene.remove(d.sprite);
      d.mat.dispose();
      if (d.model) this.scene.remove(d.model); // model shares cached geo/mats (ModelLibrary owns them)
    }
    for (const t of this._ownTextures) t.dispose();
    this.dragons.length = 0;
    this.textures.length = 0;
    this._ownTextures.length = 0;
  }
}

// Hand-drawn transparent dragon silhouette → CanvasTexture. Reads as a winged
// serpent so the fallback still looks like a dragon, not a box.
function makeFallbackDragonTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#9a3326');
  grad.addColorStop(1, '#5a1d16');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#2a0d0a';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  // body (serpentine, facing right)
  ctx.beginPath();
  ctx.moveTo(28, 74); // tail tip
  ctx.quadraticCurveTo(90, 58, 150, 66);
  ctx.quadraticCurveTo(190, 70, 206, 54); // neck
  ctx.lineTo(228, 44); // head top
  ctx.lineTo(248, 56); // snout
  ctx.lineTo(228, 62); // mouth
  ctx.quadraticCurveTo(206, 74, 175, 82);
  ctx.quadraticCurveTo(95, 96, 28, 74);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // wings (two membranes)
  ctx.fillStyle = '#7a2a20';
  for (const [bx, tipY] of [[120, 8], [158, 4]]) {
    ctx.beginPath();
    ctx.moveTo(bx, 66);
    ctx.lineTo(bx - 34, tipY);
    ctx.lineTo(bx - 6, 30);
    ctx.lineTo(bx + 18, tipY + 8);
    ctx.lineTo(bx + 22, 60);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // tail spade
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(28, 74);
  ctx.lineTo(14, 64);
  ctx.lineTo(24, 78);
  ctx.lineTo(10, 84);
  ctx.lineTo(30, 80);
  ctx.closePath();
  ctx.fill();

  // horn + eye
  ctx.strokeStyle = '#2a0d0a';
  ctx.beginPath();
  ctx.moveTo(226, 44);
  ctx.lineTo(220, 32);
  ctx.stroke();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath();
  ctx.arc(233, 52, 2.4, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
