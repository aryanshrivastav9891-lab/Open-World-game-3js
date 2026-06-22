import * as THREE from 'three';

// Floating combat numbers (damage / status) as a pooled DOM layer projected
// from world space to screen each frame. Pooled — a fixed set of divs is
// reused, so spawning hits never allocates.
const POOL = 28;
const _v = new THREE.Vector3();

export class CombatHUD {
  constructor() {
    this._injectStyles();
    this.root = document.createElement('div');
    this.root.className = 'cb-layer';
    (document.getElementById('hud') || document.body).appendChild(this.root);

    this.items = [];
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'cb-num';
      el.style.opacity = '0';
      this.root.appendChild(el);
      this.items.push({ el, life: 0, maxLife: 1, world: new THREE.Vector3(), vy: 0 });
    }
    this._cursor = 0;
  }

  // worldPos: THREE.Vector3, text: string|number, color: css color
  spawn(worldPos, text, color = '#fff', big = false) {
    const it = this.items[this._cursor];
    this._cursor = (this._cursor + 1) % POOL;
    it.world.copy(worldPos);
    it.life = 1.1;
    it.maxLife = 1.1;
    it.vy = 38 + Math.random() * 14;
    it.el.textContent = text;
    it.el.style.color = color;
    it.el.style.fontSize = big ? '30px' : '20px';
    it.el.style.opacity = '1';
  }

  update(dt, camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        it.el.style.opacity = '0';
        continue;
      }
      _v.copy(it.world);
      _v.project(camera);
      if (_v.z > 1) {
        it.el.style.opacity = '0';
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      const t = 1 - it.life / it.maxLife;
      it.el.style.transform = `translate(-50%,-50%) translate(${x}px, ${y - t * it.vy}px)`;
      it.el.style.opacity = String(Math.min(1, it.life / (it.maxLife * 0.5)));
    }
  }

  dispose() {
    this.root.remove();
    this._style?.remove();
    this.items.length = 0;
  }

  _injectStyles() {
    if (document.getElementById('cb-style')) return;
    const css = `
    .cb-layer { position:absolute; inset:0; pointer-events:none; z-index:13; overflow:hidden; }
    .cb-num { position:absolute; left:0; top:0; font-weight:800;
      font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif;
      text-shadow:0 2px 4px #000, 0 0 6px #000; will-change:transform,opacity; }
    `;
    const s = document.createElement('style');
    s.id = 'cb-style';
    s.textContent = css;
    document.head.appendChild(s);
    this._style = s;
  }
}
