"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureConfigRootLayout = ensureConfigRootLayout;
exports.ensureConfigRootGitignore = ensureConfigRootGitignore;
exports.ensureDefaultGlobalTemplates = ensureDefaultGlobalTemplates;
exports.migrateOldTemplates = migrateOldTemplates;
exports.findLegacyProfileDirs = findLegacyProfileDirs;
exports.findProfileDirs = findProfileDirs;
exports.convertLegacyTemplateVars = convertLegacyTemplateVars;
exports.migrateCodexRuntimeFiles = migrateCodexRuntimeFiles;
exports.migrateLooseFiles = migrateLooseFiles;
exports.starterConfigRootPath = starterConfigRootPath;
exports.copySkeletonTree = copySkeletonTree;
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
