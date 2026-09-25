let deferredPrompt = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('Shortxx Service Worker registered successfully:', reg.scope))
      .catch((err) => console.warn('Shortxx Service Worker registration failed:', err));
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  // Trigger installation on first user tap/click interaction
  const triggerInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User installed Shortxx to desktop/taskbar');
        }
        deferredPrompt = null;
      });
    }
    window.removeEventListener('click', triggerInstall);
  };

  window.addEventListener('click', triggerInstall, { once: true });
});
