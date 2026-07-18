import { expect, test } from '@playwright/test';

const shareToken = 'sharedsessiontoken0123456789ABCDEFGHijklm';

test('a same-origin share opens the player stage and completes one Runtime turn', async ({ page }) => {
    await page.goto(`/?novel-share=${shareToken}`);
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const root = page.locator('#novel_mode_settings');
    await expect(root).toBeAttached();
    await expect(root.locator('#novel_mode_enabled')).toBeChecked();
    await expect(root.locator('#novel_mode_runtime_status')).toHaveText('Ready');
    await expect(root.locator('#novel_mode_binding_status')).toHaveText('Shared session active');
    const studio = root.locator('#novel_mode_workspace');
    await expect(studio).toBeVisible();
    await expect(studio.locator('#novel_mode_stage_text')).toContainText('Rain sealed the archive doors.');
    await expect(studio.locator('#novel_mode_stage_components')).toContainText('Water traces old names across the glass.');
    await expect(studio.locator('[data-novel-workspace-mode="direct"]')).toBeDisabled();

    await studio.locator('#novel_mode_workspace_input').fill('Open the archive door.');
    await studio.locator('#novel_mode_workspace_submit').click();
    await expect(studio.locator('#novel_mode_workspace_turn_status')).toHaveText(/committed|complete/i);
    await expect(studio.locator('#novel_mode_stage_text')).toContainText('The archive answered with a low metallic sigh.');

    const tokenPersisted = await page.evaluate((token) => {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (`${key}:${localStorage.getItem(key)}`.includes(token)) return true;
        }
        return false;
    }, shareToken);
    expect(tokenPersisted).toBe(false);

    await page.reload();
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });
    await expect(page.locator('#novel_mode_binding_status')).toHaveText('Shared session active');
    await expect(page.locator('#novel_mode_workspace')).toBeVisible();
    await expect(page.locator('#novel_mode_stage_text')).toContainText('The archive answered with a low metallic sigh.');
});

test.describe('mobile shared stage', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keeps the immersive stage and turn controls inside the viewport', async ({ page }) => {
        await page.goto(`/?novel-share=${shareToken}`);
        await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

        const studio = page.locator('#novel_mode_workspace');
        await expect(studio).toBeVisible();
        await expect(studio.locator('#novel_mode_stage_text')).toContainText(/Rain sealed|archive answered/);
        await expect(studio.locator('#novel_mode_workspace_input')).toBeVisible();
        await expect(studio.locator('#novel_mode_workspace_submit')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
    });
});
