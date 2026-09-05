# TOASTER INVADERS — WEAPON UPGRADE SYSTEM (spec addendum)

Extends SPEC.md. Everything in SPEC.md section 0 (HARD RULES) still applies:
classic script tags, no modules, no assets, no deps, `window.T` namespace.

New load order in index.html (weapons.js slots in AFTER entities, BEFORE game):

    util → audio → input → sprites → entities → **weapons** → game → ui → main

## 1. THE LOOP

A **winged utensil drawer** — an After Dark-style flying kitchen drawer with
cutlery rattling out of it — periodically sails across the upper play field.
Shoot it twice and it bursts, dropping a spinning **weapon token** that tumbles
down the screen. **Catch the token with your ship** to equip that weapon. Let it
hit the floor and it is gone.

That is the whole loop: crate → burst → token → catch → chaos.

- Tokens show the weapon's icon and colour while falling, so you can decide
  whether it is worth leaving cover for.
- In 2-player, **either** ship can catch any token. First one there wins it.
  This is the good kind of arguing.
- Catching a token replaces your current weapon outright at full ammo.
- Upgrades are finite. When ammo (or duration) runs out you revert to your
  character's base weapon — butter for bread, jam for the jam jar.

## 2. CRATE + TOKEN CONSTANTS (add to T.C)

    CRATE_HP: 2
    CRATE_SPEED: 96
    CRATE_Y_MIN: 150, CRATE_Y_MAX: 262
    CRATE_BOB_AMP: 22, CRATE_BOB_HZ: 0.55
    CRATE_FIRST_GAP: 13          // seconds into a wave before the first crate
    CRATE_GAP_MIN: 16, CRATE_GAP_MAX: 26
    CRATE_W: 46, CRATE_H: 34

    TOKEN_FALL: 108              // px/sec
    TOKEN_DRIFT: 26              // px/sec sideways sway amplitude
    TOKEN_SPIN_HZ: 1.1
    TOKEN_W: 28, TOKEN_H: 28
    TOKEN_MAGNET: 26             // extra px of catch radius, generosity

    UFO_TOKEN_CHANCE: 0.25       // chance the Chrome Deluxe drops a token
    SYRUP_SLOW_FACTOR: 0.45      // formation march multiplier while syruped
    SYRUP_SLOW_TIME: 6.0

Only ONE crate and ONE token may exist at a time.

## 3. WEAPON ROSTER

Fields: `id`, `name` (HUD, uppercase), `tagline` (shown on pickup), `color`,
`ammo` OR `duration`, `fireDelay` (seconds), `mechanic`, `weight` (drop odds).

Base weapons — infinite, and keep the classic **one live shot on screen** rule:

    butter   BUTTER        base for bread   speed 560, hitbox 10x16
    jam      JAM           base for jar     speed 720, hitbox 6x16

**Upgrades lift the one-shot rule** — they fire on `fireDelay` instead.

| id | NAME | mechanic | ammo/dur | fireDelay | weight |
|---|---|---|---|---|---|
| `butterKnife` | BUTTER KNIVES | spinning knives that **pierce** — one shot kills every toaster in its path, top to bottom | 14 | 0.28 | 12 |
| `spaghetti` | SPAGHETTI GUN | a long limp noodle that travels up **whipping side to side** in a sine wave, killing anything it crosses | 18 | 0.30 | 11 |
| `toastCannon` | TOAST CANNON | lobs a whole slice on an **arc**; on impact it detonates into 6 crumb shrapnel in a radial burst | 8 | 0.55 | 10 |
| `scattergun` | CEREAL SCATTERGUN | 7 cereal loops in a 55° **fan** | 12 | 0.50 | 11 |
| `espresso` | ESPRESSO REPEATER | **machine-gun** scalding coffee beans, tiny and relentless | 60 | 0.07 | 10 |
| `crumpet` | HOMING CRUMPETS | crumpets that **seek** the nearest living toaster | 16 | 0.35 | 9 |
| `megaJam` | MEGA JAM MORTAR | a fat glob that **splatters** in a 70px radius, taking out clusters | 6 | 0.70 | 8 |
| `pancake` | PANCAKE FRISBEE | flat pancakes that **ricochet off the side walls** up to 4 times | 10 | 0.40 | 8 |
| `blender` | BLENDER BLADE | a blade that flies up, stalls, and **boomerangs back down** to you, killing both ways | 8 | 0.60 | 7 |
| `condiments` | KETCHUP & MUSTARD | **twin diagonal streams** at ±22°, alternating red and yellow | 30 | 0.16 | 9 |
| `baguette` | BAGUETTE LANCE | a giant bread stick **extends upward** over 0.35s, clearing the entire column, then retracts | 5 | 1.00 | 6 |
| `microwave` | MICROWAVE RAY | hold to fire a **continuous humming beam**; anything in it dies after 0.22s of contact | 7.0s | — | 6 |
| `syrup` | SYRUP TRAP | a slow blob; on any hit the **whole formation's march slows 55%** for 6s | 5 | 0.80 | 6 |
| `soggy` | SOGGY BREAD | the gag. Limp bread that **arcs and falls short**, barely clearing the bunkers. Genuinely useless. Burns off fast. | 6 | 0.40 | 4 |
| `fullEnglish` | THE FULL BREAKFAST | the jackpot — fires **butter knives, spaghetti, crumpets and espresso simultaneously** | 6.0s | 0.10 | 3 |

Taglines are shown as a banner for 1.4s on pickup. Write them funny and short,
e.g. SPAGHETTI GUN → "AL DENTE, AL DEADLY". SOGGY BREAD → "...oh no." THE FULL
BREAKFAST → "EVERYTHING, ALL AT ONCE."

Balance intent: an upgrade should clear roughly a third to a half of a wave.
Do not make upgrades so strong the base game stops mattering — the classic
formation pressure is still the point.

## 4. MODULE CONTRACT (js/weapons.js — T.Weapons)

    T.Weapons.LIST                       // array of weapon defs, in table order
    T.Weapons.byId(id)                   // → def, throws on unknown id
    T.Weapons.baseFor(kind)              // 'bread'→'butter', 'jam'→'jam'
    T.Weapons.equip(ship, id)            // ship.weapon = {def, ammo, timer, cooldown, phase}
    T.Weapons.tick(ship, dt)             // decay duration/cooldown; auto-revert when spent
    T.Weapons.canFire(ship, board)       // → bool (respects one-shot rule for base weapons)
    T.Weapons.fire(ship, board)          // push projectiles into board.shots, spend ammo, play sfx
    T.Weapons.updateShot(shot, dt, board)      // → bool alive; per-mechanic motion
    T.Weapons.onHit(shot, target, board)       // → 'consume' | 'pierce'  (target: enemy|ufo|crate|bunker)
    T.Weapons.renderShot(ctx, shot)
    T.Weapons.rollDrop()                 // → weapon id, weighted by `weight`
    T.Weapons.ammoFraction(ship)         // → 0..1 for the HUD bar

    T.Weapons.makeCrate(dir)             // dir −1|+1
    T.Weapons.updateCrate(crate, dt, board)    // → bool alive
    T.Weapons.hitCrate(crate, board)     // → bool burst (spawns the token via board)
    T.Weapons.renderCrate(ctx, crate)

    T.Weapons.makeToken(x, y, weaponId)
    T.Weapons.updateToken(token, dt, board)    // → bool alive
    T.Weapons.renderToken(ctx, token)

Projectiles all live in the existing `board.shots` array and all carry
`shot.wid` (weapon id) so `updateShot`/`renderShot` can dispatch. Attached
weapons (`microwave` beam, `baguette` lance) are shots with `shot.attached = true`
that track `ship.x` and are killed when the fire button releases or duration ends.

`fullEnglish` fires one projectile of each of butterKnife / spaghetti / crumpet /
espresso per volley — implement it as a composite that delegates to the others,
not as a copy-paste of four mechanics.

Pooling: reuse the `T.Util.Pool` from util.js. No per-frame allocation in
`updateShot`.

## 5. GAME.JS INTEGRATION (js/game.js changes)

Board gains: `crate` (or null), `token` (or null), `crateT` (spawn timer),
`slowT` (syrup remaining). Ship gains: `weapon` (see equip), `fireHeld`.

- Formation step interval is multiplied by `1 / SYRUP_SLOW_FACTOR` while
  `slowT > 0` (i.e. it marches slower). Show it visually — tint syruped toasters.
- Crate spawn timer runs only in `play`. Alternates entry side.
- Collision additions, inserted into the existing ordered list:
    shot × crate     → `hitCrate`; on burst spawn a token at the crate's centre
    shot × enemy     → consult `T.Weapons.onHit` for whether the shot survives
                       (pierce) or dies (consume)
    ship × token     → equip, banner, sfx; token consumed
    token × floor    → token lost, sad clang
- UFO death rolls `UFO_TOKEN_CHANCE` for a bonus token.
- Ships must drop back to their base weapon on death and on wave start? **No** —
  keeping your weapon through a wave transition feels much better. Keep it on
  wave change, LOSE it on death (that is the cost of dying).

## 6. SPRITES (js/sprites.js additions)

Same pixel-map pipeline, SCALE 2, sizes are post-scale logical px.

    'crate0','crate1'    46 x 34   winged utensil drawer, 2 wing beats: a wooden
                                   drawer front with a handle, cutlery (knife,
                                   fork, spoon) poking out the top, small wings
    'crateHit'           46 x 34   same but dented, splintered, one wing bent
    'tokenShell'         28 x 28   a chrome-rimmed roundel the icon sits inside
    'icon_<id>'          16 x 16   ONE per weapon id in the roster (15 of them):
                                   butterKnife, spaghetti, toastCannon, scattergun,
                                   espresso, crumpet, megaJam, pancake, blender,
                                   condiments, baguette, microwave, syrup, soggy,
                                   fullEnglish. Each must be readable at a glance
                                   as the thing it is.
    projectiles:
    'wKnife0','wKnife1'  14 x 14   butter knife, 2 spin frames
    'wNoodle'             8 x 22   a wobbling spaghetti strand
    'wToast'             18 x 16   a tumbling slice
    'wCrumb'              6 x 6    shrapnel
    'wLoop'              10 x 10   a cereal loop
    'wBean'               6 x 8    a coffee bean
    'wCrumpet'           16 x 14   a crumpet with holes
    'wPancake0','wPancake1' 20x10  a pancake, 2 spin frames
    'wBlade0','wBlade1'  20 x 20   a blender blade, 2 spin frames
    'wJamGlob'           18 x 18   a fat jam glob
    'wSyrup'             14 x 18   a syrup blob with a drip
    'wKetchup','wMustard' 8 x 12   condiment squirts
    'wSoggy'             16 x 12   a limp, drooping slice
    'wBaguette'          18 x 24   one tileable segment of baguette lance
    'wBaguetteTip'       18 x 14   its pointed tip

The microwave beam is drawn procedurally (a shimmering vertical gradient column
with animated scan bands), not from a sprite.

## 7. AUDIO (js/audio.js additions)

New names, all synthesized, all distinct:

    'crateHit'    wooden thunk with a cutlery rattle
    'crateBurst'  splintering wood + a cascade of clattering cutlery
    'tokenDrop'   a bright descending twinkle
    'tokenGrab'   a big rising power-up flourish — the best sound in the game
    'tokenLost'   a sad dropped-cutlery clang
    'weaponOut'   a soft deflating blip when ammo runs dry
    'jackpot'     a full fanfare, only for THE FULL BREAKFAST

Per-weapon fire sounds — each should be recognisable with your eyes shut:
    'fireKnife'   a sharp metallic whirring spin
    'fireNoodle'  a wet floppy whip
    'fireToast'   a hollow cannon thump
    'fireScatter' a dry cereal-pour shotgun blast
    'fireEspresso' a hissing steam tick (very short — it fires 14x/sec)
    'fireCrumpet' a soft doughy poot with a rising seek tone
    'fireMegaJam' a deep gloopy mortar launch
    'firePancake' a flat slapping frisbee whirr
    'fireBlender' a rising motor whine
    'fireCondiment' a rude squeezy-bottle parp
    'fireBaguette' a crusty extending creak
    'fireSyrup'   a thick slow glug
    'fireSoggy'   a pathetic damp flop
    'microwaveHum' LOOPING — starts/stops with the beam; must not leak nodes
    'shrapnel'    the toast cannon's airburst

`espresso` fires ~14 times a second, so `fireEspresso` must be under 60ms and
mixed low or it will turn into a wall of noise. Consider round-robin detuning so
it does not sound like a machine gun stuck on one pitch.

## 8. UI (js/ui.js additions)

    T.UI.renderWeaponChip(ctx, ship, x, y, align)
        Under that player's score in the HUD: the weapon icon, its NAME in the
        weapon's colour, and an ammo/duration bar. Bar flashes red under 25%.
        Base weapons show an infinity glyph instead of a bar.

    T.UI.renderPickupBanner(ctx, board)
        On pickup, 1.4s centre banner: big weapon NAME + its tagline, in the
        weapon's colour, with a quick scale-in pop. Show which player got it.

    T.UI.renderTokenLabel(ctx, token)
        A small name tag under a falling token so players can see what it is.

Also add the weapon roster to the title screen's attract loop: cycle through a
few weapon icons + names under the scoring table so players know upgrades exist.

## 9. QUALITY BAR

- Every one of the 15 weapons must actually implement its stated mechanic. A
  weapon that is secretly just a reskinned base shot is a failure of this spec.
- 60fps with a full formation, espresso repeater firing, and particles.
- No leaked audio nodes across repeated microwave beam start/stops.
- Weapons must work identically for both players simultaneously, with no shared
  mutable state between the two ships.
