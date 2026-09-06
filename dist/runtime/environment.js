"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentEnvironment = buildAgentEnvironment;
const path = require("path");
function buildAgentEnvironment(context) {
    const realPath = process.env.AGENT_RUN_REAL_PATH ?? process.env.PATH ?? '';
    return {
        ...process.env,
        AGENT_DIR: context.paths.liveDir,
        AGENT_PROFILE_DIR: context.profileDir,
        AGENT_RUN_PROJECT_ROOT: context.projectRoot,
        AGENT_PROJECT_MEMORY_DIR: context.paths.projectMemoryDir,
        AGENT_GLOBAL_MEMORY_DIR: context.paths.globalMemoryDir,
        AGENT_RUN_REAL_PATH: realPath,
        PATH: `${context.paths.binDir}${path.delimiter}${realPath}`
    };
}
