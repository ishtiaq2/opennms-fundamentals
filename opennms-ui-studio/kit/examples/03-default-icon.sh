#!/usr/bin/env bash
# Example: every node without a mapping gets another icon
# File: opennms/etc/org.opennms.features.topology.app.icons.default.cfg  (FILES.md, section 2)
# Look: in every view, the nodes that had the grey "generic" icon show the icon named above.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
set_prop etc/org.opennms.features.topology.app.icons.default.cfg default "$(pick_icon nimbus wifiAccess)"
