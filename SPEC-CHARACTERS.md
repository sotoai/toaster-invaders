# TOASTER INVADERS — 9 PLAYABLE CHARACTERS (spec addendum)

Extends SPEC.md and SPEC-WEAPONS.md. All HARD RULES from SPEC.md section 0 still
apply: classic script tags, no modules, no assets, no deps, `window.T`.

Adds **7 new playable characters** to the existing bread and jam jar, for **9
total**. Each has its own BASE weapon that shoots differently.

## 1. THE BALANCE RULE (this is the whole point — read it twice)

The user's requirement was explicit: **do not make any character too OP.**

The design rule that guarantees it: **every character gets exactly ONE advantage
paired with ONE drawback, and every advantage is CONDITIONAL — situationally
strong, never flatly better.** No character may be a strict upgrade of another.

Concretely, each character must have an obvious *bad* situation:
- COFFEE MUG is lethal but cannot reach the top rows early in a wave.
- MILK CARTON is the exact inverse: superb at range, nearly useless up close.
- PEPPER GRINDER only pays off when the formation is dangerously low.
- HONEY DIPPER shoots through your own cover but is the slowest thing in the game.
- CHEESE WEDGE reaches around bunkers but can never hit the column above you.
- BACON denies area but lands few direct hits.
- CROISSANT curves when you move but cannot shoot straight while moving.
- BREAD and JAM are the two neutral baselines.

**All nine keep the classic ONE-LIVE-SHOT-ON-SCREEN rule.** That constraint is
what keeps the game Space Invaders, and it is the main thing stopping any
character running away with the game. The weapon-upgrade tokens from
SPEC-WEAPONS.md still override the base weapon for everyone, identically.

Balance is not a claim to be asserted — see section 5, it must be MEASURED.

## 2. THE ROSTER

Baseline for comparison: BUTTER = speed 560, hitbox 10x16, refire 0.10s.
`refire` = extra delay after the previous shot dies before you may fire again.

| id | character | weapon | speed | hitbox | refire | ADVANTAGE | DRAWBACK |
|---|---|---|---|---|---|---|---|
| `bread` | UNTOASTED BREAD | BUTTER | 560 | 10x16 | 0.10 | widest plain shot — forgiving aim | middling speed, no trick |
| `jam` | JAM JAR | JAM | 720 | 6x16 | 0.08 | fast shot, quick refire | narrow; punishes sloppy aim |
| `croissant` | CROISSANT | FLAKE | 600 | 8x14 | 0.10 | inherits **45% of ship velocity** — curve shots around cover, lead a moving formation | cannot shoot straight while moving; you must stop to aim true |
| `mug` | COFFEE MUG | DRIP | 920 | 7x14 | 0.05 | **fastest projectile and fastest refire in the game** | **expires after 340px** — cannot reach the top rows until the formation descends |
| `pepper` | PEPPER GRINDER | PEPPER | 500 | 3 pellets, 5x10, ±9° spread | 0.16 | **3 pellets** can kill up to 3 adjacent toasters at close range | at formation range the spread means ~1 pellet lands; slowest refire |
| `honey` | HONEY DIPPER | HONEY | 420 | 7x16 | 0.12 | **passes through bunkers** without damaging them — fire from full cover | **slowest projectile in the game** by a wide margin |
| `cheese` | CHEESE WEDGE | RIND | 540 | 9x14 | 0.10 | fires at **±14°, alternating**, and **bounces off a side wall once** — reach around bunkers into edge columns | **can never hit the column directly above you** |
| `bacon` | BACON STRIP | SIZZLE | 460 | 6x18 | 0.12 | leaves a **0.28s burning trail** that kills toasters marching into it — area denial | very slow; direct hits are hard to land |
| `milk` | MILK CARTON | SPLASH | 580 | **grows** 4x12 → 16x12 over 420px | 0.10 | **huge hitbox at long range** — dominates the top rows | tiny hitbox up close; nearly useless when the formation is low |

Put all nine in a `T.Weapons.BASE` table alongside the existing upgrade roster,
with the same def shape, and rewrite `T.Weapons.baseFor(kind)` to look up this
table instead of its current two-case branch.

New constants belong in `T.C` (a `BASE_WEAPONS` block): every speed, hitbox,
refire, `MUG_RANGE: 340`, `PEPPER_SPREAD_DEG: 9`, `PEPPER_PELLETS: 3`,
`CROISSANT_INHERIT: 0.45`, `CHEESE_ANGLE_DEG: 14`, `CHEESE_BOUNCES: 1`,
`BACON_TRAIL_TIME: 0.28`, `MILK_GROW_DIST: 420`, `MILK_W_MIN: 4`, `MILK_W_MAX: 16`.

## 3. MECHANICS THAT MUST BE REAL

Same rule as the upgrade weapons: a character whose shot is secretly a recoloured
butter shot is a failure of this spec.

- `croissant` — the shot stores `vx = ship.vx * T.C.CROISSANT_INHERIT` at launch and
  keeps it for life. Standing still it flies straight; moving, it visibly curves.
- `mug` — the shot tracks distance travelled and dies at `MUG_RANGE`, with a
  visible fizzle. Because it dies early, the ship refires sooner: this is the
  advantage AND the drawback in one number.
- `pepper` — one trigger pull spawns 3 pellets at −9°, 0°, +9°. All three are
  live simultaneously and the one-shot rule counts the *volley*, not the pellets:
  you refire when all three are gone.
- `honey` — `rectHitsBunker` is skipped for this shot, and it does NOT call
  `damageBunker`. It still collides with toasters, bombs and the UFO normally.
- `cheese` — launches at ±`CHEESE_ANGLE_DEG` alternating per shot, and reflects off
  the left/right walls up to `CHEESE_BOUNCES` times.
- `bacon` — as it travels it drops short-lived trail segments into a per-board
  list; a segment kills any toaster whose box overlaps it, then expires. Cap the
  segment count so the trail cannot become a per-frame allocation problem.
- `milk` — the shot's `w` is interpolated from `MILK_W_MIN` to `MILK_W_MAX` across
  `MILK_GROW_DIST`, and the collision box uses the CURRENT width, not the launch
  width. The sprite scales with it.

Every base shot still: dies on hitting a toaster, can destroy an enemy bomb,
damages bunkers (except honey), and respects the one-live-shot rule.

## 4. SPRITES, UI, AUDIO

**Sprites** (js/sprites.js, same pixel-map pipeline, sizes are post-scale logical px):

    characters, 2 frames each (idle / firing recoil), all 44 x 34:
      'croissant0','croissant1'  a buttery crescent with a face, flaky layers
      'mug0','mug1'              a chipped diner mug, steam curl, coffee inside
      'pepper0','pepper1'        a tall pepper grinder, wooden body, dome cap
      'honey0','honey1'          a honey dipper with a jar, golden drip
      'cheese0','cheese1'        a wedge of cheese with holes and a rind edge
      'bacon0','bacon1'          a wavy rasher, streaky fat and meat bands
      'milk0','milk1'            a milk carton, folded top, spout, dairy label
    Every character needs a FACE with real personality, matching the existing
    bread and jam jar. Read those two maps first and match their eye/brow style
    and level of detail exactly — the roster must look like one family.

    projectiles:
      'flake'        8 x 14   a flaky pastry shard
      'drip'         7 x 14   a hot coffee droplet with a steam wisp
      'pepperPellet' 5 x 10   a black peppercorn
      'honeyDrop'    7 x 16   a viscous golden bead with a drip tail
      'rind'         9 x 14   a small cheese wedge, spinning
      'sizzle'       6 x 18   a curling bacon strip with heat shimmer
      'sizzleTrail'  8 x  8   a fading ember for the trail segments
      'splash0'      4 x 12   milk splash, narrow (launch)
      'splash1'     10 x 12   milk splash, mid
      'splash2'     16 x 12   milk splash, wide (max range)

    life icons, 22 x 17 each, matching the existing lifeBread / lifeJam style:
      'lifeCroissant','lifeMug','lifePepper','lifeHoney','lifeCheese',
      'lifeBacon','lifeMilk'

**UI** (js/ui.js) — the select screen currently toggles between two characters.
Rebuild it as a **9-character carousel**: left/right (stick, D-pad, or A/D and
arrows) browses; Y also cycles; A readies up. For the highlighted character show:
a large preview, its NAME, its WEAPON name, and — this matters for the balance to
be legible — a two-line readout of its **ADVANTAGE** and **DRAWBACK** in plain
words, plus small SPEED / SPREAD / REACH bars. Both players browse independently
and may pick the same character (visually distinguish P2 with the existing p2
accent tint). Keep the mode selector and the READY stamps. Do not let the panel
grow past the play area; nine characters must fit without crowding.

Also: the HUD life icons and the weapon chip must use the correct per-character
icon and base-weapon name for all nine.

**Audio** (js/audio.js) — one distinct fire sound per new character, in the
existing synthesis style: `fireFlake` (a dry crumbly snap), `fireDrip` (a short
hot hiss + ceramic tick), `firePepper` (a triple grinder-crunch, one per pellet),
`fireHoney` (a thick slow glug, lower than the syrup upgrade's), `fireRind` (a
waxy thunk with a spin whirr), `fireSizzle` (a fatty pan sizzle), `fireSplash`
(a wet carton glug that opens up). Plus `baconTrailBurn`, a soft crackle when a
trail segment kills. Keep them short and mixed so nothing clips.

## 5. THE BALANCE MUST BE MEASURED, NOT ASSERTED

A dedicated harness has to prove no character is overpowered. Write
`character-balance.js` in the scratchpad. It must:

- Drive a scripted **competent bot player** — one that tracks the lowest live
  toaster, moves toward its column, fires whenever its weapon allows, and dodges
  a bomb when one is within a threshold. The SAME bot for every character, so the
  only variable is the weapon.
- Run every one of the 9 characters through **identical seeded waves** (at least
  30 runs each across a fixed seed set, no upgrade tokens, so base weapons are
  isolated).
- Measure per character: mean time to clear wave 1, mean waves survived, mean
  shots fired per kill, and mean accuracy.
- **Assert every character's mean time-to-clear and mean waves-survived land
  within ±20% of the roster median.** Any character outside that band is
  over- or under-powered and its numbers in `T.C.BASE_WEAPONS` must be tuned and
  the harness re-run until the whole roster is inside the band.
- Separately assert **no character is a strict superset of another**: for every
  pair, each must beat the other on at least one measured metric.

Report the actual measured table. Tune the numbers, never the assertions.

## 6. COMPATIBILITY

- Upgrade weapons from SPEC-WEAPONS.md are unchanged and shared by all nine
  characters; picking up a token overrides the base weapon and running out
  reverts to that character's own base via `T.Weapons.baseFor`.
- Saved high scores, both game modes, and all existing flows must keep working.
- `ship.kind` is now one of the nine ids. Anywhere the old code branched on
  `'bread'` vs `'jam'`, it must go through the roster table instead.
