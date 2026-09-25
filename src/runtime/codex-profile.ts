import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { parse, stringify, type TomlTable } from 'smol-toml';
import type { RenderContext } from '../model';

export function codexSharedHome(context: Pick<RenderContext, 'configRoot'>): string {
	return path.join(context.configRoot, 'runtime', 'codex');
}

export function codexProfileName(context: Pick<RenderContext, 'profileDir'>): string {
	const identity = path.resolve(context.profileDir);
	const canonical = process.platform === 'win32' ? identity.toLowerCase() : identity;
	return `agent-run-${createHash('sha256').update(canonical).digest('hex').slice(0, 20)}`;
}

export function codexProfileSkills(context: Pick<RenderContext, 'configRoot' | 'profileDir'>): string {
	return path.join(codexSharedHome(context), 'skills', codexProfileName(context));
}

// Only scan agent-run's generated skills. Personal/system skills keep their native settings.
function generatedSkills(home: string): string[] {
	const root = path.join(home, 'skills');
	if (!fs.existsSync(root)) return [];
	const files: string[] = [];
	for (const profile of fs.readdirSync(root, { withFileTypes: true })) {
		if (!profile.isDirectory() || !/^agent-run-[a-f0-9]{20}$/.test(profile.name)) continue;
		const dir = path.join(root, profile.name);
		for (const skill of fs.readdirSync(dir, { withFileTypes: true })) {
			const file = path.join(dir, skill.name, 'SKILL.md');
			if (skill.isDirectory() && fs.existsSync(file)) files.push(file);
		}
	}
	return files.sort();
}

function configureSkills(config: TomlTable, home: string, profile: string, files: string[]): void {
	const settings = (config.skills ?? {}) as TomlTable;
	const existing = (settings.config ?? []) as Array<{ path: string; enabled?: boolean }>;
	const generatedRoot = path.join(home, 'skills') + path.sep;
	const isGenerated = (file: string): boolean => {
		const relative = path.resolve(file).slice(generatedRoot.length);
		return path.resolve(file).startsWith(generatedRoot) && /^agent-run-[a-f0-9]{20}[\\/]/.test(relative);
	};
	settings.config = [
		...existing.filter((entry) => !isGenerated(entry.path)),
		...files.map((file) => ({
			path: file,
			enabled: path.dirname(path.dirname(file)) === path.join(home, 'skills', profile)
				&& (existing.find((entry) => entry.path === file)?.enabled ?? true)
		}))
	];
	config.skills = settings;
}

export function renderCodexProfile(context: RenderContext, base: string, instructions: string): string {
	const config = parse(base);
	config.developer_instructions = [config.developer_instructions, instructions].filter(Boolean).join('\n\n');
	if (process.platform === 'win32') {
		// A fresh home otherwise silently downgrades workspace-write to read-only.
		config.windows = { sandbox: 'unelevated', ...(config.windows as object ?? {}) };
	}
	configureSkills(config, codexSharedHome(context), codexProfileName(context), pendingSkills(context));
	return stringify(config) + '\n';
}

function pendingSkills(context: RenderContext): string[] {
	const ownDir = codexProfileSkills(context);
	const others = generatedSkills(codexSharedHome(context)).filter((file) => path.dirname(path.dirname(file)) !== ownDir);
	const own = context.skills.map((skill) => path.join(ownDir, skill.name, 'SKILL.md'));
	return [...new Set([...others, ...own])].sort();
}

// Refresh older generated profiles too: newly generated project skills must not
// become enabled in another profile merely because they share a discovery root.
export function refreshCodexProfileSkills(context: RenderContext): void {
	const home = codexSharedHome(context);
	const files = pendingSkills(context);
	for (const entry of fs.readdirSync(home)) {
		if (!/^agent-run-[a-f0-9]{20}\.config\.toml$/.test(entry)) continue;
		const file = path.join(home, entry);
		const original = fs.readFileSync(file, 'utf8');
		const config = parse(original);
		configureSkills(config, home, entry.replace('.config.toml', ''), files);
		const content = stringify(config) + '\n';
		if (content !== original) writeCodexProfileFile(file, content);
	}
}

export function writeCodexProfileFile(file: string, content: string): void {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

// Profile refresh, skill publication and session migration share one writer.
// Codex readers see complete profile files through atomic rename.
export function withCodexProfileLock<T>(context: RenderContext, run: () => T): T {
	const home = codexSharedHome(context);
	fs.mkdirSync(home, { recursive: true });
	const lock = path.join(home, '.agent-run-sync.lock');
	const deadline = Date.now() + 30000;
	let descriptor: number;
	for (;;) {
		try { descriptor = fs.openSync(lock, 'wx', 0o600); break; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			try {
				const owner = Number(fs.readFileSync(lock, 'utf8'));
				if (Number.isInteger(owner) && owner > 0) {
					try { process.kill(owner, 0); }
					catch (probe) {
						if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { fs.rmSync(lock, { force: true }); continue; }
					}
				}
			} catch (readError) {
				if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
				throw readError;
			}
			if (Date.now() >= deadline) throw new Error(`Timed out waiting for Codex profile generation: ${lock}`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
		}
	}
	try { fs.writeFileSync(descriptor, String(process.pid)); return run(); }
	finally { fs.closeSync(descriptor); fs.rmSync(lock, { force: true }); }
}

export function migrateCodexSessions(legacyHome: string, sharedHome: string): void {
	const marker = path.join(sharedHome, 'agent-run-migrations', `${createHash('sha256').update(path.resolve(legacyHome)).digest('hex')}.json`);
	if (fs.existsSync(marker)) return;
	// Rollouts are Codex's durable session source. Let Codex rebuild its derived
	// database; never merge SQLite files or copy daemon installs, sockets or locks.
	function copyMissing(source: string, target: string): void {
		if (!fs.existsSync(source)) return;
		for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
			const from = path.join(source, entry.name);
			const to = path.join(target, entry.name);
			if (entry.isDirectory()) copyMissing(from, to);
			else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
				fs.mkdirSync(target, { recursive: true });
				try { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
				catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
			}
		}
	}
	for (const dir of ['sessions', 'archived_sessions']) copyMissing(path.join(legacyHome, dir), path.join(sharedHome, dir));
	fs.mkdirSync(path.dirname(marker), { recursive: true });
	fs.writeFileSync(marker, JSON.stringify({ source: legacyHome, migrated: new Date().toISOString() }) + '\n');
}
