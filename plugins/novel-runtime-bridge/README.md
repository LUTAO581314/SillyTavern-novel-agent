# 梦蝶 Runtime Bridge

This SillyTavern server plugin is the server-owned transport boundary for
梦蝶 Studio. Its internal id remains `novel-runtime-bridge` for v0.1 protocol
compatibility. It exposes only fixed, same-origin routes:

- `GET /api/plugins/novel-runtime-bridge/health`
- `POST /api/plugins/novel-runtime-bridge/v1/turns`
- `GET /api/plugins/novel-runtime-bridge/v1/turns/:turnId/events`
- `POST /api/plugins/novel-runtime-bridge/v1/turns/:turnId/cancel`
- `GET /api/plugins/novel-runtime-bridge/v1/turns/:turnId/snapshot`
- `GET /api/plugins/novel-runtime-bridge/v1/releases/:releaseId`
- `GET /api/plugins/novel-runtime-bridge/v1/releases/:releaseId/export.html`
- `POST /api/plugins/novel-runtime-bridge/v1/releases/:releaseId/sessions`
- `POST /api/plugins/novel-runtime-bridge/v1/sessions/:sessionId/share`
- `GET /api/plugins/novel-runtime-bridge/v1/sessions/:sessionId`
- `GET /api/plugins/novel-runtime-bridge/v1/sessions/:sessionId/reconnect`
- `GET /api/plugins/novel-runtime-bridge/share/:shareToken`
- `GET|POST /api/plugins/novel-runtime-bridge/v1/workspace/*` through a finite
  catalog/world/branch/import allowlist

The workspace allowlist includes Character Card/CHARX preview, confirmation,
and ledger reads plus World Info preview, confirmation, review-list, and
per-entry review routes. Chat and swipe imports expose only preview,
confirmation, and digest reads; imported text remains an isolated,
non-canonical draft. Import actor identity is overwritten from the authenticated
SillyTavern account on the server.

SillyTavern administrators are mapped to the Runtime `author` role; ordinary
accounts are mapped to `player`. The browser cannot supply or override this
role. Player requests are limited to the server-filtered workbench and recall
views, cannot read raw World Bible, World Snapshot, branch, or import review
routes, and cannot submit `direct` or manually accept a turn. Player SSE and
snapshot recovery are restricted to player-audience events.

Release/session routes are individually registered rather than passed through
the workspace wildcard. Protected requests receive only the authenticated
SillyTavern actor and role. Release export is author-only, size-bounded, must be
HTML with a blocking CSP, and is returned as an attachment with `nosniff`.
Creating a share rewrites Runtime's private `/share/:token` path to the
same-origin `/?novel-share=:token` 梦蝶 entry. That entry reads the
token from the URL only, calls the fixed public share handler, projects a
player-safe session snapshot, and never stores the token in browser settings
or `localStorage`.

The bridge does not read PostgreSQL, call a model or MiroFish, orchestrate an
Agent, or commit canon. Runtime responses remain authoritative.

Configuration is server-only:

- `NOVEL_RUNTIME_BASE_URL`: absolute HTTP(S) Runtime base URL without embedded
  credentials, query data, or a fragment.
- `NOVEL_RUNTIME_TOKEN`: required server-held bearer token. The exact same
  value must be configured on Novel Runtime. Core workspace and turn routes
  fail closed when it is absent or does not match.
- `NOVEL_RUNTIME_REQUEST_TIMEOUT_MS`: JSON request and SSE connection timeout.
- `NOVEL_RUNTIME_MAX_RESPONSE_BYTES`: maximum buffered JSON response size.

Neither value is returned by the health endpoint or stored in browser settings.
Without the token, health reports `runtimeConfigured: false` with
`runtimeConfigurationIssue: runtime_token_required`; Mengdie shows `Not configured`
instead of attempting a workspace or turn request.
The target cannot be supplied in a browser body, query, URL, or header. The
bridge maps the authenticated SillyTavern account to an opaque actor header,
maps the server account role to `X-Novel-Actor-Role`,
requires an idempotency key for turn creation, and forwards only validated
`Last-Event-ID` values for SSE resume.
Turn creation accepts a finite JSON shape. Canonical `povEntityId` and an opaque
`modelProfileId` may cross the bridge; URLs, provider keys, actor overrides,
and arbitrary nested fields cannot. Player session POV remains server-owned and
the bridge drops any browser-provided player POV before forwarding.

Set `enableServerPlugins: true` in the local SillyTavern configuration to load
server plugins. The upstream default remains unchanged.
