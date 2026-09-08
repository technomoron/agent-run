"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.historyOptions = exports.inventoryOptions = exports.archiveInput = void 0;
exports.listKnowledge = listKnowledge;
exports.knowledgeHistory = knowledgeHistory;
exports.archiveKnowledge = archiveKnowledge;
const fs = require("node:fs");
const path = require("node:path");
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const store_1 = require("./store");
const reference = zod_1.z.object({ id: zod_1.z.string().min(1).max(200), revision: zod_1.z.string().regex(/^[a-f0-9]{64}$/) }).strict();
exports.archiveInput = zod_1.z.object({
    sources: zod_1.z.array(reference.extend({ replacements: zod_1.z.array(reference).min(1).max(50) })).min(1).max(50),
    reason: zod_1.z.string().trim().min(1).max(2000)
}).strict();
const archivedRecord = reference.extend({
    scope: store_1.scopeSchema, title: zod_1.z.string(), source: zod_1.z.string(), text: zod_1.z.string(),
    archived: zod_1.z.string(), reason: zod_1.z.string(), replacements: zod_1.z.array(reference).min(1)
}).strict();
exports.inventoryOptions = zod_1.z.object({
    scope: store_1.scopeSchema.optional(), types: zod_1.z.array(store_1.typeSchema).optional(), includeDeprecated: zod_1.z.boolean().optional(),
    offset: zod_1.z.number().int().min(0).default(0), limit: zod_1.z.number().int().min(1).max(100).default(50)
}).strict();
function listKnowledge(store, input = {}) {
    const options = exports.inventoryOptions.parse(input);
    if (options.scope)
        store.scopeDirectory(options.scope);
    const items = store.allKnowledge().filter((item) => (!options.scope || item.scope === options.scope)
        && (!options.types || options.types.includes(item.type)) && (options.includeDeprecated || item.status === 'active'))
        .sort((a, b) => a.source.localeCompare(b.source));
    return { total: items.length, contextBudget: store.budget, items: items.slice(options.offset, options.offset + options.limit).map(({ content, ...item }) => ({ ...item, characters: content.length })) };
}
function historyFile(store, scope) {
    return store.safePath(store.scopeDirectory(scope), 'knowledge-history.jsonl');
}
function readHistory(store, scope) {
    const file = historyFile(store, scope);
    if (!fs.existsSync(file))
        return [];
    const records = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => archivedRecord.parse(JSON.parse(line)));
    const ids = new Set();
    for (const record of records) {
        if (record.scope !== scope || ids.has(record.id) || (0, node_crypto_1.createHash)('sha256').update(record.text).digest('hex') !== record.revision) {
            throw new Error(`Invalid or duplicate knowledge history record: ${file}`);
        }
        ids.add(record.id);
    }
    return records;
}
exports.historyOptions = zod_1.z.object({
    scope: store_1.scopeSchema.optional(), id: reference.shape.id.optional(), query: zod_1.z.string().max(1000).optional(),
    offset: zod_1.z.number().int().min(0).default(0), limit: zod_1.z.number().int().min(1).max(100).default(50)
}).strict();
function knowledgeHistory(store, input = {}) {
    const options = exports.historyOptions.parse(input);
    if (options.scope)
        store.scopeDirectory(options.scope);
    const query = options.query?.toLowerCase();
    const records = store.scopes.filter((entry) => !options.scope || entry.scope === options.scope).flatMap((entry) => readHistory(store, entry.scope))
        .filter((record) => (!options.id || record.id === options.id) && (!query || [record.id, record.title, record.reason].some((value) => value.toLowerCase().includes(query))))
        .sort((a, b) => b.archived.localeCompare(a.archived) || a.id.localeCompare(b.id));
    return { total: records.length, items: records.slice(options.offset, options.offset + options.limit).map(({ text, ...record }) => ({ ...record, ...(options.id ? { text } : {}) })) };
}
/** Replacements are written and checked first. Preserve exact originals before any deletion. */
function archiveKnowledge(store, input) {
    const options = exports.archiveInput.parse(input);
    return store.writeLocked(() => {
        const sourceIds = new Set(options.sources.map((item) => item.id));
        if (sourceIds.size !== options.sources.length)
            throw new Error('Duplicate archive source IDs.');
        const all = store.allKnowledge();
        const byId = new Map(all.map((item) => [item.id, item]));
        const firstReplacement = options.sources[0].replacements[0];
        store.assertReadable(firstReplacement.id, store.knowledgeErrors);
        const scope = byId.get(firstReplacement.id)?.scope;
        if (!scope)
            throw new Error('Replacement not found in the active scopes.');
        const history = readHistory(store, scope);
        const pending = options.sources.map((source) => {
            store.assertReadable(source.id, store.knowledgeErrors);
            const item = byId.get(source.id);
            const prior = history.find((record) => record.id === source.id);
            const replacements = source.replacements.map((ref) => {
                store.assertReadable(ref.id, store.knowledgeErrors);
                const replacement = byId.get(ref.id);
                if (sourceIds.has(ref.id))
                    throw new Error('An archive source cannot also be a replacement.');
                if (!replacement || replacement.status !== 'active' || replacement.type === 'review')
                    throw new Error('Replacements must be active non-review knowledge.');
                if (replacement.revision !== ref.revision)
                    throw new Error('Replacement changed; read the current revision.');
                if (replacement.scope !== scope)
                    throw new Error('Archive sources and replacements must share one scope.');
                return replacement;
            });
            if (prior && (prior.revision !== source.revision || JSON.stringify(prior.replacements) !== JSON.stringify(source.replacements)))
                throw new Error('Archived knowledge conflicts with this request; inspect knowledge_history.');
            if (!item) {
                if (!prior)
                    throw new Error(`Knowledge not found: ${source.id}`);
                return { record: prior, remove: false };
            }
            if (item.revision !== source.revision)
                throw new Error('Knowledge changed; read the current revision before archiving.');
            if (item.scope !== scope)
                throw new Error('Archive sources and replacements must share one scope.');
            if (item.type === 'review')
                throw new Error('Use the review tools for review findings.');
            if (replacements.some((replacement) => replacement.authority !== item.authority))
                throw new Error('Consolidation must preserve authority; keep uncertain knowledge separate.');
            if (item.recall === 'always' && !replacements.some((replacement) => replacement.recall === 'always'))
                throw new Error('Preserve always recall in a replacement.');
            if (item.applies_to.some((pattern) => !replacements.some((replacement) => replacement.applies_to.includes(pattern))))
                throw new Error('Preserve applies_to patterns in the replacements.');
            const text = store.read(item.source);
            if ((0, node_crypto_1.createHash)('sha256').update(text).digest('hex') !== item.revision)
                throw new Error('Knowledge changed while preparing the archive.');
            const record = prior ?? { id: item.id, revision: item.revision, scope, title: item.title, source: item.source, text,
                archived: new Date().toISOString(), reason: options.reason, replacements: source.replacements };
            if (prior && prior.source !== item.source)
                throw new Error('Archived source path changed; inspect knowledge_history.');
            return { record, remove: true };
        });
        const added = pending.filter(({ record }) => !history.some((old) => old.id === record.id)).map(({ record }) => record);
        if (added.length)
            store.atomicWrite(historyFile(store, scope), [...history, ...added].map((record) => JSON.stringify(record)).join('\n') + '\n');
        // If deletion fails, the archive and replacements survive. An identical retry finishes it.
        for (const { record, remove } of pending)
            if (remove)
                fs.unlinkSync(store.safePath(record.source));
        return { archived: pending.map(({ record }) => record.id), history: path.relative(store.configRoot, historyFile(store, scope)) };
    });
}
