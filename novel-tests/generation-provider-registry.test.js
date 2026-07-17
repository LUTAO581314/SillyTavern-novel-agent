import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
    generationProviderApi,
    GenerationProviderRegistry,
} from '../public/scripts/generation-provider-registry.js';
import { createGenerationProviderFixture } from './fixtures/generation-provider-fixture.js';

describe('GenerationProviderRegistry contract', () => {
    test('exposes a frozen registration-only extension API', () => {
        assert.equal(Object.isFrozen(generationProviderApi), true);
        assert.deepEqual(Object.keys(generationProviderApi), ['register']);

        const unregister = generationProviderApi.register(createGenerationProviderFixture({
            id: 'context-api-fixture',
            isActive: () => false,
        }));
        assert.equal(typeof unregister, 'function');
        assert.equal(unregister(), true);
    });

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
        assert.equal(registry.start({ type: 'normal' }), null);
    });

    test('starts one external generation and exposes its result without changing the provider value', async () => {
        const registry = new GenerationProviderRegistry();
        const request = { type: 'regenerate', dryRun: false };
        registry.register(createGenerationProviderFixture({
            generate: async (received) => ({ received, value: undefined }),
        }));

        const generation = registry.start(request);
        assert.equal(generation.providerId, 'novel-runtime');
        assert.deepEqual(await generation.result, { received: request, value: undefined });
        assert.equal(registry.cancelActive('already finished'), false);
    });

    test('cancels the in-flight provider and rejects overlapping external generations', async () => {
        const registry = new GenerationProviderRegistry();
        const calls = [];
        let finish;
        registry.register(createGenerationProviderFixture({
            generate: () => new Promise(resolve => { finish = resolve; }),
            cancel(reason) {
                calls.push(reason);
                return true;
            },
        }));

        const generation = registry.start({ type: 'normal' });
        await Promise.resolve();
        assert.throws(() => registry.start({ type: 'swipe' }), /already in progress/);
        assert.equal(registry.cancelActive('Clicked stop button'), true);
        assert.equal(registry.cancelActive('duplicate stop'), false);
        assert.deepEqual(calls, ['Clicked stop button']);

        finish('cancelled');
        assert.equal(await generation.result, 'cancelled');
        assert.equal(registry.cancelActive('after completion'), false);
    });

    test('clears the in-flight provider after generation failure', async () => {
        const registry = new GenerationProviderRegistry();
        registry.register(createGenerationProviderFixture({
            generate: async () => { throw new Error('fixture failure'); },
        }));

        await assert.rejects(registry.start({ type: 'normal' }).result, /fixture failure/);
        assert.equal(registry.cancelActive('after failure'), false);
    });
});
