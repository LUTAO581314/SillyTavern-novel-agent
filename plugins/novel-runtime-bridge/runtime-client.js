import { once } from 'node:events';

const API_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

export class RuntimeBridgeError extends Error {
    constructor(code, message, status, retryable = false, publicBody = null) {
        super(message);
        this.name = 'RuntimeBridgeError';
        this.code = code;
        this.status = status;
        this.retryable = retryable;
        this.publicBody = publicBody;
    }
}

function buildUrl(config, path) {
    if (!config.configured) {
        throw new RuntimeBridgeError(
            'RUNTIME_NOT_CONFIGURED',
            'Novel Runtime is not configured.',
            503,
            false,
        );
    }
    if (typeof path !== 'string' || !path.startsWith('/api/')) {
        throw new TypeError('Runtime bridge paths must be fixed API paths.');
    }
    return `${config.baseUrl}${path}`;
}

function createHeaders(config, {
    accept = 'application/json',
    actorId = null,
    actorRole = null,
    correlationId,
    idempotencyKey = null,
    lastEventId = null,
    withBody = false,
}) {
    const headers = new Headers({
        accept,
        'x-correlation-id': correlationId,
        'x-novel-client': 'sillytavern',
    });
    if (config.authorization) {
        headers.set('authorization', config.authorization);
    }
    if (actorId) {
        headers.set('x-novel-actor-id', actorId);
    }
    if (actorRole) {
        headers.set('x-novel-actor-role', actorRole);
    }
    if (idempotencyKey) {
        headers.set('idempotency-key', idempotencyKey);
    }
    if (lastEventId) {
        headers.set('last-event-id', lastEventId);
    }
    if (withBody) {
        headers.set('content-type', 'application/json');
    }
    return headers;
}

function createAbortScope(timeoutMs, externalSignal) {
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort(externalSignal.reason);
    if (externalSignal) {
        if (externalSignal.aborted) {
            onExternalAbort();
        } else {
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
    }
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('Runtime request timed out.'));
    }, timeoutMs);
    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        clearTimer: () => clearTimeout(timer),
        cleanup: () => {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', onExternalAbort);
        },
    };
}

async function readLimitedBody(response, maximumBytes) {
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maximumBytes) {
        throw new RuntimeBridgeError(
            'RUNTIME_RESPONSE_TOO_LARGE',
            'Novel Runtime returned an oversized response.',
            502,
            false,
        );
    }
    if (!response.body) {
        return '';
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            total += value.byteLength;
            if (total > maximumBytes) {
                await reader.cancel('Runtime response exceeded bridge limit.');
                throw new RuntimeBridgeError(
                    'RUNTIME_RESPONSE_TOO_LARGE',
                    'Novel Runtime returned an oversized response.',
                    502,
                    false,
                );
            }
            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        throw new RuntimeBridgeError(
            'RUNTIME_RESPONSE_INVALID',
            'Novel Runtime returned an invalid JSON response.',
            502,
            false,
        );
    }
}

function sanitizeApiError(value, fallbackCorrelationId) {
    const error = value?.error;
    if (
        value?.schemaVersion !== 1 || value?.ok !== false ||
        !error || typeof error !== 'object' ||
        typeof error.code !== 'string' || !API_ERROR_CODE.test(error.code) ||
        typeof error.message !== 'string' || !error.message || error.message.length > 2_000 ||
        typeof error.retryable !== 'boolean'
    ) {
        return null;
    }
    const correlationId = typeof error.correlationId === 'string' && error.correlationId.length <= 128
        ? error.correlationId
        : fallbackCorrelationId;
    return {
        schemaVersion: 1,
        ok: false,
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            correlationId,
        },
    };
}

function normalizeFailure(error, scope) {
    if (error instanceof RuntimeBridgeError) {
        return error;
    }
    if (scope.timedOut()) {
        return new RuntimeBridgeError(
            'RUNTIME_TIMEOUT',
            'Novel Runtime did not respond before the bridge timeout.',
            504,
            true,
        );
    }
    if (scope.signal.aborted) {
        return new RuntimeBridgeError(
            'BRIDGE_REQUEST_CANCELLED',
            'The bridge request was cancelled.',
            499,
            false,
        );
    }
    return new RuntimeBridgeError(
        'RUNTIME_UNAVAILABLE',
        'Novel Runtime is unavailable.',
        502,
        true,
    );
}

export function createErrorEnvelope(error, correlationId) {
    if (error instanceof RuntimeBridgeError && error.publicBody) {
        return error.publicBody;
    }
    const normalized = error instanceof RuntimeBridgeError
        ? error
        : new RuntimeBridgeError('BRIDGE_INTERNAL_ERROR', 'Runtime bridge request failed.', 500, false);
    return {
        schemaVersion: 1,
        ok: false,
        error: {
            code: normalized.code,
            message: normalized.message,
            retryable: normalized.retryable,
            correlationId,
        },
    };
}

export function createRuntimeClient(config, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new TypeError('Runtime bridge requires a Fetch implementation.');
    }

    async function requestJson({
        path,
        method = 'GET',
        actorId = null,
        actorRole = null,
        body,
        idempotencyKey = null,
        correlationId,
        signal,
    }) {
        const scope = createAbortScope(config.requestTimeoutMs, signal);
        try {
            const withBody = body !== undefined;
            const response = await fetchImpl(buildUrl(config, path), {
                method,
                headers: createHeaders(config, {
                    actorId,
                    actorRole,
                    correlationId,
                    idempotencyKey,
                    withBody,
                }),
                body: withBody ? JSON.stringify(body) : undefined,
                redirect: 'error',
                signal: scope.signal,
            });
            const text = await readLimitedBody(response, config.maximumResponseBytes);
            if (response.status === 204 && !text) {
                return { status: response.status, body: null };
            }
            const parsed = parseJson(text);
            if (!response.ok) {
                const publicBody = sanitizeApiError(parsed, correlationId);
                if (!publicBody) {
                    throw new RuntimeBridgeError(
                        'RUNTIME_REQUEST_FAILED',
                        'Novel Runtime rejected the request.',
                        502,
                        response.status >= 500,
                    );
                }
                return { status: response.status, body: publicBody };
            }
            return { status: response.status, body: parsed };
        } catch (error) {
            throw normalizeFailure(error, scope);
        } finally {
            scope.cleanup();
        }
    }

    async function requestHtml({
        path,
        actorId = null,
        actorRole = null,
        correlationId,
        signal,
    }) {
        const scope = createAbortScope(config.requestTimeoutMs, signal);
        try {
            const response = await fetchImpl(buildUrl(config, path), {
                method: 'GET',
                headers: createHeaders(config, {
                    accept: 'text/html',
                    actorId,
                    actorRole,
                    correlationId,
                }),
                redirect: 'error',
                signal: scope.signal,
            });
            const text = await readLimitedBody(response, config.maximumResponseBytes);
            if (!response.ok) {
                let publicBody = null;
                try {
                    publicBody = sanitizeApiError(JSON.parse(text), correlationId);
                } catch {
                    // Non-JSON upstream failures are deliberately replaced.
                }
                if (publicBody) return { status: response.status, body: publicBody, contentType: 'application/json' };
                throw new RuntimeBridgeError(
                    'RUNTIME_REQUEST_FAILED',
                    'Novel Runtime rejected the document request.',
                    502,
                    response.status >= 500,
                );
            }
            const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
            if (!contentType.startsWith('text/html')) {
                throw new RuntimeBridgeError(
                    'RUNTIME_DOCUMENT_INVALID',
                    'Novel Runtime returned a non-HTML release document.',
                    502,
                    false,
                );
            }
            return { status: response.status, body: text, contentType };
        } catch (error) {
            throw normalizeFailure(error, scope);
        } finally {
            scope.cleanup();
        }
    }

    async function openEventStream({
        path,
        actorId,
        actorRole = null,
        correlationId,
        lastEventId = null,
        signal,
    }) {
        const scope = createAbortScope(config.requestTimeoutMs, signal);
        try {
            const response = await fetchImpl(buildUrl(config, path), {
                method: 'GET',
                headers: createHeaders(config, {
                    accept: 'text/event-stream',
                    actorId,
                    actorRole,
                    correlationId,
                    lastEventId,
                }),
                redirect: 'error',
                signal: scope.signal,
            });
            if (!response.ok) {
                const text = await readLimitedBody(response, config.maximumResponseBytes);
                const parsed = parseJson(text);
                const publicBody = sanitizeApiError(parsed, correlationId);
                throw new RuntimeBridgeError(
                    publicBody?.error.code ?? 'RUNTIME_REQUEST_FAILED',
                    publicBody?.error.message ?? 'Novel Runtime rejected the event stream.',
                    publicBody ? response.status : 502,
                    publicBody?.error.retryable ?? response.status >= 500,
                    publicBody,
                );
            }
            if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
                throw new RuntimeBridgeError(
                    'RUNTIME_RESPONSE_INVALID',
                    'Novel Runtime returned a non-SSE event stream.',
                    502,
                    false,
                );
            }
            if (!response.body) {
                throw new RuntimeBridgeError(
                    'RUNTIME_RESPONSE_INVALID',
                    'Novel Runtime returned an empty event stream.',
                    502,
                    false,
                );
            }
            scope.clearTimer();
            return {
                body: response.body,
                cleanup: scope.cleanup,
            };
        } catch (error) {
            scope.cleanup();
            throw normalizeFailure(error, scope);
        }
    }

    return Object.freeze({ requestJson, requestHtml, openEventStream });
}

export async function pipeEventStream(stream, response) {
    const reader = stream.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (!response.write(Buffer.from(value))) {
                await once(response, 'drain');
            }
        }
    } finally {
        reader.releaseLock();
    }
}
