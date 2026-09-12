const { test } = require('node:test');
const assert = require('node:assert/strict');
const live = require('../js/live-data.js');
const schema = require('../docs/firebase-schema-v1.json');
const defs = live.definitions(schema);
test('catalog maps shared orders once and excludes raw archives', () => {
  assert.equal(defs.filter(d => d.template === 'orders/{record_id}').length, 1);
  assert.ok(defs.find(d => d.template === 'orders/{record_id}').names.includes('flipkart_orders'));
  assert.ok(defs.every(d => !d.prefix.startsWith('raw_')));
  assert.equal(live.roots(defs).includes('amazon/state/txnRequest'), false);
  assert.equal(defs.length, 37);
});
test('extracts nested provider summaries and singleton state without inventing fields', () => {
  const def = defs.find(d => d.id === 'meta_rollup');
  const rows = live.records(def, 'meta/rollup', { account: { '2026-09': { month: '2026-09', spend_paise: 12345, password: 'excluded' } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].params.account_id, 'account');
  assert.equal(rows[0].values.spend_paise, 12345);
  assert.equal(rows[0].values.password, undefined);
  const singleton = defs.find(d => d.id === 'amazon_state');
  assert.equal(live.records(singleton, 'amazon/state', { last_successful_at: 'now', txnRequest: {} }).length, 1);
  const detail = defs.find(d => d.id === 'meta_detail');
  const composite = live.records(detail, 'meta/spend', { account: { '2026-09': { '123_2026-09-12': { ad_id: '123', date_ist: '2026-09-12' } } } });
  assert.equal(composite[0].params.ad_id, '123');
  assert.equal(composite[0].params.date, '2026-09-12');
});
test('missing, non-finite and malformed money never becomes zero', () => {
  assert.equal(live.total([], 'spend_paise'), null);
  for (const value of [undefined, null, '100', Infinity, 1.5]) assert.equal(live.total([{values:{spend_paise:value}}], 'spend_paise'), null);
  assert.equal(live.total([{values:{spend_paise:0}}], 'spend_paise'), 0);
  assert.equal(live.total([{values:{spend_paise:-100}},{values:{spend_paise:200}}], 'spend_paise'), 100);
});
test('empty and malformed schema is handled, and unsafe paths are ignored', () => {
  assert.throws(() => live.definitions(null), /schema/);
  assert.equal(live.definitions({collections:{bad:{path_template:'/',headers:[]}}}).length, 0);
  assert.deepEqual(live.records(defs[0], defs[0].prefix, null), []);
});
test('listeners stream edits and deletions, reconcile schema changes, retry and detach', () => {
  const callbacks = new Map(), errors = new Map(), values = new Map();
  const db = { ref(path) { return {
    on(event, callback, error) { assert.equal(event,'value'); if (!callbacks.has(path)) callbacks.set(path,new Set()); callbacks.get(path).add(callback); errors.set(path,error); if(values.has(path)) callback({val:()=>values.get(path)}); },
    off(event, callback) { callbacks.get(path)?.delete(callback); }
  }; } };
  const emit = (path, value) => { values.set(path,value); for(const callback of callbacks.get(path)||[]) callback({val:()=>value}); };
  let state;
  const store = live.create(db, next => {state=next;}); store.start(); store.start();
  assert.equal(callbacks.get('mira/schema/v1').size,1);
  emit('mira/schema/v1', {collections:{ims_finished_goods:schema.collections.ims_finished_goods}});
  emit('ims/finished_goods',{a:{current_stock_units:10}});
  assert.equal(state.collections[0].rows[0].values.current_stock_units,10);
  emit('ims/finished_goods',{a:{current_stock_units:7}});
  assert.equal(state.collections[0].rows[0].values.current_stock_units,7);
  errors.get('ims/finished_goods')({code:'PERMISSION_DENIED'});
  assert.equal(state.collections[0].status,'error');
  assert.equal(state.collections[0].rows.length,1);
  emit('ims/finished_goods',null);
  assert.equal(state.collections[0].rows.length,0);
  emit('mira/schema/v1',{collections:{ims_packaging:schema.collections.ims_packaging}});
  assert.equal(callbacks.get('ims/finished_goods').size,0);
  assert.equal(callbacks.get('ims/packaging').size,1);
  store.retry(); assert.equal(callbacks.get('ims/packaging').size,1);
  store.stop(); assert.ok([...callbacks.values()].every(set=>set.size===0));
});
