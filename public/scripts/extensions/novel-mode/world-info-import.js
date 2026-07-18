function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export function createWorldInfoSource(worldInfo, { sourceName = null } = {}) {
    if (!worldInfo || typeof worldInfo !== 'object' || Array.isArray(worldInfo)) {
        throw new TypeError('A selected SillyTavern World Info document is required.');
    }
    const entries = worldInfo.entries ?? worldInfo.data?.entries;
    if (!entries || (typeof entries !== 'object' && !Array.isArray(entries))) {
        throw new TypeError('The selected World Info document has no entries.');
    }
    const document = {
        name: typeof sourceName === 'string' && sourceName.trim()
            ? sourceName.trim()
            : typeof worldInfo.name === 'string'
                ? worldInfo.name
                : 'Imported World Info',
        entries: cloneJson(entries),
    };
    if (JSON.stringify(document).length > 10_000_000) {
        throw new TypeError('The selected World Info document exceeds the Novel import limit.');
    }
    return document;
}

export function worldInfoImportSummary(preview) {
    if (!preview || typeof preview !== 'object' || preview.status !== 'preview') {
        throw new TypeError('A World Info import preview is required.');
    }
    const entries = Array.isArray(preview.mappings?.entries) ? preview.mappings.entries : [];
    const classifications = Object.fromEntries(
        ['entity', 'rule', 'claim', 'style', 'reference'].map(kind => [
            kind,
            entries.filter(entry => entry?.classification === kind).length,
        ]),
    );
    return Object.freeze({
        importId: preview.importId,
        sourceDigest: preview.sourceDigest,
        entries: entries.length,
        classifications,
        conflicts: entries.reduce((count, entry) => (
            count + (Array.isArray(entry?.conflicts) ? entry.conflicts.length : 0)
        ), 0),
        skipped: Array.isArray(preview.mappings?.skipped) ? preview.mappings.skipped.length : 0,
        warnings: Array.isArray(preview.warnings) ? preview.warnings.length : 0,
        trust: preview.trust,
        canImport: preview.canImport === true,
    });
}
