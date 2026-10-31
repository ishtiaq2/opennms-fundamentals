#!/usr/bin/env bash
# Example: your own entry in the View menu (a GraphML view)
# Files: opennms/etc/graphml/das-mine.xml and its two .cfg files  (FILES.md, section 5)
# Look: View > "My DAS (GraphML)": a head-end room above orion-1, helix-1 and nimbus-1/2, with their alarm. Edit opennms/etc/graphml/das-mine.xml, ./topo.sh deploy dev, reload.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# The view is a file plus two .cfg files that tell OpenNMS where it is; ./topo.sh view add makes all three.
./topo.sh view add examples/assets/das-mine.graphml das-mine
