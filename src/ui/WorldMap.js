import { REGIONS, regionAt } from '../world/Regions.js';
import { HALF_GRID, CHUNK_SIZE } from '../world/WorldConfig.js';

// =====================================================================
//  WorldMap — a full-screen atlas of the whole multi-country world (toggle
//  with M). Shows each country's territory (Voronoi-coloured), its capital,
//  boss arena and your position, plus the active mission waypoint. Click a
//  country — or press its number — to FAST-TRAVEL (border-cross) to it.
// =====================================================================

const WORLD_HALF = HALF_GRID * CHUNK_SIZE; // 960
const SIZE = 620;

export class WorldMap {
  constructor() {
    this.onFastTravel = null; // (x,z, regionKey) → Game
    this.visible = false;
    injectStyles();

    const root = document.createElement('div');
    root.className = 'ym-map';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="ym-map-inner">
        <h1>World Atlas <span>世界地図</span></h1>
        <div class="ym-map-body">
          <canvas width="${SIZE}" height="${SIZE}"></canvas>
          <div class="ym-map-side"></div>
        </div>
        <div class="ym-map-hint">Click a country or press its number to fast-travel · M / Esc to close</div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.side = root.querySelector('.ym-map-side');

    // side list of regions for fast travel
    REGIONS.forEach((r, i) => {
      const row = document.createElement('button');
      row.className = 'ym-map-region';
      row.innerHTML = `<span class="dot" style="background:${r.accent}"></span><b>${i + 1}.</b> ${r.name} <i>${r.native}</i>`;
      row.addEventListener('click', () => this.fastTravelIndex(i));
      this.side.appendChild(row);
    });

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * SIZE;
      const my = ((e.clientY - rect.top) / rect.height) * SIZE;
      const wx = (mx / SIZE) * 2 * WORLD_HALF - WORLD_HALF;
      const wz = (my / SIZE) * 2 * WORLD_HALF - WORLD_HALF;
      const r = regionAt(wx, wz);
      this.fastTravelIndex(r.index);
    });

    this._baseCanvas = null; // cached territory render
  }

  fastTravelIndex(i) {
    const r = REGIONS[i];
    if (r && this.onFastTravel) this.onFastTravel(r.center.x, r.center.z, r.key);
  }

  open() {
    this.visible = true;
    this.root.style.display = 'flex';
  }
  close() {
    this.visible = false;
    this.root.style.display = 'none';
  }
  toggle() {
    this.visible ? this.close() : this.open();
  }

  _toMap(wx, wz) {
    return [((wx + WORLD_HALF) / (2 * WORLD_HALF)) * SIZE, ((wz + WORLD_HALF) / (2 * WORLD_HALF)) * SIZE];
  }

  // Render the territories once (cached) — it's the same every open.
  _renderBase() {
    if (this._baseCanvas) return this._baseCanvas;
    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    const ctx = cv.getContext('2d');
    const cell = 10;
    for (let py = 0; py < SIZE; py += cell) {
      for (let px = 0; px < SIZE; px += cell) {
        const wx = (px / SIZE) * 2 * WORLD_HALF - WORLD_HALF;
        const wz = (py / SIZE) * 2 * WORLD_HALF - WORLD_HALF;
        const r = regionAt(wx, wz);
        ctx.fillStyle = hexToRgba(r.ground.grass, 0.85);
        ctx.fillRect(px, py, cell, cell);
      }
    }
    // accent borders between countries: redraw cell if neighbour differs
    ctx.fillStyle = '#0008';
    for (let py = 0; py < SIZE; py += cell) {
      for (let px = 0; px < SIZE; px += cell) {
        const wx = (px / SIZE) * 2 * WORLD_HALF - WORLD_HALF;
        const wz = (py / SIZE) * 2 * WORLD_HALF - WORLD_HALF;
        const here = regionAt(wx, wz).index;
        const right = regionAt(wx + (cell / SIZE) * 2 * WORLD_HALF, wz).index;
        const down = regionAt(wx, wz + (cell / SIZE) * 2 * WORLD_HALF).index;
        if (here !== right || here !== down) ctx.fillRect(px, py, cell, cell);
      }
    }
    this._baseCanvas = cv;
    return cv;
  }

  draw(playerPos, facing, regionKey, missions) {
    if (!this.visible) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this._renderBase(), 0, 0);

    // capitals, arenas, labels
    for (const r of REGIONS) {
      const [cx, cy] = this._toMap(r.center.x, r.center.z);
      // arena marker
      const [ax, ay] = this._toMap(r.arena.x, r.arena.z);
      ctx.fillStyle = r.accent;
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('◆', ax, ay + 5);
      // capital
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = r.accent;
      ctx.stroke();
      // label
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px "Hiragino Sans","Segoe UI",system-ui';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(`${r.name} ${r.native}`, cx, cy - 12);
      ctx.shadowBlur = 0;
    }

    // mission waypoint
    if (missions) {
      const st = missions.hudState(regionKey);
      if (st.waypoint) {
        const [wx, wy] = this._toMap(st.waypoint.x, st.waypoint.z);
        ctx.fillStyle = '#ffd24a';
        ctx.font = '20px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('★', wx, wy + 6);
      }
    }

    // player arrow
    const [mx, my] = this._toMap(playerPos.x, playerPos.z);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-facing);
    ctx.fillStyle = '#ffe46a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // highlight current region in the side list
    const rows = this.side.querySelectorAll('.ym-map-region');
    REGIONS.forEach((r, i) => rows[i].classList.toggle('here', r.key === regionKey));
  }

  dispose() {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}

function hexToRgba(hex, a) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return `rgba(${r},${g},${b},${a})`;
}

let _injected = false;
function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
  .ym-map { position:fixed; inset:0; z-index:22; display:flex; align-items:center; justify-content:center;
    background:#0b0d12d8; backdrop-filter:blur(4px); pointer-events:auto;
    font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  .ym-map-inner { background:#161a24ee; border:1px solid #ffffff22; border-radius:16px; padding:18px 22px; }
  .ym-map-inner h1 { font-size:24px; margin-bottom:12px; letter-spacing:2px; }
  .ym-map-inner h1 span { font-size:16px; opacity:.6; }
  .ym-map-body { display:flex; gap:18px; align-items:flex-start; }
  .ym-map canvas { border-radius:10px; box-shadow:0 6px 24px #000a; background:#10131a; cursor:pointer;
    width:${SIZE}px; height:${SIZE}px; max-width:60vw; max-height:60vw; }
  .ym-map-side { display:flex; flex-direction:column; gap:8px; min-width:200px; }
  .ym-map-region { display:flex; align-items:center; gap:8px; text-align:left; cursor:pointer;
    background:#222838; color:#f6efe2; border:1px solid #ffffff22; border-radius:10px; padding:10px 12px; font-size:14px; }
  .ym-map-region:hover { background:#2f3850; }
  .ym-map-region.here { border-color:#ffd24a; box-shadow:0 0 0 1px #ffd24a inset; }
  .ym-map-region .dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
  .ym-map-region i { opacity:.6; font-style:normal; }
  .ym-map-hint { margin-top:12px; font-size:12px; opacity:.6; text-align:center; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
