"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_GLOBAL_TEMPLATES = exports.GENERATED_GITIGNORE_ENTRIES = exports.LOCAL_AI_DIRECTORY_NAMES = exports.LOCAL_AI_FILE_NAMES = exports.UNEXPANDED_TEMPLATE_RE = exports.PACKAGE_VERSION = exports.VERBOSE_ENV = exports.CONFIG_DIR_ENV = exports.CONFIG_ROOT_OVERRIDE_ENV = exports.LIVE_DIR_NAME = exports.LOCAL_TEMPLATE_FILE_NAME = exports.MANIFEST_FILE_NAME = exports.CONFIG_ROOT_DEFAULTS_FILE_NAME = exports.IGNORE_FILE_NAME = exports.ENV_FILE_NAME = exports.IS_WINDOWS = void 0;
exports.IS_WINDOWS = process.platform === 'win32';
exports.ENV_FILE_NAME = '.agent-run.env';
exports.IGNORE_FILE_NAME = '.agent-run-ignore';
exports.CONFIG_ROOT_DEFAULTS_FILE_NAME = 'agent-run.defaults.jsonc';
exports.MANIFEST_FILE_NAME = 'agent-run.jsonc';
exports.LOCAL_TEMPLATE_FILE_NAME = 'local.md.njk';
exports.LIVE_DIR_NAME = 'live';
exports.CONFIG_ROOT_OVERRIDE_ENV = 'AGENT_RUN_CONFIG_ROOT_OVERRIDE';
exports.CONFIG_DIR_ENV = 'AGENT_CONFIG_DIR';
exports.VERBOSE_ENV = 'AGENT_RUN_VERBOSE';
exports.PACKAGE_VERSION = '0.99.25';
exports.UNEXPANDED_TEMPLATE_RE = /\{\{[^}]+\}\}|\{%[^%]+%\}/;
exports.LOCAL_AI_FILE_NAMES = new Set([
    'AGENTS.md',
    'AGENTS-MODS.md',
    'AGENTS.override.md',
    'CLAUDE.md',
    'CLAUDE.local.md',
    '.mcp.json',
    'codex.md'
]);
exports.LOCAL_AI_DIRECTORY_NAMES = new Set(['.agents', '.claude', '.codex']);
exports.GENERATED_GITIGNORE_ENTRIES = [
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
exports.REQUIRED_GLOBAL_TEMPLATES = [
    'global/agents/code.md.njk',
    'global/agents/writing.md.njk',
    'global/snippets/git-rules.md.njk',
    'global/snippets/no-ai-files.md.njk',
    'global/snippets/verification.md.njk',
    'global/tool-templates/codex-config.toml.njk',
    'global/tool-templates/claude-settings.json.njk',
    'global/skills/commit-workflow/SKILL.md.njk',
    'global/skills/github-release/SKILL.md.njk',
    'global/skills/release-package-check/SKILL.md.njk',
    'global/skills/code-review-organizer/SKILL.md.njk'
];
