const crypto=require("crypto");
const U=process.env.SUPABASE_URL,K=process.env.SUPABASE_SECRET_KEY;
function base(){return (U||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");}
function headers(){return{apikey:K,Authorization:`Bearer ${K}`,"Content-Type":"application/json"};}
async function request(path,options={}){const r=await fetch(`${base()}/rest/v1/${path}`,{...options,headers:{...headers(),...(options.headers||{})}}),t=await r.text();let d=null;try{d=t?JSON.parse(t):null;}catch{d=t;}if(!r.ok)throw new Error(typeof d==="object"?(d?.message||JSON.stringify(d)):String(d||r.statusText));return d;}
async function userRows(table,userId,{limit=100,order="created_at.desc"}={}){return request(`${table}?user_id=eq.${encodeURIComponent(userId)}&select=*&order=${order}&limit=${limit}`);}
async function insertUserRow(table,userId,row){return request(table,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([{...row,user_id:userId}])});}
async function upsert(table,row,onConflict="user_id"){return request(`${table}?on_conflict=${encodeURIComponent(onConflict)}`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([row])});}
function keyMaterial(){const s=process.env.NEOSIS_CREDENTIALS_KEY;if(!s)throw new Error("NEOSIS_CREDENTIALS_KEY is not configured.");return crypto.createHash("sha256").update(s).digest();}
function encryptSecret(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",keyMaterial(),iv),enc=Buffer.concat([c.update(String(value),"utf8"),c.final()]),tag=c.getAuthTag();return["v1",iv.toString("base64url"),tag.toString("base64url"),enc.toString("base64url")].join(".");}
function decryptSecret(value){const [v,iv,tag,data]=String(value||"").split(".");if(v!=="v1"||!iv||!tag||!data)throw new Error("Stored credential is invalid.");const d=crypto.createDecipheriv("aes-256-gcm",keyMaterial(),Buffer.from(iv,"base64url"));d.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([d.update(Buffer.from(data,"base64url")),d.final()]).toString("utf8");}
async function getProfile(userId){return (await userRows("profiles",userId,{limit:1}))?.[0]||null;}
async function getOpenAIKey(userId){const r=(await userRows("user_api_credentials",userId,{limit:1}))?.[0];return r?.openai_api_key_ciphertext?decryptSecret(r.openai_api_key_ciphertext):null;}
async function listProfiles(){return request("profiles?select=*&onboarding_complete=eq.true&order=created_at.asc&limit=500");}
module.exports={request,userRows,insertUserRow,upsert,encryptSecret,decryptSecret,getProfile,getOpenAIKey,listProfiles};