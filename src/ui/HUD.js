import { STRUCTURES, riverCenterX } from '../world/WorldConfig.js';

// All on-screen UI is plain DOM laid over the WebGL canvas — cheap, crisp,
// and independent of the render loop. The HUD owns the loading screen,
// contextual prompts, minimap, debug overlay, pause menu, and fade-to-black
// transitions used when entering/leaving buildings.
export class HUD {
  constructor(root) {
    this.root = root;
    this.paused = false;
    this.debugVisible = false;
    this.onResume = null;
    this.onToggleDay = null;
    this.onToggleMute = null;
    this.onSaves = null;
    this._build();
  }

  _build() {
    injectStyles();
    const el = (cls, html = '') => {
      const d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      this.root.appendChild(d);
      return d;
    };

    // Loading screen
    this.loading = el(
      'ym-loading',
      `<div class="ym-title">大和村</div>
       <div class="ym-sub">Yamato-mura · a walk through a Japanese town</div>
       <div class="ym-barwrap"><div class="ym-bar"></div></div>
       <div class="ym-status">Preparing the world…</div>`
    );
    this.bar = this.loading.querySelector('.ym-bar');
    this.status = this.loading.querySelector('.ym-status');

    // Fade overlay
    this.fadeEl = el('ym-fade');

    // Interaction prompt
    this.prompt = el('ym-prompt');
    this.prompt.style.opacity = '0';

    // Toast (location / sign text)
    this.toastEl = el('ym-toast');
    this.toastEl.style.opacity = '0';

    // Streaming indicator
    this.stream = el('ym-stream', '◴ streaming…');
    this.stream.style.opacity = '0';

    // Minimap
    const mm = el('ym-minimap');
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = 168;
    this.mapCanvas.height = 168;
    mm.appendChild(this.mapCanvas);
    this.mapCtx = this.mapCanvas.getContext('2d');
    this.mapLabel = document.createElement('div');
    this.mapLabel.className = 'ym-maplabel';
    this.mapLabel.textContent = 'Village Center';
    mm.appendChild(this.mapLabel);

    // Debug overlay
    this.debug = el('ym-debug');
    this.debug.style.display = 'none';

    // Pause menu
    this.pause = el(
      'ym-pause',
      `<div class="ym-panel">
        <h1>一時停止 · Paused</h1>
        <button data-act="resume">Resume</button>
        <button data-act="saves">Saved Games</button>
        <button data-act="day">Toggle Day / Night</button>
        <button data-act="mute">Toggle Sound</button>
        <div class="ym-controls">
          <h2>Controls</h2>
          <ul>
            <li><b>WASD / Arrows</b> — move</li>
            <li><b>Mouse</b> — look (click to capture)</li>
            <li><b>Shift</b> — run</li>
            <li><b>Space</b> — jump</li>
            <li><b>E</b> — interact / enter</li>
            <li><b>Esc</b> — pause / leave building</li>
            <li><b>~</b> — debug overlay</li>
          </ul>
        </div>
        <div class="ym-hint">Click the screen to look around.</div>
      </div>`
    );
    this.pause.style.display = 'none';
    this.pause.addEventListener('click', (e) => {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'resume' && this.onResume) this.onResume();
      else if (act === 'saves' && this.onSaves) this.onSaves();
      else if (act === 'day' && this.onToggleDay) this.onToggleDay();
      else if (act === 'mute' && this.onToggleMute) this.onToggleMute();
    });
  }

  // ---- loading ----
  setProgress(p, label) {
    this.bar.style.width = Math.round(p * 100) + '%';
    if (label) this.status.textContent = label;
  }
  finishLoading() {
    this.loading.classList.add('done');
    setTimeout(() => (this.loading.style.display = 'none'), 700);
  }

  // ---- prompt ----
  showPrompt(text) {
    this.prompt.textContent = text;
    this.prompt.style.opacity = '1';
  }
  clearPrompt() {
    this.prompt.style.opacity = '0';
  }

  // ---- toast ----
  toast(text, ms = 2600) {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (this.toastEl.style.opacity = '0'), ms);
  }

  // ---- streaming ----
  setStreaming(count) {
    this.stream.style.opacity = count > 0 ? '1' : '0';
  }

  // ---- fade ----
  fade(toBlack, ms = 450) {
    return new Promise((resolve) => {
      this.fadeEl.style.transition = `opacity ${ms}ms ease`;
      // force reflow so the transition always runs
      void this.fadeEl.offsetWidth;
      this.fadeEl.style.opacity = toBlack ? '1' : '0';
      setTimeout(resolve, ms);
    });
  }

  // ---- pause ----
  openPause() {
    this.paused = true;
    this.pause.style.display = 'flex';
  }
  closePause() {
    this.paused = false;
    this.pause.style.display = 'none';
  }

  // ---- debug ----
  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.debug.style.display = this.debugVisible ? 'block' : 'none';
  }
  updateDebug(html) {
    if (this.debugVisible) this.debug.innerHTML = html;
  }

  // ---- minimap ----
  setMapLabel(text) {
    this.mapLabel.textContent = text;
  }

  drawMinimap(px, pz, facing) {
    const ctx = this.mapCtx;
    const S = this.mapCanvas.width;
    const C = S / 2;
    const RANGE = 130; // world units shown from centre to edge
    const scale = C / RANGE;
    ctx.clearRect(0, 0, S, S);

    // background
    ctx.fillStyle = '#1d2a1e';
    ctx.beginPath();
    ctx.arc(C, C, C - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 1, 0, Math.PI * 2);
    ctx.clip();

    const toMap = (wx, wz) => [C + (wx - px) * scale, C + (wz - pz) * scale];

    // river
    ctx.strokeStyle = '#3a6f8f';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let z = pz - RANGE; z <= pz + RANGE; z += 8) {
      const [mx, my] = toMap(riverCenterX(z), z);
      if (z === pz - RANGE) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.stroke();

    // main street (E-W) + shrine approach (N-S)
    ctx.strokeStyle = '#5a513c';
    ctx.lineWidth = 3;
    let [ax, ay] = toMap(-150, 0);
    let [bx, by] = toMap(86, 0);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    [ax, ay] = toMap(0, -96);
    [bx, by] = toMap(0, 0);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();

    // POIs
    for (const s of STRUCTURES) {
      if (Math.abs(s.x - px) > RANGE || Math.abs(s.z - pz) > RANGE) continue;
      const color = POI_COLOR[s.type];
      if (!color) continue;
      const [mx, my] = toMap(s.x, s.z);
      ctx.fillStyle = color;
      const r = s.enter ? 4 : 3;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
      if (s.enter) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.restore();

    // player arrow (rotates with facing; mesh forward is -Z = up on map)
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(-facing);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ring
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(C, C, C - 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const POI_COLOR = {
  machiya: '#cdb38b',
  ramen: '#e0563f',
  teahouse: '#7fbf9a',
  shrine: '#d8514a',
  torii: '#d8514a',
  pagoda: '#b06bd8',
  bridge: '#9a7b50',
  koi: '#3a6f8f',
};

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
  #hud { position: fixed; inset: 0; pointer-events: none; z-index: 10;
         font-family: "Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  #hud button { pointer-events: auto; }
  .ym-loading { position:absolute; inset:0; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:18px;
    background: radial-gradient(circle at 50% 35%, #2a3550, #0b0d12);
    transition: opacity .6s ease; z-index: 30; }
  .ym-loading.done { opacity:0; }
  .ym-title { font-size: 84px; font-weight:800; letter-spacing:8px; text-shadow:0 4px 30px #000a; }
  .ym-sub { opacity:.8; letter-spacing:2px; }
  .ym-barwrap { width:340px; height:8px; background:#ffffff22; border-radius:6px; overflow:hidden; margin-top:8px;}
  .ym-bar { width:0%; height:100%; background:linear-gradient(90deg,#e0563f,#ffd24a); transition:width .2s ease;}
  .ym-status { opacity:.7; font-size:13px; }
  .ym-fade { position:absolute; inset:0; background:#000; opacity:0; pointer-events:none; z-index:25; }
  .ym-prompt { position:absolute; left:50%; bottom:14%; transform:translateX(-50%);
    background:#1a1310cc; border:1px solid #ffffff22; padding:10px 18px; border-radius:10px;
    font-size:16px; transition:opacity .15s ease; backdrop-filter: blur(3px); }
  .ym-toast { position:absolute; left:50%; top:8%; transform:translateX(-50%);
    background:#1a1310cc; padding:10px 22px; border-radius:10px; font-size:18px;
    transition:opacity .4s ease; max-width:70vw; text-align:center; }
  .ym-stream { position:absolute; right:16px; bottom:16px; font-size:12px; opacity:0;
    transition:opacity .3s ease; background:#0008; padding:4px 10px; border-radius:8px; }
  .ym-minimap { position:absolute; top:16px; right:16px; width:168px; }
  .ym-minimap canvas { display:block; border-radius:50%; box-shadow:0 4px 18px #0008; }
  .ym-maplabel { text-align:center; font-size:12px; margin-top:6px; opacity:.85;
    text-shadow:0 1px 4px #000; }
  .ym-debug { position:absolute; top:12px; left:12px; font-family:ui-monospace,Menlo,monospace;
    font-size:12px; line-height:1.5; background:#000a; padding:8px 12px; border-radius:8px;
    white-space:pre; }
  .ym-pause { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
    background:#0b0d12cc; z-index:28; backdrop-filter: blur(4px); }
  .ym-panel { background:#1a1310ee; border:1px solid #ffffff22; padding:28px 36px; border-radius:16px;
    min-width:320px; pointer-events:auto; }
  .ym-panel h1 { font-size:26px; margin-bottom:18px; letter-spacing:2px; }
  .ym-panel button { display:block; width:100%; margin:8px 0; padding:12px; font-size:15px;
    background:#2a3550; color:#f6efe2; border:1px solid #ffffff22; border-radius:10px; cursor:pointer; }
  .ym-panel button:hover { background:#39456a; }
  .ym-controls { margin-top:18px; }
  .ym-controls h2 { font-size:15px; opacity:.8; margin-bottom:8px; }
  .ym-controls ul { list-style:none; font-size:13px; opacity:.9; }
  .ym-controls li { padding:2px 0; }
  .ym-hint { margin-top:14px; font-size:12px; opacity:.6; text-align:center; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
