const button=document.querySelector('#launch');
button.addEventListener('click',async()=>{
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({url:'https://aditsanghani.com/briefing/',presentationStyle:'fullscreen'});
  } catch { window.location.assign('https://aditsanghani.com/briefing/'); }
});
