# Novel Runtime Bridge

This SillyTavern server plugin is the server-owned transport boundary for Novel
Mode. It exposes only fixed, same-origin routes:

- `GET /api/plugins/novel-runtime-bridge/health`
- `POST /api/plugins/novel-runtime-bridge/v1/turns`
- `GET /api/plugins/novel-runtime-bridge/v1/turns/:turnId/events`
- `POST /api/plugins/novel-runtime-bridge/v1/turns/:turnId/cancel`
- `GET /api/plugins/novel-runtime-bridge/v1/turns/:turnId/snapshot`

The bridge does not read PostgreSQL, call a model or MiroFish, orchestrate an
Agent, or commit canon. Runtime responses remain authoritative.

Configuration is server-only:

- `NOVEL_RUNTIME_BASE_URL`: absolute HTTP(S) Runtime base URL without embedded
  credentials, query data, or a fragment.
- `NOVEL_RUNTIME_TOKEN`: optional server-held bearer token.
- `NOVEL_RUNTIME_REQUEST_TIMEOUT_MS`: JSON request and SSE connection timeout.
- `NOVEL_RUNTIME_MAX_RESPONSE_BYTES`: maximum buffered JSON response size.

Neither value is returned by the health endpoint or stored in browser settings.
The target cannot be supplied in a browser body, query, URL, or header. The
bridge maps the authenticated SillyTavern account to an opaque actor header,
requires an idempotency key for turn creation, and forwards only validated
`Last-Event-ID` values for SSE resume.

Set `enableServerPlugins: true` in the local SillyTavern configuration to load
server plugins. The upstream default remains unchanged.
