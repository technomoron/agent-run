#!/usr/bin/env sh
set -u

target="${AGENT_CONFIG_TARGET:-$HOME/.agent-config}"

[ -d "$target/.git" ] || exit 0
command -v git >/dev/null 2>&1 || exit 0

status="$(git -C "$target" status --short 2>/dev/null)" || exit 0
[ -n "$status" ] || exit 0

cat <<'BANNER'

###############################################################################
###############################################################################
##                                                                           ##
##        WARNING: ~/.agent-config HAS UNCOMMITTED LOCAL CHANGES             ##
##                                                                           ##
##        agent-run config updates should not pull over this tree.           ##
##        Commit, stash, or remove these changes before updating configs.    ##
##                                                                           ##
###############################################################################
###############################################################################

BANNER

printf '%s\n' "$status" | sed 's/^/  /'
printf '\n'
