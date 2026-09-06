import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_ROOT_OVERRIDE_ENV } from '../constants';
import { defaultConfigRoot } from '../project';
import { readBrainConfig, listBrainProjects } from './config';
import { createBrainProject, initializeBrain, inspectProject } from './projects';
import { z } from 'zod';
import { BrainStore, knowledgeChanges, knowledgeInput, reviewStateSchema, scopeSchema, severitySchema } from './store';
import { getSkill, listSkills } from './skills';
import { addTodo, getTodo, listTodos, todoChanges, todoInput, updateTodo } from './todos';
import { syncConnector } from './connectors';
import { gitPreview, pullOnStart, syncGit } from './git';

export async function brainMain(argv: string[], wrapperCommand?: 'mcp' | 'create' | 'project'): Promise<void> {
	const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
		configdir: { type: 'string' }, cwd: { type: 'string' }, socket: { type: 'string' },
		quick: { type: 'boolean' }, guided: { type: 'boolean' },
		pull: { type: 'boolean' },
		json: { type: 'string' }, scope: { type: 'string' }, revision: { type: 'string' }, state: { type: 'string' }, severity: { type: 'string' },
		confirmed: { type: 'boolean' }, message: { type: 'string' }, help: { type: 'boolean', short: 'h' }
	} });
	if (values.configdir) process.env[CONFIG_ROOT_OVERRIDE_ENV] = path.resolve(values.configdir);
	const cwd = path.resolve(values.cwd ?? process.cwd());
	const root = defaultConfigRoot(cwd);
	const command = wrapperCommand ?? positionals.shift() ?? 'help';
	if (values.pull && command !== 'serve') throw new Error('--pull is only supported by serve');
	const print = (value: unknown): void => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); };
	if (values.help || command === 'help') {
		process.stdout.write([
			'agent-brain init | status | search <query> | context <task> | get <id>',
			'agent-brain remember --json <knowledge-object>',
			'agent-brain amend <id> --revision <hash> --json <changes>',
			'agent-brain promote <id> --scope <scope> --revision <hash> --confirmed',
			'agent-brain deprecate <id> --revision <hash> [reason]',
			'agent-brain skills [name]',
			'agent-brain review list [--severity <level>] [--state <state>]',
			'agent-brain review resolve <id> --revision <hash> --state fixed|wontfix [reason]',
			'agent-brain todo list | get <id> | add --json <task-object>',
			'agent-brain todo update <id> --revision <hash> --json <changes>',
			'agent-brain todo complete <id> --revision <hash>',
			'agent-brain todo import|sync <connector> --scope <scope>',
			'agent-brain sync [init|save|pull|push --confirmed] [--message <commit-message>]',
			'agent-brain serve [--pull] [--socket <path>] | mcp [--socket <path>]',
			'agent-run create <name> [--quick | --guided]',
			'agent-run project list | info | bootstrap',
			'Common options: --configdir <path>, --cwd <path>', ''
		].join('\n'));
		return;
	}
	if (command === 'init') { initializeBrain(root, cwd); print({ enabled: readBrainConfig(root)?.enabled, configRoot: root }); return; }
	if (command === 'create') {
		if (positionals.length !== 1 || !positionals[0]) throw new Error('Usage: agent-run create <name> [--quick | --guided]');
		if (values.quick && values.guided) throw new Error('--quick and --guided cannot be combined');
		await createBrainProject(root, cwd, positionals[0], values.quick ? 'quick' : values.guided ? 'guided' : 'normal');
		return;
	}
	if (command === 'serve' || command === 'mcp') {
		const { defaultSocketPath, proxyStdio, serveApiCore } = await import('./server');
		const socket = path.resolve(values.socket ?? defaultSocketPath(root));
		if (command === 'serve') {
			if (values.pull) {
				const startupStore = new BrainStore(root, cwd);
				try { process.stderr.write(`${pullOnStart(startupStore)}\n`); }
				finally { startupStore.close(); }
			}
			const service = await serveApiCore(root, socket);
			process.stderr.write(`agent-brain listening on ${socket}\n`);
			let closing = false;
			const close = (): void => { if (!closing) { closing = true; void service.close().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; }); } };
			process.once('SIGTERM', close);
			process.once('SIGINT', close);
		} else {
			await proxyStdio(socket, cwd, root);
		}
		return;
	}
	const store = new BrainStore(root, cwd);
	const requireId = (index = 0): string => { const id = positionals[index]; if (!id) throw new Error('An item id is required'); return id; };
	const requireRevision = (): string => { if (!values.revision) throw new Error('--revision is required; read the item first'); return values.revision; };
	const json = (): unknown => { if (!values.json) throw new Error('--json is required'); return JSON.parse(values.json); };
	try {
		switch (command) {
			case 'status': print({ configRoot: root, enabled: readBrainConfig(root)?.enabled ?? false, profile: store.profile, scopes: store.scopes, knowledge: store.allKnowledge().length, todos: listTodos(store).length }); break;
			case 'search': print(store.search(positionals.join(' '))); break;
			case 'context': print(store.context(positionals.join(' '))); break;
			case 'get': print(store.get(requireId())); break;
			case 'remember': print(store.remember(knowledgeInput.parse(json()))); break;
			case 'promote':
				if (!values.confirmed) throw new Error('Promotion requires --confirmed after explicit user approval');
				print(store.promote(requireId(), scopeSchema.parse(values.scope), requireRevision())); break;
			case 'amend': print(store.amend(requireId(), requireRevision(), knowledgeChanges.parse(json()))); break;
			case 'deprecate': print(store.deprecate(requireId(), requireRevision(), positionals.slice(1).join(' '))); break;
			case 'skills': print(positionals[0] ? getSkill(store, positionals[0]) : listSkills(store)); break;
			case 'review': {
				const operation = positionals.shift() ?? 'list';
				if (operation === 'list') {
					print(store.reviews({
						...(values.severity ? { severity: [severitySchema.parse(values.severity)] } : {}),
						...(values.state ? { state: [reviewStateSchema.parse(values.state)] } : {})
					}).map((item) => ({ finding: item.finding, severity: item.severity, state: item.state ?? 'open', title: item.title, id: item.id, revision: item.revision })));
				} else if (operation === 'resolve') {
					const state = z.enum(['fixed', 'wontfix']).parse(values.state);
					print(store.resolveReview(requireId(), requireRevision(), state, positionals.slice(1).join(' ') || undefined));
				} else throw new Error('Usage: agent-brain review list | resolve <id> --revision <hash> --state fixed|wontfix');
				break;
			}
			case 'sync': {
				const action = positionals[0];
				if (!action) { print(gitPreview(store)); break; }
				if (!['init', 'save', 'pull', 'push'].includes(action)) throw new Error('Unknown sync action');
				if (!values.confirmed) throw new Error('Review agent-brain sync output and obtain authorization before using --confirmed');
				print(syncGit(store, action as 'init' | 'save' | 'pull' | 'push', values.message));
				break;
			}
			case 'todo': {
				const operation = positionals.shift();
				if (operation === 'list') print(listTodos(store));
				else if (operation === 'get') print(getTodo(store, requireId()));
				else if (operation === 'add') print(addTodo(store, todoInput.parse(json())));
				else if (operation === 'update') print(updateTodo(store, requireId(), requireRevision(), todoChanges.parse(json())));
				else if (operation === 'complete') print(updateTodo(store, requireId(), requireRevision(), { status: 'done' }));
				else if (operation === 'import' || operation === 'sync') print(await syncConnector(store, requireId(), scopeSchema.parse(values.scope)));
				else throw new Error('Unknown todo command; use agent-brain --help');
				break;
			}
			case 'project': {
				const operation = positionals[0];
				if (operation === 'list') print(listBrainProjects(root));
				else if (operation === 'info') print({ profile: store.profile, ...inspectProject(cwd) });
				else if (operation === 'bootstrap') print({ status: 'proposal', message: 'Inspect the listed documents to propose architecture, constraints, conventions, and specs. Confirm proposals before saving authoritative knowledge.', ...inspectProject(cwd) });
				else throw new Error('Usage: agent-run project list | info | bootstrap');
				break;
			}
			default: throw new Error(`Unknown brain command: ${command}`);
		}
	} finally { store.close(); }
}

export function reportBrainError(error: unknown): void {
	process.stderr.write(`agent-brain: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
}
