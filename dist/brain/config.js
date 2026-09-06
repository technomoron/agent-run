"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectConfigSchema = exports.brainConfigSchema = void 0;
exports.defaultSocketPath = defaultSocketPath;
exports.readBrainConfig = readBrainConfig;
exports.listBrainProjects = listBrainProjects;
exports.namedBrainProfile = namedBrainProfile;
exports.registeredBrainProfile = registeredBrainProfile;
exports.registeredBrainProject = registeredBrainProject;
const fs = require("node:fs");
const path = require("node:path");
const jsonc_parser_1 = require("jsonc-parser");
const yaml_1 = require("yaml");
const zod_1 = require("zod");
const utils_1 = require("../utils");
function defaultSocketPath(configRoot) {
    return path.join(process.env.XDG_RUNTIME_DIR ?? path.join(configRoot, 'runtime'), 'agent-brain.sock');
}
exports.brainConfigSchema = zod_1.z.object({
    enabled: zod_1.z.boolean().default(true),
    contextBudget: zod_1.z.number().int().min(1000).max(100000).default(16000),
    connectors: zod_1.z.record(zod_1.z.string().regex(/^[a-zA-Z0-9_-]+$/), zod_1.z.discriminatedUnion('type', [
        zod_1.z.object({ type: zod_1.z.literal('github'), repository: zod_1.z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/), tokenEnv: zod_1.z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('GITHUB_TOKEN') }).strict(),
        zod_1.z.object({ type: zod_1.z.literal('trello'), board: zod_1.z.string().regex(/^[a-zA-Z0-9]+$/), keyEnv: zod_1.z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('TRELLO_API_KEY'), tokenEnv: zod_1.z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default('TRELLO_TOKEN') }).strict()
    ])).default({})
}).strict();
function readBrainConfig(root) {
    const file = path.join(root, 'brain.jsonc');
    if (!fs.existsSync(file))
        return null;
    const errors = [];
    const value = (0, jsonc_parser_1.parse)(fs.readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
    if (errors.length)
        throw new Error(`Invalid JSONC in ${file}`);
    return exports.brainConfigSchema.parse(value);
}
exports.projectConfigSchema = zod_1.z.object({
    name: zod_1.z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/),
    display_name: zod_1.z.string().optional(),
    roots: zod_1.z.array(zod_1.z.string().refine(path.isAbsolute, 'Source roots must be absolute paths')).min(1),
    description: zod_1.z.string().default(''),
    repository: zod_1.z.object({ url: zod_1.z.string() }).optional(),
    agent: zod_1.z.object({ default: zod_1.z.enum(['codex', 'claude', 'gemini', 'grok']).default('codex') }).default({ default: 'codex' })
}).strict();
function listBrainProjects(configRoot) {
    const directory = path.join(configRoot, 'projects');
    if (!fs.existsSync(directory))
        return [];
    function scan(parent) {
        return fs.readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
            const child = path.join(parent, entry.name);
            const file = path.join(child, 'config.yaml');
            if (!fs.existsSync(file))
                return scan(child);
            if (fs.lstatSync(file).isSymbolicLink())
                throw new Error(`Project configuration must not be a symlink: ${file}`);
            const config = exports.projectConfigSchema.parse((0, yaml_1.parse)(fs.readFileSync(file, 'utf8')));
            if (config.name !== path.relative(directory, child).split(path.sep).join('/'))
                throw new Error(`Project name must match directory: ${file}`);
            return [{ ...config, profile: `projects/${config.name}` }];
        });
    }
    return scan(directory);
}
function namedBrainProfile(configRoot, name) {
    return listBrainProjects(configRoot).find((project) => project.name === name || project.profile === name)?.profile ?? null;
}
function registeredBrainProfile(configRoot, cwd) {
    return registeredBrainProject(configRoot, cwd)?.profile ?? null;
}
function registeredBrainProject(configRoot, cwd) {
    const matches = listBrainProjects(configRoot).flatMap((project) => project.roots
        .filter((root) => (0, utils_1.isSamePathOrDescendant)(path.resolve(cwd), path.resolve(root)))
        .map((root) => ({ profile: project.profile, root: path.resolve(root), length: path.resolve(root).length }))).sort((a, b) => b.length - a.length);
    if (matches[0] && matches[1] && matches[0].length === matches[1].length && matches[0].profile !== matches[1].profile) {
        throw new Error(`More than one project is configured for ${cwd}`);
    }
    return matches[0] ?? null;
}
