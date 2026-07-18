import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNovelWorkspaceClient } from '../public/scripts/extensions/novel-mode/workspace-client.js';

test('workspace client uses only the fixed same-origin bridge and version 1 envelopes', async () => {
    const requests = [];
    const client = createNovelWorkspaceClient({
        getHeaders: () => ({
            authorization: 'browser-token',
            'x-csrf-token': 'csrf-only',
            'x-novel-actor-id': 'browser:attacker',
            'x-novel-actor-role': 'author',
        }),
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return Response.json({ schemaVersion: 1, ok: true, data: [{ id: 'project-1', title: 'Archive' }] });
        },
    });
    const projects = await client.listProjects();
    assert.equal(projects[0].id, 'project-1');
    assert.equal(requests[0].url, '/api/plugins/novel-runtime-bridge/v1/workspace/projects');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.headers.get('authorization'), null);
    assert.equal(requests[0].options.headers.get('x-novel-actor-id'), null);
    assert.equal(requests[0].options.headers.get('x-novel-actor-role'), null);
    await assert.rejects(() => client.getProject('https://attacker.invalid/'), /opaque identifier/i);
});

test('workspace client requests server-filtered workbench and recall views', async () => {
    const requests = [];
    const client = createNovelWorkspaceClient({
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return Response.json({ schemaVersion: 1, ok: true, data: { access: { role: 'author' } } });
        },
    });
    await client.getWorkspaceView('project-1', {
        audience: 'author',
        branchId: 'branch-1',
    });
    await client.getRecallDiagnostic('project-1', {
        audience: 'player',
        branchId: 'branch-1',
        contextPackId: 'context-1',
        povEntityId: 'character-1',
    });
    assert.deepEqual(requests.map(({ url }) => url), [
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/workspace/view?audience=author&branchId=branch-1',
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/workspace/recall?audience=player&branchId=branch-1&contextPackId=context-1&povEntityId=character-1',
    ]);
    await assert.rejects(
        () => client.getWorkspaceView('project-1', { audience: 'director' }),
        /author or player/i,
    );
});

test('workspace client sends world commands with idempotency and no client target override', async () => {
    const requests = [];
    const client = createNovelWorkspaceClient({
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return Response.json({ schemaVersion: 1, ok: true, data: { status: 'locked' } });
        },
    });
    await client.applyWorldBibleCommand('project-1', {
        schemaVersion: 1,
        commandId: 'command-1',
        actorId: 'sillytavern-author',
        expectedWorldRevision: 0,
        type: 'LockWorldBible',
        reason: 'test',
    });
    assert.equal(requests[0].url, '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/world-bible/commands');
    assert.equal(requests[0].options.headers.get('idempotency-key'), 'command-1');
    assert.equal(JSON.parse(requests[0].options.body).type, 'LockWorldBible');
});

test('workspace client keeps Character Card preview and confirmation on fixed import routes', async () => {
    const requests = [];
    const sourceDigest = 'a'.repeat(64);
    const sourceDocument = { spec: 'chara_card_v2', data: { name: 'Ada' } };
    const client = createNovelWorkspaceClient({
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return Response.json({
                schemaVersion: 1,
                ok: true,
                data: { importId: 'import-ada', sourceDigest, trust: 'untrusted' },
            });
        },
    });

    const preview = await client.previewCharacterImport('project-1', {
        sourceKind: 'character-card',
        sourceDocument,
        sourceName: 'ada.json',
    });
    await client.confirmCharacterImport('project-1', {
        sourceKind: 'character-card',
        sourceDocument,
        sourceName: 'ada.json',
        importId: preview.importId,
        sourceDigest: preview.sourceDigest,
    });

    assert.deepEqual(requests.map(({ url }) => url), [
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/imports/character-card/preview',
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/imports/character-card/confirm',
    ]);
    assert.equal(requests[1].options.headers.get('idempotency-key'), 'import-ada');
    assert.equal(JSON.parse(requests[1].options.body).sourceDigest, sourceDigest);
    await assert.rejects(
        () => client.previewCharacterImport('project-1', { sourceKind: 'world-info', sourceDocument }),
        /character-card or charx/i,
    );
});

test('workspace client keeps World Info preview, confirmation, and review on fixed routes', async () => {
    const requests = [];
    const sourceDigest = 'b'.repeat(64);
    const sourceDocument = { entries: { 0: { content: 'Archive lore.' } } };
    const client = createNovelWorkspaceClient({
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return Response.json({
                schemaVersion: 1,
                ok: true,
                data: url.endsWith('/review-items')
                    ? []
                    : { importId: 'world-import-1', sourceDigest, trust: 'untrusted' },
            });
        },
    });
    const preview = await client.previewWorldInfoImport('project-1', {
        sourceDocument,
        sourceName: 'archive.json',
    });
    await client.confirmWorldInfoImport('project-1', {
        sourceDocument,
        sourceName: 'archive.json',
        importId: preview.importId,
        sourceDigest: preview.sourceDigest,
    });
    await client.listWorldInfoReviewItems('project-1');
    await client.reviewWorldInfoItem('project-1', 'review-1', {
        decision: 'accept',
        note: 'Reviewed.',
    });
    assert.deepEqual(requests.map(({ url }) => url), [
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/imports/world-info/preview',
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/imports/world-info/confirm',
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/imports/world-info/review-items',
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-1/imports/world-info/review-items/review-1',
    ]);
    assert.equal(requests[1].options.headers.get('idempotency-key'), 'world-import-1');
    assert.equal(JSON.parse(requests[3].options.body).decision, 'accept');
});
