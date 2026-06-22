// =====================================================================
//  ActionHUD — the unified game HUD (bottom of screen). Drop-in replacement
//  for PowerHUD (same setActive / update(manaFrac) / dispose interface, so the
//  PowerManager drives it unchanged) PLUS the Wave-5 vitals & abilities:
//
//    • Vitals stack (bottom-left): Health · Stamina · Shield · Mana bars
//    • Power slots (bottom-centre): number + icon + cooldown shade + active glow
//    • Ability + weapon chips: Shield (Q), Dash (dbl-tap), Sword (R) — crisp
//      inline SVG icons with ready / cooldown / active state
//    • Control hints line + state feedback: low-stamina pulse, shield-break
//      flash, dash-ready glow, and screen speed-lines at high speed.
//
//  Game feeds it each frame via setVitals({...}) and setSpeed(frac); the
//  PowerManager calls update(manaFrac) + setActive(i). All plain DOM/SVG/CSS —
//  crisp at any resolution, no render-loop cost.
// =====================================================================

const SVG = {
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 8.7-8 10-4.5-1.3-8-5-8-10V5z"/></svg>',
  dash: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-2 8 11-13h-7z"/></svg>',
  sword: '<svg viewBox="0 0 24 24"><path d="M6.5 21l-3.5-.0 0-3.5 9-9 3.5 3.5zM14 3l7 0 0 7-5.5 5.5-3.5-3.5z"/></svg>',
};

export class ActionHUD {
  constructor(powers) {
    this.powers = powers;
    this.onSelect = null; // Game wires this so tapping a slot picks that power (touch)
    this._injectStyles();
    const root = document.getElementById('hud') || document.body;

    this.wrap = document.createElement('div');
    this.wrap.className = 'ah-wrap';

    // --- vitals stack (left) ---
    this.bars = {};
    const vit = document.createElement('div');
    vit.className = 'ah-vitals';
    const mkBar = (key, label, cls) => {
      const row = document.createElement('div');
      row.className = 'ah-bar ' + cls;
      row.innerHTML = `<span class="ah-bar-label">${label}</span><div class="ah-bar-track"><div class="ah-bar-fill"></div></div>`;
      vit.appendChild(row);
      this.bars[key] = { row, fill: row.querySelector('.ah-bar-fill') };
    };
    mkBar('hp', 'HP', 'ah-hp');
    mkBar('stam', 'STA', 'ah-stam');
    mkBar('shield', 'SHD', 'ah-shield');
    mkBar('mana', 'MP', 'ah-mana');

    // --- centre: power slots + chips ---
    const center = document.createElement('div');
    center.className = 'ah-center';

    this.slotsEl = document.createElement('div');
    this.slotsEl.className = 'ah-slots';
    this.slots = powers.map((p, i) => {
      const slot = document.createElement('div');
      slot.className = 'ah-slot';
      slot.style.setProperty('--c', '#' + p.color.toString(16).padStart(6, '0'));
      const keyLabel = i < 10 ? (i + 1) % 10 : 'V'; // 1-9, 0 (10th), V (Summon, 11th)
      slot.innerHTML = `<div class="ah-cd"></div><div class="ah-key">${keyLabel}</div><div class="ah-ic">${p.icon}</div><div class="ah-nm">${p.name}</div>`;
      // Tap to select (no number keys on a phone). Only fires where the slot is
      // interactive — i.e. the touch layout, which sets pointer-events:auto.
      slot.addEventListener('click', () => this.onSelect && this.onSelect(i));
      this.slotsEl.appendChild(slot);
      return { el: slot, cd: slot.querySelector('.ah-cd') };
    });
    center.appendChild(this.slotsEl);

    const chips = document.createElement('div');
    chips.className = 'ah-chips';
    const mkChip = (key, svg, keyLabel, name) => {
      const c = document.createElement('div');
      c.className = 'ah-chip';
      c.innerHTML = `<div class="ah-chip-ic">${svg}</div><div class="ah-chip-key">${keyLabel}</div><div class="ah-chip-nm">${name}</div>`;
      chips.appendChild(c);
      return c;
    };
    this.chipShield = mkChip('shield', SVG.shield, 'Q', 'Shield');
    this.chipDash = mkChip('dash', SVG.dash, '⇄⇄', 'Dash');
    this.chipSword = mkChip('sword', SVG.sword, 'R', 'Sword');
    center.appendChild(chips);

    this.hints = document.createElement('div');
    this.hints.className = 'ah-hints';
    this.hints.innerHTML =
      '<b>LMB</b> cast / swing · <b>RMB</b> block · <b>E</b> interact · <b>Q</b> shield · ' +
      '<b>R</b> sword · <b>dbl-tap</b> dash · <b>F</b>/<b>2×Space</b> fly · <b>M</b> map';
    center.appendChild(this.hints);

    this.wrap.appendChild(vit);
    this.wrap.appendChild(center);
    root.appendChild(this.wrap);

    // overlays
    this.speed = document.createElement('div');
    this.speed.className = 'ah-speedlines';
    root.appendChild(this.speed);
    this.flash = document.createElement('div');
    this.flash.className = 'ah-shieldflash';
    root.appendChild(this.flash);
    this._flashT = 0;
  }

  // --- PowerHUD-compatible interface (driven by PowerManager) ---
  setActive(i) {
    this.slots.forEach((s, k) => s.el.classList.toggle('active', k === i));
  }
  update(manaFrac) {
    this.bars.mana.fill.style.width = (manaFrac * 100).toFixed(1) + '%';
    for (let i = 0; i < this.powers.length; i++) {
      const remain = 1 - this.powers[i].cooldownFrac();
      this.slots[i].cd.style.height = (remain * 100).toFixed(0) + '%';
      this.slots[i].el.classList.toggle('locked', !!this.powers[i].locked); // spells until unlocked
    }
    if (this._flashT > 0) {
      this._flashT = Math.max(0, this._flashT - 0.016);
      this.flash.style.opacity = (this._flashT * 0.6).toFixed(2);
    }
  }

  // --- Game-driven vitals / state each frame ---
  setVitals(v) {
    const hp = clamp01(v.hpFrac);
    this.bars.hp.fill.style.width = (hp * 100).toFixed(0) + '%';
    this.bars.hp.fill.style.background = hp < 0.3 ? '#e0453f' : 'linear-gradient(90deg,#4fcf6a,#a8e05a)';
    this.bars.hp.row.classList.toggle('low', hp < 0.3);

    const st = clamp01(v.staminaFrac);
    this.bars.stam.fill.style.width = (st * 100).toFixed(0) + '%';
    this.bars.stam.row.classList.toggle('low', st < 0.2);

    const sh = clamp01(v.shieldFrac);
    this.bars.shield.fill.style.width = (sh * 100).toFixed(0) + '%';
    this.bars.shield.row.classList.toggle('broken', !!v.shieldBroken);

    this.chipShield.classList.toggle('active', !!v.shieldActive);
    this.chipShield.classList.toggle('broken', !!v.shieldBroken);
    this.chipDash.classList.toggle('ready', !!v.dashReady);
    this.chipDash.classList.toggle('cooling', !v.dashReady);
    this.chipSword.classList.toggle('active', !!v.weaponDrawn);
    this.chipSword.classList.toggle('blocking', !!v.blocking);
  }

  setSpeed(frac) {
    this.speed.style.opacity = clamp01((frac - 0.55) / 0.45).toFixed(2);
  }

  flashShieldBreak() {
    this._flashT = 1;
  }

  // Clear the full-screen feedback overlays — Game calls this when leaving the
  // 'playing' state (pause / map / interior / death) so they can't freeze
  // mid-fade over another screen (their decay only runs while playing).
  hideOverlays() {
    this._flashT = 0;
    this.flash.style.opacity = '0';
    this.speed.style.opacity = '0';
  }

  dispose() {
    this.wrap.remove();
    this.speed.remove();
    this.flash.remove();
    this._style?.remove();
  }

  _injectStyles() {
    if (document.getElementById('ah-style')) return;
    const css = `
    .ah-wrap { position:absolute; left:0; right:0; bottom:14px; z-index:12; pointer-events:none;
      display:flex; align-items:flex-end; justify-content:center; gap:clamp(12px,3vw,40px);
      font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
    .ah-vitals { display:flex; flex-direction:column; gap:6px; min-width:190px; }
    .ah-bar { display:flex; align-items:center; gap:8px; }
    .ah-bar-label { font-size:10px; letter-spacing:1px; width:30px; opacity:.85; text-align:right; }
    .ah-bar-track { flex:1; height:10px; background:#0009; border:1px solid #ffffff22; border-radius:6px; overflow:hidden; }
    .ah-bar-fill { height:100%; width:100%; transition:width .12s linear; }
    .ah-hp .ah-bar-fill { background:linear-gradient(90deg,#4fcf6a,#a8e05a); }
    .ah-stam .ah-bar-fill { background:linear-gradient(90deg,#e0b53f,#ffe07a); }
    .ah-shield .ah-bar-fill { background:linear-gradient(90deg,#3fb4f5,#9fe8ff); }
    .ah-mana .ah-bar-fill { background:linear-gradient(90deg,#6a7bff,#b6a8ff); }
    .ah-bar.low .ah-bar-track { animation:ah-pulse .6s ease-in-out infinite; border-color:#e0453f; }
    .ah-shield.broken .ah-bar-fill { background:#ff6a4a; opacity:.5; }
    @keyframes ah-pulse { 0%,100%{ box-shadow:0 0 0 0 #e0453f00 } 50%{ box-shadow:0 0 8px 1px #e0453faa } }

    .ah-center { display:flex; flex-direction:column; align-items:center; gap:8px; }
    .ah-slots { display:flex; gap:8px; }
    .ah-slot { position:relative; width:clamp(52px,6vw,66px); height:clamp(52px,6vw,66px); border-radius:11px;
      overflow:hidden; background:#1a1310cc; border:2px solid #ffffff22; text-align:center; box-shadow:0 4px 12px #0007;
      transition:transform .12s ease, border-color .12s ease; }
    .ah-slot.active { border-color:var(--c); transform:translateY(-6px) scale(1.06); box-shadow:0 0 16px var(--c); }
    .ah-slot.locked { opacity:.4; filter:grayscale(.85); }
    .ah-slot.locked::after { content:'🔒'; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:18px; }
    .ah-cd { position:absolute; left:0; bottom:0; width:100%; height:0%; background:rgba(8,10,16,.72); transition:height .05s linear; }
    .ah-key { position:absolute; top:2px; left:5px; font-size:10px; opacity:.7; }
    .ah-ic { font-size:clamp(22px,2.6vw,28px); margin-top:8px; filter:drop-shadow(0 2px 3px #000); }
    .ah-nm { font-size:10px; opacity:.9; }
    .ah-slot.active .ah-nm { color:var(--c); }

    .ah-chips { display:flex; gap:8px; }
    .ah-chip { display:flex; flex-direction:column; align-items:center; gap:1px; width:54px; padding:5px 4px;
      border-radius:10px; background:#1a1310aa; border:1.5px solid #ffffff20; opacity:.65; transition:all .12s ease; }
    .ah-chip svg { width:20px; height:20px; fill:currentColor; }
    .ah-chip-key { font-size:9px; opacity:.8; }
    .ah-chip-nm { font-size:9px; opacity:.85; }
    .ah-chip.ready { opacity:1; }
    .ah-chip.cooling { opacity:.4; }
    .ah-chip.active { opacity:1; border-color:#5fd0ff; color:#9fe8ff; box-shadow:0 0 12px #3fb4f5aa; }
    .ah-chip.blocking { border-color:#ffd24a; color:#ffe07a; }
    .ah-chip.broken { border-color:#ff6a4a; color:#ff9a7a; }
    .ah-chipDash, .ah-chip.ready.dash { }

    .ah-hints { font-size:11px; opacity:.55; text-align:center; }
    .ah-hints b { opacity:.9; color:#ffd9a0; font-weight:700; }

    .ah-speedlines { position:absolute; inset:0; z-index:9; pointer-events:none; opacity:0; transition:opacity .1s linear;
      background:radial-gradient(ellipse at center, transparent 38%, #000 140%);
      mix-blend-mode:screen; }
    .ah-speedlines::after { content:''; position:absolute; inset:-20%;
      background:repeating-conic-gradient(from 0deg at 50% 50%, #ffffff22 0deg 1.2deg, transparent 1.2deg 7deg);
      -webkit-mask:radial-gradient(circle at center, transparent 30%, #000 70%);
      mask:radial-gradient(circle at center, transparent 30%, #000 70%); }
    .ah-shieldflash { position:absolute; inset:0; z-index:10; pointer-events:none; opacity:0;
      box-shadow:inset 0 0 140px 30px #3fb4f5; transition:opacity .05s linear; }
    @media (max-width:680px){ .ah-vitals{ display:none } .ah-hints{ display:none } }
    `;
    const style = document.createElement('style');
    style.id = 'ah-style';
    style.textContent = css;
    document.head.appendChild(style);
    this._style = style;
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
