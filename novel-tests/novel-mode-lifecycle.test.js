import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NovelModeLifecycle } from '../public/scripts/extensions/novel-mode/lifecycle.js';

test('Mengdie activation and deactivation are idempotent', async () => {
    const calls = [];
    const lifecycle = new NovelModeLifecycle({
        mount: async () => {
            calls.push('mount');
            return { id: 'novel-mode-shell' };
        },
        unmount: async (resource) => calls.push(`unmount:${resource.id}`),
    });

    assert.equal(lifecycle.active, false);
    const first = await lifecycle.activate();
    const second = await lifecycle.activate();
    assert.equal(first, second);
    assert.equal(lifecycle.active, true);
    assert.deepEqual(calls, ['mount']);

    assert.equal(await lifecycle.deactivate(), true);
    assert.equal(await lifecycle.deactivate(), false);
    assert.equal(lifecycle.active, false);
    assert.deepEqual(calls, ['mount', 'unmount:novel-mode-shell']);
});
