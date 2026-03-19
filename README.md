# agent-run

Small wrapper for AI coding CLIs like Codex and Claude.

It keeps agent files out of normal repos and stores them in a separate
`agent-configs` tree. That tree can live anywhere; it does not need to sit
inside the source tree.

## Model

There are three things:

- the source tree
- the `agent-configs` tree
- this `agent-run` wrapper

Example:

```text
~/source/
  org/
    my-api/

~/source/agent-configs/
  org/
    my-api/
      AGENTS-MODS.md
      AGENTS.md
      CLAUDE.md
```

If your source repo is `~/source/org/my-api`, `agent-run` can map it to:

```text
~/source/agent-configs/org/my-api
```

The source repo stays clean. The agent files live in the matching path under
`agent-configs`.

## File Roles

- `AGENTS-MODS.md`: source file you edit
- `AGENTS.md`: generated from `AGENTS-MODS.md`
- `CLAUDE.md`: pointer file containing only `@AGENTS.md`

Edit `AGENTS-MODS.md`. `agent-run` keeps `AGENTS.md` and `CLAUDE.md` in sync.

## Profile Resolution

The mapped path is:

```text
<config-root>/<profile>
```

`profile` is resolved in this order:

1. `AGENT_RUN_PROFILE` in `.agent-run.env`
2. `package.json.name`

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

- default: `~/source/agent-configs` on Unix
- default: `~/Documents/source/agent-configs` on Windows
- override with `--config-root /path/to/agent-configs`
- override with `AGENT_CONFIG_ROOT=/path/to/agent-configs`
- or set `AGENT_CONFIG_ROOT=/path/to/agent-configs` in `.agent-run.env`

## Commands

Global flag:

- `-v`, `--verbose`: print path resolution, file creation, include expansion,
  generated file writes, and spawned commands

Initialize mapped files for the current repo:

```sh
agent-run init
```

This creates the mapped profile directory if needed and ensures these files
exist:

- `AGENTS-MODS.md`
- `AGENTS.md`
- `CLAUDE.md`

Edit the source file for the current repo:

```sh
agent-run edit
```

This creates missing files, syncs generated files, then opens
`AGENTS-MODS.md` in your editor.

Regenerate the generated files for the current repo:

```sh
agent-run update
```

This reads `AGENTS-MODS.md` from the mapped profile directory and rewrites:

- `AGENTS.md`
- `CLAUDE.md`

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

## Install

```sh
npm install -g @technomoron/agent-run
```
