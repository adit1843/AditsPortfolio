const {requireAuth}=require("../lib/briefline/auth");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function ready(){return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);}
function supabaseBase(){
  if(!SUPABASE_URL) return "";
  return SUPABASE_URL.replace(/\/+$/,"").replace(/\/rest\/v1$/,"");
}
function headers(){return {
  "apikey": SUPABASE_SECRET_KEY,
  "Authorization": `Bearer ${SUPABASE_SECRET_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "return=representation"
};}
async function call(path, options={}){
  const r=await fetch(`${supabaseBase()}/rest/v1/${path}`,{...options,headers:{...headers(),...(options.headers||{})}});
  const text=await r.text();
  let data=null; try{data=text?JSON.parse(text):null;}catch{data=text;}
  if(!r.ok) throw new Error(typeof data==="object"?(data.message||JSON.stringify(data)):String(data||r.statusText));
  return data;
}

module.exports = async function handler(req,res){
  if(!requireAuth(req,res)) return;
  if(!ready()) return res.status(503).json({error:"Supabase is not configured."});
  const {resource}=req.query||{};
  const allowed=new Set(["briefs","explainers","preferences","knowledge","coverage","surveys"]);
  if(!allowed.has(resource)) return res.status(400).json({error:"Unknown resource"});
  try{
    if(req.method==="GET"){
      const data=await call(`${resource}?select=*&order=created_at.desc&limit=100`);
      return res.status(200).json({data});
    }
    if(req.method==="POST"){
      const payload=Array.isArray(req.body)?req.body:[req.body];
      const data=await call(resource,{method:"POST",body:JSON.stringify(payload)});
      return res.status(200).json({data});
    }
    res.setHeader("Allow","GET, POST");
    return res.status(405).json({error:"Method not allowed"});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Supabase request failed"});
  }
}
