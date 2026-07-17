function assertProvider(provider) {
    if (!provider || typeof provider !== 'object') {
        throw new TypeError('Generation provider must be an object.');
    }
    if (typeof provider.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(provider.id)) {
        throw new TypeError('Generation provider id must be a lowercase, hyphenated identifier.');
    }
    for (const method of ['isActive', 'generate', 'cancel']) {
        if (typeof provider[method] !== 'function') {
            throw new TypeError(`Generation provider must implement ${method}().`);
        }
    }
}

export class GenerationProviderRegistry {
    #providers = new Map();

    register(provider) {
        assertProvider(provider);
        if (this.#providers.has(provider.id)) {
            throw new Error(`Generation provider "${provider.id}" is already registered.`);
        }

        this.#providers.set(provider.id, provider);
        return () => {
            if (this.#providers.get(provider.id) !== provider) {
                return false;
            }
            return this.#providers.delete(provider.id);
        };
    }

    get(id) {
        return this.#providers.get(id) ?? null;
    }

    getActive() {
        const activeProviders = [];
        for (const provider of this.#providers.values()) {
            const active = provider.isActive();
            if (typeof active !== 'boolean') {
                throw new TypeError(`Generation provider "${provider.id}" returned a non-boolean isActive() result.`);
            }
            if (active) {
                activeProviders.push(provider);
            }
        }

        if (activeProviders.length > 1) {
            throw new Error('More than one generation provider is active.');
        }
        return activeProviders[0] ?? null;
    }
}

export const generationProviderRegistry = new GenerationProviderRegistry();
