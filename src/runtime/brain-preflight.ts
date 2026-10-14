import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { RenderContext } from '../model';
import { readBrainConfig } from '../brain/config';
import { buildAgentEnvironment } from './environment';

export async function requireBrain(context: RenderContext): Promise<void> {
	const server = context.mcpServers['agent-brain'];
	if (!server?.enabled) {
		if (readBrainConfig(context.configRoot)?.enabled) throw new Error('Cannot start agent: agent-brain is enabled but its MCP connection is disabled or missing.');
		return;
	}
	const client = new Client({ name: 'agent-run-preflight', version: '1.0.0' });
	let diagnostics = '';
	const transport = server.transport === 'stdio'
		? new StdioClientTransport({ command: server.command ?? '', args: server.args, cwd: server.cwd ?? context.projectRoot,
			env: Object.fromEntries(Object.entries({ ...buildAgentEnvironment(context), ...server.env }).filter((entry): entry is [string, string] => entry[1] !== undefined)), stderr: 'pipe' })
		: server.transport === 'http'
			? new StreamableHTTPClientTransport(new URL(server.url ?? ''), { requestInit: { headers: server.headers } })
			: new SSEClientTransport(new URL(server.url ?? ''), { requestInit: { headers: server.headers } });
	if (transport instanceof StdioClientTransport) transport.stderr?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-8192); });
	try {
		await client.connect(transport, { timeout: 10000 });
		const status = await client.callTool({ name: 'brain_status', arguments: {} }, undefined, { timeout: 10000 });
		if (status.isError) throw new Error(JSON.stringify(status.content));
	} catch (error) {
		throw new Error(`Cannot start agent: agent-brain MCP check failed: ${error instanceof Error ? error.message : String(error)}${diagnostics.trim() ? `\n${diagnostics.trim()}` : ''}`);
	} finally {
		await client.close();
		await transport.close();
	}
}
