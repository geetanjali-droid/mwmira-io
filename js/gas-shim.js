/*************************************************************
 * GOOGLE APPS SCRIPT — BROWSER SHIM
 * Lets the original Code.gs (backend.js) run unchanged in the
 * browser by emulating the Apps Script globals it uses, backed by
 * an in-memory "spreadsheet" that is loaded from / saved to Firebase
 * Realtime Database.
 *
 * Storage in RTDB:
 *   /mem_index          = [ sheetName, ... ]
 *   /mem/<sheetName>    = JSON string of that sheet's 2D data (row 0 = headers)
 *************************************************************/

// The owner always gets Super Admin (change if needed — must match config.js in the old build).
const OWNER_EMAIL = "geetanjali.chaurasiya@mushroomworldgroup.com";
window.CURRENT_EMAIL = null;

/* ================= in-memory spreadsheet ================= */
const MEM = { sheets: {} }; // sheets[name] = { name, rows: [[...],[...]] }

function _cloneRow(r) { return (r || []).slice(); }

function _Range(sheet, row, col, numRows, numCols) {
  this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
}
_Range.prototype.getValues = function () {
  const rows = MEM.sheets[this.sheet].rows;
  const out = [];
  for (let r = 0; r < this.numRows; r++) {
    const src = rows[this.row - 1 + r] || [];
    const line = [];
    for (let c = 0; c < this.numCols; c++) { const v = src[this.col - 1 + c]; line.push(v === undefined ? "" : v); }
    out.push(line);
  }
  return out;
};
_Range.prototype.setValues = function (vals) {
  const rows = MEM.sheets[this.sheet].rows;
  for (let r = 0; r < vals.length; r++) {
    const tr = this.row - 1 + r;
    if (!rows[tr]) rows[tr] = [];
    for (let c = 0; c < vals[r].length; c++) rows[tr][this.col - 1 + c] = vals[r][c];
  }
  return this;
};
_Range.prototype.getValue = function () { return this.getValues()[0][0]; };
_Range.prototype.setValue = function (v) { return this.setValues([[v]]); };

function _Sheet(name) { this.name = name; }
_Sheet.prototype._rows = function () { return MEM.sheets[this.name].rows; };
_Sheet.prototype.getName = function () { return this.name; };
_Sheet.prototype.getLastRow = function () { return this._rows().length; };
_Sheet.prototype.getLastColumn = function () {
  const rows = this._rows(); let m = 0;
  rows.forEach(function (r) { if (r && r.length > m) m = r.length; });
  return m;
};
_Sheet.prototype.getRange = function (row, col, numRows, numCols) {
  return new _Range(this.name, row, col, numRows === undefined ? 1 : numRows, numCols === undefined ? 1 : numCols);
};
_Sheet.prototype.getDataRange = function () { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); };
_Sheet.prototype.appendRow = function (arr) { this._rows().push(_cloneRow(arr)); return this; };
_Sheet.prototype.deleteRow = function (rowNum) { this._rows().splice(rowNum - 1, 1); return this; };
_Sheet.prototype.insertColumnsBefore = function (col, num) {
  this._rows().forEach(function (r) { for (let k = 0; k < num; k++) r.splice(col - 1, 0, ""); });
  return this;
};
_Sheet.prototype.setFrozenRows = function () { return this; };
_Sheet.prototype.clear = function () { MEM.sheets[this.name].rows = []; return this; };

const MEM_SS = {
  getId: function () { return "mem"; },
  getUrl: function () { return "(firebase)"; },
  getSheetByName: function (name) { return MEM.sheets[name] ? new _Sheet(name) : null; },
  insertSheet: function (name) { MEM.sheets[name] = { name: name, rows: [] }; return new _Sheet(name); },
  deleteSheet: function (sheet) { const n = sheet && sheet.getName ? sheet.getName() : sheet; delete MEM.sheets[n]; },
  getSheets: function () { return Object.keys(MEM.sheets).map(function (n) { return new _Sheet(n); }); }
};

const SpreadsheetApp = {
  openById: function () { return MEM_SS; },
  getActiveSpreadsheet: function () { return MEM_SS; }
};

/* ================= Session / user ================= */
const Session = {
  getActiveUser: function () { return { getEmail: function () { return window.CURRENT_EMAIL || ""; } }; },
  getEffectiveUser: function () { return { getEmail: function () { return OWNER_EMAIL; } }; },
  getScriptTimeZone: function () { return "Asia/Kolkata"; }
};

/* ================= Utilities ================= */
const _MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function _pad2(n) { return ("0" + n).slice(-2); }
const Utilities = {
  formatDate: function (date, tz, fmt) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    const h24 = d.getHours(), h12 = (h24 % 12) || 12;
    const map = {
      yyyy: String(d.getFullYear()), yy: String(d.getFullYear()).slice(-2),
      MMMM: _MONTHS[d.getMonth()], MMM: _MONTHS[d.getMonth()].slice(0, 3), MM: _pad2(d.getMonth() + 1),
      dd: _pad2(d.getDate()), HH: _pad2(h24), hh: _pad2(h12), mm: _pad2(d.getMinutes()),
      a: h24 < 12 ? "AM" : "PM"
    };
    return String(fmt).replace(/yyyy|yy|MMMM|MMM|MM|dd|HH|hh|mm|a/g, function (t) { return map[t]; });
  },
  // cache helpers (only used inside try/catch in backend) — safe stubs
  newBlob: function (s) { return { getBytes: function () { return []; }, getDataAsString: function () { return String(s); } }; },
  gzip: function (b) { return b; }, ungzip: function (b) { return b; },
  base64Encode: function () { return ""; }, base64Decode: function () { return []; }
};

/* ================= Properties / Cache / Logger ================= */
const _PROPS = { SHEET_ID: "mem" };
const PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return _PROPS[k] === undefined ? null : _PROPS[k]; },
      setProperty: function (k, v) { _PROPS[k] = v; return this; },
      deleteProperty: function (k) { delete _PROPS[k]; return this; }
    };
  }
};
const CacheService = {
  getScriptCache: function () { return { get: function () { return null; }, put: function () {}, remove: function () {} }; }
};
const Logger = { log: function () { try { console.log.apply(console, arguments); } catch (e) {} } };

/* ================= no-op / unsupported services ================= */
const MailApp = { sendEmail: function () { Logger.log("MailApp.sendEmail skipped (browser build)."); } };
const UrlFetchApp = { fetch: function () { throw new Error("Online features (AI assistant / WhatsApp) are not available in this browser build."); } };
const ScriptApp = {
  getProjectTriggers: function () { return []; },
  newTrigger: function () { const noop = { create: function () {} }; return { timeBased: function () { return { atHour: function () { return { everyDays: function () { return noop; } }; }, everyMinutes: function () { return noop; } }; } }; },
  deleteTrigger: function () {}
};
const HtmlService = { createTemplateFromFile: function () { throw new Error("HtmlService not available."); }, createHtmlOutputFromFile: function () { throw new Error("HtmlService not available."); } };
const LockService = {
  getScriptLock: function () { return { waitLock: function () {}, tryLock: function () { return true; }, releaseLock: function () {}, hasLock: function () { return true; } }; },
  getUserLock: function () { return this.getScriptLock(); }
};

/* ================= Firebase load / save (readable structured format) =================
   Each sheet is stored as:
     /data/<SheetName> = { headers: [...], rows: [ { "Header": value, ... }, ... ] }
   Dates are stored as ISO strings so the Firebase console shows clean, readable data. */

// rows (2D array incl. header row) -> { headers, rows:[obj] }
function _toStored(rows) {
  const headers = (rows[0] || []).map(String);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const o = {};
    headers.forEach(function (h, c) {
      let v = r[c];
      if (typeof v === "number" && !Number.isFinite(v)) throw new Error("Invalid number in " + h + "; changes were not saved.");
      if (v instanceof Date) v = v.toISOString();
      o[h] = (v === undefined || v === null) ? "" : v;
    });
    out.push(o);
  }
  return { headers: headers, rows: out };
}
// { headers, rows:[obj] } -> 2D array incl. header row
function _fromStored(s) {
  if (!s || !s.headers) return [];
  const headers = s.headers;
  const rows = [headers.slice()];
  (s.rows || []).forEach(function (o) {
    o = o || {};
    rows.push(headers.map(function (h) { const v = o[h]; return v === undefined || v === null ? "" : v; }));
  });
  return rows;
}

let _storedBaseline = null;
function _canonical(value) {
  if (Array.isArray(value)) return value.map(_canonical);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce(function (out, key) { out[key] = _canonical(value[key]); return out; }, {});
  return value;
}
function _sameStored(a, b) { return JSON.stringify(_canonical(a)) === JSON.stringify(_canonical(b)); }

async function loadMEM() {
  _PROPS.SHEET_ID = "mem";
  const stored = (await DB.ref("data").once("value")).val();
  _storedBaseline = stored;
  MEM.sheets = {};
  delete _PROPS.SUP_COUNTER;
  const names = Object.keys(stored || {});
  if (names.length) {
    for (const n of names) {
      const s = stored[n];
      if (!s || !Array.isArray(s.headers)) throw new Error("Invalid inventory table: " + n);
      MEM.sheets[n] = { name: n, rows: _fromStored(s) };
    }
  } else {
    // First run ever: build all sheets + seed base rows using the original Code.gs logic.
    initializeSystem();
  }
}

async function flushMEM() {
  const next = {};
  Object.keys(MEM.sheets).forEach(function (n) { next[n] = _toStored(MEM.sheets[n].rows); });
  // Firebase omits empty arrays; normalize to its wire representation before comparing.
  Object.values(next).forEach(function (s) { if (!s.rows.length) delete s.rows; });
  if (_sameStored(next, _storedBaseline)) return;
  const baseline = _storedBaseline;
  const result = await DB.ref("data").transaction(function (current) {
    if (!_sameStored(current, baseline)) return;
    return next;
  }, undefined, false);
  if (!result.committed) throw new Error("Inventory changed in another session. Refresh and try again; your changes were not saved.");
  _storedBaseline = next;
}
