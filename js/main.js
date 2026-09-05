/* ===========================================================================
 * TOASTER INVADERS — js/main.js
 *
 * ROLE: boot + the frame loop. Loads LAST and exports nothing; every other
 * module has already attached itself to window.T by the time this runs.
 *
 * Responsibilities (SPEC section 11, SPEC-TOUCH sections 2 and 5):
 *   - wait for the DOM, grab <canvas id="screen">, set up a crisp 2D context
 *   - boot in order: Sprites.build → Input.init → Audio.init → Game.init →
 *     Touch.init (the touch layer feeds T.Input, so Input must exist first, and
 *     its watcher reads T.Game.state, so Game must exist too)
 *   - if any of that throws, PAINT THE ERROR ON THE CANVAS and rethrow, because
 *     a silent black screen is the worst failure this game can have
 *   - run a fixed-timestep accumulator loop at T.C.FIXED_DT
 *   - letterbox the 960x720 backing store into the room that is LEFT once the
 *     touch control columns have reserved their edges — controls must never
 *     overlap the play field
 *   - re-letterbox on resize, orientationchange AND visualViewport resize/scroll
 *     (Safari's toolbar slides without firing window.resize)
 *   - keep the browser's own touch gestures (rubber-band scroll, double-tap
 *     zoom, pinch) off the game, without breaking the help strip's scrolling
 *   - hold the game paused while the portrait rotate prompt is up
 *   - unlock WebAudio on the first user gesture, touch included
 *   - auto-pause (and hush the march / UFO loops) when the tab is hidden, and
 *     drop every held on-screen button on hide / blur so nothing sticks
 *   - stop arrow keys and space from scrolling the page
 *
 * TOUCH IS ADDITIVE. Every touch-facing branch below is gated on T.Touch being
 * present AND reporting itself active, so a keyboard or gamepad session runs
 * exactly the code it ran before this file learned about thumbs.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  /* -------------------------------------------------------------------------
   * LOOP SAFETY LIMITS
   * These are not gameplay tunables (T.C owns those) — they are the guards
   * SPEC section 11 requires so a backgrounded tab cannot spiral the sim.
   * ---------------------------------------------------------------------- */
  const MAX_STEPS_PER_FRAME = 5;      // catch-up updates allowed in one frame
  const MAX_FRAME_DELTA = 0.25;       // seconds; anything longer is a tab switch

  /* -------------------------------------------------------------------------
   * LETTERBOX SIZING
   * The backing store is always T.C.W x T.C.H. Only the CSS box changes, so
   * every gameplay coordinate stays in logical pixels.
   * ---------------------------------------------------------------------- */
  // Snap up-scales to eighths: 960/720 divide evenly by 1/8 (120 x 90), so the
  // CSS box always lands on whole pixels while wasting under 6% of the window.
  const SCALE_STEP = 0.125;
  const MIN_SCALE = 0.1;              // never collapse the canvas to nothing

  let canvas = null;
  let ctx = null;
  let gameRoot = null;                // #cabinet: everything the game owns

  let running = false;
  let rafId = 0;
  let lastMs = 0;
  let hasLast = false;                // separate flag: a timestamp of 0 is legal
  let accumulator = 0;

  let layoutQueued = false;
  let audioUnlocked = false;

  // Last seen value of touchActive(). The reserved width changes the instant
  // the control layer appears, and that flip fires no DOM event — see frame().
  let touchWasActive = false;

  /* =========================================================================
   * FATAL ERROR SCREEN
   * Deliberately depends on nothing but a 2D context — T.UI, T.Sprites and the
   * palette may all be the thing that just failed.
   * ====================================================================== */

  /** Break `text` into lines that fit `maxWidth` at the context's current font. */
  function wrapLines(c, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (let i = 0; i < words.length; i++) {
      const candidate = line === '' ? words[i] : line + ' ' + words[i];
      if (line !== '' && c.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = words[i];
      } else {
        line = candidate;
      }
    }
    if (line !== '') lines.push(line);
    return lines;
  }

  /**
   * Paint a readable crash report over the whole canvas.
   * @param {string} title  short banner, e.g. 'BOOT FAILED'
   * @param {*} err         the thrown value
   */
  function drawFatalError(title, err) {
    if (!ctx) return;
    // T.C is normally guaranteed (util.js loads first) but this screen exists
    // for the case where something upstream broke, so assume nothing.
    const pal = (T.C && T.C.PAL) ? T.C.PAL : null;
    const colBg = pal ? pal.bg : '#0d0b10';
    const colBad = pal ? pal.danger : '#ff4d4d';
    const colTxt = pal ? pal.ui : '#f3dfa8';
    const colDim = pal ? pal.uiDim : '#7b6f55';
    const W = (T.C && T.C.W) || (canvas && canvas.width) || 960;
    const H = (T.C && T.C.H) || (canvas && canvas.height) || 720;
    const pad = 48;
    const message = (err && err.message) ? err.message : String(err);
    const stack = (err && typeof err.stack === 'string') ? err.stack : '';

    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colBg;
      ctx.fillRect(0, 0, W, H);

      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      ctx.fillStyle = colBad;
      ctx.font = 'bold 34px "Courier New", Courier, monospace';
      ctx.fillText('TOASTER INVADERS — ' + title, pad, pad);

      ctx.fillStyle = colTxt;
      ctx.font = '20px "Courier New", Courier, monospace';
      let y = pad + 62;
      const lines = wrapLines(ctx, message, W - pad * 2);
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], pad, y);
        y += 26;
      }

      if (stack) {
        ctx.fillStyle = colDim;
        ctx.font = '14px "Courier New", Courier, monospace';
        y += 16;
        const frames = stack.split('\n');
        for (let i = 0; i < frames.length && y < H - pad - 40; i++) {
          const raw = frames[i].trim();
          if (raw === '' || raw === message || raw.indexOf(message) === 0) continue;
          ctx.fillText(raw.length > 84 ? raw.slice(0, 84) + '…' : raw, pad, y);
          y += 18;
        }
      }

      ctx.fillStyle = colDim;
      ctx.font = '16px "Courier New", Courier, monospace';
      ctx.fillText('Full details are in the browser console (reload to retry).',
                   pad, H - pad - 20);
    } catch (drawErr) {
      /* If even this fails the console is the only channel left. */
      console.error('[Toaster Invaders] could not paint the error screen', drawErr);
    }
  }

  /* =========================================================================
   * LETTERBOXING
   * ====================================================================== */

  /**
   * True while the on-screen thumb controls are actually on the page.
   *
   * Guarded like every other call into T.Touch: this one is read from inside
   * the frame loop, where an exception would be caught as a fatal error and
   * would stop the game outright. A layer that cannot answer is treated as
   * absent, which is the non-touch code path.
   */
  function touchActive() {
    if (!T.Touch || typeof T.Touch.isVisible !== 'function') return false;
    try {
      return T.Touch.isVisible() === true;
    } catch (err) {
      return false;
    }
  }

  /**
   * CSS px reserved down EACH edge by the touch control columns (SPEC-TOUCH
   * section 2). The columns are an overlay pinned to the edges of the viewport,
   * so they do not shrink `#stage` in flow — the canvas is only kept off them
   * because layout() subtracts this twice. Zero on every non-touch machine,
   * which is what keeps desktop letterboxing byte-for-byte identical.
   */
  function reservedColumns() {
    if (!touchActive()) return 0;
    if (typeof T.Touch.columnWidth !== 'function') return 0;
    let w = 0;
    try {
      w = Number(T.Touch.columnWidth()) || 0;
    } catch (err) {
      return 0;
    }
    if (!(w > 0) || !isFinite(w)) return 0;
    // Round the reserve UP. The column is a fractional CSS width (15vw, plus a
    // safe-area inset), while layout() rounds the canvas box to a whole pixel —
    // so an exact reserve loses its fraction to that rounding and the picture
    // creeps a sub-pixel into the column. Ceiling it costs at most one pixel of
    // picture and keeps the "controls never touch the play field" invariant
    // exact instead of approximate.
    return Math.ceil(w);
  }

  /**
   * The room the canvas actually has, as a content box in CSS px.
   *
   * This is the canvas' PARENT, not the window: index.html nests the canvas in
   * `#stage`, a flex child that shares the page with the `#help` control panel,
   * so the window is always taller than the space the screen may occupy.
   * Measuring the window instead overflows `#stage` (which is `overflow:hidden`,
   * so the picture is silently cropped) and trips the stylesheet's
   * `max-width:100%`, which squashes the canvas off 4:3.
   *
   * Only ever called from layout(), which is coalesced to one call per animation
   * frame, so the layout read here is nowhere near a hot path.
   */
  function hostBox() {
    const vw = window.innerWidth || document.documentElement.clientWidth || T.C.W;
    const vh = window.innerHeight || document.documentElement.clientHeight || T.C.H;

    const host = canvas && canvas.parentElement;
    if (!host) return { w: vw, h: vh };

    let w = host.clientWidth;    // clientWidth/Height include the host's padding
    let h = host.clientHeight;
    if (typeof window.getComputedStyle === 'function') {
      const cs = window.getComputedStyle(host);
      w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      h -= (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    }

    // A host that is display:none, or not laid out yet, measures zero. Fall back
    // to the window rather than collapsing the screen to nothing.
    if (!(w > 0) || !(h > 0)) return { w: vw, h: vh };

    // iOS only: the layout viewport that `#stage` is sized against can be
    // taller and wider than what is actually on screen while the Safari toolbar
    // is out or the page is pinched, and a canvas fitted to the layout viewport
    // then runs off under the chrome. Clamp — never expand — to the visual
    // viewport. Gated on the touch layer being up so a desktop window (where
    // visualViewport also shrinks under browser zoom) keeps its old numbers.
    const vv = window.visualViewport;
    if (vv && touchActive()) {
      if (vv.width > 0 && vv.width < w) w = vv.width;
      if (vv.height > 0 && vv.height < h) h = vv.height;
    }

    return { w: w, h: h };
  }

  /**
   * Size the canvas' CSS box to the largest 4:3 rectangle that fits its host,
   * and centre it. The backing store is never touched here.
   */
  function layout() {
    layoutQueued = false;
    if (!canvas) return;

    const style = canvas.style;

    // Collapse the box BEFORE measuring. `#stage` is a flex item whose own size
    // depends on its content, so measuring while the canvas still carries the
    // previous size just reads our own last answer back and the fit never
    // settles. Both writes happen inside one frame, so nothing flickers.
    style.width = '0px';
    style.height = '0px';

    // At zero width/height whatever the canvas still occupies is exactly its own
    // border + padding — the chrome the CSS size has to leave room for.
    const chromeW = canvas.offsetWidth || 0;
    const chromeH = canvas.offsetHeight || 0;

    const box = hostBox();

    // SPEC-TOUCH section 2: the picture is scaled into the space that REMAINS
    // once both control columns have been reserved. The ship sits at y 636 of
    // 720, so a thumb pad drawn over the play field would cover exactly the
    // thing the player is aiming — reserving the room is the whole fix.
    const columns = reservedColumns();

    let availW = box.w - chromeW - columns * 2;
    const availH = box.h - chromeH;

    // A phone-narrow window could reserve more than it has. Give the picture
    // the room back rather than collapsing it to MIN_SCALE: overlapping
    // controls are bad, an invisible game is worse.
    if (!(availW > 0)) availW = box.w - chromeW;

    const fit = Math.min(availW / T.C.W, availH / T.C.H);
    let scale = (isFinite(fit) && fit > 0) ? fit : 1;

    // Above 1:1 snap down to a SCALE_STEP so the pixel grid stays even; below
    // 1:1 use every pixel available, since a shrunken canvas needs the room.
    if (scale >= 1) scale = Math.floor((scale + 1e-6) / SCALE_STEP) * SCALE_STEP;
    if (scale < MIN_SCALE) scale = MIN_SCALE;

    style.width = Math.round(T.C.W * scale) + 'px';
    style.height = Math.round(T.C.H * scale) + 'px';
    style.display = 'block';
    style.margin = 'auto';   // centres inside a flex or block page shell
  }

  /** Coalesce resize storms into one layout per animation frame. */
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    window.requestAnimationFrame(layout);
  }

  /* =========================================================================
   * TOUCH: BROWSER GESTURE GUARDS  (SPEC-TOUCH section 5)
   *
   * Safari treats the page like a document unless told otherwise: a thumb that
   * drags off a button rubber-bands the whole site, and a pinch zooms the play
   * field out from under both players. css/style.css sets `touch-action: none`
   * on the game root and the canvas — which is also what kills the double-tap
   * zoom, since that gesture belongs to the element under the finger — and
   * `overscroll-behavior: none` on body. These document-level handlers are the
   * belt to that CSS's braces: they catch the drags that begin on the game and
   * the pinches that Safari routes through its non-standard `gesture*` events,
   * which no CSS property covers.
   *
   * The one thing they must NOT do is glue the help strip shut. On touch that
   * strip collapses behind a `?` button, and when a player opens it, it is a
   * scrolling panel of real text — so anything inside `#help` keeps the
   * browser's own default behaviour.
   * ====================================================================== */

  const HELP_ID = 'help';
  const ANCESTOR_WALK_LIMIT = 128;   // paranoia against a cyclic parentNode

  /** Walk up from `node`, returning true if `test` matches any ancestor. */
  function hasAncestor(node, test) {
    let n = node;
    for (let i = 0; n && i < ANCESTOR_WALK_LIMIT; i++) {
      if (test(n) === true) return true;
      n = n.parentNode;
    }
    return false;
  }

  function isInGameRoot(node) {
    if (!gameRoot) return false;
    return hasAncestor(node, function (n) { return n === gameRoot; });
  }

  /** Inside the how-to-play strip, which is allowed to scroll when expanded. */
  function isInHelp(node) {
    return hasAncestor(node, function (n) { return n.id === HELP_ID; });
  }

  /**
   * Swallow drags that start on the game so the page cannot rubber-band.
   * Registered non-passive — a passive listener may not call preventDefault().
   */
  function onDocTouchMove(e) {
    if (!e || e.cancelable === false) return;
    const target = e.target;
    if (isInHelp(target)) return;        // let the expanded help strip scroll
    if (!isInGameRoot(target)) return;   // not ours: leave the page alone
    e.preventDefault();
  }

  /**
   * Safari-only pinch/rotate gestures. Not covered by touch-action.
   *
   * Scoped exactly like onDocTouchMove: macOS Safari fires these for a
   * trackpad pinch as well, so a guard that swallowed everything would take
   * page zoom away from a desktop player on anything the game does not own.
   */
  function onGesture(e) {
    if (!e || e.cancelable === false) return;
    const target = e.target;
    if (isInHelp(target)) return;
    if (!isInGameRoot(target)) return;   // not ours: leave the page alone
    e.preventDefault();
  }

  function installGestureGuards() {
    const active = { passive: false };
    document.addEventListener('touchmove', onDocTouchMove, active);
    document.addEventListener('gesturestart', onGesture, active);
    document.addEventListener('gesturechange', onGesture, active);
    document.addEventListener('gestureend', onGesture, active);
  }

  /* =========================================================================
   * TOUCH: RELEASE AND THE PORTRAIT HOLD
   * ====================================================================== */

  /**
   * Drop every held on-screen control. A direction left stuck sends the ship
   * into a wall forever, so this is called from every route out of the page —
   * a hidden tab, a lost focus — on top of touch.js's own pointercancel work.
   * Never throws: a stuck button must not be able to become a crash as well.
   */
  function releaseTouch() {
    if (!T.Touch || typeof T.Touch.releaseAll !== 'function') return;
    try {
      T.Touch.releaseAll();
    } catch (err) {
      console.warn('[Toaster Invaders] touch release failed', err);
    }
  }

  /** True while the portrait rotate prompt is covering the screen. */
  function inPortraitPrompt() {
    if (!T.Touch || typeof T.Touch.isPortrait !== 'function') return false;
    try {
      return T.Touch.isPortrait() === true;
    } catch (err) {
      return false;
    }
  }

  /* =========================================================================
   * PAGE-LEVEL KEY HANDLING
   * ====================================================================== */

  // Keys the browser would otherwise act on: arrows and space scroll the page,
  // '/' opens quick-find in Firefox, Backspace is a legacy "go back".
  const SWALLOWED_KEYS = {
    ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true,
    ' ': true, Spacebar: true, Space: true,
    '/': true, Backspace: true
  };

  /** Stop the page from scrolling / navigating on keys the game uses. */
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave shortcuts alone
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (SWALLOWED_KEYS[e.key] === true) e.preventDefault();
  }

  /* =========================================================================
   * AUDIO UNLOCK
   * Chrome will not start an AudioContext until the user has interacted, so
   * T.Input tells us about the first gesture (gamepad presses included) and we
   * also listen at the document level as a belt-and-braces fallback.
   * ====================================================================== */

  /**
   * The standard iOS workaround: play one frame of silence straight to the
   * destination inside the gesture that unlocked the context. Some iOS builds
   * leave a resumed context producing nothing until a buffer has actually been
   * started from a user gesture, and this is that buffer.
   *
   * The AudioContext is reached through the mix bus audio.js publishes rather
   * than a new export, so this stays inside the existing contract. Before the
   * first gesture builds the graph `masterGain` is null and this no-ops, which
   * is exactly right — there is nothing to prime yet.
   */
  function primeSilentBuffer() {
    const bus = T.Audio && T.Audio.masterGain;
    const ac = bus && bus.context;
    if (!ac || typeof ac.createBuffer !== 'function') return;
    try {
      const src = ac.createBufferSource();
      src.buffer = ac.createBuffer(1, 1, ac.sampleRate || 22050);
      src.connect(ac.destination);
      if (typeof src.start === 'function') src.start(0);
      else if (typeof src.noteOn === 'function') src.noteOn(0);   // ancient WebKit
    } catch (err) {
      /* Priming is an optimisation, never a requirement. Stay quiet. */
    }
  }

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      if (T.Audio && typeof T.Audio.unlock === 'function') T.Audio.unlock();
      // Same gesture, same synchronous turn — iOS will not accept it later.
      primeSilentBuffer();
    } catch (err) {
      console.warn('[Toaster Invaders] audio unlock failed', err);
    }
  }

  /*
   * IPAD SILENCE IS NOT A BUG IN THIS GAME.
   *
   * On iPhone and iPad the physical silent switch / Ring-Silent setting mutes
   * Web Audio for a normal web page, no matter how correctly the context was
   * unlocked. Everything below fires — the context resumes, the silent buffer
   * plays, `T.Audio.isReady()` reports true — and the device still makes no
   * sound. There is no API to detect it and no honest way to work around it;
   * flipping the switch off (or raising the volume in a Home Screen app) is the
   * fix. This is an iOS platform behaviour. The help text says so too, so a
   * player does not go hunting for a mute button that does not exist.
   */
  function installAudioUnlock() {
    if (T.Input && typeof T.Input.onFirstGesture === 'function') {
      T.Input.onFirstGesture(unlockAudio);
    }
    // Capture phase, so the unlock is reached even if something downstream
    // stops the event from bubbling; `once` still retires each listener after
    // the first gesture. All four are listed because no single one covers every
    // engine: iOS Safari fires touchstart AND pointerdown, and a machine with
    // neither still has a keyboard.
    const opts = { once: true, passive: true, capture: true };
    document.addEventListener('keydown', unlockAudio, opts);
    document.addEventListener('pointerdown', unlockAudio, opts);
    document.addEventListener('touchstart', unlockAudio, opts);
    document.addEventListener('touchend', unlockAudio, opts);
  }

  /* =========================================================================
   * VISIBILITY / AUTO-PAUSE
   * ====================================================================== */

  /**
   * Ask the game to enter its pause state. T.Game may expose pause() or
   * setState(); if it exposes neither we fall back to the documented
   * T.Game.state property.
   */
  function requestPause() {
    if (!T.Game) return;
    try {
      if (typeof T.Game.pause === 'function') { T.Game.pause(); return; }
      if (typeof T.Game.setState === 'function') { T.Game.setState('pause'); return; }
      T.Game.state = 'pause';
    } catch (err) {
      console.warn('[Toaster Invaders] could not auto-pause', err);
    }
  }

  /** Silence the two looping voices. Safe to call at any time. */
  function hushLoops() {
    if (!T.Audio) return;
    try {
      if (typeof T.Audio.stopMarch === 'function') T.Audio.stopMarch();
      if (typeof T.Audio.stopUfo === 'function') T.Audio.stopUfo();
    } catch (err) {
      console.warn('[Toaster Invaders] could not stop audio loops', err);
    }
  }

  /**
   * Tab hidden → hush the loops and pause an in-progress game. Coming back does
   * NOT auto-resume: the player presses Start when they are ready.
   */
  function onVisibilityChange() {
    // Unconditional, both directions: fingers that were down when the tab went
    // away never send an up event, and a tab coming back must not inherit them.
    releaseTouch();
    if (!document.hidden) return;
    hushLoops();
    if (T.Game && T.Game.state === 'play') requestPause();
    // A long hide would otherwise leave a huge delta waiting; drop it now and
    // treat the next frame as a fresh start rather than a 10-minute one.
    accumulator = 0;
    hasLast = false;
  }

  /** Focus lost — a press mid-gesture would otherwise stay held forever. */
  function onWindowBlur() {
    releaseTouch();
  }

  /* =========================================================================
   * THE LOOP
   * Fixed timestep: input once, up to MAX_STEPS_PER_FRAME updates of exactly
   * T.C.FIXED_DT, then one render.
   * ====================================================================== */

  function frame(nowMs) {
    if (!running) return;
    rafId = window.requestAnimationFrame(frame);

    let dt = hasLast ? (nowMs - lastMs) / 1000 : 0;
    lastMs = nowMs;
    hasLast = true;
    if (!(dt > 0)) dt = 0;                            // first frame / clock skew
    if (dt > MAX_FRAME_DELTA) dt = MAX_FRAME_DELTA;   // no spiral after a hide

    accumulator += dt;

    try {
      T.Input.poll();

      // SPEC-TOUCH section 2: the reserved width changes the moment the control
      // layer appears, and NOTHING reports that. touch.js turns the columns on
      // from the first real touch wherever navigator.maxTouchPoints lied (an
      // older Safari, a touch monitor, a hybrid laptop) — no resize, no
      // orientationchange, and the CSS `:has()` rules that collapse the help
      // strip re-flow #stage at the same moment. Without this the canvas keeps
      // the full-width box it was given at boot and the columns land ON the
      // play field, over the ship, until something else happens to resize the
      // window. The reverse matters too: a layer that hides again leaves the
      // picture needlessly small. One cached boolean read per frame, and on a
      // build with no touch.js it short-circuits on T.Touch.
      const touchNow = touchActive();
      if (touchNow !== touchWasActive) {
        touchWasActive = touchNow;
        queueLayout();
      }

      // SPEC-TOUCH section 5: hold the game paused while the rotate prompt is
      // up. Checked every frame rather than only on the orientation event, so a
      // stray Start press behind the prompt cannot resume a board the player
      // cannot see. Coming back to landscape does NOT auto-resume — leaving
      // pause is the player's choice, made with Start. One boolean read on a
      // touch device, and on anything else it short-circuits on T.Touch.
      if (T.Game.state === 'play' && inPortraitPrompt()) requestPause();

      let steps = 0;
      while (accumulator >= T.C.FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        T.Game.update(T.C.FIXED_DT);
        accumulator -= T.C.FIXED_DT;
        steps++;
      }
      // Hit the catch-up ceiling: shed the backlog rather than owe it forever.
      if (steps === MAX_STEPS_PER_FRAME && accumulator >= T.C.FIXED_DT) accumulator = 0;

      T.Game.render(ctx);
    } catch (err) {
      stop();
      drawFatalError('CRASHED', err);
      console.error('[Toaster Invaders] fatal error in the frame loop', err);
    }
  }

  function start() {
    if (running) return;
    running = true;
    hasLast = false;
    accumulator = 0;
    rafId = window.requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    hushLoops();
    releaseTouch();   // nothing will poll the virtual pad again; let go of it
  }

  /* =========================================================================
   * BOOT
   * ====================================================================== */

  /** Fetch the canvas and a pixel-crisp 2D context, throwing clearly on failure. */
  function acquireCanvas() {
    const el = document.getElementById('screen');
    if (!el) throw new Error('No <canvas id="screen"> in the document.');
    if (typeof el.getContext !== 'function') {
      throw new Error('Element #screen is not a <canvas>.');
    }

    // Setting width/height resets the context, so sync the backing store first.
    if (el.width !== T.C.W) el.width = T.C.W;
    if (el.height !== T.C.H) el.height = T.C.H;

    const c = el.getContext('2d');
    if (!c) throw new Error('Could not get a 2D context — is canvas disabled?');

    c.imageSmoothingEnabled = false;
    c.webkitImageSmoothingEnabled = false;
    c.mozImageSmoothingEnabled = false;
    c.msImageSmoothingEnabled = false;

    canvas = el;
    ctx = c;

    // The cabinet is both the touch layer's host and the boundary the gesture
    // guards test against. `#stage` (the canvas' own parent) is too small — the
    // control columns sit outside it — and the body is too big, since it also
    // holds anything a browser extension injects.
    gameRoot = document.getElementById('cabinet') ||
               (el.parentElement && el.parentElement.parentElement) ||
               el.parentElement || document.body;
  }

  /**
   * Build the on-screen thumb controls. Must run AFTER T.Input.init() (the
   * layer drives T.Input.setVirtual) and after T.Game.init() (its watcher reads
   * T.Game.state to decide solo/duo and which buttons are live), and BEFORE the
   * loop starts so the first frame is already letterboxed around the columns.
   *
   * A missing T.Touch is not an error and is deliberately SILENT: the layer is
   * additive, every caller here is guarded, and SPEC section 12 asks for a
   * clean console on load. A keyboard-only build that simply omits the file
   * plays exactly as it always did.
   */
  function initTouch() {
    if (!T.Touch || typeof T.Touch.init !== 'function') return;
    try {
      T.Touch.init(canvas, gameRoot);
    } catch (err) {
      // Whatever went wrong in the overlay, the game itself is fine.
      console.warn('[Toaster Invaders] touch controls failed to initialise', err);
    }
  }

  function boot() {
    try {
      acquireCanvas();
    } catch (err) {
      // Nothing to paint on. Console + rethrow is all that is left.
      console.error('[Toaster Invaders] boot failed before the canvas existed', err);
      throw err;
    }

    try {
      // Size the CSS box FIRST. Everything below can throw, and the crash screen
      // is only readable if the canvas has already been letterboxed — an
      // unsized canvas falls back to its 960x720 intrinsic size and gets cropped
      // by `#stage`, hiding the very message it exists to show.
      layout();

      if (!T.Sprites || typeof T.Sprites.build !== 'function') {
        throw new Error('T.Sprites is missing — check the <script> order in index.html.');
      }
      if (!T.Input || typeof T.Input.init !== 'function') {
        throw new Error('T.Input is missing — check the <script> order in index.html.');
      }
      if (!T.Audio || typeof T.Audio.init !== 'function') {
        throw new Error('T.Audio is missing — check the <script> order in index.html.');
      }
      if (!T.Game || typeof T.Game.init !== 'function') {
        throw new Error('T.Game is missing — check the <script> order in index.html.');
      }

      T.Sprites.build();
      T.Input.init();
      T.Audio.init();
      T.Game.init(canvas);

      initTouch();
      // The columns now exist and reserve their edges, so the fit computed
      // before they were built is stale. Re-measure before the first frame,
      // then once more on the next one: env(safe-area-inset-*) is part of the
      // column's width and iOS can settle those a frame late, which would
      // otherwise leave the picture lapping over a control until the first
      // resize event turned up.
      layout();
      queueLayout();
      // Seed the watcher in frame() so the first frame is not a false edge.
      touchWasActive = touchActive();

      installAudioUnlock();
      installGestureGuards();

      window.addEventListener('resize', queueLayout);
      window.addEventListener('orientationchange', onOrientationChange);
      if (window.screen && window.screen.orientation &&
          typeof window.screen.orientation.addEventListener === 'function') {
        window.screen.orientation.addEventListener('change', onOrientationChange);
      }

      // Safari's toolbar slides in and out, and the on-screen keyboard opens and
      // closes, WITHOUT firing window.resize — visualViewport is the only event
      // that reports either. Without these the canvas keeps the size it had
      // before the toolbar appeared and the bottom of the play field is hidden
      // behind it, which on this game means the ship.
      if (window.visualViewport &&
          typeof window.visualViewport.addEventListener === 'function') {
        window.visualViewport.addEventListener('resize', queueLayout);
        window.visualViewport.addEventListener('scroll', queueLayout);
      }

      document.addEventListener('keydown', onKeyDown, false);
      document.addEventListener('visibilitychange', onVisibilityChange, false);
      window.addEventListener('blur', onWindowBlur, false);

      start();
    } catch (err) {
      drawFatalError('BOOT FAILED', err);
      console.error('[Toaster Invaders] boot failed', err);
      throw err;
    }
  }

  /**
   * Mobile browsers often report the OLD viewport size during the orientation
   * event itself, so re-measure a couple of times as the rotation settles.
   */
  function onOrientationChange() {
    // A rotation happens with thumbs still on the glass and the controls move
    // out from under them mid-press, so let go of everything first.
    releaseTouch();
    queueLayout();
    window.setTimeout(layout, 120);
    window.setTimeout(layout, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})(window.T = window.T || {});
