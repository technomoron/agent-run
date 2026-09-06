"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codexAdapter = void 0;
const os = require("os");
const path = require("path");
const defaults_1 = require("../defaults");
const render_mcp_1 = require("../config/render-mcp");
const render_settings_1 = require("../config/render-settings");
const render_skills_1 = require("../config/render-skills");
const environment_1 = require("../runtime/environment");
const shared_state_1 = require("../runtime/shared-state");
const shared_1 = require("./shared");
function layout(context) {
    return {
        dir: context.paths.codexHomeDir,
        instructionFile: path.join(context.paths.codexHomeDir, 'AGENTS.md'),
        configFiles: [path.join(context.paths.codexHomeDir, 'config.toml')],
        skillsDir: context.paths.codexSkillsDir,
        requiredDirs: [context.paths.codexHomeDir, context.paths.codexSkillsDir],
        preservedSkillNames: new Set(['.system'])
    };
}
function generate(generation) {
    const agentLayout = layout(generation.context);
    const baseConfig = (0, render_settings_1.renderProfileConfig)(generation.env, generation.configRoot, generation.context, 'codex-config.toml.njk', 'global/tool-templates/codex-config.toml.njk', () => (0, defaults_1.defaultCodexConfigContent)(generation.context), 'Codex config.toml', generation.trace);
    const mcp = (0, render_mcp_1.renderCodexMcp)(generation.context);
    const files = [
        { path: agentLayout.instructionFile, content: generation.agentsMd },
        { path: agentLayout.configFiles[0] ?? '', content: `${baseConfig.trimEnd()}${mcp ? `\n\n${mcp}` : '\n'}` },
        ...(0, render_skills_1.renderSkillFiles)(generation.context, agentLayout.skillsDir)
    ];
    return { ...agentLayout, id: 'codex', projectDir: generation.context.projectRoot, files, context: generation.context };
}
exports.codexAdapter = {
    id: 'codex',
    displayName: 'Codex',
    capabilities: {
        instructions: true,
        skills: true,
        mcp: true,
        hooks: false,
        subagents: true,
        headless: true
    },
    wrapperOptions: { sandboxed: true, network: true },
    layout,
    generate,
    prepare(runtime) {
        (0, shared_state_1.linkSharedEntry)(path.join(os.homedir(), '.codex', 'auth.json'), path.join(runtime.dir, 'auth.json'), 'profile Codex auth');
    },
    spawn(runtime, options) {
        (0, shared_1.assertRuntimeFile)('codex', runtime.instructionFile, runtime.context.profileDir);
        const runtimeArgs = options.wrapperArgs.sandboxMode === 'danger'
            ? ['-a', 'never', '-s', 'danger-full-access']
            : ['-a', 'on-request', '-s', 'workspace-write'];
        return {
            command: options.binary,
            args: [
                ...runtimeArgs,
                '--add-dir',
                runtime.context.paths.projectMemoryDir,
                '-C',
                runtime.projectDir,
                ...(options.wrapperArgs.sandboxMode !== 'danger' && options.wrapperArgs.codexNetwork
                    ? ['--config', 'sandbox_workspace_write.network_access=true']
                    : []),
                ...options.passthroughArgs
            ],
            cwd: runtime.dir,
            env: { ...(0, environment_1.buildAgentEnvironment)(runtime.context), CODEX_HOME: runtime.dir },
            onExit: (0, shared_1.withPostflight)(runtime, options.wrapperArgs)
        };
    },
    bypassArgs(wrapperArgs) {
        return wrapperArgs.sandboxMode === 'danger' ? ['-a', 'never', '-s', 'danger-full-access'] : [];
    }
};
