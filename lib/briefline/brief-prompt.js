function buildBriefPrompt({date,preferences={},knowledge={},coverage=[],candidates=[],contentPlan={},sourcePlan={}}){
  const concepts=knowledge?.concepts||{};
  return `
Create today's personalized Noesis edition for one listener.

Today is ${date}.

Noesis can be a podcast about ANYTHING. It is not inherently a news show. Explicit listener instructions can turn it into a sports recap, cooking show, history podcast, science briefing, market update, learning series, or any hybrid.

The listener-driven content plan was decided before source selection:
${JSON.stringify(contentPlan,null,2)}

The adaptive source plan used for discovery:
${JSON.stringify(sourcePlan?.buckets||[],null,2)}

The research/ranking system has already selected these candidates:
${JSON.stringify(candidates,null,2)}

Explicit listener personalization:
${JSON.stringify({...preferences,behavioralInterest:undefined},null,2)}

Hidden concept-level knowledge:
${JSON.stringify(concepts,null,2)}

Recent coverage memory:
${JSON.stringify(coverage,null,2)}

Selection rules:
- Produce 6-8 total segments.
- Preserve the content-plan proportions as closely as the available high-quality candidates allow. A ~50% bucket should normally account for roughly half the final edition.
- Treat candidate recommendationScore as an important signal, not an absolute command.
- Respect explicit editorialDirectives more strongly than inferred preferences.
- Preserve useful diversity unless the listener explicitly wants a narrowly focused podcast.
- Avoid duplicating the same event/entity/angle.
- Do not let "Teach me more" requests affect future topic selection.
- If this is a specialized recurring show (sports recap, cooking tips, etc.), fully embrace that format rather than forcing generic current affairs into it.
- Genuinely major news may override defaults only when appropriate.

Knowledge calibration:
- Missing concept = 0/100.
- 0-20: define terms and explain from first principles.
- 21-50: concise foundations, then intermediate detail.
- 51-75: assume basics; focus on mechanisms/tradeoffs.
- 76-100: skip basics; emphasize nuance and implications.
- Knowledge changes HOW a segment is explained, never whether the user is interested in it.

Research and source mix:
- Candidate sources are starting evidence. Verify with web search whenever freshness or accuracy benefits.
- Prefer primary sources whenever available, then use high-quality secondary reporting for independent context.
- For consequential fresh stories, use more than one independent source when practical.
- Do not let one secondary publisher dominate the edition. In a normal 6-8 segment edition, no single SECONDARY publisher should be the lead/only source for more than 2 stories unless there is a compelling editorial reason.
- Across a news-heavy edition, deliberately seek a mix of wires, specialist publications, official sources, filings/data, research, and direct announcements appropriate to each story.
- Do not add weak or redundant sources merely to hit a diversity quota.
- Preserve each source's type when known.
- Separate facts from interpretation.
- Never invent links, quotes, scores, results, or publication details.

Return ONLY valid compact JSON:
{
"date":"Month D, YYYY",
"readTime":"~N min",
"intro":"2-3 sentence introduction",
"stories":[{
"id":"short-kebab-case-id",
"contentType":"news | general_knowledge | deep_dive | history | science | business_case",
"category":"short category",
"topics":["broad topic","specific topic"],
"concepts":["atomic concept"],
"tags":{
"taxonomy":{"domain":"domain","topic":"topic","subtopic":"subtopic"},
"entities":["entity"],
"themes":["theme"],
"eventType":"type",
"timeliness":"breaking | developing | daily_recap | evergreen",
"importance":0,
"novelty":0
},
"title":"title",
"summary":"1-2 sentences",
"body":"3-6 concise paragraphs separated with escaped newline characters",
"spokenScript":"Natural single-host podcast script, 120-220 words, conversational but precise, no URLs or source list.",
"sources":[{"name":"source","url":"https://...","type":"primary | secondary"}]
}]
}

For concepts, return 4-10 specific atomic concepts. Preserve the rich semantic tags from the chosen candidate wherever possible.
`;
}
module.exports={buildBriefPrompt};
