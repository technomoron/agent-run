declare module 'fs' {
	export interface Dirent {
		name: string;
		isDirectory(): boolean;
		isFile(): boolean;
	}

	export interface Stats {
		isDirectory(): boolean;
		isFile(): boolean;
	}

	export const constants: {
		X_OK: number;
	};

	export function accessSync(path: string, mode?: number): void;
	export function chmodSync(path: string, mode: number): void;
	export function existsSync(path: string): boolean;
	export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
	export function readFileSync(path: string, encoding: string): string;
	export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
	export function realpathSync(path: string): string;
	export function renameSync(oldPath: string, newPath: string): void;
	export function statSync(path: string): Stats;
	export function writeFileSync(path: string, data: string, encoding?: string): void;
}

declare module 'os' {
	export function homedir(): string;
}

declare module 'path' {
	export const delimiter: string;
	export const sep: string;
	export function basename(path: string): string;
	export function dirname(path: string): string;
	export function extname(path: string): string;
	export function isAbsolute(path: string): boolean;
	export function join(...paths: string[]): string;
	export function relative(from: string, to: string): string;
	export function resolve(...paths: string[]): string;
}

declare module 'child_process' {
	export interface ChildProcess {
		on(event: 'error', listener: (error: Error) => void): ChildProcess;
		on(event: 'exit', listener: (code: number | null, signal: string | null) => void): ChildProcess;
	}

	export function spawn(
		command: string,
		args: string[],
		options: {
			cwd?: string;
			env?: Record<string, string | undefined>;
			shell: boolean;
			stdio: 'inherit';
		}
	): ChildProcess;
}

declare module 'jsonc-parser' {
	export type ParseError = {
		error: number;
		offset: number;
		length: number;
	};
	export function parse(text: string, errors?: ParseError[], options?: { allowTrailingComma?: boolean }): unknown;
	export function printParseErrorCode(code: number): string;
}

declare module 'nunjucks' {
	export class FileSystemLoader {
		constructor(searchPaths: string | string[], opts?: { noCache?: boolean });
	}
	export class Environment {
		constructor(loader?: FileSystemLoader, opts?: Record<string, unknown>);
		render(name: string, context?: object): string;
		renderString(src: string, context?: object): string;
	}
}

declare const __dirname: string;
declare const module: { exports: unknown };
declare const require: {
	(name: string): unknown;
	main?: unknown;
};

declare const process: {
	argv: string[];
	cwd(): string;
	env: Record<string, string | undefined>;
	exit(code?: number): never;
	getuid?: () => number;
	kill(pid: number, signal?: string): void;
	pid: number;
	platform: string;
	stdout: {
		write(chunk: string): void;
	};
	stderr: {
		write(chunk: string): void;
	};
};
