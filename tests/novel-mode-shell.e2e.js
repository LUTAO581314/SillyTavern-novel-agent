import { expect, test } from '@playwright/test';

test('Mengdie binds, enforces input permissions, and restores without chat history', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const root = page.locator('#novel_mode_settings');
    await expect(root).toBeAttached();
    await expect(root.locator('#novel_mode_enabled')).toBeChecked();
    await expect(root.locator('#novel_mode_runtime_status')).toHaveText('Ready');
    await expect(root.locator('#novel_mode_workspace')).toBeVisible();

    await root.locator('#novel_mode_project').fill('project-workspace');
    await root.locator('#novel_mode_branch').fill('branch-main');
    await root.locator('#novel_mode_chapter').fill('chapter-workspace');
    await root.locator('#novel_mode_scene').fill('scene-workspace');
    await root.locator('#novel_mode_pov_entity').selectOption('entity-player-pov');
    await root.locator('#novel_mode_model_profile').fill('model-profile-workspace');
    await root.locator('#novel_mode_resume_turn').fill('turn-recovery');
    await root.locator('#novel_mode_audience').selectOption('author');
    await root.locator('#novel_mode_bind').click();

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
