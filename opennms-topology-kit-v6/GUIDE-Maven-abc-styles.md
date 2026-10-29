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
| the colours of the parts of one icon, its frame, background, size, sharpness, its labels | rules in `styles/topology.css` that name the icon: `./topo.sh css <icon id>` prints them | every node drawn with that icon, in every view; the svg file stays as it is | 7 |
| labels, tooltips, layout or zoom level of the view | `opennms/etc/graphml/Maven-abc.xml` | this view, until production writes the file again | 8 |

The CSS cannot pick out this one view: OpenNMS 33.1.8 draws every node as `<g class="vertex">` and every link as
`<path class="edge ...">`, with nothing that names the view. (It ignores the GraphML `styleName` of a node and reads
none for a link.) The page shows one view at a time, so the CSS changes what you see in Maven-abc, and in the other
views too. It can pick out the nodes drawn with one icon, and the parts of one icon (step 7).

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

4. **The kit, version 3.8 or later** (it goes over version 3.7; with 3.6 or older, unpack the 3.7 update first). Copy
   the update archive from the computer with the browser to the development machine, for example with
   `scp opennms-topology-kit-v3.8-update.tar.gz admin@192.168.0.47:` on that computer. Then, on the development
   machine, unpack it over the kit folder:

   ```bash
   tar xzf ~/opennms-topology-kit-v3.8-update.tar.gz -C ~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6
   chmod +x dev.sh topo.sh examples/*.sh   # only if "Permission denied"
   ```

   It replaces a few kit files and adds this guide. Your `opennms/`, `styles/`, `backups/` and `kit.env` stay as
   they are. Check: `./topo.sh css` lists the svg files of `opennms/`.

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

Put your rules into `styles/topology.css` and save; `watch` deploys them. The kit puts the file into OpenNMS as
`jetty-webapps/opennms/svg/zz-topology-styles.svg`, a small svg file that holds your rules in a `<style>` block.
OpenNMS puts every svg file of that folder into the topology page, so the rules apply there.

### 6.1 Seeing a change: a new tab once, then the cache off

Two things in OpenNMS decide when the browser shows a changed svg file, and your CSS is one:

1. **A new svg file needs a new tab.** A browser tab reads the list of svg files when it opens the topology page,
   and keeps that list when you reload it: OpenNMS keeps the state of the page between reloads (`@PreserveOnRefresh`
   on `TopologyUI`). After the first deploy of `zz-topology-styles.svg` to dev, and after the first one to production,
   open the topology page **in a new tab** (Ctrl+T, then the address). F5 does not do it, and the Topology link in a
   tab that showed the topology before may not either: that tab remembers its page. Logging out of OpenNMS and in
   again, or a private window, gives a new page too. Development and production are two OpenNMS: do it for each.
   Kit 3.6 gave this file a new name at every change, so a tab that was already open never saw your rules: that is
   why this step did nothing for you. Kit 3.7 keeps one name.
2. **A changed svg file needs the cache off.** OpenNMS sends svg files with `Cache-Control: max-age=3600`, so the
   browser keeps each one for an hour. Ctrl+Shift+R is not enough: the page asks for its svg files after it has
   loaded, and Chrome skips its cache only for what a page asks for while it loads. While you work on styles, open
   the developer tools (F12), tick **Network > Disable cache**, keep the developer tools open and reload normally.
   (With them open, right-click on the reload button > *Empty cache and hard reload* does it once.)

After each deploy, `./topo.sh` tells you which one applies: "New there: ..." or "reload with the cache off".

### 6.2 Check that your CSS is there

```bash
./topo.sh css            # the svg files, their clashing style rules, and whether dev has your styles/topology.css
./topo.sh css prod       # the same for production
```

Each of them also asks the web server of that OpenNMS for `zz-topology-styles.svg`, the way a browser does, and says
the answer: 200, the type, the size, the cache header, and whether it is the text your `styles/topology.css` gives. It
lists the svg files that differ between that OpenNMS and `opennms/`, for example a second `das-topology.<other
hash>.svg` that production got after your pull, and the rules of the svg files that style the page itself (nodes,
links, labels) and so compete with yours.

**Which version of your CSS has this page?** Put a line with only this comment into `styles/topology.css`:

```css
/* mark */
```

and deploy (`watch` does). A small yellow label at the bottom left of the topology page reads, for example, `topology.css bb72b1`: the
first 6 characters of the md5 of your file, which `./topo.sh css` prints too. No label: that page did not load the file
(a new tab, step 6.1). Other characters: that page has an older copy (the cache, step 6.1). Delete the line when you
are done; the label goes with the next deploy.

In the browser, http://192.168.0.47:8980/opennms/svg/zz-topology-styles.svg is an empty page whose source (Ctrl+U)
shows your rules. On the topology page: F12 > Elements, Ctrl+F `zz-topology-styles`. The file sits in the `<defs>` of
the map as `<svg width="0" height="0">` with your `<style>`. Select a node's `<use class="upIcon">`: the Styles pane
lists the rules that apply to it. F12 > Network, filter `svg`, shows which svg files the page asked for and the answer
(200, or `(disk cache)`).

### 6.3 Rules for every node and link

To win over a rule of the stock stylesheet (`reference/topo_default-styles.css`, for reading), start the selector
with `svg` and name at least the classes that the stock rule names: the stock `.edge.normal` beats `svg path.edge`,
but `svg path.edge.normal` beats `.edge.normal`.

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
Linkd links do). Scripts in `/opt/opennms/etc/graphml-edge-status/` could give a link another severity or set its
stroke directly, but on your production that folder lists nothing (you checked:
`ssh maven-admin@192.168.0.36 podman exec opennms ls /opt/opennms/etc/graphml-edge-status`), so every link of
Maven-abc is `edge normal` and the rules above reach all of them.

Examples 07, 08 and 09 (`./topo.sh example`) show more rules, and FILES.md, section 6, lists the elements and classes
OpenNMS draws.

### 6.4 The styles show on dev but not on production

The two OpenNMS are separate: a new tab, the cache and the file are each their own, so what you did for dev is not
done for production. In this order:

1. `./topo.sh css prod` must say *"has it, as in styles/topology.css"* and that the web server answers *200 ... the text
   that styles/topology.css gives*. If not: `./topo.sh deploy prod`.
2. Open a **private window** (Ctrl+Shift+N in Chrome and Edge, Ctrl+Shift+P in Firefox), log in to
   http://192.168.0.36:8980/opennms and open the topology page. A private window starts with no cache and a new
   session, so it loads the file list and the CSS as they are now.
3. Styles show there, not in your normal window: that window's tab or cache is old. Close every tab of the production
   topology, open a new tab, press F12 and tick Network > Disable cache (step 6.1).
4. No styles in the private window either: put the `/* mark */` line into `styles/topology.css`, run
   `./topo.sh deploy prod` and open production in a new private window.
   - *No label*: the page did not get the file. F12 > Network, reload, filter `svg`: is `zz-topology-styles.svg` among the
     requests, and with which status? Something other than 200 (or `(disk cache)`): `./topo.sh css prod` shows what the
     web server answers. Not asked for at all, in a window that is new: OpenNMS's list of svg files does not hold it;
     `./topo.sh css prod` shows whether the container's svg folder has it.
   - *The label, but a rule does nothing*: another rule wins on that page. F12 > Elements, select the element (the
     `<text class="vertex-label">` of a node, a `<path class="edge normal">`); the Styles pane shows the winning rule and
     which `<style>` it comes from. `./topo.sh css` lists the rules of the svg files that style the page
     (`das-topology...svg`): make your selector more specific (start with `svg`, name more classes) or add `!important`.
     When two rules have the same weight (the same `!important`, the same selector weight), the svg file that reached the
     page last wins, and that order can be another one on production than on dev: a rule that won on dev can lose
     there. More classes in the selector, or `!important` on your side, decide it the same way on both.

## 7. The look of one icon, without changing its svg file

### 7.1 What the page holds

OpenNMS puts each svg file whole into the `<defs>` of the map, where nothing is drawn, and draws each node with
copies of one drawing of it (`D3.injectSVGDef`, `GWTVertex`):

```text
<svg>                                                       the map
  <defs>
    <svg viewBox="0 0 478.53 140.57">                       an icon file, whole
      <style> .cls-1 { fill: #d1d3d4; } ... </style>        applies to the whole page, not only to this file
      <g id="das_nimbus"> <rect class="cls-1" .../> ...     one drawing; its id is the icon id
    <svg width="0" height="0"> <style> ... </style>         zz-topology-styles.svg: your styles/topology.css
  <g class="vertex">                                        one node drawn with das_nimbus
    <rect class="status normal">                            its frame, and the background behind the drawing
    <g class="icon-container" transform="... scale(0.1)">   the drawing, shrunk to 48 px
      <use class="upIcon" xlink:href="#das_nimbus">         a copy of the drawing
      <use class="overIcon" xlink:href="#das_nimbus_rollover">   over it while the mouse is on the node
      <use class="activeIcon" xlink:href="#das_nimbus_active">   over it while the node is selected
    <text class="vertex-label">home lab 1</text>
```

So there is no `svg.nimbus` element for each node. What you would write as `svg.nimbus` is one of two selectors:

| You mean | Selector | For |
|---|---|---|
| a part of the drawing, such as its `.cls-1` shapes | `#das_nimbus .cls-1` | `fill`, `stroke`, `opacity` of that part, in every node drawn with das_nimbus |
| the whole node | `svg .vertex:has(use.upIcon[*\|href="#das_nimbus"])`, followed by `> rect.status`, `> .icon-container` or `> text.vertex-label` | frame, background, size, filters, label |

The selectors name the icon id, not the file name: `./topo.sh icons` lists the ids of each file, and
`./topo.sh view show Maven-abc` the icon of each node (nodes 11 and 14 have das_nimbus since step 5). `:has()` needs
Chrome or Edge 105, or Firefox 121, or later.

### 7.2 The colours of its parts

```bash
./topo.sh css das_nimbus        # or the file: ./topo.sh css nimbus.svg
```

This prints the rules of the file's `<style>` block (and its `fill="..."` attributes) for that icon only, one block
for each drawing: as it normally shows, under the mouse (`_rollover`) and when selected (`_active`). For a file with
the classes of the nimbus.svg you showed, it looks like this (shortened):

```css
/* das_nimbus as it normally shows: <use class="upIcon" xlink:href="#das_nimbus"> */
#das_nimbus .cls-1 { fill: #d1d3d4; }
#das_nimbus .cls-2 { fill: #bcbec0; }
#das_nimbus .cls-3 { fill: #fff; }

/* das_nimbus under the mouse: <use class="overIcon" xlink:href="#das_nimbus_rollover"> */
#das_nimbus_rollover .rollover-cls-3 { fill: #249376; }
#das_nimbus_rollover .rollover-cls-4 { fill: #3eb397; }
```

It also warns about a file that OpenNMS cannot draw as intended, for example a normal drawing that holds its
`_rollover` and `_active` drawings (all three show at once), or a `_default` group (OpenNMS never draws one).

Copy the lines you want into `styles/topology.css` and change the values. The same colours as in the file change
nothing, so you can also append the whole output and edit there: `./topo.sh css das_nimbus >> styles/topology.css`.

```css
#das_nimbus .cls-1 { fill: #1F3A5F; }                     /* the body: dark blue */
#das_nimbus .cls-2 { fill: #DCE6F2; }
#das_nimbus_rollover .rollover-cls-3 { fill: #F28C28; }   /* orange under the mouse */
#das_nimbus_active .active-cls-3 { fill: #F28C28; }       /* and when selected */
```

**Why the id in front.** The `<style>` block of every svg file applies to the whole page. Files exported from
Illustrator all call their classes `.cls-1`, `.cls-2`, ..., so the `.cls-1` rule of the file that the browser loads
last colours the `.cls-1` parts of every icon, and that order can change from one page load to the next.
`#das_nimbus .cls-1` holds an id, so it wins over every `.cls-1` rule in any order, and touches no other icon.
`./topo.sh css` (without a file) lists the class rules that your svg files define differently.

The svg file itself stays as it is. An svg file you changed, such as nimbus.svg with your version of example 05, goes
back to production's version with `./topo.sh revert opennms/jetty-webapps/opennms/svg/nimbus.svg`.

### 7.3 Frame, background, size and edges: "svg.nimbus { border: 2px solid }"

An SVG drawing has no CSS box, so `border`, `background` and `padding` do nothing on it. The frame that OpenNMS draws
around each node, `rect.status`, does that job: its `stroke` is the border, and its `fill` is the background behind
the transparent parts of the drawing. OpenNMS paints both in the alarm colour; that is the green you see in dev.

```css
/* "border: 2px solid" with round corners, and a white background */
svg .vertex:has(use.upIcon[*|href="#das_nimbus"]) > rect.status {
  stroke-width: 2px;   /* the border; OpenNMS draws 5 px. Its colour stays the alarm colour */
  rx: 4px;             /* round corners */
  fill: #FFFFFF;       /* the background */
}
/* More for the same rule: stroke: #1F3A5F (one colour instead of the alarm colour), stroke-dasharray: 4 2 (dashed),
   filter: drop-shadow(0 2px 2px rgba(0, 0, 0, .4)) (a shadow under the frame) */

/* 25 % bigger, with its frame and mouse target; the label moves down */
svg .vertex:has(use.upIcon[*|href="#das_nimbus"]) > :is(.icon-container, rect.status, rect.svgIconOverlay) { scale: 1.25; }
svg .vertex:has(use.upIcon[*|href="#das_nimbus"]) > text.vertex-label { translate: 0 6px; font-weight: bold; fill: #1F3A5F; }

/* "sharpness": edges without smoothing, stronger colours */
svg .vertex:has(use.upIcon[*|href="#das_nimbus"]) > .icon-container { shape-rendering: crispEdges; filter: contrast(1.3) saturate(1.2); }

/* a 1 px line around every part of the drawing */
#das_nimbus :is(path, rect, circle, ellipse, polygon, polyline, line) { stroke: #1F3A5F; stroke-width: 1px; vector-effect: non-scaling-stroke; }
```

**Sharpness.** CSS has no sharpness property, and a drawing is sharp at any size. Nimbus looks soft because OpenNMS
shrinks its 478 x 141 units to 48 x 14 px. A bigger `scale` shows more of it. `shape-rendering: crispEdges` turns
off the smoothing of edges: straight edges get crisp, curves get small steps (`geometricPrecision` is the opposite).
`filter: contrast()` and `saturate()` make colours stronger. A bitmap inside an svg file (`<image>`) stays as sharp
as it is; `./topo.sh css` says when a file holds one.

**Units.** Lengths in rules for parts of the drawing (`#das_nimbus ...`), and the lengths of a filter on
`.icon-container`, are in units of the drawing, which OpenNMS shrinks with it: for nimbus about 10 units make 1 px.
`vector-effect: non-scaling-stroke` keeps a stroke in screen pixels. The frame and the label are in screen pixels.

**A frame in a view without alarm colours** (`status none` in `./topo.sh view show`): OpenNMS hides the frame there;
add `opacity: 1; stroke: #1F3A5F;` to the `rect.status` rule.

### 7.4 The alarm colour inside the drawing

A CSS variable passes into the copies of a drawing, so a part can take the colour of the node's alarm:

```css
#das_nimbus .cls-1 { fill: var(--alarm, #1F3A5F); }       /* dark blue, or the alarm colour set below */
svg .vertex:has(> rect.status.major) { --alarm: #FF3300; }
svg .vertex:has(> rect.status.critical) { --alarm: #CC0000; }
```

In dev every node of Maven-abc is `normal` (step 4). The demo view, View > DAS demo (GraphML), has a node with a
nodeDown alarm (nimbus-2).

### 7.5 Example 12 does all of this on one of your icons

```bash
./topo.sh example 12                    # das_nimbus, or the first icon whose id holds "nimbus"
ICON=das_helix ./topo.sh example 12     # another icon
```

It finds the colour that most parts of each drawing have and writes rules for that icon into `styles/topology.css`,
between `/* example: one icon: <icon id> */` and `/* end: one icon: <icon id> */`. Delete those lines to take it out.

### 7.6 Where each piece is, to check it by hand

| What | This machine | In OpenNMS (the container) | In the browser |
|---|---|---|---|
| your CSS | `styles/topology.css` | `/opt/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg` | http://192.168.0.47:8980/opennms/svg/zz-topology-styles.svg |
| an icon file | `opennms/jetty-webapps/opennms/svg/nimbus.svg` | `/opt/opennms/jetty-webapps/opennms/svg/nimbus.svg` | http://192.168.0.47:8980/opennms/svg/nimbus.svg |
| the stock stylesheet | `reference/topo_default-styles.css`, a copy | `VAADIN/themes/topo_default/styles.css` inside the theme jar that the first lines of the copy name | F12 > Sources |
| how long the browser keeps svg files | | `cacheControl` in `/opt/opennms/jetty-webapps/opennms/WEB-INF/web.xml` | F12 > Network > the file > Headers |

```bash
podman exec onms-dev-core cat /opt/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg     # dev
ssh maven-admin@192.168.0.36 podman exec opennms cat /opt/opennms/jetty-webapps/opennms/svg/zz-topology-styles.svg
curl -sI http://192.168.0.47:8980/opennms/svg/nimbus.svg | grep -i cache-control   # max-age=3600: one hour
```

To see the copy of a drawing inside a `<use>` in F12 > Elements: Settings (the gear) > Preferences > Elements >
*Show user agent shadow DOM*.

The OpenNMS source behind this, at tag `opennms-33.1.8-1` (your image is built from your own repository, which may
differ):

| File | What it does |
|---|---|
| [`IconRepositoryManager.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/support/IconRepositoryManager.java) | `getSVGIconFiles`: the list of svg files, made when a tab opens the page |
| [`TopologyUI.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/TopologyUI.java) | `@PreserveOnRefresh`: a reload keeps the page's state, that list included |
| [`D3.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/d3/D3.java) | `injectSVGDef`: each file, whole, into `<defs>` |
| [`GWTVertex.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/GWTVertex.java) | the elements of a node, and the scale to 48 px |
| [`styles.css`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/themes/default-theme/src/main/filtered/VAADIN/themes/topo_default/styles.css) | the stock rules: frames and links in the alarm colours |
| [`web.xml`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/opennms-webapp/src/main/webapp/WEB-INF/web.xml) | `cacheControl` `max-age=3600,public` for files such as the svg files |

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
4. Open **http://192.168.0.36:8980/opennms/topology** in a new tab and choose the view in the View menu. A new tab
   matters the first time `zz-topology-styles.svg` (or another new svg file) goes to production; after that, reload
   with the cache off (step 6.1). Other people see a changed svg file within an hour. Dev shows your styles and
   production does not: step 6.4.
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
| no rule of `styles/topology.css` does anything | the tab opened the page before `zz-topology-styles.svg` was there, and a reload keeps its list of svg files | open the page in a new tab (step 6.1); `./topo.sh css` says whether the file is there |
| a change of `styles/topology.css` or of an svg file does not show | the browser keeps svg files for an hour | reload with F12 > Network > Disable cache (step 6.1) |
| the styles show on dev, not on production | the production tab was opened before the file was there, the browser has an old copy, or a rule of the same weight in another svg file reached the page after yours | a private window, `./topo.sh css prod`, the `/* mark */` label (steps 6.2 and 6.4) |
| a CSS rule does nothing | a stock rule with more classes wins, or a rule for a part of a drawing does not name its id | name the classes of the stock rule, after `svg` (step 6.3); start a rule for a part with the drawing's id (`./topo.sh css <icon id>`, step 7.2); F12 shows which rule wins |
| an icon shows colours of another icon file | both files define `.cls-1` (or another class) differently, and the one loaded last wins | `./topo.sh css` lists such classes; rules with the id in front settle it (step 7.2) |
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
| `./topo.sh css`, `./topo.sh css prod` | the svg files, clashing style rules, the rules that style the page, and whether that OpenNMS has and serves your styles |
| `./topo.sh css <icon id or file.svg>` | CSS for the parts of one icon, to copy into `styles/topology.css` |
| `./topo.sh example 12` | one icon styled with CSS: colours, frame, background, size, edges |
| `./topo.sh watch` | deploy every save to dev |
| `./topo.sh diff`, `./topo.sh revert [file]` | what production does not have yet (since the last pull or deploy); drop it |
| `./topo.sh deploy prod`, `./topo.sh undo` | hot deploy to production; take the last deploy back |
