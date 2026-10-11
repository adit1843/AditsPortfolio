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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "OPENAI_API_KEY is not configured." });
  }

  const story = req.body?.story;
  const knowledge = req.body?.knowledge || [];

  if (!story?.title || !story?.body) {
    return res.status(400).json({ error: "Story context is required." });
  }

  const prompt = `
Create a personalized 5-minute-read explainer for the reader about this story.

Story:
${JSON.stringify(story, null, 2)}

Hidden concept-level knowledge profile:
${JSON.stringify(knowledge?.concepts||{}, null, 2)}

Knowledge score semantics:
- Missing concept = 0/100.
- 0-20: explain from first principles with plain-language definitions and analogies.
- 21-50: assume limited familiarity; give foundational context before intermediate detail.
- 51-75: assume foundations and focus on mechanisms/tradeoffs.
- 76-100: skip basics and focus on nuance, implications, and edge cases.

Rules:
- This explainer is on-demand learning only. It must not suggest or imply that requesting it should affect future story selection.
- Infer which prerequisite concepts the reader likely already understands and skip those.
- Focus on the missing conceptual links that make today's story easier to understand.
- Tie the explanation back to the current story at the end.
- Keep the tone clear, technically literate, concise, and non-patronizing.
- Use web search only if needed to verify facts or add necessary context.
- Aim for roughly 650-900 words.
- Return ONLY valid JSON:
{
  "title": "5-minute explainer: ...",
  "body": "plain text with paragraph breaks",
  "takeaway": "1-2 sentence takeaway",
  "conceptsCovered": ["specific concept 1","specific concept 2"],
  "sources": [{"name":"source","url":"https://..."}]
}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        tools: [{ type: "web_search" }],
        input: prompt,
        max_output_tokens: 4000
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error?.message || "OpenAI request failed" });
    }

    const text = extractOutputText(data).replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();
    const explainer = JSON.parse(text);
    return res.status(200).json({ explainer, responseId: data.id });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unexpected server error" });
  }
}
