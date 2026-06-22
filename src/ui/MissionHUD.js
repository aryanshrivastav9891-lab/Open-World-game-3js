import * as THREE from 'three';

// =====================================================================
//  MissionHUD — DOM overlay for progression + objectives + guidance:
//    • Level badge + XP bar          (top-left)
//    • Player health bar (vitals)     (top-left)
//    • Tracked mission + objective     (top-left)
//    • A world-space WAYPOINT marker projected onto the screen, edge-clamped
//      with a direction arrow + distance when off-screen
//    • A red damage vignette pulse and a death overlay
//  Plain DOM over the canvas — crisp and independent of the render loop.
// =====================================================================

const _v = new THREE.Vector3();

export class MissionHUD {
  constructor() {
    injectStyles();
    const root = document.createElement('div');
    root.className = 'ym-mh';
    root.innerHTML = `
      <div class="ym-mh-panel">
        <div class="ym-mh-lvlrow">
          <span class="ym-mh-lvl">Lv 1</span>
          <div class="ym-mh-xpwrap"><div class="ym-mh-xp"></div></div>
        </div>
        <div class="ym-mh-mission">
          <div class="ym-mh-mtitle"></div>
          <ul class="ym-mh-objs"></ul>
        </div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.lvlEl = root.querySelector('.ym-mh-lvl');
    this.xpEl = root.querySelector('.ym-mh-xp');
    this.titleEl = root.querySelector('.ym-mh-mtitle');
    this.objsEl = root.querySelector('.ym-mh-objs');

    // waypoint marker
    this.wp = document.createElement('div');
    this.wp.className = 'ym-mh-wp';
    this.wp.innerHTML = `<span class="ym-mh-wparrow">◆</span><span class="ym-mh-wpdist"></span>`;
    this.wp.style.display = 'none';
    document.body.appendChild(this.wp);
    this.wpDist = this.wp.querySelector('.ym-mh-wpdist');
    this._waypoint = null; // {x,z}

    // damage vignette
    this.vig = document.createElement('div');
    this.vig.className = 'ym-mh-vignette';
    document.body.appendChild(this.vig);
    this._vig = 0;

    // death overlay
    this.death = document.createElement('div');
    this.death.className = 'ym-mh-death';
    this.death.innerHTML = `<div class="ym-mh-deathbig">You were defeated</div><div class="ym-mh-deathsub"></div>`;
    this.death.style.display = 'none';
    document.body.appendChild(this.death);
    this.deathSub = this.death.querySelector('.ym-mh-deathsub');

    this._lastTitle = '';
  }

  render(state) {
    this.lvlEl.textContent = 'Lv ' + state.level;
    this.xpEl.style.width = Math.round((state.xp / state.xpForNext) * 100) + '%';

    const titleKey = state.title + '|' + (state.objectives[0] ? state.objectives[0].text : '');
    if (titleKey !== this._lastTitle) {
      this._lastTitle = titleKey;
      this.titleEl.textContent = state.native ? `${state.title}  ·  ${state.native}` : state.title;
      this.objsEl.innerHTML = '';
      for (const o of state.objectives) {
        const li = document.createElement('li');
        li.textContent = (o.done ? '✓ ' : '• ') + o.text;
        li.className = o.done ? 'done' : '';
        this.objsEl.appendChild(li);
      }
    }
    this._waypoint = state.waypoint || null;
  }

  flashDamage() {
    this._vig = 1;
  }

  setDeath(countdown) {
    if (countdown == null) {
      this.death.style.display = 'none';
    } else {
      this.death.style.display = 'flex';
      this.deathSub.textContent = `Respawning in ${Math.ceil(countdown)}…`;
    }
  }

  update(dt, camera, playerPos) {
    // vignette decay
    if (this._vig > 0) {
      this._vig = Math.max(0, this._vig - dt * 2.2);
      this.vig.style.opacity = (this._vig * 0.55).toFixed(3);
    } else if (this.vig.style.opacity !== '0') {
      this.vig.style.opacity = '0';
    }

    // waypoint marker
    if (!this._waypoint) { this.wp.style.display = 'none'; return; }
    const wx = this._waypoint.x, wz = this._waypoint.z;
    const dist = Math.hypot(wx - playerPos.x, wz - playerPos.z);
    if (dist < 4) { this.wp.style.display = 'none'; return; }
    _v.set(wx, playerPos.y + 1.6, wz).project(camera);
    const W = window.innerWidth, H = window.innerHeight;
    let sx = (_v.x * 0.5 + 0.5) * W;
    let sy = (-_v.y * 0.5 + 0.5) * H;
    const behind = _v.z > 1;
    const margin = 46;
    let offscreen = behind || sx < margin || sx > W - margin || sy < margin || sy > H - margin;
    if (behind) { sx = W - sx; sy = H - sy; } // flip when the target is behind us
    // clamp toward screen edge
    sx = Math.max(margin, Math.min(W - margin, sx));
    sy = Math.max(margin, Math.min(H - margin, sy));
    this.wp.style.display = 'flex';
    this.wp.style.left = sx + 'px';
    this.wp.style.top = sy + 'px';
    this.wp.classList.toggle('edge', offscreen);
    this.wpDist.textContent = Math.round(dist) + 'm';
  }

  dispose() {
    for (const el of [this.root, this.wp, this.vig, this.death]) if (el && el.parentNode) el.parentNode.removeChild(el);
  }
}

let _injected = false;
function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
  .ym-mh { position:fixed; top:14px; left:14px; z-index:13; pointer-events:none;
    font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  .ym-mh-panel { background:#1a1310b3; border:1px solid #ffffff22; border-radius:12px;
    padding:10px 12px; min-width:220px; backdrop-filter:blur(3px); }
  .ym-mh-lvlrow { display:flex; align-items:center; gap:8px; }
  .ym-mh-lvl { font-weight:800; font-size:14px; color:#ffd24a; min-width:42px; }
  .ym-mh-xpwrap { flex:1; height:7px; background:#ffffff22; border-radius:5px; overflow:hidden; }
  .ym-mh-xp { height:100%; width:0%; background:linear-gradient(90deg,#7fb0ff,#c8a8ff); transition:width .25s ease; }
  .ym-mh-hprow { display:flex; align-items:center; gap:8px; margin-top:6px; }
  .ym-mh-hplabel { font-size:11px; opacity:.8; min-width:42px; }
  .ym-mh-hpwrap { flex:1; height:9px; background:#ffffff22; border-radius:5px; overflow:hidden; }
  .ym-mh-hp { height:100%; width:100%; background:linear-gradient(90deg,#4fcf6a,#a8e05a); transition:width .2s ease; }
  .ym-mh-mission { margin-top:10px; border-top:1px solid #ffffff1a; padding-top:8px; }
  .ym-mh-mtitle { font-size:13px; font-weight:700; color:#ffd9a0; }
  .ym-mh-objs { list-style:none; margin:6px 0 0; padding:0; font-size:12px; opacity:.92; }
  .ym-mh-objs li { padding:1px 0; }
  .ym-mh-objs li.done { color:#7fe08a; opacity:.8; }
  .ym-mh-wp { position:fixed; z-index:12; transform:translate(-50%,-50%); pointer-events:none;
    display:flex; flex-direction:column; align-items:center; color:#ffd24a;
    text-shadow:0 2px 6px #000c; font-family:system-ui,sans-serif; }
  .ym-mh-wparrow { font-size:20px; }
  .ym-mh-wpdist { font-size:11px; font-weight:700; }
  .ym-mh-wp.edge .ym-mh-wparrow { font-size:26px; }
  .ym-mh-vignette { position:fixed; inset:0; z-index:11; pointer-events:none; opacity:0;
    box-shadow: inset 0 0 160px 40px #c01010; transition:opacity .08s linear; }
  .ym-mh-death { position:fixed; inset:0; z-index:20; pointer-events:none;
    display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
    background:#3a0808a0; color:#fff; font-family:"Hiragino Sans","Segoe UI",system-ui,sans-serif; }
  .ym-mh-deathbig { font-size:48px; font-weight:800; letter-spacing:3px; text-shadow:0 4px 24px #000; }
  .ym-mh-deathsub { font-size:18px; opacity:.85; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
