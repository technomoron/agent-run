# agent-run

**Config once. Run with any native coding agent.**

For persistent knowledge, shared skills, and tasks, use the bundled
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
current task. Agents may update project memory when the user explicitly requests it or
authorizes a standing workflow, such as saving durable corrections and updating
affected specs. This authorization does not permit Git or external-service writes.

Codex's native `$CODEX_HOME/memories/` remains under ignored `live/` state. It
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

`agent-brain` gives the native agents the same project knowledge, skills, and
tasks through MCP. It uses the official Node MCP SDK. The persistent
service runs under `@technomoron/apicore-server` on a private Unix socket.
Node 24 or newer is required; SQLite and FTS come from Node, with no database
package to compile.

### Start using it

```sh
agent-brain init
agent-brain serve
```

Keep the service running, or enable the systemd user service described below.
In another terminal:

```sh
cd ~/code/my-project
agent-run create my-project --quick
agent-run codex
```

Omit `--quick` for the short interactive setup, or use `--guided` to add an
architecture summary, constraints, conventions, and a preferred agent.
Creation detects the source root, Git remote, languages, package manager,
documentation, and package scripts. It writes configuration outside the source
repository. Existing directories and duplicate project registrations are rejected.

`agent-run project list` lists registrations. `project info` shows the current
project, and `project bootstrap` returns detected information for the agent to
inspect and turn into proposals. Bootstrap does not invent or save architectural
facts; the agent can use the knowledge tools after the user confirms its proposals.

All commands accept `--configdir PATH`. Brain commands also accept `--cwd PATH`.
`agent-brain --help` lists the commands.

### Scopes and existing profiles

```text
~/.agent-run/
  brain.jsonc
  global/skills/<name>/SKILL.md
  global/constraints/*.md
  projects/my-project/
    agent-run.jsonc
    config.yaml
    project.md
    memory/*.md
    todo/*.md
    live/
  default/
    agent-run.jsonc
    skills/
    preferences/
    constraints/
    conventions/
    reviews/
    memory/*.md
    todo/
    templates/
    live/
  index/knowledge.sqlite
  runtime/
```

Inside a registered or existing configured project, retrieval includes global
and project knowledge. Elsewhere it includes global and default knowledge.
Default knowledge never appears in a configured project. Among registered
source roots, the most specific matching root wins; equal matches are rejected.
An explicit `AGENT_RUN_PROFILE` in `.agent-run.env` keeps precedence over registration.

Project names can include a namespace: `technomoron/agent-run` lives under
`projects/technomoron/agent-run`. The original name also works in
`AGENT_RUN_PROFILE`; no alias is needed.

Existing JSONC manifests, Nunjucks templates, and `org/repo` profiles remain
supported. Brain reads existing `notes/memory` directories in place, including
the config root's global notes. It does not move or delete them. New knowledge
uses the directories above. Existing files without metadata are treated as
inferred, relevant-only knowledge; adding metadata gives you explicit control.
Legacy review metadata is preserved, and reviews marked addressed or resolved
are excluded from active recall. Canonical `global/skills/<name>/SKILL.md` files
also support existing Nunjucks variables when served or rendered for native agents.

`agent-brain init` installs the shared brain skills and a default profile, and
creates `brain.jsonc` only if it does not exist. It preserves existing files.
It creates the topic directories shown above in global, default, and registered
project scopes, plus `rules/`, `decisions/`, `specs/`, and `observations/` for
the other knowledge types. Project creation uses the same layout. Empty topic
directories stay empty until there is relevant content to store.
Normal profile rendering then adds the brain MCP server and shared instructions
to Codex, Claude, Gemini, and Grok. An explicitly configured `agent-brain` MCP
entry takes precedence. Set `enabled` to `false` to stop automatic integration
and restore the previous unconfigured-project behavior.

```jsonc
{
  "enabled": true,
  "contextBudget": 16000,
  "connectors": {}
}
```

`contextBudget` counts serialized characters, not model tokens. A context result
reports omitted items. Use `get_knowledge` to read complete items when necessary.
Always-recalled knowledge is considered first, then matching file patterns,
then lexical results. Search uses FTS ranking with extra weight for titles and tags.
Queries compare the current files with the index and write only added, changed,
or removed entries. Unchanged queries do not take a database write lock. Context
retrieval scans the files once. Search and context MCP tools declare that they
may write because they can refresh this derived index.
Symbols contribute search terms. Manual Markdown changes are read on every query;
the index can be deleted while the service is stopped and rebuilt on the next query.

### Knowledge and skills

Malformed knowledge and task files do not block other entries. When a scan finds
problems, MCP and CLI list/search responses contain `items` and `brokenFiles`;
object responses, including context, gain a `brokenFiles` field. Each error lists
the source path, `status: "broken"`, a reason, and an ID when it can be parsed.
Responses without errors keep their existing format. Broken entries are excluded
from search and context, and reads or updates of those entries are refused.
Correct the file on disk; the next scan picks up the repair automatically.
Duplicate IDs flag all matching files. External task imports and new review
numbering stop when broken files would make deduplication or numbering unreliable.

Knowledge is one Markdown file per item, with YAML metadata:

```markdown
---
id: auth-refresh-single-use
type: constraint
scope: project
authority: user
status: active
recall: always
tags: [auth]
applies_to: ["src/auth/**"]
created: 2026-09-06
---

# Refresh tokens are single-use

A successfully consumed refresh token must never be accepted again.
```

The storage directories are `rules`, `preferences`, `conventions`, `constraints`,
`decisions`, `specs`, `reviews`, `memory`, and `observations`. Scope metadata must
match the file's directory. IDs must be unique across the active scopes.
Invalid metadata produces an error identifying the file. Symlinked storage
paths are rejected. Individual Markdown files are limited to 1 MiB.

Choose the scope and singular knowledge type when calling `remember`; MCP writes
the file into the corresponding directory. User preferences belong in
`preferences/`, requirements in `constraints/`, established practices in
`conventions/`, confirmed specifications in `specs/`, and confirmed choices in
`decisions/`. Code-derived facts remain inferred `observations/`; source
references and history belong in `memory/`, with planned features labeled as
plans. An import request does not make inferred content authoritative.
Use the todo tools for tasks. Reusable workflows are `skills/<name>/SKILL.md`
files, and reusable templates belong in `templates/`; `remember` does not
install either. Global skills remain available without copying them into each
project. The brain-memory skill explains these choices to native agents.

Available MCP tools include `get_context`, `search_knowledge`, `get_knowledge`,
`remember`, `amend_knowledge`, `promote`, `deprecate_knowledge`, `review_context`,
`review_list`, `resolve_review`, `review_history`, and `review_archive`.
Writes use atomic file replacement and a shared lock; concurrent writes either
complete or report that the caller should retry. After a crashed writer, stop
the service, verify the PID in `runtime/brain-write.lock` is no longer running,
and remove that lock before restarting.

```sh
agent-brain remember --json '{"scope":"project","type":"observation","title":"Refresh handling","content":"Investigate concurrent refresh requests."}'
agent-brain search "refresh"
agent-brain get ITEM_ID
agent-brain amend ITEM_ID --revision REVISION --json '{"content":"Corrected text."}'
agent-brain deprecate ITEM_ID --revision REVISION "No longer applies"
agent-brain promote ITEM_ID --scope global --revision REVISION --confirmed
```

`amend_knowledge` revises an active item in place, keeping its id, file name, scope,
type, authority, and history, and updating only the fields you pass. Use it to correct
or extend knowledge instead of writing a near-duplicate. Scope, type, authority, and
review severity are not amendable; if one of those is wrong, deprecate the item and
write a corrected one.

#### File names

`remember` names each file after the item id. Pass `filename` to choose the name
instead, as lower-case words separated by single dashes and no extension:

```sh
agent-brain remember --json '{"scope":"project","type":"observation","title":"Build flow","content":"...","filename":"build-flow"}'
```

If that name is taken, the item id is appended rather than overwriting anything. The
name is storage only and is never written into the metadata: the `id` in the front
matter is the identity, so files stay safe to rename by hand and the item is still found
by id afterwards.

#### Review findings

Review knowledge is a numbered, prioritized list. `remember` requires a
`severity` of `critical`, `high`, `medium`, or `low` when the type is `review`,
and rejects `severity` for every other type. The store assigns the finding
label itself: `C1`, `H1`, `M1`, `L1`, counting up per severity within the scope.
Resolved numbers are never handed out again, so a label always refers to the
same finding.

Each finding also carries a `state` of `open`, `fixed`, or `wontfix`, separate
from the `active` and `deprecated` status that controls recall. New findings
start `open`.

```sh
agent-brain review list
agent-brain review list --severity high --state open
agent-brain review resolve ITEM_ID --revision REVISION --state fixed "Fixed by using a stable command name"
```

`review_list` returns findings in severity then number order, open ones only
unless states are given, each with the revision needed to resolve it.
`resolve_review` records the state and reason and takes the finding out of active
recall. It writes a short record (label, title, outcome, date, reason, and original
file/revision) to the scope's `review-history.jsonl`, then deletes the full finding
file. `review-counters.json` preserves numbering. These files participate in brain
Git sync but are excluded from normal knowledge retrieval.

Use MCP `review_history` to recall old fixes, with optional `query`, `scope`, `state`,
`offset`, and `limit` (default 100). The CLI equivalent is
`agent-brain review history [query]`. Git retains full details only when the original
files were committed before cleanup; the MCP history is sufficient for the short fix list.
Use `review_archive` with a scope, or `agent-brain review archive --scope project`,
to compact existing files already marked `fixed` or `wontfix`. Deferred findings
remain open. Mark a finding `wontfix` only when the user explicitly drops it or
confirms it is intentional. A request to postpone an issue does not close it.

Finding labels are indexed, so `search_knowledge` for `H2` finds that finding.
Review files written before these fields existed keep parsing; they simply carry
no label and stay out of the finding list.

Remembered deductions default to inferred authority and must remain observations,
memories, or review records. Global writes require explicit user authority.
Promotion copies an item, records its origin, preserves the original, and requires
confirmation. Deprecation and promotion require the last-read revision so stale
requests cannot overwrite newer work. An agent's authority claim is an instruction
contract, not a separate authentication system; the Unix account owns the data.

Skills use YAML `name` and `description` metadata in `skills/<name>/SKILL.md`.
`list_skills` returns descriptions, and `get_skill` loads the body on demand.
A project/default skill overrides a global skill with the same name. Add
`extends: global:NAME` to include the global skill's instructions before the local
instructions. The existing native skill-template system continues to work.

Skill templates and their includes must stay under `global/skills/` or the active
project/default profile's `skills/` directory. Use config-root-relative paths such
as `{% include "global/skills/shared/checks.md" %}`, or `./` paths relative to the
including template. Nunjucks variables remain available. Symlinks are rejected,
and each file is limited to 1 MiB. Move snippets and skill overrides stored
elsewhere into these directories before rendering or loading those skills.

The installed `brain-memory`, `brain-review`, and `todo-manager` skills describe
retrieval, persistence, review learning, and task workflows. Review records use
the knowledge tools and remain inferred unless confirmed by the user.

### Tasks and connectors

Tasks are separate from knowledge and stored in `todo/<id>.md`. Supported states
are `todo`, `doing`, `blocked`, `done`, and `cancelled`. Tasks have titles,
descriptions, priorities, owners, due dates, labels, notes, and optional external
source identities.

```sh
agent-brain todo add --json '{"scope":"project","title":"Check refresh handling","priority":"high"}'
agent-brain todo list
agent-brain todo get ITEM_ID
agent-brain todo complete ITEM_ID --revision REVISION
```

MCP exposes `todo_list`, `todo_get`, `todo_add`, `todo_update`, `todo_complete`,
`todo_import`, and `todo_sync`. Update requests require the current revision.

Configure optional connectors in `brain.jsonc`:

```jsonc
{
  "enabled": true,
  "connectors": {
    "issues": {
      "type": "github",
      "repository": "my-org/my-project",
      "tokenEnv": "GITHUB_TOKEN"
    },
    "board": {
      "type": "trello",
      "board": "BOARD_ID",
      "keyEnv": "TRELLO_API_KEY",
      "tokenEnv": "TRELLO_TOKEN"
    }
  }
}
```

```sh
agent-brain todo import issues --scope project
agent-brain todo sync issues --scope project
```

Credentials are read from the process environment and never written to task files.
Set credentials in the service's environment.
GitHub imports paginate and exclude pull requests. Trello maps due-complete cards
to done, archived cards to cancelled, and other cards to todo; it does not guess
workflow states from list names.

Imports deduplicate by source identity and scope. Synchronization compares local
and remote fields against the last imported version, preserves local-only edits,
and reports conflicting task IDs without replacing those tasks. Deleted remote
items are retained locally. These connectors only read remote systems; completing
a local task does not close a GitHub issue or modify a Trello card.

### Git portability

```sh
agent-brain sync
agent-brain sync init --confirmed
agent-brain sync save --confirmed --message "Your approved commit message"
agent-brain sync pull --confirmed
agent-brain sync push --confirmed
```

The command without an action previews Git status and eligible files. Saving
includes Markdown knowledge, skills, tasks, project metadata, and `.gitignore`.
It also includes all regular files under each scope's `templates/` directory,
including nested Nunjucks templates and supporting files. Template additions,
edits, and deletions are synced; symlinks are rejected.
It excludes indexes, runtime state, secrets, `brain.jsonc`, and native agent
configuration. Existing staged changes block a save. Configure the remote and
upstream with normal Git commands using your existing credentials.
Brain Git operations use `AGENT_RUN_REAL_PATH` when available, so agent-session
Git guards do not intercept configuration sync.
After cloning onto another machine, run `agent-brain init` to restore generated
profile markers and shared templates, then update source roots in `config.yaml`
to match that machine.

The configuration directory must itself be the repository root. Pull uses rebase
and reports conflicted files; resolve conflicts before syncing again. Each action
requires explicit authorization. There are no automatic commits, pulls, or pushes.

### Persistent service under apicore-server

All native agents connect to the same long-lived service for the Unix user.
Start it on Linux or macOS:

```sh
agent-brain serve
```

The service hosts SDK Streamable HTTP at `/mcp` using apicore's Fastify instance.
It listens on `<config-root>/runtime/agent-brain.sock`, which defaults to
`~/.agent-run/runtime/agent-brain.sock`. Both the service and clients use the
configured root regardless of their environment. The socket
directory must belong to the current user and have mode `0700`; the socket has
mode `0600`. No TCP listener or application user database is created.

Generated native-agent configurations run `agent-brain mcp` through `PATH`, so
`agent-brain` must be installed and available there. The bridge selects the socket
when it starts; generated files do not depend on the installation or runtime
directory used to render them. Re-render existing profiles with `agent-run update`
to replace older commands that contain absolute installation paths. After
upgrading from a version that used a different socket location, restart the service and
agent sessions so they use the socket under the configuration root.

`agent-run mcp` also bridges native-agent stdio to this socket. Use `--socket PATH`
for a particular service. The bridge verifies the socket's ownership and private
permissions. A missing or unreachable socket is an error; start the service
before connecting. There is no standalone stdio server or TCP fallback. Apicore
supports Unix sockets directly, so localhost binding is unnecessary. The brain
service currently requires Linux or macOS.

After a crash, remove a stale socket only after checking that its service is
stopped. Starting a second service on an existing socket fails without replacing
the first service's socket.

For a user service, copy `ops/systemd/agent-brain.service` to
`~/.config/systemd/user/` and adjust `ExecStart` if your executable is elsewhere.
Add `--configdir PATH` to `ExecStart` if you use a custom configuration root.
Run `systemctl --user daemon-reload` followed by
`systemctl --user enable --now agent-brain`. Installation is explicit.

The supplied service uses `serve --pull`. On startup this pulls the configuration
repository with `--ff-only --no-rebase` when it is clean and has an upstream.
Dirty checkouts and missing upstreams are skipped. Divergence or network failures
are reported in the service journal and the service continues with local files.
Startup never commits, pushes, stashes, or rebases local work. Omit `--pull` to
disable this behavior for a manually launched service.

The AI tools updater can install and restart the service for explicitly selected
accounts; see [Systemd Jobs](#systemd-jobs). Existing user unit
overrides still take precedence over the installed system-wide user unit.

Each HTTP request resolves the proxy's source directory through agent-run's
resolver. Tools cannot select another project's scope through arguments. The
service shares canonical files and the SQLite index; it does not keep a watcher
or a separate authoritative cache.

### Remaining roadmap

The initial implementation uses lexical retrieval and path matching. Embeddings,
vector ranking, background watchers, debounced automatic Git synchronization,
remote task writes, and additional connectors remain future work. No model
provider or external account is required for the local features.

Transport and connector implementations follow the
[Node MCP SDK server documentation](https://ts.sdk.modelcontextprotocol.io/server),
[GitHub Issues REST API](https://docs.github.com/en/rest/issues/issues), and
[Trello board API](https://developer.atlassian.com/cloud/trello/rest/api-group-boards/).

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

The optional apt package list still defaults to `gh` and can be changed with
`AI_TOOLS_APT_PACKAGES`.

To keep agent-brain running for a particular account, put
`AI_TOOLS_BRAIN_USERS="bjorn"` in `/etc/default/ai-tools-update`. The installer
also installs the user service and its management helper. After installing the
package, the updater enables that account's service, enables lingering so it
starts at boot without an interactive login, and restarts it to load the update.
No accounts are selected by default. The service remains owned by the selected
user and listens on that user's private Unix socket.

Node 24 or newer must be installed at `/usr/local/bin/node` before running the
updater. `AI_TOOLS_AGENT_RUN_PACKAGE` can select a package version or a
root-owned local package archive while testing an unpublished build; it defaults
to `@technomoron/agent-run@latest`. The updater's `--agent-brain` option installs
only this package and manages the selected services. The settings file is read
by the systemd job; when invoking the script directly, pass these environment
variables explicitly.

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

This creates the annotated tag matching the package version and pushes that tag
to `origin`. It stops if the tag already exists, and removes the local tag again
if the push fails. The tag push triggers the release workflow, which runs the
tests and build, packs, publishes to npm, and creates the GitHub release.

`pnpm run release:preflight` is the local gate to run first: a clean build and
the full test suite. Update `package.json` and `CHANGES` yourself; nothing
checks them for you.
