import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BrainStore, knowledgeDirectories } from './store';
import { listBrainProjects } from './config';

function git(root: string, args: string[]): string {
	const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false, timeout: 60000,
		env: { ...process.env, PATH: process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 16 * 1024 * 1024 });
	if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`);
	return result.stdout.trimEnd();
}

function requireRepository(store: BrainStore): void {
	if (fs.realpathSync(git(store.configRoot, ['rev-parse', '--show-toplevel'])) !== fs.realpathSync(store.configRoot)) {
		throw new Error('Git sync requires the configuration directory itself to be the repository root.');
	}
}

export function gitStatus(store: BrainStore): { state: string; files: string[]; conflicts: string[]; branch: string } {
	if (!fs.existsSync(path.join(store.configRoot, '.git'))) return { state: 'uninitialized', files: [], conflicts: [], branch: '' };
	requireRepository(store);
	const conflicts = git(store.configRoot, ['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean);
	const files = git(store.configRoot, ['status', '--porcelain', '-z']).split('\0').filter(Boolean);
	return { state: conflicts.length ? 'conflicted' : files.length ? 'dirty' : 'clean', files, conflicts,
		branch: git(store.configRoot, ['branch', '--show-current']) };
}

function syncableFiles(store: BrainStore): string[] {
	const folders = new Set([...Object.values(knowledgeDirectories), 'skills', 'todo', 'notes']);
	const roots = [path.join(store.configRoot, 'global'), path.join(store.configRoot, 'default')];
	roots.push(...listBrainProjects(store.configRoot).map((project) => store.safePath(project.profile)));
	if (store.profile && !store.profile.startsWith('projects/')) roots.push(store.scopeDirectory('project'));
	const files: string[] = [];
	for (const root of roots) {
		for (const folder of folders) files.push(...store.files(path.join(root, folder)));
		files.push(...store.files(path.join(root, 'templates'), { includeAllFiles: true }));
		for (const name of ['config.yaml', 'project.md', 'review-history.jsonl', 'review-counters.json', 'knowledge-history.jsonl']) {
			const file = store.safePath(root, name);
			if (fs.existsSync(file)) files.push(file);
		}
	}
	if (fs.existsSync(path.join(store.configRoot, '.git'))) {
		const removable = roots.flatMap((root) => ['templates', 'notes', ...Object.values(knowledgeDirectories)].map((folder) => path.relative(store.configRoot, path.join(root, folder))));
		const deleted = git(store.configRoot, ['ls-files', '--deleted', '-z', '--', ...removable]).split('\0').filter(Boolean);
		files.push(...deleted.map((file) => store.safePath(file)));
	}
	const ignore = store.safePath('.gitignore');
	if (fs.existsSync(ignore)) files.push(ignore);
	return [...new Set(files.map((file) => path.relative(store.configRoot, file)))].sort();
}

export type SyncAction = 'init' | 'save' | 'pull' | 'push' | 'sync';

export function syncGit(store: BrainStore, action: SyncAction, message?: string): ReturnType<typeof gitStatus> & { steps: string[] } {
	return store.writeLocked(() => {
		const steps: string[] = [];
		try {
			if (action === 'init') {
				if (!fs.existsSync(path.join(store.configRoot, '.git'))) git(store.configRoot, ['init', '--initial-branch=main']);
				return { ...gitStatus(store), steps: ['Configuration Git repository initialized.'] };
			}
			requireRepository(store);
			const status = gitStatus(store);
			if (status.state === 'conflicted') throw new Error(`Resolve Git conflicts before syncing: ${status.conflicts.join(', ')}`);
			if (action === 'save' || action === 'sync') {
				if (message !== undefined && !message.trim()) throw new Error('The commit message must not be empty.');
				if (git(store.configRoot, ['diff', '--cached', '--name-only'])) throw new Error('The Git index already has staged changes. Commit or unstage them before saving brain knowledge.');
				const files = syncableFiles(store);
				if (files.length) git(store.configRoot, ['add', '--', ...files]);
				const changed = git(store.configRoot, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
				if (changed.length) {
					const commitMessage = message ?? `Update brain knowledge (${changed.length} ${changed.length === 1 ? 'file' : 'files'})`;
					git(store.configRoot, ['commit', '-m', commitMessage]);
					steps.push(`Saved ${changed.length} ${changed.length === 1 ? 'file' : 'files'} in commit ${git(store.configRoot, ['rev-parse', '--short', 'HEAD'])}: ${commitMessage}`);
				} else steps.push('No local brain changes to save.');
			}
			if (action === 'pull' || action === 'sync') {
				if (git(store.configRoot, ['diff', '--name-only']) || git(store.configRoot, ['diff', '--cached', '--name-only'])) throw new Error('Save or resolve local tracked configuration changes before pulling.');
				try { git(store.configRoot, ['-c', 'merge.autoStash=false', '-c', 'rebase.autoStash=false', 'pull', '--rebase']); }
				catch (error) {
					const after = gitStatus(store);
					if (after.state === 'conflicted') throw new Error(`Pull stopped with conflicts: ${after.conflicts.join(', ')}. Resolve the rebase before syncing again.`);
					throw new Error(`Pull failed: ${error instanceof Error ? error.message : String(error)}`);
				}
				steps.push('Pulled remote changes.');
			}
			if (action === 'push' || action === 'save' || action === 'sync') {
				git(store.configRoot, ['push']);
				steps.push('Push completed; remote is up to date.');
			}
			return { ...gitStatus(store), steps };
		} catch (error) {
			throw new Error([...steps, error instanceof Error ? error.message : String(error)].join('\n'));
		}
	});
}

export function gitPreview(store: BrainStore): { status: ReturnType<typeof gitStatus>; files: string[] } {
	return { status: gitStatus(store), files: syncableFiles(store) };
}

export function pullOnStart(store: BrainStore): string {
	try {
		return store.writeLocked(() => {
			const status = gitStatus(store);
			if (status.state !== 'clean') return `Startup pull skipped: configuration is ${status.state}.`;
			if (!status.branch) return 'Startup pull skipped: detached HEAD.';
			try { git(store.configRoot, ['rev-parse', '--verify', '@{upstream}']); }
			catch { return 'Startup pull skipped: no upstream branch.'; }
			git(store.configRoot, ['-c', 'merge.autoStash=false', '-c', 'rebase.autoStash=false', 'pull', '--ff-only', '--no-rebase']);
			return 'Startup pull completed.';
		});
	} catch (error) {
		return `Startup pull failed; using local configuration: ${error instanceof Error ? error.message : String(error)}`;
	}
}
