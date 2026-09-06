# agent-run

**Config once. Run with any native coding agent.**

`agent-run` lets you manage Codex, Claude Code, Gemini CLI, and Grok Build from
one shared configuration system while continuing to use each vendor's native
agent.

Keep agent configuration in a separate Git repository instead of adding
agent-specific files to every codebase. Define project instructions, skills,
MCP servers, policies, and reusable configuration fragments once, then generate
the native configuration each agent expects.

Configuration is template-based using Nunjucks/Jinja-style templates, making it
easy to build hierarchical setups from global defaults, organization rules,
project-specific settings, reusable fragments, and local overrides.

`agent-run` generates isolated agent runtimes outside the source repository, so
application repositories remain clean and developers do not have to maintain
separate `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, skills, and tool configuration
for every agent.

The core idea is simple:

**One configuration repository. One set of skills. Multiple native agents.**

```text
shared config repository
        ↓
global + project + local templates
        ↓
canonical instructions / skills / MCP
        ↓
agent-specific generated runtime
        ↓
Codex | Claude Code | Gemini CLI | Grok Build
```

The native agents remain native. `agent-run` does not replace their execution
engines, authentication, models, or tooling. It provides the portable
configuration layer around them.

**Config once, run anywhere.**

## Model

There are three things:

- the source tree
- the agent config tree
- this `agent-run` wrapper

Example:

```text
~/.agent-run/
  agent-run.defaults.jsonc
  org/
    my-api/
      agent-run.jsonc
      local.md.njk       # optional
      overrides/         # optional
      notes/
        memory/
          README.md      # durable project memory, normally tracked
      live/
        CLAUDE.md
        .claude/         # Claude settings, MCP, and skills
        bin/
        memories/
          codex-home/
            AGENTS.md
            config.toml
            memories/    # native Codex memory, local generated state
            skills/
        gemini/
          AGENTS.md
          settings.json
          home/          # private Gemini state and generated skills
        grok/
          AGENTS.md
          config.toml
          skills/
~/source/org/my-api/
```

If your source repo is `~/source/org/my-api`, `agent-run` maps it to:

```text
~/.agent-run/org/my-api
```

The source repo stays clean. The agent files live in the matching path under
the agent config tree.

## File Roles

- `agent-run.defaults.jsonc`: config-root defaults shared by every profile
- `agent-run.jsonc`: sparse profile manifest and profile-discovery marker
- `local.md.njk`: optional project-specific instructions
- `overrides/`: optional per-profile template overrides
- `notes/memory/`: durable project memory shared through the config repository
- `live/memories/codex-home/AGENTS.md`: generated Codex instructions
- `live/memories/codex-home/config.toml`: generated Codex config
- `live/memories/codex-home/skills/`: generated Codex skills
- `live/CLAUDE.md`: generated Claude instructions
- `live/.claude/`: generated Claude settings, MCP configuration, and local
  plugin skills
- `live/gemini/`: generated Gemini instructions, settings, skills, and private
  runtime state
- `live/grok/`: generated Grok instructions, configuration, skills, and private
  runtime state

Edit only the root defaults and profile overrides that differ. `agent-run` keeps
generated files in sync.

## Native Agent Adapters

Each supported CLI is isolated behind an adapter in `src/agents/`. The shared
flow is:

```text
profile and templates
        ↓
canonical instructions, skills, and MCP servers
        ↓
Codex | Claude | Gemini | Grok adapter
        ↓
private generated runtime
        ↓
native vendor CLI in the real project directory
```

Codex, Gemini, and Grok receive the same generated `AGENTS.md` content. Claude
receives a thin `CLAUDE.md` serialization of those same canonical instruction
sections. Vendor-specific paths, settings formats, environment variables, and
launch flags stay inside the matching adapter.

## Manifest Defaults

Manifest values are resolved in this order:

1. built-in defaults
2. `<config-root>/agent-run.defaults.jsonc`
3. `<config-root>/<profile>/agent-run.jsonc`

Nested manifest objects are merged. Arrays such as `checks`, `agent.includes`,
and `skills.install` replace the inherited array instead of being appended.
The profile name is always inferred from project mapping; the root defaults file
must not set `profile`.

A profile with no differences from the root defaults needs only this marker:

```json
{}
```

Enable or disable native agents under `tools`:

```json
{
  "tools": {
    "codex": true,
    "claude": true,
    "gemini": true,
    "grok": true
  }
}
```

MCP servers have one canonical manifest representation. A server uses either a
local command or a remote URL:

```json
{
  "mcp": {
    "servers": {
      "local-tools": {
        "command": "node",
        "args": ["/opt/team-mcp/server.js"],
        "env": {
          "TEAM": "docs"
        }
      },
      "remote-tools": {
        "transport": "http",
        "url": "https://mcp.example.com/mcp",
        "enabled": true
      }
    }
  }
}
```

`transport` may be `stdio`, `http`, or `sse`; it is inferred as `stdio` when
`command` is present and `http` otherwise. The adapters serialize enabled
servers into each CLI's native MCP format. Disabled servers remain disabled in
Codex and Grok and are omitted from Claude and Gemini.

`local.md.njk` and `overrides/` are not created unless they contain actual
profile-specific configuration.

## Profile Resolution

The mapped path is:

```text
<config-root>/<profile>
```

`profile` is resolved in this order:

1. `AGENT_RUN_PROFILE` in `.agent-run.env`
2. GitHub `origin` remote
3. `package.json.repository` (string or object `url`)
4. `package.json.name`
5. the project path as `[parent]/[current]`

Examples:

- `AGENT_RUN_PROFILE=org/my-api` -> `org/my-api`
- `AGENT_RUN_PROFILE=unrelated/hello` -> `unrelated/hello`
- `package.json.repository = "github:org/my-api"` -> `org/my-api`
- `package.json.name = "@org/my-api"` -> `org/my-api`
- `package.json.name = "my-api"` -> `my-api`
- `/work/org/my-api` with none of the above -> `org/my-api`

`AGENT_RUN_PROFILE` is relative to the config root. It is not a filesystem
path, so values like `/tmp/foo`, `C:/tmp/foo`, or `../foo` are rejected.

The path fallback lets plain directories work without a Git repository or a
`package.json`. The explicit profile sources above always take precedence.

## Overrides

Local override for a repo:

```dotenv
# .agent-run.env
AGENT_RUN_PROFILE=org/my-api
```

Config root:

- default: `~/.agent-run`
- override with `--configdir=/path/to/agent-configs`
- override with `AGENT_CONFIG_DIR=/path/to/agent-configs`
- or set `AGENT_CONFIG_DIR=/path/to/agent-configs` in `.agent-run.env`

## Commands

Global flag:

- `-h`, `--help`: show wrapper help for `agent-run` and the built-in commands
- `-v`, `--verbose`: print path resolution, file creation, include expansion,
  generated file writes, and spawned commands

`agent-run codex --help`, `agent-run claude --help`, `agent-run gemini --help`,
and `agent-run grok --help` pass `--help` through to the underlying tool.

For any native agent command, use `--generate` to generate profile files
without launching the underlying tool.

Codex defaults to `-a on-request -s workspace-write`. `agent-run` sets
`CODEX_HOME` under the private agent directory, where Codex discovers the
generated `AGENTS.md`, `config.toml`, and skills natively. It starts Codex from
that private directory, passes the project root with `-C`, and keeps generated
guard shims on `PATH`. Use `--network` to enable network access in the
workspace-write sandbox.
When `~/.codex/auth.json` exists, profile-specific Codex homes link their
`auth.json` to that shared login cache so changing profiles does not require a
new ChatGPT login.

### Project Memory

Each profile has a durable `notes/memory/` directory outside the source repo.
`README.md` is a short index; agents read only the linked files relevant to the
current task. Agents may update project memory only when the user explicitly
asks them to remember or update something for that project.

Codex's native `$CODEX_HOME/memories/` remains under ignored `live/` state. It
is generated, machine-local recall data and is not copied into the tracked
project memory directory. Project memory is plain Markdown so it can be
reviewed and shared through the Git repository that normally holds the
`.agent-run` config tree.

When a profile still uses `memory/`, loose `memory*.md` files, or Markdown files
directly under the old `memories/` directory, agent-run detects the old layout
before updating or launching an agent. If those files are tracked, agent-run
shows the moves and asks before staging them with `git mv`. In a non-Git config
tree, or for untracked files, it uses ordinary filesystem moves. Non-interactive
runs stop with a command that can confirm the migration explicitly.

Claude Code currently has no `--cd` equivalent. `agent-run` keeps Claude's
process cwd at the project root, appends the generated `CLAUDE.md` with
`--append-system-prompt-file`, passes generated settings with `--settings`, and
loads generated skills from a local plugin with `--plugin-dir`. It does not
replace the user's normal `CLAUDE_CONFIG_DIR`. If Claude writes remembered
permissions to `.claude/settings.local.json`, `agent-run` removes that file
after the session unless `--local` was used.

Gemini runs from the real project directory with a private
`GEMINI_CLI_HOME`. Its generated system settings configure `AGENTS.md` as the
context filename and add the private runtime plus project memory as context
directories. Generated skills use Gemini's `.agents/skills` alias. Existing
Gemini user settings, login credentials, commands, and user skills are linked
into the private home when present; generated system settings remain the
highest-priority project layer.

Grok runs from the real project directory with `GROK_HOME` set to
`live/grok/`. Grok natively reads the generated home-level `AGENTS.md`,
`config.toml`, and `skills/`. Existing Grok login and MCP OAuth credential
files are linked into the private runtime when present.

`--yolo` runs the selected tool unattended, with no approval prompts: Codex
with `-a never -s danger-full-access`, Claude with
`--dangerously-skip-permissions`, Gemini with `--yolo`, and Grok with
`--always-approve`.
Only use it when the agent may change or delete anything it can reach. Claude
refuses `--dangerously-skip-permissions` when it runs as root, so run it as a
normal user. `--sandboxed` selects the native workspace sandbox for Codex,
Gemini, or Grok. `--network` remains Codex-only.

By default, all four native agent commands fail when local AI files such as
`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.mcp.json`, `.agents`, `.claude`,
`.codex`, `.gemini`, or `.grok` are present inside the project repository. Use
`--local` to warn and continue for a specific invocation.

Show the native capability matrix:

```sh
agent-run status
```

Initialize mapped files for the current repo:

```sh
agent-run generate
```

This creates `<config-root>/agent-run.defaults.jsonc` when needed and a minimal
`agent-run.jsonc` marker for the mapped profile. It does not create empty local
instruction or override files. `agent-run init` remains as a deprecated alias.

Edit the source file for the current repo:

```sh
agent-run edit
```

This creates `local.md.njk` when needed, syncs generated files, then opens it in
your editor.

Regenerate the generated files for the current repo:

```sh
agent-run update
```

`update` requires an existing profile marker or local/legacy instruction file;
it does not silently scaffold an unconfigured project. Use `agent-run generate` or
the tool command's `--create` option first.

Regenerate every profile under the config root without requiring matching code
checkouts:

```sh
agent-run update --all ~/.agent-run
```

If the config root argument is omitted, `update --all` uses the normal configured
root. Without an override, the root is `$HOME/.agent-run`.

You can also generate from a tool command and stop before launch:

```sh
agent-run codex --generate
agent-run claude --generate
agent-run gemini --generate
agent-run grok --generate
```

This reads the root defaults, sparse profile manifest, and Nunjucks templates,
then rewrites generated files:

- `live/CLAUDE.md`
- `live/memories/codex-home/AGENTS.md`
- `live/memories/codex-home/config.toml`
- `live/memories/codex-home/skills/**`
- `live/.claude/**`
- `live/gemini/**`
- `live/grok/**`
- `live/bin/**`

Per-profile override templates can be placed in:

- `overrides/codex-config.toml.njk`
- `overrides/claude-settings.json.njk`
- `overrides/gemini-settings.json.njk`
- `overrides/grok-config.toml.njk`

## Default Config Tree

A complete default tree lives in `examples/basic-config`. It includes a minimal
project, `.agent-run.env`, root manifest defaults, global templates and
snippets, profile-local templates, skill templates, a personal memory skill,
profile skill overrides, tool config overrides, guardrails, checks, and
generated runtime paths.

To install the default tree and detected profile in your resolved config root:

```sh
agent-run setup
```

Or select a profile non-interactively:

```sh
agent-run setup myorg/myrepo
```

Use `--configdir=DIR` to choose a different destination. The copy skips files
that already exist, so local edits are preserved.

Try it from a checkout:

```sh
pnpm build
node dist/agent-run.js update examples/basic-config/project
node dist/agent-run.js check examples/basic-config/project
```

Check the current repo:

```sh
agent-run check
```

This reports:

- local AI files accidentally present in the source repo
- missing mapped files
- stale generated instructions, settings, MCP configuration, or skills for any
  enabled native agent
- invalid generated JSON or skill metadata
- profile resolution problems

Check every repo under a source tree:

```sh
agent-run check --all ~/source
```

Migrate an existing config tree to the manifest/template layout:

```sh
agent-run migrate-config --yes ~/.agent-run
```

This preserves `AGENTS-MODS.md`, creates `local.md.njk` and a sparse
`agent-run.jsonc` marker for legacy profiles, creates the root defaults and
`global/` templates, moves loose review files into `reviews/`, moves loose
project memory files into each profile's `notes/memory/`, and moves old Codex
runtime files into `live/memories/codex-home` without overwriting existing
files. Use `--yes` to confirm tracked `git mv` operations in a non-interactive
run. Omit `--yes` to review and confirm tracked moves interactively. The
command stages moves but never commits them.

## Systemd Jobs

The repo includes optional systemd units for keeping global AI tooling current.

Install the global AI tools updater:

```sh
sudo scripts/install-systemd-jobs.sh --ai-tools
```

This installs and enables `ai-tools-update.timer`, which runs hourly. The
updater uses `/usr/local/bin/npm`, `/usr/local/bin/node`, and
`/usr/local/bin/pnpm`, keeps global Node packages under `/usr/local`, and does
not delete command shims during recurring runs. It updates this fixed list of
Node packages with npm:

```text
npm, pnpm, corepack, fallow, ripgrep, pm2, tsx, typescript,
@openai/codex, @anthropic-ai/claude-code, @google/gemini-cli,
@xai-official/grok, and @technomoron/agent-run
```

The optional apt package list still defaults to `gh` and can be changed with
`AI_TOOLS_APT_PACKAGES`.

## Login Warning

For user-owned machines, `scripts/agent-config-login-warning.sh` can be called
from a shell startup file to print a large warning when `~/.agent-config` is a
dirty git checkout:

```csh
if ( -x "$HOME/bin/agent-config-login-warning" ) then
    "$HOME/bin/agent-config-login-warning"
endif
```

The helper only reads the git status and exits quietly when the checkout is
clean or absent. Set `AGENT_CONFIG_TARGET` before calling it to check a
different config tree.

## Install

```sh
npm install -g @technomoron/agent-run
```

## Release

Releases publish from GitHub Actions, not from a local `npm publish`.

After updating `package.json` and `CHANGES`, run:

```sh
pnpm release
```

This validates the repo, creates the annotated tag matching the package version,
and pushes that tag to `origin`. The tag push triggers the release workflow,
which verifies, packs, publishes to npm, and creates the GitHub release.
