#!/bin/bash
# Posts Pi-hole's figures (its last 24 hours) to the dashboard Worker, /api/pihole/bridge.
# Runs on the Pi next to Pi-hole, as root (for `pihole api`), every minute from a systemd timer.
# Needs two root-only files (mode 600), never committed:
#   /etc/pihole-dash/url      the dashboard URL (as in local.config.json)
#   /etc/pihole-dash/headers  the Cloudflare Access service token as two header lines:
#                             CF-Access-Client-Id: ….access
#                             CF-Access-Client-Secret: …
# Install:
#   install -m 755 pihole-push.sh /usr/local/bin/pihole-dash-push
#   /etc/systemd/system/pihole-dash.service: [Service] Type=oneshot, ExecStart=/usr/local/bin/pihole-dash-push
#   /etc/systemd/system/pihole-dash.timer:   [Timer] OnBootSec=2min, OnUnitActiveSec=1min
#   systemctl enable --now pihole-dash.timer
set -euo pipefail

DIR=/etc/pihole-dash
url=$(tr -d '\n' < "$DIR/url")
url=${url%/}

summary=$(pihole api stats/summary)
blocking=$(pihole api dns/blocking | jq -r '.blocking // "unknown"')
state=$(jq -c --arg b "$blocking" '{
  queries: .queries.total,
  blocked: .queries.blocked,
  percent: .queries.percent_blocked,
  clients: .clients.active,
  domains: .gravity.domains_being_blocked,
  blocking: $b
}' <<< "$summary")

curl -fsS -m 20 -o /dev/null -X POST \
  -H 'Content-Type: application/json' -H @"$DIR/headers" \
  --data "{\"state\":$state}" "$url/api/pihole/bridge"
