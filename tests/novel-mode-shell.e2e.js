import { expect, test } from '@playwright/test';

test('Novel Mode binds, enforces input permissions, and restores without chat history', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const root = page.locator('#novel_mode_settings');
    await expect(root).toBeAttached();
    await root.locator('#novel_mode_enabled').evaluate(element => {
        element.checked = true;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(root.locator('#novel_mode_runtime_status')).toHaveText('Ready');

    await root.evaluate(element => {
        const values = {
            novel_mode_project: 'project-1',
            novel_mode_branch: 'branch-main',
            novel_mode_chapter: 'chapter-1',
            novel_mode_scene: 'scene-1',
            novel_mode_resume_turn: 'turn-recovery',
            novel_mode_audience: 'author',
        };
        for (const [id, value] of Object.entries(values)) {
            element.querySelector(`#${id}`).value = value;
        }
        element.querySelector('#novel_mode_bind').click();
    });

    await expect(root.locator('#novel_mode_binding_status')).toHaveText('Restored');
    await expect(root.locator('#novel_mode_committed_view')).toHaveText('Recovered committed passage.');
    await expect(root.locator('[data-novel-mode="direct"]')).toBeEnabled();
    await root.locator('[data-novel-mode="direct"]').evaluate(element => element.click());
    await expect(root.locator('[data-novel-mode="direct"]')).toHaveAttribute('aria-pressed', 'true');

    await page.evaluate(() => {
        document.getElementById('chat')?.replaceChildren();
        document.getElementById('novel_mode_committed_view').textContent = '';
    });
    await root.locator('#novel_mode_bind').evaluate(element => element.click());
    await expect(root.locator('#novel_mode_committed_view')).toHaveText('Recovered committed passage.');

    await root.locator('#novel_mode_audience').evaluate(element => {
        element.value = 'player';
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(root.locator('[data-novel-mode="direct"]')).toBeDisabled();
    await expect(page.locator('#chat [data-novel-stage]')).toHaveCount(0);
});
