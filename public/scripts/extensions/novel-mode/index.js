import { getRequestHeaders, saveSettingsDebounced } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { NovelModeLifecycle } from './lifecycle.js';
import { createNovelModeRuntimeClient } from './runtime-client.js';
import { NovelModeSession, NOVEL_INPUT_MODES } from './session.js';

const MODULE_NAME = 'novel-mode';
const runtimeClient = createNovelModeRuntimeClient({ getHeaders: getRequestHeaders });
let healthController = null;
let restoreController = null;
const createSession = () => new NovelModeSession({
    runtimeClient,
    onFallback: fallback => setText('novel_mode_committed_view', fallback.text),
});
let session = createSession();

function loadSettings() {
    if (!extension_settings.novel_mode || typeof extension_settings.novel_mode !== 'object') {
        extension_settings.novel_mode = {};
    }
    const settings = extension_settings.novel_mode;
    settings.enabled = Boolean(settings.enabled);
    settings.inputMode = NOVEL_INPUT_MODES.includes(settings.inputMode) ? settings.inputMode : 'act';
    settings.binding = settings.binding && typeof settings.binding === 'object' ? settings.binding : null;
    return settings;
}

function element(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const target = element(id);
    if (target) target.textContent = value;
}

function selectedAudience() {
    const audience = element('novel_mode_audience');
    return audience instanceof HTMLSelectElement && audience.value === 'player' ? 'player' : 'author';
}

function updateModeControls(settings) {
    const enabled = settings.enabled;
    const audience = selectedAudience();
    for (const mode of NOVEL_INPUT_MODES) {
        const button = document.querySelector(`[data-novel-mode="${mode}"]`);
        if (!(button instanceof HTMLButtonElement)) continue;
        const permitted = audience === 'author' || mode !== 'direct';
        button.disabled = !enabled || !permitted;
        const selected = settings.inputMode === mode && permitted;
        button.setAttribute('aria-pressed', String(selected));
        button.classList.toggle('selected', selected);
    }
    if (audience === 'player' && settings.inputMode === 'direct') {
        settings.inputMode = 'act';
        saveSettingsDebounced();
        updateModeControls(settings);
    }
}

function setShellEnabled(settings) {
    const controls = document.querySelectorAll('#novel_mode_binding input, #novel_mode_binding select, #novel_mode_bind, #novel_mode_input, #novel_mode_submit, #novel_mode_stop');
    controls.forEach(control => {
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
        novel_mode_resume_turn: binding.resumeTurnId || '',
        novel_mode_audience: binding.audience,
    };
    for (const [id, value] of Object.entries(values)) {
        const target = element(id);
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) target.value = value || '';
    }
}

function renderCommittedView(view) {
    setText('novel_mode_committed_view', view.text || '');
    const target = element('novel_mode_component_count');
    if (target) target.textContent = String(view.components.length);
}

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
            console.warn('Novel Mode Runtime bridge is unavailable.', error);
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
        saveSettingsDebounced();
        renderCommittedView(view);
        setText('novel_mode_binding_status', binding.resumeTurnId ? 'Restored' : 'Bound');
        updateModeControls(settings);
        return view;
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn('Novel Mode project binding failed.', error);
            setText('novel_mode_binding_status', 'Unavailable');
        }
        return null;
    }
}

async function mount() {
    const existing = element('novel_mode_settings');
    if (existing) return existing;

    const target = element('extensions_settings2');
    if (!target) throw new Error('Novel Mode settings target is unavailable.');

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
        !root || !(enabled instanceof HTMLInputElement) || !(refresh instanceof HTMLButtonElement) ||
        !(bind instanceof HTMLButtonElement) || !(audience instanceof HTMLSelectElement) ||
        !(input instanceof HTMLTextAreaElement) || !(submit instanceof HTMLButtonElement) ||
        !(stop instanceof HTMLButtonElement)
    ) {
        root?.remove();
        throw new Error('Novel Mode settings shell failed to mount.');
    }

    const settings = loadSettings();
    enabled.checked = settings.enabled;
    writeBinding(settings.binding);
    setShellEnabled(settings);

    enabled.addEventListener('change', async () => {
        settings.enabled = enabled.checked;
        saveSettingsDebounced();
        setShellEnabled(settings);
        const health = await refreshBridgeHealth();
        if (health?.runtimeReachable && settings.binding) await restoreBinding(settings, settings.binding);
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
    root.querySelectorAll('[data-novel-mode]').forEach(button => {
        button.addEventListener('click', () => {
            const mode = button.dataset.novelMode;
            if (!NOVEL_INPUT_MODES.includes(mode) || button.disabled) return;
            settings.inputMode = mode;
            saveSettingsDebounced();
            updateModeControls(settings);
        });
    });

    const health = await refreshBridgeHealth();
    if (health?.runtimeReachable && settings.binding) await restoreBinding(settings, settings.binding);
    return root;
}

async function unmount(root) {
    healthController?.abort();
    restoreController?.abort();
    healthController = null;
    restoreController = null;
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
