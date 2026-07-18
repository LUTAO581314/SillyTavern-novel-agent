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
    name: 'Novel Runtime Bridge',
    description: 'Server-owned bridge boundary for SillyTavern Novel Mode.',
});

let runtimeConfig = readRuntimeConfig({});
let runtimeClient = createRuntimeClient(runtimeConfig);
let randomUUID = createRandomUUID;

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

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

    router.post('/v1/turns', route(async (request, response, context) => {
        const result = await runtimeClient.requestJson({
            path: '/api/v1/turns',
            method: 'POST',
            actorId: context.actorId,
            body: readObjectBody(request),
            idempotencyKey: readHeader(request, 'Idempotency-Key', { required: true }),
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.get('/v1/turns/:turnId/events', route(async (request, response, context) => {
        const turnId = requireOpaqueId(request.params.turnId, 'Turn ID');
        const stream = await runtimeClient.openEventStream({
            path: `/api/v1/turns/${encodeURIComponent(turnId)}/events`,
            actorId: context.actorId,
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
            body,
            correlationId: context.correlationId,
            signal: context.signal,
        });
        sendJsonResult(response, result);
    }));

    router.post('/v1/turns/:turnId/accept', route(async (request, response, context) => {
        const turnId = requireOpaqueId(request.params.turnId, 'Turn ID');
        const body = readObjectBody(request);
        const result = await runtimeClient.requestJson({
            path: `/api/v1/turns/${encodeURIComponent(turnId)}/accept`,
            method: 'POST',
            actorId: context.actorId,
            body,
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
