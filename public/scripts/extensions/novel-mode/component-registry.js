const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const AUDIENCES = Object.freeze(['author', 'player']);
const UNSAFE_KEY = /^(?:__proto__|prototype|constructor|html|innerhtml|outerhtml|script|srcdoc|dangerouslysetinnerhtml|on[a-z]+)$/i;

function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function safeJson(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
        const valid = value.length <= 100 && value.every(child => safeJson(child, seen));
        seen.delete(value);
        return valid;
    }
    if (!plainObject(value)) {
        seen.delete(value);
        return false;
    }
    const entries = Object.entries(value);
    const valid = entries.length <= 100 && entries.every(([key, child]) => (
        key.length > 0 && key.length <= 128 && !UNSAFE_KEY.test(key) && safeJson(child, seen)
    ));
    seen.delete(value);
    return valid;
}

function boundedString(value, maximum = 100_000) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function optionalString(value, maximum = 2_000) {
    return value === undefined || value === null || (typeof value === 'string' && value.length <= maximum);
}

function onlyKeys(value, allowed) {
    return plainObject(value) && Object.keys(value).every(key => allowed.has(key));
}

function requiredProps(values) {
    return Object.freeze([...values]);
}

function textElement(document, tagName, text, className = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    node.textContent = text;
    return node;
}

function renderState(document, props, identityLabel) {
    const fragment = document.createDocumentFragment();
    fragment.append(textElement(document, 'strong', props.name, 'novel-component-title'));
    const identity = document.createElement('span');
    identity.className = 'novel-component-identity';
    identity.textContent = `${identityLabel}: ${props.entityId || props.locationId}`;
    fragment.append(identity);
    const list = document.createElement('dl');
    list.className = 'novel-component-state-list';
    for (const [key, value] of Object.entries(props.state || {})) {
        list.append(
            textElement(document, 'dt', key),
            textElement(document, 'dd', typeof value === 'string' ? value : JSON.stringify(value)),
        );
    }
    fragment.append(list);
    return fragment;
}

function validateProjectionProps(props, identityKey) {
    const allowed = new Set([
        identityKey,
        'name',
        'state',
        'committed',
        'commitId',
        'projectionVersion',
        'compact',
    ]);
    return onlyKeys(props, allowed)
        && OPAQUE_ID.test(props[identityKey] || '')
        && boundedString(props.name, 240)
        && plainObject(props.state)
        && safeJson(props.state)
        && props.committed === true
        && OPAQUE_ID.test(props.commitId || '')
        && Number.isInteger(props.projectionVersion)
        && props.projectionVersion > 0
        && (props.compact === undefined || typeof props.compact === 'boolean');
}

const registry = {
    narration: {
        requiredProps: requiredProps(['text']),
        validate: props => onlyKeys(props, new Set(['text', 'label']))
            && boundedString(props.text)
            && optionalString(props.label, 240),
        fallback: props => props.text,
        render(document, props) {
            const fragment = document.createDocumentFragment();
            if (props.label) fragment.append(textElement(document, 'span', props.label, 'novel-component-eyebrow'));
            fragment.append(textElement(document, 'p', props.text));
            return fragment;
        },
    },
    dialogue: {
        requiredProps: requiredProps(['speaker', 'text']),
        validate: props => onlyKeys(props, new Set(['speaker', 'text', 'emotion']))
            && boundedString(props.speaker, 240)
            && boundedString(props.text)
            && optionalString(props.emotion, 120),
        fallback: props => `${props.speaker}: ${props.text}`,
        render(document, props) {
            const fragment = document.createDocumentFragment();
            const header = textElement(document, 'header', props.speaker, 'novel-component-speaker');
            if (props.emotion) header.append(textElement(document, 'span', ` / ${props.emotion}`));
            fragment.append(header, textElement(document, 'blockquote', props.text));
            return fragment;
        },
    },
    'choice-set': {
        requiredProps: requiredProps(['choices']),
        validate: props => onlyKeys(props, new Set(['prompt', 'choices']))
            && optionalString(props.prompt, 2_000)
            && Array.isArray(props.choices)
            && props.choices.length > 0
            && props.choices.length <= 8
            && props.choices.every(choice => (
                onlyKeys(choice, new Set(['actionId', 'label', 'input', 'mode']))
                && OPAQUE_ID.test(choice.actionId || '')
                && boundedString(choice.label, 120)
                && boundedString(choice.input, 4_000)
                && ['act', 'speak', 'narrate'].includes(choice.mode)
            )),
        fallback: props => [props.prompt, ...props.choices.map((choice, index) => `${index + 1}. ${choice.label}`)]
            .filter(Boolean)
            .join('\n'),
        render(document, props) {
            const fieldset = document.createElement('fieldset');
            fieldset.className = 'novel-component-choices';
            fieldset.append(textElement(document, 'legend', props.prompt || 'Choose an action'));
            for (const choice of props.choices) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'menu_button';
                button.dataset.novelChoiceInput = choice.input;
                button.dataset.novelChoiceMode = choice.mode;
                button.textContent = choice.label;
                fieldset.append(button);
            }
            return fieldset;
        },
    },
    'character-status': {
        authority: true,
        requiredProps: requiredProps([
            'entityId', 'name', 'state', 'committed', 'commitId', 'projectionVersion',
        ]),
        validate: props => validateProjectionProps(props, 'entityId'),
        fallback: props => `${props.name}: ${JSON.stringify(props.state)}`,
        render: (document, props) => renderState(document, props, 'Character'),
    },
    'location-status': {
        authority: true,
        requiredProps: requiredProps([
            'locationId', 'name', 'state', 'committed', 'commitId', 'projectionVersion',
        ]),
        validate: props => validateProjectionProps(props, 'locationId'),
        fallback: props => `${props.name}: ${JSON.stringify(props.state)}`,
        render: (document, props) => renderState(document, props, 'Location'),
    },
    artifact: {
        requiredProps: requiredProps(['title', 'body']),
        validate: props => onlyKeys(props, new Set(['title', 'body', 'kind']))
            && boundedString(props.title, 240)
            && boundedString(props.body)
            && optionalString(props.kind, 120),
        fallback: props => `${props.title}\n${props.body}`,
        render(document, props) {
            const fragment = document.createDocumentFragment();
            if (props.kind) fragment.append(textElement(document, 'span', props.kind, 'novel-component-eyebrow'));
            fragment.append(
                textElement(document, 'strong', props.title, 'novel-component-title'),
                textElement(document, 'pre', props.body),
            );
            return fragment;
        },
    },
    'image-scene': {
        requiredProps: requiredProps(['assetId', 'alt']),
        validate: props => onlyKeys(props, new Set(['assetId', 'alt', 'caption']))
            && OPAQUE_ID.test(props.assetId || '')
            && boundedString(props.alt, 2_000)
            && optionalString(props.caption, 2_000),
        fallback: props => props.caption || props.alt,
        render(document, props) {
            const figure = document.createElement('figure');
            figure.dataset.assetId = props.assetId;
            const placeholder = document.createElement('div');
            placeholder.className = 'novel-component-image-placeholder';
            placeholder.setAttribute('role', 'img');
            placeholder.setAttribute('aria-label', props.alt);
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-image';
            icon.setAttribute('aria-hidden', 'true');
            placeholder.append(icon, textElement(document, 'span', props.alt));
            figure.append(placeholder);
            if (props.caption) figure.append(textElement(document, 'figcaption', props.caption));
            return figure;
        },
    },
    'audio-cue': {
        requiredProps: requiredProps(['assetId', 'label', 'channel', 'action']),
        validate: props => onlyKeys(props, new Set(['assetId', 'label', 'channel', 'action', 'loop']))
            && OPAQUE_ID.test(props.assetId || '')
            && boundedString(props.label, 240)
            && ['bgm', 'ambient', 'voice', 'sfx'].includes(props.channel)
            && ['play', 'pause', 'stop'].includes(props.action)
            && (props.loop === undefined || typeof props.loop === 'boolean'),
        fallback: props => `${props.label} (${props.channel}: ${props.action})`,
        render(document, props) {
            const fragment = document.createDocumentFragment();
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-volume-high';
            icon.setAttribute('aria-hidden', 'true');
            fragment.append(
                icon,
                textElement(document, 'strong', props.label),
                textElement(document, 'span', `${props.channel} / ${props.action}${props.loop ? ' / loop' : ''}`),
            );
            return fragment;
        },
    },
};

for (const definition of Object.values(registry)) {
    definition.schemaVersion = 1;
    definition.visibility = AUDIENCES;
    definition.authority = definition.authority === true;
    definition.propsSchema = Object.freeze({
        schemaVersion: 1,
        requiredProps: definition.requiredProps,
        parse(value) {
            if (!plainObject(value) || !safeJson(value) || !definition.validate(value)) {
                throw new TypeError('Novel component props do not match the registered schema.');
            }
            return structuredClone(value);
        },
    });
    Object.freeze(definition);
}

export const NOVEL_COMPONENT_REGISTRY = Object.freeze(registry);
export const NOVEL_COMPONENT_TYPES = Object.freeze(Object.keys(registry));
export const NOVEL_COMPONENT_MANIFEST = Object.freeze(Object.fromEntries(
    Object.entries(registry).map(([componentType, definition]) => [componentType, Object.freeze({
        componentType,
        schemaVersion: definition.schemaVersion,
        authority: definition.authority,
        visibility: definition.visibility,
        requiredProps: definition.requiredProps,
    })]),
));

export function getNovelComponentDefinition(componentType) {
    return NOVEL_COMPONENT_REGISTRY[componentType] || null;
}

export function validateNovelComponentPayload(component, { audience = 'author' } = {}) {
    if (!plainObject(component)) throw new TypeError('Novel component must be an object.');
    const definition = getNovelComponentDefinition(component.componentType);
    if (!definition) throw new TypeError('Novel component type is not registered.');
    if (!definition.visibility.includes(audience)) throw new TypeError('Novel component is not visible to this audience.');
    if (!OPAQUE_ID.test(component.componentId || '')) throw new TypeError('Novel component ID is invalid.');
    const componentVersion = component.componentVersion ?? definition.schemaVersion;
    if (componentVersion !== definition.schemaVersion) throw new TypeError('Novel component version is unsupported.');
    const visibility = component.visibility ?? definition.visibility;
    if (
        !Array.isArray(visibility)
        || visibility.length < 1
        || visibility.length > definition.visibility.length
        || new Set(visibility).size !== visibility.length
        || visibility.some(value => !definition.visibility.includes(value))
        || !visibility.includes(audience)
    ) throw new TypeError('Novel component visibility is invalid.');
    const fallbackText = component.fallbackText ?? novelComponentFallbackText(component, { audience });
    if (!boundedString(fallbackText)) throw new TypeError('Novel component fallback text is invalid.');
    if (!Number.isInteger(component.revision) || component.revision < 0) throw new TypeError('Novel component revision is invalid.');
    if (typeof component.provisional !== 'boolean') throw new TypeError('Novel component provisional marker is invalid.');
    if (definition.authority && component.provisional) throw new TypeError('Authority components cannot be provisional.');
    const props = definition.propsSchema.parse(component.props);
    return {
        ...component,
        componentVersion,
        visibility: [...visibility],
        fallbackText,
        props,
    };
}

export function novelComponentFallbackText(component, { audience = 'author' } = {}) {
    const definition = getNovelComponentDefinition(component?.componentType);
    const visibility = Array.isArray(component?.visibility)
        ? component.visibility
        : definition?.visibility;
    if (
        !['author', 'player'].includes(audience)
        || !Array.isArray(visibility)
        || !visibility.includes(audience)
    ) return 'This structured Novel component is unavailable.';
    if (boundedString(component?.fallbackText)) return component.fallbackText;
    if (!definition || !plainObject(component?.props) || !safeJson(component.props)) {
        return 'This structured Novel component is unavailable.';
    }
    try {
        const value = definition.fallback(component.props);
        return boundedString(value) ? value : 'This structured Novel component is unavailable.';
    } catch {
        return 'This structured Novel component is unavailable.';
    }
}

export function renderNovelComponent(document, component, { audience = 'author' } = {}) {
    const wrapper = document.createElement('article');
    wrapper.className = 'novel-component novel-component-fallback';
    try {
        const normalized = validateNovelComponentPayload(component, { audience });
        const definition = getNovelComponentDefinition(normalized.componentType);
        wrapper.className = `novel-component novel-component-${normalized.componentType}`;
        wrapper.dataset.componentId = normalized.componentId;
        wrapper.dataset.componentType = normalized.componentType;
        wrapper.dataset.componentSchemaVersion = String(definition.schemaVersion);
        wrapper.dataset.componentVisibility = normalized.visibility.join(',');
        wrapper.append(definition.render(document, normalized.props));
    } catch {
        wrapper.textContent = novelComponentFallbackText(component, { audience });
    }
    return wrapper;
}
