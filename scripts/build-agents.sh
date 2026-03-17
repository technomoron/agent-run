#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

find "$REPO_ROOT/agents" \
	\( -type d \( -name .git -o -name node_modules \) -prune \) -o \
	-type f -name AGENTS-MODS.md -print | sort | while IFS= read -r mods_file; do
		agent_dir=$(dirname -- "$mods_file")
		output_file="$agent_dir/AGENTS.md"

		node - "$mods_file" "$output_file" <<'NODE'
const fs = require('fs');
const path = require('path');

const sourceFile = path.resolve(process.argv[2]);
const outputFile = path.resolve(process.argv[3]);

function readLines(file) {
	return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
}

function renderFile(file, stack = []) {
	if (stack.includes(file)) {
		throw new Error(`Include cycle detected: ${[...stack, file].join(' -> ')}`);
	}

	const lines = readLines(file);
	const output = [];
	const nextStack = [...stack, file];
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
			const resolved = path.isAbsolute(includePath)
				? includePath
				: path.resolve(path.dirname(file), includePath);
			output.push(renderFile(resolved, nextStack));
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

fs.writeFileSync(outputFile, renderFile(sourceFile));
NODE
	done
