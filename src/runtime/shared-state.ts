import * as fs from 'fs';
import * as path from 'path';
import { IS_WINDOWS } from '../constants';
import { isSymlink, nextBackupPath, verbose } from '../utils';

export function linkSharedEntry(sourcePath: string, targetPath: string, label: string): void {
	if (!fs.existsSync(sourcePath) && !isSymlink(sourcePath)) {
		return;
	}
	if (path.resolve(sourcePath) === path.resolve(targetPath) || isSymlinkTo(targetPath, sourcePath)) {
		return;
	}
	if (fs.existsSync(targetPath) || isSymlink(targetPath)) {
		const backupPath = nextBackupPath(targetPath);
		fs.renameSync(targetPath, backupPath);
		verbose(`backed up ${label} ${targetPath} -> ${backupPath}`);
	}
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	try {
		fs.symlinkSync(sourcePath, targetPath, fs.statSync(sourcePath).isDirectory() ? 'junction' : 'file');
		verbose(`linked ${label} ${targetPath} -> ${sourcePath}`);
	} catch (error) {
		if (!IS_WINDOWS || fs.statSync(sourcePath).isDirectory()) {
			throw error;
		}
		fs.copyFileSync(sourcePath, targetPath);
		verbose(`copied ${label} ${sourcePath} -> ${targetPath}`);
	}
}

function isSymlinkTo(filePath: string, targetPath: string): boolean {
	try {
		if (!fs.lstatSync(filePath).isSymbolicLink()) {
			return false;
		}
		const linkTarget = fs.readlinkSync(filePath);
		return path.resolve(path.dirname(filePath), linkTarget) === path.resolve(targetPath);
	} catch {
		return false;
	}
}
