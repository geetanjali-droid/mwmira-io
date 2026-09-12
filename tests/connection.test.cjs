const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');

test('Firebase boot does not read inventory before login and blocks legacy schema writes', async () => {
  const refs = [];
  let config;
  const context = vm.createContext({
    console,
    document: { addEventListener() {} },
    firebase: {
      initializeApp(value) { config = value; },
      auth() { return {}; },
      database() { return { ref(value) { refs.push(value); return { on() {} }; } }; }
    }
  });
  context.window = context;
  vm.runInContext(source('firebase-init.js'), context);
  vm.runInContext(source('gas-shim.js'), context);
  assert.equal(config.databaseURL, 'https://mw-mira-io-default-rtdb.asia-southeast1.firebasedatabase.app');
  assert.equal(config.projectId, 'mw-mira-io');
  await assert.rejects(context.loadMEM(), /connection-only/);
  await assert.rejects(context.flushMEM(), /connection-only/);
  assert.deepEqual(refs, []);
});

test('missing connection configuration fails closed', async () => {
  const context = vm.createContext({ console }); context.window = context;
  vm.runInContext(source('gas-shim.js'), context);
  await assert.rejects(context.loadMEM(), /connection-only/);
  await assert.rejects(context.flushMEM(), /connection-only/);
});
