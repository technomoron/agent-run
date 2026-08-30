import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import {
	GENERATED_GITIGNORE_ENTRIES,
	IS_WINDOWS,
	LOCAL_TEMPLATE_FILE_NAME,
	MANIFEST_FILE_NAME
} from './constants';
import { ensureConfigRootGitignore } from './config-tree';
import {
	defaultClaudeSettingsContent,
	defaultCodexConfigContent,
	defaultToolInstructionsTemplate,
	legacyDefaultClaudeSettingsContent
} from './defaults';
import { renderGuardShims } from './guards';
import { loadManifest, normalizeManifest } from './manifest';
import { Finding, NormalizedManifest, RenderContext, RenderedFile, RenderedProfile, RenderTrace, ToolName } from './model';
import { defaultConfigRoot, parseProfile, resolveProfile } from './project';
import {
	assertNoUnexpandedTemplateVars,
	buildRenderContext,
	createNunjucksEnv,
	renderTemplateFile,
	resolveConfigPath
} from './templates';
import {
	formatError,
	isSamePathOrDescendant,
	isSymlink,
	nextBackupPath,
	verbose
} from './utils';

export function renderProfile(
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
	validateManifestProfile(manifest.profile, profile, agentDir);
	if (!checkOnly) {
		ensureConfigRootGitignore(configRoot);
	}

	const context = buildRenderContext(projectRoot, agentDir, configRoot, manifest, env);
	context.renderedAgentSections = renderAgentSections(env, configRoot, manifest, context, trace);
	context.skills = renderSkills(env, configRoot, manifest, context, trace);
	const files = renderProfileFiles(env, configRoot, context, targetTool, trace);
	return { agentDir, configRoot, profile, context, files, skills: context.skills };
}

function validateManifestProfile(manifestProfile: string, inferredProfile: string, agentDir: string): void {
	if (manifestProfile === inferredProfile) {
		return;
	}
	const parsed = parseProfile(manifestProfile, `${path.join(agentDir, MANIFEST_FILE_NAME)} profile`);
	if (parsed.profile === null) {
		throw new Error(parsed.reason);
	}
	throw new Error(
		`${path.join(agentDir, MANIFEST_FILE_NAME)} profile must match inferred profile ${inferredProfile}`
	);
}

function renderAgentSections(
	env: nunjucks.Environment,
	configRoot: string,
	manifest: NormalizedManifest,
	context: RenderContext,
	trace?: RenderTrace
): string[] {
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
	return sections.map((section, index) => {
		const label = index === 0 ? manifest.agent.base : manifest.agent.includes[index - 1] ?? `section ${index}`;
		assertNoUnexpandedTemplateVars(label, section);
		return section.trimEnd();
	});
}

function renderProfileFiles(
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	targetTool: ToolName | null,
	trace?: RenderTrace
): RenderedFile[] {
	const files: RenderedFile[] = [];
	if (context.tools.codex && (targetTool === null || targetTool === 'codex')) {
		files.push({
			path: path.join(context.paths.codexHomeDir, 'AGENTS.md'),
			content: renderToolInstructions('AGENTS.md', env, configRoot, context, false, trace)
		});
		files.push({
			path: path.join(context.paths.codexHomeDir, 'config.toml'),
			content: renderCodexConfig(env, configRoot, context, trace)
		});
		files.push(...renderNativeSkillFiles(context, 'codex'));
	}
	if (context.tools.claude && (targetTool === null || targetTool === 'claude')) {
		files.push({
			path: path.join(context.paths.liveDir, 'CLAUDE.md'),
			content: renderToolInstructions('CLAUDE.md', env, configRoot, context, true, trace)
		});
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
	return files;
}

export function syncAgentProfile(
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

function writeGeneratedFile(filePath: string, content: string, executable: boolean): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	const unchanged = fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content;
	if (!unchanged) {
		fs.writeFileSync(filePath, content, 'utf8');
		verbose(`write ${filePath}`);
	}
	if (executable && !IS_WINDOWS) {
		const currentMode = fs.statSync(filePath).mode & 0o777;
		if (currentMode !== 0o755) {
			fs.chmodSync(filePath, 0o755);
			verbose(`chmod 755 ${filePath}`);
		}
	}
}

function removeStaleGeneratedEntries(rendered: RenderedProfile): void {
	const expectedFiles = new Set(rendered.files.map((file) => path.resolve(file.path)));
	const context = rendered.context;
	const generatedCandidates = [
		path.join(context.paths.codexHomeDir, 'AGENTS.md'),
		path.join(context.paths.codexHomeDir, 'config.toml'),
		path.join(context.paths.liveDir, 'CLAUDE.md'),
		path.join(context.paths.liveDir, '.claude', 'CLAUDE.md'),
		path.join(context.paths.liveDir, '.claude', 'agent-run-settings.json'),
		path.join(context.paths.liveDir, '.claude', '.claude-plugin', 'plugin.json'),
		...['git', 'git.cmd', 'npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'gh', 'gh.cmd'].map((name) =>
			path.join(context.paths.binDir, name)
		)
	];
	for (const filePath of generatedCandidates) {
		if (!expectedFiles.has(path.resolve(filePath))) {
			fs.rmSync(filePath, { force: true });
		}
	}

	const skillNames = new Set(rendered.skills.map((skill) => skill.name));
	removeStaleGeneratedSkills(
		context.paths.codexSkillsDir,
		context.tools.codex ? skillNames : new Set<string>(),
		new Set(['.system'])
	);
	removeStaleGeneratedSkills(
		context.paths.claudeSkillsDir,
		context.tools.claude ? skillNames : new Set<string>()
	);
}

function removeStaleGeneratedSkills(dir: string, expectedNames: Set<string>, preservedNames = new Set<string>()): void {
	if (!fs.existsSync(dir)) {
		return;
	}
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!expectedNames.has(entry.name) && !preservedNames.has(entry.name)) {
			fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
		}
	}
}

function removeLegacyGeneratedCodexFiles(context: RenderContext): void {
	for (const legacyPath of [
		path.join(context.paths.liveDir, 'AGENTS.md'),
		path.join(context.paths.liveDir, 'config.toml')
	]) {
		if (fs.existsSync(legacyPath)) {
			fs.rmSync(legacyPath);
			verbose(`removed legacy generated Codex file ${legacyPath}`);
		}
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
		const generated = [
			legacyDefaultClaudeSettingsContent(context, context.agentDir),
			legacyDefaultClaudeSettingsContent(context, context.profileDir)
		];
		if (generated.includes(actual)) {
			fs.rmSync(legacyPath);
			verbose(`removed legacy generated Claude settings ${legacyPath}`);
		}
	}
}

export function checkRenderedProfile(projectRoot: string, agentDir: string): Finding[] {
	const findings: Finding[] = [];
	const configRoot = defaultConfigRoot(projectRoot);
	try {
		const rendered = renderProfile(projectRoot, agentDir, true);
		checkRenderedFiles(rendered, findings);
		checkRuntimeDirectories(rendered.context, findings);
		for (const skill of rendered.skills) {
			validateRenderedSkill(skill.renderedContent, skill.sourcePath);
		}
	} catch (error) {
		findings.push({
			message: `failed to render profile ${agentDir}: ${formatError(error)}`,
			severity: 'ERROR'
		});
	}
	checkConfigGitignore(configRoot, findings);
	return findings;
}

function checkRenderedFiles(rendered: RenderedProfile, findings: Finding[]): void {
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
}

function checkRuntimeDirectories(context: RenderContext, findings: Finding[]): void {
	for (const dir of [
		context.paths.reviewDir,
		context.paths.memoriesDir,
		context.paths.codexHomeDir,
		context.paths.liveDir,
		context.paths.codexSkillsDir,
		context.paths.claudeSkillsDir,
		context.paths.binDir
	]) {
		if (!fs.existsSync(dir)) {
			findings.push({ message: `missing generated runtime directory: ${dir}`, severity: 'ERROR' });
		}
	}
}

function checkConfigGitignore(configRoot: string, findings: Finding[]): void {
	const gitignorePath = path.join(configRoot, '.gitignore');
	if (!fs.existsSync(gitignorePath)) {
		findings.push({ message: `missing config root .gitignore: ${gitignorePath}`, severity: 'ERROR' });
		return;
	}
	const gitignore = fs.readFileSync(gitignorePath, 'utf8');
	for (const entry of GENERATED_GITIGNORE_ENTRIES) {
		if (entry && !entry.startsWith('#') && !gitignore.includes(entry)) {
			findings.push({ message: `config root .gitignore missing entry: ${entry}`, severity: 'ERROR' });
		}
	}
}

function renderSkills(
	env: nunjucks.Environment,
	configRoot: string,
	manifest: NormalizedManifest,
	context: RenderContext,
	trace?: RenderTrace
): RenderContext['skills'] {
	return manifest.skills.install.map((name) => {
		const sourceTemplate = manifest.skills.overrides[name] ?? `global/skills/${name}/SKILL.md.njk`;
		const sourcePath = resolveConfigPath(configRoot, sourceTemplate, context as unknown as Record<string, unknown>);
		if (!fs.existsSync(sourcePath)) {
			throw new Error(`missing skill template for ${name}: ${sourcePath}`);
		}
		const renderedContent = renderTemplateFile(env, configRoot, sourceTemplate, context, trace);
		assertNoUnexpandedTemplateVars(`skill ${name}`, renderedContent);
		validateRenderedSkill(renderedContent, sourcePath);
		return { name, sourcePath, renderedContent, description: extractSkillDescription(renderedContent) };
	});
}

function renderNativeSkillFiles(context: RenderContext, targetTool: ToolName): RenderedFile[] {
	const targetDir = targetTool === 'codex' ? context.paths.codexSkillsDir : context.paths.claudeSkillsDir;
	return context.skills.map((skill) => ({
		path: path.join(targetDir, skill.name, 'SKILL.md'),
		content: skill.renderedContent
	}));
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
	const content = fs.existsSync(path.join(configRoot, templatePath))
		? renderTemplateFile(env, configRoot, templatePath, context, trace)
		: env.renderString(defaultToolInstructionsTemplate(isClaude), context);
	assertNoUnexpandedTemplateVars(templateName, content);
	return content.replace(/\n*$/, '\n');
}

function renderCodexConfig(
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	trace?: RenderTrace
): string {
	const templatePath = resolveProfileOverrideTemplate(
		configRoot,
		context,
		'codex-config.toml.njk',
		'global/tool-templates/codex-config.toml.njk'
	);
	const content = templatePath
		? renderTemplateFile(env, configRoot, templatePath, context, trace)
		: defaultCodexConfigContent(context);
	assertNoUnexpandedTemplateVars('config.toml', content);
	return content.replace(/\n*$/, '\n');
}

function renderClaudeSettings(
	env: nunjucks.Environment,
	configRoot: string,
	context: RenderContext,
	trace?: RenderTrace
): string {
	const templatePath = resolveProfileOverrideTemplate(
		configRoot,
		context,
		'claude-settings.json.njk',
		'global/tool-templates/claude-settings.json.njk'
	);
	const content = templatePath
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
			author: { name: 'Technomoron' }
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
	return fs.existsSync(path.join(configRoot, globalTemplatePath)) ? globalTemplatePath : null;
}

function syncRuntimeDirs(context: RenderContext): void {
	for (const dir of [
		context.paths.reviewDir,
		context.paths.memoriesDir,
		context.paths.codexHomeDir,
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
	if (path.resolve(profileAuthPath) === path.resolve(sharedAuthPath) || isSymlinkTo(profileAuthPath, sharedAuthPath)) {
		return;
	}
	if (fs.existsSync(profileAuthPath) || isSymlink(profileAuthPath)) {
		const backupPath = nextBackupPath(profileAuthPath);
		fs.renameSync(profileAuthPath, backupPath);
		verbose(`backed up profile Codex auth ${profileAuthPath} -> ${backupPath}`);
	}
	fs.mkdirSync(path.dirname(profileAuthPath), { recursive: true });
	try {
		fs.symlinkSync(sharedAuthPath, profileAuthPath);
		verbose(`linked profile Codex auth ${profileAuthPath} -> ${sharedAuthPath}`);
	} catch (error) {
		if (!IS_WINDOWS) {
			throw error;
		}
		fs.copyFileSync(sharedAuthPath, profileAuthPath);
		verbose(`copied shared Codex auth ${sharedAuthPath} -> ${profileAuthPath}`);
	}
}

function isSymlinkTo(filePath: string, targetPath: string): boolean {
	try {
		if (!fs.lstatSync(filePath).isSymbolicLink()) {
			return false;
		}
		const linkTarget = fs.readlinkSync(filePath);
		return path.resolve(path.dirname(filePath), linkTarget) === path.resolve(targetPath);
	} catch {
		return false;
	}
}

function removeLegacyCodexSkillDirs(context: RenderContext): void {
	const legacyCodexDir = path.join(context.paths.liveDir, '.agents');
	if (!isSamePathOrDescendant(context.paths.codexSkillsDir, legacyCodexDir)) {
		fs.rmSync(legacyCodexDir, { recursive: true, force: true });
	}
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
		fs.rmSync(dir, { recursive: true, force: true });
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
		if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
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
	return folded?.[1]
		? folded[1].split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
		: '';
}
