import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { JSONRPCMessageSchema, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { ApiServer } from '@technomoron/apicore-server';
import { z } from 'zod';
import { packageVersion } from '../version';
import { BrainStore, knowledgeChanges, knowledgeInput, reviewStateSchema, scopeSchema, severitySchema, typeSchema } from './store';
import { getSkill, listSkills } from './skills';
import { addTodo, getTodo, listTodos, todoChanges, todoInput, updateTodo } from './todos';
import { syncConnector } from './connectors';
import { gitPreview, syncGit } from './git';
export { defaultSocketPath } from './config';

export function createBrainServer(store: BrainStore): McpServer {
	const server = new McpServer({ name: 'agent-brain', version: packageVersion() });
	function tool<T extends z.ZodRawShape>(name: string, description: string, shape: T, readOnly: boolean, handler: (input: z.output<z.ZodObject<T>>) => unknown): void {
		const schema: z.ZodType = z.object(shape).strict();
		server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } }, async (input: unknown) => {
			try {
				const result = await handler(z.object(shape).strict().parse(input));
				return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
			} catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
		});
	}
	const id = z.string().min(1).max(200);
	const revision = z.string().regex(/^[a-f0-9]{64}$/);
	tool('brain_status', 'Show the active project and available scopes.', {}, true, () => ({ profile: store.profile, scopes: store.scopes.map((entry) => entry.scope) }));
	tool('sync_status', 'Preview Git state and the canonical files eligible for saving. Runtime files, indexes, credentials, and native agent state are excluded.', {}, true, () => gitPreview(store));
	server.registerTool('sync', { description: 'Initialize, save, pull, or push the configuration Git repository. Review sync_status first. Requires explicit user authorization; saving also requires the approved commit message.',
		inputSchema: { action: z.enum(['init', 'save', 'pull', 'push']), confirmed: z.literal(true), message: z.string().min(1).max(1000).optional() },
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
	}, async ({ action, message }) => {
		try { return { content: [{ type: 'text' as const, text: JSON.stringify(syncGit(store, action, message)) }] }; }
		catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
	});
	tool('get_context', 'Retrieve relevant constraints and knowledge before substantial work. Check omitted; explicitly fetch required knowledge if the budget excluded it.', {
		task: z.string().max(10000), files: z.array(z.string()).max(100).optional(), symbols: z.array(z.string()).max(100).optional()
	}, true, ({ task, files, symbols }) => store.context(task, files, symbols));
	tool('search_knowledge', 'Search Markdown knowledge in the active scopes using SQLite FTS.', {
		query: z.string().max(10000), scopes: z.array(scopeSchema).optional(), types: z.array(typeSchema).optional(),
		includeDeprecated: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional()
	}, true, ({ query, ...options }) => store.search(query, options));
	tool('get_knowledge', 'Read a complete knowledge item and its current revision.', { id }, true, ({ id }) => store.get(id));
	tool('remember', 'Persist durable knowledge when authorized by the user. Choose scope and a singular type; the server stores it in the matching directory (for example constraint in constraints/, preference in preferences/). Explicit user instructions have authority=user; deductions remain inferred observations. Global writes require explicit global intent. Use todo tools for tasks; skills and templates are separate files.', knowledgeInput.shape, false, (input) => store.remember(input));
	tool('amend_knowledge', 'Revise an active item in place using its last-read revision, keeping its id, file name, scope, type, authority, and history. Use this to correct or extend existing knowledge instead of writing a near-duplicate. Scope, type, authority, and review severity cannot be changed this way.', {
		id, revision, changes: knowledgeChanges
	}, false, ({ id, revision, changes }) => store.amend(id, revision, changes));
	tool('promote', 'Copy active knowledge to another available scope with user authority. Requires explicit user approval; the original is preserved.', {
		id, scope: scopeSchema, revision, confirmed: z.literal(true)
	}, false, ({ id, scope, revision }) => store.promote(id, scope, revision));
	tool('deprecate_knowledge', 'Deprecate outdated knowledge without deleting its history.', { id, revision, reason: z.string().max(2000).optional() }, false,
		({ id, revision, reason }) => store.deprecate(id, revision, reason));
	tool('list_skills', 'List available skills and descriptions. Local skills override global skills with the same name.', {}, true, () => listSkills(store));
	tool('get_skill', 'Load a full skill only when it applies to the current task.', { name: z.string().max(100) }, true, ({ name }) => getSkill(store, name));
	tool('review_context', 'Retrieve constraints, decisions, prior review findings, and path-specific knowledge for a code review.', {
		task: z.string().max(10000), files: z.array(z.string()).max(100).optional()
	}, true, ({ task, files }) => store.context(`review constraint decision ${task}`, files));
	tool('review_list', 'List review findings in severity then number order. Open findings only unless states are given. Each finding carries its label, severity, state, and the revision needed to resolve it.', {
		severity: z.array(severitySchema).optional(), state: z.array(reviewStateSchema).optional()
	}, true, ({ severity, state }) => store.reviews({ severity, state }).map((item) => ({
		finding: item.finding, severity: item.severity, state: item.state ?? 'open', title: item.title,
		applies_to: item.applies_to, id: item.id, revision: item.revision
	})));
	tool('resolve_review', 'Close a review finding as fixed or wontfix, with a reason and the revision you last read. Use wontfix only when the user has said the finding is intentional.', {
		id, revision, state: z.enum(['fixed', 'wontfix']), reason: z.string().max(2000).optional()
	}, false, ({ id, revision, state, reason }) => store.resolveReview(id, revision, state, reason));
	tool('todo_list', 'List structured tasks in the active scopes.', { status: todoInput.shape.status.optional() }, true,
		({ status }) => listTodos(store).filter((item) => !status || item.status === status));
	tool('todo_get', 'Read a task and its revision.', { id }, true, ({ id }) => getTodo(store, id));
	tool('todo_add', 'Create a local task. Reimporting the same external task returns the existing task.', todoInput.shape, false, (input) => addTodo(store, input));
	tool('todo_update', 'Update a local task using its last-read revision. Does not change remote tasks.', { id, revision, changes: todoChanges }, false,
		({ id, revision, changes }) => updateTodo(store, id, revision, changes));
	tool('todo_complete', 'Mark a local task done. Does not change remote tasks.', { id, revision }, false,
		({ id, revision }) => updateTodo(store, id, revision, { status: 'done' }));
	for (const name of ['todo_import', 'todo_sync']) {
		server.registerTool(name, { description: 'Import tasks from a configured connector. Merge remote changes only when they do not conflict with local edits; report conflicting task IDs. Remote tasks are never modified.',
			inputSchema: { source: z.string().max(100), scope: scopeSchema }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
		}, async ({ source, scope }) => {
			try { return { content: [{ type: 'text' as const, text: JSON.stringify(await syncConnector(store, source, scope)) }] }; }
			catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }; }
		});
	}
	return server;
}

function requirePrivateSocketDirectory(socketPath: string): void {
	if (process.platform === 'win32') throw new Error('The agent-brain Unix-socket service requires Linux or macOS.');
	const stat = fs.lstatSync(path.dirname(socketPath));
	if (!stat.isDirectory() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0) throw new Error('The socket directory must be owned by the current user with mode 0700.');
}

export async function serveApiCore(configRoot: string, socketPath: string): Promise<{ close: () => Promise<void> }> {
	const directory = path.dirname(socketPath);
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	requirePrivateSocketDirectory(socketPath);
	if (fs.existsSync(socketPath)) throw new Error(`Socket already exists: ${socketPath}. Stop the running service, or remove the socket after confirming it is stale.`);
	const api = new ApiServer({ authApi: false, origins: [], devMode: false });
	api.fastify.post('/mcp', async (request, reply) => {
		if (request.headers.origin) return reply.code(403).send({ error: 'Browser requests are not supported' });
		if (request.headers['x-agent-brain-root'] !== encodeURIComponent(path.resolve(configRoot))) return reply.code(409).send({ error: 'This service uses a different configuration directory' });
		const cwdHeader = request.headers['x-agent-brain-cwd'];
		if (typeof cwdHeader !== 'string') return reply.code(400).send({ error: 'Missing project directory' });
		let cwd: string;
		try { cwd = decodeURIComponent(cwdHeader); } catch { return reply.code(400).send({ error: 'Invalid project directory' }); }
		if (!path.isAbsolute(cwd) || !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) return reply.code(400).send({ error: 'Invalid project directory' });
		const store = new BrainStore(configRoot, cwd);
		const server = createBrainServer(store);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
		reply.hijack();
		try {
			await server.connect(transport);
			await transport.handleRequest(request.raw, reply.raw, request.body);
		} finally { await server.close(); store.close(); }
	});
	api.fastify.route({ method: ['GET', 'DELETE'], url: '/mcp', handler: async (_request, reply) => reply.code(405).send() });
	await api.fastify.listen({ path: socketPath });
	fs.chmodSync(socketPath, 0o600);
	return { close: () => api.fastify.close() };
}

export async function proxyStdio(socketPath: string, cwd: string, configRoot: string): Promise<void> {
	const socket = fs.lstatSync(socketPath, { throwIfNoEntry: false });
	if (!socket) throw new Error(`Agent-brain service is not running at ${socketPath}. Start agent-brain serve with the same --configdir and --socket, or enable its systemd user service.`);
	requirePrivateSocketDirectory(socketPath);
	if (!socket.isSocket() || socket.uid !== process.getuid!() || (socket.mode & 0o077) !== 0) throw new Error('The brain socket must belong to the current user with mode 0600.');
	const stdio = new StdioServerTransport();
	let protocolVersion: string | undefined;
	async function send(message: JSONRPCMessage): Promise<void> {
		const response = await new Promise<string>((resolve, reject) => {
			const request = http.request({ socketPath, path: '/mcp', method: 'POST', headers: {
				'content-type': 'application/json', accept: 'application/json, text/event-stream',
				'x-agent-brain-cwd': encodeURIComponent(cwd), 'x-agent-brain-root': encodeURIComponent(path.resolve(configRoot)),
				...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {})
			} }, (response) => {
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) response.destroy(new Error('Brain response exceeds 4 MiB')); else chunks.push(chunk); });
				response.on('error', reject);
				response.on('end', () => response.statusCode && response.statusCode >= 200 && response.statusCode < 300
					? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`Brain service returned HTTP ${response.statusCode}`)));
			});
			request.setTimeout(30000, () => request.destroy(new Error('Brain service request timed out')));
			request.on('error', reject);
			request.end(JSON.stringify(message));
		});
		if (response) {
			const parsed = JSONRPCMessageSchema.parse(JSON.parse(response));
			if ('result' in parsed && typeof parsed.result.protocolVersion === 'string') protocolVersion = parsed.result.protocolVersion;
			await stdio.send(parsed);
		}
	}
	stdio.onmessage = (message) => { void send(message).catch(async (error: unknown) => {
		if ('id' in message && 'method' in message) await stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
		else process.stderr.write(`${String(error)}\n`);
	}); };
	await stdio.start();
}
