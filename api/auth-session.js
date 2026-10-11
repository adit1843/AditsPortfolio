const {isAuthed}=require("../lib/briefline/auth");
module.exports=async function handler(req,res){
  return res.status(200).json({authenticated:isAuthed(req)});
};
