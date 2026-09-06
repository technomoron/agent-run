"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brainMain = brainMain;
exports.reportBrainError = reportBrainError;
const path = require("node:path");
const node_util_1 = require("node:util");
const constants_1 = require("../constants");
const project_1 = require("../project");
const config_1 = require("./config");
const projects_1 = require("./projects");
const zod_1 = require("zod");
const store_1 = require("./store");
const skills_1 = require("./skills");
const todos_1 = require("./todos");
const connectors_1 = require("./connectors");
const git_1 = require("./git");
async function brainMain(argv, wrapperCommand) {
    const { values, positionals } = (0, node_util_1.parseArgs)({ args: argv, allowPositionals: true, strict: true, options: {
            configdir: { type: 'string' }, cwd: { type: 'string' }, socket: { type: 'string' },
            quick: { type: 'boolean' }, guided: { type: 'boolean' },
            pull: { type: 'boolean' },
            json: { type: 'string' }, scope: { type: 'string' }, revision: { type: 'string' }, state: { type: 'string' }, severity: { type: 'string' },
            confirmed: { type: 'boolean' }, message: { type: 'string' }, help: { type: 'boolean', short: 'h' }
        } });
    if (values.configdir)
        process.env[constants_1.CONFIG_ROOT_OVERRIDE_ENV] = path.resolve(values.configdir);
    const cwd = path.resolve(values.cwd ?? process.cwd());
    const root = (0, project_1.defaultConfigRoot)(cwd);
    const command = wrapperCommand ?? positionals.shift() ?? 'help';
    if (values.pull && command !== 'serve')
        throw new Error('--pull is only supported by serve');
    const print = (value) => { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); };
    if (values.help || command === 'help') {
        process.stdout.write([
            'agent-brain init | status | search <query> | context <task> | get <id>',
            'agent-brain remember --json <knowledge-object>',
            'agent-brain amend <id> --revision <hash> --json <changes>',
            'agent-brain promote <id> --scope <scope> --revision <hash> --confirmed',
            'agent-brain deprecate <id> --revision <hash> [reason]',
            'agent-brain skills [name]',
            'agent-brain review list [--severity <level>] [--state <state>]',
            'agent-brain review history [query] [--scope <scope>] [--state fixed|wontfix]',
            'agent-brain review archive --scope <scope>',
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
    if (command === 'init') {
        (0, projects_1.initializeBrain)(root, cwd);
        print({ enabled: (0, config_1.readBrainConfig)(root)?.enabled, configRoot: root });
        return;
    }
    if (command === 'create') {
        if (positionals.length !== 1 || !positionals[0])
            throw new Error('Usage: agent-run create <name> [--quick | --guided]');
        if (values.quick && values.guided)
            throw new Error('--quick and --guided cannot be combined');
        await (0, projects_1.createBrainProject)(root, cwd, positionals[0], values.quick ? 'quick' : values.guided ? 'guided' : 'normal');
        return;
    }
    if (command === 'serve' || command === 'mcp') {
        const { defaultSocketPath, proxyStdio, serveApiCore } = await Promise.resolve().then(() => require('./server'));
        const socket = path.resolve(values.socket ?? defaultSocketPath(root));
        if (command === 'serve') {
            if (values.pull) {
                const startupStore = new store_1.BrainStore(root, cwd);
                try {
                    process.stderr.write(`${(0, git_1.pullOnStart)(startupStore)}\n`);
                }
                finally {
                    startupStore.close();
                }
            }
            const service = await serveApiCore(root, socket);
            process.stderr.write(`agent-brain listening on ${socket}\n`);
            let closing = false;
            const close = () => { if (!closing) {
                closing = true;
                void service.close().catch((error) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
            } };
            process.once('SIGTERM', close);
            process.once('SIGINT', close);
        }
        else {
            await proxyStdio(socket, cwd, root);
        }
        return;
    }
    const store = new store_1.BrainStore(root, cwd);
    const requireId = (index = 0) => { const id = positionals[index]; if (!id)
        throw new Error('An item id is required'); return id; };
    const requireRevision = () => { if (!values.revision)
        throw new Error('--revision is required; read the item first'); return values.revision; };
    const json = () => { if (!values.json)
        throw new Error('--json is required'); return JSON.parse(values.json); };
    const report = (value) => print(store.withDiagnostics(value));
    try {
        switch (command) {
            case 'status':
                report({ configRoot: root, enabled: (0, config_1.readBrainConfig)(root)?.enabled ?? false, profile: store.profile, scopes: store.scopes, knowledge: store.allKnowledge().length, todos: (0, todos_1.listTodos)(store).length });
                break;
            case 'search':
                report(store.search(positionals.join(' ')));
                break;
            case 'context':
                report(store.context(positionals.join(' ')));
                break;
            case 'get':
                report(store.get(requireId()));
                break;
            case 'remember':
                report(store.remember(store_1.knowledgeInput.parse(json())));
                break;
            case 'promote':
                if (!values.confirmed)
                    throw new Error('Promotion requires --confirmed after explicit user approval');
                report(store.promote(requireId(), store_1.scopeSchema.parse(values.scope), requireRevision()));
                break;
            case 'amend':
                report(store.amend(requireId(), requireRevision(), store_1.knowledgeChanges.parse(json())));
                break;
            case 'deprecate':
                report(store.deprecate(requireId(), requireRevision(), positionals.slice(1).join(' ')));
                break;
            case 'skills':
                report(positionals[0] ? (0, skills_1.getSkill)(store, positionals[0]) : (0, skills_1.listSkills)(store));
                break;
            case 'review': {
                const operation = positionals.shift() ?? 'list';
                if (operation === 'list') {
                    report(store.reviews({
                        ...(values.severity ? { severity: [store_1.severitySchema.parse(values.severity)] } : {}),
                        ...(values.state ? { state: [store_1.reviewStateSchema.parse(values.state)] } : {})
                    }).map((item) => ({ finding: item.finding, severity: item.severity, state: item.state ?? 'open', title: item.title, id: item.id, revision: item.revision })));
                }
                else if (operation === 'history') {
                    report(store.reviewHistory({ query: positionals.join(' '), ...(values.scope ? { scope: store_1.scopeSchema.parse(values.scope) } : {}), ...(values.state ? { state: zod_1.z.enum(['fixed', 'wontfix']).parse(values.state) } : {}), limit: Number.MAX_SAFE_INTEGER }));
                }
                else if (operation === 'archive') {
                    report(store.archiveReviews(store_1.scopeSchema.parse(values.scope)));
                }
                else if (operation === 'resolve') {
                    const state = zod_1.z.enum(['fixed', 'wontfix']).parse(values.state);
                    report(store.resolveReview(requireId(), requireRevision(), state, positionals.slice(1).join(' ') || undefined));
                }
                else
                    throw new Error('Usage: agent-brain review list | resolve <id> --revision <hash> --state fixed|wontfix');
                break;
            }
            case 'sync': {
                const action = positionals[0];
                if (!action) {
                    report((0, git_1.gitPreview)(store));
                    break;
                }
                if (!['init', 'save', 'pull', 'push'].includes(action))
                    throw new Error('Unknown sync action');
                if (!values.confirmed)
                    throw new Error('Review agent-brain sync output and obtain authorization before using --confirmed');
                report((0, git_1.syncGit)(store, action, values.message));
                break;
            }
            case 'todo': {
                const operation = positionals.shift();
                if (operation === 'list')
                    report((0, todos_1.listTodos)(store));
                else if (operation === 'get')
                    report((0, todos_1.getTodo)(store, requireId()));
                else if (operation === 'add')
                    report((0, todos_1.addTodo)(store, todos_1.todoInput.parse(json())));
                else if (operation === 'update')
                    report((0, todos_1.updateTodo)(store, requireId(), requireRevision(), todos_1.todoChanges.parse(json())));
                else if (operation === 'complete')
                    report((0, todos_1.updateTodo)(store, requireId(), requireRevision(), { status: 'done' }));
                else if (operation === 'import' || operation === 'sync')
                    report(await (0, connectors_1.syncConnector)(store, requireId(), store_1.scopeSchema.parse(values.scope)));
                else
                    throw new Error('Unknown todo command; use agent-brain --help');
                break;
            }
            case 'project': {
                const operation = positionals[0];
                if (operation === 'list')
                    report((0, config_1.listBrainProjects)(root));
                else if (operation === 'info')
                    report({ profile: store.profile, ...(0, projects_1.inspectProject)(cwd) });
                else if (operation === 'bootstrap')
                    report({ status: 'proposal', message: 'Inspect the listed documents to propose architecture, constraints, conventions, and specs. Confirm proposals before saving authoritative knowledge.', ...(0, projects_1.inspectProject)(cwd) });
                else
                    throw new Error('Usage: agent-run project list | info | bootstrap');
                break;
            }
            default: throw new Error(`Unknown brain command: ${command}`);
        }
    }
    finally {
        store.close();
    }
}
function reportBrainError(error) {
    process.stderr.write(`agent-brain: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
