import { characters, chat, this_chid } from '../../../script.js';
import { loadWorldInfo, selected_world_info } from '../../world-info.js';
import { createCharacterCardSource } from './character-import.js';
import { createChatImportSource } from './chat-import.js';
import { createWorldInfoSource } from './world-info-import.js';
import { canAuthorWorkspace, projectBinding } from './workspace-state.js';
import {
    canEditWorldItem,
    readWorldItemEditor,
} from './world-item-editor.js';

const CHARACTER_IMPORT_KINDS = new Set(['character-card', 'charx', 'world-info']);
const CHAT_IMPORT_KINDS = new Set(['chat', 'swipe']);
const IMPORT_KINDS = new Set([...CHARACTER_IMPORT_KINDS, ...CHAT_IMPORT_KINDS]);

function id(prefix) {
    const value = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${value}`;
}

function errorMessage(error) {
    return error?.message || 'Workspace request failed.';
}

export function createWorkspaceActions({
    document,
    workspaceClient,
    getState,
    commit,
    loadSettings,
    writeBinding,
    saveSettings,
    getSession,
    getImportState,
    render,
    onWarning = (error) => console.warn('Novel workspace request failed.', error),
} = {}) {
    if (!document || !workspaceClient || typeof getState !== 'function' || typeof commit !== 'function') {
        throw new TypeError('Workspace actions require document, client, state, and commit providers.');
    }
    if (typeof loadSettings !== 'function' || typeof getSession !== 'function') {
        throw new TypeError('Workspace actions require settings and session providers.');
    }
    if (typeof getImportState !== 'function' || typeof render !== 'function') {
        throw new TypeError('Workspace actions require import state and render providers.');
    }

    let requestController = null;
    let turnController = null;
    const actionState = {
        lastTurn: null,
        acceptPayload: null,
    };

    const node = (name) => document.getElementById(name);
    const state = () => getState();
    const inputValue = (name) => {
        const target = node(name);
        return target && typeof target.value === 'string' ? target.value.trim() : '';
    };

    function abortRequests() {
        requestController?.abort();
        requestController = new AbortController();
        return requestController.signal;
    }

    function abortTurn() {
        turnController?.abort();
        turnController = null;
    }

    function resetStageSession() {
        abortTurn();
        getSession().unbind?.();
        actionState.lastTurn = null;
        actionState.acceptPayload = null;
        commit({
            type: 'stage.updated',
            stage: {
                turnId: null,
                commitId: null,
                text: '',
                components: [],
                status: 'idle',
            },
        });
    }

    function fail(error) {
        if (error?.name !== 'AbortError') {
            commit({ type: 'error.changed', error: errorMessage(error) });
            onWarning(error);
        }
        return null;
    }

    function sourceText() {
        const guide = inputValue('novel_mode_guide_input');
        const inspiration = inputValue('novel_mode_story_inspiration');
        return guide || inspiration;
    }

    function guideSource(mode = 'inspiration') {
        const text = sourceText();
        return text ? { mode, text } : { mode: 'blank' };
    }

    function guideAnswers() {
        return [...document.querySelectorAll('[data-novel-question-id]')]
            .map((input) => ({
                questionId: input.dataset.novelQuestionId,
                answer: input.value.trim(),
            }))
            .filter(({ answer }) => answer);
    }

    function titleFromInspiration() {
        return (sourceText().split(/\r?\n/, 1)[0].trim() || 'Untitled story').slice(0, 240);
    }

    function slug(title) {
        const normalized = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 96);
        return `${normalized || 'story'}-${Date.now().toString(36)}`;
    }

    async function loadProjects() {
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            const projects = await workspaceClient.listProjects(signal);
            commit({ type: 'projects.loaded', projects });
            if (!state().project) {
                const preferredId = loadSettings().binding?.projectId;
                const preferred = projects.find(project => project.id === preferredId);
                if (preferred?.id) await bindProject(preferred.id, signal);
                else if (projects[0]?.id) await bindProject(projects[0].id, signal);
            }
            commit({ type: 'busy.changed', busy: false });
            return projects;
        } catch (error) {
            return fail(error);
        }
    }

    async function createStory() {
        const signal = abortRequests();
        const title = titleFromInspiration();
        const projectId = id('project');
        const chapterId = id('chapter');
        const sceneId = id('scene');
        commit({ type: 'busy.changed', busy: true });
        try {
            const project = await workspaceClient.createProject({
                id: projectId,
                slug: slug(title),
                title,
                status: 'draft',
                metadata: { source: 'novel-studio', sourceMode: guideSource().mode },
            }, signal);
            await workspaceClient.createChapter(projectId, {
                id: chapterId,
                ordinal: 0,
                title: 'Opening',
                status: 'planned',
                metadata: {},
            }, signal);
            await workspaceClient.createScene(projectId, {
                id: sceneId,
                chapterId,
                ordinal: 0,
                title: 'Opening scene',
                status: 'planned',
                startsAtStoryTick: 0,
                endsAtStoryTick: null,
                metadata: {},
            }, signal);
            commit({ type: 'projects.loaded', projects: [project, ...state().projects] });
            await bindProject(projectId, signal);
            await proposeGuide();
            return project;
        } catch (error) {
            return fail(error);
        }
    }

    async function bindProject(projectId, signal = abortRequests()) {
        if (!projectId) return null;
        const previous = state().project?.id;
        if (previous !== projectId) {
            resetImport();
            if (previous) resetStageSession();
        }
        commit({ type: 'busy.changed', busy: true });
        try {
            const settings = loadSettings();
            const existingBranchId = settings.binding?.projectId === projectId
                ? settings.binding.branchId
                : null;
            let workbench;
            try {
                workbench = await workspaceClient.getWorkspaceView(projectId, {
                    audience: state().audience,
                    branchId: existingBranchId,
                }, signal);
            } catch (error) {
                if (
                    state().audience !== 'author'
                    || !['BRIDGE_AUDIENCE_FORBIDDEN', 'WORKSPACE_AUDIENCE_FORBIDDEN'].includes(error?.code)
                ) throw error;
                workbench = await workspaceClient.getWorkspaceView(projectId, {
                    audience: 'player',
                    branchId: existingBranchId,
                }, signal);
            }
            commit({
                type: 'project.bound',
                project: workbench.project,
                chapters: workbench.chapters,
                scenes: workbench.scenes,
                world: workbench.world,
                branch: workbench.branch,
                povOptions: workbench.povOptions,
                selectedPovEntityId: workbench.selectedPovEntityId,
                workbench,
            });
            if (workbench.branch && workbench.access?.role === 'author') await loadRecall(signal);
            commit({ type: 'busy.changed', busy: false });
            return workbench;
        } catch (error) {
            return fail(error);
        }
    }

    function selectedImportKind() {
        const value = node('novel_mode_character_import_kind')?.value;
        return IMPORT_KINDS.has(value) ? value : 'character-card';
    }

    function selectedCharacter() {
        const index = Number(this_chid);
        if (!Number.isInteger(index) || !characters[index]) {
            throw new Error('Select a SillyTavern character before previewing an import.');
        }
        return characters[index];
    }

    function resetImport() {
        const imported = getImportState();
        imported.preview = null;
        imported.source = null;
        imported.kind = null;
        imported.reviews = [];
        render();
    }

    async function previewImport() {
        const projectId = state().project?.id;
        if (!projectId || state().audience !== 'author') return null;
        const signal = abortRequests();
        const imported = getImportState();
        commit({ type: 'busy.changed', busy: true });
        try {
            imported.kind = selectedImportKind();
            if (CHAT_IMPORT_KINDS.has(imported.kind)) {
                const characterIndex = Number(this_chid);
                const character = Number.isInteger(characterIndex) ? characters[characterIndex] : null;
                imported.source = createChatImportSource(chat, {
                    sourceName: typeof character?.chat === 'string' && character.chat.trim()
                        ? character.chat
                        : 'Current SillyTavern chat',
                    swipeOnly: imported.kind === 'swipe',
                });
                imported.preview = await workspaceClient.previewChatImport(projectId, {
                    sourceKind: imported.kind,
                    sourceDocument: imported.source,
                    sourceName: imported.source.name,
                }, signal);
            } else if (imported.kind === 'world-info') {
                const worldName = selected_world_info[0];
                if (typeof worldName === 'string' && worldName) {
                    imported.source = createWorldInfoSource(await loadWorldInfo(worldName), { sourceName: worldName });
                } else {
                    const character = selectedCharacter();
                    imported.source = createWorldInfoSource(
                        character?.data?.character_book ?? character?.character_book,
                        { sourceName: `${character?.data?.name ?? character?.name ?? 'Character'} Book` },
                    );
                }
                imported.preview = await workspaceClient.previewWorldInfoImport(projectId, {
                    sourceDocument: imported.source,
                    sourceName: imported.source.name,
                }, signal);
            } else {
                const character = selectedCharacter();
                imported.source = createCharacterCardSource(character);
                imported.preview = await workspaceClient.previewCharacterImport(projectId, {
                    sourceKind: imported.kind,
                    sourceDocument: imported.source,
                    sourceName: typeof character.avatar === 'string' ? character.avatar : null,
                }, signal);
            }
            commit({ type: 'busy.changed', busy: false });
            return imported.preview;
        } catch (error) {
            resetImport();
            return fail(error);
        }
    }

    async function confirmImport() {
        const projectId = state().project?.id;
        const imported = getImportState();
        if (
            !projectId || state().audience !== 'author' || !imported.preview?.canImport
            || !imported.source || !imported.kind
        ) return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            let confirmation = null;
            if (CHAT_IMPORT_KINDS.has(imported.kind)) {
                confirmation = await workspaceClient.confirmChatImport(projectId, {
                    sourceKind: imported.kind,
                    sourceDocument: imported.source,
                    sourceName: imported.preview.sourceName,
                    importId: imported.preview.importId,
                    sourceDigest: imported.preview.sourceDigest,
                    mappingOverrides: { messages: [] },
                }, signal);
            } else if (imported.kind === 'world-info') {
                await workspaceClient.confirmWorldInfoImport(projectId, {
                    sourceDocument: imported.source,
                    sourceName: imported.preview.sourceName,
                    importId: imported.preview.importId,
                    sourceDigest: imported.preview.sourceDigest,
                    mappingOverrides: { entries: [] },
                }, signal);
                imported.reviews = await workspaceClient.listWorldInfoReviewItems(projectId, signal);
            } else {
                await workspaceClient.confirmCharacterImport(projectId, {
                    sourceKind: imported.kind,
                    sourceDocument: imported.source,
                    sourceName: imported.preview.sourceName,
                    importId: imported.preview.importId,
                    sourceDigest: imported.preview.sourceDigest,
                }, signal);
            }
            imported.preview = { ...imported.preview, canImport: false, alreadyImported: true };
            if (CHAT_IMPORT_KINDS.has(imported.kind)) {
                // Chat imports are intentionally isolated draft branches. Move
                // the workbench to the returned branch so the imported prose
                // is immediately reviewable instead of silently refreshing the
                // previous canonical branch.
                const importedBranchId = confirmation.branchId;
                const workbench = await refreshWorkbench(signal, importedBranchId);
                const binding = projectBinding(state());
                if (!workbench || !binding || binding.branchId !== importedBranchId) {
                    throw new Error('Imported draft branch did not become the active Runtime workbench.');
                }
                const settings = loadSettings();
                const existing = settings.binding?.projectId === projectId ? settings.binding : null;
                settings.binding = {
                    ...(existing || {}),
                    ...binding,
                    audience: state().audience,
                    resumeTurnId: null,
                };
                resetStageSession();
                writeBinding(settings.binding);
                saveSettings();
            } else await refreshWorld(signal);
            commit({ type: 'busy.changed', busy: false });
            return imported.preview;
        } catch (error) {
            return fail(error);
        }
    }

    async function reviewWorldInfo(reviewItemId, decision) {
        const projectId = state().project?.id;
        const imported = getImportState();
        if (!projectId || state().audience !== 'author' || imported.kind !== 'world-info') return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            await workspaceClient.reviewWorldInfoItem(projectId, reviewItemId, {
                decision,
                note: decision === 'accept'
                    ? 'Accepted as a tentative World Info mapping in Novel Mode.'
                    : 'Rejected during World Info review in Novel Mode.',
            }, signal);
            imported.reviews = await workspaceClient.listWorldInfoReviewItems(projectId, signal);
            await refreshWorld(signal);
            commit({ type: 'busy.changed', busy: false });
            return imported.reviews;
        } catch (error) {
            return fail(error);
        }
    }

    async function proposeGuide(sourceMode = 'inspiration') {
        const projectId = state().project?.id;
        if (!projectId) {
            return fail(new Error('Select or create a project before generating a guide.'));
        }
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            const proposal = await workspaceClient.proposeWorldGuide(projectId, {
                modelProfileId: loadSettings().modelProfileId || 'model-default',
                source: guideSource(sourceMode),
                context: { chapterId: state().selection.chapterId, sceneId: state().selection.sceneId },
                answers: guideAnswers(),
            }, signal);
            commit({ type: 'guide.proposed', guide: proposal });
            commit({ type: 'busy.changed', busy: false });
            return proposal;
        } catch (error) {
            return fail(error);
        }
    }

    async function confirmSuggestion(suggestionId) {
        const current = state();
        const projectId = current.project?.id;
        const suggestion = current.guide?.suggestions?.find(item => item.suggestionId === suggestionId);
        if (!projectId || !suggestion) return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            const confirmation = await workspaceClient.confirmWorldGuide(projectId, {
                proposalId: current.guide.proposalId,
                suggestionId,
                expectedWorldRevision: current.world?.revision || current.guide.baseWorldRevision || 0,
                model: current.guide.model,
                item: suggestion.item,
            }, signal);
            commit({ type: 'guide.confirmed', guide: current.guide, suggestionId, world: confirmation.world });
            await refreshWorkbench(signal);
            commit({ type: 'busy.changed', busy: false });
            return confirmation;
        } catch (error) {
            return fail(error);
        }
    }

    async function refreshWorkbench(signal = abortRequests(), branchId = undefined) {
        const current = state();
        if (!current.project?.id) return null;
        const workbench = await workspaceClient.getWorkspaceView(current.project.id, {
            audience: current.audience,
            branchId: branchId === undefined ? (current.branch?.id || null) : branchId,
        }, signal);
        commit({ type: 'workbench.loaded', workbench });
        return workbench;
    }

    async function refreshWorld() {
        const current = state();
        if (!current.project?.id) return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            if (canAuthorWorkspace(current)) await workspaceClient.validateWorldBible(current.project.id, signal);
            const result = await refreshWorkbench(signal);
            commit({ type: 'busy.changed', busy: false });
            return result;
        } catch (error) {
            return fail(error);
        }
    }

    async function applyItemAction(itemId, action) {
        let current = state();
        let world = current.world;
        let item = world?.items?.find(record => record.id === itemId);
        if (!current.project?.id || !item || !canAuthorWorkspace(current) || world.status === 'locked') return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            if ((action === 'approve' || action === 'lock') && item.reviewStatus !== 'approved') {
                const result = await workspaceClient.applyWorldBibleCommand(current.project.id, {
                    schemaVersion: 1,
                    commandId: id('st-review'),
                    actorId: 'sillytavern-author',
                    expectedWorldRevision: world.revision,
                    type: 'ReviewWorldBibleItem',
                    itemId: item.id,
                    expectedItemRevision: item.revision,
                    reviewStatus: 'approved',
                    note: 'Approved in the Novel Edition World workbench.',
                }, signal);
                world = result.world;
                item = world.items.find(record => record.id === itemId);
            }
            const controlMode = action === 'lock'
                ? 'locked'
                : action === 'tentative'
                    ? 'tentative'
                    : action === 'open' ? 'open' : null;
            if (controlMode && item?.controlMode !== controlMode) {
                const result = await workspaceClient.applyWorldBibleCommand(current.project.id, {
                    schemaVersion: 1,
                    commandId: id('st-control'),
                    actorId: 'sillytavern-author',
                    expectedWorldRevision: world.revision,
                    type: 'SetWorldBibleItemControl',
                    itemId: item.id,
                    expectedItemRevision: item.revision,
                    controlMode,
                    reason: controlMode === 'open'
                        ? 'Left open for bounded AI freedom in Novel Edition.'
                        : `Marked ${controlMode} in Novel Edition.`,
                }, signal);
                world = result.world;
            }
            commit({ type: 'world.loaded', world });
            await refreshWorkbench(signal);
            commit({ type: 'busy.changed', busy: false });
            return world;
        } catch (error) {
            return fail(error);
        }
    }

    async function editWorldItem(itemId, action = 'edit') {
        const current = state();
        const item = current.world?.items?.find(record => record.id === itemId);
        if (!item || !canAuthorWorkspace(current) || !canEditWorldItem(item)) return null;
        const card = [...document.querySelectorAll(`[data-novel-world-item-id="${itemId}"]`)]
            .find(target => target.classList.contains('novel-mode-world-item'));
        const editor = card?.querySelector(`[data-novel-world-editor="${itemId}"]`);
        if (!editor) return null;
        if (action === 'edit') {
            editor.hidden = false;
            editor.querySelector('input, textarea, select')?.focus();
            return true;
        }
        if (action === 'cancel') {
            editor.hidden = true;
            return false;
        }
        if (action !== 'save') return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            const edited = readWorldItemEditor(document, editor, item);
            const result = await workspaceClient.applyWorldBibleCommand(current.project.id, {
                schemaVersion: 1,
                commandId: id('st-replace-world-item'),
                actorId: 'sillytavern-author',
                expectedWorldRevision: current.world.revision,
                type: 'ReplaceWorldBibleItem',
                expectedItemRevision: item.revision,
                item: {
                    id: item.id,
                    itemType: item.itemType,
                    title: edited.title,
                    payload: edited.payload,
                    source: item.source || { kind: 'author', reference: null },
                },
            }, signal);
            if (!result?.world) throw new Error('Runtime returned no updated world bible.');
            commit({ type: 'world.loaded', world: result.world });
            await refreshWorkbench(signal);
            commit({ type: 'busy.changed', busy: false });
            return result.world;
        } catch (error) {
            return fail(error);
        }
    }

    async function lockWorld() {
        const current = state();
        if (!current.project?.id || !current.world || !canAuthorWorkspace(current)) return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            const result = await workspaceClient.applyWorldBibleCommand(current.project.id, {
                schemaVersion: 1,
                commandId: id('st-lock-world'),
                actorId: 'sillytavern-author',
                expectedWorldRevision: current.world.revision,
                type: 'LockWorldBible',
                reason: 'World locked from Novel Studio.',
            }, signal);
            commit({ type: 'world.locked', world: result.world });
            await refreshWorkbench(signal);
            commit({ type: 'busy.changed', busy: false });
            return result.world;
        } catch (error) {
            return fail(error);
        }
    }

    async function reopenWorld() {
        const current = state();
        if (
            !current.project?.id || !current.world || !canAuthorWorkspace(current)
            || current.world.status !== 'locked'
        ) return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            const result = await workspaceClient.applyWorldBibleCommand(current.project.id, {
                schemaVersion: 1,
                commandId: id('st-reopen-world'),
                actorId: 'sillytavern-author',
                expectedWorldRevision: current.world.revision,
                type: 'ReopenWorldBible',
                reason: 'Reopened for explicit author revision in Novel Edition.',
            }, signal);
            commit({ type: 'world.loaded', world: result.world });
            await refreshWorkbench(signal);
            commit({ type: 'busy.changed', busy: false });
            return result.world;
        } catch (error) {
            return fail(error);
        }
    }

    async function loadRecall(signal = abortRequests()) {
        const current = state();
        if (!current.project?.id || current.access?.role !== 'author') return null;
        try {
            const recall = await workspaceClient.getRecallDiagnostic(current.project.id, {
                audience: current.audience,
                branchId: current.branch?.id || null,
                contextPackId: inputValue('novel_mode_context_pack') || null,
                povEntityId: inputValue('novel_mode_recall_pov') || null,
            }, signal);
            commit({ type: 'recall.loaded', recall });
            return recall;
        } catch (error) {
            return fail(error);
        }
    }

    async function loadSnapshot() {
        const current = state();
        if (!current.project?.id || !current.branch?.id) return loadRecall();
        if (!current.access?.canDirect) return null;
        const signal = abortRequests();
        try {
            const snapshot = await workspaceClient.getWorldSnapshot(current.project.id, current.branch.id, signal);
            commit({
                type: 'stage.updated',
                stage: {
                    status: 'snapshot loaded',
                    projectionVersion: snapshot.projectionVersion || snapshot.branch?.headVersion || null,
                },
            });
            const trace = node('novel_mode_director_trace');
            if (trace) {
                trace.replaceChildren();
                const entry = document.createElement('p');
                entry.textContent = `Snapshot ${snapshot.snapshotHash || '--'} / ${snapshot.fragments?.length || 0} fragments`;
                trace.append(entry);
            }
            await loadRecall(signal);
            return snapshot;
        } catch (error) {
            return fail(error);
        }
    }

    async function enterStage() {
        const current = state();
        const routeId = node('novel_mode_opening_route')?.value || current.openingRoute?.routeId;
        const route = current.openingRoutes.find(item => item.routeId === routeId);
        if (!route) return fail(new Error('Choose an opening route before entering the stage.'));
        const povEntityId = inputValue('novel_mode_pov_entity');
        const povOption = (current.povOptions || []).find(option => (
            option?.id === povEntityId && option.role === 'playable'
        ));
        if (!povOption) return fail(new Error('Choose a playable POV entity before entering the stage.'));
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        commit({ type: 'opening.selected', route });
        let binding = projectBinding(state());
        if (!binding && state().project?.id && state().access?.canDirect) {
            try {
                const bootstrap = await workspaceClient.bootstrap(state().project.id, {
                    chapterId: state().selection.chapterId,
                    sceneId: route.sceneId || state().selection.sceneId,
                    routeId: route.routeId,
                }, signal);
                if (bootstrap?.branch) {
                    commit({ type: 'branch.loaded', branch: bootstrap.branch });
                    await refreshWorkbench(signal);
                }
                binding = projectBinding(state());
            } catch (error) {
                if (error?.status !== 404 && error?.code !== 'BRIDGE_WORKSPACE_ROUTE_NOT_ALLOWED') fail(error);
            }
        }
        if (!binding) {
            commit({ type: 'tab.selected', tab: 'director' });
            return fail(new Error('A Runtime branch is required before entering the stage. Load it in Director.'));
        }
        const settings = loadSettings();
        settings.binding = {
            ...binding,
            povEntityId,
            modelProfileId: inputValue('novel_mode_model_profile') || settings.modelProfileId || 'model-default',
            audience: state().audience,
            resumeTurnId: null,
        };
        settings.modelProfileId = settings.binding.modelProfileId;
        writeBinding(settings.binding);
        saveSettings();
        try {
            const view = await getSession().bind(settings.binding, { signal });
            captureSessionApprovalReference(view?.turnId);
            commit({ type: 'stage.updated', stage: { ...view, status: 'ready' } });
            commit({ type: 'busy.changed', busy: false });
            return view;
        } catch (error) {
            return fail(error);
        }
    }

    async function loadBranch() {
        const current = state();
        const branchId = inputValue('novel_mode_workspace_branch');
        if (!current.project?.id || !branchId || !current.access?.canDirect) return null;
        const signal = abortRequests();
        commit({ type: 'busy.changed', busy: true });
        try {
            const workbench = await workspaceClient.getWorkspaceView(current.project.id, {
                audience: current.audience,
                branchId,
            }, signal);
            commit({ type: 'workbench.loaded', workbench });
            const binding = projectBinding(state());
            if (!binding || binding.branchId !== branchId) {
                throw new Error('Requested branch did not become the active Runtime workbench.');
            }
            const settings = loadSettings();
            const existing = settings.binding?.projectId === current.project.id ? settings.binding : null;
            settings.binding = {
                ...(existing || {}),
                ...binding,
                audience: state().audience,
                resumeTurnId: null,
            };
            resetStageSession();
            writeBinding(settings.binding);
            saveSettings();
            await loadSnapshot();
            commit({ type: 'busy.changed', busy: false });
            return workbench;
        } catch (error) {
            return fail(error);
        }
    }

    function setMode(mode) {
        const settings = loadSettings();
        if (!['act', 'speak', 'narrate', 'direct'].includes(mode)) return;
        if (mode === 'direct' && !state().access?.canUseDirect) return;
        settings.inputMode = mode;
        saveSettings();
        document.querySelectorAll('[data-novel-workspace-mode]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.novelWorkspaceMode === mode));
            button.classList.toggle('selected', button.dataset.novelWorkspaceMode === mode);
        });
    }

    function captureEvent(event) {
        const type = event?.render?.type;
        if (type === 'turn.failed') actionState.acceptPayload = null;
        // The browser may only consume a server-issued opaque approval reference.
        // It must never construct a plan, command, prose evidence, or commit IDs.
        if (type === 'turn.awaiting_approval') {
            const reference = event.approvalReference || event.render.payload.approvalReference;
            if (
                reference && typeof reference === 'object'
                && typeof reference.proposalId === 'string'
                && typeof reference.attemptId === 'string'
            ) {
                actionState.acceptPayload = {
                    projectId: state().project?.id,
                    proposalId: reference.proposalId,
                    attemptId: reference.attemptId,
                    planId: reference.planId,
                    referenceDigest: reference.digest,
                    idempotencyKey: `approval:${event.turn_id}:${reference.proposalId}`,
                };
            }
        }
    }

    function captureSessionApprovalReference(turnId = null) {
        const reference = getSession().approvalReference;
        if (!reference) return;
        actionState.acceptPayload = {
            projectId: state().project?.id,
            proposalId: reference.proposalId,
            attemptId: reference.attemptId,
            planId: reference.planId,
            referenceDigest: reference.digest,
            idempotencyKey: `approval:${turnId || state().stage.turnId}:${reference.proposalId}`,
        };
    }

    async function submitTurn(textOverride = null) {
        const input = node('novel_mode_workspace_input');
        const text = textOverride ?? (input?.value || '').trim();
        const settings = loadSettings();
        const session = getSession();
        if (!text || !session.canUseMode(settings.inputMode)) return null;
        abortTurn();
        turnController = new AbortController();
        actionState.lastTurn = { mode: settings.inputMode, text };
        actionState.acceptPayload = null;
        commit({ type: 'stage.updated', stage: { status: 'writing' } });
        try {
            const view = await session.submitTurn(settings.inputMode, text, {
                signal: turnController.signal,
                onUpdate: (next, event) => {
                    captureEvent(event);
                    commit({ type: 'stage.updated', stage: { ...next, status: next.stage || 'writing' } });
                },
            });
            commit({ type: 'stage.updated', stage: { ...view, status: view.stage || 'complete' } });
            if (input && !textOverride) input.value = '';
            return view;
        } catch (error) {
            return fail(error);
        } finally {
            turnController = null;
        }
    }

    async function retryTurn() {
        if (!actionState.lastTurn) return null;
        const last = actionState.lastTurn;
        const settings = loadSettings();
        settings.inputMode = last.mode;
        return submitTurn(last.text);
    }

    async function stopTurn() {
        abortTurn();
        try {
            const result = await getSession().cancelTurn('user');
            commit({ type: 'stage.updated', stage: { status: 'cancelled' } });
            return result;
        } catch (error) {
            return fail(error);
        }
    }

    async function acceptTurn() {
        if (!actionState.acceptPayload) return null;
        try {
            const result = await getSession().acceptTurn(actionState.acceptPayload);
            const view = getSession().view;
            const settings = loadSettings();
            if (view.stage === 'committed' && settings.binding) {
                settings.binding = { ...settings.binding, resumeTurnId: view.turnId };
                writeBinding(settings.binding);
                saveSettings();
            }
            commit({
                type: 'stage.updated',
                stage: {
                    ...view,
                    status: view.stage === 'committed' ? 'committed' : 'committing',
                },
            });
            actionState.acceptPayload = null;
            return result;
        } catch (error) {
            return fail(error);
        }
    }

    function dispose() {
        requestController?.abort();
        turnController?.abort();
        requestController = null;
        turnController = null;
        actionState.lastTurn = null;
        actionState.acceptPayload = null;
    }

    return Object.freeze({
        loadProjects,
        createStory,
        bindProject,
        resetStageSession,
        resetImport,
        previewImport,
        confirmImport,
        reviewWorldInfo,
        proposeGuide,
        confirmSuggestion,
        refreshWorkbench,
        refreshWorld,
        applyItemAction,
        editWorldItem,
        lockWorld,
        reopenWorld,
        loadRecall,
        loadSnapshot,
        enterStage,
        loadBranch,
        setMode,
        submitTurn,
        retryTurn,
        stopTurn,
        acceptTurn,
        abortRequests,
        abortTurn,
        dispose,
        getActionState: () => ({ ...actionState }),
    });
}
