"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrainStore = exports.knowledgeDirectories = exports.knowledgeMetadata = exports.knowledgeInput = exports.typeSchema = exports.scopeSchema = void 0;
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
exports.knowledgeInput = zod_1.z.object({
    scope: exports.scopeSchema,
    type: exports.typeSchema,
    title: zod_1.z.string().trim().min(1).max(300),
    content: zod_1.z.string().trim().min(1).max(200000),
    authority: zod_1.z.enum(['user', 'inferred']).default('inferred'),
    recall: zod_1.z.enum(['always', 'relevant']).default('relevant'),
    tags: zod_1.z.array(zod_1.z.string().max(100)).max(50).default([]),
    applies_to: zod_1.z.array(zod_1.z.string().max(500)).max(50).default([])
}).strict();
exports.knowledgeMetadata = exports.knowledgeInput.omit({ content: true }).extend({
    id: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    status: zod_1.z.enum(['active', 'deprecated']).default('active'),
    created: zod_1.z.string().default(''),
    updated: zod_1.z.string().default(''),
    reason: zod_1.z.string().optional(),
    promoted_from: zod_1.z.string().optional()
}).strict();
exports.knowledgeDirectories = {
    rule: 'rules', preference: 'preferences', convention: 'conventions', constraint: 'constraints',
    decision: 'decisions', spec: 'specs', review: 'reviews', memory: 'memory', observation: 'observations'
};
function readMarkdown(text) {
    const normalized = text.replace(/\r\n/g, '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    return match ? { metadata: (0, yaml_1.parse)(match[1], { maxAliasCount: 50 }), content: normalized.slice(match[0].length).trim() }
        : { metadata: null, content: normalized.trim() };
}
function hash(text) { return (0, node_crypto_1.createHash)('sha256').update(text).digest('hex'); }
class BrainStore {
    constructor(configRoot, cwd) {
        this.configRoot = configRoot;
        this.cwd = cwd;
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
    files(directory) {
        this.safePath(directory);
        if (!fs.existsSync(directory))
            return [];
        return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
            const file = this.safePath(directory, entry.name);
            return entry.isDirectory() ? this.files(file) : entry.isFile() && entry.name.endsWith('.md') ? [file] : [];
        });
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
        const result = [];
        for (const { scope, directory } of this.scopes) {
            const directories = [...Object.entries(exports.knowledgeDirectories), ['memory', path.join('notes', 'memory')]];
            if (scope === 'global')
                directories.push(['memory', path.relative(directory, path.join(this.configRoot, 'notes', 'memory'))]);
            for (const [type, folder] of directories) {
                for (const file of this.files(path.join(directory, folder))) {
                    const text = this.read(file);
                    const document = readMarkdown(text);
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
                        throw new Error(`Invalid knowledge metadata in ${source}: ${parsed.error.message}`);
                    if (parsed.data.scope !== scope)
                        throw new Error(`Knowledge scope does not match its directory: ${source}`);
                    result.push({ ...parsed.data, content: legacy ? text.trim() : document.content, source, revision: hash(text) });
                }
            }
        }
        const ids = new Set();
        for (const item of result) {
            if (ids.has(item.id))
                throw new Error(`Duplicate knowledge id: ${item.id}`);
            ids.add(item.id);
        }
        return result;
    }
    search(query, options = {}) {
        const items = this.allKnowledge();
        const environment = this.profile ?? 'default';
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare('DELETE FROM knowledge WHERE environment = ?').run(environment);
            const insert = this.db.prepare('INSERT INTO knowledge(source, environment, title, content, tags) VALUES (?, ?, ?, ?, ?)');
            for (const item of items)
                insert.run(item.source, environment, item.title, item.content, item.tags.join(' '));
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 50) ?? [];
        const ranked = terms.length ? this.db.prepare('SELECT source FROM knowledge WHERE knowledge MATCH ? AND environment = ? ORDER BY bm25(knowledge, 0, 0, 5, 1, 3), source')
            .all(terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR '), environment).map((row) => String(row.source)) : items.map((item) => item.source);
        const bySource = new Map(items.map((item) => [item.source, item]));
        return ranked.map((source) => bySource.get(source)).filter((item) => (options.includeDeprecated || item.status === 'active') && (!options.scopes || options.scopes.includes(item.scope)) &&
            (!options.types || options.types.includes(item.type))).slice(0, options.limit ?? 50);
    }
    context(task, files = [], symbols = []) {
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
        return this.writeLocked(() => {
            const now = new Date().toISOString();
            const { content, ...metadata } = value;
            const item = { ...metadata, id: (0, node_crypto_1.randomUUID)(), status: 'active', created: now, updated: now };
            const file = path.join(this.scopeDirectory(value.scope), exports.knowledgeDirectories[value.type], `${item.id}.md`);
            this.atomicWrite(file, `---\n${(0, yaml_1.stringify)(item)}---\n\n${content}\n`);
            return this.allKnowledge().find((entry) => entry.id === item.id);
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
            const promoted = { ...metadata, id: (0, node_crypto_1.randomUUID)(), scope, authority: 'user', promoted_from: id, updated: new Date().toISOString() };
            this.atomicWrite(path.join(this.scopeDirectory(scope), exports.knowledgeDirectories[item.type], `${promoted.id}.md`), `---\n${(0, yaml_1.stringify)(promoted)}---\n\n${content}\n`);
            return this.get(promoted.id);
        });
    }
    get(id) {
        const item = this.allKnowledge().find((entry) => entry.id === id);
        if (!item)
            throw new Error(`Knowledge not found in the active scopes: ${id}`);
        return item;
    }
}
exports.BrainStore = BrainStore;
