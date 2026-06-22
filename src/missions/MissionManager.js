import { REGIONS, regionByKey, ARENA_RADIUS } from '../world/Regions.js';

// =====================================================================
//  MissionManager — quests, objectives, progression (XP / level) and the
//  data the MissionHUD renders (current objective + a world-space waypoint).
//
//  Two missions are generated PER COUNTRY straight from the Regions table:
//    1. a "hunt" mission  — defeat N regional enemies   (waypoint: region core)
//    2. a "boss" mission  — defeat the region's boss      (waypoint: arena)
//  Entering a country activates its hunt mission; clearing the hunt unlocks the
//  boss. Defeating the boss completes the country and grants a big XP reward.
//
//  ---------------------------------------------------------------------
//  HOW TO ADD A NEW MISSION OR BOSS (a few lines):
//    • A boss + its "defeat the boss" mission come for free from a region's
//      boss:{...} entry in Regions.js — no code needed here.
//    • For an extra bespoke mission, push one more object in _buildMissions():
//        { id, regionKey, kind:'custom', title, native, target, progress:0,
//          done:false, active:true, locked:false, waypoint:{x,z}, xp }
//      then advance it with `missions.progress(id)` from wherever it's earned.
//  ---------------------------------------------------------------------
// =====================================================================

const HUNT_TARGET = 4;

export class MissionManager {
  constructor() {
    this.level = 1;
    this.xp = 0;
    this.totalXp = 0;
    this.xpForNext = 150;
    this.onLevelUp = null; // (level) → Game (heal + buffs + toast)
    this.onToast = null; // (text, ms)
    this.onCheckpoint = null; // () → Game auto-save

    this.missions = this._buildMissions();
    this._seen = new Set();
    this.currentRegion = null;
  }

  _buildMissions() {
    const out = [];
    for (const r of REGIONS) {
      out.push({
        id: `hunt_${r.key}`, regionKey: r.key, kind: 'hunt',
        title: `Purge the ${r.enemy.name}s of ${r.name}`,
        native: r.native, enemyName: r.enemy.name, target: HUNT_TARGET, progress: 0,
        done: false, active: false, locked: false,
        waypoint: { x: r.center.x, z: r.center.z }, xp: 120,
      });
      out.push({
        id: `boss_${r.key}`, regionKey: r.key, kind: 'boss',
        title: `Defeat ${r.boss.name}`,
        native: r.boss.native, target: 1, progress: 0,
        done: false, active: false, locked: true, // unlocked after the hunt
        waypoint: { x: r.arena.x, z: r.arena.z }, xp: r.boss.xp,
      });
    }
    // --- demo / tutorial missions of varied TYPES (collect / rescue / defend),
    //     active from the start near the Japanese village ---
    out.push({
      id: 'tut_collect', regionKey: 'japan', kind: 'collect', title: 'Gather 3 supply caches', native: '物資',
      target: 3, progress: 0, done: false, active: true, locked: false, xp: 80,
      points: [{ x: 22, z: 18 }, { x: -24, z: 14 }, { x: 8, z: -26 }].map((p) => ({ ...p, got: false })),
      waypoint: { x: 22, z: 18 },
    });
    out.push({
      id: 'tut_rescue', regionKey: 'japan', kind: 'rescue', title: 'Free the captured villager', native: '救出',
      target: 1, progress: 0, done: false, active: true, locked: false, xp: 120,
      points: [{ x: -48, z: -34, got: false }], waypoint: { x: -48, z: -34 },
    });
    out.push({
      id: 'tut_defend', regionKey: 'japan', kind: 'defend', title: 'Defend the plaza (20s)', native: '防衛',
      target: 20, progress: 0, done: false, active: true, locked: false, xp: 150, defendT: 0,
      points: [{ x: 0, z: 0 }], waypoint: { x: 0, z: 0 },
    });
    return out;
  }

  _complete(m) {
    if (m.done) return;
    m.done = true;
    m.progress = m.target;
    this.addXP(m.xp);
    if (this.onToast) this.onToast(`Mission complete: ${m.title}  (+${m.xp} XP)`, 3600);
    if (this.onCheckpoint) this.onCheckpoint(); // auto-save at mission completion
  }

  // --- save / load -------------------------------------------------
  serialize() {
    return {
      level: this.level, xp: this.xp, totalXp: this.totalXp, xpForNext: this.xpForNext,
      seen: [...this._seen],
      missions: this.missions.map((m) => ({
        id: m.id, progress: m.progress, done: m.done, active: m.active, locked: m.locked,
        defendT: m.defendT, got: m.points ? m.points.map((p) => !!p.got) : null,
      })),
    };
  }
  apply(data) {
    if (!data) return;
    this.level = data.level ?? this.level;
    this.xp = data.xp ?? 0;
    this.totalXp = data.totalXp ?? 0;
    this.xpForNext = data.xpForNext ?? this.xpForNext;
    this._seen = new Set(data.seen || []);
    for (const md of data.missions || []) {
      const m = this.get(md.id);
      if (!m) continue;
      m.progress = md.progress; m.done = md.done; m.active = md.active; m.locked = md.locked;
      if (md.defendT !== undefined) m.defendT = md.defendT;
      if (md.got && m.points) m.points.forEach((p, i) => { p.got = !!md.got[i]; });
    }
    this.currentRegion = null; // re-evaluate region entry on the next update
  }

  get(id) {
    return this.missions.find((m) => m.id === id);
  }

  // Called every frame with the player's current country.
  update(dt, playerPos, regionKey) {
    if (regionKey !== this.currentRegion) {
      this.currentRegion = regionKey;
      if (!this._seen.has(regionKey)) {
        this._seen.add(regionKey);
        const hunt = this.get(`hunt_${regionKey}`);
        if (hunt && !hunt.done) {
          hunt.active = true;
          const r = regionByKey(regionKey);
          if (this.onToast) this.onToast(`Entered ${r.name} ${r.native} — new mission`, 3200);
        }
      }
    }
    // position/timer-tracked mission types (collect / rescue / defend)
    for (const m of this.missions) {
      if (!m.active || m.done) continue;
      if (m.kind === 'collect') {
        let prog = 0;
        for (const pt of m.points) {
          if (!pt.got && Math.hypot(playerPos.x - pt.x, playerPos.z - pt.z) < 6) { pt.got = true; if (this.onToast) this.onToast('Supply cache collected', 1200); }
          if (pt.got) prog++;
        }
        m.progress = prog;
        const next = m.points.find((p) => !p.got);
        m.waypoint = next ? { x: next.x, z: next.z } : null;
        if (prog >= m.target) this._complete(m);
      } else if (m.kind === 'rescue') {
        const pt = m.points[0];
        if (Math.hypot(playerPos.x - pt.x, playerPos.z - pt.z) < 6) { m.progress = 1; this._complete(m); }
      } else if (m.kind === 'defend') {
        const pt = m.points[0];
        if (Math.hypot(playerPos.x - pt.x, playerPos.z - pt.z) < 14) m.defendT += dt;
        m.progress = Math.min(m.target, Math.floor(m.defendT));
        if (m.defendT >= m.target) this._complete(m);
      }
    }
  }

  // For the mission log (J).
  getLog() {
    return this.missions
      .filter((m) => (m.active || m.done) && !m.locked)
      .map((m) => ({ title: m.title, native: m.native, objective: this._objectiveText(m), done: m.done }));
  }

  // Demo win condition: every region boss defeated.
  allBossesDone() {
    return REGIONS.every((r) => { const b = this.get(`boss_${r.key}`); return b && b.done; });
  }

  // True when the region's boss mission is live (so Game may spawn the boss
  // once the player reaches the arena).
  bossMissionActive(regionKey) {
    const m = this.get(`boss_${regionKey}`);
    return !!(m && m.active && !m.done && !m.locked);
  }

  nearArena(playerPos, regionKey) {
    const r = regionByKey(regionKey);
    if (!r) return false;
    return Math.hypot(playerPos.x - r.arena.x, playerPos.z - r.arena.z) <= ARENA_RADIUS;
  }

  // --- progression hooks -------------------------------------------
  onEnemyKilled(regionKey, xp) {
    this.addXP(xp || 30);
    const hunt = this.get(`hunt_${regionKey}`);
    if (hunt && hunt.active && !hunt.done) {
      hunt.progress = Math.min(hunt.target, hunt.progress + 1);
      if (hunt.progress >= hunt.target) {
        hunt.done = true;
        this.addXP(hunt.xp);
        const boss = this.get(`boss_${regionKey}`);
        if (boss) { boss.locked = false; boss.active = true; }
        const r = regionByKey(regionKey);
        if (this.onToast) this.onToast(`Hunt complete! Seek ${r.boss.name} at the arena ◆`, 4200);
      }
    }
  }

  onBossSpawned(regionKey) {
    const boss = this.get(`boss_${regionKey}`);
    if (boss && this.onToast) this.onToast(`${regionByKey(regionKey).boss.name} has appeared!`, 3000);
  }

  onBossKilled(regionKey, xp) {
    const boss = this.get(`boss_${regionKey}`);
    if (boss && !boss.done) {
      boss.done = true;
      boss.progress = 1;
      this.addXP(xp || boss.xp);
      const r = regionByKey(regionKey);
      if (this.onToast) this.onToast(`${r.boss.name} defeated! ${r.name} liberated ★`, 4500);
      if (this.onCheckpoint) this.onCheckpoint(); // auto-save after a boss
    }
  }

  progress(id, n = 1) {
    const m = this.get(id);
    if (m && m.active && !m.done) {
      m.progress = Math.min(m.target, m.progress + n);
      if (m.progress >= m.target) { m.done = true; this.addXP(m.xp); }
    }
  }

  addXP(n) {
    this.xp += n;
    this.totalXp += n;
    while (this.xp >= this.xpForNext) {
      this.xp -= this.xpForNext;
      this.level++;
      this.xpForNext = Math.round(this.xpForNext * 1.5);
      if (this.onLevelUp) this.onLevelUp(this.level);
    }
  }

  // What the HUD should show right now (mission tracked in the current region).
  hudState(regionKey) {
    const candidates = this.missions.filter((m) => m.active && !m.done && !m.locked);
    // prefer a mission in the current region, else any active one (demo missions)
    const tracked = candidates.find((m) => m.regionKey === regionKey) || candidates[0] || null;
    const completed = this.missions.filter((m) => m.done).length;
    let objectives = [];
    let title = 'Explore the world';
    let native = '';
    let waypoint = null;
    if (tracked) {
      title = tracked.title;
      native = tracked.native;
      waypoint = tracked.waypoint;
      objectives = [{ text: this._objectiveText(tracked), done: tracked.done }];
    }
    return {
      title, native, objectives, waypoint,
      level: this.level, xp: this.xp, xpForNext: this.xpForNext,
      completed, total: this.missions.length,
    };
  }

  _objectiveText(m) {
    if (m.kind === 'hunt') return `Defeat ${m.enemyName || 'enemies'} — ${m.progress}/${m.target}`;
    if (m.kind === 'boss') return `Reach the arena ◆ and defeat the boss`;
    if (m.kind === 'collect') return `Collect supply caches — ${m.progress}/${m.target}`;
    if (m.kind === 'rescue') return `Reach the captive ✚ and free them`;
    if (m.kind === 'defend') return `Hold the plaza — ${m.progress}/${m.target}s`;
    return `${m.progress}/${m.target}`;
  }
}
