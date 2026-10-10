const {requireAuth}=require("./_auth");

const RESEND_API_KEY=process.env.RESEND_API_KEY;

module.exports=async function handler(req,res){
  if(!requireAuth(req,res)) return;
  if(!RESEND_API_KEY) return res.status(503).json({error:"RESEND_API_KEY is not configured."});
  try{
    const r=await fetch("https://api.resend.com/emails?limit=10",{
      headers:{Authorization:`Bearer ${RESEND_API_KEY}`}
    });
    const data=await r.json();
    if(!r.ok) throw new Error(data?.message||"Could not read Resend email status");
    const emails=(data?.data||data||[]).map(e=>({
      id:e.id,
      to:e.to,
      subject:e.subject,
      created_at:e.created_at,
      last_event:e.last_event
    }));
    return res.status(200).json({emails});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Email status check failed"});
  }
};
