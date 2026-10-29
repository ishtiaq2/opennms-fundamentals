#!/usr/bin/env bash
# styles/topology.css -> the svg file that OpenNMS puts into the topology page
# (jetty-webapps/opennms/svg/zz-topology-styles.svg), made the way ./topo.sh makes it, without the kit:
#   ./make-style-svg.sh styles/topology.css > zz-topology-styles.svg
# A line /* mark */ in the CSS adds a version label to the page only when ./topo.sh makes the file: take that line out
# before you commit the CSS.
set -eu
css=${1:-styles/topology.css}
[ -f "$css" ] || { echo "usage: $0 [styles/topology.css] > zz-topology-styles.svg" >&2; exit 1; }
printf '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"><!-- Made by topo.sh from styles/topology.css. -->\n<style><![CDATA[\n'
sed 's/]]>/]]]]><![CDATA[>/g' "$css"
printf ']]></style></svg>\n'
