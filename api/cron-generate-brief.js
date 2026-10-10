const {buildBriefPrompt}=require("./_brief_prompt");
const {isAuthed}=require("./_auth");
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SURVEY_EMAIL_TO = process.env.SURVEY_EMAIL_TO;
const SITE_URL = process.env.SITE_URL;

function extractOutputText(data) {
  const parts = [];
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function supabaseBase(){
  if(!SUPABASE_URL) return "";
  return SUPABASE_URL.replace(/\/+$/,"").replace(/\/rest\/v1$/,"");
}

function sbHeaders(){
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type":"application/json",
    Prefer:"return=representation"
  };
}

async function sbGet(table){
  const r=await fetch(`${supabaseBase()}/rest/v1/${table}?select=*&order=created_at.desc&limit=20`,{headers:sbHeaders()});
  const data=await r.json();
  if(!r.ok) throw new Error(data?.message || `Failed to read ${table}`);
  return data;
}

async function sbInsert(table,payload){
  const r=await fetch(`${supabaseBase()}/rest/v1/${table}`,{
    method:"POST",
    headers:sbHeaders(),
    body:JSON.stringify([payload])
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data?.message || `Failed to write ${table}`);
  return data;
}


async function sendDailyEmail(brief,briefId){
  if(!RESEND_API_KEY || !SURVEY_EMAIL_TO || !SITE_URL) {
    throw new Error("Daily email is not fully configured.");
  }
  const base=SITE_URL.replace(/\/$/,"");
  const briefUrl=`${base}/briefing/?brief=${encodeURIComponent(briefId)}`;
  const surveyUrl=`${base}/briefing/?survey=1&brief=${encodeURIComponent(briefId)}`;
  const html=`
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#171717">
      <p style="text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:#777">Daily Brief</p>
      <h1 style="font-family:Georgia,serif;margin-bottom:8px">Your Daily Brief is ready</h1>
      <p style="color:#555;margin-top:0">${brief.date} · ${brief.readTime || "Daily edition"}</p>
      <p>${brief.intro || "Your personalized current-events briefing is ready."}</p>
      <p style="margin:28px 0">
        <a href="${briefUrl}" style="display:inline-block;background:#171717;color:white;text-decoration:none;padding:12px 18px;border-radius:999px;margin-right:8px">Read today's brief</a>
        <a href="${surveyUrl}" style="display:inline-block;border:1px solid #171717;color:#171717;text-decoration:none;padding:11px 18px;border-radius:999px">Take today's survey</a>
      </p>
      <p style="font-size:13px;color:#777">The survey tunes future briefs. “Teach me more” remains separate and does not affect topic selection.</p>
    </div>`;

  const r=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${RESEND_API_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      from:"Briefline <briefline@mail.aditsanghani.com>",
      to:[SURVEY_EMAIL_TO],
      subject:`Your ${brief.date} Daily Brief is ready`,
      html
    })
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data?.message || "Daily email failed");
  return data.id;
}

module.exports = async function handler(req,res){
  if(!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SECRET_KEY){
    return res.status(503).json({error:"Daily generation is not fully configured."});
  }

  const auth=req.headers.authorization;
  const cronAuthorized=Boolean(CRON_SECRET && auth === `Bearer ${CRON_SECRET}`);
  const userAuthorized=isAuthed(req);
  if(!cronAuthorized && !userAuthorized){
    return res.status(401).json({error:"Unauthorized"});
  }

  try{
    const [prefsRows,knowledgeRows,coverageRows]=await Promise.all([
      sbGet("preferences"),sbGet("knowledge"),sbGet("coverage")
    ]);
    const preferences=prefsRows[0]?.payload || {
      generalNews:40,
      politics:"important-only",
      markets:true,
      topicScores:{},
      contentTypeScores:{news:55,general_knowledge:50,deep_dive:50,history:50,science:50,business_case:50},
      requestedTopics:[],
      explanationBias:0
    };
    const knowledge=(knowledgeRows[0]?.payload && !Array.isArray(knowledgeRows[0].payload))
      ? knowledgeRows[0].payload
      : {concepts:{},seenEvents:{}};
    const coverage=coverageRows.map(x=>x.payload).slice(0,14);

    const prompt=buildBriefPrompt({
      date:new Date().toISOString().slice(0,10),
      preferences,
      knowledge,
      coverage
    });

    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        Authorization:`Bearer ${OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:MODEL,
        tools:[{type:"web_search"}],
        input:prompt,
        max_output_tokens:8000
      })
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");

    const text=extractOutputText(data).replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();
    const brief=JSON.parse(text);

    const previous=await sbGet("briefs");
    if(previous[0]?.payload?.stories?.length){
      await sbInsert("coverage",{
        payload:{
          date:previous[0].payload.date,
          stories:previous[0].payload.stories.map(s=>({title:s.title,category:s.category,summary:s.summary}))
        }
      });
    }

    const inserted=await sbInsert("briefs",{brief_date:brief.date,payload:brief});
    const briefId=inserted?.[0]?.id;
    if(!briefId) throw new Error("Brief saved but no database ID was returned.");
    const emailId=await sendDailyEmail(brief,briefId);
    return res.status(200).json({ok:true,date:brief.date,briefId,stories:brief.stories?.length||0,emailId});
  }catch(e){
    return res.status(500).json({
      error:e instanceof Error?e.message:"Daily generation failed",
      hint:"Check Production env values for SUPABASE_URL, OPENAI_API_KEY/OPENAI_MODEL, RESEND_API_KEY, SURVEY_EMAIL_TO, and SITE_URL."
    });
  }
}
