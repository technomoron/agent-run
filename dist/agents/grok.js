"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.grokAdapter = void 0;
const os = require("os");
const path = require("path");
const render_mcp_1 = require("../config/render-mcp");
const render_settings_1 = require("../config/render-settings");
const render_skills_1 = require("../config/render-skills");
const defaults_1 = require("../defaults");
const environment_1 = require("../runtime/environment");
const shared_state_1 = require("../runtime/shared-state");
const shared_1 = require("./shared");
function layout(context) {
    return {
        dir: context.paths.grokRuntimeDir,
        instructionFile: path.join(context.paths.grokRuntimeDir, 'AGENTS.md'),
        configFiles: [path.join(context.paths.grokRuntimeDir, 'config.toml')],
        skillsDir: context.paths.grokSkillsDir,
        requiredDirs: [context.paths.grokRuntimeDir, context.paths.grokSkillsDir]
    };
}
function generate(generation) {
    const agentLayout = layout(generation.context);
    const baseConfig = (0, render_settings_1.renderProfileConfig)(generation.env, generation.configRoot, generation.context, 'grok-config.toml.njk', 'global/tool-templates/grok-config.toml.njk', () => (0, defaults_1.defaultGrokConfigContent)(), 'Grok config.toml', generation.trace);
    const mcp = (0, render_mcp_1.renderGrokMcp)(generation.context);
    const files = [
        { path: agentLayout.instructionFile, content: generation.agentsMd },
        { path: agentLayout.configFiles[0] ?? '', content: `${baseConfig.trimEnd()}${mcp ? `\n\n${mcp}` : '\n'}` },
        ...(0, render_skills_1.renderSkillFiles)(generation.context, agentLayout.skillsDir)
    ];
    return { ...agentLayout, id: 'grok', projectDir: generation.context.projectRoot, files, context: generation.context };
}
exports.grokAdapter = {
    id: 'grok',
    displayName: 'Grok',
    capabilities: {
        instructions: true,
        skills: true,
        mcp: true,
        hooks: true,
        subagents: true,
        headless: true
    },
    wrapperOptions: { sandboxed: true, network: false },
    layout,
    generate,
    prepare(runtime) {
        for (const name of ['auth.json', 'mcp_credentials.json']) {
            (0, shared_state_1.linkSharedEntry)(path.join(os.homedir(), '.grok', name), path.join(runtime.dir, name), `Grok ${name}`);
        }
    },
    spawn(runtime, options) {
        (0, shared_1.assertRuntimeFile)('grok', runtime.instructionFile, runtime.context.profileDir);
        const modeArgs = options.wrapperArgs.sandboxMode === 'danger'
            ? ['--always-approve']
            : options.wrapperArgs.sandboxMode === 'sandboxed'
                ? ['--sandbox', 'workspace']
                : [];
        return {
            command: options.binary,
            args: [...modeArgs, ...options.passthroughArgs],
            cwd: runtime.projectDir,
            env: { ...(0, environment_1.buildAgentEnvironment)(runtime.context), GROK_HOME: runtime.dir },
            onExit: (0, shared_1.withPostflight)(runtime, options.wrapperArgs)
        };
    },
    bypassArgs(wrapperArgs) {
        if (wrapperArgs.sandboxMode === 'danger') {
            return ['--always-approve'];
        }
        return wrapperArgs.sandboxMode === 'sandboxed' ? ['--sandbox', 'workspace'] : [];
    }
};
