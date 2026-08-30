"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderProfile = renderProfile;
exports.syncAgentProfile = syncAgentProfile;
exports.checkRenderedProfile = checkRenderedProfile;
const fs = require("fs");
const os = require("os");
const path = require("path");
const constants_1 = require("./constants");
const config_tree_1 = require("./config-tree");
const defaults_1 = require("./defaults");
const guards_1 = require("./guards");
const manifest_1 = require("./manifest");
const project_1 = require("./project");
const templates_1 = require("./templates");
const utils_1 = require("./utils");
function renderProfile(projectRoot, agentDir, checkOnly = false, targetTool = null, trace, options) {
    const configRoot = options?.configRoot ?? (0, project_1.defaultConfigRoot)(projectRoot);
    const profile = options?.profile ?? (0, project_1.resolveProfile)(projectRoot);
    const env = (0, templates_1.createNunjucksEnv)(configRoot);
    const manifest = (0, manifest_1.normalizeManifest)((0, manifest_1.loadManifest)(configRoot, agentDir, profile, trace), profile);
    validateManifestProfile(manifest.profile, profile, agentDir);
    if (!checkOnly) {
        (0, config_tree_1.ensureConfigRootGitignore)(configRoot);
    }
    const context = (0, templates_1.buildRenderContext)(projectRoot, agentDir, configRoot, manifest, env);
    context.renderedAgentSections = renderAgentSections(env, configRoot, manifest, context, trace);
    context.skills = renderSkills(env, configRoot, manifest, context, trace);
    const files = renderProfileFiles(env, configRoot, context, targetTool, trace);
    return { agentDir, configRoot, profile, context, files, skills: context.skills };
}
function validateManifestProfile(manifestProfile, inferredProfile, agentDir) {
    if (manifestProfile === inferredProfile) {
        return;
    }
    const parsed = (0, project_1.parseProfile)(manifestProfile, `${path.join(agentDir, constants_1.MANIFEST_FILE_NAME)} profile`);
    if (parsed.profile === null) {
        throw new Error(parsed.reason);
    }
    throw new Error(`${path.join(agentDir, constants_1.MANIFEST_FILE_NAME)} profile must match inferred profile ${inferredProfile}`);
}
function renderAgentSections(env, configRoot, manifest, context, trace) {
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
    return sections.map((section, index) => {
        const label = index === 0 ? manifest.agent.base : manifest.agent.includes[index - 1] ?? `section ${index}`;
        (0, templates_1.assertNoUnexpandedTemplateVars)(label, section);
        return section.trimEnd();
    });
}
function renderProfileFiles(env, configRoot, context, targetTool, trace) {
    const files = [];
    if (context.tools.codex && (targetTool === null || targetTool === 'codex')) {
        files.push({
            path: path.join(context.paths.codexHomeDir, 'AGENTS.md'),
            content: renderToolInstructions('AGENTS.md', env, configRoot, context, false, trace)
        });
        files.push({
            path: path.join(context.paths.codexHomeDir, 'config.toml'),
            content: renderCodexConfig(env, configRoot, context, trace)
        });
        files.push(...renderNativeSkillFiles(context, 'codex'));
    }
    if (context.tools.claude && (targetTool === null || targetTool === 'claude')) {
        files.push({
            path: path.join(context.paths.liveDir, 'CLAUDE.md'),
            content: renderToolInstructions('CLAUDE.md', env, configRoot, context, true, trace)
        });
        files.push({
            path: path.join(context.paths.liveDir, '.claude', 'agent-run-settings.json'),
            content: renderClaudeSettings(env, configRoot, context, trace)
        });
        files.push({
            path: path.join(context.paths.liveDir, '.claude', '.claude-plugin', 'plugin.json'),
            content: claudePluginManifestContent(context)
        });
        files.push(...renderNativeSkillFiles(context, 'claude'));
    }
    files.push(...(0, guards_1.renderGuardShims)(context));
    return files;
}
function syncAgentProfile(projectRoot, agentDir, options) {
    const rendered = renderProfile(projectRoot, agentDir, false, null, undefined, options);
    syncRuntimeDirs(rendered.context);
    removeStaleGeneratedEntries(rendered);
    for (const file of rendered.files) {
        writeGeneratedFile(file.path, file.content, file.executable ?? false);
    }
    removeLegacyGeneratedCodexFiles(rendered.context);
    removeLegacyGeneratedClaudeSettings(rendered.context);
    return rendered;
}
function writeGeneratedFile(filePath, content, executable) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const unchanged = fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content;
    if (!unchanged) {
        fs.writeFileSync(filePath, content, 'utf8');
        (0, utils_1.verbose)(`write ${filePath}`);
    }
    if (executable && !constants_1.IS_WINDOWS) {
        const currentMode = fs.statSync(filePath).mode & 0o777;
        if (currentMode !== 0o755) {
            fs.chmodSync(filePath, 0o755);
            (0, utils_1.verbose)(`chmod 755 ${filePath}`);
        }
    }
}
function removeStaleGeneratedEntries(rendered) {
    const expectedFiles = new Set(rendered.files.map((file) => path.resolve(file.path)));
    const context = rendered.context;
    const generatedCandidates = [
        path.join(context.paths.codexHomeDir, 'AGENTS.md'),
        path.join(context.paths.codexHomeDir, 'config.toml'),
        path.join(context.paths.liveDir, 'CLAUDE.md'),
        path.join(context.paths.liveDir, '.claude', 'CLAUDE.md'),
        path.join(context.paths.liveDir, '.claude', 'agent-run-settings.json'),
        path.join(context.paths.liveDir, '.claude', '.claude-plugin', 'plugin.json'),
        ...['git', 'git.cmd', 'npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'gh', 'gh.cmd'].map((name) => path.join(context.paths.binDir, name))
    ];
    for (const filePath of generatedCandidates) {
        if (!expectedFiles.has(path.resolve(filePath))) {
            fs.rmSync(filePath, { force: true });
        }
    }
    const skillNames = new Set(rendered.skills.map((skill) => skill.name));
    removeStaleGeneratedSkills(context.paths.codexSkillsDir, context.tools.codex ? skillNames : new Set(), new Set(['.system']));
    removeStaleGeneratedSkills(context.paths.claudeSkillsDir, context.tools.claude ? skillNames : new Set());
}
function removeStaleGeneratedSkills(dir, expectedNames, preservedNames = new Set()) {
    if (!fs.existsSync(dir)) {
        return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!expectedNames.has(entry.name) && !preservedNames.has(entry.name)) {
            fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
        }
    }
}
function removeLegacyGeneratedCodexFiles(context) {
    for (const legacyPath of [
        path.join(context.paths.liveDir, 'AGENTS.md'),
        path.join(context.paths.liveDir, 'config.toml')
    ]) {
        if (fs.existsSync(legacyPath)) {
            fs.rmSync(legacyPath);
            (0, utils_1.verbose)(`removed legacy generated Codex file ${legacyPath}`);
        }
    }
}
function removeLegacyGeneratedClaudeSettings(context) {
    for (const legacyPath of [
        path.join(context.paths.liveDir, '.claude', 'settings.json'),
        path.join(context.profileDir, '.claude', 'settings.json')
    ]) {
        if (!fs.existsSync(legacyPath)) {
            continue;
        }
        const actual = fs.readFileSync(legacyPath, 'utf8').replace(/\r\n/g, '\n');
        const generated = [
            (0, defaults_1.legacyDefaultClaudeSettingsContent)(context, context.agentDir),
            (0, defaults_1.legacyDefaultClaudeSettingsContent)(context, context.profileDir)
        ];
        if (generated.includes(actual)) {
            fs.rmSync(legacyPath);
            (0, utils_1.verbose)(`removed legacy generated Claude settings ${legacyPath}`);
        }
    }
}
function checkRenderedProfile(projectRoot, agentDir) {
    const findings = [];
    const configRoot = (0, project_1.defaultConfigRoot)(projectRoot);
    try {
        const rendered = renderProfile(projectRoot, agentDir, true);
        checkRenderedFiles(rendered, findings);
        checkRuntimeDirectories(rendered.context, findings);
        for (const skill of rendered.skills) {
            validateRenderedSkill(skill.renderedContent, skill.sourcePath);
        }
    }
    catch (error) {
        findings.push({
            message: `failed to render profile ${agentDir}: ${(0, utils_1.formatError)(error)}`,
            severity: 'ERROR'
        });
    }
    checkConfigGitignore(configRoot, findings);
    return findings;
}
function checkRenderedFiles(rendered, findings) {
    for (const file of rendered.files) {
        if (!fs.existsSync(file.path)) {
            findings.push({ message: `missing generated file: ${file.path}`, severity: 'ERROR' });
            continue;
        }
        const actual = fs.readFileSync(file.path, 'utf8').replace(/\r\n/g, '\n');
        if (actual !== file.content) {
            findings.push({ message: `generated file is out of date: ${file.path}`, severity: 'ERROR' });
        }
    }
}
function checkRuntimeDirectories(context, findings) {
    for (const dir of [
        context.paths.reviewDir,
        context.paths.memoriesDir,
        context.paths.codexHomeDir,
        context.paths.liveDir,
        context.paths.codexSkillsDir,
        context.paths.claudeSkillsDir,
        context.paths.binDir
    ]) {
        if (!fs.existsSync(dir)) {
            findings.push({ message: `missing generated runtime directory: ${dir}`, severity: 'ERROR' });
        }
    }
}
function checkConfigGitignore(configRoot, findings) {
    const gitignorePath = path.join(configRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        findings.push({ message: `missing config root .gitignore: ${gitignorePath}`, severity: 'ERROR' });
        return;
    }
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    for (const entry of constants_1.GENERATED_GITIGNORE_ENTRIES) {
        if (entry && !entry.startsWith('#') && !gitignore.includes(entry)) {
            findings.push({ message: `config root .gitignore missing entry: ${entry}`, severity: 'ERROR' });
        }
    }
}
function renderSkills(env, configRoot, manifest, context, trace) {
    return manifest.skills.install.map((name) => {
        const sourceTemplate = manifest.skills.overrides[name] ?? `global/skills/${name}/SKILL.md.njk`;
        const sourcePath = (0, templates_1.resolveConfigPath)(configRoot, sourceTemplate, context);
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`missing skill template for ${name}: ${sourcePath}`);
        }
        const renderedContent = (0, templates_1.renderTemplateFile)(env, configRoot, sourceTemplate, context, trace);
        (0, templates_1.assertNoUnexpandedTemplateVars)(`skill ${name}`, renderedContent);
        validateRenderedSkill(renderedContent, sourcePath);
        return { name, sourcePath, renderedContent, description: extractSkillDescription(renderedContent) };
    });
}
function renderNativeSkillFiles(context, targetTool) {
    const targetDir = targetTool === 'codex' ? context.paths.codexSkillsDir : context.paths.claudeSkillsDir;
    return context.skills.map((skill) => ({
        path: path.join(targetDir, skill.name, 'SKILL.md'),
        content: skill.renderedContent
    }));
}
function renderToolInstructions(templateName, env, configRoot, context, isClaude, trace) {
    const templatePath = `global/tool-templates/${templateName}.njk`;
    const content = fs.existsSync(path.join(configRoot, templatePath))
        ? (0, templates_1.renderTemplateFile)(env, configRoot, templatePath, context, trace)
        : env.renderString((0, defaults_1.defaultToolInstructionsTemplate)(isClaude), context);
    (0, templates_1.assertNoUnexpandedTemplateVars)(templateName, content);
    return content.replace(/\n*$/, '\n');
}
function renderCodexConfig(env, configRoot, context, trace) {
    const templatePath = resolveProfileOverrideTemplate(configRoot, context, 'codex-config.toml.njk', 'global/tool-templates/codex-config.toml.njk');
    const content = templatePath
        ? (0, templates_1.renderTemplateFile)(env, configRoot, templatePath, context, trace)
        : (0, defaults_1.defaultCodexConfigContent)(context);
    (0, templates_1.assertNoUnexpandedTemplateVars)('config.toml', content);
    return content.replace(/\n*$/, '\n');
}
function renderClaudeSettings(env, configRoot, context, trace) {
    const templatePath = resolveProfileOverrideTemplate(configRoot, context, 'claude-settings.json.njk', 'global/tool-templates/claude-settings.json.njk');
    const content = templatePath
        ? (0, templates_1.renderTemplateFile)(env, configRoot, templatePath, context, trace)
        : (0, defaults_1.defaultClaudeSettingsContent)(context);
    (0, templates_1.assertNoUnexpandedTemplateVars)('claude settings.json', content);
    try {
        JSON.parse(content);
    }
    catch (error) {
        throw new Error(`invalid generated Claude settings JSON: ${(0, utils_1.formatError)(error)}`);
    }
    return content.replace(/\n*$/, '\n');
}
function claudePluginManifestContent(context) {
    return `${JSON.stringify({
        name: 'agent-run-profile',
        description: `Generated skills for agent-run profile ${context.profile}`,
        version: '1.0.0',
        author: { name: 'Technomoron' }
    }, null, 2)}\n`;
}
function resolveProfileOverrideTemplate(configRoot, context, overrideFileName, globalTemplatePath) {
    const overridePath = `${context.profile}/overrides/${overrideFileName}`;
    if (fs.existsSync(path.join(configRoot, overridePath))) {
        return overridePath;
    }
    return fs.existsSync(path.join(configRoot, globalTemplatePath)) ? globalTemplatePath : null;
}
function syncRuntimeDirs(context) {
    for (const dir of [
        context.paths.reviewDir,
        context.paths.memoriesDir,
        context.paths.codexHomeDir,
        context.paths.codexSkillsDir,
        context.paths.claudeSkillsDir,
        context.paths.binDir,
        path.join(context.paths.liveDir, '.claude')
    ]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    migrateLiveReviewFiles(context);
    removeLegacyCodexSkillDirs(context);
    removeLegacyCodeReviewSkillDirs(context);
    ensureSharedCodexAuth(context.paths.codexHomeDir);
}
function ensureSharedCodexAuth(codexHomeDir) {
    const sharedAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(sharedAuthPath)) {
        return;
    }
    const profileAuthPath = path.join(codexHomeDir, 'auth.json');
    if (path.resolve(profileAuthPath) === path.resolve(sharedAuthPath) || isSymlinkTo(profileAuthPath, sharedAuthPath)) {
        return;
    }
    if (fs.existsSync(profileAuthPath) || (0, utils_1.isSymlink)(profileAuthPath)) {
        const backupPath = (0, utils_1.nextBackupPath)(profileAuthPath);
        fs.renameSync(profileAuthPath, backupPath);
        (0, utils_1.verbose)(`backed up profile Codex auth ${profileAuthPath} -> ${backupPath}`);
    }
    fs.mkdirSync(path.dirname(profileAuthPath), { recursive: true });
    try {
        fs.symlinkSync(sharedAuthPath, profileAuthPath);
        (0, utils_1.verbose)(`linked profile Codex auth ${profileAuthPath} -> ${sharedAuthPath}`);
    }
    catch (error) {
        if (!constants_1.IS_WINDOWS) {
            throw error;
        }
        fs.copyFileSync(sharedAuthPath, profileAuthPath);
        (0, utils_1.verbose)(`copied shared Codex auth ${sharedAuthPath} -> ${profileAuthPath}`);
    }
}
function isSymlinkTo(filePath, targetPath) {
    try {
        if (!fs.lstatSync(filePath).isSymbolicLink()) {
            return false;
        }
        const linkTarget = fs.readlinkSync(filePath);
        return path.resolve(path.dirname(filePath), linkTarget) === path.resolve(targetPath);
    }
    catch {
        return false;
    }
}
function removeLegacyCodexSkillDirs(context) {
    const legacyCodexDir = path.join(context.paths.liveDir, '.agents');
    if (!(0, utils_1.isSamePathOrDescendant)(context.paths.codexSkillsDir, legacyCodexDir)) {
        fs.rmSync(legacyCodexDir, { recursive: true, force: true });
    }
}
function removeLegacyCodeReviewSkillDirs(context) {
    if (!context.skills.some((skill) => skill.name === 'code-review-organizer')) {
        return;
    }
    for (const dir of [
        path.join(context.paths.liveDir, '.agents', 'skills', 'code-review'),
        path.join(context.paths.codexSkillsDir, 'code-review'),
        path.join(context.paths.claudeSkillsDir, 'code-review')
    ]) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
function migrateLiveReviewFiles(context) {
    const legacyReviewDir = path.join(context.paths.liveDir, 'reviews');
    if (path.resolve(legacyReviewDir) === path.resolve(context.paths.reviewDir) || !fs.existsSync(legacyReviewDir)) {
        return;
    }
    fs.mkdirSync(context.paths.reviewDir, { recursive: true });
    for (const entry of fs.readdirSync(legacyReviewDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
            continue;
        }
        const sourcePath = path.join(legacyReviewDir, entry.name);
        let targetPath = path.join(context.paths.reviewDir, entry.name);
        if (fs.existsSync(targetPath)) {
            if (filesHaveSameContent(sourcePath, targetPath)) {
                fs.rmSync(sourcePath);
                continue;
            }
            targetPath = nextAvailablePath(context.paths.reviewDir, entry.name);
        }
        moveFile(sourcePath, targetPath);
    }
}
function filesHaveSameContent(leftPath, rightPath) {
    const left = fs.readFileSync(leftPath);
    const right = fs.readFileSync(rightPath);
    return left.length === right.length && left.equals(right);
}
function nextAvailablePath(dir, filename) {
    const parsed = path.parse(filename);
    for (let sequence = 1;; sequence += 1) {
        const candidate = path.join(dir, `${parsed.name}.${sequence}${parsed.ext}`);
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
    }
}
function moveFile(sourcePath, targetPath) {
    try {
        fs.renameSync(sourcePath, targetPath);
    }
    catch (error) {
        if (error.code !== 'EXDEV') {
            throw error;
        }
        fs.copyFileSync(sourcePath, targetPath);
        fs.rmSync(sourcePath);
    }
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
