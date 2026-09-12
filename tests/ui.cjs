const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {runtime}=require('../server/inventory.cjs');
const schema=require('../docs/firebase-schema-v1.json');
const owner={uid:'owner',email:'geetanjali.chaurasiya@mushroomworldgroup.com',emailVerified:true};
const viewer={uid:'viewer',email:'viewer@example.test',emailVerified:true};
const mock=`const callbacks=[];const AUTH={currentUser:null,setPersistence:async()=>{},onAuthStateChanged(fn){callbacks.push(fn);fn(this.currentUser);},async signInWithEmailAndPassword(email,password){if(password!=='test-password')throw Error('Incorrect email or password');this.currentUser={uid:email.startsWith('viewer')?'viewer':'owner',getIdToken:async()=>email.startsWith('viewer')?'viewer':'owner'};callbacks.forEach(fn=>fn(this.currentUser));},async signInWithPopup(){return this.signInWithEmailAndPassword('owner','test-password');},async signOut(){this.currentUser=null;callbacks.forEach(fn=>fn(null));}};const firebase={auth:{Auth:{Persistence:{SESSION:'session'}},GoogleAuthProvider:function(){}}};`;
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'chrome',headless:true});
 try{for(const width of [1440,390]){
  let ims={user_profiles:{v:{email:viewer.email,name:'Viewer',role:'Viewer',permissions:'none'}}},reads=0,events=0;
  const channelData={orders:{}};
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{errors.push(d.message());await d.dismiss();});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='inventory.test'){
    if(url.pathname==='/api/inventory'){
     const {method,args}=route.request().postDataJSON();reads++;
     try{const app=runtime(schema,ims,route.request().headers().authorization==='Bearer owner'?owner:viewer,channelData);const result=app.invoke(method,args);ims=app.changedTree();return route.fulfill({json:{result}});}catch(e){return route.fulfill({status:/access|Access/.test(e.message)?403:400,json:{error:e.message}});}
    }
    if(url.pathname==='/api/events'){events++;return route.fulfill({contentType:'text/event-stream',body:'event: changed\ndata: {}\n\n'});}
    if(url.pathname==='/js/firebase-init.js')return route.fulfill({contentType:'text/javascript',body:mock});
    return route.fulfill({path:path.join(__dirname,'..',url.pathname==='/'?'index.html':url.pathname.slice(1))});
   }
   if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:''});
   if(url.hostname.includes('firebasedatabase'))throw Error('Live database access prohibited');
   return route.continue();
  });
  await page.goto('http://inventory.test/');
  await expect(page.locator('#app-wrapper')).toBeHidden();assert.equal(reads,0);
  await page.locator('#login-email').fill(owner.email);await page.locator('#login-passcode').fill('wrong');await page.locator('.btn-login-gold').click();
  await expect(page.locator('#login-error')).toContainText('Incorrect');await expect(page.locator('#app-wrapper')).toBeHidden();assert.equal(reads,0);
  await page.locator('#google-login').click();await expect(page.locator('#app-wrapper')).toBeVisible();
  await expect(page.locator('#raw-table-wrap')).toContainText('Current Stock');
  assert.equal(await page.locator('#page-dash canvas').count()>0,true);
  for(const name of ['admin','raw','pack','fg','sup','users','dash']){
   if(width<760)await page.locator('.gh-hamburger').click();
   await page.locator(`[data-page="${name}"]`).click();await expect(page.locator('#page-'+name)).toBeVisible();
  }
  await expect(page.locator('#user-table-wrap')).toContainText('Viewer');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'page overflow');
  await page.evaluate(()=>openModal('modal-raw-received'));await page.locator('#raw-product').selectOption('He Charge');await page.locator('#raw-qty').fill('45');
  ims.raw_materials={r:{item_id:'RM-01',product_name:'He Charge',current_stock_ml:300,current_stock_units:10,status:'In Stock'}};
  await expect(page.locator('#raw-table-wrap')).toContainText('300',{timeout:8000});
  await expect(page.locator('#raw-qty')).toHaveValue('45');await expect(page.locator('#raw-product')).toHaveValue('He Charge');assert.ok(events>0);
  await page.keyboard.press('Escape');await expect(page.locator('#modal-raw-received')).toBeHidden();
  channelData.orders.a={order_id:'TEST-CHANNEL',order_item_id:'TEST-LINE',channel:'Amazon FBM',sku:'01-HECHARGE-PK1',quantity:2,sale_value_paise:123456,out_date:new Date().toISOString(),item_status:'Shipped'};
  await expect(page.locator('#dash-kpi-1')).toContainText('1,235',{timeout:8000});
  await page.evaluate(()=>switchPage('sup'));await expect(page.locator('#sup-table-wrap')).toContainText('TEST-CHANNEL');
  assert.equal(await page.locator('#sup-table-wrap button').count(),0,'channel entries cannot edit stock');
  delete channelData.orders.a;await expect(page.locator('#sup-table-wrap')).not.toContainText('TEST-CHANNEL',{timeout:8000});
  await page.evaluate(()=>switchPage('dash'));
  fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:`test-results/restored-${width}.png`,fullPage:true});
  await page.evaluate(()=>MiraAuth.signOut());await expect(page.locator('#app-wrapper')).toBeHidden();
  await page.locator('#login-email').fill(viewer.email);await page.locator('#login-passcode').fill('test-password');await page.locator('.btn-login-gold').click();await expect(page.locator('#app-wrapper')).toBeVisible();
  await expect(page.locator('[data-page="admin"]')).toBeHidden();await expect(page.locator('[data-page="users"]')).toBeHidden();
  await page.evaluate(()=>switchPage('raw'));await expect(page.locator('[onclick="openModal(\'modal-raw-received\')"]')).toBeHidden();
  delete ims.user_profiles.v;
  await expect(page.locator('#app-wrapper')).toBeHidden({timeout:8000});
  assert.deepEqual(errors.filter(e=>!e.includes('no workspace access')),[]);
  console.log(`UI passed ${width}px: login required, original 7 pages, live update, form preservation, role restrictions, revocation, no overflow`);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
