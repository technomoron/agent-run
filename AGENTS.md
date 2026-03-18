# Base Coding AGENTS.md setup

## GIT

- Never commit or push to git without being asked explicitly to do so.
- If creating commit messages, make them human. No conventional commits or
  other such standards. Just simple instructions.
- If asked to commit, do changes one by one and ask for confirmation, with
  the intended message.

## CHANGES

- Before pushing, make sure that all commits and changes are noted in the
  CHANGES file. The file should always be named CHANGES (not CHANGES.md).
- If there is no CHANGES file, warn and ask to create it.
- The CHANGES file format is as follows:

--- BEGIN FILE ---
CHANGES
=======

vX.Y.Z (yyyy-mm-dd)
-------------------
* [change]

--- /END FILE ---

## Linting

- If any lint config exists, then lint check and format.

## Testing

- Before committing, if there are tests to run, run them and make sure they
  pass.

## LICENSE

- Always make sure there is a LICENSE file present, and if package.json
  exists, check that it is duly noted.
- If package.json exists, check if copyright is added.

## COMMITTING

- Before committing, always check that we do not include any AI file in the
  repo or in .gitignore (that means AGENTS.md, CLAUDE.md, .claude, .codex, or
  any other you are aware of).

If anything below this point conflicts with anything included above,
the later instructions below take precedence.

# Agents Wrapper Repo

This repository provides a Node-based `agent-run` wrapper so project-specific
agent instructions can live outside the working repository.

## Purpose

- Keep agent instruction files in a separate private tree, not in the target
  project.
- Let users alias or prepend `PATH` so `agent-run` resolves to the local
  wrapper in `bin/`.
- [`bin/agent-run.js`](/home/bjorn/work/agents/bin/agent-run.js)
- Support both Claude (`CLAUDE.md`) and Codex (`AGENTS.md`) from one config
  root.

## Config Root

- Default config root: `$HOME/work/agent-configs`
- Override with: `AGENT_CONFIG_ROOT`

## Source Storage Layout

- Keep source checkouts in an org-first tree under the source storage root.
- For your GitHub repos, use:
  - `$SOURCE_STORAGE_DIR/bjornjac/<repo>`
  - `$SOURCE_STORAGE_DIR/yes-media/<repo>`
  - `$SOURCE_STORAGE_DIR/technomoron/<repo>`
  - `$SOURCE_STORAGE_DIR/documentmedia/<repo>`
- If you are using `$HOME/work` as the source storage root, examples become:
  - `$HOME/work/bjornjac/<repo>`
  - `$HOME/work/yes-media/<repo>`
  - `$HOME/work/technomoron/<repo>`
  - `$HOME/work/documentmedia/<repo>`
- Maintenance scripts in this repo should preserve and work with that org-based
  directory structure.

Source files:

- `$AGENT_CONFIG_ROOT/<mapped-path>/agent/CLAUDE.md`
- `$AGENT_CONFIG_ROOT/<mapped-path>/agent/AGENTS-MODS.md`

Generated files:

- The wrapper regenerates `AGENTS.md` from `AGENTS-MODS.md`
- Included files are expanded before launch
- If local content below the include block conflicts with included content
  above, the later local content takes precedence

## Shell Setup

Put this repo's `bin` directory before the rest of `PATH` so `agent-run` is
found first.

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

The wrappers walk upward from the current directory and resolve roots in this
order:

- workspace root (`package.json.workspaces` or `pnpm-workspace.yaml`)
- nearest directory containing `package.json`
- nearest directory containing `.git`

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

- `agent-run claude`
  - If a mapped `AGENTS-MODS.md` exists, regenerates `AGENTS.md` in the mapped
    config directory and runs Claude with `--add-dir` pointing at that
    directory.
  - If local AI files are found in the project tree, warns and exits instead
    of using them.
  - Uses Claude's normal permission behavior by default.
  - If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set for a non-root user, adds
    `--permission-mode bypassPermissions`.
  - `agent-run claude --none` bypasses the wrapper for that invocation.
- `agent-run codex`
  - If a mapped `AGENTS-MODS.md` exists, regenerates `AGENTS.md` in the mapped
    config directory and runs Codex with `--config
    system_prompt_file="<file>"`.
  - If local AI files are found in the project tree, warns and exits instead
    of using them.
  - Uses Codex's normal approval and sandbox behavior by default.
  - If `AGENT_WRAPPER_FORCE_PERMISSIVE=1` is set, adds
    `--ask-for-approval never --sandbox danger-full-access`.
  - `agent-run codex --none` bypasses the wrapper for that invocation.

The wrappers locate the real binaries and avoid recursing into themselves.

## Local Agent Files

Inside the mapped project folders under the separate `agent-configs` tree, keep
the source instructions in `agent/AGENTS-MODS.md`.

Rules:

- `agent/CLAUDE.md` must not contain separate instructions.
- `agent/CLAUDE.md` must contain exactly one line: `@AGENTS.md`
- A directory with `agent/CLAUDE.md` should also have sibling
  `agent/AGENTS-MODS.md` and generated `agent/AGENTS.md`
- Use leading `@path/to/file.md` lines in `agent/AGENTS-MODS.md` to include
  shared instruction files.

[`scripts/find-ai-files.js`](/home/bjorn/work/agents/scripts/find-ai-files.js)
reports local `CLAUDE.md` files that do not follow this convention.

## Source Checks

This repo includes maintenance scripts intended for broad source-tree checks and
fixes across the configured project-agent directories under the separate
`agent-configs` tree.

Available scripts:

- [`scripts/find-ai-files.js`](/home/bjorn/work/agents/scripts/find-ai-files.js)
  scans for AI-related files such as `AGENTS-MODS.md`, `CLAUDE.md`, `.claude`,
  and `.codex`, and warns when `.gitignore` files hide AI-related files.
- [`scripts/ensure-licenses.js`](/home/bjorn/work/agents/scripts/ensure-licenses.js)
  ensures configured directories have a `LICENSE` file and that local
  `package.json` license metadata is set when missing.

License rules enforced by `ensure-licenses.js`:

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

Git ignore rules checked by `find-ai-files.js`:

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
  [`bin/agent-run.js`](/home/bjorn/work/agents/bin/agent-run.js)
  and keep this file in sync.
