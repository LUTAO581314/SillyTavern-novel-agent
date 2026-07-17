const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNSAFE_COMPONENT_KEY = /^(?:__proto__|prototype|constructor|html|innerhtml|outerhtml|script|srcdoc|dangerouslysetinnerhtml|on[a-z]+)$/i;

export const SUPPORTED_RENDER_EVENT_TYPES = Object.freeze([
    'turn.accepted',
    'plan.ready',
    'stage.changed',
    'prose.delta',
    'component.upsert',
    'component.remove',
    'media.cue',
    'choices.set',
    'validation.issue',
    'state.preview',
    'turn.awaiting_approval',
    'turn.committed',
    'projection.updated',
    'turn.stale',
    'turn.cancelled',
    'turn.failed',
]);

const SUPPORTED_TYPES = new Set(SUPPORTED_RENDER_EVENT_TYPES);
const AUTHORITY_COMPONENT_TYPES = new Set(['character-status', 'location-status']);
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
const AUTHOR_ONLY_TYPES = new Set(['plan.ready', 'state.preview']);
const STAGES = new Set([
    'planning',
    'writing',
    'validating',
    'awaiting_approval',
    'committing',
    'committed',
    'stale',
    'cancelled',
    'failed',
]);

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isOpaqueId(value) {
    return typeof value === 'string' && OPAQUE_ID.test(value);
}

function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
}

function isSafeJson(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (typeof value !== 'object' || seen.has(value)) {
        return false;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        const valid = value.every(child => isSafeJson(child, seen));
        seen.delete(value);
        return valid;
    }
    if (!isPlainObject(value)) {
        seen.delete(value);
        return false;
    }
    for (const [key, child] of Object.entries(value)) {
        if (!key || key.length > 128 || UNSAFE_COMPONENT_KEY.test(key) || !isSafeJson(child, seen)) {
            seen.delete(value);
            return false;
        }
    }
    seen.delete(value);
    return true;
}

function requirePayloadObject(payload) {
    if (!isPlainObject(payload)) {
        throw new TypeError('Render payload must be an object.');
    }
    return payload;
}

function requireString(value, label, maximum = 64_000) {
    if (typeof value !== 'string' || !value || value.length > maximum) {
        throw new TypeError(`${label} must be a bounded string.`);
    }
    return value;
}

function requireOpaqueId(value, label) {
    if (!isOpaqueId(value)) {
        throw new TypeError(`${label} must be an opaque identifier.`);
    }
    return value;
}

export function createInitialNovelView() {
    return {
        turnId: null,
        commitId: null,
        text: '',
        components: [],
        stage: 'idle',
        projectionVersion: null,
        lastEventId: null,
        lastSeq: -1,
    };
}

function fallbackFor(reason) {
    return Object.freeze({
        reason,
        text: 'This Novel event cannot be displayed by the current client version.',
    });
}

export class NovelRenderEventDispatcher {
    #audience;
    #onFallback;
    #seenEventIds = new Set();
    #view = createInitialNovelView();

    constructor({ audience = 'author', onFallback = () => {} } = {}) {
        if (!['author', 'player'].includes(audience)) {
            throw new TypeError('Novel view audience must be author or player.');
        }
        if (typeof onFallback !== 'function') {
            throw new TypeError('Novel fallback handler must be a function.');
        }
        this.#audience = audience;
        this.#onFallback = onFallback;
    }

    get view() {
        return clone(this.#view);
    }

    reset() {
        this.#seenEventIds.clear();
        this.#view = createInitialNovelView();
        return this.view;
    }

    #fallback(reason) {
        const fallback = fallbackFor(reason);
        this.#onFallback(fallback);
        return { status: 'fallback', fallback };
    }

    #apply(event) {
        const { type, payload } = event.render;
        const value = requirePayloadObject(payload);

        switch (type) {
            case 'turn.accepted':
                requireOpaqueId(value.baseCommitId, 'Base commit ID');
                if (!['cowrite', 'play'].includes(value.mode)) throw new TypeError('Invalid turn mode.');
                this.#view.stage = 'accepted';
                break;
            case 'plan.ready':
                if (!isPlainObject(value.plan) || value.plan.turnId !== event.turn_id) {
                    throw new TypeError('Plan does not belong to the current turn.');
                }
                this.#view.stage = 'planned';
                break;
            case 'stage.changed':
                if (!STAGES.has(value.stage)) throw new TypeError('Invalid Novel stage.');
                this.#view.stage = value.stage;
                break;
            case 'prose.delta':
                requireOpaqueId(value.blockId, 'Prose block ID');
                requireString(value.delta, 'Prose delta');
                if (value.provisional !== true) throw new TypeError('Prose delta must be provisional.');
                this.#view.text += value.delta;
                break;
            case 'component.upsert': {
                const componentId = requireOpaqueId(value.componentId, 'Component ID');
                if (!COMPONENT_TYPES.has(value.componentType)) throw new TypeError('Unknown component type.');
                if (!isNonNegativeInteger(value.revision)) throw new TypeError('Invalid component revision.');
                if (typeof value.provisional !== 'boolean') throw new TypeError('Invalid provisional marker.');
                if (AUTHORITY_COMPONENT_TYPES.has(value.componentType) && value.provisional) {
                    throw new TypeError('Authority components cannot be provisional.');
                }
                if (!isPlainObject(value.props) || !isSafeJson(value.props)) {
                    throw new TypeError('Unsafe component properties.');
                }
                const component = clone(value);
                const index = this.#view.components.findIndex(item => item.componentId === componentId);
                if (index >= 0 && this.#view.components[index].revision > component.revision) {
                    throw new TypeError('Component revision moved backwards.');
                }
                if (index >= 0) this.#view.components[index] = component;
                else this.#view.components.push(component);
                break;
            }
            case 'component.remove': {
                const componentId = requireOpaqueId(value.componentId, 'Component ID');
                if (!isNonNegativeInteger(value.revision)) throw new TypeError('Invalid component revision.');
                this.#view.components = this.#view.components.filter(item => item.componentId !== componentId);
                break;
            }
            case 'media.cue':
                requireOpaqueId(value.assetId, 'Asset ID');
                if (!['bgm', 'ambient', 'voice', 'sfx'].includes(value.channel)) throw new TypeError('Invalid media channel.');
                if (!['play', 'pause', 'stop'].includes(value.action)) throw new TypeError('Invalid media action.');
                break;
            case 'choices.set':
                if (!Array.isArray(value.choices) || value.choices.length > 8) throw new TypeError('Invalid choices.');
                break;
            case 'validation.issue':
                if (!isPlainObject(value.issue)) throw new TypeError('Invalid validation issue.');
                break;
            case 'state.preview':
                if (!Array.isArray(value.commands) || value.commands.some(command => command?.turnId !== event.turn_id)) {
                    throw new TypeError('Invalid state preview.');
                }
                break;
            case 'turn.awaiting_approval':
                requireString(value.summary, 'Approval summary', 2_000);
                if (!isNonNegativeInteger(value.blockingIssueCount)) throw new TypeError('Invalid issue count.');
                this.#view.stage = 'awaiting_approval';
                break;
            case 'turn.committed':
                this.#view.commitId = requireOpaqueId(value.commitId, 'Commit ID');
                requireString(value.committedAt, 'Commit timestamp', 128);
                this.#view.stage = 'committed';
                break;
            case 'projection.updated':
                if (value.committed !== true || !isNonNegativeInteger(value.projectionVersion) || value.projectionVersion < 1) {
                    throw new TypeError('Invalid committed projection update.');
                }
                requireOpaqueId(value.commitId, 'Projection commit ID');
                if (this.#view.commitId && value.commitId !== this.#view.commitId) {
                    throw new TypeError('Projection commit does not match the displayed commit.');
                }
                if (!Array.isArray(value.changedEntityIds) || value.changedEntityIds.some(id => !isOpaqueId(id))) {
                    throw new TypeError('Invalid projection entity IDs.');
                }
                this.#view.projectionVersion = value.projectionVersion;
                break;
            case 'turn.stale':
                requireOpaqueId(value.expectedCommitId, 'Expected commit ID');
                requireOpaqueId(value.actualCommitId, 'Actual commit ID');
                this.#view.stage = 'stale';
                break;
            case 'turn.cancelled':
                if (!['user', 'provider', 'disconnect', 'superseded'].includes(value.reason)) {
                    throw new TypeError('Invalid cancellation reason.');
                }
                this.#view.stage = 'cancelled';
                break;
            case 'turn.failed':
                if (typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(value.code)) {
                    throw new TypeError('Invalid failure code.');
                }
                requireString(value.message, 'Failure message', 2_000);
                if (typeof value.retryable !== 'boolean') throw new TypeError('Invalid retry marker.');
                this.#view.stage = 'failed';
                break;
            default:
                throw new TypeError('Unsupported render event.');
        }
    }

    dispatch(event) {
        if (!isPlainObject(event)) return this.#fallback('invalid-envelope');
        if (event.schema_version !== 1 || event.render?.schemaVersion !== 1) {
            return this.#fallback('unsupported-version');
        }
        if (
            !isOpaqueId(event.event_id) || !isOpaqueId(event.turn_id) ||
            !isNonNegativeInteger(event.seq) || !['author', 'player'].includes(event.audience) ||
            !isPlainObject(event.render) || !SUPPORTED_TYPES.has(event.render.type)
        ) {
            return this.#fallback('invalid-envelope');
        }
        if (event.audience !== this.#audience || (this.#audience !== 'author' && AUTHOR_ONLY_TYPES.has(event.render.type))) {
            return this.#fallback('audience-denied');
        }
        if (this.#seenEventIds.has(event.event_id) || event.seq <= this.#view.lastSeq) {
            return { status: 'duplicate' };
        }
        try {
            this.#apply(event);
        } catch {
            return this.#fallback('invalid-payload');
        }
        this.#seenEventIds.add(event.event_id);
        this.#view.turnId = event.turn_id;
        this.#view.lastEventId = event.event_id;
        this.#view.lastSeq = event.seq;
        return { status: 'applied', view: this.view };
    }

    dispatchAll(events) {
        if (!Array.isArray(events)) {
            throw new TypeError('Novel snapshot events must be an array.');
        }
        return events.map(event => this.dispatch(event));
    }
}
