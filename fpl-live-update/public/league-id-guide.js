/* The header guide works independently of league data and homepage loading. */
(() => {
  'use strict';
  const open = document.getElementById('headerLeagueGuideOpen');
  const dialog = document.getElementById('headerLeagueGuide');
  if (!open || !dialog) return;
  let returnToInput = false;
  open.addEventListener('click', () => {
    if (dialog.open) return;
    returnToInput = false;
    dialog.showModal();
    document.documentElement.classList.add('league-id-guide-open');
    document.getElementById('headerLeagueGuideTitle').focus();
  });
  document.getElementById('headerLeagueGuideClose').addEventListener('click', () => dialog.close());
  document.getElementById('headerLeagueGuideDone').addEventListener('click', () => {
    returnToInput = true; dialog.close();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  // Native Escape and the close controls all restore scrolling and focus.
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('league-id-guide-open');
    (returnToInput ? document.getElementById('headerLeagueId') : open).focus();
    returnToInput = false;
  });
})();
