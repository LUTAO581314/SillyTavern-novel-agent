import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    createWorldInfoSource,
    worldInfoImportSummary,
} from '../public/scripts/extensions/novel-mode/world-info-import.js';

test('World Info source keeps entries and excludes cache or prompt runtime state', () => {
    const source = createWorldInfoSource({
        entries: {
            0: { uid: 0, key: ['archive'], content: 'A sealed archive.' },
        },
        cache: { activated: [0] },
        prompt: 'inject this directly',
    }, { sourceName: 'Archive Lore' });
    assert.equal(source.name, 'Archive Lore');
    assert.equal(source.entries[0].content, 'A sealed archive.');
    assert.equal('cache' in source, false);
    assert.equal('prompt' in source, false);
});

test('World Info preview summary exposes classification and conflict counts', () => {
    const summary = worldInfoImportSummary({
        status: 'preview',
        importId: 'world-import-1',
        sourceDigest: 'a'.repeat(64),
        trust: 'untrusted',
        canImport: true,
        mappings: {
            entries: [
                { classification: 'entity', conflicts: [] },
                { classification: 'rule', conflicts: [{ code: 'CANONICAL_HARD_RULE_CONFLICT' }] },
                { classification: 'reference', conflicts: [] },
            ],
            skipped: [{ sourcePath: 'entries.9' }],
        },
        warnings: [{ code: 'WORLD_INFO_PROMPT_QUARANTINED' }],
    });
    assert.equal(summary.entries, 3);
    assert.equal(summary.classifications.entity, 1);
    assert.equal(summary.classifications.rule, 1);
    assert.equal(summary.classifications.reference, 1);
    assert.equal(summary.conflicts, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.trust, 'untrusted');
});
