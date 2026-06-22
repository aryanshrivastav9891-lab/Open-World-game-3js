// DOM overlay for the power system: a row of element slots (number + icon +
// name) with per-slot cooldown shading, an "active" highlight, and a shared
// mana bar. Plain HTML/CSS over the canvas — no render-loop cost.
export class PowerHUD {
  constructor(powers) {
    this.powers = powers;
    this._injectStyles();
    const root = document.getElementById('hud') || document.body;

    this.wrap = document.createElement('div');
    this.wrap.className = 'pw-wrap';

    this.slotsEl = document.createElement('div');
    this.slotsEl.className = 'pw-slots';
    this.slots = powers.map((p, i) => {
      const slot = document.createElement('div');
      slot.className = 'pw-slot';
      slot.style.setProperty('--pw-color', '#' + p.color.toString(16).padStart(6, '0'));
      slot.innerHTML =
        `<div class="pw-cd"></div>` +
        `<div class="pw-key">${i + 1}</div>` +
        `<div class="pw-icon">${p.icon}</div>` +
        `<div class="pw-name">${p.name}</div>`;
      this.slotsEl.appendChild(slot);
      return { el: slot, cd: slot.querySelector('.pw-cd') };
    });
    this.wrap.appendChild(this.slotsEl);

    const manaWrap = document.createElement('div');
    manaWrap.className = 'pw-mana-wrap';
    manaWrap.innerHTML = `<span class="pw-mana-label">マナ</span><div class="pw-mana-track"><div class="pw-mana"></div></div>`;
    this.manaEl = manaWrap.querySelector('.pw-mana');
    this.wrap.appendChild(manaWrap);

    root.appendChild(this.wrap);
  }

  setActive(i) {
    this.slots.forEach((s, k) => s.el.classList.toggle('active', k === i));
  }

  update(manaFrac) {
    this.manaEl.style.width = (manaFrac * 100).toFixed(1) + '%';
    for (let i = 0; i < this.powers.length; i++) {
      // remaining cooldown shades the slot from the bottom up
      const remain = 1 - this.powers[i].cooldownFrac();
      this.slots[i].cd.style.height = (remain * 100).toFixed(0) + '%';
    }
  }

  dispose() {
    this.wrap.remove();
    this._style?.remove();
  }

  _injectStyles() {
    if (document.getElementById('pw-style')) return;
    const css = `
    .pw-wrap { position:absolute; left:50%; bottom:18px; transform:translateX(-50%);
      display:flex; flex-direction:column; align-items:center; gap:8px; pointer-events:none;
      font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; z-index:12; }
    .pw-slots { display:flex; gap:10px; }
    .pw-slot { position:relative; width:72px; height:72px; border-radius:12px; overflow:hidden;
      background:#1a1310cc; border:2px solid #ffffff22; color:#f6efe2; text-align:center;
      box-shadow:0 4px 14px #0007; transition:transform .12s ease, border-color .12s ease; }
    .pw-slot.active { border-color:var(--pw-color); transform:translateY(-6px) scale(1.06);
      box-shadow:0 0 18px var(--pw-color); }
    .pw-cd { position:absolute; left:0; bottom:0; width:100%; height:0%;
      background:rgba(10,12,18,0.72); transition:height .05s linear; }
    .pw-key { position:absolute; top:3px; left:5px; font-size:11px; opacity:.7; }
    .pw-icon { font-size:30px; margin-top:10px; filter:drop-shadow(0 2px 3px #000); }
    .pw-name { font-size:11px; letter-spacing:.5px; opacity:.92; }
    .pw-slot.active .pw-name { color:var(--pw-color); }
    .pw-mana-wrap { display:flex; align-items:center; gap:8px; }
    .pw-mana-label { font-size:12px; opacity:.8; letter-spacing:2px; }
    .pw-mana-track { width:280px; height:9px; background:#ffffff22; border-radius:6px; overflow:hidden; }
    .pw-mana { width:100%; height:100%;
      background:linear-gradient(90deg,#3fa9f5,#9fd8ff); transition:width .1s linear; }
    `;
    const style = document.createElement('style');
    style.id = 'pw-style';
    style.textContent = css;
    document.head.appendChild(style);
    this._style = style;
  }
}
