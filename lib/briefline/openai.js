const {insertUserRow}=require("./store");

const API_KEY=process.env.OPENAI_API_KEY;
const DEFAULT_MODEL=process.env.OPENAI_MODEL||"gpt-6-luna";

function number(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function pricingFor(model){
  try{
    const map=JSON.parse(process.env.OPENAI_PRICING_JSON||"{}");
    const p=map?.[model]||map?.default;
    if(!p)return null;
    return {
      input:number(p.input),
      cachedInput:number(p.cachedInput??p.cached_input),
      output:number(p.output)
    };
  }catch{return null;}
}
function usageFrom(data){
  const u=data?.usage||{};
  return {
    inputTokens:Number(u.input_tokens)||0,
    cachedInputTokens:Number(u.input_tokens_details?.cached_tokens)||0,
    outputTokens:Number(u.output_tokens)||0,
    reasoningTokens:Number(u.output_tokens_details?.reasoning_tokens)||0,
    totalTokens:Number(u.total_tokens)||0
  };
}
function estimateCost(model,u){
  const p=pricingFor(model);
  if(!p||p.input===null||p.output===null)return null;
  const uncached=Math.max(0,u.inputTokens-u.cachedInputTokens);
  const cachedRate=p.cachedInput===null?p.input:p.cachedInput;
  return Number(((uncached/1e6)*p.input+(u.cachedInputTokens/1e6)*cachedRate+(u.outputTokens/1e6)*p.output).toFixed(8));
}
async function logUsage(userId,operation,model,data){
  if(!userId)return;
  const u=usageFrom(data);
  try{
    await insertUserRow("api_usage",userId,{
      provider:"openai",
      operation,
      model,
      response_id:data?.id||null,
      input_tokens:u.inputTokens,
      cached_input_tokens:u.cachedInputTokens,
      output_tokens:u.outputTokens,
      reasoning_tokens:u.reasoningTokens,
      total_tokens:u.totalTokens,
      estimated_cost_usd:estimateCost(model,u)
    });
  }catch(e){
    console.error("Neosis usage logging failed:",e?.message||e);
  }
}
async function createResponse({userId,operation,input,model=DEFAULT_MODEL,tools,maxOutputTokens=10000,metadata={}}){
  if(!API_KEY)throw Object.assign(new Error("OPENAI_API_KEY is not configured."),{status:503});
  const body={
    model,
    input,
    max_output_tokens:maxOutputTokens,
    metadata:{...metadata,neosis_user_id:String(userId||"system"),neosis_operation:String(operation||"unknown")}
  };
  if(tools?.length)body.tools=tools;
  const r=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await r.json();
  if(r.ok)await logUsage(userId,operation,model,data);
  if(!r.ok)throw Object.assign(new Error(data?.error?.message||"OpenAI request failed"),{status:r.status});
  return data;
}
module.exports={createResponse,logUsage,usageFrom,estimateCost,DEFAULT_MODEL};
