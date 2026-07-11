import * as fs from 'fs';
import * as path from 'path';
import { IS_WINDOWS, VERBOSE_ENV } from './constants';

export function isSamePathOrDescendant(candidatePath: string, parentPath: string): boolean {
	const relative = path.relative(parentPath, candidatePath);
	return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function parseBooleanEnv(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function localDateString(): string {
	const now = new Date();
	const year = String(now.getFullYear()).padStart(4, '0');
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function verbose(message: string): void {
	if (parseBooleanEnv(process.env[VERBOSE_ENV])) {
		process.stderr.write(`agent-run: ${message}\n`);
	}
}

export function formatCommand(command: string, args: string[]): string {
	return [command, ...args].map(quoteArg).join(' ');
}

function quoteArg(value: string): string {
	if (value === '') {
		return '""';
	}
	if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
		return value;
	}
	return JSON.stringify(value);
}

export function fail(message: string): never {
	process.stderr.write(`agent-run: ${message}\n`);
	process.exit(1);
}

export function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.map((value) => path.resolve(value)))].sort((a, b) => a.localeCompare(b));
}

export function formatPathList(paths: string[]): string[] {
	return paths.length === 0 ? ['  (none)'] : paths.map((entry) => `  ${entry}`);
}

export function getExecutableExtensions(tool: string): string[] {
	if (!IS_WINDOWS || path.extname(tool)) {
		return [''];
	}
	return (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
		.split(';')
		.filter(Boolean)
		.map((entry) => entry.toLowerCase());
}

export function isExecutable(filePath: string): boolean {
	try {
		if (IS_WINDOWS) {
			return fs.statSync(filePath).isFile();
		}
		fs.accessSync(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export function findExecutable(command: string): string | null {
	const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
	for (const dir of pathDirs) {
		for (const extension of getExecutableExtensions(command)) {
			const candidate = path.join(dir, `${command}${extension}`);
			if (fs.existsSync(candidate) && isExecutable(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

export function isSymlink(filePath: string): boolean {
	try {
		return fs.lstatSync(filePath).isSymbolicLink();
	} catch {
		return false;
	}
}

export function nextBackupPath(filePath: string): string {
	const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
	let candidate = `${filePath}.bak.${timestamp}`;
	let index = 1;
	while (fs.existsSync(candidate) || isSymlink(candidate)) {
		candidate = `${filePath}.bak.${timestamp}.${index}`;
		index += 1;
	}
	return candidate;
}
