const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const short = (value, max) => { const s = plain(value); return s.length > max ? s.slice(0,max-1).replace(/\s+\S*$/,'')+'…' : s; };
const palette = { bg:'#f7f0e9', paper:'#fffaf5', ink:'#38251e', muted:'#826255', terracotta:'#b5694b', line:'#e9d9cb' };
function buildDailyEmail({brief={},briefId,baseUrl,audioEnabled=false}) {
  const base=String(baseUrl||'').replace(/\/+$/,'');
  if(!/^https:\/\/[^/?#]+/i.test(base)) throw new Error('SITE_URL must use HTTPS');
  const url=base+'/briefing/?brief='+encodeURIComponent(String(briefId??''));
  const listen=url+'#briefingStart';
  const date=plain(brief.date||'Today'), readTime=plain(brief.readTime||'Your edition');
  const intro=short(brief.intro||'A thoughtful selection of stories, tuned to what matters to you.',360);
  const stories=(Array.isArray(brief.stories)?brief.stories:[]).filter(s=>s&&s.title).slice(0,4);
  const storyRows=stories.map((s,i)=>'<tr><td style="padding:22px 0;border-bottom:1px solid '+palette.line+';">'
    +'<div style="font:700 10px Arial,sans-serif;letter-spacing:1.5px;color:'+palette.terracotta+';text-transform:uppercase;margin-bottom:9px;">'+String(i+1).padStart(2,'0')+' &nbsp; '+escapeHtml(short(s.category||'In focus',50))+'</div>'
    +'<div style="font:bold 21px/1.32 Georgia,serif;color:'+palette.ink+';">'+escapeHtml(short(s.title,135))+'</div>'
    +(s.summary?'<p style="font:14px/1.65 Arial,sans-serif;color:'+palette.muted+';margin:9px 0 0;">'+escapeHtml(short(s.summary,180))+'</p>':'')+'</td></tr>').join('');
  const logo='<span style="color:#e8c4ab;font-size:31px;">▰</span><span style="color:#df9e7e;font-size:31px;">▰</span><span style="color:#ad603f;font-size:31px;">▰</span>';
  const action=(href,label,primary)=>'<a href="'+escapeHtml(href)+'" style="display:inline-block;margin:0 8px 8px 0;padding:15px 22px;text-decoration:none;border-radius:50px;font:700 14px Arial,sans-serif;background:'+(primary?palette.ink:'#f7e5d8')+';color:'+(primary?'#ffffff':palette.ink)+';">'+label+'</a>';
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Neosis daily edition</title></head>'
   +'<body style="margin:0;background:'+palette.bg+';-webkit-text-size-adjust:100%;">'
   +'<div style="display:none;max-height:0;opacity:0;overflow:hidden;">Your personalized briefing is ready. A little clarity for the day ahead.</div>'
   +'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:'+palette.bg+';"><tr><td align="center" style="padding:30px 12px 46px;">'
   +'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:610px;background:'+palette.paper+';border:1px solid '+palette.line+';border-radius:18px;">'
   +'<tr><td style="padding:27px 34px;border-bottom:1px solid '+palette.line+';"><table role="presentation" width="100%"><tr><td>'+logo+' <strong style="font:700 27px Georgia,serif;letter-spacing:-1px;color:'+palette.ink+';">neosis</strong></td>'
   +'<td align="right" style="font:700 10px/1.6 Arial,sans-serif;letter-spacing:1px;color:'+palette.muted+';">YOUR DAILY<br>INTELLIGENCE</td></tr></table></td></tr>'
   +'<tr><td style="padding:40px 34px 12px;">'
   +'<div style="font:700 11px Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:'+palette.terracotta+';">THE DAILY EDITION &nbsp; · &nbsp; '+escapeHtml(date)+'</div>'
   +'<h1 style="font:normal 40px/1.12 Georgia,serif;letter-spacing:-1.5px;color:'+palette.ink+';margin:20px 0;">A little more<br><i style="color:'+palette.terracotta+';">in the know.</i></h1>'
   +'<p style="font:15px/1.8 Arial,sans-serif;color:'+palette.muted+';margin:0 0 18px;">'+escapeHtml(intro)+'</p>'
   +'<p style="font:12px Arial,sans-serif;color:'+palette.muted+';margin:0 0 27px;">'+escapeHtml(readTime)+(stories.length?' &nbsp;·&nbsp; '+stories.length+' stories to explore':'')+'</p>'
   +action(url,'Read your briefing &rarr;',true)+(audioEnabled?action(listen,'Listen instead &#9654;',false):'')+'</td></tr>'
   +(stories.length?'<tr><td style="padding:28px 34px 4px;"><div style="font:700 11px Arial,sans-serif;letter-spacing:2px;color:'+palette.muted+';">INSIDE TODAY’S NEOSIS</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">'+storyRows+'</table><p style="margin:22px 0;font:700 13px Arial,sans-serif;"><a style="color:'+palette.terracotta+';text-decoration:none;" href="'+escapeHtml(url)+'">Explore the complete edition &rarr;</a></p></td></tr>':'')
   +'<tr><td style="padding:24px 34px 34px;"><div style="background:#f6e4d6;border-radius:14px;padding:22px;"><div style="font:19px Georgia,serif;color:'+palette.ink+';">Made for your curiosity.</div><p style="font:13px/1.65 Arial,sans-serif;color:'+palette.muted+';margin:9px 0 0;">Neosis learns from what you explore. Use Tune to shape tomorrow’s edition.</p></div></td></tr>'
   +'<tr><td align="center" style="padding:22px;border-top:1px solid '+palette.line+';font:11px/1.8 Arial,sans-serif;color:'+palette.muted+';">Neosis · Your daily intelligence<br><a href="'+escapeHtml(base+'/briefing/settings.html')+'" style="color:'+palette.muted+';">Manage email preferences</a></td></tr>'
   +'</table></td></tr></table></body></html>';
  const text=['NEOSIS — YOUR DAILY INTELLIGENCE',date+' · '+readTime,'','A little more in the know.',intro,'','Read: '+url,...(audioEnabled?['Listen: '+listen]:[]),'',...stories.flatMap((s,i)=>[String(i+1)+'. '+plain(s.title),plain(s.summary),'']),'Preferences: '+base+'/briefing/settings.html'].join('\n');
  return {subject:'Your Neosis daily edition · '+date,html,text};
}
module.exports={buildDailyEmail};
