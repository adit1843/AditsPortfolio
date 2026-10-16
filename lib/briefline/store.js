const U=process.env.SUPABASE_URL,K=process.env.SUPABASE_SECRET_KEY;
function base(){return (U||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");}
function headers(){return{apikey:K,Authorization:`Bearer ${K}`,"Content-Type":"application/json"};}
async function request(path,options={}){const r=await fetch(`${base()}/rest/v1/${path}`,{...options,headers:{...headers(),...(options.headers||{})}}),t=await r.text();let d=null;try{d=t?JSON.parse(t):null;}catch{d=t;}if(!r.ok)throw new Error(typeof d==="object"?(d?.message||JSON.stringify(d)):String(d||r.statusText));return d;}
async function userRows(table,userId,{limit=100,order="created_at.desc"}={}){return request(`${table}?user_id=eq.${encodeURIComponent(userId)}&select=*&order=${order}&limit=${limit}`);}
async function insertUserRow(table,userId,row){return request(table,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify([{...row,user_id:userId}])});}
async function upsert(table,row,onConflict="user_id"){return request(`${table}?on_conflict=${encodeURIComponent(onConflict)}`,{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify([row])});}
async function getProfile(userId){return (await userRows("profiles",userId,{limit:1}))?.[0]||null;}
async function listProfiles(){return request("profiles?select=*&onboarding_complete=eq.true&account_active=eq.true&order=created_at.asc&limit=500");}
module.exports={request,userRows,insertUserRow,upsert,getProfile,listProfiles};
