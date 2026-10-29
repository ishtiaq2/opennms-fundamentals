#!/usr/bin/env bash
# Example: a new icon file, for the Stratus nodes
# File: opennms/jetty-webapps/opennms/svg/stratus.svg, plus a mapping and the Change Icon list  (FILES.md, sections 1-3)
# Look: press Ctrl+Shift+R: stratus-1 and stratus-2 show the new icon in the Enhanced Linkd views.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# examples/assets/stratus.svg is a placeholder with the structure OpenNMS needs: a group <id>_icon
# with the groups <id>_active (selected), <id>_rollover (mouse over) and <id> (normal). Any artwork
# works inside them; OpenNMS scales the icon so its longest side is 48 px.
if [ -n "$(icon_ids | grep -x stratus || true)" ]; then
  echo "  The svg folder has a stratus icon already: only the mapping is added."
else
  cp examples/assets/stratus.svg "$SVG/stratus.svg"
  echo "  opennms/jetty-webapps/opennms/svg/stratus.svg: new"
fi
set_prop etc/org.opennms.features.topology.app.icons.linkd.cfg linkd.system.snmp.1.3.6.1.4.1.99999.1.3 stratus
add_line etc/org.opennms.features.topology.app.icons.list stratus
