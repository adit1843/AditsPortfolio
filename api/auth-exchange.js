const {createSession,cookieHeader}=require("../lib/briefline/auth");
const U=process.env.SUPABASE_URL,A=process.env.SUPABASE_ANON_KEY;
function base(){return (U||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");}
module.exports=async(req,res)=>{
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
  const token=String(req.body?.accessToken||"");
  if(!token||!U||!A)return res.status(400).json({error:"Invalid verification session."});
  try{
    const r=await fetch(`${base()}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${token}`}});
    const user=await r.json();
    if(!r.ok||!user?.id)throw new Error(user?.message||"This verification link is invalid or expired.");
    res.setHeader("Set-Cookie",cookieHeader(createSession(user)));
    return res.status(200).json({ok:true,user:{id:user.id,email:user.email}});
  }catch(e){return res.status(401).json({error:e.message||"Could not verify account"});}
};