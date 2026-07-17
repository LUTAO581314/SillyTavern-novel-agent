import { NovelRenderEventDispatcher } from './render-event-dispatcher.js';

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BINDING_KEYS = new Set([
    'projectId',
    'branchId',
    'chapterId',
    'sceneId',
    'resumeTurnId',
    'audience',
]);

export const NOVEL_INPUT_MODES = Object.freeze(['act', 'speak', 'narrate', 'direct']);
const PLAYER_MODES = new Set(['act', 'speak', 'narrate']);

function opaque(value, label, optional = false) {
    if (optional && (value === null || value === undefined || value === '')) return null;
    if (typeof value !== 'string' || !OPAQUE_ID.test(value)) {
        throw new TypeError(`Novel binding ${label} must be an opaque identifier.`);
    }
    return value;
}

function validateBinding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Novel binding must be an object.');
    }
    if (Object.keys(value).some(key => !BINDING_KEYS.has(key))) {
        throw new TypeError('Novel binding contains unsupported fields.');
    }
    if (!['author', 'player'].includes(value.audience)) {
        throw new TypeError('Novel binding audience must be author or player.');
    }
    return Object.freeze({
        projectId: opaque(value.projectId, 'project ID'),
        branchId: opaque(value.branchId, 'branch ID'),
        chapterId: opaque(value.chapterId, 'chapter ID'),
        sceneId: opaque(value.sceneId, 'scene ID'),
        resumeTurnId: opaque(value.resumeTurnId, 'resume turn ID', true),
        audience: value.audience,
    });
}

export class NovelModeSession {
    #binding = null;
    #dispatcher = new NovelRenderEventDispatcher();
    #onFallback;
    #runtimeClient;

    constructor({ runtimeClient, onFallback = () => {} } = {}) {
        if (!runtimeClient || typeof runtimeClient.snapshot !== 'function') {
            throw new TypeError('Novel Mode session requires a Runtime snapshot client.');
        }
        if (typeof onFallback !== 'function') {
            throw new TypeError('Novel Mode fallback handler must be a function.');
        }
        this.#runtimeClient = runtimeClient;
        this.#onFallback = onFallback;
    }

    get binding() {
        return this.#binding ? { ...this.#binding } : null;
    }

    get view() {
        return this.#dispatcher.view;
    }

    canUseMode(mode) {
        if (!NOVEL_INPUT_MODES.includes(mode) || !this.#binding) return false;
        return this.#binding.audience === 'author' || PLAYER_MODES.has(mode);
    }

    async bind(value, { signal } = {}) {
        const binding = validateBinding(value);
        const dispatcher = new NovelRenderEventDispatcher({
            audience: binding.audience,
            onFallback: this.#onFallback,
        });
        if (binding.resumeTurnId) {
            const snapshot = await this.#runtimeClient.snapshot(binding.resumeTurnId, signal);
            dispatcher.dispatchAll(snapshot.events);
        }
        this.#binding = binding;
        this.#dispatcher = dispatcher;
        return this.view;
    }

    clearDisplay() {
        return this.#dispatcher.reset();
    }

    createInputIntent(mode, text) {
        if (!this.#binding) throw new Error('Novel project context is not bound.');
        if (!this.canUseMode(mode)) throw new Error(`Novel input mode ${mode} is not permitted.`);
        const normalized = typeof text === 'string' ? text.trim() : '';
        if (!normalized || normalized.length > 64_000) {
            throw new TypeError('Novel input text must be a bounded non-empty string.');
        }
        return {
            schemaVersion: 1,
            mode,
            text: normalized,
            binding: {
                projectId: this.#binding.projectId,
                branchId: this.#binding.branchId,
                chapterId: this.#binding.chapterId,
                sceneId: this.#binding.sceneId,
            },
        };
    }
}
