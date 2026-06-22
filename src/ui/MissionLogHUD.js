// =====================================================================
//  MissionLogHUD — a quest log panel (toggle with J). Non-blocking overlay
//  (doesn't pause the game): lists every active/completed mission with its
//  objective + progress. Rendered from MissionManager.getLog().
// =====================================================================
export class MissionLogHUD {
  constructor() {
    injectStyles();
    const root = document.createElement('div');
    root.className = 'ml-root';
    root.style.display = 'none';
    root.innerHTML = `<h2>Mission Log <span>任務</span></h2><ul class="ml-list"></ul><div class="ml-hint">J to close</div>`;
    document.body.appendChild(root);
    this.root = root;
    this.list = root.querySelector('.ml-list');
    this.visible = false;
    this._last = '';
  }

  toggle() { this.visible ? this.close() : this.open(); }
  open() { this.visible = true; this.root.style.display = 'block'; }
  close() { this.visible = false; this.root.style.display = 'none'; }

  render(log) {
    // cheap diff so we don't rebuild the DOM every frame
    const key = log.map((m) => m.title + m.objective + m.done).join('|');
    if (key === this._last) return;
    this._last = key;
    this.list.innerHTML = '';
    for (const m of log) {
      const li = document.createElement('li');
      li.className = m.done ? 'done' : '';
      li.innerHTML = `<b>${m.done ? '✓' : '•'} ${m.title}</b><span>${m.objective}</span>`;
      this.list.appendChild(li);
    }
  }

  dispose() { if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); }
}

let _injected = false;
function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
  .ml-root { position:fixed; top:14px; left:50%; transform:translateX(-50%); z-index:14; pointer-events:none;
    background:#1a1310cc; border:1px solid #ffffff22; border-radius:12px; padding:12px 16px; min-width:300px; max-width:60vw;
    backdrop-filter:blur(3px); font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  .ml-root h2 { font-size:16px; letter-spacing:2px; margin-bottom:8px; }
  .ml-root h2 span { font-size:12px; opacity:.55; }
  .ml-list { list-style:none; margin:0; padding:0; max-height:50vh; overflow:auto; }
  .ml-list li { display:flex; flex-direction:column; padding:5px 0; border-top:1px solid #ffffff12; font-size:13px; }
  .ml-list li b { color:#ffd9a0; font-weight:700; }
  .ml-list li span { font-size:12px; opacity:.8; }
  .ml-list li.done b { color:#7fe08a; }
  .ml-list li.done { opacity:.7; }
  .ml-hint { margin-top:8px; font-size:11px; opacity:.5; text-align:center; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
