# Meethi Golee / Mira Inventory

The original dashboard and all seven pages are restored: Dashboard, Admin Panel, Raw Material, Packaging Material, Finished Goods and batches, Supervisor Entries, and User Access.

## Run and deploy

Use Node.js 22 or newer:

```sh
node scripts/serve.cjs
```

Open http://localhost:5500. Internet access is required for Firebase Authentication and charts. Production uses Vercel's Node functions in `api/`; `vercel.json` builds only the intended frontend files into `dist`. Static-only Firebase Hosting cannot run this API. The existing production address is https://mwmira-io.vercel.app/.

## Login and roles

Firebase Authentication is required before data loads. Google and email/password sign-in are configured in project `mw-mira-io`; the production domain and localhost are authorized. The verified owner account is `geetanjali.chaurasiya@mushroomworldgroup.com`. Use **Sign in with Google** for that work account. There is no preview bypass or hardcoded-password authentication.

Other accounts must have an existing `/ims/user_profiles/{record_id}` profile. User Access manages the original permission flags and roles. Adding a user with an optional password creates a Firebase Authentication account; passwords must have at least six characters. Leave the password blank for Google sign-in or an existing Firebase account. Existing password changes belong in Firebase Authentication. Removing a profile revokes workspace access without deleting the Firebase account. Passwords are never saved in the RTDB profile.

Every API operation verifies the Firebase ID token and current profile permissions. Role restrictions are also reflected in navigation, row actions, and entry controls. Revocation and sign-out stop the live stream; stale requests cannot restore an old session.

**Database access boundary:** these API checks do not replace Firebase Realtime Database rules. Live database rules have not been changed; the database was accessible directly without authentication at verification. Restricting that direct access requires rules coordinated with the external import agent. The historical `database.rules.json` is not a secure production policy and is not deployed by this project.

## Existing schema and live data

The application fetches `/mira/schema/v1` from:

https://mw-mira-io-default-rtdb.asia-southeast1.firebasedatabase.app/

The catalog's `source_header` and `path_template` fields map the existing `ims_*` definitions to the original UI columns. No schema, sample products, prices, opening batches, or business records are automatically created. Missing collections are empty in memory. Missing schema mappings show a notice inside the authenticated workspace and disable saves until the mappings return; they do not block login.

The original product choices remain in the UI, supplemented by products already present in Firebase. All stock values, movements, batch data, costing, history, and profiles come from the mapped `/ims` collections. Integer paise are converted to rupees for display and checked before saving. Unknown record fields, existing record IDs, and unrelated IMS collections are preserved.

Firebase REST event streams watch `/ims`, `/mira/schema/v1`, and the catalog-declared `/orders` and `/returns` paths. The server emits change notifications only; the browser fetches an authorized dashboard payload on each update. Streams reconnect automatically and stop on sign-out. Updates preserve open form drafts and table filters. Saves use Firebase ETags to commit each stock operation atomically; conflicting changes fail without replaying the operation.

Channel orders are projected read-only into the original dispatch/sales KPIs, charts, product/channel breakdowns, Admin dispatch summary, and Supervisor Entries fields. Canonical `sale_value_paise`, quantity, channel date and identifiers are used directly. SKU Map takes precedence for product names; uniquely matching catalogue names are used for display, with the original listing retained when unmatched. Cancelled, unshipped and malformed orders are excluded. Existing IMS entry IDs/order-item IDs prevent double counting. Channel records never become persisted IMS rows or adjust stock, and costs/profit are unavailable without inventory cost records. Transaction settlements and provisional financial rollups are not treated as product dispatches.

External orders and returns are not automatically counted as stock movements. Your import agent must write the existing IMS collections. The Admin Panel displays the existing import log and SKU map count; Apps Script scheduling and retry controls are disabled because they do not run on Vercel. The original AI, WhatsApp, and email integrations still require separately configured server integrations.

## Verification

```sh
node --test tests/*.test.cjs
node tests/ui.cjs
node scripts/build.cjs
```

Browser tests use installed Chrome (override with `BROWSER_CHANNEL`) and simulated Firebase responses; they never write live business records. They cover login, all original pages, live updates, mobile layout, draft preservation, permissions, and revocation. Server tests cover canonical field/paise mapping, no seeding, roles, conflicting writes, and packing/dispatch/reversal across separate requests. `docs/firebase-schema-v1.json` is the fetched schema snapshot used by tests, not a schema deployed by the app.
