const {getSession,clearCookieHeader}=require("../lib/briefline/auth");
const {getProfile}=require("../lib/briefline/store");
module.exports=async(req,res)=>{
  const s=getSession(req);
  if(!s)return res.status(200).json({authenticated:false,onboarded:false});
  try{
    const p=await getProfile(s.userId);
    if(p?.account_active===false){
      res.setHeader("Set-Cookie",clearCookieHeader());
      return res.status(200).json({authenticated:false,onboarded:false,disabled:true});
    }
    return res.status(200).json({authenticated:true,onboarded:Boolean(p?.onboarding_complete),user:{id:s.userId,email:s.email,displayName:p?.display_name||""}});
  }catch{
    return res.status(200).json({authenticated:true,onboarded:false,user:{id:s.userId,email:s.email}});
  }
};