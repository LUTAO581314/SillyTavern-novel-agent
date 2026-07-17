export const WORLD_GUIDE_SOURCE_MODES = Object.freeze(['inspiration', 'existing_text', 'blank']);

export class NovelWorldGuide {
    #runtimeClient;
    #proposal = null;

    constructor({ runtimeClient }) {
        if (
            !runtimeClient || typeof runtimeClient.proposeWorld !== 'function' ||
            typeof runtimeClient.confirmWorld !== 'function'
        ) {
            throw new TypeError('Novel World Guide requires proposal and confirmation clients.');
        }
        this.#runtimeClient = runtimeClient;
    }

    get proposal() {
        return this.#proposal;
    }

    async propose(projectId, request, { signal } = {}) {
        const proposal = await this.#runtimeClient.proposeWorld(projectId, request, signal);
        this.#proposal = proposal;
        return proposal;
    }

    async confirm(projectId, suggestionId, item, { signal } = {}) {
        const proposal = this.#proposal;
        const suggestion = proposal?.suggestions?.find(entry => entry.suggestionId === suggestionId);
        if (!proposal || !suggestion) {
            throw new Error('World guide suggestion is no longer available.');
        }
        const result = await this.#runtimeClient.confirmWorld(projectId, {
            schemaVersion: 1,
            proposalId: proposal.proposalId,
            suggestionId,
            actorId: 'bridge-owned',
            expectedWorldRevision: proposal.baseWorldRevision,
            model: proposal.model,
            item,
        }, signal);
        this.#proposal = {
            ...proposal,
            baseWorldRevision: result.world.revision,
            suggestions: proposal.suggestions.filter(entry => entry.suggestionId !== suggestionId),
        };
        return result;
    }

    reject(suggestionId) {
        if (!this.#proposal) return false;
        const remaining = this.#proposal.suggestions.filter(entry => entry.suggestionId !== suggestionId);
        if (remaining.length === this.#proposal.suggestions.length) return false;
        this.#proposal = { ...this.#proposal, suggestions: remaining };
        return true;
    }

    clear() {
        this.#proposal = null;
    }
}
