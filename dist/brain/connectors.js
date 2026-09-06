"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncConnector = syncConnector;
const zod_1 = require("zod");
const config_1 = require("./config");
const todos_1 = require("./todos");
const githubIssue = zod_1.z.object({ number: zod_1.z.number().int(), title: zod_1.z.string(), body: zod_1.z.string().nullable(), state: zod_1.z.enum(['open', 'closed']),
    html_url: zod_1.z.url(), pull_request: zod_1.z.unknown().optional(), labels: zod_1.z.array(zod_1.z.union([zod_1.z.string(), zod_1.z.object({ name: zod_1.z.string() })])) });
const trelloCard = zod_1.z.object({ id: zod_1.z.string(), name: zod_1.z.string(), desc: zod_1.z.string(), closed: zod_1.z.boolean(), dueComplete: zod_1.z.boolean(), due: zod_1.z.string().nullable(),
    url: zod_1.z.url(), labels: zod_1.z.array(zod_1.z.object({ name: zod_1.z.string() })) });
async function readRemote(url, headers) {
    let response;
    try {
        response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    }
    catch {
        throw new Error(`Could not reach ${url.hostname}; check connector credentials and network access.`);
    }
    if (!response.ok)
        throw new Error(`Connector ${url.hostname} returned HTTP ${response.status}`);
    return response.json();
}
async function syncConnector(store, name, scope) {
    store.scopeDirectory(scope);
    const connector = (0, config_1.readBrainConfig)(store.configRoot)?.connectors[name];
    if (!connector)
        throw new Error(`Connector not configured: ${name}`);
    const tasks = [];
    if (connector.type === 'github') {
        const token = process.env[connector.tokenEnv];
        for (let page = 1;; page += 1) {
            if (page > 100)
                throw new Error('GitHub import exceeds 10000 issues; split the task source before importing.');
            const url = new URL(`https://api.github.com/repos/${connector.repository}/issues`);
            url.search = new URLSearchParams({ state: 'all', per_page: '100', page: String(page) }).toString();
            const issues = zod_1.z.array(githubIssue).parse(await readRemote(url, { accept: 'application/vnd.github+json', 'user-agent': 'agent-brain', ...(token ? { authorization: `Bearer ${token}` } : {}) }));
            for (const issue of issues.filter((issue) => !issue.pull_request))
                tasks.push({
                    scope, title: issue.title, description: issue.body ?? '', status: issue.state === 'closed' ? 'done' : 'todo',
                    labels: issue.labels.map((label) => typeof label === 'string' ? label : label.name),
                    source: { type: 'github', external_id: `${connector.repository}#${issue.number}`, url: issue.html_url }
                });
            if (issues.length < 100)
                break;
        }
    }
    else {
        const key = process.env[connector.keyEnv];
        const token = process.env[connector.tokenEnv];
        if (!key || !token)
            throw new Error(`Set ${connector.keyEnv} and ${connector.tokenEnv} before importing Trello tasks.`);
        const url = new URL(`https://api.trello.com/1/boards/${connector.board}/cards/all`);
        url.search = new URLSearchParams({ key, token, fields: 'id,name,desc,closed,dueComplete,due,url,labels' }).toString();
        const cards = zod_1.z.array(trelloCard).parse(await readRemote(url, {}));
        for (const card of cards)
            tasks.push({ scope, title: card.name, description: card.desc,
                status: card.dueComplete ? 'done' : card.closed ? 'cancelled' : 'todo',
                ...(card.due ? { due: card.due.slice(0, 10) } : {}), labels: card.labels.map((label) => label.name),
                source: { type: 'trello', external_id: card.id, url: card.url }
            });
    }
    return (0, todos_1.importTodos)(store, tasks);
}
