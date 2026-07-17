import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

test('Novel Mode manifest exposes reversible hooks and a shell view', () => {
    const manifest = JSON.parse(read('public/scripts/extensions/novel-mode/manifest.json'));
    assert.equal(manifest.display_name, 'Novel Mode');
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.css, 'style.css');
    assert.deepEqual(manifest.hooks, {
        activate: 'init',
        enable: 'enable',
        disable: 'disable',
        delete: 'disable',
    });
    assert.match(read('public/scripts/extensions/novel-mode/settings.html'), /novel_mode_enabled/);
});

test('S02-04 does not wire the registry into native Generate', () => {
    const nativeGeneration = read('public/script.js');
    assert.doesNotMatch(nativeGeneration, /generation-provider-registry/);
    assert.match(nativeGeneration, /export async function Generate\(/);
});

test('browser code contains no Runtime target, token, or canonical write route', () => {
    const browserSource = [
        read('public/scripts/extensions/novel-mode/index.js'),
        read('public/scripts/extensions/novel-mode/lifecycle.js'),
        read('public/scripts/extensions/novel-mode/settings.html'),
    ].join('\n');

    assert.doesNotMatch(browserSource, /NOVEL_RUNTIME_(?:BASE_URL|TOKEN)/);
    assert.doesNotMatch(browserSource, /https?:\/\//);
    assert.doesNotMatch(browserSource, /canon(?:ical)?\/(?:commit|write)/i);
    assert.match(browserSource, /\/api\/plugins\/novel-runtime-bridge\/health/);
});
