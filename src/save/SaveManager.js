// =====================================================================
//  SaveManager — named save slots persisted in localStorage, plus JSON
//  export/import. It only stores/loads opaque state objects (Game builds them
//  via _serialize() and consumes them via _applyState()), so it stays decoupled
//  from game internals. Data is VERSIONED with a migration hook so new fields
//  don't break old saves. Falls back to an in-memory store if localStorage is
//  unavailable (private mode / SSR), so it never throws.
//
//  HOW TO ADD A NEW SAVE FIELD (a few lines):
//    1. Add it in Game._serialize() (write) and Game._applyState() (read).
//    2. If old saves must keep working, bump SAVE_VERSION and add a default for
//       the field in _migrate() below. That's it.
// =====================================================================
export const SAVE_VERSION = 1;
const PREFIX = 'yamato.save.';
const AUTOSAVE = 'Autosave';

const _mem = {}; // fallback store
function store() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('__yt', '1');
      localStorage.removeItem('__yt');
      return localStorage;
    }
  } catch (e) { /* private mode etc. */ }
  return {
    getItem: (k) => (k in _mem ? _mem[k] : null),
    setItem: (k, v) => { _mem[k] = v; },
    removeItem: (k) => { delete _mem[k]; },
    key: (i) => Object.keys(_mem)[i] ?? null,
    get length() { return Object.keys(_mem).length; },
  };
}

export class SaveManager {
  constructor() {
    this.store = store();
    this.AUTOSAVE = AUTOSAVE;
  }

  // Persist a state object under `name`. Stamps version + name + timestamp.
  save(name, state) {
    if (!name) return false;
    const data = { ...state, version: SAVE_VERSION, name, timestamp: Date.now() };
    try {
      this.store.setItem(PREFIX + name, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('[Save] failed:', e);
      return false;
    }
  }

  load(name) {
    const raw = this.store.getItem(PREFIX + name);
    if (!raw) return null;
    try {
      return this._migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('[Save] corrupt slot', name, e);
      return null;
    }
  }

  delete(name) {
    this.store.removeItem(PREFIX + name);
  }

  has(name) {
    return this.store.getItem(PREFIX + name) != null;
  }

  // [{ name, level, region, location, timestamp }] newest first.
  list() {
    const out = [];
    for (let i = 0; i < this.store.length; i++) {
      const k = this.store.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const s = JSON.parse(this.store.getItem(k));
        out.push({ name: s.name, level: s.level || 1, region: s.region || '', location: s.location || '', timestamp: s.timestamp || 0 });
      } catch (e) { /* skip corrupt */ }
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  // JSON string of a slot (for downloading a backup file).
  exportJSON(name) {
    const raw = this.store.getItem(PREFIX + name);
    return raw || null;
  }
  // Import a JSON string (from a backup file). Returns the saved name or null.
  importJSON(json) {
    try {
      const s = this._migrate(JSON.parse(json));
      const name = s.name || 'Imported';
      this.save(name, s);
      return name;
    } catch (e) {
      console.warn('[Save] import failed:', e);
      return null;
    }
  }

  // Forward-compatible migration: fill any fields missing from older versions.
  _migrate(s) {
    if (!s.version || s.version < SAVE_VERSION) {
      // (v1 is the base; future versions add their defaults here)
      s.lives = s.lives ?? 3;
      s.version = SAVE_VERSION;
    }
    return s;
  }
}
