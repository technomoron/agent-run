import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	CONFIG_DIR_ENV,
	CONFIG_ROOT_OVERRIDE_ENV,
	ENV_FILE_NAME,
	IGNORE_FILE_NAME,
	LOCAL_AI_DIRECTORY_NAMES,
	LOCAL_AI_FILE_NAMES
} from './constants';
import { ToolName } from './model';
import { fail, isSamePathOrDescendant, parseBooleanEnv, verbose } from './utils';
import { walkTree } from './walk-tree';

const envCache = new Map<string, Record<string, string>>();
const PRUNED_SOURCE_DIRS = new Set(['node_modules', '.pnpm-store', 'dist', 'build']);

export function resolveAgentDir(projectRoot: string): string {
	const profile = resolveProfile(projectRoot);
	const configRoot = defaultConfigRoot(projectRoot);
	const agentDir = path.join(configRoot, profile);
	verbose(`profile=${profile} configRoot=${configRoot} agentPath=${agentDir}`);
	return agentDir;
}

export function findLocalAiFiles(projectRoot: string, excludedDir: string | null = null): string[] {
	const matches: string[] = [];
	const resolvedExcludedDir = excludedDir ? path.resolve(excludedDir) : null;
	walkTree(
		projectRoot,
		(fullPath, entry) => {
			if (resolvedExcludedDir !== null && isSamePathOrDescendant(fullPath, resolvedExcludedDir)) {
				return entry.isDirectory() ? 'skip' : undefined;
			}
			if (entry.isDirectory() && LOCAL_AI_DIRECTORY_NAMES.has(entry.name)) {
				matches.push(fullPath);
				return 'skip';
			}
			if (LOCAL_AI_FILE_NAMES.has(entry.name)) {
				matches.push(fullPath);
			}
			return undefined;
		},
		{
			shouldPrune: (entry) => entry.isDirectory() && (entry.name === '.git' || PRUNED_SOURCE_DIRS.has(entry.name)),
			shouldSkipDirectory: isIgnoredDir
		}
	);
	return matches.sort();
}

export function findSourceRepos(rootPath: string): string[] {
	const resolvedRoot = path.resolve(rootPath);
	if (isIgnoredDir(resolvedRoot)) {
		return [];
	}
	if (looksLikeRepoRoot(resolvedRoot)) {
		return [resolvedRoot];
	}

	const repos = new Set<string>();
	walkTree(
		resolvedRoot,
		(fullPath, entry) => {
			if (!entry.isDirectory()) {
				return undefined;
			}
			if (fs.existsSync(path.join(fullPath, '.git'))) {
				repos.add(fullPath);
				return 'skip';
			}
			return undefined;
		},
		{ shouldPrune: (entry) => PRUNED_SOURCE_DIRS.has(entry.name), shouldSkipDirectory: isIgnoredDir }
	);
	return [...repos].sort();
}

function looksLikeRepoRoot(dir: string): boolean {
	return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
}

export function isIgnoredDir(dir: string): boolean {
	if (fs.existsSync(path.join(dir, IGNORE_FILE_NAME))) {
		return true;
	}
	return parseBooleanEnv(readAgentRunEnv(dir).AGENT_RUN_IGNORE);
}

export function warnForLocalAiFiles(tool: ToolName | null, projectRoot: string, localAiFiles: string[]): void {
	process.stderr.write(`WARNING: local AI files found in project root ${projectRoot}\n`);
	for (const file of localAiFiles) {
		process.stderr.write(`WARNING:   ${path.relative(projectRoot, file)}\n`);
	}
	if (tool !== null) {
		process.stderr.write(
			`WARNING: consider moving these files out of the project, or run \`agent-run ${tool} --none\` to bypass the wrapper.\n`
		);
	}
}

export function failForLocalAiFiles(tool: ToolName, projectRoot: string, localAiFiles: string[]): never {
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
		if (isWorkspaceRoot(dir)) {
			workspaceRoot = dir;
		}
		if (!nearestPackageRoot && fs.existsSync(path.join(dir, 'package.json'))) {
			nearestPackageRoot = dir;
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

export function resolveProfileResult(projectRoot: string): { profile: string | null; reason: string } {
	const envProfile = readAgentRunEnv(projectRoot).AGENT_RUN_PROFILE?.trim();
	if (envProfile) {
		verbose(`using ${ENV_FILE_NAME} AGENT_RUN_PROFILE=${envProfile}`);
		return parseProfile(envProfile, `${ENV_FILE_NAME} AGENT_RUN_PROFILE`);
	}

	const githubProfile = resolveGitHubProfile(projectRoot);
	if (githubProfile !== null) {
		verbose(`using GitHub origin profile=${githubProfile}`);
		return parseProfile(githubProfile, 'GitHub remote origin');
	}

	return profileFromPackage(projectRoot);
}

function profileFromPackage(projectRoot: string): { profile: string | null; reason: string } {
	const packagePath = path.join(projectRoot, 'package.json');
	if (fs.existsSync(packagePath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { name?: unknown; repository?: unknown };
			const repositoryProfile = parsePackageRepositoryProfile(pkg.repository);
			if (repositoryProfile !== null) {
				verbose(`using package.json repository profile=${repositoryProfile}`);
				return parseProfile(repositoryProfile, `${packagePath} repository`);
			}
			if (typeof pkg.name === 'string' && pkg.name.length > 0) {
				verbose(`using package.json name=${pkg.name}`);
				return parseProfile(pkg.name.startsWith('@') ? pkg.name.slice(1) : pkg.name, `${packagePath} name`);
			}
		} catch {
			return { profile: null, reason: `cannot parse package.json: ${packagePath}` };
		}
	}
	const current = path.basename(projectRoot);
	const parentDir = path.dirname(projectRoot);
	const parent = path.basename(parentDir);
	if (current && parent && parentDir !== projectRoot) {
		const inferredProfile = `${parent}/${current}`;
		verbose(`using project path profile=${inferredProfile}`);
		return parseProfile(inferredProfile, 'project parent and directory name');
	}
	return { profile: null, reason: `cannot resolve agent profile from project path: ${projectRoot}` };
}

function parsePackageRepositoryProfile(repository: unknown): string | null {
	let repositoryPath: string | null = null;
	if (typeof repository === 'string') {
		repositoryPath = repository;
	} else if (repository !== null && typeof repository === 'object' && 'url' in repository) {
		const url = (repository as { url?: unknown }).url;
		if (typeof url === 'string') {
			repositoryPath = url;
		}
	}
	if (repositoryPath === null) {
		return null;
	}
	const value = repositoryPath.trim();
	const githubProfile = parseGitHubRemoteProfile(value.replace(/^git\+/, ''));
	if (githubProfile !== null) {
		return githubProfile;
	}
	const shorthand = /^(?:github:)?([^/:\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(value);
	return shorthand?.[1] && shorthand[2] ? `${shorthand[1]}/${shorthand[2]}` : null;
}

function resolveGitHubProfile(projectRoot: string): string | null {
	const result = childProcess.spawnSync('git', ['-C', projectRoot, 'config', '--get', 'remote.origin.url'], {
		encoding: 'utf8',
		shell: false,
		stdio: ['ignore', 'pipe', 'ignore']
	});
	if (result.status !== 0) {
		return null;
	}
	const remote = result.stdout.trim();
	return remote ? parseGitHubRemoteProfile(remote) : null;
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

export function parseProfile(profile: string, source: string): { profile: string | null; reason: string } {
	const normalized = profile.trim().replace(/\\/g, '/');
	if (!normalized) {
		return { profile: null, reason: `${source} must be a non-empty path relative to the config root` };
	}
	if (normalized.startsWith('/') || normalized.startsWith('\\') || /^[A-Za-z]:\//.test(normalized)) {
		return { profile: null, reason: `${source} must be relative to the config root, not an absolute path` };
	}
	const segments = normalized.split('/').filter(Boolean);
	if (
		segments.length === 0 ||
		segments.some((segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))
	) {
		return { profile: null, reason: `${source} must be a clean relative path like org/my-project` };
	}
	return { profile: segments.join('/'), reason: '' };
}

export function projectRootForProfile(profile: string, configRoot?: string): string {
	if (configRoot && path.basename(configRoot) === 'agent-config') {
		return path.join(path.dirname(configRoot), ...profile.split('/'));
	}
	return path.join(os.homedir(), ...profile.split('/'));
}

function readAgentRunEnv(dir: string): Record<string, string> {
	const resolvedDir = path.resolve(dir);
	const cached = envCache.get(resolvedDir);
	if (cached) {
		return cached;
	}
	const filePath = path.join(resolvedDir, ENV_FILE_NAME);
	if (!fs.existsSync(filePath)) {
		const empty: Record<string, string> = {};
		envCache.set(resolvedDir, empty);
		return empty;
	}
	const env = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
	envCache.set(resolvedDir, env);
	return env;
}

function parseEnvFile(content: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
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
	return env;
}

export function defaultConfigRoot(projectRoot?: string, options: { preferProjectRoot?: boolean } = {}): string {
	const explicit = explicitConfigRoot(projectRoot);
	if (explicit !== null) {
		return explicit;
	}
	void options;
	return path.join(os.homedir(), '.agent-run');
}

function explicitConfigRoot(projectRoot?: string): string | null {
	for (const value of [process.env[CONFIG_ROOT_OVERRIDE_ENV], process.env[CONFIG_DIR_ENV]]) {
		if (value) {
			return path.resolve(value);
		}
	}
	if (!projectRoot) {
		return null;
	}
	const env = readAgentRunEnv(projectRoot);
	const localValue = env[CONFIG_DIR_ENV]?.trim();
	return localValue ? path.resolve(projectRoot, localValue) : null;
}

export function defaultConfigRootSearchCandidates(
	_projectRoot?: string,
	options: { platform?: NodeJS.Platform; homeDir?: string } = {}
): string[] {
	const platform = options.platform ?? process.platform;
	const pathApi = platform === 'win32' ? path.win32 : path.posix;
	const homeDir = options.homeDir ?? os.homedir();
	const names = ['agent-config', 'agent-configs'];
	if (platform === 'win32') {
		return [pathApi.join(homeDir, 'Documents', 'code'), pathApi.join(homeDir, 'Desktop', 'code'), 'C:\\code'].flatMap(
			(root) => names.map((name) => pathApi.join(root, name))
		);
	}
	return [
		...names.map((name) => pathApi.join(homeDir, 'code', name)),
		...names.map((name) => pathApi.join(homeDir, name)),
		...names.map((name) => pathApi.join(homeDir, `.${name}`))
	];
}
