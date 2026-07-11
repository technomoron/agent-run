#!/usr/bin/env node

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import crossSpawn = require('cross-spawn');
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';
import * as nunjucks from 'nunjucks';

type ToolName = 'codex' | 'claude';
type CommandName = ToolName | 'check' | 'init' | 'edit' | 'update' | 'migrate-config';
type CodexSandboxMode = 'danger' | 'sandboxed';

type WrapperArgs = {
	none: boolean;
	create: boolean;
	local: boolean;
	show: boolean;
	generate: boolean;
	codexSandboxMode: CodexSandboxMode | null;
	codexNetwork: boolean;
};

type RunCommand = {
	command: ToolName;
	args: string[];
	wrapperArgs: WrapperArgs;
};

type CheckCommand = {
	all: boolean;
	command: 'check';
	targetPath: string;
};

type InitCommand = {
	command: 'init';
	targetPath: string;
};

type InitConfigCommand = {
	command: 'init-config';
	targetPath: string;
};

type EditCommand = {
	command: 'edit';
	targetPath: string;
};

type UpdateCommand = {
	all: boolean;
	command: 'update';
	targetPath: string;
};

type MigrateConfigCommand = {
	command: 'migrate-config';
	configRoot: string;
};

type ParsedInvocation =
	| RunCommand
	| CheckCommand
	| InitCommand
	| InitConfigCommand
	| EditCommand
	| UpdateCommand
	| MigrateConfigCommand;
type WalkVisitorResult = 'skip' | undefined;
type WalkVisitor = (fullPath: string, entry: fs.Dirent) => WalkVisitorResult;

type Finding = {
	message: string;
	severity: 'ERROR' | 'WARN';
};

type AgentRunManifest = {
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

type NormalizedManifest = {
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

type RenderContext = {
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

type RenderedProfile = {
	agentDir: string;
	configRoot: string;
	profile: string;
	context: RenderContext;
	files: Array<{ path: string; content: string; executable?: boolean }>;
	skills: RenderContext['skills'];
};

type RenderTrace = {
	sourceFiles: Set<string>;
};

const IS_WINDOWS = process.platform === 'win32';
const ENV_FILE_NAME = '.agent-run.env';
const IGNORE_FILE_NAME = '.agent-run-ignore';
const LOCAL_AI_FILE_NAMES = new Set([
	'AGENTS.md',
	'AGENTS-MODS.md',
	'AGENTS.override.md',
	'CLAUDE.md',
	'CLAUDE.local.md',
	'.mcp.json',
	'codex.md'
]);
const LOCAL_AI_DIRECTORY_NAMES = new Set(['.agents', '.claude', '.codex']);
const CONFIG_ROOT_OVERRIDE_ENV = 'AGENT_RUN_CONFIG_ROOT_OVERRIDE';
const CONFIG_DIR_ENV = 'AGENT_CONFIG_DIR';
const VERBOSE_ENV = 'AGENT_RUN_VERBOSE';
const MANIFEST_FILE_NAME = 'agent-run.jsonc';
const LOCAL_TEMPLATE_FILE_NAME = 'local.md.njk';
const LIVE_DIR_NAME = 'live';
const PACKAGE_VERSION = '0.99.24';
const UNEXPANDED_TEMPLATE_RE = /\{\{[^}]+\}\}|\{%[^%]+%\}/;
const agentRunEnvCache = new Map<string, Record<string, string>>();

const GENERATED_GITIGNORE_ENTRIES = [
	'# Generated agent-run live profiles',
	'**/live/',
	'',
	'# Optional generated caches',
	'**/.agent-run-cache/',
	'',
	'# Legacy Codex runtime state',
	'**/auth.json',
	'**/history.jsonl',
	'**/sessions/',
	'**/archived_sessions/',
	'**/log/',
	'**/logs/',
	'**/shell_snapshots/',
	'**/*.sqlite*',
	'**/models_cache.json',
	'**/cache/',
	'**/.tmp/',
	'**/installation_id',
	'**/version.json',
	'**/.personality_migration',
	'**/skills/.system/'
];

const REQUIRED_GLOBAL_TEMPLATES = [
	'global/agents/code.md.njk',
	'global/agents/writing.md.njk',
	'global/snippets/git-rules.md.njk',
	'global/snippets/no-ai-files.md.njk',
	'global/snippets/verification.md.njk',
	'global/tool-templates/codex-config.toml.njk',
	'global/tool-templates/claude-settings.json.njk',
	'global/skills/commit-workflow/SKILL.md.njk',
	'global/skills/github-release/SKILL.md.njk',
	'global/skills/release-package-check/SKILL.md.njk',
	'global/skills/code-review-organizer/SKILL.md.njk'
];

export function main(invokedTool: string, argv: string[]): void {
	const parsed = parseInvocation(invokedTool, argv);

	if (parsed.command === 'check') {
		runCheck(parsed);
		return;
	}
	if (parsed.command === 'init') {
		runInit(parsed);
		return;
	}
	if (parsed.command === 'init-config') {
		runInitConfig(parsed);
		return;
	}
	if (parsed.command === 'edit') {
		runEdit(parsed);
		return;
	}
	if (parsed.command === 'update') {
		runUpdate(parsed);
		return;
	}
	if (parsed.command === 'migrate-config') {
		runMigrateConfig(parsed);
		return;
	}

	runTool(parsed);
}

export function parseInvocation(invokedTool: string, argv: string[]): ParsedInvocation {
	let command = normalizeCommandName(invokedTool);
	const extracted = extractGlobalOptions(argv);
	const inputArgs = extracted.args;

	if (extracted.verbose) {
		process.env[VERBOSE_ENV] = '1';
	}
	if (extracted.configRootOverride !== null) {
		process.env[CONFIG_ROOT_OVERRIDE_ENV] = extracted.configRootOverride;
	}
	if (extracted.initConfig) {
		if (inputArgs.length > 0) {
			fail('--init cannot be combined with a command');
		}
		return {
			command: 'init-config',
			targetPath: path.resolve(extracted.initConfigTargetPath ?? defaultConfigRoot())
		};
	}

	if (command === null) {
		if (inputArgs.length === 0) {
			fail('usage: agent-run <codex|claude|check|init|edit|update> [options] (run with --help for details)');
		}

		const firstArg = inputArgs[0];
		if (isHelpFlag(firstArg)) {
			printHelp('general');
		}
		if (isVersionFlag(firstArg)) {
			printVersion();
		}
		const commandIndex = findCommandArgIndex(inputArgs);
		if (commandIndex === -1) {
			fail(`unknown command: ${firstArg ?? ''} (run with --help for usage)`);
		}
		const parsedCommand = normalizeCommandName(inputArgs[commandIndex] ?? '');
		if (parsedCommand === null) {
			fail(`unknown command: ${firstArg ?? ''} (run with --help for usage)`);
		}
		command = parsedCommand;
		inputArgs.splice(commandIndex, 1);
	}

	if (command === 'check') {
		return parseCheckCommand(inputArgs);
	}
	if (command === 'init') {
		return parseInitCommand(inputArgs);
	}
	if (command === 'edit') {
		return parseEditCommand(inputArgs);
	}
	if (command === 'update') {
		return parseUpdateCommand(inputArgs);
	}
	if (command === 'migrate-config') {
		return parseMigrateConfigCommand(inputArgs);
	}

	return parseRunCommand(command, inputArgs);
}

function findCommandArgIndex(args: string[]): number {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--') {
			return -1;
		}
		if (normalizeCommandName(arg ?? '') !== null) {
			return index;
		}
	}
	return -1;
}

function extractGlobalOptions(argv: string[]): {
	args: string[];
	configRootOverride: string | null;
	initConfig: boolean;
	initConfigTargetPath: string | null;
	verbose: boolean;
} {
	const args: string[] = [];
	let configRootOverride: string | null = null;
	let initConfig = false;
	let initConfigTargetPath: string | null = null;
	let verbose = false;
	let passthrough = false;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (passthrough || arg === undefined) {
			if (arg !== undefined) {
				args.push(arg);
			}
			continue;
		}

		if (arg === '--') {
			passthrough = true;
			args.push(arg);
			continue;
		}
		if (arg === '-v' || arg === '--verbose') {
			verbose = true;
			continue;
		}
		if (arg === '--init') {
			initConfig = true;
			const nextArg = argv[index + 1];
			if (nextArg !== undefined && !nextArg.startsWith('-')) {
				initConfigTargetPath = nextArg;
				index += 1;
			}
			continue;
		}
		if (arg === '--config-root') {
			const nextArg = argv[index + 1];
			if (nextArg === undefined) {
				fail('missing value for --config-root');
			}
			configRootOverride = path.resolve(nextArg);
			index += 1;
			continue;
		}
		if (arg.startsWith('--config-root=')) {
			const rootValue = arg.slice('--config-root='.length);
			if (!rootValue) {
				fail('missing value for --config-root');
			}
			configRootOverride = path.resolve(rootValue);
			continue;
		}

		args.push(arg);
	}

	return { args, configRootOverride, initConfig, initConfigTargetPath, verbose };
}

function parseRunCommand(command: ToolName, inputArgs: string[]): RunCommand {
	const wrapperArgs: WrapperArgs = {
		none: false,
		create: false,
		local: false,
		show: false,
		generate: false,
		codexSandboxMode: null,
		codexNetwork: false
	};
	const args: string[] = [];
	let passthrough = false;

	for (const arg of inputArgs) {
		if (passthrough) {
			args.push(arg);
			continue;
		}
		if (arg === '--') {
			passthrough = true;
			args.push(arg);
			continue;
		}
		if (arg === '--none') {
			wrapperArgs.none = true;
			continue;
		}
		if (arg === '--create') {
			wrapperArgs.create = true;
			continue;
		}
		if (arg === '--local') {
			wrapperArgs.local = true;
			continue;
		}
		if (arg === '--show') {
			wrapperArgs.show = true;
			continue;
		}
		if (arg === '--generate') {
			wrapperArgs.generate = true;
			continue;
		}
		if (arg === '--danger') {
			if (command !== 'codex') {
				fail('--danger is only supported for agent-run codex');
			}
			if (wrapperArgs.codexSandboxMode === 'sandboxed') {
				fail('cannot combine --danger and --sandboxed');
			}
			wrapperArgs.codexSandboxMode = 'danger';
			continue;
		}
		if (arg === '--sandboxed') {
			if (command !== 'codex') {
				fail('--sandboxed is only supported for agent-run codex');
			}
			if (wrapperArgs.codexSandboxMode === 'danger') {
				fail('cannot combine --danger and --sandboxed');
			}
			wrapperArgs.codexSandboxMode = 'sandboxed';
			continue;
		}
		if (arg === '--network') {
			if (command !== 'codex') {
				fail('--network is only supported for agent-run codex');
			}
			wrapperArgs.codexNetwork = true;
			continue;
		}
		args.push(arg);
	}

	if (wrapperArgs.codexNetwork && wrapperArgs.codexSandboxMode === 'danger') {
		fail('--network cannot be combined with agent-run codex --danger');
	}

	return { args, command, wrapperArgs };
}

function parseCheckCommand(inputArgs: string[]): CheckCommand {
	let all = false;
	let targetPath = process.cwd();

	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('check');
		}
		if (arg === '--all') {
			all = true;
			continue;
		}
		if (arg.startsWith('--')) {
			fail(`unknown check option: ${arg}`);
		}
		targetPath = arg;
	}

	return { all, command: 'check', targetPath: path.resolve(targetPath) };
}

function parseInitCommand(inputArgs: string[]): InitCommand {
	let targetPath = process.cwd();
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('init');
		}
		if (arg.startsWith('--')) {
			fail(`unknown init option: ${arg}`);
		}
		targetPath = arg;
	}
	return { command: 'init', targetPath: path.resolve(targetPath) };
}

function parseEditCommand(inputArgs: string[]): EditCommand {
	let targetPath = process.cwd();
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('edit');
		}
		if (arg.startsWith('--')) {
			fail(`unknown edit option: ${arg}`);
		}
		targetPath = arg;
	}
	return { command: 'edit', targetPath: path.resolve(targetPath) };
}

function parseUpdateCommand(inputArgs: string[]): UpdateCommand {
	let all = false;
	let targetPath = process.cwd();
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('update');
		}
		if (arg === '--all') {
			all = true;
			continue;
		}
		if (arg.startsWith('--')) {
			fail(`unknown update option: ${arg}`);
		}
		targetPath = arg;
	}
	return { all, command: 'update', targetPath: path.resolve(targetPath) };
}

function parseMigrateConfigCommand(inputArgs: string[]): MigrateConfigCommand {
	let configRoot = defaultConfigRoot();
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('migrate-config');
		}
		if (arg.startsWith('--')) {
			fail(`unknown migrate-config option: ${arg}`);
		}
		configRoot = arg;
	}
	return { command: 'migrate-config', configRoot: path.resolve(configRoot) };
}

function isHelpFlag(value: string | undefined): boolean {
	return value === '-h' || value === '--help';
}

function isVersionFlag(value: string | undefined): boolean {
	return value === '-V' || value === '--version';
}

function printVersion(): never {
	process.stdout.write(`agent-run ${agentRunVersion()}\n`);
	process.exit(0);
}

function printHelp(topic: 'general' | 'check' | 'init' | 'edit' | 'update' | 'migrate-config'): never {
	process.stdout.write(renderHelp(topic));
	process.exit(0);
}

function renderHelp(topic: 'general' | 'check' | 'init' | 'edit' | 'update' | 'migrate-config'): string {
	switch (topic) {
		case 'check':
			return [
				'Usage:',
				'  agent-run check [--all] [path]',
				'',
				'Check generated profile files, native skills, guard shims, and local AI-file leaks.',
				'',
				'Options:',
				'  -h, --help  Show this help text',
				'  --all       Check every repo under path',
				''
			].join('\n');
		case 'init':
			return [
				'Usage:',
				'  agent-run init [path]',
				'',
				'Create the mapped profile manifest/templates and render generated files.',
				''
			].join('\n');
		case 'edit':
			return [
				'Usage:',
				'  agent-run edit [path]',
				'',
				'Open the editable local profile template.',
				''
			].join('\n');
		case 'update':
			return [
				'Usage:',
				'  agent-run update [--all] [path]',
				'',
				'Render generated files, native skills, config, and guard shims for the repo at path.',
				'With --all, render every profile found under the config root without requiring code checkouts.',
				''
			].join('\n');
		case 'migrate-config':
			return [
				'Usage:',
				'  agent-run migrate-config [config-root]',
				'',
				'Convert an existing agent config tree to manifest/local.md.njk/global layout.',
				''
			].join('\n');
		case 'general':
		default:
			return [
				`agent-run ${agentRunVersion()}`,
				'',
				'Usage:',
				'  agent-run <codex|claude|check|init|edit|update> [options]',
				'  agent-run --init [config-root]',
				'',
				'Commands:',
				'  codex [--none] [--create] [--local] [--show] [--generate] [--danger|--sandboxed] [--network] [args...]',
				'                                           Run codex with generated private config',
				'  claude [--none] [--create] [--local] [--show] [--generate] [args...]',
				'                                           Run claude with generated private config',
				'  check [--all] [path]                  Validate generated profile output',
				'  init [path]                           Create profile source files and render output',
				'  edit [path]                           Open local.md.njk or legacy AGENTS-MODS.md',
				'  update [--all] [path]                 Regenerate profile output',
				'  migrate-config [config-root]           Convert existing config tree layout',
				'',
				'Global options:',
				'  -h, --help         Show this help text',
				'  -V, --version      Show the agent-run version',
				'  -v, --verbose      Print path resolution and wrapper actions',
				'  --config-root DIR  Override the agent-config root',
				'  --init [DIR]       Copy the packaged starter config root to DIR (default ~/.agent-config)',
				'',
				'Run wrapper options:',
				'  --local            Warn about local AI files instead of failing',
				'  --show             Show read/include and generated files without running the tool',
				'  --generate         Generate files without running the tool',
				'',
				'Codex wrapper options:',
				'  --danger           Run Codex with no sandbox: -a never -s danger-full-access',
				'  --sandboxed        Run Codex with workspace-write sandbox (default)',
				'  --network          Enable network for the workspace-write sandbox',
				''
			].join('\n');
	}
}

function agentRunVersion(): string {
	const packagePath = path.resolve(__dirname, '..', 'package.json');
	try {
		const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: unknown };
		if (typeof pkg.version === 'string' && pkg.version.length > 0) {
			return pkg.version;
		}
	} catch {
		return PACKAGE_VERSION;
	}
	return PACKAGE_VERSION;
}

function normalizeCommandName(value: string): CommandName | null {
	if (!value) {
		return null;
	}

	const base = path.basename(value).toLowerCase();
	if (base === 'agent-run' || base === 'agent-run.js' || base === 'agent-run.cmd') {
		return null;
	}
	if (base === 'codex' || base === 'codex.cmd' || base === 'codex.exe' || base === 'codex.bat') {
		return 'codex';
	}
	if (base === 'claude' || base === 'claude.cmd' || base === 'claude.exe' || base === 'claude.bat') {
		return 'claude';
	}
	if (base === 'check') {
		return 'check';
	}
	if (base === 'init') {
		return 'init';
	}
	if (base === 'edit') {
		return 'edit';
	}
	if (base === 'update') {
		return 'update';
	}
	if (base === 'migrate-config' || base === 'migrate-config.cmd') {
		return 'migrate-config';
	}

	return null;
}

function runTool(parsed: RunCommand): void {
	const { args, command, wrapperArgs } = parsed;
	const projectRoot = findProjectRoot(process.cwd());
	verbose(`run ${command}: cwd=${process.cwd()} projectRoot=${projectRoot}`);
	if (wrapperArgs.show && wrapperArgs.none) {
		fail('--show cannot be combined with --none');
	}
	if (wrapperArgs.generate && wrapperArgs.none) {
		fail('--generate cannot be combined with --none');
	}
	if (wrapperArgs.generate && wrapperArgs.show) {
		fail('--generate cannot be combined with --show');
	}
	if (wrapperArgs.show && isIgnoredDir(projectRoot)) {
		fail(`cannot show generated ${command} files for ignored project: ${projectRoot}`);
	}
	if (wrapperArgs.generate && isIgnoredDir(projectRoot)) {
		fail(`cannot generate ${command} files for ignored project: ${projectRoot}`);
	}

	if (wrapperArgs.none || isIgnoredDir(projectRoot)) {
		const realBinary = findRealBinary(command);
		const permissionArgs = getPermissionArgs(command);
		verbose(`wrapper bypassed for ${command}${wrapperArgs.none ? ' via --none' : ' because project is ignored'}`);
		execTool(realBinary, [...permissionArgs, ...args]);
		return;
	}

	const profileResult = resolveProfileResult(projectRoot);
	if (profileResult.profile === null) {
		fail(profileResult.reason);
	}

	const profile = profileResult.profile;
	if (wrapperArgs.show) {
		const configRoot = defaultConfigRoot(projectRoot);
		const agentDir = path.join(configRoot, profile);
		verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
		showToolProfile(command, projectRoot, agentDir);
		return;
	}
	if (wrapperArgs.create) {
		runInit({ command: 'init', targetPath: projectRoot });
	}
	const configRoot = defaultConfigRoot(projectRoot);
	const agentDir = path.join(configRoot, profile);
	verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);

	ensureRunnableProfile(configRoot, agentDir, profile);
	const preview = renderProfile(projectRoot, agentDir, true, command);
	ensureToolEnabled(preview.context, command);
	if (wrapperArgs.generate) {
		const rendered = syncAgentProfile(projectRoot, agentDir);
		printUpdateSummary(rendered);
		return;
	}

	const localAiFiles = findLocalAiFiles(projectRoot, agentDir);
	if (preview.context.guardrails.forbidRepoAiFiles && localAiFiles.length > 0) {
		if (!wrapperArgs.local) {
			failForLocalAiFiles(command, projectRoot, localAiFiles);
		}
		warnForLocalAiFiles(command, projectRoot, localAiFiles);
	}

	const realBinary = findRealBinary(command);
	const permissionArgs = getPermissionArgs(command);
	const rendered = syncAgentProfile(projectRoot, agentDir);

	if (command === 'codex') {
		runCodex(realBinary, permissionArgs, rendered.context, args, wrapperArgs);
		return;
	}

	runClaude(realBinary, permissionArgs, rendered.context, args, wrapperArgs);
}

function showToolProfile(command: ToolName, projectRoot: string, agentDir: string): void {
	const trace: RenderTrace = { sourceFiles: new Set<string>() };
	const rendered = renderProfile(projectRoot, agentDir, true, command, trace);
	ensureToolEnabled(rendered.context, command);
	const generatedFiles = uniqueSorted(rendered.files.map((file) => file.path));
	const sourceFiles = uniqueSorted([...trace.sourceFiles]);

	process.stdout.write(
		[
			`Agent: ${command}`,
			`Profile: ${rendered.profile}`,
			`Project root: ${projectRoot}`,
			`Profile dir: ${agentDir}`,
			'',
			'Reads/includes:',
			...formatPathList(sourceFiles),
			'',
			'Generates:',
			...formatPathList(generatedFiles),
			''
		].join('\n')
	);
}

function ensureToolEnabled(context: RenderContext, command: ToolName): void {
	if (!context.tools[command]) {
		fail(`${command} is disabled for agent-run profile ${context.profile}`);
	}
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.map((value) => path.resolve(value)))].sort((a, b) => a.localeCompare(b));
}

function formatPathList(paths: string[]): string[] {
	return paths.length === 0 ? ['  (none)'] : paths.map((entry) => `  ${entry}`);
}

function runInit(parsed: InitCommand): void {
	const projectRoot = findProjectRoot(parsed.targetPath);
	verbose(`init target=${parsed.targetPath} projectRoot=${projectRoot}`);
	if (isIgnoredDir(projectRoot)) {
		process.stdout.write(`SKIP ignored ${projectRoot}\n`);
		return;
	}

	const profile = resolveProfile(projectRoot);
	const configRoot = defaultConfigRoot(projectRoot, { preferProjectRoot: true });
	const agentDir = path.join(configRoot, profile);
	verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);

	ensureConfigRootLayout(configRoot);
	ensureConfigRootGitignore(configRoot);
	ensureDefaultGlobalTemplates(configRoot);
	fs.mkdirSync(agentDir, { recursive: true });
	ensureProfileOverridesDir(agentDir);
	convertLegacyProfileIfNeeded(configRoot, agentDir, profile);
	createDefaultManifestFile(agentDir, profile);
	createDefaultLocalFile(agentDir, profile);

	const rendered = syncAgentProfile(projectRoot, agentDir);
	printUpdateSummary(rendered);
}

function runInitConfig(parsed: InitConfigCommand): void {
	const targetPath = path.resolve(parsed.targetPath);
	const sourcePath = starterConfigRootPath();
	if (!fs.existsSync(sourcePath)) {
		fail(`starter config skeleton not found: ${sourcePath}`);
	}

	copySkeletonTree(sourcePath, targetPath);
	process.stdout.write(`OK copied starter config to ${targetPath}\n`);
}

function ensureRunnableProfile(configRoot: string, agentDir: string, profile: string): void {
	ensureConfigRootLayout(configRoot);
	ensureConfigRootGitignore(configRoot);
	ensureDefaultGlobalTemplates(configRoot);
	fs.mkdirSync(agentDir, { recursive: true });
	ensureProfileOverridesDir(agentDir);
	convertLegacyProfileIfNeeded(configRoot, agentDir, profile);
	createDefaultManifestFile(agentDir, profile);
	createDefaultLocalFile(agentDir, profile);
}

function runEdit(parsed: EditCommand): void {
	const projectRoot = findProjectRoot(parsed.targetPath);
	verbose(`edit target=${parsed.targetPath} projectRoot=${projectRoot}`);
	if (isIgnoredDir(projectRoot)) {
		process.stdout.write(`SKIP ignored ${projectRoot}\n`);
		process.exit(0);
	}

	const agentDir = resolveAgentDir(projectRoot);
	const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
	const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
	if (!fs.existsSync(localPath) && !fs.existsSync(legacyPath)) {
		runInit({ command: 'init', targetPath: projectRoot });
	}

	const editPath = fs.existsSync(localPath) ? localPath : legacyPath;
	process.stdout.write(`Edit: ${editPath}\n`);
	openEditor(editPath);
}

function runUpdate(parsed: UpdateCommand): void {
	if (parsed.all) {
		runUpdateAll(parsed.targetPath);
		return;
	}

	const projectRoot = findProjectRoot(parsed.targetPath);
	verbose(`update target=${parsed.targetPath} projectRoot=${projectRoot}`);
	if (isIgnoredDir(projectRoot)) {
		process.stdout.write(`SKIP ignored ${projectRoot}\n`);
		return;
	}

	const profile = resolveProfile(projectRoot);
	const configRoot = defaultConfigRoot(projectRoot);
	const agentDir = resolveAgentDir(projectRoot);
	ensureConfigRootLayout(configRoot);
	ensureConfigRootGitignore(configRoot);
	ensureDefaultGlobalTemplates(configRoot);
	fs.mkdirSync(agentDir, { recursive: true });
	ensureProfileOverridesDir(agentDir);
	convertLegacyProfileIfNeeded(configRoot, agentDir, profile);
	createDefaultManifestFile(agentDir, profile);
	createDefaultLocalFile(agentDir, profile);

	const rendered = syncAgentProfile(projectRoot, agentDir);
	printUpdateSummary(rendered);
}

function runUpdateAll(targetPath: string): void {
	const configRoot = targetPath === path.resolve(process.cwd()) ? defaultConfigRoot() : path.resolve(targetPath);
	verbose(`update --all configRoot=${configRoot}`);
	if (!fs.existsSync(configRoot)) {
		fail(`missing config root: ${configRoot}`);
	}
	ensureConfigRootLayout(configRoot);
	ensureConfigRootGitignore(configRoot);
	ensureDefaultGlobalTemplates(configRoot);

	const profileDirs = findProfileDirs(configRoot);
	let updated = 0;
	for (const agentDir of profileDirs) {
		const profile = path.relative(configRoot, agentDir).replace(/\\/g, '/');
		const projectRoot = projectRootForProfile(profile, configRoot);
		verbose(`update --all profile=${profile} syntheticProjectRoot=${projectRoot}`);
		ensureProfileOverridesDir(agentDir);
		convertLegacyProfileIfNeeded(configRoot, agentDir, profile);
		createDefaultManifestFile(agentDir, profile);
		createDefaultLocalFile(agentDir, profile);
		syncAgentProfile(projectRoot, agentDir, { configRoot, profile });
		process.stdout.write(`OK ${profile}\n`);
		updated += 1;
	}

	process.stdout.write(`Updated profiles: ${updated}\n`);
}

function runMigrateConfig(parsed: MigrateConfigCommand): void {
	const configRoot = parsed.configRoot;
	verbose(`migrate config root=${configRoot}`);
	if (!fs.existsSync(configRoot)) {
		fail(`missing config root: ${configRoot}`);
	}
	ensureConfigRootLayout(configRoot);
	ensureConfigRootGitignore(configRoot);
	migrateOldTemplates(configRoot);
	ensureDefaultGlobalTemplates(configRoot);

	const profileDirs = findLegacyProfileDirs(configRoot);
	let createdManifestCount = 0;
	let createdLocalCount = 0;
	let createdOverridesCount = 0;
	let movedRuntimeCount = 0;
	let movedReviewCount = 0;
	let movedMemoryCount = 0;

	for (const agentDir of profileDirs) {
		const profile = path.relative(configRoot, agentDir).replace(/\\/g, '/');
		const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
		if (!fs.existsSync(localPath)) {
			const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
			fs.writeFileSync(localPath, convertLegacyTemplateVars(fs.readFileSync(legacyPath, 'utf8')), 'utf8');
			createdLocalCount += 1;
		}
		const manifestPath = path.join(agentDir, MANIFEST_FILE_NAME);
		if (!fs.existsSync(manifestPath)) {
			createDefaultManifestFile(agentDir, profile);
			createdManifestCount += 1;
		}
		const overridesDir = path.join(agentDir, 'overrides');
		if (!fs.existsSync(overridesDir)) {
			fs.mkdirSync(overridesDir, { recursive: true });
			createdOverridesCount += 1;
		}
		movedRuntimeCount += migrateCodexRuntimeFiles(agentDir);
		movedReviewCount += migrateLooseFiles(agentDir, /^REVIEW(?:-.+)?\.md$/, 'reviews');
		movedMemoryCount += migrateLooseFiles(agentDir, /^memory.*\.md$/i, 'memories');
	}

	process.stdout.write(`OK migrated ${configRoot}\n`);
	process.stdout.write(`Profiles converted: ${profileDirs.length}\n`);
	process.stdout.write(`Created local.md.njk: ${createdLocalCount}\n`);
	process.stdout.write(`Created agent-run.jsonc: ${createdManifestCount}\n`);
	process.stdout.write(`Created overrides dirs: ${createdOverridesCount}\n`);
	process.stdout.write(`Moved Codex runtime entries: ${movedRuntimeCount}\n`);
	process.stdout.write(`Moved review files: ${movedReviewCount}\n`);
	process.stdout.write(`Moved memory files: ${movedMemoryCount}\n`);
}

function runCheck(parsed: CheckCommand): void {
	if (parsed.all) {
		verbose(`check --all root=${parsed.targetPath}`);
		const report = checkSourceTree(parsed.targetPath);
		printBatchReport(report.root, report.entries);
		process.exit(report.hasErrors ? 1 : 0);
	}

	const projectRoot = findProjectRoot(parsed.targetPath);
	verbose(`check target=${parsed.targetPath} projectRoot=${projectRoot}`);
	if (isIgnoredDir(projectRoot)) {
		process.stdout.write(`Check: ${projectRoot}\n`);
		process.stdout.write('SKIP ignored by .agent-run-ignore\n');
		process.exit(0);
	}

	const findings = checkProject(projectRoot);
	printProjectReport(projectRoot, findings);
	process.exit(hasErrors(findings) ? 1 : 0);
}

function printUpdateSummary(rendered: RenderedProfile): void {
	process.stdout.write(`OK profile ${rendered.profile}\n`);
	process.stdout.write(`Profile dir: ${rendered.agentDir}\n`);
	process.stdout.write(`Live dir: ${rendered.context.paths.liveDir}\n`);
	process.stdout.write(`Generated files: ${rendered.files.length}\n`);
	process.stdout.write(`Installed skills: ${rendered.skills.map((skill) => skill.name).join(', ') || '(none)'}\n`);
}

function ensureConfigRootLayout(configRoot: string): void {
	fs.mkdirSync(configRoot, { recursive: true });
}

function ensureConfigRootGitignore(configRoot: string): void {
	fs.mkdirSync(configRoot, { recursive: true });
	const gitignorePath = path.join(configRoot, '.gitignore');
	const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8').replace(/\r\n/g, '\n') : '';
	const lines = existing.length > 0 ? existing.replace(/\n+$/, '').split('\n') : [];
	const present = new Set(lines);
	let changed = !fs.existsSync(gitignorePath);
	for (const entry of GENERATED_GITIGNORE_ENTRIES) {
		if (entry === '' || present.has(entry)) {
			continue;
		}
		lines.push(entry);
		present.add(entry);
		changed = true;
	}
	if (!changed) {
		return;
	}
	fs.writeFileSync(gitignorePath, `${lines.join('\n')}\n`, 'utf8');
}

function ensureDefaultGlobalTemplates(configRoot: string): void {
	const defaults = new Map<string, string>([
		['global/agents/code.md.njk', defaultCodeAgentTemplate()],
		['global/agents/writing.md.njk', defaultWritingAgentTemplate()],
		['global/snippets/git-rules.md.njk', defaultGitRulesSnippet()],
		['global/snippets/no-ai-files.md.njk', defaultNoAiFilesSnippet()],
		['global/snippets/verification.md.njk', defaultVerificationSnippet()],
		['global/tool-templates/codex-config.toml.njk', defaultCodexConfigTemplate()],
		['global/tool-templates/claude-settings.json.njk', defaultClaudeSettingsTemplate()],
		['global/skills/commit-workflow/SKILL.md.njk', defaultCommitWorkflowSkill()],
		['global/skills/github-release/SKILL.md.njk', defaultGithubReleaseSkill()],
		['global/skills/release-package-check/SKILL.md.njk', defaultReleasePackageCheckSkill()],
		['global/skills/code-review-organizer/SKILL.md.njk', defaultCodeReviewOrganizerSkill()]
	]);

	for (const [relativePath, content] of defaults) {
		const filePath = path.join(configRoot, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, content, 'utf8');
			verbose(`created ${filePath}`);
		}
	}
}

function migrateOldTemplates(configRoot: string): void {
	const oldCodeTemplate = path.join(configRoot, 'templates', 'AGENTS-CODE.md');
	const newCodeTemplate = path.join(configRoot, 'global', 'agents', 'code.md.njk');
	if (fs.existsSync(oldCodeTemplate) && !fs.existsSync(newCodeTemplate)) {
		fs.mkdirSync(path.dirname(newCodeTemplate), { recursive: true });
		fs.writeFileSync(
			newCodeTemplate,
			convertLegacyTemplateVars(fs.readFileSync(oldCodeTemplate, 'utf8')),
			'utf8'
		);
	}
}

function findLegacyProfileDirs(configRoot: string): string[] {
	const dirs: string[] = [];
	walkConfigTree(configRoot, 0, (fullPath, entry) => {
		if (!entry.isDirectory()) {
			return undefined;
		}
		if (shouldPruneConfigEntry(entry)) {
			return 'skip';
		}
		if (fs.existsSync(path.join(fullPath, 'AGENTS-MODS.md'))) {
			dirs.push(fullPath);
			return 'skip';
		}
		return undefined;
	});
	return dirs.sort();
}

function findProfileDirs(configRoot: string): string[] {
	const dirs: string[] = [];
	walkConfigTree(configRoot, 0, (fullPath, entry) => {
		if (!entry.isDirectory()) {
			return undefined;
		}
		if (shouldPruneConfigEntry(entry)) {
			return 'skip';
		}
		if (fs.existsSync(path.join(fullPath, MANIFEST_FILE_NAME)) || fs.existsSync(path.join(fullPath, LOCAL_TEMPLATE_FILE_NAME))) {
			dirs.push(fullPath);
			return 'skip';
		}
		return undefined;
	});
	return dirs.sort();
}

function walkConfigTree(
	dir: string,
	depth: number,
	visitor: (fullPath: string, entry: fs.Dirent, depth: number) => WalkVisitorResult
): void {
	const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const result = visitor(fullPath, entry, depth + 1);
		if (entry.isDirectory() && result !== 'skip') {
			walkConfigTree(fullPath, depth + 1, visitor);
		}
	}
}

function shouldPruneConfigEntry(entry: fs.Dirent): boolean {
	return (
		entry.isDirectory() &&
		(entry.name === '.git' ||
			entry.name === 'global' ||
			entry.name === 'templates' ||
			entry.name === '.agents' ||
			entry.name === '.claude' ||
			entry.name === '.codex' ||
			entry.name === 'bin' ||
			entry.name === 'reviews' ||
			entry.name === 'memories' ||
			entry.name === 'cache' ||
			entry.name === 'log' ||
			entry.name === 'sessions' ||
			entry.name === 'shell_snapshots' ||
			entry.name === 'skills' ||
			entry.name === 'tmp' ||
			entry.name === '.tmp')
	);
}

function convertLegacyTemplateVars(content: string): string {
	const replacements = new Map<string, string>([
		['{{AGENT_DIR}}', '{{ agentDir }}'],
		['{{AGENTS_MODS_PATH}}', '{{ agentDir }}/AGENTS-MODS.md'],
		['{{AGENTS_PATH}}', '{{ agentDir }}/AGENTS.md'],
		['{{CLAUDE_PATH}}', '{{ agentDir }}/CLAUDE.md'],
		['{{CONFIG_ROOT}}', '{{ configRoot }}'],
		['{{PROFILE}}', '{{ profile }}']
	]);
	let converted = content;
	for (const [from, to] of replacements) {
		converted = converted.split(from).join(to);
	}
	return converted
		.replace(/^@[^\n]*templates\/AGENTS-CODE\.md[^\n]*\n?/gm, '')
		.replace(/^\n{2,}/, '\n');
}

function migrateCodexRuntimeFiles(agentDir: string): number {
	const runtimeNames = fs
		.readdirSync(agentDir)
		.filter((name) =>
			/^(?:\.personality_migration|\.tmp|auth\.json|cache|history\.jsonl|installation_id|log|logs|models_cache\.json|sessions|archived_sessions|shell_snapshots|skills|tmp|version\.json)$/.test(
				name
			) || /^(?:logs|state)_.*\.sqlite(?:-.+)?$/.test(name)
		);
	const codexHome = path.join(agentDir, LIVE_DIR_NAME, 'memories', 'codex-home');
	let moved = 0;
	for (const name of runtimeNames) {
		const source = path.join(agentDir, name);
		if (!fs.existsSync(source) && !isSymlink(source)) {
			continue;
		}
		let target = path.join(codexHome, name);
		if (fs.existsSync(target) || isSymlink(target)) {
			target = nextBackupPath(target);
		}
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.renameSync(source, target);
		moved += 1;
	}
	return moved;
}

function migrateLooseFiles(agentDir: string, pattern: RegExp, targetDirName: string): number {
	const entries = fs.readdirSync(agentDir, { withFileTypes: true });
	let moved = 0;
	for (const entry of entries) {
		if (!entry.isFile() || !pattern.test(entry.name)) {
			continue;
		}
		const source = path.join(agentDir, entry.name);
		const targetDir = path.join(agentDir, targetDirName);
		const target = path.join(targetDir, entry.name);
		if (fs.existsSync(target)) {
			continue;
		}
		fs.mkdirSync(targetDir, { recursive: true });
		fs.renameSync(source, target);
		moved += 1;
	}
	return moved;
}

function convertLegacyProfileIfNeeded(_configRoot: string, agentDir: string, _profile: string): void {
	const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
	const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
	if (fs.existsSync(legacyPath) && !fs.existsSync(localPath)) {
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(localPath, fs.readFileSync(legacyPath, 'utf8'), 'utf8');
		verbose(`converted ${legacyPath} -> ${localPath}`);
	}
}

function createDefaultManifestFile(agentDir: string, profile: string): void {
	const manifestPath = path.join(agentDir, MANIFEST_FILE_NAME);
	if (fs.existsSync(manifestPath)) {
		return;
	}
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(manifestPath, stringifyDefaultManifest(profile), 'utf8');
	verbose(`created ${manifestPath}`);
}

function createDefaultLocalFile(agentDir: string, profile: string): void {
	const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
	if (fs.existsSync(localPath)) {
		return;
	}

	const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
	const content = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath, 'utf8') : defaultLocalTemplate(profile);
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(localPath, content, 'utf8');
	verbose(`created ${localPath}`);
}

function ensureProfileOverridesDir(agentDir: string): void {
	fs.mkdirSync(path.join(agentDir, 'overrides'), { recursive: true });
}

function loadManifest(_configRoot: string, agentDir: string, profile: string, trace?: RenderTrace): AgentRunManifest {
	const manifestPath = path.join(agentDir, MANIFEST_FILE_NAME);
	if (!fs.existsSync(manifestPath)) {
		const manifest = defaultManifest(profile);
		const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
		const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
		if (!fs.existsSync(localPath) && fs.existsSync(legacyPath)) {
			manifest.agent = {
				...(manifest.agent ?? {}),
				includes: ['{{ profile }}/AGENTS-MODS.md']
			};
		}
		if (!fs.existsSync(localPath) && !fs.existsSync(legacyPath)) {
			manifest.agent = {
				...(manifest.agent ?? {}),
				includes: []
			};
		}
		return manifest;
	}

	trace?.sourceFiles.add(manifestPath);
	const text = fs.readFileSync(manifestPath, 'utf8');
	const errors: ParseError[] = [];
	const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
	if (errors.length > 0) {
		const first = errors[0];
		const detail = first ? `${printParseErrorCode(first.error)} at offset ${first.offset}` : 'unknown JSONC parse error';
		throw new Error(`invalid JSONC in ${manifestPath}: ${detail}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`manifest must be an object: ${manifestPath}`);
	}
	return parsed as AgentRunManifest;
}

function defaultManifest(profile: string): AgentRunManifest {
	return {
		profile,
		kind: 'code',
		agent: {
			base: 'global/agents/code.md.njk',
			includes: [`{{ profile }}/${LOCAL_TEMPLATE_FILE_NAME}`]
		},
		skills: {
			install: ['commit-workflow', 'github-release', 'release-package-check', 'code-review-organizer']
		},
		tools: {
			codex: true,
			claude: true
		},
		checks: ['agent-run check .', 'pnpm run cleanbuild'],
		guardrails: {
			blockGitWrite: true,
			blockPublish: true,
			blockGithubRelease: true,
			forbidRepoAiFiles: true
		},
		paths: {
			changesFile: '{{ projectRoot }}/CHANGES',
			reviewDir: '{{ profileDir }}/reviews',
			reviewFile: '{{ profileDir }}/reviews/REVIEW-{{ date }}.md',
			memoriesDir: '{{ agentDir }}/memories'
		}
	};
}

function normalizeManifest(manifest: AgentRunManifest, profile: string): NormalizedManifest {
	const baseManifest = defaultManifest(profile);
	const installedSkills = Array.isArray(manifest.skills)
		? manifest.skills
		: manifest.skills?.install ?? asSkillObject(baseManifest.skills).install;
	const overrides = Array.isArray(manifest.skills) ? {} : manifest.skills?.overrides ?? {};
	const reviewDir = normalizeLegacyDefaultReviewPath(
		manifest.paths?.reviewDir ?? baseManifest.paths?.reviewDir ?? '{{ profileDir }}/reviews'
	);
	const reviewFile = normalizeLegacyDefaultReviewPath(
		manifest.paths?.reviewFile ?? baseManifest.paths?.reviewFile ?? '{{ profileDir }}/reviews/REVIEW-{{ date }}.md'
	);

	return {
		profile: manifest.profile ?? profile,
		kind: manifest.kind ?? baseManifest.kind ?? 'code',
		agent: {
			base: manifest.agent?.base ?? baseManifest.agent?.base ?? 'global/agents/code.md.njk',
			includes: manifest.agent?.includes ?? defaultAgentIncludesForProfile(profile)
		},
		skills: {
			install: normalizeInstalledSkills(installedSkills),
			overrides
		},
		tools: {
			codex: manifest.tools?.codex ?? true,
			claude: manifest.tools?.claude ?? true
		},
		checks: manifest.checks ?? baseManifest.checks ?? [],
		guardrails: {
			blockGitWrite: manifest.guardrails?.blockGitWrite ?? true,
			blockPublish: manifest.guardrails?.blockPublish ?? true,
			blockGithubRelease: manifest.guardrails?.blockGithubRelease ?? true,
			forbidRepoAiFiles: manifest.guardrails?.forbidRepoAiFiles ?? true
		},
		paths: {
			changesFile: manifest.paths?.changesFile ?? baseManifest.paths?.changesFile ?? '{{ projectRoot }}/CHANGES',
			reviewDir,
			reviewFile,
			reviewConsolidatedFile:
				manifest.paths?.reviewConsolidatedFile ?? baseManifest.paths?.reviewConsolidatedFile,
			memoriesDir: manifest.paths?.memoriesDir ?? baseManifest.paths?.memoriesDir ?? '{{ agentDir }}/memories'
		}
	};
}

function normalizeSkillName(name: string): string {
	const normalized = name === 'code-review' ? 'code-review-organizer' : name;
	if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
		throw new Error(`invalid skill name: ${name}`);
	}
	return normalized;
}

function normalizeInstalledSkills(names: string[]): string[] {
	return [...new Set(names.map(normalizeSkillName))];
}

function normalizeLegacyDefaultReviewPath(value: string): string {
	if (value === '{{ agentDir }}/reviews') {
		return '{{ profileDir }}/reviews';
	}
	if (value === '{{ agentDir }}/reviews/REVIEW-{{ date }}.md') {
		return '{{ profileDir }}/reviews/REVIEW-{{ date }}.md';
	}
	return value;
}

function asSkillObject(skills: AgentRunManifest['skills']): { install: string[]; overrides: Record<string, string> } {
	if (Array.isArray(skills)) {
		return { install: skills, overrides: {} };
	}
	return {
		install: skills?.install ?? [],
		overrides: skills?.overrides ?? {}
	};
}

function defaultAgentIncludesForProfile(profile: string): string[] {
	return [`{{ profile }}/${LOCAL_TEMPLATE_FILE_NAME}`, `{{ profile }}/AGENTS-MODS.md`];
}

function createNunjucksEnv(configRoot: string): nunjucks.Environment {
	const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(configRoot, { noCache: true }), {
		autoescape: false,
		trimBlocks: true,
		lstripBlocks: true,
		throwOnUndefined: true
	});
	return env;
}

function buildRenderContext(
	projectRoot: string,
	profileDir: string,
	configRoot: string,
	manifest: NormalizedManifest,
	env: nunjucks.Environment
): RenderContext {
	const date = localDateString();
	const liveDir = path.join(profileDir, LIVE_DIR_NAME);
	const baseContext = {
		profile: manifest.profile,
		kind: manifest.kind,
		projectRoot,
		agentDir: liveDir,
		profileDir,
		configRoot,
		date,
		checks: manifest.checks,
		tools: manifest.tools,
		guardrails: manifest.guardrails
	};
	const reviewDir = resolveRuntimePath(configRoot, manifest.paths.reviewDir, env, baseContext);
	const memoriesDir = resolveRuntimePath(configRoot, manifest.paths.memoriesDir, env, baseContext);
	const codexHomeDir = path.join(memoriesDir, 'codex-home');
	const paths = {
		profileDir,
		liveDir,
		changesFile: resolveRuntimePath(configRoot, manifest.paths.changesFile, env, baseContext),
		reviewDir,
		reviewFile: resolveRuntimePath(configRoot, manifest.paths.reviewFile, env, baseContext),
		reviewConsolidatedFile: manifest.paths.reviewConsolidatedFile
			? resolveRuntimePath(configRoot, manifest.paths.reviewConsolidatedFile, env, baseContext)
			: path.join(reviewDir, 'REVIEW.md'),
		memoriesDir,
		globalMemoryDir: globalMemoryDir(configRoot),
		codexHomeDir,
		overridesDir: path.join(profileDir, 'overrides'),
		codexSkillsDir: path.join(codexHomeDir, 'skills'),
		claudeSkillsDir: path.join(liveDir, '.claude', 'skills'),
		binDir: path.join(liveDir, 'bin')
	};

	return {
		...baseContext,
		paths,
		permissionsAllow: buildPermissionsAllow(manifest),
		skills: [],
		renderedAgentSections: []
	};
}

function buildPermissionsAllow(manifest: NormalizedManifest): string[] {
	const allow = new Set<string>();
	for (const check of manifest.checks) {
		const normalizedCheck = check.trim();
		if (normalizedCheck) {
			allow.add(`Bash(${normalizedCheck})`);
		}
	}
	return [...allow];
}

function resolveConfigPath(configRoot: string, relativePath: string, context: Record<string, unknown>): string {
	const env = createNunjucksEnv(configRoot);
	const rendered = renderInlineTemplate(env, relativePath, context);
	const resolved = path.resolve(configRoot, rendered);
	if (!isSamePathOrDescendant(resolved, path.resolve(configRoot))) {
		throw new Error(`config path escapes config root: ${relativePath}`);
	}
	return resolved;
}

function resolveRuntimePath(
	configRoot: string,
	pathTemplate: string,
	env: nunjucks.Environment,
	context: Record<string, unknown>
): string {
	const rendered = renderInlineTemplate(env, pathTemplate, context);
	return path.isAbsolute(rendered) ? path.resolve(rendered) : path.resolve(configRoot, rendered);
}

function renderTemplateFile(
	env: nunjucks.Environment,
	configRoot: string,
	templatePath: string,
	context: object,
	trace?: RenderTrace
): string {
	const resolvedPath = resolveConfigPath(configRoot, templatePath, context as Record<string, unknown>);
	if (!fs.existsSync(resolvedPath)) {
		throw new Error(`missing template: ${resolvedPath}`);
	}

	const relativePath = path.relative(configRoot, resolvedPath).replace(/\\/g, '/');
	let content = fs.readFileSync(resolvedPath, 'utf8');
	traceTemplateSource(configRoot, resolvedPath, content, context, trace);
	if (path.basename(resolvedPath) === 'AGENTS-MODS.md') {
		content = renderLegacyAgentsMods(resolvedPath, [], trace);
		return renderInlineTemplate(env, content, context);
	}
	return env.render(relativePath, context);
}

function traceTemplateSource(
	configRoot: string,
	sourcePath: string,
	content: string,
	context: object,
	trace?: RenderTrace,
	stack: string[] = []
): void {
	if (trace === undefined) {
		return;
	}
	const resolvedSource = path.resolve(sourcePath);
	trace.sourceFiles.add(resolvedSource);
	if (stack.includes(resolvedSource)) {
		return;
	}
	const nextStack = [...stack, resolvedSource];
	const includeRe = /{%\s*(?:include|extends|import)\s+["']([^"']+)["']|{%\s*from\s+["']([^"']+)["']/g;
	for (;;) {
		const match = includeRe.exec(content);
		if (match === null) {
			break;
		}
		const includePath = match[1] ?? match[2];
		if (!includePath) {
			continue;
		}
		const includedPath = resolveConfigPath(configRoot, includePath, context as Record<string, unknown>);
		if (!fs.existsSync(includedPath)) {
			continue;
		}
		const includedContent = fs.readFileSync(includedPath, 'utf8');
		traceTemplateSource(configRoot, includedPath, includedContent, context, trace, nextStack);
	}
}

function renderInlineTemplate(env: nunjucks.Environment, source: string, context: object): string {
	return env.renderString(source, context);
}

function assertNoUnexpandedTemplateVars(label: string, content: string): void {
	if (UNEXPANDED_TEMPLATE_RE.test(content)) {
		throw new Error(`unexpanded template syntax remains in ${label}`);
	}
}

function writeGeneratedFile(filePath: string, content: string, executable = false): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, 'utf8');
	if (executable && !IS_WINDOWS) {
		fs.chmodSync(filePath, 0o755);
	}
	verbose(`write ${filePath}`);
}

function starterConfigRootPath(): string {
	return path.resolve(__dirname, '..', 'examples', 'basic-config', 'agent-config');
}

function copySkeletonTree(sourceDir: string, targetDir: string): void {
	fs.mkdirSync(targetDir, { recursive: true });
	const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetName = entry.name === 'gitignore' ? '.gitignore' : entry.name;
		const targetPath = path.join(targetDir, targetName);
		if (entry.isDirectory()) {
			copySkeletonTree(sourcePath, targetPath);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		if (fs.existsSync(targetPath)) {
			continue;
		}
		fs.mkdirSync(path.dirname(targetPath), { recursive: true });
		fs.copyFileSync(sourcePath, targetPath);
	}
}

function renderProfile(
	projectRoot: string,
	agentDir: string,
	checkOnly = false,
	targetTool: ToolName | null = null,
	trace?: RenderTrace,
	options?: { configRoot?: string; profile?: string }
): RenderedProfile {
	const configRoot = options?.configRoot ?? defaultConfigRoot(projectRoot);
	const profile = options?.profile ?? resolveProfile(projectRoot);
	const env = createNunjucksEnv(configRoot);
	const manifest = normalizeManifest(loadManifest(configRoot, agentDir, profile, trace), profile);
	if (manifest.profile !== profile) {
		const parsed = parseProfile(manifest.profile, `${path.join(agentDir, MANIFEST_FILE_NAME)} profile`);
		if (parsed.profile === null) {
			throw new Error(parsed.reason);
		}
	}

	if (!checkOnly) {
		ensureConfigRootGitignore(configRoot);
	}

	const context = buildRenderContext(projectRoot, agentDir, configRoot, manifest, env);
	const sections = [renderTemplateFile(env, configRoot, manifest.agent.base, context, trace)];
	for (const include of manifest.agent.includes) {
		const includePath = resolveConfigPath(configRoot, include, context as unknown as Record<string, unknown>);
		if (!fs.existsSync(includePath)) {
			if (include.includes('AGENTS-MODS.md') || include.includes(LOCAL_TEMPLATE_FILE_NAME)) {
				continue;
			}
			throw new Error(`missing template: ${includePath}`);
		}
		sections.push(renderTemplateFile(env, configRoot, include, context, trace));
	}
	context.renderedAgentSections = sections.map((section, index) => {
		const label = index === 0 ? manifest.agent.base : manifest.agent.includes[index - 1] ?? `section ${index}`;
		assertNoUnexpandedTemplateVars(label, section);
		return section.trimEnd();
	});

	context.skills = renderSkills(env, configRoot, manifest, context, trace);

	const files: RenderedProfile['files'] = [];
	if (context.tools.codex && (targetTool === null || targetTool === 'codex')) {
		const agentsContent = renderToolInstructions('AGENTS.md', env, configRoot, context, false, trace);
		files.push({ path: path.join(context.paths.codexHomeDir, 'AGENTS.md'), content: agentsContent });
		files.push({ path: path.join(context.paths.codexHomeDir, 'config.toml'), content: renderCodexConfig(env, configRoot, context, trace) });
		files.push(...renderNativeSkillFiles(context, 'codex'));
	}
	if (context.tools.claude && (targetTool === null || targetTool === 'claude')) {
		const claudeContent = renderToolInstructions('CLAUDE.md', env, configRoot, context, true, trace);
		files.push({ path: path.join(context.paths.liveDir, 'CLAUDE.md'), content: claudeContent });
		files.push({
			path: path.join(context.paths.liveDir, '.claude', 'agent-run-settings.json'),
			content: renderClaudeSettings(env, configRoot, context, trace)
		});
		files.push({
			path: path.join(context.paths.liveDir, '.claude', '.claude-plugin', 'plugin.json'),
			content: claudePluginManifestContent(context)
		});
		files.push(...renderNativeSkillFiles(context, 'claude'));
	}
	files.push(...renderGuardShims(context));

	return {
		agentDir,
		configRoot,
		profile,
		context,
		files,
		skills: context.skills
	};
}

function syncAgentProfile(
	projectRoot: string,
	agentDir: string,
	options?: { configRoot?: string; profile?: string }
): RenderedProfile {
	const rendered = renderProfile(projectRoot, agentDir, false, null, undefined, options);
	syncRuntimeDirs(rendered.context);
	removeStaleGeneratedEntries(rendered);
	for (const file of rendered.files) {
		writeGeneratedFile(file.path, file.content, file.executable ?? false);
	}
	removeLegacyGeneratedCodexFiles(rendered.context);
	removeLegacyGeneratedClaudeSettings(rendered.context);
	return rendered;
}

function removeStaleGeneratedEntries(rendered: RenderedProfile): void {
	const expectedFiles = new Set(rendered.files.map((file) => path.resolve(file.path)));
	for (const filePath of [
		path.join(rendered.context.paths.codexHomeDir, 'AGENTS.md'),
		path.join(rendered.context.paths.codexHomeDir, 'config.toml'),
		path.join(rendered.context.paths.liveDir, 'CLAUDE.md'),
		path.join(rendered.context.paths.liveDir, '.claude', 'CLAUDE.md'),
		path.join(rendered.context.paths.liveDir, '.claude', 'agent-run-settings.json'),
		path.join(rendered.context.paths.liveDir, '.claude', '.claude-plugin', 'plugin.json')
	]) {
		if (!expectedFiles.has(path.resolve(filePath))) {
			fs.rmSync(filePath, { force: true });
		}
	}
	for (const name of ['git', 'git.cmd', 'npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'gh', 'gh.cmd']) {
		const filePath = path.join(rendered.context.paths.binDir, name);
		if (!expectedFiles.has(path.resolve(filePath))) {
			fs.rmSync(filePath, { force: true });
		}
	}

	const skillNames = new Set(rendered.skills.map((skill) => skill.name));
	removeStaleGeneratedSkills(
		rendered.context.paths.codexSkillsDir,
		rendered.context.tools.codex ? skillNames : new Set<string>(),
		new Set(['.system'])
	);
	removeStaleGeneratedSkills(
		rendered.context.paths.claudeSkillsDir,
		rendered.context.tools.claude ? skillNames : new Set<string>()
	);
}

function removeStaleGeneratedSkills(dir: string, expectedNames: Set<string>, preservedNames = new Set<string>()): void {
	if (!fs.existsSync(dir)) {
		return;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (expectedNames.has(entry.name) || preservedNames.has(entry.name)) {
			continue;
		}
		fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
	}
}

function removeLegacyGeneratedCodexFiles(context: RenderContext): void {
	for (const legacyPath of [
		path.join(context.paths.liveDir, 'AGENTS.md'),
		path.join(context.paths.liveDir, 'config.toml')
	]) {
		if (!fs.existsSync(legacyPath)) {
			continue;
		}
		fs.rmSync(legacyPath);
		verbose(`removed legacy generated Codex file ${legacyPath}`);
	}
}

function removeLegacyGeneratedClaudeSettings(context: RenderContext): void {
	for (const legacyPath of [
		path.join(context.paths.liveDir, '.claude', 'settings.json'),
		path.join(context.profileDir, '.claude', 'settings.json')
	]) {
		if (!fs.existsSync(legacyPath)) {
			continue;
		}
		const actual = fs.readFileSync(legacyPath, 'utf8').replace(/\r\n/g, '\n');
		const legacyGeneratedContents = [
			legacyDefaultClaudeSettingsContent(context, context.agentDir),
			legacyDefaultClaudeSettingsContent(context, context.profileDir)
		];
		if (legacyGeneratedContents.includes(actual)) {
			fs.rmSync(legacyPath);
			verbose(`removed legacy generated Claude settings ${legacyPath}`);
		}
	}
}

function checkRenderedProfile(projectRoot: string, agentDir: string): Finding[] {
	const findings: Finding[] = [];
	const configRoot = defaultConfigRoot(projectRoot);

	try {
		const rendered = renderProfile(projectRoot, agentDir, true);
		for (const file of rendered.files) {
			if (!fs.existsSync(file.path)) {
				findings.push({ message: `missing generated file: ${file.path}`, severity: 'ERROR' });
				continue;
			}
			const actual = fs.readFileSync(file.path, 'utf8').replace(/\r\n/g, '\n');
			if (actual !== file.content) {
				findings.push({ message: `generated file is out of date: ${file.path}`, severity: 'ERROR' });
			}
		}
		for (const dir of [
			rendered.context.paths.reviewDir,
			rendered.context.paths.memoriesDir,
			rendered.context.paths.codexHomeDir,
			rendered.context.paths.liveDir,
			rendered.context.paths.overridesDir,
			rendered.context.paths.codexSkillsDir,
			rendered.context.paths.claudeSkillsDir,
			rendered.context.paths.binDir
		]) {
			if (!fs.existsSync(dir)) {
				findings.push({ message: `missing generated runtime directory: ${dir}`, severity: 'ERROR' });
			}
		}
		for (const skill of rendered.skills) {
			validateRenderedSkill(skill.renderedContent, skill.sourcePath);
		}
	} catch (error) {
		findings.push({
			message: `failed to render profile ${agentDir}: ${formatError(error)}`,
			severity: 'ERROR'
		});
	}

	const gitignorePath = path.join(configRoot, '.gitignore');
	if (!fs.existsSync(gitignorePath)) {
		findings.push({ message: `missing config root .gitignore: ${gitignorePath}`, severity: 'ERROR' });
	} else {
		const gitignore = fs.readFileSync(gitignorePath, 'utf8');
		for (const entry of GENERATED_GITIGNORE_ENTRIES) {
			if (entry && entry.startsWith('#') === false && !gitignore.includes(entry)) {
				findings.push({ message: `config root .gitignore missing entry: ${entry}`, severity: 'ERROR' });
			}
		}
	}

	return findings;
}

function renderSkills(
	env: nunjucks.Environment,
	configRoot: string,
	manifest: NormalizedManifest,
	context: RenderContext,
	trace?: RenderTrace
): RenderContext['skills'] {
	const skills: RenderContext['skills'] = [];
	for (const name of manifest.skills.install) {
		const sourceTemplate = manifest.skills.overrides[name] ?? `global/skills/${name}/SKILL.md.njk`;
		const sourcePath = resolveConfigPath(configRoot, sourceTemplate, context as unknown as Record<string, unknown>);
		if (!fs.existsSync(sourcePath)) {
			throw new Error(`missing skill template for ${name}: ${sourcePath}`);
		}
		const renderedContent = renderTemplateFile(env, configRoot, sourceTemplate, context, trace);
		assertNoUnexpandedTemplateVars(`skill ${name}`, renderedContent);
		validateRenderedSkill(renderedContent, sourcePath);
		const description = extractSkillDescription(renderedContent);
		skills.push({ name, sourcePath, renderedContent, description });
	}
	return skills;
}

function renderNativeSkillFiles(context: RenderContext, targetTool: ToolName | null = null): RenderedProfile['files'] {
	const files: RenderedProfile['files'] = [];
	for (const skill of context.skills) {
		if (targetTool === null || targetTool === 'codex') {
			files.push({
				path: path.join(context.paths.codexSkillsDir, skill.name, 'SKILL.md'),
				content: skill.renderedContent
			});
		}
		if (targetTool === null || targetTool === 'claude') {
			files.push({
				path: path.join(context.paths.claudeSkillsDir, skill.name, 'SKILL.md'),
				content: skill.renderedContent
			});
		}
	}
	return files;
}

function renderToolInstructions(
	templateName: 'AGENTS.md' | 'CLAUDE.md',
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	isClaude: boolean,
	trace?: RenderTrace
): string {
	const templatePath = `global/tool-templates/${templateName}.njk`;
	const absoluteTemplate = path.join(configRoot, templatePath);
	const content = fs.existsSync(absoluteTemplate)
		? renderTemplateFile(env, configRoot, templatePath, context, trace)
		: renderInlineTemplate(env, defaultToolInstructionsTemplate(isClaude), context);
	assertNoUnexpandedTemplateVars(templateName, content);
	return content.replace(/\n*$/, '\n');
}

function renderCodexConfig(env: nunjucks.Environment, configRoot: string, context: RenderContext, trace?: RenderTrace): string {
	const templatePath = resolveProfileOverrideTemplate(
		configRoot,
		context,
		'codex-config.toml.njk',
		'global/tool-templates/codex-config.toml.njk'
	);
	const content = templatePath !== null
		? renderTemplateFile(env, configRoot, templatePath, context, trace)
		: defaultCodexConfigContent(context);
	assertNoUnexpandedTemplateVars('config.toml', content);
	return content.replace(/\n*$/, '\n');
}

function renderClaudeSettings(env: nunjucks.Environment, configRoot: string, context: RenderContext, trace?: RenderTrace): string {
	const templatePath = resolveProfileOverrideTemplate(
		configRoot,
		context,
		'claude-settings.json.njk',
		'global/tool-templates/claude-settings.json.njk'
	);
	const content = templatePath !== null
		? renderTemplateFile(env, configRoot, templatePath, context, trace)
		: defaultClaudeSettingsContent(context);
	assertNoUnexpandedTemplateVars('claude settings.json', content);
	try {
		JSON.parse(content);
	} catch (error) {
		throw new Error(`invalid generated Claude settings JSON: ${formatError(error)}`);
	}
	return content.replace(/\n*$/, '\n');
}

function claudePluginManifestContent(context: RenderContext): string {
	return `${JSON.stringify(
			{
				name: 'agent-run-profile',
				description: `Generated skills for agent-run profile ${context.profile}`,
				version: '1.0.0',
				author: {
					name: 'Technomoron'
				}
			},
		null,
		2
	)}\n`;
}

function resolveProfileOverrideTemplate(
	configRoot: string,
	context: RenderContext,
	overrideFileName: string,
	globalTemplatePath: string
): string | null {
	const overridePath = `${context.profile}/overrides/${overrideFileName}`;
	if (fs.existsSync(path.join(configRoot, overridePath))) {
		return overridePath;
	}
	if (fs.existsSync(path.join(configRoot, globalTemplatePath))) {
		return globalTemplatePath;
	}
	return null;
}

function renderGuardShims(context: RenderContext): RenderedProfile['files'] {
	const names: string[] = [];
	if (context.guardrails.blockGitWrite) {
		names.push('git');
	}
	if (context.guardrails.blockPublish) {
		names.push('npm', 'pnpm');
	}
	if (context.guardrails.blockGithubRelease) {
		names.push('gh');
	}
	if (IS_WINDOWS) {
		return names.map((name) => ({
			path: path.join(context.paths.binDir, `${name}.cmd`),
			content: windowsShim(name)
		}));
	}

	return names.map((name) => ({
		path: path.join(context.paths.binDir, name),
		content:
			name === 'git'
				? posixGitShim()
				: name === 'gh'
					? posixGhShim()
					: posixPublishShim(name as 'npm' | 'pnpm'),
		executable: true
	}));
}

function syncRuntimeDirs(context: RenderContext): void {
	for (const dir of [
		context.paths.reviewDir,
		context.paths.memoriesDir,
		context.paths.codexHomeDir,
		context.paths.overridesDir,
		context.paths.codexSkillsDir,
		context.paths.claudeSkillsDir,
		context.paths.binDir,
		path.join(context.paths.liveDir, '.claude')
	]) {
		fs.mkdirSync(dir, { recursive: true });
	}
	migrateLiveReviewFiles(context);
	removeLegacyCodexSkillDirs(context);
	removeLegacyCodeReviewSkillDirs(context);
	ensureSharedCodexAuth(context.paths.codexHomeDir);
}

function ensureSharedCodexAuth(codexHomeDir: string): void {
	const sharedAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
	if (!fs.existsSync(sharedAuthPath)) {
		return;
	}

	const profileAuthPath = path.join(codexHomeDir, 'auth.json');
	if (path.resolve(profileAuthPath) === path.resolve(sharedAuthPath)) {
		return;
	}

	if (fs.existsSync(profileAuthPath) || isSymlink(profileAuthPath)) {
		if (isSymlinkTo(profileAuthPath, sharedAuthPath)) {
			return;
		}
		const backupPath = nextBackupPath(profileAuthPath);
		fs.renameSync(profileAuthPath, backupPath);
		verbose(`backed up profile Codex auth ${profileAuthPath} -> ${backupPath}`);
	}

	fs.mkdirSync(path.dirname(profileAuthPath), { recursive: true });
	try {
		fs.symlinkSync(sharedAuthPath, profileAuthPath);
		verbose(`linked profile Codex auth ${profileAuthPath} -> ${sharedAuthPath}`);
	} catch (error) {
		if (IS_WINDOWS) {
			fs.copyFileSync(sharedAuthPath, profileAuthPath);
			verbose(`copied shared Codex auth ${sharedAuthPath} -> ${profileAuthPath}`);
			return;
		}
		throw error;
	}
}

function isSymlink(filePath: string): boolean {
	try {
		return fs.lstatSync(filePath).isSymbolicLink();
	} catch {
		return false;
	}
}

function isSymlinkTo(filePath: string, targetPath: string): boolean {
	try {
		if (!fs.lstatSync(filePath).isSymbolicLink()) {
			return false;
		}
		const linkTarget = fs.readlinkSync(filePath);
		const resolvedTarget = path.resolve(path.dirname(filePath), linkTarget);
		return path.resolve(resolvedTarget) === path.resolve(targetPath);
	} catch {
		return false;
	}
}

function nextBackupPath(filePath: string): string {
	const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
	let candidate = `${filePath}.bak.${timestamp}`;
	let index = 1;
	while (fs.existsSync(candidate) || isSymlink(candidate)) {
		candidate = `${filePath}.bak.${timestamp}.${index}`;
		index += 1;
	}
	return candidate;
}

function removeLegacyCodexSkillDirs(context: RenderContext): void {
	const legacyCodexDir = path.join(context.paths.liveDir, '.agents');
	if (isSamePathOrDescendant(context.paths.codexSkillsDir, legacyCodexDir)) {
		return;
	}
	fs.rmSync(legacyCodexDir, { recursive: true, force: true });
}

function removeLegacyCodeReviewSkillDirs(context: RenderContext): void {
	if (!context.skills.some((skill) => skill.name === 'code-review-organizer')) {
		return;
	}
	for (const dir of [
		path.join(context.paths.liveDir, '.agents', 'skills', 'code-review'),
		path.join(context.paths.codexSkillsDir, 'code-review'),
		path.join(context.paths.claudeSkillsDir, 'code-review')
	]) {
		if (fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
}

function migrateLiveReviewFiles(context: RenderContext): void {
	const legacyReviewDir = path.join(context.paths.liveDir, 'reviews');
	if (path.resolve(legacyReviewDir) === path.resolve(context.paths.reviewDir) || !fs.existsSync(legacyReviewDir)) {
		return;
	}
	fs.mkdirSync(context.paths.reviewDir, { recursive: true });
	for (const entry of fs.readdirSync(legacyReviewDir, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}
		const sourcePath = path.join(legacyReviewDir, entry.name);
		let targetPath = path.join(context.paths.reviewDir, entry.name);
		if (fs.existsSync(targetPath)) {
			if (filesHaveSameContent(sourcePath, targetPath)) {
				fs.rmSync(sourcePath);
				continue;
			}
			targetPath = nextAvailablePath(context.paths.reviewDir, entry.name);
		}
		moveFile(sourcePath, targetPath);
	}
}

function filesHaveSameContent(leftPath: string, rightPath: string): boolean {
	const left = fs.readFileSync(leftPath);
	const right = fs.readFileSync(rightPath);
	return left.length === right.length && left.equals(right);
}

function nextAvailablePath(dir: string, filename: string): string {
	const parsed = path.parse(filename);
	for (let sequence = 1; ; sequence += 1) {
		const candidate = path.join(dir, `${parsed.name}.${sequence}${parsed.ext}`);
		if (!fs.existsSync(candidate)) {
			return candidate;
		}
	}
}

function moveFile(sourcePath: string, targetPath: string): void {
	try {
		fs.renameSync(sourcePath, targetPath);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== 'EXDEV') {
			throw error;
		}
		fs.copyFileSync(sourcePath, targetPath);
		fs.rmSync(sourcePath);
	}
}

function validateRenderedSkill(content: string, sourcePath: string): void {
	const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(content.replace(/\r\n/g, '\n'));
	if (frontMatter === null) {
		throw new Error(`generated skill missing YAML front matter: ${sourcePath}`);
	}
	const yaml = frontMatter[1] ?? '';
	if (!/^name:\s*\S+/m.test(yaml)) {
		throw new Error(`generated skill missing name: ${sourcePath}`);
	}
	if (!/^description:\s*(?:\S|>\s*$)/m.test(yaml)) {
		throw new Error(`generated skill missing description: ${sourcePath}`);
	}
}

function extractSkillDescription(content: string): string {
	const normalized = content.replace(/\r\n/g, '\n');
	const simple = /^description:\s*['"]?(.+?)['"]?\s*$/m.exec(normalized);
	if (simple?.[1]) {
		return simple[1].trim();
	}
	const folded = /^description:\s*>\s*\n((?:[ \t]+.+\n?)+)/m.exec(normalized);
	if (folded?.[1]) {
		return folded[1]
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.join(' ');
	}
	return '';
}

function renderLegacyAgentsMods(sourceFile: string, stack: string[] = [], trace?: RenderTrace): string {
	const resolvedSource = path.resolve(sourceFile);
	trace?.sourceFiles.add(resolvedSource);
	if (stack.includes(resolvedSource)) {
		throw new Error(`Include cycle detected: ${[...stack, resolvedSource].join(' -> ')}`);
	}

	const lines = fs.readFileSync(resolvedSource, 'utf8').replace(/\r\n/g, '\n').split('\n');
	const output: string[] = [];
	const nextStack = [...stack, resolvedSource];
	let sawLeadingInclude = false;
	let insertedOverrideNote = false;
	let contentStarted = false;
	let fence: { character: string; length: number } | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		const isIndentedCode = /^(?: {4}|\t)/.test(line);
		const fenceMatch = isIndentedCode ? null : /^(`{3,}|~{3,})/.exec(trimmed);

		if (fence !== null) {
			output.push(line);
			contentStarted = true;
			const marker = fenceMatch?.[1];
			if (
				marker !== undefined &&
				marker[0] === fence.character &&
				marker.length >= fence.length &&
				trimmed.slice(marker.length).trim() === ''
			) {
				fence = null;
			}
			continue;
		}

		if (!contentStarted && trimmed === '') {
			continue;
		}
		if (fenceMatch?.[1]) {
			fence = { character: fenceMatch[1][0] ?? '`', length: fenceMatch[1].length };
		}
		if (fence === null && !isIndentedCode && trimmed.startsWith('@')) {
			const includePath = trimmed.slice(1).trim();
			if (!includePath) {
				continue;
			}
			const resolvedInclude = resolveIncludePath(resolvedSource, includePath);
			trace?.sourceFiles.add(resolvedInclude);
			output.push(renderLegacyAgentsMods(resolvedInclude, nextStack, trace));
			if (!contentStarted) {
				sawLeadingInclude = true;
			}
			continue;
		}
		if (sawLeadingInclude && !insertedOverrideNote) {
			output.push('');
			output.push('If anything below this point conflicts with anything included above,');
			output.push('the later instructions below take precedence.');
			output.push('');
			insertedOverrideNote = true;
		}
		output.push(line);
		contentStarted = true;
	}

	return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function resolveIncludePath(sourceFile: string, includePath: string): string {
	if (path.isAbsolute(includePath)) {
		return includePath;
	}
	const sourceRelativePath = path.resolve(path.dirname(sourceFile), includePath);
	if (fs.existsSync(sourceRelativePath)) {
		return sourceRelativePath;
	}
	const includeRoot = findIncludeRoot(sourceFile);
	return path.resolve(includeRoot, includePath.replace(/^(\.\.\/)+/, ''));
}

function findIncludeRoot(sourceFile: string): string {
	let dir = path.dirname(sourceFile);
	for (;;) {
		if (fs.existsSync(path.join(dir, 'global')) || fs.existsSync(path.join(dir, 'templates'))) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return path.dirname(sourceFile);
		}
		dir = parent;
	}
}

function checkProject(projectRoot: string): Finding[] {
	const findings: Finding[] = [];
	verbose(`checking project ${projectRoot}`);
	const profileResult = resolveProfileResult(projectRoot);
	if (profileResult.profile === null) {
		for (const file of findLocalAiFiles(projectRoot, null)) {
			findings.push({ message: `local AI file in project: ${file}`, severity: 'ERROR' });
		}
		findings.push({ message: profileResult.reason, severity: 'ERROR' });
		return findings;
	}

	const agentDir = resolveAgentDir(projectRoot);
	let forbidRepoAiFiles = true;
	try {
		const manifest = normalizeManifest(
			loadManifest(defaultConfigRoot(projectRoot), agentDir, profileResult.profile),
			profileResult.profile
		);
		forbidRepoAiFiles = manifest.guardrails.forbidRepoAiFiles;
	} catch {
		// The profile check below reports malformed or missing source details.
	}
	if (forbidRepoAiFiles) {
		for (const file of findLocalAiFiles(projectRoot, agentDir)) {
			findings.push({ message: `local AI file in project: ${file}`, severity: 'ERROR' });
		}
	}
	findings.push(...checkAgentDirectory(projectRoot, agentDir));
	return findings;
}

function checkAgentDirectory(projectRoot: string, agentDir: string): Finding[] {
	const findings: Finding[] = [];
	const configRoot = defaultConfigRoot(projectRoot);
	const manifestPath = path.join(agentDir, MANIFEST_FILE_NAME);
	const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
	const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);

	if (!fs.existsSync(manifestPath) && !fs.existsSync(legacyPath) && !fs.existsSync(localPath)) {
		findings.push({ message: `missing manifest or legacy/local source file in ${agentDir}`, severity: 'ERROR' });
		return findings;
	}

	for (const relativeTemplate of REQUIRED_GLOBAL_TEMPLATES) {
		if (!fs.existsSync(path.join(configRoot, relativeTemplate))) {
			findings.push({
				message: `missing required global template: ${path.join(configRoot, relativeTemplate)}`,
				severity: 'ERROR'
			});
		}
	}

	findings.push(...checkRenderedProfile(projectRoot, agentDir));
	return findings;
}

function checkSourceTree(rootPath: string): {
	entries: Array<{ findings: Finding[]; label: string }>;
	hasErrors: boolean;
	root: string;
} {
	const sourceRepos = findSourceRepos(rootPath);
	const entries = sourceRepos.map((projectRoot) => ({
		findings: checkProject(projectRoot),
		label: projectRoot
	}));
	return { entries, hasErrors: entries.length === 0 || entries.some((entry) => hasErrors(entry.findings)), root: rootPath };
}

function findSourceRepos(rootPath: string): string[] {
	const resolvedRoot = path.resolve(rootPath);
	const repos = new Set<string>();
	if (isIgnoredDir(resolvedRoot)) {
		return [];
	}
	if (looksLikeRepoRoot(resolvedRoot)) {
		return [resolvedRoot];
	}
	walkSourceTree(resolvedRoot, 0, (fullPath, entry) => {
		if (!entry.isDirectory()) {
			return undefined;
		}
		if (shouldPruneSourceTreeEntry(entry) || isIgnoredDir(fullPath)) {
			return 'skip';
		}
		if (fs.existsSync(path.join(fullPath, '.git'))) {
			repos.add(fullPath);
			return 'skip';
		}
		return undefined;
	});
	return [...repos].sort();
}

function looksLikeRepoRoot(dir: string): boolean {
	return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
}

function shouldPruneSourceTreeEntry(entry: fs.Dirent): boolean {
	return (
		entry.name === 'node_modules' ||
		entry.name === '.pnpm-store' ||
		entry.name === 'dist' ||
		entry.name === 'build'
	);
}

function printProjectReport(projectRoot: string, findings: Finding[]): void {
	process.stdout.write(`Check: ${projectRoot}\n`);
	if (findings.length === 0) {
		process.stdout.write('OK no issues found\n');
		return;
	}
	for (const finding of findings) {
		process.stdout.write(`${finding.severity} ${finding.message}\n`);
	}
	process.stdout.write(`Summary: ${countErrors(findings)} error(s), ${countWarnings(findings)} warning(s)\n`);
}

function printBatchReport(rootPath: string, entries: Array<{ findings: Finding[]; label: string }>): void {
	process.stdout.write(`Check all: ${rootPath}\n`);
	if (entries.length === 0) {
		process.stdout.write('ERROR no source repos found\n');
		return;
	}
	let totalErrors = 0;
	let totalWarnings = 0;
	for (const entry of entries) {
		if (entry.findings.length === 0) {
			process.stdout.write(`OK ${entry.label}\n`);
			continue;
		}
		process.stdout.write(`FAIL ${entry.label}\n`);
		for (const finding of entry.findings) {
			process.stdout.write(`  ${finding.severity} ${finding.message}\n`);
		}
		totalErrors += countErrors(entry.findings);
		totalWarnings += countWarnings(entry.findings);
	}
	process.stdout.write(`Summary: ${totalErrors} error(s), ${totalWarnings} warning(s)\n`);
}

function hasErrors(findings: Finding[]): boolean {
	return findings.some((finding) => finding.severity === 'ERROR');
}

function countErrors(findings: Finding[]): number {
	return findings.filter((finding) => finding.severity === 'ERROR').length;
}

function countWarnings(findings: Finding[]): number {
	return findings.filter((finding) => finding.severity === 'WARN').length;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function runCodex(
	realBinary: string,
	permissionArgs: string[],
	context: RenderContext,
	args: string[],
	wrapperArgs: WrapperArgs
): void {
	const liveDir = context.paths.liveDir;
	const codexHomeDir = context.paths.codexHomeDir;
	const projectRoot = context.projectRoot;
	const agentsPath = path.join(codexHomeDir, 'AGENTS.md');
	if (!fs.existsSync(agentsPath)) {
		failMissingConfig('codex', context.profileDir);
	}

	const guardBin = path.join(liveDir, 'bin');
	const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
	fs.mkdirSync(codexHomeDir, { recursive: true });
	const env: Record<string, string | undefined> = {
		...process.env,
		CODEX_HOME: codexHomeDir,
		AGENT_DIR: liveDir,
		AGENT_PROFILE_DIR: context.profileDir,
		AGENT_RUN_PROJECT_ROOT: projectRoot,
		AGENT_RUN_REAL_PATH: realPath,
		PATH: `${guardBin}${path.delimiter}${realPath}`
	};
	const codexRuntimeArgs = buildCodexRuntimeArgs(wrapperArgs);

	execCommand(
		realBinary,
		[
			...permissionArgs,
			...codexRuntimeArgs,
			'-C',
			projectRoot,
			...(wrapperArgs.codexSandboxMode !== 'danger' && wrapperArgs.codexNetwork
				? ['--config', 'sandbox_workspace_write.network_access=true']
				: []),
			...args
		],
		env,
		codexHomeDir,
		(code) =>
			postflightProjectCheck(
				projectRoot,
				context.profileDir,
				context.guardrails.forbidRepoAiFiles,
				wrapperArgs.local,
				code
			)
	);
}

function buildCodexRuntimeArgs(wrapperArgs: WrapperArgs): string[] {
	if (wrapperArgs.codexSandboxMode === 'danger') {
		return ['-a', 'never', '-s', 'danger-full-access'];
	}
	return ['-a', 'on-request', '-s', 'workspace-write'];
}

function runClaude(
	realBinary: string,
	permissionArgs: string[],
	context: RenderContext,
	args: string[],
	wrapperArgs: WrapperArgs
): void {
	const liveDir = context.paths.liveDir;
	const projectRoot = context.projectRoot;
	const claudePath = path.join(liveDir, 'CLAUDE.md');
	if (!fs.existsSync(claudePath)) {
		failMissingConfig('claude', context.profileDir);
	}

	const guardBin = path.join(liveDir, 'bin');
	const claudeConfigDir = path.join(liveDir, '.claude');
	const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
	const env: Record<string, string | undefined> = {
		...process.env,
		AGENT_DIR: liveDir,
		AGENT_PROFILE_DIR: context.profileDir,
		AGENT_RUN_PROJECT_ROOT: projectRoot,
		AGENT_RUN_REAL_PATH: realPath,
		PATH: `${guardBin}${path.delimiter}${realPath}`
	};

	execCommand(
		realBinary,
		[
			...permissionArgs,
			'--append-system-prompt-file',
			claudePath,
			'--settings',
			path.join(claudeConfigDir, 'agent-run-settings.json'),
			'--plugin-dir',
			claudeConfigDir,
			...args
		],
		env,
		projectRoot,
		(code) =>
			postflightProjectCheck(
				projectRoot,
				context.profileDir,
				context.guardrails.forbidRepoAiFiles,
				wrapperArgs.local,
				code
			)
	);
}

function globalMemoryDir(configRoot: string): string {
	return path.join(configRoot, 'notes', 'memory');
}

function postflightProjectCheck(
	projectRoot: string,
	agentDir: string,
	forbidRepoAiFiles: boolean,
	allowLocal: boolean,
	code: number
): number {
	if (!forbidRepoAiFiles) {
		return code;
	}
	const localAiFiles = findLocalAiFiles(projectRoot, agentDir);
	if (localAiFiles.length > 0) {
		warnForLocalAiFiles(null, projectRoot, localAiFiles);
		if (!allowLocal) {
			return 1;
		}
	}
	return code;
}

function failMissingConfig(tool: ToolName, agentDir: string): never {
	process.stderr.write(`agent-run: no ${tool} config found for this project: ${agentDir}\n`);
	process.stderr.write(
		`agent-run: run \`agent-run ${tool} --none\` to bypass agent setup, or \`agent-run ${tool} --create\` to create profile files.\n`
	);
	process.exit(1);
}

function getPermissionArgs(tool: ToolName): string[] {
	if (process.env.AGENT_WRAPPER_FORCE_PERMISSIVE !== '1') {
		return [];
	}
	if (tool === 'claude' && typeof process.getuid === 'function' && process.getuid() !== 0) {
		return ['--permission-mode', 'bypassPermissions'];
	}
	return [];
}

export function resolveAgentDir(projectRoot: string): string {
	const profile = resolveProfile(projectRoot);
	const configRoot = defaultConfigRoot(projectRoot);
	const agentDir = path.join(configRoot, profile);
	verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
	return agentDir;
}

function findLocalAiFiles(projectRoot: string, excludedDir: string | null = null): string[] {
	const matches: string[] = [];
	if (isIgnoredDir(projectRoot)) {
		return matches;
	}

	const resolvedExcludedDir = excludedDir ? path.resolve(excludedDir) : null;
	walk(projectRoot, (fullPath, entry) => {
		if (resolvedExcludedDir !== null && isSamePathOrDescendant(fullPath, resolvedExcludedDir)) {
			return entry.isDirectory() ? 'skip' : undefined;
		}
		if (isLocalAiDirectory(entry)) {
			matches.push(fullPath);
			return 'skip';
		}
		if (isLocalAiFile(entry)) {
			matches.push(fullPath);
		}
		return undefined;
	});
	return matches.sort();
}

function walkSourceTree(
	dir: string,
	depth: number,
	visitor: (fullPath: string, entry: fs.Dirent, depth: number) => WalkVisitorResult
): void {
	if (isIgnoredDir(dir)) {
		return;
	}
	const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		const result = visitor(fullPath, entry, depth + 1);
		if (entry.isDirectory() && result !== 'skip') {
			walkSourceTree(fullPath, depth + 1, visitor);
		}
	}
}

function walk(dir: string, visitor: WalkVisitor): void {
	if (isIgnoredDir(dir)) {
		return;
	}
	const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (shouldPruneProjectEntry(entry)) {
			continue;
		}
		const fullPath = path.join(dir, entry.name);
		const result = visitor(fullPath, entry);
		if (entry.isDirectory() && result !== 'skip') {
			walk(fullPath, visitor);
		}
	}
}

function isSamePathOrDescendant(candidatePath: string, parentPath: string): boolean {
	const relative = path.relative(parentPath, candidatePath);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function shouldPruneProjectEntry(entry: fs.Dirent): boolean {
	return (
		entry.isDirectory() &&
			(entry.name === '.git' ||
				entry.name === 'node_modules' ||
			entry.name === '.pnpm-store' ||
			entry.name === 'dist' ||
			entry.name === 'build')
	);
}

function isLocalAiDirectory(entry: fs.Dirent): boolean {
	return LOCAL_AI_DIRECTORY_NAMES.has(entry.name);
}

function isLocalAiFile(entry: fs.Dirent): boolean {
	return LOCAL_AI_FILE_NAMES.has(entry.name);
}

function isIgnoredDir(dir: string): boolean {
	if (fs.existsSync(path.join(dir, IGNORE_FILE_NAME))) {
		return true;
	}
	const env = readAgentRunEnv(dir);
	return parseBooleanEnv(env.AGENT_RUN_IGNORE);
}

function warnForLocalAiFiles(tool: ToolName | null, projectRoot: string, localAiFiles: string[]): void {
	process.stderr.write(`WARNING: local AI files found in project root ${projectRoot}\n`);
	for (const file of localAiFiles) {
		process.stderr.write(`WARNING:   ${path.relative(projectRoot, file)}\n`);
	}
	if (tool !== null) {
		process.stderr.write(`WARNING: consider moving these files out of the project, or run \`agent-run ${tool} --none\` to bypass the wrapper.\n`);
	}
}

function failForLocalAiFiles(tool: ToolName, projectRoot: string, localAiFiles: string[]): never {
	process.stderr.write(`agent-run: found local AI files in project root ${projectRoot}\n`);
	for (const file of localAiFiles) {
		process.stderr.write(`agent-run:   ${file}\n`);
	}
	process.stderr.write(
		`agent-run: move these files manually out of the project, run \`agent-run ${tool} --local\` to warn and continue, or run \`agent-run ${tool} --none\` to bypass the wrapper for this invocation.\n`
	);
	process.exit(1);
}

export function findProjectRoot(cwd: string): string {
	let dir = path.resolve(cwd);
	let nearestPackageRoot = '';
	let workspaceRoot = '';
	let gitRoot = '';

	for (;;) {
		const packagePath = path.join(dir, 'package.json');
		if (isWorkspaceRoot(dir)) {
			workspaceRoot = dir;
		}
		if (fs.existsSync(packagePath)) {
			if (!nearestPackageRoot) {
				nearestPackageRoot = dir;
			}
		}
		if (fs.existsSync(path.join(dir, '.git'))) {
			gitRoot = dir;
			break;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}

	const resolvedRoot = workspaceRoot || nearestPackageRoot || gitRoot || path.resolve(cwd);
	verbose(
		`findProjectRoot cwd=${path.resolve(cwd)} workspaceRoot=${workspaceRoot || '-'} nearestPackageRoot=${nearestPackageRoot || '-'} gitRoot=${gitRoot || '-'} resolved=${resolvedRoot}`
	);
	return resolvedRoot;
}

function isWorkspaceRoot(dir: string): boolean {
	if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
		return true;
	}
	const packagePath = path.join(dir, 'package.json');
	if (!fs.existsSync(packagePath)) {
		return false;
	}
	try {
		const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { workspaces?: unknown };
		return Array.isArray(pkg.workspaces) || (pkg.workspaces !== null && typeof pkg.workspaces === 'object');
	} catch {
		return false;
	}
}

export function resolveProfile(projectRoot: string): string {
	const result = resolveProfileResult(projectRoot);
	if (result.profile === null) {
		fail(result.reason);
	}
	return result.profile;
}

function resolveProfileResult(projectRoot: string): { profile: string | null; reason: string } {
	const env = readAgentRunEnv(projectRoot);
	const envProfile = env.AGENT_RUN_PROFILE?.trim();
	if (envProfile) {
		verbose(`using ${ENV_FILE_NAME} AGENT_RUN_PROFILE=${envProfile}`);
		return parseProfile(envProfile, `${ENV_FILE_NAME} AGENT_RUN_PROFILE`);
	}

	const githubProfile = resolveGitHubProfile(projectRoot);
	if (githubProfile !== null) {
		verbose(`using GitHub origin profile=${githubProfile}`);
		return parseProfile(githubProfile, 'GitHub remote origin');
	}

	const packagePath = path.join(projectRoot, 'package.json');
	if (fs.existsSync(packagePath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { name?: unknown };
			if (typeof pkg.name === 'string' && pkg.name.length > 0) {
				verbose(`using package.json name=${pkg.name}`);
				return parseProfile(pkg.name.startsWith('@') ? pkg.name.slice(1) : pkg.name, `${packagePath} name`);
			}
		} catch {
			return { profile: null, reason: `cannot parse package.json: ${packagePath}` };
		}
	}

	return {
		profile: null,
		reason: `cannot resolve agent profile for ${projectRoot}; add ${ENV_FILE_NAME} with AGENT_RUN_PROFILE=<org/project>, add a GitHub origin remote, or set package.json.name`
	};
}

function resolveGitHubProfile(projectRoot: string): string | null {
	const remote = readGitOrigin(projectRoot);
	return remote === null ? null : parseGitHubRemoteProfile(remote);
}

function readGitOrigin(projectRoot: string): string | null {
	const result = childProcess.spawnSync('git', ['-C', projectRoot, 'config', '--get', 'remote.origin.url'], {
		encoding: 'utf8',
		shell: false,
		stdio: ['ignore', 'pipe', 'ignore']
	});
	if (result.status !== 0) {
		return null;
	}
	const remote = result.stdout.trim();
	return remote || null;
}

function parseGitHubRemoteProfile(remote: string): string | null {
	const patterns = [
		/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
		/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
		/^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/
	];
	for (const pattern of patterns) {
		const match = pattern.exec(remote.trim());
		if (match?.[1] && match[2]) {
			return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
		}
	}
	return null;
}

function parseProfile(profile: string, source: string): { profile: string | null; reason: string } {
	const normalized = profile.trim().replace(/\\/g, '/');
	if (!normalized) {
		return { profile: null, reason: `${source} must be a non-empty path relative to the config root` };
	}
	if (normalized.startsWith('/') || normalized.startsWith('\\\\') || /^[A-Za-z]:\//.test(normalized)) {
		return { profile: null, reason: `${source} must be relative to the config root, not an absolute path` };
	}
	const segments = normalized.split('/').filter((segment) => segment.length > 0);
	if (
		segments.length === 0 ||
		segments.some((segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))
	) {
		return { profile: null, reason: `${source} must be a clean relative path like org/my-project` };
	}
	return { profile: segments.join('/'), reason: '' };
}

function projectRootForProfile(profile: string, configRoot?: string): string {
	if (configRoot && path.basename(configRoot) === 'agent-config') {
		return path.join(path.dirname(configRoot), ...profile.split('/'));
	}
	return path.join(os.homedir(), ...profile.split('/'));
}

function readAgentRunEnv(dir: string): Record<string, string> {
	const resolvedDir = path.resolve(dir);
	const cached = agentRunEnvCache.get(resolvedDir);
	if (cached) {
		return cached;
	}
	const filePath = path.join(resolvedDir, ENV_FILE_NAME);
	if (!fs.existsSync(filePath)) {
		const emptyEnv: Record<string, string> = {};
		agentRunEnvCache.set(resolvedDir, emptyEnv);
		return emptyEnv;
	}

	const env: Record<string, string> = {};
	const lines = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').split('\n');
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const equalsIndex = line.indexOf('=');
		if (equalsIndex <= 0) {
			continue;
		}
		const key = line.slice(0, equalsIndex).trim();
		let value = line.slice(equalsIndex + 1).trim();
		if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	agentRunEnvCache.set(resolvedDir, env);
	return env;
}

function parseBooleanEnv(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function defaultConfigRoot(projectRoot?: string, options: { preferProjectRoot?: boolean } = {}): string {
	const overrideRoot = process.env[CONFIG_ROOT_OVERRIDE_ENV];
	if (overrideRoot) {
		return path.resolve(overrideRoot);
	}
	if (process.env[CONFIG_DIR_ENV]) {
		return path.resolve(process.env[CONFIG_DIR_ENV]);
	}
	if (process.env.AGENT_CONFIG_ROOT) {
		return path.resolve(process.env.AGENT_CONFIG_ROOT);
	}
	if (projectRoot) {
		const env = readAgentRunEnv(projectRoot);
		const localConfigDir = env[CONFIG_DIR_ENV]?.trim();
		if (localConfigDir) {
			return path.resolve(projectRoot, localConfigDir);
		}
		const localConfigRoot = env.AGENT_CONFIG_ROOT?.trim();
		if (localConfigRoot) {
			return path.resolve(projectRoot, localConfigRoot);
		}
	}
	if (projectRoot) {
		const projectConfigRoot = defaultCodeConfigRoot(projectRoot);
		if (options.preferProjectRoot || fs.existsSync(projectConfigRoot)) {
			return projectConfigRoot;
		}
		const discoveredConfigRoot = findExistingConfigRoot(defaultConfigRootSearchCandidates());
		return discoveredConfigRoot ?? projectConfigRoot;
	}
	const discoveredConfigRoot = findExistingConfigRoot(defaultConfigRootSearchCandidates());
	return discoveredConfigRoot ?? path.join(os.homedir(), '.agent-config');
}

function defaultCodeConfigRoot(projectRoot: string): string {
	const resolvedProjectRoot = path.resolve(projectRoot);
	const ownerDir = path.dirname(resolvedProjectRoot);
	const codeRoot = path.dirname(ownerDir);
	if (ownerDir === resolvedProjectRoot || codeRoot === ownerDir) {
		return path.join(os.homedir(), '.agent-config');
	}
	return path.join(codeRoot, 'agent-config');
}

function findExistingConfigRoot(candidates: string[]): string | null {
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

export function defaultConfigRootSearchCandidates(
	_projectRoot?: string,
	options: { platform?: NodeJS.Platform; homeDir?: string } = {}
): string[] {
	const platform = options.platform ?? process.platform;
	const pathApi = platform === 'win32' ? path.win32 : path.posix;
	const homeDir = options.homeDir ?? os.homedir();
	const configNames = ['agent-config', 'agent-configs'];
	const candidates: string[] = [];
	if (platform === 'win32') {
		for (const codeRoot of [pathApi.join(homeDir, 'Documents', 'code'), pathApi.join(homeDir, 'Desktop', 'code'), 'C:\\code']) {
			for (const configName of configNames) {
				candidates.push(pathApi.join(codeRoot, configName));
			}
		}
		return candidates;
	}
	for (const configName of configNames) {
		candidates.push(pathApi.join(homeDir, 'code', configName));
	}
	for (const configName of configNames) {
		candidates.push(pathApi.join(homeDir, configName));
	}
	for (const configName of configNames) {
		candidates.push(pathApi.join(homeDir, `.${configName}`));
	}
	return candidates;
}

function findRealBinary(tool: ToolName): string {
	const pathValue = process.env.PATH || '';
	const pathDirs = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);
	const currentScriptArg = process.argv[1];
	const currentScript = currentScriptArg ? fs.realpathSync(currentScriptArg) : '';
	const wrapperCandidates = new Set(
		[
			path.join(__dirname, tool),
			path.join(__dirname, `${tool}.js`),
			path.join(__dirname, `${tool}.cmd`),
			path.join(__dirname, `${tool}.bat`),
			path.join(__dirname, `${tool}.exe`),
			path.join(__dirname, 'agent-run'),
			path.join(__dirname, 'agent-run.js'),
			path.join(__dirname, 'agent-run.cmd'),
			path.join(__dirname, 'agent-run.bat'),
			path.join(__dirname, 'agent-run.exe')
		]
			.filter((candidate) => fs.existsSync(candidate))
			.map((candidate) => {
				try {
					return fs.realpathSync(candidate);
				} catch {
					return candidate;
				}
			})
	);
	const extensions = getExecutableExtensions(tool);
	for (const dir of pathDirs) {
		for (const extension of extensions) {
			const candidate = path.join(dir, `${tool}${extension}`);
			if (!fs.existsSync(candidate) || !isExecutable(candidate)) {
				continue;
			}
			let resolvedCandidate = candidate;
			try {
				resolvedCandidate = fs.realpathSync(candidate);
			} catch {
				resolvedCandidate = candidate;
			}
			if (resolvedCandidate === currentScript || wrapperCandidates.has(resolvedCandidate)) {
				continue;
			}
			if (isAgentRunRedirectShim(candidate)) {
				verbose(`skip ${tool} redirect shim: ${candidate}`);
				continue;
			}
			return candidate;
		}
	}
	fail(`no ${tool} binary found in PATH`);
}

function isAgentRunRedirectShim(filePath: string): boolean {
	try {
		const handle = fs.openSync(filePath, 'r');
		try {
			const buffer = Buffer.alloc(4096);
			const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
			const content = buffer.subarray(0, bytesRead).toString('utf8');
			return content.includes('Run agent-run instead');
		} finally {
			fs.closeSync(handle);
		}
	} catch {
		return false;
	}
}

function getExecutableExtensions(tool: string): string[] {
	if (!IS_WINDOWS || path.extname(tool)) {
		return [''];
	}
	const pathExt = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
		.split(';')
		.filter((entry) => entry.length > 0)
		.map((entry) => entry.toLowerCase());
	return pathExt;
}

function isExecutable(filePath: string): boolean {
	try {
		if (IS_WINDOWS) {
			return fs.statSync(filePath).isFile();
		}
		fs.accessSync(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function execTool(command: string, args: string[]): void {
	verbose(`exec tool: ${formatCommand(command, args)}`);
	execCommand(command, args);
}

function execCommand(
	command: string,
	args: string[],
	env?: Record<string, string | undefined>,
	cwd?: string,
	onExit?: (code: number) => number
): void {
	verbose(`spawn: ${formatCommand(command, args)} cwd=${cwd ?? process.cwd()}`);
	const child = crossSpawn(command, args, { cwd, env, stdio: 'inherit' });
	child.on('exit', (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		const originalCode = code === null ? 1 : code;
		process.exit(onExit ? onExit(originalCode) : originalCode);
	});
	child.on('error', (error) => {
		fail(error.message);
	});
}

function openEditor(filePath: string): void {
	const visual = process.env.VISUAL?.trim();
	if (visual) {
		runConfiguredEditor(visual, filePath);
		return;
	}
	const editor = process.env.EDITOR?.trim();
	if (editor) {
		runConfiguredEditor(editor, filePath);
		return;
	}
	const vscodeCommand = findVsCodeEditorCommand();
	if (vscodeCommand !== null) {
		execCommand(vscodeCommand, ['--reuse-window', filePath]);
		return;
	}
	const fallbackEditor = findFallbackEditor();
	if (fallbackEditor !== null) {
		execCommand(fallbackEditor, [filePath]);
		return;
	}
	if (IS_WINDOWS) {
		execCommand('explorer.exe', [filePath]);
		return;
	}
	if (process.platform === 'darwin') {
		execCommand('open', [filePath]);
		return;
	}
	execCommand('xdg-open', [filePath]);
}

function runConfiguredEditor(commandLine: string, filePath: string): void {
	let editorArgs: string[];
	try {
		editorArgs = parseEditorCommand(commandLine);
	} catch (error) {
		fail(`invalid editor command: ${formatError(error)}`);
	}
	const [command, ...args] = editorArgs;
	if (!command) {
		fail('invalid editor command: command is empty');
	}
	execCommand(command, [...args, filePath]);
}

export function parseEditorCommand(commandLine: string): string[] {
	const args: string[] = [];
	let current = '';
	let quote: "'" | '"' | null = null;
	let tokenStarted = false;

	for (let index = 0; index < commandLine.length; index += 1) {
		const character = commandLine[index] ?? '';
		if (quote !== null) {
			if (character === quote) {
				quote = null;
				continue;
			}
			if (character === '\\' && quote === '"') {
				const next = commandLine[index + 1];
				if (next === '"' || next === '\\') {
					current += next;
					index += 1;
					continue;
				}
			}
			current += character;
			continue;
		}

		if (character === "'" || character === '"') {
			quote = character;
			tokenStarted = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (tokenStarted) {
				args.push(current);
				current = '';
				tokenStarted = false;
			}
			continue;
		}
		if (character === '\\') {
			const next = commandLine[index + 1];
			if (next !== undefined && (/\s/.test(next) || next === "'" || next === '"' || next === '\\')) {
				current += next;
				index += 1;
				tokenStarted = true;
				continue;
			}
		}
		current += character;
		tokenStarted = true;
	}

	if (quote !== null) {
		throw new Error(`unterminated ${quote} quote`);
	}
	if (tokenStarted) {
		args.push(current);
	}
	if (args.length === 0) {
		throw new Error('command is empty');
	}
	return args;
}

function findVsCodeEditorCommand(): string | null {
	if (!isRunningInVsCodeTerminal()) {
		return null;
	}
	for (const candidate of ['code', 'codium']) {
		const resolved = findExecutable(candidate);
		if (resolved !== null) {
			return resolved;
		}
	}
	return null;
}

function isRunningInVsCodeTerminal(): boolean {
	const termProgram = process.env.TERM_PROGRAM?.trim().toLowerCase();
	return (
		termProgram === 'vscode' ||
		Boolean(process.env.VSCODE_GIT_IPC_HANDLE) ||
		Boolean(process.env.VSCODE_IPC_HOOK) ||
		Boolean(process.env.VSCODE_IPC_HOOK_CLI)
	);
}

function findFallbackEditor(): string | null {
	const candidates = IS_WINDOWS ? ['notepad.exe'] : ['joe', 'sensible-editor', 'editor', 'nano', 'nvim', 'vim', 'vi'];
	for (const candidate of candidates) {
		const resolved = findExecutable(candidate);
		if (resolved !== null) {
			return resolved;
		}
	}
	return null;
}

function findExecutable(command: string): string | null {
	const pathValue = process.env.PATH || '';
	const pathDirs = pathValue.split(path.delimiter).filter((entry) => entry.length > 0);
	const extensions = getExecutableExtensions(command);
	for (const dir of pathDirs) {
		for (const extension of extensions) {
			const candidate = path.join(dir, `${command}${extension}`);
			if (fs.existsSync(candidate) && isExecutable(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

function localDateString(): string {
	const now = new Date();
	const year = String(now.getFullYear()).padStart(4, '0');
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function stringifyDefaultManifest(profile: string): string {
	const manifest = defaultManifest(profile);
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

function defaultLocalTemplate(_profile: string): string {
	return [
		'# {{ profile }} local agent instructions',
		'',
		'Project root:',
		'',
		'```text',
		'{{ projectRoot }}',
		'```',
		'',
		'Agent directory:',
		'',
		'```text',
		'{{ agentDir }}',
		'```',
		'',
		'Profile source directory:',
		'',
		'```text',
		'{{ profileDir }}',
		'```',
		'',
		'Add project-specific rules here.',
		''
	].join('\n');
}

function defaultCodeAgentTemplate(): string {
	return [
		'# Code Agent',
		'',
		'Work in the project root shown by agent-run. Keep changes scoped to the user request.',
		'',
		'{% include "global/snippets/git-rules.md.njk" %}',
		'',
		'{% include "global/snippets/no-ai-files.md.njk" %}',
		'',
		'{% include "global/snippets/verification.md.njk" %}',
		''
	].join('\n');
}

function defaultWritingAgentTemplate(): string {
	return [
		'# Writing Agent',
		'',
		'Write clearly and preserve the existing voice, structure, and facts in the project.',
		'',
		'{% include "global/snippets/no-ai-files.md.njk" %}',
		''
	].join('\n');
}

function defaultGitRulesSnippet(): string {
	return [
		'## Git Rules',
		'',
		'Do not commit unless the user explicitly asks. Before committing, show changed files and the exact commit message.',
		'Use human commit messages unless the user asks for conventional commits. Do not push unless explicitly asked.',
		''
	].join('\n');
}

function defaultNoAiFilesSnippet(): string {
	return [
		'## Agent File Storage',
		'',
		'Do not create AGENTS.md, CLAUDE.md, .agents, .claude, .codex, or other agent runtime files inside the project repository.',
		'Generated agent-only files belong under {{ paths.liveDir }}.',
		'Source config files belong under {{ profileDir }}.',
		''
	].join('\n');
}

function defaultVerificationSnippet(): string {
	return [
		'## Verification',
		'',
		'Run relevant checks before reporting completion. Configured checks:',
		'',
		'{% for check in checks %}',
		'- `{{ check }}`',
		'{% endfor %}',
		''
	].join('\n');
}

function defaultCommitWorkflowSkill(): string {
	return [
		'---',
		'name: commit-workflow',
		'description: Use for preparing or creating commits with explicit user approval.',
		'---',
		'',
		'# Commit Workflow',
		'',
		'Never commit unless explicitly asked. Before committing, show changed files and the exact commit message.',
		'Use human commit messages unless conventional commits are explicitly requested. Do not push.',
		'Run configured checks before committing:',
		'',
		'{% for check in checks %}',
		'- `{{ check }}`',
		'{% endfor %}',
		''
	].join('\n');
}

function defaultGithubReleaseSkill(): string {
	return [
		'---',
		'name: github-release',
		'description: Use for releases, version bumps, tags, publishing, GitHub Releases, and CHANGES updates.',
		'---',
		'',
		'# GitHub Release',
		'',
		'Use {{ paths.changesFile }} for change notes.',
		'Require confirmation before writing CHANGES, bumping versions, committing, tagging, pushing, publishing, or creating a GitHub Release.',
		'Follow `$commit-workflow` for release commits.',
		''
	].join('\n');
}

function defaultReleasePackageCheckSkill(): string {
	return [
		'---',
		'name: release-package-check',
		'description: Use before package releases and publish-ready changes to verify package metadata, release notes, lockfiles, workflows, git state, and agent-file hygiene.',
		'---',
		'',
		'# Release Package Check',
		'',
		'Use this skill instead of an external `repo-check` command.',
		'For package release or publish-ready work, verify the relevant package directory before finalizing:',
		'',
		'- The directory contains `package.json` and is inside a git repository.',
		'- The repository path follows `<org>/<repo>`, and `package.json.name` is `@<org>/<package-dir-name>`.',
		'- `package.json.version`, `package.json.license`, and `package.json.copyright` are present and non-empty.',
		'- A package-local `LICENSE` file exists and contains the exact copyright string from `package.json.copyright`.',
		'- A package-local `CHANGES` file exists.',
		'- The first `Version ...` line in `CHANGES` matches `Version <package.json.version> (<YYYY-MM-DD>)`.',
		'- The year in the top `CHANGES` version line appears in `package.json.copyright`.',
		'- The git `origin` remote matches `<org>/<repo>`.',
		'- The current branch has an upstream configured and is in sync with it after fetching.',
		'- The repository does not contain agent files or directories such as `AGENTS.md`, `CLAUDE.md`, `codex.md`, `.claude`, or `.codex`.',
		'- The repository root has a lockfile: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, or `bun.lock`.',
		'- Every GitHub Actions `uses:` reference is pinned to a full commit SHA.',
		'- The pinned `actions/setup-node` release is v6-compatible and workflows use `node-version: 24`.',
		'- GitHub workflows do not reference `node20` or `node22`.',
		'- The git working tree is clean for files under the checked package directory.',
		'- If files beyond `CHANGES` changed in the checked package directory, that package `CHANGES` file is also changed.',
		'',
		'Run the configured checks after this checklist:',
		'',
		'{% for check in checks %}',
		'- `{{ check }}`',
		'{% endfor %}',
		''
	].join('\n');
}

function defaultCodeReviewOrganizerSkill(): string {
	return [
		'---',
		'name: code-review-organizer',
		'description: Use for organizing code review findings, review files, and review follow-up state.',
		'---',
		'',
		'# Code Review Organizer',
		'',
		'On review startup, move any files from {{ paths.liveDir }}/reviews into {{ paths.reviewDir }} so review history persists outside the ephemeral live directory.',
		'Before doing any code review, read the generated AGENTS.md file and the current consolidated review file: {{ paths.reviewConsolidatedFile }}.',
		'Save each active review to {{ paths.reviewDir }}/yyyy-mm-dd-[sequence].md, where the sequence increments for multiple reviews on the same date.',
		'Whenever a saved review is created or changed, update {{ paths.reviewConsolidatedFile }} with the consolidated current review findings.',
		'In {{ paths.reviewConsolidatedFile }}, include each active finding with its review date and source review filename.',
		'When a finding is fixed, remove it from {{ paths.reviewConsolidatedFile }} and move it to {{ paths.reviewDir }}/DONE.md with the time it was fixed.',
		'When a finding is intentionally not fixed, remove it from {{ paths.reviewConsolidatedFile }} and move it to {{ paths.reviewDir }}/DONE.md with the time it was marked intentional and a note that it was intentionally left as-is.',
		'When a dated review file has no remaining active findings, delete it.',
		'Also include active findings in the final user-facing reply.',
		'Do not save review files inside the project repo.',
		'Before the final reply for review work, verify that no REVIEW*.md files exist in {{ projectRoot }}, active dated review files exist only when they still contain active findings, and the consolidated REVIEW.md file was updated.',
		''
	].join('\n');
}

function defaultToolInstructionsTemplate(isClaude: boolean): string {
	return [
		`# Generated ${isClaude ? 'Claude' : 'agent'} instructions for {{ profile }}`,
		'',
		'Do not edit this file directly. Edit:',
		'',
		'```text',
		'{{ profileDir }}/agent-run.jsonc',
		'{{ profileDir }}/local.md.njk',
		'```',
		'',
		'{% for section in renderedAgentSections %}',
		'{{ section }}',
		'',
		'{% endfor %}',
		'## Absolute Paths',
		'',
		'Project root:',
		'',
		'```text',
		'{{ projectRoot }}',
		'```',
		'',
		'Agent directory:',
		'',
		'```text',
		'{{ agentDir }}',
		'```',
		'',
		'Profile source directory:',
		'',
		'```text',
		'{{ profileDir }}',
		'```',
		'',
		'Review directory:',
		'',
		'```text',
		'{{ paths.reviewDir }}',
		'```',
		'',
		"Today's review file:",
		'',
		'```text',
		'{{ paths.reviewFile }}',
		'```',
		'',
		'Consolidated review file:',
		'',
		'```text',
		'{{ paths.reviewConsolidatedFile }}',
		'```',
		'',
		'Memories directory:',
		'',
		'```text',
		'{{ paths.memoriesDir }}',
		'```',
		'',
		'Global memory directory:',
		'',
		'```text',
		'{{ paths.globalMemoryDir }}',
		'```',
		'',
		'Changes file:',
		'',
		'```text',
		'{{ paths.changesFile }}',
		'```',
		'',
		'## Available Skills',
		'',
		'{% for skill in skills %}',
		'- `${{ skill.name }}`{% if skill.description %}: {{ skill.description }}{% endif %}',
		'{% endfor %}',
		'',
		'## Tool Note',
		'',
		isClaude
			? 'Claude receives {{ agentDir }}/CLAUDE.md through `--append-system-prompt-file` and loads generated skills as a local plugin.'
			: 'Codex loads AGENTS.md, config.toml, and skills natively from {{ paths.codexHomeDir }}.',
		'',
		'## Mandatory Path Rule',
		'',
		'Do not create AGENTS.md, CLAUDE.md, .agents, .claude, .codex, or AI-related files inside the project repository.',
		'Generated agent-only files must be stored under the agent directory shown above.',
		'Source config files must be stored under the profile source directory shown above.',
		''
	].join('\n');
}

function defaultCodexConfigTemplate(): string {
	return [
		'# Generated by agent-run. Do not edit directly.',
		'',
		'project_doc_max_bytes = 65536',
		'approval_policy = "on-request"',
		'sandbox_mode = "workspace-write"',
		'',
		'[sandbox_workspace_write]',
		'writable_roots = [',
		'  {{ projectRoot | dump }},',
		'  {{ paths.reviewDir | dump }},',
		'  {{ paths.memoriesDir | dump }}',
		']',
		'network_access = false',
		''
	].join('\n');
}

function defaultClaudeSettingsTemplate(): string {
	const envBlock = [
		'  "env": {',
		'    "AGENT_DIR": {{ agentDir | dump }},',
		'    "AGENT_PROFILE_DIR": {{ profileDir | dump }},',
		'    "AGENT_RUN_PROJECT_ROOT": {{ projectRoot | dump }},',
		'    "AGENT_GLOBAL_MEMORY_DIR": {{ paths.globalMemoryDir | dump }}',
		'  }'
	].join('\n');
	return [
		'{% if permissionsAllow.length %}{',
		envBlock + ',',
		'  "permissions": {',
		'    "allow": {{ permissionsAllow | dump }}',
		'  }',
		'}',
		'{% else %}{',
		envBlock,
		'}',
		'{% endif %}'
	].join('\n');
}

function defaultCodexConfigContent(context: RenderContext): string {
	return [
		'# Generated by agent-run. Do not edit directly.',
		'',
		'project_doc_max_bytes = 65536',
		'approval_policy = "on-request"',
		'sandbox_mode = "workspace-write"',
		'',
		'[sandbox_workspace_write]',
		'writable_roots = [',
		`  ${jsonString(context.projectRoot)},`,
		`  ${jsonString(context.paths.reviewDir)},`,
		`  ${jsonString(context.paths.memoriesDir)}`,
		']',
		'network_access = false',
		''
	].join('\n');
}

function defaultClaudeSettingsContent(context: RenderContext): string {
	const settings: Record<string, unknown> = {
		env: {
			AGENT_DIR: context.agentDir,
			AGENT_PROFILE_DIR: context.profileDir,
			AGENT_RUN_PROJECT_ROOT: context.projectRoot,
			AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir
		}
	};
	if (context.permissionsAllow.length > 0) {
		settings.permissions = { allow: context.permissionsAllow };
	}
	return `${JSON.stringify(settings, null, 2)}\n`;
}

function legacyDefaultClaudeSettingsContent(context: RenderContext, agentDir: string): string {
	return `${JSON.stringify(
		{
			env: {
				AGENT_DIR: agentDir,
				AGENT_RUN_PROJECT_ROOT: context.projectRoot,
				AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir
			}
		},
		null,
		2
	)}\n`;
}

function jsonString(value: string): string {
	return JSON.stringify(value);
}

function posixGitShim(): string {
	return [
		'#!/usr/bin/env bash',
		'set -euo pipefail',
		'for arg in "$@"; do',
		'  case "$arg" in',
		'    commit|tag|push)',
		'      if [ "${AGENT_RUN_ALLOW_GIT_WRITE:-}" != "1" ]; then',
		'        echo "agent-run: blocked git $arg. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation." >&2',
		'        exit 42',
		'      fi',
		'      ;;',
		'  esac',
		'done',
		...posixRunRealCommand('git'),
		''
	].join('\n');
}

function posixPublishShim(tool: 'npm' | 'pnpm'): string {
	return [
		'#!/usr/bin/env bash',
		'set -euo pipefail',
		'for arg in "$@"; do',
		'  if [ "$arg" = "publish" ] && [ "${AGENT_RUN_ALLOW_PUBLISH:-}" != "1" ]; then',
		`    echo "agent-run: blocked ${tool} publish. Review and run it manually, or set AGENT_RUN_ALLOW_PUBLISH=1 for this invocation." >&2`,
		'    exit 42',
		'  fi',
		'done',
		...posixRunRealCommand(tool),
		''
	].join('\n');
}

function posixGhShim(): string {
	return [
		'#!/usr/bin/env bash',
		'set -euo pipefail',
		'saw_release=0',
		'for arg in "$@"; do',
		'  if [ "$arg" = "release" ]; then',
		'    saw_release=1',
		'  elif [ "$saw_release" = "1" ] && [ "$arg" = "create" ] && [ "${AGENT_RUN_ALLOW_GITHUB_RELEASE:-}" != "1" ]; then',
		'    echo "agent-run: blocked gh release create. Review and run it manually, or set AGENT_RUN_ALLOW_GITHUB_RELEASE=1 for this invocation." >&2',
		'    exit 42',
		'  fi',
		'done',
		...posixRunRealCommand('gh'),
		''
	].join('\n');
}

function posixRunRealCommand(tool: string): string[] {
	return [
		'shim_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"',
		'real_path="${AGENT_RUN_REAL_PATH:-}"',
		'if [ -z "$real_path" ]; then',
		'  case "${PATH:-}" in',
		'    "$shim_dir") real_path="" ;;',
		'    "$shim_dir":*) real_path="${PATH#*:}" ;;',
		'    *) real_path="${PATH:-}" ;;',
		'  esac',
		'fi',
		`real_command="$(PATH="$real_path" command -v ${tool} || true)"`,
		'if [ -z "$real_command" ]; then',
		`  echo "agent-run: cannot find the real ${tool} command outside the guard directory." >&2`,
		'  exit 127',
		'fi',
		`if [ "$real_command" = "$shim_dir/${tool}" ]; then`,
		`  echo "agent-run: refused recursive ${tool} guard resolution." >&2`,
		'  exit 127',
		'fi',
		'PATH="$real_path" exec "$real_command" "$@"'
	];
}

function windowsShim(name: string): string {
	const executable = name === 'npm' || name === 'pnpm' ? `${name}.cmd` : `${name}.exe`;
	const guard =
		name === 'git'
			? [
					':scan',
					'if "%~1"=="" goto run',
					'if /I "%~1"=="commit" goto block_git',
					'if /I "%~1"=="tag" goto block_git',
					'if /I "%~1"=="push" goto block_git',
					'shift',
					'goto scan',
					':block_git',
					'if "%AGENT_RUN_ALLOW_GIT_WRITE%"=="1" goto run',
					'echo agent-run: blocked git write. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation. 1>&2',
					'exit /b 42'
			  ]
			: name === 'gh'
				? [
						'set "SAW_RELEASE=0"',
						':scan',
						'if "%~1"=="" goto run',
						'if /I "%~1"=="release" set "SAW_RELEASE=1"',
						'if "%SAW_RELEASE%"=="1" if /I "%~1"=="create" goto block_release',
						'shift',
						'goto scan',
						':block_release',
						'if "%AGENT_RUN_ALLOW_GITHUB_RELEASE%"=="1" goto run',
						'echo agent-run: blocked gh release create. Review and run it manually, or set AGENT_RUN_ALLOW_GITHUB_RELEASE=1 for this invocation. 1>&2',
						'exit /b 42'
				  ]
				: [
						':scan',
						'if "%~1"=="" goto run',
						'if /I "%~1"=="publish" goto block_publish',
						'shift',
						'goto scan',
						':block_publish',
						'if "%AGENT_RUN_ALLOW_PUBLISH%"=="1" goto run',
						`echo agent-run: blocked ${name} publish. Review and run it manually, or set AGENT_RUN_ALLOW_PUBLISH=1 for this invocation. 1>&2`,
						'exit /b 42'
				  ];
	return [
		'@echo off',
		...guard,
		':run',
		'if defined AGENT_RUN_REAL_PATH (',
		'  set "PATH=%AGENT_RUN_REAL_PATH%"',
		') else (',
		'  for /f "tokens=1,* delims=;" %%A in ("%PATH%") do set "PATH=%%B"',
		')',
		`${executable} %*`,
		''
	].join('\n');
}

function isVerbose(): boolean {
	return parseBooleanEnv(process.env[VERBOSE_ENV]);
}

function verbose(message: string): void {
	if (isVerbose()) {
		process.stderr.write(`agent-run: ${message}\n`);
	}
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args].map(quoteArg).join(' ');
}

function quoteArg(value: string): string {
	if (value === '') {
		return '""';
	}
	if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
		return value;
	}
	return JSON.stringify(value);
}

function fail(message: string): never {
	process.stderr.write(`agent-run: ${message}\n`);
	process.exit(1);
}

if (require.main === module) {
	main(path.basename(process.argv[1] ?? 'agent-run'), process.argv.slice(2));
}
