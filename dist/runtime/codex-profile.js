"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codexSharedHome = codexSharedHome;
exports.codexProfileName = codexProfileName;
exports.codexProfileSkills = codexProfileSkills;
exports.renderCodexProfile = renderCodexProfile;
exports.refreshCodexProfileSkills = refreshCodexProfileSkills;
exports.writeCodexProfileFile = writeCodexProfileFile;
exports.withCodexProfileLock = withCodexProfileLock;
exports.migrateCodexSessions = migrateCodexSessions;
const fs = require("fs");
const path = require("path");
const crypto_1 = require("crypto");
const smol_toml_1 = require("smol-toml");
function codexSharedHome(context) {
    return path.join(context.configRoot, 'runtime', 'codex');
}
function codexProfileName(context) {
    const identity = path.resolve(context.profileDir);
    const canonical = process.platform === 'win32' ? identity.toLowerCase() : identity;
    return `agent-run-${(0, crypto_1.createHash)('sha256').update(canonical).digest('hex').slice(0, 20)}`;
}
function codexProfileSkills(context) {
    return path.join(codexSharedHome(context), 'skills', codexProfileName(context));
}
// Only scan agent-run's generated skills. Personal/system skills keep their native settings.
function generatedSkills(home) {
    const root = path.join(home, 'skills');
    if (!fs.existsSync(root))
        return [];
    const files = [];
    for (const profile of fs.readdirSync(root, { withFileTypes: true })) {
        if (!profile.isDirectory() || !/^agent-run-[a-f0-9]{20}$/.test(profile.name))
            continue;
        const dir = path.join(root, profile.name);
        for (const skill of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, skill.name, 'SKILL.md');
            if (skill.isDirectory() && fs.existsSync(file))
                files.push(file);
        }
    }
    return files.sort();
}
function configureSkills(config, home, profile, files) {
    const settings = (config.skills ?? {});
    const existing = (settings.config ?? []);
    const generatedRoot = path.join(home, 'skills') + path.sep;
    const isGenerated = (file) => {
        const relative = path.resolve(file).slice(generatedRoot.length);
        return path.resolve(file).startsWith(generatedRoot) && /^agent-run-[a-f0-9]{20}[\\/]/.test(relative);
    };
    settings.config = [
        ...existing.filter((entry) => !isGenerated(entry.path)),
        ...files.map((file) => ({
            path: file,
            enabled: path.dirname(path.dirname(file)) === path.join(home, 'skills', profile)
                && (existing.find((entry) => entry.path === file)?.enabled ?? true)
        }))
    ];
    config.skills = settings;
}
function renderCodexProfile(context, base, instructions) {
    const config = (0, smol_toml_1.parse)(base);
    config.developer_instructions = [config.developer_instructions, instructions].filter(Boolean).join('\n\n');
    if (process.platform === 'win32') {
        // A fresh home otherwise silently downgrades workspace-write to read-only.
        config.windows = { sandbox: 'unelevated', ...(config.windows ?? {}) };
    }
    configureSkills(config, codexSharedHome(context), codexProfileName(context), pendingSkills(context));
    return (0, smol_toml_1.stringify)(config) + '\n';
}
function pendingSkills(context) {
    const ownDir = codexProfileSkills(context);
    const others = generatedSkills(codexSharedHome(context)).filter((file) => path.dirname(path.dirname(file)) !== ownDir);
    const own = context.skills.map((skill) => path.join(ownDir, skill.name, 'SKILL.md'));
    return [...new Set([...others, ...own])].sort();
}
// Refresh older generated profiles too: newly generated project skills must not
// become enabled in another profile merely because they share a discovery root.
function refreshCodexProfileSkills(context) {
    const home = codexSharedHome(context);
    const files = pendingSkills(context);
    for (const entry of fs.readdirSync(home)) {
        if (!/^agent-run-[a-f0-9]{20}\.config\.toml$/.test(entry))
            continue;
        const file = path.join(home, entry);
        const original = fs.readFileSync(file, 'utf8');
        const config = (0, smol_toml_1.parse)(original);
        configureSkills(config, home, entry.replace('.config.toml', ''), files);
        const content = (0, smol_toml_1.stringify)(config) + '\n';
        if (content !== original)
            writeCodexProfileFile(file, content);
    }
}
function writeCodexProfileFile(file, content) {
    const temporary = `${file}.${(0, crypto_1.randomUUID)()}.tmp`;
    try {
        fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporary, file);
    }
    finally {
        fs.rmSync(temporary, { force: true });
    }
}
// Profile refresh, skill publication and session migration share one writer.
// Codex readers see complete profile files through atomic rename.
function withCodexProfileLock(context, run) {
    const home = codexSharedHome(context);
    fs.mkdirSync(home, { recursive: true });
    const lock = path.join(home, '.agent-run-sync.lock');
    const deadline = Date.now() + 30000;
    let descriptor;
    for (;;) {
        try {
            descriptor = fs.openSync(lock, 'wx', 0o600);
            break;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            try {
                const owner = Number(fs.readFileSync(lock, 'utf8'));
                if (Number.isInteger(owner) && owner > 0) {
                    try {
                        process.kill(owner, 0);
                    }
                    catch (probe) {
                        if (probe.code === 'ESRCH') {
                            fs.rmSync(lock, { force: true });
                            continue;
                        }
                    }
                }
            }
            catch (readError) {
                if (readError.code === 'ENOENT')
                    continue;
                throw readError;
            }
            if (Date.now() >= deadline)
                throw new Error(`Timed out waiting for Codex profile generation: ${lock}`);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        }
    }
    try {
        fs.writeFileSync(descriptor, String(process.pid));
        return run();
    }
    finally {
        fs.closeSync(descriptor);
        fs.rmSync(lock, { force: true });
    }
}
function migrateCodexSessions(legacyHome, sharedHome) {
    const marker = path.join(sharedHome, 'agent-run-migrations', `${(0, crypto_1.createHash)('sha256').update(path.resolve(legacyHome)).digest('hex')}.json`);
    if (fs.existsSync(marker))
        return;
    // Rollouts are Codex's durable session source. Let Codex rebuild its derived
    // database; never merge SQLite files or copy daemon installs, sockets or locks.
    function copyMissing(source, target) {
        if (!fs.existsSync(source))
            return;
        for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
            const from = path.join(source, entry.name);
            const to = path.join(target, entry.name);
            if (entry.isDirectory())
                copyMissing(from, to);
            else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                fs.mkdirSync(target, { recursive: true });
                try {
                    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
                }
                catch (error) {
                    if (error.code !== 'EEXIST')
                        throw error;
                }
            }
        }
    }
    for (const dir of ['sessions', 'archived_sessions'])
        copyMissing(path.join(legacyHome, dir), path.join(sharedHome, dir));
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ source: legacyHome, migrated: new Date().toISOString() }) + '\n');
}
