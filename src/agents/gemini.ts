import * as os from 'os';
import * as path from 'path';
import { renderGeminiMcp } from '../config/render-mcp';
import { parseJsonObject, renderProfileConfig } from '../config/render-settings';
import { renderSkillFiles } from '../config/render-skills';
import { defaultGeminiSettingsContent } from '../defaults';
import { buildAgentEnvironment } from '../runtime/environment';
import { linkSharedEntry } from '../runtime/shared-state';
import type { AgentAdapter, AgentGenerationContext, AgentLayout, AgentRuntime } from './types';
import { assertRuntimeFile, withPostflight } from './shared';

function layout(context: AgentGenerationContext['context']): AgentLayout {
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

function generate(generation: AgentGenerationContext): AgentRuntime {
	const agentLayout = layout(generation.context);
	const baseSettings = parseJsonObject(
		renderProfileConfig(
			generation.env,
			generation.configRoot,
			generation.context,
			'gemini-settings.json.njk',
			'global/tool-templates/gemini-settings.json.njk',
			() => defaultGeminiSettingsContent(generation.context),
			'Gemini settings',
			generation.trace
		),
		'Gemini settings'
	);
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
	baseSettings.mcpServers = renderGeminiMcp(generation.context);
	const files = [
		{ path: agentLayout.instructionFile, content: generation.agentsMd },
		{ path: agentLayout.configFiles[0] ?? '', content: `${JSON.stringify(baseSettings, null, 2)}\n` },
		...renderSkillFiles(generation.context, agentLayout.skillsDir)
	];
	return { ...agentLayout, id: 'gemini', projectDir: generation.context.projectRoot, files, context: generation.context };
}

export const geminiAdapter: AgentAdapter = {
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
			linkSharedEntry(path.join(sharedGeminiDir, name), path.join(privateGeminiDir, name), `Gemini ${name}`);
		}
	},
	spawn(runtime, options) {
		assertRuntimeFile('gemini', runtime.instructionFile, runtime.context.profileDir);
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
				...buildAgentEnvironment(runtime.context),
				GEMINI_CLI_HOME: runtime.context.paths.geminiHomeDir,
				GEMINI_CLI_SYSTEM_SETTINGS_PATH: runtime.configFiles[0],
				GEMINI_CLI_TRUSTED_FOLDERS_PATH: sharedTrustedFolders
			},
			onExit: withPostflight(runtime, options.wrapperArgs)
		};
	},
	bypassArgs(wrapperArgs) {
		if (wrapperArgs.sandboxMode === 'danger') {
			return ['--yolo'];
		}
		return wrapperArgs.sandboxMode === 'sandboxed' ? ['--sandbox'] : [];
	}
};

function asObject(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}
