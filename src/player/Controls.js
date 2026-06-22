// Keyboard + mouse (pointer-lock) + optional gamepad input.
//
// Movement is reported as raw forward/right intent in [-1,1]; the Player
// resolves it relative to the camera. Discrete actions (jump, interact,
// pause, debug) are edge-triggered — call consume(code) once per frame.
export class Controls {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = Object.create(null);
    this.locked = false;
    this.sensitivity = 0.0022;
    this.invertY = false;

    // Accumulated mouse look since last camera update.
    this.yawDelta = 0;
    this.pitchDelta = 0;

    // Left mouse button: held state + edge (used to cast powers / swing sword).
    this.mouseDown = false;
    this._mouseEdge = false;
    this.rmbDown = false; // right mouse held → sword block
    this._dash = null; // pending double-tap dash { f, r }
    this._lastDir = Object.create(null);

    this._justPressed = new Set();
    this.onPointerUnlock = null; // Game hooks pause here

    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      // Control is used as a flight "descend" key, but its own keydown reports
      // ctrlKey=true — record it before the modifier bail-out below.
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.keys[e.code] = true;
      // Don't steal browser shortcuts with modifiers.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!e.repeat) {
        this._justPressed.add(e.code);
        // double-tap Space → toggle flight
        if (e.code === 'Space') {
          const now = performance.now();
          if (now - (this._lastSpace || 0) < 300) this._flightToggle = true;
          this._lastSpace = now;
        }
        // double-tap a movement key → dash in that direction
        const dir = DASH_DIR[e.code];
        if (dir) {
          const now = performance.now();
          if (now - (this._lastDir[e.code] || 0) < 280) this._dash = { f: dir[0], r: dir[1] };
          this._lastDir[e.code] = now;
        }
      }
      this.keys[e.code] = true;
      if (PREVENT.has(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.yawDelta -= e.movementX * this.sensitivity;
      this.pitchDelta += (this.invertY ? 1 : -1) * e.movementY * this.sensitivity;
    };
    this._onMouseDown = (e) => {
      if (e.button === 2) { this.rmbDown = true; return; } // right → block
      if (e.button !== 0) return;
      this.mouseDown = true;
      if (this.locked) this._mouseEdge = true; // ignore the click that grabs the lock
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
      else if (e.button === 2) this.rmbDown = false;
    };
    this._onContext = (e) => {
      if (this.locked) e.preventDefault(); // no context menu while playing (right = block)
    };
    this._onLockChange = () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.dom;
      if (wasLocked && !this.locked) {
        // Lost focus (pause / enter-house / Esc): flush buffered edge presses
        // and look deltas so nothing fires spuriously when play resumes.
        this._justPressed.clear();
        this.mouseDown = false;
        this._mouseEdge = false;
        this.rmbDown = false;
        this._dash = null;
        this._lastDir = Object.create(null);
        this._flightToggle = false;
        this._lastSpace = 0;
        this.yawDelta = 0;
        this.pitchDelta = 0;
        if (this.onPointerUnlock) this.onPointerUnlock();
      }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mousedown', this._onMouseDown);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  // Edge-triggered double-tap dash: returns { f, r } once, or null.
  consumeDash() {
    if (this._dash) {
      const d = this._dash;
      this._dash = null;
      return d;
    }
    return null;
  }

  // Edge-triggered left-click (true once per press while pointer-locked).
  consumeMouse() {
    if (this._mouseEdge) {
      this._mouseEdge = false;
      return true;
    }
    return false;
  }

  // Edge-triggered flight toggle (double-tap Space, or call from a key).
  consumeFlightToggle() {
    if (this._flightToggle) {
      this._flightToggle = false;
      return true;
    }
    return false;
  }

  requestLock() {
    if (!this.locked && this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  exitLock() {
    if (this.locked && document.exitPointerLock) document.exitPointerLock();
  }

  // Edge-triggered: true once per physical press.
  consume(code) {
    if (this._justPressed.has(code)) {
      this._justPressed.delete(code);
      return true;
    }
    return false;
  }

  get forward() {
    return (
      (this.keys['KeyW'] || this.keys['ArrowUp'] ? 1 : 0) -
      (this.keys['KeyS'] || this.keys['ArrowDown'] ? 1 : 0) +
      this._padForward
    );
  }

  get right() {
    return (
      (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0) -
      (this.keys['KeyA'] || this.keys['ArrowLeft'] ? 1 : 0) +
      this._padRight
    );
  }

  get run() {
    return !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this._padRun);
  }

  // --- optional gamepad ------------------------------------------------
  pollGamepad() {
    this._padForward = 0;
    this._padRight = 0;
    this._padRun = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (!gp) return;
    const dz = (v) => (Math.abs(v) > 0.18 ? v : 0);
    this._padRight = dz(gp.axes[0] || 0);
    this._padForward = -dz(gp.axes[1] || 0);
    // right stick look
    this.yawDelta -= dz(gp.axes[2] || 0) * 0.045;
    this.pitchDelta += (this.invertY ? 1 : -1) * dz(gp.axes[3] || 0) * 0.045;
    this._padRun = gp.buttons[10] && gp.buttons[10].pressed; // L3
    // edge buttons: A=jump(0), X=interact(2), Start=pause(9)
    this._padEdge(gp, 0, 'Space');
    this._padEdge(gp, 2, 'KeyE');
    this._padEdge(gp, 9, 'Escape');
  }

  _padEdge(gp, index, code) {
    const pressed = gp.buttons[index] && gp.buttons[index].pressed;
    this._padPrev = this._padPrev || {};
    if (pressed && !this._padPrev[index]) this._justPressed.add(code);
    this._padPrev[index] = pressed;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mousedown', this._onMouseDown);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

Controls.prototype._padForward = 0;
Controls.prototype._padRight = 0;
Controls.prototype._padRun = false;

const PREVENT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
]);

// double-tap → dash direction as [forward, right] input intent
const DASH_DIR = {
  KeyW: [1, 0], ArrowUp: [1, 0],
  KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyD: [0, 1], ArrowRight: [0, 1],
  KeyA: [0, -1], ArrowLeft: [0, -1],
};
