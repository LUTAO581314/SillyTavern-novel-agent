import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { describe, test } from 'node:test';

import express from 'express';

import { exit, init } from '../plugins/novel-runtime-bridge/index.js';

const BRIDGE_PREFIX = '/api/plugins/novel-runtime-bridge';
const TOKEN = 'server-only-runtime-token';

async function listen(server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
    if (!server.listening) {
        return;
    }
    server.close();
    await once(server, 'close');
}

async function readBody(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function json(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
}

async function createHarness(runtimeHandler, {
    userHandle = 'alice writer',
    userAdmin = true,
    environment = {},
} = {}) {
    const requests = [];
    const runtimeServer = http.createServer(async (request, response) => {
        const body = await readBody(request);
        requests.push({
            method: request.method,
            url: request.url,
            headers: { ...request.headers },
            body,
        });
        await runtimeHandler(request, response, body);
    });
    const runtimeBaseUrl = await listen(runtimeServer);

    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use((request, _response, next) => {
        if (userHandle !== null) {
            request.user = { profile: { handle: userHandle, admin: userAdmin } };
        }
        next();
    });
    const router = express.Router();
    await init(router, {
        environment: {
            NOVEL_RUNTIME_BASE_URL: runtimeBaseUrl,
            NOVEL_RUNTIME_TOKEN: TOKEN,
            NOVEL_RUNTIME_REQUEST_TIMEOUT_MS: '250',
            ...environment,
        },
        randomUUID: () => 'correlation-bridge-test',
    });
    app.use(BRIDGE_PREFIX, router);
    const bridgeServer = http.createServer(app);
    const bridgeBaseUrl = await listen(bridgeServer);

    return {
        requests,
        bridgeBaseUrl,
        async shutdown() {
            await exit();
            await Promise.all([close(bridgeServer), close(runtimeServer)]);
        },
    };
}

function runtimeFixture(request, response, body) {
    if (request.url === '/api/health') {
        return json(response, 200, { ok: true, service: 'novel-runtime' });
    }
    if (request.method === 'POST' && request.url === '/api/v1/turns') {
        return json(response, 201, {
            schemaVersion: 1,
            ok: true,
            data: { turnId: 'turn-fixed-target', received: JSON.parse(body) },
        });
    }
    if (request.method === 'POST' && request.url === '/api/v1/turns/turn-fixed-target/cancel') {
        return json(response, 202, {
            schemaVersion: 1,
            ok: true,
            data: { turnId: 'turn-fixed-target', status: 'cancelling' },
        });
    }
    if (request.method === 'POST' && request.url === '/api/v1/turns/turn-fixed-target/accept') {
        return json(response, 202, {
            schemaVersion: 1,
            ok: true,
            data: { turnId: 'turn-fixed-target', status: 'accepted' },
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/turns/turn-fixed-target/snapshot') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: { turnId: 'turn-fixed-target', lastEventId: 'event-4', seq: 4 },
        });
    }
    return json(response, 404, {
        schemaVersion: 1,
        ok: false,
        error: {
            code: 'NOT_FOUND',
            message: 'Not found.',
            retryable: false,
            correlationId: 'runtime-not-found',
        },
    });
}

function turnPayload({ turnId, inputMode = 'act' }) {
    return {
        schemaVersion: 1,
        projectId: 'project-fixed-target',
        branchId: 'branch-fixed-target',
        mode: 'cowrite',
        povEntityId: 'entity-pov-fixed-target',
        modelProfileId: 'model-profile-fixed-target',
        turn: {
            id: turnId,
            chapterId: 'chapter-fixed-target',
            sceneId: 'scene-fixed-target',
            inputMode,
            inputText: inputMode === 'direct' ? 'Reveal the hidden truth.' : 'Open the archive.',
        },
    };
}

describe('Novel Runtime bridge transport', () => {
    test('uses a fixed target, server identity, server credential, and idempotent turn route', async () => {
        const harness = await createHarness(runtimeFixture);
        try {
            let response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/health`);
            assert.equal(response.status, 200);
            const health = await response.json();
            assert.equal(health.runtimeConfigured, true);
            assert.equal(health.runtimeReachable, true);
            assert.doesNotMatch(JSON.stringify(health), /server-only-runtime-token|127\.0\.0\.1/);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mode: 'act' }),
            });
            assert.equal(response.status, 400);
            assert.equal((await response.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED');

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns`, {
                method: 'POST',
                headers: {
                    authorization: 'Bearer browser-token',
                    'content-type': 'application/json',
                    'idempotency-key': 'turn-request-1',
                    'x-novel-actor-id': 'browser:attacker',
                },
                body: JSON.stringify(turnPayload({ turnId: 'turn-request-1' })),
            });
            assert.equal(response.status, 201);
            assert.equal((await response.json()).data.turnId, 'turn-fixed-target');

            const requestCount = harness.requests.length;
            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'idempotency-key': 'turn-request-forbidden',
                },
                body: JSON.stringify({
                    ...turnPayload({ turnId: 'turn-request-forbidden' }),
                    targetUrl: 'https://attacker.invalid/',
                }),
            });
            assert.equal(response.status, 400);
            assert.equal((await response.json()).error.code, 'BRIDGE_TURN_PAYLOAD_FORBIDDEN');
            assert.equal(harness.requests.length, requestCount);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/cancel`, {
                method: 'POST',
            });
            assert.equal(response.status, 202);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/accept`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    projectId: 'project-fixed-target',
                    proposalId: 'proposal-writer',
                    attemptId: 'attempt-writer',
                    planId: 'plan-writer',
                    referenceDigest: 'a'.repeat(64),
                    idempotencyKey: 'approval-fixed-target',
                }),
            });
            assert.equal(response.status, 202);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/snapshot`);
            assert.equal(response.status, 200);
            assert.equal((await response.json()).data.lastEventId, 'event-4');

            const turnRequest = harness.requests.find(request => request.url === '/api/v1/turns');
            assert.equal(turnRequest.method, 'POST');
            assert.equal(turnRequest.headers.authorization, `Bearer ${TOKEN}`);
            assert.equal(turnRequest.headers['x-novel-actor-id'], 'sillytavern:YWxpY2Ugd3JpdGVy');
            assert.equal(turnRequest.headers['x-novel-actor-role'], 'author');
            assert.equal(turnRequest.headers['x-novel-client'], 'sillytavern');
            assert.equal(turnRequest.headers['idempotency-key'], 'turn-request-1');
            assert.equal(turnRequest.headers['x-correlation-id'], 'correlation-bridge-test');
            assert.deepEqual(JSON.parse(turnRequest.body), {
                ...turnPayload({ turnId: 'turn-request-1' }),
            });
            assert.equal(harness.requests.some(request => request.url?.includes('attacker.invalid')), false);
            const acceptRequest = harness.requests.find(request => request.url === '/api/v1/turns/turn-fixed-target/accept');
            assert.deepEqual(JSON.parse(acceptRequest.body), {
                projectId: 'project-fixed-target',
                proposalId: 'proposal-writer',
                attemptId: 'attempt-writer',
                planId: 'plan-writer',
                referenceDigest: 'a'.repeat(64),
                idempotencyKey: 'approval-fixed-target',
            });
        } finally {
            await harness.shutdown();
        }
    });

    test('forwards only fixed release/session routes and exposes a player-safe same-origin share entry', async () => {
        const shareToken = 's'.repeat(43);
        const session = {
            schemaVersion: 1,
            sessionId: 'session-release-test',
            releaseId: 'release-fixed-target',
            projectId: 'project-fixed-target',
            branchId: 'branch-session-target',
            headCommitId: 'commit-fixed-target',
            lastEventId: 'event-fixed-target',
            revision: 1,
            status: 'active',
            audience: 'player',
            povEntityId: 'entity-pov-fixed-target',
            activeTurnId: null,
            lastTurnId: null,
            turnStage: 'idle',
            renderCursor: { lastEventId: null, lastSeq: -1 },
            stageSnapshot: { turnId: null, stage: 'idle', lastRender: null },
            createdAt: '2026-07-18T00:00:00.000Z',
            updatedAt: '2026-07-18T00:00:00.000Z',
        };
        const runtimeHandler = (request, response, body) => {
            if (request.method === 'GET' && request.url === '/api/v1/releases/release-fixed-target') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: {
                        schemaVersion: 1,
                        releaseId: 'release-fixed-target',
                        projectId: 'project-fixed-target',
                        branchId: 'branch-release-target',
                        headCommitId: 'commit-fixed-target',
                        contentHash: 'a'.repeat(64),
                        manifestHash: 'b'.repeat(64),
                        status: 'published',
                        manifest: { schemaVersion: 1, title: 'Archive', blocks: [], components: [] },
                    },
                });
            }
            if (request.method === 'POST' && request.url === '/api/v1/releases/release-fixed-target/sessions') {
                return json(response, 201, { schemaVersion: 1, ok: true, data: { ...session, received: JSON.parse(body) } });
            }
            if (request.method === 'POST' && request.url === '/api/v1/sessions/session-release-test/share') {
                return json(response, 201, {
                    schemaVersion: 1,
                    ok: true,
                    data: {
                        schemaVersion: 1,
                        sessionId: session.sessionId,
                        shareId: 'share-release-test',
                        sharePath: `/share/${shareToken}`,
                        visibility: 'link',
                    },
                });
            }
            if (request.method === 'GET' && request.url === '/api/v1/sessions/session-release-test') {
                return json(response, 200, { schemaVersion: 1, ok: true, data: session });
            }
            if (request.method === 'GET' && request.url === '/api/v1/sessions/session-release-test/reconnect?lastEventId=event-fixed-target') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { ...session, revision: 2 },
                });
            }
            if (request.method === 'GET' && request.url === '/api/v1/releases/release-fixed-target/export.html') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
                response.end('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"></head><body>Archive</body></html>');
                return;
            }
            if (request.method === 'GET' && request.url === `/api/v1/share/${shareToken}`) {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { ...session, authorTruth: 'must not cross the public bridge' },
                });
            }
            return runtimeFixture(request, response, body);
        };
        const harness = await createHarness(runtimeHandler);
        try {
            let response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/releases/release-fixed-target`);
            assert.equal(response.status, 200);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/releases/release-fixed-target/sessions`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    schemaVersion: 1,
                    audience: 'player',
                    povEntityId: 'entity-pov-fixed-target',
                    requestId: 'session-request-fixed-target',
                }),
            });
            assert.equal(response.status, 201);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/sessions/session-release-test/share`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ schemaVersion: 1, visibility: 'link' }),
            });
            assert.equal(response.status, 201);
            assert.equal((await response.json()).data.sharePath, `/?novel-share=${shareToken}`);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/sessions/session-release-test`);
            assert.equal(response.status, 200);
            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/sessions/session-release-test/reconnect?lastEventId=event-fixed-target`,
            );
            assert.equal((await response.json()).data.revision, 2);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/releases/release-fixed-target/export.html`);
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type'), /^text\/html/);
            assert.match(response.headers.get('content-disposition'), /attachment/);
            assert.match(response.headers.get('content-security-policy'), /script-src 'none'/);
            assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
            assert.match(await response.text(), /Archive/);

            const protectedRequest = harness.requests.find(request => request.url.endsWith('/sessions'));
            assert.equal(protectedRequest.headers.authorization, `Bearer ${TOKEN}`);
            assert.equal(protectedRequest.headers['x-novel-actor-id'], 'sillytavern:YWxpY2Ugd3JpdGVy');
            assert.equal(protectedRequest.headers['x-novel-actor-role'], 'author');

            const requestCount = harness.requests.length;
            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/sessions/session-release-test/reconnect?targetUrl=https://attacker.invalid`,
            );
            assert.equal(response.status, 400);
            assert.equal(harness.requests.length, requestCount);
        } finally {
            await harness.shutdown();
        }

        const publicHarness = await createHarness(runtimeHandler, { userHandle: null });
        try {
            const response = await fetch(`${publicHarness.bridgeBaseUrl}${BRIDGE_PREFIX}/share/${shareToken}`);
            assert.equal(response.status, 200);
            const data = (await response.json()).data;
            assert.equal(data.sessionId, session.sessionId);
            assert.equal('authorTruth' in data, false);
            const upstream = publicHarness.requests.find(request => request.url === `/api/v1/share/${shareToken}`);
            assert.equal(upstream.headers.authorization, `Bearer ${TOKEN}`);
            assert.equal(upstream.headers['x-novel-actor-id'], undefined);
            assert.equal(upstream.headers['x-novel-actor-role'], undefined);
        } finally {
            await publicHarness.shutdown();
        }
    });

    test('rejects release exports with the wrong type, missing CSP, or oversized bytes', async () => {
        const harness = await createHarness((request, response) => {
            if (request.url === '/api/v1/releases/release-bad-type/export.html') {
                response.writeHead(200, { 'content-type': 'text/plain' });
                response.end('not html');
                return;
            }
            if (request.url === '/api/v1/releases/release-bad-csp/export.html') {
                response.writeHead(200, { 'content-type': 'text/html' });
                response.end('<!doctype html><html><body>Missing policy</body></html>');
                return;
            }
            if (request.url === '/api/v1/releases/release-oversized/export.html') {
                response.writeHead(200, { 'content-type': 'text/html', 'content-length': '2048' });
                response.end('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">');
                return;
            }
            return runtimeFixture(request, response, '');
        }, { environment: { NOVEL_RUNTIME_MAX_RESPONSE_BYTES: '1024' } });
        try {
            let response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/releases/release-bad-type/export.html`);
            assert.equal(response.status, 502);
            assert.equal((await response.json()).error.code, 'RUNTIME_DOCUMENT_INVALID');

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/releases/release-bad-csp/export.html`);
            assert.equal(response.status, 502);
            assert.equal((await response.json()).error.code, 'BRIDGE_RELEASE_EXPORT_INVALID');

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/releases/release-oversized/export.html`);
            assert.equal(response.status, 502);
            assert.equal((await response.json()).error.code, 'RUNTIME_RESPONSE_TOO_LARGE');
        } finally {
            await harness.shutdown();
        }
    });

    test('workspace surface forwards only versioned allowlisted routes', async () => {
        const sourceDigest = 'd'.repeat(64);
        const harness = await createHarness((request, response, body) => {
            if (request.url === '/api/v1/projects') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: [{ id: 'project-1', title: 'Archive' }],
                });
            }
            if (request.url === '/api/v1/projects/project-1/world-snapshot?branchId=branch-1') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { snapshotHash: 'a'.repeat(64), fragments: [] },
                });
            }
            if (request.url === '/api/v1/projects/project-1/world-bible/commands') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { received: JSON.parse(body) },
                });
            }
            if (request.url === '/api/v1/projects/project-1/imports/character-card/preview') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { importId: 'import-1', received: JSON.parse(body) },
                });
            }
            if (request.url === '/api/v1/projects/project-1/imports/world-info/preview') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { importId: 'world-import-1', received: JSON.parse(body) },
                });
            }
            if (request.url === '/api/v1/projects/project-1/imports/chat/preview') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { importId: 'chat-import-1', received: JSON.parse(body) },
                });
            }
            if (request.url === '/api/v1/projects/project-1/imports/swipe/confirm') {
                return json(response, 201, {
                    schemaVersion: 1,
                    ok: true,
                    data: { importId: 'swipe-import-1', received: JSON.parse(body) },
                });
            }
            if (request.url === `/api/v1/projects/project-1/imports/swipe/${sourceDigest}`) {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { importId: 'swipe-import-1', sourceDigest },
                });
            }
            return runtimeFixture(request, response, body);
        });
        try {
            let response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects`);
            assert.equal(response.status, 200);
            assert.equal((await response.json()).data[0].id, 'project-1');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/world-snapshot?branchId=branch-1`,
            );
            assert.equal(response.status, 200);

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/world-bible/commands`,
                {
                    method: 'POST',
                    headers: {
                        authorization: 'Bearer browser-token',
                        'content-type': 'application/json',
                        'idempotency-key': 'command-1',
                    },
                    body: JSON.stringify({ schemaVersion: 1, commandId: 'command-1', type: 'LockWorldBible' }),
                },
            );
            assert.equal(response.status, 200);
            const commandRequest = harness.requests.find(request => request.url.endsWith('/world-bible/commands'));
            assert.equal(commandRequest.headers.authorization, `Bearer ${TOKEN}`);
            assert.equal(commandRequest.headers['idempotency-key'], 'command-1');
            assert.equal(commandRequest.headers['x-novel-actor-id'], 'sillytavern:YWxpY2Ugd3JpdGVy');
            assert.equal(commandRequest.headers['x-novel-actor-role'], 'author');
            assert.equal(JSON.parse(commandRequest.body).actorId, 'sillytavern:YWxpY2Ugd3JpdGVy');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/imports/character-card/preview`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        schemaVersion: 1,
                        actorId: 'browser:attacker',
                        sourceDocument: { data: { name: 'Ada' } },
                    }),
                },
            );
            assert.equal(response.status, 200);
            const importRequest = harness.requests.find(request => request.url.endsWith('/imports/character-card/preview'));
            assert.equal(JSON.parse(importRequest.body).actorId, 'sillytavern:YWxpY2Ugd3JpdGVy');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/imports/world-info/preview`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ actorId: 'browser:attacker', sourceDocument: { entries: [] } }),
                },
            );
            assert.equal(response.status, 200);
            const worldImportRequest = harness.requests.find(request => request.url.endsWith('/imports/world-info/preview'));
            assert.equal(JSON.parse(worldImportRequest.body).actorId, 'sillytavern:YWxpY2Ugd3JpdGVy');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/imports/chat/preview`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ actorId: 'browser:attacker', sourceDocument: { messages: [] } }),
                },
            );
            assert.equal(response.status, 200);
            const chatImportRequest = harness.requests.find(request => request.url.endsWith('/imports/chat/preview'));
            assert.equal(JSON.parse(chatImportRequest.body).actorId, 'sillytavern:YWxpY2Ugd3JpdGVy');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/imports/swipe/confirm`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'idempotency-key': 'swipe-import-1',
                    },
                    body: JSON.stringify({
                        actorId: 'browser:attacker',
                        importId: 'swipe-import-1',
                        sourceDigest,
                        sourceDocument: { messages: [] },
                    }),
                },
            );
            assert.equal(response.status, 201);
            const swipeImportRequest = harness.requests.find(request => request.url.endsWith('/imports/swipe/confirm'));
            assert.equal(JSON.parse(swipeImportRequest.body).actorId, 'sillytavern:YWxpY2Ugd3JpdGVy');
            assert.equal(swipeImportRequest.headers['idempotency-key'], 'swipe-import-1');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/imports/swipe/${sourceDigest}`,
            );
            assert.equal(response.status, 200);
            assert.equal((await response.json()).data.sourceDigest, sourceDigest);

            const requestCount = harness.requests.length;
            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/world-snapshot?targetUrl=https://attacker.invalid`,
            );
            assert.equal(response.status, 400);
            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/runtime-surfaces/secrets`,
            );
            assert.equal(response.status, 404);
            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-1/imports/world-info/activate`,
                { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
            );
            assert.equal(response.status, 404);
            assert.equal(harness.requests.length, requestCount);
        } finally {
            await harness.shutdown();
        }
    });

    test('server role prevents players from reading director data or issuing author commands', async () => {
        const playerEvents = 'id: event-player\nevent: prose.delta\ndata: {"seq":1}\n\n';
        const harness = await createHarness((request, response) => {
            if (request.url === '/api/v1/projects') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: [{
                        schemaVersion: 1,
                        id: 'project-player',
                        slug: 'player-project',
                        title: 'Player project',
                        status: 'active',
                        metadata: { authorNote: 'Hidden project note' },
                    }],
                });
            }
            if (request.url === '/api/v1/projects/project-player/workspace/view?audience=player') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { access: { role: 'player', audience: 'player' }, director: null },
                });
            }
            if (request.url === '/api/v1/turns/turn-player/events?audience=player') {
                response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
                response.end(playerEvents);
                return;
            }
            return runtimeFixture(request, response, '');
        }, { userHandle: 'reader', userAdmin: false });
        try {
            let response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects`);
            assert.equal(response.status, 200);
            assert.deepEqual((await response.json()).data, [{
                schemaVersion: 1,
                id: 'project-player',
                slug: 'player-project',
                title: 'Player project',
                status: 'active',
            }]);

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-player/chapters`,
            );
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_AUTHOR_REQUIRED');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-player/imports/chat/preview`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ sourceDocument: { messages: [] } }),
                },
            );
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_AUTHOR_REQUIRED');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-player/workspace/view?audience=player`,
            );
            assert.equal(response.status, 200);
            assert.equal((await response.json()).data.director, null);

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-player/workspace/view?audience=author`,
            );
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_AUDIENCE_FORBIDDEN');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-player/world-bible`,
            );
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_AUTHOR_REQUIRED');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-player/workspace/recall?audience=player`,
            );
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_AUTHOR_REQUIRED');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/workspace/projects/project-player/world-bible/commands`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ schemaVersion: 1, type: 'LockWorldBible' }),
                },
            );
            assert.equal(response.status, 403);

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/releases/release-player/export.html`,
            );
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_AUTHOR_REQUIRED');

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'idempotency-key': 'turn-player-direct',
                },
                body: JSON.stringify({ inputMode: 'direct', inputText: 'Reveal the hidden truth.' }),
            });
            assert.equal(response.status, 400);
            assert.equal((await response.json()).error.code, 'BRIDGE_TURN_PAYLOAD_FORBIDDEN');

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'idempotency-key': 'turn-player-nested-direct',
                },
                body: JSON.stringify(turnPayload({
                    turnId: 'turn-player-nested-direct',
                    inputMode: 'direct',
                })),
            });
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_DIRECTOR_COMMAND_FORBIDDEN');

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'idempotency-key': 'turn-player-act',
                },
                body: JSON.stringify(turnPayload({ turnId: 'turn-player-act' })),
            });
            assert.equal(response.status, 201);
            const playerTurnRequest = harness.requests.find(request => request.headers['idempotency-key'] === 'turn-player-act');
            const playerTurnBody = JSON.parse(playerTurnRequest.body);
            assert.equal(playerTurnBody.mode, 'play');
            assert.equal(playerTurnBody.modelProfileId, 'model-profile-fixed-target');
            assert.equal('povEntityId' in playerTurnBody, false);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/accept`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ proposal: 'forbidden' }),
            });
            assert.equal(response.status, 403);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-player/events`);
            assert.equal(response.status, 200);
            assert.equal(await response.text(), playerEvents);

            const viewRequest = harness.requests.find(request => request.url.includes('/workspace/view'));
            assert.equal(viewRequest.headers['x-novel-actor-role'], 'player');
            const streamRequest = harness.requests.find(request => request.url.includes('/turn-player/events'));
            assert.equal(streamRequest.url, '/api/v1/turns/turn-player/events?audience=player');
            assert.equal(streamRequest.headers['x-novel-actor-role'], 'player');
            assert.equal(harness.requests.some(request => request.url.includes('world-bible')), false);
            assert.equal(harness.requests.some(request => request.url.includes('/imports/chat/')), false);
            assert.equal(harness.requests.some(request => request.url.endsWith('/accept')), false);
        } finally {
            await harness.shutdown();
        }
    });

    test('forwards SSE bytes in order and resumes with a validated Last-Event-ID', async () => {
        const first = 'id: event-3\nevent: prose.delta\ndata: {"seq":3}\n\n';
        const second = 'id: event-4\nevent: turn.committed\ndata: {"seq":4}\n\n';
        const harness = await createHarness((request, response) => {
            if (request.url === '/api/v1/turns/turn-stream/events') {
                response.writeHead(200, {
                    'content-type': 'text/event-stream; charset=utf-8',
                    'cache-control': 'no-cache',
                });
                response.write(first);
                setTimeout(() => response.end(second), 5);
                return;
            }
            runtimeFixture(request, response, '');
        });
        try {
            const response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-stream/events`,
                { headers: { 'last-event-id': 'event-2' } },
            );
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type'), /^text\/event-stream/);
            assert.equal(response.headers.get('x-accel-buffering'), 'no');
            assert.equal(await response.text(), first + second);

            const upstream = harness.requests.find(request => request.url === '/api/v1/turns/turn-stream/events');
            assert.equal(upstream.headers['last-event-id'], 'event-2');
            assert.equal(upstream.headers.authorization, `Bearer ${TOKEN}`);
            assert.equal(upstream.headers['x-novel-actor-id'], 'sillytavern:YWxpY2Ugd3JpdGVy');
            assert.equal(upstream.headers['x-novel-actor-role'], 'author');
        } finally {
            await harness.shutdown();
        }
    });

    test('aborts the upstream stream after browser disconnect and allows snapshot recovery', async () => {
        let notifyUpstreamClosed;
        const upstreamClosed = new Promise(resolve => {
            notifyUpstreamClosed = resolve;
        });
        const harness = await createHarness((request, response) => {
            if (request.url === '/api/v1/turns/turn-disconnect/events') {
                response.writeHead(200, { 'content-type': 'text/event-stream' });
                response.write('id: event-1\ndata: {"seq":1}\n\n');
                response.on('close', notifyUpstreamClosed);
                return;
            }
            if (request.url === '/api/v1/turns/turn-disconnect/snapshot') {
                return json(response, 200, {
                    schemaVersion: 1,
                    ok: true,
                    data: { turnId: 'turn-disconnect', lastEventId: 'event-1', seq: 1 },
                });
            }
            runtimeFixture(request, response, '');
        });
        try {
            const controller = new AbortController();
            const response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-disconnect/events`,
                { signal: controller.signal },
            );
            const reader = response.body.getReader();
            const first = await reader.read();
            assert.equal(first.done, false);
            controller.abort();
            await Promise.race([
                upstreamClosed,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Upstream stream stayed open.')), 250)),
            ]);

            const snapshot = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-disconnect/snapshot`,
            );
            assert.equal(snapshot.status, 200);
            assert.equal((await snapshot.json()).data.lastEventId, 'event-1');
        } finally {
            await harness.shutdown();
        }
    });

    test('normalizes timeout, invalid upstream data, authentication, and Runtime errors', async () => {
        const harness = await createHarness((request, response) => {
            if (request.url === '/api/v1/turns/turn-timeout/snapshot') {
                return;
            }
            if (request.url === '/api/v1/turns/turn-invalid/snapshot') {
                response.writeHead(200, { 'content-type': 'text/plain' });
                response.end('not-json');
                return;
            }
            if (request.url === '/api/v1/turns/turn-conflict/snapshot') {
                return json(response, 409, {
                    schemaVersion: 1,
                    ok: false,
                    error: {
                        code: 'TURN_STALE',
                        message: 'The branch head changed.',
                        retryable: false,
                        correlationId: 'runtime-correlation',
                        details: { internal: 'must-not-cross-bridge' },
                    },
                });
            }
            runtimeFixture(request, response, '');
        }, { environment: { NOVEL_RUNTIME_REQUEST_TIMEOUT_MS: '50' } });
        try {
            let response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-timeout/snapshot`,
            );
            assert.equal(response.status, 504);
            let body = await response.json();
            assert.equal(body.error.code, 'RUNTIME_TIMEOUT');
            assert.equal(body.error.retryable, true);
            assert.equal(body.error.correlationId, 'correlation-bridge-test');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-invalid/snapshot`,
            );
            assert.equal(response.status, 502);
            body = await response.json();
            assert.equal(body.error.code, 'RUNTIME_RESPONSE_INVALID');

            response = await fetch(
                `${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-conflict/snapshot`,
            );
            assert.equal(response.status, 409);
            body = await response.json();
            assert.deepEqual(body, {
                schemaVersion: 1,
                ok: false,
                error: {
                    code: 'TURN_STALE',
                    message: 'The branch head changed.',
                    retryable: false,
                    correlationId: 'runtime-correlation',
                },
            });
        } finally {
            await harness.shutdown();
        }

        const unauthenticated = await createHarness(runtimeFixture, { userHandle: null });
        try {
            const response = await fetch(
                `${unauthenticated.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/snapshot`,
            );
            assert.equal(response.status, 403);
            assert.equal((await response.json()).error.code, 'BRIDGE_IDENTITY_REQUIRED');
            assert.equal(unauthenticated.requests.length, 0);
        } finally {
            await unauthenticated.shutdown();
        }
    });
});
