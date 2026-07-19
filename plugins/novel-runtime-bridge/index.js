import { randomUUID as createRandomUUID } from 'node:crypto';

import { readRuntimeConfig } from './config.js';
import { createPublicHealthPayload } from './health-fixture.js';
import {
    createErrorEnvelope,
    createRuntimeClient,
    pipeEventStream,
    RuntimeBridgeError,
} from './runtime-client.js';

export const info = Object.freeze({
    id: 'novel-runtime-bridge',
    name: 'Mengdie Runtime Bridge',
    description: 'Server-owned bridge boundary for Mengdie Studio.',
});

let runtimeConfig = readRuntimeConfig({});
let runtimeClient = createRuntimeClient(runtimeConfig);
let randomUUID = createRandomUUID;

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const APPROVAL_BODY_KEYS = new Set([
    'projectId', 'proposalId', 'attemptId', 'planId', 'referenceDigest',
    'idempotencyKey',
]);
const WORKSPACE_ID = '[A-Za-z0-9][A-Za-z0-9._:-]{0,127}';
const WORKSPACE_QUERY_KEYS = new Set(['audience', 'branchId', 'contextPackId', 'povEntityId']);
const OPEN_SESSION_BODY_KEYS = new Set(['schemaVersion', 'audience', 'povEntityId', 'requestId']);
const SHARE_SESSION_BODY_KEYS = new Set(['schemaVersion', 'visibility']);
const RECONNECT_QUERY_KEYS = new Set(['lastEventId']);
const TURN_BODY_KEYS = new Set(['schemaVersion', 'projectId', 'branchId', 'mode', 'povEntityId', 'modelProfileId', 'turn']);
const TURN_INPUT_KEYS = new Set(['id', 'chapterId', 'sceneId', 'inputMode', 'inputText']);
const SHARE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const PUBLIC_SHARE_ENTRY_PREFIX = '/?novel-share=';
const SESSION_TURN_STAGES = new Set([
    'idle', 'accepted', 'planning', 'validating', 'writing',
    'awaiting_approval', 'committing', 'committed', 'stale',
    'cancelled', 'failed',
]);
const RELEASE_EXPORT_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; font-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PLAYER_SHARED_SESSION_KEYS = Object.freeze([
    'schemaVersion', 'sessionId', 'releaseId', 'projectId', 'branchId',
    'headCommitId', 'lastEventId', 'revision', 'status', 'audience',
    'povEntityId', 'activeTurnId', 'lastTurnId', 'turnStage',
    'renderCursor', 'stageSnapshot', 'createdAt', 'updatedAt',
]);

// Workspace requests are deliberately routed through a finite allowlist. The
// browser never supplies a Runtime URL or an arbitrary upstream path.
const WORKSPACE_ROUTES = Object.freeze([
    ['GET', new RegExp(`^/projects$`)],
    ['POST', new RegExp(`^/projects$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/chapters$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/chapters$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/scenes$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/scenes$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/world-bible$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/world-bible/validate$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/world-bible/commands$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/world-guide/proposals$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/world-guide/confirm$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/imports/(?:character-card|charx)/preview$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/imports/(?:character-card|charx)/confirm$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/imports/(?:character-card|charx)/[a-f0-9]{64}$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/imports/(?:chat|swipe)/preview$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/imports/(?:chat|swipe)/confirm$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/imports/(?:chat|swipe)/[a-f0-9]{64}$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/imports/world-info/preview$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/imports/world-info/confirm$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/imports/world-info/review-items$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/imports/world-info/review-items/${WORKSPACE_ID}$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/imports/world-info/[a-f0-9]{64}$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/world-snapshot$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/branches/${WORKSPACE_ID}$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/workspace/view$`)],
    ['GET', new RegExp(`^/projects/${WORKSPACE_ID}/workspace/recall$`)],
    ['POST', new RegExp(`^/projects/${WORKSPACE_ID}/workspace/bootstrap$`)],
]);

function isWorkspaceRoute(method, path) {
    return WORKSPACE_ROUTES.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(path));
}

function isAuthorOnlyWorkspaceRoute(method, path) {
    if (method !== 'GET') return true;
    if (path === '/projects') return false;
    return !path.endsWith('/workspace/view');
}

function playerProjectCatalog(result, accessRole, path) {
    if (accessRole !== 'player' || path !== '/projects' || result.status < 200 || result.status >= 300) {
        return result;
    }
    if (!Array.isArray(result.body?.data)) {
        throw new RuntimeBridgeError(
            'BRIDGE_RUNTIME_RESPONSE_INVALID',
            'Runtime returned an invalid player project catalog.',
            502,
            true,
        );
    }
    return {
        ...result,
        body: {
            ...result.body,
            data: result.body.data.map(project => ({
                schemaVersion: project?.schemaVersion ?? 1,
                id: project?.id,
                slug: project?.slug,
                title: project?.title,
                status: project?.status,
            })),
        },
    };
}

function workspacePath(request, accessRole) {
    const path = request.path.replace(/^\/v1\/workspace/, '');
    if (!path || !isWorkspaceRoute(request.method, path)) {
        throw new RuntimeBridgeError(
            'BRIDGE_WORKSPACE_ROUTE_NOT_ALLOWED',
            'This Novel workspace route is not available through the bridge.',
            404,
            false,
        );
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
        throw new RuntimeBridgeError(
            'BRIDGE_WORKSPACE_METHOD_NOT_ALLOWED',
            'This Novel workspace method is not available through the bridge.',
            405,
            false,
        );
    }
    if (accessRole === 'player' && isAuthorOnlyWorkspaceRoute(request.method, path)) {
        throw new RuntimeBridgeError(
            'BRIDGE_AUTHOR_REQUIRED',
            'This Novel workspace route requires author access.',
            403,
            false,
        );
    }
    if (request.query && Object.keys(request.query).some((key) => !WORKSPACE_QUERY_KEYS.has(key))) {
        throw new RuntimeBridgeError(
            'BRIDGE_WORKSPACE_QUERY_NOT_ALLOWED',
            'Novel workspace query parameters are restricted.',
            400,
            false,
        );
    }
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {})) {
        if (request.method !== 'GET' || typeof value !== 'string') {
            throw new RuntimeBridgeError(
                'BRIDGE_WORKSPACE_QUERY_INVALID',
                'Novel workspace query is invalid.',
                400,
                false,
            );
        }
        if (key === 'audience') {
            if (!['author', 'player'].includes(value)) {
                throw new RuntimeBridgeError(
                    'BRIDGE_WORKSPACE_QUERY_INVALID',
                    'Novel workspace audience is invalid.',
                    400,
                    false,
                );
            }
            if (accessRole === 'player' && value !== 'player') {
                throw new RuntimeBridgeError(
                    'BRIDGE_AUDIENCE_FORBIDDEN',
                    'Player access cannot request an author workspace view.',
                    403,
                    false,
                );
            }
        } else if (!OPAQUE_ID.test(value)) {
            throw new RuntimeBridgeError(
                'BRIDGE_WORKSPACE_QUERY_INVALID',
                'Novel workspace query identifiers are invalid.',
                400,
                false,
            );
        }
        query.set(key, value);
    }
    const encoded = query.toString();
    return encoded ? `${path}?${encoded}` : path;
}

function workspaceBody(request, path, actorId) {
    const body = readObjectBody(request);
    const serverActorRoute = path.endsWith('/world-bible/commands')
        || path.endsWith('/world-guide/proposals')
        || path.endsWith('/world-guide/confirm')
        || /\/imports\/(?:character-card|charx|world-info|chat|swipe)\/(?:preview|confirm)$/.test(path)
        || new RegExp(`^/projects/${WORKSPACE_ID}/imports/world-info/review-items/${WORKSPACE_ID}$`).test(path)
        || path.endsWith('/workspace/bootstrap');
    return serverActorRoute ? { ...body, actorId } : body;
}

function requireOpaqueId(value, label) {
    if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
        throw new RuntimeBridgeError(
            'BRIDGE_REQUEST_INVALID',
            `${label} must be an opaque identifier.`,
            400,
            false,
        );
    }
    return value;
}

function requireActorId(request) {
    const handle = request.user?.profile?.handle;
    if (typeof handle !== 'string' || !handle) {
        throw new RuntimeBridgeError(
            'BRIDGE_IDENTITY_REQUIRED',
            'An authenticated SillyTavern user is required.',
            403,
            false,
        );
    }
    const encoded = Buffer.from(handle, 'utf8').toString('base64url');
    return requireOpaqueId(`sillytavern:${encoded}`, 'Mapped actor ID');
}

function requireAccessRole(request) {
    if (!request.user?.profile || typeof request.user.profile.admin !== 'boolean') {
        throw new RuntimeBridgeError(
            'BRIDGE_ROLE_REQUIRED',
            'Novel access requires a SillyTavern user role.',
            403,
            false,
        );
    }
    return request.user.profile.admin ? 'author' : 'player';
}

function requireAuthorRole(context) {
    if (context.accessRole !== 'author') {
        throw new RuntimeBridgeError(
            'BRIDGE_AUTHOR_REQUIRED',
            'This Novel command requires author access.',
            403,
            false,
        );
    }
}

function readHeader(request, name, { required = false } = {}) {
    const value = request.get(name);
    if (!value) {
        if (required) {
            throw new RuntimeBridgeError(
                'IDEMPOTENCY_KEY_REQUIRED',
                'Idempotency-Key is required for turn creation.',
                400,
                false,
            );
        }
        return null;
    }
    return requireOpaqueId(value, name);
}

function readObjectBody(request) {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
        throw new RuntimeBridgeError(
            'BRIDGE_REQUEST_INVALID',
            'Request body must be a JSON object.',
            400,
            false,
        );
    }
    return request.body;
}

function requireOnlyKeys(value, allowedKeys, code, message) {
    if (Object.keys(value).some(key => !allowedKeys.has(key))) {
        throw new RuntimeBridgeError(code, message, 400, false);
    }
}

function openSessionBody(request, accessRole) {
    const body = readObjectBody(request);
    requireOnlyKeys(
        body,
        OPEN_SESSION_BODY_KEYS,
        'BRIDGE_SESSION_PAYLOAD_FORBIDDEN',
        'Session opening accepts only the fixed release/session contract.',
    );
    if (body.schemaVersion !== undefined && body.schemaVersion !== 1) {
        throw new RuntimeBridgeError(
            'BRIDGE_SESSION_SCHEMA_UNSUPPORTED',
            'Session opening requires schema version 1.',
            400,
            false,
        );
    }
    const audience = body.audience ?? 'player';
    if (!['author', 'player'].includes(audience)) {
        throw new RuntimeBridgeError('BRIDGE_SESSION_AUDIENCE_INVALID', 'Session audience is invalid.', 400, false);
    }
    if (accessRole === 'player' && audience !== 'player') {
        throw new RuntimeBridgeError(
            'BRIDGE_AUDIENCE_FORBIDDEN',
            'Player access cannot open an author session.',
            403,
            false,
        );
    }
    const povEntityId = body.povEntityId == null
        ? null
        : requireOpaqueId(body.povEntityId, 'POV entity ID');
    return {
        schemaVersion: 1,
        audience,
        povEntityId,
        ...(body.requestId === undefined
            ? {}
            : { requestId: requireOpaqueId(body.requestId, 'Session request ID') }),
    };
}

function shareSessionBody(request) {
    const body = readObjectBody(request);
    requireOnlyKeys(
        body,
        SHARE_SESSION_BODY_KEYS,
        'BRIDGE_SESSION_SHARE_PAYLOAD_FORBIDDEN',
        'Session sharing accepts only the fixed visibility contract.',
    );
    if (body.schemaVersion !== undefined && body.schemaVersion !== 1) {
        throw new RuntimeBridgeError(
            'BRIDGE_SESSION_SCHEMA_UNSUPPORTED',
            'Session sharing requires schema version 1.',
            400,
            false,
        );
    }
    const visibility = body.visibility ?? 'link';
    if (!['private', 'link'].includes(visibility)) {
        throw new RuntimeBridgeError('BRIDGE_SESSION_VISIBILITY_INVALID', 'Session share visibility is invalid.', 400, false);
    }
    return { schemaVersion: 1, visibility };
}

function turnBody(request, accessRole) {
    const input = readObjectBody(request);
    requireOnlyKeys(
        input,
        TURN_BODY_KEYS,
        'BRIDGE_TURN_PAYLOAD_FORBIDDEN',
        'Turn creation accepts only the fixed Novel turn contract.',
    );
    if (input.schemaVersion !== undefined && input.schemaVersion !== 1) {
        throw new RuntimeBridgeError('BRIDGE_TURN_SCHEMA_UNSUPPORTED', 'Turn creation requires schema version 1.', 400, false);
    }
    const turn = input.turn;
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
        throw new RuntimeBridgeError('BRIDGE_TURN_PAYLOAD_INVALID', 'Turn input is invalid.', 400, false);
    }
    requireOnlyKeys(
        turn,
        TURN_INPUT_KEYS,
        'BRIDGE_TURN_PAYLOAD_FORBIDDEN',
        'Turn input contains unsupported fields.',
    );
    if (!['act', 'speak', 'narrate', 'direct'].includes(turn.inputMode)) {
        throw new RuntimeBridgeError('BRIDGE_TURN_MODE_INVALID', 'Turn input mode is invalid.', 400, false);
    }
    if (accessRole === 'player' && turn.inputMode === 'direct') {
        throw new RuntimeBridgeError(
            'BRIDGE_DIRECTOR_COMMAND_FORBIDDEN',
            'Player access cannot submit director commands.',
            403,
            false,
        );
    }
    if (typeof turn.inputText !== 'string' || !turn.inputText.trim() || turn.inputText.length > 64_000) {
        throw new RuntimeBridgeError('BRIDGE_TURN_TEXT_INVALID', 'Turn input text is invalid.', 400, false);
    }
    const mode = accessRole === 'player' ? 'play' : (input.mode ?? 'cowrite');
    if (!['cowrite', 'play'].includes(mode)) {
        throw new RuntimeBridgeError('BRIDGE_TURN_MODE_INVALID', 'Turn execution mode is invalid.', 400, false);
    }
    const normalized = {
        schemaVersion: 1,
        projectId: requireOpaqueId(input.projectId, 'Project ID'),
        branchId: requireOpaqueId(input.branchId, 'Branch ID'),
        mode,
        modelProfileId: requireOpaqueId(input.modelProfileId, 'Model profile ID'),
        turn: {
            id: requireOpaqueId(turn.id, 'Turn ID'),
            chapterId: requireOpaqueId(turn.chapterId, 'Chapter ID'),
            sceneId: requireOpaqueId(turn.sceneId, 'Scene ID'),
            inputMode: turn.inputMode,
            inputText: turn.inputText.trim(),
        },
    };
    if (accessRole === 'author') {
        normalized.povEntityId = requireOpaqueId(input.povEntityId, 'POV entity ID');
    }
    return normalized;
}

function reconnectQuery(request) {
    const query = request.query ?? {};
    if (Object.keys(query).some(key => !RECONNECT_QUERY_KEYS.has(key))) {
        throw new RuntimeBridgeError(
            'BRIDGE_SESSION_QUERY_NOT_ALLOWED',
            'Session reconnect query parameters are restricted.',
            400,
            false,
        );
    }
    if (query.lastEventId === undefined) return '';
    if (typeof query.lastEventId !== 'string') {
        throw new RuntimeBridgeError('BRIDGE_SESSION_QUERY_INVALID', 'Last event ID is invalid.', 400, false);
    }
    return `?lastEventId=${encodeURIComponent(requireOpaqueId(query.lastEventId, 'Last event ID'))}`;
}

function requireShareToken(value) {
    if (typeof value !== 'string' || !SHARE_TOKEN.test(value)) {
        throw new RuntimeBridgeError('BRIDGE_SHARE_TOKEN_INVALID', 'Share token is invalid.', 400, false);
    }
    return value;
}

function rewriteSharePath(result) {
    if (result.status < 200 || result.status >= 300) return result;
    const data = result.body?.data;
    const match = typeof data?.sharePath === 'string'
        ? /^\/share\/([A-Za-z0-9_-]{32,128})$/.exec(data.sharePath)
        : null;
    if (!match) {
        throw new RuntimeBridgeError(
            'BRIDGE_RUNTIME_RESPONSE_INVALID',
            'Runtime returned an invalid session share path.',
            502,
            false,
        );
    }
    const token = requireShareToken(match[1]);
    return {
        ...result,
        body: {
            ...result.body,
            data: { ...data, sharePath: `${PUBLIC_SHARE_ENTRY_PREFIX}${encodeURIComponent(token)}` },
        },
    };
}

function playerSafeSharedSession(result) {
    if (result.status < 200 || result.status >= 300) return result;
    const data = result.body?.data;
    if (
        !data || typeof data !== 'object' || Array.isArray(data)
        || data.schemaVersion !== 1 || data.audience !== 'player'
        || typeof data.sessionId !== 'string' || !OPAQUE_ID.test(data.sessionId)
        || !Number.isSafeInteger(data.revision) || data.revision < 0
        || !data.renderCursor || typeof data.renderCursor !== 'object' || Array.isArray(data.renderCursor)
        || !Number.isSafeInteger(data.renderCursor.lastSeq) || data.renderCursor.lastSeq < -1
        || (data.renderCursor.lastEventId != null && !OPAQUE_ID.test(data.renderCursor.lastEventId))
        || !SESSION_TURN_STAGES.has(data.turnStage)
        || !data.stageSnapshot || typeof data.stageSnapshot !== 'object' || Array.isArray(data.stageSnapshot)
        || !SESSION_TURN_STAGES.has(data.stageSnapshot.stage)
        || (data.stageSnapshot.turnId != null && !OPAQUE_ID.test(data.stageSnapshot.turnId))
        || (data.stageSnapshot.lastRender != null && data.stageSnapshot.lastRender.audience !== 'player')
    ) {
        throw new RuntimeBridgeError(
            'BRIDGE_RUNTIME_RESPONSE_INVALID',
            'Runtime returned an invalid shared player session.',
            502,
            false,
        );
    }
    const projected = {};
    for (const key of PLAYER_SHARED_SESSION_KEYS) {
        if (Object.hasOwn(data, key)) projected[key] = data[key];
    }
    return { ...result, body: { ...result.body, data: projected } };
}

function sendReleaseExport(response, result, releaseId) {
    if (result.contentType === 'application/json') return sendJsonResult(response, result);
    if (
        typeof result.body !== 'string'
        || !/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i.test(result.body)
        || !/default-src\s+'none'/i.test(result.body)
        || /<script(?:\s|>)/i.test(result.body)
    ) {
        throw new RuntimeBridgeError(
            'BRIDGE_RELEASE_EXPORT_INVALID',
            'Runtime returned an unsafe release document.',
            502,
            false,
        );
    }
    const filenameId = releaseId.replace(/[^A-Za-z0-9._-]/g, '-');
    response.set({
        'cache-control': 'private, no-store',
        'content-disposition': `attachment; filename="novel-${filenameId}.html"`,
        'content-security-policy': RELEASE_EXPORT_CSP,
        'content-type': 'text/html; charset=utf-8',
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
    });
    return response.status(result.status).send(result.body);
}

function approvalBody(request) {
    const body = readObjectBody(request);
    if ([...Object.keys(body)].some(key => !APPROVAL_BODY_KEYS.has(key))) {
        throw new RuntimeBridgeError(
            'BRIDGE_APPROVAL_PAYLOAD_FORBIDDEN',
            'Canonical acceptance accepts only a Runtime-issued approval reference.',
            400,
            false,
        );
    }
    for (const key of ['projectId', 'proposalId', 'attemptId', 'planId', 'referenceDigest', 'idempotencyKey']) {
        requireOpaqueId(body[key], key);
    }
    return body;
}

function approvalQuery(request) {
    const query = new URLSearchParams();
    for (const key of ['projectId', 'proposalId', 'attemptId', 'planId']) {
        const value = request.query?.[key];
        if (value !== undefined) query.set(key, requireOpaqueId(value, key));
    }
    const encoded = query.toString();
    return encoded ? `?${encoded}` : '';
}

function sendJsonResult(response, result) {
    if (result.status === 204) {
        return response.sendStatus(204);
    }
    return response.status(result.status).json(result.body);
}

function route(handler) {
    return async (request, response) => {
        const correlationId = randomUUID();
        const controller = new AbortController();
        const onClose = () => controller.abort(new Error('Browser connection closed.'));
        response.once('close', onClose);
        try {
            await handler(request, response, {
                actorId: requireActorId(request),
                accessRole: requireAccessRole(request),
                correlationId,
                signal: controller.signal,
            });
        } catch (error) {
            if (response.destroyed) {
                return;
            }
            if (response.headersSent) {
                response.end();
                return;
            }
            const normalized = error instanceof RuntimeBridgeError
                ? error
                : new RuntimeBridgeError(
                    'BRIDGE_INTERNAL_ERROR',
                    'Runtime bridge request failed.',
                    500,
                    false,
                );
            response.status(normalized.status).json(createErrorEnvelope(normalized, correlationId));
        } finally {
            response.off('close', onClose);
        }
    };
}

function publicRoute(handler) {
    return async (request, response) => {
        const correlationId = randomUUID();
        const controller = new AbortController();
        const onClose = () => controller.abort(new Error('Browser connection closed.'));
        response.once('close', onClose);
        try {
            await handler(request, response, { correlationId, signal: controller.signal });
        } catch (error) {
            if (response.destroyed) return;
            if (response.headersSent) {
                response.end();
                return;
            }
            const normalized = error instanceof RuntimeBridgeError
                ? error
                : new RuntimeBridgeError('BRIDGE_INTERNAL_ERROR', 'Runtime bridge request failed.', 500, false);
            response.status(normalized.status).json(createErrorEnvelope(normalized, correlationId));
        } finally {
            response.off('close', onClose);
        }
    };
}

export async function init(router, {
    environment = process.env,
    fetchImpl = globalThis.fetch,
    randomUUID: randomUUIDImpl = createRandomUUID,
} = {}) {
    runtimeConfig = readRuntimeConfig(environment);
    runtimeClient = createRuntimeClient(runtimeConfig, { fetchImpl });
    randomUUID = randomUUIDImpl;

    router.get('/health', async (_request, response) => {
        if (!runtimeConfig.configured) {
            return response.json(createPublicHealthPayload(runtimeConfig));
        }
        const correlationId = randomUUID();
        try {
            const result = await runtimeClient.requestJson({
                path: '/api/health',
                correlationId,
            });
            return response.status(result.status).json(createPublicHealthPayload(runtimeConfig, {
                reachable: result.status >= 200 && result.status < 300,
                service: result.body?.service,
            }));
        } catch (error) {
            const normalized = error instanceof RuntimeBridgeError
                ? error
                : new RuntimeBridgeError('BRIDGE_INTERNAL_ERROR', 'Runtime health check failed.', 500, false);
            return response.status(normalized.status).json(createErrorEnvelope(normalized, correlationId));
        }
    });

    const workspaceRouteHandler = route(async (request, response, context) => {
        const path = workspacePath(request, context.accessRole);
        const body = request.method === 'POST'
            ? workspaceBody(request, path, context.actorId)
            : undefined;
        const result = await runtimeClient.requestJson({
            path: `/api/v1${path}`,
            method: request.method,
            actorId: context.actorId,
            actorRole: context.accessRole,
            body,
            idempotencyKey: readHeader(request, 'Idempotency-Key'),
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, playerProjectCatalog(result, context.accessRole, path));
    });
    router.get('/v1/workspace/*', workspaceRouteHandler);
    router.post('/v1/workspace/*', workspaceRouteHandler);

    router.get('/v1/releases/:releaseId', route(async (request, response, context) => {
        const releaseId = requireOpaqueId(request.params.releaseId, 'Release ID');
        const result = await runtimeClient.requestJson({
            path: `/api/v1/releases/${encodeURIComponent(releaseId)}`,
            actorId: context.actorId,
            actorRole: context.accessRole,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.get('/v1/releases/:releaseId/export.html', route(async (request, response, context) => {
        requireAuthorRole(context);
        const releaseId = requireOpaqueId(request.params.releaseId, 'Release ID');
        const result = await runtimeClient.requestHtml({
            path: `/api/v1/releases/${encodeURIComponent(releaseId)}/export.html`,
            actorId: context.actorId,
            actorRole: context.accessRole,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendReleaseExport(response, result, releaseId);
    }));

    router.post('/v1/releases/:releaseId/sessions', route(async (request, response, context) => {
        const releaseId = requireOpaqueId(request.params.releaseId, 'Release ID');
        const result = await runtimeClient.requestJson({
            path: `/api/v1/releases/${encodeURIComponent(releaseId)}/sessions`,
            method: 'POST',
            actorId: context.actorId,
            actorRole: context.accessRole,
            body: openSessionBody(request, context.accessRole),
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.post('/v1/sessions/:sessionId/share', route(async (request, response, context) => {
        const sessionId = requireOpaqueId(request.params.sessionId, 'Session ID');
        const result = await runtimeClient.requestJson({
            path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/share`,
            method: 'POST',
            actorId: context.actorId,
            actorRole: context.accessRole,
            body: shareSessionBody(request),
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, rewriteSharePath(result));
    }));

    router.get('/v1/sessions/:sessionId', route(async (request, response, context) => {
        const sessionId = requireOpaqueId(request.params.sessionId, 'Session ID');
        const result = await runtimeClient.requestJson({
            path: `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
            actorId: context.actorId,
            actorRole: context.accessRole,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.get('/v1/sessions/:sessionId/reconnect', route(async (request, response, context) => {
        const sessionId = requireOpaqueId(request.params.sessionId, 'Session ID');
        const result = await runtimeClient.requestJson({
            path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/reconnect${reconnectQuery(request)}`,
            actorId: context.actorId,
            actorRole: context.accessRole,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.get('/share/:shareToken', publicRoute(async (request, response, context) => {
        const shareToken = requireShareToken(request.params.shareToken);
        const result = await runtimeClient.requestJson({
            path: `/api/v1/share/${encodeURIComponent(shareToken)}`,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, playerSafeSharedSession(result));
    }));

    router.post('/v1/turns', route(async (request, response, context) => {
        const idempotencyKey = readHeader(request, 'Idempotency-Key', { required: true });
        const body = turnBody(request, context.accessRole);
        if (body.turn.id !== idempotencyKey) {
            throw new RuntimeBridgeError(
                'BRIDGE_TURN_IDEMPOTENCY_MISMATCH',
                'Turn ID must match the idempotency key.',
                400,
                false,
            );
        }
        const result = await runtimeClient.requestJson({
            path: '/api/v1/turns',
            method: 'POST',
            actorId: context.actorId,
            actorRole: context.accessRole,
            body,
            idempotencyKey,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.get('/v1/turns/:turnId/events', route(async (request, response, context) => {
        const turnId = requireOpaqueId(request.params.turnId, 'Turn ID');
        const stream = await runtimeClient.openEventStream({
            path: `/api/v1/turns/${encodeURIComponent(turnId)}/events${context.accessRole === 'player' ? '?audience=player' : ''}`,
            actorId: context.actorId,
            actorRole: context.accessRole,
            correlationId: context.correlationId,
            lastEventId: readHeader(request, 'Last-Event-ID'),
            signal: context.signal,
        });
        response.status(200);
        response.set({
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'content-type': 'text/event-stream; charset=utf-8',
            'x-accel-buffering': 'no',
            'x-correlation-id': context.correlationId,
        });
        response.flushHeaders();
        try {
            await pipeEventStream(stream.body, response);
            response.end();
        } finally {
            stream.cleanup();
        }
    }));

    router.post('/v1/turns/:turnId/cancel', route(async (request, response, context) => {
        const turnId = requireOpaqueId(request.params.turnId, 'Turn ID');
        const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
            ? request.body
            : {};
        const result = await runtimeClient.requestJson({
            path: `/api/v1/turns/${encodeURIComponent(turnId)}/cancel`,
            method: 'POST',
            actorId: context.actorId,
            actorRole: context.accessRole,
            body,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.post('/v1/turns/:turnId/accept', route(async (request, response, context) => {
        requireAuthorRole(context);
        const turnId = requireOpaqueId(request.params.turnId, 'Turn ID');
        const body = approvalBody(request);
        const result = await runtimeClient.requestJson({
            path: `/api/v1/turns/${encodeURIComponent(turnId)}/accept`,
            method: 'POST',
            actorId: context.actorId,
            actorRole: context.accessRole,
            body,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.get('/v1/turns/:turnId/approval', route(async (request, response, context) => {
        requireAuthorRole(context);
        const turnId = requireOpaqueId(request.params.turnId, 'Turn ID');
        const result = await runtimeClient.requestJson({
            path: `/api/v1/turns/${encodeURIComponent(turnId)}/approval${approvalQuery(request)}`,
            method: 'GET',
            actorId: context.actorId,
            actorRole: context.accessRole,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.get('/v1/turns/:turnId/snapshot', route(async (request, response, context) => {
        const turnId = requireOpaqueId(request.params.turnId, 'Turn ID');
        const result = await runtimeClient.requestJson({
            path: `/api/v1/turns/${encodeURIComponent(turnId)}/snapshot`,
            actorId: context.actorId,
            actorRole: context.accessRole,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));
}

export async function exit() {
    runtimeConfig = readRuntimeConfig({});
    runtimeClient = createRuntimeClient(runtimeConfig);
    randomUUID = createRandomUUID;
}
