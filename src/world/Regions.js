// =====================================================================
//  Regions — the multi-country world map.
//
//  The world is partitioned into countries by a nearest-centre (Voronoi)
//  test over each region's `center`. Japan sits at the origin (the original
//  hand-built village); India, China and the USA occupy the surrounding
//  wedges out to the map edge. Everything region-flavoured — terrain tint,
//  scatter species, building architecture, the boss, the enemy type and the
//  generated mission — is read from the REGIONS table below.
//
//  This module is intentionally PURE DATA + cheap math (no imports from
//  WorldConfig/Assets) so there are no circular dependencies: WorldConfig,
//  Assets, the AI/mission systems and the HUD all import FROM here.
//
//  ---------------------------------------------------------------------
//  HOW TO ADD A NEW COUNTRY / REGION (a few lines):
//    1. Add one entry to REGIONS:
//         { key, name, native, center:{x,z}, accent:'#rrggbb',
//           ground:{ grass, grassAlt, path },           // hex ints
//           trees:[{ type, density }],                  // scatter species
//           buildings:[ styleKey, ... ], landmark: styleKey|null,
//           arena:{x,z}, boss:{...}, enemy:{...} }
//       Region ownership is automatic (nearest `center`).
//    2. For any NEW tree `type`     → add a case in Assets._buildProp.
//       For any NEW building style   → add a case in Assets.buildRegionStructure.
//    3. The boss + its "defeat the boss" mission are generated automatically
//       from boss:{...} (see MissionManager). Nothing else to wire.
//  ---------------------------------------------------------------------
// =====================================================================

// Centre of each country. Japan = origin; the other three are 120° apart at
// radius R so each owns a clean outer wedge of the finite map.
export const REGIONS = [
  {
    key: 'japan',
    name: 'Yamato',
    native: '大和',
    center: { x: 0, z: 0 },
    accent: '#d8514a',
    ground: { grass: 0x6f8f4a, grassAlt: 0x86a05a, path: 0xb8a987 },
    trees: [
      { type: 'sakura', density: 4 },
      { type: 'pine', density: 2 },
    ],
    buildings: ['jp_minka', 'jp_minka', 'jp_pagoda'],
    landmark: null, // the hand-built village IS Japan's landmark cluster
    arena: { x: 0, z: 150 },
    boss: { name: 'Oni Warlord', native: '鬼大将', hp: 1400, color: 0xb5352a, scale: 2.6, xp: 500 },
    enemy: { name: 'Nodachi Ronin', color: 0x55303a, hp: 120, dmg: 9, xp: 40 },
  },
  {
    key: 'india',
    name: 'Bharat',
    native: 'भारत',
    center: { x: 0, z: 680 },
    accent: '#e8902a',
    ground: { grass: 0x9a8a4a, grassAlt: 0xb2a05a, path: 0xc9a36b },
    trees: [
      { type: 'palm', density: 3 },
      { type: 'banyan', density: 1 },
    ],
    buildings: ['in_haveli', 'in_haveli', 'in_temple'],
    landmark: 'in_temple_grand',
    arena: { x: 0, z: 600 },
    boss: { name: 'Asura Raja', native: 'असुर', hp: 1600, color: 0xc8642a, scale: 2.8, xp: 560 },
    enemy: { name: 'Rakshasa', color: 0x7a3b6a, hp: 140, dmg: 10, xp: 46 },
  },
  {
    key: 'china',
    name: 'Zhongguo',
    native: '中国',
    center: { x: -589, z: -340 },
    accent: '#e0c33a',
    ground: { grass: 0x7e9a52, grassAlt: 0x93ab63, path: 0xb8a06a },
    trees: [
      { type: 'bamboo', density: 4 },
      { type: 'pine', density: 1 },
    ],
    buildings: ['cn_hall', 'cn_wall', 'cn_pagoda'],
    landmark: 'cn_pagoda_grand',
    arena: { x: -520, z: -300 },
    boss: { name: 'Jade Dragon Lord', native: '龍王', hp: 1700, color: 0x2f9c6a, scale: 3.0, xp: 600 },
    enemy: { name: 'Terracotta Guard', color: 0x9c6b40, hp: 150, dmg: 11, xp: 50 },
  },
  {
    key: 'usa',
    name: 'America',
    native: 'USA',
    center: { x: 589, z: -340 },
    accent: '#4a86d8',
    ground: { grass: 0x6c8f5a, grassAlt: 0x86a36a, path: 0x9a9aa2 },
    trees: [
      { type: 'oak', density: 3 },
      { type: 'cactus', density: 1 },
    ],
    buildings: ['us_house', 'us_house', 'us_tower'],
    landmark: 'us_tower_grand',
    arena: { x: 520, z: -300 },
    boss: { name: 'Steel Titan', native: 'MK-IX', hp: 1800, color: 0x4a6fa8, scale: 3.2, xp: 640 },
    enemy: { name: 'Riot Drone', color: 0x3a4654, hp: 130, dmg: 12, xp: 48 },
  },
];

// index for quick lookups by key
const BY_KEY = {};
REGIONS.forEach((r, i) => {
  r.index = i;
  BY_KEY[r.key] = r;
});

export const ARENA_RADIUS = 34; // how close the player must be to trigger a boss

// Suppress procedurally-scattered buildings inside this radius of the origin,
// so they never collide with the hand-placed Japanese village.
export const VILLAGE_SUPPRESS_R = 170;

// Nearest-centre (Voronoi) region for a world point.
export function regionAt(x, z) {
  let best = REGIONS[0];
  let bestD = Infinity;
  for (const r of REGIONS) {
    const dx = x - r.center.x;
    const dz = z - r.center.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

export function regionByKey(key) {
  return BY_KEY[key];
}

// The two nearest regions + a 0..0.5 "border" factor (0 deep inside a region,
// →0.5 exactly on a border). Used to soften terrain colour across frontiers.
export function regionBlend(x, z) {
  let a = null,
    b = null,
    da = Infinity,
    db = Infinity;
  for (const r of REGIONS) {
    const dx = x - r.center.x;
    const dz = z - r.center.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < da) {
      db = da;
      b = a;
      da = d;
      a = r;
    } else if (d < db) {
      db = d;
      b = r;
    }
  }
  const t = b ? 0.5 * (1 - (db - da) / (db + da + 1e-3)) : 0;
  return { region: a, neighbour: b, t };
}

// 0..1 "settlement density": dense near a region centre/arena, sparse at the
// frontier. Drives how many procedural buildings a chunk gets.
export function settlementDensity(x, z) {
  const r = regionAt(x, z);
  const d = Math.hypot(x - r.center.x, z - r.center.z);
  // dense within ~120 of centre, fading to near-zero by ~520
  const core = 1 - smooth(120, 520, d);
  return core;
}

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Linear-interpolate two packed RGB ints (for border colour blending).
export function lerpHex(a, b, t) {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  const r = (ar + (br - ar) * t) | 0;
  const g = (ag + (bg - ag) * t) | 0;
  const bl = (ab + (bb - ab) * t) | 0;
  return (r << 16) | (g << 8) | bl;
}
