#!/usr/bin/env bash
# Example: one icon styled with CSS: its main colour, frame, background, size and edges; its svg file stays as it is
# File: styles/topology.css, deployed as jetty-webapps/opennms/svg/zz-topology-styles.svg  (FILES.md, section 6; GUIDE-Maven-abc-styles.md, step 7)
# Look: open the topology page in a new tab once, then reload with the cache off (F12 > Network > Disable cache): every node drawn with the icon is 25 % bigger, dark blue (red with a critical alarm, orange under the mouse and when selected), in a thin rounded frame on white, with a bold label.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# Another icon: ICON=das_helix ./topo.sh example 12. ./topo.sh css <icon id> prints every part of an icon.
#
# A node is <g class="vertex"> with <rect class="status <severity>"> (frame and background), <g class="icon-container">
# holding <use class="upIcon" href="#<icon id>"> (and #<icon id>_rollover, #<icon id>_active) and <text class="vertex-label">.
# The <use> draws a copy of the drawing <g id="<icon id>"> of the svg file, so a rule "#<icon id> .<class>" recolours that
# part in every copy, and wins over the file's own ".<class>" rule. "svg .vertex:has(use.upIcon[*|href="#<icon id>"])"
# is every node drawn with the icon: the "svg.nimbus" of the page.
icon=${ICON:-$(pick_icon das_nimbus "$(pick_icon nimbus server)")}
mapfile -t main < <(python3 tools/svgcss.py main "$SVG" "$icon") # the selector of the main colour of each drawing
node="svg .vertex:has(use.upIcon[*|href=\"#$icon\"])"
rules="/* $icon: the colour of most of its parts. var(--alarm, ...) takes the colour that the node's alarm sets below. */"
[ -z "${main[0]:-}" ] || rules+=$'\n'"${main[0]} { fill: var(--alarm, #1F3A5F); }"
[ -z "${main[1]:-}" ] || rules+=$'\n'"${main[1]} { fill: #F28C28; }"
[ -z "${main[2]:-}" ] || rules+=$'\n'"${main[2]} { fill: #F28C28; }"
rules+="
svg .vertex:has(> rect.status.major) { --alarm: #FF3300; }
svg .vertex:has(> rect.status.critical) { --alarm: #CC0000; }
/* Its frame (\"border: 2px solid\"; stroke keeps the alarm colour), round corners, a white background */
$node > rect.status { stroke-width: 2px; rx: 4px; fill: #FFFFFF; }
/* 25 % bigger, with its frame and mouse target; the label moves down and is bold */
$node > :is(.icon-container, rect.status, rect.svgIconOverlay) { scale: 1.25; }
$node > text.vertex-label { translate: 0 6px; font-weight: bold; fill: #1F3A5F; }
/* \"Sharpness\": hard edges, a little more contrast */
$node > .icon-container { shape-rendering: crispEdges; filter: contrast(1.2); }"
css_block "one icon: $icon" "$rules"
echo "  the icon: $icon. Its file and parts: ./topo.sh css $icon"
