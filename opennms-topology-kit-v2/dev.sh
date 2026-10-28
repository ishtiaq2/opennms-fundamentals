#!/usr/bin/env bash
# Development OpenNMS Horizon 33.1.8 + PostgreSQL in a rootless Podman pod, made for a CentOS Stream 9
# or RHEL 9 machine such as a VirtualBox VM. Open it from a browser on any computer of your network.
#
#   ./dev.sh up            check this machine, start OpenNMS, seed demo DAS nodes, deploy the kit
#                          (the first run downloads about 1.5 GB, then initialises for 5-10 minutes)
#   ./dev.sh status        containers, memory and addresses
#   ./dev.sh logs [file]   follow an OpenNMS log: karaf.log (default), manager.log, web.log, ...
#   ./dev.sh down          stop; ./dev.sh up starts it again with all data
#   ./dev.sh reset         delete the containers and all their data
#   ./dev.sh pull <path>   copy a stock OpenNMS file into overlay/ to edit it, e.g.
#                          ./dev.sh pull jetty-webapps/opennms/svg/opennms_icons.svg
set -euo pipefail
cd "$(dirname "$0")"
source ./kit.env

read -ra pm <<<"$PODMAN"
p() { "${pm[@]}" "$@"; }

POD_LABEL=io.das-topology-kit.pod # kit version and published ports of the pod
POD_ID="2:$DEV_PORT:$DEV_KARAF_PORT"
HEAP_LABEL=io.das-topology-kit.heap
URL="http://localhost:$DEV_PORT/opennms"
DB="$DEV_POD-db"
OPENNMS=/usr/share/opennms # /opt/opennms in the image is a link to it
START_LOG=.dev/opennms-start.log
ME=${USER:-$(id -un)}
heap=''

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 1; }
mem_mb() { awk -v key="$1:" '$1 == key { print int($2 / 1024) }' /proc/meminfo; } # MemTotal, MemAvailable
clock() { local s=$((SECONDS - $1)); printf '%d:%02d' $((s / 60)) $((s % 60)); }
running() { [ "$(p container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
port_busy() {
  if command -v ss >/dev/null; then [ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]; else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}
host_address() { # the address other computers reach this one at
  local a=$DEV_HOST
  [ -n "$a" ] || a=$({ ip -4 route get 1.1.1.1 2>/dev/null || true; } |
    awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }')
  [ -n "$a" ] || a=$({ hostname -I 2>/dev/null || true; } | awk '{ print $1 }')
  say "${a:-localhost}"
}

# --- checks ------------------------------------------------------------------------------------------

check_tools() {
  local missing=() major
  command -v "${pm[0]}" >/dev/null || missing+=("Podman:      sudo dnf install -y podman")
  command -v curl >/dev/null || missing+=("curl:        sudo dnf install -y curl")
  if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
    missing+=("Node.js 18+: sudo dnf module install -y nodejs:22")
  elif major=$(node -p 'process.versions.node.split(".")[0]') && [ "$major" -lt 18 ]; then
    missing+=("Node.js 18+ (this is $(node -v)): sudo dnf module reset -y nodejs && sudo dnf module install -y nodejs:22")
  fi
  [ ${#missing[@]} -eq 0 ] || { warn "Please install first:"; printf '  %s\n' "${missing[@]}" >&2; exit 1; }
}

# Memory decides the Java heap: the image default (1024m) needs a 4 GB machine.
check_resources() {
  local problems=() total store free need port
  total=$(mem_mb MemTotal)
  if [ -n "$DEV_HEAP" ]; then
    heap=$DEV_HEAP
  elif [ "$total" -ge 3400 ]; then
    heap=1024m
  elif [ "$total" -ge 2500 ] || [ "${FORCE:-}" = 1 ]; then
    heap=768m
    warn "Note: $total MB of memory is tight for OpenNMS, so it gets a $heap Java heap. 4 GB is better."
  else
    problems+=("This machine has $total MB of memory. OpenNMS and PostgreSQL need about 3 GB; with less,
    OpenNMS is killed while it starts. Give the VM 4 GB: shut it down, then in VirtualBox open
    Settings > System > Motherboard and set Base Memory to 4096 MB. (FORCE=1 ./dev.sh up tries anyway.)")
  fi
  [ "$(nproc)" -ge 2 ] || warn "Note: with 1 CPU the first start takes 20 minutes or more (VirtualBox: Settings > System > Processor)."

  store=$(p info --format '{{.Store.GraphRoot}}' 2>/dev/null) || store=$HOME
  while [ ! -d "$store" ]; do store=$(dirname "$store"); done
  free=$(df -Pm "$store" | awk 'NR == 2 { print $4 }')
  need=1500
  p image exists "$ONMS_IMAGE" || need=6000
  [ "$free" -ge "$need" ] || problems+=("Only $free MB of disk space is free in $store; the stack needs about $need MB.")

  case $(p pod inspect -f '{{.State}}' "$DEV_POD" 2>/dev/null) in
    Running | Degraded) ;; # the ports are the pod's own
    *)
      for port in "$DEV_PORT" "$DEV_KARAF_PORT"; do
        if port_busy "$port"; then
          problems+=("Port $port is used by another program (a production OpenNMS?). Use other ports:
    DEV_PORT=8981 DEV_KARAF_PORT=8102 ./dev.sh up   (or set them in kit.env)")
        fi
      done
      ;;
  esac
  [ ${#problems[@]} -eq 0 ] || { warn "Please fix this first, then run ./dev.sh up again:"; printf '  - %s\n' "${problems[@]}" >&2; exit 1; }
}

# Once per machine: firewalld lets browsers on other computers in, and lingering keeps the containers
# running after you log out. Both need sudo.
prepare_host() {
  local marker=".dev/host-ready-$DEV_PORT-$PREVIEW_PORT" cmds=() cmd failed=0
  [ ! -f "$marker" ] || return 0
  if [ "$OPEN_FIREWALL" = yes ] && systemctl is-active --quiet firewalld 2>/dev/null; then
    say "Opening ports $DEV_PORT (OpenNMS) and $PREVIEW_PORT (live preview) in firewalld for browsers on other computers."
    cmds+=("firewall-cmd --quiet --permanent --add-port=$DEV_PORT/tcp --add-port=$PREVIEW_PORT/tcp" "firewall-cmd --quiet --reload")
  fi
  if [ "$(loginctl show-user "$ME" -p Linger --value 2>/dev/null)" = no ]; then
    say "Letting the containers run on after you log out (loginctl enable-linger)."
    cmds+=("loginctl enable-linger $ME")
  fi
  [ ${#cmds[@]} -eq 0 ] || say "sudo may ask for your password."
  for cmd in "${cmds[@]}"; do
    # shellcheck disable=SC2086 # split into words on purpose
    sudo $cmd || { failed=1; warn "  That failed. Run it yourself: sudo $cmd"; }
  done
  [ "$failed" = 1 ] || { mkdir -p .dev && touch "$marker"; }
}

# --- the stack -----------------------------------------------------------------------------------

remove_stack() {
  p rm -f -v -t 30 "$DEV_CONTAINER" "$DB" >/dev/null 2>&1 || true
  p pod rm -f "$DEV_POD" >/dev/null 2>&1 || true
  p volume rm -f "$DEV_POD-pgdata" "$DEV_POD-etc" "$DEV_POD-data" >/dev/null 2>&1 || true
  rm -f .dev/seeded src/icon-mapping.dev.cfg
}

# Ports are fixed when a pod is made: new ports need a new pod. The volumes, and so the data, stay.
check_pod() {
  p pod exists "$DEV_POD" 2>/dev/null || return 0
  case $(p pod inspect -f "{{index .Labels \"$POD_LABEL\"}}" "$DEV_POD" 2>/dev/null) in
    "$POD_ID") ;;
    2:*)
      say "Re-creating $DEV_POD for ports $DEV_PORT and $DEV_KARAF_PORT (the data stays)."
      p rm -f -v -t 60 "$DEV_CONTAINER" "$DB" >/dev/null 2>&1 || true
      p pod rm -f "$DEV_POD" >/dev/null
      ;;
    *)
      say "Removing $DEV_POD, the development stack of an earlier kit version."
      remove_stack
      ;;
  esac
}

create_stack() {
  local image
  for image in "$PG_IMAGE" "$ONMS_IMAGE"; do
    p image exists "$image" || { say "Downloading $image (OpenNMS is about 1.5 GB; only once)"; p pull "$image"; }
  done
  p pod exists "$DEV_POD" ||
    p pod create --name "$DEV_POD" --label "$POD_LABEL=$POD_ID" -p "$DEV_PORT:8980" -p "$DEV_KARAF_PORT:8101" >/dev/null
  p container exists "$DB" || p create --pod "$DEV_POD" --name "$DB" \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -v "$DEV_POD-pgdata:/var/lib/postgresql/data" "$PG_IMAGE" >/dev/null
  # OpenNMS keeps its configuration and data in volumes and in PostgreSQL: another image or heap only
  # re-creates the container.
  if p container exists "$DEV_CONTAINER" &&
    [ "$(p container inspect -f "{{.ImageName}} {{index .Config.Labels \"$HEAP_LABEL\"}}" "$DEV_CONTAINER")" != "$ONMS_IMAGE $heap" ]; then
    p rm -f -v -t 60 "$DEV_CONTAINER" >/dev/null
  fi
  p container exists "$DEV_CONTAINER" || p create --pod "$DEV_POD" --name "$DEV_CONTAINER" --label "$HEAP_LABEL=$heap" \
    -e POSTGRES_HOST=127.0.0.1 -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e OPENNMS_DBNAME=opennms -e OPENNMS_DBUSER=opennms -e OPENNMS_DBPASS=opennms \
    -e JAVA_OPTS="-Xmx$heap -XX:MaxMetaspaceSize=512m" \
    -v "$DEV_POD-etc:/opt/opennms/etc" -v "$DEV_POD-data:/opennms-data" \
    "$ONMS_IMAGE" -s >/dev/null
}

# Over TCP: while it initialises, PostgreSQL runs a temporary server that only listens on its socket.
db_ready() { p exec -e PGPASSWORD=postgres "$DB" psql -h 127.0.0.1 -U postgres -tAc 'select 1' >/dev/null 2>&1; }

wait_db() {
  local start=$SECONDS
  printf 'Starting PostgreSQL '
  until db_ready; do
    if ! running "$DB" || [ $((SECONDS - start)) -ge 300 ]; then
      echo
      p logs --tail 30 "$DB" 2>&1 | sed 's/^/  | /' >&2
      die "PostgreSQL did not start (the end of its log is above)."
    fi
    printf .
    sleep 2
  done
  say ' ready'
}

# ready: every OpenNMS health check passes. web: the web UI and REST answer, other services still start.
opennms_state() {
  local probe
  probe=$(curl -sS --max-time 10 "$URL/rest/health/probe" 2>/dev/null) || probe=''
  if [[ $probe == *'Everything is awesome'* ]]; then
    echo ready
  elif curl -fsS --max-time 10 -o /dev/null -u "$DEV_USER:$DEV_PASSWORD" "$URL/rest/info" 2>/dev/null; then
    echo web
  else
    echo down
  fi
}

# What OpenNMS is doing, from the messages of the image's /entrypoint.sh.
phase() {
  case $(p logs --tail 400 "$DEV_CONTAINER" 2>&1 |
    grep -E '^(Run config tester|Run OpenNMS install|System is already configured|\+ exec )' | tail -n 1) in
    'Run OpenNMS install'*) echo 'creating the database (first start only)' ;;
    'System is already'* | '+ exec '*) echo 'starting OpenNMS' ;;
    'Run config tester'*) echo 'checking the configuration' ;;
    *) echo 'preparing the configuration' ;;
  esac
}

save_log() { mkdir -p .dev && { p logs "$DEV_CONTAINER" >"$START_LOG" 2>&1 || true; }; }

explain_stop() {
  local code oom total
  code=$(p container inspect -f '{{.State.ExitCode}}' "$DEV_CONTAINER")
  oom=$(p container inspect -f '{{.State.OOMKilled}}' "$DEV_CONTAINER")
  total=$(mem_mb MemTotal)
  save_log
  warn ""
  warn "OpenNMS stopped (exit code $code). The end of its log:"
  { grep -v '^+' "$START_LOG" || true; } | tail -n 25 | cut -c 1-220 | sed 's/^/  | /' >&2
  warn ""
  case $code in
    137)
      if [ "$oom" = true ]; then warn "OpenNMS was killed because memory ran out."; else warn "OpenNMS was killed, almost always because memory ran out."; fi
      if [ "$total" -lt 3400 ]; then
        warn "This machine has $total MB, too little for OpenNMS (Java heap $heap). Give the VM 4 GB or more:"
        warn "shut it down, then VirtualBox > Settings > System > Motherboard > Base Memory. Then ./dev.sh up again."
      else
        warn "This machine has $total MB; see what else uses memory (free -m, top), then run ./dev.sh up again."
      fi
      ;;
    127) warn "Creating the database or checking the configuration failed (log above). ./dev.sh up tries again; ./dev.sh reset starts over." ;;
    143) warn "OpenNMS was stopped from outside (podman stop, or the machine shut down). ./dev.sh up starts it again." ;;
    *) warn "./dev.sh up tries again; ./dev.sh reset starts over." ;;
  esac
  warn "The whole log is in $START_LOG."
}

wait_opennms() {
  local start=$SECONDS shown=$SECONDS web_since='' state doing
  say "Starting OpenNMS. The first start takes 5-10 minutes, later starts 2-3."
  while :; do
    state=$(opennms_state)
    if [ "$state" = ready ]; then
      say "OpenNMS is ready ($(clock "$start"))."
      return 0
    fi
    if [ "$state" = web ]; then
      web_since=${web_since:-$SECONDS}
      if [ $((SECONDS - web_since)) -ge 600 ]; then
        warn "The web UI works, but not every OpenNMS service reports healthy:"
        { curl -sS -u "$DEV_USER:$DEV_PASSWORD" "$URL/rest/health" || true; } | head -c 2000 >&2
        warn ""
        return 0
      fi
    fi
    running "$DEV_CONTAINER" || { explain_stop; exit 1; }
    if [ $((SECONDS - start)) -ge 2700 ]; then
      save_log
      die "OpenNMS did not start within 45 minutes. Its log is in $START_LOG."
    fi
    if [ $((SECONDS - shown)) -ge 30 ]; then
      shown=$SECONDS
      if [ "$state" = web ]; then doing='web UI is up, starting the other services'; else doing=$(phase); fi
      say "  $(clock "$start")  $doing   ($(mem_mb MemAvailable) MB of memory free)"
    fi
    sleep 5
  done
}

seed_once() {
  [ ! -f .dev/seeded ] || return 0
  if node tools/onms.mjs seed --url "$URL" --user "$DEV_USER" --password "$DEV_PASSWORD"; then
    mkdir -p .dev && touch .dev/seeded
  else
    warn "The demo seed did not complete (see above); ./dev.sh up tries it again."
  fi
}

addresses() {
  local host
  host=$(host_address)
  printf '  %-14s %s\n' Topology "http://$host:$DEV_PORT/opennms/topology   (user $DEV_USER, password $DEV_PASSWORD)" \
    'Live editing' "npm run dev, then http://$host:$PREVIEW_PORT"
}

# --- commands --------------------------------------------------------------------------------------

up() {
  check_tools
  check_pod
  check_resources
  prepare_host
  [ -d node_modules/svgo ] || { say "Installing the build tools (npm ci)"; npm ci --no-audit --no-fund; }
  create_stack
  p start "$DB" >/dev/null ||
    die "Podman could not start the pod (error above). If a port is in use: DEV_PORT=8981 DEV_KARAF_PORT=8102 ./dev.sh up"
  wait_db
  p start "$DEV_CONTAINER" >/dev/null || die "Podman could not start OpenNMS (error above)."
  wait_opennms
  seed_once
  bash ./deploy.sh dev || warn "Deploying the kit failed (see above). Fix it, then run ./deploy.sh dev."
  say ""
  say "OpenNMS runs. In a browser on any computer of your network:"
  addresses
  say "  On the topology page pick View > \"DAS demo (GraphML)\" or \"UserDefined\"."
}

status() {
  local c state
  if ! p pod exists "$DEV_POD" 2>/dev/null; then
    say "There is no development stack yet: ./dev.sh up"
    return 0
  fi
  for c in "$DB" "$DEV_CONTAINER"; do
    printf '  %-14s %s\n' "$c" "$(p ps -a --filter "name=^$c\$" --format '{{.Status}}')"
  done
  case $(opennms_state) in
    ready) state='ready' ;;
    web) state='web UI up, other services still starting' ;;
    *) state="not answering on $URL" ;;
  esac
  printf '  %-14s %s\n' OpenNMS "$state" Memory "$(mem_mb MemAvailable) MB free of $(mem_mb MemTotal) MB"
  addresses
}

case ${1:-} in
  up) up ;;
  status) status ;;
  logs)
    if running "$DEV_CONTAINER"; then
      p exec "$DEV_CONTAINER" tail -n 200 -F "$OPENNMS/logs/${2:-karaf.log}"
    else
      p logs --tail 200 "$DEV_CONTAINER"
    fi
    ;;
  down) p pod stop -t 120 "$DEV_POD" >/dev/null && say 'Stopped. ./dev.sh up starts it again.' ;; # OpenNMS needs time to stop cleanly
  reset) remove_stack && say "Removed $DEV_POD and all its data." ;;
  pull)
    [ -n "${2:-}" ] || die "usage: ./dev.sh pull <path below $OPENNMS>"
    mkdir -p "overlay/$(dirname "$2")"
    p cp "$DEV_CONTAINER:$OPENNMS/$2" "overlay/$2" && say "overlay/$2 (edit it; npm run dev deploys it on every save)"
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
