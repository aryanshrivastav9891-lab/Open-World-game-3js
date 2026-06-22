// =====================================================================
//  Progression — the skill/upgrade economy. Leveling up (MissionManager) grants
//  SKILL POINTS; the player spends them in the Skill Tree (SkillTreeUI) to:
//    • upgrade powers: +damage, −cooldown, +AoE (read by PowerManager each frame
//      as dmgMul / cdMul / aoeMul and applied to every cast)
//    • unlock the Harry-Potter spells (Stupefy, Wingardium, Expelliarmus, Cloak)
//
//  Pure data + a couple of getters; no THREE/DOM. PowerManager.setProgression()
//  reads it; SkillTreeUI mutates it via upgrade()/unlock().
//
//  HOW TO ADD A NEW UPGRADE OR UNLOCKABLE: add a key to `upgrades` (and a getter
//  + a row in SkillTreeUI), or push a spell key into `spells`.
// =====================================================================
export class Progression {
  constructor() {
    this.points = 0;
    this.maxLevel = 5; // per upgrade track
    this.upgrades = { dmg: 0, cd: 0, aoe: 0 }; // levels 0..maxLevel
    this.spells = ['stupefy', 'wingardium', 'expelliarmus', 'invisibility'];
    this.unlocked = new Set();
    this.onChange = null; // () → SkillTreeUI refresh
  }

  grantPoints(n) {
    this.points += n;
    this._changed();
  }

  canUpgrade(key) {
    return this.points > 0 && this.upgrades[key] !== undefined && this.upgrades[key] < this.maxLevel;
  }
  upgrade(key) {
    if (!this.canUpgrade(key)) return false;
    this.upgrades[key]++;
    this.points--;
    this._changed();
    return true;
  }

  canUnlock(key) {
    return this.points > 0 && this.spells.includes(key) && !this.unlocked.has(key);
  }
  unlock(key) {
    if (!this.canUnlock(key)) return false;
    this.unlocked.add(key);
    this.points--;
    this._changed();
    return true;
  }

  isUnlocked(key) {
    return this.unlocked.has(key);
  }

  // multipliers applied by PowerManager
  get dmgMul() { return 1 + this.upgrades.dmg * 0.2; } // +20% / level
  get cdMul() { return Math.max(0.4, 1 - this.upgrades.cd * 0.12); } // −12% / level
  get aoeMul() { return 1 + this.upgrades.aoe * 0.15; } // +15% / level

  // --- save / load ---
  serialize() {
    return { points: this.points, upgrades: { ...this.upgrades }, unlocked: [...this.unlocked] };
  }
  apply(d) {
    if (!d) return;
    this.points = d.points || 0;
    this.upgrades = { dmg: 0, cd: 0, aoe: 0, ...(d.upgrades || {}) };
    this.unlocked = new Set(d.unlocked || []);
    this._changed();
  }

  _changed() {
    if (this.onChange) this.onChange();
  }
}
