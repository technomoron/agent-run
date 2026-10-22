#!/usr/bin/env sh
set -u

target="${AGENT_CONFIG_TARGET:-${AGENT_CONFIG_ROOT:-${AGENT_CONFIG_DIR:-$HOME/.agent-run}}}"

[ -d "$target/.git" ] || exit 0
command -v git >/dev/null 2>&1 || exit 0

status="$(git -C "$target" status --short 2>/dev/null)" || exit 0
[ -n "$status" ] || exit 0

cat <<'BANNER'

###############################################################################
###############################################################################
##                                                                           ##
##        WARNING: agent-run CONFIG HAS UNCOMMITTED LOCAL CHANGES             ##
##                                                                           ##
##        agent-run config updates should not pull over this tree.           ##
##        Commit, stash, or remove these changes before updating configs.    ##
##                                                                           ##
###############################################################################
###############################################################################

BANNER

printf '  Optional configuration Git checkout: %s\n\n' "$target"
printf '%s\n' "$status" | sed 's/^/  /'
printf '\n'
