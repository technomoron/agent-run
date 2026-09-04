"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCodex = runCodex;
exports.runClaude = runClaude;
exports.getDangerArgs = getDangerArgs;
exports.getPermissionArgs = getPermissionArgs;
const fs = require("fs");
const path = require("path");
const process_1 = require("./process");
const project_1 = require("./project");
function runCodex(realBinary, permissionArgs, context, args, wrapperArgs) {
    const liveDir = context.paths.liveDir;
    const codexHomeDir = context.paths.codexHomeDir;
    const projectRoot = context.projectRoot;
    if (!fs.existsSync(path.join(codexHomeDir, 'AGENTS.md'))) {
        failMissingConfig('codex', context.profileDir);
    }
    const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
    fs.mkdirSync(codexHomeDir, { recursive: true });
    const env = {
        ...process.env,
        CODEX_HOME: codexHomeDir,
        AGENT_DIR: liveDir,
        AGENT_PROFILE_DIR: context.profileDir,
        AGENT_RUN_PROJECT_ROOT: projectRoot,
        AGENT_PROJECT_MEMORY_DIR: context.paths.projectMemoryDir,
        AGENT_RUN_REAL_PATH: realPath,
        PATH: `${path.join(liveDir, 'bin')}${path.delimiter}${realPath}`
    };
    const runtimeArgs = wrapperArgs.sandboxMode === 'danger' ? getDangerArgs('codex') : ['-a', 'on-request', '-s', 'workspace-write'];
    (0, process_1.execCommand)(realBinary, [
        ...permissionArgs,
        ...runtimeArgs,
        '--add-dir',
        context.paths.projectMemoryDir,
        '-C',
        projectRoot,
        ...(wrapperArgs.sandboxMode !== 'danger' && wrapperArgs.codexNetwork
            ? ['--config', 'sandbox_workspace_write.network_access=true']
            : []),
        ...args
    ], env, codexHomeDir, (code) => postflightProjectCheck(context, wrapperArgs.local, code));
}
function runClaude(realBinary, permissionArgs, context, args, wrapperArgs) {
    const liveDir = context.paths.liveDir;
    const claudePath = path.join(liveDir, 'CLAUDE.md');
    if (!fs.existsSync(claudePath)) {
        failMissingConfig('claude', context.profileDir);
    }
    const claudeConfigDir = path.join(liveDir, '.claude');
    const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
    const env = {
        ...process.env,
        AGENT_DIR: liveDir,
        AGENT_PROFILE_DIR: context.profileDir,
        AGENT_RUN_PROJECT_ROOT: context.projectRoot,
        AGENT_PROJECT_MEMORY_DIR: context.paths.projectMemoryDir,
        AGENT_RUN_REAL_PATH: realPath,
        PATH: `${path.join(liveDir, 'bin')}${path.delimiter}${realPath}`
    };
    const runtimeArgs = wrapperArgs.sandboxMode === 'danger' ? getDangerArgs('claude') : permissionArgs;
    (0, process_1.execCommand)(realBinary, [
        ...runtimeArgs,
        '--add-dir',
        context.paths.projectMemoryDir,
        '--append-system-prompt-file',
        claudePath,
        '--settings',
        path.join(claudeConfigDir, 'agent-run-settings.json'),
        '--plugin-dir',
        claudeConfigDir,
        ...args
    ], env, context.projectRoot, (code) => postflightProjectCheck(context, wrapperArgs.local, code));
}
function postflightProjectCheck(context, allowLocal, code) {
    if (!context.guardrails.forbidRepoAiFiles) {
        return code;
    }
    if (!allowLocal) {
        removeClaudeLocalSettings(context.projectRoot);
    }
    const localAiFiles = (0, project_1.findLocalAiFiles)(context.projectRoot, context.profileDir);
    if (localAiFiles.length === 0) {
        return code;
    }
    (0, project_1.warnForLocalAiFiles)(null, context.projectRoot, localAiFiles);
    return allowLocal ? code : 1;
}
function removeClaudeLocalSettings(projectRoot) {
    const claudeDir = path.join(projectRoot, '.claude');
    const localSettingsPath = path.join(claudeDir, 'settings.local.json');
    if (!fs.existsSync(localSettingsPath)) {
        return;
    }
    fs.rmSync(localSettingsPath);
    try {
        fs.rmdirSync(claudeDir);
    }
    catch (error) {
        if (!isDirectoryNotEmptyError(error)) {
            throw error;
        }
    }
    process.stderr.write(`agent-run: removed Claude's project-local settings: ${localSettingsPath}\n`);
}
function isDirectoryNotEmptyError(error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY';
}
function failMissingConfig(tool, agentDir) {
    process.stderr.write(`agent-run: no ${tool} config found for this project: ${agentDir}\n`);
    process.stderr.write(`agent-run: run \`agent-run ${tool} --none\` to bypass agent setup, or \`agent-run ${tool} --create\` to create profile files.\n`);
    process.exit(1);
}
function getDangerArgs(tool) {
    return tool === 'codex' ? ['-a', 'never', '-s', 'danger-full-access'] : ['--dangerously-skip-permissions'];
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
