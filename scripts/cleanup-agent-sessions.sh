#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
	echo "cleanup-agent-sessions.sh must run as root" >&2
	exit 1
fi

# Select accounts explicitly; never scan every home or run native CLIs as root.
read -r -a accounts <<<"${AI_TOOLS_CLEANUP_USERS-${AI_TOOLS_BRAIN_USERS:-}}"
status=0
for account in "${accounts[@]}"; do
	entry="$(getent passwd "$account")" || { echo "Unknown cleanup account: $account" >&2; status=1; continue; }
	IFS=: read -r username password uid gid gecos account_home login_shell <<<"$entry"
	if [ "$uid" -lt 1000 ] || [ "$uid" -eq 65534 ]; then
		echo "Refusing to clean sessions for system account: $account" >&2
		status=1
		continue
	fi
	# A clean environment avoids leaking root's home, session IDs or native settings.
	if ! runuser -u "$username" -- env -i "HOME=$account_home" "USER=$username" "LOGNAME=$username" \
		PATH=/usr/local/bin:/usr/bin:/bin /bin/sh -c 'cd "$HOME" && exec "$@"' cleanup-agent-sessions /usr/local/bin/agent-run \
		--configdir "$account_home/.agent-run" --clean-old all; then
		status=1
	fi
done
exit "$status"
