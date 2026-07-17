import { getRequestHeaders, saveSettingsDebounced } from '../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { NovelModeLifecycle } from './lifecycle.js';
import { createNovelModeRuntimeClient } from './runtime-client.js';
import { NovelModeSession, NOVEL_INPUT_MODES } from './session.js';
import { NovelWorldGuide, WORLD_GUIDE_SOURCE_MODES } from './world-guide.js';

const MODULE_NAME = 'novel-mode';
const runtimeClient = createNovelModeRuntimeClient({ getHeaders: getRequestHeaders });
let healthController = null;
let restoreController = null;
let guideController = null;
const createSession = () => new NovelModeSession({
    runtimeClient,
    onFallback: fallback => setText('novel_mode_committed_view', fallback.text),
});
let session = createSession();
let worldGuide = new NovelWorldGuide({ runtimeClient });

function loadSettings() {
    if (!extension_settings.novel_mode || typeof extension_settings.novel_mode !== 'object') {
        extension_settings.novel_mode = {};
    }
    const settings = extension_settings.novel_mode;
    settings.enabled = Boolean(settings.enabled);
    settings.inputMode = NOVEL_INPUT_MODES.includes(settings.inputMode) ? settings.inputMode : 'act';
    settings.binding = settings.binding && typeof settings.binding === 'object' ? settings.binding : null;
    settings.worldGuideSourceMode = WORLD_GUIDE_SOURCE_MODES.includes(settings.worldGuideSourceMode)
        ? settings.worldGuideSourceMode
        : 'inspiration';
    settings.worldGuideModelProfileId = typeof settings.worldGuideModelProfileId === 'string'
        ? settings.worldGuideModelProfileId
        : 'model-default';
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
    const controls = document.querySelectorAll('#novel_mode_binding input, #novel_mode_binding select, #novel_mode_bind');
    controls.forEach(control => {
        if ('disabled' in control) control.disabled = !settings.enabled;
    });
    const refresh = element('novel_mode_refresh');
    if (refresh instanceof HTMLButtonElement) refresh.disabled = !settings.enabled;
    document.querySelectorAll('#novel_world_guide button, #novel_world_guide input, #novel_world_guide textarea, #novel_world_guide select')
        .forEach(control => {
            if ('disabled' in control) control.disabled = !settings.enabled;
        });
    updateModeControls(settings);
}

function selectedWorldGuideSource(settings) {
    return WORLD_GUIDE_SOURCE_MODES.includes(settings.worldGuideSourceMode)
        ? settings.worldGuideSourceMode
        : 'inspiration';
}

function updateWorldGuideSourceControls(settings) {
    const mode = selectedWorldGuideSource(settings);
    document.querySelectorAll('[data-world-guide-source]').forEach(button => {
        if (!(button instanceof HTMLButtonElement)) return;
        const selected = button.dataset.worldGuideSource === mode;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    const source = element('novel_world_guide_source');
    if (source instanceof HTMLTextAreaElement) {
        source.disabled = !settings.enabled || mode === 'blank';
        source.hidden = mode === 'blank';
    }
}

function appendText(parent, tagName, text, className) {
    const target = document.createElement(tagName);
    if (className) target.className = className;
    target.textContent = text;
    parent.append(target);
    return target;
}

function renderWorldGuideQuestions(proposal) {
    const root = element('novel_world_guide_questions');
    if (!root) return;
    root.replaceChildren();
    for (const question of proposal?.questions ?? []) {
        const label = document.createElement('label');
        label.className = 'novel-world-guide-question';
        appendText(label, 'span', question.prompt);
        const input = document.createElement(question.options.length ? 'select' : 'input');
        input.dataset.worldGuideQuestion = question.id;
        if (input instanceof HTMLSelectElement) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '';
            input.append(empty);
            for (const option of question.options) {
                const item = document.createElement('option');
                item.value = option;
                item.textContent = option;
                input.append(item);
            }
        } else {
            input.type = 'text';
            input.maxLength = 10000;
        }
        input.required = question.required;
        label.append(input);
        root.append(label);
    }
}

function suggestionButton(icon, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu_button';
    button.dataset.worldGuideAction = action;
    button.title = label;
    button.setAttribute('aria-label', label);
    const glyph = document.createElement('i');
    glyph.className = `fa-solid ${icon}`;
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    return button;
}

function renderWorldGuideSuggestions(proposal) {
    const root = element('novel_world_guide_suggestions');
    if (!root) return;
    root.replaceChildren();
    for (const suggestion of proposal?.suggestions ?? []) {
        const article = document.createElement('article');
        article.className = 'novel-world-guide-suggestion';
        article.dataset.suggestionId = suggestion.suggestionId;

        const header = document.createElement('div');
        header.className = 'novel-world-guide-suggestion-header';
        appendText(header, 'strong', suggestion.item.itemType);
        appendText(header, 'span', 'Untrusted', 'novel-world-guide-trust');
        article.append(header);
        appendText(article, 'p', suggestion.rationale);

        const fields = document.createElement('div');
        fields.className = 'novel-world-guide-suggestion-fields';
        const titleLabel = appendText(fields, 'label', 'Title');
        const title = document.createElement('input');
        title.type = 'text';
        title.maxLength = 240;
        title.value = suggestion.item.title;
        title.dataset.worldGuideField = 'title';
        titleLabel.append(title);
        const controlLabel = appendText(fields, 'label', 'Control');
        const control = document.createElement('select');
        control.dataset.worldGuideField = 'control';
        for (const mode of ['tentative', 'open']) {
            const option = document.createElement('option');
            option.value = mode;
            option.textContent = mode === 'tentative' ? 'Tentative' : 'Open';
            option.selected = suggestion.item.controlMode === mode;
            control.append(option);
        }
        controlLabel.append(control);
        article.append(fields);

        const payload = document.createElement('textarea');
        payload.rows = 6;
        payload.dataset.worldGuideField = 'payload';
        payload.value = JSON.stringify(suggestion.item.payload, null, 2);
        article.append(payload);

        const actions = document.createElement('div');
        actions.className = 'novel-world-guide-suggestion-actions';
        actions.append(
            suggestionButton('fa-check', 'Confirm suggestion', 'confirm'),
            suggestionButton('fa-xmark', 'Reject suggestion', 'reject'),
        );
        article.append(actions);
        root.append(article);
    }
}

function readWorldGuideAnswers() {
    return [...document.querySelectorAll('[data-world-guide-question]')]
        .map(input => ({ questionId: input.dataset.worldGuideQuestion, answer: input.value.trim() }))
        .filter(({ answer }) => answer);
}

function readSuggestionItem(article, suggestion) {
    const title = article.querySelector('[data-world-guide-field="title"]')?.value.trim();
    const controlMode = article.querySelector('[data-world-guide-field="control"]')?.value;
    const payloadText = article.querySelector('[data-world-guide-field="payload"]')?.value;
    if (!title) throw new Error('Suggestion title is required.');
    let payload;
    try {
        payload = JSON.parse(payloadText);
    } catch {
        throw new Error('Suggestion payload must be valid JSON.');
    }
    return { ...suggestion.item, title, controlMode, payload };
}

function setWorldGuideBusy(busy) {
    document.querySelectorAll('#novel_world_guide button, #novel_world_guide input, #novel_world_guide textarea, #novel_world_guide select')
        .forEach(control => {
            if ('disabled' in control) control.disabled = busy;
        });
}

async function generateWorldGuideProposal(settings) {
    const binding = readBinding();
    const modelProfileId = element('novel_world_guide_model')?.value.trim();
    const mode = selectedWorldGuideSource(settings);
    const sourceText = element('novel_world_guide_source')?.value.trim();
    if (!binding.projectId || !modelProfileId || (mode !== 'blank' && !sourceText)) {
        setText('novel_world_guide_status', 'Incomplete');
        return;
    }
    guideController?.abort();
    guideController = new AbortController();
    setWorldGuideBusy(true);
    setText('novel_world_guide_status', 'Proposing');
    try {
        const proposal = await worldGuide.propose(binding.projectId, {
            schemaVersion: 1,
            actorId: 'bridge-owned',
            modelProfileId,
            source: mode === 'blank' ? { mode } : { mode, text: sourceText },
            context: { chapterId: binding.chapterId || null, sceneId: binding.sceneId || null },
            answers: readWorldGuideAnswers(),
        }, { signal: guideController.signal });
        settings.worldGuideModelProfileId = modelProfileId;
        saveSettingsDebounced();
        renderWorldGuideQuestions(proposal);
        renderWorldGuideSuggestions(proposal);
        setText('novel_world_guide_status', 'Preview');
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.warn('World Guide proposal failed.', error);
            setText('novel_world_guide_status', 'Unavailable');
        }
    } finally {
        setWorldGuideBusy(false);
        updateWorldGuideSourceControls(settings);
    }
}

async function handleWorldGuideSuggestion(settings, event) {
    const button = event.target.closest('[data-world-guide-action]');
    const article = button?.closest('[data-suggestion-id]');
    if (!(button instanceof HTMLButtonElement) || !(article instanceof HTMLElement)) return;
    const suggestionId = article.dataset.suggestionId;
    const proposal = worldGuide.proposal;
    const suggestion = proposal?.suggestions.find(entry => entry.suggestionId === suggestionId);
    if (!suggestion) return;
    if (button.dataset.worldGuideAction === 'reject') {
        worldGuide.reject(suggestionId);
        renderWorldGuideSuggestions(worldGuide.proposal);
        setText('novel_world_guide_status', 'Rejected');
        return;
    }
    try {
        const item = readSuggestionItem(article, suggestion);
        setWorldGuideBusy(true);
        setText('novel_world_guide_status', 'Confirming');
        const result = await worldGuide.confirm(readBinding().projectId, suggestionId, item);
        renderWorldGuideSuggestions(worldGuide.proposal);
        setText('novel_world_guide_status', result.replayed ? 'Already confirmed' : 'Confirmed');
    } catch (error) {
        console.warn('World Guide confirmation failed.', error);
        setText('novel_world_guide_status', 'Check proposal');
    } finally {
        setWorldGuideBusy(false);
        updateWorldGuideSourceControls(settings);
    }
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
    const guideModel = element('novel_world_guide_model');
    const guideGenerate = element('novel_world_guide_generate');
    const guideSuggestions = element('novel_world_guide_suggestions');
    if (
        !root || !(enabled instanceof HTMLInputElement) || !(refresh instanceof HTMLButtonElement) ||
        !(bind instanceof HTMLButtonElement) || !(audience instanceof HTMLSelectElement) ||
        !(guideModel instanceof HTMLInputElement) || !(guideGenerate instanceof HTMLButtonElement) ||
        !guideSuggestions
    ) {
        root?.remove();
        throw new Error('Novel Mode settings shell failed to mount.');
    }

    const settings = loadSettings();
    enabled.checked = settings.enabled;
    writeBinding(settings.binding);
    guideModel.value = settings.worldGuideModelProfileId;
    setShellEnabled(settings);
    updateWorldGuideSourceControls(settings);

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
    root.querySelectorAll('[data-world-guide-source]').forEach(button => {
        button.addEventListener('click', () => {
            const mode = button.dataset.worldGuideSource;
            if (!WORLD_GUIDE_SOURCE_MODES.includes(mode)) return;
            settings.worldGuideSourceMode = mode;
            saveSettingsDebounced();
            updateWorldGuideSourceControls(settings);
        });
    });
    guideGenerate.addEventListener('click', () => generateWorldGuideProposal(settings));
    guideSuggestions.addEventListener('click', event => handleWorldGuideSuggestion(settings, event));
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
    guideController?.abort();
    healthController = null;
    restoreController = null;
    guideController = null;
    session = createSession();
    worldGuide = new NovelWorldGuide({ runtimeClient });
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
