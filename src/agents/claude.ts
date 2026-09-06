import * as path from 'path';
import { renderClaudeMcp } from '../config/render-mcp';
import { parseJsonObject, renderProfileConfig } from '../config/render-settings';
import { renderSkillFiles } from '../config/render-skills';
import { defaultClaudeSettingsContent } from '../defaults';
import { buildAgentEnvironment } from '../runtime/environment';
import type { AgentAdapter, AgentGenerationContext, AgentLayout, AgentRuntime } from './types';
import { assertRuntimeFile, withPostflight } from './shared';

function layout(context: AgentGenerationContext['context']): AgentLayout {
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

function generate(generation: AgentGenerationContext): AgentRuntime {
	const agentLayout = layout(generation.context);
	const settingsContent = renderProfileConfig(
		generation.env,
		generation.configRoot,
		generation.context,
		'claude-settings.json.njk',
		'global/tool-templates/claude-settings.json.njk',
		() => defaultClaudeSettingsContent(generation.context),
		'Claude settings',
		generation.trace
	);
	parseJsonObject(settingsContent, 'Claude settings');
	const files = [
		{ path: agentLayout.instructionFile, content: generation.claudeMd },
		{ path: agentLayout.configFiles[0] ?? '', content: settingsContent },
		{ path: agentLayout.configFiles[1] ?? '', content: `${JSON.stringify(renderClaudeMcp(generation.context), null, 2)}\n` },
		{ path: agentLayout.configFiles[2] ?? '', content: pluginManifest(generation.context.profile) },
		...renderSkillFiles(generation.context, agentLayout.skillsDir)
	];
	return { ...agentLayout, id: 'claude', projectDir: generation.context.projectRoot, files, context: generation.context };
}

export const claudeAdapter: AgentAdapter = {
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
		assertRuntimeFile('claude', runtime.instructionFile, runtime.context.profileDir);
		const forcedPermissionArgs = process.env.AGENT_WRAPPER_FORCE_PERMISSIVE === '1' &&
			typeof process.getuid === 'function' && process.getuid() !== 0
			? ['--permission-mode', 'bypassPermissions']
			: [];
		const runtimeArgs = options.wrapperArgs.sandboxMode === 'danger'
			? ['--dangerously-skip-permissions']
			: forcedPermissionArgs;
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
			env: buildAgentEnvironment(runtime.context),
			onExit: withPostflight(runtime, options.wrapperArgs)
		};
	},
	bypassArgs(wrapperArgs) {
		return wrapperArgs.sandboxMode === 'danger' ? ['--dangerously-skip-permissions'] : [];
	}
};

function pluginManifest(profile: string): string {
	return `${JSON.stringify(
		{
			name: 'agent-run-profile',
			description: `Generated skills for agent-run profile ${profile}`,
			version: '1.0.0',
			author: { name: 'Technomoron' }
		},
		null,
		2
	)}\n`;
}
