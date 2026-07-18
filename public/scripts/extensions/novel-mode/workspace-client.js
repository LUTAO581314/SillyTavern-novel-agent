const BRIDGE_PREFIX = '/api/plugins/novel-runtime-bridge';
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_QUERY_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CHARACTER_IMPORT_KINDS = new Set(['character-card', 'charx']);
const CHAT_IMPORT_KINDS = new Set(['chat', 'swipe']);

function requireId(value, label) {
    if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
        throw new TypeError(`${label} must be an opaque identifier.`);
    }
    return value;
}

function encodeId(value, label) {
    return encodeURIComponent(requireId(value, label));
}

function requireCharacterImportKind(value) {
    if (!CHARACTER_IMPORT_KINDS.has(value)) {
        throw new TypeError('Character import kind must be character-card or charx.');
    }
    return value;
}

function requireChatImportKind(value) {
    if (!CHAT_IMPORT_KINDS.has(value)) {
        throw new TypeError('Chat import kind must be chat or swipe.');
    }
    return value;
}

function requireDocument(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Novel import source document must be an object.');
    }
    return value;
}

function requireDigest(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
        throw new TypeError('Novel import source digest is invalid.');
    }
    return value;
}

function bridgeHeaders(getHeaders) {
    const headers = new Headers(getHeaders());
    headers.delete('authorization');
    headers.delete('x-novel-actor-id');
    headers.delete('x-novel-actor-role');
    headers.delete('x-novel-runtime-url');
    headers.set('accept', 'application/json');
    return headers;
}

function queryString(query) {
    if (!query || typeof query !== 'object') return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (!SAFE_QUERY_KEY.test(key) || value === undefined || value === null || value === '') continue;
        params.set(key, String(value));
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
}

function routePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/v1/workspace/')) {
        throw new TypeError('Novel workspace paths must use the fixed workspace API surface.');
    }
    return path;
}

async function readResponse(response) {
    let body;
    try {
        body = await response.json();
    } catch {
        throw new Error('Novel workspace API returned invalid JSON.');
    }
    if (body?.schemaVersion !== 1) {
        throw new Error('Novel workspace API returned an unsupported schema version.');
    }
    if (!response.ok || body.ok !== true) {
        const error = new Error(body?.error?.message || `Novel workspace API returned ${response.status}.`);
        error.code = body?.error?.code || 'WORKSPACE_REQUEST_FAILED';
        error.status = response.status;
        throw error;
    }
    return body.data;
}

export function createNovelWorkspaceClient({
    fetchImpl = globalThis.fetch,
    getHeaders = () => ({}),
    actorId = 'sillytavern-author',
} = {}) {
    if (typeof fetchImpl !== 'function' || typeof getHeaders !== 'function') {
        throw new TypeError('Novel workspace client requires fetch and header providers.');
    }
    requireId(actorId, 'Actor ID');

    async function request(method, path, { body, query, signal, idempotencyKey } = {}) {
        const headers = bridgeHeaders(getHeaders);
        if (body !== undefined) headers.set('content-type', 'application/json');
        if (idempotencyKey) headers.set('idempotency-key', requireId(idempotencyKey, 'Idempotency key'));
        const response = await fetchImpl(`${BRIDGE_PREFIX}${routePath(path)}${queryString(query)}`, {
            method,
            headers,
            credentials: 'same-origin',
            redirect: 'error',
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
        return readResponse(response);
    }

    const projectPath = projectId => `/v1/workspace/projects/${encodeId(projectId, 'Project ID')}`;
    const chapterPath = projectId => `${projectPath(projectId)}/chapters`;
    const scenePath = projectId => `${projectPath(projectId)}/scenes`;
    const characterImportPath = (projectId, sourceKind) => (
        `${projectPath(projectId)}/imports/${requireCharacterImportKind(sourceKind)}`
    );
    const worldInfoImportPath = projectId => `${projectPath(projectId)}/imports/world-info`;
    const chatImportPath = (projectId, sourceKind) => (
        `${projectPath(projectId)}/imports/${requireChatImportKind(sourceKind)}`
    );

    async function listProjects(signal) {
        return request('GET', '/v1/workspace/projects', { signal });
    }

    async function getProject(projectId, signal) {
        return request('GET', projectPath(projectId), { signal });
    }

    async function createProject(input, signal) {
        return request('POST', '/v1/workspace/projects', {
            body: { schemaVersion: 1, ...input },
            idempotencyKey: input?.id,
            signal,
        });
    }

    async function listChapters(projectId, signal) {
        return request('GET', chapterPath(projectId), { signal });
    }

    async function createChapter(projectId, input, signal) {
        return request('POST', chapterPath(projectId), {
            body: { schemaVersion: 1, ...input },
            idempotencyKey: input?.id,
            signal,
        });
    }

    async function listScenes(projectId, signal) {
        return request('GET', scenePath(projectId), { signal });
    }

    async function createScene(projectId, input, signal) {
        return request('POST', scenePath(projectId), {
            body: { schemaVersion: 1, ...input },
            idempotencyKey: input?.id,
            signal,
        });
    }

    async function getWorldBible(projectId, signal) {
        return request('GET', `${projectPath(projectId)}/world-bible`, { signal });
    }

    async function validateWorldBible(projectId, signal) {
        return request('POST', `${projectPath(projectId)}/world-bible/validate`, {
            body: { schemaVersion: 1 },
            signal,
        });
    }

    async function applyWorldBibleCommand(projectId, command, signal) {
        return request('POST', `${projectPath(projectId)}/world-bible/commands`, {
            body: command,
            idempotencyKey: command?.commandId,
            signal,
        });
    }

    async function proposeWorldGuide(projectId, input, signal) {
        return request('POST', `${projectPath(projectId)}/world-guide/proposals`, {
            body: { schemaVersion: 1, actorId, ...input },
            signal,
        });
    }

    async function confirmWorldGuide(projectId, input, signal) {
        return request('POST', `${projectPath(projectId)}/world-guide/confirm`, {
            body: { schemaVersion: 1, actorId, ...input },
            idempotencyKey: input?.suggestionId || input?.proposalId,
            signal,
        });
    }

    async function previewCharacterImport(projectId, input, signal) {
        const sourceKind = requireCharacterImportKind(input?.sourceKind);
        return request('POST', `${characterImportPath(projectId, sourceKind)}/preview`, {
            body: {
                schemaVersion: 1,
                actorId,
                sourceDocument: requireDocument(input?.sourceDocument),
                sourceName: typeof input?.sourceName === 'string' ? input.sourceName : null,
            },
            signal,
        });
    }

    async function confirmCharacterImport(projectId, input, signal) {
        const sourceKind = requireCharacterImportKind(input?.sourceKind);
        return request('POST', `${characterImportPath(projectId, sourceKind)}/confirm`, {
            body: {
                schemaVersion: 1,
                actorId,
                importId: requireId(input?.importId, 'Import ID'),
                sourceDigest: requireDigest(input?.sourceDigest),
                sourceDocument: requireDocument(input?.sourceDocument),
                sourceName: typeof input?.sourceName === 'string' ? input.sourceName : null,
                mappingOverrides: input?.mappingOverrides ?? {},
            },
            idempotencyKey: input?.importId,
            signal,
        });
    }

    async function getCharacterImport(projectId, sourceKind, sourceDigest, signal) {
        requireDigest(sourceDigest);
        return request(
            'GET',
            `${characterImportPath(projectId, requireCharacterImportKind(sourceKind))}/${sourceDigest}`,
            { signal },
        );
    }

    async function previewWorldInfoImport(projectId, input, signal) {
        return request('POST', `${worldInfoImportPath(projectId)}/preview`, {
            body: {
                schemaVersion: 1,
                actorId,
                sourceDocument: requireDocument(input?.sourceDocument),
                sourceName: typeof input?.sourceName === 'string' ? input.sourceName : null,
            },
            signal,
        });
    }

    async function confirmWorldInfoImport(projectId, input, signal) {
        return request('POST', `${worldInfoImportPath(projectId)}/confirm`, {
            body: {
                schemaVersion: 1,
                actorId,
                importId: requireId(input?.importId, 'Import ID'),
                sourceDigest: requireDigest(input?.sourceDigest),
                sourceDocument: requireDocument(input?.sourceDocument),
                sourceName: typeof input?.sourceName === 'string' ? input.sourceName : null,
                mappingOverrides: input?.mappingOverrides ?? { entries: [] },
            },
            idempotencyKey: input?.importId,
            signal,
        });
    }

    async function getWorldInfoImport(projectId, sourceDigest, signal) {
        requireDigest(sourceDigest);
        return request('GET', `${worldInfoImportPath(projectId)}/${sourceDigest}`, { signal });
    }

    async function previewChatImport(projectId, input, signal) {
        const sourceKind = requireChatImportKind(input?.sourceKind);
        return request('POST', `${chatImportPath(projectId, sourceKind)}/preview`, {
            body: {
                schemaVersion: 1,
                actorId,
                sourceDocument: requireDocument(input?.sourceDocument),
                sourceName: typeof input?.sourceName === 'string' ? input.sourceName : null,
            },
            signal,
        });
    }

    async function confirmChatImport(projectId, input, signal) {
        const sourceKind = requireChatImportKind(input?.sourceKind);
        const result = await request('POST', `${chatImportPath(projectId, sourceKind)}/confirm`, {
            body: {
                schemaVersion: 1,
                actorId,
                importId: requireId(input?.importId, 'Import ID'),
                sourceDigest: requireDigest(input?.sourceDigest),
                sourceDocument: requireDocument(input?.sourceDocument),
                sourceName: typeof input?.sourceName === 'string' ? input.sourceName : null,
                mappingOverrides: input?.mappingOverrides ?? { messages: [] },
            },
            idempotencyKey: input?.importId,
            signal,
        });
        if (
            !result || typeof result !== 'object' || Array.isArray(result)
            || result.projectId !== projectId
            || !OPAQUE_ID.test(result.branchId)
        ) {
            throw new Error('Novel Runtime returned an invalid chat import branch.');
        }
        return result;
    }

    async function getChatImport(projectId, sourceKind, sourceDigest, signal) {
        requireDigest(sourceDigest);
        return request(
            'GET',
            `${chatImportPath(projectId, requireChatImportKind(sourceKind))}/${sourceDigest}`,
            { signal },
        );
    }

    async function listWorldInfoReviewItems(projectId, signal) {
        return request('GET', `${worldInfoImportPath(projectId)}/review-items`, { signal });
    }

    async function reviewWorldInfoItem(projectId, reviewItemId, input, signal) {
        if (!['accept', 'reject'].includes(input?.decision)) {
            throw new TypeError('World Info review decision must be accept or reject.');
        }
        if (typeof input?.note !== 'string' || !input.note.trim()) {
            throw new TypeError('World Info review note is required.');
        }
        return request('POST', `${worldInfoImportPath(projectId)}/review-items/${encodeId(reviewItemId, 'Review item ID')}`, {
            body: {
                schemaVersion: 1,
                actorId,
                decision: input.decision,
                note: input.note.trim(),
            },
            idempotencyKey: `${reviewItemId}-${input.decision}`,
            signal,
        });
    }

    async function getWorldSnapshot(projectId, branchId, signal) {
        return request('GET', `${projectPath(projectId)}/world-snapshot`, {
            query: branchId ? { branchId: requireId(branchId, 'Branch ID') } : undefined,
            signal,
        });
    }

    async function getWorkspaceView(projectId, {
        audience = 'player',
        branchId = null,
    } = {}, signal) {
        if (!['author', 'player'].includes(audience)) {
            throw new TypeError('Workspace audience must be author or player.');
        }
        return request('GET', `${projectPath(projectId)}/workspace/view`, {
            query: {
                audience,
                branchId: branchId ? requireId(branchId, 'Branch ID') : undefined,
            },
            signal,
        });
    }

    async function getRecallDiagnostic(projectId, {
        audience = 'player',
        branchId = null,
        contextPackId = null,
        povEntityId = null,
    } = {}, signal) {
        if (!['author', 'player'].includes(audience)) {
            throw new TypeError('Recall audience must be author or player.');
        }
        return request('GET', `${projectPath(projectId)}/workspace/recall`, {
            query: {
                audience,
                branchId: branchId ? requireId(branchId, 'Branch ID') : undefined,
                contextPackId: contextPackId ? requireId(contextPackId, 'Context Pack ID') : undefined,
                povEntityId: povEntityId ? requireId(povEntityId, 'POV entity ID') : undefined,
            },
            signal,
        });
    }

    async function getBranch(projectId, branchId, signal) {
        return request('GET', `${projectPath(projectId)}/branches/${encodeId(branchId, 'Branch ID')}`, { signal });
    }

    async function bootstrap(projectId, input, signal) {
        return request('POST', `${projectPath(projectId)}/workspace/bootstrap`, {
            body: { schemaVersion: 1, actorId, ...input },
            idempotencyKey: input?.bootstrapId,
            signal,
        });
    }

    return Object.freeze({
        listProjects,
        getProject,
        createProject,
        listChapters,
        createChapter,
        listScenes,
        createScene,
        getWorldBible,
        validateWorldBible,
        applyWorldBibleCommand,
        proposeWorldGuide,
        confirmWorldGuide,
        previewCharacterImport,
        confirmCharacterImport,
        getCharacterImport,
        previewWorldInfoImport,
        confirmWorldInfoImport,
        getWorldInfoImport,
        listWorldInfoReviewItems,
        reviewWorldInfoItem,
        previewChatImport,
        confirmChatImport,
        getChatImport,
        getWorldSnapshot,
        getWorkspaceView,
        getRecallDiagnostic,
        getBranch,
        bootstrap,
    });
}
