const crypto=require("crypto");
const {insertUserRow}=require("./store");

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const BUCKET=process.env.BRIEFLINE_AUDIO_BUCKET||"briefline-audio";
const VOICE=process.env.GOOGLE_TTS_VOICE||"en-US-Chirp3-HD-Charon";
const MONTHLY_CHAR_LIMIT=Number(process.env.BRIEFLINE_TTS_MONTHLY_CHAR_LIMIT||750000);
const TTS_FREE_CHARS=Number(process.env.GOOGLE_TTS_FREE_CHARS||1000000);
const TTS_PRICE_PER_MILLION=Number(process.env.GOOGLE_TTS_PRICE_PER_MILLION_CHARS||30);

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
      audioConfig:{audioEncoding:"LINEAR16",sampleRateHertz:24000}
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
      throw new Error(data?.message||"Could not create Noesis audio bucket.");
    }
  }
}
async function upload(path,buffer,contentType="audio/mpeg"){
  const r=await fetch(`${supabaseBase()}/storage/v1/object/${BUCKET}/${path}`,{
    method:"POST",
    headers:{
      apikey:SUPABASE_SECRET_KEY,
      Authorization:`Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type":contentType,
      "x-upsert":"true"
    },
    body:buffer
  });
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    throw new Error(data?.message||"Could not store Noesis audio.");
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
    const message=String(data?.message||data?.error||"");
    if(/object not found|not found/i.test(message)){
      return {month:monthKey(),characters:0,updatedAt:null};
    }
    throw new Error(message||"Could not read Noesis TTS usage.");
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
    throw new Error(data?.message||"Could not store Noesis TTS usage.");
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
    previousUsed:usage.characters,
    requested,
    limit:MONTHLY_CHAR_LIMIT,
    remaining:Math.max(0,MONTHLY_CHAR_LIMIT-next.characters)
  };
}
function speechClean(text){
  return String(text||"")
    .replace(/\$([0-9][0-9,.]*)\s*B\b/gi,"$1 billion dollars")
    .replace(/\$([0-9][0-9,.]*)\s*M\b/gi,"$1 million dollars")
    .replace(/([0-9][0-9,.]*)%/g,"$1 percent")
    .replace(/\bYoY\b/gi,"year over year")
    .replace(/\bQoQ\b/gi,"quarter over quarter")
    .replace(/\bCapEx\b/gi,"capital spending")
    .replace(/\s+/g," ")
    .trim();
}
const PROD_SAMPLE_RATE=24000;
const PRODUCTION_VERSION=2;

function wavToPcm(buf){
  if(!Buffer.isBuffer(buf)||buf.length<44||buf.toString("ascii",0,4)!=="RIFF")throw new Error("Unexpected TTS audio format.");
  let offset=12,dataOffset=-1,dataSize=0,channels=1,bits=16,sampleRate=PROD_SAMPLE_RATE;
  while(offset+8<=buf.length){
    const id=buf.toString("ascii",offset,offset+4),size=buf.readUInt32LE(offset+4),start=offset+8;
    if(id==="fmt "&&size>=16){channels=buf.readUInt16LE(start+2);sampleRate=buf.readUInt32LE(start+4);bits=buf.readUInt16LE(start+14);}
    if(id==="data"){dataOffset=start;dataSize=Math.min(size,buf.length-start);break;}
    offset=start+size+(size%2);
  }
  if(dataOffset<0||bits!==16)throw new Error("Unsupported TTS WAV format.");
  const samples=new Int16Array(Math.floor(dataSize/2/channels));
  for(let i=0;i<samples.length;i++){
    let sum=0;
    for(let ch=0;ch<channels;ch++)sum+=buf.readInt16LE(dataOffset+(i*channels+ch)*2);
    samples[i]=Math.round(sum/channels);
  }
  return {samples,sampleRate};
}
function pcmToWav(samples,sampleRate=PROD_SAMPLE_RATE){
  const dataSize=samples.length*2,buf=Buffer.alloc(44+dataSize);
  buf.write("RIFF",0);buf.writeUInt32LE(36+dataSize,4);buf.write("WAVE",8);buf.write("fmt ",12);
  buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(sampleRate,24);
  buf.writeUInt32LE(sampleRate*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write("data",36);buf.writeUInt32LE(dataSize,40);
  for(let i=0;i<samples.length;i++)buf.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(samples[i]))),44+i*2);
  return buf;
}
function secs(n,rate=PROD_SAMPLE_RATE){return Math.max(1,Math.round(n*rate));}
function concatPcm(...parts){
  const arrays=parts.filter(Boolean),len=arrays.reduce((n,a)=>n+a.length,0),out=new Float64Array(len);let p=0;
  for(const a of arrays){for(let i=0;i<a.length;i++)out[p+i]=a[i];p+=a.length;}return out;
}
function softClip(x){const n=x/32768;return Math.tanh(n*.92)*32767;}
function mixInto(base,overlay,start=0,gain=1){
  const out=base instanceof Float64Array?base:new Float64Array(base);
  for(let i=0;i<overlay.length&&start+i<out.length;i++)out[start+i]=softClip(out[start+i]+overlay[i]*gain);
  return out;
}
function fadeEnvelope(i,len,attack=.08,release=.22){
  const a=Math.min(1,i/Math.max(1,len*attack)),r=Math.min(1,(len-1-i)/Math.max(1,len*release));
  return Math.max(0,Math.min(a,r));
}
function toneLayer(duration,freqs,amp=1000,rate=PROD_SAMPLE_RATE){
  const len=secs(duration,rate),out=new Float64Array(len);
  for(let i=0;i<len;i++){
    const t=i/rate,env=fadeEnvelope(i,len,.12,.28);
    let s=0;
    for(let j=0;j<freqs.length;j++){
      const f=freqs[j],w=1/(j+1);
      s+=Math.sin(2*Math.PI*f*t+j*.37)*w;
      s+=Math.sin(2*Math.PI*f*2*t+j*.19)*w*.14;
    }
    out[i]=s*amp*env;
  }
  return out;
}
function airTexture(duration,amp=75,rate=PROD_SAMPLE_RATE){
  const len=secs(duration,rate),out=new Float64Array(len);let seed=9173,prev=0;
  for(let i=0;i<len;i++){seed=(seed*16807)%2147483647;const white=(seed/2147483647)*2-1;prev=prev*.965+white*.035;out[i]=prev*amp*fadeEnvelope(i,len,.2,.35);}
  return out;
}
function sonicOpen(rate=PROD_SAMPLE_RATE){
  const pad=toneLayer(1.45,[110,164.81,220],1250,rate);
  mixInto(pad,toneLayer(.72,[329.63,493.88],920,rate),secs(.32,rate),1);
  mixInto(pad,airTexture(1.35,105,rate),secs(.04,rate),1);
  return pad;
}
function storyTransition(rate=PROD_SAMPLE_RATE){
  const x=toneLayer(.48,[146.83,220],720,rate);
  mixInto(x,toneLayer(.28,[293.66,440],650,rate),secs(.15,rate),1);
  return x;
}
function sonicClose(rate=PROD_SAMPLE_RATE){
  const x=toneLayer(1.15,[220,164.81,110],900,rate);
  mixInto(x,toneLayer(.55,[369.99,293.66],560,rate),0,1);
  return x;
}
function ambientBed(duration,rate=PROD_SAMPLE_RATE){
  const len=secs(duration,rate),out=new Float64Array(len);
  const chords=[[110,164.81,220],[98,146.83,196],[123.47,185,246.94],[110,164.81,220]];
  const chordDur=2.2;
  chords.forEach((ch,k)=>mixInto(out,toneLayer(Math.min(chordDur,duration-k*chordDur),ch,245,rate),secs(k*chordDur,rate),1));
  mixInto(out,airTexture(duration,42,rate),0,1);
  return out;
}
function produceSection(wav,job){
  const {samples,sampleRate}=wavToPcm(wav);
  if(sampleRate!==PROD_SAMPLE_RATE)throw new Error("Unexpected TTS sample rate.");
  const voice=new Float64Array(samples.length);for(let i=0;i<samples.length;i++)voice[i]=samples[i];
  const silence=new Float64Array(secs(.16,sampleRate));
  let out=voice;
  if(job.kind==="intro"){
    const open=sonicOpen(sampleRate);
    out=concatPcm(open,silence,voice);
    const bed=ambientBed(Math.min(8.8,out.length/sampleRate),sampleRate);
    mixInto(out,bed,0,.9);
  }else if(job.kind==="story"&&job.part===0){
    out=concatPcm(storyTransition(sampleRate),silence,voice);
  }else if(job.kind==="outro"){
    const close=sonicClose(sampleRate);
    const bed=ambientBed(Math.min(6.5,voice.length/sampleRate),sampleRate);
    mixInto(voice,bed,0,.62);
    out=concatPcm(voice,silence,close);
  }
  return pcmToWav(out,sampleRate);
}

function spokenSections(brief){
  const stories=brief.stories||[];
  const introText=[
    `This is Noesis. ${brief.date}.`,
    brief.intro||"",
    stories.length?"Here’s what deserves your attention today.":""
  ].filter(Boolean).join(" ");
  const sections=[{
    kind:"intro",
    storyId:null,
    label:"Introduction",
    text:speechClean(introText)
  }];
  stories.forEach((story,i)=>{
    let text=story.spokenScript;
    if(!text){
      const lead=i===0?"Let’s start here.":i===stories.length-1?"And finally.":"Next up.";
      text=`${lead} ${story.title}. ${story.summary||""} ${story.body||""}`;
    }
    sections.push({
      kind:"story",
      storyId:story.id,
      label:story.title,
      text:speechClean(text)
    });
  });
  sections.push({
    kind:"outro",
    storyId:null,
    label:"Closing",
    text:"That’s Noesis for today. You’re caught up. We’ll pick it up again tomorrow."
  });
  return sections;
}
async function generateBriefAudio(brief,briefId,userId="legacy"){
  if(!ttsConfigured()) return {configured:false};
  await ensureBucket();
  const jobs=[];
  let index=0;
  for(const section of spokenSections(brief)){
    const chunks=splitUtf8(section.text);
    chunks.forEach((text,part)=>{
      jobs.push({
        index:index++,
        part,
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

  const synthesized=await Promise.all(jobs.map(async job=>{const raw=await synthesize(job.text);return {...job,audio:produceSection(raw,job)};}));
  const beforePaid=Math.max(0,(usage.previousUsed||0)-TTS_FREE_CHARS);
  const afterPaid=Math.max(0,(usage.used||0)-TTS_FREE_CHARS);
  const billableCharacters=Math.max(0,afterPaid-beforePaid);
  const estimatedCostUsd=Number(((billableCharacters/1000000)*TTS_PRICE_PER_MILLION).toFixed(8));
  if(userId&&userId!=="legacy"){
    try{
      await insertUserRow("api_usage",userId,{
        provider:"google_tts",
        operation:"tts_audio",
        model:VOICE,
        response_id:null,
        input_tokens:0,
        cached_input_tokens:0,
        output_tokens:0,
        reasoning_tokens:0,
        total_tokens:0,
        web_search_calls:0,
        tts_characters:totalCharacters,
        billable_tts_characters:billableCharacters,
        estimated_cost_usd:estimatedCostUsd
      });
    }catch(e){console.error("Noesis TTS usage logging failed:",e?.message||e);}
  }
  await Promise.all(synthesized.map(job=>{
    const path=`users/${userId}/briefs/${briefId}/v${PRODUCTION_VERSION}/${String(job.index).padStart(3,"0")}.wav`;
    job.path=path;
    return upload(path,job.audio,"audio/wav");
  }));
  return {
    configured:true,
    productionVersion:PRODUCTION_VERSION,
    production:"baked",
    voice:VOICE,
    usage:{...usage,billableCharacters,estimatedCostUsd},
    segments:synthesized.map(({index,kind,storyId,label,path})=>({index,kind,storyId,label,path}))
  };
}

module.exports={generateBriefAudio,ttsConfigured,BUCKET,MONTHLY_CHAR_LIMIT};
