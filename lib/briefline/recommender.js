function clamp(n,min=0,max=100){return Math.max(min,Math.min(max,Number(n)||0));}
function norm(v=""){return String(v).trim().toLowerCase();}
function tokens(v=""){return new Set(norm(v).split(/[^a-z0-9]+/).filter(x=>x.length>2));}
function overlap(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(A.size,B.size);}
function secondaryPublishers(c){
  return [...new Set((c?.sources||[])
    .filter(s=>String(s?.type||"secondary").toLowerCase()!=="primary")
    .map(s=>norm(s?.name||""))
    .filter(Boolean))];
}
function hasPrimarySource(c){
  return (c?.sources||[]).some(s=>String(s?.type||"").toLowerCase()==="primary");
}
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
function behavioralInterest(candidate,preferences={}){
  const model=preferences.behavioralInterest?.features||{},tags=flattenTags(candidate);
  const dims=[
    ["format",candidate.formatIntent],
    ["event",candidate.eventType],
    ["timeliness",candidate.timeliness]
  ];
  const candidateFeatures=[
    ...tags.map(x=>String(x)),
    ...dims.filter(([,v])=>v).map(([,v])=>String(v))
  ];
  if(!candidateFeatures.length)return 0;
  let total=0,weight=0;
  for(const [key,entry] of Object.entries(model)){
    const label=String(entry?.label||key.split(":").slice(1).join(":"));
    let sim=0;
    for(const f of candidateFeatures)sim=Math.max(sim,overlap(label,f),norm(label)===norm(f)?1:0);
    if(sim<.34)continue;
    const conf=clamp(entry?.confidence||0)/100;
    const longTerm=clamp(entry?.longTerm??50);
    const updated=Date.parse(entry?.lastUpdated||"");
    const ageDays=Number.isFinite(updated)?Math.max(0,(Date.now()-updated)/86400000):999;
    const storedRecent=clamp(entry?.recent??50);
    const recent=50+(storedRecent-50)*Math.pow(.88,ageDays);
    const blended=(longTerm*.7+recent*.3)-50;
    const w=sim*(.25+.75*conf);
    total+=blended*w;
    weight+=w;
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
  const behavior=behavioralInterest(candidate,preferences);
  const explicit=requestedBoost(candidate,preferences);
  const fatigue=coveragePenalty(candidate,coverage);
  const know=knowledgeOpportunity(candidate,knowledge);
  const primaryEvidence=hasPrimarySource(candidate)?5:0;
  return relevance*.26+importance*.19+novelty*.13+sourceQuality*.12+evergreenValue*.08+interest*.18+behavior*.20+explicit+know+primaryEvidence-fatigue;
}
function plannedBucketQuotas(contentPlan={},limit=12){
  const buckets=Array.isArray(contentPlan?.buckets)?contentPlan.buckets:[];
  if(!buckets.length)return{};
  const quotas={};
  let used=0;
  buckets.forEach((b,i)=>{
    const q=i===buckets.length-1?Math.max(0,limit-used):Math.max(0,Math.round(limit*(Number(b.share)||0)/100));
    quotas[String(b.id||"")]=q;
    used+=q;
  });
  return quotas;
}
function selectCandidates(candidates,ctx={},limit=12){
  const ranked=(candidates||[]).map(c=>({...c,recommendationScore:Number(scoreCandidate(c,ctx).toFixed(2))})).sort((a,b)=>b.recommendationScore-a.recommendationScore);
  const selected=[],domainCounts={},typeCounts={},publisherCounts={};
  const quotas=plannedBucketQuotas(ctx.contentPlan,limit),bucketCounts={};
  const canTake=c=>{
    const domain=c?.taxonomy?.domain||"Other",type=c.formatIntent||"news",pubs=secondaryPublishers(c);
    const domainCap=ctx.preferences?.editorialDirectives?.some(x=>/only|entire|all/i.test(x))?limit:Math.max(2,Math.ceil(limit*.42));
    if((domainCounts[domain]||0)>=domainCap)return false;
    if((typeCounts[type]||0)>=Math.ceil(limit*.55))return false;
    if(pubs.some(p=>(publisherCounts[p]||0)>=2))return false;
    return true;
  };
  const take=c=>{
    const domain=c?.taxonomy?.domain||"Other",type=c.formatIntent||"news",pubs=secondaryPublishers(c),bucket=String(c.contentBucket||"");
    selected.push(c);
    domainCounts[domain]=(domainCounts[domain]||0)+1;
    typeCounts[type]=(typeCounts[type]||0)+1;
    bucketCounts[bucket]=(bucketCounts[bucket]||0)+1;
    pubs.forEach(p=>publisherCounts[p]=(publisherCounts[p]||0)+1);
  };

  // First honor the listener-driven content allocation before filling by score.
  for(const [bucket,quota] of Object.entries(quotas)){
    for(const c of ranked){
      if((bucketCounts[bucket]||0)>=quota)break;
      if(String(c.contentBucket||"")!==bucket)continue;
      if(selected.some(x=>x.id===c.id)||!canTake(c))continue;
      take(c);
    }
  }

  for(const c of ranked){
    const domain=c?.taxonomy?.domain||"Other",type=c.formatIntent||"news";
    const domainCap=ctx.preferences?.editorialDirectives?.some(x=>/only|entire|all/i.test(x))?limit:Math.max(2,Math.ceil(limit*.42));
    if((domainCounts[domain]||0)>=domainCap)continue;
    if((typeCounts[type]||0)>=Math.ceil(limit*.55))continue;
    const pubs=secondaryPublishers(c);
    if(pubs.some(p=>(publisherCounts[p]||0)>=2))continue;
    take(c);
    if(selected.length>=limit)break;
  }
  // Only relax publisher diversity if the candidate pool is too narrow to fill the slate.
  for(const c of ranked){
    if(selected.length>=limit)break;
    if(selected.some(x=>x.id===c.id))continue;
    const pubs=secondaryPublishers(c);
    if(pubs.some(p=>(publisherCounts[p]||0)>=3))continue;
    selected.push(c);
    pubs.forEach(p=>publisherCounts[p]=(publisherCounts[p]||0)+1);
  }
  for(const c of ranked)if(selected.length<limit&&!selected.some(x=>x.id===c.id))selected.push(c);
  return {ranked,selected:selected.slice(0,limit)};
}
module.exports={scoreCandidate,selectCandidates};
