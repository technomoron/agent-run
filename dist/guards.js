"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGuardShims = renderGuardShims;
const path = require("path");
const constants_1 = require("./constants");
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
        'for arg in "$@"; do',
        '  case "$arg" in',
        '    commit|tag|push)',
        '      if [ "${AGENT_RUN_ALLOW_GIT_WRITE:-}" != "1" ]; then',
        '        echo "agent-run: blocked git $arg. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation." >&2',
        '        exit 42',
        '      fi',
        '      ;;',
        '  esac',
        'done',
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
        'echo agent-run: blocked git write. Review and run it manually, or set AGENT_RUN_ALLOW_GIT_WRITE=1 for this invocation. 1>&2',
        'exit /b 42'
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
