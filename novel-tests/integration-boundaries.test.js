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

test('S06-04 dispatches an external provider before native connection checks', () => {
    const nativeGeneration = read('public/script.js');
    const generateStart = nativeGeneration.indexOf('export async function Generate(');
    const externalStart = nativeGeneration.indexOf('generationProviderRegistry.start(', generateStart);
    const serverPing = nativeGeneration.indexOf('const pingResult = await pingServer();', generateStart);
    const nativeConnectionCheck = nativeGeneration.indexOf('const hasBackendConnection = online_status !== \'no_connection\';', generateStart);
    const stopStart = nativeGeneration.indexOf('export function stopGeneration()');
    const stopEnd = nativeGeneration.indexOf('\n}', stopStart);

    assert.ok(generateStart >= 0);
    assert.ok(externalStart > generateStart);
    assert.ok(serverPing > externalStart);
    assert.ok(nativeConnectionCheck > externalStart);
    assert.match(nativeGeneration.slice(externalStart, nativeConnectionCheck), /externalGeneration\.result/);
    assert.match(nativeGeneration.slice(stopStart, stopEnd), /generationProviderRegistry\.cancelActive/);
    assert.match(nativeGeneration.slice(stopStart, stopEnd), /abortController\.abort/);
    assert.match(nativeGeneration.slice(stopStart, stopEnd), /GENERATION_STOPPED/);
    assert.match(nativeGeneration, /Generate\('regenerate'/);
    assert.match(nativeGeneration, /Generate\('swipe'/);
});

test('the formal extension context exposes only the provider registration API', () => {
    const contextSource = read('public/scripts/st-context.js');
    assert.match(contextSource, /import \{ generationProviderApi \} from '.\/generation-provider-registry\.js';/);
    assert.match(contextSource, /generationProviders:\s*generationProviderApi/);
});

test('the core registry contains no Novel domain, network, storage, or DOM logic', () => {
    const registrySource = read('public/scripts/generation-provider-registry.js');
    assert.doesNotMatch(registrySource, /novel|runtime|canon|postgres|mirofish/i);
    assert.doesNotMatch(registrySource, /fetch\s*\(|localStorage|document\.|querySelector/);
});

test('browser code contains no Runtime target, token, or canonical write route', () => {
    const browserSource = [
        read('public/scripts/extensions/novel-mode/index.js'),
        read('public/scripts/extensions/novel-mode/lifecycle.js'),
        read('public/scripts/extensions/novel-mode/runtime-client.js'),
        read('public/scripts/extensions/novel-mode/session.js'),
        read('public/scripts/extensions/novel-mode/render-event-dispatcher.js'),
        read('public/scripts/extensions/novel-mode/display-cache.js'),
        read('public/scripts/extensions/novel-mode/settings.html'),
    ].join('\n');

    assert.doesNotMatch(browserSource, /NOVEL_RUNTIME_(?:BASE_URL|TOKEN)/);
    assert.doesNotMatch(browserSource, /https?:\/\//);
    assert.doesNotMatch(browserSource, /canon(?:ical)?\/(?:commit|write)/i);
    assert.match(browserSource, /\/api\/plugins\/novel-runtime-bridge/);
    assert.match(browserSource, /get\('\/health'/);
    // Novel Mode may mutate turns only through the fixed same-origin bridge.
    assert.match(browserSource, /method:\s*['"]POST['"]/);
    assert.match(browserSource, /BRIDGE_PREFIX\/v1\/turns/);
    assert.match(browserSource, /BRIDGE_PREFIX\/v1\/turns\/\$\{encodeURIComponent\(turnId\)\}\/cancel/);
    assert.match(browserSource, /BRIDGE_PREFIX\/v1\/turns\/\$\{encodeURIComponent\(turnId\)\}\/accept/);
    assert.doesNotMatch(browserSource, /generationProviders\.register|@novel\/db|postgres|openai|mirofish/i);
    assert.doesNotMatch(browserSource, /baseUrl|targetUrl|runtimeUrl/i);
});

test('the server bridge contains no database, model, MiroFish, or browser-selected target adapter', () => {
    const bridgeSource = [
        read('plugins/novel-runtime-bridge/index.js'),
        read('plugins/novel-runtime-bridge/config.js'),
        read('plugins/novel-runtime-bridge/runtime-client.js'),
    ].join('\n');

    assert.doesNotMatch(bridgeSource, /@novel\/db|\bpg\b|postgres|openai|mirofish/i);
    assert.doesNotMatch(bridgeSource, /request\.body\.(?:baseUrl|url|target)|request\.query\.(?:baseUrl|url|target)/);
});
