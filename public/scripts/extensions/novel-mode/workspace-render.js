import { characterImportSummary } from './character-import.js';
import { chatImportSummary } from './chat-import.js';
import { renderNovelComponent } from './component-registry.js';
import {
    WORKSPACE_TABS,
    canAuthorWorkspace,
    canDisplayRecord,
} from './workspace-state.js';
import { worldInfoImportSummary } from './world-info-import.js';
import {
    canEditWorldItem,
    renderWorldItemEditor,
} from './world-item-editor.js';

function clear(target) {
    target?.replaceChildren();
}

function text(document, tag, value, className = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
}

function preview(value, maximum = 1_200) {
    let output;
    try {
        output = JSON.stringify(value, null, 2);
    } catch {
        output = '[unavailable]';
    }
    return output.length > maximum ? `${output.slice(0, maximum)}...` : output;
}

function appendOption(document, select, value, label, selected = false) {
    if (!(select instanceof HTMLSelectElement)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    select.append(option);
}

export function createWorkspaceRenderer({
    document,
    getState,
    getImportState,
    getActionState,
    loadSettings,
    onReviewWorldInfo,
} = {}) {
    if (!document || typeof getState !== 'function' || typeof getImportState !== 'function') {
        throw new TypeError('Workspace renderer requires document and state providers.');
    }
    const node = id => document.getElementById(id);
    const setText = (id, value) => {
        const target = node(id);
        if (target) target.textContent = value == null ? '' : String(value);
    };
    const authorEnabled = state => canAuthorWorkspace(state) && !state.busy;

    function renderTabs(state) {
        for (const tab of WORKSPACE_TABS) {
            const button = document.querySelector(`[data-novel-workspace="${tab}"]`);
            const panel = document.querySelector(`[data-novel-workspace-panel="${tab}"]`);
            if (button) {
                button.setAttribute('aria-selected', String(state.activeTab === tab));
                button.tabIndex = state.activeTab === tab ? 0 : -1;
            }
            if (panel) panel.hidden = state.activeTab !== tab;
        }
    }

    function renderSelects(state) {
        const project = node('novel_mode_workspace_project');
        const chapter = node('novel_mode_workspace_chapter');
        const scene = node('novel_mode_workspace_scene');
        const route = node('novel_mode_opening_route');
        const pov = node('novel_mode_pov_entity');
        if (project instanceof HTMLSelectElement) {
            clear(project);
            appendOption(document, project, '', 'Select project', !state.project);
            state.projects.forEach(item => appendOption(
                document, project, item.id, item.title || item.slug || item.id, item.id === state.project?.id,
            ));
        }
        if (chapter instanceof HTMLSelectElement) {
            clear(chapter);
            appendOption(document, chapter, '', 'Select chapter', !state.selection.chapterId);
            state.chapters.forEach(item => appendOption(
                document, chapter, item.id, item.title || item.id, item.id === state.selection.chapterId,
            ));
        }
        if (scene instanceof HTMLSelectElement) {
            clear(scene);
            const scenes = state.selection.chapterId
                ? state.scenes.filter(item => !item.chapterId || item.chapterId === state.selection.chapterId)
                : state.scenes;
            appendOption(document, scene, '', 'Select scene', !state.selection.sceneId);
            scenes.forEach(item => appendOption(
                document, scene, item.id, item.title || item.id, item.id === state.selection.sceneId,
            ));
        }
        if (route instanceof HTMLSelectElement) {
            clear(route);
            appendOption(document, route, '', 'Select opening route', !state.openingRoute);
            state.openingRoutes.forEach(item => appendOption(
                document, route, item.routeId, item.title || item.routeId,
                item.routeId === state.openingRoute?.routeId,
            ));
        }
        if (pov instanceof HTMLSelectElement) {
            const currentPov = pov.value;
            const bindingPov = loadSettings()?.binding?.povEntityId;
            const selectedPov = currentPov || bindingPov || state.selectedPovEntityId || '';
            clear(pov);
            appendOption(document, pov, '', 'Select POV entity', !selectedPov);
            (Array.isArray(state.povOptions) ? state.povOptions : [])
                .filter(item => item && item.role === 'playable' && typeof item.id === 'string')
                .forEach(item => appendOption(
                    document,
                    pov,
                    item.id,
                    item.name || item.id,
                    item.id === selectedPov,
                ));
        }
    }

    function renderOnboarding(state) {
        const steps = ['inspiration', 'guide', 'lock', 'opening', 'stage'];
        const current = steps.indexOf(state.onboarding);
        steps.forEach((step, index) => {
            const item = document.querySelector(`[data-novel-step="${step}"]`);
            if (!item) return;
            const done = index < current || (step === 'stage' && state.stage.turnId);
            item.dataset.state = done ? 'done' : (step === state.onboarding ? 'current' : 'pending');
        });
    }

    function actionButton(state, item, action, iconName, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button novel-mode-icon-action';
        button.dataset.novelWorldAction = action;
        button.dataset.novelWorldItemId = item.id;
        button.title = title;
        button.setAttribute('aria-label', `${title}: ${item.title || item.id}`);
        button.disabled = !authorEnabled(state) || state.world?.status === 'locked';
        const icon = document.createElement('i');
        icon.className = `fa-solid ${iconName}`;
        icon.setAttribute('aria-hidden', 'true');
        button.append(icon);
        return button;
    }

    function renderWorld(state) {
        const target = node('novel_mode_world_items');
        clear(target);
        const validation = state.world?.validation;
        const count = validation?.issues?.length || 0;
        setText('novel_mode_world_validation', validation?.complete
            ? 'World bible is complete.'
            : `${count} validation issue${count === 1 ? '' : 's'}.`);
        const items = (state.world?.items || []).filter(item => canDisplayRecord(item, state.audience));
        if (!items.length) {
            target?.append(text(
                document,
                'p',
                state.audience === 'player' ? 'No public world facts.' : 'No world items yet.',
                'novel-mode-empty',
            ));
            return;
        }
        for (const item of items) {
            const card = document.createElement('article');
            card.className = 'novel-mode-world-item';
            card.dataset.novelWorldItemId = item.id;
            card.dataset.authorOnly = String(!canDisplayRecord(item, 'player'));
            const header = document.createElement('header');
            header.append(
                text(document, 'strong', item.title || item.id),
                text(document, 'span', `${item.itemType || 'item'} / ${item.reviewStatus || 'public'} / ${item.controlMode || 'tentative'}`),
            );
            card.append(header, text(document, 'p', preview(item.payload)));
            if (item.conflicts?.length) {
                const list = document.createElement('ul');
                list.className = 'novel-mode-conflict-list';
                for (const conflict of item.conflicts) {
                    const row = text(document, 'li', `${conflict.code}: ${conflict.message}`);
                    row.dataset.severity = conflict.blocking ? 'blocking' : 'warning';
                    list.append(row);
                }
                card.append(list);
            }
            if (state.access?.canEditWorld) {
                const actions = document.createElement('div');
                actions.className = 'novel-mode-world-actions';
                if (canEditWorldItem(item)) {
                    actions.append(actionButton(state, item, 'edit', 'fa-pen', 'Edit item'));
                }
                actions.append(
                    actionButton(state, item, 'approve', 'fa-check', 'Approve item'),
                    actionButton(state, item, 'lock', 'fa-lock', 'Lock item'),
                    actionButton(state, item, 'tentative', 'fa-circle-half-stroke', 'Mark tentative'),
                    actionButton(state, item, 'open', 'fa-unlock', 'Leave open'),
                );
                card.append(actions);
            }
            const editor = state.access?.canEditWorld ? renderWorldItemEditor(document, item) : null;
            if (editor && state.world?.status !== 'locked') card.append(editor);
            target?.append(card);
        }
    }

    function renderArchitecture(state) {
        const target = node('novel_mode_world_architecture');
        clear(target);
        const groups = state.director?.groups;
        if (!groups) {
            target?.append(text(document, 'p', 'Director structure is not available in this view.', 'novel-mode-empty'));
            return;
        }
        for (const [label, key] of [
            ['Chapter goals', 'chapterGoals'],
            ['Character arcs', 'characterArcs'],
            ['Foreshadowing', 'foreshadows'],
            ['Tasks', 'tasks'],
            ['Author truths', 'truths'],
            ['Reader disclosures', 'readerDisclosures'],
        ]) {
            const section = document.createElement('section');
            section.className = 'novel-mode-architecture-group';
            section.append(text(document, 'h4', label));
            const records = groups[key] || [];
            if (!records.length) section.append(text(document, 'p', '--', 'novel-mode-empty'));
            for (const record of records) {
                const row = document.createElement('div');
                row.className = 'novel-mode-architecture-row';
                row.append(
                    text(document, 'strong', record.title || record.id),
                    text(document, 'span', preview(record.payload, 360)),
                );
                section.append(row);
            }
            target?.append(section);
        }
    }

    function renderPerformance(state) {
        const target = node('novel_mode_performance_preview');
        clear(target);
        const pack = state.performance?.activePack;
        if (!pack) {
            target?.append(text(document, 'p', 'No performance pack.', 'novel-mode-empty'));
            return;
        }
        const assets = document.createElement('div');
        assets.className = 'novel-mode-performance-assets';
        for (const [label, value, iconName] of [
            ['Background', pack.backgroundAssetId || '--', 'fa-image'],
            ['BGM', pack.bgmAssetId || '--', 'fa-music'],
        ]) {
            const row = document.createElement('span');
            const icon = document.createElement('i');
            icon.className = `fa-solid ${iconName}`;
            icon.setAttribute('aria-hidden', 'true');
            row.append(icon, document.createTextNode(`${label}: ${value}`));
            assets.append(row);
        }
        target?.append(assets);
        const tokens = document.createElement('div');
        tokens.className = 'novel-mode-theme-tokens';
        for (const [key, value] of Object.entries(pack.themeTokens || {})) {
            if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof value !== 'string' || value.length > 120) continue;
            const token = document.createElement('span');
            token.className = 'novel-mode-theme-token';
            const swatch = document.createElement('i');
            swatch.setAttribute('aria-hidden', 'true');
            if (globalThis.CSS?.supports?.('color', value)) swatch.style.backgroundColor = value;
            token.append(swatch, document.createTextNode(`${key}: ${value}`));
            tokens.append(token);
        }
        target?.append(tokens);
        const components = document.createElement('div');
        components.className = 'novel-mode-component-preview';
        for (const component of pack.components || []) {
            const item = document.createElement('div');
            item.dataset.componentType = component;
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-layer-group';
            icon.setAttribute('aria-hidden', 'true');
            item.append(icon, text(document, 'strong', component));
            components.append(item);
        }
        target?.append(components);
    }

    function renderGuide(state) {
        const questions = node('novel_mode_guide_questions');
        const suggestions = node('novel_mode_guide_suggestions');
        clear(questions);
        clear(suggestions);
        if (state.audience !== 'author') {
            suggestions?.append(text(document, 'p', 'World Guide is available to authors.', 'novel-mode-empty'));
            return;
        }
        if (!state.guide) {
            suggestions?.append(text(document, 'p', 'No guide proposal.', 'novel-mode-empty'));
            return;
        }
        for (const question of state.guide.questions || []) {
            const label = document.createElement('label');
            label.className = 'novel-mode-guide-question';
            const input = document.createElement('input');
            input.type = 'text';
            input.dataset.novelQuestionId = question.id;
            input.maxLength = 10_000;
            label.append(text(document, 'span', question.prompt), input);
            questions?.append(label);
        }
        for (const suggestion of state.guide.suggestions || []) {
            const card = document.createElement('article');
            card.className = 'novel-mode-guide-suggestion';
            const header = document.createElement('header');
            header.append(
                text(document, 'strong', suggestion.item?.title || suggestion.suggestionId),
                text(document, 'span', suggestion.item?.itemType || 'proposal'),
            );
            const action = document.createElement('button');
            action.className = 'menu_button';
            action.type = 'button';
            action.dataset.novelConfirmSuggestion = suggestion.suggestionId;
            action.disabled = Boolean(suggestion.confirmed) || state.busy;
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-check';
            icon.setAttribute('aria-hidden', 'true');
            action.append(icon, text(document, 'span', suggestion.confirmed ? 'Confirmed' : 'Confirm'));
            card.append(header, text(document, 'p', suggestion.rationale || ''), action);
            suggestions?.append(card);
        }
    }

    function renderStage(state) {
        const target = node('novel_mode_stage_text');
        clear(target);
        const prose = text(
            document,
            'p',
            state.stage.text || 'Choose a project and opening route to enter the stage.',
            state.stage.text ? '' : 'novel-mode-empty',
        );
        target?.append(prose);
        const components = node('novel_mode_stage_components');
        clear(components);
        for (const component of state.stage.components || []) {
            components?.append(renderNovelComponent(document, component, { audience: state.audience }));
        }
        const selectedScene = state.scenes.find(scene => scene.id === state.selection.sceneId);
        setText('novel_mode_stage_location', state.openingRoute?.title || selectedScene?.title || 'No scene selected');
        setText('novel_mode_stage_tick', state.branch?.storyTick == null ? 'Story tick --' : `Story tick ${state.branch.storyTick}`);
        setText('novel_mode_workspace_turn_status', state.stage.status || 'Idle');
    }

    function renderDirector(state) {
        const branch = state.branch;
        setText('novel_mode_director_status', state.access?.canDirect ? 'Author control' : 'Player read-only');
        const branchInput = node('novel_mode_workspace_branch');
        if (branchInput instanceof HTMLInputElement && document.activeElement !== branchInput) branchInput.value = branch?.id || '';
        if (branchInput instanceof HTMLInputElement) branchInput.disabled = !state.access?.canDirect;
        const branchButton = node('novel_mode_load_branch');
        if (branchButton instanceof HTMLButtonElement) branchButton.disabled = !authorEnabled(state);
        const recallButton = node('novel_mode_refresh_recall');
        if (recallButton instanceof HTMLButtonElement) recallButton.disabled = state.busy || state.access?.role !== 'author';
        for (const id of ['novel_mode_context_pack', 'novel_mode_recall_pov']) {
            const input = node(id);
            if (input instanceof HTMLInputElement) input.disabled = state.access?.role !== 'author';
        }
        const audience = node('novel_mode_workspace_audience');
        if (audience instanceof HTMLSelectElement) {
            audience.value = state.audience;
            const option = audience.querySelector('option[value="author"]');
            if (option instanceof HTMLOptionElement) option.disabled = state.access?.role === 'player';
        }
        const target = node('novel_mode_director_summary');
        clear(target);
        for (const [label, value] of [
            ['Project', state.project?.id || '--'],
            ['World revision', state.world?.revision ?? '--'],
            ['World status', state.world?.status || '--'],
            ['Branch head', state.audience === 'author' ? (branch?.headCommitId || '--') : '--'],
            ['Access', state.access?.role || '--'],
            ['Onboarding', state.onboarding],
        ]) target?.append(text(document, 'div', `${label}: ${value}`));
    }

    function renderRecall(state) {
        const target = node('novel_mode_recall_diagnostic');
        clear(target);
        if (state.access?.role === 'player') {
            setText('novel_mode_recall_status', 'Author only');
            target?.append(text(document, 'p', 'Recall diagnostics require an author session.', 'novel-mode-empty'));
            return;
        }
        const recall = state.recall;
        setText('novel_mode_recall_status', recall?.available ? `${recall.entries?.length || 0} loaded` : 'No Context Pack');
        if (!recall?.available) {
            target?.append(text(document, 'p', 'No recall trace is available for this branch.', 'novel-mode-empty'));
            return;
        }
        target?.append(text(
            document,
            'div',
            `${recall.contextPackId} / ${recall.tokenCount || 0} of ${recall.tokenBudget || 0} tokens`,
            'novel-mode-recall-summary',
        ));
        for (const entry of recall.entries || []) {
            const row = document.createElement('article');
            row.className = 'novel-mode-recall-row';
            const header = document.createElement('header');
            header.append(
                text(document, 'strong', entry.recordType || entry.fragmentId),
                text(document, 'span', `${entry.recallReason || 'unknown'} / ${entry.tokenCount || 0}`),
            );
            const decision = entry.decision || Object.entries(entry.decisions || {})
                .map(([role, value]) => `${role}:${value}`)
                .join(' / ');
            row.append(
                header,
                text(document, 'p', `${(entry.visibility || []).join(', ')} / ${decision || '--'}`),
                text(document, 'pre', preview(entry.content, 640)),
            );
            target?.append(row);
        }
    }

    function renderImport(state) {
        const importState = getImportState();
        const target = node('novel_mode_character_import_summary');
        const confirm = node('novel_mode_character_import_confirm');
        clear(target);
        if (!importState.preview) {
            target?.append(text(document, 'p', 'No content import preview.', 'novel-mode-empty'));
            setText('novel_mode_character_import_status', 'No preview');
            if (confirm instanceof HTMLButtonElement) confirm.disabled = true;
            return;
        }
        const summary = importState.kind === 'world-info'
            ? worldInfoImportSummary(importState.preview)
            : importState.kind === 'chat' || importState.kind === 'swipe'
                ? chatImportSummary(importState.preview)
                : characterImportSummary(importState.preview);
        const fields = importState.kind === 'world-info'
            ? [
                ['Entries', summary.entries], ['Entities', summary.classifications.entity],
                ['Rules', summary.classifications.rule], ['Claims', summary.classifications.claim],
                ['Style', summary.classifications.style], ['References', summary.classifications.reference],
                ['Conflicts', summary.conflicts], ['Warnings', summary.warnings], ['Trust', summary.trust],
            ]
            : importState.kind === 'chat' || importState.kind === 'swipe'
                ? [
                    ['Messages', summary.messages], ['User messages', summary.userMessages],
                    ['Assistant messages', summary.assistantMessages], ['System messages', summary.systemMessages],
                    ['Swipes', summary.swipes], ['Fact proposals', summary.factProposals],
                    ['Skipped', summary.skipped], ['Warnings', summary.warnings],
                    ['Trust', summary.trust], ['Canonical', summary.canonical],
                    ['Fact review', summary.factReviewMode],
                ]
                : [
                    ['Character', summary.name], ['Persona', summary.persona || '--'],
                    ['Style samples', summary.styleSamples], ['Opening draft', summary.openingDraft ? 'Mapped' : '--'],
                    ['Warnings', summary.warnings], ['Trust', summary.trust],
                ];
        fields.forEach(([label, value]) => target?.append(text(document, 'div', `${label}: ${value}`)));
        if (importState.kind === 'chat' || importState.kind === 'swipe') {
            const mappings = importState.preview.mappings || {};
            const messages = document.createElement('div');
            messages.className = 'novel-mode-chat-import-messages';
            for (const message of (Array.isArray(mappings.messages) ? mappings.messages : []).slice(0, 200)) {
                const row = document.createElement('article');
                row.className = 'novel-mode-chat-import-message';
                row.append(text(
                    document,
                    'strong',
                    `${message.role || 'assistant'}${message.speakerName ? ` / ${message.speakerName}` : ''}`,
                ));
                row.append(text(document, 'p', String(message.text || '').slice(0, 4_000)));
                if (Array.isArray(message.swipes) && message.swipes.length) {
                    const swipes = document.createElement('ul');
                    swipes.className = 'novel-mode-chat-import-swipes';
                    for (const swipe of message.swipes.slice(0, 100)) {
                        swipes.append(text(
                            document,
                            'li',
                            `${swipe.selected ? '[selected] ' : '[alternative] '}#${Number(swipe.swipeIndex) + 1}: ${String(swipe.text || '').slice(0, 2_000)}`,
                        ));
                    }
                    row.append(swipes);
                }
                messages.append(row);
            }
            if (messages.childElementCount) target?.append(
                text(document, 'h4', 'Imported messages', 'novel-mode-import-section-heading'),
                messages,
            );
            const proposals = Array.isArray(mappings.factProposals) ? mappings.factProposals : [];
            if (proposals.length) {
                const list = document.createElement('ul');
                list.className = 'novel-mode-chat-import-fact-proposals';
                for (const proposal of proposals.slice(0, 200)) {
                    list.append(text(document, 'li', `${proposal.proposalId}: ${String(proposal.statement || '').slice(0, 2_000)}`));
                }
                target?.append(text(document, 'h4', 'Fact evidence proposals', 'novel-mode-import-section-heading'), list);
            }
            const skipped = Array.isArray(mappings.skipped) ? mappings.skipped : [];
            if (skipped.length) {
                const list = document.createElement('ul');
                list.className = 'novel-mode-chat-import-skipped';
                for (const item of skipped.slice(0, 200)) list.append(text(
                    document,
                    'li',
                    `${item.sourcePath || '--'}: ${item.reason || 'Skipped'}`,
                ));
                target?.append(text(document, 'h4', 'Skipped source items', 'novel-mode-import-section-heading'), list);
            }
        }
        if (importState.kind === 'world-info' && importState.reviews.length) {
            target?.append(text(
                document,
                'div',
                `Review queue: ${importState.reviews.filter(item => item.status === 'pending').length} pending`,
                'novel-mode-import-review-heading',
            ));
            for (const review of importState.reviews) {
                const row = document.createElement('div');
                row.className = 'novel-mode-import-review-row';
                row.append(text(document, 'span', `${review.entry?.classification || 'reference'}: ${review.entry?.title || review.id}`));
                if (review.status === 'pending' && state.audience === 'author') {
                    for (const [decision, iconName, title] of [
                        ['accept', 'fa-check', 'Accept tentative mapping'],
                        ['reject', 'fa-xmark', 'Reject imported entry'],
                    ]) {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'menu_button interactable';
                        button.title = title;
                        button.setAttribute('aria-label', title);
                        const icon = document.createElement('i');
                        icon.className = `fa-solid ${iconName}`;
                        icon.setAttribute('aria-hidden', 'true');
                        button.append(icon);
                        button.addEventListener('click', () => onReviewWorldInfo(review.id, decision));
                        row.append(button);
                    }
                } else row.append(text(document, 'span', review.status));
                target?.append(row);
            }
        }
        setText('novel_mode_character_import_status', importState.preview.alreadyImported ? 'Already imported' : 'Preview ready');
        if (confirm instanceof HTMLButtonElement) {
            confirm.disabled = !loadSettings().enabled || state.busy || !summary.canImport || state.audience !== 'author';
        }
    }

    function renderControls(state) {
        setText('novel_mode_workspace_title', state.project?.title || 'Untitled story');
        setText('novel_mode_workspace_status', state.error || (state.busy ? 'Working...' : 'Connected'));
        setText('novel_mode_story_inspector_status', state.stage.status || 'Idle');
        setText('novel_mode_story_inspector_world', state.world?.status || 'Not loaded');
        setText('novel_mode_story_inspector_branch', state.branch?.id || '--');
        setText('novel_mode_story_inspector_access', state.access?.role || '--');
        setText('novel_mode_guide_status', state.guide ? 'Proposal ready' : 'Draft');
        setText('novel_mode_world_status', state.world?.status || 'Not loaded');
        const controls = [
            ['novel_mode_lock_world', !authorEnabled(state) || state.world?.status === 'locked'],
            ['novel_mode_reopen_world', !authorEnabled(state) || state.world?.status !== 'locked'],
            ['novel_mode_validate_world', !authorEnabled(state)],
            ['novel_mode_propose_guide', !authorEnabled(state)],
            ['novel_mode_import_guide', !authorEnabled(state)],
            ['novel_mode_character_import_preview', !loadSettings().enabled || !authorEnabled(state) || !state.project],
            ['novel_mode_new_story', !loadSettings().enabled || state.access?.role === 'player'],
            ['novel_mode_enter_stage', state.busy || !state.openingRoute || !(
                (state.povOptions || []).some(option => option?.id === node('novel_mode_pov_entity')?.value
                    && option.role === 'playable')
            )],
        ];
        controls.forEach(([id, disabled]) => {
            const button = node(id);
            if (button instanceof HTMLButtonElement) button.disabled = Boolean(disabled);
        });
        document.querySelectorAll('[data-novel-workspace-mode]').forEach(button => {
            if (!(button instanceof HTMLButtonElement)) return;
            const direct = button.dataset.novelWorkspaceMode === 'direct';
            button.disabled = state.busy || (direct && !state.access?.canUseDirect);
        });
        const actionState = getActionState?.() || {};
        const retry = node('novel_mode_workspace_retry');
        if (retry instanceof HTMLButtonElement) retry.disabled = state.busy || !actionState.lastTurn;
        const accept = node('novel_mode_workspace_accept');
        if (accept instanceof HTMLButtonElement) {
            accept.disabled = state.busy || !state.access?.canDirect
                || state.stage.status !== 'awaiting_approval' || !actionState.acceptPayload;
            accept.title = actionState.acceptPayload
                ? 'Accept canonical proposal'
                : 'Waiting for a complete canonical proposal payload';
        }
        const stop = node('novel_mode_workspace_stop');
        if (stop instanceof HTMLButtonElement) stop.disabled = !['planning', 'writing', 'validating', 'committing'].includes(state.stage.status);
    }

    function render() {
        const state = getState();
        renderTabs(state);
        renderSelects(state);
        renderOnboarding(state);
        renderGuide(state);
        renderWorld(state);
        renderArchitecture(state);
        renderPerformance(state);
        renderStage(state);
        renderDirector(state);
        renderRecall(state);
        renderImport(state);
        renderControls(state);
        return state;
    }

    return Object.freeze({ render });
}
