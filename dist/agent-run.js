#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAgentsMods = renderAgentsMods;
exports.syncGeneratedAgentsFile = syncGeneratedAgentsFile;
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
const IS_WINDOWS = process.platform === 'win32';
const ENV_FILE_NAME = '.agent-run.env';
const IGNORE_FILE_NAME = '.agent-run-ignore';
const LOCAL_AI_FILE_NAMES = new Set(['AGENTS.md', 'AGENTS-MODS.md', 'CLAUDE.md', 'codex.md']);
const CONFIG_ROOT_OVERRIDE_ENV = 'AGENT_RUN_CONFIG_ROOT_OVERRIDE';
const VERBOSE_ENV = 'AGENT_RUN_VERBOSE';
const agentRunEnvCache = new Map();
function renderAgentsMods(sourceFile, stack = []) {
    const resolvedSource = path.resolve(sourceFile);
    verbose(`render ${resolvedSource}`);
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
            verbose(`include ${includePath} -> ${resolvedInclude}`);
            output.push(renderAgentsMods(resolvedInclude, nextStack));
            if (!contentStarted) {
                sawLeadingInclude = true;
            }
            continue;
        }
        if (sawLeadingInclude && !insertedOverrideNote) {
            verbose(`insert override note in ${resolvedSource}`);
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
function syncGeneratedAgentsFile(agentDir) {
    const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
    const agentsPath = path.join(agentDir, 'AGENTS.md');
    verbose(`sync generated files from ${modsPath}`);
    const rendered = expandAgentsTemplateVariables(renderAgentsMods(modsPath), buildAgentsTemplateContext(agentDir));
    fs.writeFileSync(agentsPath, rendered, 'utf8');
    verbose(`write ${agentsPath}`);
    const claudePath = path.join(agentDir, 'CLAUDE.md');
    fs.writeFileSync(claudePath, '@AGENTS.md\n', 'utf8');
    verbose(`write ${claudePath}`);
}
function buildAgentsTemplateContext(agentDir) {
    const resolvedAgentDir = path.resolve(agentDir);
    const resolvedConfigRoot = path.resolve(defaultConfigRoot());
    const profile = path.relative(resolvedConfigRoot, resolvedAgentDir).replace(/\\/g, '/');
    return {
        agentDir: resolvedAgentDir,
        agentsModsPath: path.join(resolvedAgentDir, 'AGENTS-MODS.md'),
        agentsPath: path.join(resolvedAgentDir, 'AGENTS.md'),
        claudePath: path.join(resolvedAgentDir, 'CLAUDE.md'),
        configRoot: resolvedConfigRoot,
        profile
    };
}
function expandAgentsTemplateVariables(content, context) {
    const replacements = new Map([
        ['AGENT_DIR', context.agentDir],
        ['AGENTS_MODS_PATH', context.agentsModsPath],
        ['AGENTS_PATH', context.agentsPath],
        ['CLAUDE_PATH', context.claudePath],
        ['CONFIG_ROOT', context.configRoot],
        ['PROFILE', context.profile]
    ]);
    return content.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => replacements.get(key) ?? match);
}
function resolveIncludePath(sourceFile, includePath) {
    if (path.isAbsolute(includePath)) {
        verbose(`resolve include absolute ${includePath}`);
        return includePath;
    }
    const sourceRelativePath = path.resolve(path.dirname(sourceFile), includePath);
    if (fs.existsSync(sourceRelativePath)) {
        verbose(`resolve include relative ${includePath} -> ${sourceRelativePath}`);
        return sourceRelativePath;
    }
    const includeRoot = findIncludeRoot(sourceFile);
    const fallbackPath = path.resolve(includeRoot, includePath.replace(/^(\.\.\/)+/, ''));
    verbose(`resolve include root fallback ${includePath} -> ${fallbackPath}`);
    return fallbackPath;
}
function findIncludeRoot(sourceFile) {
    let dir = path.dirname(sourceFile);
    for (;;) {
        const templatesDir = path.join(dir, 'templates');
        if (fs.existsSync(templatesDir)) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return path.dirname(sourceFile);
        }
        dir = parent;
    }
}
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
    if (parsed.command === 'update') {
        runUpdate(parsed);
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
    if (command === null) {
        if (inputArgs.length === 0) {
            fail('usage: agent-run <codex|claude|check|init|edit|update> [options] (run with --help for details)');
        }
        const firstArg = inputArgs.shift();
        if (isHelpFlag(firstArg)) {
            printHelp('general');
        }
        command = normalizeCommandName(firstArg ?? '');
        if (command === null) {
            fail(`unknown command: ${firstArg ?? ''} (run with --help for usage)`);
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
    if (command === 'update') {
        return parseUpdateCommand(inputArgs);
    }
    return parseRunCommand(command, inputArgs);
}
function extractGlobalOptions(argv) {
    const args = [];
    let configRootOverride = null;
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
    return { args, configRootOverride, verbose };
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
    return {
        all,
        command: 'check',
        targetPath: path.resolve(targetPath)
    };
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
    return {
        command: 'init',
        targetPath: path.resolve(targetPath)
    };
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
    return {
        command: 'edit',
        targetPath: path.resolve(targetPath)
    };
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
    return {
        command: 'update',
        targetPath: path.resolve(targetPath)
    };
}
function isHelpFlag(value) {
    return value === '-h' || value === '--help';
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
                'Check the mapped agent files for the current repo or a source tree.',
                '',
                'Options:',
                '  -h, --help  Show this help text',
                '  --all       Check every repo under path',
                '',
                'Examples:',
                '  agent-run check',
                '  agent-run check --all ~/source',
                ''
            ].join('\n');
        case 'init':
            return [
                'Usage:',
                '  agent-run init [path]',
                '',
                'Create the mapped agent files for the repo at path.',
                '',
                'Options:',
                '  -h, --help  Show this help text',
                '',
                'Examples:',
                '  agent-run init',
                '  agent-run init ~/source/org/my-api',
                ''
            ].join('\n');
        case 'edit':
            return [
                'Usage:',
                '  agent-run edit [path]',
                '',
                'Create missing mapped files, sync generated output, and open AGENTS-MODS.md.',
                '',
                'Options:',
                '  -h, --help  Show this help text',
                '',
                'Examples:',
                '  agent-run edit',
                '  agent-run edit ~/source/org/my-api',
                ''
            ].join('\n');
        case 'update':
            return [
                'Usage:',
                '  agent-run update [path]',
                '',
                'Rebuild AGENTS.md and CLAUDE.md from AGENTS-MODS.md for the repo at path.',
                '',
                'Options:',
                '  -h, --help  Show this help text',
                '',
                'Examples:',
                '  agent-run update',
                '  agent-run update ~/source/org/my-api',
                ''
            ].join('\n');
        case 'general':
        default:
            return [
                'Usage:',
                '  agent-run <codex|claude|check|init|edit|update> [options]',
                '',
                'Commands:',
                '  codex [--none] [--create] [args...]   Run codex with mapped AGENTS.md',
                '  claude [--none] [--create] [args...]  Run claude with mapped AGENTS.md',
                '  check [--all] [path]                  Validate mapped files for a repo or tree',
                '  init [path]                           Create mapped files for a repo',
                '  edit [path]                           Open AGENTS-MODS.md for a repo',
                '  update [path]                         Regenerate AGENTS.md and CLAUDE.md',
                '',
                'Global options:',
                '  -h, --help         Show this help text',
                '  -v, --verbose      Print path resolution and wrapper actions',
                '  --config-root DIR  Override the agent-config root',
                '',
                'Wrapper options for codex and claude:',
                '  --none             Bypass agent setup and run the tool directly',
                '  --create           Create blank agent files before running the tool',
                '',
                'Notes:',
                '  agent-run check --help   Show help for a built-in command',
                '  agent-run codex --help   Pass --help through to codex',
                ''
            ].join('\n');
    }
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
    return null;
}
function runTool(parsed) {
    const { args, command, wrapperArgs } = parsed;
    const realBinary = findRealBinary(command);
    const permissionArgs = getPermissionArgs(command);
    const projectRoot = findProjectRoot(process.cwd());
    verbose(`run ${command}: cwd=${process.cwd()} projectRoot=${projectRoot}`);
    if (wrapperArgs.none || isIgnoredDir(projectRoot)) {
        verbose(`wrapper bypassed for ${command}${wrapperArgs.none ? ' via --none' : ' because project is ignored'}`);
        execTool(realBinary, [...permissionArgs, ...args]);
        return;
    }
    const profileResult = resolveProfileResult(projectRoot);
    const excludedDir = profileResult.profile === null ? null : resolveAgentDir(projectRoot);
    const localAiFiles = findLocalAiFiles(projectRoot, excludedDir);
    if (localAiFiles.length > 0) {
        failForLocalAiFiles(command, projectRoot, localAiFiles);
    }
    if (profileResult.profile === null) {
        fail(profileResult.reason);
    }
    const agentDir = resolveAgentDir(projectRoot);
    verbose(`resolved agent path: ${agentDir}`);
    if (wrapperArgs.create) {
        createBlankAgentFiles(agentDir);
        process.stderr.write(`agent-run: created blank agent files in ${agentDir}\n`);
    }
    if (fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
        syncGeneratedAgentsFile(agentDir);
    }
    if (command === 'codex') {
        runCodex(realBinary, permissionArgs, agentDir, args);
        return;
    }
    runClaude(realBinary, permissionArgs, agentDir, args);
}
function runInit(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    verbose(`init target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        return;
    }
    const agentDir = resolveAgentDir(projectRoot);
    createBlankAgentFiles(agentDir);
    if (fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
        syncGeneratedAgentsFile(agentDir);
    }
    process.stdout.write(`OK initialized ${agentDir}\n`);
}
function runEdit(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    verbose(`edit target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        process.exit(0);
    }
    const agentDir = resolveAgentDir(projectRoot);
    createBlankAgentFiles(agentDir);
    if (fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
        syncGeneratedAgentsFile(agentDir);
    }
    const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
    process.stdout.write(`Edit: ${modsPath}\n`);
    openEditor(modsPath);
}
function runUpdate(parsed) {
    const projectRoot = findProjectRoot(parsed.targetPath);
    verbose(`update target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if (isIgnoredDir(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        return;
    }
    const agentDir = resolveAgentDir(projectRoot);
    const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
    if (!fs.existsSync(modsPath)) {
        fail(`missing AGENTS-MODS.md: ${modsPath}`);
    }
    syncGeneratedAgentsFile(agentDir);
    process.stdout.write(`OK updated ${path.join(agentDir, 'AGENTS.md')}\n`);
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
function checkProject(projectRoot) {
    const findings = [];
    verbose(`checking project ${projectRoot}`);
    const profileResult = resolveProfileResult(projectRoot);
    const excludedDir = profileResult.profile === null ? null : resolveAgentDir(projectRoot);
    const localAiFiles = findLocalAiFiles(projectRoot, excludedDir);
    for (const file of localAiFiles) {
        findings.push({
            message: `local AI file in project: ${file}`,
            severity: 'ERROR'
        });
    }
    if (profileResult.profile === null) {
        findings.push({
            message: profileResult.reason,
            severity: 'ERROR'
        });
        return findings;
    }
    const agentDir = resolveAgentDir(projectRoot);
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
            const rendered = expandAgentsTemplateVariables(renderAgentsMods(modsPath), buildAgentsTemplateContext(agentDir));
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
    verbose(`ensure agent path exists: ${agentDir}`);
    const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
    const agentsPath = path.join(agentDir, 'AGENTS.md');
    const claudePath = path.join(agentDir, 'CLAUDE.md');
    if (!fs.existsSync(modsPath)) {
        fs.writeFileSync(modsPath, '\n', 'utf8');
        verbose(`created ${modsPath}`);
    }
    else {
        verbose(`exists ${modsPath}`);
    }
    if (!fs.existsSync(agentsPath)) {
        fs.writeFileSync(agentsPath, '\n', 'utf8');
        verbose(`created ${agentsPath}`);
    }
    else {
        verbose(`exists ${agentsPath}`);
    }
    if (!fs.existsSync(claudePath)) {
        fs.writeFileSync(claudePath, '@AGENTS.md\n', 'utf8');
        verbose(`created ${claudePath}`);
    }
    else {
        verbose(`exists ${claudePath}`);
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
    const configRoot = defaultConfigRoot(projectRoot);
    const agentDir = path.join(configRoot, profile);
    verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
    return agentDir;
}
function findLocalAiFiles(projectRoot, excludedDir = null) {
    const matches = [];
    const rootIgnored = isIgnoredDir(projectRoot);
    if (rootIgnored) {
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
function isSamePathOrDescendant(candidatePath, parentPath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
            return {
                profile: null,
                reason: `cannot parse package.json: ${packagePath}`
            };
        }
    }
    return {
        profile: null,
        reason: `cannot resolve agent profile for ${projectRoot}; add ${ENV_FILE_NAME} with AGENT_RUN_PROFILE=<org/project> or set package.json.name`
    };
}
function parseProfile(profile, source) {
    const normalized = profile.trim().replace(/\\/g, '/');
    if (!normalized) {
        return {
            profile: null,
            reason: `${source} must be a non-empty path relative to the config root`
        };
    }
    if (normalized.startsWith('/') || normalized.startsWith('\\\\') || /^[A-Za-z]:\//.test(normalized)) {
        return {
            profile: null,
            reason: `${source} must be relative to the config root, not an absolute path`
        };
    }
    const segments = normalized.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
        return {
            profile: null,
            reason: `${source} must be a clean relative path like org/my-project`
        };
    }
    return {
        profile: segments.join('/'),
        reason: ''
    };
}
function readAgentRunEnv(dir) {
    const resolvedDir = path.resolve(dir);
    const cached = agentRunEnvCache.get(resolvedDir);
    if (cached) {
        return cached;
    }
    const filePath = path.join(resolvedDir, ENV_FILE_NAME);
    if (!fs.existsSync(filePath)) {
        verbose(`no ${ENV_FILE_NAME} in ${resolvedDir}`);
        const emptyEnv = {};
        agentRunEnvCache.set(resolvedDir, emptyEnv);
        return emptyEnv;
    }
    verbose(`read ${filePath}`);
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
        const resolved = path.resolve(overrideRoot);
        verbose(`using --config-root override: ${resolved}`);
        return resolved;
    }
    if (process.env.AGENT_CONFIG_ROOT) {
        const resolved = path.resolve(process.env.AGENT_CONFIG_ROOT);
        verbose(`using AGENT_CONFIG_ROOT env: ${resolved}`);
        return resolved;
    }
    if (projectRoot) {
        const env = readAgentRunEnv(projectRoot);
        const localConfigRoot = env.AGENT_CONFIG_ROOT?.trim();
        if (localConfigRoot) {
            const resolved = path.resolve(projectRoot, localConfigRoot);
            verbose(`using ${ENV_FILE_NAME} AGENT_CONFIG_ROOT: ${resolved}`);
            return resolved;
        }
    }
    if (IS_WINDOWS) {
        const resolved = path.join(os.homedir(), 'Documents', 'source', 'agent-configs');
        verbose(`using default config root: ${resolved}`);
        return resolved;
    }
    const resolved = path.join(os.homedir(), 'source', 'agent-configs');
    verbose(`using default config root: ${resolved}`);
    return resolved;
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
    verbose(`exec tool: ${formatCommand(command, args)} shell=${String(shouldUseShell(command))}`);
    execCommand(command, args, shouldUseShell(command));
}
function execCommand(command, args, shell, env) {
    verbose(`spawn: ${formatCommand(command, args)} shell=${String(shell)}`);
    const child = childProcess.spawn(command, args, {
        env,
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
        verbose(`open editor via VISUAL=${visual} file=${filePath}`);
        execCommand(visual, [filePath], true);
        return;
    }
    const editor = process.env.EDITOR?.trim();
    if (editor) {
        verbose(`open editor via EDITOR=${editor} file=${filePath}`);
        execCommand(editor, [filePath], true);
        return;
    }
    const vscodeCommand = findVsCodeEditorCommand();
    if (vscodeCommand !== null) {
        verbose(`open editor via VS Code command=${vscodeCommand} file=${filePath}`);
        execCommand(vscodeCommand, ['--reuse-window', filePath], shouldUseShell(vscodeCommand));
        return;
    }
    const fallbackEditor = findFallbackEditor();
    if (fallbackEditor !== null) {
        verbose(`open editor via fallback command=${fallbackEditor} file=${filePath}`);
        execCommand(fallbackEditor, [filePath], shouldUseShell(fallbackEditor));
        return;
    }
    if (IS_WINDOWS) {
        verbose(`open editor via cmd.exe start file=${filePath}`);
        execCommand('cmd.exe', ['/c', 'start', '', filePath], false);
        return;
    }
    if (process.platform === 'darwin') {
        verbose(`open editor via open file=${filePath}`);
        execCommand('open', [filePath], false);
        return;
    }
    verbose(`open editor via xdg-open file=${filePath}`);
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
function isVerbose() {
    return parseBooleanEnv(process.env[VERBOSE_ENV]);
}
function verbose(message) {
    if (!isVerbose()) {
        return;
    }
    process.stderr.write(`agent-run: ${message}\n`);
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
