import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repositoryRoot, 'novel-upstream-baseline.json');

function git(args) {
    return execFileSync('git', args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function numstat(args) {
    const output = git(['diff', '--numstat', '--ignore-space-at-eol', ...args]);
    if (!output) return [];
    return output.split(/\r?\n/).flatMap(line => {
        const [added, deleted, ...pathParts] = line.split('\t');
        const file = pathParts.join('\t').replace(/\\/g, '/');
        if (!file || (added === '0' && deleted === '0')) return [];
        return [{ file, added, deleted }];
    });
}

function untracked() {
    const output = git(['ls-files', '--others', '--exclude-standard']);
    return output ? output.split(/\r?\n/).map(file => ({
        file: file.replace(/\\/g, '/'),
        added: 'untracked',
        deleted: '0',
    })) : [];
}

function matches(file, prefixes, exact) {
    return exact.includes(file) || prefixes.some(prefix => file.startsWith(prefix));
}

function classification(file, scopes) {
    if (matches(file, scopes.isolatedPrefixes, [])) return 'isolated';
    if (scopes.coreHooks.includes(file)) return 'core_hook';
    if (matches(file, scopes.verificationPrefixes, scopes.verificationFiles)) return 'verification';
    if (scopes.repositoryScaffold.includes(file)) return 'repository_scaffold';
    return 'unclassified';
}

export function buildReport() {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const baseline = manifest.upstream.baselineCommit;
    git(['cat-file', '-e', `${baseline}^{commit}`]);
    const committed = numstat([`${baseline}..HEAD`]);
    const mergeHeadPath = git(['rev-parse', '--git-path', 'MERGE_HEAD']);
    const mergeInProgress = fs.existsSync(path.resolve(repositoryRoot, mergeHeadPath));
    // During the rehearsal, the uncommitted upstream side of MERGE_HEAD is not
    // a local patch and must not be classified as one.
    const working = mergeInProgress ? [] : [...numstat([]), ...numstat(['--cached']), ...untracked()];
    const files = new Map();
    for (const entry of [...committed, ...working]) {
        files.set(entry.file, {
            ...entry,
            classification: classification(entry.file, manifest.patchScopes),
            committed: committed.some(candidate => candidate.file === entry.file),
            workingTree: working.some(candidate => candidate.file === entry.file),
        });
    }
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        upstream: manifest.upstream,
        headCommit: git(['rev-parse', 'HEAD']),
        mergeInProgress,
        files: [...files.values()].sort((left, right) => left.file.localeCompare(right.file)),
        invariants: manifest.invariants,
    };
}

export function validateReport(report) {
    const errors = [];
    for (const entry of report.files) {
        if (entry.classification === 'unclassified') {
            errors.push(`Unclassified local patch: ${entry.file}`);
        }
    }
    const core = report.files.filter(entry => entry.classification === 'core_hook').map(entry => entry.file);
    const allowedCore = new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).patchScopes.coreHooks);
    for (const file of core) {
        if (!allowedCore.has(file)) errors.push(`Unexpected core hook: ${file}`);
    }
    return errors;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
    const report = buildReport();
    const errors = validateReport(report);
    process.stdout.write(`${JSON.stringify({ ...report, valid: errors.length === 0, errors }, null, 2)}\n`);
    if (process.argv.includes('--check') && errors.length > 0) process.exitCode = 1;
}
