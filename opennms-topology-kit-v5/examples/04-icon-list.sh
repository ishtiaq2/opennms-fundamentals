#!/usr/bin/env bash
# Example: your icons in the right-click "Change Icon" dialog
# File: opennms/etc/org.opennms.features.topology.app.icons.list  (FILES.md, section 3)
# Look: right-click a node > Change Icon: your icons are at the end of the list. Picking one writes "<namespace>.<id> = <icon>" into a mapping file.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
ids=$(own_icon_ids)
[ -n "$ids" ] || { echo "  The svg folder has no icon files besides the stock ones; example 06 adds one."; exit 0; }
grep -qx '# Maven DAS icons' "$WS/etc/org.opennms.features.topology.app.icons.list" || printf '\n# Maven DAS icons\n' >>"$WS/etc/org.opennms.features.topology.app.icons.list"
for id in $ids; do add_line etc/org.opennms.features.topology.app.icons.list "$id"; done
