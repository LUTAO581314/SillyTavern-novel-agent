import { expect, test } from '@playwright/test';

test('World Guide previews, edits, confirms, and rejects without a prompt editor', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction('document.getElementById("preloader") === null', { timeout: 30_000 });

    const root = page.locator('#novel_mode_settings');
    await expect(root).toBeAttached();
    await root.evaluate(element => {
        const enabled = element.querySelector('#novel_mode_enabled');
        enabled.checked = true;
        enabled.dispatchEvent(new Event('change', { bubbles: true }));
        element.querySelector('#novel_mode_project').value = 'project-1';
        element.querySelector('#novel_mode_chapter').value = 'chapter-1';
        element.querySelector('#novel_mode_scene').value = 'scene-1';
        element.querySelector('[data-world-guide-source="blank"]').click();
        element.querySelector('#novel_world_guide_model').value = 'model-default';
        element.querySelector('#novel_world_guide_generate').click();
    });

    await expect(root.locator('#novel_world_guide_status')).toHaveText('Preview');
    await expect(root.locator('.novel-world-guide-question')).toHaveCount(1);
    await expect(root.locator('.novel-world-guide-suggestion')).toHaveCount(1);
    await expect(root.locator('.novel-world-guide-trust')).toHaveText('Untrusted');
    await root.locator('[data-world-guide-field="title"]').evaluate(element => {
        element.value = 'Author revised facade';
    });
    await root.locator('[data-world-guide-action="confirm"]').evaluate(element => element.click());
    await expect(root.locator('#novel_world_guide_status')).toHaveText('Confirmed');
    await expect(root.locator('.novel-world-guide-suggestion')).toHaveCount(0);

    await root.locator('#novel_world_guide_generate').evaluate(element => element.click());
    await expect(root.locator('#novel_world_guide_status')).toHaveText('Preview');
    await expect(root.locator('.novel-world-guide-suggestion')).toHaveCount(1);
    await root.locator('[data-world-guide-action="reject"]').evaluate(element => element.click());
    await expect(root.locator('#novel_world_guide_status')).toHaveText('Rejected');
    await expect(root.locator('.novel-world-guide-suggestion')).toHaveCount(0);
    await expect(root.locator('#novel_world_guide_source')).toBeHidden();
    await expect(root.locator('[data-world-guide-field="payload"]')).toHaveCount(0);
});
