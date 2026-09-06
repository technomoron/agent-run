#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

echo "Running tests"
pnpm test

echo "Running build"
pnpm build

echo "Release verification completed."
