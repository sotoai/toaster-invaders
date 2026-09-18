/* Presentation and shared rule lookup for the optional gameplay challenges. */
(function (T) {
  'use strict';
  const C = T.C;
  function rules(board) {
    return C.GAME_MODES.find(row => row.key === board.challenge) || C.GAME_MODES[0];
  }
  function renderOverlay(ctx, board) {
    ctx.save();
    if (board.challenge === 'defend') {
      const fraction = board.baseHealth / board.baseMaxHealth;
      const color = board.baseFlashT > 0 ? '#ff7868' : '#97d4ad';
      ctx.fillStyle = '#303b42';
      ctx.fillRect(C.FORM_MARGIN, C.PLAY_BOTTOM - 7, C.W - C.FORM_MARGIN * 2, 9);
      ctx.fillStyle = color;
      ctx.fillRect(C.FORM_MARGIN, C.PLAY_BOTTOM - 7,
        (C.W - C.FORM_MARGIN * 2) * fraction, 9);
      ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
      ctx.fillText('BASE ' + board.baseHealth + '/' + board.baseMaxHealth + ' — STOP BOMBS REACHING THE FLOOR', C.W / 2, 716);
    } else if (board.challenge === 'survival') {
      ctx.fillStyle = '#ffba84'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillText('SURVIVAL — NO BREAKS. NO SHIELD REPAIRS.', C.W / 2, 714);
    }
    ctx.restore();
  }
  T.Modes = { rules, renderOverlay, drawBackground() { return false; } };
})(window.T = window.T || {});
