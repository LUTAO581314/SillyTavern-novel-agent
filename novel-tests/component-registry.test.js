import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    NOVEL_COMPONENT_MANIFEST,
    NOVEL_COMPONENT_TYPES,
    novelComponentFallbackText,
    validateNovelComponentPayload,
} from '../public/scripts/extensions/novel-mode/component-registry.js';

const propsByType = Object.freeze({
    narration: { text: 'Rain crossed the archive windows.' },
    dialogue: { speaker: 'Ada', text: 'The ledger is wrong.', emotion: 'quiet' },
    'choice-set': {
        prompt: 'Choose',
        choices: [{ actionId: 'choice-open', label: 'Open', input: 'Open the door.', mode: 'act' }],
    },
    'character-status': {
        entityId: 'character-ada', name: 'Ada', state: { lifeState: 'alive' }, committed: true,
        commitId: 'commit-1', projectionVersion: 1,
    },
    'location-status': {
        locationId: 'location-archive', name: 'Archive', state: { sealed: true }, committed: true,
        commitId: 'commit-1', projectionVersion: 1,
    },
    artifact: { title: 'Ledger', body: 'The seventh line was erased.' },
    'image-scene': { assetId: 'asset-rain', alt: 'Rain on the archive windows.' },
    'audio-cue': { assetId: 'asset-rain-loop', label: 'Rain', channel: 'ambient', action: 'play', loop: true },
});

test('browser registry publishes and parses all eight component contracts', () => {
    assert.deepEqual(Object.keys(NOVEL_COMPONENT_MANIFEST), NOVEL_COMPONENT_TYPES);
    for (const componentType of NOVEL_COMPONENT_TYPES) {
        const manifest = NOVEL_COMPONENT_MANIFEST[componentType];
        const component = validateNovelComponentPayload({
            componentId: `component-${componentType}`,
            componentType,
            componentVersion: 1,
            visibility: ['author', 'player'],
            fallbackText: `Fallback for ${componentType}`,
            revision: 1,
            provisional: !manifest.authority,
            props: propsByType[componentType],
        });
        assert.equal(component.componentVersion, 1);
        assert.deepEqual(component.visibility, ['author', 'player']);
        assert.equal(component.fallbackText, `Fallback for ${componentType}`);
    }
});

test('browser registry fails closed on version, visibility, and authority drift', () => {
    const base = {
        componentId: 'component-character',
        componentType: 'character-status',
        componentVersion: 1,
        visibility: ['author', 'player'],
        fallbackText: 'Ada remains alive.',
        revision: 1,
        provisional: false,
        props: propsByType['character-status'],
    };
    assert.throws(() => validateNovelComponentPayload({ ...base, componentVersion: 2 }), /version/i);
    assert.throws(() => validateNovelComponentPayload({ ...base, visibility: ['author'] }, { audience: 'player' }), /visibility/i);
    assert.throws(() => validateNovelComponentPayload({ ...base, provisional: true }), /provisional/i);
});

test('protocol fallback text survives unknown types and future versions as plain text', () => {
    const fallbackText = '<b>Future component remains inert text.</b>';
    assert.equal(novelComponentFallbackText({
        componentType: 'future-component',
        componentVersion: 2,
        visibility: ['author', 'player'],
        fallbackText,
    }), fallbackText);
    assert.equal(novelComponentFallbackText({ componentType: 'future-component' }), 'This structured Novel component is unavailable.');
    assert.equal(novelComponentFallbackText({
        componentType: 'future-component',
        componentVersion: 2,
        visibility: ['author'],
        fallbackText: 'Author-only fallback',
    }, { audience: 'player' }), 'This structured Novel component is unavailable.');
});
