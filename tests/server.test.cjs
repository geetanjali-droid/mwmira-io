const {test}=require('node:test');const assert=require('node:assert/strict');
const {runtime,execute}=require('../server/inventory.cjs');const schema=require('../docs/firebase-schema-v1.json');
const owner={uid:'owner',email:'geetanjali.chaurasiya@mushroomworldgroup.com',emailVerified:true};
const viewer={uid:'viewer',email:'viewer@example.test',emailVerified:true};
const profiles={v:{email:viewer.email,name:'Viewer',role:'Viewer',permissions:'none'}};

test('missing schema never blocks the authenticated workspace, but prevents writes',()=>{
 const app=runtime(null,{},owner);const data=app.invoke('getDashboardData',[]);
 assert.ok(data.schemaWarning);assert.equal(data.rawMaterial.length,0);
 assert.throws(()=>app.invoke('addRawMaterialReceived',['He Charge',30]),/schema mappings/);assert.deepEqual(app.changedTree(),{});
});
test('restored payload has original fields without seeding empty Firebase',()=>{
 const app=runtime(schema,{},owner);const d=app.invoke('getDashboardData',[]);
 assert.equal(d.products.length,12);assert.equal(d.rawMaterial.length,0);assert.ok(d.admin);assert.ok(d.analytics);assert.equal(d.users[0].IsOwner,true);assert.deepEqual(app.changedTree(),{});
});
test('canonical schema values map to original fields and integer paise',()=>{
 const ims={raw_materials:{r:{item_id:'RM-01',product_name:'He Charge',current_stock_ml:300,current_stock_units:10,status:'In Stock'}},prices:{p:{item_id:'PR-01',item_type:'Raw Material',item_name:'He Charge',cost_price_paise:25}},user_profiles:profiles};
 const app=runtime(schema,ims,owner);const d=app.invoke('getDashboardData',[]);
 assert.equal(d.rawMaterial[0]['Current Stock (ml)'],300);assert.equal(d.admin.valuation.rawMaterial,75);
 assert.deepEqual(app.changedTree(),ims);
});
test('login and membership are enforced before data or mutations',async()=>{
 assert.throws(()=>runtime(schema,{},null),/Sign in/);
 assert.throws(()=>runtime(schema,{},viewer),/no workspace access/);
 assert.throws(()=>runtime(schema,{}, {...owner,emailVerified:false}),/verify/);
 let requests=0;await assert.rejects(execute(null,'getDashboardData',[],async()=>{requests++;}),/sign in/i);assert.equal(requests,0);
});
test('viewer cannot mutate or retrieve administration data',()=>{
 const app=runtime(schema,{user_profiles:profiles},viewer);const d=app.invoke('getDashboardData',[]);
 assert.equal(d.admin,undefined);assert.equal(d.users,undefined);assert.equal(d.canEdit,false);
 assert.throws(()=>app.invoke('addRawMaterialReceived',['He Charge',30]),/Access Denied/);
 assert.throws(()=>app.invoke('setUserAccess',['x@example.test','X',{users:true},'','']),/Access Denied/);
 assert.throws(()=>app.invoke('getPriceHistory',[]),/Access Denied/);
 assert.throws(()=>app.invoke('initializeSystem',[]),/unavailable/);
});
test('receipts preserve existing IDs, metadata, unrelated collections and schema',()=>{
 const ims={raw_materials:{existing:{item_id:'RM-01',product_name:'He Charge',opening_stock_ml:100,qty_received_ml:0,consumed_ml:0,current_stock_ml:100,current_stock_units:3,min_threshold_units:0,status:'In Stock',custom_metadata:'preserve'}},external_collection:{x:'untouched'}};
 const app=runtime(schema,ims,owner);app.invoke('addRawMaterialReceived',['He Charge',30]);const next=app.changedTree();
 assert.equal(next.raw_materials.existing.current_stock_ml,130);assert.equal(next.raw_materials.existing.custom_metadata,'preserve');assert.deepEqual(next.external_collection,ims.external_collection);
 assert.equal(Object.keys(next).includes('prices'),false);assert.equal(Object.keys(next).includes('data'),false);assert.equal(Object.values(next.activity).length,1);
});
test('role edits persist only declared profile fields; removal revokes access',()=>{
 const app=runtime(schema,{user_profiles:profiles},owner);app.invoke('toggleUserPerm',[viewer.email,'entries',true]);const next=app.changedTree();
 assert.equal(next.user_profiles.v.permissions,'entries');assert.equal(next.user_profiles.v.role,'Executive');assert.equal(next.user_profiles.v.password,undefined);
 assert.equal(runtime(schema,next,viewer).invoke('getDashboardData',[]).canEdit,true);
 const remove=runtime(schema,next,owner);remove.invoke('removeUserAccess',[viewer.email]);assert.throws(()=>runtime(schema,remove.changedTree(),viewer),/no workspace access/);
});
test('conditional saves abort on concurrent writes without retrying the mutation',async()=>{
 const writes=[];const fake=async(url,options)=>{
  if(url.includes('accounts:lookup'))return new Response(JSON.stringify({users:[{localId:owner.uid,email:owner.email,emailVerified:true}]}));
  if(options.method==='PUT'){writes.push(JSON.parse(options.body));assert.equal(options.headers['If-Match'],'"version-1"');return new Response('{}',{status:412});}
  return new Response(JSON.stringify(url.includes('schema')?schema:{}),{headers:{etag:'"version-1"'}});
 };
 await assert.rejects(execute('test-token','addRawMaterialReceived',['He Charge',30],fake),/another session/);assert.equal(writes.length,1);
});

test('canonical packing, dispatch and reversal survive independent server requests',()=>{
 let ims={raw_materials:{r:{item_id:'RM-01',product_name:'He Charge',opening_stock_ml:300,qty_received_ml:0,consumed_ml:0,current_stock_ml:300,current_stock_units:10}},packaging:{p:{item_id:'PK-01',item_name:'Bottle',applicable_product:'All',opening_stock_pcs:10,qty_received_pcs:0,consumed_pcs:0,current_stock_pcs:10}}};
 const call=(method,...args)=>{const app=runtime(schema,ims,owner);const result=app.invoke(method,args);ims=app.changedTree();return result;};
 call('recordPacking','He Charge',10);call('recordSupervisorEntry','Out','He Charge',3,'','Shopify (.com)','TEST-1',[],'','');
 let data=call('getDashboardData');assert.equal(data.finishedGoods[0]['Current Stock (Units)'],7);assert.equal(data.batches[0].balance,7);assert.equal(ims.raw_materials.r.current_stock_ml,0);
 assert.throws(()=>call('recordSupervisorEntry','Out','He Charge',8,'','Shopify (.com)','TEST-2',[],'',''),/stock/i);
 call('deleteSupervisorEntry',data.supervisorEntries[0]['Entry ID']);data=call('getDashboardData');assert.equal(data.finishedGoods[0]['Current Stock (Units)'],10);assert.equal(data.batches[0].balance,10);
});
