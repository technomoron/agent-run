import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BrainStore, scopeSchema, typeSchema } from './store';

const reference = z.object({ id: z.string().min(1).max(200), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const archiveInput = z.object({
	sources: z.array(reference.extend({ replacements: z.array(reference).min(1).max(50) })).min(1).max(50),
	reason: z.string().trim().min(1).max(2000)
}).strict();
const archivedRecord = reference.extend({
	scope: scopeSchema, title: z.string(), source: z.string(), text: z.string(),
	archived: z.string(), reason: z.string(), replacements: z.array(reference).min(1)
}).strict();
type ArchivedRecord = z.infer<typeof archivedRecord>;

export const inventoryOptions = z.object({
	scope: scopeSchema.optional(), types: z.array(typeSchema).optional(), includeDeprecated: z.boolean().optional(),
	offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50)
}).strict();

export function listKnowledge(store: BrainStore, input: z.input<typeof inventoryOptions> = {}) {
	const options = inventoryOptions.parse(input);
	if (options.scope) store.scopeDirectory(options.scope);
	const items = store.allKnowledge().filter((item) => (!options.scope || item.scope === options.scope)
		&& (!options.types || options.types.includes(item.type)) && (options.includeDeprecated || item.status === 'active'))
		.sort((a, b) => a.source.localeCompare(b.source));
	return { total: items.length, contextBudget: store.budget, items: items.slice(options.offset, options.offset + options.limit).map(({ content, ...item }) => ({ ...item, characters: content.length })) };
}

function historyFile(store: BrainStore, scope: z.infer<typeof scopeSchema>): string {
	return store.safePath(store.scopeDirectory(scope), 'knowledge-history.jsonl');
}

function readHistory(store: BrainStore, scope: z.infer<typeof scopeSchema>): ArchivedRecord[] {
	const file = historyFile(store, scope);
	if (!fs.existsSync(file)) return [];
	const records = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => archivedRecord.parse(JSON.parse(line)));
	const ids = new Set<string>();
	for (const record of records) {
		if (record.scope !== scope || ids.has(record.id) || createHash('sha256').update(record.text).digest('hex') !== record.revision) {
			throw new Error(`Invalid or duplicate knowledge history record: ${file}`);
		}
		ids.add(record.id);
	}
	return records;
}

export const historyOptions = z.object({
	scope: scopeSchema.optional(), id: reference.shape.id.optional(), query: z.string().max(1000).optional(),
	offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50)
}).strict();

export function knowledgeHistory(store: BrainStore, input: z.input<typeof historyOptions> = {}) {
	const options = historyOptions.parse(input);
	if (options.scope) store.scopeDirectory(options.scope);
	const query = options.query?.toLowerCase();
	const records = store.scopes.filter((entry) => !options.scope || entry.scope === options.scope).flatMap((entry) => readHistory(store, entry.scope))
		.filter((record) => (!options.id || record.id === options.id) && (!query || [record.id, record.title, record.reason].some((value) => value.toLowerCase().includes(query))))
		.sort((a, b) => b.archived.localeCompare(a.archived) || a.id.localeCompare(b.id));
	return { total: records.length, items: records.slice(options.offset, options.offset + options.limit).map(({ text, ...record }) => ({ ...record, ...(options.id ? { text } : {}) })) };
}

/** Replacements are written and checked first. Preserve exact originals before any deletion. */
export function archiveKnowledge(store: BrainStore, input: z.input<typeof archiveInput>) {
	const options = archiveInput.parse(input);
	return store.writeLocked(() => {
		const sourceIds = new Set(options.sources.map((item) => item.id));
		if (sourceIds.size !== options.sources.length) throw new Error('Duplicate archive source IDs.');
		const all = store.allKnowledge();
		const byId = new Map(all.map((item) => [item.id, item]));
		const firstReplacement = options.sources[0]!.replacements[0]!;
		store.assertReadable(firstReplacement.id, store.knowledgeErrors);
		const scope = byId.get(firstReplacement.id)?.scope;
		if (!scope) throw new Error('Replacement not found in the active scopes.');
		const history = readHistory(store, scope);
		const pending = options.sources.map((source) => {
			store.assertReadable(source.id, store.knowledgeErrors);
			const item = byId.get(source.id);
			const prior = history.find((record) => record.id === source.id);
			const replacements = source.replacements.map((ref) => {
				store.assertReadable(ref.id, store.knowledgeErrors);
				const replacement = byId.get(ref.id);
				if (sourceIds.has(ref.id)) throw new Error('An archive source cannot also be a replacement.');
				if (!replacement || replacement.status !== 'active' || replacement.type === 'review') throw new Error('Replacements must be active non-review knowledge.');
				if (replacement.revision !== ref.revision) throw new Error('Replacement changed; read the current revision.');
				if (replacement.scope !== scope) throw new Error('Archive sources and replacements must share one scope.');
				return replacement;
			});
			if (prior && (prior.revision !== source.revision || JSON.stringify(prior.replacements) !== JSON.stringify(source.replacements))) throw new Error('Archived knowledge conflicts with this request; inspect knowledge_history.');
			if (!item) {
				if (!prior) throw new Error(`Knowledge not found: ${source.id}`);
				return { record: prior, remove: false };
			}
			if (item.revision !== source.revision) throw new Error('Knowledge changed; read the current revision before archiving.');
			if (item.scope !== scope) throw new Error('Archive sources and replacements must share one scope.');
			if (item.type === 'review') throw new Error('Use the review tools for review findings.');
			if (replacements.some((replacement) => replacement.authority !== item.authority)) throw new Error('Consolidation must preserve authority; keep uncertain knowledge separate.');
			if (item.recall === 'always' && !replacements.some((replacement) => replacement.recall === 'always')) throw new Error('Preserve always recall in a replacement.');
			if (item.applies_to.some((pattern) => !replacements.some((replacement) => replacement.applies_to.includes(pattern)))) throw new Error('Preserve applies_to patterns in the replacements.');
			const text = store.read(item.source);
			if (createHash('sha256').update(text).digest('hex') !== item.revision) throw new Error('Knowledge changed while preparing the archive.');
			const record = prior ?? { id: item.id, revision: item.revision, scope, title: item.title, source: item.source, text,
				archived: new Date().toISOString(), reason: options.reason, replacements: source.replacements };
			if (prior && prior.source !== item.source) throw new Error('Archived source path changed; inspect knowledge_history.');
			return { record, remove: true };
		});
		const added = pending.filter(({ record }) => !history.some((old) => old.id === record.id)).map(({ record }) => record);
		if (added.length) store.atomicWrite(historyFile(store, scope), [...history, ...added].map((record) => JSON.stringify(record)).join('\n') + '\n');
		// If deletion fails, the archive and replacements survive. An identical retry finishes it.
		for (const { record, remove } of pending) if (remove) fs.unlinkSync(store.safePath(record.source));
		return { archived: pending.map(({ record }) => record.id), history: path.relative(store.configRoot, historyFile(store, scope)) };
	});
}
