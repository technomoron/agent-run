import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { BrainStore, readMarkdown, scopeSchema } from './store';

export const todoInput = z.object({
	scope: scopeSchema,
	title: z.string().trim().min(1).max(300),
	description: z.string().trim().max(200000).default(''),
	status: z.enum(['todo', 'doing', 'blocked', 'done', 'cancelled']).default('todo'),
	priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
	owner: z.string().optional(),
	due: z.iso.date().optional(),
	labels: z.array(z.string()).default([]),
	notes: z.string().default(''),
	source: z.object({ type: z.enum(['local', 'github', 'trello']), external_id: z.string(), url: z.url().optional() }).optional()
}).strict();
const remoteTask = todoInput.pick({ title: true, description: true, status: true, labels: true, due: true }).strip();
const todoMetadata = todoInput.omit({ description: true }).extend({ id: z.uuid(), created: z.string(), updated: z.string(), remote: remoteTask.optional() });
export type Todo = z.infer<typeof todoMetadata> & { description: string; revision: string };

export function listTodos(store: BrainStore): Todo[] {
	return store.scopes.flatMap(({ scope, directory }) => store.files(path.join(directory, 'todo')).map((file) => {
		const text = store.read(file);
		const document = readMarkdown(text);
		const metadata = todoMetadata.parse(document.metadata);
		if (metadata.scope !== scope || path.basename(file) !== `${metadata.id}.md`) throw new Error(`Todo metadata does not match its location: ${file}`);
		return { ...metadata, description: document.content, revision: createHash('sha256').update(text).digest('hex') };
	}));
}

export function getTodo(store: BrainStore, id: string): Todo {
	const todo = listTodos(store).find((item) => item.id === id);
	if (!todo) throw new Error(`Todo not found: ${id}`);
	return todo;
}

function writeTodo(store: BrainStore, todo: Omit<Todo, 'revision'>): Todo {
	const { description, ...metadata } = todo;
	const text = `---\n${stringifyYaml(metadata)}---\n\n${description}\n`;
	store.atomicWrite(path.join(store.scopeDirectory(todo.scope), 'todo', `${todo.id}.md`), text);
	return { ...todo, revision: createHash('sha256').update(text).digest('hex') };
}

export function addTodo(store: BrainStore, input: z.input<typeof todoInput>): Todo {
	const value = todoInput.parse(input);
	return store.writeLocked(() => {
		if (value.source) {
			const existing = listTodos(store).find((item) => item.scope === value.scope && item.source?.type === value.source?.type && item.source?.external_id === value.source?.external_id);
			if (existing) return existing;
		}
		const now = new Date().toISOString();
		return writeTodo(store, { ...value, id: randomUUID(), created: now, updated: now });
	});
}

// Spelled out rather than todoInput.omit(...).partial(): .partial() keeps .default(), so
// updating one field would reset description, priority, labels, and notes to their defaults.
export const todoChanges = z.object({
	title: z.string().trim().min(1).max(300).optional(),
	description: z.string().trim().max(200000).optional(),
	status: z.enum(['todo', 'doing', 'blocked', 'done', 'cancelled']).optional(),
	priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
	owner: z.string().optional(),
	due: z.iso.date().optional(),
	labels: z.array(z.string()).optional(),
	notes: z.string().optional()
}).strict();
export function updateTodo(store: BrainStore, id: string, revision: string, changes: z.input<typeof todoChanges>): Todo {
	const parsed = todoChanges.parse(changes);
	return store.writeLocked(() => {
		const todo = getTodo(store, id);
		if (todo.revision !== revision) throw new Error('Todo changed; read the current revision before updating.');
		const { revision: _revision, ...value } = todo;
		return writeTodo(store, { ...value, ...parsed, updated: new Date().toISOString() });
	});
}

export function importTodos(store: BrainStore, input: z.input<typeof todoInput>[]): { imported: string[]; updated: string[]; conflicts: string[] } {
	const incoming = input.map((item) => todoInput.parse(item));
	return store.writeLocked(() => {
		const result = { imported: [] as string[], updated: [] as string[], conflicts: [] as string[] };
		const existing = listTodos(store);
		for (const item of incoming) {
			if (!item.source) throw new Error('Imported tasks require an external source');
			const prior = existing.find((todo) => todo.scope === item.scope && todo.source?.type === item.source!.type && todo.source?.external_id === item.source!.external_id);
			const remote = remoteTask.parse(item);
			const now = new Date().toISOString();
			if (!prior) {
				const task = writeTodo(store, { ...item, remote, id: randomUUID(), created: now, updated: now });
				existing.push(task);
				result.imported.push(task.id);
				continue;
			}
			if (JSON.stringify(prior.remote) === JSON.stringify(remote)) continue;
			const changes: Record<string, unknown> = {};
			let conflicted = !prior.remote;
			for (const key of ['title', 'description', 'status', 'labels', 'due'] as const) {
				const current = JSON.stringify(prior[key]);
				const base = JSON.stringify(prior.remote?.[key]);
				const next = JSON.stringify(remote[key]);
				if (current !== base && next !== base && current !== next) conflicted = true;
				if (current === base) changes[key] = remote[key];
			}
			if (conflicted) { result.conflicts.push(prior.id); continue; }
			const { revision: _revision, ...metadata } = prior;
			writeTodo(store, { ...metadata, ...changes, remote, updated: now });
			result.updated.push(prior.id);
		}
		return result;
	});
}
