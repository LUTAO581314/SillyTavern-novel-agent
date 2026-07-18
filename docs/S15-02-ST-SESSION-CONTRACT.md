# S15-02 Novel Edition Release and Session Contract

Status: SillyTavern client and bridge implementation complete; production
Runtime/PostgreSQL and remote Gate verification remain authoritative.

## Boundary

`release-session-client.js` is a deliberately thin same-origin adapter for the
Runtime release/session surface. It does not read PostgreSQL, store a
provider secret, write `localStorage`, or accept a browser-selected Runtime
URL. Every route is assembled inside the module under the fixed bridge prefix:

```text
GET  /api/plugins/novel-runtime-bridge/v1/releases/:releaseId
POST /api/plugins/novel-runtime-bridge/v1/releases/:releaseId/sessions
POST /api/plugins/novel-runtime-bridge/v1/sessions/:sessionId/share
GET  /api/plugins/novel-runtime-bridge/v1/sessions/:sessionId
GET  /api/plugins/novel-runtime-bridge/v1/sessions/:sessionId/reconnect?lastEventId=...
```

The endpoint shapes are a versioned Runtime contract. The client fails closed
when the response schema, release status, session IDs, audience, revision,
digest, authority cursor, recovery event, or share path is invalid.

Release export has a separate author-only fixed route. The bridge accepts only
size-bounded `text/html`, requires a blocking CSP, adds `nosniff`, and returns
an attachment. Public shares use one fixed token route; the Runtime share path
is rewritten to `/?novel-share=<opaque-token>`, and the token is never persisted
outside the URL.

## State

The minimal browser state is an in-memory state machine:

```text
idle -> release_ready -> active -> reconnecting -> active
                         |              |
                         v              v
                       paused         closed
```

Sharing is a capability attached to the active session; it does not create a
second author branch. A reconnect carries only the last rendered event ID and
replaces the displayed session snapshot returned by Runtime.

## Health and configuration contract

The bridge health response must retain `schemaVersion: 1`, identify itself as
`novel-runtime-bridge`, set `canonicalWrite: false`, and expose these
capabilities before the UI enables the corresponding controls:

```text
release.open
session.open
session.share
session.snapshot
session.reconnect
```

`runtimeConfigured` and `runtimeReachable` remain explicit readiness flags.
The browser receives neither `NOVEL_RUNTIME_BASE_URL` nor
`NOVEL_RUNTIME_TOKEN`; those stay in the server bridge configuration.

## Verification

Unit tests verify fixed paths, credential stripping, schema and identifier
rejection, health capability gating, player-only recovery, and the state
sequence. The remote Gate must also run bridge integration and Playwright: the
visible Story stage opens from the normal homepage, completes a player turn
without author acceptance, reloads, and recovers player-only render events
from Runtime authority state.
