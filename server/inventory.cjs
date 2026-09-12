const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const config = require('./config.cjs');
const {channelPaths,projectChannels}=require('./channel-data.cjs');
process.env.TZ='Asia/Kolkata';
const sources = ['gas-shim.js','backend.js'].map(file => fs.readFileSync(path.join(__dirname,'../js',file),'utf8'));
const TABLES = { RAW:'ims_raw_materials', PACK:'ims_packaging', FG:'ims_finished_goods', SUP:'ims_supervisor_entries', PRICE:'ims_prices', HISTORY:'ims_price_history', ACTIVITY:'ims_activity', CHPRICE:'ims_channel_prices', ADMIN:'ims_user_profiles', BATCH:'ims_batches', IMPORTS:'ims_agent_imports', SKUMAP:'ims_sku_map' };
const READ = new Set(['getDashboardData','getAnalytics','getPeriodMovement','getPriceHistory','getChangeHistory','getBatchTrace','getAgentStatus','testFirebaseConnection']);
const WRITE = new Set(['toggleUserPerm','setUserAccess','removeUserAccess','updateRates','addRawMaterialReceived','addPackagingReceived','recordPacking','updateRawMaterialRow','updatePackagingRow','updateFinishedGoodsRow','updateSupervisorEntry','recordSupervisorEntry','resolvePendingReturn','deleteSupervisorEntry','updateBatchRow','deleteRawMaterialRow','deleteFinishedGoodsRow','deletePackagingItem']);
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
function error(message,status=400) { return Object.assign(new Error(message),{status}); }
function profileAccess(identity, ims) {
  if (!identity?.email || !identity.uid) throw error('Sign in with a Firebase account.',401);
  const email=identity.email.toLowerCase();
  if(email===config.ownerEmail) { if(!identity.emailVerified)throw error('Use Google sign-in or verify the owner email before accessing the workspace.',403); return {email,name:'Owner',role:'Super Admin',permissions:'admin,entries,edit,delete,users'}; }
  const profile=Object.values(ims?.user_profiles||{}).find(p=>p && String(p.email||'').toLowerCase()===email);
  if(!profile) throw error('This account has no workspace access. Contact your administrator.',403);
  return profile;
}
function runtime(schema, ims, identity, channelData={}) {
  profileAccess(identity,ims);
  const context=vm.createContext({ console:{log(){},error(){}}, structuredClone, CURRENT_EMAIL:identity.email });
  context.window=context;
  sources.forEach(source=>vm.runInContext(source,context));
  const run=code=>vm.runInContext(code,context,{timeout:10000});
  run(`EMAIL_ = ${JSON.stringify(identity.email.toLowerCase())}; window.CURRENT_EMAIL=EMAIL_;`);
  // Empty in-memory tables are adapters, never seeded records. Disable read-time repair/seed hooks.
  run(`ensurePriceRows_=function(){return false;}; ensurePackagingRows_=function(){return false;};
    initializeSystem=function(){throw new Error('Automatic initialization is disabled.');};
    normalizeRole_=function(r){ const v=String(r||'').trim().toLowerCase(); return ({'super admin':'Super Admin','admin':'Admin','executive':'Executive','viewer':'Viewer','custom':'Custom'})[v]||'Viewer'; };
    const originalUsers=usersWithoutPasscode_;
    usersWithoutPasscode_=function(){const users=originalUsers();users.forEach(u=>{u.HasPasscode=true;});
      if(!users.some(u=>String(u.Email).toLowerCase()===OWNER_EMAIL))users.unshift({Email:OWNER_EMAIL,Name:'Owner',Role:'Super Admin',Perms:permsForRole_('Super Admin'),IsOwner:true,HasPasscode:true,WhatsApp:''});return users;};`);
  const metadata=run('({CONFIG,HEADERS})');
  const tables=[], missing=[];
  for(const [table,catalogName] of Object.entries(TABLES)) {
    let def=schema?.collections?.[catalogName];
    if(!def || !/^ims\/\w+\/\{record_id\}$/.test(def.path_template)) {
      missing.push(catalogName);def={path_template:'ims/'+catalogName.replace(/^ims_/,'')+'/{record_id}',fields:{}};
    }
    const collection=def.path_template.split('/')[1];
    const headers=Array.from(metadata.HEADERS[table]);
    const fields=headers.map(header=>Object.entries(def.fields||{}).find(([,field])=>field.source_header===header)?.[0]||null);
    const original=missing.includes(catalogName)?{}:(ims?.[collection]||{});
    if(typeof original!=='object'||Array.isArray(original))throw error('Invalid collection: '+collection,422);
    const rowEntries=Object.entries(original).filter(([,value])=>value && typeof value==='object'&&!Array.isArray(value));
    const rows=rowEntries.map(([,record])=>fields.map(field=>{
      if(!field||!own(record,field))return '';
      const value=record[field];
      if(field.endsWith('_paise')) { if(!Number.isSafeInteger(value)) throw error('Invalid integer amount in '+collection+'/'+field,422); return value/100; }
      return value;
    }));
    const name=metadata.CONFIG.SHEETS[table];
    context._table={name,rows:[headers,...rows]};run('MEM.sheets[_table.name]=_table');
    tables.push({table,name,collection,headers,fields,original,rowEntries,rows:structuredClone(rows),def});
  }
  // Keep the original product catalogue/fields while including valid products already in Firebase.
  run(`CONFIG.PRODUCTS=Array.from(new Set(CONFIG.PRODUCTS.concat(getRawMaterialData().map(r=>r['Product Name']),getFinishedGoodsData().map(r=>r['Product Name'])))).filter(Boolean);`);
  context._channelData=channelData;context._projectChannels=projectChannels;
  run(`const inventorySources=loadSources_;loadSources_=function(){const src=inventorySources();
    const projected=_projectChannels(_channelData,src.supAll,CONFIG.PRODUCTS,sheetToObjects_(getSheet_(CONFIG.SHEETS.SKUMAP)));
    src.supAll=src.supAll.concat(projected.rows).sort((a,b)=>new Date(a.Timestamp)-new Date(b.Timestamp));
    CONFIG.PRODUCTS=Array.from(new Set(CONFIG.PRODUCTS.concat(projected.rows.map(r=>r['Product Name']))));
    CONFIG.CHANNELS=Array.from(new Set(CONFIG.CHANNELS.concat(projected.rows.map(r=>r.Channel))));return src;};`);
  run(`const channelAnalytics=computeAnalytics_;computeAnalytics_=function(filters,src,costing,isAdmin){
    const output=channelAnalytics(filters,src,costing,isAdmin);
    const external=src.supAll.filter(r=>r['Read Only']&&(!filters.product||r['Product Name']===filters.product)&&(!filters.channel||r.Channel===filters.channel));
    if(external.length){if(isAdmin){output.kpi.grossProfit=null;output.products.forEach(p=>{if(external.some(r=>r['Product Name']===p.product)){delete p.profit;delete p.marginPct;}});}
      output.insights=output.insights.filter(i=>!i.text.includes('Most profitable')&&!i.text.includes('drawn down faster'));
    }return output;};`);
  function invoke(method,args) {
    if(!READ.has(method)&&!WRITE.has(method))throw error('This operation is unavailable in the Firebase deployment.',400);
    if(WRITE.has(method)&&missing.length)throw error('Inventory schema mappings are incomplete. No changes saved.',503);
    if(method==='removeUserAccess'&&String(args[0]).toLowerCase()===identity.email.toLowerCase())throw error('You cannot remove your own workspace access.');
    if(method==='setUserAccess'&&args[3])throw error('Passwords are managed by Firebase Authentication, not stored in inventory profiles.');
    context._request={method,args};
    if(method==='testFirebaseConnection'){run('requireAdmin_()');return {ok:true,live:true,collections:tables.filter(t=>Object.keys(t.original).length).length};}
    const result=run('window[_request.method].apply(null,_request.args)');
    if(method==='getAgentStatus')Object.assign(result,{live:true,configured:true,urlMasked:new URL(config.databaseURL).hostname});
    if(method==='getDashboardData'&&missing.length)result.schemaWarning='Some inventory mappings are unavailable. The workspace is open; saving will resume when your schema is ready.';
    if(method==='getDashboardData'&&Object.values(channelData).some(v=>Object.keys(v||{}).length))result.sourceNotice='Sales and dispatch include Firebase channel orders. Stock and production use IMS records. Channel orders do not change inventory; profit requires recorded costs.';
    const dashboard=method==='getDashboardData'?result:result?.dashboard;
    if(dashboard?.admin&&Object.values(channelData).some(v=>Object.keys(v||{}).length)){
      for(const bucket of [dashboard.admin.dispatch.month,dashboard.admin.dispatch.allTime,...dashboard.admin.dispatch.byChannel])bucket.outValueCost=null;
    }
    return JSON.parse(JSON.stringify(result));
  }
  function changedTree() {
    const next=structuredClone(ims||{});
    for(const t of tables) {
      context._sheetName=t.name;
      const rows=JSON.parse(run('JSON.stringify(MEM.sheets[_sheetName].rows.slice(1))'));
      if(JSON.stringify(rows)===JSON.stringify(t.rows))continue;
      const identityOf=row=>t.table==='CHPRICE'?JSON.stringify(row.slice(0,2)):(['ACTIVITY','HISTORY','IMPORTS'].includes(t.table)?JSON.stringify(row):String(row[0]));
      const keys=new Map();t.rows.forEach((row,i)=>{const id=identityOf(row);if(!keys.has(id))keys.set(id,[]);keys.get(id).push(t.rowEntries[i][0]);});
      const output=Object.fromEntries(Object.entries(t.original).filter(([,value])=>!value||typeof value!=='object'||Array.isArray(value)));
      for(const row of rows) {
        const id=identityOf(row);const existing=keys.get(id)?.shift();
        const key=existing||(['ACTIVITY','HISTORY','IMPORTS'].includes(t.table)?crypto.randomUUID():crypto.createHash('sha256').update(id).digest('hex'));
        const record=existing?structuredClone(t.original[existing]):{};
        const oldRow=existing?t.rows[t.rowEntries.findIndex(([k])=>k===existing)]:null;
        for(let i=0;i<t.fields.length;i++) {
          const field=t.fields[i]; if(!field)continue;
          const value=row[i]??'';
          if(oldRow && JSON.stringify(value)===JSON.stringify(oldRow[i]))continue;
          if(value==='') { if(own(record,field))delete record[field]; continue; }
          let stored=value;
          if(field.endsWith('_paise')) {const paise=Number(value)*100;stored=Math.round(paise);if(!Number.isSafeInteger(stored)||Math.abs(paise-stored)>1e-7)throw error('Amount must be representable in whole paise: '+field);}
          const spec=t.def.fields[field];
          if(spec.type==='integer'&&!Number.isSafeInteger(stored))throw error('Whole number required for '+field);
          if(typeof stored==='number'&&!Number.isFinite(stored))throw error('Invalid value for '+field);
          record[field]=stored;
        }
        output[key]=record;
      }
      if(Object.keys(output).length)next[t.collection]=output;else delete next[t.collection];
    }
    return next;
  }
  return {invoke,changedTree};
}
async function identity(token, fetcher=fetch) {
  if(!token)throw error('Please sign in.',401);
  const response=await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:token}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();const user=data.users?.[0];
  if(!response.ok||!user)throw error('Your session expired. Sign in again.',401);
  return {uid:user.localId,email:user.email,emailVerified:user.emailVerified===true};
}
async function dbRequest(node,token,options={},fetcher=fetch) {
  return fetcher(config.databaseURL+'/'+node+'.json?auth='+encodeURIComponent(token),{...options,headers:{'Content-Type':'application/json',...(options.headers||{})},signal:options.signal||AbortSignal.timeout(20000)});
}
async function execute(token,method,args,fetcher=fetch) {
  if(!READ.has(method)&&!WRITE.has(method))throw error('Unsupported operation.');
  if(!Array.isArray(args)||JSON.stringify(args).length>100000)throw error('Invalid request.');
  const user=await identity(token,fetcher);
  const [schemaResponse,imsResponse]=await Promise.all([dbRequest('mira/schema/v1',token,{},fetcher),dbRequest('ims',token,{headers:{'X-Firebase-ETag':'true'}},fetcher)]);
  if(!schemaResponse.ok||!imsResponse.ok)throw error('Firebase denied access to the inventory or schema.',403);
  const [schema,ims]=await Promise.all([schemaResponse.json(),imsResponse.json()]);
  profileAccess(user,ims);
  const channelData=Object.fromEntries(await Promise.all(channelPaths(schema).map(async path=>{
    const response=await dbRequest(path,token,{},fetcher);if(!response.ok)throw error('Cannot read Firebase '+path+'. Please retry.',503);return [path,await response.json()||{}];
  })));
  const app=runtime(schema,ims,user,channelData);
  const password=method==='setUserAccess'?String(args[3]||''):'';
  if(password) {
    if(password.length<6)throw error('Firebase passwords must contain at least 6 characters.');
    if(Object.values(ims?.user_profiles||{}).some(p=>String(p?.email||'').toLowerCase()===String(args[0]).toLowerCase()))throw error('Change an existing password through Firebase Authentication. Leave this field blank to update roles.');
    args=args.slice();args[3]='';
  }
  let result;try{result=app.invoke(method,args);}catch(e){if(/Access Denied/.test(e.message))throw error(e.message,403);throw e;}
  let createdToken;
  if(password) {
    const response=await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:String(args[0]).trim(),password,returnSecureToken:true}),signal:AbortSignal.timeout(15000)});
    const account=await response.json();if(!response.ok)throw error(account.error?.message==='EMAIL_EXISTS'?'This email already has a Firebase login. Leave the password blank to grant workspace access.':'Firebase could not create this login.');
    createdToken=account.idToken;
  }
  try {
  if(WRITE.has(method)) {
    const next=app.changedTree();
    if(JSON.stringify(next)!==JSON.stringify(ims||{})) {
      const etag=imsResponse.headers.get('etag');if(!etag)throw error('Firebase did not provide a write version. No changes saved.',503);
      const save=await dbRequest('ims',token,{method:'PUT',headers:{'If-Match':etag},body:JSON.stringify(next)},fetcher);
      if(save.status===412)throw error('Inventory changed in another session. Refresh and try again; nothing was saved.',409);
      if(!save.ok)throw error('Firebase rejected the save. No changes were saved.',save.status===401||save.status===403?403:503);
    }
  }
  return result;
  } catch(failure) {
    if(createdToken) {
      const undo=await fetcher('https://identitytoolkit.googleapis.com/v1/accounts:delete?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:createdToken}),signal:AbortSignal.timeout(15000)});
      if(!undo.ok)throw error('Profile save failed. A Firebase login was created but has no workspace access; retry with the password blank.',503);
    }
    throw failure;
  }
}
module.exports={runtime,execute,identity,profileAccess,dbRequest,error,READ,WRITE};
