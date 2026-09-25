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
const codex_profile_1 = require("../runtime/codex-profile");
const shared_1 = require("./shared");
function layout(context) {
    return {
        dir: context.paths.codexHomeDir,
        instructionFile: path.join(context.paths.codexHomeDir, 'AGENTS.md'),
        configFiles: [path.join(context.paths.codexHomeDir, 'config.toml'), path.join((0, codex_profile_1.codexSharedHome)(context), `${(0, codex_profile_1.codexProfileName)(context)}.config.toml`)],
        skillsDir: (0, codex_profile_1.codexProfileSkills)(context),
        requiredDirs: [context.paths.codexHomeDir, (0, codex_profile_1.codexProfileSkills)(context)],
        preservedSkillNames: new Set(['.system'])
    };
}
function generate(generation) {
    const agentLayout = layout(generation.context);
    const baseConfig = (0, render_settings_1.renderProfileConfig)(generation.env, generation.configRoot, generation.context, 'codex-config.toml.njk', 'global/tool-templates/codex-config.toml.njk', () => (0, defaults_1.defaultCodexConfigContent)(generation.context), 'Codex config.toml', generation.trace);
    const mcp = (0, render_mcp_1.renderCodexMcp)(generation.context);
    const config = `${baseConfig.trimEnd()}${mcp ? `\n\n${mcp}` : '\n'}`;
    const files = [
        { path: agentLayout.instructionFile, content: generation.agentsMd },
        { path: agentLayout.configFiles[0] ?? '', content: config },
        { path: agentLayout.configFiles[1] ?? '', content: (0, codex_profile_1.renderCodexProfile)(generation.context, config, generation.agentsMd), atomic: true },
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
        (0, shared_state_1.linkSharedEntry)(path.join(os.homedir(), '.codex', 'auth.json'), path.join((0, codex_profile_1.codexSharedHome)(runtime.context), 'auth.json'), 'shared Codex auth');
        (0, codex_profile_1.migrateCodexSessions)(runtime.dir, (0, codex_profile_1.codexSharedHome)(runtime.context));
        const profile = runtime.files.find((file) => file.path === runtime.configFiles[1]);
        const base = runtime.files.find((file) => file.path === runtime.configFiles[0]);
        const instructions = runtime.files.find((file) => file.path === runtime.instructionFile);
        if (profile && base && instructions) {
            profile.content = (0, codex_profile_1.renderCodexProfile)(runtime.context, base.content, instructions.content);
        }
        // Disable the pending skills in other profiles before making them discoverable.
        (0, codex_profile_1.refreshCodexProfileSkills)(runtime.context);
    },
    spawn(runtime, options) {
        (0, shared_1.assertRuntimeFile)('codex', runtime.instructionFile, runtime.context.profileDir);
        const runtimeArgs = options.wrapperArgs.sandboxMode === 'danger'
            ? ['-a', 'never', '-s', 'danger-full-access']
            : ['-a', 'on-request', '-s', 'workspace-write'];
        return {
            command: options.binary,
            args: [
                '--profile', (0, codex_profile_1.codexProfileName)(runtime.context),
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
            cwd: runtime.projectDir,
            env: { ...(0, environment_1.buildAgentEnvironment)(runtime.context), CODEX_HOME: (0, codex_profile_1.codexSharedHome)(runtime.context) },
            onExit: (0, shared_1.withPostflight)(runtime, options.wrapperArgs)
        };
    },
    bypassArgs(wrapperArgs) {
        return wrapperArgs.sandboxMode === 'danger' ? ['-a', 'never', '-s', 'danger-full-access'] : [];
    }
};
