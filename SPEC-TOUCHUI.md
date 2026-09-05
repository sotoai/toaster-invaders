# TOASTER INVADERS — TAPPABLE UI (spec addendum)

Extends SPEC-TOUCH.md. All HARD RULES from SPEC.md section 0 still apply.

Reported from real iPad play: **you cannot tap the thing you want.** Choosing a
variant means pressing START to cycle through a hidden order. That is desktop
thinking wearing a touchscreen. On a touch device you tap the thing.

This addendum makes the game's canvas-drawn UI directly tappable.

## 1. THE PROBLEM

The select screen is drawn onto the canvas by `js/ui.js`. The canvas has no DOM
children, so nothing inside it can be hit-tested — every interaction has to be
routed through an off-canvas button. That is why the variant picker ended up on
START, and it is the root cause, not the symptom. Fix the root cause: give the
canvas real hit regions.

## 2. ARCHITECTURE: PUBLISHED HIT REGIONS

`js/ui.js` already computes the rectangle of everything it draws. It must record
those rectangles, in **logical canvas coordinates (960x720)**, as it draws them.

    T.UI.beginRegions()          // called at the top of a screen's render
    T.UI.addRegion(region)       // called as each interactive thing is drawn
    T.UI.regions()               // → the array for the CURRENT frame

A region is declarative data, never a callback — ui.js must not mutate game state:

    { id, x, y, w, h, player, action, value }

    action: 'variant'  value = variant index 0..2        player = 0|1
    action: 'char'     value = character index in order  player = 0|1
    action: 'charStep' value = -1 | +1                   player = 0|1
    action: 'ready'    value = null                      player = 0|1
    action: 'join'     value = null                      player = 1
    action: 'mode'     value = 'coop' | 'classic'
    action: 'start'    value = null                      (title: tap to start)

`js/touch.js` routes a tap: on a pointer that lifts inside the canvas having moved
less than `T.C.TOUCH_TAP_MAX_PX`, convert client coords → logical coords using the
canvas's live bounding rect, hit-test `T.UI.regions()` (LAST match wins, so
whatever was drawn on top receives the tap), and hand the region to
`T.Game.uiTap(region)`.

`js/game.js` implements `T.Game.uiTap(region)` and is the ONLY place that acts on
it — it applies the same state change the equivalent button press would, reusing
the existing select-screen logic rather than a parallel copy. An unknown or
out-of-context action is ignored, never thrown.

**Mouse counts too.** Route desktop clicks through the identical path. It costs
nothing, it makes the select screen click-to-choose on desktop, and it makes this
testable without a touchscreen.

## 3. WHAT MUST BECOME TAPPABLE

Select screen, per player panel:
- **Each of the three variant thumbnails — the reported bug.** Tapping one selects
  **that variant directly** (set the index; do NOT cycle to it).
- The `◀` `▶` character chevrons.
- Each icon in the roster strip — tapping one jumps straight to that character.
- The large character preview — readies that player up.
- The P2 "press start to join" panel — joins player two.
- The CO-OP / CLASSIC selector — tapping either word picks it directly.

Title screen: tapping anywhere already starts the game; keep that, expressed as a
region so there is one mechanism rather than two.

START keeps working as it does today for anyone on a gamepad, and remains the
variant cycler there. This addendum ADDS tapping; it removes nothing.

## 4. TOUCH TARGETS MUST BE BIG ENOUGH TO HIT

This is where a naive implementation fails: the variant thumbnails are currently
drawn small enough that at the canvas's CSS scale they are around 20 CSS px — less
than half of `T.C.TOUCH_MIN_TARGET` (56).

Two requirements, both needed:

1. **Draw them bigger on touch.** When `T.Touch.isTouch()` is true the variant
   thumbnails (and the roster strip icons) render at a size that lands at or above
   `TOUCH_MIN_TARGET` once the canvas scale is applied. Desktop rendering is
   unchanged.
2. **Pad the hit region beyond the art.** Every region's rect is expanded so its
   on-screen size is at least `TOUCH_MIN_TARGET` CSS px in both axes, computed
   from the live canvas scale. Padding must not make neighbouring regions overlap
   — when two would collide, split the gap between them rather than letting the
   later one swallow the earlier.

Add `T.C.UI_REGION_MIN_PX` (56) and `T.C.UI_THUMB_TOUCH_SCALE` for the enlarged
draw, rather than burying either in ui.js.

## 5. FEEDBACK

A tap that lands must be visibly acknowledged within one frame — the tapped
thumbnail flashes or scales briefly, and the existing `uiMove` / `uiConfirm` cue
plays. A tap that lands on nothing does nothing silently. Without feedback a
player cannot tell a small target was missed rather than the game ignoring them.

The currently-selected variant must be obviously marked as selected, not merely
highlighted-on-hover — there is no hover on a touchscreen.

## 6. QUALITY BAR

- Tapping any of the three variant thumbnails selects THAT variant, first time,
  every time, at every supported iPad size.
- Both players can tap their own panel simultaneously without cross-talk. A tap in
  P1's panel never changes P2's selection.
- No region overlaps another; no region extends outside the canvas.
- Multi-touch still correct: a tap routed to the canvas must not disturb a held
  on-screen button, and must not leave anything stuck.
- Keyboard, gamepad and the existing on-screen buttons all still work unchanged.
- Desktop rendering and desktop play are byte-for-byte unaffected apart from
  clicks now working.

## 7. BUTTON PLACEMENT — LIFT THEM OFF THE BOTTOM EDGE

Also reported from real iPad play: **the on-screen buttons sit slightly too low.**
The reference is the iOS version of Minecraft.

What Minecraft actually does, and what we are matching: its controls are **inset
from the corner**, not flush into it. The D-pad's bottom edge floats a clear
margin above the bottom of the screen and a similar margin in from the side, so a
thumb rests on the cluster naturally without having to curl down into the very
corner of the device or ride the home indicator.

Today our columns are bottom-anchored with only the safe-area inset beneath them,
which puts the arrows and FIRE right down on the edge. Raise them.

- Add `T.C.TOUCH_COL_LIFT_PCT` (default **0.07**) — the cluster's bottom margin as
  a fraction of viewport height, applied **on top of** `env(safe-area-inset-bottom)`,
  never instead of it.
- Clamp with `T.C.TOUCH_COL_LIFT_MIN` (24) and `T.C.TOUCH_COL_LIFT_MAX` (72) CSS px
  so it stays sane from a small phone to a 13-inch iPad.
- Apply the same treatment horizontally: a matching inset from the outer screen
  edge, so the cluster floats in from the corner the way Minecraft's does rather
  than hugging the bezel.
- The change is "just slightly" — a noticeable lift, not a relocation. The cluster
  stays bottom-anchored and thumb-reachable; it does not migrate to the middle of
  the column.

**It must never push a control off-screen.** The tightest supported case is a
phone in landscape (844x390) where the column's height budget is nearly full
already. The lift must SHRINK toward `TOUCH_COL_LIFT_MIN`, and to zero if it comes
to that, before any control is clipped or overflows its column. Assert at every
supported size that every control is fully inside the viewport, still at or above
`T.C.TOUCH_MIN_TARGET`, and still not overlapping the canvas.

Raising the cluster must not change the canvas size or position — the columns sit
beside the play field, so this is a change WITHIN the column only.

## 8. THE STUCK FIRE BUTTON — A REAL BUG THAT PASSED 518 ASSERTIONS

Reported from real two-player play on one iPad: **sometimes one player's FIRE
button gets stuck on.**

Treat the test suite as the primary defect here. `touch-multitouch.js` passes 518
assertions including 32 release scenarios, and the integration matrix asserted
"both slots completely clear" after pointercancel, blur, visibility change,
orientation change, layout switch under a held finger and mode switch under a held
finger — and the bug still shipped. So the harness does not model whatever real
iOS Safari actually does. **Do not start by patching a suspected line. Start by
reproducing it.**

### 8.1 Reproduce it first

Build a stress/fuzz harness that models what two thumbs on a real device do, not
what a tidy synthetic sequence does. It must include, at minimum:

- **Duplicate `pointerdown` for the same `pointerId`** with no intervening up
  (event bubbling through a container that also has a handler will do this). If a
  hold counter increments twice and decrements once, the button is stuck forever.
  This is the single most likely cause and the existing tests dispatch cleanly on
  the element, so they would never produce it.
- **A lost `pointerup`** — a down with no matching up, which is exactly what
  happens when an element is hidden or replaced mid-press.
- **`pointerId` REUSE**: player 1 lifts and player 2 presses and the platform hands
  out the same id, immediately and after a delay.
- **Interleaved ids out of order**: down(1) down(2) up(1) down(3) up(3) up(2), and
  every permutation the fuzzer can reach.
- **The element being hidden or swapped while captured.** The solo→duo layout
  switch MOVES the FIRE button between columns; a finger held through that switch
  has its up delivered to an element that is now hidden or gone. Test both
  directions, mid-press, for each player independently and both at once.
- **`setPointerCapture` interactions**: capture on an element that is then hidden,
  capture released early, capture on one element while a second pointer targets it.
- **Touch Events fallback path** as well as Pointer Events, with the same cases.
- Randomised fuzzing over these primitives across thousands of sequences, with the
  invariant checked after EVERY event: *for each slot, a virtual button is held if
  and only if at least one live pointer is genuinely down on a control mapped to
  it.* Report any sequence that breaks it, minimised to the shortest reproduction.

Report the sequence that reproduces it. If the fuzzer cannot break it, say so
plainly and widen the model rather than declaring the bug absent — it was observed
on real hardware.

### 8.2 Fix the cause

Whatever the fuzzer finds, fix the actual mechanism. Reference-count by **pointer
id identity**, not by a bare integer that can double-increment: keep the SET of
pointer ids currently holding each control, so a duplicate `pointerdown` for an id
already in the set is a no-op and an up removes exactly one id. A set cannot drift
the way a counter can.

### 8.3 Add a reconciliation watchdog regardless

This bug class has already escaped a large test suite once, and a stuck fire button
ruins a two-player game in a way that is very hard for a player to diagnose.
Independently of the specific cause, add a cheap per-frame safety net:

- Every frame, reconcile the virtual button state against the live pointer set: if
  no live pointer is actually down on any control mapped to a slot's button, that
  button is released. The pointer set is the single source of truth; the virtual
  state is derived, never authoritative.
- Drop any pointer id the platform has stopped reporting (a lost up), and clear a
  control whose element is no longer connected to the document
  (`node.isConnected === false`) or is hidden.
- This must be O(active pointers), allocate nothing per frame, and must never
  release a button a finger IS genuinely still holding — verify that explicitly,
  because a watchdog that fires a false positive turns a rare stuck button into
  constant dropped input, which is worse.

Add `T.C.TOUCH_WATCHDOG` if any tunable is needed.

### 8.4 Prove the fix

- The minimised reproduction from 8.1 must pass afterwards.
- The full fuzz run must pass, with the seed count reported.
- The existing 518 assertions in `touch-multitouch.js` must still pass.
- Explicitly assert the watchdog never releases a genuinely-held button across a
  long two-player session with continuous overlapping presses.
