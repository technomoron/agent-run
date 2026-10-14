import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sync as spawnSync } from 'cross-spawn';
import { findRealBinary } from '../process';
import { AGENT_IDS } from '../agents/types';
import { findProfileDirs } from '../config-tree';
import type { ToolName } from '../model';
import { loadManifest, normalizeManifest } from '../manifest';
import { buildRenderContext, createNunjucksEnv } from '../templates';
import { projectRootForProfile } from '../project';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Session = { id: string; files: string[]; modified: number };
export type CleanupResult = { agent: ToolName; removed: number; errors: string[] };

// Do not follow symlinks, including symlinked parent directories or another user's home.
function owned(file: string): fs.Stats | undefined {
	const stat = fs.lstatSync(file, { throwIfNoEntry: false });
	if (!stat || stat.isSymbolicLink()) return undefined;
	if (process.getuid && stat.uid !== process.getuid()) throw new Error(`Session path belongs to uid ${stat.uid}, current uid is ${process.getuid()}: ${file}`);
	const parent = path.dirname(file);
	if (parent !== file) {
		const parentStat = fs.lstatSync(parent);
		if (parentStat.isSymbolicLink()) return undefined;
		// Shared ancestors such as /tmp need not belong to the user.
		for (let dir = path.dirname(parent); path.dirname(dir) !== dir; dir = path.dirname(dir)) {
			if (fs.lstatSync(dir).isSymbolicLink()) return undefined;
		}
	}
	return stat;
}

function entries(dir: string): fs.Dirent[] {
	return owned(dir)?.isDirectory() ? fs.readdirSync(dir, { withFileTypes: true }) : [];
}

function files(dir: string): string[] {
	return entries(dir).flatMap((entry) => {
		const file = path.join(dir, entry.name);
		return entry.isDirectory() ? files(file) : entry.isFile() && owned(file)?.isFile() ? [file] : [];
	});
}

function modified(paths: string[]): number {
	return Math.max(...paths.map((file) => owned(file)?.mtimeMs ?? Infinity));
}

function homes(configRoot: string, agent: ToolName): string[] {
	const native = process.env[agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : agent === 'gemini' ? 'GEMINI_CLI_HOME' : agent === 'grok' ? 'GROK_HOME' : 'CODEX_HOME'];
	const result = [path.join(os.homedir(), `.${agent}`)];
	if (native) result.push(agent === 'gemini' ? path.join(native, '.gemini') : native);
	if (agent === 'codex') result.push(path.join(configRoot, 'runtime', 'codex'));
	for (const profile of findProfileDirs(configRoot)) {
		const live = path.join(profile, 'live');
		if (agent === 'codex') {
			const profileName = path.relative(configRoot, profile).split(path.sep).join('/');
			const manifest = normalizeManifest(loadManifest(configRoot, profile, profileName), profileName);
			const context = buildRenderContext(projectRootForProfile(profileName, configRoot), profile, configRoot, manifest, createNunjucksEnv(configRoot));
			result.push(context.paths.codexHomeDir);
		}
		if (agent === 'gemini') result.push(path.join(live, 'gemini', 'home', '.gemini'));
		if (agent === 'grok') result.push(path.join(live, 'grok'));
	}
	return [...new Set(result.map((home) => {
		const absolute = path.resolve(home);
		const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
		// Resolve system aliases such as macOS /var, but never follow a home symlink.
		return stat && !stat.isSymbolicLink() ? fs.realpathSync(absolute) : absolute;
	}))];
}

function fileSessions(home: string, agent: ToolName): Session[] {
	if (agent === 'grok') {
		return entries(path.join(home, 'sessions')).filter((entry) => entry.isDirectory()).flatMap((group) =>
			entries(path.join(home, 'sessions', group.name)).filter((entry) => entry.isDirectory() && UUID.test(entry.name)).map((entry) => {
				const dir = path.join(home, 'sessions', group.name, entry.name);
				return { id: entry.name, files: [dir], modified: modified([dir, ...files(dir)]) };
			}));
	}
	if (agent === 'claude') {
		return entries(path.join(home, 'projects')).filter((entry) => entry.isDirectory()).flatMap((group) => {
			const dir = path.join(home, 'projects', group.name);
			return entries(dir).filter((entry) => entry.isFile() && UUID.test(path.basename(entry.name, '.jsonl')) && entry.name.endsWith('.jsonl')).map((entry) => {
				const id = path.basename(entry.name, '.jsonl');
				const transcript = path.join(dir, entry.name);
				const companions = [path.join(dir, id), path.join(home, 'file-history', id)].filter((file) => owned(file)?.isDirectory());
				return { id, files: [transcript, ...companions], modified: modified([transcript, ...companions.flatMap(files)]) };
			});
		});
	}
	if (agent === 'gemini') {
		return entries(path.join(home, 'tmp')).filter((entry) => entry.isDirectory()).flatMap((group) => {
			const dir = path.join(home, 'tmp', group.name, 'chats');
			return entries(dir).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => {
				const file = path.join(dir, entry.name);
				return { id: entry.name, files: [file], modified: modified([file]) };
			});
		});
	}
	const sessions = new Map<string, Session>();
	for (const dir of ['sessions', 'archived_sessions']) {
		for (const file of files(path.join(home, dir)).filter((file) => file.endsWith('.jsonl'))) {
			const id = path.basename(file, '.jsonl').slice(-36);
			if (!UUID.test(id)) continue;
			const previous = sessions.get(id);
			sessions.set(id, { id, files: [...previous?.files ?? [], file], modified: Math.max(previous?.modified ?? 0, modified([file])) });
		}
	}
	// Recent Codex keeps paginated history in SQLite; rollout files alone are incomplete.
	for (const entry of entries(home).filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/.test(entry.name))) {
		const db = new DatabaseSync(path.join(home, entry.name), { readOnly: true });
		try {
			for (const row of db.prepare('SELECT id, updated_at FROM threads').all()) {
				if (typeof row.id !== 'string' || !UUID.test(row.id)) continue;
				const previous = sessions.get(row.id);
				sessions.set(row.id, { id: row.id, files: previous?.files ?? [], modified: Math.max(previous?.modified ?? 0, Number(row.updated_at) * 1000) });
			}
		} finally { db.close(); }
	}
	return [...sessions.values()];
}

function pruneIndexes(home: string, agent: ToolName, ids: Set<string>): void {
	const jsonl = agent === 'claude' ? ['history.jsonl'] : agent === 'codex' ? ['history.jsonl', 'session_index.jsonl'] : [];
	for (const name of jsonl) {
		const file = path.join(home, name);
		if (!owned(file)?.isFile()) continue;
		const original = fs.readFileSync(file, 'utf8');
		const lines = original.split(/(?<=\n)/).filter((line) => {
			try { const row = JSON.parse(line); return !ids.has(row.sessionId ?? row.session_id ?? row.id); }
			catch { return true; }
		});
		if (lines.join('') !== original) fs.writeFileSync(file, lines.join(''));
	}
	if (agent === 'claude') {
		for (const group of entries(path.join(home, 'projects')).filter((entry) => entry.isDirectory())) {
			const file = path.join(home, 'projects', group.name, 'sessions-index.json');
			if (!owned(file)?.isFile()) continue;
			const data = JSON.parse(fs.readFileSync(file, 'utf8'));
			if (Array.isArray(data.entries)) {
				data.entries = data.entries.filter((entry: { sessionId?: string }) => !ids.has(entry.sessionId ?? ''));
				fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
			}
		}
	}
}

export function cleanSessions(configRoot: string, agents: readonly ToolName[] = AGENT_IDS, all = false, now = Date.now()): CleanupResult[] {
	return agents.map((agent) => {
		const result: CleanupResult = { agent, removed: 0, errors: [] };
		let directories: string[];
		try { directories = homes(configRoot, agent); }
		catch (error) { result.errors.push(error instanceof Error ? error.message : String(error)); return result; }
		for (const home of directories) {
			try {
				if (!owned(home)?.isDirectory()) continue;
				const removed = new Set<string>();
				for (const session of fileSessions(home, agent)) {
					if (!all && session.modified >= now - WEEK) continue;
					if ([process.env.CODEX_THREAD_ID, process.env.CODEX_SESSION_ID, process.env.CLAUDE_SESSION_ID, process.env.GROK_SESSION_ID].includes(session.id)) {
						if (all) result.errors.push(`Skipped current session ${session.id}`);
						continue;
					}
					try {
						if (agent === 'codex' || agent === 'grok') {
							// Let the native CLI remove history and update its own databases/indexes.
							const binary = findRealBinary(agent, process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '');
							const response = spawnSync(binary, agent === 'codex' ? ['delete', '--force', session.id] : ['sessions', 'delete', session.id], {
								env: { ...process.env, PATH: process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH, [agent === 'codex' ? 'CODEX_HOME' : 'GROK_HOME']: home }, shell: false, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024
							});
							if (response.error || response.status !== 0) throw new Error(response.error?.message ?? (response.stderr || response.stdout || `delete exited ${response.status}`).trim());
						} else {
							for (const file of session.files) if (owned(file)) fs.rmSync(file, { recursive: true, force: true });
						}
						if (session.files.some((file) => fs.existsSync(file))) throw new Error('Native deletion left session files in place');
						removed.add(session.id);
						result.removed++;
					} catch (error) { result.errors.push(`${home}: ${session.id}: ${error instanceof Error ? error.message : String(error)}`); }
				}
				if (removed.size) pruneIndexes(home, agent, removed);
			} catch (error) { result.errors.push(`${home}: ${error instanceof Error ? error.message : String(error)}`); }
		}
		return result;
	});
}

export function reportCleanup(results: CleanupResult[], explicit = false): void {
	for (const result of results) {
		if (explicit || result.removed) process.stdout.write(`${result.agent}: removed ${result.removed} session(s)\n`);
		for (const error of result.errors) process.stderr.write(`agent-run: ${result.agent} session cleanup: ${error}\n`);
	}
	if (explicit && results.some((result) => result.errors.length)) process.exitCode = 1;
}
