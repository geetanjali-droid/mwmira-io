const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'inventory.test') return route.fulfill({ path: path.join(__dirname, '..', url.pathname === '/' ? 'index.html' : url.pathname.slice(1)) });
        if (url.pathname.endsWith('firebase-app-compat.js')) return route.fulfill({ contentType: 'text/javascript', body: `window.databasePaths=[]; window.firebase={initializeApp(){},database(){return {ref(path){databasePaths.push(path);if(path!=='.info/connected')throw Error('Unexpected database access');return {on(event,callback){window.connectionCallback=callback;callback({val:()=>false});}};}};}};` });
        return route.fulfill({ contentType: 'text/javascript', body: '' });
      });
      await page.goto('http://inventory.test/');
      assert.equal(await page.locator('.btn-login-gold').isEnabled(), true);
      assert.equal(await page.locator('.btn-login-gold').textContent(), 'Open dashboard');
      await page.locator('.btn-login-gold').click();
      await page.locator('#app-wrapper').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#page-dash .workspace-empty h2').textContent(), 'Your dashboard is ready');
      for (const section of ['raw', 'pack', 'fg', 'sup', 'admin', 'users', 'dash']) {
        if (width < 760) await page.locator('.gh-hamburger').click();
        await page.locator(`[data-page="${section}"]`).click();
        assert.equal(await page.locator(`#page-${section} .workspace-empty`).isVisible(), true);
      }
      await page.locator('#page-dash [onclick="loadDashboard()"]').click();
      await page.locator('#theme-toggle').click();
      await page.evaluate(() => connectionCallback({val:()=>true}));
      assert.equal(await page.locator('#app-wrapper').isVisible(), true);
      assert.equal(await page.evaluate(() => window.CURRENT_EMAIL), null);
      assert.deepEqual(await page.evaluate(() => databasePaths), ['.info/connected']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      fs.mkdirSync('test-results', { recursive: true });
      await page.screenshot({path:`test-results/workspace-preview-${width}.png`});
      console.log(`Preview passed: ${width}px, offline entry, all sections, refresh, theme, reconnection, no inventory access`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
