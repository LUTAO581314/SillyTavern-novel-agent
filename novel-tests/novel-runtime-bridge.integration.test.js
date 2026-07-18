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
            request.user = { profile: { handle: userHandle } };
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
        return json(response, 202, {
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
                body: JSON.stringify({ mode: 'act', targetUrl: 'https://attacker.invalid/' }),
            });
            assert.equal(response.status, 202);
            assert.equal((await response.json()).data.turnId, 'turn-fixed-target');

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/cancel`, {
                method: 'POST',
            });
            assert.equal(response.status, 202);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/accept`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ proposal: 'writer-draft' }),
            });
            assert.equal(response.status, 202);

            response = await fetch(`${harness.bridgeBaseUrl}${BRIDGE_PREFIX}/v1/turns/turn-fixed-target/snapshot`);
            assert.equal(response.status, 200);
            assert.equal((await response.json()).data.lastEventId, 'event-4');

            const turnRequest = harness.requests.find(request => request.url === '/api/v1/turns');
            assert.equal(turnRequest.method, 'POST');
            assert.equal(turnRequest.headers.authorization, `Bearer ${TOKEN}`);
            assert.equal(turnRequest.headers['x-novel-actor-id'], 'sillytavern:YWxpY2Ugd3JpdGVy');
            assert.equal(turnRequest.headers['x-novel-client'], 'sillytavern');
            assert.equal(turnRequest.headers['idempotency-key'], 'turn-request-1');
            assert.equal(turnRequest.headers['x-correlation-id'], 'correlation-bridge-test');
            assert.deepEqual(JSON.parse(turnRequest.body), {
                mode: 'act',
                targetUrl: 'https://attacker.invalid/',
            });
            assert.equal(harness.requests.some(request => request.url?.includes('attacker.invalid')), false);
            const acceptRequest = harness.requests.find(request => request.url === '/api/v1/turns/turn-fixed-target/accept');
            assert.deepEqual(JSON.parse(acceptRequest.body), { proposal: 'writer-draft' });
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
