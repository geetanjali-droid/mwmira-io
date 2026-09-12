# Meethi Golee Inventory

A static HTML/CSS/JavaScript inventory app ported from Google Apps Script, with a Firebase Realtime Database storage adapter. It tracks raw materials, packaging, packing runs, batches, dispatches, returns, costing, and user permissions.

## Run locally

Install Node.js 20 or newer, then run:

```sh
node scripts/serve.cjs
```

Open http://127.0.0.1:5500. No build is needed. Firebase, Chart.js, and fonts require an internet connection. The checked-in Firebase config points to the existing project; use a separate project for development. Do not enter test stock against the live project.

## Files

- `index.html`: login, dashboard, inventory screens and dialogs.
- `css/styles.css`: green/gold theme, dark theme and responsive layout.
- `js/firebase-init.js`: Firebase web project configuration.
- `js/gas-shim.js`: Apps Script compatibility, spreadsheet serialization and database transactions.
- `js/backend.js`: inventory calculations, validation and permission logic.
- `js/gsrun-shim.js`: queued UI-to-backend calls, session gate and error recovery.
- `js/clientscript.js`: rendering, forms and interactions.
- `_original/`: original Apps Script sources for reference; excluded from hosting.
- `tests/`: isolated database regression tests and browser checks.

## Firebase connection

The app now targets **https://mw-mira-io-default-rtdb.asia-southeast1.firebasedatabase.app/** in connection-only mode. The previous project's API key and app identifiers have been removed. The URL is sufficient for this Realtime Database connection; no Authentication or Storage integration is configured.

The user owns the schema. The application subscribes only to Firebase connection metadata at `.info/connected`. Login and inventory operations are paused. Both legacy adapter read and write entry points fail closed, so this project is not read through the old `/data` layout and is never seeded or migrated. The legacy adapter remains only for isolated regression tests until the user's actual schema is supplied and mapped. Do not turn off connection-only mode to use that adapter against this database.

No database rules are deployed: the database deployment block has been removed from `firebase.json`. The local legacy rules file is reference material, not a statement of this project's live rules. No live rules or data were inspected or changed.

## Authentication limitation

**The legacy local database rules permit public reads and writes and are no longer configured for deployment. The new project's live rules have not been inspected.** Passcodes and authorization checks currently run in the browser, and account passcodes are stored in database rows. Hiding the URL or signing in anonymously does not protect inventory or enforce roles.

Before public deployment, migrate accounts to Firebase Authentication and enforce roles and stock mutations in trusted server code and database rules. Do not simply turn on authenticated-only rules with the existing browser passcode flow; that flow does not establish a Firebase Auth session. Connection-only mode does not deploy rules or change live Firebase data.

## Verification

Dependency-free inventory tests:

```sh
node --test tests/*.test.cjs
```

Browser checks (Microsoft Edge installed):

```sh
pnpm install --frozen-lockfile
pnpm test:ui
```

Or install the dependencies with npm. Set `BROWSER_CHANNEL=chrome` to use installed Chrome. Browser checks intercept Firebase scripts and use an isolated in-memory database; they never access live inventory. They verify desktop/mobile login, dashboard rendering, navigation, dialogs, dark mode and page overflow. Screenshots are written to ignored `test-results/`.

Regression coverage includes login failures, retry after network errors, read-only requests, concurrent receipts, rejected writes, cross-session conflicts, quantity validation, entry ID rollover, handler name collisions, packing, FEFO dispatch, shortages and reversal. Firebase server rules and network transaction semantics still require integration testing against a dedicated Firebase emulator/project before production deployment.

## Hosting

After configuring secure authentication and rules, Firebase CLI can deploy the static site with `firebase deploy --only hosting`. Hosting excludes archived source, tests, development scripts and dependency metadata. Pushing this repository does not itself deploy Firebase Hosting.

## Port limitations

Apps Script email, WhatsApp, scheduled agent sync and external AI calls require a server integration; their original browser shims cannot provide those services. Local inventory and analytics calculations run in the browser. Browser permission controls improve the UI but are not a security boundary.
