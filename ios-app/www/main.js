const button = document.querySelector('#launch');
button.addEventListener('click', async () => {
  const url = 'https://aditsanghani.com/briefing/';
  const browser = window.Capacitor?.Plugins?.Browser;
  if (browser?.open) {
    try { await browser.open({ url, presentationStyle: 'fullscreen' }); return; }
    catch (error) { console.warn('Native browser unavailable', error); }
  }
  window.location.assign(url);
});
