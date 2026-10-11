const {requireAuth}=require("../lib/briefline/auth");
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const BUCKET=process.env.BRIEFLINE_AUDIO_BUCKET||"briefline-audio";
function base(){return (SUPABASE_URL||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");}
module.exports=async function handler(req,res){
  if(!requireAuth(req,res)) return;
  const path=String(req.query?.path||"");
  if(!path || path.includes("..")) return res.status(400).json({error:"Invalid audio path"});
  try{
    const r=await fetch(`${base()}/storage/v1/object/${BUCKET}/${path}`,{
      headers:{
        apikey:SUPABASE_SECRET_KEY,
        Authorization:`Bearer ${SUPABASE_SECRET_KEY}`
      }
    });
    if(!r.ok) return res.status(r.status).json({error:"Audio not found"});
    const buf=Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type","audio/mpeg");
    res.setHeader("Cache-Control","private, max-age=86400");
    res.setHeader("Content-Length",String(buf.length));
    return res.status(200).send(buf);
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Audio failed"});
  }
};