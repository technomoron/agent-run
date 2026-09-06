"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiAdapter = void 0;
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
        dir: context.paths.geminiRuntimeDir,
        instructionFile: path.join(context.paths.geminiRuntimeDir, 'AGENTS.md'),
        configFiles: [path.join(context.paths.geminiRuntimeDir, 'settings.json')],
        skillsDir: context.paths.geminiSkillsDir,
        requiredDirs: [
            context.paths.geminiRuntimeDir,
            context.paths.geminiHomeDir,
            context.paths.geminiSkillsDir
        ]
    };
}
function generate(generation) {
    const agentLayout = layout(generation.context);
    const baseSettings = (0, render_settings_1.parseJsonObject)((0, render_settings_1.renderProfileConfig)(generation.env, generation.configRoot, generation.context, 'gemini-settings.json.njk', 'global/tool-templates/gemini-settings.json.njk', () => (0, defaults_1.defaultGeminiSettingsContent)(generation.context), 'Gemini settings', generation.trace), 'Gemini settings');
    const existingContext = asObject(baseSettings.context);
    baseSettings.context = {
        ...existingContext,
        fileName: ['AGENTS.md'],
        includeDirectories: [agentLayout.dir, generation.context.paths.projectMemoryDir],
        loadMemoryFromIncludeDirectories: true,
        fileFiltering: {
            ...asObject(existingContext.fileFiltering),
            respectGitIgnore: false
        }
    };
    baseSettings.mcpServers = (0, render_mcp_1.renderGeminiMcp)(generation.context);
    const files = [
        { path: agentLayout.instructionFile, content: generation.agentsMd },
        { path: agentLayout.configFiles[0] ?? '', content: `${JSON.stringify(baseSettings, null, 2)}\n` },
        ...(0, render_skills_1.renderSkillFiles)(generation.context, agentLayout.skillsDir)
    ];
    return { ...agentLayout, id: 'gemini', projectDir: generation.context.projectRoot, files, context: generation.context };
}
exports.geminiAdapter = {
    id: 'gemini',
    displayName: 'Gemini',
    capabilities: {
        instructions: true,
        skills: true,
        mcp: true,
        hooks: false,
        subagents: true,
        headless: true
    },
    wrapperOptions: { sandboxed: true, network: false },
    layout,
    generate,
    prepare(runtime) {
        const sharedGeminiDir = path.join(os.homedir(), '.gemini');
        const privateGeminiDir = path.join(runtime.context.paths.geminiHomeDir, '.gemini');
        for (const name of [
            'settings.json',
            'oauth_creds.json',
            'google_accounts.json',
            'trustedFolders.json',
            'mcp-oauth-tokens.json',
            'a2a-oauth-tokens.json',
            'keybindings.json',
            'installation_id',
            'skills',
            'commands'
        ]) {
            (0, shared_state_1.linkSharedEntry)(path.join(sharedGeminiDir, name), path.join(privateGeminiDir, name), `Gemini ${name}`);
        }
    },
    spawn(runtime, options) {
        (0, shared_1.assertRuntimeFile)('gemini', runtime.instructionFile, runtime.context.profileDir);
        const modeArgs = options.wrapperArgs.sandboxMode === 'danger'
            ? ['--yolo']
            : options.wrapperArgs.sandboxMode === 'sandboxed'
                ? ['--sandbox']
                : [];
        const sharedTrustedFolders = path.join(os.homedir(), '.gemini', 'trustedFolders.json');
        return {
            command: options.binary,
            args: [...modeArgs, ...options.passthroughArgs],
            cwd: runtime.projectDir,
            env: {
                ...(0, environment_1.buildAgentEnvironment)(runtime.context),
                GEMINI_CLI_HOME: runtime.context.paths.geminiHomeDir,
                GEMINI_CLI_SYSTEM_SETTINGS_PATH: runtime.configFiles[0],
                GEMINI_CLI_TRUSTED_FOLDERS_PATH: sharedTrustedFolders
            },
            onExit: (0, shared_1.withPostflight)(runtime, options.wrapperArgs)
        };
    },
    bypassArgs(wrapperArgs) {
        if (wrapperArgs.sandboxMode === 'danger') {
            return ['--yolo'];
        }
        return wrapperArgs.sandboxMode === 'sandboxed' ? ['--sandbox'] : [];
    }
};
function asObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
