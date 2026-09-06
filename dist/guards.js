"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGuardShims = renderGuardShims;
const path = require("path");
const constants_1 = require("./constants");
const GIT_TEST_REPO_MARKER = '.agent-run-test-repo';
function renderGuardShims(context) {
    const names = [];
    if (context.guardrails.blockGitWrite) {
        names.push('git');
    }
    if (context.guardrails.blockPublish) {
        names.push('npm', 'pnpm');
    }
    if (context.guardrails.blockGithubRelease) {
        names.push('gh');
    }
    if (constants_1.IS_WINDOWS) {
        return names.map((name) => ({
            path: path.join(context.paths.binDir, `${name}.cmd`),
            content: windowsShim(name)
        }));
    }
    return names.map((name) => ({
        path: path.join(context.paths.binDir, name),
        content: name === 'git'
            ? posixGitShim()
            : name === 'gh'
                ? posixGhShim()
                : posixPublishShim(name),
        executable: true
    }));
}
function posixGitShim() {
    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'agent_run_test_repo() {',
        '  local dir="$PWD"',
        '  while [ "$#" -gt 0 ]; do',
        '    case "$1" in',
        '      -C)',
        '        [ "$#" -ge 2 ] || return 1',
        '        dir="$(cd -- "$dir" 2>/dev/null && cd -- "$2" 2>/dev/null && pwd -P)" || return 1',
        '        shift 2 ;;',
        '      -c)',
        '        [ "$#" -ge 2 ] || return 1',
        '        shift 2 ;;',
        '      --git-dir*|--work-tree*) return 1 ;;',
        '      -*) shift ;;',
        '      *) break ;;',
        '    esac',
        '  done',
        '  dir="$(cd -- "$dir" 2>/dev/null && pwd -P)" || return 1',
        '  while :; do',
        `    if [ -e "$dir/${GIT_TEST_REPO_MARKER}" ]; then return 0; fi`,
        '    [ "$dir" != "/" ] || return 1',
        '    dir="${dir%/*}"',
        '    [ -n "$dir" ] || dir="/"',
        '  done',
        '}',
        'blocked=""',
        'for arg in "$@"; do',
        '  case "$arg" in',
        '    commit|tag|push) blocked="$arg"; break ;;',
        '  esac',
        'done',
        'if [ -n "$blocked" ] && [ "${AGENT_RUN_ALLOW_GIT_WRITE:-}" != "1" ] && ! agent_run_test_repo "$@"; then',
        '  echo "agent-run: blocked git $blocked. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation." >&2',
        '  exit 42',
        'fi',
        ...posixRunRealCommand('git'),
        ''
    ].join('\n');
}
function posixPublishShim(tool) {
    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'for arg in "$@"; do',
        '  if [ "$arg" = "publish" ] && [ "${AGENT_RUN_ALLOW_PUBLISH:-}" != "1" ]; then',
        `    echo "agent-run: blocked ${tool} publish. Review and run it manually, or set AGENT_RUN_ALLOW_PUBLISH=1 for this invocation." >&2`,
        '    exit 42',
        '  fi',
        'done',
        ...posixRunRealCommand(tool),
        ''
    ].join('\n');
}
function posixGhShim() {
    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'saw_release=0',
        'for arg in "$@"; do',
        '  if [ "$arg" = "release" ]; then',
        '    saw_release=1',
        '  elif [ "$saw_release" = "1" ] && [ "$arg" = "create" ] && [ "${AGENT_RUN_ALLOW_GITHUB_RELEASE:-}" != "1" ]; then',
        '    echo "agent-run: blocked gh release create. Review and run it manually, or set AGENT_RUN_ALLOW_GITHUB_RELEASE=1 for this invocation." >&2',
        '    exit 42',
        '  fi',
        'done',
        ...posixRunRealCommand('gh'),
        ''
    ].join('\n');
}
function posixRunRealCommand(tool) {
    return [
        'shim_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"',
        'real_path="${AGENT_RUN_REAL_PATH:-}"',
        'if [ -z "$real_path" ]; then',
        '  case "${PATH:-}" in',
        '    "$shim_dir") real_path="" ;;',
        '    "$shim_dir":*) real_path="${PATH#*:}" ;;',
        '    *) real_path="${PATH:-}" ;;',
        '  esac',
        'fi',
        `real_command="$(PATH="$real_path" command -v ${tool} || true)"`,
        'if [ -z "$real_command" ]; then',
        `  echo "agent-run: cannot find the real ${tool} command outside the guard directory." >&2`,
        '  exit 127',
        'fi',
        `if [ "$real_command" = "$shim_dir/${tool}" ]; then`,
        `  echo "agent-run: refused recursive ${tool} guard resolution." >&2`,
        '  exit 127',
        'fi',
        'PATH="$real_path" exec "$real_command" "$@"'
    ];
}
function windowsShim(name) {
    const executable = name === 'npm' || name === 'pnpm' ? `${name}.cmd` : `${name}.exe`;
    const guard = name === 'git' ? windowsGitGuard() : name === 'gh' ? windowsGhGuard() : windowsPublishGuard(name);
    const helpers = name === 'git' ? windowsGitTestRepo() : [];
    return [
        '@echo off',
        ...guard,
        ':run',
        'if defined AGENT_RUN_REAL_PATH (',
        '  set "PATH=%AGENT_RUN_REAL_PATH%"',
        ') else (',
        '  for /f "tokens=1,* delims=;" %%A in ("%PATH%") do set "PATH=%%B"',
        ')',
        `${executable} %*`,
        ...(helpers.length ? ['exit /b %ERRORLEVEL%', '', ...helpers] : []),
        ''
    ].join('\n');
}
function windowsGitGuard() {
    return [
        ':scan',
        'if "%~1"=="" goto run',
        'if /I "%~1"=="commit" goto block_git',
        'if /I "%~1"=="tag" goto block_git',
        'if /I "%~1"=="push" goto block_git',
        'shift',
        'goto scan',
        ':block_git',
        'if "%AGENT_RUN_ALLOW_GIT_WRITE%"=="1" goto run',
        'call :agent_run_test_repo %*',
        'if not errorlevel 1 goto run',
        'echo agent-run: blocked git write. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation. 1>&2',
        'exit /b 42'
    ];
}
function windowsGitTestRepo() {
    return [
        ':agent_run_test_repo',
        'setlocal enabledelayedexpansion',
        'set "TARGET=%CD%"',
        ':agent_run_scan',
        'if "%~1"=="" goto agent_run_walk',
        'if /I "%~1"=="-C" goto agent_run_chdir',
        'if /I "%~1"=="-c" (shift & shift & goto agent_run_scan)',
        'set "ARG=%~1"',
        'if /I "!ARG:~0,9!"=="--git-dir" goto agent_run_deny',
        'if /I "!ARG:~0,11!"=="--work-tree" goto agent_run_deny',
        'if "!ARG:~0,1!"=="-" (shift & goto agent_run_scan)',
        'goto agent_run_walk',
        ':agent_run_chdir',
        'if "%~2"=="" goto agent_run_deny',
        'pushd "!TARGET!" 2>nul',
        'if errorlevel 1 goto agent_run_deny',
        'pushd "%~2" 2>nul',
        'if errorlevel 1 (popd & goto agent_run_deny)',
        'set "TARGET=!CD!"',
        'popd',
        'popd',
        'shift',
        'shift',
        'goto agent_run_scan',
        ':agent_run_walk',
        `if exist "!TARGET!\\${GIT_TEST_REPO_MARKER}" (endlocal & exit /b 0)`,
        'for %%D in ("!TARGET!\\..") do set "PARENT=%%~fD"',
        'if /I "!PARENT!"=="!TARGET!" goto agent_run_deny',
        'set "TARGET=!PARENT!"',
        'goto agent_run_walk',
        ':agent_run_deny',
        'endlocal & exit /b 1'
    ];
}
function windowsGhGuard() {
    return [
        'set "SAW_RELEASE=0"',
        ':scan',
        'if "%~1"=="" goto run',
        'if /I "%~1"=="release" set "SAW_RELEASE=1"',
        'if "%SAW_RELEASE%"=="1" if /I "%~1"=="create" goto block_release',
        'shift',
        'goto scan',
        ':block_release',
        'if "%AGENT_RUN_ALLOW_GITHUB_RELEASE%"=="1" goto run',
        'echo agent-run: blocked gh release create. Review and run it manually, or set AGENT_RUN_ALLOW_GITHUB_RELEASE=1 for this invocation. 1>&2',
        'exit /b 42'
    ];
}
function windowsPublishGuard(name) {
    return [
        ':scan',
        'if "%~1"=="" goto run',
        'if /I "%~1"=="publish" goto block_publish',
        'shift',
        'goto scan',
        ':block_publish',
        'if "%AGENT_RUN_ALLOW_PUBLISH%"=="1" goto run',
        `echo agent-run: blocked ${name} publish. Review and run it manually, or set AGENT_RUN_ALLOW_PUBLISH=1 for this invocation. 1>&2`,
        'exit /b 42'
    ];
}
