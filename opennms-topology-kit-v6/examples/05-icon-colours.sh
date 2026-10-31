#!/usr/bin/env bash
# Example: other colours for the stock icons
# File: opennms/jetty-webapps/opennms/svg/opennms_icons.svg, its <style> block  (FILES.md, section 1)
# Look: press Ctrl+Shift+R on the topology page: router, switch, server, ... are dark blue, and orange when selected or under the mouse.
# shellcheck source=tools/example-lib.sh
source "$(dirname "$0")/../tools/example-lib.sh"
# opennms_icons.svg colours its shapes with classes .st0 ... .st16 at the top of the file: #505154 is
# the grey of the normal icon, #09A8D3 the blue of the selected (<id>_active) and mouse-over
# (<id>_rollover) icon. Your own icon files carry their colours the same way, or in fill="..." attributes.
f=$SVG/opennms_icons.svg
n=$(grep -ci -e '#505154' -e '#09A8D3' "$f" || true)
sed -i -e 's/#505154/#1F3A5F/gI' -e 's/#09A8D3/#F28C28/gI' "$f"
echo "  opennms/jetty-webapps/opennms/svg/opennms_icons.svg: $n lines recoloured (#505154 -> #1F3A5F, #09A8D3 -> #F28C28)"
