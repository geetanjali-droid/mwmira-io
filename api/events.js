const inventory=require('../server/inventory.cjs');
const {channelPaths}=require('../server/channel-data.cjs');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).end();
  const controller=new AbortController();let timer;
  try{
    const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
    const user=await inventory.identity(token);
    const current=await inventory.dbRequest('ims/user_profiles',token);if(!current.ok)throw inventory.error('Access denied.',403);
    inventory.profileAccess(user,{user_profiles:await current.json()});
    const schemaResponse=await inventory.dbRequest('mira/schema/v1',token);if(!schemaResponse.ok)throw inventory.error('Schema unavailable.',503);
    const paths=['ims','mira/schema/v1',...channelPaths(await schemaResponse.json())];
    res.setHeader('Content-Type','text/event-stream');res.setHeader('X-Accel-Buffering','no');res.status(200);res.flushHeaders?.();
    timer=setTimeout(()=>controller.abort(),50000);res.on('close',()=>controller.abort());
    await Promise.all(paths.map(async node=>{
      const stream=await inventory.dbRequest(node,token,{headers:{Accept:'text/event-stream'},signal:controller.signal});
      if(!stream.ok)throw inventory.error('Live updates unavailable.',503);
      const decoder=new TextDecoder();let pending='';
      for await(const bytes of stream.body){
        pending+=decoder.decode(bytes,{stream:true});let split;
        while((split=pending.indexOf('\n\n'))!==-1){
          const event=pending.slice(0,split);pending=pending.slice(split+2);
          if(/^event: (put|patch)/m.test(event))res.write('event: changed\ndata: {}\n\n');
          if(/^event: (cancel|auth_revoked)/m.test(event))throw inventory.error('Live session revoked.',401);
        }
      }
    }));
  }catch(error){if(!res.headersSent)res.status(error.status||503).json({error:error.message});}
  finally{clearTimeout(timer);controller.abort();res.end();}
};
