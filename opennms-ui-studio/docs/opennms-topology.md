# How OpenNMS builds the topology page

OpenNMS Horizon 33.1.8, read from its source (tag `opennms-33.1.8-1`; part 6 links every file named here). Paths in
the container are below OpenNMS's home, `/usr/share/opennms` (`/opt/opennms` is a link to it).

This is the story of one page: what happens between typing `/opennms/topology` and seeing the map, which file decides
what, and why your CSS wins or loses. The topology kit's catalogue, `kit/FILES.md`, lists every file with an example
for each; read this first and that one when you need a detail.

## Part 1: From the address to the picture

```
browser                                              OpenNMS (Jetty and Karaf in one Java process)
  GET /opennms/topology  ──────────────────────────► TopologyUI (Vaadin): one per browser tab
                                                       TopologyComponent: lists jetty-webapps/opennms/svg/*.svg
  ◄──── state: SVGDefFiles [/opennms/svg/a.svg, ...], nodes, links, the icon id of each node
  GET /opennms/svg/a.svg, /opennms/svg/b.svg, ...  ─► Jetty sends each file
  each file, whole, into the first <defs> of the page
  draws <g class="vertex"> per node and <path class="edge"> per link
  styled by: the theme's styles.css (in <head>) + the <style> of every svg file (in <defs>)
```

1. **The page.** The browser asks for `/opennms/topology`. That is a Vaadin application inside OpenNMS's Karaf (the
   bundle `org.opennms.features.topology.app`), class `TopologyUI`. Its header is the JSP menu bar: the page's
   `HeaderComponent` loads `/opennms/includes/bootstrap.jsp?nobreadcrumbs=true&superQuiet=true` into the page, which
   includes `/navBar.htm` as on every JSP page (docs/opennms-menu.md).
2. **The list of svg files.** For each tab the server makes a `TopologyComponent`. When it is made, it asks
   `IconRepositoryManager.getSVGIconFiles()`, which lists every `*.svg` in `jetty-webapps/opennms/svg/` (in the order
   the folder gives them; nothing sorts them) as addresses `/opennms/svg/<name>`. The list goes to the browser once,
   in the component's state (`setSVGDefFiles`). `TopologyUI` is `@PreserveOnRefresh`: a reload of the tab finds the
   same component, so the tab keeps the list it got when it opened.
3. **The svg files go into the page.** In the browser, the widget (`VTopologyComponent.injectSVGDefs`) calls
   `D3.injectSVGDef` for each address: `d3.xml(address)` downloads the file, and when it has arrived its whole `<svg>`
   element is appended to the first `<defs>` of the page. The downloads run at the same time, so the files land in
   `<defs>` in the order their downloads finish, not by name.
4. **The graph.** The server sends the nodes and links: for each node its position, label, alarm status and the id of
   its icon (`IconRepositoryManager.getSVGIconId`, part 4). `GWTVertex` draws each node and `GWTEdge` each link
   (part 2). An icon is a `<use href="#<icon id>">`: a copy of a drawing that one of the svg files brought into `<defs>`.
5. **The look.** Two kinds of CSS style these elements: the stock stylesheet of the Vaadin theme `topo_default`
   (loaded into the page's `<head>`), and every `<style>` element that came into `<defs>` inside an svg file. A
   `<style>` inside an svg that is part of the page is a stylesheet of the whole page, not only of its own file. That is
   the door the studio uses: your CSS travels inside `svg/zz-topology-styles.svg`.

What this means for a change:

| You change | OpenNMS | An open tab shows it |
|---|---|---|
| an svg file that the tab's list has (for example `zz-topology-styles.svg` after its first apply) | does nothing: its web server sends the file when the browser asks | after a reload, if the browser does not keep its copy (`Cache-Control`, kit/FILES.md section 6) |
| a new svg file | does nothing | only in a new tab: the list is made when the tab opens (step 2) |
| an icon mapping in `etc/` | Karaf reads the changed `.cfg` within a second (part 4) | after a reload |
| the stock stylesheet | it is inside a jar: a rebuild of the jar and a restart | |

Nothing in this table restarts OpenNMS. That is why the studio can apply the topology module while OpenNMS runs.

## Part 2: What OpenNMS draws

Open the real page, F12 > Elements, and look for `class="vertex"`. Each node and link is this (`GWTVertex.java`,
`GWTEdge.java`):

```text
<g class="vertex [selected]" transform="translate(x, y)">               one node
  <rect class="status <severity>" fill="none" stroke="blue"            the square behind the icon (frame and background)
        stroke-width="5" opacity="0">
  <g class="icon-container" transform="translate(..) scale(48/size)">   the icon, scaled to 48 px
    <use class="upIcon" href="#X">                                      the drawing X
    <use class="overIcon" href="#X_rollover" opacity="0">               shown while the mouse is over the node
    <use class="activeIcon" href="#X_active" opacity="0">               shown while the node is selected
  <g class="node-status-counter">  <g class="status-badge-container status <severity>">
  <text class="vertex-label">                                           the label, below the icon
  <rect class="svgIconOverlay" opacity="0">                             on top: it takes the mouse
<path class="edge [selected] [up|down|<severity>]" style="fill: none; cursor: pointer; stroke-width: 3px">   one link
```

`<severity>` is one of `indeterminate`, `cleared`, `normal`, `warning`, `minor`, `major`, `critical`. A node without
an alarm is `normal`. The attributes on `rect.status` (`fill="none"`, `stroke="blue"`, `opacity="0"`) are only a
start: the stock rules for `.vertex .status.<severity>` replace them, and they are why a layer without alarm statuses
shows no square (no severity class, so `opacity="0"` stays).

| Part | What you see | The stock rule |
|---|---|---|
| `rect.status.normal` | the green square: its `fill` shows through the transparent parts of the icon, its `stroke` is the frame | `.vertex .status.normal { stroke: #336600; fill: #336600; }` |
| `rect.status.major`, `.critical`, ... | the alarm colours | `.vertex .status.major { stroke: #FF3300; fill: #FF3300; }` and so on |
| `text.vertex-label` | the label | `.vertex-label { font-size: 9px; text-anchor: middle; }` |
| `path.edge` | a link: grey, or the colour of its status | `.edge { stroke: #ccc; }`, `.edge.up, .edge.normal { stroke: #336600; }`, ... |

## Part 3: Which rule wins

### 3.1 Where the rules come from

In the order the browser meets them:

1. **Attributes that the drawing code writes**, such as `stroke-width="5"` on `rect.status`. They count least: any
   CSS rule beats them.
2. **The stock stylesheet**, `VAADIN/themes/topo_default/styles.css` inside the theme jar
   `system/org/opennms/features/topology/themes/org.opennms.features.topology.themes.default-theme/<version>/*.jar`,
   in the page's `<head>`. The Topology page of the studio shows its text.
3. **The `<style>` of each svg file**, in `<defs>`, in the order the downloads finished (part 1, step 3). Your
   `zz-topology-styles.svg` is one of them. Some stock icon files bring rules too (`opennms_icons.svg` has `.st0` to
   `.st16`), and they apply to the whole page.
4. **Inline styles** that the drawing code writes, `style="..."`: every link has `stroke-width: 3px` this way.

### 3.2 How the browser decides, for each property of each element

1. A declaration with `!important` beats one without.
2. An inline `style="..."` beats every rule without `!important`.
3. Otherwise the rule with the more specific selector wins (3.3).
4. With equal specificity, the later rule wins. Every svg file comes after the stock stylesheet, so your rule beats a
   stock rule of the same weight. Among the svg files the order is the order of the downloads, which can change from
   one load to the next: never let a rule depend on coming after another svg file's rule.

### 3.3 Specificity

Count three numbers: **ids** (`#x`), **classes, attributes and pseudo-classes** (`.x`, `[href="#x"]`, `:hover`),
**element types** (`svg`, `rect`). Compare from the left: one more class beats any number of types. `:has(...)`,
`:is(...)` and `:not(...)` count as their most specific argument; `:where(...)` counts nothing.

| Selector | Whose | Ids, classes, types | What happens |
|---|---|---|---|
| `.vertex .status.normal` | stock | 0, 3, 0 | the green: `fill` and `stroke` `#336600` |
| `svg .vertex > rect.status.normal` | yours (experiment T2) | 0, 3, 2 | beats the stock rule, wherever it stands |
| `.vertex .status.normal` | yours, at the end of your CSS (T7) | 0, 3, 0 | loses to your `svg ...` rule above it: 0, 3, 0 is less than 0, 3, 2 |
| `svg .vertex:has(use.upIcon[*\|href="#das_helix"]) > rect.status.normal` | yours (T3) | 0, 5, 3 | one icon's nodes: beats the rule for all icons |
| `.edge.normal` | stock | 0, 2, 0 | the colour of a GraphML link |
| `svg path.edge` | yours | 0, 1, 2 | **loses** to `.edge.normal`: classes count before types |
| `svg path.edge.normal` | yours | 0, 2, 2 | wins |
| `#das_helix .cls-1` | yours | 1, 1, 0 | a part of one drawing: beats every class rule of every svg file |
| `style="stroke-width: 3px"` on a link | the drawing code | inline | beats every rule; `svg path.edge { stroke-width: 6px !important; }` beats it |

`[*|href="#x"]` is an attribute selector for `href` in any namespace: the drawing code writes `xlink:href`, newer
files write `href`, and this matches both.

The `:has()` in T3 counts as its argument `use.upIcon[*|href="#das_helix"]`: one type (`use`), one class
(`.upIcon`), one attribute. Added to `svg .vertex > rect.status.normal` (0, 3, 2) that makes 0, 5, 3.

### 3.4 The preview and the real page

The studio's preview (`web/public/preview-frame.html`) is built the same way: the stock stylesheet in the `<head>`,
every other svg file of that OpenNMS whole in `<defs>`, your CSS last. In the preview your CSS therefore wins every tie.
On the real page it wins ties against the stock stylesheet for sure, and against another svg file's rules only when
its download happened to finish first. Rules that start with `svg` and name the element and its classes (or a drawing's
id) do not depend on that, which is why every snippet of the studio is written that way.

### 3.5 Inside an icon: copies made by `<use>`

A node shows `<use href="#X">`, a copy of the drawing with id X. A rule that selects the original's parts
(`#X .cls-1`) styles every copy of it. A property set on the `<use>` or on `g.vertex` reaches the copy's parts only
where the drawing sets nothing itself (inheritance). CSS variables pass into the copies too:
`svg .vertex:has(> rect.status.critical) { --alarm: #CC0000; }` together with `#X .cls-1 { fill: var(--alarm, #1F3A5F); }`
paints the part red on nodes with a critical alarm.

What the copy holds depends on how the file is built: `<use href="#X">` draws everything inside X, deep or not. A file
that keeps its three looks inside X is the usual reason why a rule for the parts of an icon seems to do nothing (4.1).

### 3.6 Seeing it in a browser

On the real page: F12 > Elements, select a `rect.status`. The Styles pane lists the rules that match it, the winner
first and the losers struck through, each with its source (the theme's `styles.css`, or `<style>` for an svg file).
The Computed tab shows the final value. The studio's inspector does the same for the node you click in the preview:
its computed fill, stroke and stroke-width.

## Part 4: The icon of a node

For each node, `IconRepositoryManager.getSVGIconId(vertex)` takes the first match:

1. **`<namespace>.<node id>`**, a mapping for this one node (for a GraphML view `Maven-abc`: `Maven-abc.10`).
2. **The node's icon key**, then shorter keys without the last `.part`, one at a time. A GraphML node's `iconKey` is
   an icon id itself; Enhanced Linkd gives `linkd.system.snmp.<sysObjectID>`.
3. **`default`**.

The mappings live in `etc/org.opennms.features.topology.app.icons.<name>.cfg`: lines `<key> = <icon id>` (a colon in
a key needs a backslash). Each file belongs to a bundle that registers it under its name (its `service.pid`); the
topology app registers `org.opennms.features.topology.app.icons.default` (`blueprint.xml`), so a file with a new name
is ignored. Karaf watches `etc/`: when a `.cfg` changes, it reads it and hands the lines to the repository
(`DefaultIconRepository.updated`) within a second. When a key appears twice in a file, the later line wins.

An icon id names a drawing in one of the svg files: `X` for the normal look, `X_rollover` and `X_active` for the
mouse-over and the selected look (kit/FILES.md, section 1).

**Right-click > Change Icon** in OpenNMS writes `<namespace>.<node id> = <icon id>` too, into the file whose
repository has the node's icon key, and saves that file with `java.util.Properties.store`
(`DefaultIconRepository.save`): the whole file is written again from what OpenNMS holds in memory, its comments are
gone, the lines come in another order, and it starts with a comment line with the date. For the studio's block of
mappings that means:

```
# --- OpenNMS UI Studio: icon mappings. The studio writes the lines between these two comments. ---
Maven-abc.10 = das_helix
# --- end of the OpenNMS UI Studio icon mappings ---
```

After a Change Icon on the same file, these two comment lines are gone and the mappings stand as plain lines. The
studio's next apply adds its block again at the end, which wins over the plain lines with the same keys. A mapping you
removed in the studio stays as a plain line in that case: remove it in OpenNMS (right-click the node > Reset Icon,
which saves the file the same way) or from the file.

### 4.1 What an icon file must look like

A node draws `<use href="#X">`, and a `<use>` draws **everything inside the element with the id X**, however deep.
OpenNMS asks the page for three ids and no others: `#X` (the normal look, `use.upIcon`), `#X_rollover` (the mouse is
over the node, `use.overIcon`) and `#X_active` (the node is selected, `use.activeIcon`; `GWTVertex.create()`, part 6).
It never draws `#X_default`, and it does not look at the file as a whole. The stock files therefore put the three looks
next to each other, in a wrapper that nothing draws:

```xml
<g id="X_icon">                   the wrapper: no <use> points to it
  <g id="X"> ... </g>             the normal look
  <g id="X_rollover"> ... </g>    the mouse is over the node
  <g id="X_active"> ... </g>      the node is selected
</g>
```

A drawing program easily exports another layout: a group `X` that holds three groups `X_default`, `X_rollover` and
`X_active`. In a viewer the file looks right. In OpenNMS `<use href="#X">` draws all three, one over the other, and the
one that comes last in the file, `X_active`, lies on top. The node shows the look of the selected state all the time,
and a rule for the normal look, `#X_default .cls-1 { fill: red; }`, colours a layer that is covered. That was the
`nimbus` icon of production: `nimbus.svg` holds three looks of 137 shapes each, the nodes were light blue (`#beccdc`,
the colour of `_active`) and `#nimbus_default .cls-1, #nimbus_default .cls-2, #nimbus_default .cls-3 { fill: red !important; }`
changed nothing. Counted in Chromium, in a page built the way OpenNMS builds it (the file whole in `<defs>`, a node is a
`<use>`), as the share of the pixels that are not white:

| The node `nimbus`, drawn from | What is seen |
|---|---|
| the file as it is, no CSS | `#beccdc` 88 % |
| the file as it is, `#nimbus_default .cls-N { fill: red !important; }` | `#beccdc` 86 %, red 0 % |
| the file as it is, `#nimbus_rollover .rollover-cls-N { fill: red !important; }` | red 0 % |
| the file as it is, `#nimbus_active .active-cls-N { fill: red !important; }` | red 87 % |
| the same file for a node whose icon id is `nimbus_default` (it draws the one group), no CSS | `#e6e7e8` 69 %, `#bcbec0` 21 % |
| the file with two ids renamed (below), no CSS | `#e6e7e8` 69 %, `#bcbec0` 21 %: the grey the file's author drew for the normal look |
| the repaired file, `#nimbus .cls-N { fill: red; }` (`!important` is not needed) | red 87 % |
| the repaired file, red rule, the mouse over the node / the node selected | `#5dc3ad` 85 % / `#beccdc` 85 %: the other two looks are drawings of their own now |

(The class names differ per layer: `cls-N`, `rollover-cls-N`, `active-cls-N`; that is what Illustrator makes.)

**The repair** is two renames, in this order, and nothing else: the group that holds the three (`id="nimbus"`)
becomes `nimbus_icon`, and `nimbus_default` becomes `nimbus`. In the nimbus.svg of production these are two lines of
the file (20 and 22). The nodes then change: from the light blue of the selected look to the grey of the normal look,
which is the look the file was drawn with.

Without touching the file, a rule for the layer on top works: `#nimbus_active .active-cls-1 { fill: ... }` and so on.
It colours the normal look and the selected look together, because both draw `#nimbus_active` (red 87 % and 89 %). The
look under the mouse is `#nimbus_rollover` drawn on its own: it keeps its green (`#5dc3ad`, 85 %) until you colour that
group as well (then red 92 %). The studio's list of snippets writes these rules for the icon you clicked (*The parts of
the icon you clicked*).

OpenNMS does not tell you any of this: a file with a wrong layout loads without a message. The studio's *Icon files*
box does (part 5).

## Part 5: What the studio changes on the topology page

| Your file (`workspace/`) | The OpenNMS file | How it is made | When the page shows it |
|---|---|---|---|
| `topology/topology.css` | `jetty-webapps/opennms/svg/zz-topology-styles.svg` | your CSS, byte for byte, between `<style><![CDATA[` and `]]></style>` in an empty svg (a `]]>` in your CSS is split so that the CDATA stays whole; a line `/* mark */` adds the rule of the yellow label) | first time: a new tab; then: a reload |
| `topology/icon-mappings.json` | `etc/org.opennms.features.topology.app.icons.default.cfg` | the studio's block at the end of the file (part 4), the rest of the file unchanged | a reload |
| `topology/icons/<name>.svg` (only the ones you made) | `jetty-webapps/opennms/svg/<name>.svg` | your copy of an icon file, byte for byte, sent when it differs from the file in that OpenNMS | a reload; a file that is new to that OpenNMS: a new tab |

**Icon files.** Under the preview the box *Icon files* lists every svg file of the OpenNMS you preview, the icons it
holds, and what is wrong with the way each is built (`server/src/util/iconcheck.ts`, part 4.1). It reports as an error:
a group `X` that holds `X_default`, `X_rollover` and `X_active` (they are drawn on top of each other), a group
`X_default` without an `X` (no node draws it), a wrapper `X_icon` without an `X`; and as a note: an `X_default` next to
an `X` (never drawn), a missing `X_rollover` or `X_active` (the node keeps the normal look), a file with no icon and no
`<style>`. The stock files `opennms_icons.svg`, `atlas_icons.svg`, `vmware_icons.svg` and `legacy_icons.svg` belong to
OpenNMS and are not checked; a file that is not well-formed XML is listed as skipped (the page of OpenNMS skips it, too).

*Make a repaired copy in the workspace* writes `topology/icons/<name>.svg`: the file of that OpenNMS with the two
renames of 4.1 and nothing else (byte order mark and line ends are kept). It makes no copy when a rename would not be
safe, for example when something in the file refers to one of the ids (a rule in its `<style>`, a `<use>`): then the box
says what to change by hand. The preview then draws the copy, and the dev and production panels list `svg/<name>.svg`
with a diff of the two lines. *Apply* sends it like the CSS: it keeps the old file in `backups/`, writes the file into
the container (on production also into an overlay folder, by the rules of docs/how-the-studio-works.md, section 4),
checks the md5 sum, and asks the web server for it; *Undo* puts the old file back. *Remove my copy* deletes the copy
from the workspace: the studio stops sending it, and OpenNMS keeps the file it has until you apply a different one.

The style file is the same, byte for byte, as the one `kit/topo.sh` makes, so `kit/topo.sh css prod` and the studio
agree on whether production has your CSS (a unit test checks it). The name begins with `zz-` so that it comes last in a
sorted listing; OpenNMS neither sorts the list nor downloads in order (part 1), so the name does not make it win.

Every apply is recorded with the md5 sum of each file before and after (`backups/journal.jsonl`): see
`docs/how-the-studio-works.md`.

## Part 6: Sources

All at https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/ followed by the path.

| File | What to read in it |
|---|---|
| [`features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/TopologyUI.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/TopologyUI.java) | `@PreserveOnRefresh` (line 137); `addHeader()` (line 718) |
| [`core/web-assets/src/main/assets/js/vaadin/header-component_connector.js`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/core/web-assets/src/main/assets/js/vaadin/header-component_connector.js) | the header of the page: `bootstrap.jsp` loaded with jQuery |
| [`.../internal/TopologyComponent.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/TopologyComponent.java) | line 195: `getState().setSVGDefFiles(m_iconRepoManager.getSVGIconFiles())`, once per component |
| [`.../internal/support/IconRepositoryManager.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/support/IconRepositoryManager.java) | `getSVGIconId` (lines 122 and 133): the order of part 4; `getSVGIconFiles` (line 160): the folder listing; `setIconMapping` (line 94): Change Icon |
| [`.../internal/gwt/client/VTopologyComponent.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/VTopologyComponent.java) | `injectSVGDefs` (line 706) |
| [`.../internal/gwt/client/d3/D3.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/d3/D3.java) | `injectSVGDef` (line 458): `d3.xml`, then `appendChild` to the first `<defs>` |
| [`.../internal/gwt/client/GWTVertex.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/GWTVertex.java) | `create()` (line 530): the elements of a node, among them the three `<use>` (`upIcon`, `overIcon`, `activeIcon`); `draw()` (line 495): sizes and classes |
| [`.../internal/gwt/client/GWTEdge.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/java/org/opennms/features/topology/app/internal/gwt/client/GWTEdge.java) | line 118: the inline `stroke-width: 3px` |
| [`features/topology-map/org.opennms.features.topology.api/src/main/java/org/opennms/features/topology/api/support/DefaultIconRepository.java`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.api/src/main/java/org/opennms/features/topology/api/support/DefaultIconRepository.java) | `updated()` (line 87): Karaf hands over the cfg file; `save()` (line 71): Change Icon rewrites it |
| [`features/topology-map/org.opennms.features.topology.app/src/main/resources/OSGI-INF/blueprint/blueprint.xml`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/org.opennms.features.topology.app/src/main/resources/OSGI-INF/blueprint/blueprint.xml) | lines 114 to 124: the default icon repository and its pid |
| [`features/topology-map/themes/default-theme/src/main/filtered/VAADIN/themes/topo_default/styles.css`](https://github.com/OpenNMS/opennms/blob/opennms-33.1.8-1/features/topology-map/themes/default-theme/src/main/filtered/VAADIN/themes/topo_default/styles.css) | the stock rules: links (lines 50 to 81), `.vertex-label` (116), `.vertex .status.*` (122 to 171) |

The studio carries a copy of the stock stylesheet of 33.1.8 (`server/assets/topo_default-styles.css`) for an OpenNMS
whose theme jar it cannot read.
