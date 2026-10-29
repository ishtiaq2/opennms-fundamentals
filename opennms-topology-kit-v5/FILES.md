# The OpenNMS files that draw and style /opennms/topology (Horizon 33.1.8)

Paths are below `/opt/opennms` in the container (a link to `/usr/share/opennms`). After `./topo.sh pull`,
the folder `opennms/` of this kit has the same paths with the files of production. Each section names the
example (`./topo.sh example N`) that changes that file, so you can watch what happens.

| # | File | What it decides | A change shows | Examples |
|---|---|---|---|---|
| 1 | `jetty-webapps/opennms/svg/*.svg` | the icons: artwork, colours, normal / mouse-over / selected | on page reload (Ctrl+Shift+R for a file you replaced) | 05, 06 |
| 2 | `etc/org.opennms.features.topology.app.icons.*.cfg` | which node gets which icon | within a second | 01, 02, 03 |
| 3 | `etc/org.opennms.features.topology.app.icons.list` | the icons in right-click > Change Icon | when the dialog opens | 04 |
| 4 | `etc/org.opennms.features.topology.app.cfg` | header, automatic refresh | after the topology app restarts itself (~10 s) | 10 |
| 5 | `etc/graphml/<name>.xml` | nodes, links and icons of a GraphML view | after an upload through REST | |
| 6 | stock stylesheet in the theme jar, overridden by `styles/topology.css` | colours and widths of links, alarm frames, labels | override: on page reload | 07, 08, 09 |
| 7 | Java/GWT source, compiled into bundles under `system/` | how nodes and links are drawn, the 48 px icon size | after a Maven build and restart | (08 does it with CSS) |

Files 1-4 and the override of 6 are hot: `./topo.sh deploy` copies them into the running container and
OpenNMS picks them up without a restart.

## 1. Icon files: `jetty-webapps/opennms/svg/*.svg`

When a topology page opens, OpenNMS lists every `*.svg` in this folder (`IconRepositoryManager.getSVGIconFiles`).
The browser fetches each one as `/opennms/svg/<file>` and puts it into the page's `<defs>` (`D3.injectSVGDef`).
File names do not matter; the ids inside do. An icon is four groups:

```xml
<g id="stratus_icon">
  <g id="stratus_active">   ... </g>   <!-- the selected node -->
  <g id="stratus_rollover"> ... </g>   <!-- the mouse is over the node -->
  <g id="stratus">          ... </g>   <!-- normal -->
</g>
```

A node is drawn with `<use href="#stratus">`. The `_rollover` and `_active` copies sit on top of it and
fade in. **Size:** OpenNMS measures the normal group and scales the icon so its longest side is 48 px. Any
viewBox works. **Colour:** the colour lives in the file, as `fill="..."` or in a `<style>` block.
`opennms_icons.svg` uses classes `.st0` to `.st16`: `#505154` is the normal grey, `#09A8D3` the blue of
selected and mouse-over, `#FFFFFF` the white. All files end up in one page, so a class such as `.st1` in one
file also colours every other file that uses `.st1`. Give your own icons their own class names, or inline fills.

The stock files are:

- `opennms_icons.svg`: router, switch, server, database, firewall, generic, cloud, printer, wifiAccess, linux_file_server, opennms_server, application, IP_service, business_service, reduction_key, situation, interface
- `atlas_icons.svg`, `vmware_icons.svg` and `legacy_icons.svg`

Your production image adds `helix.svg`, `orion.svg` and `nimbus.svg`. `./topo.sh icons` lists every icon id
and points out a file that lacks one of the four groups. When you replace a file under the same name, the
browser can keep its cached copy: reload with Ctrl+Shift+R.

- **Example 05** recolours the stock icons by changing two colours in `opennms_icons.svg`.
- **Example 06** adds `stratus.svg`, a placeholder with the four groups (`examples/assets/stratus.svg`), maps the Stratus model to it and adds it to the Change Icon list.

## 2. Icon mappings: `etc/org.opennms.features.topology.app.icons.*.cfg`

Lines of `<icon key> = <icon id>`, in the Java properties format. A colon in a key needs a backslash: `nodes\:UserDefined.12`.

| File | Used by |
|---|---|
| `...icons.default.cfg` | every view: `default` (fallback icon), `group`, `cloud` |
| `...icons.linkd.cfg` | Enhanced Linkd views |
| `...icons.bsm.cfg`, `.application.cfg`, `.vmware.cfg`, `.pathoutage.cfg`, `.sfree.cfg` | those views |

Each file is registered by an OpenNMS bundle under its name (`service.pid` in the bundle's blueprint), so a file
with a new name is ignored. Add your lines to an existing file.

For each node OpenNMS takes the first match (`IconRepositoryManager.getSVGIconId`):

1. **`<namespace>.<vertex id>`**: a mapping for this one node. Right-click > Change Icon writes these.
2. **The node's icon key.** If that key has no mapping, the key without its last `.part` is tried, and so on.
   - **Enhanced Linkd** gives a node `linkd.system.snmp.<sysObjectID>` (`linkd.system` without SNMP), in namespace `nodes` (`nodes:<layer>` for a layer). The vertex id is the node id.
   - **GraphML:** the node's `iconKey` is the icon id itself.
3. **`default`.**

To see a node's namespace, id and icon key, select it and open the Info panel of the topology page,
**Technical Details**. `./topo.sh icons dev|prod` lists them for every node, with the icon each gets from the
files in `opennms/etc`, and flags a mapping to an icon no svg defines (such a node is drawn without an icon).
Karaf reads changed `.cfg` files within a second; reload the topology page.

- **Example 01** maps one node: `nodes.<id> = helix`.
- **Example 02** maps one model: `linkd.system.snmp.1.3.6.1.4.1.99999.1.2 = helix`. A shorter key, such as your enterprise number, covers all its models.
- **Example 03** changes `default`.

## 3. Change Icon list: `etc/org.opennms.features.topology.app.icons.list`

One icon id per line: the icons offered by right-click > Change Icon. Picking one writes
`<namespace>.<vertex id> = <icon>` into the mapping file that holds the node's key (for Enhanced Linkd,
`...icons.linkd.cfg`). For GraphML nodes, change `iconKey` in the GraphML instead. Read when the dialog opens.

- **Example 04** adds your icons to the list.

## 4. Topology app settings: `etc/org.opennms.features.topology.app.cfg`

| Setting | Effect |
|---|---|
| `showHeader` | the OpenNMS header above the map |
| `autoRefresh.enabled`, `autoRefresh.interval` | refresh the map every N seconds |
| `topologyServiceCacheTimeout` | seconds topology data is cached |

The topology app restarts itself when this file changes (blueprint `update-strategy="reload"`). Reload the page
after about 10 seconds. `...app.menu.cfg` orders the menus.

- **Example 10** turns on a 30-second refresh.

## 5. GraphML views: `etc/graphml/<name>.xml`

A GraphML view, such as "DAS demo" from `seed/das-demo.graphml`, lists its nodes and links. Each node names its icon in
`<data key="iconKey">orion</data>`; `foreignSource` and `foreignID` tie it to a node and its alarms. OpenNMS writes
these files, plus `etc/org.opennms.features.topology.plugins.topo.graphml-<name>.cfg`, when a graph is uploaded.
To change one, upload it again:

```bash
curl -u admin -X DELETE http://<host>:8980/opennms/rest/graphml/<name>
curl -u admin -X POST -H 'Content-Type: application/xml' --data-binary @<name>.xml http://<host>:8980/opennms/rest/graphml/<name>
```

## 6. The stylesheet: links, alarm frames, labels

**Stock:** `VAADIN/themes/topo_default/styles.css` inside
`system/org/opennms/features/topology/themes/org.opennms.features.topology.themes.default-theme/<version>/...default-theme-<version>.jar`.
That jar is an OSGi fragment of the Vaadin themes bundle, so a change means rebuilding the jar and restarting OpenNMS.
It is not hot. `./topo.sh pull` copies the file to `reference/topo_default-styles.css` for reading.

**Hot:** a `<style>` in any file of the svg folder applies to the whole topology page (section 1).
`./topo.sh deploy` puts `styles/topology.css` there as `zz-topology-styles.<hash>.svg`. Its name changes
with its content, so no browser shows an old copy. Start selectors with `svg` so they beat the stock rules:
`svg path.edge.up` beats `.edge.up`.

What OpenNMS draws (`GWTVertex.java`, `GWTEdge.java`, `GraphPainter.java`):

```text
<g class="vertex [selected]" transform="translate(x, y)">            one node
  <rect class="status <severity>">                                 alarm frame behind the icon
  <g class="icon-container" transform="translate(..) scale(48/size)">
    <use class="upIcon" href="#X">  <use class="overIcon" href="#X_rollover">  <use class="activeIcon" href="#X_active">
  <g class="node-status-counter">   <g class="status-badge-container status <severity>">
  <text class="vertex-label">                                      label, 11 px below the icon
  <rect class="svgIconOverlay">                                    mouse target
<path class="edge [selected] [up|down|<severity>]" style="stroke-width: 3px">   one link
```

Severities are `indeterminate`, `cleared`, `normal`, `warning`, `minor`, `major` and `critical`. Enhanced
Linkd links are `up` or `down` (`LinkdEdgeStatusProvider`) and carry the inline 3px width, so a width rule
needs `!important`.

| Stock rule | Colour |
|---|---|
| `.edge` | `#ccc` |
| `.edge.up`, `.normal` | `#336600` |
| `.edge.warning` | `#FFCC00` |
| `.edge.minor` | `#FF9900` |
| `.edge.major` | `#FF3300` |
| `.edge.down`, `.critical` | `#CC0000` |
| `.edge.selected` | `#999000` |
| `.vertex .status.<severity>` (stroke and fill) | same colours; `cleared` `#999`, `selected` `#91C054` |
| `.vertex-label` | 9px, centred |

- **Example 07** sets link colours, width and dashes.
- **Example 08** changes the icon size: the CSS `scale` property multiplies the 48 px around the node's centre.
- **Example 09** sets the alarm frame colours and the labels.

## 7. Source code (read it; changing it needs a build)

Stock 33.1.8, at tag `opennms-33.1.8-1` of https://github.com/OpenNMS/opennms. Your image
(`33.1.8-1192-g05c63c46e8`) is built from your own repository, which has the same paths, possibly changed.

| File | What it does |
|---|---|
| [`.../gwt/client/GWTVertex.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/GWTVertex.java) | the node elements; `normalizeSVGIcon` scales to 48 px (the `48` in `create` and `normalizeSVGIcon`); label at icon height / 2 + 11 |
| [`.../gwt/client/GWTEdge.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/GWTEdge.java) | the link path (a curve) and its inline 3px width |
| [`.../gwt/client/d3/D3.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/d3/D3.java) | `injectSVGDef`: puts the svg files into the page |
| [`.../internal/GraphPainter.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/GraphPainter.java) | the classes of nodes and links (`vertex selected`, `edge selected up`) |
| [`.../support/IconRepositoryManager.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/support/IconRepositoryManager.java) | the svg folder and the icon lookup of section 2 |
| [`DefaultIconRepository.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.api/src/main/java/org/opennms/features/topology/api/support/DefaultIconRepository.java) | reads and writes a mapping file |
| [`LinkdEdgeStatusProvider.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.linkd/src/main/java/org/opennms/features/topology/plugins/topo/linkd/internal/LinkdEdgeStatusProvider.java) | links `up` / `down` |
| [`Topology.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/enlinkd/service/api/src/main/java/org/opennms/netmgt/enlinkd/service/api/Topology.java) | `getIconKey`: the Enhanced Linkd icon keys |
| [`topo_default/styles.css`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/themes/default-theme/src/main/filtered/VAADIN/themes/topo_default/styles.css) | the stock stylesheet (section 6) |
| [`opennms-webapp/src/main/webapp/svg/`](https://github.com/OpenNMS/opennms/tree/opennms-33.1.8-1/opennms-webapp/src/main/webapp/svg) | the stock icon files |
| [`opennms-base-assembly/.../etc/`](https://github.com/OpenNMS/opennms/tree/opennms-33.1.8-1/opennms-base-assembly/src/main/filtered/etc) | the stock mapping files and list |
