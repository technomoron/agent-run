import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');

export function renderAgentsMods(sourceFile: string, stack: string[] = []): string {
	const resolvedSource = path.resolve(sourceFile);
	if (stack.includes(resolvedSource)) {
		throw new Error(`Include cycle detected: ${[...stack, resolvedSource].join(' -> ')}`);
	}

	const lines = fs.readFileSync(resolvedSource, 'utf8').replace(/\r\n/g, '\n').split('\n');
	const output: string[] = [];
	const nextStack = [...stack, resolvedSource];
	let sawLeadingInclude = false;
	let insertedOverrideNote = false;
	let contentStarted = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (!contentStarted && trimmed === '') {
			continue;
		}

		if (trimmed.startsWith('@')) {
			const includePath = trimmed.slice(1).trim();
			if (!includePath) {
				continue;
			}

			const resolvedInclude = resolveIncludePath(resolvedSource, includePath);
			output.push(renderAgentsMods(resolvedInclude, nextStack));
			if (!contentStarted) {
				sawLeadingInclude = true;
			}
			continue;
		}

		if (sawLeadingInclude && !insertedOverrideNote) {
			output.push('');
			output.push('If anything below this point conflicts with anything included above,');
			output.push('the later instructions below take precedence.');
			output.push('');
			insertedOverrideNote = true;
		}

		output.push(line);
		contentStarted = true;
	}

	return output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function resolveIncludePath(sourceFile: string, includePath: string): string {
	if (path.isAbsolute(includePath)) {
		return includePath;
	}

	const sourceRelativePath = path.resolve(path.dirname(sourceFile), includePath);
	if (fs.existsSync(sourceRelativePath)) {
		return sourceRelativePath;
	}

	// Fallback: strip all leading "../" traversals and resolve from the agents
	// repo root. Include paths conventionally use enough "../" to visually reach
	// the repo root (e.g. "../../templates/foo.md"), but the count is not
	// mechanically significant — the stripping always resolves to the agents repo
	// regardless of where agent-config files are stored on disk.
	return path.resolve(REPO_ROOT, includePath.replace(/^(\.\.\/)+/, ''));
}

export function syncGeneratedAgentsFile(agentDir: string): void {
	const modsPath = path.join(agentDir, 'AGENTS-MODS.md');
	const agentsPath = path.join(agentDir, 'AGENTS.md');
	const rendered = renderAgentsMods(modsPath);
	fs.writeFileSync(agentsPath, rendered, 'utf8');

	const claudePath = path.join(agentDir, 'CLAUDE.md');
	fs.writeFileSync(claudePath, '@AGENTS.md\n', 'utf8');
}
