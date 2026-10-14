const {requireAuth}=require("../lib/briefline/auth");
const {request,userRows}=require("../lib/briefline/store");

function summarize(rows){
  const byUser={};
  for(const r of rows||[]){
    const uid=r.user_id||"unknown";
    const x=byUser[uid]||(byUser[uid]={userId:uid,requests:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0,webSearchCalls:0,estimatedCostUsd:0,costConfigured:true,ttsCharacters:0,billableTtsCharacters:0,providers:{},operations:{}});
    x.requests++;
    x.inputTokens+=Number(r.input_tokens)||0;
    x.cachedInputTokens+=Number(r.cached_input_tokens)||0;
    x.outputTokens+=Number(r.output_tokens)||0;
    x.reasoningTokens+=Number(r.reasoning_tokens)||0;
    x.totalTokens+=Number(r.total_tokens)||0;
    x.webSearchCalls+=Number(r.web_search_calls)||0;
    x.ttsCharacters+=Number(r.tts_characters)||0;
    x.billableTtsCharacters+=Number(r.billable_tts_characters)||0;
    const provider=r.provider||"unknown";
    const pv=x.providers[provider]||(x.providers[provider]={requests:0,estimatedCostUsd:0,costConfigured:true,ttsCharacters:0,totalTokens:0});
    pv.requests++;
    pv.totalTokens+=Number(r.total_tokens)||0;
    pv.ttsCharacters+=Number(r.tts_characters)||0;
    if(r.estimated_cost_usd===null||r.estimated_cost_usd===undefined)pv.costConfigured=false;
    else pv.estimatedCostUsd+=Number(r.estimated_cost_usd)||0;
    if(r.estimated_cost_usd===null||r.estimated_cost_usd===undefined)x.costConfigured=false;
    else x.estimatedCostUsd+=Number(r.estimated_cost_usd)||0;
    const op=r.operation||"unknown";x.operations[op]=(x.operations[op]||0)+1;
  }
  return Object.values(byUser).map(x=>({...x,estimatedCostUsd:x.costConfigured?Number(x.estimatedCostUsd.toFixed(6)):null,providers:Object.fromEntries(Object.entries(x.providers).map(([k,v])=>[k,{...v,estimatedCostUsd:v.costConfigured?Number(v.estimatedCostUsd.toFixed(6)):null}]))}));
}

function chapterRows(brief,events){
  const payload=brief?.payload||{},segments=Array.isArray(payload?.audio?.segments)?payload.audio.segments:[],stories=Array.isArray(payload?.stories)?payload.stories:[];
  const storyMap=Object.fromEntries(stories.map(x=>[String(x.id),x]));
  const chapters=[],seen=new Set();
  for(const seg of segments){
    const key=seg?.storyId?String(seg.storyId):String(seg?.kind||"chapter");
    if(seen.has(key))continue;seen.add(key);
    const story=storyMap[key];
    chapters.push({
      key,
      label:String(seg?.label||story?.title||(key==="intro"?"Introduction":key==="outro"?"Closing":"Chapter")),
      kind:String(seg?.kind||"story")
    });
  }
  return chapters.map(ch=>{
    const matching=(events||[]).filter(e=>String(e.brief_id)===String(brief.id)&&String(e.story_id||"")===ch.key);
    const explicit=matching.some(e=>e.event_type==="audio_chapter_complete");
    const progress=Math.max(0,...matching.filter(e=>e.event_type==="audio_progress").map(e=>Number(e?.payload?.value)||0));
    return {...ch,completed:explicit||progress>=1,progress:explicit?1:progress};
  });
}

module.exports=async(req,res)=>{
  const s=requireAuth(req,res);if(!s)return;
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  try{
    const month=String(req.query?.month||new Date().toISOString().slice(0,7));
    if(!/^\d{4}-\d{2}$/.test(month))return res.status(400).json({error:"month must be YYYY-MM"});
    const start=`${month}-01T00:00:00.000Z`;
    const next=new Date(start);next.setUTCMonth(next.getUTCMonth()+1);
    const filter=`created_at=gte.${encodeURIComponent(start)}&created_at=lt.${encodeURIComponent(next.toISOString())}`;
    const owner=process.env.SURVEY_EMAIL_TO&&String(s.email||"").toLowerCase()===String(process.env.SURVEY_EMAIL_TO).toLowerCase();
    let rows;
    if(req.query?.scope==="audio_completion"){
      if(!owner)return res.status(403).json({error:"Owner access required."});
      const [profiles,briefs,events]=await Promise.all([
        request("profiles?select=user_id,email,display_name&order=created_at.asc&limit=1000"),
        request("briefs?select=id,user_id,brief_date,payload,created_at&order=created_at.desc&limit=5000"),
        request("recommendation_events?select=user_id,event_type,brief_id,story_id,payload,created_at&order=created_at.desc&limit=10000")
      ]);
      const latest={};
      for(const b of briefs||[])if(!latest[b.user_id])latest[b.user_id]=b;
      const users=(profiles||[]).map(p=>{
        const brief=latest[p.user_id]||null;
        const chapters=brief?chapterRows(brief,(events||[]).filter(e=>e.user_id===p.user_id)):[];
        return {
          userId:p.user_id,
          email:p.email,
          displayName:p.display_name||"",
          briefId:brief?.id||null,
          briefDate:brief?.brief_date||brief?.payload?.date||null,
          chapters,
          completed:chapters.filter(x=>x.completed).length,
          total:chapters.length
        };
      });
      return res.status(200).json({scope:"audio_completion",users});
    }
    if(req.query?.scope==="all"){
      if(!owner)return res.status(403).json({error:"Owner access required."});
      rows=await request(`api_usage?select=*&${filter}&order=created_at.desc&limit=10000`);
      const profiles=await request("profiles?select=user_id,email,display_name&order=created_at.asc&limit=1000");
      const names=Object.fromEntries((profiles||[]).map(p=>[p.user_id,{email:p.email,displayName:p.display_name||""}]));
      return res.status(200).json({month,scope:"all",users:summarize(rows).map(x=>({...x,...(names[x.userId]||{})}))});
    }
    rows=await request(`api_usage?user_id=eq.${encodeURIComponent(s.userId)}&select=*&${filter}&order=created_at.desc&limit=5000`);
    return res.status(200).json({month,scope:"self",usage:summarize(rows)[0]||{userId:s.userId,requests:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0,webSearchCalls:0,estimatedCostUsd:0,costConfigured:true,ttsCharacters:0,billableTtsCharacters:0,providers:{},operations:{}}});
  }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"Could not load usage"});}
};