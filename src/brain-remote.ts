#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthTokensSchema, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readBrainConfig } from './brain/config';

export type RemoteBrain = NonNullable<NonNullable<ReturnType<typeof readBrainConfig>>['remote']>;
const savedSchema = z.object({ tokens: OAuthTokensSchema, expiresAt: z.number() });

/** OAuth credentials stay in private runtime state, never generated agent configuration. */
export class BrainCredentials implements OAuthClientProvider {
	readonly directory: string;
	readonly file: string;
	private verifier = '';
	authorization?: (url: URL) => void;
	state?: () => string;
	constructor(
		readonly root: string,
		readonly config: RemoteBrain
	) {
		const key = createHash('sha256')
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
			token_endpoint_auth_method: 'none' as const,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			scope: this.config.scope
		};
	}
	clientInformation() {
		return { client_id: this.config.clientId, token_endpoint_auth_method: 'none' as const };
	}
	read() {
		try {
			const stat = fs.lstatSync(this.file);
			if (
				!stat.isFile() ||
				stat.isSymbolicLink() ||
				(process.platform !== 'win32' && (stat.uid !== process.getuid?.() || stat.mode & 0o077))
			)
				throw new Error('Brain credential file must be private and owned by you');
			return savedSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw error;
		}
	}
	tokens() {
		return this.read()?.tokens;
	}
	saveTokens(tokens: OAuthTokens) {
		const temporary = path.join(this.directory, randomUUID() + '.tmp');
		try {
			fs.writeFileSync(
				temporary,
				JSON.stringify({ tokens, expiresAt: Date.now() + (tokens.expires_in ?? 300) * 1000 }),
				{ mode: 0o600, flag: 'wx' }
			);
			fs.renameSync(temporary, this.file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
	}
	invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
		if (scope === 'all' || scope === 'tokens') fs.rmSync(this.file, { force: true });
		if (scope === 'all' || scope === 'verifier') this.verifier = '';
	}
	redirectToAuthorization(url: URL) {
		if (!this.authorization) throw new Error('Remote Brain login required. Run agent-run brain-login.');
		this.authorization(url);
	}
	saveCodeVerifier(value: string) {
		this.verifier = value;
	}
	codeVerifier() {
		if (!this.verifier) throw new Error('Missing OAuth verifier');
		return this.verifier;
	}
	async validateResourceURL(serverUrl: string | URL, resource?: string) {
		if (String(serverUrl) !== this.config.url || (resource && resource !== this.config.url))
			throw new Error('Unexpected Brain OAuth resource');
		return new URL(this.config.url);
	}
	async refresh(rejected?: string): Promise<OAuthTokens> {
		const lock = path.join(this.directory, 'refresh.lock');
		const deadline = Date.now() + 15000;
		while (true) {
			try {
				fs.mkdirSync(lock, { mode: 0o700 });
				fs.writeFileSync(path.join(lock, 'owner'), String(process.pid), { mode: 0o600, flag: 'wx' });
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				try {
					const owner = Number(fs.readFileSync(path.join(lock, 'owner'), 'utf8'));
					if (Number.isSafeInteger(owner) && owner > 0) {
						try {
							process.kill(owner, 0);
						} catch (ownerError) {
							if ((ownerError as NodeJS.ErrnoException).code === 'ESRCH') {
								fs.unlinkSync(path.join(lock, 'owner'));
								fs.rmdirSync(lock);
								continue;
							}
						}
					}
				} catch (ownerError) {
					if ((ownerError as NodeJS.ErrnoException).code !== 'ENOENT') throw ownerError;
				}
				if (Date.now() > deadline) throw new Error('Brain token refresh is busy; retry shortly');
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
		try {
			const saved = this.read();
			if (
				saved &&
				saved.expiresAt > Date.now() + 30000 &&
				(!rejected || saved.tokens.access_token !== rejected)
			)
				return saved.tokens;
			if (!saved?.tokens.refresh_token)
				throw new Error('Remote Brain login required. Run agent-run brain-login.');
			const result = await auth(this, {
				serverUrl: this.config.url,
				scope: this.config.scope,
				fetchFn: (input, init) =>
					fetch(input, { ...init, signal: AbortSignal.timeout(10000), redirect: 'error' })
			});
			if (result !== 'AUTHORIZED') throw new Error('Remote Brain login required. Run agent-run brain-login.');
			return this.tokens()!;
		} finally {
			fs.unlinkSync(path.join(lock, 'owner'));
			fs.rmdirSync(lock);
		}
	}
	async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
		if (
			new URL(input instanceof Request ? input.url : String(input)).origin !== new URL(this.config.url).origin
		)
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

export async function connectRemoteBrain(root: string, repository?: string) {
	const config = readBrainConfig(root)?.remote;
	if (!config) throw new Error('No remote Brain configured');
	const credentials = new BrainCredentials(root, config);
	const client = new Client({ name: 'agent-run-remote-brain', version: '1.0.0' });
	const transport = new StreamableHTTPClientTransport(new URL(config.url), {
		fetch: (input, init) => credentials.fetch(input, init),
		requestInit: { headers: repository ? { 'X-Agent-Repository': repository } : {} }
	});
	try {
		await client.connect(transport, { timeout: 10000 });
		return client;
	} catch (error) {
		await client.close();
		throw error;
	}
}

export async function loginRemoteBrain(root: string) {
	const config = readBrainConfig(root)?.remote;
	if (!config) throw new Error('No remote Brain configured');
	const credentials = new BrainCredentials(root, config),
		redirect = new URL(config.redirectUrl);
	if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1')
		throw new Error('Login callback must use http://127.0.0.1');
	const state = randomUUID();
	credentials.state = () => state;
	let resolveCode!: (code: string) => void, rejectCode!: (error: Error) => void;
	const code = new Promise<string>((resolve, reject) => {
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
		resolveCode(url.searchParams.get('code')!);
	});
	const timer = setTimeout(() => rejectCode(new Error('Brain login timed out')), 180000);
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(Number(redirect.port) || 80, '127.0.0.1', resolve);
		});
		credentials.authorization = (url) => {
			process.stderr.write(`Sign in to Brain: ${url}\n`);
			const executable =
				process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
			const args =
				process.platform === 'win32' ? ['url.dll,FileProtocolHandler', String(url)] : [String(url)];
			const child = spawn(executable, args, { stdio: 'ignore', shell: false });
			child.on('error', () => {});
			child.unref();
		};
		if ((await auth(credentials, { serverUrl: config.url, scope: config.scope })) === 'REDIRECT')
			await auth(credentials, { serverUrl: config.url, scope: config.scope, authorizationCode: await code });
		process.stderr.write('Remote Brain login saved.\n');
	} finally {
		clearTimeout(timer);
		server.closeAllConnections();
		server.close();
	}
}

export async function proxyRemoteBrain(root: string, repository?: string) {
	const client = await connectRemoteBrain(root, repository);
	const server = new Server(
		{ name: 'agent-brain-remote', version: '1.0.0' },
		{ capabilities: { tools: {} } }
	);
	server.setRequestHandler(ListToolsRequestSchema, (req) => client.listTools(req.params));
	server.setRequestHandler(CallToolRequestSchema, async (req, extra) =>
		client.callTool(req.params, undefined, { signal: extra.signal })
	);
	const transport = new StdioServerTransport();
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
	const { values } = parseArgs({
		options: { configdir: { type: 'string' }, repository: { type: 'string' }, login: { type: 'boolean' } }
	});
	if (!values.configdir) throw new Error('--configdir is required');
	const run = values.login
		? loginRemoteBrain(values.configdir)
		: proxyRemoteBrain(values.configdir, values.repository);
	run.catch((error) => {
		process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
		process.exitCode = 1;
	});
}
