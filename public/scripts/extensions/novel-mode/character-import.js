const CARD_FIELDS = Object.freeze([
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'creator_notes',
    'system_prompt',
    'post_history_instructions',
    'alternate_greetings',
    'tags',
    'creator',
    'character_version',
    'extensions',
    'character_book',
]);

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}
function sourceValue(character, field) {
    if (character?.data && character.data[field] !== undefined) return character.data[field];
    return character?.[field];
}

export function createCharacterCardSource(character, { persona = null } = {}) {
    if (!character || typeof character !== 'object' || Array.isArray(character)) {
        throw new TypeError('A selected SillyTavern character is required.');
    }
    const data = {};
    for (const field of CARD_FIELDS) {
        const value = cloneJson(sourceValue(character, field));
        if (value !== undefined) data[field] = value;
    }
    if (typeof data.name !== 'string' || !data.name.trim()) {
        throw new TypeError('The selected SillyTavern character has no name.');
    }
    if (persona && typeof persona === 'object' && !Array.isArray(persona)) {
        data.persona = cloneJson(persona);
    }
    const document = {
        spec: typeof character?.spec === 'string' ? character.spec : 'chara_card_v2',
        spec_version: typeof character?.spec_version === 'string' ? character.spec_version : '2.0',
        data,
    };
    if (JSON.stringify(document).length > 10_000_000) {
        throw new TypeError('The selected Character Card exceeds the Novel import limit.');
    }
    return document;
}

export function characterImportSummary(preview) {
    if (!preview || typeof preview !== 'object' || preview.status !== 'preview') {
        throw new TypeError('A Character Card import preview is required.');
    }
    return Object.freeze({
        importId: preview.importId,
        sourceDigest: preview.sourceDigest,
        name: preview.mappings?.character?.canonicalName ?? 'Imported Character',
        persona: preview.mappings?.persona?.name ?? null,
        styleSamples: Array.isArray(preview.mappings?.styleSamples)
            ? preview.mappings.styleSamples.length
            : 0,
        openingDraft: Boolean(preview.mappings?.openingDraft),
        warnings: Array.isArray(preview.warnings) ? preview.warnings.length : 0,
        trust: preview.trust,
        canImport: preview.canImport === true,
    });
}
