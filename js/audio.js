/* ===========================================================================
 * TOASTER INVADERS — js/audio.js
 *
 * ROLE: every sound in the game, synthesized from scratch with WebAudio.
 * There are no audio files, no decoding, no network. Oscillators, biquad
 * filters, gain envelopes and one white-noise buffer generated at init.
 *
 * Signal graph (built once, on the first user gesture):
 *
 *     one-shots     -> sfxBus ---.
 *     ufo siren     -> sfxBus ---+
 *     microwave hum -> sfxBus ---+-> masterGain (.35) -> limiter -> outGain -> out
 *     march note    -> marchBus -> marchLowpass ---'                   (mute)
 *
 * HARD RULE: the AudioContext is NEVER constructed at load time — Chrome and
 * Safari block a context created outside a gesture and it stays 'suspended'
 * forever. It is built inside init() / unlock(), which main.js calls from the
 * first keypress or gamepad press. Consequently EVERY public method here has
 * to survive being called before that happens: they all no-op silently and
 * none of them ever throws.
 *
 * Classic <script> file: no imports, no exports, no build step.
 * ========================================================================= */
(function (T) {
  'use strict';

  const U = T.Util;

  /* -------------------------------------------------------------------------
   * LOCAL AUDIO TUNING
   * T.C owns everything that tunes GAMEPLAY feel; none of it is about audio,
   * so the mix numbers live here (and only here — no magic numbers inline).
   * ---------------------------------------------------------------------- */
  const MASTER_LEVEL   = 0.35;   // spec: master gain 0.35
  const MUTE_RAMP      = 0.04;   // seconds to fade in/out when toggling mute
  const LIMIT_THRESHOLD = -6;    // dB; safety limiter, transparent below this
  const LIMIT_KNEE      = 6;
  const LIMIT_RATIO     = 12;
  const LIMIT_ATTACK    = 0.003;
  const LIMIT_RELEASE   = 0.12;
  const SCHEDULE_PAD   = 0.005;  // never schedule exactly at currentTime
  const NOISE_SECONDS  = 1.0;    // length of the shared white-noise buffer
  const GROUP_WATCHDOG = 6000;   // ms; frees a one-shot bus if 'ended' never fires
  // Ceiling on opts.delay. A one-shot must finish inside GROUP_WATCHDOG (the
  // longest phrase here is gameOver at ~1.53s), and an unbounded delay is a
  // node LEAK: sources scheduled minutes out stay started-and-connected while
  // the watchdog quietly drops the bus underneath them, so nothing ever fires
  // 'ended' to unhook the chain. Nothing in the game asks for a pre-delay at
  // all; a second is far more than any cue could want.
  const MAX_DELAY      = 1.0;    // seconds
  const RESUME_RETRY   = 0.5;    // seconds between attempts to revive a suspended ctx

  /* Ceiling on |opts.detune|, in cents. The variant data that feeds it asks for
   * roughly -300..+300 (SPEC-VARIANTS section 4) and one octave either way is a
   * generous ceiling on that — but it is a CEILING, not a suggestion: a fat
   * finger in a `sfxDetune` field is a data error, and without this clamp a
   * stray 12000 would transpose a fire cue ten octaves up into inaudibility
   * (or, negative, down into a subsonic thud). Both failures are silent, which
   * is exactly the kind that survives to ship. */
  const MAX_DETUNE     = 1200;   // cents (one octave either side)

  // --- the iconic 4-note descending march: G2, F#2, F2, E2 ---------------
  const MARCH_NOTES      = [98.00, 92.50, 87.31, 82.41];
  const MARCH_LEVEL      = 0.42;
  const MARCH_NOTE_LEN   = 0.11;  // longest a single blip may ring
  const MARCH_MIN_TEMPO  = 0.028; // matches T.Util.stepInterval's floor
  const MARCH_MAX_TEMPO  = 1.60;
  const MARCH_LOOKAHEAD  = 0.05;  // seconds of notes handed to WebAudio ahead
  const MARCH_TIMER_MS   = 18;    // wall-clock poll interval of the scheduler
  const MARCH_MAX_BURST  = 8;     // guard: notes scheduled in one tick
  const MARCH_CUTOFF     = 820;   // lowpass on the march bus — muffled thump

  // --- the bonus-toaster siren -------------------------------------------
  const UFO_BASE      = 430;   // carrier frequency
  const UFO_LFO_RATE  = 8.5;   // warble speed (Hz)
  const UFO_LFO_DEPTH = 150;   // warble depth (Hz either side of the carrier)
  const UFO_CUTOFF    = 1700;
  const UFO_LEVEL     = 0.16;
  const UFO_ATTACK    = 0.12;
  const UFO_RELEASE   = 0.09;

  /* --- weapon upgrades (SPEC-WEAPONS section 7) ---------------------------
   * The espresso repeater fires every 0.07s — fourteen times a second. One
   * fixed pitch at that rate stops sounding like a gun and starts sounding
   * like a broken buzzer, so consecutive ticks walk this ratio table instead.
   * The list length is coprime with nothing in particular; it just has to be
   * long enough that a held trigger never settles into an audible pattern.
   */
  const ESPRESSO_RATIOS = [1.000, 1.059, 0.944, 1.122, 0.917, 1.031, 0.972];
  let espressoStep = 0;

  /* --- base characters (SPEC-CHARACTERS section 4) ------------------------
   * firePepper is one crunch PER PELLET, so the crunch COUNT is a gameplay
   * number and is read from T.C.PEPPER_PELLETS — the same constant weapons.js
   * spawns the volley from. A balance pass that retunes the volley (section 5
   * exists to do exactly that) must never leave the ear counting a different
   * number of pellets from the eye, which is what restating "3" down in the
   * recipe would guarantee. The two numbers below are the audio half of it:
   * a ceiling that keeps the cue inside the base-weapon length budget however
   * generous the grind gets, and the spacing for any crunch past the third.
   */
  const PEPPER_CRUNCH_MAX = 5;      // most crunches one cue may schedule
  const PEPPER_CRUNCH_GAP = 0.040;  // seconds between crunches past the table

  // --- the microwave ray's looping hum -------------------------------------
  const MW_HUM_F      = 58;     // transformer fundamental, felt more than heard
  const MW_RING_F     = 1160;   // magnetron ring sitting on top of it
  const MW_LFO_RATE   = 7.4;    // wobble on the ring
  const MW_LFO_DEPTH  = 46;
  const MW_CUTOFF     = 1500;
  const MW_HISS_F     = 2700;   // bandpassed noise: the cooking hiss
  const MW_LEVEL      = 0.15;
  const MW_RING_LEVEL = 0.30;   // ring and hiss are relative to the hum bus
  const MW_HISS_LEVEL = 0.16;
  const MW_ATTACK     = 0.05;
  const MW_RELEASE    = 0.08;

  /* -------------------------------------------------------------------------
   * MODULE STATE — every one of these stays null until init() runs.
   * ---------------------------------------------------------------------- */
  let ctx         = null;   // AudioContext
  let unavailable = false;  // no AudioContext in this browser, or it threw
  let gestureSeen = false;  // unlock() has run, so a context is safe to build
  let masterGain  = null;   // public mix bus, MASTER_LEVEL
  let outGain     = null;   // mute gate between masterGain and destination
  let sfxBus      = null;   // all one-shots + the ufo siren
  let marchBus    = null;   // the march, through its own lowpass
  let noiseBuffer = null;   // shared white noise, generated once
  let muted       = false;
  let resumeAfter = 0;      // U.now() stamp; throttles nudgeContext()

  /* Per-cue detune, in cents, for the one-shot currently being scheduled.
   * SPEC-VARIANTS section 4 wants the 3 variants of a character to sound like
   * SIBLINGS — the same cue, a different throat — so the offset is applied to
   * the OSCILLATORS of a cue and to nothing else: not its envelopes, not its
   * gains, not its noise layers, not its vibrato rates. Detuning an oscillator
   * moves pitch alone, so the cue's length, shape and level come out identical
   * and the variant reads as a timbre and never as a different weapon.
   *
   * It lives here as module state rather than being threaded through every
   * recipe signature — tone(), and therefore ding() and clink() and all 42
   * recipes — because play() schedules a cue SYNCHRONOUSLY and nothing in this
   * file plays a cue from inside another one, so there is exactly one cue in
   * flight at a time.
   *
   * Two things keep that state from bleeding, and it is worth being explicit
   * that the belt is not the braces: play() writes this UNCONDITIONALLY on
   * every call, including the calls that pass no detune at all, so the value
   * cannot outlive one cue; and it clears it again in a `finally`, so it does
   * not outlive a cue that THREW halfway through either. Drop the first and a
   * variant's offset silently transposes the rest of the session. */
  let cueDetune   = 0;

  // March scheduler. `marchOn` is the DESIRED state (settable before unlock);
  // `marchTimer` is whether the lookahead scheduler is actually running.
  let marchOn       = false;
  let marchTimer    = 0;
  let marchTempo    = 0.5;
  let marchIndex    = 0;
  let marchNextTime = 0;   // context time of the next, NOT-YET-scheduled note
  let marchLastTime = 0;   // context time of the most recently scheduled note

  // UFO siren. `ufoOn` is desired state, `ufoVoice` is the live node bundle.
  let ufoOn    = false;
  let ufoVoice = null;

  // Microwave beam hum — same desired-state / live-bundle split as the siren.
  let microwaveOn    = false;
  let microwaveVoice = null;

  /* =========================================================================
   * SECTION 1 — CONTEXT LIFECYCLE
   * ====================================================================== */

  /**
   * Build the AudioContext and the fixed mix graph. Safe to call as often as
   * you like: the first successful call wins, later calls are a no-op. Returns
   * true when audio is usable, false when it is not (yet).
   *
   * main.js calls this during boot, which is NOT a user gesture — so the very
   * first construction is deliberately deferred until unlock() reports one.
   * Building a context outside a gesture is not an error, but Chrome logs
   * "The AudioContext was not allowed to start" and parks it in 'suspended'
   * anyway, and the spec's quality bar is a clean console on load. Deferring
   * costs nothing: nothing can be heard before a gesture regardless, and every
   * public method here already no-ops while the context is missing.
   */
  function init() {
    if (ctx) return true;
    if (unavailable) return false;
    if (!gestureSeen) return false;   // wait for unlock(); see above

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { unavailable = true; return false; }

    try {
      ctx = new Ctor();

      outGain = ctx.createGain();
      outGain.gain.value = muted ? 0 : 1;
      outGain.connect(ctx.destination);

      // Safety limiter. A wave-clear with the march at full sprint, a siren and
      // a pile of simultaneous hits can stack a lot of voices; this guarantees
      // the sum never clips. It sits below its threshold — and is therefore
      // completely transparent — for everything but those worst-case pile-ups.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = LIMIT_THRESHOLD;
      limiter.knee.value = LIMIT_KNEE;
      limiter.ratio.value = LIMIT_RATIO;
      limiter.attack.value = LIMIT_ATTACK;
      limiter.release.value = LIMIT_RELEASE;
      limiter.connect(outGain);

      masterGain = ctx.createGain();
      masterGain.gain.value = MASTER_LEVEL;
      masterGain.connect(limiter);

      sfxBus = ctx.createGain();
      sfxBus.gain.value = 1;
      sfxBus.connect(masterGain);

      const marchLowpass = ctx.createBiquadFilter();
      marchLowpass.type = 'lowpass';
      marchLowpass.frequency.value = MARCH_CUTOFF;
      marchLowpass.Q.value = 0.9;
      marchLowpass.connect(masterGain);

      marchBus = ctx.createGain();
      marchBus.gain.value = 1;
      marchBus.connect(marchLowpass);

      buildNoiseBuffer();
    } catch (err) {
      // Some locked-down browsers throw from the constructor itself. Give up
      // permanently rather than retrying (and throwing) on every sound.
      ctx = null;
      unavailable = true;
      return false;
    }

    // Publish the mix bus now that it exists (spec: T.Audio.masterGain).
    Audio.masterGain = masterGain;

    // Honour anything the game asked for while we were still silent.
    if (marchOn) startMarchScheduler();
    if (ufoOn) buildUfoVoice();
    if (microwaveOn) buildMicrowaveVoice();

    return true;
  }

  /**
   * Called from a real user gesture (keypress / gamepad button) — the one
   * moment a browser will let us build a context AND leave the 'suspended'
   * state. This is where the graph is actually created the first time.
   */
  function unlock() {
    gestureSeen = true;
    if (!init()) return;
    try {
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(function () { /* ignored */ });
      }
    } catch (err) {
      /* a failed resume must never break the boot sequence */
    }
  }

  /** True when sound can actually be heard right now. */
  function isReady() {
    return !!ctx && ctx.state === 'running';
  }

  /**
   * Revive a context the BROWSER suspended behind our back — a backgrounded
   * tab, an output-device change, an OS interruption (Safari also parks one in
   * 'interrupted'). This matters because the gesture handshake happens exactly
   * once: main.js latches `audioUnlocked` and registers its listeners with
   * `{once: true}`, so nothing will ever call unlock() a second time. Without
   * this nudge a single suspend would leave the game silent for the rest of the
   * session, with no error anywhere to explain it.
   *
   * Throttled to one attempt per RESUME_RETRY seconds so a context that is
   * genuinely dead is not hammered from the per-frame call sites.
   */
  function nudgeContext() {
    if (!ctx || !gestureSeen) return;
    if (ctx.state === 'running' || ctx.state === 'closed') return;
    const t = U.now();
    if (t < resumeAfter) return;
    resumeAfter = t + RESUME_RETRY;
    try {
      if (typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(function () { /* ignored */ });
      }
    } catch (err) {
      /* a context that refuses to resume simply stays silent */
    }
  }

  /** One second of white noise, reused by every crunch, sizzle and splort. */
  function buildNoiseBuffer() {
    const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // Deliberately Math.random, NOT T.Util.rng: rng() is the seeded gameplay
    // stream and burning 44100 draws from it here would change bunker damage
    // and bomb choices for the same seed.
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  }

  /* =========================================================================
   * SECTION 2 — VOICE PRIMITIVES
   * Small builders every sound is assembled from. Each returns nothing useful;
   * they schedule themselves entirely ahead of time and clean themselves up.
   * ====================================================================== */

  /**
   * A one-shot bus. Every voice of a single T.Audio.play() call feeds this so
   * `opts.gain` can scale the whole sound, and so the bus can be disconnected
   * the moment the last voice finishes (no leaked nodes).
   */
  function newGroup(volume) {
    const bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(sfxBus);

    const group = { bus: bus, live: 0, done: false, watchdog: 0 };
    // Belt and braces: if a context is suspended mid-sound, 'ended' may never
    // fire. The watchdog guarantees the bus is eventually released.
    group.watchdog = setTimeout(function () { releaseGroup(group); }, GROUP_WATCHDOG);
    return group;
  }

  /** Disconnect a one-shot bus. Idempotent. */
  function releaseGroup(group) {
    if (group.done) return;
    group.done = true;
    if (group.watchdog) { clearTimeout(group.watchdog); group.watchdog = 0; }
    try { group.bus.disconnect(); } catch (err) { /* already gone */ }
  }

  /**
   * Register a scheduled source with its group. When the source finishes, the
   * ENTIRE voice chain (source -> filter -> amp -> bus) is unhooked — browsers
   * would collect a finished chain anyway, but tearing it down explicitly means
   * a long session can never accumulate orphaned edges. The last voice out
   * releases the shared bus.
   */
  function trackVoice(group, source, amp, filter) {
    group.live++;
    source.onended = function () {
      try { source.disconnect(); } catch (err) { /* already gone */ }
      if (filter) { try { filter.disconnect(); } catch (err) { /* already gone */ } }
      try { amp.disconnect(); } catch (err) { /* already gone */ }
      group.live--;
      if (group.live <= 0) releaseGroup(group);
    };
  }

  /**
   * Attack / sustain / decay on an AudioParam. Exponential decay (musical),
   * linear attack (click-free), and a hard zero at the end so the param never
   * sits at the 0.0001 exponential floor.
   */
  function shapeEnv(param, t0, peak, attack, sustain, decay) {
    const p = Math.max(peak, 0.0005);
    const end = t0 + attack + sustain + decay;
    param.setValueAtTime(0.0001, t0);
    param.linearRampToValueAtTime(p, t0 + attack);
    if (sustain > 0) param.setValueAtTime(p, t0 + attack + sustain);
    param.exponentialRampToValueAtTime(0.0001, end);
    param.setValueAtTime(0, end + 0.001);
  }

  /**
   * Optional resonant filter in front of an amp stage.
   * spec: {type, f0, f1, q, glide} — f1 sweeps the cutoff over `glide` seconds.
   */
  function makeFilter(spec, t0, dur, amp) {
    const flt = ctx.createBiquadFilter();
    flt.type = spec.type || 'lowpass';
    flt.Q.setValueAtTime(spec.q === undefined ? 0.8 : spec.q, t0);
    flt.frequency.setValueAtTime(Math.max(spec.f0, 20), t0);
    if (spec.f1 && spec.f1 !== spec.f0) {
      const glide = Math.max(spec.glide === undefined ? dur : spec.glide, 0.005);
      flt.frequency.exponentialRampToValueAtTime(Math.max(spec.f1, 20), t0 + glide);
    }
    flt.connect(amp);
    return flt;
  }

  /** Optional vibrato LFO wired into an oscillator's frequency param. */
  function addVibrato(spec, target, t0, end) {
    const lfo = ctx.createOscillator();
    lfo.type = spec.type || 'sine';
    lfo.frequency.setValueAtTime(spec.rate, t0);

    const depth = ctx.createGain();
    depth.gain.setValueAtTime(spec.depth, t0);

    lfo.connect(depth);
    depth.connect(target);
    lfo.start(t0);
    lfo.stop(end);
    // The LFO never touches the group bus, so it cleans up on its own.
    lfo.onended = function () {
      try { depth.disconnect(); } catch (err) { /* already gone */ }
      try { lfo.disconnect(); } catch (err) { /* already gone */ }
    };
  }

  /**
   * One oscillator voice.
   *   {type, f0, f1, glide, t0, attack, sustain, decay, peak,
   *    detune, filter:{...}, vibrato:{rate, depth}}
   */
  function tone(group, o) {
    const t0      = o.t0;
    const attack  = o.attack  === undefined ? 0.004 : o.attack;
    const sustain = o.sustain === undefined ? 0     : o.sustain;
    const decay   = o.decay   === undefined ? 0.10  : o.decay;
    const peak    = o.peak    === undefined ? 0.30  : o.peak;
    const dur     = attack + sustain + decay;

    const amp = ctx.createGain();
    shapeEnv(amp.gain, t0, peak, attack, sustain, decay);
    amp.connect(group.bus);

    const filter = o.filter ? makeFilter(o.filter, t0, dur, amp) : null;
    const sink = filter || amp;

    const osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    // The recipe's own detune (the few cents that make gameOver's octave beat,
    // say) PLUS the current cue's variant offset. Adding, not replacing, is
    // what keeps a detuned cue the same sound: the intervals a recipe built by
    // hand survive the transposition intact. `cueDetune` is 0 for every call
    // that passes no opts.detune, so an undetuned cue schedules exactly the
    // node graph it always did, down to whether this line runs at all.
    //
    // Number.isFinite on the recipe's own field for the same reason play()
    // uses it on the caller's: it is the only thing standing between a
    // mistyped literal in the table above and a TypeError out of an AudioParam
    // — and `+` would happily turn a stringly-typed '-12' into '-120' rather
    // than -12, which is the quiet version of the same bug.
    const cents = (Number.isFinite(o.detune) ? o.detune : 0) + cueDetune;
    if (cents) osc.detune.setValueAtTime(cents, t0);
    osc.frequency.setValueAtTime(Math.max(o.f0, 1), t0);
    if (o.f1 && o.f1 !== o.f0) {
      const glide = Math.max(o.glide === undefined ? dur : o.glide, 0.005);
      osc.frequency.exponentialRampToValueAtTime(Math.max(o.f1, 1), t0 + glide);
    }
    if (o.vibrato) addVibrato(o.vibrato, osc.frequency, t0, t0 + dur + 0.03);

    osc.connect(sink);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
    trackVoice(group, osc, amp, filter);
  }

  /**
   * One white-noise voice — crunches, sizzles, splorts and sparkles.
   *   {t0, attack, sustain, decay, peak, rate, filter:{...}}
   */
  function noise(group, o) {
    const t0      = o.t0;
    const attack  = o.attack  === undefined ? 0.003 : o.attack;
    const sustain = o.sustain === undefined ? 0     : o.sustain;
    const decay   = o.decay   === undefined ? 0.10  : o.decay;
    const peak    = o.peak    === undefined ? 0.25  : o.peak;
    const dur     = attack + sustain + decay;

    const amp = ctx.createGain();
    shapeEnv(amp.gain, t0, peak, attack, sustain, decay);
    amp.connect(group.bus);

    const filter = o.filter ? makeFilter(o.filter, t0, dur, amp) : null;
    const sink = filter || amp;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;                       // so a start offset can never run out
    src.playbackRate.setValueAtTime(o.rate === undefined ? 1 : o.rate, t0);
    src.connect(sink);
    // Random offset so two hits in a row are never bit-identical.
    src.start(t0, Math.random() * (NOISE_SECONDS * 0.8));
    src.stop(t0 + dur + 0.02);
    trackVoice(group, src, amp, filter);
  }

  /**
   * The toaster DING — a bright metallic ping built from a slightly detuned
   * triangle fundamental plus two stretched partials. This is the signature
   * timbre of the whole game, so it gets its own builder.
   */
  function ding(group, t0, freq, peak, decay) {
    tone(group, {
      type: 'triangle', f0: freq * 1.008, f1: freq * 0.994, glide: decay,
      t0: t0, attack: 0.003, decay: decay, peak: peak
    });
    tone(group, {
      type: 'sine', f0: freq * 2.02, f1: freq * 1.99, glide: decay * 0.6,
      t0: t0, attack: 0.002, decay: decay * 0.55, peak: peak * 0.40
    });
    tone(group, {
      type: 'sine', f0: freq * 2.97,
      t0: t0, attack: 0.002, decay: decay * 0.30, peak: peak * 0.16
    });
  }

  /**
   * A single piece of cutlery landing — thinner, drier and cheaper than ding().
   * The whole point of the utensil drawer is that it CLATTERS, so this gets
   * stacked six or seven deep at scattered offsets; a full ding() each would
   * be three oscillators per clink and needlessly heavy.
   */
  function clink(group, t0, freq, peak, decay) {
    tone(group, {
      type: 'triangle', f0: freq, f1: freq * 0.982, glide: decay,
      t0: t0, attack: 0.001, decay: decay, peak: peak,
      filter: { type: 'highpass', f0: freq * 0.55, q: 0.7 }
    });
    tone(group, {
      type: 'sine', f0: freq * 2.76,
      t0: t0, attack: 0.001, decay: decay * 0.38, peak: peak * 0.30
    });
  }

  /* =========================================================================
   * SECTION 3 — THE SOUND TABLE
   * Every name in the audio contract, each a distinct recipe. Signature is
   * (group, t0): schedule whatever you like, starting no earlier than t0.
   *
   * LENGTHS vs the spec's "keep everything short (<0.5s)". Measured tail-to-tail,
   * the eleven gameplay/UI cues that the guidance is really about are all well
   * inside it — the longest is enemyHit at 0.41s and ufoAppear at 0.47s. Five
   * are longer, and each is a deliberate, documented exception because it is a
   * musical PHRASE rather than a blip, and none of them overlaps gameplay that
   * needs the channel:
   *
   *     ufoHit     ~0.81s   five-note jackpot arpeggio + payoff ding
   *     extraLife  ~0.62s   two rising dings, 0.14s apart
   *     waveStart  ~0.61s   three-note fanfare, plays under the WAVE banner
   *     playerDie  ~0.62s   spec asks for a descending buzz PLUS a burnt
   *                         sizzle; the death anim runs SHIP_RESPAWN_DELAY (1.6s)
   *     gameOver   ~1.53s   four-note descending phrase; the board is over
   *
   * Compressing any of these under 0.5s would mean cutting notes out of the
   * phrase, not just shortening a ring-out. If that trade is ever wanted, the
   * lever is the inter-note step and the final ding's `decay`.
   *
   * The weapon-upgrade cues (SPEC-WEAPONS section 7) add three more phrases to
   * that list, on the same terms — each is a flourish, and each plays at a
   * moment when nothing else needs the channel:
   *
   *     crateBurst ~0.66s   splintering wood + a cascade of falling cutlery
   *     tokenGrab  ~1.00s   the pickup flourish, under a 1.4s pickup banner
   *     jackpot    ~0.99s   THE FULL BREAKFAST fanfare; the rarest drop there is
   *
   * And one from the secret-character addendum (SPEC-BURRITO section 2), on
   * exactly the same terms — a phrase, played under its own banner, at a
   * moment when nothing else is competing for the channel:
   *
   *     unlockSecret ~1.07s the reveal fanfare, under a 2.5s banner. The
   *                         rarest cue in the file: T.Util.unlock() returns
   *                         true exactly once, so a device that can persist
   *                         plays it once and never again.
   *
   * Every one of the per-weapon FIRE sounds is a blip and stays well inside
   * 0.5s. fireEspresso is a special case in the other direction — its envelope
   * is over in 0.023s and its last node stops 0.047s after t0 (0.052s after the
   * play() call, counting SCHEDULE_PAD), under the spec's 60ms bar either way —
   * and it is mixed low, because the repeater fires fourteen a second.
   *
   * The seven BASE-character fire cues (SPEC-CHARACTERS section 4) add nothing
   * to the long list: every one of them is a blip, the longest (fireHoney)
   * stopping its last node 0.35s after t0. They are heard for a whole session
   * rather than for one pickup, so they are held to a tighter brief than the
   * upgrade cues — see the banner over fireFlake, at the bottom of the table.
   * ====================================================================== */
  const SOUNDS = {

    /* Bread's butter shot: round and soft. A triangle body dropping a big
     * interval fast, with a sine sub underneath for the 'p' of the pwop. */
    shootButter: function (g, t0) {
      tone(g, {
        type: 'triangle', f0: 520, f1: 170, glide: 0.085,
        t0: t0, attack: 0.004, sustain: 0.010, decay: 0.10, peak: 0.50,
        filter: { type: 'lowpass', f0: 2200, f1: 900, q: 0.7 }
      });
      tone(g, {
        type: 'sine', f0: 250, f1: 80, glide: 0.09,
        t0: t0, attack: 0.002, decay: 0.11, peak: 0.32
      });
    },

    /* Jam's shot: wetter and brighter. A bandpassed noise splat over a fast
     * down-swept saw — the 'splort'. */
    shootJam: function (g, t0) {
      noise(g, {
        t0: t0, attack: 0.002, sustain: 0.008, decay: 0.085, peak: 0.34,
        filter: { type: 'bandpass', f0: 3200, f1: 900, q: 1.4, glide: 0.09 }
      });
      tone(g, {
        type: 'sawtooth', f0: 900, f1: 190, glide: 0.07,
        t0: t0, attack: 0.003, decay: 0.09, peak: 0.26,
        filter: { type: 'lowpass', f0: 2600, f1: 1100, q: 1.1 }
      });
      tone(g, {
        type: 'sine', f0: 300, f1: 120, glide: 0.07,
        t0: t0, attack: 0.002, decay: 0.08, peak: 0.18
      });
    },

    /* A toaster dies: a metallic crunch, a low chassis thunk, and then the
     * bright TOAST-IS-READY ding on top. The ding is the signature. */
    enemyHit: function (g, t0) {
      noise(g, {
        t0: t0, attack: 0.002, decay: 0.11, peak: 0.36, rate: 1.2,
        filter: { type: 'bandpass', f0: 1500, f1: 700, q: 1.1 }
      });
      tone(g, {
        type: 'square', f0: 200, f1: 80, glide: 0.07,
        t0: t0, attack: 0.002, decay: 0.09, peak: 0.20,
        filter: { type: 'lowpass', f0: 900, q: 0.7 }
      });
      ding(g, t0 + 0.012, 1980, 0.34, 0.36);
    },

    /* The Chrome Deluxe pays out: a five-note jackpot arpeggio capped with a
     * long ding and a sparkle. Deliberately richer than enemyHit. */
    ufoHit: function (g, t0) {
      const steps = [659.25, 783.99, 987.77, 1174.66, 1567.98];
      for (let i = 0; i < steps.length; i++) {
        const at = t0 + i * 0.055;
        tone(g, {
          type: 'square', f0: steps[i],
          t0: at, attack: 0.004, sustain: 0.020, decay: 0.085, peak: 0.20,
          filter: { type: 'lowpass', f0: 3800, f1: 2400, q: 0.7 }
        });
        tone(g, {
          type: 'triangle', f0: steps[i] * 0.5,
          t0: at, attack: 0.004, decay: 0.09, peak: 0.12
        });
      }
      ding(g, t0 + steps.length * 0.055, 2093, 0.30, 0.50);
      noise(g, {
        t0: t0 + 0.26, attack: 0.010, decay: 0.24, peak: 0.10,
        filter: { type: 'highpass', f0: 4200, q: 0.6 }
      });
    },

    /* A ship burns. Descending square buzz plus a burnt sizzle, exactly as the
     * contract words it. Runs ~0.62s, under the 1.6s death animation — see the
     * length note at the top of this section. */
    playerDie: function (g, t0) {
      tone(g, {
        type: 'square', f0: 330, f1: 55, glide: 0.50,
        t0: t0, attack: 0.005, sustain: 0.09, decay: 0.46, peak: 0.32,
        filter: { type: 'lowpass', f0: 1600, f1: 500, q: 1.2 }
      });
      tone(g, {
        type: 'sawtooth', f0: 165, f1: 34, glide: 0.52, detune: -12,
        t0: t0, attack: 0.006, sustain: 0.08, decay: 0.44, peak: 0.17,
        filter: { type: 'lowpass', f0: 1100, f1: 380, q: 0.8 }
      });
      noise(g, {                                  // the burnt sizzle
        t0: t0 + 0.02, attack: 0.012, sustain: 0.18, decay: 0.38, peak: 0.24,
        filter: { type: 'bandpass', f0: 3000, f1: 1200, q: 0.8, glide: 0.55 }
      });
      noise(g, {                                  // low crackle under it
        t0: t0 + 0.02, attack: 0.010, sustain: 0.12, decay: 0.30, peak: 0.14,
        rate: 0.55,
        filter: { type: 'lowpass', f0: 700, f1: 260, q: 0.9 }
      });
    },

    /* A shot chews into a butter bunker: dull, soft, no ring at all. */
    bunkerHit: function (g, t0) {
      tone(g, {
        type: 'sine', f0: 170, f1: 62, glide: 0.08,
        t0: t0, attack: 0.003, decay: 0.10, peak: 0.34,
        filter: { type: 'lowpass', f0: 500, q: 0.6 }
      });
      noise(g, {
        t0: t0, attack: 0.002, decay: 0.07, peak: 0.18, rate: 0.7,
        filter: { type: 'lowpass', f0: 330, q: 0.5 }
      });
    },

    /* The bonus toaster swoops in: a rising warble that hands over to the
     * looping siren started by startUfo(). */
    ufoAppear: function (g, t0) {
      tone(g, {
        type: 'triangle', f0: 280, f1: 900, glide: 0.40,
        t0: t0, attack: 0.040, sustain: 0.26, decay: 0.13, peak: 0.24,
        vibrato: { rate: 13, depth: 40 },
        filter: { type: 'lowpass', f0: 1400, f1: 2600, q: 1.4 }
      });
      tone(g, {
        type: 'sine', f0: 560, f1: 1800, glide: 0.40,
        t0: t0, attack: 0.050, sustain: 0.24, decay: 0.12, peak: 0.10,
        vibrato: { rate: 13, depth: 70 }
      });
    },

    /* 1500 points: two bright rising dings, like toast popping twice. */
    extraLife: function (g, t0) {
      ding(g, t0, 1567.98, 0.30, 0.30);
      ding(g, t0 + 0.14, 2093.00, 0.32, 0.44);
      noise(g, {
        t0: t0 + 0.14, attack: 0.008, decay: 0.20, peak: 0.09,
        filter: { type: 'highpass', f0: 5000, q: 0.6 }
      });
    },

    /* Menu cursor: one dry tick. */
    uiMove: function (g, t0) {
      tone(g, {
        type: 'square', f0: 740,
        t0: t0, attack: 0.002, decay: 0.045, peak: 0.18,
        filter: { type: 'lowpass', f0: 2800, q: 0.6 }
      });
    },

    /* Confirm: two rising notes with a little sparkle on top. */
    uiConfirm: function (g, t0) {
      tone(g, {
        type: 'square', f0: 587.33,
        t0: t0, attack: 0.003, decay: 0.055, peak: 0.20,
        filter: { type: 'lowpass', f0: 3200, q: 0.6 }
      });
      tone(g, {
        type: 'square', f0: 880.00,
        t0: t0 + 0.06, attack: 0.003, sustain: 0.010, decay: 0.075, peak: 0.20,
        filter: { type: 'lowpass', f0: 3600, q: 0.6 }
      });
      ding(g, t0 + 0.06, 1760, 0.12, 0.22);
    },

    /* Back: one falling note, unmistakably the opposite of uiConfirm. */
    uiBack: function (g, t0) {
      tone(g, {
        type: 'triangle', f0: 440, f1: 262, glide: 0.09,
        t0: t0, attack: 0.003, decay: 0.11, peak: 0.22,
        filter: { type: 'lowpass', f0: 1600, f1: 900, q: 0.8 }
      });
    },

    /* Wave banner: a short three-note fanfare, C-E-C(oct), ding on the last. */
    waveStart: function (g, t0) {
      const notes = [523.25, 659.25, 1046.50];
      for (let i = 0; i < notes.length; i++) {
        const at = t0 + i * 0.115;
        const last = (i === notes.length - 1);
        tone(g, {
          type: 'square', f0: notes[i],
          t0: at, attack: 0.005, sustain: last ? 0.10 : 0.045,
          decay: last ? 0.22 : 0.085, peak: 0.22,
          filter: { type: 'lowpass', f0: 3000, q: 0.7 }
        });
        tone(g, {
          type: 'triangle', f0: notes[i] * 0.5, detune: 6,
          t0: at, attack: 0.005, sustain: last ? 0.10 : 0.040,
          decay: last ? 0.20 : 0.080, peak: 0.14
        });
      }
      ding(g, t0 + 2 * 0.115, 2093, 0.18, 0.34);
    },

    /* Board over: a slow descending A-minor phrase settling onto a low A.
     * Long on purpose — nothing else is playing by then. */
    gameOver: function (g, t0) {
      const phrase = [440.00, 392.00, 349.23, 329.63];
      for (let i = 0; i < phrase.length; i++) {
        const at = t0 + i * 0.20;
        tone(g, {
          type: 'triangle', f0: phrase[i],
          t0: at, attack: 0.008, sustain: 0.075, decay: 0.13, peak: 0.26,
          filter: { type: 'lowpass', f0: 1800, f1: 1200, q: 0.7 }
        });
        tone(g, {
          type: 'square', f0: phrase[i] * 0.5, detune: -8,
          t0: at, attack: 0.008, sustain: 0.070, decay: 0.12, peak: 0.11,
          filter: { type: 'lowpass', f0: 900, q: 0.6 }
        });
      }
      const tail = t0 + phrase.length * 0.20;
      tone(g, {
        type: 'triangle', f0: 220, f1: 218, glide: 0.60,
        t0: tail, attack: 0.010, sustain: 0.18, decay: 0.50, peak: 0.28,
        filter: { type: 'lowpass', f0: 1200, f1: 600, q: 0.8 }
      });
      tone(g, {
        type: 'sine', f0: 110,
        t0: tail, attack: 0.012, sustain: 0.18, decay: 0.48, peak: 0.16
      });
    },

    /* =====================================================================
     * WEAPON UPGRADES — the crate/token loop (SPEC-WEAPONS section 7)
     * ================================================================== */

    /* First hit on the utensil drawer: a wooden thunk with the cutlery inside
     * jumping and rattling back down. Dull body, bright rattle, no ring. */
    crateHit: function (g, t0) {
      tone(g, {                                   // the wooden box itself
        type: 'triangle', f0: 190, f1: 104, glide: 0.06,
        t0: t0, attack: 0.002, decay: 0.10, peak: 0.42,
        filter: { type: 'lowpass', f0: 760, f1: 400, q: 0.9 }
      });
      noise(g, {                                  // the knock of the impact
        t0: t0, attack: 0.001, decay: 0.045, peak: 0.20, rate: 1.4,
        filter: { type: 'bandpass', f0: 2300, f1: 1100, q: 1.2 }
      });
      clink(g, t0 + 0.030, 2640, 0.11, 0.09);     // three bits of cutlery,
      clink(g, t0 + 0.062, 1980, 0.09, 0.11);     // uneven on purpose
      clink(g, t0 + 0.105, 3140, 0.07, 0.07);
    },

    /* Second hit: the drawer comes apart. A low crack, a long splinter of
     * wood, then the whole canteen drawer emptying itself down a staircase. */
    crateBurst: function (g, t0) {
      tone(g, {                                   // the crack
        type: 'square', f0: 150, f1: 52, glide: 0.13,
        t0: t0, attack: 0.002, decay: 0.20, peak: 0.38,
        filter: { type: 'lowpass', f0: 620, f1: 250, q: 1.0 }
      });
      noise(g, {                                  // splintering wood
        t0: t0, attack: 0.002, sustain: 0.05, decay: 0.30, peak: 0.30, rate: 1.5,
        filter: { type: 'bandpass', f0: 1900, f1: 520, q: 0.9, glide: 0.34 }
      });
      // The cascade: seven pieces of cutlery, scattered in time and pitch so
      // it reads as a pile landing rather than a tuned arpeggio.
      const at    = [0.03, 0.08, 0.14, 0.21, 0.29, 0.38, 0.48];
      const freqs = [3140, 2350, 2960, 1760, 2640, 1570, 2090];
      for (let i = 0; i < at.length; i++) {
        clink(g, t0 + at[i], freqs[i], 0.15 - i * 0.012, 0.13);
      }
      noise(g, {                                  // dust settling
        t0: t0 + 0.18, attack: 0.020, decay: 0.30, peak: 0.07,
        filter: { type: 'highpass', f0: 4600, q: 0.6 }
      });
    },

    /* The token spills out and starts falling: a bright descending twinkle,
     * the audible opposite of tokenGrab's rise. Says "come and get it". */
    tokenDrop: function (g, t0) {
      const steps = [2093.00, 1760.00, 1396.91, 1174.66, 987.77];
      for (let i = 0; i < steps.length; i++) {
        tone(g, {
          type: 'sine', f0: steps[i],
          t0: t0 + i * 0.048, attack: 0.002, decay: 0.09, peak: 0.16 - i * 0.014
        });
      }
      noise(g, {
        t0: t0, attack: 0.006, decay: 0.24, peak: 0.08,
        filter: { type: 'highpass', f0: 5200, f1: 2600, q: 0.6, glide: 0.26 }
      });
    },

    /* CATCHING a token. This is the biggest, happiest sound in the game and it
     * is built like one: a filter-swept pad rising underneath, a seven-note
     * pentatonic climb across two octaves on top, and then the payoff — a
     * high double ding, a sparkle, and a sub thump so it lands with weight. */
    tokenGrab: function (g, t0) {
      // The rise: one swept sawtooth pad carrying the whole gesture.
      tone(g, {
        type: 'sawtooth', f0: 165, f1: 990, glide: 0.34,
        t0: t0, attack: 0.020, sustain: 0.06, decay: 0.22, peak: 0.15,
        filter: { type: 'lowpass', f0: 620, f1: 3400, q: 1.6, glide: 0.34 }
      });
      // The climb: C E G C E G C, two octaves in 0.30s.
      const climb = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98, 2093.00];
      for (let i = 0; i < climb.length; i++) {
        const at = t0 + i * 0.050;
        tone(g, {
          type: 'square', f0: climb[i],
          t0: at, attack: 0.003, sustain: 0.012, decay: 0.075, peak: 0.19,
          filter: { type: 'lowpass', f0: 4200, f1: 2800, q: 0.7 }
        });
        tone(g, {
          type: 'triangle', f0: climb[i] * 0.5, detune: 5,
          t0: at, attack: 0.003, decay: 0.085, peak: 0.11
        });
      }
      // The payoff.
      const top = t0 + climb.length * 0.050;
      ding(g, top, 2093.00, 0.34, 0.55);
      ding(g, top + 0.10, 3136.00, 0.17, 0.42);
      noise(g, {
        t0: top, attack: 0.010, decay: 0.36, peak: 0.12,
        filter: { type: 'highpass', f0: 5400, q: 0.6 }
      });
      tone(g, {                                   // weight under the payoff
        type: 'sine', f0: 165, f1: 82, glide: 0.20,
        t0: top, attack: 0.006, decay: 0.26, peak: 0.22
      });
    },

    /* The token hits the floor and is gone: a dropped-cutlery clang with a
     * sad downward bend. Dull and damped — nothing here rings out. */
    tokenLost: function (g, t0) {
      clink(g, t0, 1480, 0.20, 0.16);
      clink(g, t0 + 0.055, 980, 0.14, 0.14);
      tone(g, {                                   // the deflating bend
        type: 'triangle', f0: 392, f1: 138, glide: 0.24,
        t0: t0 + 0.02, attack: 0.004, decay: 0.28, peak: 0.22,
        vibrato: { rate: 9, depth: 12 },
        filter: { type: 'lowpass', f0: 1200, f1: 480, q: 0.8 }
      });
      noise(g, {                                  // the floor
        t0: t0, attack: 0.002, decay: 0.07, peak: 0.14, rate: 0.8,
        filter: { type: 'lowpass', f0: 620, q: 0.6 }
      });
    },

    /* Ammo ran dry, back to butter or jam: a soft deflating blip. Small and
     * apologetic, because it fires mid-fight and must not read as a hit. */
    weaponOut: function (g, t0) {
      tone(g, {
        type: 'sine', f0: 660, f1: 168, glide: 0.14,
        t0: t0, attack: 0.004, decay: 0.16, peak: 0.22,
        filter: { type: 'lowpass', f0: 1500, f1: 520, q: 0.8 }
      });
      noise(g, {
        t0: t0 + 0.02, attack: 0.008, decay: 0.12, peak: 0.07, rate: 0.7,
        filter: { type: 'lowpass', f0: 900, f1: 380, q: 0.7 }
      });
    },

    /* THE FULL BREAKFAST, and nothing else, ever. A real fanfare: three
     * hammered Gs, then a sustained C major chord with dings over the top. */
    jackpot: function (g, t0) {
      for (let i = 0; i < 3; i++) {               // G G G
        const at = t0 + i * 0.090;
        tone(g, {
          type: 'square', f0: 783.99,
          t0: at, attack: 0.004, sustain: 0.030, decay: 0.055, peak: 0.24,
          filter: { type: 'lowpass', f0: 3600, q: 0.7 }
        });
        tone(g, {
          type: 'triangle', f0: 391.995, detune: -6,
          t0: at, attack: 0.004, sustain: 0.028, decay: 0.050, peak: 0.15
        });
      }
      // ...and the chord it was all leading to.
      const hit = t0 + 0.30;
      const chord = [1046.50, 1318.51, 1567.98];
      for (let i = 0; i < chord.length; i++) {
        tone(g, {
          type: 'square', f0: chord[i], detune: i * 4,
          t0: hit, attack: 0.006, sustain: 0.26, decay: 0.30,
          peak: 0.20 - i * 0.045,
          filter: { type: 'lowpass', f0: 4000, f1: 2600, q: 0.7 }
        });
      }
      tone(g, {                                   // the root, two octaves down
        type: 'triangle', f0: 130.81,
        t0: hit, attack: 0.008, sustain: 0.26, decay: 0.32, peak: 0.24,
        filter: { type: 'lowpass', f0: 900, q: 0.6 }
      });
      ding(g, hit, 2093.00, 0.28, 0.52);
      ding(g, hit + 0.22, 3136.00, 0.18, 0.44);
      noise(g, {
        t0: hit, attack: 0.014, sustain: 0.10, decay: 0.34, peak: 0.10,
        filter: { type: 'highpass', f0: 5000, q: 0.6 }
      });
    },

    /* The toast cannon's slice detonating into six crumbs: an airburst. A
     * short pressure thud with a wide noise flare and a scatter of crumb ticks. */
    shrapnel: function (g, t0) {
      tone(g, {
        type: 'sine', f0: 220, f1: 62, glide: 0.09,
        t0: t0, attack: 0.002, decay: 0.13, peak: 0.34,
        filter: { type: 'lowpass', f0: 900, f1: 320, q: 0.9 }
      });
      noise(g, {                                  // the flare
        t0: t0, attack: 0.002, sustain: 0.02, decay: 0.22, peak: 0.30, rate: 1.3,
        filter: { type: 'bandpass', f0: 3400, f1: 700, q: 0.8, glide: 0.24 }
      });
      const at = [0.05, 0.09, 0.12, 0.17];        // crumbs pattering outward
      for (let i = 0; i < at.length; i++) {
        noise(g, {
          t0: t0 + at[i], attack: 0.001, decay: 0.035, peak: 0.10, rate: 1.6,
          filter: { type: 'highpass', f0: 3800, q: 0.7 }
        });
      }
    },

    /* =====================================================================
     * PER-WEAPON FIRE SOUNDS — fifteen weapons, fifteen silhouettes. The test
     * is recognising which one you picked up with your eyes shut.
     * ================================================================== */

    /* BUTTER KNIVES — a sharp metallic whirr. Fast vibrato on a bandpassed
     * saw does the spinning; the highpassed swish is the blade leaving. */
    fireKnife: function (g, t0) {
      tone(g, {
        type: 'sawtooth', f0: 880, f1: 1320, glide: 0.12,
        t0: t0, attack: 0.002, decay: 0.14, peak: 0.24,
        vibrato: { rate: 58, depth: 240 },
        filter: { type: 'bandpass', f0: 2100, f1: 3400, q: 3.2, glide: 0.12 }
      });
      noise(g, {
        t0: t0, attack: 0.002, decay: 0.09, peak: 0.14, rate: 1.5,
        filter: { type: 'highpass', f0: 4200, f1: 6800, q: 0.8, glide: 0.09 }
      });
    },

    /* SPAGHETTI GUN — a wet floppy whip. An upward slither with a heavy
     * wobble on it, and a damp noise sweep chasing the pitch. */
    fireNoodle: function (g, t0) {
      tone(g, {
        type: 'sine', f0: 150, f1: 820, glide: 0.10,
        t0: t0, attack: 0.004, decay: 0.13, peak: 0.32,
        vibrato: { rate: 26, depth: 95 },
        filter: { type: 'lowpass', f0: 1300, f1: 2400, q: 1.5 }
      });
      noise(g, {
        t0: t0, attack: 0.004, decay: 0.11, peak: 0.16, rate: 0.9,
        filter: { type: 'bandpass', f0: 500, f1: 2600, q: 1.6, glide: 0.11 }
      });
    },

    /* TOAST CANNON — a hollow thump. Big sub drop, a short resonant tube
     * ringing at the mouth of the barrel, and a lowpassed powder cough. */
    fireToast: function (g, t0) {
      tone(g, {
        type: 'sine', f0: 168, f1: 44, glide: 0.10,
        t0: t0, attack: 0.003, decay: 0.16, peak: 0.50,
        filter: { type: 'lowpass', f0: 700, f1: 260, q: 0.9 }
      });
      tone(g, {                                   // the hollow barrel
        type: 'triangle', f0: 320, f1: 268, glide: 0.09,
        t0: t0, attack: 0.002, decay: 0.10, peak: 0.20,
        filter: { type: 'bandpass', f0: 640, q: 5.0 }
      });
      noise(g, {
        t0: t0, attack: 0.002, decay: 0.09, peak: 0.20, rate: 0.7,
        filter: { type: 'lowpass', f0: 1100, f1: 380, q: 0.8 }
      });
    },

    /* CEREAL SCATTERGUN — a dry pour with a shotgun body under it. Two noise
     * layers: a wide bright rush, and a low chunk for the recoil. */
    fireScatter: function (g, t0) {
      noise(g, {                                  // the pour
        t0: t0, attack: 0.002, sustain: 0.03, decay: 0.20, peak: 0.32, rate: 1.3,
        filter: { type: 'highpass', f0: 5600, f1: 900, q: 0.7, glide: 0.22 }
      });
      noise(g, {                                  // the chunk
        t0: t0, attack: 0.002, decay: 0.10, peak: 0.20, rate: 0.6,
        filter: { type: 'lowpass', f0: 1000, f1: 360, q: 0.9 }
      });
      tone(g, {
        type: 'square', f0: 240, f1: 82, glide: 0.08,
        t0: t0, attack: 0.002, decay: 0.10, peak: 0.18,
        filter: { type: 'lowpass', f0: 800, q: 0.7 }
      });
    },

    /* ESPRESSO REPEATER — a steam tick: envelope done in 23ms, last node
     * stopped 47ms after t0, and mixed low. Held down this plays fourteen
     * times a second, so the pitch walks the ESPRESSO_RATIOS table on every
     * shot: the ear hears a spitting machine instead of one buzzing note.
     * See the note by that table. */
    fireEspresso: function (g, t0) {
      const r = ESPRESSO_RATIOS[espressoStep % ESPRESSO_RATIOS.length];
      espressoStep = (espressoStep + 1) % ESPRESSO_RATIOS.length;
      noise(g, {
        t0: t0, attack: 0.001, decay: 0.022, peak: 0.13, rate: 1.5 * r,
        filter: { type: 'highpass', f0: 4200 * r, f1: 6200 * r, q: 0.9, glide: 0.022 }
      });
      tone(g, {
        type: 'triangle', f0: 1560 * r, f1: 900 * r, glide: 0.015,
        t0: t0, attack: 0.001, decay: 0.016, peak: 0.10,
        filter: { type: 'bandpass', f0: 2400 * r, q: 2.0 }
      });
    },

    /* HOMING CRUMPETS — a doughy poot, then a quiet rising tone as the thing
     * goes looking for a toaster. The rise IS the homing, made audible. */
    fireCrumpet: function (g, t0) {
      tone(g, {                                   // the poot
        type: 'sine', f0: 250, f1: 132, glide: 0.07,
        t0: t0, attack: 0.005, decay: 0.10, peak: 0.34,
        filter: { type: 'lowpass', f0: 620, f1: 300, q: 0.8 }
      });
      tone(g, {                                   // the seek
        type: 'triangle', f0: 620, f1: 1580, glide: 0.17,
        t0: t0 + 0.03, attack: 0.010, decay: 0.17, peak: 0.11,
        vibrato: { rate: 15, depth: 26 },
        filter: { type: 'lowpass', f0: 2600, q: 1.2 }
      });
    },

    /* MEGA JAM MORTAR — a deep gloopy launch. The rising sine is the classic
     * mortar bloop; the slow wobble and the low gurgle make it jam. */
    fireMegaJam: function (g, t0) {
      tone(g, {
        type: 'sine', f0: 86, f1: 300, glide: 0.14,
        t0: t0, attack: 0.006, decay: 0.20, peak: 0.46,
        vibrato: { rate: 11, depth: 22 },
        filter: { type: 'lowpass', f0: 900, f1: 1500, q: 1.1 }
      });
      tone(g, {
        type: 'triangle', f0: 172, f1: 600, glide: 0.14, detune: -10,
        t0: t0, attack: 0.006, decay: 0.17, peak: 0.16
      });
      noise(g, {                                  // the gurgle
        t0: t0, attack: 0.006, decay: 0.14, peak: 0.16, rate: 0.5,
        filter: { type: 'bandpass', f0: 420, f1: 900, q: 1.8, glide: 0.15 }
      });
    },

    /* PANCAKE FRISBEE — a flat slap, then the whirr of the thing spinning
     * away. Vibrato at 34Hz is the spin; the lowpass keeps it doughy. */
    firePancake: function (g, t0) {
      noise(g, {                                  // the slap
        t0: t0, attack: 0.001, decay: 0.055, peak: 0.30, rate: 1.1,
        filter: { type: 'bandpass', f0: 1250, f1: 700, q: 1.1 }
      });
      tone(g, {                                   // the whirr
        type: 'sawtooth', f0: 265, f1: 200, glide: 0.16,
        t0: t0 + 0.01, attack: 0.006, decay: 0.17, peak: 0.22,
        vibrato: { rate: 34, depth: 72 },
        filter: { type: 'lowpass', f0: 1500, f1: 800, q: 1.3 }
      });
    },

    /* BLENDER BLADE — a rising motor whine, exactly like a kitchen blender
     * winding up: a swept saw with a buzzing vibrato and an opening filter. */
    fireBlender: function (g, t0) {
      tone(g, {
        type: 'sawtooth', f0: 190, f1: 940, glide: 0.22,
        t0: t0, attack: 0.010, sustain: 0.03, decay: 0.16, peak: 0.28,
        vibrato: { rate: 44, depth: 34 },
        filter: { type: 'lowpass', f0: 600, f1: 3000, q: 2.4, glide: 0.22 }
      });
      tone(g, {                                   // motor body
        type: 'square', f0: 95, f1: 235, glide: 0.22, detune: 8,
        t0: t0, attack: 0.010, decay: 0.19, peak: 0.14,
        filter: { type: 'lowpass', f0: 700, q: 0.8 }
      });
    },

    /* KETCHUP & MUSTARD — a rude squeezy-bottle parp, no apologies. A fat
     * detuned saw bending downwards with a slow flutter, a sub octave to make
     * it vulgar, and a wet squelch of bandpassed noise underneath. */
    fireCondiment: function (g, t0) {
      tone(g, {                                   // the parp
        type: 'sawtooth', f0: 218, f1: 126, glide: 0.15,
        t0: t0, attack: 0.004, sustain: 0.02, decay: 0.16, peak: 0.38,
        vibrato: { rate: 27, depth: 58 },
        filter: { type: 'lowpass', f0: 1250, f1: 600, q: 2.2, glide: 0.16 }
      });
      tone(g, {                                   // the vulgar sub octave
        type: 'square', f0: 109, f1: 63, glide: 0.15, detune: -14,
        t0: t0, attack: 0.004, decay: 0.17, peak: 0.20,
        filter: { type: 'lowpass', f0: 520, q: 0.9 }
      });
      noise(g, {                                  // the squelch
        t0: t0, attack: 0.003, sustain: 0.04, decay: 0.13, peak: 0.18, rate: 0.6,
        filter: { type: 'bandpass', f0: 950, f1: 380, q: 1.5, glide: 0.15 }
      });
    },

    /* BAGUETTE LANCE — a crusty creak as the loaf extends. The bandpass
     * climbing over 0.30s is the crust splitting; the sliding triangle is the
     * lance itself getting longer. Timed to the 0.35s extend. */
    fireBaguette: function (g, t0) {
      noise(g, {
        t0: t0, attack: 0.010, sustain: 0.16, decay: 0.14, peak: 0.20, rate: 0.8,
        filter: { type: 'bandpass', f0: 620, f1: 2500, q: 2.6, glide: 0.30 }
      });
      tone(g, {
        type: 'triangle', f0: 300, f1: 470, glide: 0.30,
        t0: t0, attack: 0.014, sustain: 0.12, decay: 0.16, peak: 0.20,
        vibrato: { rate: 12, depth: 30 },
        filter: { type: 'lowpass', f0: 1700, q: 1.4 }
      });
      tone(g, {                                   // the woody groan under it
        type: 'sine', f0: 150, f1: 235, glide: 0.30,
        t0: t0, attack: 0.016, sustain: 0.12, decay: 0.14, peak: 0.14
      });
    },

    /* SYRUP TRAP — a thick slow glug. Two descending gloops, spaced, heavily
     * lowpassed, with a viscous noise between them. Nothing about it is fast. */
    fireSyrup: function (g, t0) {
      const glugs = [
        { at: 0.00, f0: 320, f1: 118, peak: 0.36 },
        { at: 0.12, f0: 250, f1: 88,  peak: 0.28 }
      ];
      for (let i = 0; i < glugs.length; i++) {
        tone(g, {
          type: 'sine', f0: glugs[i].f0, f1: glugs[i].f1, glide: 0.10,
          t0: t0 + glugs[i].at, attack: 0.008, decay: 0.13, peak: glugs[i].peak,
          filter: { type: 'lowpass', f0: 760, f1: 300, q: 1.6 }
        });
      }
      noise(g, {
        t0: t0 + 0.04, attack: 0.010, sustain: 0.06, decay: 0.16, peak: 0.13,
        rate: 0.45,
        filter: { type: 'lowpass', f0: 560, f1: 220, q: 1.2, glide: 0.22 }
      });
    },

    /* SOGGY BREAD — the gag weapon gets the gag sound: a damp flop with no
     * top end and no conviction at all. Deliberately the feeblest cue here. */
    fireSoggy: function (g, t0) {
      noise(g, {
        t0: t0, attack: 0.004, decay: 0.10, peak: 0.22, rate: 0.4,
        filter: { type: 'lowpass', f0: 420, f1: 170, q: 1.1 }
      });
      tone(g, {
        type: 'sine', f0: 196, f1: 62, glide: 0.09,
        t0: t0, attack: 0.008, decay: 0.13, peak: 0.24,
        filter: { type: 'lowpass', f0: 380, q: 0.7 }
      });
    },

    /* =====================================================================
     * BASE-CHARACTER FIRE SOUNDS (SPEC-CHARACTERS section 4)
     *
     * These are NOT upgrade flourishes. An upgrade fire cue is heard for the
     * dozen seconds a token lasts; these seven are the sound of the whole
     * game — the only thing your character ever shoots, thousands of times
     * per session, from the first wave to the game over. So they are mixed
     * and shaped to a stricter brief than anything above:
     *
     *   - SHORT. The longest, fireHoney, has its last node stopped 0.35s after
     *     t0, and the honey dipper is the one weapon slow enough to earn it —
     *     its bead takes 1.3s to cross the board. Note that `refire` is timed
     *     from the shot's DEATH, so a point-blank kill does let a cue overlap
     *     its own next instance; worst case that is two fireHoneys summing to
     *     0.65, still under the 0.78 of a single shootButter, which is the
     *     bar that matters. The rest are 0.06-0.22s blips.
     *   - QUIET. Peaks top out at 0.38 against fireToast's 0.50 and
     *     fireMegaJam's 0.46, because those two fire eight and six times a
     *     pickup while these never stop.
     *   - NO RING. Not one of them uses ding() or clink(). A metallic tail
     *     is what makes a repeated cue fatiguing, and the ding belongs to
     *     the toasters — it must keep meaning "something died".
     *
     * They also have to stay distinct from the upgrade cue nearest them:
     * fireHoney is deliberately pitched a fifth below fireSyrup, and fireRind
     * spins on a triangle where firePancake whirrs on a sawtooth.
     * ================================================================== */

    /* CROISSANT / FLAKE — a dry crumbly snap. Two bright noise cracks a beat
     * apart (one flake, then a smaller one shearing off it) over a short
     * woody body. Nothing wet, nothing metallic, no tail at all. */
    fireFlake: function (g, t0) {
      noise(g, {                                  // the crust splitting
        t0: t0, attack: 0.001, decay: 0.045, peak: 0.26, rate: 1.7,
        filter: { type: 'bandpass', f0: 3600, f1: 1900, q: 1.6, glide: 0.05 }
      });
      noise(g, {                                  // a second flake, a hair later
        t0: t0 + 0.022, attack: 0.001, decay: 0.030, peak: 0.13, rate: 2.1,
        filter: { type: 'highpass', f0: 5200, q: 0.8 }
      });
      tone(g, {                                   // dry pastry body
        type: 'triangle', f0: 430, f1: 250, glide: 0.05,
        t0: t0, attack: 0.001, decay: 0.06, peak: 0.20,
        filter: { type: 'lowpass', f0: 1500, f1: 700, q: 0.8 }
      });
    },

    /* COFFEE MUG / DRIP — a short hot hiss and a ceramic tick. The mug has
     * the fastest refire in the roster (0.05s) and its shot dies early at
     * MUG_RANGE, so it comes back round every 0.42s — the tightest cadence of
     * the nine. This is therefore one of the two shortest cues here (0.09s,
     * level with fireFlake) and among the quietest. */
    fireDrip: function (g, t0) {
      noise(g, {                                  // steam off something scalding
        t0: t0, attack: 0.002, decay: 0.070, peak: 0.20, rate: 1.4,
        filter: { type: 'bandpass', f0: 4600, f1: 2600, q: 1.1, glide: 0.075 }
      });
      tone(g, {                                   // the rim of the mug, ticked
        type: 'triangle', f0: 2450, f1: 2380, glide: 0.05,
        t0: t0, attack: 0.001, decay: 0.055, peak: 0.16,
        filter: { type: 'highpass', f0: 1400, q: 0.7 }
      });
      tone(g, {                                   // the coffee itself, underneath
        type: 'sine', f0: 380, f1: 190, glide: 0.05,
        t0: t0, attack: 0.002, decay: 0.06, peak: 0.14
      });
    },

    /* PEPPER GRINDER / PEPPER — three crunches, one per pellet, so the ear
     * counts the volley the eye is about to see. Unevenly spaced and falling
     * in pitch: a hand turning a grinder, not a triplet. */
    firePepper: function (g, t0) {
      const at    = [0.000, 0.042, 0.082];        // one grind per pellet
      const body  = [600, 470, 700];              // the burr, biting
      const grit  = [2600, 2050, 3000];           // the peppercorn cracking
      const rate  = [1.5, 1.2, 1.7];
      // How MANY crunches is gameplay, not mix: it is whatever weapons.js is
      // about to put on screen. T.C is guaranteed present (util.js loads
      // first) but the fallback keeps this recipe playable in isolation.
      const want = (T.C && Number.isFinite(T.C.PEPPER_PELLETS))
        ? Math.round(T.C.PEPPER_PELLETS) : at.length;
      const n = U.clamp(want, 1, PEPPER_CRUNCH_MAX);
      for (let i = 0; i < n; i++) {
        // The table is the grinder's VOICE — three hand-picked timbres that
        // cycle — while the clock keeps walking, so a fourth pellet lands as
        // a fourth crunch and never on top of the first.
        const k  = i % at.length;
        const tk = i < at.length
          ? at[i]
          : at[at.length - 1] + (i - at.length + 1) * PEPPER_CRUNCH_GAP;
        noise(g, {
          t0: t0 + tk, attack: 0.001, decay: 0.038,
          peak: Math.max(0.20 - i * 0.020, 0.06), rate: rate[k],
          filter: { type: 'bandpass', f0: grit[k], f1: grit[k] * 0.6, q: 2.0,
                    glide: 0.04 }
        });
        tone(g, {
          type: 'square', f0: body[k], f1: body[k] * 0.62, glide: 0.030,
          t0: t0 + tk, attack: 0.001, decay: 0.035,
          peak: Math.max(0.12 - i * 0.015, 0.04),
          filter: { type: 'lowpass', f0: 1400, q: 1.0 }
        });
      }
    },

    /* HONEY DIPPER / HONEY — a thick slow glug, and deliberately a FIFTH
     * BELOW fireSyrup's (320/250 there, 210/162 here) with a wider gap
     * between the two gloops and a darker filter. Both are "viscous gold in
     * a jar" and the two must never be mistaken for each other: honey is the
     * lower, slower, duller of the pair, which is also what it plays like. */
    fireHoney: function (g, t0) {
      const glugs = [
        { at: 0.00, f0: 210, f1: 76, peak: 0.38 },
        { at: 0.15, f0: 162, f1: 58, peak: 0.26 }
      ];
      for (let i = 0; i < glugs.length; i++) {
        tone(g, {
          type: 'sine', f0: glugs[i].f0, f1: glugs[i].f1, glide: 0.12,
          t0: t0 + glugs[i].at, attack: 0.010, decay: 0.16, peak: glugs[i].peak,
          filter: { type: 'lowpass', f0: 470, f1: 190, q: 1.8 }
        });
      }
      noise(g, {                                  // the pull of the dipper
        t0: t0 + 0.05, attack: 0.014, sustain: 0.05, decay: 0.14, peak: 0.11,
        rate: 0.32,
        filter: { type: 'lowpass', f0: 340, f1: 140, q: 1.3, glide: 0.20 }
      });
    },

    /* CHEESE WEDGE / RIND — a waxy thunk with a spin whirr on it, because the
     * rind leaves at ±CHEESE_ANGLE_DEG and bounces. The whirr is a TRIANGLE
     * at 29Hz vibrato where firePancake is a SAWTOOTH at 34Hz: same gesture,
     * unmistakably different material. */
    fireRind: function (g, t0) {
      tone(g, {                                   // the waxy thunk — soft, dead
        type: 'sine', f0: 260, f1: 96, glide: 0.07,
        t0: t0, attack: 0.002, decay: 0.10, peak: 0.36,
        filter: { type: 'lowpass', f0: 620, f1: 280, q: 0.9 }
      });
      noise(g, {                                  // rind scraping off the wedge
        t0: t0, attack: 0.001, decay: 0.045, peak: 0.14, rate: 0.9,
        filter: { type: 'bandpass', f0: 1500, f1: 800, q: 1.3 }
      });
      tone(g, {                                   // the spin
        type: 'triangle', f0: 340, f1: 265, glide: 0.15,
        t0: t0 + 0.015, attack: 0.006, decay: 0.15, peak: 0.18,
        vibrato: { rate: 29, depth: 60 },
        filter: { type: 'lowpass', f0: 1300, f1: 760, q: 1.2 }
      });
    },

    /* BACON STRIP / SIZZLE — fat hitting a hot pan. Almost all noise, with
     * the bandpass OPENING upward as it goes so it flares rather than decays,
     * and a low spit under it for the weight of the rasher. */
    fireSizzle: function (g, t0) {
      noise(g, {                                  // the sizzle, flaring open
        t0: t0, attack: 0.004, sustain: 0.05, decay: 0.14, peak: 0.24, rate: 1.25,
        filter: { type: 'bandpass', f0: 2800, f1: 5200, q: 0.8, glide: 0.19 }
      });
      noise(g, {                                  // the spit of hot fat
        t0: t0 + 0.01, attack: 0.002, decay: 0.09, peak: 0.14, rate: 0.55,
        filter: { type: 'lowpass', f0: 900, f1: 380, q: 1.0 }
      });
      tone(g, {                                   // the rasher curling
        type: 'sine', f0: 205, f1: 128, glide: 0.10,
        t0: t0, attack: 0.004, decay: 0.12, peak: 0.16
      });
    },

    /* MILK CARTON / SPLASH — a wet carton glug that OPENS UP as it goes: the
     * pitch rises, the filter sweeps wide, exactly like the splash growing
     * from MILK_W_MIN to MILK_W_MAX on its way up the screen. Every other
     * gloop in this file falls; this is the only one that climbs. */
    fireSplash: function (g, t0) {
      tone(g, {                                   // the glug leaving the spout
        type: 'sine', f0: 190, f1: 430, glide: 0.13,
        t0: t0, attack: 0.005, decay: 0.15, peak: 0.34,
        vibrato: { rate: 17, depth: 26 },
        filter: { type: 'lowpass', f0: 700, f1: 2400, q: 1.4, glide: 0.15 }
      });
      noise(g, {                                  // the splash opening out
        t0: t0, attack: 0.004, sustain: 0.02, decay: 0.15, peak: 0.20, rate: 0.8,
        filter: { type: 'bandpass', f0: 700, f1: 3400, q: 1.0, glide: 0.17 }
      });
    },

    /* A bacon trail segment burns a toaster down. This one fires SEVERAL
     * TIMES A SECOND while a trail is laid across a marching formation, and
     * it plays UNDER enemyHit every single time — the kill already has its
     * ding. So it is the quietest and briefest recipe in the file: a 36ms
     * ember crackle at peak 0.11, everything stopped 0.06s after t0, and
     * weapons.js plays it at gain 0.5 on top of that — with just enough low
     * tick to read as a coal popping. Anything bigger here turns a good trail
     * into a wall of noise. */
    baconTrailBurn: function (g, t0) {
      noise(g, {
        t0: t0, attack: 0.001, decay: 0.035, peak: 0.11, rate: 1.8,
        filter: { type: 'bandpass', f0: 3800, f1: 2200, q: 1.6, glide: 0.035 }
      });
      tone(g, {
        type: 'triangle', f0: 720, f1: 430, glide: 0.030,
        t0: t0, attack: 0.001, decay: 0.030, peak: 0.07,
        filter: { type: 'lowpass', f0: 2000, q: 0.8 }
      });
    },

    /* =====================================================================
     * THE SECRET CHARACTER (SPEC-BURRITO section 2)
     * ================================================================== */

    /* A SECRET COMES LOOSE. This is the only cue in the game that is not a
     * reward for scoring, and it has to say so inside its first 70ms —
     * because the two cues nearest it in feel are both about points, and a
     * player who mistakes this one for either of them will never go looking
     * at the select screen:
     *
     *   extraLife  two bright rising DINGS, the second with a breath of high
     *              air behind it. It opens on metal and stays metal.
     *   jackpot    three hammered Gs, then a struck C major triad.
     *
     * So this one is built to differ from both on every axis at once. It
     * OPENS on a sound neither of them — nor any other cue that ever meant
     * POINTS — makes: a dry mechanical latch, wooden, no ring at all, the
     * noise of something being let out. Its nearest relative in the file is
     * crateHit's thunk, which is the point: this is a lid coming off, not a
     * number going up. It then goes QUIET for a third of a second and rises
     * (both of the other two start on their loudest note; this is the only
     * cue in the game whose first half is anticipation). The payoff is ROLLED
     * like a harp, not struck like a chord, and it is an A major ADD-NINTH —
     * a different shape in a different key from jackpot's plain C triad and
     * extraLife's bare G-then-C octave leap. It ends on ONE ding, not two.
     * Different opening, different shape, different chord, different key,
     * different count: none of it can be heard as a score going up.
     *
     * MIX. It clears the music mostly on REGISTER: the march is a muffled
     * bass thump on G2-E2 (98-82Hz) under a MARCH_CUTOFF (820Hz) lowpass,
     * while the roll runs from A3 (220Hz) up and the stamp lands at 2.2kHz —
     * an octave and more clear of it. Two voices DO come down into the
     * march's own octave, and they are worth naming rather than glossing: the
     * latch bottoms out at 132Hz, and the reveal's root is a 110Hz triangle,
     * A2 — a whole tone above the march's top note. Neither is cleared on
     * register, so both are cleared on SHAPE instead. The latch is a 0.07s
     * transient with no ring, so it reads as a click rather than as a pitch
     * competing with the bass line. The root is a sustain, not a transient,
     * but it is deliberately the quiet half of that meeting — peak 0.18
     * against a march note's MARCH_LEVEL 0.42, and gone 0.45s after it lands
     * — so it reads as weight under the chord rather than as a note in the
     * march's own line.
     *
     * Measured off the scheduled envelopes, the cue's worst instant sums to
     * 1.03 against jackpot's 1.15 and tokenGrab's 0.79 — 2.5x a march note
     * and, after MASTER_LEVEL, 0.36 at the mix bus: comfortably clear of the
     * music and just as comfortably under the limiter's -6dB (0.5) threshold,
     * so it never has to duck the march to be heard. Nothing else is on the
     * channel when it plays: game.js holds the cue back until the state is
     * 'play', so the WAVE 5 banner and its waveStart fanfare (2.0s, 0.57s)
     * are both finished before the first latch tick.
     *
     * LENGTH ~1.07s, comfortably inside its 2.5s banner. Every number here is
     * a literal, so nothing reaches an AudioParam that was not written down
     * in this recipe; the two values that CAN come from outside — the caller's
     * gain and the variant detune — are both Number.isFinite-guarded in play()
     * before this function is ever entered. */
    unlockSecret: function (g, t0) {
      // 1. THE LATCH — a bolt sliding back. Dry and wooden, over in 70ms.
      tone(g, {
        type: 'triangle', f0: 300, f1: 132, glide: 0.05,
        t0: t0, attack: 0.001, decay: 0.065, peak: 0.30,
        filter: { type: 'lowpass', f0: 820, f1: 300, q: 0.9 }
      });
      noise(g, {                                  // the catch letting go
        t0: t0, attack: 0.001, decay: 0.040, peak: 0.16, rate: 1.5,
        filter: { type: 'bandpass', f0: 2000, f1: 1000, q: 1.3, glide: 0.040 }
      });

      // 2. THE HUSH — an airy rise opening upward into the reveal. Quiet on
      // purpose: this half is anticipation, not the event.
      const reveal = t0 + 0.40;
      noise(g, {
        t0: t0 + 0.04, attack: 0.070, sustain: 0.10, decay: 0.17, peak: 0.10,
        filter: { type: 'highpass', f0: 900, f1: 7200, q: 0.7, glide: 0.33 }
      });
      tone(g, {                                   // a fifth lifting under it
        type: 'sine', f0: 293.66, f1: 440.00, glide: 0.32,
        t0: t0 + 0.04, attack: 0.060, decay: 0.29, peak: 0.09
      });

      // 3. THE REVEAL — A major add-ninth (A C# E B C# E A), ROLLED upward
      // across two octaves like a harp rather than struck as a block, so it
      // lands as something opening rather than as a hit. Peaks taper as the
      // roll climbs so seven overlapping notes never stack into a shout.
      const roll = [220.00, 277.18, 329.63, 493.88, 554.37, 659.25, 880.00];
      for (let i = 0; i < roll.length; i++) {
        tone(g, {
          type: 'triangle', f0: roll[i],
          t0: reveal + i * 0.032, attack: 0.004, sustain: 0.10, decay: 0.34,
          peak: 0.15 - i * 0.008,
          filter: { type: 'lowpass', f0: 4600, f1: 2800, q: 0.7 }
        });
      }
      tone(g, {                                   // the root, for weight
        type: 'triangle', f0: 110.00,
        t0: reveal, attack: 0.008, sustain: 0.14, decay: 0.30, peak: 0.18,
        filter: { type: 'lowpass', f0: 820, q: 0.6 }
      });

      // 4. THE STAMP — one ding on the chord's major third, high up, with a
      // wash of air behind it. ONE, where extraLife has two.
      ding(g, reveal + 0.20, 2217.46, 0.26, 0.42);
      noise(g, {
        t0: reveal + 0.20, attack: 0.012, decay: 0.30, peak: 0.09,
        filter: { type: 'highpass', f0: 5600, q: 0.6 }
      });
    }
  };

  /* =========================================================================
   * SECTION 4 — PUBLIC ONE-SHOT PLAYBACK
   * ====================================================================== */

  /**
   * Is `name` a cue this file actually knows how to synthesise?
   *
   * play() is deliberately silent about a name it does not have — a missing
   * sound must never take a frame down — which means a typo in a sibling file
   * (a T.C.BASE_WEAPONS row naming 'fireFlaek', say) would simply never be
   * heard by anyone. This is how a test, or a sibling that cares, can ask;
   * nothing in the running game branches on it.
   *
   * @param {string} name
   * @returns {boolean}
   */
  function has(name) {
    return typeof name === 'string' && typeof SOUNDS[name] === 'function';
  }

  /**
   * Fire-and-forget one-shot.
   *   name — any key of SOUNDS (see the audio contract)
   *   opts — optional {gain: 0..4 volume multiplier,
   *                    delay: seconds,
   *                    detune: cents, -MAX_DETUNE..+MAX_DETUNE}
   *
   * `detune` is the variant hook from SPEC-VARIANTS section 4: it shifts the
   * pitch of the cue's OSCILLATORS and touches nothing else, so the cue keeps
   * its exact length, envelope and gain and the three variants of a character
   * come out as three voices of one sound rather than three weapons. See the
   * note on `cueDetune`.
   *
   * Unknown names, a missing context and a suspended context are all silent
   * no-ops. This never throws, so callers never need a guard.
   */
  function play(name, opts) {
    nudgeContext();          // recover from a browser-initiated suspend
    if (!isReady()) return;

    const recipe = SOUNDS[name];
    if (!recipe) return;

    // Number.isFinite, not a typeof check: NaN IS a number, and NaN survives
    // BOTH the clamp (every comparison against it is false, so it is returned
    // as-is) and the `volume <= 0` early-out below. It would then reach
    // `bus.gain.value = NaN`, and assigning a non-finite float to an AudioParam
    // throws a TypeError — from newGroup(), which is outside the try below, so
    // the throw would escape play() into game.js's unguarded sfx() wrapper and
    // take the frame down. Same story for a NaN delay landing in osc.start().
    // Every numeric option this file accepts goes through Number.isFinite
    // before it can reach a param; there is no second route in. Both are then
    // CLAMPED as well — finite is not the same as sane, and an out-of-range
    // delay leaks nodes (see MAX_DELAY) exactly as a NaN one would throw.
    const wantGain = (opts && Number.isFinite(opts.gain)) ? opts.gain : 1;
    const volume = U.clamp(wantGain, 0, 4);
    if (volume <= 0) return;

    const delay = (opts && Number.isFinite(opts.delay))
      ? U.clamp(opts.delay, 0, MAX_DELAY) : 0;

    // Same two-step as gain and delay, for the same two reasons. Number.isFinite
    // FIRST because a NaN or an Infinity reaching osc.detune.setValueAtTime()
    // throws a TypeError — the exact bug this file has already been bitten by
    // once — and the clamp survives neither: every comparison against NaN is
    // false, so U.clamp hands it straight back. Then CLAMPED, because finite is
    // not the same as sane and MAX_DETUNE is what stops a mistyped variant
    // entry transposing a cue out of earshot.
    const detune = (opts && Number.isFinite(opts.detune))
      ? U.clamp(opts.detune, -MAX_DETUNE, MAX_DETUNE) : 0;

    const group = newGroup(volume);
    cueDetune = detune;
    try {
      recipe(group, ctx.currentTime + SCHEDULE_PAD + delay);
    } catch (err) {
      // A malformed recipe must not take the frame down. Voices that did get
      // scheduled still free themselves; the bus goes now.
      if (group.live === 0) releaseGroup(group);
      return;
    } finally {
      // Unconditionally, including on the way out of that catch: a detune left
      // set would silently transpose whatever cue happened to play next.
      cueDetune = 0;
    }
    if (group.live === 0) releaseGroup(group);
  }

  /* =========================================================================
   * SECTION 5 — THE MARCH
   * A lookahead scheduler: a setTimeout poll hands WebAudio only the notes
   * that fall inside the next MARCH_LOOKAHEAD seconds, so tempo changes bite
   * on the very next note instead of waiting out a queue.
   * ====================================================================== */

  /** Schedule one bass blip at an absolute context time. */
  function scheduleMarchNote(index, when) {
    const freq = MARCH_NOTES[index];
    // A blip never outlasts its own slot, so the fastest tempos stay punchy
    // instead of smearing into a drone.
    const len = Math.min(MARCH_NOTE_LEN, Math.max(0.020, marchTempo * 0.85));

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.linearRampToValueAtTime(MARCH_LEVEL, when + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + len);
    amp.gain.setValueAtTime(0, when + len + 0.001);
    amp.connect(marchBus);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.93, when + len);
    osc.connect(amp);
    osc.start(when);
    osc.stop(when + len + 0.02);
    osc.onended = function () {
      try { osc.disconnect(); } catch (err) { /* already gone */ }
      try { amp.disconnect(); } catch (err) { /* already gone */ }
    };
  }

  /** The lookahead poll. Reschedules itself while the march is running. */
  function marchTick() {
    marchTimer = 0;
    if (!marchOn || !ctx) return;

    if (ctx.state === 'running') {
      const horizon = ctx.currentTime + MARCH_LOOKAHEAD;
      // If we fell behind (tab was hidden, context was suspended), resync
      // rather than dumping a burst of overdue notes all at once.
      if (marchNextTime < ctx.currentTime) {
        marchNextTime = ctx.currentTime + SCHEDULE_PAD;
        marchLastTime = marchNextTime - marchTempo;
      }
      let burst = 0;
      while (marchNextTime < horizon && burst < MARCH_MAX_BURST) {
        scheduleMarchNote(marchIndex, marchNextTime);
        marchIndex = (marchIndex + 1) % MARCH_NOTES.length;
        marchLastTime = marchNextTime;
        marchNextTime = marchLastTime + marchTempo;
        burst++;
      }
    } else {
      // Suspended: currentTime is frozen, so just hold the cursor at 'now' and
      // keep asking (throttled) for the context back.
      nudgeContext();
      marchNextTime = ctx.currentTime + SCHEDULE_PAD;
      marchLastTime = marchNextTime - marchTempo;
    }

    marchTimer = setTimeout(marchTick, MARCH_TIMER_MS);
  }

  /** Spin up the scheduler (only ever one timer, only ever one cursor). */
  function startMarchScheduler() {
    if (marchTimer || !ctx) return;
    marchIndex = 0;
    marchNextTime = ctx.currentTime + SCHEDULE_PAD;
    marchLastTime = marchNextTime - marchTempo;
    marchTick();
  }

  /**
   * Begin the 4-note loop. Idempotent: calling it while already marching does
   * nothing (it does NOT restart the phrase). Safe before unlock — the request
   * is remembered and honoured by init().
   */
  function startMarch() {
    if (marchOn) return;
    marchOn = true;
    nudgeContext();
    startMarchScheduler();
  }

  /** Stop the loop. Idempotent, and safe before unlock. */
  function stopMarch() {
    marchOn = false;
    if (marchTimer) { clearTimeout(marchTimer); marchTimer = 0; }
    // Notes already handed to WebAudio are <= MARCH_LOOKAHEAD away and fade
    // out on their own envelopes, so there is nothing to leak.
  }

  /**
   * Set the gap between the bass notes, in seconds. The game feeds this the
   * current formation step interval every frame, so the march accelerates as
   * toasters die.
   *
   * The new tempo takes effect on the NEXT note — the loop is never restarted
   * and the phrase never jumps back to G2 — because `marchNextTime` is by
   * construction a note that has not been handed to WebAudio yet.
   */
  function setMarchTempo(seconds) {
    if (!Number.isFinite(seconds)) return;
    const t = U.clamp(seconds, MARCH_MIN_TEMPO, MARCH_MAX_TEMPO);
    if (t === marchTempo) return;
    marchTempo = t;
    if (marchOn && ctx) {
      const retimed = marchLastTime + t;
      marchNextTime = Math.max(retimed, ctx.currentTime + SCHEDULE_PAD);
    }
  }

  /* =========================================================================
   * SECTION 6 — THE UFO SIREN
   * A continuous warble: one carrier whose frequency is modulated by an LFO.
   * The whole point of the node bundle + `dead` flag is that repeated
   * start/stop cycles can never leave an oscillator running or a node hooked
   * to the bus. Teardown is idempotent and belt-and-braces (ended + timer).
   * ====================================================================== */

  /** Build and start the live siren voice. Only called when none exists. */
  function buildUfoVoice() {
    if (ufoVoice || !ctx) return;
    const t0 = ctx.currentTime + SCHEDULE_PAD;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(UFO_BASE, t0);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(UFO_LFO_RATE, t0);

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(UFO_LFO_DEPTH, t0);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(UFO_CUTOFF, t0);
    filter.Q.setValueAtTime(3, t0);

    const amp = ctx.createGain();
    // Start from silence EXPLICITLY, not just on the schedule. A fresh GainNode's
    // intrinsic value is 1, and the envelope below does not take hold until t0.
    // A stopUfo() that lands inside SCHEDULE_PAD cancels that envelope and then
    // reads `amp.gain.value` back to fade from — which, before t0, is the
    // intrinsic 1.0, i.e. it would ramp the raw sawtooth down from FULL SCALE
    // (6x UFO_LEVEL) over the release. Setting the intrinsic value makes that
    // read harmless no matter when the stop arrives.
    amp.gain.value = 0.0001;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(UFO_LEVEL, t0 + UFO_ATTACK);

    lfo.connect(lfoDepth);
    lfoDepth.connect(osc.frequency);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(sfxBus);

    osc.start(t0);
    lfo.start(t0);

    ufoVoice = {
      osc: osc, lfo: lfo, lfoDepth: lfoDepth,
      filter: filter, amp: amp, dead: false, timer: 0
    };
  }

  /** Stop and fully disconnect a siren bundle. Safe to call any number of times. */
  function killUfoVoice(v) {
    if (v.dead) return;
    v.dead = true;
    if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
    try { v.osc.onended = null; } catch (err) { /* ignored */ }
    try { v.osc.stop(); } catch (err) { /* already stopped */ }
    try { v.lfo.stop(); } catch (err) { /* already stopped */ }
    try { v.osc.disconnect(); } catch (err) { /* ignored */ }
    try { v.lfo.disconnect(); } catch (err) { /* ignored */ }
    try { v.lfoDepth.disconnect(); } catch (err) { /* ignored */ }
    try { v.filter.disconnect(); } catch (err) { /* ignored */ }
    try { v.amp.disconnect(); } catch (err) { /* ignored */ }
  }

  /**
   * Start the looping siren. Idempotent — a second call while it is already
   * running does nothing (and specifically does NOT stack a second voice, the
   * classic way this file leaks a stuck tone). Safe before unlock.
   */
  function startUfo() {
    if (ufoOn) return;
    ufoOn = true;
    nudgeContext();
    buildUfoVoice();   // no-ops without a context; init() picks it up later
  }

  /**
   * Stop the siren with a short release, then tear the nodes down. Idempotent.
   * The live bundle is detached from module state IMMEDIATELY, so a startUfo()
   * during the release fade builds a fresh voice and the old one still dies.
   */
  function stopUfo() {
    ufoOn = false;
    const v = ufoVoice;
    ufoVoice = null;
    if (!v || !ctx) return;

    const now = ctx.currentTime;
    let stopAt = now + UFO_RELEASE;
    try {
      v.amp.gain.cancelScheduledValues(now);
      v.amp.gain.setValueAtTime(Math.max(v.amp.gain.value, 0.0001), now);
      v.amp.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    } catch (err) {
      stopAt = now;  // no graceful fade available — cut it immediately
    }

    try { v.osc.stop(stopAt + 0.02); } catch (err) { /* ignored */ }
    try { v.lfo.stop(stopAt + 0.02); } catch (err) { /* ignored */ }
    v.osc.onended = function () { killUfoVoice(v); };
    // If 'ended' never fires (context suspended or closed mid-fade) the timer
    // still guarantees the nodes are stopped and unhooked.
    v.timer = setTimeout(function () { killUfoVoice(v); },
                         (UFO_RELEASE + 0.10) * 1000 + 200);
  }

  /* =========================================================================
   * SECTION 7 — THE MICROWAVE HUM
   * The MICROWAVE RAY's beam is held down, so its sound is a LOOP, not a
   * one-shot: startMicrowave() when the beam comes up, stopMicrowave() when it
   * drops. Structurally identical to the UFO siren — desired-state flag, one
   * live node bundle, idempotent both ways — because that pattern is what
   * makes repeated start/stop cycles leak nothing. Three layers: a mains
   * transformer hum, a wobbling magnetron ring, and a cooking hiss.
   * ====================================================================== */

  /** Build and start the live hum. Only called when none exists. */
  function buildMicrowaveVoice() {
    if (microwaveVoice || !ctx) return;
    const t0 = ctx.currentTime + SCHEDULE_PAD;

    // Layer 1 — the transformer.
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(MW_HUM_F, t0);

    const humLowpass = ctx.createBiquadFilter();
    humLowpass.type = 'lowpass';
    humLowpass.frequency.setValueAtTime(MW_CUTOFF, t0);
    humLowpass.Q.setValueAtTime(1.2, t0);

    // Layer 2 — the magnetron ring, wobbled by an LFO on its frequency.
    const ring = ctx.createOscillator();
    ring.type = 'square';
    ring.frequency.setValueAtTime(MW_RING_F, t0);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(MW_LFO_RATE, t0);

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(MW_LFO_DEPTH, t0);

    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(MW_RING_LEVEL, t0);

    // Layer 3 — the hiss of something actually cooking.
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer;
    hiss.loop = true;
    hiss.playbackRate.setValueAtTime(1, t0);

    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.frequency.setValueAtTime(MW_HISS_F, t0);
    hissBand.Q.setValueAtTime(0.9, t0);

    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(MW_HISS_LEVEL, t0);

    const amp = ctx.createGain();
    // Same trap as the siren: a fresh GainNode's intrinsic value is 1, and a
    // stop landing inside SCHEDULE_PAD reads that value back to fade from. Set
    // it explicitly so an instant on/off can never blast the raw mix through.
    amp.gain.value = 0.0001;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(MW_LEVEL, t0 + MW_ATTACK);

    hum.connect(humLowpass);
    humLowpass.connect(amp);
    lfo.connect(lfoDepth);
    lfoDepth.connect(ring.frequency);
    ring.connect(ringGain);
    ringGain.connect(amp);
    hiss.connect(hissBand);
    hissBand.connect(hissGain);
    hissGain.connect(amp);
    amp.connect(sfxBus);

    hum.start(t0);
    ring.start(t0);
    lfo.start(t0);
    hiss.start(t0, Math.random() * (NOISE_SECONDS * 0.8));

    microwaveVoice = {
      hum: hum, ring: ring, lfo: lfo, hiss: hiss,
      humLowpass: humLowpass, lfoDepth: lfoDepth, ringGain: ringGain,
      hissBand: hissBand, hissGain: hissGain, amp: amp,
      dead: false, timer: 0
    };
  }

  /**
   * Stop and fully disconnect a hum bundle. Idempotent, and it unhooks EVERY
   * node in the bundle — sources, filters and gains alike. The beam is started
   * and stopped constantly (every trigger press, every weapon swap, every
   * death), so anything left connected here would accumulate for the whole
   * session; there is a 50-cycle node-count assertion covering exactly this.
   */
  function killMicrowaveVoice(v) {
    if (v.dead) return;
    v.dead = true;
    if (v.timer) { clearTimeout(v.timer); v.timer = 0; }
    try { v.hum.onended = null; } catch (err) { /* ignored */ }
    try { v.hum.stop(); } catch (err) { /* already stopped */ }
    try { v.ring.stop(); } catch (err) { /* already stopped */ }
    try { v.lfo.stop(); } catch (err) { /* already stopped */ }
    try { v.hiss.stop(); } catch (err) { /* already stopped */ }
    try { v.hum.disconnect(); } catch (err) { /* ignored */ }
    try { v.ring.disconnect(); } catch (err) { /* ignored */ }
    try { v.lfo.disconnect(); } catch (err) { /* ignored */ }
    try { v.hiss.disconnect(); } catch (err) { /* ignored */ }
    try { v.humLowpass.disconnect(); } catch (err) { /* ignored */ }
    try { v.lfoDepth.disconnect(); } catch (err) { /* ignored */ }
    try { v.ringGain.disconnect(); } catch (err) { /* ignored */ }
    try { v.hissBand.disconnect(); } catch (err) { /* ignored */ }
    try { v.hissGain.disconnect(); } catch (err) { /* ignored */ }
    try { v.amp.disconnect(); } catch (err) { /* ignored */ }
  }

  /**
   * Start the beam hum. Idempotent — a second beam coming up while one is
   * already humming does NOT stack a second voice. Safe before unlock: the
   * request is remembered and init() honours it.
   */
  function startMicrowave() {
    if (microwaveOn) return;
    microwaveOn = true;
    nudgeContext();
    buildMicrowaveVoice();   // no-ops without a context; init() picks it up
  }

  /**
   * Stop the hum with a short release, then tear the nodes down. Idempotent.
   * The bundle leaves module state IMMEDIATELY, so a beam that comes straight
   * back up during the release fade builds a fresh voice while the old one
   * still dies on its own schedule.
   */
  function stopMicrowave() {
    microwaveOn = false;
    const v = microwaveVoice;
    microwaveVoice = null;
    if (!v || !ctx) return;

    const now = ctx.currentTime;
    let stopAt = now + MW_RELEASE;
    try {
      v.amp.gain.cancelScheduledValues(now);
      v.amp.gain.setValueAtTime(Math.max(v.amp.gain.value, 0.0001), now);
      v.amp.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    } catch (err) {
      stopAt = now;  // no graceful fade available — cut it immediately
    }

    try { v.hum.stop(stopAt + 0.02); } catch (err) { /* ignored */ }
    try { v.ring.stop(stopAt + 0.02); } catch (err) { /* ignored */ }
    try { v.lfo.stop(stopAt + 0.02); } catch (err) { /* ignored */ }
    try { v.hiss.stop(stopAt + 0.02); } catch (err) { /* ignored */ }
    v.hum.onended = function () { killMicrowaveVoice(v); };
    // Belt and braces, exactly as the siren does it: if 'ended' never fires
    // because the context was suspended mid-fade, the timer still frees it.
    v.timer = setTimeout(function () { killMicrowaveVoice(v); },
                         (MW_RELEASE + 0.10) * 1000 + 200);
  }

  /* =========================================================================
   * SECTION 8 — MUTE + SHUTDOWN
   * ====================================================================== */

  /** Mute or unmute everything. Works before unlock (the flag is remembered). */
  function setMuted(on) {
    const next = !!on;
    if (next === muted && outGain) return;
    muted = next;
    if (!outGain || !ctx) return;
    try {
      const now = ctx.currentTime;
      outGain.gain.cancelScheduledValues(now);
      outGain.gain.setValueAtTime(outGain.gain.value, now);
      outGain.gain.linearRampToValueAtTime(muted ? 0 : 1, now + MUTE_RAMP);
    } catch (err) {
      try { outGain.gain.value = muted ? 0 : 1; } catch (err2) { /* ignored */ }
    }
  }

  /** @returns {boolean} current mute state. */
  function isMuted() {
    return muted;
  }

  /**
   * Silence every looping voice at once — used when the tab loses focus or the
   * board is torn down. One-shots are short enough to be left alone.
   */
  function stopAll() {
    stopMarch();
    stopUfo();
    stopMicrowave();
  }

  /* =========================================================================
   * EXPORT
   * ====================================================================== */
  const Audio = {
    init: init,
    unlock: unlock,
    isReady: isReady,

    play: play,
    has: has,

    setMarchTempo: setMarchTempo,
    startMarch: startMarch,
    stopMarch: stopMarch,

    startUfo: startUfo,
    stopUfo: stopUfo,

    startMicrowave: startMicrowave,
    stopMicrowave: stopMicrowave,

    setMuted: setMuted,
    isMuted: isMuted,
    stopAll: stopAll,

    // Populated by init(); null until the first user gesture creates the graph.
    masterGain: null
  };

  T.Audio = Audio;

})(window.T = window.T || {});
