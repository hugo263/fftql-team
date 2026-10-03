(() => {
  const dialog = document.querySelector('#feedbackDialog');
  if (!dialog) return;

  document.querySelectorAll('[data-feedback-open]').forEach((trigger) => {
    trigger.addEventListener('click', () => dialog.showModal());
  });

  dialog.querySelector('[data-feedback-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
})();
