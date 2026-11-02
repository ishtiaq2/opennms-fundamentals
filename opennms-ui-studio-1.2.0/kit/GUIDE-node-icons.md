# Node icons on the topology page: the files, how OpenNMS builds the map, icons by node type

This guide answers four questions, each with commands you can type:

1. Which files decide the icon of a node, and how do you read and change them in a running OpenNMS with podman? (part 1)
2. How does OpenNMS build the map from its nodes and views? (part 2)
3. Where does the icon of a node come from, step by step, and is there a script that maps nodes to icons? (part 3)
4. How do all nodes of one type, say every Nimbus, get the Nimbus icon, without a line per node? (part 4)

Part 0 brings the development OpenNMS up to date first, part 5 is about production and part 6 lists problems and
their causes. Everything is OpenNMS Horizon 33.1.8 as your containers run it, read from its source (part 7).

| | Development OpenNMS | Production |
|---|---|---|
| Container | `onms-dev-core`, on this machine (192.168.0.47, user `admin`) | `opennms`, on 192.168.0.36 (user `maven-admin`) |
| A command in the container | `podman exec onms-dev-core <command>` | `ssh maven-admin@192.168.0.36 podman exec opennms <command>` |
| Web UI and REST API | `http://192.168.0.47:8980/opennms`, user admin, password admin | `http://192.168.0.36:8980/opennms`, your login |

Paths are inside the container. OpenNMS lives in `/usr/share/opennms`; `/opt/opennms` is a link to it, so both work in
`podman exec`. Run the commands on the development machine, in the kit folder
(`cd ~/opennms-fundamentals/opennms-ui-studio/kit`), unless a step says otherwise. Practise on dev; part 5 says what is
different on production.

---

## 0. Bring dev up to date (once)

```bash
./dev.sh seed        # the demo view "DAS demo" again, each node with the icon of its type
./dev.sh copy-prod   # production's requisitions (its nodes) and its GraphML views, into dev
```

**Why nimbus-2 had the iconKey `wifiAccess`.** `./dev.sh up` adds demo nodes (orion-1, helix-1, stratus-1/2,
nimbus-1/2) and the view "DAS demo", and gives each node the icon of its type if the svg files of dev have one, else a
stock icon. It looked for icons by their wrapper group `<g id="X_icon">`, and your `nimbus.svg` has none: it keeps its
three looks inside `<g id="nimbus">` (part 1.1). So it found no nimbus icon and took the stock `wifiAccess`. Kit 3.12
finds an icon by the ids OpenNMS really draws (`X` with `X_rollover` and `X_active`), takes the icon of each type from
`icon-types.cfg` (part 4.2), and says what it chose, for example:

```text
seed: GraphML view "DAS demo"
  orion nodes: iconKey orion
  helix nodes: iconKey helix
  stratus nodes: iconKey server, a stock icon (no svg file has the icon stratus of icon-types.cfg, nor one named like stratus)
  nimbus nodes: iconKey nimbus (nimbus.svg keeps its looks inside #nimbus, so a node shows #nimbus_active, the last one, until the file is repaired: GUIDE-node-icons.md, part 1.1)
```

`./dev.sh up` does the same by itself after a kit update; `./dev.sh seed` does it now.

**What `./dev.sh copy-prod` does in OpenNMS.** Production is only read.

1. It copies production's deployed requisitions, `etc/imports/<name>.xml`, and their foreign source definitions,
   `etc/foreign-sources/<name>.xml`, out of the container (`podman cp` over ssh).
2. It sends each one to dev's REST API, the way the web UI does: `POST /opennms/rest/foreignSources`,
   `POST /opennms/rest/requisitions`, then `PUT /opennms/rest/requisitions/<name>/import?rescanExisting=false`. On dev,
   provisiond (the provisioning daemon) puts the nodes into dev's database and scans them (part 2.1). It waits until the
   nodes are there.
3. It runs `./topo.sh pull`: production's topology files, the GraphML views among them, into the kit's `opennms/`
   folder and onto dev. Then dev loads its views again, so that each one finds its nodes (part 2.4).
4. It reports how each view reaches its nodes, for example:

```text
How the views reach their nodes on dev:
  Maven-abc (namespace Maven-abc): 9 nodes; linked 8 by foreignSource and foreignID, all on dev; 1 drawing(s) without a node
```

`./dev.sh copy-prod abc` copies only the requisition `abc`. `./dev.sh remove-nodes abc` takes a requisition and its
nodes out of dev again (never out of production). Two things to know:

- **Dev monitors the copied nodes itself.** Their interfaces and services are polled by dev from now on, as production
  polls them, so the alarms you see on dev are dev's own. Dev uses its own SNMP settings: if your devices need
  production's SNMP community, see part 5.3.
- **`./topo.sh pull` keeps your work.** If `opennms/` holds changes that production does not have, it lists them and
  stops; deploy them, `./topo.sh revert` them or replace them with `FORCE=1 ./topo.sh pull`, then run
  `./dev.sh copy-prod` again. The requisitions are copied either way.

---

## 1. The files

| File (below `/usr/share/opennms`) | What it decides | Who writes it | A change shows |
|---|---|---|---|
| `jetty-webapps/opennms/svg/*.svg` | the drawings: an icon is a group with an id in one of these files | the image, you | a new file: in a new browser tab; a changed file: on reload |
| `etc/org.opennms.features.topology.app.icons.<name>.cfg` | which node gets which icon: lines `<key> = <icon id>` | you; right-click > Change Icon | within a second, on reload of the page |
| `etc/org.opennms.features.topology.app.icons.list` | the icons that right-click > Change Icon offers | you | when the dialog opens |
| `etc/graphml/<name>.xml` and two `.cfg` files | a GraphML view: its nodes, links, labels and the `iconKey` of each node | whatever posts it: your software, `./topo.sh view add`, `./dev.sh seed` | when the view is loaded (1.4) |
| `etc/imports/<name>.xml`, `etc/foreign-sources/<name>.xml` | the nodes of a requisition, and how they are scanned | the web UI's requisition pages, the REST API, your software | after an import ("synchronize") |

### 1.1 The drawings: `jetty-webapps/opennms/svg/*.svg`

OpenNMS puts every svg file of this folder into the topology page and draws each node with three `<use>` elements:

| The node is | OpenNMS draws |
|---|---|
| shown | `<use class="upIcon" href="#X">` |
| under the mouse | `<use class="overIcon" href="#X_rollover">` on top of it |
| selected | `<use class="activeIcon" href="#X_active">` on top of it |

`X` is the icon id of the node (part 3). A `<use>` draws everything inside the element with that id, so the stock files
put the three looks next to each other, in a wrapper that nothing draws:

```xml
<g id="nimbus_icon">                  <!-- the wrapper: no <use> points at it -->
  <g id="nimbus"> ... </g>            <!-- the normal look -->
  <g id="nimbus_rollover"> ... </g>   <!-- under the mouse -->
  <g id="nimbus_active"> ... </g>     <!-- selected -->
</g>
```

Look at the files of dev:

```bash
podman exec onms-dev-core ls -l /opt/opennms/jetty-webapps/opennms/svg
podman exec onms-dev-core grep -o 'id="nimbus[^"]*"' /opt/opennms/jetty-webapps/opennms/svg/nimbus.svg
./topo.sh icons     # every icon id of opennms/ (after ./topo.sh pull), and what is wrong with a file
```

The `grep` on your `nimbus.svg` prints `id="nimbus"`, `id="nimbus_default"`, `id="nimbus_rollover"`,
`id="nimbus_active"` in that order: the three looks are *inside* `nimbus`, so `<use href="#nimbus">` draws all three on
top of each other and the last one, the selected look, covers the others. That is why the nimbus nodes are light blue
all the time, and why a CSS rule for `#nimbus_default` changes nothing you see. The repair renames two ids and nothing
else. OpenNMS UI Studio does it for you (Topology > Icon files > *Make a repaired copy in the workspace*, then Apply);
by hand, on dev:

```bash
podman exec onms-dev-core cat /opt/opennms/jetty-webapps/opennms/svg/nimbus.svg > nimbus.svg.orig
sed -e 's/id="nimbus"/id="nimbus_icon"/' -e 's/id="nimbus_default"/id="nimbus"/' nimbus.svg.orig > nimbus.svg
diff nimbus.svg.orig nimbus.svg          # two lines change
podman exec -i onms-dev-core sh -c 'cat > /usr/share/opennms/jetty-webapps/opennms/svg/nimbus.svg' < nimbus.svg
```

Reload the topology page: the nimbus nodes show the grey normal look; under the mouse and when selected they show the
other two. (`podman exec -i ... sh -c 'cat > file' < local-file` writes a file into the container through the
container's own shell; it works with links and volumes alike. A file changed by hand in dev's container lasts until
dev starts again, if production's overlay folder has that file (the image copies it in at every start), or until the
container is made again; keep your files in the kit's `opennms/` or in the studio, which deploy them again.)

### 1.2 The mappings: `etc/org.opennms.features.topology.app.icons.<name>.cfg`

```bash
podman exec onms-dev-core sh -c 'ls -l /opt/opennms/etc/org.opennms.features.topology.app.icons.*'
podman exec onms-dev-core cat /opt/opennms/etc/org.opennms.features.topology.app.icons.default.cfg
```

Each line is `<icon key> = <icon id>`, in the format of a Java properties file: `#` starts a comment, a colon, an equals
sign or a blank in a key needs a backslash before it (`nodes\:UserDefined.12 = helix`), and when a key appears twice,
the later line counts. The files and the views that use them:

| File | Used by |
|---|---|
| `...icons.default.cfg` | every view: `default` (the icon when nothing else matches), and lines for single nodes of any view |
| `...icons.linkd.cfg` | Enhanced Linkd |
| `...icons.pathoutage.cfg`, `.bsm.cfg`, `.application.cfg`, `.vmware.cfg` | those views |

Each file belongs to a bundle of OpenNMS that registered it by its name: a file with a new name, such as
`...icons.mine.cfg`, is never read. Put your lines into one of these. Karaf (the part of OpenNMS that holds the topology
app) reads a changed file within a second; reload the topology page.

To change a file by hand, keep a copy on this machine first: it is your way back.

```bash
C=onms-dev-core
F=/usr/share/opennms/etc/org.opennms.features.topology.app.icons.default.cfg
podman exec $C cat $F > icons.default.cfg.orig                       # your way back
podman exec $C sh -c "echo 'das-demo.nimbus-2 = helix' >> $F"        # one line more (part 3, exercise 2)

cp icons.default.cfg.orig icons.default.cfg && vi icons.default.cfg  # or edit a copy, and write it back:
podman exec -i $C sh -c "cat > $F.new && mv $F.new $F" < icons.default.cfg
```

The write goes to `$F.new` first and is then renamed: Karaf reads only files whose names end in `.cfg`, so it sees the
finished file once, never a half-written one.

### 1.3 The Change Icon list: `etc/org.opennms.features.topology.app.icons.list`

One icon id per line: what right-click > Change Icon offers. Picking one writes `<namespace>.<node id> = <icon id>` into
the mapping file that holds the node's key, and OpenNMS writes that whole file again (its comments are gone afterwards).
OpenNMS documents that the icon of a GraphML node cannot be changed this way: for those, see part 3.

```bash
podman exec onms-dev-core cat /opt/opennms/etc/org.opennms.features.topology.app.icons.list
podman exec onms-dev-core sh -c 'echo nimbus >> /usr/share/opennms/etc/org.opennms.features.topology.app.icons.list'
```

### 1.4 GraphML views: `etc/graphml/<name>.xml` and two `.cfg` files

A GraphML view is an entry of the View menu that a file describes:

| File | Says |
|---|---|
| `etc/graphml/<name>.xml` | the nodes, links, labels and the `iconKey` of each node |
| `etc/org.opennms.features.topology.plugins.topo.graphml-<name>.cfg` | `topologyLocation` (where the xml is) and `label`: this file puts the view into the View menu |
| `etc/org.opennms.netmgt.graph.provider.graphml-<name>.cfg` | the same for the Graph API, `/opennms/api/v2/graphs` |

```bash
podman exec onms-dev-core ls -l /opt/opennms/etc/graphml
podman exec onms-dev-core sh -c 'grep -H label /opt/opennms/etc/org.opennms.features.topology.plugins.topo.graphml-*.cfg'
podman exec onms-dev-core cat /opt/opennms/etc/graphml/das-demo.xml
./topo.sh view list          # the same, with the label of each View menu entry
./topo.sh view show das-demo # its namespace, node ids, iconKeys and the icon each node gets
```

A node of the file:

```xml
<node id="nimbus-2">
  <data key="label">nimbus-2</data>
  <data key="iconKey">nimbus</data>            <!-- the icon id itself (part 3) -->
  <data key="foreignSource">DAS-Demo</data>    <!-- the OpenNMS node it stands for: requisition ... -->
  <data key="foreignID">nimbus-2</data>        <!-- ... and foreign id (part 2.4) -->
  <data key="level">2</data>                   <!-- its row in the Hierarchy Layout -->
</node>
```

OpenNMS writes the three files when a view is posted to `POST /opennms/rest/graphml/<name>`, and loads the view when its
cfg file appears in `etc/`. It reads the xml only then: a later change of the xml does nothing ("Updating is not
supported") until the view goes away and comes back. Two ways to do that:

```bash
# 1. REST: delete the view, then post the changed file (there is no PUT)
curl -sS -u admin:admin -X DELETE http://localhost:8980/opennms/rest/graphml/das-demo
sleep 5
curl -sS -u admin:admin -X POST -H 'Content-Type: application/xml' --data-binary @das-demo.xml http://localhost:8980/opennms/rest/graphml/das-demo

# 2. Write the changed xml into the container, then take its two cfg files away for 5 seconds (what ./topo.sh deploy does)
podman exec -i onms-dev-core sh -c 'cat > /usr/share/opennms/etc/graphml/das-demo.xml' < das-demo.xml
./topo.sh view reload das-demo
```

### 1.5 The nodes: requisitions

A requisition is a list of nodes that OpenNMS should have, named by its *foreign source* (here `DAS-Demo`); each node
has a *foreign id* that is unique in it. The foreign source definition of the same name says how to scan them
(detectors) and what to keep (policies); without one, `etc/default-foreign-source.xml` applies.

```xml
<model-import xmlns="http://xmlns.opennms.org/xsd/config/model-import" foreign-source="DAS-Demo">
  <node foreign-id="nimbus-2" node-label="nimbus-2" parent-foreign-source="DAS-Demo" parent-foreign-id="helix-1">
    <category name="Nimbus"/>
  </node>
</model-import>
```

```bash
podman exec onms-dev-core ls -l /opt/opennms/etc/imports /opt/opennms/etc/foreign-sources
podman exec onms-dev-core cat /opt/opennms/etc/imports/DAS-Demo.xml
curl -s -u admin:admin http://localhost:8980/opennms/rest/requisitions/DAS-Demo
curl -s -u admin:admin -H 'Accept: application/json' 'http://localhost:8980/opennms/rest/nodes?limit=0&foreignSource=DAS-Demo' |
  python3 -m json.tool | grep -E '"(id|label|foreignId|sysObjectId)"'
```

`etc/imports/` holds the requisitions as last imported; `etc/imports/pending/` those edited in the web UI and not
synchronized yet. The nodes themselves, with their database ids, are in OpenNMS's PostgreSQL database.

---

## 2. How OpenNMS builds the map

### 2.1 First the nodes: provisioning

When a requisition is imported ("synchronize" in the web UI, `PUT .../import` in REST), provisiond makes the database
match it: it inserts new nodes, updates changed ones and deletes the nodes the requisition no longer lists. Then it
scans each node: the detectors of its foreign source definition (ICMP, SNMP, ...) find its services, and an SNMP scan
reads, among others, the node's `sysObjectID` (the device model). From then on the pollers watch the services and
raise alarms. A node can also come without a requisition, from discovery. Every view of the topology page draws these
nodes, or points to them.

### 2.2 The View menu: one topology provider per entry

| Entry | Its nodes and links come from | Namespace | Icon key of a node |
|---|---|---|---|
| Enhanced Linkd | every node of the database; the links that Enhanced Linkd finds with SNMP (LLDP, CDP, OSPF, IS-IS, bridge tables) and user-defined links | `nodes` | `linkd.system.snmp.<sysObjectID>`, or `linkd.system` without SNMP |
| Path Outage | every node, under its parent node (`parent-foreign-id` in the requisition) | `pathoutage` | `pathoutage.default` for every node (mapped to `generic`); a line `pathoutage.<node id>` changes one node |
| each GraphML view | its file in `etc/graphml/` | the `namespace` of the file | the node's `iconKey` in the file |
| Application, Business Services, VMware | their own definitions | their own | their own keys, such as `bsm.business-service` |

A provider turns its data into *vertices* (nodes on the map: namespace, id, label, icon key, the OpenNMS node behind
it) and *edges* (links). The namespace and the id together name a vertex: `das-demo:nimbus-2` is the node nimbus-2 of
the view "DAS demo".

### 2.3 From the provider to the picture

```text
 database: nodes, links, alarms     etc/graphml/*.xml           etc/...icons.*.cfg      jetty-webapps/opennms/svg/*.svg
            │                              │                             │                           │
            ▼                              ▼                             │                           │
 Enhanced Linkd, Path Outage, ...   GraphML provider, one per view       │                           │
            └───── vertices (namespace, id, label, icon key, node) ──────┤                           │
                                           │                             │                           │
                                           ▼                             ▼                           │
      topology app (TopologyUI in Karaf): the view you chose, its focus and zoom level, the layout,  │
      the status of each vertex (alarms of its node), and the icon id of each vertex (part 3)        │
                                           │                                                         │
                                           ▼                                                         │
      browser: every svg file into the page's <defs> ◄────────────────────────────────────────────────┘
               one <g class="vertex"> per vertex, with <use href="#<icon id>">; one <path class="edge"> per link
```

The server works this out each time it sends the map to the browser: when you open a view, change the zoom or the
focus, and at each refresh. Nothing is stored in between, and there is no step that writes icons into the page ahead of
time. A view opens on its *focus* (some or all of its vertices) at a *semantic zoom level*: the focus and every vertex
up to that many links away. The toolbar's "Increase Semantic Zoom Level" shows more.

### 2.4 How a GraphML node finds its OpenNMS node

A node of a view stands for an OpenNMS node (its status colours, the right-click menu of the node) in one of two ways:

| In the GraphML | OpenNMS uses | Between dev and production |
|---|---|---|
| `<data key="nodeID">12</data>` | the node with database id 12 | not portable: each OpenNMS numbers its own nodes, so on dev id 12 is another node, or none |
| `<data key="foreignSource">abc</data>` and `<data key="foreignID">orion-a</data>` | the node `orion-a` of requisition `abc`, looked up when the view is loaded | portable: the same node on every OpenNMS that has the requisition |

`nodeID` wins when both are there. The lookup by foreign source happens once, when the view is loaded: a view loaded
before its nodes existed shows no status for them (karaf.log says "No node found for the given foreignSource ...")
until it is loaded again: `./topo.sh view reload`. `./dev.sh copy-prod` loads the views after the nodes, and its report
lists every node of a view that is linked by `nodeID`, with the node that id is on dev, and every node whose foreign
source and foreign id dev does not have. A node with neither is a drawing only: a site, a room. The view colours a node
by the worst unacknowledged alarm of its OpenNMS node when the graph has `<data key="vertex-status-provider">default</data>`.

### 2.5 Look at it yourself

- **On the page:** select a node, open the Info panel, **Technical Details**: its namespace, id and icon key.
- **The Graph API** lists the views and their vertices with their properties:

  ```bash
  curl -s -u admin:admin -H 'Accept: application/json' http://localhost:8980/opennms/api/v2/graphs |
    python3 -m json.tool | grep -E '"(id|namespace|label)"'
  # then, with a container id and one of its namespaces from that list:
  curl -s -u admin:admin -H 'Accept: application/json' 'http://localhost:8980/opennms/api/v2/graphs/<container id>/<namespace>' |
    python3 -m json.tool | grep -E '"(id|label|iconKey|foreignSource|foreignID)"'
  ```

- **The kit:** `./topo.sh view show <name>` (one view, with the icon each node gets and why) and `./topo.sh icons`
  (every view of dev).

---

## 3. Where the icon of a node comes from

There is no script. The topology app asks `IconRepositoryManager.getSVGIconId` for the icon id of every vertex, each
time it sends the map. That method asks its *icon repositories*: one for each mapping file of part 1.2, and one for each
loaded GraphML view, which knows the iconKeys of its own nodes and answers each with itself. It asks them in no fixed
order and takes the answer of the first one that knows the key. The data it works from:

| Data | From |
|---|---|
| the vertex: namespace, id, icon key | the provider (part 2.2): the GraphML file; for Enhanced Linkd the node's sysObjectID in the database |
| the mappings | the `...icons.*.cfg` files (part 1.2) |
| the drawings | the svg files (part 1.1); the browser draws `<use href="#<icon id>">` |

The steps, for one vertex:

1. **A line for this one vertex:** `<namespace>.<vertex id>` in any mapping file, such as `das-demo.nimbus-2 = helix`.
   No GraphML view knows such a key, so this line always wins.
2. **Its icon key.**
   - *GraphML view:* the view knows its own icon keys and answers with the key itself, unchanged. So in a GraphML view
     **the iconKey is the icon id**; it is never shortened.
   - *Other views:* a line for the key in a mapping file; if there is none, the key without its last `.part`, and so on:
     `linkd.system.snmp.1.3.6.1.4.1.99999.1.4`, then `linkd.system.snmp.1.3.6.1.4.1.99999.1`, ... `linkd.system`,
     `linkd`, then step 3.
3. **`default`**: `default = generic` in `...icons.default.cfg`.

Then the browser looks for an element with that id in the svg files; if there is none, the node has no icon (only its
frame and label). `./topo.sh view show` and `./topo.sh icons` flag such nodes.

### Exercise 1: follow nimbus-2 of "DAS demo"

```bash
./topo.sh view show das-demo
# namespace das-demo ... nimbus-2  nimbus-2  nimbus  nimbus (its iconKey)
podman exec onms-dev-core grep -c 'das-demo.nimbus-2' /opt/opennms/etc/org.opennms.features.topology.app.icons.default.cfg
# 0: no line for this vertex (step 1), so its iconKey "nimbus" is the icon id (step 2)
podman exec onms-dev-core sh -c 'grep -l "id=\"nimbus\"" /opt/opennms/jetty-webapps/opennms/svg/*.svg'
# the svg file that has the drawing
```

On the page (View > DAS demo), press F12, Elements, press Ctrl+F and search for `href="#nimbus"`: each nimbus node
has `<use class="upIcon" href="#nimbus">`.

### Exercise 2: another icon for one node, by hand

```bash
C=onms-dev-core
F=/usr/share/opennms/etc/org.opennms.features.topology.app.icons.default.cfg
podman exec $C cat $F > icons.default.cfg.orig                 # your way back
podman exec $C sh -c "echo 'das-demo.nimbus-2 = helix' >> $F"  # step 1 for nimbus-2
```

Reload the page: nimbus-2 shows the helix icon, nimbus-1 still the nimbus icon. Back to before:

```bash
podman exec -i $C sh -c "cat > $F.new && mv $F.new $F" < icons.default.cfg.orig
```

The same for a node of production's view Maven-abc (after part 0): `./topo.sh view show Maven-abc` prints its namespace
and node ids; `./topo.sh view icon Maven-abc <node id> helix` writes the line for you in `opennms/` and deploys it to
dev (`--reset` takes it out). In OpenNMS UI Studio: Topology, click the node, *Another icon for this node*.

### Exercise 3: change the iconKey of a GraphML node, by hand

```bash
C=onms-dev-core
podman exec $C cat /opt/opennms/etc/graphml/das-demo.xml > das-demo.xml
cp das-demo.xml das-demo.xml.orig
sed -i '/<node id="nimbus-1">/s#<data key="iconKey">[^<]*</data>#<data key="iconKey">helix</data>#' das-demo.xml
diff das-demo.xml.orig das-demo.xml                             # one line: nimbus-1 has the iconKey helix
curl -sS -u admin:admin -X DELETE http://localhost:8980/opennms/rest/graphml/das-demo
sleep 5
curl -sS -u admin:admin -X POST -H 'Content-Type: application/xml' --data-binary @das-demo.xml http://localhost:8980/opennms/rest/graphml/das-demo
```

Reload the page: nimbus-1 shows the helix icon. Back: the same DELETE and POST with `das-demo.xml.orig`, or
`./dev.sh seed`. (In "DAS demo" each node is one line of the file; that is what lets the `sed` address one node.)

### Exercise 4: Enhanced Linkd, every node of one model

The seed gave each demo type a model number: nimbus nodes have the sysObjectID `.1.3.6.1.4.1.99999.1.4` (99999 is a
placeholder enterprise number), so Enhanced Linkd gives them the icon key `linkd.system.snmp.1.3.6.1.4.1.99999.1.4`.
Check the exact key first: the Info panel of the node (Technical Details), or `./topo.sh icons`, which lists every
Enhanced Linkd node with its key.

```bash
C=onms-dev-core
F=/usr/share/opennms/etc/org.opennms.features.topology.app.icons.linkd.cfg
podman exec $C cat $F > icons.linkd.cfg.orig
podman exec $C sh -c "echo 'linkd.system.snmp.1.3.6.1.4.1.99999.1.4 = nimbus' >> $F"
```

View > Enhanced Linkd: nimbus-1 and nimbus-2 show the nimbus icon, and so would every future node of that model. Back:
`podman exec -i $C sh -c "cat > $F.new && mv $F.new $F" < icons.linkd.cfg.orig`.

### Exercise 5: Change Icon, and what it writes

View > Enhanced Linkd, right-click nimbus-1 > Change Icon, pick an icon. Then:

```bash
podman exec onms-dev-core cat /opt/opennms/etc/org.opennms.features.topology.app.icons.linkd.cfg
```

A line `nodes.<node id> = <icon>` was added, and the whole file was written again: its comments are gone, the lines are
in another order, and the first line is a date. Right-click > Reset Icon takes the line out.

---

## 4. Icons by node type

OpenNMS has no setting "nodes of type X get icon Y". What it has depends on the view:

| View | How the type of a node picks its icon |
|---|---|
| GraphML | the program that writes the view puts the icon id into each node's `iconKey`: the decision is made there (4.1, 4.2) |
| Enhanced Linkd | the model: one line for a sysObjectID, or a shorter one for all models of a vendor (4.3) |
| every view | a line for one node, which wins over everything (part 3, step 1) |

### 4.1 GraphML: the iconKey is the type, and the icon has its name

Production's views give their nodes the type of the device as iconKey: `orion`, `helix`, `nimbus`, ...
(`./topo.sh view show Maven-abc` lists them). Since the iconKey of a GraphML node is the icon id, every node of a type
shows the icon whose id is the type, with no line per node, when an svg file has that icon, laid out as in part 1.1:
`nimbus`, `nimbus_rollover` and `nimbus_active` next to each other. That is the whole mapping: one svg icon per type,
named like the type. `./topo.sh view show` flags an iconKey that no svg file defines ("no svg file defines "helix": no
icon; similar ids: das_helix").

When a type and its icon have different names (iconKey `helix`, icon `das_helix`), make them match in one place:

- rename the icon in its svg file: `das_helix` to `helix`, `das_helix_rollover` to `helix_rollover`, `das_helix_active`
  to `helix_active` (and `das_helix_icon` to `helix_icon`); or
- let the program that writes the view put the icon id into `iconKey`.

**What does not work reliably:** a line for the type in a mapping file, such as `helix = das_helix`. The view itself
also knows the key `helix` and answers with `helix`, and OpenNMS asks the two in no fixed order: it may work today and
not after a restart or a reload of the view. `./topo.sh view show` and `./topo.sh icons` warn about such lines.

### 4.2 A view whose icons follow the node type, made from a requisition

The kit makes such a view from any requisition of dev:

```bash
cat icon-types.cfg                         # node type = icon id
./topo.sh view from-requisition DAS-Demo   # View > "DAS-Demo: icons by node type"
./topo.sh view from-requisition abc        # a requisition that ./dev.sh copy-prod brought (one of production's)
```

(The names of dev's requisitions: `podman exec onms-dev-core ls /opt/opennms/etc/imports`; a wrong name lists them.)

`icon-types.cfg` is the mapping by type, in one place:

```properties
orion = orion
helix = helix
stratus = stratus
nimbus = nimbus
```

For each node of the requisition, `view from-requisition` finds the type: the first of its categories (`<category
name="Nimbus"/>` in the requisition) that the table names, else its asset field `category` or `modelNumber`, else the
word its label starts with (`nimbus-2`: nimbus). It writes the icon of that type as the node's iconKey, links the node to
its OpenNMS node by foreign source and foreign id, draws it under its parent node, and adds the view to `opennms/` and
dev with `./topo.sh view add`. It prints what it decided, for example:

```text
  requisition DAS-Demo: 6 nodes, 5 links to a parent
  node label                   foreign id           type (from)                    icon (iconKey)
  orion-1                      orion-1              orion (category Orion)         orion
  nimbus-2                     nimbus-2             nimbus (category Nimbus)       nimbus
```

A node without a type gets the default icon; a type whose icon no svg file has gets an icon named like it
(`das_nimbus`), else the default icon, and the output says so.

Try it: change the line to `nimbus = helix`, run `./topo.sh view from-requisition DAS-Demo` again and reload the page:
every Nimbus node shows the helix icon, from one line. Put it back afterwards. The view is in `opennms/`, so
`./topo.sh deploy prod` would take it to production too; `./topo.sh view remove types-DAS-Demo` takes it away.

This is also how the software that writes production's views should decide: look up the type of each node in one
table and write the icon id as iconKey. `opennms/etc/graphml/types-DAS-Demo.xml` shows the result:

```xml
<node id="nimbus-2"><data key="label">nimbus-2</data><data key="iconKey">nimbus</data><data key="foreignSource">DAS-Demo</data><data key="foreignID">nimbus-2</data><data key="level">2</data><data key="tooltipText">Categories: Nimbus</data></node>
```

### 4.3 Enhanced Linkd: one line per model

In Enhanced Linkd the icon key is the model (exercise 4), and the key is shortened until a line matches. So one line
per model does what you want, and a shorter key covers all models of an enterprise:

```properties
# etc/org.opennms.features.topology.app.icons.linkd.cfg
# this model:
linkd.system.snmp.1.3.6.1.4.1.99999.1.4 = nimbus
# every other model of enterprise 99999:
linkd.system.snmp.1.3.6.1.4.1.99999 = orion
```

(A comment needs a line of its own: in a properties file, `#` after a value is part of the value.)

A node's sysObjectID is in the Info panel (Technical Details, the icon key) and in REST:
`curl -s -u admin:admin -H 'Accept: application/json' http://localhost:8980/opennms/rest/nodes/DAS-Demo:nimbus-2 | python3 -m json.tool | grep sysObjectId`.
For real devices it comes from their SNMP agent; a node without SNMP gets `linkd.system`, and all such nodes share it.

### 4.4 Exceptions for single nodes

A line `<namespace>.<node id> = <icon id>` wins over the type in every view (part 3, step 1). Use it for the one device
that should look different, not for a whole type.

---

## 5. On production

### 5.1 The same commands, over ssh

```bash
ssh maven-admin@192.168.0.36 podman exec opennms ls -l /opt/opennms/etc/graphml /opt/opennms/etc/imports
ssh maven-admin@192.168.0.36 podman exec opennms cat /opt/opennms/etc/org.opennms.features.topology.app.icons.default.cfg > prod-icons.default.cfg
curl -sS -u admin http://192.168.0.36:8980/opennms/rest/requisitions/abc       # curl asks for your password
```

Or log in (`ssh maven-admin@192.168.0.36`) and use the commands of parts 1 to 3 with the container `opennms` and the
address `http://192.168.0.36:8980/opennms`.

### 5.2 What lasts there

| Files | On production | So |
|---|---|---|
| `etc/` (mappings, Change Icon list, views, requisitions) | on the volume `opennms_data-config` | a change lasts through restarts and new containers |
| `jetty-webapps/opennms/svg/*.svg` | in the container: from the image, and from the overlay folder `/opt/maven-nms/data/overlays/jetty-webapps-overlay`, which the image copies in at every start | change the container's file and the overlay copy, or a start (or a new container) brings the old file back: `./topo.sh deploy prod` and the studio's Apply do both, with a backup and an undo |
| GraphML views that your software writes | written again whenever it wants | change the software (part 4.1), or use lines for single nodes, which live in a mapping file the software does not touch |

Before you change a file on production by hand, keep a copy (`... cat <file> > <copy>`, as in 5.1), and prefer the
kit's `./topo.sh deploy prod` or the studio's Apply: they keep backups and can undo.

### 5.3 Production's SNMP settings on dev

Dev scans the copied nodes with its own `etc/snmp-config.xml`. If your devices answer SNMP only to production's community
(the file holds it, so treat the copy with care):

```bash
ssh maven-admin@192.168.0.36 podman exec opennms cat /opt/opennms/etc/snmp-config.xml > snmp-config.xml
podman exec onms-dev-core cat /opt/opennms/etc/snmp-config.xml > snmp-config.xml.dev-orig
podman exec -i onms-dev-core sh -c 'cat > /usr/share/opennms/etc/snmp-config.xml' < snmp-config.xml
podman restart onms-dev-core      # every part of OpenNMS reads it at start (wait a few minutes: ./dev.sh status)
curl -sS -u admin:admin -X PUT http://localhost:8980/opennms/rest/requisitions/abc/import   # scans the nodes of abc again
```

(An import without `?rescanExisting=false` scans the nodes that are there already, too.)

---

## 6. When something is not as expected

| What you see | Why | What to do |
|---|---|---|
| a node has no icon, only its frame | its icon id (iconKey, or a mapping line) is no id of any svg file | `./topo.sh view show <view>` names it and similar ids; fix the iconKey, the line, or the svg (4.1) |
| the nimbus nodes always look selected (light blue), and CSS for `#nimbus_default` changes nothing | `nimbus.svg` keeps its three looks inside `#nimbus` | repair it (1.1) |
| a line `<namespace>.<node id> = ...` does nothing | wrong namespace or node id, a colon without a backslash, or a file with a new name | `./topo.sh view show <view>` reports lines that name no node; use a file of the table in 1.2 |
| a line `<type> = <icon>` works for GraphML nodes now and then | the view answers for its own iconKeys too, in no fixed order with the mapping files | change the iconKey or the svg ids instead (4.1) |
| a GraphML view shows no alarm colours | no `vertex-status-provider` in the file, or its nodes did not exist when it was loaded, or it links by production's `nodeID` | `./topo.sh view reload`; the report of `./dev.sh copy-prod` (2.4) |
| a view is not in the View menu | its cfg file is missing, or OpenNMS could not read the xml | `./topo.sh view list`; `./dev.sh logs` (karaf.log) names the error |
| `./dev.sh copy-prod`: "dev has 3 of 9 node(s) after 240 s" | provisiond is still importing or scanning | it goes on in the background: `./dev.sh status` counts the nodes, `./dev.sh logs provisiond.log` shows the import |
| `./dev.sh copy-prod`: the views did not come along | `opennms/` holds changes that production does not have | deploy, revert or `FORCE=1 ./topo.sh pull`, then copy again (part 0) |
| no Change Icon for a GraphML node | OpenNMS does not offer it for GraphML views | a line for the node (exercise 2) or the iconKey (exercise 3) |
| a new svg file does not show | the open tab keeps the list of svg files it got | open the topology page in a new tab |

---

## 7. Sources

OpenNMS 33.1.8 source, at https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ followed by the path:

| File | What it shows |
|---|---|
| [`features/topology-map/org.opennms.features.topology.app/.../internal/support/IconRepositoryManager.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/support/IconRepositoryManager.java) | `getSVGIconId`: the vertex line, then the icon key, shortened at its last dot, then `default`; the repositories are a set, asked in no fixed order |
| [`.../plugins/topo/graphml/internal/GraphMLIconRepository.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.graphml/src/main/java/org/opennms/features/topology/plugins/topo/graphml/internal/GraphMLIconRepository.java) | a view knows its own icon keys (`contains`) and answers each with itself (`getSVGIconId` returns the key) |
| [`.../plugins/topo/graphml/internal/GraphMLMetaTopologyFactory.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.graphml/src/main/java/org/opennms/features/topology/plugins/topo/graphml/internal/GraphMLMetaTopologyFactory.java) | a view per cfg file (`topologyLocation`, `label`); "Updating is not supported"; one icon repository per view |
| [`.../plugins/topo/graphml/GraphMLTopologyProvider.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.graphml/src/main/java/org/opennms/features/topology/plugins/topo/graphml/GraphMLTopologyProvider.java) | `setNodeIdForVertex`: a node without `nodeID` is looked up by foreign source and foreign id when the view is loaded |
| [`.../plugins/topo/graphml/GraphMLVertex.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/plugins/org.opennms.features.topology.plugins.topo.graphml/src/main/java/org/opennms/features/topology/plugins/topo/graphml/GraphMLVertex.java) | the node properties a view reads: iconKey, label, nodeID, level, tooltipText, ... |

OpenNMS documentation: [Topology Map](https://docs.opennms.com/horizon/33/operation/deep-dive/topology/topology.html)
(icon keys, mapping files, the layout of an svg icon), [GraphML](https://docs.opennms.com/horizon/33/development/topology/graphml.html)
(the properties of a view, the REST calls) and [Requisitions REST API](https://docs.opennms.com/horizon/33/development/rest/requisitions.html).
In this kit: FILES.md (sections 1 to 5), `tools/svgicons.py` (which ids are icons), `tools/graphml.py` (views),
`tools/prodcopy.py` (`./dev.sh copy-prod`). OpenNMS UI Studio: `docs/opennms-topology.md`, part 4.1 (the nimbus case).
