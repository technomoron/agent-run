#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { syncGeneratedAgentsFile } = require('../dist/agent-files');

const agentsRoot = resolveAgentsRoot(process.argv[2]);

for (const modsPath of walkForAgentsMods(agentsRoot)) {
	syncGeneratedAgentsFile(path.dirname(modsPath));
}

function resolveAgentsRoot(explicitRoot) {
	if (explicitRoot) {
		return path.resolve(explicitRoot);
	}

	if (process.env.AGENT_CONFIG_ROOT) {
		return process.env.AGENT_CONFIG_ROOT;
	}

	const sourceRoot =
		process.env.AGENT_SOURCE_ROOT || process.env.SOURCE_STORAGE_DIR || path.join(os.homedir(), 'source');

	return path.join(sourceRoot, 'agent-configs');
}

function* walkForAgentsMods(dir) {
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
		return;
	}

	const entries = fs.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === '.git' || entry.name === 'node_modules') {
				continue;
			}
			yield* walkForAgentsMods(fullPath);
			continue;
		}

		if (entry.isFile() && entry.name === 'AGENTS-MODS.md') {
			yield fullPath;
		}
	}
}
