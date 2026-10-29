# Shared by dev.sh and topo.sh: settings, podman here and on production, messages.
# shellcheck shell=bash
set -euo pipefail
cd "$(dirname "$0")"
source ./kit.env

read -ra pm <<<"$PODMAN"
p() { "${pm[@]}" "$@"; } # podman on this machine

# podman on the production machine, over ssh. One connection is reused for 2 minutes.
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o "ControlPath=$HOME/.ssh/cm-%C" -o ControlPersist=120)
# Only "pp cp - <container>:<path>" reads this script's input (an archive); every other call gets none, so ssh
# cannot swallow what you type or pipe in, such as the answer to "Go ahead?".
# shellcheck disable=SC2029 # quoted here on purpose, for the remote shell
pp() {
  if [ "${1:-}" = cp ] && [ "${2:-}" = - ]; then
    ssh "${SSH_OPTS[@]}" "$PROD_SSH" "$(printf '%q ' podman "$@")"
  else
    ssh "${SSH_OPTS[@]}" "$PROD_SSH" "$(printf '%q ' podman "$@")" </dev/null
  fi
}
need_prod() {
  ssh "${SSH_OPTS[@]}" "$PROD_SSH" true </dev/null 2>/dev/null && return 0
  die "Cannot log in to $PROD_SSH without a password. Do this once, then try again:
  ssh-keygen -t ed25519        (press Enter at every question; skip it if ~/.ssh/id_ed25519 exists)
  ssh-copy-id $PROD_SSH"
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 1; }
running() { [ "$(p container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
host_address() { # the address other computers reach this one at
  local a=$DEV_HOST
  [ -n "$a" ] || a=$({ ip -4 route get 1.1.1.1 2>/dev/null || true; } |
    awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }')
  [ -n "$a" ] || a=$({ hostname -I 2>/dev/null || true; } | awk '{ print $1 }')
  say "${a:-localhost}"
}
