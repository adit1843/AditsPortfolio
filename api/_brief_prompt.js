function buildBriefPrompt({date,preferences={},knowledge={},coverage=[]}){
  const concepts=knowledge?.concepts||{};
  return `
Create today's personalized Briefline edition for one reader.

Today is ${date}.

Briefline is NOT only a news product. It should combine timely current affairs with useful evergreen learning.

Editorial mix:
- 6 to 8 total items.
- Usually 2 to 4 current-news items, including genuinely important general news even when it is outside the reader's strongest interests.
- Usually 1 to 2 evergreen general-knowledge or curiosity items drawn from areas such as science, history, geography, economics, engineering, culture, technology, business, or society.
- Usually 1 deeper explanatory, historical, or business-case item that helps the reader build durable understanding.
- Preserve serendipity: roughly 20-30% of the brief should explore worthwhile topics the reader has not explicitly signaled before.
- Do not let "Teach me more" requests affect topic selection.
- Avoid repetitive coverage. If a topic was recently covered, focus only on what materially changed or choose a different angle.

Story selection:
- Use preferences.topicScores as learned topic affinity. 50 is neutral; above 50 means more interest, below 50 means less interest.
- Use preferences.contentTypeScores as learned affinity for content formats. 50 is neutral.
- Use requestedTopics as soft hints, not mandatory instructions.
- Survey learning should influence selection gradually, not overreact to one rating.
- Keep the overall brief diverse; do not let one favorite topic dominate.

Knowledge calibration:
- The hidden knowledge profile is concept-level, not topic-level.
- Any concept absent from the profile must be treated as knowledge score 0/100.
- For relevant concepts with score 0-20: explain in accessible, layman-friendly language and define key terms.
- 21-50: give concise foundational context, then move into intermediate detail.
- 51-75: assume the basics and focus on mechanisms, tradeoffs, and second-order effects.
- 76-100: be concise on fundamentals and emphasize advanced nuance, implications, and edge cases.
- Calibrate EACH item's explanation using the scores of the concepts it teaches. Do not simply apply one global difficulty level.

Reader interest profile:
${JSON.stringify(preferences,null,2)}

Hidden knowledge concepts:
${JSON.stringify(concepts,null,2)}

Recent coverage memory:
${JSON.stringify(coverage,null,2)}

Research rules:
- Use web search for current news and whenever factual verification would improve accuracy.
- Prefer primary sources and high-quality reporting.
- Evergreen items should still be factually grounded and sourced where useful.
- Do not invent facts, links, quotes, or publication details.
- Separate factual reporting from interpretation.
- Explain why each item matters.

Return ONLY valid JSON with no markdown fences, in exactly this shape:
{
  "date":"Month D, YYYY",
  "readTime":"~N min",
  "intro":"2-3 sentence editorial introduction",
  "stories":[{
    "id":"short-kebab-case-id",
    "contentType":"news | general_knowledge | deep_dive | history | science | business_case",
    "category":"short category",
    "topics":["broad topic 1","broad topic 2"],
    "concepts":["atomic concept 1","atomic concept 2","atomic concept 3"],
    "title":"headline or compelling title",
    "summary":"1-2 sentence summary",
    "body":"3-6 concise paragraphs as plain text separated by newline characters",
    "sources":[{"name":"source name","url":"https://..."}]
  }]
}

For concepts, return 4-10 specific concepts taught or relied on by that item. Prefer atomic concepts such as "interest-rate duration", "liquid cooling CDU", "plate tectonics", or "network oversubscription" rather than vague labels like "technology".
`;
}

module.exports={buildBriefPrompt};
