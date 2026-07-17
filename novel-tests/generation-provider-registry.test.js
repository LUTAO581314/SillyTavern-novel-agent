import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
    GenerationProviderRegistry,
} from '../public/scripts/generation-provider-registry.js';
import { createGenerationProviderFixture } from './fixtures/generation-provider-fixture.js';

describe('GenerationProviderRegistry contract', () => {
    test('registers, selects, and unregisters one active provider', async () => {
        const registry = new GenerationProviderRegistry();
        const provider = createGenerationProviderFixture();
        const unregister = registry.register(provider);

        assert.equal(registry.get('novel-runtime'), provider);
        assert.equal(registry.getActive(), provider);
        assert.deepEqual(await registry.getActive().generate({ type: 'normal' }), {
            request: { type: 'normal' },
        });

        assert.equal(unregister(), true);
        assert.equal(unregister(), false);
        assert.equal(registry.getActive(), null);
    });

    test('rejects malformed, duplicate, and ambiguously active providers', () => {
        const registry = new GenerationProviderRegistry();
        assert.throws(() => registry.register({ id: 'missing-methods' }), /isActive/);

        registry.register(createGenerationProviderFixture());
        assert.throws(
            () => registry.register(createGenerationProviderFixture()),
            /already registered/,
        );

        registry.register(createGenerationProviderFixture({ id: 'second-provider' }));
        assert.throws(() => registry.getActive(), /More than one generation provider/);
    });

    test('inactive providers do not alter the native generation path', () => {
        const registry = new GenerationProviderRegistry();
        registry.register(createGenerationProviderFixture({ isActive: () => false }));
        assert.equal(registry.getActive(), null);
    });
});
