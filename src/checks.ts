import * as fs from 'fs';
import * as path from 'path';
import { REQUIRED_GLOBAL_TEMPLATES } from './constants';
import { describeLegacyProfileLayout } from './config-tree';
import { isProfileConfigured, loadManifest, normalizeManifest } from './manifest';
import { Finding } from './model';
import {
	defaultConfigRoot,
	findLocalAiFiles,
	findSourceRepos,
	resolveAgentDir,
	resolveProfileResult
} from './project';
import { checkRenderedProfile } from './renderer';
import { verbose } from './utils';

export function checkProject(projectRoot: string): Finding[] {
	const findings: Finding[] = [];
	verbose(`checking project ${projectRoot}`);
	const profileResult = resolveProfileResult(projectRoot);
	if (profileResult.profile === null) {
		for (const file of findLocalAiFiles(projectRoot)) {
			findings.push({ message: `local AI file in project: ${file}`, severity: 'ERROR' });
		}
		findings.push({ message: profileResult.reason, severity: 'ERROR' });
		return findings;
	}

	const agentDir = resolveAgentDir(projectRoot);
	if (profileForbidsLocalAiFiles(projectRoot, agentDir, profileResult.profile)) {
		for (const file of findLocalAiFiles(projectRoot, agentDir)) {
			findings.push({ message: `local AI file in project: ${file}`, severity: 'ERROR' });
		}
	}
	findings.push(...checkAgentDirectory(projectRoot, agentDir));
	return findings;
}

function profileForbidsLocalAiFiles(projectRoot: string, agentDir: string, profile: string): boolean {
	try {
		return normalizeManifest(loadManifest(defaultConfigRoot(projectRoot), agentDir, profile), profile).guardrails
			.forbidRepoAiFiles;
	} catch {
		return true;
	}
}

function checkAgentDirectory(projectRoot: string, agentDir: string): Finding[] {
	const findings: Finding[] = [];
	const configRoot = defaultConfigRoot(projectRoot);
	if (!isProfileConfigured(agentDir)) {
		return [{ message: `missing manifest or legacy/local source file in ${agentDir}`, severity: 'ERROR' }];
	}
	for (const legacyPath of describeLegacyProfileLayout(agentDir, configRoot)) {
		findings.push({ message: `old profile layout needs migration: ${legacyPath}`, severity: 'ERROR' });
	}
	for (const relativeTemplate of REQUIRED_GLOBAL_TEMPLATES) {
		if (relativeTemplate.endsWith('/SKILL.md.njk') && fs.existsSync(path.join(configRoot, relativeTemplate.slice(0, -4)))) continue;
		if (!fs.existsSync(path.join(configRoot, relativeTemplate))) {
			findings.push({
				message: `missing required global template: ${path.join(configRoot, relativeTemplate)}`,
				severity: 'ERROR'
			});
		}
	}
	findings.push(...checkRenderedProfile(projectRoot, agentDir));
	return findings;
}

export function checkSourceTree(rootPath: string): {
	entries: Array<{ findings: Finding[]; label: string }>;
	hasErrors: boolean;
	root: string;
} {
	const entries = findSourceRepos(rootPath).map((projectRoot) => ({
		findings: checkProject(projectRoot),
		label: projectRoot
	}));
	return {
		entries,
		hasErrors: entries.length === 0 || entries.some((entry) => hasErrors(entry.findings)),
		root: rootPath
	};
}

export function printProjectReport(projectRoot: string, findings: Finding[]): void {
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

export function printBatchReport(rootPath: string, entries: Array<{ findings: Finding[]; label: string }>): void {
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

export function hasErrors(findings: Finding[]): boolean {
	return findings.some((finding) => finding.severity === 'ERROR');
}

function countFindings(findings: Finding[], severity: Finding['severity']): number {
	return findings.filter((finding) => finding.severity === severity).length;
}
