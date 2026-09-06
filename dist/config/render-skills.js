"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCanonicalSkills = buildCanonicalSkills;
exports.renderSkillFiles = renderSkillFiles;
exports.validateRenderedSkill = validateRenderedSkill;
const fs = require("fs");
const path = require("path");
const templates_1 = require("../templates");
function buildCanonicalSkills(env, configRoot, manifest, context, trace) {
    const skillEnv = (0, templates_1.createSkillNunjucksEnv)(configRoot, context.profileDir, trace);
    return manifest.skills.install.map((name) => {
        const canonical = `global/skills/${name}/SKILL.md`;
        const sourceTemplate = manifest.skills.overrides[name] ?? (fs.existsSync(path.join(configRoot, canonical)) ? canonical : `${canonical}.njk`);
        const sourcePath = (0, templates_1.resolveConfigPath)(configRoot, sourceTemplate, context, env);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`missing skill template for ${name}: ${sourcePath}`);
        }
        const renderedContent = skillEnv.render(path.relative(configRoot, sourcePath), context);
        (0, templates_1.assertNoUnexpandedTemplateVars)(`skill ${name}`, renderedContent);
        validateRenderedSkill(renderedContent, sourcePath);
        return { name, sourcePath, renderedContent, description: extractSkillDescription(renderedContent) };
    });
}
function renderSkillFiles(context, targetDir) {
    return context.skills.map((skill) => ({
        path: path.join(targetDir, skill.name, 'SKILL.md'),
        content: skill.renderedContent
    }));
}
function validateRenderedSkill(content, sourcePath) {
    const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(content.replace(/\r\n/g, '\n'));
    if (frontMatter === null) {
        throw new Error(`generated skill missing YAML front matter: ${sourcePath}`);
    }
    const yaml = frontMatter[1] ?? '';
    if (!/^name:\s*\S+/m.test(yaml)) {
        throw new Error(`generated skill missing name: ${sourcePath}`);
    }
    if (!/^description:\s*(?:\S|>\s*$)/m.test(yaml)) {
        throw new Error(`generated skill missing description: ${sourcePath}`);
    }
}
function extractSkillDescription(content) {
    const normalized = content.replace(/\r\n/g, '\n');
    const simple = /^description:\s*['"]?(.+?)['"]?\s*$/m.exec(normalized);
    if (simple?.[1]) {
        return simple[1].trim();
    }
    const folded = /^description:\s*>\s*\n((?:[ \t]+.+\n?)+)/m.exec(normalized);
    return folded?.[1]
        ? folded[1].split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
        : '';
}
