const BRIDGE_PREFIX = '/api/plugins/novel-runtime-bridge';
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const SAFE_SHARE_PATH = /^(?:\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,512}|\/\?novel-share=[A-Za-z0-9_-]{32,128})$/;
const TURN_STAGES = new Set([
    'idle', 'accepted', 'planning', 'validating', 'writing',
    'awaiting_approval', 'committing', 'committed', 'stale',
    'cancelled', 'failed',
]);

export const RELEASE_SESSION_SCHEMA_VERSION = 1;
export const RELEASE_SESSION_BRIDGE_PREFIX = BRIDGE_PREFIX;
export const RELEASE_SESSION_HEALTH_CAPABILITIES = Object.freeze([
    'release.open',
    'session.open',
    'session.share',
    'session.snapshot',
    'session.reconnect',
]);
export const RELEASE_SESSION_STATUSES = Object.freeze(['idle', 'release_ready', 'active', 'paused', 'reconnecting', 'closed', 'error']);

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireId(value, label) {
    if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
        throw new TypeError(`${label} must be an opaque identifier.`);
    }
    return value;
}

function optionalId(value, label) {
    if (value === null || value === undefined || value === '') return null;
    return requireId(value, label);
}

function requireShareToken(value) {
    if (typeof value !== 'string' || !SHARE_TOKEN.test(value)) {
        throw new TypeError('Novel share token is invalid.');
    }
    return value;
}

export function readNovelShareToken(locationLike = globalThis.location) {
    const search = typeof locationLike?.search === 'string' ? locationLike.search : '';
    const values = new URLSearchParams(search).getAll('novel-share');
    if (values.length === 0) return null;
    if (values.length !== 1) throw new TypeError('Novel share entry is ambiguous.');
    return requireShareToken(values[0]);
}

function requireDigest(value, label) {
    if (typeof value !== 'string' || !DIGEST.test(value)) {
        throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
    }
    return value;
}

function requireVersionedObject(value, label) {
    if (!isObject(value) || value.schemaVersion !== RELEASE_SESSION_SCHEMA_VERSION) {
        throw new TypeError(`${label} has an unsupported schema version.`);
    }
    return value;
}

function bridgeHeaders(getHeaders) {
    const headers = new Headers(getHeaders());
    headers.delete('authorization');
    headers.delete('x-novel-actor-id');
    headers.delete('x-novel-actor-role');
    headers.delete('x-novel-runtime-url');
    headers.set('accept', 'application/json');
    return headers;
}

function fixedPath(path) {
    if (typeof path !== 'string' || !path.startsWith('/v1/')) {
        throw new TypeError('Release/session paths must use the fixed versioned bridge API.');
    }
    return path;
}

function queryString(lastEventId) {
    if (lastEventId === null || lastEventId === undefined || lastEventId === '') return '';
    return `?lastEventId=${encodeURIComponent(requireId(lastEventId, 'Last event ID'))}`;
}

function parseRelease(value) {
    const release = requireVersionedObject(value, 'Release response');
    requireId(release.releaseId, 'Release ID');
    requireId(release.projectId, 'Project ID');
    requireId(release.branchId, 'Branch ID');
    requireId(release.headCommitId, 'Release head commit ID');
    requireDigest(release.contentHash, 'Release content hash');
    requireDigest(release.manifestHash, 'Release manifest hash');
    if (release.status !== 'published') throw new TypeError('Release is not published.');
    if (!isObject(release.manifest)) throw new TypeError('Release manifest is invalid.');
    return Object.freeze({ ...release });
}

function parseRenderCursor(value) {
    if (!isObject(value)) throw new TypeError('Session render cursor is invalid.');
    const lastEventId = optionalId(value.lastEventId, 'Session cursor event ID');
    if (!Number.isSafeInteger(value.lastSeq) || value.lastSeq < -1) {
        throw new TypeError('Session render cursor sequence is invalid.');
    }
    return Object.freeze({ lastEventId, lastSeq: value.lastSeq });
}

function parsePlayerEvent(value) {
    if (
        !isObject(value)
        || value.schema_version !== RELEASE_SESSION_SCHEMA_VERSION
        || value.audience !== 'player'
        || !isObject(value.render)
        || value.render.schemaVersion !== RELEASE_SESSION_SCHEMA_VERSION
        || typeof value.render.type !== 'string'
        || !Number.isSafeInteger(value.seq) || value.seq < 0
    ) throw new TypeError('Session recovery event is invalid.');
    requireId(value.event_id, 'Session recovery event ID');
    requireId(value.turn_id, 'Session recovery turn ID');
    return Object.freeze({ ...value });
}

function parseStageSnapshot(value) {
    if (!isObject(value) || !TURN_STAGES.has(value.stage)) {
        throw new TypeError('Session stage snapshot is invalid.');
    }
    const turnId = optionalId(value.turnId, 'Session stage turn ID');
    const lastRender = value.lastRender == null ? null : parsePlayerEvent(value.lastRender);
    if (lastRender && turnId !== lastRender.turn_id) {
        throw new TypeError('Session stage snapshot turn does not match its render event.');
    }
    return Object.freeze({ turnId, stage: value.stage, lastRender });
}

function parseSession(value) {
    const session = requireVersionedObject(value, 'Session response');
    requireId(session.sessionId, 'Session ID');
    requireId(session.releaseId, 'Release ID');
    requireId(session.projectId, 'Project ID');
    requireId(session.branchId, 'Session branch ID');
    if (!['author', 'player'].includes(session.audience)) throw new TypeError('Session audience is invalid.');
    if (!['active', 'paused', 'reconnecting', 'closed'].includes(session.status)) {
        throw new TypeError('Session status is invalid.');
    }
    optionalId(session.headCommitId, 'Session head commit ID');
    optionalId(session.lastEventId, 'Last event ID');
    optionalId(session.activeTurnId, 'Active turn ID');
    optionalId(session.lastTurnId, 'Last turn ID');
    if (!Number.isSafeInteger(session.revision) || session.revision < 0) {
        throw new TypeError('Session revision is invalid.');
    }
    if (!TURN_STAGES.has(session.turnStage)) throw new TypeError('Session turn stage is invalid.');
    const renderCursor = parseRenderCursor(session.renderCursor);
    const stageSnapshot = parseStageSnapshot(session.stageSnapshot);
    if (session.recoveryEvents !== undefined && !Array.isArray(session.recoveryEvents)) {
        throw new TypeError('Session recovery events are invalid.');
    }
    const recoveryEvents = session.recoveryEvents === undefined
        ? undefined
        : Object.freeze(session.recoveryEvents.map(parsePlayerEvent));
    if (session.replayTruncated !== undefined && typeof session.replayTruncated !== 'boolean') {
        throw new TypeError('Session replay marker is invalid.');
    }
    return Object.freeze({
        ...session,
        renderCursor,
        stageSnapshot,
        ...(recoveryEvents === undefined ? {} : { recoveryEvents }),
    });
}

function parseShare(value) {
    const share = requireVersionedObject(value, 'Session share response');
    requireId(share.sessionId, 'Session ID');
    requireId(share.shareId, 'Share ID');
    if (typeof share.sharePath !== 'string' || !SAFE_SHARE_PATH.test(share.sharePath)) {
        throw new TypeError('Session share path is invalid.');
    }
    return Object.freeze({ ...share });
}

export function validateReleaseSessionHealth(value) {
    const health = requireVersionedObject(value, 'Release/session health response');
    if (health.service !== 'novel-runtime-bridge' || health.status !== 'ready' || health.canonicalWrite !== false) {
        throw new TypeError('Release/session health identity is invalid.');
    }
    if (!Array.isArray(health.capabilities)
        || !RELEASE_SESSION_HEALTH_CAPABILITIES.every(capability => health.capabilities.includes(capability))) {
        throw new TypeError('Release/session health capabilities are incomplete.');
    }
    if (typeof health.runtimeConfigured !== 'boolean' || typeof health.runtimeReachable !== 'boolean') {
        throw new TypeError('Release/session health readiness flags are invalid.');
    }
    return Object.freeze({ ...health });
}

async function readResponse(response) {
    let body;
    try {
        body = await response.json();
    } catch {
        throw new Error('Release/session bridge returned invalid JSON.');
    }
    if (!response.ok || body?.ok !== true) {
        const error = new Error(body?.error?.message || `Release/session bridge returned ${response.status}.`);
        error.code = body?.error?.code || 'RELEASE_SESSION_REQUEST_FAILED';
        error.status = response.status;
        throw error;
    }
    return requireVersionedObject(body.data, 'Release/session response data');
}

export function createNovelReleaseSessionClient({
    fetchImpl = globalThis.fetch,
    getHeaders = () => ({}),
} = {}) {
    if (typeof fetchImpl !== 'function' || typeof getHeaders !== 'function') {
        throw new TypeError('Release/session client requires fetch and header providers.');
    }

    async function request(method, path, { body, lastEventId, signal } = {}) {
        const headers = bridgeHeaders(getHeaders);
        if (body !== undefined) headers.set('content-type', 'application/json');
        const response = await fetchImpl(`${BRIDGE_PREFIX}${fixedPath(path)}${queryString(lastEventId)}`, {
            method,
            headers,
            credentials: 'same-origin',
            redirect: 'error',
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
        return readResponse(response);
    }

    async function requestPublicShare(shareToken, signal) {
        const headers = bridgeHeaders(getHeaders);
        const response = await fetchImpl(
            `${BRIDGE_PREFIX}/share/${encodeURIComponent(requireShareToken(shareToken))}`,
            {
                method: 'GET',
                headers,
                credentials: 'same-origin',
                redirect: 'error',
                signal,
            },
        );
        return readResponse(response);
    }

    async function openRelease(releaseId, signal) {
        const data = await request('GET', `/v1/releases/${encodeURIComponent(requireId(releaseId, 'Release ID'))}`, { signal });
        return parseRelease(data);
    }

    async function openSession(releaseId, { audience = 'player', povEntityId = null } = {}, signal) {
        const normalizedReleaseId = requireId(releaseId, 'Release ID');
        if (!['author', 'player'].includes(audience)) throw new TypeError('Session audience must be author or player.');
        const data = await request('POST', `/v1/releases/${encodeURIComponent(normalizedReleaseId)}/sessions`, {
            body: {
                schemaVersion: RELEASE_SESSION_SCHEMA_VERSION,
                audience,
                povEntityId: optionalId(povEntityId, 'POV entity ID'),
            },
            signal,
        });
        return parseSession(data);
    }

    async function shareSession(sessionId, { visibility = 'link' } = {}, signal) {
        const normalizedSessionId = requireId(sessionId, 'Session ID');
        if (!['private', 'link'].includes(visibility)) throw new TypeError('Session share visibility is invalid.');
        const data = await request('POST', `/v1/sessions/${encodeURIComponent(normalizedSessionId)}/share`, {
            body: { schemaVersion: RELEASE_SESSION_SCHEMA_VERSION, visibility },
            signal,
        });
        return parseShare(data);
    }

    async function sessionSnapshot(sessionId, signal) {
        const normalizedSessionId = requireId(sessionId, 'Session ID');
        return parseSession(await request('GET', `/v1/sessions/${encodeURIComponent(normalizedSessionId)}`, { signal }));
    }

    async function reconnectSession(sessionId, { lastEventId = null } = {}, signal) {
        const normalizedSessionId = requireId(sessionId, 'Session ID');
        return parseSession(await request('GET', `/v1/sessions/${encodeURIComponent(normalizedSessionId)}/reconnect`, {
            lastEventId,
            signal,
        }));
    }

    async function openSharedSession(shareToken, signal) {
        const session = parseSession(await requestPublicShare(shareToken, signal));
        if (session.audience !== 'player') throw new TypeError('Shared session audience is invalid.');
        return session;
    }

    return Object.freeze({
        openRelease,
        openSession,
        shareSession,
        sessionSnapshot,
        reconnectSession,
        openSharedSession,
        validateHealth: validateReleaseSessionHealth,
    });
}

export function createInitialReleaseSessionState() {
    return Object.freeze({
        status: 'idle',
        release: null,
        session: null,
        share: null,
        error: null,
    });
}

function stateError(message) {
    throw new Error(`Invalid release/session state transition: ${message}`);
}

export function reduceReleaseSessionState(previous, event) {
    if (!isObject(previous) || !RELEASE_SESSION_STATUSES.includes(previous.status)) {
        throw new TypeError('Release/session state is invalid.');
    }
    if (!isObject(event) || typeof event.type !== 'string') throw new TypeError('Release/session event is invalid.');
    switch (event.type) {
        case 'release.opened': {
            const release = parseRelease(event.release);
            return Object.freeze({ ...createInitialReleaseSessionState(), status: 'release_ready', release });
        }
        case 'session.opened': {
            const session = parseSession(event.session);
            if (!previous.release || previous.release.releaseId !== session.releaseId) {
                stateError('a session requires its release to be opened first');
            }
            return Object.freeze({ ...previous, status: session.status === 'closed' ? 'closed' : 'active', session, share: null, error: null });
        }
        case 'session.shared': {
            const share = parseShare(event.share);
            if (!previous.session || previous.session.sessionId !== share.sessionId) stateError('share does not match the active session');
            return Object.freeze({ ...previous, share });
        }
        case 'session.reconnecting':
            if (!previous.session) stateError('reconnect requires an open session');
            return Object.freeze({ ...previous, status: 'reconnecting', error: null });
        case 'session.reconnected': {
            const session = parseSession(event.session);
            if (!previous.session || previous.session.sessionId !== session.sessionId) stateError('reconnect response does not match the session');
            return Object.freeze({ ...previous, status: session.status === 'closed' ? 'closed' : 'active', session, error: null });
        }
        case 'session.paused':
            if (!previous.session) stateError('pause requires an open session');
            return Object.freeze({ ...previous, status: 'paused', session: previous.session ? { ...previous.session, status: 'paused' } : null });
        case 'session.closed':
            if (!previous.session) stateError('close requires an open session');
            return Object.freeze({ ...previous, status: 'closed', session: previous.session ? { ...previous.session, status: 'closed' } : null });
        case 'session.failed':
            return Object.freeze({ ...previous, status: 'error', error: typeof event.message === 'string' ? event.message : 'Session failed.' });
        case 'reset':
            return createInitialReleaseSessionState();
        default:
            stateError(`unknown event ${event.type}`);
    }
}
