const {getProfile}=require("./store");
const crypto=require("crypto");
const COOKIE_NAME="noesis_session",MAX_AGE=60*60*24*30;
function b64url(input){return Buffer.from(input).toString("base64url");}
function sign(payload){const s=process.env.BRIEFLINE_SESSION_SECRET;return s?crypto.createHmac("sha256",s).update(payload).digest("base64url"):null;}
function createSession(user){if(!user?.id)throw new Error("A user id is required.");const payload=b64url(JSON.stringify({userId:String(user.id),email:String(user.email||""),exp:Date.now()+MAX_AGE*1000})),sig=sign(payload);if(!sig)throw new Error("BRIEFLINE_SESSION_SECRET is not configured.");return payload+"."+sig;}
function getSession(req){const token=req.cookies?.[COOKIE_NAME];if(!token||!process.env.BRIEFLINE_SESSION_SECRET)return null;const [payload,sig]=String(token).split(".");if(!payload||!sig)return null;const expected=sign(payload);if(!expected||expected.length!==sig.length)return null;try{if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return null;const d=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));return Number(d.exp)>Date.now()&&d.userId?d:null;}catch{return null;}}
function isAuthed(req){return Boolean(getSession(req));}
async function requireAuth(req,res){const s=getSession(req);if(!s){res.status(401).json({error:"Authentication required."});return null;}try{const p=await getProfile(s.userId);if(p&&p.account_active===false){res.setHeader("Set-Cookie",clearCookieHeader());res.status(403).json({error:"This Noesis account is disabled.",code:"account_disabled"});return null;}}catch{}return s;}
function cookieHeader(token){return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;}
function clearCookieHeader(){return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
module.exports={createSession,getSession,isAuthed,requireAuth,cookieHeader,clearCookieHeader};