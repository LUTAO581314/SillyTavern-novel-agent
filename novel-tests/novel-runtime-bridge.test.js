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
            'POST /v1/turns',
            'GET /v1/turns/:turnId/events',
            'POST /v1/turns/:turnId/cancel',
            'GET /v1/turns/:turnId/snapshot',
        ]);

        let body;
        const response = {
            status() { return this; },
            json(value) { body = value; return this; },
        };
        await router.routes.get('GET /health')({}, response);
        assert.deepEqual(body, createPublicHealthPayload({ configured: false }));
        assert.equal(body.canonicalWrite, false);
        assert.deepEqual(NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE.capabilities, [
            'health',
            'turn.create',
            'turn.events',
            'turn.cancel',
            'turn.snapshot',
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
