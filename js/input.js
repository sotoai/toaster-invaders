/* ===========================================================================
 * TOASTER INVADERS — js/input.js
 *
 * ROLE: the only file that talks to hardware. Turns two Xbox controllers, the
 * keyboard fallback and the on-screen touch controls into two stable PadState
 * objects the rest of the game can read synchronously.
 *
 *   T.Input.init()                        attach listeners; call once at boot
 *   T.Input.poll()                        call ONCE per frame, before update
 *   T.Input.get(i)                        i = 0 | 1 → PadState (stable object)
 *   T.Input.anyPressed(name)              either pad's rising edge this frame
 *   T.Input.padCount()                    physically connected gamepads
 *   T.Input.isGamepad(i)                  slot i is backed by a real gamepad
 *   T.Input.consume(i, name)              clear one rising edge
 *   T.Input.rumble(i, ms, strong, weak)   best-effort haptics, never throws
 *   T.Input.onFirstGesture(cb)            fires once, so main.js can unlock audio
 *   T.Input.setVirtual(slot, name, held)  press/release an on-screen control
 *   T.Input.clearVirtual(slot)            release everything touch holds there
 *   T.Input.hasVirtual(slot)              touch is driving this slot
 *
 * Design rules that matter here:
 *   - navigator.getGamepads() is polled ONCE per frame and the Gamepad objects
 *     are never kept past the end of poll(); Chrome hands back fresh snapshots
 *     and a stale reference silently stops updating.
 *   - Slot assignment is sticky: gamepad.index → player slot is remembered, so
 *     a pad that unplugs and comes back gets its old slot if it is still free.
 *     A pad parked in slot 1 can never bleed into slot 0.
 *   - Every '*Pressed' flag is a rising edge computed inside poll() by diffing
 *     against the value the state object still holds from the previous frame.
 *   - PadState objects are built once and mutated in place — poll() allocates
 *     nothing except the array navigator.getGamepads() insists on returning.
 *   - The keyboard bindings stay live even when pads are connected, so the game
 *     is always testable and a slot can be driven by either device.
 *   - Touch (js/touch.js) is a THIRD source, not a replacement: it feeds a
 *     virtual pad that poll() ORs into the slot before the rising edges are
 *     computed, so keyboard and gamepad behaviour is bit-for-bit unchanged and
 *     all three can drive the same slot at once. See the VIRTUAL PAD block.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const clamp = T.Util.clamp;

  /* -------------------------------------------------------------------------
   * TUNABLES
   * util.js owns T.C and section 3 of the spec does not list the input
   * numbers there, so these live here — the one place that reads them. If a
   * future util.js ever does publish them, they win automatically.
   * ---------------------------------------------------------------------- */
  /* Clamped below 1 so the rescale divisor can never reach zero (a deadzone of
   * exactly 1 would turn every stick read into NaN and teleport the ship). */
  const STICK_DEADZONE = clamp(
    (T.C && typeof T.C.STICK_DEADZONE === 'number') ? T.C.STICK_DEADZONE : 0.28,
    0, 0.95);

  /** Analogue triggers count as "down" from here up (buttons 6 / 7). */
  const BUTTON_THRESHOLD =
    (T.C && typeof T.C.BUTTON_THRESHOLD === 'number') ? T.C.BUTTON_THRESHOLD : 0.5;

  const RUMBLE_DEFAULT_MS = 120;
  const RUMBLE_DEFAULT_STRONG = 0.6;
  const RUMBLE_DEFAULT_WEAK = 0.35;
  const RUMBLE_MAX_MS = 5000;

  const SLOT_COUNT = 2;

  /* Standard Gamepad API button indices (Xbox layout). */
  const BTN_A = 0;
  const BTN_B = 1;
  const BTN_X = 2;
  const BTN_Y = 3;
  const BTN_RB = 5;
  const BTN_RT = 7;
  const BTN_VIEW = 8;    // Back / View
  const BTN_START = 9;
  const BTN_DPAD_UP = 12;
  const BTN_DPAD_DOWN = 13;
  const BTN_DPAD_LEFT = 14;
  const BTN_DPAD_RIGHT = 15;

  const AXIS_LX = 0;
  const AXIS_LY = 1;

  /* -------------------------------------------------------------------------
   * KEYBOARD BINDINGS
   * P1: A / D move, Space or W fire, Enter start, Esc back.
   * P2: ArrowLeft / ArrowRight, ArrowUp or '/' fire, RightShift start,
   *     Backspace back.
   * Up/down and altChar round the set out so menus are fully drivable from the
   * keyboard alone; note W and ArrowUp deliberately double as fire, exactly as
   * the spec lists them. Arrays are module-level constants — never rebuilt.
   * ---------------------------------------------------------------------- */
  const P1_FIRE_KEYS = ['Space', 'KeyW'];
  const P2_FIRE_KEYS = ['ArrowUp', 'Slash'];

  const KEYMAP = [
    {
      left: 'KeyA',
      right: 'KeyD',
      up: 'KeyW',
      down: 'KeyS',
      fire: P1_FIRE_KEYS,
      start: 'Enter',
      back: 'Escape',
      altChar: 'KeyQ'
    },
    {
      left: 'ArrowLeft',
      right: 'ArrowRight',
      up: 'ArrowUp',
      down: 'ArrowDown',
      fire: P2_FIRE_KEYS,
      start: 'ShiftRight',
      back: 'Backspace',
      altChar: 'Period'
    }
  ];

  /* Codes we swallow so the browser does not scroll, quick-find or go Back.
   * Escape and Enter are left alone on purpose (fullscreen / accessibility).
   *
   * Both of these tables are null-prototype: they are looked up with strings
   * that come from callers, and a plain object literal would happily answer
   * 'constructor' or 'toString' with something inherited from Object.prototype. */
  const SWALLOW = Object.assign(Object.create(null), {
    Space: true,
    ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true,
    Slash: true, Backspace: true
  });

  /* Rising-edge field name for each logical button, used by consume(). */
  const EDGE_FIELD = Object.assign(Object.create(null), {
    fire: 'firePressed',
    start: 'startPressed',
    back: 'backPressed',
    up: 'upPressed',
    down: 'downPressed',
    left: 'leftPressed',
    right: 'rightPressed',
    altChar: 'altCharPressed'
  });

  /* -------------------------------------------------------------------------
   * PAD STATE
   * One per slot, created at load and mutated in place forever after.
   * ---------------------------------------------------------------------- */
  function PadState(slot) {
    this.slot = slot;

    this.axisX = 0;        // -1..1, deadzoned and rescaled
    this.axisY = 0;        // -1..1, same treatment (menus / debug)

    this.left = false;
    this.right = false;
    this.up = false;
    this.down = false;

    this.fire = false;
    this.start = false;
    this.back = false;
    this.altChar = false;

    this.firePressed = false;
    this.startPressed = false;
    this.backPressed = false;
    this.upPressed = false;
    this.downPressed = false;
    this.leftPressed = false;
    this.rightPressed = false;
    this.altCharPressed = false;

    // True when the slot is actually being driven by something: a real gamepad,
    // a keyboard whose bindings for this slot have been used at least once, or
    // an on-screen touch control that has claimed it.
    this.connected = false;
  }

  const states = [new PadState(0), new PadState(1)];

  /** gamepad.index → slot, remembered across disconnects. */
  const slotForPadIndex = Object.create(null);

  /** Live Gamepad objects for this frame only; nulled at the end of poll(). */
  const livePads = [null, null];

  /** Which hardware index is driving each slot right now (-1 = keyboard only). */
  const slotPadIndex = [-1, -1];

  /** A slot's keyboard counts as "connected" once its owner has touched a key. */
  const keyboardClaimed = [false, false];

  let connectedPadCount = 0;
  let initialised = false;

  /* -------------------------------------------------------------------------
   * VIRTUAL PAD (the on-screen touch controls — SPEC-TOUCH.md §1)
   *
   * js/touch.js does NOT reimplement game input. It draws thumb controls and
   * pushes their held/released state in here through setVirtual(); poll() then
   * ORs that state into the slot's PadState alongside the gamepad and the
   * keyboard. Downstream files (game.js, ui.js, weapons.js) never learn that
   * touch exists.
   *
   * Three rules this block exists to guarantee:
   *
   *   1. TOUCH IS ADDITIVE. It is merged on top of the pad and the keyboard,
   *      never instead of them, so a slot driven by a thumb still answers to
   *      its keys and its controller. None of the three sources disables
   *      another, and a slot nobody has touched behaves exactly as before.
   *   2. THE MERGE HAPPENS BEFORE THE RISING-EDGE DIFF in updateSlot(), so a
   *      thumb produces firePressed / startPressed identically to a key or a
   *      gamepad button. Merging after the diff would leave every touch press
   *      permanently un-pressed.
   *   3. NOTHING EVER STICKS. A held direction that is never released sends
   *      the ship into a wall forever, so every escape route — the touch
   *      layer's own pointercancel handling, clearVirtual(), blur, and a
   *      hidden tab — drops the held bits.
   *
   * `virtualHeld` is what a thumb is holding right now. `virtualTap` mirrors
   * the keyboard's `tappedCodes` latch: a press that goes down AND up between
   * two polls would otherwise never be seen at all, and on a touchscreen a
   * sub-frame tap on FIRE is entirely normal. A latched name reads as held for
   * exactly one poll, which yields one frame of `fire` plus its rising edge;
   * the latch is cleared at the end of that poll, like tappedCodes.
   *
   * Both objects are built once and mutated in place — no per-frame garbage.
   * ---------------------------------------------------------------------- */

  /** The logical names touch may drive. Null-prototype: the keys are caller data. */
  const VIRTUAL_NAMES = Object.assign(Object.create(null), {
    left: true, right: true, up: true, down: true,
    fire: true, start: true, back: true, altChar: true
  });

  function VirtualState() {
    this.left = false;
    this.right = false;
    this.up = false;
    this.down = false;
    this.fire = false;
    this.start = false;
    this.back = false;
    this.altChar = false;
  }

  /** What a thumb is holding, per slot. */
  const virtualHeld = [new VirtualState(), new VirtualState()];

  /** Fresh presses seen since the last poll, per slot; cleared inside poll(). */
  const virtualTap = [new VirtualState(), new VirtualState()];

  /** A slot counts as touch-driven once an on-screen control has pressed it. */
  const virtualClaimed = [false, false];

  /** Held now, or tapped since the last poll (so a sub-frame tap survives). */
  function virtualHold(slot, name) {
    return virtualHeld[slot][name] === true || virtualTap[slot][name] === true;
  }

  /** Did this name see a FRESH virtual press since the last poll? */
  function virtualTapped(slot, name) {
    return virtualTap[slot][name] === true;
  }

  /**
   * Clear every field of one VirtualState.
   *
   * Written out longhand rather than as a loop over VIRTUAL_NAMES because
   * poll() calls this twice on every frame: a `for...in` there would be eight
   * string lookups and an enumeration the engine may have to allocate for, in
   * the one function that is specified to allocate nothing.
   */
  function resetVirtualState(v) {
    v.left = false;
    v.right = false;
    v.up = false;
    v.down = false;
    v.fire = false;
    v.start = false;
    v.back = false;
    v.altChar = false;
  }

  /** Drop every held bit and every pending tap for one slot. */
  function wipeVirtual(slot) {
    resetVirtualState(virtualHeld[slot]);
    resetVirtualState(virtualTap[slot]);
  }

  /**
   * Release the touch controls for BOTH slots without un-claiming them.
   *
   * This is the panic path — blur, a hidden tab, an interrupted gesture — and
   * it deliberately mirrors releaseAllKeys(): the dangerous part of the state
   * is the held bits, and dropping the claim as well would make a player who
   * joined by touch look disconnected the moment the tab went to the
   * background. clearVirtual() is the call that says "this slot is done".
   */
  function releaseAllVirtual() {
    wipeVirtual(0);
    wipeVirtual(1);
  }

  /* -------------------------------------------------------------------------
   * KEYBOARD TRACKING
   * keysDown holds what is physically held. tappedCodes latches keys that went
   * down and up again between two polls, so a very fast tap is never dropped;
   * it is cleared at the end of every poll().
   * ---------------------------------------------------------------------- */
  const keysDown = Object.create(null);
  const tappedCodes = [];

  function keyHeld(code) {
    if (keysDown[code] === true) return true;
    for (let i = 0; i < tappedCodes.length; i++) {
      if (tappedCodes[i] === code) return true;
    }
    return false;
  }

  /** Binding may be a single code or an array of alternatives. */
  function bindingHeld(binding) {
    if (typeof binding === 'string') return keyHeld(binding);
    for (let i = 0; i < binding.length; i++) {
      if (keyHeld(binding[i])) return true;
    }
    return false;
  }

  /**
   * Did this binding see a FRESH key-down since the last poll?
   *
   * onKeyDown only latches a code that was not already held, so auto-repeat is
   * excluded and this is true exactly once per physical press. It matters for
   * the press that FOLLOWS a release inside a single frame: the key reads as
   * held on both sides of the held/previously-held diff, so without this latch
   * the second tap of a fast double-tap would silently vanish. Cheap: the array
   * is empty on almost every frame.
   */
  function bindingTapped(binding) {
    if (tappedCodes.length === 0) return false;
    if (typeof binding === 'string') return tappedCodes.indexOf(binding) !== -1;
    for (let i = 0; i < binding.length; i++) {
      if (tappedCodes.indexOf(binding[i]) !== -1) return true;
    }
    return false;
  }

  /**
   * KeyboardEvent.code, with a best-effort reconstruction for the handful of
   * old engines that only give us .key. Returns '' when nothing usable exists.
   */
  function codeOf(e) {
    if (typeof e.code === 'string' && e.code.length > 0) return e.code;

    const k = e.key;
    if (typeof k !== 'string' || k.length === 0) return '';
    if (k === ' ' || k === 'Spacebar') return 'Space';
    if (k === '/') return 'Slash';
    if (k === '.') return 'Period';
    if (k === 'Shift') return e.location === 2 ? 'ShiftRight' : 'ShiftLeft';
    if (k === 'Esc') return 'Escape';
    if (k === 'Left' || k === 'Right' || k === 'Up' || k === 'Down') return 'Arrow' + k;
    if (k.length === 1) {
      const up = k.toUpperCase();
      if (up >= 'A' && up <= 'Z') return 'Key' + up;
    }
    return k;                        // Enter, Escape, Backspace, Arrow* already match
  }

  /** Does this code belong to either player? Used to decide preventDefault. */
  function ownedByGame(code) {
    for (let s = 0; s < KEYMAP.length; s++) {
      const m = KEYMAP[s];
      if (code === m.left || code === m.right || code === m.up || code === m.down) return true;
      if (code === m.start || code === m.back || code === m.altChar) return true;
      for (let i = 0; i < m.fire.length; i++) if (code === m.fire[i]) return true;
    }
    return false;
  }

  /** Mark a slot's keyboard as in use the moment one of its keys is touched. */
  function claimKeyboard(code) {
    for (let s = 0; s < KEYMAP.length; s++) {
      const m = KEYMAP[s];
      let mine = (code === m.left || code === m.right || code === m.up ||
                  code === m.down || code === m.start || code === m.back ||
                  code === m.altChar);
      if (!mine) {
        for (let i = 0; i < m.fire.length; i++) {
          if (code === m.fire[i]) { mine = true; break; }
        }
      }
      if (mine) keyboardClaimed[s] = true;
    }
  }

  function onKeyDown(e) {
    const code = codeOf(e);
    if (code === '') return;

    // A keypress is a real user gesture — unlock audio from inside the handler.
    fireGesture();

    if (keysDown[code] !== true) {
      keysDown[code] = true;
      if (tappedCodes.indexOf(code) === -1) tappedCodes.push(code);
    }
    claimKeyboard(code);

    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plain && SWALLOW[code] === true && ownedByGame(code)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    const code = codeOf(e);
    if (code === '') return;
    keysDown[code] = false;

    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plain && SWALLOW[code] === true && ownedByGame(code)) {
      e.preventDefault();
    }
  }

  /**
   * Alt-tabbing away must not leave the ship sliding into a wall forever.
   *
   * The on-screen controls go with them: a system gesture or an incoming call
   * can steal a pointer mid-press without the touch layer ever seeing the
   * release, and a virtual direction left held is exactly as fatal as a stuck
   * key. Both of this function's callers — blur and visibilitychange — get the
   * virtual wipe for free by going through here.
   */
  function releaseAllKeys() {
    for (const code in keysDown) keysDown[code] = false;
    tappedCodes.length = 0;
    releaseAllVirtual();
  }

  function onBlur() {
    releaseAllKeys();
  }

  function onVisibility() {
    if (document.hidden) releaseAllKeys();
  }

  function onPointerDown() {
    fireGesture();
  }

  /* -------------------------------------------------------------------------
   * FIRST-GESTURE HOOK
   * main.js / audio.js hang the AudioContext resume off this.
   * ---------------------------------------------------------------------- */
  const gestureCallbacks = [];
  let gestureFired = false;

  function fireGesture() {
    if (gestureFired) return;
    gestureFired = true;
    for (let i = 0; i < gestureCallbacks.length; i++) {
      try {
        gestureCallbacks[i]();
      } catch (err) {
        /* a broken listener must never take the input system down */
      }
    }
    gestureCallbacks.length = 0;
  }

  /** Register a callback for the first keypress / pad button / pointer press. */
  function onFirstGesture(cb) {
    if (typeof cb !== 'function') return;
    if (gestureFired) {
      try { cb(); } catch (err) { /* ignore */ }
      return;
    }
    gestureCallbacks.push(cb);
  }

  /* -------------------------------------------------------------------------
   * GAMEPAD READING (defensive — pads lie about their shape all the time)
   * ---------------------------------------------------------------------- */
  const NO_PADS = [];

  function getPads() {
    try {
      if (typeof navigator === 'undefined') return NO_PADS;
      if (typeof navigator.getGamepads === 'function') {
        return navigator.getGamepads() || NO_PADS;
      }
      if (typeof navigator.webkitGetGamepads === 'function') {
        return navigator.webkitGetGamepads() || NO_PADS;
      }
    } catch (err) {
      /* some engines throw in insecure or sandboxed contexts */
    }
    return NO_PADS;
  }

  /** Hardware slot id, falling back to array position on odd implementations. */
  function padIndexOf(pad, fallback) {
    return (pad && typeof pad.index === 'number') ? pad.index : fallback;
  }

  /**
   * True when button `i` is pressed. buttons[i] may be missing entirely, may be
   * a bare number on old implementations, and may be an object whose .value is
   * analogue (triggers) while .pressed is the digital truth.
   */
  function buttonDown(pad, i) {
    const list = pad.buttons;
    if (!list) return false;
    const b = list[i];
    if (b === undefined || b === null) return false;
    if (typeof b === 'number') return b >= BUTTON_THRESHOLD;
    if (typeof b.value === 'number' && b.value >= BUTTON_THRESHOLD) return true;
    return b.pressed === true;
  }

  /** Raw axis read that survives short / missing axis arrays. */
  function axisRaw(pad, i) {
    const axes = pad.axes;
    if (!axes) return 0;
    const v = axes[i];
    return (typeof v === 'number' && v === v) ? v : 0;   // v === v rejects NaN
  }

  /**
   * Deadzone with RESCALE: outside the dead area the value ramps from 0 to 1
   * again, so the ship eases in instead of snapping to a third of full speed.
   */
  function deadzone(v) {
    const a = v < 0 ? -v : v;
    if (a <= STICK_DEADZONE) return 0;
    const scaled = (a - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    const out = scaled > 1 ? 1 : scaled;
    return v < 0 ? -out : out;
  }

  /** Any button at all — used only to detect the first gamepad gesture. */
  function anyButtonDown(pad) {
    const list = pad.buttons;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      if (buttonDown(pad, i)) return true;
    }
    return false;
  }

  /* -------------------------------------------------------------------------
   * SLOT ASSIGNMENT
   * Two passes, so a remembered pad always beats a newcomer to its old slot.
   * ---------------------------------------------------------------------- */
  function assignSlots(pads) {
    livePads[0] = null;
    livePads[1] = null;
    // Recorded as each slot is filled, never recomputed afterwards: padIndexOf's
    // fallback depends on the pad's position in the getGamepads() array, so
    // re-deriving it later from the slot number would invent a different id and
    // send rumble() hunting for a pad that does not exist.
    slotPadIndex[0] = -1;
    slotPadIndex[1] = -1;
    connectedPadCount = 0;

    // Pass 1 — honour remembered index → slot mappings.
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || p.connected === false) continue;
      connectedPadCount++;

      const idx = padIndexOf(p, i);
      const remembered = slotForPadIndex[idx];
      if (remembered === undefined) continue;
      if (livePads[remembered] === null) {
        livePads[remembered] = p;
        slotPadIndex[remembered] = idx;
      }
    }

    // Pass 2 — brand-new pads (or ones whose old slot is taken) fill the gaps.
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || p.connected === false) continue;
      if (livePads[0] === p || livePads[1] === p) continue;

      let free = -1;
      if (livePads[0] === null) free = 0;
      else if (livePads[1] === null) free = 1;
      if (free === -1) break;                 // both slots busy; ignore extra pads

      const idx = padIndexOf(p, i);
      livePads[free] = p;
      slotPadIndex[free] = idx;
      slotForPadIndex[idx] = free;
    }
  }

  /* -------------------------------------------------------------------------
   * PER-SLOT UPDATE
   * Reads pad + keyboard, computes the rising edges against the values the
   * state object is still carrying from last frame, then writes the new ones.
   * ---------------------------------------------------------------------- */
  function updateSlot(slot, pad) {
    const st = states[slot];
    const km = KEYMAP[slot];

    let stickX = 0;
    let stickY = 0;
    let left = false;
    let right = false;
    let up = false;
    let down = false;
    let fire = false;
    let start = false;
    let back = false;
    let altChar = false;

    if (pad) {
      stickX = deadzone(axisRaw(pad, AXIS_LX));
      stickY = deadzone(axisRaw(pad, AXIS_LY));
      if (stickX < 0) left = true;
      else if (stickX > 0) right = true;
      if (stickY < 0) up = true;
      else if (stickY > 0) down = true;

      if (buttonDown(pad, BTN_DPAD_LEFT)) left = true;
      if (buttonDown(pad, BTN_DPAD_RIGHT)) right = true;
      if (buttonDown(pad, BTN_DPAD_UP)) up = true;
      if (buttonDown(pad, BTN_DPAD_DOWN)) down = true;

      fire = buttonDown(pad, BTN_A) || buttonDown(pad, BTN_X) ||
             buttonDown(pad, BTN_RB) || buttonDown(pad, BTN_RT);
      start = buttonDown(pad, BTN_START);
      back = buttonDown(pad, BTN_B) || buttonDown(pad, BTN_VIEW);
      altChar = buttonDown(pad, BTN_Y);
    }

    // Keyboard stays live even for a slot that owns a pad, so any machine can
    // be used to test either player.
    if (bindingHeld(km.left)) left = true;
    if (bindingHeld(km.right)) right = true;
    if (bindingHeld(km.up)) up = true;
    if (bindingHeld(km.down)) down = true;
    if (bindingHeld(km.fire)) fire = true;
    if (bindingHeld(km.start)) start = true;
    if (bindingHeld(km.back)) back = true;
    if (bindingHeld(km.altChar)) altChar = true;

    // The on-screen controls are the THIRD source, ORed in on top of the other
    // two and merged HERE: after the pad and the keyboard, before the axis
    // derivation and before the rising-edge diff below. A thumb therefore ends
    // up in the same booleans a key would have set, and every '*Pressed' edge
    // downstream is computed from the merged truth — which is the whole point
    // of routing touch through the virtual pad instead of a second input path.
    const vLeft = virtualHold(slot, 'left');
    const vRight = virtualHold(slot, 'right');
    const vUp = virtualHold(slot, 'up');
    const vDown = virtualHold(slot, 'down');
    if (vLeft) left = true;
    if (vRight) right = true;
    if (vUp) up = true;
    if (vDown) down = true;
    if (virtualHold(slot, 'fire')) fire = true;
    if (virtualHold(slot, 'start')) start = true;
    if (virtualHold(slot, 'back')) back = true;
    if (virtualHold(slot, 'altChar')) altChar = true;

    // Digital sources only supply an axis value when the stick is neutral, so
    // an analogue nudge is never overridden by a d-pad or key.
    //
    // Touch is the one exception, and only in the direction that helps: an
    // on-screen arrow is a D-PAD, so it asks for FULL deflection, and a stick
    // that is barely off centre must not out-vote a thumb that is pinning the
    // arrow. The stick keeps the axis when it is pushed FURTHER than ±1 worth
    // of thumb — i.e. all the way. This branch is unreachable unless touch is
    // actually driving this slot, so keyboard and gamepad feel is untouched.
    let axisX = stickX;
    if (axisX === 0) {
      if (left && !right) axisX = -1;
      else if (right && !left) axisX = 1;
    } else if (vLeft !== vRight) {
      const mag = axisX < 0 ? -axisX : axisX;
      if (mag < 1) axisX = vLeft ? -1 : 1;
    }
    let axisY = stickY;
    if (axisY === 0) {
      if (up && !down) axisY = -1;
      else if (down && !up) axisY = 1;
    } else if (vUp !== vDown) {
      const mag = axisY < 0 ? -axisY : axisY;
      if (mag < 1) axisY = vUp ? -1 : 1;
    }

    // --- rising edges --------------------------------------------------------
    // Normally "held now AND not held last frame". A key that was released and
    // pressed again between two polls is held on BOTH sides of that diff, so it
    // would lose its edge; bindingTapped() catches those re-presses. Frames can
    // be long (a GC hitch, or the first frame back from a hidden tab), which is
    // exactly when a dropped shot is most noticeable.
    //
    // virtualTapped() is the same latch for a thumb, and it matters more there:
    // a tap on a touchscreen routinely lands and lifts inside one 16ms frame,
    // and without it a re-tap of FIRE while the button still reads as held
    // would silently drop a shot.
    st.firePressed = fire &&
      (!st.fire || bindingTapped(km.fire) || virtualTapped(slot, 'fire'));
    st.startPressed = start &&
      (!st.start || bindingTapped(km.start) || virtualTapped(slot, 'start'));
    st.backPressed = back &&
      (!st.back || bindingTapped(km.back) || virtualTapped(slot, 'back'));
    st.altCharPressed = altChar &&
      (!st.altChar || bindingTapped(km.altChar) || virtualTapped(slot, 'altChar'));
    st.leftPressed = left &&
      (!st.left || bindingTapped(km.left) || virtualTapped(slot, 'left'));
    st.rightPressed = right &&
      (!st.right || bindingTapped(km.right) || virtualTapped(slot, 'right'));
    st.upPressed = up &&
      (!st.up || bindingTapped(km.up) || virtualTapped(slot, 'up'));
    st.downPressed = down &&
      (!st.down || bindingTapped(km.down) || virtualTapped(slot, 'down'));

    // --- commit this frame's held state -------------------------------------
    st.axisX = axisX;
    st.axisY = axisY;
    st.left = left;
    st.right = right;
    st.up = up;
    st.down = down;
    st.fire = fire;
    st.start = start;
    st.back = back;
    st.altChar = altChar;
    st.connected = (pad !== null) || keyboardClaimed[slot] || virtualClaimed[slot];
  }

  /* -------------------------------------------------------------------------
   * PUBLIC API
   * ---------------------------------------------------------------------- */

  /** Attach listeners. Safe to call more than once; only the first one counts. */
  function init() {
    if (initialised) return;
    initialised = true;

    window.addEventListener('keydown', onKeyDown, false);
    window.addEventListener('keyup', onKeyUp, false);
    window.addEventListener('blur', onBlur, false);
    window.addEventListener('pointerdown', onPointerDown, false);
    window.addEventListener('mousedown', onPointerDown, false);
    window.addEventListener('touchstart', onPointerDown, false);
    document.addEventListener('visibilitychange', onVisibility, false);

    // Nothing to do on connect/disconnect beyond letting poll() notice, but the
    // listeners make Chrome start delivering pads without a button press first.
    window.addEventListener('gamepadconnected', noop, false);
    window.addEventListener('gamepaddisconnected', noop, false);
  }

  function noop() { /* intentionally empty */ }

  /** Sample everything for this frame. Call exactly once, before update(). */
  function poll() {
    const pads = getPads();
    assignSlots(pads);

    for (let s = 0; s < SLOT_COUNT; s++) {
      updateSlot(s, livePads[s]);
    }

    // A gamepad button counts as the first gesture too (pads can be the only
    // thing plugged in).
    if (!gestureFired) {
      for (let s = 0; s < SLOT_COUNT; s++) {
        const p = livePads[s];
        if (p && anyButtonDown(p)) { fireGesture(); break; }
      }
    }

    // Never hold a Gamepad snapshot past the frame that produced it.
    livePads[0] = null;
    livePads[1] = null;
    tappedCodes.length = 0;

    // Sub-frame taps have now been seen by updateSlot(); drop the latches so a
    // thumb that lifted before this poll reads as released on the next one.
    // Only the latches — the held bits belong to the finger, not to the frame.
    resetVirtualState(virtualTap[0]);
    resetVirtualState(virtualTap[1]);
  }

  /** The stable PadState for slot i (0 or 1). Always returns an object. */
  function get(i) {
    return states[(i === 1) ? 1 : 0];
  }

  /** True if either slot produced this rising edge on the current frame. */
  function anyPressed(name) {
    const field = EDGE_FIELD[name];
    if (field === undefined) return false;
    return states[0][field] === true || states[1][field] === true;
  }

  /** How many gamepads the browser currently reports as connected. */
  function padCount() {
    return connectedPadCount;
  }

  /** True when slot i is being driven by real hardware this frame. */
  function isGamepad(i) {
    const s = (i === 1) ? 1 : 0;
    return slotPadIndex[s] >= 0;
  }

  /**
   * Press or release one on-screen control for a slot (SPEC-TOUCH.md §1).
   *
   * Called by js/touch.js from its pointer handlers, never from the game loop.
   * `name` is one of left / right / up / down / fire / start / back / altChar;
   * anything else is ignored rather than thrown, because the caller is UI code
   * driven by raw pointer ids and a bad name must not take the frame down.
   *
   * A control is HELD WHILE ANY POINTER IS ON IT, and that bookkeeping lives in
   * touch.js: this function is a plain setter, so two fingers on the same
   * button and a release of one of them is the caller's problem to resolve
   * before it calls setVirtual(slot, name, false). Repeated presses of an
   * already-held name are idempotent — only a false→true transition latches a
   * new tap, which is what keeps one press worth exactly one rising edge.
   *
   * @param {number} slot   0 or 1
   * @param {string} name   logical button
   * @param {boolean} held  true to press, false to release
   */
  function setVirtual(slot, name, held) {
    const s = (slot === 1) ? 1 : 0;
    if (typeof name !== 'string' || VIRTUAL_NAMES[name] !== true) return;

    if (held) {
      if (virtualHeld[s][name] !== true) {
        virtualHeld[s][name] = true;
        virtualTap[s][name] = true;
      }
      virtualClaimed[s] = true;

      // A thumb on a button is a real user gesture, and this is the most
      // reliable place to notice it: touch.js may stop its pointer events from
      // bubbling to the window listener init() installed, and if it does, the
      // AudioContext would never get its unlock and the game would boot silent
      // on exactly the device this whole layer exists for.
      fireGesture();
    } else {
      virtualHeld[s][name] = false;
    }
  }

  /**
   * Release everything for a slot and hand it back.
   *
   * This is both the panic button (pointercancel, an orientation change, the
   * controls being torn down) and the "player 2 left" signal: it drops the held
   * bits, drops any pending tap — a cancelled press must not fire a shot — and
   * un-claims the slot so hasVirtual() reads false again.
   */
  function clearVirtual(slot) {
    const s = (slot === 1) ? 1 : 0;
    wipeVirtual(s);
    virtualClaimed[s] = false;
  }

  /** True when the on-screen controls are driving slot i. */
  function hasVirtual(i) {
    const s = (i === 1) ? 1 : 0;
    return virtualClaimed[s];
  }

  /** Clear one rising edge so a menu does not act on it twice. */
  function consume(i, name) {
    const s = (i === 1) ? 1 : 0;
    let key = name;
    if (typeof key !== 'string') return;
    if (key.length > 7 && key.slice(-7) === 'Pressed') key = key.slice(0, -7);
    const field = EDGE_FIELD[key];
    if (field === undefined) return;
    states[s][field] = false;
  }

  /**
   * Best-effort haptics. Silently does nothing when the pad, the browser or the
   * platform has no actuator — it must never throw and never log.
   */
  function rumble(i, ms, strong, weak) {
    const s = (i === 1) ? 1 : 0;
    const wanted = slotPadIndex[s];
    if (wanted < 0) return;

    try {
      const pads = getPads();
      let pad = null;
      for (let k = 0; k < pads.length; k++) {
        const p = pads[k];
        if (!p || p.connected === false) continue;
        if (padIndexOf(p, k) === wanted) { pad = p; break; }
      }
      if (!pad) return;

      const duration = clamp(
        (typeof ms === 'number' && ms === ms) ? ms : RUMBLE_DEFAULT_MS,
        0, RUMBLE_MAX_MS);
      const hard = clamp(
        (typeof strong === 'number' && strong === strong) ? strong : RUMBLE_DEFAULT_STRONG,
        0, 1);
      const soft = clamp(
        (typeof weak === 'number' && weak === weak) ? weak : RUMBLE_DEFAULT_WEAK,
        0, 1);

      const act = pad.vibrationActuator ||
                  (pad.hapticActuators && pad.hapticActuators[0]) || null;
      if (!act) return;

      if (typeof act.playEffect === 'function') {
        const promise = act.playEffect('dual-rumble', {
          startDelay: 0,
          duration: duration,
          strongMagnitude: hard,
          weakMagnitude: soft
        });
        // A rejected effect (unsupported type, pad yanked mid-buzz) must not
        // surface as an unhandled rejection.
        if (promise && typeof promise.catch === 'function') promise.catch(noop);
      } else if (typeof act.pulse === 'function') {
        const promise = act.pulse(hard, duration);      // older Firefox shape
        if (promise && typeof promise.catch === 'function') promise.catch(noop);
      }
    } catch (err) {
      /* haptics are a nicety; failure is always silent */
    }
  }

  /* -------------------------------------------------------------------------
   * EXPORT ONTO THE GLOBAL NAMESPACE
   * ---------------------------------------------------------------------- */
  T.Input = {
    init: init,
    poll: poll,
    get: get,
    anyPressed: anyPressed,
    padCount: padCount,
    isGamepad: isGamepad,
    consume: consume,
    rumble: rumble,
    onFirstGesture: onFirstGesture,
    setVirtual: setVirtual,
    clearVirtual: clearVirtual,
    hasVirtual: hasVirtual
  };

})(window.T = window.T || {});
