/* ===========================================================================
 * TOASTER INVADERS — js/game.js
 *
 * ROLE: the rulebook. Owns the state machine (title / select / wave / play /
 * pause / over), session + board construction, the formation march, enemy fire,
 * every collision, scoring, wave progression, and the After Dark background
 * that sits behind EVERY screen.
 *
 *   T.Game.init(canvas)
 *   T.Game.update(dt)      // dt is always T.C.FIXED_DT
 *   T.Game.render(ctx)
 *   T.Game.state           // 'title'|'select'|'play'|'pause'|'wave'|'over'
 *   T.Game.session         // current Session or null
 *   T.Game.uiTap(region)   // act on a tapped/clicked T.UI hit region
 *   T.Game.isPlayerDown(n) // co-op: is player n sitting out this wave?
 *
 * This file NEVER draws text — all screen furniture goes through T.UI, which
 * loads after this file (that is fine: every reference is inside a function and
 * resolves at call time). All sprites come from T.Sprites, all sound from
 * T.Audio, all entity structs + pixel-accurate bunker work from T.Entities.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const C = T.C;
  const U = T.Util;
  const PAL = C.PAL;

  /* -------------------------------------------------------------------------
   * LOCAL CONSTANTS
   * Only numbers the SPEC states inline and that T.C has no slot for live here.
   * Anything that tunes core feel is read from T.C, never redeclared.
   * ---------------------------------------------------------------------- */
  const HI_KEY = 'toasterInvaders.hi';

  const WAVE_BANNER_TIME   = 2.0;   // §9: "WAVE n" banner duration
  const PLAYER_BANNER_TIME = 1.5;   // §9: classic-mode turn-swap banner
  const WAVE_Y_STEP        = 18;    // §3: each wave starts this much lower
  const WAVE_Y_CAP         = C.BUNKER_Y - 200;   // §3: never start below this
  const INVASION_Y         = C.BUNKER_Y + 40;    // §3: toasters here = board over

  /* --- the secret tenth character  (SPEC-BURRITO.md §2) -------------------
   * The wave that reveals BURRITO, how long his reveal banner hangs about, and
   * the two lines it says. The numbers are read from T.C when it carries them,
   * so a harness sweeping the unlock never has to patch this file; the
   * fallbacks are the two the spec states inline, and they sit here beside the
   * other banner durations for the same reason those do — they tune
   * presentation, and T.C has no slot for presentation timing. */
  const SECRET_ID          = 'burrito';
  const SECRET_WAVE        = C.BURRITO_UNLOCK_WAVE || 5;
  const REVEAL_BANNER_TIME = C.BURRITO_REVEAL_TIME || 2.5;
  const REVEAL_TITLE       = 'SECRET UNLOCKED';
  const REVEAL_SUB_TAIL    = ' IS NOW ON THE SELECT SCREEN';

  const BUNKER_COUNT = 4;           // classic four shields
  const BUNKER_W     = 96;          // 'bunker' sprite size (§7)
  const BUNKER_H     = 64;

  const DMG_R_BUTTER = 9;           // §4: greasy melt
  const DMG_R_JAM    = 5;           // §4: neat puncture
  const DMG_R_BOMB   = 7;
  const DMG_R_ENEMY  = 13;          // toasters chew shields from below
  const JAM_WIN_ODDS = 0.75;        // §4: jam beats a bomb 75% of the time

  /* How long a FIRE press is remembered when the weapon could not answer it.
   *
   * SPEC-CHARACTERS §2's `refire` is a real lockout: for a fraction of a second
   * after your shot dies, the trigger is closed. Base weapons answer the RISING
   * EDGE only (that is the classic one-tap-one-shot feel, and it is what stops
   * a held button becoming auto-fire), so a tap that lands inside that window
   * had nothing to fire and no second edge would ever arrive — the input was
   * silently eaten and the player had to let go and press again. Remembering
   * the edge for a moment fixes that without touching the feel: a HELD trigger
   * still produces exactly one edge and therefore exactly one shot.
   *
   * This is the SLACK on top of the weapon's own `refire`: a press is held for
   * refire + FIRE_BUFFER seconds, which is long enough to survive a lockout it
   * arrived at the very start of, and short enough that a tap made while your
   * shot is still in flight is forgotten rather than queued. */
  const FIRE_BUFFER     = 0.10;

  const SPAWN_INVULN    = 1.4;      // seconds of blink-invulnerability on respawn
  const WAVE_CLEAR_WAIT = 0.9;      // beat between last kill and the wave banner
  const BOARD_END_WAIT  = 1.3;      // beat between the final loss and 'over'
  const BOOM_TIME       = 0.28;     // enemy explosion sprite lifetime
  const BOOM_SLOTS      = 16;
  const POPUP_TIME      = 0.9;      // floating score popup lifetime
  const POPUP_SLOTS     = 8;
  const UFO_MIN_ALIVE   = 8;        // arcade rule: no bonus pass on a thin field
  const BOMB_ANIM       = 0.11;     // bomb tumble frame time
  const UFO_ANIM_HZ     = 8;        // §7: ufo wings alternate at 8Hz

  const STAR_COUNT = 70;            // §2: ~70 wrapping stars over 3 layers
  const FLY_COUNT  = 5;             // ambient winged toast drifters

  /* --- weapon upgrade system (SPEC-WEAPONS §5) --------------------------
   * Every tunable the weapon loop actually needs lives in T.C; what is left
   * here is presentation — how long the pickup banner hangs about and where
   * the HUD's weapon chips are anchored. T.UI owns their internal layout, this
   * file only says which corner each one belongs to.
   */
  const PICKUP_BANNER_TIME = 1.4;   // §8: pickup banner duration
  const CHIP_EDGE  = 22;            // matches the HUD's own side margin
  const CHIP_Y     = C.PLAY_TOP + 4;   // just under the HUD strip
  const SYRUP_TINT = 0.45;          // how hard a syruped toaster is washed

  /* --- co-op shared hearts (SPEC-COOP §5) --------------------------------
   * The COPY the down/revive feedback is written in. Every duration behind it
   * is a T.C constant (COOP_DOWN_BANNER_TIME, COOP_REVIVE_TIME,
   * COOP_HEART_FLASH_TIME); these are the words, which T.C has no slot for and
   * which live beside the other banner strings for the same reason those do.
   *
   * §5 is not decoration: the failure mode of this whole feature is a player
   * who died, sees nothing happening, and concludes the game has hung or their
   * pad has dropped. So every one of these says WHO, and WHAT THEY ARE WAITING
   * FOR, in words rather than by implication. */
  const DOWN_WAIT       = 'NEXT WAVE';              // the HUD side's "waiting for"
  const DOWN_TITLE_TAIL = ' IS DOWN';
  const DOWN_SAVE_TAIL  = ' CAN STILL SAVE THEM';
  const DOWN_SUB        = 'CLEAR THE WAVE TO REVIVE THEM';
  const HEART_TITLE     = 'HEART LOST';
  const HEART_SUB       = 'BOTH PLAYERS BACK IN';

  /* Star layer tuning: [drift px/s, size, base alpha]. Layer 0 is deepest. */
  const STAR_LAYERS = [
    { speed: 5,  size: 1, alpha: 0.30 },
    { speed: 11, size: 1, alpha: 0.55 },
    { speed: 20, size: 2, alpha: 0.85 }
  ];

  /* =========================================================================
   * AFTER DARK BACKGROUND
   * A night-sky gradient, a three-layer parallax starfield drifting slowly
   * down-and-left, and winged toast slices gliding right-to-left at low alpha.
   * Updated on every state so title and select feel like the screensaver too.
   * ====================================================================== */
  const stars = [];
  const flies = [];
  let skyGradient = null;
  let skyGradientCtx = null;

  function initBackground() {
    stars.length = 0;
    for (let i = 0; i < STAR_COUNT; i++) {
      const layer = i % STAR_LAYERS.length;
      stars.push({
        x: U.randRange(0, C.W),
        y: U.randRange(0, C.H),
        layer: layer,
        phase: U.randRange(0, Math.PI * 2),
        rate: U.randRange(0.6, 2.2)
      });
    }

    flies.length = 0;
    for (let i = 0; i < FLY_COUNT; i++) flies.push(makeFly(U.randRange(0, C.W)));
  }

  /** One ambient background toast slice, spawned at x. */
  function makeFly(x) {
    return {
      x: x,
      y: U.randRange(C.PLAY_TOP - 40, C.PLAY_BOTTOM - 40),
      vx: -U.randRange(16, 38),
      vy: U.randRange(-4, 6),
      alpha: U.randRange(0.08, 0.17),
      animT: U.randRange(0, 0.3),
      frame: 0
    };
  }

  /** Recycle a drifter that has left the left edge back onto the right edge. */
  function resetFly(f) {
    f.x = C.W + U.randRange(10, 160);
    f.y = U.randRange(C.PLAY_TOP - 40, C.PLAY_BOTTOM - 40);
    f.vx = -U.randRange(16, 38);
    f.vy = U.randRange(-4, 6);
    f.alpha = U.randRange(0.08, 0.17);
  }

  function updateBackground(dt) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const L = STAR_LAYERS[s.layer];
      // Drift downward and slightly left, then wrap on both axes.
      s.x -= L.speed * 0.45 * dt;
      s.y += L.speed * dt;
      if (s.x < -2) s.x += C.W + 4;
      if (s.y > C.H + 2) s.y -= C.H + 4;
    }

    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.animT += dt;
      if (f.animT >= 0.22) { f.animT = 0; f.frame = f.frame ? 0 : 1; }
      if (f.y < C.PLAY_TOP - 60 || f.y > C.PLAY_BOTTOM - 20) f.vy = -f.vy;
      if (f.x < -40) resetFly(f);
    }
  }

  function drawBackground(ctx) {
    // Vertical night-sky gradient, built once per context.
    if (!skyGradient || skyGradientCtx !== ctx) {
      skyGradient = ctx.createLinearGradient(0, 0, 0, C.H);
      skyGradient.addColorStop(0, PAL.sky);
      skyGradient.addColorStop(1, PAL.skyDeep);
      skyGradientCtx = ctx;
    }
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, C.W, C.H);

    // Parallax starfield.
    ctx.fillStyle = PAL.star;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const L = STAR_LAYERS[s.layer];
      const twinkle = 0.75 + 0.25 * Math.sin(Game.time * s.rate + s.phase);
      ctx.globalAlpha = L.alpha * twinkle;
      ctx.fillRect(s.x | 0, s.y | 0, L.size, L.size);
    }
    ctx.globalAlpha = 1;

    // Ambient winged toast, well behind the play field.
    const S = T.Sprites;
    if (S && typeof S.draw === 'function') {
      for (let i = 0; i < flies.length; i++) {
        const f = flies[i];
        ctx.globalAlpha = f.alpha;
        S.draw(ctx, f.frame ? 'toastFly1' : 'toastFly0', Math.round(f.x), Math.round(f.y));
      }
      ctx.globalAlpha = 1;
    }
  }

  /* =========================================================================
   * THIN WRAPPERS
   * Audio / input / sprites are written by other agents; these guards keep a
   * missing or half-loaded sibling from taking the whole game down.
   * ====================================================================== */
  function sfx(name, opts) {
    const A = T.Audio;
    if (A && typeof A.play === 'function') A.play(name, opts);
  }

  function marchStart() {
    const A = T.Audio;
    if (A && typeof A.startMarch === 'function') A.startMarch();
  }

  function marchStop() {
    const A = T.Audio;
    if (A && typeof A.stopMarch === 'function') A.stopMarch();
  }

  function marchTempo(seconds) {
    const A = T.Audio;
    if (A && typeof A.setMarchTempo === 'function') A.setMarchTempo(seconds);
  }

  function sirenStart() {
    const A = T.Audio;
    if (A && typeof A.startUfo === 'function') A.startUfo();
  }

  function sirenStop() {
    const A = T.Audio;
    if (A && typeof A.stopUfo === 'function') A.stopUfo();
  }

  function rumble(slot, ms, strong, weak) {
    const I = T.Input;
    if (I && typeof I.rumble === 'function') I.rumble(slot, ms, strong, weak);
  }

  function pad(slot) {
    const I = T.Input;
    return (I && typeof I.get === 'function') ? I.get(slot) : null;
  }

  function anyPressed(name) {
    const I = T.Input;
    return !!(I && typeof I.anyPressed === 'function' && I.anyPressed(name));
  }

  /** Clear an input edge on BOTH pads so a state change can't re-trigger it. */
  function consumeAll(name) {
    const I = T.Input;
    if (!I || typeof I.consume !== 'function') return;
    I.consume(0, name);
    I.consume(1, name);
  }

  function blit(ctx, name, x, y) {
    const S = T.Sprites;
    if (S && typeof S.draw === 'function') S.draw(ctx, name, Math.round(x), Math.round(y));
  }

  /**
   * Blit a sprite through T.Sprites.tint's cached recolour, falling back to the
   * plain sprite when the colour wash is unavailable. Used for syruped toasters.
   */
  function blitTinted(ctx, name, x, y, color) {
    const S = T.Sprites;
    if (S && typeof S.tint === 'function' && typeof S.has === 'function' && S.has(name)) {
      const t = S.tint(name, color, SYRUP_TINT);
      if (t && t.canvas) {
        ctx.drawImage(t.canvas, Math.round(x), Math.round(y));
        return;
      }
    }
    blit(ctx, name, x, y);
  }

  /* The syrup trap's own colour, read once from the roster so the tint on a
   * syruped toaster can never drift away from the token that caused it. */
  let syrupTint = null;

  function syrupColor() {
    if (syrupTint) return syrupTint;
    const W = T.Weapons;
    if (W && typeof W.byId === 'function') {
      try {
        syrupTint = W.byId('syrup').color;
        return syrupTint;
      } catch (err) {
        /* roster not loaded — fall through to a palette colour */
      }
    }
    return PAL.crust;
  }

  /**
   * Call a T.UI entry point if ui.js has loaded and defines it. Fixed arity
   * (rather than .apply(arguments)) keeps the render path allocation-free;
   * five slots covers the widest signature, drawText(ctx, str, x, y, opts).
   */
  function uiCall(name, a, b, c, d, e) {
    const ui = T.UI;
    if (ui && typeof ui[name] === 'function') ui[name](a, b, c, d, e);
  }

  /**
   * Put a ship back on the FIRST weapon of its rotating gun (SPEC-BURRITO §1).
   *
   * Only BURRITO has one, and weapons.js is the only file that knows where the
   * position is kept — this file just says WHEN it starts over: a fresh ship at
   * the start of a game, and a ship that has just died. Guarded like every
   * other sibling call, because a weapons.js without the cycle is a game with
   * nine characters, not a broken one.
   */
  function cycleReset(ship) {
    const W = T.Weapons;
    if (W && typeof W.cycleReset === 'function') W.cycleReset(ship);
  }

  /* =========================================================================
   * THE CHARACTER ROSTER  (SPEC-CHARACTERS.md §2 and §6)
   *
   * `ship.kind` is now one of NINE character ids, not the old 'bread' / 'jam'
   * pair, so nothing in this file may branch on a kind any more. Every
   * per-character fact — ship sprites, life icon, base weapon, muzzle sound,
   * bunker carve radius, the select-screen copy — is a column of the
   * T.C.BASE_WEAPONS table, and everything below only ever LOOKS IT UP. A
   * tenth character is then a row in util.js and nothing here at all.
   * ====================================================================== */
  const ROSTER = C.BASE_WEAPONS || {};
  const ROSTER_ORDER = (C.CHARACTER_ORDER && C.CHARACTER_ORDER.length)
    ? C.CHARACTER_ORDER
    : Object.keys(ROSTER);

  /* The carousel opens on the two neutral baselines: they are what P1 and P2
   * start on, and what an unknown kind from an older save or a harness gets. */
  const KIND_DEFAULT = ROSTER_ORDER[0] || 'bread';
  const KIND_P2      = ROSTER_ORDER[1] || KIND_DEFAULT;

  /* Charred toast is charred toast: no character in the roster overrides the
   * death animation, but a row MAY carry its own `death` pair and this is the
   * one place that would have to know about it. */
  const DEATH_SPRITES = ['boomPlayer0', 'boomPlayer1'];

  /* The same rows, indexed by WEAPON id: a ship knows its character, but a
   * shot only knows what fired it, and the collision passes hold shots. */
  const ROSTER_BY_WID = Object.create(null);
  (function indexRosterByWid() {
    for (let i = 0; i < ROSTER_ORDER.length; i++) {
      const row = ROSTER[ROSTER_ORDER[i]];
      if (row && row.wid) ROSTER_BY_WID[row.wid] = row;
    }
  })();

  /* Roster membership as a NULL-PROTOTYPE set, and the only thing anything
   * below is allowed to ask "is this a character?" with.
   *
   * T.C.BASE_WEAPONS is a plain object literal, so `ROSTER['toString']` and
   * `ROSTER['constructor']` are both truthy — they come off Object.prototype.
   * That matters because a kind is no longer only ever produced by the
   * carousel: loadPick() reads one back out of localStorage, which is a string
   * this file did not write and cannot vouch for. Without this set a saved
   * pick of "toString" walks straight through every roster guard and puts the
   * player on a character that does not exist — no ship art, no variants, and
   * silently the default weapon. input.js guards its own string-keyed tables
   * exactly this way and for exactly this reason. */
  const IS_KIND = Object.create(null);
  (function indexRosterKinds() {
    const own = Object.prototype.hasOwnProperty;
    for (const key in ROSTER) {
      if (own.call(ROSTER, key) && ROSTER[key]) IS_KIND[key] = true;
    }
  })();

  /** True only for a string that names a real row of the roster. */
  function isKind(kind) {
    return typeof kind === 'string' && IS_KIND[kind] === true;
  }

  /** The roster row for a kind, falling back to the default character's. */
  function charRow(kind) {
    return (isKind(kind) ? ROSTER[kind] : null) || ROSTER[KIND_DEFAULT] || null;
  }

  /** A kind guaranteed to name a roster row. */
  function normalizeKind(kind) {
    return isKind(kind) ? kind : KIND_DEFAULT;
  }

  /* -------------------------------------------------------------------------
   * SECRET CHARACTERS  (SPEC-BURRITO.md §2)
   *
   * BURRITO is a perfectly ordinary roster row in T.C.BASE_WEAPONS and the
   * tenth id in T.C.CHARACTER_ORDER — being a secret is a question of what
   * this screen OFFERS, not of the data having a hole in it. Until wave 5
   * unlocks him he is ABSENT, not greyed out: he is not in the carousel, the
   * carousel cannot browse onto him, and he is not counted in the "n OF n"
   * the select screen prints. A player who has never reached wave 5 has no way
   * to learn from the game that a tenth character exists.
   *
   * `visibleOrder` is that roster — the SAME array object for the life of the
   * page, rebuilt in place — so ui.js may hold on to it, read it every frame
   * and never allocate. It is rebuilt when the unlock state can have changed:
   * at boot, on the way to the title, on the way into the select screen, and
   * on the frame a secret actually unlocks.
   *
   * Only SELECTION is gated. Nothing in here can hide a character from a ship
   * that is already flying: normalizeKind() still answers for every roster row
   * (a burrito unlocked mid-session and taken into a game stays a burrito if
   * storage refuses to persist him), and no rule, sprite, weapon or collision
   * below asks whether a kind is secret.
   * ---------------------------------------------------------------------- */

  /* id -> the wave that reveals it. A map rather than a boolean because
   * T.Util's storage is an ARRAY of unlocked ids for exactly the same reason:
   * a second secret should be a row here and nothing else.
   *
   * WHICH IDS ARE SECRET comes from T.C.SECRET_CHARACTERS, the same list
   * ui.js hides from the select screen. Two files each holding their own
   * literal is how a second secret ends up hidden by one of them and unlocked
   * by neither: this file decides WHEN a secret is earned, ui.js decides how
   * it is kept back, and they have to be talking about the same ids. The
   * fallback is the one id the spec names, for a build loaded without a T.C
   * that carries the list. A secret that wants a different wave from
   * SECRET_WAVE gets its own line under the loop. */
  const SECRET_IDS = (Array.isArray(C.SECRET_CHARACTERS) && C.SECRET_CHARACTERS.length)
    ? C.SECRET_CHARACTERS : [SECRET_ID];
  const SECRET_WAVE_BY_KIND = Object.create(null);
  for (let i = 0; i < SECRET_IDS.length; i++) {
    const sid = SECRET_IDS[i];
    if (typeof sid === 'string' && sid !== '') SECRET_WAVE_BY_KIND[sid] = SECRET_WAVE;
  }

  /** Is this character one the game keeps back until it is earned? */
  function isSecretKind(kind) {
    return typeof kind === 'string' && SECRET_WAVE_BY_KIND[kind] !== undefined;
  }

  /** Has this secret been earned — in this session or a previous one? */
  function secretUnlocked(id) {
    return !!(U.isUnlocked && U.isUnlocked(id));
  }

  /** True while this character must not appear anywhere a player can look. */
  function isHiddenKind(kind) {
    return isSecretKind(kind) && !secretUnlocked(kind);
  }

  /** True for a character this player is allowed to be pointed at. */
  function isPickable(kind) {
    return isKind(kind) && !isHiddenKind(kind);
  }

  /* The roster as the player is allowed to see it. Rebuilt IN PLACE. */
  const visibleOrder = [];

  function refreshVisibleOrder() {
    visibleOrder.length = 0;
    for (let i = 0; i < ROSTER_ORDER.length; i++) {
      const kind = ROSTER_ORDER[i];
      if (isHiddenKind(kind)) continue;
      visibleOrder.push(kind);
    }
    // A carousel of nothing is not a screen anyone can leave: if every row of
    // the table were somehow secret, the default character is still offered.
    if (visibleOrder.length === 0) visibleOrder.push(KIND_DEFAULT);
    return visibleOrder;
  }

  refreshVisibleOrder();

  /** A kind guaranteed to name a character the player may currently choose. */
  function normalizeVisibleKind(kind) {
    const k = normalizeKind(kind);
    return isHiddenKind(k) ? KIND_DEFAULT : k;
  }

  /** Carousel position of a kind, in the order the player can SEE. */
  function charIndex(kind) {
    const i = visibleOrder.indexOf(kind);
    return i < 0 ? 0 : i;
  }

  /**
   * The kind `steps` places along the carousel, wrapping both ways.
   *
   * It walks the VISIBLE order, which is what makes a locked secret
   * unreachable rather than merely unlabelled: browsing left off `bread` lands
   * on `milk` while burrito is locked, and on `burrito` once he is not.
   */
  function cycleKind(kind, steps) {
    const n = visibleOrder.length;
    if (n === 0) return kind;
    return visibleOrder[((charIndex(kind) + steps) % n + n) % n];
  }

  /* =========================================================================
   * COSMETIC VARIANTS  (SPEC-VARIANTS.md §1)
   *
   * Every character has three variants, for 27 playable versions. A variant is
   * carried as an INDEX on the ship — `ship.variant`, 0..2 — riding beside
   * `ship.kind` from the select screen through board creation, death, respawn,
   * wave change and weapon pickup, and it survives all of them because it is
   * stamped on the ship once and nothing ever takes it off.
   *
   * A VARIANT CHANGES IDENTITY, NEVER NUMBERS. Nothing below returns anything
   * but a sprite name or an id: no speed, no hitbox, no refire, no carve
   * radius. That is what lets all 27 versions inherit the +/-20% balance band
   * the nine characters were measured into over 720 seeded runs, instead of
   * turning that guarantee into a 27-way problem — and it is asserted, not
   * assumed: scratchpad/game-variants.js drives all three variants of each
   * character down identical seeded boards with identical input and requires
   * the ship, its projectiles and the formation to match frame for frame.
   *
   * The index is CLAMPED into range exactly the way weapons.js clamps it, so a
   * ship can never be wearing one variant's body and firing another's shot.
   * ====================================================================== */

  /** This character's variant rows, or null if its roster row carries none. */
  function variantList(kind) {
    const row = charRow(kind);
    const list = row && row.variants;
    return (list && list.length > 0) ? list : null;
  }

  /** How many variants a character has (1 for a row with no variant data). */
  function variantCount(kind) {
    const list = variantList(kind);
    return list ? list.length : 1;
  }

  /**
   * A variant index guaranteed to name one of this character's variants.
   * Clamped rather than wrapped, and deliberately identical to weapons.js's
   * own clamp: a ship built by a harness (or restored from an older save)
   * carries no variant at all and is variant 0 — the default, which looks
   * exactly like the game did before variants existed.
   */
  function normalizeVariant(kind, n) {
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    return U.clamp(n | 0, 0, variantCount(kind) - 1);
  }

  /** The variant `steps` places along this character's three, wrapping. */
  function cycleVariant(kind, n, steps) {
    const count = variantCount(kind);
    const i = normalizeVariant(kind, n) + steps;
    return ((i % count) + count) % count;
  }

  /** The variant ROW — identity fields only — or null. */
  function variantRow(kind, n) {
    const list = variantList(kind);
    return list ? list[normalizeVariant(kind, n)] : null;
  }

  /** `<kind>.<n>`, the id SPEC-VARIANTS §2 gives every variant. */
  function variantIdOf(kind, n) {
    const v = variantRow(kind, n);
    if (v && v.id) return v.id;
    return normalizeKind(kind) + '.' + normalizeVariant(kind, n);
  }

  /**
   * `name` re-skinned for variant index `vi`.
   *
   * Variant 0 is the plain sprite by definition, so it short-circuits and the
   * default look goes down byte-for-byte the path it always did. sprites.js
   * caches the derived name, so a render loop asking for one allocates
   * nothing; a sprite with no variant at that index (the charred-toast death
   * frames, every shared FX sprite) comes back unchanged, and a sprites.js
   * without the variant pipeline degrades to the plain name rather than
   * throwing out of the middle of a frame.
   */
  function variantSprite(name, vi) {
    if (!name || !vi) return name;
    const S = T.Sprites;
    if (!S || typeof S.variantName !== 'function') return name;
    try {
      return S.variantName(name, vi);
    } catch (err) {
      return name;
    }
  }

  /** True when sprites.js has actually rasterized `name`. */
  function spriteReady(name) {
    const S = T.Sprites;
    if (!name) return false;
    if (!S || typeof S.has !== 'function') return true;   // can't tell: trust it
    return !!S.has(name);
  }

  /* Resolved once per kind AND VARIANT, then interned: the render loop looks a
   * character's frames up, it never builds a string (§12) — which is exactly
   * why the cache is two levels of plain array/object lookup rather than a
   * composed 'bread~1' key. Sprites are a sibling file, so a character (or a
   * variant of one) whose art has not been rasterized falls back rather than
   * throwing out of the middle of a frame. */
  const shipFrameCache = Object.create(null);
  const deathFrameCache = Object.create(null);
  const FALLBACK_FRAMES = ['bread0', 'bread1'];

  /**
   * Swap a resolved frame pair for its variant's, when that variant really has
   * been rasterized. Returns the pair unchanged for variant 0, for a sprite
   * with no variant (the shared death frames) and for a half-built sprite
   * table — so this can never be the reason a ship stops being drawn.
   */
  function variantFrames(frames, vi) {
    if (!vi) return frames;
    const a = variantSprite(frames[0], vi);
    const b = variantSprite(frames[1], vi);
    if (a === frames[0] && b === frames[1]) return frames;
    /* ALL OR NOTHING. variantSprite() hands back the PLAIN name for a frame
     * that has no art at this index, so taking the pair a frame at a time
     * could pair a re-skinned idle with a base recoil — a ship that changes
     * colour every time it fires, which reads as a bug in a way a variant
     * that quietly did not apply does not. sprites.js rasterizes a variant's
     * two body frames together or throws, so this only ever bites a half-built
     * sprite table, and it bites it the harmless way. */
    if (a === frames[0] || b === frames[1]) return frames;
    if (!spriteReady(a) || !spriteReady(b)) return frames;
    return [a, b];
  }

  /** [idle, firing-recoil] ship sprites for a character wearing `variant`. */
  function shipFrames(kind, variant) {
    const k = normalizeKind(kind);
    const vi = normalizeVariant(k, variant);
    let byVariant = shipFrameCache[k];
    if (!byVariant) { byVariant = []; shipFrameCache[k] = byVariant; }
    const cached = byVariant[vi];
    if (cached) return cached;

    const row = charRow(k);
    let frames = row && row.ship ? [row.ship, row.shipFire || row.ship]
                                 : FALLBACK_FRAMES;
    if (!spriteReady(frames[0]) || !spriteReady(frames[1])) frames = FALLBACK_FRAMES;
    frames = variantFrames(frames, vi);
    byVariant[vi] = frames;
    return frames;
  }

  /**
   * [frame 0, frame 1] of a character's death animation, in its variant.
   *
   * Charred toast is charred toast: the shared 'boomPlayer' pair has no
   * per-variant colouring, so a variant burns exactly like the default —
   * but a roster row that DOES carry its own `death` frames gets them
   * re-skinned, which is the whole reason this resolves through the same
   * path the living ship does.
   */
  function deathFrames(kind, variant) {
    const k = normalizeKind(kind);
    const vi = normalizeVariant(k, variant);
    let byVariant = deathFrameCache[k];
    if (!byVariant) { byVariant = []; deathFrameCache[k] = byVariant; }
    const cached = byVariant[vi];
    if (cached) return cached;

    const row = charRow(k);
    const own = row && row.death;
    let frames = (own && spriteReady(own[0]) && spriteReady(own[1]))
      ? own : DEATH_SPRITES;
    frames = variantFrames(frames, vi);
    byVariant[vi] = frames;
    return frames;
  }

  /* The jam jar's weapon id, read off its roster row. §4's "jam beats a bomb
   * 75% of the time" is a property of that ONE weapon, so the collision pass
   * compares against this instead of a literal spelled out mid-loop. */
  const JAM_WID = (ROSTER.jam && ROSTER.jam.wid) || 'jam';

  /* =========================================================================
   * SPRITE NAME RESOLUTION
   * entities.js may describe an enemy/bomb type as an index or as a name; both
   * are accepted so the two files can't disagree about spelling.
   * ====================================================================== */
  const ENEMY_LETTERS = ['A', 'B', 'C'];
  const BOMB_TYPE_NAMES = ['crumb', 'spark', 'flyingToast'];

  /** 'toastA0'-style sprite key for an enemy at the given wing frame. */
  function enemySprite(e, wingFrame) {
    // entities.js owns the naming; only fall back if it has no helper.
    const E = T.Entities;
    if (E && typeof E.enemySprite === 'function') return E.enemySprite(e, wingFrame);

    let letter = 'B';
    const t = e.type;
    if (typeof t === 'number') {
      letter = ENEMY_LETTERS[U.clamp(t, 0, 2) | 0];
    } else if (typeof t === 'string' && t.length > 0) {
      const up = t.charAt(t.length - 1).toUpperCase();
      if (up === 'A' || up === 'B' || up === 'C') letter = up;
    } else {
      // Fall back to the row → body-type mapping from §7.
      letter = e.row === 0 ? 'A' : (e.row <= 2 ? 'B' : 'C');
    }
    return 'toast' + letter + wingFrame;
  }

  /** Index 0..2 for a bomb whose type may be an index or a spec name. */
  function bombTypeIndex(type) {
    if (typeof type === 'number') return U.clamp(type, 0, 2) | 0;
    const i = BOMB_TYPE_NAMES.indexOf(type);
    return i < 0 ? 0 : i;
  }

  function bombSprite(b) {
    const E = T.Entities;
    if (E && typeof E.bombSprite === 'function') return E.bombSprite(b);
    return 'bomb' + bombTypeIndex(b.type) + (b.frame ? 'b' : 'a');
  }

  /* -------------------------------------------------------------------------
   * DEBRIS PRESETS
   * entities.js ships a tuned FX table; these locals are the fallback so this
   * file never reads a sibling at LOAD time (§1) and never allocates an options
   * object per explosion.
   * ---------------------------------------------------------------------- */
  const FX_FALLBACK = {
    crumb:  { count: 14, color: PAL.crumb,    speed: 190, life: 0.55, gravity: 520, size: 3 },
    butter: { count: 10, color: PAL.butter,   speed: 150, life: 0.45, gravity: 620, size: 3 },
    jam:    { count: 12, color: PAL.jamRed,   speed: 170, life: 0.50, gravity: 700, size: 2 },
    chrome: { count: 16, color: PAL.chromeLt, speed: 210, life: 0.60, gravity: 480, size: 3 },
    burnt:  { count: 18, color: PAL.burnt,    speed: 200, life: 0.75, gravity: 540, size: 3 }
  };

  /** Shared burst preset by name, preferring the one entities.js publishes. */
  function fx(name) {
    const table = T.Entities && T.Entities.FX;
    const preset = table && table[name];
    return preset || FX_FALLBACK[name] || FX_FALLBACK.crumb;
  }

  /* A splash of debris in the SHOT'S OWN colour. With nine base weapons plus
   * fifteen upgrades there is no longer a two-way butter/jam choice to make
   * here: the shape of the burst comes from the shared 'butter' preset and the
   * colour comes off the projectile, which weapons.js stamped from the roster.
   * One object, reused for every splash, so the collision path allocates
   * nothing (§12). */
  const shotDebris = {
    count: 10, color: PAL.butter, speed: 150, spread: Math.PI * 2,
    life: 0.45, gravity: 620, size: 3, drag: 1.6
  };

  function burstShot(board, s, x, y) {
    const preset = fx('butter');
    shotDebris.count = preset.count;
    shotDebris.speed = preset.speed;
    shotDebris.spread = preset.spread;
    shotDebris.life = preset.life;
    shotDebris.gravity = preset.gravity;
    shotDebris.size = preset.size;
    shotDebris.drag = preset.drag;
    shotDebris.color = (s && s.color) || preset.color;
    burst(board, x, y, shotDebris);
  }

  /* =========================================================================
   * BOARD CONSTRUCTION
   * ====================================================================== */

  /** Where a ship starts / respawns, spread apart when two share a board. */
  function spawnX(slot, shipCount) {
    if (shipCount < 2) return Math.round((C.W - C.SHIP_W) / 2);
    return Math.round((slot === 0 ? C.W * 0.34 : C.W * 0.66) - C.SHIP_W / 2);
  }

  /**
   * Build (or rebuild) the 11x5 formation for board.wave.
   * Wave N starts FORM_START_Y + (N-1)*18 px down, capped at BUNKER_Y - 200.
   * Enemies are stored row-major so `enemies[row * COLS + col]` is the grid.
   */
  function buildFormation(board) {
    const startY = Math.min(C.FORM_START_Y + (board.wave - 1) * WAVE_Y_STEP, WAVE_Y_CAP);
    const list = board.enemies;
    list.length = 0;
    for (let row = 0; row < C.ROWS; row++) {
      for (let col = 0; col < C.COLS; col++) {
        const e = T.Entities.makeEnemy(row, col);
        if (typeof e.w !== 'number') e.w = 56;
        if (typeof e.h !== 'number') e.h = 34;
        // The game owns formation geometry, so positions are authored here and
        // the sprite is centred inside its grid cell.
        e.x = Math.round(C.FORM_START_X + col * C.CELL_W + (C.CELL_W - e.w) / 2);
        e.y = Math.round(startY + row * C.CELL_H);
        e.alive = true;
        if (typeof e.points !== 'number') e.points = C.SCORE_ROW[row];
        list.push(e);
      }
    }
    board.aliveCount = list.length;
    board.dir = 1;
    board.frameIdx = 0;
    board.stepInterval = U.stepInterval(board.aliveCount, board.wave);
    board.stepT = board.stepInterval;
  }

  /**
   * Fresh, undamaged shields — done at board creation and every wave clear.
   * Existing bunkers are reset in place (each owns an offscreen canvas, so
   * rebuilding them every wave would leak four canvases a wave).
   */
  function restoreBunkers(board) {
    const E = T.Entities;
    const list = board.bunkers;
    const bw = E.BUNKER_W || BUNKER_W;
    const gap = (C.W - BUNKER_COUNT * bw) / (BUNKER_COUNT + 1);

    for (let i = 0; i < BUNKER_COUNT; i++) {
      const x = Math.round(gap + i * (bw + gap));
      let b = list[i];
      if (b && typeof E.resetBunker === 'function') {
        b.x = x;
        b.y = C.BUNKER_Y;
        E.resetBunker(b);
        continue;
      }
      b = E.makeBunker(x, C.BUNKER_Y);
      if (typeof b.x !== 'number') b.x = x;
      if (typeof b.y !== 'number') b.y = C.BUNKER_Y;
      if (typeof b.w !== 'number') b.w = bw;
      if (typeof b.h !== 'number') b.h = E.BUNKER_H || BUNKER_H;
      list[i] = b;
    }
    list.length = BUNKER_COUNT;
  }

  /**
   * Create a board for the given player slots, starting at `wave`.
   *
   * `kinds` and `variants` are slot-keyed maps from the select screen: the
   * character each player picked and, beside it, the cosmetic variant of that
   * character they picked. Both are carried onto the ship, and the variant is
   * carried NOWHERE else — it never reaches a number.
   *
   * `mode` is the session's, and with the slot count it decides the ONE thing
   * SPEC-COOP.md changes: `sharedHearts`. See the co-op section below — a board
   * with it false is the game exactly as it shipped, and every rule this file
   * gained is gated on it.
   */
  function createBoard(playerSlots, wave, kinds, variants, mode) {
    /* SPEC-COOP §1: the shared-heart rules are CO-OP WITH TWO PLAYERS and
     * nothing else. Co-op with one player keeps today's feel (a death costs a
     * heart and you respawn) because with no partner to be saved by, a free
     * death would make the game unloseable; classic's alternating turns are
     * untouched, and build one single-slot board per player anyway. */
    const shared = mode !== 'classic' && playerSlots.length > 1;

    const board = {
      slots: playerSlots.slice(),
      ships: [],
      enemies: [],
      bombs: [],
      ufo: null,
      bunkers: [],
      particles: T.Entities.makeParticleSystem(),
      booms: [],
      popups: [],

      // --- weapon upgrade loop (SPEC-WEAPONS §5) ------------------------
      shots: [],                 // every projectile, whoever fired it
      crate: null,               // the winged utensil drawer, or null
      token: null,               // the tumbling weapon token, or null
      crateT: C.CRATE_FIRST_GAP, // seconds until the next drawer sails in
      crateSide: -1,             // last entry side; flipped before each spawn
      slowT: 0,                  // seconds of syrup left on the formation
      pickup: null,              // live pickup banner, or null

      // --- BACON STRIP's burning trail (SPEC-CHARACTERS §3) --------------
      // The embers a rasher lays behind it, as a per-BOARD list: in classic
      // mode each board burns its own, and in co-op both players feed this
      // one. weapons.js lights the segments, ages them, collides them against
      // the formation and draws them through a single pooled ticker shot; the
      // list is created here with the board and put out here when the board
      // moves on (wave change, death, game over) — see clearTrail().
      baconTrail: [],
      baconTicker: null,

      /* --- CO-OP SHARED HEARTS (SPEC-COOP §2 and §4) --------------------
       * The team's pool, and everything a renderer needs to show it. See the
       * CO-OP SHARED HEARTS section further down for the rules; these are the
       * fields, and they are the contract T.UI reads:
       *
       *   sharedHearts  true ONLY on a two-player co-op board. Every co-op
       *                 rule below is gated on it; false is today's game.
       *   hearts        the pool. Shared by the team when sharedHearts, and
       *                 this board's own single ship's lives when it is not,
       *                 so §4's "in 1P co-op and in classic, hearts represent
       *                 that board's own pool" is true without a second field.
       *   heartsMax     how many sockets to draw: the starting pool, raised if
       *                 EXTRA_LIFE_AT ever grows it (capped at C.HEARTS_MAX).
       *   heartFlashT   seconds left of the "we just lost one" flash (§4).
       *   downBanner    the short who-went-down / heart-lost banner, or null.
       *   downNotice    the PERSISTENT marker while somebody is down, or null.
       */
      sharedHearts: shared,
      hearts: shared ? C.HEARTS_COOP : C.LIVES,
      heartsMax: shared ? C.HEARTS_COOP : C.LIVES,
      heartFlashT: 0,
      downBanner: null,
      downNotice: null,

      wave: wave,
      dir: 1,
      stepT: 0,
      stepInterval: U.stepInterval(C.TOTAL_ENEMIES, wave),
      frameIdx: 0,
      bombT: C.BOMB_COOLDOWN,
      bombType: 0,
      ufoT: U.randRange(C.UFO_MIN_GAP, C.UFO_MAX_GAP),
      over: false,
      endT: 0,
      clearT: 0,
      aliveCount: 0,
      stepped: false      // true only on the frame the formation marched
    };

    // Fixed-size FX slots: reused forever, so the hot loop never allocates.
    for (let i = 0; i < BOOM_SLOTS; i++) board.booms.push({ x: 0, y: 0, t: 0, active: false });
    for (let i = 0; i < POPUP_SLOTS; i++) board.popups.push({ x: 0, y: 0, t: 0, text: '', color: PAL.ui, active: false });

    for (let i = 0; i < playerSlots.length; i++) {
      const slot = playerSlots[i];
      const kind = normalizeKind(kinds[slot]);
      const variant = normalizeVariant(kind, variants ? variants[slot] : 0);
      const ship = T.Entities.makeShip(slot, kind);
      // entities.js still only knows the two original kinds, so the character
      // the player actually picked is stamped on afterwards — ship.kind is the
      // roster id everything else (sprites, life icons, HUD chip) keys off.
      ship.kind = kind;
      // SPEC-VARIANTS §1: and beside it, the variant of that character. This
      // is the ONLY place a ship's variant is set, and nothing ever clears it,
      // which is what makes it survive a death and respawn, a wave change, and
      // picking an upgrade token up and running it dry. weapons.js re-reads it
      // off the ship at every shot rather than copying it into the weapon
      // state, so reverting to the base weapon returns this character AND this
      // skin. Cosmetic: the ship's speed, hitbox and base weapon below are
      // resolved from `kind` alone and cannot see `variant` at all.
      ship.variant = variant;
      ship.variantId = variantIdOf(kind, variant);
      if (typeof ship.w !== 'number') ship.w = C.SHIP_W;
      if (typeof ship.h !== 'number') ship.h = C.SHIP_H;
      ship.slot = slot;
      ship.x = spawnX(slot, playerSlots.length);
      ship.y = C.SHIP_Y;
      ship.lives = C.LIVES;
      ship.score = 0;
      ship.alive = true;
      ship.dead = false;
      ship.out = false;
      ship.deathT = 0;
      ship.respawnT = 0;
      ship.spawnInvuln = SPAWN_INVULN;
      ship.shot = null;
      ship.frame = 0;
      ship.fireT = 0;
      ship.extraGiven = false;      // EXTRA_LIFE_AT is awarded once per ship
      ship.pendingRespawn = false;  // classic: waiting for this player's turn
      // SPEC-COOP §3: the fourth ship state. `down` is out of the wave but not
      // out of the run — see the CO-OP SHARED HEARTS section. On a board that
      // is not two-player co-op these three are set once here and never again.
      ship.down = false;            // out of this wave, waiting to be revived
      ship.downT = 0;               // seconds spent down (feedback only)
      ship.downWaiting = '';        // what they are waiting for, in words
      ship.reviveT = 0;             // seconds left of the revive spawn-in (§5)
      ship.fireHeld = false;        // §5: the attached weapons need the HOLD
      ship.fireBufferT = 0;         // remembered FIRE edge (see FIRE_BUFFER)
      // SPEC-CHARACTERS §6: the starting weapon is THIS character's base
      // weapon, resolved through the roster — nine kinds, nine base weapons,
      // and an upgrade token later reverts to exactly this one.
      T.Weapons.equip(ship, T.Weapons.baseFor(kind));
      // SPEC-BURRITO §1: a rotating gun starts a NEW GAME at the head of its
      // cycle. A ship object built here is fresh and carries no position, so
      // this is belt and braces — and it is the belt that keeps a harness (or
      // a future pool) that recycles ship objects honest.
      cycleReset(ship);
      board.ships.push(ship);
    }

    // weapons.js kills outside the plain shot x enemy pass (the mega-jam splash,
    // the baguette lance, the microwave beam). These hooks hand those kills back
    // here so scoring, popups and explosions stay in ONE place.
    board.weaponKill = function (enemy, shot) {
      killEnemy(board, enemy, shot && shot.owner);
    };
    board.weaponKillUfo = function (ufo, shot) {
      scoreUfo(board, shot && shot.owner);
    };

    buildFormation(board);
    restoreBunkers(board);
    syncHearts(board);
    return board;
  }

  /* =========================================================================
   * SMALL BOARD HELPERS
   * ====================================================================== */

  function boom(board, cx, cy) {
    const list = board.booms;
    for (let i = 0; i < list.length; i++) {
      if (!list[i].active) {
        list[i].active = true;
        list[i].t = 0;
        list[i].x = cx;
        list[i].y = cy;
        return;
      }
    }
  }

  function popup(board, x, y, text, color) {
    const list = board.popups;
    for (let i = 0; i < list.length; i++) {
      if (!list[i].active) {
        list[i].active = true;
        list[i].t = 0;
        list[i].x = x;
        list[i].y = y;
        list[i].text = text;
        list[i].color = color || PAL.ui;
        return;
      }
    }
  }

  function burst(board, x, y, opts) {
    const p = board.particles;
    if (p && typeof p.spawn === 'function') p.spawn(x, y, opts);
  }

  function killShot(s) {
    if (!s) return;
    s.alive = false;
    if (s.owner && s.owner.shot === s) s.owner.shot = null;
  }

  /**
   * Attached weapons (the baguette lance, the microwave beam) carry a
   * deliberately EMPTY collision rect and run their own column sweep inside
   * weapons.js. The generic shot passes below must skip them, or a beam would
   * chew the bunker it is standing behind and burst a crate on touch.
   */
  function isSolidShot(s) {
    return !!s && s.alive && !s.attached && s.w > 0 && s.h > 0;
  }

  /**
   * Hand every projectile on this board back to the weapon pool and forget it.
   * A microwave beam gives up its hum reference on the way out, which is what
   * makes the sound stop dead on a wave clear, a board end or a game over.
   *
   * The bacon trail's ticker is one of those projectiles, so its embers are
   * put out in the same breath — otherwise a wave change would leave a cold
   * minefield sitting over the next formation's spawn.
   */
  function clearShots(board) {
    const list = board.shots;
    if (list) {
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        list.splice(i, 1);
        T.Weapons.retireShot(s);
      }
    }
    for (let i = 0; i < board.ships.length; i++) board.ships[i].shot = null;
    clearTrail(board);
  }

  /**
   * Drop only the attached lance / beam. Used when the board freezes but its
   * projectiles should stay put (pause) — a held beam is the one shot that
   * would otherwise keep humming over a stopped game.
   */
  function dropAttached(board) {
    const list = board.shots;
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!s.attached) continue;
      list.splice(i, 1);
      T.Weapons.retireShot(s);
    }
    for (let i = 0; i < board.ships.length; i++) board.ships[i].fireHeld = false;
  }

  /**
   * Put the BACON STRIP's embers out (SPEC-CHARACTERS §3).
   *
   * With no argument the whole board's trail goes cold and its ticker handle
   * is dropped — that is the wave change, the board end and the game over.
   * With a ship, only THAT ship's embers go: a co-op death must not take the
   * other player's minefield with it, and a segment outliving the rasher that
   * lit it is the whole point of the weapon.
   */
  function clearTrail(board, ship) {
    const list = board && board.baconTrail;
    if (!list) return;

    if (!ship) {
      // weapons.js owns the segment shape, so let it put out its own embers
      // when it can; the walk is the fallback for a half-loaded sibling.
      const W = T.Weapons;
      if (W && typeof W.clearTrail === 'function') W.clearTrail(board);
      else for (let i = 0; i < list.length; i++) list[i].active = false;
      board.baconTicker = null;
      return;
    }

    for (let i = 0; i < list.length; i++) {
      if (list[i].owner === ship) list[i].active = false;
    }
  }

  /** Every board in the session goes cold — the game is over, or we quit. */
  function clearAllTrails() {
    const s = Game.session;
    if (!s || !s.boards) return;
    for (let i = 0; i < s.boards.length; i++) clearTrail(s.boards[i]);
  }

  /** Clear the whole crate → token loop: wave change, board end, quit. */
  function clearPickups(board) {
    board.crate = null;
    board.token = null;
    board.crateT = C.CRATE_FIRST_GAP;
    board.slowT = 0;
  }

  /** Stop the bonus toaster AND its siren in one place, always together. */
  function killUfo(board) {
    if (board.ufo) {
      board.ufo.alive = false;
      board.ufo = null;
    }
    sirenStop();
  }

  /** A player slot's accent colour — P1 mint, P2 pink, as the HUD paints them. */
  function accentFor(slot) {
    return slot === 1 ? PAL.p2 : PAL.p1;
  }

  /** 'PLAYER 1' / 'PLAYER 2', for anything that has to NAME a player. */
  function playerName(ship) {
    return 'PLAYER ' + ((ship && typeof ship.slot === 'number' ? ship.slot : 0) + 1);
  }

  function anyShipAlive(board) {
    for (let i = 0; i < board.ships.length; i++) {
      const s = board.ships[i];
      if (s.alive && !s.out) return true;
    }
    return false;
  }

  function allShipsOut(board) {
    for (let i = 0; i < board.ships.length; i++) {
      if (!board.ships[i].out) return false;
    }
    return true;
  }

  /** Lowest ALIVE enemy in a column, or null when the column is empty. */
  function lowestInColumn(board, col) {
    for (let row = C.ROWS - 1; row >= 0; row--) {
      const e = board.enemies[row * C.COLS + col];
      if (e && e.alive) return e;
    }
    return null;
  }

  /* =========================================================================
   * SCORING
   * ====================================================================== */
  function addScore(board, ship, points, x, y) {
    if (!ship) return;
    ship.score += points;
    if (ship.score > Game.hiScore) {
      Game.hiScore = ship.score;
      hiDirty = true;
    }
    // §3: one extra life per ship, the first time it crosses EXTRA_LIFE_AT.
    if (!ship.extraGiven && ship.score >= C.EXTRA_LIFE_AT) {
      ship.extraGiven = true;
      /* SPEC-COOP §2 rule 7: on a shared board the award goes to the TEAM —
       * one heart in the shared pool, capped at C.HEARTS_MAX so it cannot grow
       * without limit. Still once per ship, exactly as it always was, which is
       * why the cap and the pool line up: HEARTS_COOP (3) plus one award per
       * player is HEARTS_MAX (5), and a duo can reach the ceiling but never
       * pass it. `extraGiven` is set either way — the award happened, and a
       * team already at the cap does not get to bank it for later. */
      let granted = true;
      if (board.sharedHearts) {
        granted = board.hearts < C.HEARTS_MAX;
        if (granted) {
          board.hearts += 1;
          syncHearts(board);
        }
      } else {
        ship.lives += 1;
        syncHearts(board);
      }
      if (!granted) return;
      sfx('extraLife');
      popup(board, x !== undefined ? x : ship.x + ship.w / 2,
            y !== undefined ? y : ship.y - 20,
            board.sharedHearts ? '+1 HEART' : '1UP',
            accentFor(ship.slot));
    }
  }

  let hiDirty = false;
  let hiSaveT = 0;

  function persistHi() {
    U.storeSet(HI_KEY, Game.hiScore);
    hiDirty = false;
  }

  /* =========================================================================
   * PLAY-STATE UPDATE — the per-frame order is exactly §9's list
   * ====================================================================== */

  /* 1 + 2: read input, move ships, handle fire, run death / respawn timers. */
  function updateShips(board, dt) {
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      if (ship.out) continue;

      /* SPEC-COOP §3: a DOWN ship takes no input that affects play. It reads
       * no pad, moves nothing, fires nothing and holds nothing — the trigger
       * is released every frame, so a button held at the moment its owner died
       * (or a touch column that is still reporting a press) cannot come back
       * as a stuck shot when they are revived. START and BACK are read above
       * this loop, for the whole board, so a downed player can still pause and
       * still quit. */
      if (ship.down) {
        ship.downT += dt;
        ship.fireHeld = false;
        ship.fireBufferT = 0;
        continue;
      }

      if (ship.dead) {
        ship.deathT += dt;
        if (ship.deathT >= C.SHIP_RESPAWN_DELAY) finishDeath(board, ship);
        continue;
      }
      if (!ship.alive) continue;

      if (ship.reviveT > 0) ship.reviveT = Math.max(0, ship.reviveT - dt);
      if (ship.spawnInvuln > 0) ship.spawnInvuln = Math.max(0, ship.spawnInvuln - dt);
      if (ship.fireT > 0) {
        ship.fireT -= dt;
        if (ship.fireT <= 0) ship.frame = 0;
      }

      // Ammo / duration clock. Reverts the ship to its base weapon when spent.
      T.Weapons.tick(ship, dt);

      const p = pad(ship.slot);
      if (!p) { ship.fireHeld = false; continue; }

      let ax = p.axisX || 0;
      if (p.left) ax -= 1;
      if (p.right) ax += 1;
      ax = U.clamp(ax, -1, 1);

      ship.x += ax * C.SHIP_SPEED * dt;
      ship.x = U.clamp(ship.x, C.FORM_MARGIN, C.W - C.FORM_MARGIN - ship.w);
      ship.y = C.SHIP_Y;

      /* SPEC-WEAPONS §5: firing goes through the weapon layer.
       * The base weapons keep the classic one-tap-one-shot feel, so they only
       * answer the rising edge; an upgrade fires on its own fireDelay for as
       * long as the trigger is down. fireHeld is what the attached weapons —
       * the microwave beam and the baguette lance — watch to know when to end. */
      ship.fireHeld = !!p.fire;

      // A base weapon's rising edge is REMEMBERED, so a tap that arrives during
      // a `refire` lockout still fires the moment the lockout lifts instead of
      // being thrown away. The window is this weapon's own lockout plus a
      // little slack, which is exactly long enough for a press made at the
      // start of the lockout to survive it and no longer. The buffer is spent
      // by the shot it produces and only a NEW press refills it, so holding the
      // trigger still yields exactly one shot — the classic rule is untouched.
      const def = ship.weapon && ship.weapon.def;
      const lockout = (def && def.base && def.refire > 0) ? def.refire : 0;
      if (p.firePressed) ship.fireBufferT = lockout + FIRE_BUFFER;
      else if (ship.fireBufferT > 0) ship.fireBufferT = Math.max(0, ship.fireBufferT - dt);

      const wantsFire = (def && !def.base) ? p.fire : ship.fireBufferT > 0;
      if (wantsFire && T.Weapons.canFire(ship, board)) {
        if (T.Weapons.fire(ship, board)) ship.fireBufferT = 0;
      }
    }
  }

  /* 3: advance shots and bombs. Every projectile — base pat of butter or
   * ricocheting pancake — moves through T.Weapons.updateShot, which owns the
   * per-mechanic motion and hands spent shots back to its pool. */
  function updateShots(board, dt) {
    const list = board.shots;
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (T.Weapons.updateShot(s, dt, board)) continue;
      list.splice(i, 1);
      if (s.owner && s.owner.shot === s) s.owner.shot = null;
    }
  }

  function updateBombs(board, dt) {
    const bombs = board.bombs;
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      if (!b.alive) { bombs.splice(i, 1); continue; }
      b.y += b.vy * dt;
      b.animT += dt;
      if (b.animT >= BOMB_ANIM) {
        b.animT = 0;
        b.frame = b.frame ? 0 : 1;
      }
    }
  }

  /* 4: the formation march — a whole-unit step on a timer, never continuous. */
  function updateFormation(board, dt) {
    board.stepped = false;
    if (board.slowT > 0) board.slowT = Math.max(0, board.slowT - dt);

    board.stepInterval = U.stepInterval(board.aliveCount, board.wave);
    // SPEC-WEAPONS §5: syrup DIVIDES the interval by SYRUP_SLOW_FACTOR, which
    // lengthens it — a syruped formation marches slower, it does not speed up.
    if (board.slowT > 0) board.stepInterval /= C.SYRUP_SLOW_FACTOR;
    if (board.stepInterval !== lastTempo) {
      lastTempo = board.stepInterval;
      marchTempo(board.stepInterval);
    }

    board.stepT -= dt;
    if (board.stepT > 0) return;
    board.stepT += board.stepInterval;
    if (board.stepT < 0) board.stepT = board.stepInterval;

    // Would the whole unit cross the turn margin on this step?
    let minX = Infinity;
    let maxX = -Infinity;
    const list = board.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (e.x < minX) minX = e.x;
      if (e.x + e.w > maxX) maxX = e.x + e.w;
    }
    if (minX === Infinity) return;   // nothing left to march

    const step = C.FORM_STEP_X * board.dir;
    const hitsWall = board.dir > 0
      ? (maxX + C.FORM_STEP_X > C.W - C.FORM_MARGIN)
      : (minX - C.FORM_STEP_X < C.FORM_MARGIN);

    if (hitsWall) {
      board.dir = -board.dir;
      for (let i = 0; i < list.length; i++) {
        if (list[i].alive) list[i].y += C.FORM_STEP_Y;
      }
    } else {
      for (let i = 0; i < list.length; i++) {
        if (list[i].alive) list[i].x += step;
      }
    }

    // Wings flap once per step, so they beat faster as the field thins out.
    board.frameIdx = (board.frameIdx + 1) % C.FRAME_CYCLE.length;
    board.stepped = true;
    marchTempo(board.stepInterval);
  }

  /* 5: bonus toaster timer + motion. */
  function updateUfo(board, dt) {
    if (board.ufo) {
      const u = board.ufo;
      u.x += u.vx * dt;
      if (u.x > C.W + 4 || u.x + u.w < -4) killUfo(board);
      return;
    }

    board.ufoT -= dt;
    if (board.ufoT > 0) return;
    board.ufoT = U.randRange(C.UFO_MIN_GAP, C.UFO_MAX_GAP);
    if (board.aliveCount < UFO_MIN_ALIVE) return;   // arcade: no pass on a thin field

    const dir = U.chance(0.5) ? 1 : -1;
    const u = T.Entities.makeUfo(dir);
    if (typeof u.w !== 'number') u.w = 76;
    if (typeof u.h !== 'number') u.h = 34;
    u.y = C.UFO_Y;
    u.x = dir > 0 ? -u.w : C.W;
    if (!u.vx || (u.vx > 0) !== (dir > 0)) u.vx = dir * C.UFO_SPEED;
    if (typeof u.scoreIndex !== 'number') {
      u.scoreIndex = U.randInt(0, C.UFO_SCORES.length - 1);
    }
    u.alive = true;
    board.ufo = u;
    sfx('ufoAppear');
    sirenStart();
  }

  /* 5b: the winged utensil drawer — SPEC-WEAPONS §1. One crate at a time, the
   * first CRATE_FIRST_GAP seconds into a wave and then every CRATE_GAP_MIN..MAX,
   * entering from alternating sides. Nothing new sails in while a token is
   * still falling: there is only ever one of each in the air. */
  function updateCrate(board, dt) {
    if (board.crate) {
      if (!T.Weapons.updateCrate(board.crate, dt, board)) board.crate = null;
      return;
    }
    if (board.token) return;
    board.crateT -= dt;
    if (board.crateT > 0) return;
    board.crateT = U.randRange(C.CRATE_GAP_MIN, C.CRATE_GAP_MAX);
    board.crateSide = -board.crateSide;
    board.crate = T.Weapons.makeCrate(board.crateSide);
  }

  /* 5c: the token's fall. Reaching the floor only marks it dead here — the
   * VERDICT (caught, or lost) is resolved in the collision order below. */
  function updateToken(board, dt) {
    if (board.token) T.Weapons.updateToken(board.token, dt, board);
  }

  /* 6: enemy fire — lowest alive toaster of a random occupied column. */
  function updateBombSpawn(board, dt) {
    board.bombT -= dt;
    if (board.bombT > 0) return;
    if (board.bombs.length >= C.MAX_BOMBS) return;
    if (board.aliveCount === 0) return;
    if (!anyShipAlive(board)) return;

    // Choose among occupied columns without allocating: count, then pick.
    let occupied = 0;
    for (let col = 0; col < C.COLS; col++) {
      if (lowestInColumn(board, col)) occupied++;
    }
    if (occupied === 0) return;

    let n = U.randInt(0, occupied - 1);
    let shooter = null;
    for (let col = 0; col < C.COLS; col++) {
      const e = lowestInColumn(board, col);
      if (!e) continue;
      if (n === 0) { shooter = e; break; }
      n--;
    }
    if (!shooter) return;

    const type = board.bombType;
    board.bombType = (board.bombType + 1) % BOMB_TYPE_NAMES.length;   // cycle all 3

    const b = T.Entities.makeBomb(shooter.x + shooter.w / 2, shooter.y + shooter.h, type);
    if (typeof b.w !== 'number') b.w = 8;
    if (typeof b.h !== 'number') b.h = 16;
    if (typeof b.type !== 'number' && typeof b.type !== 'string') b.type = type;
    if (typeof b.frame !== 'number') b.frame = 0;
    if (typeof b.animT !== 'number') b.animT = 0;
    if (!(b.vy > 0)) b.vy = U.randRange(C.BOMB_SPEED_MIN, C.BOMB_SPEED_MAX);
    b.x = Math.round(shooter.x + shooter.w / 2 - b.w / 2);
    b.y = Math.round(shooter.y + shooter.h - 6);
    b.alive = true;
    board.bombs.push(b);

    board.bombT = C.BOMB_COOLDOWN * U.randRange(1, 1.7);
  }

  /* -------------------------------------------------------------------------
   * 7: COLLISIONS — resolved in exactly the order §9 lists them.
   * ---------------------------------------------------------------------- */
  function resolveCollisions(board) {
    shotsVsEnemies(board);
    shotsVsUfo(board);
    shotsVsCrate(board);
    shotsVsBombs(board);
    shotsVsBunkers(board);
    shotsVsCeiling(board);

    bombsVsShips(board);
    bombsVsBunkers(board);
    bombsVsFloor(board);

    shipsVsToken(board);
    tokenVsFloor(board);

    enemiesVsBunkers(board);
    enemiesVsShips(board);
    enemiesVsFloorLine(board);
  }

  /**
   * One toaster dies. Everything that follows from that — the explosion, the
   * crumbs, the ding, the score — lives here, because weapons.js's splash and
   * sweep mechanics kill through board.weaponKill and must land in exactly the
   * same place as a plain shot. Idempotent: a toaster only dies once.
   */
  function killEnemy(board, e, owner) {
    if (!e || !e.alive) return;
    e.alive = false;
    board.aliveCount--;

    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    boom(board, cx, cy);
    burst(board, cx, cy, fx('crumb'));
    sfx('enemyHit');
    addScore(board, owner, e.points, cx, cy);
  }

  /** The bonus toaster dies — and sometimes leaves a weapon token behind. */
  function scoreUfo(board, owner) {
    const u = board.ufo;
    if (!u) return;
    const cx = u.x + u.w / 2;
    const cy = u.y + u.h / 2;
    const pts = C.UFO_SCORES[U.clamp(u.scoreIndex, 0, C.UFO_SCORES.length - 1) | 0];

    killUfo(board);
    boom(board, cx, cy);
    burst(board, cx, cy, fx('chrome'));
    sfx('ufoHit');
    addScore(board, owner, pts, cx, cy);
    popup(board, cx, cy, String(pts), PAL.coilLt);

    // SPEC-WEAPONS §5: the Chrome Deluxe is carrying cutlery a quarter of the time.
    if (!board.token && U.chance(C.UFO_TOKEN_CHANCE)) {
      board.token = T.Weapons.makeToken(cx, cy, T.Weapons.rollDrop());
      sfx('tokenDrop');
    }
  }

  function shotsVsEnemies(board) {
    const shots = board.shots;
    if (!shots) return;
    const list = board.enemies;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!isSolidShot(s)) continue;
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (!e.alive) continue;
        // aabb reads s.w and s.h off the shot every single frame, which is what
        // makes the MILK CARTON's growing splash real: weapons.js widens s.w as
        // it climbs (step 3) and this test, run at step 7, sees the CURRENT
        // width — never the one it launched with (SPEC-CHARACTERS §3).
        if (!T.Entities.aabb(s, e)) continue;

        // onHit runs the projectile's own side effects (the cannon's airburst,
        // the mega-jam splash, the syrup slow) and decides whether the shot dies
        // here or ploughs on through the row behind.
        const verdict = T.Weapons.onHit(s, e, board);
        killEnemy(board, e, s.owner);
        if (verdict !== 'pierce') { killShot(s); break; }
      }
    }
  }

  function shotsVsUfo(board) {
    const shots = board.shots;
    if (!shots || !board.ufo) return;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!isSolidShot(s)) continue;
      const u = board.ufo;
      if (!u) return;
      if (!T.Entities.aabb(s, u)) continue;

      const verdict = T.Weapons.onHit(s, u, board);
      scoreUfo(board, s.owner);
      if (verdict !== 'pierce') killShot(s);
      return;
    }
  }

  /** Two hits burst the utensil drawer and a weapon token tumbles out of it. */
  function shotsVsCrate(board) {
    const shots = board.shots;
    const crate = board.crate;
    if (!shots || !crate || !crate.alive) return;

    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!isSolidShot(s)) continue;
      if (!T.Entities.aabb(s, crate)) continue;

      const cx = crate.x + crate.w / 2;
      const cy = crate.y + crate.h / 2;
      const opened = T.Weapons.hitCrate(crate, board);
      const verdict = T.Weapons.onHit(s, crate, board);
      if (verdict !== 'pierce') killShot(s);

      if (!opened) continue;
      // hitCrate drops the token itself when the board has room for one; this
      // covers the case where it could not, so a burst is never wasted.
      if (!board.token) {
        board.token = T.Weapons.makeToken(cx, cy, T.Weapons.rollDrop());
        sfx('tokenDrop');
      }
      board.crate = null;
      boom(board, cx, cy);
      return;
    }
  }

  function shotsVsBombs(board) {
    const shots = board.shots;
    if (!shots) return;
    const bombs = board.bombs;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!isSolidShot(s)) continue;
      for (let k = bombs.length - 1; k >= 0; k--) {
        const b = bombs[k];
        if (!b.alive) continue;
        if (!T.Entities.aabb(s, b)) continue;

        // §4: the bomb always goes. Butter ploughs straight through; thin jam
        // survives the exchange only 75% of the time. An upgrade follows its
        // own mechanic instead — a knife pierces, a scattered loop is spent.
        b.alive = false;
        bombs.splice(k, 1);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        burst(board, cx, cy, fx('crumb'));

        if (!s.def || s.def.base) {
          // Only the jam jar's thin glob loses the exchange, and only some of
          // the time — every other base weapon ploughs on, as butter always
          // has. Which weapon that is comes off its roster row, not a literal.
          if (s.wid === JAM_WID && !U.chance(JAM_WIN_ODDS)) {
            killShot(s);
            burstShot(board, s, cx, cy);
          }
        } else if (T.Weapons.onHit(s, b, board) !== 'pierce') {
          killShot(s);
        }
        if (!s.alive) break;
      }
    }
  }

  /**
   * How wide a hole this shot chews in a shield.
   *
   * §4 makes the carve radius a WEAPON stat, and weapons.js stamps it onto
   * every projectile from the roster's `dmg` column. Read it from the shot so
   * the two files can never drift apart; the roster row (and then the two
   * locals) are the fallback for a shot that arrived without one.
   *
   * A radius of ZERO is not "no radius" — it is the HONEY DIPPER, whose whole
   * advantage is that it goes through your own cover (SPEC-CHARACTERS §3), so
   * shotsVsBunkers skips that shot entirely rather than carving a 0px hole.
   */
  function carveRadius(s) {
    if (typeof s.damageRadius === 'number') return s.damageRadius;
    const row = ROSTER_BY_WID[s.wid];
    if (row && typeof row.dmg === 'number') return row.dmg;
    return s.wid === JAM_WID ? DMG_R_JAM : DMG_R_BUTTER;
  }

  function shotsVsBunkers(board) {
    const shots = board.shots;
    if (!shots) return;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!isSolidShot(s)) continue;

      // Ask the WEAPON, not the character: a shot that does no shield damage
      // does not interact with shields at all — it passes clean through and
      // never even asks the bunker whether it was hit.
      const r = carveRadius(s);
      if (!(r > 0)) continue;

      for (let k = 0; k < board.bunkers.length; k++) {
        const bk = board.bunkers[k];
        if (T.Entities.bunkerIsGone(bk)) continue;
        if (!T.Entities.rectHitsBunker(bk, s.x, s.y, s.w, s.h)) continue;

        T.Entities.damageBunker(bk, s.x + s.w / 2, s.y, r);
        const verdict = T.Weapons.onHit(s, bk, board);
        burstShot(board, s, s.x + s.w / 2, s.y);
        sfx('bunkerHit');
        if (verdict !== 'pierce') { killShot(s); break; }
      }
    }
  }

  function shotsVsCeiling(board) {
    const shots = board.shots;
    if (!shots) return;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!isSolidShot(s)) continue;
      if (s.vy >= 0) continue;                 // only things still climbing
      if (s.y + s.h <= C.PLAY_TOP) {
        burstShot(board, s, s.x + s.w / 2, C.PLAY_TOP);
        killShot(s);
      }
    }
  }

  /**
   * Catching a token. Deliberately generous — TOKEN_MAGNET px of slop around
   * the ship — and first come, first served: in co-op either player may take
   * any token, which is the good kind of arguing.
   */
  function shipsVsToken(board) {
    const token = board.token;
    if (!token || !token.alive) return;

    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      // SPEC-COOP §3: a downed player catches NOTHING. (catchesToken refuses a
      // ship that is not alive, and a down ship never is — this says it out
      // loud in the pass that would otherwise hand them a weapon they cannot
      // hold, and is one of the collision lists §3 asks to have audited.)
      if (ship.down) continue;
      if (!T.Weapons.catchesToken(ship, token)) continue;

      token.alive = false;
      board.token = null;
      T.Weapons.equip(ship, token.wid);
      board.pickup = {
        wid: token.wid,
        def: token.def,
        name: token.name,
        tagline: token.def ? token.def.tagline : '',
        color: token.color,
        slot: ship.slot,
        // Who caught it, and which version of them: the banner itself only
        // names the player and the weapon today (T.UI owns its look), so this
        // is the catcher's identity carried alongside `slot` and nothing more.
        // It is the character AND the variant or neither — a half-identity is
        // the thing that lets a banner draw the wrong skin later.
        kind: ship.kind,
        variant: ship.variant,
        variantId: ship.variantId,
        t: 0,
        duration: PICKUP_BANNER_TIME,
        remaining: PICKUP_BANNER_TIME
      };
      burst(board, token.x + token.w / 2, token.y + token.h / 2, fx('chrome'));
      sfx('tokenGrab');
      rumble(ship.slot, 220, 0.35, 0.8);
      return;
    }
  }

  /** Missed it. The token is gone and the cutlery clangs off the floor line. */
  function tokenVsFloor(board) {
    const token = board.token;
    if (!token || token.alive) return;
    board.token = null;
    burst(board, token.x + token.w / 2, C.PLAY_BOTTOM, fx('chrome'));
    sfx('tokenLost');
  }

  function bombsVsShips(board) {
    const bombs = board.bombs;
    for (let k = bombs.length - 1; k >= 0; k--) {
      const b = bombs[k];
      if (!b.alive) continue;
      for (let i = 0; i < board.ships.length; i++) {
        const ship = board.ships[i];
        // SPEC-COOP §3: a DOWN ship is not on the field and cannot be hit. It
        // is never `alive` either, so this list already refused it — the named
        // test is here because a bomb killing a player who is not on screen is
        // THE bug this feature has to not have.
        if (ship.down) continue;
        if (!ship.alive || ship.dead || ship.out || ship.spawnInvuln > 0) continue;
        if (!T.Entities.aabb(b, ship)) continue;

        b.alive = false;
        bombs.splice(k, 1);
        hitShip(board, ship);
        break;
      }
    }
  }

  function bombsVsBunkers(board) {
    const bombs = board.bombs;
    for (let k = bombs.length - 1; k >= 0; k--) {
      const b = bombs[k];
      if (!b.alive) continue;
      for (let j = 0; j < board.bunkers.length; j++) {
        const bk = board.bunkers[j];
        if (T.Entities.bunkerIsGone(bk)) continue;
        if (!T.Entities.rectHitsBunker(bk, b.x, b.y, b.w, b.h)) continue;

        T.Entities.damageBunker(bk, b.x + b.w / 2, b.y + b.h, DMG_R_BOMB);
        b.alive = false;
        bombs.splice(k, 1);
        burst(board, b.x + b.w / 2, b.y + b.h, fx('crumb'));
        sfx('bunkerHit');
        break;
      }
    }
  }

  function bombsVsFloor(board) {
    const bombs = board.bombs;
    for (let k = bombs.length - 1; k >= 0; k--) {
      const b = bombs[k];
      if (!b.alive) continue;
      if (b.y + b.h >= C.PLAY_BOTTOM) {
        burst(board, b.x + b.w / 2, C.PLAY_BOTTOM, fx('crumb'));
        b.alive = false;
        bombs.splice(k, 1);
      }
    }
  }

  /**
   * Classic behaviour: toasters chew the shields away as they march over them.
   * Only bites on a march step — the formation is stationary between steps, and
   * gnawing every frame would vaporise a bunker the instant one touched it.
   */
  function enemiesVsBunkers(board) {
    if (!board.stepped) return;
    const E = T.Entities;
    const list = board.enemies;
    for (let j = 0; j < board.bunkers.length; j++) {
      const bk = board.bunkers[j];
      if (E.bunkerIsGone(bk)) continue;
      const top = bk.y;
      const bottom = bk.y + bk.h;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive) continue;
        if (e.y + e.h < top || e.y > bottom) continue;         // cheap band test
        if (!E.rectHitsBunker(bk, e.x, e.y, e.w, e.h)) continue;
        if (typeof E.erodeBunkerTop === 'function') {
          E.erodeBunkerTop(bk, e.x, e.w);        // gnaw down from the top surface
        } else {
          E.damageBunker(bk, e.x + e.w * 0.5, e.y + e.h, DMG_R_ENEMY);
        }
      }
    }
  }

  function enemiesVsShips(board) {
    const list = board.enemies;
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      // SPEC-COOP §3: and a toaster cannot walk into one either.
      if (ship.down) continue;
      if (!ship.alive || ship.dead || ship.out) continue;
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (!e.alive) continue;
        if (!T.Entities.aabb(e, ship)) continue;
        hitShip(board, ship);
        break;
      }
    }
  }

  function enemiesVsFloorLine(board) {
    const list = board.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (e.y + e.h >= INVASION_Y) {
        // §3: toasters this deep end the board on the spot.
        for (let k = 0; k < board.ships.length; k++) {
          const ship = board.ships[k];
          ship.lives = 0;
          ship.out = true;
          ship.alive = false;
          ship.dead = false;
          // SPEC-COOP §2 rule 6: toasters on the bunker line end the board on
          // the spot REGARDLESS OF HEARTS, exactly as they always have. A
          // player who was down is out with everybody else — nobody is waiting
          // to be revived any more.
          ship.down = false;
          ship.downWaiting = '';
          ship.reviveT = 0;
          killShot(ship.shot);
        }
        // The pool goes with them, for the same reason the loop above zeroes
        // every player's lives rather than leaving them: the run is over, and
        // a HUD still showing hearts in hand over a game-over card reads as a
        // bug rather than as the rule it is.
        board.hearts = 0;
        syncHearts(board);
        burst(board, e.x + e.w / 2, e.y + e.h, fx('burnt'));
        sfx('playerDie');
        endBoard(board);
        return;
      }
    }
  }

  /* =========================================================================
   * CO-OP SHARED HEARTS AND DOWNED PLAYERS  (SPEC-COOP.md §2 and §3)
   *
   * Crossy Castle's rule, in a Space Invaders board. On a TWO-PLAYER CO-OP
   * board — and on no other board in the game — the team shares one pool of
   * hearts and a death does not spend one:
   *
   *   1. Dying puts you DOWN. Nothing is decremented. You leave the play field
   *      for the rest of the wave and keep your score, character, variant and
   *      weapon while you are gone.
   *   2. You come back when EITHER the next wave starts — your partner cleared
   *      it without you, and your death cost the team nothing at all — OR your
   *      partner goes down too.
   *   3. A heart is spent ONLY at the moment every player is down at once, and
   *      that same moment revives everybody, mid-wave, with the formation left
   *      exactly where it marched to. Both going down in the same frame is one
   *      heart, not two, because the heart is spent by the transition INTO
   *      "everyone is down" and there is only ever one of those.
   *   4. Spending the last heart is the game over.
   *
   * WHY THIS IS GATED ON `board.sharedHearts` AND NOT ON THE MODE. Co-op with
   * ONE player must keep today's feel exactly — a death costs a life and you
   * respawn — because with no partner to be saved by, a free death would make
   * the game unloseable (SPEC-COOP §1). Classic is turn-based and each player
   * already owns their own board and their own lives. So the flag is set once,
   * at board creation, from the mode AND the slot count; every function below
   * is a no-op without it, and every function this file already had takes the
   * branch it always took.
   *
   * THE FOURTH SHIP STATE. A ship is now active / dying / down / out:
   *
   *   active   alive true,  dead false, down false, out false
   *   dying    alive false, dead true,  down false, out false   (unchanged)
   *   down     alive false, dead false, down TRUE,  out false   (new)
   *   out      alive false, dead false, down false, out true
   *
   * `down` deliberately implies `alive === false`, which is what makes the
   * audit §3 asks for hold by construction as well as by inspection: every
   * collision list in this file already refuses a ship that is not alive.
   * The explicit `down` tests added beside those are belt and braces, and they
   * are there because "a down ship that can still be hit by a bomb" is the
   * obvious bug in this feature and it should be impossible to reintroduce by
   * touching one line.
   * ====================================================================== */

  /**
   * Keep the heart pool and the ships' `lives` telling the same story.
   *
   * On a SHARED board the pool is the team's and a ship's own `lives` is
   * meaningless on its own, so it mirrors the pool — anything that reads a
   * ship's lives (the HUD's "is this player out?" test) then sees the number
   * that actually decides the run, and no reader has to learn a second field.
   * On every other board the ship's lives are the truth and `board.hearts`
   * mirrors THEM, which is SPEC-COOP §4's "in 1P co-op and in classic, hearts
   * represent that board's own pool".
   */
  function syncHearts(board) {
    const ships = board.ships;
    if (board.sharedHearts) {
      for (let i = 0; i < ships.length; i++) ships[i].lives = board.hearts;
    } else {
      const ship = ships[0];
      board.hearts = ship && typeof ship.lives === 'number'
        ? Math.max(0, ship.lives) : 0;
    }
    if (board.hearts > board.heartsMax) board.heartsMax = board.hearts;
  }

  /** True once every player still in the run is down. False if nobody is in it. */
  function everyoneDown(board) {
    let any = false;
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      if (ship.out) continue;
      any = true;
      if (!ship.down) return false;
    }
    return any;
  }

  /** Somebody other than `ship` who is still in the run — the partner, or null. */
  function partnerOf(board, ship) {
    for (let i = 0; i < board.ships.length; i++) {
      const other = board.ships[i];
      if (other === ship || other.out) continue;
      return other;
    }
    return null;
  }

  /**
   * The short banner (SPEC-COOP §5): who went down and that their partner can
   * still save them, or the heart the team just spent. T.UI owns every pixel
   * of it and reads `board.downBanner`, whose shape matches the pickup banner
   * and the wave banner it already draws:
   *
   *   type      'down' | 'heart'
   *   slot      the player it is about, or -1 for a team-wide one
   *   kind, variant, variantId, color   that player's identity, for a preview
   *   title, text                       the headline ('text' is an alias)
   *   sub                               the second line
   *   t, duration, remaining            seconds elapsed / total / left
   *
   * One small object per event, which is a human-rate thing and not a hot loop.
   */
  function setCoopBanner(board, type, ship, title, sub) {
    board.downBanner = {
      type: type,
      slot: ship ? ship.slot : -1,
      kind: ship ? ship.kind : null,
      variant: ship ? ship.variant : 0,
      variantId: ship ? ship.variantId : '',
      color: ship ? accentFor(ship.slot) : PAL.danger,
      title: title,
      text: title,
      sub: sub,
      t: 0,
      duration: C.COOP_DOWN_BANNER_TIME,
      remaining: C.COOP_DOWN_BANNER_TIME
    };
  }

  /**
   * The PERSISTENT down marker (SPEC-COOP §5), rebuilt only when the down set
   * changes — never per frame.
   *
   * The banner above times out; this does not. It stays up for exactly as long
   * as somebody is down, it is visible to BOTH players, and it says what the
   * downed player is waiting for in words, because a player who died and sees
   * nothing at all concludes the game has hung. T.UI reads `board.downNotice`:
   *
   *   slot, kind, variant, variantId, color   who is down
   *   name     'PLAYER 2'
   *   title    'PLAYER 2 IS DOWN'
   *   sub      'CLEAR THE WAVE TO REVIVE THEM'
   *   waiting  'NEXT WAVE'  — the same words their HUD side shows
   *   text     the whole line, already joined
   */
  function refreshDownNotice(board) {
    if (!board.sharedHearts) { board.downNotice = null; return; }
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      if (!ship.down) continue;
      const current = board.downNotice;
      if (current && current.slot === ship.slot) return;   // already saying it
      const name = playerName(ship);
      const title = name + DOWN_TITLE_TAIL;
      board.downNotice = {
        slot: ship.slot,
        kind: ship.kind,
        variant: ship.variant,
        variantId: ship.variantId,
        color: accentFor(ship.slot),
        name: name,
        title: title,
        sub: DOWN_SUB,
        waiting: DOWN_WAIT,
        text: title + ' — ' + DOWN_SUB
      };
      return;
    }
    board.downNotice = null;
  }

  /**
   * This player is DOWN: out of the wave, but not out of the run.
   *
   * Called from finishDeath on a shared board, in place of the respawn every
   * other board does — so the death animation the player already knows plays
   * out in full first, and only then does the ship leave the field.
   *
   * Everything that could still act for them is put down with them: the live
   * shot, the fire buffer, the held trigger (so a button held at the moment
   * they died cannot come back as a stuck press when they are revived), and
   * their bacon embers. Their score, character, variant and weapon are the
   * only things they keep, which is exactly what §3 asks for.
   */
  function goDown(board, ship) {
    killShot(ship.shot);
    ship.shot = null;
    ship.down = true;
    ship.downT = 0;
    ship.downWaiting = DOWN_WAIT;
    ship.alive = false;
    ship.dead = false;
    ship.deathT = 0;
    ship.respawnT = 0;
    ship.spawnInvuln = 0;
    ship.reviveT = 0;
    ship.frame = 0;
    ship.fireT = 0;
    ship.fireHeld = false;
    ship.fireBufferT = 0;
    ship.pendingRespawn = false;
    clearTrail(board, ship);
    refreshDownNotice(board);

    // §2 rule 4 and rule 8: EVERYONE down is the one event that costs a heart,
    // and it is one event however many players arrived at it on the same frame.
    if (everyoneDown(board)) { spendHeart(board); return; }

    const partner = partnerOf(board, ship);
    setCoopBanner(board, 'down', ship, playerName(ship) + DOWN_TITLE_TAIL,
                  partner ? playerName(partner) + DOWN_SAVE_TAIL : DOWN_SUB);
    // Nobody left flying to shoot at: never let the bonus siren keep singing.
    if (!anyShipAlive(board)) killUfo(board);
  }

  /**
   * Put one downed player back on the line, mid-wave or at a wave start.
   *
   * The board is NOT touched: the formation stays exactly where it marched to,
   * the bunkers keep their damage and the bombs keep falling. That is the
   * point of §2 rule 4 — a heart buys the team its players back, not a reset.
   *
   * Audio is the caller's, so that two players revived by one heart make one
   * cue rather than two.
   */
  function reviveShip(board, ship) {
    ship.down = false;
    ship.downT = 0;
    ship.downWaiting = '';
    ship.dead = false;
    ship.deathT = 0;
    ship.fireBufferT = 0;
    // Back on the line the same way every other respawn is, so a revived ship
    // is in exactly the state the rest of this file already expects.
    respawnShip(board, ship);
    /* §3 states the revival invulnerability as T.C.SHIP_RESPAWN_DELAY rather
     * than the shorter window a plain respawn gets: you are being dropped into
     * a wave already in progress, with the formation wherever it had marched
     * to and bombs already in the air, which is a harsher place to arrive than
     * the top of a wave. C.COOP_REVIVE_TIME's spawn-in is deliberately well
     * inside it, so the materialise finishes while the ship is still
     * untouchable instead of fading in right up to the moment it can die. */
    ship.spawnInvuln = C.SHIP_RESPAWN_DELAY;
    ship.reviveT = C.COOP_REVIVE_TIME;
    /* §3: and you come back on your CHARACTER'S BASE WEAPON — the same rule
     * that already says dying loses your upgrade (SPEC-WEAPONS §5), stated
     * here so it is true of a revival on its own terms and not only because
     * the death that preceded it happened to do it first. A rotating gun goes
     * back to the head of its cycle with it (SPEC-BURRITO §1). */
    T.Weapons.revert(ship);
    cycleReset(ship);
    burst(board, ship.x + ship.w / 2, ship.y + ship.h / 2, fx('chrome'));
    rumble(ship.slot, 200, 0.25, 0.7);
  }

  /** Revive everyone who is down, with ONE cue. Returns how many came back. */
  function reviveAllDown(board) {
    let n = 0;
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      if (!ship.down) continue;
      reviveShip(board, ship);
      n++;
    }
    if (n > 0) sfx('revive');
    refreshDownNotice(board);
    return n;
  }

  /**
   * Everyone is down at once — the ONE moment in this mode that costs the team
   * something (SPEC-COOP §2 rule 4).
   *
   * Minus one heart, and the same instant hands both players back mid-wave.
   * Spending the LAST heart is instead the end of the run: §2 rule 6, "game
   * over when the team is on its last heart and everyone goes down together".
   */
  function spendHeart(board) {
    board.hearts = Math.max(0, board.hearts - 1);
    board.heartFlashT = C.COOP_HEART_FLASH_TIME;
    syncHearts(board);
    sfx('heartLost');
    for (let i = 0; i < board.ships.length; i++) {
      rumble(board.ships[i].slot, 420, 1, 0.7);
    }

    if (board.hearts <= 0) {
      for (let i = 0; i < board.ships.length; i++) {
        const ship = board.ships[i];
        ship.down = false;
        ship.downWaiting = '';
        ship.reviveT = 0;
        ship.alive = false;
        ship.dead = false;
        ship.out = true;
        killShot(ship.shot);
        ship.shot = null;
      }
      endBoard(board);          // takes the banner and the marker down with it
      return;
    }

    reviveAllDown(board);
    setCoopBanner(board, 'heart', null, HEART_TITLE, HEART_SUB);
  }

  /* -------------------------------------------------------------------------
   * DEATH / RESPAWN / TURN FLOW
   * ---------------------------------------------------------------------- */
  function hitShip(board, ship) {
    ship.alive = false;
    ship.dead = true;
    ship.deathT = 0;
    ship.frame = 0;
    ship.fireT = 0;
    ship.fireHeld = false;
    killShot(ship.shot);
    // SPEC-CHARACTERS §3: a burnt-out player leaves no minefield behind — only
    // THIS ship's embers go out, so a co-op partner keeps theirs burning.
    clearTrail(board, ship);
    // SPEC-WEAPONS §5: an upgrade is LOST on death — that is the cost of dying.
    // Reverting also drops any lance or beam the ship was holding up, so the
    // microwave hum stops on the same frame the ship burns.
    T.Weapons.revert(ship);
    // SPEC-BURRITO §1: and the rotating gun goes back to the head of its
    // cycle. Stated here rather than left to the revert above, because "resets
    // on death" is a rule of THIS file's death flow: an upgrade running dry or
    // a token being caught happens to a living ship and keeps its position.
    cycleReset(ship);
    /* SPEC-COOP §2 rule 2: on a two-player co-op board a death COSTS NOTHING.
     * It puts you down (finishDeath, once the animation has played out), and
     * the team only pays if your partner goes down as well — so nothing is
     * decremented here. Every other board spends a life exactly as it always
     * has, which is what keeps 1P co-op and classic untouched. */
    if (!board.sharedHearts) ship.lives = Math.max(0, ship.lives - 1);
    syncHearts(board);

    boom(board, ship.x + ship.w / 2, ship.y + ship.h / 2);
    burst(board, ship.x + ship.w / 2, ship.y + ship.h / 2, fx('burnt'));
    sfx('playerDie');
    rumble(ship.slot, 340, 0.9, 0.6);

    // Never let the bonus siren keep singing over an empty board.
    if (!anyShipAlive(board)) killUfo(board);
  }

  function respawnShip(board, ship) {
    ship.alive = true;
    ship.dead = false;
    ship.deathT = 0;
    ship.respawnT = 0;
    ship.spawnInvuln = SPAWN_INVULN;
    ship.frame = 0;
    ship.fireT = 0;
    ship.fireHeld = false;
    ship.shot = null;
    ship.pendingRespawn = false;
    ship.x = spawnX(ship.slot, board.ships.length);
    ship.y = C.SHIP_Y;
  }

  /** Called once the death animation has finished playing out. */
  function finishDeath(board, ship) {
    ship.dead = false;
    ship.deathT = 0;

    /* SPEC-COOP §2 rules 2 and 3: a two-player co-op death ends here — the
     * player goes DOWN for the rest of the wave instead of respawning, and
     * comes back either when the next wave starts or when their partner goes
     * down too. goDown owns both of those, including the heart. */
    if (board.sharedHearts) { goDown(board, ship); return; }

    if (ship.lives > 0) {
      if (Game.session && Game.session.mode === 'classic') {
        // Faithful alternating turns: this player steps aside for the other.
        ship.alive = false;
        ship.pendingRespawn = true;
        endClassicTurn(board);
      } else {
        respawnShip(board, ship);
      }
      return;
    }

    ship.out = true;
    ship.alive = false;
    if (Game.session && Game.session.mode === 'classic') {
      endBoard(board);
    } else if (allShipsOut(board)) {
      endBoard(board);
    }
  }

  /** This board is finished — hold a beat, then swap turns or end the game. */
  function endBoard(board) {
    if (board.over) return;
    board.over = true;
    board.endT = BOARD_END_WAIT;
    board.clearT = 0;
    killUfo(board);
    clearShots(board);      // also silences any beam still humming
    clearPickups(board);
    // The pickup banner is only ticked by updateBooms, which stops running the
    // moment the state leaves 'play'. A token caught in the last beat before a
    // game over would otherwise leave its banner painted over the score card
    // for as long as that screen is up, so the board takes it down with it.
    board.pickup = null;
    // Same for the co-op furniture (SPEC-COOP §5): nobody is waiting to be
    // revived once the board is finished, and a "CLEAR THE WAVE TO REVIVE
    // THEM" marker left painted over the score card is worse than none at all.
    board.downBanner = null;
    board.downNotice = null;
    marchStop();
  }

  function boardFinished(board) {
    if (Game.session && Game.session.mode === 'classic') {
      nextClassicTurn();
    } else {
      gameOver();
    }
  }

  /** Index of the next classic board whose player can still play, or -1. */
  function nextPlayableIndex(from) {
    const s = Game.session;
    if (!s) return -1;
    const n = s.boards.length;
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      const b = s.boards[idx];
      if (b.over) continue;
      const ship = b.ships[0];
      if (ship && !ship.out && ship.lives > 0) return idx;
    }
    return -1;
  }

  /** Classic: the current player died but still has lives — pass the turn on. */
  function endClassicTurn(board) {
    const s = Game.session;
    const idx = nextPlayableIndex(s.turn);
    killUfo(board);
    if (idx < 0 || idx === s.turn) {
      // Nobody else to hand over to: this player simply comes back.
      respawnShip(board, board.ships[0]);
      return;
    }
    switchToBoard(idx);
  }

  /** Classic: the current board is over for good — hand over or end the game. */
  function nextClassicTurn() {
    const s = Game.session;
    const idx = nextPlayableIndex(s.turn);
    if (idx < 0) { gameOver(); return; }
    switchToBoard(idx);
  }

  function switchToBoard(idx) {
    const s = Game.session;
    s.turn = idx;
    const board = s.boards[idx];
    Game.board = board;

    const ship = board.ships[0];
    if (ship && ship.pendingRespawn) respawnShip(board, ship);

    enterBanner('PLAYER ' + ((ship ? ship.slot : 0) + 1),
                'WAVE ' + board.wave, PLAYER_BANNER_TIME, false);
  }

  /* -------------------------------------------------------------------------
   * WAVE FLOW
   * ---------------------------------------------------------------------- */
  function checkWaveClear(board) {
    if (board.aliveCount > 0 || board.clearT > 0 || board.over) return;
    board.clearT = WAVE_CLEAR_WAIT;
    board.bombs.length = 0;
    killUfo(board);
    clearShots(board);
    clearPickups(board);
  }

  function startNextWave(board) {
    board.wave += 1;
    // SPEC-BURRITO §2: BEING IN WAVE 5 IS THE WHOLE CONDITION. This is the
    // line the wave counter becomes 5 on, so the unlock is checked on the very
    // next one — before the formation is rebuilt, before the banner, before
    // the player has had a chance to die in it. Nothing else is required and
    // nothing later can take it back: it is written to storage here.
    checkSecretUnlock(board);
    board.bombs.length = 0;
    board.bombT = C.BOMB_COOLDOWN;
    board.bombType = 0;
    board.ufoT = U.randRange(C.UFO_MIN_GAP, C.UFO_MAX_GAP);
    board.clearT = 0;
    killUfo(board);
    // SPEC-WEAPONS §5: an upgrade is KEPT across a wave change — it feels much
    // better than being stripped for winning — but the field is swept clean.
    clearShots(board);
    clearPickups(board);
    board.pickup = null;
    buildFormation(board);
    restoreBunkers(board);

    let revived = 0;
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      if (ship.out) continue;
      ship.fireHeld = false;

      /* SPEC-COOP §2 rules 3 and 5 — THE HEADLINE RULE. Your partner cleared
       * the wave without you, so you are back and the team paid NOTHING. This
       * is the whole point of the mechanic: a good partner makes your death
       * free, and the heart count on either side of this line is the same.
       *
       * A ship still burning through its death animation as the wave turned
       * over comes back with them. It was going to be put DOWN a frame or two
       * later, and being down for the whole of a wave you were alive for when
       * it started is exactly the "my game has hung" feeling §5 exists to
       * prevent. On any other board a ship dying across a wave change keeps
       * dying and respawns on its own clock, exactly as it always has. */
      if (board.sharedHearts && (ship.down || ship.dead)) {
        reviveShip(board, ship);
        revived++;
        continue;
      }

      if (!ship.dead) {
        ship.alive = true;
        ship.spawnInvuln = SPAWN_INVULN;
        ship.x = spawnX(ship.slot, board.ships.length);
        ship.y = C.SHIP_Y;
      }
    }
    if (revived > 0) sfx('revive');
    refreshDownNotice(board);

    enterBanner('WAVE ' + board.wave, '', WAVE_BANNER_TIME, true);
  }

  /* -------------------------------------------------------------------------
   * THE SECRET UNLOCK  (SPEC-BURRITO.md §2)
   *
   * A board has reached a new wave. If that wave reveals a secret character,
   * unlock it — ONCE, EVER — and queue the reveal.
   *
   * The condition is the wave number and nothing else. Not clearing it, not
   * surviving it, not a score, not a mode, not a character, not both players:
   * this runs on the frame the counter moves, from the ONE place it moves, so
   * every route to wave 5 is covered by construction. In classic mode each
   * player owns a board and its own wave counter, which is exactly what makes
   * "either player reaching wave 5 counts" fall out for free.
   *
   * T.Util.unlock() persists AND answers true only on the call that changed
   * the set, so this fires the banner and the fanfare exactly once per device
   * and stays silent for a player who unlocked him three sessions ago. A
   * device that cannot persist unlocks for the session; that is T.Util's
   * promise and this file does not second-guess it.
   * ---------------------------------------------------------------------- */
  function checkSecretUnlock(board) {
    if (!board || typeof U.unlock !== 'function') return;
    for (const id in SECRET_WAVE_BY_KIND) {
      if (board.wave < SECRET_WAVE_BY_KIND[id]) continue;
      if (!U.unlock(id)) continue;         // already earned: no banner, no cue
      refreshVisibleOrder();               // he exists to the select screen now
      startReveal(id);
    }
  }

  /**
   * Queue the reveal banner for a character that has just been unlocked.
   *
   * game.js owns the STATE and the CLOCK; ui.js owns every pixel of it and
   * reads `T.Game.reveal`, whose fields are the same shape as the wave banner
   * and the weapon pickup banner it already draws:
   *
   *     id, kind      the character (a real T.C.BASE_WEAPONS row id)
   *     title, text   'SECRET UNLOCKED'  (`text` is an alias, as Game.banner)
   *     name          his display name, 'BURRITO'
   *     sub           the line telling the player where to find him
   *     weapon, blurb his HUD weapon name and roster blurb
   *     color         his roster colour
   *     sprite        his ship sprite
   *     lifeIcon      his half-size life icon
   *     t, duration, remaining   seconds elapsed / total / left
   *     started       false until the banner is actually on screen
   *
   * The life icon is `lifeIcon` and NOT `life`, which is the obvious name for
   * it: ui.js reads this object with a name-probe, and its duration probe asks
   * for 'life' BEFORE 'duration' (a `life` of seconds-remaining is what most
   * of the game's own timed objects call it). A `life` holding a SPRITE NAME
   * therefore shadows the duration stated two lines below it, and ui.js falls
   * back to its own 2.5s — silently identical today, and silently wrong the
   * first time REVEAL_BANNER_TIME is tuned to anything else. One field, one
   * meaning, and the clock this file owns is the clock ui.js draws.
   *
   * It is NOT drawn until `started`, and `started` does not become true until
   * the game is back in 'play' — the counter moves under the "WAVE 5" banner,
   * and a reveal that burned its 2.5s behind another banner would be a reveal
   * the player never saw. The fanfare goes with the pixels for the same
   * reason. From there it is pure presentation: it never pauses the game,
   * never touches a board, and cannot obscure the formation for longer than
   * its own duration because updateReveal only ever counts play time.
   */
  function startReveal(id) {
    const row = charRow(id);
    const name = (row && row.char) || id;
    Game.reveal = {
      id: id,
      kind: id,
      title: REVEAL_TITLE,
      text: REVEAL_TITLE,
      name: name,
      sub: name + REVEAL_SUB_TAIL,
      weapon: (row && row.weapon) || '',
      blurb: (row && row.blurb) || '',
      color: (row && row.color) || PAL.ui,
      sprite: (row && row.ship) || null,
      lifeIcon: (row && row.life) || null,
      t: 0,
      duration: REVEAL_BANNER_TIME,
      remaining: REVEAL_BANNER_TIME,
      started: false
    };
  }

  /**
   * The reveal banner's clock — play time only.
   *
   * Held back until the state is 'play' so the banner lands over the play
   * field rather than behind the wave banner that fired it, and frozen again
   * by a pause or a classic turn swap, so the 2.5s the player gets is 2.5s of
   * the formation being covered and no more. It changes no board state and no
   * ship state: a game that ignored T.Game.reveal entirely would play
   * identically, frame for frame.
   */
  function updateReveal(dt) {
    const r = Game.reveal;
    if (!r || Game.state !== 'play') return;
    if (!r.started) {
      r.started = true;
      sfx('unlockSecret');
    }
    r.t += dt;
    r.remaining = Math.max(0, r.duration - r.t);
    if (r.t >= r.duration) Game.reveal = null;
  }

  function updateBooms(board, dt) {
    const list = board.booms;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active) continue;
      b.t += dt;
      if (b.t >= BOOM_TIME) b.active = false;
    }
    const pops = board.popups;
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      if (!p.active) continue;
      p.t += dt;
      p.y -= 22 * dt;
      if (p.t >= POPUP_TIME) p.active = false;
    }

    // The weapon pickup banner is on the same clock: it must keep running while
    // the board is ending or the wave beat is playing out, and this is the one
    // FX pass every branch of updatePlay calls.
    const pick = board.pickup;
    if (pick) {
      pick.t += dt;
      pick.remaining = Math.max(0, pick.duration - pick.t);
      if (pick.t >= pick.duration) board.pickup = null;
    }

    /* SPEC-COOP §4 and §5: the down / heart banner and the heart-row flash run
     * on that same clock, for the same reason — they must keep running while
     * the board is ending or the wave beat is playing out, and this is the one
     * FX pass every branch of updatePlay calls. The PERSISTENT down marker is
     * deliberately NOT on a clock: it stays up until its player is revived. */
    const down = board.downBanner;
    if (down) {
      down.t += dt;
      down.remaining = Math.max(0, down.duration - down.t);
      if (down.t >= down.duration) board.downBanner = null;
    }
    if (board.heartFlashT > 0) {
      board.heartFlashT = Math.max(0, board.heartFlashT - dt);
    }
  }

  /* =========================================================================
   * STATE MACHINE
   * ====================================================================== */
  let lastTempo = -1;

  function toTitle() {
    Game.state = 'title';
    clearAllTrails();        // no board survives this, so nothing keeps burning
    Game.session = null;
    Game.board = null;
    Game.banner = null;
    // A reveal belongs to the board it fired on; nothing carries over to the
    // title screen but the unlock itself, which is already in storage.
    Game.reveal = null;
    Game.quitConfirm = false;
    // The attract loop and the select screen behind it must agree about who
    // exists, and a player quitting straight out of the wave they unlocked him
    // on is the one moment that can have changed since the last look.
    refreshVisibleOrder();
    marchStop();
    sirenStop();
    // Hand every projectile in the pool back: no board owns them now, and any
    // beam still holding the microwave hum lets go on the way out.
    T.Weapons.releaseAllShots();
    lastTempo = -1;
    if (hiDirty) persistHi();
  }

  /* -------------------------------------------------------------------------
   * SELECT-SCREEN PICKS  (SPEC-CHARACTERS §4, SPEC-VARIANTS §5)
   *
   * A pick is a character AND a variant of it, and the two always travel
   * together: through the carousel, into the session, onto the ship, and out
   * to localStorage so a player comes back to the version they last played.
   * ---------------------------------------------------------------------- */

  /* One key per player, per SPEC-VARIANTS §5. Storage is best-effort — file://
   * and private mode throw, and T.Util wraps both directions — so a failed
   * read or write only ever costs the player their remembered pick. */
  const PICK_KEYS = ['toasterInvaders.p1', 'toasterInvaders.p2'];

  /* The two controls this screen advertises, named here because this file is
   * the one that binds them (see updateSelect). ui.js prints them verbatim. */
  const SELECT_VARIANT_HINT = 'START';
  const SELECT_MODE_HINT    = 'UP/DOWN';

  /**
   * Point a select-screen player at a character + variant, keeping every
   * derived field in step: `kind` and `variant` are the source of truth,
   * `index` is the carousel position and `variantId` is the `<kind>.<n>` id.
   * Both are normalised here, so nothing downstream can be handed a character
   * that is not on the roster or a variant that character does not have.
   */
  function setPick(p, kind, variant) {
    // normalizeVisibleKind, not normalizeKind: this is the one funnel every
    // select-screen pick goes through, so it is the one place that has to be
    // sure a player can never be pointed at a character that is still a secret
    // (SPEC-BURRITO §2).
    p.kind = normalizeVisibleKind(kind);
    p.index = charIndex(p.kind);
    p.variant = normalizeVariant(p.kind, variant);
    p.variantId = variantIdOf(p.kind, p.variant);
  }

  /**
   * SPEC-VARIANTS §5: when both players land on the same character, DIFFERENT
   * variants are the primary way they tell each other apart on the board — so
   * P2 defaults one variant along rather than becoming P1's twin.
   *
   * Applied when P2 ARRIVES somewhere (joining, or browsing onto P1's
   * character), never when P2 works the variant picker: a player who
   * deliberately chooses the same skin as P1 is allowed to have it.
   */
  function separateFromP1(sel, p) {
    if (!sel || !p || p.slot !== 1) return;
    const p1 = sel.players[0];
    if (!p1 || !p1.joined) return;
    if (p1.kind !== p.kind || p1.variant !== p.variant) return;
    setPick(p, p.kind, cycleVariant(p.kind, p.variant, 1));
  }

  /* -------------------------------------------------------------------------
   * THE FIVE SELECT-SCREEN ACTIONS  (SPEC-TOUCHUI.md §2)
   *
   * Joining, readying, choosing a character, choosing a variant and choosing
   * the game mode are the only things this screen does. There are now TWO ways
   * to ask for each of them — a button edge (updateSelect, below) and a tap on
   * the thing itself (uiTap, at the bottom of this file) — so each one is a
   * function here, called by both, rather than a body in updateSelect and a
   * parallel copy in uiTap that drifts away from it.
   *
   * Each holds the STATE CHANGE and the audio cue and nothing else. Consuming
   * an input edge is the button path's business — it exists to stop the very
   * press that joined a player from also readying them up in the same frame,
   * and a tap has no edge to consume — so those calls stay in updateSelect.
   * ---------------------------------------------------------------------- */

  /** This seat takes a controller. SPEC-VARIANTS §5: P2 arriving steps aside. */
  function joinPlayer(sel, p) {
    p.joined = true;
    p.ready = false;
    separateFromP1(sel, p);
    sfx('uiConfirm');
  }

  /** Lock this player in. Everyone joined being ready is what starts the game. */
  function readyPlayer(p) {
    p.ready = true;
    sfx('uiConfirm');
  }

  /**
   * Put this player on `kind`, keeping their variant.
   *
   * ARRIVING somewhere is what separateFromP1 keys off, and browsing the
   * carousel, tapping a roster icon and tapping a chevron are all arrivals —
   * so P2 landing on P1's exact version steps one skin along in all three
   * cases, and in none of them is P1 touched.
   */
  function pickCharacter(sel, p, kind) {
    setPick(p, kind, p.variant);
    separateFromP1(sel, p);
    sfx('uiMove');
  }

  /**
   * Put this player on variant `variant` of the character they are already on.
   *
   * NEVER second-guessed by separateFromP1: this is the player's own choice of
   * skin, and if they want to be the same jam as P1 they are allowed to be.
   * The caller decides WHICH variant — START steps to the next one, a tap names
   * one outright — and this only ever applies it.
   */
  function pickVariant(p, variant) {
    setPick(p, p.kind, variant);
    sfx('uiMove');
  }

  /** Set the game mode for BOTH players. §9: co-op or classic, nothing else. */
  function pickMode(sel, mode) {
    sel.mode = mode;
    sfx('uiMove');
  }

  /**
   * A remembered pick for this seat, falling back to its default character.
   *
   * This is the ONE place a character id arrives from outside the game, so it
   * is the one place that has to distrust it: isPickable() rather than a bare
   * roster lookup, because
   *   - a stored kind of "toString" or "constructor" would otherwise pass
   *     every guard in this file (see IS_KIND), and
   *   - a stored kind of "burrito" is a REAL roster row, so nothing else in
   *     this file would refuse it — and a player who unlocked him on a device
   *     that then cleared its storage, or who copied a save across, would be
   *     handed a character the carousel is currently pretending does not
   *     exist. That seat falls back to its default character instead
   *     (SPEC-BURRITO §2).
   */
  function loadPick(slot, fallbackKind) {
    const raw = U.storeGet(PICK_KEYS[slot], null);
    let kind = fallbackKind;
    let variant = 0;
    if (raw && typeof raw === 'object') {
      if (isPickable(raw.kind)) kind = raw.kind;
      if (typeof raw.variant === 'number') variant = raw.variant;
    } else if (isPickable(raw)) {
      kind = raw;                       // a save written before variants existed
    }
    kind = normalizeVisibleKind(kind);
    return { kind: kind, variant: normalizeVariant(kind, variant) };
  }

  /** Remember what each joined player took into this session. */
  function savePicks(sel) {
    if (!sel) return;
    for (let i = 0; i < sel.players.length && i < PICK_KEYS.length; i++) {
      const p = sel.players[i];
      if (!p.joined) continue;
      U.storeSet(PICK_KEYS[p.slot], { kind: p.kind, variant: p.variant });
    }
  }

  function enterSelect() {
    Game.state = 'select';
    Game.banner = null;
    // SPEC-BURRITO §2: the carousel is rebuilt on the way in, so a secret
    // unlocked in the game that just ended is on this screen the moment the
    // player walks back onto it — and one that has not been earned is not on
    // it at all, in any form, not even as a gap.
    refreshVisibleOrder();
    // SPEC-CHARACTERS §4: the two panels are now windows onto a NINE-character
    // carousel. `kind` stays the source of truth (it is what ui.js and the
    // session read); `index` is its position in T.C.CHARACTER_ORDER, carried
    // alongside so the carousel can render without searching for it.
    //
    // SPEC-VARIANTS §5: and each player now also carries the VARIANT of that
    // character — `variant`, the index 0..2, with `variantId` beside it. Both
    // seats open on whatever that player last took into a game.
    const p1 = loadPick(0, KIND_DEFAULT);
    const p2 = loadPick(1, KIND_P2);
    const players = [
      { slot: 0, joined: true,  kind: p1.kind, index: 0, variant: 0, variantId: '', ready: false },
      { slot: 1, joined: false, kind: p2.kind, index: 0, variant: 0, variantId: '', ready: false }
    ];
    Game.select = {
      mode: 'coop',                   // §9: co-op is the default
      t: 0,
      /* The carousel, in roster order — and ONLY the characters this player
       * has earned the right to see (SPEC-BURRITO §2). This is the array
       * ui.js must browse and must COUNT: nine while burrito is locked, ten
       * once he is not. It is the same array object for the life of the page,
       * rebuilt in place, so reading it every frame allocates nothing. */
      order: visibleOrder,
      players: players,
      // This file owns the select-screen bindings, so it NAMES them: ui.js
      // prints these strings verbatim wherever the screen tells a player which
      // control moves what. Change the binding below and the labels follow;
      // the binding is never written down twice.
      variantHint: SELECT_VARIANT_HINT,
      modeHint: SELECT_MODE_HINT
    };
    setPick(players[0], p1.kind, p1.variant);
    setPick(players[1], p2.kind, p2.variant);
    // Two remembered picks can be the same version; P2 steps aside.
    separateFromP1(Game.select, players[1]);
  }

  function startSession() {
    const sel = Game.select;
    const slots = [];
    const kinds = {};
    const variants = {};
    for (let i = 0; i < sel.players.length; i++) {
      const p = sel.players[i];
      if (!p.joined) continue;
      slots.push(p.slot);
      // The carousel hands over a character id AND a variant index; both are
      // carried straight into ship creation. The character is what picks the
      // base weapon (SPEC-CHARACTERS §6); the variant is what picks the skin
      // that weapon wears (SPEC-VARIANTS §1) and nothing else.
      kinds[p.slot] = normalizeKind(p.kind);
      variants[p.slot] = normalizeVariant(kinds[p.slot], p.variant);
    }
    if (slots.length === 0) {
      slots.push(0);
      kinds[0] = KIND_DEFAULT;
      variants[0] = 0;
    }

    // SPEC-VARIANTS §5: remember each player's character + variant for next time.
    savePicks(sel);

    // One player is simply co-op with a single ship.
    const mode = (sel.mode === 'classic' && slots.length > 1) ? 'classic' : 'coop';

    const session = {
      mode: mode,
      slots: slots,
      kinds: kinds,
      variants: variants,
      boards: [],
      turn: 0,
      over: false,
      startedAt: Game.time
    };

    if (mode === 'classic') {
      for (let i = 0; i < slots.length; i++) {
        session.boards.push(createBoard([slots[i]], 1, kinds, variants, mode));
      }
    } else {
      session.boards.push(createBoard(slots, 1, kinds, variants, mode));
    }

    Game.session = session;
    Game.board = session.boards[0];
    Game.quitConfirm = false;

    const sub = mode === 'classic' ? 'PLAYER ' + (slots[0] + 1) : '';
    enterBanner('WAVE 1', sub, WAVE_BANNER_TIME, true);
  }

  /**
   * Show a full-screen banner ('wave' state) for `duration` seconds, then drop
   * back into play. Used for both "WAVE n" and the classic "PLAYER n" swap.
   */
  function enterBanner(text, sub, duration, waveSound) {
    Game.state = 'wave';
    Game.banner = {
      text: text,
      title: text,       // alias, so UI can read either name
      sub: sub || '',
      t: 0,
      duration: duration,
      remaining: duration
    };
    marchStop();
    sirenStop();
    // The board freezes behind the banner, so nothing may be left holding a
    // lance up or a beam humming across it — and a half-played pickup banner
    // must not thaw out on top of a later wave (or a later classic turn), since
    // nothing ticks it down while the board is frozen.
    if (Game.board) {
      dropAttached(Game.board);
      Game.board.pickup = null;
      // The co-op down/heart banner is on the same clock and goes for the same
      // reason: nothing ticks it while the board is frozen, so a half-played
      // one would thaw out on top of the wave the player is trying to read.
      // The persistent marker is untouched — a player who is still down is
      // still down, and by here startNextWave has already brought them back.
      Game.board.downBanner = null;
    }
    lastTempo = -1;
    if (waveSound) sfx('waveStart');
  }

  function enterPlay() {
    Game.state = 'play';
    Game.banner = null;
    Game.quitConfirm = false;
    const board = Game.board;
    if (board) {
      board.stepInterval = U.stepInterval(board.aliveCount, board.wave);
      lastTempo = board.stepInterval;
      marchTempo(board.stepInterval);
      marchStart();
      if (board.ufo) sirenStart();
    }
  }

  function enterPause() {
    if (Game.state !== 'play') return;
    Game.state = 'pause';
    Game.quitConfirm = false;
    marchStop();
    sirenStop();
    // A held lance or beam would otherwise hang in the air humming over a
    // frozen board; everything else is left exactly where the player left it.
    if (Game.board) dropAttached(Game.board);
    sfx('uiConfirm');
  }

  function gameOver() {
    if (Game.session) Game.session.over = true;
    Game.state = 'over';
    Game.banner = null;
    // Dying inside the reveal still unlocks him (that is written and done) —
    // but his banner does not get to sit on top of the score card.
    Game.reveal = null;
    marchStop();
    sirenStop();
    T.Weapons.releaseAllShots();     // nothing keeps humming over the score card
    // ...and no bacon embers keep smouldering behind it either: in classic
    // mode the boards the loser is not standing on still hold their own trail.
    clearAllTrails();
    lastTempo = -1;
    sfx('gameOver');
    persistHi();
  }

  /* ---------------------------- per-state update ------------------------ */

  /**
   * Leave the title for the select screen — the one thing the title screen
   * does, whether it was asked for with START, with a keyboard, or with a tap
   * anywhere on the canvas (SPEC-TOUCHUI §3).
   *
   * The edge is consumed on the way out either way: 'select' reads START too,
   * and a press that survives this frame would join a player with the same
   * push that opened the screen.
   */
  function startFromTitle() {
    consumeAll('start');
    sfx('uiConfirm');
    enterSelect();
  }

  function updateTitle() {
    if (anyPressed('start')) startFromTitle();
  }

  function updateSelect(dt) {
    const sel = Game.select;
    if (!sel) { enterSelect(); return; }
    sel.t += dt;

    for (let i = 0; i < sel.players.length; i++) {
      const p = sel.players[i];
      const pd = pad(p.slot);
      if (!pd) continue;

      if (!p.joined) {
        if (pd.startPressed || pd.firePressed) {
          // SPEC-VARIANTS §5: a player joining onto the other one's exact
          // version steps one skin along, so they can tell each other apart.
          joinPlayer(sel, p);
          if (T.Input && T.Input.consume) {
            T.Input.consume(p.slot, 'start');
            T.Input.consume(p.slot, 'fire');
          }
        }
        continue;
      }

      if (p.ready) {
        if (pd.backPressed) {
          p.ready = false;
          sfx('uiBack');
          if (T.Input && T.Input.consume) T.Input.consume(p.slot, 'back');
        }
        continue;
      }

      // FIRE IS TESTED FIRST, and it ends this player's turn in the loop.
      // §5 makes W a P1 fire key and ArrowUp a P2 fire key, and input.js also
      // binds those same two codes to 'up' so menus are drivable from the
      // keyboard. A keyboard player readying up therefore arrives here with
      // firePressed AND upPressed set from ONE keypress — handling both would
      // silently flip the game mode every time somebody locked in. Fire wins
      // (the spec names it; the up/down mode binding is ours), and the up/down
      // edges are consumed so nothing downstream acts on them either. KeyS /
      // ArrowDown stay a collision-free way to change the mode on a keyboard.
      if (pd.firePressed) {
        readyPlayer(p);
        if (T.Input && T.Input.consume) {
          T.Input.consume(p.slot, 'fire');
          T.Input.consume(p.slot, 'up');
          T.Input.consume(p.slot, 'down');
        }
        continue;
      }

      // SPEC-CHARACTERS §4: left/right BROWSE the nine-character carousel and
      // Y cycles forward through it. Each player browses independently, and
      // two players may happily land on the same character — which is exactly
      // when the variant below starts to matter.
      let step = 0;
      if (pd.leftPressed) step -= 1;
      if (pd.rightPressed) step += 1;
      if (pd.altCharPressed) step += 1;
      if (step !== 0) {
        // Arriving on P1's character: take the next skin along, so the two
        // ships are never the same colour by accident (SPEC-VARIANTS §5).
        pickCharacter(sel, p, cycleKind(p.kind, step));
      }

      /* SPEC-VARIANTS §5: the variant picker — START steps through this
       * character's three skins, live, with the preview, the name and the
       * flavour line changing under the player's thumb.
       *
       * §5 asks for up/down or LB/RB. Every one of those is spoken for:
       *   - LB/RB are not in the input contract at all. SPEC.md §5 gives
       *     input.js no shoulder bindings and no keyboard codes for them, so
       *     a picker on LB/RB would not exist for a keyboard player.
       *   - UP/DOWN is the shipped GAME MODE selector, and the ONLY way to
       *     reach CLASSIC on either a pad or a keyboard.
       *   - Y is SPEC-CHARACTERS §4's second way to step the nine-character
       *     carousel, and A and B are READY and BACK.
       * Taking any of them would cost a control the game already ships and the
       * regression suite already drives. START is the one edge a joined player
       * has spare — it does nothing at all on this screen once you are in —
       * and it exists on both pads and both keyboards, so all four ways of
       * playing can reach the picker. ui.js labels it.
       *
       * This is the player's OWN choice, so it is never second-guessed by the
       * P2 tie-breaker: if you want to be the same jam as P1, be the same jam.
       *
       * SPEC-TOUCHUI §3: on a touchscreen you tap the thumbnail you want and
       * get THAT skin, which is the same pickVariant with the index named
       * outright instead of stepped. START is unchanged for everyone on a pad
       * or a keyboard — the tap ADDS a way in, it does not take this one away. */
      if (pd.startPressed) {
        pickVariant(p, cycleVariant(p.kind, p.variant, 1));
        if (T.Input && T.Input.consume) T.Input.consume(p.slot, 'start');
      }

      // Up / down flips the game mode for everyone.
      if (pd.upPressed || pd.downPressed) {
        pickMode(sel, sel.mode === 'coop' ? 'classic' : 'coop');
      }
      if (pd.backPressed) {
        if (p.slot === 1) {
          p.joined = false;               // P2 drops out
          sfx('uiBack');
        } else {
          sfx('uiBack');
          consumeAll('back');
          toTitle();
          return;
        }
        if (T.Input && T.Input.consume) T.Input.consume(p.slot, 'back');
      }
    }

    // Everyone who joined has readied up → play.
    let joined = 0;
    let ready = 0;
    for (let i = 0; i < sel.players.length; i++) {
      if (sel.players[i].joined) { joined++; if (sel.players[i].ready) ready++; }
    }
    if (joined > 0 && joined === ready) {
      consumeAll('fire');
      consumeAll('start');
      startSession();
    }
  }

  function updateWave(dt) {
    const b = Game.banner;
    if (!b) { enterPlay(); return; }
    b.t += dt;
    b.remaining = Math.max(0, b.duration - b.t);
    if (b.t >= b.duration) enterPlay();
  }

  function updatePause() {
    if (Game.quitConfirm) {
      if (anyPressed('fire') || anyPressed('start')) {
        consumeAll('fire');
        consumeAll('start');
        sfx('uiConfirm');
        toTitle();
      } else if (anyPressed('back')) {
        consumeAll('back');
        Game.quitConfirm = false;
        sfx('uiBack');
      }
      return;
    }
    if (anyPressed('start')) {
      consumeAll('start');
      enterPlay();
    } else if (anyPressed('back')) {
      consumeAll('back');
      Game.quitConfirm = true;
      sfx('uiBack');
    }
  }

  function updateOver() {
    if (anyPressed('start') || anyPressed('fire')) {
      consumeAll('start');
      consumeAll('fire');
      sfx('uiConfirm');
      toTitle();
    }
  }

  function updatePlay(dt) {
    const board = Game.board;
    if (!board) { toTitle(); return; }

    if (anyPressed('start')) {
      consumeAll('start');
      enterPause();
      return;
    }

    // The board has ended: let the debris settle before moving on.
    if (board.over) {
      board.endT -= dt;
      updateBooms(board, dt);
      if (board.particles && board.particles.update) board.particles.update(dt);
      if (board.endT <= 0) boardFinished(board);
      return;
    }

    // Wave cleared: a short beat, then the next formation.
    if (board.clearT > 0) {
      board.clearT -= dt;
      updateShips(board, dt);
      updateShots(board, dt);
      updateBooms(board, dt);
      if (board.particles && board.particles.update) board.particles.update(dt);
      if (Game.state !== 'play') return;
      // The last ship can finish dying DURING the clear beat (its 1.6s death
      // animation outlives the 0.9s pause). The board is finished at that
      // point, so never spin up a fresh wave on top of it.
      if (board.over) return;
      if (board.clearT <= 0) startNextWave(board);
      return;
    }

    updateShips(board, dt);                 // 1 + 2
    if (Game.state !== 'play') return;      // a classic turn swap may have fired
    if (board.over) return;                 // last ship just died: freeze the board
    updateShots(board, dt);                 // 3
    updateBombs(board, dt);
    updateFormation(board, dt);             // 4
    updateUfo(board, dt);                   // 5
    updateCrate(board, dt);                 // 5b
    updateToken(board, dt);                 // 5c
    updateBombSpawn(board, dt);             // 6
    resolveCollisions(board);               // 7
    checkWaveClear(board);                  // 8
    updateBooms(board, dt);
    if (board.particles && board.particles.update) board.particles.update(dt);  // 9
  }

  /* =========================================================================
   * RENDER
   * ====================================================================== */
  function renderBunkers(ctx, board) {
    for (let i = 0; i < board.bunkers.length; i++) {
      const b = board.bunkers[i];
      if (T.Entities.bunkerIsGone(b)) continue;
      if (b.canvas) ctx.drawImage(b.canvas, Math.round(b.x), Math.round(b.y));
      else blit(ctx, 'bunker', b.x, b.y);
    }
  }

  function renderEnemies(ctx, board) {
    const wing = C.FRAME_CYCLE[board.frameIdx % C.FRAME_CYCLE.length];
    // SPEC-WEAPONS §5: a syruped formation must LOOK syruped, or the slowdown
    // reads as a bug. Washed in the syrup trap's own colour.
    const syruped = board.slowT > 0;
    const wash = syruped ? syrupColor() : null;
    const list = board.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const name = enemySprite(e, wing);
      if (syruped) blitTinted(ctx, name, e.x, e.y, wash);
      else blit(ctx, name, e.x, e.y);
    }
  }

  function renderUfo(ctx, board) {
    const u = board.ufo;
    if (!u) return;
    const alt = (Math.floor(Game.time * UFO_ANIM_HZ) & 1) === 1;
    blit(ctx, alt ? 'ufo1' : 'ufo', u.x, u.y);
  }

  /**
   * Every projectile, drawn by its own mechanic — the butter trail and the jam
   * streak included, since weapons.js owns the look of what it fires.
   */
  function renderShots(ctx, board) {
    const list = board.shots;
    if (!list) return;
    for (let i = 0; i < list.length; i++) T.Weapons.renderShot(ctx, list[i]);
  }

  function renderCrate(ctx, board) {
    if (board.crate) T.Weapons.renderCrate(ctx, board.crate);
  }

  function renderToken(ctx, board) {
    const token = board.token;
    if (!token || !token.alive) return;
    T.Weapons.renderToken(ctx, token);
    uiCall('renderTokenLabel', ctx, token);
  }

  function renderBombs(ctx, board) {
    for (let i = 0; i < board.bombs.length; i++) {
      const b = board.bombs[i];
      if (!b.alive) continue;
      blit(ctx, bombSprite(b), b.x, b.y);
    }
  }

  /* Ship art comes from the roster, resolved and interned per kind AND VARIANT
   * by shipFrames / deathFrames, so twenty-seven versions cost the render loop
   * two table lookups and no strings (§12: no per-frame allocation in hot
   * loops). The variant rides on the ship, so a ship blinking through its
   * respawn shield, burning through its death animation, or standing there
   * holding a MICROWAVE RAY is always drawn in the skin its player picked. */
  function renderShips(ctx, board) {
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      if (ship.out && !ship.dead) continue;
      // SPEC-COOP §3: a DOWN ship is not drawn in the play field at all. Its
      // player is told where it went by the HUD and the marker (§5), not by a
      // ghost parked on the line.
      if (ship.down) continue;

      if (ship.dead) {
        // Charred toast, alternating between the two burn frames. Every
        // character burns the same way unless its roster row says otherwise.
        const burn = deathFrames(ship.kind, ship.variant);
        const f = (Math.floor(ship.deathT * 10) & 1) ? 1 : 0;
        blit(ctx, burn[f], ship.x, ship.y);
        continue;
      }
      if (!ship.alive) continue;
      const frames = shipFrames(ship.kind, ship.variant);

      /* SPEC-COOP §5: the revive SPAWN-IN. A player who has been sitting out a
       * wave has to be able to SEE that they are back before they try to move,
       * so a revived ship materialises over C.COOP_REVIVE_TIME instead of
       * simply appearing mid-blink. It is over well inside the respawn shield,
       * and the ordinary blink takes over for the rest of it — so the ship is
       * plainly solid again while it is still untouchable. */
      if (ship.reviveT > 0 && C.COOP_REVIVE_TIME > 0) {
        const k = U.clamp(1 - ship.reviveT / C.COOP_REVIVE_TIME, 0, 1);
        ctx.globalAlpha = 0.12 + k * 0.88;
        blit(ctx, frames[ship.frame === 1 ? 1 : 0], ship.x, ship.y);
        ctx.globalAlpha = 1;
        continue;
      }

      // Blink while the respawn shield is up.
      if (ship.spawnInvuln > 0 && (Math.floor(Game.time * 12) & 1) === 0) continue;
      blit(ctx, frames[ship.frame === 1 ? 1 : 0], ship.x, ship.y);
    }
  }

  function renderBooms(ctx, board) {
    const list = board.booms;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active) continue;
      ctx.globalAlpha = 1 - (b.t / BOOM_TIME) * 0.5;
      blit(ctx, 'boomEnemy', b.x - 24, b.y - 16);
      ctx.globalAlpha = 1;
    }
  }

  /* Reused every frame so the render path allocates nothing. */
  const popupTextOpts = { size: 16, color: PAL.ui, align: 'center' };

  function renderPopups(ctx, board) {
    const list = board.popups;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active) continue;
      ctx.globalAlpha = U.clamp(1 - p.t / POPUP_TIME, 0, 1);
      popupTextOpts.color = p.color;
      uiCall('drawText', ctx, p.text, p.x, p.y, popupTextOpts);
      ctx.globalAlpha = 1;
    }
  }

  /** The floor line the toasters are marching toward. */
  function renderFloor(ctx) {
    ctx.fillStyle = PAL.uiDim;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(C.FORM_MARGIN, C.PLAY_BOTTOM, C.W - C.FORM_MARGIN * 2, 2);
    ctx.globalAlpha = 1;
  }

  function renderBoard(ctx, board) {
    renderFloor(ctx);
    renderBunkers(ctx, board);
    renderEnemies(ctx, board);
    renderUfo(ctx, board);
    renderCrate(ctx, board);
    renderBombs(ctx, board);
    renderShots(ctx, board);
    renderToken(ctx, board);
    renderShips(ctx, board);
    renderBooms(ctx, board);
    if (board.particles && board.particles.render) board.particles.render(ctx);
    renderPopups(ctx, board);
  }

  /**
   * The weapon HUD: a chip per player under their score, plus the centre pickup
   * banner. T.UI owns their look; this file only says which corner is whose.
   *
   * A DOWN player keeps their chip: they still own that weapon and will be
   * holding it again when they come back, and a HUD side that empties out is
   * one more thing that reads as "my game is broken" (SPEC-COOP §5). T.UI
   * marks it down from `ship.down` / `ship.downWaiting`.
   */
  function renderWeaponHud(ctx, board) {
    for (let i = 0; i < board.ships.length; i++) {
      const ship = board.ships[i];
      if (ship.out) continue;
      if (ship.slot === 1) uiCall('renderWeaponChip', ctx, ship, C.W - CHIP_EDGE, CHIP_Y, 'right');
      else uiCall('renderWeaponChip', ctx, ship, CHIP_EDGE, CHIP_Y, 'left');
    }
    if (board.pickup) uiCall('renderPickupBanner', ctx, board);

    /* SPEC-COOP §5: the two pieces of down/revive feedback that sit over the
     * PLAY FIELD rather than in the HUD strip. The shared heart row is not
     * here — it belongs in the strip, and T.UI.renderHUD is already handed
     * this same board and reads `hearts`, `heartsMax` and `heartFlashT` off
     * it, so drawing it from here as well would draw it twice.
     *
     * Both are drawn only while there is something to say, and both are pure
     * presentation: uiCall no-ops when T.UI does not define them, and a build
     * that drew neither would play frame for frame identically. */
    if (board.downNotice) uiCall('renderDownMarker', ctx, board);
    if (board.downBanner) uiCall('renderDownBanner', ctx, board);
  }

  /* =========================================================================
   * TAPPED UI REGIONS  (SPEC-TOUCHUI.md §2)
   *
   * The select screen is drawn ON the canvas, so nothing inside it can be
   * hit-tested the way a DOM button can. ui.js publishes the rectangle of
   * every interactive thing it draws, touch.js turns a tap or a click into
   * logical canvas coordinates and hit-tests that list, and the region it
   * finds arrives HERE. This is the only place a tapped region is acted on:
   * ui.js records geometry and never mutates, touch.js routes and never
   * decides, and the state change itself is the same function the equivalent
   * button press runs (see THE FIVE SELECT-SCREEN ACTIONS, above).
   *
   * A region is declarative data from another file, so nothing below trusts
   * it. Every action is validated against the state the game is actually in
   * and against the roster as it stands right now, and anything that does not
   * check out is a silent no-op: an unknown action, a null region, an
   * out-of-range value, a tap from a player slot that is not in the game, a
   * select-screen action arriving on the title screen. None of them throws,
   * because a pointer handler is not a place to throw from — an exception
   * there would take the touch layer down mid-gesture and leave a held
   * button stuck on.
   *
   * WHAT IT MUST NOT DO, because it is the reported bug: 'variant' sets the
   * index it is handed. It does not step toward it. Tapping the third
   * thumbnail is variant 2, first time, from wherever you were.
   * ====================================================================== */

  /** True only for a whole number that indexes an array of length `n`. */
  function isRegionIndex(v, n) {
    return typeof v === 'number' && isFinite(v) &&
           Math.floor(v) === v && v >= 0 && v < n;
  }

  /** The select-screen player a region names, or null if it names nobody. */
  function tapPlayer(sel, slot) {
    if (slot !== 0 && slot !== 1) return null;
    const players = sel.players;
    for (let i = 0; i < players.length; i++) {
      if (players[i].slot === slot) return players[i];
    }
    return null;
  }

  /**
   * Record that a tap LANDED, for the one frame of feedback SPEC-TOUCHUI §5
   * asks for: without it a player cannot tell a small target was missed from
   * the game ignoring them. Presentation only — nothing in this file reads it
   * back, and the game plays identically whether ui.js draws it or not.
   *
   * One small object per tap, which is a human-rate event and not a hot loop.
   */
  function ackTap(region) {
    Game.tapAck = {
      id: region.id,
      action: region.action,
      player: region.player,
      value: region.value,
      t: Game.time
    };
    return true;
  }

  /**
   * Apply one tapped region. Returns true only if the tap LANDED — if it
   * named a live target on the screen the game is actually on, and was
   * applied. False is a refusal, and nothing happened at all.
   *
   * Landing is not the same as moving: re-tapping the variant you already wear,
   * the mode already set or the character you are already on is a landed tap
   * and returns true, because SPEC-TOUCHUI §5 asks for a landed tap to be
   * acknowledged and a tap on the thing you have is exactly the case where a
   * silent no-answer reads as a missed target.
   */
  function applyUiTap(region) {
    if (!region || typeof region !== 'object') return false;
    const action = region.action;
    if (typeof action !== 'string' || action === '') return false;

    /* The title screen's single region. Tapping anywhere already started the
     * game; expressing it as a region is what makes that ONE mechanism rather
     * than two, so it runs the same body START does. */
    if (action === 'start') {
      if (Game.state !== 'title') return false;
      startFromTitle();
      return ackTap(region);
    }

    /* Everything else belongs to the select screen and to nowhere else. Note
     * `Game.select` is non-null on the title screen too — init() primes one —
     * so the state test is the one that matters, not the payload test. */
    const sel = Game.select;
    if (Game.state !== 'select' || !sel || !sel.players) return false;

    // The mode selector belongs to the screen, not to either panel.
    if (action === 'mode') {
      const mode = region.value;
      if (mode !== 'coop' && mode !== 'classic') return false;
      pickMode(sel, mode);
      return ackTap(region);
    }

    const p = tapPlayer(sel, region.player);
    if (!p) return false;

    if (action === 'join') {
      if (p.joined) return false;
      joinPlayer(sel, p);
      return ackTap(region);
    }

    /* A seat that has not joined, and a player who has already locked in, are
     * both out of the running: updateSelect `continue`s past both, so their
     * panel does not answer a button either. BACK is still how you un-ready,
     * exactly as it is today. */
    if (!p.joined || p.ready) return false;

    switch (action) {
      /* THE REPORTED BUG. `value` is the variant index the player tapped and
       * it is applied as-is — no cycling, no stepping toward it. Out of range
       * for the character they are on is a no-op rather than a clamp: a tap
       * that lands on a thumbnail that is not there did not land on anything. */
      case 'variant':
        if (!isRegionIndex(region.value, variantCount(p.kind))) return false;
        pickVariant(p, region.value);
        return ackTap(region);

      /* A roster-strip icon: straight to that character. `value` indexes the
       * VISIBLE order, which is what keeps a locked secret unreachable — he is
       * not in that array, so no index can name him (SPEC-BURRITO §2). The
       * isPickable re-check costs nothing and means a stale region drawn on
       * the frame an unlock changed the order still cannot smuggle him in. */
      case 'char': {
        if (!isRegionIndex(region.value, visibleOrder.length)) return false;
        const kind = visibleOrder[region.value];
        if (!isPickable(kind)) return false;
        pickCharacter(sel, p, kind);
        return ackTap(region);
      }

      /* A chevron: one place along the carousel, the same wrap the D-pad gets
       * and through the same visible order, so it cannot step onto a secret. */
      case 'charStep': {
        const step = region.value;
        if (typeof step !== 'number' || !isFinite(step) ||
            Math.floor(step) !== step || step === 0) return false;
        pickCharacter(sel, p, cycleKind(p.kind, step));
        return ackTap(region);
      }

      // The big preview: lock this player in, exactly as FIRE does.
      case 'ready':
        readyPlayer(p);
        return ackTap(region);

      default:
        return false;      // an action this build does not know: silently ignored
    }
  }

  /* =========================================================================
   * PUBLIC OBJECT
   * ====================================================================== */
  const Game = {
    state: 'title',
    session: null,
    board: null,
    select: null,
    banner: null,
    /* The secret-reveal banner, or null (SPEC-BURRITO §2). Presentation only:
     * ui.js draws it through renderSecretBanner, nothing else reads it, and
     * the game plays identically whether it is there or not. See startReveal
     * for the field list. */
    reveal: null,
    /* The last hit region a tap or a click actually landed on, or null
     * (SPEC-TOUCHUI §5): { id, action, player, value, t }, where `t` is the
     * Game.time it landed at. Presentation only, and read-only — it is here so
     * ui.js can flash the thing that was tapped within a frame of the tap, and
     * nothing in the rulebook reads it back. */
    tapAck: null,
    quitConfirm: false,
    hiScore: 0,
    time: 0,
    canvas: null,

    init: function (canvas) {
      this.canvas = canvas || null;
      this.time = 0;
      this.session = null;
      this.board = null;
      this.banner = null;
      this.reveal = null;
      this.tapAck = null;
      this.quitConfirm = false;

      // Ask storage once, at boot, who has already been earned.
      refreshVisibleOrder();

      const stored = Number(U.storeGet(HI_KEY, 0));
      this.hiScore = (isFinite(stored) && stored > 0) ? Math.floor(stored) : 0;
      hiDirty = false;
      hiSaveT = 0;
      lastTempo = -1;

      initBackground();
      enterSelect();          // primes a default select payload for the UI
      this.state = 'title';

      const A = T.Audio;
      if (A && typeof A.init === 'function') A.init();
    },

    update: function (dt) {
      this.time += dt;
      updateBackground(dt);

      switch (this.state) {
        case 'title':  updateTitle(dt);  break;
        case 'select': updateSelect(dt); break;
        case 'wave':   updateWave(dt);   break;
        case 'play':   updatePlay(dt);   break;
        case 'pause':  updatePause(dt);  break;
        case 'over':   updateOver(dt);   break;
        default:       this.state = 'title'; break;
      }

      // The reveal banner runs on its own clock, outside every board, so it
      // can survive a wave banner and a classic turn swap without any of them
      // having to know it exists (SPEC-BURRITO §2).
      updateReveal(dt);

      // Persist the high score off the hot path, at most twice a second.
      if (hiDirty) {
        hiSaveT += dt;
        if (hiSaveT >= 2) { hiSaveT = 0; persistHi(); }
      }
    },

    render: function (ctx) {
      // The After Dark sky sits under EVERY screen.
      drawBackground(ctx);

      const board = this.board;
      switch (this.state) {
        case 'title':
          uiCall('renderTitle', ctx, this);
          uiCall('renderControllerHint', ctx, this);
          break;
        case 'select':
          uiCall('renderSelect', ctx, this);
          uiCall('renderControllerHint', ctx, this);
          break;
        case 'wave':
          if (board) { renderBoard(ctx, board); uiCall('renderHUD', ctx, board, this); renderWeaponHud(ctx, board); }
          uiCall('renderWaveBanner', ctx, this);
          break;
        case 'play':
          if (board) { renderBoard(ctx, board); uiCall('renderHUD', ctx, board, this); renderWeaponHud(ctx, board); }
          break;
        case 'pause':
          if (board) { renderBoard(ctx, board); uiCall('renderHUD', ctx, board, this); renderWeaponHud(ctx, board); }
          uiCall('renderPause', ctx, this);
          break;
        case 'over':
          if (board) { renderBoard(ctx, board); uiCall('renderHUD', ctx, board, this); renderWeaponHud(ctx, board); }
          uiCall('renderOver', ctx, this);
          break;
        default:
          break;
      }

      /* SPEC-BURRITO §2: the reveal, over the play field, for its 2.5s and no
       * longer. Drawn after the board and the HUD so it reads as an overlay,
       * and only once `started` — which updateReveal sets on the first PLAY
       * frame, so it can never appear on the title, the select screen, behind
       * the "WAVE 5" banner that fired it, or over the final score card.
       *
       * DRAWN ON EXACTLY THE STATE ITS CLOCK RUNS ON, and for the same reason
       * the clock stops: 'play' is the only state where this band is over the
       * play field and nothing else. updateReveal freezes it on a pause and on
       * a classic turn swap — so a banner still drawn there would be a frozen
       * 140px letterbox sitting across the middle of the screen with no way to
       * time out. That is not hypothetical: the band spans y 382..522, and the
       * pause panel's RESUME and QUIT lines (386, 420) and the quit-confirm's
       * YES/NO row (402) are all inside it, so pressing START inside the 2.5s
       * would cover the two prompts the player needs to read to get out. */
      if (this.reveal && this.reveal.started && this.state === 'play') {
        uiCall('renderSecretBanner', ctx, this);
      }

      uiCall('renderScanlines', ctx);
    },

    /**
     * The characters a player is allowed to see RIGHT NOW, in carousel order
     * (SPEC-BURRITO.md §2).
     *
     * THIS, not T.C.CHARACTER_ORDER, is what anything a player looks at must
     * walk: the select carousel, the roster strip, the title attract loop, and
     * every count printed on any of them ("n OF 9" until burrito is earned,
     * "n OF 10" after). T.C.CHARACTER_ORDER is the DATA order and always holds
     * all ten — a secret is absent from the game's offer, not from its table.
     *
     * The same array object every call, rebuilt in place when the unlock state
     * can have changed, so a per-frame reader allocates nothing. Treat it as
     * read-only.
     */
    visibleCharacters: function () { return visibleOrder; },

    /**
     * Is this player currently DOWN — out of the wave, waiting to be revived
     * (SPEC-COOP.md §3)?
     *
     * The one thing another file might want to ask about co-op that is not
     * already hanging off the board it is handed: touch.js draws a control
     * column per player and has no board, and a downed player's column must
     * say so rather than look like a column that has stopped responding.
     *
     * Read-only, allocation-free, and false for every board that is not
     * two-player co-op — so a caller may ask on any screen, in any mode.
     */
    isPlayerDown: function (slot) {
      const board = this.board;
      if (!board || !board.sharedHearts) return false;
      const ships = board.ships;
      for (let i = 0; i < ships.length; i++) {
        if (ships[i].slot === slot) return !!ships[i].down;
      }
      return false;
    },

    /**
     * True when `id` names a roster character the player may currently see —
     * always true for the nine, and true for a secret only once it has been
     * earned, here or in an earlier session.
     */
    isCharacterUnlocked: function (id) { return isPickable(id); },

    /**
     * Act on a hit region the player tapped or clicked (SPEC-TOUCHUI.md §2).
     *
     * touch.js hit-tests T.UI.regions() and hands the winning region here;
     * this is the ONLY place a tapped region is acted on, and every action it
     * takes is the same function the equivalent button press runs.
     *
     *   'variant'   value = variant index    -> that variant, DIRECTLY
     *   'char'      value = index into visibleCharacters()
     *   'charStep'  value = -1 | +1
     *   'ready'     value = null
     *   'join'      value = null
     *   'mode'      value = 'coop' | 'classic'
     *   'start'     value = null             (title only)
     *
     * Returns true when the tap LANDED — it named a live target on the screen
     * the game is actually on, and was applied. Landing is not the same as
     * moving: re-tapping the variant you already wear is a landed tap and
     * returns true, because §5 wants a landed tap acknowledged. A null region,
     * an unknown action, an out-of-range value, a player slot that is not in
     * the game, or an action that makes no sense in the current state returns
     * false and does nothing at all — never an exception, because this is
     * called from a pointer handler and throwing there would strand a held
     * button.
     */
    uiTap: function (region) { return applyUiTap(region); },

    /* Convenience hooks for main.js (visibilitychange auto-pause, etc). */
    pause: function () { enterPause(); },

    resume: function () { if (this.state === 'pause' && !this.quitConfirm) enterPlay(); },

    togglePause: function () {
      if (this.state === 'play') enterPause();
      else if (this.state === 'pause') enterPlay();
    }
  };

  T.Game = Game;

})(window.T = window.T || {});
