const BRIDGE_PREFIX = '/api/plugins/novel-runtime-bridge';
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function bridgeHeaders(getHeaders) {
    const headers = new Headers(getHeaders());
    headers.delete('authorization');
    headers.delete('x-novel-actor-id');
    headers.delete('x-novel-runtime-url');
    return headers;
}

function requireOpaqueId(value, label) {
    if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`${label} must be an opaque identifier.`);
    return value;
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

    async function createTurn({ projectId, branchId, chapterId, sceneId, inputMode, inputText, turnId, mode = 'cowrite' }, signal) {
        requireOpaqueId(projectId, 'Project ID');
        requireOpaqueId(branchId, 'Branch ID');
        requireOpaqueId(chapterId, 'Chapter ID');
        requireOpaqueId(sceneId, 'Scene ID');
        requireOpaqueId(turnId, 'Turn ID');
        if (!['act', 'speak', 'narrate', 'direct'].includes(inputMode)) throw new TypeError('Input mode is invalid.');
        const headers = bridgeHeaders(getHeaders);
        headers.set('content-type', 'application/json');
        headers.set('idempotency-key', turnId);
        const body = await readJson(await fetchImpl(`${BRIDGE_PREFIX}/v1/turns`, {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            redirect: 'error',
            body: JSON.stringify({
                projectId,
                branchId,
                mode,
                turn: { id: turnId, chapterId, sceneId, inputMode, inputText },
            }),
            signal,
        }));
        const data = body?.data;
        if (!data || typeof data !== 'object') throw new Error('Novel Runtime returned an invalid turn response.');
        return { ...data, turnId: data.turn_id || data.turnId || turnId, streamId: data.id || data.streamId || data.stream_id || null };
    }

    async function events(turnId, { lastEventId = null, signal, onEvent } = {}) {
        requireOpaqueId(turnId, 'Turn ID');
        if (typeof onEvent !== 'function') throw new TypeError('Novel event callback is required.');
        const headers = bridgeHeaders(getHeaders);
        headers.set('accept', 'text/event-stream');
        if (lastEventId) headers.set('last-event-id', requireOpaqueId(lastEventId, 'Last event ID'));
        const response = await fetchImpl(`${BRIDGE_PREFIX}/v1/turns/${encodeURIComponent(turnId)}/events`, {
            method: 'GET', headers, credentials: 'same-origin', redirect: 'error', signal,
        });
        if (!response.ok || !response.body) throw new Error(`Novel Runtime event stream returned ${response.status}.`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let current = { id: null, event: null, data: [] };
        const flush = async () => {
            if (!current.data.length) return;
            const payload = JSON.parse(current.data.join('\n'));
            await onEvent(payload, current);
            current = { id: null, event: null, data: [] };
        };
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                buffer += decoder.decode(chunk.value, { stream: true });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line) { await flush(); continue; }
                    if (line.startsWith('id:')) current.id = line.slice(3).trim();
                    else if (line.startsWith('event:')) current.event = line.slice(6).trim();
                    else if (line.startsWith('data:')) current.data.push(line.slice(5).trimStart());
                }
            }
            if (buffer) {
                if (buffer.startsWith('data:')) current.data.push(buffer.slice(5).trimStart());
                await flush();
            }
        } finally {
            reader.releaseLock();
        }
    }

    async function cancel(turnId, reason = 'user', signal) {
        requireOpaqueId(turnId, 'Turn ID');
        const headers = bridgeHeaders(getHeaders);
        headers.set('content-type', 'application/json');
        return readJson(await fetchImpl(`${BRIDGE_PREFIX}/v1/turns/${encodeURIComponent(turnId)}/cancel`, {
            method: 'POST', headers,
            credentials: 'same-origin', redirect: 'error', body: JSON.stringify({ reason }), signal,
        }));
    }

    async function accept(turnId, payload, signal) {
        requireOpaqueId(turnId, 'Turn ID');
        const headers = bridgeHeaders(getHeaders);
        headers.set('content-type', 'application/json');
        return readJson(await fetchImpl(`${BRIDGE_PREFIX}/v1/turns/${encodeURIComponent(turnId)}/accept`, {
            method: 'POST', headers,
            credentials: 'same-origin', redirect: 'error', body: JSON.stringify(payload || {}), signal,
        }));
    }

    return Object.freeze({ health, snapshot, createTurn, events, cancel, accept });
}
