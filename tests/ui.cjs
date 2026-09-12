const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mock = `let stored = null; const DB = { ref() { return {
  async once() { return { val: () => structuredClone(stored) }; },
  async transaction(fn) { const next = fn(structuredClone(stored)); if (next === undefined) return { committed: false }; stored = structuredClone(next); return { committed: true }; }
}; } };`;
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === 'inventory.test') {
          const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
          if (file === 'js/firebase-init.js') return route.fulfill({ contentType: 'text/javascript', body: mock });
          return route.fulfill({ path: path.join(__dirname, '..', file) });
        }
        if (url.hostname === 'www.gstatic.com') return route.fulfill({ contentType: 'text/javascript', body: '' });
        if (url.hostname.includes('firebasedatabase') || url.hostname.includes('firebaseio')) throw Error('Live database access prohibited');
        return route.continue();
      });
      await page.goto('http://inventory.test/');
      await page.locator('#login-email').fill('geetanjali.chaurasiya@mushroomworldgroup.com');
      await page.locator('#login-passcode').fill('ui-test-only');
      await page.locator('.btn-login-gold').click();
      await page.locator('#app-wrapper').waitFor({ state: 'visible' });
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#login-passcode').inputValue(), '');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page overflows at ' + width);
      fs.mkdirSync('test-results', { recursive: true });
      await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true });
      if (width < 760) await page.locator('.gh-hamburger').click();
      await page.locator('[data-page="raw"]').click();
      await page.evaluate(() => openModal('modal-raw-received'));
      assert.equal(await page.locator('#modal-raw-received').getAttribute('role'), 'dialog');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#modal-raw-received').isVisible(), false);
      await page.evaluate(() => toggleTheme());
      await page.screenshot({ path: `test-results/raw-dark-${width}.png`, fullPage: true });
      assert.deepEqual(errors, [], 'browser errors at ' + width);
      console.log(`UI passed: ${width}px, login, dashboard, navigation, dialog, dark theme, no page overflow`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
