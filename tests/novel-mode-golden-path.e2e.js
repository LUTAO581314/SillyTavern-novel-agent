import { expect, test } from '@playwright/test';

test('Novel Edition author golden path stays inside Runtime world and turn contracts', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const root = page.locator('#novel_mode_settings');
    const studio = root.locator('#novel_mode_workspace');
    await expect(root.locator('#novel_mode_enabled')).toBeChecked();
    await expect(studio).toBeVisible();

    await studio.locator('#novel_mode_story_inspiration').fill('A rain-soaked archivist finds a door that remembers every name.');
    await studio.locator('#novel_mode_new_story').click();
    await expect(studio.locator('#novel_mode_workspace_title')).toContainText('A rain-soaked archivist');

    await studio.locator('[data-novel-workspace="world"]').click();
    await expect(studio.locator('#novel_mode_guide_suggestions .novel-mode-guide-suggestion')).toHaveCount(2);

    await studio.locator('[data-novel-confirm-suggestion="suggestion-golden-entity"]').click();
    await studio.locator('[data-novel-confirm-suggestion="suggestion-golden-route"]').click();
    await expect(studio.locator('.novel-mode-world-item')).toHaveCount(2);

    const povCard = studio.locator('.novel-mode-world-item').filter({ hasText: 'Rain Archivist' });
    await povCard.locator('[data-novel-world-action="edit"]').click();
    const editor = povCard.locator('[data-novel-world-editor="entity-golden-pov"]');
    await expect(editor).toBeVisible();
    await editor.locator('[data-novel-world-edit-field="summary"]').fill('The author-confirmed viewpoint character at the sealed archive.');
    await editor.locator('[data-novel-world-edit="save"]').click();
    await expect(povCard).toContainText('author-confirmed viewpoint character');

    await studio.locator('#novel_mode_lock_world').click();
    await expect(studio.locator('#novel_mode_world_status')).toHaveText('locked');

    await studio.locator('[data-novel-workspace="story"]').click();
    await root.locator('#novel_mode_pov_entity').selectOption('entity-golden-pov');
    await studio.locator('#novel_mode_opening_route').selectOption('route-golden-opening');
    await studio.locator('#novel_mode_enter_stage').click();
    await expect(studio.locator('#novel_mode_workspace_turn_status')).toHaveText('ready');

    await studio.locator('#novel_mode_workspace_input').fill('Open the remembered door and listen.');
    await studio.locator('#novel_mode_workspace_submit').click();
    await expect(studio.locator('#novel_mode_workspace_turn_status')).toHaveText('awaiting_approval');
    await expect(studio.locator('#novel_mode_stage_text')).toContainText('rain-dark threshold');
    await expect(studio.locator('#novel_mode_workspace_accept')).toBeEnabled();

    await studio.locator('#novel_mode_workspace_accept').click();
    await expect(studio.locator('#novel_mode_workspace_turn_status')).toHaveText('committed');
    await expect(studio.locator('#novel_mode_stage_text')).toContainText('rain-dark threshold');

    await page.reload();
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });
    const recovered = page.locator('#novel_mode_settings');
    await expect(recovered.locator('#novel_mode_binding_status')).toHaveText('Restored');
    await expect(recovered.locator('#novel_mode_committed_view')).toContainText('rain-dark threshold');
    await expect(recovered.locator('#novel_mode_stage_text')).toContainText('rain-dark threshold');
});
