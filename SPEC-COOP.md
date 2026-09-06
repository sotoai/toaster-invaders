# TOASTER INVADERS — SHARED HEARTS AND DOWNED PLAYERS (spec addendum)

Extends SPEC.md and SPEC-CHARACTERS.md. All HARD RULES from SPEC.md section 0
still apply.

Revises **CO-OP** multiplayer, modelled on Crossy Castle: players share one pool of
**hearts**, and dying takes you out of the wave rather than costing the team a
heart. Your partner can save the run by finishing the wave without you.

## 1. SCOPE — WHAT CHANGES AND WHAT DOES NOT

| mode | behaviour |
|---|---|
| **CO-OP with 2 players** | **Everything in this document.** Shared hearts, downed players, wave-based revival. |
| **CO-OP with 1 player** | Unchanged in feel: a death costs a heart and you respawn, exactly as lives work today. There is no partner to be saved by, so a death that cost nothing would make the game unloseable. |
| **CLASSIC (alternating turns)** | Completely unchanged. It is already turn-based and each player owns their own board and their own hearts. |

## 2. THE RULES

1. **One shared pool of hearts** for the team, not one pool per player.
   `T.C.HEARTS_COOP` (default **3**).
2. **Dying puts you DOWN, it does not cost a heart.** Your ship leaves play. You
   are out for the rest of the wave. You keep your score, your character and your
   weapon.
3. **You come back when either of these happens:**
   - **the next wave starts** — your partner cleared it without you; or
   - **your partner also goes down.**
4. **A heart is lost only when every player is down at the same time.** At that
   moment: subtract one heart, and **both players revive immediately, mid-wave**,
   at their spawn positions with the usual respawn invulnerability. The formation
   does NOT reset — it stays exactly where it marched to.
5. **If one player is down and the other clears the wave, NO heart is lost.** The
   downed player returns at the start of the next wave. This is the point of the
   mechanic: a good partner makes your death free.
6. **Game over** when the team is on its last heart and everyone goes down
   together. Toasters reaching the bunker line is still an immediate game over
   regardless of hearts, exactly as today.
7. **The extra life at `T.C.EXTRA_LIFE_AT` adds a heart to the shared pool**, once,
   capped at `T.C.HEARTS_MAX` (default 5) so it cannot grow without limit.
8. Both players down simultaneously in the same frame is ONE heart, not two.

### The clause that has two readings, and which one this is

"their turn is over until the next wave or until the other player dies" is
implemented as rule 3 + rule 4 above: **the partner going down revives you, and
that is the same event that costs the team a heart.** Both players come back and
the wave continues from where it stands. The alternative reading — that the
partner's death revives you while they stay down, handing the wave back and forth
one player at a time — is NOT what this implements, because it would make a
two-player run strictly longer than a solo one and would never actually end.

## 3. STATE

A ship in co-op is in one of: `active`, `dying` (the existing death animation),
`down`, or `out` (the run is over). `down` is new.

- A `down` ship is not drawn in the play field, takes no input that affects play,
  fires nothing, and cannot be hit. It still owns its score, character, variant
  and weapon, and its player can still use START (pause) and BACK.
- Revival clears `down`, restores the ship at its spawn x with
  `T.C.SHIP_RESPAWN_DELAY` invulnerability, and **resets that ship's weapon to its
  character's base weapon** — consistent with the existing rule that dying loses
  your upgrade. A burrito's cycle resets to index 0.
- Downed players must still be able to catch nothing and collide with nothing:
  audit every collision list for a `down` ship.

## 4. HEARTS IN THE HUD

Hearts replace the per-player life-icon rows in co-op.

- One shared heart row, **centred** beneath the HI-SCORE so it reads as the team's,
  not either player's. Full hearts and empty sockets so the total is legible at a
  glance.
- Each player's side of the HUD keeps their score, their character life icon as an
  identity marker, and their weapon chip.
- A **down** player's side of the HUD is clearly marked `DOWN` with what they are
  waiting for — `NEXT WAVE`. It must be obvious to the player who is down that
  they are not simply broken.
- In 1P co-op and in classic, hearts represent that board's own pool and render in
  the position the life icons use today.
- Losing a heart is a moment: flash the row, play a distinct cue.

New sprites, same pixel-map pipeline, post-scale logical px:

    'heart'       18 x 16   a full heart, palette-consistent with the HUD
    'heartEmpty'  18 x 16   the empty socket, same silhouette

New audio cue `heartLost` — heavier than `playerDie`, clearly a team setback.
New cue `revive` for a player coming back.

## 5. FEEDBACK — A DOWNED PLAYER MUST NOT FEEL BROKEN

The failure mode of this feature is a player who has died, sees nothing, and
thinks the game has hung or their controller has disconnected.

- On going down: a short banner naming who went down and that their partner can
  save them.
- While down: a persistent, unobtrusive marker — `PLAYER 2 IS DOWN — CLEAR THE
  WAVE TO REVIVE THEM` — visible to BOTH players, and their control column /
  HUD side clearly in a downed state.
- On revival: a visible spawn-in and the `revive` cue, so you know you are back
  before you try to move.

## 6. BALANCE — THIS MAKES CO-OP SUBSTANTIALLY MORE FORGIVING

Two changes pull hard in opposite directions and the net effect must be MEASURED,
not guessed:

- Co-op today has `T.C.LIVES` (3) per player, i.e. **6 deaths** for a duo. This
  changes it to **3 shared hearts** — harsher.
- But most deaths now cost nothing at all — far more forgiving.

Extend the balance rig to a two-player co-op scenario driven by two instances of
the existing scripted bot, and measure, before and after this change:
mean waves survived by the team, mean hearts remaining at wave 5, how often a
death is "free" (partner cleared the wave), and how often both go down together.

`T.C.HEARTS_COOP` is the dial. Report the measured numbers and say plainly whether
co-op got easier or harder. If a duo of competent bots becomes effectively
unloseable, that is a finding worth reporting even though the mechanic is working
as specified — say so rather than shipping a mode with no failure state.

The nine measured single-player characters must NOT move: solo balance is
untouched by this change, and the existing `character-balance.js` table must come
back byte-identical.

## 7. QUALITY BAR

- Every rule in section 2 is verified by simulation, not by reading the code.
- No regression to 1P, to CLASSIC, to the ten characters, the 30 variants, the 15
  upgrades, touch, keyboard or gamepad.
- A downed ship cannot be hit, cannot fire, cannot catch a token, and cannot be
  collided with by anything.
- The game can still be lost. Verify a co-op run reaches game over.
