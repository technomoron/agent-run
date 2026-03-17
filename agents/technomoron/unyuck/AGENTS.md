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

# Repository Guidelines

## Project Description ##
This project is a drop in replacement for nunjucks preprocessor, that implements import, extends and block
compile time directives, with the purpose of outputting a single, merged file that can later be used by
the nunjucks library to run. It also supports asset extraction from the template, creating a list of
assets in the file(s) to be returned along with the flattened file.

Test templates are located in ./templates
Templates are resolved according to basePath + relative path (dir/name.njk)
Relative to parent works in all paths, with ../ in filename
Assets are extracted with asset(url, mode). If asset is stating with a URI schema (http[s]), leave
the link intact. Otherwise if mode is false, create a relative link according to baseUrl. If true,
create a cid:* for inlining in email.

Make sure we have 2 public entry points:
flatten() -> return flattened file that can conditionally take assets or not.
toAst() -> return template as AST and conditionally take assets or not.

## Project Structure & Module Organization
`src/` contains the TypeScript implementation of the template flattener (entry point: `src/flatten.ts` and parser/asset helpers in `src/flatten.ts`. Test fixtures and example templates live in `templates/`, with reusable partials under `templates/parts/` and assets under `templates/assets/`. Runtime build artifacts are emitted to `dist/`, and Vitest suites reside in `tests/`, mirroring template scenarios such as nesting and whitespace trimming.

## Build, Test, and Development Commands
Use `npm run build` to compile TypeScript to ES2020 JavaScript in `dist/`. `npm run start` runs the CLI harness via `tsx src/index.ts`, useful for manual template checks. `npm run test` executes the Vitest suites once; add `npx vitest --watch` while iterating on parser changes.

## Coding Style & Naming Conventions
Write modern TypeScript with full typechecking, keep `strict` mode happy, everything explicitly typed. Follow the repository default of two-space indentation in new code, even if legacy files use tabs. Use `camelCase` for functions and variables, `PascalCase` for exported types/classes, and `SCREAMING_SNAKE_CASE` only for constants that truly behave as config. Keep modules small and focused; when adding helpers, co-locate them near the existing parser utilities.

## Testing Guidelines
All behavior changes need matching `*.test.ts` coverage under `tests/`. Mirror the naming style from `tests/nesting_trim.test.ts` (describe blocks keyed by template filename, it-blocks for AST vs HTML expectations). Reuse the shared `processor` fixture in `tests/util.ts` so tests exercise the same base directory and CDN URL. Run `npm run test` before submitting, and extend template fixtures in `templates/` whenever a new edge case is introduced.

## Commit & Pull Request Guidelines
Use short, imperative commit subjects (`Add asset extraction guard`, `Refine trim passing`). Reference related Vitest files or templates in the body when context is helpful. For pull requests, include: a concise summary, confirmation that `npm run test` passes, linked issues (if any), and notes about new fixtures or assets. Screenshots are optional but welcome when demonstrating rendered output.

## Template Fixtures & Assets
When altering template scenarios, update the paired fixture in `templates/` and ensure assets resolve through `asset()` so `flattenWithAssets` keeps working. Keep dummy binaries like `logo.png` lightweight; prefer placeholders unless realistic assets are required for the test.
