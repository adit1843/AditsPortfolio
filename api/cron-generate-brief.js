const {generateBriefAudio}=require("../lib/briefline/google-tts");
const {buildBriefPrompt}=require("../lib/briefline/brief-prompt");
const {buildDiscoveryPrompt}=require("../lib/briefline/discovery-prompt");
const {selectCandidates}=require("../lib/briefline/recommender");
const {getSession}=require("../lib/briefline/auth");
const {request,userRows,insertUserRow,listProfiles}=require("../lib/briefline/store");
const {createResponse}=require("../lib/briefline/openai");

const CRON_SECRET=process.env.CRON_SECRET,RESEND_API_KEY=process.env.RESEND_API_KEY,SITE_URL=process.env.SITE_URL;

function out(d){const p=[];for(const i of d.output||[]){if(i.type!=="message")continue;for(const c of i.content||[]){if(c.type==="output_text"&&c.text)p.push(c.text);}}return p.join("\n").trim();}
function clean(t){return String(t||"").replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();}
async function parse(raw,userId,operation){
  try{return JSON.parse(clean(raw));}
  catch{
    const d=await createResponse({userId,operation:operation+"_repair",input:`Repair ONLY JSON syntax, preserve content, return one JSON object.\n\n${raw}`,maxOutputTokens:10000});
    return JSON.parse(clean(out(d)));
  }
}
function day(p){try{return new Intl.DateTimeFormat("en-CA",{timeZone:p.timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}catch{return new Date().toISOString().slice(0,10);}}
async function email(p,b,id){
  if(!p.email_enabled||!RESEND_API_KEY||!SITE_URL)return null;
  const base=SITE_URL.replace(/\/$/,""),u=`${base}/briefing/?brief=${id}`,s=`${base}/briefing/?survey=1&brief=${id}`,l=`${u}#audioBrief`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px"><p style="letter-spacing:.12em;font-size:12px;color:#777">NEOSIS</p><h1>Your daily briefing is ready</h1><p>${b.date} · ${b.readTime||"Daily edition"}</p><p>${b.intro||""}</p><p><a href="${u}">Read</a> · ${b.audio?.segments?.length?`<a href="${l}">Listen</a> · `:""}<a href="${s}">Survey</a></p></div>`;
  const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:"Neosis <briefline@mail.aditsanghani.com>",to:[p.email],subject:`Your ${b.date} Neosis is ready`,html})});
  const d=await rr.json();if(!rr.ok)throw new Error(d?.message||"Email failed");return d.id;
}
async function one(p){
  const uid=p.user_id;
  if(!process.env.OPENAI_API_KEY)return{userId:uid,skipped:"openai_not_configured"};
  const[prefs,k,cov,old]=await Promise.all([userRows("preferences",uid,{limit:1}),userRows("knowledge",uid,{limit:1}),userRows("coverage",uid,{limit:14}),userRows("briefs",uid,{limit:1})]);
  const preferences=prefs?.[0]?.payload||{},knowledge=k?.[0]?.payload||{concepts:{},seenEvents:{}},coverage=cov.map(x=>x.payload);

  const dd=await createResponse({userId:uid,operation:"scheduled_discovery",input:buildDiscoveryPrompt({date:day(p),preferences,coverage}),tools:[{type:"web_search"}],maxOutputTokens:9000});
  const discovered=await parse(out(dd),uid,"scheduled_discovery"),candidates=Array.isArray(discovered?.candidates)?discovered.candidates:[];
  if(candidates.length<8)throw new Error("Candidate discovery returned too few segments");

  const ranked=selectCandidates(candidates,{preferences,knowledge,coverage},12);
  const final=await createResponse({userId:uid,operation:"scheduled_final",input:buildBriefPrompt({date:day(p),preferences,knowledge,coverage,candidates:ranked.selected}),tools:[{type:"web_search"}],maxOutputTokens:10000});
  const brief=await parse(out(final),uid,"scheduled_final");
  brief.generation={kind:"scheduled",localDate:day(p),generatedAt:new Date().toISOString(),candidateCount:candidates.length,rankedCandidateIds:ranked.selected.map(c=>c.id)};

  if(old?.[0]?.payload?.stories?.length)await insertUserRow("coverage",uid,{payload:{date:old[0].payload.date,stories:old[0].payload.stories.map(x=>({title:x.title,category:x.category,summary:x.summary,tags:x.tags||null}))}});
  const ins=await insertUserRow("briefs",uid,{brief_date:brief.date,payload:brief}),id=ins?.[0]?.id;if(!id)throw new Error("Brief save failed");

  if(p.audio_enabled){try{const a=await generateBriefAudio(brief,id,uid);if(a?.configured&&a?.segments?.length){brief.audio=a;await request(`briefs?id=eq.${id}&user_id=eq.${encodeURIComponent(uid)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({payload:brief})});}}catch{}}
  const emailId=await email(p,brief,id);
  await request(`profiles?user_id=eq.${encodeURIComponent(uid)}`,{method:"PATCH",body:JSON.stringify({last_brief_local_date:day(p),updated_at:new Date().toISOString()})});
  return{userId:uid,briefId:id,emailId,candidateCount:candidates.length};
}
module.exports=async(req,res)=>{
  const ok=Boolean(CRON_SECRET&&req.headers.authorization===`Bearer ${CRON_SECRET}`),s=getSession(req);
  if(!ok&&!s)return res.status(401).json({error:"Unauthorized"});
  try{
    const ps=s?await request(`profiles?user_id=eq.${encodeURIComponent(s.userId)}&select=*&limit=1`):await listProfiles(),results=[];
    for(const p of ps){
      if(p.last_brief_local_date===day(p)){results.push({userId:p.user_id,skipped:"already_generated"});continue;}
      try{results.push(await one(p));}catch(e){results.push({userId:p.user_id,error:e.message});}
    }
    return res.status(200).json({ok:true,processed:results.length,results});
  }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"Daily generation failed"});}
};