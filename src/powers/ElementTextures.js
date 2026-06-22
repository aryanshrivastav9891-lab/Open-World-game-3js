import * as THREE from 'three';

// =====================================================================
//  ElementTextures — a distinct, crisp procedural sprite per power "mode", so
//  each element's particles look unique (flame / droplet / spark / rock fleck /
//  heat / atomic flash / arcane). PowerManager swaps the shared ParticlePool's
//  texture to the ACTIVE power's sprite (Power.texKey), so casting Fire throws
//  flame sprites, Water throws droplets, the Atomic Blast throws blinding cores,
//  etc. SRGB, mip-friendly. buildElementTextures() returns { key → CanvasTexture }.
//
//  HOW TO ADD A TEXTURE FOR A NEW POWER: give the Power a `texKey` and add a
//  matching entry below (or it falls back to `default`).
// =====================================================================
function sprite(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'), 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function radial(ctx, s, stops) {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

export function buildElementTextures() {
  return {
    fire: sprite((x, s) => radial(x, s, [[0, 'rgba(255,255,210,1)'], [0.35, 'rgba(255,150,40,0.92)'], [0.7, 'rgba(200,50,0,0.4)'], [1, 'rgba(120,0,0,0)']])),
    water: sprite((x, s) => radial(x, s, [[0, 'rgba(225,250,255,1)'], [0.4, 'rgba(70,170,255,0.85)'], [1, 'rgba(20,60,160,0)']])),
    lightning: sprite((x, s) => {
      radial(x, s, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(180,230,255,0.7)'], [1, 'rgba(120,180,255,0)']]);
      x.strokeStyle = 'rgba(255,255,255,0.9)';
      x.lineWidth = 3;
      x.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; x.moveTo(s / 2, s / 2); x.lineTo(s / 2 + Math.cos(a) * s * 0.48, s / 2 + Math.sin(a) * s * 0.48); }
      x.stroke();
    }),
    earth: sprite((x, s) => {
      radial(x, s, [[0, 'rgba(185,155,115,1)'], [0.6, 'rgba(120,90,60,0.82)'], [1, 'rgba(60,40,20,0)']]);
      x.fillStyle = 'rgba(90,70,45,0.9)';
      for (let k = 0; k < 6; k++) x.fillRect(8 + ((k * 97) % 40), 8 + ((k * 53) % 40), 8, 8);
    }),
    fry: sprite((x, s) => radial(x, s, [[0, 'rgba(255,240,200,1)'], [0.4, 'rgba(255,90,40,0.92)'], [1, 'rgba(150,20,0,0)']])),
    atomic: sprite((x, s) => {
      radial(x, s, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,240,160,0.95)'], [0.6, 'rgba(255,150,40,0.5)'], [1, 'rgba(120,40,0,0)']]);
      x.strokeStyle = 'rgba(255,230,120,0.85)';
      x.lineWidth = 3;
      x.beginPath();
      x.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2);
      x.stroke();
    }),
    arcane: sprite((x, s) => radial(x, s, [[0, 'rgba(240,222,255,1)'], [0.4, 'rgba(160,110,255,0.85)'], [1, 'rgba(80,40,160,0)']])),
    default: sprite((x, s) => radial(x, s, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']])),
  };
}
