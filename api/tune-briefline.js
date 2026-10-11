const {requireAuth}=require("../lib/briefline/auth");
const MODEL=process.env.OPENAI_MODEL||"gpt-6-luna";

function extractOutputText(data){
  const parts=[];
  for(const item of data.output||[]){
    if(item.type!=="message") continue;
    for(const content of item.content||[]){
      if(content.type==="output_text"&&content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}
function cleanJson(text){
  return text.replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();
}
function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0));}
function normalizeMix(mix={}){
  const keys=["news","general_knowledge","deep_dive","history","science","business_case"];
  const raw={};
  let total=0;
  for(const k of keys){raw[k]=Math.max(0,Number(mix[k])||0);total+=raw[k];}
  if(!total) return {news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5};
  const out={}; let running=0;
  keys.forEach((k,i)=>{
    if(i===keys.length-1) out[k]=100-running;
    else {out[k]=Math.round(raw[k]/total*100);running+=out[k];}
  });
  return out;
}
function canonicalConcept(v=""){return String(v).trim().toLowerCase().replace(/\s+/g," ");}

module.exports=async function handler(req,res){
  if(!requireAuth(req,res)) return;
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  if(!process.env.OPENAI_API_KEY) return res.status(503).json({error:"OPENAI_API_KEY is not configured."});

  const message=String(req.body?.message||"").trim();
  if(!message) return res.status(400).json({error:"A tuning message is required."});

  const prefs=req.body?.preferences||{};
  const knowledge=req.body?.knowledge||{concepts:{},seenEvents:{}};
  const history=Array.isArray(prefs.tuningHistory)?prefs.tuningHistory.slice(-12):[];

  const prompt=`
You are the control layer for a personal briefing product called Neosis.
The user is talking directly to you to change how future editions are selected and explained.

User message:
${message}

Current editorial/interest state:
${JSON.stringify(prefs,null,2)}

Current hidden knowledge state:
${JSON.stringify(knowledge?.concepts||{},null,2)}

Recent tuning conversation:
${JSON.stringify(history,null,2)}

Translate the user's intent into structured state updates.

Important separation:
- INTEREST/EDITORIAL state controls WHAT gets selected.
- KNOWLEDGE state controls HOW deeply each concept is explained.
- A user's statement that they understand or do not understand something should update knowledge, not interest, unless they also explicitly express liking/disliking that topic.
- A user's liking/disliking of a topic or content format should update interest, not knowledge.
- Requests like "more news", "less GK", "more history" update story mix.
- Requests like "use less jargon", "be more conversational", "give me more technical detail" update language/style directives.
- Never infer that asking for an explanation means the user wants more stories about that topic.

Knowledge scores are 0-100:
0-20 beginner, 21-50 foundational, 51-75 competent, 76-100 advanced.
If the user says they know something well, set an appropriate score. If they say they do not understand it, lower or initialize it appropriately. Only modify concepts clearly supported by the message.

Interest scores are also 0-100 with 50 neutral. Make gradual changes unless the user uses strong language ("I hate", "never", "always", etc.).

Story mix uses approximate percentages across:
news, general_knowledge, deep_dive, history, science, business_case.
They MUST sum to 100. Treat them as editorial targets, not strict quotas.

Return ONLY valid JSON:
{
  "assistant":"brief natural-language confirmation of what changed",
  "topicScoreUpdates":{"topic name":0},
  "contentTypeScoreUpdates":{"news":0},
  "mixTargets":{"news":45,"general_knowledge":20,"deep_dive":15,"history":7,"science":8,"business_case":5},
  "knowledgeUpdates":[{"concept":"specific atomic concept","score":0}],
  "languageDirectives":["short durable instruction"],
  "editorialDirectives":["short durable instruction"]
}

For any field the user did not address, preserve the current state rather than resetting it.
`;

  try{
    const r=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:MODEL,input:prompt,max_output_tokens:2200})
    });
    const data=await r.json();
    if(!r.ok) return res.status(r.status).json({error:data?.error?.message||"OpenAI request failed"});

    const parsed=JSON.parse(cleanJson(extractOutputText(data)));
    const nextPrefs={
      ...prefs,
      topicScores:{...(prefs.topicScores||{})},
      contentTypeScores:{...(prefs.contentTypeScores||{})},
      mixTargets:normalizeMix(parsed.mixTargets||prefs.mixTargets),
      languageDirectives:Array.isArray(parsed.languageDirectives)?parsed.languageDirectives.slice(-12):(prefs.languageDirectives||[]),
      editorialDirectives:Array.isArray(parsed.editorialDirectives)?parsed.editorialDirectives.slice(-12):(prefs.editorialDirectives||[])
    };
    for(const [k,v] of Object.entries(parsed.topicScoreUpdates||{})) nextPrefs.topicScores[k]=clamp(v);
    for(const [k,v] of Object.entries(parsed.contentTypeScoreUpdates||{})) nextPrefs.contentTypeScores[k]=clamp(v);

    const nextKnowledge={
      concepts:{...(knowledge?.concepts||{})},
      seenEvents:{...(knowledge?.seenEvents||{})}
    };
    for(const u of parsed.knowledgeUpdates||[]){
      if(!u?.concept) continue;
      const key=canonicalConcept(u.concept);
      const current=nextKnowledge.concepts[key]||{label:u.concept,score:0,exposures:0};
      nextKnowledge.concepts[key]={...current,label:current.label||u.concept,score:clamp(u.score),updatedBy:"user",lastUpdated:new Date().toISOString()};
    }

    const entry={at:new Date().toISOString(),user:message,assistant:String(parsed.assistant||"Updated Neosis.")};
    nextPrefs.tuningHistory=[...history,entry].slice(-20);

    return res.status(200).json({
      assistant:entry.assistant,
      preferences:nextPrefs,
      knowledge:nextKnowledge,
      mixTargets:nextPrefs.mixTargets
    });
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Could not update Neosis settings"});
  }
};
