#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const workRoot = path.resolve(repoRoot, '..');
const licenseTemplate = fs.readFileSync(path.join(repoRoot, 'templates', 'LICENSE'), 'utf8');
const licenseMitTemplate = fs.readFileSync(path.join(repoRoot, 'templates', 'LICENSE-MIT'), 'utf8');
const defaultCopyright = 'Copyright (c) 2026 Bjørn Erik Jacobsen';

for (const dir of listSourceRepos(workRoot)) {
	ensureLicenseFile(dir);
	ensurePackageLicense(dir);
}

function listSourceRepos(rootDir) {
	const repos = [];

	walk(rootDir, 0, (fullPath, dirent, depth) => {
		if (dirent.isDirectory() && dirent.name === '.git') {
			repos.push(path.dirname(fullPath));
			return 'skip';
		}

		if (dirent.isDirectory() && depth >= 3) {
			return 'skip';
		}

		return undefined;
	});

	return repos.sort();
}

function ensureLicenseFile(dir) {
	const licenseFile = path.join(dir, 'LICENSE');
	const packageFile = path.join(dir, 'package.json');

	if (fs.existsSync(licenseFile)) {
		process.stdout.write(`OK license exists: ${licenseFile}\n`);
		return;
	}

	let licenseName = '';
	let copyrightLine = defaultCopyright;

	if (fs.existsSync(packageFile)) {
		const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
		if (typeof pkg.license === 'string') {
			licenseName = pkg.license;
		}
		if (typeof pkg.copyright === 'string' && pkg.copyright) {
			copyrightLine = pkg.copyright;
		}
	}

	if (licenseName === 'MIT') {
		const output = licenseMitTemplate.replace('[Insert Copyright]', copyrightLine);
		fs.writeFileSync(licenseFile, output, 'utf8');
		process.stdout.write(`CREATED MIT license: ${licenseFile}\n`);
		return;
	}

	fs.writeFileSync(licenseFile, licenseTemplate, 'utf8');
	process.stdout.write(`CREATED license: ${licenseFile}\n`);
}

function ensurePackageLicense(dir) {
	const packageFile = path.join(dir, 'package.json');

	if (!fs.existsSync(packageFile)) {
		return;
	}

	const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
	if (pkg.license) {
		process.stdout.write(`OK package license exists: ${packageFile}\n`);
		return;
	}

	pkg.license = 'UNLICENSED';
	fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
	process.stdout.write(`UPDATED package license to UNLICENSED: ${packageFile}\n`);
}

function walk(dir, depth, visitor) {
	const entries = fs.readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const dirent of entries) {
		const fullPath = path.join(dir, dirent.name);
		const result = visitor(fullPath, dirent, depth + 1);
		if (dirent.isDirectory() && result !== 'skip') {
			walk(fullPath, depth + 1, visitor);
		}
	}
}
