const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const schema = require('../docs/firebase-schema-v1.json');
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(schema => { window.testSchema=schema; }, schema);
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'inventory.test') return route.fulfill({ path: path.join(__dirname, '..', url.pathname === '/' ? 'index.html' : url.pathname.slice(1)) });
        if (url.pathname.endsWith('firebase-app-compat.js')) return route.fulfill({ contentType: 'text/javascript', body: `window.databasePaths=[];window.callbacks=new Map();window.failures=new Map();window.values=new Map([['mira/schema/v1',testSchema],['.info/connected',false]]);window.emit=(path,value)=>{values.set(path,value);for(const cb of callbacks.get(path)||[])cb({val:()=>value});};window.firebase={initializeApp(){},database(){return {ref(path){databasePaths.push(path);return {on(event,callback,error){if(!callbacks.has(path))callbacks.set(path,new Set());callbacks.get(path).add(callback);failures.set(path,error);callback({val:()=>values.get(path)??null});},off(event,callback){callbacks.get(path)?.delete(callback);},set(){throw Error('WRITE FORBIDDEN');},update(){throw Error('WRITE FORBIDDEN');},transaction(){throw Error('WRITE FORBIDDEN');}};}};}};` });
        return route.fulfill({ contentType: 'text/javascript', body: '' });
      });
      await page.goto('http://inventory.test/');
      await page.locator('.btn-login-gold').click();
      await expect(page.locator('#page-dash .workspace-empty h2')).toHaveText('Schema connected · no business records yet');
      for (const section of ['raw','pack','fg','sup','admin','users','dash']) {
        if (width < 760) await page.locator('.gh-hamburger').click();
        await page.locator(`[data-page="${section}"]`).click();
        await expect(page.locator(`#page-${section} .live-results`)).toBeVisible();
      }
      await page.evaluate(() => emit('ims/finished_goods',{a:{item_id:'FG-A',product_name:'Test product',current_stock_units:25,total_packed_units:30}}));
      await expect(page.locator('#page-dash .kpi-card').filter({hasText:'Finished goods'}).locator('.kpi-value')).toHaveText('25');
      await page.evaluate(() => emit('orders',{a:{channel:'Amazon FBM',quantity:2},b:{channel:'Flipkart',quantity:3}}));
      await expect(page.locator('#page-dash .kpi-card').filter({hasText:'Incoming orders'}).locator('.kpi-value')).toHaveText('5');
      await page.evaluate(() => emit('amazon/rollup',{'2026-09':{month:'2026-09',gross_sale_paise:12345,reference_verified:true,coverage_complete:true}}));
      await expect(page.locator('.live-provider-grid .kpi-card').first().locator('.kpi-value')).toHaveText('₹123.45');
      if(width<760)await page.locator('.gh-hamburger').click();
      await page.locator('[data-page="fg"]').click();
      await page.locator('#page-fg .live-collection').selectOption('ims_finished_goods');
      await expect(page.locator('#page-fg .live-table')).toContainText('Test product');
      await page.locator('#page-fg .live-search').fill('Test');
      await page.evaluate(() => emit('ims/finished_goods',{a:{item_id:'FG-A',product_name:'Test product',current_stock_units:17,total_packed_units:30}}));
      await expect(page.locator('#page-fg .live-table')).toContainText('17');
      await expect(page.locator('#page-fg .live-search')).toHaveValue('Test');
      await page.evaluate(() => emit('ims/finished_goods',null));
      await expect(page.locator('#page-fg .live-empty')).toContainText('No matching records');
      await page.evaluate(() => failures.get('ims/finished_goods')({code:'PERMISSION_DENIED'}));
      await expect(page.locator('#page-fg .live-warning')).toContainText('Unable to read');
      await page.evaluate(() => emit('.info/connected',true));
      if(width<760)await page.locator('.gh-hamburger').click();
      await page.locator('[data-page="admin"]').click();
      await page.evaluate(() => emit('meta/spend',{acct:{'2026-09':{'123_2026-09-12':{ad_id:'123',amounts_paise:[{column:'spend',value:1050}]}}}}));
      await page.locator('#page-admin .live-collection').selectOption('meta_detail');
      await expect(page.locator('#page-admin .live-table')).toContainText('₹10.50');
      await page.locator('#theme-toggle').click();
      if(width<760)await page.locator('.gh-hamburger').click();
      await page.locator('[data-page="dash"]').click();
      await page.locator('#page-dash [onclick="loadDashboard()"]').click();
      await expect(page.locator('#live-status')).toContainText('Live connection');
      assert.ok(await page.evaluate(() => [...callbacks.entries()].filter(([p])=>p!=='.info/connected').every(([,set])=>set.size===1)));
      assert.equal(await page.evaluate(()=>databasePaths.includes('data')),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual(errors,[]);
      fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:`test-results/live-dashboard-${width}.png`,fullPage:true});
      console.log(`Live dashboard passed: ${width}px, empty data, all sections, additions, edits, deletions, mixed channels, paise, offline/reconnect, denied reads, no writes`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
