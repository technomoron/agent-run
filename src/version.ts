import * as fs from 'fs';
import * as path from 'path';

let cached: string | null = null;

/**
 * The package version, read from package.json next to the compiled output.
 * This is the single source; nothing else in the tree hardcodes a version.
 */
export function packageVersion(): string {
	if (cached === null) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as { version?: unknown };
			cached = typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
		} catch {
			cached = '0.0.0';
		}
	}
	return cached;
}
