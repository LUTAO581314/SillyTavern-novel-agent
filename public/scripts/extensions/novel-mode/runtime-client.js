const BRIDGE_PREFIX = '/api/plugins/novel-runtime-bridge';
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function bridgeHeaders(getHeaders) {
    const headers = new Headers(getHeaders());
    headers.delete('authorization');
    headers.delete('x-novel-actor-id');
    headers.delete('x-novel-runtime-url');
    return headers;
}

async function readJson(response) {
    let body;
    try {
        body = await response.json();
    } catch {
        throw new Error('Novel Runtime bridge returned invalid JSON.');
    }
    if (!response.ok) {
        const error = new Error(body?.error?.message || `Novel Runtime bridge returned ${response.status}.`);
        error.code = body?.error?.code || 'BRIDGE_REQUEST_FAILED';
        throw error;
    }
    return body;
}

export function createNovelModeRuntimeClient({
    fetchImpl = globalThis.fetch,
    getHeaders = () => ({}),
} = {}) {
    if (typeof fetchImpl !== 'function' || typeof getHeaders !== 'function') {
        throw new TypeError('Novel Mode Runtime client requires fetch and header providers.');
    }

    async function get(path, signal) {
        return readJson(await fetchImpl(`${BRIDGE_PREFIX}${path}`, {
            method: 'GET',
            headers: bridgeHeaders(getHeaders),
            credentials: 'same-origin',
            redirect: 'error',
            signal,
        }));
    }

    async function post(path, body, signal) {
        return readJson(await fetchImpl(`${BRIDGE_PREFIX}${path}`, {
            method: 'POST',
            headers: new Headers({
                ...Object.fromEntries(bridgeHeaders(getHeaders)),
                'content-type': 'application/json',
            }),
            body: JSON.stringify(body),
            credentials: 'same-origin',
            redirect: 'error',
            signal,
        }));
    }

    async function health(signal) {
        const body = await get('/health', signal);
        if (
            body?.schemaVersion !== 1 || body?.service !== 'novel-runtime-bridge' ||
            body?.status !== 'ready' || body?.canonicalWrite !== false ||
            typeof body.runtimeConfigured !== 'boolean' || typeof body.runtimeReachable !== 'boolean'
        ) {
            throw new Error('Novel Runtime bridge returned an incompatible health response.');
        }
        return body;
    }

    async function snapshot(turnId, signal) {
        if (typeof turnId !== 'string' || !OPAQUE_ID.test(turnId)) {
            throw new TypeError('Snapshot turn ID must be an opaque identifier.');
        }
        const body = await get(`/v1/turns/${encodeURIComponent(turnId)}/snapshot`, signal);
        if (
            body?.schemaVersion !== 1 || body?.ok !== true || !body.data ||
            body.data.turnId !== turnId || !Array.isArray(body.data.events)
        ) {
            throw new Error('Novel Runtime returned an incompatible display snapshot.');
        }
        return body.data;
    }

    async function proposeWorld(projectId, input, signal) {
        if (typeof projectId !== 'string' || !OPAQUE_ID.test(projectId)) {
            throw new TypeError('World guide project ID must be an opaque identifier.');
        }
        const body = await post(
            `/v1/projects/${encodeURIComponent(projectId)}/world-guide/proposals`,
            input,
            signal,
        );
        if (
            body?.schemaVersion !== 1 || body?.ok !== true || !body.data ||
            body.data.projectId !== projectId || body.data.trust !== 'untrusted' ||
            !Array.isArray(body.data.questions) || !Array.isArray(body.data.suggestions) ||
            body.data.suggestions.some(suggestion => (
                suggestion?.trust !== 'untrusted' ||
                suggestion?.source?.kind !== 'model_suggestion' ||
                !suggestion.item
            ))
        ) {
            throw new Error('Novel Runtime returned an incompatible world guide proposal.');
        }
        return body.data;
    }

    async function confirmWorld(projectId, input, signal) {
        if (typeof projectId !== 'string' || !OPAQUE_ID.test(projectId)) {
            throw new TypeError('World guide project ID must be an opaque identifier.');
        }
        const body = await post(
            `/v1/projects/${encodeURIComponent(projectId)}/world-guide/confirm`,
            input,
            signal,
        );
        if (
            body?.schemaVersion !== 1 || body?.ok !== true || !body.data ||
            body.data.trust !== 'untrusted' || body.data.source?.kind !== 'model_suggestion' ||
            typeof body.data.replayed !== 'boolean' || !body.data.world ||
            !Number.isInteger(body.data.world.revision)
        ) {
            throw new Error('Novel Runtime returned an incompatible world guide confirmation.');
        }
        return body.data;
    }

    return Object.freeze({ health, snapshot, proposeWorld, confirmWorld });
}
