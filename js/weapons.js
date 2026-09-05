/* ===========================================================================
 * TOASTER INVADERS — js/weapons.js
 *
 * ROLE: the weapon layer. Loads after entities.js and before game.js, and owns
 * everything about what a ship is currently shooting with:
 *
 *   T.Weapons.LIST / BASE / byId / baseFor — the rosters: the 15 droppable
 *                                          upgrades (SPEC-WEAPONS.md §3) and
 *                                          the 9 characters' base weapons
 *                                          (SPEC-CHARACTERS.md §2)
 *   equip / tick / canFire / fire        — per-ship weapon state
 *   updateShot / onHit / renderShot      — per-mechanic projectile behaviour
 *   rollDrop / ammoFraction              — drop odds and the HUD bar
 *   makeCrate / updateCrate / hitCrate   — the winged utensil drawer
 *   makeToken / updateToken / renderToken— the tumbling weapon token
 *
 * Every projectile lives in `board.shots` and carries `shot.wid` (its weapon
 * id), which is how updateShot / onHit / renderShot dispatch. Shots come from a
 * single T.Util.Pool, so a machine-gunning espresso repeater allocates nothing.
 *
 * A ship also carries a cosmetic VARIANT index (`ship.variant`) beside its
 * kind, and it rides alongside the kind through fire(): the projectile is
 * built from the PARENT character's numbers and then wears that variant's
 * shot sprite, trail colour and fire-sound detune. A variant changes identity
 * and never a number — see the COSMETIC VARIANTS block below for why that is
 * the whole point, and for the three functions that are allowed to know.
 *
 * There are almost NO game rules here: this file does not award lives, run
 * waves or decide the board is over. It does have to kill things, because five
 * mechanics (the mega-jam splash, the baguette lance, the microwave beam, the
 * honey dipper's shield-piercing bead and the bacon strip's burning trail)
 * kill outside the plain shot-vs-enemy AABB test that game.js runs. Those go
 * through requestKill(), which hands the decision to game.js via the optional
 * `board.weaponKill` / `board.weaponKillUfo` hooks and only falls back to doing
 * the bookkeeping itself when the board has not installed them.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const C = T.C;
  const U = T.Util;
  const PAL = C.PAL;

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* -------------------------------------------------------------------------
   * MECHANIC TUNABLES
   *
   * T.C owns everything the SPEC puts in T.C — the crate/token loop, the syrup
   * slow, the screen metrics. What lives here is the per-mechanic feel of the
   * fifteen upgrades: muzzle velocities, arc gravities, fan angles, turn rates.
   * They are collected in one table (exported as T.Weapons.M) rather than
   * buried as literals down in the mechanics, exactly like entities.js keeps
   * its LOCAL METRICS block at the top.
   * ---------------------------------------------------------------------- */
  const M = {
    FIRE_RECOIL: 0.09,       // seconds the ship holds its firing frame
    CEILING_PAD: 8,          // px above PLAY_TOP a shot is retired at
    OFFSCREEN_PAD: 64,       // px beyond the screen a shot is retired at
    MUZZLE_INSET: 6,         // px a base shot's top edge starts INSIDE the ship
    WALL_L: C.FORM_MARGIN,               // reflecting walls for the pancake
    WALL_R: C.W - C.FORM_MARGIN,

    KNIFE_SPEED: 660,
    KNIFE_SPIN: 0.045,       // seconds per spin frame

    NOODLE_SPEED: 500,
    NOODLE_AMP: 74,          // px the noodle whips either side of its lane
    NOODLE_WAVELEN: 150,     // px of travel per full whip cycle

    CANNON_SPEED: 700,       // initial upward velocity of the lobbed slice
    CANNON_DRIFT: 118,       // |vx| — alternates side per shot, hence the arc
    CANNON_GRAVITY: 520,
    CANNON_SPIN: 0.07,
    SHRAPNEL_COUNT: 6,
    SHRAPNEL_SPEED: 300,
    SHRAPNEL_GRAVITY: 260,
    SHRAPNEL_LIFE: 0.85,

    SCATTER_COUNT: 7,
    SCATTER_ARC: 55 * DEG,   // total fan width
    SCATTER_SPEED: 530,
    SCATTER_LIFE: 1.4,

    ESPRESSO_SPEED: 880,
    ESPRESSO_JITTER: 4,      // px of muzzle scatter, so the stream shimmers

    CRUMPET_SPEED: 350,
    CRUMPET_TURN: 4.2,       // radians/sec — arcs onto its target, never snaps
    CRUMPET_LIFE: 3.2,
    /* A seeker that starts steering the instant it leaves the muzzle turns
     * sideways while it is still level with the shields and buries itself in
     * one. Measured on the real board with a player standing in a bunker gap:
     * 13 of 16 crumpets died on the player's OWN bunker. So the seeker ARMS
     * once it is clear of the shield line and flies its launch heading until
     * then — a quarter of a second of straight climb. */
    CRUMPET_ARM_Y: C.BUNKER_Y - 8,

    MEGAJAM_SPEED: 430,
    MEGAJAM_RADIUS: 70,      // splash radius, SPEC-WEAPONS §3

    /* A frisbee is FLAT once it is flying — but it is RELEASED climbing, and
     * that first beat is what gets it over the player's own shield line. A
     * pancake launched flat from the start covers PANCAKE_SPEED_X /
     * PANCAKE_SPEED_Y px sideways for every px it rises, and the bunker band
     * is 64px tall with only ~115px between shields: at the old 500/205 it
     * swept 156px across that band and hit a bunker essentially every time
     * (measured: 9 shots fired, 9 bunker hits, 0 toasters killed, on every
     * seed). So vx ramps in over PANCAKE_RELEASE seconds — near-vertical out
     * of the gap, flat and bouncing by the time it reaches the formation. */
    PANCAKE_SPEED_X: 430,
    PANCAKE_SPEED_Y: 470,    // launch climb, steep enough to clear the shields
    PANCAKE_RELEASE: 0.30,   // seconds spent climbing clear before it flattens
    PANCAKE_GLIDE_Y: 140,    // the long flat skim it settles into afterwards
    PANCAKE_FLATTEN: 700,    // px/s^2 it sheds climb at once it is clear
    PANCAKE_BOUNCES: 4,
    PANCAKE_SPIN: 0.055,

    /* The blade climbs SPEED^2 / (2 * GRAVITY) before it stalls. At 680/700
     * that is 330px — from the muzzle at y 628 it stalls at y 298, which only
     * ever reaches the bottom two rows of a fresh formation, and once those
     * are dead a full load kills almost nothing (measured: 6 toasters from 14
     * throws, x1.01 the base weapon's rate, i.e. not an upgrade at all).
     * 820/700 climbs 480px to y 148, so one throw sweeps a whole column on the
     * way up and again on the way down, which is the mechanic the spec asks
     * for. It still stalls well below PLAY_TOP (96), so it always comes back. */
    BLENDER_SPEED: 820,
    BLENDER_GRAVITY: 700,    // decelerate, stall, come back down
    BLENDER_SPIN: 0.035,

    CONDIMENT_SPEED: 620,
    CONDIMENT_ANGLE: 22 * DEG,

    BAGUETTE_W: 18,
    BAGUETTE_GROW: 0.35,     // seconds to full extension
    BAGUETTE_HOLD: 0.26,     // seconds at full height
    BAGUETTE_RETRACT: 0.24,

    BEAM_W: 26,
    BEAM_KILL_TIME: 0.22,    // seconds of contact before something in it dies
    BEAM_SCAN_HZ: 3.4,

    SYRUP_SPEED: 270,

    SOGGY_SPEED: 420,        // just enough to clear the bunker tops. Just.
    SOGGY_DRIFT: 62,
    SOGGY_GRAVITY: 900,
    SOGGY_DIE_Y: C.BUNKER_Y + 26,

    FULL_SPREAD: 15          // px between the four barrels of the full breakfast
  };

  /* -------------------------------------------------------------------------
   * UPGRADE ROSTER (SPEC-WEAPONS.md §3)
   *
   * BUTTER and JAM lead the list because they were the whole roster once; the
   * other seven base weapons live in the BASE table further down and are
   * deliberately absent here, because LIST is what rollDrop weights and what
   * the title screen advertises, and a base weapon does neither.
   *
   * Base weapons are infinite and keep the classic one-live-shot rule. The
   * fifteen upgrades drop that rule and fire on `fireDelay` instead; each
   * carries either `ammo` (volleys) or `duration` (seconds).
   * ---------------------------------------------------------------------- */
  const LIST = [
    {
      id: 'butter', name: 'BUTTER', tagline: 'SPREAD THE PAIN',
      color: PAL.butter, base: true, ammo: 0, duration: 0,
      fireDelay: 0, weight: 0,
      mechanic: 'one live pat of butter at a time, wide and slow'
    },
    {
      id: 'jam', name: 'JAM', tagline: 'SEEDLESS AND SEETHING',
      color: PAL.jamRed, base: true, ammo: 0, duration: 0,
      fireDelay: 0, weight: 0,
      mechanic: 'one live glob of jam at a time, narrow and fast'
    },

    {
      id: 'butterKnife', name: 'BUTTER KNIVES', tagline: 'STRAIGHT THROUGH THE LOT',
      color: PAL.chromeLt, ammo: 14, fireDelay: 0.28, weight: 12,
      mechanic: 'spinning knives that pierce every toaster in their path'
    },
    {
      id: 'spaghetti', name: 'SPAGHETTI GUN', tagline: 'AL DENTE, AL DEADLY',
      color: '#f5dd9a', ammo: 18, fireDelay: 0.30, weight: 11,
      mechanic: 'a limp noodle whipping side to side as it climbs'
    },
    {
      id: 'toastCannon', name: 'TOAST CANNON', tagline: 'INCOMING BREAKFAST',
      color: PAL.crust, ammo: 8, fireDelay: 0.55, weight: 10,
      mechanic: 'lobs a slice on an arc; airbursts into six crumb shrapnel'
    },
    {
      id: 'scattergun', name: 'CEREAL SCATTERGUN', tagline: 'PART OF A BALANCED MASSACRE',
      // BALANCE: spec table says 12. Seven pellets a pull is the highest raw
      // output in the roster; measured over three seeds a 12-round load
      // cleared 78% of a 55-toaster wave against the spec's 33-50% target.
      // 8 rounds re-measures at 59%. Nothing about the mechanic changed.
      color: '#e9a13b', ammo: 8, fireDelay: 0.50, weight: 11,
      mechanic: 'seven cereal loops across a 55 degree fan'
    },
    {
      id: 'espresso', name: 'ESPRESSO REPEATER', tagline: 'NO DECAF SURVIVORS',
      color: '#b57a45', ammo: 60, fireDelay: 0.07, weight: 10,
      mechanic: 'scalding beans, fourteen a second, relentless'
    },
    {
      id: 'crumpet', name: 'HOMING CRUMPETS', tagline: 'NOOKS, CRANNIES, CASUALTIES',
      color: '#e8c98a', ammo: 16, fireDelay: 0.35, weight: 9,
      mechanic: 'steers toward the nearest living toaster every frame'
    },
    {
      id: 'megaJam', name: 'MEGA JAM MORTAR', tagline: 'APPLY LIBERALLY',
      color: PAL.jamLite, ammo: 6, fireDelay: 0.70, weight: 8,
      mechanic: 'splatters everything within seventy pixels of impact'
    },
    {
      id: 'pancake', name: 'PANCAKE FRISBEE', tagline: 'FLIPS OFF THE WALLS',
      // BALANCE: spec table says 10. Roughly 70% of its rounds connect, but ten
      // of them only clear 13% of a wave — it is a skimmer, not a sniper, and
      // a ten-round magazine is the smallest in the roster after the mortars.
      // 16 rounds re-measures at 21%.
      color: '#e0b06a', ammo: 16, fireDelay: 0.40, weight: 8,
      mechanic: 'ricochets off the side walls up to four times'
    },
    {
      id: 'blender', name: 'BLENDER BLADE', tagline: 'IT COMES BACK. DUCK.',
      // Load is the spec table's. It measured at 11% of a wave and x1.01 the
      // base weapon's kill rate, but the cause was RANGE, not magazine size —
      // see M.BLENDER_SPEED. With the blade climbing far enough to sweep a
      // whole column, the spec's own 8 rounds re-measure at 45%.
      color: '#9fe8ff', ammo: 8, fireDelay: 0.60, weight: 7,
      mechanic: 'flies up, stalls, boomerangs back down, lethal both ways'
    },
    {
      id: 'condiments', name: 'KETCHUP & MUSTARD', tagline: 'BOTH. ALWAYS BOTH.',
      color: '#ff5a4d', ammo: 30, fireDelay: 0.16, weight: 9,
      mechanic: 'twin diagonal streams at plus and minus 22 degrees'
    },
    {
      id: 'baguette', name: 'BAGUETTE LANCE', tagline: 'EN GARDE, TOASTER',
      color: '#deb06a', ammo: 5, fireDelay: 1.00, weight: 6, attached: true,
      mechanic: 'extends upward over 0.35s, clears the column, retracts'
    },
    {
      id: 'microwave', name: 'MICROWAVE RAY', tagline: 'TWO MINUTES ON HIGH',
      // BALANCE: spec table says 7.0s. A held beam plus a ship that crosses the
      // whole field in 3.3s sweeps the formation twice over: measured, seven
      // seconds cleared 76% of a wave. 5.0s re-measures at 64% — still the most
      // brutal thing you can be holding, and still comfortably long enough to
      // walk it across the board once.
      color: '#7ef0ff', duration: 5.0, fireDelay: 0, weight: 6,
      attached: true, held: true, drainWhileFiring: true,
      mechanic: 'a held beam; anything in it dies after 0.22s of contact'
    },
    {
      id: 'syrup', name: 'SYRUP TRAP', tagline: 'STICKY SITUATION',
      color: '#d08a35', ammo: 5, fireDelay: 0.80, weight: 6,
      mechanic: 'any hit slows the whole formation for six seconds'
    },
    {
      id: 'soggy', name: 'SOGGY BREAD', tagline: '...oh no.',
      color: '#9aa7a0', ammo: 6, fireDelay: 0.40, weight: 4,
      mechanic: 'arcs, falls short, dies over the bunkers. The gag.'
    },
    {
      id: 'fullEnglish', name: 'THE FULL BREAKFAST', tagline: 'EVERYTHING, ALL AT ONCE.',
      color: '#ffe27a', duration: 6.0, fireDelay: 0.10, weight: 3, jackpot: true,
      mechanic: 'knives, spaghetti, crumpets and espresso, simultaneously'
    }
  ];

  /** id → def. Built once; byId() throws on anything that is not in it. */
  const BY_ID = Object.create(null);
  for (let i = 0; i < LIST.length; i++) BY_ID[LIST[i].id] = LIST[i];

  /**
   * The toast cannon's shrapnel is a projectile with no roster entry of its own
   * — it is never equipped, never drops and never appears in the HUD — but it
   * still needs a def so a shot carrying it looks like every other shot.
   * It lives in DEFS (the projectile lookup) and NOT in BY_ID (the roster).
   */
  const SHRAPNEL_DEF = {
    id: 'shrapnel', name: 'SHRAPNEL', tagline: '', color: PAL.crust,
    ammo: 0, fireDelay: 0, weight: 0, internal: true,
    mechanic: 'crumb fragment thrown by a toast cannon airburst'
  };

  /**
   * The bacon strip's trail ticker and the coffee mug's spent-drip puff are the
   * same sort of thing as the shrapnel: real projectiles with no roster entry,
   * never equipped, never dropped, never in the HUD. `base` is deliberately
   * absent on both — hasLiveShot() counts base shots, and neither of these may
   * hold the one-live-shot rule open.
   */
  const TRAIL_DEF = {
    id: 'sizzleTrail', name: 'SIZZLE TRAIL', tagline: '', color: PAL.coil,
    ammo: 0, duration: 0, fireDelay: 0, weight: 0, internal: true,
    mechanic: 'the burning embers a bacon strip leaves behind it'
  };

  const FIZZLE_DEF = {
    id: 'mugFizzle', name: 'FIZZLE', tagline: '', color: '#9b6a4a',
    ammo: 0, duration: 0, fireDelay: 0, weight: 0, internal: true,
    mechanic: 'the puff of steam a spent drip goes out in'
  };

  const DEFS = Object.create(null);
  for (let i = 0; i < LIST.length; i++) DEFS[LIST[i].id] = LIST[i];
  DEFS.shrapnel = SHRAPNEL_DEF;
  DEFS.sizzleTrail = TRAIL_DEF;
  DEFS.mugFizzle = FIZZLE_DEF;

  /** Roster entry for `id`. Throws on an unknown id — a typo is a bug, loudly. */
  function byId(id) {
    const def = BY_ID[id];
    if (!def) throw new Error('T.Weapons.byId: unknown weapon id "' + id + '"');
    return def;
  }

  /**
   * The weapon a character reverts to. Nine characters, nine base weapons: the
   * mapping is DATA in T.C.BASE_WEAPONS (SPEC-CHARACTERS §2), not a branch, so
   * adding a character never means editing this function. An unknown kind falls
   * back to butter rather than throwing — a ship built by an older file, or by
   * a harness, still gets something to shoot with.
   */
  function baseFor(kind) {
    const rows = C.BASE_WEAPONS;
    const row = rows ? rows[kind] : null;
    return (row && row.wid) ? row.wid : 'butter';
  }

  /* =========================================================================
   * COSMETIC VARIANTS  (SPEC-VARIANTS.md §1)
   *
   * A ship carries a variant INDEX (`ship.variant`, 0..2) alongside its kind,
   * and it rides beside `ship.kind` everywhere that already flows into fire():
   * a shot is spawned with its character's own projectile geometry and then
   * WEARS the variant's sprite, trail colour and fire-sound detune.
   *
   * A VARIANT CHANGES IDENTITY, NEVER NUMBERS. Every stat lookup in this file
   * — baseSpeed, PROJ, refire, MUG_RANGE, PEPPER_PELLETS, CHEESE_BOUNCES,
   * MILK_GROW_DIST, BACON_TRAIL_* — reads the PARENT character row and is not
   * reachable from a variant row, which is what lets all 27 versions inherit
   * the +/-20% balance band measured over 720 seeded runs instead of turning
   * it into a 27-way problem. The only three things below hand out are a
   * sprite name, a colour and a cents offset. Nothing else may be added here.
   *
   * The 15 upgrade weapons are shared and untouched by any of this: a player
   * holding an upgrade shows the UPGRADE (see shotVariant), and dropping back
   * to their base weapon on ammo-out returns them to their own character AND
   * their own variant, because the variant lives on the ship and is re-read at
   * every spawn rather than being copied into the weapon state.
   * ====================================================================== */

  /** This character's three variant rows, or null if it has no variant data. */
  function variantsOf(kind) {
    const rows = C.BASE_WEAPONS;
    const row = rows ? rows[kind] : null;
    const list = row && row.variants;
    return (list && list.length > 0) ? list : null;
  }

  /**
   * The variant index a ship is wearing, clamped into its character's roster.
   * A ship built by an older file (or a harness) carries no `variant` at all
   * and is variant 0 — the default, which is byte-for-byte the look the game
   * had before variants existed.
   */
  function variantIndexOf(ship) {
    const list = ship ? variantsOf(ship.kind) : null;
    if (!list) return 0;
    const n = ship.variant;
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    return U.clamp(n | 0, 0, list.length - 1);
  }

  /** The variant ROW a ship is wearing — identity fields only — or null. */
  function variantOf(ship) {
    const list = ship ? variantsOf(ship.kind) : null;
    if (!list) return null;
    return list[variantIndexOf(ship)] || null;
  }

  /**
   * The variant a projectile of `wid` fired by `ship` should wear, or null.
   *
   * Null for every one of the fifteen upgrades, and for a base weapon that is
   * not this character's own (a bread slice holding JAM shows jam): an upgrade
   * is shared, and showing your variant on it would misreport what you picked
   * up. Null too for the internal projectiles — shrapnel, the bacon strip's
   * ember ticker, the spent drip's puff — none of which is in BASE_BY_WID.
   */
  function shotVariant(ship, wid) {
    if (!ship) return null;
    const def = BASE_BY_WID[wid];
    if (!def || def.char !== ship.kind) return null;
    return variantOf(ship);
  }

  /**
   * `name` re-skinned for variant index `vi`. T.Sprites caches the derived
   * name, so a shot asking for its sprite every frame allocates nothing; a
   * sprite with no variant at that index (every upgrade projectile, the
   * bacon ember) comes back unchanged, and a sprites.js without the variant
   * pipeline at all degrades to the plain name rather than throwing.
   */
  function variantSprite(name, vi) {
    if (!name || !vi) return name;         // variant 0 IS the plain sprite
    const S = T.Sprites;
    if (!S || typeof S.variantName !== 'function') return name;
    try {
      return S.variantName(name, vi);
    } catch (err) {
      return name;
    }
  }

  /* -------------------------------------------------------------------------
   * PROJECTILE METRICS
   * Hitbox + sprite per projectile flavour. Hitboxes are WEAPON stats (SPEC §4
   * makes that explicit for butter vs jam), so they are stated here rather than
   * inherited from whatever size a sprite happens to be.
   * ---------------------------------------------------------------------- */
  const PROJ = {
    butter:      { w: 10, h: 16, sprite: 'butter',   dmg: 9 },
    jam:         { w: 6,  h: 16, sprite: 'jamShot',  dmg: 5 },
    butterKnife: { w: 14, h: 14, sprite: 'wKnife0',  dmg: 6 },
    spaghetti:   { w: 8,  h: 22, sprite: 'wNoodle',  dmg: 5 },
    toastCannon: { w: 18, h: 16, sprite: 'wToast',   dmg: 11 },
    shrapnel:    { w: 6,  h: 6,  sprite: 'wCrumb',   dmg: 4 },
    scattergun:  { w: 10, h: 10, sprite: 'wLoop',    dmg: 5 },
    espresso:    { w: 6,  h: 8,  sprite: 'wBean',    dmg: 3 },
    crumpet:     { w: 16, h: 14, sprite: 'wCrumpet', dmg: 8 },
    megaJam:     { w: 18, h: 18, sprite: 'wJamGlob', dmg: 14 },
    pancake:     { w: 20, h: 10, sprite: 'wPancake0', dmg: 7 },
    blender:     { w: 20, h: 20, sprite: 'wBlade0',  dmg: 8 },
    condiments:  { w: 8,  h: 12, sprite: 'wKetchup', dmg: 5 },
    baguette:    { w: M.BAGUETTE_W, h: 24, sprite: 'wBaguette', dmg: 0 },
    microwave:   { w: M.BEAM_W, h: 16, sprite: null, dmg: 0 },
    syrup:       { w: 14, h: 18, sprite: 'wSyrup',   dmg: 8 },
    soggy:       { w: 16, h: 12, sprite: 'wSoggy',   dmg: 6 },

    /* Three projectiles with no roster entry and no trigger of their own. They
     * all carry an EMPTY collision rect, which is what keeps game.js's generic
     * shot passes away from them: isSolidShot() there wants w > 0 && h > 0.
     *   sizzleTrail  the bacon trail's ticker — ages, kills and draws the embers
     *   mugFizzle    the spent drip's puff of steam, decorative only
     * (the refire husk reuses its own shot object; see beginSpent) */
    sizzleTrail: { w: 0, h: 0, sprite: 'sizzleTrail', dmg: 0 },
    mugFizzle:   { w: 0, h: 0, sprite: null,          dmg: 0 }
  };

  /* =========================================================================
   * THE NINE BASE WEAPONS  (SPEC-CHARACTERS.md §2)
   *
   * One per playable character, authored as data in T.C.BASE_WEAPONS so the
   * balance harness can tune the whole roster from one file. This block turns
   * each row into the same shape everything else here already speaks:
   *
   *   BASE[charId]      the weapon def, for baseFor / the select screen
   *   BY_ID[wid]        so equip(ship, baseFor(kind)) resolves for all nine
   *   DEFS[wid]         so spawn() can stamp a def onto the projectile
   *   PROJ[wid]         hitbox, sprite and bunker carve radius
   *   MECH[wid]         which of the eight mechanics below the shot dispatches to
   *
   * BUTTER and JAM already have LIST entries (they are the two the upgrade
   * roster has always carried), so those are ENRICHED in place rather than
   * replaced: LIST stays exactly the 2 base + 15 upgrade roster it was, and the
   * seven new base weapons deliberately stay OUT of it — LIST is what rollDrop
   * and the title screen's attract wheel walk, and a base weapon can neither
   * drop nor be advertised as an upgrade.
   * ====================================================================== */

  /** Prose for the roster, in the same voice as LIST's `mechanic` lines. */
  const BASE_MECHANIC_TEXT = {
    flake:  'inherits your sideways speed and keeps it the whole flight',
    drip:   'the fastest thing on the board, and it fizzles out early',
    pepper: 'three peppercorns at minus nine, zero and plus nine degrees',
    honey:  'a slow golden bead that passes straight through your own shields',
    rind:   'launches at an angle, alternating sides, and bounces off a wall',
    sizzle: 'lays burning embers behind it that kill what marches into them',
    splash: 'a splash that widens as it climbs — huge at range, tiny up close'
  };

  /** charId -> def, and wid -> def. Built once, at load. */
  const BASE = Object.create(null);
  const BASE_BY_WID = Object.create(null);

  (function buildBaseRoster() {
    const rows = C.BASE_WEAPONS || {};
    const order = C.CHARACTER_ORDER || Object.keys(rows);
    for (let i = 0; i < order.length; i++) {
      const row = rows[order[i]];
      if (!row || !row.wid) continue;

      // butter and jam are already in LIST; everything else is new.
      const def = BY_ID[row.wid] || {
        id: row.wid,
        name: row.weapon,
        tagline: row.tagline,
        color: row.color,
        base: true,
        ammo: 0,
        duration: 0,
        fireDelay: 0,
        weight: 0,
        mechanic: BASE_MECHANIC_TEXT[row.wid] || row.advantage || ''
      };

      // Fields the character roster adds to every base weapon, old two included.
      def.char = row.id;          // which character throws it
      def.speed = row.speed;
      def.refire = row.refire || 0;
      def.sfx = row.sfx;
      def.mech = row.mech || 'plain';

      BASE[row.id] = def;
      BASE_BY_WID[row.wid] = def;
      BY_ID[row.wid] = def;
      DEFS[row.wid] = def;
      PROJ[row.wid] = { w: row.w, h: row.h, sprite: row.shot, dmg: row.dmg };
    }
  })();

  /**
   * Muzzle velocity for a base weapon.
   *
   * The ROSTER ROW WINS, for all nine — including butter and jam. It has to:
   * SPEC-CHARACTERS §5 makes T.C.BASE_WEAPONS the one surface the balance
   * harness tunes, and a special case that reached past the table for two of
   * the nine would let a tuned bread speed be silently ignored. SPEC.md §4's
   * SHOT_SPEED_BUTTER / SHOT_SPEED_JAM remain the fallback (and today the two
   * rows carry exactly those two values, so nothing moves).
   */
  function baseSpeed(wid) {
    const def = BASE_BY_WID[wid];
    if (def && typeof def.speed === 'number' && def.speed > 0) return def.speed;
    if (wid === 'jam') return C.SHOT_SPEED_JAM;
    return C.SHOT_SPEED_BUTTER;
  }

  /* Interned two-frame sprite tables — looked up, never concatenated, so the
   * render loop makes no strings (SPEC §12). */
  const KNIFE_FRAMES   = ['wKnife0', 'wKnife1'];
  const PANCAKE_FRAMES = ['wPancake0', 'wPancake1'];
  const BLADE_FRAMES   = ['wBlade0', 'wBlade1'];
  const CRATE_FRAMES   = ['crate0', 'crate1'];
  const CONDIMENT_SPRITES = ['wKetchup', 'wMustard'];
  const CONDIMENT_COLORS  = ['#ff5a4d', '#ffc02e'];

  /* The milk splash swaps sprite as it widens. Interned from the roster row so
   * the three names are stated once, in T.C, next to MILK_W_MIN / MILK_W_MAX. */
  const SPLASH_FRAMES = (C.BASE_WEAPONS && C.BASE_WEAPONS.milk &&
                         C.BASE_WEAPONS.milk.shotGrow) ||
                        ['splash0', 'splash1', 'splash2'];

  /* -------------------------------------------------------------------------
   * SMALL SERVICES — audio and sprites, both entirely optional
   *
   * weapons.js loads before sprites have been rasterized and can be driven by a
   * headless harness with no WebAudio at all, so every call into a sibling is
   * guarded and degrades to something visible rather than throwing.
   * ---------------------------------------------------------------------- */

  /* One reusable options object for sfx(). T.Audio.play reads every field
   * synchronously, so handing it the same object every time allocates nothing
   * — and the espresso repeater fires fourteen times a second (SPEC §12). */
  const SFX_OPTS = { gain: 1, detune: 0 };

  /**
   * Fire-and-forget one-shot. A missing name or a missing T.Audio is a no-op.
   *
   * `detune` is a cents offset — TIMBRE ONLY, never length or gain. It is how
   * a character's three cosmetic variants sound related but distinct
   * (SPEC-VARIANTS.md §4); it comes from the variant row's `sfxDetune` and is
   * the only variant value this file passes anywhere.
   */
  function sfx(name, gain, detune) {
    const A = T.Audio;
    if (!A || typeof A.play !== 'function') return;
    try {
      if (gain === undefined && !detune) {
        A.play(name);
        return;
      }
      SFX_OPTS.gain = (gain === undefined) ? 1 : gain;
      SFX_OPTS.detune = detune || 0;
      A.play(name, SFX_OPTS);
    } catch (err) {
      /* audio must never take a frame down */
    }
  }

  /**
   * The microwave hum is the one LOOPING weapon sound. audio.js may expose it
   * as start/stopMicrowave, as a generic start/stopLoop, or not at all; try
   * each in turn.
   *
   * The count is a reference count held by BEAM SHOTS, not by calls: each beam
   * takes at most one reference (`shot.hum`) and gives it back exactly once,
   * however it dies. Two players beaming at once therefore share one hum, and
   * one of them letting go never silences the other — and nothing leaks when a
   * beam is killed twice over (weapon swap, then the pool retiring it).
   */
  let humRefs = 0;

  function acquireHum(s) {
    if (s.hum) return;
    s.hum = 1;
    humRefs++;
    if (humRefs !== 1) return;
    const A = T.Audio;
    if (!A) return;
    try {
      if (typeof A.startMicrowave === 'function') A.startMicrowave();
      else if (typeof A.startLoop === 'function') A.startLoop('microwaveHum');
      else if (typeof A.play === 'function') A.play('microwaveHum');
    } catch (err) { /* ignore */ }
  }

  function releaseHum(s) {
    if (!s.hum) return;
    s.hum = 0;
    humRefs--;
    if (humRefs > 0) return;
    humRefs = 0;
    const A = T.Audio;
    if (!A) return;
    try {
      if (typeof A.stopMicrowave === 'function') A.stopMicrowave();
      else if (typeof A.stopLoop === 'function') A.stopLoop('microwaveHum');
    } catch (err) { /* ignore */ }
  }

  /** A built sprite, or null. Never throws, so a missing art asset just draws flat. */
  function sprite(name) {
    const S = T.Sprites;
    if (!S || !name || typeof S.get !== 'function') return null;
    try {
      if (typeof S.has === 'function' && !S.has(name)) return null;
      const s = S.get(name);
      return (s && s.canvas) ? s : null;
    } catch (err) {
      return null;
    }
  }

  /** Blit `name` centred on (cx, cy); fall back to a flat w x h block. */
  function blitCentered(ctx, name, cx, cy, w, h, color) {
    const s = sprite(name);
    if (s) {
      ctx.drawImage(s.canvas, Math.round(cx - s.w / 2), Math.round(cy - s.h / 2));
      return;
    }
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
  }

  /** Particle burst through the board's system, if it has one. */
  function burst(board, x, y, opts) {
    const p = board && board.particles;
    if (p && typeof p.spawn === 'function') p.spawn(x, y, opts);
  }

  /** A tuned debris preset from entities.js, or undefined (spawn's defaults). */
  function fx(name) {
    const table = T.Entities && T.Entities.FX;
    return table ? table[name] : undefined;
  }

  /* Scratch opts for a recoloured burst. The particle system reads every field
   * synchronously inside spawn(), so one shared object is safe and keeps the
   * hot path allocation-free. Undefined fields are fine: entities.js tests
   * each one with `=== undefined` and falls back to its own default. */
  const TINT_OPTS = {
    count: 0, color: null, speed: 0, spread: 0,
    angle: 0, life: 0, gravity: 0, size: 0, drag: 0
  };

  /* A one-entry palette, so a tinted burst draws from an ARRAY exactly as the
   * preset it replaces did. That is not tidiness: entities.js spends one
   * T.Util.rng() per particle picking out of a palette and none at all on a
   * flat colour, so handing it a bare string would consume the shared seeded
   * stream at a different rate and quietly move every seeded balance run. A
   * cosmetic variant may not move a measured number, and this is the one place
   * in the file where a colour could have. */
  const TINT_COLORS = [null];

  /**
   * The same debris preset, thrown in a different colour — how a base shot's
   * splatter picks up its variant's `trailColor` (SPEC-VARIANTS.md §1: colour
   * is one of the few things a variant may change). With no preset or no
   * colour it degrades to a plain burst.
   */
  function burstTinted(board, x, y, preset, color) {
    if (!preset || !color) {
      burst(board, x, y, preset);
      return;
    }
    const o = TINT_OPTS;
    o.count = preset.count;
    o.speed = preset.speed;
    o.spread = preset.spread;
    o.angle = preset.angle;
    o.life = preset.life;
    o.gravity = preset.gravity;
    o.size = preset.size;
    o.drag = preset.drag;
    if (Array.isArray(preset.color)) {
      TINT_COLORS[0] = color;
      o.color = TINT_COLORS;       // same rng cost as the palette it replaces
    } else {
      o.color = color;
    }
    burst(board, x, y, o);
  }

  /* -------------------------------------------------------------------------
   * KILLING THINGS THAT ARE NOT UNDER A PROJECTILE
   *
   * Three mechanics kill outside game.js's shot x enemy AABB pass: the mega-jam
   * splash, the baguette lance and the microwave beam. game.js stays the
   * authority — if it installs `board.weaponKill(enemy, shot)` /
   * `board.weaponKillUfo(ufo, shot)` those are used and scoring, popups and
   * explosions stay in one place. The fallbacks below only run when the board
   * has no hook, and are written to be idempotent: whichever side gets there
   * first, the other sees a dead target and does nothing.
   * ---------------------------------------------------------------------- */

  function requestKill(board, enemy, shot) {
    if (!enemy || !enemy.alive) return false;
    if (typeof board.weaponKill === 'function') {
      board.weaponKill(enemy, shot);
      return true;
    }
    enemy.alive = false;
    if (typeof board.aliveCount === 'number') board.aliveCount--;
    const owner = shot && shot.owner;
    if (owner && typeof owner.score === 'number') owner.score += (enemy.points || 0);
    burst(board, enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, fx('crumb'));
    sfx('enemyHit');
    return true;
  }

  function requestKillUfo(board, shot) {
    const u = board.ufo;
    if (!u || u.alive === false) return false;
    if (typeof board.weaponKillUfo === 'function') {
      board.weaponKillUfo(u, shot);
      return true;
    }
    u.alive = false;
    board.ufo = null;
    const owner = shot && shot.owner;
    const idx = U.clamp(u.scoreIndex | 0, 0, C.UFO_SCORES.length - 1);
    if (owner && typeof owner.score === 'number') owner.score += C.UFO_SCORES[idx];
    burst(board, u.x + u.w / 2, u.y + u.h / 2, fx('chrome'));
    sfx('ufoHit');
    const A = T.Audio;
    if (A && typeof A.stopUfo === 'function') {
      try { A.stopUfo(); } catch (err) { /* ignore */ }
    }
    return true;
  }

  /* -------------------------------------------------------------------------
   * SHOT POOL
   *
   * One pool for every projectile on both boards. Pool.release() swap-removes,
   * so `items` order is not stable and anything walking it releases BACKWARDS.
   * ---------------------------------------------------------------------- */

  const TRAIL_LEN = 3;   // matches game.js's shot trail history

  function makeShotObject() {
    const trail = new Array(TRAIL_LEN);
    for (let i = 0; i < TRAIL_LEN; i++) trail[i] = { x: 0, y: 0 };
    return {
      // --- the shape entities.js/game.js already understand ---------------
      x: 0, y: 0, w: 0, h: 0,
      vx: 0, vy: 0,
      kind: 'butter',
      wid: 'butter',
      sprite: null,
      damageRadius: 6,
      color: PAL.butter,
      trailColor: PAL.butterLt,
      owner: null,
      alive: false,
      trail: trail,

      // --- per-mechanic scratch, reset on every spawn ---------------------
      def: null,
      attached: false,
      t: 0,            // age in seconds
      dist: 0,         // distance travelled, drives the spaghetti sine
      ang: -Math.PI / 2,
      gravity: 0,
      life: 0,         // seconds remaining, 0 = no limit
      bounces: 0,
      baseX: 0,        // lane centre the noodle whips around
      variant: 0,      // condiment colour, cannon drift side, rind launch side
      /* The COSMETIC variant this shot is wearing (SPEC-VARIANTS.md §1), which
       * is a different thing entirely from `variant` above. It is only ever
       * read for a sprite name and a colour — never for geometry, and never by
       * anything that moves the shot. The milk splash re-skins itself as it
       * grows, so the index has to travel with the projectile. */
      skin: 0,
      detonated: false,
      seg: 0,          // px of climb since the bacon strip last dropped an ember
      embers: null,    // the trail ticker's handle on board.baconTrail

      // --- attached-weapon geometry (kept out of the collision rect) ------
      bx: 0, by: 0, bw: 0, bh: 0,
      ufoT: 0,         // accumulated beam contact with the bonus toaster
      crateT: 0,       // accumulated beam contact with the utensil drawer
      hum: 0,          // 1 while THIS shot holds a reference on the beam hum
      contact: null,   // per-enemy beam contact, allocated by attached weapons
      list: null       // the board.shots array this shot was pushed into
    };
  }

  const shotPool = new U.Pool(makeShotObject);

  /**
   * Dead shots waiting to be recycled.
   *
   * A board drops a spent shot from board.shots on its own schedule, and there
   * is more than one reasonable schedule (this frame's update pass, or the next
   * one). Handing an object straight back to the free list would let a board
   * still holding it receive it again as a brand-new shot — the same object in
   * board.shots twice. So a retired shot waits here until its board has
   * genuinely let go of it, and only then becomes reusable.
   */
  const quarantine = [];

  /** Move every quarantined shot whose board has dropped it back into the pool. */
  function drainQuarantine() {
    for (let i = quarantine.length - 1; i >= 0; i--) {
      const q = quarantine[i];
      if (q.list && q.list.indexOf(q) !== -1) continue;    // still referenced
      q.list = null;
      quarantine[i] = quarantine[quarantine.length - 1];
      quarantine.pop();
      shotPool.free.push(q);
    }
  }

  /**
   * Take a shot out of the pool with every field back at its spawn value.
   *
   * If the free list is empty, sweep the live list first: a board that drops
   * consumed shots without ever passing them back through updateShot leaves
   * them marked dead but still held by the pool, and this is where they are
   * reclaimed. Everything goes out through the quarantine, so the sweep can
   * never hand back something a board is still walking.
   */
  function obtainShot() {
    drainQuarantine();
    if (shotPool.free.length === 0) {
      const items = shotPool.items;
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].alive) retireShot(items[i]);
      }
      drainQuarantine();
    }
    const s = shotPool.obtain();
    s.x = 0; s.y = 0; s.w = 0; s.h = 0;
    s.vx = 0; s.vy = 0;
    s.kind = 'butter';
    s.wid = 'butter';
    s.sprite = null;
    s.damageRadius = 6;
    s.color = PAL.butter;
    s.trailColor = PAL.butterLt;
    s.owner = null;
    s.alive = true;
    s.def = null;
    s.attached = false;
    s.t = 0;
    s.dist = 0;
    s.ang = -Math.PI / 2;
    s.gravity = 0;
    s.life = 0;
    s.bounces = 0;
    s.baseX = 0;
    s.variant = 0;
    s.skin = 0;
    s.detonated = false;
    s.seg = 0;
    s.embers = null;
    s.bx = 0; s.by = 0; s.bw = 0; s.bh = 0;
    s.ufoT = 0;
    s.crateT = 0;
    s.hum = 0;
    return s;
  }

  /**
   * Retire a shot: mark it dead and quarantine it for reuse. Idempotent —
   * Pool.release ignores anything that is not live, and only the call that
   * actually retires it moves it on. Pool.release swap-removes and pushes the
   * object onto `free`, so popping straight afterwards takes back exactly it.
   */
  function retireShot(s) {
    if (!s) return;
    s.alive = false;
    releaseHum(s);
    if (shotPool.release(s)) {
      shotPool.free.pop();
      quarantine.push(s);
    }
  }

  /**
   * Hand every pooled shot back — board teardown, wave reset, quitting to the
   * title. Any beam still humming lets go of its reference on the way out, and
   * the quarantine empties because no board is entitled to those shots now.
   */
  function releaseAllShots() {
    const items = shotPool.items;
    for (let i = items.length - 1; i >= 0; i--) {
      items[i].alive = false;
      releaseHum(items[i]);
      items[i].list = null;
    }
    shotPool.releaseAll();
    for (let i = 0; i < quarantine.length; i++) {
      quarantine[i].list = null;
      shotPool.free.push(quarantine[i]);
    }
    quarantine.length = 0;
  }

  /** board.shots, created on demand so a board built before us still works. */
  function shotsOf(board) {
    if (!board.shots) board.shots = [];
    return board.shots;
  }

  /**
   * Spawn one projectile of weapon `wid` centred on (cx, cy) and push it into
   * board.shots. Returns the shot so the caller can tune its mechanic fields.
   */
  function spawn(board, ship, wid, cx, cy) {
    const p = PROJ[wid] || PROJ.butter;
    const def = DEFS[wid] || SHRAPNEL_DEF;
    const s = obtainShot();
    s.wid = wid;
    s.def = def;
    s.kind = wid;          // base shots keep the classic 'butter' / 'jam'
    s.w = p.w;
    s.h = p.h;
    s.x = cx - p.w / 2;
    s.y = cy - p.h / 2;
    s.sprite = p.sprite;
    s.damageRadius = p.dmg;
    s.color = def.color;
    // The two original base weapons keep their hand-picked trail tints, and
    // they are the EXACT two literals drawBase painted with before the trail
    // started taking its colour from the shot (PAL.butterLt for the butter
    // dots, PAL.jamRed for the jam streak). That equality is the whole reason
    // a ship carrying no variant data at all — a harness ship, an older save,
    // a character row with no `variants` — still draws the pre-variant streak.
    // Every other weapon, base or upgrade, streaks in its own roster colour.
    s.trailColor = (wid === 'butter') ? PAL.butterLt
                 : (wid === 'jam') ? PAL.jamRed
                 : def.color;

    /* COSMETIC VARIANT (SPEC-VARIANTS.md §1). Geometry is already stamped from
     * PROJ above, off the PARENT character row, and nothing below touches it:
     * a variant only re-skins the sprite and re-colours the trail. Upgrades
     * and internal projectiles get null here and are left exactly as they were.
     */
    const v = shotVariant(ship, wid);
    if (v) {
      s.skin = variantIndexOf(ship);
      s.sprite = variantSprite(p.sprite, s.skin);
      if (v.trailColor) s.trailColor = v.trailColor;
    }

    s.owner = ship;
    s.baseX = cx;
    for (let i = 0; i < TRAIL_LEN; i++) {
      s.trail[i].x = s.x;
      s.trail[i].y = s.y;
    }
    const list = shotsOf(board);
    s.list = list;
    list.push(s);
    return s;
  }

  /* -------------------------------------------------------------------------
   * PER-SHIP WEAPON STATE
   * ---------------------------------------------------------------------- */

  /**
   * Give `ship` weapon `id` at full ammo / duration.
   * ship.weapon = {def, ammo, timer, cooldown, phase, beam}
   *   ammo    volleys left (0 for duration and base weapons)
   *   timer   seconds left (0 for ammo and base weapons)
   *   cooldown seconds until the next volley is allowed
   *   phase   per-ship volley counter: condiment colour, cannon drift side,
   *           espresso detune. Per SHIP, so two players never share it.
   *   beam    the live attached shot, or null
   */
  function equip(ship, id) {
    if (!ship) return null;
    const def = byId(id);
    const prev = ship.weapon;
    if (prev && prev.def) killAttached(liveBeam(ship, prev));
    const w = {
      def: def,
      ammo: def.ammo || 0,
      timer: def.duration || 0,
      cooldown: 0,
      phase: 0,
      beam: null
    };
    ship.weapon = w;
    if (def.jackpot) sfx('jackpot');
    return w;
  }

  /* -------------------------------------------------------------------------
   * SHIP VELOCITY
   *
   * The croissant's FLAKE inherits CROISSANT_INHERIT of the ship's sideways
   * speed at launch, so it needs a vx the ship does not actually store: game.js
   * integrates `ship.x += ax * SHIP_SPEED * dt` and keeps no velocity.
   *
   * tick() runs once per ship per frame and — this is the part that makes it
   * work — runs BEFORE that integration, so the gap between two consecutive
   * ticks is exactly the previous frame's movement. If some later version of
   * entities.js starts carrying a real `ship.vx`, that wins and the measurement
   * is skipped; the clamp covers the one frame after a respawn teleports a ship
   * across the field.
   * ---------------------------------------------------------------------- */

  function measureShipVx(ship, dt) {
    if (typeof ship.vx === 'number') return;      // a real velocity, use that
    const prev = ship.wPrevX;
    ship.wvx = (typeof prev === 'number' && dt > 0)
      ? U.clamp((ship.x - prev) / dt, -C.SHIP_SPEED, C.SHIP_SPEED)
      : 0;
    ship.wPrevX = ship.x;
  }

  /** The ship's sideways speed in px/sec, however it is being tracked. */
  function shipVx(ship) {
    if (!ship) return 0;
    const v = (typeof ship.vx === 'number') ? ship.vx : ship.wvx;
    if (typeof v !== 'number' || !isFinite(v)) return 0;
    return U.clamp(v, -C.SHIP_SPEED, C.SHIP_SPEED);
  }

  /**
   * Drop back to this character's base weapon (ammo out, or death).
   *
   * And to their own VARIANT with it: the variant is never copied into the
   * weapon state, it stays on the ship and is re-read at every spawn, so a
   * MARMALADE jam jar that picks up the espresso repeater and burns through it
   * is a marmalade jam jar again the instant the last bean is spent.
   */
  function revert(ship) {
    if (!ship) return;
    equip(ship, baseFor(ship.kind));
  }

  /** The ship's weapon state, equipping its base weapon if it somehow has none. */
  function stateOf(ship) {
    let w = ship.weapon;
    if (!w || !w.def) w = equip(ship, baseFor(ship.kind));
    return w;
  }

  /**
   * This ship's live lance / beam, or null — clearing the stale handle on the
   * way past. `w.beam` is a plain reference into a POOLED object, so once the
   * shot has been retired that object can come back as somebody else's
   * projectile: matching the owner and the weapon id is what makes the handle
   * safe to trust.
   */
  function liveBeam(ship, w) {
    const s = w.beam;
    if (!s) return null;
    if (s.alive && s.owner === ship && s.wid === w.def.id) return s;
    w.beam = null;
    return null;
  }

  /**
   * Per-frame weapon clock: run the fire cooldown down, burn duration, and
   * revert to the base weapon the moment an upgrade is spent.
   *
   * The cooldown is allowed to run PAST zero, down to a floor of one whole
   * fireDelay, and fire() adds fireDelay to whatever is left rather than
   * assigning it. At a fixed 60 Hz step that is the difference between the
   * espresso repeater managing 12 shots a second (0.07s rounded up to five
   * frames, every time) and the 14 the spec asks for.
   *
   * The microwave burns its 7 seconds only while the beam is actually up
   * (`drainWhileFiring`) — it is a hold-to-fire weapon, so charging the player
   * for standing still would be a swindle.
   */
  function tick(ship, dt) {
    if (!ship) return;
    const w = stateOf(ship);
    const def = w.def;

    measureShipVx(ship, dt);

    const floor = -def.fireDelay;
    if (w.cooldown > floor) {
      w.cooldown -= dt;
      if (w.cooldown < floor) w.cooldown = floor;
    }
    if (def.base) return;

    if (def.duration) {
      if (!def.drainWhileFiring || liveBeam(ship, w)) w.timer -= dt;
      if (w.timer <= 0) {
        w.timer = 0;
        sfx('weaponOut');
        revert(ship);
      }
      return;
    }
    if (w.ammo <= 0) {
      sfx('weaponOut');
      revert(ship);
    }
  }

  /**
   * True while `ship` still has a live base-weapon shot on screen — or a
   * finished one that has not been turned into its refire husk yet.
   *
   * That second case is not bookkeeping, it is the `refire` rule. game.js
   * kills a shot during its COLLISION step, which runs AFTER the fire step and
   * after the shot-update step: the husk is not created until the following
   * frame's step 3, and without spentEligible() here the ship would get one
   * free shot in between and skip the delay altogether.
   */
  function hasLiveShot(ship, board) {
    if (ship.shot && ship.shot.alive) return true;
    const list = board && board.shots;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.owner !== ship || !s.def || !s.def.base) continue;
      if (s.alive) return true;
      if (spentEligible(s)) return true;     // dies this frame, husks the next
    }
    return false;
  }

  /**
   * May this ship fire right now?
   *   base weapons — the classic ONE LIVE SHOT ON SCREEN rule
   *   attached     — only while its lance / beam is not already up
   *   everything else — the fireDelay cooldown
   */
  function canFire(ship, board) {
    if (!ship || ship.out || ship.dead || !ship.alive) return false;
    const w = stateOf(ship);
    const def = w.def;
    if (def.base) return !hasLiveShot(ship, board);
    if (w.cooldown > 0) return false;
    if (def.attached && liveBeam(ship, w)) return false;
    if (def.duration) return w.timer > 0;
    return w.ammo > 0;
  }

  /**
   * Fire one volley: push its projectiles into board.shots, spend a round, set
   * the cooldown, kick the ship's recoil frame and play the weapon's sound.
   * @returns {boolean} true if anything left the barrel.
   */
  function fire(ship, board) {
    if (!board || !canFire(ship, board)) return false;
    const w = stateOf(ship);
    const def = w.def;
    const mech = MECH[def.id];
    if (!mech || !mech.emit) return false;

    const mx = ship.x + ship.w / 2;
    const my = ship.y - 2;
    mech.emit(ship, board, w, mx, my);

    w.phase++;
    // Carry the leftover, so the average rate really is one per fireDelay.
    if (def.fireDelay > 0) w.cooldown += def.fireDelay;
    if (!def.base && !def.duration) w.ammo--;

    ship.frame = 1;
    ship.fireT = M.FIRE_RECOIL;
    ship.recoilT = M.FIRE_RECOIL;
    return true;
  }

  /* =========================================================================
   * MECHANICS
   *
   * One entry per weapon id:
   *   emit(ship, board, w, mx, my)   push this volley's projectiles
   *   update(s, dt, board)  -> bool  per-frame motion; false retires the shot
   *   hit(s, target, kind, board) -> 'consume' | 'pierce'
   *   draw(ctx, s)                   render one projectile
   *
   * Anything an entry leaves out falls back to the straight-up defaults below,
   * so a mechanic only states what actually makes it different.
   * ====================================================================== */

  /** Slide the trail history down one slot. Only the base weapons draw one. */
  function pushTrail(s) {
    const t = s.trail;
    for (let i = t.length - 1; i > 0; i--) {
      t[i].x = t[i - 1].x;
      t[i].y = t[i - 1].y;
    }
    t[0].x = s.x;
    t[0].y = s.y;
  }

  /** Integrate velocity (and gravity), accumulate age and distance travelled. */
  function advance(s, dt) {
    if (s.gravity) s.vy += s.gravity * dt;
    const dx = s.vx * dt;
    const dy = s.vy * dt;
    s.x += dx;
    s.y += dy;
    s.t += dt;
    s.dist += Math.sqrt(dx * dx + dy * dy);
  }

  /** Retire anything that has left the play field, or outlived `life`. */
  function inPlay(s) {
    if (s.life > 0 && s.t >= s.life) return false;
    if (s.y + s.h <= C.PLAY_TOP - M.CEILING_PAD) return false;
    if (s.y > C.H + M.OFFSCREEN_PAD) return false;
    if (s.x + s.w < -M.OFFSCREEN_PAD || s.x > C.W + M.OFFSCREEN_PAD) return false;
    return true;
  }

  function defaultUpdate(s, dt) {
    advance(s, dt);
    return inPlay(s);
  }

  function defaultDraw(ctx, s) {
    blitCentered(ctx, s.sprite, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  function consume() { return 'consume'; }

  /** Pierce toasters, the bonus toaster and the crate; stick in butter. */
  function pierceSoft(s, target, kind) {
    return (kind === 'bunker') ? 'consume' : 'pierce';
  }

  /* --- shared geometry ---------------------------------------------------- */

  /** Circle (cx, cy, r) against an axis-aligned rect — used by the jam splash. */
  function circleHitsRect(cx, cy, r, x, y, w, h) {
    let nx = cx;
    let ny = cy;
    if (nx < x) nx = x; else if (nx > x + w) nx = x + w;
    if (ny < y) ny = y; else if (ny > y + h) ny = y + h;
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  /* =========================================================================
   * BASE WEAPONS — the nine character weapons (SPEC-CHARACTERS.md §3)
   *
   * Every one of them still obeys the classic ONE LIVE SHOT rule and still dies
   * on a toaster; what differs is how the projectile MOVES, and every one of
   * those differences is a real mechanic, never a recolour. The shared parts —
   * where the muzzle is, which sound plays, the one-live-shot handle — live in
   * launchBase / emitBase so a mechanic below only states what makes it odd.
   * ====================================================================== */

  /**
   * Put one base projectile of `wid` at the ship's muzzle, climbing at its
   * roster speed. The top edge sits MUZZLE_INSET px inside the ship, as the
   * original butter pat always has.
   */
  function launchBase(ship, board, wid, mx) {
    const p = PROJ[wid] || PROJ.butter;
    const s = spawn(board, ship, wid, mx, ship.y - p.h / 2 + M.MUZZLE_INSET);
    s.vy = -baseSpeed(wid);
    return s;
  }

  /**
   * The muzzle sound named by the character's roster row (SPEC-CHARACTERS §4),
   * shifted by the ship's variant `sfxDetune` so the three variants of a
   * character sound related but distinct (SPEC-VARIANTS.md §4).
   *
   * Detune is cents — the sound's recipe, its length and its gain are the
   * character's and are not a variant's to touch.
   */
  function baseSfx(ship, def, wid) {
    const v = shotVariant(ship, wid);
    const cents = (v && typeof v.sfxDetune === 'number') ? v.sfxDetune : 0;
    sfx(def.sfx || (wid === 'jam' ? 'shootJam' : 'shootButter'), undefined, cents);
  }

  /** BUTTER and JAM: straight up, one at a time. Unchanged from SPEC §4. */
  function emitBase(ship, board, w, mx, my) {
    const wid = w.def.id;
    const s = launchBase(ship, board, wid, mx);
    ship.shot = s;                       // the classic one-live-shot handle
    baseSfx(ship, w.def, wid);
  }

  function updateBase(s, dt) {
    pushTrail(s);
    advance(s, dt);
    return inPlay(s);
  }

  /**
   * THE REFIRE HUSK  (SPEC-CHARACTERS §2, the `refire` column)
   *
   * `refire` is "extra delay after the previous shot DIES before you may fire
   * again" — which is a different lever from an upgrade's fireDelay, and the
   * one thing separating the mug (0.15) from the pepper grinder (0.48).
   *
   * Rather than bolt a second timer onto the weapon state, the spent projectile
   * simply stays in board.shots for `refire` seconds as an inert husk: collision
   * rect emptied, so nothing can touch it and it can touch nothing, but still
   * `alive` and still carrying its BASE def, so hasLiveShot() keeps the trigger
   * locked for exactly that long. One rule, one code path, and it works however
   * the shot died — ceiling, toaster, bunker or the mug's own range limit.
   *
   * For the pepper grinder that falls out for free: three pellets mean three
   * husks, and the trigger unlocks when the LAST of them expires. The volley is
   * the shot, exactly as the spec asks.
   *
   * @returns {boolean} true if `s` became a husk and must stay in the list.
   */

  /**
   * Would this finished shot become a refire husk?
   *
   * Split out of beginSpent because of the FRAME ORDER game.js runs in: ships
   * fire at step 1 but shots are only advanced at step 3, and a shot killed by
   * a COLLISION (step 7) therefore sits in board.shots marked dead for a whole
   * frame before beginSpent can see it. hasLiveShot has to count that shot, or
   * the trigger unlocks on the very next frame and `refire` is skipped
   * entirely for every shot that died on a toaster, a bomb or a bunker — which
   * is nearly all of them.
   */
  function spentEligible(s) {
    if (!s || s.wid === 'spent') return false;      // already spent
    const def = s.def;
    if (!def || !def.base || !(def.refire > 0)) return false;
    const ship = s.owner;
    // A dead ship is not waiting on a refire timer; it is waiting to respawn.
    if (!ship || ship.dead || ship.out || !ship.alive) return false;
    const w = ship.weapon;
    if (!w || w.def !== def) return false;          // swapped to an upgrade
    return true;
  }

  function beginSpent(s) {
    if (!spentEligible(s)) return false;

    s.alive = true;
    s.wid = 'spent';
    s.w = 0; s.h = 0;
    s.vx = 0; s.vy = 0; s.gravity = 0;
    s.attached = false;
    s.t = 0;
    s.life = s.def.refire;
    return true;
  }

  function updateSpent(s, dt) {
    s.t += dt;
    return s.t < s.life;
  }

  /** A husk is a timer, not a thing. It draws nothing. */
  function drawNothing() { }

  /* -------------------------------------------------------------------------
   * CROISSANT — FLAKE: inherits the ship's velocity
   *
   * vx is sampled ONCE, at launch, and kept for life. Stand still and the flake
   * flies dead straight; walk while you pull the trigger and it leaves at an
   * angle you did not aim at. That is the whole trade: you can lead a marching
   * formation or bend a shot around cover, but you cannot shoot straight and
   * move at the same time.
   * ---------------------------------------------------------------------- */

  function emitFlake(ship, board, w, mx, my) {
    const s = launchBase(ship, board, 'flake', mx);
    s.vx = shipVx(ship) * C.CROISSANT_INHERIT;
    ship.shot = s;
    baseSfx(ship, w.def, 'flake');
  }

  function updateFlake(s, dt) {
    pushTrail(s);
    advance(s, dt);     // vx is never touched again — it is the flake's for life
    return inPlay(s);
  }

  function drawFlake(ctx, s) {
    // Flaky layers peel off the side it is drifting toward, so the inherited
    // velocity is legible in the sprite and not just in where the shot lands.
    const lean = U.clamp(s.vx / (C.SHIP_SPEED * C.CROISSANT_INHERIT), -1, 1);
    const t = s.trail;
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = s.trailColor;
    for (let k = 0; k < 2; k++) {
      ctx.fillRect(Math.round(t[k].x + s.w / 2 - 1), Math.round(t[k].y + s.h), 2, 2);
    }
    ctx.globalAlpha = 1;
    blitCentered(ctx, s.sprite, s.x + s.w / 2 + lean * 2, s.y + s.h / 2,
                 s.w, s.h, s.color);
  }

  /* -------------------------------------------------------------------------
   * COFFEE MUG — DRIP: the fastest shot in the game, with a hard range limit
   *
   * The drip tracks how far it has travelled and fizzles out at MUG_RANGE. One
   * number buys both halves of the character: it cannot reach the top rows of a
   * fresh formation, and because it dies early the mug is back on the trigger
   * long before anybody else. The fizzle is a real object — a puff with an
   * empty collision rect and an INTERNAL def, so it is visible without either
   * hurting anything or holding the one-live-shot rule open.
   * ---------------------------------------------------------------------- */

  function emitDrip(ship, board, w, mx, my) {
    const s = launchBase(ship, board, 'drip', mx);
    ship.shot = s;
    baseSfx(ship, w.def, 'drip');
  }

  function fizzleDrip(s, board) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const puff = spawn(board, s.owner, 'mugFizzle', cx, cy);
    puff.life = C.MUG_FIZZLE_TIME;
    puff.color = s.color;
    // The steam keeps the mug's own colour (it is the drip's remains, and it
    // has to stay legible against the night sky); the splatter it throws is
    // the DRINK, so that takes the variant's colour.
    burstTinted(board, cx, cy, fx('crumb'), s.trailColor);
  }

  function updateDrip(s, dt, board) {
    pushTrail(s);
    advance(s, dt);
    if (s.dist >= C.MUG_RANGE) {
      fizzleDrip(s, board);
      return false;
    }
    return inPlay(s);
  }

  function drawDrip(ctx, s) {
    // It visibly cools over the last quarter of its range, so you can read the
    // limit coming rather than being surprised by it.
    const heat = 1 - U.clamp((s.dist / C.MUG_RANGE - 0.75) * 4, 0, 1);
    const t = s.trail;
    ctx.globalAlpha = 0.34 * heat;
    ctx.fillStyle = s.trailColor;
    for (let k = 0; k < 2; k++) {
      ctx.fillRect(Math.round(t[k].x + s.w / 2 - 1), Math.round(t[k].y + s.h + k * 3), 2, 3);
    }
    ctx.globalAlpha = 0.45 + 0.55 * heat;
    blitCentered(ctx, s.sprite, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
    ctx.globalAlpha = 1;
  }

  /** The spent drip: a puff of steam that shrinks and goes. Harmless. */
  function updateFizzle(s, dt) {
    s.t += dt;
    return s.t < s.life;
  }

  function drawFizzle(ctx, s) {
    const k = 1 - U.clamp(s.t / s.life, 0, 1);
    const r = Math.max(1, Math.round(9 * k));
    ctx.globalAlpha = 0.55 * k;
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.round(s.x - r / 2), Math.round(s.y - r / 2), r, r);
    ctx.globalAlpha = 0.30 * k;
    ctx.fillStyle = PAL.chromeLt;
    ctx.fillRect(Math.round(s.x - r), Math.round(s.y - r - 4), r * 2, 2);
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------------------------
   * PEPPER GRINDER — PEPPER: three pellets, one trigger pull
   *
   * PEPPER_PELLETS peppercorns leave at -SPREAD, 0 and +SPREAD degrees and are
   * all live at once. They share the base def, so hasLiveShot() counts every
   * one of them and the classic rule ends up counting the VOLLEY: you are back
   * on the trigger when the last pellet (and its refire husk) is gone.
   *
   * The spread is what balances it. At the formation's range the three pellets
   * are more than a column apart and about one of them lands; point-blank they
   * are still nearly together and all three can bite.
   * ---------------------------------------------------------------------- */

  function emitPepper(ship, board, w, mx, my) {
    const n = Math.max(1, C.PEPPER_PELLETS | 0);
    const step = C.PEPPER_SPREAD_DEG * DEG;
    const mid = (n - 1) / 2;
    const speed = baseSpeed('pepper');
    let centre = null;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - mid) * step;
      const s = launchBase(ship, board, 'pepper', mx);
      s.vx = Math.cos(a) * speed;
      s.vy = Math.sin(a) * speed;
      s.variant = i;
      if (i === (mid | 0)) centre = s;
    }
    ship.shot = centre;      // the handle points at the middle of the volley
    baseSfx(ship, w.def, 'pepper');
  }

  function drawPellet(ctx, s) {
    blitCentered(ctx, s.sprite, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* -------------------------------------------------------------------------
   * HONEY DIPPER — HONEY: the bead that ignores your own shields
   *
   * This is the one base weapon that cannot use game.js's generic shot passes,
   * because those carve the bunker BEFORE they ask onHit whether the shot cared.
   * So the bead carries an EMPTY collision rect (w = h = 0), which makes every
   * one of those passes skip it, and runs its own sweep here instead: toasters,
   * the bonus toaster, the utensil drawer and enemy bombs, all through the same
   * requestKill hooks the mortar and the beam already use — and no bunkers, ever.
   * Its real box lives in bw/bh, exactly like the lance and the beam.
   *
   * Paid for with the slowest projectile in the game by a wide margin.
   * ---------------------------------------------------------------------- */

  function emitHoney(ship, board, w, mx, my) {
    const p = PROJ.honey;
    const s = launchBase(ship, board, 'honey', mx);
    s.bw = p.w;
    s.bh = p.h;
    s.w = 0;                 // invisible to game.js's collision passes
    s.h = 0;
    ship.shot = s;
    baseSfx(ship, w.def, 'honey');
  }

  /**
   * The honey bead's own collision pass, in game.js's order.
   * @returns {boolean} true if the bead was consumed by what it hit.
   */
  function sweepHoney(s, board) {
    const x = s.x;
    const y = s.y;
    const bw = s.bw;
    const bh = s.bh;

    const list = board.enemies;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive) continue;
        if (!U.aabb(x, y, bw, bh, e.x, e.y, e.w, e.h)) continue;
        requestKill(board, e, s);
        return true;                       // a base shot dies on a toaster
      }
    }

    const u = board.ufo;
    if (u && u.alive !== false && U.aabb(x, y, bw, bh, u.x, u.y, u.w, u.h)) {
      requestKillUfo(board, s);
      return true;
    }

    const cr = board.crate;
    if (cr && cr.alive && U.aabb(x, y, bw, bh, cr.x, cr.y, cr.w, cr.h)) {
      hitCrate(cr, board);
      return true;
    }

    // Bombs: a wide base shot ploughs on through, as butter always has.
    const bombs = board.bombs;
    if (bombs) {
      for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        if (!b.alive) continue;
        if (!U.aabb(x, y, bw, bh, b.x, b.y, b.w, b.h)) continue;
        b.alive = false;
        burst(board, b.x + b.w / 2, b.y + b.h / 2, fx('crumb'));
      }
    }
    return false;
  }

  function updateHoney(s, dt, board) {
    pushTrail(s);
    advance(s, dt);
    if (sweepHoney(s, board)) return false;
    // Its own bounds check, because inPlay() reads w/h and honey's are empty.
    if (s.y + s.bh <= C.PLAY_TOP) {
      burstTinted(board, s.x + s.bw / 2, C.PLAY_TOP, fx('butter'), s.trailColor);
      return false;
    }
    if (s.y > C.H + M.OFFSCREEN_PAD) return false;
    if (s.x + s.bw < -M.OFFSCREEN_PAD || s.x > C.W + M.OFFSCREEN_PAD) return false;
    return true;
  }

  function drawHoney(ctx, s) {
    const cx = s.x + s.bw / 2;
    const cy = s.y + s.bh / 2;
    // A soft golden aura: the tell that this one is going through the shields.
    // It is this bead's trail, so it wears the variant's colour — molasses
    // glows dark and glossy where wildflower glows gold.
    ctx.globalAlpha = 0.20 + 0.08 * Math.sin(s.t * 7);
    ctx.fillStyle = s.trailColor;
    ctx.fillRect(Math.round(cx - s.bw / 2) - 2, Math.round(cy - s.bh / 2) - 2,
                 s.bw + 4, s.bh + 4);
    ctx.globalAlpha = 1;
    blitCentered(ctx, s.sprite, cx, cy, s.bw, s.bh, s.color);
  }

  /* -------------------------------------------------------------------------
   * CHEESE WEDGE — RIND: launched at an angle, alternating, and it bounces
   *
   * Every pull leaves at +/-CHEESE_ANGLE_DEG, flipping side each time (w.phase
   * is per ship, so two players never share the sequence), and the rind reflects
   * off the side walls up to CHEESE_BOUNCES times. It reaches around a bunker
   * and into the edge columns — and, because it starts leaving your column on
   * the very first frame, it can never hit the toaster directly above you.
   * ---------------------------------------------------------------------- */

  function emitRind(ship, board, w, mx, my) {
    const side = (w.phase & 1) ? -1 : 1;
    const a = -Math.PI / 2 + side * C.CHEESE_ANGLE_DEG * DEG;
    const speed = baseSpeed('rind');
    const s = launchBase(ship, board, 'rind', mx);
    s.vx = Math.cos(a) * speed;
    s.vy = Math.sin(a) * speed;
    s.variant = side;
    ship.shot = s;
    baseSfx(ship, w.def, 'rind');
  }

  function updateRind(s, dt) {
    advance(s, dt);
    if (s.x < M.WALL_L) {
      if (s.bounces >= C.CHEESE_BOUNCES) return false;
      s.x = M.WALL_L;
      s.vx = -s.vx;
      s.variant = -s.variant;
      s.bounces++;
    } else if (s.x + s.w > M.WALL_R) {
      if (s.bounces >= C.CHEESE_BOUNCES) return false;
      s.x = M.WALL_R - s.w;
      s.vx = -s.vx;
      s.variant = -s.variant;
      s.bounces++;
    }
    return inPlay(s);
  }

  function drawRind(ctx, s) {
    // A wedge tumbles end over end: nudge it about its centre as it climbs.
    const wob = Math.sin(s.t * 22) * 2;
    blitCentered(ctx, s.sprite, s.x + s.w / 2 + wob, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* -------------------------------------------------------------------------
   * BACON STRIP — SIZZLE: a burning trail that kills what marches into it
   *
   * The rasher drops an ember every BACON_TRAIL_GAP px of climb into a per-board
   * list; each ember lives BACON_TRAIL_TIME seconds and kills the first toaster
   * whose box overlaps it, then burns out. That is area denial: you do not aim
   * at a toaster, you aim at where the formation is about to be.
   *
   * The list is a fixed ring of at most BACON_TRAIL_MAX slots, allocated once
   * and recycled oldest-first, so a held trigger never allocates. It is ticked
   * and drawn by ONE pooled shot — the ticker — which outlives the rasher that
   * lit it and retires itself when the last ember goes out. Because embers only
   * ever act while a live ticker is walking them, a trail orphaned by a wave
   * change, a board end or a quit is inert on the spot; the next rasher wipes it
   * before laying its first ember.
   * ---------------------------------------------------------------------- */

  /* Most embers one rasher may lay in a single frame. At the shipped speed it
   * never lays more than one; this is only a guard so a faster SIZZLE can
   * never turn a frame into a loop. */
  const EMBERS_PER_FRAME = 4;

  function trailOf(board) {
    let list = board.baconTrail;
    if (!list) {
      list = [];
      board.baconTrail = list;
    }
    return list;
  }

  /** Put every ember out. Wave change, board end, ship death, a fresh rasher. */
  function clearTrail(board) {
    const list = board && board.baconTrail;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].active = false;
  }

  /**
   * The one live ticker for this board, made if there is not one. Finding no
   * live ticker also means any embers still in the list are orphans, so they go
   * out here rather than lingering into the next wave.
   */
  function trailTicker(board, ship) {
    const cur = board.baconTicker;
    if (cur && cur.alive && cur.wid === 'sizzleTrail') return cur;
    clearTrail(board);
    const t = spawn(board, ship, 'sizzleTrail', 0, 0);
    t.x = 0; t.y = 0;
    t.embers = trailOf(board);
    board.baconTicker = t;
    return t;
  }

  /** Light one ember, centred on (cx, cy), recycling the oldest slot if full. */
  function dropEmber(board, ship, cx, cy) {
    const list = trailOf(board);
    let slot = null;
    let oldest = null;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g.active) { slot = g; break; }
      if (!oldest || g.t > oldest.t) oldest = g;
    }
    if (!slot) {
      if (list.length < C.BACON_TRAIL_MAX) {
        slot = { x: 0, y: 0, t: 0, owner: null, active: false };
        list.push(slot);
      } else {
        slot = oldest;              // the cap: the oldest ember makes room
      }
    }
    slot.x = cx - C.BACON_TRAIL_W / 2;
    slot.y = cy - C.BACON_TRAIL_H / 2;
    slot.t = 0;
    slot.owner = ship;
    slot.active = true;
  }

  function emitSizzle(ship, board, w, mx, my) {
    const s = launchBase(ship, board, 'sizzle', mx);
    s.seg = C.BACON_TRAIL_GAP;      // lay the first ember at the muzzle
    ship.shot = s;
    baseSfx(ship, w.def, 'sizzle');
  }

  function updateSizzle(s, dt, board) {
    const before = s.dist;
    advance(s, dt);
    s.seg += s.dist - before;
    // The counter CARRIES its remainder rather than resetting to zero, so the
    // embers really do land BACON_TRAIL_GAP apart. Zeroing it quantised the
    // spacing to whole frames — at 460px/s that is 7.7px a frame, so a gap of
    // 8 and a gap of 15 both produced a 15px trail and the tunable had cliffs
    // in it instead of a slope. Capped at EMBERS_PER_FRAME so a future faster
    // rasher cannot lay an unbounded number in one step.
    const gap = C.BACON_TRAIL_GAP > 0 ? C.BACON_TRAIL_GAP : 16;
    let laid = 0;
    while (s.seg >= gap && laid < EMBERS_PER_FRAME) {
      s.seg -= gap;
      laid++;
      trailTicker(board, s.owner);          // wipes an orphaned trail first
      dropEmber(board, s.owner, s.x + s.w / 2, s.y + s.h / 2);
    }
    if (s.seg > gap) s.seg = gap;           // never bank more than one gap
    return inPlay(s);
  }

  function drawSizzle(ctx, s) {
    // Heat shimmer coming off the rasher.
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = PAL.coilLt;
    ctx.fillRect(Math.round(s.x + s.w / 2 - 1 + Math.sin(s.t * 26) * 2),
                 Math.round(s.y + s.h), 2, 4);
    ctx.globalAlpha = 1;
    blitCentered(ctx, s.sprite, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /**
   * The ticker. Ages every ember, kills the first toaster each one touches, and
   * retires itself once the trail is out. `s.owner` is retargeted per ember so
   * a kill is scored to whoever actually laid it — in two-player both rashers
   * feed the same list.
   */
  function updateTrail(s, dt, board) {
    if (board.baconTicker !== s) return false;         // superseded
    const list = s.embers || board.baconTrail;
    if (!list) { board.baconTicker = null; return false; }

    const enemies = board.enemies;
    const ew = C.BACON_TRAIL_W;
    const eh = C.BACON_TRAIL_H;
    let live = 0;

    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g.active) continue;
      g.t += dt;
      if (g.t >= C.BACON_TRAIL_TIME) { g.active = false; continue; }
      // An ember dies with its owner: a burnt-out player leaves no minefield.
      const own = g.owner;
      if (own && (own.dead || own.out || !own.alive)) { g.active = false; continue; }
      live++;
      if (!enemies) continue;
      for (let k = 0; k < enemies.length; k++) {
        const e = enemies[k];
        if (!e.alive) continue;
        if (!U.aabb(g.x, g.y, ew, eh, e.x, e.y, e.w, e.h)) continue;
        s.owner = own;                    // score it to the rasher that lit it
        requestKill(board, e, s);
        sfx('baconTrailBurn', 0.5);
        burst(board, g.x + ew / 2, g.y + eh / 2, fx('burnt'));
        g.active = false;                 // one ember, one toaster: then it is out
        live--;
        break;
      }
    }

    if (live > 0) return true;
    board.baconTicker = null;
    return false;
  }

  function drawTrail(ctx, s) {
    const list = s.embers;
    if (!list) return;
    const ew = C.BACON_TRAIL_W;
    const eh = C.BACON_TRAIL_H;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g.active) continue;
      const k = 1 - U.clamp(g.t / C.BACON_TRAIL_TIME, 0, 1);
      ctx.globalAlpha = 0.25 + 0.65 * k;
      blitCentered(ctx, 'sizzleTrail', g.x + ew / 2, g.y + eh / 2, ew, eh, PAL.coil);
    }
    ctx.globalAlpha = 1;
  }

  /* -------------------------------------------------------------------------
   * MILK CARTON — SPLASH: a hitbox that grows with range
   *
   * The splash widens from MILK_W_MIN to MILK_W_MAX across MILK_GROW_DIST, and
   * the COLLISION rect is the current width, not the launch width — game.js
   * reads s.w every frame, so widening s.w (and recentring s.x) really does
   * widen what the shot can hit. Three sprites carry the growth visually.
   *
   * It is the exact inverse of the coffee mug: it owns the top rows and it is
   * nearly a needle by the time the formation is on top of you.
   * ---------------------------------------------------------------------- */

  function emitSplash(ship, board, w, mx, my) {
    const s = launchBase(ship, board, 'splash', mx);
    ship.shot = s;
    baseSfx(ship, w.def, 'splash');
  }

  function updateSplash(s, dt) {
    advance(s, dt);
    const k = U.clamp(s.dist / C.MILK_GROW_DIST, 0, 1);
    const nw = U.lerp(C.MILK_W_MIN, C.MILK_W_MAX, k);
    // Grow about the centre, so the splash spreads both ways off its lane.
    s.x += (s.w - nw) / 2;
    s.w = nw;
    const f = Math.min(SPLASH_FRAMES.length - 1, (k * SPLASH_FRAMES.length) | 0);
    // The splash is the one base shot that changes sprite mid-flight, so the
    // re-skin has to happen here too — the WIDTH above is the milk carton's,
    // the SPRITE is whichever variant the carton is wearing. Both names are
    // interned, so this allocates nothing per frame.
    s.sprite = variantSprite(SPLASH_FRAMES[f], s.skin);
    return inPlay(s);
  }

  function drawSplash(ctx, s) {
    // Droplets flicking off the leading edge, wider as the splash opens up.
    // The spray is the splash's trail, so it takes the variant's colour.
    const k = U.clamp(s.dist / C.MILK_GROW_DIST, 0, 1);
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = s.trailColor;
    const spray = Math.round(s.w * 0.5) + 2;
    ctx.fillRect(Math.round(s.x + s.w / 2 - spray / 2), Math.round(s.y + s.h - 1),
                 spray, 1 + Math.round(k * 2));
    ctx.globalAlpha = 1;
    blitCentered(ctx, s.sprite, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /**
   * Two melting butter dots, or a thin red jam streak (SPEC §4).
   *
   * The test below is on the WEAPON id (spawn() stamps `s.kind = wid`), NOT on
   * a character — this function is only ever reached by the two rows whose
   * `mech` is 'plain', which is exactly butter and jam, and each of the other
   * seven base weapons has a draw of its own. It is the last remaining
   * butter-vs-jam branch in the codebase and it is the one SPEC.md §4 asks for
   * by name, describing those two trails and no others.
   *
   * The SHAPE of each trail is the weapon's and never moves; only its colour
   * comes from the shot (`s.trailColor`), which is where the cosmetic variant
   * lands — garlic butter drips green, marmalade streaks amber.
   */
  function drawBase(ctx, s) {
    const t = s.trail;
    const cx = s.x + s.w / 2;
    if (s.kind === 'jam') {
      ctx.strokeStyle = s.trailColor;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, s.y + s.h);
      ctx.lineTo(t[0].x + s.w / 2, t[0].y + s.h + 6);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = s.trailColor;
      for (let k = 0; k < 2; k++) {
        ctx.globalAlpha = 0.30 - k * 0.10;
        ctx.fillRect(Math.round(t[k].x + s.w / 2 - 1), Math.round(t[k].y + s.h), 3, 3);
      }
      ctx.globalAlpha = 1;
    }
    defaultDraw(ctx, s);
  }

  /* =========================================================================
   * BUTTER KNIVES — a single shot kills EVERY toaster in its path
   * ====================================================================== */

  function emitKnife(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'butterKnife', mx, my - 8);
    s.vy = -M.KNIFE_SPEED;
    sfx('fireKnife');
  }

  function drawKnife(ctx, s) {
    const frame = KNIFE_FRAMES[((s.t / M.KNIFE_SPIN) | 0) & 1];
    blitCentered(ctx, frame, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* =========================================================================
   * SPAGHETTI GUN — x is a sine of DISTANCE TRAVELLED, so the noodle whips
   * side to side and sweeps a corridor about 150px wide.
   * ====================================================================== */

  function emitNoodle(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'spaghetti', mx, my - 12);
    s.vy = -M.NOODLE_SPEED;
    // Alternate which way the whip starts, so a held trigger braids.
    s.variant = (w.phase & 1) ? -1 : 1;
    sfx('fireNoodle');
  }

  function updateNoodle(s, dt) {
    advance(s, dt);
    const phase = (s.dist / M.NOODLE_WAVELEN) * TAU;
    s.x = s.baseX - s.w / 2 + Math.sin(phase) * M.NOODLE_AMP * s.variant;
    return inPlay(s);
  }

  function drawNoodle(ctx, s) {
    // Lean the strand into the direction it is whipping.
    const lean = Math.cos((s.dist / M.NOODLE_WAVELEN) * TAU) * s.variant;
    const cx = s.x + s.w / 2 + lean * 3;
    blitCentered(ctx, 'wNoodle', cx, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* =========================================================================
   * TOAST CANNON — a real ballistic arc (vx + gravity) that airbursts into six
   * shrapnel fragments, each of which can kill on its own.
   * ====================================================================== */

  function emitCannon(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'toastCannon', mx, my - 10);
    s.vy = -M.CANNON_SPEED;
    s.vx = (w.phase & 1) ? -M.CANNON_DRIFT : M.CANNON_DRIFT;
    s.gravity = M.CANNON_GRAVITY;
    sfx('fireToast');
  }

  /** Throw SHRAPNEL_COUNT fragments radially out of (cx, cy). */
  function detonateCannon(s, board) {
    if (s.detonated) return;
    s.detonated = true;
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const step = TAU / M.SHRAPNEL_COUNT;
    for (let i = 0; i < M.SHRAPNEL_COUNT; i++) {
      const a = i * step + step * 0.5;
      const f = spawn(board, s.owner, 'shrapnel', cx, cy);
      const sp = M.SHRAPNEL_SPEED * (0.8 + 0.4 * U.rng());
      f.vx = Math.cos(a) * sp;
      f.vy = Math.sin(a) * sp;
      f.gravity = M.SHRAPNEL_GRAVITY;
      f.life = M.SHRAPNEL_LIFE;
    }
    burst(board, cx, cy, fx('crumb'));
    sfx('shrapnel');
  }

  function updateCannon(s, dt, board) {
    const rising = s.vy < 0;
    advance(s, dt);
    // Airburst at the top of the arc if it never touched anything.
    if (rising && s.vy >= 0) {
      detonateCannon(s, board);
      return false;
    }
    if (!inPlay(s)) {
      detonateCannon(s, board);
      return false;
    }
    return true;
  }

  function hitCannon(s, target, kind, board) {
    detonateCannon(s, board);
    return 'consume';
  }

  function drawCannon(ctx, s) {
    // A lobbed slice tumbles: nudge it around its centre as it flies.
    const wob = Math.sin(s.t / M.CANNON_SPIN) * 2;
    blitCentered(ctx, 'wToast', s.x + s.w / 2 + wob, s.y + s.h / 2, s.w, s.h, s.color);
  }

  function drawShrapnel(ctx, s) {
    blitCentered(ctx, 'wCrumb', s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, PAL.crust);
  }

  /* =========================================================================
   * CEREAL SCATTERGUN — ONE trigger pull, seven loops, 55 degree fan, each
   * with its own velocity vector.
   * ====================================================================== */

  function emitScatter(ship, board, w, mx, my) {
    const n = M.SCATTER_COUNT;
    const step = M.SCATTER_ARC / (n - 1);
    const start = -Math.PI / 2 - M.SCATTER_ARC / 2;
    for (let i = 0; i < n; i++) {
      const a = start + step * i;
      const sp = M.SCATTER_SPEED * (0.88 + 0.24 * U.rng());
      const s = spawn(board, ship, 'scattergun', mx, my - 6);
      s.vx = Math.cos(a) * sp;
      s.vy = Math.sin(a) * sp;
      s.life = M.SCATTER_LIFE;
    }
    sfx('fireScatter');
  }

  /* =========================================================================
   * ESPRESSO REPEATER — 0.07s between shots: a genuine machine gun.
   * ====================================================================== */

  function emitEspresso(ship, board, w, mx, my) {
    const jitter = (U.rng() - 0.5) * 2 * M.ESPRESSO_JITTER;
    const s = spawn(board, ship, 'espresso', mx + jitter, my - 6);
    s.vy = -M.ESPRESSO_SPEED;
    s.vx = jitter * 1.4;
    // Fourteen shots a second: keep it quiet or it becomes a wall of noise.
    sfx('fireEspresso', 0.45);
  }

  /* =========================================================================
   * HOMING CRUMPETS — steer toward the nearest LIVING toaster every frame,
   * turn-rate limited so they arc onto a target instead of snapping to it.
   * ====================================================================== */

  /** Nearest living toaster to (x, y), or null. */
  function nearestEnemy(board, x, y) {
    const list = board.enemies;
    if (!list) return null;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      const dx = e.x + e.w / 2 - x;
      const dy = e.y + e.h / 2 - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Shortest signed angular delta from a to b, in (-PI, PI]. */
  function angleDelta(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  function emitCrumpet(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'crumpet', mx, my - 8);
    s.ang = -Math.PI / 2;
    s.vx = 0;
    s.vy = -M.CRUMPET_SPEED;
    s.life = M.CRUMPET_LIFE;
    sfx('fireCrumpet');
  }

  function updateCrumpet(s, dt, board) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    // Climb straight until the seeker arms; see M.CRUMPET_ARM_Y.
    const armed = (s.y + s.h) <= M.CRUMPET_ARM_Y;
    const target = armed
      ? (nearestEnemy(board, cx, cy) ||
         (board.crate && board.crate.alive ? board.crate : null))
      : null;
    if (target) {
      const want = Math.atan2(target.y + target.h / 2 - cy, target.x + target.w / 2 - cx);
      const turn = M.CRUMPET_TURN * dt;
      const d = angleDelta(s.ang, want);
      s.ang += (d > turn) ? turn : (d < -turn ? -turn : d);
      s.vx = Math.cos(s.ang) * M.CRUMPET_SPEED;
      s.vy = Math.sin(s.ang) * M.CRUMPET_SPEED;
    }
    advance(s, dt);
    return inPlay(s);
  }

  function drawCrumpet(ctx, s) {
    blitCentered(ctx, 'wCrumpet', s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
    // A faint seeker glow ahead of it so you can read the arc.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.round(s.x + s.w / 2 + Math.cos(s.ang) * 9) - 1,
                 Math.round(s.y + s.h / 2 + Math.sin(s.ang) * 9) - 1, 3, 3);
    ctx.globalAlpha = 1;
  }

  /* =========================================================================
   * MEGA JAM MORTAR — damages EVERYTHING within 70px of the impact point.
   * ====================================================================== */

  function emitMegaJam(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'megaJam', mx, my - 12);
    s.vy = -M.MEGAJAM_SPEED;
    sfx('fireMegaJam');
  }

  function splatter(s, board) {
    const cx = s.x + s.w / 2;
    const cy = s.y + s.h / 2;
    const r = M.MEGAJAM_RADIUS;
    const list = board.enemies;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.alive) continue;
        if (circleHitsRect(cx, cy, r, e.x, e.y, e.w, e.h)) requestKill(board, e, s);
      }
    }
    const u = board.ufo;
    if (u && u.alive !== false && circleHitsRect(cx, cy, r, u.x, u.y, u.w, u.h)) {
      requestKillUfo(board, s);
    }
    burst(board, cx, cy, fx('jam'));
    burst(board, cx, cy, fx('crumb'));
  }

  function hitMegaJam(s, target, kind, board) {
    if (kind !== 'bunker') splatter(s, board);
    return 'consume';
  }

  function drawMegaJam(ctx, s) {
    const pulse = 1 + Math.sin(s.t * 14) * 0.12;
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = PAL.jamLite;
    const r = Math.round(s.w * 0.7 * pulse);
    ctx.fillRect(Math.round(s.x + s.w / 2 - r / 2), Math.round(s.y + s.h / 2 - r / 2), r, r);
    ctx.globalAlpha = 1;
    blitCentered(ctx, 'wJamGlob', s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* =========================================================================
   * PANCAKE FRISBEE — REFLECTS off the side walls, losing nothing, four times.
   * ====================================================================== */

  function emitPancake(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'pancake', mx, my - 6);
    s.vy = -M.PANCAKE_SPEED_Y;
    // variant carries the throwing hand: vx is derived from it every frame
    // (see updatePancake's release ramp), so a wall bounce flips THIS, not vx.
    s.variant = (w.phase & 1) ? -1 : 1;
    s.vx = 0;
    sfx('firePancake');
  }

  function updatePancake(s, dt) {
    // The release: sideways speed ramps in over PANCAKE_RELEASE seconds so the
    // pancake leaves the muzzle climbing and is clear of the bunker line before
    // it flattens out into the long skimming, wall-bouncing part of its flight.
    if (s.t < M.PANCAKE_RELEASE) {
      s.vx = s.variant * M.PANCAKE_SPEED_X * (s.t / M.PANCAKE_RELEASE);
      s.vy = -M.PANCAKE_SPEED_Y;
    } else {
      s.vx = s.variant * M.PANCAKE_SPEED_X;
      s.vy = U.approach(s.vy, -M.PANCAKE_GLIDE_Y, M.PANCAKE_FLATTEN * dt);
    }

    advance(s, dt);
    if (s.x < M.WALL_L) {
      if (s.bounces >= M.PANCAKE_BOUNCES) return false;
      s.x = M.WALL_L;
      s.variant = -s.variant;     // a perfectly elastic pancake, obviously
      s.vx = -s.vx;
      s.bounces++;
    } else if (s.x + s.w > M.WALL_R) {
      if (s.bounces >= M.PANCAKE_BOUNCES) return false;
      s.x = M.WALL_R - s.w;
      s.variant = -s.variant;
      s.vx = -s.vx;
      s.bounces++;
    }
    return inPlay(s);
  }

  function drawPancake(ctx, s) {
    const frame = PANCAKE_FRAMES[((s.t / M.PANCAKE_SPIN) | 0) & 1];
    blitCentered(ctx, frame, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* =========================================================================
   * BLENDER BLADE — up, stall, back down, lethal in both directions.
   * ====================================================================== */

  function emitBlender(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'blender', mx, my - 10);
    s.vy = -M.BLENDER_SPEED;
    s.gravity = M.BLENDER_GRAVITY;
    sfx('fireBlender');
  }

  function updateBlender(s, dt) {
    advance(s, dt);
    // It comes home: once it drops back past the ship it is caught, or gone.
    const floor = (s.owner && typeof s.owner.y === 'number') ? s.owner.y : C.SHIP_Y;
    if (s.vy > 0 && s.y > floor + 6) return false;
    return inPlay(s);
  }

  function drawBlender(ctx, s) {
    const frame = BLADE_FRAMES[((s.t / M.BLENDER_SPIN) | 0) & 1];
    blitCentered(ctx, frame, s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* =========================================================================
   * KETCHUP & MUSTARD — one pull, two projectiles on +/-22 degree diagonals,
   * the pair swapping colour every pull.
   * ====================================================================== */

  function emitCondiment(ship, board, w, mx, my) {
    const flip = (w.phase & 1);
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? -1 : 1;
      const a = -Math.PI / 2 + sign * M.CONDIMENT_ANGLE;
      const s = spawn(board, ship, 'condiments', mx + sign * 6, my - 6);
      s.vx = Math.cos(a) * M.CONDIMENT_SPEED;
      s.vy = Math.sin(a) * M.CONDIMENT_SPEED;
      s.variant = (i ^ flip) & 1;                 // 0 ketchup, 1 mustard
      s.sprite = CONDIMENT_SPRITES[s.variant];
      s.color = CONDIMENT_COLORS[s.variant];
    }
    sfx('fireCondiment');
  }

  /* =========================================================================
   * BAGUETTE LANCE — an ATTACHED lance. It grows up out of the ship over
   * BAGUETTE_GROW seconds, holds, then retracts, tracking the ship's x the
   * whole time and killing everything in the column it covers.
   *
   * Its collision rect is deliberately EMPTY (w = h = 0) so game.js's generic
   * shot passes cannot chew the bunkers it is standing behind; the lance runs
   * its own sweep below instead, through the same requestKill hooks.
   * ====================================================================== */

  function emitBaguette(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'baguette', mx, ship.y);
    s.w = 0;
    s.h = 0;
    s.x = mx;
    s.y = ship.y;
    s.attached = true;
    s.bw = M.BAGUETTE_W;
    s.life = M.BAGUETTE_GROW + M.BAGUETTE_HOLD + M.BAGUETTE_RETRACT;
    // The per-target contact array is only ever needed by the two attached
    // weapons, so it is allocated on the first lance/beam a pooled shot serves
    // and reused for every later one.
    if (!s.contact) s.contact = new Float32Array(C.TOTAL_ENEMIES);
    s.contact.fill(0);
    w.beam = s;
    sfx('fireBaguette');
  }

  /** 0..1 extension of the lance for its current age. */
  function lanceExtent(t) {
    if (t < M.BAGUETTE_GROW) return t / M.BAGUETTE_GROW;
    if (t < M.BAGUETTE_GROW + M.BAGUETTE_HOLD) return 1;
    const back = (t - M.BAGUETTE_GROW - M.BAGUETTE_HOLD) / M.BAGUETTE_RETRACT;
    return U.clamp(1 - back, 0, 1);
  }

  /**
   * Shared attached-weapon sweep. Anything overlapping (bx, by, bw, bh) racks
   * up contact time; at `need` seconds it dies. need = 0 kills on touch, which
   * is what the lance wants; the microwave passes BEAM_KILL_TIME.
   */
  function sweepColumn(s, board, dt, need) {
    const list = board.enemies;
    if (list && s.contact) {
      const n = Math.min(list.length, s.contact.length);
      for (let i = 0; i < n; i++) {
        const e = list[i];
        if (!e.alive) { s.contact[i] = 0; continue; }
        if (!U.aabb(s.bx, s.by, s.bw, s.bh, e.x, e.y, e.w, e.h)) {
          s.contact[i] = 0;
          continue;
        }
        s.contact[i] += dt;
        if (s.contact[i] >= need) {
          s.contact[i] = 0;
          requestKill(board, e, s);
        }
      }
    }

    const u = board.ufo;
    if (u && u.alive !== false && U.aabb(s.bx, s.by, s.bw, s.bh, u.x, u.y, u.w, u.h)) {
      s.ufoT += dt;
      if (s.ufoT >= need) {
        s.ufoT = 0;
        requestKillUfo(board, s);
      }
    } else {
      s.ufoT = 0;
    }

    const cr = board.crate;
    if (cr && cr.alive && U.aabb(s.bx, s.by, s.bw, s.bh, cr.x, cr.y, cr.w, cr.h)) {
      s.crateT += dt;
      // Never faster than one thunk every 0.2s, or a beam bursts it instantly.
      if (s.crateT >= Math.max(need, 0.2)) {
        s.crateT = 0;
        hitCrate(cr, board);
      }
    } else {
      s.crateT = 0;
    }
  }

  /** True when an attached shot's owner can no longer hold it up. */
  function ownerLostAttachment(s) {
    const ship = s.owner;
    if (!ship || ship.dead || ship.out || !ship.alive) return true;
    const w = ship.weapon;
    if (!w || !w.def || w.def.id !== s.wid) return true;   // weapon swapped out
    return false;
  }

  function updateBaguette(s, dt, board) {
    if (ownerLostAttachment(s)) return false;
    s.t += dt;
    if (s.t >= s.life) return false;

    const ship = s.owner;
    const ext = lanceExtent(s.t);
    const top = ship.y - (ship.y - C.PLAY_TOP) * ext;

    s.bw = M.BAGUETTE_W;
    s.bx = ship.x + ship.w / 2 - s.bw / 2;          // tracks the ship's x
    s.by = top;
    s.bh = Math.max(0, ship.y - top);
    s.x = ship.x + ship.w / 2;
    s.y = ship.y;

    if (s.bh > 4) sweepColumn(s, board, dt, 0);
    return true;
  }

  /**
   * Drop an attached lance / beam early (the ship swapped weapons, died, or
   * ran dry). The shot is left in board.shots for updateShot to retire on the
   * next frame; the hum reference goes back now so the sound stops with it.
   */
  function killAttached(s) {
    if (!s || !s.alive) return;
    s.alive = false;
    releaseHum(s);
  }

  function drawBaguette(ctx, s) {
    if (s.bh <= 2) return;
    const tip = sprite('wBaguetteTip');
    const seg = sprite('wBaguette');
    const x = Math.round(s.bx);
    let y = Math.round(s.by);
    const bottom = Math.round(s.by + s.bh);

    if (tip) {
      ctx.drawImage(tip.canvas, x, y);
      y += tip.h;
    } else {
      ctx.fillStyle = PAL.crust;
      ctx.fillRect(x, y, s.bw, 10);
      y += 10;
    }
    while (y < bottom) {
      if (seg) {
        ctx.drawImage(seg.canvas, x, y);
        y += seg.h;
      } else {
        ctx.fillStyle = s.color;
        ctx.fillRect(x, y, s.bw, Math.min(24, bottom - y));
        y += 24;
      }
    }
    // Scored crust marks so the lance reads as bread, not a girder.
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = PAL.burnt;
    for (let ny = Math.round(s.by) + 12; ny < bottom; ny += 16) {
      ctx.fillRect(x + 4, ny, s.bw - 8, 2);
    }
    ctx.globalAlpha = 1;
  }

  /* =========================================================================
   * MICROWAVE RAY — an ATTACHED continuous beam while fire is held: a
   * full-height column from the ship to the ceiling. Anything inside dies
   * after BEAM_KILL_TIME of ACCUMULATED contact, tracked per enemy in the
   * shot's own Float32Array, so two players' beams never share a counter.
   * ====================================================================== */

  function emitBeam(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'microwave', mx, ship.y);
    s.w = 0;
    s.h = 0;
    s.x = mx;
    s.y = ship.y;
    s.attached = true;
    s.bw = M.BEAM_W;
    if (!s.contact) s.contact = new Float32Array(C.TOTAL_ENEMIES);
    s.contact.fill(0);
    w.beam = s;
    acquireHum(s);
  }

  function updateBeam(s, dt, board) {
    // Returning false is enough to silence the hum: retireShot hands this
    // shot's single reference back, whichever way the beam ends.
    if (ownerLostAttachment(s)) return false;
    const ship = s.owner;
    // Held-to-fire: `undefined` means the board never told us, so keep humming.
    if (ship.fireHeld === false) return false;
    const w = ship.weapon;
    if (w.timer <= 0) return false;

    s.t += dt;
    s.bw = M.BEAM_W;
    s.bx = ship.x + ship.w / 2 - s.bw / 2;
    s.by = C.PLAY_TOP;
    s.bh = Math.max(0, ship.y - C.PLAY_TOP);
    s.x = ship.x + ship.w / 2;
    s.y = ship.y;

    sweepColumn(s, board, dt, M.BEAM_KILL_TIME);
    return true;
  }

  /* The beam column is a fixed vertical span, so its gradient is built once and
   * reused; only a different canvas context forces a rebuild. */
  let beamGrad = null;
  let beamGradCtx = null;

  function beamGradient(ctx) {
    if (beamGrad && beamGradCtx === ctx) return beamGrad;
    const g = ctx.createLinearGradient(0, C.PLAY_TOP, 0, C.SHIP_Y);
    g.addColorStop(0, 'rgba(126, 240, 255, 0.15)');
    g.addColorStop(0.45, 'rgba(126, 240, 255, 0.42)');
    g.addColorStop(1, 'rgba(236, 255, 255, 0.72)');
    beamGrad = g;
    beamGradCtx = ctx;
    return g;
  }

  /** Procedural: a shimmering column with scan bands rolling up it (SPEC §6). */
  function drawBeam(ctx, s) {
    if (s.bh <= 0) return;
    const x = Math.round(s.bx);
    const y = Math.round(s.by);
    const w = Math.round(s.bw);
    const h = Math.round(s.bh);

    ctx.fillStyle = beamGradient(ctx);
    ctx.fillRect(x, y, w, h);

    // Hot core.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#eaffff';
    ctx.fillRect(x + ((w >> 1) - 3), y, 6, h);

    // Scan bands sliding up the column.
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = '#7ef0ff';
    const period = 26;
    const offset = (s.t * M.BEAM_SCAN_HZ * period) % period;
    for (let by = y + h - offset; by > y; by -= period) {
      ctx.fillRect(x, Math.round(by), w, 5);
    }

    // Muzzle flare where the beam leaves the ship.
    ctx.globalAlpha = 0.5 + 0.25 * Math.sin(s.t * 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 3, y + h - 6, w + 6, 6);
    ctx.globalAlpha = 1;
  }

  /* =========================================================================
   * SYRUP TRAP — a slow blob; ANY hit syrups the whole formation for
   * SYRUP_SLOW_TIME seconds. game.js reads board.slowT for the march.
   * ====================================================================== */

  function emitSyrup(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'syrup', mx, my - 10);
    s.vy = -M.SYRUP_SPEED;
    sfx('fireSyrup');
  }

  function hitSyrup(s, target, kind, board) {
    board.slowT = C.SYRUP_SLOW_TIME;
    burst(board, s.x + s.w / 2, s.y + s.h / 2, fx('jam'));
    return 'consume';
  }

  function drawSyrup(ctx, s) {
    // A drip that lags behind the blob.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.round(s.x + s.w / 2 - 1),
                 Math.round(s.y + s.h + Math.sin(s.t * 6) * 2), 3, 5);
    ctx.globalAlpha = 1;
    blitCentered(ctx, 'wSyrup', s.x + s.w / 2, s.y + s.h / 2, s.w, s.h, s.color);
  }

  /* =========================================================================
   * SOGGY BREAD — the gag. A steep, damp arc that falls short and dies over
   * the bunkers. It is a real projectile with real lethality; it simply cannot
   * reach anything, which is the joke.
   * ====================================================================== */

  function emitSoggy(ship, board, w, mx, my) {
    const s = spawn(board, ship, 'soggy', mx, my - 8);
    s.vy = -M.SOGGY_SPEED;
    s.vx = ((w.phase & 1) ? -1 : 1) * M.SOGGY_DRIFT * (0.6 + 0.6 * U.rng());
    s.gravity = M.SOGGY_GRAVITY;
    sfx('fireSoggy');
  }

  function updateSoggy(s, dt, board) {
    advance(s, dt);
    // Flops back down into the bunker line and gives up. Every time.
    if (s.vy > 0 && s.y > M.SOGGY_DIE_Y) {
      burst(board, s.x + s.w / 2, s.y + s.h / 2, fx('crumb'));
      return false;
    }
    return inPlay(s);
  }

  function drawSoggy(ctx, s) {
    const droop = s.vy > 0 ? 2 : 0;
    blitCentered(ctx, 'wSoggy', s.x + s.w / 2, s.y + s.h / 2 + droop, s.w, s.h, s.color);
  }

  /* =========================================================================
   * THE FULL BREAKFAST — the jackpot. It fires butter knives, spaghetti,
   * homing crumpets and espresso at once by DELEGATING to those four emitters,
   * offset across four barrels. No mechanic is re-implemented here.
   * ====================================================================== */

  function emitFullEnglish(ship, board, w, mx, my) {
    const d = M.FULL_SPREAD;
    emitKnife(ship, board, w, mx, my);
    emitNoodle(ship, board, w, mx - d, my);
    emitCrumpet(ship, board, w, mx + d, my);
    emitEspresso(ship, board, w, mx, my);
  }

  /* -------------------------------------------------------------------------
   * DISPATCH TABLE
   * ---------------------------------------------------------------------- */
  const MECH = {
    butter:      { emit: emitBase,        update: updateBase,     hit: consume,     draw: drawBase },
    jam:         { emit: emitBase,        update: updateBase,     hit: consume,     draw: drawBase },

    /* The spent-shot husk and the two internal projectiles. None of them is
     * ever equipped or fired: the husk is a base shot that has run out of
     * flight, the other two are spawned by the mug and the bacon strip. */
    spent:       {                        update: updateSpent,    hit: consume,     draw: drawNothing },
    mugFizzle:   {                        update: updateFizzle,   hit: consume,     draw: drawFizzle },
    sizzleTrail: {                        update: updateTrail,    hit: consume,     draw: drawTrail },

    butterKnife: { emit: emitKnife,       update: defaultUpdate,  hit: pierceSoft,  draw: drawKnife },
    spaghetti:   { emit: emitNoodle,      update: updateNoodle,   hit: pierceSoft,  draw: drawNoodle },
    toastCannon: { emit: emitCannon,      update: updateCannon,   hit: hitCannon,   draw: drawCannon },
    // Shrapnel is thrown by detonateCannon, never by a trigger: no emit.
    shrapnel:    {                        update: defaultUpdate,  hit: consume,     draw: drawShrapnel },
    scattergun:  { emit: emitScatter,     update: defaultUpdate,  hit: consume,     draw: defaultDraw },
    espresso:    { emit: emitEspresso,    update: defaultUpdate,  hit: consume,     draw: defaultDraw },
    crumpet:     { emit: emitCrumpet,     update: updateCrumpet,  hit: consume,     draw: drawCrumpet },
    megaJam:     { emit: emitMegaJam,     update: defaultUpdate,  hit: hitMegaJam,  draw: drawMegaJam },
    pancake:     { emit: emitPancake,     update: updatePancake,  hit: consume,     draw: drawPancake },
    blender:     { emit: emitBlender,     update: updateBlender,  hit: pierceSoft,  draw: drawBlender },
    condiments:  { emit: emitCondiment,   update: defaultUpdate,  hit: consume,     draw: defaultDraw },
    baguette:    { emit: emitBaguette,    update: updateBaguette, hit: pierceSoft,  draw: drawBaguette },
    microwave:   { emit: emitBeam,        update: updateBeam,     hit: pierceSoft,  draw: drawBeam },
    syrup:       { emit: emitSyrup,       update: defaultUpdate,  hit: hitSyrup,    draw: drawSyrup },
    soggy:       { emit: emitSoggy,       update: updateSoggy,    hit: consume,     draw: drawSoggy },
    fullEnglish: { emit: emitFullEnglish, update: defaultUpdate,  hit: consume,     draw: defaultDraw }
  };

  /* -------------------------------------------------------------------------
   * THE SEVEN NEW BASE WEAPONS, wired up by their roster row's `mech` name.
   *
   * The mechanic a character shoots with is DATA in T.C (`mech: 'inherit'`,
   * `'range'`, ...), so the wid -> behaviour wiring is a lookup rather than
   * seven more hand-written rows here. Every base shot dies on a toaster, so
   * they all take the plain `consume` verdict.
   * ---------------------------------------------------------------------- */
  const BASE_MECH = {
    plain:   { emit: emitBase,   update: updateBase,   hit: consume, draw: drawBase },
    inherit: { emit: emitFlake,  update: updateFlake,  hit: consume, draw: drawFlake },
    range:   { emit: emitDrip,   update: updateDrip,   hit: consume, draw: drawDrip },
    volley:  { emit: emitPepper, update: updateBase,   hit: consume, draw: drawPellet },
    ghost:   { emit: emitHoney,  update: updateHoney,  hit: consume, draw: drawHoney },
    angle:   { emit: emitRind,   update: updateRind,   hit: consume, draw: drawRind },
    trail:   { emit: emitSizzle, update: updateSizzle, hit: consume, draw: drawSizzle },
    grow:    { emit: emitSplash, update: updateSplash, hit: consume, draw: drawSplash }
  };

  const BASE_IDS = Object.keys(BASE);
  for (let i = 0; i < BASE_IDS.length; i++) {
    const def = BASE[BASE_IDS[i]];
    MECH[def.id] = BASE_MECH[def.mech] || BASE_MECH.plain;
  }

  /** Mechanic block for a shot, defaulting to the plain straight-up one. */
  function mechOf(wid) {
    return MECH[wid] || MECH.butter;
  }

  /* -------------------------------------------------------------------------
   * PUBLIC PROJECTILE API
   * ---------------------------------------------------------------------- */

  /**
   * Advance one projectile.
   * @returns {boolean} false when the shot is finished — the caller drops it
   *          from board.shots; the pool reclaims it here.
   */
  function updateShot(shot, dt, board) {
    if (!shot) return false;
    // A finished BASE shot does not leave the list straight away: it lingers as
    // an inert husk for its weapon's `refire` seconds, which is what holds the
    // one-live-shot rule closed for that long. See beginSpent.
    if (!shot.alive) {
      if (beginSpent(shot)) return true;
      retireShot(shot);
      return false;
    }
    const alive = mechOf(shot.wid).update(shot, dt, board);
    if (!alive) {
      if (beginSpent(shot)) return true;
      retireShot(shot);
      return false;
    }
    return true;
  }

  /** What sort of thing a collision handed us. */
  function targetType(target) {
    if (!target) return 'none';
    if (target.mask && target.remaining !== undefined) return 'bunker';
    if (target.isCrate) return 'crate';
    if (target.scoreIndex !== undefined) return 'ufo';
    if (target.row !== undefined && target.col !== undefined) return 'enemy';
    return 'other';
  }

  /**
   * Resolve a hit. Returns 'pierce' if the shot carries on through (butter
   * knives, spaghetti, the blender blade and the attached weapons) or
   * 'consume' if it dies here. Side effects that belong to the projectile —
   * the cannon's airburst, the mega-jam splash, the syrup slow — happen here.
   */
  function onHit(shot, target, board) {
    if (!shot) return 'consume';
    const kind = targetType(target);
    const result = mechOf(shot.wid).hit(shot, target, kind, board);
    if (result !== 'pierce') shot.alive = false;
    return result === 'pierce' ? 'pierce' : 'consume';
  }

  /** Draw one projectile. */
  function renderShot(ctx, shot) {
    if (!shot || !shot.alive) return;
    mechOf(shot.wid).draw(ctx, shot);
  }

  /* -------------------------------------------------------------------------
   * DROPS AND THE HUD
   * ---------------------------------------------------------------------- */

  /* Weighted drop table, summed once. Base weapons have weight 0 and can never
   * drop — you already have one. */
  let dropTotal = 0;
  for (let i = 0; i < LIST.length; i++) dropTotal += LIST[i].weight;

  /** @returns {string} a weapon id, weighted by `weight` (SPEC-WEAPONS §3). */
  function rollDrop() {
    let r = U.rng() * dropTotal;
    for (let i = 0; i < LIST.length; i++) {
      const wgt = LIST[i].weight;
      if (wgt <= 0) continue;
      r -= wgt;
      if (r <= 0) return LIST[i].id;
    }
    return 'butterKnife';    // float dust only; the table is never empty
  }

  /** 0..1 for the HUD bar. Base weapons are infinite and always read full. */
  function ammoFraction(ship) {
    if (!ship || !ship.weapon || !ship.weapon.def) return 1;
    const w = ship.weapon;
    const def = w.def;
    if (def.base) return 1;
    if (def.duration) return U.clamp(w.timer / def.duration, 0, 1);
    if (def.ammo) return U.clamp(w.ammo / def.ammo, 0, 1);
    return 0;
  }

  /* =========================================================================
   * THE WINGED UTENSIL DRAWER
   *
   * Sails across the upper play field bobbing on its wings. Two hits burst it
   * into a weapon token. Only ONE exists at a time — that is the board's job to
   * enforce, and it is why makeCrate takes only a direction.
   * ====================================================================== */

  /**
   * @param {number} dir +1 enters from the left, -1 from the right.
   */
  function makeCrate(dir) {
    const d = dir < 0 ? -1 : 1;
    const w = C.CRATE_W;
    const h = C.CRATE_H;
    // Keep the whole bob inside the CRATE_Y band.
    const lane = U.randRange(C.CRATE_Y_MIN + C.CRATE_BOB_AMP,
                             C.CRATE_Y_MAX - C.CRATE_BOB_AMP);
    return {
      isCrate: true,
      x: d > 0 ? -w : C.W,
      y: lane,
      w: w,
      h: h,
      baseY: lane,
      vx: d * C.CRATE_SPEED,
      dir: d,
      hp: C.CRATE_HP,
      t: 0,
      frame: 0,
      hitT: 0,
      alive: true
    };
  }

  const CRATE_FLAP = 0.11;   // seconds per wing beat frame

  /** @returns {boolean} false once it has flown off the far side. */
  function updateCrate(crate, dt, board) {
    if (!crate || !crate.alive) return false;
    crate.t += dt;
    crate.x += crate.vx * dt;
    crate.y = crate.baseY + Math.sin(crate.t * TAU * C.CRATE_BOB_HZ) * C.CRATE_BOB_AMP;
    crate.frame = ((crate.t / CRATE_FLAP) | 0) & 1;
    if (crate.hitT > 0) crate.hitT -= dt;
    if (crate.dir > 0 ? crate.x > C.W : crate.x + crate.w < 0) {
      crate.alive = false;
      return false;
    }
    return true;
  }

  /**
   * Land one hit on the drawer.
   * @returns {boolean} true if THIS hit burst it (and dropped the token).
   */
  function hitCrate(crate, board) {
    if (!crate || !crate.alive) return false;
    crate.hp--;
    crate.hitT = 0.12;
    const cx = crate.x + crate.w / 2;
    const cy = crate.y + crate.h / 2;

    if (crate.hp > 0) {
      sfx('crateHit');
      burst(board, cx, cy, fx('chrome'));
      return false;
    }

    crate.alive = false;
    sfx('crateBurst');
    burst(board, cx, cy, fx('chrome'));
    burst(board, cx, cy, fx('crumb'));
    if (board && !board.token) {
      board.token = makeToken(cx, cy, rollDrop());
      sfx('tokenDrop');
    }
    return true;
  }

  function renderCrate(ctx, crate) {
    if (!crate || !crate.alive) return;
    const name = (crate.hp < C.CRATE_HP) ? 'crateHit' : CRATE_FRAMES[crate.frame];
    const s = sprite(name);
    if (s) {
      // Flash white for a beat when it takes a hit.
      if (crate.hitT > 0) ctx.globalAlpha = 0.55;
      ctx.drawImage(s.canvas, Math.round(crate.x), Math.round(crate.y));
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = crate.hp < C.CRATE_HP ? PAL.crumbDark : PAL.crust;
    ctx.fillRect(Math.round(crate.x), Math.round(crate.y), crate.w, crate.h);
    ctx.fillStyle = PAL.chromeLt;
    ctx.fillRect(Math.round(crate.x) + 8, Math.round(crate.y) - 6, crate.w - 16, 6);
  }

  /* =========================================================================
   * THE WEAPON TOKEN
   *
   * Tumbles down from the burst drawer showing its weapon's icon and colour, so
   * you can decide whether it is worth leaving cover for. Catch it or lose it.
   * ====================================================================== */

  const TOKEN_SWAY_HZ = 0.85;

  /** (x, y) is the token's CENTRE — normally the crate's centre. */
  function makeToken(x, y, weaponId) {
    const def = byId(weaponId);
    const w = C.TOKEN_W;
    const h = C.TOKEN_H;
    return {
      isToken: true,
      wid: def.id,
      def: def,
      name: def.name,
      color: def.color,
      icon: 'icon_' + def.id,       // interned once, never rebuilt per frame
      x: x - w / 2,
      y: y - h / 2,
      w: w,
      h: h,
      baseX: x - w / 2,
      t: 0,
      alive: true
    };
  }

  /** @returns {boolean} false once it has fallen past the floor line. */
  function updateToken(token, dt, board) {
    if (!token || !token.alive) return false;
    token.t += dt;
    token.y += C.TOKEN_FALL * dt;
    token.x = U.clamp(
      token.baseX + Math.sin(token.t * TAU * TOKEN_SWAY_HZ) * C.TOKEN_DRIFT,
      0, C.W - token.w);
    if (token.y >= C.PLAY_BOTTOM) {
      token.alive = false;
      return false;
    }
    return true;
  }

  /**
   * Generous catch test: TOKEN_MAGNET px of slop around the ship, on purpose.
   * Either ship may take any token — first one there wins it.
   */
  function catchesToken(ship, token) {
    if (!ship || !token || !token.alive) return false;
    if (!ship.alive || ship.dead || ship.out) return false;
    const m = C.TOKEN_MAGNET;
    return U.aabb(ship.x - m, ship.y - m, ship.w + m * 2, ship.h + m * 2,
                  token.x, token.y, token.w, token.h);
  }

  function renderToken(ctx, token) {
    if (!token || !token.alive) return;
    const cx = token.x + token.w / 2;
    const cy = token.y + token.h / 2;

    // The roundel spins about its vertical axis: squash its drawn width by the
    // cosine of the spin. drawImage's destination size does the work, so no
    // canvas transform is touched and save/restore stays balanced.
    const spin = Math.cos(token.t * TAU * C.TOKEN_SPIN_HZ);
    const squash = Math.max(0.14, Math.abs(spin));

    const shell = sprite('tokenShell');
    const sw = Math.max(2, Math.round((shell ? shell.w : token.w) * squash));
    const sh = shell ? shell.h : token.h;
    const sx = Math.round(cx - sw / 2);
    const sy = Math.round(cy - sh / 2);

    // A soft glow in the weapon's colour, so you can read it from across the
    // screen while it is still up near the toasters.
    ctx.globalAlpha = 0.22 + 0.10 * Math.sin(token.t * 8);
    ctx.fillStyle = token.color;
    ctx.fillRect(Math.round(cx - token.w / 2) - 3, Math.round(cy - token.h / 2) - 3,
                 token.w + 6, token.h + 6);
    ctx.globalAlpha = 1;

    if (shell) {
      ctx.drawImage(shell.canvas, sx, sy, sw, sh);
    } else {
      ctx.fillStyle = PAL.chrome;
      ctx.fillRect(sx, sy, sw, sh);
    }

    const icon = sprite(token.icon);
    if (icon) {
      const iw = Math.max(2, Math.round(icon.w * squash));
      ctx.drawImage(icon.canvas, Math.round(cx - iw / 2),
                    Math.round(cy - icon.h / 2), iw, icon.h);
    } else {
      ctx.fillStyle = token.color;
      const iw = Math.max(2, Math.round(14 * squash));
      ctx.fillRect(Math.round(cx - iw / 2), Math.round(cy - 7), iw, 14);
    }
  }

  /* -------------------------------------------------------------------------
   * EXPORT
   * ---------------------------------------------------------------------- */
  T.Weapons = {
    // roster
    LIST: LIST,          // the 2 base + 15 droppable upgrades, in table order
    BASE: BASE,          // the nine characters' base weapons, by character id
    M: M,
    byId: byId,
    baseFor: baseFor,

    /* Cosmetic variants (SPEC-VARIANTS.md §1). Both read `ship.variant`, clamp
     * it into the character's own roster and hand back IDENTITY ONLY — a row of
     * names, colour keys, a trail colour and a cents offset. There is no stat
     * on the other end of either of these, by construction: every number a
     * weapon uses is looked up from the PARENT character row. */
    variantOf: variantOf,
    variantIndexOf: variantIndexOf,

    // per-ship state
    equip: equip,
    revert: revert,
    tick: tick,
    canFire: canFire,
    fire: fire,
    ammoFraction: ammoFraction,

    // projectiles
    updateShot: updateShot,
    onHit: onHit,
    renderShot: renderShot,
    retireShot: retireShot,
    releaseAllShots: releaseAllShots,
    shotPool: shotPool,

    // the bacon strip's burning trail (self-managed; exposed so a board can
    // put it out early if it ever wants to)
    clearTrail: clearTrail,

    // drops
    rollDrop: rollDrop,

    // the winged utensil drawer
    makeCrate: makeCrate,
    updateCrate: updateCrate,
    hitCrate: hitCrate,
    renderCrate: renderCrate,

    // the weapon token
    makeToken: makeToken,
    updateToken: updateToken,
    renderToken: renderToken,
    catchesToken: catchesToken
  };

})(window.T = window.T || {});
