import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    createInitialReleaseSessionState,
    createNovelReleaseSessionClient,
    readNovelShareToken,
    reduceReleaseSessionState,
    RELEASE_SESSION_HEALTH_CAPABILITIES,
    validateReleaseSessionHealth,
} from '../public/scripts/extensions/novel-mode/release-session-client.js';

const digest = 'a'.repeat(64);
const shareToken = 's'.repeat(43);

const release = {
    schemaVersion: 1,
    releaseId: 'release-1',
    projectId: 'project-1',
    branchId: 'branch-release',
    headCommitId: 'commit-1',
    contentHash: digest,
    manifestHash: 'b'.repeat(64),
    status: 'published',
    manifest: { title: 'Archive', visibility: 'player' },
};

const session = (overrides = {}) => ({
    schemaVersion: 1,
    sessionId: 'session-1',
    releaseId: 'release-1',
    projectId: 'project-1',
    branchId: 'branch-session',
    headCommitId: 'commit-1',
    lastEventId: null,
    revision: 0,
    status: 'active',
    audience: 'player',
    activeTurnId: null,
    lastTurnId: null,
    turnStage: 'idle',
    renderCursor: { lastEventId: null, lastSeq: -1 },
    stageSnapshot: { turnId: null, stage: 'idle', lastRender: null },
    ...overrides,
});

function response(data) {
    return Response.json({ schemaVersion: 1, ok: true, data });
}

test('release/session client uses fixed same-origin routes and strips browser credentials', async () => {
    const source = fs.readFileSync(
        path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../public/scripts/extensions/novel-mode/release-session-client.js',
        ),
        'utf8',
    );
    assert.doesNotMatch(source, /https?:\/\//i);
    assert.doesNotMatch(source, /NOVEL_RUNTIME_(?:BASE_URL|TOKEN)/i);
    const requests = [];
    const client = createNovelReleaseSessionClient({
        getHeaders: () => ({
            authorization: 'browser-token',
            'x-novel-actor-role': 'author',
            'x-novel-runtime-url': 'https://attacker.invalid',
        }),
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            if (url.endsWith('/releases/release-1')) return response(release);
            if (url.endsWith('/releases/release-1/sessions')) return response(session());
            if (url.endsWith('/sessions/session-1/share')) return response({
                schemaVersion: 1,
                sessionId: 'session-1',
                shareId: 'share-1',
                sharePath: `/?novel-share=${shareToken}`,
            });
            return response(session({ lastEventId: 'event-8', revision: 8 }));
        },
    });

    await client.openRelease('release-1');
    await client.openSession('release-1');
    await client.shareSession('session-1');
    await client.sessionSnapshot('session-1');
    await client.reconnectSession('session-1', { lastEventId: 'event-7' });
    await client.openSharedSession(shareToken);

    assert.deepEqual(requests.map(({ url }) => url), [
        '/api/plugins/novel-runtime-bridge/v1/releases/release-1',
        '/api/plugins/novel-runtime-bridge/v1/releases/release-1/sessions',
        '/api/plugins/novel-runtime-bridge/v1/sessions/session-1/share',
        '/api/plugins/novel-runtime-bridge/v1/sessions/session-1',
        '/api/plugins/novel-runtime-bridge/v1/sessions/session-1/reconnect?lastEventId=event-7',
        `/api/plugins/novel-runtime-bridge/share/${shareToken}`,
    ]);
    assert.equal(requests.every(({ options }) => options.credentials === 'same-origin'), true);
    assert.equal(requests.every(({ options }) => !options.headers.has('authorization')), true);
    assert.equal(requests.every(({ options }) => !options.headers.has('x-novel-actor-role')), true);
    assert.equal(requests.every(({ options }) => !options.headers.has('x-novel-runtime-url')), true);
    assert.equal(JSON.parse(requests[1].options.body).schemaVersion, 1);
});

test('share entry parser accepts one opaque query token without persisting it', () => {
    assert.equal(readNovelShareToken({ search: '' }), null);
    assert.equal(readNovelShareToken({ search: `?novel-share=${shareToken}` }), shareToken);
    assert.throws(
        () => readNovelShareToken({ search: '?novel-share=https%3A%2F%2Fattacker.invalid' }),
        /share token is invalid/i,
    );
    assert.throws(
        () => readNovelShareToken({ search: `?novel-share=${shareToken}&novel-share=${shareToken}` }),
        /ambiguous/i,
    );
});

test('release/session client rejects malformed server data and unsafe identifiers', async () => {
    const client = createNovelReleaseSessionClient({
        fetchImpl: async () => response({ ...release, status: 'draft' }),
    });
    await assert.rejects(() => client.openRelease('release-1'), /not published/i);
    await assert.rejects(() => client.openRelease('https://attacker.invalid'), /opaque identifier/i);

    const malformedShareClient = createNovelReleaseSessionClient({
        fetchImpl: async () => response({
            schemaVersion: 1,
            sessionId: 'session-1',
            shareId: 'share-1',
            sharePath: 'https://attacker.invalid',
        }),
    });
    await assert.rejects(() => malformedShareClient.shareSession('session-1'), /share path is invalid/i);
});

test('reconnect accepts only player-safe recovery events and authoritative cursors', async () => {
    const event = {
        schema_version: 1,
        event_id: 'event-recovery-1',
        turn_id: 'turn-recovery-1',
        seq: 1,
        audience: 'player',
        render: { schemaVersion: 1, type: 'prose.delta', payload: { delta: 'Recovered.' } },
    };
    const recovered = session({
        activeTurnId: null,
        lastTurnId: 'turn-recovery-1',
        turnStage: 'committed',
        renderCursor: { lastEventId: 'event-recovery-1', lastSeq: 1 },
        stageSnapshot: { turnId: 'turn-recovery-1', stage: 'committed', lastRender: event },
        recoveryEvents: [event],
        replayTruncated: false,
    });
    const client = createNovelReleaseSessionClient({ fetchImpl: async () => response(recovered) });
    const result = await client.reconnectSession('session-1');
    assert.equal(result.recoveryEvents[0].audience, 'player');
    assert.equal(result.renderCursor.lastSeq, 1);

    const unsafe = createNovelReleaseSessionClient({
        fetchImpl: async () => response({
            ...recovered,
            recoveryEvents: [{ ...event, audience: 'author' }],
        }),
    });
    await assert.rejects(() => unsafe.reconnectSession('session-1'), /recovery event is invalid/i);
});

test('health contract requires every release/session capability and no canonical write', () => {
    const health = validateReleaseSessionHealth({
        schemaVersion: 1,
        service: 'novel-runtime-bridge',
        status: 'ready',
        capabilities: ['health', ...RELEASE_SESSION_HEALTH_CAPABILITIES],
        canonicalWrite: false,
        runtimeConfigured: true,
        runtimeReachable: true,
    });
    assert.equal(health.runtimeReachable, true);
    assert.throws(
        () => validateReleaseSessionHealth({ ...health, capabilities: ['health'] }),
        /capabilities are incomplete/i,
    );
    assert.throws(
        () => validateReleaseSessionHealth({ ...health, canonicalWrite: true }),
        /identity is invalid/i,
    );
});

test('minimal release/session state machine separates open, share, reconnect, and close', () => {
    let state = createInitialReleaseSessionState();
    assert.equal(state.status, 'idle');
    state = reduceReleaseSessionState(state, { type: 'release.opened', release });
    assert.equal(state.status, 'release_ready');
    state = reduceReleaseSessionState(state, { type: 'session.opened', session: session() });
    assert.equal(state.status, 'active');
    state = reduceReleaseSessionState(state, {
        type: 'session.shared',
        share: { schemaVersion: 1, sessionId: 'session-1', shareId: 'share-1', sharePath: `/?novel-share=${shareToken}` },
    });
    assert.equal(state.share.shareId, 'share-1');
    state = reduceReleaseSessionState(state, { type: 'session.reconnecting' });
    assert.equal(state.status, 'reconnecting');
    state = reduceReleaseSessionState(state, {
        type: 'session.reconnected',
        session: session({ lastEventId: 'event-9', revision: 9 }),
    });
    assert.equal(state.status, 'active');
    state = reduceReleaseSessionState(state, { type: 'session.closed' });
    assert.equal(state.status, 'closed');
    assert.throws(
        () => reduceReleaseSessionState(createInitialReleaseSessionState(), { type: 'session.reconnecting' }),
        /requires an open session/i,
    );
});
