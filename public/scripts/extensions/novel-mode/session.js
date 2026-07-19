import { NovelRenderEventDispatcher } from './render-event-dispatcher.js';

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BINDING_KEYS = new Set([
    'projectId',
    'branchId',
    'chapterId',
    'sceneId',
    'povEntityId',
    'modelProfileId',
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
        povEntityId: opaque(value.povEntityId, 'POV entity ID'),
        modelProfileId: opaque(value.modelProfileId, 'model profile ID'),
        resumeTurnId: opaque(value.resumeTurnId, 'resume turn ID', true),
        audience: value.audience,
    });
}

export class NovelModeSession {
    #binding = null;
    #dispatcher = new NovelRenderEventDispatcher();
    #onFallback;
    #runtimeClient;
    #activeTurnId = null;
    #approvalReference = null;

    constructor({ runtimeClient, onFallback = () => {} } = {}) {
        if (!runtimeClient || typeof runtimeClient.snapshot !== 'function') {
            throw new TypeError('Mengdie session requires a Runtime snapshot client.');
        }
        if (typeof onFallback !== 'function') {
            throw new TypeError('Mengdie fallback handler must be a function.');
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

    get approvalReference() {
        return this.#approvalReference ? { ...this.#approvalReference } : null;
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
        this.#approvalReference = null;
        if (
            this.view.stage === 'awaiting_approval'
            && binding.audience === 'author'
            && typeof this.#runtimeClient.approval === 'function'
        ) {
            try {
                this.#approvalReference = await this.#runtimeClient.approval(this.view.turnId, {
                    projectId: binding.projectId,
                }, signal);
            } catch {
                this.#approvalReference = null;
            }
        }
        return this.view;
    }

    clearDisplay() {
        return this.#dispatcher.reset();
    }

    unbind() {
        this.#binding = null;
        this.#activeTurnId = null;
        this.#approvalReference = null;
        this.#dispatcher = new NovelRenderEventDispatcher({
            onFallback: this.#onFallback,
        });
        return this.view;
    }

    restorePlayerEvents(events) {
        if (!this.#binding || this.#binding.audience !== 'player') {
            throw new Error('Player recovery requires a bound player session.');
        }
        if (!Array.isArray(events)) throw new TypeError('Player recovery events must be an array.');
        this.#dispatcher.dispatchAll(events);
        return this.view;
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
                povEntityId: this.#binding.povEntityId,
                modelProfileId: this.#binding.modelProfileId,
            },
        };
    }

    async submitTurn(mode, text, { signal, onUpdate = () => {} } = {}) {
        if (!this.#binding) throw new Error('Novel project context is not bound.');
        if (typeof this.#runtimeClient.createTurn !== 'function' || typeof this.#runtimeClient.events !== 'function') {
            throw new Error('Novel Runtime client does not support turn streaming.');
        }
        const intent = this.createInputIntent(mode, text);
        const turnId = globalThis.crypto?.randomUUID?.() || `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const created = await this.#runtimeClient.createTurn({
            ...intent.binding,
            inputMode: intent.mode,
            inputText: intent.text,
            turnId,
        }, signal);
        this.#activeTurnId = created.turnId || turnId;
        await this.#runtimeClient.events(this.#activeTurnId, {
            signal,
            onEvent: event => {
                this.#dispatcher.dispatch(event);
                if (
                    event.render?.type === 'turn.awaiting_approval'
                    && this.#binding.audience === 'author'
                    && typeof this.#runtimeClient.approval === 'function'
                ) {
                    return this.#runtimeClient.approval(this.#activeTurnId, {
                        projectId: this.#binding.projectId,
                    }, signal).then((reference) => {
                        this.#approvalReference = reference;
                        onUpdate(this.view, { ...event, approvalReference: reference });
                    }).catch(() => {
                        this.#approvalReference = null;
                        onUpdate(this.view, event);
                    });
                }
                onUpdate(this.view, event);
                return undefined;
            },
        });
        return this.view;
    }

    async cancelTurn(reason = 'user', signal) {
        if (!this.#activeTurnId || typeof this.#runtimeClient.cancel !== 'function') return null;
        const result = await this.#runtimeClient.cancel(this.#activeTurnId, reason, signal);
        this.#activeTurnId = null;
        return result;
    }

    async acceptTurn(payload, signal) {
        if (!this.#activeTurnId || typeof this.#runtimeClient.accept !== 'function') throw new Error('No active Novel turn can be accepted.');
        const reference = payload || this.#approvalReference;
        if (!reference || typeof reference !== 'object') throw new Error('No Runtime approval reference is available.');
        const approval = {
            projectId: reference.projectId || this.#binding?.projectId,
            proposalId: reference.proposalId,
            attemptId: reference.attemptId,
            planId: reference.planId,
            referenceDigest: reference.referenceDigest || reference.digest,
            idempotencyKey: reference.idempotencyKey
                || `approval:${this.#activeTurnId}:${reference.proposalId}`,
        };
        const turnId = this.#activeTurnId;
        const result = await this.#runtimeClient.accept(turnId, approval, signal);
        const status = result?.data?.status || result?.status;
        const commitId = result?.data?.commit?.commitId || result?.data?.commitId || result?.commit?.commitId;
        // Some Runtime deployments finish the transaction in the accept response
        // without emitting a second SSE frame. Keep the display state identical
        // on both transports by adding one client-side, server-confirmed event.
        if (status === 'committed' && commitId && this.#dispatcher.view.stage !== 'committed') {
            this.#dispatcher.dispatch({
                schema_version: 1,
                event_id: `client-commit-${turnId}`,
                turn_id: turnId,
                seq: this.#dispatcher.view.lastSeq + 1,
                audience: this.#binding?.audience || 'author',
                render: {
                    schemaVersion: 1,
                    type: 'turn.committed',
                    payload: {
                        commitId,
                        committedAt: new Date().toISOString(),
                    },
                },
            });
        }
        this.#activeTurnId = null;
        return result;
    }
}
