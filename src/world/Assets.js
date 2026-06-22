import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './WorldConfig.js';

// =====================================================================
//  Assets — a singleton library of SHARED, CACHED geometries & materials.
//
//  Buildings and props are built from primitives once and reused. Chunks
//  create lightweight Mesh/InstancedMesh wrappers that point at these
//  shared resources, so streaming a chunk in/out never re-allocates GPU
//  geometry. Only per-chunk-unique data (terrain tiles, instance matrices,
//  the few canvas-textured signs) is disposed when a chunk unloads.
//
//  Convention: every geometry fed to the `world` material carries a baked
//  vertex `color` attribute (toon shading reads vertexColors). All parts of
//  a building are merged into ONE geometry → one draw call per building.
// =====================================================================

// --- low level geometry helpers --------------------------------------
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (rt, rb, h, seg, x = 0, y = 0, z = 0) =>
  new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
const coneG = (r, h, seg, x = 0, y = 0, z = 0) =>
  new THREE.ConeGeometry(r, h, seg).translate(x, y, z);
const sphere = (r, x = 0, y = 0, z = 0) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z);

// Hip/pyramid roof sized to a rectangular footprint, sitting at base y.
function roof(halfW, halfD, h, y, eave = 1.18) {
  const g = new THREE.ConeGeometry(1, h, 4);
  g.rotateY(Math.PI / 4); // align the 4 flat faces with the building walls
  // cone radius 1 → flat-face half-extent ≈ cos45 ≈ 0.707; scale to fit + eave
  const sx = (halfW * eave) / 0.707;
  const sz = (halfD * eave) / 0.707;
  g.scale(sx, 1, sz);
  g.translate(0, y + h / 2, 0);
  return g;
}

function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  // Keep the primitive's uv (consistent across all merged parts) so the world
  // material can carry a detail/bump texture.
  return geo;
}

// Merge a list of {geo,color} into one vertex-coloured BufferGeometry.
// All parts are normalised to NON-indexed first: primitives mix indexed
// (box/cylinder/cone) with non-indexed (icosahedron/sphere), and
// mergeGeometries requires them to match. Non-indexed also gives the
// faceted, flat-shaded low-poly look we want.
function mergeColored(parts) {
  const geos = parts.map((p) => {
    let g = p.geo;
    if (g.index) g = g.toNonIndexed();
    return colored(g, p.color);
  });
  return mergeGeometries(geos, false);
}

class AssetLibrary {
  constructor() {
    // --- toon gradient ramp ---
    const ramp = new Uint8Array([60, 140, 210, 255]);
    const grad = new THREE.DataTexture(ramp, ramp.length, 1, THREE.RedFormat);
    grad.needsUpdate = true;
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    this.gradientMap = grad;

    // --- shared materials ---
    this.mat = {
      world: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad }),
      // terrain gets its own material so it can carry a tiled ground texture
      // independently of buildings/props (which use `world`).
      terrain: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad }),
      water: new THREE.MeshStandardMaterial({
        color: PALETTE.water,
        transparent: true,
        opacity: 0.78,
        roughness: 0.15,
        metalness: 0.0,
      }),
      lantern: new THREE.MeshToonMaterial({
        color: PALETTE.lanternPaper,
        emissive: new THREE.Color(PALETTE.lanternPaper),
        emissiveIntensity: 0.15,
        gradientMap: grad,
      }),
      glass: new THREE.MeshToonMaterial({
        color: 0x9fd0e8,
        emissive: new THREE.Color(0x8fd0ff),
        emissiveIntensity: 0.2,
        gradientMap: grad,
      }),
    };
    // koi-pond water: a SECOND shared water material (Assets-owned, never
    // disposed by chunks) so ponds get the same normal map + night opacity as
    // the river without the chunk disposing the shared river material.
    this.mat.koiWater = this.mat.water.clone();

    // foliage: a sway-shader clone of `world`, used ONLY by the scattered props
    // (trees / grass / rice) so they bend in the wind. Buildings keep `world`
    // (no sway). A single uTime uniform is advanced by tickFoliage() each frame;
    // only the upper part of each instance (local y > 0.6) sways, so trunks +
    // their colliders stay put.
    this.mat.foliage = this.mat.world.clone();
    this._foliageUniforms = null;
    this.mat.foliage.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      this._foliageUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float swayPhase = instanceMatrix[3][0] * 0.4 + instanceMatrix[3][2] * 0.4;
          #else
            float swayPhase = 0.0;
          #endif
          // sway scales with local height: base (trunks, grass roots) stays put,
          // tops bend most — so grass, rice AND tree canopies all sway gently.
          float swayAmt = max(transformed.y, 0.0);
          transformed.x += sin(uTime * 1.6 + swayPhase) * 0.045 * swayAmt;
          transformed.z += cos(uTime * 1.2 + swayPhase) * 0.030 * swayAmt;`
        );
    };
    this.mat.foliage.customProgramCacheKey = () => 'foliage-sway';

    // emissive materials that respond to day/night
    this._emissive = [
      { m: this.mat.lantern, day: 0.12, night: 1.25 },
      { m: this.mat.glass, day: 0.18, night: 1.0 },
    ];

    this._geo = new Map(); // cached merged geometries by key
    this._propGeo = new Map(); // cached instancing geometries by key
  }

  // Lazily build & cache a merged geometry.
  _g(key, factory) {
    let g = this._geo.get(key);
    if (!g) {
      g = factory();
      g.computeVertexNormals();
      this._geo.set(key, g);
    }
    return g;
  }

  // Adopt real textures as they finish loading (all optional / graceful).
  useTextures(lib) {
    lib.onReady('detail', (t) => {
      // bump on buildings/props AND on the terrain (subtle ground relief)
      this.mat.world.bumpMap = t;
      this.mat.world.bumpScale = 0.04;
      this.mat.world.needsUpdate = true;
      this.mat.terrain.bumpMap = t;
      this.mat.terrain.bumpScale = 0.06;
      this.mat.terrain.needsUpdate = true;
      this.mat.foliage.bumpMap = t;
      this.mat.foliage.bumpScale = 0.04;
      this.mat.foliage.needsUpdate = true;
    });
    lib.onReady('grass', (t) => {
      this.mat.terrain.map = t;
      this.mat.terrain.needsUpdate = true;
    });
    lib.onReady('waterNormal', (t) => {
      for (const m of [this.mat.water, this.mat.koiWater]) {
        m.normalMap = t;
        m.normalScale = new THREE.Vector2(0.35, 0.35);
        m.needsUpdate = true;
      }
    });
    lib.onReady('roughness', (t) => {
      for (const m of [this.mat.water, this.mat.koiWater]) {
        m.roughnessMap = t;
        m.needsUpdate = true;
      }
    });
  }

  // Adjust emissive strength: t=0 day, t=1 night.
  setNight(t) {
    for (const e of this._emissive) {
      e.m.emissiveIntensity = THREE.MathUtils.lerp(e.day, e.night, t);
    }
    // water gets a touch darker / more reflective at night (river + koi ponds)
    const op = THREE.MathUtils.lerp(0.78, 0.9, t);
    this.mat.water.opacity = op;
    this.mat.koiWater.opacity = op;
  }

  // Advance the foliage wind-sway clock (call once per frame from Game).
  tickFoliage(dt) {
    if (this._foliageUniforms) this._foliageUniforms.uTime.value += dt;
  }

  // ===================================================================
  //  Instancing geometries for scattered props (trees, grass, rice)
  //  lod: 0 = full, 1 = cheap.
  // ===================================================================
  propGeometry(type, lod = 0) {
    const key = `${type}:${lod}`;
    let g = this._propGeo.get(key);
    if (g) return g;
    g = this._buildProp(type, lod);
    g.computeVertexNormals();
    this._propGeo.set(key, g);
    return g;
  }

  _buildProp(type, lod) {
    switch (type) {
      case 'sakura': {
        const parts = [{ geo: cyl(0.18, 0.28, 2.4, 5, 0, 1.2, 0), color: PALETTE.trunk }];
        if (lod === 0) {
          parts.push(
            { geo: sphere(1.5, 0, 3.2, 0), color: PALETTE.sakuraPink },
            { geo: sphere(1.1, 1.0, 2.7, 0.4), color: PALETTE.sakuraDeep },
            { geo: sphere(1.1, -0.9, 2.8, -0.3), color: PALETTE.sakuraPink },
            { geo: sphere(1.0, 0.2, 3.9, 0.6), color: PALETTE.sakuraDeep }
          );
        } else {
          parts.push({ geo: sphere(1.7, 0, 3.3, 0), color: PALETTE.sakuraPink });
        }
        return mergeColored(parts);
      }
      case 'pine': {
        const parts = [{ geo: cyl(0.16, 0.26, 2.0, 5, 0, 1.0, 0), color: PALETTE.trunk }];
        if (lod === 0) {
          parts.push(
            { geo: coneG(1.5, 2.2, 6, 0, 2.4, 0), color: PALETTE.pine },
            { geo: coneG(1.15, 1.8, 6, 0, 3.6, 0), color: PALETTE.pine },
            { geo: coneG(0.8, 1.4, 6, 0, 4.7, 0), color: PALETTE.pine }
          );
        } else {
          parts.push({ geo: coneG(1.6, 3.6, 5, 0, 3.0, 0), color: PALETTE.pine });
        }
        return mergeColored(parts);
      }
      case 'grass': {
        const blade = (a, c) => {
          const g = coneG(0.09, 0.55, 3, 0, 0.27, 0);
          g.rotateZ(a);
          return { geo: g, color: c };
        };
        return mergeColored([
          blade(0.15, 0x6f8f4a),
          blade(-0.2, 0x86a05a),
          blade(0.02, 0x5f7d3e),
        ]);
      }
      case 'rice': {
        const stalk = (dx, dz, c) => {
          const g = coneG(0.05, 0.7, 3, dx, 0.35, dz);
          return { geo: g, color: c };
        };
        return mergeColored([
          stalk(0, 0, 0xb9c46a),
          stalk(0.12, 0.1, 0xc9d27a),
          stalk(-0.1, 0.08, 0xa7b35e),
        ]);
      }
      // --- region flora ------------------------------------------------
      case 'palm': {
        const parts = [{ geo: cyl(0.14, 0.24, 4.4, 6, 0, 2.2, 0), color: 0xa07e4d }];
        if (lod === 0) {
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2;
            const fr = coneG(0.32, 2.6, 4);
            fr.rotateZ(Math.PI * 0.5);
            fr.rotateY(a);
            fr.translate(Math.cos(a) * 1.2, 4.3, Math.sin(a) * 1.2);
            parts.push({ geo: fr, color: 0x3f8a48 });
          }
        } else {
          parts.push({ geo: sphere(1.4, 0, 4.4, 0), color: 0x3f8a48 });
        }
        return mergeColored(parts);
      }
      case 'banyan': {
        const parts = [{ geo: cyl(0.45, 0.7, 2.6, 7, 0, 1.3, 0), color: 0x6b4a30 }];
        // aerial roots
        for (const dx of [-1.1, 1.0]) parts.push({ geo: cyl(0.1, 0.12, 2.2, 4, dx, 1.1, 0.3), color: 0x6b4a30 });
        if (lod === 0) {
          parts.push(
            { geo: sphere(2.0, 0, 3.6, 0), color: 0x35642f },
            { geo: sphere(1.5, 1.6, 3.2, 0.5), color: 0x3f7237 },
            { geo: sphere(1.5, -1.5, 3.3, -0.4), color: 0x2f5a2a },
            { geo: sphere(1.3, 0.3, 4.4, 1.2), color: 0x3f7237 }
          );
        } else parts.push({ geo: sphere(2.4, 0, 3.8, 0), color: 0x35642f });
        return mergeColored(parts);
      }
      case 'bamboo': {
        const parts = [];
        const culms = [[-0.25, -0.1, 4.2], [0.22, 0.15, 4.8], [0.02, -0.28, 3.8], [0.32, -0.16, 4.4], [-0.18, 0.27, 4.0]];
        for (const [dx, dz, h] of culms) {
          parts.push({ geo: cyl(0.07, 0.09, h, 5, dx, h / 2, dz), color: 0x5f8f3a });
          if (lod === 0) parts.push({ geo: sphere(0.3, dx, h - 0.2, dz), color: 0x7cae5a });
        }
        return mergeColored(parts);
      }
      case 'oak': {
        const parts = [{ geo: cyl(0.3, 0.46, 2.6, 6, 0, 1.3, 0), color: 0x5b4128 }];
        if (lod === 0) {
          parts.push(
            { geo: sphere(1.8, 0, 3.6, 0), color: 0x4f7b3e },
            { geo: sphere(1.3, 1.3, 3.2, 0.3), color: 0x5a8a48 },
            { geo: sphere(1.3, -1.2, 3.3, -0.4), color: 0x456f37 },
            { geo: sphere(1.1, 0.2, 4.4, 0.6), color: 0x5a8a48 }
          );
        } else parts.push({ geo: sphere(2.1, 0, 3.8, 0), color: 0x4f7b3e });
        return mergeColored(parts);
      }
      case 'cactus': {
        const parts = [{ geo: cyl(0.42, 0.5, 3.8, 8, 0, 1.9, 0), color: 0x4f7b46 }];
        // two arms
        parts.push({ geo: cyl(0.18, 0.2, 1.0, 6, 0.7, 2.0, 0), color: 0x4f7b46 }); // right elbow
        parts.push({ geo: cyl(0.18, 0.2, 1.4, 6, 1.1, 2.6, 0), color: 0x4f7b46 }); // right arm
        parts.push({ geo: cyl(0.18, 0.2, 1.2, 6, -0.7, 1.7, 0), color: 0x4f7b46 }); // left elbow
        parts.push({ geo: cyl(0.18, 0.2, 1.2, 6, -1.1, 2.2, 0), color: 0x4f7b46 }); // left arm
        return mergeColored(parts);
      }
      default:
        return colored(box(1, 1, 1), 0xff00ff);
    }
  }

  // ===================================================================
  //  Structures — return a fresh lightweight Object3D each call, but the
  //  heavy merged geometry is cached & shared. Built at local origin with
  //  base on the ground (y=0). Caller positions/rotates the group.
  // ===================================================================
  buildStructure(s) {
    switch (s.type) {
      case 'machiya':
        return this._house('machiya', PALETTE.plaster, PALETTE.tileRoof, PALETTE.noren);
      case 'ramen':
        return this._shop('ramen', PALETTE.wood, PALETTE.roofRed, PALETTE.lanternRed, true);
      case 'teahouse':
        return this._teahouse();
      case 'shrine':
        return this._shrine();
      case 'torii':
        return this._torii();
      case 'pagoda':
        return this._pagoda();
      case 'bridge':
        return this._bridge();
      case 'toro':
        return this._toro();
      case 'lantern_pole':
        return this._lanternPole();
      case 'vending':
        return this._vending();
      case 'stall':
        return this._stall();
      case 'koi':
        return this._koiPond();
      case 'bonsai':
        return this._bonsai();
      case 'sign':
        return this._sign(s.text || '');
      default:
        return this._mesh(this._g('fallback', () => colored(box(2, 2, 2, 0, 1, 0), 0xff00ff)));
    }
  }

  // ===================================================================
  //  Region buildings — recognisable per-country architecture. Each style's
  //  merged geometry is cached & shared (one draw call per building); the
  //  generator (WorldConfig.buildingsForChunk) places & rotates instances.
  // ===================================================================
  buildRegionStructure(s) {
    switch (s.style) {
      case 'jp_minka': return this._minka();
      case 'jp_pagoda': return this._pagodaTiers('jp_pagoda', 3, 4.5, PALETTE.wood, PALETTE.tileRoof);
      case 'in_haveli': return this._haveli();
      case 'in_temple': return this._hinduTemple('in_temple', false);
      case 'in_temple_grand': return this._hinduTemple('in_temple_grand', true);
      case 'cn_hall': return this._chHall();
      case 'cn_wall': return this._wallSeg();
      case 'cn_pagoda': return this._pagodaTiers('cn_pagoda', 4, 4.5, 0xb5413a, 0x2f6b3f);
      case 'cn_pagoda_grand': return this._pagodaTiers('cn_pagoda_grand', 6, 6, 0xb5413a, 0x2f6b3f);
      case 'us_house': return this._usHouse();
      case 'us_tower': return this._usTower('us_tower', 34, false);
      case 'us_tower_grand': return this._usTower('us_tower_grand', 60, true);
      default:
        return this._mesh(this._g('rb:fallback', () => colored(box(6, 6, 6, 0, 3, 0), 0xff00ff)));
    }
  }

  // --- Japan: rural farmhouse (minka) --------------------------------
  _minka() {
    const W = 10, D = 8, H = 3.4;
    const geo = this._g('jp_minka', () => {
      const parts = [];
      parts.push({ geo: box(W, 0.4, D, 0, 0.2, 0), color: PALETTE.stoneDark });
      parts.push({ geo: box(W, H, D, 0, H / 2 + 0.2, 0), color: PALETTE.plaster });
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        parts.push({ geo: box(0.4, H, 0.4, (sx * W) / 2, H / 2 + 0.2, (sz * D) / 2), color: PALETTE.woodDark });
      parts.push({ geo: box(W + 0.3, 0.4, D + 0.3, 0, H + 0.2, 0), color: PALETTE.woodDark });
      parts.push({ geo: box(2.2, 2.4, 0.2, 0, 1.4, -D / 2 - 0.02), color: PALETTE.woodDark });
      for (const sx of [-3, 3]) parts.push({ geo: box(1.6, 1.2, 0.12, sx, 2.1, -D / 2 - 0.02), color: PALETTE.woodLight });
      parts.push({ geo: roof(W / 2, D / 2, 2.8, H + 0.2, 1.45), color: 0x6b5a3a }); // steep thatch
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  // --- shared tiered pagoda (Japan + China) --------------------------
  _pagodaTiers(key, tiers, baseW, bodyColor, roofColor) {
    const geo = this._g(key, () => {
      const parts = [];
      let y = 0.8, w = baseW;
      parts.push({ geo: box(w + 1, 0.8, w + 1, 0, 0.4, 0), color: PALETTE.stone });
      for (let t = 0; t < tiers; t++) {
        const h = 2.6 - t * 0.2;
        parts.push({ geo: box(w, h, w, 0, y + h / 2, 0), color: bodyColor });
        parts.push({ geo: roof(w / 2, w / 2, 1.2, y + h, 1.55), color: roofColor });
        y += h + 0.8;
        w *= 0.82;
      }
      parts.push({ geo: cyl(0.13, 0.18, 2.2, 6, 0, y + 0.9, 0), color: PALETTE.gold });
      parts.push({ geo: sphere(0.35, 0, y + 2.1, 0), color: PALETTE.gold });
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  // --- India: Hindu temple (shikhara tower) --------------------------
  _hinduTemple(key, grand) {
    const s = grand ? 1.7 : 1.0;
    const sand = 0xe3c89c, trim = 0xb5723a;
    const geo = this._g(key, () => {
      const parts = [];
      const baseW = 7 * s;
      parts.push({ geo: box(baseW + 1.5, 1.2, baseW + 1.5, 0, 0.6, 0), color: PALETTE.stone });
      parts.push({ geo: box(baseW, 3.2 * s, baseW, 0, 0.6 + 1.6 * s, 0), color: sand });
      let y = 0.6 + 3.2 * s, w = baseW * 0.92;
      const layers = grand ? 9 : 7;
      for (let i = 0; i < layers; i++) {
        const h = 0.9 * s;
        parts.push({ geo: box(w, h, w, 0, y + h / 2, 0), color: i % 2 ? sand : trim });
        y += h;
        w *= 0.86;
      }
      parts.push({ geo: sphere(0.5 * s, 0, y + 0.4 * s, 0), color: PALETTE.gold });
      parts.push({ geo: box(1.6 * s, 2.4 * s, 0.3, 0, 1.2 * s, -baseW / 2 - 0.02), color: trim });
      if (grand) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          let yy = 0.6 + 3.2 * s, ww = 2.2;
          for (let i = 0; i < 5; i++) {
            const h = 0.7;
            parts.push({ geo: box(ww, h, ww, sx * baseW * 0.42, yy + h / 2, sz * baseW * 0.42), color: i % 2 ? sand : trim });
            yy += h;
            ww *= 0.82;
          }
        }
      }
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  // --- India: haveli (ornate two-storey mansion) ---------------------
  _haveli() {
    const W = 10, D = 10, H = 6;
    const sand = 0xe3c89c, trim = 0xb5723a, dome = 0xd9b24a;
    const geo = this._g('in_haveli', () => {
      const parts = [];
      parts.push({ geo: box(W + 1, 0.5, D + 1, 0, 0.25, 0), color: PALETTE.stone });
      parts.push({ geo: box(W, H, D, 0, H / 2 + 0.25, 0), color: sand });
      parts.push({ geo: box(W + 0.4, 0.4, D + 0.4, 0, H * 0.55, 0), color: trim }); // floor band
      // arched windows (recessed) on the front, both storeys
      for (const sy of [H * 0.3, H * 0.72]) for (const sx of [-3, 0, 3])
        parts.push({ geo: box(1.4, 1.8, 0.2, sx, sy, -D / 2 - 0.02), color: 0x6b4a30 });
      // parapet (front + back, then left + right)
      for (const sz of [-1, 1]) parts.push({ geo: box(W + 0.6, 0.8, 0.4, 0, H + 0.6, (sz * D) / 2), color: trim });
      for (const sx of [-1, 1]) parts.push({ geo: box(0.4, 0.8, D + 0.6, (sx * W) / 2, H + 0.6, 0), color: trim });
      // corner chhatri domes
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        parts.push({ geo: cyl(0.6, 0.7, 0.8, 8, (sx * W) / 2, H + 1.2, (sz * D) / 2), color: sand });
        parts.push({ geo: sphere(0.7, (sx * W) / 2, H + 1.9, (sz * D) / 2), color: dome });
      }
      // central dome
      parts.push({ geo: cyl(1.3, 1.5, 0.6, 10, 0, H + 0.9, 0), color: sand });
      parts.push({ geo: sphere(1.4, 0, H + 2.0, 0), color: dome });
      parts.push({ geo: box(1.8, 2.6, 0.3, 0, 1.3, -D / 2 - 0.04), color: trim }); // door
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  // --- China: pillared hall with sweeping roof ------------------------
  _chHall() {
    const W = 12, D = 9, H = 4;
    const red = 0xb5413a, green = 0x2f6b3f, gold = 0xd8b24a;
    const geo = this._g('cn_hall', () => {
      const parts = [];
      parts.push({ geo: box(W + 2, 0.8, D + 2, 0, 0.4, 0), color: PALETTE.stone });
      parts.push({ geo: box(W, H, D, 0, H / 2 + 0.8, 0), color: 0xeae0cf });
      for (const sx of [-1, -0.33, 0.33, 1]) // red columns across the front
        parts.push({ geo: cyl(0.35, 0.4, H, 8, sx * (W / 2 - 0.6), H / 2 + 0.8, -D / 2 + 0.3), color: red });
      // big upturned double roof
      parts.push({ geo: roof(W / 2, D / 2, 2.4, H + 0.8, 1.65), color: green });
      parts.push({ geo: roof(W / 2.6, D / 2.6, 1.6, H + 3.0, 1.5), color: green });
      parts.push({ geo: box(W * 1.7, 0.4, 0.4, 0, H + 1.0, 0), color: gold }); // ridge
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  // --- China: Great Wall segment -------------------------------------
  _wallSeg() {
    const W = 14, D = 3.2, H = 4;
    const stone = 0x9c8f72, dark = 0x6f6c64;
    const geo = this._g('cn_wall', () => {
      const parts = [];
      parts.push({ geo: box(W, H, D, 0, H / 2, 0), color: stone });
      parts.push({ geo: box(W, 0.3, D + 0.4, 0, H + 0.15, 0), color: dark }); // walkway cap
      // crenellations (merlons) along both top edges
      for (const sz of [-1, 1])
        for (let i = -3; i <= 3; i++)
          parts.push({ geo: box(1.0, 0.7, 0.4, i * 2.0, H + 0.65, (sz * D) / 2), color: stone });
      // a watchtower bump in the middle
      parts.push({ geo: box(3.4, H + 2.2, D + 1.2, 0, (H + 2.2) / 2, 0), color: stone });
      parts.push({ geo: roof(2.1, (D + 1.2) / 2, 1.0, H + 2.2, 1.2), color: dark });
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  // --- USA: suburban house -------------------------------------------
  _usHouse() {
    const W = 9, D = 8, H = 3;
    const siding = 0xb7c4cf, roofC = 0x5a4a42, trim = 0xf2efe6;
    const geo = this._g('us_house', () => {
      const parts = [];
      parts.push({ geo: box(W, 0.4, D, 0, 0.2, 0), color: PALETTE.stoneDark });
      parts.push({ geo: box(W, H, D, 0, H / 2 + 0.2, 0), color: siding });
      parts.push({ geo: roof(W / 2, D / 2, 2.2, H + 0.2, 1.2), color: roofC });
      parts.push({ geo: box(1.4, 2.2, 0.2, -2.2, 1.3, -D / 2 - 0.02), color: 0x6b4a30 }); // door
      parts.push({ geo: box(3.0, 2.2, 0.2, 1.8, 1.3, -D / 2 - 0.02), color: trim }); // garage
      for (const sx of [-2.2, 1.8]) parts.push({ geo: box(1.2, 1.0, 0.15, sx, H * 0.75 + 0.2, -D / 2 - 0.02), color: 0x9fd0e8 }); // windows
      parts.push({ geo: box(0.7, 1.6, 0.7, W / 2 - 1.2, H + 1.2, 1.5), color: 0x8a6a55 }); // chimney
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  // --- USA: glass skyscraper -----------------------------------------
  _usTower(key, H, grand) {
    const concrete = 0x9aa0a8, dark = 0x4a525c;
    const geo = this._g(key, () => {
      const parts = [];
      const W = grand ? 12 : 8;
      parts.push({ geo: box(W + 1, 0.6, W + 1, 0, 0.3, 0), color: dark });
      let y = 0.6, w = W;
      const floors = Math.floor(H / 2.0);
      for (let f = 0; f < floors; f++) {
        if (grand && f > 0 && f % 7 === 0) w *= 0.84; // setbacks
        parts.push({ geo: box(w, 0.4, w, 0, y + 0.2, 0), color: concrete }); // slab
        parts.push({ geo: box(w - 0.4, 1.5, w - 0.4, 0, y + 1.2, 0), color: f % 2 ? 0x6f9fc8 : 0x5a86a8 }); // glass band
        y += 2.0;
      }
      parts.push({ geo: box(w * 0.5, 1.0, w * 0.5, 0, y + 0.5, 0), color: dark }); // rooftop plant
      if (grand) parts.push({ geo: cyl(0.12, 0.12, 8, 5, 0, y + 5, 0), color: 0xd8d8d8 }); // antenna mast
      return mergeColored(parts);
    });
    const g = new THREE.Group();
    g.add(this._mesh(geo));
    return g;
  }

  _mesh(geo, mat = this.mat.world) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  _house(key, wallColor, roofColor, norenColor) {
    const W = 12, D = 10, H = 5.5;
    const geo = this._g(key, () => {
      const parts = [];
      // plaster body
      parts.push({ geo: box(W, H, D, 0, H / 2, 0), color: wallColor });
      // wood sill + corner posts + door frame
      parts.push({ geo: box(W + 0.4, 0.5, D + 0.4, 0, 0.25, 0), color: PALETTE.woodDark });
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          parts.push({
            geo: box(0.5, H, 0.5, (sx * W) / 2, H / 2, (sz * D) / 2),
            color: PALETTE.wood,
          });
      // upper beam
      parts.push({ geo: box(W + 0.3, 0.5, D + 0.3, 0, H, 0), color: PALETTE.woodDark });
      // lattice windows
      for (const sx of [-3, 3])
        parts.push({ geo: box(2.2, 1.6, 0.15, sx, H * 0.55, -D / 2 - 0.02), color: PALETTE.woodLight });
      // doorway recess
      parts.push({ geo: box(2.4, 3, 0.3, 0, 1.5, -D / 2 - 0.05), color: PALETTE.woodDark });
      // roof (two-tier hip)
      parts.push({ geo: roof(W / 2, D / 2, 3.2, H, 1.25), color: roofColor });
      parts.push({ geo: box(W * 1.18, 0.35, D * 1.18, 0, H + 0.1, 0), color: PALETTE.woodDark });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    // noren curtain (separate, slight different colour) over the door
    group.add(this._mesh(this._g(key + ':noren', () =>
      mergeColored([{ geo: box(2.6, 1.0, 0.05, 0, 2.9, -D / 2 - 0.22), color: norenColor }])
    )));
    return group;
  }

  _shop(key, wallColor, roofColor, lanternColor, lanterns) {
    const W = 15, D = 11, H = 5;
    const geo = this._g(key, () => {
      const parts = [];
      parts.push({ geo: box(W, H, D, 0, H / 2, 0), color: wallColor });
      parts.push({ geo: box(W + 0.4, 0.5, D + 0.4, 0, 0.25, 0), color: PALETTE.woodDark });
      // open shop front beam
      parts.push({ geo: box(W, 0.6, 0.4, 0, H - 0.6, -D / 2 - 0.1), color: PALETTE.woodDark });
      // counter hint at front
      parts.push({ geo: box(W - 1, 1.0, 0.6, 0, 0.6, -D / 2 + 0.2), color: PALETTE.woodLight });
      parts.push({ geo: roof(W / 2, D / 2, 2.6, H, 1.2), color: roofColor });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    // red noren across the front
    group.add(this._mesh(this._g(key + ':noren', () =>
      mergeColored([
        { geo: box(W - 1, 1.2, 0.05, 0, H - 1.4, -D / 2 - 0.15), color: PALETTE.lanternRed },
        { geo: box(0.12, 1.2, 0.12, -2, H - 1.4, -D / 2 - 0.15), color: PALETTE.paper },
      ])
    )));
    if (lanterns) {
      for (const sx of [-W / 2 + 1, W / 2 - 1]) {
        const lant = this._mesh(
          this._g('shoplantern', () =>
            mergeColored([{ geo: cyl(0.5, 0.5, 1.0, 8, 0, 0, 0), color: lanternColor }])
          ),
          this.mat.lantern
        );
        lant.material = this.mat.lantern;
        lant.position.set(sx, H - 1.2, -D / 2 - 0.4);
        group.add(lant);
      }
    }
    return group;
  }

  _teahouse() {
    const W = 14, D = 12, H = 4.5;
    const geo = this._g('teahouse', () => {
      const parts = [];
      parts.push({ geo: box(W, H, D, 0, H / 2 + 0.4, 0), color: PALETTE.plaster });
      // engawa (raised veranda) platform
      parts.push({ geo: box(W + 2.5, 0.8, D + 2.5, 0, 0.4, 0), color: PALETTE.wood });
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          parts.push({
            geo: box(0.4, H, 0.4, (sx * W) / 2, H / 2 + 0.4, (sz * D) / 2),
            color: PALETTE.woodDark,
          });
      // shoji panels
      for (const sx of [-3.5, 0, 3.5])
        parts.push({ geo: box(2.6, 2.4, 0.1, sx, H * 0.55, -D / 2 - 0.06), color: PALETTE.shojiPaper });
      parts.push({ geo: roof(W / 2, D / 2, 2.8, H + 0.4, 1.3), color: PALETTE.tileRoof });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    return group;
  }

  _shrine() {
    const W = 18, D = 14, H = 7;
    const geo = this._g('shrine', () => {
      const parts = [];
      // stone base / platform
      parts.push({ geo: box(W + 3, 1.4, D + 3, 0, 0.7, 0), color: PALETTE.stone });
      // vermilion hall
      parts.push({ geo: box(W, H, D, 0, H / 2 + 1.4, 0), color: PALETTE.roofRed });
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          parts.push({
            geo: cyl(0.5, 0.5, H, 8, (sx * W) / 2, H / 2 + 1.4, (sz * D) / 2),
            color: PALETTE.torii,
          });
      // big upturned roof (two stacked cones for a layered look)
      parts.push({ geo: roof(W / 2, D / 2, 3.6, H + 1.4, 1.5), color: PALETTE.tileRoof });
      parts.push({ geo: roof(W / 2.4, D / 2.4, 2.0, H + 4.0, 1.4), color: PALETTE.tileRoof });
      // gold ridge ornament
      parts.push({ geo: box(W * 1.5, 0.4, 0.4, 0, H + 1.6, 0), color: PALETTE.gold });
      // entrance steps
      parts.push({ geo: box(8, 0.5, 2, 0, 1.4, -D / 2 - 1), color: PALETTE.stoneDark });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    // two hanging lanterns at the entrance
    for (const sx of [-3, 3]) {
      const lant = new THREE.Mesh(
        this._g('shrinelantern', () =>
          mergeColored([{ geo: sphere(0.6, 0, 0, 0), color: PALETTE.lanternPaper }])
        ),
        this.mat.lantern
      );
      lant.position.set(sx, 5.5, -D / 2 - 0.5);
      group.add(lant);
    }
    return group;
  }

  _torii() {
    const geo = this._g('torii', () => {
      const parts = [];
      const H = 9, span = 9;
      for (const sx of [-1, 1])
        parts.push({ geo: cyl(0.45, 0.55, H, 8, (sx * span) / 2, H / 2, 0), color: PALETTE.torii });
      // top beam (kasagi) — slightly wider, with a small upward tilt feel
      parts.push({ geo: box(span + 3, 0.8, 1.4, 0, H, 0), color: PALETTE.torii });
      parts.push({ geo: box(span + 4, 0.5, 1.0, 0, H + 0.7, 0), color: 0x8f241d });
      // second beam (nuki)
      parts.push({ geo: box(span + 1, 0.6, 0.9, 0, H - 1.8, 0), color: PALETTE.torii });
      // center plaque
      parts.push({ geo: box(1.2, 1.2, 0.3, 0, H - 1.0, 0), color: PALETTE.woodDark });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    return group;
  }

  _pagoda() {
    const geo = this._g('pagoda', () => {
      const parts = [];
      let y = 0;
      let w = 5;
      parts.push({ geo: box(w + 1, 0.8, w + 1, 0, 0.4, 0), color: PALETTE.stone });
      y = 0.8;
      for (let tier = 0; tier < 5; tier++) {
        const h = 3 - tier * 0.25;
        parts.push({ geo: box(w, h, w, 0, y + h / 2, 0), color: PALETTE.wood });
        parts.push({ geo: roof(w / 2, w / 2, 1.3, y + h, 1.5), color: PALETTE.tileRoof });
        y += h + 0.9;
        w *= 0.82;
      }
      // finial
      parts.push({ geo: cyl(0.15, 0.2, 2.5, 6, 0, y + 1.0, 0), color: PALETTE.gold });
      parts.push({ geo: sphere(0.4, 0, y + 2.4, 0), color: PALETTE.gold });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    return group;
  }

  _bridge() {
    const geo = this._g('bridge', () => {
      const parts = [];
      const span = 26, w = 5;
      // arched deck: segments with a slight rise
      const segs = 9;
      for (let i = 0; i < segs; i++) {
        const t = i / (segs - 1);
        const x = (t - 0.5) * span;
        const rise = Math.sin(t * Math.PI) * 1.6; // arch height
        parts.push({ geo: box(span / segs + 0.2, 0.4, w, x, 0.25 + rise, 0), color: PALETTE.wood });
      }
      // railings
      for (const sz of [-1, 1]) {
        for (let i = 0; i < segs; i++) {
          const t = i / (segs - 1);
          const x = (t - 0.5) * span;
          const rise = Math.sin(t * Math.PI) * 1.6;
          parts.push({ geo: box(0.25, 1.0, 0.25, x, 0.9 + rise, (sz * w) / 2), color: PALETTE.woodDark });
        }
        parts.push({ geo: box(span, 0.2, 0.2, 0, 1.7, (sz * w) / 2), color: PALETTE.torii });
      }
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    return group;
  }

  _toro() {
    const geo = this._g('toro', () => {
      const parts = [];
      parts.push({ geo: cyl(0.5, 0.6, 0.4, 6, 0, 0.2, 0), color: PALETTE.stoneDark });
      parts.push({ geo: cyl(0.2, 0.2, 0.9, 6, 0, 0.85, 0), color: PALETTE.stone });
      parts.push({ geo: box(0.7, 0.6, 0.7, 0, 1.5, 0), color: PALETTE.stone });
      parts.push({ geo: coneG(0.7, 0.5, 4, 0, 2.05, 0), color: PALETTE.stoneDark });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    // emissive light box
    const light = new THREE.Mesh(
      this._g('toro:light', () => mergeColored([{ geo: box(0.4, 0.4, 0.4, 0, 1.5, 0), color: PALETTE.lanternPaper }])),
      this.mat.lantern
    );
    group.add(light);
    return group;
  }

  _lanternPole() {
    const geo = this._g('pole', () => {
      const parts = [];
      parts.push({ geo: cyl(0.12, 0.15, 3.4, 6, 0, 1.7, 0), color: PALETTE.woodDark });
      parts.push({ geo: box(1.4, 0.12, 0.12, 0.5, 3.3, 0), color: PALETTE.woodDark });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    const lant = new THREE.Mesh(
      this._g('pole:lantern', () =>
        mergeColored([{ geo: cyl(0.32, 0.32, 0.7, 8, 0, 0, 0), color: PALETTE.lanternRed }])
      ),
      this.mat.lantern
    );
    lant.position.set(1.1, 3.0, 0);
    group.add(lant);
    return group;
  }

  _vending() {
    const geo = this._g('vending', () => {
      const parts = [];
      parts.push({ geo: box(2.2, 1.9, 1.2, 0, 0.95, 0), color: 0xb33b3b });
      parts.push({ geo: box(2.0, 0.4, 1.22, 0, 1.6, 0), color: PALETTE.woodDark });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    // glowing front panel
    const panel = new THREE.Mesh(
      this._g('vending:panel', () => mergeColored([{ geo: box(1.7, 1.0, 0.05, 0, 0.95, -0.62), color: 0xbfe6ff }])),
      this.mat.glass
    );
    group.add(panel);
    return group;
  }

  _stall() {
    const geo = this._g('stall', () => {
      const parts = [];
      const W = 4.4, D = 2.8;
      parts.push({ geo: box(W, 1.0, D, 0, 0.5, 0), color: PALETTE.woodLight }); // counter
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          parts.push({ geo: box(0.18, 2.6, 0.18, (sx * W) / 2, 1.3, (sz * D) / 2), color: PALETTE.woodDark });
      // striped awning
      parts.push({ geo: box(W + 0.8, 0.2, D + 0.8, 0, 2.7, 0), color: PALETTE.lanternRed });
      parts.push({ geo: box(W + 0.8, 0.21, 0.5, 0, 2.72, -D / 2), color: PALETTE.paper });
      // goods
      for (let i = -1; i <= 1; i++)
        parts.push({ geo: sphere(0.3, i * 1.2, 1.2, 0), color: 0xe6b34a });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    return group;
  }

  _koiPond() {
    const geo = this._g('koi:stone', () => {
      const parts = [];
      parts.push({ geo: cyl(6, 6.4, 0.6, 16, 0, 0.1, 0), color: PALETTE.stoneDark });
      // a few stones around the rim
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push({ geo: sphere(0.5, Math.cos(a) * 5.6, 0.4, Math.sin(a) * 5.6), color: PALETTE.stone });
      }
      // koi fish
      for (const [fx, fz, c] of [[-1.5, 1, PALETTE.koi], [1.8, -0.6, 0xf4f0e8], [0.4, 1.8, PALETTE.koi]]) {
        const f = sphere(0.45, fx, 0.45, fz);
        f.scale(1.6, 0.4, 0.7);
        parts.push({ geo: f, color: c });
      }
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    // Unique geometry but a SHARED (Assets-owned) koi-water material, so the
    // chunk disposes only the geometry ('geo') — the material keeps receiving
    // the water normal map + night opacity like the river.
    const water = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.2, 16), this.mat.koiWater);
    water.position.y = 0.42;
    water.userData.disposable = 'geo';
    group.add(water);
    return group;
  }

  _bonsai() {
    const geo = this._g('bonsai', () => {
      const parts = [];
      parts.push({ geo: cyl(0.45, 0.4, 0.4, 8, 0, 0.2, 0), color: 0x7a4b3a }); // pot
      parts.push({ geo: cyl(0.1, 0.13, 0.6, 5, 0, 0.7, 0), color: PALETTE.trunk });
      parts.push({ geo: sphere(0.55, 0, 1.1, 0), color: PALETTE.pine });
      parts.push({ geo: sphere(0.35, 0.35, 0.95, 0.1), color: 0x4f7b56 });
      return mergeColored(parts);
    });
    const group = new THREE.Group();
    group.add(this._mesh(geo));
    return group;
  }

  // Signs use a CanvasTexture → unique, must be disposed on unload.
  _sign(text) {
    const group = new THREE.Group();
    // post (shared)
    group.add(
      this._mesh(
        this._g('sign:post', () =>
          mergeColored([{ geo: cyl(0.12, 0.14, 2.2, 6, 0, 1.1, 0), color: PALETTE.woodDark }])
        )
      )
    );
    // board (unique canvas texture)
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#7a5230';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#f3ece0';
    ctx.fillRect(8, 8, 240, 112);
    ctx.fillStyle = '#1a1310';
    ctx.font = 'bold 64px "Hiragino Sans","Yu Gothic",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 70);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const boardMat = new THREE.MeshToonMaterial({ map: tex, gradientMap: this.gradientMap });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.1), boardMat);
    board.position.set(0, 1.7, 0);
    board.userData.disposable = true; // unique geo+mat+texture
    group.add(board);
    return group;
  }

  // Full teardown (only on game shutdown — never during streaming).
  dispose() {
    for (const g of this._geo.values()) g.dispose();
    for (const g of this._propGeo.values()) g.dispose();
    for (const k of Object.keys(this.mat)) this.mat[k].dispose();
    this.gradientMap.dispose();
    this._geo.clear();
    this._propGeo.clear();
  }
}

// Singleton
export const Assets = new AssetLibrary();
