const MESSAGE_FIELDS = Object.freeze([
    'name',
    'is_user',
    'is_system',
    'mes',
    'swipes',
    'swipe_id',
    'send_date',
]);

function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

export function createChatImportSource(messages, { sourceName = null, swipeOnly = false } = {}) {
    if (!Array.isArray(messages)) throw new TypeError('A loaded SillyTavern chat is required.');
    const mapped = messages.flatMap(message => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
        if (swipeOnly && (
            message.is_user === true
            || message.is_system === true
            || !Array.isArray(message.swipes)
            || message.swipes.length === 0
        )) {
            return [];
        }
        const output = {};
        for (const field of MESSAGE_FIELDS) {
            const value = cloneJson(message[field]);
            if (value !== undefined) output[field] = value;
        }
        return [output];
    });
    const document = {
        name: typeof sourceName === 'string' && sourceName.trim() ? sourceName.trim() : 'Current SillyTavern chat',
        messages: mapped,
    };
    if (JSON.stringify(document).length > 10_000_000) {
        throw new TypeError('The current chat exceeds the Novel import limit.');
    }
    return document;
}

export function chatImportSummary(preview) {
    if (!preview || typeof preview !== 'object' || preview.status !== 'preview') {
        throw new TypeError('A chat import preview is required.');
    }
    const messages = Array.isArray(preview.mappings?.messages) ? preview.mappings.messages : [];
    return Object.freeze({
        importId: preview.importId,
        sourceDigest: preview.sourceDigest,
        branchName: preview.mappings?.branch?.name ?? 'Imported draft',
        messages: messages.length,
        userMessages: messages.filter(message => message?.role === 'user').length,
        assistantMessages: messages.filter(message => message?.role === 'assistant').length,
        systemMessages: messages.filter(message => message?.role === 'system').length,
        swipes: messages.reduce((count, message) => count + (Array.isArray(message?.swipes) ? message.swipes.length : 0), 0),
        factProposals: Array.isArray(preview.mappings?.factProposals) ? preview.mappings.factProposals.length : 0,
        skipped: Array.isArray(preview.mappings?.skipped) ? preview.mappings.skipped.length : 0,
        warnings: Array.isArray(preview.warnings) ? preview.warnings.length : 0,
        trust: preview.trust,
        canImport: preview.canImport === true,
        canonical: preview.mappings?.branch?.canonical === true,
        factReviewMode: preview.mappings?.factReview?.mode ?? 'explicit_proposal_required',
    });
}
