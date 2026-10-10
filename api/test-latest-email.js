const {requireAuth}=require("./_auth");

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const RESEND_API_KEY=process.env.RESEND_API_KEY;
const SURVEY_EMAIL_TO=process.env.SURVEY_EMAIL_TO;
const SITE_URL=process.env.SITE_URL;

function base(){return (SUPABASE_URL||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");}
function headers(){return {
  apikey:SUPABASE_SECRET_KEY,
  Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
  "Content-Type":"application/json"
};}

module.exports=async function handler(req,res){
  if(!requireAuth(req,res)) return;
  try{
    const r=await fetch(`${base()}/rest/v1/briefs?select=*&order=created_at.desc&limit=1`,{headers:headers()});
    const rows=await r.json();
    if(!r.ok) throw new Error(rows?.message||"Could not load latest brief");
    const row=rows?.[0];
    if(!row) throw new Error("No saved brief found");

    const brief=row.payload;
    const site=(SITE_URL||"").replace(/\/$/,"");
    const briefUrl=`${site}/briefing/?brief=${encodeURIComponent(row.id)}`;
    const surveyUrl=`${site}/briefing/?survey=1&brief=${encodeURIComponent(row.id)}`;

    const er=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{
        Authorization:`Bearer ${RESEND_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        from:"Briefline <briefline@mail.aditsanghani.com>",
        to:[SURVEY_EMAIL_TO],
        subject:`TEST · Your ${brief.date} Briefline is ready`,
        html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px">
          <h1>Briefline test email</h1>
          <p>${brief.date} · ${brief.readTime||""}</p>
          <p><a href="${briefUrl}">Read today's brief</a></p>
          <p><a href="${surveyUrl}">Take today's survey</a></p>
        </div>`
      })
    });
    const ed=await er.json();
    if(!er.ok) throw new Error(ed?.message||"Resend failed");
    return res.status(200).json({ok:true,briefId:row.id,emailId:ed.id,briefUrl,surveyUrl});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Email test failed"});
  }
};
