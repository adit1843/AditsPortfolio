const {insertUserRow}=require("./store");

const API_KEY=process.env.OPENAI_API_KEY;
const DEFAULT_MODEL=process.env.OPENAI_MODEL||"gpt-6-luna";

const BUILTIN_PRICING={
  "gpt-6-luna":{input:0.10,cachedInput:0.01,output:0.50,webSearch:0.01}
};

function number(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function pricingFor(model){
  let overrides={};
  try{overrides=JSON.parse(process.env.OPENAI_PRICING_JSON||"{}");}catch{}
  const raw=overrides?.[model]||overrides?.default||BUILTIN_PRICING[model];
  if(!raw)return null;
  return {
    input:number(raw.input),
    cachedInput:number(raw.cachedInput??raw.cached_input),
    output:number(raw.output),
    webSearch:number(raw.webSearch??raw.web_search)
  };
}
function webSearchCalls(data){
  let n=0;
  for(const item of data?.output||[]){
    if(item?.type!=="web_search_call")continue;
    const action=item?.action?.type||item?.action;
    if(!action||action==="search")n++;
  }
  return n;
}
function usageFrom(data){
  const u=data?.usage||{};
  return {
    inputTokens:Number(u.input_tokens)||0,
    cachedInputTokens:Number(u.input_tokens_details?.cached_tokens)||0,
    outputTokens:Number(u.output_tokens)||0,
    reasoningTokens:Number(u.output_tokens_details?.reasoning_tokens)||0,
    totalTokens:Number(u.total_tokens)||0,
    webSearchCalls:webSearchCalls(data)
  };
}
function estimateCost(model,u){
  const p=pricingFor(model);
  if(!p||p.input===null||p.output===null)return null;
  const uncached=Math.max(0,u.inputTokens-u.cachedInputTokens);
  const cachedRate=p.cachedInput===null?p.input:p.cachedInput;
  const searchRate=p.webSearch===null?0:p.webSearch;
  return Number(((uncached/1e6)*p.input+(u.cachedInputTokens/1e6)*cachedRate+(u.outputTokens/1e6)*p.output+u.webSearchCalls*searchRate).toFixed(8));
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
      web_search_calls:u.webSearchCalls,
      estimated_cost_usd:estimateCost(model,u)
    });
  }catch(e){console.error("Noesis usage logging failed:",e?.message||e);}
}
async function createResponse({userId,operation,input,model=DEFAULT_MODEL,tools,maxOutputTokens=10000,metadata={}}){
  if(!API_KEY)throw Object.assign(new Error("OPENAI_API_KEY is not configured."),{status:503});
  const body={model,input,max_output_tokens:maxOutputTokens,metadata:{...metadata,noesis_user_id:String(userId||"system"),noesis_operation:String(operation||"unknown")}};
  if(tools?.length)body.tools=tools;
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json();
  if(r.ok)await logUsage(userId,operation,model,data);
  if(!r.ok)throw Object.assign(new Error(data?.error?.message||"OpenAI request failed"),{status:r.status});
  const hitOutputLimit=data?.status==="incomplete"&&data?.incomplete_details?.reason==="max_output_tokens";
  const retryableDiscovery=/^(scheduled|manual)_discovery$/.test(String(operation||""));
  if(hitOutputLimit&&retryableDiscovery){
    const original=typeof input==="string"?input:JSON.stringify(input);
    return createResponse({
      userId,
      operation:operation+"_retry",
      input:original+"\n\nCRITICAL RETRY: The previous response hit the output-token limit. Return ONLY valid compact JSON. Produce 10-12 candidates maximum. Keep each title under 14 words, each summary under 25 words, arrays to 2 items maximum, and sources to 2 per candidate. Do not add any prose outside the JSON object.",
      model,
      tools,
      maxOutputTokens:Math.min(6500,maxOutputTokens),
      metadata:{...metadata,retry_reason:"max_output_tokens"}
    });
  }
  return data;
}
module.exports={createResponse,logUsage,usageFrom,estimateCost,DEFAULT_MODEL};
