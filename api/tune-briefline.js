const {requireAuth}=require("../lib/briefline/auth");
const {createResponse}=require("../lib/briefline/openai");

function out(d){const p=[];for(const i of d.output||[]){if(i.type!=="message")continue;for(const c of i.content||[]){if(c.type==="output_text"&&c.text)p.push(c.text);}}return p.join("\n").trim();}
function clean(t){return t.replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();}
function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0));}
function mix(m={}){const ks=["news","general_knowledge","deep_dive","history","science","business_case"],raw={};let total=0;for(const k of ks){raw[k]=Math.max(0,Number(m[k])||0);total+=raw[k];}if(!total)return{news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5};const o={};let run=0;ks.forEach((k,i)=>{if(i===ks.length-1)o[k]=100-run;else{o[k]=Math.round(raw[k]/total*100);run+=o[k];}});return o;}
function canon(v=""){return String(v).trim().toLowerCase().replace(/\s+/g," ");}

module.exports=async(req,res)=>{
  const s=requireAuth(req,res);if(!s)return;
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"Neosis generation is not configured."});
  const message=String(req.body?.message||"").trim();
  if(!message)return res.status(400).json({error:"A tuning message is required."});
  const prefs=req.body?.preferences||{},knowledge=req.body?.knowledge||{concepts:{},seenEvents:{}},history=Array.isArray(prefs.tuningHistory)?prefs.tuningHistory.slice(-12):[];
  const prompt=`You are Neosis's control layer. Neosis can become a daily podcast about ANYTHING, not merely a news briefing. A user may ask for yesterday's sports results, cooking tips every morning, a history show, a language lesson, a narrowly scoped industry briefing, or any hybrid. User message: ${message}. Current interest/editorial state: ${JSON.stringify(prefs)}. Hidden knowledge: ${JSON.stringify(knowledge?.concepts||{})}. Recent tuning: ${JSON.stringify(history)}. Interest controls WHAT is selected; knowledge controls HOW deeply concepts are explained. Asking for an explanation alone never means more stories on that topic. Explicit recurring instructions such as "give me NBA results every morning" or "make this mostly cooking" should be captured as durable editorialDirectives and, where useful, requestedTopics or topicScoreUpdates. Preserve arbitrary subject matter literally rather than forcing it into generic news categories. Mix targets news/general_knowledge/deep_dive/history/science/business_case are broad presentation formats, not subject-matter limits. Scores are 0-100. Return ONLY JSON {"assistant":"","topicScoreUpdates":{},"contentTypeScoreUpdates":{},"mixTargets":{"news":45,"general_knowledge":20,"deep_dive":15,"history":7,"science":8,"business_case":5},"knowledgeUpdates":[],"languageDirectives":[],"editorialDirectives":[]}`;
  try{
    const d=await createResponse({userId:s.userId,operation:"tune",input:prompt,maxOutputTokens:2200});
    const p=JSON.parse(clean(out(d))),next={...prefs,topicScores:{...(prefs.topicScores||{})},contentTypeScores:{...(prefs.contentTypeScores||{})},mixTargets:mix(p.mixTargets||prefs.mixTargets),languageDirectives:Array.isArray(p.languageDirectives)?p.languageDirectives.slice(-12):(prefs.languageDirectives||[]),editorialDirectives:Array.isArray(p.editorialDirectives)?p.editorialDirectives.slice(-12):(prefs.editorialDirectives||[])};
    for(const[k,v]of Object.entries(p.topicScoreUpdates||{}))next.topicScores[k]=clamp(v);
    for(const[k,v]of Object.entries(p.contentTypeScoreUpdates||{}))next.contentTypeScores[k]=clamp(v);
    const nk={concepts:{...(knowledge?.concepts||{})},seenEvents:{...(knowledge?.seenEvents||{})}};
    for(const u of p.knowledgeUpdates||[]){if(!u?.concept)continue;const k=canon(u.concept),cur=nk.concepts[k]||{label:u.concept,score:0,exposures:0};nk.concepts[k]={...cur,label:cur.label||u.concept,score:clamp(u.score),updatedBy:"user",lastUpdated:new Date().toISOString()};}
    const entry={at:new Date().toISOString(),user:message,assistant:String(p.assistant||"Updated Neosis.")};
    next.tuningHistory=[...history,entry].slice(-20);
    return res.status(200).json({assistant:entry.assistant,preferences:next,knowledge:nk,mixTargets:next.mixTargets});
  }catch(e){return res.status(e.status||500).json({error:e instanceof Error?e.message:"Could not update Neosis settings"});}
};