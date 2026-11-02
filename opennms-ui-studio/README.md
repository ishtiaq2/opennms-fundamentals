# OpenNMS UI Studio

Change how OpenNMS Horizon 33.1.8 looks, see the result while you type, try it on a development OpenNMS, and apply
it to production when you are happy, with a backup and a one-click undo. It is also a learning project: every
OpenNMS file it touches is named, the commands it runs are shown as you would type them, and every change is kept in
the history of your workspace, so nothing about it is magic.

It has two modules:

| Module | What you change | The OpenNMS files it writes (below `/usr/share/opennms` in the container) |
|---|---|---|
| **Topology** | the look of `/opennms/topology` (the background behind the icons, frames, labels, links, sizes), the icon of each node, and the svg files of the icons themselves (checked, and repaired on request) | `jetty-webapps/opennms/svg/zz-topology-styles.svg`, `etc/org.opennms.features.topology.app.icons.default.cfg`, and a repaired `jetty-webapps/opennms/svg/<icon file>.svg` |
| **Menu bar** | the words of the bar at the top of every page: the Plugins menu (for example "Tools") in both bars, and the menu names of `dispatcher-servlet.xml` | `jetty-webapps/opennms/WEB-INF/templates/navbar.ftl`, `jetty-webapps/opennms/ui/assets/index-<hash>.js`, `jetty-webapps/opennms/WEB-INF/dispatcher-servlet.xml` |

**GUIDE.md** is the step-by-step course: setup, then experiments with both modules, and how to track them.
**docs/** explains what happens underneath, with links to the OpenNMS source lines:

- `docs/opennms-topology.md`: how OpenNMS builds `/opennms/topology`, which rule of CSS wins and why, how a node gets its icon;
- `docs/opennms-menu.md`: the two programs that draw the menu bar, every word of it and the file it comes from;
- `docs/how-the-studio-works.md`: every command the studio runs, an apply step by step, backups, overlay folders, the API.

**CHANGES.md** lists what each version added.

```
   your browser (any computer)
          │  http://192.168.0.47:8990
          ▼
 ┌──────────────────────────────── development machine 192.168.0.47 ─────────────────────────────┐
 │  OpenNMS UI Studio (Node.js)                                                                   │
 │   page (Vue + TypeScript)  ──/api──►  server (TypeScript)                                      │
 │                                          │  git            workspace/  your files, a git repo   │
 │                                          │  podman exec    container onms-dev-core (dev)        │
 │                                          │  ssh + podman   ─────────────────────────────┐       │
 │  kit/  the topology kit: kit/dev.sh up creates the development OpenNMS                 │       │
 └────────────────────────────────────────────────────────────────────────────────────────┼───────┘
                                                                                          ▼
                                     production 192.168.0.36: container opennms, overlay folders
```

## 1. What you need

On the **development machine** (the CentOS Stream 9 VM, 192.168.0.47, user `admin`):

- **Podman** and the **development OpenNMS** of the topology kit. If you used the kit before, you have both.
- **An ssh key that logs in to production without a password**: `ssh maven-admin@192.168.0.36 podman ps` works.
- **Node.js 20 or newer** with npm, and **git**:

  ```bash
  node --version || true             # v20 or v22 is fine
  sudo dnf module list nodejs        # the versions CentOS Stream offers
  sudo dnf module install -y nodejs:20/common    # or :22, if the list has it
  sudo dnf install -y git
  ```

A browser on any computer that reaches 192.168.0.47. The studio needs no internet once it is installed
(`npm install` downloads its packages once).

## 2. Install

Copy `opennms-ui-studio-1.0.0.tar.gz` to the development machine (for example
`scp opennms-ui-studio-1.0.0.tar.gz admin@192.168.0.47:` from the computer with the browser), then on the development machine:

```bash
mkdir -p ~/opennms-fundamentals && cd ~/opennms-fundamentals
tar xzf ~/opennms-ui-studio-1.0.0.tar.gz
cd opennms-ui-studio
npm install            # Vue, Vite and TypeScript, into node_modules/ (once)
npm run build          # compiles the server into server/dist and the page into web/dist
npm test               # optional: the unit tests (about 1 second)
sudo firewall-cmd --permanent --add-port=8990/tcp && sudo firewall-cmd --reload
```

**Updating.** An update archive holds only the files that changed since the version before it (CHANGES.md lists
them): unpack the updates in order. Stop the studio (Ctrl+C), then on the development machine:

```bash
cd ~/opennms-fundamentals
tar xzf ~/opennms-ui-studio-1.1.0-update.tar.gz       # 1.0.0 to 1.1.0 (skip it if you have 1.1.0)
tar xzf ~/opennms-ui-studio-1.2.0-update.tar.gz       # 1.1.0 to 1.2.0: the kit and the guides
cd opennms-ui-studio
npm run build                                           # needed after 1.1.0 (1.2.0 changes no code); no npm install
npm test                                                # optional: 21 tests
npm start
```

Each archive unpacks into `opennms-ui-studio/`, over your files. Your workspace, your history, `backups/` and the kit's
own folders (`kit/.kit`, `kit/opennms`, `kit/backups`) stay as they are; `kit/kit.env` is not in the archives. Reload the
page of the studio afterwards (Ctrl+F5).

The settings of OpenNMS are in `kit/kit.env` (production `maven-admin@192.168.0.36`, container `opennms`,
`http://192.168.0.36:8980/opennms`; dev container `onms-dev-core`, port 8980, login admin/admin). Change them there
if yours differ. `studio.env` holds the studio's port (8990).

## 3. Start

```bash
cd ~/opennms-fundamentals/opennms-ui-studio
kit/dev.sh up          # the development OpenNMS (skip it if it is running; kit/dev.sh status tells)
npm start
```

`npm start` prints the address with the access token:

```
OpenNMS UI Studio is running. Open in a browser:

  http://192.168.0.47:8990/?token=3f9c...
```

Open it in your browser. The token is kept in a cookie, so later `http://192.168.0.47:8990/` is enough (the token
is also in `.studio/token`). Stop the studio with Ctrl+C; your work stays in `workspace/`.

The first start creates `workspace/`, a git repository with your files (see section 5), and makes its first snapshot.

**If you used the topology kit before.** Your CSS is in the kit folder, `styles/topology.css`. Bring it over once:
Topology > *Import a CSS file* > `~/opennms-fundamentals/opennms-fundamentals/opennms-topology-kit-v6/styles/topology.css`.
From now on use the kit inside the studio (`kit/`): its `kit.env` points `STYLE_CSS` at the studio's
`workspace/topology/topology.css`, so `kit/topo.sh css prod`, `kit/topo.sh persist` and the studio look at the same
file. The first `kit/dev.sh up` in the new folder copies production's overlay folders again and creates the dev
container again (its database stays). `kit/dev.sh copy-prod` gives dev production's requisitions (its nodes) and
GraphML views as well, so the preview can draw production's views (kit/GUIDE-node-icons.md, part 0). Leave the old kit folder alone afterwards: its `dev.sh up` would deploy its own
`styles/topology.css` to dev.

## 4. How you work with it

1. **Preview.** Topology: edit the CSS on the left, the preview on the right redraws as you type. Click a node to
   see why it has its icon, give it another one, and see the colours your CSS gives it. Menu bar: type your word,
   both bars show it at once. OpenNMS does not change. Under the topology editor, *What your rules reach in this
   preview* says what each selector of yours selects, and whether another shape covers it; under the preview, *Icon files*
   checks the svg files of that OpenNMS (a file whose three looks lie on top of each other makes rules for its parts do
   nothing) and can make a repaired copy, which an apply sends like your CSS.
2. **Apply to the development OpenNMS.** The panel *Development OpenNMS* lists the files an apply writes, with their
   difference (a unified diff, or the text around the change for a compiled JavaScript file). *Apply* writes them into
   the container `onms-dev-core` (`podman exec -i onms-dev-core sh -c '... cat > <file>'`), checks the md5 sum of each
   file there, and asks the web server for it. Reload the real page of dev to see it.
3. **Apply to production.** The panel *Production* does the same over ssh, and also writes each file into the
   overlay folder that the OpenNMS image copies in at every start (`/opt/maven-nms/data/overlays/...`), so that a
   restart or a new container keeps it. You type `production` to confirm. The files it replaces go to `backups/`.
4. **Undo.** *Undo the last … apply* puts the replaced files back (and removes files the apply added), in the container
   and in the overlay folders. Each module's page undoes its own applies; click again to go one apply further back.

The **command log** at the bottom shows the commands the studio runs (podman, ssh, git) exactly as you would type
them, with exit code and time: everything an apply, an undo or a restart does, every read of OpenNMS's files, every git
command. Only the quiet checks that the pages repeat on their own (is the container running, the md5 sums behind the
state lines) are left out. It is the best way to see what really happens.

## 5. Your workspace and its history

```
workspace/                         a git repository: your work
  topology/topology.css            your CSS for the topology page
  topology/icon-mappings.json      {"<namespace>.<node id>": "<icon id>"}
  topology/icons/<name>.svg        your copies of icon files, for example a repaired nimbus.svg (only when you made one)
  menu/labels.json                 {"plugins": "Tools", "menuNames": {"maps.htm#1": "Network Maps"}}
  README.md                        what each file becomes in OpenNMS
backups/                           one folder per apply: the files it replaced; journal.jsonl lists every apply
.studio/token                      the access token of the page
```

The **History** page is git with buttons: a *snapshot* is a commit of your files, an *experiment* is a branch,
*compare* is `git diff`, *take its files back* is `git restore`. Every apply also makes a snapshot, so the journal
of applies names the exact version each OpenNMS got. You can use plain git in `workspace/` as well, and any editor:
the studio notices changes to the files.

## 6. The folders of this project

| Folder | What it is |
|---|---|
| `server/` | the server, TypeScript on Node.js, without runtime packages: `src/target.ts` (the commands for dev and production), `src/overlay.ts` (which overlay folder takes a file), `src/changes.ts` (apply, backups, undo), `src/history.ts` (git), `src/modules/topology.ts`, `src/modules/menu.ts`, `src/util/iconcheck.ts` (the check of the icon files); `test/` its unit tests; `assets/` the stock topology stylesheet and the workspace README |
| `web/` | the page: Vue 3, TypeScript, Vite. `src/views/` one file per page, `src/components/` the preview of the topology (`public/preview-frame.html`, built like the real page), the preview of the bars, the panels that apply |
| `kit/` | the topology kit 3.12: `dev.sh` (the development OpenNMS; `copy-prod` brings production's requisitions and views into it), `topo.sh` (command line tools: `css prod`, `persist`, `export`, `view show`, `view from-requisition`, `pagecheck`, ...) and its guides, among them `GUIDE-node-icons.md` (the files behind a node's icon, how OpenNMS builds the map, icons by node type) |
| `docs/` | how OpenNMS builds the topology page and the menu bars, and how the studio works |
| `scripts/` | `dev.mjs` (npm run dev), a systemd unit to run the studio as a service |

## 7. Commands

| Command | What it does |
|---|---|
| `npm start` | the studio (built): the page and the API on port 8990 |
| `npm run dev` | for work on the studio itself: the server restarts when you save a `.ts` file, the page (port 5173) updates in the browser as you save. Open `http://192.168.0.47:5173/?token=...` (open port 5173 in the firewall too) |
| `npm run build` | compiles server and page (after a change to the studio, or a new version) |
| `npm test` | unit tests of the parts that read and change OpenNMS files |
| `npm run typecheck` | TypeScript checks of server and page |
| `kit/dev.sh up`, `kit/dev.sh status` | start the development OpenNMS; its state |
| `kit/topo.sh css prod`, `kit/topo.sh persist` | the kit's checks: does production have your CSS, does it keep your files at every start |

## 8. Run it as a service (optional)

So that the studio runs after a reboot without a terminal:

```bash
mkdir -p ~/.config/systemd/user
cp scripts/opennms-ui-studio.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now opennms-ui-studio
journalctl --user -u opennms-ui-studio -f       # its output, with the address and token
```

The unit expects the studio in `~/opennms-fundamentals/opennms-ui-studio` (change `WorkingDirectory` otherwise).
`kit/dev.sh up` already made your user's services run without a login (`loginctl enable-linger`).

## 9. Safety

- The page needs the access token; without it the API answers 401. Do not publish port 8990 outside your LAN.
- Production changes need the typed confirmation `production`. Only one apply, undo or restart runs at a time.
- Each apply keeps the files it replaces and can be undone. The studio never restarts production, never deletes
  anything else, and changes only the files listed in its plan.
- Overlay copies of OpenNMS's own files (navbar.ftl, dispatcher-servlet.xml, the ui bundles) replace those files at
  every start. Before you upgrade OpenNMS to a new image, remove them (GUIDE.md, step 5.4), or the old copies replace
  the new version's files.

## 10. When something is not as expected

| What you see | Why | What to do |
|---|---|---|
| the page says to open it with `?token=` | no token cookie in this browser | open the address that `npm start` printed (or `.studio/token`) |
| *production: not reachable* on Start | ssh needs a password, or the address is wrong | `ssh maven-admin@192.168.0.36 podman ps` must work without a password: `ssh-copy-id maven-admin@192.168.0.36`; check `PROD_SSH` in `kit/kit.env` |
| *dev: not running* | the development OpenNMS is stopped | `kit/dev.sh up` |
| the topology preview is empty | the studio could not read the files of that OpenNMS | the message under the preview says why; *Read the files again* |
| a check says `?` (not checked) | the studio could not ask (for example `/navBar.htm` needs a login) | set `DEV_USER`/`DEV_PASSWORD` (or `PROD_USER`/`PROD_PASSWORD`) in `kit/kit.env` |
| the dev page still shows the old look | the tab keeps its files, or OpenNMS was restarted from older overlay copies | open the page in a new tab; Topology/Menu > *Read again* shows what dev has; apply again |
| a new menu name shows in the Vue bar, not in the JSP bar | the JSP bar reads `dispatcher-servlet.xml` when OpenNMS starts | Menu bar > *Restart the development OpenNMS* (production: at your next restart) |
| *Wait: ... is running* | another apply, undo or restart is running | wait for it (the command log shows it) |
| a rule for the parts of an icon changes nothing | another layer of the icon lies over the shapes the rule colours | Topology > *What your rules reach*, and *Icon files*: GUIDE.md, Experiment T8 |
| `npm install` fails | no internet, or a proxy | set `npm config set proxy http://...` or install on a machine with internet and copy the folder with `node_modules/` |

## 11. Sources

The studio is built on the OpenNMS 33.1.8 source (tag `opennms-33.1.8-1` of https://github.com/OpenNMS/opennms):
`opennms-webapp/src/main/webapp/WEB-INF/templates/navbar.ftl`, `ui/src/components/Layout/Menubar.vue`,
`opennms-webapp/src/main/webapp/WEB-INF/dispatcher-servlet.xml`, `opennms-webapp-rest/.../support/menu/MenuProvider.java`,
`features/topology-map/...` (GWTVertex, IconRepositoryManager, the topo_default theme). docs/ has the links. Your
OpenNMS image is your own build; the studio finds the files by what they contain, so a slightly different build works too.
