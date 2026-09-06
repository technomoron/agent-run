"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCanonicalInstructions = buildCanonicalInstructions;
exports.writeAgentsMd = writeAgentsMd;
exports.writeClaudeMd = writeClaudeMd;
const fs = require("fs");
const path = require("path");
const constants_1 = require("../constants");
const defaults_1 = require("../defaults");
const templates_1 = require("../templates");
function buildCanonicalInstructions(env, configRoot, manifest, context, trace) {
    const sections = [(0, templates_1.renderTemplateFile)(env, configRoot, manifest.agent.base, context, trace)];
    for (const include of manifest.agent.includes) {
        const includePath = (0, templates_1.resolveConfigPath)(configRoot, include, context);
        if (!fs.existsSync(includePath)) {
            if (include.includes('AGENTS-MODS.md') || include.includes(constants_1.LOCAL_TEMPLATE_FILE_NAME)) {
                continue;
            }
            throw new Error(`missing template: ${includePath}`);
        }
        sections.push((0, templates_1.renderTemplateFile)(env, configRoot, include, context, trace));
    }
    const renderedSections = sections.map((section, index) => {
        const label = index === 0 ? manifest.agent.base : manifest.agent.includes[index - 1] ?? `section ${index}`;
        (0, templates_1.assertNoUnexpandedTemplateVars)(label, section);
        return section.trimEnd();
    });
    renderedSections.push(projectMemoryInstructions(context));
    return { sections: renderedSections };
}
function writeAgentsMd(env, configRoot, context, trace) {
    return renderInstructionFile('AGENTS.md', env, configRoot, context, false, trace);
}
function writeClaudeMd(env, configRoot, context, trace) {
    return renderInstructionFile('CLAUDE.md', env, configRoot, context, true, trace);
}
function renderInstructionFile(templateName, env, configRoot, context, isClaude, trace) {
    const templatePath = `global/tool-templates/${templateName}.njk`;
    const content = fs.existsSync(path.join(configRoot, templatePath))
        ? (0, templates_1.renderTemplateFile)(env, configRoot, templatePath, context, trace)
        : env.renderString((0, defaults_1.defaultToolInstructionsTemplate)(isClaude), context);
    (0, templates_1.assertNoUnexpandedTemplateVars)(templateName, content);
    return content.replace(/\n*$/, '\n');
}
function projectMemoryInstructions(context) {
    return [
        '## Project Memory',
        '',
        `Project memory is stored in ${context.paths.projectMemoryDir}.`,
        'Read README.md there before starting work when prior project context may matter, then read only the linked files relevant to the task.',
        'Do not store secrets, raw chat transcripts, or temporary task state there.',
        'Update project memory only when the user explicitly asks you to remember or update something for this project.'
    ].join('\n');
}
