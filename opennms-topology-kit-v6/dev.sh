#!/usr/bin/env bash
# The development OpenNMS: the production image and PostgreSQL 14 in a rootless Podman pod on this
# machine (CentOS Stream 9 / RHEL 9), with demo DAS nodes. Open it from a browser on any computer.
#
#   ./dev.sh up            check this machine, copy production's overlay folders, start OpenNMS, add demo
#                          nodes, test a login (the first run copies the image from production, ~1.5 GB,
#                          then initialises for 5-10 minutes)
#   ./dev.sh status        containers, memory, addresses, the health checks that fail, a test login
#   ./dev.sh logs [file]   follow an OpenNMS log: karaf.log (default), manager.log, web.log, ...
#   ./dev.sh down          stop; ./dev.sh up starts it again with all data
#   ./dev.sh reset         delete the containers and all their data
#   ./dev.sh prod-info     how the production container runs (image, command, user, privileges, ports, volumes, variable names)
source "$(dirname "$0")/tools/common.sh"

POD_LABEL=io.das-topology-kit.pod # kit version and published ports of the pod
POD_ID="3:$DEV_PORT:$DEV_KARAF_PORT"
CORE_LABEL=io.das-topology-kit.core # image, heap and extra variables of the OpenNMS container
URL="http://localhost:$DEV_PORT/opennms"
DB="$DEV_POD-db"
OPENNMS=/opt/opennms
START_LOG=.kit/opennms-start.log
OVL=.kit/overlays # dev's copy of production's overlay folders (prepare_overlays)
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
  rm -rf .kit/seeded "$OVL"
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
  local rc=0 id
  p image exists "$ONMS_IMAGE" || rc=$?
  [ "$rc" -ne 0 ] || return 0
  [ "$rc" -eq 1 ] || warn "podman image exists $ONMS_IMAGE failed (exit code $rc)."
  if [ -n "$ONMS_IMAGE_ARCHIVE" ]; then
    say "Loading $ONMS_IMAGE from $ONMS_IMAGE_ARCHIVE"
    p load -q -i "$ONMS_IMAGE_ARCHIVE"
  elif p pull -q "$ONMS_IMAGE" >/dev/null 2>&1; then
    say "Pulled $ONMS_IMAGE"
  else
    need_prod
    # The image may be here under another name: production's image ID tells.
    id=$(pp image inspect -f '{{.Id}}' "$ONMS_IMAGE" </dev/null 2>/dev/null) || id=''
    if [ -n "$id" ] && p image exists "$id" 2>/dev/null; then
      p tag "$id" "$ONMS_IMAGE"
      say "This machine has production's image under another name; it is now also $ONMS_IMAGE."
    else
      say "Copying $ONMS_IMAGE from $PROD_SSH (about 1.5 GB; production keeps running)."
      say "  It is not in this machine's podman storage, which holds $(p images -q | wc -l) images. The kit never deletes it."
      pp save "$ONMS_IMAGE" | p load -q
    fi
  fi
  p image exists "$ONMS_IMAGE" || die "$ONMS_IMAGE is still missing. Check the name with: ./dev.sh prod-info"
}

# --- production's overlay folders --------------------------------------------------------------------

# Production mounts host folders on /opt/opennms-overlay and /opt/opennms-jetty-webapps-overlay, and the image copies
# them into OpenNMS at every start (./dev.sh prod-info). The development OpenNMS mounts a copy of them, so it runs
# the same code and web files. It keeps its own configuration: nothing below etc/ is copied, nor the etc overlay.
# A change in production (or of the image) makes a new copy, and a new container.
prepare_overlays() {
  local mounted=() listing='' print folder name excl image_id
  image_id=$(p image inspect -f '{{.Id}}' "$ONMS_IMAGE" | cut -c 1-12)
  if [ "$DEV_PROD_OVERLAYS" = yes ]; then
    if ssh "${SSH_OPTS[@]}" "$PROD_SSH" true 2>/dev/null; then
      mapfile -t mounted < <(pp container inspect -f '{{range .Mounts}}{{if ne (len .Name) 64}}{{.Destination}}{{"\n"}}{{end}}{{end}}' \
        "$PROD_CONTAINER" </dev/null | grep -x -e /opt/opennms-overlay -e /opt/opennms-jetty-webapps-overlay || true)
      if [ ${#mounted[@]} -gt 0 ]; then # size, time and name of each file
        # shellcheck disable=SC2016 # runs in the container
        listing=$(pp exec "$PROD_CONTAINER" sh -c 'find "$@" -type f -exec stat -c "%s %Y %n" {} +' sh "${mounted[@]}" </dev/null | sort)
      fi
    elif [ -f "$OVL/.fingerprint" ]; then
      warn "Cannot reach $PROD_SSH: the development OpenNMS keeps its copy of production's overlay folders."
      return 0
    else
      warn "Cannot reach $PROD_SSH: the development OpenNMS starts without production's overlay folders."
    fi
  fi
  print=$(md5sum <<<"$image_id $DEV_PROD_OVERLAYS ${mounted[*]} $listing" | cut -c 1-12)
  [ "$(cat "$OVL/.fingerprint" 2>/dev/null)" != "$print" ] || return 0
  rm -rf "$OVL.new"
  mkdir -p "$OVL.new/opennms-overlay" "$OVL.new/opennms-jetty-webapps-overlay"
  if [ -n "$listing" ]; then
    say "Copying production's overlay folders, $(wc -l <<<"$listing") files (all but etc/: dev keeps its own configuration)."
    for folder in "${mounted[@]}"; do
      name=${folder##*/}
      excl=()
      [ "$name" != opennms-overlay ] || excl=(--anchored --exclude=etc --exclude=./etc) # only the top etc/
      pp cp "$PROD_CONTAINER:$folder/." - </dev/null | tar -xf - -C "$OVL.new/$name" --no-same-owner "${excl[@]}"
    done
  fi
  fix_login "$OVL.new"
  echo "$print" >"$OVL.new/.fingerprint"
  rm -rf "$OVL"
  mv "$OVL.new" "$OVL"
}

# OpenNMS 33.1.8 accepts a login only with the CSRF token of its login page (tools/csrf_fix.py). When the login page
# the development OpenNMS would show has no token field, dev's overlay copy gets a version with it. Production keeps its own.
fix_login() {
  local dir=$1 page pages=() fixed=() own
  mapfile -t pages < <(find "$dir" -type f -name login.jsp | sort) # in the overlays: they win over the image's own
  for page in "${pages[@]}"; do
    if python3 tools/csrf_fix.py "$page" "$page"; then fixed+=("${page#"$dir"/}"); fi
  done
  if [ ${#pages[@]} -eq 0 ]; then
    own="$dir/login.jsp.image"
    p run --rm --network none --user 0:0 --entrypoint cat "$ONMS_IMAGE" "$OPENNMS/jetty-webapps/opennms/login.jsp" >"$own" 2>/dev/null || true
    page="$dir/opennms-overlay/jetty-webapps/opennms/login.jsp"
    if [ -s "$own" ] && python3 tools/csrf_fix.py "$own" "$own.fixed"; then
      mkdir -p "${page%/*}" && mv "$own.fixed" "$page"
      fixed+=("the image's login.jsp")
    fi
    rm -f "$own" "$own.fixed"
  fi
  [ ${#fixed[@]} -gt 0 ] || return 0
  say "The login page has no CSRF token field ($(IFS=,; echo "${fixed[*]}")). OpenNMS 33.1.8 answers every login"
  say "without one with \"Access denied\", so the development OpenNMS gets a copy with the field. Production is not changed."
}

create_stack() {
  local env_args=() cap_args=() extra_args=() kv cap core_id
  get_image
  prepare_overlays
  p image exists "$PG_IMAGE" || { say "Downloading $PG_IMAGE"; p pull "$PG_IMAGE"; }
  p pod exists "$DEV_POD" ||
    p pod create --name "$DEV_POD" --label "$POD_LABEL=$POD_ID" -p "$DEV_PORT:8980" -p "$DEV_KARAF_PORT:8101" >/dev/null
  p container exists "$DB" || p create --pod "$DEV_POD" --name "$DB" \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -v "$DEV_POD-pgdata:/var/lib/postgresql/data" "$PG_IMAGE" >/dev/null
  for kv in $DEV_ENV; do env_args+=(-e "$kv"); done
  for cap in $DEV_CAP_ADD; do cap_args+=(--cap-add "$cap"); done
  read -r -a extra_args <<<"$DEV_PODMAN_ARGS"
  # OpenNMS keeps its configuration and data in volumes and in PostgreSQL: another image, heap, variables,
  # run options or overlay copy only re-create the container.
  core_id="$ONMS_IMAGE $heap $DEV_ENV | $DEV_CAP_ADD | $DEV_PODMAN_ARGS | overlays $(cat "$OVL/.fingerprint")"
  if p container exists "$DEV_CONTAINER" &&
    [ "$(p container inspect -f "{{index .Config.Labels \"$CORE_LABEL\"}}" "$DEV_CONTAINER")" != "$core_id" ]; then
    p rm -f -v -t 60 "$DEV_CONTAINER" >/dev/null
  fi
  if ! p container exists "$DEV_CONTAINER"; then
    say "Creating the OpenNMS container, started like production: ${DEV_PODMAN_ARGS:-no extra options} (DEV_PODMAN_ARGS in kit.env)."
    p create --pod "$DEV_POD" --name "$DEV_CONTAINER" --label "$CORE_LABEL=$core_id" \
      "${cap_args[@]}" "${extra_args[@]}" \
      -e POSTGRES_HOST=127.0.0.1 -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
      -e OPENNMS_DBNAME=opennms -e OPENNMS_DBUSER=opennms -e OPENNMS_DBPASS=opennms \
      -e JAVA_OPTS="-Xmx$heap -XX:MaxMetaspaceSize=512m" "${env_args[@]}" \
      -v "$DEV_POD-etc:$OPENNMS/etc" -v "$DEV_POD-data:/opennms-data" \
      -v "$PWD/$OVL/opennms-overlay:/opt/opennms-overlay:Z" \
      -v "$PWD/$OVL/opennms-jetty-webapps-overlay:/opt/opennms-jetty-webapps-overlay:Z" \
      "$ONMS_IMAGE" -s >/dev/null
  fi
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

# ready: every OpenNMS health check passes. web: the web UI answers (its login page), other services may still start.
opennms_state() {
  local probe
  probe=$(curl -sS --max-time 20 "$URL/rest/health/probe?t=10000" 2>/dev/null) || probe=''
  if [[ $probe != *'Everything is awesome'* ]]; then # an image may want a login for it
    probe=$(curl -sS --max-time 20 -u "$DEV_USER:$DEV_PASSWORD" "$URL/rest/health/probe?t=10000" 2>/dev/null) || probe=''
  fi
  if [[ $probe == *'Everything is awesome'* ]]; then
    echo ready
  elif curl -fsS --max-time 10 -o /dev/null "$URL/login.jsp" 2>/dev/null; then
    echo web
  else
    echo down
  fi
}

# What OpenNMS is doing, from the messages of the image's /entrypoint.sh.
phase() { # the step, and the last message of the start script (so a step that hangs shows)
  local log what last
  log=$(p logs --tail 5000 "$DEV_CONTAINER" 2>&1 || true)
  case $({ grep -E '^(Run config tester|Run OpenNMS install|System is already configured|\+ exec )' <<<"$log" || true; } | tail -n 1) in
    'Run OpenNMS install'*) what='creating the database (first start only)' ;;
    'System is already'* | '+ exec '*) what='starting OpenNMS' ;;
    'Run config tester'*) what='checking the configuration' ;;
    *) what='preparing the configuration' ;;
  esac
  last=$({ grep -v '^+' <<<"$log" || true; } | tail -n 1 | cut -c 1-56)
  echo "$what${last:+ ($last)}"
}

save_log() { mkdir -p .kit && { p logs "$DEV_CONTAINER" >"$START_LOG" 2>&1 || true; }; }

# The lines of the image's /entrypoint.sh around the last message in the log that the script itself prints.
script_around() {
  local script line n
  script=$(p cp "$DEV_CONTAINER:/entrypoint.sh" - 2>/dev/null | tar -xOf - 2>/dev/null) || return 0
  while IFS= read -r line; do
    [ "${#line}" -ge 12 ] || continue
    n=$({ grep -n -F -m 1 -- "$line" <<<"$script" || true; } | cut -d: -f1)
    [ -n "$n" ] || continue
    warn "The image's /entrypoint.sh around the message \"${line:0:70}\" (line $n):"
    sed -n "$((n > 10 ? n - 10 : 1)),$((n + 12))p" <<<"$script" | cut -c 1-160 | sed 's/^/  | /' >&2
    warn ""
    return 0
  done < <({ grep -v '^+' "$START_LOG" || true; } | tail -n 8 | tac)
}

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
    143) warn "OpenNMS was stopped from outside (podman stop, or the machine shut down). ./dev.sh up starts it again." ;;
    *)
      if grep -q 'java: Operation not permitted' "$START_LOG"; then
        warn "The kernel refused to start Java: its file in the OpenNMS image has the capabilities NET_RAW and"
        warn "NET_BIND_SERVICE, and a container that may not hold them cannot run it."
        warn "dev.sh starts it with: ${DEV_PODMAN_ARGS:-nothing extra} and adds ${DEV_CAP_ADD:-no capabilities} (kit.env)."
        warn "Production's capabilities and options: ./dev.sh prod-info. Put what it has and this container lacks into DEV_PODMAN_ARGS."
      else
        warn "The commands the image's start script ran last:"
        { grep '^+' "$START_LOG" || true; } | tail -n 12 | cut -c 1-200 | sed 's/^/  | /' >&2
        warn ""
        script_around
        if [ "$code" = 127 ]; then
          warn "Creating the database or checking the configuration failed (log above). ./dev.sh up tries again; ./dev.sh reset starts over."
        else
          warn "Compare with production (./dev.sh prod-info): it may start the container differently or set a variable."
          warn "Put what is missing into DEV_PODMAN_ARGS (run options) or DEV_ENV (variables) in kit.env, then ./dev.sh up."
        fi
      fi
      ;;
  esac
  warn "The whole log is in $START_LOG."
}

wait_opennms() { # wait_opennms [running]: OpenNMS ran already before this ./dev.sh up
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
      [ "${1:-}" != running ] || web_since=$((SECONDS - 180)) # it had its time
      if [ $((SECONDS - web_since)) -ge 180 ]; then # some checks may need production's other containers
        say "  $(clock "$start")  the web UI works; these health checks do not pass (yet):"
        python3 tools/webcheck.py health "$URL" "$DEV_USER" "$DEV_PASSWORD" || true
        say "  OpenNMS is usable without them. ./dev.sh status shows them again."
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

# Can a browser on another computer log in? webcheck.py takes the way such a browser takes, to this machine's address:
# login page, session cookie, CSRF token, login, next page.
login_check() {
  local base
  base="http://$(host_address):$DEV_PORT/opennms"
  python3 tools/webcheck.py login "$base" "$DEV_USER" "$DEV_PASSWORD" && return 0
  say "  Production's login page, to compare (PROD_URL in kit.env):"
  python3 tools/webcheck.py page "$PROD_URL" | sed 's/^/    /' || true
}

# --- commands --------------------------------------------------------------------------------------

up() {
  local was
  check_tools
  check_pod
  check_resources
  prepare_host
  create_stack
  p start "$DB" >/dev/null ||
    die "Podman could not start the pod (error above). If a port is in use: DEV_PORT=8981 DEV_KARAF_PORT=8102 ./dev.sh up"
  wait_db
  was=''
  ! running "$DEV_CONTAINER" || was=running
  p start "$DEV_CONTAINER" >/dev/null || die "Podman could not start OpenNMS (error above)."
  wait_opennms "$was"
  seed_once
  # A new container lacks what you deployed to the old one: opennms/ and styles/ go in again.
  if [ -d opennms ]; then ./topo.sh deploy dev -q || warn "./topo.sh deploy dev did not work (above)."; fi
  say ""
  login_check
  say "Development OpenNMS: http://$(host_address):$DEV_PORT/opennms/topology   (user $DEV_USER, password $DEV_PASSWORD)"
  [ -d opennms ] || say "Next: ./topo.sh pull   (copies the topology files of production here and into it)"
}

status() {
  local c state words
  if ! p pod exists "$DEV_POD" 2>/dev/null; then
    say "There is no development OpenNMS yet: ./dev.sh up"
    return 0
  fi
  for c in "$DB" "$DEV_CONTAINER"; do
    printf '  %-14s %s\n' "$c" "$(p ps -a --filter "name=^$c\$" --format '{{.Status}}')"
  done
  state=$(opennms_state)
  case $state in
    ready) words='ready' ;;
    web) words='web UI up; not every health check passes' ;;
    *) words="not answering on $URL" ;;
  esac
  printf '  %-14s %s\n' OpenNMS "$words" Memory "$(mem_mb MemAvailable) MB free of $(mem_mb MemTotal) MB" \
    Topology "http://$(host_address):$DEV_PORT/opennms/topology   (user $DEV_USER, password $DEV_PASSWORD)"
  [ "$state" != down ] || return 0
  say "  Health checks:"
  python3 tools/webcheck.py health "$URL" "$DEV_USER" "$DEV_PASSWORD" | sed 's/^/  /' || true
  login_check | sed 's/^/  /'
}

prod_info() {
  local overlay line folder files n
  need_prod
  # shellcheck disable=SC2016 # a Go template, not shell
  pp inspect "$PROD_CONTAINER" --format 'Image:    {{.ImageName}}
Command:  {{.Config.Entrypoint}} {{.Config.Cmd}}
User:     {{.Config.User}}
Ports:    {{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{.HostIP}}:{{.HostPort}}{{end}}->{{$p}} {{end}}
Run options: privileged {{.HostConfig.Privileged}}, capabilities added {{.HostConfig.CapAdd}}, dropped {{.HostConfig.CapDrop}}, security options {{.HostConfig.SecurityOpt}}
{{if not .HostConfig.Privileged}}Capabilities: {{.BoundingCaps}}
{{end}}The same for the development container (DEV_PODMAN_ARGS in kit.env):
  {{if .Config.User}}--user {{.Config.User}} {{end}}{{if .HostConfig.Privileged}}--privileged {{end}}{{range .HostConfig.CapAdd}}--cap-add {{.}} {{end}}{{range .HostConfig.CapDrop}}--cap-drop {{.}} {{end}}{{range .HostConfig.SecurityOpt}}--security-opt {{.}} {{end}}
Volumes:
{{range .Mounts}}  {{.Source}} -> {{.Destination}}
{{end}}Variables (names only):
{{range .Config.Env}}  {{.}}
{{end}}' | sed -E 's/^(  [A-Za-z0-9_]+)=.*/\1/'
  # The image copies these folders into OpenNMS at every start: a file put there survives a new container.
  overlay=$(pp exec "$PROD_CONTAINER" grep -E '^[A-Za-z_]*OVERLAY[A-Za-z_]*=' /entrypoint.sh </dev/null 2>/dev/null) || overlay=''
  if [ -n "$overlay" ]; then
    echo "Overlay folders in the image's /entrypoint.sh:"
    while IFS= read -r line; do echo "  $line"; done <<<"$overlay"
  fi
  # What they hold. ./dev.sh up copies all but etc/ into the development OpenNMS.
  for folder in /opt/opennms-overlay /opt/opennms-etc-overlay /opt/opennms-jetty-webapps-overlay; do
    # shellcheck disable=SC2016 # runs in the container
    files=$(pp exec "$PROD_CONTAINER" sh -c 'cd "$1" 2>/dev/null && find . -type f | sed "s|^\./||" | sort' sh "$folder" </dev/null) || files=''
    n=$(grep -c . <<<"$files" || true)
    echo "Files in $folder: $n"
    [ "$n" -eq 0 ] || head -n 30 <<<"$files" | sed 's/^/  /'
    [ "$n" -le 30 ] || echo "  ... and $((n - 30)) more"
  done
  # The web server: ports, https and base URL settings, the session cookie, the login page.
  echo "Web settings (etc/opennms.properties*, jetty-webapps/opennms/WEB-INF/web.xml):"
  pp exec "$PROD_CONTAINER" sh -c 'grep -rhs -e "^org.opennms.netmgt.jetty" -e "^opennms.web.base-url" /opt/opennms/etc/opennms.properties /opt/opennms/etc/opennms.properties.d/; grep -A4 "<cookie-config>" /opt/opennms/jetty-webapps/opennms/WEB-INF/web.xml' </dev/null 2>/dev/null |
    sed -E 's/^/  /; s/((password|secret)[^=]*=).*/\1(hidden)/I' || true
  echo "Login page: $(python3 tools/webcheck.py page "$PROD_URL" || true)"
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
    sed -n '2,12p' "$0"
    exit 2
    ;;
esac
