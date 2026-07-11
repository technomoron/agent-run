"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const fs = require("fs");
const path = require("path");
const checks_1 = require("./checks");
const cli_1 = require("./cli");
const config_tree_1 = require("./config-tree");
const constants_1 = require("./constants");
const manifest_1 = require("./manifest");
const process_1 = require("./process");
const project_1 = require("./project");
const renderer_1 = require("./renderer");
const tools_1 = require("./tools");
const utils_1 = require("./utils");
function main(invokedTool, argv) {
    dispatch((0, cli_1.parseInvocation)(invokedTool, argv));
}
function dispatch(command) {
    switch (command.command) {
        case 'check':
            runCheck(command);
            return;
        case 'init':
            runInit(command);
            return;
        case 'init-config':
            runInitConfig(command);
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
    const projectRoot = (0, project_1.findProjectRoot)(process.cwd());
    (0, utils_1.verbose)(`run ${command}: cwd=${process.cwd()} projectRoot=${projectRoot}`);
    validateRunModes(parsed, projectRoot);
    if (wrapperArgs.none || (0, project_1.isIgnoredDir)(projectRoot)) {
        (0, utils_1.verbose)(`wrapper bypassed for ${command}${wrapperArgs.none ? ' via --none' : ' because project is ignored'}`);
        (0, process_1.execTool)((0, process_1.findRealBinary)(command), [...(0, tools_1.getPermissionArgs)(command), ...args]);
        return;
    }
    const profileResult = (0, project_1.resolveProfileResult)(projectRoot);
    if (profileResult.profile === null) {
        (0, utils_1.fail)(profileResult.reason);
    }
    const profile = profileResult.profile;
    if (wrapperArgs.show) {
        const configRoot = (0, project_1.defaultConfigRoot)(projectRoot);
        const agentDir = path.join(configRoot, profile);
        (0, utils_1.verbose)(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
        requireProfile(command, agentDir);
        showToolProfile(command, projectRoot, agentDir);
        return;
    }
    if (wrapperArgs.create) {
        runInit({ command: 'init', targetPath: projectRoot });
    }
    const configRoot = (0, project_1.defaultConfigRoot)(projectRoot);
    const agentDir = path.join(configRoot, profile);
    (0, utils_1.verbose)(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
    prepareConfigRoot(configRoot);
    requireProfile(command, agentDir);
    const preview = (0, renderer_1.renderProfile)(projectRoot, agentDir, true, command);
    ensureToolEnabled(preview.context, command);
    if (wrapperArgs.generate) {
        printUpdateSummary((0, renderer_1.syncAgentProfile)(projectRoot, agentDir));
        return;
    }
    checkLocalAiFiles(command, projectRoot, agentDir, preview.context, wrapperArgs.local);
    const realBinary = (0, process_1.findRealBinary)(command);
    const permissionArgs = (0, tools_1.getPermissionArgs)(command);
    const rendered = (0, renderer_1.syncAgentProfile)(projectRoot, agentDir);
    if (command === 'codex') {
        (0, tools_1.runCodex)(realBinary, permissionArgs, rendered.context, args, wrapperArgs);
    }
    else {
        (0, tools_1.runClaude)(realBinary, permissionArgs, rendered.context, args, wrapperArgs);
    }
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
    process.stderr.write('agent-run: run `agent-run init` or use the tool with `--create`.\n');
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
function runInit(parsed) {
    const projectRoot = activeProject(parsed.targetPath, 'init');
    if (projectRoot === null) {
        return;
    }
    const agentDir = initializeProfileSource(projectRoot, true);
    printUpdateSummary((0, renderer_1.syncAgentProfile)(projectRoot, agentDir));
}
function runInitConfig(parsed) {
    const sourcePath = (0, config_tree_1.starterConfigRootPath)();
    if (!fs.existsSync(sourcePath)) {
        (0, utils_1.fail)(`starter config skeleton not found: ${sourcePath}`);
    }
    (0, config_tree_1.copySkeletonTree)(sourcePath, path.resolve(parsed.targetPath));
    process.stdout.write(`OK copied starter config to ${path.resolve(parsed.targetPath)}\n`);
}
function runEdit(parsed) {
    const projectRoot = activeProject(parsed.targetPath, 'edit');
    if (projectRoot === null) {
        return;
    }
    const agentDir = initializeProfileSource(projectRoot, false);
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
    const profileDirs = (0, config_tree_1.findLegacyProfileDirs)(configRoot);
    let createdManifestCount = 0;
    let createdLocalCount = 0;
    let movedRuntimeCount = 0;
    let movedReviewCount = 0;
    let movedMemoryCount = 0;
    for (const agentDir of profileDirs) {
        const localPath = path.join(agentDir, constants_1.LOCAL_TEMPLATE_FILE_NAME);
        if (!fs.existsSync(localPath)) {
            fs.writeFileSync(localPath, (0, config_tree_1.convertLegacyTemplateVars)(fs.readFileSync(path.join(agentDir, 'AGENTS-MODS.md'), 'utf8')), 'utf8');
            createdLocalCount += 1;
        }
        if (!fs.existsSync(path.join(agentDir, constants_1.MANIFEST_FILE_NAME))) {
            (0, manifest_1.createProfileMarker)(agentDir);
            createdManifestCount += 1;
        }
        movedRuntimeCount += (0, config_tree_1.migrateCodexRuntimeFiles)(agentDir);
        movedReviewCount += (0, config_tree_1.migrateLooseFiles)(agentDir, /^REVIEW(?:-.+)?\.md$/, 'reviews');
        movedMemoryCount += (0, config_tree_1.migrateLooseFiles)(agentDir, /^memory.*\.md$/i, 'memories');
    }
    process.stdout.write(`OK migrated ${configRoot}\n`);
    process.stdout.write(`Profiles converted: ${profileDirs.length}\n`);
    process.stdout.write(`Created local.md.njk: ${createdLocalCount}\n`);
    process.stdout.write(`Created agent-run.jsonc: ${createdManifestCount}\n`);
    process.stdout.write(`Moved Codex runtime entries: ${movedRuntimeCount}\n`);
    process.stdout.write(`Moved review files: ${movedReviewCount}\n`);
    process.stdout.write(`Moved memory files: ${movedMemoryCount}\n`);
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
