#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEditorCommand = exports.resolveProfile = exports.resolveAgentDir = exports.findProjectRoot = exports.defaultConfigRootSearchCandidates = exports.defaultConfigRoot = exports.parseInvocation = void 0;
const path = require("path");
const commands_1 = require("./commands");
var cli_1 = require("./cli");
Object.defineProperty(exports, "parseInvocation", { enumerable: true, get: function () { return cli_1.parseInvocation; } });
var project_1 = require("./project");
Object.defineProperty(exports, "defaultConfigRoot", { enumerable: true, get: function () { return project_1.defaultConfigRoot; } });
Object.defineProperty(exports, "defaultConfigRootSearchCandidates", { enumerable: true, get: function () { return project_1.defaultConfigRootSearchCandidates; } });
Object.defineProperty(exports, "findProjectRoot", { enumerable: true, get: function () { return project_1.findProjectRoot; } });
Object.defineProperty(exports, "resolveAgentDir", { enumerable: true, get: function () { return project_1.resolveAgentDir; } });
Object.defineProperty(exports, "resolveProfile", { enumerable: true, get: function () { return project_1.resolveProfile; } });
var process_1 = require("./process");
Object.defineProperty(exports, "parseEditorCommand", { enumerable: true, get: function () { return process_1.parseEditorCommand; } });
if (require.main === module) {
    (0, commands_1.main)(path.basename(process.argv[1] ?? 'agent-run'), process.argv.slice(2));
}
