# Changes

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
