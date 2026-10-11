const U=process.env.SUPABASE_URL,A=process.env.SUPABASE_ANON_KEY;
function base(){return (U||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");}
module.exports=async(req,res)=>{
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
  const token=String(req.body?.accessToken||"");
  const password=String(req.body?.password||"");
  if(!token)return res.status(400).json({error:"Your reset link is invalid or expired."});
  if(password.length<8)return res.status(400).json({error:"Use at least 8 characters for your new password."});
  try{
    const r=await fetch(`${base()}/auth/v1/user`,{
      method:"PUT",
      headers:{apikey:A,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({password})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw Object.assign(new Error(d?.msg||d?.message||"Could not update password"),{status:r.status});
    return res.status(200).json({ok:true});
  }catch(e){return res.status(e.status||400).json({error:e.message||"Could not update password"});}
};