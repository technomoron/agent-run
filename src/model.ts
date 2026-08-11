export type ToolName = 'codex' | 'claude';
export type CommandName = ToolName | 'check' | 'setup' | 'init' | 'edit' | 'update' | 'migrate-config';
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

export type InitCommand = {
	command: 'init';
	targetPath: string;
};

export type SetupCommand = {
	command: 'setup';
	targetPath: string;
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
};

export type ParsedInvocation =
	| RunCommand
	| CheckCommand
	| InitCommand
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
	};
};

export type NormalizedManifest = {
	profile: string;
	kind: string;
	agent: {
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
	};
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
		codexHomeDir: string;
		overridesDir: string;
		codexSkillsDir: string;
		claudeSkillsDir: string;
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
};

export type RenderTrace = {
	sourceFiles: Set<string>;
};
