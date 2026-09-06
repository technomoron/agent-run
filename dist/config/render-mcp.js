"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCodexMcp = renderCodexMcp;
exports.renderGrokMcp = renderGrokMcp;
exports.renderClaudeMcp = renderClaudeMcp;
exports.renderGeminiMcp = renderGeminiMcp;
function renderCodexMcp(context) {
    return renderTomlMcp(context.mcpServers, 'codex');
}
function renderGrokMcp(context) {
    return renderTomlMcp(context.mcpServers, 'grok');
}
function renderClaudeMcp(context) {
    return { mcpServers: renderJsonMcp(context.mcpServers, 'claude') };
}
function renderGeminiMcp(context) {
    return renderJsonMcp(context.mcpServers, 'gemini');
}
function renderJsonMcp(servers, target) {
    const result = {};
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
function renderTomlMcp(servers, target) {
    const sections = [];
    for (const [name, server] of Object.entries(servers)) {
        if (!server.enabled)
            continue;
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
        }
        else {
            lines.push(`url = ${tomlString(server.url ?? '')}`);
            if (Object.keys(server.headers).length > 0) {
                lines.push(`${target === 'codex' ? 'http_headers' : 'headers'} = ${tomlInlineTable(server.headers)}`);
            }
        }
        sections.push(lines.join('\n'));
    }
    return sections.length > 0 ? `${sections.join('\n\n')}\n` : '';
}
function compactObject(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
function tomlKey(value) {
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}
function tomlString(value) {
    return JSON.stringify(value);
}
function tomlArray(values) {
    return `[${values.map(tomlString).join(', ')}]`;
}
function tomlInlineTable(values) {
    return `{ ${Object.entries(values).map(([key, value]) => `${tomlKey(key)} = ${tomlString(value)}`).join(', ')} }`;
}
