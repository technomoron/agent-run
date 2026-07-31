import * as fs from 'fs';
import * as path from 'path';
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
	starterConfigRootPath
} from './config-tree';
import { LOCAL_TEMPLATE_FILE_NAME, MANIFEST_FILE_NAME } from './constants';
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
	InitCommand,
	InitConfigCommand,
	MigrateConfigCommand,
	ParsedInvocation,
	RenderContext,
	RenderedProfile,
	RenderTrace,
	RunCommand,
	ToolName,
	UpdateCommand
} from './model';
import { execTool, findRealBinary, openEditor } from './process';
import {
	defaultConfigRoot,
	failForLocalAiFiles,
	findLocalAiFiles,
	findProjectRoot,
	isIgnoredDir,
	projectRootForProfile,
	resolveAgentDir,
	resolveProfile,
	resolveProfileResult,
	warnForLocalAiFiles
} from './project';
import { renderProfile, syncAgentProfile } from './renderer';
import { getDangerArgs, getPermissionArgs, runClaude, runCodex } from './tools';
import { fail, formatPathList, uniqueSorted, verbose } from './utils';

export function main(invokedTool: string, argv: string[]): void {
	dispatch(parseInvocation(invokedTool, argv));
}

function dispatch(command: ParsedInvocation): void {
	switch (command.command) {
		case 'check':
			runCheck(command);
			return;
		case 'init':
			runInit(command);
			return;
		case 'init-config':
			runInitConfig(command);
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
	const projectRoot = findProjectRoot(process.cwd());
	verbose(`run ${command}: cwd=${process.cwd()} projectRoot=${projectRoot}`);
	validateRunModes(parsed, projectRoot);
	if (wrapperArgs.none || isIgnoredDir(projectRoot)) {
		verbose(`wrapper bypassed for ${command}${wrapperArgs.none ? ' via --none' : ' because project is ignored'}`);
		const runtimeArgs = wrapperArgs.sandboxMode === 'danger' ? getDangerArgs(command) : getPermissionArgs(command);
		execTool(findRealBinary(command), [...runtimeArgs, ...args]);
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
		requireProfile(command, agentDir);
		showToolProfile(command, projectRoot, agentDir);
		return;
	}
	if (wrapperArgs.create) {
		runInit({ command: 'init', targetPath: projectRoot });
	}
	const configRoot = defaultConfigRoot(projectRoot);
	const agentDir = path.join(configRoot, profile);
	verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
	prepareConfigRoot(configRoot);
	requireProfile(command, agentDir);
	const preview = renderProfile(projectRoot, agentDir, true, command);
	ensureToolEnabled(preview.context, command);
	if (wrapperArgs.generate) {
		printUpdateSummary(syncAgentProfile(projectRoot, agentDir));
		return;
	}

	checkLocalAiFiles(command, projectRoot, agentDir, preview.context, wrapperArgs.local);
	const realBinary = findRealBinary(command);
	const permissionArgs = getPermissionArgs(command);
	const rendered = syncAgentProfile(projectRoot, agentDir);
	if (command === 'codex') {
		runCodex(realBinary, permissionArgs, rendered.context, args, wrapperArgs);
	} else {
		runClaude(realBinary, permissionArgs, rendered.context, args, wrapperArgs);
	}
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
	process.stderr.write('agent-run: run `agent-run init` or use the tool with `--create`.\n');
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

function runInit(parsed: InitCommand): void {
	const projectRoot = activeProject(parsed.targetPath, 'init');
	if (projectRoot === null) {
		return;
	}
	const agentDir = initializeProfileSource(projectRoot, true);
	printUpdateSummary(syncAgentProfile(projectRoot, agentDir));
}

function runInitConfig(parsed: InitConfigCommand): void {
	const sourcePath = starterConfigRootPath();
	if (!fs.existsSync(sourcePath)) {
		fail(`starter config skeleton not found: ${sourcePath}`);
	}
	copySkeletonTree(sourcePath, path.resolve(parsed.targetPath));
	process.stdout.write(`OK copied starter config to ${path.resolve(parsed.targetPath)}\n`);
}

function runEdit(parsed: EditCommand): void {
	const projectRoot = activeProject(parsed.targetPath, 'edit');
	if (projectRoot === null) {
		return;
	}
	const agentDir = initializeProfileSource(projectRoot, false);
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
	const profileDirs = findLegacyProfileDirs(configRoot);
	let createdManifestCount = 0;
	let createdLocalCount = 0;
	let movedRuntimeCount = 0;
	let movedReviewCount = 0;
	let movedMemoryCount = 0;
	for (const agentDir of profileDirs) {
		const localPath = path.join(agentDir, LOCAL_TEMPLATE_FILE_NAME);
		if (!fs.existsSync(localPath)) {
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
		movedMemoryCount += migrateLooseFiles(agentDir, /^memory.*\.md$/i, 'memories');
	}
	process.stdout.write(`OK migrated ${configRoot}\n`);
	process.stdout.write(`Profiles converted: ${profileDirs.length}\n`);
	process.stdout.write(`Created local.md.njk: ${createdLocalCount}\n`);
	process.stdout.write(`Created agent-run.jsonc: ${createdManifestCount}\n`);
	process.stdout.write(`Moved Codex runtime entries: ${movedRuntimeCount}\n`);
	process.stdout.write(`Moved review files: ${movedReviewCount}\n`);
	process.stdout.write(`Moved memory files: ${movedMemoryCount}\n`);
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

function activeProject(targetPath: string, action: 'init' | 'edit'): string | null {
	const projectRoot = findProjectRoot(targetPath);
	verbose(`${action} target=${targetPath} projectRoot=${projectRoot}`);
	if (!isIgnoredDir(projectRoot)) {
		return projectRoot;
	}
	process.stdout.write(`SKIP ignored ${projectRoot}\n`);
	return null;
}

function initializeProfileSource(projectRoot: string, preferProjectConfigRoot: boolean): string {
	const profile = resolveProfile(projectRoot);
	const configRoot = defaultConfigRoot(projectRoot, { preferProjectRoot: preferProjectConfigRoot });
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
