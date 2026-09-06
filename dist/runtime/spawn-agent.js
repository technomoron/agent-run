"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawnAgent = spawnAgent;
const process_1 = require("../process");
function spawnAgent(spec) {
    (0, process_1.execCommand)(spec.command, spec.args, spec.env, spec.cwd, spec.onExit);
}
