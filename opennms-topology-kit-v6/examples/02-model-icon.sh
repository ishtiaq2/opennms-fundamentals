#!/usr/bin/env bash
# Example: every node of one model (SNMP sysObjectID) gets an icon
# File: opennms/etc/org.opennms.features.topology.app.icons.linkd.cfg  (FILES.md, section 2)
# Look: Enhanced Linkd views: helix-1 shows the icon named above, and so would every future node of that model.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# Enhanced Linkd gives a node the icon key linkd.system.snmp.<sysObjectID>. OpenNMS tries the whole
# key, then shorter ones: linkd.system.snmp.1.3.6.1.4.1.99999.1 = ... would cover all four demo models.
# The demo nodes use enterprise 99999; in production use your devices' sysObjectID (the "Icon Key"
# in the topology Info panel, or ./topo.sh icons prod).
set_prop etc/org.opennms.features.topology.app.icons.linkd.cfg linkd.system.snmp.1.3.6.1.4.1.99999.1.2 "$(pick_icon helix switch)"
