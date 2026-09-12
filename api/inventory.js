const inventory=require('../server/inventory.cjs');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  try {
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
    const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
    const result=await inventory.execute(token,body?.method,body?.args||[]);
    res.status(200).json({result});
  } catch(error) { res.status(error.status||400).json({error:error.message||'Request failed.'}); }
};
