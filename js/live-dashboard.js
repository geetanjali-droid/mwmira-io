(function () {
  'use strict';
  let store, state, scheduled, active = 'dash', month = '', search = '', pageNumber = 0;
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const label = value => String(value).replace(/^ims_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
  const display = value => value === null ? '—' : number.format(value);
  const collectionTitle = def => def.template === 'orders/{record_id}' ? 'Channel orders' : def.template === 'returns/{record_id}' ? 'Channel returns' : label(def.id);
  function group(def) {
    if (def.names.includes('ims_raw_materials')) return 'raw';
    if (def.names.includes('ims_packaging')) return 'pack';
    if (def.names.some(n => ['ims_finished_goods', 'ims_batches'].includes(n))) return 'fg';
    if (def.names.includes('ims_user_profiles')) return 'users';
    if (def.template.startsWith('orders/') || def.template.startsWith('returns/') || def.names.some(n => ['ims_supervisor_entries', 'ims_agent_imports', 'ims_sku_map'].includes(n))) return 'sup';
    return 'admin';
  }
  function find(name) { return state?.collections.find(c => c.names.includes(name)); }
  function rows(name) { const c = find(name); return c?.status === 'ready' ? c.rows : []; }
  function metric(name, field, predicate) {
    const c = find(name); if (!c || c.status !== 'ready') return null;
    return MiraLiveData.total(predicate ? c.rows.filter(predicate) : c.rows, field);
  }
  function kpi(title, value, note) {
    return '<div class="kpi-card"><div class="kpi-label">' + html(title) + '</div><div class="kpi-value">' + display(value) + '</div><div class="muted">' + html(note) + '</div></div>';
  }
  function schedule(next) { state = next; clearTimeout(scheduled); scheduled = setTimeout(render, 30); }
  function statusMarkup() {
    if (!state) return 'Connecting to your database…';
    const errors = state.collections.filter(c => c.status === 'error').length;
    const loading = state.collections.filter(c => c.status === 'loading').length;
    const timestamp = state.updatedAt ? state.updatedAt.toLocaleTimeString('en-IN') : '';
    return (state.connected ? 'Live connection' : 'Offline · showing last received data') +
      (state.schemaError ? ' · Schema unavailable: ' + state.schemaError : '') +
      (loading ? ' · Loading ' + loading + ' sources' : '') + (errors ? ' · ' + errors + ' sources could not be read' : '') +
      (timestamp ? ' · Last received ' + timestamp : '');
  }
  function cell(value, field) {
    if (value === undefined || value === null || value === '') return '—';
    if (field === 'amounts_paise' && Array.isArray(value)) return value.map(item => html(item?.column || 'Amount') + ': ' + (typeof item?.value === 'number' && Number.isSafeInteger(item.value) ? html(money.format(item.value / 100)) : '—')).join('<br>');
    if (field.endsWith('_paise')) return typeof value === 'number' && Number.isSafeInteger(value) ? html(money.format(value / 100)) : '<span class="live-warning">Invalid amount</span>';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return html(JSON.stringify(value));
    return html(value);
  }
  function table(collection, offset = 0) {
    if (collection.status === 'loading') return '<p class="live-empty">Loading ' + html(collectionTitle(collection)) + '…</p>';
    const warning = collection.status === 'error' ? '<p class="live-warning">Unable to read this source. Any rows below are stale. Use Refresh to retry.</p>' : '';
    const filtered = collection.rows.filter(row => !search || JSON.stringify(row.values).toLowerCase().includes(search));
    if (!filtered.length) return warning + '<p class="live-empty">' + (search ? 'No matching records.' : 'No records in this collection yet. New records will appear automatically.') + '</p>';
    const headers = collection.headers;
    const visible = filtered.slice(offset, offset + 50);
    return warning + '<p class="muted">' + filtered.length + ' records · showing ' + (visible.length ? offset + 1 : 0) + '–' + Math.min(offset + 50, filtered.length) + '</p>' +
      '<div class="table-wrap live-table" tabindex="0" role="region" aria-label="' + html(collectionTitle(collection)) + ' records"><table><thead><tr><th>Record</th>' + headers.map(h => '<th>' + html(label(h).replace(/ Paise$/, ' (₹)')) + '</th>').join('') + '</tr></thead><tbody>' +
      visible.map(row => '<tr><td>' + html(row.key.split('/').pop()) + '</td>' + headers.map(h => '<td>' + cell(row.values[h], h) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function summary() {
    const collections = state?.collections || [];
    const count = collections.reduce((n, c) => n + c.rows.length, 0);
    const loaded = collections.length && collections.every(c => c.status === 'ready');
    let out = '<div class="live-intro"><div><span class="live-eyebrow">MIRA / INVENTORY & CHANNELS</span><h2>Your business, live</h2><p class="muted">Stock and channel records from your Firebase collections.</p></div><span class="live-chip">Read only</span></div>';
    if (!count) out += '<div class="workspace-empty"><h2>' + (loaded ? 'Schema connected · no business records yet' : 'Waiting for source data') + '</h2><p>' + (loaded ? 'Your collection paths are linked. Records added to Firebase will appear here automatically.' : 'You can explore the workspace while sources load. Unavailable totals are shown as —.') + '</p></div>';
    out += '<div class="kpi-row live-kpis">' +
      kpi('Finished goods', metric('ims_finished_goods', 'current_stock_units'), 'Units currently on hand') +
      kpi('Raw material', metric('ims_raw_materials', 'current_stock_ml'), 'Current stock · ml') +
      kpi('Packaging', metric('ims_packaging', 'current_stock_pcs'), 'Current stock · pieces') +
      kpi('Recorded dispatch', metric('ims_supervisor_entries', 'quantity_units', r => r.values.entry_type === 'Out' || r.values.entry_type === 'OUT'), 'Units · all recorded dates') + '</div>';
    out += '<div class="kpi-row">' +
      kpi('Incoming orders', metric('amazon_orders', 'quantity'), 'Units · separate from recorded dispatch') +
      kpi('Incoming returns', metric('amazon_returns', 'quantity'), 'Units · not added back to stock') +
      kpi('Total packed', metric('ims_finished_goods', 'total_packed_units'), 'Units reported by inventory') +
      kpi('Batch balance', metric('ims_batches', 'balance_units'), 'Units reported by batches') + '</div>';
    const rollups = collections.filter(c => c.names.some(n => n.endsWith('_rollup')));
    const months = [...new Set(rollups.flatMap(c => c.rows.map(r => r.values.month || r.params.month)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
    if (!months.includes(month)) month = months[0] || '';
    out += '<div class="live-section-head"><h2>Channel financial summaries</h2><label>Month <select id="live-month"><option value="">' + (months.length ? 'Select month' : 'No periods yet') + '</option>' + months.map(m => '<option' + (m === month ? ' selected' : '') + '>' + html(m) + '</option>').join('') + '</select></label></div><div class="live-provider-grid">';
    for (const provider of ['amazon', 'flipkart', 'cashfree', 'meta']) {
      const source = rollups.find(c => c.names.includes(provider + '_rollup'));
      const selected = (source?.status === 'ready' ? source.rows : []).filter(r => (r.values.month || r.params.month) === month);
      const verified = selected.length > 0 && selected.every(r => r.values.reference_verified === true && r.values.coverage_complete === true);
      const field = provider === 'meta' ? 'spend_paise' : 'gross_sale_paise';
      const amount = verified ? MiraLiveData.total(selected, field) : null;
      out += '<div class="kpi-card"><h3>' + label(provider) + '</h3><div class="kpi-value">' + (amount === null ? '—' : html(money.format(amount / 100))) + '</div><p>' + (provider === 'meta' ? 'Advertising spend' : 'Gross sale') + '</p><p class="muted">' + (verified ? 'Verified · coverage complete' : selected.length ? 'Awaiting verified, complete coverage' : 'No summary for this period') + '</p></div>';
    }
    out += '</div><p class="muted">Missing amounts are not counted as zero. Provider totals are shown separately to avoid double counting.</p>';
    const activity = find('ims_activity');
    if (activity) out += '<h2>Inventory activity</h2>' + table({ ...activity, rows: [...activity.rows].sort((a, b) => String(b.values.timestamp || '').localeCompare(String(a.values.timestamp || ''))) });
    out += '<h2>Connected sources</h2><div class="live-source-grid">' + collections.map(c => '<button class="live-source" data-live-page="' + group(c) + '" data-live-collection="' + html(c.id) + '"><b>' + html(label(c.id).replace(/^(Amazon|Flipkart) (Orders|Returns)$/, '$2')) + '</b><span>' + (c.status === 'ready' ? c.rows.length + ' records' : c.status) + '</span></button>').join('') + '</div>';
    return out;
  }
  function render() {
    if (!store) return;
    const status = document.getElementById('live-status'); if (status) status.textContent = statusMarkup();
    document.querySelector('.p-status').textContent = state?.connected ? 'Live · read only' : 'Offline';
    const body = document.querySelector('#page-' + active + ' .live-results'); if (!body) return;
    if (active === 'dash') {
      body.innerHTML = summary();
      document.getElementById('live-month')?.addEventListener('change', event => { month = event.target.value; render(); });
      body.querySelectorAll('[data-live-page]').forEach(button => button.addEventListener('click', () => {
        switchPage(button.dataset.livePage);
        const select = document.querySelector('#page-' + active + ' .live-collection');
        if (select) { select.value = button.dataset.liveCollection; pageNumber = 0; render(); }
      }));
      return;
    }
    const list = (state?.collections || []).filter(c => group(c) === active);
    const select = document.querySelector('#page-' + active + ' .live-collection');
    const previous = select.value;
    select.innerHTML = list.map(c => '<option value="' + html(c.id) + '">' + html(collectionTitle(c)) + '</option>').join('');
    if (list.some(c => c.id === previous)) select.value = previous;
    const chosen = list.find(c => c.id === select.value);
    if (!chosen) { body.innerHTML = '<div class="workspace-empty"><h2>No collection available</h2><p>' + html(state?.schemaError || 'Waiting for the schema catalog.') + '</p></div>'; return; }
    const count = chosen.rows.filter(r => !search || JSON.stringify(r.values).toLowerCase().includes(search)).length;
    pageNumber = Math.min(pageNumber, Math.max(0, Math.ceil(count / 50) - 1));
    const position = body.querySelector('.live-table');
    const scroll = position ? { x: position.scrollLeft, y: position.scrollTop } : null;
    body.innerHTML = '<h2>' + html(collectionTitle(chosen)) + '</h2>' + table(chosen, pageNumber * 50) + '<div class="live-pagination"><button id="live-prev" class="btn-outline"' + (!pageNumber ? ' disabled' : '') + '>Previous</button><span>Page ' + (pageNumber + 1) + '</span><button id="live-next" class="btn-outline"' + ((pageNumber + 1) * 50 >= count ? ' disabled' : '') + '>Next</button></div>';
    const newTable = body.querySelector('.live-table'); if (scroll && newTable) { newTable.scrollLeft = scroll.x; newTable.scrollTop = scroll.y; }
    document.getElementById('live-prev').onclick = () => { pageNumber--; render(); };
    document.getElementById('live-next').onclick = () => { pageNumber++; render(); };
  }
  function open() {
    if (store) { render(); return; }
    document.querySelector('.p-name').textContent = 'Mira workspace';
    document.querySelector('.user-info').textContent = 'Live data · Read only';
    document.querySelectorAll('.page').forEach(page => {
      const content = page.querySelector('.content-pad'); if (!content) return;
      content.innerHTML = (page.id === 'page-dash' ? '<p id="live-status" class="live-status" role="status">Connecting…</p>' : '<div class="live-toolbar"><label>Collection <select class="live-collection"></select></label><label>Search <input class="live-search" type="search" placeholder="Search records"></label></div>') + '<div class="live-results"></div>';
      page.querySelector('.live-collection')?.addEventListener('change', () => { pageNumber = 0; render(); });
      page.querySelector('.live-search')?.addEventListener('input', event => { search = event.target.value.toLowerCase(); pageNumber = 0; render(); });
      page.querySelectorAll('.topbar button').forEach(button => { button.disabled = button.getAttribute('onclick') !== 'loadDashboard()'; });
    });
    store = MiraLiveData.create(DB, schedule); store.start();
    const period = document.getElementById('dash-period'); if (period) period.textContent = 'Live inventory and channel overview';
  }
  window.MiraDashboard = { open, show(page) { active = page; search = document.querySelector('#page-' + page + ' .live-search')?.value.toLowerCase() || ''; pageNumber = 0; render(); }, refresh() { store?.retry(); }, snapshot() { return store?.snapshot(); } };
  window.addEventListener('pagehide', () => store?.stop());
  window.addEventListener('pageshow', () => store?.start());
})();
