#!/usr/bin/env bash
# Example: the alarm frame and the labels
# File: styles/topology.css, deployed as jetty-webapps/opennms/svg/zz-topology-styles.svg  (FILES.md, section 6)
# Look: the frame around an icon has your severity colours (nimbus-2 has a nodeDown alarm: red); labels are bigger, bold and dark blue.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# Behind each icon is <rect class="status <severity>">: the stock stylesheet paints it in the severity
# colour, and the icon covers all but the frame.
css_block 'status frame and labels' 'svg .vertex > rect.status.normal { stroke: #2E7D32; fill: #2E7D32; }
svg .vertex > rect.status.major, svg .vertex > rect.status.critical { stroke: #C62828; fill: #C62828; }
svg .vertex > text.vertex-label { font-size: 12px; font-weight: bold; fill: #1F3A5F; }'
