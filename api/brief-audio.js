const {requireAuth}=require("../lib/briefline/auth");
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY=process.env.SUPABASE_SECRET_KEY;
const BUCKET=process.env.BRIEFLINE_AUDIO_BUCKET||"briefline-audio";

function base(){
  return (SUPABASE_URL||"").replace(/\/+$/,"").replace(/\/rest\/v1$/,"");
}

module.exports=async function handler(req,res){
  if(!requireAuth(req,res)) return;

  const path=String(req.query?.path||"");
  if(!path || path.includes("..")) return res.status(400).json({error:"Invalid audio path"});

  try{
    const r=await fetch(`${base()}/storage/v1/object/${BUCKET}/${path}`,{
      headers:{
        apikey:SUPABASE_SECRET_KEY,
        Authorization:`Bearer ${SUPABASE_SECRET_KEY}`
      }
    });

    if(!r.ok) return res.status(r.status).json({error:"Audio not found"});

    const buf=Buffer.from(await r.arrayBuffer());
    const size=buf.length;
    const range=req.headers.range;

    res.setHeader("Content-Type","audio/mpeg");
    res.setHeader("Accept-Ranges","bytes");
    res.setHeader("Cache-Control","private, max-age=86400");

    if(range){
      const match=/bytes=(\d*)-(\d*)/.exec(range);
      if(!match){
        res.setHeader("Content-Range",`bytes */${size}`);
        return res.status(416).end();
      }

      let start=match[1]?Number(match[1]):0;
      let end=match[2]?Number(match[2]):size-1;

      if(!match[1] && match[2]){
        const suffix=Number(match[2]);
        start=Math.max(0,size-suffix);
        end=size-1;
      }

      start=Math.max(0,start);
      end=Math.min(size-1,end);

      if(start>end || start>=size){
        res.setHeader("Content-Range",`bytes */${size}`);
        return res.status(416).end();
      }

      const chunk=buf.subarray(start,end+1);
      res.statusCode=206;
      res.setHeader("Content-Range",`bytes ${start}-${end}/${size}`);
      res.setHeader("Content-Length",String(chunk.length));
      return res.end(chunk);
    }

    res.setHeader("Content-Length",String(size));
    return res.status(200).end(buf);
  }catch(e){
    return res.status(500).json({error:e instanceof Error?e.message:"Audio failed"});
  }
};
