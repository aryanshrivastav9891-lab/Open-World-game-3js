// =====================================================================
//  Screens — the demo's start / win / game-over overlays, tying the flow
//  together: START (Begin) → play → WIN (all region bosses defeated) and
//  GAME OVER (out of lives). Plain DOM with buttons; callbacks drive Game.
// =====================================================================
export class Screens {
  constructor() {
    injectStyles();
    this.onBegin = null;
    this.onContinue = null;
    this.onRestart = null;
    this.onLoad = null;

    this.start = this._make(
      'sc-start',
      `<div class="sc-title">大和 · Yamato Saga</div>
       <div class="sc-sub">An open-world action demo — explore four countries, master powers &amp; spells, ride mounts, and topple every boss.</div>
       <button class="sc-btn" data-act="begin">New Game</button>
       <button class="sc-btn sc-btn2" data-act="load">Continue / Load</button>
       <div class="sc-keys">WASD move · Mouse look · 1–9 powers/spells · LMB cast/swing · Q shield · R sword · G/H mount · M map · K skills · J log · O saves</div>`
    );
    this.win = this._make(
      'sc-win',
      `<div class="sc-title">★ Victory ★</div>
       <div class="sc-sub">Every region boss has fallen — the world is liberated. You can keep exploring.</div>
       <button class="sc-btn" data-act="continue">Continue</button>`
    );
    this.over = this._make(
      'sc-over',
      `<div class="sc-title">Game Over</div>
       <div class="sc-sub">You fell in battle.</div>
       <button class="sc-btn" data-act="restart">Restart</button>`
    );

    for (const el of [this.start, this.win, this.over]) {
      el.addEventListener('click', (e) => {
        const act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'begin' && this.onBegin) this.onBegin();
        else if (act === 'load' && this.onLoad) this.onLoad();
        else if (act === 'continue' && this.onContinue) this.onContinue();
        else if (act === 'restart' && this.onRestart) this.onRestart();
      });
    }
  }

  _make(cls, html) {
    const d = document.createElement('div');
    d.className = 'sc-screen ' + cls;
    d.innerHTML = `<div class="sc-panel">${html}</div>`;
    d.style.display = 'none';
    document.body.appendChild(d);
    return d;
  }

  showStart() { this._only(this.start); }
  showWin() { this._only(this.win); }
  showGameOver() { this._only(this.over); }
  hide() { this._only(null); }
  _only(which) {
    for (const el of [this.start, this.win, this.over]) el.style.display = el === which ? 'flex' : 'none';
  }

  dispose() {
    for (const el of [this.start, this.win, this.over]) if (el.parentNode) el.parentNode.removeChild(el);
  }
}

let _injected = false;
function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
  .sc-screen { position:fixed; inset:0; z-index:31; display:none; align-items:center; justify-content:center;
    pointer-events:auto; font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  .sc-start { background:radial-gradient(circle at 50% 35%, #2a3550, #0b0d12); }
  .sc-win { background:radial-gradient(circle at 50% 40%, #3a3320, #0b0d12ee); }
  .sc-over { background:radial-gradient(circle at 50% 40%, #3a1010, #0b0d12ee); }
  .sc-panel { text-align:center; max-width:560px; padding:30px; }
  .sc-title { font-size:54px; font-weight:800; letter-spacing:4px; text-shadow:0 4px 30px #000a; margin-bottom:14px; }
  .sc-sub { font-size:16px; opacity:.85; line-height:1.5; margin-bottom:24px; }
  .sc-btn { pointer-events:auto; font-size:18px; padding:12px 40px; border-radius:12px; cursor:pointer;
    background:linear-gradient(90deg,#e0563f,#ffd24a); color:#1a1310; border:none; font-weight:800; letter-spacing:1px; }
  .sc-btn:hover { filter:brightness(1.08); }
  .sc-keys { margin-top:22px; font-size:12px; opacity:.6; line-height:1.7; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
