# agent-run

Small wrapper for AI coding CLIs like Codex and Claude.

It keeps agent files out of normal repos and stores them in a separate
agent config tree. That tree can live anywhere; it does not need to sit
inside the source tree.

## Model

There are three things:

- the source tree
- the agent config tree
- this `agent-run` wrapper

Example:

```text
~/source/
  org/
    my-api/

~/.agent-config/
  org/
    my-api/
      agent-run.jsonc
      local.md.njk
      overrides/
      AGENTS.md
      CLAUDE.md
      config.toml
      .agents/
      .claude/
      bin/
```

If your source repo is `~/source/org/my-api`, `agent-run` can map it to:

```text
~/.agent-config/org/my-api
```

The source repo stays clean. The agent files live in the matching path under
the agent config tree.

## File Roles

- `agent-run.jsonc`: profile manifest
- `local.md.njk`: source file you edit for project-specific instructions
- `overrides/`: optional per-profile template overrides
- `AGENTS.md`: generated Codex instructions
- `CLAUDE.md`: generated Claude instructions
- `config.toml`: generated Codex config
- `.agents/` and `.claude/`: generated native skill/config homes

Edit `local.md.njk` and `agent-run.jsonc`. `agent-run` keeps generated files in sync.

## Profile Resolution

The mapped path is:

```text
<config-root>/<profile>
```

`profile` is resolved in this order:

1. `AGENT_RUN_PROFILE` in `.agent-run.env`
2. GitHub `origin` remote
3. `package.json.name`

Examples:

- `AGENT_RUN_PROFILE=org/my-api` -> `org/my-api`
- `AGENT_RUN_PROFILE=unrelated/hello` -> `unrelated/hello`
- `package.json.name = "@org/my-api"` -> `org/my-api`
- `package.json.name = "my-api"` -> `my-api`

`AGENT_RUN_PROFILE` is relative to the config root. It is not a filesystem
path, so values like `/tmp/foo`, `C:/tmp/foo`, or `../foo` are rejected.

If neither exists, `agent-run` fails instead of guessing.

## Overrides

Local override for a repo:

```dotenv
# .agent-run.env
AGENT_RUN_PROFILE=org/my-api
```

Config root:

- default: `~/.agent-config`
- override with `--config-root /path/to/agent-configs`
- override with `AGENT_CONFIG_DIR=/path/to/agent-configs`
- override with `AGENT_CONFIG_ROOT=/path/to/agent-configs`
- or set `AGENT_CONFIG_DIR=/path/to/agent-configs` or `AGENT_CONFIG_ROOT=/path/to/agent-configs` in `.agent-run.env`

## Commands

Global flag:

- `-h`, `--help`: show wrapper help for `agent-run` and the built-in commands
- `-v`, `--verbose`: print path resolution, file creation, include expansion,
  generated file writes, and spawned commands

`agent-run codex --help` and `agent-run claude --help` still pass `--help`
through to the underlying tool.

Codex defaults to `--danger`, which launches Codex with `-a never -s danger-full-access`,
sets `CODEX_HOME` under the private agent directory, starts the Codex process
from that private directory, passes the project root with `-C`, and keeps
generated guard shims on `PATH`. Use `--sandboxed` to request Codex
`workspace-write`; add `--network` with `--sandboxed` to set
`sandbox_workspace_write.network_access=true`.

Claude Code currently has no `--cd` equivalent. `agent-run` keeps Claude's
process cwd at the project root, passes the generated `.claude/settings.json`
with `--settings`, and allows both the project root and private agent directory
with `--add-dir`.

Initialize mapped files for the current repo:

```sh
agent-run init
```

This creates the mapped profile directory if needed and ensures these source
files/directories exist:

- `agent-run.jsonc`
- `local.md.njk`
- `overrides/`

Edit the source file for the current repo:

```sh
agent-run edit
```

This creates missing files, syncs generated files, then opens `local.md.njk`
in your editor.

Regenerate the generated files for the current repo:

```sh
agent-run update
```

This reads `agent-run.jsonc` and Nunjucks templates from the mapped profile
directory and rewrites generated files:

- `AGENTS.md`
- `CLAUDE.md`
- `config.toml`
- `.agents/skills/**`
- `.claude/**`
- `bin/**`

Per-profile override templates can be placed in:

- `overrides/codex-config.toml.njk`
- `overrides/claude-settings.json.njk`

## Starter Config

A complete starter lives in `examples/basic-config`. It includes a minimal
project, `.agent-run.env`, a config root with global templates and snippets,
profile-local templates, skill templates, profile skill overrides, tool config
overrides, guardrails, checks, and generated runtime paths.

To copy the packaged starter config root into your default config location:

```sh
agent-run --init
```

Or choose a destination:

```sh
agent-run --init ~/.agent-config
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
- stale `AGENTS.md`
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

This preserves `AGENTS-MODS.md`, creates `local.md.njk`, `agent-run.jsonc`, and
`overrides/` for legacy profiles, creates the `global/` templates, moves loose
review files into `reviews/`, moves loose `memory*.md` files into `memories/`,
and moves old Codex runtime files into `memories/codex-home` when doing so does
not overwrite existing files.

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
