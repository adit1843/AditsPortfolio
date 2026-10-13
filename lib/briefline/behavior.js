function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0));}
function norm(v=""){return String(v).trim().toLowerCase().replace(/\s+/g," ");}
function featurePairs(story={}){
  const tax=story.tags?.taxonomy||story.taxonomy||{};
  const out=[];
  const add=(kind,label,weight)=>{const x=String(label||"").trim();if(x)out.push({key:`${kind}:${norm(x)}`,label:x,kind,weight});};
  add("domain",tax.domain,.55);
  add("topic",tax.topic,.9);
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
function decayRecent(value,lastUpdated,at){
  const prev=Date.parse(lastUpdated||""),now=Date.parse(at||"");
  if(!Number.isFinite(prev)||!Number.isFinite(now))return clamp(value);
  const days=Math.max(0,(now-prev)/86400000);
  return 50+(clamp(value)-50)*Math.pow(.88,days);
}
function apply(model,story,signal,at){
  const next=model;
  for(const f of featurePairs(story)){
    const cur=next.features[f.key]||{label:f.label,kind:f.kind,longTerm:50,recent:50,confidence:0,evidence:0,lastUpdated:null};
    const recent=decayRecent(cur.recent,cur.lastUpdated,at);
    const magnitude=Number(signal)||0;
    next.features[f.key]={
      ...cur,
      label:f.label,
      kind:f.kind,
      longTerm:clamp((Number(cur.longTerm)||50)+magnitude*f.weight*.42),
      recent:clamp(recent+magnitude*f.weight*.9),
      confidence:clamp((Number(cur.confidence)||0)+Math.min(12,Math.abs(magnitude)*f.weight*.8+1)),
      evidence:(Number(cur.evidence)||0)+1,
      lastUpdated:at
    };
  }
  next.updatedAt=at;
  return next;
}
function buildBehavioralInterest(events=[]){
  const model={version:1,features:{}};
  const sorted=[...(events||[])].sort((a,b)=>Date.parse(a.created_at||0)-Date.parse(b.created_at||0));
  for(const e of sorted){
    const story=e?.payload?.story;
    if(!story?.id)continue;
    apply(model,story,Number(e.weight)||0,e.created_at||new Date().toISOString());
  }
  return model;
}
module.exports={buildBehavioralInterest};
