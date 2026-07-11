"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkTree = walkTree;
const fs = require("fs");
const path = require("path");
function walkTree(dir, visitor, options = {}) {
    if (options.shouldSkipDirectory?.(dir)) {
        return;
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        if (options.shouldPrune?.(entry)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && options.shouldSkipDirectory?.(fullPath)) {
            continue;
        }
        const result = visitor(fullPath, entry);
        if (entry.isDirectory() && result !== 'skip') {
            walkTree(fullPath, visitor, options);
        }
    }
}
