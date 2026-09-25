import * as os from 'os';
import * as path from 'path';
import { defaultCodexConfigContent } from '../defaults';
import { renderCodexMcp } from '../config/render-mcp';
import { renderProfileConfig } from '../config/render-settings';
import { renderSkillFiles } from '../config/render-skills';
import { buildAgentEnvironment } from '../runtime/environment';
import { linkSharedEntry } from '../runtime/shared-state';
import { codexProfileName, codexProfileSkills, codexSharedHome, migrateCodexSessions, refreshCodexProfileSkills, renderCodexProfile } from '../runtime/codex-profile';
import type { AgentAdapter, AgentGenerationContext, AgentLayout, AgentRuntime } from './types';
import { assertRuntimeFile, withPostflight } from './shared';

function layout(context: AgentGenerationContext['context']): AgentLayout {
	return {
		dir: context.paths.codexHomeDir,
		instructionFile: path.join(context.paths.codexHomeDir, 'AGENTS.md'),
		configFiles: [path.join(context.paths.codexHomeDir, 'config.toml'), path.join(codexSharedHome(context), `${codexProfileName(context)}.config.toml`)],
		skillsDir: codexProfileSkills(context),
		requiredDirs: [context.paths.codexHomeDir, codexProfileSkills(context)],
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
	const config = `${baseConfig.trimEnd()}${mcp ? `\n\n${mcp}` : '\n'}`;
	const files = [
		{ path: agentLayout.instructionFile, content: generation.agentsMd },
		{ path: agentLayout.configFiles[0] ?? '', content: config },
		{ path: agentLayout.configFiles[1] ?? '', content: renderCodexProfile(generation.context, config, generation.agentsMd), atomic: true },
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
			path.join(codexSharedHome(runtime.context), 'auth.json'),
			'shared Codex auth'
		);
		migrateCodexSessions(runtime.dir, codexSharedHome(runtime.context));
		const profile = runtime.files.find((file) => file.path === runtime.configFiles[1]);
		const base = runtime.files.find((file) => file.path === runtime.configFiles[0]);
		const instructions = runtime.files.find((file) => file.path === runtime.instructionFile);
		if (profile && base && instructions) {
			profile.content = renderCodexProfile(runtime.context, base.content, instructions.content);
		}
		// Disable the pending skills in other profiles before making them discoverable.
		refreshCodexProfileSkills(runtime.context);
	},
	spawn(runtime, options) {
		assertRuntimeFile('codex', runtime.instructionFile, runtime.context.profileDir);
		const runtimeArgs = options.wrapperArgs.sandboxMode === 'danger'
			? ['-a', 'never', '-s', 'danger-full-access']
			: ['-a', 'on-request', '-s', 'workspace-write'];
		return {
			command: options.binary,
			args: [
				'--profile', codexProfileName(runtime.context),
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
			env: { ...buildAgentEnvironment(runtime.context), CODEX_HOME: codexSharedHome(runtime.context) },
			onExit: withPostflight(runtime, options.wrapperArgs)
		};
	},
	bypassArgs(wrapperArgs) {
		return wrapperArgs.sandboxMode === 'danger' ? ['-a', 'never', '-s', 'danger-full-access'] : [];
	}
};
