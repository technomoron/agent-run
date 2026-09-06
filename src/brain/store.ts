import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { findProjectRoot, resolveProfileResult } from '../project';
import { isSamePathOrDescendant } from '../utils';
import { readBrainConfig, registeredBrainProject } from './config';

export const scopeSchema = z.enum(['global', 'project', 'default']);
export const typeSchema = z.enum(['rule', 'preference', 'convention', 'constraint', 'decision', 'spec', 'review', 'memory', 'observation']);
export const knowledgeInput = z.object({
	scope: scopeSchema,
	type: typeSchema,
	title: z.string().trim().min(1).max(300),
	content: z.string().trim().min(1).max(200000),
	authority: z.enum(['user', 'inferred']).default('inferred'),
	recall: z.enum(['always', 'relevant']).default('relevant'),
	tags: z.array(z.string().max(100)).max(50).default([]),
	applies_to: z.array(z.string().max(500)).max(50).default([])
}).strict();
export const knowledgeMetadata = knowledgeInput.omit({ content: true }).extend({
	id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
	status: z.enum(['active', 'deprecated']).default('active'),
	created: z.string().default(''),
	updated: z.string().default(''),
	reason: z.string().optional(),
	promoted_from: z.string().optional()
}).strict();
export type Knowledge = z.infer<typeof knowledgeMetadata> & { content: string; source: string; revision: string };
export type Scope = z.infer<typeof scopeSchema>;
export const knowledgeDirectories: Record<z.infer<typeof typeSchema>, string> = {
	rule: 'rules', preference: 'preferences', convention: 'conventions', constraint: 'constraints',
	decision: 'decisions', spec: 'specs', review: 'reviews', memory: 'memory', observation: 'observations'
};

export function readMarkdown(text: string): { metadata: unknown; content: string } {
	const normalized = text.replace(/\r\n/g, '\n');
	const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
	return match ? { metadata: parseYaml(match[1]!, { maxAliasCount: 50 }), content: normalized.slice(match[0].length).trim() }
		: { metadata: null, content: normalized.trim() };
}

function hash(text: string): string { return createHash('sha256').update(text).digest('hex'); }

export class BrainStore {
	readonly profile: string | null;
	readonly projectRoot: string;
	readonly scopes: Array<{ scope: Scope; directory: string }>;
	private readonly db: DatabaseSync;
	readonly budget: number;

	constructor(readonly configRoot: string, readonly cwd: string) {
		this.configRoot = path.resolve(configRoot);
		this.projectRoot = registeredBrainProject(this.configRoot, cwd)?.root ?? findProjectRoot(cwd);
		const resolved = resolveProfileResult(this.projectRoot, this.configRoot).profile;
		this.profile = resolved && resolved !== 'default' && ['agent-run.jsonc', 'local.md.njk', 'AGENTS-MODS.md'].some((file) =>
			fs.existsSync(path.join(this.configRoot, resolved, file))) ? resolved : null;
		this.scopes = [{ scope: 'global', directory: path.join(this.configRoot, 'global') },
			{ scope: this.profile ? 'project' : 'default', directory: path.join(this.configRoot, this.profile ?? 'default') }];
		this.budget = readBrainConfig(this.configRoot)?.contextBudget ?? 16000;
		this.directory('index');
		this.directory('runtime');
		this.db = new DatabaseSync(this.safePath('index', 'knowledge.sqlite'));
		this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE VIRTUAL TABLE IF NOT EXISTS knowledge USING fts5(source UNINDEXED, environment UNINDEXED, title, content, tags);');
	}

	close(): void { this.db.close(); }

	safePath(...parts: string[]): string {
		const target = path.resolve(this.configRoot, ...parts);
		if (!isSamePathOrDescendant(target, this.configRoot)) throw new Error('Path escapes the brain configuration directory');
		let current = this.configRoot;
		for (const part of path.relative(this.configRoot, target).split(path.sep).filter(Boolean)) {
			current = path.join(current, part);
			try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlinks are not supported in brain storage: ${current}`); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		}
		return target;
	}

	directory(...parts: string[]): string {
		const directory = this.safePath(...parts);
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		return directory;
	}

	scopeDirectory(scope: Scope): string {
		const directory = this.scopes.find((entry) => entry.scope === scope)?.directory;
		if (!directory) throw new Error(`Scope ${scope} is not available in this environment`);
		return this.safePath(directory);
	}

	files(directory: string): string[] {
		this.safePath(directory);
		if (!fs.existsSync(directory)) return [];
		return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
			const file = this.safePath(directory, entry.name);
			return entry.isDirectory() ? this.files(file) : entry.isFile() && entry.name.endsWith('.md') ? [file] : [];
		});
	}

	read(file: string): string {
		const target = this.safePath(file);
		if (fs.statSync(target).size > 1024 * 1024) throw new Error(`Markdown file exceeds 1 MiB: ${file}`);
		return fs.readFileSync(target, 'utf8');
	}

	atomicWrite(file: string, text: string): void {
		const target = this.safePath(file);
		this.directory(path.dirname(target));
		const temporary = `${target}.${randomUUID()}.tmp`;
		try {
			fs.writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
			fs.renameSync(temporary, target);
		} finally { fs.rmSync(temporary, { force: true }); }
	}

	writeLocked<T>(fn: () => T): T {
		const file = this.safePath('runtime', 'brain-write.lock');
		let descriptor: number;
		try { descriptor = fs.openSync(file, 'wx', 0o600); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another brain write is in progress. Retry; after a crashed writer, remove runtime/brain-write.lock.');
			throw error;
		}
		try { fs.writeSync(descriptor, String(process.pid)); return fn(); }
		finally { fs.closeSync(descriptor); fs.unlinkSync(file); }
	}

	allKnowledge(): Knowledge[] {
		const result: Knowledge[] = [];
		for (const { scope, directory } of this.scopes) {
			const directories = [...Object.entries(knowledgeDirectories), ['memory', path.join('notes', 'memory')]];
			if (scope === 'global') directories.push(['memory', path.relative(directory, path.join(this.configRoot, 'notes', 'memory'))]);
			for (const [type, folder] of directories) {
				for (const file of this.files(path.join(directory, folder!))) {
					const text = this.read(file);
					const document = readMarkdown(text);
					const source = path.relative(this.configRoot, file);
					const legacy = document.metadata !== null && typeof document.metadata === 'object' && !Array.isArray(document.metadata)
						&& !('id' in document.metadata) && !('type' in document.metadata);
					const legacyStatus = legacy ? (document.metadata as Record<string, unknown>).status : undefined;
					const metadata = document.metadata === null || legacy ? {
						id: `document-${hash(source).slice(0, 24)}`, scope, type,
						title: /^#\s+(.+)$/m.exec(document.content)?.[1] ?? path.basename(file, '.md'),
						status: type === 'review' && ['addressed', 'resolved', 'done', 'closed'].includes(String(legacyStatus)) ? 'deprecated' : 'active',
						created: '', updated: ''
					} : { title: /^#\s+(.+)$/m.exec(document.content)?.[1] ?? path.basename(file, '.md'), ...(document.metadata as Record<string, unknown>) };
					const parsed = knowledgeMetadata.safeParse(metadata);
					if (!parsed.success) throw new Error(`Invalid knowledge metadata in ${source}: ${parsed.error.message}`);
					if (parsed.data.scope !== scope) throw new Error(`Knowledge scope does not match its directory: ${source}`);
					result.push({ ...parsed.data, content: legacy ? text.trim() : document.content, source, revision: hash(text) });
				}
			}
		}
		const ids = new Set<string>();
		for (const item of result) {
			if (ids.has(item.id)) throw new Error(`Duplicate knowledge id: ${item.id}`);
			ids.add(item.id);
		}
		return result;
	}

	search(query: string, options: { scopes?: Scope[]; types?: string[]; includeDeprecated?: boolean; limit?: number } = {}): Knowledge[] {
		const items = this.allKnowledge();
		const environment = this.profile ?? 'default';
		this.db.exec('BEGIN IMMEDIATE');
		try {
			this.db.prepare('DELETE FROM knowledge WHERE environment = ?').run(environment);
			const insert = this.db.prepare('INSERT INTO knowledge(source, environment, title, content, tags) VALUES (?, ?, ?, ?, ?)');
			for (const item of items) insert.run(item.source, environment, item.title, item.content, item.tags.join(' '));
			this.db.exec('COMMIT');
		} catch (error) { this.db.exec('ROLLBACK'); throw error; }
		const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 50) ?? [];
		const ranked = terms.length ? this.db.prepare('SELECT source FROM knowledge WHERE knowledge MATCH ? AND environment = ? ORDER BY bm25(knowledge, 0, 0, 5, 1, 3), source')
			.all(terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR '), environment).map((row) => String(row.source)) : items.map((item) => item.source);
		const bySource = new Map(items.map((item) => [item.source, item]));
		return ranked.map((source) => bySource.get(source)!).filter((item) =>
			(options.includeDeprecated || item.status === 'active') && (!options.scopes || options.scopes.includes(item.scope)) &&
			(!options.types || options.types.includes(item.type))).slice(0, options.limit ?? 50);
	}

	context(task: string, files: string[] = [], symbols: string[] = []): { items: Knowledge[]; omitted: number; profile: string | null; scopes: Scope[] } {
		const all = this.allKnowledge().filter((item) => item.status === 'active');
		const always = all.filter((item) => item.recall === 'always');
		const matching = all.filter((item) => item.applies_to.some((pattern) => files.some((file) => {
			const relative = path.isAbsolute(file) ? path.relative(this.projectRoot, file) : file;
			return path.matchesGlob(relative, pattern);
		})));
		const selected = [...new Map([...always, ...matching, ...this.search([task, ...symbols].join(' '))].map((item) => [item.id, item])).values()];
		let size = 0;
		const items = selected.filter((item) => {
			const length = JSON.stringify(item).length;
			if (size + length > this.budget) return false;
			size += length;
			return true;
		});
		return { items, omitted: selected.length - items.length, profile: this.profile, scopes: this.scopes.map((scope) => scope.scope) };
	}

	remember(input: z.input<typeof knowledgeInput>): Knowledge {
		const value = knowledgeInput.parse(input);
		if (value.authority === 'inferred' && value.type !== 'observation' && value.type !== 'memory' && value.type !== 'review') {
			throw new Error('Inferred knowledge must remain an observation, memory, or review until explicitly confirmed.');
		}
		if (value.scope === 'global' && value.authority !== 'user') throw new Error('Global writes require explicit user authority.');
		return this.writeLocked(() => {
			const now = new Date().toISOString();
			const { content, ...metadata } = value;
			const item = { ...metadata, id: randomUUID(), status: 'active' as const, created: now, updated: now };
			const file = path.join(this.scopeDirectory(value.scope), knowledgeDirectories[value.type], `${item.id}.md`);
			this.atomicWrite(file, `---\n${stringifyYaml(item)}---\n\n${content}\n`);
			return this.allKnowledge().find((entry) => entry.id === item.id)!;
		});
	}

	deprecate(id: string, revision: string, reason?: string): Knowledge {
		return this.writeLocked(() => {
			const item = this.get(id);
			if (item.revision !== revision) throw new Error('Knowledge changed; read the current revision before updating.');
			const { source, revision: _revision, content, ...metadata } = item;
			this.atomicWrite(source, `---\n${stringifyYaml({ ...metadata, status: 'deprecated', updated: new Date().toISOString(), ...(reason ? { reason } : {}) })}---\n\n${content}\n`);
			return this.get(id);
		});
	}

	promote(id: string, scope: Scope, revision: string): Knowledge {
		return this.writeLocked(() => {
			const item = this.get(id);
			if (item.revision !== revision) throw new Error('Knowledge changed; read the current revision before promoting.');
			if (item.status !== 'active') throw new Error('Deprecated knowledge cannot be promoted.');
			if (item.scope === scope) throw new Error('Knowledge already belongs to this scope.');
			const { source: _source, revision: _revision, content, ...metadata } = item;
			const promoted = { ...metadata, id: randomUUID(), scope, authority: 'user', promoted_from: id, updated: new Date().toISOString() };
			this.atomicWrite(path.join(this.scopeDirectory(scope), knowledgeDirectories[item.type], `${promoted.id}.md`), `---\n${stringifyYaml(promoted)}---\n\n${content}\n`);
			return this.get(promoted.id);
		});
	}

	get(id: string): Knowledge {
		const item = this.allKnowledge().find((entry) => entry.id === id);
		if (!item) throw new Error(`Knowledge not found in the active scopes: ${id}`);
		return item;
	}
}
