/* Read-only adapter for the user's field catalog. No writes, seeding or legacy tables. */
(function (root) {
  'use strict';
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const allowedField = name => !/(password|passcode|secret|token|private_key)/i.test(name) && name !== '_raw';
  function definitions(schema) {
    if (!object(schema) || !object(schema.collections)) throw new Error('The Firebase schema catalog is missing or invalid.');
    const byTemplate = new Map();
    for (const [name, collection] of Object.entries(schema.collections)) {
      if (!object(collection)) continue;
      const template = collection.path_template;
      // Raw archives are not dashboard data. Subscribe to curated records instead.
      if (typeof template !== 'string' || !/^[a-zA-Z0-9_{}/-]+$/.test(template) || /(^|\/)raw_/.test(template)) continue;
      const parts = template.split('/');
      if (parts.some(p => !p || /[{}]/.test(p.replace(/\{\w+\}/g, '')))) continue;
      const wildcard = parts.findIndex(p => p.includes('{'));
      const prefix = parts.slice(0, wildcard < 0 ? parts.length : wildcard).join('/');
      if (!prefix || prefix.startsWith('mira/schema')) continue;
      const headers = (Array.isArray(collection.headers) ? collection.headers : Object.keys(collection.fields || {})).filter(h => typeof h === 'string' && allowedField(h));
      if (!byTemplate.has(template)) byTemplate.set(template, { id: name, names: [], template, prefix, parts, headers: [], fields: {} });
      const def = byTemplate.get(template);
      def.names.push(name);
      def.headers = [...new Set([...def.headers, ...headers])];
      for (const h of headers) def.fields[h] = collection.fields?.[h] || {};
    }
    return [...byTemplate.values()];
  }
  function roots(defs) {
    const prefixes = [...new Set(defs.map(d => d.prefix))].sort((a, b) => a.length - b.length);
    return prefixes.filter((p, i) => !prefixes.slice(0, i).some(parent => p.startsWith(parent + '/')));
  }
  function records(def, prefix, value) {
    const rows = [];
    const remaining = def.parts.slice(prefix.split('/').length);
    function visit(node, index, keys, location) {
      if (!node || typeof node !== 'object') return;
      if (index === remaining.length) {
        if (!object(node) || !def.headers.some(h => Object.prototype.hasOwnProperty.call(node, h))) return;
        const row = { key: location.join('/'), values: {}, params: keys };
        for (const h of def.headers) if (Object.prototype.hasOwnProperty.call(node, h)) row.values[h] = node[h];
        rows.push(row); return;
      }
      const part = remaining[index];
      if (part.includes('{')) {
        const names = [...part.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
        const pattern = new RegExp('^' + part.replace(/\{\w+\}/g, '(.+?)') + '$');
        for (const [key, child] of Object.entries(node)) {
          const match = key.match(pattern); if (!match) continue;
          const params = { ...keys }; names.forEach((name, i) => { params[name] = match[i + 1]; });
          visit(child, index + 1, params, [...location, key]);
        }
      } else visit(node[part], index + 1, keys, [...location, part]);
    }
    visit(value, 0, {}, prefix.split('/'));
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }
  function total(rows, field) {
    if (!rows.length) return null;
    let sum = 0;
    for (const row of rows) {
      const n = row.values[field];
      if (typeof n !== 'number' || !Number.isFinite(n)) return null;
      if ((field.endsWith('_paise') || field.endsWith('_units') || field === 'quantity') && !Number.isSafeInteger(n)) return null;
      sum += n;
      if (!Number.isFinite(sum) || (Number.isInteger(n) && !Number.isSafeInteger(sum))) return null;
    }
    return sum;
  }
  function create(db, onChange) {
    let defs = [], schema = null, schemaError = '', started = false, connected = false, updatedAt = null;
    const listeners = new Map();
    const notify = () => onChange(snapshot());
    function snapshot() {
      return { schema, schemaError, connected, updatedAt, collections: defs.map(def => {
        const prefix = [...listeners.keys()].find(p => def.prefix === p || def.prefix.startsWith(p + '/'));
        const source = listeners.get(prefix);
        return { ...def, status: source?.error ? 'error' : source?.loaded ? 'ready' : 'loading', error: source?.error || '', rows: source?.loaded ? records(def, prefix, source.value) : [] };
      }) };
    }
    function onSchema(snap) {
      try {
        const next = snap.val(); const nextDefs = definitions(next);
        schema = next; defs = nextDefs; schemaError = '';
        const wanted = new Set(roots(defs));
        for (const [prefix, listener] of listeners) if (!wanted.has(prefix)) { listener.ref.off('value', listener.callback); listeners.delete(prefix); }
        for (const prefix of wanted) {
          if (listeners.has(prefix)) continue;
          const listener = { ref: db.ref(prefix), value: null, loaded: false, error: '' };
          listeners.set(prefix, listener);
          listener.callback = data => {
            if (listeners.get(prefix) !== listener) return;
            listener.value = data.val(); listener.loaded = true; listener.error = ''; updatedAt = new Date(); notify();
          };
          listener.ref.on('value', listener.callback, error => {
            if (listeners.get(prefix) !== listener) return;
            listener.error = error?.code || 'Read failed'; notify();
          });
        }
      } catch (error) {
        schemaError = error.message; schema = null; defs = [];
        for (const listener of listeners.values()) listener.ref.off('value', listener.callback);
        listeners.clear();
      }
      notify();
    }
    const schemaRef = db.ref('mira/schema/v1');
    const connectionRef = db.ref('.info/connected');
    const onConnection = snap => { connected = snap.val() === true; notify(); };
    function start() {
      if (started) return; started = true;
      schemaRef.on('value', onSchema, error => { schemaError = error?.code || 'Cannot read schema'; notify(); });
      connectionRef.on('value', onConnection);
    }
    function stop() {
      schemaRef.off('value', onSchema); connectionRef.off('value', onConnection);
      for (const listener of listeners.values()) listener.ref.off('value', listener.callback);
      listeners.clear(); started = false;
    }
    return { start, stop, snapshot, retry() { stop(); schemaError = ''; start(); } };
  }
  root.MiraLiveData = { definitions, roots, records, total, create };
  if (typeof module !== 'undefined') module.exports = root.MiraLiveData;
})(typeof window !== 'undefined' ? window : globalThis);
