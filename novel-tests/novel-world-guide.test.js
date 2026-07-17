import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NovelWorldGuide } from '../public/scripts/extensions/novel-mode/world-guide.js';

const item = {
    id: 'guide-facade',
    itemType: 'project_facade',
    title: 'Rain Archive',
    payload: { synopsis: 'A mystery.', tags: ['mystery'], audience: 'Adults' },
    controlMode: 'tentative',
};

const proposal = {
    schemaVersion: 1,
    proposalId: 'proposal-1',
    projectId: 'project-1',
    baseWorldRevision: 0,
    sourceMode: 'blank',
    trust: 'untrusted',
    model: {
        providerId: 'fake:model-default',
        modelProfileId: 'model-default',
        modelId: 'fake-model',
        correlationId: 'correlation-1',
        providerRequestId: 'request-1',
    },
    questions: [],
    suggestions: [{
        suggestionId: 'suggestion-1',
        questionIds: [],
        rationale: 'Preview only.',
        item,
        trust: 'untrusted',
        source: { kind: 'model_suggestion', reference: 'world-guide:proposal-1/suggestion-1' },
    }],
};

test('World Guide reject is local and confirmation advances from the Runtime world revision', async () => {
    const calls = [];
    const guide = new NovelWorldGuide({
        runtimeClient: {
            async proposeWorld(projectId, request) {
                calls.push({ method: 'propose', projectId, request });
                return structuredClone(proposal);
            },
            async confirmWorld(projectId, request) {
                calls.push({ method: 'confirm', projectId, request });
                return {
                    schemaVersion: 1,
                    proposalId: request.proposalId,
                    suggestionId: request.suggestionId,
                    trust: 'untrusted',
                    source: { kind: 'model_suggestion', reference: 'world-guide:proposal-1/suggestion-1' },
                    commandId: 'world-guide:command-1',
                    replayed: false,
                    world: { revision: 1 },
                };
            },
        },
    });

    await guide.propose('project-1', { schemaVersion: 1, source: { mode: 'blank' } });
    assert.equal(guide.proposal.trust, 'untrusted');
    assert.equal(guide.reject('missing'), false);
    assert.equal(calls.length, 1);

    const result = await guide.confirm('project-1', 'suggestion-1', {
        ...item,
        title: 'Author revised title',
    });
    assert.equal(result.world.revision, 1);
    assert.equal(guide.proposal.baseWorldRevision, 1);
    assert.equal(guide.proposal.suggestions.length, 0);
    assert.equal(calls[1].request.actorId, 'bridge-owned');
    assert.equal(calls[1].request.expectedWorldRevision, 0);
    assert.equal(calls[1].request.item.title, 'Author revised title');
});

test('World Guide rejection removes preview without issuing any write request', async () => {
    let confirms = 0;
    const guide = new NovelWorldGuide({
        runtimeClient: {
            proposeWorld: async () => structuredClone(proposal),
            confirmWorld: async () => {
                confirms += 1;
            },
        },
    });
    await guide.propose('project-1', { schemaVersion: 1, source: { mode: 'blank' } });
    assert.equal(guide.reject('suggestion-1'), true);
    assert.equal(guide.proposal.suggestions.length, 0);
    assert.equal(confirms, 0);
});
