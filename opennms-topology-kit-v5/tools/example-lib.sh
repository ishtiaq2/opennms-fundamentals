# Helpers for examples/NN-*.sh. An example only changes files in opennms/ or styles/;
# ./topo.sh example N then deploys them to the development OpenNMS.
# shellcheck shell=bash
set -euo pipefail
cd "$(dirname "$0")/.."
source ./kit.env
WS=opennms
SVG=$WS/jetty-webapps/opennms/svg
STOCK_SVG='opennms_icons.svg atlas_icons.svg vmware_icons.svg legacy_icons.svg'

# set_prop <file below opennms/> <key, as written in the file> <value>: change that key's line, or add it.
set_prop() {
  local file="$WS/$1" tmp
  [ -f "$file" ] || echo "# Made by examples/" >"$file"
  tmp=$(mktemp)
  # The key and value come in through ENVIRON: awk -v would turn "\:" into ":".
  K=$2 V=$3 awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    { line = $0; sub(/^[ \t]+/, "", line) }
    !done && index(line, k) == 1 && substr(line, length(k) + 1) ~ /^([ \t]*[=:]|[ \t]+[^ \t]|[ \t]*$)/ { print k " = " v; done = 1; next }
    { print }
    END { if (!done) print k " = " v }' "$file" >"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
  echo "  opennms/$1: $2 = $3"
}

# add_line <file below opennms/> <line>: add a line unless the file has it.
add_line() {
  grep -qx -- "$2" "$WS/$1" 2>/dev/null || { echo "$2" >>"$WS/$1" && echo "  opennms/$1: + $2"; }
}

# css_block <name> <rules>: put rules into styles/topology.css, replacing an earlier block of that name.
css_block() {
  local file=styles/topology.css tmp
  tmp=$(mktemp)
  N=$1 awk 'BEGIN { n = ENVIRON["N"] } $0 == "/* example: " n " */" { skip = 1; next } skip && $0 == "/* end: " n " */" { skip = 0; next } !skip' "$file" >"$tmp"
  { cat "$tmp"; printf '/* example: %s */\n%s\n/* end: %s */\n' "$1" "$2" "$1"; } >"$file"
  rm -f "$tmp"
  echo "  styles/topology.css: rules \"$1\""
}

# The icon ids the svg files define (<g id="<id>_icon">), and the ones from files that are not stock.
icon_ids() { cat "$SVG"/*.svg 2>/dev/null | grep -o 'id="[^"]*_icon"' | sed 's/^id="//; s/_icon"$//' | sort -u; }
own_icon_ids() {
  local f
  for f in "$SVG"/*.svg; do
    case " $STOCK_SVG " in *" ${f##*/} "*) continue ;; esac
    case ${f##*/} in zz-*) continue ;; esac
    grep -o 'id="[^"]*_icon"' "$f" | sed 's/^id="//; s/_icon"$//'
  done | sort -u
}

# pick_icon <name> <stock id>: your icon called like <name> (helix, orion, ...), else the stock icon.
pick_icon() {
  local id
  id=$(icon_ids | grep -ix -- "$1" | head -n 1 || true)
  [ -n "$id" ] || id=$(icon_ids | grep -i -- "$1" | head -n 1 || true)
  echo "${id:-$2}"
}

# node_id <foreign id>: the node id of a demo node (requisition DAS-Demo) in the development OpenNMS.
node_id() {
  curl -fsS -u "$DEV_USER:$DEV_PASSWORD" -H 'Accept: application/json' "http://localhost:$DEV_PORT/opennms/rest/nodes/DAS-Demo:$1" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])'
}
