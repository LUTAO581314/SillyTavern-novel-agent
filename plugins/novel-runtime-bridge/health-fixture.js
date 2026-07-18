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
    ]),
    canonicalWrite: false,
});

export function createPublicHealthPayload(runtimeConfig, runtime = {}) {
    return {
        ...NOVEL_RUNTIME_BRIDGE_HEALTH_FIXTURE,
        runtimeConfigured: Boolean(runtimeConfig?.configured),
        runtimeConfigurationIssue: typeof runtimeConfig?.configurationIssue === 'string'
            ? runtimeConfig.configurationIssue
            : null,
        runtimeReachable: Boolean(runtime.reachable),
        runtimeService: typeof runtime.service === 'string' ? runtime.service : null,
    };
}
