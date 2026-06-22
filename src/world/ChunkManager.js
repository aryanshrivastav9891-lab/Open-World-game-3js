import { Chunk } from './Chunk.js';
import { LOAD_RADIUS, LOD_FULL_RADIUS, worldToChunk, chunkInBounds } from './WorldConfig.js';

const MAX_BUILDS_PER_FRAME = 4;
const DEFAULT_BUDGET_MS = 5;

// Streams Chunks in/out around the player. Maintains a build queue that is
// drained under a per-frame time budget so loading never freezes the game,
// and disposes chunks the moment they leave the load radius.
export class ChunkManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map(); // key -> Chunk
    this.queue = []; // [{cx,cz,key}]
    this.queued = new Set();
    this.pcx = null;
    this.pcz = null;

    this._dirty = true;
    this._colliders = [];
    this._triggers = [];
    this.stats = { active: 0, pending: 0, built: 0, disposed: 0 };
  }

  key(cx, cz) {
    return cx + ',' + cz;
  }

  // Call every frame with the player's world position.
  update(px, pz, budgetMs = DEFAULT_BUDGET_MS) {
    const { cx, cz } = worldToChunk(px, pz);
    if (cx !== this.pcx || cz !== this.pcz) {
      this.pcx = cx;
      this.pcz = cz;
      this._reconcile(cx, cz);
    }
    this._processQueue(budgetMs);
    this._updateLOD(cx, cz);
    this.stats.active = this.chunks.size;
    this.stats.pending = this.queue.length;
  }

  // Decide which chunks should exist; queue the missing, dispose the extra.
  _reconcile(pcx, pcz) {
    const want = new Set();
    for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
      for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (!chunkInBounds(cx, cz)) continue;
        const k = this.key(cx, cz);
        want.add(k);
        if (!this.chunks.has(k) && !this.queued.has(k)) {
          this.queue.push({ cx, cz, key: k });
          this.queued.add(k);
        }
      }
    }
    // dispose chunks that fell out of range
    for (const [k, chunk] of this.chunks) {
      if (!want.has(k)) {
        chunk.dispose();
        this.chunks.delete(k);
        this.stats.disposed++;
        this._dirty = true;
      }
    }
    // drop queued builds that are no longer wanted
    if (this.queue.length) {
      this.queue = this.queue.filter((q) => {
        if (want.has(q.key)) return true;
        this.queued.delete(q.key);
        return false;
      });
    }
  }

  _chebyshev(cx, cz) {
    return Math.max(Math.abs(cx - this.pcx), Math.abs(cz - this.pcz));
  }

  _lodFor(cx, cz) {
    return this._chebyshev(cx, cz) <= LOD_FULL_RADIUS ? 0 : 1;
  }

  // Build queued chunks nearest-first, bounded by time + count budgets.
  _processQueue(budgetMs) {
    if (!this.queue.length) return;
    // nearest first
    this.queue.sort((a, b) => this._chebyshev(a.cx, a.cz) - this._chebyshev(b.cx, b.cz));
    const start = performance.now();
    let built = 0;
    while (this.queue.length && built < MAX_BUILDS_PER_FRAME) {
      if (performance.now() - start > budgetMs) break;
      const q = this.queue.shift();
      this.queued.delete(q.key);
      if (this.chunks.has(q.key)) continue;
      const chunk = new Chunk(q.cx, q.cz);
      chunk.build(this._lodFor(q.cx, q.cz));
      this.scene.add(chunk.group);
      this.chunks.set(q.key, chunk);
      this.stats.built++;
      built++;
      this._dirty = true;
    }
  }

  _updateLOD(pcx, pcz) {
    for (const chunk of this.chunks.values()) {
      chunk.setLOD(this._lodFor(chunk.cx, chunk.cz));
    }
  }

  // Aggregated colliders/triggers across resident chunks (cached).
  _rebuildAggregates() {
    this._colliders = [];
    this._triggers = [];
    for (const chunk of this.chunks.values()) {
      for (const c of chunk.colliders) this._colliders.push(c);
      for (const t of chunk.triggers) this._triggers.push(t);
    }
    this._dirty = false;
  }

  getColliders() {
    if (this._dirty) this._rebuildAggregates();
    return this._colliders;
  }

  getTriggers() {
    if (this._dirty) this._rebuildAggregates();
    return this._triggers;
  }

  // Free everything (used when entering an interior, or on shutdown).
  clear() {
    for (const chunk of this.chunks.values()) chunk.dispose();
    this.chunks.clear();
    this.queue.length = 0;
    this.queued.clear();
    this.pcx = null;
    this.pcz = null;
    this._dirty = true;
    this._colliders = [];
    this._triggers = [];
  }
}
