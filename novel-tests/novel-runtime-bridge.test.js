import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
    createPublicHealthPayload,
    NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE,
} from '../plugins/novel-runtime-bridge/health-fixture.js';
import { readRuntimeConfig } from '../plugins/novel-runtime-bridge/config.js';
import { exit, info, init } from '../plugins/novel-runtime-bridge/index.js';

function createRouterFixture() {
    const routes = new Map();
    return {
        routes,
        get(path, handler) {
            routes.set(`GET ${path}`, handler);
        },
        post(path, handler) {
            routes.set(`POST ${path}`, handler);
        },
    };
}

describe('novel-runtime-bridge shell', () => {
    test('loads only fixed transport routes and unloads without canonical routes', async () => {
        const router = createRouterFixture();
        await init(router, { environment: {} });

        assert.equal(info.id, 'novel-runtime-bridge');
        assert.deepEqual([...router.routes.keys()], [
            'GET /health',
            'GET /v1/workspace/*',
            'POST /v1/workspace/*',
            'GET /v1/releases/:releaseId',
            'GET /v1/releases/:releaseId/export.html',
            'POST /v1/releases/:releaseId/sessions',
            'POST /v1/sessions/:sessionId/share',
            'GET /v1/sessions/:sessionId',
            'GET /v1/sessions/:sessionId/reconnect',
            'GET /share/:shareToken',
            'POST /v1/turns',
            'GET /v1/turns/:turnId/events',
            'POST /v1/turns/:turnId/cancel',
            'POST /v1/turns/:turnId/accept',
            'GET /v1/turns/:turnId/approval',
            'GET /v1/turns/:turnId/snapshot',
        ]);

        let body;
        const response = {
            status() { return this; },
            json(value) { body = value; return this; },
        };
        await router.routes.get('GET /health')({}, response);
        assert.deepEqual(body, createPublicHealthPayload({
            configured: false,
            configurationIssue: 'runtime_base_url_required',
        }));
        assert.equal(body.canonicalWrite, false);
        assert.deepEqual(NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE.capabilities, [
            'health',
            'turn.create',
            'turn.events',
            'turn.cancel',
            'turn.accept',
            'turn.approval',
            'turn.snapshot',
            'release.open',
            'session.open',
            'session.share',
            'session.snapshot',
            'session.reconnect',
            'workspace.read',
            'workspace.command',
            'workspace.bootstrap',
            'workspace.audience',
            'workspace.recall',
            'import.character.preview',
            'import.character.confirm',
            'import.world-info.preview',
            'import.world-info.confirm',
            'import.world-info.review',
            'import.chat.preview',
            'import.chat.confirm',
            'import.swipe.preview',
            'import.swipe.confirm',
        ]);

        await exit();
    });

    test('keeps the Runtime target and credentials in server configuration', () => {
        const secret = 'server-only-secret-value';
        const config = readRuntimeConfig({
            NOVEL_RUNTIME_BASE_URL: 'http://127.0.0.1:8787/',
            NOVEL_RUNTIME_TOKEN: secret,
        });
        assert.equal(config.baseUrl, 'http://127.0.0.1:8787');
        assert.equal(config.authorization, `Bearer ${secret}`);

        const publicPayload = createPublicHealthPayload(config);
        assert.equal(publicPayload.runtimeConfigured, true);
        assert.doesNotMatch(JSON.stringify(publicPayload), /127\.0\.0\.1|server-only-secret-value/);

        const missingToken = readRuntimeConfig({
            NOVEL_RUNTIME_BASE_URL: 'http://127.0.0.1:8787/',
        });
        assert.equal(missingToken.configured, false);
        assert.equal(missingToken.configurationIssue, 'runtime_token_required');
        assert.equal(missingToken.authorization, null);
        assert.equal(createPublicHealthPayload(missingToken).runtimeConfigured, false);
    });

    test('rejects unsafe or client-shaped Runtime targets without echoing secrets', () => {
        const secret = 'do-not-echo-this';
        for (const value of [
            'ftp://runtime.example',
            'https://user:pass@runtime.example',
            'https://runtime.example?token=browser',
            'https://runtime.example/#fragment',
        ]) {
            assert.throws(
                () => readRuntimeConfig({
                    NOVEL_RUNTIME_BASE_URL: value,
                    NOVEL_RUNTIME_TOKEN: secret,
                }),
                (error) => !String(error).includes(secret),
            );
        }
    });
});
