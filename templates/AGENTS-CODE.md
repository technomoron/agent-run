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

    CHANGES
    =======

    vX.Y.Z (yyyy-mm-dd)
    -------------------
    * [change 1 ...]

## Linting

- If any lint config exists, then lint check and format.


## Testing

- Before committing, if there are tests to run, run them and make sure they
  pass.

## Code Reviews

- If asked for a code review, always save the review report in the current
  project's mapped agent directory.
- Write review reports as Markdown files named `REVIEW.md`.
- Include the review date in the contents of `REVIEW.md`.
- Put the findings in the saved report as well as in the user-facing reply.

## LICENSE

- Always make sure there is a LICENSE file present, and if package.json
  exists, check that it is duly noted.
- If package.json exists, check if copyright is added.

## COMMITTING

- Before committing, always check that we do not include any AI file in the
  repo or in .gitignore (that means AGENTS.md, CLAUDE.md, .claude, .codex, or
  any other you are aware of).
