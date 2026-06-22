// =====================================================================
//  SkillTreeUI — a DOM overlay (toggle with K) to spend skill points earned by
//  leveling up. Two columns: POWER UPGRADES (Damage / Cooldown / AoE, each
//  read by PowerManager as a multiplier) and SPELL UNLOCKS (the Harry-Potter
//  spells). Mutates the Progression model; PowerManager picks up the changes
//  automatically each frame.
// =====================================================================
const SPELL_LABELS = { stupefy: 'Stupefy — stun bolt', wingardium: 'Wingardium — telekinesis', expelliarmus: 'Expelliarmus — disarm', invisibility: 'Invisibility Cloak' };
const UPG_LABELS = { dmg: 'Power Damage  +20%/lv', cd: 'Cooldown  −12%/lv', aoe: 'Area of Effect  +15%/lv' };

export class SkillTreeUI {
  constructor(progression) {
    this.prog = progression;
    this.visible = false;
    injectStyles();

    const root = document.createElement('div');
    root.className = 'st-root';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="st-panel">
        <h1>Skill Tree <span>魔法</span></h1>
        <div class="st-points">Skill points: <b class="st-pts">0</b></div>
        <div class="st-cols">
          <div class="st-col"><h2>Power Upgrades</h2><div class="st-upgrades"></div></div>
          <div class="st-col"><h2>Spells</h2><div class="st-spells"></div></div>
        </div>
        <div class="st-hint">Earn points by leveling up (defeat monsters &amp; bosses). Press <b>K</b> / <b>Esc</b> to close.</div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.ptsEl = root.querySelector('.st-pts');

    // upgrade rows
    this.upRows = {};
    const upWrap = root.querySelector('.st-upgrades');
    for (const key of Object.keys(UPG_LABELS)) {
      const row = document.createElement('div');
      row.className = 'st-row';
      row.innerHTML = `<div class="st-label">${UPG_LABELS[key]}</div><div class="st-pips"></div><button class="st-buy">+</button>`;
      row.querySelector('.st-buy').addEventListener('click', () => { this.prog.upgrade(key); });
      upWrap.appendChild(row);
      this.upRows[key] = { pips: row.querySelector('.st-pips'), buy: row.querySelector('.st-buy') };
    }

    // spell rows
    this.spellRows = {};
    const spWrap = root.querySelector('.st-spells');
    for (const key of this.prog.spells) {
      const row = document.createElement('div');
      row.className = 'st-row';
      row.innerHTML = `<div class="st-label">${SPELL_LABELS[key] || key}</div><button class="st-buy st-unlock">Unlock</button>`;
      row.querySelector('.st-buy').addEventListener('click', () => { this.prog.unlock(key); });
      spWrap.appendChild(row);
      this.spellRows[key] = { buy: row.querySelector('.st-buy') };
    }

    this.prog.onChange = () => this.refresh();
    this.refresh();
  }

  refresh() {
    this.ptsEl.textContent = this.prog.points;
    for (const key of Object.keys(this.upRows)) {
      const r = this.upRows[key];
      const lv = this.prog.upgrades[key];
      r.pips.innerHTML = '';
      for (let i = 0; i < this.prog.maxLevel; i++) {
        const pip = document.createElement('span');
        pip.className = 'st-pip' + (i < lv ? ' on' : '');
        r.pips.appendChild(pip);
      }
      const maxed = lv >= this.prog.maxLevel;
      r.buy.disabled = maxed || this.prog.points <= 0;
      r.buy.textContent = maxed ? 'MAX' : '+';
    }
    for (const key of this.prog.spells) {
      const r = this.spellRows[key];
      const has = this.prog.isUnlocked(key);
      r.buy.disabled = has || this.prog.points <= 0;
      r.buy.textContent = has ? '✓ Unlocked' : 'Unlock';
      r.buy.classList.toggle('owned', has);
    }
  }

  open() { this.visible = true; this.root.style.display = 'flex'; this.refresh(); }
  close() { this.visible = false; this.root.style.display = 'none'; }
  toggle() { this.visible ? this.close() : this.open(); }
  dispose() { if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); }
}

let _injected = false;
function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
  .st-root { position:fixed; inset:0; z-index:23; display:flex; align-items:center; justify-content:center;
    background:#0b0d12d8; backdrop-filter:blur(4px); pointer-events:auto;
    font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  .st-panel { background:#161a24ee; border:1px solid #ffffff22; border-radius:16px; padding:20px 26px; min-width:520px; max-width:90vw; }
  .st-panel h1 { font-size:24px; letter-spacing:2px; margin-bottom:4px; }
  .st-panel h1 span { font-size:15px; opacity:.55; }
  .st-points { font-size:14px; opacity:.9; margin-bottom:14px; }
  .st-points b { color:#ffd24a; font-size:18px; }
  .st-cols { display:flex; gap:26px; }
  .st-col { flex:1; }
  .st-col h2 { font-size:14px; opacity:.8; margin-bottom:8px; border-bottom:1px solid #ffffff1a; padding-bottom:4px; }
  .st-row { display:flex; align-items:center; gap:10px; margin:8px 0; }
  .st-label { flex:1; font-size:13px; }
  .st-pips { display:flex; gap:3px; }
  .st-pip { width:10px; height:10px; border-radius:2px; background:#ffffff22; }
  .st-pip.on { background:#7fb0ff; }
  .st-buy { pointer-events:auto; background:#2a3550; color:#f6efe2; border:1px solid #ffffff22; border-radius:8px;
    padding:5px 12px; font-size:13px; cursor:pointer; min-width:44px; }
  .st-buy:hover:not(:disabled) { background:#39456a; }
  .st-buy:disabled { opacity:.4; cursor:default; }
  .st-buy.owned { color:#7fe08a; }
  .st-hint { margin-top:16px; font-size:12px; opacity:.6; text-align:center; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
