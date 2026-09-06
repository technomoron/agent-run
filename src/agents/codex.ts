import * as os from 'os';
import * as path from 'path';
import { defaultCodexConfigContent } from '../defaults';
import { renderCodexMcp } from '../config/render-mcp';
import { renderProfileConfig } from '../config/render-settings';
import { renderSkillFiles } from '../config/render-skills';
import { buildAgentEnvironment } from '../runtime/environment';
import { linkSharedEntry } from '../runtime/shared-state';
import type { AgentAdapter, AgentGenerationContext, AgentLayout, AgentRuntime } from './types';
import { assertRuntimeFile, withPostflight } from './shared';

function layout(context: AgentGenerationContext['context']): AgentLayout {
	return {
		dir: context.paths.codexHomeDir,
		instructionFile: path.join(context.paths.codexHomeDir, 'AGENTS.md'),
		configFiles: [path.join(context.paths.codexHomeDir, 'config.toml')],
		skillsDir: context.paths.codexSkillsDir,
		requiredDirs: [context.paths.codexHomeDir, context.paths.codexSkillsDir],
		preservedSkillNames: new Set(['.system'])
	};
}

function generate(generation: AgentGenerationContext): AgentRuntime {
	const agentLayout = layout(generation.context);
	const baseConfig = renderProfileConfig(
		generation.env,
		generation.configRoot,
		generation.context,
		'codex-config.toml.njk',
		'global/tool-templates/codex-config.toml.njk',
		() => defaultCodexConfigContent(generation.context),
		'Codex config.toml',
		generation.trace
	);
	const mcp = renderCodexMcp(generation.context);
	const files = [
		{ path: agentLayout.instructionFile, content: generation.agentsMd },
		{ path: agentLayout.configFiles[0] ?? '', content: `${baseConfig.trimEnd()}${mcp ? `\n\n${mcp}` : '\n'}` },
		...renderSkillFiles(generation.context, agentLayout.skillsDir)
	];
	return { ...agentLayout, id: 'codex', projectDir: generation.context.projectRoot, files, context: generation.context };
}

export const codexAdapter: AgentAdapter = {
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
		linkSharedEntry(
			path.join(os.homedir(), '.codex', 'auth.json'),
			path.join(runtime.dir, 'auth.json'),
			'profile Codex auth'
		);
	},
	spawn(runtime, options) {
		assertRuntimeFile('codex', runtime.instructionFile, runtime.context.profileDir);
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
			env: { ...buildAgentEnvironment(runtime.context), CODEX_HOME: runtime.dir },
			onExit: withPostflight(runtime, options.wrapperArgs)
		};
	},
	bypassArgs(wrapperArgs) {
		return wrapperArgs.sandboxMode === 'danger' ? ['-a', 'never', '-s', 'danger-full-access'] : [];
	}
};
