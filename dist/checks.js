"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkProject = checkProject;
exports.checkSourceTree = checkSourceTree;
exports.printProjectReport = printProjectReport;
exports.printBatchReport = printBatchReport;
exports.hasErrors = hasErrors;
const fs = require("fs");
const path = require("path");
const constants_1 = require("./constants");
const config_tree_1 = require("./config-tree");
const manifest_1 = require("./manifest");
const project_1 = require("./project");
const renderer_1 = require("./renderer");
const utils_1 = require("./utils");
function checkProject(projectRoot) {
    const findings = [];
    (0, utils_1.verbose)(`checking project ${projectRoot}`);
    const profileResult = (0, project_1.resolveProfileResult)(projectRoot);
    if (profileResult.profile === null) {
        for (const file of (0, project_1.findLocalAiFiles)(projectRoot)) {
            findings.push({ message: `local AI file in project: ${file}`, severity: 'ERROR' });
        }
        findings.push({ message: profileResult.reason, severity: 'ERROR' });
        return findings;
    }
    const agentDir = (0, project_1.resolveAgentDir)(projectRoot);
    if (profileForbidsLocalAiFiles(projectRoot, agentDir, profileResult.profile)) {
        for (const file of (0, project_1.findLocalAiFiles)(projectRoot, agentDir)) {
            findings.push({ message: `local AI file in project: ${file}`, severity: 'ERROR' });
        }
    }
    findings.push(...checkAgentDirectory(projectRoot, agentDir));
    return findings;
}
function profileForbidsLocalAiFiles(projectRoot, agentDir, profile) {
    try {
        return (0, manifest_1.normalizeManifest)((0, manifest_1.loadManifest)((0, project_1.defaultConfigRoot)(projectRoot), agentDir, profile), profile).guardrails
            .forbidRepoAiFiles;
    }
    catch {
        return true;
    }
}
function checkAgentDirectory(projectRoot, agentDir) {
    const findings = [];
    const configRoot = (0, project_1.defaultConfigRoot)(projectRoot);
    if (!(0, manifest_1.isProfileConfigured)(agentDir)) {
        return [{ message: `missing manifest or legacy/local source file in ${agentDir}`, severity: 'ERROR' }];
    }
    for (const legacyPath of (0, config_tree_1.describeLegacyProfileLayout)(agentDir, configRoot)) {
        findings.push({ message: `old profile layout needs migration: ${legacyPath}`, severity: 'ERROR' });
    }
    for (const relativeTemplate of constants_1.REQUIRED_GLOBAL_TEMPLATES) {
        if (relativeTemplate.endsWith('/SKILL.md.njk') && fs.existsSync(path.join(configRoot, relativeTemplate.slice(0, -4))))
            continue;
        if (!fs.existsSync(path.join(configRoot, relativeTemplate))) {
            findings.push({
                message: `missing required global template: ${path.join(configRoot, relativeTemplate)}`,
                severity: 'ERROR'
            });
        }
    }
    findings.push(...(0, renderer_1.checkRenderedProfile)(projectRoot, agentDir));
    return findings;
}
function checkSourceTree(rootPath) {
    const entries = (0, project_1.findSourceRepos)(rootPath).map((projectRoot) => ({
        findings: checkProject(projectRoot),
        label: projectRoot
    }));
    return {
        entries,
        hasErrors: entries.length === 0 || entries.some((entry) => hasErrors(entry.findings)),
        root: rootPath
    };
}
function printProjectReport(projectRoot, findings) {
    process.stdout.write(`Check: ${projectRoot}\n`);
    if (findings.length === 0) {
        process.stdout.write('OK no issues found\n');
        return;
    }
    for (const finding of findings) {
        process.stdout.write(`${finding.severity} ${finding.message}\n`);
    }
    process.stdout.write(`Summary: ${countFindings(findings, 'ERROR')} error(s), ${countFindings(findings, 'WARN')} warning(s)\n`);
}
function printBatchReport(rootPath, entries) {
    process.stdout.write(`Check all: ${rootPath}\n`);
    if (entries.length === 0) {
        process.stdout.write('ERROR no source repos found\n');
        return;
    }
    let totalErrors = 0;
    let totalWarnings = 0;
    for (const entry of entries) {
        if (entry.findings.length === 0) {
            process.stdout.write(`OK ${entry.label}\n`);
            continue;
        }
        process.stdout.write(`FAIL ${entry.label}\n`);
        for (const finding of entry.findings) {
            process.stdout.write(`  ${finding.severity} ${finding.message}\n`);
        }
        totalErrors += countFindings(entry.findings, 'ERROR');
        totalWarnings += countFindings(entry.findings, 'WARN');
    }
    process.stdout.write(`Summary: ${totalErrors} error(s), ${totalWarnings} warning(s)\n`);
}
function hasErrors(findings) {
    return findings.some((finding) => finding.severity === 'ERROR');
}
function countFindings(findings, severity) {
    return findings.filter((finding) => finding.severity === severity).length;
}
