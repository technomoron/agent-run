import * as fs from 'fs';
import * as path from 'path';
import {
	CONFIG_ROOT_OVERRIDE_ENV,
	PACKAGE_VERSION,
	VERBOSE_ENV
} from './constants';
import { getAgentAdapter } from './agents/registry';
import { AGENT_IDS } from './agents/types';
import {
	CheckCommand,
	CommandName,
	EditCommand,
	GenerateCommand,
	InitCommand,
	MigrateConfigCommand,
	ParsedInvocation,
	RunCommand,
	SetupCommand,
	StatusCommand,
	ToolName,
	UpdateCommand,
	WrapperArgs
} from './model';
import { defaultConfigRoot } from './project';
import { fail } from './utils';

type HelpTopic = 'general' | 'check' | 'status' | 'setup' | 'generate' | 'init' | 'edit' | 'update' | 'migrate-config';
type GlobalOptions = {
	args: string[];
	configRootOverride: string | null;
	verbose: boolean;
};

export function parseInvocation(invokedTool: string, argv: string[]): ParsedInvocation {
	let command = normalizeCommandName(invokedTool);
	const options = extractGlobalOptions(argv);
	applyGlobalOptions(options);
	if (command === null) {
		command = extractCommand(options.args);
	}
	return parseCommand(command, options.args);
}

function applyGlobalOptions(options: GlobalOptions): void {
	if (options.verbose) {
		process.env[VERBOSE_ENV] = '1';
	}
	if (options.configRootOverride !== null) {
		process.env[CONFIG_ROOT_OVERRIDE_ENV] = options.configRootOverride;
	}
}

function extractCommand(args: string[]): CommandName {
	if (args.length === 0) {
		fail('usage: agent-run <codex|claude|gemini|grok|check|status|setup|generate|edit|update> [options] (run with --help for details)');
	}
	if (isHelpFlag(args[0])) {
		printHelp('general');
	}
	if (isVersionFlag(args[0])) {
		printVersion();
	}
	const commandIndex = args.findIndex((arg) => arg !== '--' && normalizeCommandName(arg) !== null);
	if (commandIndex === -1 || args.slice(0, commandIndex).includes('--')) {
		fail(`unknown command: ${args[0] ?? ''} (run with --help for usage)`);
	}
	const command = normalizeCommandName(args[commandIndex] ?? '');
	if (command === null) {
		fail(`unknown command: ${args[0] ?? ''} (run with --help for usage)`);
	}
	args.splice(commandIndex, 1);
	return command;
}

function parseCommand(command: CommandName, args: string[]): ParsedInvocation {
	switch (command) {
		case 'check':
			return parseCheckCommand(args);
		case 'status':
			return parseStatusCommand(args);
		case 'init':
			return parseInitCommand(args);
		case 'generate':
			return parseGenerateCommand(args);
		case 'setup':
			return parseSetupCommand(args);
		case 'edit':
			return parseEditCommand(args);
		case 'update':
			return parseUpdateCommand(args);
		case 'migrate-config':
			return parseMigrateConfigCommand(args);
		default:
			return parseRunCommand(command, args);
	}
}

function extractGlobalOptions(argv: string[]): GlobalOptions {
	const options: GlobalOptions = {
		args: [],
		configRootOverride: null,
		verbose: false
	};
	let passthrough = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined) {
			continue;
		}
		if (passthrough) {
			options.args.push(arg);
			continue;
		}
		if (arg === '--') {
			passthrough = true;
			options.args.push(arg);
		} else if (arg === '-v' || arg === '--verbose') {
			options.verbose = true;
		} else if (arg === '--configdir') {
			const nextArg = argv[index + 1];
			if (nextArg === undefined) {
				fail('missing value for --configdir');
			}
			options.configRootOverride = path.resolve(nextArg);
			index += 1;
		} else if (arg.startsWith('--configdir=')) {
			const rootValue = arg.slice('--configdir='.length);
			if (!rootValue) {
				fail('missing value for --configdir');
			}
			options.configRootOverride = path.resolve(rootValue);
		} else {
			options.args.push(arg);
		}
	}
	return options;
}

function parseRunCommand(command: ToolName, inputArgs: string[]): RunCommand {
	const wrapperArgs: WrapperArgs = {
		none: false,
		create: false,
		local: false,
		show: false,
		generate: false,
		sandboxMode: null,
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
		if (applyCommonRunOption(arg, wrapperArgs)) {
			continue;
		}
		if (applySandboxRunOption(command, arg, wrapperArgs)) {
			continue;
		}
		args.push(arg);
	}
	if (wrapperArgs.codexNetwork && wrapperArgs.sandboxMode === 'danger') {
		fail('--network cannot be combined with agent-run codex --yolo');
	}
	return { args, command, wrapperArgs };
}

function applyCommonRunOption(arg: string, options: WrapperArgs): boolean {
	const fields: Record<string, keyof Pick<WrapperArgs, 'none' | 'create' | 'local' | 'show' | 'generate'>> = {
		'--none': 'none',
		'--create': 'create',
		'--local': 'local',
		'--show': 'show',
		'--generate': 'generate'
	};
	const field = fields[arg];
	if (field === undefined) {
		return false;
	}
	options[field] = true;
	return true;
}

function applySandboxRunOption(command: ToolName, arg: string, options: WrapperArgs): boolean {
	if (!['--yolo', '--sandboxed', '--network'].includes(arg)) {
		return false;
	}
	const adapter = getAgentAdapter(command);
	if (arg === '--sandboxed' && !adapter.wrapperOptions.sandboxed) {
		fail(`${arg} is not supported for agent-run ${command}`);
	}
	if (arg === '--network' && !adapter.wrapperOptions.network) {
		fail(`${arg} is only supported for agent-run codex`);
	}
	if (arg === '--network') {
		options.codexNetwork = true;
		return true;
	}
	const mode = arg === '--yolo' ? 'danger' : 'sandboxed';
	if (options.sandboxMode !== null && options.sandboxMode !== mode) {
		fail('cannot combine --yolo and --sandboxed');
	}
	options.sandboxMode = mode;
	return true;
}

function parseStatusCommand(inputArgs: string[]): StatusCommand {
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('status');
		}
		fail(`unknown status option: ${arg}`);
	}
	return { command: 'status' };
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
		} else if (arg.startsWith('--')) {
			fail(`unknown check option: ${arg}`);
		} else {
			targetPath = arg;
		}
	}
	return { all, command: 'check', targetPath: path.resolve(targetPath) };
}

function parseInitCommand(inputArgs: string[]): InitCommand {
	return { command: 'init', targetPath: parseSinglePath(inputArgs, 'init') };
}

function parseGenerateCommand(inputArgs: string[]): GenerateCommand {
	return { command: 'generate', targetPath: parseSinglePath(inputArgs, 'generate') };
}

function parseSetupCommand(inputArgs: string[]): SetupCommand {
	let profile: string | null = null;
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('setup');
		}
		if (arg.startsWith('--')) {
			fail(`unknown setup option: ${arg}`);
		}
		if (profile !== null) {
			fail('setup accepts at most one profile argument');
		}
		profile = arg;
	}
	return { command: 'setup', profile };
}

function parseEditCommand(inputArgs: string[]): EditCommand {
	return { command: 'edit', targetPath: parseSinglePath(inputArgs, 'edit') };
}

function parseSinglePath(inputArgs: string[], command: 'generate' | 'init' | 'edit', defaultPath = process.cwd()): string {
	let targetPath = defaultPath;
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp(command);
		}
		if (arg.startsWith('--')) {
			fail(`unknown ${command} option: ${arg}`);
		}
		targetPath = arg;
	}
	return path.resolve(targetPath);
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
		} else if (arg.startsWith('--')) {
			fail(`unknown update option: ${arg}`);
		} else {
			targetPath = arg;
		}
	}
	return { all, command: 'update', targetPath: path.resolve(targetPath) };
}

function parseMigrateConfigCommand(inputArgs: string[]): MigrateConfigCommand {
	let configRoot = defaultConfigRoot();
	let yes = false;
	for (const arg of inputArgs) {
		if (isHelpFlag(arg)) {
			printHelp('migrate-config');
		}
		if (arg === '--yes') {
			yes = true;
		} else if (arg.startsWith('--')) {
			fail(`unknown migrate-config option: ${arg}`);
		} else {
			configRoot = arg;
		}
	}
	return { command: 'migrate-config', configRoot: path.resolve(configRoot), yes };
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

function printHelp(topic: HelpTopic): never {
	process.stdout.write(renderHelp(topic));
	process.exit(0);
}

function renderHelp(topic: HelpTopic): string {
	const help: Record<Exclude<HelpTopic, 'general'>, string[]> = {
		check: [
			'Usage:',
			'  agent-run check [--all] [path]',
			'',
			'Check generated profile files, native skills, guard shims, and local AI-file leaks.',
			'',
			'Options:',
			'  -h, --help  Show this help text',
			'  --all       Check every repo under path',
			''
		],
		status: ['Usage:', '  agent-run status', '', 'Show the native agent capability matrix.', ''],
		init: ['Usage:', '  agent-run init [path]', '', 'Deprecated alias for `agent-run generate [path]`.', ''],
		generate: ['Usage:', '  agent-run generate [path]', '', 'Create a minimal mapped profile marker and render generated files.', ''],
		setup: ['Usage:', '  agent-run setup [org/repo]', '', 'Install the default config tree and selected profile.', ''],
		edit: ['Usage:', '  agent-run edit [path]', '', 'Create or open the editable local profile template.', ''],
		update: [
			'Usage:',
			'  agent-run update [--all] [path]',
			'',
			'Render generated files, native skills, config, and guard shims for an existing profile.',
			'With --all, render every profile found under the config root without requiring code checkouts.',
			''
		],
		'migrate-config': [
			'Usage:',
			'  agent-run migrate-config [--yes] [config-root]',
			'',
			'Convert an existing agent config tree to the current manifest and global-template layout.',
			'',
			'Options:',
			'  --yes  Confirm tracked Git moves without prompting',
			''
		]
	};
	if (topic !== 'general') {
		return help[topic].join('\n');
	}
	return [
		`agent-run ${agentRunVersion()}`,
		'',
		'Usage:',
		'  agent-run <codex|claude|gemini|grok|check|status|setup|generate|edit|update> [options]',
		'',
		'Commands:',
		'  codex [--none] [--create] [--local] [--show] [--generate] [--yolo|--sandboxed] [--network] [args...]',
		'                                           Run codex with generated private config',
		'  claude [--none] [--create] [--local] [--show] [--generate] [--yolo] [args...]',
		'                                           Run claude with generated private config',
		'  gemini [--none] [--create] [--local] [--show] [--generate] [--yolo|--sandboxed] [args...]',
		'                                           Run gemini with generated private config',
		'  grok [--none] [--create] [--local] [--show] [--generate] [--yolo|--sandboxed] [args...]',
		'                                           Run grok with generated private config',
		'  setup [org/repo]                      Install the default tree and selected profile',
		'  check [--all] [path]                  Validate generated profile output',
		'  status                                Show native agent capabilities',
		'  generate [path]                       Create a sparse profile marker and render output',
		'  edit [path]                           Create or open local.md.njk',
		'  update [--all] [path]                 Regenerate existing profile output',
		'  migrate-config [--yes] [config-root]   Convert existing config tree layout',
		'',
		'Global options:',
		'  -h, --help         Show this help text',
		'  -V, --version      Show the agent-run version',
		'  -v, --verbose      Print path resolution and wrapper actions',
		'  --configdir=DIR    Override the config directory',
		'',
		'Run wrapper options:',
		'  --local            Warn about local AI files instead of failing',
		'  --show             Show read/include and generated files without running the tool',
		'  --generate         Generate files without running the tool',
		'  --yolo             Run unattended without approval prompts:',
		'                     Codex with -a never -s danger-full-access,',
		'                     Claude with --dangerously-skip-permissions,',
		'                     Gemini with --yolo, Grok with --always-approve',
		'',
		'Sandbox wrapper options:',
		'  --sandboxed        Run Codex, Gemini, or Grok in its native workspace sandbox',
		'  --network          Enable network for the workspace-write sandbox',
		''
	].join('\n');
}

function agentRunVersion(): string {
	try {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as { version?: unknown };
		return typeof pkg.version === 'string' && pkg.version ? pkg.version : PACKAGE_VERSION;
	} catch {
		return PACKAGE_VERSION;
	}
}

function normalizeCommandName(value: string): CommandName | null {
	if (!value) {
		return null;
	}
	const base = path.basename(value).toLowerCase().replace(/\.(?:js|cmd|exe|bat)$/, '');
	if (base === 'agent-run') {
		return null;
	}
	return [...AGENT_IDS, 'check', 'status', 'setup', 'generate', 'init', 'edit', 'update', 'migrate-config'].includes(base)
		? (base as CommandName)
		: null;
}
