#!/usr/bin/env bash
# Example: one node gets another icon (a mapping for that node only)
# File: opennms/etc/org.opennms.features.topology.app.icons.linkd.cfg  (FILES.md, section 2)
# Look: Enhanced Linkd views: node orion-1 shows the icon named above. Reload the topology page.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# The key is "<namespace>.<vertex id>", as the topology Info panel shows it under "ID" (namespace:id).
# Enhanced Linkd vertices: namespace "nodes" ("nodes:UserDefined" for that layer; a colon needs a
# backslash in this file), vertex id = node id. Right-click > Change Icon writes the same lines.
id=$(node_id orion-1)
icon=$(pick_icon helix switch)
set_prop etc/org.opennms.features.topology.app.icons.linkd.cfg "nodes.$id" "$icon"
set_prop etc/org.opennms.features.topology.app.icons.linkd.cfg "nodes\\:UserDefined.$id" "$icon"
