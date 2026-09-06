export const IS_WINDOWS = process.platform === 'win32';
export const ENV_FILE_NAME = '.agent-run.env';
export const IGNORE_FILE_NAME = '.agent-run-ignore';
export const CONFIG_ROOT_DEFAULTS_FILE_NAME = 'agent-run.defaults.jsonc';
export const MANIFEST_FILE_NAME = 'agent-run.jsonc';
export const LOCAL_TEMPLATE_FILE_NAME = 'local.md.njk';
export const LIVE_DIR_NAME = 'live';
export const CONFIG_ROOT_OVERRIDE_ENV = 'AGENT_RUN_CONFIG_ROOT_OVERRIDE';
export const CONFIG_DIR_ENV = 'AGENT_CONFIG_DIR';
export const VERBOSE_ENV = 'AGENT_RUN_VERBOSE';
export const PACKAGE_VERSION = '0.99.30';
export const UNEXPANDED_TEMPLATE_RE = /\{\{[^}]+\}\}|\{%[^%]+%\}/;

export const LOCAL_AI_FILE_NAMES = new Set([
	'AGENTS.md',
	'AGENTS-MODS.md',
	'AGENTS.override.md',
	'CLAUDE.md',
	'CLAUDE.local.md',
	'GEMINI.md',
	'.mcp.json',
	'codex.md'
]);

export const LOCAL_AI_DIRECTORY_NAMES = new Set(['.agents', '.claude', '.codex', '.gemini', '.grok']);

export const BRAIN_GITIGNORE_ENTRIES = [
	'# Disposable brain state and local credentials',
	'/index/',
	'/runtime/',
	'/cache/',
	'/secrets/',
	'*.sock',
	''
];

export const GENERATED_GITIGNORE_ENTRIES = [
	'# Generated agent-run live profiles',
	'**/live/',
	'',
	'# Optional generated caches',
	'**/.agent-run-cache/',
	'',
	'# Legacy Codex runtime state',
	'**/auth.json',
	'**/history.jsonl',
	'**/sessions/',
	'**/archived_sessions/',
	'**/log/',
	'**/logs/',
	'**/shell_snapshots/',
	'**/*.sqlite*',
	'**/models_cache.json',
	'**/cache/',
	'**/.tmp/',
	'**/installation_id',
	'**/version.json',
	'**/.personality_migration',
	'**/skills/.system/'
];

export const REQUIRED_GLOBAL_TEMPLATES = [
	'global/agents/code.md.njk',
	'global/agents/writing.md.njk',
	'global/snippets/git-rules.md.njk',
	'global/snippets/no-ai-files.md.njk',
	'global/snippets/verification.md.njk',
	'global/tool-templates/codex-config.toml.njk',
	'global/tool-templates/claude-settings.json.njk',
	'global/tool-templates/gemini-settings.json.njk',
	'global/tool-templates/grok-config.toml.njk',
	'global/skills/commit-workflow/SKILL.md.njk',
	'global/skills/github-release/SKILL.md.njk',
	'global/skills/release-package-check/SKILL.md.njk',
	'global/skills/code-review-organizer/SKILL.md.njk'
];
