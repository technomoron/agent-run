"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProfileConfigured = isProfileConfigured;
exports.createProfileMarker = createProfileMarker;
exports.ensureRootDefaultsFile = ensureRootDefaultsFile;
exports.createDefaultLocalFile = createDefaultLocalFile;
exports.convertLegacyProfileIfNeeded = convertLegacyProfileIfNeeded;
exports.loadManifest = loadManifest;
exports.normalizeManifest = normalizeManifest;
const types_1 = require("./agents/types");
const fs = require("fs");
const path = require("path");
const jsonc_parser_1 = require("jsonc-parser");
const constants_1 = require("./constants");
const defaults_1 = require("./defaults");
const utils_1 = require("./utils");
function isProfileConfigured(agentDir) {
    return [constants_1.MANIFEST_FILE_NAME, constants_1.LOCAL_TEMPLATE_FILE_NAME, 'AGENTS-MODS.md'].some((name) => fs.existsSync(path.join(agentDir, name)));
}
function createProfileMarker(agentDir) {
    const manifestPath = path.join(agentDir, constants_1.MANIFEST_FILE_NAME);
    if (fs.existsSync(manifestPath)) {
        return;
    }
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(manifestPath, '{}\n', 'utf8');
    (0, utils_1.verbose)(`created ${manifestPath}`);
}
function ensureRootDefaultsFile(configRoot) {
    const defaultsPath = path.join(configRoot, constants_1.CONFIG_ROOT_DEFAULTS_FILE_NAME);
    if (fs.existsSync(defaultsPath)) {
        return;
    }
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(defaultsPath, (0, defaults_1.stringifyRootDefaults)(), 'utf8');
    (0, utils_1.verbose)(`created ${defaultsPath}`);
}
function createDefaultLocalFile(agentDir) {
    const localPath = path.join(agentDir, constants_1.LOCAL_TEMPLATE_FILE_NAME);
    if (fs.existsSync(localPath)) {
        return localPath;
    }
    const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
    const content = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath, 'utf8') : (0, defaults_1.defaultLocalTemplate)();
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(localPath, content, 'utf8');
    (0, utils_1.verbose)(`created ${localPath}`);
    return localPath;
}
function convertLegacyProfileIfNeeded(agentDir) {
    const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
    const localPath = path.join(agentDir, constants_1.LOCAL_TEMPLATE_FILE_NAME);
    if (fs.existsSync(legacyPath) && !fs.existsSync(localPath)) {
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(localPath, fs.readFileSync(legacyPath, 'utf8'), 'utf8');
        (0, utils_1.verbose)(`converted ${legacyPath} -> ${localPath}`);
    }
}
function loadManifest(configRoot, agentDir, profile, trace) {
    const rootDefaultsPath = path.join(configRoot, constants_1.CONFIG_ROOT_DEFAULTS_FILE_NAME);
    const profileManifestPath = path.join(agentDir, constants_1.MANIFEST_FILE_NAME);
    const rootDefaults = fs.existsSync(rootDefaultsPath) ? parseManifestFile(rootDefaultsPath, trace) : {};
    if (rootDefaults.profile !== undefined) {
        throw new Error(`${rootDefaultsPath} must not set profile; profiles are inferred from project mapping`);
    }
    let profileManifest = fs.existsSync(profileManifestPath) ? parseManifestFile(profileManifestPath, trace) : {};
    if (!fs.existsSync(profileManifestPath)) {
        profileManifest = applyLegacyIncludeFallback(agentDir, profileManifest);
    }
    const builtIn = (0, defaults_1.defaultManifest)(profile);
    const mergedDefaults = mergeManifest(builtIn, rootDefaults, false);
    return mergeManifest(mergedDefaults, profileManifest, true, profile);
}
function parseManifestFile(filePath, trace) {
    trace?.sourceFiles.add(filePath);
    const text = fs.readFileSync(filePath, 'utf8');
    const errors = [];
    const parsed = (0, jsonc_parser_1.parse)(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
        const first = errors[0];
        const detail = first ? `${(0, jsonc_parser_1.printParseErrorCode)(first.error)} at offset ${first.offset}` : 'unknown JSONC parse error';
        throw new Error(`invalid JSONC in ${filePath}: ${detail}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`manifest must be an object: ${filePath}`);
    }
    return parsed;
}
function applyLegacyIncludeFallback(agentDir, manifest) {
    const localPath = path.join(agentDir, constants_1.LOCAL_TEMPLATE_FILE_NAME);
    const legacyPath = path.join(agentDir, 'AGENTS-MODS.md');
    if (!fs.existsSync(localPath) && fs.existsSync(legacyPath)) {
        return { ...manifest, agent: { ...manifest.agent, includes: ['{{ profile }}/AGENTS-MODS.md'] } };
    }
    return manifest;
}
function mergeManifest(base, override, allowProfile, inferredProfile) {
    const merged = {
        ...base,
        ...override,
        agent: { ...base.agent, ...override.agent },
        skills: mergeSkills(base.skills, override.skills),
        tools: { ...base.tools, ...override.tools },
        mcp: {
            ...base.mcp,
            ...override.mcp,
            servers: { ...base.mcp?.servers, ...override.mcp?.servers }
        },
        guardrails: { ...base.guardrails, ...override.guardrails },
        paths: { ...base.paths, ...override.paths }
    };
    if (!allowProfile) {
        merged.profile = base.profile;
    }
    else {
        merged.profile = override.profile ?? inferredProfile ?? base.profile;
    }
    return merged;
}
function mergeSkills(base, override) {
    if (override === undefined) {
        return base;
    }
    if (Array.isArray(override)) {
        return [...override];
    }
    const baseObject = asSkillObject(base);
    return {
        install: override.install ?? baseObject.install,
        overrides: { ...baseObject.overrides, ...override.overrides }
    };
}
function asSkillObject(skills) {
    if (Array.isArray(skills)) {
        return { install: skills, overrides: {} };
    }
    return {
        install: skills?.install ?? [],
        overrides: skills?.overrides ?? {}
    };
}
function normalizeManifest(manifest, profile) {
    const defaultAgent = manifest.agent?.default ?? 'codex';
    if (!types_1.AGENT_IDS.includes(defaultAgent))
        throw new Error('agent.default must be codex, claude, gemini, or grok');
    const fallback = (0, defaults_1.defaultManifest)(profile);
    const skills = asSkillObject(manifest.skills ?? fallback.skills);
    const fallbackPaths = fallback.paths ?? {};
    const paths = manifest.paths ?? {};
    return {
        profile: manifest.profile ?? profile,
        kind: manifest.kind ?? fallback.kind ?? 'code',
        agent: {
            default: defaultAgent,
            base: manifest.agent?.base ?? fallback.agent?.base ?? 'global/agents/code.md.njk',
            includes: manifest.agent?.includes ?? [`{{ profile }}/${constants_1.LOCAL_TEMPLATE_FILE_NAME}`]
        },
        skills: {
            install: normalizeInstalledSkills(skills.install),
            overrides: skills.overrides
        },
        tools: {
            codex: manifest.tools?.codex ?? true,
            claude: manifest.tools?.claude ?? true,
            gemini: manifest.tools?.gemini ?? true,
            grok: manifest.tools?.grok ?? true
        },
        mcpServers: normalizeMcpServers(manifest.mcp?.servers ?? {}),
        checks: manifest.checks ?? fallback.checks ?? [],
        guardrails: {
            blockGitWrite: manifest.guardrails?.blockGitWrite ?? true,
            blockPublish: manifest.guardrails?.blockPublish ?? true,
            blockGithubRelease: manifest.guardrails?.blockGithubRelease ?? true,
            forbidRepoAiFiles: manifest.guardrails?.forbidRepoAiFiles ?? true
        },
        paths: {
            changesFile: paths.changesFile ?? fallbackPaths.changesFile ?? '{{ projectRoot }}/CHANGES',
            reviewDir: normalizeLegacyReviewPath(paths.reviewDir ?? fallbackPaths.reviewDir ?? '{{ profileDir }}/reviews'),
            reviewFile: normalizeLegacyReviewPath(paths.reviewFile ?? fallbackPaths.reviewFile ?? '{{ profileDir }}/reviews/REVIEW-{{ date }}.md'),
            reviewConsolidatedFile: paths.reviewConsolidatedFile ?? fallbackPaths.reviewConsolidatedFile,
            memoriesDir: paths.memoriesDir ?? fallbackPaths.memoriesDir ?? '{{ agentDir }}/memories',
            projectMemoryDir: paths.projectMemoryDir ?? fallbackPaths.projectMemoryDir ?? '{{ profileDir }}/notes/memory'
        }
    };
}
function normalizeMcpServers(servers) {
    const normalized = {};
    for (const [name, server] of Object.entries(servers ?? {})) {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) {
            throw new Error(`invalid MCP server name: ${name}`);
        }
        const transport = server.transport ?? (server.command ? 'stdio' : 'http');
        if (transport === 'stdio') {
            if (!server.command?.trim() || server.url !== undefined) {
                throw new Error(`MCP server ${name} must set command and must not set url for stdio transport`);
            }
        }
        else if (!server.url?.trim() || server.command !== undefined) {
            throw new Error(`MCP server ${name} must set url and must not set command for ${transport} transport`);
        }
        normalized[name] = {
            transport,
            ...(server.command ? { command: server.command } : {}),
            args: server.args ?? [],
            ...(server.cwd ? { cwd: server.cwd } : {}),
            env: server.env ?? {},
            ...(server.url ? { url: server.url } : {}),
            headers: server.headers ?? {},
            enabled: server.enabled ?? true
        };
    }
    return normalized;
}
function normalizeInstalledSkills(names) {
    return [...new Set(names.map(normalizeSkillName))];
}
function normalizeSkillName(name) {
    const normalized = name === 'code-review' ? 'code-review-organizer' : name;
    if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
        throw new Error(`invalid skill name: ${name}`);
    }
    return normalized;
}
function normalizeLegacyReviewPath(value) {
    if (value === '{{ agentDir }}/reviews') {
        return '{{ profileDir }}/reviews';
    }
    if (value === '{{ agentDir }}/reviews/REVIEW-{{ date }}.md') {
        return '{{ profileDir }}/reviews/REVIEW-{{ date }}.md';
    }
    return value;
}
