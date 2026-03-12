@../../templates/AGENTS-CODE.md

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

Source files:

- `$AGENT_CONFIG_ROOT/<mapped-path>/agent/CLAUDE.md`
- `$AGENT_CONFIG_ROOT/<mapped-path>/agent/AGENTS-MODS.md`

Runtime-generated files:

- The wrappers build a temporary `AGENTS.md` from `AGENTS-MODS.md`
- Included files are expanded before launch
- If local content below the include block conflicts with included content
  above, the later local content takes precedence

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
- Unscoped package name: `apicore` -> `apicore`
- No package name or no `package.json` -> basename of detected project root

Examples:

- `@technomoron/apicore` ->
  `$HOME/work/agent-configs/technomoron/apicore/agent/AGENTS-MODS.md`
- `@technomoron/apicore` ->
  `$HOME/work/agent-configs/technomoron/apicore/agent/CLAUDE.md`
- `apicore` -> `$HOME/work/agent-configs/apicore/agent/AGENTS-MODS.md`
- `/home/user/work/my-website` with no package ->
  `$HOME/work/agent-configs/my-website/agent/CLAUDE.md`

## Wrapper Behavior

- `bin/claude`
  - If a mapped `AGENTS-MODS.md` exists, builds a temporary merged
    `AGENTS.md` plus `CLAUDE.md`, then runs Claude with `--add-dir` pointing
    at that temporary directory.
  - If only a mapped `CLAUDE.md` exists, runs Claude with `--add-dir`
    pointing at that config directory.
  - Uses Claude's normal permission behavior by default.
  - If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set for a non-root user, adds
    `--permission-mode bypassPermissions`.
  - Otherwise runs the real `claude` binary unchanged.
- `bin/codex`
  - If a mapped `AGENTS-MODS.md` exists, builds a temporary merged
    `AGENTS.md` and runs Codex with
    `--config system_prompt_file="<file>"`.
  - Uses Codex's normal approval and sandbox behavior by default.
  - If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set, adds
    `--ask-for-approval never --sandbox danger-full-access`.
  - Otherwise runs the real `codex` binary unchanged.

The wrappers locate the real binaries and avoid recursing into themselves.

## Local Agent Files

Inside this repository's project-agent folders, keep the source instructions in
`agent/AGENTS-MODS.md`.

Rules:

- `agent/CLAUDE.md` must not contain separate instructions.
- `agent/CLAUDE.md` must contain exactly one line: `@AGENTS-MODS.md`
- A directory with `agent/CLAUDE.md` should also have a sibling
  `agent/AGENTS-MODS.md`
- Use leading `@path/to/file.md` lines in `agent/AGENTS-MODS.md` to include
  shared instruction files.

[`scripts/find-ai-files.sh`](/home/bjorn/work/agents/scripts/find-ai-files.sh)
reports local `CLAUDE.md` files that do not follow this convention.

## Source Checks

This repo includes maintenance scripts intended for broad source-tree checks and
fixes across the configured project-agent directories in this repo.

Available scripts:

- [`scripts/find-ai-files.sh`](/home/bjorn/work/agents/scripts/find-ai-files.sh)
  scans for AI-related files such as `AGENTS-MODS.md`, `CLAUDE.md`, `.claude`,
  and `.codex`, and warns when `.gitignore` files hide AI-related files.
- [`scripts/ensure-licenses.sh`](/home/bjorn/work/agents/scripts/ensure-licenses.sh)
  ensures configured directories have a `LICENSE` file and that local
  `package.json` license metadata is set when missing.

License rules enforced by `ensure-licenses.sh`:

- Every configured project directory should have a `LICENSE` file.
- If a directory has a `package.json` with no `license` field, set
  `"license": "UNLICENSED"`.
- If `package.json` says `"license": "MIT"` and there is no `LICENSE` file,
  create it from
  [`templates/LICENSE-MIT`](/home/bjorn/work/agents/templates/LICENSE-MIT).
- When creating an MIT `LICENSE`, use `package.json.copyright` if present.
- If no package copyright exists, use the fallback line:
  `Copyright (c) 2026 Bjørn Erik Jacobsen`
- For non-MIT or unlicensed projects, create `LICENSE` from
  [`templates/LICENSE`](/home/bjorn/work/agents/templates/LICENSE).

Templates:

- [`templates/LICENSE`](/home/bjorn/work/agents/templates/LICENSE)
- [`templates/LICENSE-MIT`](/home/bjorn/work/agents/templates/LICENSE-MIT)

Git ignore rules checked by `find-ai-files.sh`:

- `.gitignore` should not contain entries for `AGENTS.md`
- `.gitignore` should not contain entries for `AGENTS-MODS.md`
- `.gitignore` should not contain entries for `CLAUDE.md`
- `.gitignore` should not contain entries for `codex.md`
- `.gitignore` should not contain entries for `.claude`
- `.gitignore` should not contain entries for `.codex`

## CHANGES

If project contains CHANGES or CHANGES.md:
- Rename CHANGES.md to CHANGES and format it as text.
- Use the following style with CHANGES:

CHANGES
=======

vX.Y.Z (yyyy-mm-dd)
-------------------
* [change]

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
