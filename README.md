# agent-run

Small wrapper for AI coding CLIs like Codex and Claude.

It keeps agent files out of normal repos and stores them in a separate
agent config tree. By default, that tree lives beside owner/repo checkouts
under the same code root.

## Model

There are three things:

- the source tree
- the agent config tree
- this `agent-run` wrapper

Example:

```text
~/source/
  agent-config/
    agent-run.defaults.jsonc
    org/
      my-api/
        agent-run.jsonc
        local.md.njk       # optional
        overrides/         # optional
        live/
          CLAUDE.md
          .claude/
          bin/
          memories/
            codex-home/
              AGENTS.md
              config.toml
              skills/
  org/
    my-api/
```

If your source repo is `~/source/org/my-api`, `agent-run` maps it to:

```text
~/source/agent-config/org/my-api
```

The source repo stays clean. The agent files live in the matching path under
the agent config tree.

## File Roles

- `agent-run.defaults.jsonc`: config-root defaults shared by every profile
- `agent-run.jsonc`: sparse profile manifest and profile-discovery marker
- `local.md.njk`: optional project-specific instructions
- `overrides/`: optional per-profile template overrides
- `live/memories/codex-home/AGENTS.md`: generated Codex instructions
- `live/memories/codex-home/config.toml`: generated Codex config
- `live/memories/codex-home/skills/`: generated Codex skills
- `live/CLAUDE.md`: generated Claude instructions
- `live/.claude/`: generated Claude settings and local plugin skills

Edit only the root defaults and profile overrides that differ. `agent-run` keeps
generated files in sync.

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
3. `package.json.name`
4. the project path as `[parent]/[current]`

Examples:

- `AGENT_RUN_PROFILE=org/my-api` -> `org/my-api`
- `AGENT_RUN_PROFILE=unrelated/hello` -> `unrelated/hello`
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

- default for a project at `[code]/owner/repo`: `[code]/agent-config`
- override with `--config-root /path/to/agent-configs`
- override with `AGENT_CONFIG_DIR=/path/to/agent-configs`
- override with `AGENT_CONFIG_ROOT=/path/to/agent-configs`
- or set `AGENT_CONFIG_DIR=/path/to/agent-configs` or `AGENT_CONFIG_ROOT=/path/to/agent-configs` in `.agent-run.env`

For commands without a project root, `agent-run` looks for an existing config
root in these locations:

- Windows: `~/Documents/code/agent-config`, `~/Documents/code/agent-configs`,
  `~/Desktop/code/agent-config`, `~/Desktop/code/agent-configs`,
  `C:\code\agent-config`, `C:\code\agent-configs`
- Unix: `~/code/agent-config`, `~/code/agent-configs`, `~/agent-config`,
  `~/agent-configs`, `~/.agent-config`, `~/.agent-configs`

## Commands

Global flag:

- `-h`, `--help`: show wrapper help for `agent-run` and the built-in commands
- `-v`, `--verbose`: print path resolution, file creation, include expansion,
  generated file writes, and spawned commands

`agent-run codex --help` and `agent-run claude --help` still pass `--help`
through to the underlying tool.

For `codex` and `claude`, use `--generate` to generate profile files without
launching the underlying tool.

Codex defaults to `-a on-request -s workspace-write`. `agent-run` sets
`CODEX_HOME` under the private agent directory, where Codex discovers the
generated `AGENTS.md`, `config.toml`, and skills natively. It starts Codex from
that private directory, passes the project root with `-C`, and keeps generated
guard shims on `PATH`. Use `--network` to enable network access in the
workspace-write sandbox.
When `~/.codex/auth.json` exists, profile-specific Codex homes link their
`auth.json` to that shared login cache so changing profiles does not require a
new ChatGPT login.

Claude Code currently has no `--cd` equivalent. `agent-run` keeps Claude's
process cwd at the project root, appends the generated `CLAUDE.md` with
`--append-system-prompt-file`, passes generated settings with `--settings`, and
loads generated skills from a local plugin with `--plugin-dir`. It does not
replace the user's normal `CLAUDE_CONFIG_DIR`. If Claude writes remembered
permissions to `.claude/settings.local.json`, `agent-run` removes that file
after the session unless `--local` was used.

`--yolo` runs either tool unattended, with no approval prompts: Codex with
`-a never -s danger-full-access`, Claude with `--dangerously-skip-permissions`.
Only use it when the agent may change or delete anything it can reach. Claude
refuses `--dangerously-skip-permissions` when it runs as root, so run it as a
normal user. `--sandboxed` and `--network` stay Codex-only because Claude has no
matching sandbox.

By default, `agent-run codex` and `agent-run claude` fail when local AI files
such as `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`, `.agents`,
`.claude`, or `.codex` are present inside the project repository. Use `--local`
to warn and continue for a specific invocation.

Initialize mapped files for the current repo:

```sh
agent-run init
```

This creates `<config-root>/agent-run.defaults.jsonc` when needed and a minimal
`agent-run.jsonc` marker for the mapped profile. It does not create empty local
instruction or override files.

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
it does not silently scaffold an unconfigured project. Use `agent-run init` or
the tool command's `--create` option first.

Regenerate every profile under the config root without requiring matching code
checkouts:

```sh
agent-run update --all ~/.agent-config
```

If the config root argument is omitted, `update --all` uses the normal configured
root. Without a project path, that falls back to `$HOME/.agent-config`; for
project commands, the default is `[code]/agent-config`.

You can also generate from a tool command and stop before launch:

```sh
agent-run codex --generate
agent-run claude --generate
```

This reads the root defaults, sparse profile manifest, and Nunjucks templates,
then rewrites generated files:

- `live/CLAUDE.md`
- `live/memories/codex-home/AGENTS.md`
- `live/memories/codex-home/config.toml`
- `live/memories/codex-home/skills/**`
- `live/.claude/**`
- `live/bin/**`

Per-profile override templates can be placed in:

- `overrides/codex-config.toml.njk`
- `overrides/claude-settings.json.njk`

## Starter Config

A complete starter lives in `examples/basic-config`. It includes a minimal
project, `.agent-run.env`, root manifest defaults, global templates and
snippets, profile-local templates, skill templates, a personal memory skill,
profile skill overrides, tool config overrides, guardrails, checks, and
generated runtime paths.

To create the packaged starter agent files in your resolved config root:

```sh
agent-run setup
```

Or choose a destination:

```sh
agent-run setup ~/.agent-config
```

The copy skips files that already exist, so local edits are preserved.

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
- stale generated Codex instructions or config
- invalid `CLAUDE.md`
- profile resolution problems

Check every repo under a source tree:

```sh
agent-run check --all ~/source
```

Migrate an existing config tree to the manifest/template layout:

```sh
agent-run migrate-config ~/.agent-config
```

This preserves `AGENTS-MODS.md`, creates `local.md.njk` and a sparse
`agent-run.jsonc` marker for legacy profiles, creates the root defaults and
`global/` templates, moves loose review files into `reviews/`, moves loose
`memory*.md` files into `memories/`, and moves old Codex runtime files into
`live/memories/codex-home` without overwriting existing files.

## Systemd Jobs

The repo includes optional systemd units for keeping global AI tooling current.

Install the global AI tools updater:

```sh
sudo scripts/install-systemd-jobs.sh --ai-tools
```

This installs and enables `ai-tools-update.timer`, which runs hourly. The
package list is configurable through systemd environment overrides:

```text
AI_TOOLS_NPM_PACKAGES="npm@latest pnpm@latest corepack@latest fallow@latest ripgrep@latest pm2@latest tsx@latest typescript@latest @openai/codex@latest @anthropic-ai/claude-code@latest @technomoron/agent-run@latest"
AI_TOOLS_PNPM_PACKAGE="pnpm@latest"
AI_TOOLS_APT_PACKAGES="gh"
```

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
