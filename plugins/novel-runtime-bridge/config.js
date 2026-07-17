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

export function readRuntimeConfig(environment = process.env) {
    const rawBaseUrl = typeof environment.NOVEL_RUNTIME_BASE_URL === 'string'
        ? environment.NOVEL_RUNTIME_BASE_URL.trim()
        : '';
    const token = typeof environment.NOVEL_RUNTIME_TOKEN === 'string'
        ? environment.NOVEL_RUNTIME_TOKEN
        : '';

    if (!rawBaseUrl) {
        if (token) {
            throw new Error('NOVEL_RUNTIME_TOKEN requires NOVEL_RUNTIME_BASE_URL.');
        }
        return Object.freeze({
            configured: false,
            baseUrl: null,
            authorization: null,
        });
    }
    if (/[\u0000-\u001F\u007F]/.test(token)) {
        throw new Error('NOVEL_RUNTIME_TOKEN contains invalid control characters.');
    }

    return Object.freeze({
        configured: true,
        baseUrl: normalizeBaseUrl(rawBaseUrl),
        authorization: token ? `Bearer ${token}` : null,
    });
}
