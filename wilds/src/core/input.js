// Keyboard + mouse (pointer lock) + gamepad. Systems query actions, never raw keys.
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['ControlLeft', 'KeyC'],
  attack: ['Mouse0'], aim: ['Mouse2'], interact: ['KeyE'], shield: ['KeyQ'],
  inventory: ['Tab', 'KeyI'], map: ['KeyM'], pause: ['Escape'], lockon: ['KeyF'],
  throw: ['KeyR'], cook: ['KeyG'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();   // edges this frame
    this.released = new Set();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    const key = (e, isDown) => {
      if (!this.enabled) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this._set(e.code, isDown);
    };
    addEventListener('keydown', e => { if (!e.repeat) key(e, true); });
    addEventListener('keyup', e => key(e, false));
    canvas.addEventListener('mousedown', e => {
      if (!this.locked && canvas.requestPointerLock) canvas.requestPointerLock();
      this._set('Mouse' + e.button, true);
    });
    addEventListener('mouseup', e => this._set('Mouse' + e.button, false));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('blur', () => this.down.clear());
  }
  _set(code, isDown) {
    if (isDown && !this.down.has(code)) { this.down.add(code); this.pressed.add(code); }
    else if (!isDown && this.down.has(code)) { this.down.delete(code); this.released.add(code); }
  }
  _any(action, set) { return (BINDINGS[action] || [action]).some(c => set.has(c)); }
  held(action) { return this._any(action, this.down) || this._pad(action); }
  justPressed(action) { return this._any(action, this.pressed); }
  justReleased(action) { return this._any(action, this.released); }
  // Movement vector in [-1,1]^2 (x = right, y = forward).
  move() {
    let x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let y = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    const pad = this._gamepad();
    if (pad) { const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0; if (Math.hypot(ax, ay) > 0.15) { x = ax; y = -ay; } }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  look() {
    let dx = this.mouseDX, dy = this.mouseDY;
    const pad = this._gamepad();
    if (pad) { const ax = pad.axes[2] || 0, ay = pad.axes[3] || 0; if (Math.abs(ax) > 0.15) dx += ax * 12; if (Math.abs(ay) > 0.15) dy += ay * 12; }
    return { dx, dy };
  }
  _gamepad() { const g = navigator.getGamepads ? navigator.getGamepads()[0] : null; return g || null; }
  _pad(action) {
    const g = this._gamepad(); if (!g) return false;
    const map = { jump: 0, attack: 2, interact: 1, sprint: 5, shield: 4, aim: 6, inventory: 9, crouch: 10, lockon: 7 };
    const i = map[action]; return i !== undefined && g.buttons[i] && g.buttons[i].pressed;
  }
  endFrame() { this.pressed.clear(); this.released.clear(); this.mouseDX = this.mouseDY = 0; this.wheel = 0; }
}
