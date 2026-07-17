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

    return Object.freeze({ health, snapshot });
}
