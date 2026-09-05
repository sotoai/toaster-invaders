# TOASTER INVADERS — BUILD SPEC (authoritative contract)

A faithful Space Invaders clone. Enemies are **toasters**. The player is an
**untoasted slice of bread** (shoots **butter**) or a **jam jar** (shoots **jam**),
chosen at a character-select screen. **Two-player local**, driven by **Xbox
controllers** via the Gamepad API. Runs as a plain HTML site.

## 0. HARD RULES (violating any of these breaks the build)

1. **No build step, no bundler, no npm, no frameworks, no external assets.**
   All art is drawn procedurally to canvas. All audio is synthesized with WebAudio.
   No image/audio/font files. No CDN links.
2. **Classic `<script>` tags only — NOT `type="module"`.** The game must run by
   double-clicking `index.html` from `file://`. Therefore: no `import`/`export`,
   no `fetch()`, no ES-module syntax at top level.
3. Every file attaches to the single global namespace `window.T`.
   Start every JS file with `(function (T) { 'use strict'; ... })(window.T = window.T || {});`
4. **Own only your assigned files.** Never edit a file another agent owns.
5. Modern JS (const/let, arrow fns, classes, template literals) is fine — it is
   only the *module system* that is banned.
6. Code must be readable: no minification, meaningful names, comments where
   non-obvious. Match the style of the other files.

## 1. FILE LAYOUT & LOAD ORDER

index.html loads, in this exact order:

    css/style.css
    js/util.js      → T.C, T.Util
    js/audio.js     → T.Audio
    js/input.js     → T.Input
    js/sprites.js   → T.Sprites
    js/entities.js  → T.Entities
    js/game.js      → T.Game
    js/ui.js        → T.UI
    js/main.js      → boot (no exports)

A later file may call into any earlier file at RUNTIME. It must not read an
earlier file's values at LOAD time except `T.C` and `T.Util` (those are ready
immediately). `game.js` may reference `T.UI` inside functions even though ui.js
loads after it — that is fine, it resolves at call time.

## 2. COORDINATE SYSTEM & RENDERING

- Logical resolution: **960 x 720**. All gameplay math is in logical pixels.
- One `<canvas id="screen" width="960" height="720">`.
- CSS scales the canvas to fit the window preserving aspect ratio, letterboxed
  on black, with `image-rendering: pixelated`. The canvas 2D context must have
  `imageSmoothingEnabled = false`.
- Origin top-left, +y down.
- Retro pixel look. Sprites are built once at boot into offscreen canvases from
  pixel maps, then blitted — never re-drawn path-by-path each frame.
- **Background = After Dark night sky.** A vertical gradient from `PAL.sky` to
  `PAL.skyDeep`, a slow parallax starfield (3 depth layers, ~70 stars, wrapping),
  and occasional ambient winged `toastFly` slices drifting right-to-left BEHIND
  the play field at low opacity. This background is owned by `js/game.js`
  (`T.Game` internal `background` helper) and is drawn on every screen — title,
  select, and play — so the whole site feels like the screensaver.

### Palette (T.C.PAL)
    bg:        '#0d0b10'   deep charcoal (fallback background)
    bgGrid:    '#161320'   faint scanline / grid tint
    crust:     '#c98a3f'   bread crust
    crumb:     '#f3dfa8'   bread body
    crumbDark: '#d9c084'   bread shading
    jamRed:    '#c8203f'   jam
    jamLite:   '#f0577a'   jam highlight
    glass:     '#bfe6f2'   jar glass
    glassDark: '#7fb6cc'
    butter:    '#ffd85e'   butter
    butterLt:  '#fff2b0'
    chrome:    '#c9d2dc'   toaster body
    chromeLt:  '#eef3f8'   toaster highlight
    chromeDk:  '#6d7a88'   toaster shadow
    slot:      '#1b1a22'   toaster slot (dark)
    coil:      '#ff5b2e'   glowing heating element
    coilLt:    '#ffb04a'
    burnt:     '#3a2a22'   charred toast
    ui:        '#f3dfa8'   HUD text
    uiDim:     '#7b6f55'
    p1:        '#7ee0c0'   player-1 accent
    p2:        '#f0a3c8'   player-2 accent
    wing:      '#f7f9fb'   feather white
    wingShade: '#b9c4d0'   feather shadow
    sky:       '#101a2e'   After Dark night-sky blue (background gradient top)
    skyDeep:   '#070a14'   background gradient bottom
    star:      '#dfe8f5'   drifting star
    danger:    '#ff4d4d'

## 3. GAMEPLAY CONSTANTS (T.C — util.js owns these; nobody redefines them)

    W: 960, H: 720
    FIXED_DT: 1/60

    PLAY_TOP: 96          // below HUD
    PLAY_BOTTOM: 690      // floor line
    SHIP_Y: 636           // player sprite top edge
    BUNKER_Y: 548
    UFO_Y: 108

    COLS: 11, ROWS: 5, TOTAL_ENEMIES: 55
    CELL_W: 64, CELL_H: 48       // formation grid spacing
    FORM_START_X: 88             // left edge of formation cell (0,0)
    FORM_START_Y: 168
    FORM_STEP_X: 10              // horizontal px per march step
    FORM_STEP_Y: 26              // px dropped when hitting a wall
    FORM_MARGIN: 24              // px from screen edge the formation turns at

    SHIP_SPEED: 280              // px/sec at full stick deflection
    SHIP_W: 44, SHIP_H: 34
    SHIP_RESPAWN_DELAY: 1.6      // seconds of death animation before respawn

    SHOT_SPEED_BUTTER: 560
    SHOT_SPEED_JAM: 720
    MAX_BOMBS: 3
    BOMB_SPEED_MIN: 190, BOMB_SPEED_MAX: 260
    BOMB_COOLDOWN: 0.55          // min seconds between enemy bomb drops

    UFO_SPEED: 130
    UFO_MIN_GAP: 18, UFO_MAX_GAP: 27   // seconds between UFO passes

    LIVES: 3
    EXTRA_LIFE_AT: 1500

    SCORE_ROW: [30, 20, 20, 10, 10]    // index = formation row, 0 = top
    UFO_SCORES: [50, 100, 150, 300]

### March timing (must feel like the original: speeds up as toasters die)
`stepInterval(aliveCount, wave)` returns seconds between formation steps:

    base = 0.032 + 0.86 * Math.pow((alive - 1) / 54, 1.45)
    return Math.max(0.028, base * Math.pow(0.88, Math.min(wave - 1, 6)))

At 55 alive wave 1 ≈ 0.89s; at 1 alive ≈ 0.032s. Steps move the WHOLE formation
`FORM_STEP_X` px at once (classic behaviour). The enemy wing frame advances on
every step through the ping-pong cycle [0,1,2,3,2,1] so the toasters flap as the
formation marches — and therefore flap FASTER as more of them die.

### Wave progression
Each new wave, the formation's starting Y increases by `FORM_START_Y + (wave-1)*18`,
capped so it never starts below `BUNKER_Y - 200`. Bunkers are restored fresh every
wave. Wave N>1 also gets the 0.88^n step-time multiplier above.

### Loss conditions
- A ship is hit by a bomb or by a toaster body → that ship loses a life.
- Toasters reaching `BUNKER_Y + 40` → immediate game over for the board.
- Board over when all participating ships have 0 lives and their death anim ended.

## 4. WEAPONS (the two characters must FEEL different but stay fair)

Both are classic single-shot: **one live shot per ship at a time.**

| | Bread → BUTTER | Jam Jar → JAM |
|---|---|---|
| speed | 560 px/s | 720 px/s |
| hitbox | 10 x 16 (wide) | 6 x 16 (narrow) |
| bunker damage radius | 9 px (big greasy melt) | 5 px (neat puncture) |
| sfx | soft buttery "pwop" | wet "splort" |
| trail | 2 faint melting butter dots | thin red streak |

Bombs (enemy fire) come in 3 visual types, cycled: `crumb`, `spark`, `flyingToast`.
A player shot that meets a bomb destroys the bomb (butter always wins, jam wins
75% of the time — jam is fast but thin; use `T.Util.rng()` for the roll) and, if
the roll is lost, the jam shot dies too.

## 5. INPUT CONTRACT (js/input.js — T.Input)

Xbox controller mapping (standard Gamepad API layout):

    axes[0]  left stick X  (deadzone 0.28)
    buttons[0] A      → FIRE / CONFIRM
    buttons[1] B      → BACK
    buttons[2] X      → FIRE (alt)
    buttons[3] Y      → toggle character (select screen)
    buttons[7] RT, buttons[5] RB → FIRE (alt)
    buttons[9] Start  → START / PAUSE
    buttons[8] Back/View → BACK
    buttons[12..15] D-pad up/down/left/right

Keyboard fallback (so the game is testable/playable without pads):
  P1: A / D move, Space or W fire, Enter start, Esc back
  P2: ArrowLeft / ArrowRight, ArrowUp or '/' fire, RightShift start, Backspace back

API — all synchronous, no allocation in the hot path:

    T.Input.init()                 // attach listeners; call once
    T.Input.poll()                 // call ONCE per frame, before update
    T.Input.get(i)                 // i = 0 | 1 → PadState (stable object, mutated in place)
    T.Input.anyPressed(name)       // name in {'start','fire','back'} → true if either pad pressed it this frame
    T.Input.padCount()             // number of physically connected gamepads
    T.Input.isGamepad(i)           // true if slot i is backed by a real gamepad
    T.Input.consume(i, name)       // clear a 'pressed' edge so it isn't handled twice
    T.Input.rumble(i, ms, strong, weak)  // best-effort; must no-op silently if unsupported

PadState fields (booleans unless noted):
    axisX (number -1..1, deadzoned & rescaled), left, right, up, down,
    fire, start, back, altChar,
    firePressed, startPressed, backPressed, upPressed, downPressed,
    leftPressed, rightPressed, altCharPressed,
    connected
`*Pressed` = rising edge this frame only. D-pad and stick both feed left/right/up/down.
Gamepad slot assignment: first connected pad → player 0, second → player 1, stable
across disconnects (remember gamepad.index → slot).

## 6. AUDIO CONTRACT (js/audio.js — T.Audio)

Pure WebAudio synthesis. AudioContext must be created/resumed on the first user
gesture (a keypress or gamepad button press) — never at load, or Chrome blocks it.

    T.Audio.init()                     // safe to call repeatedly
    T.Audio.unlock()                   // resume() on first gesture
    T.Audio.play(name, opts)           // fire-and-forget one-shot
    T.Audio.setMarchTempo(seconds)     // interval between the 4 bass notes
    T.Audio.startMarch() / stopMarch()
    T.Audio.startUfo() / stopUfo()     // looping warble while UFO is on screen
    T.Audio.setMuted(bool) / T.Audio.isMuted()
    T.Audio.masterGain                 // GainNode

Required `name` values:
    'shootButter','shootJam','enemyHit','ufoHit','playerDie','bunkerHit',
    'ufoAppear','extraLife','uiMove','uiConfirm','uiBack','waveStart','gameOver'

The march is the iconic 4-note descending loop (e.g. G2 F#2 F2 E2 as square/triangle
blips through a lowpass). Tempo is driven by `setMarchTempo` every frame from the
current formation step interval, so it accelerates as toasters die.
Toaster-specific flavour: 'enemyHit' should include a bright metallic *ding* like
toast popping up. 'playerDie' is a descending buzz plus a burnt sizzle (noise burst).
Keep everything short (<0.5s) and mixed so nothing clips: master gain ≈ 0.35.

## 7. SPRITES CONTRACT (js/sprites.js — T.Sprites)

Sprites are authored as **pixel maps**: arrays of equal-length strings, one char
per pixel, `.` = transparent. A key maps chars → palette colours. Each map is
rasterized once at boot into an offscreen canvas at `SCALE = 2` (so a 22x16 map
becomes a 44x32 sprite).

    T.Sprites.build()                       // rasterize everything; call once at boot
    T.Sprites.get(name)                     // → {canvas, w, h}  (w/h in logical px)
    T.Sprites.draw(ctx, name, x, y)         // blit with top-left at x,y (integers)
    T.Sprites.drawCentered(ctx, name, cx, cy)
    T.Sprites.tint(name, color)             // → cached tinted copy, for player accents

Required sprite names and their logical (post-scale) sizes:

    ENEMIES — winged chrome toasters in the style of the After Dark "Flying
    Toasters" screensaver: a chrome toaster with a big white feathered bird wing
    on each side, flapping. FOUR wing frames each (up / mid-up / mid-down / down)
    which cycle 0,1,2,3,2,1 on each formation march step so they visibly FLAP.
    Body is FRONT-facing (slots and glowing coil eyes aimed at the player) with a
    symmetric wing either side — that keeps the After Dark silhouette while still
    reading as a menacing Space Invaders row.

      'toastA0'..'toastA3'   52 x 34   row 0    slim 2-slot chrome, 30 pts
      'toastB0'..'toastB3'   56 x 34   rows 1-2 classic 2-slice, 20 pts
      'toastC0'..'toastC3'   60 x 34   rows 3-4 chunky 4-slot, 10 pts

    Each toaster needs: chrome body with a bright top highlight and a dark
    underside, dark slots with glowing coil eyes (PAL.coil / PAL.coilLt), a
    browning dial, a lever on the side, and WINGS — white/off-white feathers
    (use PAL.chromeLt and PAL.wingShade) with visible feather separation, drawn
    large enough to be unmistakable (each wing at least 12 logical px across).
    Wing frames must differ strongly in silhouette, not just by a pixel or two.
    The three body types must be distinguishable at a glance by body shape, not
    just size.

      'ufo'                  76 x 34   the "Chrome Deluxe" bonus toaster: a pure
                                       SIDE-PROFILE After Dark toaster, nose
                                       left-to-right, one big wing, chrome shine,
                                       a slice of toast peeking out of the slot.
      'ufo1'                 76 x 34   same, opposite wing beat (alternates at 8Hz)

      'toastFly0','toastFly1'  20 x 20  a winged slice of TOAST — the other half of
                                       the After Dark screensaver. Small wings,
                                       browned bread. Used as ambient background
                                       drifters and as the type-2 bomb.

    PLAYERS — 2 frames each (idle / firing recoil).
      'bread0','bread1'     44 x 34   an UNtoasted slice: pale crumb body, crust
                                      edge, determined little face, arms.
      'jam0','jam1'         44 x 34   a jam jar: glass body, red jam fill, cloth
                                      lid with a tie, label, determined face.

    PROJECTILES
      'butter'              10 x 16   a golden pat of butter, slight melt drip
      'jamShot'              6 x 16   a red jam glob with a highlight
      'bomb0a','bomb0b'      8 x 16   crumb bomb, 2 frames (tumbling)
      'bomb1a','bomb1b'      8 x 16   spark/coil bomb, 2 frames
      'bomb2a','bomb2b'     16 x 16   a tumbling winged toast slice, 2 frames

    FX
      'boomEnemy'           48 x 32   crumb burst
      'boomPlayer0'         44 x 34   charred toast, frame 0
      'boomPlayer1'         44 x 34   charred toast, frame 1 (more burnt)

    HUD
      'lifeBread'           22 x 17   half-size bread icon
      'lifeJam'             22 x 17   half-size jam icon

    BUNKER
      'bunker'              96 x 64   a stick-of-butter barricade: butter body with
                                      a wrapper band, arched underside like the
                                      original Space Invaders shield.

If a pixel map's rows are not all the same length, `build()` must throw a clear
Error naming the sprite — do not fail silently.

## 8. ENTITIES CONTRACT (js/entities.js — T.Entities)

Plain-object entities + pools. NO game rules here — this file is data structures,
per-entity motion, and collision primitives only.

    T.Entities.makeShip(slot, kind)     // slot 0|1, kind 'bread'|'jam'
      → {slot, kind, x, y, w, h, alive, lives, score, dead, deathT, frame,
         shot:null, respawnT, spawnInvuln, out}
    T.Entities.makeEnemy(row, col)      // → {row, col, x, y, w, h, alive, type, points}
    T.Entities.makeShot(owner, x, y)    // owner = ship object → {x,y,w,h,vy,kind,owner,alive,trail}
    T.Entities.makeBomb(x, y, type)     // → {x,y,w,h,vy,type,frame,animT,alive}
    T.Entities.makeUfo(dir)             // → {x,y,w,h,vx,alive,scoreIndex}
    T.Entities.makeBunker(x, y)         // destructible; see below
    T.Entities.makeParticleSystem()     // → {items:[], spawn(x,y,opts), update(dt), render(ctx)}

    T.Entities.aabb(a, b)               // → bool, standard AABB overlap
    T.Entities.rectHitsBunker(bunker, x, y, w, h)   // → bool, PIXEL-accurate
    T.Entities.damageBunker(bunker, cx, cy, radius) // carve a ragged hole
    T.Entities.bunkerIsGone(bunker)     // → bool

Bunker implementation: each bunker owns an offscreen canvas (96x64) seeded from
the 'bunker' sprite plus an `ImageData`-backed `Uint8Array` occupancy mask at 1:1
logical pixels. `damageBunker` clears a rough circle (jitter the edge with
`T.Util.rng()` so damage looks chewed, like the original) in BOTH the mask and the
canvas. `rectHitsBunker` tests the mask, not the bounding box. Bunkers are also
eroded from below when a toaster passes over them (classic behaviour).

## 9. GAME CONTRACT (js/game.js — T.Game)

Owns the state machine, wave logic, collisions, scoring.

    T.Game.init(canvas)
    T.Game.update(dt)        // dt is ALWAYS T.C.FIXED_DT
    T.Game.render(ctx)
    T.Game.state             // 'title' | 'select' | 'play' | 'pause' | 'wave' | 'over'
    T.Game.session           // current Session or null

States:
  title  — attract screen. Any Start → 'select'.
  select — both players pick Bread or Jam and READY UP. Also picks the mode.
  wave   — 2.0s "WAVE n" banner, then 'play'.
  play   — the game.
  pause  — Start toggles; B/Back → confirm quit to title.
  over   — final scores + high score; Start → 'title'.

Modes (chosen on the select screen, default CO-OP):
  'coop'    — both ships on ONE board simultaneously. Separate scores and lives.
              A player with 0 lives sits out; board ends when both are out.
  'classic' — faithful alternating turns: each player has their OWN board and
              own wave counter; on death, play swaps to the other player (if they
              still have lives) showing a "PLAYER n" banner for 1.5s.
  1-player is just co-op with a single ship — fully supported.

Board object (create with an internal `createBoard(playerSlots, wave)`) holds:
    ships[], enemies[], bombs[], ufo, bunkers[], particles, wave,
    dir (+1/-1), stepT, stepInterval, frameIdx (index into [0,1,2,3,2,1]),
    bombT, ufoT, over, aliveCount

Per-frame order in 'play':
  1. read T.Input.get for each active ship
  2. move ships (clamped to [FORM_MARGIN, W - FORM_MARGIN - SHIP_W]), handle fire
  3. advance shots and bombs
  4. formation step timer → march / drop / wall test; retarget audio tempo
  5. UFO timer + motion
  6. enemy bomb spawn (from the LOWEST alive enemy in a random occupied column,
     respecting MAX_BOMBS and BOMB_COOLDOWN)
  7. collisions, in this order:
       shot × enemy, shot × ufo, shot × bomb, shot × bunker, shot × ceiling
       bomb × ship, bomb × bunker, bomb × floor
       enemy × bunker (erode), enemy × ship, enemy × floor line (game over)
  8. scoring, extra life at EXTRA_LIFE_AT (once per ship), wave-clear check
  9. particles

High score persists via `localStorage['toasterInvaders.hi']`, wrapped in
try/catch (file:// and private mode can throw). Never let storage break the game.

## 10. UI CONTRACT (js/ui.js — T.UI)

All screen furniture. Text is drawn with a canvas-drawn pixel font OR with
`ctx.font` using a monospace stack — but it MUST look deliberate and retro, not
like default browser text. Use letter-spacing, uppercase, and the palette.

    T.UI.drawText(ctx, str, x, y, opts)   // opts: {size, color, align:'left'|'center'|'right', glow}
    T.UI.renderTitle(ctx, g)
    T.UI.renderSelect(ctx, g)
    T.UI.renderHUD(ctx, board, g)
    T.UI.renderWaveBanner(ctx, g)
    T.UI.renderPause(ctx, g)
    T.UI.renderOver(ctx, g)
    T.UI.renderScanlines(ctx)             // subtle CRT overlay, drawn LAST every frame
    T.UI.renderControllerHint(ctx, g)     // shows pad-connected status on title/select

The title screen must show the game name, an animated row of marching toasters,
"PRESS START", and connected-controller indicators for P1/P2.
The select screen shows two panels (P1/P2) each with a big preview of the chosen
character, its weapon name, left/right to change, A to ready up, Y to toggle.
Show a "PLAYER 2: PRESS START TO JOIN" prompt when only one pad is active.
HUD (top strip, above PLAY_TOP): P1 score + lives icons on the left, HI-SCORE
centred, P2 score + lives on the right, wave number under the hi-score.

## 11. MAIN (js/main.js)

Fixed-timestep loop with an accumulator, max 5 catch-up steps per frame to avoid
spiral-of-death after a tab switch. Handles canvas resize/letterboxing, first-gesture
audio unlock, visibilitychange → auto-pause. Boots: `T.Sprites.build()`,
`T.Input.init()`, `T.Game.init(canvas)`, then rAF.

## 12. QUALITY BAR

- 60fps with 55 enemies + particles. No per-frame allocation in hot loops (reuse
  objects / pools).
- No console errors or warnings on load or during a full wave.
- Game is fully playable start→game over on keyboard alone.
- Both controllers work simultaneously with zero input crosstalk.
- Every number that tunes feel comes from `T.C`, not a literal buried in logic.
