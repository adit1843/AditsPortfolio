const {requireAuth}=require("./_auth");
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SURVEY_EMAIL_TO = process.env.SURVEY_EMAIL_TO;
const SITE_URL = process.env.SITE_URL;

module.exports = async function handler(req,res){
  if(!requireAuth(req,res)) return;
  if(req.method==="GET"){
    return res.status(200).json({
      configured:Boolean(RESEND_API_KEY && SURVEY_EMAIL_TO && SITE_URL)
    });
  }
  if(req.method!=="POST"){
    res.setHeader("Allow","GET, POST");
    return res.status(405).json({error:"Method not allowed"});
  }
  if(!RESEND_API_KEY || !SURVEY_EMAIL_TO || !SITE_URL){
    return res.status(503).json({error:"Survey email is not configured yet."});
  }
  const briefDate=req.body?.briefDate||"today";
  const surveyUrl=`${SITE_URL.replace(/\/$/,"")}/briefing/?survey=1`;
  const html=`
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#171717">
      <p style="text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#777">Daily Brief</p>
      <h1 style="font-family:Georgia,serif">How was today's brief?</h1>
      <p>You've finished the ${briefDate} edition. A short survey will help tomorrow's briefing improve without overreacting to one story.</p>
      <p><a href="${surveyUrl}" style="display:inline-block;background:#171717;color:white;text-decoration:none;padding:12px 18px;border-radius:999px">Take the survey</a></p>
    </div>`;
  try{
    const r=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${RESEND_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        from:"Briefline <briefline@mail.aditsanghani.com>",
        to:[SURVEY_EMAIL_TO],
        subject:`How was your ${briefDate} Daily Brief?`,
        html
      })
    });
    const data=await r.json();
    if(!r.ok) return res.status(r.status).json({error:data?.message||"Email send failed"});
    return res.status(200).json({ok:true,id:data.id});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Unexpected email error"});
  }
}
