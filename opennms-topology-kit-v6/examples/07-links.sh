#!/usr/bin/env bash
# Example: link colours and width
# File: styles/topology.css, deployed inside jetty-webapps/opennms/svg/zz-topology-styles.<hash>.svg  (FILES.md, section 6)
# Look: links are 5 px wide: green when up, red and dashed when down, blue when selected, orange under the mouse.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# A link is <path class="edge [selected] [up|down|<severity>]">. Enhanced Linkd links also get an
# inline style="stroke-width: 3px", so the width needs !important.
css_block links 'svg path.edge { stroke-width: 5px !important; }
svg path.edge.up, svg path.edge.normal { stroke: #2E7D32; }
svg path.edge.down, svg path.edge.critical, svg path.edge.major { stroke: #C62828; stroke-dasharray: 10 5; }
svg path.edge.selected { stroke: #1565C0; }
svg path.edge:hover { stroke: #F28C28; }'
