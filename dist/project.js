"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAgentDir = resolveAgentDir;
exports.findLocalAiFiles = findLocalAiFiles;
exports.findSourceRepos = findSourceRepos;
exports.isIgnoredDir = isIgnoredDir;
exports.warnForLocalAiFiles = warnForLocalAiFiles;
exports.failForLocalAiFiles = failForLocalAiFiles;
exports.findProjectRoot = findProjectRoot;
exports.resolveProfile = resolveProfile;
exports.resolveProfileResult = resolveProfileResult;
exports.parseProfile = parseProfile;
exports.projectRootForProfile = projectRootForProfile;
exports.defaultConfigRoot = defaultConfigRoot;
exports.defaultConfigRootSearchCandidates = defaultConfigRootSearchCandidates;
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const walk_tree_1 = require("./walk-tree");
const envCache = new Map();
const PRUNED_SOURCE_DIRS = new Set(['node_modules', '.pnpm-store', 'dist', 'build']);
function resolveAgentDir(projectRoot) {
    const profile = resolveProfile(projectRoot);
    const configRoot = defaultConfigRoot(projectRoot);
    const agentDir = path.join(configRoot, profile);
    (0, utils_1.verbose)(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
    return agentDir;
}
function findLocalAiFiles(projectRoot, excludedDir = null) {
    const matches = [];
    const resolvedExcludedDir = excludedDir ? path.resolve(excludedDir) : null;
    (0, walk_tree_1.walkTree)(projectRoot, (fullPath, entry) => {
        if (resolvedExcludedDir !== null && (0, utils_1.isSamePathOrDescendant)(fullPath, resolvedExcludedDir)) {
            return entry.isDirectory() ? 'skip' : undefined;
        }
        if (entry.isDirectory() && constants_1.LOCAL_AI_DIRECTORY_NAMES.has(entry.name)) {
            matches.push(fullPath);
            return 'skip';
        }
        if (constants_1.LOCAL_AI_FILE_NAMES.has(entry.name)) {
            matches.push(fullPath);
        }
        return undefined;
    }, {
        shouldPrune: (entry) => entry.isDirectory() && (entry.name === '.git' || PRUNED_SOURCE_DIRS.has(entry.name)),
        shouldSkipDirectory: isIgnoredDir
    });
    return matches.sort();
}
function findSourceRepos(rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    if (isIgnoredDir(resolvedRoot)) {
        return [];
    }
    if (looksLikeRepoRoot(resolvedRoot)) {
        return [resolvedRoot];
    }
    const repos = new Set();
    (0, walk_tree_1.walkTree)(resolvedRoot, (fullPath, entry) => {
        if (!entry.isDirectory()) {
            return undefined;
        }
        if (fs.existsSync(path.join(fullPath, '.git'))) {
            repos.add(fullPath);
            return 'skip';
        }
        return undefined;
    }, { shouldPrune: (entry) => PRUNED_SOURCE_DIRS.has(entry.name), shouldSkipDirectory: isIgnoredDir });
    return [...repos].sort();
}
function looksLikeRepoRoot(dir) {
    return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
}
function isIgnoredDir(dir) {
    if (fs.existsSync(path.join(dir, constants_1.IGNORE_FILE_NAME))) {
        return true;
    }
    return (0, utils_1.parseBooleanEnv)(readAgentRunEnv(dir).AGENT_RUN_IGNORE);
}
function warnForLocalAiFiles(tool, projectRoot, localAiFiles) {
    process.stderr.write(`WARNING: local AI files found in project root ${projectRoot}\n`);
    for (const file of localAiFiles) {
        process.stderr.write(`WARNING:   ${path.relative(projectRoot, file)}\n`);
    }
    if (tool !== null) {
        process.stderr.write(`WARNING: consider moving these files out of the project, or run \`agent-run ${tool} --none\` to bypass the wrapper.\n`);
    }
}
function failForLocalAiFiles(tool, projectRoot, localAiFiles) {
    process.stderr.write(`agent-run: found local AI files in project root ${projectRoot}\n`);
    for (const file of localAiFiles) {
        process.stderr.write(`agent-run:   ${file}\n`);
    }
    process.stderr.write(`agent-run: move these files manually out of the project, run \`agent-run ${tool} --local\` to warn and continue, or run \`agent-run ${tool} --none\` to bypass the wrapper for this invocation.\n`);
    process.exit(1);
}
function findProjectRoot(cwd) {
    let dir = path.resolve(cwd);
    let nearestPackageRoot = '';
    let workspaceRoot = '';
    let gitRoot = '';
    for (;;) {
        if (isWorkspaceRoot(dir)) {
            workspaceRoot = dir;
        }
        if (!nearestPackageRoot && fs.existsSync(path.join(dir, 'package.json'))) {
            nearestPackageRoot = dir;
        }
        if (fs.existsSync(path.join(dir, '.git'))) {
            gitRoot = dir;
            break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    const resolvedRoot = workspaceRoot || nearestPackageRoot || gitRoot || path.resolve(cwd);
    (0, utils_1.verbose)(`findProjectRoot cwd=${path.resolve(cwd)} workspaceRoot=${workspaceRoot || '-'} nearestPackageRoot=${nearestPackageRoot || '-'} gitRoot=${gitRoot || '-'} resolved=${resolvedRoot}`);
    return resolvedRoot;
}
function isWorkspaceRoot(dir) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
        return true;
    }
    const packagePath = path.join(dir, 'package.json');
    if (!fs.existsSync(packagePath)) {
        return false;
    }
    try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        return Array.isArray(pkg.workspaces) || (pkg.workspaces !== null && typeof pkg.workspaces === 'object');
    }
    catch {
        return false;
    }
}
function resolveProfile(projectRoot) {
    const result = resolveProfileResult(projectRoot);
    if (result.profile === null) {
        (0, utils_1.fail)(result.reason);
    }
    return result.profile;
}
function resolveProfileResult(projectRoot) {
    const envProfile = readAgentRunEnv(projectRoot).AGENT_RUN_PROFILE?.trim();
    if (envProfile) {
        (0, utils_1.verbose)(`using ${constants_1.ENV_FILE_NAME} AGENT_RUN_PROFILE=${envProfile}`);
        return parseProfile(envProfile, `${constants_1.ENV_FILE_NAME} AGENT_RUN_PROFILE`);
    }
    const githubProfile = resolveGitHubProfile(projectRoot);
    if (githubProfile !== null) {
        (0, utils_1.verbose)(`using GitHub origin profile=${githubProfile}`);
        return parseProfile(githubProfile, 'GitHub remote origin');
    }
    return profileFromPackage(projectRoot);
}
function profileFromPackage(projectRoot) {
    const packagePath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packagePath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            const repositoryProfile = parsePackageRepositoryProfile(pkg.repository);
            if (repositoryProfile !== null) {
                (0, utils_1.verbose)(`using package.json repository profile=${repositoryProfile}`);
                return parseProfile(repositoryProfile, `${packagePath} repository`);
            }
            if (typeof pkg.name === 'string' && pkg.name.length > 0) {
                (0, utils_1.verbose)(`using package.json name=${pkg.name}`);
                return parseProfile(pkg.name.startsWith('@') ? pkg.name.slice(1) : pkg.name, `${packagePath} name`);
            }
        }
        catch {
            return { profile: null, reason: `cannot parse package.json: ${packagePath}` };
        }
    }
    const current = path.basename(projectRoot);
    const parentDir = path.dirname(projectRoot);
    const parent = path.basename(parentDir);
    if (current && parent && parentDir !== projectRoot) {
        const inferredProfile = `${parent}/${current}`;
        (0, utils_1.verbose)(`using project path profile=${inferredProfile}`);
        return parseProfile(inferredProfile, 'project parent and directory name');
    }
    return { profile: null, reason: `cannot resolve agent profile from project path: ${projectRoot}` };
}
function parsePackageRepositoryProfile(repository) {
    let repositoryPath = null;
    if (typeof repository === 'string') {
        repositoryPath = repository;
    }
    else if (repository !== null && typeof repository === 'object' && 'url' in repository) {
        const url = repository.url;
        if (typeof url === 'string') {
            repositoryPath = url;
        }
    }
    if (repositoryPath === null) {
        return null;
    }
    const value = repositoryPath.trim();
    const githubProfile = parseGitHubRemoteProfile(value.replace(/^git\+/, ''));
    if (githubProfile !== null) {
        return githubProfile;
    }
    const shorthand = /^(?:github:)?([^/:\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(value);
    return shorthand?.[1] && shorthand[2] ? `${shorthand[1]}/${shorthand[2]}` : null;
}
function resolveGitHubProfile(projectRoot) {
    const result = childProcess.spawnSync('git', ['-C', projectRoot, 'config', '--get', 'remote.origin.url'], {
        encoding: 'utf8',
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore']
    });
    if (result.status !== 0) {
        return null;
    }
    const remote = result.stdout.trim();
    return remote ? parseGitHubRemoteProfile(remote) : null;
}
function parseGitHubRemoteProfile(remote) {
    const patterns = [
        /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
        /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
        /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(remote.trim());
        if (match?.[1] && match[2]) {
            return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
        }
    }
    return null;
}
function parseProfile(profile, source) {
    const normalized = profile.trim().replace(/\\/g, '/');
    if (!normalized) {
        return { profile: null, reason: `${source} must be a non-empty path relative to the config root` };
    }
    if (normalized.startsWith('/') || normalized.startsWith('\\') || /^[A-Za-z]:\//.test(normalized)) {
        return { profile: null, reason: `${source} must be relative to the config root, not an absolute path` };
    }
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0 ||
        segments.some((segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
        return { profile: null, reason: `${source} must be a clean relative path like org/my-project` };
    }
    return { profile: segments.join('/'), reason: '' };
}
function projectRootForProfile(profile, configRoot) {
    if (configRoot && path.basename(configRoot) === 'agent-config') {
        return path.join(path.dirname(configRoot), ...profile.split('/'));
    }
    return path.join(os.homedir(), ...profile.split('/'));
}
function readAgentRunEnv(dir) {
    const resolvedDir = path.resolve(dir);
    const cached = envCache.get(resolvedDir);
    if (cached) {
        return cached;
    }
    const filePath = path.join(resolvedDir, constants_1.ENV_FILE_NAME);
    if (!fs.existsSync(filePath)) {
        const empty = {};
        envCache.set(resolvedDir, empty);
        return empty;
    }
    const env = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
    envCache.set(resolvedDir, env);
    return env;
}
function parseEnvFile(content) {
    const env = {};
    for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const equalsIndex = line.indexOf('=');
        if (equalsIndex <= 0) {
            continue;
        }
        const key = line.slice(0, equalsIndex).trim();
        let value = line.slice(equalsIndex + 1).trim();
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}
function defaultConfigRoot(projectRoot, options = {}) {
    const explicit = explicitConfigRoot(projectRoot);
    if (explicit !== null) {
        return explicit;
    }
    void options;
    return path.join(os.homedir(), '.agent-run');
}
function explicitConfigRoot(projectRoot) {
    for (const value of [process.env[constants_1.CONFIG_ROOT_OVERRIDE_ENV], process.env[constants_1.CONFIG_DIR_ENV]]) {
        if (value) {
            return path.resolve(value);
        }
    }
    if (!projectRoot) {
        return null;
    }
    const env = readAgentRunEnv(projectRoot);
    const localValue = env[constants_1.CONFIG_DIR_ENV]?.trim();
    return localValue ? path.resolve(projectRoot, localValue) : null;
}
function defaultConfigRootSearchCandidates(_projectRoot, options = {}) {
    const platform = options.platform ?? process.platform;
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    const homeDir = options.homeDir ?? os.homedir();
    const names = ['agent-config', 'agent-configs'];
    if (platform === 'win32') {
        return [pathApi.join(homeDir, 'Documents', 'code'), pathApi.join(homeDir, 'Desktop', 'code'), 'C:\\code'].flatMap((root) => names.map((name) => pathApi.join(root, name)));
    }
    return [
        ...names.map((name) => pathApi.join(homeDir, 'code', name)),
        ...names.map((name) => pathApi.join(homeDir, name)),
        ...names.map((name) => pathApi.join(homeDir, `.${name}`))
    ];
}
