import { AgentRunManifest, RenderContext } from './model';

export function defaultManifest(profile: string): AgentRunManifest {
	return {
		profile,
		kind: 'code',
		agent: {
			base: 'global/agents/code.md.njk',
			includes: ['{{ profile }}/local.md.njk']
		},
		skills: {
			install: ['commit-workflow', 'github-release', 'release-package-check', 'code-review-organizer']
		},
		tools: {
			codex: true,
			claude: true,
			gemini: true,
			grok: true
		},
		mcp: { servers: {} },
		checks: ['agent-run check .', 'pnpm run cleanbuild'],
		guardrails: {
			blockGitWrite: true,
			blockPublish: true,
			blockGithubRelease: true,
			forbidRepoAiFiles: true
		},
		paths: {
			changesFile: '{{ projectRoot }}/CHANGES',
			reviewDir: '{{ profileDir }}/reviews',
			reviewFile: '{{ profileDir }}/reviews/REVIEW-{{ date }}.md',
			memoriesDir: '{{ agentDir }}/memories',
			projectMemoryDir: '{{ profileDir }}/notes/memory'
		}
	};
}

function defaultRootManifest(): AgentRunManifest {
	const { profile: _profile, ...manifest } = defaultManifest('default/profile');
	return manifest;
}

export function stringifyRootDefaults(): string {
	return `${JSON.stringify(defaultRootManifest(), null, 2)}\n`;
}

export function defaultLocalTemplate(): string {
	return [
		'# {{ profile }} local agent instructions',
		'',
		'Project root:',
		'',
		'```text',
		'{{ projectRoot }}',
		'```',
		'',
		'Agent directory:',
		'',
		'```text',
		'{{ agentDir }}',
		'```',
		'',
		'Profile source directory:',
		'',
		'```text',
		'{{ profileDir }}',
		'```',
		'',
		'Add project-specific rules here.',
		''
	].join('\n');
}

export function defaultProjectMemoryIndex(): string {
	return [
		'# Project memory',
		'',
		'This directory contains durable notes for this project across agent sessions and machines.',
		'Keep the notes short, factual, and free of secrets. Link additional topic files from this index.',
		'',
		'## Files',
		'',
		'- Add project memory files here as they are needed.',
		''
	].join('\n');
}

export function defaultGlobalTemplates(): Map<string, string> {
	return new Map([
		['global/agents/code.md.njk', defaultCodeAgentTemplate()],
		['global/agents/writing.md.njk', defaultWritingAgentTemplate()],
		['global/snippets/git-rules.md.njk', defaultGitRulesSnippet()],
		['global/snippets/no-ai-files.md.njk', defaultNoAiFilesSnippet()],
		['global/snippets/verification.md.njk', defaultVerificationSnippet()],
		['global/tool-templates/codex-config.toml.njk', defaultCodexConfigTemplate()],
		['global/tool-templates/claude-settings.json.njk', defaultClaudeSettingsTemplate()],
		['global/tool-templates/gemini-settings.json.njk', defaultGeminiSettingsTemplate()],
		['global/tool-templates/grok-config.toml.njk', defaultGrokConfigTemplate()],
		['global/skills/commit-workflow/SKILL.md.njk', defaultCommitWorkflowSkill()],
		['global/skills/github-release/SKILL.md.njk', defaultGithubReleaseSkill()],
		['global/skills/release-package-check/SKILL.md.njk', defaultReleasePackageCheckSkill()],
		['global/skills/code-review-organizer/SKILL.md.njk', defaultCodeReviewOrganizerSkill()]
	]);
}

function defaultCodeAgentTemplate(): string {
	return [
		'# Code Agent',
		'',
		'Work in the project root shown by agent-run. Keep changes scoped to the user request.',
		'',
		'{% include "global/snippets/git-rules.md.njk" %}',
		'',
		'{% include "global/snippets/no-ai-files.md.njk" %}',
		'',
		'{% include "global/snippets/verification.md.njk" %}',
		''
	].join('\n');
}

function defaultWritingAgentTemplate(): string {
	return [
		'# Writing Agent',
		'',
		'Write clearly and preserve the existing voice, structure, and facts in the project.',
		'',
		'{% include "global/snippets/no-ai-files.md.njk" %}',
		''
	].join('\n');
}

function defaultGitRulesSnippet(): string {
	return [
		'## Git Rules',
		'',
		'Do not commit unless the user explicitly asks. Before committing, show changed files and the exact commit message.',
		'Use human commit messages unless the user asks for conventional commits. Do not push unless explicitly asked.',
		''
	].join('\n');
}

function defaultNoAiFilesSnippet(): string {
	return [
		'## Agent File Storage',
		'',
		'Do not create AGENTS.md, CLAUDE.md, GEMINI.md, .agents, .claude, .codex, .gemini, .grok, or other agent runtime files inside the project repository.',
		'Generated agent-only files belong under {{ paths.liveDir }}.',
		'Source config files belong under {{ profileDir }}.',
		''
	].join('\n');
}

function defaultVerificationSnippet(): string {
	return [
		'## Verification',
		'',
		'Run relevant checks before reporting completion. Configured checks:',
		'',
		'{% for check in checks %}',
		'- `{{ check }}`',
		'{% endfor %}',
		''
	].join('\n');
}

function defaultCommitWorkflowSkill(): string {
	return [
		'---',
		'name: commit-workflow',
		'description: Use for preparing or creating commits with explicit user approval.',
		'---',
		'',
		'# Commit Workflow',
		'',
		'Never commit unless explicitly asked. Before committing, show changed files and the exact commit message.',
		'Use human commit messages unless conventional commits are explicitly requested. Do not push.',
		'Run configured checks before committing:',
		'',
		'{% for check in checks %}',
		'- `{{ check }}`',
		'{% endfor %}',
		''
	].join('\n');
}

function defaultGithubReleaseSkill(): string {
	return [
		'---',
		'name: github-release',
		'description: Use for releases, version bumps, tags, publishing, GitHub Releases, and CHANGES updates.',
		'---',
		'',
		'# GitHub Release',
		'',
		'Use {{ paths.changesFile }} for change notes.',
		'Require confirmation before writing CHANGES, bumping versions, committing, tagging, pushing, publishing, or creating a GitHub Release.',
		'Follow `$commit-workflow` for release commits.',
		''
	].join('\n');
}

function defaultReleasePackageCheckSkill(): string {
	return [
		'---',
		'name: release-package-check',
		'description: Use before package releases and publish-ready changes to verify package metadata, release notes, lockfiles, workflows, git state, and agent-file hygiene.',
		'---',
		'',
		'# Release Package Check',
		'',
		'Use this skill instead of an external `repo-check` command.',
		'For package release or publish-ready work, verify the relevant package directory before finalizing:',
		'',
		'- The directory contains `package.json` and is inside a git repository.',
		'- The repository path follows `<org>/<repo>`, and `package.json.name` is `@<org>/<package-dir-name>`.',
		'- `package.json.version`, `package.json.license`, and `package.json.copyright` are present and non-empty.',
		'- A package-local `LICENSE` file exists and contains the exact copyright string from `package.json.copyright`.',
		'- A package-local `CHANGES` file exists.',
		'- The first `Version ...` line in `CHANGES` matches `Version <package.json.version> (<YYYY-MM-DD>)`.',
		'- The year in the top `CHANGES` version line appears in `package.json.copyright`.',
		'- The git `origin` remote matches `<org>/<repo>`.',
		'- The current branch has an upstream configured and is in sync with it after fetching.',
		'- The repository does not contain agent files or directories such as `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `codex.md`, `.claude`, `.codex`, `.gemini`, or `.grok`.',
		'- The repository root has a lockfile: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lockb`, or `bun.lock`.',
		'- Every GitHub Actions `uses:` reference is pinned to a full commit SHA.',
		'- The pinned `actions/setup-node` release is v6-compatible and workflows use `node-version: 24`.',
		'- GitHub workflows do not reference `node20` or `node22`.',
		'- The git working tree is clean for files under the checked package directory.',
		'- If files beyond `CHANGES` changed in the checked package directory, that package `CHANGES` file is also changed.',
		'',
		'Run the configured checks after this checklist:',
		'',
		'{% for check in checks %}',
		'- `{{ check }}`',
		'{% endfor %}',
		''
	].join('\n');
}

function defaultCodeReviewOrganizerSkill(): string {
	return [
		'---',
		'name: code-review-organizer',
		'description: Use for organizing code review findings, review files, and review follow-up state.',
		'---',
		'',
		'# Code Review Organizer',
		'',
		'On review startup, move any files from {{ paths.liveDir }}/reviews into {{ paths.reviewDir }} so review history persists outside the ephemeral live directory.',
		'Before doing any code review, read the generated AGENTS.md file and the current consolidated review file: {{ paths.reviewConsolidatedFile }}.',
		'Save each active review to {{ paths.reviewDir }}/yyyy-mm-dd-[sequence].md, where the sequence increments for multiple reviews on the same date.',
		'Whenever a saved review is created or changed, update {{ paths.reviewConsolidatedFile }} with the consolidated current review findings.',
		'In {{ paths.reviewConsolidatedFile }}, include each active finding with its review date and source review filename.',
		'When a finding is fixed, remove it from {{ paths.reviewConsolidatedFile }} and move it to {{ paths.reviewDir }}/DONE.md with the time it was fixed.',
		'When a finding is intentionally not fixed, remove it from {{ paths.reviewConsolidatedFile }} and move it to {{ paths.reviewDir }}/DONE.md with the time it was marked intentional and a note that it was intentionally left as-is.',
		'When a dated review file has no remaining active findings, delete it.',
		'Also include active findings in the final user-facing reply.',
		'Do not save review files inside the project repo.',
		'Before the final reply for review work, verify that no REVIEW*.md files exist in {{ projectRoot }}, active dated review files exist only when they still contain active findings, and the consolidated REVIEW.md file was updated.',
		''
	].join('\n');
}

export function defaultToolInstructionsTemplate(isClaude: boolean): string {
	return [
		`# Generated ${isClaude ? 'Claude' : 'agent'} instructions for {{ profile }}`,
		'',
		'Do not edit this file directly. Profile source and optional overrides live under:',
		'',
		'```text',
		'{{ profileDir }}',
		'```',
		'',
		'{% for section in renderedAgentSections %}',
		'{{ section }}',
		'',
		'{% endfor %}',
		'## Absolute Paths',
		'',
		'Project root:',
		'',
		'```text',
		'{{ projectRoot }}',
		'```',
		'',
		'Agent directory:',
		'',
		'```text',
		'{{ agentDir }}',
		'```',
		'',
		'Profile source directory:',
		'',
		'```text',
		'{{ profileDir }}',
		'```',
		'',
		'Review directory:',
		'',
		'```text',
		'{{ paths.reviewDir }}',
		'```',
		'',
		"Today's review file:",
		'',
		'```text',
		'{{ paths.reviewFile }}',
		'```',
		'',
		'Consolidated review file:',
		'',
		'```text',
		'{{ paths.reviewConsolidatedFile }}',
		'```',
		'',
		'Memories directory:',
		'',
		'```text',
		'{{ paths.memoriesDir }}',
		'```',
		'',
		'Project memory directory:',
		'',
		'```text',
		'{{ paths.projectMemoryDir }}',
		'```',
		'',
		'Native Codex memory directory:',
		'',
		'```text',
		'{{ paths.nativeMemoryDir }}',
		'```',
		'',
		'Global memory directory:',
		'',
		'```text',
		'{{ paths.globalMemoryDir }}',
		'```',
		'',
		'Changes file:',
		'',
		'```text',
		'{{ paths.changesFile }}',
		'```',
		'',
		'## Available Skills',
		'',
		'{% for skill in skills %}',
		'- `${{ skill.name }}`{% if skill.description %}: {{ skill.description }}{% endif %}',
		'{% endfor %}',
		'',
		'## Tool Note',
		'',
		isClaude
			? 'Claude receives {{ agentDir }}/CLAUDE.md through `--append-system-prompt-file` and loads generated skills as a local plugin.'
			: 'Codex, Gemini, and Grok load this canonical AGENTS.md content from their private agent-run runtimes.',
		'',
		'## Mandatory Path Rule',
		'',
		'Do not create AGENTS.md, CLAUDE.md, GEMINI.md, .agents, .claude, .codex, .gemini, .grok, or AI-related files inside the project repository.',
		'Generated agent-only files must be stored under the agent directory shown above.',
		'Source config files must be stored under the profile source directory shown above.',
		''
	].join('\n');
}

function defaultCodexConfigTemplate(): string {
	return [
		'# Generated by agent-run. Do not edit directly.',
		'',
		'project_doc_max_bytes = 65536',
		'approval_policy = "on-request"',
		'sandbox_mode = "workspace-write"',
		'',
		'[sandbox_workspace_write]',
		'writable_roots = [',
		'  {{ projectRoot | dump }},',
		'  {{ paths.reviewDir | dump }},',
		'  {{ paths.memoriesDir | dump }},',
		'  {{ paths.projectMemoryDir | dump }}',
		']',
		'network_access = false',
		''
	].join('\n');
}

function defaultClaudeSettingsTemplate(): string {
	const envBlock = [
		'  "env": {',
		'    "AGENT_DIR": {{ agentDir | dump }},',
		'    "AGENT_PROFILE_DIR": {{ profileDir | dump }},',
		'    "AGENT_RUN_PROJECT_ROOT": {{ projectRoot | dump }},',
		'    "AGENT_PROJECT_MEMORY_DIR": {{ paths.projectMemoryDir | dump }},',
		'    "AGENT_GLOBAL_MEMORY_DIR": {{ paths.globalMemoryDir | dump }}',
		'  }'
	].join('\n');
	return [
		'{% if permissionsAllow.length %}{',
		envBlock + ',',
		'  "permissions": {',
		'    "allow": {{ permissionsAllow | dump }}',
		'  }',
		'}',
		'{% else %}{',
		envBlock,
		'}',
		'{% endif %}'
	].join('\n');
}

function defaultGeminiSettingsTemplate(): string {
	return [
		'{',
		'  "general": {',
		'    "enableAutoUpdate": true',
		'  }',
		'}',
		''
	].join('\n');
}

function defaultGrokConfigTemplate(): string {
	return ['# Generated by agent-run. Do not edit directly.', ''].join('\n');
}

export function defaultCodexConfigContent(context: RenderContext): string {
	return [
		'# Generated by agent-run. Do not edit directly.',
		'',
		'project_doc_max_bytes = 65536',
		'approval_policy = "on-request"',
		'sandbox_mode = "workspace-write"',
		'',
		'[sandbox_workspace_write]',
		'writable_roots = [',
		`  ${JSON.stringify(context.projectRoot)},`,
		`  ${JSON.stringify(context.paths.reviewDir)},`,
		`  ${JSON.stringify(context.paths.memoriesDir)},`,
		`  ${JSON.stringify(context.paths.projectMemoryDir)}`,
		']',
		'network_access = false',
		''
	].join('\n');
}

export function defaultClaudeSettingsContent(context: RenderContext): string {
	const settings: Record<string, unknown> = {
		env: {
			AGENT_DIR: context.agentDir,
			AGENT_PROFILE_DIR: context.profileDir,
			AGENT_RUN_PROJECT_ROOT: context.projectRoot,
			AGENT_PROJECT_MEMORY_DIR: context.paths.projectMemoryDir,
			AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir
		}
	};
	if (context.permissionsAllow.length > 0) {
		settings.permissions = { allow: context.permissionsAllow };
	}
	return `${JSON.stringify(settings, null, 2)}\n`;
}

export function defaultGeminiSettingsContent(_context: RenderContext): string {
	return `${JSON.stringify({ general: { enableAutoUpdate: true } }, null, 2)}\n`;
}

export function defaultGrokConfigContent(): string {
	return '# Generated by agent-run. Do not edit directly.\n';
}

export function legacyDefaultClaudeSettingsContent(context: RenderContext, agentDir: string): string {
	return `${JSON.stringify(
		{
			env: {
				AGENT_DIR: agentDir,
				AGENT_RUN_PROJECT_ROOT: context.projectRoot,
				AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir
			}
		},
		null,
		2
	)}\n`;
}
