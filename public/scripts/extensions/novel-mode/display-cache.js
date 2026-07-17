const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNSAFE_KEY = /^(?:__proto__|prototype|constructor|html|innerhtml|outerhtml|script|srcdoc|dangerouslysetinnerhtml|on[a-z]+)$/i;
const COMPONENT_TYPES = new Set([
    'narration',
    'dialogue',
    'choice-set',
    'character-status',
    'location-status',
    'artifact',
    'image-scene',
    'audio-cue',
]);

function cloneDisplayJson(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || seen.has(value)) throw new TypeError('Display cache contains a non-JSON value.');
    seen.add(value);
    if (Array.isArray(value)) {
        const result = value.map(child => cloneDisplayJson(child, seen));
        seen.delete(value);
        return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        seen.delete(value);
        throw new TypeError('Display cache contains a non-plain object.');
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (!key || key.length > 128 || UNSAFE_KEY.test(key)) {
            throw new TypeError('Display cache contains an unsafe component property.');
        }
        result[key] = cloneDisplayJson(child, seen);
    }
    seen.delete(value);
    return result;
}

function optionalOpaqueId(value, label) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
        throw new TypeError(`${label} must be an opaque identifier.`);
    }
    return value;
}

function requiredOpaqueId(value, label) {
    const result = optionalOpaqueId(value, label);
    if (!result) throw new TypeError(`${label} is required.`);
    return result;
}

export function createNovelMessageCache(view) {
    if (!view || typeof view !== 'object') throw new TypeError('Novel display view is required.');
    const text = typeof view.text === 'string' ? view.text : '';
    if (text.length > 1_000_000) throw new TypeError('Novel display text exceeds the cache limit.');
    const components = Array.isArray(view.components) ? view.components : [];

    return {
        schema_version: 1,
        turn_id: optionalOpaqueId(view.turnId, 'Turn ID'),
        commit_id: optionalOpaqueId(view.commitId, 'Commit ID'),
        text,
        components: components.map(component => {
            if (!COMPONENT_TYPES.has(component.componentType)) {
                throw new TypeError('Display cache contains an unknown component type.');
            }
            if (!Number.isInteger(component.revision) || component.revision < 0) {
                throw new TypeError('Display cache contains an invalid component revision.');
            }
            return {
                component_id: requiredOpaqueId(component.componentId, 'Component ID'),
                component_type: component.componentType,
                revision: component.revision,
                provisional: Boolean(component.provisional),
                props: cloneDisplayJson(component.props || {}),
            };
        }),
    };
}
