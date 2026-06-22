// =====================================================================
//  SaveLoadUI — the save/load/delete panel (named slots) used both from the
//  pause menu (O) and the start screen ("Load Game"). Shows each slot's
//  metadata (name · level · location · timestamp) and offers Save (typed name),
//  Load, Delete, plus JSON Export / Import (download / upload a backup file).
//  Pure DOM; Game provides the callbacks + the slot list.
// =====================================================================
export class SaveLoadUI {
  constructor() {
    injectStyles();
    this.onSave = null; this.onLoad = null; this.onDelete = null; this.onExport = null; this.onImport = null; this.onClose = null;
    this.visible = false;

    const root = document.createElement('div');
    root.className = 'sl-root';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="sl-panel">
        <h1>Saved Games <span>セーブ</span></h1>
        <div class="sl-new">
          <input class="sl-name" type="text" placeholder="save name…" maxlength="24" />
          <button class="sl-act sl-save">Save</button>
          <label class="sl-act sl-import">Import<input type="file" accept="application/json" hidden /></label>
        </div>
        <div class="sl-list"></div>
        <div class="sl-hint">O / Esc to close</div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.nameInput = root.querySelector('.sl-name');
    this.listEl = root.querySelector('.sl-list');

    root.querySelector('.sl-save').addEventListener('click', () => {
      const n = (this.nameInput.value || '').trim();
      if (n && this.onSave) this.onSave(n);
    });
    const fileInput = root.querySelector('.sl-import input');
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { if (this.onImport) this.onImport(String(r.result)); };
      r.readAsText(f);
      e.target.value = '';
    });
  }

  open(list) { this.visible = true; this.root.style.display = 'flex'; this.refresh(list); }
  close() { this.visible = false; this.root.style.display = 'none'; }

  refresh(list) {
    this.listEl.innerHTML = '';
    if (!list || !list.length) {
      this.listEl.innerHTML = '<div class="sl-empty">No saves yet.</div>';
      return;
    }
    for (const s of list) {
      const row = document.createElement('div');
      row.className = 'sl-row';
      const when = s.timestamp ? new Date(s.timestamp).toLocaleString() : '';
      row.innerHTML = `<div class="sl-meta"><b>${esc(s.name)}</b><span>Lv ${s.level} · ${esc(s.location || s.region || '')}</span><i>${when}</i></div>`;
      const btns = document.createElement('div');
      btns.className = 'sl-rowbtns';
      const mk = (label, cb, cls = '') => { const b = document.createElement('button'); b.className = 'sl-act ' + cls; b.textContent = label; b.addEventListener('click', cb); btns.appendChild(b); };
      mk('Load', () => this.onLoad && this.onLoad(s.name), 'sl-load');
      mk('Export', () => this.onExport && this.onExport(s.name));
      mk('✕', () => this.onDelete && this.onDelete(s.name), 'sl-del');
      row.appendChild(btns);
      this.listEl.appendChild(row);
    }
  }

  dispose() { if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); }
}

function esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

let _injected = false;
function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
  .sl-root { position:fixed; inset:0; z-index:24; display:flex; align-items:center; justify-content:center;
    background:#0b0d12d8; backdrop-filter:blur(4px); pointer-events:auto;
    font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif; color:#f6efe2; }
  .sl-panel { background:#161a24ee; border:1px solid #ffffff22; border-radius:16px; padding:20px 24px; width:min(560px,92vw); }
  .sl-panel h1 { font-size:23px; letter-spacing:2px; margin-bottom:14px; }
  .sl-panel h1 span { font-size:14px; opacity:.55; }
  .sl-new { display:flex; gap:8px; margin-bottom:14px; }
  .sl-name { flex:1; background:#0b0d12; color:#f6efe2; border:1px solid #ffffff22; border-radius:8px; padding:8px 10px; font-size:14px; }
  .sl-act { pointer-events:auto; background:#2a3550; color:#f6efe2; border:1px solid #ffffff22; border-radius:8px; padding:7px 12px; font-size:13px; cursor:pointer; }
  .sl-act:hover { background:#39456a; }
  .sl-save { background:linear-gradient(90deg,#e0563f,#ffd24a); color:#1a1310; font-weight:700; border:none; }
  .sl-import { display:inline-flex; align-items:center; }
  .sl-list { max-height:48vh; overflow:auto; display:flex; flex-direction:column; gap:8px; }
  .sl-empty { opacity:.5; font-size:13px; text-align:center; padding:16px; }
  .sl-row { display:flex; align-items:center; justify-content:space-between; gap:10px;
    background:#222838; border:1px solid #ffffff14; border-radius:10px; padding:10px 12px; }
  .sl-meta { display:flex; flex-direction:column; }
  .sl-meta b { font-size:14px; color:#ffd9a0; }
  .sl-meta span { font-size:12px; opacity:.85; }
  .sl-meta i { font-size:11px; opacity:.55; font-style:normal; }
  .sl-rowbtns { display:flex; gap:6px; }
  .sl-load { background:#2f5a3a; }
  .sl-del { background:#5a2a2a; }
  .sl-hint { margin-top:14px; font-size:12px; opacity:.5; text-align:center; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
