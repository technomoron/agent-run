import * as fs from 'fs';
import * as path from 'path';
import * as nunjucks from 'nunjucks';
import { LIVE_DIR_NAME, UNEXPANDED_TEMPLATE_RE } from './constants';
import { NormalizedManifest, RenderContext, RenderTrace } from './model';
import { isSamePathOrDescendant, localDateString } from './utils';

export function createNunjucksEnv(configRoot: string): nunjucks.Environment {
	return new nunjucks.Environment(new nunjucks.FileSystemLoader(configRoot, { noCache: true }), {
		autoescape: false,
		trimBlocks: true,
		lstripBlocks: true,
		throwOnUndefined: true
	});
}

export function buildRenderContext(
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
		mcpServers: manifest.mcpServers,
		guardrails: manifest.guardrails
	};
	const reviewDir = resolveRuntimePath(configRoot, manifest.paths.reviewDir, env, baseContext);
	const memoriesDir = resolveRuntimePath(configRoot, manifest.paths.memoriesDir, env, baseContext);
	const projectMemoryDir = resolveRuntimePath(configRoot, manifest.paths.projectMemoryDir, env, baseContext);
	const codexHomeDir = path.join(memoriesDir, 'codex-home');
	const geminiRuntimeDir = path.join(liveDir, 'gemini');
	const geminiHomeDir = path.join(geminiRuntimeDir, 'home');
	const grokRuntimeDir = path.join(liveDir, 'grok');
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
		globalMemoryDir: path.join(configRoot, 'notes', 'memory'),
		projectMemoryDir,
		nativeMemoryDir: path.join(codexHomeDir, 'memories'),
		codexHomeDir,
		overridesDir: path.join(profileDir, 'overrides'),
		codexSkillsDir: path.join(codexHomeDir, 'skills'),
		claudeSkillsDir: path.join(liveDir, '.claude', 'skills'),
		geminiRuntimeDir,
		geminiHomeDir,
		geminiSkillsDir: path.join(geminiHomeDir, '.agents', 'skills'),
		grokRuntimeDir,
		grokSkillsDir: path.join(grokRuntimeDir, 'skills'),
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
		const normalized = check.trim();
		if (normalized) {
			allow.add(`Bash(${normalized})`);
		}
	}
	return [...allow];
}

export function resolveConfigPath(
	configRoot: string,
	relativePath: string,
	context: Record<string, unknown>
): string {
	const rendered = createNunjucksEnv(configRoot).renderString(relativePath, context);
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
	const rendered = env.renderString(pathTemplate, context);
	return path.isAbsolute(rendered) ? path.resolve(rendered) : path.resolve(configRoot, rendered);
}

export function renderTemplateFile(
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
		return env.renderString(content, context);
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
	const includePattern = /{%\s*(?:include|extends|import)\s+["']([^"']+)["']|{%\s*from\s+["']([^"']+)["']/g;
	for (const match of content.matchAll(includePattern)) {
		const includePath = match[1] ?? match[2];
		if (!includePath) {
			continue;
		}
		const includedPath = resolveConfigPath(configRoot, includePath, context as Record<string, unknown>);
		if (fs.existsSync(includedPath)) {
			traceTemplateSource(
				configRoot,
				includedPath,
				fs.readFileSync(includedPath, 'utf8'),
				context,
				trace,
				nextStack
			);
		}
	}
}

export function assertNoUnexpandedTemplateVars(label: string, content: string): void {
	if (UNEXPANDED_TEMPLATE_RE.test(content)) {
		throw new Error(`unexpanded template syntax remains in ${label}`);
	}
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
			if (marker && marker[0] === fence.character && marker.length >= fence.length && !trimmed.slice(marker.length).trim()) {
				fence = null;
			}
			continue;
		}
		if (!contentStarted && !trimmed) {
			continue;
		}
		if (fenceMatch?.[1]) {
			fence = { character: fenceMatch[1][0] ?? '`', length: fenceMatch[1].length };
		}
		if (fence === null && !isIndentedCode && trimmed.startsWith('@')) {
			const includePath = trimmed.slice(1).trim();
			if (includePath) {
				const resolvedInclude = resolveIncludePath(resolvedSource, includePath);
				trace?.sourceFiles.add(resolvedInclude);
				output.push(renderLegacyAgentsMods(resolvedInclude, nextStack, trace));
				if (!contentStarted) {
					sawLeadingInclude = true;
				}
			}
			continue;
		}
		if (sawLeadingInclude && !insertedOverrideNote) {
			output.push('', 'If anything below this point conflicts with anything included above,');
			output.push('the later instructions below take precedence.', '');
			insertedOverrideNote = true;
		}
		output.push(line);
		contentStarted = true;
	}
	return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function resolveIncludePath(sourceFile: string, includePath: string): string {
	if (path.isAbsolute(includePath)) {
		return includePath;
	}
	const sourceRelativePath = path.resolve(path.dirname(sourceFile), includePath);
	if (fs.existsSync(sourceRelativePath)) {
		return sourceRelativePath;
	}
	return path.resolve(findIncludeRoot(sourceFile), includePath.replace(/^(\.\.\/)+/, ''));
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
