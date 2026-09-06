import * as fs from 'fs';
import * as path from 'path';
import { IS_WINDOWS } from './constants';
import { ToolName } from './model';
import {
	fail,
	findExecutable,
	formatCommand,
	formatError,
	getExecutableExtensions,
	isExecutable,
	verbose
} from './utils';

const crossSpawn = require('cross-spawn') as typeof import('cross-spawn');

export function findRealBinary(tool: ToolName): string {
	const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
	const currentScriptArg = process.argv[1];
	const currentScript = currentScriptArg ? fs.realpathSync(currentScriptArg) : '';
	const wrappers = wrapperCandidates(tool);
	for (const dir of pathDirs) {
		for (const extension of getExecutableExtensions(tool)) {
			const candidate = path.join(dir, `${tool}${extension}`);
			if (!fs.existsSync(candidate) || !isExecutable(candidate)) {
				continue;
			}
			const resolvedCandidate = safeRealpath(candidate);
			if (resolvedCandidate === currentScript || wrappers.has(resolvedCandidate)) {
				continue;
			}
			if (isAgentRunRedirectShim(candidate)) {
				verbose(`skip ${tool} redirect shim: ${candidate}`);
				continue;
			}
			return candidate;
		}
	}
	fail(`no ${tool} binary found in PATH`);
}

function wrapperCandidates(tool: ToolName): Set<string> {
	const names = [
		tool,
		`${tool}.js`,
		`${tool}.cmd`,
		`${tool}.bat`,
		`${tool}.exe`,
		'agent-run',
		'agent-run.js',
		'agent-run.cmd',
		'agent-run.bat',
		'agent-run.exe'
	];
	return new Set(names.map((name) => path.join(__dirname, name)).filter(fs.existsSync).map(safeRealpath));
}

function safeRealpath(filePath: string): string {
	try {
		return fs.realpathSync(filePath);
	} catch {
		return filePath;
	}
}

function isAgentRunRedirectShim(filePath: string): boolean {
	try {
		const handle = fs.openSync(filePath, 'r');
		try {
			const buffer = Buffer.alloc(4096);
			const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
			return buffer.subarray(0, bytesRead).toString('utf8').includes('Run agent-run instead');
		} finally {
			fs.closeSync(handle);
		}
	} catch {
		return false;
	}
}

export function execCommand(
	command: string,
	args: string[],
	env?: Record<string, string | undefined>,
	cwd?: string,
	onExit?: (code: number) => number
): void {
	verbose(`spawn: ${formatCommand(command, args)} cwd=${cwd ?? process.cwd()}`);
	const child = crossSpawn(command, args, { cwd, env, stdio: 'inherit' });
	child.on('exit', (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		const originalCode = code === null ? 1 : code;
		process.exit(onExit ? onExit(originalCode) : originalCode);
	});
	child.on('error', (error) => fail(error.message));
}

export function openEditor(filePath: string): void {
	const configuredEditor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim();
	if (configuredEditor) {
		runConfiguredEditor(configuredEditor, filePath);
		return;
	}
	const vscodeCommand = findVsCodeEditorCommand();
	if (vscodeCommand !== null) {
		execCommand(vscodeCommand, ['--reuse-window', filePath]);
		return;
	}
	const fallbackEditor = findFallbackEditor();
	if (fallbackEditor !== null) {
		execCommand(fallbackEditor, [filePath]);
		return;
	}
	if (IS_WINDOWS) {
		execCommand('explorer.exe', [filePath]);
	} else if (process.platform === 'darwin') {
		execCommand('open', [filePath]);
	} else {
		execCommand('xdg-open', [filePath]);
	}
}

function runConfiguredEditor(commandLine: string, filePath: string): void {
	let editorArgs: string[];
	try {
		editorArgs = parseEditorCommand(commandLine);
	} catch (error) {
		fail(`invalid editor command: ${formatError(error)}`);
	}
	const [command, ...args] = editorArgs;
	if (!command) {
		fail('invalid editor command: command is empty');
	}
	execCommand(command, [...args, filePath]);
}

export function parseEditorCommand(commandLine: string): string[] {
	const args: string[] = [];
	let current = '';
	let quote: "'" | '"' | null = null;
	let tokenStarted = false;
	for (let index = 0; index < commandLine.length; index += 1) {
		const character = commandLine[index] ?? '';
		if (quote !== null) {
			if (character === quote) {
				quote = null;
				continue;
			}
			if (character === '\\' && quote === '"') {
				const next = commandLine[index + 1];
				if (next === '"' || next === '\\') {
					current += next;
					index += 1;
					continue;
				}
			}
			current += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			tokenStarted = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (tokenStarted) {
				args.push(current);
				current = '';
				tokenStarted = false;
			}
			continue;
		}
		if (character === '\\') {
			const next = commandLine[index + 1];
			if (next !== undefined && (/\s/.test(next) || next === "'" || next === '"' || next === '\\')) {
				current += next;
				index += 1;
				tokenStarted = true;
				continue;
			}
		}
		current += character;
		tokenStarted = true;
	}
	if (quote !== null) {
		throw new Error(`unterminated ${quote} quote`);
	}
	if (tokenStarted) {
		args.push(current);
	}
	if (args.length === 0) {
		throw new Error('command is empty');
	}
	return args;
}

function findVsCodeEditorCommand(): string | null {
	if (!isRunningInVsCodeTerminal()) {
		return null;
	}
	return ['code', 'codium'].map(findExecutable).find((command): command is string => command !== null) ?? null;
}

function isRunningInVsCodeTerminal(): boolean {
	const termProgram = process.env.TERM_PROGRAM?.trim().toLowerCase();
	return (
		termProgram === 'vscode' ||
		Boolean(process.env.VSCODE_GIT_IPC_HANDLE) ||
		Boolean(process.env.VSCODE_IPC_HOOK) ||
		Boolean(process.env.VSCODE_IPC_HOOK_CLI)
	);
}

function findFallbackEditor(): string | null {
	const candidates = IS_WINDOWS ? ['notepad.exe'] : ['joe', 'sensible-editor', 'editor', 'nano', 'nvim', 'vim', 'vi'];
	return candidates.map(findExecutable).find((command): command is string => command !== null) ?? null;
}
