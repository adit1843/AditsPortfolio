const demoBrief={
  date:"October 10, 2026",
  readTime:"~18 min",
  intro:"A personalized current-events brief designed to remember what you already know, avoid stale repetition, and keep important stories in view.",
  stories:[
    {id:"ai-infra",category:"AI infrastructure",title:"AI infrastructure spending remains the story behind the story",summary:"The important question is shifting from whether hyperscalers are spending heavily to where bottlenecks move next.",body:"Yesterday's coverage focused on demand. Today's angle is different: capital intensity is now forcing investors and operators to care much more about power availability, networking, deployment speed, and utilization. That means the next constraint may not be GPUs alone. For someone following data-center engineering, the second-order effects are arguably more important than headline model launches.",sources:["Reuters","Company filings"]},
    {id:"rates",category:"Economy",title:"Markets are repricing the path of interest rates",summary:"Recent labor and inflation data are changing how investors think about the pace of future policy moves.",body:"Rather than repeating a basic Fed explainer, this brief assumes you already understand the rate-setting process. The useful question today is how changes in expected policy transmit into Treasury yields, financing conditions, and company investment decisions.",sources:["Federal Reserve","Reuters"]},
    {id:"robotics",category:"Robotics",title:"Robotics funding is getting more selective",summary:"Capital is still available, but investors appear to be rewarding credible deployment economics over broad autonomy narratives.",body:"This matters because the commercial bar is moving toward measurable labor savings, reliability, serviceability, and integration cost. That favors teams that can prove value in a narrow workflow before expanding into generalized systems.",sources:["Company announcements","Industry reporting"]}
  ]
};

const state={
  view:"today",
  brief:demoBrief,
  explainers:[],
  knowledge:{concepts:{},seenEvents:{}},
  prefs:{
    generalNews:40,
    politics:"important-only",
    markets:true,
    topicScores:{},
    contentTypeScores:{news:55,general_knowledge:50,deep_dive:50,history:50,science:50,business_case:50},
    mixTargets:{news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5},
    requestedTopics:[],
    explanationBias:0,
    languageDirectives:[],
    editorialDirectives:[],
    tuningHistory:[]
  },
  coverage:[],
  surveys:[],
  archivedBriefs:[],
  api:{configured:false,model:null,loading:true,error:null,canRegenerate:true,unlimitedRegenerations:false},
  hydrating:true,
  dbError:null,
  briefDbId:null,
  audioGenerating:false,
  briefGenerating:false
};

const playback={
  key:null,
  segments:[],
  index:0,
  seeking:false,
  lastTime:0,
  listened:[],
  durations:[],
  speed:1,
  initialized:false
};


async function dbGet(resource){
  const r=await fetch(`/api/data?resource=${encodeURIComponent(resource)}`);
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Database read failed");
  return data.data||[];
}
async function dbPost(resource,payload){
  const r=fetch(`/api/data?resource=${encodeURIComponent(resource)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  return r.then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"Database write failed");return data.data;});
}
async function dbDelete(resource,id){
  const r=await fetch(`/api/data?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(id)}`,{method:"DELETE"});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"Database delete failed");
  return data.data;
}
function recEvent(type,story,{value=null,eventKey=null,briefId=null}={}){
  if(!story?.id)return Promise.resolve(null);
  const key=eventKey||`${briefId||state.briefDbId||state.brief?.date||"brief"}:${story.id}:${type}:${value??"x"}`;
  return fetch("/api/data?resource=recommendation_event",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({type,eventKey:key,briefId:briefId||state.briefDbId||null,story,value})
  }).then(async r=>{
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.behavioralInterest)state.prefs.behavioralInterest=d.behavioralInterest;
    return d;
  }).catch(()=>null);
}
async function hydrateFromDatabase(){
  try{
    const [briefs,explainers,preferences,knowledge,coverage,surveys]=await Promise.all([
      dbGet("briefs"),dbGet("explainers"),dbGet("preferences"),dbGet("knowledge"),dbGet("coverage"),dbGet("surveys")
    ]);
    const params=new URLSearchParams(location.search);
    const requestedBrief=params.get("brief");
    const requestedDate=params.get("date");

    state.archivedBriefs=briefs.filter(x=>x?.payload).map(x=>({id:x.id,briefDate:x.brief_date,payload:x.payload,createdAt:x.created_at}));
    if(briefs.length){
      const match=requestedBrief
        ? briefs.find(x=>String(x.id)===String(requestedBrief))
        : requestedDate
          ? briefs.find(x=>x.brief_date===requestedDate || x.payload?.date===requestedDate)
          : briefs[0];
      if(match?.payload){state.brief=match.payload;state.briefDbId=match.id;}
      else {state.brief=briefs[0].payload;state.briefDbId=briefs[0].id;}
    }else{
      state.brief=null;
      state.briefDbId=null;
    }

    if(explainers.length) state.explainers=explainers.map(x=>x.payload);
    if(preferences[0]?.payload) state.prefs=preferences[0].payload;
    if(knowledge[0]?.payload && !Array.isArray(knowledge[0].payload)){
      state.knowledge={
        concepts:knowledge[0].payload.concepts||{},
        seenEvents:knowledge[0].payload.seenEvents||{}
      };
    }
    if(coverage.length) state.coverage=coverage.map(x=>x.payload);
    state.surveys=surveys||[];
    state.dbError=null;
  }catch(e){
    state.dbError=e.message;
  }finally{
    state.hydrating=false;
    render();
    if(state.briefDbId&&Number(state.brief?.audio?.productionVersion||0)<2) setTimeout(()=>generateAudioForCurrentBrief(),350);
  }
}

const app=document.querySelector("#app");
document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{state.view=btn.dataset.view;render();}));

function setActive(){document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));}
function render(){
  setActive();
  if(state.hydrating){
    app.innerHTML='<section class="hero"><div class="eyebrow">Neosis</div><h2>Loading your latest brief…</h2><p class="muted">Fetching the newest saved edition.</p></section>';
    return;
  }
  ({today:renderToday,archive:renderArchive,explainers:renderExplainers,tune:renderTune}[state.view]||renderToday)();
}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function sourceHtml(s){
  if(typeof s==="string") return `<span>${escapeHtml(s)}</span>`;
  if(s&&s.url) return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name||s.url)}</a>`;
  return `<span>${escapeHtml(s?.name||"Source")}</span>`;
}
function bodyHtml(text=""){return escapeHtml(text).split(/\n\s*\n|\n/).filter(Boolean).map(p=>`<p>${p}</p>`).join("");}


function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,n));}
function canonicalConcept(name=""){return String(name).trim().toLowerCase().replace(/\s+/g," ");}
function conceptNames(story){return [...new Set([...(story.concepts||[]),...(story.topics||[])].filter(Boolean))];}
async function bumpKnowledge(concepts,delta,eventKey){
  if(!eventKey || state.knowledge.seenEvents[eventKey]) return;
  const names=[...new Set((concepts||[]).map(x=>String(x).trim()).filter(Boolean))];
  if(!names.length) return;
  for(const label of names){
    const key=canonicalConcept(label);
    const current=state.knowledge.concepts[key]||{label,score:0,exposures:0};
    current.label=current.label||label;
    current.score=clamp((Number(current.score)||0)+delta);
    current.exposures=(Number(current.exposures)||0)+1;
    current.lastSeen=new Date().toISOString();
    state.knowledge.concepts[key]=current;
  }
  state.knowledge.seenEvents[eventKey]=new Date().toISOString();
  await dbPost("knowledge",{payload:state.knowledge});
}

async function creditStoryConsumption(story,credit,modality){
  if(!story || !state.briefDbId) return;
  const eventKey=`${state.briefDbId}:${story.id}:consumed`;
  const prior=state.knowledge.seenEvents[eventKey];
  const priorCredit=(prior&&typeof prior==="object")?Number(prior.credit)||0:(prior?3:0);
  const targetCredit=Math.max(priorCredit,Number(credit)||0);
  const delta=targetCredit-priorCredit;
  if(delta<=0) return;

  const names=[...new Set(conceptNames(story).map(x=>String(x).trim()).filter(Boolean))];
  if(!names.length) return;
  for(const label of names){
    const key=canonicalConcept(label);
    const current=state.knowledge.concepts[key]||{label,score:0,exposures:0};
    current.label=current.label||label;
    current.score=clamp((Number(current.score)||0)+delta);
    current.exposures=(Number(current.exposures)||0)+(priorCredit===0?1:0);
    current.lastSeen=new Date().toISOString();
    state.knowledge.concepts[key]=current;
  }
  state.knowledge.seenEvents[eventKey]={
    at:new Date().toISOString(),
    credit:targetCredit,
    modality
  };
  await dbPost("knowledge",{payload:state.knowledge});
}

function setupStoryReadTracking(){
  if(!state.briefDbId||!("IntersectionObserver" in window))return;
  const active=new Map(),sent=new Map();
  const thresholds=[[5000,.25],[12000,.5],[25000,.75],[45000,1]];
  const start=id=>{
    if(active.has(id))return;
    const begun=Date.now(),timers=[];
    for(const [ms,value] of thresholds){
      timers.push(setTimeout(()=>{
        const story=state.brief.stories.find(s=>String(s.id)===String(id));
        const k=`${state.briefDbId}:${id}:read:${value}`;
        if(story&&!sent.has(k)){sent.set(k,true);recEvent("read_progress",story,{value,eventKey:k}).catch(()=>{});}
      },ms));
    }
    active.set(id,{begun,timers});
  };
  const stop=id=>{
    const row=active.get(id);if(!row)return;
    row.timers.forEach(clearTimeout);active.delete(id);
  };
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      const id=entry.target.dataset.storyId;
      if(entry.isIntersecting&&entry.intersectionRatio>=.6)start(id);else stop(id);
    }
  },{threshold:[.6]});
  document.querySelectorAll(".story-card[data-story-id]").forEach(el=>observer.observe(el));
}

function setupArchiveRecommendationTracking(brief,row){
  if(!("IntersectionObserver" in window))return;
  const timers=new Map();
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      const id=entry.target.dataset.storyId;
      if(entry.isIntersecting&&entry.intersectionRatio>=.6&&!timers.has(id)){
        timers.set(id,setTimeout(()=>{
          const story=(brief.stories||[]).find(s=>String(s.id)===String(id));
          if(story)recEvent("archive_revisit",story,{briefId:row.id,eventKey:`${row.id}:${id}:archive-revisit`}).catch(()=>{});
          observer.unobserve(entry.target);timers.delete(id);
        },5000));
      }else if(!entry.isIntersecting&&timers.has(id)){
        clearTimeout(timers.get(id));timers.delete(id);
      }
    }
  },{threshold:[.6]});
  document.querySelectorAll(".archive-story[data-story-id]").forEach(el=>observer.observe(el));
}
function learnFromSurvey(ratings,depth,missing){
  state.prefs.topicScores=state.prefs.topicScores||{};
  state.prefs.contentTypeScores=state.prefs.contentTypeScores||{};
  for(const story of state.brief.stories){
    const rating=Number(ratings[story.id]);
    if(!rating) continue;
    const delta=(rating-3)*4;
    const taxonomy=story.tags?.taxonomy||{};
    const affinitySignals=[
      ...((story.topics||[story.category]).filter(Boolean).map(x=>[x,1])),
      ...(taxonomy.domain?[[taxonomy.domain,.45]]:[]),
      ...(taxonomy.topic?[[taxonomy.topic,.8]]:[]),
      ...(taxonomy.subtopic?[[taxonomy.subtopic,1.15]]:[]),
      ...((story.tags?.themes||[]).map(x=>[x,.7])),
      ...((story.tags?.entities||[]).map(x=>[x,.45]))
    ];
    for(const [topic,weight] of affinitySignals){
      const key=String(topic).trim();
      if(!key) continue;
      state.prefs.topicScores[key]=clamp((state.prefs.topicScores[key]??50)+delta*weight);
    }
    const type=story.contentType||"news";
    state.prefs.contentTypeScores[type]=clamp((state.prefs.contentTypeScores[type]??50)+delta);
  }
  if(depth==="Too shallow") state.prefs.explanationBias=clamp((state.prefs.explanationBias||0)+3,-20,20);
  if(depth==="Too detailed") state.prefs.explanationBias=clamp((state.prefs.explanationBias||0)-3,-20,20);
  if(missing?.trim()){
    state.prefs.requestedTopics=[missing.trim(),...(state.prefs.requestedTopics||[])].slice(0,10);
  }

  return dbPost("preferences",{payload:state.prefs});
}


function chapterKey(seg){return seg?.storyId||seg?.kind||"intro";}

function chapterStarts(){
  const starts=[];
  let last=null;
  playback.segments.forEach((seg,i)=>{
    const key=chapterKey(seg);
    if(key!==last){
      starts.push({index:i,key,label:seg?.label||(
        key==="intro"?"Introduction":key==="outro"?"Closing":"Chapter"
      )});
      last=key;
    }
  });
  return starts;
}

function currentChapterStart(){
  const starts=chapterStarts();
  let current=0;
  for(const ch of starts){
    if(ch.index<=playback.index)current=ch.index;
    else break;
  }
  return current;
}

function playbackStatus(){
  if(state.audioGenerating&&!playback.segments.length)return "Preparing today's audio…";
  if(!playback.segments.length)return "Today's Neosis";
  const seg=playback.segments[playback.index]||playback.segments[0];
  return `${seg?.label||"Neosis"} · chapter ${chapterStarts().findIndex(x=>x.index===currentChapterStart())+1} of ${chapterStarts().length}`;
}

function rebuildChapterSelect(){
  const select=document.querySelector("#chapterSelect");
  if(!select)return;
  const starts=chapterStarts();
  const signature=starts.map(x=>`${x.index}:${x.label}`).join("|");
  if(select.dataset.signature!==signature){
    select.innerHTML=starts.map((ch,i)=>`<option value="${ch.index}">${i+1}. ${escapeHtml(ch.label)}</option>`).join("");
    select.dataset.signature=signature;
  }
  select.value=String(currentChapterStart());
}

function updatePlaybackUi(){
  const label=document.querySelector("#persistentAudioLabel");
  if(label)label.textContent=playbackStatus();
  const speed=document.querySelector("#audioSpeed");
  if(speed)speed.value=String(playback.speed);
  rebuildChapterSelect();

  const prev=document.querySelector("#prevChapterBtn");
  const next=document.querySelector("#nextChapterBtn");
  const starts=chapterStarts();
  const pos=starts.findIndex(x=>x.index===currentChapterStart());
  if(prev)prev.disabled=!starts.length||pos<=0;
  if(next)next.disabled=!starts.length||pos<0||pos>=starts.length-1;
}

function syncPersistentAudioDock(){
  const dock=document.querySelector("#persistentAudioDock");
  if(!dock)return;
  const visible=state.audioGenerating||playback.segments.length>0;
  dock.hidden=!visible;
  dock.classList.toggle("is-generating",state.audioGenerating&&!playback.segments.length);
  document.body.classList.toggle("has-persistent-audio",visible);

  const audio=document.querySelector("#briefAudio");
  const disabled=state.audioGenerating&&!playback.segments.length;
  if(audio)audio.classList.toggle("audio-disabled",disabled);
  ["prevChapterBtn","nextChapterBtn","chapterSelect","audioSpeed"].forEach(id=>{
    const el=document.querySelector("#"+id);
    if(el)el.disabled=disabled;
  });
  updatePlaybackUi();
}

async function generateAudioForCurrentBrief(){
  if(!state.briefDbId || (state.brief?.audio?.segments?.length&&Number(state.brief?.audio?.productionVersion||0)>=2)){
    setupBriefAudio();
    return;
  }
  state.audioGenerating=true;
  syncPersistentAudioDock();
  try{
    const r=await fetch("/api/generate-brief-audio",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({briefId:state.briefDbId})
    });
    const raw=await r.text();
    let data={};try{data=raw?JSON.parse(raw):{};}catch{data={error:raw||"Audio generation failed"};}
    if(!r.ok)throw new Error(data.error||"Audio generation failed");
    state.brief=data.brief||state.brief;
    setupBriefAudio();
  }catch(e){
    console.error("Neosis audio generation failed:",e);
  }finally{
    state.audioGenerating=false;
    syncPersistentAudioDock();
  }
}

function setupBriefAudio(){
  const audio=document.querySelector("#briefAudio");
  if(!audio)return;
  const segments=state.brief?.audio?.segments||[];
  if(!segments.length){syncPersistentAudioDock();return;}

  const key=String(state.briefDbId||state.brief?.date||"brief")+"|"+segments.map(s=>s.path).join("|");

  const chapterProgress=chapter=>{
    if(!chapter||chapter==="intro"||chapter==="outro")return null;
    const indexes=playback.segments.map((seg,i)=>chapterKey(seg)===chapter?i:-1).filter(i=>i>=0);
    if(!indexes.length||indexes.some(i=>!playback.durations[i]))return null;
    const total=indexes.reduce((s,i)=>s+playback.durations[i],0);
    const heard=indexes.reduce((s,i)=>s+Math.min(playback.listened[i],playback.durations[i]),0);
    return total>0?{total,heard,ratio:heard/total}:null;
  };
  const maybeCreditChapter=chapter=>{
    const progress=chapterProgress(chapter);
    if(!progress)return;
    const story=state.brief.stories.find(s=>String(s.id)===String(chapter));
    if(!story)return;
    for(const threshold of [.25,.5,.75,1]){
      if(progress.ratio>=threshold){
        recEvent("audio_progress",story,{value:threshold,eventKey:`${state.briefDbId}:${story.id}:audio:${threshold}`}).catch(()=>{});
      }
    }
    if(progress.ratio>=.75)creditStoryConsumption(story,3,"audio").catch(()=>{});
  };
  const maybeCreditSkip=chapter=>{
    const progress=chapterProgress(chapter);
    if(!progress||progress.ratio>=.15)return;
    const story=state.brief.stories.find(s=>String(s.id)===String(chapter));
    if(story)recEvent("quick_skip",story,{eventKey:`${state.briefDbId}:${story.id}:quick-skip`}).catch(()=>{});
  };

  const load=i=>{
    playback.index=Math.max(0,Math.min(playback.segments.length-1,i));
    const seg=playback.segments[playback.index];
    playback.lastTime=0;
    audio.src=`/api/brief-audio?path=${encodeURIComponent(seg.path)}`;
    audio.playbackRate=playback.speed;
    updatePlaybackUi();
  };

  const playLoaded=async()=>{try{await audio.play();}catch{}};

  if(playback.key!==key){
    playback.key=key;
    playback.segments=segments;
    playback.index=0;
    playback.seeking=false;
    playback.lastTime=0;
    playback.listened=Array(segments.length).fill(0);
    playback.durations=Array(segments.length).fill(0);

    if(!playback.initialized){
      audio.addEventListener("loadedmetadata",()=>{
        if(Number.isFinite(audio.duration)&&audio.duration>0)playback.durations[playback.index]=audio.duration;
        playback.lastTime=audio.currentTime||0;
        updatePlaybackUi();
      });
      audio.addEventListener("play",updatePlaybackUi);
      audio.addEventListener("pause",updatePlaybackUi);
      audio.addEventListener("seeking",()=>{playback.seeking=true;});
      audio.addEventListener("seeked",()=>{playback.seeking=false;playback.lastTime=audio.currentTime||0;});
      audio.addEventListener("timeupdate",()=>{
        const current=audio.currentTime||0,delta=current-playback.lastTime;
        if(!playback.seeking&&!audio.paused&&delta>0&&delta<3){
          playback.listened[playback.index]=Math.min(playback.durations[playback.index]||Infinity,playback.listened[playback.index]+delta);
        }
        playback.lastTime=current;
        maybeCreditChapter(chapterKey(playback.segments[playback.index]));
      });
      audio.addEventListener("ended",async()=>{
        if(playback.durations[playback.index])playback.listened[playback.index]=Math.max(playback.listened[playback.index],playback.durations[playback.index]);
        const finished=chapterKey(playback.segments[playback.index]),next=playback.index+1;
        const nextChapter=next<playback.segments.length?chapterKey(playback.segments[next]):null;
        if(nextChapter!==finished)maybeCreditChapter(finished);
        if(next<playback.segments.length){load(next);await playLoaded();}
        else updatePlaybackUi();
      });
      playback.initialized=true;
    }
    load(0);
  }else{
    playback.segments=segments;
  }

  const speed=document.querySelector("#audioSpeed");
  if(speed)speed.onchange=()=>{
    playback.speed=Number(speed.value||1);
    audio.playbackRate=playback.speed;
    updatePlaybackUi();
  };

  const chapterSelect=document.querySelector("#chapterSelect");
  if(chapterSelect)chapterSelect.onchange=async()=>{
    const current=chapterKey(playback.segments[playback.index]);
    maybeCreditChapter(current);maybeCreditSkip(current);
    load(Number(chapterSelect.value)||0);
    await playLoaded();
  };

  const prev=document.querySelector("#prevChapterBtn");
  if(prev)prev.onclick=async()=>{
    const starts=chapterStarts(),start=currentChapterStart(),pos=starts.findIndex(x=>x.index===start);
    if(pos>0){
      const current=chapterKey(playback.segments[playback.index]);maybeCreditChapter(current);maybeCreditSkip(current);
      load(starts[pos-1].index);
      await playLoaded();
    }
  };

  const next=document.querySelector("#nextChapterBtn");
  if(next)next.onclick=async()=>{
    const starts=chapterStarts(),start=currentChapterStart(),pos=starts.findIndex(x=>x.index===start);
    if(pos>=0&&pos<starts.length-1){
      const current=chapterKey(playback.segments[playback.index]);maybeCreditChapter(current);maybeCreditSkip(current);
      load(starts[pos+1].index);
      await playLoaded();
    }
  };

  syncPersistentAudioDock();
}

async function checkApi(){
  try{
    const r=await fetch("/api/generate-brief");
    const data=await r.json();
    state.api={configured:!!data.configured,model:data.model||null,loading:false,error:null,canRegenerate:data.canRegenerate!==false,unlimitedRegenerations:data.unlimitedRegenerations===true};
  }catch(e){
    state.api={configured:false,model:null,loading:false,error:"Could not reach generation API.",canRegenerate:false,unlimitedRegenerations:false};
  }
  if(state.view==="today") render();
}

function dailyHeadline(dateLabel=""){
  const warm=[
    ["Good morning.","Here’s what’s worth carrying with you today."],
    ["A little clearer, every day.","Here’s your thoughtful start to what matters."],
    ["Come curious.","A few things worth knowing, explained for you."],
    ["Start with what matters.","Your morning, made a little more interesting."],
    ["There’s always more to notice.","Here’s today’s world, shaped around you."],
    ["Make room for something new.","A considered mix for the day ahead."],
    ["Good things to know.","Stories, ideas, and context chosen for you."],
    ["Begin with curiosity.","Here’s something useful, something surprising, and what matters."],
    ["Your morning, with a little more meaning.","Settle in — today’s edition is ready."],
    ["A smarter start, gently.","Here’s what Neosis thinks deserves your attention."],
    ["Hello, curious mind.","Your daily mix of what matters and what’s interesting."],
    ["Take a few minutes for your world.","We picked the signal from the noise for you."],
    ["Something worth knowing is waiting.","Here’s your personal edition for today."],
    ["Let today make a little more sense.","Your briefing is ready when you are."]
  ];
  const d=new Date();
  const key=Number.isFinite(d.getTime())?Math.floor(new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime()/86400000):0;
  return warm[Math.abs(key)%warm.length];
}

function renderEmptyToday(){
  const apiReady=state.api.configured&&!state.api.loading;
  app.innerHTML=`
    <section class="empty-edition-shell">
      <div class="empty-edition-card">
        <div class="empty-edition-mark"><img src="/assets/neosis-icon.svg" alt=""></div>
        <div class="eyebrow">Your next edition</div>
        <h2>A fresh Neosis is on the way.</h2>
        <p>Your personalized stories refresh automatically at <strong>5:00 AM Central</strong> each morning. Your next scheduled edition will be ready tomorrow.</p>
        <div class="empty-edition-separator"><span>Want something today?</span></div>
        <button class="primary empty-refresh" id="emptyRefreshBtn" type="button" ${apiReady&&!state.briefGenerating?"":"disabled"}>${state.briefGenerating?"Building your edition…":"Refresh now"}</button>
        <div class="empty-edition-note" id="emptyRefreshStatus">${state.briefGenerating?"Neosis is researching and writing your stories. You can keep using the app while it works.":"Create a fresh edition now without changing tomorrow’s scheduled refresh."}</div>
      </div>
    </section>`;
  const btn=document.querySelector("#emptyRefreshBtn");
  if(btn&&!btn.disabled)btn.addEventListener("click",generateLiveBrief);
}
function renderToday(){
  if(!state.brief?.stories?.length){renderEmptyToday();return;}
  const [heroLine,heroSubline]=dailyHeadline(state.brief.date);
  const apiMessage=state.api.loading
    ? "Checking live generation…"
    : state.api.configured
      ? `Live · ${escapeHtml(state.api.model||"generation ready")}`
      : "Generation unavailable";

  const mix=state.prefs.mixTargets||{news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5};
  const mixSummary=[
    ["News",mix.news||0],
    ["Knowledge",mix.general_knowledge||0],
    ["Deep dives",mix.deep_dive||0]
  ];
  const leadStory=state.brief.stories?.[0];

  app.innerHTML=`
    <section class="today-hero" aria-label="Your daily edition">
      <div class="hero-topline">
        <div class="today-kicker"><span class="live-pip" aria-hidden="true"></span>${escapeHtml(state.brief.date)}</div>
        <div class="hero-meta">${state.brief.stories.length} stories <i aria-hidden="true"></i> ${escapeHtml(state.brief.readTime||"Daily edition")}</div>
      </div>
      <div class="hero-content">
        <div class="hero-label">A personal perspective, every morning</div>
        <h2><span class="hero-warm">${escapeHtml(heroLine)}</span><em>${escapeHtml(heroSubline)}</em></h2>
        <p class="hero-intro">${escapeHtml(state.brief.intro)}</p>
        <div class="hero-actions">
          <button class="hero-listen" type="button" id="heroListenBtn"><span class="hero-play" aria-hidden="true">▶</span><span><strong>Listen to your edition</strong><small>${escapeHtml(state.brief.readTime||"Audio edition")}</small></span></button>
          <button class="hero-scroll" type="button" id="heroReadBtn">Start reading <span aria-hidden="true">↓</span></button>
        </div>
      </div>
    </section>

    <div class="today-layout">
      <div class="today-main">
        <div class="section-heading-row" id="briefingStart">
          <div><div class="eyebrow">The daily edit</div><h3>Today's stories</h3></div>
          <div class="edition-tools">
            <button class="ghost compact" type="button" id="generateBtn" ${state.api.configured&&state.api.canRegenerate&&!state.briefGenerating?"":"disabled"}>${!state.api.configured?"Unavailable":state.briefGenerating?"Researching…":state.api.canRegenerate?(state.api.unlimitedRegenerations?"Refresh ↻":"Refresh"):"Refresh used"}</button>
          </div>
        </div>
        <span id="generateStatus" class="muted" role="status"></span>
        <div id="stories" class="story-stack"></div>

        <section class="panel feedback-card">
          <div class="eyebrow">A better brief, every day</div>
          <h2>Make Neosis yours.</h2>
          <p class="muted">A little more of what you enjoy, a little less of what you don’t. Neosis learns as you read and listen.</p>
          <button class="primary" id="feedbackTuneBtn">Tune your edition <span aria-hidden="true">↗</span></button>
        </section>
      </div>

      <aside class="today-sidebar">
        <section class="edition-index" aria-label="Stories in this edition">
          <div class="eyebrow">A look inside</div>
          <h3>In this edition</h3>
          <ol class="edition-index-list">
            ${state.brief.stories.map((story,i)=>`<li><button type="button" data-jump-story="${i+1}"><span class="num">${String(i+1).padStart(2,"0")}</span><span class="topic">${escapeHtml(story.title)}</span></button></li>`).join("")}
          </ol>
          <p class="edition-index-note">Curated for you. Updated every morning. Your preferences quietly shape what comes next.</p>
        </section>
      </aside>
    </div>`;

  document.querySelectorAll("[data-jump-story]").forEach(button=>button.addEventListener("click",()=>{
    document.querySelector("#story-"+button.dataset.jumpStory)?.scrollIntoView({behavior:"smooth",block:"start"});
  }));
  const holder=document.querySelector("#stories");
  state.brief.stories.forEach((story,i)=>{
    const node=document.querySelector("#story-template").content.cloneNode(true);
    const article=node.querySelector(".story-card");
    article.dataset.storyId=story.id;
    article.id=`story-${i+1}`;
    article.style.setProperty("--story-index",i);
    node.querySelector(".story-meta").innerHTML=`<span class="story-index">${String(i+1).padStart(2,"0")}</span><span>${escapeHtml(story.contentType?story.contentType.replace(/_/g," "):story.category)}</span><i></i><span>${escapeHtml(story.category)}</span>`;
    node.querySelector(".story-title").textContent=story.title;
    node.querySelector(".story-summary").textContent=story.summary;
    node.querySelector(".story-body").innerHTML=bodyHtml(story.body);
    node.querySelector(".story-sources").innerHTML="<span>Sources</span> "+(story.sources||[]).map(sourceHtml).join(" · ");
    node.querySelector(".teach-btn").innerHTML='<span>Go deeper</span><span>↗</span>';
    node.querySelector(".teach-btn").addEventListener("click",()=>createExplainer(story));
    const actions=node.querySelector(".story-actions");
    const feedback=document.createElement("div");
    feedback.className="story-preference";
    feedback.innerHTML='<span>Shape your feed</span><button type="button" data-rec="more" aria-label="More stories like this">↑ More</button><button type="button" data-rec="less" aria-label="Fewer stories like this">↓ Less</button>';
    feedback.querySelector('[data-rec="more"]').addEventListener("click",e=>{
      e.currentTarget.classList.add("selected");
      feedback.querySelectorAll('[data-rec="more"],[data-rec="less"]').forEach(b=>b.disabled=true);
      recEvent("more_like_this",story,{eventKey:`${state.briefDbId}:${story.id}:more-like-this`}).catch(()=>{});
    });
    feedback.querySelector('[data-rec="less"]').addEventListener("click",e=>{
      e.currentTarget.classList.add("selected");
      feedback.querySelectorAll('[data-rec="more"],[data-rec="less"]').forEach(b=>b.disabled=true);
      recEvent("less_like_this",story,{eventKey:`${state.briefDbId}:${story.id}:less-like-this`}).catch(()=>{});
    });
    actions.appendChild(feedback);
    holder.appendChild(node);
    article.querySelectorAll(".story-sources a").forEach((link,sourceIndex)=>link.addEventListener("click",()=>{
      recEvent("source_click",story,{eventKey:`${state.briefDbId}:${story.id}:source:${sourceIndex}`}).catch(()=>{});
    }));
  });

  const generateBtn=document.querySelector("#generateBtn");
  if(generateBtn&&!generateBtn.disabled) generateBtn.addEventListener("click",generateLiveBrief);

  const feedbackTuneBtn=document.querySelector("#feedbackTuneBtn");
  if(feedbackTuneBtn)feedbackTuneBtn.addEventListener("click",()=>{state.view="tune";render();});

  const openTune=document.querySelector("#openTuneView");
  if(openTune) openTune.addEventListener("click",()=>{state.view="tune";render();});

  const readBtn=document.querySelector("#heroReadBtn");
  if(readBtn)readBtn.addEventListener("click",()=>document.querySelector("#briefingStart")?.scrollIntoView({behavior:"smooth",block:"start"}));
  const listenBtn=document.querySelector("#heroListenBtn");
  if(listenBtn)listenBtn.addEventListener("click",()=>{
    const audio=document.querySelector("#briefAudio");
    if(audio&&playback.segments.length){
      document.querySelector("#persistentAudioDock")?.scrollIntoView({behavior:"smooth",block:"end"});
      setTimeout(()=>audio.play().catch(()=>{}),250);
    }else if(state.audioGenerating){
      syncPersistentAudioDock();
    }else if(state.briefDbId){
      generateAudioForCurrentBrief();
    }
  });

  const quickTuneForm=document.querySelector("#quickTuneForm");
  if(quickTuneForm) quickTuneForm.addEventListener("submit",async e=>{
    e.preventDefault();
    const input=document.querySelector("#quickTuneInput");
    const btn=document.querySelector("#quickTuneSubmit");
    const status=document.querySelector("#quickTuneStatus");
    const message=input.value.trim();
    if(!message) return;
    btn.disabled=true;
    btn.innerHTML="<span>Tuning…</span><span>✦</span>";
    status.textContent="Interpreting your request…";
    try{
      const data=await applyTuneMessage(message);
      input.value="";
      status.textContent=data.assistant||"Updated. Tomorrow’s brief will reflect this.";
      btn.innerHTML="<span>Updated</span><span>✓</span>";
      setTimeout(()=>{if(document.body.contains(btn)){btn.disabled=false;btn.innerHTML="<span>Update my Neosis</span><span>→</span>";}},1400);
    }catch(err){
      btn.disabled=false;
      btn.innerHTML="<span>Update my Neosis</span><span>→</span>";
      status.textContent=err.message;
    }
  });

  setupStoryReadTracking();
  setupBriefAudio();
}

async function generateLiveBrief(){
  const btn=document.querySelector("#generateBtn")||document.querySelector("#emptyRefreshBtn");
  const status=document.querySelector("#generateStatus")||document.querySelector("#emptyRefreshStatus");
  state.briefGenerating=true;
  if(btn){btn.disabled=true;btn.textContent="Building your edition…";}
  if(status)status.textContent=" Neosis is researching and writing your stories. You can keep using the app while it works.";
  if(state.view==="today"&&!state.brief?.stories?.length)renderEmptyToday();
  try{
    const r=await fetch("/api/generate-brief",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({preferences:state.prefs,knowledge:state.knowledge,coverage:state.coverage.slice(0,20)})
    });
    const raw=await r.text();
    let data={};
    try{data=raw?JSON.parse(raw):{};}
    catch{data={error:raw||"Generation failed"};}
    if(!r.ok) throw new Error(data.error||"Generation failed");

    if(state.brief?.stories?.length){
      state.coverage.unshift({
        date:state.brief.date,
        stories:state.brief.stories.map(s=>({title:s.title,category:s.category,summary:s.summary,tags:s.tags||null}))
      });
      state.coverage=state.coverage.slice(0,14);

      dbPost("coverage",{payload:state.coverage[0]}).catch(()=>{});
    }

    state.brief=data.brief;

    state.briefDbId=data.briefId||null;
    state.api.canRegenerate=state.api.unlimitedRegenerations===true;
    state.briefGenerating=false;
    if(state.view==="today")renderToday();
    if(state.briefDbId)await generateAudioForCurrentBrief();
  }catch(e){
    state.briefGenerating=false;
    if(state.view==="today"){
      const liveBtn=document.querySelector("#generateBtn"),liveStatus=document.querySelector("#generateStatus");
      if(liveBtn){liveBtn.disabled=false;liveBtn.textContent=state.api.unlimitedRegenerations?"Refresh edition ∞":"↻ Regenerate once today";}
      if(liveStatus)liveStatus.textContent=` ${e.message}`;
    }
  }
}

async function createExplainer(story){
  recEvent("deep_dive",story,{eventKey:`${state.briefDbId||state.brief?.date}:${story.id}:deep-dive`}).catch(()=>{});
  const existing=state.explainers.find(x=>String(x.storyId)===String(story.id));
  if(existing){state.libraryFocus=String(existing.id||existing.storyId);state.view="explainers";render();return;}
  const button=[...document.querySelectorAll(".teach-btn")].find(b=>b.closest(".story-card")?.querySelector(".story-title")?.textContent===story.title);
  if(button){button.disabled=true;button.textContent="Creating deep dive…";}
  try{
    const r=await fetch("/api/generate-explainer",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({story,knowledge:state.knowledge})
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Explainer generation failed");
    const explainer={
      id:Date.now(),
      storyId:story.id,
      title:data.explainer.title,
      created:new Date().toLocaleDateString(),
      createdAt:new Date().toISOString(),
      category:story.tags?.taxonomy?.domain||story.category||story.topics?.[0]||"General",
      taxonomy:story.tags?.taxonomy||null,
      originalStoryTitle:story.title,
      body:data.explainer.body,
      takeaway:data.explainer.takeaway,
      sources:data.explainer.sources||[],
      concepts:data.explainer.conceptsCovered||conceptNames(story)
    };
    state.explainers.unshift(explainer);
    state.libraryFocus=String(explainer.id);

    dbPost("explainers",{story_id:story.id,payload:explainer}).catch(()=>{});
    state.view="explainers";
    render();
  }catch(e){
    if(button){button.disabled=false;button.textContent="Deep dive";}
    alert(e.message);
  }
}


async function finishBrief(){
  const btn=document.querySelector("#surveyBtn");
  const original=btn.textContent;
  btn.disabled=true;
  btn.textContent="Sending survey email…";
  try{
    const r=await fetch("/api/send-survey-email",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({briefDate:state.brief.date})
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Could not send survey email");
    btn.textContent="Survey email sent";
  }catch(e){
    btn.disabled=false;
    btn.textContent=original;
    alert(e.message);
  }
}

function archiveDateValue(x){
  const raw=x?.payload?.date||x?.briefDate||x?.createdAt||"";
  const t=Date.parse(raw);
  return Number.isFinite(t)?t:0;
}
function renderArchive(){
  const briefs=[...state.archivedBriefs].sort((a,b)=>archiveDateValue(b)-archiveDateValue(a));
  app.innerHTML=`
    <section class="hero archive-hero">
      <div class="eyebrow">Your history</div>
      <h2>Archive</h2>
      <p>Every saved Neosis edition, ready to revisit. Open any day to read the complete briefing exactly as it was saved.</p>
    </section>
    <section class="archive-grid">
      ${briefs.length?briefs.map((row,i)=>{
        const b=row.payload||{},stories=b.stories||[],first=stories[0];
        return `
          <button class="archive-card" type="button" data-archive-id="${escapeHtml(String(row.id))}">
            <div class="archive-card-top">
              <span class="archive-date">${escapeHtml(b.date||row.briefDate||"Saved edition")}</span>
              <span class="archive-count">${stories.length} stor${stories.length===1?"y":"ies"}</span>
            </div>
            <h3>${escapeHtml(first?.title||"Neosis daily edition")}</h3>
            <p>${escapeHtml(first?.summary||b.intro||"Open this edition to read the full briefing.")}</p>
            <div class="archive-card-foot">
              <span>${escapeHtml(b.readTime||"Daily brief")}</span>
              <span>Read edition ↗</span>
            </div>
          </button>`;
      }).join(""):'<div class="panel"><p class="muted">No saved editions yet.</p></div>'}
    </section>`;

  document.querySelectorAll(".archive-card").forEach(card=>card.addEventListener("click",()=>{
    const row=state.archivedBriefs.find(x=>String(x.id)===String(card.dataset.archiveId));
    if(row)renderArchivedBrief(row);
  }));
}

function renderArchivedBrief(row){
  const brief=row.payload||{};
  app.innerHTML=`
    <button class="archive-back" type="button" id="archiveBack">← Back to Archive</button>
    <section class="archive-reader-hero">
      <div class="archive-reader-meta">
        <span>${escapeHtml(brief.date||row.briefDate||"Saved edition")}</span>
        <i></i>
        <span>${escapeHtml(brief.readTime||"Daily brief")}</span>
      </div>
      <div class="eyebrow">Past edition</div>
      <h2>${escapeHtml(brief.date||"Neosis")}</h2>
      <p>${escapeHtml(brief.intro||"A saved Neosis edition.")}</p>
    </section>
    <div class="archive-reader-list">
      ${(brief.stories||[]).map((story,i)=>`
        <article class="story-card archive-story" data-story-id="${escapeHtml(String(story.id))}">
          <div class="story-accent" aria-hidden="true"></div>
          <div class="story-meta"><span class="story-index">${String(i+1).padStart(2,"0")}</span><span>${escapeHtml(story.contentType?story.contentType.replace(/_/g," "):story.category||"Story")}</span><i></i><span>${escapeHtml(story.category||"Neosis")}</span></div>
          <h2 class="story-title">${escapeHtml(story.title||"Untitled story")}</h2>
          <p class="story-summary">${escapeHtml(story.summary||"")}</p>
          <div class="story-body">${bodyHtml(story.body||"")}</div>
          ${story.sources?.length?`<div class="story-sources"><span>Sources</span> ${story.sources.map(sourceHtml).join(" · ")}</div>`:""}
        </article>`).join("")||'<div class="panel"><p class="muted">This saved edition has no stories.</p></div>'}
    </div>`;

  document.querySelector("#archiveBack")?.addEventListener("click",renderArchive);
  setupArchiveRecommendationTracking(brief,row);
  document.querySelectorAll(".archive-story").forEach(article=>{
    const story=(brief.stories||[]).find(s=>String(s.id)===String(article.dataset.storyId));
    article.querySelectorAll(".story-sources a").forEach((link,sourceIndex)=>link.addEventListener("click",()=>{
      if(story)recEvent("source_click",story,{briefId:row.id,eventKey:`${row.id}:${story.id}:archive-source:${sourceIndex}`}).catch(()=>{});
    }));
  });
}

function libraryTopic(x){
  return String(x.category||x.taxonomy?.domain||x.concepts?.[0]||"General").trim()||"General";
}
function libraryDateValue(x){
  const raw=x.createdAt||x.created||"";
  const t=Date.parse(raw);
  return Number.isFinite(t)?t:0;
}
function renderExplainers(){
  const all=[...state.explainers];
  const topics=[...new Set(all.map(libraryTopic))].sort((a,b)=>a.localeCompare(b));
  app.innerHTML=`
    <section class="hero library-hero">
      <div class="eyebrow">Saved learning</div>
      <h2>Library</h2>
      <p>Your Deep Dives live here as a reference library. Search by idea, filter by topic, and open only what you need. Creating a Deep Dive still does not change what Neosis selects for future editions.</p>
    </section>
    ${all.length?`
      <section class="library-toolbar panel">
        <div class="library-search field">
          <label for="librarySearch">Find a Deep Dive</label>
          <input id="librarySearch" type="search" placeholder="Search titles, topics, concepts, or takeaways…" autocomplete="off">
        </div>
        <div class="field">
          <label for="libraryTopic">Topic</label>
          <select id="libraryTopic">
            <option value="">All topics</option>
            ${topics.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="librarySort">Sort</label>
          <select id="librarySort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="topic">Topic A–Z</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>
      </section>
      <div class="library-count" id="libraryCount"></div>
      <div id="libraryResults"></div>
    `:`<div class="panel library-empty"><h3>No Deep Dives yet</h3><p class="muted">Open Today and choose <strong>Deep dive</strong> on a story you want to understand more deeply. It will be saved here for later.</p></div>`}
  `;

  if(!all.length)return;

  const search=document.querySelector("#librarySearch");
  const topic=document.querySelector("#libraryTopic");
  const sort=document.querySelector("#librarySort");
  const results=document.querySelector("#libraryResults");
  const count=document.querySelector("#libraryCount");

  const renderResults=()=>{
    const q=search.value.trim().toLowerCase();
    const selectedTopic=topic.value;
    const order=sort.value;
    let items=all.filter(x=>{
      const t=libraryTopic(x);
      if(selectedTopic&&t!==selectedTopic)return false;
      if(!q)return true;
      const hay=[x.title,x.originalStoryTitle,t,x.takeaway,...(x.concepts||[])].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });

    items.sort((a,b)=>{
      if(order==="oldest")return libraryDateValue(a)-libraryDateValue(b);
      if(order==="topic")return libraryTopic(a).localeCompare(libraryTopic(b))||String(a.title||"").localeCompare(String(b.title||""));
      if(order==="title")return String(a.title||"").localeCompare(String(b.title||""));
      return libraryDateValue(b)-libraryDateValue(a);
    });

    count.textContent=`${items.length} Deep Dive${items.length===1?"":"s"}${selectedTopic?` · ${selectedTopic}`:""}`;

    if(!items.length){
      results.innerHTML='<div class="panel library-empty"><strong>No matches</strong><p class="muted">Try a broader search or choose a different topic.</p></div>';
      return;
    }

    const grouped=order==="topic";
    if(grouped){
      const groups=new Map();
      items.forEach(x=>{const t=libraryTopic(x);if(!groups.has(t))groups.set(t,[]);groups.get(t).push(x);});
      results.innerHTML=[...groups.entries()].map(([label,group])=>`
        <section class="library-group">
          <div class="library-group-heading"><h3>${escapeHtml(label)}</h3><span>${group.length}</span></div>
          <div class="library-list">${group.map(libraryCardHtml).join("")}</div>
        </section>
      `).join("");
    }else{
      results.innerHTML=`<div class="library-list">${items.map(libraryCardHtml).join("")}</div>`;
    }

    if(state.libraryFocus){
      const el=document.querySelector(`details[data-library-id="${CSS.escape(String(state.libraryFocus))}"]`);
      if(el){el.open=true;setTimeout(()=>el.scrollIntoView({behavior:"smooth",block:"center"}),50);}
      state.libraryFocus=null;
    }
  };

  search.addEventListener("input",renderResults);
  topic.addEventListener("change",renderResults);
  sort.addEventListener("change",renderResults);
  renderResults();
}
function libraryCardHtml(x){
  const id=String(x.id||x.storyId||x.title);
  const topic=libraryTopic(x);
  const concepts=(x.concepts||[]).slice(0,4);
  const date=x.created||((x.createdAt&&new Date(x.createdAt).toLocaleDateString())||"");
  return `
    <details class="library-card" data-library-id="${escapeHtml(id)}">
      <summary>
        <div class="library-card-main">
          <div class="library-card-meta"><span class="library-topic">${escapeHtml(topic)}</span>${date?`<span>${escapeHtml(date)}</span>`:""}</div>
          <h3>${escapeHtml(x.title||"Untitled Deep Dive")}</h3>
          ${x.takeaway?`<p>${escapeHtml(x.takeaway)}</p>`:""}
          ${concepts.length?`<div class="library-tags">${concepts.map(c=>`<span>${escapeHtml(c)}</span>`).join("")}</div>`:""}
        </div>
        <span class="library-open-label">Open</span>
      </summary>
      <div class="library-card-content">
        ${x.originalStoryTitle?`<div class="library-origin"><span>From</span> ${escapeHtml(x.originalStoryTitle)}</div>`:""}
        <div class="story-body">${bodyHtml(x.body)}</div>
        ${x.takeaway?`<div class="library-takeaway"><strong>Key takeaway</strong><p>${escapeHtml(x.takeaway)}</p></div>`:""}
        ${x.sources?.length?`<div class="story-sources">Sources: ${x.sources.map(sourceHtml).join(" · ")}</div>`:""}
        <div class="ratings"><button class="ghost" onclick="markUnderstood('${escapeHtml(String(x.storyId))}',true)">That made sense</button><button class="ghost" onclick="markUnderstood('${escapeHtml(String(x.storyId))}',false)">Still confused</button></div>
      </div>
    </details>`;
}

window.markUnderstood=function(storyId,understood){
  const explainer=state.explainers.find(x=>String(x.storyId)===String(storyId));
  const concepts=explainer?.concepts||[];
  const eventKey=`${state.briefDbId||state.brief?.date||"library"}:${storyId}:explainer-feedback`;
  bumpKnowledge(concepts,understood?8:1,eventKey).catch(()=>{});
  alert(understood?"Got it — future explanations can assume a little more here.":"Got it — future explanations will start more gently on these concepts.");
};

function renderKnowledge(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">What the system thinks you know</div><h2>Knowledge graph</h2><p>This is independent from your interest profile. You can care deeply about a topic while still wanting beginner-level explanations.</p></section><section class="panel">${state.knowledge.map(k=>`<div class="knowledge-row"><div><strong>${escapeHtml(k.topic)}</strong></div><div class="bar"><span style="width:${k.score}%"></span></div><div>${k.score}%</div></div>`).join("")}</section>`;
}

async function applyTuneMessage(message){
  const r=await fetch("/api/tune-briefline",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message,preferences:state.prefs,knowledge:state.knowledge})
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Could not update Neosis");
  state.prefs=data.preferences;
  state.knowledge=data.knowledge;

  await Promise.all([
    dbPost("preferences",{payload:state.prefs}),
    dbPost("knowledge",{payload:state.knowledge})
  ]);
  return data;
}

async function rebuildTuning(){
  const briefByDate=new Map(state.archivedBriefs.map(x=>[String(x.payload?.date||x.briefDate||""),x.payload]));
  const surveyEvents=state.surveys.map(row=>({
    id:row.id,
    createdAt:row.created_at,
    payload:row.payload||{},
    stories:briefByDate.get(String(row.brief_date||""))?.stories||[]
  }));
  const r=await fetch("/api/tune-briefline",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      action:"rebuild",
      history:state.prefs.tuningHistory||[],
      surveys:surveyEvents,
      knowledge:state.knowledge,
      preferences:state.prefs
    })
  });
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"Could not rebuild tuning");
  state.prefs=data.preferences;
  state.knowledge=data.knowledge;
  await Promise.all([
    dbPost("preferences",{payload:state.prefs}),
    dbPost("knowledge",{payload:state.knowledge})
  ]);
}
function tuneDate(v){
  try{return new Date(v).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch{return"";}
}
function surveySummary(row){
  const p=row.payload||{},ratings=Object.values(p.ratings||{}).map(Number).filter(Boolean);
  const avg=ratings.length?(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1):null;
  const bits=[];
  if(avg)bits.push(`Average story rating ${avg}/5`);
  if(p.depth)bits.push(`Depth: ${p.depth}`);
  if(String(p.missing||"").trim())bits.push(`Requested: ${p.missing.trim()}`);
  return bits.join(" · ")||"Survey feedback";
}
async function deleteTuneInstruction(at,button){
  if(!confirm("Delete this tuning instruction and remove its influence from future editions?"))return;
  button.disabled=true;button.textContent="Removing…";
  try{
    state.prefs.tuningHistory=(state.prefs.tuningHistory||[]).filter(x=>String(x.at)!==String(at));
    await rebuildTuning();
    renderTune();
  }catch(e){button.disabled=false;button.textContent="Delete";alert(e.message);}
}
async function deleteSurveyTuning(id,button){
  if(!confirm("Delete this survey feedback and remove its tuning influence from future editions?"))return;
  button.disabled=true;button.textContent="Removing…";
  try{
    await dbDelete("surveys",id);
    state.surveys=state.surveys.filter(x=>String(x.id)!==String(id));
    await rebuildTuning();
    renderTune();
  }catch(e){button.disabled=false;button.textContent="Delete";alert(e.message);}
}
function renderTune(){
  const history=(state.prefs.tuningHistory||[]).slice().reverse();
  const mix=state.prefs.mixTargets||{news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5};
  const labels={news:"News",general_knowledge:"General knowledge",deep_dive:"Deep dives",history:"History",science:"Science",business_case:"Business cases"};
  const learned=Object.values(state.prefs.behavioralInterest?.features||{})
    .map(x=>{
      const longTerm=Number(x.longTerm??50),recent=Number(x.recent??50),confidence=Number(x.confidence||0);
      return {...x,score:longTerm*.7+recent*.3,confidence};
    })
    .filter(x=>x.label&&x.confidence>=8&&["domain","topic","subtopic","theme","entity","format"].includes(x.kind))
    .sort((a,b)=>(Math.abs(b.score-50)*(b.confidence/100))-(Math.abs(a.score-50)*(a.confidence/100)))
    .slice(0,12);

  app.innerHTML=`
    <section class="hero">
      <div class="eyebrow">Your personalization</div>
      <h2>Tune Neosis</h2>
      <p>Neosis learns mostly from what you actually read, listen to, skip, revisit, and explore. Direct instructions here always outrank passive behavior.</p>
    </section>

    <section class="panel learned-profile">
      <div class="tuning-ledger-head">
        <div><div class="section-label">What Neosis has learned</div><h3>Your emerging interest map</h3></div>
        <span class="tuning-count">${learned.length} signal${learned.length===1?"":"s"}</span>
      </div>
      <p class="muted">These are behavioral inferences, not permanent settings. Confidence rises gradually, recent interests fade over time, and one skip never changes your profile much.</p>
      <div class="learned-grid">
        ${learned.length?learned.map(x=>{
          const direction=x.score>=53?"More interested":x.score<=47?"Less interested":"Still learning";
          const strength=Math.round(Math.abs(x.score-50)*2);
          return `<article class="learned-item">
            <div class="learned-item-top"><span class="learned-kind">${escapeHtml(x.kind||"interest")}</span><span>${Math.round(x.confidence)}% confidence</span></div>
            <strong>${escapeHtml(x.label)}</strong>
            <div class="learned-meter"><i style="width:${Math.max(5,Math.min(100,strength))}%"></i></div>
            <div class="learned-item-foot"><span>${direction}</span><button type="button" class="learned-correct" data-label="${escapeHtml(x.label)}">Correct</button></div>
          </article>`;
        }).join(""):'<div class="tuning-empty"><strong>Still getting to know you.</strong><p>Read, listen, skip, revisit, or use More/Less on stories and this map will begin to form.</p></div>'}
      </div>
    </section>

    <section class="panel">
      <div class="section-label">Current story mix</div>
      <div class="mix-grid">
        ${Object.entries(mix).map(([k,v])=>`<div class="knowledge-row"><div><strong>${escapeHtml(labels[k]||k)}</strong></div><div class="bar"><span style="width:${Number(v)||0}%"></span></div><div>${Number(v)||0}%</div></div>`).join("")}
      </div>
      <p class="muted">These are approximate presentation targets. Explicit recurring instructions can override the learned mix.</p>
    </section>

    <section class="panel tune-compose">
      <div class="section-label">Talk to Neosis</div>
      <form id="tuneForm">
        <div class="field"><label for="tuneInput">What should change?</label><textarea id="tuneInput" rows="5" placeholder="More robotics. Less politics. Give me a full U.S. market recap every morning. I’m not actually interested in celebrity news."></textarea></div>
        <button class="primary" id="tuneSubmit" type="submit">Update Neosis</button>
        <span id="tuneStatus" class="muted"></span>
      </form>
    </section>

    <section class="panel tuning-ledger">
      <div class="tuning-ledger-head">
        <div><div class="section-label">Direct instructions</div><h3>What you’ve explicitly told Neosis</h3></div>
        <span class="tuning-count">${history.length} instruction${history.length===1?"":"s"}</span>
      </div>
      <p class="muted">These are stronger than passive behavior. Delete an instruction whenever you no longer want it shaping future editions.</p>
      <div class="tuning-ledger-list">
        ${history.length?history.map(x=>`<article class="tuning-event">
          <div class="tuning-event-icon chat">✦</div>
          <div class="tuning-event-body">
            <div class="tuning-event-meta"><span>Direct instruction</span><time>${escapeHtml(tuneDate(x.at))}</time></div>
            <strong>${escapeHtml(x.user)}</strong>
            <p>${escapeHtml(x.assistant||"Neosis updated your preferences.")}</p>
          </div>
          <button class="tuning-delete" type="button" data-kind="chat" data-key="${escapeHtml(x.at||"")}">Delete</button>
        </article>`).join(""):'<div class="tuning-empty"><strong>No direct instructions yet.</strong><p>Use natural language above whenever you want to steer Neosis deliberately.</p></div>'}
      </div>
    </section>`;

  document.querySelector("#tuneForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const input=document.querySelector("#tuneInput");
    const btn=document.querySelector("#tuneSubmit");
    const status=document.querySelector("#tuneStatus");
    const message=input.value.trim();
    if(!message)return;
    btn.disabled=true;btn.textContent="Updating…";status.textContent=" Interpreting your preferences.";
    try{await applyTuneMessage(message);renderTune();}
    catch(err){btn.disabled=false;btn.textContent="Update Neosis";status.textContent=" "+err.message;}
  });

  document.querySelectorAll(".tuning-delete[data-kind='chat']").forEach(btn=>btn.addEventListener("click",()=>deleteTuneInstruction(btn.dataset.key,btn)));
  document.querySelectorAll(".learned-correct").forEach(btn=>btn.addEventListener("click",()=>{
    const input=document.querySelector("#tuneInput");
    input.value=`My activity may suggest I’m interested in ${btn.dataset.label}, but that’s not accurate. Reduce how much this affects recommendations.`;
    input.focus();
    input.scrollIntoView({behavior:"smooth",block:"center"});
  }));
}

function renderSurvey(){
  state.view="survey";setActive();
  app.innerHTML=`<a class="back-link" href="#" id="backToday">← Back to brief</a><section class="hero"><div class="eyebrow">Post-brief survey</div><h2>How was today's brief?</h2><p>Your answers tune future story selection slowly so one bad story doesn't erase an entire topic.</p></section><form id="surveyForm" class="panel">${state.brief.stories.map((s,i)=>`<div class="survey-row"><strong>${i+1}. ${escapeHtml(s.title)}</strong><div class="ratings" data-story="${s.id}">${[1,2,3,4,5].map(n=>`<button type="button" class="rating-btn" data-rating="${n}">${n}</button>`).join("")}</div></div>`).join("")}<div class="field"><label>Overall depth</label><select name="depth"><option>Too shallow</option><option selected>About right</option><option>Too detailed</option></select></div><div class="field"><label>Did anything feel repetitive?</label><textarea name="repeat" rows="3"></textarea></div><div class="field"><label>What did you wish was covered?</label><textarea name="missing" rows="3"></textarea></div><button class="primary" type="submit">Submit feedback</button></form>`;
  document.querySelector("#backToday").addEventListener("click",e=>{e.preventDefault();state.view="today";render();});
  document.querySelectorAll(".rating-btn").forEach(btn=>btn.addEventListener("click",()=>{btn.parentElement.querySelectorAll(".rating-btn").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");}));
  document.querySelector("#surveyForm").addEventListener("submit",e=>{e.preventDefault();const ratings={};document.querySelectorAll(".ratings[data-story]").forEach(g=>{const selected=g.querySelector(".rating-btn.selected");if(selected)ratings[g.dataset.story]=Number(selected.dataset.rating);});const payload={ratings,depth:e.target.depth.value,repeat:e.target.repeat.value,missing:e.target.missing.value};dbPost("surveys",{brief_date:state.brief.date,payload}).catch(()=>{});learnFromSurvey(ratings,payload.depth,payload.missing).catch(()=>{});e.target.innerHTML='<div class="success"><strong>Thanks.</strong><p>Your feedback will shape future topic and content selection.</p></div>';});
}

render();
hydrateFromDatabase();
checkApi();

