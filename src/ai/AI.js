// =====================================================================
//  AI — the actual game algorithms shared by enemies & bosses.
//
//    • astar()        A* on a coarse, on-demand nav grid (ground pathfinding
//                     around buildings). Bounded search window + node cap so a
//                     single path is always cheap; returns a simplified list of
//                     world-space waypoints (or the best partial path).
//    • lineOfSight()  ray-march a passability test between two points.
//    • seek/separate  classic steering primitives.
//    • flock()        boids (separation / alignment / cohesion) for flyers.
//
//  Everything operates on plain {x,z}/{x,y,z} numbers + callbacks so it is
//  engine-agnostic and unit-testable without a scene.
// =====================================================================

// --- a tiny binary min-heap keyed by priority -----------------------
class MinHeap {
  constructor() {
    this.items = [];
    this.prio = [];
  }
  get size() {
    return this.items.length;
  }
  push(item, p) {
    const it = this.items,
      pr = this.prio;
    it.push(item);
    pr.push(p);
    let i = it.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [pr[parent], pr[i]] = [pr[i], pr[parent]];
      [it[parent], it[i]] = [it[i], it[parent]];
      i = parent;
    }
  }
  pop() {
    const it = this.items,
      pr = this.prio;
    const top = it[0];
    const last = it.length - 1;
    it[0] = it[last];
    pr[0] = pr[last];
    it.pop();
    pr.pop();
    let i = 0;
    const n = it.length;
    while (true) {
      const l = 2 * i + 1,
        r = 2 * i + 2;
      let s = i;
      if (l < n && pr[l] < pr[s]) s = l;
      if (r < n && pr[r] < pr[s]) s = r;
      if (s === i) break;
      [pr[s], pr[i]] = [pr[i], pr[s]];
      [it[s], it[i]] = [it[i], it[s]];
      i = s;
    }
    return top;
  }
}

function octile(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx),
    dz = Math.abs(az - bz);
  return dx + dz + (1.4142 - 2) * Math.min(dx, dz);
}

// Grid-cell key packing. Cells stay small (world ≤ ±960, cell ≥ 2 → |idx| ≤ ~480),
// so (idx + OFF) is always positive and the packing is collision-free + reversible.
const KEY_OFF = 8192;
const KEY_MUL = 100000;
const ek = (a, b) => (a + KEY_OFF) * KEY_MUL + (b + KEY_OFF);
const dkA = (k) => Math.floor(k / KEY_MUL) - KEY_OFF;
const dkB = (k) => (k % KEY_MUL) - KEY_OFF;

// A* over a grid of `cell`-sized squares. `blocked(wx,wz)` tests a world point.
// Search is confined to a box around start↔goal (+pad) and capped at maxNodes;
// if the goal can't be reached, the path to the closest explored (free) cell is
// returned so the agent still makes progress and never aims into a wall.
export function astar(sx, sz, gx, gz, blocked, opts = {}) {
  const cell = opts.cell || 3;
  const maxNodes = opts.maxNodes || 600;
  const pad = opts.pad || 24;
  const gi = (v) => Math.round(v / cell);
  const sgx = gi(sx),
    sgz = gi(sz),
    ggx = gi(gx),
    ggz = gi(gz);
  if (sgx === ggx && sgz === ggz) return [{ x: gx, z: gz }];

  const minX = Math.min(sx, gx) - pad,
    maxX = Math.max(sx, gx) + pad;
  const minZ = Math.min(sz, gz) - pad,
    maxZ = Math.max(sz, gz) + pad;

  const open = new MinHeap();
  const g = new Map();
  const came = new Map();
  const startK = ek(sgx, sgz);
  g.set(startK, 0);
  open.push(startK, octile(sgx, sgz, ggx, ggz));

  let bestK = startK,
    bestH = octile(sgx, sgz, ggx, ggz),
    nodes = 0;
  const NB = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  while (open.size && nodes < maxNodes) {
    const k = open.pop();
    nodes++;
    const cx = dkA(k),
      cz = dkB(k);
    if (cx === ggx && cz === ggz) return rebuild(came, k, cell, gx, gz, true);
    const h = octile(cx, cz, ggx, ggz);
    if (h < bestH) {
      bestH = h;
      bestK = k;
    }
    for (const [dx, dz] of NB) {
      const nx = cx + dx,
        nz = cz + dz;
      const wx = nx * cell,
        wz = nz * cell;
      if (wx < minX || wx > maxX || wz < minZ || wz > maxZ) continue;
      if (blocked(wx, wz)) continue;
      // prevent diagonal corner-cutting through a blocked orthogonal cell
      if (dx && dz && (blocked(cx * cell + dx * cell, cz * cell) || blocked(cx * cell, cz * cell + dz * cell)))
        continue;
      const nk = ek(nx, nz);
      const tentative = g.get(k) + (dx && dz ? 1.4142 : 1);
      if (tentative < (g.has(nk) ? g.get(nk) : Infinity)) {
        g.set(nk, tentative);
        came.set(nk, k);
        open.push(nk, tentative + octile(nx, nz, ggx, ggz));
      }
    }
  }
  // goal unreachable → path to the closest free cell (do NOT snap into the wall)
  return rebuild(came, bestK, cell, gx, gz, false);
}

function rebuild(came, endK, cell, gx, gz, snapGoal) {
  const cells = [];
  let k = endK;
  while (k !== undefined) {
    cells.push([dkA(k), dkB(k)]);
    k = came.get(k);
  }
  cells.reverse();
  const pts = [];
  for (let i = 1; i < cells.length; i++) pts.push({ x: cells[i][0] * cell, z: cells[i][1] * cell });
  if (snapGoal && pts.length) pts[pts.length - 1] = { x: gx, z: gz };
  if (!pts.length) pts.push(snapGoal ? { x: gx, z: gz } : { x: cells[0][0] * cell, z: cells[0][1] * cell });
  return simplify(pts);
}

// Drop collinear/near-collinear waypoints to keep the path short to follow.
function simplify(pts) {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1],
      b = pts[i],
      c = pts[i + 1];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 0.4) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// March a passability test between two world points. Returns true if clear.
export function lineOfSight(ax, az, bx, bz, blocked, step = 2) {
  const dx = bx - ax,
    dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blocked(ax + dx * t, az + dz * t)) return false;
  }
  return true;
}

// Desired-velocity steering toward a target (write into `out`).
export function seek(px, pz, tx, tz, speed, out) {
  const dx = tx - px,
    dz = tz - pz;
  const d = Math.hypot(dx, dz) || 1e-3;
  out.x = (dx / d) * speed;
  out.z = (dz / d) * speed;
  return out;
}

// Accumulate a separation push away from neighbours within `radius`.
export function separate(self, neighbours, radius, out) {
  out.x = 0;
  out.z = 0;
  let n = 0;
  const r2 = radius * radius;
  for (const o of neighbours) {
    if (o === self || !o.alive) continue;
    const dx = self.pos.x - o.pos.x,
      dz = self.pos.z - o.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 1e-4 && d2 < r2) {
      const d = Math.sqrt(d2);
      out.x += dx / d / d;
      out.z += dz / d / d;
      n++;
    }
  }
  if (n) {
    out.x /= n;
    out.z /= n;
  }
  return out;
}

// Boids flocking for flyers (3D). Returns a steering accel in `out`.
export function flock(self, neighbours, opts, out) {
  const sepR = opts.sepR ?? 7,
    alignR = opts.alignR ?? 16,
    cohR = opts.cohR ?? 20;
  let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0;
  let ns = 0, na = 0, nc = 0;
  for (const o of neighbours) {
    if (o === self || !o.alive) continue;
    const dx = self.pos.x - o.pos.x,
      dy = self.pos.y - o.pos.y,
      dz = self.pos.z - o.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1e-3;
    if (d < sepR) {
      sx += dx / d;
      sy += dy / d;
      sz += dz / d;
      ns++;
    }
    if (d < alignR) {
      ax += o.vel.x;
      ay += o.vel.y;
      az += o.vel.z;
      na++;
    }
    if (d < cohR) {
      cx += o.pos.x;
      cy += o.pos.y;
      cz += o.pos.z;
      nc++;
    }
  }
  out.x = out.y = out.z = 0;
  if (ns) {
    out.x += (sx / ns) * opts.sep;
    out.y += (sy / ns) * opts.sep;
    out.z += (sz / ns) * opts.sep;
  }
  if (na) {
    out.x += (ax / na - self.vel.x) * opts.align;
    out.y += (ay / na - self.vel.y) * opts.align;
    out.z += (az / na - self.vel.z) * opts.align;
  }
  if (nc) {
    out.x += (cx / nc - self.pos.x) * opts.coh;
    out.y += (cy / nc - self.pos.y) * opts.coh;
    out.z += (cz / nc - self.pos.z) * opts.coh;
  }
  return out;
}
