import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createNovelMessageCache } from '../public/scripts/extensions/novel-mode/display-cache.js';
import { NovelModeSession } from '../public/scripts/extensions/novel-mode/session.js';
import { createNovelModeRuntimeClient } from '../public/scripts/extensions/novel-mode/runtime-client.js';

function snapshotEvents() {
    return [
        {
            schema_version: 1,
            event_id: 'event-0',
            turn_id: 'turn-recovery',
            seq: 0,
            audience: 'author',
            render: {
                schemaVersion: 1,
                type: 'prose.delta',
                payload: {
                    blockId: 'block-1',
                    delta: 'Recovered without SillyTavern chat history.',
                    provisional: true,
                },
            },
        },
        {
            schema_version: 1,
            event_id: 'event-1',
            turn_id: 'turn-recovery',
            seq: 1,
            audience: 'author',
            render: {
                schemaVersion: 1,
                type: 'turn.committed',
                payload: {
                    commitId: 'commit-restored',
                    committedAt: '2026-07-17T00:00:00.000Z',
                },
            },
        },
    ];
}

describe('Novel Mode binding shell', () => {
    test('uses only fixed same-origin health and snapshot routes', async () => {
        const requests = [];
        const client = createNovelModeRuntimeClient({
            getHeaders: () => ({ 'x-csrf-token': 'csrf-only' }),
            fetchImpl: async (url, options) => {
                requests.push({ url, options });
                if (url.endsWith('/health')) {
                    return Response.json({
                        schemaVersion: 1,
                        service: 'novel-runtime-bridge',
                        status: 'ready',
                        capabilities: ['health', 'turn.snapshot'],
                        canonicalWrite: false,
                        runtimeConfigured: true,
                        runtimeReachable: true,
                        runtimeService: 'novel-runtime',
                    });
                }
                return Response.json({
                    schemaVersion: 1,
                    ok: true,
                    data: {
                        turnId: 'turn-recovery',
                        lastEventId: 'event-1',
                        seq: 1,
                        events: snapshotEvents(),
                    },
                });
            },
        });

        assert.equal((await client.health()).runtimeReachable, true);
        assert.equal((await client.snapshot('turn-recovery')).events.length, 2);
        assert.deepEqual(requests.map(item => item.url), [
            '/api/plugins/novel-runtime-bridge/health',
            '/api/plugins/novel-runtime-bridge/v1/turns/turn-recovery/snapshot',
        ]);
        assert.equal(requests.every(item => item.options.credentials === 'same-origin'), true);
        await assert.rejects(() => client.snapshot('https://attacker.invalid/'), /opaque identifier/i);
    });

    test('restores the committed view after local display cache is cleared', async () => {
        let snapshotCalls = 0;
        const session = new NovelModeSession({
            runtimeClient: {
                async snapshot(turnId) {
                    snapshotCalls += 1;
                    assert.equal(turnId, 'turn-recovery');
                    return { events: snapshotEvents() };
                },
            },
        });
        const binding = {
            projectId: 'project-1',
            branchId: 'branch-main',
            chapterId: 'chapter-1',
            sceneId: 'scene-1',
            resumeTurnId: 'turn-recovery',
            audience: 'author',
        };

        let view = await session.bind(binding);
        assert.equal(view.text, 'Recovered without SillyTavern chat history.');
        assert.equal(view.commitId, 'commit-restored');
        assert.equal(session.canUseMode('direct'), true);
        assert.deepEqual(session.createInputIntent('act', 'Open the sealed door.'), {
            schemaVersion: 1,
            mode: 'act',
            text: 'Open the sealed door.',
            binding: {
                projectId: 'project-1',
                branchId: 'branch-main',
                chapterId: 'chapter-1',
                sceneId: 'scene-1',
            },
        });
        assert.equal(typeof session.submitTurn, 'undefined');

        const cache = createNovelMessageCache(view);
        assert.deepEqual(Object.keys(cache), [
            'schema_version',
            'turn_id',
            'commit_id',
            'text',
            'components',
        ]);
        assert.equal(JSON.stringify(cache).includes('project-1'), false);
        session.clearDisplay();
        assert.equal(session.view.text, '');

        view = await session.bind(binding);
        assert.equal(snapshotCalls, 2);
        assert.equal(view.commitId, 'commit-restored');

        await session.bind({ ...binding, audience: 'player' });
        assert.equal(session.canUseMode('direct'), false);
        assert.throws(() => session.createInputIntent('direct', 'Reveal the hidden plan.'), /not permitted/i);
    });

    test('rejects incomplete bindings and does not accept canonical state in message cache', async () => {
        const session = new NovelModeSession({
            runtimeClient: { snapshot: async () => ({ events: [] }) },
        });
        await assert.rejects(() => session.bind({ projectId: 'project-1' }), /binding/i);

        const cache = createNovelMessageCache({
            turnId: 'turn-1',
            commitId: 'commit-1',
            text: 'Display text.',
            components: [],
            claims: [{ id: 'claim-forbidden' }],
            projection: { forbidden: true },
        });
        assert.equal('claims' in cache, false);
        assert.equal('projection' in cache, false);
    });
});
