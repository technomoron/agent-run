import type * as nunjucks from 'nunjucks';
import type { RenderContext, RenderTrace, RenderedFile, WrapperArgs } from '../model';

export const AGENT_IDS = ['codex', 'claude', 'gemini', 'grok'] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export type AgentCapability = 'instructions' | 'skills' | 'mcp' | 'hooks' | 'subagents' | 'headless';

export type AgentCapabilities = Record<AgentCapability, boolean>;

export type AgentLayout = {
	dir: string;
	instructionFile: string;
	configFiles: string[];
	skillsDir: string;
	requiredDirs: string[];
	preservedSkillNames?: ReadonlySet<string>;
};

export type AgentRuntime = AgentLayout & {
	id: AgentId;
	projectDir: string;
	files: RenderedFile[];
	context: RenderContext;
};

export type AgentGenerationContext = {
	context: RenderContext;
	configRoot: string;
	env: nunjucks.Environment;
	trace?: RenderTrace;
	agentsMd: string;
	claudeMd: string;
};

export type AgentSpawnOptions = {
	binary: string;
	passthroughArgs: string[];
	wrapperArgs: WrapperArgs;
};

export type SpawnSpec = {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
	onExit?: (code: number) => number;
};

export interface AgentAdapter {
	id: AgentId;
	displayName: string;
	capabilities: AgentCapabilities;
	wrapperOptions: {
		sandboxed: boolean;
		network: boolean;
	};
	layout(context: RenderContext): AgentLayout;
	generate(generation: AgentGenerationContext): AgentRuntime;
	prepare?(runtime: AgentRuntime): void;
	spawn(runtime: AgentRuntime, options: AgentSpawnOptions): SpawnSpec;
	bypassArgs(wrapperArgs: WrapperArgs): string[];
}
