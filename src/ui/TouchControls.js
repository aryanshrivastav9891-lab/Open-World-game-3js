// =====================================================================
//  TouchControls — on-screen gamepad for phones & tablets.
//
//  Auto-shown when the game detects a touch device (see Controls.isTouchDevice
//  + Game). A left thumb-stick drives movement, dragging the rest of the
//  screen orbits the camera, and a cluster of buttons maps to the same key /
//  mouse actions a desktop player would use — so the entire game is playable
//  with two thumbs. All input is funnelled through the existing Controls
//  instance (touchMove / touchLook / touchPress / touchPrimary / …), leaving
//  the gameplay code unaware that the source is a screen instead of a keyboard.
// =====================================================================
export class TouchControls {
  constructor(controls, game) {
    this.controls = controls;
    this.game = game;
    this.visible = false;

    // Camera-look tuning (radians per CSS pixel dragged).
    this.lookSensX = 0.0045;
    this.lookSensY = 0.0040;

    // Active look pointer + last position (one finger drags the camera).
    this._lookId = null;
    this._lookX = 0;
    this._lookY = 0;

    // Joystick state.
    this._stickId = null;
    this._stickCx = 0;
    this._stickCy = 0;
    this._stickR = 58; // px the thumb can travel from centre

    injectStyles();
    this._build();
  }

  // ------------------------------------------------------------------
  //  DOM
  // ------------------------------------------------------------------
  _build() {
    const root = document.createElement('div');
    root.className = 'tc-root';
    root.style.display = 'none';
    this.root = root;

    // --- camera-look zone (full-screen base layer) ---
    const look = document.createElement('div');
    look.className = 'tc-look';
    root.appendChild(look);
    this._bindLook(look);

    // --- left thumb-stick ---
    const stick = document.createElement('div');
    stick.className = 'tc-stick';
    stick.innerHTML = '<div class="tc-stick-thumb"></div>';
    this._thumb = stick.querySelector('.tc-stick-thumb');
    root.appendChild(stick);
    this._bindStick(stick);

    // --- bottom-right action cluster ---
    const cluster = document.createElement('div');
    cluster.className = 'tc-cluster';
    root.appendChild(cluster);

    // Big primary button = left mouse (cast active power / swing sword).
    cluster.appendChild(this._hold('tc-primary', '✦', 'Cast / Attack',
      (d) => this.controls.touchPrimary(d)));
    // Jump (also flight-ascend while held).
    cluster.appendChild(this._hold('tc-btn tc-jump', '⤒', 'Jump', (d) => {
      if (d) this.controls.touchPress('Space');
      this.controls.touchHold('Space', d);
    }));
    // Interact / contextual cast (E).
    cluster.appendChild(this._tap('tc-btn tc-interact', 'E', 'Interact',
      () => this.controls.touchPress('KeyE')));
    // Block (right mouse held) — only bites while a sword is drawn.
    cluster.appendChild(this._hold('tc-btn tc-block', '🛡', 'Block',
      (d) => this.controls.touchBlock(d)));
    // Dash in the current movement direction (forward if standing still).
    cluster.appendChild(this._tap('tc-btn tc-dash', '»', 'Dash', () => {
      const f = this._lastF, r = this._lastR;
      if (Math.abs(f) < 0.05 && Math.abs(r) < 0.05) this.controls.touchDash(1, 0);
      else this.controls.touchDash(f, r);
    }));
    // Descend (flight) — held.
    cluster.appendChild(this._hold('tc-btn tc-down', '⤓', 'Descend',
      (d) => this.controls.touchHold('KeyC', d)));

    // --- right-edge vertical column of secondary actions ---
    const col = document.createElement('div');
    col.className = 'tc-col';
    root.appendChild(col);
    col.appendChild(this._tap('tc-btn tc-sm', 'R', 'Sword', () => this.controls.touchPress('KeyR')));
    col.appendChild(this._tap('tc-btn tc-sm', 'Q', 'Shield', () => this.controls.touchPress('KeyQ')));
    col.appendChild(this._tap('tc-btn tc-sm', '✈', 'Fly', () => this.controls.touchPress('KeyF')));
    col.appendChild(this._tap('tc-btn tc-sm', '⟳', 'Power', () => this.game.powers?.cycleActive(1)));
    col.appendChild(this._tap('tc-btn tc-sm', '🐎', 'Mount', () => this.controls.touchPress('KeyG')));

    // --- top-left menu bar ---
    const bar = document.createElement('div');
    bar.className = 'tc-bar';
    root.appendChild(bar);
    bar.appendChild(this._tap('tc-pill', '⏸', 'Pause', () => this.controls.touchPress('Escape')));
    bar.appendChild(this._tap('tc-pill', '🗺', 'Map', () => this.controls.touchPress('KeyM')));
    bar.appendChild(this._tap('tc-pill', '✦', 'Skills', () => this.controls.touchPress('KeyK')));
    bar.appendChild(this._tap('tc-pill', '📜', 'Log', () => this.controls.touchPress('KeyJ')));

    document.body.appendChild(root);
  }

  // A momentary button: fires `onDown()` once when pressed.
  _tap(cls, glyph, label, onDown) {
    const b = this._makeButton(cls, glyph, label);
    const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('tc-active'); onDown(); };
    const up = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.remove('tc-active'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    return b;
  }

  // A hold button: calls `onState(true)` on press, `onState(false)` on release.
  _hold(cls, glyph, label, onState) {
    const b = this._makeButton(cls, glyph, label);
    const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('tc-active'); onState(true); };
    const up = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.remove('tc-active'); onState(false); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    return b;
  }

  _makeButton(cls, glyph, label) {
    const b = document.createElement('button');
    b.className = cls;
    b.type = 'button';
    b.innerHTML = `<span class="tc-glyph">${glyph}</span><span class="tc-label">${label}</span>`;
    return b;
  }

  // ------------------------------------------------------------------
  //  Look zone — drag to orbit the camera
  // ------------------------------------------------------------------
  _bindLook(el) {
    el.addEventListener('pointerdown', (e) => {
      if (this._lookId !== null) return; // already tracking a finger
      this._lookId = e.pointerId;
      this._lookX = e.clientX;
      this._lookY = e.clientY;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._lookId) return;
      const dx = e.clientX - this._lookX;
      const dy = e.clientY - this._lookY;
      this._lookX = e.clientX;
      this._lookY = e.clientY;
      this.controls.touchLook(dx * this.lookSensX, dy * this.lookSensY);
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== this._lookId) return;
      this._lookId = null;
      e.preventDefault();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ------------------------------------------------------------------
  //  Thumb-stick — drag to move; push to the rim to sprint
  // ------------------------------------------------------------------
  _bindStick(el) {
    this._lastF = 0;
    this._lastR = 0;
    const rect = () => el.getBoundingClientRect();

    el.addEventListener('pointerdown', (e) => {
      if (this._stickId !== null) return;
      this._stickId = e.pointerId;
      const r = rect();
      this._stickCx = r.left + r.width / 2;
      this._stickCy = r.top + r.height / 2;
      el.setPointerCapture(e.pointerId);
      this._updateStick(e.clientX, e.clientY);
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      this._updateStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      this._thumb.style.transform = 'translate(-50%, -50%)';
      this._lastF = 0;
      this._lastR = 0;
      this.controls.touchMove(0, 0, false);
      e.preventDefault();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  _updateStick(px, py) {
    let dx = px - this._stickCx;
    let dy = py - this._stickCy;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, this._stickR);
    const nx = (dx / len) * clamped; // thumb offset in px (clamped to the ring)
    const ny = (dy / len) * clamped;
    this._thumb.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;

    // Normalised intent: up = forward, right = right. Dead-zone the centre.
    let r = nx / this._stickR;
    let f = -ny / this._stickR;
    const mag = Math.hypot(f, r);
    if (mag < 0.16) { f = 0; r = 0; }
    const run = mag > 0.92; // shove to the rim to sprint
    this._lastF = f;
    this._lastR = r;
    this.controls.touchMove(f, r, run);
  }

  // ------------------------------------------------------------------
  setVisible(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.root.style.display = on ? 'block' : 'none';
    if (on && !this._hintShown) this._showHint();
    if (!on) {
      // Releasing the screen mid-menu shouldn't leave inputs stuck on.
      this._stickId = null;
      this._lookId = null;
      this._lastF = 0;
      this._lastR = 0;
      if (this._thumb) this._thumb.style.transform = 'translate(-50%, -50%)';
      this.controls.touchMove(0, 0, false);
      this.controls.touchBlock(false);
      this.controls.touchPrimary(false);
      this.controls.touchHold('Space', false);
      this.controls.touchHold('KeyC', false);
    }
  }

  // First time the pad appears, flash a short "how to play" banner.
  _showHint() {
    this._hintShown = true;
    const h = document.createElement('div');
    h.className = 'tc-hint';
    h.textContent = 'Left stick: move · Drag screen: look · Buttons: act';
    this.root.appendChild(h);
    // fade in, then out after a few seconds
    requestAnimationFrame(() => h.classList.add('tc-hint-on'));
    setTimeout(() => {
      h.classList.remove('tc-hint-on');
      setTimeout(() => h.parentNode && h.parentNode.removeChild(h), 600);
    }, 4200);
  }

  dispose() {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}

let _injected = false;
function injectStyles() {
  if (_injected) return;
  _injected = true;
  const css = `
  .tc-root { position:fixed; inset:0; z-index:20; pointer-events:none;
    font-family:"Hiragino Sans","Yu Gothic","Segoe UI",system-ui,sans-serif;
    touch-action:none; -webkit-user-select:none; user-select:none; -webkit-tap-highlight-color:transparent; }
  .tc-root * { -webkit-user-select:none; user-select:none; }

  /* full-screen camera drag layer (sits under every button) */
  .tc-look { position:absolute; inset:0; pointer-events:auto; touch-action:none; }

  /* left thumb-stick */
  .tc-stick { position:absolute; left:max(22px, env(safe-area-inset-left)); bottom:max(26px, env(safe-area-inset-bottom));
    width:150px; height:150px; border-radius:50%; pointer-events:auto; touch-action:none;
    background:radial-gradient(circle, rgba(255,255,255,.08), rgba(255,255,255,.03));
    border:2px solid rgba(255,255,255,.18); box-shadow:0 6px 20px #0006; }
  .tc-stick-thumb { position:absolute; left:50%; top:50%; width:62px; height:62px; border-radius:50%;
    transform:translate(-50%,-50%);
    background:radial-gradient(circle at 38% 32%, #ffe7b0, #e0563f);
    border:2px solid rgba(255,255,255,.5); box-shadow:0 3px 12px #0008; }

  /* bottom-right action cluster */
  .tc-cluster { position:absolute; right:max(20px, env(safe-area-inset-right)); bottom:max(26px, env(safe-area-inset-bottom));
    width:230px; height:230px; pointer-events:none; }
  .tc-cluster > * { position:absolute; }
  .tc-primary  { right:6px;   bottom:78px; }
  .tc-jump     { right:108px; bottom:34px; }
  .tc-interact { right:128px; bottom:120px; }
  .tc-block    { right:36px;  bottom:158px; }
  .tc-dash     { right:150px; bottom:194px; }
  .tc-down     { right:174px; bottom:60px; }

  /* right-edge secondary column */
  .tc-col { position:absolute; right:max(14px, env(safe-area-inset-right)); top:50%; transform:translateY(-50%);
    display:flex; flex-direction:column; gap:12px; pointer-events:none; }

  /* top-left menu bar */
  .tc-bar { position:absolute; left:max(14px, env(safe-area-inset-left)); top:max(12px, env(safe-area-inset-top));
    display:flex; gap:10px; pointer-events:none; }

  /* buttons */
  .tc-root button { pointer-events:auto; touch-action:none; cursor:pointer; color:#f6efe2;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    background:rgba(26,19,16,.55); border:1.5px solid rgba(255,255,255,.22); border-radius:50%;
    backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); box-shadow:0 4px 14px #0006;
    transition:transform .06s ease, background .12s ease; line-height:1; }
  .tc-root button.tc-active { transform:scale(.9); background:rgba(224,86,63,.7); border-color:#ffd24a; }
  .tc-glyph { font-size:24px; }
  .tc-label { font-size:9px; opacity:.75; margin-top:3px; letter-spacing:.5px; text-transform:uppercase; }

  .tc-primary { width:96px; height:96px; background:rgba(224,86,63,.42); border-color:rgba(255,210,74,.8); }
  .tc-primary .tc-glyph { font-size:34px; }
  .tc-btn { width:66px; height:66px; }
  .tc-sm  { width:54px; height:54px; }
  .tc-sm .tc-glyph { font-size:20px; }
  .tc-pill { width:auto; min-width:48px; height:42px; border-radius:14px !important; padding:0 12px; }
  .tc-pill .tc-glyph { font-size:18px; }
  .tc-pill .tc-label { font-size:8px; }

  /* one-time how-to-play banner */
  .tc-hint { position:absolute; left:50%; top:18%; transform:translateX(-50%) translateY(-6px);
    background:rgba(26,19,16,.82); border:1px solid rgba(255,255,255,.2); color:#f6efe2;
    padding:10px 18px; border-radius:12px; font-size:13px; white-space:nowrap; max-width:92vw;
    opacity:0; transition:opacity .5s ease, transform .5s ease; pointer-events:none; }
  .tc-hint-on { opacity:1; transform:translateX(-50%) translateY(0); }

  /* this game's desktop pause hint is misleading on touch */
  body.ym-touch .ym-hint { display:none; }

  /* portrait phones: shrink a touch so nothing crowds the edges */
  @media (max-width: 480px) {
    .tc-stick { width:128px; height:128px; }
    .tc-stick-thumb { width:54px; height:54px; }
    .tc-cluster { width:200px; height:200px; }
    .tc-primary { width:84px; height:84px; }
    .tc-btn { width:58px; height:58px; }
  }

  /* =================================================================
     Mobile HUD layout — reflow the existing game UI for phone screens so
     nothing is clipped or hidden behind the on-screen controls. Scoped to
     body.ym-touch (set only on touch devices) with !important so it wins
     over panel styles that other modules inject lazily on first open.
     ================================================================= */

  /* Power bar → full-width scrollable strip pinned to the top, lifted above
     the camera-look layer so the 11 slots can be swiped through and tapped. */
  body.ym-touch .ah-wrap { top:calc(env(safe-area-inset-top,0px) + 6px) !important; bottom:auto !important;
    left:6px !important; right:6px !important; flex-direction:column !important; align-items:stretch !important;
    justify-content:flex-start !important; gap:6px !important; z-index:21 !important; }
  body.ym-touch .ah-center { order:1; width:100%; align-items:stretch !important; gap:6px !important; }
  body.ym-touch .ah-slots { overflow-x:auto; overflow-y:hidden; flex-wrap:nowrap !important; justify-content:flex-start;
    pointer-events:auto; padding:3px 2px 7px; -webkit-overflow-scrolling:touch; scrollbar-width:none; }
  body.ym-touch .ah-slots::-webkit-scrollbar { display:none; }
  body.ym-touch .ah-slot { width:50px !important; height:50px !important; flex:0 0 auto; cursor:pointer; }
  body.ym-touch .ah-slot.active { transform:translateY(-2px) scale(1.05) !important; }
  body.ym-touch .ah-ic { font-size:22px !important; margin-top:5px; }
  body.ym-touch .ah-nm { display:none !important; }
  body.ym-touch .ah-chips, body.ym-touch .ah-hints { display:none !important; }
  body.ym-touch .ah-vitals { order:2; display:flex !important; flex-direction:row !important; min-width:0 !important;
    gap:8px !important; width:100%; }
  body.ym-touch .ah-bar { flex:1 1 0; gap:5px; }
  body.ym-touch .ah-bar-label { width:auto !important; font-size:9px; }
  body.ym-touch .ah-bar-track { height:8px; }

  /* Minimap → smaller, on the right just below the power strip */
  body.ym-touch .ym-minimap { top:calc(env(safe-area-inset-top,0px) + 96px) !important; right:8px !important; width:100px !important; }
  body.ym-touch .ym-minimap canvas { width:100px !important; height:100px !important; }
  body.ym-touch .ym-maplabel { font-size:10px !important; margin-top:3px !important; }

  /* Touch menu pills → icon-only row, top-left below the power strip */
  body.ym-touch .tc-bar { top:calc(env(safe-area-inset-top,0px) + 96px) !important; left:8px !important; right:auto !important;
    flex-direction:row !important; justify-content:flex-start !important; flex-wrap:wrap; max-width:54vw; }
  body.ym-touch .tc-pill { min-width:42px; height:40px; padding:0 9px; border-radius:12px !important; }
  body.ym-touch .tc-pill .tc-label { display:none; }
  body.ym-touch .tc-pill .tc-glyph { font-size:19px; }

  /* Mission HUD → top-left, under the menu pills, compact */
  body.ym-touch .ym-mh { top:calc(env(safe-area-inset-top,0px) + 146px) !important; left:8px !important;
    min-width:0 !important; max-width:58vw; padding:8px 10px !important; }
  body.ym-touch .ym-mh-deathbig { font-size:32px !important; }
  body.ym-touch .ym-mh-deathsub { font-size:15px !important; }

  /* Bottom-right action buttons → a tidy, fully-bounded 3-wide grid (the
     hand-placed circles overflowed narrow screens). Primary stays emphasised. */
  body.ym-touch .tc-cluster { display:grid !important; grid-template-columns:repeat(3, 58px) !important;
    grid-auto-rows:58px !important; gap:9px !important; width:auto !important; height:auto !important;
    right:8px !important; bottom:calc(env(safe-area-inset-bottom,0px) + 8px) !important; }
  body.ym-touch .tc-cluster > button { position:static !important; inset:auto !important; right:auto !important;
    left:auto !important; top:auto !important; bottom:auto !important; width:58px !important; height:58px !important; }
  body.ym-touch .tc-primary { background:rgba(224,86,63,.5) !important; border-color:rgba(255,210,74,.9) !important; }
  body.ym-touch .tc-primary .tc-glyph { font-size:26px !important; }

  /* Secondary actions → a wrapping row just above the action grid, kept clear
     of the joystick on the left */
  body.ym-touch .tc-col { top:auto !important; bottom:calc(env(safe-area-inset-bottom,0px) + 148px) !important;
    right:8px !important; left:auto !important; transform:none !important; flex-direction:row !important;
    flex-wrap:wrap !important; justify-content:flex-end !important; gap:9px !important; max-width:calc(100vw - 172px); }
  body.ym-touch .tc-sm { width:50px !important; height:50px !important; }

  /* transient text → clear of the top bar and the thumb controls */
  body.ym-touch .ym-toast { top:30% !important; max-width:84vw !important; font-size:15px !important; }
  body.ym-touch .ym-prompt { bottom:28% !important; font-size:14px !important; }
  body.ym-touch .ym-stream { display:none !important; }
  body.ym-touch .ml-root { min-width:0 !important; max-width:86vw !important; }

  /* Full-screen menus → fit the viewport and scroll instead of clipping */
  body.ym-touch .ym-panel { min-width:0 !important; width:min(340px,92vw) !important; max-height:88vh; overflow:auto; padding:18px 20px !important; }
  body.ym-touch .ym-panel h1 { font-size:22px !important; }

  body.ym-touch .ym-map-inner { padding:14px 16px !important; max-height:92vh; overflow:auto; width:min(94vw,560px); }
  body.ym-touch .ym-map-body { flex-direction:column !important; align-items:center !important; gap:12px !important; }
  body.ym-touch .ym-map canvas { width:72vw !important; height:72vw !important; max-width:72vw !important; max-height:72vw !important; }
  body.ym-touch .ym-map-side { min-width:0 !important; width:100%; }
  body.ym-touch .ym-map-inner h1 { font-size:20px !important; }

  body.ym-touch .st-panel { min-width:0 !important; width:min(94vw,560px) !important; max-height:88vh; overflow:auto; padding:16px !important; }
  body.ym-touch .st-cols { flex-direction:column !important; gap:14px !important; }
  body.ym-touch .st-panel h1 { font-size:20px !important; }

  body.ym-touch .sl-panel { width:min(94vw,560px) !important; max-height:90vh; overflow:auto; padding:16px !important; }
  body.ym-touch .sl-new { flex-wrap:wrap; }

  body.ym-touch .sc-panel { padding:18px !important; max-height:92vh; overflow:auto; }
  body.ym-touch .sc-title { font-size:30px !important; }
  body.ym-touch .sc-sub { font-size:13px !important; }
  body.ym-touch .sc-keys { font-size:11px !important; }
  body.ym-touch .sc-btn { font-size:16px !important; padding:11px 26px !important; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
