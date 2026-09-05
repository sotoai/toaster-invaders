/* ===========================================================================
 * TOASTER INVADERS — js/touch.js
 *
 * ROLE: the on-screen thumb controls for iPad play. This file renders a DOM
 * overlay beside the canvas and feeds what a thumb is doing into the VIRTUAL
 * PAD that input.js already exposes. It never reads or writes game state and
 * it never implements a second input path — every press ends up in
 * T.Input.setVirtual(), which poll() ORs into the slot alongside the keyboard
 * and the gamepad. Downstream files (game.js, ui.js, weapons.js) are unaware
 * that touch exists (SPEC-TOUCH.md §1).
 *
 *   T.Touch.init(canvas, root)   build the controls, attach the listeners
 *   T.Touch.isTouch()            touch capability has been detected
 *   T.Touch.setLayout(mode)      'solo' | 'duo'  (P2 joined / dropped)
 *   T.Touch.layout()             current layout
 *   T.Touch.setMode(mode)        'buttons' | 'drag'   (SPEC-TOUCH §4)
 *   T.Touch.mode()               current control mode
 *   T.Touch.toggleMode()         flip it and remember the choice
 *   T.Touch.releaseAll()         drop every held pointer, clear both slots
 *   T.Touch.setVisible(on)       show / hide the whole control layer
 *   T.Touch.isVisible()          is the layer showing
 *   T.Touch.isPortrait()         the rotate prompt is up (main.js pauses)
 *   T.Touch.columnWidth()        px reserved down EACH edge, 0 when hidden
 *   T.Touch.element()            the layer root, for css/main.js
 *   T.Touch.promptsOn()          show "tap to start" wording (no key seen yet)
 *   T.Touch.tapStartShown()      the DOM TAP TO START panel is up (ui.js)
 *
 * THE TWO RULES THIS FILE LIVES BY
 *
 *   1. TOUCH IS ADDITIVE. Nothing here changes a single frame of keyboard or
 *      gamepad play. On a machine that never sees a touch the layer is built
 *      hidden, no pointer is ever tracked, and setVirtual() is never called.
 *
 *   2. NOTHING STICKS, EVER. A direction left held sends the ship into a wall
 *      forever, which ruins the game far more thoroughly than a dropped press.
 *      So: every control is REFERENCE COUNTED (held while ANY pointer is on
 *      it, released only when the last one leaves), every pointer is tracked
 *      by id, and every escape route — pointercancel, touchcancel, blur,
 *      pagehide, a hidden tab, an orientation change, a layout or mode switch
 *      — funnels into releaseAll(). Release paths NEVER depend on hit-testing
 *      or on an element still being visible: a control that vanishes under a
 *      finger is released by id, not by geometry.
 *
 * WHY DOM AND NOT CANVAS DRAWING
 * The ship sits at y 636 of 720, so anything painted over the play field
 * covers the exact thing the player is aiming. The controls therefore live in
 * reserved columns OUTSIDE the picture, as real elements: the browser does the
 * hit-testing, the press feedback is a CSS class with no frame of latency, and
 * main.js scales the canvas to whatever room is left (§2).
 *
 * css/style.css owns every pixel of how this looks. This file owns the
 * elements, the class names and the data-attributes the stylesheet hooks on.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const U = T.Util || {};
  const C = T.C || {};

  /* -------------------------------------------------------------------------
   * TUNABLES
   * util.js publishes the touch block of T.C (SPEC-TOUCH §2/§3/§4); these
   * readers exist so the file still behaves sanely if it is ever loaded
   * against an older util.js, exactly like the pattern input.js uses for the
   * stick deadzone. The three at the bottom are integration numbers that the
   * spec does not name — they belong to the drag integrator below and nowhere
   * else — so they live here, in the one place that reads them.
   * ---------------------------------------------------------------------- */
  function num(name, fallback) {
    const v = C[name];
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  /** Invisible slop around a control's drawn box, so a near miss still lands. */
  const HIT_PAD = num('TOUCH_HIT_PAD', 12);

  /** How far a captured pointer may drift off its control before it drops it. */
  const SLIDE_TOLERANCE = num('TOUCH_SLIDE_TOLERANCE', 26);

  /** Hard cap on tracked pointers. Two players' hands, with room to spare. */
  const MAX_POINTERS = Math.max(4, Math.floor(num('TOUCH_MAX_POINTERS', 10)));

  /** A drag pointer that lifts having travelled less than this is a TAP. */
  const TAP_MAX_PX = num('TOUCH_TAP_MAX_PX', 10);

  /** Ship travel per unit of finger travel in DRAG mode. */
  const DRAG_SENS = num('TOUCH_DRAG_SENS', 1.25);

  /** Fraction of the canvas width dividing P1's half from P2's in DRAG mode. */
  const DRAG_SPLIT = num('TOUCH_DRAG_SPLIT', 0.5);

  /** Column width fallback, used only before the stylesheet has laid out. */
  const COL_MIN = num('TOUCH_COL_MIN', 96);
  const COL_MAX = num('TOUCH_COL_MAX', 190);
  const COL_VW = num('TOUCH_COL_VW', 15);

  /** Ship speed, in logical px/sec — the rate the drag debt below drains at. */
  const SHIP_SPEED = num('SHIP_SPEED', 280);

  /* DRAG integrator (see steerFromDebt). The virtual pad speaks D-pad, not
   * millimetres, so a finger's horizontal travel is banked as a DEBT in
   * logical pixels and paid off by holding a direction until the ship has
   * covered it. DEBT_MAX caps how much a wild swipe may queue (a whole
   * screen-width of coasting would feel broken); DEADBAND is the debt below
   * which the direction is simply dropped, so a resting thumb means a resting
   * ship; TICK_MAX_DT stops a dropped frame from paying off a huge slice at
   * once. */
  const DRAG_DEBT_MAX = 160;
  const DRAG_DEADBAND = 1.5;
  const DRAG_TICK_MAX_DT = 0.05;

  /** How often the layer re-reads the world (layout, prompts, labels). */
  const WATCH_MS = 250;

  /** localStorage key for the remembered control mode. */
  const MODE_KEY = 'toasterInvaders.touchMode';

  const MODE_BUTTONS = 'buttons';
  const MODE_DRAG = 'drag';
  const LAYOUT_SOLO = 'solo';
  const LAYOUT_DUO = 'duo';

  /* -------------------------------------------------------------------------
   * MODULE STATE
   * ---------------------------------------------------------------------- */
  let initialised = false;
  let rootEl = null;          // the layer we create and own
  let canvasEl = null;        // the game canvas, for DRAG hit-testing only
  const controls = [];        // every button descriptor, built once
  let modeBtn = null;         // the BUTTONS/DRAG toggle (label is dynamic)
  let gameModeBtn = null;     // the CO-OP/CLASSIC toggle (label is dynamic)

  let touchCapable = false;   // §2: maxTouchPoints > 0, or a touchstart seen
  let visible = false;
  let keyboardSeen = false;   // stop drawing the tap prompts once a key lands
  let portrait = false;

  let layoutMode = LAYOUT_SOLO;
  let controlMode = MODE_BUTTONS;
  let lastDesiredLayout = LAYOUT_SOLO;

  let rectsDirty = true;
  let watchTimer = 0;

  /** The TAP TO START affordance, so ui.js can ask whether it is on screen. */
  let tapControl = null;

  /**
   * Has a thumb ever driven slot 1?
   *
   * The title screen has no game state to read, so this is what tells the
   * watcher that a second player has arrived. It deliberately does NOT ask
   * T.Input.hasVirtual(1): input.js draws a sharp line between releasing the
   * held bits (the panic path — blur, a hidden tab, an interrupted gesture)
   * and clearVirtual(), which also drops the CLAIM and means "this slot is
   * done". releaseAll() below is wired to every panic route AND to every
   * layout/mode switch, and it un-claims, so reading hasVirtual(1) back here
   * made the layer disagree with itself: switching to DUO would clear the very
   * flag that asked for DUO, and the next watcher tick 250ms later would flip
   * straight back to SOLO. This flag survives a release and is dropped only
   * when the second player genuinely goes away (setLayout to solo) or the
   * whole layer is taken down.
   */
  let p2Touched = false;
  let dragRaf = 0;
  let dragLastMs = 0;

  /** Tracked pointers, keyed by a source-prefixed id. Null-prototype: the keys
   *  are raw browser data and must never collide with Object.prototype. */
  const pointers = Object.create(null);
  let pointerCount = 0;

  /** Per-slot DRAG bookkeeping: how many fingers are steering, and the debt. */
  const dragSlots = [
    { fingers: 0, debt: 0, dir: 0 },
    { fingers: 0, debt: 0, dir: 0 }
  ];

  /* -------------------------------------------------------------------------
   * SAFE BRIDGES
   * Everything that leaves this file is wrapped. The touch layer runs off raw
   * pointer events on a platform we cannot test from here, and a throw inside
   * a pointer handler would leave a button held with no path to release it —
   * the one failure mode this file exists to prevent.
   * ---------------------------------------------------------------------- */

  /** Press or release one virtual button. Never throws. */
  function vset(slot, name, held) {
    try {
      const I = T.Input;
      if (I && typeof I.setVirtual === 'function') I.setVirtual(slot, name, held);
    } catch (err) {
      /* an input bridge that fails must not take the frame down */
    }
  }

  /** Hand a slot back to the keyboard and the gamepad. Never throws. */
  function vclear(slot) {
    try {
      const I = T.Input;
      if (I && typeof I.clearVirtual === 'function') I.clearVirtual(slot);
    } catch (err) {
      /* as above */
    }
  }

  /** Read a persisted value through util.js's file://-safe wrapper. */
  function storeGet(key, fallback) {
    try {
      if (typeof U.storeGet === 'function') return U.storeGet(key, fallback);
    } catch (err) {
      /* private mode, file:// with storage disabled — fall through */
    }
    return fallback;
  }

  /** Persist a value. Failure is silent and harmless. */
  function storeSet(key, value) {
    try {
      if (typeof U.storeSet === 'function') U.storeSet(key, value);
    } catch (err) {
      /* as above */
    }
  }

  /* =========================================================================
   * DOM CONSTRUCTION
   *
   * The markup below is the contract with css/style.css. BEM-ish names, one
   * block (`ti-touch`), and every state the stylesheet needs to react to is a
   * data-attribute on the root or a class on the element:
   *
   *   .ti-touch[data-layout="solo"|"duo"][data-mode="buttons"|"drag"]
   *            [data-orientation="landscape"|"portrait"]
   *     .ti-touch__col.ti-touch__col--left   (data-slot, data-column="0")
   *     .ti-touch__col.ti-touch__col--right  (data-slot, data-column="1")
   *       .ti-touch__cluster                 FIRE + the arrows
   *         .ti-touch__btn.ti-touch__btn--fire
   *         .ti-touch__dpad
   *           .ti-touch__btn.ti-touch__btn--left
   *           .ti-touch__btn.ti-touch__btn--right
   *       .ti-touch__meta                    the small strip
   *         .ti-touch__btn.ti-touch__btn--start
   *         .ti-touch__btn.ti-touch__btn--back
   *         .ti-touch__btn.ti-touch__btn--join   (right column, solo only)
   *         .ti-touch__btn.ti-touch__btn--mode   (left column, title/pause)
   *     .ti-touch__tapstart > .ti-touch__tapstart-label
   *     .ti-touch__rotate > .ti-touch__rotate-art + .ti-touch__rotate-title
   *                                             + .ti-touch__rotate-text
   *
   * A pressed control carries `.is-pressed` for as long as a thumb is on it.
   * Anything not part of the current layout/mode carries the `hidden`
   * attribute, so the stylesheet must never set `display` on `[hidden]`.
   * ====================================================================== */

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  /**
   * Build one touch button.
   *
   * `<button type="button" tabindex="-1">` on purpose: it is a real button for
   * assistive tech, but it is OUT of the keyboard tab order, because a control
   * that could take focus from a keyboard player would be a regression in the
   * one thing this phase is forbidden to touch.
   */
  function makeButton(modifier, label, aria) {
    const node = el('button', 'ti-touch__btn ti-touch__btn--' + modifier);
    node.type = 'button';
    node.tabIndex = -1;
    node.setAttribute('aria-label', aria || label);
    const span = el('span', 'ti-touch__btn-label');
    span.textContent = label;
    node.appendChild(span);
    node._tiLabel = span;
    return node;
  }

  /**
   * Register a control.
   *
   * `column` is which physical edge it sits on (0 left, 1 right) and decides
   * the slot it drives in DUO. `fixedSlot` pins a control to one player no
   * matter the layout — the P2 JOIN button, which must reach slot 1 while the
   * layout still says solo, because that press is what makes P2 exist.
   * `action` marks a control that drives the layer itself rather than the pad.
   */
  function addControl(node, opts) {
    const c = {
      el: node,
      name: opts.name || '',
      column: opts.column || 0,
      fixedSlot: (typeof opts.fixedSlot === 'number') ? opts.fixedSlot : null,
      layouts: opts.layouts || { solo: true, duo: true },
      modes: opts.modes || { buttons: true, drag: true },
      gate: opts.gate || null,      // extra condition, re-checked by the watcher
      action: opts.action || null,  // non-pad control (the mode toggle)
      active: false,
      holds: 0,
      slot: 0,
      rect: null
    };
    node.hidden = true;
    controls.push(c);
    return c;
  }

  /** One edge of the device: FIRE + arrows, with the small strip beneath. */
  function buildColumn(column) {
    const side = column === 0 ? 'left' : 'right';
    const col = el('div', 'ti-touch__col ti-touch__col--' + side);
    col.setAttribute('data-column', String(column));

    /* SPEC-TOUCH §2's two arrangements, expressed as which half of each
     * column exists in which layout:
     *
     *   SOLO — one player, two thumbs: the ARROWS are the left column and one
     *          big FIRE is the right column. So the left column's fire and the
     *          right column's arrows do not exist.
     *   DUO  — two players, one edge each: every column is a full cluster.
     */
    const inSolo = { solo: true, duo: true };
    const duoOnly = { solo: false, duo: true };

    const cluster = el('div', 'ti-touch__cluster');

    const fire = makeButton('fire', 'FIRE', 'Fire');
    addControl(fire, {
      name: 'fire', column: column,
      layouts: (column === 0) ? duoOnly : inSolo
    });
    cluster.appendChild(fire);

    const dpad = el('div', 'ti-touch__dpad');
    const left = makeButton('left', '◀', 'Move left');
    const right = makeButton('right', '▶', 'Move right');
    const arrowLayouts = (column === 1) ? duoOnly : inSolo;
    addControl(left, { name: 'left', column: column, layouts: arrowLayouts });
    addControl(right, { name: 'right', column: column, layouts: arrowLayouts });
    dpad.appendChild(left);
    dpad.appendChild(right);
    cluster.appendChild(dpad);

    col.appendChild(cluster);

    const meta = el('div', 'ti-touch__meta');
    const start = makeButton('start', 'START', 'Start and pause');
    const back = makeButton('back', 'BACK', 'Back');
    addControl(start, { name: 'start', column: column });
    addControl(back, { name: 'back', column: column });
    meta.appendChild(start);
    meta.appendChild(back);

    /* SOLO puts both columns in P1's hands (arrows left, big FIRE right), so
     * a second player has nothing to press and could never join. This button
     * is that missing door: it sends START to slot 1, which is exactly what
     * game.js's select screen reads as "P2 is in". The moment they are in,
     * the layout flips to DUO and the button is gone. */
    if (column === 1) {
      const join = makeButton('join', 'P2', 'Player two: join');
      addControl(join, {
        name: 'start', column: 1, fixedSlot: 1,
        layouts: { solo: true, duo: false }
      });
      meta.appendChild(join);
    }

    /* SPEC-TOUCH §4 wants the control mode reachable from the title and the
     * pause screen. ui.js prints the indicator; this is the thing you press.
     * It is shown only where a stray thumb cannot cost you a life. */
    if (column === 0) {
      const btn = makeButton('mode', 'DRAG', 'Switch control mode');
      modeBtn = addControl(btn, {
        column: 0,
        action: toggleMode,
        gate: function () {
          const state = gameState();
          // '' is "there is no game to ask" — degrade to reachable rather than
          // to a control mode nobody can ever change.
          return state === '' || state === 'title' || state === 'select' ||
                 state === 'pause' || state === 'over';
        }
      });
      meta.appendChild(btn);

      /* game.js flips CO-OP/CLASSIC on up/down only, and this layer ships no
       * up/down control, so without this button a pad-less iPad could never
       * reach CLASSIC. It sends UP to slot 0, which is exactly what the select
       * screen reads as "flip the mode for everyone". Gated to the select
       * screen so a stray thumb can never change modes mid-game. */
      const gm = makeButton('gamemode', 'CLASSIC', 'Switch game mode');
      gameModeBtn = addControl(gm, {
        name: 'up', column: 0, fixedSlot: 0,
        gate: function () { return gameState() === 'select'; }
      });
      meta.appendChild(gm);
    }

    col.appendChild(meta);
    return col;
  }

  /** Build the whole layer once. Idempotent by construction — init() guards. */
  function buildLayer(root) {
    rootEl = el('div', 'ti-touch');
    rootEl.id = 'touch-controls';
    rootEl.setAttribute('data-layout', layoutMode);
    rootEl.setAttribute('data-mode', controlMode);
    rootEl.setAttribute('data-orientation', 'landscape');
    rootEl.hidden = true;

    /* The stylesheet sets this too, but a pointer that the browser decides is
     * a pan gesture is taken away mid-press (pointercancel), and on the one
     * device this file exists for that would cost a shot in a boss wave. It
     * is cheap insurance on an element this file owns outright. */
    if (rootEl.style) rootEl.style.touchAction = 'none';

    rootEl.appendChild(buildColumn(0));
    rootEl.appendChild(buildColumn(1));

    /* TAP TO START: a big, obvious target over the play field for the one
     * screen where there is nothing to aim at. The watcher shows it only on
     * the title screen, and only until a keyboard turns up. */
    const tap = el('div', 'ti-touch__tapstart');
    tap.setAttribute('role', 'button');
    tap.setAttribute('aria-label', 'Tap to start');
    const tapLabel = el('span', 'ti-touch__tapstart-label');
    tapLabel.textContent = 'TAP TO START';
    tap.appendChild(tapLabel);
    tapControl = addControl(tap, {
      name: 'start', column: 0, fixedSlot: 0,
      gate: function () { return promptsOn() && gameState() === 'title'; }
    });
    rootEl.appendChild(tap);

    /* PORTRAIT: 4:3 with two players down the edges does not exist in
     * portrait, so we do not pretend. main.js pauses while this is up. */
    const rotate = el('div', 'ti-touch__rotate');
    rotate.hidden = true;
    const art = el('div', 'ti-touch__rotate-art');
    art.setAttribute('aria-hidden', 'true');
    art.textContent = '▭';           // a lone landscape slab; css dresses it
    const title = el('p', 'ti-touch__rotate-title');
    title.textContent = 'ROTATE YOUR DEVICE';
    const text = el('p', 'ti-touch__rotate-text');
    text.textContent = 'Toaster Invaders plays in landscape, one column of ' +
                       'controls per player.';
    rotate.appendChild(art);
    rotate.appendChild(title);
    rotate.appendChild(text);
    rootEl.appendChild(rotate);
    rootEl._tiRotate = rotate;

    root.appendChild(rootEl);
  }

  /* =========================================================================
   * GEOMETRY
   * Hit-testing is done against cached rects rather than elementFromPoint():
   * a moving thumb is re-tested on every pointermove and a layout read per
   * move per finger is exactly the sort of thing that turns 60fps into 45 on
   * an iPad. The cache is invalidated by the events that can actually move a
   * control — resize, orientation, the Safari toolbar sliding (visualViewport)
   * and our own layout/mode switches.
   * ====================================================================== */

  function markRectsDirty() {
    rectsDirty = true;
  }

  function readRect(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return null;
    let r = null;
    try {
      r = node.getBoundingClientRect();
    } catch (err) {
      return null;
    }
    if (!r) return null;
    const w = (typeof r.width === 'number') ? r.width : (r.right - r.left);
    const h = (typeof r.height === 'number') ? r.height : (r.bottom - r.top);
    if (!(w > 0) || !(h > 0)) return null;      // hidden, or not laid out yet
    return {
      left: r.left, top: r.top,
      right: r.left + w, bottom: r.top + h,
      cx: r.left + w / 2, cy: r.top + h / 2
    };
  }

  function refreshRects() {
    rectsDirty = false;
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      c.rect = c.active ? readRect(c.el) : null;
    }
  }

  function ensureRects() {
    if (rectsDirty) refreshRects();
  }

  /** Squared distance from a point to a rect, 0 when inside it. */
  function rectGap(r, x, y) {
    const dx = (x < r.left) ? (r.left - x) : (x > r.right ? x - r.right : 0);
    const dy = (y < r.top) ? (r.top - y) : (y > r.bottom ? y - r.bottom : 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Which control is under this point?
   *
   * Padded boxes overlap on purpose (HIT_PAD is generous, because a thumb that
   * lands a few px off a button should still shoot), so ties are broken by
   * distance to the control's CENTRE — the button you were obviously aiming
   * at wins, and the answer never depends on DOM order.
   */
  function hitTest(x, y) {
    ensureRects();
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      const r = c.rect;
      if (!c.active || !r) continue;
      if (x < r.left - HIT_PAD || x > r.right + HIT_PAD ||
          y < r.top - HIT_PAD || y > r.bottom + HIT_PAD) continue;
      const dx = x - r.cx;
      const dy = y - r.cy;
      const score = dx * dx + dy * dy;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /** Is this point still close enough to keep holding `c`? (slide tolerance) */
  function withinTolerance(c, x, y) {
    if (!c || !c.active) return false;
    const r = c.rect;
    if (!r) return false;
    return rectGap(r, x, y) <= (HIT_PAD + SLIDE_TOLERANCE);
  }

  /** The canvas box in CSS px, or null when it is not on screen. */
  function canvasRect() {
    return readRect(canvasEl);
  }

  /* =========================================================================
   * REFERENCE-COUNTED PRESSES
   * A control is HELD WHILE ANY POINTER IS ON IT. Two thumbs on FIRE and one
   * lifting must leave FIRE down; a finger sliding off ▶ onto ◀ must swap
   * cleanly. That is all this pair of functions, and it is the reason the
   * pointer table below stores the control rather than a boolean.
   * ====================================================================== */

  /** Remember that a thumb has driven this slot (see p2Touched). */
  function noteSlotTouched(slot) {
    if (slot === 1) p2Touched = true;
  }

  function pressControl(c) {
    c.holds++;
    if (c.holds !== 1) return;                 // already held by another finger
    if (c.el && c.el.classList) c.el.classList.add('is-pressed');
    if (!c.action && c.name) noteSlotTouched(c.slot);
    if (c.action) {
      try {
        c.action();
      } catch (err) {
        /* a layer action must never leave the pointer table inconsistent */
      }
      return;
    }
    if (c.name) vset(c.slot, c.name, true);
  }

  function releaseControl(c) {
    if (c.holds > 0) c.holds--;
    if (c.holds > 0) return;                   // another finger still on it
    c.holds = 0;
    if (c.el && c.el.classList) c.el.classList.remove('is-pressed');
    if (!c.action && c.name) vset(c.slot, c.name, false);
  }

  /**
   * Force a control fully up and detach every pointer from it.
   *
   * Called when a control leaves the current layout or mode — including while
   * a thumb is on it. Releasing by identity rather than by geometry is what
   * makes "the button vanished under my finger" safe: the pointer stays
   * tracked (it can slide onto another control), the input is dropped.
   */
  function deactivateControl(c) {
    for (const key in pointers) {
      const rec = pointers[key];
      if (rec && rec.control === c) rec.control = null;
    }
    if (c.el && c.el.classList) c.el.classList.remove('is-pressed');
    if (c.holds > 0 && !c.action && c.name) vset(c.slot, c.name, false);
    c.holds = 0;
    c.rect = null;
  }

  /* =========================================================================
   * LAYOUT / MODE APPLICATION
   * ====================================================================== */

  function gameState() {
    try {
      const g = T.Game;
      return (g && typeof g.state === 'string') ? g.state : '';
    } catch (err) {
      return '';
    }
  }

  /** The slot a control drives right now (SOLO hands both columns to P1). */
  function slotFor(c) {
    if (c.fixedSlot !== null) return c.fixedSlot;
    return (layoutMode === LAYOUT_DUO) ? c.column : 0;
  }

  /** Should this control be on screen, given layout, mode and its own gate? */
  function wantsActive(c) {
    if (!visible || portrait) return false;
    if (c.layouts && c.layouts[layoutMode] === false) return false;
    if (c.modes && c.modes[controlMode] === false) return false;
    if (c.gate) {
      let ok = false;
      try {
        ok = !!c.gate();
      } catch (err) {
        ok = false;
      }
      if (!ok) return false;
    }
    return true;
  }

  /**
   * In DRAG mode the arrows and FIRE come off the screen — the canvas IS the
   * stick — but START and BACK stay, because pausing must never require
   * changing mode first.
   */
  function hiddenByDragMode(c) {
    if (controlMode !== MODE_DRAG) return false;
    if (c.action) return false;                      // the mode toggle stays
    return c.name === 'left' || c.name === 'right' || c.name === 'fire';
  }

  /** Push layout + mode + gates onto the DOM. Cheap; called by the watcher. */
  function applyControls() {
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      const want = wantsActive(c) && !hiddenByDragMode(c);
      const slot = slotFor(c);

      if (c.active && (!want || slot !== c.slot)) {
        deactivateControl(c);
        c.active = false;
        c.el.hidden = true;
        markRectsDirty();
      }
      c.slot = slot;
      if (want && !c.active) {
        c.active = true;
        c.el.hidden = false;
        markRectsDirty();
      }
    }
    if (modeBtn && modeBtn.el && modeBtn.el._tiLabel) {
      // The button names the mode you will GET, which is how every retro
      // cabinet toggle in this game reads.
      modeBtn.el._tiLabel.textContent =
        (controlMode === MODE_DRAG) ? 'BUTTONS' : 'DRAG';
    }
    if (gameModeBtn && gameModeBtn.el && gameModeBtn.el._tiLabel) {
      // Same convention: name the mode you will GET, not the one you are in.
      const g = (T.Game && T.Game.select) ? T.Game.select : null;
      gameModeBtn.el._tiLabel.textContent =
        (g && g.mode === 'classic') ? 'CO-OP' : 'CLASSIC';
    }
  }

  function applyRootAttributes() {
    if (!rootEl) return;
    rootEl.setAttribute('data-layout', layoutMode);
    rootEl.setAttribute('data-mode', controlMode);
    rootEl.setAttribute('data-orientation', portrait ? 'portrait' : 'landscape');
    if (rootEl.classList) {
      if (visible) rootEl.classList.add('is-visible');
      else rootEl.classList.remove('is-visible');
    }
    if (rootEl._tiRotate) rootEl._tiRotate.hidden = !(visible && portrait);
  }

  /* =========================================================================
   * DRAG MODE (SPEC-TOUCH §4)
   *
   * A finger on a player's half of the canvas steers that player's ship by its
   * RELATIVE horizontal movement, so it works wherever the ship happens to be
   * and never teleports it. The virtual pad only speaks left/right, so the
   * finger's travel is banked as a debt in logical pixels and paid off by
   * holding a direction at the ship's own speed. Lift without having really
   * moved and it was a TAP: fire.
   *
   * The pointer belongs to the player whose half it STARTED in, for its whole
   * life (§4) — dragging across the middle can never steal the other ship.
   * ====================================================================== */

  /** Which player owns a drag that started at this x? */
  function dragSlotForX(x, rect) {
    // With one player there is no other half to protect: the whole canvas is
    // theirs, so a drag started anywhere steers P1.
    if (layoutMode !== LAYOUT_DUO) return 0;
    const split = rect.left + (rect.right - rect.left) * DRAG_SPLIT;
    return (x < split) ? 0 : 1;
  }

  /** Turn a slot's banked debt into a held direction. */
  function steerFromDebt(slot) {
    const d = dragSlots[slot];
    let dir = 0;
    if (d.fingers > 0) {
      if (d.debt > DRAG_DEADBAND) dir = 1;
      else if (d.debt < -DRAG_DEADBAND) dir = -1;
    }
    if (dir === d.dir) return;
    d.dir = dir;
    vset(slot, 'left', dir < 0);
    vset(slot, 'right', dir > 0);
  }

  /** Drop a slot's steering completely. Used by every release path. */
  function resetDragSlot(slot) {
    const d = dragSlots[slot];
    d.fingers = 0;
    d.debt = 0;
    if (d.dir !== 0) {
      d.dir = 0;
      vset(slot, 'left', false);
      vset(slot, 'right', false);
    }
  }

  function dragActive() {
    return dragSlots[0].fingers > 0 || dragSlots[1].fingers > 0;
  }

  /**
   * Pay the debt down at the ship's own speed.
   *
   * Runs only while a finger is actually dragging, and stops itself the frame
   * after the last one lifts — a touch layer must not cost a rAF callback on a
   * machine where nobody is touching anything.
   */
  function dragTick(nowMs) {
    dragRaf = 0;
    const ms = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : 0;
    let dt = (dragLastMs > 0) ? (ms - dragLastMs) / 1000 : 0;
    dragLastMs = ms;
    if (!(dt > 0)) dt = 0;
    if (dt > DRAG_TICK_MAX_DT) dt = DRAG_TICK_MAX_DT;

    const step = SHIP_SPEED * dt;
    for (let s = 0; s < 2; s++) {
      const d = dragSlots[s];
      if (d.fingers <= 0) { resetDragSlot(s); continue; }
      if (d.debt > 0) d.debt = Math.max(0, d.debt - step);
      else if (d.debt < 0) d.debt = Math.min(0, d.debt + step);
      steerFromDebt(s);
    }

    if (dragActive()) scheduleDragTick();
    else dragLastMs = 0;
  }

  function scheduleDragTick() {
    if (dragRaf) return;
    if (typeof window.requestAnimationFrame === 'function') {
      dragRaf = window.requestAnimationFrame(dragTick);
    } else {
      dragRaf = window.setTimeout(function () {
        dragTick(Date.now());
      }, 16);
    }
  }

  function stopDragTick() {
    if (!dragRaf) return;
    try {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(dragRaf);
      } else {
        window.clearTimeout(dragRaf);
      }
    } catch (err) {
      /* nothing to do; the callback is a no-op once the fingers are gone */
    }
    dragRaf = 0;
    dragLastMs = 0;
  }

  /** One frame's worth of virtual fire, using input.js's sub-frame tap latch. */
  function tapFire(slot) {
    vset(slot, 'fire', true);
    // Down AND up before the next poll() is normal on a touchscreen, and
    // input.js latches exactly that case: the press reads as held for one
    // poll, which yields one frame of fire plus its rising edge. Holding it
    // across a timer instead would fire twice on a fast tap.
    vset(slot, 'fire', false);
  }

  /* =========================================================================
   * POINTER TRACKING
   *
   * One record per finger, keyed by a prefixed id so a Pointer Events id and a
   * Touch identifier can never collide. Everything that can end a pointer's
   * life goes through releasePointer(), and everything that can end ALL of
   * them goes through releaseAll().
   * ====================================================================== */

  function trackable() {
    return initialised && visible && !portrait && pointerCount < MAX_POINTERS;
  }

  function beginPointer(key, x, y) {
    if (pointers[key]) releasePointer(key, false);   // a lost 'up'; start clean
    if (!trackable()) return false;

    const control = hitTest(x, y);
    if (control) {
      pointers[key] = {
        key: key, control: control, drag: false, slot: control.slot,
        x0: x, y0: y, lastX: x, lastY: y, travel: 0,
        scale: 0, captureNode: null
      };
      pointerCount++;
      pressControl(control);
      return true;
    }

    if (controlMode === MODE_DRAG) {
      const r = canvasRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const slot = dragSlotForX(x, r);
        // Logical px per CSS px, so DRAG feels the same at every canvas scale.
        const scale = ((C.W || 960) / (r.right - r.left)) * DRAG_SENS;
        pointers[key] = {
          key: key, control: null, drag: true, slot: slot,
          x0: x, y0: y, lastX: x, lastY: y, travel: 0,
          scale: scale, captureNode: null
        };
        pointerCount++;
        dragSlots[slot].fingers++;
        noteSlotTouched(slot);
        scheduleDragTick();
        return true;
      }
    }

    /* Landed on the layer but not on a control: track it anyway, with nothing
     * held. A thumb that comes down between two buttons and slides onto one is
     * a completely normal gesture and must not be dead. */
    pointers[key] = {
      key: key, control: null, drag: false, slot: 0,
      x0: x, y0: y, lastX: x, lastY: y, travel: 0,
      scale: 0, captureNode: null
    };
    pointerCount++;
    return true;
  }

  function movePointer(key, x, y) {
    const rec = pointers[key];
    if (!rec) return false;

    const dx = x - rec.lastX;
    rec.lastX = x;
    rec.lastY = y;
    const tx = x - rec.x0;
    const ty = y - rec.y0;
    const dist = Math.sqrt(tx * tx + ty * ty);
    if (dist > rec.travel) rec.travel = dist;

    if (rec.drag) {
      const d = dragSlots[rec.slot];
      d.debt += dx * rec.scale;
      if (d.debt > DRAG_DEBT_MAX) d.debt = DRAG_DEBT_MAX;
      else if (d.debt < -DRAG_DEBT_MAX) d.debt = -DRAG_DEBT_MAX;
      steerFromDebt(rec.slot);
      scheduleDragTick();
      return true;
    }

    /* Re-hit-test EVERY move: this is what makes sliding from ◀ to ▶ switch
     * cleanly. Only when nothing at all is under the finger does the slide
     * tolerance decide whether the old control keeps it. */
    const hit = hitTest(x, y);
    const next = hit || (withinTolerance(rec.control, x, y) ? rec.control : null);
    if (next === rec.control) return true;

    if (rec.control) releaseControl(rec.control);
    rec.control = next;
    if (next) pressControl(next);
    return true;
  }

  /**
   * Is nothing at all holding this slot any more?
   *
   * Used by the cancel path below, and by nothing else: an ordinary lift
   * leaves the slot CLAIMED on purpose, so a player who is using their thumbs
   * does not blink out of the "connected" lamp between presses.
   */
  function slotIdle(slot) {
    if (dragSlots[slot].fingers > 0) return false;
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (c.holds > 0 && !c.action && c.slot === slot) return false;
    }
    return true;
  }

  /**
   * End one pointer.
   *
   * `finish` is true for a clean lift (a short one may count as a tap) and
   * false for a cancel — an interrupting call, a system gesture, a lost
   * pointer. A cancelled press must never fire a shot.
   */
  function releasePointer(key, finish) {
    const rec = pointers[key];
    if (!rec) return false;

    delete pointers[key];
    pointerCount--;
    if (pointerCount < 0) pointerCount = 0;

    if (rec.control) releaseControl(rec.control);

    if (rec.drag) {
      const d = dragSlots[rec.slot];
      d.fingers--;
      if (d.fingers <= 0) {
        resetDragSlot(rec.slot);
      } else {
        // The lifted finger's share of the debt goes with it; whoever is still
        // dragging keeps steering from where they are.
        d.debt = 0;
        steerFromDebt(rec.slot);
      }
      if (finish && rec.travel <= TAP_MAX_PX) tapFire(rec.slot);
      if (!dragActive()) stopDragTick();
    }

    /* A CANCELLED press must not turn into a shot. Releasing the held bit is
     * not enough on its own: input.js latches a press that goes down and up
     * between two polls, so that a real sub-frame tap is never dropped, and a
     * pointer the system took away mid-press would cash that latch in as a
     * phantom shot or a phantom step. clearVirtual() is the one call that
     * drops the latch as well — so it is used here, and only here, and only
     * when nothing else is holding that slot, so a cancel on one finger can
     * never disturb what another finger is still doing. */
    if (!finish) {
      const slot = rec.control ? rec.control.slot : (rec.drag ? rec.slot : -1);
      if (slot >= 0 && slotIdle(slot)) vclear(slot);
    }
    return true;
  }

  /**
   * THE PANIC PATH. Drop every finger, force every control up, hand both slots
   * back to the keyboard and the gamepad.
   *
   * Called on blur, a hidden tab, pagehide, an orientation change, a layout or
   * mode switch, and whenever the layer is hidden. It is deliberately blunt:
   * it does not consult a rect, an event or a DOM node, so it works even when
   * the page is mid-teardown.
   */
  function releaseAll() {
    for (const key in pointers) delete pointers[key];
    pointerCount = 0;

    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (c.el && c.el.classList) c.el.classList.remove('is-pressed');
      if (c.holds > 0 && !c.action && c.name) vset(c.slot, c.name, false);
      c.holds = 0;
    }

    resetDragSlot(0);
    resetDragSlot(1);
    stopDragTick();

    vclear(0);
    vclear(1);
  }

  /* =========================================================================
   * EVENT PLUMBING
   *
   * Pointer Events where they exist (iPadOS Safari has them), Touch Events
   * with changedTouches + identifier where they do not (older Safari). Never
   * both: a browser that fires both would otherwise count every finger twice.
   *
   * `down` is bound to the layer and the canvas; move/up/cancel are bound to
   * the WINDOW, so a finger that leaves the element — off the edge of the
   * screen, into the browser chrome — is still seen lifting. setPointerCapture
   * is asked for on top of that, per §3, because it also stops Safari from
   * retargeting a moving pointer mid-gesture.
   * ====================================================================== */

  const usePointerEvents = (typeof window.PointerEvent === 'function') ||
                           (typeof window.PointerEvent === 'object' &&
                            window.PointerEvent !== null);

  function pointerKey(id) {
    return 'p' + id;
  }

  function touchKey(id) {
    return 't' + id;
  }

  function capture(node, id) {
    try {
      if (node && typeof node.setPointerCapture === 'function') {
        node.setPointerCapture(id);
      }
    } catch (err) {
      /* capture is an optimisation; the window listeners are the guarantee */
    }
  }

  function uncapture(node, id) {
    try {
      if (node && typeof node.releasePointerCapture === 'function') {
        node.releasePointerCapture(id);
      }
    } catch (err) {
      /* the pointer is already gone; nothing to release */
    }
  }

  function stopDefault(e) {
    if (e && typeof e.preventDefault === 'function' && e.cancelable !== false) {
      e.preventDefault();
    }
  }

  function onPointerDown(e) {
    if (!e) return;
    noteTouchSource(e.pointerType);
    const key = pointerKey(e.pointerId);
    if (beginPointer(key, e.clientX, e.clientY)) {
      // Capture on the element the press landed on — the layer for a button,
      // the canvas for a drag — and remember which, because up/cancel arrive
      // on the window and would otherwise have nothing to release.
      const node = e.currentTarget || rootEl;
      if (pointers[key]) pointers[key].captureNode = node;
      capture(node, e.pointerId);
      stopDefault(e);
    }
  }

  function onPointerMove(e) {
    if (!e || pointerCount === 0) return;
    if (movePointer(pointerKey(e.pointerId), e.clientX, e.clientY)) stopDefault(e);
  }

  function onPointerUp(e) {
    if (!e || pointerCount === 0) return;
    const key = pointerKey(e.pointerId);
    const rec = pointers[key];
    if (!rec) return;
    const node = rec.captureNode || rootEl;
    // Take the final position into account: a fast flick can lift several px
    // from the last move event, and that distance decides tap versus drag.
    movePointer(key, e.clientX, e.clientY);
    releasePointer(key, true);
    uncapture(node, e.pointerId);
    stopDefault(e);
  }

  function onPointerCancel(e) {
    if (!e) return;
    const key = pointerKey(e.pointerId);
    const rec = pointers[key];
    if (!rec) return;
    const node = rec.captureNode || rootEl;
    releasePointer(key, false);
    uncapture(node, e.pointerId);
  }

  function onTouchStart(e) {
    if (!e || !e.changedTouches) return;
    noteTouchSource('touch');
    let took = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (beginPointer(touchKey(t.identifier), t.clientX, t.clientY)) took = true;
    }
    if (took) stopDefault(e);
  }

  function onTouchMove(e) {
    if (!e || !e.changedTouches || pointerCount === 0) return;
    let took = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (movePointer(touchKey(t.identifier), t.clientX, t.clientY)) took = true;
    }
    if (took) stopDefault(e);
  }

  function onTouchEnd(e) {
    if (!e || !e.changedTouches || pointerCount === 0) return;
    let took = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const key = touchKey(t.identifier);
      if (!pointers[key]) continue;
      movePointer(key, t.clientX, t.clientY);
      releasePointer(key, true);
      took = true;
    }
    if (took) stopDefault(e);
  }

  function onTouchCancel(e) {
    if (!e || !e.changedTouches) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      releasePointer(touchKey(e.changedTouches[i].identifier), false);
    }
  }

  /* -------------------------------------------------------------------------
   * WORLD EVENTS
   * ---------------------------------------------------------------------- */

  function onBlur() {
    releaseAll();
  }

  function onVisibility() {
    if (document.hidden || document.visibilityState === 'hidden') releaseAll();
  }

  function onResize() {
    markRectsDirty();
    updateOrientation();
  }

  function onOrientation() {
    // Rotating with a thumb down is the classic way to strand a direction.
    releaseAll();
    markRectsDirty();
    updateOrientation();
  }

  function onContextMenu(e) {
    // A long press on a control is a held button, not a request for a menu.
    stopDefault(e);
  }

  function onFirstKey() {
    if (keyboardSeen) return;
    keyboardSeen = true;
    // §2: a player may use both. Keep the controls, drop the tap prompts.
    applyControls();
  }

  /** A real touch turns the layer on even where maxTouchPoints lied (§2). */
  function noteTouchSource(kind) {
    if (touchCapable) return;
    if (kind && kind !== 'touch' && kind !== 'pen') return;
    touchCapable = true;
    setVisible(true);
  }

  function onFirstTouchStart() {
    noteTouchSource('touch');
  }

  function listen(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    try {
      target.addEventListener(type, fn, opts);
    } catch (err) {
      // Ancient Safari takes a boolean third argument, not an options object.
      try {
        target.addEventListener(type, fn, false);
      } catch (err2) {
        /* nothing left to try; this listener simply does not exist */
      }
    }
  }

  /* =========================================================================
   * ORIENTATION
   * ====================================================================== */

  function detectPortrait() {
    try {
      if (typeof window.matchMedia === 'function') {
        const mq = window.matchMedia('(orientation: portrait)');
        if (mq && typeof mq.matches === 'boolean') return mq.matches;
      }
    } catch (err) {
      /* fall through to the measurement below */
    }
    const w = window.innerWidth || 0;
    const h = window.innerHeight || 0;
    if (!(w > 0) || !(h > 0)) return false;
    return h > w;
  }

  function updateOrientation() {
    const now = touchCapable ? detectPortrait() : false;
    if (now === portrait) {
      applyRootAttributes();
      return;
    }
    portrait = now;
    if (portrait) releaseAll();
    applyRootAttributes();
    applyControls();
  }

  /* =========================================================================
   * THE WATCHER
   *
   * A quarter-second poll, running only while the controls are up. It reads
   * the game — never writes it — and answers three questions no event can:
   * has P2 joined or dropped, should the tap-to-start affordance be showing,
   * and should the mode toggle be reachable on this screen.
   * ====================================================================== */

  /**
   * The layout the world implies right now.
   *
   * The select screen is authoritative while it is up (it is where a player
   * joins and drops), a running session is authoritative after that, and on
   * the title screen we fall back to whether touch has ever claimed slot 1.
   */
  function desiredLayout() {
    try {
      const g = T.Game;
      if (g && typeof g.state === 'string') {
        if (g.state === 'select') {
          const sel = g.select;
          const p2 = sel && sel.players && sel.players[1];
          if (p2) return p2.joined ? LAYOUT_DUO : LAYOUT_SOLO;
        } else if (g.state !== 'title') {
          const s = g.session;
          if (s && s.slots) return (s.slots.length > 1) ? LAYOUT_DUO : LAYOUT_SOLO;
        }
      }
      if (p2Touched) return LAYOUT_DUO;
    } catch (err) {
      /* an unreadable game is not a reason to change anything */
    }
    return LAYOUT_SOLO;
  }

  function watch() {
    if (!visible) return;
    // Edge-triggered: an explicit setLayout() from the rest of the game stands
    // until the world itself actually changes its mind.
    const want = desiredLayout();
    if (want !== lastDesiredLayout) {
      lastDesiredLayout = want;
      setLayout(want);
      return;                       // setLayout already re-applied everything
    }
    applyControls();
  }

  function startWatch() {
    if (watchTimer || typeof window.setInterval !== 'function') return;
    watchTimer = window.setInterval(watch, WATCH_MS);
  }

  function stopWatch() {
    if (!watchTimer) return;
    try {
      window.clearInterval(watchTimer);
    } catch (err) {
      /* the timer is gone either way */
    }
    watchTimer = 0;
  }

  /* =========================================================================
   * PUBLIC API
   * ====================================================================== */

  /** Touch capability has been detected (§2). Never true from screen size. */
  function isTouch() {
    return touchCapable;
  }

  /** Still worth telling the player to TAP — no key has been pressed yet. */
  function promptsOn() {
    return touchCapable && !keyboardSeen;
  }

  function layout() {
    return layoutMode;
  }

  /**
   * Is the DOM "TAP TO START" affordance actually on screen right now?
   *
   * ui.js paints its own TAP TO START on the canvas at y 606 of 720, and this
   * panel is anchored 16% up from the bottom of the cabinet — the same band —
   * so with both up the canvas line reads as a ghost of itself through the
   * panel's translucent backing. Only one of them should exist, and this is
   * the one a thumb can actually press, so ui.js asks here and stands down.
   *
   * It reports the control's LIVE state rather than re-deriving the gate, so
   * ui.js is not trusting that two conditions in two files still agree: if the
   * layer is hidden, portrait, off the title screen, or a keyboard has retired
   * the prompts, this is false and ui.js paints the line itself. A touch layer
   * too old to answer reads as false for the same reason — the prompt on the
   * canvas is the safe default, an absent one is not.
   */
  function tapStartShown() {
    return !!(visible && !portrait && tapControl && tapControl.active);
  }

  /**
   * Switch between the one-player and two-player arrangements.
   *
   * SOLO: arrows in the left column, one big FIRE in the right — the
   * comfortable two-thumb grip, with both columns driving P1.
   * DUO: each column becomes a cluster (FIRE above, arrows beneath) and owns
   * its own player, so each of the two people has their own edge of the iPad.
   *
   * Every held control is released first: the columns change which slot they
   * drive, and re-pointing a held button at a different player is precisely
   * how a direction gets stranded in the slot nobody is touching any more.
   */
  function setLayout(mode) {
    // 'duo', true ("P2 is here") and 2 (a player COUNT) all mean two columns;
    // 1 therefore has to mean one player, not "true". Anything else is solo.
    const next = (mode === LAYOUT_DUO || mode === true || mode === 2)
      ? LAYOUT_DUO : LAYOUT_SOLO;
    if (next === layoutMode) {
      applyControls();
      return layoutMode;
    }
    releaseAll();
    layoutMode = next;
    if (layoutMode === LAYOUT_SOLO) {
      // P2 has no controls any more, and no longer counts as present: the next
      // second player has to announce themselves by pressing something again.
      p2Touched = false;
      vclear(1);
    }
    applyRootAttributes();
    applyControls();
    markRectsDirty();
    return layoutMode;
  }

  function mode() {
    return controlMode;
  }

  /** BUTTONS (default) or DRAG (§4). Remembered across sessions. */
  function setMode(next) {
    const want = (next === MODE_DRAG) ? MODE_DRAG : MODE_BUTTONS;
    if (want === controlMode) {
      applyControls();
      return controlMode;
    }
    releaseAll();
    controlMode = want;
    storeSet(MODE_KEY, controlMode);
    applyRootAttributes();
    applyControls();
    markRectsDirty();
    return controlMode;
  }

  function toggleMode() {
    return setMode(controlMode === MODE_DRAG ? MODE_BUTTONS : MODE_DRAG);
  }

  function isVisible() {
    return visible;
  }

  /** Show or hide the whole layer. Hiding always releases first. */
  function setVisible(on) {
    const want = !!on;
    if (want === visible) return visible;
    visible = want;
    if (!visible) {
      releaseAll();
      stopWatch();
      p2Touched = false;      // the layer is gone; nobody is holding anything
      for (let i = 0; i < controls.length; i++) {
        const c = controls[i];
        c.active = false;
        c.el.hidden = true;
        c.rect = null;
      }
    }
    if (rootEl) rootEl.hidden = !visible;
    applyRootAttributes();
    if (visible) {
      markRectsDirty();
      updateOrientation();
      applyControls();
      startWatch();
    }
    return visible;
  }

  function isPortrait() {
    return touchCapable && portrait;
  }

  /**
   * How many CSS px are reserved down EACH edge for controls — what main.js
   * subtracts (twice) before it letterboxes the canvas, so the picture is
   * scaled into the room that is LEFT and the controls never sit on the play
   * field. Measured from the real column when it is laid out, falling back to
   * the same clamp the stylesheet uses before first layout.
   */
  function columnWidth() {
    if (!visible || !rootEl) return 0;
    const cols = rootEl.getElementsByClassName
      ? rootEl.getElementsByClassName('ti-touch__col') : null;
    let w = 0;
    if (cols) {
      for (let i = 0; i < cols.length; i++) {
        const r = readRect(cols[i]);
        if (r && (r.right - r.left) > w) w = r.right - r.left;
      }
    }
    if (w > 0) return w;
    const vw = window.innerWidth ||
               (document.documentElement && document.documentElement.clientWidth) || 0;
    return Math.max(COL_MIN, Math.min(COL_MAX, vw * (COL_VW / 100)));
  }

  function element() {
    return rootEl;
  }

  /**
   * Build the controls and attach every listener. Call once, from main.js,
   * after T.Input.init() and before the loop starts.
   *
   * @param {HTMLCanvasElement} canvas  the game canvas (DRAG hit-testing)
   * @param {HTMLElement} root          where the layer is appended
   */
  function init(canvas, root) {
    if (initialised) return T.Touch;
    if (typeof document === 'undefined' || !document.createElement) return T.Touch;

    canvasEl = canvas || document.getElementById('screen') || null;
    const host = root || document.getElementById('cabinet') || document.body;
    if (!host || typeof host.appendChild !== 'function') return T.Touch;

    const stored = storeGet(MODE_KEY, C.TOUCH_MODE_DEFAULT || MODE_BUTTONS);
    controlMode = (stored === MODE_DRAG) ? MODE_DRAG : MODE_BUTTONS;

    buildLayer(host);
    initialised = true;

    /* §2: capability, not screen size. A small window on a desktop keeps its
     * keyboard and never grows a thumb pad; an iPad reports maxTouchPoints
     * before anything has been touched, so the controls are there to greet it.
     */
    let maxTouch = 0;
    try {
      maxTouch = Number(window.navigator && window.navigator.maxTouchPoints) || 0;
    } catch (err) {
      maxTouch = 0;
    }
    touchCapable = maxTouch > 0;

    const passive = { passive: true };
    const active = { passive: false };

    if (usePointerEvents) {
      listen(rootEl, 'pointerdown', onPointerDown, active);
      listen(canvasEl, 'pointerdown', onPointerDown, active);
      listen(window, 'pointermove', onPointerMove, active);
      listen(window, 'pointerup', onPointerUp, active);
      listen(window, 'pointercancel', onPointerCancel, passive);
    } else {
      listen(rootEl, 'touchstart', onTouchStart, active);
      listen(canvasEl, 'touchstart', onTouchStart, active);
      listen(window, 'touchmove', onTouchMove, active);
      listen(window, 'touchend', onTouchEnd, active);
      listen(window, 'touchcancel', onTouchCancel, passive);
    }

    // The capability sniff above can be wrong in both directions, so a real
    // touch always wins. Passive and cheap: it turns the layer on and retires.
    listen(window, 'touchstart', onFirstTouchStart, passive);

    listen(rootEl, 'contextmenu', onContextMenu, active);
    listen(window, 'blur', onBlur, passive);
    listen(window, 'pagehide', onBlur, passive);
    listen(document, 'visibilitychange', onVisibility, passive);
    listen(window, 'resize', onResize, passive);
    listen(window, 'orientationchange', onOrientation, passive);
    listen(window, 'keydown', onFirstKey, passive);

    if (window.screen && window.screen.orientation) {
      listen(window.screen.orientation, 'change', onOrientation, passive);
    }
    if (window.visualViewport) {
      // Safari's toolbar slides without firing window.resize, and every cached
      // control rect moves with it.
      listen(window.visualViewport, 'resize', onResize, passive);
      listen(window.visualViewport, 'scroll', onResize, passive);
    }

    applyRootAttributes();
    if (touchCapable) setVisible(true);
    return T.Touch;
  }

  /* -------------------------------------------------------------------------
   * EXPORT ONTO THE GLOBAL NAMESPACE
   * ---------------------------------------------------------------------- */
  T.Touch = {
    init: init,
    isTouch: isTouch,
    promptsOn: promptsOn,
    tapStartShown: tapStartShown,
    setLayout: setLayout,
    layout: layout,
    setMode: setMode,
    mode: mode,
    toggleMode: toggleMode,
    releaseAll: releaseAll,
    setVisible: setVisible,
    isVisible: isVisible,
    isPortrait: isPortrait,
    columnWidth: columnWidth,
    element: element
  };

})(window.T = window.T || {});
