# OpenNMS topology kit: DAS icons and link colours (Horizon 33.1.8)

Your own SVG icons for Orion, Helix, Stratus and Nimbus nodes and your own link colours on
`/opennms/topology`. It includes a development OpenNMS 33.1.8 in Podman that matches the production
container, and a hot deploy that restarts nothing.

It is made for a CentOS Stream 9 (or RHEL 9) VirtualBox VM that you open from a browser on another computer.

## 1. Prepare the VM (once)

| VirtualBox setting (with the VM shut down) | Value |
|---|---|
| System > Motherboard > Base Memory | 4096 MB or more. With 2 GB, OpenNMS is killed while it starts |
| System > Processor | 2 CPUs or more |
| Network > Adapter 1 | Bridged Adapter, so the VM has an address on your network (such as 192.168.0.47) |

On the VM:

```bash
sudo dnf install -y podman
sudo dnf module install -y nodejs:22    # not needed when node -v shows v18 or newer
```

## 2. Install and start

Copy `opennms-topology-kit.tar.gz` to the VM, for example from your computer with
`scp opennms-topology-kit.tar.gz admin@192.168.0.47:`. Then on the VM:

```bash
tar xzf opennms-topology-kit.tar.gz
cd opennms-topology-kit
./dev.sh up
```

`./dev.sh up` does the following:

1. It checks memory, disk space, ports and tools, and says what to fix.
2. Once, it asks for your sudo password. It opens ports 8980 and 8099 in firewalld and lets the containers run on after you log out.
3. It downloads OpenNMS 33.1.8 and PostgreSQL 15 (about 1.5 GB).
4. It initialises OpenNMS. This takes 5 to 10 minutes, with a progress line every 30 seconds.
5. It adds six demo DAS nodes with links and deploys the kit.

It replaces a stack left by an earlier kit version. At the end it prints the addresses to open on any computer:

```text
  Topology       http://192.168.0.47:8980/opennms/topology   (user admin, password admin)
  Live editing   npm run dev, then http://192.168.0.47:8099
```

On the topology page pick **View > DAS demo (GraphML)** or **View > UserDefined**. The UserDefined links
can take a minute to appear.

## 3. Edit

```bash
npm run dev
```

Every save rebuilds the kit, reloads the preview on port 8099 and deploys into the development OpenNMS
within a second. Reload the topology page to see it there.

| Edit | Result |
|---|---|
| `src/icons/<name>.svg` | icon `das_<name>` |
| `src/style.css` | tile, link and label colours (the variables at the top) |
| `src/icon-mapping.cfg`, `src/icon-mapping.<dev\|prod>.cfg` | which node gets which icon |
| `overlay/<path>` | any OpenNMS file, as `/usr/share/opennms/<path>`; `./dev.sh pull <path>` copies the stock file there first |

## Icons

Any SVG with a `viewBox` (or `width` and `height`) works. For your own hover or selected artwork, add
`<name>.hover.svg` or `<name>.selected.svg`. The build does three things:

- It puts each icon on a tile and makes the three groups OpenNMS draws: `<id>` (normal), `<id>_rollover`
  (mouse over) and `<id>_active` (selected).
- It prefixes ids and class names and inlines `<style>` rules. All icon files share one page, so a
  `.cls-1` from one Illustrator export would otherwise recolour every other icon.
- It checks that the result is well-formed, and stops with the file and line of any error.

## Which node gets which icon

- **GraphML views**: the node names its icon, `<data key="iconKey">das_orion</data>` (see `seed/das-demo.graphml`).
- **Enhanced Linkd views** (All, Lldp, Cdp, Bridge, UserDefined, ...): OpenNMS looks up
  `linkd.system.snmp.<sysObjectID>`, then shorter prefixes of it. One line per model covers all these views
  and future nodes. A single node is `<view namespace>.<node id>`: `nodes` for "All", `nodes\:UserDefined`
  for "UserDefined" (the colon is escaped).
- **Any view, one node**: right-click the node and choose Change Icon. The kit adds its icons to that list.

`npm run map` writes these lines from your nodes. A node's type is the first icon name found in its label,
sysName, sysDescription, foreign ID, categories or asset fields:

```bash
ONMS_PASSWORD=... npm run map -- --url https://prod-host:8980/opennms --user admin \
  --views nodes,nodes:UserDefined --out src/icon-mapping.prod.cfg
```

Lines with node IDs only fit one server, so keep them in `icon-mapping.prod.cfg`. `./dev.sh up` writes
`icon-mapping.dev.cfg` for the demo nodes. The kit owns every mapping to a `das_*` icon; other lines stay.

## Deploy to production

In `kit.env`, set `PROD_CONTAINER` to the name of the production container. Set `PROD_CONNECTION` too when it
runs on another host, and set `PODMAN="sudo podman"` for a rootful container. Then run:

```bash
./deploy.sh prod            # asks first; -y skips the question
```

The script does four things:

1. It copies `overlay/` and the SVG into the running container.
2. It merges the icon mappings.
3. It adds the icons to the Change Icon list.
4. It checks that OpenNMS serves the file.

Reload the topology page; nothing restarts. The file name changes with its content, so no browser shows a
cached old version. `./deploy.sh prod --remove` takes the kit out again (files from `overlay/` stay).

The mappings live on the etc volume. The SVG lives in the container itself. Mount an overlay folder in the
production run command with `-v /srv/opennms-overlay:/opt/opennms-overlay:Z`, and `deploy.sh` writes the SVG
there too. The image copies that folder into OpenNMS at every start. Without it, run `./deploy.sh prod`
again after re-creating the container.

## Commands

| | |
|---|---|
| `./dev.sh up` | check, start, seed, deploy (safe to repeat) |
| `./dev.sh status` | containers, memory and addresses |
| `./dev.sh logs [file]` | follow `karaf.log` (or `manager.log`, `web.log`, ...) |
| `./dev.sh down` | stop and keep the data; `./dev.sh up` starts it again |
| `./dev.sh reset` | delete the containers and their data |

Settings such as ports, Java heap and images are in `kit.env`. Each one also works for a single run, such as
`DEV_PORT=8981 ./dev.sh up`.

## When something goes wrong

- **"Permission denied" on `./dev.sh`**: the files were unpacked without their executable bit. Run
  `chmod +x dev.sh deploy.sh` (or use `bash dev.sh up`).
- **"Unreachable" or "took too long" in the browser on your computer**: the VM's firewall. Run
  `sudo firewall-cmd --permanent --add-port=8980/tcp --add-port=8099/tcp && sudo firewall-cmd --reload`.
- **OpenNMS stopped with exit code 137**: the VM ran out of memory. Give it 4 GB or more.
- **OpenNMS stopped with another code**: `./dev.sh up` prints the end of its log and keeps the whole log in
  `.dev/opennms-start.log`. `./dev.sh up` tries again; `./dev.sh reset && ./dev.sh up` starts over.
- **A port is in use** (a production OpenNMS on the same VM?): `DEV_PORT=8981 DEV_KARAF_PORT=8102 ./dev.sh up`.

## How it works, and where OpenNMS keeps the topology look

No OpenNMS source file is changed or rebuilt. In 33.1.8 the topology page loads every `*.svg` in
`jetty-webapps/opennms/svg` into the page, so a `<style>` in such a file applies to the whole page. The kit
builds one file, `das-topology.<hash>.svg`, from your icons and `src/style.css`. Nodes and links are SVG
elements with CSS classes:

- `.vertex`, with `rect.status` as the alarm frame;
- `path.edge`, plus `up` or `down` (Enhanced Linkd), a severity name (GraphML with a status script) or `selected`.

In the container, `/opt/opennms` is a link to `/usr/share/opennms`.

| What | File | Applied |
|---|---|---|
| Icons and page CSS | `jetty-webapps/opennms/svg/*.svg` | on page reload |
| Icon mappings | `etc/org.opennms.features.topology.app.icons.*.cfg` | within a second |
| Change Icon list | `etc/org.opennms.features.topology.app.icons.list` | when the dialog opens |
| Stock styles (severity colours, links) | `topo_default/styles.css` in the topology theme jar under `system/` | needs a jar rebuild and restart: override it in `src/style.css` instead |
| How nodes and links are drawn | GWT code compiled into the topology bundle | needs a Java/GWT rebuild; not needed for icons or colours |
