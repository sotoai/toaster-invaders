# TOASTER INVADERS — CHARACTER VARIANTS (spec addendum)

Extends SPEC.md, SPEC-WEAPONS.md and SPEC-CHARACTERS.md. All HARD RULES from
SPEC.md section 0 still apply.

Every one of the 9 playable characters gets **3 variants**, for **27 playable
versions**. Jam becomes STRAWBERRY / PEANUT BUTTER / MARMALADE. The milk carton's
splash becomes WHOLE MILK / LEMONADE / CHOCOLATE.

## 1. THE GOVERNING RULE: VARIANTS ARE COSMETIC

**A variant changes identity, never numbers.** Same speed, same hitbox, same
refire, same mechanic, same everything the balance harness measures.

This is deliberate and non-negotiable, for two reasons:

1. SPEC-CHARACTERS.md section 5 required every character to sit within ±20% of the
   roster median, measured. If variants changed stats, that becomes a 27-way
   balance problem and the guarantee the user asked for ("make sure not to make any
   too OP") quietly stops holding. Cosmetic variants inherit their character's
   proven balance exactly.
2. It is how fighting games ship alt costumes, and players read it immediately.

What a variant MAY change:
  display name, character sprite palette, a small optional detail overlay on the
  sprite, projectile sprite palette + optional overlay, particle/trail colour,
  the fire sound's timbre, and its one-line flavour text.

What a variant MUST NOT change:
  speed, hitbox width or height, refire, damage, bunker interaction, pellet count,
  range, bounce count, growth, trail duration, or any other value in
  T.C.BASE_WEAPONS. **Enforced by test — see section 6.**

## 2. THE 27

| character | variant 1 (default) | variant 2 | variant 3 |
|---|---|---|---|
| Untoasted Bread | **BUTTER** golden pat | **GARLIC BUTTER** pale green flecks | **CINNAMON SUGAR** dusty tan sparkle |
| Jam Jar | **STRAWBERRY** deep red | **PEANUT BUTTER** chunky mid-brown | **MARMALADE** amber with peel |
| Croissant | **CLASSIC** buttery gold | **ALMOND** pale flaked white | **PAIN AU CHOCOLAT** dark cocoa |
| Coffee Mug | **BLACK COFFEE** near-black | **LATTE** creamy tan | **MATCHA** vivid green |
| Pepper Grinder | **BLACK PEPPER** charcoal | **CHILLI FLAKES** hot red | **SEA SALT** bright white |
| Honey Dipper | **WILDFLOWER** gold | **AGAVE** pale amber | **MOLASSES** near-black, glossy |
| Cheese Wedge | **CHEDDAR** orange | **SWISS** pale yellow, big holes | **BLUE** white with blue veins |
| Bacon Strip | **STREAKY** pink and cream | **MAPLE GLAZED** dark amber | **VEGGIE** implausibly bright red |
| Milk Carton | **WHOLE MILK** white | **LEMONADE** pale yellow, fizzing | **CHOCOLATE** rich brown |

Variant ids are `<characterId>.<n>` (e.g. `jam.1`, `milk.2`), n = 0,1,2, with
n = 0 the default so existing behaviour is unchanged for a player who never opens
the variant picker.

## 3. ARCHITECTURE — PALETTE SWAPS, NOT 54 NEW SPRITES

Do NOT hand-author 27 character sprite pairs. Quality would collapse and the
roster would stop looking like one family.

Instead, extend the existing pixel-map pipeline with **per-variant colour keys**:

- Each character keeps ONE pair of pixel maps (idle / firing recoil) — the ones
  that already exist.
- Each variant supplies its own KEY object mapping the same map characters to
  different palette colours.
- A variant MAY additionally supply a small **overlay map** of the same dimensions,
  composited on top after the base map, for detail that palette alone cannot carry:
  Swiss cheese holes, peanut butter's chunky texture, lemonade's bubbles,
  marmalade's peel, chocolate chips. `.` remains transparent in an overlay.
- Same approach for each weapon's projectile sprite.

    T.Sprites.buildVariant(baseMapName, variantId, key, overlayMap)
    T.Sprites.variantName(spriteName, variantId)   -> the cached sprite name

Rasterize every variant once at boot, cached like every other sprite. Boot cost
must stay negligible; if it does not, rasterize a variant lazily on first use and
cache it.

New palette entries needed in `T.C.PAL` for the variant colours (garlic green,
peanut brown, marmalade amber, matcha green, chilli red, molasses black, swiss
pale, blue-cheese veins, maple amber, lemonade yellow, chocolate brown, etc.).
Add them to the existing PAL block; do not invent hex inline.

## 4. DATA

Extend `T.C.BASE_WEAPONS[characterId]` with a `variants` array of exactly 3:

    { id, name, flavour, key, overlay, shotKey, shotOverlay, trailColor, sfxDetune }

- `name` is what the select screen and HUD show (e.g. "PEANUT BUTTER").
- `flavour` is one short line for the select screen. Make them funny.
- `sfxDetune` is a small cents offset applied to that character's existing fire
  sound so variants sound related but distinct. It must not change the sound's
  length or gain — timbre only. Range roughly -300..+300 cents.
- The stat fields stay ONLY on the parent character. A variant object must not
  carry speed, hitbox, refire or any other tunable — enforced by section 6.

## 5. SELECT SCREEN + HUD

- The 9-character carousel gains a **variant row**: with a character highlighted,
  UP/DOWN (stick, D-pad, W/S, arrows) or LB/RB cycles its 3 variants. Show the
  variant name, its flavour line, and the live preview updating to that variant's
  palette. Make it obvious a variant picker exists — a player who never finds it
  is a failed feature.
- Both players choose character AND variant independently. When both pick the same
  character, DIFFERENT variants are the primary way they tell each other apart, so
  default P2 to variant index 1 when P1 has already taken index 0 of that character.
- Remember each player's last character+variant in localStorage via
  `T.Util.storeGet/storeSet` under `toasterInvaders.p1` / `.p2`, wrapped so
  file:// and private mode never throw.
- HUD: the weapon chip shows the VARIANT name (e.g. "PEANUT BUTTER", not "JAM"),
  and the life icons use the variant's palette.

## 6. THE COSMETIC GUARANTEE MUST BE TESTED

Write `variant-parity.js` in the scratchpad. It must, for all 27 variants:

- Assert that for each character, its 3 variants produce **bit-identical gameplay**:
  equip each variant on an identical seeded board, fire from an identical position,
  and assert the projectile trajectories (per-frame x, y, vx, vy, w, h), the
  collision outcomes, the ammo/refire timing and the kill counts are IDENTICAL
  across all three. Any divergence is a balance leak and must be fixed.
- Assert no variant object carries any of the tunable stat fields (speed, hitbox,
  refire, range, pellets, bounces, growth, trail time). Scan the data, do not trust
  the code.
- Assert all 27 render without error and produce visually DISTINCT output: compare
  the rasterized sprite pixels between the 3 variants of each character and require
  a meaningful fraction of differing pixels, so a variant that silently failed to
  apply its palette is caught.
- Assert the existing `character-balance.js` numbers are unchanged —
  variants must not move the balance table at all.

Report the results. Fix the code, never the assertion.
