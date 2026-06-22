import { fbm2, smoothstep, lerp, clamp, rngFor, TAU } from '../utils/math.js';
import {
  regionAt,
  settlementDensity,
  REGIONS,
  VILLAGE_SUPPRESS_R,
} from './Regions.js';

// =====================================================================
//  WorldConfig — the single source of truth for the world's shape.
//
//  Everything about the town is *derived deterministically* from world
//  coordinates and a fixed seed, so we never need to store the world.
//  ChunkManager asks this module "what is in chunk (cx,cz)?" and builds it.
// =====================================================================

export const WORLD_SEED = 20260620;

// --- Grid / streaming geometry ---------------------------------------
export const CHUNK_SIZE = 30; // world units per chunk edge
export const GRID = 64; // chunks per axis  → world is 64*30 = 1920 units across
export const HALF_GRID = GRID / 2; // valid chunk index range: [-32, 31]
export const LOAD_RADIUS = 3; // 7x7 = 49 chunks kept resident around player
export const LOD_FULL_RADIUS = 2; // chunks this close render full-detail props

// --- Terrain ----------------------------------------------------------
const TOWN_FLAT_R0 = 150; // fully flat within this radius of origin
const TOWN_FLAT_R1 = 320; // full hill amplitude beyond this radius
const HILL_AMP = 8;

// --- River (runs roughly north–south, gently meandering) --------------
const RIVER_X = 95;
const RIVER_MEANDER = 12;
const RIVER_HALF = 7.5; // half-width of open water
const RIVER_BANK = 6; // bank falloff width
const RIVER_BED = -2.4;
export const WATER_LEVEL = -1.0;

// --- Rice paddies (south-west outskirts) ------------------------------
const PADDY = { x0: -135, x1: -35, z0: 150, z1: 235 };

// Surface categories drive terrain vertex colours, scatter rules, etc.
export const Surface = { GRASS: 0, PATH: 1, WATER: 2, PADDY: 3 };

export const SURFACE_COLORS = {
  [Surface.GRASS]: 0x6f8f4a,
  [Surface.PATH]: 0xb8a987,
  [Surface.WATER]: 0x3a4a46, // river bed (mostly hidden under the water plane)
  [Surface.PADDY]: 0x5f7d4e,
};

// Shared colour palette for the toon-styled world.
export const PALETTE = {
  woodDark: 0x5a3d28,
  wood: 0x7a5230,
  woodLight: 0x9c7a4d,
  plaster: 0xeae3d2,
  tileRoof: 0x394049,
  roofRed: 0x7c3b32,
  torii: 0xc1352b,
  lanternRed: 0xd84b3a,
  lanternPaper: 0xf3e2a9,
  stone: 0x8d8a82,
  stoneDark: 0x6f6c64,
  tatami: 0xc9b88a,
  shojiPaper: 0xf4efe2,
  paper: 0xf3ece0,
  sakuraPink: 0xffb7c5,
  sakuraDeep: 0xf2a0b6,
  pine: 0x3f6b46,
  trunk: 0x5b4128,
  grass: 0x6f8f4a,
  water: 0x4a86a8,
  gold: 0xd8b24a,
  noren: 0x2f4a6b,
  koi: 0xe8702a,
};

export function riverCenterX(z) {
  return RIVER_X + RIVER_MEANDER * Math.sin(z * 0.018);
}

export function isWater(x, z) {
  return Math.abs(x - riverCenterX(z)) < RIVER_HALF;
}

function inPaddy(x, z) {
  return x > PADDY.x0 && x < PADDY.x1 && z > PADDY.z0 && z < PADDY.z1;
}

// --- Paths: main street (E–W) + shrine approach (N–S) + plaza ---------
const STREET_HALF = 4.2;
const SHRINE_PATH_HALF = 3.4;

export function onPath(x, z) {
  // Central plaza
  if (x * x + z * z < 7 * 7) return true;
  // Main street along X
  if (Math.abs(z) < STREET_HALF && x > -150 && x < 86) return true;
  // Shrine approach along -Z
  if (Math.abs(x) < SHRINE_PATH_HALF && z < -2 && z > -96) return true;
  // Bridge approach east of the river
  if (Math.abs(z) < STREET_HALF && x > 104 && x < 150) return true;
  return false;
}

export function surfaceAt(x, z) {
  if (isWater(x, z)) return Surface.WATER;
  if (onPath(x, z)) return Surface.PATH;
  if (inPaddy(x, z)) return Surface.PADDY;
  return Surface.GRASS;
}

// Region-aware surface colour. Water + paddies (Japan-only features near the
// origin) keep their fixed colours; grass + paths take the local country's
// palette, blended a little across borders so frontiers aren't a hard seam.
export function surfaceHex(x, z, surf) {
  if (surf === Surface.WATER) return SURFACE_COLORS[Surface.WATER];
  if (surf === Surface.PADDY) return SURFACE_COLORS[Surface.PADDY];
  const r = regionAt(x, z);
  return surf === Surface.PATH ? r.ground.path : r.ground.grass;
}

// --- Terrain height ---------------------------------------------------
// Smooth, deterministic, cheap. Flat in the town core and paddies,
// gentle hills toward the world edge, carved by the river channel.
export function heightAt(x, z) {
  const dist = Math.hypot(x, z);
  const hills = fbm2(x * 0.012, z * 0.012, WORLD_SEED, 3) * HILL_AMP;
  let h = hills * smoothstep(TOWN_FLAT_R0, TOWN_FLAT_R1, dist);
  // Paddies are terraced flat, blended over a band so there's no hard cliff
  // against the surrounding hills.
  const pf = paddyFalloff(x, z);
  if (pf > 0) h = lerp(h, 0, pf);
  // River channel
  const d = Math.abs(x - riverCenterX(z));
  const channel = 1 - smoothstep(RIVER_HALF, RIVER_HALF + RIVER_BANK, d);
  if (channel > 0) h = lerp(h, RIVER_BED, channel);
  return h;
}

// 1 inside the paddy rectangle, smoothly ramping to 0 over a 10-unit band.
function paddyFalloff(x, z) {
  const dx = Math.max(PADDY.x0 - x, x - PADDY.x1, 0);
  const dz = Math.max(PADDY.z0 - z, z - PADDY.z1, 0);
  return 1 - smoothstep(0, 10, Math.hypot(dx, dz));
}

// Ground height the player actually stands on — terrain, except on bridge
// decks where it follows the arched deck.
export function groundHeightAt(x, z) {
  for (const s of STRUCTURES) {
    // Deck half-width (2.6) matches the bridge mesh (Assets._bridge w=5),
    // not the wider footprint hd, so the player isn't lifted onto thin air.
    if (s.type === 'bridge' && x > s.x - s.hw && x < s.x + s.hw && Math.abs(z - s.z) < 2.6) {
      const t = (x - (s.x - s.hw)) / (2 * s.hw);
      const rise = Math.sin(t * Math.PI) * 1.6; // matches Assets._bridge arch
      return BRIDGE_DECK_Y + rise;
    }
  }
  return heightAt(x, z);
}

// Surface normal of the terrain (finite differences) — used for ground
// alignment and lighting where needed.
export function terrainNormal(x, z, out) {
  const e = 0.6;
  const hl = heightAt(x - e, z);
  const hr = heightAt(x + e, z);
  const hd = heightAt(x, z - e);
  const hu = heightAt(x, z + e);
  out.set(hl - hr, 2 * e, hd - hu).normalize();
  return out;
}

// =====================================================================
//  Hand-placed structures (the deliberate town near the origin).
//  Procedural scatter fills the rest of the world.
//  rot = yaw in radians; a structure's "front"/door faces -Z at rot 0.
// =====================================================================
export const BRIDGE_DECK_Y = 0.25;

export const STRUCTURES = [
  // --- Machiya townhouses lining the main street (enterable ★) -------
  m('m1', -45, 12, 0, 'machiya'),
  m('m2', -22, -12, Math.PI, 'machiya'),
  m('m3', 40, 12, 0, 'machiya'),
  m('m4', 45, -12, Math.PI, 'machiya'),
  m('m5', 62, 12, 0, null), // non-enterable variety
  // --- Ramen shop / izakaya (★) -------------------------------------
  b('ramen', 'ramen', 8, 12, 0, 7.5, 5.5, 5, 'ramen'),
  // --- Tea house with garden (★) ------------------------------------
  b('teahouse', 'teahouse', -70, -13, Math.PI, 7, 6, 4.5, 'teahouse'),
  // --- Shrine: torii gate + main hall (★) ---------------------------
  { id: 'torii', type: 'torii', x: 0, z: -48, rot: 0, hw: 5, hd: 1.2, h: 9, collide: 'gate' },
  b('shrine', 'shrine', 0, -95, Math.PI, 9, 7, 7, 'shrine'),
  // --- Pagoda landmark (non-enterable) ------------------------------
  { id: 'pagoda', type: 'pagoda', x: 60, z: -58, rot: 0.3, hw: 5, hd: 5, h: 22, collide: 'box' },
  // --- Wooden bridge over the river ---------------------------------
  { id: 'bridge', type: 'bridge', x: riverCenterX(0), z: 0, rot: 0, hw: 13, hd: 4, h: 3, collide: 'none' },
  // --- Stone lanterns (toro) lining the shrine approach -------------
  toro('toroL1', -5, -22), toro('toroR1', 5, -22),
  toro('toroL2', -5, -34), toro('toroR2', 5, -34),
  toro('toroL3', -5, -46), toro('toroR3', 5, -46),
  // --- Paper-lantern poles along the street (emissive at night) -----
  pole('poleL1', -32, -5.6), pole('poleR1', -32, 5.6),
  pole('poleL2', -4, -5.6), pole('poleR2', -4, 5.6),
  pole('poleL3', 26, -5.6), pole('poleR3', 26, 5.6),
  pole('poleL4', 52, -5.6), pole('poleR4', 52, 5.6),
  // --- Misc props ---------------------------------------------------
  { id: 'vend1', type: 'vending', x: 19, z: -9.5, rot: Math.PI, hw: 1.1, hd: 0.6, h: 1.9, collide: 'box' },
  { id: 'vend2', type: 'vending', x: 22, z: -9.5, rot: Math.PI, hw: 1.1, hd: 0.6, h: 1.9, collide: 'box' },
  { id: 'stall1', type: 'stall', x: -12, z: 9.2, rot: 0, hw: 2.2, hd: 1.4, h: 2.6, collide: 'box' },
  { id: 'stall2', type: 'stall', x: -2, z: -9.2, rot: Math.PI, hw: 2.2, hd: 1.4, h: 2.6, collide: 'box' },
  { id: 'koi', type: 'koi', x: -70, z: -27, rot: 0, hw: 6, hd: 5, h: 0.4, collide: 'none' },
  { id: 'bonsai', type: 'bonsai', x: -63, z: -8, rot: 0, hw: 0.6, hd: 0.6, h: 1.1, collide: 'circle' },
  { id: 'sign1', type: 'sign', x: 5, z: 4.5, rot: -0.4, hw: 0.4, hd: 0.4, h: 2.2, collide: 'circle', text: '大和村' },
  { id: 'sign2', type: 'sign', x: 2, z: -10, rot: 0.2, hw: 0.4, hd: 0.4, h: 2.0, collide: 'circle', text: '神社 →' },
];

// Helper constructors -------------------------------------------------
function m(id, x, z, rot, interior) {
  // standard machiya footprint
  return { id, type: 'machiya', x, z, rot, hw: 6, hd: 5, h: 6, collide: 'box', enter: !!interior, interior };
}
function b(id, type, x, z, rot, hw, hd, h, interior) {
  return { id, type, x, z, rot, hw, hd, h, collide: 'box', enter: !!interior, interior };
}
function toro(id, x, z) {
  return { id, type: 'toro', x, z, rot: 0, hw: 0.6, hd: 0.6, h: 2.0, collide: 'circle' };
}
function pole(id, x, z) {
  return { id, type: 'lantern_pole', x, z, rot: 0, hw: 0.3, hd: 0.3, h: 3.4, collide: 'circle' };
}

// Compute the door interaction point for an enterable structure:
// a spot just in front of the door (on the -Z face, rotated by rot).
export function doorPointOf(s) {
  const fwd = s.hd + 1.6; // distance in front of the face
  const lx = 0;
  const lz = -fwd;
  const cos = Math.cos(s.rot);
  const sin = Math.sin(s.rot);
  return {
    x: s.x + (lx * cos + lz * sin),
    z: s.z + (-lx * sin + lz * cos),
    // Facing back toward the door (so on exit the player looks at it):
    yaw: s.rot + Math.PI,
  };
}

// Structures whose CENTRE lies in this chunk. Each structure has exactly one
// owning chunk, so it is built / collided / triggered exactly once even when
// its footprint straddles a chunk boundary. (Footprints are small relative to
// the load radius, so the owning chunk is always resident when the structure
// is visible.)
export function structuresInChunk(cx, cz) {
  const out = [];
  for (const s of STRUCTURES) {
    const oc = worldToChunk(s.x, s.z);
    if (oc.cx === cx && oc.cz === cz) out.push(s);
  }
  return out;
}

// True if a point is inside (or near) any structure footprint — used to
// stop scatter from spawning trees inside a building.
export function blockedByStructure(x, z, pad = 1.5) {
  for (const s of STRUCTURES) {
    const hw = s.hw + pad;
    const hd = s.hd + pad;
    if (x > s.x - hw && x < s.x + hw && z > s.z - hd && z < s.z + hd) return true;
  }
  return false;
}

// =====================================================================
//  Procedural scatter — what nature fills each chunk with. The tree species
//  are chosen by the chunk's COUNTRY (Regions.trees), so each region has a
//  recognisable flora (sakura/pine, palm/banyan, bamboo, oak/cactus, …).
//  Returns: { grass:[], rice:[], trees:[ { type, list:[…] }, … ] }.
// =====================================================================
export function scatterForChunk(cx, cz, prebuilt) {
  const out = { grass: [], rice: [], trees: [] };
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const ccx = baseX + CHUNK_SIZE / 2;
  const ccz = baseZ + CHUNK_SIZE / 2;
  const region = regionAt(ccx, ccz);
  const dens = settlementDensity(ccx, ccz);

  // This chunk's procedural buildings, so trees don't grow inside them. The
  // Chunk passes the list it already built; otherwise compute it (deterministic).
  const builds = prebuilt || buildingsForChunk(cx, cz);
  const inBuilding = (x, z) => {
    for (const b of builds) {
      if (x > b.x - b.hw - 1.5 && x < b.x + b.hw + 1.5 && z > b.z - b.hd - 1.5 && z < b.z + b.hd + 1.5)
        return true;
    }
    return false;
  };

  const place = (rng, count, test, push) => {
    for (let i = 0; i < count; i++) {
      const x = baseX + rng() * CHUNK_SIZE;
      const z = baseZ + rng() * CHUNK_SIZE;
      if (test(x, z)) push(x, z, rng);
    }
  };

  // Grass tufts — cheap ground cover on grass (only built at full LOD, so the
  // count can be generous everywhere).
  const gr = rngFor(cx, cz, 11);
  place(
    gr,
    30,
    (x, z) => surfaceAt(x, z) === Surface.GRASS,
    (x, z, rng) =>
      out.grass.push({ x, z, y: heightAt(x, z), rot: rng() * TAU, scale: 0.7 + rng() * 0.6 })
  );

  // Region trees — denser toward the country's populated core.
  for (const sp of region.trees) {
    const list = [];
    const tr = rngFor(cx, cz, 50 + treeSalt(sp.type));
    const count = sp.density + Math.round(sp.density * dens * 1.5);
    place(
      tr,
      count,
      (x, z) =>
        surfaceAt(x, z) === Surface.GRASS &&
        !blockedByStructure(x, z, 3) &&
        !inBuilding(x, z) &&
        !nearPath(x, z, 1.2),
      (x, z, rng) =>
        list.push({ x, z, y: heightAt(x, z), rot: rng() * TAU, scale: 0.9 + rng() * 0.7 })
    );
    if (list.length) out.trees.push({ type: sp.type, list });
  }

  // Rice tufts in the paddy region (Japan outskirts).
  const rr = rngFor(cx, cz, 41);
  place(
    rr,
    40,
    (x, z) => surfaceAt(x, z) === Surface.PADDY,
    (x, z, rng) => out.rice.push({ x, z, y: 0.02, rot: rng() * TAU, scale: 0.8 + rng() * 0.4 })
  );

  return out;
}

const TREE_SALT = { sakura: 1, pine: 2, palm: 3, banyan: 4, bamboo: 5, oak: 6, cactus: 7 };
function treeSalt(type) {
  return TREE_SALT[type] || 9;
}

// =====================================================================
//  Procedural buildings — fills each country with its own architecture
//  (Indian temples/havelis, Chinese pagodas/walls, US towers/houses, …),
//  deterministically per chunk so the streamed world is stable. The hand-
//  placed Japanese village near the origin is protected by VILLAGE_SUPPRESS_R.
//  Each returned spec doubles as a box collider (see Chunk._addColliders).
// =====================================================================
export const BUILDING_SPECS = {
  jp_minka: { hw: 5, hd: 4, h: 5 },
  jp_pagoda: { hw: 4, hd: 4, h: 13 },
  in_haveli: { hw: 5, hd: 5, h: 7 },
  in_temple: { hw: 4.5, hd: 4.5, h: 13 },
  in_temple_grand: { hw: 8, hd: 8, h: 24 },
  cn_hall: { hw: 6, hd: 4.5, h: 6 },
  cn_wall: { hw: 7, hd: 2.2, h: 5 },
  cn_pagoda: { hw: 4, hd: 4, h: 16 },
  cn_pagoda_grand: { hw: 6, hd: 6, h: 22 },
  us_house: { hw: 4.5, hd: 4, h: 5 },
  us_tower: { hw: 4, hd: 4, h: 34 },
  us_tower_grand: { hw: 6, hd: 6, h: 60 },
  _default: { hw: 4, hd: 4, h: 6 },
};

function makeBuilding(id, style, x, z, rot, regionKey) {
  const spec = BUILDING_SPECS[style] || BUILDING_SPECS._default;
  // 90°/270° turns swap the footprint axes so the box collider stays aligned
  // with the rotated mesh (rot is always a quarter turn, see buildingsForChunk).
  const swap = Math.round(rot / (Math.PI / 2)) % 2 !== 0;
  return {
    id,
    type: 'region_building',
    style,
    region: regionKey,
    x,
    z,
    rot,
    hw: swap ? spec.hd : spec.hw,
    hd: swap ? spec.hw : spec.hd,
    h: spec.h,
    collide: 'box',
  };
}

export function buildingsForChunk(cx, cz) {
  const out = [];
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;
  const rng = rngFor(cx, cz, 777);

  for (let i = 0; i < 3; i++) {
    const x = baseX + rng() * CHUNK_SIZE;
    const z = baseZ + rng() * CHUNK_SIZE;
    const rot = ((rng() * 4) | 0) * (Math.PI / 2); // quarter turns → axis-aligned collider
    if (Math.hypot(x, z) < VILLAGE_SUPPRESS_R) continue; // protect the village
    if (surfaceAt(x, z) !== Surface.GRASS) continue;
    if (nearPath(x, z, 2)) continue;
    if (blockedByStructure(x, z, 3)) continue;
    const dens = settlementDensity(x, z);
    if (rng() > dens * 0.9 + 0.015) continue; // sparser toward the frontier
    const region = regionAt(x, z);
    const style = region.buildings[(rng() * region.buildings.length) | 0];
    out.push(makeBuilding(`b_${cx}_${cz}_${i}`, style, x, z, rot, region.key));
  }

  // Guaranteed landmark in the chunk that owns each region's centre (only if the
  // centre is open grass outside the village — keeps it from clipping anything).
  for (const region of REGIONS) {
    if (!region.landmark) continue;
    const oc = worldToChunk(region.center.x, region.center.z);
    if (oc.cx === cx && oc.cz === cz) {
      const lx = region.center.x, lz = region.center.z;
      if (surfaceAt(lx, lz) !== Surface.GRASS || Math.hypot(lx, lz) < VILLAGE_SUPPRESS_R) continue;
      out.push(makeBuilding(`landmark_${region.key}`, region.landmark, lx, lz, 0, region.key));
    }
  }
  return out;
}

function nearPath(x, z, pad) {
  // cheap: sample a few offsets
  return (
    onPath(x, z) ||
    onPath(x + pad, z) ||
    onPath(x - pad, z) ||
    onPath(x, z + pad) ||
    onPath(x, z - pad)
  );
}

// Clamp helper for chunk indices to the finite grid.
export function chunkInBounds(cx, cz) {
  return cx >= -HALF_GRID && cx < HALF_GRID && cz >= -HALF_GRID && cz < HALF_GRID;
}

export function worldToChunk(x, z) {
  return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
}
