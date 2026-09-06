"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageVersion = packageVersion;
const fs = require("fs");
const path = require("path");
let cached = null;
/**
 * The package version, read from package.json next to the compiled output.
 * This is the single source; nothing else in the tree hardcodes a version.
 */
function packageVersion() {
    if (cached === null) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
            cached = typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
        }
        catch {
            cached = '0.0.0';
        }
    }
    return cached;
}
