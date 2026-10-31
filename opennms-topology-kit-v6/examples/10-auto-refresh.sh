#!/usr/bin/env bash
# Example: the topology page refreshes itself
# File: opennms/etc/org.opennms.features.topology.app.cfg  (FILES.md, section 4)
# Look: the topology app restarts itself in about 10 seconds; reload the page, and from then on it refreshes every 30 seconds.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
set_prop etc/org.opennms.features.topology.app.cfg autoRefresh.enabled true
set_prop etc/org.opennms.features.topology.app.cfg autoRefresh.interval 30
