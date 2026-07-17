import { expect, test } from '@playwright/test';

test('an extension provider generates and stops without a native backend connection', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const result = await page.evaluate(async () => {
        const context = globalThis.SillyTavern.getContext();
        const calls = [];
        let blockNext = false;
        let finishBlockedGeneration;
        const unregister = context.generationProviders.register({
            id: 'browser-fixture',
            isActive: () => true,
            generate(request) {
                calls.push({ method: 'generate', type: request.type, aborted: request.signal.aborted });
                if (!blockNext) {
                    return `external:${request.type}`;
                }
                return new Promise(resolve => {
                    finishBlockedGeneration = resolve;
                });
            },
            cancel(reason) {
                calls.push({ method: 'cancel', reason });
                finishBlockedGeneration?.('external:stopped');
                return true;
            },
        });

        try {
            const quiet = await context.generate('quiet');
            const regenerate = await context.generate('regenerate');
            const swipe = await context.generate('swipe');

            blockNext = true;
            const pending = context.generate('quiet');
            await Promise.resolve();
            const stopped = context.stopGeneration();
            const stoppedValue = await pending;

            return {
                apiKeys: Object.keys(context.generationProviders),
                apiFrozen: Object.isFrozen(context.generationProviders),
                quiet,
                regenerate,
                swipe,
                stopped,
                stoppedValue,
                calls,
            };
        } finally {
            unregister();
        }
    });

    expect(result).toEqual({
        apiKeys: ['register'],
        apiFrozen: true,
        quiet: 'external:quiet',
        regenerate: 'external:regenerate',
        swipe: 'external:swipe',
        stopped: true,
        stoppedValue: 'external:stopped',
        calls: [
            { method: 'generate', type: 'quiet', aborted: false },
            { method: 'generate', type: 'regenerate', aborted: false },
            { method: 'generate', type: 'swipe', aborted: false },
            { method: 'generate', type: 'quiet', aborted: false },
            { method: 'cancel', reason: 'Clicked stop button' },
        ],
    });
});
