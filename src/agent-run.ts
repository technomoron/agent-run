#!/usr/bin/env node

import * as path from 'path';
import { main } from './commands';

export { parseInvocation } from './cli';
export { defaultConfigRoot, defaultConfigRootSearchCandidates, findProjectRoot, resolveAgentDir, resolveProfile } from './project';
export { parseEditorCommand } from './process';

if (require.main === module) {
	main(path.basename(process.argv[1] ?? 'agent-run'), process.argv.slice(2));
}
