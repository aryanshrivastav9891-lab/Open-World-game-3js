// =====================================================================
//  Stamina — a real, gating resource. It DRAINS while you sprint, hold a
//  shield, dash, or swing the sword, and REGENERATES when you stop. Abilities
//  ask it `spend()` (one-shot, e.g. a dash/swing) or `drain()` (per-frame, e.g.
//  sprinting/shielding); both refuse once it's empty, so nothing works at 0.
//
//  HOW TO GATE A NEW ABILITY ON STAMINA (1 line):
//    one-shot:    if (!player.stamina.spend(COST)) return;   // refuses if low
//    continuous:  player.stamina.drain(PER_SEC, dt);          // returns false at 0
// =====================================================================
export class Stamina {
  constructor(max = 100) {
    this.max = max;
    this.value = max;
    this.regen = 24; // per second, after a short delay
    this._delay = 0; // seconds before regen resumes after spending
  }

  get frac() {
    return this.value / this.max;
  }
  get empty() {
    return this.value <= 0.5;
  }
  has(amount) {
    return this.value >= amount;
  }

  // One-shot spend (dash, sword swing). Returns false (and spends nothing) if
  // it can't afford the full cost.
  spend(amount) {
    if (this.value >= amount) {
      this.value -= amount;
      this._delay = 0.6;
      return true;
    }
    return false;
  }

  // Continuous drain (sprint, shield). Returns true while there's stamina left.
  // At empty it does NOT push back the regen delay, so regen can resume even if
  // a caller keeps calling drain() at 0.
  drain(perSec, dt) {
    if (this.value <= 0) {
      this.value = 0;
      return false;
    }
    this.value = Math.max(0, this.value - perSec * dt);
    this._delay = 0.5;
    return this.value > 0;
  }

  // Call once per frame AFTER abilities have drained (their drain resets the
  // regen delay, so regen only kicks in once you actually stop).
  update(dt) {
    if (this._delay > 0) {
      this._delay -= dt;
      return;
    }
    if (this.value < this.max) this.value = Math.min(this.max, this.value + this.regen * dt);
  }

  reset() {
    this.value = this.max;
    this._delay = 0;
  }
}
