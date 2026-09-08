import type { AgentId, AgentRuntime } from './agents/types';

export type ToolName = AgentId;
export type CommandName = ToolName | 'check' | 'status' | 'setup' | 'generate' | 'init' | 'edit' | 'update' | 'migrate-config' | 'mcp' | 'create' | 'project' | 'compress';
export type SandboxMode = 'danger' | 'sandboxed';

export type WrapperArgs = {
	none: boolean;
	create: boolean;
	local: boolean;
	show: boolean;
	generate: boolean;
	sandboxMode: SandboxMode | null;
	codexNetwork: boolean;
};

export type RunCommand = {
	command: ToolName;
	args: string[];
	wrapperArgs: WrapperArgs;
};

export type CheckCommand = {
	all: boolean;
	command: 'check';
	targetPath: string;
};

export type StatusCommand = {
	command: 'status';
};

export type InitCommand = {
	command: 'init';
	targetPath: string;
};

export type GenerateCommand = {
	command: 'generate';
	targetPath: string;
};

export type SetupCommand = {
	command: 'setup';
	profile: string | null;
};

export type EditCommand = {
	command: 'edit';
	targetPath: string;
};

export type UpdateCommand = {
	all: boolean;
	command: 'update';
	targetPath: string;
};

export type MigrateConfigCommand = {
	command: 'migrate-config';
	configRoot: string;
	yes: boolean;
};

export type ParsedInvocation =
	| { command: 'mcp' | 'create' | 'project'; args: string[] }
	| { command: 'compress'; agent?: ToolName; scope?: 'global' | 'project' | 'default'; dryRun: boolean }
	| RunCommand
	| CheckCommand
	| StatusCommand
	| InitCommand
	| GenerateCommand
	| SetupCommand
	| EditCommand
	| UpdateCommand
	| MigrateConfigCommand;

export type WalkVisitorResult = 'skip' | undefined;

export type Finding = {
	message: string;
	severity: 'ERROR' | 'WARN';
};

export type AgentRunManifest = {
	profile?: string;
	kind?: 'code' | 'writing' | string;
	agent?: {
		default?: ToolName;
		base?: string;
		includes?: string[];
	};
	skills?:
		| {
				install?: string[];
				overrides?: Record<string, string>;
		  }
		| string[];
	tools?: {
		codex?: boolean;
		claude?: boolean;
		gemini?: boolean;
		grok?: boolean;
	};
	mcp?: {
		servers?: Record<string, McpServerConfig>;
	};
	checks?: string[];
	guardrails?: {
		blockGitWrite?: boolean;
		blockPublish?: boolean;
		blockGithubRelease?: boolean;
		forbidRepoAiFiles?: boolean;
	};
	paths?: {
		changesFile?: string;
		reviewDir?: string;
		reviewFile?: string;
		reviewConsolidatedFile?: string;
		memoriesDir?: string;
		projectMemoryDir?: string;
	};
};

export type McpServerConfig = {
	transport?: 'stdio' | 'http' | 'sse';
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled?: boolean;
};

export type NormalizedMcpServer = {
	transport: 'stdio' | 'http' | 'sse';
	command?: string;
	args: string[];
	cwd?: string;
	env: Record<string, string>;
	url?: string;
	headers: Record<string, string>;
	enabled: boolean;
};

export type NormalizedManifest = {
	profile: string;
	kind: string;
	agent: {
		default: ToolName;
		base: string;
		includes: string[];
	};
	skills: {
		install: string[];
		overrides: Record<string, string>;
	};
	tools: {
		codex: boolean;
		claude: boolean;
		gemini: boolean;
		grok: boolean;
	};
	mcpServers: Record<string, NormalizedMcpServer>;
	checks: string[];
	guardrails: {
		blockGitWrite: boolean;
		blockPublish: boolean;
		blockGithubRelease: boolean;
		forbidRepoAiFiles: boolean;
	};
	paths: {
		changesFile: string;
		reviewDir: string;
		reviewFile: string;
		reviewConsolidatedFile?: string;
		memoriesDir: string;
		projectMemoryDir: string;
	};
};

export type RenderContext = {
	profile: string;
	kind: string;
	projectRoot: string;
	agentDir: string;
	profileDir: string;
	configRoot: string;
	date: string;
	checks: string[];
	tools: NormalizedManifest['tools'];
	mcpServers: NormalizedManifest['mcpServers'];
	guardrails: NormalizedManifest['guardrails'];
	permissionsAllow: string[];
	paths: {
		profileDir: string;
		liveDir: string;
		changesFile: string;
		reviewDir: string;
		reviewFile: string;
		reviewConsolidatedFile: string;
		memoriesDir: string;
		globalMemoryDir: string;
		projectMemoryDir: string;
		nativeMemoryDir: string;
		codexHomeDir: string;
		overridesDir: string;
		codexSkillsDir: string;
		claudeSkillsDir: string;
		geminiRuntimeDir: string;
		geminiHomeDir: string;
		geminiSkillsDir: string;
		grokRuntimeDir: string;
		grokSkillsDir: string;
		binDir: string;
	};
	skills: Array<{
		name: string;
		sourcePath: string;
		renderedContent: string;
		description: string;
	}>;
	renderedAgentSections: string[];
};

export type RenderedFile = { path: string; content: string; executable?: boolean };

export type RenderedProfile = {
	agentDir: string;
	configRoot: string;
	profile: string;
	context: RenderContext;
	files: RenderedFile[];
	skills: RenderContext['skills'];
	runtimes: Partial<Record<ToolName, AgentRuntime>>;
};

export type RenderTrace = {
	sourceFiles: Set<string>;
};
