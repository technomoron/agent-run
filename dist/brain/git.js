"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gitStatus = gitStatus;
exports.syncGit = syncGit;
exports.gitPreview = gitPreview;
exports.pullOnStart = pullOnStart;
const fs = require("node:fs");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const store_1 = require("./store");
const config_1 = require("./config");
function git(root, args) {
    const result = (0, node_child_process_1.spawnSync)('git', ['-C', root, ...args], { encoding: 'utf8', shell: false, timeout: 60000,
        env: { ...process.env, PATH: process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0)
        throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
    return result.stdout.trimEnd();
}
function requireRepository(store) {
    if (fs.realpathSync(git(store.configRoot, ['rev-parse', '--show-toplevel'])) !== fs.realpathSync(store.configRoot)) {
        throw new Error('Git sync requires the configuration directory itself to be the repository root.');
    }
}
function gitStatus(store) {
    if (!fs.existsSync(path.join(store.configRoot, '.git')))
        return { state: 'uninitialized', files: [], conflicts: [], branch: '' };
    requireRepository(store);
    const conflicts = git(store.configRoot, ['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean);
    const files = git(store.configRoot, ['status', '--porcelain', '-z']).split('\0').filter(Boolean);
    return { state: conflicts.length ? 'conflicted' : files.length ? 'dirty' : 'clean', files, conflicts,
        branch: git(store.configRoot, ['branch', '--show-current']) };
}
function syncableFiles(store) {
    const folders = new Set([...Object.values(store_1.knowledgeDirectories), 'skills', 'todo', 'notes']);
    const roots = [path.join(store.configRoot, 'global'), path.join(store.configRoot, 'default')];
    roots.push(...(0, config_1.listBrainProjects)(store.configRoot).map((project) => store.safePath(project.profile)));
    if (store.profile && !store.profile.startsWith('projects/'))
        roots.push(store.scopeDirectory('project'));
    const files = [];
    for (const root of roots) {
        for (const folder of folders)
            files.push(...store.files(path.join(root, folder)));
        files.push(...store.files(path.join(root, 'templates'), { includeAllFiles: true }));
        for (const name of ['config.yaml', 'project.md', 'review-history.jsonl', 'review-counters.json', 'knowledge-history.jsonl']) {
            const file = store.safePath(root, name);
            if (fs.existsSync(file))
                files.push(file);
        }
    }
    if (fs.existsSync(path.join(store.configRoot, '.git'))) {
        const removable = roots.flatMap((root) => ['templates', 'notes', ...Object.values(store_1.knowledgeDirectories)].map((folder) => path.relative(store.configRoot, path.join(root, folder))));
        const deleted = git(store.configRoot, ['ls-files', '--deleted', '-z', '--', ...removable]).split('\0').filter(Boolean);
        files.push(...deleted.map((file) => store.safePath(file)));
    }
    const ignore = store.safePath('.gitignore');
    if (fs.existsSync(ignore))
        files.push(ignore);
    return [...new Set(files.map((file) => path.relative(store.configRoot, file)))].sort();
}
function syncGit(store, action, message) {
    return store.writeLocked(() => {
        if (action === 'init') {
            if (!fs.existsSync(path.join(store.configRoot, '.git')))
                git(store.configRoot, ['init', '--initial-branch=main']);
            return gitStatus(store);
        }
        requireRepository(store);
        const status = gitStatus(store);
        if (status.state === 'conflicted')
            throw new Error(`Resolve Git conflicts before syncing: ${status.conflicts.join(', ')}`);
        if (action === 'save') {
            if (!message?.trim())
                throw new Error('Supply a commit message after reviewing the files to save.');
            if (git(store.configRoot, ['diff', '--cached', '--name-only']))
                throw new Error('The Git index already has staged changes. Commit or unstage them before saving brain knowledge.');
            const files = syncableFiles(store);
            if (!files.length)
                return status;
            git(store.configRoot, ['add', '--', ...files]);
            if (git(store.configRoot, ['diff', '--cached', '--name-only']))
                git(store.configRoot, ['commit', '-m', message]);
        }
        else if (action === 'pull') {
            if (git(store.configRoot, ['diff', '--name-only']) || git(store.configRoot, ['diff', '--cached', '--name-only']))
                throw new Error('Save or resolve local tracked configuration changes before pulling.');
            try {
                git(store.configRoot, ['pull', '--rebase']);
            }
            catch (error) {
                const after = gitStatus(store);
                if (after.state === 'conflicted')
                    return after;
                throw error;
            }
        }
        else {
            git(store.configRoot, ['push']);
        }
        return gitStatus(store);
    });
}
function gitPreview(store) {
    return { status: gitStatus(store), files: syncableFiles(store) };
}
function pullOnStart(store) {
    try {
        return store.writeLocked(() => {
            const status = gitStatus(store);
            if (status.state !== 'clean')
                return `Startup pull skipped: configuration is ${status.state}.`;
            if (!status.branch)
                return 'Startup pull skipped: detached HEAD.';
            try {
                git(store.configRoot, ['rev-parse', '--verify', '@{upstream}']);
            }
            catch {
                return 'Startup pull skipped: no upstream branch.';
            }
            git(store.configRoot, ['-c', 'merge.autoStash=false', '-c', 'rebase.autoStash=false', 'pull', '--ff-only', '--no-rebase']);
            return 'Startup pull completed.';
        });
    }
    catch (error) {
        return `Startup pull failed; using local configuration: ${error instanceof Error ? error.message : String(error)}`;
    }
}
