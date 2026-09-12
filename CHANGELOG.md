# Changes

## Live schema dashboard

- Read the existing /mira/schema/v1 catalog and subscribe to its curated record paths.
- Populate live stock KPIs, provider summaries, activity and searchable collection tables.
- Handle nested/composite keys, shared order/return paths, paise amounts and missing/unverified totals.
- Reflect additions, edits and deletions without refresh; reconcile catalog changes and retry read failures.
- Preserve all write/seeding guards and keep raw archives out of dashboard queries.
- Add adapter and desktop/mobile live-update regression coverage.

## Non-blocking workspace preview

- Replace the schema-blocked welcome button with Open dashboard.
- Make all workspace sections accessible with clearly labeled empty states, including while Firebase is offline.
- Keep real authentication separate from public preview access; preserve all inventory read/write guards.
- Add desktop/mobile tests for preview entry, navigation, refresh, theme and reconnecting without database access.

## Firebase connection-only integration

- Target the user-provided mw-mira-io Realtime Database URL.
- Remove the old project credentials and disable database-rules deployment.
- Subscribe only to connection metadata; pause inventory and login pending the user-owned schema.
- Block legacy schema reads, seeding and writes in the connected app.
- Add tests proving connection-only mode cannot access inventory paths.

## B23

- Queue requests and reload inventory before each operation; skip unchanged writes.
- Commit changes atomically and reject stale snapshots instead of overwriting other sessions.
- Discard failed mutations and allow retries after load errors.
- Clear failed-login identities, block unauthenticated bridge calls and refresh permission caches.
- Capture backend handlers before UI declarations to fix the permission-toggle name collision.
- Reject non-finite quantities/prices, fractional units/pieces and invalid stock corrections.
- Preserve all entry-ID digits after 9,999.
- Add responsive navigation, mobile viewport, account details, sign-out and permission-aware navigation.
- Add keyboard navigation, dialog focus handling, labels, visible focus and reduced-motion support.
- Make dashboard Refresh fetch fresh data, and clear passcodes after successful login.
- Add isolated inventory and desktop/mobile browser regression checks.
- Correct storage/setup documentation and exclude development/archive files from hosting.

Open production requirement: replace public database rules and browser passcodes with authenticated, server-enforced access.
