const state={
  view:"today",
  brief:{
    date:"October 10, 2026",
    readTime:"~18 min",
    intro:"A personalized current-events brief designed to remember what you already know, avoid stale repetition, and keep important stories in view.",
    stories:[
      {id:"ai-infra",category:"AI infrastructure",title:"AI infrastructure spending remains the story behind the story",summary:"The important question is shifting from whether hyperscalers are spending heavily to where bottlenecks move next.",body:"Yesterday's coverage focused on demand. Today's angle is different: capital intensity is now forcing investors and operators to care much more about power availability, networking, deployment speed, and utilization. That means the next constraint may not be GPUs alone. For someone following data-center engineering, the second-order effects are arguably more important than headline model launches.",sources:["Reuters","Company filings"]},
      {id:"rates",category:"Economy",title:"Markets are repricing the path of interest rates",summary:"Recent labor and inflation data are changing how investors think about the pace of future policy moves.",body:"Rather than repeating a basic Fed explainer, this brief assumes you already understand the rate-setting process. The useful question today is how changes in expected policy transmit into Treasury yields, financing conditions, and company investment decisions.",sources:["Federal Reserve","Reuters"]},
      {id:"robotics",category:"Robotics",title:"Robotics funding is getting more selective",summary:"Capital is still available, but investors appear to be rewarding credible deployment economics over broad autonomy narratives.",body:"This matters because the commercial bar is moving toward measurable labor savings, reliability, serviceability, and integration cost. That favors teams that can prove value in a narrow workflow before expanding into generalized systems.",sources:["Company announcements","Industry reporting"]}
    ]
  },
  explainers:JSON.parse(localStorage.getItem("dailyBriefExplainers")||"[]"),
  knowledge:JSON.parse(localStorage.getItem("dailyBriefKnowledge")||"null")||[
    {topic:"AI infrastructure",score:82},{topic:"Data-center cooling",score:88},{topic:"Networking",score:58},{topic:"Treasury markets",score:42},{topic:"Federal Reserve",score:67},{topic:"Robotics commercialization",score:73}
  ],
  prefs:JSON.parse(localStorage.getItem("dailyBriefPrefs")||"null")||{generalNews:40,technicalDepth:"medium-high",politics:"important-only",markets:true}
};

const app=document.querySelector("#app");
document.querySelectorAll(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{state.view=btn.dataset.view;render();}));

function setActive(){document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));}
function render(){setActive(); ({today:renderToday,archive:renderArchive,explainers:renderExplainers,knowledge:renderKnowledge,preferences:renderPreferences}[state.view]||renderToday)();}

function renderToday(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">${state.brief.date} · ${state.brief.readTime}</div><h2>What matters today.</h2><p>${state.brief.intro}</p></section><div id="stories"></div><section class="panel"><div class="section-label">After you finish</div><h2>Help tomorrow's brief get better</h2><p class="muted">The survey is intentionally separate from the reading experience.</p><button class="primary" id="surveyBtn">Take today's survey</button></section>`;
  const holder=document.querySelector("#stories");
  state.brief.stories.forEach((story,i)=>{
    const node=document.querySelector("#story-template").content.cloneNode(true);
    node.querySelector(".story-meta").textContent=`${story.category} · ${i+1} of ${state.brief.stories.length}`;
    node.querySelector(".story-title").textContent=story.title;
    node.querySelector(".story-summary").textContent=story.summary;
    node.querySelector(".story-body").textContent=story.body;
    node.querySelector(".story-sources").innerHTML="Sources: "+story.sources.map(s=>`<span>${s}</span>`).join(" · ");
    node.querySelector(".teach-btn").addEventListener("click",()=>createExplainer(story));
    holder.appendChild(node);
  });
  document.querySelector("#surveyBtn").addEventListener("click",renderSurvey);
}

function createExplainer(story){
  const existing=state.explainers.find(x=>x.storyId===story.id);
  if(!existing){
    const knowledge=state.knowledge.find(k=>story.category.toLowerCase().includes(k.topic.toLowerCase())||k.topic.toLowerCase().includes(story.category.toLowerCase()));
    const explainer={id:Date.now(),storyId:story.id,title:`5-minute explainer: ${story.title}`,created:new Date().toLocaleDateString(),body:`You already have ${knowledge?"some":"limited"} background in this area, so this explainer skips generic definitions and focuses on the missing links. Start with the core mechanism behind today's story, then connect it to the practical consequence. The goal is not to influence tomorrow's story selection; it only updates the knowledge model after you tell us whether the explanation made sense.`};
    state.explainers.unshift(explainer); localStorage.setItem("dailyBriefExplainers",JSON.stringify(state.explainers));
  }
  state.view="explainers";render();
}

function renderArchive(){app.innerHTML=`<section class="hero"><div class="eyebrow">Coverage memory</div><h2>Archive</h2><p>Past briefs will live here so future editions can reference prior coverage without re-explaining the same background.</p></section><div class="panel"><strong>${state.brief.date}</strong><p class="muted">Today's demo brief · ${state.brief.stories.length} stories</p></div>`;}

function renderExplainers(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">On-demand learning</div><h2>Explainers</h2><p>These are separate from story selection. Asking to learn more never pushes a topic into tomorrow's briefing.</p></section>`+(state.explainers.length?state.explainers.map(x=>`<article class="panel"><div class="eyebrow">${x.created}</div><h2>${x.title}</h2><p>${x.body}</p><div class="ratings"><button class="ghost" onclick="markUnderstood('${x.storyId}',true)">That made sense</button><button class="ghost" onclick="markUnderstood('${x.storyId}',false)">Still confused</button></div></article>`).join(""):`<div class="panel"><p class="muted">No explainers yet. Open Today and choose “Teach me more.”</p></div>`);
}

window.markUnderstood=function(storyId,understood){
  const topic=state.brief.stories.find(s=>s.id===storyId)?.category;
  let k=state.knowledge.find(x=>x.topic===topic);
  if(!k){k={topic,score:35};state.knowledge.push(k);}
  k.score=Math.max(0,Math.min(100,k.score+(understood?6:-5)));
  localStorage.setItem("dailyBriefKnowledge",JSON.stringify(state.knowledge));
  alert(understood?"Knowledge confidence updated.":"Got it — confidence lowered so future explanations can start earlier.");
};

function renderKnowledge(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">What the system thinks you know</div><h2>Knowledge graph</h2><p>This is independent from your interest profile. You can care deeply about a topic while still wanting beginner-level explanations.</p></section><section class="panel">${state.knowledge.map(k=>`<div class="knowledge-row"><div><strong>${k.topic}</strong></div><div class="bar"><span style="width:${k.score}%"></span></div><div>${k.score}%</div></div>`).join("")}</section>`;
}

function renderPreferences(){
  app.innerHTML=`<section class="hero"><div class="eyebrow">Interest profile</div><h2>Preferences</h2><p>These settings influence topic selection; explainer requests do not.</p></section><section class="panel"><div class="field"><label>General-news share</label><input id="generalNews" type="range" min="10" max="80" value="${state.prefs.generalNews}"><div class="muted"><span id="generalNewsVal">${state.prefs.generalNews}</span>% of the brief</div></div><div class="field"><label>Technical depth</label><select id="depth"><option>medium</option><option>medium-high</option><option>high</option></select></div><div class="field"><label>Politics coverage</label><select id="politics"><option value="important-only">Only when important</option><option value="routine">Routine coverage</option><option value="minimal">Minimal</option></select></div><button class="primary" id="savePrefs">Save preferences</button></section>`;
  document.querySelector("#depth").value=state.prefs.technicalDepth;document.querySelector("#politics").value=state.prefs.politics;
  document.querySelector("#generalNews").addEventListener("input",e=>document.querySelector("#generalNewsVal").textContent=e.target.value);
  document.querySelector("#savePrefs").addEventListener("click",()=>{state.prefs.generalNews=+document.querySelector("#generalNews").value;state.prefs.technicalDepth=document.querySelector("#depth").value;state.prefs.politics=document.querySelector("#politics").value;localStorage.setItem("dailyBriefPrefs",JSON.stringify(state.prefs));alert("Preferences saved.");});
}

function renderSurvey(){
  state.view="survey";setActive();
  app.innerHTML=`<a class="back-link" href="#" id="backToday">← Back to brief</a><section class="hero"><div class="eyebrow">Post-brief survey</div><h2>How was today's brief?</h2><p>Your answers tune future story selection slowly so one bad story doesn't erase an entire topic.</p></section><form id="surveyForm" class="panel">${state.brief.stories.map((s,i)=>`<div class="survey-row"><strong>${i+1}. ${s.title}</strong><div class="ratings" data-story="${s.id}">${[1,2,3,4,5].map(n=>`<button type="button" class="rating-btn" data-rating="${n}">${n}</button>`).join("")}</div></div>`).join("")}<div class="field"><label>Overall depth</label><select name="depth"><option>Too shallow</option><option selected>About right</option><option>Too detailed</option></select></div><div class="field"><label>Did anything feel repetitive?</label><textarea name="repeat" rows="3"></textarea></div><div class="field"><label>What did you wish was covered?</label><textarea name="missing" rows="3"></textarea></div><button class="primary" type="submit">Submit feedback</button></form>`;
  document.querySelector("#backToday").addEventListener("click",e=>{e.preventDefault();state.view="today";render();});
  document.querySelectorAll(".rating-btn").forEach(btn=>btn.addEventListener("click",()=>{btn.parentElement.querySelectorAll(".rating-btn").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");}));
  document.querySelector("#surveyForm").addEventListener("submit",e=>{e.preventDefault();localStorage.setItem("dailyBriefLastSurvey",new Date().toISOString());e.target.innerHTML='<div class="success"><strong>Thanks.</strong><p>Your feedback was saved locally in this prototype.</p></div>';});
}
render();