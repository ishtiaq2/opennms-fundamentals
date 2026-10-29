# The OpenNMS files that draw and style /opennms/topology (Horizon 33.1.8)

Paths are below `/opt/opennms` in the container (a link to `/usr/share/opennms`). After `./topo.sh pull`,
the folder `opennms/` of this kit has the same paths with the files of production. Each section names the
example (`./topo.sh example N`) that changes that file, so you can watch what happens.

| # | File | What it decides | A change shows | Examples |
|---|---|---|---|---|
| 1 | `jetty-webapps/opennms/svg/*.svg` | the icons: artwork, colours, normal / mouse-over / selected | a new file: in a new browser tab; a changed file: on reload with the browser cache off (section 6) | 05, 06 |
| 2 | `etc/org.opennms.features.topology.app.icons.*.cfg` | which node gets which icon | within a second | 01, 02, 03 |
| 3 | `etc/org.opennms.features.topology.app.icons.list` | the icons in right-click > Change Icon | when the dialog opens | 04 |
| 4 | `etc/org.opennms.features.topology.app.cfg` | header, automatic refresh | after the topology app restarts itself (~10 s) | 10 |
| 5 | `etc/graphml/<name>.xml` and its two `.cfg` files | an entry of the View menu: its nodes, links and icons | when its cfg file appears (a deploy takes it away for 5 s and back) | 11 |
| 6 | stock stylesheet in the theme jar, overridden by `styles/topology.css` | colours and widths of links, alarm frames, labels; the parts, frame and size of one icon | override: in a new tab after its first deploy, then on reload with the cache off | 07, 08, 09, 12 |
| 7 | Java/GWT source, compiled into bundles under `system/` | how nodes and links are drawn, the 48 px icon size | after a Maven build and restart | (08 does it with CSS) |

Files 1-5 and the override of 6 are hot: `./topo.sh deploy` copies them into the running container and
OpenNMS picks them up without a restart.

## 1. Icon files: `jetty-webapps/opennms/svg/*.svg`

When a browser tab opens the topology page, OpenNMS lists every `*.svg` in this folder
(`IconRepositoryManager.getSVGIconFiles`). The browser fetches each one as `/opennms/svg/<file>` and puts the whole
file into the page's `<defs>` (`D3.injectSVGDef`). A reload of the tab keeps that list (section 6), so a new file
reaches an open tab only through a new tab.
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
file also colours every other file that uses `.st1`. Give your own icons their own class names, or inline fills,
or settle it in `styles/topology.css` with rules that start with the id of a drawing (section 6): `./topo.sh css`
lists the classes that several files define differently.

The stock files are:

- `opennms_icons.svg`: router, switch, server, database, firewall, generic, cloud, printer, wifiAccess, linux_file_server, opennms_server, application, IP_service, business_service, reduction_key, situation, interface
- `atlas_icons.svg`, `vmware_icons.svg` and `legacy_icons.svg`

Your production image adds `helix.svg`, `orion.svg` and `nimbus.svg`. `./topo.sh icons` lists every icon id
and points out a file that lacks one of the four groups. The browser keeps svg files for an hour: after a change,
reload with the cache off (section 6).

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

1. **`<namespace>.<vertex id>`**: a mapping for this one node, in any of these files. Right-click > Change Icon writes
   these. It works for GraphML views too: `./topo.sh view show <name>` prints the namespace and the node ids, and
   `./topo.sh view icon <name> <node id> <icon id>` writes the line with the right namespace. The namespace is the
   one of the view (for `Maven-abc`: `Maven-abc.12 = cirrus`), not one copied from an example; a line whose
   namespace no node has does nothing, and `./topo.sh view show` says so.
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

## 5. The View menu, and GraphML views of your own

The View menu of the topology page has one entry per topology provider. The stock ones draw OpenNMS nodes:

| Entry | Draws | Lines | Icons |
|---|---|---|---|
| Enhanced Linkd | every node | links that Enhanced Linkd finds, and user-defined links | `...icons.linkd.cfg` (section 2) |
| Path Outage | every node, under its parent node | node to parent: `parent-foreign-id` in the requisition | `...icons.pathoutage.cfg`: `pathoutage.<node id> = <icon>`, else `generic` |
| Application, Business Services, VMware | applications, business services, VMware objects | their relations | their own `.cfg` file |
| one entry per GraphML view | what its file lists | its `<edge>` elements | each node's `iconKey`: the icon id itself |

A view opens on its *focus* at a *semantic zoom level* (SZL): the focus nodes and every node up to SZL links away.
Path Outage focuses on the node with the worst outage, else the first node, at SZL 0: you see one node. The toolbar
buttons "Increase Semantic Zoom Level" and "Decrease Semantic Zoom Level" change the SZL, and the search box adds nodes to
the focus. A link can set both: `/opennms/topology?provider=Path%20Outage&szl=2&focus-vertices=<node id>`
(`./dev.sh status` prints it for the demo).

**A GraphML view is three files in `etc/`:**

| File | What it says |
|---|---|
| `graphml/<name>.xml` | the nodes, links, icons and labels |
| `org.opennms.features.topology.plugins.topo.graphml-<name>.cfg` | `topologyLocation = <path of the xml>` and `label`: this file puts the view into the View menu |
| `org.opennms.netmgt.graph.provider.graphml-<name>.cfg` | the same for the Graph API, `/opennms/api/v2/graphs` |

OpenNMS writes all three when a GraphML file is uploaded (`POST /opennms/rest/graphml/<name>`; `./dev.sh up` uploads
"DAS demo" this way), and loads the view when its cfg file appears in `etc/`. It reads the xml only then, and ignores later
changes of the xml or the cfg ("Updating is not supported", `GraphMLMetaTopologyFactory`) until the cfg file goes away and
comes back. REST does that with DELETE and POST; `./topo.sh deploy` does it for a changed view, whose cfg files leave for
about 5 seconds.

The parts of a GraphML file (all of it: `examples/assets/das-mine.graphml`; the demo: `seed/das-demo.graphml`):

```xml
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="iconKey" for="node" attr.name="iconKey" attr.type="string"/> <!-- a <key> for each property used below -->
  <data key="label">My DAS (GraphML)</data>                    <!-- the entry in the View menu -->
  <graph id="das-mine" edgedefault="undirected">                <!-- a layer; a file may hold several -->
    <data key="namespace">das-mine</data>                     <!-- required; no other view may use it -->
    <data key="focus-strategy">ALL</data>                     <!-- ALL, FIRST (default), EMPTY, or SPECIFIC with focus-ids -->
    <data key="semantic-zoom-level">1</data>
    <data key="preferred-layout">Hierarchy Layout</data>      <!-- top to bottom by "level" -->
    <data key="vertex-status-provider">default</data>         <!-- alarm colours of the OpenNMS nodes -->
    <node id="orion-1">
      <data key="label">orion-1</data>
      <data key="iconKey">orion</data>                        <!-- an icon id of the svg folder, not a mapping key -->
      <data key="foreignSource">DAS-Demo</data>               <!-- the OpenNMS node (or nodeID): status, alarms -->
      <data key="foreignID">orion-1</data>
      <data key="level">1</data>
    </node>
    <edge id="orion-1-helix-1" source="orion-1" target="helix-1"><data key="tooltipText">Q2</data></edge>
  </graph>
</graphml>
```

A node without `foreignSource` and `foreignID` (or `nodeID`) is a drawing only: a room, a site, a group. With several
`<graph>` elements the view has layers; a link from a node of one layer to a node of another lets you go there (right-click).

**With the kit:**

```bash
./topo.sh view list [dev|prod]             # the views there, with their View-menu labels
./topo.sh view show <name> [dev|prod]      # its nodes: id, label, icon key, the icon drawn (and what is wrong with it)
./topo.sh view icon <name> <node id> <icon id>  # another icon for one node: writes the mapping line, deploys to dev
./topo.sh view add my-view.graphml [name]  # checks the file, writes it and its two cfg files into opennms/, deploys to dev
./topo.sh deploy dev                       # after a change of opennms/etc/graphml/<name>.xml: the view is loaded anew
./topo.sh deploy prod                      # to production, with confirmation, backups/ and ./topo.sh undo
./topo.sh view remove <name> [dev|prod]    # out of opennms/, and away there
```

`./topo.sh view add` checks what the GraphML reader of OpenNMS refuses (a `<data>` without its `<key>`, two nodes with one
id, a link to an unknown node, no or a taken namespace), lists icon keys that no svg file defines, and replaces `@orion@`,
`@helix@`, ... with the icon id of that word in the svg folder. `./topo.sh pull` copies production's views into `opennms/`
with the other topology files (but not the demo view).

**A view that production's software writes** (one per requisition, for example) may be written again at any time. Change
its look around the file where you can: a line `<namespace>.<node id> = <icon id>` in
`etc/org.opennms.features.topology.app.icons.default.cfg` (`./topo.sh view icon` writes it) gives one node another
icon and wins over its `iconKey`, the svg files and `styles/topology.css` do the rest. A production deploy leaves
alone a view file that production changed after your last pull or deploy. `GUIDE-Maven-abc-styles.md` walks through it.

- **Example 11** adds the view "My DAS (GraphML)": a room drawn above four demo nodes.

Without the kit, through REST (there is no PUT: delete, then post again):

```bash
curl -u admin -X DELETE http://<host>:8980/opennms/rest/graphml/<name>
curl -u admin -X POST -H 'Content-Type: application/xml' --data-binary @<name>.xml http://<host>:8980/opennms/rest/graphml/<name>
```

These calls answer in XML only: a client that asks for JSON (`Accept: application/json`) gets "HTTP 406 Not Acceptable",
which OpenNMS 33.1.8 reports as HTTP 500.

## 6. The stylesheet: links, alarm frames, labels

**Stock:** `VAADIN/themes/topo_default/styles.css` inside
`system/org/opennms/features/topology/themes/org.opennms.features.topology.themes.default-theme/<version>/...default-theme-<version>.jar`.
That jar is an OSGi fragment of the Vaadin themes bundle, so a change means rebuilding the jar and restarting OpenNMS.
It is not hot. `./topo.sh pull` copies the file to `reference/topo_default-styles.css` for reading.

**Hot:** a `<style>` in any file of the svg folder applies to the whole topology page (section 1).
`./topo.sh deploy` puts `styles/topology.css` there as `zz-topology-styles.svg`. Start selectors with `svg` so they
beat the stock rules: `svg path.edge.up` beats `.edge.up`. A selector also needs the classes of the stock rule:
`svg path.edge` loses to `.edge.normal`.

**When the browser shows a change.** Two things in OpenNMS decide it, for every svg file, this one included:

- A browser tab gets the list of svg files when it opens the topology page, and keeps it on reload: `TopologyUI` is
  `@PreserveOnRefresh`, so a reload finds the page's old state, the `TopologyComponent` with its list included
  (`getState().setSVGDefFiles(...)` runs once, when the component is made). A new svg file reaches an open tab only
  through a new tab. (Kit 3.6 and older named this file `zz-topology-styles.<hash>.svg`, a new name at each change,
  so an open tab never got a change. Kit 3.7 keeps one name, and the next deploy removes the old ones.)
- Jetty sends the files of the web application with `Cache-Control: max-age=3600,public` (`cacheControl` of the
  `default` servlet in `jetty-webapps/opennms/WEB-INF/web.xml`), so the browser keeps an svg file for an hour.
  Ctrl+Shift+R is not enough: the page asks for its svg files after it has loaded, and Chrome bypasses its cache
  only for what a page asks for while it loads. Reload with DevTools (F12) open and Network > Disable cache ticked.

`./topo.sh deploy` says after each deploy which of the two applies, and `./topo.sh css [dev|prod]` whether that
OpenNMS has your current `styles/topology.css`. Dev always gets the file; production gets it with your first rules,
and keeps it from then on, so that open tabs keep it in their list.

**One icon.** Each svg file sits whole in the `<defs>` of the page; a node shows copies of one of its drawings
(`<use href="#X">`). A rule whose selector holds the drawing's id styles a part of it in every copy, and wins over the
class rules of every svg file, in any order: `#X .cls-1 { fill: #1F3A5F; }`, `#X_rollover ...`, `#X_active ...`.
`./topo.sh css <icon id | file.svg>` prints these rules for one icon, made from its file. The nodes drawn with an
icon are `svg .vertex:has(use.upIcon[*|href="#X"])`: their `rect.status` (frame: `stroke`, `stroke-width`, `rx`;
background: `fill`), `.icon-container` (`scale`, `filter`, `shape-rendering`) and `text.vertex-label`. Lengths in rules
for parts of a drawing are in its own units, which OpenNMS shrinks to 48 px; `vector-effect: non-scaling-stroke` keeps
a stroke in screen pixels. CSS variables pass into the copies:
`#X .cls-1 { fill: var(--alarm, #1F3A5F); }` with `svg .vertex:has(> rect.status.critical) { --alarm: #CC0000; }`.
Step 7 of `GUIDE-Maven-abc-styles.md` has the details.

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
needs `!important`. GraphML links are `normal`, unless scripts in `etc/graphml-edge-status/` give them another
severity or set `stroke`, `stroke-width`, `stroke-opacity` or `stroke-dasharray` inline
(`GraphMLEdgeStatusProvider`).

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
- **Example 12** styles one icon (das_nimbus, or `ICON=<id> ./topo.sh example 12`): the main colour of each of its
  drawings (the alarm colour with a major or critical alarm), a 2 px rounded frame on white, 25 % bigger, crisp edges.

## 7. Source code (read it; changing it needs a build)

Stock 33.1.8, at tag `opennms-33.1.8-1` of https://github.com/OpenNMS/opennms. Your image
(`33.1.8-1192-g05c63c46e8`) is built from your own repository, which has the same paths, possibly changed.

| File | What it does |
|---|---|
| [`.../gwt/client/GWTVertex.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/GWTVertex.java) | the node elements; `normalizeSVGIcon` scales to 48 px (the `48` in `create` and `normalizeSVGIcon`); label at icon height / 2 + 11 |
| [`.../gwt/client/GWTEdge.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/GWTEdge.java) | the link path (a curve) and its inline 3px width |
| [`.../gwt/client/d3/D3.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/d3/D3.java) | `injectSVGDef`: puts the svg files into the page |
| [`.../internal/GraphPainter.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/GraphPainter.java) | the classes of nodes and links (`vertex selected`, `edge selected up`) |
| [`.../support/IconRepositoryManager.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/support/IconRepositoryManager.java) | the svg folder (`getSVGIconFiles`) and the icon lookup of section 2 |
| [`.../internal/TopologyUI.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/TopologyUI.java) | `@PreserveOnRefresh`: a reload keeps the page's state, its list of svg files included |
| [`web.xml`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp/src/main/webapp/WEB-INF/web.xml) | `cacheControl` `max-age=3600,public` of the `default` servlet: the browser keeps svg files for an hour |
| [`DefaultIconRepository.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.api/src/main/java/org/opennms/features/topology/api/support/DefaultIconRepository.java) | reads and writes a mapping file |
| [`LinkdEdgeStatusProvider.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.linkd/src/main/java/org/opennms/features/topology/plugins/topo/linkd/internal/LinkdEdgeStatusProvider.java) | links `up` / `down` |
| [`Topology.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/enlinkd/service/api/src/main/java/org/opennms/netmgt/enlinkd/service/api/Topology.java) | `getIconKey`: the Enhanced Linkd icon keys |
| [`topo_default/styles.css`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/themes/default-theme/src/main/filtered/VAADIN/themes/topo_default/styles.css) | the stock stylesheet (section 6) |
| [`GraphMLMetaTopologyFactory.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.graphml/src/main/java/org/opennms/features/topology/plugins/topo/graphml/internal/GraphMLMetaTopologyFactory.java) | loads a GraphML view when its cfg file appears, ignores updates (section 5) |
| [`GraphMLReader.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/graphml/api/src/main/java/org/opennms/features/graphml/model/GraphMLReader.java) | what a GraphML file may hold: the checks of `./topo.sh view add` |
| [`GraphmlRestService.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/graphml/rest/src/main/java/org/opennms/netmgt/graphml/rest/GraphmlRestService.java) | the GraphML REST calls (XML only) |
| [`PathOutageProvider.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.pathoutage/src/main/java/org/opennms/features/topology/plugins/topo/pathoutage/PathOutageProvider.java) | the Path Outage view: each node under its parent, opened on one node at SZL 0 |
| [`opennms-webapp/src/main/webapp/svg/`](https://github.com/OpenNMS/opennms/tree/opennms-33.1.8-1/opennms-webapp/src/main/webapp/svg) | the stock icon files |
| [`opennms-base-assembly/.../etc/`](https://github.com/OpenNMS/opennms/tree/opennms-33.1.8-1/opennms-base-assembly/src/main/filtered/etc) | the stock mapping files and list |
