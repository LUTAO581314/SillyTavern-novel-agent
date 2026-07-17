import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
    createInitialNovelView,
    NovelRenderEventDispatcher,
    SUPPORTED_RENDER_EVENT_TYPES,
} from '../public/scripts/extensions/novel-mode/render-event-dispatcher.js';

function viewEvent(type, payload, seq, overrides = {}) {
    return {
        schema_version: 1,
        event_id: `event-${seq}`,
        turn_id: 'turn-recovery',
        seq,
        audience: 'author',
        render: {
            schemaVersion: 1,
            type,
            payload,
        },
        ...overrides,
    };
}

describe('Novel Render Event dispatcher', () => {
    test('covers the frozen render union and builds a committed display view in sequence', () => {
        assert.deepEqual(SUPPORTED_RENDER_EVENT_TYPES, [
            'turn.accepted',
            'plan.ready',
            'stage.changed',
            'prose.delta',
            'component.upsert',
            'component.remove',
            'media.cue',
            'choices.set',
            'validation.issue',
            'state.preview',
            'turn.awaiting_approval',
            'turn.committed',
            'projection.updated',
            'turn.stale',
            'turn.cancelled',
            'turn.failed',
        ]);

        const dispatcher = new NovelRenderEventDispatcher();
        assert.equal(dispatcher.dispatch(viewEvent('prose.delta', {
            blockId: 'block-1',
            delta: 'Recovered committed passage.',
            provisional: true,
        }, 0)).status, 'applied');
        assert.equal(dispatcher.dispatch(viewEvent('component.upsert', {
            componentId: 'component-1',
            componentType: 'narration',
            revision: 1,
            provisional: true,
            props: { text: '<img src=x onerror=alert(1)> remains text' },
        }, 1)).status, 'applied');
        assert.equal(dispatcher.dispatch(viewEvent('turn.committed', {
            commitId: 'commit-1',
            committedAt: '2026-07-17T00:00:00.000Z',
        }, 2)).status, 'applied');
        assert.equal(dispatcher.dispatch(viewEvent('projection.updated', {
            commitId: 'commit-1',
            projectionVersion: 7,
            changedEntityIds: ['character-pov'],
            committed: true,
        }, 3)).status, 'applied');

        assert.deepEqual(dispatcher.view, {
            ...createInitialNovelView(),
            turnId: 'turn-recovery',
            commitId: 'commit-1',
            text: 'Recovered committed passage.',
            components: [{
                componentId: 'component-1',
                componentType: 'narration',
                revision: 1,
                provisional: true,
                props: { text: '<img src=x onerror=alert(1)> remains text' },
            }],
            stage: 'committed',
            projectionVersion: 7,
            lastEventId: 'event-3',
            lastSeq: 3,
        });

        assert.equal(dispatcher.dispatch(viewEvent('prose.delta', {
            blockId: 'block-1',
            delta: 'must not repeat',
            provisional: true,
        }, 3)).status, 'duplicate');
        assert.equal(dispatcher.view.text, 'Recovered committed passage.');
    });

    test('uses a safe text fallback for unknown versions, types, and unsafe payloads', () => {
        const fallbacks = [];
        const dispatcher = new NovelRenderEventDispatcher({
            onFallback: fallback => fallbacks.push(fallback),
        });

        const future = viewEvent('prose.delta', {
            blockId: 'block-1',
            delta: 'future',
            provisional: true,
        }, 0, { schema_version: 2 });
        assert.equal(dispatcher.dispatch(future).status, 'fallback');

        const unknown = viewEvent('html.execute', { html: '<script>alert(1)</script>' }, 1);
        assert.equal(dispatcher.dispatch(unknown).status, 'fallback');

        const unsafe = viewEvent('component.upsert', {
            componentId: 'component-unsafe',
            componentType: 'artifact',
            revision: 1,
            provisional: true,
            props: { innerHTML: '<script>alert(1)</script>' },
        }, 2);
        assert.equal(dispatcher.dispatch(unsafe).status, 'fallback');

        const authorityDraft = viewEvent('component.upsert', {
            componentId: 'component-state',
            componentType: 'character-status',
            revision: 1,
            provisional: true,
            props: { label: 'Not canonical' },
        }, 3);
        assert.equal(dispatcher.dispatch(authorityDraft).status, 'fallback');

        assert.equal(fallbacks.length, 4);
        assert.equal(fallbacks.every(item => typeof item.text === 'string' && !item.html), true);
        assert.deepEqual(dispatcher.view, createInitialNovelView());
    });

    test('does not expose author-only events to a player view', () => {
        const dispatcher = new NovelRenderEventDispatcher({ audience: 'player' });
        const result = dispatcher.dispatch(viewEvent('plan.ready', { plan: {} }, 0, {
            audience: 'player',
        }));
        assert.equal(result.status, 'fallback');
        assert.equal(dispatcher.view.lastSeq, -1);
    });
});
