const {requireAuth}=require("../lib/briefline/auth");
const {request,userRows,insertUserRow}=require("../lib/briefline/store");
const {buildBehavioralInterest}=require("../lib/briefline/behavior");

function storySnapshot(story={}){
  return {
    id:String(story.id||""),
    title:String(story.title||"").slice(0,240),
    category:String(story.category||"").slice(0,120),
    topics:Array.isArray(story.topics)?story.topics.slice(0,12):[],
    contentType:story.contentType||story.formatIntent||null,
    tags:{
      taxonomy:story.tags?.taxonomy||story.taxonomy||null,
      themes:(story.tags?.themes||story.themes||[]).slice(0,16),
      entities:(story.tags?.entities||story.entities||[]).slice(0,16),
      eventType:story.tags?.eventType||story.eventType||null,
      timeliness:story.tags?.timeliness||story.timeliness||null
    }
  };
}
function eventWeight(type,value){
  if(type==="read_progress"){const p=Number(value)||0;if(p>=1)return .8;if(p>=.75)return 1;if(p>=.5)return .7;if(p>=.25)return .5;return 0;}
  if(type==="audio_progress"){const p=Number(value)||0;if(p>=1)return .9;if(p>=.75)return 1;if(p>=.5)return .8;if(p>=.25)return .5;return 0;}
  if(type==="quick_skip")return -1.2;
  if(type==="source_click")return 3;
  if(type==="archive_revisit")return 3;
  if(type==="deep_dive")return 0;
  if(type==="more_like_this")return 8;
  if(type==="less_like_this")return -8;
  if(type==="share_or_copy")return 4;
  return Number(value)||0;
}
async function recommendationEvent(s,req,res){
  const b=req.body||{},type=String(b.type||"").trim(),eventKey=String(b.eventKey||"").trim(),story=b.story||{};
  if(!type||!eventKey||!story?.id)return res.status(400).json({error:"type, eventKey, and story are required"});
  const existing=await request(`recommendation_events?user_id=eq.${encodeURIComponent(s.userId)}&event_key=eq.${encodeURIComponent(eventKey)}&select=id&limit=1`);
  if(existing?.length)return res.status(200).json({ok:true,duplicate:true});
  const weight=eventWeight(type,b.value),snapshot=storySnapshot(story);
  await insertUserRow("recommendation_events",s.userId,{
    event_key:eventKey,event_type:type,brief_id:b.briefId||null,story_id:String(story.id),
    weight,payload:{value:b.value??null,story:snapshot}
  });
  const [prefsRows,events]=await Promise.all([
    userRows("preferences",s.userId,{limit:1}),
    userRows("recommendation_events",s.userId,{limit:1000,order:"created_at.asc"})
  ]);
  const prefs={...(prefsRows?.[0]?.payload||{})};
  prefs.behavioralInterest=buildBehavioralInterest(events);
  await insertUserRow("preferences",s.userId,{payload:prefs});
  return res.status(200).json({ok:true,weight,behavioralInterest:prefs.behavioralInterest});
}

module.exports=async(req,res)=>{
  const s=requireAuth(req,res);if(!s)return;
  const {resource}=req.query||{};
  if(resource==="recommendation_event"){
    if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
    try{return await recommendationEvent(s,req,res);}
    catch(e){return res.status(500).json({error:e instanceof Error?e.message:"Could not record recommendation signal"});}
  }
  const allowed=new Set(["briefs","explainers","preferences","knowledge","coverage","surveys"]);
  if(!allowed.has(resource))return res.status(400).json({error:"Unknown resource"});
  try{
    if(req.method==="GET"){
      const d=await request(`${resource}?user_id=eq.${encodeURIComponent(s.userId)}&select=*&order=created_at.desc&limit=100`);
      return res.status(200).json({data:d});
    }
    if(req.method==="POST"){
      const raw=Array.isArray(req.body)?req.body:[req.body],payload=raw.map(row=>({...row,user_id:s.userId})),
      d=await request(resource,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
      return res.status(200).json({data:d});
    }
    if(req.method==="DELETE"){
      const id=req.query?.id;if(!id)return res.status(400).json({error:"id is required"});
      const d=await request(`${resource}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(s.userId)}`,{method:"DELETE",headers:{Prefer:"return=representation"}});
      return res.status(200).json({data:d});
    }
    res.setHeader("Allow","GET, POST, DELETE");return res.status(405).json({error:"Method not allowed"});
  }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"Database request failed"});}
};
