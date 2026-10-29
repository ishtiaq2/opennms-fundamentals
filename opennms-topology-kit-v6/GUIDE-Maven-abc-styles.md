# Restyle the "Maven-abc" view: work on dev, then hot deploy to production

This guide changes how the topology view **Maven-abc** looks. You work on the development OpenNMS (192.168.0.47),
see each change in the browser within seconds, and then copy the finished files into the running production OpenNMS
(192.168.0.36) without a restart. Run every command on the development machine as user `admin`, in the kit folder:

```bash
cd ~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6
```

| | |
|---|---|
| View menu label | MavenDAS: Home-Lab-_RPI3_OEBB_2222 Requisition: abc |
| View name (`./topo.sh view list`) | `Maven-abc` |
| Namespace (the first part of the name of each node in OpenNMS) | `Maven-abc`: `./topo.sh view show` prints it |
| Files in OpenNMS | `/opt/opennms/etc/graphml/Maven-abc.xml` (a GraphML file), plus two `.cfg` files that put it into the View menu |

## 0. What you can change, and where

Maven-abc is a GraphML view. Its file lists the nodes, the links between them and, for each node, the id of its icon
(`iconKey`). Its label (one view per requisition) suggests that production's own software writes this file, and may
write it again, for example when the requisition changes. So this guide changes the look *around* that file where it
can:

| You want | You change | It affects | Step |
|---|---|---|---|
| another icon for one node | `./topo.sh view icon Maven-abc <node id> <icon id>`: it writes a line in `opennms/etc/org.opennms.features.topology.app.icons.default.cfg` | that node in this view | 5 |
| icon size, labels, links, alarm frames | `styles/topology.css` | the whole topology page: every view | 6 |
| another look for one icon: a tint, grey, its labels | a rule in `styles/topology.css` that names the icon | every node drawn with that icon, in every view | 7 |
| exact colours of an icon | its file in `opennms/jetty-webapps/opennms/svg/` | every node drawn with that icon, in every view | 7 |
| labels, tooltips, layout or zoom level of the view | `opennms/etc/graphml/Maven-abc.xml` | this view, until production writes the file again | 8 |

The CSS cannot pick out this one view: OpenNMS 33.1.8 draws every node as `<g class="vertex">` and every link as
`<path class="edge ...">`, with nothing that names the view. (It ignores the GraphML `styleName` of a node and reads
none for a link.) The page shows one view at a time, so the CSS changes what you see in Maven-abc, and in the other
views too. It can pick out the nodes drawn with one icon (step 7).

## 1. Set up the development machine (once)

Skip what you have done already.

1. **VirtualBox** (VM shut down): Base Memory 4096 MB or more, 2 CPUs, Network > Adapter 1 > Bridged Adapter.
2. **Podman:** `sudo dnf install -y podman`
3. **A key to log in to production without a password:**

   ```bash
   ssh-keygen -t ed25519                      # press Enter at every question
   ssh-copy-id maven-admin@192.168.0.36
   ssh maven-admin@192.168.0.36 podman ps     # lists the production containers: it works
   ```

4. **The kit, version 3.6 or later** (it goes over version 3.5, 3.4, ... of the kit). Copy the update archive from the
   computer with the browser to the development machine, for example with
   `scp opennms-topology-kit-v3.6-update.tar.gz admin@192.168.0.47:` on that computer. Then, on the development
   machine, unpack it over the kit folder:

   ```bash
   tar xzf ~/opennms-topology-kit-v3.6-update.tar.gz -C ~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6
   chmod +x dev.sh topo.sh   # only if "Permission denied"
   ```

   It replaces a few kit files and adds this guide. Your `opennms/`, `styles/`, `backups/` and `kit.env` stay as
   they are. Check: `./topo.sh view icon` answers with a line that starts `usage: ./topo.sh view icon`.

## 2. Start the development OpenNMS

```bash
./dev.sh up
```

The first start takes 5-10 minutes; later starts take 1-3. It ends with these lines:

```text
Login at http://192.168.0.47:8980/opennms: works (admin gets /opennms/...).
Development OpenNMS: http://192.168.0.47:8980/opennms/topology   (user admin, password admin)
```

On your other computer, open **http://192.168.0.47:8980/opennms/topology** and log in as admin / admin. OpenNMS may ask
you to change the default password. If you change it, put the new one into `kit.env` as `DEV_PASSWORD`, because the kit
logs in with it. `./dev.sh status` shows the state at any time.

## 3. Copy production's topology files

```bash
./topo.sh pull
```

This copies production's icon mappings, svg icons and GraphML views into the folder `opennms/` (and keeps a copy in
`.kit/baseline/` to compare against later), then deploys them to dev. Check that Maven-abc came along:

```bash
./topo.sh view list         # Maven-abc ... (also in opennms/)
./topo.sh view list prod    # the same view in production
```

If you pulled before, you can skip this step. If `./topo.sh pull` lists files with changes that production does not
have, deploy them (step 10), drop them with `./topo.sh revert`, or start over with `FORCE=1 ./topo.sh pull`.

## 4. Open the view and look at its data

In the browser, reload the topology page, open the **View** menu and choose
**MavenDAS: Home-Lab-_RPI3_OEBB_2222 Requisition: abc**.

Dev shows the nodes with their icons, labels and links, as production does. Every frame is green (status normal):
the nodes of requisition abc and their alarms are in production's database only, and production colours a frame by
the alarms of its node. View > DAS demo (GraphML) shows alarm colours on dev. If the view opens with one node only,
press **Increase Semantic Zoom Level** in the toolbar: each zoom level shows the nodes one link further away.

Now look at the view's data:

```bash
./topo.sh view show Maven-abc
```

```text
View Maven-abc in opennms/etc/graphml/Maven-abc.xml, with the icon mappings of opennms/etc:
View menu label: MavenDAS: Home-Lab-_RPI3_OEBB_2222 Requisition: abc
Layer "Maven-abc": namespace Maven-abc; 9 nodes, 2 links; layout D3 Layout, focus ALL, zoom level 1, status default
  node id          label                        iconKey              icon drawn
  273458025999882  Home-Lab-_RPI3_OEBB_2222     maven_site           maven_site (its iconKey)
  6                home lab 1                   orion                orion (its iconKey)
  8                home lab 1                   cirrus               cirrus (its iconKey)
  9                home lab 1                   remote               remote (its iconKey)
  12               home lab 1                   remote               remote (its iconKey)
  10               home lab 1                   helix                helix (its iconKey) ! no svg file defines "helix": no icon; similar ids: das_helix
  11               home lab 1                   nimbus               nimbus (its iconKey) ! no svg file defines "nimbus": no icon; similar ids: das_nimbus
  13               home lab 1                   helix                helix (its iconKey) ! no svg file defines "helix": no icon; similar ids: das_helix
  14               home lab 1                   nimbus               nimbus (its iconKey) ! no svg file defines "nimbus": no icon; similar ids: das_nimbus
  Another icon for one node: ./topo.sh view icon Maven-abc <node id> <icon id>
  (it writes the line "Maven-abc.<node id> = <icon id>" in opennms/etc/org.opennms.features.topology.app.icons.default.cfg)
```

How to read it:

- The **namespace** (`Maven-abc`) and the **node id** name a node for OpenNMS: `Maven-abc.12` is node 12 of this view.
  Step 5 uses both; `./topo.sh view icon` takes the namespace from the file, so you only give the node id.
- "icon drawn" is the icon OpenNMS shows for the node, and why: a line for the node in an icon mapping file, else its
  iconKey, else the default icon.
- A "!" marks an icon id that no svg file defines. OpenNMS then draws nothing for that node: it has no icon, only a
  frame and a label. Here that is nodes 10, 13 (iconKey `helix`) and 11, 14 (`nimbus`). Production probably shows them
  without an icon too: look at its topology page. Step 5 gives them one. The "similar ids" are icons that exist
  (`./topo.sh icons` lists them all).
- `status default`: production colours each frame by the alarms of the node. `none` would mean no alarm colours at all.

From now on keep a **second terminal** open on the development machine, in the kit folder, with:

```bash
./topo.sh watch
```

It deploys every file you save in `opennms/` or `styles/` to dev within a second (a GraphML view file takes about 5
seconds). Then reload the topology page in the browser. Without `watch`, run `./topo.sh deploy dev` after each save.

## 5. Give a node another icon (this view only)

1. Choose the icon id. `./topo.sh icons` lists the icon ids of each svg file (of a big file the first few). The iconKey
   column of `./topo.sh view show Maven-abc` shows the icons this view uses now.
2. Give the node its icon, for example node 12 the icon of node 8 (`cirrus`):

   ```bash
   ./topo.sh view icon Maven-abc 12 cirrus
   ```

   ```text
   View Maven-abc:
     Node 12 (home lab 1) of the view Maven-abc: the icon remote -> cirrus
     opennms/etc/org.opennms.features.topology.app.icons.default.cfg: Maven-abc.12 = cirrus
   ```

   The command writes the line `Maven-abc.12 = cirrus` into `opennms/etc/org.opennms.features.topology.app.icons.default.cfg`
   and deploys it to dev. It refuses an icon id that no svg file defines (such as `helix`: the node would lose its
   icon) and a node id that the view does not have, and changes nothing then.
3. Reload the topology page: node 12 has the new icon.
4. Check: in `./topo.sh view show Maven-abc`, the row of node 12 says
   `cirrus (the line Maven-abc.12 in org.opennms.features.topology.app.icons.default.cfg)`.
   If `view show` also prints `! the line "maven\:abc.12" ... does nothing`, that line came from the first version of
   this guide, which used the namespace of an example. Delete it in an editor, or with:

   ```bash
   sed -i '/^maven\\:abc\./d' opennms/etc/org.opennms.features.topology.app.icons.default.cfg
   ```

   `watch` deploys the file again (without `watch`: `./topo.sh deploy dev`).
5. The four nodes without an icon (check with `./topo.sh icons` that `das_helix` and `das_nimbus` are listed):

   ```bash
   ./topo.sh view icon Maven-abc 10 das_helix
   ./topo.sh view icon Maven-abc 13 das_helix
   ./topo.sh view icon Maven-abc 11 das_nimbus
   ./topo.sh view icon Maven-abc 14 das_nimbus
   ```

6. Back to the icon of the view file: `./topo.sh view icon Maven-abc 12 --reset` takes the line out again.

**By hand.** The command only edits a line. You can write it yourself: open
`opennms/etc/org.opennms.features.topology.app.icons.default.cfg`, add `<namespace>.<node id> = <icon id>`, save
(`watch` deploys it). The namespace is the one on the `Layer` line of `./topo.sh view show Maven-abc`: `Maven-abc`.
**The namespace of an example is not yours**: a line whose namespace is not the view's changes nothing, silently.
`./topo.sh view show` names such a line ("does nothing: the namespace of this view is Maven-abc"). A colon in a
namespace needs a backslash (`maven\:abc.14`); `view show` and `view icon` spell the key that way.

OpenNMS looks for `<namespace>.<node id>` in every icon mapping file before it uses the node's `iconKey`
(`IconRepositoryManager.getSVGIconId`). So the line wins over the GraphML file, and it stays valid when production
writes Maven-abc.xml again, as long as the node ids stay the same. Right-click > Change Icon does not help here: for a
GraphML node it only works when a mapping file already holds the node's iconKey as a key, and usually none does.

## 6. Page styles: icon size, labels, links, alarm frames

Open `styles/topology.css`, add rules, save, and reload the page. The kit deploys this file as
`svg/zz-topology-styles.<hash>.svg`, under a new name for each change, so the browser never shows an old copy. To win
over a rule of the stock stylesheet (`reference/topo_default-styles.css`, for reading), start the selector with `svg`
and name at least the classes that the stock rule names: the stock `.edge.normal` beats `svg path.edge`, but
`svg path.edge.normal` beats `.edge.normal`.

```css
/* Icons 72 px instead of 48 px, with their frame; labels below them */
svg .vertex .icon-container, svg .vertex > rect.status, svg .vertex > rect.svgIconOverlay { scale: 1.5; }
svg .vertex > text.vertex-label { translate: 0 12px; }
svg .vertex > .status-badge-container, svg .vertex > .node-status-counter { translate: 12px -12px; }

/* Labels */
svg .vertex > text.vertex-label { font-size: 12px; font-weight: bold; fill: #1F3A5F; }

/* Links: colour and width (the width needs !important), selected and under the mouse */
svg path.edge, svg path.edge.normal { stroke: #1F3A5F; stroke-width: 4px !important; }
svg path.edge.selected { stroke: #F28C28; }
svg path.edge:hover { stroke: #2E7D32; }

/* Alarm frames behind the icons, by severity (only in a view with alarm colours: status in step 4) */
svg .vertex > rect.status.major, svg .vertex > rect.status.critical { stroke: #C62828; fill: #C62828; }
```

OpenNMS draws a link of a GraphML view as `<path class="edge normal">`: it never has the class `up` or `down` (Enhanced
Linkd links do). Scripts in production's `/opt/opennms/etc/graphml-edge-status/` can give a link another severity
(`edge major`, `edge critical`, ...) or set its `stroke`, `stroke-width`, `stroke-opacity` or `stroke-dasharray`
directly; such a value wins over a CSS rule without `!important`. This lists them (no such folder: no scripts):

```bash
ssh maven-admin@192.168.0.36 podman exec opennms ls /opt/opennms/etc/graphml-edge-status
```

Examples 07, 08 and 09 (`./topo.sh example`) show more rules, and FILES.md, section 6, lists the elements and classes
OpenNMS draws.

## 7. The look of one icon: a CSS rule, or its svg file

OpenNMS draws the icon of a node as `<use class="upIcon" xlink:href="#<icon id>">`, so a CSS rule can pick the nodes
drawn with one icon, in every view, and leave the svg files alone. Add rules like these to `styles/topology.css`, save
(`watch` deploys them) and reload the page:

```css
/* Every node drawn with das_helix: the icon tinted blue, and a blue label */
svg .vertex use.upIcon[*|href="#das_helix"] { filter: sepia(1) saturate(5) hue-rotate(180deg); }
svg .vertex:has(use.upIcon[*|href="#das_helix"]) > text.vertex-label { fill: #2E6AC7; }

/* Every node drawn with orion: in grey */
svg .vertex use.upIcon[*|href="#orion"] { filter: grayscale(1); }
```

`filter` changes the whole drawing of the icon: `sepia(1) saturate(5) hue-rotate(<angle>)` tints a grey icon (180deg
blue, 70deg green, 320deg red), and there are `brightness()`, `grayscale()`, `opacity()` and `drop-shadow()`. It cannot
set one exact colour of the drawing. `upIcon` is the icon as it normally shows; over it, OpenNMS shows `<id>_rollover`
under the mouse (`use.overIcon`) and `<id>_active` when the node is selected (`use.activeIcon`). With step 5 a node can
get an icon that no other node of the view has: the rules for that icon then style that one node.

**Exact colours (optional; this edits the svg file).** The colours of an icon are in its file in the svg folder:

```bash
grep -l 'id="das_helix_icon"' opennms/jetty-webapps/opennms/svg/*.svg                    # the file of das_helix
grep -oiE '#[0-9a-f]{6}|#[0-9a-f]{3}\b' opennms/jetty-webapps/opennms/svg/<file>.svg | sort | uniq -c   # its colours
sed -i 's/#505154/#1F3A5F/gI' opennms/jetty-webapps/opennms/svg/<file>.svg               # grey becomes dark blue
```

The `sed` line changes every icon of that file, in its three versions (`<id>`, `<id>_rollover`, `<id>_active`). If the
file colours its shapes through classes in a `<style>` block (`.st1 { fill: ... }`), those classes apply to the whole
page, so other files that use `.st1` change too (FILES.md, section 1). After an svg change press **Ctrl+Shift+R** on the
topology page: the browser keeps svg files in its cache, and a plain reload can show the old icon.

## 8. Change the view file itself (only if you must)

Labels, tooltips, the layout, the focus and the zoom level of the view live in `opennms/etc/graphml/Maven-abc.xml`.
**Production's software probably writes this file**: ask your team whether it writes it again. When it does, your
changes there are gone, and the next deploy will not overwrite its new version (step 10).

The file names each property in a `<key>` line, and the values sit in `<data key="...">` lines that use the key's
`id`, which may be `d0`, `d1`, ... For example, with `<key id="d5" for="graph" attr.name="preferred-layout" .../>`:

```xml
<data key="d5">Hierarchy Layout</data>         <!-- your view has D3 Layout; others: Circle Layout, Grid Layout, ... -->
```

Save the file; `watch` deploys it and OpenNMS loads the view anew: it leaves the View menu for about 5 seconds. Reload
the page after that. `./topo.sh view show Maven-abc` checks that the file still makes sense. FILES.md, section 5, lists
the properties of a GraphML view.

## 9. Check and undo on dev

```bash
./topo.sh diff                    # what production does not have yet: your changes since the last pull or deploy
./topo.sh view show Maven-abc     # the icon each node of the view gets now
./topo.sh view icon Maven-abc 12 --reset   # one node back to the icon of the view file
./topo.sh revert <file>           # one file back to production's version, and onto dev
./topo.sh revert                  # all of them
```

## 10. Hot deploy to production

1. Stop `./topo.sh watch` with Ctrl+C.
2. Look at what will go: `./topo.sh diff`
3. Deploy:

   ```bash
   ./topo.sh deploy prod
   ```

   It lists the files it will copy and what it will do in production's overlay folders (so a restart of production
   keeps your files), then asks `Go ahead? [y/N]`. Answer `y`. Nothing restarts. It also keeps production's old files
   in `backups/<date>-<time>/`. It sends only what production does not have yet, so you can change more and deploy
   again; `./topo.sh diff` is empty afterwards. Two messages you may see:
   - *"Production changed (or removed) these files after your last pull or deploy"*: for example production's software wrote
     Maven-abc.xml again. These files stay as production has them; your other changes go.
   - *"You and production both changed these files after your last pull or deploy, so they are held back"*: compare them
     (`./topo.sh view show Maven-abc prod` for the view); `FORCE=1 ./topo.sh deploy prod` sends yours anyway.
4. Open **http://192.168.0.36:8980/opennms/topology**, choose the view in the View menu and press **Ctrl+Shift+R** once.
5. If something is wrong: `./topo.sh undo` puts back what the last deploy replaced and removes what it added. Run it
   again to go one deploy further back.
6. To start from production's files again, for example after its software wrote Maven-abc.xml: `./topo.sh pull`
   makes production's current files (yours included) your new starting point.

## 11. When something is not as expected

| What you see | Why | What to do |
|---|---|---|
| a node without an icon | its icon id is in no svg file | `./topo.sh view show Maven-abc` marks it with "!"; choose an icon id from `./topo.sh icons` |
| a node with the generic icon | it has no iconKey and no mapping line | a mapping line (step 5) |
| a mapping line does nothing | its namespace is not the view's (for example the one of an example), a colon without a backslash, or another node id | `./topo.sh view show Maven-abc` names such a line ("does nothing: the namespace of this view is ..."); delete it and use `./topo.sh view icon` |
| the icon of a node does not change after a mapping line | the line is not the one for this node, or the page was not reloaded | `./topo.sh view show Maven-abc`: the row of the node must say `(the line Maven-abc.<id> in ...)`; then reload the page |
| an svg change does not show | the browser's cache | Ctrl+Shift+R |
| a CSS rule does nothing | a stock rule with more classes wins | name the classes of the stock rule, after `svg` (step 6); the browser's developer tools (F12) show which rule wins |
| the view is not in the View menu | its cfg file is missing, or it is being loaded anew (5 seconds) | `./topo.sh view list`; reload the page; `./dev.sh logs` names errors in the file |
| every frame is green in dev | the view's nodes and their alarms are in production's database only | look at alarm colours in View > DAS demo (GraphML) or on production |
| a production deploy skipped Maven-abc.xml | production wrote the file after your last pull or deploy | `./topo.sh pull`, then change it again if you still need to |
| `./dev.sh up` or the login fails | see README, "When something goes wrong" | `./dev.sh status` |

## 12. The commands of this guide

| Command | What it does |
|---|---|
| `./dev.sh up`, `./dev.sh status` | start the development OpenNMS; its state, nodes, health and a test login |
| `./topo.sh pull` | production's topology files into `opennms/`, and onto dev |
| `./topo.sh view list [prod]`, `./topo.sh view show Maven-abc [prod]` | the GraphML views; the nodes of one view and their icons |
| `./topo.sh view icon Maven-abc <node id> <icon id>` | another icon for one node (`--reset` instead of the icon id: back to the view file's) |
| `./topo.sh icons` | every icon id, by svg file, and the icon each node gets |
| `./topo.sh watch` | deploy every save to dev |
| `./topo.sh diff`, `./topo.sh revert [file]` | what production does not have yet (since the last pull or deploy); drop it |
| `./topo.sh deploy prod`, `./topo.sh undo` | hot deploy to production; take the last deploy back |
