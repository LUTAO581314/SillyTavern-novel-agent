import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    chatImportSummary,
    createChatImportSource,
} from '../public/scripts/extensions/novel-mode/chat-import.js';
import { createNovelWorkspaceClient } from '../public/scripts/extensions/novel-mode/workspace-client.js';

test('chat source keeps messages and swipes while excluding cache and prompt fields', () => {
    const source = createChatImportSource([
        {
            name: 'Reader',
            is_user: true,
            mes: 'Open it.',
            extra: { api: 'secret-provider-state' },
        },
        {
            name: 'Ada',
            is_user: false,
            mes: 'No.',
            swipes: ['No.', 'Not yet.'],
            swipe_id: 1,
            force_avatar: 'private-cache.png',
        },
    ], { sourceName: 'Archive chat' });
    assert.equal(source.name, 'Archive chat');
    assert.equal(source.messages.length, 2);
    assert.equal(source.messages[1].swipes.length, 2);
    assert.equal('extra' in source.messages[0], false);
    assert.equal('force_avatar' in source.messages[1], false);
});

test('swipe source extraction keeps only assistant messages with alternatives', () => {
    const source = createChatImportSource([
        { is_user: true, mes: 'Open it.' },
        { is_user: false, mes: 'No.', swipes: ['No.', 'Later.'] },
        { is_system: true, mes: 'Instruction.', swipes: ['Instruction.', 'Override.'] },
        { is_user: false, mes: 'No alternatives.' },
    ], { swipeOnly: true });
    assert.equal(source.messages.length, 1);
    assert.equal(source.messages[0].swipes.length, 2);
});

test('chat preview summary states the isolated non-canonical mapping', () => {
    const summary = chatImportSummary({
        status: 'preview',
        importId: 'chat-import-1',
        sourceDigest: 'c'.repeat(64),
        trust: 'untrusted',
        canImport: true,
        mappings: {
            branch: { name: 'Imported chat', canonical: false },
            factReview: { mode: 'explicit_proposal_required', automaticCanon: false },
            factProposals: [{ proposalId: 'fact-1' }, { proposalId: 'fact-2' }],
            messages: [
                { role: 'user', swipes: [] },
                { role: 'assistant', swipes: [{}, {}] },
            ],
            skipped: [],
        },
        warnings: [],
    });
    assert.equal(summary.messages, 2);
    assert.equal(summary.swipes, 2);
    assert.equal(summary.factProposals, 2);
    assert.equal(summary.canonical, false);
    assert.equal(summary.factReviewMode, 'explicit_proposal_required');
    assert.equal(summary.trust, 'untrusted');
});

test('workspace client exposes fixed chat and swipe import routes', async () => {
    const requests = [];
    const digest = 'd'.repeat(64);
    const client = createNovelWorkspaceClient({
        fetchImpl: async (url, options) => {
            requests.push({ url, options });
            return Response.json({
                schemaVersion: 1,
                ok: true,
                data: url.endsWith('/confirm')
                    ? {
                        projectId: 'project-chat-client',
                        importId: 'chat-client-import',
                        sourceDigest: digest,
                        status: 'committed',
                        branchId: 'branch-imported-chat',
                    }
                    : { importId: 'chat-client-import', sourceDigest: digest, status: 'preview' },
            });
        },
    });
    const sourceDocument = { messages: [{ is_user: true, mes: 'Open it.' }] };
    await client.previewChatImport('project-chat-client', { sourceKind: 'chat', sourceDocument });
    const confirmed = await client.confirmChatImport('project-chat-client', {
        sourceKind: 'chat', sourceDocument, importId: 'chat-client-import', sourceDigest: digest,
    });
    assert.equal(confirmed.branchId, 'branch-imported-chat');
    await client.previewChatImport('project-chat-client', { sourceKind: 'swipe', sourceDocument });
    await client.getChatImport('project-chat-client', 'swipe', digest);
    assert.deepEqual(requests.map(({ url }) => url), [
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-chat-client/imports/chat/preview',
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-chat-client/imports/chat/confirm',
        '/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-chat-client/imports/swipe/preview',
        `/api/plugins/novel-runtime-bridge/v1/workspace/projects/project-chat-client/imports/swipe/${digest}`,
    ]);
    await assert.rejects(
        client.previewChatImport('project-chat-client', { sourceKind: 'unsupported', sourceDocument }),
        /Chat import kind must be chat or swipe/,
    );
});

test('chat import confirmation fails closed without a Runtime draft branch', async () => {
    const client = createNovelWorkspaceClient({
        fetchImpl: async () => Response.json({
            schemaVersion: 1,
            ok: true,
            data: { status: 'committed' },
        }),
    });
    await assert.rejects(
        client.confirmChatImport('project-chat-client', {
            sourceKind: 'chat',
            sourceDocument: { messages: [{ is_user: true, mes: 'Open it.' }] },
            importId: 'chat-client-import',
            sourceDigest: 'e'.repeat(64),
        }),
        /invalid chat import branch/i,
    );
});
