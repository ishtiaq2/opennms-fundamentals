#!/usr/bin/env bash
# Hot-deploys the kit into a running OpenNMS container: nothing restarts, reload the topology page.
#   ./deploy.sh dev           the development container (./dev.sh)
#   ./deploy.sh prod          PROD_CONTAINER (on PROD_CONNECTION), after a confirmation
# Options: -y           no confirmation
#          --remove     take the kit's icons, styles and mappings out again
#          --no-build   deploy dist/ as it is
#          --if-running do nothing when the container is not running
set -euo pipefail
cd "$(dirname "$0")"
source ./kit.env

target='' build=1 if_running=0 yes=0 remove=0
for arg in "$@"; do
  case $arg in
    dev | prod) target=$arg ;;
    -y | --yes) yes=1 ;;
    --remove) remove=1 build=0 ;;
    --no-build) build=0 ;;
    --if-running) if_running=1 ;;
    *) target='' && break ;;
  esac
done
[ -n "$target" ] || { echo "usage: ./deploy.sh dev|prod [-y] [--remove] [--no-build] [--if-running]" >&2; exit 2; }

read -ra pm <<<"$PODMAN"
if [ "$target" = prod ]; then
  container=$PROD_CONTAINER
  where="'$container'${PROD_CONNECTION:+ on $PROD_CONNECTION}"
  [ -z "$PROD_CONNECTION" ] || pm+=(--connection "$PROD_CONNECTION")
else
  container=$DEV_CONTAINER
  where="'$container'"
fi
p() { "${pm[@]}" "$@"; }

if [ "$(p container inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" != true ]; then
  [ "$if_running" = 1 ] && exit 0
  echo "Container $where is not running." >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if [ "$remove" = 1 ]; then
  SVG_FILE='' ICON_PREFIX=das_ ICON_IDS=''
  echo "# nothing" >"$tmp/kit.cfg"
  action="Remove the kit's icons, styles and mappings from"
else
  if [ "$build" = 1 ]; then
    if command -v node >/dev/null; then node tools/build.mjs --target "$target"; else echo "node not found: deploying dist/ as it is" >&2; fi
  fi
  [ -f dist/manifest.env ] || { echo "dist/ is empty: run npm run build first" >&2; exit 1; }
  source dist/manifest.env
  [ "$TARGET" = "$target" ] || { echo "dist/ was built for $TARGET: run node tools/build.mjs --target $target" >&2; exit 1; }
  cp dist/icon-mapping.cfg "$tmp/kit.cfg"
  action="Deploy $SVG_FILE and the icon mappings to"
fi
if [ "$target" = prod ] && [ "$yes" = 0 ]; then
  read -rp "$action $where? [y/N] " answer
  [ "$answer" = y ] || [ "$answer" = Y ] || exit 1
fi

OPENNMS=/usr/share/opennms # /opt/opennms in the image is a link to it
SVG_DIRS=("$OPENNMS/jetty-webapps/opennms/svg")
CFG=$OPENNMS/etc/org.opennms.features.topology.app.icons.default.cfg
LIST=$OPENNMS/etc/org.opennms.features.topology.app.icons.list
# The svg folder belongs to the container, not to a volume. When /opt/opennms-overlay is mounted, the
# image copies it into OpenNMS at every start, so a copy there survives re-creating the container.
if p container inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' "$container" | grep -qx /opt/opennms-overlay; then
  SVG_DIRS+=(/opt/opennms-overlay/jetty-webapps/opennms/svg)
elif [ "$target" = prod ] && [ "$remove" = 0 ]; then
  echo "  note: /opt/opennms-overlay is not mounted; after re-creating the container run ./deploy.sh prod again"
fi

# 1. Files from overlay/ (same layout as /usr/share/opennms), e.g. edited copies of stock files. The
#    archive holds only files, so the folders in the container keep their owner and permissions.
if [ "$remove" = 0 ] && [ -n "$(find overlay -type f ! -name '.gitkeep' -print -quit 2>/dev/null)" ]; then
  (cd overlay && find . -type f ! -name .gitkeep -print0 | tar --null -T - -cf -) | p cp - "$container:$OPENNMS"
  echo "  overlay/ -> $OPENNMS"
fi

# 2. Icons and styles: OpenNMS loads every .svg in the folder into the topology page. The name
#    carries a content hash, so no browser can show a cached old version.
for dir in "${SVG_DIRS[@]}"; do
  p exec "$container" mkdir -p "$dir"
  [ -z "$SVG_FILE" ] || p cp "dist/svg/$SVG_FILE" "$container:$dir/$SVG_FILE"
  # shellcheck disable=SC2016 # $1 and $2 are expanded by the shell in the container
  p exec "$container" sh -c 'cd "$1" && for f in das-topology.*.svg; do [ "$f" = "$2" ] || rm -f -- "$f"; done' sh "$dir" "$SVG_FILE"
  if [ -n "$SVG_FILE" ]; then echo "  $SVG_FILE -> $dir"; else echo "  das-topology.*.svg removed from $dir"; fi
done

# 3. Icon mappings. The kit owns every mapping to a ${ICON_PREFIX}* icon, other lines stay. Karaf
#    re-reads the file within a second.
p cp "$container:$CFG" "$tmp/current.cfg" 2>/dev/null || : >"$tmp/current.cfg"
awk -v prefix="$ICON_PREFIX" -f tools/merge-cfg.awk "$tmp/kit.cfg" "$tmp/current.cfg" >"$tmp/new.cfg"
cmp -s "$tmp/current.cfg" "$tmp/new.cfg" || p cp "$tmp/new.cfg" "$container:$CFG"
echo "  $(grep -c " = $ICON_PREFIX" "$tmp/new.cfg" || true) icon mapping(s) -> $CFG"

# 4. Icons offered by right-click > Change Icon.
p cp "$container:$LIST" "$tmp/icons.list" 2>/dev/null || : >"$tmp/icons.list"
grep -v "^$ICON_PREFIX" "$tmp/icons.list" >"$tmp/icons.list.new" || true
for id in $ICON_IDS; do echo "$id" >>"$tmp/icons.list.new"; done
cmp -s "$tmp/icons.list" "$tmp/icons.list.new" || p cp "$tmp/icons.list.new" "$container:$LIST"

if [ "$remove" = 1 ]; then
  echo "Removed from $where. Reload /opennms/topology."
elif p exec "$container" curl -fsS -o /dev/null "http://localhost:8980/opennms/svg/$SVG_FILE" 2>/dev/null; then
  echo "Deployed to $where. Reload /opennms/topology."
else
  echo "Copied to $where, but OpenNMS does not serve /opennms/svg/$SVG_FILE yet (still starting?)." >&2
fi
