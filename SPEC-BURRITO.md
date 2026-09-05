# TOASTER INVADERS — THE SECRET CHARACTER (spec addendum)

Extends SPEC.md, SPEC-WEAPONS.md, SPEC-CHARACTERS.md, SPEC-VARIANTS.md,
SPEC-TOUCH.md. All HARD RULES from SPEC.md section 0 still apply.

Adds a **tenth, hidden playable character: BURRITO**, unlocked by reaching
**wave 5**. His gun cycles through three of the roster's existing weapons —
**SIZZLE, FLAKE, PEPPER** — one shot at a time.

## 1. THE CHARACTER

    id      'burrito'
    char    'BURRITO'
    weapon  'WRAPPED'          (HUD name for the rotating gun)
    wid     'wrapped'

He is the only character whose weapon changes while you play. Every shot fires
the NEXT weapon in the cycle:

    SIZZLE  →  FLAKE  →  PEPPER  →  SIZZLE  →  ...

Each borrowed weapon fires with its **parent character's full stats and its real
mechanic** — sizzle keeps bacon's burning trail, flake keeps the croissant's
velocity inheritance, pepper keeps the grinder's 3-pellet volley. Burrito does
not get watered-down copies; he gets the actual weapons.

`T.C.BURRITO_CYCLE = ['sizzle', 'flake', 'pepper']` — the cycle is data, in that
order, so the balance harness can reorder or retune it without touching logic.

The classic **one-live-shot-on-screen** rule still applies (a pepper volley of 3
pellets counts as one shot, exactly as it does for the pepper grinder). Refire
after each shot is that weapon's own refire, so the rhythm changes as the cycle
turns — sizzle 0.22, flake 0.20, pepper 0.48 as currently tuned.

The cycle position is **per ship**, advances only on a shot that actually fires,
and RESETS to index 0 on death and at the start of a new game. It PERSISTS across
a wave change. Two players both on burrito have completely independent cycles.

### Advantage and drawback

    advantage  'THREE WEAPONS — TRAIL, CURVE AND SPREAD'
    drawback   'YOU DO NOT GET TO CHOOSE WHICH'

That is the honest trade and it must be TRUE in play: burrito has the roster's
widest tactical coverage and **zero control over it**. When you need the spread,
you may be holding the noodle. One shot in three is the slow pepper volley.

### Balance

SPEC-CHARACTERS.md section 5 is not relaxed for him. BURRITO must be measured by
the same harness, with the same scripted bot, and must land **within ±20% of the
roster median** on both mean time-to-clear and mean waves-survived, and must not
be a strict superset of any other character.

The dedicated balance dial is `T.C.BURRITO_REFIRE_MULT` (default 1.0), a
multiplier applied to whichever weapon's refire he just fired. Tune THAT rather
than the borrowed weapons — changing sizzle/flake/pepper would move bacon, the
croissant and the pepper grinder, all three of which are already in band.

If he cannot be brought into band with the multiplier alone, the next lever is
the cycle order or its length — never the parent weapons.

## 2. THE UNLOCK

- Trigger: **a board reaches wave 5**. In classic (alternating turns) mode,
  either player reaching wave 5 counts.

  **Being in wave 5 is the whole condition. Nothing else is required.** The unlock
  fires the INSTANT wave 5 begins — the moment the wave counter becomes 5 — not
  when it is cleared. To be explicit, because this is the kind of thing that gets
  implemented one notch too strict:
    - You do NOT have to clear wave 5, or wave 4, or reach wave 6.
    - You do NOT have to survive wave 5. Dying one second in still unlocks him,
      and he STAYS unlocked.
    - There is no score threshold, no accuracy requirement, no "without dying",
      no mode requirement, no both-players requirement.
    - Quitting to the title immediately after, or closing the tab, does not undo
      it — it is written to storage at the moment it fires.
    - It does not matter which character you were playing, or whether you were on
      keyboard, a gamepad or touch.
  If a player sees "WAVE 5" on the HUD, burrito is theirs.
- Fires **once**. Persist to `localStorage` under `toasterInvaders.unlocked`
  (a JSON array of unlocked ids, so more secrets can be added later), through
  `T.Util.storeGet` / `storeSet` so `file://` and private mode never throw. A
  device that cannot persist still unlocks for the current session.
- On unlock, show a **reveal banner** over the play field for ~2.5s — the
  burrito sprite, "SECRET UNLOCKED", his name, and a line telling the player he
  is now on the select screen. Play a distinct new audio cue, `unlockSecret`
  (a triumphant fanfare, richer than `extraLife`, distinct from `jackpot`).
  The banner must not obscure the formation for longer than its duration and
  must not pause or otherwise disturb play.
- **Until unlocked he does not exist**: not in the select carousel, not in the
  roster strip, not in the title attract loop, not in any count of characters
  shown to the player. He is a secret, not a greyed-out slot.
- Once unlocked he is the **tenth entry**, appended after `milk` in
  `T.C.CHARACTER_ORDER`, and behaves like any other character everywhere.

Add `T.Util.isUnlocked(id)` and `T.Util.unlock(id)` so the check is in one place
and every caller shares the same storage semantics.

## 3. VARIANTS

He gets **3 cosmetic variants** like every other character (30 versions total),
following SPEC-VARIANTS.md exactly — palette key plus optional overlay, no stat
fields, index 0 the default:

    burrito.0   CARNE ASADA    charred foil, dark filling
    burrito.1   BREAKFAST      pale egg-yellow filling, bacon fleck
    burrito.2   MISSION        bright foil, salsa red

The variant-parity harness must cover him: all three variants bit-identical in
gameplay, visibly distinct in pixels, index 0 unchanged.

## 4. ART

Same pixel-map pipeline, post-scale logical px. He reuses the existing `sizzle`,
`flake` and `pepperPellet` projectile sprites — **no new projectile art**.

    'burrito0','burrito1'   44 x 34   a foil-wrapped burrito standing on end:
                                      the wrap folded open at the top showing
                                      filling, a foil sheath with creases and a
                                      bright highlight, a determined face. Must
                                      read instantly as a burrito, and must match
                                      the roster's existing eye/brow style and
                                      outline treatment — read bread0 and jam0
                                      first and match that family.
    'lifeBurrito'           22 x 17   half-size icon, same treatment as the
                                      other nine life icons.

## 5. UI

- **Select screen**: appears as the tenth character only when unlocked. His panel
  shows the cycle explicitly — `SIZZLE ▸ FLAKE ▸ PEPPER` — because a player must
  understand what "WRAPPED" means before picking him.
- **HUD weapon chip**: shows the cycle with the **next** weapon highlighted, so
  you always know what you are about to fire. This is not decoration; without it
  the character is unplayable. It must fit the existing chip footprint and work
  mirrored for P2.
- **Touch**: nothing new to press — he is selected with the same carousel
  controls as everyone else. Verify the tenth entry is reachable on touch.
- Anywhere the game states how many characters there are, the number must be
  correct for the player's unlock state (nine locked, ten unlocked).

## 6. QUALITY BAR

- The cycle is real: three different mechanics fire in order, each with its
  parent's behaviour, verified by trajectory, not by reading the code.
- Measured in band, same harness, same bot, same seeds.
- No regression to the nine characters, the 27 variants, the 15 upgrades, either
  game mode, keyboard, gamepad or touch.
- Picking up a weapon-upgrade token overrides the cycle exactly like any other
  character, and running out reverts to burrito's cycle at its current position.
