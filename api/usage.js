const {requireAuth}=require("../lib/briefline/auth");
const {request,userRows}=require("../lib/briefline/store");

function summarize(rows){
  const byUser={};
  for(const r of rows||[]){
    const uid=r.user_id||"unknown";
    const x=byUser[uid]||(byUser[uid]={userId:uid,requests:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0,estimatedCostUsd:0,costConfigured:true,operations:{}});
    x.requests++;
    x.inputTokens+=Number(r.input_tokens)||0;
    x.cachedInputTokens+=Number(r.cached_input_tokens)||0;
    x.outputTokens+=Number(r.output_tokens)||0;
    x.reasoningTokens+=Number(r.reasoning_tokens)||0;
    x.totalTokens+=Number(r.total_tokens)||0;
    if(r.estimated_cost_usd===null||r.estimated_cost_usd===undefined)x.costConfigured=false;
    else x.estimatedCostUsd+=Number(r.estimated_cost_usd)||0;
    const op=r.operation||"unknown";x.operations[op]=(x.operations[op]||0)+1;
  }
  return Object.values(byUser).map(x=>({...x,estimatedCostUsd:x.costConfigured?Number(x.estimatedCostUsd.toFixed(6)):null}));
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
    if(req.query?.scope==="all"){
      if(!owner)return res.status(403).json({error:"Owner access required."});
      rows=await request(`api_usage?select=*&${filter}&order=created_at.desc&limit=10000`);
      const profiles=await request("profiles?select=user_id,email,display_name&order=created_at.asc&limit=1000");
      const names=Object.fromEntries((profiles||[]).map(p=>[p.user_id,{email:p.email,displayName:p.display_name||""}]));
      return res.status(200).json({month,scope:"all",users:summarize(rows).map(x=>({...x,...(names[x.userId]||{})}))});
    }
    rows=await request(`api_usage?user_id=eq.${encodeURIComponent(s.userId)}&select=*&${filter}&order=created_at.desc&limit=5000`);
    return res.status(200).json({month,scope:"self",usage:summarize(rows)[0]||{userId:s.userId,requests:0,inputTokens:0,cachedInputTokens:0,outputTokens:0,reasoningTokens:0,totalTokens:0,estimatedCostUsd:0,costConfigured:true,operations:{}}});
  }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"Could not load usage"});}
};