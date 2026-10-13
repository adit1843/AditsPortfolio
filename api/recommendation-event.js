const {requireAuth}=require("../lib/briefline/auth");
const {request,userRows,insertUserRow}=require("../lib/briefline/store");

function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0));}
function norm(v=""){return String(v).trim().toLowerCase().replace(/\s+/g," ");}
function daysSince(v){
  const t=Date.parse(v||"");
  return Number.isFinite(t)?Math.max(0,(Date.now()-t)/86400000):999;
}
function decayRecent(value,lastUpdated){
  const d=daysSince(lastUpdated);
  const factor=Math.pow(.88,d);
  return 50+(clamp(value)-50)*factor;
}
function featurePairs(story={}){
  const tax=story.tags?.taxonomy||story.taxonomy||{};
  const out=[];
  const add=(kind,label,weight)=>{const x=String(label||"").trim();if(x)out.push({key:`${kind}:${norm(x)}`,label:x,kind,weight});};
  add("domain",tax.domain,0.55);
  add("topic",tax.topic,0.9);
  add("subtopic",tax.subtopic,1.15);
  for(const x of story.topics||[])add("topic",x,1);
  for(const x of story.tags?.themes||story.themes||[])add("theme",x,.72);
  for(const x of story.tags?.entities||story.entities||[])add("entity",x,.52);
  add("format",story.contentType||story.formatIntent,.7);
  add("event",story.tags?.eventType||story.eventType,.55);
  add("timeliness",story.tags?.timeliness||story.timeliness,.4);
  const seen=new Map();
  for(const x of out)if(!seen.has(x.key)||seen.get(x.key).weight<x.weight)seen.set(x.key,x);
  return [...seen.values()];
}
function updateModel(model={},story,signal){
  const next={version:1,features:{...(model.features||{})}};
  const now=new Date().toISOString();
  for(const f of featurePairs(story)){
    const cur=next.features[f.key]||{label:f.label,kind:f.kind,longTerm:50,recent:50,confidence:0,evidence:0,lastUpdated:null};
    const recent=decayRecent(cur.recent,cur.lastUpdated);
    const magnitude=Number(signal)||0;
    const ltStep=magnitude*f.weight*.42;
    const recentStep=magnitude*f.weight*.9;
    const confidenceGain=Math.min(12,Math.abs(magnitude)*f.weight*.8+1);
    next.features[f.key]={
      ...cur,
      label:f.label,
      kind:f.kind,
      longTerm:clamp((Number(cur.longTerm)||50)+ltStep),
      recent:clamp(recent+recentStep),
      confidence:clamp((Number(cur.confidence)||0)+confidenceGain),
      evidence:(Number(cur.evidence)||0)+1,
      lastUpdated:now
    };
  }
  next.updatedAt=now;
  return next;
}
function eventWeight(type,value){
  if(type==="read_progress"){
    const p=Number(value)||0;
    if(p>=1)return 3;
    if(p>=.75)return 2.2;
    if(p>=.5)return 1.2;
    if(p>=.25)return .5;
    return 0;
  }
  if(type==="audio_progress"){
    const p=Number(value)||0;
    if(p>=1)return 3.2;
    if(p>=.75)return 2.4;
    if(p>=.5)return 1.3;
    if(p>=.25)return .5;
    return 0;
  }
  if(type==="quick_skip")return -1.2;
  if(type==="source_click")return 3;
  if(type==="archive_revisit")return 3;
  if(type==="deep_dive")return 4;
  if(type==="more_like_this")return 8;
  if(type==="less_like_this")return -8;
  if(type==="share_or_copy")return 4;
  return Number(value)||0;
}

module.exports=async(req,res)=>{
  const s=requireAuth(req,res);if(!s)return;
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
  try{
    const b=req.body||{},type=String(b.type||"").trim(),eventKey=String(b.eventKey||"").trim(),story=b.story||{};
    if(!type||!eventKey||!story?.id)return res.status(400).json({error:"type, eventKey, and story are required"});
    const existing=await request(`recommendation_events?user_id=eq.${encodeURIComponent(s.userId)}&event_key=eq.${encodeURIComponent(eventKey)}&select=id&limit=1`);
    if(existing?.length)return res.status(200).json({ok:true,duplicate:true});
    const weight=eventWeight(type,b.value);
    await insertUserRow("recommendation_events",s.userId,{
      event_key:eventKey,event_type:type,brief_id:b.briefId||null,story_id:String(story.id),
      weight,payload:{value:b.value??null,story}
    });
    const prefsRows=await userRows("preferences",s.userId,{limit:1});
    const prefs={...(prefsRows?.[0]?.payload||{})};
    prefs.behavioralInterest=updateModel(prefs.behavioralInterest||{},story,weight);
    await insertUserRow("preferences",s.userId,{payload:prefs});
    return res.status(200).json({ok:true,weight,behavioralInterest:prefs.behavioralInterest});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Could not record recommendation signal"});
  }
};
