# How the studio works

The studio is small on purpose: a web page, a server of about 2,000 lines of TypeScript that needs no package
besides Node.js itself when it runs, and a handful of commands (podman, ssh, git) that it runs exactly as you would. This file explains each
part, so that you can follow, repeat or change what it does.

## 1. The parts

```
 browser: the page (web/, Vue 3 + TypeScript, built by Vite into web/dist)
   │  fetch /api/...            EventSource /api/events (the command log, live)
   ▼
 server (server/src, Node.js 20+: node:http, node:child_process, fetch; no other packages at run time)
   ├─ git -C workspace ...                         your files and their history     (history.ts)
   ├─ podman exec onms-dev-core ...                the development OpenNMS          (target.ts)
   ├─ ssh maven-admin@192.168.0.36 podman ...      production                       (target.ts)
   └─ fetch http://.../opennms/...                 the checks: what OpenNMS's web server sends
```

| File | What it does |
|---|---|
| `server/src/main.ts` | the web server: the page, the API (section 6), the token, one change at a time |
| `server/src/config.ts` | the settings: environment, then `studio.env`, then `kit/kit.env` (section 7) |
| `server/src/target.ts` | one OpenNMS (`dev` or `prod`): every command the studio runs against a container (section 2) |
| `server/src/overlay.ts` | which overlay folder of production takes a copy of a file (section 4) |
| `server/src/changes.ts` | apply, backups, checks, journal, undo (section 3) |
| `server/src/history.ts` | git in `workspace/` (section 5) |
| `server/src/modules/topology.ts` | the topology module: your CSS into the style svg, icon mappings into the cfg file |
| `server/src/modules/menu.ts` | the menu module: the Plugins word in `navbar.ftl` and the bundles, names in `dispatcher-servlet.xml` |
| `server/src/run.ts`, `events.ts` | runs a program and tells the page (the command log) |
| `server/src/util/archive.ts`, `diff.ts` | reads tar and jar files; makes diffs with `git diff --no-index` |
| `web/src/views/*.vue` | the four pages: Start, Topology, Menu bar, History |
| `web/src/components/TargetPanel.vue` | the panel of one OpenNMS: plan, apply, typed confirmation, undo, results |
| `web/public/preview-frame.html` | the topology preview: the DOM of the real page, drawn in an iframe (docs/opennms-topology.md, 3.4) |
| `web/src/components/MenuPreview.vue` | the two bars, drawn from the files' words and yours |

The modules know OpenNMS; the rest does not. A module says which files change and how (`FileChange`: a path below
OpenNMS's home, the new content, why), and what to check afterwards; `changes.ts` does the writing, keeping and
recording the same way for both.

## 2. The commands it runs

Everything that touches an OpenNMS goes through `Target` (`server/src/target.ts`):

| What | The command (dev) |
|---|---|
| read a file | `podman exec onms-dev-core cat <path>` |
| write a file | `podman exec -i onms-dev-core sh -c 'mkdir -p "$(dirname "$1")" && cat > "$1"' sh <path>` with the file on standard input |
| md5 sum | `podman exec onms-dev-core md5sum <path>` |
| does it exist | `podman exec onms-dev-core test -e <path>` |
| remove (undo of a new file) | `podman exec onms-dev-core rm -f <path>` |
| files that contain a text | `podman exec onms-dev-core sh -c 'cd "$1" && grep -l -F -e "$2" -- *.js' sh <folder> <text>` |
| several files at once | `podman exec onms-dev-core sh -c '... tar -cf - <files>' sh <folder> <patterns>` (the studio reads the tar) |
| OpenNMS's home | `podman exec onms-dev-core readlink -f /opt/opennms` (gives `/usr/share/opennms`) |
| the mounts (overlay folders, volumes) | `podman container inspect --format '{{json .Mounts}}' onms-dev-core` |
| running? | `podman container inspect -f '{{.State.Running}}' onms-dev-core` |
| restart (dev only) | `podman restart onms-dev-core` |

For production each one runs over ssh:

```
ssh -o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o ControlPath=~/.ssh/cm-%C -o ControlPersist=120 \
    maven-admin@192.168.0.36 'podman exec opennms md5sum /usr/share/opennms/...'
```

`BatchMode=yes` makes ssh fail instead of asking for a password (the studio cannot type one), and the three
`Control...` options keep one connection open for two minutes, so that the twenty commands of an apply do not log in
twenty times. The command log shows `ssh maven-admin@192.168.0.36 podman ...` without these options.

Why `podman exec ... cat >` and not `podman cp`: it reads the new file from standard input, so it works the same over
ssh, without a temporary file on the production machine. The file arrives with the rights of the user in the container
(root in these containers), and `mkdir -p` makes a missing folder.

**Checks over HTTP.** The studio also asks OpenNMS's web server, the way a browser does: `fetch` from the studio's
machine to `DEV_URL`/`PROD_URL` plus a path, with `Cache-Control: no-cache`, and with a login (HTTP Basic,
`DEV_USER`/`DEV_PASSWORD`, `PROD_USER`/`PROD_PASSWORD`) for `/navBar.htm` and `/api/v2/menu`. A check it cannot make
(no answer, no login) is shown as `?`: not checked, which is not the same as failed.

**The command log.** `run.ts` starts each program without a shell and sends two events to the page: the command line
(quoted so that you can paste it), and when it ends its exit code, time and the start of its output. The quiet checks
that the pages repeat on their own (is the container running, the md5 sums of the state lines) are not logged; during an
apply or an undo every check is.

## 3. An apply, step by step

1. **Plan.** The module reads the current files from the container, makes the new contents, and shows the
   difference: a unified diff (`git diff --no-index` between two temporary files), or for a bundle the text around
   the change. On production `overlay.ts` adds where each overlay copy goes (section 4).
2. **Snapshot.** `git add -A -- <module folder>` and `git commit` in `workspace/`, so that the journal can name the
   exact version this apply sends (if nothing changed since the last snapshot, that snapshot is named).
3. **Keep.** `changes.ts` reads each file the apply will replace, in the container and in the overlay folders, and
   keeps it in `backups/<date>-<time>-<target>-<module>/`, with `manifest.json`.
4. **Write.** Each file into the container; on production also each overlay copy, through the container's mount of
   that folder (so the studio needs no rights on the host folder itself).
5. **Check.** The md5 sum of each written file must equal the md5 sum of what was sent; then the module's checks (the
   web server sends the new style file, the bundles, `/navBar.htm` and `/api/v2/menu` show the new words, and for each
   icon file of yours that the web server sends it as your copy: *OpenNMS serves svg/nimbus.svg (your copy)*).
6. **Record.** One line in `backups/journal.jsonl`.

The topology apply writes the style file, the mapping file when your mappings changed, and one file for each copy in
`workspace/topology/icons/` that differs from the file in that OpenNMS (it compares md5 sums; a copy that is the same
as the file there is not sent again). Each is a line of the plan with its diff, kept in the backup and put back by Undo
like the others. The name `zz-topology-styles...` is the style file's and cannot be a copy. A copy named like one of
OpenNMS's own icon files (`opennms_icons.svg`, `atlas_icons.svg`, `vmware_icons.svg`, `legacy_icons.svg`) is sent as well,
and the plan marks it as a file of OpenNMS itself: on production its overlay copy replaces the file of a new OpenNMS
version at every start, so remove it before an upgrade (README.md, section 9). The icon check does not look at these files.

```
backups/
  journal.jsonl                                        one line per apply (and per undo)
  20261030-142501-prod-menu/
    manifest.json                                      the same record, readable
    container/jetty-webapps/opennms/WEB-INF/templates/navbar.ftl          what was in the container
    container/jetty-webapps/opennms/ui/assets/index-2c7519b1.js
    overlay/opennms-jetty-webapps-overlay/opennms/ui/assets/index-2c7519b1.js   what was in the overlay folder
                                                       (only for copies that were there before the apply)
```

A record (shortened):

```json
{"id":"20261030-142501-prod-menu","time":"2026-10-30T13:25:01.120Z","target":"prod","module":"menu","commit":"4f2a9c1",
 "files":[{"rel":"jetty-webapps/opennms/WEB-INF/templates/navbar.ftl",
           "inContainer":"/usr/share/opennms/jetty-webapps/opennms/WEB-INF/templates/navbar.ftl",
           "why":"the JSP bar: \"Plugins\" becomes \"Tools\" (line 94)","existedBefore":true,
           "md5Before":"…","md5After":"…",
           "overlays":[{"folder":"the jetty-webapps overlay folder","name":"opennms/WEB-INF/templates/navbar.ftl",
                        "inContainer":"/opt/opennms-jetty-webapps-overlay/opennms/WEB-INF/templates/navbar.ftl",
                        "onHost":"/opt/maven-nms/data/overlays/jetty-webapps-overlay/opennms/WEB-INF/templates/navbar.ftl",
                        "existedBefore":false}],
           "overlayNote":"Rule 2: a new copy in the jetty-webapps overlay folder."}],
 "checks":[{"what":"/usr/share/opennms/jetty-webapps/opennms/WEB-INF/templates/navbar.ftl in the container","ok":true,"detail":"md5 …"}],
 "backupDir":"backups/20261030-142501-prod-menu"}
```

**Undo** takes the newest apply of that module on that OpenNMS that is not undone yet (the two modules never write the
same file, so each page can undo its own applies). For each file it writes the kept file back,
or removes the file when the apply had added it, in the container and in each overlay folder, and checks the md5 sums
again. It notes in the log when a file changed after that apply (it puts the kept one back anyway). Then it appends
`{"undo":"<id>","time":"..."}` to the journal. Undo again goes one apply further back.

**One change at a time.** An apply, an undo or a restart of dev holds a lock in the server; a second one is refused
with *Wait: ... is running* (HTTP 409).

## 4. The overlay folders of production

The OpenNMS image copies three folders into OpenNMS at every start of the container:

| In the container | Copied into | On production's host |
|---|---|---|
| `/opt/opennms-jetty-webapps-overlay` | `jetty-webapps/` | `/opt/maven-nms/data/overlays/jetty-webapps-overlay` |
| `/opt/opennms-overlay` | OpenNMS's home | `/opt/maven-nms/data/overlays/overlay` |
| `/opt/opennms-etc-overlay` | `etc/` | `/opt/maven-nms/data/overlays/etc-overlay` |

A file written only into the container is replaced by an older overlay copy at the next start, or is gone when the
container is made again. So on production a file goes into the container (OpenNMS uses it at once) and into one overlay
folder (OpenNMS gets it again at every start). Which folder (`overlay.ts`, the same rules as `kit/topo.sh deploy prod`):

1. An overlay folder holds a copy of the file already: that copy is replaced (every such copy).

   Otherwise a file below `etc/` gets none when `etc/` is a volume: production's `opennms_data-config` keeps it, and
   a new overlay copy would put an old version back at every start after a change made in OpenNMS itself (Change Icon).
2. Otherwise a file below `jetty-webapps/` goes into the jetty-webapps overlay (`opennms/ui/assets/index-….js`).
3. Otherwise into the overlay of OpenNMS's home, at its path below the home.
4. Otherwise a file below `etc/` into the etc overlay.
5. Otherwise no folder takes it: the file is only in the container, and the plan says so.

The plan and the journal name the rule that decided ("Rule 2: a new copy in the jetty-webapps overlay folder.").

The studio finds the folders with `podman container inspect` (the `Mounts` whose destination is one of the three) and
writes the copies through the mount, so the host paths in the plan are for you to check by hand.

The development OpenNMS gets no overlay copies: its overlay folders are copies of production's that `kit/dev.sh up`
refreshes, so the studio writes into dev's container only. After a restart of dev, its start copies those folders in
again: a file you applied to dev only is then replaced by production's copy, if production has one.

## 5. The workspace and git

`workspace/` is a git repository that the studio creates at its first start (`git init`, branch `main`, a first
commit). It holds your files only, never OpenNMS's:

```
workspace/
  topology/topology.css         your CSS
  topology/icon-mappings.json   {"<namespace>.<node id>": "<icon id>"}
  topology/icons/<name>.svg     your copies of icon files (only when you made one: Topology > Icon files)
  menu/labels.json              {"plugins": "Tools", "menuNames": {"maps.htm#1": "Network Maps"}}
  README.md                     what each file becomes in OpenNMS
  .gitignore                    *.bak (the copies kit/topo.sh revert keeps)
```

| The page | git |
|---|---|
| History > Snapshot | `git add -A -- .` and `git commit -m "<message>"` |
| Changed since the last snapshot | `git status --porcelain=v1 -uall`, `git diff HEAD` |
| New experiment | `git switch -c experiment/<name>` (your current changes come along) |
| Switch | `git switch <branch>` (refused while there are changes: snapshot them first) |
| Compare | `git diff <older> <newer>` |
| Take its files back | `git restore --source=<snapshot> --worktree -- topology menu` |

If git has no `user.name` on this machine, the studio commits as "OpenNMS UI Studio" (with `-c user.name=... -c
user.email=...`, nothing is written to your git settings). The server watches `workspace/` and tells the page when a
file changed there, so an edit in another editor, or a `git switch` in a terminal, shows in the page within a moment.
The editors save by themselves 0.6 to 0.7 seconds after you stop typing.

## 6. The API

The page uses only this API, so a script can do everything the page does. Every call needs the token: the cookie
`studio_token` (set when you open `/?token=...`) or the header `x-studio-token`.

```bash
T=$(cat .studio/token)
curl -s -H "x-studio-token: $T" http://localhost:8990/api/status | python3 -m json.tool
curl -s -H "x-studio-token: $T" 'http://localhost:8990/api/topology/plan?target=dev' | python3 -m json.tool | head -30
curl -s -H "x-studio-token: $T" -H 'Content-Type: application/json' -d '{"target":"dev"}' http://localhost:8990/api/menu/apply
```

| Call | What it does |
|---|---|
| `GET /api/status` | dev and production (reachable, running), the workspace (branch, snapshot, changes), what is running |
| `GET /api/events` | the event stream of the command log (Server-Sent Events) |
| `GET /api/topology` | your CSS, your mappings, the style file made from them (text, md5) |
| `PUT /api/topology/css` `{"css": "..."}` | saves `topology/topology.css` |
| `PUT /api/topology/mappings` `{"mappings": {...}}` | saves `topology/icon-mappings.json` |
| `POST /api/topology/import` `{"path": "~/....css"}` | copies a CSS file of this machine into `topology/topology.css` |
| `GET /api/topology/preview?target=dev` | the files the preview needs from that OpenNMS: svg files, views, mapping files, the stock stylesheet (kept for 2 minutes; `&refresh=1` reads again) |
| `GET /api/topology/icons?target=dev` | the check of every svg file of that OpenNMS (the icons each holds, the problems, the repair that would be made), your copies in `topology/icons/` next to them, and the text of each copy (`&refresh=1` reads the files again) |
| `POST /api/topology/icons/repair` `{"target": "dev", "name": "nimbus.svg"}` | writes the repaired copy `topology/icons/nimbus.svg`: the file of that OpenNMS with the two renames (or your copy, when it has the flaw); nothing is sent to OpenNMS |
| `POST /api/topology/icons/remove` `{"target": "dev", "name": "nimbus.svg"}` | deletes your copy from the workspace |
| `GET /api/topology/state?target=prod` | what that OpenNMS has: the style file in the container, served, in the overlay folder; mappings up to date |
| `GET /api/topology/plan?target=` | the files an apply would write, with differences and overlay copies |
| `POST /api/topology/apply` `{"target": "prod", "confirm": "production"}` | applies (production needs the confirm) |
| `GET /api/menu/state?target=` | the words that OpenNMS has now: navbar.ftl, each bundle, the names, the plugin entries |
| `PUT /api/menu/labels` `{"plugins": "Tools", "menuNames": {...}}` | saves `menu/labels.json` (labels are checked: 1 to 40 letters, digits, spaces, `. , : ; ! ? ( ) & / + ' -`) |
| `GET /api/menu/plan?target=`, `POST /api/menu/apply` | as for the topology |
| `POST /api/dev/restart` | `podman restart` of dev, then waits until `login.jsp` answers (at most 15 minutes) |
| `GET /api/history` | branch, snapshot, changes, diff, log, experiments |
| `GET /api/history/diff?from=&to=&path=`, `GET /api/history/show?commit=&path=` | a diff; a file of a snapshot |
| `POST /api/history/snapshot` `{"message"}`, `/experiment` `{"name"}`, `/switch` `{"branch"}`, `/restore` `{"commit", "paths"}` | the git steps of section 5 |
| `GET /api/deploys` | the journal, newest first |
| `POST /api/deploys/undo` `{"target", "module", "confirm"}` | undoes the last apply of that module on that OpenNMS (without `module`: the last apply of any module) |

## 7. Settings

A variable in the environment wins over `studio.env`, which wins over `kit/kit.env`:

| Variable | Default | What it is |
|---|---|---|
| `STUDIO_PORT`, `STUDIO_HOST` | `8990`, `0.0.0.0` | where the page listens |
| `STUDIO_TOKEN` | a random token in `.studio/token` | `off`: no token (only on a machine nobody else reaches) |
| `PODMAN` | `podman` | how podman is called here, for example `sudo podman` |
| `DEV_CONTAINER`, `DEV_PORT` | `onms-dev-core`, `8980` | the development OpenNMS (kit.env) |
| `STUDIO_DEV_URL` | `http://127.0.0.1:<DEV_PORT>/opennms` | where the studio asks dev's web server |
| `DEV_USER`, `DEV_PASSWORD` | `admin`, `admin` | the login for the checks on dev |
| `PROD_SSH`, `PROD_CONTAINER`, `PROD_URL` | `maven-admin@192.168.0.36`, `opennms`, `http://192.168.0.36:8980/opennms` | production (kit.env) |
| `PROD_USER`, `PROD_PASSWORD` | empty | a login for the checks on production; empty: those checks say "not checked" |
| `STUDIO_KIT_DIR` | `kit` | the topology kit, whose `kit.env` the studio reads |

## 8. Adding a module

A third module (say, the logo or the login page) needs:

1. `server/src/modules/<name>.ts`: a `<name>State(config, target)` that reads what an OpenNMS has, a
   `<name>Plan(config, target)` that returns the files with their differences, and an `apply<Name>` that makes
   `FileChange`s and calls `applyChanges(config, target, '<name>', changes, commit, checks)`. Undo and the journal
   come with it.
2. Its routes in `server/src/main.ts`, like `/api/menu/...` (with `needConfirm` and `exclusive` for the apply).
3. A page in `web/src/views/`, a route in `web/src/main.ts`, a link in `web/src/App.vue`; the plan and apply calls in
   `web/src/api.ts`, and the module's name in `TargetPanel.vue` (its `load` and `apply` choose the calls by module).
4. Tests in `server/test/` against real files of OpenNMS in `server/test/fixtures/`.
5. A section in this folder that says which OpenNMS files the module changes and when OpenNMS reads them.
