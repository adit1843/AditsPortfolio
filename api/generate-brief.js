const {buildBriefPrompt}=require("../lib/briefline/brief-prompt");
const {buildDiscoveryPrompt}=require("../lib/briefline/discovery-prompt");
const {selectCandidates}=require("../lib/briefline/recommender");
const {requireAuth}=require("../lib/briefline/auth");
const {getOpenAIKey,getProfile,userRows,insertUserRow}=require("../lib/briefline/store");
const MODEL=process.env.OPENAI_MODEL||"gpt-6-luna";

function out(d){const p=[];for(const i of d.output||[]){if(i.type!=="message")continue;for(const c of i.content||[]){if(c.type==="output_text"&&c.text)p.push(c.text);}}return p.join("\n").trim();}
function clean(t){return String(t||"").replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();}
function localDay(profile){try{return new Intl.DateTimeFormat("en-CA",{timeZone:profile?.timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}catch{return new Date().toISOString().slice(0,10);}}
async function modelJson({key,input,web=true,max=10000}){
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:MODEL,...(web?{tools:[{type:"web_search"}]}:{}),input,max_output_tokens:max})});
  const d=await r.json();if(!r.ok)throw Object.assign(new Error(d?.error?.message||"OpenAI request failed"),{status:r.status});
  const raw=clean(out(d));try{return {json:JSON.parse(raw),responseId:d.id};}catch(first){
    const rr=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:MODEL,input:`Repair ONLY the JSON syntax. Preserve content and return one valid JSON object.\n\n${raw}`,max_output_tokens:max})});
    const rd=await rr.json();if(!rr.ok)throw new Error(rd?.error?.message||"JSON repair failed");
    return {json:JSON.parse(clean(out(rd))),responseId:d.id};
  }
}
async function manualAlreadyUsed(userId,day){
  const rows=await userRows("briefs",userId,{limit:30});
  return rows.some(r=>r?.payload?.generation?.kind==="manual"&&r?.payload?.generation?.localDate===day);
}

module.exports=async(req,res)=>{
  const s=requireAuth(req,res);if(!s)return;
  let key,profile;try{[key,profile]=await Promise.all([getOpenAIKey(s.userId),getProfile(s.userId)]);}catch(e){return res.status(503).json({error:e.message});}
  const day=localDay(profile);
  if(req.method==="GET"){
    const used=await manualAlreadyUsed(s.userId,day).catch(()=>false);
    return res.status(200).json({configured:Boolean(key),model:MODEL,canRegenerate:!used,regenerationLocalDate:day});
  }
  if(req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"});}
  if(!key)return res.status(503).json({error:"Add your OpenAI API key in Settings first."});
  if(await manualAlreadyUsed(s.userId,day))return res.status(429).json({error:"You’ve already used today’s regeneration. Neosis allows one regeneration per local day.",code:"daily_regeneration_limit"});

  const preferences=req.body?.preferences||{},knowledge=req.body?.knowledge||{},coverage=req.body?.coverage||[];
  try{
    const discovery=await modelJson({key,input:buildDiscoveryPrompt({date:day,preferences,coverage}),web:true,max:9000});
    const candidates=Array.isArray(discovery.json?.candidates)?discovery.json.candidates:[];
    if(candidates.length<8)throw new Error("Neosis could not build a large enough candidate pool.");
    const ranked=selectCandidates(candidates,{preferences,knowledge,coverage},12);
    const final=await modelJson({key,input:buildBriefPrompt({date:day,preferences,knowledge,coverage,candidates:ranked.selected}),web:true,max:10000});
    const brief=final.json;
    if(!brief||!Array.isArray(brief.stories))return res.status(502).json({error:"The generated brief had an invalid structure."});
    brief.generation={kind:"manual",localDate:day,generatedAt:new Date().toISOString(),candidateCount:candidates.length,rankedCandidateIds:ranked.selected.map(c=>c.id)};
    const saved=await insertUserRow("briefs",s.userId,{brief_date:brief.date,payload:brief});
    const briefId=saved?.[0]?.id||null;
    return res.status(200).json({brief,briefId,model:MODEL,responseId:final.responseId,recommender:{candidateCount:candidates.length,rankedCount:ranked.selected.length}});
  }catch(e){return res.status(e.status||500).json({error:e instanceof Error?e.message:"Unexpected server error"});}
};
