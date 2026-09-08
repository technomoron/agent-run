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
export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const reviewStateSchema = z.enum(['open', 'fixed', 'wontfix']);
const severityPrefix: Record<z.infer<typeof severitySchema>, string> = { critical: 'C', high: 'H', medium: 'M', low: 'L' };
const severityOrder: Record<z.infer<typeof severitySchema>, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const knowledgeInput = z.object({
	scope: scopeSchema,
	type: typeSchema,
	title: z.string().trim().min(1).max(300),
	content: z.string().trim().min(1).max(200000),
	authority: z.enum(['user', 'inferred']).default('inferred'),
	recall: z.enum(['always', 'relevant']).default('relevant'),
	severity: severitySchema.optional(),
	tags: z.array(z.string().max(100)).max(50).default([]),
	applies_to: z.array(z.string().max(500)).max(50).default([]),
	// Naming only. The id in the front matter stays the identity, so files can be renamed freely.
	filename: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case words separated by single dashes, with no extension').max(100).optional()
}).strict();
// finding and state stay optional so review files written before they existed keep parsing.
export const knowledgeMetadata = knowledgeInput.omit({ content: true, filename: true }).extend({
	id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
	status: z.enum(['active', 'deprecated']).default('active'),
	finding: z.string().regex(/^[CHML][1-9][0-9]*$/).optional(),
	state: reviewStateSchema.optional(),
	created: z.string().default(''),
	updated: z.string().default(''),
	reason: z.string().optional(),
	promoted_from: z.string().optional()
}).strict();
// Spelled out rather than derived from knowledgeInput: .partial() keeps .default(), so a
// derived schema would silently reset every field the caller did not mention.
export const knowledgeChanges = z.object({
	title: z.string().trim().min(1).max(300).optional(),
	content: z.string().trim().min(1).max(200000).optional(),
	recall: z.enum(['always', 'relevant']).optional(),
	tags: z.array(z.string().max(100)).max(50).optional(),
	applies_to: z.array(z.string().max(500)).max(50).optional()
}).strict();
export type Knowledge = z.infer<typeof knowledgeMetadata> & { content: string; source: string; revision: string };
export type Scope = z.infer<typeof scopeSchema>;
const reviewClosureSchema = z.object({
	id: z.string(), finding: z.string().regex(/^[CHML][1-9][0-9]*$/), severity: severitySchema,
	scope: scopeSchema, title: z.string(), state: z.enum(['fixed', 'wontfix']),
	closed: z.string(), reason: z.string(), source: z.string(), revision: z.string()
}).strict();
export type ReviewClosure = z.infer<typeof reviewClosureSchema>;
const reviewCountersSchema = z.object({ C: z.number().int().nonnegative(), H: z.number().int().nonnegative(), M: z.number().int().nonnegative(), L: z.number().int().nonnegative() }).strict();

export type BrokenFile = { source: string; status: 'broken'; error: string; id?: string };
export const knowledgeDirectories: Record<z.infer<typeof typeSchema>, string> = {
	rule: 'rules', preference: 'preferences', convention: 'conventions', constraint: 'constraints',
	decision: 'decisions', spec: 'specs', review: 'reviews', memory: 'memory', observation: 'observations'
};

export function readMarkdown(text: string): { metadata: unknown; content: string } {
	const normalized = text.replace(/\r\n/g, '\n');
	const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
	if (normalized.startsWith('---\n') && !match) throw new Error('Unterminated YAML front matter');
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
	readonly knowledgeErrors: BrokenFile[] = [];
	readonly todoErrors: BrokenFile[] = [];

	brokenFile(file: string, error: unknown, id?: string): BrokenFile {
		const message = error instanceof z.ZodError
			? error.issues.map((issue) => `${issue.path.join('.') || 'metadata'}: ${issue.message}`).join('; ')
			: error instanceof Error ? error.message.split('\n')[0]! : String(error);
		return { source: path.relative(this.configRoot, file), status: 'broken', error: message, ...(id ? { id } : {}) };
	}

	withDiagnostics(value: unknown): unknown {
		const brokenFiles = [...this.knowledgeErrors, ...this.todoErrors];
		if (!brokenFiles.length) return value;
		return Array.isArray(value) ? { items: value, brokenFiles } : { ...value as object, brokenFiles };
	}

	assertReadable(id: string, errors: BrokenFile[]): void {
		const matches = errors.filter((item) => item.id === id || item.source === id || path.basename(item.source, '.md') === id);
		if (matches.length) throw new Error(`Cannot read or update broken file: ${matches.map((item) => `${item.source}: ${item.error}`).join('; ')}. Correct the file on disk first.`);
	}

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

	files(directory: string, options: { onError?: (file: string, error: unknown) => void; includeAllFiles?: boolean } = {}): string[] {
		const { onError } = options;
		try {
			this.safePath(directory);
			if (!fs.existsSync(directory)) return [];
			return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
				try {
					const file = this.safePath(directory, entry.name);
					return entry.isDirectory() ? this.files(file, options) : entry.isFile() && (options.includeAllFiles || entry.name.endsWith('.md')) ? [file] : [];
				} catch (error) { if (!onError) throw error; onError(path.join(directory, entry.name), error); return []; }
			});
		} catch (error) { if (!onError) throw error; onError(directory, error); return []; }
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
		this.knowledgeErrors.length = 0;
		const result: Knowledge[] = [];
		for (const { scope, directory } of this.scopes) {
			const directories = [...Object.entries(knowledgeDirectories), ['memory', path.join('notes', 'memory')]];
			if (scope === 'global') directories.push(['memory', path.relative(directory, path.join(this.configRoot, 'notes', 'memory'))]);
			for (const [type, folder] of directories) {
				for (const file of this.files(path.join(directory, folder!), { onError: (file, error) => this.knowledgeErrors.push(this.brokenFile(file, error)) })) {
					let id: string | undefined;
					try {
						const text = this.read(file);
						const document = readMarkdown(text);
						if (document.metadata && typeof document.metadata === 'object' && 'id' in document.metadata && typeof document.metadata.id === 'string') id = document.metadata.id;
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
						if (!parsed.success) throw parsed.error;
						if (parsed.data.scope !== scope) throw new Error(`Knowledge scope does not match its directory: ${source}`);
						result.push({ ...parsed.data, content: legacy ? text.trim() : document.content, source, revision: hash(text) });
					} catch (error) { this.knowledgeErrors.push(this.brokenFile(file, error, id)); }
				}
			}
		}
		const counts = new Map<string, number>();
		for (const item of [...result, ...this.knowledgeErrors]) {
			if (item.id) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
		}
		for (const item of result) {
			if (counts.get(item.id)! > 1) this.knowledgeErrors.push(this.brokenFile(path.join(this.configRoot, item.source), new Error(`Duplicate knowledge id: ${item.id}`), item.id));
		}
		return result.filter((item) => counts.get(item.id) === 1);
	}

	search(query: string, options: { scopes?: Scope[]; types?: string[]; includeDeprecated?: boolean; limit?: number } = {}): Knowledge[] {
		return this.searchItems(this.allKnowledge(), query, options);
	}

	private searchItems(items: Knowledge[], query: string, options: { scopes?: Scope[]; types?: string[]; includeDeprecated?: boolean; limit?: number } = {}): Knowledge[] {
		const environment = this.profile ?? 'default';
		this.refreshIndex(items, environment);
		const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 50) ?? [];
		const ranked = terms.length ? this.db.prepare('SELECT source FROM knowledge WHERE knowledge MATCH ? AND environment = ? ORDER BY bm25(knowledge, 0, 0, 5, 1, 3), source')
			.all(terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR '), environment).map((row) => String(row.source)) : items.map((item) => item.source);
		const bySource = new Map(items.map((item) => [item.source, item]));
		return ranked.map((source) => bySource.get(source)).filter((item): item is Knowledge => item !== undefined).filter((item) =>
			(options.includeDeprecated || item.status === 'active') && (!options.scopes || options.scopes.includes(item.scope)) &&
			(!options.types || options.types.includes(item.type))).slice(0, options.limit ?? 50);
	}

	private refreshIndex(items: Knowledge[], environment: string): void {
		const desired = new Map(items.map((item) => [item.source, {
			source: item.source, title: item.title, content: item.content, tags: [...item.tags, item.finding ?? ''].join(' ').trim()
		}]));
		const changes = () => {
			const current = this.db.prepare('SELECT rowid, source, title, content, tags FROM knowledge WHERE environment = ?').all(environment);
			const unchanged = new Set<string>();
			const removed = current.filter((row) => {
				const item = desired.get(String(row.source));
				if (item && !unchanged.has(item.source) && row.title === item.title && row.content === item.content && row.tags === item.tags) {
					unchanged.add(item.source);
					return false;
				}
				return true;
			});
			return { removed, added: [...desired.values()].filter((item) => !unchanged.has(item.source)) };
		};
		const pending = changes();
		if (!pending.removed.length && !pending.added.length) return;
		this.db.exec('BEGIN IMMEDIATE');
		try {
			// Another connection may have refreshed the index while we waited for the lock.
			const { removed, added } = changes();
			const remove = this.db.prepare('DELETE FROM knowledge WHERE rowid = ?');
			for (const row of removed) remove.run(row.rowid!);
			const insert = this.db.prepare('INSERT INTO knowledge(source, environment, title, content, tags) VALUES (?, ?, ?, ?, ?)');
			for (const item of added) insert.run(item.source, environment, item.title, item.content, item.tags);
			this.db.exec('COMMIT');
		} catch (error) { this.db.exec('ROLLBACK'); throw error; }
	}

	context(task: string, files: string[] = [], symbols: string[] = []): { items: Knowledge[]; omitted: number; profile: string | null; scopes: Scope[] } {
		const scanned = this.allKnowledge();
		const all = scanned.filter((item) => item.status === 'active');
		const always = all.filter((item) => item.recall === 'always');
		const matching = all.filter((item) => item.applies_to.some((pattern) => files.some((file) => {
			const relative = path.isAbsolute(file) ? path.relative(this.projectRoot, file) : file;
			return path.matchesGlob(relative, pattern);
		})));
		const selected = [...new Map([...always, ...matching, ...this.searchItems(scanned, [task, ...symbols].join(' '))].map((item) => [item.id, item])).values()];
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
		if (value.type === 'review' && !value.severity) throw new Error('Review findings require a severity: critical, high, medium, or low.');
		if (value.type !== 'review' && value.severity) throw new Error('Severity applies only to review findings.');
		return this.writeLocked(() => {
			const now = new Date().toISOString();
			const { content, filename, ...metadata } = value;
			const review = value.severity ? { finding: this.nextFinding(value.scope, value.severity), state: 'open' as const } : {};
			const item = { ...metadata, ...review, id: randomUUID(), status: 'active' as const, created: now, updated: now };
			const directory = path.join(this.scopeDirectory(value.scope), knowledgeDirectories[value.type]);
			this.atomicWrite(this.availableFile(directory, filename, item.id), `---\n${stringifyYaml(item)}---\n\n${content}\n`);
			return this.allKnowledge().find((entry) => entry.id === item.id)!;
		});
	}

	/** Chosen name when one is given and free, otherwise the same name with the id appended. */
	private availableFile(directory: string, filename: string | undefined, id: string): string {
		if (!filename) return path.join(directory, `${id}.md`);
		const preferred = path.join(directory, `${filename}.md`);
		return fs.existsSync(preferred) ? path.join(directory, `${filename}-${id}.md`) : preferred;
	}

	/** Revise an item in place, keeping its id, filename, scope, type, authority, and history. */
	amend(id: string, revision: string, changes: z.input<typeof knowledgeChanges>): Knowledge {
		const parsed = knowledgeChanges.parse(changes);
		if (Object.keys(parsed).length === 0) throw new Error('Supply at least one field to change.');
		return this.writeLocked(() => {
			const item = this.get(id);
			if (item.revision !== revision) throw new Error('Knowledge changed; read the current revision before amending.');
			if (item.status !== 'active') throw new Error('Deprecated knowledge cannot be amended.');
			const { source, revision: _revision, content, ...metadata } = item;
			const { content: nextContent, ...nextMetadata } = parsed;
			this.atomicWrite(source, `---\n${stringifyYaml({ ...metadata, ...nextMetadata, updated: new Date().toISOString() })}---\n\n${nextContent ?? content}\n`);
			return this.get(id);
		});
	}

	/** Next unused finding label for a severity, counting resolved findings so numbers are never reused. */
	private nextFinding(scope: Scope, severity: z.infer<typeof severitySchema>): string {
		const prefix = severityPrefix[severity];
		const used = this.allKnowledge()
			.filter((item) => item.scope === scope && item.type === 'review' && item.finding?.startsWith(prefix))
			.map((item) => Number.parseInt(item.finding!.slice(prefix.length), 10))
			.filter((sequence) => Number.isSafeInteger(sequence));
		if (this.knowledgeErrors.some((item) => isSamePathOrDescendant(path.join(this.configRoot, item.source), path.join(this.scopeDirectory(scope), 'reviews')))) {
			throw new Error('Cannot assign a review number while review files are broken. List reviews and correct the reported files first.');
		}
		const counters = this.reviewCounters(scope);
		const next = Math.max(counters[prefix as keyof typeof counters], 0, ...used) + 1;
		this.reserveFinding(scope, `${prefix}${next}`);
		return `${prefix}${next}`;
	}

	/** Review findings in severity then sequence order. Open findings only unless states are given. */
	reviews(options: { severity?: z.infer<typeof severitySchema>[]; state?: z.infer<typeof reviewStateSchema>[] } = {}): Knowledge[] {
		const sequence = (item: Knowledge): number => Number.parseInt(item.finding!.slice(1), 10);
		return this.allKnowledge()
			.filter((item) => item.type === 'review' && item.finding && item.severity)
			.filter((item) => !options.severity || options.severity.includes(item.severity!))
			.filter((item) => (options.state ?? ['open']).includes(item.state ?? 'open'))
			.sort((left, right) => severityOrder[left.severity!] - severityOrder[right.severity!] || sequence(left) - sequence(right));
	}

	private reviewCounters(scope: Scope): z.infer<typeof reviewCountersSchema> {
		const file = this.safePath(this.scopeDirectory(scope), 'review-counters.json');
		return fs.existsSync(file) ? reviewCountersSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))) : { C: 0, H: 0, M: 0, L: 0 };
	}

	private reserveFinding(scope: Scope, finding: string): void {
		const counters = this.reviewCounters(scope);
		const prefix = finding[0] as keyof typeof counters;
		const number = Number(finding.slice(1));
		if (!Number.isSafeInteger(number) || number < 1) throw new Error('Invalid review number');
		counters[prefix] = Math.max(counters[prefix], number);
		this.atomicWrite(path.join(this.scopeDirectory(scope), 'review-counters.json'), JSON.stringify(counters) + '\n');
	}

	private closedReviews(scope: Scope): ReviewClosure[] {
		const file = this.safePath(this.scopeDirectory(scope), 'review-history.jsonl');
		if (!fs.existsSync(file)) return [];
		return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => {
			const record = reviewClosureSchema.parse(JSON.parse(line));
			if (record.scope !== scope) throw new Error(`Review history scope mismatch: ${file}`);
			return record;
		});
	}

	reviewHistory(options: { scope?: Scope; query?: string; state?: 'fixed' | 'wontfix'; offset?: number; limit?: number } = {}): { items: ReviewClosure[]; total: number } {
		const query = options.query?.toLowerCase();
		const items = this.scopes.filter((entry) => !options.scope || entry.scope === options.scope)
			.flatMap((entry) => this.closedReviews(entry.scope))
			.filter((item) => (!options.state || item.state === options.state) && (!query || [item.id, item.finding, item.title, item.reason].some((value) => value.toLowerCase().includes(query))))
			.sort((a, b) => b.closed.localeCompare(a.closed) || a.id.localeCompare(b.id));
		const offset = options.offset ?? 0;
		return { items: items.slice(offset, offset + (options.limit ?? 100)), total: items.length };
	}

	private archiveReview(item: Knowledge, state: 'fixed' | 'wontfix', reason: string, closed: string): ReviewClosure {
		if (!item.finding || !item.severity) throw new Error('Only numbered review findings can be archived.');
		const records = this.closedReviews(item.scope);
		const existing = records.find((record) => record.id === item.id);
		if (existing && (existing.revision !== item.revision || existing.state !== state)) throw new Error('Archived review conflicts with the current file; inspect review history before updating.');
		const record: ReviewClosure = existing ?? { id: item.id, finding: item.finding, severity: item.severity, scope: item.scope, title: item.title, state, closed, reason, source: item.source, revision: item.revision };
		// Persist the number and closure before removing the full finding. A retry can finish deletion.
		this.reserveFinding(item.scope, item.finding);
		if (!existing) this.atomicWrite(path.join(this.scopeDirectory(item.scope), 'review-history.jsonl'), [...records, record].map((entry) => JSON.stringify(entry)).join('\n') + '\n');
		fs.unlinkSync(this.safePath(item.source));
		return record;
	}

	archiveReviews(scope: Scope): ReviewClosure[] {
		return this.writeLocked(() => {
			const history = this.closedReviews(scope);
			return this.allKnowledge().filter((item) => item.scope === scope && item.type === 'review' && item.finding)
				.filter((item) => item.state === 'fixed' || item.state === 'wontfix' || history.some((record) => record.id === item.id))
				.map((item) => {
					const prior = history.find((record) => record.id === item.id);
					return this.archiveReview(item, prior?.state ?? item.state as 'fixed' | 'wontfix', prior?.reason ?? item.reason ?? '', prior?.closed ?? item.updated);
				});
		});
	}

	resolveReview(id: string, revision: string, state: 'fixed' | 'wontfix', reason?: string): ReviewClosure {
		return this.writeLocked(() => {
			const item = this.get(id);
			if (item.type !== 'review' || !item.finding) throw new Error('Only review findings can be resolved.');
			if (item.revision !== revision) throw new Error('Knowledge changed; read the current revision before updating.');
			return this.archiveReview(item, state, reason ?? '', new Date().toISOString());
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
			const renumbered = item.severity ? { finding: this.nextFinding(scope, item.severity) } : {};
			const promoted = { ...metadata, ...renumbered, id: randomUUID(), scope, authority: 'user', promoted_from: id, updated: new Date().toISOString() };
			const target = path.join(this.scopeDirectory(scope), knowledgeDirectories[item.type]);
			this.atomicWrite(this.availableFile(target, path.basename(item.source, '.md'), promoted.id), `---\n${stringifyYaml(promoted)}---\n\n${content}\n`);
			return this.get(promoted.id);
		});
	}

	get(id: string): Knowledge {
		const item = this.allKnowledge().find((entry) => entry.id === id);
		this.assertReadable(id, this.knowledgeErrors);
		if (!item) throw new Error(`Knowledge not found in the active scopes: ${id}. For consolidated records, look up this ID with knowledge_history${this.knowledgeErrors.length ? '. Some files are broken; list or search knowledge for their paths and errors' : ''}`);
		return item;
	}
}
