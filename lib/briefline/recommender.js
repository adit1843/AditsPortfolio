function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0));}
function norm(v=""){return String(v).trim().toLowerCase();}
function tokens(v=""){return new Set(norm(v).split(/[^a-z0-9]+/).filter(x=>x.length>2));}
function overlap(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function flattenTags(c){
  return [
    c?.taxonomy?.domain,c?.taxonomy?.topic,c?.taxonomy?.subtopic,
    ...(c?.entities||[]),...(c?.themes||[]),...(c?.prerequisiteConcepts||[])
  ].filter(Boolean).map(String);
}
function learnedInterest(candidate,preferences={}){
  const scores=preferences.topicScores||{},tags=flattenTags(candidate);
  if(!tags.length)return 0;
  let total=0,weight=0;
  for(const tag of tags){
    const t=norm(tag);
    for(const [k,v] of Object.entries(scores)){
      const nk=norm(k);
      if(!nk)continue;
      if(t===nk){total+=(Number(v)-50)*1.0;weight+=1;}
      else if(t.includes(nk)||nk.includes(t)){total+=(Number(v)-50)*.55;weight+=.55;}
    }
  }
  return weight?total/weight:0;
}
function requestedBoost(candidate,preferences={}){
  const hay=flattenTags(candidate).join(" ")+" "+(candidate.title||"")+" "+(candidate.summary||"");
  let score=0;
  for(const q of preferences.requestedTopics||[]) if(norm(q)&&norm(hay).includes(norm(q))) score+=16;
  for(const q of preferences.avoidedTopics||[]) if(norm(q)&&norm(hay).includes(norm(q))) score-=24;
  return score;
}
function coveragePenalty(candidate,coverage=[]){
  let max=0;
  for(const day of coverage||[]) for(const s of day?.stories||[]){
    const sim=Math.max(overlap(candidate.title,s.title),overlap(candidate.summary,s.summary));
    if(sim>max)max=sim;
  }
  return max*34;
}
function knowledgeOpportunity(candidate,knowledge={}){
  const concepts=knowledge?.concepts||{},req=candidate.prerequisiteConcepts||[];
  if(!req.length)return 0;
  const vals=req.map(x=>Number(concepts[norm(x)]?.score)||0);
  const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
  // Reward teachable but not wildly mismatched candidates.
  if(avg<15)return -2;
  if(avg<55)return 4;
  return 2;
}
function scoreCandidate(candidate,{preferences={},knowledge={},coverage=[]}={}){
  const importance=clamp(candidate.importance??50);
  const novelty=clamp(candidate.novelty??50);
  const relevance=clamp(candidate.baseRelevance??50);
  const sourceQuality=clamp(candidate.sourceQuality??60);
  const evergreenValue=clamp(candidate.evergreenValue??50);
  const interest=learnedInterest(candidate,preferences);
  const explicit=requestedBoost(candidate,preferences);
  const fatigue=coveragePenalty(candidate,coverage);
  const know=knowledgeOpportunity(candidate,knowledge);
  return relevance*.28+importance*.20+novelty*.14+sourceQuality*.12+evergreenValue*.08+interest*.22+explicit+know-fatigue;
}
function selectCandidates(candidates,ctx={},limit=12){
  const ranked=(candidates||[]).map(c=>({...c,recommendationScore:Number(scoreCandidate(c,ctx).toFixed(2))})).sort((a,b)=>b.recommendationScore-a.recommendationScore);
  const selected=[],domainCounts={},typeCounts={};
  for(const c of ranked){
    const domain=c?.taxonomy?.domain||"Other",type=c.formatIntent||"news";
    const domainCap=ctx.preferences?.editorialDirectives?.some(x=>/only|entire|all/i.test(x))?limit:Math.max(2,Math.ceil(limit*.42));
    if((domainCounts[domain]||0)>=domainCap)continue;
    if((typeCounts[type]||0)>=Math.ceil(limit*.55))continue;
    selected.push(c);domainCounts[domain]=(domainCounts[domain]||0)+1;typeCounts[type]=(typeCounts[type]||0)+1;
    if(selected.length>=limit)break;
  }
  for(const c of ranked)if(selected.length<limit&&!selected.some(x=>x.id===c.id))selected.push(c);
  return {ranked,selected:selected.slice(0,limit)};
}
module.exports={scoreCandidate,selectCandidates};
