"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderProfileConfig = renderProfileConfig;
exports.parseJsonObject = parseJsonObject;
const fs = require("fs");
const path = require("path");
const templates_1 = require("../templates");
const utils_1 = require("../utils");
function renderProfileConfig(env, configRoot, context, overrideFileName, globalTemplatePath, fallback, label, trace) {
    const templatePath = resolveProfileOverrideTemplate(configRoot, context, overrideFileName, globalTemplatePath);
    const content = templatePath
        ? (0, templates_1.renderTemplateFile)(env, configRoot, templatePath, context, trace)
        : fallback();
    (0, templates_1.assertNoUnexpandedTemplateVars)(label, content);
    return content.replace(/\n*$/, '\n');
}
function parseJsonObject(content, label) {
    try {
        const parsed = JSON.parse(content);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('top-level value must be an object');
        }
        return parsed;
    }
    catch (error) {
        throw new Error(`invalid generated ${label} JSON: ${(0, utils_1.formatError)(error)}`);
    }
}
function resolveProfileOverrideTemplate(configRoot, context, overrideFileName, globalTemplatePath) {
    const overridePath = `${context.profile}/overrides/${overrideFileName}`;
    if (fs.existsSync(path.join(configRoot, overridePath))) {
        return overridePath;
    }
    return fs.existsSync(path.join(configRoot, globalTemplatePath)) ? globalTemplatePath : null;
}
