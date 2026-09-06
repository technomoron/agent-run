"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNunjucksEnv = createNunjucksEnv;
exports.buildRenderContext = buildRenderContext;
exports.resolveConfigPath = resolveConfigPath;
exports.renderTemplateFile = renderTemplateFile;
exports.assertNoUnexpandedTemplateVars = assertNoUnexpandedTemplateVars;
const fs = require("fs");
const path = require("path");
const nunjucks = require("nunjucks");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
function createNunjucksEnv(configRoot) {
    return new nunjucks.Environment(new nunjucks.FileSystemLoader(configRoot, { noCache: true }), {
        autoescape: false,
        trimBlocks: true,
        lstripBlocks: true,
        throwOnUndefined: true
    });
}
function buildRenderContext(projectRoot, profileDir, configRoot, manifest, env) {
    const date = (0, utils_1.localDateString)();
    const liveDir = path.join(profileDir, constants_1.LIVE_DIR_NAME);
    const baseContext = {
        profile: manifest.profile,
        kind: manifest.kind,
        projectRoot,
        agentDir: liveDir,
        profileDir,
        configRoot,
        date,
        checks: manifest.checks,
        tools: manifest.tools,
        mcpServers: manifest.mcpServers,
        guardrails: manifest.guardrails
    };
    const reviewDir = resolveRuntimePath(configRoot, manifest.paths.reviewDir, env, baseContext);
    const memoriesDir = resolveRuntimePath(configRoot, manifest.paths.memoriesDir, env, baseContext);
    const projectMemoryDir = resolveRuntimePath(configRoot, manifest.paths.projectMemoryDir, env, baseContext);
    const codexHomeDir = path.join(memoriesDir, 'codex-home');
    const geminiRuntimeDir = path.join(liveDir, 'gemini');
    const geminiHomeDir = path.join(geminiRuntimeDir, 'home');
    const grokRuntimeDir = path.join(liveDir, 'grok');
    const paths = {
        profileDir,
        liveDir,
        changesFile: resolveRuntimePath(configRoot, manifest.paths.changesFile, env, baseContext),
        reviewDir,
        reviewFile: resolveRuntimePath(configRoot, manifest.paths.reviewFile, env, baseContext),
        reviewConsolidatedFile: manifest.paths.reviewConsolidatedFile
            ? resolveRuntimePath(configRoot, manifest.paths.reviewConsolidatedFile, env, baseContext)
            : path.join(reviewDir, 'REVIEW.md'),
        memoriesDir,
        globalMemoryDir: path.join(configRoot, 'notes', 'memory'),
        projectMemoryDir,
        nativeMemoryDir: path.join(codexHomeDir, 'memories'),
        codexHomeDir,
        overridesDir: path.join(profileDir, 'overrides'),
        codexSkillsDir: path.join(codexHomeDir, 'skills'),
        claudeSkillsDir: path.join(liveDir, '.claude', 'skills'),
        geminiRuntimeDir,
        geminiHomeDir,
        geminiSkillsDir: path.join(geminiHomeDir, '.agents', 'skills'),
        grokRuntimeDir,
        grokSkillsDir: path.join(grokRuntimeDir, 'skills'),
        binDir: path.join(liveDir, 'bin')
    };
    return {
        ...baseContext,
        paths,
        permissionsAllow: buildPermissionsAllow(manifest),
        skills: [],
        renderedAgentSections: []
    };
}
function buildPermissionsAllow(manifest) {
    const allow = new Set();
    for (const check of manifest.checks) {
        const normalized = check.trim();
        if (normalized) {
            allow.add(`Bash(${normalized})`);
        }
    }
    return [...allow];
}
function resolveConfigPath(configRoot, relativePath, context) {
    const rendered = createNunjucksEnv(configRoot).renderString(relativePath, context);
    const resolved = path.resolve(configRoot, rendered);
    if (!(0, utils_1.isSamePathOrDescendant)(resolved, path.resolve(configRoot))) {
        throw new Error(`config path escapes config root: ${relativePath}`);
    }
    return resolved;
}
function resolveRuntimePath(configRoot, pathTemplate, env, context) {
    const rendered = env.renderString(pathTemplate, context);
    return path.isAbsolute(rendered) ? path.resolve(rendered) : path.resolve(configRoot, rendered);
}
function renderTemplateFile(env, configRoot, templatePath, context, trace) {
    const resolvedPath = resolveConfigPath(configRoot, templatePath, context);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`missing template: ${resolvedPath}`);
    }
    const relativePath = path.relative(configRoot, resolvedPath).replace(/\\/g, '/');
    let content = fs.readFileSync(resolvedPath, 'utf8');
    traceTemplateSource(configRoot, resolvedPath, content, context, trace);
    if (path.basename(resolvedPath) === 'AGENTS-MODS.md') {
        content = renderLegacyAgentsMods(resolvedPath, [], trace);
        return env.renderString(content, context);
    }
    return env.render(relativePath, context);
}
function traceTemplateSource(configRoot, sourcePath, content, context, trace, stack = []) {
    if (trace === undefined) {
        return;
    }
    const resolvedSource = path.resolve(sourcePath);
    trace.sourceFiles.add(resolvedSource);
    if (stack.includes(resolvedSource)) {
        return;
    }
    const nextStack = [...stack, resolvedSource];
    const includePattern = /{%\s*(?:include|extends|import)\s+["']([^"']+)["']|{%\s*from\s+["']([^"']+)["']/g;
    for (const match of content.matchAll(includePattern)) {
        const includePath = match[1] ?? match[2];
        if (!includePath) {
            continue;
        }
        const includedPath = resolveConfigPath(configRoot, includePath, context);
        if (fs.existsSync(includedPath)) {
            traceTemplateSource(configRoot, includedPath, fs.readFileSync(includedPath, 'utf8'), context, trace, nextStack);
        }
    }
}
function assertNoUnexpandedTemplateVars(label, content) {
    if (constants_1.UNEXPANDED_TEMPLATE_RE.test(content)) {
        throw new Error(`unexpanded template syntax remains in ${label}`);
    }
}
function renderLegacyAgentsMods(sourceFile, stack = [], trace) {
    const resolvedSource = path.resolve(sourceFile);
    trace?.sourceFiles.add(resolvedSource);
    if (stack.includes(resolvedSource)) {
        throw new Error(`Include cycle detected: ${[...stack, resolvedSource].join(' -> ')}`);
    }
    const lines = fs.readFileSync(resolvedSource, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const output = [];
    const nextStack = [...stack, resolvedSource];
    let sawLeadingInclude = false;
    let insertedOverrideNote = false;
    let contentStarted = false;
    let fence = null;
    for (const line of lines) {
        const trimmed = line.trim();
        const isIndentedCode = /^(?: {4}|\t)/.test(line);
        const fenceMatch = isIndentedCode ? null : /^(`{3,}|~{3,})/.exec(trimmed);
        if (fence !== null) {
            output.push(line);
            contentStarted = true;
            const marker = fenceMatch?.[1];
            if (marker && marker[0] === fence.character && marker.length >= fence.length && !trimmed.slice(marker.length).trim()) {
                fence = null;
            }
            continue;
        }
        if (!contentStarted && !trimmed) {
            continue;
        }
        if (fenceMatch?.[1]) {
            fence = { character: fenceMatch[1][0] ?? '`', length: fenceMatch[1].length };
        }
        if (fence === null && !isIndentedCode && trimmed.startsWith('@')) {
            const includePath = trimmed.slice(1).trim();
            if (includePath) {
                const resolvedInclude = resolveIncludePath(resolvedSource, includePath);
                trace?.sourceFiles.add(resolvedInclude);
                output.push(renderLegacyAgentsMods(resolvedInclude, nextStack, trace));
                if (!contentStarted) {
                    sawLeadingInclude = true;
                }
            }
            continue;
        }
        if (sawLeadingInclude && !insertedOverrideNote) {
            output.push('', 'If anything below this point conflicts with anything included above,');
            output.push('the later instructions below take precedence.', '');
            insertedOverrideNote = true;
        }
        output.push(line);
        contentStarted = true;
    }
    return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
function resolveIncludePath(sourceFile, includePath) {
    if (path.isAbsolute(includePath)) {
        return includePath;
    }
    const sourceRelativePath = path.resolve(path.dirname(sourceFile), includePath);
    if (fs.existsSync(sourceRelativePath)) {
        return sourceRelativePath;
    }
    return path.resolve(findIncludeRoot(sourceFile), includePath.replace(/^(\.\.\/)+/, ''));
}
function findIncludeRoot(sourceFile) {
    let dir = path.dirname(sourceFile);
    for (;;) {
        if (fs.existsSync(path.join(dir, 'global')) || fs.existsSync(path.join(dir, 'templates'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return path.dirname(sourceFile);
        }
        dir = parent;
    }
}
