import * as fs from 'fs';
import * as path from 'path';
import { getAgentAdapter, listAgentAdapters } from './agents/registry';
import { checkProject, checkSourceTree, hasErrors, printBatchReport, printProjectReport } from './checks';
import { parseInvocation } from './cli';
import {
	copySkeletonTree,
	convertLegacyTemplateVars,
	ensureConfigRootGitignore,
	ensureConfigRootLayout,
	ensureDefaultGlobalTemplates,
	findLegacyProfileDirs,
	findProfileDirs,
	migrateCodexRuntimeFiles,
	migrateLooseFiles,
	migrateOldTemplates,
	migrateProfileLayout,
	starterConfigRootPath
} from './config-tree';
import { ENV_FILE_NAME, LOCAL_TEMPLATE_FILE_NAME, MANIFEST_FILE_NAME } from './constants';
import {
	convertLegacyProfileIfNeeded,
	createDefaultLocalFile,
	createProfileMarker,
	ensureRootDefaultsFile,
	isProfileConfigured
} from './manifest';
import {
	CheckCommand,
	EditCommand,
	GenerateCommand,
	InitCommand,
	MigrateConfigCommand,
	ParsedInvocation,
	RenderContext,
	RenderedProfile,
	RenderTrace,
	RunCommand,
	SetupCommand,
	StatusCommand,
	ToolName,
	UpdateCommand
} from './model';
import { findRealBinary, openEditor } from './process';
import {
	defaultConfigRoot,
	failForLocalAiFiles,
	findLocalAiFiles,
	findProjectRoot,
	isIgnoredDir,
	projectRootForProfile,
	resolveAgentDir,
	parseProfile,
	resolveProfile,
	resolveProfileResult,
	warnForLocalAiFiles
} from './project';
import { renderProfile, syncAgentProfile, syncRenderedProfile } from './renderer';
import { spawnAgent } from './runtime/spawn-agent';
import { fail, formatCommand, formatPathList, uniqueSorted, verbose } from './utils';

export function main(invokedTool: string, argv: string[]): void {
	dispatch(parseInvocation(invokedTool, argv));
}

function dispatch(command: ParsedInvocation): void {
	switch (command.command) {
		case 'mcp':
		case 'create':
		case 'project':
			void import('./brain/cli').then(({ brainMain }) => brainMain(command.args, command.command))
				.catch((error: unknown) => { process.stderr.write(`agent-brain: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
			return;
		case 'check':
			runCheck(command);
			return;
		case 'status':
			runStatus(command);
			return;
		case 'init':
			runGenerate(command);
			return;
		case 'generate':
			runGenerate(command);
			return;
		case 'setup':
			runSetup(command);
			return;
		case 'edit':
			runEdit(command);
			return;
		case 'update':
			runUpdate(command);
			return;
		case 'migrate-config':
			runMigrateConfig(command);
			return;
		default:
			runTool(command);
	}
}

function runTool(parsed: RunCommand): void {
	const { args, command, wrapperArgs } = parsed;
	const adapter = getAgentAdapter(command);
	const projectRoot = findProjectRoot(process.cwd());
	verbose(`run ${command}: cwd=${process.cwd()} projectRoot=${projectRoot}`);
	validateRunModes(parsed, projectRoot);
	if (wrapperArgs.none || isIgnoredDir(projectRoot)) {
		verbose(`wrapper bypassed for ${command}${wrapperArgs.none ? ' via --none' : ' because project is ignored'}`);
		spawnAgent({
			command: findRealBinary(command),
			args: [...adapter.bypassArgs(wrapperArgs), ...args],
			cwd: process.cwd(),
			env: { ...process.env }
		});
		return;
	}

	const profileResult = resolveProfileResult(projectRoot);
	if (profileResult.profile === null) {
		fail(profileResult.reason);
	}
	const profile = profileResult.profile;
	const configRoot = defaultConfigRoot(projectRoot);
	const agentDir = path.join(configRoot, profile);
	if (wrapperArgs.show) {
		verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
		requireProfile(command, agentDir);
		showToolProfile(command, projectRoot, agentDir);
		return;
	}
	if (wrapperArgs.create) {
		runGenerate({ command: 'generate', targetPath: projectRoot });
	}
	verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
	prepareConfigRoot(configRoot);
	requireProfile(command, agentDir);
	migrateProfileOnStart(configRoot, agentDir, false);
	const preview = renderProfile(projectRoot, agentDir, true);
	ensureToolEnabled(preview.context, command);
	if (wrapperArgs.generate) {
		printUpdateSummary(syncRenderedProfile(preview));
		return;
	}

	checkLocalAiFiles(command, projectRoot, agentDir, preview.context, wrapperArgs.local);
	const realBinary = findRealBinary(command);
	const rendered = syncRenderedProfile(preview);
	const runtime = rendered.runtimes[command];
	if (!runtime) {
		fail(`no generated ${command} runtime found for profile ${rendered.profile}`);
	}
	spawnAgent(adapter.spawn(runtime, { binary: realBinary, passthroughArgs: args, wrapperArgs }));
}

function runStatus(_parsed: StatusCommand): void {
	const adapters = listAgentAdapters();
	const columns = adapters.map((adapter) => adapter.displayName);
	const capabilityRows = [
		['Instructions', 'instructions'],
		['Skills', 'skills'],
		['MCP', 'mcp'],
		['Hooks', 'hooks'],
		['Subagents', 'subagents'],
		['Headless', 'headless']
	] as const;
	const firstWidth = Math.max(...capabilityRows.map(([label]) => label.length));
	const widths = columns.map((label) => Math.max(label.length, 3));
	const header = `${''.padEnd(firstWidth)}  ${columns.map((label, index) => label.padStart(widths[index] ?? 3)).join('  ')}`;
	const rows = capabilityRows.map(([label, capability]) =>
		`${label.padEnd(firstWidth)}  ${adapters.map((adapter, index) => (adapter.capabilities[capability] ? 'yes' : '-').padStart(widths[index] ?? 3)).join('  ')}`
	);
	process.stdout.write(['Native agent capabilities', '', header, ...rows, ''].join('\n'));
}

function validateRunModes(parsed: RunCommand, projectRoot: string): void {
	const { command, wrapperArgs } = parsed;
	if (wrapperArgs.show && wrapperArgs.none) {
		fail('--show cannot be combined with --none');
	}
	if (wrapperArgs.generate && wrapperArgs.none) {
		fail('--generate cannot be combined with --none');
	}
	if (wrapperArgs.generate && wrapperArgs.show) {
		fail('--generate cannot be combined with --show');
	}
	if ((wrapperArgs.show || wrapperArgs.generate) && isIgnoredDir(projectRoot)) {
		fail(`cannot ${wrapperArgs.show ? 'show' : 'generate'} generated ${command} files for ignored project: ${projectRoot}`);
	}
}

function requireProfile(tool: ToolName | null, agentDir: string): void {
	if (isProfileConfigured(agentDir)) {
		return;
	}
	const label = tool ?? 'agent';
	process.stderr.write(`agent-run: no ${label} profile found for this project: ${agentDir}\n`);
	process.stderr.write('agent-run: run `agent-run generate` or use the tool with `--create`.\n');
	process.exit(1);
}

function checkLocalAiFiles(
	command: ToolName,
	projectRoot: string,
	agentDir: string,
	context: RenderContext,
	allowLocal: boolean
): void {
	const files = findLocalAiFiles(projectRoot, agentDir);
	if (!context.guardrails.forbidRepoAiFiles || files.length === 0) {
		return;
	}
	if (!allowLocal) {
		failForLocalAiFiles(command, projectRoot, files);
	}
	warnForLocalAiFiles(command, projectRoot, files);
}

function showToolProfile(command: ToolName, projectRoot: string, agentDir: string): void {
	const trace: RenderTrace = { sourceFiles: new Set<string>() };
	const rendered = renderProfile(projectRoot, agentDir, true, command, trace);
	ensureToolEnabled(rendered.context, command);
	process.stdout.write(
		[
			`Agent: ${command}`,
			`Profile: ${rendered.profile}`,
			`Project root: ${projectRoot}`,
			`Profile dir: ${agentDir}`,
			'',
			'Reads/includes:',
			...formatPathList(uniqueSorted([...trace.sourceFiles])),
			'',
			'Generates:',
			...formatPathList(uniqueSorted(rendered.files.map((file) => file.path))),
			''
		].join('\n')
	);
}

function ensureToolEnabled(context: RenderContext, command: ToolName): void {
	if (!context.tools[command]) {
		fail(`${command} is disabled for agent-run profile ${context.profile}`);
	}
}

function runGenerate(parsed: InitCommand | GenerateCommand): void {
	if (parsed.command === 'init') {
		process.stderr.write('agent-run: `init` is deprecated; use `agent-run generate [path]` instead.\n');
	}
	const projectRoot = activeProject(parsed.targetPath, 'generate');
	if (projectRoot === null) {
		return;
	}
	const agentDir = initializeProfileSource(projectRoot);
	migrateProfileOnStart(defaultConfigRoot(projectRoot), agentDir, false);
	printUpdateSummary(syncAgentProfile(projectRoot, agentDir));
}

function runSetup(parsed: SetupCommand): void {
	const projectRoot = findProjectRoot(process.cwd());
	const detectedProfile = resolveProfile(projectRoot);
	const profile = parsed.profile === null ? confirmProfile(detectedProfile) : requireValidProfile(parsed.profile);
	const configRoot = defaultConfigRoot(projectRoot);
	const sourcePath = starterConfigRootPath();
	if (!fs.existsSync(sourcePath)) {
		fail(`starter config skeleton not found: ${sourcePath}`);
	}
	copySkeletonTree(sourcePath, configRoot, new Set(['starter']));
	const agentDir = path.join(configRoot, profile);
	migrateProfileOnStart(configRoot, agentDir, false);
	copySkeletonTree(path.join(sourcePath, 'starter', 'basic-project'), agentDir);
	if (profile !== detectedProfile) {
		writeProjectProfileMapping(projectRoot, profile);
	}
	printUpdateSummary(syncAgentProfile(projectRoot, agentDir, { configRoot, profile }));
	process.stdout.write(`OK installed default config tree at ${configRoot}\n`);
}

function requireValidProfile(value: string): string {
	const parsed = parseProfile(value, 'setup profile');
	if (parsed.profile === null) {
		fail(parsed.reason);
	}
	return parsed.profile;
}

function confirmProfile(detectedProfile: string): string {
	process.stdout.write(`Detected profile: ${detectedProfile}\n`);
	const confirmation = promptLine('Is this correct? [Y/n] ').trim().toLowerCase();
	if (confirmation === '' || confirmation === 'y' || confirmation === 'yes') {
		return detectedProfile;
	}
	return requireValidProfile(promptLine('Profile (org/repo): '));
}

function promptLine(
	prompt: string,
	nonInteractiveMessage = 'setup requires a profile argument when input is not interactive'
): string {
	if (!process.stdin.isTTY) {
		fail(nonInteractiveMessage);
	}
	process.stdout.write(prompt);
	const bytes: number[] = [];
	const buffer = Buffer.alloc(1);
	while (fs.readSync(process.stdin.fd, buffer, 0, 1, null) === 1) {
		if (buffer[0] === 10) {
			break;
		}
		if (buffer[0] !== 13) {
			bytes.push(buffer[0] ?? 0);
		}
	}
	return Buffer.from(bytes).toString('utf8');
}

function writeProjectProfileMapping(projectRoot: string, profile: string): void {
	const envPath = path.join(projectRoot, ENV_FILE_NAME);
	const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').replace(/\r\n/g, '\n') : '';
	const lines = existing.length > 0 ? existing.replace(/\n+$/, '').split('\n') : [];
	const profileLine = `AGENT_RUN_PROFILE=${profile}`;
	const index = lines.findIndex((line) => /^\s*AGENT_RUN_PROFILE\s*=/.test(line));
	if (index >= 0) {
		lines[index] = profileLine;
	} else {
		lines.push(profileLine);
	}
	const content = `${lines.join('\n')}\n`;
	if (content !== existing) {
		fs.writeFileSync(envPath, content, 'utf8');
		verbose(`write ${envPath}`);
	}
}

function runEdit(parsed: EditCommand): void {
	const projectRoot = activeProject(parsed.targetPath, 'edit');
	if (projectRoot === null) {
		return;
	}
	const agentDir = initializeProfileSource(projectRoot);
	migrateProfileOnStart(defaultConfigRoot(projectRoot), agentDir, false);
	const editPath = createDefaultLocalFile(agentDir);
	syncAgentProfile(projectRoot, agentDir);
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
	const configRoot = defaultConfigRoot(projectRoot);
	const agentDir = resolveAgentDir(projectRoot);
	prepareConfigRoot(configRoot);
	requireProfile(null, agentDir);
	migrateProfileOnStart(configRoot, agentDir, false);
	printUpdateSummary(syncAgentProfile(projectRoot, agentDir));
}

function runUpdateAll(targetPath: string): void {
	const configRoot = targetPath === path.resolve(process.cwd()) ? defaultConfigRoot() : path.resolve(targetPath);
	if (!fs.existsSync(configRoot)) {
		fail(`missing config root: ${configRoot}`);
	}
	prepareConfigRoot(configRoot);
	const profileDirs = findProfileDirs(configRoot);
	for (const agentDir of profileDirs) {
		migrateProfileOnStart(configRoot, agentDir, false);
		const profile = path.relative(configRoot, agentDir).replace(/\\/g, '/');
		const projectRoot = projectRootForProfile(profile, configRoot);
		syncAgentProfile(projectRoot, agentDir, { configRoot, profile });
		process.stdout.write(`OK ${profile}\n`);
	}
	process.stdout.write(`Updated profiles: ${profileDirs.length}\n`);
}

function runMigrateConfig(parsed: MigrateConfigCommand): void {
	const configRoot = parsed.configRoot;
	if (!fs.existsSync(configRoot)) {
		fail(`missing config root: ${configRoot}`);
	}
	ensureConfigRootLayout(configRoot);
	ensureConfigRootGitignore(configRoot);
	migrateOldTemplates(configRoot);
	ensureDefaultGlobalTemplates(configRoot);
	ensureRootDefaultsFile(configRoot);
	const profileDirs = uniqueSorted([...findLegacyProfileDirs(configRoot), ...findProfileDirs(configRoot)]);
	let createdManifestCount = 0;
	let createdLocalCount = 0;
	let movedRuntimeCount = 0;
	let movedReviewCount = 0;
	let movedMemoryCount = 0;
	for (const agentDir of profileDirs) {
		const layout = migrateProfileOnStart(configRoot, agentDir, parsed.yes);
		const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
		if (!fs.existsSync(localPath) && fs.existsSync(path.join(agentDir, 'AGENTS-MODS.md'))) {
			fs.writeFileSync(
				localPath,
				convertLegacyTemplateVars(fs.readFileSync(path.join(agentDir, 'AGENTS-MODS.md'), 'utf8')),
				'utf8'
			);
			createdLocalCount += 1;
		}
		if (!fs.existsSync(path.join(agentDir, MANIFEST_FILE_NAME))) {
			createProfileMarker(agentDir);
			createdManifestCount += 1;
		}
		movedRuntimeCount += migrateCodexRuntimeFiles(agentDir);
		movedReviewCount += migrateLooseFiles(agentDir, /^REVIEW(?:-.+)?\.md$/, 'reviews');
		movedMemoryCount += layout.projectMemoryMoves;
	}
	process.stdout.write(`OK migrated ${configRoot}\n`);
	process.stdout.write(`Profiles converted: ${profileDirs.length}\n`);
	process.stdout.write(`Created local.md.njk: ${createdLocalCount}\n`);
	process.stdout.write(`Created agent-run.jsonc: ${createdManifestCount}\n`);
	process.stdout.write(`Moved Codex runtime entries: ${movedRuntimeCount}\n`);
	process.stdout.write(`Moved review files: ${movedReviewCount}\n`);
	process.stdout.write(`Moved memory files: ${movedMemoryCount}\n`);
}

function migrateProfileOnStart(configRoot: string, profileDir: string, assumeYes: boolean) {
	const result = migrateProfileLayout(configRoot, profileDir, ({ gitRoot, moves }) => {
		process.stdout.write('agent-run: this profile uses an older project-memory layout.\n');
		process.stdout.write(`Git working tree: ${gitRoot}\n`);
		for (const move of moves) {
			process.stdout.write(`  ${path.relative(gitRoot, move.source)} -> ${path.relative(gitRoot, move.target)}\n`);
		}
		if (assumeYes) {
			return true;
		}
		const migrateCommand = formatCommand('agent-run', ['migrate-config', '--yes', configRoot]);
		const message = `tracked project-memory files need migration; rerun interactively or run \`${migrateCommand}\``;
		const answer = promptLine('Stage these moves with git mv? [Y/n] ', message).trim().toLowerCase();
		return answer === '' || answer === 'y' || answer === 'yes';
	});
	if (result.gitMoves > 0) {
		process.stdout.write(`Staged Git moves: ${result.gitMoves}\n`);
	}
	if (result.runtimeMoves > 0) {
		process.stdout.write(`Moved local Codex runtime entries: ${result.runtimeMoves}\n`);
	}
	return result;
}

function runCheck(parsed: CheckCommand): void {
	if (parsed.all) {
		const report = checkSourceTree(parsed.targetPath);
		printBatchReport(report.root, report.entries);
		process.exit(report.hasErrors ? 1 : 0);
	}
	const projectRoot = findProjectRoot(parsed.targetPath);
	if (isIgnoredDir(projectRoot)) {
		process.stdout.write(`Check: ${projectRoot}\nSKIP ignored by .agent-run-ignore\n`);
		process.exit(0);
	}
	const findings = checkProject(projectRoot);
	printProjectReport(projectRoot, findings);
	process.exit(hasErrors(findings) ? 1 : 0);
}

function prepareConfigRoot(configRoot: string): void {
	ensureConfigRootLayout(configRoot);
	ensureConfigRootGitignore(configRoot);
	ensureDefaultGlobalTemplates(configRoot);
}

function activeProject(targetPath: string, action: 'generate' | 'edit'): string | null {
	const projectRoot = findProjectRoot(targetPath);
	verbose(`${action} target=${targetPath} projectRoot=${projectRoot}`);
	if (!isIgnoredDir(projectRoot)) {
		return projectRoot;
	}
	process.stdout.write(`SKIP ignored ${projectRoot}\n`);
	return null;
}

function initializeProfileSource(projectRoot: string): string {
	const configRoot = defaultConfigRoot(projectRoot);
	const resolved = resolveProfileResult(projectRoot, configRoot, false);
	if (!resolved.profile) throw new Error(resolved.reason);
	const profile = resolved.profile;
	const agentDir = path.join(configRoot, profile);
	prepareConfigRoot(configRoot);
	ensureRootDefaultsFile(configRoot);
	fs.mkdirSync(agentDir, { recursive: true });
	convertLegacyProfileIfNeeded(agentDir);
	createProfileMarker(agentDir);
	return agentDir;
}

function printUpdateSummary(rendered: RenderedProfile): void {
	process.stdout.write(`OK profile ${rendered.profile}\n`);
	process.stdout.write(`Profile dir: ${rendered.agentDir}\n`);
	process.stdout.write(`Live dir: ${rendered.context.paths.liveDir}\n`);
	process.stdout.write(`Generated files: ${rendered.files.length}\n`);
	process.stdout.write(`Installed skills: ${rendered.skills.map((skill) => skill.name).join(', ') || '(none)'}\n`);
}
