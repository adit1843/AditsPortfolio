const {requireAuth}=require("./_auth");
const {generateBriefAudio}=require("./_google_tts");

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;

function base(){
  return (SUPABASE_URL||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");
}
function headers(){
  return {
    apikey:SUPABASE_SECRET_KEY,
    Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type":"application/json",
    Prefer:"return=representation"
  };
}
async function getBrief(id){
  const r=await fetch(`${base()}/rest/v1/briefs?id=eq.${encodeURIComponent(id)}&select=*`,{headers:headers()});
  const data=await r.json();
  if(!r.ok) throw new Error(data?.message||"Could not load brief");
  return data?.[0]||null;
}
async function updateBrief(id,payload){
  const r=await fetch(`${base()}/rest/v1/briefs?id=eq.${encodeURIComponent(id)}`,{
    method:"PATCH",
    headers:headers(),
    body:JSON.stringify({payload})
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data?.message||"Could not save audio metadata");
  return data?.[0]||null;
}

module.exports=async function handler(req,res){
  if(!requireAuth(req,res)) return;
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  const briefId=req.body?.briefId;
  if(!briefId) return res.status(400).json({error:"briefId is required"});
  try{
    const row=await getBrief(briefId);
    if(!row?.payload) return res.status(404).json({error:"Brief not found"});
    if(row.payload.audio?.segments?.length){
      return res.status(200).json({
        ok:true,
        cached:true,
        brief:row.payload,
        audio:row.payload.audio
      });
    }
    const audio=await generateBriefAudio(row.payload,briefId);
    if(!audio?.configured){
      return res.status(503).json({error:"Google TTS is not configured."});
    }
    if(audio?.skipped){
      return res.status(429).json({
        error:"Monthly TTS character limit reached.",
        usage:audio.usage
      });
    }
    const brief={...row.payload,audio};
    await updateBrief(briefId,brief);
    return res.status(200).json({ok:true,cached:false,brief,audio});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Audio generation failed"});
  }
};