import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
	GENERATED_GITIGNORE_ENTRIES,
	LIVE_DIR_NAME,
	LOCAL_TEMPLATE_FILE_NAME,
	MANIFEST_FILE_NAME
} from './constants';
import { defaultGlobalTemplates } from './defaults';
import { isSamePathOrDescendant, isSymlink, nextBackupPath, verbose } from './utils';
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

type PlannedMove = {
	source: string;
	target: string;
};

export type ProfileLayoutMigrationResult = {
	gitMoves: number;
	projectMemoryMoves: number;
	runtimeMoves: number;
};

export type GitMoveConfirmation = {
	gitRoot: string;
	moves: PlannedMove[];
};

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

export function ensurePortableSystemdFiles(configRoot: string): void {
	const packageRoot = path.resolve(__dirname, '..');
	const files = new Map<string, { source: string; mode: number }>([
		['install-systemd-jobs.sh', { source: 'scripts/install-systemd-jobs.sh', mode: 0o755 }],
		['update-ai-tools.sh', { source: 'scripts/update-ai-tools.sh', mode: 0o755 }],
		['ai-tools-update.service', { source: 'ops/systemd/ai-tools-update.service', mode: 0o644 }],
		['ai-tools-update.timer', { source: 'ops/systemd/ai-tools-update.timer', mode: 0o644 }]
	]);
	for (const [targetName, asset] of files) {
		const sourcePath = path.join(packageRoot, asset.source);
		const targetPath = path.join(configRoot, targetName);
		if (!fs.existsSync(sourcePath)) {
			continue;
		}
		fs.copyFileSync(sourcePath, targetPath);
		fs.chmodSync(targetPath, asset.mode);
		verbose(`updated ${targetPath}`);
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

export function describeLegacyProfileLayout(profileDir: string): string[] {
	const paths: string[] = [];
	const legacyMemoryDir = path.join(profileDir, 'memory');
	if (fs.existsSync(legacyMemoryDir)) {
		paths.push(legacyMemoryDir);
	}
	for (const filePath of legacyProjectMemoryFiles(profileDir)) {
		paths.push(filePath);
	}
	const legacyCodexHome = path.join(profileDir, 'memories', 'codex-home');
	if (fs.existsSync(legacyCodexHome) || isSymlink(legacyCodexHome)) {
		paths.push(legacyCodexHome);
	}
	return [...new Set(paths)].sort();
}

export function migrateProfileLayout(
	configRoot: string,
	profileDir: string,
	confirmGitMoves: (confirmation: GitMoveConfirmation) => boolean
): ProfileLayoutMigrationResult {
	const projectMoves = planProjectMemoryMoves(profileDir);
	validateMoveTargets(projectMoves);
	const git = findGitWorktree(configRoot);
	const trackedMoves = git === null ? [] : projectMoves.filter((move) => isTrackedByGit(git, move.source));
	if (git !== null && trackedMoves.length > 0 && !confirmGitMoves({ gitRoot: git.root, moves: trackedMoves })) {
		throw new Error('profile layout migration declined; no files were moved');
	}

	let gitMoves = 0;
	for (const move of projectMoves) {
		fs.mkdirSync(path.dirname(move.target), { recursive: true });
		if (git !== null && trackedMoves.includes(move)) {
			runGitMove(git, move);
			gitMoves += 1;
		} else {
			fs.renameSync(move.source, move.target);
		}
		removeEmptyParents(path.dirname(move.source), profileDir);
		verbose(`moved project memory ${move.source} -> ${move.target}`);
	}
	removeEmptyParents(path.join(profileDir, 'memory'), profileDir);
	removeEmptyParents(path.join(profileDir, 'memories'), profileDir);

	const runtimeMoves = migrateLegacyCodexHome(profileDir);
	return { gitMoves, projectMemoryMoves: projectMoves.length, runtimeMoves };
}

function planProjectMemoryMoves(profileDir: string): PlannedMove[] {
	const targetDir = path.join(profileDir, 'notes', 'memory');
	const moves: PlannedMove[] = [];
	const legacyMemoryDir = path.join(profileDir, 'memory');
	for (const source of listTreeFiles(legacyMemoryDir)) {
		moves.push({ source, target: path.join(targetDir, path.relative(legacyMemoryDir, source)) });
	}
	for (const source of legacyProjectMemoryFiles(profileDir)) {
		moves.push({ source, target: path.join(targetDir, path.basename(source)) });
	}
	return moves.sort((left, right) => left.source.localeCompare(right.source));
}

function legacyProjectMemoryFiles(profileDir: string): string[] {
	const files: string[] = [];
	for (const entry of safeReadDir(profileDir)) {
		if (entry.isFile() && /^memory.*\.md$/i.test(entry.name)) {
			files.push(path.join(profileDir, entry.name));
		}
	}
	const legacyMemoriesDir = path.join(profileDir, 'memories');
	for (const entry of safeReadDir(legacyMemoriesDir)) {
		if (entry.isFile() && /\.md$/i.test(entry.name)) {
			files.push(path.join(legacyMemoriesDir, entry.name));
		}
	}
	return files.sort();
}

function safeReadDir(dir: string): fs.Dirent[] {
	try {
		return fs.readdirSync(dir, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return [];
		}
		throw error;
	}
}

function listTreeFiles(root: string): string[] {
	const files: string[] = [];
	for (const entry of safeReadDir(root)) {
		const filePath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...listTreeFiles(filePath));
		} else if (entry.isFile() || entry.isSymbolicLink()) {
			files.push(filePath);
		}
	}
	return files;
}

function validateMoveTargets(moves: PlannedMove[]): void {
	const targets = new Set<string>();
	for (const move of moves) {
		const target = path.resolve(move.target);
		if (targets.has(target) || fs.existsSync(target) || isSymlink(target)) {
			throw new Error(`cannot migrate project memory because the destination already exists: ${move.target}`);
		}
		targets.add(target);
	}
}

type GitWorktree = {
	command: string;
	env: NodeJS.ProcessEnv;
	root: string;
};

function findGitWorktree(configRoot: string): GitWorktree | null {
	const searchPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
	const gitCommand = findCommandOnPath('git', searchPath);
	if (gitCommand === null) {
		return null;
	}
	const env = { ...process.env, PATH: searchPath };
	const result = childProcess.spawnSync(gitCommand, ['-C', configRoot, 'rev-parse', '--show-toplevel'], {
		encoding: 'utf8',
		env,
		shell: false
	});
	if (result.status !== 0) {
		return null;
	}
	const root = result.stdout.trim();
	return root ? { command: gitCommand, env, root: path.resolve(root) } : null;
}

function findCommandOnPath(command: string, searchPath: string): string | null {
	const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
	for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
		for (const extension of extensions) {
			const candidate = path.join(dir, `${command}${extension}`);
			try {
				fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
				return candidate;
			} catch {
				continue;
			}
		}
	}
	return null;
}

function isTrackedByGit(git: GitWorktree, filePath: string): boolean {
	const relativePath = path.relative(git.root, filePath).replace(/\\/g, '/');
	const result = childProcess.spawnSync(
		git.command,
		['-C', git.root, '--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relativePath],
		{ encoding: 'utf8', env: git.env, shell: false }
	);
	return result.status === 0;
}

function runGitMove(git: GitWorktree, move: PlannedMove): void {
	const source = path.relative(git.root, move.source).replace(/\\/g, '/');
	const target = path.relative(git.root, move.target).replace(/\\/g, '/');
	const result = childProcess.spawnSync(git.command, ['-C', git.root, '--literal-pathspecs', 'mv', '--', source, target], {
		encoding: 'utf8',
		env: git.env,
		shell: false
	});
	if (result.status !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || `git exited with status ${result.status}`;
		throw new Error(`cannot migrate tracked project memory ${move.source}: ${detail}`);
	}
}

function migrateLegacyCodexHome(profileDir: string): number {
	const source = path.join(profileDir, 'memories', 'codex-home');
	if (!fs.existsSync(source) && !isSymlink(source)) {
		return 0;
	}
	const target = path.join(profileDir, LIVE_DIR_NAME, 'memories', 'codex-home');
	if (!fs.existsSync(target) && !isSymlink(target)) {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.renameSync(source, target);
		removeEmptyParents(path.dirname(source), profileDir);
		verbose(`moved Codex runtime ${source} -> ${target}`);
		return 1;
	}
	const sourceIsDirectory = !isSymlink(source) && fs.statSync(source).isDirectory();
	const targetIsDirectory = !isSymlink(target) && fs.statSync(target).isDirectory();
	if (!sourceIsDirectory || !targetIsDirectory) {
		const backupTarget = nextBackupPath(target);
		fs.renameSync(source, backupTarget);
		removeEmptyParents(path.dirname(source), profileDir);
		verbose(`moved Codex runtime ${source} -> ${backupTarget}`);
		return 1;
	}
	const moved = mergeRuntimeTree(source, target);
	removeEmptyParents(path.dirname(source), profileDir);
	return moved;
}

function mergeRuntimeTree(sourceDir: string, targetDir: string): number {
	let moved = 0;
	fs.mkdirSync(targetDir, { recursive: true });
	for (const entry of safeReadDir(sourceDir)) {
		const source = path.join(sourceDir, entry.name);
		let target = path.join(targetDir, entry.name);
		if (entry.isDirectory() && !entry.isSymbolicLink()) {
			const targetIsDirectory = fs.existsSync(target) && !isSymlink(target) && fs.statSync(target).isDirectory();
			if ((fs.existsSync(target) || isSymlink(target)) && !targetIsDirectory) {
				target = nextBackupPath(target);
			}
			moved += mergeRuntimeTree(source, target);
			continue;
		}
		const resolvedTarget = fs.existsSync(target) || isSymlink(target) ? nextBackupPath(target) : target;
		fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
		fs.renameSync(source, resolvedTarget);
		verbose(`moved Codex runtime ${source} -> ${resolvedTarget}`);
		moved += 1;
	}
	try {
		fs.rmdirSync(sourceDir);
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
			throw error;
		}
	}
	return moved;
}

function removeEmptyParents(startDir: string, stopDir: string): void {
	let dir = path.resolve(startDir);
	const stop = path.resolve(stopDir);
	while (dir !== stop && isSamePathOrDescendant(dir, stop)) {
		try {
			fs.rmdirSync(dir);
		} catch (error) {
			if (error instanceof Error && 'code' in error && ['ENOENT', 'ENOTEMPTY'].includes(String(error.code))) {
				return;
			}
			throw error;
		}
		dir = path.dirname(dir);
	}
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
