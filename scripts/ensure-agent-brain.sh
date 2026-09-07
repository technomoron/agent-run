#!/usr/bin/env bash
set -euo pipefail

# Only accounts explicitly selected by the administrator are managed here.
if [ "$(id -u)" -ne 0 ]; then
	echo "ensure-agent-brain.sh must run as root" >&2
	exit 1
fi

for account in "$@"; do
	entry="$(getent passwd "$account")" || { echo "Unknown brain account: $account" >&2; exit 1; }
	IFS=: read -r username password uid gid gecos account_home login_shell <<<"$entry"
	if [ "$uid" -lt 1000 ] || [ "$uid" -eq 65534 ]; then
		echo "Refusing to run agent-brain for system account: $account" >&2
		exit 1
	fi
	loginctl enable-linger "$username"
	systemctl start "user@$uid.service"
	user_systemctl() {
		runuser -u "$username" -- env "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus" systemctl --user "$@"
	}
	user_systemctl daemon-reload
	user_systemctl enable agent-brain.service
	user_systemctl restart agent-brain.service
	user_systemctl is-active --quiet agent-brain.service
done
