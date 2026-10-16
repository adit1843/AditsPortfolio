const {createSession,cookieHeader}=require("../lib/briefline/auth");
const {getProfile}=require("../lib/briefline/store");

const U=process.env.SUPABASE_URL;
const A=process.env.SUPABASE_ANON_KEY;
const SITE=(process.env.NOESIS_SITE_URL||"https://aditsanghani.com").replace(/\/+$/,"");

function base(){return (U||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");}
function callbackUrl(mode){return `${SITE}/briefing/auth-callback.html?mode=${encodeURIComponent(mode)}`;}
async function assertActive(userId){
  const p=await getProfile(userId).catch(()=>null);
  if(p&&p.account_active===false)throw Object.assign(new Error("This Noesis account is disabled."),{status:403});
}

async function call(path,body){
  const r=await fetch(`${base()}/auth/v1/${path}`,{
    method:"POST",
    headers:{apikey:A,"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok){
    let message=d?.msg||d?.error_description||d?.message||"Authentication failed";
    if(/email rate limit/i.test(message)) message="Too many emails were requested. Please wait a few minutes and try again.";
    if(/invalid login credentials/i.test(message)) message="That email or password doesn’t look right.";
    throw Object.assign(new Error(message),{status:r.status});
  }
  return d;
}

module.exports=async(req,res)=>{
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
  if(!U||!A||!process.env.BRIEFLINE_SESSION_SECRET)return res.status(503).json({error:"Noesis authentication is not fully configured."});

  const action=String(req.body?.action||"signin");
  const email=String(req.body?.email||"").trim().toLowerCase();
  const password=String(req.body?.password||"");

  try{
    if(action==="exchange"){
      const token=String(req.body?.accessToken||"");
      if(!token)return res.status(400).json({error:"Invalid verification session."});
      const r=await fetch(`${base()}/auth/v1/user`,{headers:{apikey:A,Authorization:`Bearer ${token}`}});
      const user=await r.json().catch(()=>({}));
      if(!r.ok||!user?.id)throw Object.assign(new Error(user?.message||"This verification link is invalid or expired."),{status:401});
      await assertActive(user.id);
      res.setHeader("Set-Cookie",cookieHeader(createSession(user)));
      return res.status(200).json({ok:true,user:{id:user.id,email:user.email}});
    }

    if(action==="reset"){
      const token=String(req.body?.accessToken||"");
      const newPassword=String(req.body?.password||"");
      if(!token)return res.status(400).json({error:"Your reset link is invalid or expired."});
      if(newPassword.length<8)return res.status(400).json({error:"Use at least 8 characters for your new password."});
      const r=await fetch(`${base()}/auth/v1/user`,{
        method:"PUT",
        headers:{apikey:A,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
        body:JSON.stringify({password:newPassword})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw Object.assign(new Error(d?.msg||d?.message||"Could not update password"),{status:r.status});
      return res.status(200).json({ok:true});
    }

    if(action==="recover"){
      if(!email)return res.status(400).json({error:"Enter your email address."});
      await call(`recover?redirect_to=${encodeURIComponent(callbackUrl("recovery"))}`,{email});
      return res.status(200).json({ok:true,message:"If an account exists for that email, a reset link is on its way."});
    }

    if(action==="resend"){
      if(!email)return res.status(400).json({error:"Enter your email address."});
      await call(`resend?redirect_to=${encodeURIComponent(callbackUrl("signup"))}`,{type:"signup",email});
      return res.status(200).json({ok:true,message:"Verification email sent."});
    }

    if(!email||!password)return res.status(400).json({error:"Email and password are required."});
    if(password.length<8)return res.status(400).json({error:"Use at least 8 characters for your password."});

    if(action==="signup"){
      const d=await call(`signup?redirect_to=${encodeURIComponent(callbackUrl("signup"))}`,{email,password});
      if(d?.access_token&&d?.user?.id){
        await assertActive(d.user.id);
        res.setHeader("Set-Cookie",cookieHeader(createSession(d.user)));
        return res.status(200).json({ok:true,authenticated:true});
      }
      return res.status(200).json({
        ok:true,
        authenticated:false,
        confirmationRequired:true,
        message:"Check your inbox to verify your email."
      });
    }

    const d=await call("token?grant_type=password",{email,password});
    if(!d?.user?.id)throw new Error("No user was returned.");
    await assertActive(d.user.id);
    res.setHeader("Set-Cookie",cookieHeader(createSession(d.user)));
    return res.status(200).json({ok:true,authenticated:true});
  }catch(e){
    return res.status(e.status||401).json({error:e.message||"Authentication failed"});
  }
};