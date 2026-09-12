
  let DASHBOARD_DATA = null;
  // Shown in the sidebar so you can confirm which version of the files is actually live.
  const APP_BUILD = 'B24';

  let FULL_DATA = { raw: [], pack: [], fg: [], sup: [], batches: [], adminCosting: [], priceHistory: [], users: [] };

  document.addEventListener('DOMContentLoaded', function () {
    const uinfo = document.querySelector('.user-info');
    if (uinfo && uinfo.innerHTML.indexOf('app-build') === -1) uinfo.innerHTML += '<div class="app-build" id="app-build">Build ' + APP_BUILD + '</div>';
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); item.click(); } });
      item.addEventListener('click', function () { switchPage(item.dataset.page); });
    });
    if (window.matchMedia('(max-width: 760px)').matches) toggleSidebar();
    // Dashboard data is NOT loaded until login is verified (see submitLogin()).
  });

  function submitLogin() {
    const email = document.getElementById('login-email').value.trim();
    const passcode = document.getElementById('login-passcode').value;
    const errorEl = document.getElementById('login-error');
    errorEl.innerText = '';
    if (!email || !passcode) {
      errorEl.innerText = 'Enter both email and password.';
      return;
    }
    const btn = document.querySelector('.btn-login-gold');
    if (btn.disabled) return;
    if (!document.getElementById('login-email').checkValidity()) { errorEl.innerText = 'Enter a valid email address.'; return; }
    btn.disabled = true; btn.innerText = 'Signing in…';
    google.script.run
      .withSuccessHandler(function (res) {
        document.getElementById('login-passcode').value = '';
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-wrapper').style.display = 'block';
        if (res && res.dashboard) applyDashboard(res.dashboard); else loadDashboard();
      })
      .withFailureHandler(function (err) {
        btn.disabled = false; btn.innerText = 'Sign In';
        errorEl.innerText = err.message;
      })
      .checkLoginPasscode(email, passcode);
  }

  /* ============ THEME (light / dark) ============ */
  function applyTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerText = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    try { localStorage.setItem('mg-theme', theme); } catch (e) { /* storage blocked - ignore */ }
    if (typeof ANALYTICS !== 'undefined' && ANALYTICS && document.getElementById('ch-trend')) renderCharts(ANALYTICS);
  }
  function toggleTheme() {
    applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
  }
  (function () {
    let saved = 'light';
    try { saved = localStorage.getItem('mg-theme') || 'light'; } catch (e) { /* ignore */ }
    document.addEventListener('DOMContentLoaded', function () { applyTheme(saved); });
  })();

  function toggleSidebar() {
    const collapsed = document.getElementById('sidebar').classList.toggle('collapsed');
    document.querySelector('.gh-hamburger').setAttribute('aria-expanded', String(!collapsed));
  }

  function switchPage(page) {
    const target = document.getElementById('page-' + page);
    if (!target || (page === 'admin' && !DASHBOARD_DATA?.isAdmin) || (page === 'users' && !DASHBOARD_DATA?.isSuper)) return;
    document.querySelectorAll('.page').forEach(function (p) { p.style.display = 'none'; });
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
    const pg = document.getElementById('page-' + page);
    if (!pg) return;
    pg.style.display = 'block';
    const nav = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (nav) nav.classList.add('active');
    if (window.matchMedia('(max-width: 760px)').matches && !document.getElementById('sidebar').classList.contains('collapsed')) toggleSidebar();
    if (page === 'admin') { loadAdminPanel(); loadAgentStatus(); }
    if (page === 'dash') loadAnalytics();
    if (page === 'users') loadUserAccess();
  }

  /* ============ HELPERS ============ */

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function jsArg(s) { // safe to place inside onclick="fn('...')"
    return esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  }
  function fmtDate(v) {
    if (!v) return '-';
    const d = new Date(v);
    return isNaN(d.getTime()) ? esc(v) : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function num(v) { return v === '' || v === null || v === undefined ? 0 : Number(v); }

  /* ============ MODAL SYSTEM ============ */

  const modalFocus = new Map();
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
      modalFocus.set(id, document.activeElement);
      el.classList.add('open');
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      const heading = el.querySelector('h2, h3');
      if (heading) { if (!heading.id) heading.id = id + '-heading'; el.setAttribute('aria-labelledby', heading.id); }
      document.body.classList.add('modal-active');
      const focus = el.querySelector('input, select, textarea, button');
      if (focus) focus.focus();
    }
    if (id === 'modal-fg-packing' && typeof updatePackCapacity === 'function') { initPackingModal(); updatePackCapacity(); }
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-active');
    const previous = modalFocus.get(id); if (previous && previous.isConnected) previous.focus();
    modalFocus.delete(id);
  }

  document.addEventListener('keydown', function (event) {
    const modals = document.querySelectorAll('.modal-overlay.open');
    const modal = modals[modals.length - 1]; if (!modal) return;
    if (event.key === 'Escape') { closeModal(modal.id); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(modal.querySelectorAll('button, input, select, textarea, [tabindex="0"]')).filter(function (el) { return !el.disabled && el.getClientRects().length; });
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });

  /* ============ LOAD ============ */

  function loadDashboard() {
    google.script.run.withSuccessHandler(applyDashboard).withFailureHandler(showError).getDashboardData();
  }

  // Renders everything from ONE payload (dashboard + admin panel). Called after login and after every save.
  function applyDashboard(data) {
    const drafts = Array.from(document.querySelectorAll('.modal-overlay.open input, .modal-overlay.open select, .modal-overlay.open textarea')).map(function(el){return {el:el,value:el.value,checked:el.checked};});
    try {
      DASHBOARD_DATA = data;
      const schemaNotice=document.getElementById('schema-notice');schemaNotice.hidden=!data.schemaWarning;schemaNotice.textContent=data.schemaWarning||'';
      document.querySelector('.p-name').textContent = data.userEmail;
      document.querySelector('.user-info').textContent = data.role + ' · Build ' + APP_BUILD;
      document.querySelectorAll('.p-avatar, .gh-avatar').forEach(function (el) { el.textContent = (data.userEmail || 'U')[0].toUpperCase(); });
      document.querySelector('[data-page="admin"]').hidden = !data.isAdmin;
      document.querySelector('[data-page="users"]').hidden = !data.isSuper;
      document.querySelectorAll('[onclick*="openModal(\'modal-raw-received"], [onclick*="openModal(\'modal-pack-received"], [onclick*="openModal(\'modal-fg-packing"], [onclick*="openModal(\'modal-sup-entry"]').forEach(function(el){el.hidden=!data.canEdit;});
      const current = document.querySelector('.nav-item.active')?.dataset.page;
      if((current==='admin'&&!data.isAdmin)||(current==='users'&&!data.isSuper))switchPage('dash');
      FULL_DATA.raw = data.rawMaterial;
      FULL_DATA.pack = data.packaging;
      FULL_DATA.fg = data.finishedGoods;
      FULL_DATA.sup = data.supervisorEntries;
      FULL_DATA.pendingReturns = data.pendingReturns || [];
      populateDropdowns(data);
      updatePendingBadge();
      filterRawTable();
      filterPackTable();
      filterFGTable();
      FULL_DATA.batches = data.batches || [];
      renderBatchSection(data);
      filterSupTable();
      renderHomeTiles(data);
      if (data.admin) renderAdmin(data.admin);
      if (data.users) { FULL_DATA.users = data.users; if (document.getElementById('user-table-wrap')) renderUserTable(data.users); }
      renderPeriodBars();
      if(PERIOD)loadPeriodData();
      if(current==='admin'&&data.isAdmin)loadAgentStatus();
      renderChatAlerts();
      populateDashFilters(data);
      const dashPage = document.getElementById('page-dash');
      if (dashPage && dashPage.style.display !== 'none') loadAnalytics();
      else if (data.analytics) ANALYTICS = null; // stale; re-rendered on next visit
      busy(false);
      drafts.forEach(function(d){if(d.el.isConnected){d.el.value=d.value;d.el.checked=d.checked;}});
    } catch (err) {
      busy(false);
      console.error('Dashboard render failed:', err);
      alert('Dashboard load error: ' + err.message + '\nPlease reload and try again.');
    }
  }

  function populateDropdowns(data) {
    const products = data.products, packaging = data.packaging;
    fillSelect('raw-product', products);
    fillSelect('fg-product', products);
    fillSelect('sup-product', products);
    fillSelect('sup-channel', data.channels || []);

    const fillFilter = function (id, opts, keepAll) {
      const el = document.getElementById(id); if (!el) return;
      const cur = el.value;
      el.innerHTML = '<option value="">' + keepAll + '</option>' + opts;
      el.value = cur;
    };
    const prodOpts = products.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
    fillFilter('raw-item-filter', prodOpts, 'All Products');
    fillFilter('fg-item-filter', prodOpts, 'All Products');
    fillFilter('sup-product-filter', prodOpts, 'All Products');
    // packaging: grouped by item type, value = Item ID
    const groups = {};
    packaging.forEach(function (r) {
      const g = r['Applicable Product'] === 'All' ? 'Common Packaging' : r['Item Name'];
      if (!groups[g]) groups[g] = [];
      groups[g].push('<option value="' + esc(r['Item ID']) + '">' + esc(r['Applicable Product'] === 'All' ? r['Item Name'] : r['Applicable Product']) + '</option>');
    });
    fillFilter('pack-item-filter', Object.keys(groups).map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].join('') + '</optgroup>';
    }).join(''), 'All Items');

    const bpf = document.getElementById('batch-product-filter');
    if (bpf) { const cur = bpf.value; bpf.innerHTML = '<option value="">All Products</option>' + products.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join(''); bpf.value = cur; }

    const chanFilter = document.getElementById('sup-channel-filter');
    if (chanFilter) {
      const cur = chanFilter.value;
      chanFilter.innerHTML = '<option value="">All Channels</option>' +
        (data.channels || []).map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
      chanFilter.value = cur;
    }

    const reasonOpts = (data.damageReasons || []).map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('');
    ['sup-damage-reason', 'rr-damage-reason'].forEach(function (id) { const el = document.getElementById(id); if (el) { const cur = el.value; el.innerHTML = reasonOpts; if (cur) el.value = cur; } });
    const rrWrap = document.getElementById('rr-repack-items');
    if (rrWrap) rrWrap.innerHTML = (data.repackItems || []).map(function (it) { return '<label class="chk"><input type="checkbox" class="rr-repack-chk" value="' + esc(it) + '"' + (it === 'Corrugated Box' ? ' checked' : '') + '> ' + esc(it) + '</label>'; }).join('');

    const repackWrap = document.getElementById('sup-repack-items');
    if (repackWrap) {
      repackWrap.innerHTML = (data.repackItems || []).map(function (it) {
        return '<label class="chk"><input type="checkbox" class="repack-chk" value="' + esc(it) + '"> ' + esc(it) + '</label>';
      }).join('');
    }

    const packOpts = packaging.map(function (p) {
      return '<option value="' + esc(p['Item ID']) + '">' + esc(p['Item Name']) + ' (' + esc(p['Applicable Product']) + ')</option>';
    }).join('');
    const packSel = document.getElementById('pack-item');
    if (packSel) packSel.innerHTML = packOpts;

    const newPackApplSel = document.getElementById('new-pack-applicable');
    if (newPackApplSel) {
      newPackApplSel.innerHTML = '<option value="All">All Products (Common)</option>' +
        products.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + ' (Specific)</option>'; }).join('');
    }
  }

  function fillSelect(id, list) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = list.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }

  /* ============ TABLE RENDERERS ============ */

  function statusClass(status) {
    if (status === 'In Stock') return 'status-in';
    if (status === 'Low Stock') return 'status-low';
    return 'status-out';
  }
  function badge(status) {
    return '<span class="badge ' + statusClass(status) + '">' + esc(status) + '</span>';
  }

  const AVATAR_COLORS = ['#006D5B', '#17b26a', '#f79009', '#7a5af8', '#f04438', '#0ea5e9', '#d6336c', '#C9A227'];
  function avatar(name) {
    name = String(name || '?');
    const letter = name.trim().charAt(0).toUpperCase();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
    return '<span class="row-avatar" style="background:' + color + '">' + esc(letter) + '</span>';
  }

  /* ============ DYNAMIC KPI CARDS ============
     Every KPI row is built from the rows currently visible in that tab, so it follows the
     search box, the status filter and the date filter. */

  function kpiCard(cls, label, value, sub) {
    return '<div class="kpi-card ' + cls + '"><div class="kpi-label">' + label + '</div>' +
      '<div class="kpi-value">' + value + '</div><div class="muted">' + (sub || '') + '</div></div>';
  }
  function statusCounts(rows) {
    const c = { ok: 0, low: 0, out: 0 };
    rows.forEach(function (r) {
      if (r['Status'] === 'Out of Stock') c.out++;
      else if (r['Status'] === 'Low Stock') c.low++;
      else c.ok++;
    });
    return c;
  }
  // "Showing 3 of 12 · filter applied" line
  function shownSub(shown, total, extra, word) {
    const filtered = shown !== total;
    return (filtered ? 'of ' + total + ' · filtered' : 'all ' + (word || 'items')) + (extra ? ' · ' + extra : '');
  }
  function periodTag() { return PERIOD ? ' <span class="in-period">in period</span>' : ''; }
  function sumBy(rows, key) { return rows.reduce(function (t, r) { return t + num(r[key]); }, 0); }
  function sumMove(rows, kind, keyOf, field, lifetimeKey) {
    if (PERIOD && PERIOD_DATA) {
      return rows.reduce(function (t, r) { const m = mv(kind, keyOf(r)); return t + Number((m && m[field]) || 0); }, 0);
    }
    return sumBy(rows, lifetimeKey);
  }

  function statusPill(st) { return badge(st); }
  function lastRecv(kind, key) {
    const map = (DASHBOARD_DATA && DASHBOARD_DATA.lastReceived && DASHBOARD_DATA.lastReceived[kind]) || {};
    const e = map[key];
    return e && e.qty ? 'last ' + formatIndianNumber(e.qty) + ' on ' + fmtDate(e.ts).split(',')[0] : 'never received yet';
  }

  // ---- One item selected: the cards describe that single item ----
  function rawItemKPIs(r) {
    const m = mv('raw', r['Product Name']);
    const ml = num(r['Current Stock (ml)']);
    const received = m ? m.received : num(r['Qty Received (ml)']);
    const consumed = m ? m.consumed : num(r['Consumed (ml)']);
    return kpiCard(r['Status'] === 'Out of Stock' ? 'red' : (r['Status'] === 'Low Stock' ? 'orange' : 'green'),
        esc(r['Product Name']) + ' · Current Stock', formatIndianNumber(ml) + ' <span class="kpi-unit">ml</span>',
        Math.floor(ml / 30) + ' bottles can be filled · ' + esc(r['Status'])) +
      kpiCard('blue', 'First-Time Opening', formatIndianNumber(r['Opening Stock (ml)']) + ' <span class="kpi-unit">ml</span>', 'entered once when the system started') +
      kpiCard('gold', 'Received' + periodTag(), formatIndianNumber(received) + ' <span class="kpi-unit">ml</span>', lastRecv('raw', r['Product Name'])) +
      kpiCard('slate', 'Consumed' + periodTag(), formatIndianNumber(consumed) + ' <span class="kpi-unit">ml</span>', Math.floor(consumed / 30) + ' bottles packed · min ' + esc(r['Min Threshold (Units)']) + ' units');
  }

  function packItemKPIs(r) {
    const key = r['Item Name'] + ' (' + r['Applicable Product'] + ')';
    const m = mv('pack', key);
    const pcs = num(r['Current Stock (Pcs)']);
    const received = m ? m.received : num(r['Qty Received (Pcs)']);
    const consumed = m ? m.consumed : num(r['Consumed (Pcs)']);
    return kpiCard(r['Status'] === 'Out of Stock' ? 'red' : (r['Status'] === 'Low Stock' ? 'orange' : 'green'),
        esc(r['Item Name']) + ' · Current Stock', formatIndianNumber(pcs) + ' <span class="kpi-unit">pcs</span>',
        'enough for ' + formatIndianNumber(Math.max(0, pcs)) + ' bottles · ' + esc(r['Status'])) +
      kpiCard('blue', 'First-Time Opening', formatIndianNumber(r['Opening Stock (Pcs)']) + ' <span class="kpi-unit">pcs</span>',
        esc(r['Applicable Product'] === 'All' ? 'common item (every product)' : 'for ' + r['Applicable Product'])) +
      kpiCard('gold', 'Received' + periodTag(), formatIndianNumber(received) + ' <span class="kpi-unit">pcs</span>', lastRecv('pack', key)) +
      kpiCard('slate', 'Consumed' + periodTag(), formatIndianNumber(consumed) + ' <span class="kpi-unit">pcs</span>', 'min threshold ' + esc(r['Min Threshold (Pcs)']) + ' pcs');
  }

  function fgItemKPIs(r) {
    const prod = r['Product Name'];
    const m = mv('fg', prod);
    const stock = num(r['Current Stock (Units)']);
    const packed = m ? m.packed : num(r['Total Packed (Units)']);
    const out = m ? m.out : num(r['Total Out (Units)']);
    const damage = m ? m.damage : num(r['Total Damage (Units)']);
    const repack = m ? m.repack : num(r['Total Repackaging (Units)']);
    // sale value of this product from the supervisor entries in view
    let sale = 0;
    (FULL_DATA.sup || []).forEach(function (e) {
      if (e['Product Name'] === prod && e['Entry Type'] === 'Out' && inPeriod(e['Timestamp'])) sale += num(e['Sale Value (₹)']);
    });
    const batches = (FULL_DATA.batches || []).filter(function (b) { return b.product === prod && b.balance > 0; });
    const soonest = batches.slice().sort(function (a, b) { return (a.expiry || '9999') < (b.expiry || '9999') ? -1 : 1; })[0];
    return kpiCard(r['Status'] === 'Out of Stock' ? 'red' : (r['Status'] === 'Low Stock' ? 'orange' : 'green'),
        esc(prod) + ' · Ready To Dispatch', formatIndianNumber(stock) + ' <span class="kpi-unit">units</span>', esc(r['Status']) + ' · min ' + esc(r['Min Threshold (Units)']) + ' units') +
      kpiCard('green', 'Packed' + periodTag(), formatIndianNumber(packed) + ' <span class="kpi-unit">units</span>', 'first-time opening ' + esc(r['Opening Stock (Units)']) + ' units') +
      kpiCard('gold', 'Dispatched' + periodTag(), formatIndianNumber(out) + ' <span class="kpi-unit">units</span>', sale ? 'sale value ' + rupee0(sale) : 'no sale value recorded') +
      kpiCard(batches.length ? 'blue' : 'slate', 'Batches In Stock', batches.length, soonest ? 'next expiry ' + (soonest.expiry ? fmtISO(soonest.expiry) : 'not set') + ' · returns ' + (damage + repack) : 'no batch with stock');
  }

  function renderRawKPIs(rows) {
    const el = document.getElementById('raw-kpi-row'); if (!el) return;
    if (rows.length === 1) { el.innerHTML = rawItemKPIs(rows[0]); return; }
    const c = statusCounts(rows);
    const ml = sumBy(rows, 'Current Stock (ml)');
    const received = sumMove(rows, 'raw', function (r) { return r['Product Name']; }, 'received', 'Qty Received (ml)');
    const consumed = sumMove(rows, 'raw', function (r) { return r['Product Name']; }, 'consumed', 'Consumed (ml)');
    el.innerHTML =
      kpiCard('blue', 'Products Shown', rows.length, shownSub(rows.length, FULL_DATA.raw.length)) +
      kpiCard(c.out ? 'red' : (c.low ? 'orange' : 'green'), 'Stock Health', c.ok + ' <span class="kpi-unit">in stock</span>', c.low + ' low · ' + c.out + ' out of stock') +
      kpiCard('slate', 'Current Stock', formatIndianNumber(ml) + ' <span class="kpi-unit">ml</span>', Math.floor(ml / 30) + ' bottles can be filled') +
      kpiCard('gold', 'Received' + periodTag(), formatIndianNumber(received) + ' <span class="kpi-unit">ml</span>', 'consumed ' + formatIndianNumber(consumed) + ' ml');
  }

  function renderPackKPIs(rows) {
    const el = document.getElementById('pack-kpi-row'); if (!el) return;
    if (rows.length === 1) { el.innerHTML = packItemKPIs(rows[0]); return; }
    const c = statusCounts(rows);
    const pcs = sumBy(rows, 'Current Stock (Pcs)');
    const keyOf = function (r) { return r['Item Name'] + ' (' + r['Applicable Product'] + ')'; };
    const received = sumMove(rows, 'pack', keyOf, 'received', 'Qty Received (Pcs)');
    const consumed = sumMove(rows, 'pack', keyOf, 'consumed', 'Consumed (Pcs)');
    el.innerHTML =
      kpiCard('blue', 'Items Shown', rows.length, shownSub(rows.length, FULL_DATA.pack.length)) +
      kpiCard(c.out ? 'red' : (c.low ? 'orange' : 'green'), 'Stock Health', c.ok + ' <span class="kpi-unit">in stock</span>', c.low + ' low · ' + c.out + ' out of stock') +
      kpiCard('slate', 'Current Stock', formatIndianNumber(pcs) + ' <span class="kpi-unit">pcs</span>', 'across the items shown') +
      kpiCard('gold', 'Received' + periodTag(), formatIndianNumber(received) + ' <span class="kpi-unit">pcs</span>', 'consumed ' + formatIndianNumber(consumed) + ' pcs');
  }

  function renderFGKPIs(rows) {
    const el = document.getElementById('fg-kpi-row'); if (!el) return;
    if (rows.length === 1) { el.innerHTML = fgItemKPIs(rows[0]); return; }
    const c = statusCounts(rows);
    const stock = sumBy(rows, 'Current Stock (Units)');
    const keyOf = function (r) { return r['Product Name']; };
    const packed = sumMove(rows, 'fg', keyOf, 'packed', 'Total Packed (Units)');
    const out = sumMove(rows, 'fg', keyOf, 'out', 'Total Out (Units)');
    const damage = sumMove(rows, 'fg', keyOf, 'damage', 'Total Damage (Units)');
    const repack = sumMove(rows, 'fg', keyOf, 'repack', 'Total Repackaging (Units)');
    el.innerHTML =
      kpiCard('blue', 'Products Shown', rows.length, shownSub(rows.length, FULL_DATA.fg.length)) +
      kpiCard(c.out ? 'red' : (c.low ? 'orange' : 'green'), 'Ready To Dispatch', formatIndianNumber(stock) + ' <span class="kpi-unit">units</span>', c.low + ' low · ' + c.out + ' out of stock') +
      kpiCard('green', 'Packed' + periodTag(), formatIndianNumber(packed) + ' <span class="kpi-unit">units</span>', 'dispatched ' + formatIndianNumber(out) + ' units') +
      kpiCard((damage + repack) ? 'orange' : 'slate', 'Returns' + periodTag(), formatIndianNumber(damage + repack) + ' <span class="kpi-unit">units</span>', damage + ' damaged · ' + repack + ' repacked');
  }

  function rowClass(status) {
    if (status === 'Out of Stock') return 'row-out';
    if (status === 'Low Stock') return 'row-low';
    return 'row-in';
  }
  const STATUS_ORDER = { 'Out of Stock': 0, 'Low Stock': 1, 'In Stock': 2 };
  function sortBySeverity(rows) {
    return rows.slice().sort(function (a, b) { return STATUS_ORDER[a['Status']] - STATUS_ORDER[b['Status']]; });
  }

  function actionBtn(cls, fn, arg, label) {
    return '<button class="icon-btn ' + cls + '" onclick="' + fn + '(\'' + jsArg(arg) + '\')">' + label + '</button>';
  }
  // Row actions: plain Edit / Delete buttons, shown only if the user has that permission.
  function actionRow(items) {
    items = (items || []).filter(Boolean);
    if (!items.length) return '<span class="muted">-</span>';
    return '<div class="action-icons">' + items.map(function (it) { return actionBtn(it.cls, it.fn, it.arg, it.label); }).join('') + '</div>';
  }

  // Whole bottles + leftover ml (a bottle needs a full 30 ml)
  function unitsCell(ml) {
    ml = num(ml);
    const units = ml >= 0 ? Math.floor(ml / 30) : Math.ceil(ml / 30);
    const rest = ml - units * 30;
    return '<b>' + units + '</b>' + (rest ? ' <span class="muted">+' + rest + ' ml</span>' : '');
  }

  // ---- RAW MATERIAL ----
  function renderRawTable(rows, isFiltered) {
    renderRawKPIs(rows);
    updateResetButtons();
    const isAdmin = DASHBOARD_DATA && DASHBOARD_DATA.canEditRows;
    const isSuper = DASHBOARD_DATA && DASHBOARD_DATA.canDelete;
    const sorted = sortBySeverity(rows);
    let html = '<table><tr><th>Product</th><th>First-Time Opening (ml)</th><th>' + periodHead('Received (ml)') + '</th><th>' + periodHead('Consumed (ml)') + '</th><th>Current Stock (ml)</th><th>Current Stock (Units)</th><th>Min Threshold</th><th>Status</th>' +
      ((isAdmin || isSuper) ? '<th>Actions</th>' : '') + '</tr>';
    sorted.forEach(function (r) {
      const mr = mv('raw', r['Product Name']);
      html += '<tr class="' + rowClass(r['Status']) + '"><td>' + avatar(r['Product Name']) + esc(r['Product Name']) + '</td><td>' + esc(r['Opening Stock (ml)']) + '</td><td>' + periodCell(mr, 'received', r['Qty Received (ml)']) +
        '</td><td>' + periodCell(mr, 'consumed', r['Consumed (ml)']) + '</td><td><b>' + esc(r['Current Stock (ml)']) + '</b></td><td>' + unitsCell(r['Current Stock (ml)']) + '</td><td>' + esc(r['Min Threshold (Units)']) +
        '</td><td>' + badge(r['Status']) + '</td>' +
        ((isAdmin || isSuper) ? '<td>' + actionRow([isAdmin && { cls: 'edit', fn: 'editRawRow', arg: r['Product Name'], label: '✏️ Edit' }, isSuper && { cls: 'delete', fn: 'deleteRawRow', arg: r['Product Name'], label: '🗑 Delete' }]) + '</td>' : '') + '</tr>';
    });
    document.getElementById('raw-table-wrap').innerHTML = html + '</table>';
  }

  // ---- PACKAGING (category -> items) ----
  // Packaging is shown as separate tables: Common items (used by every product), then one table per
  // product-specific item type (Outer Box, Label, ...) listed product-wise.
  /* ============ DATE / PERIOD FILTER (shared by Raw, Packaging, Finished Goods, Supervisor) ============ */

  let PERIOD = null;        // { preset, from, to } - null = All time (live stock, lifetime totals)
  let PERIOD_DATA = null;    // { raw:{}, pack:{}, fg:{} } movement inside the period

  const PERIOD_PRESETS = [
    { key: '', label: 'All time (live stock)' },
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'week', label: 'Last 7 days' },
    { key: 'month', label: 'This month' },
    { key: 'lastMonth', label: 'Last month' },
    { key: '3months', label: 'Last 90 days' },
    { key: 'custom', label: 'Custom dates...' }
  ];

  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function presetRange(key) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const shift = function (n) { const x = new Date(t); x.setDate(x.getDate() + n); return x; };
    if (key === 'today') return { from: isoOf(t), to: isoOf(t) };
    if (key === 'yesterday') return { from: isoOf(shift(-1)), to: isoOf(shift(-1)) };
    if (key === 'week') return { from: isoOf(shift(-6)), to: isoOf(t) };
    if (key === 'month') return { from: isoOf(new Date(t.getFullYear(), t.getMonth(), 1)), to: isoOf(t) };
    if (key === 'lastMonth') return { from: isoOf(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: isoOf(new Date(t.getFullYear(), t.getMonth(), 0)) };
    if (key === '3months') return { from: isoOf(shift(-89)), to: isoOf(t) };
    return { from: isoOf(t), to: isoOf(t) };
  }

  function renderPeriodBars() {
    const preset = PERIOD ? PERIOD.preset : '';
    const from = PERIOD ? PERIOD.from : '';
    const to = PERIOD ? PERIOD.to : '';
    const custom = preset === 'custom';
    const html =
      '<span class="pb-label f-label" style="margin:0">Show data for</span>' +
      '<select class="pb-preset" onchange="onPeriodPreset(this.value)">' +
        PERIOD_PRESETS.map(function (o) { return '<option value="' + o.key + '"' + (o.key === preset ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') +
      '</select>' +
      '<span class="pb-dates" style="display:' + (custom ? 'inline-flex' : 'none') + '">' +
        '<input type="date" class="pb-from" value="' + esc(from) + '" onchange="onPeriodCustom()">' +
        '<span class="muted">to</span>' +
        '<input type="date" class="pb-to" value="' + esc(to) + '" onchange="onPeriodCustom()">' +
      '</span>' +
      (PERIOD ? '<span class="pb-active">' + fmtISO(PERIOD.from) + ' &rarr; ' + fmtISO(PERIOD.to) + '</span>' +
                '<button class="btn-outline pb-clear" onclick="onPeriodPreset(\'\')">Clear</button>' : '');
    document.querySelectorAll('.period-bar').forEach(function (el) { el.innerHTML = html; });
  }

  function onPeriodPreset(key) {
    if (!key) { PERIOD = null; PERIOD_DATA = null; renderPeriodBars(); rerenderPeriodTables(); return; }
    if (key === 'custom') {
      const r = PERIOD && PERIOD.from ? { from: PERIOD.from, to: PERIOD.to } : presetRange('month');
      PERIOD = { preset: 'custom', from: r.from, to: r.to };
      renderPeriodBars();
      loadPeriodData();
      return;
    }
    const r = presetRange(key);
    PERIOD = { preset: key, from: r.from, to: r.to };
    renderPeriodBars();
    loadPeriodData();
  }

  function onPeriodCustom() {
    const bar = document.querySelector('.period-bar');
    const f = bar.querySelector('.pb-from').value, t = bar.querySelector('.pb-to').value;
    if (!f || !t) return;
    PERIOD = { preset: 'custom', from: f < t ? f : t, to: f < t ? t : f };
    renderPeriodBars();
    loadPeriodData();
  }

  function loadPeriodData() {
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      PERIOD_DATA = res;
      busy(false);
      renderPeriodBars();
      rerenderPeriodTables();
    }).withFailureHandler(function (e) { busy(false); PERIOD_DATA = null; showError(e); }).getPeriodMovement(PERIOD.from, PERIOD.to);
  }

  /* ---- Reset all filters of a tab (search, item, status/type/channel and the date filter) ---- */
  const FILTER_FIELDS = {
    raw: ['raw-search', 'raw-item-filter', 'raw-filter'],
    pack: ['pack-search', 'pack-item-filter', 'pack-filter'],
    fg: ['fg-search', 'fg-item-filter', 'fg-filter'],
    sup: ['sup-search', 'sup-product-filter', 'sup-filter', 'sup-channel-filter', 'sup-source-filter'],
    batch: ['batch-search', 'batch-product-filter', 'batch-status-filter'],
    dash: ['dash-range', 'dash-from', 'dash-to', 'dash-product', 'dash-channel'],
    admin: ['admin-search'],
    history: ['history-search', 'history-type'],
    ph: ['ph-search', 'ph-type']
  };
  // value a field has when nothing is filtered
  const FILTER_DEFAULTS = { 'batch-status-filter': 'active', 'dash-range': 'month' };

  function resetFilters(scope) {
    (FILTER_FIELDS[scope] || []).forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = FILTER_DEFAULTS[id] !== undefined ? FILTER_DEFAULTS[id] : '';
    });
    const clearsPeriod = ['raw', 'pack', 'fg', 'sup'].indexOf(scope) !== -1;
    if (clearsPeriod && PERIOD) { PERIOD = null; PERIOD_DATA = null; renderPeriodBars(); }
    if (scope === 'raw') filterRawTable();
    else if (scope === 'pack') filterPackTable();
    else if (scope === 'fg') { filterFGTable(); renderBatchTable(); }
    else if (scope === 'sup') filterSupTable();
    else if (scope === 'batch') renderBatchTable();
    else if (scope === 'admin') { const el = document.getElementById('admin-search'); if (el) filterAdminTable(); }
    else if (scope === 'dash') { const c = document.getElementById('dash-custom'); if (c) c.style.display = 'none'; loadAnalytics(); }
    else if (scope === 'history') { HISTORY_ALL = false; renderHistoryTable(); }
    else if (scope === 'ph') { PH_ALL = false; renderPriceHistoryTable(); }
    if (clearsPeriod) rerenderPeriodTables();
    updateResetButtons();
  }

  // Highlight the Reset button of a tab while any of its filters is active
  function updateResetButtons() {
    Object.keys(FILTER_FIELDS).forEach(function (scope) {
      const btn = document.getElementById('reset-' + scope);
      if (!btn) return;
      let active = FILTER_FIELDS[scope].some(function (id) {
        const el = document.getElementById(id);
        if (!el) return false;
        const def = FILTER_DEFAULTS[id] !== undefined ? FILTER_DEFAULTS[id] : '';
        return el.value !== def;
      });
      if (['raw', 'pack', 'fg', 'sup'].indexOf(scope) !== -1 && PERIOD) active = true;
      if ((scope === 'history' && PERIOD && !HISTORY_ALL) || (scope === 'ph' && PERIOD && !PH_ALL)) active = true;
      btn.classList.toggle('on', active);
    });
  }

  function rerenderPeriodTables() {
    if (FULL_DATA.raw.length) filterRawTable();
    if (FULL_DATA.pack.length) filterPackTable();
    if (FULL_DATA.fg.length) filterFGTable();
    filterSupTable();
    if (typeof renderBatchTable === 'function' && document.getElementById('batch-table-wrap')) renderBatchTable();
  }

  // movement of one item inside the selected period ({} when no period is selected)
  function mv(kind, key) {
    if (!PERIOD || !PERIOD_DATA) return null;
    return (PERIOD_DATA[kind] || {})[key] || { received: 0, consumed: 0, packed: 0, out: 0, damage: 0, repack: 0 };
  }
  function periodHead(base) { return PERIOD ? base + ' <span class="in-period">in period</span>' : base; }
  // value inside the selected period, or the lifetime value when no period is selected
  function periodCell(m, key, lifetimeValue) {
    if (!m) return esc(lifetimeValue);
    const v = Number(m[key] || 0);
    return v ? '<b>' + v + '</b>' : '<span class="muted">0</span>';
  }
  function inPeriod(ts) {
    if (!PERIOD) return true;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return false;
    const day = isoOf(d);
    return day >= PERIOD.from && day <= PERIOD.to;
  }

  // "Last Received" = the most recent Add Stock entry for that item (quantity + date). "-" if nothing received yet.
  function lastReceivedCell(kind, key) {
    const map = (DASHBOARD_DATA && DASHBOARD_DATA.lastReceived && DASHBOARD_DATA.lastReceived[kind]) || {};
    const e = map[key];
    if (!e || !e.qty) return '<span class="muted">-</span>';
    return '<b>' + e.qty + '</b><div class="muted">' + fmtDate(e.ts).split(',')[0] + '</div>';
  }

  function packSection(title, note, rows, firstColLabel, firstColKey, isAdmin) {
    const isSuper = DASHBOARD_DATA && DASHBOARD_DATA.canDelete;
    let html = '<div class="pack-section"><div class="pack-section-head"><span>' + esc(title) + '</span><span class="h2-note">' + esc(note) + '</span></div>' +
      '<table><tr><th>' + firstColLabel + '</th><th>First-Time Opening (Pcs)</th><th>' + (PERIOD ? periodHead('Received (Pcs)') : 'Last Received (Pcs)') + '</th><th>' + periodHead('Consumed (Pcs)') + '</th><th>Current (Pcs)</th><th>Min Threshold</th><th>Status</th>' +
      ((isAdmin || isSuper) ? '<th>Actions</th>' : '') + '</tr>';
    if (!rows.length) html += '<tr><td colspan="8" class="muted">No items match.</td></tr>';
    rows.forEach(function (r) {
      const pkey = r['Item Name'] + ' (' + r['Applicable Product'] + ')';
      const mp = mv('pack', pkey);
      html += '<tr class="' + rowClass(r['Status']) + '"><td>' + avatar(r[firstColKey]) + esc(r[firstColKey]) + '</td><td>' + esc(r['Opening Stock (Pcs)']) +
        '</td><td>' + (PERIOD ? periodCell(mp, 'received', 0) : lastReceivedCell('pack', pkey)) + '</td><td>' + periodCell(mp, 'consumed', r['Consumed (Pcs)']) + '</td><td><b>' + esc(r['Current Stock (Pcs)']) + '</b></td><td>' + esc(r['Min Threshold (Pcs)']) +
        '</td><td>' + badge(r['Status']) + '</td>' +
        ((isAdmin || isSuper) ? '<td>' + actionRow([isAdmin && { cls: 'edit', fn: 'editPackRow', arg: r['Item ID'], label: '✏️ Edit' }, isSuper && { cls: 'delete', fn: 'deletePackItem', arg: r['Item ID'], label: '🗑 Delete' }]) + '</td>' : '') + '</tr>';
    });
    return html + '</table></div>';
  }

  function renderPackTable(rows, isFiltered) {
    renderPackKPIs(rows);
    updateResetButtons();
    const isAdmin = DASHBOARD_DATA && DASHBOARD_DATA.canEditRows;
    const isSuper = DASHBOARD_DATA && DASHBOARD_DATA.canDelete;
    const common = sortBySeverity(rows.filter(function (r) { return r['Applicable Product'] === 'All'; }));
    const specific = rows.filter(function (r) { return r['Applicable Product'] !== 'All'; });
    const types = [];
    specific.forEach(function (r) { if (types.indexOf(r['Item Name']) === -1) types.push(r['Item Name']); });
    // keep the configured order first (Outer Box, Label), then any custom item types
    types.sort(function (a, b) {
      const ia = ['Outer Box', 'Label'].indexOf(a), ib = ['Outer Box', 'Label'].indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    let html = packSection('Common Packaging', 'used by every product · 1 pc per bottle', common, 'Category', 'Item Name', isAdmin);
    types.forEach(function (t) {
      const list = specific.filter(function (r) { return r['Item Name'] === t; })
        .sort(function (a, b) { return (DASHBOARD_DATA.products || []).indexOf(a['Applicable Product']) - (DASHBOARD_DATA.products || []).indexOf(b['Applicable Product']); });
      html += packSection(t, 'product-wise · 1 pc per bottle of that product', sortBySeverity(list), 'Product', 'Applicable Product', isAdmin);
    });
    document.getElementById('pack-table-wrap').innerHTML = html;
  }

  // ---- FINISHED GOODS ----
  function renderFGTable(rows, isFiltered) {
    renderFGKPIs(rows);
    updateResetButtons();
    const isAdmin = DASHBOARD_DATA && DASHBOARD_DATA.canEditRows;
    const isSuper = DASHBOARD_DATA && DASHBOARD_DATA.canDelete;
    const sorted = sortBySeverity(rows);
    let html = '<table><tr><th>Product</th><th>First-Time Opening</th><th>' + periodHead('Packed') + '</th><th>' + periodHead('Out') + '</th><th>' + periodHead('Damage') + '</th><th>' + periodHead('Repackaging') + '</th><th>Current Stock</th><th>Min Threshold</th><th>Status</th>' +
      ((isAdmin || isSuper) ? '<th>Actions</th>' : '') + '</tr>';
    sorted.forEach(function (r) {
      const mf = mv('fg', r['Product Name']);
      html += '<tr class="' + rowClass(r['Status']) + '"><td>' + avatar(r['Product Name']) + esc(r['Product Name']) + '</td><td>' + esc(r['Opening Stock (Units)']) + '</td><td>' + periodCell(mf, 'packed', r['Total Packed (Units)']) +
        '</td><td>' + periodCell(mf, 'out', r['Total Out (Units)']) + '</td><td>' + periodCell(mf, 'damage', r['Total Damage (Units)']) + '</td><td>' + periodCell(mf, 'repack', r['Total Repackaging (Units)']) +
        '</td><td><b>' + esc(r['Current Stock (Units)']) + '</b></td><td>' + esc(r['Min Threshold (Units)']) + '</td><td>' + badge(r['Status']) + '</td>' +
        ((isAdmin || isSuper) ? '<td>' + actionRow([isAdmin && { cls: 'edit', fn: 'editFGRow', arg: r['Product Name'], label: '✏️ Edit' }, isSuper && { cls: 'delete', fn: 'deleteFGRow', arg: r['Product Name'], label: '🗑 Delete' }]) + '</td>' : '') + '</tr>';
    });
    document.getElementById('fg-table-wrap').innerHTML = html + '</table>';
  }

  // ---- SUPERVISOR ENTRIES ----
  function entryTypeBadge(type) {
    let cls = 'status-in', label = type;
    if (type === 'Out') { cls = 'status-out'; label = 'Out (Dispatch)'; }
    if (type === 'RTO-Pending') { cls = 'status-pending'; label = 'IN RTO - Pending'; }
    if (type === 'RTO-Damage') { cls = 'status-low'; label = 'IN RTO - Damage'; }
    if (type === 'RTO-Repackaging') { cls = 'status-in'; label = 'IN RTO - Repackaging'; }
    return '<span class="badge ' + cls + '">' + esc(label) + '</span>';
  }

  // Supervisor KPIs follow the visible entries (search, type, channel and date filter)
  function renderSupKPIs(rows) {
    const el = document.getElementById('sup-kpi-row');
    if (!el) return;
    rows = rows || [];
    const b = { out: 0, sale: 0, damage: 0, repack: 0, pending: 0, auto: 0, bulk: 0, orders: {} };
    rows.forEach(function (r) {
      const q = num(r['Quantity (Units)']);
      const t = r['Entry Type'];
      if (r['Order ID']) b.orders[String(r['Order ID'])] = true;
      if (r['Source'] === 'Auto') b.auto++;
      if (t === 'Out' && isTransferChannel(r['Channel'])) { b.out += q; b.bulk += q; }
      else if (t === 'Out') { b.out += q; b.sale += num(r['Sale Value (₹)']); }
      else if (t === 'RTO-Damage') b.damage += q;
      else if (t === 'RTO-Repackaging') b.repack += q;
      else if (t === 'RTO-Pending') b.pending += q;
    });
    const returns = b.damage + b.repack;
    const retPct = b.out ? (returns / b.out * 100).toFixed(1) : '0.0';
    const scope = PERIOD ? fmtISO(PERIOD.from) + ' → ' + fmtISO(PERIOD.to) : '';
    el.innerHTML =
      kpiCard('blue', ((document.getElementById('sup-product-filter') || {}).value ? esc(document.getElementById('sup-product-filter').value) + ' · Entries' : 'Entries Shown'), rows.length, shownSub(rows.length, FULL_DATA.sup.length, scope, 'entries') + (b.auto ? ' · ' + b.auto + ' auto' : '')) +
      kpiCard('green', 'Out (Dispatched)', formatIndianNumber(b.out) + ' <span class="kpi-unit">units</span>', Object.keys(b.orders).length + ' order id(s)' + (b.bulk ? ' · incl. <b>' + formatIndianNumber(b.bulk) + '</b> bulk transfer' : '')) +
      kpiCard('gold', 'Sale Value', rupee0(b.sale), (b.out - b.bulk) ? 'avg ' + rupee0(b.sale / (b.out - b.bulk)) + ' per unit sold' + (b.bulk ? ' · transfers excluded' : '') : 'no sale in view') +
      kpiCard(returns || b.pending ? 'orange' : 'slate', 'Returns', formatIndianNumber(returns + b.pending) + ' <span class="kpi-unit">units · ' + retPct + '%</span>', b.repack + ' repacked · ' + b.damage + ' damaged' + (b.pending ? ' · <b>' + b.pending + ' pending inspection</b>' : ''));
  }

  function renderSupTable(rows) {
    const isAdmin = DASHBOARD_DATA && DASHBOARD_DATA.canEditRows;
    const isSuper = DASHBOARD_DATA && DASHBOARD_DATA.canDelete;
    const canEdit = DASHBOARD_DATA && DASHBOARD_DATA.canEdit;
    const showAct = isAdmin || isSuper || canEdit;
    let html = '<table><tr><th>Date</th><th>Type</th><th>Channel</th><th>Order ID</th><th>Product</th><th>Batch</th><th>Qty</th><th>Sale Value</th><th>Remarks</th><th>Supervisor</th>' +
      (showAct ? '<th>Action</th>' : '') + '</tr>';
    if (!rows.length) html += '<tr><td colspan="11" class="muted">No entries yet.</td></tr>';
    rows.forEach(function (r) {
      const t = r['Entry Type'];
      const remarks = esc(r['Remarks']) + (r['Repack Items'] ? '<div class="muted">Replaced: ' + esc(r['Repack Items']) + '</div>' : '') +
        (r['Damage Reason'] ? '<div class="muted">Reason: ' + esc(r['Damage Reason']) + '</div>' : '');
      const batch = r['Batch No'] ? '<a class="batch-link" onclick="openBatchTrace(\'' + esc(r['Batch No']) + '\')">' + esc(r['Batch No']) + '</a>' : '<span class="muted">-</span>';
      const trace = (r['Order Item ID'] ? '<div class="muted tiny">Item ' + esc(r['Order Item ID']) + '</div>' : '') + (r['Tracking ID'] ? '<div class="muted tiny">AWB ' + esc(r['Tracking ID']) + '</div>' : '') + (r['Return ID'] ? '<div class="muted tiny">Ret ' + esc(r['Return ID']) + '</div>' : '');
      const src = (r['Source'] === 'Auto' ? ' <span class="src-tag">AUTO</span>' : '') + (r['Channel Date'] ? '<div class="muted tiny">' + (t === 'Out' ? 'Dispatched ' : 'Returned ') + esc(String(r['Channel Date']).slice(0, 10)) + '</div>' : '');
      const skuLine = r['SKU'] ? '<div class="muted tiny mono">' + esc(r['SKU']) + '</div>' : '';
      const sale = t === 'Out' && r['Sale Value (₹)'] !== '' && r['Sale Value (₹)'] !== undefined ? rupee(r['Sale Value (₹)']) : '-';
      const acts = [];
      if (canEdit && t === 'RTO-Pending') acts.push({ cls: 'inspect', fn: 'openResolveReturn', arg: r['Entry ID'], label: '🔍 Inspect' });
      if (isAdmin) acts.push({ cls: 'edit', fn: 'editSupEntry', arg: r['Entry ID'], label: '✏️ Edit' });
      if (isSuper) acts.push({ cls: 'delete', fn: 'deleteSupEntry', arg: r['Entry ID'], label: '🗑 Delete' });
      html += '<tr' + (t === 'RTO-Pending' ? ' class="row-pending"' : '') + '><td>' + fmtDate(r['Timestamp']) + src + '</td><td>' + entryTypeBadge(t) + '</td><td>' + esc(r['Channel'] || '-') + '</td><td>' + esc(r['Order ID'] || '-') + trace +
        '</td><td>' + avatar(r['Product Name']) + esc(r['Product Name']) + skuLine + '</td><td>' + batch + '</td><td><b>' + esc(r['Quantity (Units)']) + '</b></td><td>' + sale + '</td><td>' + remarks + '</td><td class="muted">' + esc(r['Supervisor Email']) + '</td>' +
        (showAct ? '<td>' + actionRow(acts) + '</td>' : '') + '</tr>';
    });
    document.getElementById('sup-table-wrap').innerHTML = html + '</table>';
  }

  /* ============ SEARCH / FILTER ============ */

  function filterRawTable() {
    const q = document.getElementById('raw-search').value.toLowerCase();
    const status = document.getElementById('raw-filter').value;
    const item = (document.getElementById('raw-item-filter') || {}).value || '';
    const filtered = FULL_DATA.raw.filter(function (r) {
      return String(r['Product Name']).toLowerCase().indexOf(q) !== -1 && (!status || r['Status'] === status) && (!item || r['Product Name'] === item);
    });
    renderRawTable(filtered, true);
  }

  function filterPackTable() {
    const q = document.getElementById('pack-search').value.toLowerCase();
    const status = document.getElementById('pack-filter').value;
    const item = (document.getElementById('pack-item-filter') || {}).value || '';
    const filtered = FULL_DATA.pack.filter(function (r) {
      const hay = (String(r['Item Name']) + ' ' + String(r['Applicable Product'])).toLowerCase();
      return hay.indexOf(q) !== -1 && (!status || r['Status'] === status) && (!item || r['Item ID'] === item);
    });
    renderPackTable(filtered, true);
  }

  function filterFGTable() {
    const q = document.getElementById('fg-search').value.toLowerCase();
    const status = document.getElementById('fg-filter').value;
    const item = (document.getElementById('fg-item-filter') || {}).value || '';
    const filtered = FULL_DATA.fg.filter(function (r) {
      return String(r['Product Name']).toLowerCase().indexOf(q) !== -1 && (!status || r['Status'] === status) && (!item || r['Product Name'] === item);
    });
    renderFGTable(filtered, true);
  }

  function filterSupTable() {
    const q = document.getElementById('sup-search').value.toLowerCase();
    const type = document.getElementById('sup-filter').value;
    const chanEl = document.getElementById('sup-channel-filter');
    const chan = chanEl ? chanEl.value : '';
    const prod = (document.getElementById('sup-product-filter') || {}).value || '';
    const source = (document.getElementById('sup-source-filter') || {}).value || '';
    const filtered = FULL_DATA.sup.filter(function (r) {
      if (prod && r['Product Name'] !== prod) return false;
      if (source && (r['Source'] || 'Manual') !== source) return false;
      const hay = (String(r['Product Name']) + ' ' + String(r['Order ID'] || '') + ' ' + String(r['Remarks'] || '') + ' ' + String(r['Batch No'] || '') + ' ' + String(r['Order Item ID'] || '') + ' ' + String(r['Tracking ID'] || '') + ' ' + String(r['Return ID'] || '')).toLowerCase();
      return inPeriod(r['Timestamp']) && hay.indexOf(q) !== -1 && (!type || r['Entry Type'] === type) && (!chan || r['Channel'] === chan);
    });
    renderSupKPIs(filtered);
    updateResetButtons();
    renderSupTable(filtered);
  }

  /* ============ CSV EXPORT ============ */

  function toCSV(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    rows.forEach(function (r) {
      lines.push(headers.map(function (h) {
        let v = r[h] === undefined || r[h] === null ? '' : String(r[h]);
        v = v.replace(/"/g, '""');
        return '"' + v + '"';
      }).join(','));
    });
    return lines.join('\n');
  }

  function downloadCSV(filename, csvContent) {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportCSV(type) {
    const map = {
      raw: { data: FULL_DATA.raw, name: 'Raw_Material_Inventory.csv' },
      pack: { data: FULL_DATA.pack, name: 'Packaging_Material_Inventory.csv' },
      fg: { data: FULL_DATA.fg, name: 'Finished_Goods_Inventory.csv' },
      sup: { data: FULL_DATA.sup, name: 'Supervisor_Entries.csv' },
      batches: { data: (FULL_DATA.batches || []).map(function (b) { return { 'Batch No': b.batchNo, 'Product': b.product, 'Mfg Date': b.mfg, 'Expiry Date': b.expiry, 'Days to Expiry': b.daysToExpiry === null ? '' : b.daysToExpiry, 'Status': b.expiryStatus, 'Packed': b.packed, 'Out': b.out, 'Damage': b.damage, 'Repack': b.repack, 'Balance': b.balance, 'Notes': b.notes }; }), name: 'Batches.csv' },
      adminCosting: { data: FULL_DATA.adminCosting, name: 'Product_Costing.csv' },
      priceHistory: { data: FULL_DATA.priceHistory, name: 'Price_History.csv' },
      dashProducts: { data: (ANALYTICS && ANALYTICS.products) || [], name: 'Product_Performance.csv' },
      dashReorder: { data: ((ANALYTICS && ANALYTICS.reorder) || []).filter(function (r) { return !REORDER_VIEW || r.type === REORDER_VIEW; }), name: 'Reorder_List.csv' }
    };
    const target = map[type];
    if (!target || !target.data.length) return alert('No data to export.');
    downloadCSV(target.name, toCSV(target.data));
  }

  /* ============ ADMIN PANEL ============ */

  let ADMIN_DATA = null;

  function marginClass(pct) {
    if (pct < 20) return 'margin-bad';
    if (pct < 40) return 'margin-ok';
    return 'margin-good';
  }
  function rupee(n) { return '₹' + formatIndianNumber(Number(n || 0).toFixed(2)); }
  function rupee0(n) { return '₹' + formatIndianNumber(Number(n || 0).toFixed(0)); }

  function renderCostingTable(rows) {
    const sorted = rows.slice().sort(function (a, b) { return a.marginPct - b.marginPct; });
    let html = '<table><tr><th>Product</th><th>RM Rate (₹/ml)</th><th>RM Cost / Unit</th><th>Packaging Cost / Unit</th><th>Total Cost / Unit</th><th>Selling Price</th><th>Margin</th><th>Margin %</th><th>Action</th></tr>';
    sorted.forEach(function (r) {
      const missing = !r.sellingPrice ? ' <span class="badge status-low">no selling price</span>' : '';
      const chSet = (r.channelPrices || []).filter(function (x) { return x.price !== ''; });
      const chNote = chSet.length ? '<div class="muted" title="' + esc(chSet.map(function (x) { return x.channel + ' ₹' + x.price; }).join(', ')) + '">' + chSet.length + ' channel price' + (chSet.length > 1 ? 's' : '') + '</div>' : '';
      html += '<tr><td>' + avatar(r.product) + esc(r.product) + missing + '</td><td>' + rupee(r.rmRate) + '</td><td>' + rupee(r.rawMaterialCost) + '</td><td>' + rupee(r.packagingCost) +
        '</td><td><b>' + rupee(r.totalCost) + '</b></td><td>' + rupee(r.sellingPrice) + chNote + '</td><td>' + rupee(r.margin) + '</td><td class="' + marginClass(r.marginPct) + '">' + r.marginPct + '%</td>' +
        '<td>' + actionRow([(DASHBOARD_DATA && DASHBOARD_DATA.canEditRows) && { cls: 'edit', fn: 'editCosting', arg: r.product, label: '✏️ Edit' }]) + '</td></tr>';
    });
    document.getElementById('admin-table-wrap').innerHTML = html + '</table>';
    updateResetButtons();
  }

  function filterAdminTable() {
    const q = document.getElementById('admin-search').value.toLowerCase();
    renderCostingTable(FULL_DATA.adminCosting.filter(function (r) { return r.product.toLowerCase().indexOf(q) !== -1; }));
  }

  function renderValuation(v) {
    document.getElementById('admin-kpi-row').innerHTML =
      '<div class="kpi-card blue"><div class="kpi-label">Raw Material Stock Value</div><div class="kpi-value">' + rupee0(v.rawMaterial) + '</div></div>' +
      '<div class="kpi-card orange"><div class="kpi-label">Packaging Stock Value</div><div class="kpi-value">' + rupee0(v.packaging) + '</div></div>' +
      '<div class="kpi-card green"><div class="kpi-label">Finished Goods Stock Value</div><div class="kpi-value">' + rupee0(v.finishedGoods) + '</div></div>' +
      '<div class="kpi-card red"><div class="kpi-label">Total Inventory Value</div><div class="kpi-value">' + rupee0(v.total) + '</div><div class="muted">' + numberToWordsIndian(v.total) + ' Rupees</div></div>';
  }

  function renderExpiryAlertCard(list) {
    list = list || [];
    const exp = list.filter(function (a) { return a.status === 'Expired'; });
    const soon = list.filter(function (a) { return a.status === 'Expiring Soon'; });
    const cls = exp.length ? 'alert-out' : (soon.length ? 'alert-low' : 'alert-ok');
    const chips = function (l, c) {
      return l.slice(0, 6).map(function (a) { return '<span class="chip ' + c + '" title="' + esc(a.current) + ' · ' + esc(a.threshold) + '">' + esc(a.name) + '</span>'; }).join('') +
        (l.length > 6 ? '<span class="chip more">+' + (l.length - 6) + ' more</span>' : '');
    };
    return '<div class="alert-card ' + cls + '">' +
      '<div class="alert-head"><span>📅 Batch Expiry</span><button class="icon-btn view" onclick="switchPage(\'fg\')">Open →</button></div>' +
      '<div class="alert-counts"><div><b class="c-out">' + exp.length + '</b><span>Expired</span></div><div><b class="c-low">' + soon.length + '</b><span>Expiring Soon</span></div></div>' +
      (list.length ? '<div class="chip-wrap">' + chips(exp, 'out') + chips(soon, 'low') + '</div>' : '<div class="muted">No batches nearing expiry ✓</div>') +
      '</div>';
  }

  function renderAlerts(alerts, expiryAlerts) {
    const groups = [
      { type: 'Raw Material', page: 'raw', icon: '🧪' },
      { type: 'Packaging', page: 'pack', icon: '📦' },
      { type: 'Finished Goods', page: 'fg', icon: '✅' }
    ];
    document.getElementById('alerts-wrap').innerHTML = renderExpiryAlertCard(expiryAlerts) + groups.map(function (g) {
      const items = alerts.filter(function (a) { return a.type === g.type; });
      const out = items.filter(function (a) { return a.status === 'Out of Stock'; });
      const low = items.filter(function (a) { return a.status === 'Low Stock'; });
      const cls = out.length ? 'alert-out' : (low.length ? 'alert-low' : 'alert-ok');
      const chips = function (list, c) {
        return list.slice(0, 6).map(function (a) { return '<span class="chip ' + c + '" title="Current ' + esc(a.current) + ' · Min ' + esc(a.threshold) + '">' + esc(a.name) + '</span>'; }).join('') +
          (list.length > 6 ? '<span class="chip more">+' + (list.length - 6) + ' more</span>' : '');
      };
      return '<div class="alert-card ' + cls + '">' +
        '<div class="alert-head"><span>' + g.icon + ' ' + esc(g.type) + '</span>' +
        '<button class="icon-btn view" onclick="switchPage(\'' + g.page + '\')">Open →</button></div>' +
        '<div class="alert-counts"><div><b class="c-out">' + out.length + '</b><span>Out of Stock</span></div><div><b class="c-low">' + low.length + '</b><span>Low Stock</span></div></div>' +
        (items.length ? '<div class="chip-wrap">' + chips(out, 'out') + chips(low, 'low') + '</div>' : '<div class="muted">All items above threshold ✓</div>') +
        '</div>';
    }).join('');
  }

  function renderDispatch(d) {
    document.getElementById('dispatch-month-label').innerText = d.monthLabel + ' · channel-wise';
    const m = d.month, a = d.allTime;
    document.getElementById('dispatch-kpi-row').innerHTML =
      '<div class="kpi-card blue"><div class="kpi-label">Out (Dispatched) — ' + esc(d.monthLabel) + '</div><div class="kpi-value">' + m.out + ' <span class="kpi-unit">units</span></div><div class="muted">Sale value ' + rupee0(m.outValueSelling) + ' · cost ' + rupee0(m.outValueCost) + '</div></div>' +
      '<div class="kpi-card orange"><div class="kpi-label">RTO – Damage</div><div class="kpi-value">' + m.damage + ' <span class="kpi-unit">units</span></div><div class="muted">Loss at cost ' + rupee0(m.damageValueCost) + '</div></div>' +
      '<div class="kpi-card green"><div class="kpi-label">RTO – Repackaging</div><div class="kpi-value">' + m.repack + ' <span class="kpi-unit">units</span></div><div class="muted">Added back to stock</div></div>' +
      '<div class="kpi-card red"><div class="kpi-label">All-time Out</div><div class="kpi-value">' + a.out + ' <span class="kpi-unit">units</span></div><div class="muted">Damage ' + a.damage + ' · Repack ' + a.repack + '</div></div>';

    if (!d.byChannel.length) {
      document.getElementById('dispatch-wrap').innerHTML = '<div class="loader">No supervisor entries this month yet.</div>';
      return;
    }
    let html = '<table><tr><th>Channel</th><th>Out (units)</th><th>Sale Value</th><th>RTO – Damage</th><th>RTO – Repack</th><th>Return %</th></tr>';
    d.byChannel.forEach(function (c) {
      const ret = c.out ? ((c.damage + c.repack) / c.out * 100).toFixed(1) : '0.0';
      html += '<tr><td>' + avatar(c.channel) + esc(c.channel) + '</td><td><b>' + c.out + '</b></td><td>' + rupee0(c.outValueSelling) + '</td><td>' + c.damage + '</td><td>' + c.repack + '</td><td>' + ret + '%</td></tr>';
    });
    document.getElementById('dispatch-wrap').innerHTML = html + '</table>';
  }

  /* ---- Price Change History (button in the Admin Panel) ---- */
  let PRICE_HISTORY = [];
  let PH_ALL = false;

  function openPriceHistory() {
    document.getElementById('ph-search').value = '';
    document.getElementById('ph-type').innerHTML = '<option value="">All items</option>';
    document.getElementById('ph-count').innerText = '';
    document.getElementById('ph-table').innerHTML = '<div class="loader">Loading price history…</div>';
    PRICE_HISTORY = []; PH_ALL = false;
    openModal('modal-price-history');
    google.script.run.withSuccessHandler(function (res) {
      PRICE_HISTORY = res.rows || [];
      const items = [];
      PRICE_HISTORY.forEach(function (r) { if (items.indexOf(r.item) === -1) items.push(r.item); });
      document.getElementById('ph-type').innerHTML = '<option value="">All items (' + PRICE_HISTORY.length + ')</option>' +
        items.sort().map(function (i) { return '<option value="' + esc(i) + '">' + esc(i) + '</option>'; }).join('');
      renderPriceHistoryTable();
    }).withFailureHandler(function (e) { document.getElementById('ph-table').innerHTML = '<div class="margin-bad">' + esc(e.message || String(e)) + '</div>'; }).getPriceHistory(1000);
  }

  function phToggleAll() { PH_ALL = !PH_ALL; renderPriceHistoryTable(); }

  function renderPriceHistoryTable() {
    const q = (document.getElementById('ph-search').value || '').toLowerCase();
    const item = document.getElementById('ph-type').value;
    const usePeriod = PERIOD && !PH_ALL;
    const rows = PRICE_HISTORY.filter(function (r) {
      if (usePeriod && !inPeriod(r.ts)) return false;
      if (item && r.item !== item) return false;
      return (String(r.item) + ' ' + String(r.field) + ' ' + String(r.user) + ' ' + String(r.itemType)).toLowerCase().indexOf(q) !== -1;
    });
    document.getElementById('ph-count').innerHTML = rows.length + ' of ' + PRICE_HISTORY.length + ' changes' +
      (PERIOD ? ' <span class="pb-active">' + (usePeriod ? fmtISO(PERIOD.from) + ' \u2192 ' + fmtISO(PERIOD.to) : 'all dates') + '</span>' +
                '<button class="btn-outline pb-clear" onclick="phToggleAll()">' + (usePeriod ? 'Show all dates' : 'Use date filter') + '</button>' : '');
    let html = '<table><tr><th>Date &amp; Time</th><th>Item</th><th>Type</th><th>Field</th><th>Old Rate</th><th>New Rate</th><th>Change</th><th>Changed By</th></tr>';
    if (!rows.length) html += '<tr><td colspan="8" class="muted">No price changes recorded yet.</td></tr>';
    rows.forEach(function (r) {
      const diff = Number(r.newValue) - Number(r.oldValue);
      const arrow = diff > 0 ? '<span class="margin-bad">&#9650; ' + rupee(Math.abs(diff)) + '</span>'
                  : (diff < 0 ? '<span class="margin-good">&#9660; ' + rupee(Math.abs(diff)) + '</span>' : '<span class="muted">-</span>');
      html += '<tr><td class="nowrap">' + fmtDate(r.ts) + '</td><td><b>' + esc(r.item) + '</b></td><td class="muted">' + esc(r.itemType) + '</td><td>' + esc(r.field) +
        '</td><td class="muted">' + rupee(r.oldValue) + '</td><td><b>' + rupee(r.newValue) + '</b></td><td>' + arrow + '</td><td class="muted">' + esc(r.user || '') + '</td></tr>';
    });
    document.getElementById('ph-table').innerHTML = html + '</table>';
    updateResetButtons();
  }

  function exportPriceHistoryCSV() {
    if (!PRICE_HISTORY.length) return alert('No data to export.');
    downloadCSV('Price_Change_History.csv', toCSV(PRICE_HISTORY.map(function (r) {
      return { 'Date': fmtDate(r.ts), 'Item': r.item, 'Type': r.itemType, 'Field': r.field, 'Old Rate': r.oldValue, 'New Rate': r.newValue, 'Changed By': r.user };
    })));
  }

  function renderHomeTiles(data) {
    const el = document.getElementById('admin-tile-grid');
    if (!el) return;


    const tiles = [
      { color: 'blue', number: data.rawMaterial.length, label: 'Raw Materials', page: 'raw', icon: '🧪' },
      { color: 'green', number: data.packaging.length, label: 'Packaging Items', page: 'pack', icon: '📦' },
      { color: 'orange', number: data.finishedGoods.length, label: 'Finished Goods', page: 'fg', icon: '✅' },
      { color: 'purple', number: data.supervisorEntries.length, label: 'Supervisor Entries', page: 'sup', icon: '📝' }
    ];

    el.innerHTML = tiles.map(function (t) {
      return '<div class="tile tile-' + t.color + '" onclick="switchPage(\'' + t.page + '\')">' +
        '<span class="tile-bg-icon">' + t.icon + '</span>' +
        '<div class="tile-number">' + t.number + '</div>' +
        '<div><div class="tile-label">' + t.label + '</div>' +
        '<div class="tile-more">More info →</div></div></div>';
    }).join('');
  }

  const PERM_COLS = [
    { key: 'admin', label: 'Admin Panel' },
    { key: 'entries', label: 'Add Entries' },
    { key: 'edit', label: 'Edit' },
    { key: 'delete', label: 'Delete' },
    { key: 'users', label: 'User Access' }
  ];
  function roleBadge(role) {
    const cls = role === 'Super Admin' ? 'status-in' : (role === 'Admin' ? 'status-nodate' : (role === 'Executive' ? 'status-low' : (role === 'Custom' ? 'status-nodate' : 'status-out')));
    return '<span class="badge ' + cls + '">' + esc(role || 'Viewer') + '</span>';
  }
  function renderUserTable(rows) {
    let html = '<table class="perm-table"><tr><th>Email</th><th>Name</th>' + PERM_COLS.map(function (c) { return '<th class="perm-th">' + c.label + '</th>'; }).join('') + '<th>Access Level</th><th>WhatsApp</th><th>Actions</th></tr>';
    if (!rows.length) html += '<tr><td colspan="10" class="muted">No users yet. Click "Add User" to give someone access.</td></tr>';
    rows.forEach(function (r) {
      const p = r.Perms || {};
      html += '<tr><td>' + esc(r['Email']) + (r.IsOwner ? ' <span class="badge status-in" title="Script owner — always full access">Owner</span>' : '') + (r.HasPasscode ? '' : ' <span class="badge status-low" title="No passcode set — this user cannot sign in yet">no passcode</span>') + '</td><td>' + esc(r['Name'] || '-') + '</td>' +
        PERM_COLS.map(function (c) {
          return '<td class="perm-td"><input type="checkbox" class="perm-chk"' + (p[c.key] ? ' checked' : '') + (r.IsOwner ? ' disabled' : '') + ' onchange="toggleUserPerm(\'' + jsArg(r['Email']) + '\', \'' + c.key + '\', this)" title="' + c.label + '"></td>';
        }).join('') +
        '<td>' + roleBadge(r['Role']) + '</td><td class="muted">' + esc(r['WhatsApp'] || '-') + '</td>' +
        '<td>' + actionRow([{ cls: 'edit', fn: 'editUserRow', arg: r['Email'], label: '✏️ Edit' }, !r.IsOwner && { cls: 'delete', fn: 'deleteUserRow', arg: r['Email'], label: '🗑 Remove' }]) + '</td></tr>';
    });
    document.getElementById('user-table-wrap').innerHTML = html + '</table>';
  }

  function toggleUserPerm(emailAddr, key, chk) {
    const on = chk.checked;
    chk.disabled = true;
    google.script.run.withSuccessHandler(function (res) {
      showMessagePopup((on ? 'Enabled ' : 'Disabled ') + (PERM_COLS.find(function (c) { return c.key === key; }) || {}).label + ' for ' + emailAddr + '.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(function (e) { chk.checked = !on; chk.disabled = false; showError(e); }).toggleUserPerm(emailAddr, key, on);
  }

  function loadUserAccess() {
    if (DASHBOARD_DATA && DASHBOARD_DATA.users) renderUserTable(DASHBOARD_DATA.users); else loadDashboard();
  }

  function setUserPermChecks(p) {
    PERM_COLS.forEach(function (c) { const el = document.getElementById('user-perm-' + c.key); if (el) el.checked = !!(p && p[c.key]); });
  }
  function getUserPermChecks() {
    const p = {}; PERM_COLS.forEach(function (c) { const el = document.getElementById('user-perm-' + c.key); p[c.key] = !!(el && el.checked); }); return p;
  }
  function applyUserPreset(preset) {
    const map = { super: { admin: 1, entries: 1, edit: 1, delete: 1, users: 1 }, admin: { admin: 1, entries: 1, edit: 1 }, executive: { entries: 1 }, viewer: {} };
    setUserPermChecks(map[preset] || {});
  }
  function openUserModal() {
    document.getElementById('user-modal-title').innerText = 'Add User';
    document.getElementById('user-email').value = '';
    document.getElementById('user-email').readOnly = false;
    document.getElementById('user-name').value = '';
    document.getElementById('user-passcode').value = '';
    document.getElementById('user-passcode').disabled = false;
    document.getElementById('user-passcode').placeholder = 'Optional Firebase password (6+ characters); blank for Google/existing login';
    document.getElementById('user-whatsapp').value = '';
    setUserPermChecks({ entries: true });
    openModal('modal-user');
  }

  function editUserRow(emailAddr) {
    const row = (FULL_DATA.users || []).find(function (r) { return r['Email'] === emailAddr; });
    if (!row) return;
    document.getElementById('user-modal-title').innerText = 'Edit User — ' + emailAddr;
    document.getElementById('user-email').value = row['Email'];
    document.getElementById('user-email').readOnly = true;
    document.getElementById('user-name').value = row['Name'] || '';
    document.getElementById('user-passcode').value = '';
    document.getElementById('user-passcode').disabled = true;
    document.getElementById('user-passcode').placeholder = 'Password changes are managed in Firebase Authentication';
    document.getElementById('user-whatsapp').value = row['WhatsApp'] || '';
    setUserPermChecks(row.Perms || {});
    openModal('modal-user');
  }

  function submitUserAccess() {
    const emailAddr = document.getElementById('user-email').value.trim();
    const name = document.getElementById('user-name').value.trim();
    const perms = getUserPermChecks();
    const passcode = document.getElementById('user-passcode').value.trim();
    const whatsapp = document.getElementById('user-whatsapp').value.trim();
    if (!emailAddr || emailAddr.indexOf('@') === -1) return alert('Enter a valid email address');
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-user');
      showMessagePopup('User access saved for ' + emailAddr + '.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).setUserAccess(emailAddr, name, perms, passcode, whatsapp);
  }

  function deleteUserRow(emailAddr) {
    if (!confirm('Remove workspace access for ' + emailAddr + '? Their login will no longer open the dashboard.')) return;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).removeUserAccess(emailAddr);
  }

  function loadAdminPanel() {
    if (DASHBOARD_DATA && DASHBOARD_DATA.admin) { renderAdmin(DASHBOARD_DATA.admin); return; }
    loadDashboard();
  }

  function renderAdmin(data) {
    try {
      ADMIN_DATA = data;
      FULL_DATA.adminCosting = data.costing;
      FULL_DATA.priceHistory = data.priceHistory || [];
      FULL_DATA.users = (DASHBOARD_DATA && DASHBOARD_DATA.users) || data.users || [];
      if (document.getElementById('admin-kpi-row')) {
        renderValuation(data.valuation);
        renderAlerts(data.alerts || [], data.expiryAlerts || []);
        renderCostingTable(data.costing);
        renderDispatch(data.dispatch);
      }
    } catch (err) {
      console.error('Admin panel render failed:', err);
      alert('Admin panel load error: ' + err.message);
    }
  }

  /* ---- Product costing editor ---- */

  function editCosting(productName) {
    const c = FULL_DATA.adminCosting.find(function (r) { return r.product === productName; });
    if (!c) return;
    document.getElementById('costing-modal-title').innerText = '✏️ Edit Costing — ' + productName;

    const field = function (id, label, value, note) {
      return '<div><label class="f-label">' + label + '</label><input type="number" step="0.01" min="0" class="cost-inp" id="' + id + '" value="' + value + '" oninput="recalcCostingLive()">' +
        (note ? '<div class="muted">' + note + '</div>' : '') + '</div>';
    };

    let html = '<div class="f-section" style="border:none;padding-top:0;margin-top:0">Raw material (liquid)</div>' +
      '<div class="rm-helper"><div class="f-grid">' +
      '<div><label class="f-label">Purchase Price (₹)</label><input type="number" step="0.01" min="0" id="ci-buy-price" placeholder="e.g. 2500" value="' + esc(c.rmBuyPrice) + '" oninput="calcRmRate()"></div>' +
      '<div><label class="f-label">Quantity Purchased (ml)</label><input type="number" step="1" min="0" id="ci-buy-ml" placeholder="e.g. 5000 (= 5 litre)" value="' + esc(c.rmBuyMl) + '" oninput="calcRmRate()"></div>' +
      '</div><div class="muted" id="ci-buy-hint">Optional calculator: enter the purchase amount and the quantity received in ml; the rate per ml is calculated automatically.</div></div>' +
      '<div class="f-grid">' +
      field('ci-rm', 'Raw Material Rate (₹ / 1 ml)', c.rmRate, '<span id="ci-rm-note">× 30 ml = ₹' + (c.rmRate * 30).toFixed(2) + ' liquid cost per bottle</span>') +
      field('ci-sell', 'Selling Price (₹ / 1 bottle)', c.sellingPrice, 'Price of one 30 ml bottle') +
      '</div>';

    const specific = c.packItems.filter(function (p) { return !p.common; });
    const common = c.packItems.filter(function (p) { return p.common; });

    html += '<div class="f-section">Product-specific packaging (₹ / pc)</div><div class="f-grid">';
    specific.forEach(function (p, i) { html += field('ci-sp-' + i, p.name, p.rate, ''); });
    html += '</div>';

    html += '<div class="f-section">Common packaging (₹ / pc) <span class="muted">— shared by all products; changing here changes every product</span></div><div class="f-grid">';
    common.forEach(function (p, i) { html += field('ci-cm-' + i, p.name, p.rate, ''); });
    html += '</div>';

    html += '<div class="f-section">Channel selling prices (₹ / bottle) <span class="muted">— leave blank to use the default selling price</span></div><div class="f-grid">';
    (c.channelPrices || []).forEach(function (cp, i) {
      html += '<div><label class="f-label">' + esc(cp.channel) + '</label><input type="number" step="0.01" min="0" class="cost-inp" id="ci-ch-' + i + '" value="' + esc(cp.price) + '" placeholder="Default ₹' + c.sellingPrice + '" oninput="recalcCostingLive()"><div class="muted" id="ci-ch-m-' + i + '"></div></div>';
    });
    html += '</div>';
    html += '<div class="f-hint">Saving creates a Price History entry for each changed rate. Past Supervisor entries keep the prices they were saved with. Sale value in Supervisor entries is auto-filled from the channel price (or default).</div>';

    document.getElementById('costing-modal-body').innerHTML = html;
    document.getElementById('costing-modal-body').dataset.product = productName;
    recalcCostingLive();
    if (c.rmBuyPrice && c.rmBuyMl) {
      document.getElementById('ci-buy-hint').innerHTML = 'Last purchase: ₹' + c.rmBuyPrice + ' for ' + c.rmBuyMl + ' ml = ₹' + (c.rmBuyPrice / c.rmBuyMl).toFixed(4) + ' per ml. Change either value to recalculate the rate.';
    }
    openModal('modal-costing');
  }

  function calcRmRate() {
    const price = Number(document.getElementById('ci-buy-price').value) || 0;
    const ml = Number(document.getElementById('ci-buy-ml').value) || 0;
    const hint = document.getElementById('ci-buy-hint');
    if (price > 0 && ml > 0) {
      const rate = price / ml;
      document.getElementById('ci-rm').value = rate.toFixed(4);
      hint.innerHTML = '₹' + price + ' ÷ ' + ml + ' ml = <b>₹' + rate.toFixed(4) + ' per ml</b> → 1 bottle (30 ml) = <b>₹' + (rate * 30).toFixed(2) + '</b>';
      recalcCostingLive();
    }
  }

  function recalcCostingLive() {
    const c = FULL_DATA.adminCosting.find(function (r) { return r.product === document.getElementById('costing-modal-body').dataset.product; });
    if (!c) return;
    const v = function (id) { const el = document.getElementById(id); return el ? Number(el.value) || 0 : 0; };
    const rm = v('ci-rm') * 30;
    const note = document.getElementById('ci-rm-note');
    if (note) note.innerText = '× 30 ml = ₹' + rm.toFixed(2) + ' liquid cost per bottle';
    let pack = 0;
    const specific = c.packItems.filter(function (p) { return !p.common; });
    const common = c.packItems.filter(function (p) { return p.common; });
    specific.forEach(function (p, i) { pack += v('ci-sp-' + i); });
    common.forEach(function (p, i) { pack += v('ci-cm-' + i); });
    const total = rm + pack, sell = v('ci-sell'), margin = sell - total, pct = sell ? margin / sell * 100 : 0;
    document.getElementById('costing-live').innerHTML =
      'Total cost <b>' + rupee(total) + '</b> · Margin <b class="' + marginClass(pct) + '">' + rupee(margin) + ' (' + pct.toFixed(1) + '%)</b>';
    (c.channelPrices || []).forEach(function (cp, i) {
      const el = document.getElementById('ci-ch-m-' + i); const inp = document.getElementById('ci-ch-' + i);
      if (!el || !inp) return;
      const v = Number(inp.value) || 0;
      el.innerHTML = v ? 'margin <span class="' + marginClass((v - total) / v * 100) + '">' + ((v - total) / v * 100).toFixed(1) + '%</span>' : 'uses default';
    });
  }

  function submitCostingEdit() {
    const productName = document.getElementById('costing-modal-body').dataset.product;
    const c = FULL_DATA.adminCosting.find(function (r) { return r.product === productName; });
    if (!c) return;
    const v = function (id) { return document.getElementById(id).value; };
    const missing = [];
    if (!c.rmItemId) missing.push('Raw Material');
    if (!c.fgItemId) missing.push('Selling Price');
    c.packItems.forEach(function (p) { if (!p.itemId) missing.push(p.name); });
    if (missing.length) return alert('Price rows missing in Price_Master for: ' + missing.join(', ') + '.\nOpen the Apps Script editor and run initializeSystem() once, then reload.');

    const changes = [];
    const buyPrice = v('ci-buy-price'), buyMl = v('ci-buy-ml');
    if (Number(v('ci-rm')) !== c.rmRate || String(buyPrice) !== String(c.rmBuyPrice) || String(buyMl) !== String(c.rmBuyMl)) {
      changes.push({ itemId: c.rmItemId, cost: v('ci-rm'), buyPrice: buyPrice, buyMl: buyMl });
    }
    if (Number(v('ci-sell')) !== c.sellingPrice) changes.push({ itemId: c.fgItemId, selling: v('ci-sell') });
    const specific = c.packItems.filter(function (p) { return !p.common; });
    const common = c.packItems.filter(function (p) { return p.common; });
    specific.forEach(function (p, i) { if (Number(v('ci-sp-' + i)) !== p.rate) changes.push({ itemId: p.itemId, cost: v('ci-sp-' + i) }); });
    common.forEach(function (p, i) { if (Number(v('ci-cm-' + i)) !== p.rate) changes.push({ itemId: p.itemId, cost: v('ci-cm-' + i) }); });
    (c.channelPrices || []).forEach(function (cp, i) {
      const nv = v('ci-ch-' + i);
      if (String(nv) !== String(cp.price)) changes.push({ product: productName, channel: cp.channel, selling: nv });
    });
    if (!changes.length) return alert('Nothing changed.');
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-costing');
      showMessagePopup(res.changed + ' rate(s) updated for ' + productName + '. New rates apply from now; old entries are unchanged.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).updateRates(changes);
  }

  /* ============ RECEIVED STOCK ============ */

  function submitRawReceived() {
    const product = document.getElementById('raw-product').value;
    const qty = document.getElementById('raw-qty').value;
    if (!qty || Number(qty) <= 0) return alert('Enter a valid quantity');
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-raw-received');
      showPopup(res.qty, 'ml', 'Raw material received for ' + product);
      document.getElementById('raw-qty').value = '';
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).addRawMaterialReceived(product, qty);
  }

  function submitPackReceived() {
    const sel = document.getElementById('pack-item');
    const itemId = sel.value;
    const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : itemId;
    const qty = document.getElementById('pack-qty').value;
    if (!qty || Number(qty) <= 0) return alert('Enter a valid quantity');
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-pack-received');
      showPopup(res.qty, 'pcs', 'Packaging received: ' + label);
      document.getElementById('pack-qty').value = '';
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).addPackagingReceived(itemId, qty);
  }

  /* ============ PACKING ============ */

  // Max units that can be packed right now for the selected product (lowest of raw material + each packaging item)
  function packCapacityFor(product) {
    if (!DASHBOARD_DATA) return null;
    const raw = FULL_DATA.raw.find(function (r) { return r['Product Name'] === product; });
    let cap = raw ? Math.floor(num(raw['Current Stock (ml)']) / 30) : 0;
    let limiter = 'raw material (' + (raw ? num(raw['Current Stock (ml)']) : 0) + ' ml)';
    FULL_DATA.pack.forEach(function (p) {
      if (p['Applicable Product'] === 'All' || p['Applicable Product'] === product) {
        const cur = num(p['Current Stock (Pcs)']);
        if (cur < cap) { cap = cur; limiter = p['Item Name'] + ' (' + p['Applicable Product'] + ') — ' + cur + ' pcs'; }
      }
    });
    return { units: Math.max(0, cap), limiter: limiter };
  }

  function updatePackCapacity() {
    const el = document.getElementById('fg-capacity');
    if (!el) return;
    const product = document.getElementById('fg-product').value;
    const qty = Number(document.getElementById('fg-qty').value) || 0;
    const c = packCapacityFor(product);
    if (!c) { el.innerText = ''; return; }
    const over = qty > c.units;
    el.style.borderLeftColor = over ? '#f04438' : (c.units === 0 ? '#f04438' : '#17b26a');
    el.innerHTML = '<b>Maximum possible now: ' + c.units + ' units</b> · limited by ' + esc(c.limiter) +
      (over ? '<br><span class="margin-bad">You entered ' + qty + ' — reduce the quantity or add stock first.</span>' : '');
  }

  /* ---- Batch preview in the packing form ---- */
  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addMonthsISO(iso, months) {
    if (!iso) return '';
    const p = iso.split('-').map(Number); const d = new Date(p[0], p[1] - 1 + months, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(p[2], last));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function productCode(name) { return String(name).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4) || 'PROD'; }
  function shelfLifeMonths() { return (DASHBOARD_DATA && DASHBOARD_DATA.batchSummary && DASHBOARD_DATA.batchSummary.shelfLifeMonths) || 24; }
  function fmtISO(iso) { if (!iso) return '-'; const p = iso.split('-'); const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return p[2] + ' ' + m[Number(p[1]) - 1] + ' ' + p[0]; }

  function periodMonths() { return (DASHBOARD_DATA && DASHBOARD_DATA.batchSummary && DASHBOARD_DATA.batchSummary.periodMonths) || 3; }
  // Mirrors the server rule: the newest MG batch of the product whose Mfg date is less than periodMonths old
  function currentBatchFor(product) {
    const today = todayISO();
    let best = null;
    (FULL_DATA.batches || []).forEach(function (b) {
      if (b.product !== product || b.batchNo.indexOf('OPENING-') === 0 || !b.mfg) return;
      if (addMonthsISO(b.mfg, periodMonths()) <= today) return;
      if (!best || b.mfg > best.mfg) best = b;
    });
    return best;
  }
  function initPackingModal() {
    const sl = document.getElementById('fg-shelf-life'); if (sl) sl.innerText = Math.round(shelfLifeMonths() / 12);
    const pm = document.getElementById('fg-period'); if (pm) pm.innerText = periodMonths();
    const nb = document.getElementById('fg-newbatch'); if (nb) nb.checked = false;
    updatePackBatchPreview();
  }
  function updatePackBatchPreview() {
    const el = document.getElementById('fg-batch-preview'); if (!el) return;
    const product = document.getElementById('fg-product').value;
    const force = document.getElementById('fg-newbatch') && document.getElementById('fg-newbatch').checked;
    const cur = force ? null : currentBatchFor(product);
    const wrap = document.getElementById('fg-newbatch-wrap'); if (wrap) wrap.style.display = currentBatchFor(product) ? 'flex' : 'none';
    if (cur) {
      const closes = addMonthsISO(cur.mfg, periodMonths());
      el.innerHTML = '<div><span class="muted">Adds to current batch</span><b>' + esc(cur.batchNo) + '</b></div>' +
        '<div><span class="muted">Mfg</span><b>' + fmtISO(cur.mfg) + '</b></div>' +
        '<div><span class="muted">Expiry</span><b>' + fmtISO(cur.expiry) + '</b></div>' +
        '<div><span class="muted">Packed so far</span><b>' + cur.packed + ' units</b></div>' +
        '<div><span class="muted">New batch from</span><b>' + fmtISO(closes) + '</b></div>';
      return;
    }
    const mfg = todayISO();
    const base = 'MG-' + productCode(product) + '-' + mfg.slice(2, 4) + mfg.slice(5, 7) + mfg.slice(8, 10);
    let no = base, n = 2;
    while ((FULL_DATA.batches || []).some(function (b) { return b.batchNo === no; })) { no = base + '-' + String(n++).padStart(2, '0'); }
    el.innerHTML = '<div><span class="muted">New batch</span><b>' + esc(no) + '</b></div>' +
      '<div><span class="muted">Mfg</span><b>' + fmtISO(mfg) + '</b></div>' +
      '<div><span class="muted">Expiry</span><b>' + fmtISO(addMonthsISO(mfg, shelfLifeMonths())) + '</b></div>' +
      '<div><span class="muted">Valid for packing until</span><b>' + fmtISO(addMonthsISO(mfg, periodMonths())) + '</b></div>';
  }

  function submitPacking() {
    const product = document.getElementById('fg-product').value;
    const qty = document.getElementById('fg-qty').value;
    if (!qty || Number(qty) <= 0) return alert('Enter a valid quantity');
    const nb = document.getElementById('fg-newbatch');
    const opts = { newBatch: !!(nb && nb.checked) };
    if (opts.newBatch && !confirm('Start a NEW batch for ' + product + ' now? The current batch will be closed for packing and a new Batch No. / Mfg date will be created.')) return;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-fg-packing');
      showPopup(res.qty, 'units', 'Packed: ' + product + ' — ' + (res.newBatch ? 'NEW batch ' : 'Batch ') + res.batchNo + ' · Mfg ' + fmtISO(res.mfg) + ' · Exp ' + fmtISO(res.expiry));
      document.getElementById('fg-qty').value = '';
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).recordPacking(product, qty, opts);
  }

  /* ============ ROW EDIT (Actions button) ============ */

  function editRawRow(productName) {
    const row = FULL_DATA.raw.find(function (r) { return r['Product Name'] === productName; });
    if (!row) return;
    document.getElementById('raw-edit-product').value = productName;
    document.getElementById('raw-edit-opening').value = row['Opening Stock (ml)'];
    document.getElementById('raw-edit-received').value = row['Qty Received (ml)'];
    document.getElementById('raw-edit-consumed').value = row['Consumed (ml)'];
    document.getElementById('raw-edit-threshold').value = row['Min Threshold (Units)'];
    openModal('modal-raw-edit');
  }

  function submitRawEdit() {
    const product = document.getElementById('raw-edit-product').value;
    const opening = document.getElementById('raw-edit-opening').value;
    const received = document.getElementById('raw-edit-received').value;
    const consumed = document.getElementById('raw-edit-consumed').value;
    const threshold = document.getElementById('raw-edit-threshold').value;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-raw-edit');
      showMessagePopup('Raw material row for ' + product + ' updated.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).updateRawMaterialRow(product, opening, threshold, received);
  }

  function editPackRow(itemId) {
    const row = FULL_DATA.pack.find(function (r) { return r['Item ID'] === itemId; });
    if (!row) return;
    document.getElementById('pack-edit-id').value = itemId;
    document.getElementById('pack-edit-name').value = row['Item Name'] + ' (' + row['Applicable Product'] + ')';
    document.getElementById('pack-edit-opening').value = row['Opening Stock (Pcs)'];
    document.getElementById('pack-edit-received').value = row['Qty Received (Pcs)'];
    document.getElementById('pack-edit-consumed').value = row['Consumed (Pcs)'];
    document.getElementById('pack-edit-threshold').value = row['Min Threshold (Pcs)'];
    openModal('modal-pack-edit');
  }

  function submitPackEdit() {
    const itemId = document.getElementById('pack-edit-id').value;
    const opening = document.getElementById('pack-edit-opening').value;
    const received = document.getElementById('pack-edit-received').value;
    const consumed = document.getElementById('pack-edit-consumed').value;
    const threshold = document.getElementById('pack-edit-threshold').value;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-pack-edit');
      showMessagePopup('Packaging row updated.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).updatePackagingRow(itemId, opening, threshold, received);
  }

  function editFGRow(productName) {
    const row = FULL_DATA.fg.find(function (r) { return r['Product Name'] === productName; });
    if (!row) return;
    document.getElementById('fg-edit-product').value = productName;
    document.getElementById('fg-edit-opening').value = row['Opening Stock (Units)'];
    document.getElementById('fg-edit-packed').value = row['Total Packed (Units)'];
    document.getElementById('fg-edit-out').value = row['Total Out (Units)'];
    document.getElementById('fg-edit-damage').value = row['Total Damage (Units)'];
    document.getElementById('fg-edit-repack').value = row['Total Repackaging (Units)'];
    document.getElementById('fg-edit-threshold').value = row['Min Threshold (Units)'];
    openModal('modal-fg-edit');
  }

  function submitFGEdit() {
    const product = document.getElementById('fg-edit-product').value;
    const v = function (id) { return document.getElementById(id).value; };
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-fg-edit');
      showMessagePopup('Finished goods row for ' + product + ' updated.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).updateFinishedGoodsRow(product, v('fg-edit-opening'), v('fg-edit-threshold'));
  }

  /* ============ SUPERVISOR ENTRIES (new / edit / delete) ============ */

  const SUP_HINTS = {
    'TRANSFER': 'Bulk stock sent to the marketplace warehouse. Finished Goods is reduced, but this is NOT a sale — Sale Value stays blank so revenue is not inflated. Make one entry per SKU.',
    'Out': 'Dispatch: the parcel left the warehouse. Finished Goods stock will be reduced by this quantity.',
    'RTO-Pending': 'Parcel came back but has not been opened yet. Nothing changes in stock — it will appear in Pending Returns until someone inspects it and chooses Repackaging or Damage.',
    'RTO-Damage': 'Inspected: product cannot be sold. Logged as loss with a reason. No stock is added back.',
    'RTO-Repackaging': 'Inspected: product is fine. Added back to Finished Goods. Tick the packaging that was replaced — it will be deducted.'
  };

  // Channels that are an internal stock transfer (bulk to a marketplace warehouse), not a sale.
  function isTransferChannel(ch) {
    const list = (DASHBOARD_DATA && DASHBOARD_DATA.transferChannels) || ['Amazon FBA'];
    return list.indexOf(ch) !== -1;
  }
  // Channels whose file gives a line-level id in addition to the order number.
  function hasOrderItemId(ch) { return ch === 'Flipkart' || ch === 'Amazon FBM' || ch === 'Amazon'; }

  function onSupTypeChange() { applySupFormMode(); }
  function onSupChannelChange() { applySupFormMode(); }

  // One place that decides which boxes the form shows, for every channel + entry type combination.
  function applySupFormMode() {
    const typeSel = document.getElementById('sup-type');
    const ch = document.getElementById('sup-channel').value;
    const transfer = isTransferChannel(ch);

    // Amazon FBA is only ever bulk stock going out - lock the entry type to Out.
    Array.prototype.forEach.call(typeSel.options, function (o) { o.disabled = transfer && o.value !== 'Out'; });
    if (transfer && typeSel.value !== 'Out') typeSel.value = 'Out';
    const type = typeSel.value;
    const isRto = type !== 'Out';

    const show = function (id, on, disp) { const el = document.getElementById(id); if (el) el.style.display = on ? (disp || 'block') : 'none'; };
    show('sup-fba-wrap', transfer);
    show('sup-trace-wrap', !transfer, 'grid');
    show('sup-order-item-wrap', !transfer && hasOrderItemId(ch));
    show('sup-return-wrap', !transfer && isRto, 'grid');
    show('sup-damage-wrap', !transfer && type === 'RTO-Damage');
    show('sup-repack-wrap', !transfer && type === 'RTO-Repackaging');
    show('sup-sale-wrap', !transfer && !isRto);   // a return is not a sale, a transfer is not a sale

    // Labels change with the mode
    const ordLbl = document.getElementById('sup-order-label');
    if (ordLbl) ordLbl.innerHTML = transfer ? 'Shipment ID <span class="h2-note">from Manage Shipments</span>' : 'Order ID';
    const ordInp = document.getElementById('sup-order');
    if (ordInp) ordInp.placeholder = transfer ? 'e.g. FBA15M9WHP5N' : (ch === 'Flipkart' ? 'e.g. OD338425533621056100' : (ch.indexOf('Amazon') === 0 ? 'e.g. 408-8053721-7117960' : 'e.g. #1234'));
    const itemInp = document.getElementById('sup-order-item');
    if (itemInp) itemInp.placeholder = ch === 'Flipkart' ? 'e.g. 338425533621056101' : 'e.g. 67541164444962';
    const itemNote = document.querySelector('#sup-order-item-wrap .h2-note');
    if (itemNote) itemNote.innerText = ch === 'Flipkart' ? 'Flipkart line id' : 'Amazon order-item-id';
    const cdn = document.getElementById('sup-chdate-note');
    if (cdn) cdn.innerText = transfer ? 'shipped from our warehouse on' : (isRto ? 'returned on (channel)' : 'dispatched on (channel)');

    document.getElementById('sup-type-hint').innerText = transfer ? SUP_HINTS.TRANSFER : (SUP_HINTS[type] || '');
    updateAutoSale();
    fillSupBatches();
  }

  // Sale value auto-fills from the channel price (or default selling price) × qty; user can still override.
  let SUP_SALE_MANUAL = false;
  function autoSalePrice() {
    const product = document.getElementById('sup-product').value;
    const channel = document.getElementById('sup-channel').value;
    const sp = DASHBOARD_DATA && DASHBOARD_DATA.sellingPrices ? DASHBOARD_DATA.sellingPrices[product] : null;
    if (!sp) return { price: 0, source: '' };
    if (channel && sp.channels && sp.channels[channel] !== undefined) return { price: sp.channels[channel], source: channel + ' price' };
    return { price: sp.default || 0, source: 'default price' };
  }
  function updateAutoSale() {
    const inp = document.getElementById('sup-sale'), hint = document.getElementById('sup-sale-hint');
    if (!inp) return;
    if (isTransferChannel(document.getElementById('sup-channel').value)) { inp.value = ''; if (hint) hint.innerText = ''; return; }
    const qty = Number(document.getElementById('sup-qty').value) || 0;
    const a = autoSalePrice();
    const total = qty * a.price;
    if (!SUP_SALE_MANUAL) inp.value = total ? Number(total.toFixed(2)) : '';
    if (hint) hint.innerText = a.price ? ('Auto: ₹' + a.price + ' (' + a.source + ') × ' + qty + ' = ₹' + total.toFixed(2) + (SUP_SALE_MANUAL ? ' — edited manually' : '')) : 'No selling price set for this product — enter the sale value manually.';
  }
  function onSaleInput() {
    SUP_SALE_MANUAL = document.getElementById('sup-sale').value !== '';
    updateAutoSale();
  }

  /* ---- Batch selection in the supervisor form ---- */
  function batchLabel(b) {
    const st = b.expiryStatus === 'Expired' ? ' · EXPIRED' : (b.expiryStatus === 'Expiring Soon' ? ' · expiring in ' + b.daysToExpiry + ' d' : '');
    return b.batchNo + ' · ' + b.balance + ' left' + (b.expiry ? ' · exp ' + fmtISO(b.expiry) : ' · no expiry date') + st;
  }
  function fillSupBatches(keep) {
    const sel = document.getElementById('sup-batch'); if (!sel) return;
    const product = document.getElementById('sup-product').value;
    const type = document.getElementById('sup-type').value;
    const all = (FULL_DATA.batches || []).filter(function (b) { return b.product === product; });
    const list = type === 'Out' ? all.filter(function (b) { return b.balance > 0; }) : all;
    // FEFO: undated first, then earliest expiry
    list.sort(function (a, b) { return (a.expiry || '0000') < (b.expiry || '0000') ? -1 : 1; });
    const cur = keep !== undefined ? keep : sel.value;
    const auto = type === 'Out' ? 'Auto (earliest expiry first)' : 'Not specified';
    sel.innerHTML = '<option value="">' + auto + '</option>' + list.map(function (b) {
      return '<option value="' + esc(b.batchNo) + '"' + (b.expiryStatus === 'Expired' && type === 'Out' ? ' disabled' : '') + '>' + esc(batchLabel(b)) + '</option>';
    }).join('');
    if (cur && list.some(function (b) { return b.batchNo === cur; })) sel.value = cur; else sel.value = '';
    const note = document.getElementById('sup-batch-note');
    if (note) note.innerText = list.length ? (type === 'Out' ? 'earliest expiry first (FEFO)' : 'batch printed on the returned bottle') : 'no batches for this product yet';
    onSupBatchChange();
  }
  function onSupBatchChange() {
    const hint = document.getElementById('sup-batch-hint'); if (!hint) return;
    const sel = document.getElementById('sup-batch');
    const type = document.getElementById('sup-type').value;
    const qty = Number(document.getElementById('sup-qty').value) || 0;
    const product = document.getElementById('sup-product').value;
    const b = (FULL_DATA.batches || []).find(function (x) { return x.batchNo === sel.value; });
    hint.className = 'muted';
    if (!sel.value) {
      if (type === 'Out') {
        const avail = (FULL_DATA.batches || []).filter(function (x) { return x.product === product && x.balance > 0 && x.expiryStatus !== 'Expired'; })
          .sort(function (a, c) { return (a.expiry || '0000') < (c.expiry || '0000') ? -1 : 1; });
        const pick = avail.find(function (x) { return x.balance >= qty; });
        hint.innerText = !avail.length ? '' : (qty && !pick ? 'No single batch has ' + qty + ' units — split the dispatch by batch.' : 'System will use ' + (pick ? pick.batchNo : avail[0].batchNo) + (pick && pick.expiry ? ' (exp ' + fmtISO(pick.expiry) + ')' : ''));
        if (qty && avail.length && !pick) hint.className = 'muted margin-bad';
      } else hint.innerText = '';
      return;
    }
    if (!b) { hint.innerText = ''; return; }
    if (type === 'Out' && qty > b.balance) { hint.className = 'muted margin-bad'; hint.innerText = 'Only ' + b.balance + ' units left in this batch.'; return; }
    hint.innerText = (b.mfg ? 'Mfg ' + fmtISO(b.mfg) + ' · ' : '') + (b.expiry ? 'Expiry ' + fmtISO(b.expiry) + ' (' + b.daysToExpiry + ' days)' : 'No expiry date set') + ' · balance ' + b.balance + ' units';
  }

  function setRepackChecks(list) {
    document.querySelectorAll('.repack-chk').forEach(function (c) { c.checked = list.indexOf(c.value) !== -1; });
  }
  function getRepackChecks() {
    return Array.prototype.slice.call(document.querySelectorAll('.repack-chk:checked')).map(function (c) { return c.value; });
  }

  function openSupModal() {
    document.getElementById('sup-modal-title').innerText = 'New Supervisor Entry';
    document.getElementById('sup-entry-id').value = '';
    document.getElementById('sup-type').value = 'Out';
    document.getElementById('sup-qty').value = '';
    document.getElementById('sup-order').value = '';
    document.getElementById('sup-sale').value = '';
    document.getElementById('sup-remarks').value = '';
    ['sup-order-item', 'sup-tracking', 'sup-return-id', 'sup-sku', 'sup-chdate', 'sup-fc', 'sup-received'].forEach(function (id) { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('sup-return-type').value = '';
    SUP_SALE_MANUAL = false;
    setRepackChecks(['Corrugated Box']);
    const bsel = document.getElementById('sup-batch'); if (bsel) bsel.value = '';
    onSupTypeChange();
    openModal('modal-sup-entry');
  }

  function editSupEntry(entryId) {
    const row = FULL_DATA.sup.find(function (r) { return r['Entry ID'] === entryId; });
    if (!row) return;
    document.getElementById('sup-modal-title').innerText = 'Edit Entry ' + entryId;
    document.getElementById('sup-entry-id').value = entryId;
    document.getElementById('sup-type').value = row['Entry Type'];
    document.getElementById('sup-product').value = row['Product Name'];
    document.getElementById('sup-qty').value = row['Quantity (Units)'];
    document.getElementById('sup-order').value = row['Order ID'] || '';
    document.getElementById('sup-channel').value = row['Channel'] || '';
    document.getElementById('sup-sale').value = row['Sale Value (₹)'] === undefined ? '' : row['Sale Value (₹)'];
    SUP_SALE_MANUAL = true; // keep the saved value unless the user clears it
    document.getElementById('sup-remarks').value = row['Remarks'] || '';
    document.getElementById('sup-order-item').value = row['Order Item ID'] || '';
    document.getElementById('sup-tracking').value = row['Tracking ID'] || '';
    document.getElementById('sup-return-id').value = row['Return ID'] || '';
    document.getElementById('sup-return-type').value = row['Return Type'] || '';
    document.getElementById('sup-sku').value = row['SKU'] || '';
    document.getElementById('sup-chdate').value = row['Channel Date'] ? String(row['Channel Date']).slice(0, 10) : '';
    ['sup-fc', 'sup-received'].forEach(function (id) { const el = document.getElementById(id); if (el) el.value = ''; });
    setRepackChecks(String(row['Repack Items'] || '').split(',').map(function (s) { return s.trim(); }));
    onSupTypeChange();
    if (row['Damage Reason']) document.getElementById('sup-damage-reason').value = row['Damage Reason'];
    fillSupBatches(row['Batch No'] || '');
    openModal('modal-sup-entry');
  }

  function submitSupervisorEntry() {
    const entryId = document.getElementById('sup-entry-id').value;
    const type = document.getElementById('sup-type').value;
    const product = document.getElementById('sup-product').value;
    const qty = document.getElementById('sup-qty').value;
    const orderId = document.getElementById('sup-order').value.trim();
    const channel = document.getElementById('sup-channel').value;
    let remarks = document.getElementById('sup-remarks').value;
    const transfer = isTransferChannel(channel);
    const saleValue = (type === 'Out' && !transfer) ? document.getElementById('sup-sale').value : '';
    const repack = type === 'RTO-Repackaging' ? getRepackChecks() : [];
    const batchEl = document.getElementById('sup-batch');
    const batchNo = batchEl ? batchEl.value : '';
    const extra = {
      orderItemId: channel === 'Flipkart' ? document.getElementById('sup-order-item').value.trim() : '',
      trackingId: document.getElementById('sup-tracking').value.trim(),
      returnId: type !== 'Out' ? document.getElementById('sup-return-id').value.trim() : '',
      returnType: type !== 'Out' ? document.getElementById('sup-return-type').value : '',
      damageReason: type === 'RTO-Damage' ? document.getElementById('sup-damage-reason').value : '',
      sku: document.getElementById('sup-sku').value.trim(),
      channelDate: document.getElementById('sup-chdate').value
    };
    if (transfer) {
      extra.orderItemId = ''; extra.trackingId = ''; extra.returnId = ''; extra.returnType = ''; extra.damageReason = '';
      const fc = document.getElementById('sup-fc').value.trim();
      const got = document.getElementById('sup-received').value;
      const bits = ['Bulk to ' + channel.replace('Amazon FBA', 'Amazon FC')];
      if (fc) bits.push('FC ' + fc);
      if (got !== '' && Number(got) !== Number(qty)) bits.push('received ' + got + ' of ' + qty);
      else if (got !== '') bits.push('received ' + got);
      remarks = bits.join(' · ') + (remarks ? ' · ' + remarks : '');
    }
    if (!qty || Number(qty) <= 0) return alert('Enter a valid quantity');
    if (type === 'Out' && batchNo) {
      const b = (FULL_DATA.batches || []).find(function (x) { return x.batchNo === batchNo; });
      if (b && Number(qty) > b.balance) return alert('Batch ' + batchNo + ' has only ' + b.balance + ' units left.');
    }
    if (type === 'RTO-Repackaging' && !repack.length && !confirm('No packaging selected for replacement. Only Finished Goods will be added back. Continue?')) return;

    const onOk = function (res) {
      closeModal('modal-sup-entry');
      showPopup(res.qty, 'units', (entryId ? 'Entry ' + entryId + ' updated' : 'Entry ' + res.entryId + ' saved') + ' — ' + type + ' / ' + product + (res.batchNo ? ' · Batch ' + res.batchNo : ''));
      applyDashboard(res.dashboard);
    };
    busy(true);
    if (entryId) {
      google.script.run.withSuccessHandler(onOk).withFailureHandler(showError)
        .updateSupervisorEntry(entryId, type, product, qty, remarks, channel, orderId, repack, saleValue, batchNo, extra);
    } else {
      google.script.run.withSuccessHandler(onOk).withFailureHandler(showError)
        .recordSupervisorEntry(type, product, qty, remarks, channel, orderId, repack, saleValue, batchNo, extra);
    }
  }

  /* ============ PENDING RETURNS (parcels back, not yet inspected) ============ */

  function updatePendingBadge() {
    const n = (FULL_DATA.pendingReturns || []).length;
    const el = document.getElementById('pending-returns-count');
    if (el) { el.innerText = n; el.classList.toggle('hot', n > 0); }
    const b = document.getElementById('btn-pending-returns');
    if (b) b.classList.toggle('attention', n > 0);
  }

  function openPendingReturns() {
    document.getElementById('pr-search').value = '';
    renderPendingReturns();
    openModal('modal-pending-returns');
  }

  function renderPendingReturns() {
    const q = (document.getElementById('pr-search').value || '').toLowerCase();
    const canEdit = DASHBOARD_DATA && DASHBOARD_DATA.canEdit;
    const rows = (FULL_DATA.pendingReturns || []).filter(function (r) {
      const hay = (String(r['Tracking ID'] || '') + ' ' + String(r['Order ID'] || '') + ' ' + String(r['Product Name'] || '') + ' ' + String(r['Channel'] || '') + ' ' + String(r['Return ID'] || '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
    document.getElementById('pr-count').innerText = rows.length + ' parcel(s) waiting';
    let html = '<table class="pr-table"><tr><th>Returned on</th><th>Channel</th><th>Tracking ID</th><th>Order ID</th><th>Product</th><th>Qty</th><th>Return type</th><th>Decision</th></tr>';
    if (!rows.length) html += '<tr><td colspan="8" class="muted">No parcels waiting for inspection. 🎉</td></tr>';
    rows.forEach(function (r) {
      const rt = r['Return Type'] === 'courier_return' ? '<span class="badge status-in">Courier (sealed)</span>' : (r['Return Type'] === 'customer_return' ? '<span class="badge status-low">Customer (opened)</span>' : '<span class="muted">-</span>');
      html += '<tr><td>' + (r['Channel Date'] ? esc(String(r['Channel Date']).slice(0, 10)) + '<div class="muted tiny">listed ' + fmtDate(r['Timestamp']) + '</div>' : fmtDate(r['Timestamp'])) + (r['Source'] === 'Auto' ? ' <span class="src-tag">AUTO</span>' : '') + '</td><td>' + esc(r['Channel'] || '-') + '</td><td class="mono"><b>' + esc(r['Tracking ID'] || '-') + '</b></td><td class="mono">' + esc(r['Order ID'] || '-') +
        '</td><td>' + avatar(r['Product Name']) + esc(r['Product Name']) + (r['SKU'] ? '<div class="muted tiny mono">' + esc(r['SKU']) + '</div>' : '') + (r['Remarks'] ? '<div class="muted tiny">' + esc(r['Remarks']) + '</div>' : '') + '</td><td><b>' + esc(r['Quantity (Units)']) + '</b></td><td>' + rt + '</td><td>' +
        (canEdit ? '<div class="action-icons"><button class="btn-mini ok" onclick="openResolveReturn(\'' + esc(r['Entry ID']) + '\', \'RTO-Repackaging\')">✔ Repackaging</button><button class="btn-mini bad" onclick="openResolveReturn(\'' + esc(r['Entry ID']) + '\', \'RTO-Damage\')">✖ Damage</button></div>' : '<span class="muted">no permission</span>') + '</td></tr>';
    });
    document.getElementById('pending-returns-table').innerHTML = html + '</table>';
  }

  function openResolveReturn(entryId, preset) {
    const row = (FULL_DATA.pendingReturns || []).find(function (r) { return r['Entry ID'] === entryId; }) || FULL_DATA.sup.find(function (r) { return r['Entry ID'] === entryId; });
    if (!row) return;
    document.getElementById('rr-entry-id').value = entryId;
    document.getElementById('rr-title').innerText = 'Inspect returned parcel — ' + entryId;
    document.getElementById('rr-info').innerHTML =
      '<div><span class="muted">Product</span><b>' + esc(row['Product Name']) + ' × ' + esc(row['Quantity (Units)']) + '</b></div>' +
      '<div><span class="muted">Channel / Order</span><b>' + esc(row['Channel'] || '-') + ' · ' + esc(row['Order ID'] || '-') + '</b></div>' +
      '<div><span class="muted">Tracking ID</span><b class="mono">' + esc(row['Tracking ID'] || '-') + '</b></div>' +
      (row['Return Type'] ? '<div><span class="muted">Return type</span><b>' + esc(row['Return Type'] === 'courier_return' ? 'Courier return — never delivered, usually sealed' : 'Customer return — opened by the customer') + '</b></div>' : '') +
      (row['Remarks'] ? '<div><span class="muted">Notes</span><b>' + esc(row['Remarks']) + '</b></div>' : '');
    // default: sealed courier returns are usually fine -> Repackaging pre-selected; customer returns: choose
    const def = preset || (row['Return Type'] === 'courier_return' ? 'RTO-Repackaging' : '');
    document.querySelectorAll('input[name="rr-outcome"]').forEach(function (i) { i.checked = i.value === def; });
    // batch list of this product (any batch, incl. balance 0 - the bottle carries its own batch)
    const sel = document.getElementById('rr-batch');
    const list = (FULL_DATA.batches || []).filter(function (b) { return b.product === row['Product Name']; });
    sel.innerHTML = '<option value="">Not specified</option>' + list.map(function (b) { return '<option value="' + esc(b.batchNo) + '">' + esc(batchLabel(b)) + '</option>'; }).join('');
    sel.value = row['Batch No'] && list.some(function (b) { return b.batchNo === row['Batch No']; }) ? row['Batch No'] : '';
    onRROutcome();
    closeModal('modal-pending-returns');
    openModal('modal-resolve-return');
  }

  function onRROutcome() {
    const v = (document.querySelector('input[name="rr-outcome"]:checked') || {}).value || '';
    document.getElementById('rr-repack-wrap').style.display = v === 'RTO-Repackaging' ? 'block' : 'none';
    document.getElementById('rr-damage-wrap').style.display = v === 'RTO-Damage' ? 'block' : 'none';
    document.getElementById('rr-opt-repack').classList.toggle('sel', v === 'RTO-Repackaging');
    document.getElementById('rr-opt-damage').classList.toggle('sel', v === 'RTO-Damage');
    document.getElementById('rr-confirm').disabled = !v;
    document.getElementById('rr-confirm').innerText = v === 'RTO-Repackaging' ? 'Confirm — add back to stock' : (v === 'RTO-Damage' ? 'Confirm — record as damage' : 'Confirm');
  }

  function submitResolveReturn() {
    const entryId = document.getElementById('rr-entry-id').value;
    const outcome = (document.querySelector('input[name="rr-outcome"]:checked') || {}).value || '';
    if (!outcome) return;
    const reason = outcome === 'RTO-Damage' ? document.getElementById('rr-damage-reason').value : '';
    const items = outcome === 'RTO-Repackaging' ? Array.prototype.slice.call(document.querySelectorAll('.rr-repack-chk:checked')).map(function (c) { return c.value; }) : [];
    const batch = document.getElementById('rr-batch').value;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-resolve-return');
      showPopup(res.qty, 'units', 'Entry ' + res.entryId + ' → ' + (outcome === 'RTO-Damage' ? 'Damage recorded' : 'back to Finished Goods') + (res.batchNo ? ' · Batch ' + res.batchNo : ''));
      applyDashboard(res.dashboard);
      if ((FULL_DATA.pendingReturns || []).length) openPendingReturns();
    }).withFailureHandler(showError).resolvePendingReturn(entryId, outcome, reason, items, batch);
  }

  /* ============ AGENT IMPORT (Admin Panel) ============ */

  let AGENT_STATUS = null;
  function loadAgentStatus() {
    const card = document.getElementById('agent-card'); if (!card) return;
    google.script.run.withSuccessHandler(function (st) { AGENT_STATUS = st; renderAgentCard(); renderAgentLog(); })
      .withFailureHandler(function (e) { card.innerHTML = '<div class="margin-bad">' + esc(e.message || String(e)) + '</div>'; }).getAgentStatus();
  }
  function renderAgentCard() {
    const st = AGENT_STATUS, card = document.getElementById('agent-card'); if (!st || !card) return;
    if(st.live){
      card.innerHTML='<div class="agent-grid"><div><span class="muted">Firebase</span><b class="ok-val">Connected</b></div><div><span class="muted">Dashboard updates</span><b>Live · changes appear automatically</b></div><div><span class="muted">SKU Map rows</span><b>'+st.skuRows+'</b></div></div><p class="muted">Import history is read from Firebase. External order imports and schedules are managed by your import agent.</p>';
      document.querySelectorAll('[onclick="agentToggleTrigger()"], [onclick="agentSyncNow()"]').forEach(function(button){button.disabled=true;button.title='Managed by your external import agent';});return;
    }
    const lr = st.lastResult;
    const sum = function (k) { return lr && lr[k] ? lr[k].done + ' created · ' + lr[k].failed + ' needs review · ' + lr[k].skipped + ' skipped (of ' + lr[k].read + ')' : '—'; };
    card.innerHTML =
      '<div class="agent-grid">' +
      '<div><span class="muted">Firebase</span><b>' + (st.configured ? '<span class="ok-val">Configured</span> · ' + esc(st.urlMasked) + (st.hasSecret ? ' · secret set' : ' · <span class="bad-val">no secret</span>') : '<span class="bad-val">Not configured</span> — add FIREBASE_URL in Script Properties') + '</b></div>' +
      '<div><span class="muted">Automatic sync</span><b>' + (st.triggerInstalled ? '<span class="ok-val">On — ' + esc(st.syncLabel || '') + '</span>' : '<span class="bad-val">Not installed</span> (' + esc(st.syncLabel || '') + ')') + '</b></div>' +
      '<div><span class="muted">Last run</span><b>' + (st.lastSync ? esc(st.lastSync) + (lr && lr.seconds !== undefined ? ' (' + lr.seconds + 's)' : '') : 'never') + (lr && lr.error ? ' · <span class="bad-val">' + esc(lr.error) + '</span>' : '') + '</b></div>' +
      '<div><span class="muted">Orders (OUT)</span><b>' + sum('orders') + '</b></div>' +
      '<div><span class="muted">Returns (RTO)</span><b>' + sum('returns') + '</b></div>' +
      '<div><span class="muted">SKU_Map rows</span><b>' + st.skuRows + (st.skuRows ? '' : ' · <span class="bad-val">fill the SKU_Map tab</span>') + '</b></div>' +
      '</div>';
    const tb = document.getElementById('agent-trigger-btn');
    if (tb) tb.innerText = st.triggerInstalled ? '⏸ Stop automatic sync' : '⏱ Install automatic sync (' + (st.syncLabel || '') + ')';
  }
  function renderAgentLog() {
    const wrap = document.getElementById('agent-log-wrap'); if (!wrap || !AGENT_STATUS) return;
    const f = (document.getElementById('agent-log-filter') || {}).value || '';
    const rows = (AGENT_STATUS.log || []).filter(function (r) { return !f || r['Status'] === f; });
    let html = '<table><tr><th>When</th><th>Kind</th><th>Channel</th><th>Order ID</th><th>SKU</th><th>Product</th><th>Qty</th><th>Status</th><th>Entry</th><th>Message</th><th></th></tr>';
    if (!rows.length) html += '<tr><td colspan="11" class="muted">No imports yet. When the agent writes to Firebase, every record it sends appears here.</td></tr>';
    rows.forEach(function (r) {
      const st = r['Status'];
      const badge = st === 'processed' ? '<span class="badge status-in">processed</span>' : (st === 'needs_review' ? '<span class="badge status-out">needs review</span>' : '<span class="badge status-nodate">' + esc(st) + '</span>');
      html += '<tr><td>' + fmtDate(r['Timestamp']) + '</td><td>' + esc(r['Kind']) + '</td><td>' + esc(r['Channel'] || '-') + '</td><td class="mono">' + esc(r['Order ID'] || '-') + '</td><td class="mono">' + esc(r['SKU'] || '-') + '</td><td>' + esc(r['Product Name'] || '-') + '</td><td>' + esc(r['Quantity']) + '</td><td>' + badge + '</td><td>' + esc(r['Entry ID'] || '-') + '</td><td class="muted">' + esc(r['Message'] || '') + '</td><td>' +
        (st === 'needs_review' && !AGENT_STATUS.live ? '<button class="btn-mini" onclick="agentRetry(\'' + esc(r['Kind']) + '\', \'' + esc(r['Import Key']) + '\')">↻ Retry</button>' : '') + '</td></tr>';
    });
    wrap.innerHTML = html + '</table>';
  }
  function agentTest() {
    busy(true, 'Testing Firebase…');
    google.script.run.withSuccessHandler(function (r) {
      busy(false);
      if(r.live){showErrorPopup('Connected. '+r.collections+' inventory collections contain records. Live dashboard updates are enabled.');return;}
      const fmt = function (c) { return c.total + ' record(s): ' + Object.keys(c.byStatus).map(function (k) { return k + ' ' + c.byStatus[k]; }).join(', '); };
      showErrorPopup('✅ Connected.\n\nOrders → ' + fmt(r.orders) + '\nReturns → ' + fmt(r.returns));
    }).withFailureHandler(showError).testFirebaseConnection();
  }
  function agentSyncNow() {
    busy(true, 'Syncing from Firebase…');
    google.script.run.withSuccessHandler(function (res) {
      AGENT_STATUS = res.status; applyDashboard(res.dashboard); renderAgentCard(); renderAgentLog();
      const s = res.summary || {};
      const line = function (k) { return s[k] ? s[k].done + ' created, ' + s[k].failed + ' need review, ' + s[k].skipped + ' skipped' : '—'; };
      showErrorPopup(s.skipped ? 'Another sync was already running — try again in a minute.' : ('Sync finished in ' + (s.seconds || 0) + 's.\n\nOrders: ' + line('orders') + '\nReturns: ' + line('returns') + (s.error ? '\n\nError: ' + s.error : '')));
    }).withFailureHandler(showError).runAgentSyncNow();
  }
  function agentToggleTrigger() {
    const on = AGENT_STATUS && AGENT_STATUS.triggerInstalled;
    if (on && !confirm('Stop the automatic sync? Records will only be imported when you press Sync now.')) return;
    busy(true);
    const done = function (st) { busy(false); AGENT_STATUS = st; renderAgentCard(); };
    if (on) google.script.run.withSuccessHandler(done).withFailureHandler(showError).removeFirebaseTrigger();
    else google.script.run.withSuccessHandler(done).withFailureHandler(showError).installFirebaseTrigger();
  }
  function agentRetry(kind, key) {
    busy(true, 'Retrying…');
    google.script.run.withSuccessHandler(function (res) {
      AGENT_STATUS = res.status; applyDashboard(res.dashboard); renderAgentCard(); renderAgentLog();
    }).withFailureHandler(showError).retryAgentImport(kind, key);
  }

  function deleteSupEntry(entryId) {
    if (!confirm('Delete entry ' + entryId + '? Its effect on stock (Finished Goods / packaging) will be reversed automatically.')) return;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).deleteSupervisorEntry(entryId);
  }

  /* ============ CHANGE HISTORY ============ */

  let HISTORY_ROWS = [];
  let HISTORY_ALL = false;   // true = ignore the page date filter inside the history popup
  const HISTORY_TITLES = { raw: 'Raw Material — Change History', pack: 'Packaging Material — Change History', fg: 'Finished Goods — Change History', all: 'All Changes' };

  function openHistory(scope) {
    document.getElementById('history-modal-title').innerText = HISTORY_TITLES[scope] || 'Change History';
    document.getElementById('history-search').value = '';
    document.getElementById('history-type').innerHTML = '<option value="">All changes</option>';
    document.getElementById('history-table').innerHTML = '<div class="loader">Loading history…</div>';
    document.getElementById('history-count').innerText = '';
    HISTORY_ROWS = [];
    HISTORY_ALL = false;
    openModal('modal-history');
    google.script.run.withSuccessHandler(function (res) {
      HISTORY_ROWS = res.rows || [];
      const types = [];
      HISTORY_ROWS.forEach(function (r) { if (types.indexOf(r.type) === -1) types.push(r.type); });
      document.getElementById('history-type').innerHTML = '<option value="">All changes (' + HISTORY_ROWS.length + ')</option>' +
        types.sort().map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('');
      renderHistoryTable();
    }).withFailureHandler(function (e) { document.getElementById('history-table').innerHTML = '<div class="margin-bad">' + esc(e.message || String(e)) + '</div>'; }).getChangeHistory(scope, 500);
  }

  function historyTypeBadge(t) {
    let cls = 'status-in';
    if (t.indexOf('Received') === 0 || t.indexOf('Added') !== -1 || t === 'Supervisor: RTO-Repackaging') cls = 'status-in';
    else if (t === 'Packing' || t === 'Batch Updated') cls = 'status-nodate';
    else if (t.indexOf('Correction') === 0 || t.indexOf('Edit') === 0) cls = 'status-low';
    else if (t === 'Supervisor: Out' || t === 'Supervisor: RTO-Damage' || t.indexOf('Deleted') !== -1) cls = 'status-out';
    return '<span class="badge ' + cls + '">' + esc(t) + '</span>';
  }

  function historyToggleAll() { HISTORY_ALL = !HISTORY_ALL; renderHistoryTable(); }

  function renderHistoryTable() {
    const q = (document.getElementById('history-search').value || '').toLowerCase();
    const type = document.getElementById('history-type').value;
    const usePeriod = PERIOD && !HISTORY_ALL;
    const rows = HISTORY_ROWS.filter(function (r) {
      if (usePeriod && !inPeriod(r.ts)) return false;
      if (type && r.type !== type) return false;
      return (String(r.item) + ' ' + String(r.product) + ' ' + String(r.user) + ' ' + String(r.ref || '')).toLowerCase().indexOf(q) !== -1;
    });
    document.getElementById('history-count').innerHTML = rows.length + ' of ' + HISTORY_ROWS.length + ' changes' +
      (PERIOD ? ' <span class="pb-active">' + (usePeriod ? fmtISO(PERIOD.from) + ' \u2192 ' + fmtISO(PERIOD.to) : 'all dates') + '</span>' +
                '<button class="btn-outline pb-clear" onclick="historyToggleAll()">' + (usePeriod ? 'Show all dates' : 'Use date filter') + '</button>' : '');
    let html = '<table><tr><th>Date &amp; Time</th><th>Change</th><th>Item</th><th>Effect</th><th>Reference</th><th>By</th></tr>';
    if (!rows.length) html += '<tr><td colspan="6" class="muted">No changes recorded yet.</td></tr>';
    rows.forEach(function (r) {
      html += '<tr><td class="nowrap">' + fmtDate(r.ts) + '</td><td>' + historyTypeBadge(r.type) + '</td><td>' + esc(r.item) + '</td><td><b>' + esc(r.effect || (r.qty + ' ' + r.unit)) + '</b></td><td class="muted">' + esc(r.ref || '-') + '</td><td class="muted">' + esc(r.user || '') + '</td></tr>';
    });
    document.getElementById('history-table').innerHTML = html + '</table>';
    updateResetButtons();
  }

  function exportHistoryCSV() {
    if (!HISTORY_ROWS.length) return alert('No data to export.');
    downloadCSV('Change_History.csv', toCSV(HISTORY_ROWS.map(function (r) { return { 'Date': fmtDate(r.ts), 'Change': r.type, 'Item': r.item, 'Product': r.product, 'Quantity': r.qty, 'Unit': r.unit, 'Effect': r.effect, 'Reference': r.ref, 'By': r.user }; })));
  }

  /* ============ BATCHES & EXPIRY ============ */

  function expiryBadge(st) {
    const cls = st === 'Expired' ? 'status-out' : (st === 'Expiring Soon' ? 'status-low' : (st === 'No Date' ? 'status-nodate' : 'status-in'));
    return '<span class="badge ' + cls + '">' + esc(st) + '</span>';
  }

  function renderBatchSection(data) {
    const row = document.getElementById('batch-kpi-row');
    const s = data.batchSummary || {};
    if (row) {
      const unassigned = (data.finishedGoods || []).reduce(function (t, r) { return t + num(r['Current Stock (Units)']); }, 0) -
        (data.batches || []).reduce(function (t, b) { return t + b.balance; }, 0);
      row.innerHTML =
        '<div class="kpi-card blue"><div class="kpi-label">Active Batches</div><div class="kpi-value">' + (s.active || 0) + '</div><div class="muted">' + (s.total || 0) + ' batches in total' + (unassigned > 0 ? ' · ' + unassigned + ' units not assigned to a batch' : '') + '</div></div>' +
        '<div class="kpi-card ' + (s.expiringSoon ? 'orange' : 'green') + ' kpi-click" onclick="setBatchFilter(\'Expiring Soon\')"><div class="kpi-label">Expiring within ' + (s.warnDays || 90) + ' days</div><div class="kpi-value">' + (s.expiringSoon || 0) + ' <span class="kpi-unit">batches</span></div><div class="muted">' + (s.expiringUnits || 0) + ' units — dispatch these first</div></div>' +
        '<div class="kpi-card ' + (s.expired ? 'red' : 'green') + ' kpi-click" onclick="setBatchFilter(\'Expired\')"><div class="kpi-label">Expired</div><div class="kpi-value">' + (s.expired || 0) + ' <span class="kpi-unit">batches</span></div><div class="muted">' + (s.expiredUnits || 0) + ' units — blocked from dispatch</div></div>' +
        '<div class="kpi-card ' + (s.noDate ? 'orange' : 'green') + ' kpi-click" onclick="setBatchFilter(\'No Date\')"><div class="kpi-label">No expiry date</div><div class="kpi-value">' + (s.noDate || 0) + ' <span class="kpi-unit">batches</span></div><div class="muted">' + (s.noDateUnits || 0) + ' units — set dates via Edit</div></div>';
    }
    renderBatchTable();
  }
  function setBatchFilter(v) { const el = document.getElementById('batch-status-filter'); if (el) { el.value = v; renderBatchTable(); } }

  function renderBatchTable() {
    const wrap = document.getElementById('batch-table-wrap'); if (!wrap) return;
    const q = (document.getElementById('batch-search').value || '').toLowerCase();
    const prod = document.getElementById('batch-product-filter').value;
    const st = document.getElementById('batch-status-filter').value;
    const isAdmin = DASHBOARD_DATA && DASHBOARD_DATA.canEditRows;
    const isSuper = DASHBOARD_DATA && DASHBOARD_DATA.canDelete;
    const rows = (FULL_DATA.batches || []).filter(function (b) {
      if (prod && b.product !== prod) return false;
      if (st === 'active' && b.balance <= 0) return false;
      if (st && st !== 'active' && b.expiryStatus !== st) return false;
      if (PERIOD && !(b.mfg && b.mfg >= PERIOD.from && b.mfg <= PERIOD.to)) return false;
      return (b.batchNo + ' ' + b.product).toLowerCase().indexOf(q) !== -1;
    }).slice().sort(function (a, b) {
      const ra = a.expiryStatus === 'Expired' ? 0 : (a.expiryStatus === 'Expiring Soon' ? 1 : (a.expiryStatus === 'No Date' ? 2 : 3));
      const rb = b.expiryStatus === 'Expired' ? 0 : (b.expiryStatus === 'Expiring Soon' ? 1 : (b.expiryStatus === 'No Date' ? 2 : 3));
      if (ra !== rb) return ra - rb;
      return (a.expiry || '9999') < (b.expiry || '9999') ? -1 : 1;
    });
    let html = '<table><tr><th>Batch No.</th><th>Product</th><th>Mfg Date</th><th>Expiry Date</th><th>Days Left</th><th>Packed</th><th>Out</th><th>Damage</th><th>Repack</th><th>Balance</th><th>Status</th><th>Actions</th></tr>';
    if (!rows.length) html += '<tr><td colspan="12" class="muted">No batches match. Batches are created automatically when packing is recorded.</td></tr>';
    rows.forEach(function (b) {
      const days = b.daysToExpiry === null ? '-' : (b.daysToExpiry < 0 ? '<span class="margin-bad">' + Math.abs(b.daysToExpiry) + ' d ago</span>' : b.daysToExpiry + ' d');
      const cur = currentBatchFor(b.product);
      const curTag = cur && cur.batchNo === b.batchNo ? ' <span class="badge status-in" title="Packing is currently added to this batch until ' + fmtISO(addMonthsISO(b.mfg, periodMonths())) + '">Current · packing until ' + fmtISO(addMonthsISO(b.mfg, periodMonths())) + '</span>' : '';
      html += '<tr class="' + (b.expiryStatus === 'Expired' ? 'row-out' : (b.expiryStatus === 'Expiring Soon' ? 'row-low' : '')) + '"><td><b>' + esc(b.batchNo) + '</b>' + curTag + (b.notes ? '<div class="muted" title="' + esc(b.notes) + '">' + esc(b.notes).slice(0, 48) + (b.notes.length > 48 ? '…' : '') + '</div>' : '') + '</td><td>' + avatar(b.product) + esc(b.product) +
        '</td><td>' + fmtISO(b.mfg) + '</td><td>' + fmtISO(b.expiry) + '</td><td>' + days + '</td><td>' + b.packed + '</td><td>' + b.out + '</td><td>' + b.damage + '</td><td>' + b.repack +
        '</td><td><b>' + b.balance + '</b></td><td>' + expiryBadge(b.expiryStatus) + '</td>' +
        '<td>' + actionRow([{ cls: 'view', fn: 'openBatchTrace', arg: b.batchNo, label: '🔎 Trace' }, isAdmin && { cls: 'edit', fn: 'editBatch', arg: b.batchNo, label: '✏️ Edit' }]) + '</td></tr>';
    });
    wrap.innerHTML = html + '</table>';
    updateResetButtons();
  }

  function editBatch(batchNo) {
    const b = (FULL_DATA.batches || []).find(function (x) { return x.batchNo === batchNo; }); if (!b) return;
    document.getElementById('batch-edit-no').value = b.batchNo;
    document.getElementById('batch-edit-product').value = b.product;
    document.getElementById('batch-edit-mfg').value = b.mfg || '';
    document.getElementById('batch-edit-exp').value = b.expiry || '';
    document.getElementById('batch-edit-notes').value = b.notes || '';
    openModal('modal-batch-edit');
  }
  function onBatchMfgChange() {
    const mfg = document.getElementById('batch-edit-mfg').value, exp = document.getElementById('batch-edit-exp');
    if (mfg && exp) exp.value = addMonthsISO(mfg, shelfLifeMonths());
  }
  function submitBatchEdit() {
    const no = document.getElementById('batch-edit-no').value;
    const mfg = document.getElementById('batch-edit-mfg').value, exp = document.getElementById('batch-edit-exp').value, notes = document.getElementById('batch-edit-notes').value;
    if (mfg && exp && exp < mfg) return alert('Expiry date cannot be before the manufacturing date.');
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      closeModal('modal-batch-edit');
      showMessagePopup('Batch ' + no + ' updated.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).updateBatchRow(no, mfg, exp, notes);
  }

  function openBatchTrace(batchNo) {
    const inp = document.getElementById('trace-batch');
    if (batchNo) inp.value = batchNo;
    document.getElementById('trace-result').innerHTML = '';
    openModal('modal-batch-trace');
    if (batchNo) runBatchTrace(); else inp.focus();
  }
  function runBatchTrace() {
    const no = document.getElementById('trace-batch').value.trim();
    const out = document.getElementById('trace-result');
    if (!no) return;
    out.innerHTML = '<div class="loader">Tracing ' + esc(no) + '…</div>';
    google.script.run.withSuccessHandler(function (t) {
      const b = t.batch;
      let html = '<div class="trace-head">' +
        '<div><span class="muted">Batch</span><b>' + esc(b.batchNo) + '</b></div><div><span class="muted">Product</span><b>' + esc(b.product) + '</b></div>' +
        '<div><span class="muted">Mfg</span><b>' + fmtISO(b.mfg) + '</b></div><div><span class="muted">Expiry</span><b>' + fmtISO(b.expiry) + '</b> ' + expiryBadge(b.expiryStatus) + '</div>' +
        '<div><span class="muted">Packed</span><b>' + b.packed + '</b></div><div><span class="muted">Out</span><b>' + b.out + '</b></div><div><span class="muted">Damage</span><b>' + b.damage + '</b></div><div><span class="muted">Repack</span><b>' + b.repack + '</b></div><div><span class="muted">Balance</span><b>' + b.balance + '</b></div></div>';
      if (t.packings && t.packings.length) html += '<div class="f-hint">Packing runs in this batch: ' + t.packings.map(function (x) { return fmtDate(x.ts).split(',')[0] + ' — ' + x.qty + ' units'; }).join(' · ') + '</div>';
      html += '<h3 style="margin:14px 0 8px">Movements (' + t.entries.length + ')</h3>';
      if (!t.entries.length) html += '<div class="muted">No dispatch or return entries on this batch yet.</div>';
      else {
        html += '<div class="table-card"><table><tr><th>Date</th><th>Type</th><th>Channel</th><th>Order ID</th><th>Qty</th><th>Remarks</th><th>User</th></tr>';
        t.entries.sort(function (a, c) { return new Date(c.ts) - new Date(a.ts); }).forEach(function (e) {
          html += '<tr><td>' + fmtDate(e.ts) + '</td><td>' + entryTypeBadge(e.type) + '</td><td>' + esc(e.channel || '-') + '</td><td>' + esc(e.orderId || '-') + '</td><td><b>' + e.qty + '</b></td><td>' + esc(e.remarks || '') + (e.repack ? '<div class="muted">Replaced: ' + esc(e.repack) + '</div>' : '') + '</td><td class="muted">' + esc(e.user || '') + '</td></tr>';
        });
        html += '</table></div>';
      }
      out.innerHTML = html;
    }).withFailureHandler(function (e) { out.innerHTML = '<div class="margin-bad">' + esc(e.message || String(e)) + '</div>'; }).getBatchTrace(no);
  }

  /* ============ PACKAGING ITEM CREATE / DELETE ============ */

  function deleteRawRow(productName) {
    const row = FULL_DATA.raw.find(function (r) { return r['Product Name'] === productName; });
    const cur = row ? num(row['Current Stock (ml)']) : 0;
    if (!confirm('Delete the raw material row for "' + productName + '"?' + (cur ? '\n\nIt still has ' + cur + ' ml in stock.' : '') + '\n\nPacking for this product will not be possible until the row is re-created (Admin: run initializeSystem or use Add Stock). The deletion is recorded in the Change History.')) return;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      showMessagePopup('Raw material row for ' + productName + ' deleted.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).deleteRawMaterialRow(productName);
  }

  function deleteFGRow(productName) {
    const row = FULL_DATA.fg.find(function (r) { return r['Product Name'] === productName; });
    const cur = row ? num(row['Current Stock (Units)']) : 0;
    if (!confirm('Delete the Finished Goods row for "' + productName + '"?' + (cur ? '\n\nIt still has ' + cur + ' units in stock.' : '') + '\n\nThe row is re-created automatically at the next Record Packing. The deletion is recorded in the Change History.')) return;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      showMessagePopup('Finished goods row for ' + productName + ' deleted.');
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).deleteFinishedGoodsRow(productName);
  }

  function deletePackItem(itemId) {
    if (!confirm('Delete this packaging item permanently? This cannot be undone.')) return;
    busy(true);
    google.script.run.withSuccessHandler(function (res) {
      applyDashboard(res.dashboard);
    }).withFailureHandler(showError).deletePackagingItem(itemId);
  }

  function showError(err) {
    busy(false);
    const msg = (err && err.message ? err.message : String(err)) || 'Something went wrong.';
    const at = msg.indexOf('::STOCKSHORT::');
    if (at !== -1) {
      try { showStockShortage(JSON.parse(msg.slice(at + '::STOCKSHORT::'.length)), msg.slice(0, at).split('\n')[0].trim()); return; }
      catch (e) { /* fall back to the plain message */ }
    }
    showErrorPopup(msg);
  }

  /* ---- Clean error popup (replaces the browser alert box) ---- */
  function ensureMsgModal() {
    let ov = document.getElementById('modal-msg');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'modal-msg';
    ov.className = 'modal-overlay';
    ov.innerHTML =
      '<div class="modal-box modal-msg-box">' +
        '<div class="modal-head"><h2 id="msg-modal-title">Message</h2>' +
        '<span class="modal-close" onclick="closeModal(\'modal-msg\')">&times;</span></div>' +
        '<div class="modal-body" id="msg-modal-body"></div>' +
        '<div class="modal-foot" id="msg-modal-foot"><button class="btn-secondary-blue" onclick="closeModal(\'modal-msg\')">OK</button></div>' +
      '</div>';
    document.body.appendChild(ov);
    return ov;
  }

  function showErrorPopup(msg) {
    ensureMsgModal();
    document.getElementById('msg-modal-title').innerHTML = '<span class="msg-ico bad">!</span> Could not save';
    document.getElementById('msg-modal-body').innerHTML = '<div class="msg-text">' + esc(String(msg).replace(/^Error:\s*/, '')) + '</div>';
    document.getElementById('msg-modal-foot').innerHTML = '<button class="btn-secondary-blue" onclick="closeModal(\'modal-msg\')">OK</button>';
    openModal('modal-msg');
  }

  // Stock shortage shown as a table: what is needed, what is there, what is missing
  function showStockShortage(d, summary) {
    ensureMsgModal();
    const rows = d.rows || [];
    const negative = rows.some(function (r) { return Number(r.available) < 0; });
    document.getElementById('msg-modal-title').innerHTML = '<span class="msg-ico bad">!</span> ' + esc(d.title || 'Not enough stock');

    let html = '<div class="short-head">' +
      '<div><span class="muted">Product</span><b>' + esc(d.product || '-') + '</b></div>' +
      '<div><span class="muted">You entered</span><b>' + formatIndianNumber(d.requested) + ' ' + esc(d.unit || 'units') + '</b></div>' +
      '<div><span class="muted">Possible right now</span><b class="' + (d.maxPossible > 0 ? 'ok-val' : 'bad-val') + '">' + formatIndianNumber(d.maxPossible) + ' ' + esc(d.unit || 'units') + '</b></div>' +
      '</div>';

    html += '<div class="table-card short-table"><table><tr><th>Item</th><th>Type</th><th>Needed</th><th>Available</th><th>Short by</th></tr>';
    rows.forEach(function (r) {
      html += '<tr class="row-out"><td><b>' + esc(r.item) + '</b></td><td class="muted">' + esc(r.type || '') + '</td>' +
        '<td>' + formatIndianNumber(r.required) + ' ' + esc(r.unit) + '</td>' +
        '<td class="' + (Number(r.available) < 0 ? 'bad-val' : '') + '">' + formatIndianNumber(r.available) + ' ' + esc(r.unit) + '</td>' +
        '<td class="bad-val"><b>' + formatIndianNumber(r.short) + ' ' + esc(r.unit) + '</b></td></tr>';
    });
    html += '</table></div>';
    html += '<div class="f-hint">Add the missing stock first (Add Stock in Raw Material / Packaging Material), then record this entry again.' +
      (negative ? '<br><b>A negative Available means that item\'s First-Time Opening was never entered</b> — open Packaging Material → Edit and set it.' : '') + '</div>';

    document.getElementById('msg-modal-body').innerHTML = html;
    const canFix = d.maxPossible > 0 && document.getElementById('fg-qty') && document.getElementById('modal-fg-packing');
    document.getElementById('msg-modal-foot').innerHTML =
      (canFix ? '<button class="btn-outline" onclick="useMaxQty(' + Number(d.maxPossible) + ')">Use ' + formatIndianNumber(d.maxPossible) + ' instead</button>' : '') +
      '<button class="btn-secondary-blue" onclick="closeModal(\'modal-msg\')">OK</button>';
    openModal('modal-msg');
  }

  function useMaxQty(n) {
    const el = document.getElementById('fg-qty');
    if (el) { el.value = n; if (typeof updatePackCapacity === 'function') updatePackCapacity(); }
    closeModal('modal-msg');
  }

  // Small "Saving…" indicator so the user knows the server is working
  function busy(on, msg) {
    let el = document.getElementById('busy-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'busy-toast';
      el.className = 'busy-toast';
      document.body.appendChild(el);
    }
    el.innerText = msg || '⏳ Saving… please wait';
    el.style.display = on ? 'block' : 'none';
  }


  /* ============ AI ASSISTANT ============ */

  let CHAT_HISTORY = [];
  let CHAT_PENDING_ACTION = null;

  function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) setTimeout(function () { document.getElementById('chat-input').focus(); }, 50);
  }

  function chatAppend(cls, text) {
    const body = document.getElementById('chat-body');
    const el = document.createElement('div');
    el.className = 'chat-msg ' + cls;
    el.innerText = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  // "You should also know…" — 3 follow-up questions after every answer
  function renderSuggestions(list) {
    document.querySelectorAll('.chat-suggest.followup').forEach(function (e) { e.remove(); });
    if (!list || !list.length) return;
    const body = document.getElementById('chat-body');
    const wrap = document.createElement('div');
    wrap.className = 'chat-suggest followup';
    wrap.innerHTML = '<div class="chat-suggest-title">You should also know</div>' +
      list.map(function (q) { return '<span onclick="askSuggestion(this)">' + esc(q) + '</span>'; }).join('');
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }

  // Proactive alert inside the chat + red badge on the chat button
  function renderChatAlerts() {
    if (!DASHBOARD_DATA) return;
    const out = [], low = [];
    const collect = function (rows, nameKey, label) {
      rows.forEach(function (r) {
        const nm = label ? r[nameKey] + ' (' + r['Applicable Product'] + ')' : r[nameKey];
        if (r['Status'] === 'Out of Stock') out.push(nm); else if (r['Status'] === 'Low Stock') low.push(nm);
      });
    };
    collect(DASHBOARD_DATA.rawMaterial, 'Product Name', false);
    collect(DASHBOARD_DATA.packaging, 'Item Name', true);
    collect(DASHBOARD_DATA.finishedGoods, 'Product Name', false);
    (DASHBOARD_DATA.batches || []).forEach(function (b) {
      if (b.balance <= 0) return;
      if (b.expiryStatus === 'Expired') out.push('Batch ' + b.batchNo + ' EXPIRED (' + b.balance + ' units)');
      else if (b.expiryStatus === 'Expiring Soon') low.push('Batch ' + b.batchNo + ' expires in ' + b.daysToExpiry + ' days');
    });
    const badge = document.getElementById('chat-badge');
    const total = out.length + low.length;
    if (badge) { badge.innerText = total; badge.style.display = total ? 'flex' : 'none'; }
    const slot = document.getElementById('chat-alert-slot');
    if (!slot) return;
    if (!total) { slot.innerHTML = '<div class="chat-msg bot alert-ok">All items are above their minimum threshold.</div>'; return; }
    const cut = function (arr) { return arr.slice(0, 5).join(', ') + (arr.length > 5 ? ' +' + (arr.length - 5) + ' more' : ''); };
    slot.innerHTML = '<div class="chat-msg bot alert-warn"><b>Stock alert</b>' +
      (out.length ? '<div>Out of stock (' + out.length + '): ' + esc(cut(out)) + '</div>' : '') +
      (low.length ? '<div>Low stock (' + low.length + '): ' + esc(cut(low)) + '</div>' : '') +
      '<div class="chat-suggest" style="margin-top:8px"><span onclick="askSuggestion(this)">Which items should be reordered first?</span></div></div>';
  }

  function askSuggestion(el) {
    document.getElementById('chat-input').value = el.innerText;
    sendChat();
  }

  function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    const sug = document.getElementById('chat-suggest'); if (sug) sug.remove();
    input.value = '';
    chatAppend('user', msg);
    CHAT_HISTORY.push({ role: 'user', text: msg });
    const typing = chatAppend('bot typing', 'Thinking…');
    document.getElementById('chat-send').disabled = true;
    google.script.run.withSuccessHandler(function (res) {
      typing.remove();
      document.getElementById('chat-send').disabled = false;
      chatAppend('bot', res.reply || '(no reply)');
      CHAT_HISTORY.push({ role: 'model', text: res.reply || '' });
      if (CHAT_HISTORY.length > 12) CHAT_HISTORY = CHAT_HISTORY.slice(-12);
      if (res.action) renderChatAction(res.action);
      renderSuggestions(res.suggestions);
    }).withFailureHandler(function (err) {
      typing.remove();
      document.getElementById('chat-send').disabled = false;
      chatAppend('err', (err && err.message) ? err.message : String(err));
    }).askAssistant(msg, CHAT_HISTORY.slice(0, -1));
  }

  function describeAction(a) {
    const rows = [];
    const packName = function (id) { const r = FULL_DATA.pack.find(function (p) { return p['Item ID'] === id; }); return r ? r['Item Name'] + ' (' + r['Applicable Product'] + ')' : id; };
    if (a.type === 'received_raw') { rows.push(['Entry', 'Raw material received'], ['Product', a.product], ['Quantity', a.qtyMl + ' ml']); }
    else if (a.type === 'received_pack') { rows.push(['Entry', 'Packaging received'], ['Item', packName(a.itemId)], ['Quantity', a.qtyPcs + ' pcs']); }
    else if (a.type === 'packing') { rows.push(['Entry', 'Record packing'], ['Product', a.product], ['Quantity', a.qty + ' units'], ['Effect', '−' + (a.qty * 30) + ' ml raw material, −' + a.qty + ' of each packaging item, +' + a.qty + ' finished goods']); }
    else if (a.type === 'supervisor') {
      rows.push(['Entry', 'Supervisor: ' + a.entryType], ['Product', a.product], ['Quantity', a.qty + ' units']);
      if (a.channel) rows.push(['Channel', a.channel]);
      if (a.orderId) rows.push(['Order ID', a.orderId]);
      rows.push(['Batch', a.batchNo || (a.entryType === 'Out' ? 'Auto (earliest expiry first)' : 'not specified')]);
      if (a.saleValue) rows.push(['Sale Value', rupee(a.saleValue)]);
      if (a.entryType === 'RTO-Repackaging') rows.push(['Packaging replaced', (a.repackItems || []).join(', ') || 'none']);
      if (a.remarks) rows.push(['Remarks', a.remarks]);
    } else return null;
    return rows;
  }

  function validateAction(a) {
    if (a.type === 'received_raw') return DASHBOARD_DATA.products.indexOf(a.product) !== -1 && a.qtyMl > 0;
    if (a.type === 'received_pack') return !!FULL_DATA.pack.find(function (p) { return p['Item ID'] === a.itemId; }) && a.qtyPcs > 0;
    if (a.type === 'packing') return DASHBOARD_DATA.products.indexOf(a.product) !== -1 && a.qty > 0;
    if (a.type === 'supervisor') return DASHBOARD_DATA.products.indexOf(a.product) !== -1 && a.qty > 0 && ['Out', 'RTO-Damage', 'RTO-Repackaging'].indexOf(a.entryType) !== -1;
    return false;
  }

  function renderChatAction(a) {
    if (!DASHBOARD_DATA || !DASHBOARD_DATA.canEdit) return;
    const rows = describeAction(a);
    if (!rows) return;
    if (!validateAction(a)) { chatAppend('err', 'I could not match that to a valid product or item. Please rephrase with the exact product name and quantity.'); return; }
    CHAT_PENDING_ACTION = a;
    const body = document.getElementById('chat-body');
    const el = document.createElement('div');
    el.className = 'chat-action';
    el.innerHTML = '<div class="ca-title">⚠️ Confirm before saving</div>' +
      rows.map(function (r) { return '<div class="ca-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('') +
      '<div class="ca-btns"><button class="btn-primary-green" onclick="confirmChatAction(this)">✅ Confirm &amp; Save</button><button class="btn-secondary-gray" onclick="cancelChatAction(this)">Cancel</button></div>';
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function cancelChatAction(btn) {
    CHAT_PENDING_ACTION = null;
    btn.closest('.chat-action').remove();
    chatAppend('bot', 'Cancelled. Nothing was saved.');
  }

  function confirmChatAction(btn) {
    const a = CHAT_PENDING_ACTION;
    if (!a) return;
    btn.closest('.chat-action').remove();
    CHAT_PENDING_ACTION = null;
    busy(true);
    const ok = function (res) {
      applyDashboard(res.dashboard);
      chatAppend('bot', '✅ Saved successfully' + (res.entryId ? ' (' + res.entryId + ')' : '') + '. Dashboard updated.');
    };
    const fail = function (err) { busy(false); chatAppend('err', 'Not saved: ' + ((err && err.message) ? err.message : err)); };
    const run = google.script.run.withSuccessHandler(ok).withFailureHandler(fail);
    if (a.type === 'received_raw') run.addRawMaterialReceived(a.product, a.qtyMl);
    else if (a.type === 'received_pack') run.addPackagingReceived(a.itemId, a.qtyPcs);
    else if (a.type === 'packing') run.recordPacking(a.product, a.qty);
    else if (a.type === 'supervisor') run.recordSupervisorEntry(a.entryType, a.product, a.qty, a.remarks || '', a.channel || '', a.orderId || '', a.repackItems || [], a.saleValue === undefined || a.saleValue === null ? '' : a.saleValue, a.batchNo || '');
  }


  /* ============ DASHBOARD (analytics) ============ */

  let ANALYTICS = null;
  const CHARTS = {};
  const PALETTE = ['#006D5B', '#C9A227', '#2e6bff', '#f79009', '#7a5af8', '#0ea5a5', '#d6336c', '#4b5563', '#17b26a', '#f04438', '#8a90a3', '#b45309'];

  function populateDashFilters(data) {
    const ps = document.getElementById('dash-product'), cs = document.getElementById('dash-channel');
    if (ps && ps.options.length <= 1) ps.innerHTML = '<option value="">All products</option>' + data.products.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
    if (cs && cs.options.length <= 1) cs.innerHTML = '<option value="">All channels</option>' + (data.channels || []).map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  }

  function onRangeChange() {
    const r = document.getElementById('dash-range').value;
    document.getElementById('dash-custom').style.display = r === 'custom' ? 'flex' : 'none';
    if (r !== 'custom') loadAnalytics();
  }

  function dashFilters() {
    return {
      range: document.getElementById('dash-range').value,
      from: document.getElementById('dash-from').value,
      to: document.getElementById('dash-to').value,
      product: document.getElementById('dash-product').value,
      channel: document.getElementById('dash-channel').value
    };
  }

  function isDefaultDashFilter(f) { return f.range === 'month' && !f.product && !f.channel; }

  function loadAnalytics() {
    if (!document.getElementById('page-dash')) return;
    const f = dashFilters();
    // Default view ("This month", all products, all channels) ships with the dashboard payload - no server call.
    if (isDefaultDashFilter(f) && DASHBOARD_DATA && DASHBOARD_DATA.analytics) {
      try { ANALYTICS = DASHBOARD_DATA.analytics; renderAnalytics(ANALYTICS); } catch (err) { console.error(err); }
      return;
    }
    document.getElementById('dash-period').innerText = 'Loading…';
    google.script.run.withSuccessHandler(function (a) {
      try { ANALYTICS = a; renderAnalytics(a); }
      catch (err) { console.error(err); alert('Dashboard render error: ' + err.message); }
    }).withFailureHandler(showError).getAnalytics(f);
  }

  function delta(v) {
    if (v === null || v === undefined || isNaN(v)) return '';
    const cls = v > 0 ? 'up' : (v < 0 ? 'down' : 'flat');
    return '<span class="delta ' + cls + '">' + (v > 0 ? '▲ ' : (v < 0 ? '▼ ' : '')) + Math.abs(v).toFixed(1) + '%</span>';
  }
  function kpi(cls, label, value, sub) {
    return '<div class="kpi-card ' + cls + '"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div><div class="kpi-sub">' + (sub || '') + '</div></div>';
  }

  function renderAnalytics(a) {
    const k = a.kpi;
    document.getElementById('dash-period').innerText = 'Period: ' + a.period.from + ' to ' + a.period.to + ' (' + a.period.days + ' days) · compared with the previous ' + a.period.days + ' days';

    document.getElementById('dash-kpi-1').innerHTML =
      kpi('blue', 'Units Dispatched', k.dispatched + ' <span class="kpi-unit">units</span>', delta(k.dispatchedChange) + ' vs previous period') +
      kpi('gold', 'Sale Value', rupee0(k.sale), delta(k.saleChange) + ' vs previous period') +
      kpi('green', 'Units Packed', k.packed + ' <span class="kpi-unit">units</span>', delta(k.packedChange) + ' production') +
      kpi(k.returnPct > 5 ? 'red' : 'orange', 'Returns', k.returns + ' <span class="kpi-unit">units · ' + k.returnPct + '%</span>', delta(k.returnsChange) + ' return rate of dispatched');

    let row2 =
      kpi('slate', 'Finished Goods On Hand', k.fgOnHand + ' <span class="kpi-unit">units</span>', k.daysOfStock === null ? 'no dispatch rate yet' : '≈ ' + k.daysOfStock + ' days of stock at current rate') +
      kpi(k.lowOut ? 'red' : 'green', 'Items Below Threshold', k.lowOut, k.lowOut ? 'see reorder list below' : 'all items healthy') +
      kpi('blue', 'Packing Capacity Now', k.capacity.units + ' <span class="kpi-unit">units</span>', 'limited by ' + esc(k.capacity.limiter));
    const expN = (k.expiredBatches || 0) + (k.expiringBatches || 0);
    row2 += kpi(k.expiredBatches ? 'red' : (k.expiringBatches ? 'orange' : 'green'), 'Batches Expiring / Expired', expN + ' <span class="kpi-unit">batches</span>',
      expN ? ((k.expiredUnits || 0) + (k.expiringUnits || 0)) + ' units · ' + (k.expiredBatches || 0) + ' expired, ' + (k.expiringBatches || 0) + ' expiring soon' : 'no batch nearing expiry');
    row2 += a.isAdmin
      ? kpi('gold', 'Inventory Value · Gross Profit', rupee0(k.inventoryValue), 'gross profit this period ' + rupee0(k.grossProfit))
      : kpi('green', 'Top Channel', a.channels.length ? esc(a.channels[0].channel) : '-', a.channels.length ? a.channels[0].out + ' units · ' + rupee0(a.channels[0].sale) : 'no dispatches');
    document.getElementById('dash-kpi-2').innerHTML = row2;

    updateResetButtons();
    document.getElementById('dash-insights').innerHTML = '<div class="ins-title">Insights</div><ul>' +
      a.insights.map(function (i) { return '<li class="' + i.tone + '">' + esc(i.text) + '</li>'; }).join('') + '</ul>';

    document.getElementById('trend-note').innerText = a.period.weekly ? 'weekly' : 'daily';
    renderProductTable(a);
    renderReorderTable(a);
    renderRecent(a);
    // Charts are the heaviest part - draw them after the page has painted so the UI never freezes
    setTimeout(function () { try { renderCharts(a); } catch (e) { console.error(e); } }, 30);
  }

  function mkChart(id, config) {
    const el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    if (CHARTS[id]) CHARTS[id].destroy();
    const dark = document.body.classList.contains('dark');
    Chart.defaults.color = dark ? '#cfd6e2' : '#5b6178';
    Chart.defaults.borderColor = dark ? '#2a3745' : '#eef0f6';
    Chart.defaults.font.family = "'Poppins', 'Segoe UI', Arial, sans-serif";
    Chart.defaults.font.size = 11;
    config.options = config.options || {};
    config.options.maintainAspectRatio = false;
    config.options.responsive = true;
    config.options.animation = false;
    CHARTS[id] = new Chart(el, config);
  }

  function renderCharts(a) {
    const t = a.trend;
    mkChart('ch-trend', { type: 'bar',
      data: { labels: t.map(function (b) { return b.label; }), datasets: [
        { type: 'bar', label: 'Dispatched (units)', data: t.map(function (b) { return b.out; }), backgroundColor: '#006D5B', borderRadius: 4, yAxisID: 'y' },
        { type: 'bar', label: 'Packed (units)', data: t.map(function (b) { return b.packed; }), backgroundColor: '#8fd3c3', borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Sale value (₹)', data: t.map(function (b) { return b.sale; }), borderColor: '#C9A227', backgroundColor: '#C9A227', tension: 0.3, pointRadius: 2, yAxisID: 'y1' }
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'units' } }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '₹' } } } } });

    const ch = a.channels;
    mkChart('ch-channel', { type: 'doughnut',
      data: { labels: ch.map(function (c) { return c.channel; }), datasets: [{ data: ch.map(function (c) { return c.sale; }), backgroundColor: PALETTE, borderWidth: 0 }] },
      options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: function (c) { const tot = c.dataset.data.reduce(function (s, v) { return s + v; }, 0); return ' ' + c.label + ': ₹' + Math.round(c.raw).toLocaleString('en-IN') + ' (' + (tot ? Math.round(c.raw / tot * 100) : 0) + '%)'; } } } } } });

    const top = a.products.slice(0, 12);
    mkChart('ch-top', { type: 'bar',
      data: { labels: top.map(function (p) { return p.product; }), datasets: [{ label: 'Units dispatched', data: top.map(function (p) { return p.dispatched; }), backgroundColor: '#006D5B', borderRadius: 4 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } } });

    const pv = a.products.slice(0, 12);
    mkChart('ch-pvd', { type: 'bar',
      data: { labels: pv.map(function (p) { return p.product; }), datasets: [
        { label: 'Packed', data: pv.map(function (p) { return p.packed; }), backgroundColor: '#8fd3c3', borderRadius: 4 },
        { label: 'Dispatched', data: pv.map(function (p) { return p.dispatched; }), backgroundColor: '#006D5B', borderRadius: 4 }
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 45, minRotation: 45 } } } } });

    mkChart('ch-returns', { type: 'bar',
      data: { labels: ch.map(function (c) { return c.channel; }), datasets: [
        { label: 'RTO – Damage', data: ch.map(function (c) { return c.damage; }), backgroundColor: '#f04438', borderRadius: 4, stack: 'r' },
        { label: 'RTO – Repackaging', data: ch.map(function (c) { return c.repack; }), backgroundColor: '#f79009', borderRadius: 4, stack: 'r' }
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, stacked: true }, x: { stacked: true } } } });

    const st = a.stockStatus;
    mkChart('ch-status', { type: 'bar',
      data: { labels: ['Raw Material', 'Packaging', 'Finished Goods'], datasets: [
        { label: 'In Stock', data: [st.raw.ok, st.pack.ok, st.fg.ok], backgroundColor: '#17b26a', stack: 's', borderRadius: 3 },
        { label: 'Low Stock', data: [st.raw.low, st.pack.low, st.fg.low], backgroundColor: '#f79009', stack: 's', borderRadius: 3 },
        { label: 'Out of Stock', data: [st.raw.out, st.pack.out, st.fg.out], backgroundColor: '#f04438', stack: 's', borderRadius: 3 }
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, stacked: true, title: { display: true, text: 'items' } }, x: { stacked: true } } } });

    if (a.isAdmin && a.margins && document.getElementById('ch-margin')) {
      const m = a.margins.slice().sort(function (x, y) { return y.marginPct - x.marginPct; });
      mkChart('ch-margin', { type: 'bar',
        data: { labels: m.map(function (x) { return x.product; }), datasets: [{ label: 'Margin %', data: m.map(function (x) { return x.marginPct; }), borderRadius: 4,
          backgroundColor: m.map(function (x) { return x.marginPct < 20 ? '#f04438' : (x.marginPct < 40 ? '#f79009' : '#17b26a'); }) }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { const x = m[c.dataIndex]; return ' ' + x.marginPct + '% (cost ₹' + x.totalCost + ', price ₹' + x.sellingPrice + ')'; } } } }, scales: { x: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } } } } } });
    }
  }

  function daysCell(d) {
    if (d === null || d === undefined) return '<span class="muted">-</span>';
    const cls = d <= 7 ? 'margin-bad' : (d <= 14 ? 'margin-ok' : 'margin-good');
    return '<span class="' + cls + '">' + d + ' days</span>';
  }

  function renderProductTable(a) {
    let html = '<table><tr><th>Product</th><th>Packed</th><th>Dispatched</th><th>Returns</th><th>Return %</th><th>Sale Value</th><th>FG Stock</th><th>Days of Stock</th><th>Can Pack Now</th>' + (a.isAdmin ? '<th>Margin %</th><th>Gross Profit</th>' : '') + '</tr>';
    a.products.forEach(function (r) {
      html += '<tr class="' + rowClass(r.status) + '"><td>' + avatar(r.product) + esc(r.product) + '</td><td>' + r.packed + '</td><td><b>' + r.dispatched + '</b></td><td>' + r.returns + '</td><td class="' + (r.returnPct > 5 ? 'margin-bad' : '') + '">' + r.returnPct + '%</td><td>' + rupee0(r.sale) + '</td><td>' + r.stock + ' ' + badge(r.status || 'Out of Stock') + '</td><td>' + daysCell(r.daysOfStock) + '</td><td>' + r.capacity + '</td>' +
        (a.isAdmin ? '<td class="' + marginClass(r.marginPct || 0) + '">' + (r.marginPct === undefined ? '-' : r.marginPct + '%') + '</td><td>' + (r.profit === undefined ? '-' : rupee0(r.profit)) + '</td>' : '') + '</tr>';
    });
    document.getElementById('dash-products').innerHTML = html + '</table>';
  }

  let REORDER_VIEW = null; // 'Raw Material' | 'Packaging' | null

  function renderReorderTable(a) {
    const groups = [
      { type: 'Raw Material', icon: '🧪', unitNote: 'ml' },
      { type: 'Packaging', icon: '📦', unitNote: 'pcs' }
    ];
    const el = document.getElementById('reorder-summary');
    el.innerHTML = groups.map(function (g) {
      const items = a.reorder.filter(function (r) { return r.type === g.type; });
      const urgent = items.filter(function (r) { return r.daysLeft !== null && r.daysLeft <= 7 || r.status === 'Out of Stock'; });
      const out = items.filter(function (r) { return r.status === 'Out of Stock'; }).length;
      const cls = out || urgent.length ? 'urgent' : (items.length ? 'warn' : '');
      const next = items[0];
      return '<div class="ro-card ' + cls + (REORDER_VIEW === g.type ? ' active' : '') + '" onclick="showReorder(\'' + g.type + '\')">' +
        '<div class="ro-head"><span>' + g.icon + ' ' + g.type + '</span><button class="icon-btn view">' + (REORDER_VIEW === g.type ? 'Hide' : 'View list →') + '</button></div>' +
        '<div class="ro-stats"><div><b class="' + (items.length ? 'c-low' : '') + '">' + items.length + '</b><span>to reorder</span></div>' +
        '<div><b class="' + (urgent.length ? 'c-out' : '') + '">' + urgent.length + '</b><span>urgent (≤ 7 days)</span></div>' +
        '<div><b>' + out + '</b><span>out of stock</span></div></div>' +
        (next ? '<div class="ro-next">Most urgent: <b>' + esc(next.name) + '</b> — ' + esc(next.current) + (next.daysLeft !== null ? ', about ' + next.daysLeft + ' day' + (next.daysLeft === 1 ? '' : 's') + ' left' : '') + '</div>'
              : '<div class="ro-next" style="color:#17b26a">All ' + g.type.toLowerCase() + ' items are sufficiently stocked.</div>') +
        '</div>';
    }).join('');
    if (REORDER_VIEW) showReorder(REORDER_VIEW, true);
  }

  function showReorder(type, keep) {
    if (!keep) REORDER_VIEW = (REORDER_VIEW === type) ? null : type;
    const detail = document.getElementById('reorder-detail');
    if (!REORDER_VIEW || !ANALYTICS) { detail.style.display = 'none'; if (!keep) renderReorderTable(ANALYTICS); return; }
    const items = ANALYTICS.reorder.filter(function (r) { return r.type === REORDER_VIEW; });
    document.getElementById('reorder-detail-title').innerText = REORDER_VIEW + ' — ' + items.length + ' item(s), sorted by urgency';
    let html = '<table><tr><th>Item</th><th>Current Stock</th><th>Min Threshold</th><th>Daily Usage</th><th>Days Left</th><th>Status</th><th>Suggested Order (30 days)</th></tr>';
    if (!items.length) html += '<tr><td colspan="7" class="muted">Nothing to reorder.</td></tr>';
    items.forEach(function (r) {
      html += '<tr class="' + rowClass(r.status) + '"><td>' + avatar(r.name) + esc(r.name) + '</td><td>' + esc(r.current) + '</td><td>' + esc(r.min) + '</td><td class="muted">' + esc(r.daily) + '</td><td>' + daysCell(r.daysLeft) + '</td><td>' + badge(r.status) + '</td><td><b>' + esc(r.suggested) + '</b></td></tr>';
    });
    document.getElementById('dash-reorder').innerHTML = html + '</table>';
    detail.style.display = 'block';
    if (!keep) { renderReorderTable(ANALYTICS); detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }

  function renderRecent(a) {
    if (!a.recent.length) { document.getElementById('dash-recent').innerHTML = '<div class="loader">No activity yet.</div>'; return; }
    let html = '<table><tr><th>When</th><th>Activity</th><th>By</th></tr>';
    a.recent.forEach(function (r) { html += '<tr><td class="act-time">' + fmtDate(r.ts) + '</td><td>' + esc(r.text) + '</td><td class="muted">' + esc(r.user) + '</td></tr>'; });
    document.getElementById('dash-recent').innerHTML = html + '</table>';
  }

  /* ============ POPUP with Indian Number Format + Words ============ */

  function showPopup(qty, unit, context) {
    const digits = formatIndianNumber(qty);
    const words = numberToWordsIndian(qty);
    document.getElementById('popup-message').innerText =
      (context ? context + '\n' : '') + 'Quantity: ' + digits + ' ' + unit + ' (' + words + ' ' + unit + '). Click OK to continue.';
    document.getElementById('popup-overlay').style.display = 'flex';
  }

  function showMessagePopup(msg) {
    document.getElementById('popup-message').innerText = msg + ' Click OK to continue.';
    document.getElementById('popup-overlay').style.display = 'flex';
  }

  function closePopup() {
    document.getElementById('popup-overlay').style.display = 'none';
  }

  // Indian comma format: 1,23,456
  function formatIndianNumber(num) {
    num = Number(num);
    const isNeg = num < 0;
    num = Math.abs(num);
    const parts = num.toString().split('.');
    let intPart = parts[0];
    let lastThree = intPart.substring(intPart.length - 3);
    let other = intPart.substring(0, intPart.length - 3);
    if (other !== '') lastThree = ',' + lastThree;
    const formatted = other.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
    return (isNeg ? '-' : '') + formatted + (parts[1] ? '.' + parts[1] : '');
  }

  // Number to words - Indian system (Thousand, Lakh, Crore)
  function numberToWordsIndian(num) {
    num = Math.round(Number(num));
    if (num === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function twoDigits(n) {
      if (n < 20) return ones[n];
      return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    }
    function threeDigits(n) {
      let str = '';
      if (n >= 100) {
        str += ones[Math.floor(n / 100)] + ' Hundred';
        n %= 100;
        if (n) str += ' ';
      }
      if (n) str += twoDigits(n);
      return str;
    }

    const isNeg = num < 0;
    num = Math.abs(num);

    const crore = Math.floor(num / 10000000); num %= 10000000;
    const lakh = Math.floor(num / 100000); num %= 100000;
    const thousand = Math.floor(num / 1000); num %= 1000;
    const rest = num;

    let words = '';
    if (crore) words += threeDigits(crore) + ' Crore ';
    if (lakh) words += twoDigits(lakh) + ' Lakh ';
    if (thousand) words += twoDigits(thousand) + ' Thousand ';
    if (rest) words += threeDigits(rest);

    return (isNeg ? 'Minus ' : '') + words.trim();
  }

  /* ============ INFO DOTS (field explanations) ============ */
  // Keys: "<container id>|<label>" for context-specific text, or just "<label>". Labels are matched after trimming;
  // KPI labels with a dynamic suffix (" — September 2026") are matched on the part before the dash.
  const TIPS = {
    // ---- common table headers ----
    'Product': 'Name of the product.',
    'Item': 'Packaging item name.',
    'Applicable Product': '"All" = common item used for every product. A product name = item used only for that product (e.g. Outer Box, Label).',
    'Min Threshold': 'Minimum stock level you set. At or below this the status turns Low Stock and it appears in the daily alert.',
    'Status': 'In Stock = above threshold. Low Stock = at or below threshold. Out of Stock = zero.',
    'Last Updated': 'Date and time this row last changed.',
    'Updated By': 'User who made the last change.',
    'Actions': 'Edit (Admin / Super Admin), Delete (Super Admin only), Trace for batches.',
    'Action': 'Edit (Admin / Super Admin) or delete (Super Admin only).',
    // ---- raw material ----
    'First-Time Opening (ml)': 'Liquid on hand on the day the system was started. Entered once and never changed. Daily opening / closing is calculated automatically.',
    'Received (ml)': 'Total liquid received so far through "Add Stock".',
    'Consumed (ml)': 'Liquid used in packing: units packed × 30 ml. Calculated by the system.',
    'Current Stock (ml)': 'Live stock now = First-Time Opening + Received − Consumed.',
    'Current Stock (Units)': 'Current ml ÷ 30 = whole bottles that can still be filled (leftover ml shown separately).',
    // ---- packaging ----
    'First-Time Opening (Pcs)': 'Pieces on hand on the day the system was started. Entered once and never changed.',
    'Last Received (Pcs)': 'The most recent "Add Stock" entry for this item: quantity and date. Every receipt is listed under the Change History button.',
    'Current (Pcs)': 'Live stock now = First-Time Opening + everything received − everything consumed. Current stock is always live, it does not change with the date filter.',
    'Received (Pcs)': 'Pieces received inside the selected date range (Add Stock entries).',
    'Consumed (Pcs)': 'Pieces used: 1 per bottle at packing, plus pieces replaced during RTO-Repackaging.',
    'Current Stock (Pcs)': 'Live stock now = First-Time Opening + Received − Consumed.',
    'pack-table-wrap|Current Stock (Units)': 'Bottles this item can still pack: 1 piece is used per bottle, so units = pieces.',
    'Category': 'Common packaging item used for every product (1 piece per bottle).',
    'pack-table-wrap|Product': 'Product this item belongs to (1 piece per bottle of that product).',
    'Date & Time': 'When the change was made.',
    'Change': 'What kind of change: stock received, packing, supervisor entry, correction, edit, item added / deleted, batch dates.',
    'modal-history|Item': 'Item or product affected. For corrections the old value is shown in brackets.',
    'Effect': 'What happened to the stock: + added, − consumed / dispatched, or the new value that was set.',
    'Reference': 'Channel, order ID and sale value for supervisor entries.',
    // ---- finished goods ----
    'First-Time Opening': 'Ready bottles on hand on the day the system was started. Entered once and never changed.',
    'fg-table-wrap|Packed': 'Bottles produced through "Record Packing".',
    'fg-table-wrap|Out': 'Bottles dispatched (Supervisor "Out" entries).',
    'fg-table-wrap|Damage': 'Bottles returned damaged — loss log, not added back to stock.',
    'Repackaging': 'Bottles returned in good condition and added back to stock after repacking.',
    'fg-table-wrap|Current Stock': 'Bottles ready to dispatch now = First-Time Opening + Packed − Out + Repackaging.',
    // ---- batches ----
    'Batch No.': 'MG-<product code>-<YYMMDD of batch start>. One batch per product stays open for 3 months; all packing in that time joins it. Printed on the label. OPENING-… = stock from before batch tracking started.',
    'Mfg Date': 'Manufacturing date = the day this batch was started (first packing). Changes every 3 months with the new batch.',
    'Expiry Date': 'Manufacturing date + 5 years, calculated automatically. The product must not be dispatched after this date.',
    'Days Left': 'Days until expiry. Negative / "ago" = already expired.',
    'batch-table-wrap|Packed': 'Bottles produced in this batch.',
    'batch-table-wrap|Out': 'Bottles of this batch dispatched so far.',
    'batch-table-wrap|Damage': 'Bottles of this batch returned damaged (loss).',
    'Repack': 'Bottles of this batch returned in good condition and added back.',
    'Balance': 'Bottles of this batch still in stock = Packed − Out + Repack.',
    'batch-table-wrap|Status': 'OK = more than 90 days to expiry. Expiring Soon = within 90 days. Expired = past expiry (dispatch blocked). No Date = opening batch without dates yet.',
    // ---- supervisor entries ----
    'Date': 'Date and time of the entry.',
    'sup-table-wrap|Type': 'Out = dispatch / sale. RTO-Damage = returned damaged (loss). RTO-Repackaging = returned good, added back to stock.',
    'Channel': 'Sales channel the order came from (Amazon, Flipkart, Shopify, …).',
    'Order ID': 'Order number from that channel.',
    'Batch': 'Batch the bottles were taken from (Out) or returned to (RTO). Click to trace the batch.',
    'Qty': 'Number of bottles.',
    'Sale Value': 'Quantity × selling price at the time of entry. Only "Out" entries count as revenue.',
    'Remarks': 'Optional note entered with the entry.',
    'Supervisor': 'User who made the entry.',
    // ---- costing ----
    'RM Rate (₹/ml)': 'Current cost of one ml of raw material (from Edit Costing).',
    'RM Cost / Unit': 'Liquid cost of one bottle = RM Rate × 30 ml.',
    'Packaging Cost / Unit': 'Sum of the rates of every packaging item used for one bottle.',
    'Total Cost / Unit': 'Full cost of one finished bottle = RM Cost + Packaging Cost.',
    'Selling Price': 'Default selling price of one bottle. Channel-specific prices may differ.',
    'Margin': 'Selling Price − Total Cost, in ₹ per bottle.',
    'Margin %': 'Margin ÷ Selling Price × 100. Red < 20 %, amber 20–40 %, green > 40 %.',
    // ---- dispatch summary ----
    'Out (units)': 'Bottles dispatched through this channel this month.',
    'RTO – Damage': 'Bottles returned damaged (loss).',
    'RTO – Repack': 'Bottles returned in good condition and added back to stock.',
    'Return %': '(Damage + Repack) ÷ Out × 100 — the return rate.',
    // ---- price history ----
    'modal-price-history|Item': 'Item whose rate was changed.',
    'modal-price-history|Type': 'Raw Material, Packaging or Finished Good (selling price).',
    'Field': 'Which rate changed: Cost Price, Selling Price or a channel price.',
    'Old Rate': 'Rate before the change.',
    'New Rate': 'Rate after the change. Entries made before the change keep the old rate.',
    'Change': 'Increase (red) or decrease (green) compared with the previous rate.',
    'Old': 'Rate before the change.',
    'New': 'Rate after the change. Existing entries keep the old rate.',
    'Changed By': 'Admin who changed the rate.',
    // ---- users ----
    'Email': 'Google account used to sign in.',
    'Name': 'Display name.',
    'Access Level': 'Label derived from the ticks: all five = Super Admin; Admin Panel + Add Entries + Edit = Admin; only Add Entries = Executive; none = Viewer; anything else = Custom.',
    'Admin Panel': 'Can open the Admin Panel: costing, rates, stock valuation, dispatch summary, price history.',
    'Add Entries': 'Can use Add Stock, Record Packing and Supervisor entries (and confirm AI actions).',
    'user-table-wrap|Edit': 'Can use Edit buttons: rows, supervisor entries, costing rates, batch dates.',
    'user-table-wrap|Delete': 'Can use Delete buttons (rows, packaging items, supervisor entries).',
    'user-table-wrap|User Access': 'Can open this User Access page and change other users\' ticks.',
    'WhatsApp': 'Number that receives the daily WhatsApp alert (optional).',
    // ---- dashboard tables ----
    'dash-products|Packed': 'Bottles produced in the selected period.',
    'Dispatched': 'Bottles dispatched in the selected period.',
    'Returns': 'Bottles returned (damage + repack) in the selected period.',
    'FG Stock': 'Finished bottles available for dispatch right now.',
    'Days of Stock': 'FG Stock ÷ average daily dispatch — how many days the stock will last at the current rate.',
    'Can Pack Now': 'Bottles that can be produced right now from available raw material and packaging.',
    'Gross Profit': 'Sale value − cost of the bottles sold in the period.',
    'reorder-detail|Item': 'Raw material or packaging item.',
    'reorder-detail|Current Stock': 'Stock on hand right now.',
    'Daily Usage': 'Average consumption per day in the selected period.',
    'reorder-detail|Days Left': 'Current stock ÷ daily usage.',
    'Suggested Order (30 days)': 'Quantity to order to cover 30 days at the current usage.',
    'When': 'Date and time of the activity.',
    'Activity': 'What happened (packing, receipt, dispatch, …).',
    'By': 'User who did it.',
    'User': 'User who made the entry.',
    // ---- KPI cards ----
    'Reset Filters': 'Clears the search box, the item / status filters and the date filter of this tab.',
    'Show data for': 'Date filter. Pick a period and the movement columns (Received / Consumed / Packed / Out / Damage / Repackaging) show only that period; Current Stock always stays live. Supervisor entries and batches are filtered by date too.',
    'Products Shown': 'How many rows the current search / filter is showing. All KPI cards follow the filters and the date filter.',
    'Items Shown': 'How many rows the current search / filter is showing. All KPI cards follow the filters and the date filter.',
    'Entries Shown': 'How many entries match the current search, type, channel and date filter.',
    'Stock Health': 'Of the rows shown: how many are In Stock, Low Stock and Out of Stock.',
    'Current Stock': 'Total live stock of the rows currently shown.',
    'Received': 'Total received for the rows shown — inside the selected period when a date filter is on, otherwise since the beginning.',
    'Ready To Dispatch': 'Finished bottles available right now for the products shown.',
    'Packed': 'Units produced for the products shown (period-aware).',
    'Out (Dispatched)': 'Units dispatched in the entries currently shown.',
    'Returns': 'Damaged + repacked units in the current view, and the return rate.',
    'Total Items': 'Number of items tracked in this panel.',
    'In Stock': 'Items above their minimum threshold.',
    'Low Stock': 'Items at or below their minimum threshold.',
    'Out of Stock': 'Items with zero stock.',
    'Out (Dispatched)': 'Bottles dispatched this month, with sale value and cost.',
    'sup-kpi-row|Sale Value': 'Revenue from "Out" entries this month (all-time below).',
    'RTO – Repackaging': 'Bottles returned in good condition and added back to stock.',
    'All-time Out': 'Total bottles dispatched since the system started.',
    'Raw Material Stock Value': 'Current raw material stock × rate per ml.',
    'Packaging Stock Value': 'Current packaging stock × rate per piece.',
    'Finished Goods Stock Value': 'Current finished bottles × total cost per bottle.',
    'Total Inventory Value': 'Raw Material + Packaging + Finished Goods value — money currently held in stock.',
    'Active Batches': 'Batches that still have bottles in stock.',
    'Expiring within': 'Batches with stock that expire within the warning window — dispatch these first.',
    'Expired': 'Batches with stock that are past expiry. Dispatch from them is blocked.',
    'No expiry date': 'Opening batches without manufacturing / expiry dates yet. Admin: set them via Edit.',
    'Units Dispatched': 'Bottles dispatched in the selected period, compared with the previous period of the same length.',
    'dash-kpi-1|Sale Value': 'Revenue from "Out" entries in the selected period.',
    'Units Packed': 'Bottles produced in the selected period.',
    'dash-kpi-1|Returns': 'Bottles returned (damage + repack) and the return rate of dispatched units.',
    'Finished Goods On Hand': 'Bottles ready to dispatch right now, and how many days they will last at the current dispatch rate.',
    'Items Below Threshold': 'Raw material, packaging and finished goods items at or below their minimum threshold.',
    'Packing Capacity Now': 'Bottles that can be produced right now, and which item limits it.',
    'Batches Expiring / Expired': 'Batches with stock that are expired or expire within 90 days.',
    'Inventory Value · Gross Profit': 'Money currently held in stock, and sale value minus cost for the period.',
    'Top Channel': 'Channel with the most dispatched units in the period.',
    // ---- form labels ----
    'Quantity Received (ml)': 'Liquid received now, in ml. It is added to Received.',
    'Min Threshold (Units)': 'Alert level in bottles. At or below this the item shows Low Stock.',
    'Min Threshold (Pcs)': 'Alert level in pieces. At or below this the item shows Low Stock.',
    'Qty Received (ml) · correction only': 'Total received so far. Change only to fix a wrong entry — the correction is logged.',
    'Total Received (Pcs) · correction only': 'Total of every receipt so far. Change only to fix a wrong entry — the correction is logged.',
    'Consumed (ml) · auto': 'Calculated from packing (30 ml per bottle). Cannot be edited.',
    'Consumed (Pcs) · auto': 'Calculated from packing and repackaging. Cannot be edited.',
    'Packaging Item': 'Item received now.',
    'Quantity Received (Pcs)': 'Pieces received now. Added to Received.',
    'Quantity Packed (Units)': 'Bottles filled and packed in this run. Raw material and packaging are deducted automatically.',
    'Manufacturing Date': 'Date this batch was started. Expiry = this date + 5 years.',
    'First-Time Opening (Units)': 'Bottles on hand on the day the system was started. Entered once and never changed.',
    'Total Packed · auto': 'From "Record Packing". Cannot be edited.',
    'Total Out · auto': 'From Supervisor "Out" entries. Cannot be edited.',
    'Total Damage · auto': 'From Supervisor "RTO-Damage" entries. Cannot be edited.',
    'Total Repackaging · auto': 'From Supervisor "RTO-Repackaging" entries. Cannot be edited.',
    'modal-batch-edit|Manufacturing Date': 'Set the packing date of this batch (for opening batches, read it from the label).',
    'modal-batch-edit|Expiry Date': 'Leave blank to set Mfg + 5 years automatically.',
    'Notes': 'Optional note about this batch.',
    'Entry Type': 'Out = parcel left the warehouse (stock −). IN RTO-Pending = parcel came back, not opened yet (no stock change). IN RTO-Repackaging = inspected, fine (stock +). IN RTO-Damage = inspected, damaged (loss).',
    'Order Item ID': 'Flipkart line id (one per product in an order). Links a return to the original dispatch. Read as text — never through Excel.',
    'Tracking ID': 'Courier / AWB number printed on the parcel label. This is how a returned parcel is found in Pending Returns.',
    'Return ID': 'Return number from the channel (Flipkart Return ID). Unique per return — one parcel can never be listed twice.',
    'Return Type': 'Courier return = never reached the customer, usually sealed. Customer return = opened and sent back by the customer.',
    'Shipment ID': 'The Amazon shipment number of a bulk stock transfer (e.g. FBA15M9WHP5N), from Supply chain → Shipments. Used in place of an order number.',
    'Destination FC': 'Which Amazon fulfilment centre the bulk stock went to (e.g. IDX2). Optional — stored in Remarks.',
    'Units received': 'Optional cross-check. If Amazon received fewer units than we sent, the difference is noted in Remarks. Stock is always reduced by the quantity we SENT.',
    'SKU': 'The channel listing code that was sold or returned (e.g. 12-PILEFT-PK1). One product can have several SKUs.',
    'Channel Date': 'The date on the channel: when the courier picked up (Out) or when the return was delivered back (RTO). The entry Date is when it was recorded here.',
    'Damage reason': 'Why the returned product cannot be sold. Shown in reports so losses can be traced.',
    'Pending Returns': 'Parcels that came back but nobody has opened yet. Stock changes only after Repackaging or Damage is chosen.',
    'Decision': 'Open the parcel first. Repackaging = product fine, back to stock. Damage = cannot be sold, recorded as loss.',
    'Source / Manual + Auto': 'Manual = typed by a person. Auto = imported by the channel agent through Firebase.',
    'Agent Import': 'Orders and returns the automation agent placed in Firebase. Processed = entry created. Needs review = could not be posted (unknown SKU, stock short) — fix and press Retry.',
    'modal-sup-entry|Batch No.': 'Batch printed on the bottles. Leave on Auto and the system uses the batch with the earliest expiry (FEFO).',
    'Quantity (Units)': 'Number of bottles in this entry.',
    'modal-sup-entry|Order ID': 'Order number from the sales channel.',
    'modal-sup-entry|Channel': 'Where the order came from. Also decides the selling price used for Sale Value.',
    'Sale Value (₹)': 'Auto = quantity × channel selling price. You can overwrite it. Returns have no sale value.',
    'Packaging replaced (will be deducted)': 'Tick the packaging items you replaced on the returned bottles — they are deducted from packaging stock.',
    'Period': 'Time range for the dashboard figures.',
    'From – To': 'Custom date range.',
    'Purchase Price (₹)': 'Amount paid on the supplier invoice (optional calculator).',
    'Quantity Purchased (ml)': 'ml received for that amount. Rate per ml = price ÷ ml.',
    'Raw Material Rate (₹ / 1 ml)': 'Cost of one ml of liquid. × 30 = liquid cost per bottle.',
    'Selling Price (₹ / 1 bottle)': 'Default price of one 30 ml bottle. Channel prices can override it.'
  };
  const TIP_PREFIXES = ['Out (Dispatched)', 'Expiring within', 'Sale Value'];

  function tipFor(el) {
    let label = '';
    el.childNodes.forEach(function (n) { if (n.nodeType === 3) label += n.textContent; });
    label = label.replace(/\s+/g, ' ').trim();
    const ids = [];
    let n = el.parentElement;
    while (n) { if (n.id) ids.push(n.id); n = n.parentElement; }
    for (let i = 0; i < ids.length; i++) { const t = TIPS[ids[i] + '|' + label]; if (t) return t; }
    if (TIPS[label]) return TIPS[label];
    for (let i = 0; i < TIP_PREFIXES.length; i++) {
      const pfx = TIP_PREFIXES[i];
      if (label.indexOf(pfx) === 0) {
        for (let j = 0; j < ids.length; j++) { const t = TIPS[ids[j] + '|' + pfx]; if (t) return t; }
        if (TIPS[pfx]) return TIPS[pfx];
      }
    }
    return '';
  }

  function addInfoDots(root) {
    (root || document).querySelectorAll('th:not([data-tipped]), .kpi-label:not([data-tipped]), .f-label:not([data-tipped])').forEach(function (el) {
      el.dataset.tipped = '1';
      const tip = tipFor(el);
      if (!tip) return;
      const dot = document.createElement('span');
      dot.className = 'info';
      dot.setAttribute('data-tip', tip);
      dot.setAttribute('aria-label', tip);
      dot.textContent = 'i';
      el.appendChild(dot);
    });
  }

  (function setupInfoDots() {
    let pop = null, timer = null;
    function ensurePop() {
      if (pop) return pop;
      pop = document.createElement('div'); pop.id = 'tip-pop'; document.body.appendChild(pop); return pop;
    }
    function show(dot) {
      const p = ensurePop();
      p.textContent = dot.getAttribute('data-tip');
      p.style.display = 'block';
      const r = dot.getBoundingClientRect();
      const w = Math.min(300, window.innerWidth - 24);
      p.style.maxWidth = w + 'px';
      let left = r.left + r.width / 2 - p.offsetWidth / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - p.offsetWidth - 12));
      let top = r.bottom + 8;
      if (top + p.offsetHeight > window.innerHeight - 8) top = r.top - p.offsetHeight - 8;
      p.style.left = left + 'px'; p.style.top = top + 'px';
    }
    function hide() { if (pop) pop.style.display = 'none'; }
    document.addEventListener('mouseover', function (e) { const d = e.target.closest && e.target.closest('.info'); if (d) show(d); });
    document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('.info')) hide(); });
    document.addEventListener('click', function (e) {
      const d = e.target.closest && e.target.closest('.info');
      if (d) { e.stopPropagation(); e.preventDefault(); if (pop && pop.style.display === 'block' && pop.textContent === d.getAttribute('data-tip')) hide(); else show(d); }
      else hide();
    });
    window.addEventListener('scroll', hide, true);
    document.addEventListener('DOMContentLoaded', function () {
      addInfoDots(document);
      const obs = new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(function () { addInfoDots(document); }, 40); });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  })();
