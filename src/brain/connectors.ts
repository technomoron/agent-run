import { z } from 'zod';
import { readBrainConfig } from './config';
import { BrainStore, type Scope } from './store';
import { importTodos, todoInput } from './todos';

const githubIssue = z.object({ number: z.number().int(), title: z.string(), body: z.string().nullable(), state: z.enum(['open', 'closed']),
	html_url: z.url(), pull_request: z.unknown().optional(), labels: z.array(z.union([z.string(), z.object({ name: z.string() })])) });
const trelloCard = z.object({ id: z.string(), name: z.string(), desc: z.string(), closed: z.boolean(), dueComplete: z.boolean(), due: z.string().nullable(),
	url: z.url(), labels: z.array(z.object({ name: z.string() })) });

async function readRemote(url: URL, headers: Record<string, string>): Promise<unknown> {
	let response: Response;
	try { response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
	catch { throw new Error(`Could not reach ${url.hostname}; check connector credentials and network access.`); }
	if (!response.ok) throw new Error(`Connector ${url.hostname} returned HTTP ${response.status}`);
	return response.json();
}

export async function syncConnector(store: BrainStore, name: string, scope: Scope): Promise<ReturnType<typeof importTodos>> {
	store.scopeDirectory(scope);
	const connector = readBrainConfig(store.configRoot)?.connectors[name];
	if (!connector) throw new Error(`Connector not configured: ${name}`);
	const tasks: z.input<typeof todoInput>[] = [];
	if (connector.type === 'github') {
		const token = process.env[connector.tokenEnv];
		for (let page = 1; ; page += 1) {
			if (page > 100) throw new Error('GitHub import exceeds 10000 issues; split the task source before importing.');
			const url = new URL(`https://api.github.com/repos/${connector.repository}/issues`);
			url.search = new URLSearchParams({ state: 'all', per_page: '100', page: String(page) }).toString();
			const issues = z.array(githubIssue).parse(await readRemote(url, { accept: 'application/vnd.github+json', 'user-agent': 'agent-brain', ...(token ? { authorization: `Bearer ${token}` } : {}) }));
			for (const issue of issues.filter((issue) => !issue.pull_request)) tasks.push({
				scope, title: issue.title, description: issue.body ?? '', status: issue.state === 'closed' ? 'done' : 'todo',
				labels: issue.labels.map((label) => typeof label === 'string' ? label : label.name),
				source: { type: 'github', external_id: `${connector.repository}#${issue.number}`, url: issue.html_url }
			});
			if (issues.length < 100) break;
		}
	} else {
		const key = process.env[connector.keyEnv];
		const token = process.env[connector.tokenEnv];
		if (!key || !token) throw new Error(`Set ${connector.keyEnv} and ${connector.tokenEnv} before importing Trello tasks.`);
		const url = new URL(`https://api.trello.com/1/boards/${connector.board}/cards/all`);
		url.search = new URLSearchParams({ key, token, fields: 'id,name,desc,closed,dueComplete,due,url,labels' }).toString();
		const cards = z.array(trelloCard).parse(await readRemote(url, {}));
		for (const card of cards) tasks.push({ scope, title: card.name, description: card.desc,
			status: card.dueComplete ? 'done' : card.closed ? 'cancelled' : 'todo',
			...(card.due ? { due: card.due.slice(0, 10) } : {}), labels: card.labels.map((label) => label.name),
			source: { type: 'trello', external_id: card.id, url: card.url }
		});
	}
	return importTodos(store, tasks);
}
