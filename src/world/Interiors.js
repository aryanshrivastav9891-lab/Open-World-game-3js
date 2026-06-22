import * as THREE from 'three';
import { disposeNode } from '../utils/dispose.js';

// =====================================================================
//  Interiors — small, self-contained furnished scenes loaded on demand.
//
//  Each interior is its OWN THREE.Scene with its own lights, fog, geometry
//  and materials (none shared with the streamed world). Built fresh when
//  the player enters a building and fully disposed on exit, so they never
//  add to resident memory while you're outside.
// =====================================================================

const toon = (color, emissive = 0x000000, emissiveIntensity = 0) =>
  new THREE.MeshToonMaterial({ color, emissive: new THREE.Color(emissive), emissiveIntensity });

const box = (w, h, d, x, y, z, material) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

class Interior {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.scene = new THREE.Scene();
    this.colliders = [];
    this.spawn = { x: 0, y: 0, z: 0, yaw: 0 };
    this.exit = null;
  }

  // Build the shell shared by every interior: floor, ceiling, 4 walls
  // (front wall has the exit), warm lighting, fog, and the exit trigger.
  _shell({ hw, hd, H, floorColor, wallColor, fog }) {
    const s = this.scene;
    s.background = new THREE.Color(0x140f0a);
    s.fog = new THREE.Fog(fog || 0x2a1d12, 6, 26);

    // lights — warm interior glow
    s.add(new THREE.AmbientLight(0xffe6c2, 0.55));
    const hemi = new THREE.HemisphereLight(0xffd9a0, 0x2a1d12, 0.5);
    s.add(hemi);
    const lamp = new THREE.PointLight(0xffb86b, 12, 22, 1.6);
    lamp.position.set(0, H - 0.6, 0);
    s.add(lamp);
    this._lampPos = new THREE.Vector3(0, H - 0.6, 0);

    const floorMat = toon(floorColor);
    const wallMat = toon(wallColor);
    const woodMat = toon(0x5a3d28);
    const ceilMat = toon(0x2c2014);

    // floor + ceiling
    const floor = box(hw * 2, 0.2, hd * 2, 0, -0.1, 0, floorMat);
    floor.receiveShadow = true;
    s.add(floor);
    s.add(box(hw * 2, 0.2, hd * 2, 0, H, 0, ceilMat));

    // tatami seams (thin wood strips on the floor)
    for (let i = -hw + 1.5; i < hw; i += 1.6) s.add(box(0.06, 0.04, hd * 2, i, 0.02, 0, woodMat));

    // walls (front wall = +Z, has a doorway gap, rest solid)
    const t = 0.2;
    s.add(box(t, H, hd * 2, -hw, H / 2, 0, wallMat)); // left
    s.add(box(t, H, hd * 2, hw, H / 2, 0, wallMat)); // right
    s.add(box(hw * 2, H, t, 0, H / 2, -hd, wallMat)); // back
    // front wall split around a 2-wide doorway
    const doorHalf = 1.1;
    const seg = hw - doorHalf;
    s.add(box(seg, H, t, -(doorHalf + seg / 2), H / 2, hd, wallMat));
    s.add(box(seg, H, t, doorHalf + seg / 2, H / 2, hd, wallMat));
    s.add(box(doorHalf * 2, H - 2.2, t, 0, H - (H - 2.2) / 2, hd, woodMat)); // lintel
    // noren over the door
    s.add(box(2.0, 0.7, 0.06, 0, 2.0, hd - 0.05, toon(0x2f4a6b)));

    // corner posts
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) s.add(box(0.22, H, 0.22, sx * hw, H / 2, sz * hd, woodMat));

    // colliders — keep the player inside
    const top = H;
    this.colliders.push(
      { type: 'box', minX: -hw - 0.5, maxX: -hw, minZ: -hd, maxZ: hd, top },
      { type: 'box', minX: hw, maxX: hw + 0.5, minZ: -hd, maxZ: hd, top },
      { type: 'box', minX: -hw, maxX: hw, minZ: -hd - 0.5, maxZ: -hd, top },
      // front wall (both sides of door)
      { type: 'box', minX: -hw, maxX: -doorHalf, minZ: hd, maxZ: hd + 0.5, top },
      { type: 'box', minX: doorHalf, maxX: hw, minZ: hd, maxZ: hd + 0.5, top },
      // invisible threshold across the doorway so you can't walk out into the
      // void — leave deliberately via E / Esc (the exit trigger sits inside it)
      { type: 'box', minX: -doorHalf, maxX: doorHalf, minZ: hd, maxZ: hd + 0.5, top }
    );

    // spawn just inside, facing into the room; exit zone at the doorway
    this.spawn = { x: 0, y: 0, z: hd - 1.6, yaw: 0 };
    this.exit = { kind: 'exit', x: 0, z: hd - 0.5, r: 1.5, label: 'Press E or Esc to leave' };

    return { woodMat };
  }

  getTriggers() {
    return this.exit ? [this.exit] : [];
  }

  dispose() {
    disposeNode(this.scene);
    this.scene.clear();
    this.colliders.length = 0;
  }
}

// ---- specific interiors --------------------------------------------

function machiya() {
  const it = new Interior('machiya', 'Machiya — Tatami Room');
  const hw = 5, hd = 4.2, H = 3.2;
  it._shell({ hw, hd, H, floorColor: 0xc9b88a, wallColor: 0xf4efe2, fog: 0x2a1d12 });
  const s = it.scene;
  const wood = toon(0x6b4a2e);
  // chabudai (low table) + zabuton cushions
  s.add(box(2.0, 0.1, 1.2, 0, 0.45, -0.5, wood));
  for (const sx of [-1, 1]) s.add(box(0.1, 0.45, 0.1, sx * 0.9, 0.22, -0.5 + (sx ? 0 : 0), wood));
  s.add(box(0.1, 0.45, 0.1, 0.9, 0.22, 0.0, wood));
  for (const [x, z] of [[-1.6, -0.5], [1.6, -0.5], [0, -1.6]])
    s.add(box(0.9, 0.12, 0.9, x, 0.06, z, toon(0xb23b3b)));
  // rolled futon along a wall
  s.add(box(2.2, 0.4, 0.9, -hw + 1.6, 0.2, -hd + 0.8, toon(0xe6ddc8)));
  // tokonoma alcove with a vase + hanging scroll
  s.add(box(1.6, 1.6, 0.3, hw - 1.2, 1.4, -hd + 0.2, toon(0x3a2a1c)));
  s.add(box(0.3, 0.6, 0.3, hw - 1.2, 0.5, -hd + 0.4, toon(0x2f6b5a)));
  s.add(box(0.5, 1.2, 0.04, hw - 1.2, 1.6, -hd + 0.06, toon(0xeae0c8)));
  // hanging paper lantern
  const lant = box(0.5, 0.7, 0.5, 0, H - 0.9, 0, toon(0xf3e2a9, 0xf3e2a9, 1.0));
  s.add(lant);
  it.colliders.push({ type: 'box', minX: -1.1, maxX: 1.1, minZ: -1.2, maxZ: 0.2, top: 0.6 });
  return it;
}

function ramen() {
  const it = new Interior('ramen', 'Ramen-ya — Counter');
  const hw = 6, hd = 4.6, H = 3.4;
  it._shell({ hw, hd, H, floorColor: 0x7a5230, wallColor: 0x8a6a44, fog: 0x241608 });
  const s = it.scene;
  const wood = toon(0x6b4a2e);
  const steel = toon(0x9a9a9a);
  // counter along the back
  s.add(box(hw * 2 - 1, 1.0, 1.2, 0, 0.5, -hd + 1.4, toon(0x8a5a2e)));
  s.add(box(hw * 2 - 1, 0.12, 1.3, 0, 1.06, -hd + 1.4, wood));
  // stools
  for (let x = -hw + 1.5; x < hw - 1; x += 1.6) {
    s.add(box(0.5, 0.6, 0.5, x, 0.3, -hd + 2.9, toon(0x33485f)));
    it.colliders.push({ type: 'circle', x, z: -hd + 2.9, r: 0.35, top: 0.6 });
    // bowls on the counter
    s.add(box(0.4, 0.2, 0.4, x, 1.2, -hd + 1.4, toon(0xe8e2d2)));
  }
  // kitchen behind: stove + pots + hood
  s.add(box(2.4, 1.0, 0.8, -2.5, 0.5, -hd + 0.4, steel));
  s.add(box(0.6, 0.5, 0.6, -3.0, 1.2, -hd + 0.4, toon(0x2a2a2a)));
  s.add(box(0.6, 0.5, 0.6, -2.0, 1.2, -hd + 0.4, toon(0x2a2a2a)));
  s.add(box(3, 0.4, 1, -2.5, H - 0.6, -hd + 0.4, steel)); // hood
  // hanging red lanterns
  for (const x of [-3, 0, 3])
    s.add(box(0.45, 0.6, 0.45, x, H - 0.8, 0.5, toon(0xd84b3a, 0xd84b3a, 0.9)));
  // counter collider
  it.colliders.push({ type: 'box', minX: -hw + 0.5, maxX: hw - 0.5, minZ: -hd + 0.8, maxZ: -hd + 2.0, top: 1.2 });
  return it;
}

function teahouse() {
  const it = new Interior('teahouse', 'Chashitsu — Tea Room');
  const hw = 4.6, hd = 4.2, H = 3.0;
  it._shell({ hw, hd, H, floorColor: 0xc9b88a, wallColor: 0xf4efe2, fog: 0x2a2114 });
  const s = it.scene;
  const wood = toon(0x6b4a2e);
  // round window (a flat disc on the back wall)
  const win = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), toon(0xbfe0d8, 0xbfe0d8, 0.4));
  win.position.set(0, 1.8, -hd + 0.12);
  s.add(win);
  // sunken hearth (ro) with a kettle
  s.add(box(1.0, 0.2, 1.0, 0, 0.1, 0, toon(0x2a2a2a)));
  s.add(box(0.5, 0.5, 0.5, 0, 0.4, 0, toon(0x4a4a4a)));
  // low tea table + utensils
  s.add(box(1.2, 0.08, 0.8, 1.6, 0.4, 1.2, wood));
  s.add(box(0.2, 0.2, 0.2, 1.6, 0.55, 1.2, toon(0x2f6b5a)));
  // tokonoma with ikebana
  s.add(box(1.4, 1.6, 0.3, -hw + 1.0, 1.4, -hd + 0.2, toon(0x3a2a1c)));
  s.add(box(0.2, 0.5, 0.2, -hw + 1.0, 0.6, -hd + 0.4, toon(0x7a5230)));
  for (const c of [0xff7aa2, 0xffd24a, 0xff9a3a])
    s.add(box(0.18, 0.18, 0.18, -hw + 1.0 + (Math.random() - 0.5) * 0.4, 1.0 + Math.random() * 0.3, -hd + 0.4, toon(c, c, 0.2)));
  // small indoor garden by the window (mossy stones + a plant)
  for (const x of [-1.2, -0.6, 0.2]) s.add(box(0.4, 0.3, 0.4, x, 0.15, -hd + 0.7, toon(0x6f8f4a)));
  s.add(box(0.5, 0.7, 0.5, 0, H - 0.8, 0, toon(0xf3e2a9, 0xf3e2a9, 0.9))); // lantern
  return it;
}

function shrine() {
  const it = new Interior('shrine', 'Shrine — Main Hall');
  const hw = 7, hd = 6, H = 4.6;
  it._shell({ hw, hd, H, floorColor: 0x7c3b32, wallColor: 0x8a4a40, fog: 0x1a0f0a });
  const s = it.scene;
  const gold = toon(0xd8b24a, 0xd8b24a, 0.25);
  // raised altar at the back
  s.add(box(hw * 2 - 2, 0.6, 2, 0, 0.3, -hd + 1.2, toon(0x5a3d28)));
  s.add(box(hw * 2 - 3, 0.3, 1.6, 0, 0.75, -hd + 1.2, toon(0x6b4a2e)));
  // gohei / gold ornaments
  for (const x of [-3, 0, 3]) s.add(box(0.3, 1.4, 0.3, x, 1.5, -hd + 1.2, gold));
  s.add(box(hw * 2 - 1, 0.3, 0.3, 0, H - 0.5, -hd + 0.4, gold)); // ridge
  // shimenawa rope (thick bar) across the front
  s.add(box(hw * 2 - 1, 0.4, 0.4, 0, H - 0.9, hd - 1.5, toon(0xe6ddc8)));
  for (const x of [-2, 0, 2]) s.add(box(0.1, 0.6, 0.1, x, H - 1.4, hd - 1.5, toon(0xe6ddc8)));
  // saisen (offering) box
  s.add(box(2.0, 0.8, 1.0, 0, 0.4, 1.0, toon(0x3a2a1c)));
  s.add(box(2.0, 0.1, 0.2, 0, 0.85, 1.0, toon(0x2a1d14))); // slot
  // taiko drum on a stand
  s.add(box(1.2, 1.2, 0.6, hw - 1.8, 1.0, -1, toon(0x7c3b32)));
  s.add(box(1.3, 0.2, 0.7, hw - 1.8, 1.6, -1, gold));
  // candles (emissive)
  for (const sx of [-1, 1])
    s.add(box(0.12, 0.5, 0.12, sx * 1.5, 1.05, 0.6, toon(0xfff0b0, 0xffd060, 1.2)));
  it.colliders.push({ type: 'box', minX: -hw + 1, maxX: hw - 1, minZ: -hd + 0.4, maxZ: -hd + 2.0, top: 1.0 });
  it.colliders.push({ type: 'box', minX: -1, maxX: 1, minZ: 0.5, maxZ: 1.5, top: 0.8 });
  return it;
}

const FACTORIES = { machiya, ramen, teahouse, shrine };

export const Interiors = {
  has(id) {
    return !!FACTORIES[id];
  },
  create(id) {
    const f = FACTORIES[id] || machiya;
    return f();
  },
};
