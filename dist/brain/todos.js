"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todoChanges = exports.todoInput = void 0;
exports.listTodos = listTodos;
exports.getTodo = getTodo;
exports.addTodo = addTodo;
exports.updateTodo = updateTodo;
exports.importTodos = importTodos;
const path = require("node:path");
const node_crypto_1 = require("node:crypto");
const yaml_1 = require("yaml");
const zod_1 = require("zod");
const store_1 = require("./store");
exports.todoInput = zod_1.z.object({
    scope: store_1.scopeSchema,
    title: zod_1.z.string().trim().min(1).max(300),
    description: zod_1.z.string().trim().max(200000).default(''),
    status: zod_1.z.enum(['todo', 'doing', 'blocked', 'done', 'cancelled']).default('todo'),
    priority: zod_1.z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    owner: zod_1.z.string().optional(),
    due: zod_1.z.iso.date().optional(),
    labels: zod_1.z.array(zod_1.z.string()).default([]),
    notes: zod_1.z.string().default(''),
    source: zod_1.z.object({ type: zod_1.z.enum(['local', 'github', 'trello']), external_id: zod_1.z.string(), url: zod_1.z.url().optional() }).optional()
}).strict();
const remoteTask = exports.todoInput.pick({ title: true, description: true, status: true, labels: true, due: true }).strip();
const todoMetadata = exports.todoInput.omit({ description: true }).extend({ id: zod_1.z.uuid(), created: zod_1.z.string(), updated: zod_1.z.string(), remote: remoteTask.optional() });
function listTodos(store) {
    return store.scopes.flatMap(({ scope, directory }) => store.files(path.join(directory, 'todo')).map((file) => {
        const text = store.read(file);
        const document = (0, store_1.readMarkdown)(text);
        const metadata = todoMetadata.parse(document.metadata);
        if (metadata.scope !== scope || path.basename(file) !== `${metadata.id}.md`)
            throw new Error(`Todo metadata does not match its location: ${file}`);
        return { ...metadata, description: document.content, revision: (0, node_crypto_1.createHash)('sha256').update(text).digest('hex') };
    }));
}
function getTodo(store, id) {
    const todo = listTodos(store).find((item) => item.id === id);
    if (!todo)
        throw new Error(`Todo not found: ${id}`);
    return todo;
}
function writeTodo(store, todo) {
    const { description, ...metadata } = todo;
    const text = `---\n${(0, yaml_1.stringify)(metadata)}---\n\n${description}\n`;
    store.atomicWrite(path.join(store.scopeDirectory(todo.scope), 'todo', `${todo.id}.md`), text);
    return { ...todo, revision: (0, node_crypto_1.createHash)('sha256').update(text).digest('hex') };
}
function addTodo(store, input) {
    const value = exports.todoInput.parse(input);
    return store.writeLocked(() => {
        if (value.source) {
            const existing = listTodos(store).find((item) => item.scope === value.scope && item.source?.type === value.source?.type && item.source?.external_id === value.source?.external_id);
            if (existing)
                return existing;
        }
        const now = new Date().toISOString();
        return writeTodo(store, { ...value, id: (0, node_crypto_1.randomUUID)(), created: now, updated: now });
    });
}
exports.todoChanges = exports.todoInput.omit({ scope: true, source: true }).partial();
function updateTodo(store, id, revision, changes) {
    const parsed = exports.todoChanges.parse(changes);
    return store.writeLocked(() => {
        const todo = getTodo(store, id);
        if (todo.revision !== revision)
            throw new Error('Todo changed; read the current revision before updating.');
        const { revision: _revision, ...value } = todo;
        return writeTodo(store, { ...value, ...parsed, updated: new Date().toISOString() });
    });
}
function importTodos(store, input) {
    const incoming = input.map((item) => exports.todoInput.parse(item));
    return store.writeLocked(() => {
        const result = { imported: [], updated: [], conflicts: [] };
        const existing = listTodos(store);
        for (const item of incoming) {
            if (!item.source)
                throw new Error('Imported tasks require an external source');
            const prior = existing.find((todo) => todo.scope === item.scope && todo.source?.type === item.source.type && todo.source?.external_id === item.source.external_id);
            const remote = remoteTask.parse(item);
            const now = new Date().toISOString();
            if (!prior) {
                const task = writeTodo(store, { ...item, remote, id: (0, node_crypto_1.randomUUID)(), created: now, updated: now });
                existing.push(task);
                result.imported.push(task.id);
                continue;
            }
            if (JSON.stringify(prior.remote) === JSON.stringify(remote))
                continue;
            const changes = {};
            let conflicted = !prior.remote;
            for (const key of ['title', 'description', 'status', 'labels', 'due']) {
                const current = JSON.stringify(prior[key]);
                const base = JSON.stringify(prior.remote?.[key]);
                const next = JSON.stringify(remote[key]);
                if (current !== base && next !== base && current !== next)
                    conflicted = true;
                if (current === base)
                    changes[key] = remote[key];
            }
            if (conflicted) {
                result.conflicts.push(prior.id);
                continue;
            }
            const { revision: _revision, ...metadata } = prior;
            writeTodo(store, { ...metadata, ...changes, remote, updated: now });
            result.updated.push(prior.id);
        }
        return result;
    });
}
