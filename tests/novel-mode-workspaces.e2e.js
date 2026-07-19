import { expect, test } from '@playwright/test';

test('Mengdie Studio exposes Story, World, and Director through Runtime data', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const root = page.locator('#novel_mode_settings');
    await expect(root.locator('#novel_mode_enabled')).toBeChecked();
    await expect(root.locator('#novel_mode_runtime_status')).toHaveText('Ready');

    const studio = root.locator('#novel_mode_workspace');
    await expect(studio).toBeVisible();
    await expect(studio.locator('#novel_mode_workspace_title')).toHaveText('Archive of Rain');
    await expect(studio.locator('[data-novel-workspace="story"]')).toHaveAttribute('aria-selected', 'true');

    await studio.locator('[data-novel-workspace="world"]').click();
    await expect(studio.locator('[data-novel-workspace-panel="world"]')).toBeVisible();
    await expect(studio.locator('.novel-mode-world-item')).toHaveCount(3);
    await expect(studio.locator('#novel_mode_character_import_preview')).toBeEnabled();
    await expect(studio.locator('#novel_mode_character_import_confirm')).toBeDisabled();

    await studio.locator('[data-novel-workspace="director"]').click();
    await studio.locator('#novel_mode_workspace_audience').selectOption('player');
    await studio.locator('[data-novel-workspace="world"]').click();
    await expect(studio.locator('.novel-mode-world-item')).toHaveCount(2);
    await expect(studio.locator('.novel-mode-world-item')).not.toContainText('Hidden culprit');

    await studio.locator('[data-novel-workspace="story"]').click();
    await root.locator('#novel_mode_pov_entity').selectOption('entity-player-pov');
    await root.locator('#novel_mode_model_profile').fill('model-profile-workspace');
    await studio.locator('#novel_mode_opening_route').selectOption('opening-workspace');
    await studio.locator('#novel_mode_enter_stage').click();
    await expect(studio.locator('#novel_mode_workspace_turn_status')).toHaveText('ready');
    await expect(studio.locator('#novel_mode_stage_location')).toHaveText('The sealed archive');
});
