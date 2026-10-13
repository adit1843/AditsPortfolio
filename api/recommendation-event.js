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
  if(type==="read_progress"){
    const p=Number(value)||0;
    if(p>=1)return .8;
    if(p>=.75)return 1;
    if(p>=.5)return .7;
    if(p>=.25)return .5;
    return 0;
  }
  if(type==="audio_progress"){
    const p=Number(value)||0;
    if(p>=1)return .9;
    if(p>=.75)return 1;
    if(p>=.5)return .8;
    if(p>=.25)return .5;
    return 0;
  }
  if(type==="quick_skip")return -1.2;
  if(type==="source_click")return 3;
  if(type==="archive_revisit")return 3;
  if(type==="deep_dive")return 0;
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
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Could not record recommendation signal"});
  }
};
