// Read-only projections of the user's channel contract into the original UI fields.
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function channelPaths(schema){
 return [...new Set(Object.entries(schema?.collections||{}).filter(([name])=>/^(amazon|flipkart)_(orders|returns)$/.test(name)).map(([,def])=>def.path_template?.replace(/\/\{record_id\}$/,'')))].filter(path=>path==='orders'||path==='returns');
}
function projectChannels(data, existing, products, skuMap=[]){
 const result=[],seen=new Set();let skipped=0;
 const matchProduct=r=>{
  const mapped=skuMap.find(s=>s['SKU']===r.sku&&(!s['Channel']||s['Channel']===r.channel));
  if(mapped?.['Product Name'])return mapped['Product Name'];
  const token=normalize(String(r.sku||'').replace(/^[^-]+-/,'').replace(/-PK\d+$/i,''));
  const skuProduct=products.find(p=>normalize(p)===token);if(skuProduct)return skuProduct;
  const titleMatches=products.filter(p=>normalize(r.product_ref).includes(normalize(p)));
  return (titleMatches.length===1?titleMatches[0]:null)||String(r.product_ref||r.sku||'Unmapped product');
 };
 for(const path of ['orders','returns'])for(const [key,r] of Object.entries(data[path]||{})){
  if(!r||typeof r!=='object') {skipped++;continue;}
  const type=path==='orders'?'Out':'RTO-Pending';
  const id=[r.channel,r.order_item_id||r.order_id,r.sku,type].join('|');
  const duplicate=existing.some(e=>(r.entry_id&&e['Entry ID']===r.entry_id)||(e['Channel']===r.channel&&e['Entry Type']===type&&((r.order_item_id&&e['Order Item ID']===r.order_item_id)||(!r.order_item_id&&r.order_id&&e['Order ID']===r.order_id&&e['SKU']===r.sku))));
  if(duplicate||seen.has(id))continue;
  const date=r.out_date||r.order_date;
  if(!Number.isSafeInteger(r.quantity)||r.quantity<1||!date||!Number.isFinite(Date.parse(date))||!r.order_id||!r.channel||!Number.isSafeInteger(r.sale_value_paise)){skipped++;continue;}
  if(path==='orders'&&(/cancel|unshipped|pending/i.test(r.item_status||'')||/cancel/i.test(r.order_status||''))){skipped++;continue;}
  seen.add(id);
  result.push({'Entry ID':'channel:'+path+':'+key,'Timestamp':date,'Entry Type':type,'Channel':r.channel,'Order ID':r.order_id,'Order Item ID':r.order_item_id||'','Product Name':matchProduct(r),'SKU':r.sku||'','Quantity (Units)':r.quantity,'Sale Value (₹)':r.sale_value_paise/100,'Selling Price (₹)':r.sale_value_paise/100/r.quantity,'Unit Cost (₹)':'','Source':'Auto','Channel Date':date,'Supervisor Email':'Firebase channel feed','Remarks':[r.order_status,r.status,'Channel record; inventory not adjusted'].filter(Boolean).join(' · '),'Read Only':true});
 }
 return {rows:result,skipped};
}
module.exports={channelPaths,projectChannels};
