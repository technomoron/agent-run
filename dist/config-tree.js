"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureConfigRootLayout = ensureConfigRootLayout;
exports.ensureConfigRootGitignore = ensureConfigRootGitignore;
exports.ensureDefaultGlobalTemplates = ensureDefaultGlobalTemplates;
exports.ensurePortableSystemdFiles = ensurePortableSystemdFiles;
exports.migrateOldTemplates = migrateOldTemplates;
exports.findLegacyProfileDirs = findLegacyProfileDirs;
exports.findProfileDirs = findProfileDirs;
exports.convertLegacyTemplateVars = convertLegacyTemplateVars;
exports.migrateCodexRuntimeFiles = migrateCodexRuntimeFiles;
exports.migrateLooseFiles = migrateLooseFiles;
exports.describeLegacyProfileLayout = describeLegacyProfileLayout;
exports.migrateProfileLayout = migrateProfileLayout;
exports.starterConfigRootPath = starterConfigRootPath;
exports.copySkeletonTree = copySkeletonTree;
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const constants_1 = require("./constants");
const defaults_1 = require("./defaults");
const utils_1 = require("./utils");
const walk_tree_1 = require("./walk-tree");
const PRUNED_CONFIG_DIRS = new Set([
    '.git',
    'orphaned',
    'global',
    'templates',
    '.agents',
    '.claude',
    '.codex',
    'bin',
    'reviews',
    'memories',
    'cache',
    'log',
    'sessions',
    'shell_snapshots',
    'skills',
    'tmp',
    '.tmp'
]);
function ensureConfigRootLayout(configRoot) {
    fs.mkdirSync(configRoot, { recursive: true });
}
function ensureConfigRootGitignore(configRoot) {
    fs.mkdirSync(configRoot, { recursive: true });
    const gitignorePath = path.join(configRoot, '.gitignore');
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8').replace(/\r\n/g, '\n') : '';
    const lines = existing.length > 0 ? existing.replace(/\n+$/, '').split('\n') : [];
    const present = new Set(lines);
    let changed = !fs.existsSync(gitignorePath);
    for (const entry of constants_1.GENERATED_GITIGNORE_ENTRIES) {
        if (entry === '' || present.has(entry)) {
            continue;
        }
        lines.push(entry);
        present.add(entry);
        changed = true;
    }
    if (changed) {
        fs.writeFileSync(gitignorePath, `${lines.join('\n')}\n`, 'utf8');
    }
}
function ensureDefaultGlobalTemplates(configRoot) {
    for (const [relativePath, content] of (0, defaults_1.defaultGlobalTemplates)()) {
        const filePath = path.join(configRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, content, 'utf8');
            (0, utils_1.verbose)(`created ${filePath}`);
        }
    }
}
function ensurePortableSystemdFiles(configRoot) {
    const packageRoot = path.resolve(__dirname, '..');
    const files = new Map([
        ['install-systemd-jobs.sh', { source: 'scripts/install-systemd-jobs.sh', mode: 0o755 }],
        ['update-ai-tools.sh', { source: 'scripts/update-ai-tools.sh', mode: 0o755 }],
        ['ai-tools-update.service', { source: 'ops/systemd/ai-tools-update.service', mode: 0o644 }],
        ['ai-tools-update.timer', { source: 'ops/systemd/ai-tools-update.timer', mode: 0o644 }]
    ]);
    for (const [targetName, asset] of files) {
        const sourcePath = path.join(packageRoot, asset.source);
        const targetPath = path.join(configRoot, targetName);
        if (!fs.existsSync(sourcePath)) {
            continue;
        }
        fs.copyFileSync(sourcePath, targetPath);
        fs.chmodSync(targetPath, asset.mode);
        (0, utils_1.verbose)(`updated ${targetPath}`);
    }
}
function migrateOldTemplates(configRoot) {
    const oldCodeTemplate = path.join(configRoot, 'templates', 'AGENTS-CODE.md');
    const newCodeTemplate = path.join(configRoot, 'global', 'agents', 'code.md.njk');
    if (!fs.existsSync(oldCodeTemplate) || fs.existsSync(newCodeTemplate)) {
        return;
    }
    fs.mkdirSync(path.dirname(newCodeTemplate), { recursive: true });
    fs.writeFileSync(newCodeTemplate, convertLegacyTemplateVars(fs.readFileSync(oldCodeTemplate, 'utf8')), 'utf8');
}
function findLegacyProfileDirs(configRoot) {
    return findConfigDirs(configRoot, (dir) => fs.existsSync(path.join(dir, 'AGENTS-MODS.md')));
}
function findProfileDirs(configRoot) {
    return findConfigDirs(configRoot, (dir) => fs.existsSync(path.join(dir, constants_1.MANIFEST_FILE_NAME)) ||
        fs.existsSync(path.join(dir, constants_1.LOCAL_TEMPLATE_FILE_NAME)));
}
function findConfigDirs(configRoot, matches) {
    const dirs = [];
    (0, walk_tree_1.walkTree)(configRoot, (fullPath, entry) => {
        if (!entry.isDirectory()) {
            return undefined;
        }
        if (matches(fullPath)) {
            dirs.push(fullPath);
            return 'skip';
        }
        return undefined;
    }, { shouldPrune: (entry) => entry.isDirectory() && PRUNED_CONFIG_DIRS.has(entry.name) });
    return dirs.sort();
}
function convertLegacyTemplateVars(content) {
    const replacements = new Map([
        ['{{AGENT_DIR}}', '{{ agentDir }}'],
        ['{{AGENTS_MODS_PATH}}', '{{ agentDir }}/AGENTS-MODS.md'],
        ['{{AGENTS_PATH}}', '{{ agentDir }}/AGENTS.md'],
        ['{{CLAUDE_PATH}}', '{{ agentDir }}/CLAUDE.md'],
        ['{{CONFIG_ROOT}}', '{{ configRoot }}'],
        ['{{PROFILE}}', '{{ profile }}']
    ]);
    let converted = content;
    for (const [from, to] of replacements) {
        converted = converted.split(from).join(to);
    }
    return converted.replace(/^@[^\n]*templates\/AGENTS-CODE\.md[^\n]*\n?/gm, '').replace(/^\n{2,}/, '\n');
}
function migrateCodexRuntimeFiles(agentDir) {
    const runtimeName = /^(?:\.personality_migration|\.tmp|auth\.json|cache|history\.jsonl|installation_id|log|logs|models_cache\.json|sessions|archived_sessions|shell_snapshots|skills|tmp|version\.json)$/;
    const databaseName = /^(?:logs|state)_.*\.sqlite(?:-.+)?$/;
    const runtimeNames = fs.readdirSync(agentDir).filter((name) => runtimeName.test(name) || databaseName.test(name));
    const codexHome = path.join(agentDir, constants_1.LIVE_DIR_NAME, 'memories', 'codex-home');
    let moved = 0;
    for (const name of runtimeNames) {
        const source = path.join(agentDir, name);
        if (!fs.existsSync(source) && !(0, utils_1.isSymlink)(source)) {
            continue;
        }
        const initialTarget = path.join(codexHome, name);
        const target = fs.existsSync(initialTarget) || (0, utils_1.isSymlink)(initialTarget) ? (0, utils_1.nextBackupPath)(initialTarget) : initialTarget;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(source, target);
        moved += 1;
    }
    return moved;
}
function migrateLooseFiles(agentDir, pattern, targetDirName) {
    let moved = 0;
    for (const entry of fs.readdirSync(agentDir, { withFileTypes: true })) {
        if (!entry.isFile() || !pattern.test(entry.name)) {
            continue;
        }
        const source = path.join(agentDir, entry.name);
        const targetDir = path.join(agentDir, targetDirName);
        const target = path.join(targetDir, entry.name);
        if (fs.existsSync(target)) {
            continue;
        }
        fs.mkdirSync(targetDir, { recursive: true });
        fs.renameSync(source, target);
        moved += 1;
    }
    return moved;
}
function describeLegacyProfileLayout(profileDir) {
    const paths = [];
    const legacyMemoryDir = path.join(profileDir, 'memory');
    if (fs.existsSync(legacyMemoryDir)) {
        paths.push(legacyMemoryDir);
    }
    for (const filePath of legacyProjectMemoryFiles(profileDir)) {
        paths.push(filePath);
    }
    const legacyCodexHome = path.join(profileDir, 'memories', 'codex-home');
    if (fs.existsSync(legacyCodexHome) || (0, utils_1.isSymlink)(legacyCodexHome)) {
        paths.push(legacyCodexHome);
    }
    return [...new Set(paths)].sort();
}
function migrateProfileLayout(configRoot, profileDir, confirmGitMoves) {
    const projectMoves = planProjectMemoryMoves(profileDir);
    validateMoveTargets(projectMoves);
    const git = findGitWorktree(configRoot);
    const trackedMoves = git === null ? [] : projectMoves.filter((move) => isTrackedByGit(git, move.source));
    if (git !== null && trackedMoves.length > 0 && !confirmGitMoves({ gitRoot: git.root, moves: trackedMoves })) {
        throw new Error('profile layout migration declined; no files were moved');
    }
    let gitMoves = 0;
    for (const move of projectMoves) {
        fs.mkdirSync(path.dirname(move.target), { recursive: true });
        if (git !== null && trackedMoves.includes(move)) {
            runGitMove(git, move);
            gitMoves += 1;
        }
        else {
            fs.renameSync(move.source, move.target);
        }
        removeEmptyParents(path.dirname(move.source), profileDir);
        (0, utils_1.verbose)(`moved project memory ${move.source} -> ${move.target}`);
    }
    removeEmptyParents(path.join(profileDir, 'memory'), profileDir);
    removeEmptyParents(path.join(profileDir, 'memories'), profileDir);
    const runtimeMoves = migrateLegacyCodexHome(profileDir);
    return { gitMoves, projectMemoryMoves: projectMoves.length, runtimeMoves };
}
function planProjectMemoryMoves(profileDir) {
    const targetDir = path.join(profileDir, 'notes', 'memory');
    const moves = [];
    const legacyMemoryDir = path.join(profileDir, 'memory');
    for (const source of listTreeFiles(legacyMemoryDir)) {
        moves.push({ source, target: path.join(targetDir, path.relative(legacyMemoryDir, source)) });
    }
    for (const source of legacyProjectMemoryFiles(profileDir)) {
        moves.push({ source, target: path.join(targetDir, path.basename(source)) });
    }
    return moves.sort((left, right) => left.source.localeCompare(right.source));
}
function legacyProjectMemoryFiles(profileDir) {
    const files = [];
    for (const entry of safeReadDir(profileDir)) {
        if (entry.isFile() && /^memory.*\.md$/i.test(entry.name)) {
            files.push(path.join(profileDir, entry.name));
        }
    }
    const legacyMemoriesDir = path.join(profileDir, 'memories');
    for (const entry of safeReadDir(legacyMemoriesDir)) {
        if (entry.isFile() && /\.md$/i.test(entry.name)) {
            files.push(path.join(legacyMemoriesDir, entry.name));
        }
    }
    return files.sort();
}
function safeReadDir(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
function listTreeFiles(root) {
    const files = [];
    for (const entry of safeReadDir(root)) {
        const filePath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...listTreeFiles(filePath));
        }
        else if (entry.isFile() || entry.isSymbolicLink()) {
            files.push(filePath);
        }
    }
    return files;
}
function validateMoveTargets(moves) {
    const targets = new Set();
    for (const move of moves) {
        const target = path.resolve(move.target);
        if (targets.has(target) || fs.existsSync(target) || (0, utils_1.isSymlink)(target)) {
            throw new Error(`cannot migrate project memory because the destination already exists: ${move.target}`);
        }
        targets.add(target);
    }
}
function findGitWorktree(configRoot) {
    const searchPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
    const gitCommand = findCommandOnPath('git', searchPath);
    if (gitCommand === null) {
        return null;
    }
    const env = { ...process.env, PATH: searchPath };
    const result = childProcess.spawnSync(gitCommand, ['-C', configRoot, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        env,
        shell: false
    });
    if (result.status !== 0) {
        return null;
    }
    const root = result.stdout.trim();
    return root ? { command: gitCommand, env, root: path.resolve(root) } : null;
}
function findCommandOnPath(command, searchPath) {
    const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
        for (const extension of extensions) {
            const candidate = path.join(dir, `${command}${extension}`);
            try {
                fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
                return candidate;
            }
            catch {
                continue;
            }
        }
    }
    return null;
}
function isTrackedByGit(git, filePath) {
    const relativePath = path.relative(git.root, filePath).replace(/\\/g, '/');
    const result = childProcess.spawnSync(git.command, ['-C', git.root, '--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relativePath], { encoding: 'utf8', env: git.env, shell: false });
    return result.status === 0;
}
function runGitMove(git, move) {
    const source = path.relative(git.root, move.source).replace(/\\/g, '/');
    const target = path.relative(git.root, move.target).replace(/\\/g, '/');
    const result = childProcess.spawnSync(git.command, ['-C', git.root, '--literal-pathspecs', 'mv', '--', source, target], {
        encoding: 'utf8',
        env: git.env,
        shell: false
    });
    if (result.status !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim() || `git exited with status ${result.status}`;
        throw new Error(`cannot migrate tracked project memory ${move.source}: ${detail}`);
    }
}
function migrateLegacyCodexHome(profileDir) {
    const source = path.join(profileDir, 'memories', 'codex-home');
    if (!fs.existsSync(source) && !(0, utils_1.isSymlink)(source)) {
        return 0;
    }
    const target = path.join(profileDir, constants_1.LIVE_DIR_NAME, 'memories', 'codex-home');
    if (!fs.existsSync(target) && !(0, utils_1.isSymlink)(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(source, target);
        removeEmptyParents(path.dirname(source), profileDir);
        (0, utils_1.verbose)(`moved Codex runtime ${source} -> ${target}`);
        return 1;
    }
    const sourceIsDirectory = !(0, utils_1.isSymlink)(source) && fs.statSync(source).isDirectory();
    const targetIsDirectory = !(0, utils_1.isSymlink)(target) && fs.statSync(target).isDirectory();
    if (!sourceIsDirectory || !targetIsDirectory) {
        const backupTarget = (0, utils_1.nextBackupPath)(target);
        fs.renameSync(source, backupTarget);
        removeEmptyParents(path.dirname(source), profileDir);
        (0, utils_1.verbose)(`moved Codex runtime ${source} -> ${backupTarget}`);
        return 1;
    }
    const moved = mergeRuntimeTree(source, target);
    removeEmptyParents(path.dirname(source), profileDir);
    return moved;
}
function mergeRuntimeTree(sourceDir, targetDir) {
    let moved = 0;
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of safeReadDir(sourceDir)) {
        const source = path.join(sourceDir, entry.name);
        let target = path.join(targetDir, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            const targetIsDirectory = fs.existsSync(target) && !(0, utils_1.isSymlink)(target) && fs.statSync(target).isDirectory();
            if ((fs.existsSync(target) || (0, utils_1.isSymlink)(target)) && !targetIsDirectory) {
                target = (0, utils_1.nextBackupPath)(target);
            }
            moved += mergeRuntimeTree(source, target);
            continue;
        }
        const resolvedTarget = fs.existsSync(target) || (0, utils_1.isSymlink)(target) ? (0, utils_1.nextBackupPath)(target) : target;
        fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
        fs.renameSync(source, resolvedTarget);
        (0, utils_1.verbose)(`moved Codex runtime ${source} -> ${resolvedTarget}`);
        moved += 1;
    }
    try {
        fs.rmdirSync(sourceDir);
    }
    catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
    return moved;
}
function removeEmptyParents(startDir, stopDir) {
    let dir = path.resolve(startDir);
    const stop = path.resolve(stopDir);
    while (dir !== stop && (0, utils_1.isSamePathOrDescendant)(dir, stop)) {
        try {
            fs.rmdirSync(dir);
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTEMPTY'].includes(String(error.code))) {
                return;
            }
            throw error;
        }
        dir = path.dirname(dir);
    }
}
function starterConfigRootPath() {
    return path.resolve(__dirname, '..', 'examples', 'basic-config', 'agent-config');
}
function copySkeletonTree(sourceDir, targetDir, excludedNames = new Set()) {
    fs.mkdirSync(targetDir, { recursive: true });
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (excludedNames.has(entry.name)) {
            continue;
        }
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name === 'gitignore' ? '.gitignore' : entry.name);
        if (entry.isDirectory()) {
            copySkeletonTree(sourcePath, targetPath, excludedNames);
        }
        else if (entry.isFile() && !fs.existsSync(targetPath)) {
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}
