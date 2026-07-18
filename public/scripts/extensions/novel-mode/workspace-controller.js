import { createWorkspaceActions } from './workspace-actions.js';
import { createWorkspaceRenderer } from './workspace-render.js';
import {
    WORKSPACE_TABS,
    createInitialWorkspaceState,
    reduceWorkspaceState,
} from './workspace-state.js';

const DRAWER_NAMES = new Set(['story-inspector', 'director-trace', 'recall']);

export function createWorkspaceController({
    document,
    workspaceClient,
    getSession,
    loadSettings,
    writeBinding,
    saveSettings,
    onWarning,
} = {}) {
    if (!document || !workspaceClient || typeof getSession !== 'function') {
        throw new TypeError('Workspace controller requires document, client, and session providers.');
    }
    if (typeof loadSettings !== 'function' || typeof writeBinding !== 'function' || typeof saveSettings !== 'function') {
        throw new TypeError('Workspace controller requires settings providers.');
    }

    let root = null;
    let state = createInitialWorkspaceState();
    const importState = { preview: null, source: null, kind: null, reviews: [] };
    let listeners = null;
    let renderer = null;
    let actions = null;

    const commit = (event) => {
        state = reduceWorkspaceState(state, event);
        renderer?.render();
        return state;
    };

    const getState = () => state;
    const getImportState = () => importState;
    const render = () => renderer?.render();

    actions = createWorkspaceActions({
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
        onWarning,
    });

    renderer = createWorkspaceRenderer({
        document,
        getState,
        getImportState,
        getActionState: actions.getActionState,
        loadSettings,
        onReviewWorldInfo: actions.reviewWorldInfo,
    });

    function selectTab(tab, { focus = false } = {}) {
        if (!WORKSPACE_TABS.includes(tab)) return;
        commit({ type: 'tab.selected', tab });
        if (focus) {
            const button = root?.querySelector(`[data-novel-workspace="${tab}"]`);
            button?.focus();
        }
    }

    function toggleDrawer(name, force) {
        if (!DRAWER_NAMES.has(name)) return;
        const drawer = root?.querySelector(`[data-novel-drawer="${name}"]`);
        const toggles = root?.querySelectorAll(`[data-novel-drawer-toggle="${name}"]`) || [];
        if (!drawer || !toggles.length) return;
        const open = force === undefined ? drawer.hidden : Boolean(force);
        drawer.hidden = !open;
        drawer.dataset.drawerOpen = String(open);
        toggles.forEach((toggle) => {
            toggle.setAttribute('aria-expanded', String(open));
            toggle.classList.toggle('selected', open);
        });
        if (open) drawer.querySelector('input, textarea, select, button')?.focus();
    }

    function closeDrawers() {
        for (const name of DRAWER_NAMES) toggleDrawer(name, false);
    }

    function setAudience() {
        const control = root?.querySelector('#novel_mode_workspace_audience');
        const audience = control?.value === 'player' ? 'player' : 'author';
        actions.resetStageSession();
        commit({ type: 'audience.changed', audience });
        const settings = loadSettings();
        settings.binding = settings.binding
            ? { ...settings.binding, audience: state.audience, resumeTurnId: null }
            : settings.binding;
        saveSettings();
        if (state.project?.id) return actions.bindProject(state.project.id);
        return null;
    }

    function handleTabKey(event) {
        const tabs = [...root.querySelectorAll('[data-novel-workspace]')];
        const current = tabs.indexOf(event.target);
        if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home'
            ? 0
            : event.key === 'End'
                ? tabs.length - 1
                : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        const tab = tabs[next]?.dataset.novelWorkspace;
        if (tab) selectTab(tab, { focus: true });
    }

    function handleClick(event) {
        const target = event.target instanceof Element
            ? event.target.closest('button, [data-novel-world-action], [data-novel-world-edit], [data-novel-confirm-suggestion]')
            : null;
        if (!(target instanceof HTMLButtonElement)) return;
        const tab = target.dataset.novelWorkspace;
        if (tab) {
            selectTab(tab);
            return;
        }
        const drawer = target.dataset.novelDrawerToggle;
        if (drawer) {
            toggleDrawer(drawer);
            return;
        }
        if (target.dataset.novelWorldAction) {
            if (target.dataset.novelWorldAction === 'edit') {
                actions.editWorldItem(target.dataset.novelWorldItemId, 'edit');
            } else {
                actions.applyItemAction(target.dataset.novelWorldItemId, target.dataset.novelWorldAction);
            }
            return;
        }
        if (target.dataset.novelWorldEdit) {
            actions.editWorldItem(target.dataset.novelWorldItemId, target.dataset.novelWorldEdit);
            return;
        }
        if (target.dataset.novelConfirmSuggestion) {
            actions.confirmSuggestion(target.dataset.novelConfirmSuggestion);
            return;
        }
        if (target.dataset.novelWorkspaceMode) {
            actions.setMode(target.dataset.novelWorkspaceMode);
        }
    }

    function bindEvents() {
        listeners?.abort();
        listeners = new AbortController();
        const signal = listeners.signal;
        const listen = (selector, type, handler) => {
            const target = root?.querySelector(selector);
            target?.addEventListener(type, handler, { signal });
        };
        listen('#novel_mode_open_studio', 'click', open);
        listen('#novel_mode_close_studio', 'click', close);
        listen('#novel_mode_workspace_refresh', 'click', actions.loadProjects);
        listen('#novel_mode_new_story', 'click', actions.createStory);
        listen('#novel_mode_workspace_project', 'change', (event) => actions.bindProject(event.target.value));
        listen('#novel_mode_workspace_chapter', 'change', (event) => commit({ type: 'chapter.selected', chapterId: event.target.value }));
        listen('#novel_mode_workspace_scene', 'change', (event) => commit({ type: 'scene.selected', sceneId: event.target.value }));
        listen('#novel_mode_pov_entity', 'change', (event) => {
            const selected = event.target.value;
            const allowed = state.povOptions?.some(option => option?.id === selected && option.role === 'playable');
            const enter = root?.querySelector('#novel_mode_enter_stage');
            if (enter instanceof HTMLButtonElement) enter.disabled = state.busy || !state.openingRoute || !allowed;
        });
        listen('#novel_mode_opening_route', 'change', (event) => {
            const route = state.openingRoutes.find(item => item.routeId === event.target.value);
            if (route) commit({ type: 'opening.selected', route });
        });
        listen('#novel_mode_propose_guide', 'click', () => actions.proposeGuide());
        listen('#novel_mode_import_guide', 'click', () => actions.proposeGuide('existing_text'));
        listen('#novel_mode_lock_world', 'click', actions.lockWorld);
        listen('#novel_mode_reopen_world', 'click', actions.reopenWorld);
        listen('#novel_mode_validate_world', 'click', actions.refreshWorld);
        listen('#novel_mode_enter_stage', 'click', actions.enterStage);
        listen('#novel_mode_workspace_audience', 'change', setAudience);
        listen('#novel_mode_load_branch', 'click', actions.loadBranch);
        listen('#novel_mode_refresh_trace', 'click', actions.loadSnapshot);
        listen('#novel_mode_refresh_recall', 'click', actions.loadRecall);
        listen('#novel_mode_workspace_submit', 'click', () => actions.submitTurn());
        listen('#novel_mode_workspace_stop', 'click', actions.stopTurn);
        listen('#novel_mode_workspace_retry', 'click', actions.retryTurn);
        listen('#novel_mode_workspace_accept', 'click', actions.acceptTurn);
        listen('#novel_mode_character_import_preview', 'click', actions.previewImport);
        listen('#novel_mode_character_import_confirm', 'click', actions.confirmImport);
        listen('#novel_mode_character_import_kind', 'change', actions.resetImport);
        root?.addEventListener('click', handleClick, { signal });
        root?.addEventListener('keydown', handleTabKey, { signal });
        root?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const openDrawer = [...root.querySelectorAll('[data-novel-drawer]')]
                    .find((drawer) => !drawer.hidden);
                if (openDrawer) {
                    toggleDrawer(openDrawer.dataset.novelDrawer, false);
                    event.preventDefault();
                } else close();
            }
        }, { signal });
    }

    async function open() {
        if (!root) return;
        const workspace = root.querySelector('#novel_mode_workspace');
        if (workspace) workspace.hidden = false;
        document.body.classList.add('novel-mode-studio-open');
        render();
        return actions.loadProjects();
    }

    function close() {
        actions.abortRequests();
        actions.abortTurn();
        closeDrawers();
        const workspace = root?.querySelector('#novel_mode_workspace');
        if (workspace) workspace.hidden = true;
        document.body.classList.remove('novel-mode-studio-open');
    }

    function presentSharedStage({ release, session, view }) {
        if (!root || !release?.manifest || !session || !view) {
            throw new TypeError('Shared stage requires a release, session, and rendered view.');
        }
        const manifest = release.manifest;
        const chapters = (manifest.chapters || []).map(chapter => ({
            ...chapter,
            id: chapter.chapterId,
        }));
        const scenes = (manifest.scenes || []).map(scene => ({
            ...scene,
            id: scene.sceneId,
        }));
        const firstScene = scenes[0] || null;
        commit({
            type: 'project.bound',
            project: { id: session.projectId, title: manifest.title, status: 'published' },
            chapters,
            scenes,
            branch: {
                id: session.branchId,
                headCommitId: session.headCommitId,
                storyTick: null,
            },
            world: null,
            workbench: {
                access: {
                    role: 'player',
                    audience: 'player',
                    canEditWorld: false,
                    canDirect: false,
                    canPreviewPlayer: false,
                    canUseDirect: false,
                },
            },
        });
        if (firstScene) {
            commit({
                type: 'opening.selected',
                route: {
                    routeId: `share:${release.releaseId}`,
                    title: firstScene.title || manifest.title,
                    sceneId: firstScene.id,
                    entryConditions: [],
                },
            });
        }
        commit({
            type: 'stage.updated',
            stage: {
                ...view,
                status: session.turnStage === 'idle' ? 'ready' : session.turnStage,
            },
        });
        selectTab('story');
        const workspace = root.querySelector('#novel_mode_workspace');
        if (workspace) workspace.hidden = false;
        document.body.classList.add('novel-mode-studio-open');
        return render();
    }

    function restoreSessionView(view) {
        if (!view || typeof view !== 'object') return null;
        commit({
            type: 'stage.updated',
            stage: {
                ...view,
                status: view.stage || 'idle',
            },
        });
        return state.stage;
    }

    function mount(target) {
        if (!target) throw new TypeError('Workspace controller requires a mounted root.');
        root = target;
        bindEvents();
        const inspector = root.querySelector('[data-novel-drawer="story-inspector"]');
        const inspectorToggles = root.querySelectorAll('[data-novel-drawer-toggle="story-inspector"]');
        const mobile = document.defaultView?.matchMedia?.('(max-width: 760px)').matches === true;
        if (inspector) {
            inspector.hidden = mobile;
            inspector.dataset.drawerOpen = String(!mobile);
        }
        inspectorToggles.forEach((toggle) => toggle.setAttribute('aria-expanded', String(!mobile)));
        render();
        return root;
    }

    function dispose() {
        listeners?.abort();
        listeners = null;
        actions.dispose();
        closeDrawers();
        document.body.classList.remove('novel-mode-studio-open');
        state = createInitialWorkspaceState();
        importState.preview = null;
        importState.source = null;
        importState.kind = null;
        importState.reviews = [];
        root = null;
    }

    return Object.freeze({
        mount,
        open,
        presentSharedStage,
        restoreSessionView,
        close,
        dispose,
        render,
        getState,
        getActionState: actions.getActionState,
    });
}
