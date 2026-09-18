/* Cosmetic settings only: no gameplay stats or random-number draws. */
(function (T) {
  'use strict';
  const backgrounds = [
    { id: 'night', name: 'After Dark', top: '#090c1b', bottom: '#191125', star: '#ddd9ef' },
    { id: 'aurora', name: 'Aurora', top: '#031a25', bottom: '#143e39', star: '#9cf5db' },
    { id: 'sunset', name: 'Sunset', top: '#24112f', bottom: '#67372d', star: '#ffd3a0' },
    { id: 'space', name: 'Deep Space', top: '#030414', bottom: '#201044', star: '#bca7ff' }
  ];
  // Keep the original background exactly as authored.
  backgrounds[0].top = T.C.PAL.sky;
  backgrounds[0].bottom = T.C.PAL.skyDeep;
  backgrounds[0].star = T.C.PAL.star;
  const toasters = [
    { id: 'chrome', name: 'Classic Chrome', key: {} },
    { id: 'gold', name: 'Golden Toast', key: { C:'#c99735', L:'#ffe5a1', D:'#765022', O:'#ef7037', o:'#ffbc66' } },
    { id: 'mint', name: 'Mint Kitchen', key: { C:'#75c5b1', L:'#d3ffeb', D:'#326e69', O:'#ea789d', o:'#ffd0df' } },
    { id: 'berry', name: 'Berry Pop', key: { C:'#cc6e9f', L:'#ffd3e6', D:'#713f74', O:'#80cce7', o:'#d8faff' } }
  ];
  const lists = { background: backgrounds, toaster: toasters };
  const picks = {};
  let panel = null;
  const selects = {};
  for (const kind of Object.keys(lists)) {
    const saved = T.Util.storeGet('toasterInvaders.' + kind + 'Skin', '');
    picks[kind] = Math.max(0, lists[kind].findIndex(row => row.id === saved));
  }
  function current(kind) { return lists[kind][picks[kind]]; }
  function choose(kind, id) {
    if (!lists[kind]) return false;
    const index = lists[kind].findIndex(row => row.id === id);
    if (index < 0) return false;
    picks[kind] = index;
    T.Util.storeSet('toasterInvaders.' + kind + 'Skin', id);
    if (selects[kind]) selects[kind].value = id;
    return true;
  }
  function cycle(kind) {
    choose(kind, lists[kind][(picks[kind] + 1) % lists[kind].length].id);
  }
  function init(root) {
    if (panel || !root) return;
    panel = document.createElement('details');
    panel.id = 'skin-picker';
    const summary = document.createElement('summary');
    summary.textContent = 'SKINS';
    panel.appendChild(summary);
    const body = document.createElement('div');
    body.className = 'skin-options';
    for (const kind of Object.keys(lists)) {
      const label = document.createElement('label');
      label.textContent = kind === 'background' ? 'Background' : 'Toasters';
      const select = document.createElement('select');
      select.setAttribute('aria-label', label.textContent + ' skin');
      for (const row of lists[kind]) {
        const option = document.createElement('option');
        option.value = row.id; option.textContent = row.name;
        select.appendChild(option);
      }
      select.value = current(kind).id;
      select.addEventListener('change', () => choose(kind, select.value));
      selects[kind] = select;
      label.appendChild(select); body.appendChild(label);
    }
    const hint = document.createElement('p');
    hint.textContent = 'Title / pause: ← background · → toasters';
    body.appendChild(hint); panel.appendChild(body);
    // Native selects own their arrow/space keys, not the game underneath.
    panel.addEventListener('keydown', event => event.stopPropagation());
    panel.addEventListener('keyup', event => event.stopPropagation());
    root.appendChild(panel);
  }
  function update(game) {
    const available = game.state === 'title' || (game.state === 'pause' && !game.quitConfirm);
    if (panel) {
      panel.hidden = !available;
      if (!available) panel.open = false;
    }
    if (!available || !T.Input) return;
    for (let slot = 0; slot < 2; slot++) {
      const pad = T.Input.get(slot);
      if (pad.leftPressed) { cycle('background'); T.Input.consume(slot, 'left'); }
      if (pad.rightPressed) { cycle('toaster'); T.Input.consume(slot, 'right'); }
    }
  }
  T.Skins = { backgrounds, toasters, current, choose, cycle, init, update };
})(window.T = window.T || {});
