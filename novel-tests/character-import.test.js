import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    characterImportSummary,
    createCharacterCardSource,
} from '../public/scripts/extensions/novel-mode/character-import.js';

test('Character Card source keeps card fields and excludes SillyTavern chat state', () => {
    const source = createCharacterCardSource({
        name: 'Ada',
        avatar: 'ada.png',
        chat: 'private-chat-file',
        first_mes: 'Open the archive.',
        data: {
            name: 'Ada',
            description: 'An archivist.',
            mes_example: '{{char}}: Quiet.',
            character_book: { entries: [{ content: 'deferred lore' }] },
        },
    });
    assert.equal(source.spec, 'chara_card_v2');
    assert.equal(source.data.name, 'Ada');
    assert.equal(source.data.first_mes, 'Open the archive.');
    assert.equal(source.data.character_book.entries.length, 1);
    assert.equal('avatar' in source.data, false);
    assert.equal('chat' in source.data, false);
});
test('Character Card preview summary remains a non-canonical untrusted review view', () => {
    const summary = characterImportSummary({
        status: 'preview',
        importId: 'import-ada',
        sourceDigest: 'a'.repeat(64),
        trust: 'untrusted',
        canImport: true,
        mappings: {
            character: { canonicalName: 'Ada' },
            persona: { name: 'Reader' },
            styleSamples: [{ sampleId: 'style-1' }],
            openingDraft: { draftId: 'opening-1' },
        },
        warnings: [{ code: 'CHARACTER_BOOK_DEFERRED' }],
    });
    assert.deepEqual(summary, {
        importId: 'import-ada',
        sourceDigest: 'a'.repeat(64),
        name: 'Ada',
        persona: 'Reader',
        styleSamples: 1,
        openingDraft: true,
        warnings: 1,
        trust: 'untrusted',
        canImport: true,
    });
});
