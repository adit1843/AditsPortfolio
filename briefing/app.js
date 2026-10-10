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
  knowledge:JSON.parse(localStorage.getItem("dailyBriefKnowledge")||"null")||[
    {topic:"AI infrastructure",score:82},{topic:"Data-center cooling",score:88},{topic:"Networking",score:58},{topic:"Treasury markets",score:42},{topic:"Federal Reserve",score:67},{topic:"Robotics commercialization",score:73}
  ],
  prefs:JSON.parse(localStorage.getItem("dailyBriefPrefs")||"null")||{generalNews:40,technicalDepth:"medium-high",politics:"important-only",markets:true},
  coverage:JSON.parse(localStorage.getItem("dailyBriefCoverage")||"[]"),
  api:{configured:false,model:null,loading:true,error:null}
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
    if(briefs[0]?.payload) state.brief=briefs[0].payload;
    if(explainers.length) state.explainers=explainers.map(x=>x.payload);
    if(preferences[0]?.payload) state.prefs=preferences[0].payload;
    if(knowledge[0]?.payload) state.knowledge=knowledge[0].payload;
    if(coverage.length) state.coverage=coverage.map(x=>x.payload);
    render();
  }catch(e){
    console.warn("Database hydration skipped:",e.message);
  }
}

const app=document.querySelector("#app");
document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{state.view=btn.dataset.view;render();}));

function setActive(){document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));}
function render(){setActive(); ({today:renderToday,archive:renderArchive,explainers:renderExplainers,knowledge:renderKnowledge,preferences:renderPreferences}[state.view]||renderToday)();}
function escapeHtml(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function sourceHtml(s){
  if(typeof s==="string") return `<span>${escapeHtml(s)}</span>`;
  if(s&&s.url) return `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name||s.url)}</a>`;
  return `<span>${escapeHtml(s?.name||"Source")}</span>`;
}
function bodyHtml(text=""){return escapeHtml(text).split(/\n\s*\n|\n/).filter(Boolean).map(p=>`<p>${p}</p>`).join("");}

async function checkApi(){
  try{
    const r=await fetch("/api/generate-brief");
    const data=await r.json();
    state.api={configured:!!data.configured,model:data.model||null,loading:false,error:null};
  }catch(e){
    state.api={configured:false,model:null,loading:false,error:"Could not reach generation API."};
  }
  if(state.view==="today") renderToday();
}

function renderToday(){
  const apiMessage=state.api.loading
    ? "Checking live generation setup…"
    : state.api.configured
      ? `Live generation ready · ${escapeHtml(state.api.model||"model configured")}`
      : "Demo mode · add OPENAI_API_KEY in Vercel to enable live current-news generation";

  app.innerHTML=`
    <section class="hero">
      <div class="eyebrow">${escapeHtml(state.brief.date)} · ${escapeHtml(state.brief.readTime)}</div>
      <h2>What matters today.</h2>
      <p>${escapeHtml(state.brief.intro)}</p>
    </section>
    <section class="panel">
      <div class="eyebrow">Generation status</div>
      <h2>${state.api.configured?"Live briefing is connected":"Prototype is in demo mode"}</h2>
      <p class="muted">${apiMessage}</p>
      <button class="primary" id="generateBtn" ${state.api.configured?"":"disabled"}>${state.api.configured?"Generate today's live brief":"Live generation not configured"}</button>
      <span id="generateStatus" class="muted"></span>
    </section>
    <div id="stories"></div>
    <section class="panel">
      <div class="section-label">After you finish</div>
      <h2>Help tomorrow's brief get better</h2>
      <p class="muted">The survey is intentionally separate from the reading experience.</p>
      <button class="primary" id="surveyBtn">I'm finished — send survey email</button>
    </section>`;

  const holder=document.querySelector("#stories");
  state.brief.stories.forEach((story,i)=>{
    const node=document.querySelector("#story-template").content.cloneNode(true);
    node.querySelector(".story-meta").textContent=`${story.category} · ${i+1} of ${state.brief.stories.length}`;
    node.querySelector(".story-title").textContent=story.title;
    node.querySelector(".story-summary").textContent=story.summary;
    node.querySelector(".story-body").innerHTML=bodyHtml(story.body);
    node.querySelector(".story-sources").innerHTML="Sources: "+(story.sources||[]).map(sourceHtml).join(" · ");
    node.querySelector(".teach-btn").addEventListener("click",()=>createExplainer(story));
    holder.appendChild(node);
  });
  document.querySelector("#surveyBtn").addEventListener("click",finishBrief);
  const generateBtn=document.querySelector("#generateBtn");
  if(generateBtn&&!generateBtn.disabled) generateBtn.addEventListener("click",generateLiveBrief);
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
    dbPost("briefs",{brief_date:state.brief.date,payload:state.brief}).catch(()=>{});
    renderToday();
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
      sources:data.explainer.sources||[]
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
  const topic=state.brief.stories.find(s=>s.id===storyId)?.category;
  let k=state.knowledge.find(x=>x.topic===topic);
  if(!k){k={topic,score:35};state.knowledge.push(k);}
  k.score=Math.max(0,Math.min(100,k.score+(understood?6:-5)));
  localStorage.setItem("dailyBriefKnowledge",JSON.stringify(state.knowledge));
  dbPost("knowledge",{payload:state.knowledge}).catch(()=>{});
  alert(understood?"Knowledge confidence updated.":"Got it — confidence lowered so future explanations can start earlier.");
};

function renderKnowledge(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">What the system thinks you know</div><h2>Knowledge graph</h2><p>This is independent from your interest profile. You can care deeply about a topic while still wanting beginner-level explanations.</p></section><section class="panel">${state.knowledge.map(k=>`<div class="knowledge-row"><div><strong>${escapeHtml(k.topic)}</strong></div><div class="bar"><span style="width:${k.score}%"></span></div><div>${k.score}%</div></div>`).join("")}</section>`;
}

function renderPreferences(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">Interest profile</div><h2>Preferences</h2><p>These settings influence topic selection; explainer requests do not.</p></section><section class="panel"><div class="field"><label>General-news share</label><input id="generalNews" type="range" min="10" max="80" value="${state.prefs.generalNews}"><div class="muted"><span id="generalNewsVal">${state.prefs.generalNews}</span>% of the brief</div></div><div class="field"><label>Technical depth</label><select id="depth"><option>medium</option><option>medium-high</option><option>high</option></select></div><div class="field"><label>Politics coverage</label><select id="politics"><option value="important-only">Only when important</option><option value="routine">Routine coverage</option><option value="minimal">Minimal</option></select></div><button class="primary" id="savePrefs">Save preferences</button></section>`;
  document.querySelector("#depth").value=state.prefs.technicalDepth;document.querySelector("#politics").value=state.prefs.politics;
  document.querySelector("#generalNews").addEventListener("input",e=>document.querySelector("#generalNewsVal").textContent=e.target.value);
  document.querySelector("#savePrefs").addEventListener("click",()=>{state.prefs.generalNews=+document.querySelector("#generalNews").value;state.prefs.technicalDepth=document.querySelector("#depth").value;state.prefs.politics=document.querySelector("#politics").value;localStorage.setItem("dailyBriefPrefs",JSON.stringify(state.prefs));dbPost("preferences",{payload:state.prefs}).catch(()=>{});alert("Preferences saved.");});
}

function renderSurvey(){
  state.view="survey";setActive();
  app.innerHTML=`<a class="back-link" href="#" id="backToday">← Back to brief</a><section class="hero"><div class="eyebrow">Post-brief survey</div><h2>How was today's brief?</h2><p>Your answers tune future story selection slowly so one bad story doesn't erase an entire topic.</p></section><form id="surveyForm" class="panel">${state.brief.stories.map((s,i)=>`<div class="survey-row"><strong>${i+1}. ${escapeHtml(s.title)}</strong><div class="ratings" data-story="${s.id}">${[1,2,3,4,5].map(n=>`<button type="button" class="rating-btn" data-rating="${n}">${n}</button>`).join("")}</div></div>`).join("")}<div class="field"><label>Overall depth</label><select name="depth"><option>Too shallow</option><option selected>About right</option><option>Too detailed</option></select></div><div class="field"><label>Did anything feel repetitive?</label><textarea name="repeat" rows="3"></textarea></div><div class="field"><label>What did you wish was covered?</label><textarea name="missing" rows="3"></textarea></div><button class="primary" type="submit">Submit feedback</button></form>`;
  document.querySelector("#backToday").addEventListener("click",e=>{e.preventDefault();state.view="today";render();});
  document.querySelectorAll(".rating-btn").forEach(btn=>btn.addEventListener("click",()=>{btn.parentElement.querySelectorAll(".rating-btn").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");}));
  document.querySelector("#surveyForm").addEventListener("submit",e=>{e.preventDefault();localStorage.setItem("dailyBriefLastSurvey",new Date().toISOString());const ratings={};document.querySelectorAll(".ratings[data-story]").forEach(g=>{const selected=g.querySelector(".rating-btn.selected");if(selected)ratings[g.dataset.story]=Number(selected.dataset.rating);});dbPost("surveys",{brief_date:state.brief.date,payload:{ratings,depth:e.target.depth.value,repeat:e.target.repeat.value,missing:e.target.missing.value}}).catch(()=>{});e.target.innerHTML='<div class="success"><strong>Thanks.</strong><p>Your feedback was saved locally in this prototype.</p></div>';});
}

render();
checkApi();
hydrateFromDatabase();
if(new URLSearchParams(location.search).get("survey")==="1") setTimeout(renderSurvey,250);
