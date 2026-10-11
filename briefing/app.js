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
  brief:JSON.parse(localStorage.getItem("dailyBriefCurrent")||"null")||demoBrief,
  explainers:JSON.parse(localStorage.getItem("dailyBriefExplainers")||"[]"),
  knowledge:{concepts:{},seenEvents:{}},
  prefs:JSON.parse(localStorage.getItem("dailyBriefPrefs")||"null")||{
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
  coverage:JSON.parse(localStorage.getItem("dailyBriefCoverage")||"[]"),
  api:{configured:false,model:null,loading:true,error:null},
  hydrating:true,
  dbError:null,
  briefDbId:null,
  audioGenerating:false
};


async function dbGet(resource){
  const r=await fetch(`/api/data?resource=${encodeURIComponent(resource)}`);
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Database read failed");
  return data.data||[];
}
async function dbPost(resource,payload){
  const r=await fetch(`/api/data?resource=${encodeURIComponent(resource)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Database write failed");
  return data.data;
}
async function hydrateFromDatabase(){
  try{
    const [briefs,explainers,preferences,knowledge,coverage]=await Promise.all([
      dbGet("briefs"),dbGet("explainers"),dbGet("preferences"),dbGet("knowledge"),dbGet("coverage")
    ]);
    const params=new URLSearchParams(location.search);
    const requestedBrief=params.get("brief");
    const requestedDate=params.get("date");

    if(briefs.length){
      const match=requestedBrief
        ? briefs.find(x=>String(x.id)===String(requestedBrief))
        : requestedDate
          ? briefs.find(x=>x.brief_date===requestedDate || x.payload?.date===requestedDate)
          : briefs[0];
      if(match?.payload){state.brief=match.payload;state.briefDbId=match.id;}
      else {state.brief=briefs[0].payload;state.briefDbId=briefs[0].id;}
    }else{
      state.brief=demoBrief;
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
    state.dbError=null;
  }catch(e){
    state.dbError=e.message;
  }finally{
    state.hydrating=false;
    render();
    if(new URLSearchParams(location.search).get("survey")==="1") renderSurvey();
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
  if(!state.briefDbId || !("IntersectionObserver" in window)) return;
  const timers=new Map();
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){
      const id=entry.target.dataset.storyId;
      if(entry.isIntersecting && entry.intersectionRatio>=0.6){
        if(!timers.has(id)){
          timers.set(id,setTimeout(()=>{
            const story=state.brief.stories.find(s=>String(s.id)===String(id));
            if(story) creditStoryConsumption(story,2,"read").catch(()=>{});
            observer.unobserve(entry.target);
            timers.delete(id);
          },7000));
        }
      }else if(timers.has(id)){
        clearTimeout(timers.get(id));
        timers.delete(id);
      }
    }
  },{threshold:[0.6]});
  document.querySelectorAll(".story-card[data-story-id]").forEach(el=>observer.observe(el));
}
function learnFromSurvey(ratings,depth,missing){
  state.prefs.topicScores=state.prefs.topicScores||{};
  state.prefs.contentTypeScores=state.prefs.contentTypeScores||{};
  for(const story of state.brief.stories){
    const rating=Number(ratings[story.id]);
    if(!rating) continue;
    const delta=(rating-3)*4;
    for(const topic of (story.topics||[story.category]).filter(Boolean)){
      const key=String(topic).trim();
      state.prefs.topicScores[key]=clamp((state.prefs.topicScores[key]??50)+delta);
    }
    const type=story.contentType||"news";
    state.prefs.contentTypeScores[type]=clamp((state.prefs.contentTypeScores[type]??50)+delta);
  }
  if(depth==="Too shallow") state.prefs.explanationBias=clamp((state.prefs.explanationBias||0)+3,-20,20);
  if(depth==="Too detailed") state.prefs.explanationBias=clamp((state.prefs.explanationBias||0)-3,-20,20);
  if(missing?.trim()){
    state.prefs.requestedTopics=[missing.trim(),...(state.prefs.requestedTopics||[])].slice(0,10);
  }
  localStorage.setItem("dailyBriefPrefs",JSON.stringify(state.prefs));
  return dbPost("preferences",{payload:state.prefs});
}


function audioPanelHtml(){
  const segments=state.brief?.audio?.segments||[];
  if(!segments.length){
    if(!state.audioGenerating) return "";
    return `
      <section class="panel" id="audioBrief">
        <div class="eyebrow">Audio edition</div>
        <h2>Preparing today's audio…</h2>
        <p class="muted">Neosis is generating and caching the spoken edition automatically.</p>
      </section>`;
  }
  return `
    <section class="panel" id="audioBrief">
      <div class="eyebrow">Produced audio edition</div>
      <h2>Listen to today's Neosis</h2>
      <p class="muted" id="audioNow">Ready · ${segments.length} produced segments · music & transitions enabled</p>
      <audio id="briefAudio" controls preload="metadata" style="width:100%"></audio>
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-top:12px">
        <div class="field" style="max-width:180px;margin:0">
          <label for="audioSpeed">Playback speed</label>
          <select id="audioSpeed">
            <option value="1">1×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
            <option value="1.75">1.75×</option>
            <option value="2">2×</option>
          </select>
        </div>
        <button class="ghost" id="nextChapterBtn" type="button">Next chapter →</button>
      </div>
    </section>`;
}

async function generateAudioForCurrentBrief(){
  if(!state.briefDbId || state.brief?.audio?.segments?.length) return;
  state.audioGenerating=true;
  renderToday();
  try{
    const r=await fetch("/api/generate-brief-audio",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({briefId:state.briefDbId})
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Audio generation failed");
    state.brief=data.brief||state.brief;
    localStorage.setItem("dailyBriefCurrent",JSON.stringify(state.brief));
  }catch(e){
    console.error("Neosis audio generation failed:",e);
  }finally{
    state.audioGenerating=false;
    renderToday();
  }
}

function setupBriefAudio(){
  const audio=document.querySelector("#briefAudio");
  if(!audio) return;
  const segments=state.brief?.audio?.segments||[];
  let index=0;
  let seeking=false;
  let lastTime=0;
  let audioCtx=null;
  let mediaSource=null;
  let voiceGain=null;
  let bedGain=null;
  let introStingPlayed=false;
  let transitionBusy=false;
  let introBedTimer=null;
  const listened=Array(segments.length).fill(0);
  const durations=Array(segments.length).fill(0);
  const now=document.querySelector("#audioNow");
  const speed=document.querySelector("#audioSpeed");

  const chapterKey=seg=>seg?.storyId||seg?.kind||"intro";
  const chapterIndexes=chapter=>segments.map((seg,i)=>chapterKey(seg)===chapter?i:-1).filter(i=>i>=0);

  const ensureAudioGraph=()=>{
    if(audioCtx) return audioCtx;
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;
    if(!AudioContextClass) return null;
    audioCtx=new AudioContextClass();
    mediaSource=audioCtx.createMediaElementSource(audio);
    voiceGain=audioCtx.createGain();
    bedGain=audioCtx.createGain();
    voiceGain.gain.value=1;
    bedGain.gain.value=0;
    mediaSource.connect(voiceGain).connect(audioCtx.destination);
    bedGain.connect(audioCtx.destination);
    return audioCtx;
  };

  const tone=(frequency,start,duration,volume=.025,type="sine")=>{
    const ctx=ensureAudioGraph();
    if(!ctx) return;
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(frequency,start);
    gain.gain.setValueAtTime(0.0001,start);
    gain.gain.exponentialRampToValueAtTime(volume,start+.06);
    gain.gain.exponentialRampToValueAtTime(0.0001,start+duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start+duration+.03);
  };

  const playSonicLogo=async()=>{
    const ctx=ensureAudioGraph();
    if(!ctx) return;
    if(ctx.state==="suspended") await ctx.resume();
    const t=ctx.currentTime+.03;
    tone(440,t,.7,.018);
    tone(554.37,t+.22,.78,.016);
    tone(659.25,t+.48,.9,.014);
    tone(880,t+.74,.65,.009);
    await new Promise(resolve=>setTimeout(resolve,1550));
  };

  const playTransition=async(kind="story")=>{
    const ctx=ensureAudioGraph();
    if(!ctx) return;
    if(ctx.state==="suspended") await ctx.resume();
    const t=ctx.currentTime+.02;
    if(kind==="outro"){
      tone(659.25,t,.38,.011);
      tone(554.37,t+.14,.48,.009);
    }else{
      tone(523.25,t,.32,.010);
      tone(659.25,t+.12,.42,.008);
    }
    await new Promise(resolve=>setTimeout(resolve,420));
  };

  const startIntroBed=()=>{
    const ctx=ensureAudioGraph();
    if(!ctx||!bedGain) return;
    const t=ctx.currentTime;
    bedGain.gain.cancelScheduledValues(t);
    bedGain.gain.setValueAtTime(.0001,t);
    bedGain.gain.exponentialRampToValueAtTime(.009,t+.6);

    const freqs=[110,164.81,220];
    freqs.forEach((frequency,i)=>{
      const osc=ctx.createOscillator();
      const g=ctx.createGain();
      osc.type=i===0?"sine":"triangle";
      osc.frequency.value=frequency;
      g.gain.value=i===0?.55:.18;
      osc.connect(g).connect(bedGain);
      osc.start();
      setTimeout(()=>{try{osc.stop();}catch{}},14500);
    });

    introBedTimer=setTimeout(()=>{
      const tt=ctx.currentTime;
      bedGain.gain.cancelScheduledValues(tt);
      bedGain.gain.setValueAtTime(Math.max(.0001,bedGain.gain.value),tt);
      bedGain.gain.exponentialRampToValueAtTime(.0001,tt+2.4);
    },10000);
  };

  const maybeCreditChapter=chapter=>{
    if(!chapter || chapter==="intro" || chapter==="outro") return;
    const indexes=chapterIndexes(chapter);
    if(!indexes.length || indexes.some(i=>!durations[i])) return;
    const total=indexes.reduce((sum,i)=>sum+durations[i],0);
    const heard=indexes.reduce((sum,i)=>sum+Math.min(listened[i],durations[i]),0);
    if(total>0 && heard/total>=0.75){
      const story=state.brief.stories.find(s=>String(s.id)===String(chapter));
      if(story) creditStoryConsumption(story,3,"audio").catch(()=>{});
    }
  };

  const load=i=>{
    index=Math.max(0,Math.min(segments.length-1,i));
    const seg=segments[index];
    lastTime=0;
    audio.src=`/api/brief-audio?path=${encodeURIComponent(seg.path)}`;
    audio.playbackRate=Number(speed?.value||1);
    if(now) now.textContent=`Now playing ${index+1} of ${segments.length} · ${seg.label||"Neosis"}`;
  };

  const playLoaded=async()=>{
    try{
      const ctx=ensureAudioGraph();
      if(ctx?.state==="suspended") await ctx.resume();
      await audio.play();
    }catch{}
  };

  load(0);

  audio.addEventListener("play",async()=>{
    const ctx=ensureAudioGraph();
    if(ctx?.state==="suspended") await ctx.resume();
    if(index===0 && !introStingPlayed && audio.currentTime<.4 && !transitionBusy){
      introStingPlayed=true;
      transitionBusy=true;
      audio.pause();
      if(now) now.textContent="Neosis · starting today’s edition…";
      await playSonicLogo();
      startIntroBed();
      transitionBusy=false;
      await playLoaded();
    }
  });

  audio.addEventListener("loadedmetadata",()=>{
    if(Number.isFinite(audio.duration)&&audio.duration>0) durations[index]=audio.duration;
    lastTime=audio.currentTime||0;
  });
  audio.addEventListener("seeking",()=>{seeking=true;});
  audio.addEventListener("seeked",()=>{
    seeking=false;
    lastTime=audio.currentTime||0;
  });
  audio.addEventListener("timeupdate",()=>{
    const current=audio.currentTime||0;
    const delta=current-lastTime;
    if(!seeking && !audio.paused && delta>0 && delta<3){
      listened[index]=Math.min((durations[index]||Infinity),listened[index]+delta);
    }
    lastTime=current;
  });
  audio.addEventListener("ended",async()=>{
    if(durations[index]) listened[index]=Math.max(listened[index],durations[index]);
    const finishedChapter=chapterKey(segments[index]);
    const nextIndex=index+1;
    const nextChapter=nextIndex<segments.length?chapterKey(segments[nextIndex]):null;
    if(nextChapter!==finishedChapter) maybeCreditChapter(finishedChapter);

    if(nextIndex<segments.length){
      if(nextChapter!==finishedChapter){
        if(now) now.textContent="Transitioning…";
        await playTransition(nextChapter==="outro"?"outro":"story");
      }
      load(nextIndex);
      await playLoaded();
    }else if(now){
      await playSonicLogo();
      now.textContent="Finished today's Neosis.";
    }
  });

  if(speed) speed.addEventListener("change",()=>{audio.playbackRate=Number(speed.value||1);});

  const nextChapter=document.querySelector("#nextChapterBtn");
  if(nextChapter) nextChapter.addEventListener("click",async()=>{
    const currentChapter=chapterKey(segments[index]);
    maybeCreditChapter(currentChapter);
    let next=index+1;
    while(next<segments.length && chapterKey(segments[next])===currentChapter) next++;
    if(next<segments.length){
      await playTransition(chapterKey(segments[next])==="outro"?"outro":"story");
      load(next);
      await playLoaded();
    }else{
      if(now) now.textContent="Finished today's Neosis.";
      audio.pause();
    }
  });

  window.addEventListener("beforeunload",()=>{
    if(introBedTimer) clearTimeout(introBedTimer);
    try{audioCtx?.close();}catch{}
  },{once:true});
}

async function checkApi(){
  try{
    const r=await fetch("/api/generate-brief");
    const data=await r.json();
    state.api={configured:!!data.configured,model:data.model||null,loading:false,error:null};
  }catch(e){
    state.api={configured:false,model:null,loading:false,error:"Could not reach generation API."};
  }
  if(state.view==="today") render();
}

function renderToday(){
  const apiMessage=state.api.loading
    ? "Checking live generation setup…"
    : state.api.configured
      ? `Live generation ready · ${escapeHtml(state.api.model||"model configured")}`
      : "Live generation is not configured";

  const mix=state.prefs.mixTargets||{news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5};
  const mixSummary=[
    ["News",mix.news||0],
    ["GK",mix.general_knowledge||0],
    ["Deep dives",mix.deep_dive||0]
  ];

  app.innerHTML=`
    <section class="today-hero">
      <div class="today-kicker">${escapeHtml(state.brief.date)} <span>•</span> ${escapeHtml(state.brief.readTime)}</div>
      <div class="today-hero-grid">
        <div>
          <h2>Your world,<br><em>in context.</em></h2>
          <p>${escapeHtml(state.brief.intro)}</p>
        </div>
        <div class="edition-card">
          <div class="edition-label">Today’s edition</div>
          <div class="edition-stat"><strong>${state.brief.stories.length}</strong><span>stories</span></div>
          <div class="edition-stat"><strong>${escapeHtml(state.brief.readTime||"—")}</strong><span>read</span></div>
          <div class="edition-status">${state.api.configured?"● Live":"○ Demo"}</div>
        </div>
      </div>
    </section>

    ${audioPanelHtml()}

    <div class="today-layout">
      <div class="today-main">
        <div class="section-heading-row">
          <div>
            <div class="eyebrow">Today’s briefing</div>
            <h3>Stories selected for you</h3>
          </div>
          <button class="ghost compact" id="generateBtn" ${state.api.configured?"":"disabled"}>${state.api.configured?"↻ Regenerate":"Unavailable"}</button>
        </div>
        <span id="generateStatus" class="muted"></span>
        <div id="stories"></div>

        <section class="panel feedback-card">
          <div class="eyebrow">Feedback loop</div>
          <h2>Make tomorrow better.</h2>
          <p class="muted">Rate today’s stories so Neosis can learn what deserves more space, less space, or a different level of depth.</p>
          <button class="primary" id="surveyBtn">Take today’s survey</button>
        </section>
      </div>

      <aside class="today-sidebar">
        <section class="tune-card">
          <div class="tune-icon">✦</div>
          <div class="eyebrow">Personalize</div>
          <h3>Tune My Neosis</h3>
          <p>Tell Neosis what you want more of, less of, or explained differently.</p>

          <form id="quickTuneForm">
            <textarea id="quickTuneInput" rows="5" placeholder="More science and history. Less routine market news. Explain finance with less jargon."></textarea>
            <button class="primary wide" id="quickTuneSubmit" type="submit">Tune Neosis</button>
            <div id="quickTuneStatus" class="tune-status"></div>
          </form>

          <div class="mix-mini">
            <div class="mix-mini-title">Current mix</div>
            ${mixSummary.map(([label,value])=>`
              <div class="mix-mini-row">
                <span>${label}</span>
                <div class="mix-mini-track"><i style="width:${Number(value)||0}%"></i></div>
                <b>${Number(value)||0}%</b>
              </div>`).join("")}
          </div>
          <button class="text-link" id="openTuneView" type="button">Open full tuning history →</button>
        </section>

        <section class="side-note">
          <div class="eyebrow">Generation</div>
          <p>${apiMessage}</p>
        </section>
      </aside>
    </div>`;

  const holder=document.querySelector("#stories");
  state.brief.stories.forEach((story,i)=>{
    const node=document.querySelector("#story-template").content.cloneNode(true);
    node.querySelector(".story-meta").textContent=`${story.contentType?story.contentType.replace(/_/g," ")+" · ":""}${story.category} · ${String(i+1).padStart(2,"0")}`;
    node.querySelector(".story-title").textContent=story.title;
    node.querySelector(".story-summary").textContent=story.summary;
    node.querySelector(".story-body").innerHTML=bodyHtml(story.body);
    node.querySelector(".story-sources").innerHTML="Sources: "+(story.sources||[]).map(sourceHtml).join(" · ");
    node.querySelector(".teach-btn").addEventListener("click",()=>createExplainer(story));
    const article=node.querySelector(".story-card");
    article.dataset.storyId=story.id;
    holder.appendChild(node);
  });

  const generateBtn=document.querySelector("#generateBtn");
  if(generateBtn&&!generateBtn.disabled) generateBtn.addEventListener("click",generateLiveBrief);

  const surveyBtn=document.querySelector("#surveyBtn");
  if(surveyBtn) surveyBtn.addEventListener("click",renderSurvey);

  const openTune=document.querySelector("#openTuneView");
  if(openTune) openTune.addEventListener("click",()=>{state.view="tune";render();});

  const quickTuneForm=document.querySelector("#quickTuneForm");
  if(quickTuneForm) quickTuneForm.addEventListener("submit",async e=>{
    e.preventDefault();
    const input=document.querySelector("#quickTuneInput");
    const btn=document.querySelector("#quickTuneSubmit");
    const status=document.querySelector("#quickTuneStatus");
    const message=input.value.trim();
    if(!message) return;
    btn.disabled=true;
    btn.textContent="Tuning…";
    status.textContent="Interpreting your request…";
    try{
      const data=await applyTuneMessage(message);
      input.value="";
      status.textContent=data.assistant||"Updated. Tomorrow’s brief will reflect this.";
      btn.textContent="Updated ✓";
      setTimeout(()=>{if(document.body.contains(btn)){btn.disabled=false;btn.textContent="Tune Neosis";}},1400);
    }catch(err){
      btn.disabled=false;
      btn.textContent="Tune Neosis";
      status.textContent=err.message;
    }
  });

  setupStoryReadTracking();
  setupBriefAudio();
}

async function generateLiveBrief(){
  const btn=document.querySelector("#generateBtn");
  const status=document.querySelector("#generateStatus");
  btn.disabled=true; btn.textContent="Researching today…"; status.textContent=" This can take a little while.";
  try{
    const r=await fetch("/api/generate-brief",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({preferences:state.prefs,knowledge:state.knowledge,coverage:state.coverage.slice(0,20)})
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Generation failed");

    if(state.brief!==demoBrief&&state.brief?.stories?.length){
      state.coverage.unshift({
        date:state.brief.date,
        stories:state.brief.stories.map(s=>({title:s.title,category:s.category,summary:s.summary}))
      });
      state.coverage=state.coverage.slice(0,14);
      localStorage.setItem("dailyBriefCoverage",JSON.stringify(state.coverage));
      dbPost("coverage",{payload:state.coverage[0]}).catch(()=>{});
    }

    state.brief=data.brief;
    localStorage.setItem("dailyBriefCurrent",JSON.stringify(state.brief));
    const saved=await dbPost("briefs",{brief_date:state.brief.date,payload:state.brief});
    state.briefDbId=saved?.[0]?.id||null;
    renderToday();
    if(state.briefDbId) await generateAudioForCurrentBrief();
  }catch(e){
    btn.disabled=false; btn.textContent="Generate today's live brief";
    status.textContent=` ${e.message}`;
  }
}

async function createExplainer(story){
  const existing=state.explainers.find(x=>x.storyId===story.id);
  if(existing){state.view="explainers";render();return;}
  const button=[...document.querySelectorAll(".teach-btn")].find(b=>b.closest(".story-card")?.querySelector(".story-title")?.textContent===story.title);
  if(button){button.disabled=true;button.textContent="Creating explainer…";}
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
      body:data.explainer.body,
      takeaway:data.explainer.takeaway,
      sources:data.explainer.sources||[],
      concepts:data.explainer.conceptsCovered||conceptNames(story)
    };
    state.explainers.unshift(explainer);
    localStorage.setItem("dailyBriefExplainers",JSON.stringify(state.explainers));
    dbPost("explainers",{story_id:story.id,payload:explainer}).catch(()=>{});
    state.view="explainers";
    render();
  }catch(e){
    if(button){button.disabled=false;button.textContent="Teach me more";}
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

function renderArchive(){
  const current=`<div class="panel"><strong>${escapeHtml(state.brief.date)}</strong><p class="muted">Current brief · ${state.brief.stories.length} stories</p></div>`;
  const past=state.coverage.map(x=>`<div class="panel"><strong>${escapeHtml(x.date)}</strong><p class="muted">${x.stories.length} stories remembered for future continuity</p></div>`).join("");
  app.innerHTML=`<section class="hero"><div class="eyebrow">Coverage memory</div><h2>Archive</h2><p>Previous editions become editorial memory so new briefs can reference what you already heard without repeating it.</p></section>${current}${past||'<div class="panel"><p class="muted">No prior generated editions yet.</p></div>'}`;
}

function renderExplainers(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">On-demand learning</div><h2>Explainers</h2><p>These are separate from story selection. Asking to learn more never pushes a topic into tomorrow's briefing.</p></section>`+(state.explainers.length?state.explainers.map(x=>`<article class="panel"><div class="eyebrow">${escapeHtml(x.created)}</div><h2>${escapeHtml(x.title)}</h2><div class="story-body">${bodyHtml(x.body)}</div>${x.takeaway?`<div class="panel"><strong>Key takeaway</strong><p>${escapeHtml(x.takeaway)}</p></div>`:""}${x.sources?.length?`<div class="story-sources">Sources: ${x.sources.map(sourceHtml).join(" · ")}</div>`:""}<div class="ratings"><button class="ghost" onclick="markUnderstood('${x.storyId}',true)">That made sense</button><button class="ghost" onclick="markUnderstood('${x.storyId}',false)">Still confused</button></div></article>`).join(""):`<div class="panel"><p class="muted">No explainers yet. Open Today and choose “Teach me more.”</p></div>`);
}

window.markUnderstood=function(storyId,understood){
  const explainer=state.explainers.find(x=>String(x.storyId)===String(storyId));
  const concepts=explainer?.concepts||[];
  const eventKey=`${state.briefDbId||state.brief.date}:${storyId}:explainer-feedback`;
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
  localStorage.setItem("dailyBriefPrefs",JSON.stringify(state.prefs));
  await Promise.all([
    dbPost("preferences",{payload:state.prefs}),
    dbPost("knowledge",{payload:state.knowledge})
  ]);
  return data;
}

function renderTune(){
  const history=(state.prefs.tuningHistory||[]).slice(-12);
  const mix=state.prefs.mixTargets||{news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5};
  const labels={news:"News",general_knowledge:"General knowledge",deep_dive:"Deep dives",history:"History",science:"Science",business_case:"Business cases"};
  app.innerHTML=`
    <section class="hero">
      <div class="eyebrow">Generation controls</div>
      <h2>Tune Neosis</h2>
      <p>Tell Neosis what you like, dislike, understand, want explained differently, or how you want the daily mix changed. It will translate that into the hidden interest and knowledge models.</p>
    </section>
    <section class="panel">
      <div class="section-label">Current story mix</div>
      <div class="mix-grid">
        ${Object.entries(mix).map(([k,v])=>`<div class="knowledge-row"><div><strong>${escapeHtml(labels[k]||k)}</strong></div><div class="bar"><span style="width:${Number(v)||0}%"></span></div><div>${Number(v)||0}%</div></div>`).join("")}
      </div>
      <p class="muted">These are approximate targets. Neosis can still override them when a major story deserves coverage.</p>
    </section>
    <section class="panel">
      <div class="section-label">Talk to Neosis</div>
      <div id="tuneHistory">${history.length?history.map(x=>`
        <div class="tune-message user"><strong>You</strong><p>${escapeHtml(x.user)}</p></div>
        <div class="tune-message assistant"><strong>Neosis</strong><p>${escapeHtml(x.assistant)}</p></div>
      `).join(""):'<p class="muted">Try: “Less market news, more science and history. I understand basic data-center cooling, but networking terms still lose me. Use less jargon in finance stories.”</p>'}</div>
      <form id="tuneForm">
        <div class="field"><label for="tuneInput">What should change?</label><textarea id="tuneInput" rows="5" placeholder="Tell Neosis what you want more or less of, what you already understand, or how explanations should feel."></textarea></div>
        <button class="primary" id="tuneSubmit" type="submit">Update Neosis</button>
        <span id="tuneStatus" class="muted"></span>
      </form>
    </section>`;

  document.querySelector("#tuneForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const input=document.querySelector("#tuneInput");
    const btn=document.querySelector("#tuneSubmit");
    const status=document.querySelector("#tuneStatus");
    const message=input.value.trim();
    if(!message) return;
    btn.disabled=true;btn.textContent="Updating…";status.textContent=" Interpreting your preferences.";
    try{
      await applyTuneMessage(message);
      renderTune();
    }catch(err){
      btn.disabled=false;btn.textContent="Update Neosis";status.textContent=" "+err.message;
    }
  });
}

function renderSurvey(){
  state.view="survey";setActive();
  app.innerHTML=`<a class="back-link" href="#" id="backToday">← Back to brief</a><section class="hero"><div class="eyebrow">Post-brief survey</div><h2>How was today's brief?</h2><p>Your answers tune future story selection slowly so one bad story doesn't erase an entire topic.</p></section><form id="surveyForm" class="panel">${state.brief.stories.map((s,i)=>`<div class="survey-row"><strong>${i+1}. ${escapeHtml(s.title)}</strong><div class="ratings" data-story="${s.id}">${[1,2,3,4,5].map(n=>`<button type="button" class="rating-btn" data-rating="${n}">${n}</button>`).join("")}</div></div>`).join("")}<div class="field"><label>Overall depth</label><select name="depth"><option>Too shallow</option><option selected>About right</option><option>Too detailed</option></select></div><div class="field"><label>Did anything feel repetitive?</label><textarea name="repeat" rows="3"></textarea></div><div class="field"><label>What did you wish was covered?</label><textarea name="missing" rows="3"></textarea></div><button class="primary" type="submit">Submit feedback</button></form>`;
  document.querySelector("#backToday").addEventListener("click",e=>{e.preventDefault();state.view="today";render();});
  document.querySelectorAll(".rating-btn").forEach(btn=>btn.addEventListener("click",()=>{btn.parentElement.querySelectorAll(".rating-btn").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");}));
  document.querySelector("#surveyForm").addEventListener("submit",e=>{e.preventDefault();localStorage.setItem("dailyBriefLastSurvey",new Date().toISOString());const ratings={};document.querySelectorAll(".ratings[data-story]").forEach(g=>{const selected=g.querySelector(".rating-btn.selected");if(selected)ratings[g.dataset.story]=Number(selected.dataset.rating);});const payload={ratings,depth:e.target.depth.value,repeat:e.target.repeat.value,missing:e.target.missing.value};dbPost("surveys",{brief_date:state.brief.date,payload}).catch(()=>{});learnFromSurvey(ratings,payload.depth,payload.missing).catch(()=>{});e.target.innerHTML='<div class="success"><strong>Thanks.</strong><p>Your feedback will shape future topic and content selection.</p></div>';});
}

render();
hydrateFromDatabase();
checkApi();

