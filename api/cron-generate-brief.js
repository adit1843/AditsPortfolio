const {generateBriefAudio}=require("../lib/briefline/google-tts");
const {buildBriefPrompt}=require("../lib/briefline/brief-prompt");
const {buildDiscoveryPrompt}=require("../lib/briefline/discovery-prompt");
const {selectCandidates}=require("../lib/briefline/recommender");
const {getSession}=require("../lib/briefline/auth");
const {request,userRows,insertUserRow,listProfiles}=require("../lib/briefline/store");
const {createResponse}=require("../lib/briefline/openai");
const {buildContentPlan,resolveSourcePlan,webSearchTool}=require("../lib/briefline/source-planner");
const {buildBehavioralInterest}=require("../lib/briefline/behavior");
const {buildDailyEmail}=require("../lib/briefline/daily-email");

const CRON_SECRET=process.env.CRON_SECRET,DISPATCH_SECRET=process.env.NOESIS_DISPATCH_SECRET,RESEND_API_KEY=process.env.RESEND_API_KEY,SITE_URL=process.env.SITE_URL;

function out(d){const p=[];for(const i of d.output||[]){if(i.type!=="message")continue;for(const c of i.content||[]){if(c.type==="output_text"&&c.text)p.push(c.text);}}return p.join("\n").trim();}
function clean(t){return String(t||"").replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();}
async function parse(raw,userId,operation){
  const cleaned=clean(raw);
  try{return JSON.parse(cleaned);}catch{}
  const first=cleaned.indexOf("{"),last=cleaned.lastIndexOf("}");
  if(first>=0&&last>first){
    try{return JSON.parse(cleaned.slice(first,last+1));}catch{}
  }
  const d=await createResponse({
    userId,
    operation:operation+"_repair",
    input:`Return ONLY one compact valid JSON object. Repair syntax and remove any prose or markdown. Preserve the factual content, but shorten verbose strings if necessary.\n\n${cleaned}`,
    maxOutputTokens:7000
  });
  const repaired=clean(out(d));
  try{return JSON.parse(repaired);}catch{}
  const a=repaired.indexOf("{"),b=repaired.lastIndexOf("}");
  if(a>=0&&b>a)return JSON.parse(repaired.slice(a,b+1));
  throw new Error(`${operation} returned invalid JSON after repair`);
}
function day(p){try{return new Intl.DateTimeFormat("en-CA",{timeZone:p.timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}catch{return new Date().toISOString().slice(0,10);}}
async function email(p,b,id){
  if(!p.email_enabled||!RESEND_API_KEY||!SITE_URL)return null;
  const {html,text,subject}=buildDailyEmail({brief:b,briefId:id,baseUrl:SITE_URL,audioEnabled:Boolean(p.audio_enabled)});
  const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`noesis-daily-${p.user_id}-${day(p)}`},body:JSON.stringify({from:"Noesis <briefline@mail.aditsanghani.com>",to:[p.email],subject,html,text})});
  const d=await rr.json();if(!rr.ok)throw new Error(d?.message||"Email failed");return d.id;
}
async function one(p){
  const uid=p.user_id,localDate=day(p);
  if(!process.env.OPENAI_API_KEY)return{userId:uid,skipped:"openai_not_configured"};
  const[prefs,k,cov,old,behaviorEvents]=await Promise.all([userRows("preferences",uid,{limit:1}),userRows("knowledge",uid,{limit:1}),userRows("coverage",uid,{limit:14}),userRows("briefs",uid,{limit:1}),userRows("recommendation_events",uid,{limit:1000,order:"created_at.asc"}).catch(()=>[])]);
  const preferences={...(prefs?.[0]?.payload||{}),behavioralInterest:buildBehavioralInterest(behaviorEvents)},knowledge=k?.[0]?.payload||{concepts:{},seenEvents:{}},coverage=cov.map(x=>x.payload);

  const latest=old?.[0];
  if(latest?.payload?.generation?.localDate===localDate){
    const emailId=await email(p,latest.payload,latest.id);
    await request(`profiles?user_id=eq.${encodeURIComponent(uid)}`,{method:"PATCH",body:JSON.stringify({last_brief_local_date:localDate,brief_generation_date:localDate,brief_generation_status:"complete",brief_generation_error:null,updated_at:new Date().toISOString()})});
    return{userId:uid,briefId:latest.id,emailId,recoveredExisting:true};
  }
  const contentPlan=await buildContentPlan({userId:uid,date:localDate,preferences,knowledge,coverage});
  const sourcePlan=await resolveSourcePlan({userId:uid,contentPlan,discoverRegistry:false});

  const dd=await createResponse({
    userId:uid,
    operation:"scheduled_discovery",
    input:buildDiscoveryPrompt({date:localDate,preferences,coverage,contentPlan,sourcePlan}),
    tools:[webSearchTool(sourcePlan)],
    maxOutputTokens:9000
  });
  const discovered=await parse(out(dd),uid,"scheduled_discovery"),candidates=Array.isArray(discovered?.candidates)?discovered.candidates:[];
  if(candidates.length<8)throw new Error(`Candidate discovery returned too few segments (${candidates.length})`);

  const ranked=selectCandidates(candidates,{preferences,knowledge,coverage,contentPlan},12);
  const final=await createResponse({
    userId:uid,
    operation:"scheduled_final",
    input:buildBriefPrompt({date:localDate,preferences,knowledge,coverage,candidates:ranked.selected,contentPlan,sourcePlan}),
    maxOutputTokens:10000
  });
  const brief=await parse(out(final),uid,"scheduled_final");
  brief.generation={kind:"scheduled",localDate,generatedAt:new Date().toISOString(),candidateCount:candidates.length,rankedCandidateIds:ranked.selected.map(c=>c.id),contentPlan,sourceRegistrySize:sourcePlan.registrySize,sourceDomains:sourcePlan.domains};

  if(old?.[0]?.payload?.stories?.length)await insertUserRow("coverage",uid,{payload:{date:old[0].payload.date,stories:old[0].payload.stories.map(x=>({title:x.title,category:x.category,summary:x.summary,tags:x.tags||null}))}});
  const ins=await insertUserRow("briefs",uid,{brief_date:brief.date,payload:brief}),id=ins?.[0]?.id;if(!id)throw new Error("Brief save failed");

  // Email immediately after the brief is saved. Audio is an enhancement and must never block delivery.
  const emailId=await email(p,brief,id);
  await request(`profiles?user_id=eq.${encodeURIComponent(uid)}`,{method:"PATCH",body:JSON.stringify({last_brief_local_date:localDate,brief_generation_date:localDate,brief_generation_status:"complete",brief_generation_error:null,updated_at:new Date().toISOString()})});

  let audioGenerated=false,audioError=null;
  if(p.audio_enabled){
    try{
      const a=await generateBriefAudio(brief,id,uid);
      if(a?.configured&&a?.segments?.length){
        brief.audio=a;
        await request(`briefs?id=eq.${id}&user_id=eq.${encodeURIComponent(uid)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({payload:brief})});
        audioGenerated=true;
      }
    }catch(e){audioError=e instanceof Error?e.message:"Audio generation failed";}
  }
  return{userId:uid,briefId:id,emailId,candidateCount:candidates.length,contentBuckets:contentPlan.buckets.map(b=>({topic:b.topic,share:b.share})),sourceRegistrySize:sourcePlan.registrySize,audioGenerated,audioError};
}
module.exports=async(req,res)=>{
  const auth=req.headers.authorization||"";
  const schedulerOk=Boolean((DISPATCH_SECRET&&auth===`Bearer ${DISPATCH_SECRET}`)||(CRON_SECRET&&auth===`Bearer ${CRON_SECRET}`));
  const s=getSession(req);
  if(!schedulerOk&&!s)return res.status(401).json({error:"Unauthorized"});
  let p=null;
  try{
    if(s){
      const rows=await request(`profiles?user_id=eq.${encodeURIComponent(s.userId)}&select=*&limit=1`);
      p=rows?.[0]||null;
      if(!p)return res.status(404).json({error:"Profile not found"});
      if(p.last_brief_local_date===day(p))return res.status(200).json({ok:true,skipped:"already_generated"});
    }else{
      const claimed=await request("rpc/claim_next_noesis_profile",{method:"POST",body:"{}"});
      p=claimed?.[0]||null;
      if(!p)return res.status(200).json({ok:true,skipped:"no_due_users"});
    }

    try{
      const result=await one(p);
      return res.status(200).json({ok:true,result});
    }catch(e){
      const message=e instanceof Error?e.message:"User generation failed";
      if(!s&&p?.user_id){
        await request(`profiles?user_id=eq.${encodeURIComponent(p.user_id)}`,{method:"PATCH",body:JSON.stringify({brief_generation_status:"failed",brief_generation_error:message.slice(0,1000),updated_at:new Date().toISOString()})}).catch(()=>null);
      }
      return res.status(200).json({ok:false,userId:p?.user_id||null,error:message});
    }
  }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"Daily generation failed"});}
};