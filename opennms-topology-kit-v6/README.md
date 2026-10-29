# OpenNMS topology kit (Horizon 33.1.8)

Learn and change the OpenNMS files behind `/opennms/topology`: icons, icon mappings, icon size and colours,
links. Each change shows in a development OpenNMS that runs your production image, and is then hot deployed to
production with no restart. **FILES.md** describes each file, with an example you can run.
**GUIDE-Maven-abc-styles.md** walks through one whole round for a GraphML view: setup, changes, production.

| Machine | Address | What runs there |
|---|---|---|
| development | 192.168.0.47, user `admin` | this kit, and the development OpenNMS (`./dev.sh`) |
| production | 192.168.0.36, user `maven-admin` | the container `opennms` (`docker.io/opennms/maven:33.1.8-1192-g05c63c46e8`, PostgreSQL 14) |

The addresses, names and images are in `kit.env`.

## 1. Set up once, on the development machine

1. **VirtualBox settings** (VM shut down): System > Motherboard > Base Memory **4096 MB** or more, System > Processor **2 CPUs**,
   Network > Adapter 1 **Bridged Adapter**.
2. **Podman:** `sudo dnf install -y podman`. CentOS Stream 9 already has curl, Python 3 and ssh.
3. **A key to log in to production without a password:**

   ```bash
   ssh-keygen -t ed25519                      # press Enter at every question
   ssh-copy-id maven-admin@192.168.0.36
   ssh maven-admin@192.168.0.36 podman ps     # lists the production containers: it works
   ```

4. **Unpack the kit and start:**

   ```bash
   tar xzf opennms-topology-kit.tar.gz && cd opennms-topology-kit
   chmod +x dev.sh topo.sh examples/*.sh
   chmod +x dev.sh topo.sh   # only if "Permission denied": some unpackers drop the executable bit
   ./dev.sh up       # the development OpenNMS
   ./topo.sh pull    # the topology files of production: into opennms/, and onto dev
   ```

   A new version of the kit goes over an old folder like this: `tar xzf opennms-topology-kit.tar.gz --strip-components=1 -C <old folder>`,
   then `./dev.sh up`. Your containers, `opennms/`, `styles/` and `backups/` stay; `kit.env` is replaced, so copy your edits of it first.

`./dev.sh up` does these things:

1. It checks memory, disk and ports.
2. Once, it asks for your sudo password. It opens port 8980 in firewalld and keeps the containers running after you log out.
3. It copies the production image over ssh (about 1.5 GB, only once; production keeps running).
4. It copies production's overlay folders (`/opt/opennms-overlay` without `etc/`, and `/opt/opennms-jetty-webapps-overlay`)
   into `.kit/overlays`, so dev runs production's code and web files with its own configuration and database.
   When production's folders change, the next `./dev.sh up` copies them again.
5. It starts the image with PostgreSQL 14, the way production starts it: as root, privileged, `unmask=all`
   (`DEV_PODMAN_ARGS` in `kit.env`; `./dev.sh prod-info` shows production's). The first start takes 5-10 minutes.
   Health checks that need production's other containers may never pass in dev: after 3 minutes it lists them and goes on.
6. It adds demo DAS nodes: orion-1, helix-1, stratus-1/2 and nimbus-1/2, with parents, links, a GraphML view "DAS demo"
   and one alarm (section 4, "The demo").
7. It logs in the way a browser does and says what went wrong if that fails (`./dev.sh status` does it again).

When it is done, open **http://192.168.0.47:8980/opennms/topology** (admin / admin) from any computer.

**The login page.** OpenNMS 33.1.8 accepts a login only with the CSRF token that its login page puts in the form
(field `_csrf`). Without it, every login ends on OpenNMS's "Access denied" page. If the login page that dev would
show has no such field, `./dev.sh up` gives dev's copy one and says so; production is not changed.

## 2. Learn, change, look

```bash
./topo.sh example        # the twelve examples, one per file and effect (FILES.md has the details)
./topo.sh example 7      # apply one: it changes files in opennms/ or styles/ and deploys them to dev
./topo.sh diff           # everything you changed since the last pull or production deploy
./topo.sh revert         # drop your changes (or one file: ./topo.sh revert <file>)
./topo.sh watch          # deploy every save to dev, while you edit files in opennms/ and styles/
./topo.sh icons          # every icon id, and the icon each node gets (./topo.sh icons prod: production's nodes)
./topo.sh css            # the svg files, their clashing style rules, and whether dev has styles/topology.css
./topo.sh css <icon id>  # CSS for the parts of one icon (or <file.svg>), to copy into styles/topology.css
./topo.sh view           # the GraphML views: entries of the View menu (add, remove: FILES.md, section 5)
./topo.sh view show <name>                     # a view's namespace, node ids and the icon each node gets
./topo.sh view icon <name> <node id> <icon id> # another icon for one node of a view; --reset takes it back
```

Reload the topology page after a deploy. Svg files, `styles/topology.css` included, need more (FILES.md, section 6): a
new one reaches the page only in a new browser tab, and a changed one only with the browser cache off (F12 > Network >
Disable cache), because OpenNMS lets the browser keep svg files for an hour. `./topo.sh deploy` says which applies.

## 3. Hot deploy to production

```bash
./topo.sh deploy prod    # lists the changed files and asks; keeps production's old files in backups/; copies
./topo.sh undo           # puts back what the last deploy replaced, and removes what it added
```

A deploy compares each file with the container's copy and copies the changed ones over ssh with `podman cp`.
Production's icons, mappings and styles are then the ones from your development machine. Nothing restarts;
reload the topology page.

A production deploy sends only what production does not have yet (`.kit/baseline` holds production's files as of your
last pull or deploy, so you can change more and deploy again). A file that production changed after that, and you
did not (its software writes GraphML views again, someone used Change Icon), stays as production has it; a file both
of you changed is held back until you send it with `FORCE=1 ./topo.sh deploy prod`. `./topo.sh pull` makes
production's current files your new starting point.

**Overlay folders.** The image copies three folders into OpenNMS at every start: `/opt/opennms-overlay` (below
OpenNMS's home), `/opt/opennms-etc-overlay` (below `etc/`) and `/opt/opennms-jetty-webapps-overlay` (below
`jetty-webapps/`). A file in one of them overwrites a hot-deployed file with its old content at the next start,
so a deploy that left them alone would be undone by a restart. `./topo.sh deploy prod` therefore looks at those
folders (on production they are host folders: `./dev.sh prod-info` lists them), shows what it will do there, and
changes them with the live files: a replaced icon replaces its overlay copy, a new icon goes next to the other
icons of the overlay, and `./topo.sh undo` puts all of it back. Mapping files live on production's etc volume
and need no copy of their own. Where production mounts no overlay folder, the files in `jetty-webapps` exist
only in the container, and a re-created container starts without them.

**Backups.** Each production deploy (and `./topo.sh view remove <name> prod`) first saves what it changes in
`backups/<date>-<time>/`: the files it replaces or removes, at their paths below `/opt/opennms`; `.added`, the files it
adds; `.overlay/` and `.overlay-added`, the same for the overlay folders. `./topo.sh undo` reverses the newest one and
renames it `<date>-<time>.undone`; run it again to go one deploy further back. `find backups -type f` lists them all.

## 4. What is where

**This machine**, in the kit folder. Names that start with a dot are hidden: `ls -a` shows them.

| Folder | What it holds | Comes from |
|---|---|---|
| `opennms/` | the topology files you change: `etc/org.opennms.features.topology.app*.cfg`, `...icons.list`, GraphML views (`etc/graphml/*.xml` and their cfg files), `jetty-webapps/opennms/svg/*.svg` | production, `./topo.sh pull` |
| `styles/topology.css` | your CSS for the topology page; in OpenNMS it is `jetty-webapps/opennms/svg/zz-topology-styles.svg` | the kit |
| `reference/topo_default-styles.css` | the stock stylesheet, for reading | production's theme jar, `./topo.sh pull` |
| `.kit/baseline/` | production's version of the files in `opennms/` as of your last pull or deploy, for `./topo.sh diff`, `revert` and the deploy check | `./topo.sh pull`, `./topo.sh deploy prod` |
| `.kit/overlays/opennms-overlay/` | production's `/opt/opennms-overlay` without `etc/`, and the dev-only login page if one was needed | production, `./dev.sh up` |
| `.kit/overlays/opennms-jetty-webapps-overlay/` | production's `/opt/opennms-jetty-webapps-overlay` | production, `./dev.sh up` |
| `backups/` | what each production deploy replaced (section 3) | `./topo.sh deploy prod` |
| `.kit/opennms-start.log` | the log of a start that failed | `./dev.sh up` |

```bash
find .kit/overlays -type f     # every file dev got from production's overlay folders
find opennms -type f | sort    # the topology files
./topo.sh diff                 # what you changed in them since the last pull or production deploy
```

**Not copied from production:** its configuration (`/opt/opennms/etc` and the etc overlay), its database with its
nodes, and its other containers (`maven-nms`, `postgres-database`). Dev keeps its own configuration and PostgreSQL,
and gets the demo below.

**Inside the containers**, below `/opt/opennms`:

```bash
podman exec onms-dev-core ls /opt/opennms/jetty-webapps/opennms/svg            # dev
ssh maven-admin@192.168.0.36 podman exec opennms ls /opt/opennms/etc/graphml  # production
./dev.sh prod-info             # production: volumes, the files of its overlay folders, web settings
```

**The demo** (`./dev.sh up` adds it to dev only, from `seed/`; it runs again when a new kit version changes it):

| What | Where you see it |
|---|---|
| 6 nodes in requisition DAS-Demo: orion-1; helix-1, stratus-1 and stratus-2 under it; nimbus-1 and nimbus-2 under helix-1 | Info > Nodes, and the Status Overview of the start page, which also counts nodes your image adds itself. `./dev.sh status` lists the nodes per requisition. |
| a model number (sysObjectID) for each type, and the links between the nodes | View > Enhanced Linkd: the icons by model (`linkd.system.snmp.1.3.6.1.4.1.99999.1.<n>`) and the links |
| the same DAS as a GraphML view | View > DAS demo (GraphML) |
| each node's parent | View > Path Outage: each node under its parent. It opens on one node at semantic zoom level 0: press "Increase Semantic Zoom Level" in the toolbar twice, or open the Path Outage link of `./dev.sh status`. |
| one nodeDown event for nimbus-2 | Alarms: nimbus-2, Major, "Node is down", and its status colour on the maps. It is there to show alarm colours; clear it on the alarm page. |

## Commands

| | |
|---|---|
| `./dev.sh up` | check, start, add demo nodes (safe to repeat) |
| `./dev.sh status`, `./dev.sh logs [file]` | state, addresses, failing health checks, a test login; follow `karaf.log` (or another OpenNMS log) |
| `./dev.sh down`, `./dev.sh reset` | stop (`up` starts again with all data); delete the containers, their data and the overlay copy |
| `./dev.sh prod-info` | production container: image, command, user, privileges, ports, volumes, variable names, overlay files, web settings, login page |
| `./topo.sh pull [prod\|dev]` | copy the topology files into `opennms/` (from production: also onto dev) |
| `./topo.sh deploy dev\|prod [-y]`, `./topo.sh undo [-y]` | hot deploy; undo the last production deploy |
| `./topo.sh watch`, `example [N]`, `diff`, `revert [file]`, `icons [dev\|prod]` | see section 2 |
| `./topo.sh css [dev\|prod]`, `./topo.sh css <icon id \| file.svg>` | the svg files and their style rules, whether that OpenNMS has your CSS; CSS for the parts of one icon (FILES.md, section 6) |
| `./topo.sh view [list [dev\|prod]]`, `view show <name> [dev\|prod]`, `view add <file> [name]`, `view remove <name> [dev\|prod]` | GraphML views (FILES.md, section 5) |
| `./topo.sh view icon <name> <node id> <icon id \| --reset>` | another icon for one node of a view: the line `<namespace>.<node id> = <icon id>`, written for you, and deployed to dev |

## When something goes wrong

- **"Cannot log in to maven-admin@192.168.0.36"**: do step 3 of section 1.
- **OpenNMS stopped with exit code 137**: memory. Give the VM 4 GB or more.
- **OpenNMS stopped, the log ends with `java: Operation not permitted`**: the `java` file in the OpenNMS image has
  the capabilities NET_RAW and NET_BIND_SERVICE (for ping), and a container that may not hold them cannot run it.
  Docker gives NET_RAW, Podman 5 does not. `kit.env` starts the container privileged, like production, and adds
  both capabilities anyway (`DEV_CAP_ADD`). If you changed `DEV_PODMAN_ARGS`, compare it with `./dev.sh prod-info`.
- **OpenNMS stopped with exit code 1 and `mkdir: cannot create directory '/root': Permission denied`**: the start
  script of the image makes an SSH key in `/root/.ssh`, so it needs root, as in production. `DEV_PODMAN_ARGS` in
  `kit.env` has `--user 0:0`; if you emptied it, put it back and run `./dev.sh up` (the container is created again, the database stays).
- **OpenNMS stopped with another code**: `./dev.sh up` prints the end of its log, the last commands of the image's
  start script (the lines that begin with `+`) and the lines of the image's `/entrypoint.sh` around its last message,
  and keeps the whole log in `.kit/opennms-start.log`. What production has and the dev container lacks
  (`./dev.sh prod-info`) goes into `DEV_PODMAN_ARGS` (run options) or `DEV_ENV` (variables) in `kit.env`.
- **The progress line stays on one step for a long time**: it ends with the last message of the start script, which
  shows the step that waits. `podman logs -f onms-dev-core` in another terminal follows the whole start script.
- **"Access denied" right after logging in** (the address ends in `j_spring_security_check`): OpenNMS refused the
  login form without its CSRF token. Reload the login page and log in again; `./dev.sh status` shows whether a
  browser-like login works and, if not, why (no token field in the login page, or a session cookie the browser drops).
- **"web UI is up, starting the other services" for a long time**: some health checks fail. After 3 minutes
  `./dev.sh up` lists them and goes on; OpenNMS and the topology page work without them.
- **Dev stops starting after it copied production's overlay folders**: set `DEV_PROD_OVERLAYS=no` in `kit.env`
  and run `./dev.sh up`; `./dev.sh prod-info` lists what those folders hold.
- **The demo nodes fail with HTTP 401**: your image has another admin password. Set `DEV_USER` and `DEV_PASSWORD` in `kit.env`.
- **A health check says "Bundle 81 is waiting for dependencies"**: a Karaf bundle of the image cannot start in dev, often
  one that needs production's other containers. To see which one and what it waits for: `ssh -p 8101 admin@localhost`
  (password admin), then `bundle:diag 81`. The topology page works without it.
- **Your CSS (`styles/topology.css`) or a new icon does not show**: a browser tab keeps the list of svg files it got
  when it opened the topology page, so open the page in a new tab after the first deploy of a new svg file; after a
  change, reload with the browser cache off (F12 > Network > Disable cache). `./topo.sh css` says whether the OpenNMS
  has your CSS (FILES.md, section 6).
- **A GraphML view is not in the View menu**: `./topo.sh view list` shows whether its cfg file is there; reload the
  page. `./dev.sh logs` (karaf.log) names the error if OpenNMS could not read the file.
- **The page is "unreachable" from your computer**: the firewall. Run
  `sudo firewall-cmd --permanent --add-port=8980/tcp && sudo firewall-cmd --reload`.
- **"Permission denied" on `./dev.sh`**: the files were unpacked without their executable bit. Run `chmod +x dev.sh topo.sh`.
