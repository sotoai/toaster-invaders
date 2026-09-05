/* ===========================================================================
 * TOASTER INVADERS — js/sprites.js
 *
 * ROLE: all of the game's art. Every sprite is authored here as a PIXEL MAP —
 * an array of equal-length strings, one character per pixel, '.' = transparent
 * — together with a KEY that maps each character to a colour from T.C.PAL.
 * At boot, build() rasterizes every map once into an offscreen canvas at
 * SCALE = 2 (a 26x17 map becomes a 52x34 sprite). Nothing is ever drawn
 * path-by-path at runtime: the game just blits these canvases.
 *
 * The enemies are After Dark "Flying Toasters": a chrome toaster seen head-on,
 * its dark bread slots reading as eyes with glowing coils inside, and a big
 * white feathered wing on each side. Each body type has FOUR wing frames whose
 * silhouettes differ hard (up / mid-up / thrown-out / down); game.js cycles
 * them 0,1,2,3,2,1 on every formation march step so the whole row flaps — and
 * flaps faster as their friends die.
 *
 * The weapon upgrade system (SPEC-WEAPONS.md section 6) follows: the winged
 * utensil drawer and its wreck, the token roundel, one 16x16 badge per weapon
 * in the roster, and the fifteen upgrade projectiles.
 *
 * After that come the CHARACTER VARIANTS (SPEC-VARIANTS.md section 3). There
 * are three playable versions of every character and NOT ONE of them is a new
 * drawing: a variant is a character's existing pixel map rasterized through a
 * different colour key, plus an optional detail overlay map composited on top.
 * That is what keeps thirty versions looking like one family, and it is why
 * the balance measured over 720 seeded runs survives the feature — see
 * buildCharacterVariants() at the bottom of the file.
 *
 * The middle section is the rest of the playable roster (SPEC-CHARACTERS.md
 * section 4): the seven characters that join the bread and the jam jar —
 * croissant, coffee mug, pepper grinder, honey dipper, cheese wedge, bacon
 * strip and milk carton — each with an idle and a firing-recoil frame, its own
 * base projectile and a half-size HUD life icon. Last of all, and drawn to the
 * same rules, is the secret tenth: the foil-wrapped BURRITO of SPEC-BURRITO.md
 * section 4, who has a body pair and a life icon but NO projectile of his own,
 * because his gun cycles three that already belong to other characters. They
 * are all drawn to the SAME rules as bread0 and jam0 — a dark outline colour
 * running the whole way round, brows one pixel outboard of the eyes, a
 * straight set mouth that opens on the recoil frame, and no colour that is not
 * already in T.C.PAL — because ten characters standing in a select-screen
 * carousel have to read as one family rather than ten separate drawings.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const PAL = T.C.PAL;

  /* Every map is rasterized at this magnification. Sizes quoted in the spec
   * are POST-scale logical pixels, so a 52x34 sprite is a 26x17 map. */
  const SCALE = 2;

  /* A handful of sprites are authored at their FINISHED size and rasterized
   * 1:1 instead, because SCALE 2 cannot express them: the half-size HUD life
   * icons are 22x17, and 17 is odd, so no integer map times 2 reaches it; the
   * 16x16 weapon icons would be 8x8 maps, which cannot tell a crumpet from a
   * pancake and so would fail the spec's "readable at a glance" bar; and four
   * of the base-weapon projectiles are an ODD number of logical pixels wide —
   * drip 7, pepperPellet 5, honeyDrop 7, rind 9 — so once again no integer map
   * times 2 lands on them.
   *
   * Those four widths are the ART sizes SPEC-CHARACTERS.md §4 states, which is
   * a different thing from the HITBOX width on the same character's row in
   * T.C.BASE_WEAPONS: SPEC.md §4 makes the hitbox a weapon stat that the
   * balance harness tunes, and weapons.js draws each shot scaled to its
   * current hitbox. The two agree for some characters and not for others, and
   * that is fine — but do not "fix" a size here to match a tuned number, or
   * the art stops being what the spec asked for AND stops sitting on the grid.
   *
   * Nothing else belongs here. Anything that CAN sit on the SCALE 2 grid must,
   * or it renders with half-size pixels next to art that does not — which is
   * exactly what the eye picks up as "wrong resolution". The finished sizes are
   * the same either way; only the authoring grid differs. */
  const SCALE_OVERRIDE = {
    lifeBread: 1,
    lifeJam: 1,

    // The other seven life icons, same 22x17 exception as the first two.
    lifeCroissant: 1,
    lifeMug: 1,
    lifePepper: 1,
    lifeHoney: 1,
    lifeCheese: 1,
    lifeBacon: 1,
    lifeMilk: 1,

    // The secret tenth character's life icon, same 22x17 exception again.
    lifeBurrito: 1,

    // Odd-width base projectiles (see above).
    drip: 1,
    pepperPellet: 1,
    honeyDrop: 1,
    rind: 1
  };

  /* The weapon-upgrade roster, in SPEC-WEAPONS.md table order. Each id needs
   * an 'icon_<id>' sprite for the HUD chip and for the falling token, so the
   * key / size / scale tables for all fifteen are filled in from this list
   * rather than typed out three times. */
  const WEAPON_ICON_IDS = [
    'butterKnife', 'spaghetti', 'toastCannon', 'scattergun', 'espresso',
    'crumpet', 'megaJam', 'pancake', 'blender', 'condiments',
    'baguette', 'microwave', 'syrup', 'soggy', 'fullEnglish'
  ];

  /* How strongly tint() pushes a sprite toward the requested colour. Low
   * enough that chrome/crumb shading survives — these are accents, not
   * silhouettes. */
  const TINT_ALPHA = 0.55;

  /* -------------------------------------------------------------------------
   * COLOUR KEYS
   * One key per family of sprites. A character may mean different things in
   * different families — the key is always looked up per sprite.
   * ---------------------------------------------------------------------- */

  // Winged chrome toasters: body chrome + slot + coil, wings in feather white.
  const KEY_TOASTER = {
    C: PAL.chrome,
    L: PAL.chromeLt,
    D: PAL.chromeDk,
    S: PAL.slot,
    K: PAL.slot,        // the side lever's groove
    O: PAL.coil,
    o: PAL.coilLt,
    W: PAL.wing,
    w: PAL.wingShade
  };

  // The bonus toaster adds the slice of toast poking out of its slot.
  const KEY_UFO = {
    C: PAL.chrome,
    L: PAL.chromeLt,
    D: PAL.chromeDk,
    S: PAL.slot,
    K: PAL.slot,
    O: PAL.coil,
    o: PAL.coilLt,
    W: PAL.wing,
    w: PAL.wingShade,
    R: PAL.crust,      // crust of the slice riding in the slot
    d: PAL.crumbDark   // its browned face
  };

  // Winged slice of browned toast (ambient drifter, and the type-2 bomb).
  // Crust edge over a crumbDark face, so it reads darker than raw bread.
  const KEY_TOAST = {
    R: PAL.crust,
    d: PAL.crumbDark,
    B: PAL.butter,      // butter soaked into the crumb face
    W: PAL.wing,
    w: PAL.wingShade
  };

  // Untoasted slice of bread: pale crumb, tan crust all the way round.
  const KEY_BREAD = {
    R: PAL.crust,
    b: PAL.crumb,
    d: PAL.crumbDark,
    K: PAL.burnt        // eyes / brows / mouth
  };

  // Jam jar: glass, jam, cloth lid, paper label.
  const KEY_JAM = {
    G: PAL.glass,
    g: PAL.glassDark,
    J: PAL.jamRed,
    j: PAL.jamLite,
    b: PAL.crumb,       // cloth lid + label paper
    d: PAL.crumbDark,   // gingham check
    R: PAL.crust,       // string tie
    K: PAL.burnt        // face
  };

  /* --- the other seven playable characters (SPEC-CHARACTERS.md section 4) ---
   * One key per character, shared by its two body frames, its projectile and
   * its life icon so a character is the same handful of colours everywhere it
   * appears. Every entry is a T.C.PAL colour: the roster is built out of the
   * existing breakfast palette rather than seven new private ones, which is
   * most of what makes nine characters look like one set. The secret tenth
   * follows the same rule one section down.
   *
   * In all seven, K is the FACE — brows, eyes and mouth — exactly as it is in
   * KEY_BREAD and KEY_JAM. */

  // Croissant: browned crust edge over pale flaky crumb, butter glaze on top.
  const KEY_CROISSANT = {
    R: PAL.crust,       // outer crust, seams between the layers
    b: PAL.crumb,       // flaky interior
    d: PAL.crumbDark,   // underside shading
    B: PAL.butter,      // glazed sheen along the top of each layer
    K: PAL.burnt        // face
  };

  // Diner mug: thick china white, a dark rim line, black coffee with crema,
  // a cobalt band round the middle and a wisp of steam off the top.
  const KEY_MUG = {
    W: PAL.wing,        // china
    w: PAL.wingShade,   // china in shadow
    D: PAL.chromeDk,    // rim, base and handle outline
    K: PAL.burnt,       // coffee, and the face
    R: PAL.crust,       // crema on the coffee surface
    g: PAL.glassDark,   // the diner stripe
    G: PAL.glass        // steam
  };

  // Pepper grinder: turned wooden body, chrome dome cap, dark grind slot.
  const KEY_PEPPER = {
    R: PAL.crust,       // wood edge
    d: PAL.crumbDark,   // wood body
    K: PAL.burnt,       // grain, and the face
    C: PAL.chrome,      // cap and base ring
    L: PAL.chromeLt,
    D: PAL.chromeDk,
    S: PAL.slot         // the grind slot, and the peppercorn itself
  };

  // Honey dipper standing in its jar: amber honey behind cold glass, with the
  // grooved wooden dipper above it.
  const KEY_HONEY = {
    B: PAL.butter,      // honey
    L: PAL.butterLt,    // meniscus and comb highlights
    R: PAL.crust,       // the dipper's turned wood
    K: PAL.burnt,       // face
    G: PAL.glass,       // jar glass
    g: PAL.glassDark
  };

  // Cheese wedge: bright paste, duller holes, a hard crust rind down the back.
  const KEY_CHEESE = {
    B: PAL.butter,      // the paste
    L: PAL.butterLt,    // lit cut face along the slope
    d: PAL.crumbDark,   // holes and the shaded corner
    R: PAL.crust,       // rind
    K: PAL.burnt        // face
  };

  // Bacon rasher: red meat striped with cream fat, edges crisped black.
  const KEY_BACON = {
    J: PAL.jamRed,      // meat
    j: PAL.jamLite,     // the wet highlight running down one stripe
    b: PAL.crumb,       // fat
    K: PAL.burnt        // crisped edge, and the face
  };

  // Milk carton: waxed white board, cobalt dairy band, printed pale lettering.
  const KEY_MILK = {
    W: PAL.wing,        // board
    w: PAL.wingShade,   // the folded gable panel and the shaded corner
    D: PAL.chromeDk,    // printed outline
    g: PAL.glassDark,   // dairy band
    G: PAL.glass,       // lettering on the band
    K: PAL.burnt        // face
  };

  /* --- the secret tenth character (SPEC-BURRITO.md sections 3 and 4) -------
   * BURRITO is two materials stacked: a griddled tortilla holding its filling
   * at the top, and the foil sheath the rest of him is wrapped in. C/L/D are
   * the foil — body, the bright crease down its left side, and the scorched
   * creases and outline; R/b/d are the tortilla, darkest first, the same
   * outline-then-body-then-shading order the other nine use for their skins;
   * J/j are the filling and its lit edge. K is the face, as everywhere else.
   *
   * These nine MAP characters and no others are what his three variant keys in
   * T.C.BASE_WEAPONS.burrito.variants give colours to, and this key must give
   * each of them the same colour variant 0 (CARNE ASADA) does — build() proves
   * that with assertVariantZeroMatchesBase(), because index 0 is by definition
   * the character as this file draws him. */
  const KEY_BURRITO = {
    C: PAL.burritoFoil,    // foil sheath
    L: PAL.burritoFoilLt,  // the bright crease down one side of it
    D: PAL.burritoFoilDk,  // scorched creases, the fold shadow, the outline
    R: PAL.cinnamon,       // griddled tortilla, outline
    b: PAL.cinnamonDust,   // tortilla body
    d: PAL.crust,          // tortilla shading where the wrap folds open
    J: PAL.carneAsada,     // filling
    j: PAL.carneChar,      // its lit, charred edge
    K: PAL.burnt           // face
  };

  // Bacon's trail ember: a coil spark going out.
  const KEY_EMBER = {
    O: PAL.coil,
    o: PAL.coilLt,
    K: PAL.burnt
  };

  const KEY_BUTTER = { B: PAL.butter, L: PAL.butterLt };
  const KEY_JAMSHOT = { J: PAL.jamRed, j: PAL.jamLite };
  const KEY_CRUMB = { b: PAL.crumb, d: PAL.crumbDark };
  const KEY_SPARK = { O: PAL.coil, o: PAL.coilLt };

  // Enemy explosion: chrome shrapnel, crumbs and coil sparks.
  const KEY_BOOM = {
    C: PAL.chrome,
    L: PAL.chromeLt,
    b: PAL.crumb,
    O: PAL.coil,
    o: PAL.coilLt
  };

  // Player death: charred toast, crust still tan, embers in the cracks.
  const KEY_BURNT = {
    K: PAL.burnt,
    R: PAL.crust,
    O: PAL.coil,
    o: PAL.coilLt
  };

  // Stick-of-butter barricade with its paper wrapper.
  const KEY_BUNKER = {
    B: PAL.butter,
    L: PAL.butterLt,
    R: PAL.crust,       // shadowed side + melted base
    b: PAL.crumb,       // wrapper paper
    d: PAL.crumbDark    // wrapper print
  };

  // The winged utensil drawer: pine drawer front (crust / crumbDark / burnt),
  // chrome cutlery and handle, and a pair of After Dark feathers either side.
  const KEY_CRATE = {
    R: PAL.crust,       // drawer front
    d: PAL.crumbDark,   // sunlit top face
    K: PAL.burnt,       // grain, shadow, splinters
    C: PAL.chrome,      // cutlery
    L: PAL.chromeLt,    // cutlery highlight
    D: PAL.chromeDk,    // cutlery shadow
    W: PAL.wing,
    w: PAL.wingShade
  };

  // The token roundel: a chrome ring around a dark well the icon sits in.
  const KEY_SHELL = {
    L: PAL.chromeLt,
    C: PAL.chrome,
    D: PAL.chromeDk,
    S: PAL.slot
  };

  /* One shared key for all fifteen 16x16 weapon icons. They are drawn against
   * the dark token well and the dark HUD strip, so every icon leans on bright
   * fills with darker detail rather than an outline. */
  const KEY_ICON = {
    C: PAL.chrome,
    L: PAL.chromeLt,
    D: PAL.chromeDk,
    S: PAL.slot,
    K: PAL.burnt,
    R: PAL.crust,
    b: PAL.crumb,
    d: PAL.crumbDark,
    B: PAL.butter,
    Y: PAL.butterLt,
    J: PAL.jamRed,
    j: PAL.jamLite,
    O: PAL.coil,
    o: PAL.coilLt,
    g: PAL.glassDark,
    W: PAL.wing
  };

  // Upgrade projectiles made of metal: knives and blender blades.
  const KEY_STEEL = {
    L: PAL.chromeLt,
    C: PAL.chrome,
    D: PAL.chromeDk,
    R: PAL.crust        // knife handle
  };

  // Upgrade projectiles that came out of an oven: toast, cereal, crumpets,
  // pancakes, beans, syrup and the baguette lance.
  const KEY_BAKED = {
    R: PAL.crust,
    d: PAL.crumbDark,
    b: PAL.crumb,
    B: PAL.butter,
    K: PAL.burnt        // scored crust marks
  };

  // Soggy bread: pale crust round a cold blue-grey middle.
  const KEY_SOGGY = {
    b: PAL.crumb,
    d: PAL.crumbDark,
    g: PAL.glassDark
  };

  /* -------------------------------------------------------------------------
   * WHICH KEY EACH SPRITE USES
   * ---------------------------------------------------------------------- */
  const KEYS = {
    toastA0: KEY_TOASTER, toastA1: KEY_TOASTER, toastA2: KEY_TOASTER, toastA3: KEY_TOASTER,
    toastB0: KEY_TOASTER, toastB1: KEY_TOASTER, toastB2: KEY_TOASTER, toastB3: KEY_TOASTER,
    toastC0: KEY_TOASTER, toastC1: KEY_TOASTER, toastC2: KEY_TOASTER, toastC3: KEY_TOASTER,

    ufo: KEY_UFO, ufo1: KEY_UFO,

    toastFly0: KEY_TOAST, toastFly1: KEY_TOAST,

    bread0: KEY_BREAD, bread1: KEY_BREAD,
    jam0: KEY_JAM, jam1: KEY_JAM,

    butter: KEY_BUTTER,
    jamShot: KEY_JAMSHOT,
    bomb0a: KEY_CRUMB, bomb0b: KEY_CRUMB,
    bomb1a: KEY_SPARK, bomb1b: KEY_SPARK,
    bomb2a: KEY_TOAST, bomb2b: KEY_TOAST,

    boomEnemy: KEY_BOOM,
    boomPlayer0: KEY_BURNT, boomPlayer1: KEY_BURNT,

    lifeBread: KEY_BREAD, lifeJam: KEY_JAM,

    bunker: KEY_BUNKER,

    // --- weapon upgrade system (SPEC-WEAPONS.md section 6) ----------------
    crate0: KEY_CRATE, crate1: KEY_CRATE, crateHit: KEY_CRATE,
    tokenShell: KEY_SHELL,

    wKnife0: KEY_STEEL, wKnife1: KEY_STEEL,
    wBlade0: KEY_STEEL, wBlade1: KEY_STEEL,

    wNoodle: KEY_BAKED,
    wToast: KEY_BAKED,
    wCrumb: KEY_BAKED,
    wLoop: KEY_BAKED,
    wBean: KEY_BAKED,
    wCrumpet: KEY_BAKED,
    wPancake0: KEY_BAKED, wPancake1: KEY_BAKED,
    wSyrup: KEY_BAKED,
    wBaguette: KEY_BAKED, wBaguetteTip: KEY_BAKED,

    wJamGlob: KEY_JAMSHOT,
    wKetchup: KEY_JAMSHOT,
    wMustard: KEY_BUTTER,
    wSoggy: KEY_SOGGY,

    // --- the other seven characters (SPEC-CHARACTERS.md section 4) ---------
    // Body frames, base projectile and life icon all share one key.
    croissant0: KEY_CROISSANT, croissant1: KEY_CROISSANT,
    flake: KEY_CROISSANT, lifeCroissant: KEY_CROISSANT,

    mug0: KEY_MUG, mug1: KEY_MUG,
    drip: KEY_MUG, lifeMug: KEY_MUG,

    pepper0: KEY_PEPPER, pepper1: KEY_PEPPER,
    pepperPellet: KEY_PEPPER, lifePepper: KEY_PEPPER,

    honey0: KEY_HONEY, honey1: KEY_HONEY,
    honeyDrop: KEY_HONEY, lifeHoney: KEY_HONEY,

    cheese0: KEY_CHEESE, cheese1: KEY_CHEESE,
    rind: KEY_CHEESE, lifeCheese: KEY_CHEESE,

    bacon0: KEY_BACON, bacon1: KEY_BACON,
    sizzle: KEY_BACON, lifeBacon: KEY_BACON,
    sizzleTrail: KEY_EMBER,

    milk0: KEY_MILK, milk1: KEY_MILK,
    splash0: KEY_MILK, splash1: KEY_MILK, splash2: KEY_MILK,
    lifeMilk: KEY_MILK,

    /* --- the secret tenth character (SPEC-BURRITO.md section 4) -----------
     * Body frames and life icon only. He has NO projectile art of his own:
     * his gun cycles sizzle / flake / pepperPellet, which are the bacon
     * strip's, the croissant's and the pepper grinder's, and are already
     * registered above. */
    burrito0: KEY_BURRITO, burrito1: KEY_BURRITO,
    lifeBurrito: KEY_BURRITO
  };

  /* -------------------------------------------------------------------------
   * EXPECTED LOGICAL SIZES (post-scale) — straight out of the spec.
   * build() checks every sprite against this table, because the formation and
   * collision maths in game.js assume these exact numbers. A map that is one
   * row or column off would silently shift the whole board.
   * ---------------------------------------------------------------------- */
  const SIZES = {
    toastA0: [52, 34], toastA1: [52, 34], toastA2: [52, 34], toastA3: [52, 34],
    toastB0: [56, 34], toastB1: [56, 34], toastB2: [56, 34], toastB3: [56, 34],
    toastC0: [60, 34], toastC1: [60, 34], toastC2: [60, 34], toastC3: [60, 34],

    ufo: [76, 34], ufo1: [76, 34],

    toastFly0: [20, 20], toastFly1: [20, 20],

    bread0: [44, 34], bread1: [44, 34],
    jam0: [44, 34], jam1: [44, 34],

    butter: [10, 16],
    jamShot: [6, 16],
    bomb0a: [8, 16], bomb0b: [8, 16],
    bomb1a: [8, 16], bomb1b: [8, 16],
    bomb2a: [16, 16], bomb2b: [16, 16],

    boomEnemy: [48, 32],
    boomPlayer0: [44, 34], boomPlayer1: [44, 34],

    lifeBread: [22, 17], lifeJam: [22, 17],

    bunker: [96, 64],

    // --- weapon upgrade system (SPEC-WEAPONS.md section 6) ----------------
    crate0: [46, 34], crate1: [46, 34], crateHit: [46, 34],
    tokenShell: [28, 28],

    wKnife0: [14, 14], wKnife1: [14, 14],
    wNoodle: [8, 22],
    wToast: [18, 16],
    wCrumb: [6, 6],
    wLoop: [10, 10],
    wBean: [6, 8],
    wCrumpet: [16, 14],
    wPancake0: [20, 10], wPancake1: [20, 10],
    wBlade0: [20, 20], wBlade1: [20, 20],
    wJamGlob: [18, 18],
    wSyrup: [14, 18],
    wKetchup: [8, 12], wMustard: [8, 12],
    wSoggy: [16, 12],
    wBaguette: [18, 24], wBaguetteTip: [18, 14],

    /* --- the other seven characters (SPEC-CHARACTERS.md section 4) --------
     * Every playable body is 44x34, the same box as bread0 and jam0, because
     * T.C.SHIP_W / SHIP_H and the ship collision box are one pair of numbers
     * for all ten — a character drawn a pixel wider would be a character with
     * a different hitbox. The projectile sizes are the hitboxes out of
     * T.C.BASE_WEAPONS, and the life icons are half-size like the first two. */
    croissant0: [44, 34], croissant1: [44, 34],
    mug0: [44, 34], mug1: [44, 34],
    pepper0: [44, 34], pepper1: [44, 34],
    honey0: [44, 34], honey1: [44, 34],
    cheese0: [44, 34], cheese1: [44, 34],
    bacon0: [44, 34], bacon1: [44, 34],
    milk0: [44, 34], milk1: [44, 34],

    flake: [8, 14],
    drip: [7, 14],
    pepperPellet: [5, 10],
    honeyDrop: [7, 16],
    rind: [9, 14],
    sizzle: [6, 18], sizzleTrail: [8, 8],
    splash0: [4, 12], splash1: [10, 12], splash2: [16, 12],

    lifeCroissant: [22, 17], lifeMug: [22, 17], lifePepper: [22, 17],
    lifeHoney: [22, 17], lifeCheese: [22, 17], lifeBacon: [22, 17],
    lifeMilk: [22, 17],

    /* --- the secret tenth character (SPEC-BURRITO.md section 4) -----------
     * The same 44x34 ship box and the same 22x17 life icon as the other nine.
     * He is a secret to the PLAYER, not to the collision maths: a character
     * the select screen hides until wave 5 still has to be exactly one ship
     * wide when it finally reaches the play field. No projectile row, because
     * he borrows three that are already up there. */
    burrito0: [44, 34], burrito1: [44, 34],
    lifeBurrito: [22, 17]
  };

  /* The fifteen weapon icons are identical in every respect except their art,
   * so their three table entries are filled in from WEAPON_ICON_IDS. */
  for (let i = 0; i < WEAPON_ICON_IDS.length; i++) {
    const iconName = 'icon_' + WEAPON_ICON_IDS[i];
    KEYS[iconName] = KEY_ICON;
    SIZES[iconName] = [16, 16];
    SCALE_OVERRIDE[iconName] = 1;
  }

  /* -------------------------------------------------------------------------
   * THE PIXEL MAPS
   *
   * Toaster legend:  C chrome  L highlight  D shadow  S slot  K lever groove
   *                  O coil    o coil glow  W feather  w feather shadow
   * ---------------------------------------------------------------------- */
  const MAPS = {

    /* ---- ROW 0: slim tall 2-slot chrome toaster, 30 pts -------------------
     * Narrow upright body, two tall slots, dial low on the right, lever left. */
    toastA0: [
      'WwWw..................wWwW',
      'WwWwW.....LLLLLL.....WwWwW',
      '.wWwWw...DLLLLLLD...wWwWw.',
      '..WwWwW.DLLLLLLLLD.WwWwW..',
      '...wWwWwDSSSLLSSSDwWwWw...',
      '....WwWwDSoSCCSoSDwWwW....',
      '.....wWwDSOSCCSOSDwWw.....',
      '......WwDSSSCCSSSDwW......',
      '........DCCCCCCCCD........',
      '........DCKCCCCCCD........',
      '........DLKCCDDDCD........',
      '........DLKCCDoDCD........',
      '........DCKCCDDDCD........',
      '........DCCCCCCCCD........',
      '........DDDDDDDDDD........',
      '.........DD....DD.........',
      '..........................'
    ],
    toastA1: [
      '..........................',
      '..........LLLLLL..........',
      '.........DLLLLLLD.........',
      'Ww......DLLLLLLLLD......wW',
      'WwWw....DSSSLLSSSD....wWwW',
      '.wWwWw..DSoSCCSoSD..wWwWw.',
      '...wWwWwDSOSCCSOSDwWwWw...',
      '.....wWwDSSSCCSSSDwWw.....',
      '......WwDCCCCCCCCDwW......',
      '........DCKCCCCCCD........',
      '........DLKCCDDDCD........',
      '........DLKCCDoDCD........',
      '........DCKCCDDDCD........',
      '........DCCCCCCCCD........',
      '........DDDDDDDDDD........',
      '.........DD....DD.........',
      '..........................'
    ],
    toastA2: [
      '..........................',
      '..........LLLLLL..........',
      '.........DLLLLLLD.........',
      '........DLLLLLLLLD........',
      '........DSSSLLSSSD........',
      '......WwDSoSCCSoSDwW......',
      '....WwWwDSOSCCSOSDwWwW....',
      'WwWwWwWwDSSSCCSSSDwWwWwWwW',
      'WwWwWwWwDCCCCCCCCDwWwWwWwW',
      '.wWwWwWwDCKCCCCCCDwWwWwWw.',
      '....WwWwDLKCCDDDCDwWwW....',
      '........DLKCCDoDCD........',
      '........DCKCCDDDCD........',
      '........DCCCCCCCCD........',
      '........DDDDDDDDDD........',
      '.........DD....DD.........',
      '..........................'
    ],
    toastA3: [
      '..........................',
      '..........LLLLLL..........',
      '.........DLLLLLLD.........',
      '........DLLLLLLLLD........',
      '........DSSSLLSSSD........',
      '........DSoSCCSoSD........',
      '.......wDSOSCCSOSDw.......',
      '......WwDSSSCCSSSDwW......',
      '.....wWwDCCCCCCCCDwWw.....',
      '....WwWwDCKCCCCCCDwWwW....',
      '..WwWwW.DLKCCDDDCD.WwWwW..',
      '.wWwWw..DLKCCDoDCD..wWwWw.',
      'WwWwW...DCKCCDDDCD...WwWwW',
      'WwWw....DCCCCCCCCD....wWwW',
      'WwW.....DDDDDDDDDD.....WwW',
      '.........DD....DD.........',
      '..........................'
    ],

    /* ---- ROWS 1-2: classic wide 2-slice toaster, 20 pts -------------------
     * Squat and broad, two fat slots each holding a pair of coils. */
    toastB0: [
      'WwWw....................wWwW',
      'WwWwW..................WwWwW',
      '.wWwWw................wWwWw.',
      '..WwWwW...LLLLLLLL...WwWwW..',
      '...wWwWw.DLLLLLLLLD.wWwWw...',
      '....WwWwDLLLLLLLLLLDwWwW....',
      '.....wWwDSSSSLLSSSSDwWw.....',
      '......WwDSooSCCSooSDwW......',
      '........DSOOSCCSOOSD........',
      '........DSSSSCCSSSSD........',
      '........DCCCCCCCCCCD........',
      '........DCKCCCCDDDCD........',
      '........DLKCCCCDoDCD........',
      '........DLKCCCCDDDCD........',
      '........DDDDDDDDDDDD........',
      '.........DD......DD.........',
      '............................'
    ],
    toastB1: [
      '............................',
      '............................',
      '............................',
      'Ww........LLLLLLLL........wW',
      'WwWw.....DLLLLLLLLD.....wWwW',
      '.wWwWw..DLLLLLLLLLLD..wWwWw.',
      '...wWwWwDSSSSLLSSSSDwWwWw...',
      '.....wWwDSooSCCSooSDwWw.....',
      '......WwDSOOSCCSOOSDwW......',
      '........DSSSSCCSSSSD........',
      '........DCCCCCCCCCCD........',
      '........DCKCCCCDDDCD........',
      '........DLKCCCCDoDCD........',
      '........DLKCCCCDDDCD........',
      '........DDDDDDDDDDDD........',
      '.........DD......DD.........',
      '............................'
    ],
    toastB2: [
      '............................',
      '............................',
      '............................',
      '..........LLLLLLLL..........',
      '.........DLLLLLLLLD.........',
      '......WwDLLLLLLLLLLDwW......',
      '....WwWwDSSSSLLSSSSDwWwW....',
      'WwWwWwWwDSooSCCSooSDwWwWwWwW',
      'WwWwWwWwDSOOSCCSOOSDwWwWwWwW',
      '.wWwWwWwDSSSSCCSSSSDwWwWwWw.',
      '....WwWwDCCCCCCCCCCDwWwW....',
      '........DCKCCCCDDDCD........',
      '........DLKCCCCDoDCD........',
      '........DLKCCCCDDDCD........',
      '........DDDDDDDDDDDD........',
      '.........DD......DD.........',
      '............................'
    ],
    toastB3: [
      '............................',
      '............................',
      '............................',
      '..........LLLLLLLL..........',
      '.........DLLLLLLLLD.........',
      '........DLLLLLLLLLLD........',
      '.......wDSSSSLLSSSSDw.......',
      '......WwDSooSCCSooSDwW......',
      '.....wWwDSOOSCCSOOSDwWw.....',
      '....WwWwDSSSSCCSSSSDwWwW....',
      '..WwWwW.DCCCCCCCCCCD.WwWwW..',
      '.wWwWw..DCKCCCCDDDCD..wWwWw.',
      'WwWwW...DLKCCCCDoDCD...WwWwW',
      'WwWw....DLKCCCCDDDCD....wWwW',
      'WwW.....DDDDDDDDDDDD.....WwW',
      '.........DD......DD.........',
      '............................'
    ],

    /* ---- ROWS 3-4: chunky 4-slot toaster, 10 pts --------------------------
     * The big family model: four short slots in a row, wide flat crown. */
    toastC0: [
      'WwWw......................wWwW',
      'WwWwW....................WwWwW',
      '.wWwWw....LLLLLLLLLL....wWwWw.',
      '..WwWwW..DLLLLLLLLLLD..WwWwW..',
      '...wWwWwDLLLLLLLLLLLLDwWwWw...',
      '....WwWwDSSLSSLLSSLSSDwWwW....',
      '.....wWwDooCooCCooCooDwWw.....',
      '......WwDOOCOOCCOOCOODwW......',
      '........DSSCSSCCSSCSSD........',
      '........DCCCCCCCCCCCCD........',
      '........DCKCCCCCCDDDCD........',
      '........DLKCCCCCCDoDCD........',
      '........DLKCCCCCCDDDCD........',
      '........DCCCCCCCCCCCCD........',
      '........DDDDDDDDDDDDDD........',
      '.........DD........DD.........',
      '..............................'
    ],
    toastC1: [
      '..............................',
      '..............................',
      '..........LLLLLLLLLL..........',
      'Ww.......DLLLLLLLLLLD.......wW',
      'WwWw....DLLLLLLLLLLLLD....wWwW',
      '.wWwWw..DSSLSSLLSSLSSD..wWwWw.',
      '...wWwWwDooCooCCooCooDwWwWw...',
      '.....wWwDOOCOOCCOOCOODwWw.....',
      '......WwDSSCSSCCSSCSSDwW......',
      '........DCCCCCCCCCCCCD........',
      '........DCKCCCCCCDDDCD........',
      '........DLKCCCCCCDoDCD........',
      '........DLKCCCCCCDDDCD........',
      '........DCCCCCCCCCCCCD........',
      '........DDDDDDDDDDDDDD........',
      '.........DD........DD.........',
      '..............................'
    ],
    toastC2: [
      '..............................',
      '..............................',
      '..........LLLLLLLLLL..........',
      '.........DLLLLLLLLLLD.........',
      '........DLLLLLLLLLLLLD........',
      '......WwDSSLSSLLSSLSSDwW......',
      '....WwWwDooCooCCooCooDwWwW....',
      'WwWwWwWwDOOCOOCCOOCOODwWwWwWwW',
      'WwWwWwWwDSSCSSCCSSCSSDwWwWwWwW',
      '.wWwWwWwDCCCCCCCCCCCCDwWwWwWw.',
      '....WwWwDCKCCCCCCDDDCDwWwW....',
      '........DLKCCCCCCDoDCD........',
      '........DLKCCCCCCDDDCD........',
      '........DCCCCCCCCCCCCD........',
      '........DDDDDDDDDDDDDD........',
      '.........DD........DD.........',
      '..............................'
    ],
    toastC3: [
      '..............................',
      '..............................',
      '..........LLLLLLLLLL..........',
      '.........DLLLLLLLLLLD.........',
      '........DLLLLLLLLLLLLD........',
      '........DSSLSSLLSSLSSD........',
      '.......wDooCooCCooCooDw.......',
      '......WwDOOCOOCCOOCOODwW......',
      '.....wWwDSSCSSCCSSCSSDwWw.....',
      '....WwWwDCCCCCCCCCCCCDwWwW....',
      '..WwWwW.DCKCCCCCCDDDCD.WwWwW..',
      '.wWwWw..DLKCCCCCCDoDCD..wWwWw.',
      'WwWwW...DLKCCCCCCDDDCD...WwWwW',
      'WwWw....DCCCCCCCCCCCCD....wWwW',
      'WwW.....DDDDDDDDDDDDDD.....WwW',
      '.........DD........DD.........',
      '..............................'
    ],

    /* ---- THE BONUS "CHROME DELUXE" ---------------------------------------
     * Pure side profile, nose to the right, one big wing beating behind it,
     * a diagonal chrome shine down the flank and a slice of toast riding up
     * out of the slot. The two frames are opposite ends of the wing beat. */
    ufo: [
      '...wWwWwW.............................',
      '..WwWwWwWwW............RRRRRR.........',
      '.wWwWwWwWwWwW..........RddddR.........',
      'WwWwWwWwWwWwWw.........RddddR.........',
      'WwWwWwWwWwWwWwW..LLLLLSSSSSSSSLLLLLLL.',
      '..WwWwWwWwWwWwWwDLLLLLSSSSSSSSLLLLLLLD',
      '.....wWwWwWwWwWwCKLLCCCCCCCCCCCCCCCCCD',
      '.........wWwWwWwCKCLLCCCCCCCCCCCCCCCCD',
      '............WwWwCKCCLLCCCCCCCCCCCCCCCD',
      '..............WwLKCCCLLCCCCCCCCCDDDCCD',
      '................LKCCCCLLCCCCCCCCDoDCCD',
      '................CCCCCCCLLCCCCCCCDDDCCD',
      '................CCCCCCCCLLCCCCCCCCCCCD',
      '................CCCCCCCCCLLCCCCCCCCCCD',
      '................CCCCCCCCCCLLCCCCCCCCCD',
      '................DDDDDDDDDDDDDDDDDDDDDD',
      '.................DDD.............DDD..'
    ],
    ufo1: [
      '......................................',
      '.......................RRRRRR.........',
      '.......................RddddR.........',
      '.......................RddddR.........',
      '.................LLLLLSSSSSSSSLLLLLLL.',
      '................DLLLLLSSSSSSSSLLLLLLLD',
      '..............WwCKLLCCCCCCCCCCCCCCCCCD',
      '............WwWwCKCLLCCCCCCCCCCCCCCCCD',
      '.........wWwWwWwCKCCLLCCCCCCCCCCCCCCCD',
      '.....wWwWwWwWwWwLKCCCLLCCCCCCCCCDDDCCD',
      '..WwWwWwWwWwWwWwLKCCCCLLCCCCCCCCDoDCCD',
      'WwWwWwWwWwWwWwW.CCCCCCCLLCCCCCCCDDDCCD',
      'WwWwWwWwWwWwWw..CCCCCCCCLLCCCCCCCCCCCD',
      '.wWwWwWwWwWwW...CCCCCCCCCLLCCCCCCCCCCD',
      '..WwWwWwWwW.....CCCCCCCCCCLLCCCCCCCCCD',
      '...wWwWwW.......DDDDDDDDDDDDDDDDDDDDDD',
      '....WwW..........DDD.............DDD..'
    ],

    /* ---- WINGED TOAST -----------------------------------------------------
     * The other half of the screensaver. Drifts across the background, and is
     * the same creature as the type-2 bomb (bomb2a/bomb2b) — so it is drawn on
     * the same SCALE 2 grid, with the same 2px pixel, or the two read as two
     * different resolutions of one object when they share the screen.
     *
     * A 10x10 map at SCALE 2 is the finished 20x20: a domed top over a browned
     * crust running all the way round a lighter crumb face, two butter-melt
     * speckles soaked into it, and a feather each side.
     *
     * The BODY is pixel-identical in both frames and only the wings move —
     * that is what makes the pair read as a flap rather than a jitter — and in
     * both frames the wing meets the crust, so it never floats free of the
     * slice. Frame 0 has them swept UP over the shoulders, frame 1 DOWN past
     * the base. */
    toastFly0: [
      'Ww......wW',
      'WW.RRRR.WW',
      'WwRRRRRRwW',
      'WwRddddRwW',
      '.wRddddRw.',
      '..RdBddR..',
      '..RddddR..',
      '..RddBdR..',
      '..RddddR..',
      '..RRRRRR..'
    ],
    toastFly1: [
      '..........',
      '...RRRR...',
      '..RRRRRR..',
      '..RddddR..',
      '..RddddR..',
      '.wRdBddRw.',
      'WwRddddRwW',
      'WwRddBdRwW',
      'WWRddddRWW',
      'WwRRRRRRwW'
    ],

    /* ---- PLAYER 1 CHARACTER: UNTOASTED BREAD ------------------------------
     * Pale crumb interior, tan crust running the whole way round, a set jaw
     * and two stubby arms. Frame 1 is the firing recoil: arms up, mouth open,
     * whole slice knocked down a pixel. */
    bread0: [
      '......RRRRRRRRRR......',
      '....RRRRRRRRRRRRRR....',
      '...RbbbbbbbbbbbbbbR...',
      '..RbbbbbbbbbbbbbbbbR..',
      '..RbbbbbbbbbbbbbbbbR..',
      '..RbbKKbbbbbbbbKKbbR..',
      '..RbbbKKbbbbbbKKbbbR..',
      '..RbbbKKbbbbbbKKbbbR..',
      '..RbbbKKbbbbbbKKbbbR..',
      '.RRbbbbbbbbbbbbbbbbRR.',
      'RRRbbbbbKKKKKKbbbbbRRR',
      '.RRbbbbbbbbbbbbbbbbRR.',
      '..RbbbbbbbbbbbbbbddR..',
      '..RbbbbbbbbbbbbddddR..',
      '..RbbbbbbbbbbddddddR..',
      '..RRRRRRRRRRRRRRRRRR..',
      '...RRRRRRRRRRRRRRRR...'
    ],
    bread1: [
      '......................',
      '......RRRRRRRRRR......',
      '....RRRRRRRRRRRRRR....',
      '...RbbbbbbbbbbbbbbR...',
      '..RbbbbbbbbbbbbbbbbR..',
      '..RbbKKKbbbbbbKKKbbR..',
      '..RbbbKKbbbbbbKKbbbR..',
      '..RbbbKKbbbbbbKKbbbR..',
      'RRRbbbbbbbbbbbbbbbbRRR',
      '.RRbbbbKKKKKKKKbbbbRR.',
      '..RbbbbKKKKKKKKbbbbR..',
      '..RbbbbbKKKKKKbbbbbR..',
      '..RbbbbbbbbbbbbbbddR..',
      '..RbbbbbbbbbbbbddddR..',
      '..RbbbbbbbbbbddddddR..',
      '..RbbbbbbbbddddddddR..',
      '..RRRRRRRRRRRRRRRRRR..'
    ],

    /* ---- PLAYER 2 CHARACTER: JAM JAR --------------------------------------
     * Gingham cloth lid with a string tie, glass shoulders, a bright glass
     * highlight down the left, deep red jam with a lighter meniscus, and a
     * paper label. Frame 1 opens its mouth and the jam sloshes. */
    jam0: [
      '.....bbbbbbbbbbbb.....',
      '....bbbbbbbbbbbbbb....',
      '....bdbdbdbdbdbdbd....',
      '.....RRRRRRRRRRRR.....',
      '....gGGGGGGGGGGGGg....',
      '...gGGGGGGGGGGGGGGg...',
      '..gGGjjjjjjjjjjjjjjg..',
      '..gGGJJKKJJJJKKJJJJg..',
      '..gGGJJKKJJJJKKJJJJg..',
      '..gGGJJJJJJJJJJJJJJg..',
      '..gGGJJJKKKKKKJJJJJg..',
      '..gGGJJJJJJJJJJJJJJg..',
      '..gGGbbbbbbbbbbbbJJg..',
      '..gGGbJJJJJJJJJJbJJg..',
      '..gGGbbbbbbbbbbbbJJg..',
      '..gJJJJJJJJJJJJJJJJg..',
      '..gggggggggggggggggg..'
    ],
    jam1: [
      '.....bbbbbbbbbbbb.....',
      '....bbbbbbbbbbbbbb....',
      '....dbdbdbdbdbdbdb....',
      '.....RRRRRRRRRRRR.....',
      '....gGGGGGGGGGGGGg....',
      '...gGGGGGGGGGGGGGGg...',
      '..gGGjjjjjjjjjjjjjjg..',
      '..gGGJJKKJJJJKKJJJJg..',
      '..gGGJJKKJJJJKKJJJJg..',
      '..gGGJJJKKKKKKJJJJJg..',
      '..gGGJJJKKKKKKJJJJJg..',
      '..gGGJJJJJJJJJJJJJJg..',
      '..gGGbbbbbbbbbbbbJJg..',
      '..gGGbJJJJJJJJJJbJJg..',
      '..gGGbbbbbbbbbbbbJJg..',
      '..gJJJJJJJJJJJJJJJJg..',
      '..gggggggggggggggggg..'
    ],

    /* ---- PROJECTILES ------------------------------------------------------ */

    // Bread's weapon: a fat pat of butter with a melting drip off the back.
    butter: [
      '.LLL.',
      'LBBBL',
      'LBBBL',
      'LBBBL',
      'LBBBL',
      '.BBB.',
      '.B.B.',
      '..B..'
    ],

    // Jam's weapon: a narrow glob with a highlight down its leading edge.
    jamShot: [
      '.j.',
      'jJJ',
      'jJJ',
      '.JJ',
      '.JJ',
      '.J.',
      '.J.',
      '.J.'
    ],

    // Bomb type 0 — a scatter of tumbling crumbs.
    bomb0a: [
      '.b..',
      'bdb.',
      '.b.b',
      '..b.',
      '.bd.',
      'b.b.',
      '.bb.',
      '..b.'
    ],
    bomb0b: [
      '..b.',
      '.bd.',
      'b.b.',
      '.b.b',
      '..b.',
      '.db.',
      'b.b.',
      '.b..'
    ],

    // Bomb type 1 — a spat of white-hot heating element.
    bomb1a: [
      '..o.',
      '.oO.',
      '.O..',
      'oO..',
      '.Oo.',
      '..O.',
      '.oO.',
      '.O..'
    ],
    bomb1b: [
      '.o..',
      '.Oo.',
      '..O.',
      '..Oo',
      '.oO.',
      '.O..',
      '.Oo.',
      '..O.'
    ],

    // Bomb type 2 — a winged slice thrown flat, then tumbling side-on.
    bomb2a: [
      '..RRRR..',
      '..RddR..',
      'WwRddRwW',
      'WwRddRwW',
      '.wRddRw.',
      '..RddR..',
      '..RRRR..',
      '........'
    ],
    bomb2b: [
      '..W..W..',
      '.ww..ww.',
      'RRRRRRRR',
      'RddddddR',
      'RRRRRRRR',
      '.ww..ww.',
      '..W..W..',
      '........'
    ],

    /* ---- FX ---------------------------------------------------------------
     * A toaster popping: chrome shrapnel, crumbs and coil sparks flung out
     * along a rough eight-point star. */
    boomEnemy: [
      '.....o.....bb.....o.....',
      '...b....o..LL..o....b...',
      '......C...b..b...C......',
      '..o.....L..oo..L.....o..',
      '.....b...C.OO.C...b.....',
      '.C.....o..LOOL..o.....C.',
      '....b...OO.oo.OO...b....',
      'o.....C..OoLLoO..C.....o',
      '..C....O..LooL..O....C..',
      '....b...C..OO..C...b....',
      '.o....L...bCCb...L....o.',
      '...C.....b.oo.b.....C...',
      '......b...C..C...b......',
      '..b.....o..bb..o.....b..',
      '.....o......C.....o.....',
      '........b......b........'
    ],

    // Player death, frame 0: scorched black through the middle, crust still
    // tan, embers glowing in the cracks.
    boomPlayer0: [
      '......o.....o.........',
      '......RRRRRRRRRR......',
      '....RRKKKKKKKKKKRR....',
      '...RKKKKoKKKKKKoKKR...',
      '..RKKKKKKKKKKKKKKKKR..',
      '..RKKoKKKKKKKKKKoKKR..',
      '..RKKKKKKoKKKKKKKKKR..',
      '..RKKKKKKKKKKoKKKKKR..',
      '..RKKKoKKKKKKKKKKKKR..',
      '..RKKKKKKKKKoKKKKKKR..',
      '..RKKKKKKKKKKKKoKKKR..',
      '..RKKoKKKKKKKKKKKKKR..',
      '..RKKKKKKKoKKKKKKKKR..',
      '..RKKKKKKKKKKKKKKKKR..',
      '..RKKKKKKKKKKKKKKKKR..',
      '..RRRRRRRRRRRRRRRRRR..',
      '...RRRRRRRRRRRRRRRR...'
    ],

    // Player death, frame 1: the slice has come apart into charcoal.
    boomPlayer1: [
      '...o.......o......o...',
      '......O.....O.........',
      '.....KK...KKKK...K....',
      '...KKKKK.KKKKKK.KKK...',
      '..KKKoKK..KKKKKKKoKK..',
      '.KKKKKK...KKKKK.KKKKK.',
      '.KKKoKKK..KKKoKK..KKK.',
      '..KKKKK..KKKKKKK..KK..',
      '.KKKK...KKKKoKKKK.KKK.',
      '..KKK..KKKKKK..KKKKK..',
      '.KKKKK.KKKoKK...KKKK..',
      '..KKKK..KKKKK...KKK...',
      '...KK...KKKoK....KK...',
      '..KK.....KKKK....K....',
      '...K......KK.....KK...',
      '......K.....K.........',
      '......................'
    ],

    /* ---- HUD LIFE ICONS ---------------------------------------------------
     * Rasterized 1:1 (see SCALE_OVERRIDE) so they land at 22x17 — half the
     * size of the player sprites. Chunkier features so they read that small. */
    lifeBread: [
      '......RRRRRRRRRR......',
      '....RRRRRRRRRRRRRR....',
      '...RbbbbbbbbbbbbbbR...',
      '..RbbbbbbbbbbbbbbbbR..',
      '..RbbbKKbbbbbbKKbbbR..',
      '..RbbbKKbbbbbbKKbbbR..',
      '..RbbbbbbbbbbbbbbbbR..',
      '..RbbbbbKKKKKKbbbbbR..',
      '..RbbbbbbbbbbbbbbbbR..',
      '..RbbbbbbbbbbbbbbbbR..',
      '..RbbbbbbbbbbbbbbddR..',
      '..RbbbbbbbbbbbbddddR..',
      '..RbbbbbbbbbbddddddR..',
      '..RbbbbbbbbddddddddR..',
      '..RRRRRRRRRRRRRRRRRR..',
      '...RRRRRRRRRRRRRRRR...',
      '......................'
    ],
    lifeJam: [
      '.....bbbbbbbbbbbb.....',
      '....bbbbbbbbbbbbbb....',
      '.....RRRRRRRRRRRR.....',
      '....gGGGGGGGGGGGGg....',
      '...gGGGGGGGGGGGGGGg...',
      '..gGGjjjjjjjjjjjjjjg..',
      '..gGGJJKKJJJJKKJJJJg..',
      '..gGGJJKKJJJJKKJJJJg..',
      '..gGGJJJJJJJJJJJJJJg..',
      '..gGGJJJKKKKKKJJJJJg..',
      '..gGGJJJJJJJJJJJJJJg..',
      '..gGGbbbbbbbbbbbbJJg..',
      '..gGGbJJJJJJJJJJbJJg..',
      '..gGGbbbbbbbbbbbbJJg..',
      '..gJJJJJJJJJJJJJJJJg..',
      '..gggggggggggggggggg..',
      '......................'
    ],

    /* ---- BUNKER -----------------------------------------------------------
     * A stick of butter stood on end: bright bevel along the top and left,
     * shadow down the right, a paper wrapper band printed across the middle,
     * and the classic arched underside for the player to hide in. */
    bunker: [
      '....LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL....',
      '..LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL..',
      'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLRRR',
      'LLLLLLLLLLLLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd',
      'dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd',
      'dbbbddddddddddddddddddddddddddddddddddddddddbbbd',
      'dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd',
      'dbbbbbbbbbbddddddddddddddddddddddddddbbbbbbbbbbd',
      'dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd',
      'dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbd',
      'dddddddddddddddddddddddddddddddddddddddddddddddd',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBBBB........BBBBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBBB............BBBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBBB..............BBBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBBB................BBBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBB..................BBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBBB..................BBBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBB....................BBBBBBBBBBBRRR',
      'LLBBBBBBBBBBBB....................BBBBBBBBBBBRRR',
      'RRRRRRRRRRRRRR....................RRRRRRRRRRRRRR',
      'RRRRRRRRRRRRRR....................RRRRRRRRRRRRRR'
    ],

    /* =======================================================================
     * WEAPON UPGRADE SYSTEM (SPEC-WEAPONS.md section 6)
     *
     * Crate legend:  R drawer front  d sunlit top  K grain / splinter
     *                C cutlery  L cutlery shine  D cutlery shadow
     *                W feather  w feather shadow
     * ==================================================================== */

    /* ---- THE WINGED UTENSIL DRAWER ----------------------------------------
     * A pine drawer front with a chrome bar handle, a knife, a fork and a
     * spoon rattling out of the open top, and a pair of After Dark feathers
     * either side. Frame 0 beats its wings above the drawer, frame 1 below —
     * and the cutlery jostles a pixel between beats. */
    crate0: [
      '......L...C.C..LL......',
      '......L...CCC.CLLC.....',
      '.....LC...CCC.CLLC.....',
      '.....LC...CCC..CC......',
      'WwW..CC...CCC..CC...WwW',
      'wWwWdCCdddCCCddCCddWwWw',
      '.wWwdKKKKKKKKKKKKKdwWw.',
      '..WwdddddddddddddddwW..',
      '....RRRRRRRRRRRRRRR....',
      '....RRRRDLLLLLDRRRR....',
      '....RRRRDCCCCCDRRRR....',
      '....RRRRKDDDDDKRRRR....',
      '....RRRRRRRRRRRRRRR....',
      '....RKKRRRRRRRRKKRR....',
      '....KKKKKKKKKKKKKKK....',
      '.....KKKKKKKKKKKKK.....',
      '.......................'
    ],
    crate1: [
      '..........C.C..LL......',
      '......L...CCC.CLLC.....',
      '.....LC...CCC.CLLC.....',
      '.....LC...CCC..CC......',
      '.....CC...CCC..CC......',
      '....dCCdddCCCddCCdd....',
      '....dKKKKKKKKKKKKKd....',
      '....ddddddddddddddd....',
      '..WwRRRRRRRRRRRRRRRwW..',
      '.wWwRRRRDLLLLLDRRRRwWw.',
      'wWwWRRRRDCCCCCDRRRRWwWw',
      'WwW.RRRRKDDDDDKRRRR.WwW',
      '....RRRRRRRRRRRRRRR....',
      '....RKKRRRRRRRRKKRR....',
      '....KKKKKKKKKKKKKKK....',
      '.....KKKKKKKKKKKKK.....',
      '.......................'
    ],

    /* Two hits in: the top-right corner is splintered away, the right wing is
     * kinked and drooping, the left one is a stump, and the cutlery has been
     * knocked loose and is spilling out. */
    crateHit: [
      '..........C............',
      '...L......C.C....LL....',
      '....LC....CCC...CLLC...',
      '.....C....CCC....CC....',
      'Ww...CC...CCC...CC.....',
      'wW..dCCdddCCCdd.CC.....',
      '.Ww.dKKKKKKKKKKKK......',
      '..w.ddddddddddddK......',
      '....RRRRRRRRRRRRK......',
      '....RRRRDLLLLLDRRK.Ww..',
      '....RRKRDCCCCCDRRRR.WwW',
      '....RRKRKDDDDDKRRRR..wW',
      '....RKKKRRRRRRRKRRR...w',
      '....RKKRRRRRKKRRRRR....',
      '....KKKKKKKKKKKKKKK....',
      '.....KK.KKKKK.KKK.CL...',
      '.......K...K....K.C....'
    ],

    /* ---- THE TOKEN ROUNDEL ------------------------------------------------
     * A chrome ring, lit from the top-left, around a dark well the weapon
     * icon sits in. weapons.js squashes its drawn width to spin it. */
    tokenShell: [
      '...LLLLLLLL...',
      '..LLLLLLLLLL..',
      '.LLLSSSSSSCCC.',
      'LLLSSSSSSSSCCD',
      'LLSSSSSSSSSSCD',
      'LCSSSSSSSSSSCD',
      'LCSSSSSSSSSSCD',
      'LCSSSSSSSSSSCD',
      'CCSSSSSSSSSSDD',
      'CCSSSSSSSSSSDD',
      'CCCSSSSSSSSDDD',
      '.CCCSSSSSSDDD.',
      '..CCDDDDDDDD..',
      '...DDDDDDDD...'
    ],

    /* ---- WEAPON ICONS -----------------------------------------------------
     * Fifteen 16x16 badges, authored 1:1. They appear in the HUD chip and
     * inside a falling token, both against dark, so each one is a bold bright
     * silhouette with only as much interior detail as survives at this size.
     *
     * Icon legend:  C chrome  L chrome shine  D chrome shadow  S slot dark
     *               K scorch  R crust  b crumb  d crumb shade
     *               B butter  Y butter shine  J jam  j jam shine
     *               O coil  o coil glow  g cold glass  W china white
     * -------------------------------------------------------------------- */

    // BUTTER KNIVES — a knife on the diagonal, blade up, tan handle down.
    icon_butterKnife: [
      '............LLL.',
      '...........LLLL.',
      '..........LLLLL.',
      '.........LLLLL..',
      '........LLLLL...',
      '.......LLLLL....',
      '......LLLLL.....',
      '.....LLLLC......',
      '....LLLLC.......',
      '...CCLLC........',
      '..RRCCC.........',
      '.RRRRC..........',
      'RRRRR...........',
      'dRRR............',
      'ddR.............',
      '................'
    ],

    // SPAGHETTI GUN — a bundle of pale strands, every one of them wriggling.
    icon_spaghetti: [
      '................',
      '...bbbbbbbbbb...',
      '..bb..bb..bb..b.',
      '.b..bb..bb..bb.b',
      'b..bb..bb..bb..b',
      '.bb..bb..bb..bb.',
      'b..bb..bb..bb..b',
      '.bb..bb..bb..bb.',
      'b..bb..bb..bb..b',
      '.bb..dd..bb..dd.',
      'b..dd..bb..dd..b',
      '.bb..bb..dd..bb.',
      'b..bb..dd..bb..b',
      '.b..bb..bb..bb.b',
      '..bb..bb..bb..b.',
      '...dddddddddd...'
    ],

    // TOAST CANNON — a slice of toast with a lit fuse in its shoulder.
    icon_toastCannon: [
      '..............o.',
      '.............oO.',
      '............DO..',
      '...........DD...',
      '...RRRRRR..DD...',
      '..RRRRRRRRDD....',
      '.RRRRRRRRRR.....',
      '.RddddddddR.....',
      '.RddddddddR.....',
      '.RddddddddR.....',
      '.RddddddddR.....',
      '.RddddddddR.....',
      '.RddddddddR.....',
      '.RRRRRRRRRR.....',
      '..RRRRRRRR......',
      '................'
    ],

    // CEREAL SCATTERGUN — a spill of three cereal loops.
    icon_scattergun: [
      '................',
      '...RRRR.........',
      '..RddddR........',
      '.Rdd..ddR.......',
      '.Rd....dR.......',
      '.Rd....dR..RRR..',
      '.Rdd..ddR.RdddR.',
      '..RddddR..Rd.dR.',
      '...RRRR...RdddR.',
      '...........RRR..',
      '....RRRR........',
      '...RddddR.......',
      '..Rdd..ddR......',
      '..Rdd..ddR......',
      '...RddddR.......',
      '....RRRR........'
    ],

    // ESPRESSO REPEATER — one fat roasted bean, crease down the middle.
    icon_espresso: [
      '................',
      '.....RRRRR......',
      '...RRRRRRRRR....',
      '..RRRRdKdRRRR...',
      '.RRRRRdKdRRRRR..',
      '.RRRRRdKdRRRRR..',
      'RRRRRRdKdRRRRRR.',
      'RRRRRdKKKdRRRRR.',
      'RRRRRRdKdRRRRRR.',
      '.RRRRRdKdRRRRR..',
      '.RRRRRdKdRRRRR..',
      '..RRRRdKdRRRR...',
      '...RRRRRRRRR....',
      '.....RRRRR......',
      '................',
      '................'
    ],

    // HOMING CRUMPETS — a pale disc riddled with holes, browned underside.
    icon_crumpet: [
      '................',
      '...bbbbbbbbbb...',
      '..bbbbbbbbbbbb..',
      '.bbdbbbdbbdbbbb.',
      '.bbbbbbbbbbbbbb.',
      'bbdbbdbbbdbbdbbb',
      'bbbbbbbbbbbbbbbb',
      'bbdbbbdbbdbbbdbb',
      'bbbbbbbbbbbbbbbb',
      '.bbdbbdbbbdbbbb.',
      '.bbbbbbbbbbbbbb.',
      '..bbdbbbdbbdbb..',
      '..RRRRRRRRRRRR..',
      '...RRRRRRRRRR...',
      '................',
      '................'
    ],

    // MEGA JAM MORTAR — a fat glob of jam with a drip coming off it.
    icon_megaJam: [
      '................',
      '......jjj.......',
      '....jjJJJJ......',
      '...jJJJJJJJ.....',
      '..jJJJJJJJJJ....',
      '.jJJJJJJJJJJJ...',
      '.jJJJJJJJJJJJJ..',
      'JJJJJJJJJJJJJJ..',
      'JJJJJJJJJJJJJJJ.',
      'JJJJJJJJJJJJJJJ.',
      '.JJJJJJJJJJJJJJ.',
      '..JJJJJJJJJJJJ..',
      '...JJJJJJJJJJ...',
      '.....JJJJJJ.....',
      '.......JJ.......',
      '........J.......'
    ],

    // PANCAKE FRISBEE — a stack of four with a pat of butter sliding off.
    icon_pancake: [
      '................',
      '......BB........',
      '.....BBBB.......',
      '....RRRRRRRR....',
      '...RddddddddR...',
      '...RRRRRRRRRR...',
      '..RRRRRRRRRRRR..',
      '..RddddddddddR..',
      '..RRRRRRRRRRRR..',
      '.RRRRRRRRRRRRRR.',
      '.RddddddddddddR.',
      '.RRRRRRRRRRRRRR.',
      'RRRRRRRRRRRRRRRR',
      'RddddddddddddddR',
      'RRRRRRRRRRRRRRRR',
      '................'
    ],

    // BLENDER BLADE — twin blades crossed over a hub.
    icon_blender: [
      '................',
      '.LL..........LL.',
      '..LLL......LLL..',
      '...LLLL..LLLL...',
      '....LLLLLLLL....',
      '.....CCCCCC.....',
      '......CCCC......',
      '.....DCCCCD.....',
      '.....DCCCCD.....',
      '......CCCC......',
      '.....CCCCCC.....',
      '....LLLLLLLL....',
      '...LLLL..LLLL...',
      '..LLL......LLL..',
      '.LL..........LL.',
      '................'
    ],

    // KETCHUP & MUSTARD — two squeeze bottles, red and yellow, nozzles up.
    icon_condiments: [
      '................',
      '..JJ.......BB...',
      '..JJ.......BB...',
      '.JJJJ.....BBBB..',
      '.JJJJ.....BBBB..',
      'JJJJJJ...BBBBBB.',
      'JJJJJJ...BBBBBB.',
      'JbbbbJ...BYYYYB.',
      'JbbbbJ...BYYYYB.',
      'JJJJJJ...BBBBBB.',
      'JJJJJJ...BBBBBB.',
      'JJJJJJ...BBBBBB.',
      'JJJJJJ...BBBBBB.',
      '.JJJJ.....BBBB..',
      '................',
      '................'
    ],

    // BAGUETTE LANCE — a long loaf on the diagonal, crust slashed.
    icon_baguette: [
      '..........RRRR..',
      '.........RRRRRR.',
      '.........RRddRR.',
      '........RRddRR..',
      '.......RRRRRR...',
      '......RRddRR....',
      '.....RRddRR.....',
      '....RRRRRR......',
      '...RRddRR.......',
      '..RRddRR........',
      '..RRRRRR........',
      '.RRddRR.........',
      'RRddRR..........',
      'RRRRR...........',
      'RRRR............',
      'RR..............'
    ],

    // MICROWAVE RAY — the oven itself: meshed door, glowing plate, keypad.
    icon_microwave: [
      '................',
      '.CCCCCCCCCCCCCC.',
      '.CSSSSSSSSSCLLC.',
      '.CSDSDSDSDSCooC.',
      '.CSSSSSSSSSCLLC.',
      '.CSDSDSDSDSCCCC.',
      '.CSSSoooSSSCCCC.',
      '.CSSoOOOoSSCLLC.',
      '.CSSSoooSSSCCCC.',
      '.CSDSDSDSDSCCCC.',
      '.CSSSSSSSSSCLLC.',
      '.CSSSSSSSSSCCCC.',
      '.CCCCCCCCCCCCCC.',
      '.DDDDDDDDDDDDDD.',
      '..D..........D..',
      '................'
    ],

    // SYRUP TRAP — a capped bottle of amber syrup: narrow neck, broad
    // shoulders, paper label.
    icon_syrup: [
      '................',
      '......CCC.......',
      '......CCC.......',
      '......RRR.......',
      '.....RRRRR......',
      '....RRRRRRR.....',
      '...RRRRRRRRR....',
      '..RRddddddRRR...',
      '..RdddddddddR...',
      '..RdbbbbbbbdR...',
      '..RdbbbbbbbdR...',
      '..RdddddddddR...',
      '..RdddddddddR...',
      '..RRRRRRRRRRR...',
      '...RRRRRRRRR....',
      '................'
    ],

    // SOGGY BREAD — a slice that has given up, folding over and dripping.
    icon_soggy: [
      '................',
      '..bbbbbb........',
      '.bggggggb.......',
      'bgggggggggb.....',
      'bgggggggggggb...',
      'bggggggggggggb..',
      '.bgggggggggggb..',
      '..bggggggggggb..',
      '...bgggggggggb..',
      '....bggggggggb..',
      '.....bgggggggb..',
      '......bbggggb...',
      '........bbbbb...',
      '..........g.....',
      '.........g...g..',
      '................'
    ],

    // THE FULL BREAKFAST — a plate: fried egg, two sausages, a slop of beans.
    icon_fullEnglish: [
      '................',
      '................',
      '...DDDDDDDDDD...',
      '..DWbbbbWRRRWD..',
      '.DWbbBbbWRRRWWD.',
      'DWbbBBbbWRRRWWWD',
      'DWbbbbbbWRRRWWWD',
      'DWWbbbbWWRRRWWWD',
      'DWWWJJJJWWJJJWWD',
      '.DWWJJJJJJJJWWD.',
      '..DWWWWWWWWWWD..',
      '...DDDDDDDDDD...',
      '....DDDDDDDD....',
      '................',
      '................',
      '................'
    ],

    /* ---- UPGRADE PROJECTILES ----------------------------------------------
     * Small, fast and seen against a night sky, so every one of these is a
     * chunky high-contrast shape rather than a detailed miniature. */

    // Butter knife, two frames of a flat spin: on edge, then face-on.
    wKnife0: [
      '.....LL',
      '....LL.',
      '...LL..',
      '..CC...',
      '.RC....',
      'RR.....',
      'R......'
    ],
    wKnife1: [
      '...L...',
      '..LL...',
      '..LL...',
      '..CC...',
      '..RR...',
      '..RR...',
      '...R...'
    ],

    // A limp strand of spaghetti, already snaking before it is fired.
    wNoodle: [
      '.bd.',
      '.bd.',
      'bd..',
      'bd..',
      '.bd.',
      '.bd.',
      '..bd',
      '..bd',
      '.bd.',
      '.bd.',
      'bd..'
    ],

    // The toast cannon's shell: a whole slice, butter still on it.
    wToast: [
      '..RRRRR..',
      '.RRRRRRR.',
      'RRdddddRR',
      'RdddddddR',
      'RdddBdddR',
      'RdddddddR',
      'RRRRRRRRR',
      '.RRRRRRR.'
    ],

    // One fragment of the airburst — chipped, so it does not read as a plus.
    wCrumb: [
      'bb.',
      'bdb',
      '.bb'
    ],

    // A cereal loop, lit along its top edge.
    wLoop: [
      '.ddd.',
      'dR.Rd',
      'R...R',
      'RR.RR',
      '.RRR.'
    ],

    // A scalding coffee bean: solid, with the crease down the middle.
    wBean: [
      'RRR',
      'RdR',
      'RdR',
      'RRR'
    ],

    // A homing crumpet, holes facing front.
    wCrumpet: [
      '..bbbb..',
      '.bbbbbb.',
      'bdbbdbbb',
      'bbbdbbdb',
      'bdbbdbbb',
      '.bbbbbb.',
      '..bbbb..'
    ],

    // A pancake, flat on and then edge on as it spins.
    wPancake0: [
      '..RRRRRR..',
      '.RddddddR.',
      'RdddBBdddR',
      '.RddddddR.',
      '..RRRRRR..'
    ],
    wPancake1: [
      '..........',
      '.RRRRRRRR.',
      'RddddddddR',
      '.RRRRRRRR.',
      '..........'
    ],

    // The blender blade, crossed then straight.
    wBlade0: [
      'L........L',
      'LL......LL',
      '.LL....LL.',
      '..LL..LL..',
      '...CCCC...',
      '...CCCC...',
      '..LL..LL..',
      '.LL....LL.',
      'LL......LL',
      'L........L'
    ],
    wBlade1: [
      '....LL....',
      '....LL....',
      '....LL....',
      '....LL....',
      'LLLLCCLLLL',
      'LLLLCCLLLL',
      '....LL....',
      '....LL....',
      '....LL....',
      '....LL....'
    ],

    // The mortar round: a fat glob with a bright leading edge.
    wJamGlob: [
      '...jjj...',
      '..jJJJj..',
      '.jJJJJJj.',
      'jJJJJJJJj',
      'jJJJJJJJJ',
      'jJJJJJJJJ',
      '.JJJJJJJ.',
      '..JJJJJ..',
      '...JJJ...'
    ],

    // A blob of syrup with a thread of it still trailing behind.
    wSyrup: [
      '..RRR..',
      '.RRRRR.',
      'RRdRRRR',
      'RRdRRRR',
      'RRRRRRR',
      '.RRRRR.',
      '..RRR..',
      '...R...',
      '...R...'
    ],

    // Twin condiment squirts: red one way, yellow the other.
    wKetchup: [
      '.jj.',
      'jJJj',
      'jJJj',
      'JJJJ',
      '.JJ.',
      '.J..'
    ],
    wMustard: [
      '.LL.',
      'LBBL',
      'LBBL',
      'BBBB',
      '.BB.',
      '..B.'
    ],

    // Soggy bread: pale crust round a cold blue-grey middle, already sagging.
    wSoggy: [
      '.bbbb...',
      'bggggb..',
      'bgggggb.',
      '.bggggbb',
      '..bbggg.',
      '....bb..'
    ],

    /* One tileable segment of the baguette lance and its pointed tip.
     * weapons.js stacks the tip then repeats the segment down to the ship, so
     * the segment's first and last rows must meet cleanly and the tip's last
     * row must match the segment's first. */
    wBaguette: [
      'RRdddddRR',
      'RRdddddRR',
      'RRdKKKdRR',
      'RRdddddRR',
      'RRdddddRR',
      'RRdddddRR',
      'RRdddddRR',
      'RRdKKKdRR',
      'RRdddddRR',
      'RRdddddRR',
      'RRdddddRR',
      'RRdddddRR'
    ],
    wBaguetteTip: [
      '....R....',
      '...RRR...',
      '..RRRRR..',
      '.RRdddRR.',
      'RRdddddRR',
      'RRdddddRR',
      'RRdddddRR'
    ],

    /* =======================================================================
     * THE OTHER SEVEN PLAYABLE CHARACTERS (SPEC-CHARACTERS.md section 4)
     *
     * bread0 and jam0 set the house style and every one of these follows it:
     *
     *   - a 22x17 map, rasterized at SCALE 2 to the 44x34 ship box;
     *   - a hard outline colour running the whole way round the silhouette,
     *     never a soft edge — crust on the croissant, rim grey on the mug and
     *     the carton, glass on the honey jar, rind on the cheese, crisped fat
     *     on the bacon;
     *   - the face in K: two 2x1 BROWS, then 2-wide EYES sitting one pixel
     *     INBOARD of the brows for three rows, then a straight set MOUTH — the
     *     same construction, in the same order, at the same scale as the bread;
     *   - frame 1 is the firing recoil and always does three things: raises
     *     and thickens the brows, opens the mouth to a wide rectangle, and
     *     jolts whatever the character is holding (steam, honey drip, spilled
     *     grind, milk splash). The silhouette itself never changes width, so
     *     the recoil reads as a flinch and not as a different sprite.
     * ==================================================================== */

    /* ---- CROISSANT --------------------------------------------------------
     * A crescent seen head on: two horns curling up at the corners, a glazed
     * band along the top, four flaky seams cut down through the layers, and
     * the body tapering into a crust base. */
    croissant0: [
      '..RR..............RR..',
      '.RbbR............RbbR.',
      '.RbBR............RBbR.',
      '.RbdRR..........RRdbR.',
      '..RddRRRRRRRRRRRRddR..',
      '..RbBBBBBBBBBBBBBBbR..',
      '.RbBbRbBbRbbRbBbRbBbR.',
      '.RbbbRbbbRbbRbbbRbbbR.',
      '.RbbbKKbbbbbbbbKKbbbR.',
      '.RbbbbKKbbbbbbKKbbbbR.',
      '.RbbbbKKbbbbbbKKbbbbR.',
      '.RbbbbKKbbbbbbKKbbbbR.',
      '.RbbbbbbbbbbbbbbbbbbR.',
      '.RbbbbbbKKKKKKbbbbbbR.',
      '.RbbbbbbbbbbbbbbddddR.',
      '..RbbbbbbbbddddddddR..',
      '...RRRRRRRRRRRRRRRR...'
    ],
    croissant1: [
      '......................',
      '..RR..............RR..',
      '.RbbR............RbbR.',
      '.RbBR............RBbR.',
      '..RddRRRRRRRRRRRRddR..',
      '..RbBBBBBBBBBBBBBBbR..',
      '.RbBbRbBbRbbRbBbRbBbR.',
      '.RbbbKKbbbbbbbbKKbbbR.',
      '.RbbbbKKbbbbbbKKbbbbR.',
      '.RbbbbKKbbbbbbKKbbbbR.',
      '.RbbbbbKKKKKKKKbbbbbR.',
      '.RbbbbbKKKKKKKKbbbbbR.',
      '.RbbbbbbKKKKKKbbbbbbR.',
      '.RbbbbbbbbbbbbbbbbbbR.',
      '.RbbbbbbbbbbbbbbddddR.',
      '..RbbbbbbbbddddddddR..',
      '...RRRRRRRRRRRRRRRR...'
    ],

    /* ---- COFFEE MUG -------------------------------------------------------
     * A thick diner mug in three-quarter view: steam off the top, a chip
     * knocked out of the rim on the right, black coffee with a crema slick on
     * it, a C handle bolted to the right wall and a cobalt band round the
     * belly. The face sits on the china above the band. */
    mug0: [
      '......G.....G.........',
      '.....G.....GG.........',
      '......GG....G.........',
      '..DDDDDDDDDDD..DD.....',
      '..DKKKKRRRKKKKKKD.....',
      '..DWWWWWWWWWWWWWD.....',
      '..DWWWWWWWWWWWWWDDDDD.',
      '..DWWKKWWWWWKKWWD..DD.',
      '..DWWWKKWWWKKWWWD..DD.',
      '..DWWWKKWWWKKWWWD..DD.',
      '..DWWWKKWWWKKWWWD..DD.',
      '..DWWWWWWWWWWWWWDDDDD.',
      '..DWWWWKKKKKWWWWD.....',
      '..DgggggggggggggD.....',
      '..DWWWWWWWWWWWWWD.....',
      '..DWWWWWWWwwwwwwD.....',
      '..DDDDDDDDDDDDDDD.....'
    ],
    mug1: [
      '.....GG....GG.........',
      '....GG......G.........',
      '.....G.G...GG.........',
      '..DDDDDDDDDDD..DD.....',
      '..DKKRRRRRKKKKKKD.....',
      '..DWWWWWWWWWWWWWD.....',
      '..DWWWWWWWWWWWWWDDDDD.',
      '..DWWKKKWWWKKKWWD..DD.',
      '..DWWWKKWWWKKWWWD..DD.',
      '..DWWWKKWWWKKWWWD..DD.',
      '..DWWWWKKKKKKWWWD..DD.',
      '..DWWWKKKKKKKKWWDDDDD.',
      '..DWWWWKKKKKKWWWD.....',
      '..DgggggggggggggD.....',
      '..DWWWWWWWWWWWWWD.....',
      '..DWWWWWWWwwwwwwD.....',
      '..DDDDDDDDDDDDDDD.....'
    ],

    /* ---- PEPPER GRINDER ---------------------------------------------------
     * Tall and narrow: a chrome dome cap on a pinched neck, a turned wooden
     * barrel that flares as it drops, the dark grind slot just above a chrome
     * foot ring. Frame 1 twists the cap off-centre and spills grind. */
    pepper0: [
      '.........LLLL.........',
      '.......LLCCCCLL.......',
      '......LCCCCCCCCD......',
      '......LCCCCCCCCD......',
      '........DCCCCD........',
      '......RddddddddR......',
      '.....RddddddddddR.....',
      '....RddddddddddddR....',
      '....RdKKddddddKKdR....',
      '....RddKKddddKKddR....',
      '....RddKKddddKKddR....',
      '....RddKKddddKKddR....',
      '....RddddKKKKddddR....',
      '....RdKddddddddKdR....',
      '....RddddddddddddR....',
      '....RSSSSSSSSSSSSR....',
      '...DCCCCCCCCCCCCCCD...'
    ],
    pepper1: [
      '........LLLL..........',
      '......LLCCCCLL........',
      '.....LCCCCCCCCD.......',
      '.....LCCCCCCCCD.......',
      '........DCCCCD........',
      '......RddddddddR......',
      '.....RddddddddddR.....',
      '....RdKKddddddKKdR....',
      '....RddKKddddKKddR....',
      '....RddKKddddKKddR....',
      '....RdddKKKKKKdddR....',
      '....RdddKKKKKKdddR....',
      '....RddddKKKKddddR....',
      '....RdKddddddddKdR....',
      '....RddddddddddddR....',
      '..S.RSSSSSSSSSSSSR.S..',
      '...DCCCCCCCCCCCCCCD...'
    ],

    /* ---- HONEY DIPPER -----------------------------------------------------
     * The grooved wooden dipper stood in a squat glass jar, honey filled to a
     * bright meniscus with a row of comb highlights near the bottom, and a
     * bead of honey running off the dipper into the jar. The face is in the
     * honey itself, behind the glass. */
    honey0: [
      '......RR..............',
      '......RR..............',
      '.....RRRR.............',
      '....RBRBRR............',
      '....RBRBRR............',
      '.....RRRR....B........',
      '..GGGGGGGGGGGGGGGGGG..',
      '...gGGGGGGGGGGGGGGg...',
      '...gGLLLLLLLLLLLLGg...',
      '...gGBBKKBBBBKKBBGg...',
      '...gGBBBKKBBKKBBBGg...',
      '...gGBBBKKBBKKBBBGg...',
      '...gGBBBBKKKKBBBBGg...',
      '...gGBBBBBBBBBBBBGg...',
      '...gGBLBBLBBLBBLBGg...',
      '...gGBBBBBBBBBBBBGg...',
      '..gGGGGGGGGGGGGGGGGg..'
    ],
    honey1: [
      '.......RR.............',
      '.......RR.............',
      '......RRRR............',
      '.....RBRBRR...........',
      '.....RBRBRR...........',
      '......RRRR..B.........',
      '..GGGGGGGGGGGGGGGGGG..',
      '...gGGGGGGGGGGGGGGg...',
      '...gGLLLLLLLLLLLLGg...',
      '...gGBKKKBBBBKKKBGg...',
      '...gGBBBKKBBKKBBBGg...',
      '...gGBBBKKBBKKBBBGg...',
      '...gGBBKKKKKKKKBBGg...',
      '...gGBBKKKKKKKKBBGg...',
      '...gGBLBBLBBLBBLBGg...',
      '...gGBBBBBBBBBBBBGg...',
      '..gGGGGGGGGGGGGGGGGg..'
    ],

    /* ---- CHEESE WEDGE -----------------------------------------------------
     * A wedge stood on its base, point up and to the right: the cut face
     * catches the light down its whole sloping edge, holes are punched through
     * the paste, and the hard rind runs down the back and along the bottom.
     * The lopsided silhouette is the point — it is the only character in the
     * roster that is not symmetrical, which is how you find it in the HUD. */
    cheese0: [
      '.................RRR..',
      '...............LBBRR..',
      '.............LBBBBRR..',
      '...........LBBdBBBRR..',
      '.........LBBBBBBBBRR..',
      '.......LBBBddBBBBBRR..',
      '.....LBBBBBBBBBBBBRR..',
      '...LBBBBBBBBBBBBBBRR..',
      '..LBBKKBBBBBKKBBBBRR..',
      '..LBBBKKBBBKKBBBBBRR..',
      '..LBBBKKBBBKKBBBBBRR..',
      '..LBBBKKBBBKKBBBBBRR..',
      '..LBBBBKKKKKKBBBBBRR..',
      '..LBddBBBBBBddBBBBRR..',
      '..LBBBBBBBBBBBBBBBRR..',
      '..LBBBBBBBBBddddddRR..',
      '..RRRRRRRRRRRRRRRRRR..'
    ],
    cheese1: [
      '.................RRR..',
      '...............LBBRR..',
      '.............LBBBBRR..',
      '...........LBBdBBBRR..',
      '.........LBBBBBBBBRR..',
      '.......LBBBddBBBBBRR..',
      '.....LBBBBBBBBBBBBRR..',
      '...LBKKKBBBKKKBBBBRR..',
      '..LBBBKKBBBKKBBBBBRR..',
      '..LBBBKKBBBKKBBBBBRR..',
      '..LBBBKKKKKKKKBBBBRR..',
      '..LBBBKKKKKKKKBBBBRR..',
      '..LBBBBKKKKKKBBBBBRR..',
      '..LBddBBBBBBddBBBBRR..',
      '..LBBBBBBBBBBBBBBBRR..',
      '..LBBBBBBBBBddddddRR..',
      '..RRRRRRRRRRRRRRRRRR..'
    ],

    /* ---- BACON STRIP ------------------------------------------------------
     * A rasher stood on end, so the streaky bands run DOWN it as columns of
     * meat and fat, and the whole strip waves left and right two pixels as it
     * goes. The wave is why the face rows have to be written per row: the eyes
     * and mouth are pinned to fixed columns and the stripe pattern shifts
     * around them, otherwise the face would slither about with the wave. */
    bacon0: [
      '....KbbJJjJbbJJjbK....',
      '...KbbJJjJbbJJjbK.....',
      '...KbbJJjJbbJJjbK.....',
      '....KbbJJjJbbJJjbK....',
      '.....KbbJJjJbbJJjbK...',
      '.....KbbJJjJbbJJjbK...',
      '....KbKKJjJbbJKKbK....',
      '...KbbJKKJbbJKKbK.....',
      '...KbbJKKJbbJKKbK.....',
      '....KbbKKjJbbKKjbK....',
      '.....KbbJJjJbbJJjbK...',
      '.....KbbJKKKKKKJjbK...',
      '....KbbJJKKKKKKjbK....',
      '...KbbJJjJbbJJjbK.....',
      '...KbbJJjJbbJJjbK.....',
      '....KbbJJjJbbJJjbK....',
      '.....KbbJJjJbbJJjbK...'
    ],
    bacon1: [
      '.....KbbJJjJbbJJjbK...',
      '.....KbbJJjJbbJJjbK...',
      '....KbbJJjJbbJJjbK....',
      '...KbbJJjJbbJJjbK.....',
      '...KbbJJjJbbJJjbK.....',
      '....KbKKJjJbbJKKbK....',
      '.....KbKKJjJbKKJjbK...',
      '.....KbKKJjJbKKJjbK...',
      '....KbbKKjJbbKKjbK....',
      '...KbbJJKKKKKKKbK.....',
      '...KbbJJKKKKKKKbK.....',
      '....KbbJKKKKKKKjbK....',
      '.....KbbJJjJbbJJjbK...',
      '.....KbbJJjJbbJJjbK...',
      '....KbbJJjJbbJJjbK....',
      '...KbbJJjJbbJJjbK.....',
      '...KbbJJjJbbJJjbK.....'
    ],

    /* ---- MILK CARTON ------------------------------------------------------
     * A gable-top carton: the folded ridge across the crown, the roof opening
     * out to the shoulders with the spout panel creased into its right slope,
     * and a cobalt dairy band printed round the bottom third. Frame 1 throws a
     * splash of milk out past the spout. */
    milk0: [
      '........DWWWWD........',
      '.......DWWWWWWD.......',
      '......DWWWWWWWWD......',
      '.....DWWWWWWWwwwD.....',
      '....DWWWWWWWWWwwwD....',
      '...DWWWWWWWWWWWwwwD...',
      '..DWWWWWWWWWWWWWWWWD..',
      '..DWWWKKWWWWWWKKWWWD..',
      '..DWWWWKKWWWWKKWWWWD..',
      '..DWWWWKKWWWWKKWWWWD..',
      '..DWWWWKKWWWWKKWWWWD..',
      '..DWWWWWKKKKKKWWWWWD..',
      '..DggggggggggggggggD..',
      '..DgGGgGGgGGgGGggggD..',
      '..DggggggggggggggggD..',
      '..DWWWWWWWWwwwwwwwwD..',
      '..DDDDDDDDDDDDDDDDDD..'
    ],
    milk1: [
      '........DWWWWD........',
      '.......DWWWWWWD....W..',
      '......DWWWWWWWWD..WWW.',
      '.....DWWWWWWWwwwD..WW.',
      '....DWWWWWWWWWwwwD..W.',
      '...DWWWWWWWWWWWwwwD...',
      '..DWWWWWWWWWWWWWWWWD..',
      '..DWWWKKKWWWWKKKWWWD..',
      '..DWWWWKKWWWWKKWWWWD..',
      '..DWWWWKKWWWWKKWWWWD..',
      '..DWWWWKKKKKKKKWWWWD..',
      '..DWWWWKKKKKKKKWWWWD..',
      '..DggggggggggggggggD..',
      '..DgGGgGGgGGgGGggggD..',
      '..DggggggggggggggggD..',
      '..DWWWWWWWWwwwwwwwwD..',
      '..DDDDDDDDDDDDDDDDDD..'
    ],

    /* ---- BURRITO, THE SECRET TENTH (SPEC-BURRITO.md section 4) ------------
     * A foil-wrapped burrito standing on end, in four bands:
     *
     *   rows 0-4   the open end of the wrap, cut on a SLANT so the right side
     *              stands higher than the left — a two-pixel tortilla ring
     *              (R outline, b body) around a mass of filling, J with j
     *              flecks through it. The slant is what stops the top reading
     *              as the rim of a cup;
     *   rows 5-6   the torn edge of the foil, climbing from the left, with
     *              bare tortilla still showing down the right;
     *   rows 7-15  the foil sheath. It is lit as a CYLINDER, not a box: one
     *              bright L column at 5 against the D outline at 4, a
     *              two-column D shadow at 16-17 on the far side, and two
     *              creases running unbroken down columns 8 and 13 from row 13
     *              to the base. Foil catches light in hard lines, so every one
     *              of those is a straight run rather than a soft gradient;
     *   row 16     the crimped end the foil is twisted shut at.
     *
     * The face sits on exactly the pepper grinder's face grid — brows at
     * columns 6-7 and 14-15, eyes one pixel inboard, mouth at 9-12 — because
     * the grinder is the near miss on body width and copying its face outright
     * puts ALL of the difference into the shape around it, where a player can
     * actually see it, instead of into a second competing face style.
     *
     * Frame 1 is the recoil, and does the three things every other character's
     * does: raises and thickens the brows, opens the mouth to a wide
     * rectangle, and jolts what he is holding — the filling sloshes and a
     * fleck of it flies out past the wrap, the way the carton throws milk. */
    burrito0: [
      '........RbbbbbbbR.....',
      '.....RbjJJjJJJjJbR....',
      '....RbbJJjJJJJJbbR....',
      '....RbbJJJjJJjJbbR....',
      '....RbdJJJjjJJJdbR....',
      '....DLCCCDdbbbbdbR....',
      '....DLCCCCCCCDdbbR....',
      '....DLCCCCCCCCCCDD....',
      '....DLKKCCCCCCKKDD....',
      '....DLCKKCCCCKKCDD....',
      '....DLCKKCCCCKKCDD....',
      '....DLCKKCCCCKKCDD....',
      '....DLCCCKKKKCCCDD....',
      '....DLCCDCCCCDCCDD....',
      '....DLCCDCCCCDCCDD....',
      '....DLCCDCCCCDCCDD....',
      '.....DDCDCCCCDCDD.....'
    ],
    burrito1: [
      '........RbbbbbbbR..j..',
      '.....RbjjJJjJJJjbR.j..',
      '....RbbJjJJjJJJjbR....',
      '....RbbJJjJJjJJJbR....',
      '....RbdJJJjjJJJdbR....',
      '....DLCCCDdbbbbdbR....',
      '....DLCCCCCCCDdbbR....',
      '....DLKKKCCCCKKKDD....',
      '....DLCKKCCCCKKCDD....',
      '....DLCKKCCCCKKCDD....',
      '....DLCCKKKKKKCCDD....',
      '....DLCCKKKKKKCCDD....',
      '....DLCCCKKKKCCCDD....',
      '....DLCCDCCCCDCCDD....',
      '....DLCCDCCCCDCCDD....',
      '....DLCCDCCCCDCCDD....',
      '.....DDCDCCCCDCDD.....'
    ],

    /* ---- BASE PROJECTILES -------------------------------------------------
     * One per character, all of them travelling UP the screen, so the leading
     * edge of every shape is its TOP row. Four of them are an odd number of
     * logical pixels wide and are therefore authored 1:1 (see SCALE_OVERRIDE)
     * — which is also why those four carry single-pixel detail the SCALE 2
     * shots cannot. */

    // FLAKE — a shard off the croissant: glazed edge in front, crumbs behind.
    flake: [
      '.RR.',
      'RbBR',
      'RbBR',
      'RddR',
      '.RR.',
      '.dd.',
      '..R.'
    ],

    // DRIP — a scalding bead of coffee, crema on the nose, steam off the top.
    drip: [
      '...G...',
      '..G.G..',
      '...G...',
      '...R...',
      '..RRR..',
      '..RKR..',
      '.RKKKR.',
      '.RKKKR.',
      'RKKKKKR',
      'RKKKKKR',
      'RKKKKKR',
      '.RKKKR.',
      '.RKKKR.',
      '..RRR..'
    ],

    /* PEPPER PELLET — one black peppercorn, trailing a little of the grind it
     * was cracked out of.
     *
     * The corn's core is PAL.slot, and slot is within about one percent of the
     * luminance of PAL.sky: a pellet painted in it end to end is invisible over
     * the night-sky gradient it flies up. So the silhouette is ringed in
     * chromeDk and given one chrome catch-light, exactly the way the drip rings
     * its burnt-brown core in crust — the core stays black, which is what makes
     * it read as pepper, and the rim is what makes it read at all. Every base
     * projectile in the roster carries its own bright edge for this reason. */
    pepperPellet: [
      '.DDD.',
      'DCSSD',
      'DSSSD',
      'DSSSD',
      'DSSSD',
      '.DDD.',
      '..D..',
      '.....',
      '..D..',
      '..D..'
    ],

    // HONEY DROP — a fat viscous bead that never quite lets go of its tail.
    honeyDrop: [
      '...L...',
      '..LLL..',
      '.LBBBL.',
      'LBBBBBL',
      'LBBBBBL',
      'LBBBBBL',
      'LBBBBBR',
      '.BBBBR.',
      '.RBBR..',
      '..RBR..',
      '..RBR..',
      '...B...',
      '...B...',
      '...R...',
      '...R...',
      '...R...'
    ],

    // RIND — a chip off the wedge, spinning: lit paste up front, rind behind.
    rind: [
      '....L....',
      '...LBL...',
      '..LBBBL..',
      '..LBBBL..',
      '.LBBdBBL.',
      '.LBBBBBL.',
      'LBBBBBBBL',
      'LBBdBBdBL',
      'LBBBBBBBL',
      'RBBBBBBBR',
      '.RBBBBBR.',
      '.RRBBBRR.',
      '..RRRRR..',
      '...RRR...'
    ],

    // SIZZLE — a rasher thrown off the pan, still curling as it climbs.
    sizzle: [
      '.jb',
      '.Jb',
      'bJ.',
      'bJ.',
      '.Jb',
      '.Jb',
      'bJ.',
      'bK.',
      '.K.'
    ],

    // SIZZLE TRAIL — one ember dropped in the rasher's wake, cooling to ash.
    sizzleTrail: [
      '.oO.',
      'oOOo',
      'oOKo',
      '.oO.'
    ],

    /* SPLASH 0/1/2 — the milk shot at launch, mid flight and full range. The
     * same droplet three times over, so it reads as ONE thing widening rather
     * than three different sprites; weapons.js picks the frame from how far it
     * has grown. */
    splash0: [
      'WW',
      'WW',
      'Ww',
      'Ww',
      '.w',
      '.w'
    ],
    splash1: [
      '.WWW.',
      'WWWWW',
      'WWWWW',
      'wWWWw',
      '.wWw.',
      '..w..'
    ],
    splash2: [
      '.WWWWWW.',
      'WWWWWWWW',
      'WWWWWWWW',
      'wWWWWWWw',
      '.wWWWWw.',
      '..wWWw..'
    ],

    /* ---- HUD LIFE ICONS, THE OTHER SEVEN -----------------------------------
     * Rasterized 1:1 to 22x17 like lifeBread and lifeJam: the same character,
     * half the size, with the seams, steam, grain and comb detail thinned out
     * and the eyes cut from three rows to two so the face still lands. */
    lifeCroissant: [
      '..RR..............RR..',
      '.RbBR............RBbR.',
      '.RbdRR..........RRdbR.',
      '..RddRRRRRRRRRRRRddR..',
      '..RbBBBBBBBBBBBBBBbR..',
      '.RbBbRbBbRbbRbBbRbBbR.',
      '.RbbbbKKbbbbbbKKbbbbR.',
      '.RbbbbKKbbbbbbKKbbbbR.',
      '.RbbbbbbbbbbbbbbbbbbR.',
      '.RbbbbbbKKKKKKbbbbbbR.',
      '.RbbbbbbbbbbbbbbbbbbR.',
      '.RbbbbbbbbbbbbbbbbbbR.',
      '.RbbbbbbbbbbbbbbddddR.',
      '..RbbbbbbbbddddddddR..',
      '...RRRRRRRRRRRRRRRR...',
      '......................',
      '......................'
    ],
    lifeMug: [
      '.....G......G.........',
      '......GG...G..........',
      '..DDDDDDDDDDD..DD.....',
      '..DKKKKRRRKKKKKKD.....',
      '..DWWWWWWWWWWWWWD.....',
      '..DWWWWWWWWWWWWWDDDDD.',
      '..DWWWKKWWWKKWWWD..DD.',
      '..DWWWKKWWWKKWWWD..DD.',
      '..DWWWWWWWWWWWWWD..DD.',
      '..DWWWWKKKKKWWWWDDDDD.',
      '..DWWWWWWWWWWWWWD.....',
      '..DgggggggggggggD.....',
      '..DWWWWWWWWWWWWWD.....',
      '..DWWWWWWWwwwwwwD.....',
      '..DDDDDDDDDDDDDDD.....',
      '......................',
      '......................'
    ],
    lifePepper: [
      '.........LLLL.........',
      '.......LLCCCCLL.......',
      '......LCCCCCCCCD......',
      '........DCCCCD........',
      '......RddddddddR......',
      '.....RddddddddddR.....',
      '....RddddddddddddR....',
      '....RddKKddddKKddR....',
      '....RddKKddddKKddR....',
      '....RddddddddddddR....',
      '....RddddKKKKddddR....',
      '....RddddddddddddR....',
      '....RdKddddddddKdR....',
      '....RSSSSSSSSSSSSR....',
      '...DCCCCCCCCCCCCCCD...',
      '......................',
      '......................'
    ],
    lifeHoney: [
      '......RR..............',
      '.....RRRR.............',
      '....RBRBRR............',
      '.....RRRR....B........',
      '..GGGGGGGGGGGGGGGGGG..',
      '...gGGGGGGGGGGGGGGg...',
      '...gGLLLLLLLLLLLLGg...',
      '...gGBBBKKBBKKBBBGg...',
      '...gGBBBKKBBKKBBBGg...',
      '...gGBBBBBBBBBBBBGg...',
      '...gGBBBBKKKKBBBBGg...',
      '...gGBBBBBBBBBBBBGg...',
      '...gGBLBBLBBLBBLBGg...',
      '...gGBBBBBBBBBBBBGg...',
      '..gGGGGGGGGGGGGGGGGg..',
      '......................',
      '......................'
    ],
    lifeCheese: [
      '.................RRR..',
      '..............LBBBRR..',
      '...........LBBBBBBRR..',
      '........LBBBdBBBBBRR..',
      '.....LBBBBBBBBBBBBRR..',
      '...LBBBBBBBBBBBBBBRR..',
      '..LBBBKKBBBKKBBBBBRR..',
      '..LBBBKKBBBKKBBBBBRR..',
      '..LBBBBBBBBBBBBBBBRR..',
      '..LBBBBKKKKKKBBBBBRR..',
      '..LBBBBBBBBBBBBBBBRR..',
      '..LBddBBBBBBddBBBBRR..',
      '..LBBBBBBBBBBBBBBBRR..',
      '..LBBBBBBBBBddddddRR..',
      '..RRRRRRRRRRRRRRRRRR..',
      '......................',
      '......................'
    ],
    lifeBacon: [
      '....KbbJJjJbbJJjbK....',
      '...KbbJJjJbbJJjbK.....',
      '...KbbJJjJbbJJjbK.....',
      '....KbbJJjJbbJJjbK....',
      '.....KbbJJjJbbJJjbK...',
      '.....KbbJJjJbbJJjbK...',
      '....KbbKKjJbbKKjbK....',
      '....KbbKKjJbbKKjbK....',
      '....KbbJJjJbbJJjbK....',
      '.....KbbJKKKKKKJjbK...',
      '.....KbbJKKKKKKJjbK...',
      '....KbbJJjJbbJJjbK....',
      '...KbbJJjJbbJJjbK.....',
      '...KbbJJjJbbJJjbK.....',
      '....KbbJJjJbbJJjbK....',
      '......................',
      '......................'
    ],
    lifeMilk: [
      '........DWWWWD........',
      '......DWWWWWWWWD......',
      '....DWWWWWWWWWwwwD....',
      '..DWWWWWWWWWWWWWWWWD..',
      '..DWWWWWWWWWWWWWWWWD..',
      '..DWWWWKKWWWWKKWWWWD..',
      '..DWWWWKKWWWWKKWWWWD..',
      '..DWWWWWWWWWWWWWWWWD..',
      '..DWWWWWKKKKKKWWWWWD..',
      '..DWWWWWWWWWWWWWWWWD..',
      '..DggggggggggggggggD..',
      '..DgGGgGGgGGgGGggggD..',
      '..DggggggggggggggggD..',
      '..DWWWWWWWWwwwwwwwwD..',
      '..DDDDDDDDDDDDDDDDDD..',
      '......................',
      '......................'
    ],

    /* The secret tenth's icon, same 1:1 treatment as the nine above it: the
     * open wrap thinned from five rows to four, and one crease row dropped, so
     * the face still lands at 22x17. The slanted cut end and the torn foil edge
     * are kept in full — at this size they are what tells him apart from the
     * bacon strip in the HUD.
     *
     * NO BROW ROW, and that is not an omission: every one of the nine icons
     * above spends its face on TWO eye rows and a mouth and drops the brows the
     * body frames wear. At 1:1 a brow sits one pixel outboard of an eye that is
     * itself only two pixels tall, so the three rows fuse into one dark
     * wedge: the angry look survives at 44x34 and smudges at 22x17. This
     * icon is also the HUD weapon chip for WRAPPED (ui.js draws a base weapon's
     * character life icon in place of the roundel the fifteen upgrades have),
     * so it is on screen every frame of his life and has to stay legible. */
    lifeBurrito: [
      '........RbbbbbbbR.....',
      '.....RbjJJjJJJjJbR....',
      '....RbbJJjJJJJJbbR....',
      '....RbdJJJjjJJJdbR....',
      '....DLCCCDdbbbbdbR....',
      '....DLCCCCCCCDdbbR....',
      '....DLCCCCCCCCCCDD....',
      '....DLCKKCCCCKKCDD....',
      '....DLCKKCCCCKKCDD....',
      '....DLCCCCCCCCCCDD....',
      '....DLCCCKKKKCCCDD....',
      '....DLCCCCCCCCCCDD....',
      '....DLCCDCCCCDCCDD....',
      '....DLCCDCCCCDCCDD....',
      '.....DDCDCCCCDCDD.....',
      '......................',
      '......................'
    ]
  };

  /* -------------------------------------------------------------------------
   * RASTERIZER
   * ---------------------------------------------------------------------- */

  const sprites = Object.create(null);   // name -> {canvas, w, h}

  /* Tint cache, nested rather than keyed by a joined string: name -> colour ->
   * a flat [alpha, sprite, alpha, sprite, ...] list. game.js washes EVERY live
   * toaster through tint() on every frame the formation is syruped (55 calls a
   * frame), and the select screen tints two previews plus the carousel ghosts,
   * so building a 'name|colour|alpha' key here would allocate a string per call
   * in the hottest render loop in the game — which SPEC section 12 forbids.
   * Both object levels are looked up with strings that already exist, and the
   * alpha list is a numeric scan, so a cache HIT allocates nothing at all.
   * There is never more than a handful of alphas per colour (game.js uses one,
   * ui.js one), so the scan is shorter than hashing a key would be. */
  const tintCache = Object.create(null);
  let built = false;

  /** A pixel-crisp offscreen canvas. */
  function makeCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return cv;
  }

  /**
   * Turn one pixel map into an offscreen canvas.
   * Horizontal runs of the same colour are filled with a single fillRect, so a
   * 48x32 bunker costs a few dozen draws instead of 1536.
   */
  function rasterize(name, map, key, scale) {
    if (!Array.isArray(map) || map.length === 0) {
      throw new Error('Sprite "' + name + '": pixel map is missing or empty.');
    }
    const rows = map.length;
    const cols = map[0].length;

    for (let r = 0; r < rows; r++) {
      if (typeof map[r] !== 'string') {
        throw new Error('Sprite "' + name + '": row ' + r + ' is not a string.');
      }
      if (map[r].length !== cols) {
        throw new Error('Sprite "' + name + '": row ' + r + ' is ' + map[r].length +
                        ' characters but row 0 is ' + cols +
                        '. Every row of a pixel map must be the same length.');
      }
    }

    const cv = makeCanvas(cols * scale, rows * scale);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (let r = 0; r < rows; r++) {
      const line = map[r];
      let c = 0;
      while (c < cols) {
        const ch = line.charAt(c);
        if (ch === '.') { c++; continue; }
        const colour = key[ch];
        if (!colour) {
          throw new Error('Sprite "' + name + '": character "' + ch + '" at row ' + r +
                          ', column ' + c + ' has no colour in its key.');
        }
        let end = c + 1;
        while (end < cols && line.charAt(end) === ch) end++;
        ctx.fillStyle = colour;
        ctx.fillRect(c * scale, r * scale, (end - c) * scale, scale);
        c = end;
      }
    }

    return { canvas: cv, w: cols * scale, h: rows * scale };
  }

  /* -------------------------------------------------------------------------
   * CHARACTER VARIANTS   (SPEC-VARIANTS.md section 3)
   *
   * Every one of the ten characters has three variants — thirty playable
   * versions — and every one of them reuses the character's EXISTING pixel
   * maps. A variant is two things and nothing else:
   *
   *   a colour KEY   the same map characters pointed at different T.C.PAL
   *                  entries, so STRAWBERRY and PEANUT BUTTER are the same jar
   *   an OVERLAY     an optional second map of the same dimensions, composited
   *                  on top, for the ideas a palette cannot carry on its own:
   *                  Swiss cheese HOLES, peanut butter's CHUNKS, lemonade's
   *                  BUBBLES, marmalade PEEL, chocolate CHIPS
   *
   * Both live on the variant rows in T.C.BASE_WEAPONS, next to the character
   * they belong to. Nothing here reads a number off a variant, because there
   * are none to read: SPEC-VARIANTS.md section 1 makes a variant cosmetic
   * precisely so the +/-20% balance band measured across 720 seeded runs
   * carries over to all thirty unchanged.
   *
   * Variants are cached under a derived name — `bread0~1` is variant 1 of
   * `bread0` — so get / draw / drawCentered / tint work on a variant with no
   * special-casing whatsoever at the call site. Call sites never build that
   * name themselves; they ask variantName() for it.
   *
   * Index 0 is the default. It is rasterized through the variant data like the
   * other two rather than aliased to the sprite it duplicates, so the default
   * path is genuinely exercised — and build() then proves it came out identical
   * to the sprite already on screen (assertVariantZeroMatchesBase).
   * ---------------------------------------------------------------------- */

  /* Joins a sprite name to a variant index. Not a character any sprite name
   * uses, so `bread0~1` can never collide with a hand-authored map name. */
  const VARIANT_SEP = '~';

  /* The face character, by the convention every playable body map in this file
   * follows: K is brows, eyes and mouth. An overlay never paints over it —
   * the variant overlays in util.js were authored against the two BODY frames
   * and were kept clear of the face there deliberately (a fleck stuck on a
   * tooth reads as a mistake), but the same overlay also serves the 22x17 HUD
   * life icon, which is a different drawing at the same map size and which the
   * author could not check every fleck against. This rule makes that promise
   * hold everywhere. It changes nothing on any body frame today — every
   * overlay is already clear of every body frame's face, and the variant test
   * measures that it stays that way. */
  const OVERLAY_FACE_CHAR = 'K';

  /* sprite name -> variant index -> the derived name. Cache HITS allocate
   * nothing, which matters: the HUD asks for a variant life icon and every
   * live shot asks for a variant projectile on every frame, and SPEC section
   * 12 forbids per-frame allocation in the hot path. Cleared by build(),
   * because a name is only correct once the sprite behind it exists. */
  const variantNameCache = Object.create(null);

  /**
   * The variant index inside a variant id. Accepts what the data actually
   * holds — `'jam.1'` — and the bare index, so a call site that already has
   * the number does not have to rebuild the id string to ask for a sprite.
   */
  function variantIndex(spriteName, variantId) {
    let n = variantId;
    if (typeof n === 'string') {
      // Everything after the last dot, so 'jam.1' and 'jam' both answer
      // honestly rather than the second one quietly becoming variant 0.
      const tail = n.slice(n.lastIndexOf('.') + 1);
      n = /^[0-9]+$/.test(tail) ? Number(tail) : NaN;
    }
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || n !== Math.floor(n)) {
      throw new Error('T.Sprites: "' + variantId + '" is not a variant id for sprite "' +
                      spriteName + '". Pass either the id from T.C.BASE_WEAPONS ' +
                      '(e.g. "jam.1") or its index (0, 1, 2).');
    }
    return n;
  }

  /**
   * The cached sprite name for a variant of `spriteName`.
   *
   * Falls back to the plain sprite name when that sprite has no variant at
   * that index — a sprite shared by the whole roster (the bacon strip's trail
   * ember, every upgrade projectile) has no per-variant colouring, and the
   * caller should get the sprite rather than an exception.
   *
   * @param {string} spriteName   a base sprite name, e.g. 'bread0'
   * @param {string|number} variantId  'bread.1' or 1
   * @returns {string} a name get/draw/tint accept
   */
  function variantName(spriteName, variantId) {
    const n = variantIndex(spriteName, variantId);
    let bySprite = variantNameCache[spriteName];
    if (bySprite === undefined) {
      bySprite = [];
      variantNameCache[spriteName] = bySprite;
    }
    const hit = bySprite[n];
    if (hit !== undefined) return hit;

    const derived = spriteName + VARIANT_SEP + n;
    const answer = sprites[derived] ? derived : spriteName;
    bySprite[n] = answer;
    return answer;
  }

  /** Every non-transparent character a pixel map uses, added into `into`. */
  function collectChars(map, into) {
    for (let r = 0; r < map.length; r++) {
      const line = map[r];
      for (let c = 0; c < line.length; c++) {
        const ch = line.charAt(c);
        if (ch !== '.') into[ch] = true;
      }
    }
    return into;
  }

  /**
   * Composite an overlay map onto a base map, producing the map that actually
   * gets rasterized. '.' is transparent in an overlay, so it keeps whatever
   * the base map had.
   *
   * Two rules beyond that, both of which exist so ONE overlay can serve all of
   * a character's maps — its idle frame, its recoil frame and its life icon:
   *   - an overlay never paints outside the base map's silhouette. A variant
   *     is cosmetic; it must never change the shape the player reads as the
   *     ship, and a detail fleck floating in the empty space beside a sprite
   *     is the most obvious way to break that.
   *   - an overlay never paints on the face (see OVERLAY_FACE_CHAR).
   */
  function compositeOverlay(label, map, overlay) {
    if (!Array.isArray(overlay) || overlay.length === 0) {
      throw new Error('Sprite "' + label + '": its overlay is not a pixel map.');
    }
    if (overlay.length !== map.length || overlay[0].length !== map[0].length) {
      throw new Error('Sprite "' + label + '": its overlay is ' +
                      overlay[0].length + 'x' + overlay.length +
                      ' but the map it sits on is ' + map[0].length + 'x' + map.length +
                      '. An overlay must be exactly the same dimensions as its base map.');
    }

    const out = new Array(map.length);
    for (let r = 0; r < map.length; r++) {
      const base = map[r];
      const over = overlay[r];
      if (typeof over !== 'string' || over.length !== base.length) {
        throw new Error('Sprite "' + label + '": overlay row ' + r +
                        ' is not a string of ' + base.length + ' characters.');
      }
      let line = '';
      for (let c = 0; c < base.length; c++) {
        const b = base.charAt(c);
        const o = over.charAt(c);
        line += (o !== '.' && b !== '.' && b !== OVERLAY_FACE_CHAR) ? o : b;
      }
      out[r] = line;
    }
    return out;
  }

  /**
   * Rasterize one variant of one existing pixel map and cache it under the
   * name variantName() hands out.
   *
   * @param {string} baseMapName   the map to recolour, e.g. 'bread0'
   * @param {string|number} variantId  'bread.1' or 1
   * @param {object} key           map character -> colour, for THIS variant
   * @param {string[]} [overlayMap] optional detail map, same dimensions
   * @param {object} [usedOut]     internal: collects the characters the
   *                               finished map actually uses
   * @returns {string} the cached sprite name
   */
  function buildVariant(baseMapName, variantId, key, overlayMap, usedOut) {
    const map = MAPS[baseMapName];
    if (!map) {
      throw new Error('Variant "' + variantId + '": there is no pixel map called "' +
                      baseMapName + '" to build it from.');
    }
    if (!key || typeof key !== 'object') {
      throw new Error('Variant "' + variantId + '" of "' + baseMapName +
                      '": no colour key was given.');
    }

    const name = baseMapName + VARIANT_SEP + variantIndex(baseMapName, variantId);
    // Errors from here down quote the variant AND the sprite, because "which
    // of the thirty" is the first thing you need to know when one fails.
    const label = name + ' (variant ' + variantId + ')';
    const merged = overlayMap ? compositeOverlay(label, map, overlayMap) : map;
    // Collected from the base map and the overlay SEPARATELY, never from the
    // merged result: an overlay can cover the last cell of a base character
    // (the pain au chocolat's batons sit on the only two crumb pixels of the
    // flake), and that character is still a live entry in the key.
    if (usedOut) {
      collectChars(map, usedOut);
      if (overlayMap) collectChars(overlayMap, usedOut);
    }

    const scale = SCALE_OVERRIDE[baseMapName] || SCALE;
    const sprite = rasterize(label, merged, key, scale);

    const want = SIZES[baseMapName];
    if (want && (sprite.w !== want[0] || sprite.h !== want[1])) {
      throw new Error('Sprite "' + label + '": rasterized to ' + sprite.w + 'x' + sprite.h +
                      ' but "' + baseMapName + '" is ' + want[0] + 'x' + want[1] +
                      '. A variant may never change a sprite\'s size.');
    }

    sprites[name] = sprite;
    return name;
  }

  /**
   * Variant 0 is the character as it already looks. Prove it: every cell of
   * the variant's finished map must resolve to the same colour the base
   * sprite's own key gives it. rasterize() is deterministic, so equal inputs
   * are pixel-identical output — and this costs a map scan rather than a
   * canvas readback per sprite at boot.
   *
   * This is the cheapest possible guarantee that adding three versions of a
   * character has not disturbed the character that was measured into the
   * balance band.
   */
  function assertVariantZeroMatchesBase(baseMapName, variantId, key, overlayMap) {
    const map = MAPS[baseMapName];
    const baseKey = KEYS[baseMapName];
    const merged = overlayMap
      ? compositeOverlay(baseMapName + VARIANT_SEP + '0', map, overlayMap)
      : map;

    for (let r = 0; r < map.length; r++) {
      for (let c = 0; c < map[r].length; c++) {
        const b = map[r].charAt(c);
        const m = merged[r].charAt(c);
        const was = (b === '.') ? null : baseKey[b];
        const now = (m === '.') ? null : key[m];
        if (was !== now) {
          throw new Error('Variant "' + variantId + '" is the DEFAULT variant of "' +
                          baseMapName + '" and must render identically to it, but at row ' +
                          r + ', column ' + c + ' it paints ' + (now || 'nothing') +
                          ' where the sprite paints ' + (was || 'nothing') + '.');
        }
      }
    }
  }

  /**
   * Rasterize every variant: for each of the ten characters, each variant's
   * idle frame, firing frame and HUD life icon through its `key`/`overlay`,
   * and its projectile (all three splash widths, for the milk carton) through
   * its `shotKey`/`shotOverlay`.
   *
   * The overlay goes on the body frames AND the life icon — the three maps are
   * all 22x17 and compositeOverlay() clips it to each silhouette — because a
   * SWISS life icon that had lost its holes would be a CHEDDAR life icon in a
   * different yellow, and telling the two players apart in the HUD is half of
   * what section 5 asks the variant names and icons to do.
   *
   * Called by build(), eagerly, and it stays eager because the cost was
   * measured rather than guessed: the nine public characters' 114 variant
   * sprites took 5.3 ms in Chrome (46 microseconds each, inside a 7.7 ms
   * whole-roster build) and 1.9 ms under node; the secret tenth adds twelve
   * more rasterizations at that same per-sprite cost, three of which land on
   * the sizzle map bacon already built and are byte-identical to it. That is a
   * one-off cost paid once, before the first frame is ever requested.
   * Rasterizing lazily would save those 5 ms of a boot nobody
   * is watching and spend them instead as a hitch the first time a player
   * scrolls the variant picker — a worse trade in the only place it shows.
   * scratchpad/variant-sprites.js re-measures both numbers.
   */
  function buildCharacterVariants() {
    const roster = T.C.BASE_WEAPONS;
    const order = T.C.CHARACTER_ORDER;

    for (let i = 0; i < order.length; i++) {
      const row = roster[order[i]];
      if (!row || !Array.isArray(row.variants)) {
        throw new Error('Character "' + order[i] +
                        '" has no variants array in T.C.BASE_WEAPONS.');
      }

      // The projectile, plus the milk carton's three splash widths. One list,
      // deduped, because `shot` is also the first entry of `shotGrow`.
      const shotMaps = [row.shot];
      const grow = row.shotGrow || [];
      for (let g = 0; g < grow.length; g++) {
        if (shotMaps.indexOf(grow[g]) < 0) shotMaps.push(grow[g]);
      }
      const bodyMaps = [row.ship, row.shipFire, row.life];

      for (let n = 0; n < row.variants.length; n++) {
        const v = row.variants[n];
        const bodyUsed = Object.create(null);
        const shotUsed = Object.create(null);

        for (let b = 0; b < bodyMaps.length; b++) {
          buildVariant(bodyMaps[b], v.id, v.key, v.overlay, bodyUsed);
        }
        for (let s = 0; s < shotMaps.length; s++) {
          buildVariant(shotMaps[s], v.id, v.shotKey, v.shotOverlay, shotUsed);
        }

        assertKeyIsAllUsed(v.id, 'key', v.key, bodyUsed, bodyMaps);
        assertKeyIsAllUsed(v.id, 'shotKey', v.shotKey, shotUsed, shotMaps);

        if (n === 0) {
          for (let b = 0; b < bodyMaps.length; b++) {
            assertVariantZeroMatchesBase(bodyMaps[b], v.id, v.key, v.overlay);
          }
          for (let s = 0; s < shotMaps.length; s++) {
            assertVariantZeroMatchesBase(shotMaps[s], v.id, v.shotKey, v.shotOverlay);
          }
        }
      }
    }
  }

  /**
   * A key entry whose character appears in none of the maps the key is used on
   * paints nothing. If EVERY entry were like that the variant would ship as an
   * invisible duplicate of the default — a whole playable version that quietly
   * is not there — so a single dead entry is treated as the typo it almost
   * certainly is and named out loud.
   *
   * The scope is the FAMILY of maps a key is applied to, not one map, because
   * one key legitimately covers several drawings: the jam jar's `d` is the
   * gingham check on its lid, which the 22x17 life icon is too small to print.
   */
  function assertKeyIsAllUsed(variantId, which, key, used, mapNames) {
    for (const ch in key) {
      if (!used[ch]) {
        throw new Error('Variant "' + variantId + '": its ' + which + ' gives colour ' +
                        key[ch] + ' to "' + ch + '", a character that appears in none of ' +
                        mapNames.join(', ') + ' (nor in its overlay). A key entry that ' +
                        'matches nothing is a silent no-op — a variant made entirely of ' +
                        'them would ship as an invisible duplicate of the default.');
      }
    }
  }

  /* -------------------------------------------------------------------------
   * PUBLIC API
   * ---------------------------------------------------------------------- */

  /**
   * Rasterize every sprite. Call once at boot, before anything renders.
   * Throws a named Error on a ragged map, an unknown colour character, or a
   * sprite whose finished size does not match the spec.
   */
  function build() {
    for (const name in sprites) delete sprites[name];
    // Drops the whole nested cache: every tinted copy is derived from a sprite
    // canvas that is about to be replaced, so none of them may outlive it.
    for (const cachedName in tintCache) delete tintCache[cachedName];
    // Same reason: a variant name is only the right answer while the sprite it
    // names exists, and every one of them is about to be rebuilt.
    for (const cachedSprite in variantNameCache) delete variantNameCache[cachedSprite];
    built = false;

    const names = Object.keys(MAPS);
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const key = KEYS[name];
      if (!key) {
        throw new Error('Sprite "' + name + '": no colour key is registered for it.');
      }
      const scale = SCALE_OVERRIDE[name] || SCALE;
      const sprite = rasterize(name, MAPS[name], key, scale);

      const want = SIZES[name];
      if (!want) {
        throw new Error('Sprite "' + name + '": no expected size is registered for it.');
      }
      if (sprite.w !== want[0] || sprite.h !== want[1]) {
        throw new Error('Sprite "' + name + '": rasterized to ' + sprite.w + 'x' + sprite.h +
                        ' but the spec requires ' + want[0] + 'x' + want[1] +
                        '. Check the map\'s row length and row count.');
      }
      sprites[name] = sprite;
    }

    // Catch a sprite that the spec demands but nobody drew.
    const required = Object.keys(SIZES);
    for (let i = 0; i < required.length; i++) {
      if (!sprites[required[i]]) {
        throw new Error('Sprite "' + required[i] + '": required by the spec but has no pixel map.');
      }
    }

    // The thirty playable versions, recoloured off the maps just built above.
    buildCharacterVariants();

    built = true;
  }

  /** @returns {{canvas:HTMLCanvasElement, w:number, h:number}} — do not mutate. */
  function get(name) {
    const s = sprites[name];
    if (!s) {
      throw new Error(built
        ? 'Unknown sprite "' + name + '".'
        : 'T.Sprites.get("' + name + '") called before T.Sprites.build().');
    }
    return s;
  }

  /** Blit with the sprite's top-left corner at (x, y). Coordinates are snapped. */
  function draw(ctx, name, x, y) {
    const s = get(name);
    ctx.drawImage(s.canvas, Math.round(x), Math.round(y));
  }

  /** Blit centred on (cx, cy). */
  function drawCentered(ctx, name, cx, cy) {
    const s = get(name);
    ctx.drawImage(s.canvas, Math.round(cx - s.w / 2), Math.round(cy - s.h / 2));
  }

  /**
   * A recoloured copy of a sprite, cached forever after the first request.
   * The tint is a source-atop wash at `strength` alpha, so shading survives —
   * it reads as a player accent, not a flat silhouette.
   *
   * Safe to call every frame for every enemy: a cache hit is two property
   * lookups on strings the caller already holds plus a numeric scan, and
   * allocates nothing (see the tintCache declaration).
   *
   * @param {string} name
   * @param {string} colour  any canvas fillStyle
   * @param {number} [strength] 0..1, defaults to TINT_ALPHA
   */
  function tint(name, colour, strength) {
    const s = get(name);
    const alpha = (typeof strength === 'number') ? strength : TINT_ALPHA;

    let byColour = tintCache[name];
    if (byColour === undefined) {
      byColour = Object.create(null);
      tintCache[name] = byColour;
    }
    let slots = byColour[colour];
    if (slots === undefined) {
      slots = [];
      byColour[colour] = slots;
    }
    for (let i = 0; i < slots.length; i += 2) {
      if (slots[i] === alpha) return slots[i + 1];
    }

    const cv = makeCanvas(s.w, s.h);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, s.w, s.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    const out = { canvas: cv, w: s.w, h: s.h };
    slots.push(alpha, out);
    return out;
  }

  /** True if `name` is a sprite that has been built. */
  function has(name) {
    return !!sprites[name];
  }

  /** Every built sprite name, for debug overlays and sanity checks. */
  function names() {
    return Object.keys(sprites);
  }

  T.Sprites = {
    SCALE: SCALE,
    build: build,
    get: get,
    draw: draw,
    drawCentered: drawCentered,
    tint: tint,
    has: has,
    names: names,

    // Character variants (SPEC-VARIANTS.md section 3). buildVariant() is here
    // for anything that needs a recolour the roster does not already carry;
    // the thirty in T.C.BASE_WEAPONS are built by build() and are reached with
    // variantName(), which every call site should use in place of a raw name.
    buildVariant: buildVariant,
    variantName: variantName
  };

})(window.T = window.T || {});
