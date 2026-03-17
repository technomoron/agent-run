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

# AGENTS.md

This file defines rules and expectations for automated agents (AI code assistants, bots, CI agents, and other non-human
actors) interacting with this repository.

---

## Commit and Change Logging Rules

- **Automated commits or pull requests:** Not allowed unless explicitly requested.
- **Commit identity:** Commits must use the maintainer's configured git identity (human name/email).
- **Contributor attribution:** Do not use `Claude`, `Codex`, `ChatGPT`, or other AI identities in git author/committer
  fields, co-author trailers, or commit metadata. Do not add `Co-Authored-By` trailers to commit messages.

If code is generated or substantially modified by an automated agent:

- All commits must be recorded in the affected package `CHANGES` file (for example: `packages/server/CHANGES`,
  `packages/client/CHANGES`).
- The use of an automated agent must be clearly disclosed.
- Disclosure must appear in the corresponding package `CHANGES` entry (not in the commit message).
- Disclosure must contain detailed LLM profile info (provider/product + model + agent + mode/effort level).
- Use explicit profile-style identifiers (for example: `chatgpt-5.3-codex/medium` or `gpt-5/codex-high`); generic labels
  like `Codex`, `ChatGPT`, `GPT-5`, or `default` are not sufficient on their own.
- No claim of human authorship may be implied for AI-generated content.

Maintainers may reject contributions that do not disclose automated involvement.

When modifying this repository (if explicitly authorized):

- Workspace-level `CHANGES` files are not allowed.
- Release notes must be maintained only in per-package `CHANGES` files.
- The relevant package `CHANGES` file must be updated for every commit that changes that package.
- New change entries added after a released version must always be placed at the top of the package `CHANGES` under
  `Unreleased (<YYYY-MM-DD>)`.
- If an `Unreleased` section already exists, append new bullets to that existing top section instead of creating a
  second one.
- When bumping package version/revision/patch for a release, convert the current top package `Unreleased (<YYYY-MM-DD>)`
  section into `Version <bumped-version> (<YYYY-MM-DD>)` before tagging/publishing.
- Keep release sections in descending order below `Unreleased`.
- Use concise bullet points describing user-visible behavior changes, fixes, docs updates, and security changes.
- For AI-generated or AI-assisted work, include a disclosure bullet in the same `Unreleased` section using parentheses.

Required `CHANGES` format:

- Applies to each package `CHANGES` file.
- First line: `CHANGES`
- Second line: `=======`
- Top section header: `Unreleased (<YYYY-MM-DD>)`
- Entry format: `- <type(scope)>: <short description>`
- AI disclosure format: `- (Changes generated/assisted by <agent> (profile: <provider-product-model-agent/mode>).)`

---

## Package and Dependency Management Rules

When modifying code (if explicitly authorized):

- Do not add, remove, or upgrade dependencies unless explicitly requested.

---

## Scope and Safety Rules

Write or modify access is permitted **only** when one of the following conditions is met:

1. A maintainer explicitly requests changes from an automated agent in an issue, pull request, or other documented
   instruction.
2. A maintainer provides a direct prompt authorizing code changes for a clearly defined task and scope.

In all cases:

- Changes must be strictly limited to the requested scope.
- No additional refactors, cleanups, stylistic changes, or behavior changes are permitted unless explicitly requested.

If explicit instructions from a maintainer conflict with this file, the maintainer's instructions take precedence.
