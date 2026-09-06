"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSkills = getSkills;
exports.listSkills = listSkills;
exports.getSkill = getSkill;
const path = require("node:path");
const zod_1 = require("zod");
const store_1 = require("./store");
const templates_1 = require("../templates");
const manifest_1 = require("../manifest");
const metadata = zod_1.z.object({
    name: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    description: zod_1.z.string().trim().min(1),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    extends: zod_1.z.string().regex(/^global:[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional()
});
function getSkills(store) {
    const profile = store.profile ?? 'default';
    const directory = store.scopeDirectory(store.profile ? 'project' : 'default');
    const env = (0, templates_1.createNunjucksEnv)(store.configRoot);
    const context = (0, templates_1.buildRenderContext)(store.projectRoot, directory, store.configRoot, (0, manifest_1.normalizeManifest)((0, manifest_1.loadManifest)(store.configRoot, directory, profile), profile), env);
    const skillEnv = (0, templates_1.createSkillNunjucksEnv)(store.configRoot, directory);
    const skills = new Map();
    const globalSkills = new Map();
    for (const { scope, directory } of store.scopes) {
        for (const file of store.files(path.join(directory, 'skills')).filter((file) => path.basename(file) === 'SKILL.md')) {
            const text = skillEnv.render(path.relative(store.configRoot, file), context);
            const document = (0, store_1.readMarkdown)(text);
            const parsed = metadata.parse(document.metadata);
            if (path.basename(path.dirname(file)) !== parsed.name)
                throw new Error(`Skill name must match directory: ${file}`);
            let content = document.content;
            if (parsed.extends) {
                const parent = globalSkills.get(parsed.extends.slice('global:'.length));
                if (!parent || parent.scope !== 'global' || scope === 'global')
                    throw new Error(`Missing global parent for skill ${parsed.name}`);
                content = `${parent.content}\n\n${content}`;
            }
            skills.set(parsed.name, { ...parsed, scope, content, source: path.relative(store.configRoot, file) });
            if (scope === 'global')
                globalSkills.set(parsed.name, skills.get(parsed.name));
        }
    }
    return [...skills.values()];
}
function listSkills(store) {
    return getSkills(store).map(({ content: _content, ...skill }) => skill);
}
function getSkill(store, name) {
    const skill = getSkills(store).find((item) => item.name === name);
    if (!skill)
        throw new Error(`Skill not found: ${name}`);
    return skill;
}
