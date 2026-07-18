function normalizeBaseUrl(value) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error('NOVEL_RUNTIME_BASE_URL must be an absolute URL.');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('NOVEL_RUNTIME_BASE_URL must use HTTP or HTTPS.');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error('NOVEL_RUNTIME_BASE_URL cannot contain credentials, query data, or fragments.');
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
}

function readInteger(environment, name, fallback, minimum, maximum) {
    const value = environment[name];
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
    }
    return parsed;
}

export function readRuntimeConfig(environment = process.env) {
    const rawBaseUrl = typeof environment.NOVEL_RUNTIME_BASE_URL === 'string'
        ? environment.NOVEL_RUNTIME_BASE_URL.trim()
        : '';
    const token = typeof environment.NOVEL_RUNTIME_TOKEN === 'string'
        ? environment.NOVEL_RUNTIME_TOKEN
        : '';
    const requestTimeoutMs = readInteger(
        environment,
        'NOVEL_RUNTIME_REQUEST_TIMEOUT_MS',
        15_000,
        25,
        120_000,
    );
    const maximumResponseBytes = readInteger(
        environment,
        'NOVEL_RUNTIME_MAX_RESPONSE_BYTES',
        2 * 1024 * 1024,
        1024,
        16 * 1024 * 1024,
    );

    if (!rawBaseUrl) {
        if (token) {
            throw new Error('NOVEL_RUNTIME_TOKEN requires NOVEL_RUNTIME_BASE_URL.');
        }
        return Object.freeze({
            configured: false,
            baseUrl: null,
            authorization: null,
            configurationIssue: 'runtime_base_url_required',
            requestTimeoutMs,
            maximumResponseBytes,
        });
    }
    if (/[\u0000-\u001F\u007F]/.test(token)) {
        throw new Error('NOVEL_RUNTIME_TOKEN contains invalid control characters.');
    }
    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    if (!token) {
        return Object.freeze({
            configured: false,
            baseUrl: null,
            authorization: null,
            configurationIssue: 'runtime_token_required',
            requestTimeoutMs,
            maximumResponseBytes,
        });
    }

    return Object.freeze({
        configured: true,
        baseUrl,
        authorization: `Bearer ${token}`,
        configurationIssue: null,
        requestTimeoutMs,
        maximumResponseBytes,
    });
}
