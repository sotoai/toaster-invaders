// Run with: node tests/smore.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const storage = new Map();
function boot() {
  const canvases = [];
  const document = { createElement(tag) {
    if (tag !== 'canvas') return {
      children: [], listeners: {}, hidden: false, open: false,
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, callback) { this.listeners[name] = callback; }
    };
    const canvas = { width: 0, height: 0, rects: [] };
    const ctx = { fillRect(x,y,w,h) { canvas.rects.push([x,y,w,h,this.fillStyle]); },
      clearRect() {}, drawImage() {}, putImageData() {},
      getImageData(x,y,w,h) { return { data: new Uint8ClampedArray(w*h*4) }; } };
    canvas.getContext = () => ctx; canvases.push(canvas); return canvas;
  } };
  const window = { localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) } };
  const c = vm.createContext({ window, document, console, performance: { now: () => 0 } });
  for (const file of ['util','audio','skins','sprites','entities','weapons','modes','backrooms','game']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'), c);
  }
  const T = window.T;
  T.Sprites.build(); // Validates every map, dimension, palette and variant.
  T.Game.init(null);
  return T;
}
function begin(T, mode='coop') {
  const g=T.Game;
  g.uiTap({ action:'start' });
  if(mode==='classic') {
    g.uiTap({ action:'join', player:1 });
    g.uiTap({ action:'mode', value:'classic' });
    g.uiTap({ action:'ready', player:1 });
  }
  g.uiTap({ action:'ready', player:0 });
  g.update(T.C.FIXED_DT);
  g.update(3);
  assert.equal(g.state,'play');
}
function nextWave(T) {
  // Advance the real wave-clear path; leave the next formation untouched.
  const b=T.Game.board;
  b.clearT=0.001;
  T.Game.update(T.C.FIXED_DT);
}
for (const mode of ['coop','classic']) {
  storage.clear();
  const T=boot(); begin(T,mode);
  assert.equal(T.Game.visibleCharacters().includes('smore'),false);
  while(T.Game.board.wave<6) { nextWave(T); T.Game.update(3); }
  assert.equal(T.Util.isUnlocked('burrito'),true);
  assert.equal(T.Util.isUnlocked('smore'),false);
  nextWave(T);
  assert.equal(T.Game.board.wave,7);
  assert.equal(T.Game.state,'wave');
  assert.equal(T.Util.isUnlocked('smore'),true,'unlocks before wave-seven gameplay');
  assert.equal(T.Game.reveal.id,'smore');
  assert.equal(T.Game.visibleCharacters().includes('smore'),true);
  assert.ok(JSON.parse(storage.get('toasterInvaders.unlocked')).includes('smore'));
  assert.ok(boot().Game.visibleCharacters().includes('smore'),'survives immediate reload');
}
const T=boot();
T.Game.uiTap({action:'start'});
const index=T.Game.visibleCharacters().indexOf('smore');
assert.equal(T.Game.uiTap({action:'char', player:0,value:index}),true);
assert.equal(T.Game.select.players[0].kind,'smore');
T.Game.uiTap({action:'ready',player:0}); T.Game.update(T.C.FIXED_DT); T.Game.update(3);
const ship=T.Game.board.ships[0];
assert.equal(ship.kind,'smore');
assert.equal(ship.weapon.def.id,'marshmallow');
assert.equal(T.Weapons.fire(ship,T.Game.board),true);
assert.equal(T.Weapons.canFire(ship,T.Game.board),false,'one live shot');
const shot=T.Game.board.shots[0];
assert.equal(shot.w,12); assert.equal(shot.h,16); assert.equal(shot.vy,-500);
T.Weapons.equip(ship,'espresso'); T.Weapons.revert(ship);
assert.equal(ship.weapon.def.id,'marshmallow');
for(const name of ['smore0','smore1','lifeSmore','marshmallow']) {
  assert.ok(T.Sprites.get(name).canvas.rects.length);
}
// Export actual rasterizer output for an optional local visual check.
if(process.env.SMORE_PREVIEW) {
  const panels=[0,1,2].map(i=>T.Sprites.get('smore0~'+i).canvas.rects);
  const rects=panels.map((panel,i)=>panel.map(([x,y,w,h,color])=>
    `<rect x="${x+i*54+5}" y="${y+5}" width="${w}" height="${h}" fill="${color}"/>`).join('')).join('');
  fs.writeFileSync(process.env.SMORE_PREVIEW,`<svg xmlns="http://www.w3.org/2000/svg" width="972" height="264" viewBox="0 0 162 44"><rect width="162" height="44" fill="#0d0b10"/>${rects}</svg>`);
}
console.log('S’more passed: immediate wave 7 unlock, persistence, co-op/classic, selection, sprite builds, weapon and upgrade reversion.');

// Cosmetic choices persist and do not modify gameplay or consume its RNG.
const beforeStats = JSON.stringify(T.C.BASE_WEAPONS);
const classic = T.Sprites.get('toastA0');
const toasterPanels = [];
for (const skin of T.Skins.toasters) {
  assert.equal(T.Skins.choose('toaster', skin.id), true);
  const sprite = T.Sprites.get('toastA0');
  assert.equal(sprite.w, classic.w);
  assert.equal(sprite.h, classic.h);
  toasterPanels.push(sprite.canvas.rects);
  if (skin.id !== 'chrome') assert.notDeepEqual(sprite.canvas.rects, classic.canvas.rects);
}
assert.equal(T.Skins.choose('toaster', 'missing'), false);
assert.equal(T.Skins.current('toaster').id, 'berry');
T.Skins.choose('background', 'aurora');
assert.equal(boot().Skins.current('background').id, 'aurora');
assert.equal(boot().Skins.current('toaster').id, 'berry');
assert.equal(JSON.stringify(T.C.BASE_WEAPONS), beforeStats);
T.Util.seed(123); const expected = T.Util.rng();
T.Util.seed(123); T.Skins.cycle('background'); T.Skins.cycle('toaster');
assert.equal(T.Util.rng(), expected);
if (process.env.SKINS_PREVIEW) {
  const rects = toasterPanels.map((panel,i) => panel.map(([x,y,w,h,color]) =>
    `<rect x="${x+i*64+6}" y="${y+6}" width="${w}" height="${h}" fill="${color}"/>`).join('')).join('');
  const bg = T.Skins.backgrounds.map((b,i) => `<linearGradient id="b${i}" x2="0" y2="1"><stop stop-color="${b.top}"/><stop offset="1" stop-color="${b.bottom}"/></linearGradient>`).join('');
  const panels = T.Skins.backgrounds.map((b,i) => `<rect x="${i*64}" width="64" height="46" fill="url(#b${i})"/>`).join('');
  fs.writeFileSync(process.env.SKINS_PREVIEW, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="184" viewBox="0 0 256 46"><defs>${bg}</defs>${panels}${rects}</svg>`);
}
console.log('Skins passed: all palettes build, dimensions unchanged, choices persist, stats and RNG unchanged.');

// Native chooser and controller shortcuts use the same saved selections.
const root = { children: [], appendChild(child) { this.children.push(child); } };
T.Skins.init(root);
const panel = root.children[0];
const select = panel.children[1].children[0].children[0];
select.value = 'space'; select.listeners.change();
assert.equal(T.Skins.current('background').id, 'space');
const pads = [{ leftPressed: true }, {}];
T.Input = { get: i => pads[i], consume(i, name) { pads[i][name+'Pressed'] = false; } };
T.Skins.update({ state: 'title' });
assert.equal(T.Skins.current('background').id, 'night');
assert.equal(panel.hidden, false);
panel.open = true;
T.Skins.update({ state: 'play' });
assert.equal(panel.hidden, true); assert.equal(panel.open, false);
T.Skins.update({ state: 'pause', quitConfirm: false });
assert.equal(panel.hidden, false);
T.Skins.update({ state: 'pause', quitConfirm: true });
assert.equal(panel.hidden, true);

// A selection changes the actual background renderer, including its cache.
const gradients = [];
const ctx = { createLinearGradient() {
  const stops = []; gradients.push(stops);
  return { addColorStop(position, color) { stops.push([position, color]); } };
}, fillRect() {}, drawImage() {} };
T.Game.state = 'title';
for (const skin of T.Skins.backgrounds) {
  T.Skins.choose('background', skin.id); T.Game.render(ctx);
  assert.deepEqual(gradients.at(-1), [[0,skin.top],[1,skin.bottom]]);
  const count = gradients.length; T.Game.render(ctx);
  assert.equal(gradients.length, count, 'reuse unchanged gradient');
}
console.log('Skin controls and live background renderer passed.');

// Every animation frame must retain the skin, including the high wing poses.
for (const skin of T.Skins.toasters.filter(s => s.id !== 'chrome')) {
  T.Skins.choose('toaster', skin.id);
  const names = ['ufo', 'ufo1'];
  for (const type of ['A','B','C']) {
    for (const frame of T.C.FRAME_CYCLE) names.push('toast'+type+frame);
  }
  for (const name of names) {
    const colors = T.Sprites.get(name).canvas.rects.map(rect => rect[4]);
    assert.ok(colors.includes(skin.key.C), `${skin.id} must cover ${name}`);
  }
}
console.log('All toaster skins cover the complete wing cycle and both UFO frames.');
module.exports = { boot, storage };
