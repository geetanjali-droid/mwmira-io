/*************************************************************
 * google.script.run  BRIDGE
 * The original ClientScript calls the backend like:
 *   google.script.run.withSuccessHandler(cb).withFailureHandler(err).someFn(args)
 * This shim routes `someFn` to the matching global function in backend.js,
 * loading the data from Firebase on first use and saving changes after
 * every call — so the entire original UI works unchanged on Firebase.
 *************************************************************/

(function () {
  window.google = window.google || {};
  google.script = google.script || {};
  // Capture handlers before clientscript.js declares UI functions with the same names.
  const handlers = new Map(Object.keys(window).filter(function (name) { return typeof window[name] === 'function'; }).map(function (name) { return [name, window[name]]; }));

  // Load the spreadsheet from Firebase exactly once, then reuse.
  let queue = Promise.resolve();

  async function callBackend(name, args, onSuccess, onFailure) {
    try {
      if (name !== "checkLoginPasscode" && !window.CURRENT_EMAIL) throw new Error("Please sign in first.");
      await loadMEM();
      Object.keys(ROLE_).forEach(function (key) { delete ROLE_[key]; });
      const fn = handlers.get(name);
      if (typeof fn !== "function") throw new Error("Server function not found: " + name);
      // reset per-request caches (like a fresh Apps Script execution)
      if (typeof EMAIL_ !== "undefined") { try { EMAIL_ = window.CURRENT_EMAIL; } catch (e) {} }
      const result = await fn.apply(null, args);
      await flushMEM(); // persist any changes this call made
      if (onSuccess) onSuccess(result);
    } catch (e) {
      MEM.sheets = {};
      if (name === "checkLoginPasscode") { window.CURRENT_EMAIL = null; EMAIL_ = null; }
      console.error("[server] " + name + " failed:", e);
      if (onFailure) onFailure(new Error(e && e.message ? e.message : String(e)));
    }
  }

  function makeRunner(onSuccess, onFailure) {
    return new Proxy({}, {
      get: function (_t, prop) {
        if (prop === "withSuccessHandler") return function (fn) { return makeRunner(fn, onFailure); };
        if (prop === "withFailureHandler") return function (fn) { return makeRunner(onSuccess, fn); };
        if (prop === "withUserObject") return function () { return makeRunner(onSuccess, onFailure); };
        // any other property = a server function call
        return function () {
          const args = Array.prototype.slice.call(arguments);
          queue = queue.then(function () { return callBackend(prop, args, onSuccess, onFailure); }).catch(function (error) { console.error(error); });
        };
      }
    });
  }

  google.script.run = makeRunner(null, null);
  google.script.host = { close: function () {}, setWidth: function () {}, setHeight: function () {}, editor: { focus: function () {} } };
  google.script.url = { getLocation: function (cb) { if (cb) cb({ parameter: {}, hash: "" }); } };
})();
