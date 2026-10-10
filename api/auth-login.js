const crypto=require("crypto");
const {createSession,cookieHeader}=require("./_auth");

module.exports=async function handler(req,res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  const expected=process.env.BRIEFLINE_PASSWORD;
  const supplied=String(req.body?.password||"");
  if(!expected || !process.env.BRIEFLINE_SESSION_SECRET){
    return res.status(503).json({error:"Briefline authentication is not configured."});
  }
  const a=Buffer.from(expected);
  const b=Buffer.from(supplied);
  const ok=a.length===b.length && crypto.timingSafeEqual(a,b);
  if(!ok) return res.status(401).json({error:"Incorrect password."});
  const token=createSession();
  res.setHeader("Set-Cookie",cookieHeader(token));
  return res.status(200).json({ok:true});
};
