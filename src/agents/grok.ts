import * as os from 'os';
import * as path from 'path';
import { renderGrokMcp } from '../config/render-mcp';
import { renderProfileConfig } from '../config/render-settings';
import { renderSkillFiles } from '../config/render-skills';
import { defaultGrokConfigContent } from '../defaults';
import { buildAgentEnvironment } from '../runtime/environment';
import { linkSharedEntry } from '../runtime/shared-state';
import type { AgentAdapter, AgentGenerationContext, AgentLayout, AgentRuntime } from './types';
import { assertRuntimeFile, withPostflight } from './shared';

function layout(context: AgentGenerationContext['context']): AgentLayout {
	return {
		dir: context.paths.grokRuntimeDir,
		instructionFile: path.join(context.paths.grokRuntimeDir, 'AGENTS.md'),
		configFiles: [path.join(context.paths.grokRuntimeDir, 'config.toml')],
		skillsDir: context.paths.grokSkillsDir,
		requiredDirs: [context.paths.grokRuntimeDir, context.paths.grokSkillsDir]
	};
}

function generate(generation: AgentGenerationContext): AgentRuntime {
	const agentLayout = layout(generation.context);
	const baseConfig = renderProfileConfig(
		generation.env,
		generation.configRoot,
		generation.context,
		'grok-config.toml.njk',
		'global/tool-templates/grok-config.toml.njk',
		() => defaultGrokConfigContent(),
		'Grok config.toml',
		generation.trace
	);
	const mcp = renderGrokMcp(generation.context);
	const files = [
		{ path: agentLayout.instructionFile, content: generation.agentsMd },
		{ path: agentLayout.configFiles[0] ?? '', content: `${baseConfig.trimEnd()}${mcp ? `\n\n${mcp}` : '\n'}` },
		...renderSkillFiles(generation.context, agentLayout.skillsDir)
	];
	return { ...agentLayout, id: 'grok', projectDir: generation.context.projectRoot, files, context: generation.context };
}

export const grokAdapter: AgentAdapter = {
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
			linkSharedEntry(
				path.join(os.homedir(), '.grok', name),
				path.join(runtime.dir, name),
				`Grok ${name}`
			);
		}
	},
	spawn(runtime, options) {
		assertRuntimeFile('grok', runtime.instructionFile, runtime.context.profileDir);
		const modeArgs = options.wrapperArgs.sandboxMode === 'danger'
			? ['--always-approve']
			: options.wrapperArgs.sandboxMode === 'sandboxed'
				? ['--sandbox', 'workspace']
				: [];
		return {
			command: options.binary,
			args: [...modeArgs, ...options.passthroughArgs],
			cwd: runtime.projectDir,
			env: { ...buildAgentEnvironment(runtime.context), GROK_HOME: runtime.dir },
			onExit: withPostflight(runtime, options.wrapperArgs)
		};
	},
	bypassArgs(wrapperArgs) {
		if (wrapperArgs.sandboxMode === 'danger') {
			return ['--always-approve'];
		}
		return wrapperArgs.sandboxMode === 'sandboxed' ? ['--sandbox', 'workspace'] : [];
	}
};
