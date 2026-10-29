#!/usr/bin/env bash
# The development OpenNMS: the production image and PostgreSQL 14 in a rootless Podman pod on this
# machine (CentOS Stream 9 / RHEL 9), with demo DAS nodes. Open it from a browser on any computer.
#
#   ./dev.sh up            check this machine, start OpenNMS, add demo nodes (the first run copies the
#                          image from production, ~1.5 GB, then initialises for 5-10 minutes)
#   ./dev.sh status        containers, memory and addresses
#   ./dev.sh logs [file]   follow an OpenNMS log: karaf.log (default), manager.log, web.log, ...
#   ./dev.sh down          stop; ./dev.sh up starts it again with all data
#   ./dev.sh reset         delete the containers and all their data
#   ./dev.sh prod-info     how the production container runs (image, command, ports, volumes, variables)
source "$(dirname "$0")/tools/common.sh"

POD_LABEL=io.das-topology-kit.pod # kit version and published ports of the pod
POD_ID="3:$DEV_PORT:$DEV_KARAF_PORT"
CORE_LABEL=io.das-topology-kit.core # image, heap and extra variables of the OpenNMS container
URL="http://localhost:$DEV_PORT/opennms"
DB="$DEV_POD-db"
OPENNMS=/opt/opennms
START_LOG=.kit/opennms-start.log
ME=${USER:-$(id -un)}
heap=''

mem_mb() { awk -v key="$1:" '$1 == key { print int($2 / 1024) }' /proc/meminfo; } # MemTotal, MemAvailable
clock() { local s=$((SECONDS - $1)); printf '%d:%02d' $((s / 60)) $((s % 60)); }
port_busy() {
  if command -v ss >/dev/null; then [ -n "$(ss -Hltn "sport = :$1" 2>/dev/null)" ]; else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}

# --- checks ------------------------------------------------------------------------------------------

check_tools() {
  local missing=()
  command -v "${pm[0]}" >/dev/null || missing+=("Podman:   sudo dnf install -y podman")
  command -v curl >/dev/null || missing+=("curl:     sudo dnf install -y curl")
  command -v python3 >/dev/null || missing+=("Python 3: sudo dnf install -y python3")
  command -v ssh >/dev/null || missing+=("ssh:      sudo dnf install -y openssh-clients")
  [ ${#missing[@]} -eq 0 ] || { warn "Please install first:"; printf '  %s\n' "${missing[@]}" >&2; exit 1; }
}

# Memory decides the Java heap: 1024m (the OpenNMS image default) needs a 4 GB machine.
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
          problems+=("Port $port is used by another program. Use other ports:
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
  local marker=".kit/host-ready-$DEV_PORT" cmds=() cmd failed=0
  [ ! -f "$marker" ] || return 0
  if [ "$OPEN_FIREWALL" = yes ] && systemctl is-active --quiet firewalld 2>/dev/null; then
    say "Opening port $DEV_PORT in firewalld for browsers on other computers."
    cmds+=("firewall-cmd --quiet --permanent --add-port=$DEV_PORT/tcp" "firewall-cmd --quiet --reload")
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
  [ "$failed" = 1 ] || { mkdir -p .kit && touch "$marker"; }
}

# --- the stack -----------------------------------------------------------------------------------

remove_stack() {
  p rm -f -v -t 30 "$DEV_CONTAINER" "$DB" >/dev/null 2>&1 || true
  p pod rm -f "$DEV_POD" >/dev/null 2>&1 || true
  p volume rm -f "$DEV_POD-pgdata" "$DEV_POD-etc" "$DEV_POD-data" >/dev/null 2>&1 || true
  rm -f .kit/seeded
}

# Ports are fixed when a pod is made: new ports need a new pod. The volumes, and so the data, stay.
check_pod() {
  p pod exists "$DEV_POD" 2>/dev/null || return 0
  case $(p pod inspect -f "{{index .Labels \"$POD_LABEL\"}}" "$DEV_POD" 2>/dev/null) in
    "$POD_ID") ;;
    3:*)
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

# The production image is not in a public registry: load it from ONMS_IMAGE_ARCHIVE, pull it, or copy
# it from the production machine.
get_image() {
  p image exists "$ONMS_IMAGE" && return 0
  if [ -n "$ONMS_IMAGE_ARCHIVE" ]; then
    say "Loading $ONMS_IMAGE from $ONMS_IMAGE_ARCHIVE"
    p load -i "$ONMS_IMAGE_ARCHIVE"
  elif p pull -q "$ONMS_IMAGE" >/dev/null 2>&1; then
    say "Pulled $ONMS_IMAGE"
  else
    need_prod
    say "Copying $ONMS_IMAGE from $PROD_SSH (about 1.5 GB, only once; production keeps running)."
    pp save "$ONMS_IMAGE" | p load
  fi
  p image exists "$ONMS_IMAGE" || die "$ONMS_IMAGE is still missing. Check the name with: ./dev.sh prod-info"
}

create_stack() {
  local env_args=() kv core_id
  get_image
  p image exists "$PG_IMAGE" || { say "Downloading $PG_IMAGE"; p pull "$PG_IMAGE"; }
  p pod exists "$DEV_POD" ||
    p pod create --name "$DEV_POD" --label "$POD_LABEL=$POD_ID" -p "$DEV_PORT:8980" -p "$DEV_KARAF_PORT:8101" >/dev/null
  p container exists "$DB" || p create --pod "$DEV_POD" --name "$DB" \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -v "$DEV_POD-pgdata:/var/lib/postgresql/data" "$PG_IMAGE" >/dev/null
  for kv in $DEV_ENV; do env_args+=(-e "$kv"); done
  # OpenNMS keeps its configuration and data in volumes and in PostgreSQL: another image, heap or
  # extra variables only re-create the container.
  core_id="$ONMS_IMAGE $heap $DEV_ENV"
  if p container exists "$DEV_CONTAINER" &&
    [ "$(p container inspect -f "{{index .Config.Labels \"$CORE_LABEL\"}}" "$DEV_CONTAINER")" != "$core_id" ]; then
    p rm -f -v -t 60 "$DEV_CONTAINER" >/dev/null
  fi
  p container exists "$DEV_CONTAINER" || p create --pod "$DEV_POD" --name "$DEV_CONTAINER" --label "$CORE_LABEL=$core_id" \
    -e POSTGRES_HOST=127.0.0.1 -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e OPENNMS_DBNAME=opennms -e OPENNMS_DBUSER=opennms -e OPENNMS_DBPASS=opennms \
    -e JAVA_OPTS="-Xmx$heap -XX:MaxMetaspaceSize=512m" "${env_args[@]}" \
    -v "$DEV_POD-etc:$OPENNMS/etc" -v "$DEV_POD-data:/opennms-data" \
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

save_log() { mkdir -p .kit && { p logs "$DEV_CONTAINER" >"$START_LOG" 2>&1 || true; }; }

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
    *) warn "Compare with production (./dev.sh prod-info): the image may need a variable, set it with DEV_ENV in kit.env." ;;
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
  [ ! -f .kit/seeded ] || return 0
  if python3 -u tools/seed.py --url "$URL" --user "$DEV_USER" --password "$DEV_PASSWORD" --container "$DEV_CONTAINER" --podman "$PODMAN"; then
    mkdir -p .kit && touch .kit/seeded
  else
    warn "The demo nodes are not complete (see above); ./dev.sh up tries again."
  fi
}

# --- commands --------------------------------------------------------------------------------------

up() {
  check_tools
  check_pod
  check_resources
  prepare_host
  create_stack
  p start "$DB" >/dev/null ||
    die "Podman could not start the pod (error above). If a port is in use: DEV_PORT=8981 DEV_KARAF_PORT=8102 ./dev.sh up"
  wait_db
  p start "$DEV_CONTAINER" >/dev/null || die "Podman could not start OpenNMS (error above)."
  wait_opennms
  seed_once
  say ""
  say "Development OpenNMS: http://$(host_address):$DEV_PORT/opennms/topology   (user $DEV_USER, password $DEV_PASSWORD)"
  [ -d opennms ] || say "Next: ./topo.sh pull   (copies the topology files of production here and into it)"
}

status() {
  local c state
  if ! p pod exists "$DEV_POD" 2>/dev/null; then
    say "There is no development OpenNMS yet: ./dev.sh up"
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
  printf '  %-14s %s\n' OpenNMS "$state" Memory "$(mem_mb MemAvailable) MB free of $(mem_mb MemTotal) MB" \
    Topology "http://$(host_address):$DEV_PORT/opennms/topology   (user $DEV_USER, password $DEV_PASSWORD)"
}

prod_info() {
  need_prod
  # shellcheck disable=SC2016 # a Go template, not shell
  pp inspect "$PROD_CONTAINER" --format 'Image:    {{.ImageName}}
Command:  {{.Config.Entrypoint}} {{.Config.Cmd}}
User:     {{.Config.User}}
Ports:    {{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIP}}:{{.HostPort}}{{end}}->{{$p}} {{end}}
Volumes:
{{range .Mounts}}  {{.Source}} -> {{.Destination}}
{{end}}Variables (names only):
{{range .Config.Env}}  {{.}}
{{end}}' | sed -E 's/^(  [A-Za-z0-9_]+)=.*/\1/'
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
  prod-info) prod_info ;;
  *)
    sed -n '2,11p' "$0"
    exit 2
    ;;
esac
