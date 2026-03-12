# Agents Wrapper Repo

This repository provides wrapper binaries for `claude` and `codex` so project-
specific agent instructions can live outside the working repository.

## Purpose

- Keep agent instruction files in a separate private tree, not in the target
  project.
- Let users alias or prepend `PATH` so `claude` and `codex` resolve to
  [`bin/claude`](/home/bjorn/work/agents/bin/claude) and
  [`bin/codex`](/home/bjorn/work/agents/bin/codex).
- Support both Claude (`CLAUDE.md`) and Codex (`AGENTS.md`) from one config
  root.

## Config Root

- Default config root: `$HOME/work/agent-configs`
- Override with: `AGENT_CONFIG_ROOT`

Expected files:

- `$AGENT_CONFIG_ROOT/<mapped-path>/CLAUDE.md`
- `$AGENT_CONFIG_ROOT/<mapped-path>/AGENTS.md`

## Shell Setup

Put this repo's `bin` directory before the rest of `PATH` so the wrapper
scripts are found first.

Bash:

- Login shell: `~/.bash_profile`
- Interactive non-login shell: `~/.bashrc`

```sh
export PATH="$HOME/work/agents/bin:$PATH"
```

Zsh:

- Usually: `~/.zshrc`

```sh
export PATH="$HOME/work/agents/bin:$PATH"
```

Fish:

- Usually: `~/.config/fish/config.fish`

```fish
fish_add_path --move --prepend $HOME/work/agents/bin
```

Tcsh:

- Usually: `~/.tcshrc`

```tcsh
setenv PATH "$HOME/work/agents/bin:$PATH"
```

After editing the startup file, reload it or start a new shell.

## Mapping Rules

The wrappers walk upward from the current directory until they find the nearest
directory containing `package.json` or `.git`. That directory is treated as the
project root.

Path mapping from `package.json`:

- Scoped package name: `@technomoron/apicore` ->
  `technomoron/apicore`
- Unscoped package name: `apicore` -> config root directly
- No package name or no `package.json` -> basename of detected project root

Examples:

- `@technomoron/apicore` ->
  `$HOME/work/agent-configs/technomoron/apicore/AGENTS.md`
- `@technomoron/apicore` ->
  `$HOME/work/agent-configs/technomoron/apicore/CLAUDE.md`
- `apicore` -> `$HOME/work/agent-configs/AGENTS.md`
- `/home/user/work/my-website` with no package ->
  `$HOME/work/agent-configs/my-website/CLAUDE.md`

## Wrapper Behavior

- `bin/claude`
  - If a mapped `CLAUDE.md` exists, runs Claude with `--add-dir` pointing at
    that config directory.
  - Uses Claude's normal permission behavior by default.
  - If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set for a non-root user, adds
    `--permission-mode bypassPermissions`.
  - Otherwise runs the real `claude` binary unchanged.
- `bin/codex`
  - If a mapped `AGENTS.md` exists, runs Codex with
    `--config system_prompt_file="<file>"`.
  - Uses Codex's normal approval and sandbox behavior by default.
  - If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set, adds
    `--ask-for-approval never --sandbox danger-full-access`.
  - Otherwise runs the real `codex` binary unchanged.

The wrappers locate the real binaries and avoid recursing into themselves.

## Local Agent Files

Inside this repository's project-agent folders, keep the full instructions in
`AGENTS.md`.

Rules:

- `CLAUDE.md` must not contain separate instructions.
- `CLAUDE.md` must contain exactly one line: `@AGENTS.md`
- A directory with `CLAUDE.md` should also have a sibling `AGENTS.md`

[`scripts/find-ai-files.sh`](/home/bjorn/work/agents/scripts/find-ai-files.sh)
reports local `CLAUDE.md` files that do not follow this convention.

## Non-Goals

- This repo does not currently manage `.claude` or `.codex` state directories.
- It does not create symlinks into target projects.
- It does not maintain per-project global fallbacks beyond the mapped file
  lookup above.

## Notes

- The original basename-of-current-directory approach is not authoritative
  anymore; package-name mapping is the intended behavior.
- If you change the mapping rules, update
  [`bin/agent-wrapper-common.sh`](/home/bjorn/work/agents/bin/agent-wrapper-common.sh)
  and keep this file in sync.
