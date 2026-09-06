"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRegistry = void 0;
exports.getAgentAdapter = getAgentAdapter;
exports.listAgentAdapters = listAgentAdapters;
exports.enabledAgentAdapters = enabledAgentAdapters;
const claude_1 = require("./claude");
const codex_1 = require("./codex");
const gemini_1 = require("./gemini");
const grok_1 = require("./grok");
const types_1 = require("./types");
exports.agentRegistry = {
    codex: codex_1.codexAdapter,
    claude: claude_1.claudeAdapter,
    gemini: gemini_1.geminiAdapter,
    grok: grok_1.grokAdapter
};
function getAgentAdapter(id) {
    return exports.agentRegistry[id];
}
function listAgentAdapters() {
    return types_1.AGENT_IDS.map((id) => exports.agentRegistry[id]);
}
function enabledAgentAdapters(context) {
    return listAgentAdapters().filter((adapter) => context.tools[adapter.id]);
}
