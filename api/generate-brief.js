const {buildBriefPrompt}=require("../lib/briefline/brief-prompt");
const {requireAuth}=require("../lib/briefline/auth");
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";

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

function cleanJson(text) {
  return String(text||"").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
}

async function repairBriefJson(raw){
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:MODEL,
      input:`Repair the following malformed JSON for a Neosis daily briefing.

Return ONLY one valid JSON object. Preserve the existing facts, wording, URLs, arrays, and fields as closely as possible. Fix JSON syntax only. If the text was cut off at the very end, close the current string/object/array cleanly rather than inventing new stories. Do not use markdown fences.

BROKEN JSON:
${raw}`,
      max_output_tokens:10000
    })
  });
  const data=await response.json();
  if(!response.ok) throw new Error(data?.error?.message||"JSON repair request failed");
  return cleanJson(extractOutputText(data));
}

async function parseBriefJson(raw){
  const cleaned=cleanJson(raw);
  try{
    return JSON.parse(cleaned);
  }catch(firstError){
    const repaired=await repairBriefJson(cleaned);
    try{
      return JSON.parse(repaired);
    }catch{
      throw new Error(`Brief generation returned invalid JSON even after repair: ${firstError.message}`);
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: MODEL,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "OPENAI_API_KEY is not configured in Vercel yet.",
    });
  }

  const preferences = req.body?.preferences || {};
  const knowledge = req.body?.knowledge || [];
  const coverage = req.body?.coverage || [];

  const prompt = buildBriefPrompt({
    date:new Date().toISOString().slice(0,10),
    preferences,
    knowledge,
    coverage
  });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        tools: [{ type: "web_search" }],
        input: prompt,
        max_output_tokens: 10000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "OpenAI request failed",
      });
    }

    const text = extractOutputText(data);
    let brief;
    try {
      brief = await parseBriefJson(text);
    } catch (parseError) {
      return res.status(502).json({
        error: parseError instanceof Error ? parseError.message : "The model returned invalid JSON."
      });
    }

    if (!brief || !Array.isArray(brief.stories)) {
      return res.status(502).json({ error: "The generated brief had an invalid structure." });
    }

    return res.status(200).json({
      brief,
      model: MODEL,
      responseId: data.id,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  }
}
