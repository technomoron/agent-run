"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const fs = require("fs");
const path = require("path");
const registry_1 = require("./agents/registry");
const checks_1 = require("./checks");
const cli_1 = require("./cli");
const config_tree_1 = require("./config-tree");
const constants_1 = require("./constants");
const manifest_1 = require("./manifest");
const process_1 = require("./process");
const project_1 = require("./project");
const renderer_1 = require("./renderer");
const spawn_agent_1 = require("./runtime/spawn-agent");
const utils_1 = require("./utils");
function main(invokedTool, argv) {
    dispatch((0, cli_1.parseInvocation)(invokedTool, argv));
}
function dispatch(command) {
    switch (command.command) {
        case 'check':
            runCheck(command);
            return;
        case 'status':
            runStatus(command);
            return;
        case 'init':
            runGenerate(command);
            return;
        case 'generate':
            runGenerate(command);
            return;
        case 'setup':
            runSetup(command);
            return;
        case 'edit':
            runEdit(command);
            return;
        case 'update':
            runUpdate(command);
            return;
        case 'migrate-config':
            runMigrateConfig(command);
            return;
        default:
            runTool(command);
    }
}
function runTool(parsed) {
    const { args, command, wrapperArgs } = parsed;
    const adapter = (0, registry_1.getAgentAdapter)(command);
    const projectRoot = (0, project_1.findProjectRoot)(process.cwd());
    (0, utils_1.verbose)(`run ${command}: cwd=${process.cwd()} projectRoot=${projectRoot}`);
    validateRunModes(parsed, projectRoot);
    if (wrapperArgs.none || (0, project_1.isIgnoredDir)(projectRoot)) {
        (0, utils_1.verbose)(`wrapper bypassed for ${command}${wrapperArgs.none ? ' via --none' : ' because project is ignored'}`);
        (0, spawn_agent_1.spawnAgent)({
            command: (0, process_1.findRealBinary)(command),
            args: [...adapter.bypassArgs(wrapperArgs), ...args],
            cwd: process.cwd(),
            env: { ...process.env }
        });
        return;
    }
    const profileResult = (0, project_1.resolveProfileResult)(projectRoot);
    if (profileResult.profile === null) {
        (0, utils_1.fail)(profileResult.reason);
    }
    const profile = profileResult.profile;
    const configRoot = (0, project_1.defaultConfigRoot)(projectRoot);
    const agentDir = path.join(configRoot, profile);
    if (wrapperArgs.show) {
        (0, utils_1.verbose)(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
        requireProfile(command, agentDir);
        showToolProfile(command, projectRoot, agentDir);
        return;
    }
    if (wrapperArgs.create) {
        runGenerate({ command: 'generate', targetPath: projectRoot });
    }
    (0, utils_1.verbose)(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
    prepareConfigRoot(configRoot);
    requireProfile(command, agentDir);
    migrateProfileOnStart(configRoot, agentDir, false);
    const preview = (0, renderer_1.renderProfile)(projectRoot, agentDir, true, command);
    ensureToolEnabled(preview.context, command);
    if (wrapperArgs.generate) {
        printUpdateSummary((0, renderer_1.syncAgentProfile)(projectRoot, agentDir));
        return;
    }
    checkLocalAiFiles(command, projectRoot, agentDir, preview.context, wrapperArgs.local);
    const realBinary = (0, process_1.findRealBinary)(command);
    const rendered = (0, renderer_1.syncAgentProfile)(projectRoot, agentDir);
    const runtime = rendered.runtimes[command];
    if (!runtime) {
        (0, utils_1.fail)(`no generated ${command} runtime found for profile ${rendered.profile}`);
    }
    (0, spawn_agent_1.spawnAgent)(adapter.spawn(runtime, { binary: realBinary, passthroughArgs: args, wrapperArgs }));
}
function runStatus(_parsed) {
    const adapters = (0, registry_1.listAgentAdapters)();
    const columns = adapters.map((adapter) => adapter.displayName);
    const capabilityRows = [
        ['Instructions', 'instructions'],
        ['Skills', 'skills'],
        ['MCP', 'mcp'],
        ['Hooks', 'hooks'],
        ['Subagents', 'subagents'],
        ['Headless', 'headless']
    ];
    const firstWidth = Math.max(...capabilityRows.map(([label]) => label.length));
    const widths = columns.map((label) => Math.max(label.length, 3));
    const header = `${''.padEnd(firstWidth)}  ${columns.map((label, index) => label.padStart(widths[index] ?? 3)).join('  ')}`;
    const rows = capabilityRows.map(([label, capability]) => `${label.padEnd(firstWidth)}  ${adapters.map((adapter, index) => (adapter.capabilities[capability] ? 'yes' : '-').padStart(widths[index] ?? 3)).join('  ')}`);
    process.stdout.write(['Native agent capabilities', '', header, ...rows, ''].join('\n'));
}
function validateRunModes(parsed, projectRoot) {
    const { command, wrapperArgs } = parsed;
    if (wrapperArgs.show && wrapperArgs.none) {
        (0, utils_1.fail)('--show cannot be combined with --none');
    }
    if (wrapperArgs.generate && wrapperArgs.none) {
        (0, utils_1.fail)('--generate cannot be combined with --none');
    }
    if (wrapperArgs.generate && wrapperArgs.show) {
        (0, utils_1.fail)('--generate cannot be combined with --show');
    }
    if ((wrapperArgs.show || wrapperArgs.generate) && (0, project_1.isIgnoredDir)(projectRoot)) {
        (0, utils_1.fail)(`cannot ${wrapperArgs.show ? 'show' : 'generate'} generated ${command} files for ignored project: ${projectRoot}`);
    }
}
function requireProfile(tool, agentDir) {
    if ((0, manifest_1.isProfileConfigured)(agentDir)) {
        return;
    }
    const label = tool ?? 'agent';
    process.stderr.write(`agent-run: no ${label} profile found for this project: ${agentDir}\n`);
    process.stderr.write('agent-run: run `agent-run generate` or use the tool with `--create`.\n');
    process.exit(1);
}
function checkLocalAiFiles(command, projectRoot, agentDir, context, allowLocal) {
    const files = (0, project_1.findLocalAiFiles)(projectRoot, agentDir);
    if (!context.guardrails.forbidRepoAiFiles || files.length === 0) {
        return;
    }
    if (!allowLocal) {
        (0, project_1.failForLocalAiFiles)(command, projectRoot, files);
    }
    (0, project_1.warnForLocalAiFiles)(command, projectRoot, files);
}
function showToolProfile(command, projectRoot, agentDir) {
    const trace = { sourceFiles: new Set() };
    const rendered = (0, renderer_1.renderProfile)(projectRoot, agentDir, true, command, trace);
    ensureToolEnabled(rendered.context, command);
    process.stdout.write([
        `Agent: ${command}`,
        `Profile: ${rendered.profile}`,
        `Project root: ${projectRoot}`,
        `Profile dir: ${agentDir}`,
        '',
        'Reads/includes:',
        ...(0, utils_1.formatPathList)((0, utils_1.uniqueSorted)([...trace.sourceFiles])),
        '',
        'Generates:',
        ...(0, utils_1.formatPathList)((0, utils_1.uniqueSorted)(rendered.files.map((file) => file.path))),
        ''
    ].join('\n'));
}
function ensureToolEnabled(context, command) {
    if (!context.tools[command]) {
        (0, utils_1.fail)(`${command} is disabled for agent-run profile ${context.profile}`);
    }
}
function runGenerate(parsed) {
    if (parsed.command === 'init') {
        process.stderr.write('agent-run: `init` is deprecated; use `agent-run generate [path]` instead.\n');
    }
    const projectRoot = activeProject(parsed.targetPath, 'generate');
    if (projectRoot === null) {
        return;
    }
    const agentDir = initializeProfileSource(projectRoot, true);
    migrateProfileOnStart((0, project_1.defaultConfigRoot)(projectRoot), agentDir, false);
    printUpdateSummary((0, renderer_1.syncAgentProfile)(projectRoot, agentDir));
}
function runSetup(parsed) {
    const projectRoot = (0, project_1.findProjectRoot)(process.cwd());
    const detectedProfile = (0, project_1.resolveProfile)(projectRoot);
    const profile = parsed.profile === null ? confirmProfile(detectedProfile) : requireValidProfile(parsed.profile);
    const configRoot = (0, project_1.defaultConfigRoot)(projectRoot);
    const sourcePath = (0, config_tree_1.starterConfigRootPath)();
    if (!fs.existsSync(sourcePath)) {
        (0, utils_1.fail)(`starter config skeleton not found: ${sourcePath}`);
    }
    (0, config_tree_1.copySkeletonTree)(sourcePath, configRoot, new Set(['starter']));
    (0, config_tree_1.ensurePortableSystemdFiles)(configRoot);
    const agentDir = path.join(configRoot, profile);
    migrateProfileOnStart(configRoot, agentDir, false);
    (0, config_tree_1.copySkeletonTree)(path.join(sourcePath, 'starter', 'basic-project'), agentDir);
    if (profile !== detectedProfile) {
        writeProjectProfileMapping(projectRoot, profile);
    }
    printUpdateSummary((0, renderer_1.syncAgentProfile)(projectRoot, agentDir, { configRoot, profile }));
    process.stdout.write(`OK installed default config tree at ${configRoot}\n`);
}
function requireValidProfile(value) {
    const parsed = (0, project_1.parseProfile)(value, 'setup profile');
    if (parsed.profile === null) {
        (0, utils_1.fail)(parsed.reason);
    }
    return parsed.profile;
}
function confirmProfile(detectedProfile) {
    process.stdout.write(`Detected profile: ${detectedProfile}\n`);
    const confirmation = promptLine('Is this correct? [Y/n] ').trim().toLowerCase();
    if (confirmation === '' || confirmation === 'y' || confirmation === 'yes') {
        return detectedProfile;
    }
    return requireValidProfile(promptLine('Profile (org/repo): '));
}
function promptLine(prompt, nonInteractiveMessage = 'setup requires a profile argument when input is not interactive') {
    if (!process.stdin.isTTY) {
        (0, utils_1.fail)(nonInteractiveMessage);
    }
    process.stdout.write(prompt);
    const bytes = [];
    const buffer = Buffer.alloc(1);
    while (fs.readSync(process.stdin.fd, buffer, 0, 1, null) === 1) {
        if (buffer[0] === 10) {
            break;
        }
        if (buffer[0] !== 13) {
            bytes.push(buffer[0] ?? 0);
        }
    }
    return Buffer.from(bytes).toString('utf8');
}
function writeProjectProfileMapping(projectRoot, profile) {
    const envPath = path.join(projectRoot, constants_1.ENV_FILE_NAME);
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n') : '';
    const lines = existing.length > 0 ? existing.replace(/\n+$/, '').split('\n') : [];
    const profileLine = `AGENT_RUN_PROFILE=${profile}`;
    const index = lines.findIndex((line) => /^\s*AGENT_RUN_PROFILE\s*=/.test(line));
    if (index >= 0) {
        lines[index] = profileLine;
    }
    else {
        lines.push(profileLine);
    }
    const content = `${lines.join('\n')}\n`;
    if (content !== existing) {
        fs.writeFileSync(envPath, content, 'utf8');
        (0, utils_1.verbose)(`write ${envPath}`);
    }
}
function runEdit(parsed) {
    const projectRoot = activeProject(parsed.targetPath, 'edit');
    if (projectRoot === null) {
        return;
    }
    const agentDir = initializeProfileSource(projectRoot, false);
    migrateProfileOnStart((0, project_1.defaultConfigRoot)(projectRoot), agentDir, false);
    const editPath = (0, manifest_1.createDefaultLocalFile)(agentDir);
    (0, renderer_1.syncAgentProfile)(projectRoot, agentDir);
    process.stdout.write(`Edit: ${editPath}\n`);
    (0, process_1.openEditor)(editPath);
}
function runUpdate(parsed) {
    if (parsed.all) {
        runUpdateAll(parsed.targetPath);
        return;
    }
    const projectRoot = (0, project_1.findProjectRoot)(parsed.targetPath);
    (0, utils_1.verbose)(`update target=${parsed.targetPath} projectRoot=${projectRoot}`);
    if ((0, project_1.isIgnoredDir)(projectRoot)) {
        process.stdout.write(`SKIP ignored ${projectRoot}\n`);
        return;
    }
    const configRoot = (0, project_1.defaultConfigRoot)(projectRoot);
    const agentDir = (0, project_1.resolveAgentDir)(projectRoot);
    prepareConfigRoot(configRoot);
    requireProfile(null, agentDir);
    migrateProfileOnStart(configRoot, agentDir, false);
    printUpdateSummary((0, renderer_1.syncAgentProfile)(projectRoot, agentDir));
}
function runUpdateAll(targetPath) {
    const configRoot = targetPath === path.resolve(process.cwd()) ? (0, project_1.defaultConfigRoot)() : path.resolve(targetPath);
    if (!fs.existsSync(configRoot)) {
        (0, utils_1.fail)(`missing config root: ${configRoot}`);
    }
    prepareConfigRoot(configRoot);
    const profileDirs = (0, config_tree_1.findProfileDirs)(configRoot);
    for (const agentDir of profileDirs) {
        migrateProfileOnStart(configRoot, agentDir, false);
        const profile = path.relative(configRoot, agentDir).replace(/\\/g, '/');
        const projectRoot = (0, project_1.projectRootForProfile)(profile, configRoot);
        (0, renderer_1.syncAgentProfile)(projectRoot, agentDir, { configRoot, profile });
        process.stdout.write(`OK ${profile}\n`);
    }
    process.stdout.write(`Updated profiles: ${profileDirs.length}\n`);
}
function runMigrateConfig(parsed) {
    const configRoot = parsed.configRoot;
    if (!fs.existsSync(configRoot)) {
        (0, utils_1.fail)(`missing config root: ${configRoot}`);
    }
    (0, config_tree_1.ensureConfigRootLayout)(configRoot);
    (0, config_tree_1.ensureConfigRootGitignore)(configRoot);
    (0, config_tree_1.migrateOldTemplates)(configRoot);
    (0, config_tree_1.ensureDefaultGlobalTemplates)(configRoot);
    (0, manifest_1.ensureRootDefaultsFile)(configRoot);
    const profileDirs = (0, utils_1.uniqueSorted)([...(0, config_tree_1.findLegacyProfileDirs)(configRoot), ...(0, config_tree_1.findProfileDirs)(configRoot)]);
    let createdManifestCount = 0;
    let createdLocalCount = 0;
    let movedRuntimeCount = 0;
    let movedReviewCount = 0;
    let movedMemoryCount = 0;
    for (const agentDir of profileDirs) {
        const layout = migrateProfileOnStart(configRoot, agentDir, parsed.yes);
        const localPath = path.join(agentDir, constants_1.LOCAL_TEMPLATE_FILE_NAME);
        if (!fs.existsSync(localPath) && fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
            fs.writeFileSync(localPath, (0, config_tree_1.convertLegacyTemplateVars)(fs.readFileSync(path.join(agentDir, 'AGENTS-MODS.md'), 'utf8')), 'utf8');
            createdLocalCount += 1;
        }
        if (!fs.existsSync(path.join(agentDir, constants_1.MANIFEST_FILE_NAME))) {
            (0, manifest_1.createProfileMarker)(agentDir);
            createdManifestCount += 1;
        }
        movedRuntimeCount += (0, config_tree_1.migrateCodexRuntimeFiles)(agentDir);
        movedReviewCount += (0, config_tree_1.migrateLooseFiles)(agentDir, /^REVIEW(?:-.+)?\.md$/, 'reviews');
        movedMemoryCount += layout.projectMemoryMoves;
    }
    process.stdout.write(`OK migrated ${configRoot}\n`);
    process.stdout.write(`Profiles converted: ${profileDirs.length}\n`);
    process.stdout.write(`Created local.md.njk: ${createdLocalCount}\n`);
    process.stdout.write(`Created agent-run.jsonc: ${createdManifestCount}\n`);
    process.stdout.write(`Moved Codex runtime entries: ${movedRuntimeCount}\n`);
    process.stdout.write(`Moved review files: ${movedReviewCount}\n`);
    process.stdout.write(`Moved memory files: ${movedMemoryCount}\n`);
}
function migrateProfileOnStart(configRoot, profileDir, assumeYes) {
    const result = (0, config_tree_1.migrateProfileLayout)(configRoot, profileDir, ({ gitRoot, moves }) => {
        process.stdout.write('agent-run: this profile uses an older project-memory layout.\n');
        process.stdout.write(`Git working tree: ${gitRoot}\n`);
        for (const move of moves) {
            process.stdout.write(`  ${path.relative(gitRoot, move.source)} -> ${path.relative(gitRoot, move.target)}\n`);
        }
        if (assumeYes) {
            return true;
        }
        const migrateCommand = (0, utils_1.formatCommand)('agent-run', ['migrate-config', '--yes', configRoot]);
        const message = `tracked project-memory files need migration; rerun interactively or run \`${migrateCommand}\``;
        const answer = promptLine('Stage these moves with git mv? [Y/n] ', message).trim().toLowerCase();
        return answer === '' || answer === 'y' || answer === 'yes';
    });
    if (result.gitMoves > 0) {
        process.stdout.write(`Staged Git moves: ${result.gitMoves}\n`);
    }
    if (result.runtimeMoves > 0) {
        process.stdout.write(`Moved local Codex runtime entries: ${result.runtimeMoves}\n`);
    }
    return result;
}
function runCheck(parsed) {
    if (parsed.all) {
        const report = (0, checks_1.checkSourceTree)(parsed.targetPath);
        (0, checks_1.printBatchReport)(report.root, report.entries);
        process.exit(report.hasErrors ? 1 : 0);
    }
    const projectRoot = (0, project_1.findProjectRoot)(parsed.targetPath);
    if ((0, project_1.isIgnoredDir)(projectRoot)) {
        process.stdout.write(`Check: ${projectRoot}\nSKIP ignored by .agent-run-ignore\n`);
        process.exit(0);
    }
    const findings = (0, checks_1.checkProject)(projectRoot);
    (0, checks_1.printProjectReport)(projectRoot, findings);
    process.exit((0, checks_1.hasErrors)(findings) ? 1 : 0);
}
function prepareConfigRoot(configRoot) {
    (0, config_tree_1.ensureConfigRootLayout)(configRoot);
    (0, config_tree_1.ensureConfigRootGitignore)(configRoot);
    (0, config_tree_1.ensureDefaultGlobalTemplates)(configRoot);
    (0, config_tree_1.ensurePortableSystemdFiles)(configRoot);
}
function activeProject(targetPath, action) {
    const projectRoot = (0, project_1.findProjectRoot)(targetPath);
    (0, utils_1.verbose)(`${action} target=${targetPath} projectRoot=${projectRoot}`);
    if (!(0, project_1.isIgnoredDir)(projectRoot)) {
        return projectRoot;
    }
    process.stdout.write(`SKIP ignored ${projectRoot}\n`);
    return null;
}
function initializeProfileSource(projectRoot, preferProjectConfigRoot) {
    const profile = (0, project_1.resolveProfile)(projectRoot);
    const configRoot = (0, project_1.defaultConfigRoot)(projectRoot, { preferProjectRoot: preferProjectConfigRoot });
    const agentDir = path.join(configRoot, profile);
    prepareConfigRoot(configRoot);
    (0, manifest_1.ensureRootDefaultsFile)(configRoot);
    fs.mkdirSync(agentDir, { recursive: true });
    (0, manifest_1.convertLegacyProfileIfNeeded)(agentDir);
    (0, manifest_1.createProfileMarker)(agentDir);
    return agentDir;
}
function printUpdateSummary(rendered) {
    process.stdout.write(`OK profile ${rendered.profile}\n`);
    process.stdout.write(`Profile dir: ${rendered.agentDir}\n`);
    process.stdout.write(`Live dir: ${rendered.context.paths.liveDir}\n`);
    process.stdout.write(`Generated files: ${rendered.files.length}\n`);
    process.stdout.write(`Installed skills: ${rendered.skills.map((skill) => skill.name).join(', ') || '(none)'}\n`);
}
