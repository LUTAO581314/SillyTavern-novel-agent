export function createGenerationProviderFixture(overrides = {}) {
    return {
        id: 'novel-runtime',
        isActive: () => true,
        generate: async (request) => ({ request }),
        cancel: () => true,
        ...overrides,
    };
}
