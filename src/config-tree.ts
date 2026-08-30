import * as fs from 'fs';
import * as path from 'path';
import {
	GENERATED_GITIGNORE_ENTRIES,
	LIVE_DIR_NAME,
	LOCAL_TEMPLATE_FILE_NAME,
	MANIFEST_FILE_NAME
} from './constants';
import { defaultGlobalTemplates } from './defaults';
import { isSymlink, nextBackupPath, verbose } from './utils';
import { walkTree } from './walk-tree';

const PRUNED_CONFIG_DIRS = new Set([
	'.git',
	'orphaned',
	'global',
	'templates',
	'.agents',
	'.claude',
	'.codex',
	'bin',
	'reviews',
	'memories',
	'cache',
	'log',
	'sessions',
	'shell_snapshots',
	'skills',
	'tmp',
	'.tmp'
]);

export function ensureConfigRootLayout(configRoot: string): void {
	fs.mkdirSync(configRoot, { recursive: true });
}

export function ensureConfigRootGitignore(configRoot: string): void {
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
	if (changed) {
		fs.writeFileSync(gitignorePath, `${lines.join('\n')}\n`, 'utf8');
	}
}

export function ensureDefaultGlobalTemplates(configRoot: string): void {
	for (const [relativePath, content] of defaultGlobalTemplates()) {
		const filePath = path.join(configRoot, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, content, 'utf8');
			verbose(`created ${filePath}`);
		}
	}
}

export function migrateOldTemplates(configRoot: string): void {
	const oldCodeTemplate = path.join(configRoot, 'templates', 'AGENTS-CODE.md');
	const newCodeTemplate = path.join(configRoot, 'global', 'agents', 'code.md.njk');
	if (!fs.existsSync(oldCodeTemplate) || fs.existsSync(newCodeTemplate)) {
		return;
	}
	fs.mkdirSync(path.dirname(newCodeTemplate), { recursive: true });
	fs.writeFileSync(newCodeTemplate, convertLegacyTemplateVars(fs.readFileSync(oldCodeTemplate, 'utf8')), 'utf8');
}

export function findLegacyProfileDirs(configRoot: string): string[] {
	return findConfigDirs(configRoot, (dir) => fs.existsSync(path.join(dir, 'AGENTS-MODS.md')));
}

export function findProfileDirs(configRoot: string): string[] {
	return findConfigDirs(
		configRoot,
		(dir) =>
			fs.existsSync(path.join(dir, MANIFEST_FILE_NAME)) ||
			fs.existsSync(path.join(dir, LOCAL_TEMPLATE_FILE_NAME))
	);
}

function findConfigDirs(configRoot: string, matches: (dir: string) => boolean): string[] {
	const dirs: string[] = [];
	walkTree(configRoot, (fullPath, entry) => {
		if (!entry.isDirectory()) {
			return undefined;
		}
		if (matches(fullPath)) {
			dirs.push(fullPath);
			return 'skip';
		}
		return undefined;
	}, { shouldPrune: (entry) => entry.isDirectory() && PRUNED_CONFIG_DIRS.has(entry.name) });
	return dirs.sort();
}

export function convertLegacyTemplateVars(content: string): string {
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
	return converted.replace(/^@[^\n]*templates\/AGENTS-CODE\.md[^\n]*\n?/gm, '').replace(/^\n{2,}/, '\n');
}

export function migrateCodexRuntimeFiles(agentDir: string): number {
	const runtimeName = /^(?:\.personality_migration|\.tmp|auth\.json|cache|history\.jsonl|installation_id|log|logs|models_cache\.json|sessions|archived_sessions|shell_snapshots|skills|tmp|version\.json)$/;
	const databaseName = /^(?:logs|state)_.*\.sqlite(?:-.+)?$/;
	const runtimeNames = fs.readdirSync(agentDir).filter((name) => runtimeName.test(name) || databaseName.test(name));
	const codexHome = path.join(agentDir, LIVE_DIR_NAME, 'memories', 'codex-home');
	let moved = 0;
	for (const name of runtimeNames) {
		const source = path.join(agentDir, name);
		if (!fs.existsSync(source) && !isSymlink(source)) {
			continue;
		}
		const initialTarget = path.join(codexHome, name);
		const target = fs.existsSync(initialTarget) || isSymlink(initialTarget) ? nextBackupPath(initialTarget) : initialTarget;
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.renameSync(source, target);
		moved += 1;
	}
	return moved;
}

export function migrateLooseFiles(agentDir: string, pattern: RegExp, targetDirName: string): number {
	let moved = 0;
	for (const entry of fs.readdirSync(agentDir, { withFileTypes: true })) {
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

export function starterConfigRootPath(): string {
	return path.resolve(__dirname, '..', 'examples', 'basic-config', 'agent-config');
}

export function copySkeletonTree(
	sourceDir: string,
	targetDir: string,
	excludedNames: ReadonlySet<string> = new Set()
): void {
	fs.mkdirSync(targetDir, { recursive: true });
	const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (excludedNames.has(entry.name)) {
			continue;
		}
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name === 'gitignore' ? '.gitignore' : entry.name);
		if (entry.isDirectory()) {
			copySkeletonTree(sourcePath, targetPath, excludedNames);
		} else if (entry.isFile() && !fs.existsSync(targetPath)) {
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.copyFileSync(sourcePath, targetPath);
		}
	}
}
