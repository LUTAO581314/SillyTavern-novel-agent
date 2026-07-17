# Novel Runtime Bridge

This SillyTavern server plugin is the server-owned boundary for Novel Mode. In
S02-04 it exposes only `GET /api/plugins/novel-runtime-bridge/health`. It does
not proxy model requests, submit turns, read PostgreSQL, or expose a canonical
write route.

Configuration is server-only:

- `NOVEL_RUNTIME_BASE_URL`: absolute HTTP(S) Runtime base URL without embedded
  credentials, query data, or a fragment.
- `NOVEL_RUNTIME_TOKEN`: optional server-held bearer token.

Neither value is returned by the health endpoint or stored in browser settings.
Set `enableServerPlugins: true` in the local SillyTavern configuration to load
server plugins. The upstream default remains unchanged in this stage.
