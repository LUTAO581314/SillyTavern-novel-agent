export const NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE = Object.freeze({
    schemaVersion: 1,
    service: 'novel-runtime-bridge',
    status: 'ready',
    capabilities: Object.freeze([
        'health',
        'turn.create',
        'turn.events',
        'turn.cancel',
        'turn.accept',
        'turn.snapshot',
    ]),
    canonicalWrite: false,
});

export function createPublicHealthPayload(runtimeConfig, runtime = {}) {
    return {
        ...NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE,
        runtimeConfigured: Boolean(runtimeConfig?.configured),
        runtimeReachable: Boolean(runtime.reachable),
        runtimeService: typeof runtime.service === 'string' ? runtime.service : null,
    };
}
