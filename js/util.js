/* ===========================================================================
 * TOASTER INVADERS — js/util.js
 *
 * ROLE: the foundation layer. Loads FIRST, before every other script, and is
 * the only file allowed to define tunable numbers.
 *
 *   T.C     — every constant that tunes look or feel (screen metrics, formation
 *             geometry, speeds, scoring tables, and the full colour palette).
 *             Other files READ these; nobody else defines or overwrites them.
 *             That includes BASE_WEAPONS / CHARACTER_ORDER: the nine playable
 *             characters and every number that makes their base weapons
 *             shoot differently (SPEC-CHARACTERS.md).
 *   T.Util  — small dependency-free helpers: math, a seeded RNG, the formation
 *             march-timing curve, AABB overlap, a clock, safe localStorage, and
 *             a minimal object pool for the no-allocation hot loops.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  /* -------------------------------------------------------------------------
   * PALETTE
   * Toaster chrome, bread, jam and butter, plus the After Dark night sky the
   * whole site sits on. Referenced everywhere as T.C.PAL.<name>.
   * ---------------------------------------------------------------------- */
  const PAL = {
    bg:        '#0d0b10',   // deep charcoal (fallback background)
    bgGrid:    '#161320',   // faint scanline / grid tint

    crust:     '#c98a3f',   // bread crust
    crumb:     '#f3dfa8',   // bread body
    crumbDark: '#d9c084',   // bread shading

    jamRed:    '#c8203f',   // jam
    jamLite:   '#f0577a',   // jam highlight
    glass:     '#bfe6f2',   // jar glass
    glassDark: '#7fb6cc',

    butter:    '#ffd85e',   // butter
    butterLt:  '#fff2b0',

    chrome:    '#c9d2dc',   // toaster body
    chromeLt:  '#eef3f8',   // toaster highlight
    chromeDk:  '#6d7a88',   // toaster shadow
    slot:      '#1b1a22',   // toaster slot (dark)
    coil:      '#ff5b2e',   // glowing heating element
    coilLt:    '#ffb04a',
    burnt:     '#3a2a22',   // charred toast

    ui:        '#f3dfa8',   // HUD text
    uiDim:     '#7b6f55',
    p1:        '#7ee0c0',   // player-1 accent
    p2:        '#f0a3c8',   // player-2 accent

    wing:      '#f7f9fb',   // feather white
    wingShade: '#b9c4d0',   // feather shadow

    sky:       '#101a2e',   // After Dark night-sky blue (gradient top)
    skyDeep:   '#070a14',   // background gradient bottom
    star:      '#dfe8f5',   // drifting star

    danger:    '#ff4d4d',

    /* --- CHARACTER IDENTITY COLOURS ---------------------------------------
     * Seven of the nine roster rows used to carry their `color` as a hex
     * literal on the row itself. Six of those colours are named here now (the
     * seventh, the honey dipper's, is PAL.honeyGold below), because a variant
     * has to be able to point at the EXACT colour its character shipped with:
     * SPEC-VARIANTS.md §2 makes index 0 "the default, so existing behaviour is
     * unchanged for a player who never opens the variant picker", and the
     * trail a base shot draws is one of the things that has to be unchanged.
     * The same hex written out twice is how that quietly stops being true, so
     * there is one copy and the row and its variant 0 both name it.
     */
    croissantGold: '#e0a75f',   // croissant row + CLASSIC
    mugCoffee:     '#9b6a4a',   // mug row + BLACK COFFEE
    pepperSteel:   '#b9c0cc',   // pepper row + BLACK PEPPER
    cheeseYellow:  '#dcd23a',   // cheese row + CHEDDAR
    baconPink:     '#e0564f',   // bacon row + STREAKY
    milkWhite:     '#eef4ff',   // milk row + WHOLE MILK

    /* --- VARIANT COLOURS  (SPEC-VARIANTS.md sections 2 and 3) -------------
     * The 27 playable variants are PALETTE SWAPS over the nine pixel maps
     * that already exist — a variant supplies a different colour key for the
     * same map, never a new sprite and never a new number. So every colour a
     * variant key names lives here, beside the base palette, rather than as a
     * hex literal buried in the roster below.
     *
     * Grouped by the variant that introduced each set. Where a variant is
     * happy with an existing colour it reuses it: the whole point of the
     * palette-swap approach is that 27 versions still look like one game.
     */

    // GARLIC BUTTER (bread.1) — a yellow-green pat shot through with herb.
    garlicButter:  '#e3e08a',   // the pat itself, butter gone green
    garlicGreen:   '#8fbf5c',   // chopped garlic / parsley flecks
    garlicPale:    '#f2f4c8',   // its highlight

    // CINNAMON SUGAR (bread.2) — dusty tan with a sugar sparkle on it.
    cinnamon:      '#a96b34',   // cinnamon shading
    cinnamonDust:  '#d8a86a',   // the dusted surface
    sugarWhite:    '#fff4d8',   // undissolved sugar crystals

    // PEANUT BUTTER (jam.1) — chunky mid-brown.
    peanutBrown:   '#b07a3c',
    peanutLite:    '#d9a566',   // the smooth highlight
    peanutChunk:   '#7a4a1e',   // the chunks, darker than the spread

    // MARMALADE (jam.2) — amber with shreds of peel suspended in it.
    marmaladeAmber:'#e08a1e',
    marmaladeLite: '#ffb64a',
    marmaladePeel: '#c25f10',

    // ALMOND CROISSANT (croissant.1) — pale, flaked, dusted.
    almondShell:   '#c9a878',   // the toasted outer edge
    almondCream:   '#f0e3c8',   // frangipane interior
    almondFlake:   '#fff8e8',   // flaked almonds on top

    // PAIN AU CHOCOLAT (croissant.2) — dark cocoa, two batons through it.
    cocoa:         '#5b3a24',
    cocoaLt:       '#8a5a38',   // the glazed sheen
    cocoaDark:     '#3a2416',   // the batons and the outer edge

    // LATTE (mug.1) — creamy tan under white foam.
    latteTan:      '#c99a68',
    latteFoam:     '#f4e4cd',
    latteRim:      '#a4784d',   // warm rim and handle outline
    latteDark:     '#7d5334',   // the coffee under the foam, and the face

    // MATCHA (mug.2) — vivid ceremonial green.
    matchaGreen:   '#4e8b3a',
    matchaLite:    '#8cc46a',
    matchaFoam:    '#d7ecc0',
    matchaDark:    '#2f5a24',

    // BLACK PEPPER (pepper.0) has no colour of its own: it is the DEFAULT
    // variant, so it wears PAL.pepperSteel — the grinder's own roster colour,
    // exactly as it did before variants existed.

    // CHILLI FLAKES (pepper.1) — hot red with pale seeds in it.
    chilliRed:     '#d63a1e',
    chilliLite:    '#ff7a3c',
    chilliDark:    '#8f2410',
    chilliSeed:    '#f6d97a',

    // SEA SALT (pepper.2) — bright white crystal.
    saltWhite:     '#f6f8fb',
    saltGrey:      '#b8c2cd',
    saltShadow:    '#8794a1',

    // WILDFLOWER HONEY (honey.0) — the dipper's own amber. The honey row's
    // `color` names this too, so its default trail and its HUD tint are one
    // colour rather than two copies of one hex (see CHARACTER IDENTITY above).
    honeyGold:     '#ffa62b',

    // AGAVE (honey.1) — pale amber, thinner than honey.
    agavePale:     '#f0c66a',
    agaveLite:     '#fbe7ae',
    agaveWood:     '#c9a06a',

    // MOLASSES (honey.2) — near-black and glossy.
    molasses:      '#2a1a12',
    molassesGloss: '#6b4326',   // the wet highlight that sells "glossy"
    molassesLite:  '#8a5a30',

    // SWISS (cheese.1) — pale yellow paste, big holes.
    swissPale:     '#f7ecb8',
    swissLite:     '#fffbe4',
    swissHole:     '#c9b878',

    // BLUE (cheese.2) — white paste marbled with blue veins.
    blueCheese:      '#f2f2ea',
    blueCheeseVein:  '#4a5fa8',
    blueCheeseShade: '#c9cbc0',
    blueCheeseRind:  '#b8b39a',

    // MAPLE GLAZED (bacon.1) — dark amber, lacquered.
    mapleAmber:    '#a8621c',
    mapleGloss:    '#e09a3c',
    mapleFat:      '#f0d49a',

    // VEGGIE (bacon.2) — implausibly bright red. On purpose.
    veggieRed:     '#ff2d3a',
    veggiePink:    '#ff8fa0',
    veggieCream:   '#ffe9d2',

    // LEMONADE (milk.1) — pale yellow, fizzing.
    lemonadePale:  '#fdf3bc',
    lemonadeYellow:'#f7e070',
    lemonadeBand:  '#e0b520',   // the printed band round the carton
    lemonadeRind:  '#a8801a',   // its printed outline
    lemonadeFizz:  '#fffce8',   // bubbles

    // CHOCOLATE MILK (milk.2) — rich brown with chips in it.
    chocolate:     '#7a4a2c',
    chocolateLt:   '#a9714a',
    chocolateDark: '#3f2416',
    chocolateChip: '#2a170d'
  };

  /* -------------------------------------------------------------------------
   * BASE WEAPONS / PLAYABLE CHARACTERS   (SPEC-CHARACTERS.md §2 and §3)
   *
   * Nine playable characters, each with its own BASE weapon. Every one of them
   * still obeys the classic ONE-LIVE-SHOT rule; the upgrade tokens from
   * SPEC-WEAPONS.md override the base weapon identically for all nine.
   *
   * The balance rule this table exists to enforce: ONE advantage paired with
   * ONE drawback, and every advantage is CONDITIONAL. No character may be a
   * strict upgrade of another, so every row below is a trade — a bigger number
   * in one column is always paid for in another. These are the numbers the
   * balance harness measures and tunes, which is exactly why they live here
   * and not as literals down in weapons.js.
   *
   * Fields, per row:
   *   id         character id; this is `ship.kind`
   *   char       display name of the CHARACTER (select screen)
   *   blurb      one-line flavour under the name
   *   weapon     display name of the WEAPON (HUD chip, uppercase)
   *   wid        weapon id — `shot.wid`, and what T.Weapons.baseFor(kind) returns
   *   tagline    banner line, same role as the upgrade roster's taglines
   *   color      HUD chip / shot tint
   *   mech       which projectile mechanic weapons.js dispatches to
   *   speed      px/sec the shot climbs at
   *   w, h       shot hitbox in logical px (milk's `w` is its LAUNCH width)
   *   refire     extra seconds after the previous shot dies before firing again
   *   dmg        bunker carve radius in px (0 = does not damage bunkers at all)
   *   ship /
   *   shipFire   sprite names, idle and firing recoil
   *   life       HUD life-icon sprite name
   *   shot       projectile sprite name
   *   sfx        T.Audio.play name for the muzzle sound
   *   advantage  the ONE thing this character is good at   (shown on select)
   *   drawback   the ONE thing it is bad at                (shown on select)
   *
   * advantage/drawback are DATA, not UI copy buried in ui.js: the select screen
   * has to make the trade legible for all nine, and the harness reads the same
   * rows it is asserting on.
   *
   *   variants   the three cosmetic variants of this character
   *
   * VARIANTS ARE COSMETIC. That is the governing rule of SPEC-VARIANTS.md and
   * the reason the feature is safe: the roster above was measured into a
   * +/-20% balance band across 720 seeded runs, and cosmetic variants inherit
   * that proof exactly instead of turning it into a 27-way problem.
   *
   * So a variant entry carries ONLY identity:
   *
   *   id           `<characterId>.<n>`, n = 0..2
   *   name         display name — the select screen and the HUD chip show THIS,
   *                not the character's `weapon` name ("PEANUT BUTTER", not "JAM")
   *   flavour      one line for the select screen
   *   key          colour key for this character's EXISTING body pixel maps
   *   overlay      optional detail map composited over them, or null
   *   shotKey      colour key for its EXISTING projectile map
   *   shotOverlay  optional detail map for that, or null
   *   trailColor   particle / trail colour
   *   sfxDetune    cents offset on the character's fire sound — TIMBRE ONLY,
   *                never its length or its gain
   *
   * and a variant entry must NEVER carry speed, w, h, refire, dmg, range,
   * pellets, bounces, growth or trail duration. Those stay on the parent row,
   * one copy, shared by all three variants. scratchpad/variant-parity.js scans
   * this data for exactly those field names and fails the build if one appears.
   *
   * Index 0 is the CURRENT default for every character: its `key` and
   * `shotKey` reproduce the sprite colours already in sprites.js, and its
   * `trailColor` is the exact colour weapons.js painted that character's
   * streak and splatter with before variants existed — PAL.butterLt for
   * butter, PAL.jamRed for jam, and the parent row's own `color` for the
   * other seven. So a player who never opens the variant picker sees no
   * change at all, in the sprite OR in the trail. sprites.js asserts the
   * first half of that at boot (assertVariantZeroMatchesBase) and smoke.js
   * section [V8] asserts the second.
   * ---------------------------------------------------------------------- */

  /* THESE NUMBERS ARE MEASURED, NOT AUTHORED  (SPEC-CHARACTERS.md section 5)
   *
   * The speeds, hitboxes, refire delays and bunker-carve radii below are the
   * ones the balance harness settled on, and they are NOT the illustrative
   * values in the spec's section 2 table. Every one of them was moved by a
   * measurement and can be re-measured:
   *
   *     scratchpad/character-balance.js   360 seeded runs per character, one
   *                                       scripted bot, upgrade tokens off
   *
   * With the spec's own numbers the roster was not balanced: the COFFEE MUG
   * took 81s to clear wave 1 against a 60s roster median (+35%, a third longer
   * than anyone), the PEPPER GRINDER cleared it 25% faster than anyone, and
   * seven characters were a strict superset of some other character. The
   * changes that fixed it, in order of size:
   *   MUG_RANGE 340 -> 410   the drip could not reach a fresh formation's
   *                          third row, so the mug spent a minute waiting for
   *                          the wall to come down. Its hitbox and refire moved
   *                          the clear time by ~3s; only reach moved it at all.
   *   refire, roster-wide    every delay is longer than the spec's. The mug's
   *                          cycle is dominated by refire (its shot dies at
   *                          410px) and everyone else's by flight time, so
   *                          scaling the whole column up is the one lever that
   *                          costs the mug more than the rest — it is what
   *                          brought its waves-survived from +28% to +8%.
   *   pepper refire 0.48     three pellets a pull is worth roughly three times
   *                          the trigger discipline.
   *   dmg                    a shot's carve radius is mostly a SURVIVAL dial:
   *                          it decides how fast you chew through your own
   *                          shields. Milk's 3 and croissant's 12 are there.
   *
   * RE-MEASURED AT INTEGRATION, after two correctness fixes in weapons.js that
   * moved every number in the table:
   *   - `refire` was only being charged on about half the shots (a shot killed
   *     by a COLLISION does not become its husk until the next frame, and the
   *     ship fires at the top of that frame). Now it always bites, so every
   *     character's real cycle got longer.
   *   - the bacon strip's ember spacing was quantised to whole frames, which
   *     made BACON_TRAIL_GAP a staircase instead of a dial.
   * With those fixed the roster stayed inside the band but the PEPPER GRINDER
   * became a strict superset of the COFFEE MUG, so:
   *   mug hitbox 4x8 -> 6x12    the drip survives longer per wave, which is
   *                             the metric the grinder was beating it on
   *   pepper pellets kept 4x9   three 4px pellets is 12px of coverage against
   *                             butter's 10, which is what stops the plain
   *                             columns making the grinder a flatly worse
   *                             slice of bread; the mug is separated from it
   *                             on survival instead, above
   *   BACON_TRAIL_GAP 16 -> 7   the rasher's kills now come off its trail
   *                             rather than its nose, which is the drawback
   *                             its select-screen line advertises
   *   milk speed 620 -> 580     back to the spec's own number; at 620 the
   *                             carton and the jam jar separated by 0.6% on
   *                             one metric and by nothing on a holdout seed
   *                             set, which is noise, not a trade
   * Re-measured on TWO disjoint seed sets (1-360 and 361-720): both pass A, B
   * and C, and the tightest surviving pair-trade is 2.5%, comfortably outside
   * the ~1.5% standard error of the survival metric.
   *
   * TWO ROWS ARE NOT TUNABLE. Butter and jam predate this file: SPEC.md §4,
   * SPEC-WEAPONS.md §3 and SPEC-CHARACTERS.md §2 all state their speed, hitbox
   * and carve radius, they are the baseline the other seven are measured
   * against, and the weapons regression suite asserts them. Their `refire` is
   * the one number on those two rows that section 5 may move.
   *
   * Read that harness before changing a number here: it asserts every mean
   * lands within +/-20% of the roster median, that no character is a strict
   * superset of another, and that each character's advertised drawback is real.
   */

  // Milk's splash grows across its flight; the launch width in the table and
  // the growth range below are the same two numbers, so they share a source.
  const MILK_W_MIN = 4;
  const MILK_W_MAX = 16;

  /* -------------------------------------------------------------------------
   * VARIANT DETAIL OVERLAYS  (SPEC-VARIANTS.md sections 3 and 4)
   *
   * A variant is a colour key over an EXISTING pixel map. Most of the 27 need
   * nothing else — "matcha" and "veggie bacon" are entirely a palette. A few
   * carry an idea a palette cannot say on its own: Swiss cheese has HOLES,
   * peanut butter is CHUNKY, lemonade FIZZES, marmalade has PEEL in it,
   * chocolate milk has CHIPS. Those get one of these.
   *
   * An overlay is a pixel map of the SAME dimensions as the map it sits on,
   * `.` transparent, composited after the base map. Its characters are looked
   * up in the same variant `key` as the base map's, so every overlay glyph
   * below (F, Q, N, P, X, H, V, Z) appears in the key of the variant that
   * uses it.
   *
   * Every character has TWO body frames (idle and firing recoil) and one
   * overlay serves both, so no overlay pixel may land on a cell that is
   * transparent in either frame, and none may land on the FACE — the recoil
   * frame widens the brows and opens the mouth, and a fleck stuck on a tooth
   * reads as a mistake. The coordinates below were picked against both frames
   * of each map for exactly that reason.
   * ---------------------------------------------------------------------- */

  // GARLIC BUTTER — herb flecks over the crumb, clear of the face.
  const OV_GARLIC = [
    '......................',
    '......................',
    '......................',
    '......F.....F...F.....',
    '....F....F.....F......',
    '......................',
    '....F......F.....F....',
    '......................',
    '.........F..F....F....',
    '......................',
    '......................',
    '......................',
    '.....F....F....F......',
    '.......F....F.........',
    '.....F...F............',
    '......................',
    '......................'
  ];

  // CINNAMON SUGAR — undissolved sugar sparkling on the dusted surface.
  const OV_CINNAMON = [
    '......................',
    '......................',
    '......................',
    '....Q....Q....Q..Q....',
    '......Q....Q....Q.....',
    '......................',
    '...Q.....Q..Q.....Q...',
    '......................',
    '....Q.....Q.....Q.....',
    '......................',
    '......................',
    '......................',
    '....Q...Q....Q........',
    '.....Q....Q...........',
    '......Q....Q..........',
    '......................',
    '......................'
  ];

  // PEANUT BUTTER — the chunks. This is the whole difference between crunchy
  // and smooth, and a palette swap alone cannot say it.
  const OV_PEANUT = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......N.........N.....',
    '......................',
    '......................',
    '.....N...........N....',
    '......................',
    '......N.....N.....N...',
    '......................',
    '........N....N........',
    '......................',
    '.....N....N....N......',
    '......................'
  ];

  // MARMALADE — shreds of peel suspended through the amber.
  const OV_MARMALADE = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '.....P...........P....',
    '......................',
    '......................',
    '......P.........P.....',
    '......................',
    '.....P.....P.....P....',
    '......................',
    '.......P......P.......',
    '......................',
    '....P......P.....P....',
    '......................'
  ];

  // ALMOND — flaked almonds scattered over the glaze and the lower body.
  const OV_ALMOND = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......F...F...F.......',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '...F.F..........F.....',
    '...............F.F....',
    '....F...F...F.........',
    '.....F..F.............',
    '......................'
  ];

  // PAIN AU CHOCOLAT — the two batons, which are the entire pastry.
  const OV_COCOA = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '....XX..........XX....',
    '....XX..........XX....',
    '....XX..........XX....',
    '....XX..........XX....',
    '......................'
  ];

  // CHILLI FLAKES — pale seeds through the red grind in the barrel.
  const OV_CHILLI = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '........F...F.........',
    '.......F...F..F.......',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................',
    '........F...F.........',
    '......F...F....F......',
    '......................',
    '......................'
  ];

  // SWISS — three big holes punched clean through the paste.
  const OV_SWISS = [
    '......................',
    '......................',
    '......................',
    '......................',
    '..............HHH.....',
    '..............HHH.....',
    '..............HHH.....',
    '......................',
    '...............HHH....',
    '...............HHH....',
    '...............HHH....',
    '......................',
    '......................',
    '......................',
    '....HHH...............',
    '....HHH...............',
    '......................'
  ];

  // BLUE — veins marbled diagonally through the white.
  const OV_BLUE = [
    '......................',
    '......................',
    '......................',
    '................V.....',
    '...............V......',
    '..............V.V.....',
    '...............V.V....',
    '......................',
    '................V.....',
    '...............V.V....',
    '................V.....',
    '......................',
    '......................',
    '.....V................',
    '....V.V...............',
    '.....V................',
    '......................'
  ];

  // LEMONADE — bubbles rising up the carton.
  const OV_LEMONADE = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......Z..Z............',
    '......................',
    '....Z............Z....',
    '......................',
    '....Z...........Z.....',
    '......................',
    '.....Z...........Z....',
    '......................',
    '......................',
    '......................',
    '......................',
    '......Z......Z........',
    '......................'
  ];

  // CHOCOLATE — chips, in 2x2 blobs so they read as lumps and not as noise.
  const OV_CHOCCHIP = [
    '......................',
    '......................',
    '......................',
    '......................',
    '......XX..............',
    '......XX.......XX.....',
    '...............XX.....',
    '......................',
    '................XX....',
    '................XX....',
    '...XX.................',
    '...XX.................',
    '......................',
    '......................',
    '......................',
    '......................',
    '......................'
  ];

  /* --- the same idea, on the projectiles ----------------------------------
   * Sized to each shot's own map: butter 5x8, jamShot 3x8, flake 4x7,
   * rind 9x14. The milk splash is deliberately overlay-free — it is three
   * maps of three different widths (splash0/1/2), so a single overlay could
   * not be "the same dimensions as the base map" for all three of them.
   */

  const OVS_GARLIC = [
    '.....',
    '.....',
    '..F..',
    '.....',
    '.F...',
    '...F.',
    '.....',
    '.....'
  ];

  const OVS_CINNAMON = [
    '.....',
    '...Q.',
    '.....',
    '.Q...',
    '.....',
    '.....',
    '...Q.',
    '.....'
  ];

  const OVS_PEANUT = [
    '...',
    '...',
    '..N',
    '...',
    '.N.',
    '...',
    '...',
    '...'
  ];

  const OVS_MARMALADE = [
    '...',
    '..P',
    '...',
    '..P',
    '...',
    '...',
    '.P.',
    '...'
  ];

  const OVS_ALMOND = [
    '....',
    '.F..',
    '....',
    '..F.',
    '....',
    '....',
    '....'
  ];

  const OVS_COCOA = [
    '....',
    '.X..',
    '.X..',
    '.X..',
    '....',
    '....',
    '....'
  ];

  const OVS_SWISS = [
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '...HHH...',
    '...HHH...',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    '.........'
  ];

  const OVS_BLUE = [
    '.........',
    '.........',
    '.........',
    '.........',
    '...V.....',
    '....V....',
    '.....V...',
    '.........',
    '..V......',
    '...V.....',
    '.........',
    '.........',
    '.........',
    '.........'
  ];

  const BASE_WEAPONS = {
    // The two neutral baselines. Everything else is measured against butter.
    bread: {
      id: 'bread', char: 'UNTOASTED BREAD', blurb: 'ONE UNTOASTED SLICE',
      weapon: 'BUTTER', wid: 'butter', tagline: 'SPREAD THE PAIN',
      color: PAL.butter, mech: 'plain',
      // LOCKED, not tunable: SPEC.md §4, SPEC-WEAPONS.md §3 and
      // SPEC-CHARACTERS.md §2 all state butter as 560 / 10x16 / carve 9, and
      // it is the baseline every other row is measured against. Only `refire`
      // — the column SPEC-CHARACTERS added and §5 tells you to tune — moved.
      speed: 560, w: 10, h: 16, refire: 0.20, dmg: 9,
      ship: 'bread0', shipFire: 'bread1', life: 'lifeBread',
      shot: 'butter', sfx: 'shootButter',
      advantage: 'WIDEST SHOT — FORGIVING AIM',
      drawback:  'MIDDLING SPEED, NO TRICKS',
      variants: [
        { id: 'bread.0', name: 'BUTTER', flavour: 'SALTED. UNAPOLOGETIC.',
          key: { R: PAL.crust, b: PAL.crumb, d: PAL.crumbDark, K: PAL.burnt },
          overlay: null,
          shotKey: { B: PAL.butter, L: PAL.butterLt },
          shotOverlay: null,
          trailColor: PAL.butterLt, sfxDetune: 0 },
        { id: 'bread.1', name: 'GARLIC BUTTER', flavour: 'NOBODY SITS NEXT TO YOU',
          key: { R: PAL.crust, b: PAL.garlicButter, d: PAL.crumbDark,
                 K: PAL.burnt, F: PAL.garlicGreen },
          overlay: OV_GARLIC,
          shotKey: { B: PAL.garlicButter, L: PAL.garlicPale, F: PAL.garlicGreen },
          shotOverlay: OVS_GARLIC,
          trailColor: PAL.garlicGreen, sfxDetune: -110 },
        { id: 'bread.2', name: 'CINNAMON SUGAR', flavour: 'DESSERT WITH A GRUDGE',
          key: { R: PAL.crust, b: PAL.cinnamonDust, d: PAL.cinnamon,
                 K: PAL.burnt, Q: PAL.sugarWhite },
          overlay: OV_CINNAMON,
          shotKey: { B: PAL.cinnamonDust, L: PAL.sugarWhite, Q: PAL.sugarWhite },
          shotOverlay: OVS_CINNAMON,
          trailColor: PAL.cinnamonDust, sfxDetune: 90 }
      ]
    },
    jam: {
      id: 'jam', char: 'JAM JAR', blurb: 'PRESERVES, ARMED',
      weapon: 'JAM', wid: 'jam', tagline: 'SEEDLESS AND SEETHING',
      color: PAL.jamRed, mech: 'plain',
      // LOCKED for the same reason as butter: 720 / 6x16 / carve 5 is stated
      // by all three specs and asserted by the existing regression suite.
      speed: 720, w: 6, h: 16, refire: 0.20, dmg: 5,
      ship: 'jam0', shipFire: 'jam1', life: 'lifeJam',
      shot: 'jamShot', sfx: 'shootJam',
      advantage: 'FAST SHOT, QUICK REFIRE',
      drawback:  'NARROW — PUNISHES SLOPPY AIM',
      variants: [
        { id: 'jam.0', name: 'STRAWBERRY', flavour: 'SEEDS IN, MERCY OUT',
          key: { G: PAL.glass, g: PAL.glassDark, J: PAL.jamRed, j: PAL.jamLite,
                 b: PAL.crumb, d: PAL.crumbDark, R: PAL.crust, K: PAL.burnt },
          overlay: null,
          shotKey: { J: PAL.jamRed, j: PAL.jamLite },
          shotOverlay: null,
          trailColor: PAL.jamRed, sfxDetune: 0 },
        { id: 'jam.1', name: 'PEANUT BUTTER', flavour: 'CHUNKY. LOAD-BEARING.',
          key: { G: PAL.glass, g: PAL.glassDark, J: PAL.peanutBrown,
                 j: PAL.peanutLite, b: PAL.crumb, d: PAL.crumbDark,
                 R: PAL.crust, K: PAL.burnt, N: PAL.peanutChunk },
          overlay: OV_PEANUT,
          shotKey: { J: PAL.peanutBrown, j: PAL.peanutLite, N: PAL.peanutChunk },
          shotOverlay: OVS_PEANUT,
          trailColor: PAL.peanutBrown, sfxDetune: -140 },
        { id: 'jam.2', name: 'MARMALADE', flavour: 'BITTER, LIKE ITS FATHER',
          key: { G: PAL.glass, g: PAL.glassDark, J: PAL.marmaladeAmber,
                 j: PAL.marmaladeLite, b: PAL.crumb, d: PAL.crumbDark,
                 R: PAL.crust, K: PAL.burnt, P: PAL.marmaladePeel },
          overlay: OV_MARMALADE,
          shotKey: { J: PAL.marmaladeAmber, j: PAL.marmaladeLite,
                     P: PAL.marmaladePeel },
          shotOverlay: OVS_MARMALADE,
          trailColor: PAL.marmaladeAmber, sfxDetune: 120 }
      ]
    },

    // Inherits CROISSANT_INHERIT of the ship's velocity at launch and keeps it
    // for life: curve shots around cover, but you must stand still to aim true.
    croissant: {
      id: 'croissant', char: 'CROISSANT', blurb: 'FLAKY AND FRENCH',
      weapon: 'FLAKE', wid: 'flake', tagline: 'LAYERS OF PAIN',
      color: PAL.croissantGold, mech: 'inherit',
      speed: 540, w: 7, h: 13, refire: 0.20, dmg: 12,
      ship: 'croissant0', shipFire: 'croissant1', life: 'lifeCroissant',
      shot: 'flake', sfx: 'fireFlake',
      advantage: 'CURVES WITH YOUR SHIP — LEAD THEM',
      drawback:  'CANNOT SHOOT STRAIGHT WHILE MOVING',
      variants: [
        { id: 'croissant.0', name: 'CLASSIC', flavour: 'ALL BUTTER, NO NOTES',
          key: { R: PAL.crust, b: PAL.crumb, d: PAL.crumbDark,
                 B: PAL.butter, K: PAL.burnt },
          overlay: null,
          shotKey: { R: PAL.crust, b: PAL.crumb, d: PAL.crumbDark, B: PAL.butter },
          shotOverlay: null,
          trailColor: PAL.croissantGold, sfxDetune: 0 },
        { id: 'croissant.1', name: 'ALMOND', flavour: 'FRANGIPANE FRAGMENTATION',
          key: { R: PAL.almondShell, b: PAL.almondCream, d: PAL.crumbDark,
                 B: PAL.almondFlake, K: PAL.burnt, F: PAL.almondFlake },
          overlay: OV_ALMOND,
          shotKey: { R: PAL.almondShell, b: PAL.almondCream, d: PAL.crumbDark,
                     B: PAL.almondFlake, F: PAL.almondFlake },
          shotOverlay: OVS_ALMOND,
          trailColor: PAL.almondFlake, sfxDetune: 70 },
        { id: 'croissant.2', name: 'PAIN AU CHOCOLAT',
          flavour: 'TWO BATONS. ONE PURPOSE.',
          // K goes pale here: the face is cut out of a near-black body, so the
          // burnt brown every other character uses would simply vanish.
          key: { R: PAL.cocoaDark, b: PAL.cocoa, d: PAL.burnt,
                 B: PAL.cocoaLt, K: PAL.crumb, X: PAL.cocoaDark },
          overlay: OV_COCOA,
          shotKey: { R: PAL.cocoaDark, b: PAL.cocoa, d: PAL.burnt,
                     B: PAL.cocoaLt, X: PAL.cocoaDark },
          shotOverlay: OVS_COCOA,
          trailColor: PAL.cocoa, sfxDetune: -160 }
      ]
    },

    // Fastest projectile AND fastest refire in the game — because the drip dies
    // at MUG_RANGE. The short life is the advantage and the drawback at once.
    mug: {
      id: 'mug', char: 'COFFEE MUG', blurb: 'STILL TOO HOT',
      weapon: 'DRIP', wid: 'drip', tagline: 'SERVED SCALDING',
      color: PAL.mugCoffee, mech: 'range',
      speed: 880, w: 6, h: 12, refire: 0.15, dmg: 4,
      ship: 'mug0', shipFire: 'mug1', life: 'lifeMug',
      shot: 'drip', sfx: 'fireDrip',
      advantage: 'FASTEST SHOT AND REFIRE IN THE GAME',
      drawback:  'FIZZLES SHORT — NO TOP ROWS EARLY',
      // All three keep the white diner china and swap what is IN the mug, so
      // the silhouette stays the same mug and only the drink changes.
      variants: [
        { id: 'mug.0', name: 'BLACK COFFEE', flavour: 'NO SUGAR. NO SURVIVORS.',
          key: { W: PAL.wing, w: PAL.wingShade, D: PAL.chromeDk, K: PAL.burnt,
                 R: PAL.crust, g: PAL.glassDark, G: PAL.glass },
          overlay: null,
          shotKey: { G: PAL.glass, R: PAL.crust, K: PAL.burnt },
          shotOverlay: null,
          trailColor: PAL.mugCoffee, sfxDetune: 0 },
        { id: 'mug.1', name: 'LATTE', flavour: 'FOAM HEART, COLD HEART',
          key: { W: PAL.wing, w: PAL.latteFoam, D: PAL.latteRim, K: PAL.latteDark,
                 R: PAL.latteFoam, g: PAL.latteTan, G: PAL.glass },
          overlay: null,
          shotKey: { G: PAL.glass, R: PAL.latteFoam, K: PAL.latteDark },
          shotOverlay: null,
          trailColor: PAL.latteTan, sfxDetune: 130 },
        { id: 'mug.2', name: 'MATCHA', flavour: 'CEREMONIAL GRADE HOSTILITY',
          key: { W: PAL.wing, w: PAL.matchaFoam, D: PAL.matchaGreen,
                 K: PAL.matchaDark, R: PAL.matchaFoam, g: PAL.matchaLite,
                 G: PAL.glass },
          overlay: null,
          shotKey: { G: PAL.glass, R: PAL.matchaFoam, K: PAL.matchaDark },
          shotOverlay: null,
          trailColor: PAL.matchaLite, sfxDetune: 230 }
      ]
    },

    // PEPPER_PELLETS pellets at ±PEPPER_SPREAD_DEG. The volley counts as ONE
    // live shot: you refire when the last pellet is gone, hence the slow refire.
    pepper: {
      id: 'pepper', char: 'PEPPER GRINDER', blurb: 'FRESHLY CRACKED',
      weapon: 'PEPPER', wid: 'pepper', tagline: 'A GENEROUS GRIND',
      color: PAL.pepperSteel, mech: 'volley',
      speed: 460, w: 4, h: 9, refire: 0.48, dmg: 3,
      ship: 'pepper0', shipFire: 'pepper1', life: 'lifePepper',
      shot: 'pepperPellet', sfx: 'firePepper',
      advantage: 'THREE PELLETS — SHREDS UP CLOSE',
      drawback:  'SPREAD WASTES ITSELF AT RANGE',
      // The chrome cap, neck and foot ring (C / L / D) are the same on all
      // three: what changes is the grind in the barrel and the pellet it
      // cracks out. The pellet always keeps a bright rim — see the note on
      // the pepperPellet map in sprites.js for why it has to.
      variants: [
        { id: 'pepper.0', name: 'BLACK PEPPER',
          flavour: 'FRESHLY CRACKED, FRESHLY CROSS',
          key: { R: PAL.crust, d: PAL.crumbDark, K: PAL.burnt, C: PAL.chrome,
                 L: PAL.chromeLt, D: PAL.chromeDk, S: PAL.slot },
          overlay: null,
          shotKey: { C: PAL.chrome, D: PAL.chromeDk, S: PAL.slot },
          shotOverlay: null,
          trailColor: PAL.pepperSteel, sfxDetune: 0 },
        { id: 'pepper.1', name: 'CHILLI FLAKES', flavour: 'SCOVILLE UNITS: RUDE',
          key: { R: PAL.chilliDark, d: PAL.chilliRed, K: PAL.burnt,
                 C: PAL.chrome, L: PAL.chromeLt, D: PAL.chromeDk,
                 S: PAL.chilliDark, F: PAL.chilliSeed },
          overlay: OV_CHILLI,
          shotKey: { C: PAL.chilliSeed, D: PAL.chilliDark, S: PAL.chilliRed },
          shotOverlay: null,
          trailColor: PAL.chilliLite, sfxDetune: 180 },
        { id: 'pepper.2', name: 'SEA SALT',
          flavour: 'HARVESTED BY HAND. THROWN BY YOU.',
          key: { R: PAL.saltGrey, d: PAL.saltWhite, K: PAL.slot, C: PAL.chrome,
                 L: PAL.chromeLt, D: PAL.chromeDk, S: PAL.saltShadow },
          overlay: null,
          shotKey: { C: PAL.wing, D: PAL.saltShadow, S: PAL.saltWhite },
          shotOverlay: null,
          trailColor: PAL.saltWhite, sfxDetune: 260 }
      ]
    },

    // dmg 0 and mech 'ghost': the bead passes through bunkers without carving
    // them, so you can shoot from full cover. It is also the slowest thing here.
    honey: {
      id: 'honey', char: 'HONEY DIPPER', blurb: 'STICKY BUSINESS',
      weapon: 'HONEY', wid: 'honey', tagline: 'SLOW AND STICKY',
      color: PAL.honeyGold, mech: 'ghost',
      speed: 420, w: 9, h: 20, refire: 0.16, dmg: 0,
      ship: 'honey0', shipFire: 'honey1', life: 'lifeHoney',
      shot: 'honeyDrop', sfx: 'fireHoney',
      advantage: 'SHOOTS THROUGH YOUR OWN BUNKERS',
      drawback:  'SLOWEST PROJECTILE IN THE GAME',
      variants: [
        { id: 'honey.0', name: 'WILDFLOWER', flavour: 'BEES DIED FOR THIS',
          key: { B: PAL.butter, L: PAL.butterLt, R: PAL.crust, K: PAL.burnt,
                 G: PAL.glass, g: PAL.glassDark },
          overlay: null,
          shotKey: { B: PAL.butter, L: PAL.butterLt, R: PAL.crust },
          shotOverlay: null,
          trailColor: PAL.honeyGold, sfxDetune: 0 },
        { id: 'honey.1', name: 'AGAVE', flavour: 'PLANT-BASED, STILL MEAN',
          key: { B: PAL.agavePale, L: PAL.agaveLite, R: PAL.agaveWood,
                 K: PAL.burnt, G: PAL.glass, g: PAL.glassDark },
          overlay: null,
          shotKey: { B: PAL.agavePale, L: PAL.agaveLite, R: PAL.agaveWood },
          shotOverlay: null,
          trailColor: PAL.agavePale, sfxDetune: 150 },
        { id: 'honey.2', name: 'MOLASSES', flavour: 'SLOW. INEVITABLE. STICKY.',
          // The face lives IN the syrup behind the glass, so on a near-black
          // fill it has to be cut in pale crumb to survive.
          key: { B: PAL.molasses, L: PAL.molassesGloss, R: PAL.molassesLite,
                 K: PAL.crumb, G: PAL.glass, g: PAL.glassDark },
          overlay: null,
          shotKey: { B: PAL.molasses, L: PAL.molassesGloss, R: PAL.molassesLite },
          shotOverlay: null,
          trailColor: PAL.molassesGloss, sfxDetune: -280 }
      ]
    },

    // Launches at ±CHEESE_ANGLE_DEG, alternating, and reflects off a side wall
    // CHEESE_BOUNCES times. Reaches the edge columns; never the one above you.
    cheese: {
      id: 'cheese', char: 'CHEESE WEDGE', blurb: 'AGED, ANGRY',
      weapon: 'RIND', wid: 'rind', tagline: 'SHARP AND MATURE',
      color: PAL.cheeseYellow, mech: 'angle',
      speed: 700, w: 9, h: 12, refire: 0.16, dmg: 4,
      ship: 'cheese0', shipFire: 'cheese1', life: 'lifeCheese',
      shot: 'rind', sfx: 'fireRind',
      advantage: 'ANGLED — BOUNCES OFF A SIDE WALL',
      drawback:  'NEVER HITS THE COLUMN ABOVE YOU',
      variants: [
        { id: 'cheese.0', name: 'CHEDDAR', flavour: 'MATURE ENOUGH TO KNOW BETTER',
          key: { B: PAL.butter, L: PAL.butterLt, d: PAL.crumbDark,
                 R: PAL.crust, K: PAL.burnt },
          overlay: null,
          shotKey: { B: PAL.butter, L: PAL.butterLt, d: PAL.crumbDark,
                     R: PAL.crust },
          shotOverlay: null,
          trailColor: PAL.cheeseYellow, sfxDetune: 0 },
        { id: 'cheese.1', name: 'SWISS', flavour: 'NEUTRAL COUNTRY, LOADED GUN',
          key: { B: PAL.swissPale, L: PAL.swissLite, d: PAL.swissHole,
                 R: PAL.crumbDark, K: PAL.burnt, H: PAL.swissHole },
          overlay: OV_SWISS,
          shotKey: { B: PAL.swissPale, L: PAL.swissLite, d: PAL.swissHole,
                     R: PAL.crumbDark, H: PAL.swissHole },
          shotOverlay: OVS_SWISS,
          trailColor: PAL.swissPale, sfxDetune: 100 },
        { id: 'cheese.2', name: 'BLUE', flavour: 'IT IS MEANT TO SMELL LIKE THAT',
          key: { B: PAL.blueCheese, L: PAL.wing, d: PAL.blueCheeseShade,
                 R: PAL.blueCheeseRind, K: PAL.burnt, V: PAL.blueCheeseVein },
          overlay: OV_BLUE,
          shotKey: { B: PAL.blueCheese, L: PAL.wing, d: PAL.blueCheeseShade,
                     R: PAL.blueCheeseRind, V: PAL.blueCheeseVein },
          shotOverlay: OVS_BLUE,
          trailColor: PAL.blueCheeseVein, sfxDetune: -200 }
      ]
    },

    // Drops burning embers as it climbs; a toaster that marches into one dies.
    // Area denial, paid for with the second-slowest shot in the roster.
    bacon: {
      id: 'bacon', char: 'BACON STRIP', blurb: 'STRAIGHT FROM THE PAN',
      weapon: 'SIZZLE', wid: 'sizzle', tagline: 'BURNT OFFERINGS',
      color: PAL.baconPink, mech: 'trail',
      speed: 460, w: 6, h: 18, refire: 0.22, dmg: 5,
      ship: 'bacon0', shipFire: 'bacon1', life: 'lifeBacon',
      shot: 'sizzle', sfx: 'fireSizzle',
      trailSprite: 'sizzleTrail',       // ember dropped along the flight path
      trailSfx: 'baconTrailBurn',       // soft crackle when a segment kills
      advantage: 'BURNING TRAIL KILLS WHAT WALKS IN',
      drawback:  'SLOW — DIRECT HITS ARE HARD',
      // Note trailColor here is the SHOT's particle colour. The burning ember
      // the rasher drops is its own sprite ('sizzleTrail', above) and its own
      // BACON_TRAIL_TIME — neither is a variant's to touch.
      variants: [
        { id: 'bacon.0', name: 'STREAKY', flavour: 'STILL POPPING FROM THE PAN',
          key: { J: PAL.jamRed, j: PAL.jamLite, b: PAL.crumb, K: PAL.burnt },
          overlay: null,
          shotKey: { J: PAL.jamRed, j: PAL.jamLite, b: PAL.crumb, K: PAL.burnt },
          shotOverlay: null,
          trailColor: PAL.baconPink, sfxDetune: 0 },
        { id: 'bacon.1', name: 'MAPLE GLAZED', flavour: 'SWEET, SALTY, TERMINAL',
          key: { J: PAL.mapleAmber, j: PAL.mapleGloss, b: PAL.mapleFat,
                 K: PAL.burnt },
          overlay: null,
          shotKey: { J: PAL.mapleAmber, j: PAL.mapleGloss, b: PAL.mapleFat,
                     K: PAL.burnt },
          shotOverlay: null,
          trailColor: PAL.mapleGloss, sfxDetune: -90 },
        { id: 'bacon.2', name: 'VEGGIE', flavour: 'NOT BACON. STILL ANGRY.',
          key: { J: PAL.veggieRed, j: PAL.veggiePink, b: PAL.veggieCream,
                 K: PAL.burnt },
          overlay: null,
          shotKey: { J: PAL.veggieRed, j: PAL.veggiePink, b: PAL.veggieCream,
                     K: PAL.burnt },
          shotOverlay: null,
          trailColor: PAL.veggieRed, sfxDetune: 210 }
      ]
    },

    // The exact inverse of the mug: the splash widens from MILK_W_MIN to
    // MILK_W_MAX over MILK_GROW_DIST, so it owns the top rows and whiffs low.
    milk: {
      id: 'milk', char: 'MILK CARTON', blurb: 'PAST ITS DATE',
      weapon: 'SPLASH', wid: 'splash', tagline: 'CALCIUM ENRICHED',
      color: PAL.milkWhite, mech: 'grow',
      speed: 580, w: MILK_W_MIN, h: 16, refire: 0.18, dmg: 3,
      ship: 'milk0', shipFire: 'milk1', life: 'lifeMilk',
      shot: 'splash0', sfx: 'fireSplash',
      // Three sprite widths, picked by how far the splash has grown.
      shotGrow: ['splash0', 'splash1', 'splash2'],
      advantage: 'SPLASH GROWS HUGE AT LONG RANGE',
      drawback:  'TINY UP CLOSE — WEAK WHEN THEY DROP',
      // shotKey covers all three `shotGrow` frames: splash0/1/2 are the same
      // droplet at three widths and share the two map characters W and w.
      // That is also why the carton's variants carry no shotOverlay — one
      // overlay cannot be "the same dimensions" as three different maps.
      variants: [
        { id: 'milk.0', name: 'WHOLE MILK', flavour: 'FULL FAT, FULL SEND',
          key: { W: PAL.wing, w: PAL.wingShade, D: PAL.chromeDk,
                 g: PAL.glassDark, G: PAL.glass, K: PAL.burnt },
          overlay: null,
          shotKey: { W: PAL.wing, w: PAL.wingShade },
          shotOverlay: null,
          trailColor: PAL.milkWhite, sfxDetune: 0 },
        { id: 'milk.1', name: 'LEMONADE', flavour: 'SPARKLING, SLIGHTLY UNHINGED',
          key: { W: PAL.lemonadePale, w: PAL.lemonadeYellow,
                 D: PAL.lemonadeRind, g: PAL.lemonadeBand, G: PAL.lemonadeFizz,
                 K: PAL.burnt, Z: PAL.lemonadeFizz },
          overlay: OV_LEMONADE,
          shotKey: { W: PAL.lemonadePale, w: PAL.lemonadeYellow },
          shotOverlay: null,
          trailColor: PAL.lemonadeYellow, sfxDetune: 240 },
        { id: 'milk.2', name: 'CHOCOLATE', flavour: 'SHAKEN. THEN SHAKEN AGAIN.',
          key: { W: PAL.chocolateLt, w: PAL.chocolate, D: PAL.chocolateDark,
                 g: PAL.chocolateChip, G: PAL.chocolateLt, K: PAL.crumb,
                 X: PAL.chocolateChip },
          overlay: OV_CHOCCHIP,
          shotKey: { W: PAL.chocolateLt, w: PAL.chocolate },
          shotOverlay: null,
          trailColor: PAL.chocolate, sfxDetune: -220 }
      ]
    }
  };

  /** Select-screen carousel order: the two baselines first, then the specials. */
  const CHARACTER_ORDER = ['bread', 'jam', 'croissant', 'mug', 'pepper',
                           'honey', 'cheese', 'bacon', 'milk'];

  /* -------------------------------------------------------------------------
   * CONSTANTS
   * ---------------------------------------------------------------------- */
  const C = {
    // --- screen / timing -------------------------------------------------
    W: 960,
    H: 720,
    FIXED_DT: 1 / 60,

    // --- play-field landmarks (logical px, origin top-left, +y down) ------
    PLAY_TOP: 96,          // below the HUD strip
    PLAY_BOTTOM: 690,      // floor line
    SHIP_Y: 636,           // player sprite top edge
    BUNKER_Y: 548,
    UFO_Y: 108,

    // --- formation -------------------------------------------------------
    COLS: 11,
    ROWS: 5,
    TOTAL_ENEMIES: 55,
    CELL_W: 64,            // formation grid spacing
    CELL_H: 48,
    FORM_START_X: 88,      // left edge of formation cell (0,0)
    FORM_START_Y: 168,
    FORM_STEP_X: 10,       // horizontal px per march step
    FORM_STEP_Y: 26,       // px dropped when hitting a wall
    FORM_MARGIN: 24,       // px from screen edge the formation turns at

    // --- input feel (spec section 5; section 12 wants every tunable here) --
    STICK_DEADZONE: 0.28,  // left-stick dead area, rescaled outside it
    BUTTON_THRESHOLD: 0.5, // analogue triggers count as "down" from here up

    /* --- touch controls (SPEC-TOUCH.md §2, §3 and §4) --------------------
     * The on-screen thumb pad for iPad play. These are CSS pixels, not the
     * game's logical 960x720 pixels: the controls live in the DOM beside the
     * canvas, not on it, because the ship sits at y 636 of 720 and an overlay
     * there would cover the exact thing you are aiming.
     *
     * Touch is an ADDITIONAL input source — it feeds T.Input.setVirtual and
     * changes nothing about keyboard or gamepad play — so none of these
     * numbers is reachable on a desktop that never sees a touchstart.
     */

    // Target sizes. 56 is the smallest comfortable thumb target; FIRE is the
    // button pressed most often and under the most pressure, so it gets 88.
    // HIT_PAD is invisible padding around a control's drawn box, so a thumb
    // that lands slightly off still registers on pointerdown.
    TOUCH_MIN_TARGET: 56,
    TOUCH_FIRE_SIZE: 88,
    TOUCH_HIT_PAD: 12,

    // The reserved control column down each edge of the screen: clamped to
    // TOUCH_COL_VW percent of the viewport width, never narrower than
    // TOUCH_COL_MIN or wider than TOUCH_COL_MAX. The canvas is scaled to fit
    // whatever space is LEFT, which is what keeps the controls off the play
    // field on every iPad size.
    TOUCH_COL_MIN: 96,
    TOUCH_COL_MAX: 190,
    TOUCH_COL_VW: 15,

    // Multi-touch tolerances. SLIDE_TOLERANCE is how far a captured pointer
    // may drift outside a control before that control drops it — generous,
    // because a thumb rolls as it presses, and dropping a held direction is
    // the worst failure this system has. Sliding from one control into
    // another still switches cleanly: the move is re-hit-tested first, and
    // the tolerance only decides when NOTHING is under the finger any more.
    TOUCH_SLIDE_TOLERANCE: 26,

    // Pointer Events on iPadOS report up to 11 concurrent touches; 10 covers
    // two players' hands with room to spare, and caps the tracking table so a
    // pathological gesture cannot grow it without bound.
    TOUCH_MAX_POINTERS: 10,

    // DRAG mode (the alternative to BUTTONS, remembered in localStorage): a
    // pointer that lands on a player's half of the canvas steers their ship by
    // its horizontal delta. Lifting after moving less than TAP_MAX_PX counts
    // as a tap and fires instead. DRAG_SENS is ship travel per unit of finger
    // travel once the canvas scale has been undone — 1 tracks the thumb
    // exactly, a little over 1 so a thumb that starts mid-canvas can still
    // reach both walls without re-gripping. DRAG_SPLIT is the fraction of the
    // canvas width dividing P1's half from P2's; a pointer keeps the player it
    // started under for its whole life, so a drag across the middle never
    // steals the other ship.
    TOUCH_TAP_MAX_PX: 10,
    TOUCH_DRAG_SENS: 1.25,
    TOUCH_DRAG_SPLIT: 0.5,
    TOUCH_MODE_DEFAULT: 'buttons',   // 'buttons' | 'drag'

    // --- player ----------------------------------------------------------
    SHIP_SPEED: 280,       // px/sec at full stick deflection
    SHIP_W: 44,
    SHIP_H: 34,
    SHIP_RESPAWN_DELAY: 1.6,   // seconds of death animation before respawn

    // --- weapons ---------------------------------------------------------
    SHOT_SPEED_BUTTER: 560,
    SHOT_SPEED_JAM: 720,
    MAX_BOMBS: 3,
    BOMB_SPEED_MIN: 190,
    BOMB_SPEED_MAX: 260,
    BOMB_COOLDOWN: 0.55,   // min seconds between enemy bomb drops

    // --- bonus toaster ---------------------------------------------------
    UFO_SPEED: 130,
    UFO_MIN_GAP: 18,       // seconds between UFO passes
    UFO_MAX_GAP: 27,

    // --- progression -----------------------------------------------------
    LIVES: 3,
    EXTRA_LIFE_AT: 1500,

    // --- scoring ---------------------------------------------------------
    SCORE_ROW: [30, 20, 20, 10, 10],   // index = formation row, 0 = top
    UFO_SCORES: [50, 100, 150, 300],

    // --- wing flap ping-pong order, advanced one entry per march step ----
    FRAME_CYCLE: [0, 1, 2, 3, 2, 1],

    /* --- weapon upgrade system ------------------------------------------
     * The crate -> burst -> token -> catch loop from SPEC-WEAPONS.md.
     * A winged utensil drawer sails across the upper play field; two hits
     * burst it into a tumbling weapon token, and catching that token with a
     * ship swaps in an upgrade weapon. Only ONE crate and ONE token exist at
     * a time, so these are board-level tunables, not per-entity ones.
     */
    CRATE_HP: 2,           // shots needed to burst the utensil drawer
    CRATE_SPEED: 96,       // px/sec of horizontal drift across the field
    CRATE_Y_MIN: 150,      // top of the band the crate flies through
    CRATE_Y_MAX: 262,      // bottom of that band
    CRATE_BOB_AMP: 22,     // px of vertical bob around the chosen lane
    CRATE_BOB_HZ: 0.55,    // bob cycles per second

    CRATE_FIRST_GAP: 13,   // seconds into a wave before the first crate
    CRATE_GAP_MIN: 16,     // seconds between crates thereafter
    CRATE_GAP_MAX: 26,
    CRATE_W: 46,
    CRATE_H: 34,

    TOKEN_FALL: 108,       // px/sec the dropped token tumbles down at
    TOKEN_DRIFT: 26,       // px/sec sideways sway amplitude while falling
    TOKEN_SPIN_HZ: 1.1,    // token spin cycles per second
    TOKEN_W: 28,
    TOKEN_H: 28,
    TOKEN_MAGNET: 26,      // extra px of catch radius — generosity, on purpose

    UFO_TOKEN_CHANCE: 0.25,   // odds the Chrome Deluxe also drops a token

    // Syrup trap: the formation's step interval is multiplied by
    // 1 / SYRUP_SLOW_FACTOR while syruped, so it marches 55% slower.
    SYRUP_SLOW_FACTOR: 0.45,
    SYRUP_SLOW_TIME: 6.0,     // seconds a syrup hit keeps the march slowed

    /* --- base weapons / playable characters -----------------------------
     * The nine-character roster (authored above, next to the palette) plus
     * the per-mechanic numbers that make each base weapon shoot differently.
     * SPEC-CHARACTERS.md §2 and §3. Nothing about a character's feel may be
     * a literal in weapons.js, sprites.js or ui.js — it comes from here, so
     * the balance harness can tune the whole roster from one place.
     */
    BASE_WEAPONS: BASE_WEAPONS,
    CHARACTER_ORDER: CHARACTER_ORDER,

    // COFFEE MUG: the drip tracks distance travelled and fizzles out at
    // MUG_RANGE px. It cannot reach the top rows until the formation has
    // descended — and because it dies early, the mug refires sooner.
    MUG_RANGE: 410,
    MUG_FIZZLE_TIME: 0.12,    // seconds the spent drip fizzles before it goes

    // PEPPER GRINDER: one pull spawns PEPPER_PELLETS pellets at
    // -PEPPER_SPREAD_DEG, 0 and +PEPPER_SPREAD_DEG. All are live at once and
    // the one-shot rule counts the VOLLEY, so you refire when the last dies.
    PEPPER_SPREAD_DEG: 9,
    PEPPER_PELLETS: 3,

    // CROISSANT: the flake stores vx = ship.vx * CROISSANT_INHERIT at launch
    // and keeps it for life. Standing still it flies dead straight.
    CROISSANT_INHERIT: 0.45,

    // CHEESE WEDGE: launches at ±CHEESE_ANGLE_DEG, alternating per shot, and
    // reflects off the left/right walls up to CHEESE_BOUNCES times.
    CHEESE_ANGLE_DEG: 14,
    CHEESE_BOUNCES: 1,

    // BACON STRIP: the rasher drops an ember every BACON_TRAIL_GAP px of
    // climb; each ember lives BACON_TRAIL_TIME seconds and kills any toaster
    // that marches into it. BACON_TRAIL_MAX caps the live segments so the
    // trail can never turn into a per-frame allocation problem — at GAP 7 and
    // 460px/s the trail settles around 18 live embers, well inside the cap.
    //
    // GAP is the dial that decides how much of the bacon strip's damage comes
    // off its TRAIL rather than its nose, which is the whole character: it was
    // measured down from 16 to 7 to make "direct hits are hard to land" true
    // (accuracy 61.8% -> 54.5%, against a roster median of 55.0%).
    BACON_TRAIL_TIME: 0.28,
    BACON_TRAIL_GAP: 7,
    BACON_TRAIL_MAX: 40,
    BACON_TRAIL_W: 8,         // ember hitbox, matching the 'sizzleTrail' sprite
    BACON_TRAIL_H: 8,

    // MILK CARTON: the splash's width lerps MILK_W_MIN -> MILK_W_MAX across
    // MILK_GROW_DIST px of travel, and collision uses the CURRENT width.
    MILK_GROW_DIST: 420,
    MILK_W_MIN: MILK_W_MIN,
    MILK_W_MAX: MILK_W_MAX,

    // Select-screen SPEED / SPREAD / REACH bars (SPEC-CHARACTERS.md §4): the
    // value that fills a bar completely, so ui.js normalises against a tunable
    // instead of a magic number. REACH is the climb from the ship to the
    // ceiling (SHIP_Y - PLAY_TOP), i.e. an unlimited-range shot fills the bar.
    CHAR_BAR_SPEED_MAX: 960,
    CHAR_BAR_SPREAD_MAX: 20,
    CHAR_BAR_REACH_MAX: 540,

    PAL: PAL
  };

  /* -------------------------------------------------------------------------
   * SEEDED RNG
   * A 32-bit linear congruential generator (Numerical Recipes coefficients).
   * Deterministic for a given seed so bunker damage / bomb choices can be
   * replayed, but seeded from the clock by default so runs still feel varied.
   * ---------------------------------------------------------------------- */
  let rngState = 0;

  /** Reseed the generator. Any integer works; 0 is remapped so the LCG lives. */
  function seed(n) {
    const s = (n >>> 0);
    rngState = s === 0 ? 0x9e3779b9 : s;
  }

  /** @returns {number} pseudo-random float in [0, 1). */
  function rng() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  seed((Date.now() ^ 0x5f3759df) >>> 0);

  /* -------------------------------------------------------------------------
   * HELPERS
   * ---------------------------------------------------------------------- */

  /** Constrain v to the inclusive range [lo, hi]. */
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /** Linear blend: t = 0 → a, t = 1 → b. Not clamped. */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Move cur toward target by at most maxDelta, never overshooting. */
  function approach(cur, target, maxDelta) {
    const d = target - cur;
    if (d > maxDelta) return cur + maxDelta;
    if (d < -maxDelta) return cur - maxDelta;
    return target;
  }

  /** Random integer in the inclusive range [lo, hi]. */
  function randInt(lo, hi) {
    if (hi < lo) { const t = lo; lo = hi; hi = t; }
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  /** Random float in [lo, hi). */
  function randRange(lo, hi) {
    return lo + rng() * (hi - lo);
  }

  /** Uniformly pick one element of arr (undefined for an empty array). */
  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(rng() * arr.length)];
  }

  /** True with probability p (p <= 0 never, p >= 1 always). */
  function chance(p) {
    return rng() < p;
  }

  /**
   * Seconds between formation march steps — the curve that makes the toasters
   * accelerate as their friends die, exactly as the original arcade board did.
   *
   *   base = 0.032 + 0.86 * ((alive - 1) / 54) ^ 1.45
   *   out  = max(0.028, base * 0.88 ^ min(wave - 1, 6))
   *
   * 55 alive on wave 1 lands near 0.89s; a lone survivor near 0.032s.
   * The normalized term is clamped to [0, 1] so a stray alive count of 0 (or
   * anything above TOTAL_ENEMIES) can never produce NaN mid-wave.
   */
  function stepInterval(alive, wave) {
    const t = clamp((alive - 1) / 54, 0, 1);
    const base = 0.032 + 0.86 * Math.pow(t, 1.45);
    return Math.max(0.028, base * Math.pow(0.88, Math.min(wave - 1, 6)));
  }

  /** Standard axis-aligned bounding-box overlap of two rects. */
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  /** Monotonic-ish clock in SECONDS. */
  const hasPerf = (typeof performance !== 'undefined' &&
                   typeof performance.now === 'function');
  function now() {
    return hasPerf ? performance.now() / 1000 : Date.now() / 1000;
  }

  /* -------------------------------------------------------------------------
   * SAFE STORAGE
   * localStorage throws in private mode and on some file:// configurations,
   * and reads can return junk. Nothing here is ever allowed to break the game.
   * ---------------------------------------------------------------------- */

  /** Read a JSON-encoded value, returning fallback on any problem. */
  function storeGet(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      try {
        return JSON.parse(raw);
      } catch (parseErr) {
        return raw;               // a plain string written by something else
      }
    } catch (err) {
      return fallback;
    }
  }

  /** Write a value as JSON. Returns true if it actually persisted. */
  function storeSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* -------------------------------------------------------------------------
   * OBJECT POOL
   * Keeps the hot loops allocation-free: obtain() recycles a retired object
   * when one is available, release(o) retires it. `items` is the live set and
   * is safe to iterate (release during a reverse loop is the usual pattern).
   * ---------------------------------------------------------------------- */
  function Pool(factory) {
    this.factory = factory;
    this.items = [];   // currently in use
    this.free = [];    // retired, waiting to be recycled
  }

  /** Take a live object from the pool, creating one only when starved. */
  Pool.prototype.obtain = function () {
    const o = this.free.length > 0 ? this.free.pop() : this.factory();
    this.items.push(o);
    return o;
  };

  /** Retire an object. Silently ignores objects that are not live. */
  Pool.prototype.release = function (o) {
    const i = this.items.indexOf(o);
    if (i === -1) return false;
    this.items[i] = this.items[this.items.length - 1];
    this.items.pop();
    this.free.push(o);
    return true;
  };

  /** Retire everything currently live (used on wave / board reset). */
  Pool.prototype.releaseAll = function () {
    for (let i = 0; i < this.items.length; i++) this.free.push(this.items[i]);
    this.items.length = 0;
  };

  /* -------------------------------------------------------------------------
   * EXPORT ONTO THE GLOBAL NAMESPACE
   * ---------------------------------------------------------------------- */
  T.C = C;

  T.Util = {
    clamp: clamp,
    lerp: lerp,
    approach: approach,
    seed: seed,
    rng: rng,
    randInt: randInt,
    randRange: randRange,
    pick: pick,
    chance: chance,
    stepInterval: stepInterval,
    aabb: aabb,
    now: now,
    storeGet: storeGet,
    storeSet: storeSet,
    Pool: Pool
  };

})(window.T = window.T || {});
