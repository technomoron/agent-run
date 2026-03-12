#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WORK_ROOT=$(CDPATH= cd -- "$REPO_ROOT/.." && pwd)
LICENSE_TEMPLATE="$REPO_ROOT/templates/LICENSE"
LICENSE_MIT_TEMPLATE="$REPO_ROOT/templates/LICENSE-MIT"
DEFAULT_COPYRIGHT="Copyright (c) 2026 Bjørn Erik Jacobsen"

list_source_repos() {
	find "$WORK_ROOT" -mindepth 1 -maxdepth 2 -type d -name .git -printf '%h\n' | sort -u
}

ensure_license_file() {
	dir="$1"
	license_file="$dir/LICENSE"
	package_file="$dir/package.json"

	if [ -f "$license_file" ]; then
		printf 'OK license exists: %s\n' "$license_file"
		return 0
	fi

	license_name=""
	copyright_line="$DEFAULT_COPYRIGHT"

	if [ -f "$package_file" ]; then
		license_name=$(node -e '
			const pkg = require(process.argv[1]);
			process.stdout.write(typeof pkg.license === "string" ? pkg.license : "");
		' "$package_file")
		copyright_line=$(node -e '
			const pkg = require(process.argv[1]);
			process.stdout.write(typeof pkg.copyright === "string" && pkg.copyright ? pkg.copyright : process.argv[2]);
		' "$package_file" "$DEFAULT_COPYRIGHT")
	fi

	if [ "$license_name" = "MIT" ]; then
		node -e '
			const fs = require("fs");
			const template = fs.readFileSync(process.argv[1], "utf8");
			const output = template.replace("[Insert Copyright]", process.argv[2]);
			fs.writeFileSync(process.argv[3], output);
		' "$LICENSE_MIT_TEMPLATE" "$copyright_line" "$license_file"
		printf 'CREATED MIT license: %s\n' "$license_file"
		return 0
	fi

	cp "$LICENSE_TEMPLATE" "$license_file"
	printf 'CREATED license: %s\n' "$license_file"
}

ensure_package_license() {
	dir="$1"
	package_file="$dir/package.json"

	if [ ! -f "$package_file" ]; then
		return 0
	fi

	if node -e "const pkg=require(process.argv[1]); process.exit(pkg.license ? 0 : 1)" "$package_file"; then
		printf 'OK package license exists: %s\n' "$package_file"
		return 0
	fi

	node -e '
		const fs = require("fs");
		const file = process.argv[1];
		const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
		pkg.license = "UNLICENSED";
		fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
	' "$package_file"
	printf 'UPDATED package license to UNLICENSED: %s\n' "$package_file"
}

list_source_repos | while IFS= read -r dir; do
	[ -n "$dir" ] || continue
	ensure_license_file "$dir"
	ensure_package_license "$dir"
done
