import { getRequestHeaders, saveSettingsDebounced } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { NovelModeLifecycle } from './lifecycle.js';
import { createNovelModeRuntimeClient } from './runtime-client.js';
import { NovelModeSession, NOVEL_INPUT_MODES } from './session.js';
import { createNovelWorkspaceClient } from './workspace-client.js';
import { renderNovelComponent } from './component-registry.js';
import { createWorkspaceController } from './workspace-controller.js';
import {
    createInitialReleaseSessionState,
    createNovelReleaseSessionClient,
    readNovelShareToken,
    reduceReleaseSessionState,
} from './release-session-client.js';

const MODULE_NAME = 'novel-mode';
const runtimeClient = createNovelModeRuntimeClient({ getHeaders: getRequestHeaders });
const workspaceClient = createNovelWorkspaceClient({ getHeaders: getRequestHeaders });
const releaseSessionClient = createNovelReleaseSessionClient({ getHeaders: getRequestHeaders });
const REQUIRED_BINDING_KEYS = Object.freeze([
    'projectId',
    'branchId',
    'chapterId',
    'sceneId',
    'povEntityId',
    'modelProfileId',
]);
let healthController = null;
let restoreController = null;
let shareController = null;
let studioController = null;
let releaseSessionState = createInitialReleaseSessionState();

function element(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const target = element(id);
    if (target) target.textContent = value == null ? '' : String(value);
}

function loadSettings() {
    if (!extension_settings.novel_mode || typeof extension_settings.novel_mode !== 'object') {
        extension_settings.novel_mode = {};
    }
    const settings = extension_settings.novel_mode;
    settings.enabled = settings.enabled === undefined ? true : Boolean(settings.enabled);
    settings.inputMode = NOVEL_INPUT_MODES.includes(settings.inputMode) ? settings.inputMode : 'act';
    settings.binding = settings.binding && typeof settings.binding === 'object' ? settings.binding : null;
    settings.modelProfileId = typeof settings.modelProfileId === 'string' && settings.modelProfileId
        ? settings.modelProfileId
        : 'model-default';
    return settings;
}

function hasCompleteBinding(binding) {
    return Boolean(
        binding
        && typeof binding === 'object'
        && !Array.isArray(binding)
        && REQUIRED_BINDING_KEYS.every(key => typeof binding[key] === 'string' && binding[key].trim())
        && ['author', 'player'].includes(binding.audience),
    );
}

function selectedAudience() {
    const audience = element('novel_mode_audience');
    return audience instanceof HTMLSelectElement && audience.value === 'player' ? 'player' : 'author';
}

function updateModeControls(settings) {
    const audience = selectedAudience();
    for (const mode of NOVEL_INPUT_MODES) {
        const button = document.querySelector(`[data-novel-mode="${mode}"]`);
        if (!(button instanceof HTMLButtonElement)) continue;
        const permitted = audience === 'author' || mode !== 'direct';
        button.disabled = !settings.enabled || !permitted;
        button.setAttribute('aria-pressed', String(settings.inputMode === mode && permitted));
        button.classList.toggle('selected', settings.inputMode === mode && permitted);
    }
    if (audience === 'player' && settings.inputMode === 'direct') {
        settings.inputMode = 'act';
        saveSettingsDebounced();
        updateModeControls(settings);
    }
}

function setShellEnabled(settings) {
    const controls = document.querySelectorAll(
        '#novel_mode_binding input, #novel_mode_binding select, #novel_mode_bind, '
        + '#novel_mode_input, #novel_mode_submit, #novel_mode_stop, #novel_mode_open_studio, '
        + '#novel_mode_new_story, #novel_mode_character_import_kind, '
        + '#novel_mode_character_import_preview, #novel_mode_character_import_confirm',
    );
    controls.forEach((control) => {
        if ('disabled' in control) control.disabled = !settings.enabled;
    });
    const refresh = element('novel_mode_refresh');
    if (refresh instanceof HTMLButtonElement) refresh.disabled = !settings.enabled;
    updateModeControls(settings);
}

function readBinding() {
    return {
        projectId: element('novel_mode_project')?.value.trim(),
        branchId: element('novel_mode_branch')?.value.trim(),
        chapterId: element('novel_mode_chapter')?.value.trim(),
        sceneId: element('novel_mode_scene')?.value.trim(),
        povEntityId: element('novel_mode_pov_entity')?.value.trim(),
        modelProfileId: element('novel_mode_model_profile')?.value.trim(),
        resumeTurnId: element('novel_mode_resume_turn')?.value.trim() || null,
        audience: selectedAudience(),
    };
}

function writeBinding(binding) {
    if (!binding) return;
    const values = {
        novel_mode_project: binding.projectId,
        novel_mode_branch: binding.branchId,
        novel_mode_chapter: binding.chapterId,
        novel_mode_scene: binding.sceneId,
        novel_mode_pov_entity: binding.povEntityId,
        novel_mode_model_profile: binding.modelProfileId,
        novel_mode_resume_turn: binding.resumeTurnId || '',
        novel_mode_audience: binding.audience,
    };
    for (const [id, value] of Object.entries(values)) {
        const target = element(id);
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) target.value = value || '';
    }
}

function renderCommittedView(view) {
    setText('novel_mode_committed_view', view?.text || '');
    setText('novel_mode_component_count', String(view?.components?.length || 0));
    const components = element('novel_mode_committed_components');
    components?.replaceChildren();
    for (const component of view?.components || []) {
        components?.append(renderNovelComponent(document, component, { audience: selectedAudience() }));
    }
}

function sharedReleaseView(release) {
    const blocks = Array.isArray(release?.manifest?.blocks)
        ? [...release.manifest.blocks].sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
        : [];
    const components = Array.isArray(release?.manifest?.components)
        ? release.manifest.components
            .filter(component => Array.isArray(component.visibility) && component.visibility.includes('player'))
            .map(component => ({ ...component, provisional: false }))
        : [];
    return {
        text: blocks.map(block => block.proseText).filter(text => typeof text === 'string').join('\n\n'),
        components,
    };
}

async function openSharedEntry(settings, shareToken) {
    shareController?.abort();
    shareController = new AbortController();
    setText('novel_mode_binding_status', 'Opening shared session');
    try {
        const sharedSession = await releaseSessionClient.openSharedSession(shareToken, shareController.signal);
        let resolvedSession = sharedSession;
        try {
            resolvedSession = await releaseSessionClient.reconnectSession(sharedSession.sessionId, {
                lastEventId: null,
            }, shareController.signal);
        } catch {
            // A public viewer may read a share without owning its live session.
        }
        const release = await releaseSessionClient.openRelease(resolvedSession.releaseId, shareController.signal);
        let next = reduceReleaseSessionState(createInitialReleaseSessionState(), {
            type: 'release.opened',
            release,
        });
        next = reduceReleaseSessionState(next, { type: 'session.opened', session: resolvedSession });
        releaseSessionState = next;

        const audience = element('novel_mode_audience');
        if (audience instanceof HTMLSelectElement) audience.value = 'player';
        const firstScene = Array.isArray(release.manifest?.scenes) ? release.manifest.scenes[0] : null;
        const firstChapter = Array.isArray(release.manifest?.chapters) ? release.manifest.chapters[0] : null;
        const sharedBinding = {
            projectId: resolvedSession.projectId,
            branchId: resolvedSession.branchId,
            chapterId: firstScene?.chapterId || firstChapter?.chapterId || null,
            sceneId: firstScene?.sceneId || null,
            povEntityId: resolvedSession.povEntityId,
            modelProfileId: settings.modelProfileId,
            resumeTurnId: null,
            audience: 'player',
        };
        if (
            sharedBinding.chapterId && sharedBinding.sceneId
            && sharedBinding.povEntityId && sharedBinding.modelProfileId
        ) {
            await session.bind(sharedBinding, { signal: shareController.signal });
            const recoveryEvents = Array.isArray(resolvedSession.recoveryEvents)
                ? resolvedSession.recoveryEvents
                : resolvedSession.stageSnapshot?.lastRender
                    ? [resolvedSession.stageSnapshot.lastRender]
                    : [];
            if (recoveryEvents.length) session.restorePlayerEvents(recoveryEvents);
            writeBinding(sharedBinding);
        }
        const recovered = session.view;
        const stageView = recovered.text || recovered.components?.length ? recovered : sharedReleaseView(release);
        renderCommittedView(stageView);
        studioController?.presentSharedStage({ release, session: resolvedSession, view: stageView });
        setText('novel_mode_workspace_title', release.manifest?.title || 'Shared story');
        setText('novel_mode_binding_status', 'Shared session active');
        setText('novel_mode_turn_status', releaseSessionState.status === 'active' ? 'Live session' : 'Session unavailable');
        updateModeControls(settings);
        return releaseSessionState;
    } catch (error) {
        if (error?.name !== 'AbortError') console.warn('Novel shared session failed to open.', error);
        releaseSessionState = {
            ...createInitialReleaseSessionState(),
            status: 'error',
            error: error instanceof Error ? error.message : 'Shared session failed.',
        };
        setText('novel_mode_binding_status', 'Shared session unavailable');
        return null;
    }
}

const createSession = () => new NovelModeSession({
    runtimeClient,
    onFallback: fallback => setText('novel_mode_committed_view', fallback.text),
});
let session = createSession();

async function refreshBridgeHealth() {
    const settings = loadSettings();
    if (!settings.enabled) {
        setText('novel_mode_runtime_status', 'Disabled');
        return null;
    }
    healthController?.abort();
    healthController = new AbortController();
    setText('novel_mode_runtime_status', 'Checking');
    try {
        const payload = await runtimeClient.health(healthController.signal);
        if (!payload.runtimeConfigured) setText('novel_mode_runtime_status', 'Not configured');
        else if (!payload.runtimeReachable) setText('novel_mode_runtime_status', 'Unavailable');
        else setText('novel_mode_runtime_status', 'Ready');
        return payload;
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn('Mengdie Runtime bridge is unavailable.', error);
            setText('novel_mode_runtime_status', 'Unavailable');
        }
        return null;
    }
}

async function restoreBinding(settings, binding = readBinding()) {
    restoreController?.abort();
    restoreController = new AbortController();
    setText('novel_mode_binding_status', 'Restoring');
    try {
        const view = await session.bind(binding, { signal: restoreController.signal });
        settings.binding = session.binding;
        settings.modelProfileId = session.binding.modelProfileId;
        saveSettingsDebounced();
        renderCommittedView(view);
        studioController?.restoreSessionView(view);
        setText('novel_mode_binding_status', binding.resumeTurnId ? 'Restored' : 'Bound');
        updateModeControls(settings);
        return view;
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn('Mengdie project binding failed.', error);
            setText('novel_mode_binding_status', 'Unavailable');
        }
        return null;
    }
}

async function mount() {
    const existing = element('novel_mode_settings');
    if (existing) return existing;
    const target = element('extensions_settings2');
    if (!target) throw new Error('Mengdie settings target is unavailable.');

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    target.insertAdjacentHTML('beforeend', html);
    const root = element('novel_mode_settings');
    const enabled = element('novel_mode_enabled');
    const refresh = element('novel_mode_refresh');
    const bind = element('novel_mode_bind');
    const audience = element('novel_mode_audience');
    const input = element('novel_mode_input');
    const submit = element('novel_mode_submit');
    const stop = element('novel_mode_stop');
    if (
        !root || !(enabled instanceof HTMLInputElement) || !(refresh instanceof HTMLButtonElement)
        || !(bind instanceof HTMLButtonElement) || !(audience instanceof HTMLSelectElement)
        || !(input instanceof HTMLTextAreaElement) || !(submit instanceof HTMLButtonElement)
        || !(stop instanceof HTMLButtonElement)
    ) {
        root?.remove();
        throw new Error('Mengdie settings shell failed to mount.');
    }

    const settings = loadSettings();
    let shareToken = null;
    try {
        shareToken = readNovelShareToken(window.location);
    } catch (error) {
        console.warn('Novel share entry is invalid.', error);
        setText('novel_mode_binding_status', 'Invalid share link');
    }
    if (shareToken && !settings.enabled) {
        settings.enabled = true;
        enabled.checked = true;
        saveSettingsDebounced();
    }
    enabled.checked = settings.enabled;
    if (!settings.binding) {
        const modelProfile = element('novel_mode_model_profile');
        if (modelProfile instanceof HTMLInputElement) modelProfile.value = settings.modelProfileId;
    }
    writeBinding(settings.binding);
    setShellEnabled(settings);

    studioController?.dispose();
    studioController = createWorkspaceController({
        document,
        workspaceClient,
        getSession: () => session,
        loadSettings,
        writeBinding,
        saveSettings: saveSettingsDebounced,
        onWarning: error => console.warn('Novel workspace request failed.', error),
    });
    studioController.mount(root);

    enabled.addEventListener('change', async () => {
        settings.enabled = enabled.checked;
        saveSettingsDebounced();
        setShellEnabled(settings);
        if (!settings.enabled) studioController?.close();
        const health = await refreshBridgeHealth();
        if (health?.runtimeReachable && hasCompleteBinding(settings.binding)) {
            await restoreBinding(settings, settings.binding);
        }
    });
    refresh.addEventListener('click', refreshBridgeHealth);
    bind.addEventListener('click', async () => {
        const health = await refreshBridgeHealth();
        if (health?.runtimeReachable) await restoreBinding(settings);
    });
    audience.addEventListener('change', () => updateModeControls(settings));
    submit.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text || !settings.enabled || !session.canUseMode(settings.inputMode)) return;
        setText('novel_mode_turn_status', 'Writing');
        submit.disabled = true;
        stop.disabled = false;
        try {
            await session.submitTurn(settings.inputMode, text, {
                onUpdate: view => renderCommittedView(view),
            });
            input.value = '';
            setText('novel_mode_turn_status', 'Complete');
        } catch (error) {
            if (error?.name !== 'AbortError') console.warn('Novel turn failed.', error);
            setText('novel_mode_turn_status', 'Failed');
        } finally {
            submit.disabled = !settings.enabled;
            stop.disabled = true;
        }
    });
    stop.addEventListener('click', async () => {
        stop.disabled = true;
        try {
            await session.cancelTurn('user');
            setText('novel_mode_turn_status', 'Cancelled');
        } catch (error) {
            console.warn('Novel turn cancellation failed.', error);
            setText('novel_mode_turn_status', 'Cancel failed');
        }
    });
    root.querySelectorAll('[data-novel-mode]').forEach((button) => {
        button.addEventListener('click', () => {
            const mode = button.dataset.novelMode;
            if (!NOVEL_INPUT_MODES.includes(mode) || button.disabled) return;
            settings.inputMode = mode;
            saveSettingsDebounced();
            updateModeControls(settings);
        });
    });

    const health = await refreshBridgeHealth();
    if (health?.runtimeReachable && shareToken) await openSharedEntry(settings, shareToken);
    else if (health?.runtimeReachable && hasCompleteBinding(settings.binding)) {
        await studioController.open();
        await restoreBinding(settings, settings.binding);
    } else if (health?.runtimeReachable && settings.enabled) await studioController.open();
    return root;
}

async function unmount(root) {
    healthController?.abort();
    restoreController?.abort();
    shareController?.abort();
    healthController = null;
    restoreController = null;
    shareController = null;
    studioController?.dispose();
    studioController = null;
    releaseSessionState = createInitialReleaseSessionState();
    session = createSession();
    root?.remove();
}

const lifecycle = new NovelModeLifecycle({ mount, unmount });

export async function init() {
    return lifecycle.activate();
}

export async function enable() {
    return lifecycle.activate();
}

export async function disable() {
    return lifecycle.deactivate();
}
