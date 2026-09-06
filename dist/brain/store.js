"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrainStore = exports.knowledgeDirectories = exports.knowledgeChanges = exports.knowledgeMetadata = exports.knowledgeInput = exports.reviewStateSchema = exports.severitySchema = exports.typeSchema = exports.scopeSchema = void 0;
exports.readMarkdown = readMarkdown;
const fs = require("node:fs");
const path = require("node:path");
const node_crypto_1 = require("node:crypto");
const node_sqlite_1 = require("node:sqlite");
const yaml_1 = require("yaml");
const zod_1 = require("zod");
const project_1 = require("../project");
const utils_1 = require("../utils");
const config_1 = require("./config");
exports.scopeSchema = zod_1.z.enum(['global', 'project', 'default']);
exports.typeSchema = zod_1.z.enum(['rule', 'preference', 'convention', 'constraint', 'decision', 'spec', 'review', 'memory', 'observation']);
exports.severitySchema = zod_1.z.enum(['critical', 'high', 'medium', 'low']);
exports.reviewStateSchema = zod_1.z.enum(['open', 'fixed', 'wontfix']);
const severityPrefix = { critical: 'C', high: 'H', medium: 'M', low: 'L' };
const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
exports.knowledgeInput = zod_1.z.object({
    scope: exports.scopeSchema,
    type: exports.typeSchema,
    title: zod_1.z.string().trim().min(1).max(300),
    content: zod_1.z.string().trim().min(1).max(200000),
    authority: zod_1.z.enum(['user', 'inferred']).default('inferred'),
    recall: zod_1.z.enum(['always', 'relevant']).default('relevant'),
    severity: exports.severitySchema.optional(),
    tags: zod_1.z.array(zod_1.z.string().max(100)).max(50).default([]),
    applies_to: zod_1.z.array(zod_1.z.string().max(500)).max(50).default([]),
    // Naming only. The id in the front matter stays the identity, so files can be renamed freely.
    filename: zod_1.z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case words separated by single dashes, with no extension').max(100).optional()
}).strict();
// finding and state stay optional so review files written before they existed keep parsing.
exports.knowledgeMetadata = exports.knowledgeInput.omit({ content: true, filename: true }).extend({
    id: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    status: zod_1.z.enum(['active', 'deprecated']).default('active'),
    finding: zod_1.z.string().regex(/^[CHML][1-9][0-9]*$/).optional(),
    state: exports.reviewStateSchema.optional(),
    created: zod_1.z.string().default(''),
    updated: zod_1.z.string().default(''),
    reason: zod_1.z.string().optional(),
    promoted_from: zod_1.z.string().optional()
}).strict();
// Spelled out rather than derived from knowledgeInput: .partial() keeps .default(), so a
// derived schema would silently reset every field the caller did not mention.
exports.knowledgeChanges = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(300).optional(),
    content: zod_1.z.string().trim().min(1).max(200000).optional(),
    recall: zod_1.z.enum(['always', 'relevant']).optional(),
    tags: zod_1.z.array(zod_1.z.string().max(100)).max(50).optional(),
    applies_to: zod_1.z.array(zod_1.z.string().max(500)).max(50).optional()
}).strict();
const reviewClosureSchema = zod_1.z.object({
    id: zod_1.z.string(), finding: zod_1.z.string().regex(/^[CHML][1-9][0-9]*$/), severity: exports.severitySchema,
    scope: exports.scopeSchema, title: zod_1.z.string(), state: zod_1.z.enum(['fixed', 'wontfix']),
    closed: zod_1.z.string(), reason: zod_1.z.string(), source: zod_1.z.string(), revision: zod_1.z.string()
}).strict();
const reviewCountersSchema = zod_1.z.object({ C: zod_1.z.number().int().nonnegative(), H: zod_1.z.number().int().nonnegative(), M: zod_1.z.number().int().nonnegative(), L: zod_1.z.number().int().nonnegative() }).strict();
exports.knowledgeDirectories = {
    rule: 'rules', preference: 'preferences', convention: 'conventions', constraint: 'constraints',
    decision: 'decisions', spec: 'specs', review: 'reviews', memory: 'memory', observation: 'observations'
};
function readMarkdown(text) {
    const normalized = text.replace(/\r\n/g, '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    if (normalized.startsWith('---\n') && !match)
        throw new Error('Unterminated YAML front matter');
    return match ? { metadata: (0, yaml_1.parse)(match[1], { maxAliasCount: 50 }), content: normalized.slice(match[0].length).trim() }
        : { metadata: null, content: normalized.trim() };
}
function hash(text) { return (0, node_crypto_1.createHash)('sha256').update(text).digest('hex'); }
class BrainStore {
    brokenFile(file, error, id) {
        const message = error instanceof zod_1.z.ZodError
            ? error.issues.map((issue) => `${issue.path.join('.') || 'metadata'}: ${issue.message}`).join('; ')
            : error instanceof Error ? error.message.split('\n')[0] : String(error);
        return { source: path.relative(this.configRoot, file), status: 'broken', error: message, ...(id ? { id } : {}) };
    }
    withDiagnostics(value) {
        const brokenFiles = [...this.knowledgeErrors, ...this.todoErrors];
        if (!brokenFiles.length)
            return value;
        return Array.isArray(value) ? { items: value, brokenFiles } : { ...value, brokenFiles };
    }
    assertReadable(id, errors) {
        const matches = errors.filter((item) => item.id === id || item.source === id || path.basename(item.source, '.md') === id);
        if (matches.length)
            throw new Error(`Cannot read or update broken file: ${matches.map((item) => `${item.source}: ${item.error}`).join('; ')}. Correct the file on disk first.`);
    }
    constructor(configRoot, cwd) {
        this.configRoot = configRoot;
        this.cwd = cwd;
        this.knowledgeErrors = [];
        this.todoErrors = [];
        this.configRoot = path.resolve(configRoot);
        this.projectRoot = (0, config_1.registeredBrainProject)(this.configRoot, cwd)?.root ?? (0, project_1.findProjectRoot)(cwd);
        const resolved = (0, project_1.resolveProfileResult)(this.projectRoot, this.configRoot).profile;
        this.profile = resolved && resolved !== 'default' && ['agent-run.jsonc', 'local.md.njk', 'AGENTS-MODS.md'].some((file) => fs.existsSync(path.join(this.configRoot, resolved, file))) ? resolved : null;
        this.scopes = [{ scope: 'global', directory: path.join(this.configRoot, 'global') },
            { scope: this.profile ? 'project' : 'default', directory: path.join(this.configRoot, this.profile ?? 'default') }];
        this.budget = (0, config_1.readBrainConfig)(this.configRoot)?.contextBudget ?? 16000;
        this.directory('index');
        this.directory('runtime');
        this.db = new node_sqlite_1.DatabaseSync(this.safePath('index', 'knowledge.sqlite'));
        this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; CREATE VIRTUAL TABLE IF NOT EXISTS knowledge USING fts5(source UNINDEXED, environment UNINDEXED, title, content, tags);');
    }
    close() { this.db.close(); }
    safePath(...parts) {
        const target = path.resolve(this.configRoot, ...parts);
        if (!(0, utils_1.isSamePathOrDescendant)(target, this.configRoot))
            throw new Error('Path escapes the brain configuration directory');
        let current = this.configRoot;
        for (const part of path.relative(this.configRoot, target).split(path.sep).filter(Boolean)) {
            current = path.join(current, part);
            try {
                if (fs.lstatSync(current).isSymbolicLink())
                    throw new Error(`Symlinks are not supported in brain storage: ${current}`);
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        return target;
    }
    directory(...parts) {
        const directory = this.safePath(...parts);
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        return directory;
    }
    scopeDirectory(scope) {
        const directory = this.scopes.find((entry) => entry.scope === scope)?.directory;
        if (!directory)
            throw new Error(`Scope ${scope} is not available in this environment`);
        return this.safePath(directory);
    }
    files(directory, options = {}) {
        const { onError } = options;
        try {
            this.safePath(directory);
            if (!fs.existsSync(directory))
                return [];
            return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
                try {
                    const file = this.safePath(directory, entry.name);
                    return entry.isDirectory() ? this.files(file, options) : entry.isFile() && (options.includeAllFiles || entry.name.endsWith('.md')) ? [file] : [];
                }
                catch (error) {
                    if (!onError)
                        throw error;
                    onError(path.join(directory, entry.name), error);
                    return [];
                }
            });
        }
        catch (error) {
            if (!onError)
                throw error;
            onError(directory, error);
            return [];
        }
    }
    read(file) {
        const target = this.safePath(file);
        if (fs.statSync(target).size > 1024 * 1024)
            throw new Error(`Markdown file exceeds 1 MiB: ${file}`);
        return fs.readFileSync(target, 'utf8');
    }
    atomicWrite(file, text) {
        const target = this.safePath(file);
        this.directory(path.dirname(target));
        const temporary = `${target}.${(0, node_crypto_1.randomUUID)()}.tmp`;
        try {
            fs.writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, target);
        }
        finally {
            fs.rmSync(temporary, { force: true });
        }
    }
    writeLocked(fn) {
        const file = this.safePath('runtime', 'brain-write.lock');
        let descriptor;
        try {
            descriptor = fs.openSync(file, 'wx', 0o600);
        }
        catch (error) {
            if (error.code === 'EEXIST')
                throw new Error('Another brain write is in progress. Retry; after a crashed writer, remove runtime/brain-write.lock.');
            throw error;
        }
        try {
            fs.writeSync(descriptor, String(process.pid));
            return fn();
        }
        finally {
            fs.closeSync(descriptor);
            fs.unlinkSync(file);
        }
    }
    allKnowledge() {
        this.knowledgeErrors.length = 0;
        const result = [];
        for (const { scope, directory } of this.scopes) {
            const directories = [...Object.entries(exports.knowledgeDirectories), ['memory', path.join('notes', 'memory')]];
            if (scope === 'global')
                directories.push(['memory', path.relative(directory, path.join(this.configRoot, 'notes', 'memory'))]);
            for (const [type, folder] of directories) {
                for (const file of this.files(path.join(directory, folder), { onError: (file, error) => this.knowledgeErrors.push(this.brokenFile(file, error)) })) {
                    let id;
                    try {
                        const text = this.read(file);
                        const document = readMarkdown(text);
                        if (document.metadata && typeof document.metadata === 'object' && 'id' in document.metadata && typeof document.metadata.id === 'string')
                            id = document.metadata.id;
                        const source = path.relative(this.configRoot, file);
                        const legacy = document.metadata !== null && typeof document.metadata === 'object' && !Array.isArray(document.metadata)
                            && !('id' in document.metadata) && !('type' in document.metadata);
                        const legacyStatus = legacy ? document.metadata.status : undefined;
                        const metadata = document.metadata === null || legacy ? {
                            id: `document-${hash(source).slice(0, 24)}`, scope, type,
                            title: /^#\s+(.+)$/m.exec(document.content)?.[1] ?? path.basename(file, '.md'),
                            status: type === 'review' && ['addressed', 'resolved', 'done', 'closed'].includes(String(legacyStatus)) ? 'deprecated' : 'active',
                            created: '', updated: ''
                        } : { title: /^#\s+(.+)$/m.exec(document.content)?.[1] ?? path.basename(file, '.md'), ...document.metadata };
                        const parsed = exports.knowledgeMetadata.safeParse(metadata);
                        if (!parsed.success)
                            throw parsed.error;
                        if (parsed.data.scope !== scope)
                            throw new Error(`Knowledge scope does not match its directory: ${source}`);
                        result.push({ ...parsed.data, content: legacy ? text.trim() : document.content, source, revision: hash(text) });
                    }
                    catch (error) {
                        this.knowledgeErrors.push(this.brokenFile(file, error, id));
                    }
                }
            }
        }
        const counts = new Map();
        for (const item of [...result, ...this.knowledgeErrors]) {
            if (item.id)
                counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
        }
        for (const item of result) {
            if (counts.get(item.id) > 1)
                this.knowledgeErrors.push(this.brokenFile(path.join(this.configRoot, item.source), new Error(`Duplicate knowledge id: ${item.id}`), item.id));
        }
        return result.filter((item) => counts.get(item.id) === 1);
    }
    search(query, options = {}) {
        return this.searchItems(this.allKnowledge(), query, options);
    }
    searchItems(items, query, options = {}) {
        const environment = this.profile ?? 'default';
        this.refreshIndex(items, environment);
        const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 50) ?? [];
        const ranked = terms.length ? this.db.prepare('SELECT source FROM knowledge WHERE knowledge MATCH ? AND environment = ? ORDER BY bm25(knowledge, 0, 0, 5, 1, 3), source')
            .all(terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR '), environment).map((row) => String(row.source)) : items.map((item) => item.source);
        const bySource = new Map(items.map((item) => [item.source, item]));
        return ranked.map((source) => bySource.get(source)).filter((item) => item !== undefined).filter((item) => (options.includeDeprecated || item.status === 'active') && (!options.scopes || options.scopes.includes(item.scope)) &&
            (!options.types || options.types.includes(item.type))).slice(0, options.limit ?? 50);
    }
    refreshIndex(items, environment) {
        const desired = new Map(items.map((item) => [item.source, {
                source: item.source, title: item.title, content: item.content, tags: [...item.tags, item.finding ?? ''].join(' ').trim()
            }]));
        const changes = () => {
            const current = this.db.prepare('SELECT rowid, source, title, content, tags FROM knowledge WHERE environment = ?').all(environment);
            const unchanged = new Set();
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
        if (!pending.removed.length && !pending.added.length)
            return;
        this.db.exec('BEGIN IMMEDIATE');
        try {
            // Another connection may have refreshed the index while we waited for the lock.
            const { removed, added } = changes();
            const remove = this.db.prepare('DELETE FROM knowledge WHERE rowid = ?');
            for (const row of removed)
                remove.run(row.rowid);
            const insert = this.db.prepare('INSERT INTO knowledge(source, environment, title, content, tags) VALUES (?, ?, ?, ?, ?)');
            for (const item of added)
                insert.run(item.source, environment, item.title, item.content, item.tags);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    context(task, files = [], symbols = []) {
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
            if (size + length > this.budget)
                return false;
            size += length;
            return true;
        });
        return { items, omitted: selected.length - items.length, profile: this.profile, scopes: this.scopes.map((scope) => scope.scope) };
    }
    remember(input) {
        const value = exports.knowledgeInput.parse(input);
        if (value.authority === 'inferred' && value.type !== 'observation' && value.type !== 'memory' && value.type !== 'review') {
            throw new Error('Inferred knowledge must remain an observation, memory, or review until explicitly confirmed.');
        }
        if (value.scope === 'global' && value.authority !== 'user')
            throw new Error('Global writes require explicit user authority.');
        if (value.type === 'review' && !value.severity)
            throw new Error('Review findings require a severity: critical, high, medium, or low.');
        if (value.type !== 'review' && value.severity)
            throw new Error('Severity applies only to review findings.');
        return this.writeLocked(() => {
            const now = new Date().toISOString();
            const { content, filename, ...metadata } = value;
            const review = value.severity ? { finding: this.nextFinding(value.scope, value.severity), state: 'open' } : {};
            const item = { ...metadata, ...review, id: (0, node_crypto_1.randomUUID)(), status: 'active', created: now, updated: now };
            const directory = path.join(this.scopeDirectory(value.scope), exports.knowledgeDirectories[value.type]);
            this.atomicWrite(this.availableFile(directory, filename, item.id), `---\n${(0, yaml_1.stringify)(item)}---\n\n${content}\n`);
            return this.allKnowledge().find((entry) => entry.id === item.id);
        });
    }
    /** Chosen name when one is given and free, otherwise the same name with the id appended. */
    availableFile(directory, filename, id) {
        if (!filename)
            return path.join(directory, `${id}.md`);
        const preferred = path.join(directory, `${filename}.md`);
        return fs.existsSync(preferred) ? path.join(directory, `${filename}-${id}.md`) : preferred;
    }
    /** Revise an item in place, keeping its id, filename, scope, type, authority, and history. */
    amend(id, revision, changes) {
        const parsed = exports.knowledgeChanges.parse(changes);
        if (Object.keys(parsed).length === 0)
            throw new Error('Supply at least one field to change.');
        return this.writeLocked(() => {
            const item = this.get(id);
            if (item.revision !== revision)
                throw new Error('Knowledge changed; read the current revision before amending.');
            if (item.status !== 'active')
                throw new Error('Deprecated knowledge cannot be amended.');
            const { source, revision: _revision, content, ...metadata } = item;
            const { content: nextContent, ...nextMetadata } = parsed;
            this.atomicWrite(source, `---\n${(0, yaml_1.stringify)({ ...metadata, ...nextMetadata, updated: new Date().toISOString() })}---\n\n${nextContent ?? content}\n`);
            return this.get(id);
        });
    }
    /** Next unused finding label for a severity, counting resolved findings so numbers are never reused. */
    nextFinding(scope, severity) {
        const prefix = severityPrefix[severity];
        const used = this.allKnowledge()
            .filter((item) => item.scope === scope && item.type === 'review' && item.finding?.startsWith(prefix))
            .map((item) => Number.parseInt(item.finding.slice(prefix.length), 10))
            .filter((sequence) => Number.isSafeInteger(sequence));
        if (this.knowledgeErrors.some((item) => (0, utils_1.isSamePathOrDescendant)(path.join(this.configRoot, item.source), path.join(this.scopeDirectory(scope), 'reviews')))) {
            throw new Error('Cannot assign a review number while review files are broken. List reviews and correct the reported files first.');
        }
        const counters = this.reviewCounters(scope);
        const next = Math.max(counters[prefix], 0, ...used) + 1;
        this.reserveFinding(scope, `${prefix}${next}`);
        return `${prefix}${next}`;
    }
    /** Review findings in severity then sequence order. Open findings only unless states are given. */
    reviews(options = {}) {
        const sequence = (item) => Number.parseInt(item.finding.slice(1), 10);
        return this.allKnowledge()
            .filter((item) => item.type === 'review' && item.finding && item.severity)
            .filter((item) => !options.severity || options.severity.includes(item.severity))
            .filter((item) => (options.state ?? ['open']).includes(item.state ?? 'open'))
            .sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || sequence(left) - sequence(right));
    }
    reviewCounters(scope) {
        const file = this.safePath(this.scopeDirectory(scope), 'review-counters.json');
        return fs.existsSync(file) ? reviewCountersSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))) : { C: 0, H: 0, M: 0, L: 0 };
    }
    reserveFinding(scope, finding) {
        const counters = this.reviewCounters(scope);
        const prefix = finding[0];
        const number = Number(finding.slice(1));
        if (!Number.isSafeInteger(number) || number < 1)
            throw new Error('Invalid review number');
        counters[prefix] = Math.max(counters[prefix], number);
        this.atomicWrite(path.join(this.scopeDirectory(scope), 'review-counters.json'), JSON.stringify(counters) + '\n');
    }
    closedReviews(scope) {
        const file = this.safePath(this.scopeDirectory(scope), 'review-history.jsonl');
        if (!fs.existsSync(file))
            return [];
        return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => {
            const record = reviewClosureSchema.parse(JSON.parse(line));
            if (record.scope !== scope)
                throw new Error(`Review history scope mismatch: ${file}`);
            return record;
        });
    }
    reviewHistory(options = {}) {
        const query = options.query?.toLowerCase();
        const items = this.scopes.filter((entry) => !options.scope || entry.scope === options.scope)
            .flatMap((entry) => this.closedReviews(entry.scope))
            .filter((item) => (!options.state || item.state === options.state) && (!query || [item.id, item.finding, item.title, item.reason].some((value) => value.toLowerCase().includes(query))))
            .sort((a, b) => b.closed.localeCompare(a.closed) || a.id.localeCompare(b.id));
        const offset = options.offset ?? 0;
        return { items: items.slice(offset, offset + (options.limit ?? 100)), total: items.length };
    }
    archiveReview(item, state, reason, closed) {
        if (!item.finding || !item.severity)
            throw new Error('Only numbered review findings can be archived.');
        const records = this.closedReviews(item.scope);
        const existing = records.find((record) => record.id === item.id);
        if (existing && (existing.revision !== item.revision || existing.state !== state))
            throw new Error('Archived review conflicts with the current file; inspect review history before updating.');
        const record = existing ?? { id: item.id, finding: item.finding, severity: item.severity, scope: item.scope, title: item.title, state, closed, reason, source: item.source, revision: item.revision };
        // Persist the number and closure before removing the full finding. A retry can finish deletion.
        this.reserveFinding(item.scope, item.finding);
        if (!existing)
            this.atomicWrite(path.join(this.scopeDirectory(item.scope), 'review-history.jsonl'), [...records, record].map((entry) => JSON.stringify(entry)).join('\n') + '\n');
        fs.unlinkSync(this.safePath(item.source));
        return record;
    }
    archiveReviews(scope) {
        return this.writeLocked(() => {
            const history = this.closedReviews(scope);
            return this.allKnowledge().filter((item) => item.scope === scope && item.type === 'review' && item.finding)
                .filter((item) => item.state === 'fixed' || item.state === 'wontfix' || history.some((record) => record.id === item.id))
                .map((item) => {
                const prior = history.find((record) => record.id === item.id);
                return this.archiveReview(item, prior?.state ?? item.state, prior?.reason ?? item.reason ?? '', prior?.closed ?? item.updated);
            });
        });
    }
    resolveReview(id, revision, state, reason) {
        return this.writeLocked(() => {
            const item = this.get(id);
            if (item.type !== 'review' || !item.finding)
                throw new Error('Only review findings can be resolved.');
            if (item.revision !== revision)
                throw new Error('Knowledge changed; read the current revision before updating.');
            return this.archiveReview(item, state, reason ?? '', new Date().toISOString());
        });
    }
    deprecate(id, revision, reason) {
        return this.writeLocked(() => {
            const item = this.get(id);
            if (item.revision !== revision)
                throw new Error('Knowledge changed; read the current revision before updating.');
            const { source, revision: _revision, content, ...metadata } = item;
            this.atomicWrite(source, `---\n${(0, yaml_1.stringify)({ ...metadata, status: 'deprecated', updated: new Date().toISOString(), ...(reason ? { reason } : {}) })}---\n\n${content}\n`);
            return this.get(id);
        });
    }
    promote(id, scope, revision) {
        return this.writeLocked(() => {
            const item = this.get(id);
            if (item.revision !== revision)
                throw new Error('Knowledge changed; read the current revision before promoting.');
            if (item.status !== 'active')
                throw new Error('Deprecated knowledge cannot be promoted.');
            if (item.scope === scope)
                throw new Error('Knowledge already belongs to this scope.');
            const { source: _source, revision: _revision, content, ...metadata } = item;
            const renumbered = item.severity ? { finding: this.nextFinding(scope, item.severity) } : {};
            const promoted = { ...metadata, ...renumbered, id: (0, node_crypto_1.randomUUID)(), scope, authority: 'user', promoted_from: id, updated: new Date().toISOString() };
            const target = path.join(this.scopeDirectory(scope), exports.knowledgeDirectories[item.type]);
            this.atomicWrite(this.availableFile(target, path.basename(item.source, '.md'), promoted.id), `---\n${(0, yaml_1.stringify)(promoted)}---\n\n${content}\n`);
            return this.get(promoted.id);
        });
    }
    get(id) {
        const item = this.allKnowledge().find((entry) => entry.id === id);
        this.assertReadable(id, this.knowledgeErrors);
        if (!item)
            throw new Error(`Knowledge not found in the active scopes: ${id}${this.knowledgeErrors.length ? '. Some files are broken; list or search knowledge for their paths and errors' : ''}`);
        return item;
    }
}
exports.BrainStore = BrainStore;
