import type { NormalizedMcpServer, RenderContext } from '../model';

export function renderCodexMcp(context: RenderContext): string {
	return renderTomlMcp(context.mcpServers, 'codex');
}

export function renderGrokMcp(context: RenderContext): string {
	return renderTomlMcp(context.mcpServers, 'grok');
}

export function renderClaudeMcp(context: RenderContext): Record<string, unknown> {
	return { mcpServers: renderJsonMcp(context.mcpServers, 'claude') };
}

export function renderGeminiMcp(context: RenderContext): Record<string, unknown> {
	return renderJsonMcp(context.mcpServers, 'gemini');
}

function renderJsonMcp(
	servers: Record<string, NormalizedMcpServer>,
	target: 'claude' | 'gemini'
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [name, server] of Object.entries(servers)) {
		if (!server.enabled) {
			continue;
		}
		if (server.transport === 'stdio') {
			result[name] = compactObject({
				...(target === 'claude' ? { type: 'stdio' } : {}),
				command: server.command,
				args: server.args.length > 0 ? server.args : undefined,
				cwd: server.cwd,
				env: Object.keys(server.env).length > 0 ? server.env : undefined
			});
			continue;
		}
		result[name] = compactObject({
			...(target === 'claude' ? { type: server.transport } : {}),
			...(target === 'gemini' && server.transport === 'http'
				? { httpUrl: server.url }
				: { url: server.url }),
			headers: Object.keys(server.headers).length > 0 ? server.headers : undefined
		});
	}
	return result;
}

function renderTomlMcp(
	servers: Record<string, NormalizedMcpServer>,
	target: 'codex' | 'grok'
): string {
	const sections: string[] = [];
	for (const [name, server] of Object.entries(servers)) {
		const lines = [`[mcp_servers.${tomlKey(name)}]`];
		if (server.transport === 'stdio') {
			lines.push(`command = ${tomlString(server.command ?? '')}`);
			if (server.args.length > 0) {
				lines.push(`args = ${tomlArray(server.args)}`);
			}
			if (server.cwd) {
				lines.push(`cwd = ${tomlString(server.cwd)}`);
			}
			if (Object.keys(server.env).length > 0) {
				lines.push(`env = ${tomlInlineTable(server.env)}`);
			}
		} else {
			lines.push(`url = ${tomlString(server.url ?? '')}`);
			if (Object.keys(server.headers).length > 0) {
				lines.push(`${target === 'codex' ? 'http_headers' : 'headers'} = ${tomlInlineTable(server.headers)}`);
			}
		}
		if (!server.enabled) {
			lines.push('enabled = false');
		}
		sections.push(lines.join('\n'));
	}
	return sections.length > 0 ? `${sections.join('\n\n')}\n` : '';
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function tomlKey(value: string): string {
	return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function tomlString(value: string): string {
	return JSON.stringify(value);
}

function tomlArray(values: string[]): string {
	return `[${values.map(tomlString).join(', ')}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
	return `{ ${Object.entries(values).map(([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`).join(', ')} }`;
}
