# OpenNMS topology kit: DAS icons and link colours (Horizon 33.1.8)

Custom node icons (Orion, Helix, Stratus, Nimbus) and link colours for `/opennms/topology`, a Podman
development stack that matches the production container, and a hot deploy that restarts nothing.

## How it works

No OpenNMS source file is changed or rebuilt. In 33.1.8 the topology page reads its look from plain files:

- **Every `*.svg` in `jetty-webapps/opennms/svg`** is fetched by the page and inserted into it. A `<style>`
  inside such a file applies to the whole page. The kit builds one file, `das-topology.<hash>.svg`, with
  your icons and `src/style.css`.
- **Which icon a node gets** comes from `etc/org.opennms.features.topology.app.icons.*.cfg`
  (`<icon key> = <icon id>`). Karaf re-reads these files within a second.
- **Nodes and links are SVG elements with CSS classes**: `.vertex`, `rect.status` (alarm frame),
  `path.edge` plus `up`/`down` (Enhanced Linkd), a severity name (GraphML with a status script) or `selected`.

## Requirements

Podman 4+, Node.js 20+, curl. The development machine pulls `docker.io/opennms/horizon:33.1.8` and
`docker.io/library/postgres:15` (set the PostgreSQL version of production in `kit.env`).

## Development

```bash
npm ci
./dev.sh up      # OpenNMS 33.1.8 + PostgreSQL in a pod; first start ~5 min; seeds a demo DAS
npm run dev      # live preview on http://localhost:8099 and a deploy into the dev OpenNMS on every save
```

Open http://localhost:8980/opennms/topology (admin / admin) and pick **View > DAS demo (GraphML)** or
**View > UserDefined** (its links can take a minute to appear after the first start). Save a file, wait a
second, reload the topology page. The preview reloads by itself.

| Edit | Result |
|---|---|
| `src/icons/<name>.svg` | icon `das_<name>` |
| `src/style.css` | tile, link and label colours (variables at the top) |
| `src/icon-mapping.cfg`, `src/icon-mapping.<dev\|prod>.cfg` | which node gets which icon |
| `overlay/<path>` | any OpenNMS file, as `/usr/share/opennms/<path>`; `./dev.sh pull <path>` copies the stock one there |

`./dev.sh down` stops, `./dev.sh up` starts again, `./dev.sh reset` deletes everything, `./dev.sh logs` follows `karaf.log`.

## Icons

Use any SVG with a `viewBox` (or `width`/`height`). For your own hover or selected artwork add
`<name>.hover.svg` or `<name>.selected.svg`. The build:

- puts each icon on a tile and creates the three groups OpenNMS needs: `<id>` (normal), `<id>_rollover`
  (mouse over) and `<id>_active` (selected);
- prefixes ids and class names and inlines `<style>` rules. All icon files share one page, so `.cls-1`
  from one Illustrator export would otherwise recolour every other icon;
- checks that the result is well-formed, and stops with the file and line of any error.

## Which node gets which icon

- **GraphML views**: set the icon on the node: `<data key="iconKey">das_orion</data>` (see `seed/das-demo.graphml`).
- **Enhanced Linkd views** (All, Lldp, Cdp, Bridge, UserDefined, ...): OpenNMS looks up
  `linkd.system.snmp.<sysObjectID>`, then shorter prefixes of it. One line per model covers all these views
  and future nodes. Single nodes are `<view namespace>.<node id>`: `nodes` for "All", `nodes\:UserDefined` for
  "UserDefined" (the colon is escaped).
- **Any view, one node**: right-click > Change Icon. The kit adds its icons to that list.

`npm run map` writes these lines from your nodes. A node's type is the first icon name found in its label,
sysName, sysDescription, foreign ID, categories or asset fields:

```bash
ONMS_PASSWORD=... npm run map -- --url https://prod-host:8980/opennms --user admin \
  --views nodes,nodes:UserDefined --out src/icon-mapping.prod.cfg
```

Lines with node IDs only fit one server: keep them in `icon-mapping.prod.cfg` (`./dev.sh up` writes
`icon-mapping.dev.cfg` for the demo nodes). The kit owns every mapping to a `das_*` icon; other lines stay.

## Deploy to production

Set `PROD_CONTAINER` in `kit.env` (and `PROD_CONNECTION` for a remote host, `PODMAN="sudo podman"` for a
rootful container), then:

```bash
./deploy.sh prod            # asks first; -y skips the question
```

It copies `overlay/` and the SVG into the running container, merges the icon mappings, adds the icons to
the Change Icon list and checks that OpenNMS serves the file. Reload the topology page; nothing restarts.
The file name changes with its content, so browsers cannot show a cached old version.
`./deploy.sh prod --remove` takes the kit out again (files from `overlay/` stay).

The mappings live on the `etc` volume. The SVG lives in the container itself: mount an overlay folder in
the production run command, `-v /srv/opennms-overlay:/opt/opennms-overlay:Z`, and `deploy.sh` also writes
it there; the image copies that folder into OpenNMS at every start. Without it, run `./deploy.sh prod`
again after re-creating the container.

## Where OpenNMS keeps the topology look

In the container `/opt/opennms` is a link to `/usr/share/opennms`.

| What | File | Applied |
|---|---|---|
| Icons and page CSS | `jetty-webapps/opennms/svg/*.svg` | on page reload |
| Icon mappings | `etc/org.opennms.features.topology.app.icons.*.cfg` | within a second |
| Change Icon list | `etc/org.opennms.features.topology.app.icons.list` | when the dialog opens |
| Stock styles (severity colours, links) | `topo_default/styles.css` inside `system/org/opennms/features/topology/themes/.../org.opennms.features.topology.themes.default-theme-33.1.8.jar` | needs a jar rebuild and restart: override it in `src/style.css` instead |
| How nodes and links are drawn | GWT code compiled into the topology bundle | needs a Java/GWT rebuild; not needed for icons or colours |
