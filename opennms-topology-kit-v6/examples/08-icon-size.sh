#!/usr/bin/env bash
# Example: bigger node icons
# File: styles/topology.css, deployed as jetty-webapps/opennms/svg/zz-topology-styles.svg  (FILES.md, sections 6-7)
# Look: icons are 72 px instead of 48 px, with their status frame, and the labels moved below them.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# OpenNMS scales every icon to 48 px in its JavaScript (GWTVertex.java). The CSS property "scale"
# multiplies that around the node's centre, without touching OpenNMS. 1.5 x 48 px = 72 px.
css_block 'icon size' 'svg .vertex .icon-container, svg .vertex > rect.status, svg .vertex > rect.svgIconOverlay { scale: 1.5; }
svg .vertex > text.vertex-label { translate: 0 12px; }
svg .vertex > .status-badge-container, svg .vertex > .node-status-counter { translate: 12px -12px; }'
