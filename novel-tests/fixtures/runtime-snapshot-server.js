import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.NOVEL_RUNTIME_FIXTURE_PORT || 8787);
const sharedToken = 'sharedsessiontoken0123456789ABCDEFGHijklm';
const sharedSession = {
    schemaVersion: 1,
    sessionId: 'session-shared',
    releaseId: 'release-shared',
    projectId: 'project-workspace',
    branchId: 'branch-session-shared',
    headCommitId: 'commit-restored',
    lastEventId: null,
    revision: 0,
    status: 'active',
    audience: 'player',
    povEntityId: 'entity-player-pov',
    activeTurnId: null,
    lastTurnId: null,
    turnStage: 'idle',
    renderCursor: { lastEventId: null, lastSeq: -1 },
    stageSnapshot: { turnId: null, stage: 'idle', lastRender: null },
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
};
let sharedLastTurnId = null;
let sharedRecoveryEvents = [];

const golden = {
    project: null,
    chapters: [],
    scenes: [],
    guide: null,
    world: {
        projectId: null,
        status: 'draft',
        revision: 0,
        lockedRevision: null,
        validation: { complete: false, issues: [{ code: 'WORLD_EMPTY', message: 'World guide has not been confirmed.', itemId: null, itemType: null, path: [] }] },
        items: [],
        conflicts: [],
    },
    branch: null,
    turn: null,
};

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function requestBody(request) {
    return new Promise((resolve) => {
        if (request.method !== 'POST') return resolve({});
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            if (!chunks.length) return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                resolve({});
            }
        });
    });
}

function goldenProjectView(audience = 'author') {
    const project = golden.project;
    if (!project) return null;
    const items = audience === 'author'
        ? golden.world.items
        : golden.world.items.filter(item => item.reviewStatus === 'approved' && item.itemType !== 'author_truth');
    const povOptions = items
        .filter(item => item.itemType === 'entity' && item.payload?.entityType === 'character')
        .map(item => ({
            id: item.payload.entityId,
            name: item.payload.canonicalName || item.title,
            visibility: ['author', 'player'],
            role: 'playable',
        }));
    return {
        schemaVersion: 1,
        projectId: project.id,
        access: {
            role: 'author',
            audience,
            canEditWorld: audience === 'author',
            canDirect: audience === 'author',
            canPreviewPlayer: true,
            canUseDirect: audience === 'author',
        },
        project: clone(project),
        chapters: clone(golden.chapters),
        scenes: clone(golden.scenes),
        branch: clone(golden.branch),
        world: clone({ ...golden.world, items }),
        povOptions,
        selectedPovEntityId: null,
        guide: clone(golden.guide),
        director: audience === 'author' ? { groups: { chapterGoals: [], characterArcs: [], foreshadows: [], tasks: [], truths: [], readerDisclosures: [] }, snapshot: null } : null,
        performance: {
            routes: items.filter(item => item.itemType === 'opening_route').map(item => ({ id: item.id, ...clone(item.payload), title: item.title })),
            packs: [],
            activePack: null,
        },
    };
}

function goldenWorldResponse(commandId = null) {
    return {
        schemaVersion: 1,
        ok: true,
        data: commandId
            ? { schemaVersion: 1, commandId, replayed: false, world: clone(golden.world) }
            : clone(golden.world),
    };
}

function advanceGoldenWorld(mutator) {
    golden.world.revision += 1;
    mutator();
    for (const [index, item] of golden.world.items.entries()) {
        if (item.revision == null) item.revision = index + 1;
    }
    golden.world.validation = golden.world.items.length
        ? { complete: true, issues: [] }
        : { complete: false, issues: [{ code: 'WORLD_EMPTY', message: 'World guide has not been confirmed.', itemId: null, itemType: null, path: [] }] };
}

function goldenTurnEvents(turnId, includeCommitted = false) {
    const events = [
        { schema_version: 1, event_id: `golden-${turnId}-accepted`, turn_id: turnId, seq: 0, audience: 'author', render: { schemaVersion: 1, type: 'turn.accepted', payload: { baseCommitId: golden.branch?.headCommitId || 'commit-golden-base', mode: 'cowrite' } } },
        { schema_version: 1, event_id: `golden-${turnId}-planning`, turn_id: turnId, seq: 1, audience: 'author', render: { schemaVersion: 1, type: 'stage.changed', payload: { stage: 'planning' } } },
        { schema_version: 1, event_id: `golden-${turnId}-plan`, turn_id: turnId, seq: 2, audience: 'author', render: { schemaVersion: 1, type: 'plan.ready', payload: { plan: { turnId, intent: 'Continue through the sealed archive.' } } } },
        { schema_version: 1, event_id: `golden-${turnId}-writing`, turn_id: turnId, seq: 3, audience: 'author', render: { schemaVersion: 1, type: 'stage.changed', payload: { stage: 'writing' } } },
        { schema_version: 1, event_id: `golden-${turnId}-prose`, turn_id: turnId, seq: 4, audience: 'author', render: { schemaVersion: 1, type: 'prose.delta', payload: { blockId: 'block-golden-1', delta: 'The archivist crossed the rain-dark threshold.', provisional: true } } },
        { schema_version: 1, event_id: `golden-${turnId}-validate`, turn_id: turnId, seq: 5, audience: 'author', render: { schemaVersion: 1, type: 'stage.changed', payload: { stage: 'validating' } } },
        { schema_version: 1, event_id: `golden-${turnId}-preview`, turn_id: turnId, seq: 6, audience: 'author', render: { schemaVersion: 1, type: 'state.preview', payload: { commands: [{ turnId, type: 'UpdateEntityState', entityId: 'entity-golden-pov' }] } } },
        { schema_version: 1, event_id: `golden-${turnId}-approval`, turn_id: turnId, seq: 7, audience: 'author', render: { schemaVersion: 1, type: 'turn.awaiting_approval', payload: { summary: 'A provisional passage is ready for author approval.', blockingIssueCount: 0 } } },
    ];
    if (includeCommitted) {
        events.push({
            schema_version: 1,
            event_id: `golden-${turnId}-committed`,
            turn_id: turnId,
            seq: 8,
            audience: 'author',
            render: { schemaVersion: 1, type: 'turn.committed', payload: { commitId: 'commit-golden-1', committedAt: '2026-07-18T00:02:00.000Z' } },
        });
        events.push({
            schema_version: 1,
            event_id: `golden-${turnId}-projection`,
            turn_id: turnId,
            seq: 9,
            audience: 'author',
            render: { schemaVersion: 1, type: 'projection.updated', payload: { committed: true, projectionVersion: 2, commitId: 'commit-golden-1', changedEntityIds: ['entity-golden-pov'] } },
        });
    }
    return events;
}

function currentSharedSession({ includeRecovery = false } = {}) {
    if (!sharedLastTurnId) return {
        ...sharedSession,
        ...(includeRecovery ? { recoveryEvents: [], replayTruncated: false } : {}),
    };
    const lastRender = sharedRecoveryEvents.at(-1) ?? null;
    return {
        ...sharedSession,
        headCommitId: 'commit-shared-live',
        lastEventId: lastRender?.event_id ?? null,
        revision: 1,
        activeTurnId: null,
        lastTurnId: sharedLastTurnId,
        turnStage: 'committed',
        renderCursor: { lastEventId: lastRender?.event_id ?? null, lastSeq: lastRender?.seq ?? -1 },
        stageSnapshot: { turnId: sharedLastTurnId, stage: 'committed', lastRender },
        updatedAt: '2026-07-18T00:01:00.000Z',
        ...(includeRecovery ? { recoveryEvents: sharedRecoveryEvents, replayTruncated: false } : {}),
    };
}

function json(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer fixture-runtime-token') {
        return json(response, 401, {
            schemaVersion: 1,
            ok: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Fixture credential missing.',
                retryable: false,
                correlationId: 'fixture-auth',
            },
        });
    }
    const body = await requestBody(request);
    if (request.method === 'GET' && request.url === '/api/health') {
        return json(response, 200, { ok: true, service: 'novel-runtime' });
    }
    if (request.method === 'POST' && request.url === '/api/v1/projects') {
        const project = {
            schemaVersion: 1,
            id: body.id || 'project-golden',
            slug: body.slug || 'golden-path',
            title: body.title || 'Golden path story',
            status: body.status || 'draft',
            metadata: body.metadata || {},
        };
        golden.project = project;
        golden.chapters = [];
        golden.scenes = [];
        golden.guide = null;
        golden.world = {
            projectId: project.id,
            status: 'draft',
            revision: 0,
            lockedRevision: null,
            validation: { complete: false, issues: [{ code: 'WORLD_EMPTY', message: 'World guide has not been confirmed.', itemId: null, itemType: null, path: [] }] },
            items: [],
            conflicts: [],
        };
        golden.branch = null;
        golden.turn = null;
        return json(response, 201, { schemaVersion: 1, ok: true, data: project });
    }
    if (golden.project && request.method === 'POST' && request.url === `/api/v1/projects/${golden.project.id}/chapters`) {
        const chapter = { schemaVersion: 1, projectId: golden.project.id, ...body };
        golden.chapters.push(chapter);
        return json(response, 201, { schemaVersion: 1, ok: true, data: chapter });
    }
    if (golden.project && request.method === 'POST' && request.url === `/api/v1/projects/${golden.project.id}/scenes`) {
        const scene = { schemaVersion: 1, projectId: golden.project.id, ...body };
        golden.scenes.push(scene);
        return json(response, 201, { schemaVersion: 1, ok: true, data: scene });
    }
    if (golden.project && request.method === 'GET' && request.url === `/api/v1/projects/${golden.project.id}`) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: clone(golden.project) });
    }
    if (golden.project && request.method === 'GET' && request.url === `/api/v1/projects/${golden.project.id}/chapters`) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: clone(golden.chapters) });
    }
    if (golden.project && request.method === 'GET' && request.url === `/api/v1/projects/${golden.project.id}/scenes`) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: clone(golden.scenes) });
    }
    const goldenView = golden.project
        ? new RegExp(`^/api/v1/projects/${golden.project.id}/workspace/view\\?audience=(author|player)(?:&branchId=([A-Za-z0-9._:-]+))?$`).exec(request.url || '')
        : null;
    if (request.method === 'GET' && goldenView) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: goldenProjectView(goldenView[1]) });
    }
    const goldenWorldBible = golden.project
        ? `/api/v1/projects/${golden.project.id}/world-bible`
        : null;
    if (request.method === 'GET' && request.url === goldenWorldBible) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: clone(golden.world) });
    }
    if (golden.project && request.method === 'GET' && new RegExp(`^/api/v1/projects/${golden.project.id}/workspace/recall\\?`).test(request.url || '')) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: { schemaVersion: 1, available: false, access: { role: 'author', audience: 'author' }, entries: [] } });
    }
    if (golden.project && request.method === 'GET' && request.url === `/api/v1/projects/${golden.project.id}/branches/branch-golden`) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: clone(golden.branch) });
    }
    if (golden.project && request.method === 'GET' && request.url === `/api/v1/projects/${golden.project.id}/world-snapshot?branchId=branch-golden`) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: { snapshotHash: 'd'.repeat(64), branch: { headVersion: golden.branch?.headVersion || 1 }, fragments: [] } });
    }
    if (golden.project && request.method === 'POST' && request.url === `/api/v1/projects/${golden.project.id}/world-guide/proposals`) {
        golden.guide = {
            schemaVersion: 1,
            proposalId: 'proposal-golden-guide',
            projectId: golden.project.id,
            baseWorldRevision: golden.world.revision,
            model: { provider: 'fixture', model: 'deterministic-golden' },
            questions: [],
            suggestions: [
                {
                    suggestionId: 'suggestion-golden-entity',
                    rationale: 'A playable viewpoint anchors the first scene.',
                    confirmed: false,
                    item: {
                        id: 'entity-golden-pov',
                        itemType: 'entity',
                        title: 'Rain Archivist',
                        controlMode: 'tentative',
                        payload: { entityId: 'entity-golden-pov', entityType: 'character', canonicalName: 'Rain Archivist', summary: 'A careful archivist entering the sealed archive.' },
                    },
                },
                {
                    suggestionId: 'suggestion-golden-route',
                    rationale: 'The opening route establishes the first playable scene.',
                    confirmed: false,
                    item: {
                        id: 'route-golden-opening',
                        itemType: 'opening_route',
                        title: 'The sealed archive',
                        controlMode: 'tentative',
                        payload: { routeId: 'route-golden-opening', title: 'The sealed archive', sceneId: golden.scenes[0]?.id || null, premise: 'Rain seals the archive doors.', entryConditions: [] },
                    },
                },
            ],
        };
        return json(response, 201, { schemaVersion: 1, ok: true, data: clone(golden.guide) });
    }
    if (golden.project && request.method === 'POST' && request.url === `/api/v1/projects/${golden.project.id}/world-guide/confirm`) {
        const suggestionId = body.suggestionId;
        const suggestion = golden.guide?.suggestions?.find(item => item.suggestionId === suggestionId);
        if (!suggestion) return json(response, 404, { schemaVersion: 1, ok: false, error: { code: 'GUIDE_SUGGESTION_NOT_FOUND', message: 'Guide suggestion not found.' } });
        if (!golden.world.items.some(item => item.id === suggestion.item.id)) {
            advanceGoldenWorld(() => golden.world.items.push({
                schemaVersion: 1,
                recordClass: 'world_bible',
                projectId: golden.project.id,
                semanticClass: suggestion.item.itemType === 'entity' ? 'world_reference' : 'opening_route',
                source: { kind: 'model_suggestion', reference: 'proposal-golden-guide' },
                reviewStatus: 'approved',
                reviewNote: null,
                reviewedBy: 'fixture-author',
                createdBy: 'fixture-author',
                modifiedBy: 'fixture-author',
                updatedAt: '2026-07-18T00:00:00.000Z',
                createdAt: '2026-07-18T00:00:00.000Z',
                revision: golden.world.revision,
                conflicts: [],
                ...clone(suggestion.item),
            }));
        }
        suggestion.confirmed = true;
        return json(response, 201, { schemaVersion: 1, ok: true, data: { proposalId: golden.guide.proposalId, suggestionId, world: clone(golden.world), guide: clone(golden.guide) } });
    }
    if (golden.project && request.method === 'POST' && request.url === `/api/v1/projects/${golden.project.id}/world-bible/validate`) {
        golden.world.validation = { complete: golden.world.items.length >= 2, issues: golden.world.items.length >= 2 ? [] : [{ code: 'WORLD_INCOMPLETE', message: 'Confirm the viewpoint entity and opening route.', itemId: null, itemType: null, path: [] }] };
        return json(response, 200, goldenWorldResponse());
    }
    if (golden.project && request.method === 'POST' && request.url === `/api/v1/projects/${golden.project.id}/world-bible/commands`) {
        const command = body;
        if (command.type === 'ReplaceWorldBibleItem') {
            const index = golden.world.items.findIndex(item => item.id === command.item?.id);
            if (index < 0) return json(response, 404, { schemaVersion: 1, ok: false, error: { code: 'WORLD_BIBLE_ITEM_NOT_FOUND', message: 'World item not found.' } });
            advanceGoldenWorld(() => {
                const current = golden.world.items[index];
                golden.world.items[index] = {
                    ...current,
                    title: command.item.title,
                    payload: clone(command.item.payload),
                    source: clone(command.item.source),
                    modifiedBy: command.actorId || 'fixture-author',
                    revision: current.revision + 1,
                };
            });
        } else if (command.type === 'LockWorldBible') {
            golden.world.status = 'locked';
            golden.world.lockedRevision = golden.world.revision;
        } else if (command.type === 'ReopenWorldBible') {
            golden.world.status = 'draft';
            golden.world.lockedRevision = null;
        } else if (command.type === 'ReviewWorldBibleItem' || command.type === 'SetWorldBibleItemControl') {
            const item = golden.world.items.find(candidate => candidate.id === command.itemId);
            if (!item) return json(response, 404, { schemaVersion: 1, ok: false, error: { code: 'WORLD_BIBLE_ITEM_NOT_FOUND', message: 'World item not found.' } });
            advanceGoldenWorld(() => {
                if (command.type === 'ReviewWorldBibleItem') item.reviewStatus = command.reviewStatus;
                else item.controlMode = command.controlMode;
                item.revision += 1;
            });
        }
        return json(response, 200, goldenWorldResponse(command.commandId));
    }
    if (golden.project && request.method === 'POST' && request.url === `/api/v1/projects/${golden.project.id}/workspace/bootstrap`) {
        golden.branch ||= { id: 'branch-golden', projectId: golden.project.id, name: 'main', headCommitId: 'commit-golden-base', headVersion: 1, storyTick: 0 };
        return json(response, 201, { schemaVersion: 1, ok: true, data: { ready: true, branch: clone(golden.branch), povOptions: goldenProjectView('author').povOptions, selectedPovEntityId: null } });
    }
    if (golden.project && request.method === 'POST' && body.projectId === golden.project.id && request.url === '/api/v1/turns') {
        const turnId = body.turn?.id || 'turn-golden';
        golden.turn = { turnId, accepted: false, events: goldenTurnEvents(turnId, false) };
        return json(response, 201, { schemaVersion: 1, ok: true, data: { id: turnId, turn_id: turnId } });
    }
    const goldenEvents = golden.turn && new RegExp(`^/api/v1/turns/${golden.turn.turnId}/events\\?audience=author$`).test(request.url || '');
    if (request.method === 'GET' && goldenEvents) {
        const events = golden.turn.events;
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
        response.end(events.map(event => `id: ${event.event_id}\nevent: ${event.render.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
        return;
    }
    if (golden.turn && request.method === 'GET' && request.url?.startsWith(`/api/v1/turns/${golden.turn.turnId}/approval`)) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: { proposalId: 'proposal-golden-turn', attemptId: 'attempt-golden-turn', planId: 'plan-golden-turn', turnId: golden.turn.turnId, baseCommitId: 'commit-golden-base', digest: 'c'.repeat(64) } });
    }
    if (golden.turn && request.method === 'POST' && request.url === `/api/v1/turns/${golden.turn.turnId}/accept`) {
        golden.turn.accepted = true;
        golden.turn.events = goldenTurnEvents(golden.turn.turnId, true);
        golden.branch = { ...(golden.branch || {}), headCommitId: 'commit-golden-1', headVersion: 2, storyTick: 1 };
        return json(response, 200, { schemaVersion: 1, ok: true, data: { status: 'committed', commit: { commitId: 'commit-golden-1' } } });
    }
    if (golden.turn && request.method === 'GET' && request.url === `/api/v1/turns/${golden.turn.turnId}/snapshot`) {
        const events = golden.turn.accepted ? golden.turn.events : golden.turn.events;
        return json(response, 200, { schemaVersion: 1, ok: true, data: { turnId: golden.turn.turnId, lastEventId: events.at(-1)?.event_id || null, seq: events.at(-1)?.seq ?? -1, events } });
    }
    if (request.method === 'GET' && request.url === '/api/v1/releases/release-shared') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: {
                schemaVersion: 1,
                releaseId: 'release-shared',
                projectId: 'project-workspace',
                branchId: 'branch-main',
                headCommitId: 'commit-restored',
                contentHash: 'a'.repeat(64),
                manifestHash: 'b'.repeat(64),
                status: 'published',
                manifest: {
                    schemaVersion: 1,
                    projectId: 'project-workspace',
                    branchId: 'branch-main',
                    headCommitId: 'commit-restored',
                    title: 'Archive of Rain',
                    blocks: [{ blockId: 'block-shared', ordinal: 0, blockType: 'narration', speakerEntityId: null, proseText: 'Rain sealed the archive doors.' }],
                    chapters: [{ chapterId: 'chapter-workspace', ordinal: 0, title: 'Opening' }],
                    scenes: [{ sceneId: 'scene-workspace', chapterId: 'chapter-workspace', ordinal: 0, title: 'The sealed archive' }],
                    components: [{
                        componentId: 'component-shared',
                        componentType: 'narration',
                        componentVersion: 1,
                        visibility: ['player'],
                        revision: 0,
                        props: { text: 'Water traces old names across the glass.' },
                    }],
                    assets: [],
                    metadata: {},
                },
                createdAt: '2026-07-18T00:00:00.000Z',
            },
        });
    }
    if (request.method === 'GET' && request.url === `/api/v1/share/${sharedToken}`) {
        return json(response, 200, { schemaVersion: 1, ok: true, data: currentSharedSession() });
    }
    if (request.method === 'GET' && /^\/api\/v1\/sessions\/session-shared\/reconnect(?:\?.*)?$/.test(request.url || '')) {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: currentSharedSession({ includeRecovery: true }),
        });
    }
    if (request.method === 'POST' && request.url === '/api/v1/turns') {
        return json(response, 201, {
            schemaVersion: 1,
            ok: true,
            data: { id: 'stream-shared-turn' },
        });
    }
    const sharedTurnEvents = /^\/api\/v1\/turns\/([A-Za-z0-9._:-]+)\/events\?audience=player$/.exec(request.url || '');
    if (request.method === 'GET' && sharedTurnEvents) {
        const turnId = sharedTurnEvents[1];
        const events = [
            { schema_version: 1, event_id: 'event-shared-0', turn_id: turnId, seq: 0, audience: 'player', render: { schemaVersion: 1, type: 'turn.accepted', payload: { baseCommitId: 'commit-restored', mode: 'play' } } },
            { schema_version: 1, event_id: 'event-shared-1', turn_id: turnId, seq: 1, audience: 'player', render: { schemaVersion: 1, type: 'prose.delta', payload: { blockId: 'block-shared-live', delta: 'The archive answered with a low metallic sigh.', provisional: true } } },
            { schema_version: 1, event_id: 'event-shared-2', turn_id: turnId, seq: 2, audience: 'player', render: { schemaVersion: 1, type: 'turn.committed', payload: { commitId: 'commit-shared-live', committedAt: '2026-07-18T00:01:00.000Z' } } },
        ];
        sharedLastTurnId = turnId;
        sharedRecoveryEvents = events;
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
        response.end(events.map(event => `id: ${event.event_id}\nevent: ${event.render.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
        return;
    }
    if (request.method === 'GET' && request.url === '/api/v1/projects') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: [
                { id: 'project-workspace', slug: 'workspace', title: 'Archive of Rain', status: 'active', metadata: {} },
                ...(golden.project ? [clone(golden.project)] : []),
            ],
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/projects/project-workspace') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: { id: 'project-workspace', slug: 'workspace', title: 'Archive of Rain', status: 'active', metadata: {} },
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/projects/project-workspace/chapters') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: [{ id: 'chapter-workspace', projectId: 'project-workspace', ordinal: 0, title: 'Opening', status: 'active', metadata: {} }],
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/projects/project-workspace/scenes') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: [{ id: 'scene-workspace', projectId: 'project-workspace', chapterId: 'chapter-workspace', ordinal: 0, title: 'The sealed archive', status: 'active', startsAtStoryTick: 0, endsAtStoryTick: null, metadata: {} }],
        });
    }
    const workspaceView = /^\/api\/v1\/projects\/project-workspace\/workspace\/view\?audience=(author|player)(?:&branchId=branch-main)?$/.exec(request.url || '');
    if (request.method === 'GET' && workspaceView) {
        const audience = workspaceView[1];
        const role = request.headers['x-novel-actor-role'] === 'player' ? 'player' : 'author';
        const items = [
            {
                schemaVersion: 1,
                recordClass: 'world_bible_item',
                projectId: 'project-workspace',
                id: 'route-workspace',
                itemType: 'opening_route',
                semanticClass: 'opening_route',
                title: 'The sealed archive',
                controlMode: 'tentative',
                reviewStatus: 'approved',
                revision: 1,
                payload: { routeId: 'opening-workspace', title: 'The sealed archive', sceneId: 'scene-workspace', premise: 'Rain seals the archive.', entryConditions: [] },
                conflicts: [],
            },
            {
                schemaVersion: 1,
                recordClass: 'world_bible_item',
                projectId: 'project-workspace',
                id: 'entity-player-pov',
                itemType: 'entity',
                semanticClass: 'entity',
                title: 'Rain Archivist',
                controlMode: 'tentative',
                reviewStatus: 'approved',
                revision: 1,
                payload: {
                    entityId: 'entity-player-pov',
                    entityType: 'character',
                    canonicalName: 'Rain Archivist',
                    summary: 'The viewpoint character at the sealed archive.',
                },
                conflicts: [],
            },
            ...(audience === 'author' ? [{
                schemaVersion: 1,
                recordClass: 'world_bible_item',
                projectId: 'project-workspace',
                id: 'truth-workspace',
                itemType: 'author_truth',
                semanticClass: 'author_truth',
                title: 'Hidden culprit',
                controlMode: 'locked',
                reviewStatus: 'approved',
                revision: 1,
                payload: { claimId: 'claim-workspace', canonicalTruth: 'true' },
                conflicts: [],
            }] : []),
        ];
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: {
                schemaVersion: 1,
                projectId: 'project-workspace',
                access: {
                    role,
                    audience,
                    canEditWorld: role === 'author' && audience === 'author',
                    canDirect: role === 'author' && audience === 'author',
                    canPreviewPlayer: role === 'author',
                    canUseDirect: role === 'author' && audience === 'author',
                },
                project: { id: 'project-workspace', slug: 'workspace', title: 'Archive of Rain', status: 'active', metadata: {} },
                chapters: [{ id: 'chapter-workspace', projectId: 'project-workspace', ordinal: 0, title: 'Opening', status: 'active', metadata: {} }],
                scenes: [{ id: 'scene-workspace', projectId: 'project-workspace', chapterId: 'chapter-workspace', ordinal: 0, title: 'The sealed archive', status: 'active', startsAtStoryTick: 0, endsAtStoryTick: null, metadata: {} }],
                branch: { id: 'branch-main', projectId: 'project-workspace', name: 'main', headCommitId: audience === 'author' ? 'commit-restored' : null, headVersion: 1, storyTick: 0 },
                world: { projectId: 'project-workspace', status: 'locked', revision: 3, lockedRevision: 3, validation: { complete: true, issues: [] }, items, conflicts: [] },
                povOptions: [{ id: 'entity-player-pov', name: 'Rain Archivist', visibility: ['author', 'player'], role: 'playable' }],
                selectedPovEntityId: null,
                director: audience === 'author' ? { groups: { chapterGoals: [], characterArcs: [], foreshadows: [], tasks: [], truths: items.slice(1), readerDisclosures: [] }, snapshot: null } : null,
                performance: { routes: [{ id: 'route-workspace', routeId: 'opening-workspace', title: 'The sealed archive', sceneId: 'scene-workspace', premise: 'Rain seals the archive.', entryConditions: [] }], packs: [], activePack: null },
            },
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/projects/project-workspace/world-bible') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: {
                projectId: 'project-workspace',
                status: 'locked',
                revision: 3,
                items: [
                    { id: 'route-workspace', itemType: 'opening_route', semanticClass: 'opening_route', title: 'The sealed archive', controlMode: 'tentative', reviewStatus: 'approved', payload: { routeId: 'opening-workspace', title: 'The sealed archive', sceneId: 'scene-workspace', premise: 'Rain seals the archive.', entryConditions: [] } },
                    { id: 'truth-workspace', itemType: 'author_truth', semanticClass: 'author_truth', title: 'Hidden culprit', controlMode: 'locked', reviewStatus: 'approved', payload: { claimId: 'claim-workspace', canonicalTruth: 'true' } },
                ],
                validation: { complete: true, issues: [] },
            },
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/projects/project-workspace/branches/branch-main') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: { id: 'branch-main', projectId: 'project-workspace', name: 'main', headCommitId: 'commit-restored', headVersion: 1, storyTick: 0 },
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/projects/project-workspace/world-snapshot?branchId=branch-main') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: { snapshotHash: 'a'.repeat(64), branch: { headVersion: 1 }, fragments: [] },
        });
    }
    if (request.method === 'POST' && request.url === '/api/v1/projects/project-workspace/workspace/bootstrap') {
        return json(response, 201, {
            schemaVersion: 1,
            ok: true,
            data: { ready: true, branch: { id: 'branch-main', projectId: 'project-workspace', name: 'main', headCommitId: 'commit-restored', headVersion: 1, storyTick: 0 } },
        });
    }
    if (request.method === 'GET' && request.url === '/api/v1/turns/turn-recovery/snapshot') {
        return json(response, 200, {
            schemaVersion: 1,
            ok: true,
            data: {
                turnId: 'turn-recovery',
                lastEventId: 'event-2',
                seq: 2,
                events: [
                    {
                        schema_version: 1,
                        event_id: 'event-0',
                        turn_id: 'turn-recovery',
                        seq: 0,
                        audience: 'author',
                        render: {
                            schemaVersion: 1,
                            type: 'prose.delta',
                            payload: {
                                blockId: 'block-1',
                                delta: 'Recovered committed passage.',
                                provisional: true,
                            },
                        },
                    },
                    {
                        schema_version: 1,
                        event_id: 'event-1',
                        turn_id: 'turn-recovery',
                        seq: 1,
                        audience: 'author',
                        render: {
                            schemaVersion: 1,
                            type: 'turn.committed',
                            payload: {
                                commitId: 'commit-restored',
                                committedAt: '2026-07-17T00:00:00.000Z',
                            },
                        },
                    },
                ],
            },
        });
    }
    return json(response, 404, {
        schemaVersion: 1,
        ok: false,
        error: {
            code: 'NOT_FOUND',
            message: 'Fixture route not found.',
            retryable: false,
            correlationId: 'fixture-not-found',
        },
    });
});

server.listen(port, host, () => {
    console.log(`Novel Runtime snapshot fixture listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
}
