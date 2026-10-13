const {buildBriefPrompt}=require("../lib/briefline/brief-prompt");
const {buildDiscoveryPrompt}=require("../lib/briefline/discovery-prompt");
const {selectCandidates}=require("../lib/briefline/recommender");
const {requireAuth}=require("../lib/briefline/auth");
const {getProfile,userRows,insertUserRow}=require("../lib/briefline/store");
const {createResponse,DEFAULT_MODEL}=require("../lib/briefline/openai");
const {buildContentPlan,resolveSourcePlan,webSearchTool}=require("../lib/briefline/source-planner");

function out(d){const p=[];for(const i of d.output||[]){if(i.type!=="message")continue;for(const c of i.content||[]){if(c.type==="output_text"&&c.text)p.push(c.text);}}return p.join("\n").trim();}
function clean(t){return String(t||"").replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();}
function localDay(profile){try{return new Intl.DateTimeFormat("en-CA",{timeZone:profile?.timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}catch{return new Date().toISOString().slice(0,10);}}
async function jsonResponse({userId,operation,input,web=true,tools,max=10000}){
  const d=await createResponse({userId,operation,input,tools:tools||(web?[{type:"web_search"}]:undefined),maxOutputTokens:max});
  const raw=clean(out(d));
  try{return {json:JSON.parse(raw),responseId:d.id};}
  catch{
    const repair=await createResponse({userId,operation:operation+"_repair",input:`Repair ONLY the JSON syntax. Preserve content and return one valid JSON object.\n\n${raw}`,maxOutputTokens:max});
    return {json:JSON.parse(clean(out(repair))),responseId:d.id};
  }
}
async function manualAlreadyUsed(userId,day){
  const rows=await userRows("briefs",userId,{limit:30});
  return rows.some(r=>r?.payload?.generation?.kind==="manual"&&r?.payload?.generation?.localDate===day);
}
module.exports=async(req,res)=>{
  const s=requireAuth(req,res);if(!s)return;
  const profile=await getProfile(s.userId).catch(()=>null);
  const day=localDay(profile);
  const owner=Boolean(process.env.SURVEY_EMAIL_TO&&String(s.email||"").toLowerCase()===String(process.env.SURVEY_EMAIL_TO).toLowerCase());
  if(req.method==="GET"){
    const used=owner?false:await manualAlreadyUsed(s.userId,day).catch(()=>false);
    return res.status(200).json({configured:Boolean(process.env.OPENAI_API_KEY),model:DEFAULT_MODEL,canRegenerate:owner||!used,unlimitedRegenerations:owner,regenerationLocalDate:day});
  }
  if(req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"});}
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"Neosis generation is not configured."});
  if(!owner&&await manualAlreadyUsed(s.userId,day))return res.status(429).json({error:"You’ve already used today’s regeneration. Neosis allows one regeneration per local day.",code:"daily_regeneration_limit"});
  const preferences=req.body?.preferences||{},knowledge=req.body?.knowledge||{},coverage=req.body?.coverage||[];
  try{
    const contentPlan=await buildContentPlan({userId:s.userId,date:day,preferences,knowledge,coverage});
    const sourcePlan=await resolveSourcePlan({userId:s.userId,contentPlan});
    const discovery=await jsonResponse({
      userId:s.userId,
      operation:"manual_discovery",
      input:buildDiscoveryPrompt({date:day,preferences,coverage,contentPlan,sourcePlan}),
      tools:[webSearchTool(sourcePlan)],
      max:9000
    });
    const candidates=Array.isArray(discovery.json?.candidates)?discovery.json.candidates:[];
    if(candidates.length<8)throw new Error("Neosis could not build a large enough candidate pool.");
    const ranked=selectCandidates(candidates,{preferences,knowledge,coverage,contentPlan},12);
    const final=await jsonResponse({
      userId:s.userId,
      operation:"manual_final",
      input:buildBriefPrompt({date:day,preferences,knowledge,coverage,candidates:ranked.selected,contentPlan,sourcePlan}),
      web:false,
      max:10000
    });
    const brief=final.json;
    if(!brief||!Array.isArray(brief.stories))return res.status(502).json({error:"The generated brief had an invalid structure."});
    brief.generation={kind:"manual",localDate:day,generatedAt:new Date().toISOString(),candidateCount:candidates.length,rankedCandidateIds:ranked.selected.map(c=>c.id),contentPlan,sourceRegistrySize:sourcePlan.registrySize,sourceDomains:sourcePlan.domains};
    const saved=await insertUserRow("briefs",s.userId,{brief_date:brief.date,payload:brief});
    const briefId=saved?.[0]?.id||null;
    return res.status(200).json({brief,briefId,model:DEFAULT_MODEL,responseId:final.responseId,recommender:{candidateCount:candidates.length,rankedCount:ranked.selected.length,contentPlan,sourceRegistrySize:sourcePlan.registrySize}});
  }catch(e){return res.status(e.status||500).json({error:e instanceof Error?e.message:"Unexpected server error"});}
};