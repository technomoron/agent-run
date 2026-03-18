"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
exports.parseInvocation = parseInvocation;
exports.resolveAgentDir = resolveAgentDir;
exports.findProjectRoot = findProjectRoot;
exports.resolveProfile = resolveProfile;
exports.defaultConfigRoot = defaultConfigRoot;
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const agent_files_1 = require("./agent-files");
const IS_WINDOWS = process.platform === 'win32';
const ENV_FILE_NAME = '.agent-run.env';
const IGNORE_FILE_NAME = '.agent-run-ignore';
const LOCAL_AI_FILE_NAMES = new Set(['AGENTS.md', 'AGENTS-MODS.md', 'CLAUDE.md', 'codex.md']);
function main(invokedTool, argv) {
    const parsed = parseInvocation(invokedTool, argv);
    if (parsed.command === 'check') {
        runCheck(parsed);
        return;
    }
    if (parsed.command === 'init') {
        runInit(parsed);
        return;
    }
    if (parsed.command === 'edit') {
        runEdit(parsed);
        return;
    }
    runTool(parsed);
}
function parseInvocation(invokedTool, argv) {
    let command = normalizeCommandName(invokedTool);
    const extracted = extractGlobalOptions(argv);
    const inputArgs = extracted.args;
    if (extracted.sourceRootOverride !== null) {
        process.env.AGENT_SOURCE_ROOT = extracted.sourceRootOverride;
    }
    if (command === null) {
        if (inputArgs.length === 0) {
            fail('usage: agent-run <codex|claude|check|init|edit> [options]');
        }
        const firstArg = inputArgs.shift();
        command = normalizeCommandName(firstArg ?? '');
        if (command === null) {
            fail(`unknown command: ${firstArg ?? ''}`);
        }
    }
    if (command === 'check') {
        return parseCheckCommand(inputArgs);
    }
    if (command === 'init') {
        return parseInitCommand(inputArgs);
    }
    if (command === 'edit') {
        return parseEditCommand(inputArgs);
    }
    return parseRunCommand(command, inputArgs);
}
function extractGlobalOptions(argv) {
    const args = [];
    let sourceRootOverride = null;
    let passthrough = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (passthrough || arg === undefined) {
            if (arg !== undefined) {
                args.push(arg);
            }
            continue;
        }
        if (arg === '--') {
            passthrough = true;
            args.push(arg);
            continue;
        }
        if (arg === '--root') {
            const nextArg = argv[index + 1];
            if (nextArg === undefined) {
                fail('missing value for --root');
            }
            sourceRootOverride = path.resolve(nextArg);
            index += 1;
            continue;
        }
        if (arg.startsWith('--root=')) {
            const rootValue = arg.slice('--root='.length);
            if (!rootValue) {
                fail('missing value for --root');
            }
            sourceRootOverride = path.resolve(rootValue);
            continue;
        }
        args.push(arg);
    }
    return { args, sourceRootOverride };
}
function parseRunCommand(command, inputArgs) {
    const wrapperArgs = {
        none: false,
        create: false
    };
    const args = [];
    let passthrough = false;
    for (const arg of inputArgs) {
        if (passthrough) {
            args.push(arg);
            continue;
        }
        if (arg === '--') {
            passthrough = true;
            continue;
        }
        if (arg === '--none') {
            wrapperArgs.none = true;
            continue;
        }
        if (arg === '--create') {
            wrapperArgs.create = true;
            continue;
        }
        args.push(arg);
    }
    return { args, command, wrapperArgs };
}
function parseCheckCommand(inputArgs) {
    let all = false;
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (arg === '--all') {
            all = true;
            continue;
        }
        if (arg.startsWith('--')) {
            fail(`unknown check option: ${arg}`);
        }
        targetPath = arg;
    }
    return {
        all,
        command: 'check',
        targetPath: path.resolve(targetPath)
    };
}
function parseInitCommand(inputArgs) {
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (arg.startsWith('--')) {
            fail(`unknown init option: ${arg}`);
        }
        targetPath = arg;
    }
    return {
        command: 'init',
        targetPath: path.resolve(targetPath)
    };
}
function parseEditCommand(inputArgs) {
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (arg.startsWith('--')) {
            fail(`unknown edit option: ${arg}`);
        }
        targetPath = arg;
    }
    return {
        command: 'edit',
        targetPath: path.resolve(targetPath)
    };
}
function normalizeCommandName(value) {
    if (!value) {
        return null;
    }
    const base = path.basename(value).toLowerCase();
    if (base === 'agent-run' || base === 'agent-run.js' || base === 'agent-run.cmd') {
        return null;
    }
    if (base === 'codex' || base === 'codex.cmd' || base === 'codex.exe' || base === 'codex.bat') {
        return 'codex';
    }
    if (base === 'claude' || base === 'claude.cmd' || base === 'claude.exe' || base === 'claude.bat') {
        return 'claude';
    }
    if (base === 'check') {
        return 'check';
    }
    if (base === 'init') {
        return 'init';
    }
    if (base === 'edit') {
        return 'edit';
    }
    return null;
}
function runTool(parsed) {
    const { args, command, wrapperArgs } = parsed;
    const realBinary = findRealBinary(command);
    const permissionArgs = getPermissionArgs(command);
    const projectRoot = findProjectRoot(process.cwd());
    if (wrapperArgs.none || isIgnoredDir(projectRoot)) {
        execTool(realBinary, [...permissionArgs, ...args]);
        return;
    }
    const localAiFiles = findLocalAiFiles(projectRoot);
    if (localAiFiles.length > 0) {
        failForLocalAiFiles(command, projectRoot, localAiFiles);
    }
    const agentDir = resolveAgentDir(projectRoot);
    if (wrapperArgs.create) {
        createBlankAgentFiles(agentDir);
        process.stderr.write(`agent-run: created blank agent files in ${agentDir}\n`);
    }
    if (fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
        (0, agent_files_1.syncGeneratedAgentsFile)(agentDir);
    }
    if (command === 'codex') {
        runCodex(realBinary, permissionArgs, agentDir, args);
        return;
    }
    runClaude(realBinary, permissionArgs, agentDir, args);
}
function runInit(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        return;
    }
    const agentDir = resolveAgentDir(projectRoot);
    createBlankAgentFiles(agentDir);
    if (fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
        (0, agent_files_1.syncGeneratedAgentsFile)(agentDir);
    }
    process.stdout.write(`OK initialized ${agentDir}\n`);
}
function runEdit(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        process.exit(0);
    }
    const agentDir = resolveAgentDir(projectRoot);
    createBlankAgentFiles(agentDir);
    if (fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
        (0, agent_files_1.syncGeneratedAgentsFile)(agentDir);
    }
    const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
    process.stdout.write(`Edit: ${modsPath}\n`);
    openEditor(modsPath);
}
function runCheck(parsed) {
    if (parsed.all) {
        const report = checkSourceTree(parsed.targetPath);
        printBatchReport(report.root, report.entries);
        process.exit(report.hasErrors ? 1 : 0);
    }
    const projectRoot = findProjectRoot(parsed.targetPath);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`Check: ${projectRoot}\n`);
        process.stdout.write('SKIP ignored by .agent-run-ignore\n');
        process.exit(0);
    }
    const findings = checkProject(projectRoot);
    printProjectReport(projectRoot, findings);
    process.exit(hasErrors(findings) ? 1 : 0);
}
function checkProject(projectRoot) {
    const findings = [];
    const localAiFiles = findLocalAiFiles(projectRoot);
    for (const file of localAiFiles) {
        findings.push({
            message: `local AI file in project: ${file}`,
            severity: 'ERROR'
        });
    }
    const sourceLayoutFinding = checkSourceProjectLayout(projectRoot);
    if (sourceLayoutFinding !== null) {
        findings.push(sourceLayoutFinding);
    }
    const profileResult = resolveProfileResult(projectRoot);
    if (profileResult.profile === null) {
        findings.push({
            message: profileResult.reason,
            severity: 'ERROR'
        });
        return findings;
    }
    const agentDir = path.join(defaultConfigRoot(), profileResult.profile, 'agent');
    findings.push(...checkAgentDirectory(agentDir));
    return findings;
}
function checkSourceTree(rootPath) {
    const sourceRepos = findSourceRepos(rootPath);
    const entries = sourceRepos.map((projectRoot) => ({
        findings: checkProject(projectRoot),
        label: projectRoot
    }));
    return {
        entries,
        hasErrors: entries.some((entry) => hasErrors(entry.findings)),
        root: rootPath
    };
}
function findSourceRepos(rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    const repos = new Set();
    if (!isIgnoredDir(resolvedRoot) && looksLikeRepoRoot(resolvedRoot)) {
        repos.add(resolvedRoot);
    }
    walkSourceTree(resolvedRoot, 0, (fullPath, entry, depth) => {
        if (entry.isDirectory() && entry.name === '.git') {
            repos.add(path.dirname(fullPath));
            return 'skip';
        }
        if (entry.isDirectory() && depth >= 3) {
            return 'skip';
        }
        return undefined;
    });
    return [...repos].sort();
}
function looksLikeRepoRoot(dir) {
    if (fs.existsSync(path.join(dir, '.git'))) {
        return true;
    }
    return fs.existsSync(path.join(dir, 'package.json'));
}
function checkAgentDirectoryPath(rootPath, agentDir) {
    const findings = [];
    const relative = path.relative(rootPath, agentDir);
    const segments = splitRelativePath(relative);
    if (segments.length === 0) {
        findings.push({
            message: `invalid agent directory root: ${agentDir}`,
            severity: 'ERROR'
        });
        return findings;
    }
    if (segments.length > 2) {
        findings.push({
            message: `agent directory must be <repo> or <org>/<repo>: ${agentDir}`,
            severity: 'ERROR'
        });
    }
    return findings;
}
function checkAgentDirectory(agentDir) {
    const findings = [];
    const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
    const agentsPath = path.join(agentDir, 'AGENTS.md');
    const claudePath = path.join(agentDir, 'CLAUDE.md');
    if (!fs.existsSync(modsPath)) {
        findings.push({
            message: `missing AGENTS-MODS.md: ${modsPath}`,
            severity: 'ERROR'
        });
    }
    if (!fs.existsSync(agentsPath)) {
        findings.push({
            message: `missing AGENTS.md: ${agentsPath}`,
            severity: 'ERROR'
        });
    }
    if (!fs.existsSync(claudePath)) {
        findings.push({
            message: `missing CLAUDE.md: ${claudePath}`,
            severity: 'ERROR'
        });
    }
    if (fs.existsSync(claudePath)) {
        const claudeText = fs.readFileSync(claudePath, 'utf8').replace(/\r/g, '');
        if (claudeText !== '@AGENTS.md\n' && claudeText !== '@AGENTS.md') {
            findings.push({
                message: `CLAUDE.md must contain only @AGENTS.md: ${claudePath}`,
                severity: 'ERROR'
            });
        }
    }
    if (fs.existsSync(modsPath) && fs.existsSync(agentsPath)) {
        try {
            const rendered = (0, agent_files_1.renderAgentsMods)(modsPath);
            const generated = fs.readFileSync(agentsPath, 'utf8').replace(/\r\n/g, '\n');
            if (generated !== rendered) {
                findings.push({
                    message: `AGENTS.md is out of date with AGENTS-MODS.md: ${agentsPath}`,
                    severity: 'ERROR'
                });
            }
        }
        catch (error) {
            findings.push({
                message: `failed to render AGENTS-MODS.md in ${agentDir}: ${formatError(error)}`,
                severity: 'ERROR'
            });
        }
    }
    return findings;
}
function checkSourceProjectLayout(projectRoot) {
    const packagePath = path.join(projectRoot, 'package.json');
    if (!fs.existsSync(packagePath)) {
        return null;
    }
    try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (typeof pkg.name !== 'string' || !pkg.name.startsWith('@')) {
            return null;
        }
        const sourceRoot = defaultSourceStorageRoot();
        const relative = path.relative(sourceRoot, projectRoot);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return null;
        }
        const segments = splitRelativePath(relative);
        if (segments.length < 2) {
            return {
                message: `scoped package path under source storage root should be <org>/<repo>: ${projectRoot}`,
                severity: 'WARN'
            };
        }
        const expected = pkg.name.slice(1).split('/');
        if (expected.length !== 2) {
            return null;
        }
        if (segments[0] !== expected[0] || segments[1] !== expected[1]) {
            return {
                message: `source path does not match package name ${pkg.name}: ${projectRoot}`,
                severity: 'WARN'
            };
        }
    }
    catch {
        return {
            message: `cannot parse package.json: ${packagePath}`,
            severity: 'WARN'
        };
    }
    return null;
}
function printProjectReport(projectRoot, findings) {
    process.stdout.write(`Check: ${projectRoot}\n`);
    if (findings.length === 0) {
        process.stdout.write('OK no issues found\n');
        return;
    }
    for (const finding of findings) {
        process.stdout.write(`${finding.severity} ${finding.message}\n`);
    }
    process.stdout.write(`Summary: ${countErrors(findings)} error(s), ${countWarnings(findings)} warning(s)\n`);
}
function printBatchReport(rootPath, entries) {
    process.stdout.write(`Check all: ${rootPath}\n`);
    if (entries.length === 0) {
        process.stdout.write('WARN no source repos found\n');
        return;
    }
    let totalErrors = 0;
    let totalWarnings = 0;
    for (const entry of entries) {
        if (entry.findings.length === 0) {
            process.stdout.write(`OK ${entry.label}\n`);
            continue;
        }
        process.stdout.write(`FAIL ${entry.label}\n`);
        for (const finding of entry.findings) {
            process.stdout.write(`  ${finding.severity} ${finding.message}\n`);
        }
        totalErrors += countErrors(entry.findings);
        totalWarnings += countWarnings(entry.findings);
    }
    process.stdout.write(`Summary: ${totalErrors} error(s), ${totalWarnings} warning(s)\n`);
}
function hasErrors(findings) {
    return findings.some((finding) => finding.severity === 'ERROR');
}
function countErrors(findings) {
    return findings.filter((finding) => finding.severity === 'ERROR').length;
}
function countWarnings(findings) {
    return findings.filter((finding) => finding.severity === 'WARN').length;
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
function createBlankAgentFiles(agentDir) {
    fs.mkdirSync(agentDir, { recursive: true });
    const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
    const agentsPath = path.join(agentDir, 'AGENTS.md');
    const claudePath = path.join(agentDir, 'CLAUDE.md');
    if (!fs.existsSync(modsPath)) {
        fs.writeFileSync(modsPath, '\n', 'utf8');
    }
    if (!fs.existsSync(agentsPath)) {
        fs.writeFileSync(agentsPath, '\n', 'utf8');
    }
    if (!fs.existsSync(claudePath)) {
        fs.writeFileSync(claudePath, '@AGENTS.md\n', 'utf8');
    }
}
function runCodex(realBinary, permissionArgs, agentDir, args) {
    const agentsPath = path.join(agentDir, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
        execTool(realBinary, [...permissionArgs, '--config', `system_prompt_file=${agentsPath}`, ...args]);
        return;
    }
    failMissingConfig('codex', agentDir);
}
function runClaude(realBinary, permissionArgs, agentDir, args) {
    const claudePath = path.join(agentDir, 'CLAUDE.md');
    const agentsPath = path.join(agentDir, 'AGENTS.md');
    if (fs.existsSync(claudePath) && fs.existsSync(agentsPath)) {
        execTool(realBinary, [...permissionArgs, '--add-dir', agentDir, ...args]);
        return;
    }
    failMissingConfig('claude', agentDir);
}
function failMissingConfig(tool, agentDir) {
    process.stderr.write(`agent-run: no ${tool} config found for this project: ${agentDir}\n`);
    process.stderr.write(`agent-run: run \`agent-run ${tool} --none\` to bypass agent setup, or \`agent-run ${tool} --create\` to create blank agent files.\n`);
    process.exit(1);
}
function getPermissionArgs(tool) {
    if (process.env.AGENT_WRAPPER_FORCE_PERMISSIVE !== '1') {
        return [];
    }
    if (tool === 'codex') {
        return ['-a', 'never', '-s', 'danger-full-access'];
    }
    if (tool === 'claude' && typeof process.getuid === 'function' && process.getuid() !== 0) {
        return ['--permission-mode', 'bypassPermissions'];
    }
    return [];
}
function resolveAgentDir(projectRoot) {
    const profile = resolveProfile(projectRoot);
    return path.join(defaultConfigRoot(), profile, 'agent');
}
function findLocalAiFiles(projectRoot) {
    const matches = [];
    walk(projectRoot, (fullPath, entry) => {
        if (isLocalAiDirectory(entry)) {
            matches.push(fullPath);
            return 'skip';
        }
        if (isLocalAiFile(entry)) {
            matches.push(fullPath);
        }
        return undefined;
    });
    return matches.sort();
}
function walkSourceTree(dir, depth, visitor) {
    if (isIgnoredDir(dir)) {
        return;
    }
    const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const result = visitor(fullPath, entry, depth + 1);
        if (entry.isDirectory() && result !== 'skip') {
            walkSourceTree(fullPath, depth + 1, visitor);
        }
    }
}
function walk(dir, visitor) {
    if (isIgnoredDir(dir)) {
        return;
    }
    const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (shouldPruneProjectEntry(entry)) {
            continue;
        }
        const result = visitor(fullPath, entry);
        if (entry.isDirectory() && result !== 'skip') {
            walk(fullPath, visitor);
        }
    }
}
function shouldPruneProjectEntry(entry) {
    return (entry.isDirectory() &&
        (entry.name === '.git' ||
            entry.name === 'node_modules' ||
            entry.name === '.pnpm-store' ||
            entry.name === 'dist' ||
            entry.name === 'build'));
}
function isLocalAiDirectory(entry) {
    return entry.isDirectory() && (entry.name === '.claude' || entry.name === '.codex');
}
function isLocalAiFile(entry) {
    return entry.isFile() && LOCAL_AI_FILE_NAMES.has(entry.name);
}
function isIgnoredDir(dir) {
    if (fs.existsSync(path.join(dir, IGNORE_FILE_NAME))) {
        return true;
    }
    const env = readAgentRunEnv(dir);
    return parseBooleanEnv(env.AGENT_RUN_IGNORE);
}
function failForLocalAiFiles(tool, projectRoot, localAiFiles) {
    process.stderr.write(`agent-run: found local AI files in project root ${projectRoot}\n`);
    for (const file of localAiFiles) {
        process.stderr.write(`agent-run:   ${file}\n`);
    }
    process.stderr.write(`agent-run: move these files manually out of the project, or run \`${tool}\` directly if you want to use the local files.\n`);
    process.stderr.write(`agent-run: run \`agent-run ${tool} --none\` to bypass the wrapper for this invocation.\n`);
    process.exit(1);
}
function findProjectRoot(cwd) {
    let dir = path.resolve(cwd);
    let nearestPackageRoot = '';
    let workspaceRoot = '';
    let gitRoot = '';
    for (;;) {
        const packagePath = path.join(dir, 'package.json');
        if (fs.existsSync(packagePath)) {
            if (!nearestPackageRoot) {
                nearestPackageRoot = dir;
            }
            if (isWorkspaceRoot(dir)) {
                workspaceRoot = dir;
            }
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
    return workspaceRoot || nearestPackageRoot || gitRoot || path.resolve(cwd);
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
        fail(result.reason);
    }
    return result.profile;
}
function resolveProfileResult(projectRoot) {
    const env = readAgentRunEnv(projectRoot);
    const envProfile = env.AGENT_RUN_PROFILE?.trim();
    if (envProfile) {
        return {
            profile: normalizeProfile(envProfile),
            reason: ''
        };
    }
    const packagePath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packagePath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            if (typeof pkg.name === 'string' && pkg.name.length > 0) {
                return {
                    profile: normalizeProfile(pkg.name.startsWith('@') ? pkg.name.slice(1) : pkg.name),
                    reason: ''
                };
            }
        }
        catch {
            return {
                profile: null,
                reason: `cannot parse package.json: ${packagePath}`
            };
        }
    }
    return {
        profile: null,
        reason: `cannot resolve agent profile for ${projectRoot}; add ${ENV_FILE_NAME} with AGENT_RUN_PROFILE=<org/repo> or set package.json.name`
    };
}
function normalizeProfile(profile) {
    return profile.replace(/^\/+|\/+$/g, '');
}
function readAgentRunEnv(dir) {
    const filePath = path.join(dir, ENV_FILE_NAME);
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const env = {};
    const lines = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (const rawLine of lines) {
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
        if (value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}
function parseBooleanEnv(value) {
    if (value === undefined) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
function defaultConfigRoot() {
    if (process.env.AGENT_CONFIG_ROOT) {
        return process.env.AGENT_CONFIG_ROOT;
    }
    return path.join(defaultSourceStorageRoot(), 'agent-configs');
}
function defaultSourceStorageRoot() {
    if (process.env.AGENT_SOURCE_ROOT) {
        return process.env.AGENT_SOURCE_ROOT;
    }
    if (process.env.SOURCE_STORAGE_DIR) {
        return process.env.SOURCE_STORAGE_DIR;
    }
    if (IS_WINDOWS) {
        return path.join(os.homedir(), 'Documents', 'source');
    }
    return path.join(os.homedir(), 'source');
}
function findRealBinary(tool) {
    const pathValue = process.env.PATH || '';
    const pathDirs = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);
    const currentScriptArg = process.argv[1];
    const currentScript = currentScriptArg ? fs.realpathSync(currentScriptArg) : '';
    const wrapperCandidates = new Set([
        path.join(__dirname, tool),
        path.join(__dirname, `${tool}.js`),
        path.join(__dirname, `${tool}.cmd`),
        path.join(__dirname, `${tool}.bat`),
        path.join(__dirname, `${tool}.exe`),
        path.join(__dirname, 'agent-run'),
        path.join(__dirname, 'agent-run.js'),
        path.join(__dirname, 'agent-run.cmd'),
        path.join(__dirname, 'agent-run.bat'),
        path.join(__dirname, 'agent-run.exe')
    ]
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => {
        try {
            return fs.realpathSync(candidate);
        }
        catch {
            return candidate;
        }
    }));
    const extensions = getExecutableExtensions(tool);
    for (const dir of pathDirs) {
        for (const extension of extensions) {
            const candidate = path.join(dir, `${tool}${extension}`);
            if (!fs.existsSync(candidate)) {
                continue;
            }
            if (!isExecutable(candidate)) {
                continue;
            }
            let resolvedCandidate = candidate;
            try {
                resolvedCandidate = fs.realpathSync(candidate);
            }
            catch {
                resolvedCandidate = candidate;
            }
            if (resolvedCandidate === currentScript) {
                continue;
            }
            if (wrapperCandidates.has(resolvedCandidate)) {
                continue;
            }
            return candidate;
        }
    }
    fail(`no ${tool} binary found in PATH`);
}
function getExecutableExtensions(tool) {
    if (!IS_WINDOWS) {
        return [''];
    }
    if (path.extname(tool)) {
        return [''];
    }
    const pathExt = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .filter((entry) => entry.length > 0)
        .map((entry) => entry.toLowerCase());
    return [''].concat(pathExt);
}
function isExecutable(filePath) {
    try {
        if (IS_WINDOWS) {
            return fs.statSync(filePath).isFile();
        }
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function execTool(command, args) {
    execCommand(command, args, shouldUseShell(command));
}
function execCommand(command, args, shell) {
    const child = childProcess.spawn(command, args, {
        shell,
        stdio: 'inherit'
    });
    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code === null ? 1 : code);
    });
    child.on('error', (error) => {
        fail(error.message);
    });
}
function openEditor(filePath) {
    const visual = process.env.VISUAL?.trim();
    if (visual) {
        execCommand(visual, [filePath], true);
        return;
    }
    const editor = process.env.EDITOR?.trim();
    if (editor) {
        execCommand(editor, [filePath], true);
        return;
    }
    const vscodeCommand = findVsCodeEditorCommand();
    if (vscodeCommand !== null) {
        execCommand(vscodeCommand, ['--reuse-window', filePath], shouldUseShell(vscodeCommand));
        return;
    }
    const fallbackEditor = findFallbackEditor();
    if (fallbackEditor !== null) {
        execCommand(fallbackEditor, [filePath], shouldUseShell(fallbackEditor));
        return;
    }
    if (IS_WINDOWS) {
        execCommand('cmd.exe', ['/c', 'start', '', filePath], false);
        return;
    }
    if (process.platform === 'darwin') {
        execCommand('open', [filePath], false);
        return;
    }
    execCommand('xdg-open', [filePath], false);
}
function findVsCodeEditorCommand() {
    if (!isRunningInVsCodeTerminal()) {
        return null;
    }
    for (const candidate of ['code', 'codium']) {
        const resolved = findExecutable(candidate);
        if (resolved !== null) {
            return resolved;
        }
    }
    return null;
}
function isRunningInVsCodeTerminal() {
    const termProgram = process.env.TERM_PROGRAM?.trim().toLowerCase();
    if (termProgram === 'vscode') {
        return true;
    }
    return (Boolean(process.env.VSCODE_GIT_IPC_HANDLE) ||
        Boolean(process.env.VSCODE_IPC_HOOK) ||
        Boolean(process.env.VSCODE_IPC_HOOK_CLI));
}
function findFallbackEditor() {
    const candidates = IS_WINDOWS
        ? ['notepad.exe']
        : ['joe', 'sensible-editor', 'editor', 'nano', 'nvim', 'vim', 'vi'];
    for (const candidate of candidates) {
        const resolved = findExecutable(candidate);
        if (resolved !== null) {
            return resolved;
        }
    }
    return null;
}
function findExecutable(command) {
    const pathValue = process.env.PATH || '';
    const pathDirs = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);
    const extensions = getExecutableExtensionsForCommand(command);
    for (const dir of pathDirs) {
        for (const extension of extensions) {
            const candidate = path.join(dir, `${command}${extension}`);
            if (!fs.existsSync(candidate)) {
                continue;
            }
            if (!isExecutable(candidate)) {
                continue;
            }
            return candidate;
        }
    }
    return null;
}
function getExecutableExtensionsForCommand(command) {
    if (!IS_WINDOWS) {
        return [''];
    }
    if (path.extname(command)) {
        return [''];
    }
    const pathExt = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .filter((entry) => entry.length > 0)
        .map((entry) => entry.toLowerCase());
    return [''].concat(pathExt);
}
function shouldUseShell(command) {
    if (!IS_WINDOWS) {
        return false;
    }
    const extension = path.extname(command).toLowerCase();
    return extension === '.cmd' || extension === '.bat';
}
function splitRelativePath(relativePath) {
    if (!relativePath || relativePath === '.') {
        return [];
    }
    return relativePath.split(path.sep).filter((segment) => segment.length > 0);
}
function fail(message) {
    process.stderr.write(`agent-run: ${message}\n`);
    process.exit(1);
}
