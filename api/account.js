const {requireAuth}=require("../lib/briefline/auth");
const {userRows,insertUserRow,upsert,getProfile,request}=require("../lib/briefline/store");

function defaults(){return{generalNews:40,politics:"important-only",markets:true,topicScores:{},contentTypeScores:{news:55,general_knowledge:50,deep_dive:50,history:50,science:50,business_case:50},mixTargets:{news:45,general_knowledge:20,deep_dive:15,history:7,science:8,business_case:5},requestedTopics:[],avoidedTopics:[],explanationBias:0,languageDirectives:[],editorialDirectives:[],tuningHistory:[],behavioralInterest:{version:1,features:{}}};}

module.exports=async(req,res)=>{
  const s=requireAuth(req,res);if(!s)return;
  try{
    if(req.method==="GET"){
      const [p,prefs]=await Promise.all([getProfile(s.userId),userRows("preferences",s.userId,{limit:1})]);
      const owner=Boolean(process.env.SURVEY_EMAIL_TO&&String(s.email||"").toLowerCase()===String(process.env.SURVEY_EMAIL_TO).toLowerCase());
      return res.status(200).json({user:{email:s.email},profile:p||null,preferences:prefs?.[0]?.payload||defaults(),owner});
    }
    if(req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"});}
    const b=req.body||{};
    if(b.action==="reset_neosis"){
      if(String(b.confirmation||"")!=="RESET NEOSIS")return res.status(400).json({error:"Reset confirmation did not match."});
      const old=await getProfile(s.userId);
      for(const table of ["briefs","explainers","preferences","knowledge","coverage","surveys","recommendation_events"]){
        await request(`${table}?user_id=eq.${encodeURIComponent(s.userId)}`,{method:"DELETE"});
      }
      await insertUserRow("preferences",s.userId,{payload:defaults()});
      await insertUserRow("knowledge",s.userId,{payload:{concepts:{},seenEvents:{}}});
      if(old)await request(`profiles?user_id=eq.${encodeURIComponent(s.userId)}`,{method:"PATCH",body:JSON.stringify({last_brief_local_date:null,updated_at:new Date().toISOString()})});
      return res.status(200).json({ok:true,reset:true});
    }
    const old=await getProfile(s.userId),x=b.profile||{},complete=Boolean(b.completeOnboarding||old?.onboarding_complete);
    const p={user_id:s.userId,email:s.email,display_name:String(x.displayName??old?.display_name??"").trim().slice(0,80),timezone:String(x.timezone??old?.timezone??"UTC").slice(0,80),email_enabled:x.emailEnabled===undefined?(old?.email_enabled??true):Boolean(x.emailEnabled),audio_enabled:x.audioEnabled===undefined?(old?.audio_enabled??true):Boolean(x.audioEnabled),onboarding_complete:complete,updated_at:new Date().toISOString()};
    await upsert("profiles",p);

    if(complete&&process.env.SURVEY_EMAIL_TO&&String(s.email||"").toLowerCase()===String(process.env.SURVEY_EMAIL_TO).toLowerCase()){
      for(const table of ["briefs","explainers","preferences","knowledge","coverage","surveys"]){
        await request(`${table}?user_id=is.null`,{method:"PATCH",body:JSON.stringify({user_id:s.userId})});
      }
    }
    if(b.preferences){
      const prefs={...defaults(),...b.preferences};
      prefs.requestedTopics=Array.isArray(prefs.requestedTopics)?prefs.requestedTopics.slice(0,30):[];
      prefs.avoidedTopics=Array.isArray(prefs.avoidedTopics)?prefs.avoidedTopics.slice(0,30):[];
      await insertUserRow("preferences",s.userId,{payload:prefs});
    }
    if(complete){
      const existingPrefs=await userRows("preferences",s.userId,{limit:1});
      if(!existingPrefs?.length)await insertUserRow("preferences",s.userId,{payload:defaults()});
    }
    return res.status(200).json({ok:true,profile:p});
  }catch(e){return res.status(400).json({error:e instanceof Error?e.message:"Could not save account settings"});}
};