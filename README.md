# agent-run

**Config once. Run with any native coding agent.**

For persistent knowledge, shared skills, and tasks, install the separate
[`agent-brain` MCP server](#persistent-context-with-agent-brain). It runs as a per-user service
hosted by `@technomoron/apicore-server` on a private Unix socket. Native agents
connect through a stdio-to-socket bridge.
Node 24 or newer is required.

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
  runtime/codex/         # shared, ignored Codex home
    agent-run-<id>.config.toml
    skills/agent-run-<id>/
    sessions/
    memories/
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
- `live/memories/codex-home/config.toml`: rendered Codex template for inspection
- `<config-root>/runtime/codex/`: shared Codex home, authentication and session state
- `runtime/codex/agent-run-<id>.config.toml`: named Codex profile with project instructions and settings
- `runtime/codex/skills/agent-run-<id>/`: generated skills, enabled only for that profile
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

## Guard Shims

`blockGitWrite`, `blockPublish`, and `blockGithubRelease` put small `git`, `npm`,
`pnpm`, and `gh` shims on the launched agent's `PATH`. They refuse
`git commit`, `git tag`, `git push`, `npm publish`, `pnpm publish`, and
`gh release create` with exit code 42 and pass everything else through to the
real command. Set `AGENT_RUN_ALLOW_GIT_WRITE=1`, `AGENT_RUN_ALLOW_PUBLISH=1`, or
`AGENT_RUN_ALLOW_GITHUB_RELEASE=1` for a single invocation you have reviewed.

Throwaway repositories that a test suite creates and deletes are exempt from the
`git` shim. Create an empty `.agent-run-test-repo` file in the repository, or in
any directory above it, and `git commit`, `git tag`, and `git push` run normally
for anything below that marker. The shim reads the marker from the directory
`git` would work in, following any leading `-C` options. This is what lets
`pnpm test` run inside an agent session; nothing outside a marked directory is
affected.

## Profile Resolution

The mapped path is:

```text
<config-root>/<profile>
```

`profile` is resolved in this order:

1. `AGENT_RUN_PROFILE` in `.agent-run.env`
2. Registered agent-brain source root (the most specific match)
3. GitHub `origin` remote
4. `package.json.repository` (string or object `url`)
5. `package.json.name`
6. The project path as `[parent]/[current]`

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
With agent-brain enabled, an unconfigured directory uses the default profile.
An explicit `AGENT_RUN_PROFILE` still takes precedence, and namespaced brain
project names resolve to their registered profiles.

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

Global flags:

- `-h`, `--help`: show wrapper help for `agent-run` and the built-in commands
- `-v`, `--verbose`: print path resolution, file creation, include expansion,
  generated file writes, and spawned commands

`agent-run codex --help`, `agent-run claude --help`, `agent-run gemini --help`,
and `agent-run grok --help` pass `--help` through to the underlying tool.

Session cleanup runs separately from interactive agent startup and exit. The
hourly AI tool timer cleans sessions older than seven days by default for selected
users. Set retention in `~/.agent-run/cleanup.env`:

```sh
AGENT_RUN_SESSION_RETENTION_DAYS=7
```

Use a non-negative whole number of days; `0` disables retention cleanup.
An environment value overrides the file. `--configdir PATH` selects another
configuration root and its `cleanup.env`. Sessions exactly at the retention
boundary are retained. Authentication, settings, skills and brain knowledge are
preserved. Run retention cleanup manually with `agent-run --clean-old all`.

Delete all saved sessions for selected agents without launching an agent:

```sh
agent-run --clean all
agent-run --clean codex,claude
agent-run --clean grok gemini
```

`--configdir PATH` selects the configuration tree to scan. The native user homes
are also included. Codex and Grok deletion requires an installed CLI with its
native deletion command; Codex SQLite history is included. Failed or unsupported
deletions are reported and retained; explicit cleanup exits with status 1 if any
operation fails. A current session identified in the environment is skipped.
Symlinks and paths owned by a different user are not cleaned.

For any native agent command, use `--generate` to generate profile files
without launching the underlying tool.

Codex defaults to `-a on-request -s workspace-write`. `agent-run` uses one
`CODEX_HOME` at `<config-root>/runtime/codex` and selects a generated named
profile with `--profile`. Project instructions are added through
`developer_instructions`; MCP settings and per-skill enablement stay in the
named profile. The normal global Codex executable is used. Codex 0.157.0 runs
named-profile sessions with its embedded backend, avoiding automatic daemon
package copies and the long per-project Unix socket path. Agent-run does not
add `--no-daemon`. This layout requires Codex with named profile-file support
(0.134.0 or newer); Windows and Debian are tested with 0.157.0.

Codex starts from the project root, also passed with `-C`, with generated guard
shims on `PATH`. Use `--network` to enable network access in the workspace-write
sandbox. Windows profiles default to the native unelevated sandbox unless the
profile template specifies another mode. When `~/.codex/auth.json` exists, the
shared home links that login cache (copies it when Windows cannot create file
symlinks), so changing projects does not require another login.

On first use of each old project home, agent-run copies its `sessions/` and
`archived_sessions/` rollouts into the shared home without overwriting existing
files. Codex rebuilds its derived session index. Original files, databases,
history, native memories and old daemon packages remain untouched in the old
home; databases and daemon installations are not copied. Close old agent-run
sessions before upgrading so their final turns are included. New sessions and
native memories use the shared home; durable project knowledge remains separate.

### Project Memory

Each profile has a durable `notes/memory/` directory outside the source repo.
`README.md` is a short index; agents read only the linked files relevant to the
current task. Agents may update project memory when the user explicitly requests it or
authorizes a standing workflow, such as saving durable corrections and updating
affected specs. This authorization does not permit Git or external-service writes.

Codex's native `$CODEX_HOME/memories/` lives in the ignored shared home. It
is generated, machine-local recall data and is not copied into the tracked
project memory directory. Project memory is plain Markdown so it can be
reviewed and shared through the Git repository that normally holds the
`.agent-run` config tree.

With agent-brain enabled, `memory/` is the canonical project knowledge directory
and remains in place; existing `notes/memory/` is also read. Without agent-brain,
legacy `memory/` moves to `notes/memory/`. Loose `memory*.md` files and Markdown
files directly under the old `memories/` directory move to the applicable memory
directory. Agent-run detects the old layout
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
Gemini login credentials, commands, and user skills are linked into the private
home when present. On Windows, shared user preferences and generated settings
are merged into the private home's `.gemini/settings.json`; shared settings
remain untouched. This avoids Gemini's administrator-only system-settings ACL
requirement. On other platforms, user settings are linked and generated system
settings remain the highest-priority project layer. Gemini's normal folder-trust
and sign-in requirements still apply.

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
- `<config-root>/runtime/codex/agent-run-<id>.config.toml`
- `<config-root>/runtime/codex/skills/agent-run-<id>/**`
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

To add persistent knowledge and tasks to the starter, first copy its
`agent-config/` directory outside your source repository, then run
`agent-brain init --configdir /path/to/agent-config`. Existing profiles are
preserved, and the brain MCP connection is added on the next generation or
launch. [brain.example.jsonc](examples/basic-config/brain.example.jsonc) shows
the optional root configuration; the starter commands do not enable it.
Generated starter runtime files live below
`examples/basic-config/agent-config/starter/basic-project/live/`.

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

## Persistent context with agent-brain

The MCP server and its documentation live in the separate
[agent-brain repository](https://github.com/technomoron/agent-brain). Install it
separately: it provides `agent-brain` with `agent-mcp` as a compatibility alias.
Agent-run's `mcp`, `create` and `project` commands delegate to that executable.
Brain owns knowledge storage, skills, reviews, tasks, connectors and server-side
Git synchronization; see its [service and knowledge guide](https://github.com/technomoron/agent-brain#local-service-and-knowledge-guide).

Agent configuration stays outside source repositories. Each repository has its
own project profile; `agent-run` and `agent-brain` share the `agent-tools` pool.
Brain-specific specs and design references belong to the Brain project profile.
This profile retains launcher requirements, native-agent behavior and client
integration. Reviews and tasks remain with their original repository.

For local development, keep the checkouts next to each other, build agent-run,
then run `node scripts/link-agent-run.cjs` in agent-brain. The launcher test suite
checks launcher behavior; agent-brain's suite checks server behavior and the
cross-package integration. Reusable skill sources remain in the separate private
`agent-mcp-skills` repository.

Before launching a configured agent, agent-run checks its Brain connection.
An enabled but unavailable Brain blocks launch; `--none` explicitly bypasses
configuration. For the local service, initialize it with `agent-brain init`,
start it with `agent-brain serve`, then launch the agent through `agent-run`.
Remote connection and login are described below.

Ordinary conversation only needs Brain lookups when it depends on saved
knowledge. Before substantial work, agents retrieve relevant constraints and
skills. Asking for work does not authorize creating saved tasks.

Run `agent-run update` after upgrading to refresh generated instructions.
Custom source templates and installed skills are preserved.

## Systemd Jobs

The repo includes optional systemd units for keeping global AI tooling current.
Run the installer from the agent-run checkout. Setup, generation, and updates do
not copy systemd units or helper scripts into `.agent-run`. Remove legacy copies
there once any custom changes have been moved to your maintained scripts.

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

The updater clears inherited `SUDO_USER` for its root-owned pnpm configuration
writes, so it works both under sudo and from a root shell. It explicitly allows
the Claude, Grok, esbuild, and pnpm install hooks. Optional native build hooks
such as keytar and node-pty remain subject to npm's script policy; the updater
does not enable native compilation or require a working node-gyp installation.

The optional apt package list still defaults to `gh` and can be changed with
`AI_TOOLS_APT_PACKAGES`.

To keep agent-brain running for a particular account, put
`AI_TOOLS_BRAIN_USERS="bjorn"` in `/etc/default/ai-tools-update`. The installer
also installs the user service and its management helper. After installing the
package, the updater enables that account's service, enables lingering so it
starts at boot without an interactive login, and restarts it to load the update.
No accounts are selected by default. The service remains owned by the selected
user and listens on that user's private Unix socket.

After a successful timer update, session cleanup runs as each selected user.
Set `AI_TOOLS_CLEANUP_USERS="bjorn"` in `/etc/default/ai-tools-update` to select
accounts; if unset, it uses `AI_TOOLS_BRAIN_USERS`. An explicitly empty value
disables scheduled cleanup. Each user's `~/.agent-run/cleanup.env` controls
retention, defaulting to seven days. Failures appear in the systemd journal.

On Windows, install hourly cleanup for the current user from PowerShell:

```powershell
$prefix = npm.cmd prefix -g
& "$prefix\node_modules\@technomoron\agent-run\scripts\install-windows-cleanup.ps1"
```

The `Agent Session Cleanup` task runs hidden without elevation while the user is
signed in, starting ten minutes after installation and repeating hourly. It uses
the same `cleanup.env` and seven-day default. Pass `-ConfigRoot PATH` to select
another configuration tree. Its latest output is in
`<config-root>/runtime/cleanup.log`. The task skips overlapping runs.

Node 24 or newer must be installed at `/usr/local/bin/node` before running the
updater. `AI_TOOLS_AGENT_RUN_PACKAGE` can select a package version or a
root-owned local package archive while testing an unpublished build; it defaults
to `@technomoron/agent-run@latest`. The updater's `--agent-brain` option installs
agent-run and manages the selected services. Set
`AI_TOOLS_AGENT_BRAIN_PACKAGE` to a separately accessible Brain package version
or a root-owned release archive to update the server in the same operation.
It is unset by default; remote Brain clients only need agent-run. The settings file is read
by the systemd job; when invoking the script directly, pass these environment
variables explicitly.

## Login Warning

For user-owned machines, `scripts/agent-config-login-warning.sh` can be called
from a shell startup file to warn about an optional, deliberately versioned
local configuration tree at `~/.agent-run`:

```csh
if ( -x "$HOME/bin/agent-config-login-warning" ) then
    "$HOME/bin/agent-config-login-warning"
endif
```

Git is optional for local launcher configuration. The helper only reads Git
status when the local root has its own `.git` directory, and stays quiet for
plain local profiles. Set `AGENT_CONFIG_TARGET` before calling it to inspect
another deliberately versioned tree.

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

This creates the annotated tag matching the package version and pushes that tag
to `origin`. It stops if the tag already exists, and removes the local tag again
if the push fails. The tag push triggers the release workflow, which runs the
tests and build, packs, publishes to npm, and creates the GitHub release.

`pnpm run release:preflight` is the local gate to run first: a clean build and
the full test suite. Update `package.json` and `CHANGES` yourself; nothing
checks them for you.

### Connect launched agents to a remote Brain

Set `remote` in your external configuration root's `brain.jsonc`:

```json
{
  "enabled": true,
  "remote": {
    "url": "https://brain.yesmedia.no/mcp",
    "clientId": "bjornjac-desktop",
    "redirectUrl": "http://127.0.0.1:8123/callback",
    "scope": "read write review repo:*"
  }
}
```

Local launcher files need no configuration Git checkout. Put only the connection
settings in `~/.agent-run/brain.jsonc`, then launch from a GitHub repository:

```sh
agent-run brain-login
cd ~/code/owner/repository
agent-run codex
```

On first launch, agent-run creates missing local launcher settings under
`~/.agent-run/projects/<owner>/<repo>/` and renders native configuration into
that profile's `live/` directory. Packaged defaults supply the local templates;
new remote roots retrieve skills through MCP instead of installing local copies.
Existing manifests, templates, registrations and explicit profile mappings are
preserved. Outside a mapped Git repository, a local default profile exposes
remote repository discovery. Server authorization is checked before launching;
creating a local profile does not register a repository on Brain or grant access.

The old `bjornjac/agent-configs` checkout is unnecessary for this mode. Preserve
custom local files when retiring its Git metadata. Brain's separate private
`bjornjac/agent-brain-config` repository still versions server knowledge and
configuration. OAuth tokens stay in private local runtime files. Existing local
Brain mode and deliberately Git-managed local profiles remain supported.

Run `agent-run brain-login` once, using `--configdir PATH` for another root.
Sign in through the browser; the registered loopback callback uses PKCE and a
validated OAuth state. Tokens live only under private `runtime/brain-remote/`
files, excluded from configuration Git. Concurrent agents share refresh state.
Generated Codex, Claude, Gemini and Grok configuration invokes the same stdio
bridge; no bearer token is embedded in generated files. The bridge selects the
repository from its GitHub origin, then its registered project name if needed.
Outside a mapped repository it exposes authenticated repository discovery.
A denied or unavailable remote Brain prevents launch; it does not silently use
local knowledge. Existing explicit MCP overrides still take precedence.
Remove `remote` to return to the local Brain service. Existing local configuration
requires no migration. Manual `agent-run create/project/mcp` administration still
uses the separately installed `agent-brain` executable.

Configuration push automation should validate a private repository revision,
fetch it into a staging directory on the server, and activate it atomically.
Only restart Brain when endpoint, repository storage, or client registration
changes require it; ordinary knowledge/skill edits are read on subsequent calls.
Do not overwrite live MCP-authored knowledge with an older Git checkout. Reconcile
or save those writes first. A GitHub push workflow should trigger this deployment
step with a restricted credential rather than expose a public reload URL.
