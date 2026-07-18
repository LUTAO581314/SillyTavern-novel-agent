import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    canAuthorWorkspace,
    canDisplayRecord,
    createInitialWorkspaceState,
    deriveOnboardingStep,
    projectBinding,
    publicWorkspaceState,
    reduceWorkspaceState,
    worldOpeningRoutes,
} from '../public/scripts/extensions/novel-mode/workspace-state.js';

test('S12-01 onboarding advances from inspiration to stage without inventing canon', () => {
    let state = createInitialWorkspaceState();
    assert.equal(state.onboarding, 'inspiration');
    state = reduceWorkspaceState(state, {
        type: 'project.bound',
        project: { id: 'project-1', title: 'Archive' },
        chapters: [{ id: 'chapter-1', title: 'Opening' }],
        scenes: [{ id: 'scene-1', chapterId: 'chapter-1', title: 'Rain' }],
        world: { status: 'draft', revision: 0, items: [] },
        branch: { id: 'branch-1', headCommitId: null },
    });
    assert.equal(state.onboarding, 'guide');
    state = reduceWorkspaceState(state, { type: 'guide.proposed', guide: { proposalId: 'proposal-1', suggestions: [] } });
    assert.equal(state.onboarding, 'lock');
    state = reduceWorkspaceState(state, {
        type: 'world.locked',
        world: {
            status: 'locked',
            revision: 2,
            items: [{ id: 'route-item', itemType: 'opening_route', title: 'Rain', payload: { routeId: 'route-1', sceneId: 'scene-1' } }],
        },
    });
    assert.equal(state.onboarding, 'opening');
    state = reduceWorkspaceState(state, { type: 'opening.selected', route: { routeId: 'route-1', sceneId: 'scene-1' } });
    assert.equal(state.onboarding, 'stage');
    assert.deepEqual(projectBinding(state), {
        projectId: 'project-1', branchId: 'branch-1', chapterId: 'chapter-1', sceneId: 'scene-1',
    });
    state = reduceWorkspaceState(state, { type: 'stage.updated', stage: { turnId: 'turn-1', text: 'A paragraph.' } });
    assert.equal(state.stage.turnId, 'turn-1');
});

test('opening routes and player views exclude author-only material', () => {
    const world = {
        items: [
            { id: 'route-item', itemType: 'opening_route', title: 'Opening', payload: { routeId: 'route-1', sceneId: null } },
            { id: 'truth', itemType: 'author_truth', title: 'Truth', payload: {}, visibility: 'author' },
        ],
    };
    assert.equal(worldOpeningRoutes(world)[0].routeId, 'route-1');
    assert.equal(canDisplayRecord(world.items[1], 'player'), false);
    assert.equal(canDisplayRecord(world.items[0], 'player'), true);
    assert.equal(deriveOnboardingStep({ project: null }), 'inspiration');
});

test('server workbench capabilities prevent a player from escalating the local audience', () => {
    let state = createInitialWorkspaceState();
    state = reduceWorkspaceState(state, {
        type: 'project.bound',
        project: { id: 'project-1', title: 'Archive' },
        chapters: [],
        scenes: [],
        world: {
            status: 'locked',
            revision: 2,
            items: [{ id: 'rule-1', itemType: 'hard_rule', payload: { statement: 'No teleportation.' } }],
        },
        branch: { id: 'branch-1', headCommitId: null },
        workbench: {
            access: {
                role: 'player',
                audience: 'player',
                canEditWorld: false,
                canDirect: false,
                canPreviewPlayer: false,
                canUseDirect: false,
            },
            director: null,
            performance: { routes: [], packs: [], activePack: null },
        },
    });
    assert.equal(state.audience, 'player');
    assert.equal(canAuthorWorkspace(state), false);
    state = reduceWorkspaceState(state, { type: 'audience.changed', audience: 'author' });
    assert.equal(state.audience, 'player');
    const view = publicWorkspaceState({
        ...state,
        director: { groups: { truths: [{ payload: { secret: 'hidden' } }] } },
        recall: {
            available: true,
            entries: [{
                fragmentId: 'fragment-public',
                recordType: 'prose_block',
                recallReason: 'recent_prose',
                tokenCount: 4,
                decision: 'included',
                source: { kind: 'prose_block', id: 'private-source-id' },
                content: { text: 'Visible prose.' },
            }],
        },
    }, 'player');
    assert.equal(view.director, null);
    assert.deepEqual(view.recall.entries[0].source, { kind: 'prose_block' });
    assert.equal(JSON.stringify(view).includes('private-source-id'), false);
    assert.equal(JSON.stringify(view).includes('hidden'), false);
});
