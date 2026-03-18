#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const baseDir = path.resolve(process.argv[2] || '.');
const AI_IGNORE_PATTERN = /^[\t ]*([./]*)(AGENTS\.md|AGENTS-MODS\.md|CLAUDE\.md|codex\.md|\.claude\/?|\.codex\/?)$/m;

if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
	process.stderr.write(`Base directory not found: ${baseDir}\n`);
	process.exit(1);
}

for (const entry of collectAiEntries(baseDir)) {
	process.stdout.write(`${entry}\n`);
}

checkClaudeFiles(repoRoot);
checkGitignoreFiles(baseDir);

function collectAiEntries(rootDir) {
	const results = [];

	walk(rootDir, ({ fullPath, dirent }) => {
		if (dirent.isDirectory() && (dirent.name === '.claude' || dirent.name === '.codex')) {
			results.push(fullPath);
			return 'skip';
		}

		if (
			dirent.isFile() &&
			(dirent.name === 'AGENTS.md' ||
				dirent.name === 'AGENTS-MODS.md' ||
				dirent.name === 'CLAUDE.md' ||
				dirent.name === 'codex.md')
		) {
			results.push(fullPath);
		}

		return undefined;
	});

	return results.sort();
}

function checkClaudeFiles(rootDir) {
	for (const claudeFile of findFiles(rootDir, 'CLAUDE.md', new Set(['.git', 'node_modules', '.pnpm-store', 'dist', 'build', 'bin', 'scripts']))) {
		const claudeDir = path.dirname(claudeFile);
		const agentsModsFile = path.join(claudeDir, 'AGENTS-MODS.md');
		const claudeText = fs.readFileSync(claudeFile, 'utf8').replace(/\r/g, '');

		if (!fs.existsSync(agentsModsFile)) {
			process.stderr.write(`WARN missing sibling AGENTS-MODS.md: ${claudeFile}\n`);
			continue;
		}

		if (claudeText !== '@AGENTS.md\n' && claudeText !== '@AGENTS.md') {
			process.stderr.write(`WARN non-pointer CLAUDE.md: ${claudeFile}\n`);
		}
	}
}

function checkGitignoreFiles(rootDir) {
	for (const gitignoreFile of findFiles(rootDir, '.gitignore', new Set(['.git', 'node_modules', '.pnpm-store', 'dist', 'build']))) {
		const content = fs.readFileSync(gitignoreFile, 'utf8');
		if (AI_IGNORE_PATTERN.test(content)) {
			process.stderr.write(`WARN AI ignore entry in .gitignore: ${gitignoreFile}\n`);
			for (const match of content.matchAll(/^[\t ]*([./]*)(AGENTS\.md|AGENTS-MODS\.md|CLAUDE\.md|codex\.md|\.claude\/?|\.codex\/?)$/gm)) {
				process.stderr.write(`${match[0]}\n`);
			}
		}
	}
}

function findFiles(rootDir, fileName, skipDirs) {
	const matches = [];
	walk(rootDir, ({ fullPath, dirent }) => {
		if (dirent.isFile() && dirent.name === fileName) {
			matches.push(fullPath);
		}

		if (dirent.isDirectory() && skipDirs.has(dirent.name)) {
			return 'skip';
		}

		return undefined;
	});
	return matches.sort();
}

function walk(dir, visitor) {
	const entries = fs.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const dirent of entries) {
		const fullPath = path.join(dir, dirent.name);
		const result = visitor({ fullPath, dirent });
		if (dirent.isDirectory() && result !== 'skip' && !shouldPrune(dirent.name)) {
			walk(fullPath, visitor);
		}
	}
}

function shouldPrune(name) {
	return name === '.git' || name === 'node_modules' || name === '.pnpm-store' || name === 'dist' || name === 'build';
}
