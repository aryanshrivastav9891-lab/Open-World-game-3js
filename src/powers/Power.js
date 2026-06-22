// Base class for every elemental power.
//
// A power is configured with display + balance data and implements a few
// hooks. The PowerManager ticks every power each frame (so in-flight effects
// keep animating even after you switch element), but only the ACTIVE power
// receives input.
//
// Hooks a subclass overrides:
//   onInit()                  — create pooled meshes/resources (this.scene, this.mgr ready)
//   cast(ctx)                 — INSTANT powers: spawn the effect (already paid + on cooldown)
//   beamUpdate(dt, ctx, on)   — CONTINUOUS powers: drive the held beam (on = firing & paid this frame)
//   animate(dt, ctx)          — advance live projectiles/effects every frame
//   deactivate(ctx)           — hide held visuals when switched away / stopped
//   onDispose()               — free owned resources
export class Power {
  constructor(cfg) {
    this.name = cfg.name;
    this.color = cfg.color; // hex tint for HUD + effects
    this.icon = cfg.icon; // emoji shown in the HUD slot
    this.cooldown = cfg.cooldown ?? 0.5; // seconds between casts
    this.manaCost = cfg.manaCost ?? 15; // per cast (instant) or per second (continuous)
    this.continuous = !!cfg.continuous;
    this.range = cfg.range ?? 60;
    this.sound = cfg.sound || this.name.toLowerCase();
    this.texKey = cfg.texKey || this.name.toLowerCase(); // particle sprite for this power (ElementTextures)
    this.locked = !!cfg.locked; // spells start locked until unlocked in the skill tree
    this._cd = 0;
    this._lastCd = this.cooldown; // the actual cooldown used for the last cast (upgrades shorten it)
  }

  init(scene, mgr) {
    this.scene = scene;
    this.mgr = mgr;
    this.onInit?.();
  }

  get ready() {
    return this._cd <= 0;
  }

  // 0 = just cast (full cooldown remaining) → 1 = ready. Divides by the cooldown
  // actually used for the last cast, so cooldown upgrades shade the HUD correctly.
  cooldownFrac() {
    const cd = this._lastCd || this.cooldown;
    return cd > 0 ? Math.min(1, 1 - this._cd / cd) : 1;
  }

  // Called by the manager every frame for every power.
  update(dt, ctx, isActive) {
    if (this._cd > 0) this._cd -= dt;

    if (this.continuous) {
      let on = false;
      if (isActive && ctx.firing && this._cd <= 0 && !this.locked) {
        on = ctx.spendMana(this.manaCost * dt);
      }
      this.beamUpdate(dt, ctx, on);
      if (on && this.sound) ctx.sound(this.sound, true);
    } else if (isActive && ctx.castEdge) {
      this._tryCast(ctx);
    }

    this.animate(dt, ctx);
  }

  _tryCast(ctx) {
    if (this._cd > 0 || this.locked) return;
    if (!this.canCast(ctx)) return; // e.g. pool exhausted → don't waste mana/cooldown
    if (!ctx.spendMana(this.manaCost)) return;
    this._lastCd = this.cooldown * (ctx.cdMul || 1); // cooldown upgrades shorten this
    this._cd = this._lastCd;
    this.cast(ctx);
    if (this.sound) ctx.sound(this.sound, false);
  }

  // default no-op hooks
  canCast() {
    return true;
  }
  cast() {}
  beamUpdate() {}
  animate() {}
  deactivate() {}

  dispose() {
    this.onDispose?.();
  }
}
