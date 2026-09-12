const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  let stored = null, writes = 0, failRead = false, failWrite = false;
  const copy = value => JSON.parse(JSON.stringify(value));
  const context = vm.createContext({ console: { log() {}, error() {} }, structuredClone, setTimeout });
  context.window = context;
  // Legacy adapter tests use only the isolated fake database, never the connected project.
  context.FIREBASE_CONNECTION_ONLY = false;
  context.DB = { ref() { return {
    async once() { if (failRead) { failRead = false; throw Error('offline'); } return { val: () => copy(stored) }; },
    async transaction(update) { if (failWrite) { failWrite = false; throw Error('write denied'); } const next = update(copy(stored)); if (next === undefined) return { committed: false }; stored = copy(next); writes++; return { committed: true }; }
  }; } };
  for (const file of ['gas-shim', 'backend', 'gsrun-shim']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  const call = (name, ...args) => new Promise((resolve, reject) => context.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[name](...args));
  return { context, run, call, writes: () => writes, stored: () => stored, failRead: () => { failRead = true; }, failWrite: () => { failWrite = true; }, change: () => { stored.external = { headers: ['ID'], rows: [{ ID: 'other' }] }; } };
}
const owner = 'geetanjali.chaurasiya@mushroomworldgroup.com';
async function login(s) { return s.call('checkLoginPasscode', owner, 'test-only'); }

test('bootstrap, login, and dashboard reads do not rewrite unchanged inventory', async () => {
  const s = setup(); const result = await login(s);
  assert.equal(result.dashboard.rawMaterial.length, 12);
  assert.equal(result.dashboard.isAdmin, true);
  const writes = s.writes(); await s.call('getDashboardData'); assert.equal(s.writes(), writes);
});
test('failed login clears identity and blocks subsequent calls', async () => {
  const s = setup(); await login(s);
  await assert.rejects(s.call('checkLoginPasscode', owner, 'wrong'), /Incorrect/);
  assert.equal(s.context.CURRENT_EMAIL, null);
  await assert.rejects(s.call('addRawMaterialReceived', 'He Charge', 30), /sign in/);
});
test('failed initial reads can be retried', async () => {
  const s = setup(); s.failRead(); await assert.rejects(login(s), /offline/); await login(s);
});
test('rejects infinite raw quantities and fractional discrete quantities', async () => {
  const s = setup(); await login(s);
  for (const value of [Infinity, NaN, -1, 0]) await assert.rejects(s.call('addRawMaterialReceived', 'He Charge', value), /quantity/);
  await assert.rejects(s.call('addPackagingReceived', 'PK-01', 1.5), /whole number/);
  await assert.rejects(s.call('recordPacking', 'He Charge', 1.5), /whole number/);
});
test('overlapping receipts are serialized without losing updates', async () => {
  const s = setup(); await login(s);
  await Promise.all([s.call('addRawMaterialReceived', 'He Charge', 30), s.call('addRawMaterialReceived', 'He Charge', 60)]);
  const dashboard = await s.call('getDashboardData'); assert.equal(dashboard.rawMaterial[0]['Current Stock (ml)'], 90);
});
test('failed saves do not leak into the next request', async () => {
  const s = setup(); await login(s); s.failWrite();
  await assert.rejects(s.call('addRawMaterialReceived', 'He Charge', 30), /denied/);
  const dashboard = await s.call('getDashboardData'); assert.equal(dashboard.rawMaterial[0]['Current Stock (ml)'], 0);
});
test('concurrent remote changes abort the entire local commit', async () => {
  const s = setup(); await login(s); await s.context.loadMEM();
  s.run("MEM.sheets.Raw_Material_Inventory.rows[1][2] = 100"); s.change();
  await assert.rejects(s.context.flushMEM(), /another session/);
  assert.equal(s.stored().Raw_Material_Inventory.rows[0]['Opening Stock (ml)'], 0);
  assert.ok(s.stored().external);
});
test('entry IDs retain all digits beyond 9999', async () => {
  const s = setup(); s.run("_PROPS.SUP_COUNTER = '9999'");
  assert.equal(s.run('nextEntryId_({rows: []})'), 'SE-10000');
});

test('stock correction validation rejects negative and non-finite input', async () => {
  const s = setup(); await login(s);
  await assert.rejects(s.call('updateRawMaterialRow', 'He Charge', -1, 0), /non-negative/);
  await assert.rejects(s.call('updatePackagingRow', 'PK-01', 2.5, 0), /whole/);
  await assert.rejects(s.call('updateFinishedGoodsRow', 'He Charge', Infinity, 0), /non-negative/);
});
test('UI function names cannot shadow captured backend handlers', async () => {
  const s = setup(); await login(s);
  s.context.getDashboardData = () => { throw Error('UI shadow'); };
  assert.equal((await s.call('getDashboardData')).rawMaterial.length, 12);
});
test('packing, FEFO dispatch, reversal and shortages preserve stock balance', async () => {
  const s = setup(); const result = await login(s);
  await s.call('addRawMaterialReceived', 'He Charge', 300);
  for (const row of result.dashboard.packaging.filter(r => ['All', 'He Charge'].includes(r['Applicable Product']))) await s.call('addPackagingReceived', row['Item ID'], 10);
  await s.call('recordPacking', 'He Charge', 10);
  await assert.rejects(s.call('recordPacking', 'He Charge', 1), /stock|Stock|pack/i);
  await s.call('recordSupervisorEntry', 'Out', 'He Charge', 3, '', 'Shopify (.com)', 'TEST-1', [], '', '');
  let dashboard = await s.call('getDashboardData');
  assert.equal(dashboard.finishedGoods[0]['Current Stock (Units)'], 7);
  assert.equal(dashboard.rawMaterial[0]['Current Stock (ml)'], 0);
  assert.equal(dashboard.batches[0].balance, 7);
  await assert.rejects(s.call('recordSupervisorEntry', 'Out', 'He Charge', 8, '', 'Shopify (.com)', 'TEST-2', [], '', ''), /stock/i);
  await s.call('deleteSupervisorEntry', dashboard.supervisorEntries[0]['Entry ID']);
  dashboard = await s.call('getDashboardData');
  assert.equal(dashboard.finishedGoods[0]['Current Stock (Units)'], 10);
  assert.equal(dashboard.batches[0].balance, 10);
});
