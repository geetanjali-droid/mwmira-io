# Meethi Golee / Mira live dashboard

A static HTML/CSS/JavaScript dashboard connected read-only to:

https://mw-mira-io-default-rtdb.asia-southeast1.firebasedatabase.app/

## Run

```sh
node scripts/serve.cjs
```

Open http://127.0.0.1:5500 and choose **Open dashboard**. No build is required. Internet access is required for Firebase and the hosted frontend dependencies.

## Current Firebase integration

The dashboard reads the user's catalog at `/mira/schema/v1`, then subscribes to the collection paths declared in `path_template`. It supports keyed collections, nested month/account collections, composite keys and singleton state. Catalog updates reconcile the subscriptions automatically. It never reads the database root or the old `/data` spreadsheet layout.

At verification, Firebase contained the catalog but no business records. There are 43 catalog definitions, represented by 37 dashboard collections: the shared orders/returns paths are deduplicated, and four raw archives are excluded. Raw archives and `_raw` payloads are not dashboard records. A snapshot of the fetched catalog is retained at `docs/firebase-schema-v1.json` for regression tests; the application uses the live catalog, not this snapshot.

- Inventory KPIs use the declared current stock, packed, batch balance and supervisor quantity fields.
- Incoming orders and returns are shown independently from recorded dispatch and inventory movements. The app does not match listing names to inventory products or import orders into stock.
- Amazon, Flipkart, Cashfree and Meta monthly summaries remain separate. Financial totals require `reference_verified` and `coverage_complete` to both be true. Missing or invalid values display as unavailable, not zero. Integer paise are formatted as rupees for display.
- The inventory, supervisor, admin and user-profile sections have schema-driven, searchable tables with 50-row pagination. Only declared fields are displayed; password/secret fields and raw payloads are excluded.
- Firebase `value` listeners update the active view on additions, changes and deletions; no manual refresh or polling is needed. UI updates are coalesced over 30 ms. Listeners are deduplicated, reconciled after catalog changes, and detached on page exit.
- Connection state, last-received time, source loading and read failures are shown explicitly. Offline data is labeled stale. Refresh reconnects listeners and retries failed reads. Missing schema does not block opening the workspace.

This integration performs **no writes, schema creation, seeding, migration or database-rule deployment**. `FIREBASE_CONNECTION_ONLY` stays true to block both entry points of the old mutable spreadsheet adapter; its name is retained for compatibility. Only the separate read-only adapter accesses the new collection paths.

## Authentication

Open dashboard provides read-only UI access under the database's existing read rules. It is not a verified login and does not enforce user roles. Firebase Authentication has not been configured; adding a user profile does not establish authentication. The supplied legacy passcode workflow remains disabled against this project. The local `database.rules.json` is historical reference and is not configured for deployment. No live rules were changed.

## Files

- `js/live-data.js`: schema interpretation, data normalization and subscription lifecycle.
- `js/live-dashboard.js`: live KPIs, provider summaries and record tables.
- `js/firebase-init.js`: project connection and welcome-screen metadata.
- `js/clientscript.js`, `index.html`, `css/styles.css`: shared UI and legacy views.
- `js/backend.js`, `js/gas-shim.js`, `js/gsrun-shim.js`: legacy inventory logic retained for isolated tests; mutations are blocked in the connected app.
- `_original/`: original Apps Script sources.

## Tests

```sh
node --test tests/*.test.cjs
pnpm install --frozen-lockfile
pnpm test:live
```

The current browser tests default to installed Chrome. Set `BROWSER_CHANNEL=msedge` for Edge. `pnpm test:preview` is an alias for the same live dashboard checks; `pnpm test:ui` exercises legacy UI workflows with a simulated database (defaults to Edge).

Browser tests intercept Firebase and simulate updates without writing live records. They cover desktop/mobile entry, navigation, empty data, adds/edits/deletes, shared-channel deduplication, paise display, denied reads, offline/reconnect, refresh and no database writes. Unit tests cover schema paths, nested/composite keys, malformed/missing values and subscription cleanup. The legacy inventory regression tests also remain available. Ignored screenshots are saved in `test-results/`.

## Hosting and limits

Pushing GitHub does not deploy Firebase Hosting. `firebase deploy --only hosting` publishes the static files using `.firebaserc`; tests, schema snapshots, archived sources and development files are excluded. Database rules are not deployed by this configuration.

Each subscribed collection prefix is read as a snapshot. Tables paginate rendering, not database reads; very large archives require indexed server queries or aggregation rather than downloading full snapshots. New catalog versions under a different version path require an explicit version migration. Apps Script email, WhatsApp, AI calls and scheduled imports still require server integrations.
