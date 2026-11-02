#!/usr/bin/env bash
# Example: the background behind the icons: one colour for all icons, another for each icon
# File: styles/topology.css, deployed as jetty-webapps/opennms/svg/zz-topology-styles.svg  (GUIDE-icon-backgrounds.md)
# Look: the green behind the icons is gone. Icons without a colour of their own sit on light grey; each icon that the nodes of your views use has a light colour of its own and a frame in a darker tone of it. A node with an alarm keeps the alarm colours.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# The green is <rect class="status normal"> behind the icon: the stock stylesheet paints its fill and its frame (stroke)
# #336600 when the node has no alarm. "svg .vertex > rect.status.normal" beats that rule; with
# "svg .vertex:has(use.upIcon[*|href="#<icon id>"])" in front it is the background of the nodes drawn with that icon only.
# Other icons: ICONS="das_helix orion" ./topo.sh example 13. Another colour: change the lines in styles/topology.css.
if [ -n "${ICONS:-}" ]; then read -ra icons <<<"$ICONS"; else mapfile -t icons < <(python3 tools/graphml.py used "$WS/etc" "$SVG"); fi
[ ${#icons[@]} -gt 0 ] || mapfile -t icons < <(own_icon_ids | head -n 6)
# fill (the background), stroke (the frame), name; the next icon takes the next colour, from the first again after the last
palette=('#DCEBFA #2E6AC7 blue' '#FFF1D6 #E08A00 amber' '#EADFF7 #7B3FC4 purple' '#FBDDE6 #C2185B rose'
  '#D8F1F5 #00838F cyan' '#F2E6D8 #8D6E4B sand' '#DDE0F7 #3949AB indigo' '#FDE2D4 #D9480F peach')
rules="/* All icons: the green (normal) background becomes light grey with a thin frame. An alarm keeps its colour. */
svg .vertex > rect.status.normal { fill: #F1F3F5; stroke: #8A97A8; stroke-width: 3px; }
/* One icon: every node drawn with it. Your colour for it: change fill (background) and stroke (frame). */"
i=0
for icon in "${icons[@]}"; do
  read -r fill stroke name <<<"${palette[$((i % ${#palette[@]}))]}"
  rules+=$'\n'"svg .vertex:has(use.upIcon[*|href=\"#$icon\"]) > rect.status.normal { fill: $fill; stroke: $stroke; } /* $icon: $name */"
  i=$((i + 1))
done
css_block 'icon backgrounds' "$rules"
echo "  the icons: ${icons[*]}"
echo "  (an alarm: the frame keeps the colour of its severity; ./topo.sh pagecheck prints the background each icon has on the page)"
