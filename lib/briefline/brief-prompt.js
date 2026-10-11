function buildBriefPrompt({date,preferences={},knowledge={},coverage=[]}){
  const concepts=knowledge?.concepts||{};
  return `
Create today's personalized Neosis edition for one reader.

Today is ${date}.

Neosis is NOT only a news product. It should combine timely current affairs with useful evergreen learning.

Editorial mix:
- 6 to 8 total items.
- Use preferences.mixTargets as the reader's desired approximate percentage mix across news, general_knowledge, deep_dive, history, science, and business_case.
- Convert those percentages sensibly into a small daily set; they are targets over time, not rigid quotas for every single edition.
- Major genuinely important news can override the mix when necessary, but explainable editorial preference should otherwise be respected.
- Preserve some serendipity unless the user's editorial directives explicitly ask otherwise.
- Do not let "Teach me more" requests affect topic selection.
- Avoid repetitive coverage. If a topic was recently covered, focus only on what materially changed or choose a different angle.

Story selection:
- Use preferences.topicScores as learned topic affinity. 50 is neutral; above 50 means more interest, below 50 means less interest.
- Use preferences.contentTypeScores as learned affinity for content formats. 50 is neutral.
- Use requestedTopics as soft hints, not mandatory instructions.
- Treat preferences.editorialDirectives as durable explicit instructions from the reader and give them more weight than inferred survey signals.
- Treat preferences.languageDirectives as durable instructions for wording, jargon, tone, pacing, analogies, definitions, and sentence complexity.
- Survey learning should influence selection gradually, not overreact to one rating.
- Keep the overall brief diverse; do not let one favorite topic dominate unless the reader explicitly asks for that.

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

Return ONLY valid JSON with no markdown fences, in exactly this shape. Keep the entire response compact enough to finish reliably. All line breaks inside JSON string values must be escaped as \\n; never place raw unescaped newlines inside a JSON string:
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
    "spokenScript":"A natural podcast-style version of this story, 120-220 words. Conversational but precise. Do not simply read the article body. Use contractions, natural transitions, pronunciation-friendly numbers and acronyms, and explain symbols/abbreviations in speech. Do not say URLs or source lists.",
    "sources":[{"name":"source name","url":"https://..."}]
  }]
}

Audio-writing rules:
- spokenScript is for a premium personal morning briefing, not an audiobook or accessibility readout.
- Write like one intelligent host speaking directly to one listener.
- Preserve the factual substance and knowledge calibration of the written story, but make sentence rhythm natural for speech.
- Expand awkward abbreviations where useful; turn "$52B" into "52 billion dollars", "27%" into "27 percent", and similar constructions when that improves pronunciation.
- Avoid verbal clutter such as source names, URLs, markdown, parenthetical citations, bullet syntax, and repeated headlines.
- Do not use fake quotes, sound-effect directions, or stage directions.
- Vary transitions lightly so consecutive stories do not sound mechanically templated.
- End each story cleanly rather than saying "end of story."

For concepts, return 4-10 specific concepts taught or relied on by that item. Prefer atomic concepts such as "interest-rate duration", "liquid cooling CDU", "plate tectonics", or "network oversubscription" rather than vague labels like "technology".
`;
}

module.exports={buildBriefPrompt};
