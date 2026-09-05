/* ===========================================================================
 * TOASTER INVADERS — js/ui.js
 *
 * ROLE: everything the player READS. Title, character select, HUD, wave
 * banner, pause, game over, the CRT overlay and the controller hint.
 *
 * SECRETS: this file is also what keeps one. The tenth character is ordinary
 * data everywhere else in the game and ABSENT here until T.Util.isUnlocked
 * says otherwise — off the carousel, off the roster strip, out of the count —
 * and then, for about two and a half seconds, the loudest thing on the screen
 * (SPEC-BURRITO.md §2 and §5).
 *
 * This file owns no game state. It reads live values off the board / game
 * objects it is handed and draws them. The only things it keeps between
 * frames are (a) cached offscreen canvases (the CRT overlay, glyph metrics),
 * (b) purely derived animation values, all computed from T.Util.now() so
 * there is nothing to tick and nothing to get out of sync, and (c) the
 * tapped-flash's id and start time (section 4) — presentation only, started
 * from T.Util.now() like everything else, and read by nothing but this file.
 *
 * HIT REGIONS: because a canvas has no DOM children, nothing drawn here can
 * be hit-tested unless this file says where it put things. So as each
 * interactive thing is drawn its rectangle is recorded — in logical 960x720
 * coordinates, as declarative DATA and never a callback — and published
 * through beginRegions / addRegion / regions (section 4, SPEC-TOUCHUI.md §2).
 * touch.js routes a tap; game.js's uiTap is the only place one is acted on.
 * That is what makes the third variant thumbnail select variant 2 instead of
 * cycling toward it, and it costs the keyboard and the pad nothing.
 *
 * The one exception, and it is deliberate: the select screen REMEMBERS each
 * player's character + variant through T.Util.storeGet / storeSet, under
 * `toasterInvaders.p1` and `.p2` (SPEC-VARIANTS.md §5). That is still not
 * state this file owns — it is the pick it was just handed, written out at
 * most once per actual change, through a wrapper that cannot throw.
 *
 * PROMPTS: every line that names a control is resolved through the touch
 * helpers in section 3 before it is drawn, so an iPad reads the labels that
 * are actually on its glass (TAP TO START, FIRE, BACK, the P2 join target)
 * and a keyboard or a pad reads exactly the words it always did. T.Touch is
 * optional and every call to it is guarded — SPEC-TOUCH.md §2 and §4.
 *
 * TEXT LOOK: a monospace stack rendered UPPERCASE and drawn ONE CHARACTER AT
 * A TIME with a fixed advance, so the tracking is wide and even like an
 * arcade cabinet's character ROM instead of default browser text. Headings
 * get a shadowBlur glow. Every routine save()s and restore()s the context.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const C = T.C;
  const PAL = C.PAL;
  const U = T.Util;

  /* =========================================================================
   * 1. RETRO TEXT ENGINE
   * ====================================================================== */

  const FONT_STACK = '"Courier New", Courier, monospace';

  // measureText is not free, and every glyph in a monospace face is the same
  // width, so one measurement per (size, weight) is all we ever need.
  const glyphWidths = Object.create(null);

  /** Build the canvas font string for a size / weight. */
  function fontFor(size, bold) {
    return (bold ? 'bold ' : '') + size + 'px ' + FONT_STACK;
  }

  /** Width of a single glyph at this size / weight (cached). */
  function glyphWidth(ctx, size, bold) {
    const key = size + (bold ? 'b' : 'n');
    let w = glyphWidths[key];
    if (w === undefined) {
      const prevFont = ctx.font;
      ctx.font = fontFor(size, bold);
      w = ctx.measureText('M').width;
      ctx.font = prevFont;
      glyphWidths[key] = w;
    }
    return w;
  }

  /** Default tracking (extra px between characters) for a given size. */
  function defaultSpacing(size) {
    return Math.max(1, Math.round(size * 0.22));
  }

  /** Per-character advance: glyph box + tracking. */
  function advanceFor(ctx, size, bold, spacing) {
    return glyphWidth(ctx, size, bold) + spacing;
  }

  /**
   * Total pixel width a string will occupy with the same options drawText
   * would use. Handy for underlines, boxes and right-aligned columns.
   */
  function textWidth(ctx, str, opts) {
    opts = opts || {};
    const size = Math.max(4, Math.round(opts.size || 16));
    const bold = !!opts.bold;
    const spacing = opts.spacing === undefined ? defaultSpacing(size) : opts.spacing;
    const n = String(str === null || str === undefined ? '' : str).length;
    if (n === 0) return 0;
    return n * advanceFor(ctx, size, bold, spacing) - spacing;
  }

  /**
   * Draw a string of arcade text.
   *
   *   opts = {
   *     size:    px height          (default 16)
   *     color:   fill               (default PAL.ui)
   *     align:   'left'|'center'|'right'
   *     glow:    true | px radius   (shadowBlur halo in `glowColor` or color)
   *     glowColor, alpha, bold, spacing, shadow (drop shadow for legibility)
   *   }
   *
   * `y` is the vertical CENTRE of the line — that makes banners and rows
   * trivial to lay out. Returns the width drawn.
   */
  function drawText(ctx, str, x, y, opts) {
    opts = opts || {};
    const text = String(str === null || str === undefined ? '' : str).toUpperCase();
    if (text.length === 0) return 0;

    const size = Math.max(4, Math.round(opts.size || 16));
    const bold = !!opts.bold;
    const color = opts.color || PAL.ui;
    const align = opts.align || 'left';
    const spacing = opts.spacing === undefined ? defaultSpacing(size) : opts.spacing;
    const step = advanceFor(ctx, size, bold, spacing);
    const total = text.length * step - spacing;

    let x0 = x;
    if (align === 'center') x0 = x - total / 2;
    else if (align === 'right') x0 = x - total;

    ctx.save();
    ctx.font = fontFor(size, bold);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (opts.alpha !== undefined) ctx.globalAlpha = U.clamp(opts.alpha, 0, 1);

    const yi = Math.round(y);

    // Optional hard drop shadow: keeps small text readable over the starfield.
    if (opts.shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        if (ch === ' ') continue;
        ctx.fillText(ch, Math.round(x0 + i * step) + 2, yi + 2);
      }
    }

    if (opts.glow) {
      ctx.shadowColor = opts.glowColor || color;
      ctx.shadowBlur = (opts.glow === true) ? Math.round(size * 0.7) : opts.glow;
    }

    ctx.fillStyle = color;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (ch === ' ') continue;             // nothing to paint, skip the call
      ctx.fillText(ch, Math.round(x0 + i * step), yi);
    }

    ctx.restore();
    return total;
  }

  /* =========================================================================
   * 2. SMALL DRAWING PRIMITIVES
   * ====================================================================== */

  /** Zero-padded score, arcade style. */
  function pad(n, len) {
    let s = String(Math.max(0, Math.floor(Number(n) || 0)));
    while (s.length < len) s = '0' + s;
    return s;
  }

  /** 0..1 triangle-free sine pulse. */
  function pulse(t, speed, lo, hi) {
    const k = 0.5 + 0.5 * Math.sin(t * speed);
    return lo + (hi - lo) * k;
  }

  /** A sprite record, or null if sprites are not built / the name is unknown. */
  function sprite(name) {
    const S = T.Sprites;
    if (!S || typeof S.get !== 'function') return null;
    try {
      const s = S.get(name);
      return (s && s.canvas) ? s : null;
    } catch (err) {
      return null;                          // never let missing art throw
    }
  }

  /** Blit a sprite with its top-left at x,y. Returns false if unavailable. */
  function blit(ctx, name, x, y) {
    const s = sprite(name);
    if (!s) return false;
    ctx.drawImage(s.canvas, Math.round(x), Math.round(y), s.w, s.h);
    return true;
  }

  /** Blit centred on cx,cy, optionally magnified (nearest-neighbour). */
  function blitCentered(ctx, name, cx, cy, scale) {
    const s = sprite(name);
    if (!s) return false;
    const k = scale || 1;
    const w = s.w * k;
    const h = s.h * k;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(s.canvas, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
    ctx.restore();
    return true;
  }

  /**
   * Blit centred and magnified, optionally through T.Sprites.tint's cached
   * recolour. The select screen lets both players sit on the SAME character,
   * so P2's preview and roster pip are washed with the p2 accent to keep the
   * two panels tellable apart at a glance (SPEC-CHARACTERS.md §4).
   *
   * tint() throws on an unknown sprite exactly like get() does, so the whole
   * lookup is guarded and falls back to the untinted blit.
   */
  const PREVIEW_TINT = 0.34;          // gentle: an accent, not a silhouette
  function blitTinted(ctx, name, cx, cy, scale, color) {
    if (color) {
      const S = T.Sprites;
      if (S && typeof S.tint === 'function') {
        try {
          const s = S.tint(name, color, PREVIEW_TINT);
          if (s && s.canvas) {
            const k = scale || 1;
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(s.canvas, Math.round(cx - s.w * k / 2),
                          Math.round(cy - s.h * k / 2), s.w * k, s.h * k);
            ctx.restore();
            return true;
          }
        } catch (err) { /* fall through to the plain blit */ }
      }
    }
    return blitCentered(ctx, name, cx, cy, scale);
  }

  // 'icon_' + id, interned per weapon id. drawWeaponIcon runs every frame for
  // both chips, the banner and the title strip, and §12 forbids allocating in
  // a per-frame path — weapons.js interns the same string on the token.
  const iconNames = Object.create(null);
  function iconNameFor(id) {
    let n = iconNames[id];
    if (n === undefined) {
      n = 'icon_' + id;
      iconNames[id] = n;
    }
    return n;
  }

  /**
   * A weapon's 16x16 roundel icon, centred on cx,cy.
   *
   * sprites.js rasterizes one 'icon_<id>' per roster entry, but ui.js is the
   * last file to draw and must never be the reason a frame throws: if the icon
   * is missing we stamp a chrome-rimmed pip in the weapon's own colour, which
   * still reads as "an upgrade" at a glance. (The NINE base weapons have no
   * icon by design — SPEC-WEAPONS §6 lists fifteen, all droppable — which is
   * why the HUD chip identifies a base weapon by its character's life icon
   * instead of asking for a roundel that was never drawn.)
   *
   * `alpha` MULTIPLIES whatever the caller has already set, so an icon fades
   * with the banner it sits in and dims with an out player's chip.
   */
  function drawWeaponIcon(ctx, def, cx, cy, scale, alpha) {
    if (!def) return;
    const k = scale || 1;
    ctx.save();
    ctx.globalAlpha *= U.clamp(alpha === undefined ? 1 : alpha, 0, 1);
    if (!blitCentered(ctx, iconNameFor(def.id), cx, cy, k)) {
      const r = Math.round(8 * k);
      const b = Math.max(1, Math.round(2 * k));
      ctx.fillStyle = PAL.chromeDk;
      ctx.fillRect(Math.round(cx - r), Math.round(cy - r), r * 2, r * 2);
      ctx.fillStyle = def.color || PAL.ui;
      ctx.fillRect(Math.round(cx - r) + b, Math.round(cy - r) + b,
                   r * 2 - b * 2, r * 2 - b * 2);
    }
    ctx.restore();
  }

  /**
   * A hand-drawn infinity sign: two overlapping stroked circles. Base weapons
   * never run out, so the HUD chip shows this where an ammo bar would go —
   * drawn rather than typed, because the monospace stack cannot be trusted to
   * carry the glyph on every machine. `alpha` multiplies the caller's, so the
   * glyph dims with the rest of an out player's chip.
   */
  function infinityGlyph(ctx, cx, cy, w, color, alpha) {
    const r = w / 4;
    ctx.save();
    ctx.globalAlpha *= U.clamp(alpha === undefined ? 1 : alpha, 0, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx - r, cy, r, 0, Math.PI * 2);
    ctx.moveTo(cx + r * 2, cy);          // break the path so the loops do not join
    ctx.arc(cx + r, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * LEGIBILITY
   *
   * A variant's colour is chosen to look right ON THE SHIP — molasses is
   * near-black and glossy, black coffee is burnt brown, and both are correct
   * as paint. As TEXT on a dark panel they are close to invisible, and the
   * select screen has to be able to print any of the 27 names in its own
   * colour without one of them disappearing.
   *
   * So a colour whose BRIGHTEST CHANNEL is too low gets every channel
   * multiplied by the same factor, until that channel reaches the floor. That
   * keeps the hue and the saturation ratio exactly — molasses stays a brown,
   * matcha stays a green — and, because the factor is set by the channel that
   * would clip first, nothing ever clips and washes toward white.
   *
   * Brightest-channel, not luminance, on purpose: luminance weights green at
   * 0.72 and blue at 0.07, so it calls a saturated red dark and would wash
   * VEGGIE bacon's whole point out of it. What actually decides whether ink
   * shows up on a near-black panel is how far the strongest channel is from
   * the background, which is what this measures. Colours already above the
   * floor are returned untouched, and every answer is cached, because this
   * runs in the per-frame select path.
   * ---------------------------------------------------------------------- */
  const TEXT_MIN_CHANNEL = 150;   // 0..255 the brightest channel must reach
  const legibleCache = Object.create(null);

  function legible(color) {
    if (typeof color !== 'string') return PAL.ui;
    const hit = legibleCache[color];
    if (hit !== undefined) return hit;

    let out = color;
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (m) {
      const hex = m[1];
      const short = hex.length === 3;
      const r = parseInt(short ? hex[0] + hex[0] : hex.slice(0, 2), 16);
      const g = parseInt(short ? hex[1] + hex[1] : hex.slice(2, 4), 16);
      const b = parseInt(short ? hex[2] + hex[2] : hex.slice(4, 6), 16);
      const top = Math.max(r, g, b);
      if (top > 0 && top < TEXT_MIN_CHANNEL) {
        const k = TEXT_MIN_CHANNEL / top;
        out = 'rgb(' + Math.round(r * k) + ',' + Math.round(g * k) + ',' +
                       Math.round(b * k) + ')';
      }
    }
    legibleCache[color] = out;
    return out;
  }

  /** Stand-in block used only if sprites somehow are not ready yet. */
  function previewFallback(ctx, cx, cy, w, h, color) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
    ctx.restore();
  }

  /** A dark translucent wash over the whole screen. */
  function dim(ctx, alpha) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,' + alpha + ')';
    ctx.fillRect(0, 0, C.W, C.H);
    ctx.restore();
  }

  /** Arcade panel: dark fill, 2px accent border, inner hairline, corner ticks. */
  function panel(ctx, x, y, w, h, color, alpha) {
    const a = alpha === undefined ? 1 : alpha;
    ctx.save();
    ctx.globalAlpha = a * 0.72;
    ctx.fillStyle = 'rgba(6,8,14,0.82)';
    ctx.fillRect(x, y, w, h);

    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillRect(x + w - 2, y, 2, h);

    ctx.globalAlpha = a * 0.22;
    ctx.fillRect(x + 6, y + 6, w - 12, 1);
    ctx.fillRect(x + 6, y + h - 7, w - 12, 1);
    ctx.fillRect(x + 6, y + 6, 1, h - 12);
    ctx.fillRect(x + w - 7, y + 6, 1, h - 12);

    // corner ticks
    ctx.globalAlpha = a;
    const tk = 12;
    ctx.fillRect(x + 6, y + 6, tk, 3);
    ctx.fillRect(x + w - 6 - tk, y + 6, tk, 3);
    ctx.fillRect(x + 6, y + h - 9, tk, 3);
    ctx.fillRect(x + w - 6 - tk, y + h - 9, tk, 3);
    ctx.restore();
  }

  /** Solid chevron pointing left (dir -1) or right (dir +1). */
  function chevron(ctx, x, y, size, dir, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (dir < 0) {
      ctx.moveTo(x + size * 0.55, y - size);
      ctx.lineTo(x - size * 0.55, y);
      ctx.lineTo(x + size * 0.55, y + size);
    } else {
      ctx.moveTo(x - size * 0.55, y - size);
      ctx.lineTo(x + size * 0.55, y);
      ctx.lineTo(x - size * 0.55, y + size);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Small triangle used by the mode selector (dir -1 up, +1 down). */
  function triangle(ctx, x, y, size, dir, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (dir < 0) {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x - size, y + size * 0.7);
      ctx.lineTo(x + size, y + size * 0.7);
    } else {
      ctx.moveTo(x, y + size);
      ctx.lineTo(x - size, y - size * 0.7);
      ctx.lineTo(x + size, y - size * 0.7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * A filled chip with a tick struck through it — "this one is SELECTED".
   *
   * Drawn rather than typed for the same reason the infinity glyph is: the
   * monospace stack cannot be trusted to carry a check mark, and a missing
   * glyph would put a tofu box on the thing the player just chose. The chip
   * carries a hard dark keyline so it reads over whatever art it lands on
   * (SPEC-TOUCHUI.md §5 — on a touchscreen there is no hover, so the current
   * choice has to be marked, not merely lit).
   */
  function selectedTick(ctx, x, y, size, color) {
    const s = Math.max(8, Math.round(size));
    ctx.save();
    ctx.fillStyle = 'rgba(6,8,14,0.85)';
    ctx.fillRect(x - 1, y - 1, s + 2, s + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = '#0b0c12';
    ctx.lineWidth = Math.max(2, Math.round(s * 0.16));
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.22, y + s * 0.52);
    ctx.lineTo(x + s * 0.42, y + s * 0.74);
    ctx.lineTo(x + s * 0.80, y + s * 0.26);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The chrome wordmark. Characters are drawn individually with a shared
   * vertical chrome gradient (fixed in screen space, so it reads as a
   * reflection) plus a per-character sine bob that rolls along the word.
   */
  const gradientCache = Object.create(null);
  function chromeGradient(ctx, top, bottom) {
    const key = Math.round(top) + ':' + Math.round(bottom);
    let g = gradientCache[key];
    if (!g) {
      g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0.00, PAL.chromeLt);
      g.addColorStop(0.42, PAL.chrome);
      g.addColorStop(0.52, PAL.chromeDk);
      g.addColorStop(0.62, PAL.chrome);
      g.addColorStop(1.00, PAL.chromeLt);
      gradientCache[key] = g;
    }
    return g;
  }

  function drawWordmark(ctx, text, cx, y, size, t, phase) {
    const bold = true;
    const spacing = Math.round(size * 0.20);
    const step = advanceFor(ctx, size, bold, spacing);
    const chars = text.toUpperCase();
    const total = chars.length * step - spacing;
    const x0 = cx - total / 2;
    const grad = chromeGradient(ctx, y - size * 0.62, y + size * 0.62);

    ctx.save();
    ctx.font = fontFor(size, bold);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < chars.length; i++) {
      const ch = chars.charAt(i);
      if (ch === ' ') continue;
      const bob = Math.sin(t * 2.6 + phase + i * 0.42) * 3;
      const x = Math.round(x0 + i * step);
      const yy = Math.round(y + bob);

      // hard shadow so the wordmark sits on the night sky
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(ch, x + 4, yy + 4);

      ctx.shadowColor = PAL.glass;
      ctx.shadowBlur = 18;
      ctx.fillStyle = grad;
      ctx.fillText(ch, x, yy);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    return total;
  }

  /* =========================================================================
   * 3. READING THE LIVE GAME STATE
   *
   * ui.js is the last file to draw and the first to break if a field is
   * renamed, so every read goes through a tolerant probe with a sane default.
   * Nothing here ever throws, and nothing here writes.
   * ====================================================================== */

  /* -------------------------------------------------------------------------
   * THE ROSTER  (SPEC-CHARACTERS.md §2 and §4, SPEC-BURRITO.md §5)
   *
   * Nine playable characters — ten once the secret is earned; see THE SECRET
   * ROSTER below, which is what decides how many of these a player may SEE.
   * Every word and every number this file prints
   * about a character — its name, its weapon, the ADVANTAGE / DRAWBACK lines
   * and the three meters — is read out of T.C.BASE_WEAPONS. ui.js states no
   * balance figure of its own, so retuning the roster in util.js retunes this
   * screen with it and the select screen can never drift from what the ships
   * actually do.
   *
   * Built ONCE at load into an array in carousel order plus an id lookup. The
   * bar fractions are derived here rather than per frame because not one of
   * them can change while the game is running.
   * ---------------------------------------------------------------------- */

  /**
   * The widest horizontal band a base weapon presents — "how forgiving is the
   * aim", in logical px. A pepper volley covers its pellets side by side; the
   * milk splash is measured fully grown, because that is the shape its
   * advantage line is promising. Everything else is simply its own hitbox.
   */
  function spreadPx(row) {
    if (row.mech === 'volley') return Math.max(1, C.PEPPER_PELLETS) * row.w;
    if (row.mech === 'grow') return C.MILK_W_MAX;
    return row.w;
  }

  /**
   * How far up the screen a shot can climb, in px. Only the mug's drip is
   * capped (MUG_RANGE); every other base weapon runs the full climb from the
   * ship to the ceiling, which is exactly what CHAR_BAR_REACH_MAX measures.
   */
  function reachPx(row) {
    if (row.mech === 'range') return C.MUG_RANGE;
    return C.CHAR_BAR_REACH_MAX;
  }

  /** frac in 0..1 for a meter, guarding a missing or zero maximum. */
  function barFrac(value, max) {
    if (!max || !isFinite(max) || max <= 0) return 0;
    const v = (typeof value === 'number' && isFinite(value)) ? value : 0;
    return U.clamp(v / max, 0, 1);
  }

  /**
   * A character's three variants, as the select screen and the HUD read them
   * (SPEC-VARIANTS.md §4). Identity only — a variant carries a NAME, a
   * FLAVOUR line and a colour, and not one number, because a variant that
   * moved a number would take the measured ±20% balance band with it.
   *
   * `index` is the entry's position in the roster row, NOT its position in
   * this array: it is the number T.Sprites.variantName() rasterized the
   * palette swap under, so a malformed row may never shift it.
   */
  function makeVariants(row) {
    const src = Array.isArray(row.variants) ? row.variants : null;
    const out = [];
    if (!src) return out;
    for (let i = 0; i < src.length; i++) {
      const v = src[i] || {};
      out.push({
        id: v.id || (row.id + '.' + i),
        index: i,
        // A row missing its name falls back to the character's own weapon
        // name, which is what the HUD chip printed before variants existed.
        name: v.name || row.weapon,
        flavour: v.flavour || '',
        color: v.trailColor || row.color || PAL.ui
      });
    }
    return out;
  }

  /** One roster row → everything the select screen and the HUD read off it. */
  function makeCharEntry(row, index) {
    return {
      key: row.id,
      index: index,
      // Position in the roster the PLAYER can see, which is not the same list
      // while a secret is still locked (see THE SECRET ROSTER below).
      // Rewritten by visibleRoster(); -1 means "not on the visible list".
      visIndex: index,
      name: row.char,
      blurb: row.blurb,
      weapon: row.weapon,
      // Which mechanic the base weapon dispatches to. The one this file cares
      // about is 'cycle' — the rotating gun, the only weapon in the game that
      // changes while you play, and the only one whose panel and HUD chip have
      // to print more than a name (SPEC-BURRITO.md §5).
      mech: row.mech || 'plain',
      color: row.color || PAL.ui,
      sprite: row.ship,
      spriteFire: row.shipFire,
      life: row.life,
      advantage: row.advantage,
      drawback: row.drawback,
      variants: makeVariants(row),
      // Three meters, in a fixed order, each normalised against its own
      // T.C maximum so the nine panels are directly comparable.
      bars: [
        { label: 'SPEED',  frac: barFrac(row.speed, C.CHAR_BAR_SPEED_MAX) },
        { label: 'SPREAD', frac: barFrac(spreadPx(row), C.CHAR_BAR_SPREAD_MAX) },
        { label: 'REACH',  frac: barFrac(reachPx(row), C.CHAR_BAR_REACH_MAX) }
      ]
    };
  }

  /**
   * The WHOLE table, in T.C.CHARACTER_ORDER — the nine, and the secret tenth
   * at the end of it. What the carousel actually walks is visibleRoster();
   * this array exists so that CHARS, the HUD and the game-over card can look
   * any character up by id, unlocked or not.
   */
  const ROSTER = (function buildRoster() {
    const rows = C.BASE_WEAPONS || {};
    const order = C.CHARACTER_ORDER || Object.keys(rows);
    const out = [];
    for (let i = 0; i < order.length; i++) {
      const row = rows[order[i]];
      if (!row || !row.id) continue;
      out.push(makeCharEntry(row, out.length));
    }
    return out;
  })();

  const CHARS = Object.create(null);
  for (let i = 0; i < ROSTER.length; i++) CHARS[ROSTER[i].key] = ROSTER[i];

  /**
   * The stand-in used only if T.C somehow carries no roster at all. It claims
   * no stats and no art, because inventing either here is exactly the thing
   * the roster table exists to prevent — and it is a shared constant, not a
   * fresh object, because charInfo runs in the per-frame HUD path.
   */
  const NO_CHAR = {
    key: '', index: -1, visIndex: -1, name: '', blurb: '', weapon: '',
    mech: 'plain', color: PAL.uiDim, sprite: null, spriteFire: null, life: null,
    advantage: '', drawback: '', variants: [], bars: []
  };

  /* -------------------------------------------------------------------------
   * THE SECRET ROSTER  (SPEC-BURRITO.md §2 and §5)
   *
   * BURRITO is the tenth row of T.C.BASE_WEAPONS and the tenth id in
   * T.C.CHARACTER_ORDER — he is ordinary DATA, unconditionally, because being
   * a secret is a question of what this screen offers, not of the table having
   * a hole in it. Hiding him is THIS file's job, and the rule is absolute:
   *
   *   UNTIL HE IS UNLOCKED HE DOES NOT EXIST. Not a greyed-out slot, not a
   *   '???' pip, not a tenth box with a question mark in it — ABSENT. He is
   *   missing from the carousel, missing from the roster strip, missing from
   *   the ghosted neighbours either side of the preview, and missing from the
   *   COUNT: a locked player reads "3 OF 9", an unlocked one reads "3 OF 10".
   *
   * A '???' slot is not a secret, it is an advertisement for one, and it
   * would answer the question the whole feature exists to make a player ask.
   *
   * WHICH IDS ARE SECRET is read from T.C.SECRET_CHARACTERS when util.js
   * states one, so a second secret never means editing this file; the literal
   * below is the fallback for the build that ships today, where the unlock set
   * is one id long and lives in SPEC-BURRITO.md rather than in T.C.
   * ---------------------------------------------------------------------- */

  const SECRET_IDS = (function secretIds() {
    const stated = C.SECRET_CHARACTERS;
    if (Array.isArray(stated) && stated.length > 0) {
      const out = [];
      for (let i = 0; i < stated.length; i++) {
        if (typeof stated[i] === 'string' && stated[i]) out.push(stated[i]);
      }
      if (out.length > 0) return out;
    }
    return ['burrito'];
  })();

  const SECRET_SET = Object.create(null);
  for (let i = 0; i < SECRET_IDS.length; i++) SECRET_SET[SECRET_IDS[i]] = true;

  /** Is this character id one the player has to earn? */
  function isSecretId(key) {
    return SECRET_SET[key] === true;
  }

  /**
   * May the player SEE this character?
   *
   * Everything that is not a secret, always. A secret only once
   * T.Util.isUnlocked says so — and on a build with no unlock layer at all,
   * NOT: a missing storage helper is not permission to spoil the surprise,
   * and the failure this defaults to (a secret stays secret) is the harmless
   * one. Never throws; ui.js may not be the reason a frame dies.
   */
  function secretShown(key) {
    if (!isSecretId(key)) return true;
    if (!U || typeof U.isUnlocked !== 'function') return false;
    try {
      return U.isUnlocked(key) === true;
    } catch (err) {
      return false;
    }
  }

  /**
   * A bitmask of which secrets are currently visible — the cheap "has anything
   * changed?" question, asked once per frame by visibleRoster(). It allocates
   * nothing (§12): isUnlocked is an object lookup after its first call, and
   * the answer is an integer, not a rebuilt list.
   */
  function secretMask() {
    let m = 0;
    for (let i = 0; i < SECRET_IDS.length && i < 30; i++) {
      if (secretShown(SECRET_IDS[i])) m |= (1 << i);
    }
    return m;
  }

  let visRoster = ROSTER;
  let visMask = -1;

  /**
   * The roster AS THE PLAYER SEES IT — the nine, or the ten once burrito is
   * earned. This is what the carousel, the strip, the ghosts and every count
   * on the select screen walk; ROSTER itself stays the full table, because
   * CHARS, the HUD and the game-over card must still be able to look a
   * character up by id whether or not the select screen would offer him.
   *
   * Rebuilt only when the unlock state actually changes — once a session, at
   * the moment the reveal banner fires — so the per-frame path is one integer
   * compare and the array is never reallocated underneath a render.
   */
  function visibleRoster() {
    const m = secretMask();
    if (m === visMask) return visRoster;
    visMask = m;
    const out = [];
    for (let i = 0; i < ROSTER.length; i++) {
      const e = ROSTER[i];
      if (!secretShown(e.key)) {
        e.visIndex = -1;
        continue;
      }
      e.visIndex = out.length;
      out.push(e);
    }
    visRoster = out;
    return out;
  }

  /** Where a character sits in the visible roster, or -1 if it is hidden. */
  function visibleIndexOf(entry) {
    visibleRoster();                       // refreshes every entry's visIndex
    const i = entry ? entry.visIndex : -1;
    return (typeof i === 'number' && isFinite(i)) ? i : -1;
  }

  /**
   * The ids the player may choose from right now, in carousel order — a fresh
   * array, so game.js can walk it without being handed this file's own list.
   *
   * Exported because the carousel's STATE lives in game.js and its PICTURE
   * lives here, and the two must agree about how many characters there are:
   * a screen that draws nine pips while the input layer steps through ten
   * would put a player on a character the panel cannot show.
   */
  function characterList() {
    const vis = visibleRoster();
    const out = [];
    for (let i = 0; i < vis.length; i++) out.push(vis[i].key);
    return out;
  }

  /** How many characters the player can see: nine locked, ten unlocked. */
  function characterCount() {
    return visibleRoster().length;
  }

  /* -------------------------------------------------------------------------
   * VARIANTS  (SPEC-VARIANTS.md §5)
   *
   * Three cosmetic versions of every character, 27 in all. Everything below
   * is lookup and normalisation: which variant a reference names, which
   * sprite carries its palette, and which one a player was on last time.
   * Not one of them reads or writes a gameplay number, because a variant has
   * none to read — that is the whole point of the feature.
   * ---------------------------------------------------------------------- */

  /** How many variants a character has (0 if the roster carries none). */
  function variantCountOf(entry) {
    return (entry && entry.variants) ? entry.variants.length : 0;
  }

  /**
   * Normalise any reference to a variant into an index for `entry`, or null
   * when there is nothing usable to normalise.
   *
   * Accepts what the data and the game state actually hold: the bare index,
   * the id from T.C.BASE_WEAPONS ('jam.1'), or the variant's display name.
   * Out-of-range numbers WRAP rather than clamp, so a caller that cycles past
   * the end lands where the picker does.
   */
  function variantIndexOf(entry, ref) {
    const n = variantCountOf(entry);
    if (n === 0) return null;

    if (typeof ref === 'number' && isFinite(ref)) {
      const i = Math.floor(ref);
      return ((i % n) + n) % n;
    }

    if (typeof ref === 'string' && ref.length > 0) {
      const tail = ref.slice(ref.lastIndexOf('.') + 1);
      if (/^[0-9]+$/.test(tail)) {
        const i = Number(tail);
        return ((i % n) + n) % n;
      }
      const want = ref.toUpperCase();
      for (let i = 0; i < n; i++) {
        const v = entry.variants[i];
        if (String(v.id).toUpperCase() === want ||
            String(v.name).toUpperCase() === want) return i;
      }
    }

    return null;
  }

  /** The variant record at an index, or null. */
  function variantOf(entry, index) {
    const n = variantCountOf(entry);
    if (n === 0) return null;
    const i = variantIndexOf(entry, typeof index === 'number' ? index : 0);
    return i === null ? null : entry.variants[i];
  }

  /**
   * The sprite name carrying a variant's palette, e.g. 'jam0' -> 'jam0~1'.
   *
   * sprites.js interns the derived name and hands the SAME string back on
   * every later call, and falls back to the plain name for a sprite that has
   * no variant at that index — so this is allocation-free in the per-frame
   * HUD path (§12) and safe on a build where the variants were never
   * rasterized. It still cannot be the thing that takes a frame down, hence
   * the guard around a call that throws on a junk index.
   */
  function variantSprite(name, index) {
    if (!name) return name;
    const S = T.Sprites;
    if (!S || typeof S.variantName !== 'function') return name;
    if (typeof index !== 'number' || !isFinite(index) || index < 0) return name;
    // Variant 0 IS the base sprite — sprites.js rasterizes it through the
    // variant pipeline and then asserts, cell by cell, that it came out
    // identical to the map it was swapped from. Handing back the original
    // name is therefore the same picture, one lookup cheaper, and it keeps
    // the default path pointing at the one canvas everything else caches
    // against (the p2 tint, the HUD life icon).
    if (index === 0) return name;
    try {
      return S.variantName(name, Math.floor(index));
    } catch (err) {
      return name;                        // unknown sprite: draw the base art
    }
  }

  /**
   * A DIFFERENT variant of the same character — the rule that keeps two ships
   * tellable apart in co-op (SPEC-VARIANTS.md §5). Falls back to 0 when the
   * character has fewer than two variants to choose between, because then 0 is
   * the only index there is.
   */
  function distinctVariant(entry, taken) {
    const n = variantCountOf(entry);
    if (n < 2) return 0;
    const t = variantIndexOf(entry, taken);
    return t === null ? 0 : (t + 1) % n;
  }

  /* --- remembering what each player picked last time ---------------------
   * `toasterInvaders.p1` / `.p2`, via T.Util.storeGet / storeSet, which are
   * already wrapped so file:// and private mode return a fallback instead of
   * throwing. Stored shape is { kind, variant }; a bare kind string written
   * by an older build still reads back correctly.
   */
  const PICK_KEYS = ['toasterInvaders.p1', 'toasterInvaders.p2'];

  function pickKey(slot) {
    return PICK_KEYS[slot === 1 ? 1 : 0];
  }

  /** The remembered character + variant for a slot, or null. */
  function recallPick(slot) {
    const raw = U.storeGet(pickKey(slot), null);
    if (!raw) return null;

    let kind = null;
    let variant = null;
    if (typeof raw === 'string') {
      kind = raw;
    } else if (typeof raw === 'object') {
      kind = probe(raw, ['kind', 'char', 'character'], null);
      variant = probe(raw, ['variant', 'variantIndex', 'variantId', 'vi'], null);
    }
    if (typeof kind !== 'string' || !CHARS[kind]) return null;

    const vi = variantIndexOf(CHARS[kind], variant);
    return { kind: kind, variant: vi === null ? 0 : vi };
  }

  // Deduped: renderSelect resolves the same pick 60 times a second and only
  // an actual change is worth a write.
  const lastRemembered = ['', ''];

  /** Persist a slot's character + variant. Returns true if it actually wrote. */
  function rememberPick(slot, kind, variant) {
    const entry = CHARS[kind];
    if (!entry) return false;
    const vi = variantIndexOf(entry, variant);
    const v = vi === null ? 0 : vi;
    const i = slot === 1 ? 1 : 0;
    const stamp = kind + '.' + v;
    if (lastRemembered[i] === stamp) return false;
    lastRemembered[i] = stamp;
    return U.storeSet(pickKey(slot), { kind: kind, variant: v });
  }

  /**
   * The variant a SHIP is flying, as an index. game.js stamps it on the ship
   * when the session starts; a build that has not started doing that yet
   * reads as variant 0, which is exactly the art and the name the game shipped
   * with (SPEC-VARIANTS.md §2).
   */
  function shipVariant(ship) {
    if (!ship) return 0;
    const entry = CHARS[ship.kind];
    if (!entry) return 0;
    let ref = probe(ship, ['variant', 'variantIndex', 'variantId', 'vi'], null);
    if (ref === null && ship.weapon) {
      ref = probe(ship.weapon, ['variant', 'variantIndex', 'variantId'], null);
    }
    const i = variantIndexOf(entry, ref);
    return i === null ? 0 : i;
  }

  /* --- the public variant helpers, keyed by character id -----------------
   * game.js drives the picker; ui.js draws it. These four are how the two
   * stay in step without either file restating the roster.
   */

  /**
   * The three variant records for a character id, a fresh copy each call.
   *
   * The RECORDS are copied, not just the array. slice() alone hands the caller
   * the very objects this file draws from, and one `list[0].name = …` in any
   * other file would silently rewrite the select screen and the HUD chip for
   * the rest of the session — the roster is built once, at load, and nothing
   * rebuilds it. This is the only variant data that leaves the file, so it is
   * the only place that has to be defended; it is a lookup, never a per-frame
   * path (nothing inside ui.js calls it), so the three small objects cost
   * nothing that matters.
   */
  function variantsFor(kind) {
    const entry = CHARS[kind];
    const out = [];
    if (!entry) return out;
    for (let i = 0; i < entry.variants.length; i++) {
      const v = entry.variants[i];
      out.push({
        id: v.id, index: v.index, name: v.name,
        flavour: v.flavour, color: v.color
      });
    }
    return out;
  }

  /** How many variants a character id has. */
  function variantCount(kind) {
    return variantCountOf(CHARS[kind]);
  }

  /** Walk a character's variants by `step`, wrapping at both ends. */
  function cycleVariant(kind, index, step) {
    const entry = CHARS[kind];
    const n = variantCountOf(entry);
    if (n === 0) return 0;
    const from = variantIndexOf(entry, index);
    const d = (typeof step === 'number' && isFinite(step)) ? Math.round(step) : 0;
    return (((from === null ? 0 : from) + d) % n + n) % n;
  }

  /**
   * A variant of `kind` that is NOT `taken` — what a second player should get
   * when they land on the character the first one already locked, so the two
   * ships on the board are never the same colour (SPEC-VARIANTS.md §5).
   */
  function distinctVariantFor(kind, taken) {
    return distinctVariant(CHARS[kind] || NO_CHAR, taken);
  }

  const MODES = {
    coop: { key: 'coop', label: 'CO-OP', blurb: 'BOTH SHIPS ON ONE BOARD' },
    classic: { key: 'classic', label: 'CLASSIC', blurb: 'ALTERNATING TURNS' }
  };
  const MODE_ORDER = ['coop', 'classic'];

  /** Player accent colour for a slot. */
  function slotColor(slot) {
    return slot === 1 ? PAL.p2 : PAL.p1;
  }

  /** Character record for a kind string, defaulting to the first of the nine. */
  function charInfo(kind) {
    const e = CHARS[kind];
    if (e) return e;
    return ROSTER.length > 0 ? ROSTER[0] : NO_CHAR;
  }

  /** First defined property from a list of candidate names. */
  function probe(obj, names, fallback) {
    if (!obj) return fallback;
    for (let i = 0; i < names.length; i++) {
      const v = obj[names[i]];
      if (v !== undefined && v !== null) return v;
    }
    return fallback;
  }

  /** Stored / live high score. */
  function highScore(g) {
    const v = probe(g, ['hiScore', 'highScore', 'hi'], undefined);
    if (typeof v === 'number' && isFinite(v)) return v;
    const s = g && g.session;
    const v2 = probe(s, ['hiScore', 'highScore', 'hi'], undefined);
    if (typeof v2 === 'number' && isFinite(v2)) return v2;
    const stored = U.storeGet('toasterInvaders.hi', 0);
    return (typeof stored === 'number' && isFinite(stored)) ? stored : 0;
  }

  /**
   * Everything the select screen needs, normalised:
   *   { slots: [{active, kind, kindGiven, ready, variant, variantGiven}, {…}],
   *     mode: 'coop'|'classic', wired, variantHint, modeHint }
   * Tolerates slot arrays of objects OR parallel arrays of values.
   *
   * `kindGiven` says the state really named a character this file has on its
   * roster, as opposed to this function filling an empty slot with a carousel
   * seat so there is something to draw. Drawing an invented default is fine;
   * REMEMBERING one is not, which is the one thing that reads this flag.
   *
   * VARIANTS (SPEC-VARIANTS.md §5). A slot's variant is read from the game
   * state when it is there, and DERIVED when it is not, in this order:
   *   1. whatever the state says (an index, a 'jam.1' id, or a name)
   *   2. what this player picked last time (localStorage, same character)
   *   3. 0 — the default, i.e. the game exactly as it looked before variants
   * and then, for P2 only: if a derived pick would put both players on the
   * same character AND the same variant, P2 is moved to a different one, so
   * two ships on one board are never the same colour. That rule fires only on
   * a DERIVED variant — a variant the state actually states is drawn verbatim,
   * because the screen must never disagree with the ship that flies.
   *
   * `wired` says whether the game state is driving variants at all. It
   * decides only which BUTTON HINTS are truthful to print, never what is
   * drawn: the variant a player is on is shown either way.
   */
  function selectState(g) {
    const src = probe(g, ['select', 'selectState', 'sel'], null) ||
                probe(g && g.session, ['select', 'selectState'], null) || {};

    let raw = probe(src, ['slots', 'players', 'picks', 'entries'], null);
    if (!Array.isArray(raw)) raw = null;

    const kinds = probe(src, ['kinds', 'chars', 'characters'], null);
    const readies = probe(src, ['ready', 'readies', 'locked'], null);
    const actives = probe(src, ['active', 'actives', 'joined'], null);
    const variants = probe(src, ['variants', 'variantIndexes', 'vis'], null);

    /* WHICH BUTTONS THIS SCREEN PROMISES.
     *
     * game.js owns the bindings, so it gets to name them: `variantHint` and
     * `modeHint` are printed verbatim wherever this screen tells a player
     * which control moves what. The defaults below are the bindings the game
     * actually ships with today — START steps a joined player's variant, and
     * UP/DOWN still flips the mode, because every other control SPEC.md §5
     * gives input.js was already spoken for (LB/RB are not in the input
     * contract at all, and a picker on a button the keyboard cannot reach is
     * not a picker). If that ever moves, game.js states the new string here
     * and every label on this screen follows it; nothing about the binding is
     * written twice.
     */
    let variantHint = probe(src, ['variantHint', 'variantKeys', 'variantButton'], null);
    if (typeof variantHint !== 'string') variantHint = null;
    let modeHint = probe(src, ['modeHint', 'modeKeys', 'modeButton'], null);
    if (typeof modeHint !== 'string') modeHint = null;
    let wired = variantHint !== null;

    const slots = [];
    for (let i = 0; i < 2; i++) {
      const e = raw && raw[i] ? raw[i] : null;

      let kind = e ? probe(e, ['kind', 'char', 'character', 'pick'], null) : null;
      if (!kind && Array.isArray(kinds)) kind = kinds[i];
      // An unset slot starts on its own seat in the carousel — P1 on the first
      // of the nine, P2 on the second — rather than on a hardcoded character.
      //
      // WHERE THE SECRET IS KEPT, precisely, because this line looks like the
      // gap and is not one. A kind the caller NAMES is drawn, secret or not —
      // this panel is a window onto a character, and refusing to render the
      // one it was handed would leave a harness (and the game-over card's own
      // lookup path) unable to show a character that is perfectly legitimate
      // to show. What this file guarantees is that nothing it ever OFFERS is a
      // locked secret: the carousel, the strip, the ghosts, the "n OF n" and
      // the empty-slot seat below all walk visibleRoster(), so the only way a
      // secret reaches this line is a caller that already named him. In the
      // shipped game there is no such caller — every select-screen pick is
      // written by game.js's setPick, which runs normalizeVisibleKind, and the
      // remembered pick is filtered through isPickable on the way out of
      // storage — so a player who has not reached wave 5 has no route here
      // (SPEC-BURRITO §2). Named anyway, he draws with visIndex -1: no pip
      // lit, no position printed, and the count still reads the visible nine.
      const kindGiven = !!CHARS[kind];
      if (!kindGiven) {
        // The seat comes off the VISIBLE roster, so an empty slot can never be
        // filled with a character the player has not earned (SPEC-BURRITO §2).
        const vis = visibleRoster();
        const seat = vis[Math.min(i, vis.length - 1)];
        kind = seat ? seat.key : kind;
      }

      let ready = e ? probe(e, ['ready', 'locked', 'confirmed'], null) : null;
      if (ready === null && Array.isArray(readies)) ready = readies[i];

      let active = e ? probe(e, ['active', 'joined', 'present', 'in'], null) : null;
      if (active === null && Array.isArray(actives)) active = actives[i];
      if (active === null || active === undefined) active = (i === 0);

      let vRef = e
        ? probe(e, ['variant', 'variantIndex', 'variantId', 'vi'], null)
        : null;
      if (vRef === null && Array.isArray(variants)) {
        vRef = variants[i] === undefined ? null : variants[i];
      }
      const entry = CHARS[kind] || NO_CHAR;
      let variant = variantIndexOf(entry, vRef);
      const given = variant !== null;
      if (given) wired = true;

      if (!given) {
        const saved = recallPick(i);
        if (saved && saved.kind === kind) variant = saved.variant;
      }
      if (variant === null) variant = 0;

      slots.push({
        active: !!active, kind: kind, kindGiven: kindGiven, ready: !!ready,
        variant: variant, variantGiven: given
      });
    }

    // Two players, one character, one palette: split them (P2 moves).
    if (!slots[1].variantGiven && slots[0].kind === slots[1].kind &&
        slots[0].variant === slots[1].variant) {
      slots[1].variant = distinctVariant(CHARS[slots[1].kind] || NO_CHAR,
                                         slots[0].variant);
    }

    let mode = probe(src, ['mode'], null) || probe(g, ['mode'], null) ||
               probe(g && g.session, ['mode'], null) || 'coop';
    if (!MODES[mode]) mode = 'coop';

    // A build whose select state carries no variant at all cannot have a
    // picker to point at, so the row is drawn without an affordance and the
    // hint rows say nothing about a button that would do nothing.
    if (variantHint === null) variantHint = wired ? 'START' : '';
    if (modeHint === null) modeHint = 'UP/DOWN';

    return {
      slots: slots, mode: mode, wired: wired,
      variantHint: variantHint, modeHint: modeHint
    };
  }

  /** Ships from wherever the session keeps them, deduped and sorted by slot. */
  function collectShips(g) {
    const found = [];
    const seen = Object.create(null);

    function take(arr) {
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        const sh = arr[i];
        if (!sh || typeof sh !== 'object') continue;
        const slot = typeof sh.slot === 'number' ? sh.slot : i;
        if (seen[slot]) continue;
        seen[slot] = true;
        found.push(sh);
      }
    }

    const s = g && g.session;
    if (s) {
      take(s.ships);
      if (s.board) take(s.board.ships);
      if (Array.isArray(s.boards)) {
        for (let i = 0; i < s.boards.length; i++) {
          if (s.boards[i]) take(s.boards[i].ships);
        }
      }
      take(s.players);
    }
    if (g && g.board) take(g.board.ships);

    found.sort(function (a, b) {
      return (a.slot === undefined ? 0 : a.slot) - (b.slot === undefined ? 0 : b.slot);
    });
    return found;
  }

  /**
   * The board being drawn, if the caller did not hand one over.
   * game.js keeps `Game.board` pointed at the live board (classic mode swaps
   * it on every turn), so that wins over anything cached on the session.
   */
  function currentBoard(g, board) {
    if (board) return board;
    if (g && g.board) return g.board;
    const s = g && g.session;
    if (s) {
      if (s.board) return s.board;
      if (Array.isArray(s.boards)) {
        const raw = probe(s, ['activeBoard', 'turn', 'current', 'index'], 0);
        const idx = (typeof raw === 'number' && s.boards[raw]) ? raw : 0;
        if (s.boards[idx]) return s.boards[idx];
      }
    }
    return null;
  }

  /** True when a ship has burnt through all its lives. */
  function shipIsOut(sh) {
    if (!sh) return true;
    if (sh.out === true) return true;
    return (typeof sh.lives === 'number') && sh.lives <= 0;
  }

  /**
   * A roster def for an id, or null. T.Weapons.byId THROWS on an unknown id
   * (deliberately — a typo there is a bug), and ui.js is not allowed to be the
   * thing that takes the frame down, so every lookup goes through here.
   */
  function defForId(id) {
    if (!id || typeof id !== 'string') return null;
    const W = T.Weapons;
    if (!W || typeof W.byId !== 'function') return null;
    try {
      return W.byId(id);
    } catch (err) {
      return null;
    }
  }

  /* -------------------------------------------------------------------------
   * THE ROTATING GUN  (SPEC-BURRITO.md §1 and §5)
   *
   * WRAPPED fires the NEXT of sizzle / flake / pepper on every trigger pull,
   * so "what am I holding?" has a different answer every shot and the HUD has
   * to answer it. weapons.js owns that position — it lives on the SHIP, so two
   * players on burrito never share one — and T.Weapons.cycleState(ship) is the
   * only way in. This file NEVER recomputes the cycle: it does not read
   * T.C.BURRITO_CYCLE, it does not count shots, it does not keep an index of
   * its own. A HUD that derived the order itself would drift from the gun the
   * frame anything about the cycle was tuned, and the one thing this chip is
   * for is being right about the next shot.
   *
   * The returned view is CACHED ON THE SHIP and rewritten in place, so asking
   * every frame allocates nothing. Read it, do not keep it.
   * ---------------------------------------------------------------------- */

  /** T.Weapons.cycleState for a ship, or null for the other nine. */
  function cycleOf(ship) {
    const W = T.Weapons;
    if (!ship || !W || typeof W.cycleState !== 'function') return null;
    try {
      return W.cycleState(ship);
    } catch (err) {
      return null;                          // never take a frame down over art
    }
  }

  /* The select screen has no ship to ask — nobody has been built yet — so it
   * asks about a character instead, through a stand-in carrying the only two
   * fields cycleState reads: which character this is, and where the cycle
   * stands. Position 0 is not a guess: the cycle RESETS at the start of a new
   * game (SPEC-BURRITO §1), so index 0 genuinely is the weapon the first
   * trigger pull after this screen will fire.
   *
   * Hoisted, and cycleState caches its view on the object it is handed, so the
   * whole per-frame path here is two field writes and a lookup. */
  const cycleProbe = { kind: '', wCycle: 0, weapon: null };

  /** The cycle a CHARACTER ID would fly, or null if it is not the rotating gun. */
  function cycleForKind(kind) {
    if (!kind) return null;
    cycleProbe.kind = kind;
    cycleProbe.wCycle = 0;
    return cycleOf(cycleProbe);
  }

  /**
   * Everything the HUD chip needs about what a ship is holding, or null when
   * the weapon layer is not loaded / the ship has no weapon yet:
   *
   *   { def, name, color, base, frac, label }
   *
   * `frac` is T.Weapons.ammoFraction — 0..1, and 1 for the infinite base
   * weapons. `label` is the readout printed beside the bar: rounds left for an
   * ammo weapon, seconds left for a duration one.
   */
  function weaponInfo(ship) {
    const w = ship && ship.weapon;
    const def = (w && w.def && w.def.name) ? w.def : null;
    if (!def) return null;

    /* SPEC-VARIANTS.md §5: the chip prints the VARIANT's name — "PEANUT
     * BUTTER", not "JAM". Only for a BASE weapon, and that is not a detail:
     * an upgrade token is the same MEGA JAM MORTAR whoever caught it, and
     * relabelling it with the catcher's breakfast would be a lie about what
     * they are holding. The variant's own colour stays out of it too — the
     * chip's colour is the weapon's, and some variants (molasses) are far too
     * dark to read as text on the HUD strip. */
    let name = def.name;
    if (def.base) {
      const owner = charInfo((ship && ship.kind) || def.char);
      const v = variantOf(owner, shipVariant(ship));
      if (v && v.name) name = v.name;
    }

    let frac = 1;
    const W = T.Weapons;
    if (W && typeof W.ammoFraction === 'function') {
      try {
        const f = W.ammoFraction(ship);
        if (typeof f === 'number' && isFinite(f)) frac = U.clamp(f, 0, 1);
      } catch (err) { /* fall back to a full bar rather than a broken HUD */ }
    }

    let label = '';
    if (!def.base) {
      if (def.duration) {
        const secs = (typeof w.timer === 'number' && isFinite(w.timer)) ? w.timer : 0;
        label = Math.max(0, secs).toFixed(1) + 'S';
      } else {
        const rounds = (typeof w.ammo === 'number' && isFinite(w.ammo)) ? w.ammo : 0;
        label = 'x' + Math.max(0, Math.round(rounds));
      }
    }

    return {
      def: def,
      name: name,
      color: def.color || PAL.ui,
      base: !!def.base,
      frac: frac,
      label: label
    };
  }

  /** Whether pause is currently asking "quit to title?". */
  function quitConfirmActive(g) {
    if (!g) return false;
    const direct = probe(g, ['confirmQuit', 'pauseConfirm', 'quitConfirm'], null);
    if (typeof direct === 'boolean') return direct;
    if (g.pause && typeof g.pause === 'object') {
      const p = probe(g.pause, ['confirmQuit', 'confirm', 'quitConfirm'], null);
      if (typeof p === 'boolean') return p;
    }
    const sess = probe(g && g.session, ['confirmQuit', 'quitConfirm'], null);
    if (typeof sess === 'boolean') return sess;
    return false;
  }

  /** Connection state of an input slot, without ever throwing. */
  function padInfo(i) {
    const I = T.Input;
    const info = { gamepad: false, connected: false };
    if (!I) return info;
    try {
      if (typeof I.isGamepad === 'function') info.gamepad = !!I.isGamepad(i);
    } catch (err) { /* input not initialised yet */ }
    try {
      if (typeof I.get === 'function') {
        const p = I.get(i);
        if (p && p.connected) info.connected = true;
      }
    } catch (err) { /* ditto */ }
    info.connected = info.connected || info.gamepad;
    return info;
  }

  function padCount() {
    const I = T.Input;
    if (!I || typeof I.padCount !== 'function') return 0;
    try {
      const n = I.padCount();
      return (typeof n === 'number' && isFinite(n)) ? n : 0;
    } catch (err) {
      return 0;
    }
  }

  /* -------------------------------------------------------------------------
   * WHICH CONTROLS THIS PLAYER ACTUALLY HAS  (SPEC-TOUCH.md §2 and §4)
   *
   * Every prompt on every screen names a button, and on an iPad not one of the
   * names this file grew up printing is true: there is no A, no B, no Y and no
   * stick — there are the labelled targets js/touch.js lays down each edge of
   * the device. So the WORDING is resolved through here at the moment it is
   * drawn, and the drawing itself is left alone: same colours, same order,
   * same rows, in the same places. (One box moves, and only on touch: the
   * pause panel grows to hold §4's control-mode block, which does not exist
   * without touch to have a mode.) On a machine with no touch every helper
   * below is false or the identity function, and every screen is byte-for-byte
   * what it always was.
   *
   * touch.js loads before this file but is allowed to be absent — it is not in
   * the test harnesses and index.html is not this file's to depend on — so
   * every call is guarded exactly like the T.Input and T.Sprites reads above:
   * a missing, half-built or throwing T.Touch simply reads as "no touch".
   * ---------------------------------------------------------------------- */

  /** Are on-screen thumb controls part of how this machine is played? */
  function touchOn() {
    const To = T.Touch;
    if (!To || typeof To.isTouch !== 'function') return false;
    try {
      return !!To.isTouch();
    } catch (err) {
      return false;
    }
  }

  /**
   * Should the TAP wording be printed?
   *
   * §2: a player may use touch AND a keyboard, and once a key turns up the
   * controls stay but the "tap to start" prompts stop. touch.js owns that
   * decision and publishes it; this file only asks. A touch layer too old to
   * answer still gets the prompts — they are the reason it exists.
   */
  function tapPrompts() {
    if (!touchOn()) return false;
    const To = T.Touch;
    if (!To || typeof To.promptsOn !== 'function') return true;
    try {
      return !!To.promptsOn();
    } catch (err) {
      return true;
    }
  }

  /**
   * Is touch.js's own DOM "TAP TO START" panel on screen right now?
   *
   * The title screen is the one place the two files would otherwise print the
   * same three words on top of each other. touch.js answers from the live
   * element rather than from a re-derived gate, so this cannot drift out of
   * step with what is actually visible; anything less than a clear yes (no
   * layer, an older layer without the method, a throw) means this file paints
   * the prompt, because a duplicated prompt is untidy and a missing one is a
   * title screen that never tells you how to start.
   */
  function domTapStart() {
    const To = T.Touch;
    if (!To || typeof To.tapStartShown !== 'function') return false;
    try {
      return !!To.tapStartShown();
    } catch (err) {
      return false;
    }
  }

  /** 'buttons' | 'drag' — the live control mode, '' with no touch layer. */
  function touchMode() {
    const To = T.Touch;
    if (!To || typeof To.mode !== 'function') return '';
    try {
      const m = To.mode();
      return (typeof m === 'string') ? m : '';
    } catch (err) {
      return '';
    }
  }

  /** Is a thumb what is driving this input slot? (badge wording only.) */
  function slotIsTouch(i) {
    const I = T.Input;
    if (!I || typeof I.hasVirtual !== 'function') return false;
    try {
      return !!I.hasVirtual(i);
    } catch (err) {
      return false;
    }
  }

  /* The labels touch.js prints on its targets, keyed by the binding names the
   * rest of the game uses for them. This table is the ONE place the two files
   * agree on wording: game.js names a binding ('START', 'A', 'B', …) and, if a
   * thumb can reach that binding, what this screen prints is what is written
   * on the thing they press. A binding with no on-screen target is absent from
   * the table on purpose — see buttonName. */
  const TOUCH_BUTTONS = {
    'A': 'FIRE', 'X': 'FIRE', 'RT': 'FIRE', 'RB': 'FIRE', 'FIRE': 'FIRE',
    'B': 'BACK', 'BACK': 'BACK',
    'START': 'START',
    // The pair of movement targets is called ARROWS rather than drawn as
    // ◀ ▶: the monospace stack cannot be trusted to carry those glyphs, and a
    // missing one prints a tofu box in the middle of a hint row.
    'L/R': 'ARROWS', 'L / R': 'ARROWS',
    'LEFT/RIGHT': 'ARROWS', 'LEFT / RIGHT': 'ARROWS'
  };

  /* SPEC-TOUCH §4's second mode changes WHERE two of those live. In DRAG the
   * canvas IS the control — a finger steers, a short tap fires — so touch.js
   * takes FIRE and the ◀ ▶ pair off the screen entirely and leaves START,
   * BACK, P2 and the mode toggle where they were. A prompt that still read
   * "FIRE = YES" in DRAG would be pointing at a button that is not there, so
   * those two families are re-named to the GESTURE that does the same job.
   * Everything else is a button in both modes and is not in this table. */
  const TOUCH_DRAG_GESTURES = { 'FIRE': 'TAP', 'ARROWS': 'DRAG' };

  /** Is there something on the glass that does this? */
  function onGlass(name) {
    if (!name) return false;
    return TOUCH_BUTTONS[String(name).toUpperCase()] !== undefined;
  }

  /**
   * The name to PRINT for a binding.
   *
   * Off touch this is the identity function, which is the whole
   * no-regression promise. On touch a binding a thumb can reach is renamed to
   * the label on the target. A binding with NO target keeps its own name
   * behind a PAD qualifier: iPadOS speaks the Gamepad API too, so "PAD
   * UP/DOWN" is the truth — a real control, on a device this player may not
   * have brought — where a bare "UP/DOWN" would promise something that is
   * simply not on the glass.
   *
   * In DRAG mode the two families that have no button any more are named by
   * the gesture that replaces them, so the words still describe something the
   * player can actually do (see TOUCH_DRAG_GESTURES).
   */
  function buttonName(name) {
    if (!name || !touchOn()) return name;
    const hit = TOUCH_BUTTONS[String(name).toUpperCase()];
    if (hit === undefined) return 'PAD ' + name;
    if (touchMode() === 'drag') {
      const gesture = TOUCH_DRAG_GESTURES[hit];
      if (gesture !== undefined) return gesture;
    }
    return hit;
  }

  /**
   * The on-screen target that drops an open slot in.
   *
   * touch.js gives the second player their own labelled P2 button — and only
   * in the solo layout, which is exactly the layout an open slot 1 means —
   * because with one player BOTH columns are P1's and START in either of them
   * is P1's START. Slot 0 has no such button: it is START, like everywhere
   * else.
   */
  function joinButtonName(slot) {
    if (!touchOn()) return 'START';
    return (slot === 1) ? 'P2' : 'START';
  }

  /**
   * Does this binding's name describe an up/down control? Decides whether an
   * affordance is drawn as a pair of vertical triangles or as a forward
   * chevron, so it has to keep answering for a name that has been qualified
   * ('PAD UP/DOWN') as well as for the bare one.
   */
  function namesUpDown(hint) {
    const h = String(hint === null || hint === undefined ? '' : hint).toUpperCase();
    return h.indexOf('UP') >= 0 || h.indexOf('DOWN') >= 0;
  }

  /* SPEC-TOUCH §4's two control modes, and the word each one is called by.
   * The toggle target wears the name of the mode it would give you — that is
   * how touch.js labels it — so a hint that points at it must say the OTHER
   * word, never the live one. */
  const MODE_WORDS = { buttons: 'BUTTONS', drag: 'DRAG' };

  // Compared rather than looked up: `m` is a string that arrived from another
  // file, and BUTTONS is the right answer for anything that is not DRAG —
  // including a mode this file has never heard of.
  function modeWord(m) {
    return (m === 'drag') ? MODE_WORDS.drag : MODE_WORDS.buttons;
  }

  function otherModeWord(m) {
    return (m === 'drag') ? MODE_WORDS.buttons : MODE_WORDS.drag;
  }

  /* =========================================================================
   * 4. PUBLISHED HIT REGIONS  (SPEC-TOUCHUI.md §2, §4 and §5)
   *
   * THE ROOT CAUSE, stated plainly. This screen is drawn ONTO a canvas, and a
   * canvas has no DOM children, so nothing inside it can be hit-tested. That
   * is why choosing a variant ended up on START — not a bad binding, a missing
   * mechanism. The fix is to give the canvas real hit regions: ui.js already
   * computes the rectangle of everything it draws, so it records those
   * rectangles as it draws them and publishes the list.
   *
   *   T.UI.beginRegions()      at the top of a screen's render
   *   T.UI.addRegion(region)   as each interactive thing is drawn
   *   T.UI.regions()           the list for the frame on screen
   *
   * A REGION IS DATA. { id, x, y, w, h, player, action, value }, in LOGICAL
   * 960x720 coordinates, and never a callback: this file does not mutate game
   * state and a region that carried a function would be exactly that, smuggled
   * through a rectangle. touch.js converts a tap into logical coordinates and
   * hit-tests the list; game.js's uiTap is the only place a region is acted
   * on. Three files, one direction, no shared mutable anything.
   *
   * ALLOCATION. The select screen publishes about thirty regions and it does
   * it sixty times a second, so the records are POOLED and rewritten in place
   * (SPEC.md §12 forbids allocating in a per-frame path) and the ids are
   * interned once rather than concatenated per frame. Read a region, do not
   * keep it: the object you were handed is the one the next frame writes over.
   *
   * EVERY SCREEN CLEARS. beginRegions() runs at the top of every render entry
   * point, including the ones that publish nothing, so the list can never grow
   * without bound and a stale select-screen rectangle can never be left lying
   * under the play field.
   * ====================================================================== */

  const REGION_POOL = [];    // records, reused frame to frame
  const REGION_LIST = [];    // the live view handed to regions()

  /** Clear the frame's region list. Called at the top of every render. */
  function beginRegions() {
    REGION_LIST.length = 0;
  }

  /** The regions published for the frame currently on screen. Read-only. */
  function regions() {
    return REGION_LIST;
  }

  /**
   * Record one rectangle. Rejects anything that is not a finite, positive box
   * and CLIPS to the canvas, so a region can never name a point a tap cannot
   * reach (SPEC-TOUCHUI §6). Returns the pooled record, or null if it was
   * rejected — nothing here throws, because it runs inside a render.
   */
  function pushRegion(id, x, y, w, h, player, action, value) {
    if (typeof action !== 'string' || action === '') return null;
    if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return null;

    let x0 = Math.round(x);
    let y0 = Math.round(y);
    let x1 = Math.round(x + w);
    let y1 = Math.round(y + h);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > C.W) x1 = C.W;
    if (y1 > C.H) y1 = C.H;
    if (x1 <= x0 || y1 <= y0) return null;

    const n = REGION_LIST.length;
    let r = REGION_POOL[n];
    if (!r) {
      r = { id: '', x: 0, y: 0, w: 0, h: 0, player: null, action: '', value: null };
      REGION_POOL[n] = r;
    }
    r.id = (typeof id === 'string') ? id : '';
    r.x = x0;
    r.y = y0;
    r.w = x1 - x0;
    r.h = y1 - y0;
    r.player = (player === 0 || player === 1) ? player : null;
    r.action = action;
    r.value = (value === undefined) ? null : value;
    REGION_LIST.push(r);
    return r;
  }

  /** The public form: hand it a plain region object and it is recorded. */
  function addRegion(region) {
    if (!region || typeof region !== 'object') return null;
    return pushRegion(region.id, region.x, region.y, region.w, region.h,
                      region.player, region.action, region.value);
  }

  /* --- interned ids -------------------------------------------------------
   * A region id is a stable string, because the tapped-flash below finds its
   * rectangle by id a frame after the tap. Built once per (prefix, index) and
   * handed back thereafter: `'p0.var' + i` in a per-frame path would allocate
   * a string for every thumbnail on every frame (§12), and the two-level table
   * turns that into two lookups.
   */
  const ID_POOL = Object.create(null);
  function idFor(prefix, n) {
    let bucket = ID_POOL[prefix];
    if (bucket === undefined) {
      bucket = [];
      ID_POOL[prefix] = bucket;
    }
    let s = bucket[n];
    if (s === undefined) {
      s = prefix + n;
      bucket[n] = s;
    }
    return s;
  }

  // The fixed ids, per slot where a slot owns one. Literals, so nothing on the
  // per-frame path builds them.
  const ID_VAR = ['p0.var', 'p1.var'];
  const ID_CHAR = ['p0.char', 'p1.char'];
  const ID_PREV = ['p0.charPrev', 'p1.charPrev'];
  const ID_NEXT = ['p0.charNext', 'p1.charNext'];
  const ID_READY = ['p0.ready', 'p1.ready'];
  const ID_JOIN = ['p0.join', 'p1.join'];
  const ID_MODE = { coop: 'mode.coop', classic: 'mode.classic' };
  const ID_START = 'title.start';

  /* -------------------------------------------------------------------------
   * THE TAPPED FLASH  (SPEC-TOUCHUI.md §5)
   *
   * A tap that lands must be acknowledged within a frame, or a player cannot
   * tell a small target was missed from the game ignoring them. game.js
   * records the region a tap actually CHANGED something with, on Game.tapAck;
   * this file turns that into a brief flash over the rectangle it published
   * for that id.
   *
   * The timer is THIS FILE'S — the only thing in ui.js that survives a frame
   * besides the cached canvases and it is presentation only. It is started
   * from U.now(), like every other animation here, so there is nothing to tick
   * and nothing to get out of sync; a tapAck is consumed once, by OBJECT
   * IDENTITY (game.js allocates a fresh record per tap), so a second tap on
   * the same target re-flashes and a paused frame does not.
   *
   * flashRegion(id) is exported so a caller with its own idea of what was
   * tapped — a mouse path, a harness — can light the same lamp.
   * ---------------------------------------------------------------------- */

  // Fast enough to read as a response to the finger, long enough to see at 60
  // fps. T.C may state one; this is the value the game ships with.
  const TAP_FLASH_TIME = (typeof C.UI_TAP_FLASH_TIME === 'number' &&
                          isFinite(C.UI_TAP_FLASH_TIME) &&
                          C.UI_TAP_FLASH_TIME > 0)
    ? C.UI_TAP_FLASH_TIME : 0.22;
  const TAP_FLASH_FILL = 0.30;

  let flashId = '';
  let flashAt = 0;
  let lastAck = null;

  /** Light the flash on a published region id, starting now. */
  function flashRegion(id) {
    if (typeof id !== 'string' || id === '') return false;
    flashId = id;
    flashAt = U.now();
    return true;
  }

  /**
   * Pick up a tap game.js has acknowledged since the last frame. Reads only;
   * `tapAck` belongs to game.js and nothing here writes it back.
   */
  function noteTapAck(g) {
    const ack = g ? g.tapAck : null;
    if (!ack || typeof ack !== 'object') return;
    if (ack === lastAck) return;              // already flashed this one
    lastAck = ack;
    flashRegion(ack.id);
  }

  /** 0..1 remaining flash, 0 when there is none. */
  function flashAmount() {
    if (!flashId) return 0;
    const dt = U.now() - flashAt;
    if (!(dt >= 0) || dt >= TAP_FLASH_TIME) return 0;
    return 1 - dt / TAP_FLASH_TIME;
  }

  /**
   * Flash whatever was tapped, over the rectangle THIS frame published for it.
   * Drawn last so it sits on top of the thing it is acknowledging, and driven
   * by the live region list so a target that has moved (or gone) simply does
   * not flash rather than flashing an empty patch of screen.
   */
  function drawTapFlash(ctx) {
    const k = flashAmount();
    if (k <= 0) {
      flashId = '';
      return;
    }
    for (let i = 0; i < REGION_LIST.length; i++) {
      const r = REGION_LIST[i];
      if (r.id !== flashId) continue;
      // A region that IS the screen has nothing to point at, and washing the
      // whole canvas butter-yellow would read as a fault rather than as an
      // acknowledgement. The title's tap-anywhere is the only one of these.
      if (r.w >= C.W && r.h >= C.H) return;
      ctx.save();
      ctx.globalAlpha = k * TAP_FLASH_FILL;
      ctx.fillStyle = PAL.butter;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = k;
      ctx.strokeStyle = PAL.butter;
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
      ctx.restore();
      return;
    }
  }

  /* =========================================================================
   * 5. TITLE SCREEN
   * ====================================================================== */

  // Layout landmarks, all logical px. The score-advance table is a touch
  // tighter than the 40px it used to run at (still > the 34px sprite height,
  // so rows never touch) to buy the weapon-drop strip its two lines without
  // pushing PRESS START into the controller badges.
  const TITLE = {
    line1Y: 122,
    line2Y: 202,
    wordSize: 80,
    subY: 250,
    marchY: 296,          // sprite centre line for the marching row
    hiY: 334,
    tableHeadY: 358,
    tableY: 386,
    tableStep: 38,        // > the 34px sprite height, so rows never touch
    weaponHeadY: 548,     // "SHOOT THE FLYING DRAWER FOR"
    weaponRowY: 574,      // cycling icon + weapon name
    pressY: 606,
    badgeY: 644,
    flavourY: 674
  };

  const MARCH_PERIOD = 0.40;   // seconds between attract-mode march steps
  const MARCH_SWEEP = 8;       // steps in each direction before turning

  // Hoisted: drawMarchRow runs every frame on the title screen and under the
  // wave banner, and §12 forbids allocating in a per-frame path.
  const MARCH_TYPES = ['A', 'B', 'C', 'C', 'B', 'A'];
  const MARCH_CELL = 104;      // px between toasters in the attract row

  /** The animated attract-mode row of flapping toasters. */
  function drawMarchRow(ctx, t, cy) {
    const step = Math.floor(t / MARCH_PERIOD);
    const cycle = C.FRAME_CYCLE;
    const frame = cycle[((step % cycle.length) + cycle.length) % cycle.length];

    // ping-pong sweep, one FORM_STEP_X per step, exactly like the formation
    const phase = ((step % (MARCH_SWEEP * 2)) + MARCH_SWEEP * 2) % (MARCH_SWEEP * 2);
    const tri = phase < MARCH_SWEEP ? phase : (MARCH_SWEEP * 2 - phase);
    const offX = (tri - MARCH_SWEEP / 2) * C.FORM_STEP_X;

    const x0 = C.W / 2 - (MARCH_TYPES.length - 1) * MARCH_CELL / 2 + offX;

    for (let i = 0; i < MARCH_TYPES.length; i++) {
      const name = 'toast' + MARCH_TYPES[i] + frame;
      const s = sprite(name);
      const cx = x0 + i * MARCH_CELL;
      if (s) {
        blit(ctx, name, cx - s.w / 2, cy - s.h / 2);
      } else {
        previewFallback(ctx, cx, cy, 52, 34, PAL.chrome);
      }
    }
  }

  /** One row of the score-advance table. */
  function scoreRow(ctx, spriteName, label, cy, color, fallbackW) {
    const s = sprite(spriteName);
    const iconRight = C.W / 2 - 20;
    if (s) {
      blit(ctx, spriteName, iconRight - s.w, cy - s.h / 2);
    } else {
      previewFallback(ctx, iconRight - fallbackW / 2, cy, fallbackW, 24, PAL.chrome);
    }
    drawText(ctx, label, C.W / 2 + 6, cy, {
      size: 18, color: color, align: 'left', shadow: true
    });
  }

  /* --- attract-mode weapon roster ---------------------------------------
   * A new player has to learn that upgrades exist before they will bother
   * shooting the flying drawer, so the title screen cycles the roster one
   * weapon at a time under the score table: the current icon and NAME in the
   * weapon's own colour, flanked by the previous and next icons at low alpha
   * so it reads as a wheel turning rather than text blinking.
   * -------------------------------------------------------------------- */

  const ATTRACT = {
    period: 1.7,          // seconds a weapon holds the centre
    fade: 0.24,           // cross-fade at each end of that
    iconGap: 8,
    flankX: 196,          // px either side for the previous / next icons
    flankAlpha: 0.2,
    nameSize: 17
  };

  // Filtered once and kept: drawWeaponStrip runs every frame on the title
  // screen, and §12 forbids allocating in a per-frame path.
  let attractRoster = null;

  /**
   * The droppable upgrades, in roster order, or null if weapons.js is absent.
   *
   * THE SECRET IS SAFE ON THIS SCREEN, and by two independent facts rather
   * than by luck. WRAPPED is a BASE weapon, so it is not in T.Weapons.LIST at
   * all (that list is the two base plus the fifteen droppable) and could not
   * reach this wheel even if the filter below were deleted; and the filter
   * below drops anything belonging to a secret character anyway. Neither test
   * asks whether he is unlocked YET — this list is built once and kept, so a
   * question whose answer can change mid-session must not be asked here.
   * Nothing else on the title screen names a character: the attract row is
   * toasters and the score table is toasters (SPEC-BURRITO.md §2).
   */
  function upgradeRoster() {
    if (attractRoster) return attractRoster;
    const W = T.Weapons;
    if (!W || !Array.isArray(W.LIST)) return null;
    const out = [];
    for (let i = 0; i < W.LIST.length; i++) {
      const d = W.LIST[i];
      if (!d || d.base || d.internal || !d.name) continue;
      if (isSecretId(d.char)) continue;
      out.push(d);
    }
    if (out.length === 0) return null;
    attractRoster = out;
    return out;
  }

  /** One turn of the weapon wheel. Silently draws nothing without weapons.js. */
  function drawWeaponStrip(ctx, t) {
    const list = upgradeRoster();
    if (!list) return;

    const n = list.length;
    const idx = Math.floor(t / ATTRACT.period) % n;
    const ph = t % ATTRACT.period;
    let a = 1;
    if (ph < ATTRACT.fade) a = ph / ATTRACT.fade;
    else if (ph > ATTRACT.period - ATTRACT.fade) a = (ATTRACT.period - ph) / ATTRACT.fade;
    a = U.clamp(a, 0, 1);

    const def = list[idx];
    const cx = C.W / 2;
    const y = TITLE.weaponRowY;

    drawText(ctx, 'SHOOT THE FLYING DRAWER FOR', cx, TITLE.weaponHeadY, {
      size: 11, color: PAL.uiDim, align: 'center'
    });

    drawWeaponIcon(ctx, list[(idx - 1 + n) % n], cx - ATTRACT.flankX, y, 1,
                   ATTRACT.flankAlpha);
    drawWeaponIcon(ctx, list[(idx + 1) % n], cx + ATTRACT.flankX, y, 1,
                   ATTRACT.flankAlpha);

    // icon + name are laid out as one block so the pair stays centred whatever
    // the name's length — THE FULL BREAKFAST is twice the width of SYRUP TRAP.
    const nameW = textWidth(ctx, def.name, { size: ATTRACT.nameSize });
    const x0 = cx - (16 + ATTRACT.iconGap + nameW) / 2;
    drawWeaponIcon(ctx, def, x0 + 8, y, 1, a);
    drawText(ctx, def.name, x0 + 16 + ATTRACT.iconGap, y, {
      size: ATTRACT.nameSize, color: def.color || PAL.ui, align: 'left',
      alpha: a, glow: 12, glowColor: def.color || PAL.butter, shadow: true
    });
  }

  /**
   * P1 / P2 connected badges, shared by the title screen.
   *
   * On touch both badges are lit whatever the pads are doing, because both
   * players HAVE controls — a column each — the moment the layer is up, and a
   * pair of "NO PAD" lamps on a device with no pad socket would be telling
   * two players who can both play right now that neither of them can.
   */
  function drawPadBadges(ctx, y, t) {
    const glass = touchOn();
    for (let i = 0; i < 2; i++) {
      const info = padInfo(i);
      const cx = C.W / 2 + (i === 0 ? -138 : 138);
      const col = slotColor(i);
      const on = info.connected || glass;
      const a = on ? 1 : 0.34;

      // status lamp
      ctx.save();
      ctx.globalAlpha = on ? pulse(t, 3.4, 0.7, 1) : 0.3;
      ctx.fillStyle = on ? col : PAL.uiDim;
      if (on) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
      }
      ctx.beginPath();
      ctx.arc(cx - 52, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawText(ctx, 'P' + (i + 1), cx - 34, y, {
        size: 18, color: col, align: 'left', alpha: a, shadow: true
      });
      // Most specific true thing first: a pad, then a thumb that has actually
      // claimed this slot, then keys, then the controls that are on screen
      // waiting for a first press.
      let via;
      if (!on) via = 'NO PAD';
      else if (info.gamepad) via = 'PAD READY';
      else if (slotIsTouch(i)) via = 'TOUCH';
      else if (info.connected) via = 'KEYS';
      else via = 'TOUCH';
      drawText(ctx, via, cx + 6, y, {
        size: 12, color: on ? PAL.ui : PAL.uiDim, align: 'left', alpha: a
      });
    }
  }

  function renderTitle(ctx, g) {
    const t = U.now();
    beginRegions();
    noteTapAck(g);
    ctx.save();

    drawWordmark(ctx, 'TOASTER', C.W / 2, TITLE.line1Y, TITLE.wordSize, t, 0);
    drawWordmark(ctx, 'INVADERS', C.W / 2, TITLE.line2Y, TITLE.wordSize, t, 1.1);

    drawText(ctx, 'THEY FLEW OUT OF THE SCREENSAVER', C.W / 2, TITLE.subY, {
      size: 15, color: PAL.glass, align: 'center', alpha: 0.9, shadow: true
    });

    drawMarchRow(ctx, t, TITLE.marchY);

    const hi = highScore(g);
    drawText(ctx, 'HI-SCORE  ' + pad(hi, 5), C.W / 2, TITLE.hiY, {
      size: 15, color: PAL.butter, align: 'center', alpha: 0.9, shadow: true
    });

    drawText(ctx, '* SCORE ADVANCE TABLE *', C.W / 2, TITLE.tableHeadY, {
      size: 14, color: PAL.uiDim, align: 'center'
    });

    const rowPts = C.SCORE_ROW;
    let y = TITLE.tableY;
    scoreRow(ctx, 'toastA0', '= ' + rowPts[0] + ' PTS', y, PAL.ui, 52);
    y += TITLE.tableStep;
    scoreRow(ctx, 'toastB0', '= ' + rowPts[1] + ' PTS', y, PAL.ui, 56);
    y += TITLE.tableStep;
    scoreRow(ctx, 'toastC0', '= ' + rowPts[4] + ' PTS', y, PAL.ui, 60);
    y += TITLE.tableStep + 4;
    scoreRow(ctx, 'ufo', '= ??? PTS', y, PAL.coilLt, 76);
    drawText(ctx, 'CHROME DELUXE', C.W / 2 + 6, y + 22, {
      size: 11, color: PAL.uiDim, align: 'left'
    });

    drawWeaponStrip(ctx, t);

    // PRESS START — the classic hard blink, not a lazy fade. On a device with
    // no START to press it is the one prompt SPEC-TOUCH §2 names outright, and
    // it reverts the moment a keyboard turns up (tapPrompts).
    //
    // …unless touch.js has already put its own TAP TO START panel on the glass.
    // That panel is anchored in the same band this line is painted in (16% up
    // from the bottom, against y 606 of 720) and carries a translucent backing,
    // so drawing both leaves the canvas text showing through the panel as a
    // ghost of itself. The panel is the thing a thumb presses, so it wins — and
    // only when it is verifiably up: domTapStart() reports the live element,
    // not a second copy of the condition, so a hidden layer, a portrait device
    // or an older touch.js all fall back to painting the line here.
    const blink = (t % 1.0) < 0.62 && !(tapPrompts() && domTapStart());
    if (blink) {
      drawText(ctx, tapPrompts() ? 'TAP TO START' : 'PRESS START',
        C.W / 2, TITLE.pressY, {
          size: 32, color: PAL.butter, align: 'center', bold: true,
          glow: 20, glowColor: PAL.coil
        });
    }

    drawPadBadges(ctx, TITLE.badgeY, t);

    drawText(ctx, 'INSERT NOTHING  ·  FREE PLAY', C.W / 2, TITLE.flavourY, {
      size: 11, color: PAL.uiDim, align: 'center'
    });

    /* SPEC-TOUCHUI §3: tapping anywhere on the title already started the game,
     * and it still does — expressed as a region, so there is ONE mechanism
     * that turns a tap into a game action rather than two that have to be kept
     * in step. The whole canvas, because "anywhere" is what it has always
     * meant and narrowing it to the blinking line would be a regression
     * dressed up as a hit target. */
    pushRegion(ID_START, 0, 0, C.W, C.H, null, 'start', null);
    drawTapFlash(ctx);

    ctx.restore();
  }

  /* =========================================================================
   * 6. CHARACTER SELECT
   *
   * A NINE-character carousel, one per player (SPEC-CHARACTERS.md §4), each
   * character three variants deep for 27 playable versions (SPEC-VARIANTS.md
   * §5) — TEN and 30 for a player who has reached wave 5 and earned the
   * secret, whose panel additionally prints the cycle his rotating gun turns
   * through (SPEC-BURRITO.md §5). The two panels browse INDEPENDENTLY and may
   * land on the same character, so P2's art carries the p2 accent wash and P2
   * defaults to a different variant. For whichever version is in front of you the panel
   * shows a big preview in that variant's palette, the character NAME, the
   * three variant thumbnails with the current one boxed, the VARIANT name and
   * its flavour line, the WEAPON, the ADVANTAGE and DRAWBACK lines and
   * SPEED / SPREAD / REACH meters — all of it read out of the roster in
   * T.C.BASE_WEAPONS, never restated here — plus a strip of one pip per
   * character you may choose, so you can see how long the list is and where
   * in it you are.
   *
   * Not one number on this screen belongs to a variant: the meters, the
   * advantage and the drawback are the CHARACTER's, shared by all three of
   * its versions, which is exactly the promise SPEC-VARIANTS.md §1 makes.
   * ====================================================================== */

  const SEL = {
    headY: 36,

    // The two panels. 444 * 2 + 24 leaves 24px of screen either side, and the
    // 72 -> 538 band leaves the mode block and both hint rows underneath with
    // the controller hint (C.H - 26) still clear at the bottom.
    panelY: 72,
    panelH: 466,
    panelW: 444,
    gap: 24,

    // The variant row (SPEC-VARIANTS.md §5) had to come out of a panel that
    // was already full, so the block above it was rebalanced rather than
    // squeezed: the preview is a touch smaller (3.0 instead of 3.5 — still
    // 132x102, the biggest thing on the screen), and the WEAPON label and its
    // name are now ONE line instead of two stacked ones. That is 84px, which
    // is what the three thumbnails, the variant name and its flavour line
    // cost. Nothing below the variant row moved by more than 12px and the
    // panel band, the mode block and both hint rows are exactly where they
    // were.
    nameY: 102,
    blurbY: 122,

    previewY: 186,
    previewScale: 3.0,    // the 44x34 ship sprite at 132x102
    pedestalDY: 52,
    // 1.5, not 1.4: the ship maps are rasterized at SCALE 2, so only a
    // multiple of 0.5 gives whole device pixels per source pixel. 1.4 hands
    // some source pixels 3 screen px and the rest 2, which is the exact
    // artefact the pixel-map pipeline exists to avoid.
    ghostScale: 1.5,      // the previous / next character, peeking in
    ghostX: 126,
    ghostAlpha: 0.22,
    chevronX: 186,
    // The TAP TARGET around each browse chevron (SPEC-TOUCHUI §3). Bigger than
    // the 16px arrow inside it, because a thumb aimed at an arrow lands near
    // it; kept clear of both the preview beside it and the panel border, so
    // the pair can be padded out to the 56px floor without colliding with
    // anything. 48 x 64 leaves 24px to the panel edge and 96 to the preview.
    chevronBoxW: 48,
    chevronBoxH: 64,

    // --- the variant picker ---------------------------------------------
    // Three thumbnails of THIS character in its three palettes, the current
    // one lit and boxed, with up/down arrows either side. Thumbnails rather
    // than plain pips on purpose: the whole feature is a palette, so showing
    // the actual palettes is the fastest way to say "there are three of these
    // and you are on the second one". Blitted at scale 1 — the ship maps are
    // rasterized at SCALE 2, so 44x34 is one map pixel per screen pixel and
    // the row stays as crisp as the art beside it.
    varRowY: 272,
    varCell: 62,          // 3 * 54px boxes with 8px between them
    varBoxW: 54,
    varBoxH: 44,
    varThumbScale: 1,     // 1 on a mouse; SEL_TOUCH magnifies it for a thumb
    varDim: 0.42,         // the two variants you are NOT on
    varArrowX: 116,       // up/down arrows, outside the three boxes
    varArrowSize: 7,
    varArrowDY: 11,
    varNameY: 316,
    varFlavourY: 336,

    // WEAPON and its name, on one line: 'WEAPON' dim, then the name.
    weaponY: 358,
    weaponLabelSize: 10,
    weaponSize: 17,
    weaponGap: 9,

    /* --- the rotating gun's cycle, on that SAME line (SPEC-BURRITO.md §5) --
     * "WRAPPED" is a name, not an explanation, and a player cannot choose a
     * character whose weapon they cannot picture. So burrito's panel prints
     * the cycle itself — SIZZLE ▸ FLAKE ▸ PEPPER — beside the name.
     *
     * On the WEAPON line rather than on a row of its own, and that is a
     * layout decision with a reason: this panel is full. The band between the
     * variant flavour (336) and the ADVANTAGE line (382) is 46px carrying a
     * 17px name, and squeezing a fourth row into it would have every line in
     * the block touching its neighbours — on ALL ten panels, because the
     * layout is shared. One composed line costs nothing to the other nine
     * (the block is measured, so a character with no cycle lays out to the
     * same pixels it always did) and nothing to burrito's neighbours either.
     *
     * cycleSize is a starting size, not a promise: the block is measured
     * against the panel and steps down to cycleMinSize rather than run past
     * the edge, so a longer cycle (the second balance lever in SPEC-BURRITO
     * §1 is reordering or lengthening it) shrinks instead of overflowing.
     */
    cycleGap: 14,         // px between the weapon NAME and the first cycle name
    cycleSize: 11,
    cycleMinSize: 8,
    cycleSepW: 16,        // slot the separating chevron sits in
    cycleSepSize: 4,
    cyclePad: 18,         // px of panel kept clear either side of the block

    advY: 382,
    drawY: 402,

    // Three meters, stacked. Each is a label column, a gap, then barCells
    // lit cells — segmented rather than smooth so two panels can be compared
    // by counting rather than by squinting.
    barY: 422,
    barStep: 20,
    barLabelW: 58,
    barGap: 10,
    barW: 200,
    barH: 8,
    barCells: 10,
    barEmpty: 0.16,       // alpha of an unlit cell, so the track stays readable

    stripY: 492,
    stripCell: 40,        // 9 pips * 40 = 360 across a 444-wide panel
    stripBoxW: 50,
    stripBoxH: 40,
    // INTEGER, for the same reason PICKUP.iconScale is: the life icons are
    // 22x17 maps authored at scale 1 (sprites.js SCALE_OVERRIDE), so one map
    // pixel is one device pixel and a fractional magnification hands some
    // source pixels two screen pixels and the rest one. At 1.35 the boxed pip
    // came out visibly ragged next to its crisp 1x neighbours. 2 keeps every
    // pixel square at 44x34, which still clears the 22-wide neighbour in a
    // 40px cell by 7px.
    stripScale: 2,
    // The eight you are NOT on, at their authored size. SEL_TOUCH is the only
    // thing that ever moves this.
    stripIconScale: 1,
    stripDim: 0.5,

    hintY: 524,

    // the open-slot panel, all inside the same 72 -> 538 band
    openY: 206,
    openPressY: 256,
    openJoinY: 292,
    openPromptY: 400,

    modeLabelY: 568,
    modeY: 598,
    // Half-extents of the CO-OP / CLASSIC tap targets around their words: the
    // 26px tick either side plus a little, and enough height to take in the
    // up/down arrows at +/-20 (SPEC-TOUCHUI §3).
    modePadX: 30,
    modePadY: 26,
    modeBlurbY: 624,
    hintsY: 650,
    hints2Y: 674
  };

  /* -------------------------------------------------------------------------
   * THE SAME PANEL, RE-SOLVED FOR A THUMB  (SPEC-TOUCHUI.md §4)
   *
   * The reported bug is that you cannot tap a variant. Half of that is routing
   * — the hit regions below — and half is size: a variant thumbnail is
   * LAY.varBoxW x LAY.varBoxH, 54x44 logical, which on an 11-inch iPad with
   * both control columns reserved is 46x38 CSS px. The binding axis is 38,
   * against the 56 T.C.UI_REGION_MIN_PX asks for. A target a third under the
   * floor is a target you miss, and missing it is indistinguishable from the
   * game ignoring you.
   *
   * So on touch the thumbnails are DRAWN at T.C.UI_THUMB_TOUCH_SCALE — 1.5,
   * which is what 56 / (44 * 0.857) rounds up to on the half-step the ship
   * maps demand (they are rasterized at SCALE 2, so only multiples of 0.5 give
   * whole device pixels per source pixel; the same reason ghostScale is 1.5
   * and not 1.4). 44x34 becomes 66x51 inside an 81x66 box, which lands at
   * 69x57 CSS px — over the floor on its own, before touch.js pads anything.
   *
   * THE PANEL WAS ALREADY FULL, so this is a re-solve and not a magnification.
   * The variant row grows 22px and the roster strip 12, and both are paid for
   * ABOVE them rather than by letting anything collide: the preview steps from
   * 3.0 to 2.5 (110x85 — still the biggest thing on the screen, and still a
   * half-step), the pedestal follows it up, and the six rows between the
   * variant name and the meters each give back one to three px. The panel band
   * (72 -> 538), the mode block, both hint rows and the controller hint are
   * exactly where they were, so nothing outside this panel moves and the
   * screen below it is untouched.
   *
   * The vertical stack this solves to, top to bottom, with the clearance to
   * the row above in brackets:
   *
   *     blurb        116.5 - 127.5
   *     preview      132.5 - 227.5   (5)   180 +/- 42.5, plus the 5px bob
   *     pedestal     217.0 - 235.0
   *     variant row  239.0 - 305.0   (4)   272 +/- 33
   *     variant name 309.0 - 331.0   (4)
   *     flavour      333.5 - 344.5   (2.5)
   *     weapon       350.5 - 367.5   (6)
   *     advantage    373.5 - 384.5   (6)
   *     drawback     391.5 - 402.5   (7)
   *     meters       407.0 - 453.0   (4.5) 412 / 430 / 448
   *     roster strip 461.0 - 513.0   (8)   487 +/- 26
   *     hint line    522.5 - 533.5   (9.5) inside the 536 border
   *
   * THE ROSTER STRIP IS THE ONE THING THAT CANNOT SIMPLY GROW, and it is worth
   * saying why rather than leaving it looking like an oversight. Ten pips sit
   * at a 40px pitch across a 444-wide panel; the widest pitch that still fits
   * ten of them and the boxed one is (444 - 20 - 50) / 9 = 41.6, so there is
   * no room to spread them. The pips themselves go to UI_THUMB_TOUCH_SCALE —
   * 22 wide becomes 33, leaving a 7px gap — and the LIT one stays at
   * stripScale 2, because 2 * 1.5 = 3 would be 66 wide and would overlap its
   * neighbours by 4px. That is T.C's own conclusion: drawing these bigger buys
   * legibility, not hit area, and the hit area comes from the padded rect.
   * ---------------------------------------------------------------------- */

  /** A copy of `base` with every key of `over` written over it. */
  function relayout(base, over) {
    const out = {};
    for (const k in base) out[k] = base[k];
    for (const k in over) out[k] = over[k];
    return out;
  }

  /** The magnification a thumb-sized thumbnail is drawn at. */
  function thumbScale() {
    const k = C.UI_THUMB_TOUCH_SCALE;
    return (typeof k === 'number' && isFinite(k) && k > 0) ? k : 1;
  }

  /* THE BOX FOLLOWS THE SHIP, rather than being written down beside it.
   *
   * T.C.UI_THUMB_TOUCH_SCALE is in T.C so it can be RETUNED there (SPEC-TOUCHUI
   * §4 puts it there for exactly that reason), and the box has to be whatever
   * the magnified ship needs. Written as literals, the two drift the moment
   * anyone touches the constant: at 2 the art is 88x68 inside an 81x66 box, so
   * the thumbnail overflows its own published hit region — the drawn target and
   * the tappable one stop being the same rectangle, which is the bug this whole
   * section exists to fix — and the three sit 1px apart.
   *
   * VAR_PAD is the margin of box around the ship (7.5px a side, which is what
   * leaves the tick room in the corner), VAR_GAP the space between two boxes and
   * VAR_ARROW_GAP the clear air between the outer box and the pulsing arrow. At
   * the shipped 1.5 these resolve to exactly the numbers they replace — 81x66
   * boxes on an 89px pitch with the arrows at 148 — and at any other value the
   * row still holds together. */
  const VAR_PAD = 15;
  const VAR_GAP = 8;
  const VAR_ARROW_GAP = 18.5;
  const VAR_BOX_W = Math.round(C.SHIP_W * thumbScale()) + VAR_PAD;   // 81 at 1.5
  const VAR_BOX_H = Math.round(C.SHIP_H * thumbScale()) + VAR_PAD;   // 66 at 1.5

  /* The roster pip's magnification, stepped back to whole halves until a pip
   * fits its 40px cell with air either side. The life icons are 22x17 maps and
   * the strip's pitch is fixed by the panel width (T.C works the arithmetic),
   * so past a point drawing them bigger only makes neighbours overlap — 1.5
   * leaves a 7px gap, 2 would be 44 wide in a 40px cell. Hit area comes from
   * the padded rect either way, so shrinking here costs nothing but ragging. */
  function stripScaleFor(cell) {
    let k = thumbScale();
    while (k > 1 && 22 * k > cell - 6) k -= 0.5;
    return k > 1 ? k : 1;
  }

  const SEL_TOUCH = relayout(SEL, {
    previewY: 180,
    previewScale: 2.5,
    pedestalDY: 46,
    chevronBoxW: 60,
    chevronBoxH: 76,

    varRowY: 272,
    varCell: VAR_BOX_W + VAR_GAP,       // 89 at 1.5: 81px boxes, 8px between
    varBoxW: VAR_BOX_W,
    varBoxH: VAR_BOX_H,
    varThumbScale: thumbScale(),
    // outside the 259px the three boxes span, at 1.5
    varArrowX: VAR_BOX_W + VAR_GAP + VAR_BOX_W / 2 + VAR_ARROW_GAP,
    varArrowSize: 9,
    varArrowDY: 15,
    varNameY: 320,
    varFlavourY: 339,

    weaponY: 359,
    advY: 379,
    drawY: 397,

    barY: 412,
    barStep: 18,

    stripY: 487,
    // 46, not the desktop 50, and the 4px matters. The pips either side of the
    // lit one are now 33 wide rather than 22 (stripIconScale), so a neighbour's
    // right edge sits 23.5px from the lit pip's centre; a 50-wide box would
    // reach 25 and clip it. 46 stops at 23 — clear of the neighbour, and still
    // a 1px frame around the 44-wide lit icon.
    stripBoxW: 46,
    stripBoxH: 52,
    stripIconScale: stripScaleFor(SEL.stripCell),

    hintY: 528
  });

  /* WHICH OF THE TWO IS IN FORCE, for the frame being drawn.
   *
   * Derived, never state: renderSelect sets it from T.Touch.isTouch() before
   * it draws anything and every helper below reads it, so a machine with no
   * touch layer draws from SEL and is byte-for-byte the screen it always was.
   * It lives up here rather than being threaded through eight signatures
   * because it is one answer to one question, asked once a frame. */
  let LAY = SEL;

  /**
   * One SPEED / SPREAD / REACH meter. `frac` is the roster-derived 0..1 from
   * makeCharEntry — ui.js does not compute a balance number, it only fills
   * cells with one.
   */
  function statBar(ctx, label, frac, cx, y, color) {
    const blockW = LAY.barLabelW + LAY.barGap + LAY.barW;
    const x0 = Math.round(cx - blockW / 2);

    drawText(ctx, label, x0 + LAY.barLabelW, y, {
      size: 10, color: PAL.uiDim, align: 'right'
    });

    const bx = x0 + LAY.barLabelW + LAY.barGap;
    const by = Math.round(y - LAY.barH / 2);
    const cell = LAY.barW / LAY.barCells;
    // A non-zero stat always lights at least one cell, so "small" never reads
    // as "none at all".
    const lit = frac > 0 ? Math.max(1, Math.round(frac * LAY.barCells)) : 0;

    // Empty cells are the SAME colour at a low alpha rather than a black
    // track: over the night sky an unlit cell has to still be visible, or a
    // 6-of-10 meter reads as a short bar with nothing to compare it against.
    ctx.save();
    ctx.fillStyle = color;
    for (let i = 0; i < LAY.barCells; i++) {
      ctx.globalAlpha = i < lit ? 1 : LAY.barEmpty;
      ctx.fillRect(Math.round(bx + i * cell), by,
                   Math.max(1, Math.round(cell) - 2), LAY.barH);
    }
    ctx.restore();
  }

  /**
   * The roster strip: one small life-icon pip per character, the current one
   * lit and boxed. Nine of them is the point — a player has to be able to see
   * how long the list is and where in it they are, not just what is in front
   * of them (SPEC-CHARACTERS.md §4).
   *
   * NINE, or TEN once the secret is unlocked, and never nine-plus-a-blank:
   * the strip walks the VISIBLE roster, so a locked burrito leaves no pip, no
   * gap and no hint that a tenth pip is coming (SPEC-BURRITO.md §2). `index`
   * is a position in that same visible list.
   *
   * TAPPABLE (SPEC-TOUCHUI §3): each pip publishes a region that jumps
   * straight to that character. `value` is the position in the VISIBLE roster,
   * which is the same list game.js's uiTap indexes — so while burrito is
   * locked he is not in it and no index can name him, and the pips and the
   * regions can never disagree about which pip is which character.
   *
   * The regions TILE the strip: each is exactly one cell wide and they share
   * their edges, because that is the widest a pip's hit area can be without
   * eating its neighbour's. Ten pips at a 40px pitch is what a 444-wide panel
   * holds and there is no spreading them (T.C.UI_THUMB_TOUCH_SCALE's note
   * works the arithmetic); what makes them reachable is the padding touch.js
   * applies on the axis that has room — the vertical one.
   */
  function rosterStrip(ctx, cx, y, index, color, tintCol, vi, slot) {
    const list = visibleRoster();
    const n = list.length;
    if (n === 0) return;
    const x0 = cx - (n - 1) * LAY.stripCell / 2;
    const regY = y - LAY.stripBoxH / 2;

    for (let i = 0; i < n; i++) {
      const e = list[i];
      const ix = Math.round(x0 + i * LAY.stripCell);
      const on = i === index;

      pushRegion(idFor(ID_CHAR[slot === 1 ? 1 : 0], i),
                 ix - LAY.stripCell / 2, regY, LAY.stripCell, LAY.stripBoxH,
                 slot, 'char', i);

      if (on) {
        const bx = ix - LAY.stripBoxW / 2;
        const by = y - LAY.stripBoxH / 2;
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, LAY.stripBoxW, LAY.stripBoxH);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, LAY.stripBoxW, LAY.stripBoxH);
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = on ? 1 : LAY.stripDim;
      // The lit pip keeps stripScale in both layouts: 2 is already the widest
      // that clears its neighbours in a 40px cell, and 2 * the touch scale
      // would be 66 wide and would sit on top of them. The eight you are NOT
      // on are what the touch layout magnifies (LAY.stripIconScale), which
      // buys legibility on the glass and, as T.C says, no hit area at all.
      const k = on ? LAY.stripScale : LAY.stripIconScale;
      // The lit pip wears the chosen VARIANT's palette; the other eight are
      // characters you have not picked a variant of yet, so they stay default.
      const life = on ? variantSprite(e.life, vi) : e.life;
      if (!life || !blitTinted(ctx, life, ix, y, k, on ? tintCol : null)) {
        // stand-in at the life icon's own 22x17 footprint, so a missing pip
        // leaves the strip spaced exactly as the art would have
        previewFallback(ctx, ix, y, 22 * k, 17 * k, e.color);
      }
      ctx.restore();
    }
  }

  /**
   * THE VARIANT PICKER (SPEC-VARIANTS.md §5).
   *
   * Three thumbnails of the highlighted character, one per palette, the
   * current one lit and boxed in the player's accent, with a pulsing arrow
   * either side. A player who never finds out there are 27 versions is a
   * failed feature, so the row is drawn at every moment the panel is live —
   * the arrows are what appear only when the pads can actually move it, and
   * they take the shape of the button that does (see below).
   *
   * The thumbnails are deliberately NOT washed with the p2 accent the way the
   * big preview is: their entire job is to show three palettes side by side,
   * and a tint over them would be arguing with the thing they exist to say.
   * The box around the current one carries the player colour instead.
   *
   * TAPPABLE, AND THIS ONE IS THE REPORTED BUG (SPEC-TOUCHUI §3). Each
   * thumbnail publishes its own box with `value` = ITS OWN INDEX, so tapping
   * the third one is variant 2, from wherever you were, first time — game.js
   * sets the index it is handed and never steps toward it. START keeps
   * cycling, for anyone on a pad; this adds a way in, it removes none.
   *
   * SELECTED, NOT MERELY HIGHLIGHTED (§5). There is no hover on a touchscreen,
   * so a marking that reads as "focused" says nothing: on the glass the
   * current thumbnail gets a brighter wash, a heavier 3px box, and a TICK
   * struck into its top-right corner — a mark that means chosen, not a mark
   * that means the cursor is here. The desktop marking is left exactly as it
   * was, wash and 2px box: a mouse HAS a hover, and this screen has shipped.
   */
  function variantPicker(ctx, cx, y, info, vi, col, t, hint, slot) {
    const list = info.variants;
    const n = list ? list.length : 0;
    if (n === 0) return;

    const glass = LAY === SEL_TOUCH;
    const p = slot === 1 ? 1 : 0;
    const x0 = cx - (n - 1) * LAY.varCell / 2;
    for (let i = 0; i < n; i++) {
      const ix = Math.round(x0 + i * LAY.varCell);
      const on = i === vi;
      const bx = Math.round(ix - LAY.varBoxW / 2);
      const by = Math.round(y - LAY.varBoxH / 2);

      pushRegion(idFor(ID_VAR[p], i), bx, by, LAY.varBoxW, LAY.varBoxH,
                 p, 'variant', i);

      if (on) {
        ctx.save();
        ctx.globalAlpha = glass ? 0.26 : 0.18;
        ctx.fillStyle = col;
        ctx.fillRect(bx, by, LAY.varBoxW, LAY.varBoxH);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = col;
        ctx.lineWidth = glass ? 3 : 2;
        ctx.strokeRect(bx, by, LAY.varBoxW, LAY.varBoxH);
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = on ? 1 : LAY.varDim;
      const name = variantSprite(info.sprite, i);
      const k = LAY.varThumbScale;
      if (!name || !blitCentered(ctx, name, ix, y, k)) {
        previewFallback(ctx, ix, y, C.SHIP_W * k, C.SHIP_H * k, list[i].color);
      }
      ctx.restore();

      // The tick goes ON TOP of the art, in the box's top-right corner, and
      // only on the glass. Over the thumbnail rather than beside it because
      // the box has 7px of margin round a 66x51 ship and no room for a badge
      // of its own — and because a mark that sits ON the thing it marks cannot
      // be read as belonging to its neighbour.
      if (on && glass) {
        selectedTick(ctx, bx + LAY.varBoxW - 21, by + 5, 16, col);
      }
    }

    /* The affordance, pulsing, on both sides of the row — and it has to match
     * the button that actually moves this. A control that steps UP and DOWN
     * gets up/down arrows; a control that only steps FORWARD (the START
     * button the game binds today) gets forward chevrons, because two arrows
     * pointing opposite ways would be promising a direction the player cannot
     * go. A build with no picker wired at all gets neither: an arrow aimed at
     * a button that does something else is worse than no arrow. Either way
     * the button's NAME is printed on the panel's hint line below. */
    if (!hint) return;
    const a = pulse(t * 1.0, 4.0, 0.35, 1);
    const upDown = namesUpDown(hint);
    for (let s = -1; s <= 1; s += 2) {
      const ax = cx + s * LAY.varArrowX;
      if (upDown) {
        triangle(ctx, ax, y - LAY.varArrowDY, LAY.varArrowSize, -1, col, a);
        triangle(ctx, ax, y + LAY.varArrowDY, LAY.varArrowSize, 1, col, a);
      } else {
        chevron(ctx, ax, y, LAY.varArrowSize + 2, 1, col, a);
      }
    }
  }

  /* -------------------------------------------------------------------------
   * DRAWING THE CYCLE  (SPEC-BURRITO.md §5)
   *
   * Shared by the select panel and the HUD chip, because they are two answers
   * to the same question and must never disagree about the order. Both read it
   * out of T.Weapons.cycleState — the gun's own state — and neither knows what
   * the cycle contains until it asks.
   *
   * The two say different things about it, on purpose:
   *   SELECT  — every name lit. There is no gun yet and no position in the
   *             cycle to be at; what a player needs before picking him is the
   *             ORDER, so nothing on the row is louder than anything else.
   *   HUD     — the NEXT name lit, the others dimmed and ruled under. There
   *             the position is the whole point: you cannot plan a shot you
   *             cannot predict.
   * ---------------------------------------------------------------------- */

  /* Filled in place and read back immediately — §12 forbids allocating in a
   * per-frame path, and one select panel plus two HUD chips walk this every
   * frame. The records are reused; only a longer cycle ever grows the array. */
  const CYCLE_SEGS = [];

  /**
   * Fill CYCLE_SEGS from a T.Weapons.cycleState view; returns how many entries
   * are live. Each record is { name, color } — IDENTITY ONLY. Every number
   * about a borrowed weapon belongs to the character that owns it (the rasher
   * is the bacon strip's, measured and shipped), and this file states none of
   * them; it prints what the def calls itself, in the colour the def wears.
   */
  function fillCycleSegs(view) {
    const wids = view ? view.wids : null;
    if (!wids || !wids.length) return 0;
    let n = 0;
    for (let i = 0; i < wids.length; i++) {
      const def = view.defs ? view.defs[i] : null;
      let seg = CYCLE_SEGS[n];
      if (!seg) {
        seg = { name: '', color: PAL.ui };
        CYCLE_SEGS[n] = seg;
      }
      // A cycle entry weapons.js could not resolve still gets a name, because
      // a gap in this row is the one thing it may not have.
      seg.name = (def && def.name) ? def.name : String(wids[i]);
      seg.color = (def && def.color) ? def.color : PAL.ui;
      n++;
    }
    return n;
  }

  /** Width of the filled cycle row at a given text size. */
  function cycleRowWidth(ctx, n, size, sepW) {
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) w += sepW;
      w += textWidth(ctx, CYCLE_SEGS[i].name, { size: size });
    }
    return w;
  }

  /**
   * NAME ▸ NAME ▸ NAME from x, centred on y. Returns the width drawn.
   *
   *   nextIdx  -1 lights every name equally; >= 0 lights that one, dims the
   *            rest to `dimFrac` and rules a hairline under the lit one
   *   alpha    the caller's own fade (an OUT player's chip is at 0.32), folded
   *            in by hand because drawText's `alpha` REPLACES the context's
   */
  function drawCycleRow(ctx, x, y, n, size, sepW, sepSize,
                        nextIdx, alpha, dimFrac, ruleDY) {
    let px = x;
    for (let i = 0; i < n; i++) {
      const seg = CYCLE_SEGS[i];
      const on = nextIdx < 0 || i === nextIdx;
      const w = textWidth(ctx, seg.name, { size: size });

      if (i > 0) chevron(ctx, px - sepW / 2, y, sepSize, 1, PAL.uiDim, alpha * 0.8);

      drawText(ctx, seg.name, px, y, {
        size: size, color: seg.color, align: 'left', shadow: true,
        alpha: on ? alpha : alpha * dimFrac,
        glow: (on && nextIdx >= 0) ? 8 : 0, glowColor: seg.color
      });

      // The lit name is underlined as well as brightened: on the HUD strip the
      // three weapon colours are not equally bright, and brightness alone would
      // make "which is next" a question about the palette.
      if (on && nextIdx >= 0 && ruleDY) {
        ctx.save();
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = seg.color;
        ctx.fillRect(Math.round(px), Math.round(y + ruleDY),
                     Math.max(1, Math.round(w)), 1);
        ctx.restore();
      }

      px += w + sepW;
    }
    return n > 0 ? px - sepW - x : 0;
  }

  /**
   * WEAPON and its name on one line, sized as a block so the pair centres —
   * plus, for the rotating gun and only for it, the cycle it turns through
   * (SPEC-BURRITO.md §5). The other nine measure and lay out exactly as they
   * always did: with no cycle the block is the same two pieces it was.
   */
  function weaponLine(ctx, cx, y, info) {
    const labelW = textWidth(ctx, 'WEAPON', { size: LAY.weaponLabelSize });
    const nameW = textWidth(ctx, info.weapon,
                            { size: LAY.weaponSize, bold: true });

    const n = (info.mech === 'cycle')
      ? fillCycleSegs(cycleForKind(info.key)) : 0;

    // Fit the cycle to the panel rather than to a hope: measure, and step the
    // size down until it is inside the panel's clear width.
    let size = LAY.cycleSize;
    let cycW = 0;
    if (n > 0) {
      const room = LAY.panelW - LAY.cyclePad * 2 -
                   labelW - LAY.weaponGap - nameW - LAY.cycleGap;
      cycW = cycleRowWidth(ctx, n, size, LAY.cycleSepW);
      while (cycW > room && size > LAY.cycleMinSize) {
        size -= 1;
        cycW = cycleRowWidth(ctx, n, size, LAY.cycleSepW);
      }
    }

    const total = labelW + LAY.weaponGap + nameW +
                  (n > 0 ? LAY.cycleGap + cycW : 0);
    const x0 = cx - total / 2;

    drawText(ctx, 'WEAPON', x0, y, {
      size: LAY.weaponLabelSize, color: PAL.uiDim, align: 'left'
    });
    drawText(ctx, info.weapon, x0 + labelW + LAY.weaponGap, y, {
      size: LAY.weaponSize, color: PAL.butter, align: 'left',
      bold: true, glow: 12
    });
    if (n > 0) {
      drawCycleRow(ctx, x0 + labelW + LAY.weaponGap + nameW + LAY.cycleGap, y,
                   n, size, LAY.cycleSepW, LAY.cycleSepSize, -1, 1, 1, 0);
    }
  }

  /**
   * The prompt shown in a panel nobody has joined yet.
   *
   * On touch the second player's way in is their own P2 target, NOT START —
   * with one player joined the layout is solo and both columns' STARTs are
   * P1's — so the panel names the thing that will actually let them in.
   *
   * And now the panel ITSELF is the target (SPEC-TOUCHUI §3): the whole open
   * slot, inside its border, joins that player. One region rather than a
   * rectangle round the blinking word, because the panel is what the prompt is
   * pointing at and a thumb aimed at a two-line prompt lands anywhere in it.
   * The P2 button on the glass keeps working exactly as it does today.
   */
  function openSlotPanel(ctx, cx, x, slot, col, t) {
    pushRegion(ID_JOIN[slot === 1 ? 1 : 0],
               x + 8, LAY.panelY + 8, LAY.panelW - 16, LAY.panelH - 16,
               slot, 'join', null);

    const press = touchOn() ? ('TAP ' + joinButtonName(slot)) : 'PRESS START';
    drawText(ctx, 'SLOT OPEN', cx, LAY.openY, {
      size: 20, color: PAL.uiDim, align: 'center'
    });
    const blink = (t % 1.0) < 0.6;
    if (blink) {
      drawText(ctx, press, cx, LAY.openPressY, {
        size: 24, color: col, align: 'center', bold: true, glow: 16
      });
      drawText(ctx, 'TO JOIN', cx, LAY.openJoinY, {
        size: 18, color: col, align: 'center'
      });
    }
    // §10 asks for this prompt by name; the slot number must track the panel
    // it is drawn in, not be hardcoded to P2.
    drawText(ctx, 'PLAYER ' + (slot + 1) + ' — ' + press + ' TO JOIN', cx,
      LAY.openPromptY, { size: 11, color: PAL.uiDim, align: 'center' });
  }

  /**
   * One player's carousel panel. The two panels browse INDEPENDENTLY and may
   * land on the same character, which is why P2's preview and lit pip carry
   * the p2 accent wash — the art is otherwise identical.
   *
   * `varHint` arrives already resolved for the machine it is being drawn on
   * (renderSelect runs it through buttonName), so everything below can print
   * it verbatim, exactly as it always did.
   */
  function selectPanel(ctx, x, slot, entry, t, varHint) {
    const w = LAY.panelW;
    const y = LAY.panelY;
    const h = LAY.panelH;
    const cx = x + w / 2;
    const col = slotColor(slot);
    const info = charInfo(entry.kind);
    const joined = entry.active;
    const tintCol = slot === 1 ? PAL.p2 : null;
    // Already normalised by selectState — clamped here only so a caller that
    // hands this function a raw payload cannot index past the roster.
    const vi = variantIndexOf(info, entry.variant) || 0;
    const variant = variantOf(info, vi);

    panel(ctx, x, y, w, h, joined ? col : PAL.uiDim, joined ? 1 : 0.55);

    // player tab across the top edge
    ctx.save();
    ctx.globalAlpha = joined ? 1 : 0.5;
    ctx.fillStyle = joined ? col : PAL.uiDim;
    ctx.fillRect(cx - 46, y - 12, 92, 24);
    ctx.restore();
    drawText(ctx, 'PLAYER ' + (slot + 1), cx, y, {
      size: 14, color: '#0b0c12', align: 'center', bold: true
    });

    if (!joined) {
      openSlotPanel(ctx, cx, x, slot, col, t);
      return;
    }

    drawText(ctx, info.name, cx, LAY.nameY, {
      size: 26, color: info.color, align: 'center', bold: true, glow: 14
    });
    drawText(ctx, info.blurb, cx, LAY.blurbY, {
      size: 11, color: PAL.uiDim, align: 'center'
    });

    // pedestal shadow so the character does not float in a void
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(cx, LAY.previewY + LAY.pedestalDY, 84, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The neighbours in the carousel, ghosted in at the sides: the roster is
    // a wheel and the panel should look like one, not like a light switch.
    // The wheel is the VISIBLE roster — while burrito is locked the wheel runs
    // milk -> bread with nothing between them, because a ghost of a character
    // who is not on the list would announce him (SPEC-BURRITO.md §2).
    const vis = visibleRoster();
    const here = visibleIndexOf(info);
    if (!entry.ready && vis.length > 1 && here >= 0) {
      const n = vis.length;
      const prev = vis[(here - 1 + n) % n];
      const next = vis[(here + 1) % n];
      ctx.save();
      ctx.globalAlpha = LAY.ghostAlpha;
      if (prev.sprite) {
        blitTinted(ctx, prev.sprite, cx - LAY.ghostX, LAY.previewY,
                   LAY.ghostScale, tintCol);
      }
      if (next.sprite) {
        blitTinted(ctx, next.sprite, cx + LAY.ghostX, LAY.previewY,
                   LAY.ghostScale, tintCol);
      }
      ctx.restore();
    }

    // Big preview: idle, with a brief "firing" frame flick so it feels alive —
    // and drawn through the VARIANT's palette, so cycling the picker changes
    // the thing the player is actually looking at (SPEC-VARIANTS.md §5).
    const bob = Math.sin(t * 2.2 + slot) * 5;
    const flick = ((t + slot * 0.7) % 2.6) < 0.13;
    const baseName = (flick && info.spriteFire) ? info.spriteFire : info.sprite;
    const spriteName = variantSprite(baseName, vi);
    const k = LAY.previewScale;
    if (!spriteName || !blitTinted(ctx, spriteName, cx, LAY.previewY + bob, k, tintCol)) {
      previewFallback(ctx, cx, LAY.previewY + bob,
                      C.SHIP_W * k, C.SHIP_H * k, variant ? variant.color : info.color);
    }

    /* THE BIG PREVIEW READIES THIS PLAYER UP (SPEC-TOUCHUI §3). Published at
     * the sprite's own footprint, undisturbed by the bob — a target that moved
     * 5px up and down at 2.2 rad/s would be a target you chase — and it is the
     * largest thing on the panel by a distance, so it needs no help from the
     * padding to clear the 56px floor. */
    pushRegion(ID_READY[slot === 1 ? 1 : 0],
               cx - C.SHIP_W * k / 2, LAY.previewY - C.SHIP_H * k / 2,
               C.SHIP_W * k, C.SHIP_H * k, slot, 'ready', null);

    // browse hints, only meaningful while the pick is unlocked — and, since
    // SPEC-TOUCHUI §3, tappable: one step along the carousel each, the same
    // wrap the D-pad gets. Published only while they are DRAWN, so a locked-in
    // panel offers nothing a locked-in panel does not answer. The box is wider
    // and taller than the 16px chevron inside it because a thumb aimed at an
    // arrow lands near it, not on it; touch.js grows whatever is left.
    if (!entry.ready) {
      const a = pulse(t * 1.0, 4.0, 0.35, 1);
      chevron(ctx, cx - LAY.chevronX, LAY.previewY, 16, -1, col, a);
      chevron(ctx, cx + LAY.chevronX, LAY.previewY, 16, 1, col, a);

      const cw = LAY.chevronBoxW;
      const ch = LAY.chevronBoxH;
      const p = slot === 1 ? 1 : 0;
      pushRegion(ID_PREV[p], cx - LAY.chevronX - cw / 2, LAY.previewY - ch / 2,
                 cw, ch, slot, 'charStep', -1);
      pushRegion(ID_NEXT[p], cx + LAY.chevronX - cw / 2, LAY.previewY - ch / 2,
                 cw, ch, slot, 'charStep', 1);
    }

    // The variant row, then the variant's NAME and its flavour line. The name
    // is the loudest thing under the preview on purpose: it is the identity
    // the player is choosing, and the one the HUD chip will print all game.
    variantPicker(ctx, cx, LAY.varRowY, info, vi, col, t,
                  entry.ready ? '' : varHint, slot);
    if (variant) {
      const nameCol = legible(variant.color);
      drawText(ctx, variant.name, cx, LAY.varNameY, {
        size: 22, color: nameCol, align: 'center', bold: true,
        glow: 14, glowColor: nameCol, shadow: true
      });
      drawText(ctx, variant.flavour, cx, LAY.varFlavourY, {
        size: 11, color: PAL.uiDim, align: 'center'
      });
    }

    weaponLine(ctx, cx, LAY.weaponY, info);

    // THE TRADE, in the roster's own words. Every character is one advantage
    // paired with one drawback, and a player has to be able to read that
    // before committing rather than discover it by dying: this is the whole
    // reason SPEC-CHARACTERS.md keeps the copy in T.C.BASE_WEAPONS.
    drawText(ctx, '+ ' + info.advantage, cx, LAY.advY, {
      size: 11, color: PAL.crumb, align: 'center', shadow: true
    });
    drawText(ctx, '- ' + info.drawback, cx, LAY.drawY, {
      size: 11, color: PAL.danger, align: 'center', shadow: true
    });

    for (let i = 0; i < info.bars.length; i++) {
      statBar(ctx, info.bars[i].label, info.bars[i].frac,
              cx, LAY.barY + i * LAY.barStep, col);
    }

    rosterStrip(ctx, cx, LAY.stripY, here, col, tintCol, vi, slot);

    // Where you are in BOTH lists — nine characters across (ten with the
    // secret earned), three variants deep. The COUNT is the visible roster's,
    // never the table's: "3 OF 10" while burrito is still locked would be the
    // whole secret, given away by a number (SPEC-BURRITO.md §2 and §5). When
    // the pads cannot move the variant yet the line states the position
    // without naming a button for it.
    const nVar = variantCountOf(info);
    const pos = here >= 0
      ? (here + 1) + ' OF ' + vis.length
      : '';
    const vpos = nVar > 0 ? (vi + 1) + ' OF ' + nVar : '';
    let hint;
    if (entry.ready) hint = 'LOCKED IN';
    else if (varHint && vpos) {
      hint = buttonName('L/R') + ' CHAR ' + pos + '    ' + varHint +
             ' VARIANT ' + vpos;
    } else if (vpos) {
      hint = buttonName('LEFT / RIGHT') + '   ' + pos + '   ·   VARIANT ' + vpos;
    } else hint = buttonName('LEFT / RIGHT') + '   ' + pos;

    drawText(ctx, hint, cx, LAY.hintY, {
      size: 11, color: entry.ready ? col : PAL.uiDim, align: 'center'
    });

    if (entry.ready) drawReadyStamp(ctx, cx, LAY.previewY, col, t);
  }

  /** The rotated READY stamp slapped over a locked-in character. */
  function drawReadyStamp(ctx, cx, cy, color, t) {
    const w = 232;
    const h = 66;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.16);
    ctx.globalAlpha = pulse(t, 5.0, 0.82, 1);

    ctx.fillStyle = 'rgba(6,8,14,0.55)';
    ctx.fillRect(-w / 2, -h / 2, w, h);

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2 + 8, -h / 2 + 8, w - 16, h - 16);

    drawText(ctx, 'READY', 0, 1, {
      size: 34, color: color, align: 'center', bold: true, glow: 16
    });
    ctx.restore();
  }

  /**
   * CO-OP / CLASSIC selector.
   *
   * `hint` is the button that flips it, as the game state stated it. Up and
   * down belong to the variant picker now (SPEC-VARIANTS.md §5), so the pair
   * of up/down triangles is drawn only while up/down really is what moves
   * this — otherwise the selector shows the live mode and names its own
   * button in the label instead of pointing at the wrong stick.
   *
   * TAPPING EITHER WORD PICKS IT DIRECTLY (SPEC-TOUCHUI §3) — it is a pair of
   * choices, not a toggle, so CO-OP taps to CO-OP whichever one is lit and
   * tapping the live one is a no-op rather than a flip. The region takes in
   * the word, the two pulsing ticks either side of it and the arrows above and
   * below, because all four are part of the same thing to aim at; the two are
   * 300px apart so neither can ever reach the other.
   */
  function modeSelector(ctx, mode, t, hint) {
    const upDown = namesUpDown(hint);
    drawText(ctx, hint ? '— GAME MODE · ' + hint + ' —' : '— GAME MODE —',
      C.W / 2, LAY.modeLabelY, {
        size: 11, color: PAL.uiDim, align: 'center'
      });

    const spread = 150;
    for (let i = 0; i < MODE_ORDER.length; i++) {
      const key = MODE_ORDER[i];
      const m = MODES[key];
      const cx = C.W / 2 + (i === 0 ? -spread : spread);
      const on = key === mode;
      const col = on ? PAL.butter : PAL.uiDim;

      const w = textWidth(ctx, m.label, { size: on ? 22 : 18 });
      if (on) {
        ctx.save();
        ctx.globalAlpha = pulse(t, 4.2, 0.5, 0.95);
        ctx.fillStyle = PAL.butter;
        ctx.fillRect(cx - w / 2 - 26, LAY.modeY - 3, 10, 6);
        ctx.fillRect(cx + w / 2 + 16, LAY.modeY - 3, 10, 6);
        ctx.restore();
        if (upDown) {
          triangle(ctx, cx, LAY.modeY - 20, 6, -1, PAL.butter, pulse(t, 4.2, 0.4, 1));
          triangle(ctx, cx, LAY.modeY + 20, 6, 1, PAL.butter, pulse(t, 4.2, 0.4, 1));
        }
      }

      drawText(ctx, m.label, cx, LAY.modeY, {
        size: on ? 22 : 18, color: col, align: 'center',
        bold: on, glow: on ? 14 : 0
      });

      pushRegion(ID_MODE[key], cx - w / 2 - LAY.modePadX,
                 LAY.modeY - LAY.modePadY, w + LAY.modePadX * 2,
                 LAY.modePadY * 2, null, 'mode', key);
    }

    drawText(ctx, MODES[mode].blurb, C.W / 2, LAY.modeBlurbY, {
      size: 12, color: PAL.ui, align: 'center', alpha: 0.85
    });
  }

  // Hoisted: renderSelect runs every frame and §12 forbids allocating in a
  // per-frame path, so the hint row is assembled in place.
  const HINT_PARTS = [];
  const HINT_MAX_W = C.W - 32;

  function renderSelect(ctx, g) {
    const t = U.now();
    const st = selectState(g);

    /* WHICH LAYOUT THIS FRAME IS DRAWN IN, decided once, before anything is
     * measured or placed. On a machine with no touch layer this is SEL and
     * every pixel below is the screen that shipped; on the glass it is
     * SEL_TOUCH, whose thumbnails and roster pips are big enough to hit
     * (SPEC-TOUCHUI §4). Nothing else on this screen reads T.Touch. */
    LAY = touchOn() ? SEL_TOUCH : SEL;

    beginRegions();
    noteTapAck(g);
    ctx.save();

    dim(ctx, 0.28);

    drawText(ctx, 'SELECT YOUR BREAKFAST', C.W / 2, LAY.headY, {
      size: 28, color: PAL.crumb, align: 'center', bold: true,
      glow: 18, glowColor: PAL.butter
    });

    /* game.js names the bindings; this is where those names become the words a
     * player reads. Off touch buttonName hands back exactly what it was given
     * and every label on this screen is unchanged; on touch each one becomes
     * the label written on the target a thumb can reach, so the panels, the
     * picker arrows, the mode block and the hint row all agree with the glass
     * and with each other. The RAW hints stay on `st` for the logic below —
     * what a binding IS and what it is CALLED are two different questions. */
    const glass = touchOn();
    const varHint = buttonName(st.variantHint);
    const modeHint = buttonName(st.modeHint);

    const totalW = LAY.panelW * 2 + LAY.gap;
    const leftX = Math.round((C.W - totalW) / 2);
    selectPanel(ctx, leftX, 0, st.slots[0], t, varHint);
    selectPanel(ctx, leftX + LAY.panelW + LAY.gap, 1, st.slots[1], t, varHint);

    // Remember each player's character AND variant, so the next boot puts them
    // back where they were (SPEC-VARIANTS.md §5). This is the one place in
    // ui.js that writes anything, and it writes only what it just drew: the
    // resolved pick, at most once per actual change, through T.Util.storeSet,
    // which swallows the throw file:// and private mode can raise.
    //
    // `kindGiven` guards it, and that guard is the difference between a
    // harmless default and data loss. Every other read in this file falls back
    // to something safe to DRAW; this one would fall back to something written
    // over the player's saved pick. A frame rendered before the state is built,
    // or handed a slot with no character on it, or naming a character this
    // roster has never heard of, must leave both saved slots exactly as it
    // found them — so a pick is only remembered when the state actually named
    // a character this file has, and the player is actually in that seat.
    for (let i = 0; i < st.slots.length; i++) {
      if (st.slots[i].active && st.slots[i].kindGiven) {
        rememberPick(i, st.slots[i].kind, st.slots[i].variant);
      }
    }

    modeSelector(ctx, st.mode, t, modeHint);

    /* Real button hints, in the order a player meets them: fire readies up,
     * left/right or Y walks the nine-character carousel, one button steps
     * that character's three variants, up/down flips the mode, B backs out
     * (P2 drops, P1 returns to title). Every button NAME here comes from the
     * select state (see selectState) so this row can never drift from what
     * game.js listens for.
     *
     * Assembled rather than written out because it now has to carry a sixth
     * pair: at 13px the full row is close to the screen's width, so if it
     * would not fit, Y — the one binding that only duplicates something else
     * on the row — is dropped instead of letting the line run off the sides.
     *
     * TOUCH (SPEC-TOUCH §2). This row answers exactly one question — "what do
     * I press?" — so on the glass it lists only what a thumb can reach. Y goes
     * first (there is no Y, and it only duplicates the arrows), and a binding
     * that needs a pad is left to the block it belongs to, where it can be
     * qualified without turning this line into a paragraph: the mode block
     * above already prints PAD UP/DOWN in its own label. That also bounds the
     * row — on the glass every name comes from the fixed table above, so the
     * longest line this can build is comfortably inside HINT_MAX_W and the
     * drop below has nothing left to do. */
    HINT_PARTS.length = 0;
    HINT_PARTS.push(buttonName('A') + ' = READY',
                    buttonName('L/R') + ' = BROWSE');
    let dropIdx = -1;
    if (!glass || onGlass('Y')) {
      dropIdx = HINT_PARTS.length;
      HINT_PARTS.push('Y = NEXT');
    }
    if (st.variantHint && (!glass || onGlass(st.variantHint))) {
      HINT_PARTS.push(varHint + ' = VARIANT');
    }
    if (st.modeHint && (!glass || onGlass(st.modeHint))) {
      HINT_PARTS.push(modeHint + ' = MODE');
    }
    // 'BACK = BACK' would be a tautology, so on the glass the button keeps its
    // label and the JOB is renamed instead — it is what B does here either way.
    HINT_PARTS.push(buttonName('B') + (glass ? ' = LEAVE' : ' = BACK'));
    let hints = HINT_PARTS.join('   ');
    if (dropIdx >= 0 && textWidth(ctx, hints, { size: 13 }) > HINT_MAX_W) {
      HINT_PARTS.splice(dropIdx, 1);
      hints = HINT_PARTS.join('   ');
    }
    drawText(ctx, hints, C.W / 2, LAY.hintsY, {
      size: 13, color: PAL.ui, align: 'center', alpha: 0.9
    });

    // START does NOT begin the game — game.js starts the session the instant
    // every joined player has readied up. On this screen START only drops an
    // unjoined player in, so say that instead of promising a button that does
    // nothing.
    let joined = 0;
    let ready = 0;
    for (let i = 0; i < st.slots.length; i++) {
      if (!st.slots[i].active) continue;
      joined++;
      if (st.slots[i].ready) ready++;
    }
    const anyOpen = !st.slots[0].active || !st.slots[1].active;

    if (anyOpen) {
      const blink = (t % 0.9) < 0.55;
      // START does two jobs on this screen — it drops an open slot in, and,
      // once you are in, it steps your variant. Say which one this is, or the
      // two lines read as a contradiction. On the glass there is no ambiguity
      // to resolve: the open slot has its own target (P2 for the second
      // player), so the line simply names it.
      const openSlot = st.slots[0].active ? 1 : 0;
      const joinLine = glass
        ? ('TAP ' + joinButtonName(openSlot) + ' TO JOIN')
        : (st.variantHint === 'START'
            ? 'START = JOIN THE OPEN SLOT' : 'START = JOIN');
      drawText(ctx, joinLine, C.W / 2, LAY.hints2Y, {
        size: blink ? 17 : 14, color: blink ? PAL.butter : PAL.uiDim,
        align: 'center', bold: blink, glow: blink ? 14 : 0
      });
    } else {
      // One of the two has locked in and we are waiting on the other.
      const waiting = ready > 0 && ready < joined;
      drawText(ctx, waiting ? 'WAITING FOR THE OTHER PLAYER'
                            : 'READY UP TO BEGIN', C.W / 2, LAY.hints2Y, {
        size: 14, color: PAL.uiDim, align: 'center'
      });
    }

    // Last, over everything it might be acknowledging (SPEC-TOUCHUI §5).
    drawTapFlash(ctx);

    ctx.restore();
  }

  /* =========================================================================
   * 7. HUD  (the strip above PLAY_TOP)
   * ====================================================================== */

  const HUD = {
    labelY: 22,
    scoreY: 50,
    livesY: 78,
    edge: 22,
    lifeGap: 4,
    maxLifeIcons: 5
  };

  // The weapon chip: a 16x16 icon on the OUTER edge, the weapon NAME beside
  // it, and an ammo bar underneath. Every offset is signed by `dir`, which is
  // how the whole block mirrors for P2 on the right-hand side.
  const CHIP = {
    icon: 16,
    gap: 7,
    nameSize: 12,
    nameDY: -8,
    barDY: 8,
    barW: 104,
    barH: 6,
    barSeg: 13,           // px between the dark tick gaps in the fill
    infW: 22,             // width of the infinity glyph on base weapons
    countSize: 9,
    lowFrac: 0.25,        // bar starts flashing red under this
    flashHz: 6,

    /* --- the rotating gun's cycle (SPEC-BURRITO.md §5) -------------------
     * For burrito the second line of the chip is not "∞ UNLIMITED" — it is
     * SIZZLE ▸ FLAKE ▸ PEPPER with the next one lit. That is not decoration:
     * his advantage is three mechanics and his drawback is that he does not
     * choose between them, and a player who cannot see which one is coming is
     * not playing that trade, they are pulling a lever. It is the one weapon
     * in the game whose HUD has to say more than a name.
     *
     * It goes exactly where the infinity glyph and its UNLIMITED label went,
     * on the same baseline, so the chip keeps its footprint: cycleMaxW is 152
     * against the 152 the widest existing chip line already spends (a 104px
     * ammo bar, 7px, and an 'x100' count), and the row STEPS DOWN a size
     * rather than grow past it if the cycle is ever lengthened.
     */
    cycleSize: 9,
    cycleMinSize: 7,
    cycleSepW: 11,        // slot the separating chevron sits in
    cycleSepSize: 3,
    cycleDim: 0.34,       // the two weapons that are NOT next
    cycleRuleDY: 6,       // hairline under the one that is
    cycleMaxW: 152
  };

  /**
   * The weapon chip for ONE ship (SPEC-WEAPONS.md §8).
   *
   *   ctx, ship — the ship whose `weapon` state is being read
   *   x, y      — the chip's anchor: its OUTER edge, and its vertical centre
   *   align     — 'left' grows the block rightwards (P1), 'right' leftwards (P2)
   *
   * Draws nothing at all when weapons.js is not loaded or the ship has no
   * weapon yet, so the base game is unaffected.
   */
  function renderWeaponChip(ctx, ship, x, y, align) {
    const info = weaponInfo(ship);
    if (!info) return;

    const t = U.now();
    const dir = (align === 'right') ? -1 : 1;
    const col = info.color;
    const out = shipIsOut(ship);
    const alpha = out ? 0.32 : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    // The icon hugs the outer edge in both mirrors. An UPGRADE shows its own
    // 16x16 roundel; a BASE weapon has none by design (SPEC-WEAPONS §6 lists
    // fifteen droppable icons, and none of the nine base weapons drops), so
    // the chip identifies it with that CHARACTER's life icon instead — the
    // one piece of art that already reads as "bread" or "coffee mug" small.
    // ...in this ship's VARIANT palette, so the chip, the life icons and the
    // ship on the field are all the same breakfast (SPEC-VARIANTS.md §5).
    const lifeName = info.base
      ? variantSprite(charInfo(ship && ship.kind).life, shipVariant(ship))
      : null;
    const lifeIcon = lifeName ? sprite(lifeName) : null;
    const iconW = lifeIcon ? lifeIcon.w : CHIP.icon;
    const iconCx = x + dir * (iconW / 2);
    if (lifeIcon) {
      ctx.drawImage(lifeIcon.canvas, Math.round(iconCx - lifeIcon.w / 2),
                    Math.round(y - lifeIcon.h / 2), lifeIcon.w, lifeIcon.h);
    } else {
      drawWeaponIcon(ctx, info.def, iconCx, y, 1, 1);
    }

    const textX = x + dir * (iconW + CHIP.gap);
    drawText(ctx, info.name, textX, y + CHIP.nameDY, {
      size: CHIP.nameSize, color: col, align: dir > 0 ? 'left' : 'right',
      shadow: true, glow: out ? 0 : 8, glowColor: col
    });

    const by = Math.round(y + CHIP.barDY - CHIP.barH / 2);

    if (info.base) {
      /* THE ROTATING GUN (SPEC-BURRITO.md §5). Burrito's second line is the
       * cycle, with the weapon the NEXT trigger pull will fire lit and the
       * other two dimmed — read straight out of T.Weapons.cycleState, which
       * is the gun's own position and not a copy of it kept here.
       *
       * `active` is false while an upgrade token is overriding the cycle, and
       * then this branch is not even reached: an upgrade is not a base weapon,
       * so the chip draws its ammo bar exactly as it does for everyone else,
       * and the cycle comes back — at the position it was left at — when the
       * token runs out. Printing a cycle beside a full mortar would be telling
       * the player about a shot they are not about to fire.
       */
      const cyc = cycleOf(ship);
      const segs = (cyc && cyc.active) ? fillCycleSegs(cyc) : 0;
      if (segs > 0) {
        let size = CHIP.cycleSize;
        let roww = cycleRowWidth(ctx, segs, size, CHIP.cycleSepW);
        while (roww > CHIP.cycleMaxW && size > CHIP.cycleMinSize) {
          size -= 1;
          roww = cycleRowWidth(ctx, segs, size, CHIP.cycleSepW);
        }
        // Anchored at the outer edge in both mirrors, exactly like the bar:
        // P1 grows inward from the left, P2 inward from the right.
        const rowX = dir > 0 ? textX : textX - roww;
        drawCycleRow(ctx, rowX, y + CHIP.barDY, segs, size,
                     CHIP.cycleSepW, CHIP.cycleSepSize,
                     cyc.next, alpha, CHIP.cycleDim, CHIP.cycleRuleDY);
        ctx.restore();
        return;
      }

      // No base weapon ever runs dry, on any of the nine: an infinity sign,
      // not a full bar you would spend the whole game watching not move.
      const gx = textX + dir * (CHIP.infW / 2);
      infinityGlyph(ctx, gx, y + CHIP.barDY, CHIP.infW, col, 0.85);
      drawText(ctx, 'UNLIMITED', textX + dir * (CHIP.infW + 8), y + CHIP.barDY, {
        size: CHIP.countSize, color: PAL.uiDim, align: dir > 0 ? 'left' : 'right'
      });
      ctx.restore();
      return;
    }

    const bx = Math.round(dir > 0 ? textX : textX - CHIP.barW);
    const frac = info.frac;
    const low = frac <= CHIP.lowFrac;
    const flash = low && ((t * CHIP.flashHz) % 1) < 0.5;

    // track
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, CHIP.barW, CHIP.barH);

    // fill — anchored at the outer end, so it drains back toward the icon
    const fw = frac > 0 ? Math.max(2, Math.round(CHIP.barW * frac)) : 0;
    if (fw > 0) {
      ctx.save();
      if (low) {
        ctx.shadowColor = PAL.danger;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = flash ? PAL.danger : col;
      ctx.fillRect(dir > 0 ? bx : bx + CHIP.barW - fw, by, fw, CHIP.barH);
      ctx.restore();
    }

    // segment ticks, so the bar reads as rounds rather than a smooth meter
    ctx.fillStyle = 'rgba(6,8,14,0.8)';
    for (let gx = bx + CHIP.barSeg; gx < bx + CHIP.barW - 1; gx += CHIP.barSeg) {
      ctx.fillRect(Math.round(gx), by, 1, CHIP.barH);
    }

    // hairline rails
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = low ? PAL.danger : col;
    ctx.fillRect(bx, by - 1, CHIP.barW, 1);
    ctx.fillRect(bx, by + CHIP.barH, CHIP.barW, 1);
    ctx.globalAlpha = alpha;

    drawText(ctx, info.label, dir > 0 ? bx + CHIP.barW + 7 : bx - 7, y + CHIP.barDY, {
      size: CHIP.countSize, color: low ? PAL.danger : PAL.uiDim,
      align: dir > 0 ? 'left' : 'right'
    });

    ctx.restore();
  }

  /**
   * Draw remaining-life icons, growing right from x (dir +1) or left (-1).
   * The icons wear the ship's VARIANT palette (SPEC-VARIANTS.md §5), which in
   * co-op is the fastest way to tell whose lives you are looking at.
   */
  function drawLives(ctx, kind, lives, x, y, dir, alpha, vi) {
    const info = charInfo(kind);
    const name = variantSprite(info.life, vi);
    const s = sprite(name);
    const w = s ? s.w : 22;
    const h = s ? s.h : 17;
    const shown = Math.min(lives, HUD.maxLifeIcons);

    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < shown; i++) {
      const ox = dir > 0
        ? x + i * (w + HUD.lifeGap)
        : x - (i + 1) * w - i * HUD.lifeGap;
      if (s) {
        ctx.drawImage(s.canvas, Math.round(ox), Math.round(y - h / 2), w, h);
      } else {
        const v = variantOf(info, vi);
        ctx.fillStyle = (v && v.color) || info.color;
        ctx.fillRect(Math.round(ox), Math.round(y - h / 2), w, h);
      }
    }
    ctx.restore();

    if (lives > HUD.maxLifeIcons) {
      const tx = dir > 0
        ? x + shown * (w + HUD.lifeGap) + 2
        : x - shown * (w + HUD.lifeGap) - 2;
      drawText(ctx, 'x' + lives, tx, y, {
        size: 12, color: PAL.uiDim, align: dir > 0 ? 'left' : 'right', alpha: alpha
      });
    }
  }

  /** One player's HUD block. */
  function hudPlayer(ctx, sh, slot, side, active, t) {
    const out = shipIsOut(sh);
    const alpha = out ? 0.34 : 1;
    const col = slotColor(slot);
    const align = side > 0 ? 'left' : 'right';
    const x = side > 0 ? HUD.edge : C.W - HUD.edge;

    let label = 'P' + (slot + 1);
    if (out) label += ' OUT';

    // blinking marker on the player whose turn it is (classic mode)
    if (active && !out && (t % 0.8) < 0.45) {
      const mx = side > 0 ? x - 12 : x + 12;
      chevron(ctx, mx, HUD.labelY, 6, side > 0 ? 1 : -1, col, 1);
    }

    drawText(ctx, label, x, HUD.labelY, {
      size: 14, color: col, align: align, alpha: alpha, shadow: true
    });
    drawText(ctx, pad(sh && sh.score, 5), x, HUD.scoreY, {
      size: 24, color: PAL.ui, align: align, alpha: alpha,
      glow: out ? 0 : 8, glowColor: col
    });

    const lives = sh && typeof sh.lives === 'number' ? Math.max(0, sh.lives) : 0;
    drawLives(ctx, sh && sh.kind, lives, x, HUD.livesY, side, alpha,
              shipVariant(sh));
  }

  function renderHUD(ctx, board, g) {
    const t = U.now();
    // Nothing on this screen is tappable, and the frame's region list is
    // cleared anyway: a stale select-screen rectangle left lying under the
    // play field would be a tap routed to a panel that is not there
    // (SPEC-TOUCHUI §2).
    beginRegions();
    const b = currentBoard(g, board);
    const ships = collectShips(g);
    ctx.save();

    // backing strip so the HUD stays legible over the starfield
    ctx.fillStyle = 'rgba(4,6,12,0.62)';
    ctx.fillRect(0, 0, C.W, C.PLAY_TOP);
    ctx.fillStyle = PAL.chromeDk;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(0, C.PLAY_TOP - 2, C.W, 1);
    ctx.globalAlpha = 1;

    // Whose turn it is — only meaningful in classic mode, where the two
    // players take alternating turns on separate boards.
    let activeSlot = -1;
    const isClassic = !!(g && g.session && g.session.mode === 'classic');
    if (isClassic && b && Array.isArray(b.ships) && b.ships.length === 1 && b.ships[0]) {
      activeSlot = typeof b.ships[0].slot === 'number' ? b.ships[0].slot : -1;
    }

    let p1 = null;
    let p2 = null;
    for (let i = 0; i < ships.length; i++) {
      const sh = ships[i];
      const slot = typeof sh.slot === 'number' ? sh.slot : i;
      if (slot === 1) p2 = sh;
      else if (slot === 0) p1 = sh;
    }

    if (p1) hudPlayer(ctx, p1, 0, 1, activeSlot === 0, t);
    if (p2) hudPlayer(ctx, p2, 1, -1, activeSlot === 1, t);

    // centre column: HI-SCORE over WAVE n
    const cx = C.W / 2;
    let hi = highScore(g);
    for (let i = 0; i < ships.length; i++) {
      const sc = ships[i] && ships[i].score;
      if (typeof sc === 'number' && sc > hi) hi = sc;
    }

    drawText(ctx, 'HI-SCORE', cx, 18, {
      size: 12, color: PAL.uiDim, align: 'center'
    });
    drawText(ctx, pad(hi, 5), cx, 44, {
      size: 22, color: PAL.butter, align: 'center', glow: 10, glowColor: PAL.coil
    });

    const wave = (b && typeof b.wave === 'number') ? b.wave : 1;
    drawText(ctx, 'WAVE ' + wave, cx, 74, {
      size: 13, color: PAL.ui, align: 'center', alpha: 0.8
    });

    ctx.restore();
  }

  /* =========================================================================
   * 6b. WEAPON FURNITURE ON THE PLAY FIELD
   *
   * The pickup banner and the falling token's name tag. Both are drawn by
   * game.js during 'play', over the field and under the CRT overlay.
   * ====================================================================== */

  const PICKUP = {
    time: 1.4,            // SPEC-WEAPONS §8; game.js may state its own on the
                          //   banner object, and that wins
    cy: 452,              // clear below the formation's starting rows and
                          //   clear above the bunkers: a centred banner that
                          //   does not sit on the toasters you are shooting
    bandH: 132,
    open: 0.12,           // seconds the letterbox band takes to open
    popIn: 0.28,          // seconds of the scale-in overshoot
    fadeOut: 0.24,
    nameSize: 44,
    tagSize: 16,
    whoSize: 14,
    // INTEGER, deliberately. The icons are 16x16 pixel maps blitted with
    // imageSmoothingEnabled = false, so a fractional magnification gives
    // unevenly sized pixels — at 2.5 every other source pixel came out 3px
    // wide and the rest 2px, which is exactly the artefact this whole
    // pixel-map pipeline exists to avoid. 3 keeps them square (48x48) and
    // still leaves the widest banner (THE FULL BREAKFAST, 645px of text plus
    // two icons = 745px, 820px at the fade-out swell) inside the 960px screen.
    iconScale: 3,
    iconGap: 26,
    rays: 10,
    rayTime: 0.42
  };

  /**
   * Normalise whatever game.js parked on the board into
   *   { def, slot, elapsed, dur }
   * or null when there is no banner to draw.
   *
   * The banner object may state its remaining time (`timer` / `ttl` / …) or
   * its elapsed time (`t` / `elapsed` / `age`); either is enough to drive the
   * animation, and a missing total falls back to PICKUP.time.
   */
  function pickupState(board) {
    if (!board) return null;
    const p = probe(board, ['pickup', 'pickupBanner', 'weaponBanner', 'banner'], null);
    if (!p || typeof p !== 'object') return null;
    if (p.active === false || p.alive === false) return null;

    // the def itself, a ship-weapon state carrying one, or just an id
    let def = probe(p, ['def', 'weapon'], null);
    if (def && typeof def === 'object' && def.def) def = def.def;
    if (!def || typeof def !== 'object' || !def.name) {
      def = defForId(probe(p, ['wid', 'id', 'weaponId'], null));
    }
    if (!def || !def.name) return null;

    let dur = probe(p, ['life', 'duration', 'total', 'max'], null);
    if (typeof dur !== 'number' || !isFinite(dur) || dur <= 0) dur = PICKUP.time;

    let elapsed;
    const remain = probe(p, ['timer', 'ttl', 'remain', 'remaining', 'left'], null);
    if (typeof remain === 'number' && isFinite(remain)) {
      if (remain <= 0) return null;
      elapsed = dur - remain;
    } else {
      const t = probe(p, ['t', 'elapsed', 'age'], null);
      elapsed = (typeof t === 'number' && isFinite(t)) ? t : 0;
    }
    if (elapsed >= dur) return null;
    if (elapsed < 0) elapsed = 0;

    // who grabbed it: a slot number, or a ship to read one off
    let slot = probe(p, ['slot', 'player', 'playerSlot', 'who'], null);
    if (typeof slot !== 'number') {
      const sh = probe(p, ['ship'], null);
      slot = (sh && typeof sh.slot === 'number') ? sh.slot : null;
    }
    if (typeof slot !== 'number' || slot < 0 || slot > 1) slot = null;

    return { def: def, slot: slot, elapsed: elapsed, dur: dur };
  }

  /** Back-eased 0..1 with a ~10% overshoot — the pop in "scale-in pop". */
  function easeOutBack(p) {
    const q = p - 1;
    return 1 + 3.2 * q * q * q + 2.2 * q * q;
  }

  /**
   * The 1.4s pickup banner (SPEC-WEAPONS.md §8). Big weapon NAME flanked by
   * its icon, its tagline underneath, all in the weapon's colour, over a
   * letterbox band that snaps open — plus a ring of rays on the pop, because
   * this is the payoff moment for the whole upgrade loop.
   */
  function renderPickupBanner(ctx, board) {
    const st = pickupState(board);
    if (!st) return;

    const def = st.def;
    const col = def.color || PAL.butter;
    const e = st.elapsed;
    const left = st.dur - e;

    // scale: overshoot in, then a last-moment swell as it fades
    let scale = 0.40 + 0.60 * easeOutBack(U.clamp(e / PICKUP.popIn, 0, 1));
    let alpha = 1;
    if (left < PICKUP.fadeOut) {
      const k = U.clamp(left / PICKUP.fadeOut, 0, 1);
      alpha = k;
      scale *= 1 + 0.10 * (1 - k);
    }

    const cy = PICKUP.cy;
    const bandH = Math.max(2, Math.round(PICKUP.bandH *
                           U.clamp(e / PICKUP.open, 0, 1)));
    const bandY = Math.round(cy - bandH / 2);

    ctx.save();
    ctx.globalAlpha = alpha;

    // letterbox band: dark enough to read against, translucent enough that the
    // formation stays visible behind it
    ctx.fillStyle = 'rgba(6,8,14,0.74)';
    ctx.fillRect(0, bandY, C.W, bandH);
    ctx.fillStyle = col;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillRect(0, bandY, C.W, 2);
    ctx.fillRect(0, bandY + bandH - 2, C.W, 2);
    ctx.globalAlpha = alpha;

    // rays, clipped to the band so they read as light spilling along it
    if (e < PICKUP.rayTime) {
      const k = e / PICKUP.rayTime;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bandY, C.W, bandH);
      ctx.clip();
      ctx.globalAlpha = alpha * (1 - k) * 0.65;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      const r0 = 46 + 300 * k;
      ctx.beginPath();
      for (let i = 0; i < PICKUP.rays; i++) {
        const ang = (i / PICKUP.rays) * Math.PI * 2 + k * 0.5;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        ctx.moveTo(C.W / 2 + cs * r0, cy + sn * r0);
        ctx.lineTo(C.W / 2 + cs * (r0 + 30), cy + sn * (r0 + 30));
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(C.W / 2, cy);
    ctx.scale(scale, scale);

    if (st.slot !== null) {
      drawText(ctx, 'PLAYER ' + (st.slot + 1) + ' GRABBED', 0, -56, {
        size: PICKUP.whoSize, color: slotColor(st.slot), align: 'center',
        bold: true, glow: 10
      });
    }

    drawText(ctx, def.name, 0, -12, {
      size: PICKUP.nameSize, color: col, align: 'center', bold: true,
      glow: 26, glowColor: col, shadow: true
    });

    // the icon flanks the name on both sides — symmetric, and it teaches the
    // player which roundel to chase next time it falls
    const half = textWidth(ctx, def.name, { size: PICKUP.nameSize, bold: true }) / 2;
    drawWeaponIcon(ctx, def, -half - PICKUP.iconGap, -12, PICKUP.iconScale, 1);
    drawWeaponIcon(ctx, def, half + PICKUP.iconGap, -12, PICKUP.iconScale, 1);

    if (def.tagline) {
      // drawText's `alpha` REPLACES the context's, so the banner's own fade has
      // to be folded in here or the tagline would hang at 0.85 while everything
      // around it faded out.
      drawText(ctx, def.tagline, 0, 26, {
        size: PICKUP.tagSize, color: col, align: 'center', alpha: alpha * 0.85,
        shadow: true
      });
    }

    ctx.restore();
    ctx.restore();
  }

  /* --- the falling token's name tag ------------------------------------- */

  const TOKEN_TAG = {
    size: 10,
    dy: 13,               // px from the token's bottom edge to the tag centre
    padX: 7,
    padY: 4,
    notch: 4,
    fadeIn: 0.25,
    edge: 6               // px the tag is kept clear of the screen sides by
  };

  /**
   * A small name tag under a falling token, so a player can read what it is
   * and decide whether it is worth leaving cover for (SPEC-WEAPONS.md §1).
   */
  function renderTokenLabel(ctx, token) {
    if (!token || token.alive === false) return;
    const def = (token.def && token.def.name) ? token.def : defForId(token.wid);
    const name = token.name || (def && def.name);
    if (!name) return;
    const col = token.color || (def && def.color) || PAL.ui;

    const t = (typeof token.t === 'number' && isFinite(token.t)) ? token.t : TOKEN_TAG.fadeIn;
    const a = U.clamp(t / TOKEN_TAG.fadeIn, 0, 1) * pulse(U.now(), 5.0, 0.82, 1);

    const w = textWidth(ctx, name, { size: TOKEN_TAG.size });
    const boxW = Math.round(w + TOKEN_TAG.padX * 2);
    const boxH = TOKEN_TAG.size + TOKEN_TAG.padY * 2;
    const tokenCx = token.x + token.w / 2;
    const cx = U.clamp(tokenCx, TOKEN_TAG.edge + boxW / 2, C.W - TOKEN_TAG.edge - boxW / 2);

    // Normally the tag hangs under the token; once the token is low enough
    // that the tag would fall off the floor line it flips above instead, so
    // the last, most urgent seconds of a token's life are still readable.
    const below = (token.y + token.h + TOKEN_TAG.dy + boxH / 2) <= C.PLAY_BOTTOM;
    const cy = below ? token.y + token.h + TOKEN_TAG.dy : token.y - TOKEN_TAG.dy;
    const bx = Math.round(cx - boxW / 2);
    const by = Math.round(cy - boxH / 2);

    ctx.save();
    ctx.globalAlpha = a;

    // notch pointing back at the roundel it belongs to
    ctx.fillStyle = 'rgba(6,8,14,0.82)';
    ctx.fillRect(Math.round(tokenCx - TOKEN_TAG.notch),
                 below ? by - TOKEN_TAG.notch : by + boxH - 1,
                 TOKEN_TAG.notch * 2, TOKEN_TAG.notch + 1);
    ctx.fillRect(bx, by, boxW, boxH);

    // weapon-coloured rule on the edge the notch is NOT on
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = col;
    ctx.fillRect(bx, below ? by + boxH - 1 : by, boxW, 1);
    ctx.globalAlpha = a;

    drawText(ctx, name, cx, cy, {
      size: TOKEN_TAG.size, color: col, align: 'center', shadow: true
    });

    ctx.restore();
  }

  /* =========================================================================
   * 6c. THE SECRET UNLOCK BANNER  (SPEC-BURRITO.md §2)
   *
   * The payoff. A player reaches wave 5 and a tenth character they had no
   * reason to believe existed walks onto the select screen. That moment gets a
   * banner: his sprite, SECRET UNLOCKED, his name, and the one line that tells
   * them what to do about it.
   *
   * TWO CONSTRAINTS PULL AGAINST EACH OTHER HERE, and both win.
   *
   *   IT MUST FEEL LIKE A REWARD. Bigger than the pickup banner, with rays on
   *   the pop and a foil glint sweeping the band, because a secret announced
   *   in the same voice as a syrup trap is not a secret worth keeping.
   *
   *   IT MUST NOT COST YOU THE WAVE. It is drawn OVER LIVE PLAY — nothing
   *   pauses, the formation keeps marching, the bombs keep falling — so it
   *   sits in the same clear band the pickup banner uses: below the
   *   formation's starting rows, above the bunkers at 548, nowhere near the
   *   ship at 636. The backing is translucent, exactly like the pickup band,
   *   so a formation that has descended into it is still visible THROUGH it,
   *   and it is gone in 2.5 seconds.
   *
   * game.js owns the moment, its clock and its WORDS; this file only draws
   * them. It parks `T.Game.reveal`, in the same shape as the wave banner and
   * the pickup banner this file already reads:
   *
   *   { id, name, title, sub, color, sprite, t, duration, remaining, started }
   *
   * and the read is as tolerant as those two: `t` / `elapsed` / `age` for time
   * spent, `remaining` / `timer` / `ttl` / `left` for time left, `life` /
   * `duration` / `total` for the whole, and the object equally welcome on the
   * game, on the session or on the board. `title` and `sub` are printed
   * VERBATIM when they are there, exactly as the wave banner's are, because
   * the file that decides a moment has happened is the file that gets to name
   * it; the fallbacks below are what a build that states neither still says.
   * `started` is game.js holding the banner back until the frame it will
   * actually be seen on, so a false there draws nothing.
   *
   * Draw nothing at all when there is no such state, which is every frame of
   * every game but about two and a half seconds of one of them.
   * ====================================================================== */

  const REVEAL = {
    /* §2 asks for ~2.5s. The state game.js parks states its own duration and
     * that always wins; this is what the animation runs on when it does not,
     * and what T.UI.UNLOCK_TIME reports. It reads T.C.BURRITO_REVEAL_TIME —
     * the SAME dial game.js falls back through — rather than restating 2.5, so
     * a retune moves the clock and the animation together instead of leaving
     * this file animating a 2.5s banner over a 4s one. */
    time: (typeof C.BURRITO_REVEAL_TIME === 'number' &&
           isFinite(C.BURRITO_REVEAL_TIME) && C.BURRITO_REVEAL_TIME > 0)
            ? C.BURRITO_REVEAL_TIME : 2.5,
    cy: 452,              // the pickup banner's band — the one clear stripe
    bandH: 140,           // 382 -> 522: clear of the bunkers and of the ship
    open: 0.14,           // seconds the letterbox band takes to open
    popIn: 0.30,          // seconds of the scale-in overshoot
    fadeOut: 0.36,
    headSize: 15,
    nameSize: 40,
    lineSize: 13,
    headDY: -40,
    nameDY: -2,
    lineDY: 34,
    // INTEGER, for the reason PICKUP.iconScale is: the ship maps are pixel
    // art blitted with smoothing off, and a fractional magnification hands
    // some source pixels two screen pixels and the rest one.
    spriteScale: 2,       // the 44x34 character at 88x68
    spriteGap: 26,
    spriteDY: -2,
    rays: 12,
    rayTime: 0.50,
    shineTime: 0.95,      // the foil glint's sweep across the band
    shineW: 120,
    shineLean: 0.34       // radians it leans, so it reads as a reflection
  };

  /* Where game.js might have parked it, in the order they are asked for.
   * `reveal` is the one the shipped game.js uses. */
  const UNLOCK_FIELDS = ['reveal', 'revealBanner', 'unlock', 'unlockBanner',
                         'secret', 'secretUnlock'];

  /**
   * Normalise the reveal state into { head, name, line, sprite, color,
   * elapsed, dur }, or null when there is no banner to draw.
   *
   * Only an OBJECT WITH A CLOCK counts. A bare `true` would say a reveal
   * happened without saying when, and a banner with no clock is a banner that
   * never leaves — an object stating neither a time spent nor a time left is
   * exactly the same thing wearing braces, so it is refused on the same rule.
   * That matters more here than it would for any other banner in this file:
   * the thing left on the screen forever would be the secret's name, over live
   * play, on the machine of a player who may not have earned it. The duration
   * is allowed to be missing (REVEAL.time stands in for it); the position on
   * the clock is not.
   */
  function unlockState(g) {
    let p = probe(g, UNLOCK_FIELDS, null);
    if (!p) p = probe(g && g.session, UNLOCK_FIELDS, null);
    if (!p) p = probe(currentBoard(g, null), UNLOCK_FIELDS, null);
    if (!p || typeof p !== 'object') return null;
    if (p.active === false || p.alive === false) return null;
    // game.js holds the banner back until the frame it will be seen on.
    if (p.started === false) return null;

    let id = probe(p, ['id', 'kind', 'char', 'character', 'who'], null);
    if (typeof id !== 'string' || id === '') id = SECRET_IDS[0] || '';
    const entry = CHARS[id];
    if (!entry) return null;                // an id this roster never heard of

    let dur = probe(p, ['life', 'duration', 'total', 'max'], null);
    if (typeof dur !== 'number' || !isFinite(dur) || dur <= 0) dur = REVEAL.time;

    let elapsed;
    const remain = probe(p, ['timer', 'ttl', 'remain', 'remaining', 'left'], null);
    if (typeof remain === 'number' && isFinite(remain)) {
      if (remain <= 0) return null;
      elapsed = dur - remain;
    } else {
      const t = probe(p, ['t', 'elapsed', 'age'], null);
      // No usable clock in either direction: this is the bare `true` case
      // again, and drawing it would pin the reveal at elapsed 0 for the rest
      // of the session. Nothing, and the frame carries on.
      if (typeof t !== 'number' || !isFinite(t)) return null;
      elapsed = t;
    }
    if (elapsed >= dur) return null;
    if (elapsed < 0) elapsed = 0;

    // The words are game.js's when it states them, this file's when it does
    // not — and the character's own row is the last word on his art, his
    // colour and his name, so a banner that states none of the three still
    // introduces the right breakfast.
    let head = probe(p, ['title', 'text', 'head'], null);
    if (typeof head !== 'string' || head === '') head = 'SECRET UNLOCKED';
    let name = probe(p, ['name'], null);
    if (typeof name !== 'string' || name === '') name = entry.name || entry.key;
    let line = probe(p, ['sub', 'subtitle', 'line'], null);
    if (typeof line !== 'string' || line === '') {
      line = name + ' IS NOW ON THE SELECT SCREEN';
    }
    let art = probe(p, ['sprite', 'ship'], null);
    if (typeof art !== 'string' || art === '') art = entry.sprite;
    const color = probe(p, ['color'], null) || entry.color || PAL.butter;

    return { head: head, name: name, line: line, sprite: art,
             color: color, elapsed: elapsed, dur: dur };
  }

  /** The foil glint: one leaning highlight sweeping the band, once. */
  function revealShine(ctx, k, bandY, bandH, alpha) {
    const x = -REVEAL.shineW + k * (C.W + REVEAL.shineW * 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bandY, C.W, bandH);
    ctx.clip();
    ctx.globalAlpha = alpha * 0.16 * Math.sin(Math.PI * U.clamp(k, 0, 1));
    ctx.fillStyle = PAL.chromeLt;
    ctx.translate(x, bandY + bandH / 2);
    ctx.rotate(REVEAL.shineLean);
    ctx.fillRect(-REVEAL.shineW / 2, -bandH, REVEAL.shineW, bandH * 2);
    ctx.restore();
  }

  /**
   * The ~2.5s secret reveal, over live play (SPEC-BURRITO.md §2).
   *
   * Draws nothing unless game.js says a secret has just been unlocked, so on
   * every other frame of every other game this costs one probe and a return.
   */
  function renderSecretBanner(ctx, g) {
    const st = unlockState(g);
    if (!st) return;

    const col = st.color;
    const e = st.elapsed;
    const left = st.dur - e;

    // Same motion vocabulary as the pickup banner: overshoot in, swell out.
    let scale = 0.40 + 0.60 * easeOutBack(U.clamp(e / REVEAL.popIn, 0, 1));
    let alpha = 1;
    if (left < REVEAL.fadeOut) {
      const k = U.clamp(left / REVEAL.fadeOut, 0, 1);
      alpha = k;
      scale *= 1 + 0.10 * (1 - k);
    }

    const cy = REVEAL.cy;
    const bandH = Math.max(2, Math.round(REVEAL.bandH *
                           U.clamp(e / REVEAL.open, 0, 1)));
    const bandY = Math.round(cy - bandH / 2);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Translucent letterbox, so a formation that has marched this low is still
    // readable through the thing congratulating you.
    ctx.fillStyle = 'rgba(6,8,14,0.74)';
    ctx.fillRect(0, bandY, C.W, bandH);
    ctx.fillStyle = col;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillRect(0, bandY, C.W, 2);
    ctx.fillRect(0, bandY + bandH - 2, C.W, 2);
    ctx.globalAlpha = alpha;

    if (e < REVEAL.rayTime) {
      const k = e / REVEAL.rayTime;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bandY, C.W, bandH);
      ctx.clip();
      ctx.globalAlpha = alpha * (1 - k) * 0.6;
      ctx.strokeStyle = PAL.butter;
      ctx.lineWidth = 3;
      const r0 = 52 + 320 * k;
      ctx.beginPath();
      for (let i = 0; i < REVEAL.rays; i++) {
        const ang = (i / REVEAL.rays) * Math.PI * 2 - k * 0.6;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        ctx.moveTo(C.W / 2 + cs * r0, cy + sn * r0);
        ctx.lineTo(C.W / 2 + cs * (r0 + 34), cy + sn * (r0 + 34));
      }
      ctx.stroke();
      ctx.restore();
    }

    if (e < REVEAL.shineTime) revealShine(ctx, e / REVEAL.shineTime,
                                          bandY, bandH, alpha);

    ctx.save();
    ctx.translate(C.W / 2, cy);
    ctx.scale(scale, scale);

    // Sprite on the left, the three lines on the right, the pair centred as
    // one block so the widest line decides where the character stands.
    const head = st.head;
    const line = st.line;
    const name = st.name;
    const headW = textWidth(ctx, head, { size: REVEAL.headSize });
    const nameW = textWidth(ctx, name, { size: REVEAL.nameSize, bold: true });
    const lineW = textWidth(ctx, line, { size: REVEAL.lineSize });
    const textW = Math.max(headW, Math.max(nameW, lineW));
    const spriteW = C.SHIP_W * REVEAL.spriteScale;
    const x0 = -(spriteW + REVEAL.spriteGap + textW) / 2;
    const textX = x0 + spriteW + REVEAL.spriteGap;

    // Variant 0, deliberately: this is the character being introduced, in the
    // palette his roster row ships with, not in whatever the player last flew.
    const spriteName = variantSprite(st.sprite, 0);
    if (!spriteName || !blitCentered(ctx, spriteName, x0 + spriteW / 2,
                                     REVEAL.spriteDY, REVEAL.spriteScale)) {
      previewFallback(ctx, x0 + spriteW / 2, REVEAL.spriteDY,
                      spriteW, C.SHIP_H * REVEAL.spriteScale, col);
    }

    drawText(ctx, head, textX, REVEAL.headDY, {
      size: REVEAL.headSize, color: PAL.butter, align: 'left', bold: true,
      glow: 16, glowColor: PAL.coil, shadow: true
    });
    drawText(ctx, name, textX, REVEAL.nameDY, {
      size: REVEAL.nameSize, color: legible(col), align: 'left', bold: true,
      glow: 26, glowColor: legible(col), shadow: true
    });
    // drawText's `alpha` REPLACES the context's, so the banner's own fade has
    // to be folded in or this line would hang at 0.9 while the rest faded.
    drawText(ctx, line, textX, REVEAL.lineDY, {
      size: REVEAL.lineSize, color: PAL.ui, align: 'left',
      alpha: alpha * 0.9, shadow: true
    });

    ctx.restore();
    ctx.restore();
  }

  /* =========================================================================
   * 8. WAVE BANNER
   * ====================================================================== */

  function renderWaveBanner(ctx, g) {
    const t = U.now();
    // Nothing on this screen is tappable, and the frame's region list is
    // cleared anyway: a stale select-screen rectangle left lying under the
    // play field would be a tap routed to a panel that is not there
    // (SPEC-TOUCHUI §2).
    beginRegions();
    const b = currentBoard(g, null);
    const wave = (b && typeof b.wave === 'number') ? b.wave : 1;

    // game.js drives the banner: "WAVE n" normally, "PLAYER n" for the
    // classic-mode turn swap. Whatever it says, we print it verbatim.
    const banner = (g && g.banner) ? g.banner : null;
    let head = probe(g, ['bannerText'], null);
    if (!head && banner) head = probe(banner, ['text', 'head', 'title'], null);
    if (!head) head = 'WAVE ' + wave;
    head = String(head);

    let sub = probe(g, ['bannerSub'], null);
    if (!sub && banner) sub = probe(banner, ['sub', 'subtitle'], null);
    // Only a wave card gets the flavour line — a "PLAYER n" swap card that
    // deliberately carries no subtitle must stay clean.
    if (!sub) {
      sub = (head.toUpperCase().indexOf('WAVE') === 0)
        ? (wave > 1 ? 'THEY ARE GETTING HUNGRIER' : 'TOASTERS INBOUND')
        : '';
    }

    ctx.save();
    dim(ctx, 0.42);

    const cy = C.H / 2;
    const breathe = 1 + Math.sin(t * 4.0) * 0.02;

    ctx.save();
    ctx.translate(C.W / 2, cy);
    ctx.scale(breathe, breathe);
    drawText(ctx, head, 0, 0, {
      size: 66, color: PAL.crumb, align: 'center', bold: true,
      glow: 26, glowColor: PAL.coil
    });
    ctx.restore();

    drawText(ctx, sub, C.W / 2, cy + 58, {
      size: 16, color: PAL.uiDim, align: 'center'
    });

    // a little flapping garnish above the banner
    drawMarchRow(ctx, t, cy - 108);

    ctx.restore();
  }

  /* =========================================================================
   * 9. PAUSE
   * ====================================================================== */

  /* Layout landmarks for the pause box, all offsets from its top edge.
   *
   * The two TOUCH numbers are the only thing SPEC-TOUCH §4 costs this screen:
   * the box grows to hold the control-mode block, and the YES / NO pair moves
   * apart because FIRE and BACK are wider words than A and B. Neither is read
   * unless there is touch, so on every other machine this box is the 480x200
   * it has always been, down to the pixel. */
  const PAUSE = {
    boxW: 480,
    boxH: 200,
    boxHTouch: 252,       // + the CONTROL row and its hint
    boxHConfirm: 220,
    titleY: 62,
    resumeY: 126,
    quitY: 160,
    modeY: 200,
    modeHintY: 226,
    modeGap: 9,           // between the dim CONTROL label and the mode word
    confirmTitleY: 60,
    confirmBlurbY: 100,
    confirmRowY: 152,
    confirmX: 92,
    confirmXTouch: 104
  };

  /**
   * BUTTONS / DRAG and the target that flips it (SPEC-TOUCH §4).
   *
   * Laid out like the select screen's WEAPON line — a dim label and a bright
   * value, measured as one block so the pair stays centred whichever of the
   * two words is live. The hint names the OTHER mode because that is exactly
   * what touch.js writes on the toggle: a button labelled with the mode it
   * will give you, the way every cabinet toggle in this game reads.
   */
  function controlModeBlock(ctx, cx, y, hintY) {
    const mode = touchMode();
    const word = modeWord(mode);
    const labelW = textWidth(ctx, 'CONTROL', { size: 10 });
    const wordW = textWidth(ctx, word, { size: 18, bold: true });
    const x0 = cx - (labelW + PAUSE.modeGap + wordW) / 2;

    drawText(ctx, 'CONTROL', x0, y, {
      size: 10, color: PAL.uiDim, align: 'left'
    });
    drawText(ctx, word, x0 + labelW + PAUSE.modeGap, y, {
      size: 18, color: PAL.butter, align: 'left', bold: true, glow: 12
    });
    drawText(ctx, 'TAP ' + otherModeWord(mode) + ' TO SWITCH', cx, hintY, {
      size: 11, color: PAL.uiDim, align: 'center'
    });
  }

  function renderPause(ctx, g) {
    const t = U.now();
    // Nothing on this screen is tappable, and the frame's region list is
    // cleared anyway: a stale select-screen rectangle left lying under the
    // play field would be a tap routed to a panel that is not there
    // (SPEC-TOUCHUI §2).
    beginRegions();
    const confirming = quitConfirmActive(g);
    const glass = touchOn();
    ctx.save();
    dim(ctx, 0.64);

    const boxW = PAUSE.boxW;
    const boxH = confirming ? PAUSE.boxHConfirm
                            : (glass ? PAUSE.boxHTouch : PAUSE.boxH);
    const boxX = Math.round((C.W - boxW) / 2);
    const boxY = Math.round(C.H / 2 - boxH / 2);
    panel(ctx, boxX, boxY, boxW, boxH, PAL.chrome, 0.9);

    if (confirming) {
      const dx = glass ? PAUSE.confirmXTouch : PAUSE.confirmX;
      drawText(ctx, 'QUIT TO TITLE?', C.W / 2, boxY + PAUSE.confirmTitleY, {
        size: 34, color: PAL.danger, align: 'center', bold: true,
        glow: 20, glowColor: PAL.danger
      });
      drawText(ctx, 'YOUR TOAST WILL GO COLD', C.W / 2, boxY + PAUSE.confirmBlurbY, {
        size: 12, color: PAL.uiDim, align: 'center'
      });
      drawText(ctx, buttonName('A') + ' = YES', C.W / 2 - dx,
        boxY + PAUSE.confirmRowY, {
          size: 22, color: PAL.danger, align: 'center', bold: true,
          alpha: pulse(t, 5, 0.7, 1)
        });
      drawText(ctx, buttonName('B') + ' = NO', C.W / 2 + dx,
        boxY + PAUSE.confirmRowY, {
          size: 22, color: PAL.ui, align: 'center', bold: true
        });
    } else {
      drawText(ctx, 'PAUSED', C.W / 2, boxY + PAUSE.titleY, {
        size: 52, color: PAL.crumb, align: 'center', bold: true,
        glow: 22, glowColor: PAL.butter
      });
      drawText(ctx, buttonName('START') + ' = RESUME', C.W / 2,
        boxY + PAUSE.resumeY, {
          size: 18, color: PAL.ui, align: 'center',
          alpha: pulse(t, 3.2, 0.7, 1)
        });
      drawText(ctx, buttonName('B') + ' = QUIT TO TITLE', C.W / 2,
        boxY + PAUSE.quitY, {
          size: 15, color: PAL.uiDim, align: 'center'
        });
      // §4 wants the control mode reachable from here, so it has to be
      // READABLE from here: which one you are in, and what to press for the
      // other. Touch only — there is no mode to switch without it.
      if (glass) {
        controlModeBlock(ctx, C.W / 2, boxY + PAUSE.modeY,
                         boxY + PAUSE.modeHintY);
      }
    }

    ctx.restore();
  }

  /* =========================================================================
   * 10. GAME OVER
   * ====================================================================== */

  function renderOver(ctx, g) {
    const t = U.now();
    // Nothing on this screen is tappable, and the frame's region list is
    // cleared anyway: a stale select-screen rectangle left lying under the
    // play field would be a tap routed to a panel that is not there
    // (SPEC-TOUCHUI §2).
    beginRegions();
    const ships = collectShips(g);
    const hi = highScore(g);

    let best = 0;
    for (let i = 0; i < ships.length; i++) {
      const sc = (ships[i] && typeof ships[i].score === 'number') ? ships[i].score : 0;
      if (sc > best) best = sc;
    }

    let isNewHi = probe(g, ['newHighScore', 'newHiScore', 'isNewHi'], null);
    if (typeof isNewHi !== 'boolean') isNewHi = best > 0 && best >= hi;

    ctx.save();
    dim(ctx, 0.68);

    // the box grows to fit however many players actually played
    const rows = Math.max(1, Math.min(ships.length, 2));
    const twoPlayer = ships.length >= 2;
    const boxW = 580;
    const boxH = 234 + rows * 44 + (twoPlayer ? 46 : 0);
    const boxX = Math.round((C.W - boxW) / 2);
    const boxY = Math.round(C.H / 2 - boxH / 2) - 10;
    panel(ctx, boxX, boxY, boxW, boxH, PAL.danger, 0.85);

    drawText(ctx, 'GAME OVER', C.W / 2, boxY + 58, {
      size: 54, color: PAL.danger, align: 'center', bold: true,
      glow: 26, glowColor: PAL.danger
    });
    drawText(ctx, 'THE TOASTERS WON THIS ROUND', C.W / 2, boxY + 96, {
      size: 12, color: PAL.uiDim, align: 'center'
    });

    // final score lines
    const colL = boxX + 60;
    const colR = boxX + boxW - 60;
    let y = boxY + 146;
    for (let i = 0; i < ships.length && i < 2; i++) {
      const sh = ships[i];
      const slot = typeof sh.slot === 'number' ? sh.slot : i;
      const info = charInfo(sh.kind);
      const col = slotColor(slot);

      drawText(ctx, 'P' + (slot + 1), colL, y, {
        size: 20, color: col, align: 'left', bold: true
      });
      drawText(ctx, info.name, colL + 62, y, {
        size: 14, color: PAL.uiDim, align: 'left'
      });
      // Which of the three they flew, under the character's name: in co-op
      // the two ships are often the same character in different palettes, and
      // the score card should say which one was whose.
      const v = variantOf(info, shipVariant(sh));
      if (v) {
        drawText(ctx, v.name, colL + 62, y + 16, {
          size: 10, color: legible(v.color), align: 'left', alpha: 0.8
        });
      }
      drawText(ctx, pad(sh.score, 5), colR, y, {
        size: 26, color: PAL.ui, align: 'right', glow: 8, glowColor: col
      });
      y += 44;
    }

    // who won (2P only)
    if (ships.length >= 2) {
      const s0 = (typeof ships[0].score === 'number') ? ships[0].score : 0;
      const s1 = (typeof ships[1].score === 'number') ? ships[1].score : 0;
      let line;
      let col;
      if (s0 === s1) {
        line = 'DEAD HEAT — SHARE THE TOAST';
        col = PAL.ui;
      } else {
        const winner = s0 > s1 ? 0 : 1;
        line = 'PLAYER ' + (winner + 1) + ' WINS';
        col = slotColor(winner);
      }
      drawText(ctx, line, C.W / 2, y + 4, {
        size: 22, color: col, align: 'center', bold: true, glow: 14
      });
      y += 46;
    }

    // high score
    if (isNewHi) {
      if ((t % 0.7) < 0.42) {
        drawText(ctx, 'NEW HIGH SCORE!', C.W / 2, y + 6, {
          size: 26, color: PAL.butter, align: 'center', bold: true,
          glow: 22, glowColor: PAL.coil
        });
      }
    } else {
      drawText(ctx, 'HI-SCORE  ' + pad(hi, 5), C.W / 2, y + 6, {
        size: 16, color: PAL.uiDim, align: 'center'
      });
    }

    if ((t % 1.0) < 0.62) {
      // The way back to the title is START either way — on the glass it is a
      // target with START written on it, so the verb is the only thing that
      // changes.
      drawText(ctx, touchOn() ? 'TAP START' : 'PRESS START',
        C.W / 2, boxY + boxH - 34, {
          size: 24, color: PAL.crumb, align: 'center', bold: true,
          glow: 16, glowColor: PAL.butter
        });
    }

    ctx.restore();
  }

  /* =========================================================================
   * 11. CONTROLLER HINT
   * ====================================================================== */

  /**
   * The bottom line of the title and select screens: what this machine is
   * played with.
   *
   * On touch the keyboard cheat-sheet is exactly the wrong advice — there may
   * be no keyboard, and the keys it lists are not on the glass — so the line
   * says what IS there instead, and carries SPEC-TOUCH §4's other half: the
   * live control mode and the target that flips it, which is how a player
   * finds DRAG from the title screen without pausing a game first. Pads still
   * get counted, because iPadOS speaks the Gamepad API and a pad plugged into
   * an iPad is worth saying out loud.
   */
  function renderControllerHint(ctx, g) {
    const n = padCount();
    const glass = touchOn();
    let line;
    if (glass) {
      const pads = (n >= 2) ? 'TOUCH + 2 PADS'
                 : (n === 1) ? 'TOUCH + 1 PAD' : 'TOUCH CONTROLS';
      const mode = touchMode();
      line = pads + '  ·  ' + modeWord(mode) + ' MODE  ·  TAP ' +
             otherModeWord(mode) + ' TO SWITCH';
    } else if (n >= 2) line = '2 CONTROLLERS CONNECTED';
    else if (n === 1) line = '1 CONTROLLER CONNECTED · P2 CAN USE THE KEYBOARD';
    else line = 'NO PAD — P1: A D + SPACE   P2: ARROWS + /';

    ctx.save();
    drawText(ctx, line, C.W / 2, C.H - 26, {
      size: 12, color: (n > 0 || glass) ? PAL.ui : PAL.uiDim, align: 'center',
      alpha: 0.75, shadow: true
    });
    ctx.restore();
  }

  /* =========================================================================
   * 12. CRT OVERLAY
   *
   * Built ONCE into an offscreen canvas (2px dark lines every 4px plus a
   * radial vignette, both baked with their own alpha) and blitted each frame.
   * One drawImage per frame instead of 180 fillRects.
   * ====================================================================== */

  let crtCanvas = null;

  function buildCrt() {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = C.W;
    cv.height = C.H;
    const c = cv.getContext('2d');
    if (!c) return null;

    // horizontal scanlines: 2px dark, 2px clear
    c.fillStyle = 'rgba(0,0,0,0.15)';
    for (let y = 0; y < C.H; y += 4) c.fillRect(0, y, C.W, 2);

    // a whisper of phosphor tint between the lines
    c.fillStyle = 'rgba(22,19,32,0.10)';
    for (let y = 2; y < C.H; y += 4) c.fillRect(0, y, C.W, 2);

    // vignette: clear in the middle, dark toward the tube edges
    const g = c.createRadialGradient(
      C.W / 2, C.H / 2, C.H * 0.30,
      C.W / 2, C.H / 2, C.H * 0.92
    );
    g.addColorStop(0.0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.16)');
    g.addColorStop(1.0, 'rgba(0,0,0,0.46)');
    c.fillStyle = g;
    c.fillRect(0, 0, C.W, C.H);

    return cv;
  }

  function renderScanlines(ctx) {
    if (!crtCanvas) crtCanvas = buildCrt();
    if (!crtCanvas) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(crtCanvas, 0, 0);
    ctx.restore();
  }

  /* =========================================================================
   * EXPORT
   * ====================================================================== */

  T.UI = {
    drawText: drawText,
    textWidth: textWidth,
    renderTitle: renderTitle,
    renderSelect: renderSelect,
    renderHUD: renderHUD,
    renderWeaponChip: renderWeaponChip,
    renderPickupBanner: renderPickupBanner,
    renderTokenLabel: renderTokenLabel,
    PICKUP_TIME: PICKUP.time,

    /* --- the secret tenth character (SPEC-BURRITO.md §2 and §5) ----------
     * renderSecretBanner draws the reveal game.js signals on T.Game.reveal;
     * UNLOCK_TIME is how long this file will animate one for when the state
     * states no duration of its own, so the clock and the animation agree
     * without being written down twice (PICKUP_TIME is the same arrangement
     * for the pickup banner).
     *
     * characterList / characterCount are the roster AS THE PLAYER SEES IT —
     * nine ids while burrito is locked, ten once he is not. This is the same
     * list T.Game.visibleCharacters() walks, derived the same way from the
     * same T.Util.isUnlocked, and it is here because ui.js has to be able to
     * answer the question without a Game: the select screen is drawn from a
     * payload, and the strip, the ghosts and the "n OF n" it prints must be
     * the carousel's own list or a player ends up on a character this panel
     * is not allowed to show.
     */
    renderSecretBanner: renderSecretBanner,
    UNLOCK_TIME: REVEAL.time,
    characterList: characterList,
    characterCount: characterCount,

    /* --- tappable canvas UI (SPEC-TOUCHUI.md §2, §4 and §5) --------------
     * The rectangles this file drew, in logical 960x720 coordinates, for the
     * frame currently on screen. touch.js converts a tap into those
     * coordinates, hit-tests the list (last match wins) and hands the winning
     * region to T.Game.uiTap — which is the only place a region is acted on.
     * Regions are DATA: read one, do not keep it (they are pooled and the next
     * frame writes over them), and never expect one to do anything by itself.
     *
     * flashRegion lights the tapped-flash on a published id. game.js's own
     * Game.tapAck already drives it, so nothing has to call this — it is here
     * for a caller with its own idea of what was tapped, and for a harness
     * that wants to see the acknowledgement without a touchscreen.
     */
    beginRegions: beginRegions,
    addRegion: addRegion,
    regions: regions,
    flashRegion: flashRegion,
    TAP_FLASH_TIME: TAP_FLASH_TIME,

    renderWaveBanner: renderWaveBanner,
    renderPause: renderPause,
    renderOver: renderOver,
    renderScanlines: renderScanlines,
    renderControllerHint: renderControllerHint,

    /* --- variants (SPEC-VARIANTS.md §5) ---------------------------------
     * The select screen draws the picker; game.js owns the state behind it.
     * These are the four things it needs from this file so the two agree —
     * which variants a character has, how to walk them, which one to hand a
     * second player who wants the same character, and what each player chose
     * last time. Every one of them is identity only: there is no number on a
     * variant to hand back.
     */
    variantsFor: variantsFor,
    variantCount: variantCount,
    cycleVariant: cycleVariant,
    distinctVariantFor: distinctVariantFor,
    recallPick: recallPick,
    rememberPick: rememberPick
  };

})(window.T = window.T || {});
