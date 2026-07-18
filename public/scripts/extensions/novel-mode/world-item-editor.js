const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const text = (key, label, options = {}) => ({ key, label, kind: 'text', ...options });
const area = (key, label, options = {}) => ({ key, label, kind: 'textarea', ...options });
const list = (key, label, options = {}) => ({ key, label, kind: 'list', ...options });
const number = (key, label, options = {}) => ({ key, label, kind: 'number', ...options });
const select = (key, label, values, options = {}) => ({ key, label, kind: 'select', values, ...options });
const enumList = (key, label, values, options = {}) => ({ key, label, kind: 'enum-list', values, ...options });
const checkbox = (key, label, options = {}) => ({ key, label, kind: 'checkbox', ...options });

// These are intentionally explicit. A ReplaceWorldBibleItem command carries a
// complete, schema-checked payload; the browser never accepts arbitrary JSON.
export const WORLD_ITEM_EDITORS = Object.freeze({
    project_facade: [
        area('synopsis', 'Synopsis'),
        list('tags', 'Tags'),
        text('audience', 'Audience'),
    ],
    narrative_constitution: [
        list('genres', 'Genres'),
        list('themes', 'Themes'),
        select('pov', 'Point of view', ['first', 'second', 'third_limited', 'third_omniscient', 'mixed']),
        select('tense', 'Tense', ['past', 'present', 'mixed']),
        list('styleGuidelines', 'Style guidelines'),
        list('contentBoundaries', 'Content boundaries'),
    ],
    style_sample: [text('label', 'Sample label'), area('text', 'Sample text')],
    world_constitution: [
        text('era', 'Era'),
        area('geography', 'Geography'),
        text('calendar', 'Calendar'),
        list('principles', 'Principles'),
    ],
    ai_free_zone: [area('scope', 'Scope'), list('allowed', 'Allowed'), list('prohibited', 'Prohibited')],
    entity: [
        text('entityId', 'Entity ID', { opaque: true }),
        select('entityType', 'Entity type', ['character', 'location', 'faction', 'item', 'concept']),
        text('canonicalName', 'Canonical name'),
        area('summary', 'Summary'),
    ],
    relationship: [
        text('fromEntityId', 'From entity', { opaque: true }),
        text('toEntityId', 'To entity', { opaque: true }),
        text('relationshipType', 'Relationship type'),
        area('summary', 'Summary'),
    ],
    initial_belief: [
        text('characterEntityId', 'Character entity', { opaque: true }),
        text('claimId', 'Claim ID', { opaque: true }),
        select('stance', 'Stance', ['believes', 'disbelieves', 'uncertain']),
        number('confidence', 'Confidence', { min: 0, max: 1, step: 0.01 }),
    ],
    reader_disclosure: [
        text('claimId', 'Claim ID', { opaque: true }),
        select('audience', 'Audience', ['reader', 'player', 'author']),
        select('mode', 'Disclosure mode', ['reveal', 'hint', 'mislead', 'correct']),
        area('summary', 'Summary'),
    ],
    mainline: [area('premise', 'Premise'), area('goal', 'Goal'), area('stakes', 'Stakes'), area('endCondition', 'End condition')],
    character_arc: [
        text('characterEntityId', 'Character entity', { opaque: true }),
        area('startState', 'Starting state'),
        area('desiredEndState', 'Desired end state'),
        list('beats', 'Beats'),
    ],
    chapter_goal: [
        text('chapterId', 'Chapter ID', { opaque: true }),
        area('goal', 'Goal'),
        list('successCriteria', 'Success criteria'),
    ],
    plot_anchor: [area('description', 'Description'), text('timing', 'Timing'), checkbox('required', 'Required')],
    task: [
        text('taskId', 'Task ID', { opaque: true }),
        text('title', 'Task title'),
        area('description', 'Description'),
        number('targetProgress', 'Target progress', { min: 1, max: 1_000_000, step: 1 }),
    ],
    foreshadow: [text('threadId', 'Thread ID', { opaque: true }), area('setup', 'Setup'), area('payoffCondition', 'Payoff condition')],
    simulation_policy: [
        number('horizon', 'Horizon', { min: 1, max: 1_000_000, step: 1 }),
        enumList('triggers', 'Triggers', ['chapter_end', 'major_event', 'time_jump', 'manual', 'horizon_exhausted']),
        select('approvalPolicy', 'Approval policy', ['manual', 'author_review']),
    ],
    interaction_rule: [
        text('authorRole', 'Author role'),
        list('playableEntityIds', 'Playable entity IDs', { opaqueItems: true }),
        enumList('inputModes', 'Input modes', ['act', 'speak', 'narrate', 'direct']),
    ],
    opening_route: [
        text('routeId', 'Route ID', { opaque: true }),
        text('title', 'Route title'),
        text('sceneId', 'Scene ID', { opaque: true, nullable: true }),
        area('premise', 'Premise'),
        list('entryConditions', 'Entry conditions'),
    ],
});

export function worldItemEditorFields(itemType) {
    const fields = WORLD_ITEM_EDITORS[itemType];
    return Array.isArray(fields) ? fields : null;
}

export function canEditWorldItem(item) {
    return Boolean(
        item
        && item.itemType !== 'hard_rule'
        && item.controlMode !== 'locked'
        && worldItemEditorFields(item.itemType),
    );
}

function listValue(value) {
    return Array.isArray(value) ? value.map(item => String(item)).join('\n') : '';
}

function fieldValue(field, payload) {
    const value = payload?.[field.key];
    if (field.kind === 'list') return listValue(value);
    if (field.kind === 'enum-list') return Array.isArray(value) ? value : [];
    if (field.kind === 'checkbox') return Boolean(value);
    return value == null ? '' : String(value);
}

function appendLabel(document, editor, field, payload) {
    const label = document.createElement('label');
    label.className = 'novel-mode-world-editor-field';
    label.append(document.createTextNode(field.label));
    let control;
    if (field.kind === 'select' || field.kind === 'enum-list') {
        control = document.createElement('select');
        if (field.kind === 'enum-list') control.multiple = true;
        for (const value of field.values || []) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            option.selected = field.kind === 'enum-list'
                ? fieldValue(field, payload).includes(value)
                : fieldValue(field, payload) === value;
            control.append(option);
        }
    } else if (field.kind === 'textarea' || field.kind === 'list') {
        control = document.createElement('textarea');
        control.rows = field.kind === 'list' ? 3 : 4;
        control.value = fieldValue(field, payload);
    } else if (field.kind === 'checkbox') {
        control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = fieldValue(field, payload);
    } else {
        control = document.createElement('input');
        control.type = field.kind === 'number' ? 'number' : 'text';
        control.value = fieldValue(field, payload);
        if (field.kind === 'number') {
            if (field.min != null) control.min = String(field.min);
            if (field.max != null) control.max = String(field.max);
            if (field.step != null) control.step = String(field.step);
        }
    }
    control.dataset.novelWorldEditField = field.key;
    control.dataset.novelWorldEditKind = field.kind;
    control.dataset.novelWorldEditNullable = String(field.nullable === true);
    control.dataset.novelWorldEditOpaque = String(field.opaque === true);
    control.dataset.novelWorldEditOpaqueItems = String(field.opaqueItems === true);
    label.append(control);
    editor.append(label);
}

export function renderWorldItemEditor(document, item) {
    if (!canEditWorldItem(item)) return null;
    const editor = document.createElement('form');
    editor.className = 'novel-mode-world-editor';
    editor.hidden = true;
    editor.dataset.novelWorldEditor = item.id;
    const title = document.createElement('label');
    title.className = 'novel-mode-world-editor-field';
    title.append(document.createTextNode('Title'));
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = item.title || '';
    titleInput.maxLength = 240;
    titleInput.dataset.novelWorldEditTitle = 'true';
    title.append(titleInput);
    editor.append(title);
    for (const field of worldItemEditorFields(item.itemType)) appendLabel(document, editor, field, item.payload || {});
    const actions = document.createElement('div');
    actions.className = 'novel-mode-world-editor-actions';
    for (const [action, icon, label] of [
        ['save', 'fa-check', 'Save item'],
        ['cancel', 'fa-xmark', 'Cancel edit'],
    ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button';
        button.dataset.novelWorldEdit = action;
        button.dataset.novelWorldItemId = item.id;
        button.title = label;
        button.setAttribute('aria-label', label);
        const glyph = document.createElement('i');
        glyph.className = `fa-solid ${icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        button.append(glyph, document.createTextNode(label));
        actions.append(button);
    }
    editor.append(actions);
    return editor;
}

function parseList(value) {
    return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

export function readWorldItemEditor(document, editor, item) {
    if (!editor || !canEditWorldItem(item)) throw new Error('This world item is not editable.');
    const title = editor.querySelector('[data-novel-world-edit-title]')?.value?.trim() || '';
    if (!title) throw new Error('World item title is required.');
    const payload = {};
    for (const field of worldItemEditorFields(item.itemType)) {
        const control = [...editor.querySelectorAll('[data-novel-world-edit-field]')]
            .find(candidate => candidate.dataset.novelWorldEditField === field.key);
        if (!control) throw new Error(`World editor field is missing: ${field.key}.`);
        let value;
        if (field.kind === 'checkbox') value = Boolean(control.checked);
        else if (field.kind === 'list') value = parseList(control.value);
        else if (field.kind === 'enum-list') value = [...control.selectedOptions].map(option => option.value);
        else if (field.kind === 'number') {
            value = Number(control.value);
            if (!Number.isFinite(value)) throw new Error(`${field.label} must be a number.`);
            if (Number.isInteger(field.step) && !Number.isInteger(value)) throw new Error(`${field.label} must be an integer.`);
        } else {
            const raw = control.value.trim();
            value = raw || (field.nullable ? null : '');
        }
        if (field.opaque && value !== null && !OPAQUE_ID.test(value)) throw new Error(`${field.label} must be an opaque identifier.`);
        if (field.opaqueItems && value.some(itemId => !OPAQUE_ID.test(itemId))) throw new Error(`${field.label} contains an invalid identifier.`);
        if (field.required !== false && (value === '' || (Array.isArray(value) && value.length === 0))) {
            throw new Error(`${field.label} is required.`);
        }
        payload[field.key] = value;
    }
    return { title, payload };
}
