#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrainCredentials = void 0;
exports.connectRemoteBrain = connectRemoteBrain;
exports.loginRemoteBrain = loginRemoteBrain;
exports.proxyRemoteBrain = proxyRemoteBrain;
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const zod_1 = require("zod");
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const auth_js_1 = require("@modelcontextprotocol/sdk/client/auth.js");
const auth_js_2 = require("@modelcontextprotocol/sdk/shared/auth.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const index_js_2 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const config_1 = require("./brain/config");
const savedSchema = zod_1.z.object({ tokens: auth_js_2.OAuthTokensSchema, expiresAt: zod_1.z.number() });
/** OAuth credentials stay in private runtime state, never generated agent configuration. */
class BrainCredentials {
    constructor(root, config) {
        this.root = root;
        this.config = config;
        this.verifier = '';
        const key = (0, node_crypto_1.createHash)('sha256')
            .update(config.url + '\0' + config.clientId + '\0' + config.scope)
            .digest('hex');
        this.directory = path.join(root, 'runtime', 'brain-remote', key);
        let current = path.resolve(root);
        for (const part of ['runtime', 'brain-remote', key]) {
            current = path.join(current, part);
            fs.mkdirSync(current, { recursive: true, mode: 0o700 });
            const stat = fs.lstatSync(current);
            if (!stat.isDirectory() || stat.isSymbolicLink())
                throw new Error('Brain credential directory must not be a symlink');
        }
        const stat = fs.statSync(this.directory);
        if (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || stat.mode & 0o077))
            throw new Error('Brain credential directory must be private and owned by you');
        this.file = path.join(this.directory, 'tokens.json');
    }
    get redirectUrl() {
        return this.config.redirectUrl;
    }
    get clientMetadata() {
        return {
            redirect_uris: [this.redirectUrl],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            scope: this.config.scope
        };
    }
    clientInformation() {
        return { client_id: this.config.clientId, token_endpoint_auth_method: 'none' };
    }
    read() {
        try {
            const stat = fs.lstatSync(this.file);
            if (!stat.isFile() ||
                stat.isSymbolicLink() ||
                (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || stat.mode & 0o077)))
                throw new Error('Brain credential file must be private and owned by you');
            return savedSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    tokens() {
        return this.read()?.tokens;
    }
    saveTokens(tokens) {
        const temporary = path.join(this.directory, (0, node_crypto_1.randomUUID)() + '.tmp');
        try {
            fs.writeFileSync(temporary, JSON.stringify({ tokens, expiresAt: Date.now() + (tokens.expires_in ?? 300) * 1000 }), { mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, this.file);
        }
        finally {
            fs.rmSync(temporary, { force: true });
        }
    }
    invalidateCredentials(scope) {
        if (scope === 'all' || scope === 'tokens')
            fs.rmSync(this.file, { force: true });
        if (scope === 'all' || scope === 'verifier')
            this.verifier = '';
    }
    redirectToAuthorization(url) {
        if (!this.authorization)
            throw new Error('Remote Brain login required. Run agent-run brain-login.');
        this.authorization(url);
    }
    saveCodeVerifier(value) {
        this.verifier = value;
    }
    codeVerifier() {
        if (!this.verifier)
            throw new Error('Missing OAuth verifier');
        return this.verifier;
    }
    async validateResourceURL(serverUrl, resource) {
        if (String(serverUrl) !== this.config.url || (resource && resource !== this.config.url))
            throw new Error('Unexpected Brain OAuth resource');
        return new URL(this.config.url);
    }
    async refresh(rejected) {
        const lock = path.join(this.directory, 'refresh.lock');
        const deadline = Date.now() + 15000;
        while (true) {
            try {
                fs.mkdirSync(lock, { mode: 0o700 });
                fs.writeFileSync(path.join(lock, 'owner'), String(process.pid), { mode: 0o600, flag: 'wx' });
                break;
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
                try {
                    const owner = Number(fs.readFileSync(path.join(lock, 'owner'), 'utf8'));
                    if (Number.isSafeInteger(owner) && owner > 0) {
                        try {
                            process.kill(owner, 0);
                        }
                        catch (ownerError) {
                            if (ownerError.code === 'ESRCH') {
                                fs.unlinkSync(path.join(lock, 'owner'));
                                fs.rmdirSync(lock);
                                continue;
                            }
                        }
                    }
                }
                catch (ownerError) {
                    if (ownerError.code !== 'ENOENT')
                        throw ownerError;
                }
                if (Date.now() > deadline)
                    throw new Error('Brain token refresh is busy; retry shortly');
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        try {
            const saved = this.read();
            if (saved &&
                saved.expiresAt > Date.now() + 30000 &&
                (!rejected || saved.tokens.access_token !== rejected))
                return saved.tokens;
            if (!saved?.tokens.refresh_token)
                throw new Error('Remote Brain login required. Run agent-run brain-login.');
            const result = await (0, auth_js_1.auth)(this, {
                serverUrl: this.config.url,
                scope: this.config.scope,
                fetchFn: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000), redirect: 'error' })
            });
            if (result !== 'AUTHORIZED')
                throw new Error('Remote Brain login required. Run agent-run brain-login.');
            return this.tokens();
        }
        finally {
            fs.unlinkSync(path.join(lock, 'owner'));
            fs.rmdirSync(lock);
        }
    }
    async fetch(input, init) {
        if (new URL(input instanceof Request ? input.url : String(input)).origin !== new URL(this.config.url).origin)
            throw new Error('Brain request escaped its configured origin');
        let tokens = await this.refresh();
        const send = () => {
            const headers = new Headers(init?.headers);
            headers.set('Authorization', 'Bearer ' + tokens.access_token);
            return fetch(input, { ...init, headers, redirect: 'error' });
        };
        let response = await send();
        if (response.status === 401) {
            await response.body?.cancel();
            tokens = await this.refresh(tokens.access_token);
            response = await send();
        }
        return response;
    }
}
exports.BrainCredentials = BrainCredentials;
async function connectRemoteBrain(root, repository) {
    const config = (0, config_1.readBrainConfig)(root)?.remote;
    if (!config)
        throw new Error('No remote Brain configured');
    const credentials = new BrainCredentials(root, config);
    const client = new index_js_1.Client({ name: 'agent-run-remote-brain', version: '1.0.0' });
    const transport = new streamableHttp_js_1.StreamableHTTPClientTransport(new URL(config.url), {
        fetch: (input, init) => credentials.fetch(input, init),
        requestInit: { headers: repository ? { 'X-Agent-Repository': repository } : {} }
    });
    try {
        await client.connect(transport, { timeout: 10000 });
        return client;
    }
    catch (error) {
        await client.close();
        throw error;
    }
}
async function loginRemoteBrain(root) {
    const config = (0, config_1.readBrainConfig)(root)?.remote;
    if (!config)
        throw new Error('No remote Brain configured');
    const credentials = new BrainCredentials(root, config), redirect = new URL(config.redirectUrl);
    if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1')
        throw new Error('Login callback must use http://127.0.0.1');
    const state = (0, node_crypto_1.randomUUID)();
    credentials.state = () => state;
    let resolveCode, rejectCode;
    const code = new Promise((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', redirect);
        if (url.pathname !== redirect.pathname || url.searchParams.get('state') !== state) {
            res.writeHead(400).end('Invalid login callback');
            return;
        }
        if (url.searchParams.has('error') || !url.searchParams.get('code')) {
            res.writeHead(400).end('Login failed');
            rejectCode(new Error('Brain login denied'));
            return;
        }
        res
            .writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
            .end('Brain login complete. You may close this tab.');
        resolveCode(url.searchParams.get('code'));
    });
    const timer = setTimeout(() => rejectCode(new Error('Brain login timed out')), 180000);
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(Number(redirect.port) || 80, '127.0.0.1', resolve);
        });
        credentials.authorization = (url) => {
            process.stderr.write(`Sign in to Brain: ${url}\n`);
            const executable = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
            const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', String(url)] : [String(url)];
            const child = (0, node_child_process_1.spawn)(executable, args, { stdio: 'ignore', shell: false });
            child.on('error', () => { });
            child.unref();
        };
        if ((await (0, auth_js_1.auth)(credentials, { serverUrl: config.url, scope: config.scope })) === 'REDIRECT')
            await (0, auth_js_1.auth)(credentials, { serverUrl: config.url, scope: config.scope, authorizationCode: await code });
        process.stderr.write('Remote Brain login saved.\n');
    }
    finally {
        clearTimeout(timer);
        server.closeAllConnections();
        server.close();
    }
}
async function proxyRemoteBrain(root, repository) {
    const client = await connectRemoteBrain(root, repository);
    const server = new index_js_2.Server({ name: 'agent-brain-remote', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(types_js_1.ListToolsRequestSchema, (req) => client.listTools(req.params));
    server.setRequestHandler(types_js_1.CallToolRequestSchema, async (req, extra) => client.callTool(req.params, undefined, { signal: extra.signal }));
    const transport = new stdio_js_1.StdioServerTransport();
    const close = async () => {
        await server.close();
        await client.close();
    };
    transport.onclose = () => {
        void close();
    };
    await server.connect(transport);
    process.once('SIGTERM', () => {
        void close();
    });
    process.once('SIGINT', () => {
        void close();
    });
}
if (require.main === module) {
    const { values } = (0, node_util_1.parseArgs)({
        options: { configdir: { type: 'string' }, repository: { type: 'string' }, login: { type: 'boolean' } }
    });
    if (!values.configdir)
        throw new Error('--configdir is required');
    const run = values.login
        ? loginRemoteBrain(values.configdir)
        : proxyRemoteBrain(values.configdir, values.repository);
    run.catch((error) => {
        process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
        process.exitCode = 1;
    });
}
