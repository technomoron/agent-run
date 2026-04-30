#!/usr/bin/env node
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
const jsonc_parser_1 = require("jsonc-parser");
const nunjucks = require("nunjucks");
const IS_WINDOWS = process.platform === 'win32';
const ENV_FILE_NAME = '.agent-run.env';
const IGNORE_FILE_NAME = '.agent-run-ignore';
const LOCAL_AI_FILE_NAMES = new Set(['AGENTS.md', 'AGENTS-MODS.md', 'AGENTS.override.md', 'CLAUDE.md', 'codex.md']);
const CONFIG_ROOT_OVERRIDE_ENV = 'AGENT_RUN_CONFIG_ROOT_OVERRIDE';
const CONFIG_DIR_ENV = 'AGENT_CONFIG_DIR';
const VERBOSE_ENV = 'AGENT_RUN_VERBOSE';
const MANIFEST_FILE_NAME = 'agent-run.jsonc';
const LOCAL_TEMPLATE_FILE_NAME = 'local.md.njk';
const LIVE_DIR_NAME = 'live';
const PACKAGE_VERSION = '0.99.10';
const UNEXPANDED_TEMPLATE_RE = /\{\{[^}]+\}\}|\{%[^%]+%\}/;
const agentRunEnvCache = new Map();
const GENERATED_GITIGNORE_ENTRIES = [
    '# Generated agent-run live profiles',
    '**/live/',
    '',
    '# Optional generated caches',
    '**/.agent-run-cache/'
];
const REQUIRED_GLOBAL_TEMPLATES = [
    'global/agents/code.md.njk',
    'global/agents/writing.md.njk',
    'global/snippets/git-rules.md.njk',
    'global/snippets/no-ai-files.md.njk',
    'global/snippets/verification.md.njk',
    'global/tool-templates/codex-config.toml.njk',
    'global/tool-templates/claude-settings.json.njk',
    'global/skills/commit-workflow/SKILL.md.njk',
    'global/skills/github-release/SKILL.md.njk',
    'global/skills/code-review/SKILL.md.njk'
];
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
    if (parsed.command === 'init-config') {
        runInitConfig(parsed);
        return;
    }
    if (parsed.command === 'edit') {
        runEdit(parsed);
        return;
    }
    if (parsed.command === 'update') {
        runUpdate(parsed);
        return;
    }
    if (parsed.command === 'migrate-config') {
        runMigrateConfig(parsed);
        return;
    }
    runTool(parsed);
}
function parseInvocation(invokedTool, argv) {
    let command = normalizeCommandName(invokedTool);
    const extracted = extractGlobalOptions(argv);
    const inputArgs = extracted.args;
    if (extracted.verbose) {
        process.env[VERBOSE_ENV] = '1';
    }
    if (extracted.configRootOverride !== null) {
        process.env[CONFIG_ROOT_OVERRIDE_ENV] = extracted.configRootOverride;
    }
    if (extracted.initConfig) {
        if (inputArgs.length > 0) {
            fail('--init cannot be combined with a command');
        }
        return {
            command: 'init-config',
            targetPath: path.resolve(extracted.initConfigTargetPath ?? defaultConfigRoot())
        };
    }
    if (command === null) {
        if (inputArgs.length === 0) {
            fail('usage: agent-run <codex|claude|check|init|edit|update> [options] (run with --help for details)');
        }
        const firstArg = inputArgs[0];
        if (isHelpFlag(firstArg)) {
            printHelp('general');
        }
        if (isVersionFlag(firstArg)) {
            printVersion();
        }
        const commandIndex = findCommandArgIndex(inputArgs);
        if (commandIndex === -1) {
            fail(`unknown command: ${firstArg ?? ''} (run with --help for usage)`);
        }
        const parsedCommand = normalizeCommandName(inputArgs[commandIndex] ?? '');
        if (parsedCommand === null) {
            fail(`unknown command: ${firstArg ?? ''} (run with --help for usage)`);
        }
        command = parsedCommand;
        inputArgs.splice(commandIndex, 1);
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
    if (command === 'update') {
        return parseUpdateCommand(inputArgs);
    }
    if (command === 'migrate-config') {
        return parseMigrateConfigCommand(inputArgs);
    }
    return parseRunCommand(command, inputArgs);
}
function findCommandArgIndex(args) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--') {
            return -1;
        }
        if (normalizeCommandName(arg ?? '') !== null) {
            return index;
        }
    }
    return -1;
}
function extractGlobalOptions(argv) {
    const args = [];
    let configRootOverride = null;
    let initConfig = false;
    let initConfigTargetPath = null;
    let verbose = false;
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
        if (arg === '-v' || arg === '--verbose') {
            verbose = true;
            continue;
        }
        if (arg === '--init') {
            initConfig = true;
            const nextArg = argv[index + 1];
            if (nextArg !== undefined && !nextArg.startsWith('-')) {
                initConfigTargetPath = nextArg;
                index += 1;
            }
            continue;
        }
        if (arg === '--config-root') {
            const nextArg = argv[index + 1];
            if (nextArg === undefined) {
                fail('missing value for --config-root');
            }
            configRootOverride = path.resolve(nextArg);
            index += 1;
            continue;
        }
        if (arg.startsWith('--config-root=')) {
            const rootValue = arg.slice('--config-root='.length);
            if (!rootValue) {
                fail('missing value for --config-root');
            }
            configRootOverride = path.resolve(rootValue);
            continue;
        }
        args.push(arg);
    }
    return { args, configRootOverride, initConfig, initConfigTargetPath, verbose };
}
function parseRunCommand(command, inputArgs) {
    const wrapperArgs = {
        none: false,
        create: false,
        local: false,
        show: false,
        generate: false,
        codexSandboxMode: null,
        codexNetwork: false
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
        if (arg === '--local') {
            wrapperArgs.local = true;
            continue;
        }
        if (arg === '--show') {
            wrapperArgs.show = true;
            continue;
        }
        if (arg === '--generate') {
            wrapperArgs.generate = true;
            continue;
        }
        if (arg === '--danger') {
            if (command !== 'codex') {
                fail('--danger is only supported for agent-run codex');
            }
            if (wrapperArgs.codexSandboxMode === 'sandboxed') {
                fail('cannot combine --danger and --sandboxed');
            }
            wrapperArgs.codexSandboxMode = 'danger';
            continue;
        }
        if (arg === '--sandboxed') {
            if (command !== 'codex') {
                fail('--sandboxed is only supported for agent-run codex');
            }
            if (wrapperArgs.codexSandboxMode === 'danger') {
                fail('cannot combine --danger and --sandboxed');
            }
            wrapperArgs.codexSandboxMode = 'sandboxed';
            continue;
        }
        if (arg === '--network') {
            if (command !== 'codex') {
                fail('--network is only supported for agent-run codex --sandboxed');
            }
            wrapperArgs.codexNetwork = true;
            continue;
        }
        args.push(arg);
    }
    if (wrapperArgs.codexNetwork && wrapperArgs.codexSandboxMode !== 'sandboxed') {
        fail('--network is only meaningful with agent-run codex --sandboxed');
    }
    return { args, command, wrapperArgs };
}
function parseCheckCommand(inputArgs) {
    let all = false;
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('check');
        }
        if (arg === '--all') {
            all = true;
            continue;
        }
        if (arg.startsWith('--')) {
            fail(`unknown check option: ${arg}`);
        }
        targetPath = arg;
    }
    return { all, command: 'check', targetPath: path.resolve(targetPath) };
}
function parseInitCommand(inputArgs) {
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('init');
        }
        if (arg.startsWith('--')) {
            fail(`unknown init option: ${arg}`);
        }
        targetPath = arg;
    }
    return { command: 'init', targetPath: path.resolve(targetPath) };
}
function parseEditCommand(inputArgs) {
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('edit');
        }
        if (arg.startsWith('--')) {
            fail(`unknown edit option: ${arg}`);
        }
        targetPath = arg;
    }
    return { command: 'edit', targetPath: path.resolve(targetPath) };
}
function parseUpdateCommand(inputArgs) {
    let targetPath = process.cwd();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('update');
        }
        if (arg.startsWith('--')) {
            fail(`unknown update option: ${arg}`);
        }
        targetPath = arg;
    }
    return { command: 'update', targetPath: path.resolve(targetPath) };
}
function parseMigrateConfigCommand(inputArgs) {
    let configRoot = defaultConfigRoot();
    for (const arg of inputArgs) {
        if (isHelpFlag(arg)) {
            printHelp('migrate-config');
        }
        if (arg.startsWith('--')) {
            fail(`unknown migrate-config option: ${arg}`);
        }
        configRoot = arg;
    }
    return { command: 'migrate-config', configRoot: path.resolve(configRoot) };
}
function isHelpFlag(value) {
    return value === '-h' || value === '--help';
}
function isVersionFlag(value) {
    return value === '-V' || value === '--version';
}
function printVersion() {
    process.stdout.write(`agent-run ${agentRunVersion()}\n`);
    process.exit(0);
}
function printHelp(topic) {
    process.stdout.write(renderHelp(topic));
    process.exit(0);
}
function renderHelp(topic) {
    switch (topic) {
        case 'check':
            return [
                'Usage:',
                '  agent-run check [--all] [path]',
                '',
                'Check generated profile files, native skills, guard shims, and local AI-file leaks.',
                '',
                'Options:',
                '  -h, --help  Show this help text',
                '  --all       Check every repo under path',
                ''
            ].join('\n');
        case 'init':
            return [
                'Usage:',
                '  agent-run init [path]',
                '',
                'Create the mapped profile manifest/templates and render generated files.',
                ''
            ].join('\n');
        case 'edit':
            return [
                'Usage:',
                '  agent-run edit [path]',
                '',
                'Open the editable local profile template.',
                ''
            ].join('\n');
        case 'update':
            return [
                'Usage:',
                '  agent-run update [path]',
                '',
                'Render generated files, native skills, config, and guard shims for the repo at path.',
                ''
            ].join('\n');
        case 'migrate-config':
            return [
                'Usage:',
                '  agent-run migrate-config [config-root]',
                '',
                'Convert an existing agent config tree to manifest/local.md.njk/global layout.',
                ''
            ].join('\n');
        case 'general':
        default:
            return [
                `agent-run ${agentRunVersion()}`,
                '',
                'Usage:',
                '  agent-run <codex|claude|check|init|edit|update> [options]',
                '  agent-run --init [config-root]',
                '',
                'Commands:',
                '  codex [--none] [--create] [--local] [--show] [--generate] [--danger|--sandboxed] [--network] [args...]',
                '                                           Run codex with generated private config',
                '  claude [--none] [--create] [--local] [--show] [--generate] [args...]',
                '                                           Run claude with generated private config',
                '  check [--all] [path]                  Validate generated profile output',
                '  init [path]                           Create profile source files and render output',
                '  edit [path]                           Open local.md.njk or legacy AGENTS-MODS.md',
                '  update [path]                         Regenerate profile output',
                '  migrate-config [config-root]           Convert existing config tree layout',
                '',
                'Global options:',
                '  -h, --help         Show this help text',
                '  -V, --version      Show the agent-run version',
                '  -v, --verbose      Print path resolution and wrapper actions',
                '  --config-root DIR  Override the agent-config root',
                '  --init [DIR]       Copy the packaged starter config root to DIR (default ~/.agent-config)',
                '',
                'Run wrapper options:',
                '  --local            Warn about local AI files instead of failing',
                '  --show             Show read/include and generated files without running the tool',
                '  --generate         Generate files without running the tool',
                '',
                'Codex wrapper options:',
                '  --danger           Run Codex with no sandbox: -a never -s danger-full-access (default)',
                '  --sandboxed        Run Codex with workspace-write sandbox',
                '  --network          Enable network for --sandboxed via config override',
                ''
            ].join('\n');
    }
}
function agentRunVersion() {
    const packagePath = path.resolve(__dirname, '..', 'package.json');
    try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (typeof pkg.version === 'string' && pkg.version.length > 0) {
            return pkg.version;
        }
    }
    catch {
        return PACKAGE_VERSION;
    }
    return PACKAGE_VERSION;
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
    if (base === 'update') {
        return 'update';
    }
    if (base === 'migrate-config' || base === 'migrate-config.cmd') {
        return 'migrate-config';
    }
    return null;
}
function runTool(parsed) {
    const { args, command, wrapperArgs } = parsed;
    const projectRoot = findProjectRoot(process.cwd());
    verbose(`run ${command}: cwd=${process.cwd()} projectRoot=${projectRoot}`);
    if (wrapperArgs.show && wrapperArgs.none) {
        fail('--show cannot be combined with --none');
    }
    if (wrapperArgs.generate && wrapperArgs.none) {
        fail('--generate cannot be combined with --none');
    }
    if (wrapperArgs.generate && wrapperArgs.show) {
        fail('--generate cannot be combined with --show');
    }
    if (wrapperArgs.show && isIgnoredDir(projectRoot)) {
        fail(`cannot show generated ${command} files for ignored project: ${projectRoot}`);
    }
    if (wrapperArgs.generate && isIgnoredDir(projectRoot)) {
        fail(`cannot generate ${command} files for ignored project: ${projectRoot}`);
    }
    if (wrapperArgs.none || isIgnoredDir(projectRoot)) {
        const realBinary = findRealBinary(command);
        const permissionArgs = getPermissionArgs(command);
        verbose(`wrapper bypassed for ${command}${wrapperArgs.none ? ' via --none' : ' because project is ignored'}`);
        execTool(realBinary, [...permissionArgs, ...args]);
        return;
    }
    const profileResult = resolveProfileResult(projectRoot);
    if (profileResult.profile === null) {
        fail(profileResult.reason);
    }
    const profile = profileResult.profile;
    const configRoot = defaultConfigRoot(projectRoot);
    const agentDir = resolveAgentDir(projectRoot);
    if (wrapperArgs.show) {
        showToolProfile(command, projectRoot, agentDir);
        return;
    }
    if (wrapperArgs.create) {
        runInit({ command: 'init', targetPath: projectRoot });
    }
    ensureRunnableProfile(configRoot, agentDir, profile);
    if (wrapperArgs.generate) {
        const rendered = syncAgentProfile(projectRoot, agentDir);
        printUpdateSummary(rendered);
        return;
    }
    const localAiFiles = findLocalAiFiles(projectRoot, agentDir);
    if (localAiFiles.length > 0) {
        if (!wrapperArgs.local) {
            failForLocalAiFiles(command, projectRoot, localAiFiles);
        }
        warnForLocalAiFiles(command, projectRoot, localAiFiles);
    }
    const realBinary = findRealBinary(command);
    const permissionArgs = getPermissionArgs(command);
    syncAgentProfile(projectRoot, agentDir);
    if (command === 'codex') {
        runCodex(realBinary, permissionArgs, agentDir, configRoot, args, projectRoot, wrapperArgs);
        return;
    }
    runClaude(realBinary, permissionArgs, agentDir, configRoot, args, projectRoot, wrapperArgs);
}
function showToolProfile(command, projectRoot, agentDir) {
    const trace = { sourceFiles: new Set() };
    const rendered = renderProfile(projectRoot, agentDir, true, command, trace);
    const generatedFiles = uniqueSorted(rendered.files.map((file) => file.path));
    const sourceFiles = uniqueSorted([...trace.sourceFiles]);
    process.stdout.write([
        `Agent: ${command}`,
        `Profile: ${rendered.profile}`,
        `Project root: ${projectRoot}`,
        `Profile dir: ${agentDir}`,
        '',
        'Reads/includes:',
        ...formatPathList(sourceFiles),
        '',
        'Generates:',
        ...formatPathList(generatedFiles),
        ''
    ].join('\n'));
}
function uniqueSorted(values) {
    return [...new Set(values.map((value) => path.resolve(value)))].sort((a, b) => a.localeCompare(b));
}
function formatPathList(paths) {
    return paths.length === 0 ? ['  (none)'] : paths.map((entry) => `  ${entry}`);
}
function runInit(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    verbose(`init target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        return;
    }
    const profile = resolveProfile(projectRoot);
    const configRoot = defaultConfigRoot(projectRoot);
    const agentDir = resolveAgentDir(projectRoot);
    ensureConfigRootLayout(configRoot);
    ensureConfigRootGitignore(configRoot);
    ensureDefaultGlobalTemplates(configRoot);
    fs.mkdirSync(agentDir, { recursive: true });
    ensureProfileOverridesDir(agentDir);
    convertLegacyProfileIfNeeded(configRoot, agentDir, profile);
    createDefaultManifestFile(agentDir, profile);
    createDefaultLocalFile(agentDir, profile);
    const rendered = syncAgentProfile(projectRoot, agentDir);
    printUpdateSummary(rendered);
}
function runInitConfig(parsed) {
    const targetPath = path.resolve(parsed.targetPath);
    const sourcePath = starterConfigRootPath();
    if (!fs.existsSync(sourcePath)) {
        fail(`starter config skeleton not found: ${sourcePath}`);
    }
    copySkeletonTree(sourcePath, targetPath);
    process.stdout.write(`OK copied starter config to ${targetPath}\n`);
}
function ensureRunnableProfile(configRoot, agentDir, profile) {
    ensureConfigRootLayout(configRoot);
    ensureConfigRootGitignore(configRoot);
    ensureDefaultGlobalTemplates(configRoot);
    fs.mkdirSync(agentDir, { recursive: true });
    ensureProfileOverridesDir(agentDir);
    convertLegacyProfileIfNeeded(configRoot, agentDir, profile);
    createDefaultManifestFile(agentDir, profile);
    createDefaultLocalFile(agentDir, profile);
}
function runEdit(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    verbose(`edit target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        process.exit(0);
    }
    const agentDir = resolveAgentDir(projectRoot);
    const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
    const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
    if (!fs.existsSync(localPath) && !fs.existsSync(legacyPath)) {
        runInit({ command: 'init', targetPath: projectRoot });
    }
    const editPath = fs.existsSync(localPath) ? localPath : legacyPath;
    process.stdout.write(`Edit: ${editPath}\n`);
    openEditor(editPath);
}
function runUpdate(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    verbose(`update target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        return;
    }
    const profile = resolveProfile(projectRoot);
    const configRoot = defaultConfigRoot(projectRoot);
    const agentDir = resolveAgentDir(projectRoot);
    ensureConfigRootLayout(configRoot);
    ensureConfigRootGitignore(configRoot);
    ensureDefaultGlobalTemplates(configRoot);
    fs.mkdirSync(agentDir, { recursive: true });
    ensureProfileOverridesDir(agentDir);
    convertLegacyProfileIfNeeded(configRoot, agentDir, profile);
    createDefaultManifestFile(agentDir, profile);
    createDefaultLocalFile(agentDir, profile);
    const rendered = syncAgentProfile(projectRoot, agentDir);
    printUpdateSummary(rendered);
}
function runMigrateConfig(parsed) {
    const configRoot = parsed.configRoot;
    verbose(`migrate config root=${configRoot}`);
    if (!fs.existsSync(configRoot)) {
        fail(`missing config root: ${configRoot}`);
    }
    ensureConfigRootLayout(configRoot);
    ensureConfigRootGitignore(configRoot);
    migrateOldTemplates(configRoot);
    ensureDefaultGlobalTemplates(configRoot);
    const profileDirs = findLegacyProfileDirs(configRoot);
    let createdManifestCount = 0;
    let createdLocalCount = 0;
    let createdOverridesCount = 0;
    let movedRuntimeCount = 0;
    let movedReviewCount = 0;
    let movedMemoryCount = 0;
    for (const agentDir of profileDirs) {
        const profile = path.relative(configRoot, agentDir).replace(/\\/g, '/');
        const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
        if (!fs.existsSync(localPath)) {
            const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
            fs.writeFileSync(localPath, convertLegacyTemplateVars(fs.readFileSync(legacyPath, 'utf8')), 'utf8');
            createdLocalCount += 1;
        }
        const manifestPath = path.join(agentDir, MANIFEST_FILE_NAME);
        if (!fs.existsSync(manifestPath)) {
            createDefaultManifestFile(agentDir, profile);
            createdManifestCount += 1;
        }
        const overridesDir = path.join(agentDir, 'overrides');
        if (!fs.existsSync(overridesDir)) {
            fs.mkdirSync(overridesDir, { recursive: true });
            createdOverridesCount += 1;
        }
        movedRuntimeCount += migrateCodexRuntimeFiles(agentDir);
        movedReviewCount += migrateLooseFiles(agentDir, /^REVIEW(?:-.+)?\.md$/, 'reviews');
        movedMemoryCount += migrateLooseFiles(agentDir, /^memory.*\.md$/i, 'memories');
    }
    process.stdout.write(`OK migrated ${configRoot}\n`);
    process.stdout.write(`Profiles converted: ${profileDirs.length}\n`);
    process.stdout.write(`Created local.md.njk: ${createdLocalCount}\n`);
    process.stdout.write(`Created agent-run.jsonc: ${createdManifestCount}\n`);
    process.stdout.write(`Created overrides dirs: ${createdOverridesCount}\n`);
    process.stdout.write(`Moved Codex runtime entries: ${movedRuntimeCount}\n`);
    process.stdout.write(`Moved review files: ${movedReviewCount}\n`);
    process.stdout.write(`Moved memory files: ${movedMemoryCount}\n`);
}
function runCheck(parsed) {
    if (parsed.all) {
        verbose(`check --all root=${parsed.targetPath}`);
        const report = checkSourceTree(parsed.targetPath);
        printBatchReport(report.root, report.entries);
        process.exit(report.hasErrors ? 1 : 0);
    }
    const projectRoot = findProjectRoot(parsed.targetPath);
    verbose(`check target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`Check: ${projectRoot}\n`);
        process.stdout.write('SKIP ignored by .agent-run-ignore\n');
        process.exit(0);
    }
    const findings = checkProject(projectRoot);
    printProjectReport(projectRoot, findings);
    process.exit(hasErrors(findings) ? 1 : 0);
}
function printUpdateSummary(rendered) {
    process.stdout.write(`OK profile ${rendered.profile}\n`);
    process.stdout.write(`Profile dir: ${rendered.agentDir}\n`);
    process.stdout.write(`Live dir: ${rendered.context.paths.liveDir}\n`);
    process.stdout.write(`Generated files: ${rendered.files.length}\n`);
    process.stdout.write(`Installed skills: ${rendered.skills.map((skill) => skill.name).join(', ') || '(none)'}\n`);
}
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
    for (const entry of GENERATED_GITIGNORE_ENTRIES) {
        if (entry === '' || present.has(entry)) {
            continue;
        }
        lines.push(entry);
        present.add(entry);
        changed = true;
    }
    if (!changed) {
        return;
    }
    fs.writeFileSync(gitignorePath, `${lines.join('\n')}\n`, 'utf8');
}
function ensureDefaultGlobalTemplates(configRoot) {
    const defaults = new Map([
        ['global/agents/code.md.njk', defaultCodeAgentTemplate()],
        ['global/agents/writing.md.njk', defaultWritingAgentTemplate()],
        ['global/snippets/git-rules.md.njk', defaultGitRulesSnippet()],
        ['global/snippets/no-ai-files.md.njk', defaultNoAiFilesSnippet()],
        ['global/snippets/verification.md.njk', defaultVerificationSnippet()],
        ['global/tool-templates/codex-config.toml.njk', defaultCodexConfigTemplate()],
        ['global/tool-templates/claude-settings.json.njk', defaultClaudeSettingsTemplate()],
        ['global/skills/commit-workflow/SKILL.md.njk', defaultCommitWorkflowSkill()],
        ['global/skills/github-release/SKILL.md.njk', defaultGithubReleaseSkill()],
        ['global/skills/code-review/SKILL.md.njk', defaultCodeReviewSkill()]
    ]);
    for (const [relativePath, content] of defaults) {
        const filePath = path.join(configRoot, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, content, 'utf8');
            verbose(`created ${filePath}`);
        }
    }
}
function migrateOldTemplates(configRoot) {
    const oldCodeTemplate = path.join(configRoot, 'templates', 'AGENTS-CODE.md');
    const newCodeTemplate = path.join(configRoot, 'global', 'agents', 'code.md.njk');
    if (fs.existsSync(oldCodeTemplate) && !fs.existsSync(newCodeTemplate)) {
        fs.mkdirSync(path.dirname(newCodeTemplate), { recursive: true });
        fs.writeFileSync(newCodeTemplate, convertLegacyTemplateVars(fs.readFileSync(oldCodeTemplate, 'utf8')), 'utf8');
    }
}
function findLegacyProfileDirs(configRoot) {
    const dirs = [];
    walkConfigTree(configRoot, 0, (fullPath, entry) => {
        if (!entry.isDirectory()) {
            return undefined;
        }
        if (shouldPruneConfigEntry(entry)) {
            return 'skip';
        }
        if (fs.existsSync(path.join(fullPath, 'AGENTS-MODS.md'))) {
            dirs.push(fullPath);
            return 'skip';
        }
        return undefined;
    });
    return dirs.sort();
}
function walkConfigTree(dir, depth, visitor) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const result = visitor(fullPath, entry, depth + 1);
        if (entry.isDirectory() && result !== 'skip') {
            walkConfigTree(fullPath, depth + 1, visitor);
        }
    }
}
function shouldPruneConfigEntry(entry) {
    return (entry.isDirectory() &&
        (entry.name === '.git' ||
            entry.name === 'global' ||
            entry.name === 'templates' ||
            entry.name === '.agents' ||
            entry.name === '.claude' ||
            entry.name === '.codex' ||
            entry.name === 'bin' ||
            entry.name === 'reviews' ||
            entry.name === 'memories' ||
            entry.name === 'cache' ||
            entry.name === 'log' ||
            entry.name === 'sessions' ||
            entry.name === 'shell_snapshots' ||
            entry.name === 'skills' ||
            entry.name === 'tmp' ||
            entry.name === '.tmp'));
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
    return converted
        .replace(/^@[^\n]*templates\/AGENTS-CODE\.md[^\n]*\n?/gm, '')
        .replace(/^\n{2,}/, '\n');
}
function migrateCodexRuntimeFiles(agentDir) {
    const runtimeNames = [
        '.personality_migration',
        '.tmp',
        'auth.json',
        'cache',
        'history.jsonl',
        'installation_id',
        'log',
        'logs_2.sqlite',
        'models_cache.json',
        'sessions',
        'shell_snapshots',
        'skills',
        'state_5.sqlite',
        'tmp',
        'version.json'
    ];
    const codexHome = path.join(agentDir, 'memories', 'codex-home');
    let moved = 0;
    for (const name of runtimeNames) {
        const source = path.join(agentDir, name);
        const target = path.join(codexHome, name);
        if (!fs.existsSync(source) || fs.existsSync(target)) {
            continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(source, target);
        moved += 1;
    }
    return moved;
}
function migrateLooseFiles(agentDir, pattern, targetDirName) {
    const entries = fs.readdirSync(agentDir, { withFileTypes: true });
    let moved = 0;
    for (const entry of entries) {
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
function convertLegacyProfileIfNeeded(_configRoot, agentDir, _profile) {
    const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
    const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
    if (fs.existsSync(legacyPath) && !fs.existsSync(localPath)) {
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(localPath, fs.readFileSync(legacyPath, 'utf8'), 'utf8');
        verbose(`converted ${legacyPath} -> ${localPath}`);
    }
}
function createDefaultManifestFile(agentDir, profile) {
    const manifestPath = path.join(agentDir, MANIFEST_FILE_NAME);
    if (fs.existsSync(manifestPath)) {
        return;
    }
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(manifestPath, stringifyDefaultManifest(profile), 'utf8');
    verbose(`created ${manifestPath}`);
}
function createDefaultLocalFile(agentDir, profile) {
    const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
    if (fs.existsSync(localPath)) {
        return;
    }
    const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
    const content = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath, 'utf8') : defaultLocalTemplate(profile);
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(localPath, content, 'utf8');
    verbose(`created ${localPath}`);
}
function ensureProfileOverridesDir(agentDir) {
    fs.mkdirSync(path.join(agentDir, 'overrides'), { recursive: true });
}
function loadManifest(_configRoot, agentDir, profile, trace) {
    const manifestPath = path.join(agentDir, MANIFEST_FILE_NAME);
    if (!fs.existsSync(manifestPath)) {
        const manifest = defaultManifest(profile);
        const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
        const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
        if (!fs.existsSync(localPath) && fs.existsSync(legacyPath)) {
            manifest.agent = {
                ...(manifest.agent ?? {}),
                includes: ['{{ profile }}/AGENTS-MODS.md']
            };
        }
        if (!fs.existsSync(localPath) && !fs.existsSync(legacyPath)) {
            manifest.agent = {
                ...(manifest.agent ?? {}),
                includes: []
            };
        }
        return manifest;
    }
    trace?.sourceFiles.add(manifestPath);
    const text = fs.readFileSync(manifestPath, 'utf8');
    const errors = [];
    const parsed = (0, jsonc_parser_1.parse)(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
        const first = errors[0];
        const detail = first ? `${(0, jsonc_parser_1.printParseErrorCode)(first.error)} at offset ${first.offset}` : 'unknown JSONC parse error';
        throw new Error(`invalid JSONC in ${manifestPath}: ${detail}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`manifest must be an object: ${manifestPath}`);
    }
    return parsed;
}
function defaultManifest(profile) {
    return {
        profile,
        kind: 'code',
        agent: {
            base: 'global/agents/code.md.njk',
            includes: [`{{ profile }}/${LOCAL_TEMPLATE_FILE_NAME}`]
        },
        skills: {
            install: ['commit-workflow', 'github-release', 'code-review']
        },
        tools: {
            codex: true,
            claude: true
        },
        checks: ['agent-run check .', 'repo-check check .', 'pnpm run cleanbuild'],
        guardrails: {
            blockGitWrite: true,
            blockPublish: true,
            blockGithubRelease: true,
            forbidRepoAiFiles: true
        },
        paths: {
            changesFile: '{{ projectRoot }}/CHANGES',
            reviewDir: '{{ agentDir }}/reviews',
            reviewFile: '{{ agentDir }}/reviews/REVIEW-{{ date }}.md',
            memoriesDir: '{{ agentDir }}/memories'
        }
    };
}
function normalizeManifest(manifest, profile) {
    const baseManifest = defaultManifest(profile);
    const installedSkills = Array.isArray(manifest.skills)
        ? manifest.skills
        : manifest.skills?.install ?? asSkillObject(baseManifest.skills).install;
    const overrides = Array.isArray(manifest.skills) ? {} : manifest.skills?.overrides ?? {};
    return {
        profile: manifest.profile ?? profile,
        kind: manifest.kind ?? baseManifest.kind ?? 'code',
        agent: {
            base: manifest.agent?.base ?? baseManifest.agent?.base ?? 'global/agents/code.md.njk',
            includes: manifest.agent?.includes ?? defaultAgentIncludesForProfile(profile)
        },
        skills: {
            install: installedSkills,
            overrides
        },
        tools: {
            codex: manifest.tools?.codex ?? true,
            claude: manifest.tools?.claude ?? true
        },
        checks: manifest.checks ?? baseManifest.checks ?? [],
        guardrails: {
            blockGitWrite: manifest.guardrails?.blockGitWrite ?? true,
            blockPublish: manifest.guardrails?.blockPublish ?? true,
            blockGithubRelease: manifest.guardrails?.blockGithubRelease ?? true,
            forbidRepoAiFiles: manifest.guardrails?.forbidRepoAiFiles ?? true
        },
        paths: {
            changesFile: manifest.paths?.changesFile ?? baseManifest.paths?.changesFile ?? '{{ projectRoot }}/CHANGES',
            reviewDir: manifest.paths?.reviewDir ?? baseManifest.paths?.reviewDir ?? '{{ agentDir }}/reviews',
            reviewFile: manifest.paths?.reviewFile ?? baseManifest.paths?.reviewFile ?? '{{ agentDir }}/reviews/REVIEW-{{ date }}.md',
            memoriesDir: manifest.paths?.memoriesDir ?? baseManifest.paths?.memoriesDir ?? '{{ agentDir }}/memories'
        }
    };
}
function asSkillObject(skills) {
    if (Array.isArray(skills)) {
        return { install: skills, overrides: {} };
    }
    return {
        install: skills?.install ?? [],
        overrides: skills?.overrides ?? {}
    };
}
function defaultAgentIncludesForProfile(profile) {
    return [`{{ profile }}/${LOCAL_TEMPLATE_FILE_NAME}`, `{{ profile }}/AGENTS-MODS.md`];
}
function createNunjucksEnv(configRoot) {
    return new nunjucks.Environment(new nunjucks.FileSystemLoader(configRoot, { noCache: true }), {
        autoescape: false,
        trimBlocks: true,
        lstripBlocks: true,
        throwOnUndefined: true
    });
}
function buildRenderContext(projectRoot, profileDir, configRoot, manifest, env) {
    const date = localDateString();
    const liveDir = path.join(profileDir, LIVE_DIR_NAME);
    const baseContext = {
        profile: manifest.profile,
        kind: manifest.kind,
        projectRoot,
        agentDir: liveDir,
        profileDir,
        configRoot,
        date,
        checks: manifest.checks,
        guardrails: manifest.guardrails
    };
    const paths = {
        profileDir,
        liveDir,
        changesFile: resolveRuntimePath(configRoot, manifest.paths.changesFile, env, baseContext),
        reviewDir: resolveRuntimePath(configRoot, manifest.paths.reviewDir, env, baseContext),
        reviewFile: resolveRuntimePath(configRoot, manifest.paths.reviewFile, env, baseContext),
        memoriesDir: resolveRuntimePath(configRoot, manifest.paths.memoriesDir, env, baseContext),
        globalMemoryDir: globalMemoryDir(configRoot),
        codexHomeDir: path.join(resolveRuntimePath(configRoot, manifest.paths.memoriesDir, env, baseContext), 'codex-home'),
        overridesDir: path.join(profileDir, 'overrides'),
        codexSkillsDir: path.join(liveDir, '.agents', 'skills'),
        claudeSkillsDir: path.join(liveDir, '.claude', 'skills'),
        binDir: path.join(liveDir, 'bin')
    };
    return {
        ...baseContext,
        paths,
        permissionsAllow: buildPermissionsAllow(manifest),
        skills: [],
        renderedAgentSections: []
    };
}
function buildPermissionsAllow(manifest) {
    const allow = new Set();
    for (const check of manifest.checks) {
        const normalizedCheck = check.trim();
        if (normalizedCheck) {
            allow.add(`Bash(${normalizedCheck})`);
        }
    }
    return [...allow];
}
function resolveConfigPath(configRoot, relativePath, context) {
    const env = createNunjucksEnv(configRoot);
    const rendered = renderInlineTemplate(env, relativePath, context);
    const resolved = path.resolve(configRoot, rendered);
    if (!isSamePathOrDescendant(resolved, path.resolve(configRoot))) {
        throw new Error(`config path escapes config root: ${relativePath}`);
    }
    return resolved;
}
function resolveRuntimePath(configRoot, pathTemplate, env, context) {
    const rendered = renderInlineTemplate(env, pathTemplate, context);
    return path.isAbsolute(rendered) ? path.resolve(rendered) : path.resolve(configRoot, rendered);
}
function renderTemplateFile(env, configRoot, templatePath, context, trace) {
    const resolvedPath = resolveConfigPath(configRoot, templatePath, context);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`missing template: ${resolvedPath}`);
    }
    const relativePath = path.relative(configRoot, resolvedPath).replace(/\\/g, '/');
    let content = fs.readFileSync(resolvedPath, 'utf8');
    traceTemplateSource(configRoot, resolvedPath, content, context, trace);
    if (path.basename(resolvedPath) === 'AGENTS-MODS.md') {
        content = renderLegacyAgentsMods(resolvedPath, [], trace);
        return renderInlineTemplate(env, content, context);
    }
    return env.render(relativePath, context);
}
function traceTemplateSource(configRoot, sourcePath, content, context, trace, stack = []) {
    if (trace === undefined) {
        return;
    }
    const resolvedSource = path.resolve(sourcePath);
    trace.sourceFiles.add(resolvedSource);
    if (stack.includes(resolvedSource)) {
        return;
    }
    const nextStack = [...stack, resolvedSource];
    const includeRe = /{%\s*(?:include|extends|import)\s+["']([^"']+)["']|{%\s*from\s+["']([^"']+)["']/g;
    for (;;) {
        const match = includeRe.exec(content);
        if (match === null) {
            break;
        }
        const includePath = match[1] ?? match[2];
        if (!includePath) {
            continue;
        }
        const includedPath = resolveConfigPath(configRoot, includePath, context);
        if (!fs.existsSync(includedPath)) {
            continue;
        }
        const includedContent = fs.readFileSync(includedPath, 'utf8');
        traceTemplateSource(configRoot, includedPath, includedContent, context, trace, nextStack);
    }
}
function renderInlineTemplate(env, source, context) {
    return env.renderString(source, context);
}
function assertNoUnexpandedTemplateVars(label, content) {
    if (UNEXPANDED_TEMPLATE_RE.test(content)) {
        throw new Error(`unexpanded template syntax remains in ${label}`);
    }
}
function writeGeneratedFile(filePath, content, executable = false) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    if (executable && !IS_WINDOWS) {
        fs.chmodSync(filePath, 0o755);
    }
    verbose(`write ${filePath}`);
}
function starterConfigRootPath() {
    return path.resolve(__dirname, '..', 'examples', 'basic-config', 'agent-config');
}
function copySkeletonTree(sourceDir, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetName = entry.name === 'gitignore' ? '.gitignore' : entry.name;
        const targetPath = path.join(targetDir, targetName);
        if (entry.isDirectory()) {
            copySkeletonTree(sourcePath, targetPath);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        if (fs.existsSync(targetPath)) {
            continue;
        }
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
    }
}
function renderProfile(projectRoot, agentDir, checkOnly = false, targetTool = null, trace) {
    const configRoot = defaultConfigRoot(projectRoot);
    const profile = resolveProfile(projectRoot);
    const env = createNunjucksEnv(configRoot);
    const manifest = normalizeManifest(loadManifest(configRoot, agentDir, profile, trace), profile);
    if (manifest.profile !== profile) {
        const parsed = parseProfile(manifest.profile, `${path.join(agentDir, MANIFEST_FILE_NAME)} profile`);
        if (parsed.profile === null) {
            throw new Error(parsed.reason);
        }
    }
    if (!checkOnly) {
        ensureConfigRootGitignore(configRoot);
    }
    const context = buildRenderContext(projectRoot, agentDir, configRoot, manifest, env);
    const sections = [renderTemplateFile(env, configRoot, manifest.agent.base, context, trace)];
    for (const include of manifest.agent.includes) {
        const includePath = resolveConfigPath(configRoot, include, context);
        if (!fs.existsSync(includePath)) {
            if (include.includes('AGENTS-MODS.md') || include.includes(LOCAL_TEMPLATE_FILE_NAME)) {
                continue;
            }
            throw new Error(`missing template: ${includePath}`);
        }
        sections.push(renderTemplateFile(env, configRoot, include, context, trace));
    }
    context.renderedAgentSections = sections.map((section, index) => {
        const label = index === 0 ? manifest.agent.base : manifest.agent.includes[index - 1] ?? `section ${index}`;
        assertNoUnexpandedTemplateVars(label, section);
        return section.trimEnd();
    });
    context.skills = renderSkills(env, configRoot, manifest, context, trace);
    const files = [];
    if (targetTool === null || targetTool === 'codex') {
        const agentsContent = renderToolInstructions('AGENTS.md', env, configRoot, context, false, trace);
        files.push({ path: path.join(context.paths.liveDir, 'AGENTS.md'), content: agentsContent });
        files.push({ path: path.join(context.paths.liveDir, 'config.toml'), content: renderCodexConfig(env, configRoot, context, trace) });
        files.push(...renderNativeSkillFiles(context, 'codex'));
    }
    if (targetTool === null || targetTool === 'claude') {
        const claudeContent = renderToolInstructions('CLAUDE.md', env, configRoot, context, true, trace);
        files.push({ path: path.join(context.paths.liveDir, 'CLAUDE.md'), content: claudeContent });
        files.push({ path: path.join(context.paths.liveDir, '.claude', 'CLAUDE.md'), content: claudeContent });
        files.push({
            path: path.join(context.paths.liveDir, '.claude', 'agent-run-settings.json'),
            content: renderClaudeSettings(env, configRoot, context, trace)
        });
        files.push(...renderNativeSkillFiles(context, 'claude'));
    }
    files.push(...renderGuardShims(context));
    return {
        agentDir,
        configRoot,
        profile,
        context,
        files,
        skills: context.skills
    };
}
function syncAgentProfile(projectRoot, agentDir) {
    const rendered = renderProfile(projectRoot, agentDir, false);
    syncRuntimeDirs(rendered.context);
    for (const file of rendered.files) {
        writeGeneratedFile(file.path, file.content, file.executable ?? false);
    }
    removeLegacyGeneratedClaudeSettings(rendered.context);
    return rendered;
}
function removeLegacyGeneratedClaudeSettings(context) {
    for (const legacyPath of [
        path.join(context.paths.liveDir, '.claude', 'settings.json'),
        path.join(context.profileDir, '.claude', 'settings.json')
    ]) {
        if (!fs.existsSync(legacyPath)) {
            continue;
        }
        const actual = fs.readFileSync(legacyPath, 'utf8').replace(/\r\n/g, '\n');
        const legacyGeneratedContents = [
            legacyDefaultClaudeSettingsContent(context, context.agentDir),
            legacyDefaultClaudeSettingsContent(context, context.profileDir)
        ];
        if (legacyGeneratedContents.includes(actual)) {
            fs.rmSync(legacyPath);
            verbose(`removed legacy generated Claude settings ${legacyPath}`);
        }
    }
}
function checkRenderedProfile(projectRoot, agentDir) {
    const findings = [];
    const configRoot = defaultConfigRoot(projectRoot);
    try {
        const rendered = renderProfile(projectRoot, agentDir, true);
        for (const file of rendered.files) {
            if (!fs.existsSync(file.path)) {
                findings.push({ message: `missing generated file: ${file.path}`, severity: 'ERROR' });
                continue;
            }
            const actual = fs.readFileSync(file.path, 'utf8').replace(/\r\n/g, '\n');
            if (actual !== file.content) {
                findings.push({ message: `generated file is out of date: ${file.path}`, severity: 'ERROR' });
            }
        }
        for (const dir of [
            rendered.context.paths.reviewDir,
            rendered.context.paths.memoriesDir,
            rendered.context.paths.codexHomeDir,
            rendered.context.paths.liveDir,
            rendered.context.paths.overridesDir,
            rendered.context.paths.codexSkillsDir,
            rendered.context.paths.claudeSkillsDir,
            rendered.context.paths.binDir
        ]) {
            if (!fs.existsSync(dir)) {
                findings.push({ message: `missing generated runtime directory: ${dir}`, severity: 'ERROR' });
            }
        }
        for (const skill of rendered.skills) {
            validateRenderedSkill(skill.renderedContent, skill.sourcePath);
        }
    }
    catch (error) {
        findings.push({
            message: `failed to render profile ${agentDir}: ${formatError(error)}`,
            severity: 'ERROR'
        });
    }
    const gitignorePath = path.join(configRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        findings.push({ message: `missing config root .gitignore: ${gitignorePath}`, severity: 'ERROR' });
    }
    else {
        const gitignore = fs.readFileSync(gitignorePath, 'utf8');
        for (const entry of GENERATED_GITIGNORE_ENTRIES) {
            if (entry && entry.startsWith('#') === false && !gitignore.includes(entry)) {
                findings.push({ message: `config root .gitignore missing entry: ${entry}`, severity: 'ERROR' });
            }
        }
    }
    return findings;
}
function renderSkills(env, configRoot, manifest, context, trace) {
    const skills = [];
    for (const name of manifest.skills.install) {
        const sourceTemplate = manifest.skills.overrides[name] ?? `global/skills/${name}/SKILL.md.njk`;
        const sourcePath = resolveConfigPath(configRoot, sourceTemplate, context);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`missing skill template for ${name}: ${sourcePath}`);
        }
        const renderedContent = renderTemplateFile(env, configRoot, sourceTemplate, context, trace);
        assertNoUnexpandedTemplateVars(`skill ${name}`, renderedContent);
        validateRenderedSkill(renderedContent, sourcePath);
        const description = extractSkillDescription(renderedContent);
        skills.push({ name, sourcePath, renderedContent, description });
    }
    return skills;
}
function renderNativeSkillFiles(context, targetTool = null) {
    const files = [];
    for (const skill of context.skills) {
        if (targetTool === null || targetTool === 'codex') {
            files.push({
                path: path.join(context.paths.codexSkillsDir, skill.name, 'SKILL.md'),
                content: skill.renderedContent
            });
        }
        if (targetTool === null || targetTool === 'claude') {
            files.push({
                path: path.join(context.paths.claudeSkillsDir, skill.name, 'SKILL.md'),
                content: skill.renderedContent
            });
        }
    }
    return files;
}
function renderToolInstructions(templateName, env, configRoot, context, isClaude, trace) {
    const templatePath = `global/tool-templates/${templateName}.njk`;
    const absoluteTemplate = path.join(configRoot, templatePath);
    const content = fs.existsSync(absoluteTemplate)
        ? renderTemplateFile(env, configRoot, templatePath, context, trace)
        : renderInlineTemplate(env, defaultToolInstructionsTemplate(isClaude), context);
    assertNoUnexpandedTemplateVars(templateName, content);
    return content.replace(/\n*$/, '\n');
}
function renderCodexConfig(env, configRoot, context, trace) {
    const templatePath = resolveProfileOverrideTemplate(configRoot, context, 'codex-config.toml.njk', 'global/tool-templates/codex-config.toml.njk');
    const content = templatePath !== null
        ? renderTemplateFile(env, configRoot, templatePath, context, trace)
        : defaultCodexConfigContent(context);
    assertNoUnexpandedTemplateVars('config.toml', content);
    return content.replace(/\n*$/, '\n');
}
function renderClaudeSettings(env, configRoot, context, trace) {
    const templatePath = resolveProfileOverrideTemplate(configRoot, context, 'claude-settings.json.njk', 'global/tool-templates/claude-settings.json.njk');
    const content = templatePath !== null
        ? renderTemplateFile(env, configRoot, templatePath, context, trace)
        : defaultClaudeSettingsContent(context);
    assertNoUnexpandedTemplateVars('claude settings.json', content);
    return content.replace(/\n*$/, '\n');
}
function resolveProfileOverrideTemplate(configRoot, context, overrideFileName, globalTemplatePath) {
    const overridePath = `${context.profile}/overrides/${overrideFileName}`;
    if (fs.existsSync(path.join(configRoot, overridePath))) {
        return overridePath;
    }
    if (fs.existsSync(path.join(configRoot, globalTemplatePath))) {
        return globalTemplatePath;
    }
    return null;
}
function renderGuardShims(context) {
    if (IS_WINDOWS) {
        return ['git', 'npm', 'pnpm', 'gh'].map((name) => ({
            path: path.join(context.paths.binDir, `${name}.cmd`),
            content: windowsShim(name)
        }));
    }
    return [
        { path: path.join(context.paths.binDir, 'git'), content: posixGitShim(), executable: true },
        { path: path.join(context.paths.binDir, 'npm'), content: posixPublishShim('npm'), executable: true },
        { path: path.join(context.paths.binDir, 'pnpm'), content: posixPublishShim('pnpm'), executable: true },
        { path: path.join(context.paths.binDir, 'gh'), content: posixGhShim(), executable: true }
    ];
}
function syncRuntimeDirs(context) {
    for (const dir of [
        context.paths.reviewDir,
        context.paths.memoriesDir,
        context.paths.codexHomeDir,
        context.paths.overridesDir,
        context.paths.codexSkillsDir,
        context.paths.claudeSkillsDir,
        context.paths.binDir,
        path.join(context.paths.liveDir, '.claude')
    ]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
function validateRenderedSkill(content, sourcePath) {
    const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(content.replace(/\r\n/g, '\n'));
    if (frontMatter === null) {
        throw new Error(`generated skill missing YAML front matter: ${sourcePath}`);
    }
    const yaml = frontMatter[1] ?? '';
    if (!/^name:\s*\S+/m.test(yaml)) {
        throw new Error(`generated skill missing name: ${sourcePath}`);
    }
    if (!/^description:\s*(?:\S|>\s*$)/m.test(yaml)) {
        throw new Error(`generated skill missing description: ${sourcePath}`);
    }
}
function extractSkillDescription(content) {
    const normalized = content.replace(/\r\n/g, '\n');
    const simple = /^description:\s*['"]?(.+?)['"]?\s*$/m.exec(normalized);
    if (simple?.[1]) {
        return simple[1].trim();
    }
    const folded = /^description:\s*>\s*\n((?:[ \t]+.+\n?)+)/m.exec(normalized);
    if (folded?.[1]) {
        return folded[1]
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join(' ');
    }
    return '';
}
function renderLegacyAgentsMods(sourceFile, stack = [], trace) {
    const resolvedSource = path.resolve(sourceFile);
    trace?.sourceFiles.add(resolvedSource);
    if (stack.includes(resolvedSource)) {
        throw new Error(`Include cycle detected: ${[...stack, resolvedSource].join(' -> ')}`);
    }
    const lines = fs.readFileSync(resolvedSource, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const output = [];
    const nextStack = [...stack, resolvedSource];
    let sawLeadingInclude = false;
    let insertedOverrideNote = false;
    let contentStarted = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!contentStarted && trimmed === '') {
            continue;
        }
        if (trimmed.startsWith('@')) {
            const includePath = trimmed.slice(1).trim();
            if (!includePath) {
                continue;
            }
            const resolvedInclude = resolveIncludePath(resolvedSource, includePath);
            trace?.sourceFiles.add(resolvedInclude);
            output.push(renderLegacyAgentsMods(resolvedInclude, nextStack, trace));
            if (!contentStarted) {
                sawLeadingInclude = true;
            }
            continue;
        }
        if (sawLeadingInclude && !insertedOverrideNote) {
            output.push('');
            output.push('If anything below this point conflicts with anything included above,');
            output.push('the later instructions below take precedence.');
            output.push('');
            insertedOverrideNote = true;
        }
        output.push(line);
        contentStarted = true;
    }
    return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
function resolveIncludePath(sourceFile, includePath) {
    if (path.isAbsolute(includePath)) {
        return includePath;
    }
    const sourceRelativePath = path.resolve(path.dirname(sourceFile), includePath);
    if (fs.existsSync(sourceRelativePath)) {
        return sourceRelativePath;
    }
    const includeRoot = findIncludeRoot(sourceFile);
    return path.resolve(includeRoot, includePath.replace(/^(\.\.\/)+/, ''));
}
function findIncludeRoot(sourceFile) {
    let dir = path.dirname(sourceFile);
    for (;;) {
        if (fs.existsSync(path.join(dir, 'global')) || fs.existsSync(path.join(dir, 'templates'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return path.dirname(sourceFile);
        }
        dir = parent;
    }
}
function checkProject(projectRoot) {
    const findings = [];
    verbose(`checking project ${projectRoot}`);
    const profileResult = resolveProfileResult(projectRoot);
    const excludedDir = profileResult.profile === null ? null : resolveAgentDir(projectRoot);
    const localAiFiles = findLocalAiFiles(projectRoot, excludedDir);
    for (const file of localAiFiles) {
        findings.push({ message: `local AI file in project: ${file}`, severity: 'ERROR' });
    }
    if (profileResult.profile === null) {
        findings.push({ message: profileResult.reason, severity: 'ERROR' });
        return findings;
    }
    const agentDir = resolveAgentDir(projectRoot);
    findings.push(...checkAgentDirectory(projectRoot, agentDir));
    return findings;
}
function checkAgentDirectory(projectRoot, agentDir) {
    const findings = [];
    const configRoot = defaultConfigRoot(projectRoot);
    if (!fs.existsSync(path.join(agentDir, MANIFEST_FILE_NAME))) {
        const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
        const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
        if (!fs.existsSync(legacyPath) && !fs.existsSync(localPath)) {
            findings.push({ message: `missing manifest or legacy/local source file in ${agentDir}`, severity: 'ERROR' });
        }
    }
    for (const relativeTemplate of REQUIRED_GLOBAL_TEMPLATES) {
        if (!fs.existsSync(path.join(configRoot, relativeTemplate))) {
            findings.push({
                message: `missing required global template: ${path.join(configRoot, relativeTemplate)}`,
                severity: 'ERROR'
            });
        }
    }
    findings.push(...checkRenderedProfile(projectRoot, agentDir));
    return findings;
}
function checkSourceTree(rootPath) {
    const sourceRepos = findSourceRepos(rootPath);
    const entries = sourceRepos.map((projectRoot) => ({
        findings: checkProject(projectRoot),
        label: projectRoot
    }));
    return { entries, hasErrors: entries.some((entry) => hasErrors(entry.findings)), root: rootPath };
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
    return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
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
function runCodex(realBinary, permissionArgs, agentDir, configRoot, args, projectRoot, wrapperArgs) {
    const liveDir = profileLiveDir(agentDir);
    const agentsPath = path.join(liveDir, 'AGENTS.md');
    if (!fs.existsSync(agentsPath)) {
        failMissingConfig('codex', agentDir);
    }
    const guardBin = path.join(liveDir, 'bin');
    const codexHomeDir = path.join(liveDir, 'memories', 'codex-home');
    fs.mkdirSync(codexHomeDir, { recursive: true });
    const env = {
        ...process.env,
        CODEX_HOME: codexHomeDir,
        AGENT_DIR: liveDir,
        AGENT_PROFILE_DIR: agentDir,
        AGENT_RUN_PROJECT_ROOT: projectRoot,
        PATH: `${guardBin}${path.delimiter}${process.env.PATH ?? ''}`
    };
    const codexRuntimeArgs = buildCodexRuntimeArgs(wrapperArgs);
    execCommand(realBinary, [
        ...permissionArgs,
        ...codexRuntimeArgs,
        '--config',
        `system_prompt_file=${agentsPath}`,
        '--config',
        'project_doc_max_bytes=65536',
        ...globalMemoryArgs(configRoot),
        '-C',
        projectRoot,
        ...(wrapperArgs.codexSandboxMode === 'sandboxed' && wrapperArgs.codexNetwork
            ? ['--config', 'sandbox_workspace_write.network_access=true']
            : []),
        ...args
    ], shouldUseShell(realBinary), env, codexHomeDir, (code) => postflightProjectCheck(projectRoot, agentDir, wrapperArgs.local, code));
}
function buildCodexRuntimeArgs(wrapperArgs) {
    const mode = wrapperArgs.codexSandboxMode ?? 'danger';
    if (mode === 'sandboxed') {
        return ['-s', 'workspace-write'];
    }
    return ['-a', 'never', '-s', 'danger-full-access'];
}
function runClaude(realBinary, permissionArgs, agentDir, configRoot, args, projectRoot, wrapperArgs) {
    const liveDir = profileLiveDir(agentDir);
    const claudePath = path.join(liveDir, 'CLAUDE.md');
    if (!fs.existsSync(claudePath)) {
        failMissingConfig('claude', agentDir);
    }
    const guardBin = path.join(liveDir, 'bin');
    const claudeConfigDir = path.join(liveDir, '.claude');
    const env = {
        ...process.env,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        AGENT_DIR: liveDir,
        AGENT_PROFILE_DIR: agentDir,
        AGENT_RUN_PROJECT_ROOT: projectRoot,
        PATH: `${guardBin}${path.delimiter}${process.env.PATH ?? ''}`
    };
    execCommand(realBinary, [
        ...permissionArgs,
        '--settings',
        path.join(claudeConfigDir, 'agent-run-settings.json'),
        '--add-dir',
        projectRoot,
        '--add-dir',
        liveDir,
        ...globalMemoryArgs(configRoot),
        ...args
    ], shouldUseShell(realBinary), env, projectRoot, (code) => postflightProjectCheck(projectRoot, agentDir, wrapperArgs.local, code));
}
function profileLiveDir(agentDir) {
    return path.join(agentDir, LIVE_DIR_NAME);
}
function globalMemoryArgs(configRoot) {
    const memoryDir = globalMemoryDir(configRoot);
    return fs.existsSync(memoryDir) ? ['--add-dir', memoryDir] : [];
}
function globalMemoryDir(configRoot) {
    return path.join(configRoot, 'notes', 'memory');
}
function postflightProjectCheck(projectRoot, agentDir, allowLocal, code) {
    const localAiFiles = findLocalAiFiles(projectRoot, agentDir);
    if (localAiFiles.length > 0) {
        warnForLocalAiFiles(null, projectRoot, localAiFiles);
        if (!allowLocal) {
            return 1;
        }
    }
    return code;
}
function failMissingConfig(tool, agentDir) {
    process.stderr.write(`agent-run: no ${tool} config found for this project: ${agentDir}\n`);
    process.stderr.write(`agent-run: run \`agent-run ${tool} --none\` to bypass agent setup, or \`agent-run ${tool} --create\` to create profile files.\n`);
    process.exit(1);
}
function getPermissionArgs(tool) {
    if (process.env.AGENT_WRAPPER_FORCE_PERMISSIVE !== '1') {
        return [];
    }
    if (tool === 'claude' && typeof process.getuid === 'function' && process.getuid() !== 0) {
        return ['--permission-mode', 'bypassPermissions'];
    }
    return [];
}
function resolveAgentDir(projectRoot) {
    const profile = resolveProfile(projectRoot);
    const configRoot = defaultConfigRoot(projectRoot);
    const agentDir = path.join(configRoot, profile);
    verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
    return agentDir;
}
function findLocalAiFiles(projectRoot, excludedDir = null) {
    const matches = [];
    if (isIgnoredDir(projectRoot)) {
        return matches;
    }
    const resolvedExcludedDir = excludedDir ? path.resolve(excludedDir) : null;
    walk(projectRoot, (fullPath, entry) => {
        if (resolvedExcludedDir !== null && isSamePathOrDescendant(fullPath, resolvedExcludedDir)) {
            return entry.isDirectory() ? 'skip' : undefined;
        }
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
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
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
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (shouldPruneProjectEntry(entry)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        const result = visitor(fullPath, entry);
        if (entry.isDirectory() && result !== 'skip') {
            walk(fullPath, visitor);
        }
    }
}
function isSamePathOrDescendant(candidatePath, parentPath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
function shouldPruneProjectEntry(entry) {
    return (entry.isDirectory() &&
        (entry.name === '.git' ||
            entry.name === '.claude' ||
            entry.name === 'node_modules' ||
            entry.name === '.pnpm-store' ||
            entry.name === 'dist' ||
            entry.name === 'build'));
}
function isLocalAiDirectory(entry) {
    return entry.isDirectory() && (entry.name === '.claude' || entry.name === '.codex' || entry.name === '.agents');
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
    const resolvedRoot = workspaceRoot || nearestPackageRoot || gitRoot || path.resolve(cwd);
    verbose(`findProjectRoot cwd=${path.resolve(cwd)} workspaceRoot=${workspaceRoot || '-'} nearestPackageRoot=${nearestPackageRoot || '-'} gitRoot=${gitRoot || '-'} resolved=${resolvedRoot}`);
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
        fail(result.reason);
    }
    return result.profile;
}
function resolveProfileResult(projectRoot) {
    const env = readAgentRunEnv(projectRoot);
    const envProfile = env.AGENT_RUN_PROFILE?.trim();
    if (envProfile) {
        verbose(`using ${ENV_FILE_NAME} AGENT_RUN_PROFILE=${envProfile}`);
        return parseProfile(envProfile, `${ENV_FILE_NAME} AGENT_RUN_PROFILE`);
    }
    const githubProfile = resolveGitHubProfile(projectRoot);
    if (githubProfile !== null) {
        verbose(`using GitHub origin profile=${githubProfile}`);
        return parseProfile(githubProfile, 'GitHub remote origin');
    }
    const packagePath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(packagePath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            if (typeof pkg.name === 'string' && pkg.name.length > 0) {
                verbose(`using package.json name=${pkg.name}`);
                return parseProfile(pkg.name.startsWith('@') ? pkg.name.slice(1) : pkg.name, `${packagePath} name`);
            }
        }
        catch {
            return { profile: null, reason: `cannot parse package.json: ${packagePath}` };
        }
    }
    return {
        profile: null,
        reason: `cannot resolve agent profile for ${projectRoot}; add ${ENV_FILE_NAME} with AGENT_RUN_PROFILE=<org/project>, add a GitHub origin remote, or set package.json.name`
    };
}
function resolveGitHubProfile(projectRoot) {
    const remote = readGitOrigin(projectRoot);
    return remote === null ? null : parseGitHubRemoteProfile(remote);
}
function readGitOrigin(projectRoot) {
    const configPath = path.join(projectRoot, '.git', 'config');
    if (!fs.existsSync(configPath)) {
        return null;
    }
    const lines = fs.readFileSync(configPath, 'utf8').replace(/\r\n/g, '\n').split('\n');
    let inOrigin = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
            inOrigin = trimmed === '[remote "origin"]';
            continue;
        }
        if (inOrigin && trimmed.startsWith('url')) {
            const equalsIndex = trimmed.indexOf('=');
            if (equalsIndex >= 0) {
                return trimmed.slice(equalsIndex + 1).trim();
            }
        }
    }
    return null;
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
    if (normalized.startsWith('/') || normalized.startsWith('\\\\') || /^[A-Za-z]:\//.test(normalized)) {
        return { profile: null, reason: `${source} must be relative to the config root, not an absolute path` };
    }
    const segments = normalized.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
        return { profile: null, reason: `${source} must be a clean relative path like org/my-project` };
    }
    return { profile: segments.join('/'), reason: '' };
}
function readAgentRunEnv(dir) {
    const resolvedDir = path.resolve(dir);
    const cached = agentRunEnvCache.get(resolvedDir);
    if (cached) {
        return cached;
    }
    const filePath = path.join(resolvedDir, ENV_FILE_NAME);
    if (!fs.existsSync(filePath)) {
        const emptyEnv = {};
        agentRunEnvCache.set(resolvedDir, emptyEnv);
        return emptyEnv;
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
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    agentRunEnvCache.set(resolvedDir, env);
    return env;
}
function parseBooleanEnv(value) {
    if (value === undefined) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
function defaultConfigRoot(projectRoot) {
    const overrideRoot = process.env[CONFIG_ROOT_OVERRIDE_ENV];
    if (overrideRoot) {
        return path.resolve(overrideRoot);
    }
    if (process.env[CONFIG_DIR_ENV]) {
        return path.resolve(process.env[CONFIG_DIR_ENV]);
    }
    if (process.env.AGENT_CONFIG_ROOT) {
        return path.resolve(process.env.AGENT_CONFIG_ROOT);
    }
    if (projectRoot) {
        const env = readAgentRunEnv(projectRoot);
        const localConfigDir = env[CONFIG_DIR_ENV]?.trim();
        if (localConfigDir) {
            return path.resolve(projectRoot, localConfigDir);
        }
        const localConfigRoot = env.AGENT_CONFIG_ROOT?.trim();
        if (localConfigRoot) {
            return path.resolve(projectRoot, localConfigRoot);
        }
    }
    return path.join(os.homedir(), '.agent-config');
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
            if (!fs.existsSync(candidate) || !isExecutable(candidate)) {
                continue;
            }
            let resolvedCandidate = candidate;
            try {
                resolvedCandidate = fs.realpathSync(candidate);
            }
            catch {
                resolvedCandidate = candidate;
            }
            if (resolvedCandidate === currentScript || wrapperCandidates.has(resolvedCandidate)) {
                continue;
            }
            if (isAgentRunRedirectShim(candidate)) {
                verbose(`skip ${tool} redirect shim: ${candidate}`);
                continue;
            }
            return candidate;
        }
    }
    fail(`no ${tool} binary found in PATH`);
}
function isAgentRunRedirectShim(filePath) {
    try {
        const handle = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.alloc(4096);
            const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
            const content = buffer.subarray(0, bytesRead).toString('utf8');
            return content.includes('Run agent-run instead');
        }
        finally {
            fs.closeSync(handle);
        }
    }
    catch {
        return false;
    }
}
function getExecutableExtensions(tool) {
    if (!IS_WINDOWS || path.extname(tool)) {
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
    verbose(`exec tool: ${formatCommand(command, args)} shell=${String(shouldUseShell(command))}`);
    execCommand(command, args, shouldUseShell(command));
}
function execCommand(command, args, shell, env, cwd, onExit) {
    verbose(`spawn: ${formatCommand(command, args)} shell=${String(shell)} cwd=${cwd ?? process.cwd()}`);
    const child = childProcess.spawn(command, args, { cwd, env, shell, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        const originalCode = code === null ? 1 : code;
        process.exit(onExit ? onExit(originalCode) : originalCode);
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
    return (termProgram === 'vscode' ||
        Boolean(process.env.VSCODE_GIT_IPC_HANDLE) ||
        Boolean(process.env.VSCODE_IPC_HOOK) ||
        Boolean(process.env.VSCODE_IPC_HOOK_CLI));
}
function findFallbackEditor() {
    const candidates = IS_WINDOWS ? ['notepad.exe'] : ['joe', 'sensible-editor', 'editor', 'nano', 'nvim', 'vim', 'vi'];
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
    const extensions = getExecutableExtensions(command);
    for (const dir of pathDirs) {
        for (const extension of extensions) {
            const candidate = path.join(dir, `${command}${extension}`);
            if (fs.existsSync(candidate) && isExecutable(candidate)) {
                return candidate;
            }
        }
    }
    return null;
}
function shouldUseShell(command) {
    if (!IS_WINDOWS) {
        return false;
    }
    const extension = path.extname(command).toLowerCase();
    return extension === '.cmd' || extension === '.bat';
}
function localDateString() {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function stringifyDefaultManifest(profile) {
    const manifest = defaultManifest(profile);
    return `${JSON.stringify(manifest, null, 2)}\n`;
}
function defaultLocalTemplate(_profile) {
    return [
        '# {{ profile }} local agent instructions',
        '',
        'Project root:',
        '',
        '```text',
        '{{ projectRoot }}',
        '```',
        '',
        'Agent directory:',
        '',
        '```text',
        '{{ agentDir }}',
        '```',
        '',
        'Profile source directory:',
        '',
        '```text',
        '{{ profileDir }}',
        '```',
        '',
        'Add project-specific rules here.',
        ''
    ].join('\n');
}
function defaultCodeAgentTemplate() {
    return [
        '# Code Agent',
        '',
        'Work in the project root shown by agent-run. Keep changes scoped to the user request.',
        '',
        '{% include "global/snippets/git-rules.md.njk" %}',
        '',
        '{% include "global/snippets/no-ai-files.md.njk" %}',
        '',
        '{% include "global/snippets/verification.md.njk" %}',
        ''
    ].join('\n');
}
function defaultWritingAgentTemplate() {
    return [
        '# Writing Agent',
        '',
        'Write clearly and preserve the existing voice, structure, and facts in the project.',
        '',
        '{% include "global/snippets/no-ai-files.md.njk" %}',
        ''
    ].join('\n');
}
function defaultGitRulesSnippet() {
    return [
        '## Git Rules',
        '',
        'Do not commit unless the user explicitly asks. Before committing, show changed files and the exact commit message.',
        'Use human commit messages unless the user asks for conventional commits. Do not push unless explicitly asked.',
        ''
    ].join('\n');
}
function defaultNoAiFilesSnippet() {
    return [
        '## Agent File Storage',
        '',
        'Do not create AGENTS.md, CLAUDE.md, .agents, .claude, .codex, or other agent runtime files inside the project repository.',
        'Generated agent-only files belong under {{ paths.liveDir }}.',
        'Source config files belong under {{ profileDir }}.',
        ''
    ].join('\n');
}
function defaultVerificationSnippet() {
    return [
        '## Verification',
        '',
        'Run relevant checks before reporting completion. Configured checks:',
        '',
        '{% for check in checks %}',
        '- `{{ check }}`',
        '{% endfor %}',
        ''
    ].join('\n');
}
function defaultCommitWorkflowSkill() {
    return [
        '---',
        'name: commit-workflow',
        'description: Use for preparing or creating commits with explicit user approval.',
        '---',
        '',
        '# Commit Workflow',
        '',
        'Never commit unless explicitly asked. Before committing, show changed files and the exact commit message.',
        'Use human commit messages unless conventional commits are explicitly requested. Do not push.',
        'Run configured checks before committing:',
        '',
        '{% for check in checks %}',
        '- `{{ check }}`',
        '{% endfor %}',
        ''
    ].join('\n');
}
function defaultGithubReleaseSkill() {
    return [
        '---',
        'name: github-release',
        'description: Use for releases, version bumps, tags, publishing, GitHub Releases, and CHANGES updates.',
        '---',
        '',
        '# GitHub Release',
        '',
        'Use {{ paths.changesFile }} for change notes.',
        'Require confirmation before writing CHANGES, bumping versions, committing, tagging, pushing, publishing, or creating a GitHub Release.',
        'Follow `$commit-workflow` for release commits.',
        ''
    ].join('\n');
}
function defaultCodeReviewSkill() {
    return [
        '---',
        'name: code-review',
        'description: Use for code review, PR review, and diff review.',
        '---',
        '',
        '# Code Review',
        '',
        'Save review notes to {{ paths.reviewFile }}. If the file exists, update it.',
        'Also include findings in the final user-facing reply.',
        'Do not save review files inside the project repo.',
        ''
    ].join('\n');
}
function defaultToolInstructionsTemplate(isClaude) {
    return [
        `# Generated ${isClaude ? 'Claude' : 'agent'} instructions for {{ profile }}`,
        '',
        'Do not edit this file directly. Edit:',
        '',
        '```text',
        '{{ profileDir }}/agent-run.jsonc',
        '{{ profileDir }}/local.md.njk',
        '```',
        '',
        '{% for section in renderedAgentSections %}',
        '{{ section }}',
        '',
        '{% endfor %}',
        '## Absolute Paths',
        '',
        'Project root:',
        '',
        '```text',
        '{{ projectRoot }}',
        '```',
        '',
        'Agent directory:',
        '',
        '```text',
        '{{ agentDir }}',
        '```',
        '',
        'Profile source directory:',
        '',
        '```text',
        '{{ profileDir }}',
        '```',
        '',
        'Review directory:',
        '',
        '```text',
        '{{ paths.reviewDir }}',
        '```',
        '',
        "Today's review file:",
        '',
        '```text',
        '{{ paths.reviewFile }}',
        '```',
        '',
        'Memories directory:',
        '',
        '```text',
        '{{ paths.memoriesDir }}',
        '```',
        '',
        'Global memory directory:',
        '',
        '```text',
        '{{ paths.globalMemoryDir }}',
        '```',
        '',
        'Changes file:',
        '',
        '```text',
        '{{ paths.changesFile }}',
        '```',
        '',
        '## Available Skills',
        '',
        '{% for skill in skills %}',
        '- `${{ skill.name }}`{% if skill.description %}: {{ skill.description }}{% endif %}',
        '{% endfor %}',
        '',
        '## Tool Note',
        '',
        isClaude
            ? 'Claude uses the generated config directory under {{ paths.liveDir }}/.claude and may read {{ paths.liveDir }} via `--add-dir`.'
            : 'Codex uses {{ agentDir }}/AGENTS.md as `system_prompt_file` and {{ paths.codexHomeDir }} as CODEX_HOME.',
        '',
        '## Mandatory Path Rule',
        '',
        'Do not create AGENTS.md, CLAUDE.md, .agents, .claude, .codex, or AI-related files inside the project repository.',
        'Generated agent-only files must be stored under the agent directory shown above.',
        'Source config files must be stored under the profile source directory shown above.',
        ''
    ].join('\n');
}
function defaultCodexConfigTemplate() {
    return [
        '# Generated by agent-run. Do not edit directly.',
        '',
        'project_doc_max_bytes = 65536',
        'sandbox_mode = "workspace-write"',
        '',
        '[sandbox_workspace_write]',
        'writable_roots = [',
        '  "{{ projectRoot }}",',
        '  "{{ agentDir }}",',
        '  "{{ profileDir }}",',
        '  "{{ paths.globalMemoryDir }}"',
        ']',
        'network_access = false',
        ''
    ].join('\n');
}
function defaultClaudeSettingsTemplate() {
    const envBlock = [
        '  "env": {',
        '    "AGENT_DIR": "{{ agentDir }}",',
        '    "AGENT_PROFILE_DIR": "{{ profileDir }}",',
        '    "AGENT_RUN_PROJECT_ROOT": "{{ projectRoot }}",',
        '    "AGENT_GLOBAL_MEMORY_DIR": "{{ paths.globalMemoryDir }}"',
        '  }'
    ].join('\n');
    return [
        '{% if permissionsAllow.length %}{',
        envBlock + ',',
        '  "permissions": {',
        '    "allow": [',
        '      "{{ permissionsAllow | join(\'",\\n      "\') }}"',
        '    ]',
        '  }',
        '}',
        '{% else %}{',
        envBlock,
        '}',
        '{% endif %}'
    ].join('\n');
}
function defaultCodexConfigContent(context) {
    return [
        '# Generated by agent-run. Do not edit directly.',
        '',
        'project_doc_max_bytes = 65536',
        'sandbox_mode = "workspace-write"',
        '',
        '[sandbox_workspace_write]',
        'writable_roots = [',
        `  ${jsonString(context.projectRoot)},`,
        `  ${jsonString(context.agentDir)},`,
        `  ${jsonString(context.profileDir)},`,
        `  ${jsonString(context.paths.globalMemoryDir)}`,
        ']',
        'network_access = false',
        ''
    ].join('\n');
}
function defaultClaudeSettingsContent(context) {
    const settings = {
        env: {
            AGENT_DIR: context.agentDir,
            AGENT_PROFILE_DIR: context.profileDir,
            AGENT_RUN_PROJECT_ROOT: context.projectRoot,
            AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir
        }
    };
    if (context.permissionsAllow.length > 0) {
        settings.permissions = { allow: context.permissionsAllow };
    }
    return `${JSON.stringify(settings, null, 2)}\n`;
}
function legacyDefaultClaudeSettingsContent(context, agentDir) {
    return `${JSON.stringify({
        env: {
            AGENT_DIR: agentDir,
            AGENT_RUN_PROJECT_ROOT: context.projectRoot,
            AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir
        }
    }, null, 2)}\n`;
}
function jsonString(value) {
    return JSON.stringify(value);
}
function posixGitShim() {
    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'case "${1:-}" in',
        '  commit|tag|push)',
        '    if [ "${AGENT_RUN_ALLOW_GIT_WRITE:-}" != "1" ]; then',
        '      echo "agent-run: blocked git $1. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation." >&2',
        '      exit 42',
        '    fi',
        '    ;;',
        'esac',
        'if command -v /usr/bin/git >/dev/null 2>&1; then',
        '  exec /usr/bin/git "$@"',
        'fi',
        'exec git "$@"',
        ''
    ].join('\n');
}
function posixPublishShim(tool) {
    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'if [ "${1:-}" = "publish" ] && [ "${AGENT_RUN_ALLOW_PUBLISH:-}" != "1" ]; then',
        `  echo "agent-run: blocked ${tool} publish. Review and run it manually, or set AGENT_RUN_ALLOW_PUBLISH=1 for this invocation." >&2`,
        '  exit 42',
        'fi',
        `if command -v /usr/bin/${tool} >/dev/null 2>&1; then`,
        `  exec /usr/bin/${tool} "$@"`,
        'fi',
        `exec ${tool} "$@"`,
        ''
    ].join('\n');
}
function posixGhShim() {
    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'if [ "${1:-}" = "release" ] && [ "${2:-}" = "create" ] && [ "${AGENT_RUN_ALLOW_GITHUB_RELEASE:-}" != "1" ]; then',
        '  echo "agent-run: blocked gh release create. Review and run it manually, or set AGENT_RUN_ALLOW_GITHUB_RELEASE=1 for this invocation." >&2',
        '  exit 42',
        'fi',
        'if command -v /usr/bin/gh >/dev/null 2>&1; then',
        '  exec /usr/bin/gh "$@"',
        'fi',
        'exec gh "$@"',
        ''
    ].join('\n');
}
function windowsShim(name) {
    const guard = name === 'git'
        ? [
            'if /I "%1"=="commit" goto block_git',
            'if /I "%1"=="tag" goto block_git',
            'if /I "%1"=="push" goto block_git',
            'goto run',
            ':block_git',
            'if "%AGENT_RUN_ALLOW_GIT_WRITE%"=="1" goto run',
            'echo agent-run: blocked git %1. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation. 1>&2',
            'exit /b 42'
        ]
        : name === 'gh'
            ? [
                'if /I not "%1"=="release" goto run',
                'if /I not "%2"=="create" goto run',
                'if "%AGENT_RUN_ALLOW_GITHUB_RELEASE%"=="1" goto run',
                'echo agent-run: blocked gh release create. Review and run it manually, or set AGENT_RUN_ALLOW_GITHUB_RELEASE=1 for this invocation. 1>&2',
                'exit /b 42'
            ]
            : [
                'if /I not "%1"=="publish" goto run',
                'if "%AGENT_RUN_ALLOW_PUBLISH%"=="1" goto run',
                `echo agent-run: blocked ${name} publish. Review and run it manually, or set AGENT_RUN_ALLOW_PUBLISH=1 for this invocation. 1>&2`,
                'exit /b 42'
            ];
    return ['@echo off', ...guard, ':run', `${name}.exe %*`, ''].join('\r\n');
}
function isVerbose() {
    return parseBooleanEnv(process.env[VERBOSE_ENV]);
}
function verbose(message) {
    if (isVerbose()) {
        process.stderr.write(`agent-run: ${message}\n`);
    }
}
function formatCommand(command, args) {
    return [command, ...args].map(quoteArg).join(' ');
}
function quoteArg(value) {
    if (value === '') {
        return '""';
    }
    if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
        return value;
    }
    return JSON.stringify(value);
}
function fail(message) {
    process.stderr.write(`agent-run: ${message}\n`);
    process.exit(1);
}
if (require.main === module) {
    main(path.basename(process.argv[1] ?? 'agent-run'), process.argv.slice(2));
}
