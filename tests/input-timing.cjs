// Run with: node tests/input-timing.cjs (no dependencies).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const inputSource = fs.readFileSync(path.join(root, 'js/input.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
// Exercise the shipped frame loop without booting Canvas or WebAudio.
const frameSource = mainSource.slice(mainSource.indexOf('  function frame(nowMs)'),
  mainSource.indexOf('  function start()', mainSource.indexOf('  function frame(nowMs)')));

function rig() {
  const pads = [0, 1].map(index => ({ index, connected: true,
    axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }));
  const events = {};
  const samples = [];
  const T = { C: { FIXED_DT: 1 / 60 }, Util: { clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) } };
  const context = vm.createContext({ window: { T, addEventListener: (name, fn) => { events[name] = fn; },
    requestAnimationFrame: () => 1 }, navigator: { getGamepads: () => pads },
    document: { addEventListener() {}, hidden: false }, console });
  vm.runInContext(inputSource, context);
  T.Input.init();
  T.Game = { state: 'title', render() {}, update() {
    samples.push([0, 1].map(i => ({ ...T.Input.get(i) })));
  } };
  vm.runInContext(`const T = window.T;
    let running = true, rafId = 0, hasLast = false, lastMs = 0, accumulator = 0;
    let touchWasActive = false, ctx = null;
    const MAX_FRAME_DELTA = 0.25, MAX_STEPS_PER_FRAME = 5;
    function touchActive() { return false; }
    function inPortraitPrompt() { return false; }
    function stop() {}
    function drawFatalError(title, err) { throw err; }
    ${frameSource}`, context);
  return { T, pads, samples, events, frame(ms) { vm.runInContext(`frame(${ms})`, context); } };
}

// A complete press/release in a zero-update frame must reach the next tick.
for (const hz of [60, 120, 144]) {
  for (const [name, button] of [['fire', 0], ['start', 9], ['right', 15], ['altChar', 3]]) {
    const r = rig();
    r.frame(0);
    r.pads.forEach(p => { p.buttons[button].pressed = true; });
    r.frame(1000 / hz);
    r.pads.forEach(p => { p.buttons[button].pressed = false; });
    for (let i = 2; i < 12; i++) r.frame(i * 1000 / hz);
    for (const slot of [0, 1]) {
      assert.equal(r.samples.filter(s => s[slot][name + 'Pressed']).length, 1, `${hz} Hz ${name} P${slot + 1}`);
    }
  }
}

// Catch-up ticks see a held direction, but only ONE navigation/fire edge.
{
  const r = rig();
  r.frame(0);
  r.pads[0].buttons[0].pressed = true;
  r.pads[0].buttons[15].pressed = true;
  r.frame(50);
  assert.ok(r.samples.length >= 2);
  assert.equal(r.samples.filter(s => s[0].firePressed).length, 1);
  assert.equal(r.samples.filter(s => s[0].rightPressed).length, 1);
  assert.ok(r.samples.every(s => s[0].fire && s[0].axisX === 1));
  r.frame(100);
  assert.equal(r.samples.filter(s => s[0].firePressed).length, 1, 'held fire must not repeat');
}

// Keyboard and touch use the same latch; explicit consumption still works.
for (const source of ['keyboard', 'touch']) {
  const r = rig();
  r.frame(0);
  if (source === 'keyboard') r.events.keydown({ code: 'Space', preventDefault() {} });
  else r.T.Input.setVirtual(0, 'fire', true);
  r.frame(8);
  if (source === 'keyboard') r.events.keyup({ code: 'Space', preventDefault() {} });
  else r.T.Input.setVirtual(0, 'fire', false);
  r.frame(17);
  assert.equal(r.samples[0][0].firePressed, true, source);
  r.T.Input.consume(0, 'fire');
  assert.equal(r.T.Input.get(0).firePressed, false);
  r.frame(34);
  assert.equal(r.samples[1][0].firePressed, false);
}
console.log('Input timing passed: 60/120/144 Hz, both controllers, catch-up, holds, keyboard and touch.');
