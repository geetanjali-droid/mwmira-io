const {test}=require('node:test');const assert=require('node:assert/strict');
const {runtime}=require('../server/inventory.cjs');const {projectChannels,channelPaths}=require('../server/channel-data.cjs');
const schema=require('../docs/firebase-schema-v1.json');const owner={uid:'owner',email:'geetanjali.chaurasiya@mushroomworldgroup.com',emailVerified:true};
const order={channel:'Amazon FBM',order_id:'order-1',order_item_id:'line-1',sku:'01-HECHARGE-PK1',quantity:2,sale_value_paise:123456,out_date:'2026-09-10T12:00:00+05:30',item_status:'Shipped',order_status:'Shipped - Delivered to Buyer',status:'pending'};
test('shared channel paths subscribe once and never include raw archives',()=>{assert.deepEqual(channelPaths(schema),['orders','returns']);});
test('channel records populate original fields, filters and charts without stock or database writes',()=>{
 const app=runtime(schema,{},owner,{orders:{a:order}}),d=app.invoke('getDashboardData',[]);
 assert.equal(d.supervisorEntries[0]['Product Name'],'He Charge');assert.equal(d.supervisorEntries[0]['Read Only'],true);
 const a=app.invoke('getAnalytics',[{range:'custom',from:'2026-09-01',to:'2026-09-30',product:'He Charge',channel:'Amazon FBM'}]);
 assert.equal(a.kpi.dispatched,2);assert.equal(a.kpi.sale,1234.56);assert.equal(a.kpi.grossProfit,null);assert.equal(d.finishedGoods.length,0);assert.deepEqual(app.changedTree(),{});
 assert.equal(app.invoke('getAnalytics',[{range:'custom',from:'2026-09-01',to:'2026-09-30',product:'She Desire'}]).kpi.dispatched,0);
 app.invoke('addRawMaterialReceived',['He Charge',30]);assert.equal(app.changedTree().supervisor_entries,undefined);
});
test('edits and deletion replace projections; cancelled or malformed values are excluded',()=>{
 assert.equal(projectChannels({orders:{a:{...order,quantity:3}}},[],['He Charge']).rows[0]['Quantity (Units)'],3);
 assert.equal(projectChannels({},[],['He Charge']).rows.length,0);
 const output=projectChannels({orders:{a:{...order,quantity:0},b:{...order,order_status:'Cancelled'},c:{...order,sale_value_paise:'123'}}},[],['He Charge']);assert.equal(output.rows.length,0);assert.equal(output.skipped,3);
});
test('processed inventory entry deduplicates channel line; distinct order items survive',()=>{
 const existing=[{'Entry ID':'SE-1','Channel':'Amazon FBM','Entry Type':'Out','Order Item ID':'line-1'}];
 const output=projectChannels({orders:{a:order,b:{...order,order_item_id:'line-2'}}},existing,['He Charge']);assert.equal(output.rows.length,1);assert.equal(output.rows[0]['Order Item ID'],'line-2');
});
