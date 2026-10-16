const {requireAuth}=require("../lib/briefline/auth");
const {createResponse}=require("../lib/briefline/openai");
function out(d){const p=[];for(const i of d.output||[]){if(i.type!=="message")continue;for(const c of i.content||[]){if(c.type==="output_text"&&c.text)p.push(c.text);}}return p.join("\n").trim();}
module.exports=async(req,res)=>{
  const s=await requireAuth(req,res);if(!s)return;
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"Method not allowed"});}
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"Noesis generation is not configured."});
  const story=req.body?.story,knowledge=req.body?.knowledge||{};
  if(!story?.title||!story?.body)return res.status(400).json({error:"Story context is required."});
  const prompt=`Create a personalized 5-minute-read explainer about this story. Story: ${JSON.stringify(story)}. Hidden knowledge: ${JSON.stringify(knowledge?.concepts||{})}. Missing=0; 0-20 beginner; 21-50 foundational; 51-75 competent; 76-100 advanced. On-demand learning only; it must not affect future story selection. Skip known prerequisites, focus on missing links, tie back to the story, be clear and technically literate. Aim 650-900 words. Return ONLY JSON {"title":"","body":"","takeaway":"","conceptsCovered":[],"sources":[{"name":"","url":""}]}`;
  try{
    const d=await createResponse({userId:s.userId,operation:"explainer",input:prompt,tools:[{type:"web_search"}],maxOutputTokens:4000});
    const text=out(d).replace(/^\s*```(?:json)?/i,"").replace(/```\s*$/i,"").trim();
    return res.status(200).json({explainer:JSON.parse(text),responseId:d.id});
  }catch(e){return res.status(e.status||500).json({error:e instanceof Error?e.message:"Unexpected server error"});}
};