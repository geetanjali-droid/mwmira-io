/*************************************************************
 * MEETHI GOLEE INVENTORY SYSTEM
 * Full CRUD Apps Script backend
 * Author: Built for Arpit - Mushroom World Group
 *
 * STOCK FLOW (Option A - BOM / Backflush at Packing):
 *   1. Received      -> Raw Material / Packaging  (+)
 *   2. Packing       -> Raw Material + all BOM Packaging (-), Finished Goods (+)
 *   3. Out (Dispatch)-> Finished Goods (-)
 *   4. RTO-Damage    -> Loss register only (no stock change)
 *   5. RTO-Repack    -> Finished Goods (+), selected replaced Packaging (-)
 *
 * BATCH TRACEABILITY (Finished Goods only):
 *   Packing                -> adds to the product's current batch; a batch stays open for 3 months, then the next
 *                             packing starts a new one: MG-<code>-<YYMMDD>, Mfg = batch start date, Expiry = +5 years
 *   Out / RTO entries      -> booked against a batch (Out = FEFO, expired batches blocked)
 *************************************************************/

/* ================= CONFIG ================= */

const CONFIG = {
  SHEET_TITLE: "Meethi Golee Inventory System",
  CONVERSION_FACTOR: 30, // 1 unit = 30ml

  PRODUCTS: [
    "He Charge", "She Desire", "Migraine Off", "Pileft", "Acnedona",
    "Cervical 7", "Crampmate", "Immune TOT", "Rhinosure",
    "Fungal Clear", "Acid 'O' Rid", "Urincure"
  ],

  // Packaging items common to ALL products
  COMMON_PACKAGING: [
    "Corrugated Box", "Glass Bottle", "Cap", "Stopper", "Dropper", "Cushion", "Instruction Slip"
  ],

  // Packaging item TYPES that are different per product
  PRODUCT_SPECIFIC_PACKAGING: ["Outer Box", "Label"],

  // Sales channels for Supervisor entries
  // "Amazon FBM" = we ship it from our warehouse (per order).  "Amazon FBA" = bulk stock sent to an Amazon
  // fulfilment centre (per shipment, not a sale). FBA customer orders are never entered - that stock left with the bulk shipment.
  CHANNELS: ["Shopify (.com)", "Shopify (.store)", "Amazon FBM", "Amazon FBA", "Flipkart", "Tata 1mg", "Meesho", "Buymore"],
  // Older entries were saved as plain "Amazon". Still accepted on save/edit, but not offered in the dropdown.
  LEGACY_CHANNELS: ["Amazon"],
  // Channels that are internal stock transfers, not sales: no sale value, Out entries only.
  TRANSFER_CHANNELS: ["Amazon FBA"],

  // Packaging items that can be replaced during RTO-Repackaging
  REPACK_ITEMS: ["Corrugated Box", "Outer Box", "Label", "Instruction Slip"],

  // Optional: public URL of a .png/.ico icon for the browser tab & desktop shortcut (leave "" to skip)
  FAVICON_URL: "https://i.ibb.co/yHqBxRQ/Meethi-Golee-Icon.png",

  // Batch / expiry tracking. A batch is created at every Record Packing:
  //   Batch No = BATCH_PREFIX-<product code>-<YYMMDD of batch start>, Mfg = batch start date, Expiry = Mfg + SHELF_LIFE_MONTHS
  BATCH: {
    PREFIX: "MG",
    SHELF_LIFE_MONTHS: 60,       // all products: 5 years from manufacturing
    PERIOD_MONTHS: 3,            // one batch per product stays open for 3 months; the next packing after that starts a new batch (new Batch No + Mfg date)
    EXPIRY_WARN_DAYS: 90,        // "Expiring Soon" when expiry is within this many days
    PRODUCT_CODES: {}            // optional overrides, e.g. { "He Charge": "HC" }; default = first 4 letters
  },

  // Email alerts (sent from the script owner's Gmail)
  ALERTS: {
    ENABLED: true,
    INSTANT: false,             // false = only the daily summary email; true = also email the moment an item drops below threshold
    // alerts go to every user in Admin_Access who has the Admin Panel or Add Entries permission
    DAILY_HOUR: 10,             // daily summary hour (0-23), used by setupDailyAlertTrigger()
    APP_URL: "https://script.google.com/macros/s/AKfycby0tMiy6sfUjnweqQWNS6mFLjx284GcRsKyAAKrS07NLe3uiA-ABWL64_b2IcEa3Tbq/exec" // Web App URL - stays the same across "New version" deploys
  },

  SHEETS: {
    RAW: "Raw_Material_Inventory",
    PACK: "Packaging_Material_Inventory",
    FG: "Finished_Goods_Inventory",
    SUP: "Supervisor_Entries",
    PRICE: "Price_Master",
    HISTORY: "Price_History",
    ACTIVITY: "Activity_Log",
    CHPRICE: "Channel_Prices",
    ADMIN: "Admin_Access",
    BATCH: "Batches",
    IMPORTS: "Agent_Imports",
    SKUMAP: "SKU_Map"
  },

  // Reasons offered when a returned parcel is marked RTO-Damage
  DAMAGE_REASONS: ["Bottle broken", "Seal open / tampered", "Leakage", "Label damaged", "Wrong product returned", "Other"],

  // Channel automation (agent -> Firebase -> this system). Values live in Script Properties:
  //   FIREBASE_URL    e.g. https://meethigolee-default-rtdb.firebaseio.com   (no trailing slash)
  //   FIREBASE_SECRET database secret (Project Settings -> Service accounts -> Database secrets) - optional if rules allow
  AGENT: {
    ORDERS_PATH: "orders",      // curated OUT records written by the agent
    RETURNS_PATH: "returns",    // curated RTO records written by the agent
    SYNC_HOURS: [11, 19],       // daily sync times (24h) - after the agent's 10:00 / 18:00 runs. installFirebaseTrigger()
    SYNC_MINUTES: 0,            // >0 = sync every N minutes instead of fixed hours (1, 5, 10, 15 or 30)
    AGENT_EMAIL: "agent@auto",  // stored in "Supervisor Email" for automatic entries
    MAX_PER_RUN: 200            // records processed per sync run
  }
};

/* ================= HEADERS ================= */

const HEADERS = {
  RAW: ["Item ID", "Product Name", "Opening Stock (ml)", "Qty Received (ml)",
        "Consumed (ml)", "Current Stock (ml)", "Current Stock (Units)",
        "Min Threshold (Units)", "Status", "Last Updated", "Updated By"],

  PACK: ["Item ID", "Item Name", "Applicable Product", "Opening Stock (Pcs)",
         "Qty Received (Pcs)", "Consumed (Pcs)", "Current Stock (Pcs)",
         "Min Threshold (Pcs)", "Status", "Last Updated", "Updated By"],

  FG: ["Item ID", "Product Name", "Opening Stock (Units)", "Total Packed (Units)",
       "Total Out (Units)", "Total Damage (Units)", "Total Repackaging (Units)",
       "Current Stock (Units)", "Min Threshold (Units)", "Status",
       "Last Updated", "Updated By"],

  // Unit Cost / Selling Price are snapshots taken at entry time (price history) - Admin-only.
  // Columns after "Batch No" were added for channel automation (agent import):
  //   Order Item ID (Flipkart line id) · Tracking ID · Return ID · Return Type (courier_return / customer_return)
  //   Damage Reason (RTO-Damage) · Source (Manual / Auto) · Import Key (Firebase record key - duplicate lock)
  SUP: ["Entry ID", "Timestamp", "Entry Type", "Channel", "Order ID", "Product Name",
        "Quantity (Units)", "Remarks", "Supervisor Email", "Repack Items",
        "Unit Cost (₹)", "Selling Price (₹)", "Sale Value (₹)", "Batch No",
        "Order Item ID", "Tracking ID", "Return ID", "Return Type", "Damage Reason", "Source", "Import Key",
        "SKU", "Channel Date"],  // SKU = channel listing sold/returned; Channel Date = dispatch / return-delivered date on the channel

  // Agent imports (Firebase -> system): one row per record the sync touched. Failed rows can be retried from the Admin Panel.
  IMPORTS: ["Timestamp", "Import Key", "Kind", "Channel", "Order ID", "SKU", "Product Name", "Quantity", "Status", "Entry ID", "Message"],

  // SKU -> product mapping used when the agent sends a SKU without a valid product name. Edit directly in the sheet.
  SKUMAP: ["Channel", "SKU", "Product Name", "Bottles per Unit", "Notes"],

  // One row per packing run. Balance = Packed - Out + Repack (Damage is a loss log of already-dispatched units).
  BATCH: ["Batch No", "Product Name", "Mfg Date", "Expiry Date", "Packed (Units)", "Out (Units)",
          "Damage (Units)", "Repack (Units)", "Balance (Units)", "Reserved", "Created By", "Created At", "Notes"],


  PRICE: ["Item ID", "Item Type", "Item Name", "Cost Price (₹)",
          "Selling Price (₹)", "Unit", "Last Updated", "Updated By",
          "Purchase Price (₹)", "Purchase Qty (ml)"],

  HISTORY: ["Timestamp", "Item ID", "Item Type", "Item Name", "Field",
            "Old Value (₹)", "New Value (₹)", "Changed By"],

  ACTIVITY: ["Timestamp", "Type", "Item", "Product", "Quantity", "Unit", "User"],

  // Channel-specific selling price per product (blank = use default selling price from Price_Master)
  CHPRICE: ["Product", "Channel", "Selling Price (₹)", "Last Updated", "Updated By"],

  // Permissions: comma-separated keys - admin (Admin Panel), entries (add Received/Packing/Supervisor), edit (Edit buttons),
  // delete (Delete buttons), users (User Access panel). Blank = derived from Role (legacy rows).
  ADMIN: ["Email", "Name", "Role", "Passcode", "WhatsApp", "Permissions"]
};

/* ================= ONE-TIME SETUP ================= */
/* Run this from the Apps Script editor (select initializeSystem from the
   dropdown, then click Run). Safe to re-run: it only creates missing tabs
   and upgrades old tabs to the latest column layout without losing data. */

function initializeSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scriptProps = PropertiesService.getScriptProperties();
  scriptProps.setProperty("SHEET_ID", ss.getId());

  if (!ss.getSheetByName(CONFIG.SHEETS.RAW)) buildRawMaterialSheet_(ss);
  if (!ss.getSheetByName(CONFIG.SHEETS.PACK)) buildPackagingSheet_(ss);
  if (!ss.getSheetByName(CONFIG.SHEETS.FG)) buildFinishedGoodsSheet_(ss);
  if (!ss.getSheetByName(CONFIG.SHEETS.SUP)) buildSupervisorSheet_(ss);
  if (!ss.getSheetByName(CONFIG.SHEETS.PRICE)) buildPriceMasterSheet_(ss);
  if (!ss.getSheetByName(CONFIG.SHEETS.HISTORY)) buildPriceHistorySheet_(ss);
  if (!ss.getSheetByName(CONFIG.SHEETS.ACTIVITY)) { const a = ss.insertSheet(CONFIG.SHEETS.ACTIVITY); a.appendRow(HEADERS.ACTIVITY); a.setFrozenRows(1); }
  if (!ss.getSheetByName(CONFIG.SHEETS.CHPRICE)) { const c = ss.insertSheet(CONFIG.SHEETS.CHPRICE); c.appendRow(HEADERS.CHPRICE); c.setFrozenRows(1); }
  if (!ss.getSheetByName(CONFIG.SHEETS.ADMIN)) buildAdminSheet_(ss);

  // Upgrade existing tabs to the newest column layout (keeps data).
  upgradeSupervisorSheet_(ss);
  upgradeAdminSheet_(ss);
  scriptProps.setProperty("SHEET_ID", ss.getId());
  const addedPack = ensurePackagingRows_(); // adds any packaging item added to CONFIG later (e.g. Instruction Slip)
  ensurePriceRows_(); // adds any missing Price_Master rows + new columns (keeps existing prices)
  ensureChannelPriceRows_();
  ensureBatchSheets_(); // Batches + Raw_Material_Lots tabs; existing FG stock becomes an "OPENING" batch per product
  ensureAgentSheets_(); // Agent_Imports + SKU_Map tabs (channel automation)

  const sheet1 = ss.getSheetByName("Sheet1");
  if (sheet1 && sheet1.getLastRow() <= 1 && sheet1.getLastColumn() <= 1) {
    ss.deleteSheet(sheet1);
  }

  invalidateCache_();
  if (addedPack) Logger.log(addedPack + " packaging row(s) added. Open Packaging Material and set their First-Time Opening / stock before recording packing.");
  Logger.log("Inventory tabs ready in: " + ss.getUrl());
  return ss.getUrl();
}

function buildRawMaterialSheet_(ss) {
  const sh = ss.insertSheet(CONFIG.SHEETS.RAW);
  sh.appendRow(HEADERS.RAW);
  const rows = CONFIG.PRODUCTS.map(function (p, i) {
    return ["RM-" + pad_(i + 1), p, 0, 0, 0, 0, 0, 0, "Out of Stock", "", ""];
  });
  sh.getRange(2, 1, rows.length, HEADERS.RAW.length).setValues(rows);
  sh.setFrozenRows(1);
}

function buildPackagingSheet_(ss) {
  const sh = ss.insertSheet(CONFIG.SHEETS.PACK);
  sh.appendRow(HEADERS.PACK);
  const rows = [];
  let idx = 1;
  CONFIG.COMMON_PACKAGING.forEach(function (item) {
    rows.push(["PK-" + pad_(idx++), item, "All", 0, 0, 0, 0, 0, "Out of Stock", "", ""]);
  });
  CONFIG.PRODUCT_SPECIFIC_PACKAGING.forEach(function (type) {
    CONFIG.PRODUCTS.forEach(function (p) {
      rows.push(["PK-" + pad_(idx++), type, p, 0, 0, 0, 0, 0, "Out of Stock", "", ""]);
    });
  });
  sh.getRange(2, 1, rows.length, HEADERS.PACK.length).setValues(rows);
  sh.setFrozenRows(1);
}

function buildFinishedGoodsSheet_(ss) {
  const sh = ss.insertSheet(CONFIG.SHEETS.FG);
  sh.appendRow(HEADERS.FG);
  const rows = CONFIG.PRODUCTS.map(function (p, i) {
    return ["FG-" + pad_(i + 1), p, 0, 0, 0, 0, 0, 0, 0, "Out of Stock", "", ""];
  });
  sh.getRange(2, 1, rows.length, HEADERS.FG.length).setValues(rows);
  sh.setFrozenRows(1);
}

function buildSupervisorSheet_(ss) {
  const sh = ss.insertSheet(CONFIG.SHEETS.SUP);
  sh.appendRow(HEADERS.SUP);
  sh.setFrozenRows(1);
}

function buildPriceMasterSheet_(ss) {
  const sh = ss.insertSheet(CONFIG.SHEETS.PRICE);
  sh.appendRow(HEADERS.PRICE);
  const rows = [];
  let idx = 1;

  CONFIG.PRODUCTS.forEach(function (p) {
    rows.push(["PR-" + pad_(idx++), "Raw Material", p, 0, "", "ml", "", ""]);
  });
  CONFIG.COMMON_PACKAGING.forEach(function (item) {
    rows.push(["PR-" + pad_(idx++), "Packaging", item + " (All)", 0, "", "pc", "", ""]);
  });
  CONFIG.PRODUCT_SPECIFIC_PACKAGING.forEach(function (type) {
    CONFIG.PRODUCTS.forEach(function (p) {
      rows.push(["PR-" + pad_(idx++), "Packaging", type + " - " + p, 0, "", "pc", "", ""]);
    });
  });
  CONFIG.PRODUCTS.forEach(function (p) {
    rows.push(["PR-" + pad_(idx++), "Finished Good", p, "", 0, "unit", "", ""]);
  });

  sh.getRange(2, 1, rows.length, HEADERS.PRICE.length).setValues(rows);
  sh.setFrozenRows(1);
}

function buildPriceHistorySheet_(ss) {
  const sh = ss.insertSheet(CONFIG.SHEETS.HISTORY);
  sh.appendRow(HEADERS.HISTORY);
  sh.setFrozenRows(1);
}

function buildAdminSheet_(ss) {
  const sh = ss.insertSheet(CONFIG.SHEETS.ADMIN);
  sh.appendRow(HEADERS.ADMIN);
  sh.setFrozenRows(1);
}

// Old Supervisor layout: Entry ID | Timestamp | Entry Type | Product Name | Qty | Remarks | Email
// New layout adds Channel + Order ID before Product Name, and Repack Items at the end.
function upgradeSupervisorSheet_(ss) {
  const sh = ss.getSheetByName(CONFIG.SHEETS.SUP);
  if (!sh) return;
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers[3] === "Product Name") {
    sh.insertColumnsBefore(4, 2); // makes room for Channel + Order ID
  }
  sh.getRange(1, 1, 1, HEADERS.SUP.length).setValues([HEADERS.SUP]);
  sh.setFrozenRows(1);
}

function upgradeAdminSheet_(ss) {
  const sh = ss.getSheetByName(CONFIG.SHEETS.ADMIN);
  if (!sh) return;
  sh.getRange(1, 1, 1, HEADERS.ADMIN.length).setValues([HEADERS.ADMIN]);
}

function pad_(n) {
  return ("00" + n).slice(-2);
}

/* ================= PERFORMANCE NOTES =================
   - The spreadsheet handle, the user's email and role are memoised per execution.
   - Every write reads a whole tab ONCE into memory, mutates the array, and writes
     back with a single setValues() - instead of dozens of getValue()/setValue() calls.
   - Every write returns the fresh dashboard payload, so the UI refreshes in the
     same round-trip (no second server call).
   - The dashboard (incl. the Admin Panel data) is cached gzip-compressed for 2 min
     and invalidated on every write.
   ====================================================== */

/* ================= CACHE LAYER ================= */

const CACHE_TTL_SECONDS = 120;
const CACHE_KEY = "dashboard_v4";

function getCached_(key, buildFn) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) {
    try {
      const bytes = Utilities.base64Decode(hit);
      const json = Utilities.ungzip(Utilities.newBlob(bytes, "application/x-gzip")).getDataAsString();
      return JSON.parse(json);
    } catch (e) { /* rebuild */ }
  }
  const value = buildFn();
  try {
    const gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(value)));
    cache.put(key, Utilities.base64Encode(gz.getBytes()), CACHE_TTL_SECONDS);
  } catch (e) { /* too large - skip caching */ }
  return value;
}

function invalidateCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

/* ================= SHEET ACCESS HELPERS ================= */

let SS_ = null;
function getSS_() {
  if (SS_) return SS_;
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!id) throw new Error("System not initialized. Run initializeSystem() first.");
  SS_ = SpreadsheetApp.openById(id);
  return SS_;
}

function getSheet_(name) {
  const sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error("Sheet tab missing: " + name + ". Run initializeSystem().");
  return sh;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

// ---- In-memory table: read once, mutate, write once ----
function readTable_(sheetName) {
  const sheet = getSheet_(sheetName);
  const v = sheet.getDataRange().getValues();
  return { sheet: sheet, headers: v[0] || [], rows: v.slice(1) };
}
function col_(t, headerName) {
  const idx = t.headers.indexOf(headerName);
  if (idx === -1) throw new Error("Column '" + headerName + "' not found in " + t.sheet.getName() + ". Run initializeSystem().");
  return idx;
}
function findRow_(t, headerName, value) {
  const c = col_(t, headerName);
  for (let i = 0; i < t.rows.length; i++) if (t.rows[i][c] === value) return i;
  return -1;
}
function writeRow_(t, i) {
  const width = t.headers.length;
  while (t.rows[i].length < width) t.rows[i].push("");
  t.sheet.getRange(i + 2, 1, 1, width).setValues([t.rows[i].slice(0, width)]);
}
function writeAll_(t) {
  if (!t.rows.length) return;
  const width = t.headers.length;
  const out = t.rows.map(function (r) { const c = r.slice(0, width); while (c.length < width) c.push(""); return c; });
  t.sheet.getRange(2, 1, out.length, width).setValues(out);
}
function appendRows_(sheetName, rows) {
  if (!rows.length) return;
  const sh = getSheet_(sheetName);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/* ================= USER / ACCESS ================= */

let EMAIL_ = null;
function getCurrentUserEmail_() {
  if (EMAIL_ === null) EMAIL_ = Session.getActiveUser().getEmail() || "unknown";
  return EMAIL_;
}

const ROLE_ = {};
const PERM_KEYS = ["admin", "entries", "edit", "delete", "users"];
// Access is per user, as tick boxes in User Access:
//   admin   - Admin Panel (costing, rates, valuation, dispatch summary)
//   entries - Add Stock / Record Packing / Supervisor entries (+ AI actions)
//   edit    - Edit buttons (rows, supervisor entries, costing rates, batch dates)
//   delete  - Delete buttons
//   users   - User Access panel
// "Role" is kept as a label (Super Admin / Admin / Executive / Viewer / Custom) and, for old rows without
// a Permissions value, as the source of the default ticks. The script owner always has every permission.
const ROLES_ = ["Super Admin", "Admin", "Executive", "Viewer", "Custom"];
function normalizeRole_(r) {
  r = String(r || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (r === "super admin" || r === "superadmin" || r === "owner" || r === "super") return "Super Admin";
  if (r === "executive" || r === "edit" || r === "staff" || r === "operator" || r === "supervisor") return "Executive";
  if (r === "viewer" || r === "view" || r === "read only" || r === "readonly") return "Viewer";
  if (r === "custom") return "Custom";
  return "Admin"; // blank / "admin" / unknown -> Admin (legacy behaviour)
}
function permsForRole_(role) {
  role = normalizeRole_(role);
  if (role === "Super Admin") return { admin: true, entries: true, edit: true, delete: true, users: true };
  if (role === "Admin") return { admin: true, entries: true, edit: true, delete: false, users: false };
  if (role === "Executive") return { admin: false, entries: true, edit: false, delete: false, users: false };
  return { admin: false, entries: false, edit: false, delete: false, users: false };
}
function parsePerms_(str, role) {
  const txt = String(str || "").trim().toLowerCase();
  if (!txt) return permsForRole_(role);
  const p = { admin: false, entries: false, edit: false, delete: false, users: false };
  if (txt === "none") return p;
  txt.split(/[,\s;|]+/).forEach(function (k) { if (PERM_KEYS.indexOf(k) !== -1) p[k] = true; });
  return p;
}
function permsToString_(p) { return PERM_KEYS.filter(function (k) { return p[k]; }).join(",") || "none"; }
// Label shown next to the ticks
function roleLabelFor_(p) {
  if (p.admin && p.entries && p.edit && p.delete && p.users) return "Super Admin";
  if (p.admin && p.entries && p.edit && !p.delete && !p.users) return "Admin";
  if (!p.admin && p.entries && !p.edit && !p.delete && !p.users) return "Executive";
  if (!p.admin && !p.entries && !p.edit && !p.delete && !p.users) return "Viewer";
  return "Custom";
}
function ownerEmail_() {
  try { return String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase(); } catch (e) { return ""; }
}
// { perms, role } for an email (memoised per execution)
function getUserAccess_(email) {
  const key = String(email).trim().toLowerCase();
  if (ROLE_[key]) return ROLE_[key];
  const sh = getSheet_(CONFIG.SHEETS.ADMIN);
  const lastRow = sh.getLastRow();
  let perms = permsForRole_("Viewer");
  if (lastRow >= 2) {
    const width = Math.max(sh.getLastColumn(), HEADERS.ADMIN.length);
    const data = sh.getRange(2, 1, lastRow - 1, width).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === key) { perms = parsePerms_(data[i][5], data[i][2]); break; }
    }
  }
  if (key && key === ownerEmail_()) perms = permsForRole_("Super Admin"); // the script owner can never be locked out
  ROLE_[key] = { perms: perms, role: roleLabelFor_(perms) };
  return ROLE_[key];
}
function getUserRole_(email) { return getUserAccess_(email).role; }
function hasPerm_(email, key) { return !!getUserAccess_(email).perms[key]; }

function isSuperAdmin_(email) { return getUserRole_(email) === "Super Admin"; }
function isAdminUser_(email) { return hasPerm_(email, "admin"); }
function canEditUser_(email) { return hasPerm_(email, "entries"); }

function requirePerm_(key, label) {
  const email = getCurrentUserEmail_();
  if (!hasPerm_(email, key)) throw new Error("Access Denied: you do not have the '" + label + "' permission. Ask a Super Admin to enable it in User Access.");
  return email;
}
function requireAdmin_() { return requirePerm_("admin", "Admin Panel"); }
function requireEdit_() { return requirePerm_("entries", "Add Entries"); }
function requireRowEdit_() { return requirePerm_("edit", "Edit"); }
function requireSuper_() { return requirePerm_("delete", "Delete"); }
function requireUsers_() { return requirePerm_("users", "User Access"); }

function debugMyEmail() {
  Logger.log("Detected email: " + getCurrentUserEmail_());
}

/* ================= WEB APP ENTRY ================= */

// doGet / include removed — this is now a static client-side app (index.html loads directly).

/* ================= SMALL HELPERS ================= */

function computeStatus_(current, threshold) {
  if (current <= 0) return "Out of Stock";
  if (current <= threshold) return "Low Stock";
  return "In Stock";
}
function round2_(n) { return Math.round(n * 100) / 100; }
function n_(v) { return Number(v) || 0; }
function stockInput_(value, whole) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (whole && !Number.isSafeInteger(n))) throw new Error("Stock and thresholds must be non-negative " + (whole ? "whole numbers." : "finite numbers."));
  return n;
}

// Recalculate computed columns of one row (in memory). Column indexes follow HEADERS.
function recalcRaw_(t, i, email) {
  const r = t.rows[i];
  const currentMl = n_(r[2]) + n_(r[3]) - n_(r[4]);
  // Whole bottles only (a bottle needs a full 30 ml); leftover ml is shown separately in the UI
  const units = currentMl >= 0 ? Math.floor(currentMl / CONFIG.CONVERSION_FACTOR) : Math.ceil(currentMl / CONFIG.CONVERSION_FACTOR);
  r[5] = currentMl; r[6] = units; r[8] = computeStatus_(units, n_(r[7])); r[9] = new Date(); r[10] = email;
}
function recalcPack_(t, i, email) {
  const r = t.rows[i];
  const current = n_(r[3]) + n_(r[4]) - n_(r[5]);
  r[6] = current; r[8] = computeStatus_(current, n_(r[7])); r[9] = new Date(); r[10] = email;
}
function recalcFG_(t, i, email) {
  const r = t.rows[i];
  const current = n_(r[2]) + n_(r[3]) - n_(r[4]) + n_(r[6]);
  r[7] = current; r[9] = computeStatus_(current, n_(r[8])); r[10] = new Date(); r[11] = email;
}

function logActivity_(type, item, product, qty, unit, email) {
  try { appendRows_(CONFIG.SHEETS.ACTIVITY, [[new Date(), type, item, product, qty, unit, email]]); } catch (e) { Logger.log("Activity log failed: " + e.message); }
}

// Every write returns the fresh dashboard so the client refreshes in the same round-trip.
// Every write returns the fresh dashboard in the same round-trip. `patch` tells which sources changed
// so nothing has to be re-read from the sheet.
let QUIET_ = false; // true while the agent sync runs many writes: skip the per-write dashboard rebuild
function done_(result, patch) {
  if (QUIET_) return result;
  const payload = refreshDashboard_(patch || null);
  result.dashboard = finalizeForUser_(payload);
  try { sendInstantAlerts_(result.dashboard); } catch (e) { Logger.log("Alert email failed: " + e.message); }
  return result;
}
function objRow_(headers, arr) { const o = {}; headers.forEach(function (h, i) { o[h] = arr[i]; }); return o; }

/* ================= READ OPERATIONS ================= */

function getRawMaterialData() { return sheetToObjects_(getSheet_(CONFIG.SHEETS.RAW)); }
function getPackagingData() { return sheetToObjects_(getSheet_(CONFIG.SHEETS.PACK)); }
function getFinishedGoodsData() { return sheetToObjects_(getSheet_(CONFIG.SHEETS.FG)); }
function getPriceMasterData() { return sheetToObjects_(getSheet_(CONFIG.SHEETS.PRICE)); }

/* ================= COSTING ================= */

// Price_Master "Item Name" for a packaging row (Item Name + Applicable Product)
function packPriceName_(itemName, applicable) {
  if (applicable === "All") return itemName + " (All)";
  if (CONFIG.PRODUCT_SPECIFIC_PACKAGING.indexOf(itemName) !== -1) return itemName + " - " + applicable;
  return itemName + " (" + applicable + ")"; // custom items created via "Add New Item"
}

function buildPriceMap_(prices) {
  const map = {};
  prices.forEach(function (p) { map[String(p["Item Type"]).trim() + "|" + String(p["Item Name"]).trim()] = p; });
  return map;
}

// Makes sure Price_Master has a row for every product / packaging item and the latest columns.
// Existing prices are never touched. Returns true if anything was added.
function ensurePriceRows_() {
  const sh = getSheet_(CONFIG.SHEETS.PRICE);
  sh.getRange(1, 1, 1, HEADERS.PRICE.length).setValues([HEADERS.PRICE]);
  const t = readTable_(CONFIG.SHEETS.PRICE);
  const have = {};
  let maxId = 0;
  t.rows.forEach(function (r) {
    have[String(r[1]).trim() + "|" + String(r[2]).trim()] = true;
    const m = String(r[0]).match(/(\d+)/); if (m) maxId = Math.max(maxId, Number(m[1]));
  });
  const packRows = getPackagingData();
  const wanted = [];
  CONFIG.PRODUCTS.forEach(function (p) { wanted.push(["Raw Material", p, "ml", 0, ""]); });
  packRows.forEach(function (r) { wanted.push(["Packaging", packPriceName_(r["Item Name"], r["Applicable Product"]), "pc", 0, ""]); });
  CONFIG.PRODUCTS.forEach(function (p) { wanted.push(["Finished Good", p, "unit", "", 0]); });
  const toAdd = [];
  wanted.forEach(function (w) {
    if (have[w[0] + "|" + w[1]]) return;
    have[w[0] + "|" + w[1]] = true;
    maxId++;
    toAdd.push(["PR-" + ("00" + maxId).slice(-2), w[0], w[1], w[3], w[4], w[2], "", "", "", ""]);
  });
  appendRows_(CONFIG.SHEETS.PRICE, toAdd);
  return toAdd.length > 0;
}

// Makes sure the Packaging tab has a row for every configured item (common + product-specific).
// Existing rows and their stock are never touched. New items start at 0 - add their opening stock
// with Edit, then keep restocking through "Add Stock". Returns the number of rows added.
function ensurePackagingRows_() {
  const sh = getSheet_(CONFIG.SHEETS.PACK);
  sh.getRange(1, 1, 1, HEADERS.PACK.length).setValues([HEADERS.PACK]);
  const t = readTable_(CONFIG.SHEETS.PACK);
  const have = {};
  let maxId = 0;
  t.rows.forEach(function (r) {
    have[String(r[1]).trim() + "|" + String(r[2]).trim()] = true;
    const m = String(r[0]).match(/(\d+)/); if (m) maxId = Math.max(maxId, Number(m[1]));
  });
  const wanted = [];
  CONFIG.COMMON_PACKAGING.forEach(function (item) { wanted.push([item, "All"]); });
  CONFIG.PRODUCT_SPECIFIC_PACKAGING.forEach(function (type) {
    CONFIG.PRODUCTS.forEach(function (p) { wanted.push([type, p]); });
  });
  const toAdd = [];
  wanted.forEach(function (w) {
    if (have[w[0] + "|" + w[1]]) return;
    have[w[0] + "|" + w[1]] = true;
    maxId++;
    toAdd.push(["PK-" + pad_(maxId), w[0], w[1], 0, 0, 0, 0, 0, "Out of Stock", new Date(), "system"]);
  });
  appendRows_(CONFIG.SHEETS.PACK, toAdd);
  return toAdd.length;
}

// One row per Product x Channel in Channel_Prices (price blank until Admin sets it)
function ensureChannelPriceRows_() {
  const ss = getSS_();
  let sh = ss.getSheetByName(CONFIG.SHEETS.CHPRICE);
  if (!sh) { sh = ss.insertSheet(CONFIG.SHEETS.CHPRICE); sh.appendRow(HEADERS.CHPRICE); sh.setFrozenRows(1); }
  const t = readTable_(CONFIG.SHEETS.CHPRICE);
  const have = {};
  t.rows.forEach(function (r) { have[String(r[0]).trim() + "|" + String(r[1]).trim()] = true; });
  const toAdd = [];
  CONFIG.PRODUCTS.forEach(function (p) {
    CONFIG.CHANNELS.forEach(function (c) { if (!have[p + "|" + c]) toAdd.push([p, c, "", "", ""]); });
  });
  appendRows_(CONFIG.SHEETS.CHPRICE, toAdd);
  return toAdd.length > 0;
}

// { product: { channel: price } } - only channels with a price set
function getChannelPrices_() {
  const map = {};
  try {
    sheetToObjects_(getSheet_(CONFIG.SHEETS.CHPRICE)).forEach(function (r) {
      const p = String(r["Product"]).trim(), c = String(r["Channel"]).trim(), v = r["Selling Price (₹)"];
      if (!map[p]) map[p] = {};
      if (v !== "" && v !== null && v !== undefined) map[p][c] = n_(v);
    });
  } catch (e) { /* sheet missing until initializeSystem runs */ }
  return map;
}

// Selling price for a product on a channel: channel price if set, else default
function sellingPriceFor_(prices, chPrices, product, channel) {
  const chp = chPrices[product] || {};
  if (channel && chp[channel] !== undefined) return chp[channel];
  const fg = buildPriceMap_(prices)["Finished Good|" + product] || {};
  return n_(fg["Selling Price (₹)"]);
}

// Full BOM costing per product, with item IDs + rates so the Admin Panel can edit them inline.
function computeCostingSummary_(prices, packagingRows, channelPrices) {
  const priceMap = buildPriceMap_(prices);
  const packRows = packagingRows || [];
  const chPrices = channelPrices || {};

  return CONFIG.PRODUCTS.map(function (product) {
    const rmPrice = priceMap["Raw Material|" + product] || {};
    const rmRate = n_(rmPrice["Cost Price (₹)"]);
    const rawCost = CONFIG.CONVERSION_FACTOR * rmRate;

    const packItems = [];
    let packCost = 0;
    packRows.forEach(function (r) {
      const appl = r["Applicable Product"];
      if (appl !== "All" && appl !== product) return;
      const p = priceMap["Packaging|" + packPriceName_(r["Item Name"], appl)] || {};
      const rate = n_(p["Cost Price (₹)"]);
      packCost += rate;
      packItems.push({ itemId: p["Item ID"] || "", name: r["Item Name"], applicable: appl, common: appl === "All", rate: round2_(rate) });
    });

    const totalCost = rawCost + packCost;
    const fgPrice = priceMap["Finished Good|" + product] || {};
    const sellingPrice = n_(fgPrice["Selling Price (₹)"]);
    const margin = sellingPrice - totalCost;
    const marginPct = sellingPrice ? ((margin / sellingPrice) * 100) : 0;

    return {
      product: product,
      rmItemId: rmPrice["Item ID"] || "", rmRate: round2_(rmRate), rawMaterialCost: round2_(rawCost),
      rmBuyPrice: rmPrice["Purchase Price (₹)"] === undefined ? "" : rmPrice["Purchase Price (₹)"],
      rmBuyMl: rmPrice["Purchase Qty (ml)"] === undefined ? "" : rmPrice["Purchase Qty (ml)"],
      packItems: packItems, packagingCost: round2_(packCost), totalCost: round2_(totalCost),
      fgItemId: fgPrice["Item ID"] || "", sellingPrice: round2_(sellingPrice),
      channelPrices: CONFIG.CHANNELS.map(function (c) {
        const v = (chPrices[product] || {})[c];
        return { channel: c, price: v === undefined ? "" : v, marginPct: v ? round2_((v - totalCost) / v * 100) : null };
      }),
      margin: round2_(margin), marginPct: round2_(marginPct)
    };
  });
}

// Cost + selling price of one product right now (entry-time snapshot)
function productCostFrom_(prices, packRows, productName) {
  const row = computeCostingSummary_(prices, packRows).filter(function (s) { return s.product === productName; })[0];
  return row ? { cost: row.totalCost, selling: row.sellingPrice } : { cost: 0, selling: 0 };
}

function tableToObjects_(t) {
  return t.rows.map(function (row) { const o = {}; t.headers.forEach(function (h, i) { o[h] = row[i]; }); return o; });
}

/* ================= BATCH / EXPIRY HELPERS ================= */

// Column indexes of the Batches tab (follow HEADERS.BATCH)
const B_ = { NO: 0, PROD: 1, MFG: 2, EXP: 3, PACKED: 4, OUT: 5, DAMAGE: 6, REPACK: 7, BAL: 8, LOT: 9, BY: 10, AT: 11, NOTES: 12 };

function productCode_(productName) {
  const o = (CONFIG.BATCH.PRODUCT_CODES || {})[productName];
  if (o) return String(o).toUpperCase();
  return String(productName).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4) || "PROD";
}

function addMonths_(d, months) {
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1); x.setMonth(x.getMonth() + months);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDate_(v) {
  if (v === "" || v === null || v === undefined) return null;
  const d = v instanceof Date ? new Date(v) : new Date(String(v).length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) + "T00:00:00" : v);
  return isNaN(d.getTime()) ? null : d;
}

function daysUntil_(d) {
  if (!d) return null;
  return Math.round((dayStart_(d) - dayStart_(new Date())) / 86400000);
}

function expiryStatus_(days) {
  if (days === null) return "No Date";
  if (days < 0) return "Expired";
  if (days <= CONFIG.BATCH.EXPIRY_WARN_DAYS) return "Expiring Soon";
  return "OK";
}

// Creates the Batches tab if missing. On first creation, current Finished Goods stock
// becomes one "OPENING-<code>" batch per product so that batch balances add up to the FG tab from day one.
function ensureBatchSheets_() {
  const ss = getSS_();
  let created = false;
  if (!ss.getSheetByName(CONFIG.SHEETS.BATCH)) {
    const b = ss.insertSheet(CONFIG.SHEETS.BATCH); b.appendRow(HEADERS.BATCH); b.setFrozenRows(1);
    created = true;
    const rows = [];
    const now = new Date();
    getFinishedGoodsData().forEach(function (r) {
      const cur = n_(r["Current Stock (Units)"]);
      if (cur > 0) rows.push(["OPENING-" + productCode_(r["Product Name"]), r["Product Name"], "", "", cur, 0, 0, 0, cur, "", "system", now, "Opening stock recorded before batch tracking started. Admin: set Mfg / Expiry via Edit."]);
    });
    appendRows_(CONFIG.SHEETS.BATCH, rows);
  }
  // Supervisor tab gets the "Batch No" column (header row rewrite only)
  const sup = ss.getSheetByName(CONFIG.SHEETS.SUP);
  if (sup && sup.getLastColumn() < HEADERS.SUP.length) sup.getRange(1, 1, 1, HEADERS.SUP.length).setValues([HEADERS.SUP]);
  return created;
}

function batchTable_() {
  if (!getSS_().getSheetByName(CONFIG.SHEETS.BATCH)) ensureBatchSheets_();
  const t = readTable_(CONFIG.SHEETS.BATCH);
  t.headers = HEADERS.BATCH.slice();
  return t;
}

function recalcBatch_(t, i) {
  const r = t.rows[i];
  while (r.length < HEADERS.BATCH.length) r.push("");
  r[B_.BAL] = Math.max(0, n_(r[B_.PACKED]) - n_(r[B_.OUT]) + n_(r[B_.REPACK]));
}

function nextBatchNo_(t, productName, mfgDate) {
  const code = productCode_(productName);
  const stamp = Utilities.formatDate(mfgDate, Session.getScriptTimeZone(), "yyMMdd");
  const base = CONFIG.BATCH.PREFIX + "-" + code + "-" + stamp;
  const taken = {};
  t.rows.forEach(function (r) { taken[String(r[B_.NO])] = true; });
  if (!taken[base]) return base;
  let n = 2;
  while (taken[base + "-" + pad_(n)]) n++;
  return base + "-" + pad_(n);
}

// The product's current (open) batch: the newest MG batch whose Mfg date is less than PERIOD_MONTHS old. -1 if none.
function currentBatchIndex_(t, productName) {
  const today = dayStart_(new Date());
  let best = -1, bestMfg = null;
  t.rows.forEach(function (r, i) {
    if (r[B_.PROD] !== productName) return;
    if (String(r[B_.NO]).indexOf("OPENING-") === 0) return;
    const mfg = toDate_(r[B_.MFG]);
    if (!mfg) return;
    if (addMonths_(mfg, CONFIG.BATCH.PERIOD_MONTHS) <= today) return; // period over
    if (!bestMfg || mfg > bestMfg) { best = i; bestMfg = mfg; }
  });
  return best;
}

// Batches of one product that can still be dispatched, FEFO order (earliest expiry first; undated opening batches first)
function batchesFor_(t, productName) {
  const list = [];
  t.rows.forEach(function (r, i) {
    if (r[B_.PROD] === productName) list.push({ i: i, no: String(r[B_.NO]), exp: toDate_(r[B_.EXP]), bal: n_(r[B_.BAL]) });
  });
  list.sort(function (a, b) { return (a.exp ? a.exp.getTime() : 0) - (b.exp ? b.exp.getTime() : 0); });
  return list;
}

// Applies (sign=+1) or reverses (sign=-1) one supervisor entry on its batch. Returns the batch number used ("" if none).
// Out: batch required (auto-picked FEFO when blank), balance + expiry enforced.  Damage: logged on the batch.  Repack: added back to the batch.
function applyBatch_(bt, batchNo, entryType, productName, qty, sign) {
  batchNo = String(batchNo || "").trim();
  if (entryType === "RTO-Pending") return batchNo; // remembered only; booked on the batch when inspected
  const list = batchesFor_(bt, productName);
  if (!list.length) return ""; // product has no batches yet (never packed since batch tracking started) - nothing to track
  let idx = -1;
  if (batchNo) {
    idx = findRow_(bt, "Batch No", batchNo);
    if (idx === -1) { if (sign < 0) return ""; throw new Error("Batch not found: " + batchNo); }
    if (bt.rows[idx][B_.PROD] !== productName) throw new Error("Batch " + batchNo + " belongs to " + bt.rows[idx][B_.PROD] + ", not " + productName + ".");
  } else if (sign > 0 && entryType === "Out") {
    const pick = list.filter(function (b) { return b.bal >= qty && expiryStatus_(daysUntil_(b.exp)) !== "Expired"; })[0];
    if (!pick) {
      const avail = list.filter(function (b) { return b.bal > 0; }).map(function (b) { return b.no + ": " + b.bal + " units" + (expiryStatus_(daysUntil_(b.exp)) === "Expired" ? " (EXPIRED)" : ""); });
      throw new Error("No single batch of " + productName + " has " + qty + " units available. Split the dispatch by batch.\n\nAvailable: " + (avail.join("; ") || "none") + ".");
    }
    idx = pick.i; batchNo = pick.no;
  } else if (!batchNo) {
    return ""; // Damage / Repack without a batch: allowed (units stay unassigned)
  }
  const r = bt.rows[idx];
  const delta = qty * sign;
  if (entryType === "Out") {
    if (sign > 0) {
      const st = expiryStatus_(daysUntil_(toDate_(r[B_.EXP])));
      if (st === "Expired") throw new Error("Batch " + batchNo + " expired on " + Utilities.formatDate(toDate_(r[B_.EXP]), Session.getScriptTimeZone(), "dd MMM yyyy") + " and cannot be dispatched.");
      if (n_(r[B_.BAL]) < qty) throw stockError_("Batch " + batchNo + " does not have " + qty + " units left.",
        { title: "Not enough stock in this batch", product: productName, requested: qty, unit: "units", maxPossible: n_(r[B_.BAL]),
          rows: [{ item: "Batch " + batchNo + " (" + productName + ")", type: "Batch", unit: "units", available: n_(r[B_.BAL]), required: qty, short: qty - n_(r[B_.BAL]) }] });
    }
    r[B_.OUT] = Math.max(0, n_(r[B_.OUT]) + delta);
  } else if (entryType === "RTO-Damage") {
    r[B_.DAMAGE] = Math.max(0, n_(r[B_.DAMAGE]) + delta);
  } else if (entryType === "RTO-Repackaging") {
    r[B_.REPACK] = Math.max(0, n_(r[B_.REPACK]) + delta);
  }
  recalcBatch_(bt, idx);
  bt.dirty = true;
  return batchNo;
}

// Batch rows for the dashboard payload (all roles): dates as ISO strings + expiry status
function batchesPayload_(rows) {
  return (rows || []).map(function (r) {
    const exp = toDate_(r["Expiry Date"]), mfg = toDate_(r["Mfg Date"]);
    const days = daysUntil_(exp);
    return {
      batchNo: String(r["Batch No"]), product: r["Product Name"],
      mfg: mfg ? fmtDay_(mfg) : "", expiry: exp ? fmtDay_(exp) : "",
      packed: n_(r["Packed (Units)"]), out: n_(r["Out (Units)"]), damage: n_(r["Damage (Units)"]), repack: n_(r["Repack (Units)"]),
      balance: n_(r["Balance (Units)"]), notes: r["Notes"] || "",
      daysToExpiry: days, expiryStatus: expiryStatus_(days)
    };
  }).sort(function (a, b) {
    if (a.product !== b.product) return a.product < b.product ? -1 : 1;
    return (a.expiry || "0000") < (b.expiry || "0000") ? -1 : 1;
  });
}

// Admin: set Mfg / Expiry / Notes of a batch (mainly for OPENING batches created by the migration)
function updateBatchRow(batchNo, mfgDate, expiryDate, notes) {
  const email = requireRowEdit_();
  const bt = batchTable_();
  const i = findRow_(bt, "Batch No", String(batchNo).trim());
  if (i === -1) throw new Error("Batch not found: " + batchNo);
  const r = bt.rows[i];
  const mfg = toDate_(mfgDate);
  let exp = toDate_(expiryDate);
  if (mfg && !exp) exp = addMonths_(mfg, CONFIG.BATCH.SHELF_LIFE_MONTHS);
  if (mfg && exp && exp < mfg) throw new Error("Expiry date cannot be before the manufacturing date.");
  r[B_.MFG] = mfg || ""; r[B_.EXP] = exp || "";
  if (notes !== undefined && notes !== null) r[B_.NOTES] = String(notes);
  recalcBatch_(bt, i);
  writeRow_(bt, i);
  logActivity_("Batch Updated", String(batchNo) + " (Mfg " + (mfg ? fmtDay_(mfg) : "-") + ", Exp " + (exp ? fmtDay_(exp) : "-") + ")", r[B_.PROD], n_(r[B_.BAL]), "units", email);
  return done_({ batchNo: batchNo }, { batches: tableToObjects_(bt), actAll: sheetToObjects_(getSheet_(CONFIG.SHEETS.ACTIVITY)).slice(-SRC_LIMIT) });
}

// Full history of one batch: header + every supervisor entry booked against it
function getBatchTrace(batchNo) {
  batchNo = String(batchNo || "").trim();
  if (!batchNo) throw new Error("Enter a batch number.");
  let payload = readCache_();
  if (!payload || !payload._src) payload = refreshDashboard_(null);
  const src = payload._src;
  const b = batchesPayload_(src.batches || []).filter(function (x) { return x.batchNo.toLowerCase() === batchNo.toLowerCase(); })[0];
  if (!b) throw new Error("Batch not found: " + batchNo);
  const isAdmin = isAdminUser_(getCurrentUserEmail_());
  const entries = (src.supAll || []).filter(function (r) { return String(r["Batch No"] || "").toLowerCase() === b.batchNo.toLowerCase(); })
    .map(function (r) {
      return { id: r["Entry ID"], ts: r["Timestamp"], type: r["Entry Type"], channel: r["Channel"], orderId: r["Order ID"], qty: n_(r["Quantity (Units)"]),
               saleValue: r["Sale Value (₹)"], remarks: r["Remarks"], user: r["Supervisor Email"], repack: r["Repack Items"] };
    });
  const rx = new RegExp("Batch " + b.batchNo.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&") + "(\\s|$)", "i");
  const packings = (src.actAll || []).filter(function (r) { return r["Type"] === "Packing" && rx.test(String(r["Item"] || "")); })
    .map(function (r) { return { ts: r["Timestamp"], qty: n_(r["Quantity"]), user: r["User"] }; });
  const out = { batch: b, entries: entries, packings: packings, rawLot: null };
  return JSON.parse(JSON.stringify(out));
}

/* ================= 1. RECEIVED STOCK ================= */

function addRawMaterialReceived(productName, qtyMl) {
  const email = requireEdit_();
  qtyMl = Number(qtyMl);
  if (!Number.isFinite(qtyMl) || qtyMl <= 0) throw new Error("Enter a positive, finite quantity in ml.");
  if (CONFIG.PRODUCTS.indexOf(productName) === -1) throw new Error("Invalid product.");
  const t = readTable_(CONFIG.SHEETS.RAW);
  let i = findRow_(t, "Product Name", productName);
  if (i === -1) { // row was deleted earlier - re-create it
    let maxId = 0; t.rows.forEach(function (r) { const m = String(r[0]).match(/(\d+)/); if (m) maxId = Math.max(maxId, Number(m[1])); });
    const row = ["RM-" + pad_(maxId + 1), productName, 0, 0, 0, 0, 0, 0, "Out of Stock", new Date(), email];
    appendRows_(CONFIG.SHEETS.RAW, [row]); t.rows.push(row); i = t.rows.length - 1;
    logActivity_("Raw Material Row Re-created", productName, productName, 0, "ml", email);
  }
  t.rows[i][3] = n_(t.rows[i][3]) + qtyMl;
  recalcRaw_(t, i, email);
  writeRow_(t, i);
  const act = [new Date(), "Received Raw Material", productName, productName, qtyMl, "ml", email];
  logActivity_.apply(null, act.slice(1));
  return done_({ qty: qtyMl }, { raw: tableToObjects_(t), actAppend: [objRow_(HEADERS.ACTIVITY, act)] });
}

function addPackagingReceived(itemId, qtyPcs) {
  const email = requireEdit_();
  qtyPcs = Number(qtyPcs);
  if (!Number.isSafeInteger(qtyPcs) || qtyPcs <= 0) throw new Error("Enter a positive whole number of pieces.");
  const t = readTable_(CONFIG.SHEETS.PACK);
  const i = findRow_(t, "Item ID", itemId);
  if (i === -1) throw new Error("Packaging item not found: " + itemId);
  t.rows[i][4] = n_(t.rows[i][4]) + qtyPcs;
  recalcPack_(t, i, email);
  writeRow_(t, i);
  const act = [new Date(), "Received Packaging", t.rows[i][1] + " (" + t.rows[i][2] + ")", t.rows[i][2], qtyPcs, "pcs", email];
  logActivity_.apply(null, act.slice(1));
  return done_({ qty: qtyPcs }, { pack: tableToObjects_(t), actAppend: [objRow_(HEADERS.ACTIVITY, act)] });
}

/* Structured "not enough stock" error: the message stays readable for old clients, and the
   JSON after the marker lets the UI show a clean table instead of a wall of text. */
function stockError_(summary, detail) {
  const lines = (detail.rows || []).map(function (r) {
    return r.item + ": " + r.available + " " + r.unit + " available, need " + r.required + " " + r.unit;
  });
  return new Error(summary + " Maximum possible right now: " + detail.maxPossible + " " + (detail.unit || "units") + "." +
    (lines.length ? "\n\nShort: " + lines.join("; ") + "." : "") +
    "\n::STOCKSHORT::" + JSON.stringify(detail));
}

/* ================= 2. PACKING (BOM backflush) ================= */

// opts = { newBatch: true } to force a new batch (new Batch No + Mfg date) even if the current one is under 3 months old.
// Packing adds to the product's current batch. A batch stays open for CONFIG.BATCH.PERIOD_MONTHS; after that the next
// packing starts a new batch: MG-<code>-<YYMMDD>, Mfg = today, Expiry = Mfg + CONFIG.BATCH.SHELF_LIFE_MONTHS.
function recordPacking(productName, qtyPacked, opts) {
  const email = requireEdit_();
  qtyPacked = Number(qtyPacked);
  if (!Number.isSafeInteger(qtyPacked) || qtyPacked <= 0) throw new Error("Enter a positive whole number of units.");
  opts = opts || {};

  const raw = readTable_(CONFIG.SHEETS.RAW);
  const ri = findRow_(raw, "Product Name", productName);
  if (ri === -1) throw new Error("Product not found: " + productName);
  const pack = readTable_(CONFIG.SHEETS.PACK);
  const applCol = col_(pack, "Applicable Product");

  // ---- Availability check: never let stock go negative ----
  const shortages = [];
  let maxPossible = Infinity;
  const rawMl = n_(raw.rows[ri][5]);
  const rawUnits = Math.floor(rawMl / CONFIG.CONVERSION_FACTOR);
  maxPossible = Math.min(maxPossible, rawUnits);
  const needMl = qtyPacked * CONFIG.CONVERSION_FACTOR;
  if (rawMl < needMl) shortages.push({ item: productName + " (liquid)", type: "Raw Material", unit: "ml", available: rawMl, required: needMl, short: needMl - rawMl });
  pack.rows.forEach(function (r) {
    if (r[applCol] === "All" || r[applCol] === productName) {
      const cur = n_(r[6]);
      maxPossible = Math.min(maxPossible, cur);
      if (cur < qtyPacked) shortages.push({ item: r[1] + " (" + r[applCol] + ")", type: "Packaging", unit: "pcs", available: cur, required: qtyPacked, short: qtyPacked - cur });
    }
  });
  if (shortages.length) {
    throw stockError_("Not enough stock to pack " + qtyPacked + " units of " + productName + ".",
      { title: "Cannot record packing", product: productName, requested: qtyPacked, unit: "units",
        maxPossible: Math.max(0, isFinite(maxPossible) ? maxPossible : 0), rows: shortages });
  }

  raw.rows[ri][4] = n_(raw.rows[ri][4]) + qtyPacked * CONFIG.CONVERSION_FACTOR;
  recalcRaw_(raw, ri, email);

  pack.rows.forEach(function (r, i) {
    if (r[applCol] === "All" || r[applCol] === productName) {
      r[5] = n_(r[5]) + qtyPacked;
      recalcPack_(pack, i, email);
    }
  });

  const fg = readTable_(CONFIG.SHEETS.FG);
  let fi = findRow_(fg, "Product Name", productName);
  if (fi === -1) { // row was deleted earlier - re-create it
    let maxId = 0; fg.rows.forEach(function (r) { const m = String(r[0]).match(/(\d+)/); if (m) maxId = Math.max(maxId, Number(m[1])); });
    const row = ["FG-" + pad_(maxId + 1), productName, 0, 0, 0, 0, 0, 0, 0, "Out of Stock", new Date(), email];
    appendRows_(CONFIG.SHEETS.FG, [row]); fg.rows.push(row); fi = fg.rows.length - 1;
    logActivity_("Finished Goods Row Re-created", productName, productName, 0, "units", email);
  }
  fg.rows[fi][3] = n_(fg.rows[fi][3]) + qtyPacked;
  recalcFG_(fg, fi, email);

  // ---- Batch: add to the current batch, or start a new one ----
  const bt = batchTable_();
  let bi = opts.newBatch ? -1 : currentBatchIndex_(bt, productName);
  let isNew = false, batchRow;
  if (bi === -1) {
    const mfgDate = dayStart_(new Date());
    const expiryDate = addMonths_(mfgDate, CONFIG.BATCH.SHELF_LIFE_MONTHS);
    batchRow = [nextBatchNo_(bt, productName, mfgDate), productName, mfgDate, expiryDate, qtyPacked, 0, 0, 0, qtyPacked, "", email, new Date(), ""];
    isNew = true;
  } else {
    batchRow = bt.rows[bi];
    batchRow[B_.PACKED] = n_(batchRow[B_.PACKED]) + qtyPacked;
    recalcBatch_(bt, bi);
  }
  const batchNo = String(batchRow[B_.NO]);

  writeRow_(raw, ri);
  writeAll_(pack);
  writeRow_(fg, fi);
  if (isNew) { appendRows_(CONFIG.SHEETS.BATCH, [batchRow]); bt.rows.push(batchRow); }
  else writeRow_(bt, bi);
  const act = [new Date(), "Packing", productName + " · Batch " + batchNo + (isNew ? " (new batch)" : ""), productName, qtyPacked, "units", email];
  logActivity_.apply(null, act.slice(1));
  return done_({ qty: qtyPacked, batchNo: batchNo, newBatch: isNew, mfg: fmtDay_(toDate_(batchRow[B_.MFG])), expiry: fmtDay_(toDate_(batchRow[B_.EXP])) },
    { raw: tableToObjects_(raw), pack: tableToObjects_(pack), fg: tableToObjects_(fg), batches: tableToObjects_(bt), actAppend: [objRow_(HEADERS.ACTIVITY, act)] });
}

/* ================= 3/4/5. SUPERVISOR ENTRIES ================= */

function nextEntryId_(supTable) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    let n = Number(props.getProperty("SUP_COUNTER") || 0);
    if (!n) {
      supTable.rows.forEach(function (r) { const m = String(r[0]).match(/(\d+)/); if (m) n = Math.max(n, Number(m[1])); });
    }
    n++;
    props.setProperty("SUP_COUNTER", String(n));
    return "SE-" + String(n).padStart(4, "0");
  } finally {
    lock.releaseLock();
  }
}

// Applies (sign=+1) or reverses (sign=-1) one entry's effect, in memory.
// ctx = { fg: table, pack: table, packDirty: bool }
function applyEffect_(ctx, entryType, productName, qty, repackItems, sign, email) {
  const fi = findRow_(ctx.fg, "Product Name", productName);
  if (fi === -1) throw new Error("Product not found in Finished Goods: " + productName);
  if (entryType === "RTO-Pending") return fi; // parcel arrived, not inspected yet: no stock movement
  const r = ctx.fg.rows[fi];
  const delta = qty * sign;
  if (entryType === "Out") r[4] = Math.max(0, n_(r[4]) + delta);
  else if (entryType === "RTO-Damage") r[5] = Math.max(0, n_(r[5]) + delta);
  else if (entryType === "RTO-Repackaging") {
    r[6] = Math.max(0, n_(r[6]) + delta);
    const items = repackItems || [];
    if (items.length) {
      const nameCol = col_(ctx.pack, "Item Name"), applCol = col_(ctx.pack, "Applicable Product");
      if (sign > 0) {
        ctx.pack.rows.forEach(function (pr) {
          if (items.indexOf(pr[nameCol]) !== -1 && (pr[applCol] === "All" || pr[applCol] === productName) && n_(pr[6]) < qty) {
            throw new Error("Not enough " + pr[nameCol] + " (" + pr[applCol] + ") for repackaging: " + n_(pr[6]) + " pcs available, need " + qty + ".");
          }
        });
      }
      ctx.pack.rows.forEach(function (pr, i) {
        if (items.indexOf(pr[nameCol]) !== -1 && (pr[applCol] === "All" || pr[applCol] === productName)) {
          pr[5] = Math.max(0, n_(pr[5]) + delta);
          recalcPack_(ctx.pack, i, email);
          ctx.packDirty = true;
        }
      });
    }
  }
  recalcFG_(ctx.fg, fi, email);
  return fi;
}

function normalizeRepackItems_(repackItems) {
  if (!repackItems) return [];
  if (typeof repackItems === "string") repackItems = repackItems.split(",");
  return repackItems.map(function (s) { return String(s).trim(); })
    .filter(function (s) { return CONFIG.REPACK_ITEMS.indexOf(s) !== -1; });
}

const ENTRY_TYPES = ["Out", "RTO-Pending", "RTO-Damage", "RTO-Repackaging"];

function isTransferChannel_(channel) { return CONFIG.TRANSFER_CHANNELS.indexOf(String(channel || "")) !== -1; }

function validateSupervisorInput_(entryType, productName, qty, channel) {
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("Enter a positive whole number of units.");
  if (ENTRY_TYPES.indexOf(entryType) === -1) throw new Error("Invalid entry type.");
  if (CONFIG.PRODUCTS.indexOf(productName) === -1) throw new Error("Invalid product.");
  if (channel && CONFIG.CHANNELS.indexOf(channel) === -1 && CONFIG.LEGACY_CHANNELS.indexOf(channel) === -1) throw new Error("Invalid channel.");
  // Amazon FBA = bulk stock moved to Amazon's warehouse. It can only go out, and it is never a sale.
  if (isTransferChannel_(channel) && entryType !== "Out") {
    throw new Error("Amazon FBA is only used for bulk stock sent to Amazon (Out). A return of that stock is handled by Amazon, not here.");
  }
}

// Extra (optional) fields of a supervisor entry - traceability for channel automation.
const SUP_EXTRA_KEYS = { orderItemId: "Order Item ID", trackingId: "Tracking ID", returnId: "Return ID", returnType: "Return Type",
                         damageReason: "Damage Reason", source: "Source", importKey: "Import Key", sku: "SKU", channelDate: "Channel Date" };
function normalizeExtra_(extra) {
  const o = {};
  if (extra && typeof extra === "string") { try { extra = JSON.parse(extra); } catch (e) { extra = {}; } }
  extra = extra || {};
  Object.keys(SUP_EXTRA_KEYS).forEach(function (k) { o[k] = extra[k] === undefined || extra[k] === null ? "" : String(extra[k]).trim(); });
  return o;
}
function setExtra_(sup, row, extra, onlyGiven) {
  Object.keys(SUP_EXTRA_KEYS).forEach(function (k) {
    const c = sup.headers.indexOf(SUP_EXTRA_KEYS[k]);
    if (c === -1) return;
    if (onlyGiven && (extra[k] === "" || extra[k] === undefined)) return;
    row[c] = extra[k] || "";
  });
}

// Supervisor tab may pre-date the newer columns; make sure the sheet + in-memory table have the full layout.
function supTable_() {
  const sup = readTable_(CONFIG.SHEETS.SUP);
  if (sup.headers.indexOf("Batch No") === -1) ensureBatchSheets_();
  if (sup.headers.indexOf("Channel Date") === -1) {
    sup.sheet.getRange(1, 1, 1, HEADERS.SUP.length).setValues([HEADERS.SUP]);
    sup.headers = HEADERS.SUP.slice();
  }
  sup.rows.forEach(function (r) { while (r.length < sup.headers.length) r.push(""); });
  return sup;
}

// CREATE  (batchNo: required for Out when the product has batches - auto-picked FEFO if blank; optional for RTO)
// extra: { orderItemId, trackingId, returnId, returnType, damageReason, source, importKey } - all optional
function recordSupervisorEntry(entryType, productName, qty, remarks, channel, orderId, repackItems, saleValue, batchNo, extra) {
  const email = requireEdit_();
  return createSupEntry_(email, entryType, productName, qty, remarks, channel, orderId, repackItems, saleValue, batchNo, extra);
}

function createSupEntry_(email, entryType, productName, qty, remarks, channel, orderId, repackItems, saleValue, batchNo, extra) {
  qty = Number(qty);
  validateSupervisorInput_(entryType, productName, qty, channel);
  repackItems = entryType === "RTO-Repackaging" ? normalizeRepackItems_(repackItems) : [];
  const ex = normalizeExtra_(extra);
  if (!ex.source) ex.source = "Manual";
  if (entryType === "RTO-Damage" && !ex.damageReason) ex.damageReason = "Other";

  const sup = supTable_();
  if (ex.importKey && findRow_(sup, "Import Key", ex.importKey) !== -1) throw new Error("Duplicate: import key already recorded (" + ex.importKey + ").");

  const ctx = { fg: readTable_(CONFIG.SHEETS.FG), pack: readTable_(CONFIG.SHEETS.PACK), packDirty: false };
  if (entryType === "Out") {
    const fi = findRow_(ctx.fg, "Product Name", productName);
    const available = fi === -1 ? 0 : n_(ctx.fg.rows[fi][7]);
    if (qty > available) throw stockError_("Not enough finished goods to dispatch " + qty + " units of " + productName + ".",
      { title: "Cannot save this entry", product: productName, requested: qty, unit: "units", maxPossible: available,
        rows: [{ item: productName + " (finished goods)", type: "Finished Goods", unit: "units", available: available, required: qty, short: qty - available }] });
  }
  const bt = batchTable_();
  const usedBatch = applyBatch_(bt, batchNo, entryType, productName, qty, +1);

  const entryId = nextEntryId_(sup);
  const prices = getPriceMasterData();
  const snap = productCostFrom_(prices, tableToObjects_(ctx.pack), productName); // cost snapshot
  snap.selling = sellingPriceFor_(prices, getChannelPrices_(), productName, channel); // channel-wise selling price

  // Sale value: Out = given or auto (price × qty). Returns are not sales - blank unless given explicitly.
  let sale = "";
  if (isTransferChannel_(channel)) sale = ""; // bulk transfer to Amazon FC - not a sale
  else if (saleValue !== "" && saleValue !== null && saleValue !== undefined) { sale = Number(saleValue); if (!Number.isFinite(sale) || sale < 0) throw new Error("Invalid sale value."); }
  else if (entryType === "Out") sale = round2_(qty * snap.selling);

  const fi = applyEffect_(ctx, entryType, productName, qty, repackItems, +1, email);
  const supRow = [entryId, new Date(), entryType, channel || "", String(orderId || "").trim(),
    productName, qty, remarks || "", email, repackItems.join(", "), snap.cost, snap.selling, sale, usedBatch];
  while (supRow.length < HEADERS.SUP.length) supRow.push("");
  setExtra_({ headers: HEADERS.SUP }, supRow, ex, false);
  appendRows_(CONFIG.SHEETS.SUP, [supRow]);
  writeRow_(ctx.fg, fi);
  if (ctx.packDirty) writeAll_(ctx.pack);
  if (bt.dirty) writeAll_(bt);
  const patch = { fg: tableToObjects_(ctx.fg), supAppend: [objRow_(HEADERS.SUP, supRow)] };
  if (ctx.packDirty) patch.pack = tableToObjects_(ctx.pack);
  if (bt.dirty) patch.batches = tableToObjects_(bt);
  return done_({ qty: qty, entryType: entryType, entryId: entryId, batchNo: usedBatch }, patch);
}

// A returned parcel that was logged as RTO-Pending has been inspected: turn it into RTO-Repackaging or RTO-Damage.
// Stock moves only now. outcome: "RTO-Repackaging" | "RTO-Damage"
function resolvePendingReturn(entryId, outcome, damageReason, repackItems, batchNo) {
  const email = requireEdit_();
  if (outcome !== "RTO-Repackaging" && outcome !== "RTO-Damage") throw new Error("Choose Repackaging or Damage.");
  const sup = supTable_();
  const si = findRow_(sup, "Entry ID", entryId);
  if (si === -1) throw new Error("Entry not found: " + entryId);
  const s = sup.rows[si];
  const cType = col_(sup, "Entry Type"), cProd = col_(sup, "Product Name"), cQty = col_(sup, "Quantity (Units)"),
        cRepack = col_(sup, "Repack Items"), cBatch = col_(sup, "Batch No"), cReason = col_(sup, "Damage Reason"),
        cRem = col_(sup, "Remarks"), cEmail = col_(sup, "Supervisor Email");
  if (s[cType] !== "RTO-Pending") throw new Error("Entry " + entryId + " is not a pending return (it is " + s[cType] + ").");
  const productName = s[cProd], qty = n_(s[cQty]);
  const items = outcome === "RTO-Repackaging" ? normalizeRepackItems_(repackItems) : [];

  const ctx = { fg: readTable_(CONFIG.SHEETS.FG), pack: readTable_(CONFIG.SHEETS.PACK), packDirty: false };
  const bt = batchTable_();
  const usedBatch = applyBatch_(bt, batchNo || s[cBatch], outcome, productName, qty, +1);
  const fi = applyEffect_(ctx, outcome, productName, qty, items, +1, email);

  s[cType] = outcome; s[cRepack] = items.join(", "); s[cBatch] = usedBatch;
  s[cReason] = outcome === "RTO-Damage" ? (String(damageReason || "").trim() || "Other") : "";
  s[cRem] = (s[cRem] ? s[cRem] + " · " : "") + "Inspected " + fmtDay_(new Date()) + " by " + email;
  if (String(s[cEmail]) === CONFIG.AGENT.AGENT_EMAIL) s[cEmail] = email;
  writeRow_(sup, si);
  writeRow_(ctx.fg, fi);
  if (ctx.packDirty) writeAll_(ctx.pack);
  if (bt.dirty) writeAll_(bt);
  logActivity_("Return Inspected", entryId + " → " + outcome + (s[cReason] ? " (" + s[cReason] + ")" : ""), productName, qty, "units", email);
  const patch = { fg: tableToObjects_(ctx.fg), supAll: tableToObjects_(sup).slice(-SRC_LIMIT), actAll: sheetToObjects_(getSheet_(CONFIG.SHEETS.ACTIVITY)).slice(-SRC_LIMIT) };
  if (ctx.packDirty) patch.pack = tableToObjects_(ctx.pack);
  if (bt.dirty) patch.batches = tableToObjects_(bt);
  return done_({ entryId: entryId, entryType: outcome, qty: qty, batchNo: usedBatch }, patch);
}

// UPDATE (old effect reversed, new effect applied - all in memory, then written once)
function updateSupervisorEntry(entryId, entryType, productName, qty, remarks, channel, orderId, repackItems, saleValue, batchNo, extra) {
  const email = requireRowEdit_();
  qty = Number(qty);
  validateSupervisorInput_(entryType, productName, qty, channel);
  repackItems = entryType === "RTO-Repackaging" ? normalizeRepackItems_(repackItems) : [];

  const sup = supTable_();
  const si = findRow_(sup, "Entry ID", entryId);
  if (si === -1) throw new Error("Entry not found: " + entryId);
  const s = sup.rows[si];
  while (s.length < sup.headers.length) s.push("");
  const cType = col_(sup, "Entry Type"), cChan = col_(sup, "Channel"), cOrder = col_(sup, "Order ID"),
        cProd = col_(sup, "Product Name"), cQty = col_(sup, "Quantity (Units)"), cRem = col_(sup, "Remarks"),
        cEmail = col_(sup, "Supervisor Email"), cRepack = col_(sup, "Repack Items"), cSale = col_(sup, "Sale Value (₹)"),
        cSell = col_(sup, "Selling Price (₹)"), cBatch = col_(sup, "Batch No");
  if (extra !== undefined && extra !== null) { // Source / Import Key are never changed by an edit
    const ex = normalizeExtra_(extra);
    ["orderItemId", "trackingId", "returnId", "returnType", "damageReason", "sku", "channelDate"].forEach(function (k) { s[col_(sup, SUP_EXTRA_KEYS[k])] = ex[k]; });
  }
  if (entryType !== "RTO-Damage") s[col_(sup, "Damage Reason")] = "";
  else if (!s[col_(sup, "Damage Reason")]) s[col_(sup, "Damage Reason")] = "Other";

  const ctx = { fg: readTable_(CONFIG.SHEETS.FG), pack: readTable_(CONFIG.SHEETS.PACK), packDirty: false };
  const bt = batchTable_();
  applyBatch_(bt, s[cBatch], s[cType], s[cProd], n_(s[cQty]), -1); // reverse old batch effect
  const oldFi = applyEffect_(ctx, s[cType], s[cProd], n_(s[cQty]), normalizeRepackItems_(s[cRepack]), -1, email);
  if (entryType === "Out") {
    const fi = findRow_(ctx.fg, "Product Name", productName);
    const available = fi === -1 ? 0 : n_(ctx.fg.rows[fi][7]);
    if (qty > available) throw stockError_("Not enough finished goods to dispatch " + qty + " units of " + productName + ".",
      { title: "Cannot save this entry", product: productName, requested: qty, unit: "units", maxPossible: available,
        rows: [{ item: productName + " (finished goods)", type: "Finished Goods", unit: "units", available: available, required: qty, short: qty - available }] });
  }
  // keep the same batch unless the caller changed it (blank = keep old when product unchanged)
  const wantBatch = (batchNo === undefined || batchNo === null || batchNo === "") && s[cProd] === productName ? s[cBatch] : batchNo;
  const usedBatch = applyBatch_(bt, wantBatch, entryType, productName, qty, +1);
  const newFi = applyEffect_(ctx, entryType, productName, qty, repackItems, +1, email);

  s[cType] = entryType; s[cChan] = channel || ""; s[cOrder] = String(orderId || "").trim();
  s[cProd] = productName; s[cQty] = qty; s[cRem] = remarks || ""; s[cEmail] = email; s[cRepack] = repackItems.join(", ");
  s[cBatch] = usedBatch;
  if (isTransferChannel_(channel)) { s[cSale] = ""; } // bulk transfer - never a sale
  else if (saleValue === "" || saleValue === null || saleValue === undefined) {
    s[cSell] = sellingPriceFor_(getPriceMasterData(), getChannelPrices_(), productName, channel);
    s[cSale] = entryType === "Out" ? round2_(qty * n_(s[cSell])) : ""; // returns are not sales
  }
  else { const sv = Number(saleValue); if (!Number.isFinite(sv) || sv < 0) throw new Error("Invalid sale value."); s[cSale] = sv; }

  writeRow_(sup, si);
  writeRow_(ctx.fg, oldFi);
  if (newFi !== oldFi) writeRow_(ctx.fg, newFi);
  if (ctx.packDirty) writeAll_(ctx.pack);
  if (bt.dirty) writeAll_(bt);
  const patch = { fg: tableToObjects_(ctx.fg), supAll: tableToObjects_(sup).slice(-SRC_LIMIT) };
  if (ctx.packDirty) patch.pack = tableToObjects_(ctx.pack);
  if (bt.dirty) patch.batches = tableToObjects_(bt);
  return done_({ qty: qty, entryType: entryType, entryId: entryId, batchNo: usedBatch }, patch);
}

// DELETE (reverses the stock effect, then removes the log row)
function deleteSupervisorEntry(entryId) {
  const email = requireSuper_();
  const sup = supTable_();
  const si = findRow_(sup, "Entry ID", entryId);
  if (si === -1) throw new Error("Entry not found: " + entryId);
  const s = sup.rows[si];

  const ctx = { fg: readTable_(CONFIG.SHEETS.FG), pack: readTable_(CONFIG.SHEETS.PACK), packDirty: false };
  const bt = batchTable_();
  applyBatch_(bt, s[col_(sup, "Batch No")], s[col_(sup, "Entry Type")], s[col_(sup, "Product Name")], n_(s[col_(sup, "Quantity (Units)")]), -1);
  const fi = applyEffect_(ctx, s[col_(sup, "Entry Type")], s[col_(sup, "Product Name")], n_(s[col_(sup, "Quantity (Units)")]),
    normalizeRepackItems_(s[col_(sup, "Repack Items")]), -1, email);

  writeRow_(ctx.fg, fi);
  if (ctx.packDirty) writeAll_(ctx.pack);
  if (bt.dirty) writeAll_(bt);
  sup.sheet.deleteRow(si + 2);
  sup.rows.splice(si, 1);
  const patch = { fg: tableToObjects_(ctx.fg), supAll: tableToObjects_(sup).slice(-SRC_LIMIT) };
  if (ctx.packDirty) patch.pack = tableToObjects_(ctx.pack);
  if (bt.dirty) patch.batches = tableToObjects_(bt);
  return done_({ entryId: entryId }, patch);
}

/* ================= ROW EDIT (Actions button - Admin only) ================= */

// Opening Stock and Min Threshold are editable. Received can be corrected by Admin (logged); Consumed is system-calculated.
function updateRawMaterialRow(productName, opening, threshold, received) {
  stockInput_(opening, false); stockInput_(threshold, true);
  if (received !== undefined && received !== null && received !== "") stockInput_(received, false);
  const email = requireRowEdit_();
  const t = readTable_(CONFIG.SHEETS.RAW);
  const i = findRow_(t, "Product Name", productName);
  if (i === -1) throw new Error("Product not found: " + productName);
  const r = t.rows[i];
  if (n_(opening) !== n_(r[2])) logActivity_("Edit: First-Time Opening", productName + " (was " + n_(r[2]) + " ml)", productName, n_(opening), "ml", email);
  if (n_(threshold) !== n_(r[7])) logActivity_("Edit: Min Threshold", productName + " (was " + n_(r[7]) + " units)", productName, n_(threshold), "ml", email);
  r[2] = n_(opening); r[7] = n_(threshold);
  if (received !== undefined && received !== null && received !== "" && n_(received) !== n_(r[3])) {
    logActivity_("Correction: Received", productName + " (was " + n_(r[3]) + " ml)", productName, n_(received), "ml", email);
    r[3] = n_(received);
  }
  recalcRaw_(t, i, email);
  writeRow_(t, i);
  return done_({ productName: productName }, { raw: tableToObjects_(t), actAll: sheetToObjects_(getSheet_(CONFIG.SHEETS.ACTIVITY)).slice(-SRC_LIMIT) });
}

// Admin: remove a product row from Raw Material (logged). Add Stock for that product re-creates the row.
function deleteRawMaterialRow(productName) {
  const email = requireSuper_();
  const t = readTable_(CONFIG.SHEETS.RAW);
  const i = findRow_(t, "Product Name", productName);
  if (i === -1) throw new Error("Product not found: " + productName);
  const r = t.rows[i];
  const act = [new Date(), "Raw Material Row Deleted", productName + " (had " + n_(r[5]) + " ml)", productName, n_(r[5]), "ml", email];
  t.sheet.deleteRow(i + 2);
  t.rows.splice(i, 1);
  logActivity_.apply(null, act.slice(1));
  return done_({ productName: productName }, { raw: tableToObjects_(t), actAppend: [objRow_(HEADERS.ACTIVITY, act)] });
}

function updatePackagingRow(itemId, opening, threshold, received) {
  stockInput_(opening, true); stockInput_(threshold, true);
  if (received !== undefined && received !== null && received !== "") stockInput_(received, true);
  const email = requireRowEdit_();
  const t = readTable_(CONFIG.SHEETS.PACK);
  const i = findRow_(t, "Item ID", itemId);
  if (i === -1) throw new Error("Packaging item not found: " + itemId);
  const r = t.rows[i];
  const label = r[1] + " (" + r[2] + ")";
  if (n_(opening) !== n_(r[3])) logActivity_("Edit: First-Time Opening", label + " (was " + n_(r[3]) + " pcs)", r[2], n_(opening), "pcs", email);
  if (n_(threshold) !== n_(r[7])) logActivity_("Edit: Min Threshold", label + " (was " + n_(r[7]) + " pcs)", r[2], n_(threshold), "pcs", email);
  r[3] = n_(opening); r[7] = n_(threshold);
  if (received !== undefined && received !== null && received !== "" && n_(received) !== n_(r[4])) {
    logActivity_("Correction: Received", r[1] + " (" + r[2] + ") (was " + n_(r[4]) + " pcs)", r[2], n_(received), "pcs", email);
    r[4] = n_(received);
  }
  recalcPack_(t, i, email);
  writeRow_(t, i);
  return done_({ itemId: itemId }, { pack: tableToObjects_(t), actAll: sheetToObjects_(getSheet_(CONFIG.SHEETS.ACTIVITY)).slice(-SRC_LIMIT) });
}

function updateFinishedGoodsRow(productName, opening, threshold) {
  stockInput_(opening, true); stockInput_(threshold, true);
  const email = requireRowEdit_();
  const t = readTable_(CONFIG.SHEETS.FG);
  const i = findRow_(t, "Product Name", productName);
  if (i === -1) throw new Error("Product not found: " + productName);
  const r = t.rows[i];
  if (n_(opening) !== n_(r[2])) logActivity_("Edit: First-Time Opening", productName + " (was " + n_(r[2]) + " units)", productName, n_(opening), "units", email);
  if (n_(threshold) !== n_(r[8])) logActivity_("Edit: Min Threshold", productName + " (was " + n_(r[8]) + " units)", productName, n_(threshold), "units", email);
  r[2] = n_(opening); r[8] = n_(threshold);
  recalcFG_(t, i, email);
  writeRow_(t, i);
  return done_({ productName: productName }, { fg: tableToObjects_(t), actAll: sheetToObjects_(getSheet_(CONFIG.SHEETS.ACTIVITY)).slice(-SRC_LIMIT) });
}

// Super Admin: remove a product row from Finished Goods (logged). Record Packing re-creates it.
function deleteFinishedGoodsRow(productName) {
  const email = requireSuper_();
  const t = readTable_(CONFIG.SHEETS.FG);
  const i = findRow_(t, "Product Name", productName);
  if (i === -1) throw new Error("Product not found: " + productName);
  const r = t.rows[i];
  const act = [new Date(), "Finished Goods Row Deleted", productName + " (had " + n_(r[7]) + " units)", productName, n_(r[7]), "units", email];
  t.sheet.deleteRow(i + 2);
  t.rows.splice(i, 1);
  logActivity_.apply(null, act.slice(1));
  return done_({ productName: productName }, { fg: tableToObjects_(t), actAppend: [objRow_(HEADERS.ACTIVITY, act)] });
}

/* ================= PRICES (Admin) ================= */

function updatePrice(itemId, costPrice, sellingPrice) {
  return updateRates([{ itemId: itemId, cost: costPrice, selling: sellingPrice }]);
}

// Batch rate update: [{itemId, cost, selling}, ...] -> one write to Price_Master, one to Price_History
function updateRates(changes) {
  const email = requireRowEdit_();
  if (!changes || !changes.length) return done_({ changed: 0 });

  const t = readTable_(CONFIG.SHEETS.PRICE);
  const idx = {};
  t.rows.forEach(function (r, i) { idx[r[0]] = i; });
  const history = [];
  const now = new Date();

  function setField(itemId, colIdx, label, value) {
    if (value === null || value === undefined || value === "") return;
    value = Number(value);
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid price for " + itemId);
    const i = idx[itemId];
    if (i === undefined) throw new Error("Item not found: " + itemId);
    const r = t.rows[i];
    const oldValue = n_(r[colIdx]);
    if (oldValue === value) return;
    r[colIdx] = value; r[6] = now; r[7] = email;
    history.push([now, itemId, r[1], r[2], label, oldValue, value, email]);
  }

  let dirty = false;
  // Channel selling prices: { product, channel, selling } (blank selling clears the channel price)
  const chChanges = changes.filter(function (c) { return c && c.product && c.channel; });
  if (chChanges.length) {
    ensureChannelPriceRows_();
    const ct = readTable_(CONFIG.SHEETS.CHPRICE);
    let chDirty = false;
    chChanges.forEach(function (c) {
      const val = (c.selling === "" || c.selling === null || c.selling === undefined) ? "" : Number(c.selling);
      if (val !== "" && (!Number.isFinite(val) || val < 0)) throw new Error("Invalid channel price for " + c.product + " / " + c.channel);
      for (let i = 0; i < ct.rows.length; i++) {
        if (String(ct.rows[i][0]).trim() === c.product && String(ct.rows[i][1]).trim() === c.channel) {
          const oldV = ct.rows[i][2] === "" ? "" : n_(ct.rows[i][2]);
          if (oldV === val) return;
          ct.rows[i][2] = val; ct.rows[i][3] = now; ct.rows[i][4] = email;
          history.push([now, "", "Finished Good", c.product + " · " + c.channel, "Selling Price (Channel)", oldV === "" ? 0 : oldV, val === "" ? 0 : val, email]);
          chDirty = true;
          return;
        }
      }
    });
    if (chDirty) writeAll_(ct);
  }
  changes = changes.filter(function (c) { return !(c && c.product && c.channel); });

  changes.forEach(function (c) {
    if (!c || !c.itemId) throw new Error("Price row missing for one of the items. Run initializeSystem() once from the Apps Script editor.");
    setField(c.itemId, 3, "Cost Price", c.cost);
    setField(c.itemId, 4, "Selling Price", c.selling);
    // Raw-material purchase calculator values (no history, just remembered for next time)
    if (c.buyPrice !== undefined || c.buyMl !== undefined) {
      const i = idx[c.itemId];
      if (i !== undefined) {
        const r = t.rows[i];
        while (r.length < HEADERS.PRICE.length) r.push("");
        const bp = c.buyPrice === "" || c.buyPrice === undefined ? "" : Number(c.buyPrice);
        const bm = c.buyMl === "" || c.buyMl === undefined ? "" : Number(c.buyMl);
        if (r[8] !== bp || r[9] !== bm) { r[8] = bp; r[9] = bm; dirty = true; }
      }
    }
  });

  if (dirty || history.some(function (h) { return h[1]; })) {
    t.headers = HEADERS.PRICE.slice(); // make sure new columns are written too
    writeAll_(t);
  }
  if (history.length) appendRows_(CONFIG.SHEETS.HISTORY, history);
  return done_({ changed: history.length }, { prices: tableToObjects_(t), chPrices: getChannelPrices_(), historyAppend: history.map(function (h) { return objRow_(HEADERS.HISTORY, h); }) });
}

/* ================= PACKAGING ITEMS CREATE / DELETE (Admin) ================= */

function addPackagingItem(itemName, applicableProduct, openingPcs, thresholdPcs) {
  const email = requireAdmin_();
  if (!itemName || !applicableProduct) throw new Error("Item name and applicable product are required.");

  const sh = getSheet_(CONFIG.SHEETS.PACK);
  const newId = "PK-" + ("00" + sh.getLastRow()).slice(-2);
  const opening = n_(openingPcs), threshold = n_(thresholdPcs);
  appendRows_(CONFIG.SHEETS.PACK, [[newId, itemName, applicableProduct, opening, 0, 0, opening, threshold, computeStatus_(opening, threshold), new Date(), email]]);

  const priceSh = getSheet_(CONFIG.SHEETS.PRICE);
  const priceId = "PR-" + ("00" + priceSh.getLastRow()).slice(-2);
  appendRows_(CONFIG.SHEETS.PRICE, [[priceId, "Packaging", packPriceName_(itemName, applicableProduct), 0, "", "pc", new Date(), email]]);
  logActivity_("Packaging Item Added", itemName + " (" + applicableProduct + ")", applicableProduct, opening, "pcs", email);
  return done_({ itemId: newId }, { pack: getPackagingData(), prices: getPriceMasterData(), actAll: sheetToObjects_(getSheet_(CONFIG.SHEETS.ACTIVITY)).slice(-SRC_LIMIT) });
}

function deletePackagingItem(itemId) {
  const email = requireSuper_();
  const t = readTable_(CONFIG.SHEETS.PACK);
  const i = findRow_(t, "Item ID", itemId);
  if (i === -1) throw new Error("Item not found: " + itemId);
  const r = t.rows[i];
  const act = [new Date(), "Packaging Item Deleted", r[1] + " (" + r[2] + ")", r[2], n_(r[6]), "pcs", email];
  t.sheet.deleteRow(i + 2);
  t.rows.splice(i, 1);
  logActivity_.apply(null, act.slice(1));
  return done_({ itemId: itemId }, { pack: tableToObjects_(t), actAppend: [objRow_(HEADERS.ACTIVITY, act)] });
}

/* ================= USER ACCESS (Admin) ================= */

function usersWithoutPasscode_() {
  const owner = ownerEmail_();
  return sheetToObjects_(getSheet_(CONFIG.SHEETS.ADMIN)).map(function (u) {
    const isOwner = String(u["Email"] || "").trim().toLowerCase() === owner;
    const perms = isOwner ? permsForRole_("Super Admin") : parsePerms_(u["Permissions"], u["Role"]);
    return { Email: u["Email"], Name: u["Name"], Role: roleLabelFor_(perms), Perms: perms, IsOwner: isOwner, HasPasscode: !!String(u["Passcode"] || "").trim(), WhatsApp: String(u["WhatsApp"] || "").trim() };
  });
}

function getUserAccessList() {
  requireUsers_();
  return usersWithoutPasscode_();
}

function normalizePhone_(p) {
  const digits = String(p || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "91" + digits;       // Indian mobile without country code
  return digits;
}

// perms = { admin, entries, edit, delete, users } (booleans). Role label is derived from the ticks.
function setUserAccess(targetEmail, name, perms, passcode, whatsapp) {
  requireUsers_();
  if (!targetEmail || String(targetEmail).indexOf("@") === -1) throw new Error("A valid email address is required.");
  const p = { admin: false, entries: false, edit: false, delete: false, users: false };
  if (typeof perms === "string") { const parsed = parsePerms_(perms === "" ? "none" : perms, ""); PERM_KEYS.forEach(function (k) { p[k] = parsed[k]; }); }
  else if (perms) PERM_KEYS.forEach(function (k) { p[k] = !!perms[k]; });
  const phone = normalizePhone_(whatsapp);
  const key = String(targetEmail).trim().toLowerCase();
  if (key === ownerEmail_() && !(p.admin && p.entries && p.edit && p.delete && p.users)) throw new Error("The script owner always has full access.");

  const t = readTable_(CONFIG.SHEETS.ADMIN);
  t.headers = HEADERS.ADMIN.slice();
  t.sheet.getRange(1, 1, 1, HEADERS.ADMIN.length).setValues([HEADERS.ADMIN]);
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][0]).trim().toLowerCase() === key) {
      while (t.rows[i].length < HEADERS.ADMIN.length) t.rows[i].push("");
      t.rows[i] = [targetEmail.trim(), name || "", roleLabelFor_(p), passcode || t.rows[i][3] || "", whatsapp === undefined ? (t.rows[i][4] || "") : phone, permsToString_(p)];
      writeRow_(t, i);
      logActivity_("User Access Updated", targetEmail.trim() + " → " + permsToString_(p), "", 0, "", getCurrentUserEmail_());
      return done_({ email: targetEmail }, { users: usersWithoutPasscode_() });
    }
  }
  appendRows_(CONFIG.SHEETS.ADMIN, [[targetEmail.trim(), name || "", roleLabelFor_(p), passcode || "", phone, permsToString_(p)]]);
  logActivity_("User Access Added", targetEmail.trim() + " → " + permsToString_(p), "", 0, "", getCurrentUserEmail_());
  return done_({ email: targetEmail }, { users: usersWithoutPasscode_() });
}

// One tick box changed in the User Access table
function toggleUserPerm(targetEmail, permKey, enabled) {
  requireUsers_();
  if (PERM_KEYS.indexOf(permKey) === -1) throw new Error("Unknown permission: " + permKey);
  const u = usersWithoutPasscode_().filter(function (x) { return String(x.Email).trim().toLowerCase() === String(targetEmail).trim().toLowerCase(); })[0];
  if (!u) throw new Error("User not found: " + targetEmail);
  if (u.IsOwner) throw new Error("The script owner always has full access.");
  const me = getCurrentUserEmail_().trim().toLowerCase();
  if (permKey === "users" && !enabled && me === String(targetEmail).trim().toLowerCase()) throw new Error("You cannot remove your own User Access permission.");
  const p = {}; PERM_KEYS.forEach(function (k) { p[k] = !!u.Perms[k]; });
  p[permKey] = !!enabled;
  return setUserAccess(u.Email, u.Name, p, "", undefined);
}

function removeUserAccess(targetEmail) {
  requireUsers_();
  if (String(targetEmail).trim().toLowerCase() === ownerEmail_()) throw new Error("The script owner cannot be removed.");
  const t = readTable_(CONFIG.SHEETS.ADMIN);
  const i = findRow_(t, "Email", targetEmail);
  if (i === -1) throw new Error("User not found: " + targetEmail);
  t.sheet.deleteRow(i + 2);
  return done_({ email: targetEmail }, { users: usersWithoutPasscode_() });
}

// Login gate. Returns role info + the dashboard, so login and first load are ONE round-trip.
function checkLoginPasscode(enteredEmail, passcode) {
  const email = String(enteredEmail || "").trim().toLowerCase();
  passcode = String(passcode || "").trim();
  if (!email || !passcode) throw new Error("Enter both email and passcode.");

  // Browser app: the "logged in" user is whoever signs in here (no Google account gate).
  window.CURRENT_EMAIL = null;
  EMAIL_ = null;
  Object.keys(ROLE_).forEach(function (k) { delete ROLE_[k]; }); // reset perm cache

  const sh = getSheet_(CONFIG.SHEETS.ADMIN);
  let lastRow = sh.getLastRow();

  // First-run bootstrap: no users yet -> the owner email creates itself + seeds the system.
  if (lastRow < 2) {
    if (email !== String(OWNER_EMAIL).trim().toLowerCase())
      throw new Error("No users exist yet. First sign in with the owner email (" + OWNER_EMAIL + ") to set up the system.");
    appendRows_(CONFIG.SHEETS.ADMIN, [[enteredEmail.trim(), "Owner", "Super Admin", passcode, "", "admin,entries,edit,delete,users"]]);
    lastRow = sh.getLastRow();
  }

  const data = sh.getRange(2, 1, lastRow - 1, 6).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) {
      const storedPasscode = String(data[i][3] || "").trim();
      if (!storedPasscode) throw new Error("No passcode set for your account. Contact your admin.");
      if (storedPasscode !== passcode) throw new Error("Incorrect passcode.");
      window.CURRENT_EMAIL = email;
      EMAIL_ = email;
      const acc = getUserAccess_(enteredEmail);
      return { role: acc.role, perms: acc.perms, isSuper: acc.perms.users, isAdmin: acc.perms.admin, canEdit: acc.perms.entries, dashboard: getDashboardData() };
    }
  }
  throw new Error("Your email is not registered. Contact your admin to get access.");
}

/* ================= ADMIN PANEL PAYLOAD ================= */

function buildAdminPayload_(raw, pack, fg, supAll, prices, chPrices, history, users, batchRows) {
  const priceMap = buildPriceMap_(prices);
  const costing = computeCostingSummary_(prices, pack, chPrices || {});
  const costByProduct = {};
  costing.forEach(function (c) { costByProduct[c.product] = c; });

  // Stock valuation at current cost
  let rmValue = 0, packValue = 0, fgValue = 0;
  raw.forEach(function (r) {
    const p = priceMap["Raw Material|" + r["Product Name"]] || {};
    rmValue += n_(r["Current Stock (ml)"]) * n_(p["Cost Price (₹)"]);
  });
  pack.forEach(function (r) {
    const p = priceMap["Packaging|" + packPriceName_(r["Item Name"], r["Applicable Product"])] || {};
    packValue += n_(r["Current Stock (Pcs)"]) * n_(p["Cost Price (₹)"]);
  });
  fg.forEach(function (r) {
    const c = costByProduct[r["Product Name"]];
    fgValue += n_(r["Current Stock (Units)"]) * (c ? c.totalCost : 0);
  });
  const valuation = { rawMaterial: round2_(rmValue), packaging: round2_(packValue), finishedGoods: round2_(fgValue), total: round2_(rmValue + packValue + fgValue) };

  // Alerts
  const alerts = [];
  raw.forEach(function (r) { if (r["Status"] !== "In Stock") alerts.push({ type: "Raw Material", name: r["Product Name"], current: r["Current Stock (Units)"] + " units (" + r["Current Stock (ml)"] + " ml)", threshold: r["Min Threshold (Units)"] + " units", status: r["Status"], page: "raw" }); });
  pack.forEach(function (r) { if (r["Status"] !== "In Stock") alerts.push({ type: "Packaging", name: r["Item Name"] + " (" + r["Applicable Product"] + ")", current: r["Current Stock (Pcs)"] + " pcs", threshold: r["Min Threshold (Pcs)"] + " pcs", status: r["Status"], page: "pack" }); });
  fg.forEach(function (r) { if (r["Status"] !== "In Stock") alerts.push({ type: "Finished Goods", name: r["Product Name"], current: r["Current Stock (Units)"] + " units", threshold: r["Min Threshold (Units)"] + " units", status: r["Status"], page: "fg" }); });
  alerts.sort(function (a, b) { return (a.status === "Out of Stock" ? 0 : 1) - (b.status === "Out of Stock" ? 0 : 1); });
  // Batch expiry alerts (only batches that still have stock)
  const expiryAlerts = batchesPayload_(batchRows || []).filter(function (b) { return b.balance > 0 && (b.expiryStatus === "Expired" || b.expiryStatus === "Expiring Soon"); })
    .map(function (b) { return { type: "Batch Expiry", name: b.batchNo + " · " + b.product, current: b.balance + " units", threshold: b.expiry ? "Exp " + b.expiry : "-", status: b.expiryStatus, daysToExpiry: b.daysToExpiry, page: "fg" }; })
    .sort(function (a, b) { return (a.daysToExpiry === null ? 9999 : a.daysToExpiry) - (b.daysToExpiry === null ? 9999 : b.daysToExpiry); });

  // Dispatch summary (this month + all time, channel-wise)
  const now = new Date();
  const monthLabel = Utilities.formatDate(now, Session.getScriptTimeZone(), "MMMM yyyy");
  function emptyBucket() { return { out: 0, damage: 0, repack: 0, outValueSelling: 0, outValueCost: 0, damageValueCost: 0 }; }
  function addTo(b, r) {
    const q = n_(r["Quantity (Units)"]), cost = n_(r["Unit Cost (₹)"]), sell = n_(r["Selling Price (₹)"]);
    const sale = (r["Sale Value (₹)"] === "" || r["Sale Value (₹)"] === undefined) ? q * sell : n_(r["Sale Value (₹)"]);
    if (r["Entry Type"] === "Out") { b.out += q; b.outValueSelling += sale; b.outValueCost += q * cost; }
    else if (r["Entry Type"] === "RTO-Damage") { b.damage += q; b.damageValueCost += q * cost; }
    else if (r["Entry Type"] === "RTO-Repackaging") { b.repack += q; }
  }
  const month = emptyBucket(), allTime = emptyBucket(), byChannel = {};
  supAll.forEach(function (r) {
    const d = new Date(r["Timestamp"]);
    addTo(allTime, r);
    if (!isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
      addTo(month, r);
      const ch = r["Channel"] || "Unspecified";
      if (!byChannel[ch]) byChannel[ch] = emptyBucket();
      addTo(byChannel[ch], r);
    }
  });
  function fin(b) { Object.keys(b).forEach(function (k) { b[k] = round2_(b[k]); }); return b; }
  const dispatch = {
    monthLabel: monthLabel, month: fin(month), allTime: fin(allTime),
    byChannel: Object.keys(byChannel).map(function (ch) { const b = fin(byChannel[ch]); b.channel = ch; return b; }).sort(function (a, b) { return b.out - a.out; })
  };

  return { costing: costing, valuation: valuation, alerts: alerts, expiryAlerts: expiryAlerts, dispatch: dispatch, priceHistory: (history || []).slice().reverse().slice(0, 50), users: users || [] };
}

/* ================= DASHBOARD (single call, source-cached) ================= */
/* All sheets are read ONCE into `src`. Everything the UI needs (tables, admin panel, analytics)
   is derived from `src` in memory. The cache stores `src` too, so after a write we only patch
   the table that changed and recompute - zero extra sheet reads. */

const SRC_LIMIT = 2500; // keep the latest N supervisor / activity rows in the source cache

function loadSources_() {
  let prices = getPriceMasterData();
  const pack = getPackagingData();
  const missing = computeCostingSummary_(prices, pack).some(function (c) {
    return !c.rmItemId || !c.fgItemId || c.packItems.some(function (p) { return !p.itemId; });
  });
  if (missing && ensurePriceRows_()) prices = getPriceMasterData();
  let actAll = [];
  try { actAll = sheetToObjects_(getSheet_(CONFIG.SHEETS.ACTIVITY)); } catch (e) { /* until initializeSystem runs */ }
  let history = [];
  try { history = sheetToObjects_(getSheet_(CONFIG.SHEETS.HISTORY)); } catch (e) { /* ignore */ }
  let batches = [];
  try {
    if (!getSS_().getSheetByName(CONFIG.SHEETS.BATCH)) ensureBatchSheets_();
    batches = sheetToObjects_(getSheet_(CONFIG.SHEETS.BATCH));
  } catch (e) { Logger.log("Batches sheet unavailable: " + e.message); }
  return {
    raw: getRawMaterialData(),
    pack: pack,
    fg: getFinishedGoodsData(),
    supAll: sheetToObjects_(getSheet_(CONFIG.SHEETS.SUP)).slice(-SRC_LIMIT),
    actAll: actAll.slice(-SRC_LIMIT),
    prices: prices,
    chPrices: getChannelPrices_(),
    history: history.slice(-100),
    users: usersWithoutPasscode_(),
    batches: batches
  };
}

// Batch summary for KPI cards / alerts (all roles)
function batchSummary_(batches) {
  const s = { total: 0, active: 0, expired: 0, expiredUnits: 0, expiringSoon: 0, expiringUnits: 0, noDate: 0, noDateUnits: 0, warnDays: CONFIG.BATCH.EXPIRY_WARN_DAYS, shelfLifeMonths: CONFIG.BATCH.SHELF_LIFE_MONTHS, periodMonths: CONFIG.BATCH.PERIOD_MONTHS };
  batches.forEach(function (b) {
    s.total++;
    if (b.balance > 0) s.active++;
    if (b.balance <= 0) return;
    if (b.expiryStatus === "Expired") { s.expired++; s.expiredUnits += b.balance; }
    else if (b.expiryStatus === "Expiring Soon") { s.expiringSoon++; s.expiringUnits += b.balance; }
    else if (b.expiryStatus === "No Date") { s.noDate++; s.noDateUnits += b.balance; }
  });
  return s;
}

function buildFromSources_(src) {
  const raw = src.raw, pack = src.pack, fg = src.fg, supAll = src.supAll, prices = src.prices, chPrices = src.chPrices || {};
  const priceMapD = buildPriceMap_(prices);
  const sellingPrices = {};
  CONFIG.PRODUCTS.forEach(function (p) {
    sellingPrices[p] = { default: n_((priceMapD["Finished Good|" + p] || {})["Selling Price (₹)"]), channels: chPrices[p] || {} };
  });
  // Supervisor KPIs (visible to all roles - no cost data here)
  const now = new Date();
  const sup = { monthLabel: Utilities.formatDate(now, Session.getScriptTimeZone(), "MMMM yyyy"),
                month: { out: 0, damage: 0, repack: 0, sale: 0, transfer: 0, entries: 0 },
                allTime: { out: 0, damage: 0, repack: 0, sale: 0, transfer: 0, entries: supAll.length } };
  supAll.forEach(function (r) {
    const q = n_(r["Quantity (Units)"]);
    const sale = (r["Sale Value (₹)"] === "" || r["Sale Value (₹)"] === undefined) ? q * n_(r["Selling Price (₹)"]) : n_(r["Sale Value (₹)"]);
    const d = new Date(r["Timestamp"]);
    const buckets = [sup.allTime];
    if (!isNaN(d.getTime()) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) { buckets.push(sup.month); sup.month.entries++; }
    const isTransfer = isTransferChannel_(r["Channel"]);
    buckets.forEach(function (b) {
      if (r["Entry Type"] === "Out") { b.out += q; if (isTransfer) b.transfer += q; else b.sale += sale; }
      else if (r["Entry Type"] === "RTO-Damage") b.damage += q;
      else if (r["Entry Type"] === "RTO-Repackaging") b.repack += q;
    });
  });
  sup.month.sale = round2_(sup.month.sale); sup.allTime.sale = round2_(sup.allTime.sale);
  // Returned parcels waiting for inspection (Repackaging / Damage) - all of them, newest first
  const pendingReturns = supAll.filter(function (r) { return r["Entry Type"] === "RTO-Pending"; }).reverse();

  // Last "Add Stock" entry per item (from the Activity Log) - shown as "Last Received" in the tables
  const lastReceived = { pack: {}, raw: {} };
  (src.actAll || []).forEach(function (a) {
    const t = String(a["Type"] || "");
    if (t === "Received Packaging") lastReceived.pack[String(a["Item"]).trim()] = { qty: n_(a["Quantity"]), ts: a["Timestamp"] };
    else if (t === "Received Raw Material") lastReceived.raw[String(a["Product"]).trim()] = { qty: n_(a["Quantity"]), ts: a["Timestamp"] };
  });

  const batches = batchesPayload_(src.batches || []);
  const admin = buildAdminPayload_(raw, pack, fg, supAll, prices, chPrices, src.history, src.users, src.batches);
  return {
    rawMaterial: raw, packaging: pack, finishedGoods: fg,
    sellingPrices: sellingPrices,
    supSummary: sup,
    supervisorEntries: supAll.slice().reverse().slice(0, 150),
    pendingReturns: pendingReturns,
    products: CONFIG.PRODUCTS, channels: CONFIG.CHANNELS, repackItems: CONFIG.REPACK_ITEMS,
    transferChannels: CONFIG.TRANSFER_CHANNELS,
    damageReasons: CONFIG.DAMAGE_REASONS,
    batches: batches,
    lastReceived: lastReceived,
    batchSummary: batchSummary_(batches),
    admin: admin,
    analytics: { admin: computeAnalytics_({ range: "month" }, src, admin.costing, true), user: computeAnalytics_({ range: "month" }, src, [], false) },
    _src: src
  };
}

function buildDashboard_() { return buildFromSources_(loadSources_()); }

function readCache_() {
  const hit = CacheService.getScriptCache().get(CACHE_KEY);
  if (!hit) return null;
  try {
    const bytes = Utilities.base64Decode(hit);
    return JSON.parse(Utilities.ungzip(Utilities.newBlob(bytes, "application/x-gzip")).getDataAsString());
  } catch (e) { return null; }
}
function putCache_(value) {
  try {
    const gz = Utilities.gzip(Utilities.newBlob(JSON.stringify(value)));
    CacheService.getScriptCache().put(CACHE_KEY, Utilities.base64Encode(gz.getBytes()), CACHE_TTL_SECONDS);
  } catch (e) { /* too large - skip */ }
}

// Fresh payload; `patch` = {raw|pack|fg|supAll|actAll|prices|chPrices|history|users, actAppend:[], supAppend:[], historyAppend:[]}
function refreshDashboard_(patch) {
  let src = null;
  const cached = patch ? readCache_() : null;
  if (cached && cached._src) {
    src = cached._src;
    ["raw", "pack", "fg", "supAll", "actAll", "prices", "chPrices", "history", "users", "batches"].forEach(function (k) { if (patch[k] !== undefined) src[k] = patch[k]; });
    if (patch.actAppend) src.actAll = (src.actAll || []).concat(patch.actAppend).slice(-SRC_LIMIT);
    if (patch.supAppend) src.supAll = (src.supAll || []).concat(patch.supAppend).slice(-SRC_LIMIT);
    if (patch.historyAppend) src.history = (src.history || []).concat(patch.historyAppend).slice(-100);
  } else {
    src = loadSources_();
  }
  const payload = buildFromSources_(src);
  putCache_(payload);
  return payload;
}

function finalizeForUser_(payload) {
  const email = getCurrentUserEmail_();
  const role = getUserRole_(email);
  const out = {};
  Object.keys(payload).forEach(function (k) { if (k !== "_src") out[k] = payload[k]; });
  const perms = getUserAccess_(email).perms;
  out.perms = perms;
  out.isSuper = perms.users;       // User Access panel
  out.isAdmin = perms.admin;       // Admin Panel + cost data
  out.canEdit = perms.entries;     // add entries
  out.canEditRows = perms.edit;    // Edit buttons
  out.canDelete = perms.delete;    // Delete buttons
  out.role = role;
  out.userEmail = email;
  if (perms.users && payload.admin) out.users = payload.admin.users || [];
  out.analytics = out.isAdmin ? payload.analytics.admin : payload.analytics.user;
  if (!out.isAdmin) {
    delete out.admin; // costing, valuation, users etc. are Admin-only
    const strip = function (r) { const c = {}; Object.keys(r).forEach(function (k) { if (k !== "Unit Cost (₹)" && k !== "Selling Price (₹)") c[k] = r[k]; }); return c; };
    out.supervisorEntries = (out.supervisorEntries || []).map(strip);
    out.pendingReturns = (out.pendingReturns || []).map(strip);
  }
  return JSON.parse(JSON.stringify(out));
}

function getDashboardData() {
  let payload = readCache_();
  if (!payload || !payload._src) payload = refreshDashboard_(null);
  return finalizeForUser_(payload);
}

// Kept for compatibility
function getAdminPanelData() {
  requireAdmin_();
  return getDashboardData().admin;
}

/* ================= CHANGE HISTORY ================= */
/* Every change that touched a panel, newest first. scope: raw | pack | fg | all.
   Sources: Activity_Log (received, packing, corrections, edits, item add/delete, batch edits) + Supervisor_Entries (Out / RTO). */
function getChangeHistory(scope, limit) {
  scope = String(scope || "all");
  limit = Math.min(Number(limit) || 400, 2000);
  let payload = readCache_();
  if (!payload || !payload._src) payload = refreshDashboard_(null);
  const src = payload._src;
  const isAdmin = isAdminUser_(getCurrentUserEmail_());
  const rows = [];
  (src.actAll || []).forEach(function (r) {
    const unit = String(r["Unit"] || ""), type = String(r["Type"] || "");
    const isPacking = type === "Packing";
    const touchesRaw = unit === "ml" || isPacking;
    const touchesPack = unit === "pcs" || isPacking;
    const touchesFg = unit === "units" || isPacking;
    if (scope === "raw" && !touchesRaw) return;
    if (scope === "pack" && !touchesPack) return;
    if (scope === "fg" && !touchesFg) return;
    let effect = "";
    if (isPacking) effect = scope === "raw" ? "− " + (n_(r["Quantity"]) * CONFIG.CONVERSION_FACTOR) + " ml consumed" : (scope === "pack" ? "− " + n_(r["Quantity"]) + " pcs of each applicable item" : "+ " + n_(r["Quantity"]) + " units");
    else if (type.indexOf("Received") === 0) effect = "+ " + n_(r["Quantity"]) + " " + unit;
    else if (type.indexOf("Correction") === 0 || type.indexOf("Edit") === 0) effect = "set to " + n_(r["Quantity"]) + " " + (type.indexOf("Threshold") !== -1 && unit === "ml" ? "units" : unit);
    else if (type === "Packaging Item Deleted") effect = "removed (had " + n_(r["Quantity"]) + " pcs)";
    else if (type === "Raw Material Row Deleted") effect = "row removed (had " + n_(r["Quantity"]) + " ml)";
    else if (type === "Raw Material Row Re-created") effect = "row re-created with 0 ml";
    else if (type === "Finished Goods Row Deleted") effect = "row removed (had " + n_(r["Quantity"]) + " units)";
    else if (type === "Finished Goods Row Re-created") effect = "row re-created with 0 units";
    else if (type === "Packaging Item Added") effect = "created with " + n_(r["Quantity"]) + " pcs";
    else if (type === "Batch Updated") effect = "dates / notes changed";
    rows.push({ ts: r["Timestamp"], type: type, item: r["Item"], product: r["Product"], qty: r["Quantity"], unit: unit, effect: effect, user: r["User"], ref: "" });
  });
  if (scope === "fg" || scope === "pack" || scope === "all") {
    (src.supAll || []).forEach(function (r) {
      const t = r["Entry Type"], q = n_(r["Quantity (Units)"]);
      if (scope === "pack" && !(t === "RTO-Repackaging" && r["Repack Items"])) return;
      let effect = t === "Out" ? "− " + q + " units dispatched" : (t === "RTO-Damage" ? q + " units damaged (loss)" : (t === "RTO-Pending" ? q + " units returned — awaiting inspection (no stock change)" : "+ " + q + " units back to stock"));
      if (scope === "pack") effect = "− " + q + " pcs each: " + r["Repack Items"];
      rows.push({ ts: r["Timestamp"], type: "Supervisor: " + t, item: r["Product Name"] + (r["Batch No"] ? " · " + r["Batch No"] : ""), product: r["Product Name"], qty: q, unit: "units", effect: effect, user: r["Supervisor Email"],
        ref: [r["Channel"], r["Order ID"]].filter(Boolean).join(" · ") + (isAdmin && r["Sale Value (₹)"] !== "" && r["Sale Value (₹)"] !== undefined ? " · ₹" + r["Sale Value (₹)"] : "") });
    });
  }
  rows.sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); });
  return JSON.parse(JSON.stringify({ scope: scope, total: rows.length, rows: rows.slice(0, limit) }));
}

/* Full price-change history (read on demand, newest first). The dashboard payload only
   carries the latest few rows; this is what the "Price Change History" button loads. */
function getPriceHistory(limit) {
  requireAdmin_();
  limit = Math.min(Number(limit) || 1000, 5000);
  let rows = [];
  try { rows = sheetToObjects_(getSheet_(CONFIG.SHEETS.HISTORY)); } catch (e) { rows = []; }
  const out = rows.slice(-limit).reverse().map(function (r) {
    return { ts: r["Timestamp"], itemId: r["Item ID"], itemType: r["Item Type"], item: r["Item Name"],
             field: r["Field"], oldValue: n_(r["Old Value (₹)"]), newValue: n_(r["New Value (₹)"]), user: r["Changed By"] };
  });
  return JSON.parse(JSON.stringify({ total: rows.length, rows: out }));
}

/* ================= PERIOD (DATE FILTER) ================= */
/* Movement of every item between two dates, so the stock tabs can show
   "what came in / what went out" for a chosen period instead of lifetime totals.
   Current Stock always stays live - stock is a snapshot, not a period figure. */
function getPeriodMovement(fromStr, toStr) {
  const from = dayStart_(toDate_(fromStr) || new Date());
  const to = dayStart_(toDate_(toStr) || new Date());
  const end = addDays_(to < from ? from : to, 1);
  const start = to < from ? to : from;
  let payload = readCache_();
  if (!payload || !payload._src) payload = refreshDashboard_(null);
  const src = payload._src;
  const packRows = src.pack || [];
  const inRange = function (ts) { const t = new Date(ts); return !isNaN(t.getTime()) && t >= start && t < end; };

  const raw = {}, pack = {}, fg = {};
  const rawOf = function (k) { if (!raw[k]) raw[k] = { received: 0, consumed: 0 }; return raw[k]; };
  const packOf = function (k) { if (!pack[k]) pack[k] = { received: 0, consumed: 0 }; return pack[k]; };
  const fgOf = function (k) { if (!fg[k]) fg[k] = { packed: 0, out: 0, damage: 0, repack: 0 }; return fg[k]; };

  (src.actAll || []).forEach(function (a) {
    if (!inRange(a["Timestamp"])) return;
    const type = String(a["Type"] || ""), q = n_(a["Quantity"]), product = String(a["Product"] || "").trim();
    if (type === "Received Raw Material") rawOf(product).received += q;
    else if (type === "Received Packaging") packOf(String(a["Item"] || "").trim()).received += q;
    else if (type === "Packing") {
      rawOf(product).consumed += q * CONFIG.CONVERSION_FACTOR;
      fgOf(product).packed += q;
      packRows.forEach(function (r) {
        const appl = r["Applicable Product"];
        if (appl === "All" || appl === product) packOf(r["Item Name"] + " (" + appl + ")").consumed += q;
      });
    }
  });

  (src.supAll || []).forEach(function (r) {
    if (!inRange(r["Timestamp"])) return;
    const product = String(r["Product Name"] || "").trim(), q = n_(r["Quantity (Units)"]), type = r["Entry Type"];
    const b = fgOf(product);
    if (type === "Out") b.out += q;
    else if (type === "RTO-Damage") b.damage += q;
    else if (type === "RTO-Repackaging") {
      b.repack += q;
      String(r["Repack Items"] || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (item) {
        packRows.forEach(function (pr) {
          const appl = pr["Applicable Product"];
          if (pr["Item Name"] === item && (appl === "All" || appl === product)) packOf(item + " (" + appl + ")").consumed += q;
        });
      });
    }
  });

  return JSON.parse(JSON.stringify({ from: fmtDay_(start), to: fmtDay_(addDays_(end, -1)), raw: raw, pack: pack, fg: fg }));
}

/* ================= AI ASSISTANT (Google Gemini) ================= */
/* SETUP (one time): Apps Script editor -> Project Settings (gear icon) -> Script Properties -> Add property:
     GEMINI_API_KEY = your key from aistudio.google.com   (required)
     GEMINI_MODEL   = gemini-3.6-flash                    (optional, default below)
   The key never reaches the browser.
   The assistant only sees the data the asking user's role is allowed to see.
   Actions are NOT executed by the AI - it proposes them, the user confirms in the UI,
   and the normal server functions (with their permission checks) do the save. */

const AI_DEFAULT_MODEL = "gemini-3.6-flash";
// If the configured model is retired (404), these are tried in order.
const AI_FALLBACK_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash", "gemini-flash-latest", "gemini-2.5-flash"];

function getAssistantStatus() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("GEMINI_API_KEY") || "";
  return { configured: !!key, model: props.getProperty("GEMINI_MODEL") || AI_DEFAULT_MODEL, keyHint: key ? "••••" + key.slice(-4) : "" };
}

// Compact, role-filtered snapshot of the system for the model
function assistantContext_() {
  const d = getDashboardData();
  const ctx = {
    today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd MMM yyyy"),
    user: { email: d.userEmail, role: d.role, permissions: d.perms, canEdit: d.canEdit },
    unitRule: "1 unit = 1 bottle = 30 ml of raw material",
    products: d.products,
    channels: d.channels,
    repackItems: d.repackItems,
    rawMaterial: d.rawMaterial.map(function (r) { return { product: r["Product Name"], currentMl: r["Current Stock (ml)"], currentUnits: r["Current Stock (Units)"], minUnits: r["Min Threshold (Units)"], status: r["Status"] }; }),
    packaging: d.packaging.map(function (r) { return { itemId: r["Item ID"], item: r["Item Name"], forProduct: r["Applicable Product"], currentPcs: r["Current Stock (Pcs)"], minPcs: r["Min Threshold (Pcs)"], status: r["Status"] }; }),
    finishedGoods: d.finishedGoods.map(function (r) { return { product: r["Product Name"], currentUnits: r["Current Stock (Units)"], packed: r["Total Packed (Units)"], out: r["Total Out (Units)"], damage: r["Total Damage (Units)"], repack: r["Total Repackaging (Units)"], minUnits: r["Min Threshold (Units)"], status: r["Status"] }; }),
    supervisorSummary: d.supSummary,
    batchRules: "Batches exist only for Finished Goods. Each product has one open batch at a time (MG-<code>-<YYMMDD>); packing adds to it for " + CONFIG.BATCH.PERIOD_MONTHS + " months, then the next packing starts a new batch with a new Mfg date. Expiry = Mfg + " + CONFIG.BATCH.SHELF_LIFE_MONTHS + " months (5 years). Out entries are booked against a batch (FEFO = earliest expiry first). Expired batches cannot be dispatched.",
    batchSummary: d.batchSummary,
    batches: (d.batches || []).filter(function (b) { return b.balance > 0 || b.expiryStatus !== "OK"; }).slice(0, 80).map(function (b) {
      return { batchNo: b.batchNo, product: b.product, mfg: b.mfg, expiry: b.expiry, daysToExpiry: b.daysToExpiry, status: b.expiryStatus, packed: b.packed, out: b.out, damage: b.damage, repack: b.repack, balance: b.balance };
    }),
    recentSupervisorEntries: (d.supervisorEntries || []).slice(0, 40).map(function (r) {
      return { id: r["Entry ID"], date: r["Timestamp"], type: r["Entry Type"], channel: r["Channel"], orderId: r["Order ID"], product: r["Product Name"], qty: r["Quantity (Units)"], batchNo: r["Batch No"], saleValue: r["Sale Value (₹)"], remarks: r["Remarks"] };
    })
  };
  if (d.admin) {
    ctx.admin = {
      stockValuation: d.admin.valuation,
      costing: d.admin.costing.map(function (c) { return { product: c.product, rawMaterialCost: c.rawMaterialCost, packagingCost: c.packagingCost, totalCost: c.totalCost, sellingPrice: c.sellingPrice, channelPrices: c.channelPrices.filter(function (x) { return x.price !== ""; }), margin: c.margin, marginPct: c.marginPct }; }),
      dispatch: d.admin.dispatch,
      alerts: d.admin.alerts,
      expiryAlerts: d.admin.expiryAlerts
    };
  }
  return ctx;
}

const AI_SYSTEM_PROMPT = [
  "You are the inventory assistant for Meethi Golee (homeopathy products, Mushroom World Group).",
  "Answer ONLY from the DATA JSON provided. If something is not in the data, say you don't have that information.",
  "Reply in clear, professional English by default. Only if the user writes in Hindi or Hinglish, reply in that language. Be concise and specific; use exact numbers from the data.",
  "Indian number format (1,00,000). Currency is ₹.",
  "TERMINOLOGY: 'First-Time Opening' (sheet column 'Opening Stock') = stock on the day the system started, entered once. 'Current Stock' = live stock now. There is no daily opening entry; today's closing is tomorrow's opening automatically.",
  "STOCK RULES: Packing consumes 30 ml raw material + every applicable packaging item per unit and adds to Finished Goods.",
  "Out (Dispatch) reduces Finished Goods only. RTO-Damage is a loss log (no stock change). RTO-Repackaging adds back to Finished Goods and consumes the replaced packaging.",
  "ACCESS: user.permissions has admin (Admin Panel), entries (add entries), edit, delete, users (User Access). The role label is derived from these ticks.",
  "COST / PRICE / MARGIN / VALUATION data is only present if the user is Admin or Super Admin. If it is absent, politely say that information is only available to Admin.",
  "ACTIONS: If the user clearly asks to RECORD something and user.canEdit is true, fill the `action` object; otherwise action must be null.",
  "Action types: received_raw {product, qtyMl}; received_pack {itemId, qtyPcs}; packing {product, qty}; supervisor {entryType: Out|RTO-Damage|RTO-Repackaging, product, qty, channel, orderId, remarks, repackItems[], saleValue, batchNo}.",
  "BATCHES: use the `batches` list for questions about batch numbers, manufacturing / expiry dates, expired or expiring stock and batch balances. For a supervisor Out action, set batchNo to the batch with the earliest expiry that has enough balance (FEFO); leave it blank if unsure and the system will pick FEFO.",
  "Use exact product names / itemIds / channel names from DATA. If any required field is missing or ambiguous, ask a follow-up question instead of guessing and keep action null.",
  "When proposing an action, the reply should summarise what will be recorded and say the user must confirm. Never claim something was saved - saving happens only after the user confirms in the app.",
  "ALWAYS fill `suggestions` with exactly 3 short follow-up questions (max 60 chars each) that this user should also know, based on the DATA and the current topic - e.g. items about to run out, a product with low margin (Admin only), returns this month, stock enough for next order. Write them in professional English (or the user's language if they wrote in Hindi/Hinglish)."
].join("\n");

const AI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    suggestions: { type: "ARRAY", items: { type: "STRING" } },
    action: {
      type: "OBJECT", nullable: true,
      properties: {
        type: { type: "STRING" }, product: { type: "STRING" }, qty: { type: "NUMBER" }, qtyMl: { type: "NUMBER" },
        itemId: { type: "STRING" }, qtyPcs: { type: "NUMBER" }, entryType: { type: "STRING" }, channel: { type: "STRING" },
        orderId: { type: "STRING" }, remarks: { type: "STRING" }, repackItems: { type: "ARRAY", items: { type: "STRING" } }, saleValue: { type: "NUMBER" }, batchNo: { type: "STRING" }
      }
    }
  },
  required: ["reply"]
};

// history: [{role:'user'|'model', text}] (last few turns)
function askAssistant(message, history) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("AI assistant is not configured yet. Admin: add GEMINI_API_KEY in Apps Script → Project Settings → Script Properties.");
  const model = props.getProperty("GEMINI_MODEL") || AI_DEFAULT_MODEL;
  message = String(message || "").trim();
  if (!message) throw new Error("Empty message.");

  const ctx = assistantContext_();
  const contents = [];
  (history || []).slice(-10).forEach(function (h) {
    if (h && h.text) contents.push({ role: h.role === "model" ? "model" : "user", parts: [{ text: String(h.text).slice(0, 2000) }] });
  });
  contents.push({ role: "user", parts: [{ text: message.slice(0, 2000) }] });

  const body = {
    systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT + "\n\nDATA:\n" + JSON.stringify(ctx) }] },
    contents: contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json", responseSchema: AI_RESPONSE_SCHEMA }
  };

  // Try the configured model first, then fallbacks if Google has retired it (404).
  const candidates = [model].concat(AI_FALLBACK_MODELS.filter(function (m) { return m !== model; }));
  let code = 0, text = "", usedModel = model;
  for (let i = 0; i < candidates.length; i++) {
    usedModel = candidates[i];
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(usedModel) + ":generateContent?key=" + encodeURIComponent(key);
    const resp = UrlFetchApp.fetch(url, { method: "post", contentType: "application/json", payload: JSON.stringify(body), muteHttpExceptions: true });
    code = resp.getResponseCode();
    text = resp.getContentText();
    if (code !== 404) break;
  }
  if (usedModel !== model && code < 400) props.setProperty("GEMINI_MODEL", usedModel); // remember the working model
  if (code === 429) throw new Error("AI is busy right now (rate limit). Please try again in a minute.");
  if (code >= 400) {
    let msg = "AI request failed (" + code + ").";
    try { msg += " " + (JSON.parse(text).error.message || ""); } catch (e) { /* ignore */ }
    throw new Error(msg);
  }

  let raw = "";
  try {
    const json = JSON.parse(text);
    raw = json.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("");
  } catch (e) {
    throw new Error("AI returned an unexpected response. Try again.");
  }
  let out;
  try { out = JSON.parse(raw); } catch (e) { out = { reply: raw, action: null }; }
  if (!ctx.user.canEdit) out.action = null; // View users can never trigger actions
  if (out.action && !out.action.type) out.action = null;
  const suggestions = (out.suggestions || []).map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 3);
  return { reply: out.reply || "", action: out.action || null, suggestions: suggestions };
}


/* ================= EMAIL ALERTS ================= */
/* Instant: after every save, any item whose status just dropped (In Stock -> Low / Low -> Out)
   is emailed once. Daily: run setupDailyAlertTrigger() ONCE from the editor to get a summary
   of all Low / Out items every morning at CONFIG.ALERTS.DAILY_HOUR. */

function alertRecipients_() {
  const sh = getSheet_(CONFIG.SHEETS.ADMIN);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = Math.max(sh.getLastColumn(), HEADERS.ADMIN.length);
  return sh.getRange(2, 1, last - 1, width).getValues()
    .filter(function (r) {
      const p = parsePerms_(r[5], r[2]);
      return String(r[0]).indexOf("@") !== -1 && (p.admin || p.entries);
    })
    .map(function (r) { return String(r[0]).trim(); });
}

// Current status of every tracked item, keyed by "Type|Name"
function currentStatusMap_(d) {
  const map = {};
  d.rawMaterial.forEach(function (r) { map["Raw Material|" + r["Product Name"]] = { status: r["Status"], current: r["Current Stock (Units)"] + " units (" + r["Current Stock (ml)"] + " ml)", min: r["Min Threshold (Units)"] + " units" }; });
  d.packaging.forEach(function (r) { map["Packaging|" + r["Item Name"] + " (" + r["Applicable Product"] + ")"] = { status: r["Status"], current: r["Current Stock (Pcs)"] + " pcs", min: r["Min Threshold (Pcs)"] + " pcs" }; });
  d.finishedGoods.forEach(function (r) { map["Finished Goods|" + r["Product Name"]] = { status: r["Status"], current: r["Current Stock (Units)"] + " units", min: r["Min Threshold (Units)"] + " units" }; });
  return map;
}

const STATUS_RANK_ = { "In Stock": 0, "Low Stock": 1, "Out of Stock": 2 };

function sendInstantAlerts_(dashboard) {
  if (!CONFIG.ALERTS.ENABLED || !CONFIG.ALERTS.INSTANT) return;
  const props = PropertiesService.getScriptProperties();
  const now = currentStatusMap_(dashboard);
  let prev = {};
  try { prev = JSON.parse(props.getProperty("ALERT_STATUS") || "{}"); } catch (e) { prev = {}; }

  const dropped = [];
  Object.keys(now).forEach(function (k) {
    const before = prev[k] === undefined ? "In Stock" : prev[k];
    if ((STATUS_RANK_[now[k].status] || 0) > (STATUS_RANK_[before] || 0)) {
      const parts = k.split("|");
      dropped.push({ type: parts[0], name: parts[1], status: now[k].status, current: now[k].current, min: now[k].min });
    }
  });

  // remember current statuses for next comparison
  const snapshot = {};
  Object.keys(now).forEach(function (k) { snapshot[k] = now[k].status; });
  props.setProperty("ALERT_STATUS", JSON.stringify(snapshot));

  if (!dropped.length) return;
  const to = alertRecipients_();
  if (!to.length) return;

  const outCount = dropped.filter(function (a) { return a.status === "Out of Stock"; }).length;
  const subject = "[Meethi Golee Inventory] " + (outCount ? outCount + " item(s) OUT OF STOCK" : dropped.length + " item(s) below minimum threshold");
  MailApp.sendEmail({ to: to.join(","), subject: subject, htmlBody: alertEmailHtml_("Stock Alert", "The following items just dropped below their minimum threshold:", dropped), name: "Meethi Golee Inventory" });
  try { sendWhatsAppAlert_("Stock Alert", dropped); } catch (e) { Logger.log("WhatsApp alert failed: " + e.message); }
}

// Daily summary of everything currently Low / Out (time-driven trigger)
function sendDailyAlertSummary() {
  if (!CONFIG.ALERTS.ENABLED) return;
  const d = getDashboardData();
  const now = currentStatusMap_(d);
  const items = [];
  Object.keys(now).forEach(function (k) {
    if (now[k].status !== "In Stock") {
      const parts = k.split("|");
      items.push({ type: parts[0], name: parts[1], status: now[k].status, current: now[k].current, min: now[k].min });
    }
  });
  items.sort(function (a, b) { return (STATUS_RANK_[b.status] || 0) - (STATUS_RANK_[a.status] || 0); });
  // Batch expiry: expired + expiring within CONFIG.BATCH.EXPIRY_WARN_DAYS (batches that still have stock)
  (d.batches || []).forEach(function (b) {
    if (b.balance > 0 && (b.expiryStatus === "Expired" || b.expiryStatus === "Expiring Soon")) {
      items.push({ type: "Batch Expiry", name: b.batchNo + " (" + b.product + ")", status: b.expiryStatus, current: b.balance + " units",
                   min: b.expiryStatus === "Expired" ? "Expired " + b.expiry : "Expires " + b.expiry + " (" + b.daysToExpiry + " days)" });
    }
  });
  if (!items.length) return; // nothing to report
  const to = alertRecipients_();
  if (!to.length) return;
  const outCount = items.filter(function (a) { return a.status === "Out of Stock"; }).length;
  const lowCount = items.filter(function (a) { return a.status === "Low Stock"; }).length;
  const expCount = items.filter(function (a) { return a.type === "Batch Expiry"; }).length;
  const subject = "[Meethi Golee Inventory] Daily summary: " + outCount + " out of stock, " + lowCount + " low" + (expCount ? ", " + expCount + " batch(es) expiring / expired" : "");
  MailApp.sendEmail({ to: to.join(","), subject: subject, htmlBody: alertEmailHtml_("Daily Stock Summary", "Items below their minimum threshold and batches nearing expiry as of " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd MMM yyyy, hh:mm a") + ":", items), name: "Meethi Golee Inventory" });
  try { sendWhatsAppAlert_("Daily Stock Summary", items); } catch (e) { Logger.log("WhatsApp summary failed: " + e.message); }
}

// Run ONCE from the editor to install the daily summary trigger (safe to re-run).
function setupDailyAlertTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendDailyAlertSummary") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendDailyAlertSummary").timeBased().atHour(CONFIG.ALERTS.DAILY_HOUR).everyDays(1).create();
  Logger.log("Daily alert summary scheduled at " + CONFIG.ALERTS.DAILY_HOUR + ":00 every day.");
}

// Run from the editor to test that alert emails reach you.
function sendTestAlertEmail() {
  const to = alertRecipients_();
  if (!to.length) throw new Error("No Admin/Executive emails found in Admin_Access.");
  MailApp.sendEmail({ to: to.join(","), subject: "[Meethi Golee Inventory] Test alert", htmlBody: alertEmailHtml_("Test Alert", "Email alerts are working. Recipients: " + to.join(", "), []), name: "Meethi Golee Inventory" });
  Logger.log("Test email sent to: " + to.join(", "));
}

function alertEmailHtml_(title, intro, items) {
  const color = function (st) { return (st === "Out of Stock" || st === "Expired") ? "#d92d20" : ((st === "Low Stock" || st === "Expiring Soon") ? "#b5730a" : "#17b26a"); };
  const bg = function (st) { return (st === "Out of Stock" || st === "Expired") ? "#fdecec" : "#fef3e2"; };
  let rows = items.map(function (a) {
    return "<tr>" +
      "<td style='padding:10px 12px;border-bottom:1px solid #eee'>" + a.type + "</td>" +
      "<td style='padding:10px 12px;border-bottom:1px solid #eee;font-weight:600'>" + a.name + "</td>" +
      "<td style='padding:10px 12px;border-bottom:1px solid #eee'>" + a.current + "</td>" +
      "<td style='padding:10px 12px;border-bottom:1px solid #eee'>" + a.min + "</td>" +
      "<td style='padding:10px 12px;border-bottom:1px solid #eee'><span style='background:" + bg(a.status) + ";color:" + color(a.status) + ";padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700'>" + a.status + "</span></td>" +
      "</tr>";
  }).join("");
  const table = items.length
    ? "<table style='border-collapse:collapse;width:100%;font-size:13px;background:#fff;border:1px solid #eee;border-radius:8px'>" +
      "<tr style='background:#17203a;color:#fff'><th style='padding:10px 12px;text-align:left'>Type</th><th style='padding:10px 12px;text-align:left'>Item</th><th style='padding:10px 12px;text-align:left'>Current</th><th style='padding:10px 12px;text-align:left'>Minimum / Expiry</th><th style='padding:10px 12px;text-align:left'>Status</th></tr>" +
      rows + "</table>"
    : "";
  const link = CONFIG.ALERTS.APP_URL ? "<p style='margin-top:18px'><a href='" + CONFIG.ALERTS.APP_URL + "' style='background:#006D5B;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700'>Open Dashboard</a></p>" : "";
  return "<div style='font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;background:#f6f8fb;padding:24px'>" +
    "<div style='background:#006D5B;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700'>Meethi Golee Inventory — " + title + "</div>" +
    "<div style='background:#fff;padding:20px;border-radius:0 0 10px 10px;border:1px solid #e6e9f0'>" +
    "<p style='font-size:14px;color:#1f2430;margin-top:0'>" + intro + "</p>" + table + link +
    "<p style='font-size:11px;color:#8a90a3;margin-top:20px'>Automated alert from the Meethi Golee Inventory System. You receive this because your email has Admin or Executive access.</p>" +
    "</div></div>";
}


/* ================= WHATSAPP ALERTS ================= */
/* Provider is chosen in Script Properties (Project Settings -> Script Properties):
     WA_PROVIDER = meta   -> WA_TOKEN (permanent access token), WA_PHONE_ID (phone number ID),
                            WA_TEMPLATE (approved template name, optional), WA_TEMPLATE_LANG (default en)
     WA_PROVIDER = twilio -> TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM (e.g. whatsapp:+14155238886)
   Recipients: "WhatsApp" column in Admin_Access (Admin/Edit roles), numbers with country code (91xxxxxxxxxx).
   NOTE: WhatsApp only delivers business-initiated messages via an APPROVED TEMPLATE, unless the person
   messaged your business number within the last 24 hours. For Meta, create a utility template like
   "stock_alert" with body "{{1}}" and set WA_TEMPLATE=stock_alert. */

function whatsappRecipients_() {
  const sh = getSheet_(CONFIG.SHEETS.ADMIN);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = Math.max(sh.getLastColumn(), HEADERS.ADMIN.length);
  return sh.getRange(2, 1, last - 1, width).getValues()
    .filter(function (r) {
      const p = parsePerms_(r[5], r[2]);
      return (p.admin || p.entries) && normalizePhone_(r[4]);
    })
    .map(function (r) { return normalizePhone_(r[4]); });
}

function whatsappText_(title, items) {
  const lines = ["*Meethi Golee Inventory - " + title + "*", ""];
  items.slice(0, 15).forEach(function (a) {
    const dot = (a.status === "Out of Stock" || a.status === "Expired") ? "🔴" : "🟠";
    lines.push(dot + " " + a.name + " (" + a.type + "): " + a.current + (a.type === "Batch Expiry" ? " | " + a.min : " | min " + a.min));
  });
  if (items.length > 15) lines.push("...and " + (items.length - 15) + " more");
  if (CONFIG.ALERTS.APP_URL) lines.push("", "Dashboard: " + CONFIG.ALERTS.APP_URL);
  return lines.join("\n");
}

function sendWhatsAppAlert_(title, items) {
  const props = PropertiesService.getScriptProperties();
  const provider = String(props.getProperty("WA_PROVIDER") || "").toLowerCase();
  if (!provider) return; // WhatsApp not configured - silently skip
  const to = whatsappRecipients_();
  if (!to.length) return;
  const text = whatsappText_(title, items);
  to.forEach(function (num) {
    try {
      if (provider === "meta") sendWhatsAppMeta_(num, text);
      else if (provider === "twilio") sendWhatsAppTwilio_(num, text);
    } catch (e) { Logger.log("WhatsApp to " + num + " failed: " + e.message); }
  });
}

function sendWhatsAppMeta_(number, text) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("WA_TOKEN"), phoneId = props.getProperty("WA_PHONE_ID");
  if (!token || !phoneId) throw new Error("WA_TOKEN / WA_PHONE_ID missing in Script Properties.");
  const template = props.getProperty("WA_TEMPLATE");
  const lang = props.getProperty("WA_TEMPLATE_LANG") || "en";
  const body = template
    ? { messaging_product: "whatsapp", to: number, type: "template",
        template: { name: template, language: { code: lang }, components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\n/g, " | ").slice(0, 1000) }] }] } }
    : { messaging_product: "whatsapp", to: number, type: "text", text: { body: text } };
  const resp = UrlFetchApp.fetch("https://graph.facebook.com/v20.0/" + phoneId + "/messages", {
    method: "post", contentType: "application/json", headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 400) throw new Error("Meta API " + resp.getResponseCode() + ": " + resp.getContentText());
}

function sendWhatsAppTwilio_(number, text) {
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty("TWILIO_SID"), token = props.getProperty("TWILIO_TOKEN"), from = props.getProperty("TWILIO_FROM");
  if (!sid || !token || !from) throw new Error("TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM missing in Script Properties.");
  const resp = UrlFetchApp.fetch("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Messages.json", {
    method: "post", headers: { Authorization: "Basic " + Utilities.base64Encode(sid + ":" + token) },
    payload: { From: from, To: "whatsapp:+" + number, Body: text }, muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 400) throw new Error("Twilio " + resp.getResponseCode() + ": " + resp.getContentText());
}

// Run from the editor to test WhatsApp delivery to all configured numbers.
function sendTestWhatsApp() {
  const to = whatsappRecipients_();
  if (!to.length) throw new Error("No WhatsApp numbers found in Admin_Access (Admin/Executive users).");
  const provider = String(PropertiesService.getScriptProperties().getProperty("WA_PROVIDER") || "").toLowerCase();
  if (!provider) throw new Error("Set WA_PROVIDER (meta or twilio) in Script Properties first.");
  to.forEach(function (num) {
    if (provider === "meta") sendWhatsAppMeta_(num, "Meethi Golee Inventory: WhatsApp alerts are working.");
    else sendWhatsAppTwilio_(num, "Meethi Golee Inventory: WhatsApp alerts are working.");
  });
  Logger.log("Test WhatsApp sent to: " + to.join(", "));
}

/* ================= ANALYTICS DASHBOARD ================= */
/* filters: { range: today|week|month|lastMonth|3months|custom, from: 'yyyy-mm-dd', to: 'yyyy-mm-dd', product: ''|name, channel: ''|name } */

function dayStart_(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtDay_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function fmtLabel_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd MMM"); }

function periodBounds_(f) {
  const today = dayStart_(new Date());
  let from, to;
  switch (f.range) {
    case "today": from = today; to = today; break;
    case "week": from = addDays_(today, -6); to = today; break;
    case "lastMonth": from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 0); break;
    case "3months": from = addDays_(today, -89); to = today; break;
    case "custom":
      from = f.from ? dayStart_(new Date(f.from + "T00:00:00")) : addDays_(today, -29);
      to = f.to ? dayStart_(new Date(f.to + "T00:00:00")) : today;
      if (to < from) { const t = to; to = from; from = t; }
      break;
    default: from = new Date(today.getFullYear(), today.getMonth(), 1); to = today; // month
  }
  const days = Math.round((to - from) / 86400000) + 1;
  return { from: from, to: to, end: addDays_(to, 1), days: days, prevFrom: addDays_(from, -days), prevEnd: from };
}

function pct_(a, b) { return b ? round2_((a - b) / b * 100) : (a ? 100 : 0); }

function getAnalytics(filters) {
  const f = filters || {};
  const email = getCurrentUserEmail_();
  const isAdmin = isAdminUser_(email);
  let payload = readCache_();
  if (!payload || !payload._src) payload = refreshDashboard_(null);
  const isDefault = (!f.range || f.range === "month") && !f.product && !f.channel;
  if (isDefault) return JSON.parse(JSON.stringify(isAdmin ? payload.analytics.admin : payload.analytics.user));
  return JSON.parse(JSON.stringify(computeAnalytics_(f, payload._src, isAdmin ? payload.admin.costing : [], isAdmin)));
}

function computeAnalytics_(f, src, costing, isAdmin) {
  const p = periodBounds_(f);
  const product = f.product || "";
  const channel = f.channel || "";
  const raw = src.raw, pack = src.pack, fg = src.fg;
  const supAll = src.supAll, actAll = src.actAll;
  const costBy = {}; costing.forEach(function (c) { costBy[c.product] = c; });
  const inRange = function (ts, from, end) { const t = new Date(ts); return !isNaN(t.getTime()) && t >= from && t < end; };
  const supMatch = function (r) { return (!product || r["Product Name"] === product) && (!channel || (r["Channel"] || "Unspecified") === channel); };
  const saleOf = function (r) { const q = n_(r["Quantity (Units)"]); return (r["Sale Value (₹)"] === "" || r["Sale Value (₹)"] === undefined) ? q * n_(r["Selling Price (₹)"]) : n_(r["Sale Value (₹)"]); };

  const sup = supAll.filter(function (r) { return supMatch(r) && inRange(r["Timestamp"], p.from, p.end); });
  const supPrev = supAll.filter(function (r) { return supMatch(r) && inRange(r["Timestamp"], p.prevFrom, p.prevEnd); });
  const packLog = actAll.filter(function (r) { return r["Type"] === "Packing" && (!product || r["Product"] === product) && inRange(r["Timestamp"], p.from, p.end); });
  const packLogPrev = actAll.filter(function (r) { return r["Type"] === "Packing" && (!product || r["Product"] === product) && inRange(r["Timestamp"], p.prevFrom, p.prevEnd); });

  function sumSup(list) {
    const b = { out: 0, sale: 0, damage: 0, repack: 0, cost: 0 };
    list.forEach(function (r) {
      const q = n_(r["Quantity (Units)"]);
      if (r["Entry Type"] === "Out") { b.out += q; b.sale += saleOf(r); b.cost += q * n_(r["Unit Cost (₹)"]); }
      else if (r["Entry Type"] === "RTO-Damage") b.damage += q;
      else if (r["Entry Type"] === "RTO-Repackaging") b.repack += q;
    });
    return b;
  }
  const cur = sumSup(sup), prev = sumSup(supPrev);
  const packed = packLog.reduce(function (s, r) { return s + n_(r["Quantity"]); }, 0);
  const packedPrev = packLogPrev.reduce(function (s, r) { return s + n_(r["Quantity"]); }, 0);
  const returns = cur.damage + cur.repack, returnsPrev = prev.damage + prev.repack;

  // ---- Stock health ----
  const fgRows = fg.filter(function (r) { return !product || r["Product Name"] === product; });
  const fgOnHand = fgRows.reduce(function (s, r) { return s + n_(r["Current Stock (Units)"]); }, 0);
  const dailyOut = cur.out / p.days;
  const daysOfStock = dailyOut > 0 ? Math.round(fgOnHand / dailyOut) : null;

  const lowOut = { raw: { low: 0, out: 0, ok: 0 }, pack: { low: 0, out: 0, ok: 0 }, fg: { low: 0, out: 0, ok: 0 } };
  const bump = function (b, st) { if (st === "Out of Stock") b.out++; else if (st === "Low Stock") b.low++; else b.ok++; };
  raw.forEach(function (r) { bump(lowOut.raw, r["Status"]); });
  pack.forEach(function (r) { bump(lowOut.pack, r["Status"]); });
  fg.forEach(function (r) { bump(lowOut.fg, r["Status"]); });
  const lowOutTotal = lowOut.raw.low + lowOut.raw.out + lowOut.pack.low + lowOut.pack.out + lowOut.fg.low + lowOut.fg.out;

  // Packing capacity: every unit needs 1 of each common item; product units also need raw material + own items
  const commonMin = pack.filter(function (r) { return r["Applicable Product"] === "All"; })
    .reduce(function (m, r) { return Math.min(m, n_(r["Current Stock (Pcs)"])); }, Infinity);
  function capacityFor(prod) {
    const rr = raw.filter(function (r) { return r["Product Name"] === prod; })[0];
    let cap = rr ? Math.floor(n_(rr["Current Stock (ml)"]) / CONFIG.CONVERSION_FACTOR) : 0;
    let limiter = "Raw material";
    if (commonMin < cap) { cap = commonMin; limiter = "Common packaging"; }
    pack.filter(function (r) { return r["Applicable Product"] === prod; }).forEach(function (r) {
      if (n_(r["Current Stock (Pcs)"]) < cap) { cap = n_(r["Current Stock (Pcs)"]); limiter = r["Item Name"]; }
    });
    return { units: Math.max(0, isFinite(cap) ? cap : 0), limiter: limiter };
  }
  const capacity = product ? capacityFor(product) : { units: isFinite(commonMin) ? commonMin : 0, limiter: "Common packaging (lowest item)" };
  if (!product && isFinite(commonMin)) {
    const lowest = pack.filter(function (r) { return r["Applicable Product"] === "All"; }).sort(function (a, b) { return n_(a["Current Stock (Pcs)"]) - n_(b["Current Stock (Pcs)"]); })[0];
    if (lowest) capacity.limiter = lowest["Item Name"] + " (" + lowest["Current Stock (Pcs)"] + " pcs)";
  }

  // ---- Trend (daily if <= 31 days else weekly) ----
  const weekly = p.days > 31;
  const buckets = {}; const order = [];
  for (let dt = new Date(p.from); dt < p.end; dt = addDays_(dt, weekly ? 7 : 1)) {
    const k = fmtDay_(dt); order.push(k); buckets[k] = { label: fmtLabel_(dt) + (weekly ? " wk" : ""), out: 0, sale: 0, packed: 0, returns: 0 };
  }
  const keyFor = function (ts) {
    const t = dayStart_(new Date(ts));
    if (!weekly) return fmtDay_(t);
    const idx = Math.floor((t - p.from) / (7 * 86400000));
    return order[Math.min(idx, order.length - 1)];
  };
  sup.forEach(function (r) {
    const b = buckets[keyFor(r["Timestamp"])]; if (!b) return;
    const q = n_(r["Quantity (Units)"]);
    if (r["Entry Type"] === "Out") { b.out += q; b.sale += saleOf(r); } else b.returns += q;
  });
  packLog.forEach(function (r) { const b = buckets[keyFor(r["Timestamp"])]; if (b) b.packed += n_(r["Quantity"]); });
  const trend = order.map(function (k) { const b = buckets[k]; b.sale = round2_(b.sale); return b; });

  // ---- Channel breakdown ----
  const chMap = {};
  sup.forEach(function (r) {
    const ch = r["Channel"] || "Unspecified";
    if (!chMap[ch]) chMap[ch] = { channel: ch, out: 0, sale: 0, damage: 0, repack: 0 };
    const q = n_(r["Quantity (Units)"]);
    if (r["Entry Type"] === "Out") { chMap[ch].out += q; chMap[ch].sale += saleOf(r); }
    else if (r["Entry Type"] === "RTO-Damage") chMap[ch].damage += q; else chMap[ch].repack += q;
  });
  const channels = Object.keys(chMap).map(function (k) { const c = chMap[k]; c.sale = round2_(c.sale); c.returnPct = c.out ? round2_((c.damage + c.repack) / c.out * 100) : 0; return c; })
    .sort(function (a, b) { return b.out - a.out; });

  // ---- Product table ----
  const prodList = product ? [product] : CONFIG.PRODUCTS;
  const products = prodList.map(function (pr) {
    const s = sumSup(sup.filter(function (r) { return r["Product Name"] === pr; }));
    const pk = packLog.filter(function (r) { return r["Product"] === pr; }).reduce(function (a, r) { return a + n_(r["Quantity"]); }, 0);
    const fgr = fg.filter(function (r) { return r["Product Name"] === pr; })[0] || {};
    const stock = n_(fgr["Current Stock (Units)"]);
    const daily = s.out / p.days;
    const row = { product: pr, packed: pk, dispatched: s.out, returns: s.damage + s.repack, returnPct: s.out ? round2_((s.damage + s.repack) / s.out * 100) : 0,
      sale: round2_(s.sale), stock: stock, status: fgr["Status"] || "", daysOfStock: daily > 0 ? Math.round(stock / daily) : null, capacity: capacityFor(pr).units };
    if (isAdmin && costBy[pr]) { row.marginPct = costBy[pr].marginPct; row.profit = round2_(s.sale - s.cost); }
    return row;
  }).sort(function (a, b) { return b.dispatched - a.dispatched; });

  // ---- Reorder list (consumption-based) ----
  const reorder = [];
  const packedByProduct = {};
  packLog.forEach(function (r) { packedByProduct[r["Product"]] = (packedByProduct[r["Product"]] || 0) + n_(r["Quantity"]); });
  const totalPacked = Object.keys(packedByProduct).reduce(function (s, k) { return s + packedByProduct[k]; }, 0);
  const pushReorder = function (type, name, current, unit, dailyUse, status, minv) {
    const daysLeft = dailyUse > 0 ? Math.round(current / dailyUse) : null;
    if (status === "In Stock" && (daysLeft === null || daysLeft > 14)) return;
    const suggested = Math.max(0, Math.ceil(dailyUse * 30 - current));
    reorder.push({ type: type, name: name, current: current + " " + unit, daily: round2_(dailyUse) + " " + unit + "/day", daysLeft: daysLeft, status: status, suggested: suggested ? suggested + " " + unit : "-", min: minv + " " + unit });
  };
  raw.forEach(function (r) {
    if (product && r["Product Name"] !== product) return;
    const use = (packedByProduct[r["Product Name"]] || 0) * CONFIG.CONVERSION_FACTOR / p.days;
    pushReorder("Raw Material", r["Product Name"], n_(r["Current Stock (ml)"]), "ml", use, r["Status"], n_(r["Min Threshold (Units)"]) * CONFIG.CONVERSION_FACTOR);
  });
  pack.forEach(function (r) {
    const appl = r["Applicable Product"];
    if (product && appl !== "All" && appl !== product) return;
    const use = (appl === "All" ? totalPacked : (packedByProduct[appl] || 0)) / p.days;
    pushReorder("Packaging", r["Item Name"] + " (" + appl + ")", n_(r["Current Stock (Pcs)"]), "pcs", use, r["Status"], n_(r["Min Threshold (Pcs)"]));
  });
  reorder.sort(function (a, b) { return (a.daysLeft === null ? 9999 : a.daysLeft) - (b.daysLeft === null ? 9999 : b.daysLeft); });

  // ---- Recent activity (merged) ----
  const recent = supAll.slice(-15).map(function (r) { return { ts: r["Timestamp"], text: r["Entry Type"] + " · " + r["Product Name"] + " · " + r["Quantity (Units)"] + " units" + (r["Channel"] ? " · " + r["Channel"] : ""), user: r["Supervisor Email"] }; })
    .concat(actAll.slice(-15).map(function (r) { return { ts: r["Timestamp"], text: r["Type"] + " · " + r["Item"] + " · " + r["Quantity"] + " " + r["Unit"], user: r["User"] }; }))
    .sort(function (a, b) { return new Date(b.ts) - new Date(a.ts); }).slice(0, 10);

  // ---- Insights ----
  const insights = [];
  const label = { today: "today", week: "the last 7 days", month: "this month", lastMonth: "last month", "3months": "the last 90 days", custom: "the selected period" }[f.range] || "this month";
  if (cur.out) insights.push({ tone: pct_(cur.out, prev.out) >= 0 ? "good" : "bad", text: cur.out + " units dispatched " + label + " (" + (pct_(cur.out, prev.out) >= 0 ? "+" : "") + pct_(cur.out, prev.out) + "% vs previous period), sale value ₹" + Math.round(cur.sale).toLocaleString("en-IN") + "." });
  else insights.push({ tone: "neutral", text: "No dispatches recorded " + label + "." });
  if (channels.length && cur.out) insights.push({ tone: "neutral", text: channels[0].channel + " is the top channel with " + Math.round(channels[0].out / cur.out * 100) + "% of dispatched units." });
  if (cur.out) {
    const rp = round2_(returns / cur.out * 100);
    insights.push({ tone: rp > 5 ? "bad" : "good", text: "Return rate is " + rp + "% (" + returns + " returned: " + cur.damage + " damaged, " + cur.repack + " repackaged)" + (rp > 5 ? " — above the 5% watch level." : ".") });
    const worstCh = channels.filter(function (c) { return c.out >= 5; }).sort(function (a, b) { return b.returnPct - a.returnPct; })[0];
    if (worstCh && worstCh.returnPct > 5) insights.push({ tone: "bad", text: worstCh.channel + " has the highest return rate at " + worstCh.returnPct + "%." });
  }
  if (packed || cur.out) insights.push({ tone: packed >= cur.out ? "neutral" : "bad", text: packed + " units packed vs " + cur.out + " dispatched " + label + (packed < cur.out ? " — finished goods are being drawn down faster than produced." : ".") });
  if (daysOfStock !== null) insights.push({ tone: daysOfStock < 14 ? "bad" : "good", text: "Finished goods on hand cover about " + daysOfStock + " days at the current dispatch rate." });
  const urgent = reorder.filter(function (r) { return r.daysLeft !== null && r.daysLeft <= 7; });
  if (urgent.length) insights.push({ tone: "bad", text: urgent.length + " item(s) will run out within a week: " + urgent.slice(0, 3).map(function (r) { return r.name; }).join(", ") + (urgent.length > 3 ? " and " + (urgent.length - 3) + " more" : "") + ". See the reorder list." });
  if (lowOutTotal) insights.push({ tone: "bad", text: lowOutTotal + " item(s) are currently below their minimum threshold." });
  const bsum = batchSummary_(batchesPayload_(src.batches || []).filter(function (b) { return !product || b.product === product; }));
  if (bsum.expired) insights.push({ tone: "bad", text: bsum.expired + " batch(es) with " + bsum.expiredUnits + " units have EXPIRED and must not be dispatched. Review them in Finished Goods → Batches." });
  if (bsum.expiringSoon) insights.push({ tone: "bad", text: bsum.expiringSoon + " batch(es) (" + bsum.expiringUnits + " units) expire within " + bsum.warnDays + " days — dispatch these first (FEFO)." });
  if (bsum.noDate) insights.push({ tone: "neutral", text: bsum.noDate + " opening batch(es) have no manufacturing / expiry date yet. Admin: set them via Finished Goods → Batches → Edit." });
  insights.push({ tone: "neutral", text: "Packing capacity right now: " + capacity.units + " units, limited by " + capacity.limiter + "." });
  if (isAdmin && costing.length) {
    const lowM = costing.filter(function (c) { return c.sellingPrice && c.marginPct < 20; });
    if (lowM.length) insights.push({ tone: "bad", text: "Low margin (<20%): " + lowM.map(function (c) { return c.product + " " + c.marginPct + "%"; }).join(", ") + "." });
    const top = products.filter(function (r) { return r.profit; }).sort(function (a, b) { return b.profit - a.profit; })[0];
    if (top) insights.push({ tone: "good", text: "Most profitable " + label + ": " + top.product + " (₹" + Math.round(top.profit).toLocaleString("en-IN") + " gross profit)." });
  }

  const out = {
    period: { from: fmtDay_(p.from), to: fmtDay_(p.to), days: p.days, weekly: weekly, label: label },
    kpi: {
      dispatched: cur.out, dispatchedChange: pct_(cur.out, prev.out),
      sale: round2_(cur.sale), saleChange: pct_(cur.sale, prev.sale),
      packed: packed, packedChange: pct_(packed, packedPrev),
      returns: returns, returnPct: cur.out ? round2_(returns / cur.out * 100) : 0, returnsChange: pct_(returns, returnsPrev),
      fgOnHand: fgOnHand, daysOfStock: daysOfStock, lowOut: lowOutTotal, capacity: capacity,
      expiredBatches: bsum.expired, expiredUnits: bsum.expiredUnits, expiringBatches: bsum.expiringSoon, expiringUnits: bsum.expiringUnits
    },
    trend: trend, channels: channels, products: products, stockStatus: lowOut, reorder: reorder.slice(0, 25), recent: recent, insights: insights,
    isAdmin: isAdmin
  };
  if (isAdmin) {
    const priceMapV = buildPriceMap_(src.prices);
    let inv = 0;
    raw.forEach(function (r) { inv += n_(r["Current Stock (ml)"]) * n_((priceMapV["Raw Material|" + r["Product Name"]] || {})["Cost Price (₹)"]); });
    pack.forEach(function (r) { inv += n_(r["Current Stock (Pcs)"]) * n_((priceMapV["Packaging|" + packPriceName_(r["Item Name"], r["Applicable Product"])] || {})["Cost Price (₹)"]); });
    fg.forEach(function (r) { const c = costBy[r["Product Name"]]; inv += n_(r["Current Stock (Units)"]) * (c ? c.totalCost : 0); });
    out.kpi.inventoryValue = round2_(inv);
    out.kpi.grossProfit = round2_(cur.sale - cur.cost);
    out.margins = costing.map(function (c) { return { product: c.product, marginPct: c.marginPct, sellingPrice: c.sellingPrice, totalCost: c.totalCost }; });
  }
  return JSON.parse(JSON.stringify(out));
}

/* ================= CHANNEL AUTOMATION: AGENT -> FIREBASE -> SUPERVISOR ENTRIES ================= */
/* SETUP (Admin):
   1. Apps Script -> Project Settings -> Script Properties:
        FIREBASE_URL    = https://<project>-default-rtdb.firebaseio.com   (no trailing slash)
        FIREBASE_SECRET = <database secret>  (Firebase console -> Project Settings -> Service accounts -> Database secrets)
   2. Admin Panel -> Agent Import -> "Test connection", then "Install automatic sync" (or run installFirebaseTrigger() here once).
      Default: twice a day at 11:00 and 19:00 (CONFIG.AGENT.SYNC_HOURS). "Sync now" works any time.
   3. Fill the SKU_Map tab (Channel, SKU, Product Name, Bottles per Unit) - used when the agent sends a SKU without a valid product name.

   What the agent writes (curated layer, see SOW):
     orders/<key>  : channel, order_id, order_item_id, order_date, out_date, sku, product_name, quantity, unit_price,
                     sale_value, tracking_id, source_ref, fetched_at, status = "pending"
     returns/<key> : channel, order_id, order_item_id, return_id, sku, product_name, quantity, returned_on,
                     return_type, return_reason, tracking_id, source_ref, fetched_at, status = "pending_review"
   What this system writes back on each record: status (processed | needs_review), entry_id, message, processed_at.
   Every touched record is also logged in the Agent_Imports tab; the "Import Key" column of Supervisor_Entries is the second duplicate lock. */

function ensureAgentSheets_() {
  const ss = getSS_();
  if (!ss.getSheetByName(CONFIG.SHEETS.IMPORTS)) { const s = ss.insertSheet(CONFIG.SHEETS.IMPORTS); s.appendRow(HEADERS.IMPORTS); s.setFrozenRows(1); }
  if (!ss.getSheetByName(CONFIG.SHEETS.SKUMAP)) {
    const s = ss.insertSheet(CONFIG.SHEETS.SKUMAP); s.appendRow(HEADERS.SKUMAP); s.setFrozenRows(1);
    s.appendRow(["Flipkart", "EXAMPLE-SKU-PK1", CONFIG.PRODUCTS[0] || "", 1, "Example row - replace with the real SKUs of every channel"]);
  }
}

function fbConfig_() {
  const p = PropertiesService.getScriptProperties();
  const url = String(p.getProperty("FIREBASE_URL") || "").trim().replace(/\/+$/, "");
  return { url: url, secret: String(p.getProperty("FIREBASE_SECRET") || "").trim(), configured: !!url };
}

// REST call to the Realtime Database. method: get | patch | put
function fbFetch_(path, method, body) {
  const c = fbConfig_();
  if (!c.configured) throw new Error("FIREBASE_URL is not set. Apps Script → Project Settings → Script Properties → add FIREBASE_URL.");
  const url = c.url + "/" + path + ".json" + (c.secret ? "?auth=" + encodeURIComponent(c.secret) : "");
  const opt = { method: method || "get", muteHttpExceptions: true, contentType: "application/json" };
  if (body !== undefined) opt.payload = JSON.stringify(body);
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  if (code >= 300) throw new Error("Firebase " + (method || "get").toUpperCase() + " /" + path + " failed (" + code + "): " + res.getContentText().slice(0, 200));
  const txt = res.getContentText();
  return txt ? JSON.parse(txt) : null;
}

// Channel names as the agent may send them -> the exact names used in this system
function normalizeChannel_(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (CONFIG.CHANNELS.indexOf(s) !== -1) return s;
  const k = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // The agent only ever sends merchant-fulfilled Amazon orders, so a bare "amazon" means Amazon FBM.
  const map = { flipkart: "Flipkart", shopsy: "Flipkart", amazon: "Amazon FBM", amazonfbm: "Amazon FBM", merchant: "Amazon FBM",
                amazonfba: "Amazon FBA", fba: "Amazon FBA", shopifycom: "Shopify (.com)", shopifystore: "Shopify (.store)",
                tata1mg: "Tata 1mg", meesho: "Meesho", buymore: "Buymore" };
  if (map[k]) return map[k];
  const hit = CONFIG.CHANNELS.filter(function (c) { return c.toLowerCase().replace(/[^a-z0-9]/g, "") === k; })[0];
  return hit || "";
}

// SKU_Map tab -> { "channel|sku": {product, mult}, "sku": {product, mult} }  (keys lower-case)
function skuMap_() {
  const m = {};
  try {
    sheetToObjects_(getSheet_(CONFIG.SHEETS.SKUMAP)).forEach(function (r) {
      const sku = String(r["SKU"] || "").trim().toLowerCase(), prod = String(r["Product Name"] || "").trim();
      if (!sku || CONFIG.PRODUCTS.indexOf(prod) === -1) return;
      const e = { product: prod, mult: Math.max(1, n_(r["Bottles per Unit"]) || 1) };
      const ch = normalizeChannel_(r["Channel"]);
      if (ch) m[ch.toLowerCase() + "|" + sku] = e;
      if (!m[sku]) m[sku] = e;
    });
  } catch (e) { /* tab missing until initializeSystem / first sync */ }
  return m;
}

// Product for one agent record: valid product_name wins; else SKU_Map (quantity × bottles per unit)
function resolveProduct_(rec, map, channel) {
  const name = String(rec.product_name || "").trim();
  if (CONFIG.PRODUCTS.indexOf(name) !== -1) return { product: name, qty: n_(rec.quantity) };
  const ci = CONFIG.PRODUCTS.filter(function (p) { return p.toLowerCase() === name.toLowerCase(); })[0];
  if (ci) return { product: ci, qty: n_(rec.quantity) };
  const sku = String(rec.sku || "").trim().toLowerCase();
  const hit = map[(channel || "").toLowerCase() + "|" + sku] || map[sku];
  if (hit) return { product: hit.product, qty: n_(rec.quantity) * hit.mult };
  throw new Error("Unknown SKU '" + (rec.sku || "") + "'" + (name ? " / product '" + name + "'" : "") + " — add it to the SKU_Map tab, then Retry.");
}

function fmtStamp_(d) { return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"); }

// Reads pending records of one path and creates the supervisor entries. Returns counters.
function importPath_(kind, sup) {
  const path = kind === "orders" ? CONFIG.AGENT.ORDERS_PATH : CONFIG.AGENT.RETURNS_PATH;
  const out = { read: 0, done: 0, failed: 0, skipped: 0 };
  const data = fbFetch_(path, "get") || {};
  const map = skuMap_();
  const keys = Object.keys(data).filter(function (k) {
    const st = String((data[k] || {}).status || "").toLowerCase();
    return kind === "orders" ? st === "pending" : (st === "pending_review" || st === "pending");
  }).slice(0, CONFIG.AGENT.MAX_PER_RUN);
  const logRows = [];
  keys.forEach(function (key) {
    const rec = data[key] || {};
    out.read++;
    const channel = normalizeChannel_(rec.channel);
    let product = "", qty = 0, entryId = "";
    try {
      if (!channel) throw new Error("Unknown channel '" + (rec.channel || "") + "'. Use: " + CONFIG.CHANNELS.join(" · "));
      // second duplicate lock: already in Supervisor_Entries?
      const dup = findRow_(sup, "Import Key", key);
      if (dup !== -1) {
        entryId = String(sup.rows[dup][col_(sup, "Entry ID")]);
        fbFetch_(path + "/" + key, "patch", { status: "processed", entry_id: entryId, processed_at: fmtStamp_(), message: "already recorded" });
        logRows.push([new Date(), key, kind, channel, rec.order_id || "", rec.sku || "", sup.rows[dup][col_(sup, "Product Name")], n_(rec.quantity), "skipped", entryId, "Already recorded"]);
        out.skipped++;
        return;
      }
      const rp = resolveProduct_(rec, map, channel);
      product = rp.product; qty = rp.qty;
      if (!qty || qty <= 0) throw new Error("Quantity missing or zero.");
      const ref = rec.source_ref ? " — " + rec.source_ref : "";
      let res;
      if (kind === "orders") {
        const sale = (rec.sale_value !== undefined && rec.sale_value !== null && rec.sale_value !== "") ? Number(rec.sale_value)
                   : (n_(rec.unit_price) ? round2_(n_(rec.unit_price) * qty) : "");
        res = createSupEntry_(CONFIG.AGENT.AGENT_EMAIL, "Out", product, qty, "Auto-imported from " + channel + ref, channel, rec.order_id || "", [], sale, "",
          { orderItemId: rec.order_item_id || "", trackingId: rec.tracking_id || "", sku: rec.sku || "", channelDate: rec.out_date || rec.order_date || "", source: "Auto", importKey: key });
      } else {
        const reason = rec.return_reason ? " · reason: " + rec.return_reason : "";
        res = createSupEntry_(CONFIG.AGENT.AGENT_EMAIL, "RTO-Pending", product, qty, "Auto-imported return from " + channel + reason + ref, channel, rec.order_id || "", [], "", "",
          { orderItemId: rec.order_item_id || "", trackingId: rec.tracking_id || "", returnId: rec.return_id || "", returnType: rec.return_type || "", sku: rec.sku || "", channelDate: rec.returned_on || "", source: "Auto", importKey: key });
      }
      entryId = res.entryId;
      // keep the in-memory sup table current for the duplicate check of later records in this run
      const row = []; while (row.length < sup.headers.length) row.push("");
      row[col_(sup, "Entry ID")] = entryId; row[col_(sup, "Import Key")] = key; row[col_(sup, "Product Name")] = product;
      sup.rows.push(row);
      fbFetch_(path + "/" + key, "patch", { status: "processed", entry_id: entryId, processed_at: fmtStamp_(), message: "" });
      logRows.push([new Date(), key, kind, channel, rec.order_id || "", rec.sku || "", product, qty, "processed", entryId, kind === "orders" ? "Out entry created" : "Pending return listed"]);
      out.done++;
    } catch (e) {
      const msg = String(e.message || e).split("::STOCKSHORT::")[0].trim();
      try { fbFetch_(path + "/" + key, "patch", { status: "needs_review", message: msg, reviewed_at: fmtStamp_() }); } catch (e2) { /* keep going */ }
      logRows.push([new Date(), key, kind, channel || String(rec.channel || ""), rec.order_id || "", rec.sku || "", product, qty || n_(rec.quantity), "needs_review", "", msg]);
      out.failed++;
    }
  });
  if (logRows.length) appendRows_(CONFIG.SHEETS.IMPORTS, logRows);
  return out;
}

// Main sync - runs from the time trigger and from "Sync now" in the Admin Panel.
function syncFromFirebase() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { skipped: true, message: "Another sync is running." };
  const props = PropertiesService.getScriptProperties();
  const started = new Date();
  const summary = { startedAt: fmtStamp_(started), orders: null, returns: null, error: "" };
  QUIET_ = true;
  try {
    ensureAgentSheets_();
    const sup = supTable_();
    summary.orders = importPath_("orders", sup);
    summary.returns = importPath_("returns", sup);
  } catch (e) {
    summary.error = String(e.message || e);
  } finally {
    QUIET_ = false;
    summary.finishedAt = fmtStamp_(new Date());
    summary.seconds = Math.round((new Date() - started) / 1000);
    props.setProperty("FB_LAST_SYNC", summary.finishedAt);
    props.setProperty("FB_LAST_RESULT", JSON.stringify(summary));
    invalidateCache_();
    lock.releaseLock();
  }
  return summary;
}

function firebaseTriggerInstalled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "syncFromFirebase"; });
}

// Installs (or re-installs) the time-driven sync. Safe to run again.
function installFirebaseTrigger() {
  requireAdmin_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "syncFromFirebase") ScriptApp.deleteTrigger(t); });
  if (CONFIG.AGENT.SYNC_MINUTES > 0) ScriptApp.newTrigger("syncFromFirebase").timeBased().everyMinutes(CONFIG.AGENT.SYNC_MINUTES).create();
  else CONFIG.AGENT.SYNC_HOURS.forEach(function (h) { ScriptApp.newTrigger("syncFromFirebase").timeBased().atHour(h).everyDays(1).create(); });
  return getAgentStatus();
}
function removeFirebaseTrigger() {
  requireAdmin_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "syncFromFirebase") ScriptApp.deleteTrigger(t); });
  return getAgentStatus();
}

// Admin Panel card: configuration, last run, waiting counts, import log
function getAgentStatus() {
  requireAdmin_();
  const c = fbConfig_();
  const props = PropertiesService.getScriptProperties();
  let last = null; try { last = JSON.parse(props.getProperty("FB_LAST_RESULT") || "null"); } catch (e) { }
  let log = [];
  try { log = sheetToObjects_(getSheet_(CONFIG.SHEETS.IMPORTS)).slice(-100).reverse(); } catch (e) { }
  let skuRows = 0; try { skuRows = Math.max(0, getSheet_(CONFIG.SHEETS.SKUMAP).getLastRow() - 1); } catch (e) { }
  return {
    configured: c.configured,
    urlMasked: c.url ? c.url.replace(/^https?:\/\//, "").slice(0, 40) : "",
    hasSecret: !!c.secret,
    triggerInstalled: firebaseTriggerInstalled_(),
    syncMinutes: CONFIG.AGENT.SYNC_MINUTES,
    syncLabel: CONFIG.AGENT.SYNC_MINUTES > 0 ? "every " + CONFIG.AGENT.SYNC_MINUTES + " min" : "daily at " + CONFIG.AGENT.SYNC_HOURS.map(function (h) { return ("0" + h).slice(-2) + ":00"; }).join(" and "),
    lastSync: props.getProperty("FB_LAST_SYNC") || "",
    lastResult: last,
    skuRows: skuRows,
    log: JSON.parse(JSON.stringify(log))
  };
}

// "Test connection": counts records per status without changing anything
function testFirebaseConnection() {
  requireAdmin_();
  const count = function (path) {
    const d = fbFetch_(path, "get") || {};
    const by = {};
    Object.keys(d).forEach(function (k) { const st = String((d[k] || {}).status || "(none)"); by[st] = (by[st] || 0) + 1; });
    return { total: Object.keys(d).length, byStatus: by };
  };
  return { ok: true, orders: count(CONFIG.AGENT.ORDERS_PATH), returns: count(CONFIG.AGENT.RETURNS_PATH) };
}

// "Sync now" button
function runAgentSyncNow() {
  requireAdmin_();
  const summary = syncFromFirebase();
  return done_({ summary: summary, status: getAgentStatus() }, null);
}

// Retry one failed record (after fixing SKU_Map / stock): status back to pending, then sync
function retryAgentImport(kind, key) {
  requireAdmin_();
  const path = kind === "orders" ? CONFIG.AGENT.ORDERS_PATH : CONFIG.AGENT.RETURNS_PATH;
  fbFetch_(path + "/" + String(key), "patch", { status: kind === "orders" ? "pending" : "pending_review", message: "retry requested" });
  return runAgentSyncNow();
}
