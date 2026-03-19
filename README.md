# agent-run

`agent-run` is a small wrapper around AI coding CLIs such as Codex and Claude.

Its purpose is simple:

- keep AI instruction files out of normal working repositories
- store those instructions in a separate config tree
- map source repositories to matching config folders automatically
- warn when a working repository still contains local AI files
- make repo-wide setup and validation predictable

## Installation

Install globally so the `agent-run` command is available on your `PATH`:

```sh
npm install -g agent-run
```

For local development, prepend this repo's `bin/` directory to `PATH` instead.

## Quick Start

```sh
# Initialize agent config for a project
cd ~/source/org/my-api
agent-run init

# Edit the agent instructions
agent-run edit

# Run Claude with the mapped config
agent-run claude

# Run Codex with the mapped config
agent-run codex

# Check a project for config issues
agent-run check

# Audit an entire source tree
agent-run check --all ~/source
```

## Why This Exists

Many AI tools look for local instruction files such as:

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/`
- `.codex/`

That is convenient for a single repo, but it creates a few problems at scale:

- private or user-specific instructions end up mixed into normal project repos
- AI-specific files are easy to accidentally commit
- shared instruction maintenance becomes repetitive
- generated files drift from source files
- multi-repo setups become inconsistent

`agent-run` separates concerns:

- source repos stay source repos
- AI config lives in a dedicated config repo
- the wrapper decides which AI config applies to the current project

## Core Model

There are three different things in this workflow:

1. Source repositories
2. Agent configuration repositories
3. The `agent-run` utility itself

The important design point is that source repos and AI config repos are not the same thing.

### Source Repositories

These are your normal code repositories. A typical layout is:

```text
<source-root>/
  user/
    some-repo/
  org1/
    hyped-up-codebase/
  org2/
    awesome-api/
```

### Agent Config Repository

This is a separate repo, typically at:

```text
<source-root>/agent-configs
```

Inside that config repo, each project gets a mapped folder:

```text
<source-root>/agent-configs/
  org/
    my-api/
      agent/
        AGENTS-MODS.md
        AGENTS.md
        CLAUDE.md
```

This `agent-run` utility repo does not need to contain those mapped project
folders locally.

### The Utility

`agent-run` itself is just the command-line wrapper. It should be installable independently and should not need to be colocated with either the source repo or the config repo.

### Local Override File

A source repo may also contain:

```text
.agent-run.env
```

This is the explicit override point for repos that need local mapping metadata.

## File Roles

Each mapped agent folder uses three files:

### `AGENTS-MODS.md`

This is the editable source file.

Use this for:

- project-specific instructions
- `@path/to/file.md` include lines
- local overrides after included content

This is the source of truth.

### `AGENTS.md`

This is the generated file.

It is built from `AGENTS-MODS.md` by expanding leading include lines and inserting the override note when local content follows included content.

This is what Codex consumes.

### `CLAUDE.md`

This is not a second instruction source.

It should contain exactly:

```text
@AGENTS.md
```

Claude uses this as a pointer to the generated file.

`CLAUDE.md` is kept as a plain checked-in pointer file, not a symlink.
That is intentional for cross-platform compatibility, because the
`agent-configs` repository may be checked out on both Unix and Windows systems,
and git-managed symlinks are less reliable across mixed environments.

The same compatibility rule applies to any other tool-specific entry file such
as `GEMINI.md`: keep a small checked-in pointer file rather than requiring a
symlink.

The intended workflow is:

1. edit `AGENTS-MODS.md`
2. generate `AGENTS.md`
3. keep `CLAUDE.md` as a pointer only

That avoids maintaining two separate instruction files.

## Mapping Rules

`agent-run` maps a source repository to a config folder by:

1. finding the project root
2. deriving a profile path
3. resolving the matching `agent/` folder in the config root

### Project Root Detection

Starting from the current directory, `agent-run` walks upward and chooses roots in this order:

1. workspace root
2. nearest directory with `package.json`
3. nearest directory with `.git`

Workspace root means:

- `pnpm-workspace.yaml` exists, or
- `package.json.workspaces` exists

### Profile Mapping

Order of precedence:

1. `AGENT_RUN_PROFILE` in `.agent-run.env`
2. `package.json.name`
3. fail

Examples:

- `AGENT_RUN_PROFILE=org/my-app` becomes `org/my-app`
- `package.json.name = @org/my-app` becomes `org/my-app`
- `package.json.name = my-app` becomes `my-app`

If neither `AGENT_RUN_PROFILE` nor `package.json.name` exists, `agent-run` does not guess from the directory name. It fails and asks for an explicit profile.

### Final Config Path

The resolved config path is:

```text
<config-root>/<profile>/agent
```

Example:

- source repo: `<source-root>/org/my-api`
- package name: `@org/my-api`
- config dir:
  `<source-root>/agent-configs/org/my-api/agent`

For a non-Node repo, use:

```dotenv
AGENT_RUN_PROFILE=org/my-api
```

## Source Root And Config Root

`agent-run` is anchored primarily by the source root.

### Source Root Resolution

Order of precedence:

1. `--root <path>`
2. `--root=<path>`
3. `AGENT_SOURCE_ROOT`
4. `SOURCE_STORAGE_DIR`
5. platform default

Platform defaults:

- Linux/macOS/Unix: `~/source`
- Windows: `~/Documents/source`

### Config Root Resolution

Order of precedence:

1. `AGENT_CONFIG_ROOT`
2. `<source-root>/agent-configs`

That means the default assumption is:

```text
<source-root>/
  agent-configs/
  user/
  org/
  org2/
```

## Commands

### `agent-run codex`

Runs Codex using mapped agent config.

Behavior:

- finds the current project root
- rejects the project if local AI files are present
- resolves the mapped config directory
- regenerates `AGENTS.md` from `AGENTS-MODS.md` when available
- runs the real `codex` binary with:
  `--config system_prompt_file=<path-to-AGENTS.md>`

If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set, it adds:

- `-a never`
- `-s danger-full-access`

**`--none`** — bypasses wrapper behavior and runs the real `codex` binary directly.

**`--create`** — creates blank mapped agent files before launching.

### `agent-run claude`

Runs Claude using mapped agent config.

Behavior:

- finds the current project root
- rejects the project if local AI files are present
- resolves the mapped config directory
- regenerates `AGENTS.md` from `AGENTS-MODS.md` when available
- runs the real `claude` binary with:
  `--add-dir <mapped-agent-dir>`

If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set for a non-root user, it adds:

- `--permission-mode bypassPermissions`

**`--none`** — bypasses wrapper behavior and runs the real `claude` binary directly.

**`--create`** — creates blank mapped agent files before launching.

### `agent-run init [path]`

Initializes mapped config files for a source repo.

Behavior:

- resolves the project root for `path` or the current directory
- resolves the mapped `agent/` directory
- creates missing:
  - `AGENTS-MODS.md`
  - `AGENTS.md`
  - `CLAUDE.md`
- regenerates `AGENTS.md` if `AGENTS-MODS.md` already exists

If the project root contains `.agent-run-ignore`, init skips it.

If the project has neither `package.json.name` nor `AGENT_RUN_PROFILE` in `.agent-run.env`, init fails and asks for explicit mapping metadata.

### `agent-run edit [path]`

Opens the mapped `AGENTS-MODS.md` source file for a project.

Behavior:

- resolves the project root for `path` or the current directory
- skips immediately if the project root contains `.agent-run-ignore`
- resolves the mapped `agent/` directory
- creates missing:
  - `AGENTS-MODS.md`
  - `AGENTS.md`
  - `CLAUDE.md`
- regenerates `AGENTS.md` from `AGENTS-MODS.md`
- opens `AGENTS-MODS.md` in:
  - `$VISUAL`, if set
  - otherwise `$EDITOR`, if set
  - otherwise, if running inside a VS Code terminal and `code` or `codium` is
    available, opens it in VS Code
  - otherwise a fallback terminal editor such as `joe`, `sensible-editor`,
    `editor`, `nano`, `nvim`, `vim`, or `vi`
  - otherwise the platform default opener as a last resort

If the project has neither `package.json.name` nor `AGENT_RUN_PROFILE` in `.agent-run.env`, edit fails and asks for explicit mapping metadata.

### `agent-run check [path]`

Checks one source repo.

Behavior:

- resolves the project root for `path` or the current directory
- skips immediately if the project root contains `.agent-run-ignore`
- reports local AI files in the source repo
- requires either `package.json.name` or `AGENT_RUN_PROFILE` in `.agent-run.env`
- checks whether the mapped config exists
- checks whether `CLAUDE.md` is exactly `@AGENTS.md`
- checks whether generated `AGENTS.md` matches rendered `AGENTS-MODS.md`
- warns if a scoped package path does not match `<org>/<repo>` under the source root

```sh
agent-run check .
```

### `agent-run check --all [path]`

Checks a source root and all repos found under it.

Behavior:

- treats the target as a source storage root
- finds repos by locating `.git` directories
- also treats the root itself as a repo if it already looks like one
- runs the same per-repo checks as `check`
- skips any subtree rooted at `.agent-run-ignore`

```sh
agent-run check --all ~/source
agent-run --root ~/work check --all ~/work
```

This is intended for batch auditing of a whole source tree.

## Local AI File Policy

By design, working repos are not supposed to keep active AI instruction files inside the repo.

The wrapper treats these as local AI files:

- `AGENTS.md`
- `AGENTS-MODS.md`
- `CLAUDE.md`
- `codex.md`
- `.claude`
- `.codex`

For `codex` and `claude` commands, if these are found inside the project, `agent-run` stops and warns.

The expected response is:

1. move them manually out of the repo, or
2. run the underlying AI tool directly if you intentionally want local files

This is deliberate. The wrapper is opinionated about keeping working repos clean.

## `.agent-run-ignore`

If a directory contains a file named `.agent-run-ignore`, that directory is excluded from processing.

Effects:

- `check` skips that project
- `check --all` prunes that subtree
- local AI scanning does not descend into it
- `init` skips it
- `claude` and `codex` wrapper behavior is bypassed for ignored repos

This is useful for:

- the `agent-configs` repo itself
- the `agent-run` utility repo
- repos intentionally managing their own local AI files
- special-case directories you do not want batch jobs to inspect

## `.agent-run.env`

`.agent-run.env` is the explicit override file for per-repo mapping metadata.

Supported keys:

```dotenv
AGENT_RUN_PROFILE=org/my-api
AGENT_RUN_IGNORE=1
```

### `AGENT_RUN_PROFILE`

Use this when:

- a repo has no `package.json`
- a repo is not a Node project
- the desired config mapping should not come from `package.json.name`

This value is the profile path relative to `agent-configs`.

```dotenv
AGENT_RUN_PROFILE=org/my-docs
```

### `AGENT_RUN_IGNORE`

This is the structured equivalent of `.agent-run-ignore`.

Truthy values: `1`, `true`, `yes`, `on`

If set, the repo is skipped by `check`, `check --all`, and `init`, and wrapper behavior is bypassed for tool launch commands.

## Include Expansion

Leading lines in `AGENTS-MODS.md` beginning with `@` are treated as include lines.

```text
@../../templates/AGENTS-CODE.md
```

The generator:

- expands included content
- supports include-cycle detection
- inserts the precedence note when local content follows included content

If included and local content conflict, later local content wins.

## Binary Resolution

`agent-run` looks up the real `codex` or `claude` binary in `PATH` and avoids recursively resolving itself.

On Windows, it also handles `.cmd`, `.bat`, and `.exe` extensions, and uses shell spawning where needed for command shims.

## Recommended Layout

Source tree:

```text
~/source/
  agent-configs/
  user/
    my-repo/
  org/
    my-api/
  org2/
    another-repo/
```

Config tree:

```text
~/source/agent-configs/
  user/
    my-repo/
      agent/
        AGENTS-MODS.md
        AGENTS.md
        CLAUDE.md
  org/
    my-api/
      agent/
        AGENTS-MODS.md
        AGENTS.md
        CLAUDE.md
```

## Design Rationale

### Keep AI Files Out Of Source Repos

This reduces accidental commits, repo noise, project-specific duplication, and ambiguity about which instructions are actually active.

### Keep One Editable Instruction Source

Using `AGENTS-MODS.md` as source, `AGENTS.md` as generated output, and `CLAUDE.md` (and similar) as checked-in pointer files avoids split-brain configuration between tools. Pointer files instead of symlinks keep the `agent-configs` tree portable across Linux, macOS, and Windows.

### Make Mapping Deterministic

The mapping from repo to config path comes from explicit metadata, not guessed directory names. The precedence is `AGENT_RUN_PROFILE` → `package.json.name` → fail. There is no silent catch-all fallback.

### Support Batch Validation

Large multi-repo setups need batch checks to surface missing configs, stale generated files, bad path conventions, and local AI leakage.

### Allow Explicit Exceptions

`.agent-run-ignore` exists because strict policies still need escape hatches. Ignored repos are a deliberate exception, not an accident.

## Scope

`agent-run` is focused on wrapping Codex and Claude, mapping projects to external agent config, generating `AGENTS.md`, and validating source and config layout.

It is not intended to manage package manager configuration, systemd services, license maintenance, or arbitrary workspace automation unrelated to agent config.
