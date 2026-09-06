"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.linkSharedEntry = linkSharedEntry;
const fs = require("fs");
const path = require("path");
const constants_1 = require("../constants");
const utils_1 = require("../utils");
function linkSharedEntry(sourcePath, targetPath, label) {
    if (!fs.existsSync(sourcePath) && !(0, utils_1.isSymlink)(sourcePath)) {
        return;
    }
    if (path.resolve(sourcePath) === path.resolve(targetPath) || isSymlinkTo(targetPath, sourcePath)) {
        return;
    }
    if (fs.existsSync(targetPath) || (0, utils_1.isSymlink)(targetPath)) {
        const backupPath = (0, utils_1.nextBackupPath)(targetPath);
        fs.renameSync(targetPath, backupPath);
        (0, utils_1.verbose)(`backed up ${label} ${targetPath} -> ${backupPath}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    try {
        fs.symlinkSync(sourcePath, targetPath, fs.statSync(sourcePath).isDirectory() ? 'junction' : 'file');
        (0, utils_1.verbose)(`linked ${label} ${targetPath} -> ${sourcePath}`);
    }
    catch (error) {
        if (!constants_1.IS_WINDOWS || fs.statSync(sourcePath).isDirectory()) {
            throw error;
        }
        fs.copyFileSync(sourcePath, targetPath);
        (0, utils_1.verbose)(`copied ${label} ${sourcePath} -> ${targetPath}`);
    }
}
function isSymlinkTo(filePath, targetPath) {
    try {
        if (!fs.lstatSync(filePath).isSymbolicLink()) {
            return false;
        }
        const linkTarget = fs.readlinkSync(filePath);
        return path.resolve(path.dirname(filePath), linkTarget) === path.resolve(targetPath);
    }
    catch {
        return false;
    }
}
