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

#agent api-server-base

## Project Snapshot
- Monorepo for `apicore`, a strict TypeScript Fastify API framework.
- Published packages:
  - `@technomoron/apicore-server` in `packages/server`
  - `@technomoron/apicore-client` in `packages/client`
- Root package is private and exists to manage the workspace, not as a published library.

## Scope and Safety Rules
- Read-only by default unless a maintainer explicitly requests changes.
- Keep changes strictly limited to the requested scope.
- Do not add refactors, cleanup, style churn, or behavior changes unless explicitly requested.
- Do not add, remove, or upgrade dependencies unless explicitly requested.
- Do not modify authentication, authorization, or other security-sensitive code unless explicitly instructed.
- Backward compatibility is required unless the maintainer explicitly approves a breaking change.
- Existing tests are part of the behavioral spec. Do not weaken or rewrite them unless explicitly instructed.

## Change Logging
- If you make code changes, update the affected package `CHANGES` file for every commit.
- Do not use a workspace-level `CHANGES` file.
- Add entries under the top package `Unreleased (<YYYY-MM-DD>)` section.
- Include explicit AI-assistance disclosure in the same package `CHANGES` section.
- Do not use AI identities in git author, committer, co-author, or commit metadata.

## Workspace Layout
- `packages/server` contains the Fastify server framework, auth flows, JWT, OAuth, passkeys, uploads, and OpenAPI output.
- `packages/client` contains the HTTP client for server APIs.
- `packages/server/docs` contains architecture and auth docs; `packages/server/docs/swagger/openapi.json` is the generated OpenAPI artifact.
- Treat generated output like `dist/` as build artifacts; do not edit generated files manually.

## Tooling and Validation
- Node 22+ is required.
- Root scripts:
  - `pnpm -r build`
  - `pnpm -r test`
  - `pnpm -r lint`
- Server package important scripts:
  - `pnpm --filter @technomoron/apicore-server test`
  - `pnpm --filter @technomoron/apicore-server lint`
  - `pnpm --filter @technomoron/apicore-server cleanbuild`
- Client package important scripts:
  - `pnpm --filter @technomoron/apicore-client test`
  - `pnpm --filter @technomoron/apicore-client lint`
  - `pnpm --filter @technomoron/apicore-client cleanbuild`
- Prefer running targeted package checks for touched code, then broader workspace checks when a change spans packages.

## Coding Conventions
- Strict TypeScript throughout the repo.
- Follow existing formatting and file organization exactly; do not reformat unrelated code.
- Respect the existing ESLint flat config and import ordering rules.
- Preserve ESM and CJS build outputs for published packages.
- Keep public APIs, exported types, and documented behavior stable unless explicitly asked to change them.

## Docs Rules
- Follow the repo's OpenAPI/Swagger documentation rules in `agents/SWAGGER.md`.
- When documenting API modules, keep the split between `base`, `auth`, `passkey`, and `oauth`, while producing a single joined output file.
- Mark optional modules as optional and note that they require the relevant module to be enabled in server config.
