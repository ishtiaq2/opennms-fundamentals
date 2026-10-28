#!/usr/bin/env bash
# Development OpenNMS in a Podman pod: Horizon 33.1.8 + PostgreSQL, as in the official compose example.
#   ./dev.sh up              start; the first run pulls, initialises (~5 min), seeds a demo DAS, deploys the kit
#   ./dev.sh down            stop (keeps data)
#   ./dev.sh reset           delete the containers and their volumes
#   ./dev.sh logs [file]     follow an OpenNMS log (default karaf.log; web.log, manager.log, ...)
#   ./dev.sh pull <path>     copy a stock OpenNMS file into overlay/ to edit it, e.g.
#                            ./dev.sh pull jetty-webapps/opennms/svg/opennms_icons.svg
set -euo pipefail
cd "$(dirname "$0")"
source ./kit.env

read -ra pm <<<"$PODMAN"
p() { "${pm[@]}" "$@"; }
URL="http://localhost:$DEV_PORT/opennms"
DB="$DEV_POD-db"

opennms_ready() { curl -fsS --max-time 5 "$URL/rest/health/probe" 2>/dev/null | grep -q 'Everything is awesome'; }
db_ready() { p exec "$DB" pg_isready -q -U postgres; }

wait_for() { # <name> <check>
  printf 'Waiting for %s ' "$1"
  for _ in $(seq 1 180); do
    if "$2"; then echo ok; return 0; fi
    if [ "$(p container inspect -f '{{.State.Running}}' "$DEV_CONTAINER" 2>/dev/null)" = false ] &&
      [ "$1" = OpenNMS ]; then
      echo; p logs --tail 30 "$DEV_CONTAINER"; echo "OpenNMS stopped (logs above)." >&2; return 1
    fi
    printf .; sleep 5
  done
  echo; echo "$1 did not become ready." >&2
  [ "$1" != OpenNMS ] || curl -sS -u "$DEV_USER:$DEV_PASSWORD" "$URL/rest/health" >&2 || true
  return 1
}

up() {
  p pod exists "$DEV_POD" || p pod create --name "$DEV_POD" -p "$DEV_PORT:8980" -p "$DEV_KARAF_PORT:8101" >/dev/null
  p container exists "$DB" || p create --pod "$DEV_POD" --name "$DB" \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -v "$DEV_POD-pgdata:/var/lib/postgresql/data" "$PG_IMAGE" >/dev/null
  p container exists "$DEV_CONTAINER" || p create --pod "$DEV_POD" --name "$DEV_CONTAINER" \
    -e POSTGRES_HOST=localhost -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e OPENNMS_DBNAME=opennms -e OPENNMS_DBUSER=opennms -e OPENNMS_DBPASS=opennms \
    -v "$DEV_POD-etc:/opt/opennms/etc" -v "$DEV_POD-data:/opennms-data" "$ONMS_IMAGE" -s >/dev/null
  p start "$DB" >/dev/null
  wait_for PostgreSQL db_ready
  p start "$DEV_CONTAINER" >/dev/null
  wait_for OpenNMS opennms_ready
  if [ ! -f .dev/seeded ]; then
    if node tools/onms.mjs seed --url "$URL" --user "$DEV_USER" --password "$DEV_PASSWORD"; then
      mkdir -p .dev && touch .dev/seeded
    else
      echo "The demo seed did not complete (see above); ./dev.sh up tries it again." >&2
    fi
  fi
  bash ./deploy.sh dev
  echo
  echo "OpenNMS:  $URL/topology  ($DEV_USER / $DEV_PASSWORD), View > \"DAS demo (GraphML)\" or \"UserDefined\""
  echo "Live:     npm run dev    (preview on http://localhost:8099, every save is deployed here)"
}

case ${1:-} in
  up) up ;;
  down) p pod stop -t 120 "$DEV_POD" >/dev/null && echo stopped ;; # OpenNMS needs time to shut down cleanly
  reset)
    p rm -f -v "$DEV_CONTAINER" "$DB" >/dev/null 2>&1 || true
    p pod rm -f "$DEV_POD" >/dev/null 2>&1 || true
    p volume rm -f "$DEV_POD-pgdata" "$DEV_POD-etc" "$DEV_POD-data" >/dev/null 2>&1 || true
    rm -rf .dev src/icon-mapping.dev.cfg && echo "removed $DEV_POD and its volumes" ;;
  logs) p exec "$DEV_CONTAINER" tail -n 200 -F "/usr/share/opennms/logs/${2:-karaf.log}" ;;
  pull)
    [ -n "${2:-}" ] || { echo "usage: ./dev.sh pull <path below /usr/share/opennms>" >&2; exit 2; }
    mkdir -p "overlay/$(dirname "$2")"
    p cp "$DEV_CONTAINER:/usr/share/opennms/$2" "overlay/$2" && echo "overlay/$2 (edit it; npm run dev deploys it on save)" ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
