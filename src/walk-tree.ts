import * as fs from 'fs';
import * as path from 'path';
import { WalkVisitorResult } from './model';

type WalkOptions = {
	shouldPrune?: (entry: fs.Dirent) => boolean;
	shouldSkipDirectory?: (dir: string) => boolean;
};

export function walkTree(
	dir: string,
	visitor: (fullPath: string, entry: fs.Dirent) => WalkVisitorResult,
	options: WalkOptions = {}
): void {
	if (options.shouldSkipDirectory?.(dir)) {
		return;
	}
	const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	for (const entry of entries) {
		if (options.shouldPrune?.(entry)) {
			continue;
		}
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory() && options.shouldSkipDirectory?.(fullPath)) {
			continue;
		}
		const result = visitor(fullPath, entry);
		if (entry.isDirectory() && result !== 'skip') {
			walkTree(fullPath, visitor, options);
		}
	}
}
