const {buildDailyEmail}=require("../lib/briefline/daily-email");
const {listProfiles,userRows}=require("../lib/briefline/store");
module.exports=async(req,res)=>{
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  if(req.query?.token!=="neosis-test-20261013-4f7c9a2d")return res.status(401).json({error:"Unauthorized"});
  const to=process.env.SURVEY_EMAIL_TO;
  const key=process.env.RESEND_API_KEY;
  const base=process.env.SITE_URL;
  if(!to||!key||!base)return res.status(500).json({error:"Email configuration missing"});
  try{
    const profiles=await listProfiles();
    const profile=profiles.find(p=>String(p.email||"").toLowerCase()===String(to).toLowerCase())||profiles[0];
    let brief=null,id="test";
    if(profile){
      const briefs=await userRows("briefs",profile.user_id,{limit:1});
      if(briefs?.[0]?.payload){brief=briefs[0].payload;id=briefs[0].id;}
    }
    if(!brief)brief={
      date:"October 13, 2026",
      readTime:"~15 min",
      intro:"A thoughtful selection of what matters today, tuned to your interests and what you already know.",
      stories:[
        {title:"AI infrastructure enters its next constraint cycle",summary:"The focus is shifting beyond GPUs toward power, networking, deployment speed, and utilization."},
        {title:"Markets reassess the path ahead",summary:"Fresh economic signals are changing expectations around rates, investment, and risk."}
      ]
    };
    const email=buildDailyEmail({brief,briefId:id,baseUrl:base,audioEnabled:true});
    const rr=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from:"Neosis <briefline@mail.aditsanghani.com>",to:[to],subject:"TEST · "+email.subject,html:email.html,text:email.text})});
    const data=await rr.json();
    if(!rr.ok)throw new Error(data?.message||"Email failed");
    return res.status(200).json({ok:true,id:data.id,usedSavedBrief:Boolean(id!=="test")});
  }catch(e){return res.status(500).json({error:e instanceof Error?e.message:"Test email failed"});}
};