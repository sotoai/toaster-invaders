# TOASTER INVADERS

**Space Invaders, except the invaders are the After Dark flying toasters and you are breakfast.**

Fifty-five winged chrome toasters march down the screen. You are a slice of untoasted
bread, or a jam jar, or a coffee mug, or one of six other things off the breakfast
table, and you have three lives and one shot on screen at a time to stop them.

No install, no download, no plugin, no account. It is one HTML file and ten scripts.
Every sprite is a hand-authored pixel map rasterized in your browser at boot, and
every sound is synthesized with WebAudio on the spot — there is not a single image
or audio file in the repo.

---

## Play it

**Locally, the lazy way:** double-click `index.html`. The game runs from `file://` —
there are no ES modules, no `fetch()`, and no assets to load, so nothing is blocked
by the file protocol.

**Locally, over HTTP** (identical, and what a deploy looks like):

```sh
cd toaster-invaders
python3 -m http.server 8000
# then open http://localhost:8000/
```

Anything that serves a directory works — `npx serve`, `php -S`, `ruby -run -e httpd`.
There is no build step to run first, because there is no build step.

**On the web:** the repo *is* the site. Push it and turn on GitHub Pages (deploy from
a branch, folder `/`). Every path in the HTML, the CSS and the JS is relative, so it
works from a project subpath like `https://you.github.io/toaster-invaders/` as well as
from a domain root. `.nojekyll` at the root stops GitHub running Jekyll over the files.

---

## Controls

Touch, keyboard and gamepad are all live at once and they merge. Plugging in a
controller does not take the keyboard away; picking up a keyboard does not take the
touch controls away. On an iPad you can play with two thumbs while a friend uses a
paired Xbox pad.

### Touch (iPad, iPhone, any touchscreen)

The on-screen controls appear the first time the device reports touch support. They
sit in reserved columns down **either side of the canvas**, never on top of it — your
ship lives near the bottom of the play field and a button over it would cover the one
thing you are aiming.

| Control | What it does |
|---|---|
| `◀` `▶` | Move |
| `FIRE` | Fire |
| `START` | Start, pause, and on the select screen cycle your variant |
| `BACK` | Back out |
| `P2` | Second player joins (right column, one-player layout only) |
| `BUTTONS` / `DRAG` | Switch control mode |
| `?` | Show or hide the controls help |

**One player** gets the comfortable phone layout: arrows in the left column, a big
`FIRE` in the right. **When P2 joins**, both columns become compact clusters —
`FIRE` above, `◀ ▶` beneath — so each player owns one edge of the device.

**DRAG mode** is the alternative: slide anywhere on your half of the screen to steer,
and a tap that barely moves fires. Both players can drag at once; a finger belongs to
whichever half of the canvas it landed in, for as long as it is down. The mode is
remembered between sessions and is also shown in the pause menu.

Landscape only. In portrait the game puts up a rotate prompt and pauses.

### Keyboard

| | Move | Fire | Start / Pause | Back |
|---|---|---|---|---|
| **P1** | `A` `D` | `Space` or `W` | `Enter` | `Esc` |
| **P2** | `←` `→` | `↑` or `/` | `Right Shift` | `Backspace` |

The whole game — title to game over, both modes, both players — is playable on the
keyboard alone.

### Xbox controller (and anything the Gamepad API reports as standard)

| Control | What it does |
|---|---|
| Left stick / D-pad | Move; left and right browse the nine characters on the select screen |
| `A`, `X`, `RT`, `RB` | Fire, confirm, ready up |
| `Start` | Start, pause, and cycle your variant on the select screen |
| `Y` | Step to the next character |
| `B`, `View` | Back out |

Browsers do not report a gamepad until it sends input, so **press a button on each
controller** to wake it up. The title screen shows which pads it can see.

Gamepads work on iPadOS too — Safari supports the Gamepad API for MFi, Xbox and
DualSense pads.

---

## The nine characters

Every character has **exactly one advantage and exactly one drawback**, and every
advantage is conditional — situationally strong, never flatly better. No character is
an upgrade of another, and all nine keep the classic one-live-shot-on-screen rule.
Balance is measured, not asserted: a harness runs all nine through identical seeded
waves and requires each to land within ±20% of the roster median.

| Character | Weapon | Advantage | Drawback |
|---|---|---|---|
| **Untoasted Bread** | BUTTER | Widest shot — forgiving aim | Middling speed, no tricks |
| **Jam Jar** | JAM | Fast shot, quick refire | Narrow — punishes sloppy aim |
| **Croissant** | FLAKE | Curves with your ship — lead them | Cannot shoot straight while moving |
| **Coffee Mug** | DRIP | Fastest shot and refire in the game | Fizzles out short — no top rows early |
| **Pepper Grinder** | PEPPER | Three pellets — shreds up close | The spread wastes itself at range |
| **Honey Dipper** | HONEY | Shoots straight through your own bunkers | Slowest projectile in the game |
| **Cheese Wedge** | RIND | Angled, and bounces off a side wall | Never hits the column above you |
| **Bacon Strip** | SIZZLE | Burning trail kills what marches into it | Slow — direct hits are hard |
| **Milk Carton** | SPLASH | Splash grows huge at long range | Tiny up close — weak when they drop |

Coffee Mug and Milk Carton are deliberate mirror images: one is lethal only when the
formation has come down to you, the other only while it is still high.

## The 27 variants

Each character has **three variants**, for 27 playable versions. A variant is
**purely cosmetic** — it changes the name, the palette, a little sprite detail, the
projectile's colour and the timbre of the fire sound. It never touches speed, hitbox,
refire, range, pellet count, bounces, growth or trail time. That is enforced by a test
that fires every variant from an identical position on an identical seeded board and
requires bit-identical trajectories.

Cosmetic variants inherit their character's measured balance exactly, which is the
whole point: nine characters to balance, not twenty-seven.

| Character | Variant 1 | Variant 2 | Variant 3 |
|---|---|---|---|
| Untoasted Bread | BUTTER | GARLIC BUTTER | CINNAMON SUGAR |
| Jam Jar | STRAWBERRY | PEANUT BUTTER | MARMALADE |
| Croissant | CLASSIC | ALMOND | PAIN AU CHOCOLAT |
| Coffee Mug | BLACK COFFEE | LATTE | MATCHA |
| Pepper Grinder | BLACK PEPPER | CHILLI FLAKES | SEA SALT |
| Honey Dipper | WILDFLOWER | AGAVE | MOLASSES |
| Cheese Wedge | CHEDDAR | SWISS | BLUE |
| Bacon Strip | STREAKY | MAPLE GLAZED | VEGGIE |
| Milk Carton | WHOLE MILK | LEMONADE | CHOCOLATE |

On the select screen, left and right browse the nine characters and **START** cycles
the highlighted one's three variants. Both players choose independently and may pick
the same character — if you do, the second player is bumped to a different skin
automatically so you can still tell your ships apart. Your last pick is remembered.

---

## The weapon-drop loop

Every so often a **winged utensil drawer** sails across the upper play field with
cutlery rattling out of it. That is the loop:

> **shoot the drawer twice → it bursts → a weapon token tumbles down → catch it with
> your ship → chaos**

Miss the token and it hits the floor and is gone. In two-player, either ship can catch
any token and first one there wins it. The bonus toaster — the **Chrome Deluxe**, a
side-profile chrome monster that streaks across the top — sometimes drops one too.

An upgrade **lifts the one-shot-on-screen rule** and fires on a cooldown instead. It
is finite: when the ammo or the timer runs out you revert to your character's own base
weapon. You **keep** an upgrade across a wave change and **lose** it when you die.

The fifteen upgrades, each with a mechanic that is actually implemented — none of them
is a recoloured basic shot:

| Weapon | What it does |
|---|---|
| **BUTTER KNIVES** | Spinning knives that pierce — one shot kills everything in the column |
| **SPAGHETTI GUN** | A limp noodle that whips side to side as it climbs, killing what it crosses |
| **TOAST CANNON** | Lobs a slice on an arc; it detonates into six crumbs of radial shrapnel |
| **CEREAL SCATTERGUN** | Seven cereal loops in a wide fan |
| **ESPRESSO REPEATER** | Machine-gun scalding beans, tiny and relentless |
| **HOMING CRUMPETS** | Crumpets that seek the nearest living toaster |
| **MEGA JAM MORTAR** | A fat glob that splatters, taking out clusters |
| **PANCAKE FRISBEE** | Flat pancakes that ricochet off the side walls |
| **BLENDER BLADE** | Flies up, stalls, and boomerangs back down to you — kills both ways |
| **KETCHUP & MUSTARD** | Twin diagonal streams, alternating red and yellow |
| **BAGUETTE LANCE** | A giant bread stick that extends upward and clears the whole column |
| **MICROWAVE RAY** | Hold to fire a continuous humming beam; contact kills after a moment |
| **SYRUP TRAP** | On any hit, the entire formation's march slows to a crawl |
| **SOGGY BREAD** | The gag. Limp bread that arcs and falls short. Genuinely useless |
| **THE FULL BREAKFAST** | The jackpot — knives, spaghetti, crumpets and espresso, all at once |

---

## The two game modes

Pick the mode on the select screen with **up / down**.

- **CO-OP** (default) — both ships on one board at the same time, with separate scores
  and separate lives. A player who runs out sits and watches; the board ends when both
  are out.
- **CLASSIC** — the faithful alternating-turns arcade behaviour. Each player gets their
  own board and their own wave counter, and play swaps to the other player on death.

One player is just co-op with a single ship, and is fully supported. Player two joins
on the select screen — press START or FIRE on a second pad, use the P2 keyboard
bindings, or tap the on-screen **P2** button — and can drop out again with BACK.

Three lives, an extra life at 1,500 points, and a high score that persists in
`localStorage`. Toasters reaching the bunker line ends the board immediately.

---

## Notes for iPad and iPhone

**No sound?** iOS routes Web Audio through the **physical silent switch**. If your iPad
or iPhone is on silent, the game is silent — that is an iOS platform behaviour, not a
bug in the game and not something a web page can override. Flick Ring/Silent on, or
turn off Silent Mode in Control Centre. Audio also cannot start until you touch the
screen once, which is a browser rule everywhere, not just on iOS.

**Play it full screen.** In a Safari tab the toolbar eats a third of a phone in
landscape. Tap **Share → Add to Home Screen** and launch it from there: it opens
full-bleed with its own icon, and the game paints into the safe area properly.

---

## How it is built

Vanilla JavaScript with **no dependencies at all**. No npm, no bundler, no framework,
no CDN, no polyfill, no external font, no image file, no audio file. Classic
`<script>` tags — not modules — which is why it runs from `file://`.

- **Every sprite** is authored as a pixel map (arrays of equal-length strings, one
  character per pixel, keyed to a palette) and rasterized once at boot into offscreen
  canvases, then blitted. The 27 variants are palette swaps and small overlay maps over
  those same maps, not 54 hand-drawn sprites.
- **Every sound** is synthesized with WebAudio — the iconic four-note descending march
  that speeds up as toasters die, a metallic *ding* like toast popping when one bursts,
  and a distinct fire sound per weapon and per variant.
- **The background** is the screensaver it is descended from: a night-sky gradient, a
  three-layer parallax starfield, and winged slices of toast drifting past behind the
  play field on every screen.
- The game runs on a **fixed 1/60 s timestep** with an accumulator, at a logical
  960×720 that is letterboxed and pixel-scaled to whatever window it is given.
- Everything hangs off one global, `window.T`, and every number that tunes how the game
  feels lives in `T.C`.

```
index.html
css/style.css
js/util.js      T.C, T.Util          constants, palette, RNG, pools, storage
js/audio.js     T.Audio              WebAudio synthesis
js/input.js     T.Input              keyboard, Gamepad API, virtual pad
js/touch.js     T.Touch              on-screen controls, feeds the virtual pad
js/sprites.js   T.Sprites            pixel maps, rasterizer, variant palettes
js/entities.js  T.Entities           entities, pools, pixel-accurate bunkers
js/weapons.js   T.Weapons            base weapons, upgrades, crates, tokens
js/game.js      T.Game               state machine, waves, collisions, scoring
js/ui.js        T.UI                 title, select, HUD, banners, scanlines
js/main.js      boot                 fixed-timestep loop, letterboxing, resize
favicon.svg, apple-touch-icon.png    generated from the game's own toaster sprite
```

Touch is an **additional** input source and never a replacement: `js/touch.js` renders
DOM controls and feeds presses into a virtual pad inside `T.Input`, which merges them
with the keyboard and the gamepad before edge detection. Nothing downstream of
`T.Input` knows touch exists, and keyboard and gamepad play is unchanged by it.

The two icons are generated from the game's own sprite pipeline — the toaster on them
is the real `toastB0` sprite, rasterized headlessly and encoded straight to PNG and SVG,
so the tab icon and the home-screen icon can never drift from the art in the game.

The design docs — `SPEC.md`, `SPEC-WEAPONS.md`, `SPEC-CHARACTERS.md`,
`SPEC-VARIANTS.md`, `SPEC-TOUCH.md` — are the authoritative contract for all of the
above and are kept in the repo.

---

*A love letter to After Dark's Flying Toasters and to Tomohiro Nishikado. Not
affiliated with either.*
