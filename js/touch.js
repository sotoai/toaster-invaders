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
 *   T.Touch.regionAt(cx, cy)     which published UI region a tap at those
 *                                CLIENT coords would hit — pure, no side
 *                                effects, and the same padded geometry the
 *                                real tap path uses (SPEC-TOUCHUI §2/§4)
 *   T.Touch.liftMetrics()        the applied cluster lift / inset, CSS px (§7)
 *   T.Touch.tick()               reconcile the virtual pad against the live
 *                                pointer set — the watchdog (SPEC-TOUCHUI §8.3)
 *
 * THE TWO RULES THIS FILE LIVES BY
 *
 *   1. TOUCH IS ADDITIVE. Nothing here changes a single frame of keyboard or
 *      gamepad play. On a machine that never sees a touch the layer is built
 *      hidden, no pointer is ever tracked, and setVirtual() is never called.
 *
 *   2. NOTHING STICKS, EVER. A direction left held sends the ship into a wall
 *      forever, which ruins the game far more thoroughly than a dropped press.
 *      So: every control remembers the SET OF POINTER IDS holding it, every
 *      pointer is tracked by id, and every escape route — pointercancel,
 *      touchcancel, blur, pagehide, a hidden tab, an orientation change, a
 *      layout or mode switch — funnels into releaseAll(). Release paths NEVER
 *      depend on hit-testing or on an element still being visible: a control
 *      that vanishes under a finger is released by id, not by geometry.
 *
 * THE STUCK FIRE BUTTON, AND WHY THIS FILE IS SHAPED THE WAY IT IS NOW
 * (SPEC-TOUCHUI.md §8 — read scratchpad/stuck-fire.js alongside this)
 *
 * Two players on one iPad reported one player's FIRE sticking on. It shipped
 * past 518 assertions because every one of them delivered a well-formed
 * `pointerup` for every `pointerdown`. A real iPad does not promise that. When
 * the element under a finger is hidden, swapped between columns, or torn out
 * while it holds pointer capture, WebKit can simply never deliver that up —
 * and a layer that only ever releases on an event it was handed will hold that
 * button until the page is reloaded.
 *
 * So the virtual pad is no longer WRITTEN by the press handlers at all. It is
 * DERIVED, in syncVirtual(), from two things and nothing else:
 *
 *     the set of pointer ids holding each control  +  the drag direction
 *
 * and reconcile() re-derives it against the live pointer table every frame.
 * That single change kills the whole bug class:
 *
 *   - a duplicate `pointerdown` for an id already in the set is a no-op, so
 *     nothing can double-count the way an integer counter can;
 *   - two controls that map to the SAME (slot, name) — both columns' START in
 *     the solo layout — no longer switch each other off, because the answer is
 *     a union rather than a per-control flag;
 *   - a control whose slot changes under a held finger cannot leave the OLD
 *     slot pressed, because the old slot is recomputed from an empty set;
 *   - a pointer the platform stopped reporting is forgotten the moment the
 *     platform tells us it is gone (see THE STALENESS SIGNALS below), and the
 *     button it was holding is released by derivation, not by an event.
 *
 * The watchdog is allowed to be blunt in exactly one direction. It may release
 * a button nothing is holding; it may NEVER release one a finger IS holding,
 * because constant dropped input is worse than a rare stuck one. Every signal
 * it acts on is therefore a PROOF that the pointer is gone, never a guess: no
 * timeouts, no "it has been quiet for a while", nothing that a thumb resting
 * perfectly still on FIRE could trip.
 *
 * WHY DOM AND NOT CANVAS DRAWING
 * The ship sits at y 636 of 720, so anything painted over the play field
 * covers the exact thing the player is aiming. The controls therefore live in
 * reserved columns OUTSIDE the picture, as real elements: the browser does the
 * hit-testing, the press feedback is a CSS class with no frame of latency, and
 * main.js scales the canvas to whatever room is left (§2).
 *
 * ...EXCEPT THE UI THE GAME ITSELF DRAWS  (SPEC-TOUCHUI.md §1 and §2)
 * The select screen IS painted on the canvas, and a canvas has no children to
 * hit-test — which is the root cause of the reported bug, that picking a
 * variant meant pressing START to cycle through a hidden order. So ui.js
 * publishes the rectangle of everything interactive it draws, in LOGICAL
 * 960x720 coordinates, and this file converts a tap into those coordinates and
 * hands the winning region to T.Game.uiTap(). This file decides only WHICH
 * rectangle was hit; game.js is the only place that acts on it, so the touch
 * layer still never touches game state. A mouse click takes the identical
 * path, which is what makes the whole thing testable without a touchscreen.
 *
 * WHAT A FINGER ON THE GLASS MEANS, IN ORDER. Three things want the same
 * pointer, so the order is fixed at pointerDOWN and never revisited:
 *
 *   1. AN ON-SCREEN CONTROL WINS. hitTest() runs first, HIT_PAD and all. A
 *      thumb on FIRE is a thumb on FIRE even where FIRE overlaps something
 *      ui.js drew, and the DOM TAP TO START panel is a control, so the title
 *      screen answers a tap through it exactly as it did before.
 *   2. THEN DRAG STEERING, but only where there is a ship to steer. On the
 *      title and select screens — and only when ui.js has actually published
 *      regions for the frame on screen — the canvas is the game's own UI, not
 *      a stick, so a pointer there is not made a drag pointer. Everywhere
 *      else DRAG mode is exactly what it was: canvasIsUi() below is the whole
 *      rule, in one place.
 *   3. OTHERWISE IT IS A CANDIDATE TAP. It holds nothing and drives nothing;
 *      if it lifts within TOUCH_TAP_MAX_PX of where it landed, the region
 *      under it goes to game.js, and if it moved further, or pressed a button
 *      on the way, or was cancelled, nothing happens at all.
 *
 * A tap therefore cannot disturb a held button (it never holds one), cannot
 * steal a drag (a drag pointer is decided first and keeps its slot for life),
 * and cannot leave anything stuck (it is an ordinary tracked pointer, released
 * and reconciled by the same two paths as every other).
 *
 * css/style.css owns every pixel of how this looks. This file owns the
 * elements, the class names and the data-attributes the stylesheet hooks on —
 * and, since SPEC-TOUCHUI §7, six custom properties published on the layer
 * root, because their values come out of T.C and CSS cannot read T.C:
 *
 *   --ti-lift-pct    T.C.TOUCH_COL_LIFT_PCT    unitless fraction of height
 *   --ti-inset-pct   T.C.TOUCH_COL_INSET_PCT   unitless fraction of width
 *   --ti-lift-min    T.C.TOUCH_COL_LIFT_MIN    px length, the clamp floor
 *   --ti-lift-max    T.C.TOUCH_COL_LIFT_MAX    px length, the clamp ceiling
 *   --ti-lift        px, a MEASURED override — set only when a column is
 *   --ti-inset       actually overflowing, absent otherwise
 *
 * The first four are the constants, published once and never recomputed: the
 * stylesheet resolves them against 100dvh and against what a column can spare,
 * live, on every resize and rotation, which is closer to the truth than any
 * number this file could hand it — Safari's sliding toolbar makes
 * window.innerHeight taller than what the player can actually see, and a lift
 * measured against a viewport that is not there is not a lift.
 *
 * The last two are the belt to that pair of braces (see THE MINECRAFT LIFT
 * below). CSS budgets the column from named heights; this file MEASURES the
 * laid-out result, and if a control has actually ended up off the top of the
 * viewport, past its column, or over the play field, it publishes a smaller
 * lift until it has not. It can only ever shrink what the stylesheet resolved
 * — the stylesheet still takes min() of the two — so a measurement that is
 * somehow wrong costs a few px of lift and can never push a control off the
 * screen, which is the failure §7 actually forbids.
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

  /** The logical canvas ui.js authors its hit regions in (SPEC-TOUCHUI §2). */
  const LOGICAL_W = num('W', 960);
  const LOGICAL_H = num('H', 720);

  /** Floor for a hit region's ON-SCREEN size, CSS px, in both axes (§4.2). */
  const REGION_MIN_PX = num('UI_REGION_MIN_PX', 56);

  /** The cluster's lift off the bottom edge and inset from the outer one (§7).
   *  Both are clamped into the same MIN..MAX band, then shrunk if the column
   *  cannot afford them — see THE MINECRAFT LIFT. */
  const LIFT_PCT = num('TOUCH_COL_LIFT_PCT', 0.07);
  const LIFT_MIN = num('TOUCH_COL_LIFT_MIN', 24);
  const LIFT_MAX = num('TOUCH_COL_LIFT_MAX', 72);
  const INSET_PCT = num('TOUCH_COL_INSET_PCT', 0.025);

  /** The smallest a control may measure once the lift has taken its room. */
  const MIN_TARGET = num('TOUCH_MIN_TARGET', 56);

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

  /* A touchscreen fires a synthetic mouse `click` after a tap it was allowed
   * to. preventDefault() on the pointerdown suppresses that on every browser
   * this game runs on, but "every browser" is not a guarantee, and a duplicate
   * would apply a select-screen change twice. So EVERY pointer the layer
   * tracked to a clean lift stamps a clock — a canvas tap, a DRAG tap and a
   * press on a control alike, because a control can be gone by the time its
   * own echo lands (see releasePointer) — and a click arriving inside this
   * window is dropped as that echo. Long enough to cover a slow synthetic
   * click, shorter than any plausible deliberate second tap. */
  const CLICK_ECHO_MS = 700;

  /** How often the layer re-reads the world (layout, prompts, labels). */
  const WATCH_MS = 250;

  /**
   * SPEC-TOUCHUI §8.3: the reconciliation safety net — the per-frame pass AND
   * the two staleness signals that feed it. 0 turns the whole net off, leaving
   * only the §8.2 bookkeeping; that exists so scratchpad/stuck-fire.js can
   * bisect the two apart and show the net is genuinely load-bearing rather
   * than decorative. It ships on, and it should stay on.
   */
  const WATCHDOG_ON = num('TOUCH_WATCHDOG', 1) !== 0;

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
  const columnEls = [null, null];   // the two column boxes, for the lift pass
  let modeBtn = null;         // the BUTTONS/DRAG toggle (label is dynamic)
  let gameModeBtn = null;     // the CO-OP/CLASSIC toggle (label is dynamic)

  /* SPEC-COOP §5: the DOWN plate on a column, and whether it is currently up.
   * Edge-triggered off T.Game.isPlayerDown(slot) — see refreshDown(). */
  const downEls = [null, null];
  const columnDown = [false, false];

  let touchCapable = false;   // §2: maxTouchPoints > 0, or a touchstart seen
  let visible = false;
  let keyboardSeen = false;   // stop drawing the tap prompts once a key lands
  let portrait = false;

  let layoutMode = LAYOUT_SOLO;
  let controlMode = MODE_BUTTONS;
  let lastDesiredLayout = LAYOUT_SOLO;

  let rectsDirty = true;
  let watchTimer = 0;

  /** SPEC-TOUCHUI §7: the lift and inset currently published to the stylesheet,
   *  in CSS px, after clamping AND after the shrink-to-fit pass. */
  let liftPx = 0;
  let insetPx = 0;
  let liftDirty = true;

  /** When the pointer path last finished a gesture — see CLICK_ECHO_MS. */
  let lastPointerTapMs = -1e9;

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
      /* The column element this control lives in, or null for the TAP TO START
       * panel, which deliberately floats over the play field instead. THE
       * MINECRAFT LIFT measures a control against its own column, so it needs
       * to be told which one that is rather than walking the DOM for it on
       * every pass. */
      colEl: opts.colEl || null,
      name: opts.name || '',
      column: opts.column || 0,
      fixedSlot: (typeof opts.fixedSlot === 'number') ? opts.fixedSlot : null,
      layouts: opts.layouts || { solo: true, duo: true },
      modes: opts.modes || { buttons: true, drag: true },
      gate: opts.gate || null,      // extra condition, re-checked by the watcher
      action: opts.action || null,  // non-pad control (the mode toggle)
      active: false,
      /* SPEC-TOUCHUI §8.2: the SET of pointer ids on this control, as a plain
       * array because it never holds more than a couple of thumbs and an array
       * can be searched, compacted and emptied without allocating — which the
       * per-frame watchdog needs. Identity, not arithmetic: a duplicate id is
       * a no-op and an up removes exactly one id. */
      holders: [],
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
      name: 'fire', column: column, colEl: col,
      layouts: (column === 0) ? duoOnly : inSolo
    });
    cluster.appendChild(fire);

    const dpad = el('div', 'ti-touch__dpad');
    const left = makeButton('left', '◀', 'Move left');
    const right = makeButton('right', '▶', 'Move right');
    const arrowLayouts = (column === 1) ? duoOnly : inSolo;
    addControl(left,
      { name: 'left', column: column, colEl: col, layouts: arrowLayouts });
    addControl(right,
      { name: 'right', column: column, colEl: col, layouts: arrowLayouts });
    dpad.appendChild(left);
    dpad.appendChild(right);
    cluster.appendChild(dpad);

    col.appendChild(cluster);

    /* SPEC-COOP §5: THE DOWNED PLAYER'S COLUMN.
     *
     * The failure mode this exists for is a player on an iPad whose ship has
     * left the field, who presses FIRE, sees nothing happen, and concludes the
     * screen has stopped listening. So the column says outright that they are
     * down and what will bring them back — the same words their HUD side and
     * the persistent marker use, because three different phrasings for one
     * state is its own kind of broken.
     *
     * The buttons themselves are NOT hidden, disabled or degated. That is a
     * deliberate safety property and not laziness: a control that vanishes
     * from under a thumb is exactly how this layer once stranded a press, and
     * the only reason it cannot do so today is that dropControlHolders()
     * releases by identity when one leaves the layout. Leaving every button on
     * the page for the whole of a down means there is no such transition to
     * get wrong — nothing to strand, nothing to re-acquire — and START and
     * BACK keep working, which SPEC-COOP §3 requires of a downed player. The
     * pad they drive is ignored for a down ship by game.js, which clears
     * fireHeld and the fire buffer every frame it is down, so a trigger held
     * through a death cannot come back as a shot on revival. */
    const downPlate = el('div', 'ti-touch__down');
    downPlate.setAttribute('aria-live', 'polite');
    const downLabel = el('span', 'ti-touch__down-label');
    downLabel.textContent = 'DOWN';
    const downWait = el('span', 'ti-touch__down-wait');
    downWait.textContent = 'NEXT WAVE';
    downPlate.appendChild(downLabel);
    downPlate.appendChild(downWait);
    downPlate.hidden = true;
    downEls[column] = downPlate;
    col.appendChild(downPlate);

    const meta = el('div', 'ti-touch__meta');
    const start = makeButton('start', 'START', 'Start and pause');
    const back = makeButton('back', 'BACK', 'Back');
    addControl(start, { name: 'start', column: column, colEl: col });
    addControl(back, { name: 'back', column: column, colEl: col });
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
        name: 'start', column: 1, fixedSlot: 1, colEl: col,
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
        column: 0, colEl: col,
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
        name: 'up', column: 0, fixedSlot: 0, colEl: col,
        gate: function () { return gameState() === 'select'; }
      });
      meta.appendChild(gm);
    }

    col.appendChild(meta);
    columnEls[column] = col;
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

    /* SPEC-TOUCHUI §7: hand the stylesheet the four constants it cannot read
     * out of T.C for itself. They never change, so this is the only place they
     * are written; the measured overrides are fitLift()'s business. */
    publishLiftInputs();

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

  /**
   * Is this element still something a thumb could be pressing?
   *
   * Asked directly rather than inferred from the rect cache, because the cache
   * can outlive what it measured: an element hidden or torn out from a path
   * that did not invalidate it still has a perfectly plausible rectangle. Both
   * the hit-test and the watchdog (§8.3) go through here, so a control that is
   * not on the page cannot be pressed and cannot stay held. Two property reads.
   */
  function elementLive(node) {
    if (!node) return false;
    if (node.isConnected === false) return false;   // torn out of the document
    if (node.hidden === true) return false;         // swapped out under a finger
    return true;
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
      c.rect = (c.active && elementLive(c.el)) ? readRect(c.el) : null;
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
      /* The rect cache can outlive the element it measured — a button hidden
       * or torn out from somewhere that did not invalidate it. Pressing a
       * control that is not on the page is how a thumb ends up holding a ghost,
       * so ask the DOM, not the cache. Two property reads per control. */
      if (!elementLive(c.el)) continue;
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
    if (!c || !c.active || !elementLive(c.el)) return false;
    const r = c.rect;
    if (!r) return false;
    return rectGap(r, x, y) <= (HIT_PAD + SLIDE_TOLERANCE);
  }

  /** The canvas box in CSS px, or null when it is not on screen. */
  function canvasRect() {
    return readRect(canvasEl);
  }

  /** A monotonic-ish clock in ms. Only ever used for differences. */
  function nowMs() {
    try {
      const p = window.performance;
      if (p && typeof p.now === 'function') return p.now();
    } catch (err) {
      /* fall through to the wall clock */
    }
    return Date.now();
  }

  /* =========================================================================
   * THE MINECRAFT LIFT   (SPEC-TOUCHUI.md §7)
   *
   * Reported from real iPad play: the on-screen buttons sit slightly too low.
   * The reference is the iOS version of Minecraft, whose controls are INSET
   * FROM THE CORNER rather than flush into it — the cluster floats a clear
   * margin above the bottom of the screen and a similar margin in from the
   * side, so a thumb rests on it without curling down into the very corner of
   * the device or riding the home indicator.
   *
   * The numbers are T.C's and the pixels are the stylesheet's. What is left
   * for this file is the handover and one guarantee.
   *
   * THE HANDOVER is publishLiftInputs(): the four constants, on the layer
   * root, once. CSS resolves them itself against 100dvh and against what a
   * column can actually spare, so the lift re-fits on a rotation or a Safari
   * toolbar slide with no JavaScript in the loop at all.
   *
   * THE GUARANTEE is §7's hard half — "it must NEVER push a control
   * off-screen" — and it is the reason this file measures at all. CSS budgets
   * the column from named heights (--ti-col-need); that budget is an estimate,
   * and an estimate that is 4 px optimistic on some device nobody has tested
   * clips a control. So fitLift() measures the laid-out result and, if a
   * control has genuinely ended up off the top of the viewport, outside its
   * column, over the play field, or under TOUCH_MIN_TARGET, publishes a
   * smaller --ti-lift / --ti-inset and measures again.
   *
   * It is a one-way ratchet: the stylesheet takes min() of the override and
   * its own fit, so this can only ever SHRINK the lift. The worst a wrong
   * measurement can do is cost a few px of float; it cannot clip anything,
   * and it cannot move the canvas, because the columns sit beside the play
   * field and this changes nothing but padding inside one of them.
   *
   * Runs on a resize, a rotation, a layout or mode switch, and whenever a
   * control comes or goes — never per frame, and never at all on a machine
   * that has not shown the layer.
   * ====================================================================== */

  /** How many measure-and-shrink passes fitLift() will spend. */
  const LIFT_FIT_PASSES = 4;

  /** Sub-pixel noise below this is not an overflow. */
  const LIFT_EPS = 0.5;

  /** What the constants asked for before any measurement, for liftMetrics(). */
  let reqLiftPx = 0;
  let reqInsetPx = 0;
  /** Did the last pass have real rects to look at? */
  let liftMeasured = false;

  function viewportW() {
    const w = window.innerWidth ||
      (document.documentElement && document.documentElement.clientWidth) || 0;
    return (typeof w === 'number' && isFinite(w) && w > 0) ? w : 0;
  }

  function viewportH() {
    const h = window.innerHeight ||
      (document.documentElement && document.documentElement.clientHeight) || 0;
    return (typeof h === 'number' && isFinite(h) && h > 0) ? h : 0;
  }

  /**
   * CSS's own clamp(min, v, max), including its tie-break: when the floor is
   * above the ceiling the FLOOR wins. Matching that matters, because the
   * stylesheet computes the same clamp from the same three numbers and the two
   * answers have to agree on a device where somebody has set them oddly.
   */
  function clampLift(v) {
    let out = (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0;
    const lo = (LIFT_MIN > 0) ? LIFT_MIN : 0;
    let hi = (LIFT_MAX > 0) ? LIFT_MAX : 0;
    if (hi < lo) hi = lo;
    if (out > hi) out = hi;
    if (out < lo) out = lo;
    return out;
  }

  /** Write one custom property on the layer root. Never throws. */
  function setProp(name, value) {
    if (!rootEl || !rootEl.style) return;
    const s = rootEl.style;
    // A DOM stub with a plain-object `style` has nothing to set: there is no
    // stylesheet behind it either, so there is nothing to get wrong.
    if (typeof s.setProperty !== 'function') return;
    try {
      s.setProperty(name, value);
    } catch (err) {
      /* an engine that will not take the property simply lays out unlifted */
    }
  }

  /** Remove one, so the stylesheet falls back to its own resolved value. */
  function clearProp(name) {
    if (!rootEl || !rootEl.style) return;
    const s = rootEl.style;
    try {
      if (typeof s.removeProperty === 'function') s.removeProperty(name);
      else if (typeof s.setProperty === 'function') s.setProperty(name, '');
    } catch (err) {
      /* as above */
    }
  }

  /** The four constants. Published once — they are T.C, not measurements. */
  function publishLiftInputs() {
    setProp('--ti-lift-pct', String(LIFT_PCT));
    setProp('--ti-inset-pct', String(INSET_PCT));
    setProp('--ti-lift-min', LIFT_MIN + 'px');
    setProp('--ti-lift-max', LIFT_MAX + 'px');
  }

  function markLiftDirty() {
    liftDirty = true;
  }

  /**
   * How far the columns are overflowing, in CSS px, with whatever lift is
   * applied right now. Null when there is nothing measurable — no layout yet,
   * or a DOM stub — because a guess there could only shrink a lift that is
   * fine.
   *
   *   .top   how far past the TOP of the viewport a control reaches. The lift
   *          is what pushed it there (the columns are bottom-anchored, so
   *          content that does not fit overflows upwards), so this is what
   *          comes off the lift.
   *   .side  how far past its own column a control reaches, how far it has got
   *          over the play field, and how far under TOUCH_MIN_TARGET it has
   *          been squeezed — the three ways an inset can go wrong, and all
   *          three are paid back out of the inset.
   *
   * The P1/P2 tag and the gaps are deliberately not measured: §7 asserts about
   * CONTROLS, and the stylesheet's budget already reserves the tag with an
   * over-estimate. Erring high there only shrinks the lift early, which is the
   * safe direction.
   */
  function measureOverflow() {
    const vh = viewportH();
    if (!(vh > 0)) return null;

    const canvas = canvasRect();
    // The two column boxes, read ONCE. A forced layout per control per pass is
    // exactly the sort of thing that turns 60fps into 45 on the device this
    // file exists for.
    const colRects = [readRect(columnEls[0]), readRect(columnEls[1])];
    let seen = false;
    let top = 0;
    let side = 0;

    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (!c.active || !c.colEl || !elementLive(c.el)) continue;
      const column = (c.colEl === columnEls[0]) ? 0
                   : (c.colEl === columnEls[1]) ? 1 : -1;
      if (column < 0) continue;
      const cr = colRects[column];
      if (!cr) continue;
      const r = readRect(c.el);
      if (!r) continue;
      seen = true;

      /* Only the TOP is measured. The columns are bottom-anchored and the lift
       * IS the bottom padding, so content that does not fit overflows upward
       * and shrinking the lift is exactly what pays for it. A control below
       * the bottom of the viewport could only mean the lift is too SMALL,
       * which is not a state this ratchet is allowed to leave. */
      if (-r.top > top) top = -r.top;

      // The outer edge is the one the inset pushes away from, so the control
      // can only ever run out of room at the INNER edge — the one the canvas
      // is on.
      if (column === 0) {
        if (r.right - cr.right > side) side = r.right - cr.right;
        if (canvas && r.right - canvas.left > side) side = r.right - canvas.left;
      } else {
        if (cr.left - r.left > side) side = cr.left - r.left;
        if (canvas && canvas.right - r.left > side) side = canvas.right - r.left;
      }

      /* A control squeezed under the minimum target has had the room taken
       * from it by the inset, and giving the inset back is what returns it.
       * The stylesheet's own min-width should make this unreachable; it is
       * measured anyway, because §7's assertion is about the size a thumb
       * actually gets and this file must not have to trust another file's
       * declaration for that. */
      const w = r.right - r.left;
      if (MIN_TARGET - w > side) side = MIN_TARGET - w;
    }

    if (!seen) return null;
    return { top: top, side: side };
  }

  /**
   * Publish the lift, then measure it and shrink it until nothing overflows.
   *
   * Pass 0 clears any previous override so the measurement is of what the
   * stylesheet resolves on its own; each later pass takes the measured
   * overflow off what it published last. Bounded, and it stops the moment the
   * columns fit — which on every supported size is the first pass.
   */
  function fitLift() {
    liftDirty = false;
    liftMeasured = false;

    reqLiftPx = clampLift(LIFT_PCT * viewportH());
    reqInsetPx = clampLift(INSET_PCT * viewportW());
    liftPx = reqLiftPx;
    insetPx = reqInsetPx;

    // Hidden or portrait: there is no cluster to lift, and no rect to trust.
    if (!rootEl || !visible || portrait) {
      clearProp('--ti-lift');
      clearProp('--ti-inset');
      return;
    }

    clearProp('--ti-lift');
    clearProp('--ti-inset');

    for (let pass = 0; pass < LIFT_FIT_PASSES; pass++) {
      const over = measureOverflow();
      if (!over) return;                  // nothing laid out: trust the CSS
      liftMeasured = true;
      if (over.top <= LIFT_EPS && over.side <= LIFT_EPS) return;

      if (over.top > LIFT_EPS) liftPx = Math.max(0, liftPx - over.top);
      if (over.side > LIFT_EPS) insetPx = Math.max(0, insetPx - over.side);
      setProp('--ti-lift', liftPx + 'px');
      setProp('--ti-inset', insetPx + 'px');
      markRectsDirty();                   // every control just moved
    }
  }

  function ensureLift() {
    if (liftDirty) fitLift();
  }

  /* =========================================================================
   * CANVAS TAPS -> PUBLISHED UI REGIONS   (SPEC-TOUCHUI.md §2 and §4)
   *
   * ui.js records the rectangle of everything interactive it draws, in the
   * LOGICAL 960x720 coordinates it draws in. A tap arrives in CLIENT pixels on
   * a canvas that is letterboxed, scaled, and moves whenever Safari's toolbar
   * slides — so the rect is read LIVE on every tap, never cached. A tap is a
   * once-per-gesture event; a getBoundingClientRect there costs nothing, and a
   * cached one would send the tap to the wrong row after a rotation.
   *
   * THE PART THAT DECIDES WHETHER THIS FEATURE ACTUALLY WORKS is not the
   * routing, it is the padding. A variant thumbnail is 54x44 logical, which is
   * about 46x38 CSS px on an 11-inch iPad — a third under the 56 px a thumb
   * needs. ui.js draws them bigger on touch and this pads what is left, so
   * every region ends up at least UI_REGION_MIN_PX on the glass in both axes.
   * Padding that swallowed a neighbour would trade one unhittable target for
   * one that hits the WRONG thing, which is worse, so two regions that would
   * collide split the gap between them and neither ever shrinks below the art
   * it was published for.
   * ====================================================================== */

  /** Live canvas geometry plus the logical<->CSS scale, or null if off screen. */
  function canvasMetrics() {
    const r = canvasRect();
    if (!r) return null;
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    if (!(w > 0) || !(h > 0) || !(LOGICAL_W > 0) || !(LOGICAL_H > 0)) return null;
    const sx = w / LOGICAL_W;
    const sy = h / LOGICAL_H;
    return {
      rect: r, sx: sx, sy: sy,
      // The floor, expressed in the logical units the regions are authored in.
      minW: (sx > 0) ? (REGION_MIN_PX / sx) : 0,
      minH: (sy > 0) ? (REGION_MIN_PX / sy) : 0
    };
  }

  /** The regions ui.js published for the frame on screen, or null. */
  function publishedRegions() {
    try {
      const ui = T.UI;
      if (!ui || typeof ui.regions !== 'function') return null;
      const list = ui.regions();
      if (!list || typeof list.length !== 'number' || list.length === 0) return null;
      return list;
    } catch (err) {
      return null;      // a UI that cannot answer simply has no tappable areas
    }
  }

  /**
   * Grow one axis to `min`, about its centre, without leaving the canvas and
   * without ever ending up smaller than the art it was published for.
   */
  function growAxis(lo, hi, min, limit, out) {
    let a = lo;
    let b = hi;
    if ((b - a) < min) {
      const c = (a + b) / 2;
      a = c - min / 2;
      b = c + min / 2;
      if (a < 0) { b -= a; a = 0; }             // slide back inside, keep size
      if (b > limit) { a -= (b - limit); b = limit; }
      if (a < 0) a = 0;
    }
    if (a > lo) a = lo;                          // never smaller than the art
    if (b < hi) b = hi;
    out[0] = a;
    out[1] = b;
  }

  /** Do two intervals overlap at all? (Touching edges do not count.) */
  function spans(a0, a1, b0, b1) {
    return a0 < b1 && b0 < a1;
  }

  /**
   * Stop padded boxes from eating each other.
   *
   * Only pairs whose ART does not overlap are separated — two things ui.js
   * deliberately drew on top of one another (a badge on a thumbnail) keep
   * their nesting and are settled by "last drawn wins" at hit-test time. For
   * the rest, the shared edge goes at the MIDPOINT OF THE ORIGINAL GAP, which
   * is symmetric, order-independent, and never pushes either box back inside
   * its own artwork. Each clamp only ever tightens a box, so one pass is
   * enough: tightening can never create a new overlap.
   */
  function separate(boxes) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i];
        const B = boxes[j];
        if (!spans(A.x0, A.x1, B.x0, B.x1)) continue;
        if (!spans(A.y0, A.y1, B.y0, B.y1)) continue;

        // Which axis were they actually apart on before the padding?
        const xLeft = (A.ox1 <= B.ox0) ? A : ((B.ox1 <= A.ox0) ? B : null);
        const yAbove = (A.oy1 <= B.oy0) ? A : ((B.oy1 <= A.oy0) ? B : null);
        if (!xLeft && !yAbove) continue;         // the art itself overlaps

        let xCost = Infinity;
        let xMid = 0;
        let xRight = null;
        if (xLeft) {
          xRight = (xLeft === A) ? B : A;
          xMid = (xLeft.ox1 + xRight.ox0) / 2;
          xCost = Math.max(0, xLeft.x1 - xMid) + Math.max(0, xMid - xRight.x0);
        }
        let yCost = Infinity;
        let yMid = 0;
        let yBelow = null;
        if (yAbove) {
          yBelow = (yAbove === A) ? B : A;
          yMid = (yAbove.oy1 + yBelow.oy0) / 2;
          yCost = Math.max(0, yAbove.y1 - yMid) + Math.max(0, yMid - yBelow.y0);
        }

        // Split on whichever axis costs the least hit area to split on.
        if (xLeft && xCost <= yCost) {
          if (xLeft.x1 > xMid) xLeft.x1 = xMid;
          if (xRight.x0 < xMid) xRight.x0 = xMid;
        } else if (yAbove) {
          if (yAbove.y1 > yMid) yAbove.y1 = yMid;
          if (yBelow.y0 < yMid) yBelow.y0 = yMid;
        }
      }
    }
  }

  /**
   * The published regions as padded, non-overlapping boxes in logical coords.
   * Order is preserved, because draw order is what breaks a tie.
   */
  function padRegions(list, m) {
    const boxes = [];
    const span = [0, 0];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r) continue;
      const x = Number(r.x);
      const y = Number(r.y);
      const w = Number(r.w);
      const h = Number(r.h);
      if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) continue;
      if (!(w > 0) || !(h > 0)) continue;

      const box = {
        region: r,
        ox0: x, oy0: y, ox1: x + w, oy1: y + h,
        x0: x, y0: y, x1: x + w, y1: y + h
      };
      growAxis(box.ox0, box.ox1, m.minW, LOGICAL_W, span);
      box.x0 = span[0];
      box.x1 = span[1];
      growAxis(box.oy0, box.oy1, m.minH, LOGICAL_H, span);
      box.y0 = span[0];
      box.y1 = span[1];
      boxes.push(box);
    }
    separate(boxes);
    return boxes;
  }

  /**
   * Which region is under this CLIENT point? LAST match wins, so whatever ui.js
   * drew on top of everything else is what a thumb landing on it receives.
   */
  function regionAtClient(clientX, clientY) {
    if (!initialised) return null;
    if (touchCapable && portrait) return null;   // the rotate prompt is up
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return null;
    if (!isFinite(clientX) || !isFinite(clientY)) return null;

    const list = publishedRegions();
    if (!list) return null;
    const m = canvasMetrics();
    if (!m) return null;

    const r = m.rect;
    if (clientX < r.left || clientX > r.right ||
        clientY < r.top || clientY > r.bottom) return null;

    const lx = (clientX - r.left) / m.sx;
    const ly = (clientY - r.top) / m.sy;

    const boxes = padRegions(list, m);
    let hit = null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (lx < b.x0 || lx > b.x1 || ly < b.y0 || ly > b.y1) continue;
      hit = b.region;                            // keep going: last one wins
    }
    return hit;
  }

  /** Hand a region to the one file allowed to act on it. Never throws. */
  function dispatchTap(region) {
    if (!region) return false;
    try {
      const g = T.Game;
      if (g && typeof g.uiTap === 'function') {
        g.uiTap(region);
        return true;
      }
    } catch (err) {
      /* a UI action that fails must not strand the pointer that delivered it */
    }
    return false;
  }

  /**
   * Is the canvas showing the game's own UI rather than a play field?
   *
   * This is the whole of precedence rule 2 (see the header). It is the ONE
   * question that decides whether a pointer landing on the picture in DRAG
   * mode steers a ship or taps a menu, and it is deliberately conservative in
   * both halves:
   *
   *   - the STATE has to be one of the two screens SPEC-TOUCHUI §3 makes
   *     tappable. 'pause' and 'over' are not on the list, so DRAG mode behaves
   *     there exactly as it shipped — a tap on the canvas is still the shot
   *     that dismisses the GAME OVER screen.
   *   - ui.js has to have actually PUBLISHED something. A build whose ui.js
   *     publishes no regions yet is not a build where a tap can go anywhere,
   *     so it keeps today's behaviour rather than losing an affordance and
   *     gaining nothing.
   *
   * BUTTONS mode never asks: a pointer on the canvas holds nothing there
   * either way, so the tap is purely additive.
   */
  function canvasIsUi() {
    const s = gameState();
    if (s !== 'title' && s !== 'select') return false;
    return publishedRegions() !== null;
  }

  /**
   * A tap landed on the canvas: find what it hit and deliver it.
   *
   * Wrapped whole, because everything it touches — the region list, the canvas
   * rect, game.js's handler — belongs to another file, and this is called from
   * inside a pointer release. Nothing here may take the release path down.
   */
  function routeCanvasTap(clientX, clientY) {
    try {
      return dispatchTap(regionAtClient(clientX, clientY));
    } catch (err) {
      return false;
    }
  }

  /* =========================================================================
   * PRESSES, HELD BY POINTER ID IDENTITY   (SPEC-TOUCHUI §8.2)
   *
   * A control is HELD WHILE ANY POINTER IS ON IT. Two thumbs on FIRE and one
   * lifting must leave FIRE down; a finger sliding off ▶ onto ◀ must swap
   * cleanly. What does that bookkeeping is the SET of pointer ids on each
   * control — not a counter. A counter is one duplicate `pointerdown` away
   * from never reaching zero again, and that is a button stuck on for the rest
   * of the session; a set simply cannot drift, because adding an id that is
   * already there changes nothing and removing one removes exactly one.
   *
   * These functions do not touch the virtual pad. NOTHING does, except
   * syncVirtual() below, which derives it. That is the whole design.
   * ====================================================================== */

  /** Remember that a thumb has driven this slot (see p2Touched). */
  function noteSlotTouched(slot) {
    if (slot === 1) p2Touched = true;
  }

  function holderIndex(c, key) {
    const h = c.holders;
    for (let i = 0; i < h.length; i++) if (h[i] === key) return i;
    return -1;
  }

  /** Add an id to a control's set. False when it was already there. */
  function addHolder(c, key) {
    if (holderIndex(c, key) >= 0) return false;
    c.holders.push(key);
    return true;
  }

  /** Remove one id. In-place compaction: splice() would allocate. */
  function removeHolder(c, key) {
    const h = c.holders;
    const i = holderIndex(c, key);
    if (i < 0) return false;
    for (let j = i; j < h.length - 1; j++) h[j] = h[j + 1];
    h.length = h.length - 1;
    return true;
  }

  function clearHolders(c) {
    c.holders.length = 0;
  }

  /** Keep the pressed styling in step with the set. */
  function paintPressed(c) {
    if (!c.el || !c.el.classList) return;
    if (c.holders.length > 0) c.el.classList.add('is-pressed');
    else c.el.classList.remove('is-pressed');
  }

  function pressControl(c, key) {
    if (!addHolder(c, key)) return;            // duplicate id: genuinely nothing
    if (c.holders.length === 1) {
      paintPressed(c);
      if (!c.action && c.name) noteSlotTouched(c.slot);
      if (c.action) {
        try {
          c.action();
        } catch (err) {
          /* a layer action must never leave the pointer table inconsistent */
        }
        return;                                // the action re-derives for us
      }
    }
    syncVirtual();
  }

  function releaseControl(c, key) {
    if (!removeHolder(c, key)) return;         // it was not holding this one
    paintPressed(c);
    syncVirtual();
  }

  /**
   * Force a control fully up and detach every pointer from it.
   *
   * Called when a control leaves the current layout or mode — including while
   * a thumb is on it. Releasing by identity rather than by geometry is what
   * makes "the button vanished under my finger" safe: the pointer stays
   * tracked (it can slide onto another control), the input is dropped.
   */
  function dropControlHolders(c) {
    if (c.holders.length === 0) return;
    for (const key in pointers) {
      const rec = pointers[key];
      if (rec && rec.control === c) rec.control = null;
    }
    clearHolders(c);
    paintPressed(c);
    syncVirtual();
  }

  function deactivateControl(c) {
    dropControlHolders(c);
    paintPressed(c);
    c.rect = null;
  }

  /* =========================================================================
   * THE VIRTUAL PAD IS DERIVED, NEVER WRITTEN   (SPEC-TOUCHUI §8.2 / §8.3)
   *
   * One function computes what every virtual button should be from the holder
   * sets and the drag directions, and pushes only the differences into
   * input.js. Because it recomputes the WHOLE picture rather than adjusting it,
   * no sequence of events can leave a residue: the moment the last id leaves a
   * control the derived answer is false, whatever happened on the way there.
   *
   * `desired` and `applied` are allocated once, at module load, and reused —
   * this runs every frame while a thumb is down and must not make garbage.
   * ====================================================================== */

  const VNAMES = ['left', 'right', 'up', 'down', 'fire', 'start', 'back', 'altChar'];
  const VN = VNAMES.length;

  const IDX_LEFT = 0;
  const IDX_RIGHT = 1;
  const IDX_FIRE = 4;

  /** What the fingers say. Rebuilt from scratch on every call. */
  const desired = [new Array(VN), new Array(VN)];
  /** What input.js was last told, so only real changes cross the bridge. */
  const applied = [new Array(VN), new Array(VN)];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < VN; i++) { desired[s][i] = false; applied[s][i] = false; }
  }

  function nameIndex(name) {
    for (let i = 0; i < VN; i++) if (VNAMES[i] === name) return i;
    return -1;
  }

  /**
   * Push the derived state into input.js. O(controls), zero allocation.
   *
   * `force` re-asserts every bit instead of only the ones that changed. The
   * watchdog uses it once a frame while a thumb is down, because input.js has
   * release paths of its own (its blur and visibilitychange handlers wipe the
   * virtual pad) and a mirror that had gone stale against them would be exactly
   * the kind of quiet disagreement this section exists to make impossible.
   * setVirtual() is idempotent, so re-asserting costs sixteen no-ops.
   */
  function syncVirtual(force) {
    for (let s = 0; s < 2; s++) {
      const d = desired[s];
      for (let i = 0; i < VN; i++) d[i] = false;
    }

    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (c.action || !c.name) continue;
      if (c.holders.length === 0) continue;
      const idx = nameIndex(c.name);
      if (idx < 0) continue;
      desired[(c.slot === 1) ? 1 : 0][idx] = true;
    }

    // DRAG mode steers through the same derived state, so a thumb on the
    // canvas and a thumb on ◀ can never argue about who owns the direction.
    for (let s = 0; s < 2; s++) {
      const dir = dragSlots[s].dir;
      if (dir < 0) desired[s][IDX_LEFT] = true;
      else if (dir > 0) desired[s][IDX_RIGHT] = true;
    }

    for (let s = 0; s < 2; s++) {
      const d = desired[s];
      const a = applied[s];
      for (let i = 0; i < VN; i++) {
        if (d[i] === a[i] && !force) continue;
        a[i] = d[i];
        vset(s, VNAMES[i], d[i]);
      }
    }
  }

  /**
   * Hand a slot back to the keyboard and the gamepad.
   *
   * clearVirtual() wipes input.js's side, so the mirror here has to be wiped
   * too — otherwise `applied` would still claim a button is pressed that
   * input.js has already forgotten, and syncVirtual() would never push it
   * again. Every un-claim in this file goes through here for that reason.
   */
  function vclearSlot(slot) {
    const a = applied[slot];
    for (let i = 0; i < VN; i++) a[i] = false;
    vclear(slot);
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

  /** Is the player this column belongs to sitting out the wave (SPEC-COOP §3)? */
  function playerIsDown(slot) {
    try {
      const g = T.Game;
      if (!g || typeof g.isPlayerDown !== 'function') return false;
      return g.isPlayerDown(slot) === true;
    } catch (err) {
      // A game that cannot be asked is a game with nobody down. Never let a
      // read of somebody else's state take this layer down.
      return false;
    }
  }

  /**
   * Put each column into, or out of, its DOWN state (SPEC-COOP §5).
   *
   * Edge-triggered: the DOM is touched only on the frames the answer actually
   * changes, so the ordinary case — nobody down, in any mode, on any screen —
   * costs two function calls and nothing else. `T.Game.isPlayerDown` is false
   * for every board that is not two-player co-op, which is what keeps this
   * inert in 1P, in classic and on every menu.
   *
   * SOLO hands both columns to P1, so a column's player is its own only in
   * DUO — which is the only layout a two-player co-op board can produce
   * anyway. Written from `layoutMode` rather than assumed, because a layout
   * this file inferred wrongly must not put "DOWN" over a live player.
   *
   * `data-down` is SET to "0" rather than removed: the DOM shim the touch
   * regression suite runs against has no removeAttribute, and a stylesheet
   * keyed on ="1" does not need one.
   */
  function refreshDown() {
    for (let col = 0; col < 2; col++) {
      const slot = (layoutMode === LAYOUT_DUO) ? col : 0;
      const down = !!(visible && !portrait && playerIsDown(slot));
      if (down === columnDown[col]) continue;
      columnDown[col] = down;

      const box = columnEls[col];
      if (box && typeof box.setAttribute === 'function') {
        box.setAttribute('data-down', down ? '1' : '0');
      }
      const plate = downEls[col];
      if (plate) plate.hidden = !down;

      // The plate is a real box in the column's flex stack, so the content is
      // a different height than it was: the fit pass has to see it, and any
      // rect cached from before it appeared is stale.
      markRectsDirty();
      markLiftDirty();
    }
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
        markLiftDirty();
      }
      c.slot = slot;
      if (want && !c.active) {
        c.active = true;
        c.el.hidden = false;
        markRectsDirty();
        markLiftDirty();
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
    /* SPEC-COOP §5: before the lift is measured, because the DOWN plate is
     * part of the column's content and appearing changes its height. */
    refreshDown();

    /* A control coming or going changes how tall the column's content is, so
     * the lift is re-measured HERE, after the DOM is settled and before
     * anything reads a rect off it (SPEC-TOUCHUI §7). No-ops unless something
     * actually moved. */
    ensureLift();
    // Slots may have just moved between columns. Re-derive rather than trust
    // whatever the last press wrote (SPEC-TOUCHUI §8.2).
    syncVirtual();
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
    // The direction is a DERIVED thing now, exactly like a button: a drag that
    // stops steering must not switch off an arrow a second thumb is holding.
    syncVirtual();
  }

  /** Drop a slot's steering completely. Used by every release path. */
  function resetDragSlot(slot) {
    const d = dragSlots[slot];
    d.fingers = 0;
    d.debt = 0;
    if (d.dir !== 0) {
      d.dir = 0;
      syncVirtual();
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
    // This is the one place that writes the pad without deriving it, so put
    // the mirror back where input.js actually is and let syncVirtual() decide
    // again — otherwise a tap by one thumb would leave FIRE switched off for a
    // second thumb that is genuinely holding the button.
    applied[slot][IDX_FIRE] = false;
    syncVirtual();
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

  function beginPointer(key, rawId, x, y) {
    /* A second `pointerdown` for an id we are already tracking is not a second
     * finger — it is the same one, arriving twice. Forget the old record (this
     * is also what a lost 'up' looks like from here) WITHOUT running the cancel
     * path: a cancel un-claims the slot and drops input.js's sub-frame latch,
     * and doing that to a player mid-press because the browser repeated itself
     * would throw away a shot they had already fired. */
    if (pointers[key]) forgetPointer(key);
    if (!trackable()) return false;

    /* PRECEDENCE RULE 1 (see the header): an on-screen control always wins,
     * whatever ui.js may have drawn on the canvas underneath it. */
    const control = hitTest(x, y);
    if (control) {
      pointers[key] = {
        key: key, rawId: rawId, control: control, drag: false, slot: control.slot,
        x0: x, y0: y, lastX: x, lastY: y, travel: 0,
        scale: 0, captureNode: null, tap: false
      };
      pointerCount++;
      pressControl(control, key);
      scheduleWatchdog();
      return true;
    }

    /* One canvasRect() serves both remaining rules, and the answer is fixed
     * here, at pointerdown, for the life of the pointer. */
    const r = canvasRect();
    const onCanvas = !!(r && x >= r.left && x <= r.right &&
                        y >= r.top && y <= r.bottom);

    // PRECEDENCE RULE 2: steer, but only where there is a ship to steer.
    if (controlMode === MODE_DRAG && onCanvas && !canvasIsUi()) {
      const slot = dragSlotForX(x, r);
      // Logical px per CSS px, so DRAG feels the same at every canvas scale.
      const scale = ((C.W || 960) / (r.right - r.left)) * DRAG_SENS;
      pointers[key] = {
        key: key, rawId: rawId, control: null, drag: true, slot: slot,
        x0: x, y0: y, lastX: x, lastY: y, travel: 0,
        scale: scale, captureNode: null, tap: false
      };
      pointerCount++;
      dragSlots[slot].fingers++;
      noteSlotTouched(slot);
      scheduleDragTick();
      scheduleWatchdog();
      return true;
    }

    /* Landed on the layer or on the picture, but not on a control: track it
     * anyway, with nothing held. A thumb that comes down between two buttons
     * and slides onto one is a completely normal gesture and must not be dead,
     * and a thumb that comes down on the canvas is a candidate TAP. */
    pointers[key] = {
      key: key, rawId: rawId, control: null, drag: false, slot: 0,
      x0: x, y0: y, lastX: x, lastY: y, travel: 0,
      scale: 0, captureNode: null,
      /* PRECEDENCE RULE 3: it came down on the picture and it is holding
       * nothing, so if it lifts without really moving it is a tap on whatever
       * ui.js drew there (SPEC-TOUCHUI §2). A pointer that came down anywhere
       * else — in the gap between two buttons, say — is tracked exactly as
       * before and can never deliver one. */
      tap: onCanvas
    };
    pointerCount++;
    scheduleWatchdog();
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

    if (rec.control) releaseControl(rec.control, key);
    rec.control = next;
    if (next) {
      pressControl(next, key);
      // It has pressed a button. Whatever it landed on, it is not a tap on the
      // picture any more — one gesture does one thing.
      rec.tap = false;
    }
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
      if (c.holders.length > 0 && !c.action && c.slot === slot) return false;
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

    if (rec.control) releaseControl(rec.control, key);

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
      if (slot >= 0 && slotIdle(slot)) vclearSlot(slot);
    }
    if (pointerCount === 0 && !dragActive()) stopWatchdog();

    /* SPEC-TOUCHUI §2: a pointer that came down on the canvas, held nothing on
     * the way, and lifted within TOUCH_TAP_MAX_PX of where it landed is a TAP
     * on whatever ui.js drew under it. `finish` matters: a CANCELLED press is
     * not a tap, exactly as it is not a shot.
     *
     * Deliberately the LAST thing this function does. Everything above it has
     * already left the pointer table, the holder sets and the virtual pad
     * consistent, so game.js is called from a settled layer and nothing it
     * does — including changing the screen out from under us — can strand a
     * finger. `lastX/lastY` are the lift coordinates: both event paths move
     * the pointer to them before releasing it. */
    if (finish) {
      /* A touchscreen will fire a synthetic click after this in a moment, and
       * that click is THIS gesture arriving a second time through the mouse
       * door (see CLICK_ECHO_MS and onClick). Stamp the clock for EVERY
       * finished pointer, not only the canvas ones.
       *
       * The control case is not hypothetical. onClick's other guard is "a
       * click on one of our own buttons belongs to that button", and it asks
       * hitTest — which answers about the layer as it is NOW, not as it was
       * when the finger landed. TAP TO START is the control that press itself
       * retires: by the time its echo click arrives the panel is off the title
       * screen and gone, hitTest finds nothing, and the click would be routed
       * as a fresh tap on whatever the SELECT screen has drawn in that band —
       * silently flipping CO-OP/CLASSIC. A tracked pointer means the pointer
       * path has already had this gesture; the mouse door exists for the
       * machines where nothing is tracked at all. */
      lastPointerTapMs = nowMs();
    }
    if (finish && rec.tap && rec.travel <= TAP_MAX_PX) {
      routeCanvasTap(rec.lastX, rec.lastY);
    }
    return true;
  }

  /**
   * Forget one pointer because the PLATFORM has stopped reporting it.
   *
   * The difference from releasePointer() is intent, and it matters: this is not
   * a lift and not a cancel, it is us discovering that a finger we still had on
   * the books is gone. So there is no tap, and there is no vclear() — the slot
   * keeps its claim and its latch, because nothing about the player changed,
   * only what we knew about them. Everything it touches is released by identity.
   */
  function forgetPointer(key) {
    const rec = pointers[key];
    if (!rec) return false;

    delete pointers[key];
    pointerCount--;
    if (pointerCount < 0) pointerCount = 0;

    if (rec.control) releaseControl(rec.control, key);

    if (rec.drag) {
      const d = dragSlots[rec.slot];
      d.fingers--;
      if (d.fingers <= 0) {
        resetDragSlot(rec.slot);
      } else {
        d.debt = 0;
        steerFromDebt(rec.slot);
      }
      if (!dragActive()) stopDragTick();
    }
    return true;
  }

  /** Forget every tracked pointer. Used by the staleness signals below. */
  function forgetAllPointers() {
    let hit = false;
    for (const key in pointers) {
      if (forgetPointer(key)) hit = true;
    }
    return hit;
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
      clearHolders(c);
      paintPressed(c);
    }

    resetDragSlot(0);
    resetDragSlot(1);
    stopDragTick();
    stopWatchdog();

    syncVirtual();
    vclearSlot(0);
    vclearSlot(1);
  }

  /* =========================================================================
   * THE RECONCILIATION WATCHDOG   (SPEC-TOUCHUI §8.3)
   *
   * Every frame while anything is being touched, the virtual pad is rebuilt
   * from the live pointer table, and the pointer table itself is checked
   * against the DOM. The pointer set is the single source of truth; what
   * input.js holds is derived from it and is never allowed to be older.
   *
   * It is O(active pointers + controls) — a dozen array slots and one compaction
   * pass — and allocates nothing, because `desired`/`applied` are module-level
   * and the holder arrays are compacted in place.
   *
   * THE ONE THING IT MAY NOT DO is release a button a finger is genuinely
   * holding, so it never acts on elapsed time or on silence. It acts on facts:
   * a holder id that no longer names a live pointer, a pointer whose control is
   * no longer on the page, and the two staleness signals below, each of which
   * is a PROOF from the platform that a pointer has ended.
   * ====================================================================== */

  function reconcile() {
    if (!initialised || !WATCHDOG_ON) return;

    /* 1. A control that is no longer on the page cannot be held. This is the
     *    solo<->duo swap and the "captured element hidden" case: the up for
     *    that finger may never arrive, so do not wait for it. */
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      if (c.holders.length === 0) continue;
      if (!c.active || !elementLive(c.el)) dropControlHolders(c);
    }

    /* 2. Every id in a holder set must still name a live pointer that still
     *    points back at that control. Anything else is residue. */
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      const h = c.holders;
      if (h.length === 0) continue;
      let w = 0;
      for (let r = 0; r < h.length; r++) {
        const rec = pointers[h[r]];
        if (rec && rec.control === c) h[w++] = h[r];
      }
      if (w === h.length) continue;
      h.length = w;
      paintPressed(c);
    }

    /* 3. The pad is whatever the fingers now say it is — asserted outright, so
     *    it cannot be older than the pointer table by even one frame. */
    syncVirtual(true);

    if (pointerCount === 0 && !dragActive()) stopWatchdog();
  }

  /* --- the rAF pump ------------------------------------------------------
   * The watchdog runs only while something is actually being touched, and
   * stops itself the frame after the last finger leaves — a machine where
   * nobody has ever touched the screen must not pay a callback for this.
   * main.js may also drive it from the game loop via T.Touch.tick(). */

  let watchRaf = 0;

  function watchdogTick() {
    watchRaf = 0;
    reconcile();
    if (pointerCount > 0 || dragActive()) scheduleWatchdog();
  }

  function scheduleWatchdog() {
    if (!WATCHDOG_ON || watchRaf) return;
    if (typeof window.requestAnimationFrame === 'function') {
      watchRaf = window.requestAnimationFrame(watchdogTick);
    } else {
      watchRaf = window.setTimeout(watchdogTick, 16);
    }
  }

  function stopWatchdog() {
    if (!watchRaf) return;
    try {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(watchRaf);
      } else {
        window.clearTimeout(watchRaf);
      }
    } catch (err) {
      /* the callback is a no-op once the pointer table is empty */
    }
    watchRaf = 0;
  }

  /* --- THE STALENESS SIGNALS ---------------------------------------------
   * Two facts the platform hands us for free, each of which PROVES a pointer
   * has ended. Neither can be wrong in the dangerous direction.
   *
   *   isPrimary — per the Pointer Events spec a pointerdown is primary only
   *     when no other pointer of that type is active. So a primary touch
   *     pointerdown proves that every touch pointer we still had on the books
   *     ended without telling us. A finger resting on FIRE would make the next
   *     pointerdown non-primary, so this can never fire underneath one.
   *
   *   an empty touch roster — `TouchEvent.touches` is every touch in contact
   *     with the surface. Length ZERO means the glass is empty, full stop.
   *     iPadOS Safari fires touch events alongside pointer events, so this
   *     works even though the pointer path is the one we listen to; where a
   *     browser fires no touch events at all we simply never get the signal
   *     and lean on isPrimary instead.
   *
   * Only the EMPTY roster is used, never "id 22 is missing from this list".
   * A non-empty roster is a claim about which fingers are down, and a claim can
   * be wrong or scoped in ways this file cannot verify; an empty one is not a
   * claim about any particular finger, it is the absence of all of them, and
   * there is no reading of it under which a thumb is still on FIRE. The rule
   * this whole section is built on is that the watchdog only ever acts on
   * something that cannot be false.
   * -------------------------------------------------------------------- */

  /** A primary touch/pen pointerdown: everything else of that kind is gone. */
  function dropStaleOnPrimary(exceptKey) {
    if (!WATCHDOG_ON) return;
    let hit = false;
    for (const key in pointers) {
      if (key === exceptKey) continue;
      if (key.charAt(0) !== 'p') continue;      // pointer-events records only
      if (forgetPointer(key)) hit = true;
    }
    if (hit) reconcile();
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
    /* A primary touch pointerdown is the platform telling us the screen was
     * empty a moment ago. Anything still on our books ended without an up. */
    if (e.isPrimary === true && pointerCount > 0 &&
        (e.pointerType === 'touch' || e.pointerType === 'pen')) {
      dropStaleOnPrimary(key);
    }
    if (beginPointer(key, e.pointerId, e.clientX, e.clientY)) {
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
      if (beginPointer(touchKey(t.identifier), t.identifier, t.clientX, t.clientY)) {
        took = true;
      }
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
   * THE MOUSE, THROUGH THE IDENTICAL PATH   (SPEC-TOUCHUI §2)
   *
   * A click is not a second implementation of anything: it converts the same
   * client coordinates through the same live canvas rect into the same padded
   * regions and hands the winner to the same T.Game.uiTap(). It costs one
   * listener, it makes the select screen click-to-choose on a desktop, and it
   * is what makes the whole feature testable without a touchscreen.
   *
   * It cannot go through the pointer path above, because that path only tracks
   * anything while the touch layer is SHOWING — on a desktop no pointer is
   * ever tracked, which is precisely the guarantee that keyboard play is
   * untouched. So the mouse gets its own door, and the two are kept from
   * firing twice for one gesture by the echo window below.
   * ---------------------------------------------------------------------- */

  function onClick(e) {
    if (!e) return;
    // Left button only. `button` is 0 for a synthetic click too.
    if (typeof e.button === 'number' && e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return;
    if (!isFinite(x) || !isFinite(y)) return;

    /* The synthetic click a touchscreen fires after a tap the pointer path has
     * already routed. preventDefault() on the pointerdown suppresses it on
     * every browser this game runs on, but "every browser" is not a guarantee
     * and a duplicate would apply a select-screen change twice. */
    if ((nowMs() - lastPointerTapMs) < CLICK_ECHO_MS) return;

    /* A click on one of our own buttons belongs to that button, not to the
     * picture behind it — the same precedence a finger gets, asked the same
     * way. Costs nothing on a desktop, where no control is active. */
    if (visible && hitTest(x, y)) return;

    routeCanvasTap(x, y);
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
    // The lift is a fraction of the viewport, and the room a column can spare
    // for it moves with the viewport too (SPEC-TOUCHUI §7).
    markLiftDirty();
    updateOrientation();
  }

  function onOrientation() {
    // Rotating with a thumb down is the classic way to strand a direction.
    releaseAll();
    markRectsDirty();
    markLiftDirty();
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

  /**
   * The touch roster, read on every touch event whichever path we are on.
   *
   * It does two jobs. It is still the "a real touch happened" sniff that turns
   * the layer on where `maxTouchPoints` lied (§2), and it is the second of the
   * two staleness proofs (§8.3): an empty `touches` list means the glass is
   * empty, so anything we still think is held ended without an up.
   *
   * Passive, allocation-free, and it cannot fire while anything at all is being
   * touched — a thumb parked on FIRE keeps `touches` non-empty for as long as
   * it is there.
   */
  function onTouchRoster(e) {
    noteTouchSource('touch');
    if (!WATCHDOG_ON) return;
    if (!e || !e.touches || pointerCount === 0) return;
    if (e.touches.length !== 0) return;
    if (forgetAllPointers()) reconcile();
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
    markLiftDirty();
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
      vclearSlot(1);
    }
    applyRootAttributes();
    markLiftDirty();
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
    markLiftDirty();
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
      // ...and nobody is down on a layer that is not on screen. This path does
      // not run applyControls(), so the DOWN plate is taken down here or it
      // would still be up under the next player who turns the controls on.
      refreshDown();
    }
    if (rootEl) rootEl.hidden = !visible;
    applyRootAttributes();
    if (visible) {
      markRectsDirty();
      markLiftDirty();
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
   * Which published UI region would a tap at these CLIENT coordinates hit?
   *
   * The same answer the real tap path computes, from the same live canvas rect
   * and the same padded, separated geometry — this IS that function, exported.
   * Pure: it reads, it never presses anything, it never calls game.js, and it
   * returns null rather than throwing when there is nothing there.
   *
   * It exists so the padding maths in §4 can be asserted from a harness (and
   * checked from a console) without synthesising a gesture: "is the third
   * variant thumbnail at least 56 px on this iPad, and does its centre still
   * belong to it" is a question about geometry, and this answers it directly.
   */
  function regionAt(clientX, clientY) {
    try {
      return regionAtClient(clientX, clientY);
    } catch (err) {
      return null;
    }
  }

  /**
   * What the cluster lift actually resolved to, in CSS px (SPEC-TOUCHUI §7).
   *
   *   lift / inset            what is published now, after the shrink pass
   *   requestedLift / Inset   what T.C asked for, before any measurement
   *   shrunk                  a measurement took something off the request
   *   measured                there were real rects to measure at all
   *
   * Reporting only — nothing in this file reads it back. It is here so the lift
   * can be asserted at each supported size rather than eyeballed, which is what
   * §7 asks for. Note the stylesheet still takes min() of `lift` and its own
   * live fit, so this is the CEILING on what is applied, not a promise about
   * the exact padding a column ends up with.
   */
  function liftMetrics() {
    return {
      lift: liftPx,
      inset: insetPx,
      requestedLift: reqLiftPx,
      requestedInset: reqInsetPx,
      shrunk: (liftPx < reqLiftPx - LIFT_EPS) || (insetPx < reqInsetPx - LIFT_EPS),
      measured: liftMeasured
    };
  }

  /**
   * One frame of the reconciliation watchdog (SPEC-TOUCHUI §8.3).
   *
   * The layer already pumps this itself from a rAF while anything is being
   * touched, so nothing is required of main.js — but a game loop that calls it
   * once per frame gets the check on exactly the frame boundary the input is
   * read on, which is the tightest this can be. Idle and free when no pointer
   * is tracked, and it never throws.
   */
  function tick() {
    if (!initialised) return;
    /* SPEC-COOP §5: a player who has just gone down should see their column
     * say so on the NEXT FRAME, not up to a quarter of a second later when the
     * 250ms watcher next runs. Edge-triggered and allocation-free, so a caller
     * that drives this from the game loop pays two reads per frame for it. */
    try {
      if (visible) refreshDown();
    } catch (err) {
      /* a column's paint must never take the frame down */
    }
    if (!WATCHDOG_ON) return;
    try {
      reconcile();
    } catch (err) {
      /* the watchdog exists to save the frame, never to take it down */
    }
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

    /* The capability sniff above can be wrong in both directions, so a real
     * touch always wins. These three are passive and cheap, they run on BOTH
     * paths, and past turning the layer on they are the roster proof the
     * watchdog leans on (§8.3). Registered after the handlers above on purpose:
     * in the Touch Events path onTouchEnd has already removed the ids that
     * genuinely ended by the time this reconciles what is left. */
    listen(window, 'touchstart', onTouchRoster, passive);
    listen(window, 'touchend', onTouchRoster, passive);
    listen(window, 'touchcancel', onTouchRoster, passive);

    /* The mouse door (SPEC-TOUCHUI §2). Bound to BOTH the canvas and the
     * layer, because which of the two a click lands on depends on whether the
     * layer is showing — and they are siblings, so a click can never reach
     * both and be routed twice. Passive: a click is over by the time we see
     * it, and there is nothing left to preventDefault. */
    listen(canvasEl, 'click', onClick, passive);
    listen(rootEl, 'click', onClick, passive);

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
    regionAt: regionAt,
    liftMetrics: liftMetrics,
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
    element: element,
    tick: tick
  };

})(window.T = window.T || {});
