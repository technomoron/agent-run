"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSamePathOrDescendant = isSamePathOrDescendant;
exports.parseBooleanEnv = parseBooleanEnv;
exports.localDateString = localDateString;
exports.formatError = formatError;
exports.verbose = verbose;
exports.formatCommand = formatCommand;
exports.fail = fail;
exports.uniqueSorted = uniqueSorted;
exports.formatPathList = formatPathList;
exports.getExecutableExtensions = getExecutableExtensions;
exports.isExecutable = isExecutable;
exports.findExecutable = findExecutable;
exports.isSymlink = isSymlink;
exports.nextBackupPath = nextBackupPath;
const fs = require("fs");
const path = require("path");
const constants_1 = require("./constants");
function isSamePathOrDescendant(candidatePath, parentPath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function parseBooleanEnv(value) {
    if (value === undefined) {
        return false;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
function localDateString() {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
function verbose(message) {
    if (parseBooleanEnv(process.env[constants_1.VERBOSE_ENV])) {
        process.stderr.write(`agent-run: ${message}\n`);
    }
}
function formatCommand(command, args) {
    return [command, ...args].map(quoteArg).join(' ');
}
function quoteArg(value) {
    if (value === '') {
        return '""';
    }
    if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
        return value;
    }
    return JSON.stringify(value);
}
function fail(message) {
    process.stderr.write(`agent-run: ${message}\n`);
    process.exit(1);
}
function uniqueSorted(values) {
    return [...new Set(values.map((value) => path.resolve(value)))].sort((a, b) => a.localeCompare(b));
}
function formatPathList(paths) {
    return paths.length === 0 ? ['  (none)'] : paths.map((entry) => `  ${entry}`);
}
function getExecutableExtensions(tool) {
    if (!constants_1.IS_WINDOWS || path.extname(tool)) {
        return [''];
    }
    return (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .filter(Boolean)
        .map((entry) => entry.toLowerCase());
}
function isExecutable(filePath) {
    try {
        if (constants_1.IS_WINDOWS) {
            return fs.statSync(filePath).isFile();
        }
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function findExecutable(command) {
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
        for (const extension of getExecutableExtensions(command)) {
            const candidate = path.join(dir, `${command}${extension}`);
            if (fs.existsSync(candidate) && isExecutable(candidate)) {
                return candidate;
            }
        }
    }
    return null;
}
function isSymlink(filePath) {
    try {
        return fs.lstatSync(filePath).isSymbolicLink();
    }
    catch {
        return false;
    }
}
function nextBackupPath(filePath) {
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    let candidate = `${filePath}.bak.${timestamp}`;
    let index = 1;
    while (fs.existsSync(candidate) || isSymlink(candidate)) {
        candidate = `${filePath}.bak.${timestamp}.${index}`;
        index += 1;
    }
    return candidate;
}
