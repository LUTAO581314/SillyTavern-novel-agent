import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildReport, validateReport } from '../scripts/novel-upstream-report.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

test('upstream baseline pins SillyTavern and narrows the maintained patch surface', () => {
    const baseline = JSON.parse(read('novel-upstream-baseline.json'));
    assert.equal(baseline.upstream.baselineVersion, '1.18.0');
    assert.match(baseline.upstream.baselineCommit, /^[a-f0-9]{40}$/);
    assert.deepEqual(baseline.patchScopes.coreHooks, [
        'public/script.js',
        'public/scripts/generation-provider-registry.js',
        'public/scripts/st-context.js',
    ]);
    assert.deepEqual(baseline.patchScopes.isolatedPrefixes, [
        'public/scripts/extensions/novel-mode/',
        'plugins/novel-runtime-bridge/',
    ]);
    assert.equal(baseline.invariants.novelModeReadsPostgres, false);
    assert.equal(baseline.invariants.novelModeStoresProviderSecrets, false);
});

test('all committed and working-tree patches are classified by the upstream ledger', () => {
    const report = buildReport();
    assert.deepEqual(validateReport(report), []);
    assert.equal(report.files.some(entry => entry.classification === 'isolated'), true);
    assert.equal(report.files.some(entry => entry.file === 'public/script.js' && entry.classification === 'core_hook'), true);
});

test('Novel extension, bridge, and provider registry preserve ownership boundaries', () => {
    const browser = [
        read('public/scripts/extensions/novel-mode/index.js'),
        read('public/scripts/extensions/novel-mode/workspace-client.js'),
        read('public/scripts/extensions/novel-mode/runtime-client.js'),
        read('public/scripts/extensions/novel-mode/release-session-client.js'),
        read('public/scripts/extensions/novel-mode/chat-import.js'),
        read('public/scripts/extensions/novel-mode/workspace-actions.js'),
        read('public/scripts/extensions/novel-mode/workspace-render.js'),
    ].join('\n');
    const bridge = [
        read('plugins/novel-runtime-bridge/index.js'),
        read('plugins/novel-runtime-bridge/runtime-client.js'),
    ].join('\n');
    const registry = read('public/scripts/generation-provider-registry.js');
    assert.doesNotMatch(browser, /@novel\/db|postgres|NOVEL_RUNTIME_TOKEN|providerApiKey/i);
    assert.doesNotMatch(bridge, /@novel\/db|\bpg\b|postgres|openai|mirofish/i);
    assert.doesNotMatch(registry, /novel|runtime|canon|postgres|mirofish|fetch\s*\(|localStorage|document\./i);
    assert.match(browser, /\/api\/plugins\/novel-runtime-bridge/);
});
