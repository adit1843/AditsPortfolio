const crypto = require("crypto");

const COOKIE_NAME = "briefline_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function b64url(input){
  return Buffer.from(input).toString("base64url");
}
function sign(payload){
  const secret=process.env.BRIEFLINE_SESSION_SECRET;
  if(!secret) return null;
  return crypto.createHmac("sha256",secret).update(payload).digest("base64url");
}
function createSession(){
  const payload=b64url(JSON.stringify({exp:Date.now()+MAX_AGE*1000}));
  const sig=sign(payload);
  if(!sig) throw new Error("BRIEFLINE_SESSION_SECRET is not configured.");
  return payload+"."+sig;
}
function validSession(token){
  if(!token || !process.env.BRIEFLINE_SESSION_SECRET) return false;
  const [payload,sig]=String(token).split(".");
  if(!payload || !sig) return false;
  const expected=sign(payload);
  if(!expected || expected.length!==sig.length) return false;
  try{
    if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig))) return false;
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    return Number(data.exp)>Date.now();
  }catch{return false;}
}
function isAuthed(req){
  return validSession(req.cookies?.[COOKIE_NAME]);
}
function requireAuth(req,res){
  if(isAuthed(req)) return true;
  res.status(401).json({error:"Authentication required."});
  return false;
}
function cookieHeader(token){
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}
function clearCookieHeader(){
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
module.exports={createSession,isAuthed,requireAuth,cookieHeader,clearCookieHeader};
