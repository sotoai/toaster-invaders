# TOASTER INVADERS — iPad / TOUCH + GITHUB PAGES (spec addendum)

Extends SPEC.md, SPEC-WEAPONS.md, SPEC-CHARACTERS.md, SPEC-VARIANTS.md.
All HARD RULES from SPEC.md section 0 still apply: classic script tags, no
modules, no assets, no deps, `window.T`, runs from `file://`.

Goal: the game is fully playable on an iPad in Safari, **two players on one
device**, and it ships as a static site on GitHub Pages.

Nothing here may regress keyboard or Xbox-controller play. Gamepads still work on
iPadOS (Safari supports the Gamepad API for MFi / Xbox / DualSense pads) — touch
is an ADDITIONAL input source, never a replacement.

New load order — touch.js slots in AFTER input.js, BEFORE sprites.js:

    util → audio → input → **touch** → sprites → entities → weapons → game → ui → main

## 1. ARCHITECTURE: A VIRTUAL PAD, NOT A SECOND INPUT PATH

`js/touch.js` must NOT reimplement game input. It renders on-screen controls and
feeds a **virtual pad** into the existing `T.Input` slots, so every downstream
file — game.js, ui.js, weapons.js — is untouched and unaware.

`js/input.js` gains exactly one new concept:

    T.Input.setVirtual(slot, name, held)   // slot 0|1, name in
                                           // 'left','right','up','down',
                                           // 'fire','start','back','altChar'
    T.Input.clearVirtual(slot)             // release everything for that slot
    T.Input.hasVirtual(slot)               // true if touch is driving this slot

`poll()` ORs the virtual state into that slot's PadState **before** computing
rising edges, so `firePressed` / `startPressed` behave identically whether the
input came from a key, a gamepad button, or a thumb. A slot driven by touch must
still accept its keyboard and gamepad bindings — the three sources merge.

Deadzone/axis: touch sets `left`/`right` booleans; `axisX` is derived as
-1 / 0 / +1 from them, so ship movement feels the same as a D-pad.

## 2. TOUCH DETECTION AND LAYOUT

Touch UI turns on when `navigator.maxTouchPoints > 0` **or** a `touchstart` is
seen. It must NOT turn on merely because the screen is small, and a Mac with a
touchbar or a hybrid laptop must not lose its keyboard. Once a real touch is
seen, show the controls; if a key is pressed afterwards, keep them (a player may
use both) but stop drawing the "tap to start" prompts.

### Landscape (the supported orientation)

    ┌──────────────────────────────────────────────────┐
    │ ┌────────┐  ┌────────────────────┐  ┌────────┐   │
    │ │   P1   │  │       CANVAS       │  │   P2   │   │
    │ │ column │  │        4:3         │  │ column │   │
    │ └────────┘  └────────────────────┘  └────────┘   │
    └──────────────────────────────────────────────────┘

- The canvas keeps its 960x720 backing store and is scaled to fit the space that
  REMAINS after the control columns are reserved. Controls must **never overlap
  the play field** — the player ship sits at y 636 of 720 and an overlay there
  would cover exactly the thing you are aiming.
- Each column is `clamp(96px, 15vw, 190px)` wide, bottom-anchored, and respects
  `env(safe-area-inset-*)` so nothing sits under the home indicator or a corner.
- **Solo layout** (one player active): movement `◀ ▶` in the LEFT column, a large
  `FIRE` in the RIGHT column. That is the comfortable two-thumb phone layout.
- **Duo layout** (P2 joined): each column becomes a compact cluster — `FIRE`
  above, `◀ ▶` side by side beneath it — so each player owns their own edge of
  the device. Switch layouts when P2 joins or drops at the select screen.
- Every column also carries a small `START` and `BACK`. START is the pause /
  join / variant-cycle button the rest of the game already uses; BACK is B.

### Portrait

Show a full-screen rotate prompt (a rotating toaster is on-theme) and pause the
game if it was in play. Do not try to make 4:3 two-player work in portrait.

### Minimum target sizes

No interactive target smaller than **56x56 CSS px**, FIRE at least **88px**.
Targets get generous invisible padding so a thumb that lands slightly off still
registers.

## 3. MULTI-TOUCH IS THE CORRECTNESS RISK — GET IT RIGHT

Two players press simultaneously, and one player holds `▶` while tapping `FIRE`.
A naive click handler breaks all of this.

- Use **Pointer Events** (`pointerdown/move/up/cancel`) with
  `setPointerCapture`, falling back to Touch Events with `changedTouches` and
  `identifier` tracking where Pointer Events are unavailable. iPadOS Safari
  supports Pointer Events; the fallback exists for older Safari.
- Track every active pointer id → the control it is holding. A control is held
  while ANY pointer is on it. Releasing one finger must not release a button a
  different finger is still holding.
- Handle `pointercancel` / `touchcancel` — an interrupting phone call or a
  system gesture must not leave a button stuck on, which would send the ship
  sliding into a wall forever.
- **Slide-off tolerance**: dragging from `◀` to `▶` should switch cleanly, and a
  thumb that drifts a few px off a button must not drop the input. Re-evaluate
  which control a moving pointer is over on `pointermove`.
- On `blur`, `visibilitychange` and orientation change, release everything.
- Support at least 10 simultaneous pointers.

## 4. CONTROL MODES

Default is **BUTTONS**. Offer a second mode, **DRAG**, toggled from the pause
menu and the title screen, remembered in `localStorage` via `T.Util.storeGet/Set`:

- DRAG: a pointer that lands on that player's half of the canvas moves their ship
  by the pointer's horizontal delta (relative, not absolute, so it works no
  matter where the ship is), and a pointer that lifts having moved less than
  ~10px counts as a TAP and fires. Both players can drag at once; assign a
  pointer to the player whose half of the canvas it started in, and keep that
  assignment for the pointer's whole life.
- Movement in DRAG mode still routes through `T.Input.setVirtual` so the game
  logic stays identical.

## 5. iOS / SAFARI SPECIFICS

`index.html`:
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, maximum-scale=1">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`,
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
  `<meta name="apple-mobile-web-app-title" content="Toaster Invaders">`,
  `<meta name="theme-color" content="#0d0b10">`
- An `apple-touch-icon` and a favicon (see section 6).
- A short "Add to Home Screen for full screen" hint, shown only on iOS Safari.

`css/style.css`:
- `touch-action: none` on the game root; `overscroll-behavior: none` on body.
- `-webkit-user-select: none`, `-webkit-touch-callout: none`,
  `-webkit-tap-highlight-color: transparent` on controls.
- Use `100dvh` with a `100vh` fallback — Safari's toolbar makes `100vh` wrong.
- `env(safe-area-inset-*)` padding on the control columns.
- Buttons must give instant visual feedback on press (no 300ms delay, no hover
  states that stick on touch).
- The existing on-page help strip is desktop furniture. On touch it must collapse
  behind a `?` button rather than pushing the canvas up the page.
- `@media (prefers-reduced-motion: reduce)` still honoured.

`js/main.js`:
- Prevent rubber-band scrolling and double-tap zoom: `preventDefault()` on
  `touchmove` at the document level while the game root is the target, plus
  `gesturestart` prevention for pinch-zoom.
- Layout math must account for the reserved control columns and for
  `visualViewport` changes, not just `window.resize`.
- Keep the game paused while the rotate prompt is up.

**Audio on iOS** — call this out in the code with a comment, because it will look
like a bug otherwise: Web Audio is silenced by the physical **silent switch** /
Ring-Silent setting on iPad. Unlock the AudioContext from the first `touchstart`
(main.js already does this for pointer/touch — verify it still fires), and
additionally attempt the standard workaround of playing a short silent buffer on
that same gesture. If the device is on silent the game is still silent; that is
an iOS platform behaviour, not something to fake around. Surface it once in the
help text.

## 6. GITHUB PAGES

The site must work when served from a project subpath
(`https://<user>.github.io/<repo>/`), not just a domain root.

- **Audit every path** in HTML, CSS and JS: all must be RELATIVE (`js/util.js`,
  not `/js/util.js`). One leading slash breaks the whole deploy. Verify by grep,
  and by serving the game from a subdirectory locally and loading it.
- Add `.nojekyll` at the repo root so GitHub never runs Jekyll over the files.
- Add a `README.md`: what the game is, how to play (touch, keyboard, gamepad),
  the nine characters and 27 variants, the weapon-drop loop, how to run locally,
  and a note that it is dependency-free vanilla JS with procedurally generated
  art and audio.
- Add a favicon and a 180x180 `apple-touch-icon.png`. Generate them from the
  game's OWN sprite pipeline (a flying toaster) with a node script — do not hand-
  author binary or pull an asset. Node's built-in `zlib` is enough to write a
  minimal PNG; keep the generator in the scratchpad, commit only the output.
- Add a `.gitignore` (macOS `.DS_Store` at minimum — there is one in the repo).
- Do NOT create a remote, push, or configure Pages. Prepare the repo only; the
  owner will decide the repo name and visibility.

## 7. QUALITY BAR

- Playable start to finish on an iPad in landscape with two thumbs, and with two
  players on one device.
- No stuck buttons, ever, under any multi-touch sequence.
- 60fps on an iPad with a full formation and particles.
- Keyboard and gamepad play is byte-for-byte unaffected.
- No console errors on load or during a full wave.
- Every existing harness in the scratchpad still passes unchanged.
