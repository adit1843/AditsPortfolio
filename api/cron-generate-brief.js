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

function sbHeaders(){
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type":"application/json",
    Prefer:"return=representation"
  };
}

async function sbGet(table){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.desc&limit=20`,{headers:sbHeaders()});
  const data=await r.json();
  if(!r.ok) throw new Error(data?.message || `Failed to read ${table}`);
  return data;
}

async function sbInsert(table,payload){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{
    method:"POST",
    headers:sbHeaders(),
    body:JSON.stringify([payload])
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data?.message || `Failed to write ${table}`);
  return data;
}


async function sendDailyEmail(brief){
  if(!RESEND_API_KEY || !SURVEY_EMAIL_TO || !SITE_URL) {
    throw new Error("Daily email is not fully configured.");
  }
  const base=SITE_URL.replace(/\/$/,"");
  const briefUrl=`${base}/briefing/?date=${encodeURIComponent(brief.date)}`;
  const surveyUrl=`${base}/briefing/?survey=1&date=${encodeURIComponent(brief.date)}`;
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
      from:"Daily Brief <onboarding@resend.dev>",
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
    const preferences=prefsRows[0]?.payload || {generalNews:40,technicalDepth:"medium-high",politics:"important-only",markets:true};
    const knowledge=knowledgeRows[0]?.payload || [];
    const coverage=coverageRows.map(x=>x.payload).slice(0,14);

    const prompt=`
Create today's personalized current-events Daily Brief for one reader.

Today is ${new Date().toISOString().slice(0,10)}.

Use web search to research current, important developments. Prefer primary sources and high-quality reporting. Do not invent facts, links, quotes, or publication details.

Editorial goals:
- About 5 to 7 stories.
- Roughly a 15 to 20 minute read.
- Mix personalized interests with important general news.
- Avoid repeating background the reader already knows.
- Use prior coverage naturally when useful, including "Yesterday we discussed..." only when supported.
- Separate factual reporting from interpretation.
- Explain why each story matters.
- Favor novelty over repeated headlines.
- Explainer requests must not affect story selection.

Reader preferences:
${JSON.stringify(preferences)}

Knowledge estimates:
${JSON.stringify(knowledge)}

Recent coverage:
${JSON.stringify(coverage)}

Return ONLY valid JSON:
{
  "date":"Month D, YYYY",
  "readTime":"~N min",
  "intro":"2-3 sentence editorial introduction",
  "stories":[{
    "id":"short-kebab-case-id",
    "category":"short category",
    "title":"headline",
    "summary":"1-2 sentence summary",
    "body":"3-6 concise paragraphs as plain text separated by newline characters",
    "sources":[{"name":"source name","url":"https://..."}]
  }]
}
`;

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

    await sbInsert("briefs",{brief_date:brief.date,payload:brief});
    const emailId=await sendDailyEmail(brief);
    return res.status(200).json({ok:true,date:brief.date,stories:brief.stories?.length||0,emailId});
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Daily generation failed"});
  }
}
