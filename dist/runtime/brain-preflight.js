"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireBrain = requireBrain;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/client/sse.js");
const config_1 = require("../brain/config");
const environment_1 = require("./environment");
async function requireBrain(context) {
    const server = context.mcpServers['agent-brain'];
    if (!server?.enabled) {
        if ((0, config_1.readBrainConfig)(context.configRoot)?.enabled)
            throw new Error('Cannot start agent: agent-brain is enabled but its MCP connection is disabled or missing.');
        return;
    }
    const client = new index_js_1.Client({ name: 'agent-run-preflight', version: '1.0.0' });
    let diagnostics = '';
    const transport = server.transport === 'stdio'
        ? new stdio_js_1.StdioClientTransport({ command: server.command ?? '', args: server.args, cwd: server.cwd ?? context.projectRoot,
            env: Object.fromEntries(Object.entries({ ...(0, environment_1.buildAgentEnvironment)(context), ...server.env }).filter((entry) => entry[1] !== undefined)), stderr: 'pipe' })
        : server.transport === 'http'
            ? new streamableHttp_js_1.StreamableHTTPClientTransport(new URL(server.url ?? ''), { requestInit: { headers: server.headers } })
            : new sse_js_1.SSEClientTransport(new URL(server.url ?? ''), { requestInit: { headers: server.headers } });
    if (transport instanceof stdio_js_1.StdioClientTransport)
        transport.stderr?.on('data', (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-8192); });
    try {
        await client.connect(transport, { timeout: 10000 });
        const status = await client.callTool({ name: 'brain_status', arguments: {} }, undefined, { timeout: 10000 });
        if (status.isError)
            throw new Error(JSON.stringify(status.content));
    }
    catch (error) {
        throw new Error(`Cannot start agent: agent-brain MCP check failed: ${error instanceof Error ? error.message : String(error)}${diagnostics.trim() ? `\n${diagnostics.trim()}` : ''}`);
    }
    finally {
        await client.close();
        await transport.close();
    }
}
