import { expect, test } from '@playwright/test';

test('the loaded Runtime bridge exposes only a same-origin public health payload', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const result = await page.evaluate(async () => {
        const response = await fetch('/api/plugins/novel-runtime-bridge/health');
        return {
            status: response.status,
            url: response.url,
            body: await response.json(),
        };
    });

    expect(result.status).toBe(200);
    expect(new URL(result.url).origin).toBe('http://127.0.0.1:8000');
    expect(result.body).toEqual({
        schemaVersion: 1,
        service: 'novel-runtime-bridge',
        status: 'ready',
        capabilities: [
            'health',
            'turn.create',
            'turn.events',
            'turn.cancel',
            'turn.accept',
            'turn.approval',
            'turn.snapshot',
            'release.open',
            'session.open',
            'session.share',
            'session.snapshot',
            'session.reconnect',
            'workspace.read',
            'workspace.command',
            'workspace.bootstrap',
            'workspace.audience',
            'workspace.recall',
            'import.character.preview',
            'import.character.confirm',
            'import.world-info.preview',
            'import.world-info.confirm',
            'import.world-info.review',
            'import.chat.preview',
            'import.chat.confirm',
            'import.swipe.preview',
            'import.swipe.confirm',
        ],
        canonicalWrite: false,
        runtimeConfigured: true,
        runtimeReachable: true,
        runtimeService: 'novel-runtime',
    });
    expect(JSON.stringify(result.body)).not.toMatch(/token|authorization|baseUrl|127\.0\.0\.1/i);
});
