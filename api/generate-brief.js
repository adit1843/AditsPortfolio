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
  return text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
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

  const prompt = `
Create today's personalized current-events Daily Brief for one reader.

Today is ${new Date().toISOString().slice(0, 10)}.

Use web search to research current, important developments. Prefer primary sources and high-quality reporting. Do not invent facts, links, quotes, or publication details.

Editorial goals:
- About 5 to 7 stories.
- Enough total detail for roughly a 15 to 20 minute read.
- Mix personalized interests with important general news.
- Avoid repeating background the reader already knows.
- When genuinely useful, connect to prior coverage with natural wording like "Yesterday we discussed..." but only when the supplied coverage supports it.
- Separate factual reporting from interpretation.
- Explain why each story matters.
- Do not let explainer requests influence story selection.
- Favor novelty: if something is merely another version of a previously covered story, either skip it or focus only on what materially changed.

Reader preferences:
${JSON.stringify(preferences, null, 2)}

Knowledge estimates:
${JSON.stringify(knowledge, null, 2)}

Recent coverage memory:
${JSON.stringify(coverage, null, 2)}

Return ONLY valid JSON, with no markdown fences or commentary, using exactly this shape:
{
  "date": "Month D, YYYY",
  "readTime": "~N min",
  "intro": "2-3 sentence editorial introduction",
  "stories": [
    {
      "id": "short-kebab-case-id",
      "category": "short category",
      "title": "headline",
      "summary": "1-2 sentence summary",
      "body": "3-6 concise paragraphs as plain text separated by newline characters",
      "sources": [
        {"name": "source name", "url": "https://..."}
      ]
    }
  ]
}
`;

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
        max_output_tokens: 8000,
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
      brief = JSON.parse(cleanJson(text));
    } catch {
      return res.status(502).json({
        error: "The model returned a response that was not valid JSON.",
        raw: text.slice(0, 2000),
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
