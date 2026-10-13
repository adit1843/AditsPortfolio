const {createResponse}=require("./openai");
const {request}=require("./store");

function norm(v=""){return String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function toks(v=""){return new Set(norm(v).split(/\s+/).filter(x=>x.length>1));}
function overlap(a,b){const A=toks(a),B=toks(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0));}
function out(d){const p=[];for(const i of d.output||[]){if(i.type!=="message")continue;for(const c of i.content||[]){if(c.type==="output_text"&&c.text)p.push(c.text);}}return p.join("\n").trim();}
function clean(t){return String(t||"").replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();}
function parseObject(raw){
  const x=clean(raw);
  try{return JSON.parse(x);}catch{}
  const a=x.indexOf("{"),b=x.lastIndexOf("}");
  if(a>=0&&b>a)return JSON.parse(x.slice(a,b+1));
  throw new Error("Invalid JSON");
}
function domainFrom(v=""){
  try{
    const u=new URL(/^https?:\/\//i.test(v)?v:`https://${v}`);
    return u.hostname.toLowerCase().replace(/^www\./,"");
  }catch{return"";}
}
function summarizeKnowledge(knowledge={}){
  return Object.entries(knowledge?.concepts||{}).map(([key,v])=>({
    concept:v?.label||key,
    score:clamp(v?.score||0),
    exposures:Number(v?.exposures)||0
  })).sort((a,b)=>b.exposures-a.exposures||b.score-a.score).slice(0,120);
}
function normalizePlan(raw){
  let buckets=Array.isArray(raw?.buckets)?raw.buckets:[];
  buckets=buckets.slice(0,10).map((b,i)=>({
    id:String(b.id||`bucket-${i+1}`).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),
    topic:String(b.topic||"General").trim(),
    aliases:Array.isArray(b.aliases)?b.aliases.map(String).filter(Boolean).slice(0,8):[],
    share:clamp(b.share||0),
    knowledgeLevel:clamp(b.knowledgeLevel||0),
    researchNotes:String(b.researchNotes||"").slice(0,500)
  })).filter(b=>b.topic);
  if(!buckets.length)buckets=[{id:"general",topic:"General",aliases:[],share:100,knowledgeLevel:0,researchNotes:""}];
  let total=buckets.reduce((s,b)=>s+b.share,0);
  if(!total){buckets[0].share=100;total=100;}
  let used=0;
  buckets=buckets.map((b,i)=>{
    const share=i===buckets.length-1?100-used:Math.max(0,Math.round(b.share/total*100));
    used+=share;
    return {...b,share};
  });
  const candidateTotal=20;
  let allocated=0;
  buckets=buckets.map((b,i)=>{
    const candidateTarget=i===buckets.length-1?Math.max(1,candidateTotal-allocated):Math.max(1,Math.round(candidateTotal*b.share/100));
    allocated+=candidateTarget;
    return {...b,candidateTarget};
  });
  return {buckets,openWebFallbackPercent:clamp(raw?.openWebFallbackPercent??10,0,25)};
}
async function buildContentPlan({userId,date,preferences={},knowledge={},coverage=[]}){
  const prompt=`You are Neosis's CONTENT PLANNER. Do not research stories and do not choose publishers yet.

Today is ${date}.

First inspect the listener's interest model and knowledge model. Decide what today's candidate-discovery budget should be about BEFORE any source selection happens.

Interest model / editorial controls:
${JSON.stringify(preferences)}

Knowledge model summary:
${JSON.stringify(summarizeKnowledge(knowledge))}

Recent coverage:
${JSON.stringify((coverage||[]).slice(0,10))}

Rules:
- Interest determines WHAT proportion of the edition should be about each subject.
- Knowledge determines the sophistication of research/explanation, never whether a subject is selected.
- Explicit editorialDirectives/requestedTopics outrank every passive behavioral signal.
- behavioralInterest is learned from actual use. Treat longTerm as durable affinity, recent as short-term momentum, confidence as how much evidence exists, and lastUpdated as recency.
- Use roughly 70% long-term affinity and 30% recent momentum when behavioral evidence is confident. Low-confidence inferences should barely move the allocation.
- Passive negative behavior is intentionally weak; repeated evidence matters more than one skip.
- Preserve arbitrary interests literally. If the listener wants Bollywood, F1, sourdough, Tamil cinema, robotics, bond markets, gardening, or anything else, create that topic.
- Use 2-8 meaningful content buckets normally. A tightly specialized show may use 1-3.
- Shares must sum to 100.
- A 50% interest allocation should receive about half the candidate-discovery attention.
- Use recent coverage only to avoid stale repetition, not to erase durable interests.
- Reserve 0-15% for an open-web wildcard only if useful.

Return ONLY compact JSON:
{"buckets":[{"id":"stable-kebab-id","topic":"specific subject","aliases":["related search phrase"],"share":0,"knowledgeLevel":0,"researchNotes":"what depth/angles to prefer or avoid"}],"openWebFallbackPercent":10}`;
  const d=await createResponse({userId,operation:"content_plan",input:prompt,maxOutputTokens:2200});
  return normalizePlan(parseObject(out(d)));
}
function sourceScore(row,bucket){
  const weights=row?.topic_weights&&typeof row.topic_weights==="object"?row.topic_weights:{};
  const terms=[bucket.topic,...(bucket.aliases||[])];
  let best=0;
  for(const [topic,w] of Object.entries(weights)){
    for(const term of terms){
      const sim=Math.max(overlap(topic,term),norm(topic)===norm(term)?1:0);
      best=Math.max(best,Number(w||0)*sim);
    }
  }
  return best*(0.7+clamp(row.quality_score||70)/100*.3);
}
async function discoverSourcesForBucket({userId,bucket}){
  const prompt=`You are Neosis's SOURCE DISCOVERY layer.

Topic: ${bucket.topic}
Aliases: ${JSON.stringify(bucket.aliases||[])}
Research depth: ${bucket.researchNotes||""}

Use web search to find 12-20 real, active, credible sources that consistently cover this topic. Build a reusable source ecosystem, not a list of today's stories.

Prefer a mix where appropriate:
- primary/official sources
- specialist/trade publications
- high-quality general publishers with strong subject coverage
- credible regional/local sources when the topic calls for them

Avoid content farms, scraped aggregators, SEO spam, and duplicate domains.
Do not invent publishers or domains. Only return sources you can substantiate from web search.
Return ONLY compact JSON:
{"sources":[{"name":"publisher/source","domain":"example.com","type":"primary | secondary","qualityScore":0,"topicWeight":0}]}`;
  const d=await createResponse({userId,operation:"source_registry_discovery",input:prompt,tools:[{type:"web_search"}],maxOutputTokens:3000});
  let parsed;
  try{parsed=parseObject(out(d));}catch{return[];}
  const rows=[];
  for(const s of parsed?.sources||[]){
    const domain=domainFrom(s.domain||"");
    if(!domain)continue;
    rows.push({
      domain,
      name:String(s.name||domain).slice(0,160),
      source_type:String(s.type||"secondary").toLowerCase()==="primary"?"primary":"secondary",
      quality_score:clamp(s.qualityScore||75),
      topic_weight:Math.max(0,Math.min(1,Number(s.topicWeight)||0.75))
    });
  }
  return rows.slice(0,20);
}
async function upsertDiscovered(bucket,rows){
  await Promise.all((rows||[]).map(async s=>{
    const existing=await request(`source_registry?domain=eq.${encodeURIComponent(s.domain)}&select=*&limit=1`).catch(()=>[]);
    const now=new Date().toISOString();
    if(existing?.[0]){
      const tw={...(existing[0].topic_weights||{})};
      tw[norm(bucket.topic)]=Math.max(Number(tw[norm(bucket.topic)]||0),s.topic_weight);
      return request(`source_registry?domain=eq.${encodeURIComponent(s.domain)}`,{
        method:"PATCH",
        body:JSON.stringify({
          name:s.name||existing[0].name,
          source_type:existing[0].source_type==="primary"?"primary":s.source_type,
          quality_score:Math.max(Number(existing[0].quality_score)||0,s.quality_score),
          topic_weights:tw,
          discovered_by:existing[0].discovered_by||"dynamic",
          active:true,
          updated_at:now,
          last_validated_at:now
        })
      });
    }
    return request("source_registry",{
      method:"POST",
      body:JSON.stringify([{
        domain:s.domain,
        name:s.name,
        source_type:s.source_type,
        quality_score:s.quality_score,
        topic_weights:{[norm(bucket.topic)]:s.topic_weight},
        discovered_by:"dynamic",
        active:true,
        last_validated_at:now
      }])
    });
  }));
}
async function resolveSourcePlan({userId,contentPlan}){
  let registry=await request("source_registry?active=eq.true&select=*&limit=5000");
  const scoreBucket=bucket=>(registry||[])
    .map(row=>({row,score:sourceScore(row,bucket)}))
    .filter(x=>x.score>=0.18)
    .sort((a,b)=>b.score-a.score);

  const gaps=(contentPlan.buckets||[]).filter(bucket=>scoreBucket(bucket).length<8);

  if(gaps.length){
    const discoveries=await Promise.all(
      gaps.map(async bucket=>{
        try{return {bucket,rows:await discoverSourcesForBucket({userId,bucket})};}
        catch{return {bucket,rows:[]};}
      })
    );

    await Promise.all(
      discoveries
        .filter(x=>x.rows.length)
        .map(x=>upsertDiscovered(x.bucket,x.rows).catch(()=>null))
    );

    registry=await request("source_registry?active=eq.true&select=*&limit=5000");
  }

  const buckets=(contentPlan.buckets||[]).map(bucket=>{
    const scored=scoreBucket(bucket);
    const primary=scored.filter(x=>x.row.source_type==="primary").slice(0,5);
    const secondary=scored.filter(x=>x.row.source_type!=="primary").slice(0,13);
    const chosen=[...primary,...secondary]
      .sort((a,b)=>b.score-a.score)
      .slice(0,16)
      .map(x=>({
        name:x.row.name,
        domain:x.row.domain,
        type:x.row.source_type,
        qualityScore:x.row.quality_score,
        relevance:Number(x.score.toFixed(3))
      }));
    return {...bucket,sources:chosen};
  });

  const domains=[...new Set(buckets.flatMap(b=>b.sources.map(s=>s.domain)))].slice(0,100);
  return {buckets,domains,registrySize:(registry||[]).length,openWebFallbackPercent:contentPlan.openWebFallbackPercent};
}
function webSearchTool(sourcePlan){
  const domains=(sourcePlan?.domains||[]).filter(Boolean).slice(0,100);
  return domains.length?{type:"web_search",filters:{allowed_domains:domains}}:{type:"web_search"};
}
module.exports={buildContentPlan,resolveSourcePlan,webSearchTool};
