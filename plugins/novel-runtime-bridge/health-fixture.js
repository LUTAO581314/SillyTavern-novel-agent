export const NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE = Object.freeze({
    schemaVersion: 1,
    service: 'novel-runtime-bridge',
    status: 'shell',
    capabilities: Object.freeze(['health']),
    canonicalWrite: false,
});

export function createPublicHealthPayload(runtimeConfig) {
    return {
        ...NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE,
        runtimeConfigured: Boolean(runtimeConfig?.configured),
    };
}
