#!/bin/sh

# Real Codex binary (avoid recursion)
REAL_CODEX=$(command -v codex | grep -v "codex-wrapper.sh")

###############################################################################
# 1. Require package.json to exist
###############################################################################

if [ ! -f package.json ]; then
  echo "❌ ERROR: No package.json found. You must run codex inside a Node project."
  exit 1
fi

###############################################################################
# 2. Extract package name (supports @scope/name and name)
###############################################################################

PKG_NAME=$(node -p "require('./package.json').name" 2>/dev/null)
if [ -z "$PKG_NAME" ]; then
  echo "❌ ERROR: Could not read 'name' field from package.json"
  exit 1
fi

# Remove leading '@' if present
PKG_NOPREFIX=$(echo "$PKG_NAME" | sed 's/^@//')

# Convert "@scope/name" → "name" (profile = name)
PROFILE=$(echo "$PKG_NOPREFIX" | awk -F/ '{print $NF}')

echo "🧠 Using agent profile: $PROFILE"

###############################################################################
# 3. Verify that such an agent exists in configured agent_paths
###############################################################################

# Codex can list available agents using:
# codex app-server agent list   (internal undocumented command)
# But since that's not stable, we simply let Codex fail gracefully.

# To give a clearer error now:
AGENT_SEARCH_PATH="/home/bjorn/work/agents/technomoron/$PROFILE"

if [ ! -d "$AGENT_SEARCH_PATH" ]; then
  echo "❌ ERROR: Expected agent directory not found:"
  echo "   $AGENT_SEARCH_PATH"
  echo "Make sure AGENTS.md exists inside that folder."
  exit 1
fi

###############################################################################
# 4. Run Codex with the correct profile + full-auto + workspace-write
###############################################################################

exec "$REAL_CODEX" \
  --profile "$PROFILE" \
  --full-auto \
  --sandbox workspace-write \
  "$@"
