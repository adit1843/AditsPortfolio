const crypto=require("crypto");

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const BUCKET=process.env.BRIEFLINE_AUDIO_BUCKET||"briefline-audio";
const VOICE=process.env.GOOGLE_TTS_VOICE||"en-US-Chirp3-HD-Charon";
const MONTHLY_CHAR_LIMIT=Number(process.env.BRIEFLINE_TTS_MONTHLY_CHAR_LIMIT||750000);

let cachedToken=null;
let cachedTokenExp=0;

function supabaseBase(){
  return (SUPABASE_URL||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");
}
function b64url(input){
  return Buffer.from(input).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function credentials(){
  const raw=process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON;
  if(!raw) return null;
  try{return JSON.parse(raw);}catch{
    try{return JSON.parse(Buffer.from(raw,"base64").toString("utf8"));}catch{return null;}
  }
}
function ttsConfigured(){
  const c=credentials();
  return Boolean(c?.client_email&&c?.private_key&&SUPABASE_URL&&SUPABASE_SECRET_KEY);
}
async function accessToken(){
  if(cachedToken&&Date.now()<cachedTokenExp-60000) return cachedToken;
  const c=credentials();
  if(!c) throw new Error("Google TTS credentials are not configured.");
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload=b64url(JSON.stringify({
    iss:c.client_email,
    scope:"https://www.googleapis.com/auth/cloud-platform",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,
    exp:now+3600
  }));
  const unsigned=`${header}.${payload}`;
  const signature=crypto.sign("RSA-SHA256",Buffer.from(unsigned),c.private_key);
  const assertion=`${unsigned}.${b64url(signature)}`;
  const body=new URLSearchParams({
    grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });
  const r=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data?.error_description||data?.error||"Could not authenticate Google TTS.");
  cachedToken=data.access_token;
  cachedTokenExp=Date.now()+(Number(data.expires_in)||3600)*1000;
  return cachedToken;
}
function splitUtf8(text,maxBytes=4400){
  const clean=String(text||"").replace(/\s+/g," ").trim();
  if(!clean) return [];
  const sentences=clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[clean];
  const chunks=[];
  let current="";
  const flush=()=>{if(current.trim()){chunks.push(current.trim());current="";}};
  for(const sentenceRaw of sentences){
    const sentence=sentenceRaw.trim();
    if(Buffer.byteLength(sentence,"utf8")>maxBytes){
      flush();
      const words=sentence.split(/\s+/);
      let part="";
      for(const word of words){
        const candidate=part?`${part} ${word}`:word;
        if(Buffer.byteLength(candidate,"utf8")>maxBytes){
          if(part) chunks.push(part);
          part=word;
        }else part=candidate;
      }
      if(part) chunks.push(part);
      continue;
    }
    const candidate=current?`${current} ${sentence}`:sentence;
    if(Buffer.byteLength(candidate,"utf8")>maxBytes){
      flush();
      current=sentence;
    }else current=candidate;
  }
  flush();
  return chunks;
}
async function synthesize(text){
  const token=await accessToken();
  const r=await fetch("https://texttospeech.googleapis.com/v1/text:synthesize",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      input:{text},
      voice:{languageCode:"en-US",name:VOICE},
      audioConfig:{audioEncoding:"MP3"}
    })
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data?.error?.message||"Google TTS synthesis failed.");
  return Buffer.from(data.audioContent,"base64");
}
async function ensureBucket(){
  const headers={
    apikey:SUPABASE_SECRET_KEY,
    Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
    "Content-Type":"application/json"
  };
  const get=await fetch(`${supabaseBase()}/storage/v1/bucket/${encodeURIComponent(BUCKET)}`,{headers});
  if(get.ok) return;
  const r=await fetch(`${supabaseBase()}/storage/v1/bucket`,{
    method:"POST",
    headers,
    body:JSON.stringify({id:BUCKET,name:BUCKET,public:false,file_size_limit:52428800})
  });
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    if(!String(data?.message||"").toLowerCase().includes("already")) {
      throw new Error(data?.message||"Could not create Briefline audio bucket.");
    }
  }
}
async function upload(path,buffer){
  const r=await fetch(`${supabaseBase()}/storage/v1/object/${BUCKET}/${path}`,{
    method:"POST",
    headers:{
      apikey:SUPABASE_SECRET_KEY,
      Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type":"audio/mpeg",
      "x-upsert":"true"
    },
    body:buffer
  });
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    throw new Error(data?.message||"Could not store Briefline audio.");
  }
}

function monthKey(){
  return new Date().toISOString().slice(0,7);
}
function usagePath(){
  return `usage/${monthKey()}.json`;
}
async function readUsage(){
  const path=usagePath();
  const r=await fetch(`${supabaseBase()}/storage/v1/object/${BUCKET}/${path}`,{
    headers:{
      apikey:SUPABASE_SECRET_KEY,
      Authorization:`Bearer ${SUPABASE_SECRET_KEY}`
    }
  });
  if(r.status===404) return {month:monthKey(),characters:0,updatedAt:null};
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    throw new Error(data?.message||"Could not read Briefline TTS usage.");
  }
  const data=await r.json();
  return {
    month:data?.month||monthKey(),
    characters:Number(data?.characters)||0,
    updatedAt:data?.updatedAt||null
  };
}
async function writeUsage(usage){
  const path=usagePath();
  const body=Buffer.from(JSON.stringify(usage));
  const r=await fetch(`${supabaseBase()}/storage/v1/object/${BUCKET}/${path}`,{
    method:"POST",
    headers:{
      apikey:SUPABASE_SECRET_KEY,
      Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type":"application/json",
      "x-upsert":"true"
    },
    body
  });
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    throw new Error(data?.message||"Could not store Briefline TTS usage.");
  }
}
async function reserveCharacters(characters){
  const usage=await readUsage();
  const requested=Math.max(0,Number(characters)||0);
  if(usage.characters>=MONTHLY_CHAR_LIMIT || usage.characters+requested>MONTHLY_CHAR_LIMIT){
    return {
      allowed:false,
      month:usage.month,
      used:usage.characters,
      requested,
      limit:MONTHLY_CHAR_LIMIT,
      remaining:Math.max(0,MONTHLY_CHAR_LIMIT-usage.characters)
    };
  }
  const next={
    month:usage.month,
    characters:usage.characters+requested,
    updatedAt:new Date().toISOString()
  };
  await writeUsage(next);
  return {
    allowed:true,
    month:next.month,
    used:next.characters,
    requested,
    limit:MONTHLY_CHAR_LIMIT,
    remaining:Math.max(0,MONTHLY_CHAR_LIMIT-next.characters)
  };
}
function spokenSections(brief){
  const sections=[{
    kind:"intro",
    storyId:null,
    label:"Introduction",
    text:`Good morning. This is Briefline for ${brief.date}. ${brief.intro||""}`
  }];
  (brief.stories||[]).forEach((story,i)=>{
    sections.push({
      kind:"story",
      storyId:story.id,
      label:story.title,
      text:`Story ${i+1}. ${story.title}. ${story.summary||""} ${story.body||""}`
    });
  });
  return sections;
}
async function generateBriefAudio(brief,briefId){
  if(!ttsConfigured()) return {configured:false};
  await ensureBucket();
  const jobs=[];
  let index=0;
  for(const section of spokenSections(brief)){
    const chunks=splitUtf8(section.text);
    chunks.forEach((text,part)=>{
      jobs.push({
        index:index++,
        text,
        kind:section.kind,
        storyId:section.storyId,
        label:chunks.length>1?`${section.label} · Part ${part+1}`:section.label
      });
    });
  }
  const totalCharacters=jobs.reduce((sum,job)=>sum+Array.from(job.text).length,0);
  const usage=await reserveCharacters(totalCharacters);
  if(!usage.allowed){
    return {
      configured:true,
      skipped:true,
      reason:"monthly_character_limit",
      usage,
      voice:VOICE,
      segments:[]
    };
  }

  const synthesized=await Promise.all(jobs.map(async job=>({...job,audio:await synthesize(job.text)})));
  await Promise.all(synthesized.map(job=>{
    const path=`briefs/${briefId}/${String(job.index).padStart(3,"0")}.mp3`;
    job.path=path;
    return upload(path,job.audio);
  }));
  return {
    configured:true,
    voice:VOICE,
    usage,
    segments:synthesized.map(({index,kind,storyId,label,path})=>({index,kind,storyId,label,path}))
  };
}

module.exports={generateBriefAudio,ttsConfigured,BUCKET,MONTHLY_CHAR_LIMIT};
