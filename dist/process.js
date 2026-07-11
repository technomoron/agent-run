"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findRealBinary = findRealBinary;
exports.execTool = execTool;
exports.execCommand = execCommand;
exports.openEditor = openEditor;
exports.parseEditorCommand = parseEditorCommand;
const fs = require("fs");
const path = require("path");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const crossSpawn = require('cross-spawn');
function findRealBinary(tool) {
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const currentScriptArg = process.argv[1];
    const currentScript = currentScriptArg ? fs.realpathSync(currentScriptArg) : '';
    const wrappers = wrapperCandidates(tool);
    for (const dir of pathDirs) {
        for (const extension of (0, utils_1.getExecutableExtensions)(tool)) {
            const candidate = path.join(dir, `${tool}${extension}`);
            if (!fs.existsSync(candidate) || !(0, utils_1.isExecutable)(candidate)) {
                continue;
            }
            const resolvedCandidate = safeRealpath(candidate);
            if (resolvedCandidate === currentScript || wrappers.has(resolvedCandidate)) {
                continue;
            }
            if (isAgentRunRedirectShim(candidate)) {
                (0, utils_1.verbose)(`skip ${tool} redirect shim: ${candidate}`);
                continue;
            }
            return candidate;
        }
    }
    (0, utils_1.fail)(`no ${tool} binary found in PATH`);
}
function wrapperCandidates(tool) {
    const names = [
        tool,
        `${tool}.js`,
        `${tool}.cmd`,
        `${tool}.bat`,
        `${tool}.exe`,
        'agent-run',
        'agent-run.js',
        'agent-run.cmd',
        'agent-run.bat',
        'agent-run.exe'
    ];
    return new Set(names.map((name) => path.join(__dirname, name)).filter(fs.existsSync).map(safeRealpath));
}
function safeRealpath(filePath) {
    try {
        return fs.realpathSync(filePath);
    }
    catch {
        return filePath;
    }
}
function isAgentRunRedirectShim(filePath) {
    try {
        const handle = fs.openSync(filePath, 'r');
        try {
            const buffer = Buffer.alloc(4096);
            const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
            return buffer.subarray(0, bytesRead).toString('utf8').includes('Run agent-run instead');
        }
        finally {
            fs.closeSync(handle);
        }
    }
    catch {
        return false;
    }
}
function execTool(command, args) {
    (0, utils_1.verbose)(`exec tool: ${(0, utils_1.formatCommand)(command, args)}`);
    execCommand(command, args);
}
function execCommand(command, args, env, cwd, onExit) {
    (0, utils_1.verbose)(`spawn: ${(0, utils_1.formatCommand)(command, args)} cwd=${cwd ?? process.cwd()}`);
    const child = crossSpawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        const originalCode = code === null ? 1 : code;
        process.exit(onExit ? onExit(originalCode) : originalCode);
    });
    child.on('error', (error) => (0, utils_1.fail)(error.message));
}
function openEditor(filePath) {
    const configuredEditor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim();
    if (configuredEditor) {
        runConfiguredEditor(configuredEditor, filePath);
        return;
    }
    const vscodeCommand = findVsCodeEditorCommand();
    if (vscodeCommand !== null) {
        execCommand(vscodeCommand, ['--reuse-window', filePath]);
        return;
    }
    const fallbackEditor = findFallbackEditor();
    if (fallbackEditor !== null) {
        execCommand(fallbackEditor, [filePath]);
        return;
    }
    if (constants_1.IS_WINDOWS) {
        execCommand('explorer.exe', [filePath]);
    }
    else if (process.platform === 'darwin') {
        execCommand('open', [filePath]);
    }
    else {
        execCommand('xdg-open', [filePath]);
    }
}
function runConfiguredEditor(commandLine, filePath) {
    let editorArgs;
    try {
        editorArgs = parseEditorCommand(commandLine);
    }
    catch (error) {
        (0, utils_1.fail)(`invalid editor command: ${(0, utils_1.formatError)(error)}`);
    }
    const [command, ...args] = editorArgs;
    if (!command) {
        (0, utils_1.fail)('invalid editor command: command is empty');
    }
    execCommand(command, [...args, filePath]);
}
function parseEditorCommand(commandLine) {
    const args = [];
    let current = '';
    let quote = null;
    let tokenStarted = false;
    for (let index = 0; index < commandLine.length; index += 1) {
        const character = commandLine[index] ?? '';
        if (quote !== null) {
            if (character === quote) {
                quote = null;
                continue;
            }
            if (character === '\\' && quote === '"') {
                const next = commandLine[index + 1];
                if (next === '"' || next === '\\') {
                    current += next;
                    index += 1;
                    continue;
                }
            }
            current += character;
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
            tokenStarted = true;
            continue;
        }
        if (/\s/.test(character)) {
            if (tokenStarted) {
                args.push(current);
                current = '';
                tokenStarted = false;
            }
            continue;
        }
        if (character === '\\') {
            const next = commandLine[index + 1];
            if (next !== undefined && (/\s/.test(next) || next === "'" || next === '"' || next === '\\')) {
                current += next;
                index += 1;
                tokenStarted = true;
                continue;
            }
        }
        current += character;
        tokenStarted = true;
    }
    if (quote !== null) {
        throw new Error(`unterminated ${quote} quote`);
    }
    if (tokenStarted) {
        args.push(current);
    }
    if (args.length === 0) {
        throw new Error('command is empty');
    }
    return args;
}
function findVsCodeEditorCommand() {
    if (!isRunningInVsCodeTerminal()) {
        return null;
    }
    return ['code', 'codium'].map(utils_1.findExecutable).find((command) => command !== null) ?? null;
}
function isRunningInVsCodeTerminal() {
    const termProgram = process.env.TERM_PROGRAM?.trim().toLowerCase();
    return (termProgram === 'vscode' ||
        Boolean(process.env.VSCODE_GIT_IPC_HANDLE) ||
        Boolean(process.env.VSCODE_IPC_HOOK) ||
        Boolean(process.env.VSCODE_IPC_HOOK_CLI));
}
function findFallbackEditor() {
    const candidates = constants_1.IS_WINDOWS ? ['notepad.exe'] : ['joe', 'sensible-editor', 'editor', 'nano', 'nvim', 'vim', 'vi'];
    return candidates.map(utils_1.findExecutable).find((command) => command !== null) ?? null;
}
