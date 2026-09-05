/* ===========================================================================
 * TOASTER INVADERS — js/entities.js
 *
 * ROLE: the model layer. Plain-object entities, their per-entity motion, and
 * the collision primitives the game rules are built out of.
 *
 * There are NO game rules in this file: nothing here awards points, spends a
 * life, spawns a wave, or decides that something died. Entities move, animate
 * and answer geometry questions; js/game.js does the deciding.
 *
 * Contents:
 *   makeShip / makeEnemy / makeShot / makeBomb / makeUfo   — constructors
 *   updateShip / updateShot / updateBomb / updateUfo       — per-entity motion
 *   makeBunker + rectHitsBunker / damageBunker /           — the destructible
 *     erodeBunkerTop / bunkerIsGone / resetBunker            butter barricade
 *   makeParticleSystem                                     — fixed 400 pool
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const C = T.C;
  const U = T.Util;
  const PAL = C.PAL;

  /* -------------------------------------------------------------------------
   * LOCAL METRICS
   *
   * Only numbers the spec does NOT put in T.C live here: sprite footprints and
   * a handful of animation rates. Anything that tunes feel and is listed in
   * section 3 of the spec is read from T.C and never re-stated.
   * ---------------------------------------------------------------------- */

  const BUNKER_W = 96;            // the 'bunker' sprite, logical px
  const BUNKER_H = 64;

  const SHIP_SPAWN_INVULN = 1.0;  // seconds of grace after (re)spawning
  const SHIP_RECOIL_TIME = 0.09;  // seconds the firing frame is held
  const SHIP_DEATH_FRAME_TIME = 0.18;  // seconds per charred-toast frame

  const BOMB_ANIM_TIME = 0.09;    // seconds per tumbling bomb frame
  const UFO_ANIM_TIME = 1 / 8;    // wing beat alternates at 8 Hz

  const TRAIL_LEN = 4;            // fixed-length shot trail, index 0 = newest

  const ENEMY_TYPE_BY_ROW = ['A', 'B', 'B', 'C', 'C'];
  const ENEMY_SIZE = {            // matches sprites 'toastA0'..'toastC3'
    A: { w: 52, h: 34 },
    B: { w: 56, h: 34 },
    C: { w: 60, h: 34 }
  };

  /**
   * Sprite-name lookup tables. enemySprite() is called for all 55 toasters on
   * every rendered frame, so the names are interned here once instead of being
   * rebuilt with string concatenation inside the hot loop (spec section 12:
   * no per-frame allocation in hot loops).
   */
  const ENEMY_SPRITE = {
    A: ['toastA0', 'toastA1', 'toastA2', 'toastA3'],
    B: ['toastB0', 'toastB1', 'toastB2', 'toastB3'],
    C: ['toastC0', 'toastC1', 'toastC2', 'toastC3']
  };

  const UFO_W = 76;
  const UFO_H = 34;

  const BOMB_SIZE = [             // indexed by bomb type 0|1|2
    { w: 8, h: 16 },              // 0 crumb
    { w: 8, h: 16 },              // 1 spark / coil
    { w: 16, h: 16 }              // 2 winged toast slice
  ];
  const BOMB_KIND = ['crumb', 'spark', 'flyingToast'];
  const BOMB_SPRITE = [           // [type][frame], interned like ENEMY_SPRITE
    ['bomb0a', 'bomb0b'],
    ['bomb1a', 'bomb1b'],
    ['bomb2a', 'bomb2b']
  ];

  /**
   * Weapon stats, keyed by the OWNER's kind (spec section 4). Bread throws
   * butter — wide, slower, and it melts a big greasy hole in a bunker. The jam
   * jar throws jam — narrow, fast, and it punches a neat little puncture.
   * Exposed as T.Entities.WEAPON so game.js reads the same numbers.
   *
   * SPEC-CHARACTERS.md §6: there are NINE characters now, so this table is
   * DERIVED from T.C.BASE_WEAPONS rather than being a second, divergent copy
   * of two of its rows. Every row of the roster gets a block here with the
   * same shape the two original ones had; adding a tenth character is a row in
   * util.js and nothing in this file. The trail tints are the only thing the
   * roster does not carry, so butter and jam keep their hand-picked pair and
   * everybody else streaks in their own roster colour.
   */
  const WEAPON = (function buildWeaponTable() {
    const out = Object.create(null);
    const rows = C.BASE_WEAPONS || {};
    const ids = C.CHARACTER_ORDER || Object.keys(rows);
    for (let i = 0; i < ids.length; i++) {
      const row = rows[ids[i]];
      if (!row || !row.wid) continue;
      out[row.id] = {
        kind: row.wid,
        sprite: row.shot,
        w: row.w,
        h: row.h,
        speed: row.speed,
        damageRadius: row.dmg,
        sfx: row.sfx,
        color: row.color,
        trailColor: row.wid === 'butter' ? PAL.butterLt
                  : row.wid === 'jam' ? PAL.jamLite
                  : row.color
      };
    }
    // Last-resort stand-in only if T.C somehow carries no roster at all.
    if (!out.bread) {
      out.bread = {
        kind: 'butter', sprite: 'butter', w: 10, h: 16,
        speed: C.SHOT_SPEED_BUTTER, damageRadius: 9, sfx: 'shootButter',
        color: PAL.butter, trailColor: PAL.butterLt
      };
    }
    return out;
  })();

  /** The character every fallback in this file lands on. */
  const KIND_DEFAULT = (C.CHARACTER_ORDER && C.CHARACTER_ORDER[0]) || 'bread';

  /** Weapon block for a character kind; unknown kinds fall back to the first. */
  function weaponFor(kind) {
    return WEAPON[kind] || WEAPON[KIND_DEFAULT] || WEAPON.bread;
  }

  /* -------------------------------------------------------------------------
   * SPRITE METRICS
   * Sprite footprints are authored in js/sprites.js, so ask it for the real
   * size when it is built and fall back to the spec's table if it is not
   * (entities can be constructed by a unit-test harness with no sprites).
   * ---------------------------------------------------------------------- */

  /** @returns {?{canvas:HTMLCanvasElement,w:number,h:number}} */
  function getSprite(name) {
    const S = T.Sprites;
    if (!S || typeof S.get !== 'function') return null;
    try {
      const s = S.get(name);
      return (s && s.canvas) ? s : null;
    } catch (err) {
      return null;
    }
  }

  /** Sprite width/height if available, else the spec-declared fallback. */
  function spriteW(name, fallback) {
    const s = getSprite(name);
    return s ? s.w : fallback;
  }
  function spriteH(name, fallback) {
    const s = getSprite(name);
    return s ? s.h : fallback;
  }

  /* -------------------------------------------------------------------------
   * SHIP
   * ---------------------------------------------------------------------- */

  /**
   * Horizontal spawn position (LEFT edge) for a player slot. Slot 0 sits left
   * of centre, slot 1 right of centre, so a co-op pair starts apart but both
   * are within the same clamped movement range.
   */
  function shipSpawnX(slot) {
    const t = slot === 1 ? 0.64 : 0.36;
    return Math.round(C.W * t - C.SHIP_W / 2);
  }

  /** Leftmost / rightmost legal ship x (spec section 9, step 2). */
  function shipMinX() {
    return C.FORM_MARGIN;
  }
  function shipMaxX() {
    return C.W - C.FORM_MARGIN - C.SHIP_W;
  }

  /**
   * A player ship.
   *   alive  — on the board and hittable
   *   dead   — currently playing the burnt-toast death animation
   *   out    — eliminated: no lives left, sits the rest of the board out
   *   shot   — the ship's ONE live shot, or null (classic single-shot rule)
   *
   * @param {number} slot 0 or 1
   * @param {string} kind one of the nine ids in T.C.CHARACTER_ORDER
   */
  function makeShip(slot, kind) {
    // SPEC-CHARACTERS.md §6: nine kinds, so the check is "is this a row in the
    // roster", never a two-case branch. An unknown kind (an old save, a
    // harness) becomes the first character rather than silently becoming bread.
    const k = WEAPON[kind] ? kind : KIND_DEFAULT;
    return {
      slot: slot,
      kind: k,
      weapon: weaponFor(k),
      x: shipSpawnX(slot),
      y: C.SHIP_Y,
      w: C.SHIP_W,
      h: C.SHIP_H,
      alive: true,
      lives: C.LIVES,
      score: 0,
      dead: false,
      deathT: 0,
      frame: 0,          // 0 idle, 1 firing recoil
      recoilT: 0,
      shot: null,
      respawnT: 0,
      spawnInvuln: SHIP_SPAWN_INVULN,
      out: false
    };
  }

  /**
   * Put a ship back on the line: centred at its slot position, upright, with
   * a moment of spawn invulnerability. Lives and score are NOT touched — those
   * belong to game.js.
   */
  function resetShip(ship) {
    ship.x = shipSpawnX(ship.slot);
    ship.y = C.SHIP_Y;
    ship.alive = true;
    ship.dead = false;
    ship.deathT = 0;
    ship.frame = 0;
    ship.recoilT = 0;
    ship.respawnT = 0;
    ship.spawnInvuln = SHIP_SPAWN_INVULN;
    return ship;
  }

  /**
   * Per-frame ship motion. `axisX` is the deadzoned stick value in -1..1.
   * Moves and clamps a living ship, or advances the death animation clocks of
   * a dead one. Deciding what to do when respawnT runs out is game.js's job.
   *
   * `deathT` counts UP (how long the burnt-toast animation has been playing);
   * `respawnT` counts DOWN from T.C.SHIP_RESPAWN_DELAY and is clamped at 0, so
   * `respawnT <= 0` is the "this ship may come back now" signal. It is derived
   * from deathT rather than integrated separately, which keeps the two clocks
   * from drifting apart and makes the field self-seeding: game.js only has to
   * set `dead = true` and zero `deathT`.
   */
  function updateShip(ship, axisX, dt) {
    if (ship.dead) {
      ship.deathT += dt;
      ship.respawnT = Math.max(0, C.SHIP_RESPAWN_DELAY - ship.deathT);
      ship.frame = (ship.deathT % (SHIP_DEATH_FRAME_TIME * 2)) < SHIP_DEATH_FRAME_TIME ? 0 : 1;
      return;
    }
    if (!ship.alive || ship.out) return;

    if (axisX) {
      ship.x = U.clamp(ship.x + axisX * C.SHIP_SPEED * dt, shipMinX(), shipMaxX());
    }
    if (ship.spawnInvuln > 0) ship.spawnInvuln -= dt;
    if (ship.recoilT > 0) {
      ship.recoilT -= dt;
      if (ship.recoilT <= 0) ship.frame = 0;
    }
  }

  /** Kick the ship into its firing frame for a beat (visual recoil only). */
  function shipRecoil(ship) {
    ship.frame = 1;
    ship.recoilT = SHIP_RECOIL_TIME;
  }

  /* [kind][frame] — idle / firing recoil, for all NINE characters. Built once
   * from the roster's own `ship` / `shipFire` columns and interned, so the
   * render path looks a pair up and never builds a string (SPEC.md §12). */
  const SHIP_SPRITE = (function buildShipSprites() {
    const out = Object.create(null);
    const rows = C.BASE_WEAPONS || {};
    const ids = C.CHARACTER_ORDER || Object.keys(rows);
    for (let i = 0; i < ids.length; i++) {
      const row = rows[ids[i]];
      if (!row || !row.ship) continue;
      out[row.id] = [row.ship, row.shipFire || row.ship];
    }
    if (!out.bread) out.bread = ['bread0', 'bread1'];
    return out;
  })();
  const SHIP_DEATH_SPRITE = ['boomPlayer0', 'boomPlayer1'];

  /** Sprite name for a ship's current state — burnt toast while dying. */
  function shipSprite(ship) {
    const f = ship.frame === 1 ? 1 : 0;
    const pair = SHIP_SPRITE[ship.kind] || SHIP_SPRITE[KIND_DEFAULT] ||
                 SHIP_SPRITE.bread;
    if (ship.dead) return SHIP_DEATH_SPRITE[f];
    return pair[f];
  }

  /** Muzzle X (centre of the ship) — where a shot leaves from. */
  function shipMuzzleX(ship) {
    return ship.x + ship.w / 2;
  }

  /* -------------------------------------------------------------------------
   * ENEMY (a winged toaster)
   * ---------------------------------------------------------------------- */

  /**
   * One toaster at formation grid cell (row, col). x/y are the WAVE-1 resting
   * position: centred in its CELL_W x CELL_H cell. game.js shifts the whole
   * formation from there (march offset, per-wave start Y).
   */
  function makeEnemy(row, col) {
    const type = ENEMY_TYPE_BY_ROW[row] || ENEMY_TYPE_BY_ROW[ENEMY_TYPE_BY_ROW.length - 1];
    const base = ENEMY_SIZE[type];
    const w = spriteW('toast' + type + '0', base.w);
    const h = spriteH('toast' + type + '0', base.h);
    const pts = C.SCORE_ROW[row];
    return {
      row: row,
      col: col,
      x: C.FORM_START_X + col * C.CELL_W + (C.CELL_W - w) / 2,
      y: C.FORM_START_Y + row * C.CELL_H + (C.CELL_H - h) / 2,
      w: w,
      h: h,
      alive: true,
      type: type,
      points: (pts === undefined ? C.SCORE_ROW[C.SCORE_ROW.length - 1] : pts)
    };
  }

  /**
   * Sprite name for a toaster on wing frame `frameIdx` (0..3 — game.js walks
   * T.C.FRAME_CYCLE and passes the value it lands on).
   */
  function enemySprite(enemy, frameIdx) {
    const names = ENEMY_SPRITE[enemy.type] || ENEMY_SPRITE.C;
    return names[frameIdx & 3];
  }

  /* -------------------------------------------------------------------------
   * SHOT (player fire)
   * ---------------------------------------------------------------------- */

  /**
   * A player shot. Size, speed, bunker damage radius and colours all come from
   * the OWNER's weapon block, so all nine characters feel different for free.
   *
   * NOTE: weapons.js owns every projectile the shipped game fires (it has to —
   * seven of the nine base weapons have a mechanic no plain struct can carry).
   * This constructor is the original, mechanic-free one, kept for the unit
   * harness and for anything that wants a bare shot; it is roster-driven so it
   * can never disagree with weapons.js about a character's numbers.
   *
   * (x, y) is the MUZZLE: x is the centre of the barrel, y the top edge of the
   * shot. The stored `x` is the left edge (x - w/2).
   *
   * `trail` is a fixed 4-entry array of previous positions, newest at index 0,
   * pre-filled with the spawn point so the first frame renders cleanly. It is
   * allocated once here and only ever mutated in place.
   */
  function makeShot(owner, x, y) {
    const wep = weaponFor(owner && owner.kind);
    // The hitbox is a WEAPON stat (spec section 4: butter 10x16 wide, jam 6x16
    // narrow) — that is what makes the characters feel different — so it
    // comes from the weapon block, NOT from whatever size the sprite happens to
    // be. Everything else here (enemies, bombs, UFO) is a pure sprite footprint
    // and does defer to sprites.js.
    const w = wep.w;
    const h = wep.h;
    const left = x - w / 2;
    const trail = new Array(TRAIL_LEN);
    for (let i = 0; i < TRAIL_LEN; i++) trail[i] = { x: left, y: y };
    return {
      x: left,
      y: y,
      w: w,
      h: h,
      vy: -wep.speed,
      kind: wep.kind,          // the base weapon's id, e.g. 'butter' / 'drip'
      sprite: wep.sprite,
      damageRadius: wep.damageRadius,
      color: wep.color,
      trailColor: wep.trailColor,
      owner: owner,
      alive: true,
      trail: trail
    };
  }

  /** Slide the trail down one slot and record the current position at [0]. */
  function pushTrail(shot) {
    const t = shot.trail;
    for (let i = t.length - 1; i > 0; i--) {
      t[i].x = t[i - 1].x;
      t[i].y = t[i - 1].y;
    }
    t[0].x = shot.x;
    t[0].y = shot.y;
  }

  /**
   * Shot motion: remember where it was, then move. Nothing here retires a
   * shot — leaving the ceiling is a collision case game.js wants to see.
   */
  function updateShot(shot, dt) {
    if (!shot.alive) return;
    pushTrail(shot);
    shot.y += shot.vy * dt;
  }

  /* -------------------------------------------------------------------------
   * BOMB (enemy fire)
   * ---------------------------------------------------------------------- */

  /**
   * An enemy bomb. `type` 0 crumb / 1 spark / 2 winged toast slice — the three
   * visual types game.js cycles through. (x, y) is the drop point: x centred
   * under the firing toaster, y the top edge.
   */
  function makeBomb(x, y, type) {
    // Wrap into 0..2 for ANY integer, negatives included — a plain % would hand
    // back a negative index and blow up on the size lookup.
    const n = BOMB_SIZE.length;
    const t = (((type | 0) % n) + n) % n;
    const size = BOMB_SIZE[t];
    const w = spriteW('bomb' + t + 'a', size.w);
    const h = spriteH('bomb' + t + 'a', size.h);
    return {
      x: x - w / 2,
      y: y,
      w: w,
      h: h,
      vy: U.randRange(C.BOMB_SPEED_MIN, C.BOMB_SPEED_MAX),
      type: t,
      kind: BOMB_KIND[t],
      frame: 0,
      animT: 0,
      alive: true
    };
  }

  /** Bomb motion plus its 2-frame tumble. Floor tests belong to game.js. */
  function updateBomb(bomb, dt) {
    if (!bomb.alive) return;
    bomb.y += bomb.vy * dt;
    bomb.animT += dt;
    while (bomb.animT >= BOMB_ANIM_TIME) {
      bomb.animT -= BOMB_ANIM_TIME;
      bomb.frame ^= 1;
    }
  }

  /** Sprite name for a bomb's current tumble frame. */
  function bombSprite(bomb) {
    const frames = BOMB_SPRITE[bomb.type] || BOMB_SPRITE[0];
    return frames[bomb.frame === 1 ? 1 : 0];
  }

  /* -------------------------------------------------------------------------
   * UFO (the Chrome Deluxe bonus toaster)
   * ---------------------------------------------------------------------- */

  /**
   * A bonus toaster crossing the top of the screen.
   * @param {number} dir +1 = enters from the left, -1 = enters from the right.
   */
  function makeUfo(dir) {
    const d = dir < 0 ? -1 : 1;
    const w = spriteW('ufo', UFO_W);
    const h = spriteH('ufo', UFO_H);
    return {
      x: d > 0 ? -w : C.W,
      y: C.UFO_Y,
      w: w,
      h: h,
      vx: d * C.UFO_SPEED,
      dir: d,
      alive: true,
      scoreIndex: U.randInt(0, C.UFO_SCORES.length - 1),
      frame: 0,
      animT: 0
    };
  }

  /** UFO motion plus its 8 Hz wing beat. Exit handling belongs to game.js. */
  function updateUfo(ufo, dt) {
    if (!ufo.alive) return;
    ufo.x += ufo.vx * dt;
    ufo.animT += dt;
    while (ufo.animT >= UFO_ANIM_TIME) {
      ufo.animT -= UFO_ANIM_TIME;
      ufo.frame ^= 1;
    }
  }

  /** Sprite name for the UFO's current wing beat. */
  function ufoSprite(ufo) {
    return ufo.frame === 1 ? 'ufo1' : 'ufo';
  }

  /* -------------------------------------------------------------------------
   * COLLISION PRIMITIVES
   * ---------------------------------------------------------------------- */

  /** Standard AABB overlap of two {x,y,w,h} entities. */
  function aabb(a, b) {
    return U.aabb(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h);
  }

  /** True when a rect has left the 960x720 screen entirely (plus a margin). */
  function isOffscreen(e, margin) {
    const m = margin || 0;
    return (e.x + e.w < -m) || (e.x > C.W + m) ||
           (e.y + e.h < -m) || (e.y > C.H + m);
  }

  /* -------------------------------------------------------------------------
   * BUNKER — the destructible stick-of-butter barricade
   *
   * Each bunker owns a 96x64 offscreen canvas seeded from the 'bunker' sprite,
   * the ImageData backing that canvas, and a Uint8Array occupancy mask (one
   * byte per logical pixel, 1 = solid) derived from the alpha channel.
   *
   * Damage is applied to the mask and the ImageData together, then flushed to
   * the canvas with a single dirty-rect putImageData — so collisions stay a
   * cheap array scan and rendering stays a single drawImage.
   * ---------------------------------------------------------------------- */

  /**
   * Safety net for the (practically impossible) case where sprites.js has not
   * run: draw a plain butter block with the classic arched underside so the
   * barricade is still visible and still destructible.
   */
  function drawFallbackBunker(ctx) {
    ctx.fillStyle = PAL.butter;
    ctx.fillRect(0, 8, BUNKER_W, BUNKER_H - 8);
    ctx.fillRect(8, 0, BUNKER_W - 16, 10);
    ctx.fillStyle = PAL.butterLt;
    ctx.fillRect(8, 8, BUNKER_W - 16, 6);
    ctx.fillStyle = PAL.crumbDark;
    ctx.fillRect(0, 30, BUNKER_W, 6);          // wrapper band
    ctx.clearRect(30, BUNKER_H - 22, 36, 22);  // arched doorway
    ctx.clearRect(26, BUNKER_H - 14, 44, 14);
  }

  /**
   * (Re)seed a bunker's canvas, ImageData and mask from the 'bunker' sprite.
   * Pixels with alpha <= 128 are forced fully transparent so the mask and the
   * visible pixels always agree.
   */
  function seedBunker(b) {
    const ctx = b.ctx;
    ctx.clearRect(0, 0, BUNKER_W, BUNKER_H);
    const spr = getSprite('bunker');
    if (spr) {
      ctx.drawImage(spr.canvas, 0, 0, BUNKER_W, BUNKER_H);
    } else {
      drawFallbackBunker(ctx);
    }

    let img = null;
    try {
      img = ctx.getImageData(0, 0, BUNKER_W, BUNKER_H);
    } catch (err) {
      // Reading back a canvas can throw in exotic sandboxes. Degrade to an
      // empty (already-destroyed) bunker rather than taking the game down.
      b.image = null;
      b.mask.fill(0);
      b.total = 0;
      b.remaining = 0;
      return b;
    }

    const data = img.data;
    const mask = b.mask;
    let solid = 0;
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      if (data[p + 3] > 128) {
        mask[i] = 1;
        data[p + 3] = 255;
        solid++;
      } else {
        mask[i] = 0;
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);

    b.image = img;
    b.total = solid;
    b.remaining = solid;
    return b;
  }

  /**
   * A destructible bunker with its top-left at (x, y) in logical pixels.
   * Render it with a single ctx.drawImage(bunker.canvas, bunker.x, bunker.y).
   */
  function makeBunker(x, y) {
    const canvas = document.createElement('canvas');
    canvas.width = BUNKER_W;
    canvas.height = BUNKER_H;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const b = {
      x: x,
      y: y,
      w: BUNKER_W,
      h: BUNKER_H,
      canvas: canvas,
      ctx: ctx,
      image: null,
      mask: new Uint8Array(BUNKER_W * BUNKER_H),
      total: 0,
      remaining: 0
    };
    return seedBunker(b);
  }

  /** Restore a bunker to pristine butter (called at the start of each wave). */
  function resetBunker(b) {
    return seedBunker(b);
  }

  /** O(1) — true once every solid pixel has been chewed away. */
  function bunkerIsGone(b) {
    return b.remaining <= 0;
  }

  /** Blit a bunker at its own position. */
  function drawBunker(ctx, b) {
    if (b.remaining <= 0) return;
    ctx.drawImage(b.canvas, b.x, b.y);
  }

  /**
   * PIXEL-ACCURATE hit test: does the world-space rect (x, y, w, h) overlap any
   * remaining solid pixel of this bunker?
   *
   * Bounding box first (one comparison chain rejects the overwhelming majority
   * of calls), then a clipped scan of the mask.
   */
  function rectHitsBunker(b, x, y, w, h) {
    if (b.remaining <= 0) return false;

    // Cheap bounding-box early-out.
    if (x >= b.x + BUNKER_W || x + w <= b.x ||
        y >= b.y + BUNKER_H || y + h <= b.y) {
      return false;
    }

    const mask = b.mask;
    let x0 = Math.floor(x - b.x);
    let y0 = Math.floor(y - b.y);
    let x1 = Math.ceil(x + w - b.x);
    let y1 = Math.ceil(y + h - b.y);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > BUNKER_W) x1 = BUNKER_W;
    if (y1 > BUNKER_H) y1 = BUNKER_H;

    for (let py = y0; py < y1; py++) {
      const row = py * BUNKER_W;
      for (let px = x0; px < x1; px++) {
        if (mask[row + px] !== 0) return true;
      }
    }
    return false;
  }

  /**
   * Clear one local pixel in both the mask and the ImageData.
   * @returns {number} 1 if a solid pixel was removed, 0 if it was already gone.
   */
  function clearBunkerPixel(b, px, py) {
    const mi = py * BUNKER_W + px;
    if (b.mask[mi] === 0) return 0;
    b.mask[mi] = 0;
    const data = b.image.data;
    const di = mi << 2;
    data[di] = 0;
    data[di + 1] = 0;
    data[di + 2] = 0;
    data[di + 3] = 0;
    b.remaining--;
    return 1;
  }

  /** Push a mutated sub-rect of the ImageData back onto the bunker canvas. */
  function flushBunker(b, x0, y0, x1, y1) {
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    b.ctx.putImageData(b.image, 0, 0, x0, y0, w, h);
  }

  /**
   * Carve a RAGGED circle of radius `radius` centred on world point (cx, cy).
   *
   * Every pixel inside the bounding square is tested against its OWN jittered
   * radius — dist <= radius * (0.72 + 0.42 * rng()) — so the rim comes out
   * chewed and irregular instead of a clean geometric disc, exactly like the
   * original's shield damage. Pixels well inside the guaranteed core skip the
   * random roll entirely, which keeps the common case fast.
   *
   * @returns {number} how many solid pixels were removed.
   */
  function damageBunker(b, cx, cy, radius) {
    if (b.remaining <= 0 || !b.image) return 0;

    const lx = cx - b.x;
    const ly = cy - b.y;
    const rMin = radius * 0.72;          // always inside the hole
    const rMax = radius * 1.14;          // never outside it
    const rMin2 = rMin * rMin;
    const rMax2 = rMax * rMax;

    let x0 = Math.floor(lx - rMax);
    let y0 = Math.floor(ly - rMax);
    let x1 = Math.ceil(lx + rMax) + 1;
    let y1 = Math.ceil(ly + rMax) + 1;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > BUNKER_W) x1 = BUNKER_W;
    if (y1 > BUNKER_H) y1 = BUNKER_H;
    if (x0 >= x1 || y0 >= y1) return 0;

    let removed = 0;
    for (let py = y0; py < y1; py++) {
      const dy = py + 0.5 - ly;
      const dy2 = dy * dy;
      for (let px = x0; px < x1; px++) {
        const dx = px + 0.5 - lx;
        const d2 = dx * dx + dy2;
        if (d2 > rMax2) continue;
        if (d2 > rMin2) {
          // In the ragged annulus: roll this pixel's own edge radius.
          const jr = radius * (0.72 + 0.42 * U.rng());
          if (d2 > jr * jr) continue;
        }
        removed += clearBunkerPixel(b, px, py);
      }
    }

    if (removed > 0) flushBunker(b, x0, y0, x1, y1);
    return removed;
  }

  /**
   * Erode the bunker downward from its remaining top surface across the world
   * span [x, x + w) — what happens when a toaster marches down onto it.
   *
   * Each column loses a jittered bite out of its current top edge, so a
   * descending formation gnaws the barricade away unevenly.
   *
   * @param {number} [depth=6] average pixels eaten per column.
   * @returns {number} how many solid pixels were removed.
   */
  function erodeBunkerTop(b, x, w, depth) {
    if (b.remaining <= 0 || !b.image) return 0;
    if (x >= b.x + BUNKER_W || x + w <= b.x) return 0;

    const bite = (depth === undefined) ? 6 : depth;
    const mask = b.mask;

    let x0 = Math.floor(x - b.x);
    let x1 = Math.ceil(x + w - b.x);
    if (x0 < 0) x0 = 0;
    if (x1 > BUNKER_W) x1 = BUNKER_W;
    if (x0 >= x1) return 0;

    let removed = 0;
    let dirtyTop = BUNKER_H;
    let dirtyBottom = 0;

    for (let px = x0; px < x1; px++) {
      // Find this column's current top surface.
      let top = -1;
      for (let py = 0; py < BUNKER_H; py++) {
        if (mask[py * BUNKER_W + px] !== 0) { top = py; break; }
      }
      if (top < 0) continue;

      let end = top + Math.round(bite * (0.6 + 0.8 * U.rng()));
      if (end > BUNKER_H) end = BUNKER_H;
      for (let py = top; py < end; py++) removed += clearBunkerPixel(b, px, py);

      if (top < dirtyTop) dirtyTop = top;
      if (end > dirtyBottom) dirtyBottom = end;
    }

    if (removed > 0) flushBunker(b, x0, dirtyTop, x1, dirtyBottom);
    return removed;
  }

  /* -------------------------------------------------------------------------
   * PARTICLES
   *
   * One fixed pool of 400 objects allocated at construction. `items` holds the
   * live ones (swap-removed, so iteration order is not age order); `free` holds
   * the retired ones. spawn() past capacity recycles the oldest live particles
   * in rotation. Nothing in update/render/spawn allocates.
   * ---------------------------------------------------------------------- */

  const PARTICLE_POOL = 400;

  const PARTICLE_DEFAULTS = {
    count: 8,
    color: PAL.crumb,
    speed: 140,
    spread: Math.PI * 2,
    angle: -Math.PI / 2,
    life: 0.5,
    gravity: 480,
    size: 3,
    drag: 1.1
  };

  /**
   * Ready-made burst options for the three flavours of debris the game throws.
   * Pass one straight into spawn() — it is read, never mutated.
   */
  const FX = {
    crumb: {
      count: 14, color: [PAL.crumb, PAL.crumbDark, PAL.crust], speed: 190,
      spread: Math.PI * 2, life: 0.55, gravity: 520, size: 3, drag: 1.4
    },
    butter: {
      count: 10, color: [PAL.butter, PAL.butterLt], speed: 150,
      spread: Math.PI * 2, life: 0.45, gravity: 620, size: 3, drag: 1.6
    },
    jam: {
      count: 12, color: [PAL.jamRed, PAL.jamLite], speed: 170,
      spread: Math.PI * 2, life: 0.5, gravity: 700, size: 2, drag: 1.5
    },
    chrome: {
      count: 16, color: [PAL.chromeLt, PAL.chrome, PAL.chromeDk], speed: 210,
      spread: Math.PI * 2, life: 0.6, gravity: 480, size: 3, drag: 1.3
    },
    burnt: {
      count: 18, color: [PAL.burnt, PAL.crust, PAL.coil], speed: 200,
      spread: Math.PI * 2, life: 0.75, gravity: 540, size: 3, drag: 1.2
    }
  };

  function makeParticle() {
    return {
      x: 0, y: 0,
      vx: 0, vy: 0,
      life: 0, maxLife: 1,
      size: 2,
      gravity: 0,
      drag: 0,
      color: PAL.crumb
    };
  }

  /**
   * @returns {{items:Array, spawn:Function, update:Function, render:Function,
   *            clear:Function, capacity:number}}
   *
   * spawn(x, y, opts) — opts (all optional, defaults above):
   *   count    how many particles
   *   color    a colour string, or an array of them to pick from per particle
   *   speed    peak launch speed in px/s (each particle takes 35..100% of it)
   *   spread   angular spread in radians around `angle`
   *   angle    centre launch direction (default straight up)
   *   life     seconds to live (each particle takes 60..100% of it)
   *   gravity  downward acceleration in px/s^2
   *   size     square side in px
   *   drag     velocity damping per second
   */
  function makeParticleSystem() {
    const items = [];
    const free = [];
    for (let i = 0; i < PARTICLE_POOL; i++) free.push(makeParticle());
    let stealIdx = 0;

    function take() {
      if (free.length > 0) {
        const p = free.pop();
        items.push(p);
        return p;
      }
      // Pool exhausted: recycle live particles in rotation.
      if (stealIdx >= items.length) stealIdx = 0;
      return items[stealIdx++];
    }

    function spawn(x, y, opts) {
      const o = opts || PARTICLE_DEFAULTS;
      const count = o.count === undefined ? PARTICLE_DEFAULTS.count : o.count;
      const color = o.color === undefined ? PARTICLE_DEFAULTS.color : o.color;
      const speed = o.speed === undefined ? PARTICLE_DEFAULTS.speed : o.speed;
      const spread = o.spread === undefined ? PARTICLE_DEFAULTS.spread : o.spread;
      const angle = o.angle === undefined ? PARTICLE_DEFAULTS.angle : o.angle;
      const life = o.life === undefined ? PARTICLE_DEFAULTS.life : o.life;
      const gravity = o.gravity === undefined ? PARTICLE_DEFAULTS.gravity : o.gravity;
      const size = o.size === undefined ? PARTICLE_DEFAULTS.size : o.size;
      const drag = o.drag === undefined ? PARTICLE_DEFAULTS.drag : o.drag;
      const palette = Array.isArray(color) ? color : null;

      for (let i = 0; i < count; i++) {
        const p = take();
        const a = angle + (U.rng() - 0.5) * spread;
        const sp = speed * (0.35 + 0.65 * U.rng());
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
        p.maxLife = life * (0.6 + 0.4 * U.rng());
        p.life = p.maxLife;
        p.size = size;
        p.gravity = gravity;
        p.drag = drag;
        p.color = palette ? palette[(U.rng() * palette.length) | 0] : color;
      }
    }

    function update(dt) {
      for (let i = items.length - 1; i >= 0; i--) {
        const p = items[i];
        p.life -= dt;
        if (p.life <= 0) {
          items[i] = items[items.length - 1];
          items.pop();
          free.push(p);
          continue;
        }
        p.vy += p.gravity * dt;
        let damp = 1 - p.drag * dt;
        if (damp < 0) damp = 0;
        p.vx *= damp;
        p.vy *= damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      if (stealIdx >= items.length) stealIdx = 0;
    }

    function render(ctx) {
      if (items.length === 0) return;
      const prevAlpha = ctx.globalAlpha;
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        // Hold full brightness, then fade over the last 40% of the life.
        const t = p.life / p.maxLife;
        ctx.globalAlpha = t < 0.4 ? t / 0.4 : 1;
        ctx.fillStyle = p.color;
        const s = p.size < 1 ? 1 : (p.size | 0);
        const half = s >> 1;
        ctx.fillRect(Math.round(p.x) - half, Math.round(p.y) - half, s, s);
      }
      ctx.globalAlpha = prevAlpha;
    }

    /** Retire every live particle (board reset / wave change). */
    function clear() {
      for (let i = 0; i < items.length; i++) free.push(items[i]);
      items.length = 0;
      stealIdx = 0;
    }

    return {
      items: items,
      capacity: PARTICLE_POOL,
      spawn: spawn,
      update: update,
      render: render,
      clear: clear
    };
  }

  /* -------------------------------------------------------------------------
   * EXPORT
   * ---------------------------------------------------------------------- */
  T.Entities = {
    // metrics other files need to place things
    BUNKER_W: BUNKER_W,
    BUNKER_H: BUNKER_H,
    WEAPON: WEAPON,
    FX: FX,
    TRAIL_LEN: TRAIL_LEN,
    weaponFor: weaponFor,

    // constructors
    makeShip: makeShip,
    makeEnemy: makeEnemy,
    makeShot: makeShot,
    makeBomb: makeBomb,
    makeUfo: makeUfo,
    makeBunker: makeBunker,
    makeParticleSystem: makeParticleSystem,

    // motion / animation
    updateShip: updateShip,
    updateShot: updateShot,
    updateBomb: updateBomb,
    updateUfo: updateUfo,

    // helpers
    resetShip: resetShip,
    shipRecoil: shipRecoil,
    shipSpawnX: shipSpawnX,
    shipMinX: shipMinX,
    shipMaxX: shipMaxX,
    shipMuzzleX: shipMuzzleX,
    shipSprite: shipSprite,
    enemySprite: enemySprite,
    bombSprite: bombSprite,
    ufoSprite: ufoSprite,

    // collision primitives
    aabb: aabb,
    isOffscreen: isOffscreen,
    rectHitsBunker: rectHitsBunker,
    damageBunker: damageBunker,
    erodeBunkerTop: erodeBunkerTop,
    bunkerIsGone: bunkerIsGone,
    resetBunker: resetBunker,
    drawBunker: drawBunker
  };

})(window.T = window.T || {});
