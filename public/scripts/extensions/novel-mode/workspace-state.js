const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const WORKSPACE_TABS = Object.freeze(['story', 'world', 'director']);
export const ONBOARDING_STEPS = Object.freeze(['inspiration', 'guide', 'lock', 'opening', 'stage']);

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function optionalId(value) {
    return typeof value === 'string' && OPAQUE_ID.test(value) ? value : null;
}

function list(value) {
    return Array.isArray(value) ? value.map(clone) : [];
}

export function createInitialWorkspaceState() {
    return {
        activeTab: 'story',
        audience: 'author',
        access: {
            role: null,
            canEditWorld: false,
            canDirect: false,
            canPreviewPlayer: false,
            canUseDirect: false,
        },
        projects: [],
        project: null,
        chapters: [],
        scenes: [],
        branch: null,
        world: null,
        povOptions: [],
        selectedPovEntityId: null,
        workbench: null,
        director: null,
        performance: { routes: [], packs: [], activePack: null },
        recall: { available: false, entries: [] },
        guide: null,
        openingRoutes: [],
        openingRoute: null,
        selection: {
            chapterId: null,
            sceneId: null,
        },
        stage: {
            turnId: null,
            commitId: null,
            text: '',
            components: [],
            status: 'idle',
        },
        onboarding: 'inspiration',
        busy: false,
        error: null,
    };
}

export function deriveOnboardingStep({ project, guide, world, openingRoute } = {}) {
    if (!project) return 'inspiration';
    if (world?.status === 'locked') {
        if (!openingRoute) return 'opening';
        return 'stage';
    }
    if (!guide) return 'guide';
    return 'lock';
}

export function isAuthorOnlyRecord(record) {
    if (!record || typeof record !== 'object') return false;
    const visibility = record.visibility || record.payload?.visibility;
    const semanticClass = record.semanticClass || record.itemType;
    return visibility === 'author' || visibility === 'private' || semanticClass === 'author_truth';
}

export function canDisplayRecord(record, audience = 'author') {
    if (audience !== 'author' && audience !== 'player') return false;
    return audience === 'author' || !isAuthorOnlyRecord(record);
}

export function worldOpeningRoutes(world) {
    return list(world?.items)
        .filter(item => item?.itemType === 'opening_route' && item.payload)
        .map(item => ({
            id: item.id,
            title: item.title || item.payload.title,
            ...clone(item.payload),
            reviewStatus: item.reviewStatus || 'draft',
            controlMode: item.controlMode || 'tentative',
        }))
        .filter(route => optionalId(route.routeId));
}

export function reduceWorkspaceState(previous, event) {
    const state = previous ? clone(previous) : createInitialWorkspaceState();
    if (!event || typeof event !== 'object') return state;

    switch (event.type) {
        case 'tab.selected':
            if (WORKSPACE_TABS.includes(event.tab)) state.activeTab = event.tab;
            break;
        case 'audience.changed':
            if (
                (event.audience === 'author' || event.audience === 'player')
                && !(state.access.role === 'player' && event.audience === 'author')
            ) state.audience = event.audience;
            break;
        case 'projects.loaded':
            state.projects = list(event.projects);
            break;
        case 'project.bound':
            {
                const previousRouteId = state.project?.id === event.project?.id
                    ? state.openingRoute?.routeId
                    : null;
                state.project = clone(event.project) || null;
                state.chapters = list(event.chapters);
                state.scenes = list(event.scenes);
                state.branch = clone(event.branch) || null;
                state.world = clone(event.world) || null;
                state.povOptions = list(event.workbench?.povOptions);
                state.selectedPovEntityId = optionalId(event.workbench?.selectedPovEntityId);
                state.workbench = clone(event.workbench) || null;
                state.access = {
                    ...state.access,
                    ...(clone(event.workbench?.access) || {}),
                };
                state.audience = event.workbench?.access?.audience || state.audience;
                state.director = clone(event.workbench?.director) || null;
                state.performance = clone(event.workbench?.performance)
                    || { routes: [], packs: [], activePack: null };
                state.recall = { available: false, entries: [] };
                state.guide = clone(event.guide) || null;
                state.openingRoutes = worldOpeningRoutes(state.world);
                state.openingRoute = clone(event.openingRoute)
                    || state.openingRoutes.find(route => route.routeId === event.routeId)
                    || state.openingRoutes.find(route => route.routeId === previousRouteId)
                    || null;
                const selectedSceneId = state.openingRoute?.sceneId || state.scenes[0]?.id || null;
                const selectedScene = state.scenes.find(scene => scene.id === selectedSceneId);
                state.selection = {
                    chapterId: selectedScene?.chapterId || state.chapters[0]?.id || null,
                    sceneId: selectedSceneId,
                };
                state.onboarding = deriveOnboardingStep({
                    project: state.project,
                    guide: state.guide,
                    world: state.world,
                    openingRoute: state.openingRoute,
                    stage: state.stage,
                });
                state.error = null;
                break;
            }
        case 'workbench.loaded':
            state.workbench = clone(event.workbench) || null;
            state.access = {
                ...state.access,
                ...(clone(event.workbench?.access) || {}),
            };
            state.audience = event.workbench?.access?.audience || state.audience;
            state.project = clone(event.workbench?.project || state.project);
            state.chapters = list(event.workbench?.chapters || state.chapters);
            state.scenes = list(event.workbench?.scenes || state.scenes);
            if (event.workbench && Object.hasOwn(event.workbench, 'branch')) {
                state.branch = clone(event.workbench.branch) || null;
            }
            state.world = clone(event.workbench?.world || state.world);
            if (event.workbench && Object.hasOwn(event.workbench, 'povOptions')) {
                state.povOptions = list(event.workbench.povOptions);
            }
            if (event.workbench && Object.hasOwn(event.workbench, 'selectedPovEntityId')) {
                state.selectedPovEntityId = optionalId(event.workbench.selectedPovEntityId);
            }
            state.director = clone(event.workbench?.director) || null;
            state.performance = clone(event.workbench?.performance)
                || { routes: [], packs: [], activePack: null };
            state.openingRoutes = worldOpeningRoutes(state.world);
            if (state.openingRoute) {
                state.openingRoute = state.openingRoutes.find(
                    route => route.routeId === state.openingRoute.routeId,
                ) || null;
            }
            state.error = null;
            break;
        case 'recall.loaded':
            state.recall = clone(event.recall) || { available: false, entries: [] };
            state.error = null;
            break;
        case 'guide.proposed':
            state.guide = clone(event.guide);
            state.onboarding = deriveOnboardingStep({ ...state, guide: state.guide });
            state.error = null;
            break;
        case 'guide.confirmed':
            state.guide = clone(event.guide || state.guide);
            if (event.suggestionId && state.guide?.suggestions) {
                state.guide.suggestions = state.guide.suggestions.map(suggestion => (
                    suggestion.suggestionId === event.suggestionId
                        ? { ...suggestion, confirmed: true }
                        : suggestion
                ));
            }
            state.world = clone(event.world || state.world);
            state.openingRoutes = worldOpeningRoutes(state.world);
            state.onboarding = deriveOnboardingStep({ ...state, guide: state.guide, world: state.world });
            state.error = null;
            break;
        case 'world.loaded':
            state.world = clone(event.world);
            state.openingRoutes = worldOpeningRoutes(state.world);
            state.onboarding = deriveOnboardingStep({ ...state, world: state.world });
            state.error = null;
            break;
        case 'world.locked':
            state.world = clone(event.world || { ...state.world, status: 'locked' });
            state.openingRoutes = worldOpeningRoutes(state.world);
            state.onboarding = deriveOnboardingStep({ ...state, world: state.world });
            state.error = null;
            break;
        case 'opening.selected':
            state.openingRoute = clone(event.route);
            if (event.route?.sceneId) {
                const scene = state.scenes.find(item => item.id === event.route.sceneId);
                state.selection.sceneId = event.route.sceneId;
                if (scene?.chapterId) state.selection.chapterId = scene.chapterId;
            }
            state.onboarding = deriveOnboardingStep({ ...state, openingRoute: state.openingRoute });
            state.error = null;
            break;
        case 'chapter.selected': {
            if (state.chapters.some(chapter => chapter.id === event.chapterId)) {
                state.selection.chapterId = event.chapterId;
                const scene = state.scenes.find(item => item.chapterId === event.chapterId);
                state.selection.sceneId = scene?.id || null;
                if (state.openingRoute?.sceneId && state.openingRoute.sceneId !== state.selection.sceneId) {
                    state.openingRoute = null;
                    state.onboarding = deriveOnboardingStep(state);
                }
            }
            break;
        }
        case 'scene.selected': {
            const scene = state.scenes.find(item => item.id === event.sceneId);
            if (scene) {
                state.selection.sceneId = scene.id;
                if (scene.chapterId) state.selection.chapterId = scene.chapterId;
                if (state.openingRoute?.sceneId && state.openingRoute.sceneId !== scene.id) {
                    state.openingRoute = null;
                    state.onboarding = deriveOnboardingStep(state);
                }
            }
            break;
        }
        case 'branch.loaded':
            state.branch = clone(event.branch);
            break;
        case 'stage.updated':
            state.stage = {
                ...state.stage,
                ...clone(event.stage),
            };
            state.onboarding = deriveOnboardingStep({ ...state, stage: state.stage });
            break;
        case 'busy.changed':
            state.busy = Boolean(event.busy);
            break;
        case 'error.changed':
            state.error = event.error ? String(event.error) : null;
            state.busy = false;
            break;
        case 'reset':
            return createInitialWorkspaceState();
        default:
            break;
    }
    return state;
}

export function projectBinding(state) {
    const projectId = optionalId(state?.project?.id);
    const sceneId = optionalId(state?.openingRoute?.sceneId || state?.selection?.sceneId);
    const scene = state?.scenes?.find(item => item.id === sceneId);
    const chapterId = optionalId(scene?.chapterId || state?.selection?.chapterId);
    const branchId = optionalId(state?.branch?.id || state?.branch?.branchId);
    if (!projectId || !chapterId || !sceneId || !branchId) return null;
    return { projectId, branchId, chapterId, sceneId };
}

export function canAuthorWorkspace(state) {
    return state?.audience === 'author'
        && state?.access?.role === 'author'
        && state?.access?.canEditWorld === true;
}

export function publicWorkspaceState(state, audience = state?.audience || 'author') {
    const result = clone(state || createInitialWorkspaceState());
    result.audience = audience;
    if (audience === 'player') {
        result.guide = null;
        result.world = result.world
            ? {
                ...result.world,
                items: list(result.world.items).filter(item => canDisplayRecord(item, audience)),
            }
            : null;
        result.branch = result.branch ? { ...result.branch, headCommitId: null } : null;
        result.director = null;
        result.access = {
            role: result.access?.role || 'player',
            canEditWorld: false,
            canDirect: false,
            canPreviewPlayer: result.access?.role === 'author',
            canUseDirect: false,
        };
        result.recall = {
            ...result.recall,
            entries: list(result.recall?.entries).map(entry => ({
                fragmentId: entry.fragmentId,
                recordType: entry.recordType,
                recallReason: entry.recallReason,
                tokenCount: entry.tokenCount,
                visibility: ['player'],
                decision: entry.decision,
                source: entry.source?.kind ? { kind: entry.source.kind } : null,
                content: clone(entry.content),
            })),
        };
    }
    return result;
}
