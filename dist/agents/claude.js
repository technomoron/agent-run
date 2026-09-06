"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claudeAdapter = void 0;
const path = require("path");
const render_mcp_1 = require("../config/render-mcp");
const render_settings_1 = require("../config/render-settings");
const render_skills_1 = require("../config/render-skills");
const defaults_1 = require("../defaults");
const environment_1 = require("../runtime/environment");
const shared_1 = require("./shared");
function layout(context) {
    const dir = path.join(context.paths.liveDir, '.claude');
    return {
        dir,
        instructionFile: path.join(context.paths.liveDir, 'CLAUDE.md'),
        configFiles: [
            path.join(dir, 'agent-run-settings.json'),
            path.join(dir, 'mcp.json'),
            path.join(dir, '.claude-plugin', 'plugin.json')
        ],
        skillsDir: context.paths.claudeSkillsDir,
        requiredDirs: [dir, context.paths.claudeSkillsDir]
    };
}
function generate(generation) {
    const agentLayout = layout(generation.context);
    const settingsContent = (0, render_settings_1.renderProfileConfig)(generation.env, generation.configRoot, generation.context, 'claude-settings.json.njk', 'global/tool-templates/claude-settings.json.njk', () => (0, defaults_1.defaultClaudeSettingsContent)(generation.context), 'Claude settings', generation.trace);
    (0, render_settings_1.parseJsonObject)(settingsContent, 'Claude settings');
    const files = [
        { path: agentLayout.instructionFile, content: generation.claudeMd },
        { path: agentLayout.configFiles[0] ?? '', content: settingsContent },
        { path: agentLayout.configFiles[1] ?? '', content: `${JSON.stringify((0, render_mcp_1.renderClaudeMcp)(generation.context), null, 2)}\n` },
        { path: agentLayout.configFiles[2] ?? '', content: pluginManifest(generation.context.profile) },
        ...(0, render_skills_1.renderSkillFiles)(generation.context, agentLayout.skillsDir)
    ];
    return { ...agentLayout, id: 'claude', projectDir: generation.context.projectRoot, files, context: generation.context };
}
exports.claudeAdapter = {
    id: 'claude',
    displayName: 'Claude',
    capabilities: {
        instructions: true,
        skills: true,
        mcp: true,
        hooks: true,
        subagents: true,
        headless: true
    },
    wrapperOptions: { sandboxed: false, network: false },
    layout,
    generate,
    spawn(runtime, options) {
        (0, shared_1.assertRuntimeFile)('claude', runtime.instructionFile, runtime.context.profileDir);
        const runtimeArgs = options.wrapperArgs.sandboxMode === 'danger'
            ? ['--dangerously-skip-permissions']
            : [];
        return {
            command: options.binary,
            args: [
                ...runtimeArgs,
                '--add-dir',
                runtime.context.paths.projectMemoryDir,
                '--append-system-prompt-file',
                runtime.instructionFile,
                '--settings',
                runtime.configFiles[0] ?? '',
                '--mcp-config',
                runtime.configFiles[1] ?? '',
                '--plugin-dir',
                runtime.dir,
                ...options.passthroughArgs
            ],
            cwd: runtime.projectDir,
            env: (0, environment_1.buildAgentEnvironment)(runtime.context),
            onExit: (0, shared_1.withPostflight)(runtime, options.wrapperArgs)
        };
    },
    bypassArgs(wrapperArgs) {
        return wrapperArgs.sandboxMode === 'danger' ? ['--dangerously-skip-permissions'] : [];
    }
};
function pluginManifest(profile) {
    return `${JSON.stringify({
        name: 'agent-run-profile',
        description: `Generated skills for agent-run profile ${profile}`,
        version: '1.0.0',
        author: { name: 'Technomoron' }
    }, null, 2)}\n`;
}
